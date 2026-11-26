package com.frieve.effetune;

import android.util.Log;
import io.netty.bootstrap.Bootstrap;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioSocketChannel;
import io.netty.handler.codec.http.*;
import io.netty.handler.ssl.SslHandler;
import io.netty.handler.timeout.ReadTimeoutHandler;
import java.io.Closeable;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.SSLParameters;
import org.json.JSONObject;

final class LanHttp implements Closeable {
    private static final int LIMIT = 1024 * 1024;
    private final EventLoops loops = new EventLoops();
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(0, 1, 30, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(256), task -> new Thread(task, "EffeTune-LAN-HTTP"));
    private final Semaphore pending = new Semaphore(256);
    // A second device can borrow one unused relay slot; the total stays at four relays plus one HTTP client.
    final Semaphore relaySlots = new Semaphore(4);
    private volatile EventLoop requestLoop;
    // Accessed only on the single Netty event loop.
    private final ArrayDeque<Request> ready = new ArrayDeque<>();
    private final Map<InetAddress, Channel> active = new HashMap<>();
    private int bufferedResponseBytes, bufferedRequestBytes;

    private record Request(Target target, JSONObject args, String id, int timeout, long expires,
                           BooleanSupplier current, CompletableFuture<JSONObject> result) {}

    /** Each server owns one lease. The last close releases the single shared event loop. */
    static final class EventLoops implements Closeable {
        private static NioEventLoopGroup shared;
        private static int owners;
        private boolean acquired, closed;
        NioEventLoopGroup get() {
            synchronized (EventLoops.class) {
                if (closed) throw new IllegalStateException("Network owner closed");
                if (shared == null) shared = new NioEventLoopGroup(1);
                if (!acquired) { acquired = true; owners++; }
                return shared;
            }
        }
        @Override public void close() {
            synchronized (EventLoops.class) {
                if (closed) return;
                closed = true;
                if (acquired && --owners == 0) {
                    shared.shutdownGracefully(0, 2, TimeUnit.SECONDS);
                    shared = null;
                }
            }
        }
    }

    record Target(URI uri, InetSocketAddress peer) {
        static Target resolve(String url, String expectedAddress) throws Exception {
            return resolve(url, expectedAddress, false);
        }

        // Only the Subsonic owner's saved endpoint may use a public address.
        static Target resolve(String url, String expectedAddress, boolean savedEndpoint) throws Exception {
            URI uri = new URI(url);
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawFragment() != null)
                throw new IOException("Unsupported UPnP URI");
            int port = uri.getPort() < 0 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : uri.getPort();
            for (InetAddress ip : InetAddress.getAllByName(uri.getHost())) {
                if ((savedEndpoint || NetworkStreamServer.lan(ip)) && (expectedAddress == null || ip.getHostAddress().equals(expectedAddress)))
                    return new Target(uri, new InetSocketAddress(ip, port));
            }
            throw new IOException("No matching LAN address");
        }

        HttpRequest message(String method, JSONObject headers, String body) throws Exception {
            String path = uri.getRawPath();
            if (path.isEmpty()) path = "/";
            if (uri.getRawQuery() != null) path += "?" + uri.getRawQuery();
            byte[] data = body.getBytes(StandardCharsets.UTF_8);
            FullHttpRequest request = new DefaultFullHttpRequest(HttpVersion.HTTP_1_1, HttpMethod.valueOf(method),
                    path, Unpooled.wrappedBuffer(data));
            if (headers != null) {
                for (Iterator<String> keys = headers.keys(); keys.hasNext();) {
                    String key = keys.next();
                    request.headers().set(key, headers.getString(key));
                }
            }
            request.headers().remove("Transfer-Encoding");
            request.headers().set("Host", uri.getRawAuthority()).set("Connection", "close")
                    .set("Accept-Encoding", "identity").set("Content-Length", data.length);
            return request;
        }

        ChannelFuture connect(EventLoopGroup group, int timeout, ChannelInitializer<SocketChannel> response) {
            return new Bootstrap().group(group).channel(NioSocketChannel.class)
                    .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, timeout)
                    .handler(new ChannelInitializer<SocketChannel>() {
                        @Override protected void initChannel(SocketChannel ch) throws Exception {
                            if ("https".equalsIgnoreCase(uri.getScheme())) {
                                SSLEngine engine = SSLContext.getDefault().createSSLEngine(uri.getHost(), peer.getPort());
                                engine.setUseClientMode(true);
                                SSLParameters params = engine.getSSLParameters();
                                params.setEndpointIdentificationAlgorithm("HTTPS");
                                engine.setSSLParameters(params);
                                ch.pipeline().addLast(new SslHandler(engine));
                            }
                            ch.pipeline().addLast(new ReadTimeoutHandler(timeout, TimeUnit.MILLISECONDS) {
                                @Override protected void readTimedOut(ChannelHandlerContext ctx) throws Exception {
                                    // A slow media consumer can deliberately pause upstream reads.
                                    if (ctx.channel().config().isAutoRead()) super.readTimedOut(ctx);
                                }
                            }, new HttpClientCodec(), response);
                        }
                    }).connect(peer);
        }
    }

    private void startRequest(Request request) throws Exception {
        Target target = request.target;
        CompletableFuture<JSONObject> result = request.result;
        BooleanSupplier current = request.current;
        if (worker.isShutdown()) throw new IOException("Network owner closed");
        if (System.nanoTime() >= request.expires) throw new java.net.SocketTimeoutException();
        if (current != null && !current.getAsBoolean()) throw PwaNetworkHost.denied();
        ChannelFuture connection = target.connect(requestLoop, request.timeout, new ChannelInitializer<SocketChannel>() {
            @Override protected void initChannel(SocketChannel ch) {
                ch.pipeline().addLast(new ChannelInboundHandlerAdapter() {
                    private int held;
                    @Override public void channelRead(ChannelHandlerContext ctx, Object message) {
                        if (message instanceof HttpContent content) {
                            int size = content.content().readableBytes();
                            if (size > LIMIT - bufferedResponseBytes) {
                                io.netty.util.ReferenceCountUtil.release(message);
                                result.completeExceptionally(new IOException("LAN response budget exceeded"));
                                ctx.close();
                                return;
                            }
                            bufferedResponseBytes += size;
                            held += size;
                        }
                        ctx.fireChannelRead(message);
                    }
                    @Override public void channelInactive(ChannelHandlerContext ctx) {
                        bufferedResponseBytes -= held;
                        ctx.fireChannelInactive();
                    }
                });
                ch.pipeline().addLast(new HttpObjectAggregator(LIMIT), new SimpleChannelInboundHandler<FullHttpResponse>() {
                    @Override protected void channelRead0(ChannelHandlerContext ctx, FullHttpResponse response) throws Exception {
                        if (!response.decoderResult().isSuccess()) throw new IOException("Invalid HTTP response");
                        if (response.status().code() < 200) return;
                        JSONObject fields = new JSONObject();
                        for (Map.Entry<String, String> entry : response.headers())
                            fields.put(entry.getKey().toLowerCase(Locale.ROOT), entry.getValue());
                        if (current != null && !current.getAsBoolean()) throw PwaNetworkHost.denied();
                        JSONObject value = AudioService.object("status", response.status().code(), "headers", fields,
                                "text", response.content().toString(StandardCharsets.UTF_8),
                                "connectionAddress", target.peer().getAddress().getHostAddress());
                        if (AudioService.remainingBridgeReplyBytes(request.id, value) < 0) throw new IOException("Bridge reply too large");
                        result.complete(value);
                    }
                    @Override public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
                        result.completeExceptionally(cause);
                        ctx.close();
                    }
                    @Override public void channelInactive(ChannelHandlerContext ctx) {
                        result.completeExceptionally(new IOException("Incomplete HTTP response"));
                    }
                });
            }
        });
        Channel ch = connection.channel();
        InetAddress peer = target.peer().getAddress();
        active.put(peer, ch);
        ch.closeFuture().addListener(done -> {
            if (active.size() == 2) relaySlots.release();
            active.remove(peer);
            result.completeExceptionally(new IOException("LAN connection closed"));
            ch.eventLoop().execute(this::drain);
        });
        result.whenComplete((value, error) -> ch.close());
        connection.addListener((ChannelFutureListener) connected -> {
            try {
                if (!connected.isSuccess()) result.completeExceptionally(connected.cause());
                else if (!result.isDone()) {
                    if (current != null && !current.getAsBoolean()) throw PwaNetworkHost.denied();
                    JSONObject args = request.args;
                    String body = args.optString("body", "");
                    int size = io.netty.buffer.ByteBufUtil.utf8Bytes(body);
                    if (size > LIMIT - bufferedRequestBytes) throw new IOException("LAN request budget exceeded");
                    HttpRequest message = target.message(args.optString("method", "GET"), args.optJSONObject("headers"), body);
                    bufferedRequestBytes += size;
                    ch.writeAndFlush(message).addListener((ChannelFutureListener) sent -> {
                        bufferedRequestBytes -= size;
                        if (!sent.isSuccess()) result.completeExceptionally(sent.cause());
                    });
                }
            } catch (Exception error) { result.completeExceptionally(error); }
        });
    }

    private void drain() {
        Iterator<Request> it = ready.iterator();
        while (active.size() < 2 && it.hasNext()) {
            Request request = it.next();
            if (active.containsKey(request.target.peer().getAddress())) continue;
            boolean borrow = !active.isEmpty();
            if (borrow && !relaySlots.tryAcquire()) break;
            it.remove();
            try { startRequest(request); }
            catch (Exception error) {
                if (borrow) relaySlots.release();
                request.result.completeExceptionally(error);
            }
        }
    }

    void releaseRelay() {
        relaySlots.release();
        EventLoop loop = requestLoop;
        if (loop != null && !worker.isShutdown()) {
            try { loop.execute(this::drain); }
            catch (RejectedExecutionException closed) { if (!worker.isShutdown()) throw closed; }
        }
    }

    private void enqueue(Request request) {
        if (worker.isShutdown()) {
            request.result.completeExceptionally(new IOException("Network owner closed"));
            return;
        }
        long delay = request.expires - System.nanoTime();
        if (delay <= 0) {
            request.result.completeExceptionally(new java.net.SocketTimeoutException());
            return;
        }
        var deadline = requestLoop.schedule(() -> {
            ready.remove(request);
            request.result.completeExceptionally(new java.net.SocketTimeoutException());
        }, delay, TimeUnit.NANOSECONDS);
        request.result.whenComplete((value, error) -> deadline.cancel(false));
        ready.addLast(request);
        drain();
    }

    void request(JSONObject args, String id, AudioService.Reply reply, BooleanSupplier current) {
        int timeout = args.optInt("timeout", 8000);
        if (timeout < 1 || timeout > 30000) throw new IllegalArgumentException("Invalid HTTP timeout");
        if (!pending.tryAcquire()) throw new RejectedExecutionException("LAN request queue full");
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        result.whenComplete((value, error) -> {
            pending.release();
            if (error == null) reply.complete(value, null);
            else failed(reply, error, current != null);
        });
        try {
            EventLoop loop = loops.get().next();
            requestLoop = loop;
            long expires = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeout);
            worker.execute(() -> {
                try {
                    if (worker.isShutdown()) throw new IOException("Network owner closed");
                    if (current != null && !current.getAsBoolean()) throw PwaNetworkHost.denied();
                    Target target = Target.resolve(args.getString("url"), args.optString("address", null));
                    Request request = new Request(target, args, id, timeout, expires, current, result);
                    loop.execute(() -> enqueue(request));
                } catch (Exception error) { result.completeExceptionally(error); }
            });
        } catch (RuntimeException error) { result.completeExceptionally(error); }
    }

    void submit(Callable<JSONObject> operation, AudioService.Reply reply) {
        if (!pending.tryAcquire()) throw new RejectedExecutionException("LAN request queue full");
        try {
            worker.execute(() -> {
                try {
                    if (worker.isShutdown()) throw new IOException("Network owner closed");
                    reply.complete(operation.call(), null);
                } catch (Exception error) { failed(reply, error, false); }
                finally { pending.release(); }
            });
        } catch (RejectedExecutionException error) { pending.release(); throw error; }
    }

    private static void failed(AudioService.Reply reply, Throwable error, boolean privateResource) {
        if (error instanceof AudioService.HostError stale) { reply.complete(null, stale); return; }
        if (privateResource) Log.d("EffeTuneNetwork", "PWA LAN request failed: " + error.getClass().getSimpleName());
        else if (error instanceof IOException) Log.d("EffeTuneNetwork", "LAN request failed: " + error.getClass().getSimpleName());
        else Log.d("EffeTuneNetwork", "LAN request failed", error);
        reply.complete(null, new AudioService.HostError("operation-failed", "The audio operation could not be completed. Try again."));
    }

    @Override public void close() {
        // Queued jobs see shutdown before doing any I/O and complete their replies.
        worker.shutdownNow().forEach(Runnable::run);
        EventLoop loop = requestLoop;
        if (loop != null) loop.execute(() -> {
            while (!ready.isEmpty()) ready.removeFirst().result.completeExceptionally(new IOException("Network owner closed"));
            for (Channel ch : active.values().toArray(new Channel[0])) ch.close();
        });
        loops.close();
    }
}

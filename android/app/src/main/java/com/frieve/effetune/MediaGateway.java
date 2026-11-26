package com.frieve.effetune;

import android.util.Log;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.*;
import io.netty.channel.group.ChannelGroup;
import io.netty.channel.group.DefaultChannelGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.*;
import io.netty.handler.timeout.ReadTimeoutHandler;
import io.netty.util.ReferenceCountUtil;
import io.netty.util.concurrent.GlobalEventExecutor;
import java.io.Closeable;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Callable;
import java.util.function.BooleanSupplier;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

final class MediaGateway implements Closeable {
    private static final String OPENHOME_PATH = "/openhome-media/";
    private static final String[] RESPONSE_HEADERS = {"Accept-Ranges", "Cache-Control", "ContentFeatures.dlna.org",
            "Content-Length", "Content-Range", "Content-Type", "ETag", "Last-Modified", "TransferMode.dlna.org",
            "X-EffeTune-Live-Connection"};
    // A local HTTP caller may itself be waiting on this relay while a redirect needs DNS.
    private final ThreadPoolExecutor redirects = new ThreadPoolExecutor(0, 1, 30, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(32), task -> new Thread(task, "EffeTune-media-DNS"));
    private final LanHttp.EventLoops loops = new LanHttp.EventLoops();
    private final ChannelGroup channels = new DefaultChannelGroup(GlobalEventExecutor.INSTANCE, true);
    private record Entry(LanHttp.Target target, boolean live) {}
    private final ConcurrentHashMap<String, Entry> targets = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Relay> liveConnections = new ConcurrentHashMap<>();
    private int port;
    private final LanHttp http;
    private boolean closed;

    MediaGateway(LanHttp http) { this.http = http; }

    JSONObject register(String url, boolean live) throws Exception {
        return register(LanHttp.Target.resolve(url, null), live);
    }

    private synchronized JSONObject register(LanHttp.Target target, boolean live) throws Exception {
        if (closed || targets.size() >= 8192) throw new IOException("Gateway registration unavailable");
        if (port == 0) {
            Channel listener = new ServerBootstrap().group(loops.get()).channel(NioServerSocketChannel.class)
                    .childOption(ChannelOption.TCP_NODELAY, true)
                    .childHandler(new ChannelInitializer<SocketChannel>() {
                        @Override protected void initChannel(SocketChannel channel) {
                            channels.add(channel);
                            channel.pipeline().addLast("deadline", new ReadTimeoutHandler(10));
                            channel.pipeline().addLast(new HttpServerCodec(), new HttpObjectAggregator(1024), new Relay());
                        }
                    }).bind("127.0.0.1", 0).sync().channel();
            channels.add(listener);
            port = ((InetSocketAddress) listener.localAddress()).getPort();
        }
        String token = NetworkStreamServer.token();
        targets.put(token, new Entry(target, live));
        return AudioService.object("token", token, "playbackUrl", playbackUrl(token));
    }

    private String playbackUrl(String token) { return "http://127.0.0.1:" + port + OPENHOME_PATH + token; }

    synchronized String livePlaybackUrl(String token) throws IOException {
        Entry entry = targets.get(token);
        if (entry == null || !entry.live()) throw new IOException("Live registration expired");
        return playbackUrl(token);
    }

    boolean release(String token) {
        boolean removed = targets.remove(token) != null;
        Relay relay = liveConnections.remove(token);
        if (relay != null) relay.downstream.close();
        return removed;
    }

    void liveFeedback(JSONObject message, AudioService.Reply reply) {
        Relay relay = liveConnections.get(message.optString("sessionId"));
        if (relay == null) { reply.complete(AudioService.object("value", JSONObject.NULL), null); return; }
        relay.downstream.eventLoop().execute(() -> relay.feedback(message, reply));
    }

    private static void cors(HttpResponse response) {
        response.headers().set("Access-Control-Allow-Origin", "*")
                .set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type, X-EffeTune-Live-Connection")
                .set("Connection", "close");
    }

    void servePwa(Channel ch, Callable<LanHttp.Target> resolve, boolean head, boolean artwork, String range, BooleanSupplier current) {
        serveResource(ch, resolve, head, artwork, range, current, true);
    }

    // Both ingress handlers verify the downstream before handing the channel to the streaming relay.
    void serveResource(Channel ch, Callable<LanHttp.Target> resolve, boolean head, boolean artwork, String range,
                       BooleanSupplier current, boolean pwa) {
        Relay relay = new Relay();
        relay.downstream = ch;
        relay.current = current;
        relay.pwa = pwa;
        relay.artwork = artwork;
        relay.method = head ? "HEAD" : "GET";
        relay.headers = !artwork && range != null ? AudioService.object("Range", range) : new JSONObject();
        if (pwa) ch.pipeline().addBefore("pwa-ingress", "pwa-relay", relay);
        else ch.pipeline().addLast(relay);
        if (!relay.acquire()) return;
        var deadline = ch.eventLoop().schedule(() -> relay.finish(502), 15, TimeUnit.SECONDS);
        try {
            var resolving = redirects.submit(() -> {
                try {
                    LanHttp.Target target = resolve.call();
                    ch.eventLoop().execute(() -> {
                        deadline.cancel(false);
                        if (relay.ended || !ch.isActive() || !current.getAsBoolean()) { relay.finish(404); return; }
                        try { relay.fetch(target, 3); } catch (Exception unavailable) { relay.finish(502); }
                    });
                } catch (Exception unavailable) {
                    if (ch.isActive()) ch.eventLoop().execute(() -> relay.finish(current.getAsBoolean() ? 502 : 404));
                }
            });
            ch.closeFuture().addListener(done -> { deadline.cancel(false); resolving.cancel(true); });
        } catch (java.util.concurrent.RejectedExecutionException busy) { deadline.cancel(false); relay.finish(503); }
    }

    private final class Relay extends SimpleChannelInboundHandler<FullHttpRequest> {
        private Channel downstream, upstream;
        private boolean busy, committed, ended;
        private String method;
        private String token, connectionId;
        private LanHttp.Target feedbackTarget;
        private Channel feedbackChannel;
        private JSONObject headers;
        private BooleanSupplier current;
        private boolean pwa;
        private boolean artwork;
        private long received;

        private boolean acquire() {
            if (!http.relaySlots.tryAcquire()) { finish(503); return false; }
            busy = true;
            return true;
        }

        @Override protected void channelRead0(ChannelHandlerContext ctx, FullHttpRequest req) throws Exception {
            downstream = ctx.channel();
            if (busy || ended) return;
            if (!req.decoderResult().isSuccess()) { finish(400); return; }
            if (HttpMethod.OPTIONS.equals(req.method())) { finish(204); return; }
            if (!HttpMethod.GET.equals(req.method()) && !HttpMethod.HEAD.equals(req.method())) { finish(405); return; }
            String path = req.uri();
            if (!path.startsWith(OPENHOME_PATH)) { finish(404); return; }
            token = path.substring(OPENHOME_PATH.length());
            Entry entry = targets.get(token);
            if (entry == null) { finish(404); return; }
            if (!acquire()) return;
            method = req.method().name();
            headers = AudioService.object("getcontentFeatures.dlna.org", "1", "transferMode.dlna.org", "Streaming",
                    "User-Agent", "EffeTune/1.0 UPnP/1.0 DLNADOC/1.50");
            for (String key : new String[]{"Range", "Accept"})
                if (req.headers().contains(key)) headers.put(key, req.headers().get(key));
            if (entry.live() && "GET".equals(method) && NetworkStreamServer.PCM.equals(headers.optString("Accept"))) {
                Relay previous = liveConnections.put(token, this);
                if (previous != null) previous.downstream.close();
                if (targets.get(token) != entry) { finish(404); return; }
                headers.remove("Range");
            }
            ctx.pipeline().remove("deadline");
            fetch(entry.target(), 4);
        }

        private void fetch(LanHttp.Target target, int redirects) throws Exception {
            HttpRequest request = target.message(method, headers, "");
            ChannelFuture connecting = target.connect(downstream.eventLoop(), 15000, new ChannelInitializer<SocketChannel>() {
                @Override protected void initChannel(SocketChannel ch) {
                    ch.pipeline().addLast(new SimpleChannelInboundHandler<HttpObject>() {
                        @Override protected void channelRead0(ChannelHandlerContext ctx, HttpObject item) throws Exception {
                            if (ended || upstream != ch) return;
                            if (current != null && !current.getAsBoolean()) { finish(404); return; }
                            if (!item.decoderResult().isSuccess()) throw new IOException("Invalid media response");
                            if (item instanceof HttpResponse response) {
                                int status = response.status().code();
                                if (status < 200) return;
                                String location = response.headers().get("Location");
                                if (location != null && (status == 301 || status == 302 || status == 303 || status == 307 || status == 308)) {
                                    if (redirects == 0) { finish(502); return; }
                                    URI next = target.uri().resolve(location);
                                    if (current == null) redirect(next.toString(), redirects - 1);
                                    else if (sameOrigin(target.uri(), next) && next.getRawUserInfo() == null && next.getRawFragment() == null) {
                                        fetch(new LanHttp.Target(next, target.peer()), redirects - 1);
                                    } else { finish(502); return; }
                                    if (upstream == ch) upstream = null;
                                    ch.close();
                                    return;
                                }
                                HttpResponse out = new DefaultHttpResponse(HttpVersion.HTTP_1_1, response.status());
                                String id = response.headers().get("X-EffeTune-Live-Connection");
                                if (current == null && redirects == 4 && status == 200 && liveConnections.get(token) == Relay.this
                                        && NetworkStreamServer.PCM.equals(response.headers().get("Content-Type"))
                                        && id != null && id.matches("[0-9a-f]{32}")) {
                                    connectionId = id;
                                    feedbackTarget = new LanHttp.Target(URI.create(target.uri() + "/feedback"), target.peer());
                                }
                                String type = response.headers().get("Content-Type", "application/octet-stream");
                                if (current != null && ((status != 200 && status != 206 && status != 416)
                                        || (artwork ? !type.matches("(?i)image/(jpeg|png|gif|webp)(;.*)?")
                                            || HttpUtil.getContentLength(response, -1L) > 8 * 1024 * 1024
                                            : type.matches("(?i).*(xml|json|html).*")))) { finish(404); return; }
                                for (String key : current == null ? RESPONSE_HEADERS : new String[]{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"}) {
                                    String value = response.headers().get(key);
                                    if (value != null) out.headers().set(key, value);
                                }
                                if (HttpUtil.isTransferEncodingChunked(response)) HttpUtil.setTransferEncodingChunked(out, true);
                                if (current == null) cors(out);
                                else out.headers().set("Content-Type", type).set("Cache-Control", "no-store").set("Connection", "close").set("X-Content-Type-Options", "nosniff");
                                committed = true;
                                downstream.writeAndFlush(out).addListener(ChannelFutureListener.CLOSE_ON_FAILURE);
                            }
                            if (item instanceof HttpContent content && committed) {
                                if (artwork && (received += content.content().readableBytes()) > 8 * 1024 * 1024) { finish(404); return; }
                                boolean last = item instanceof LastHttpContent;
                                ChannelFuture write = downstream.writeAndFlush(content.retain());
                                if (last) ended = true;
                                write.addListener(last ? ChannelFutureListener.CLOSE : ChannelFutureListener.CLOSE_ON_FAILURE);
                            }
                        }
                        @Override public void channelInactive(ChannelHandlerContext ctx) {
                            if (upstream == ch && !ended) finish(502);
                        }
                        @Override public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
                            if (upstream == ch) fail(cause);
                            ctx.close();
                        }
                    });
                }
            });
            upstream = connecting.channel();
            channels.add(upstream);
            connecting.addListener((ChannelFutureListener) connected -> {
                if (connected.isSuccess() && downstream.isActive()) {
                    connected.channel().writeAndFlush(request).addListener(ChannelFutureListener.CLOSE_ON_FAILURE);
                } else {
                    ReferenceCountUtil.release(request);
                    connected.channel().close();
                    if (!ended && downstream.isActive()) finish(502);
                }
            });
        }

        private void redirect(String url, int remaining) {
            redirects.execute(() -> {
                try {
                    LanHttp.Target next = LanHttp.Target.resolve(url, null);
                    downstream.eventLoop().execute(() -> {
                        if (!downstream.isActive()) return;
                        try { fetch(next, remaining); } catch (Exception error) { fail(error); }
                    });
                } catch (Exception error) {
                    if (downstream.isActive()) downstream.eventLoop().execute(() -> fail(error));
                }
            });
        }

        // The sender accepts probes only from the receiver of this exact PCM connection.
        private void feedback(JSONObject message, AudioService.Reply reply) {
            if (liveConnections.get(token) != this || !targets.containsKey(token) || feedbackChannel != null
                    || !message.optString("connectionId").equals(connectionId)) {
                reply.complete(AudioService.object("value", JSONObject.NULL), null);
                return;
            }
            try {
                HttpRequest post = feedbackTarget.message("POST", AudioService.object("Content-Type", "application/json"),
                        message.toString());
                ChannelFuture connecting = feedbackTarget.connect(downstream.eventLoop(), 300, new ChannelInitializer<SocketChannel>() {
                    @Override protected void initChannel(SocketChannel ch) {
                        ch.pipeline().addLast(new HttpObjectAggregator(1024), new SimpleChannelInboundHandler<FullHttpResponse>() {
                            @Override protected void channelRead0(ChannelHandlerContext ctx, FullHttpResponse response) throws Exception {
                                int status = response.status().code();
                                if (status < 200) return;
                                Object value = JSONObject.NULL;
                                if (message.has("probeId")) {
                                    if (status == 204) value = true;
                                } else if (status == 200) {
                                    String id = new JSONObject(response.content().toString(StandardCharsets.UTF_8)).optString("probeId");
                                    if (id.matches("[0-9a-f]{32}")) value = id;
                                }
                                if (feedbackChannel == ch) {
                                    feedbackChannel = null;
                                    reply.complete(AudioService.object("value", liveConnections.get(token) == Relay.this ? value : JSONObject.NULL), null);
                                }
                                ctx.close();
                            }
                            @Override public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) { ctx.close(); }
                        });
                    }
                });
                Channel ch = connecting.channel();
                feedbackChannel = ch;
                channels.add(ch);
                var timeout = ch.eventLoop().schedule((Runnable) () -> ch.close(), 300, TimeUnit.MILLISECONDS);
                ch.closeFuture().addListener(done -> {
                    timeout.cancel(false);
                    if (feedbackChannel == ch) {
                        feedbackChannel = null;
                        reply.complete(AudioService.object("value", JSONObject.NULL), null);
                    }
                });
                connecting.addListener((ChannelFutureListener) done -> {
                    if (done.isSuccess()) ch.writeAndFlush(post).addListener(ChannelFutureListener.CLOSE_ON_FAILURE);
                    else { ReferenceCountUtil.release(post); ch.close(); }
                });
            } catch (Exception error) {
                Log.d("EffeTuneNetwork", "Live feedback failed", error);
                reply.complete(AudioService.object("value", JSONObject.NULL), null);
            }
        }

        @Override public void channelWritabilityChanged(ChannelHandlerContext ctx) {
            if (upstream != null) upstream.config().setAutoRead(ctx.channel().isWritable());
            ctx.fireChannelWritabilityChanged();
        }

        @Override public void channelInactive(ChannelHandlerContext ctx) {
            ended = true;
            if (token != null) liveConnections.remove(token, this);
            if (feedbackChannel != null) feedbackChannel.close();
            if (busy) { http.releaseRelay(); busy = false; }
            if (upstream != null) upstream.close();
            ctx.fireChannelInactive();
        }

        @Override public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            if (downstream == null) ctx.close(); else fail(cause);
        }

        private void fail(Throwable cause) {
            if (current == null) Log.d("EffeTuneNetwork", "Media relay failed", cause);
            finish(502);
        }

        private void finish(int status) {
            if (ended) return;
            ended = true;
            if (committed) { downstream.close(); return; }
            if (pwa && status == 502) { PwaNetworkHost.error(downstream, 400, "requestFailed"); return; }
            FullHttpResponse out = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.valueOf(status));
            if (current == null) cors(out);
            out.headers().set("Content-Length", 0);
            if (status == 204) out.headers().set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
                    .set("Access-Control-Allow-Headers", "Range, Accept");
            downstream.writeAndFlush(out).addListener(ChannelFutureListener.CLOSE);
        }
    }

    @Override public synchronized void close() {
        closed = true;
        targets.clear();
        redirects.shutdownNow();
        channels.close();
        loops.close();
    }

    private static boolean sameOrigin(URI a, URI b) {
        if (!a.getScheme().equalsIgnoreCase(b.getScheme()) || !a.getHost().equalsIgnoreCase(b.getHost())) return false;
        int defaultPort = "https".equalsIgnoreCase(a.getScheme()) ? 443 : 80;
        return (a.getPort() < 0 ? defaultPort : a.getPort()) == (b.getPort() < 0 ? defaultPort : b.getPort());
    }
}

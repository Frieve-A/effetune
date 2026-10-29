package com.frieve.effetune;

import android.net.Uri;
import android.content.Context;
import android.util.Log;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelOption;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.group.ChannelGroup;
import io.netty.channel.group.DefaultChannelGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.DefaultHttpResponse;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.handler.codec.http.HttpVersion;
import io.netty.handler.codec.http.HttpChunkedInput;
import io.netty.handler.stream.ChunkedStream;
import io.netty.handler.stream.ChunkedWriteHandler;
import io.netty.handler.codec.http.websocketx.CloseWebSocketFrame;
import io.netty.handler.codec.http.websocketx.PingWebSocketFrame;
import io.netty.handler.codec.http.websocketx.PongWebSocketFrame;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketFrameAggregator;
import io.netty.handler.codec.http.websocketx.WebSocketServerHandshaker;
import io.netty.handler.codec.http.websocketx.WebSocketServerHandshakerFactory;
import io.netty.handler.ssl.SslContext;
import io.netty.handler.ssl.SslContextBuilder;
import io.netty.handler.ssl.SslProvider;
import io.netty.handler.timeout.ReadTimeoutHandler;
import io.netty.util.concurrent.GlobalEventExecutor;
import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;

/** Opt-in, bounded remote-v1 transport. Protocol dispatch remains on Service control. */
final class RemoteControlServer implements AutoCloseable {
    interface Dispatch { void request(JSONObject request, Consumer<JSONObject> send, BooleanSupplier current); }
    private final NioEventLoopGroup boss = new NioEventLoopGroup(1);
    private final NioEventLoopGroup workers = new NioEventLoopGroup(1);
    private final ChannelGroup clients = new DefaultChannelGroup(GlobalEventExecutor.INSTANCE);
    private final AtomicInteger sockets = new AtomicInteger();
    private final String token;
    private final Dispatch dispatch;
    private final Context context;
    private Channel listener;
    private volatile long authorityGeneration;
    private volatile boolean closed;

    RemoteControlServer(Context context, int port, String token, String certificate, String privateKey, Dispatch dispatch) throws Exception {
        this.context = context;
        this.token = token; this.dispatch = dispatch;
        SslContext tls = null;
        if (!certificate.isEmpty() || !privateKey.isEmpty()) {
            if (certificate.isEmpty() || privateKey.isEmpty()) throw new IllegalArgumentException("Both TLS files are required");
            tls = SslContextBuilder.forServer(new ByteArrayInputStream(certificate.getBytes(StandardCharsets.US_ASCII)),
                    new ByteArrayInputStream(privateKey.getBytes(StandardCharsets.US_ASCII))).sslProvider(SslProvider.JDK).build();
        }
        final SslContext ssl = tls;
        try {
            listener = new ServerBootstrap().group(boss, workers).channel(NioServerSocketChannel.class)
                    .option(ChannelOption.SO_BACKLOG, 16).childOption(ChannelOption.TCP_NODELAY, true)
                    .childHandler(new ChannelInitializer<SocketChannel>() {
                        @Override protected void initChannel(SocketChannel channel) {
                            if (ssl != null) channel.pipeline().addLast(ssl.newHandler(channel.alloc()));
                            channel.pipeline().addLast("handshake-timeout", new ReadTimeoutHandler(10));
                            channel.pipeline().addLast(new HttpServerCodec(4096, 8192, 8192));
                            channel.pipeline().addLast(new HttpObjectAggregator(16384));
                            channel.pipeline().addLast(new ChunkedWriteHandler());
                            channel.pipeline().addLast(new Handler(ssl != null));
                        }
                    }).bind(port).sync().channel();
        } catch (Exception error) { close(); throw error; }
    }

    int port() { return ((InetSocketAddress) listener.localAddress()).getPort(); }
    int clientCount() { return clients.size(); }
    void broadcast(JSONObject value) {
        for (Channel channel : clients) if (channel.isWritable()) channel.writeAndFlush(new TextWebSocketFrame(value.toString()));
    }
    void rotate() { authorityGeneration++; for (Channel client : clients) client.writeAndFlush(new CloseWebSocketFrame(4401, "Token changed")).addListener(future -> client.close()); }

    private final class Handler extends SimpleChannelInboundHandler<Object> {
        private final boolean tls;
        private boolean counted;
        private boolean authenticated;
        Handler(boolean tls) { this.tls = tls; }
        @Override public void channelActive(ChannelHandlerContext context) {
            counted = true;
            if (sockets.incrementAndGet() > 32) context.close();
        }
        @Override public void channelInactive(ChannelHandlerContext context) {
            if (counted) sockets.decrementAndGet();
        }
        @Override protected void channelRead0(ChannelHandlerContext context, Object message) throws Exception {
            if (message instanceof FullHttpRequest) {
                FullHttpRequest request = (FullHttpRequest) message;
                if (authenticated || !request.decoderResult().isSuccess() || !request.method().name().equals("GET")) { context.close(); return; }
                if (!"websocket".equalsIgnoreCase(request.headers().get("Upgrade"))) { staticAsset(context, request); return; }
                String host = request.headers().get("Host", "");
                if (host.isEmpty() || host.contains("/") || host.contains("\\") || host.contains("@")) { context.close(); return; }
                String origin = request.headers().get("Origin");
                if (origin != null && !origin.equals((tls ? "https://" : "http://") + host) && !origin.equals(WebHostBridge.ORIGIN)) { context.close(); return; }
                Uri uri = Uri.parse(request.uri());
                String supplied = uri.getQueryParameter("t");
                boolean accepted = supplied != null && MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8));
                WebSocketServerHandshaker handshaker = new WebSocketServerHandshakerFactory((tls ? "wss://" : "ws://") + host + "/", null, false, 4 * 1024 * 1024).newHandshaker(request);
                if (handshaker == null) { WebSocketServerHandshakerFactory.sendUnsupportedVersionResponse(context.channel()); return; }
                handshaker.handshake(context.channel(), request).addListener(future -> {
                    if (!future.isSuccess()) { context.close(); return; }
                    if (!accepted) { context.writeAndFlush(new CloseWebSocketFrame(4401, "Authentication required")).addListener(done -> context.close()); return; }
                    if (clients.size() >= 16) { context.writeAndFlush(new CloseWebSocketFrame(1013, "Too many clients")).addListener(done -> context.close()); return; }
                    authenticated = true;
                    context.pipeline().remove("handshake-timeout");
                    context.pipeline().addBefore(context.name(), "message-limit", new WebSocketFrameAggregator(4 * 1024 * 1024));
                    clients.add(context.channel());
                });
            } else if (message instanceof WebSocketFrame) {
                if (!authenticated) { context.close(); return; }
                if (message instanceof PingWebSocketFrame) context.writeAndFlush(new PongWebSocketFrame(((WebSocketFrame) message).content().retain()));
                else if (message instanceof CloseWebSocketFrame) context.close();
                else if (message instanceof TextWebSocketFrame) {
                    JSONObject request;
                    try { request = new JSONObject(((TextWebSocketFrame) message).text()); }
                    catch (Exception error) { context.writeAndFlush(new CloseWebSocketFrame(1007, "Invalid JSON")).addListener(done -> context.close()); return; }
                    long generation = authorityGeneration;
                    dispatch.request(request, response -> {
                        if (context.channel().isActive() && context.channel().isWritable()) context.writeAndFlush(new TextWebSocketFrame(response.toString()));
                    }, () -> !closed && generation == authorityGeneration && context.channel().isActive());
                } else if (!(message instanceof PongWebSocketFrame)) context.writeAndFlush(new CloseWebSocketFrame(1003, "Text messages required")).addListener(done -> context.close());
            }
        }
        @Override public void exceptionCaught(ChannelHandlerContext context, Throwable error) {
            Log.d("EffeTuneRemote", "Remote connection closed", error); context.close();
        }
    }

    private void staticAsset(ChannelHandlerContext channel, FullHttpRequest request) throws Exception {
        String path = Uri.parse(request.uri()).getPath();
        if (path == null || path.equals("/")) path = "/remote.html";
        if (!path.startsWith("/") || path.contains("..") || path.contains("\\") || path.contains("\u0000")
                || !(path.equals("/remote.html") || path.startsWith("/js/") || path.startsWith("/css/") || path.startsWith("/plugins/") || path.startsWith("/images/") || path.startsWith("/presets/"))) { channel.close(); return; }
        java.io.InputStream input;
        try { input = context.getAssets().open("web" + path); }
        catch (java.io.IOException error) { channel.close(); return; }
        String type = path.endsWith(".js") || path.endsWith(".mjs") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".wasm") ? "application/wasm" : java.net.URLConnection.guessContentTypeFromName(path);
        DefaultHttpResponse response = new DefaultHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.OK);
        response.headers().set("Content-Type", type == null ? "application/octet-stream" : type);
        response.headers().set("Transfer-Encoding", "chunked").set("Cache-Control", "no-store").set("X-Content-Type-Options", "nosniff");
        channel.write(response);
        channel.writeAndFlush(new HttpChunkedInput(new ChunkedStream(input, 16384))).addListener(future -> channel.close());
    }

    @Override public void close() {
        if (closed) return;
        if (boss.next().inEventLoop() || workers.next().inEventLoop()) throw new IllegalStateException("Close remote transport on its control owner");
        closed = true; authorityGeneration++;
        if (listener != null) listener.close();
        clients.close();
        // The Service control owner has revoked requests. Release transport owners
        // before a replacement server or renderer can retain another set.
        boss.shutdownGracefully(0, 5, TimeUnit.SECONDS);
        workers.shutdownGracefully(0, 5, TimeUnit.SECONDS);
        boolean bossStopped = boss.terminationFuture().awaitUninterruptibly(5, TimeUnit.SECONDS);
        boolean workersStopped = workers.terminationFuture().awaitUninterruptibly(5, TimeUnit.SECONDS);
        if (!bossStopped || !workersStopped) Log.w("EffeTuneRemote", "Remote transport did not terminate within its shutdown deadline");
    }
}

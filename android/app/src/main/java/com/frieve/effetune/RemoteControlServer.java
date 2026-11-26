package com.frieve.effetune;

import android.net.Uri;
import android.content.Context;
import android.util.Base64;
import android.util.Log;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelOption;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.WriteBufferWaterMark;
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
import io.netty.util.AttributeKey;
import io.netty.util.concurrent.GlobalEventExecutor;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;

/** Opt-in, bounded remote-v1 transport. Protocol dispatch remains on Service control. */
final class RemoteControlServer implements AutoCloseable {
    @FunctionalInterface interface Dispatch {
        void request(JSONObject request, Consumer<JSONObject> send, BooleanSupplier current, BooleanSupplier writable);
        default RemotePairing pairing() { return null; }
        default void devicesChanged() {}
    }
    // IR transfer limits and per-client upload cap, as on the desktop host.
    static final int IR_CHUNK_BYTES = 512 * 1024;
    private static final int IR_MAX_BYTES = 64 * 1024 * 1024, IR_MAX_CHUNKS = IR_MAX_BYTES / IR_CHUNK_BYTES, MAX_UPLOADS_PER_CLIENT = 2;
    private static final AttributeKey<Boolean> SYNC = AttributeKey.valueOf("effetuneRemoteSync");
    private final File uploads;
    private final NioEventLoopGroup boss = new NioEventLoopGroup(1);
    private final NioEventLoopGroup workers = new NioEventLoopGroup(1);
    private final ChannelGroup clients = new DefaultChannelGroup(GlobalEventExecutor.INSTANCE);
    private final AtomicInteger sockets = new AtomicInteger();
    private final String token;
    private final RemotePairing pairing;
    private static final AttributeKey<JSONObject> DEVICE = AttributeKey.valueOf("effetuneRemoteDevice");
    private final Dispatch dispatch;
    volatile PwaNetworkHost pwa;
    private static final AttributeKey<Boolean> EFFECTS_ONLY = AttributeKey.valueOf("effetunePwaEffects");
    private final Context context;
    private Channel listener;
    private volatile long authorityGeneration;
    private volatile boolean closed;

    RemoteControlServer(Context context, int port, String token, String certificate, String privateKey, Dispatch dispatch) throws Exception {
        this.context = context;
        this.pairing = dispatch.pairing();
        this.token = token; this.dispatch = dispatch;
        // Uploads left by an earlier transport are never completed.
        uploads = new File(context.getCacheDir(), "remote-ir");
        File[] stale = uploads.listFiles();
        if (stale != null) for (File file : stale) file.delete();
        uploads.mkdirs();
        try {
            final SslContext ssl = validatedTls(certificate, privateKey, pairing == null ? "" : pairing.endpoint);
            listener = new ServerBootstrap().group(boss, workers).channel(NioServerSocketChannel.class)
                    .option(ChannelOption.SO_BACKLOG, 16).childOption(ChannelOption.TCP_NODELAY, true)
                    // State pushes are skipped and IR chunks wait above 8 MiB queued, as on the desktop host.
                    .childOption(ChannelOption.WRITE_BUFFER_WATER_MARK, new WriteBufferWaterMark(4 * 1024 * 1024, 8 * 1024 * 1024))
                    .childHandler(new ChannelInitializer<SocketChannel>() {
                        @Override protected void initChannel(SocketChannel channel) {
                            if (ssl != null) channel.pipeline().addLast(ssl.newHandler(channel.alloc()));
                            channel.pipeline().addLast("handshake-timeout", new ReadTimeoutHandler(10));
                            channel.pipeline().addLast(new HttpServerCodec(16384, 8192, 8192));
                            channel.pipeline().addLast("pwa-ingress", new PwaNetworkHost.Ingress(() -> pwa, ssl != null));
                            channel.pipeline().addLast(new HttpObjectAggregator(16384));
                            channel.pipeline().addLast(new ChunkedWriteHandler());
                            channel.pipeline().addLast(new Handler(ssl != null));
                        }
                    }).bind(port).sync().channel();
        } catch (Exception error) { close(); throw error; }
    }

    int port() { return ((InetSocketAddress) listener.localAddress()).getPort(); }
    private boolean serving() { return !closed && (pairing == null || pairing.serving()); }
    // Use the same Netty PEM reader for the settings check and the actual listener.
    private abstract static class Pem extends SslContext {
        static java.security.PrivateKey key(String pem) throws Exception {
            return toPrivateKey(new ByteArrayInputStream(pem.getBytes(StandardCharsets.US_ASCII)), null);
        }
        static java.security.cert.X509Certificate[] certificates(String pem) throws Exception {
            return toX509Certificates(new ByteArrayInputStream(pem.getBytes(StandardCharsets.US_ASCII)));
        }
    }

    static SslContext validatedTls(String cert, String key, String endpoint) throws AudioService.HostError {
        if (cert.isEmpty() && key.isEmpty() && endpoint.isEmpty()) return null;
        if (cert.isEmpty() || key.isEmpty()) throw AudioService.remoteError("missing-certificate");
        try {
            java.security.cert.X509Certificate[] chain = Pem.certificates(cert);
            java.security.PrivateKey privateKey = Pem.key(key);
            chain[0].checkValidity();
            if (!endpoint.isEmpty() && !coversHost(chain[0], java.net.URI.create(endpoint).getHost()))
                throw AudioService.remoteError("certificate-hostname");
            String algorithm = privateKey.getAlgorithm();
            String signature = switch (algorithm) {
                case "RSA" -> "SHA256withRSA";
                case "EC" -> "SHA256withECDSA";
                case "DSA" -> "SHA256withDSA";
                default -> algorithm;
            };
            java.security.Signature proof = java.security.Signature.getInstance(signature);
            byte[] challenge = new byte[32];
            new java.security.SecureRandom().nextBytes(challenge);
            proof.initSign(privateKey); proof.update(challenge);
            byte[] signed = proof.sign();
            proof.initVerify(chain[0]); proof.update(challenge);
            if (!proof.verify(signed)) throw AudioService.remoteError("invalid-certificate");
            return SslContextBuilder.forServer(privateKey, chain).sslProvider(SslProvider.JDK).build();
        } catch (java.security.cert.CertificateExpiredException | java.security.cert.CertificateNotYetValidException error) {
            throw AudioService.remoteError("certificate-expired");
        } catch (AudioService.HostError error) { throw error; }
        catch (Exception error) { throw AudioService.remoteError("invalid-certificate"); }
    }

    private static boolean coversHost(java.security.cert.X509Certificate cert, String hostname) throws Exception {
        String host = hostname.toLowerCase(Locale.ROOT);
        boolean ip = host.startsWith("[") || host.matches("[0-9.]+");
        java.util.Collection<java.util.List<?>> names = cert.getSubjectAlternativeNames();
        if (names == null) return false;
        for (java.util.List<?> name : names) {
            if (!(name.get(1) instanceof String value)) continue;
            if (ip && Integer.valueOf(7).equals(name.get(0)) &&
                    java.net.InetAddress.getByName(host).equals(java.net.InetAddress.getByName(value))) return true;
            if (!ip && Integer.valueOf(2).equals(name.get(0))) {
                String dns = value.toLowerCase(Locale.ROOT);
                if (host.equals(dns) || dns.startsWith("*.") && host.indexOf('.') > 0 &&
                        dns.substring(1).equals(host.substring(host.indexOf('.')))) return true;
            }
        }
        return false;
    }

    int clientCount() { return clients.size(); }
    org.json.JSONArray devices() {
        org.json.JSONArray result = new org.json.JSONArray();
        for (Channel channel : clients) {
            JSONObject device = channel.attr(DEVICE).get();
            if (device != null) result.put(device);
        }
        return result;
    }
    void broadcast(JSONObject value) {
        String full = value.toString(), effects = null;
        for (Channel ch : clients) if (ch.isWritable()) {
            boolean restricted = Boolean.TRUE.equals(ch.attr(EFFECTS_ONLY).get());
            if (restricted && effects == null) effects = effectsMessage(value);
            ch.writeAndFlush(new TextWebSocketFrame(restricted ? effects : full));
        }
    }

    static boolean musicOperation(String op) {
        return switch (op) {
            case "listMusicDevices", "browseMusic", "playMusic", "queueMusic", "getPlayback", "controlPlayback", "editPlaybackQueue" -> true;
            default -> false;
        };
    }

    private static String effectsMessage(JSONObject value) {
        org.json.JSONArray features = value.optJSONArray("features");
        if (features == null || !"state".equals(value.optString("op"))) return value.toString();
        org.json.JSONArray filtered = new org.json.JSONArray();
        for (int i = 0; i < features.length(); i++) if (!"music1".equals(features.optString(i))) filtered.put(features.opt(i));
        try {
            JSONObject state = new JSONObject();
            for (java.util.Iterator<String> keys = value.keys(); keys.hasNext();) {
                String key = keys.next();
                state.put(key, key.equals("features") ? filtered : value.get(key));
            }
            return state.toString();
        } catch (org.json.JSONException invalid) { throw new IllegalArgumentException(invalid); }
    }
    // presetsChanged and irsChanged go to clients that said hello with sync: 1.
    void broadcastSync(JSONObject value) {
        for (Channel channel : clients) if (Boolean.TRUE.equals(channel.attr(SYNC).get())) channel.writeAndFlush(new TextWebSocketFrame(value.toString()));
    }
    void rotate() {
        authorityGeneration++;
        PwaNetworkHost host = pwa;
        if (host != null) host.tokenChanged();
        for (Channel client : clients) client.writeAndFlush(new CloseWebSocketFrame(4401, "Token changed")).addListener(future -> client.close());
    }

    private final class Handler extends SimpleChannelInboundHandler<Object> {
        private final boolean tls;
        private boolean counted;
        private boolean pairingHttp;
        private boolean authenticated;
        private final HashMap<String, Upload> pending = new HashMap<>();
        Handler(boolean tls) { this.tls = tls; }
        @Override public void channelActive(ChannelHandlerContext context) {
            counted = true;
            if (sockets.incrementAndGet() > 32) context.close();
        }
        @Override public void channelInactive(ChannelHandlerContext context) {
            if (authenticated) { clients.remove(context.channel()); dispatch.devicesChanged(); }
            if (counted) sockets.decrementAndGet();
            for (Upload upload : pending.values()) upload.discard();
            pending.clear();
        }
        @Override protected void channelRead0(ChannelHandlerContext context, Object message) throws Exception {
            if (!serving() || pairingHttp) { context.close(); return; }
            if (message instanceof FullHttpRequest) {
                FullHttpRequest request = (FullHttpRequest) message;
                if (!authenticated && pairing != null && pairing.handle(context, request)) { pairingHttp = true; return; }
                if (authenticated || !request.decoderResult().isSuccess() || !request.method().name().equals("GET")) { context.close(); return; }
                if (!"websocket".equalsIgnoreCase(request.headers().get("Upgrade"))) { staticAsset(context, request); return; }
                String host = request.headers().get("Host", "");
                boolean effectsOnly = PwaNetworkHost.path(request).startsWith("/pwa/");
                PwaNetworkHost pwaHost = pwa;
                if (effectsOnly && (pwaHost == null || !pwaHost.allowedUpgrade(request))) {
                    context.writeAndFlush(new io.netty.handler.codec.http.DefaultFullHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.FORBIDDEN))
                            .addListener(done -> context.close()); return;
                }
                if (host.isEmpty() || host.contains("/") || host.contains("\\") || host.contains("@")) { context.close(); return; }
                String origin = request.headers().get("Origin");
                if (!effectsOnly && origin != null && !origin.equals((tls ? "https://" : "http://") + host) && !origin.equals(WebHostBridge.ORIGIN)) { context.close(); return; }
                Uri uri = Uri.parse(request.uri());
                String supplied = uri.getQueryParameter("t");
                boolean accepted = supplied != null && (MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8))
                        || (pairing != null && "/".equals(uri.getPath()) && pairing.accepts(supplied)));
                WebSocketServerHandshaker handshaker = new WebSocketServerHandshakerFactory((tls ? "wss://" : "ws://") + host + "/", null, false, 4 * 1024 * 1024).newHandshaker(request);
                if (handshaker == null) { WebSocketServerHandshakerFactory.sendUnsupportedVersionResponse(context.channel()); return; }
                handshaker.handshake(context.channel(), request).addListener(future -> {
                    if (!future.isSuccess()) { context.close(); return; }
                    if (!accepted || !serving()) { context.writeAndFlush(new CloseWebSocketFrame(4401, "Authentication required")).addListener(done -> context.close()); return; }
                    if (clients.size() >= 16) { context.writeAndFlush(new CloseWebSocketFrame(1013, "Too many clients")).addListener(done -> context.close()); return; }
                    authenticated = true;
                    context.channel().attr(EFFECTS_ONLY).set(effectsOnly);
                    context.pipeline().remove("handshake-timeout");
                    context.pipeline().addBefore(context.name(), "message-limit", new WebSocketFrameAggregator(4 * 1024 * 1024));
                    clients.add(context.channel());
                    updateDevice(context, new JSONObject());
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
                    boolean restricted = Boolean.TRUE.equals(context.channel().attr(EFFECTS_ONLY).get());
                    Consumer<JSONObject> send = response -> { if (context.channel().isActive()) context.writeAndFlush(new TextWebSocketFrame(restricted ? effectsMessage(response) : response.toString())); };
                    if (restricted && musicOperation(request.optString("op"))) { irAck(send, request.opt("seq"), "unauthorized"); return; }
                    if (request.optString("op").equals("hello")) context.channel().attr(SYNC).set(request.opt("sync") instanceof Number && ((Number) request.opt("sync")).doubleValue() == 1);
                    if ("hello".equals(request.optString("op"))) updateDevice(context, request);
                    if (request.optString("op").equals("putIR")) { request = receiveIrChunk(request, send); if (request == null) return; }
                    dispatch.request(request, send, () -> !closed && generation == authorityGeneration && context.channel().isActive(),
                            () -> !context.channel().isActive() || context.channel().isWritable());
                } else if (!(message instanceof PongWebSocketFrame)) context.writeAndFlush(new CloseWebSocketFrame(1003, "Text messages required")).addListener(done -> context.close());
            }
        }
        private void updateDevice(ChannelHandlerContext context, JSONObject hello) {
            String address = ((InetSocketAddress) context.channel().remoteAddress()).getAddress().getHostAddress();
            JSONObject device = AudioService.object("app", RemotePairing.clean(hello.opt("app")),
                    "version", RemotePairing.clean(hello.opt("version")), "address", address);
            context.channel().attr(DEVICE).set(device);
            dispatch.devicesChanged();
        }

        @Override public void exceptionCaught(ChannelHandlerContext context, Throwable error) {
            Log.d("EffeTuneRemote", "Remote connection closed: " + error.getClass().getSimpleName()); context.close();
        }

        // Assembles putIR chunks into a cache file with the desktop host's checks and replies. Returns the
        // request to dispatch once the last chunk arrives; every putIR frame stops here, so a client cannot name a file.
        private JSONObject receiveIrChunk(JSONObject message, Consumer<JSONObject> send) {
            Object seq = message.opt("seq"), id = message.opt("id");
            if (!(id instanceof String) || !((String) id).matches("[a-f0-9]{24}")) return irAck(send, seq, "invalid id");
            String error = storeIrChunk((String) id, message);
            if (error != null) {
                Upload failed = pending.remove(id);
                if (failed != null) failed.discard();
                return irAck(send, seq, error);
            }
            Upload upload = pending.get(id);
            if (upload.next < upload.total) return irAck(send, seq, null);
            pending.remove(id); upload.close();
            return AudioService.object("op", "putIR", "seq", seq, "id", id, "name", upload.name, "ext", upload.ext, "bytes", upload.bytes, "file", upload.file.getPath());
        }

        private String storeIrChunk(String id, JSONObject message) {
            int total = integer(message, "total", 1, IR_MAX_CHUNKS);
            if (total < 0) return "invalid total";
            int index = integer(message, "index", 0, total - 1);
            if (index < 0) return "invalid index";
            int bytes = integer(message, "bytes", 1, IR_MAX_BYTES);
            if (bytes < 0) return "invalid bytes";
            Object data = message.opt("data");
            if (!(data instanceof String) || ((String) data).length() > (IR_CHUNK_BYTES + 2) / 3 * 4 + 4) return "invalid data";
            byte[] part;
            try { part = Base64.decode((String) data, Base64.DEFAULT); } catch (IllegalArgumentException failure) { return "invalid data"; }
            if (part.length > IR_CHUNK_BYTES) return "chunk too large";
            if (index == 0) {
                String name = message.opt("name") instanceof String ? ((String) message.opt("name")).trim() : "";
                if (name.length() > 512) name = name.substring(0, 512);
                String ext = message.opt("ext") instanceof String ? ((String) message.opt("ext")).trim().replaceFirst("^\\.", "").toLowerCase(Locale.ROOT) : "";
                if (name.isEmpty()) return "name must be a non-empty string";
                if (!ext.matches("[a-z0-9]{1,10}")) return "invalid ext";
                Upload previous = pending.remove(id);
                if (previous != null) previous.discard();
                else if (pending.size() >= MAX_UPLOADS_PER_CLIENT) return "too many uploads";
                try { pending.put(id, new Upload(name, ext, total, bytes)); } catch (IOException failure) { return "upload unavailable"; }
            }
            Upload upload = pending.get(id);
            if (upload == null) return "upload not started (send index 0 first)";
            if (index != upload.next || total != upload.total || bytes != upload.bytes) return "chunk out of order";
            if (upload.received + part.length > upload.bytes) return "size mismatch";
            try { upload.output.write(part); } catch (IOException failure) { return "upload unavailable"; }
            upload.received += part.length; upload.next++;
            return upload.next == upload.total && upload.received != upload.bytes ? "size mismatch" : null;
        }
    }

    private static JSONObject irAck(Consumer<JSONObject> send, Object seq, String error) {
        if (seq != null) send.accept(AudioService.object("op", "ack", "seq", seq, "ok", error == null, "error", error));
        return null;
    }

    // An integer field within [min, max], or -1.
    private static int integer(JSONObject message, String key, int min, int max) {
        Object value = message.opt(key);
        if (!(value instanceof Integer) && !(value instanceof Long)) return -1;
        long number = ((Number) value).longValue();
        return number < min || number > max ? -1 : (int) number;
    }

    private final class Upload {
        final String name, ext;
        final int total, bytes;
        final File file;
        final FileOutputStream output;
        int received, next;
        Upload(String name, String ext, int total, int bytes) throws IOException {
            this.name = name; this.ext = ext; this.total = total; this.bytes = bytes;
            file = File.createTempFile("ir-upload", ".part", uploads);
            output = new FileOutputStream(file);
        }
        void close() { try { output.close(); } catch (IOException error) { Log.d("EffeTuneRemote", "Upload close failed", error); } }
        void discard() { close(); file.delete(); }
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
        PwaNetworkHost host = pwa;
        if (host != null) { host.close(); pwa = null; }
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

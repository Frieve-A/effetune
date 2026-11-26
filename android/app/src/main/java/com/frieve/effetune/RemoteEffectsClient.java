package com.frieve.effetune;

import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import io.netty.channel.*;
import io.netty.channel.socket.SocketChannel;
import io.netty.handler.codec.http.*;
import io.netty.handler.codec.http.websocketx.*;
import io.netty.handler.timeout.ReadTimeoutHandler;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.Executor;
import org.json.JSONObject;
import static com.frieve.effetune.AudioService.object;

/** The page selects a discovered player; only native code handles its approved URL. */
final class RemoteEffectsClient {
    static final int LIMIT = 4 * 1024 * 1024, PART = 65536;
    private final Handler control;
    private final AudioService.Events events;
    private final SharedPreferences saved;
    private final Executor connector;
    private Session pending, active;

    RemoteEffectsClient(Handler control, SharedPreferences saved, AudioService.Events events, Executor connector) {
        this.control = control;
        this.saved = saved;
        this.events = events;
        this.connector = connector;
    }

    static boolean localHost(String host) {
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        if (host.equals("localhost") || host.equals("[::1]") || host.matches("(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+local")) return true;
        if (!host.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}")) return false;
        String[] fields = host.split("\\.");
        for (String field : fields) if (Integer.parseInt(field) > 255 || (field.length() > 1 && field.startsWith("0"))) return false;
        int a = Integer.parseInt(fields[0]), b = Integer.parseInt(fields[1]);
        return a == 10 || a == 127 || a == 192 && b == 168 || a == 172 && b >= 16 && b <= 31 || a == 100 && b >= 64 && b <= 127;
    }

    static URI target(String input, boolean pairingLink) {
        if (input == null || input.length() > 2048) throw new IllegalArgumentException();
        URI uri = URI.create(input.trim());
        String scheme = String.valueOf(uri.getScheme()).toLowerCase(Locale.ROOT);
        if (pairingLink && (scheme.equals("ws") || scheme.equals("wss"))) scheme = scheme.equals("ws") ? "http" : "https";
        if (!(scheme.equals("http") || scheme.equals("https")) || !localHost(uri.getHost()) || uri.getPort() < 1 || uri.getPort() > 65535
                || uri.getPort() == (scheme.equals("https") ? 443 : 80)
                || uri.getUserInfo() != null || uri.getFragment() != null || !(uri.getPath().isEmpty() || uri.getRawPath().equals("/")))
            throw new IllegalArgumentException();
        String query = uri.getRawQuery();
        if (pairingLink ? query == null || !query.matches("t=[A-Za-z0-9_-]{4,64}") : query != null) throw new IllegalArgumentException();
        return URI.create(scheme + "://" + uri.getHost().toLowerCase(Locale.ROOT) + ":" + uri.getPort() + (pairingLink ? "/?" + query : ""));
    }

    private static boolean validId(String id) {
        return !id.isEmpty() && id.length() <= 512 && !id.equals("__proto__") && !id.equals("constructor") && !id.equals("prototype");
    }

    JSONObject command(String name, JSONObject args) throws Exception {
        String id = args.opt("playerId") instanceof String player ? player : "";
        String requestId = args.opt("requestId") instanceof String request ? request : "";
        String link = validId(id) ? saved.getString(id, null) : null;
        URI origin = null;
        if (validId(id)) try { origin = target(args.optString("origin"), false); } catch (IllegalArgumentException ignored) {}
        switch (name) {
            case "remoteClient.getConnection": return object("registered", link != null, "requestAvailable", origin != null);
            case "remoteClient.requestConnection": {
                if (!validId(id) || !requestId.matches("[A-Za-z0-9-]{1,80}") || args.has("replace") && !(args.opt("replace") instanceof Boolean))
                    return object("started", false, "status", "error");
                if (pending != null) pairResult(pending, "cancelled", null);
                if (link != null && !args.optBoolean("replace")) {
                    control.post(() -> pairEvent(requestId, "approved"));
                } else if (origin == null) {
                    control.post(() -> pairEvent(requestId, "unavailable"));
                } else {
                    pending = new Session(id, requestId, origin, true);
                    pending.start();
                }
                return object("started", true);
            }
            case "remoteClient.cancel": {
                boolean matched = pending != null && pending.id.equals(requestId);
                if (matched) pairResult(pending, "cancelled", null);
                return object("cancelled", matched);
            }
            case "remoteClient.connect": {
                if (active != null) finish(active, 1000);
                if (link == null) return object("ok", false);
                active = new Session(id, UUID.randomUUID().toString(), target(link, true), false);
                active.start();
                return object("ok", true, "connectionId", active.id);
            }
            case "remoteClient.disconnect":
                if (active != null && active.id.equals(args.optString("connectionId"))) finish(active, 1000);
                return object("ok", true);
            default: throw new IllegalArgumentException();
        }
    }

    void close() {
        if (pending != null) pairResult(pending, "cancelled", null);
        if (active != null) finish(active, 1000);
    }

    void send(JSONObject args, AudioService.Reply reply) {
        if (active == null || !active.id.equals(args.opt("connectionId")) || !active.send(args, reply))
            reply.complete(object("sent", false), null);
    }

    private void pairEvent(String id, String status) {
        events.send("remote-client-event", object("type", "pairResult", "requestId", id, "ok", status.equals("approved"), "status", status));
    }

    private void pairResult(Session session, String status, String token) {
        if (pending != session) return;
        pending = null;
        session.stop();
        if (token != null) saved.edit().putString(session.player, session.uri + "/?t=" + token).apply();
        pairEvent(session.id, status);
    }

    private void finish(Session session, int code) {
        if (active != session) return;
        active = null;
        session.stop();
        if (code == 4401 && session.uri.toString().equals(saved.getString(session.player, null))) saved.edit().remove(session.player).apply();
        events.send("remote-client-event", object("connectionId", session.id, "type", "close", "code", code));
    }

    private final class Session {
        final String player, id;
        final URI uri;
        final boolean pairing;
        final LanHttp.EventLoops loops = new LanHttp.EventLoops();
        volatile Channel channel;
        volatile boolean stopped;
        boolean opened;
        String uploadId, receiveId;
        StringBuilder upload;
        int uploadTotal, uploadBytes, received, queuedChars;
        final ArrayDeque<String> queue = new ArrayDeque<>();
        final Runnable deadline = () -> failed(true);

        Session(String player, String id, URI uri, boolean pairing) {
            this.player = player;
            this.id = id;
            this.uri = uri;
            this.pairing = pairing;
        }

        void start() {
            control.postDelayed(deadline, pairing ? 65000 : 10000);
            connector.execute(() -> {
                try {
                    if (stopped) return;
                    InetAddress peer = null;
                    for (InetAddress ip : InetAddress.getAllByName(uri.getHost())) {
                        if (ip.isLoopbackAddress() || localHost(ip.getHostAddress())) { peer = ip; break; }
                    }
                    if (stopped || peer == null) { control.post(() -> failed(false)); return; }
                    LanHttp.Target target = new LanHttp.Target(pairing ? uri.resolve(RemotePairing.PAIR) : uri, new InetSocketAddress(peer, uri.getPort()));
                    ChannelFuture connection = target.connect(loops.get(), pairing ? 65000 : 10000, new ChannelInitializer<SocketChannel>() {
                        @Override protected void initChannel(SocketChannel ch) {
                            if (pairing) installPairing(ch, target);
                            else installWebSocket(ch);
                        }
                    });
                    channel = connection.channel();
                    channel.closeFuture().addListener(done -> control.post(() -> failed(false)));
                    if (stopped) channel.close();
                } catch (Exception error) { control.post(() -> failed(false)); }
            });
        }

        void failed(boolean timeout) {
            if (pairing) pairResult(this, timeout ? "expired" : "unavailable", null);
            else finish(this, 1006);
        }

        void stop() {
            stopped = true;
            control.removeCallbacks(deadline);
            if (channel != null) channel.close();
            loops.close();
            queue.clear();
            upload = null;
        }

        private void installPairing(SocketChannel ch, LanHttp.Target target) {
            ch.pipeline().addLast(new HttpObjectAggregator(4096), new SimpleChannelInboundHandler<FullHttpResponse>() {
                @Override public void channelActive(ChannelHandlerContext ctx) throws Exception {
                    String body = object("playerId", player, "clientName", Build.MODEL).toString();
                    ctx.writeAndFlush(target.message("POST", object("Content-Type", "application/json", "X-EffeTune-Pairing", "1"), body))
                            .addListener(ChannelFutureListener.CLOSE_ON_FAILURE);
                }
                @Override protected void channelRead0(ChannelHandlerContext ctx, FullHttpResponse response) throws Exception {
                    JSONObject body = new JSONObject(response.content().toString(StandardCharsets.UTF_8));
                    String status = body.optString("status"), token = body.optString("token");
                    boolean ok = response.decoderResult().isSuccess() && response.status().code() == 200 && status.equals("approved")
                            && player.equals(body.opt("playerId")) && body.opt("token") instanceof String && token.matches("[A-Za-z0-9_-]{4,64}");
                    String result = ok ? "approved" : status.matches("denied|expired|busy|cancelled|unavailable") ? status : "unavailable";
                    control.post(() -> pairResult(Session.this, result, ok ? token : null));
                    ctx.close();
                }
                @Override public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) { ctx.close(); }
            });
        }

        private void installWebSocket(SocketChannel ch) {
            URI socket = URI.create("ws" + uri.toString().substring(4));
            WebSocketClientProtocolConfig config = WebSocketClientProtocolConfig.newBuilder().webSocketUri(socket)
                    .generateOriginHeader(false).maxFramePayloadLength(LIMIT).handleCloseFrames(false).handshakeTimeoutMillis(10000).build();
            ch.pipeline().addLast(new HttpObjectAggregator(16384), new WebSocketClientProtocolHandler(config),
                    new WebSocketFrameAggregator(LIMIT), new SimpleChannelInboundHandler<WebSocketFrame>() {
                @Override public void userEventTriggered(ChannelHandlerContext ctx, Object event) throws Exception {
                    if (event != WebSocketClientProtocolHandler.ClientHandshakeStateEvent.HANDSHAKE_COMPLETE) {
                        super.userEventTriggered(ctx, event); return;
                    }
                    ctx.pipeline().remove(ReadTimeoutHandler.class);
                    control.post(() -> {
                        if (active != Session.this) return;
                        opened = true;
                        control.removeCallbacks(deadline);
                        events.send("remote-client-event", object("connectionId", id, "type", "open"));
                    });
                }
                @Override protected void channelRead0(ChannelHandlerContext ctx, WebSocketFrame frame) {
                    if (frame instanceof CloseWebSocketFrame close) {
                        int code = close.statusCode();
                        control.post(() -> finish(Session.this, code));
                        ctx.close();
                    } else if (frame instanceof TextWebSocketFrame text) {
                        ch.config().setAutoRead(false);
                        String data = text.text();
                        control.post(() -> receive(data));
                    }
                }
                @Override public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) { ctx.close(); }
            });
        }

        void receive(String data) {
            if (active != this) return;
            if (queuedChars + data.length() > LIMIT) { finish(this, 1009); return; }
            queuedChars += data.length();
            queue.add(data);
            if (receiveId == null) emitParts();
        }

        private void emitParts() {
            while (!queue.isEmpty()) {
                String value = queue.element();
                if (value.length() > PART) {
                    if (receiveId == null) receiveId = UUID.randomUUID().toString();
                    int offset = received;
                    received = Math.min(value.length(), offset + PART);
                    if (received < value.length() && Character.isHighSurrogate(value.charAt(received - 1))) received--;
                    events.send("remote-client-event", object("connectionId", id, "type", "message", "messageId", receiveId,
                            "total", value.length(), "offset", offset, "data", value.substring(offset, received), "done", received == value.length()));
                    control.postDelayed(deadline, 30000);
                    return;
                }
                events.send("remote-client-event", object("connectionId", id, "type", "message", "data", value));
                queuedChars -= queue.remove().length();
            }
            if (channel != null) channel.config().setAutoRead(true);
        }

        boolean send(JSONObject args, AudioService.Reply reply) {
            if (!opened || channel == null || !channel.isActive()) return false;
            if (args.has("received")) {
                if (receiveId == null || !receiveId.equals(args.opt("messageId")) || received != args.optInt("received", -1)) return false;
                control.removeCallbacks(deadline);
                if (received == queue.element().length()) {
                    queuedChars -= queue.remove().length();
                    received = 0;
                    receiveId = null;
                }
                emitParts();
                reply.complete(object("sent", true), null);
                return true;
            }
            if (!(args.opt("data") instanceof String data) || data.length() > PART) return false;
            if (args.has("messageId")) {
                String message = args.optString("messageId");
                int offset = args.optInt("offset", -1), total = args.optInt("total", -1);
                if (offset == 0 && total > 0 && total <= LIMIT && message.matches("[A-Za-z0-9-]{1,80}")) {
                    upload = new StringBuilder(); uploadTotal = total; uploadBytes = 0; uploadId = message;
                }
                if (upload == null || !message.equals(uploadId) || total != uploadTotal || offset != upload.length()
                        || data.isEmpty() || offset + data.length() > total || args.optBoolean("done") != (offset + data.length() == total)) {
                    upload = null; return false;
                }
                uploadBytes += io.netty.buffer.ByteBufUtil.utf8Bytes(data);
                if (uploadBytes > LIMIT || (offset + data.length() < total && Character.isHighSurrogate(data.charAt(data.length() - 1)))) {
                    upload = null; return false;
                }
                upload.append(data);
                if (upload.length() < total) { reply.complete(object("sent", true), null); return true; }
                data = upload.toString();
                upload = null;
            } else if (upload != null) return false;
            if (!channel.isWritable()) return false;
            channel.writeAndFlush(new TextWebSocketFrame(data)).addListener(ChannelFutureListener.CLOSE_ON_FAILURE)
                    .addListener(done -> reply.complete(object("sent", done.isSuccess()), null));
            return true;
        }
    }
}

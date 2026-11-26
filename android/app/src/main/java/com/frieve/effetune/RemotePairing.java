package com.frieve.effetune;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.SystemClock;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelFutureListener;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.DefaultFullHttpResponse;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.handler.codec.http.HttpVersion;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import org.json.JSONObject;

import static com.frieve.effetune.AudioService.object;

/** One approval belongs to the original HTTP channel and the lifetime of one listener. */
final class RemotePairing {
    static final String DESCRIPTION = "/.well-known/effetune/remote-control.xml";
    static final String PAIR = "/.well-known/effetune/pair";
    static final String SERVICE = "urn:effetune-org:service:RemoteControl:1";
    final String playerId, udn, endpoint;
    private final Handler control;
    private final AudioService.Events events;
    private final BooleanSupplier visible;
    private final Supplier<String> newToken;
    private final SharedPreferences credentials;
    private final String generation;
    private final String friendlyName;
    private volatile boolean serving;
    private Pending pending;
    private long nextPrompt;
    private record Pending(String id, ChannelHandlerContext channel, long deadline) {}
    private final Runnable expire = () -> end("expired", null);

    RemotePairing(Context context, Handler control, AudioService.Events events, BooleanSupplier visible,
                  Supplier<String> newToken, String token, String endpoint, String name) {
        this.control = control;
        this.events = events;
        this.visible = visible;
        this.newToken = newToken;
        this.endpoint = endpoint;
        friendlyName = android.text.TextUtils.htmlEncode(clean(name));
        credentials = context.getSharedPreferences("remote-issued", Context.MODE_PRIVATE);
        generation = digest(token);
        playerId = playerId(context);
        udn = "uuid:" + UUID.nameUUIDFromBytes((SERVICE + playerId).getBytes(StandardCharsets.UTF_8));
    }

    static String playerId(Context context) {
        SharedPreferences audio = context.getSharedPreferences("audio", Context.MODE_PRIVATE);
        String id = audio.getString("openHomeDeviceId", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            audio.edit().putString("openHomeDeviceId", id).apply();
        }
        return "uuid:" + UUID.fromString(id);
    }

    private static String digest(String value) {
        try {
            return android.util.Base64.encodeToString(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)), android.util.Base64.NO_WRAP);
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }

    boolean accepts(String token) {
        return serving && token != null && token.length() <= 64 && generation.equals(credentials.getString(digest(token), null));
    }

    boolean serving() { return serving; }
    void start() { serving = true; }

    boolean handle(ChannelHandlerContext channel, FullHttpRequest request) {
        String path = PwaNetworkHost.path(request);
        if (!DESCRIPTION.equals(path) && !PAIR.equals(path)) return false;
        InetSocketAddress peer = (InetSocketAddress) channel.channel().remoteAddress();
        if (!serving || !request.decoderResult().isSuccess() || !NetworkStreamServer.lan(peer.getAddress())
                || request.headers().getAll("Host").size() != 1 || !PwaNetworkHost.allowedHost(request.headers().get("Host"), endpoint)) {
            status(channel, 403, "unavailable"); return true;
        }
        if (DESCRIPTION.equals(path)) {
            if (!request.method().name().equals("GET")) status(channel, 405, "unavailable");
            else reply(channel, 200, "text/xml; charset=utf-8",
                    "<?xml version=\"1.0\"?><root xmlns=\"urn:schemas-upnp-org:device-1-0\" xmlns:effetune=\"urn:effetune-org:remote-control\"><device>"
                    + "<deviceType>urn:effetune-org:device:RemoteControl:1</deviceType><friendlyName>" + friendlyName + "</friendlyName><manufacturer>EffeTune</manufacturer>"
                    + "<UDN>" + udn + "</UDN><effetune:playerId>" + playerId + "</effetune:playerId><serviceList><service><serviceType>" + SERVICE
                    + "</serviceType><controlURL>" + PAIR + "</controlURL></service></serviceList></device></root>");
            return true;
        }
        if (!request.method().name().equals("POST") || request.headers().contains("Origin")
                || request.headers().names().stream().anyMatch(key -> key.toLowerCase(Locale.ROOT).startsWith("sec-fetch-"))
                || !request.headers().getAll("X-EffeTune-Pairing").equals(Arrays.asList("1"))
                || !request.headers().getAll("Content-Type").equals(Arrays.asList("application/json"))) {
            status(channel, 403, "unavailable"); return true;
        }
        try {
            if (request.content().readableBytes() > 2048) { status(channel, 200, "error"); return true; }
            JSONObject body = new JSONObject(request.content().toString(StandardCharsets.UTF_8));
            if (!playerId.equals(body.opt("playerId"))) { status(channel, 200, "unavailable"); return true; }
            String name = clean(body.opt("clientName"));
            if (channel.pipeline().get("handshake-timeout") != null) channel.pipeline().remove("handshake-timeout");
            control.post(() -> begin(channel, name, peer.getAddress().getHostAddress()));
        } catch (org.json.JSONException error) { status(channel, 200, "error"); }
        return true;
    }

    static String clean(Object value) {
        if (!(value instanceof String)) return "";
        String text = ((String) value).replaceAll("[\\p{Cc}\\p{Cf}]", "").trim();
        return text.substring(0, Math.min(80, text.length()));
    }

    private void begin(ChannelHandlerContext channel, String name, String address) {
        if (!serving || !visible.getAsBoolean() || !channel.channel().isActive()) { status(channel, 200, "unavailable"); return; }
        long now = SystemClock.elapsedRealtime();
        if (pending != null || now < nextPrompt) { status(channel, 409, "busy"); return; }
        Pending request = new Pending(UUID.randomUUID().toString(), channel, now + 60000);
        pending = request;
        nextPrompt = now + 5000;
        channel.channel().closeFuture().addListener(done -> control.post(() -> {
            if (pending == request) end("cancelled", null);
        }));
        control.postDelayed(expire, 60000);
        events.send("pairing-request", object("requestId", request.id, "clientName", name, "address", address));
    }

    boolean decide(String id, boolean allow) {
        if (pending == null || !pending.id.equals(id)) return false;
        if (SystemClock.elapsedRealtime() >= pending.deadline) { end("expired", null); return false; }
        if (!serving || !visible.getAsBoolean() || !pending.channel.channel().isActive()) {
            unavailable(); return false;
        }
        String token = allow ? newToken.get() : null;
        if (allow) credentials.edit().putString(digest(token), generation).apply();
        end(allow ? "approved" : "denied", token);
        return true;
    }

    void unavailable() { end("unavailable", null); }
    void close() { serving = false; unavailable(); }

    private void end(String status, String token) {
        if (pending == null) return;
        Pending request = pending;
        pending = null;
        control.removeCallbacks(expire);
        reply(request.channel, 200, "application/json", object("status", status, "token", token,
                "playerId", token == null ? null : playerId).toString());
        events.send("pairing-ended", object("requestId", request.id, "status", status));
    }

    private static void status(ChannelHandlerContext channel, int code, String status) {
        reply(channel, code, "application/json", object("status", status).toString());
    }

    private static void reply(ChannelHandlerContext channel, int code, String type, String body) {
        if (!channel.channel().isActive()) return;
        DefaultFullHttpResponse response = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.valueOf(code),
                Unpooled.copiedBuffer(body, StandardCharsets.UTF_8));
        response.headers().set("Content-Type", type).setInt("Content-Length", response.content().readableBytes())
                .set("Cache-Control", "no-store").set("X-Content-Type-Options", "nosniff").set("Connection", "close");
        channel.writeAndFlush(response).addListener(ChannelFutureListener.CLOSE);
    }
}

package com.frieve.effetune;

import android.content.Context;
import android.os.Handler;
import android.os.SystemClock;
import android.util.Base64;
import android.util.JsonReader;
import android.util.JsonToken;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.handler.codec.http.*;
import io.netty.util.ReferenceCountUtil;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;
import static com.frieve.effetune.AudioService.object;

/** One authorization owner per listening remote transport. No listener or periodic task of its own. */
final class PwaNetworkHost implements AutoCloseable {
    static final String PREFIX = "/pwa/v1/";
    private static final int BODY_LIMIT = 16 * 1024 * 1024, PART = 512 * 1024;
    private static final Pattern LOCAL_ORIGIN = Pattern.compile("http://(?:localhost|127\\.0\\.0\\.1)(?::(0|[1-9][0-9]{0,4}))?");
    private static final Pattern HOST = Pattern.compile("(localhost|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+local|\\[[a-f0-9:.]+\\]|(?:[0-9]{1,3}\\.){3}[0-9]{1,3})(?::([0-9]{1,5}))?");
    private static final Pattern RESOURCE = Pattern.compile("(media|artwork|grant)/([A-Za-z0-9_-]{32,8192})");
    private static final Pattern SHARED_TRACK = Pattern.compile("track:([A-Za-z0-9_-]{32})(?::[A-Za-z0-9_-]{18})?");
    private static final byte[] EMPTY = new byte[0];
    private static final SecureRandom RANDOM = new SecureRandom();
    private final Handler control;
    private final AudioService.Events events;
    private final Context app;
    private final LibraryShareServer share;
    private final MediaGateway gateway;
    private final BooleanSupplier pageReady;
    private final String endpoint;
    private final String playerId;
    private final byte[] bearer;
    private final Map<String, Pending> requests = new HashMap<>();
    private final Grants grants = new Grants();
    private PlayerGrants playerGrants;
    private final Set<Channel> streams = new HashSet<>();
    final Runnable sourceChanged = this::revoke; // package-private so tests can unregister it
    private volatile boolean closed;
    private boolean tokenChanged;
    private volatile long generation;
    private boolean libraries, players;

    PwaNetworkHost(Context app, Handler control, AudioService.Events events, BooleanSupplier pageReady,
                   LibraryShareServer share, MediaGateway gateway, String token, String endpoint,
                   String playerId, boolean libraries, boolean players) {
        this.app = app;
        this.control = control;
        this.events = events;
        this.pageReady = pageReady;
        this.share = share;
        this.gateway = gateway;
        this.endpoint = endpoint;
        this.playerId = playerId;
        bearer = ("Bearer " + token).getBytes(StandardCharsets.UTF_8);
        this.libraries = libraries;
        this.players = players;
        SubsonicHost.watchSources(sourceChanged);
    }

    static boolean allowedOrigin(String origin) {
        if ("https://effetune.frieve.com".equals(origin)) return true;
        Matcher match = LOCAL_ORIGIN.matcher(origin == null ? "" : origin);
        if (!match.matches()) return false;
        String port = match.group(1);
        return port == null || (!port.equals("80") && Integer.parseInt(port) <= 65535);
    }

    static boolean allowedHost(String header, String endpoint) {
        if (header == null || header.isEmpty() || header.length() > 270) return false;
        String value = header.toLowerCase(Locale.ROOT);
        if (!endpoint.isEmpty()) {
            URI configured = URI.create(endpoint);
            if ("https".equals(configured.getScheme()) && (value.equalsIgnoreCase(configured.getRawAuthority()) ||
                    (configured.getPort() == -1 && value.equalsIgnoreCase(configured.getHost() + ":443")))) return true;
        }
        Matcher match = HOST.matcher(value);
        if (!match.matches() || (match.group(2) != null && Integer.parseInt(match.group(2)) > 65535)) return false;
        String host = match.group(1);
        if (Character.isDigit(host.charAt(0)) && !host.endsWith(".local"))
            for (String octet : host.split("\\.")) if (Integer.parseInt(octet) > 255) return false;
        return true;
    }

    boolean allowedUpgrade(HttpRequest req) {
        return !closed && path(req).equals(PREFIX + "effects") && allowedHost(req.headers().get("Host"), endpoint)
                && req.headers().getAll("Origin").size() == 1 && allowedOrigin(req.headers().get("Origin"));
    }

    static String path(HttpRequest req) {
        String uri = req.uri();
        int query = uri.indexOf('?');
        return query < 0 ? uri : uri.substring(0, query);
    }

    // Select the authenticated PWA body limit before the ordinary 16 KiB HTTP aggregator.
    static final class Ingress extends ChannelInboundHandlerAdapter {
        private final Supplier<PwaNetworkHost> owner;
        private final boolean tls;
        private boolean consumed;
        private boolean discard;
        Ingress(Supplier<PwaNetworkHost> owner, boolean tls) { this.owner = owner; this.tls = tls; }

        @Override public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
            if (consumed && msg instanceof HttpRequest) { ReferenceCountUtil.release(msg); ctx.close(); return; }
            if (discard) { ReferenceCountUtil.release(msg); return; }
            if (!(msg instanceof HttpRequest req)) { ctx.fireChannelRead(msg); return; }
            if (!path(req).startsWith(PREFIX)) {
                // Preserve the legacy request-line limit; PWA grant paths may contain 8192 characters.
                int line = req.method().name().length() + req.uri().length() + req.protocolVersion().text().length() + 2;
                if (line > 4096) { ReferenceCountUtil.release(msg); ctx.close(); } else ctx.fireChannelRead(msg);
                return;
            }
            if ("websocket".equalsIgnoreCase(req.headers().get("Upgrade"))) { ctx.fireChannelRead(msg); return; }
            consumed = true;
            PwaNetworkHost host = owner.get();
            if (host == null || !req.decoderResult().isSuccess()) { ReferenceCountUtil.release(msg); ctx.close(); return; }
            long epoch = host.generation;
            if (!host.headers(ctx.channel(), req)) { discard = true; ReferenceCountUtil.release(msg); return; }
            ScheduledFuture<?> bodyDeadline = ctx.executor().schedule((Runnable) () -> ctx.close(), 10, TimeUnit.SECONDS);
            ctx.channel().closeFuture().addListener(done -> bodyDeadline.cancel(false));
            ctx.pipeline().replace(HttpObjectAggregator.class, "pwa-body", new HttpObjectAggregator(BODY_LIMIT) {
                @Override protected void handleOversizedMessage(ChannelHandlerContext context, HttpMessage oversized) {
                    error(context.channel(), 400, "invalidRequest");
                }
            });
            ctx.pipeline().addAfter("pwa-body", "pwa-request", new SimpleChannelInboundHandler<FullHttpRequest>() {
                @Override protected void channelRead0(ChannelHandlerContext context, FullHttpRequest full) {
                    bodyDeadline.cancel(false);
                    if (context.pipeline().get("handshake-timeout") != null) context.pipeline().remove("handshake-timeout");
                    host.receive(context.channel(), full, tls, epoch);
                }
            });
            ctx.fireChannelRead(msg);
        }
    }

    private static void addCors(Channel ch, String origin) {
        ch.pipeline().addAfter(ch.pipeline().context(HttpServerCodec.class).name(), "pwa-cors", new ChannelOutboundHandlerAdapter() {
            @Override public void write(ChannelHandlerContext ctx, Object msg, ChannelPromise promise) throws Exception {
                if (msg instanceof HttpResponse res) res.headers().set("Access-Control-Allow-Origin", origin)
                        .set("Vary", "Origin").set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
                ctx.write(msg, promise);
            }
        });
    }

    private boolean headers(Channel ch, HttpRequest req) {
        if (!allowedHost(req.headers().get("Host"), endpoint)) {
            reply(ch, 403, null, "Forbidden\n".getBytes(StandardCharsets.UTF_8)); return false;
        }
        String origin = req.headers().get("Origin");
        if (closed || req.headers().getAll("Origin").size() != 1 || !allowedOrigin(origin)) { error(ch, 403, "forbidden"); return false; }
        addCors(ch, origin);
        if (req.method().equals(HttpMethod.OPTIONS)) {
            String method = req.headers().get("Access-Control-Request-Method", "");
            boolean valid = method.equals("GET") || method.equals("HEAD") || method.equals("POST");
            String fields = String.join(",", req.headers().getAll("Access-Control-Request-Headers"));
            for (String field : fields.toLowerCase(Locale.ROOT).split(",")) {
                String header = field.trim();
                if (!header.isEmpty() && !header.equals("authorization") && !header.equals("content-type") && !header.equals("range")) valid = false;
            }
            FullHttpResponse out = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.valueOf(valid ? 204 : 403));
            if (valid) {
                out.headers().set("Access-Control-Allow-Methods", "GET, HEAD, POST").set("Access-Control-Allow-Headers", "Authorization, Content-Type, Range")
                        .set("Access-Control-Max-Age", "600");
                if ("true".equals(req.headers().get("Access-Control-Request-Private-Network")))
                    out.headers().set("Access-Control-Allow-Private-Network", "true");
            }
            out.headers().set("Content-Length", 0);
            ch.writeAndFlush(out).addListener(ChannelFutureListener.CLOSE);
            return false;
        }
        Matcher resource = RESOURCE.matcher(path(req).substring(PREFIX.length()));
        ch.pipeline().addAfter("pwa-cors", "pwa-write-timeout", new io.netty.handler.timeout.WriteTimeoutHandler(30));
        if (resource.matches()) {
            if (resource.group(1).equals("grant")) reply(ch, 404, null, EMPTY);
            else if (!(HttpMethod.GET.equals(req.method()) || HttpMethod.HEAD.equals(req.method()))) reply(ch, 405, null, EMPTY);
            else {
                ch.pipeline().remove("handshake-timeout");
                serve(ch, resource.group(2), resource.group(1).equals("artwork"), HttpMethod.HEAD.equals(req.method()), req.headers().get("Range"));
            }
            return false;
        }
        if (!MessageDigest.isEqual(bearer, req.headers().get("Authorization", "").getBytes(StandardCharsets.UTF_8))) {
            error(ch, 401, "unauthorized"); return false;
        }
        if (HttpMethod.POST.equals(req.method()) && !"application/json".equals(req.headers().get("Content-Type", "").split(";", -1)[0])) {
            error(ch, 400, "invalidRequest"); return false;
        }
        if (HttpUtil.getContentLength(req, -1L) > BODY_LIMIT) { error(ch, 400, "invalidRequest"); return false; }
        return true;
    }

    private static void reply(Channel ch, int status, String type, byte[] body) {
        FullHttpResponse out = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.valueOf(status), Unpooled.wrappedBuffer(body));
        out.headers().set("Content-Length", body.length).set("Connection", "close");
        if (type != null) out.headers().set("Content-Type", type).set("Cache-Control", "no-store");
        ch.writeAndFlush(out).addListener(ChannelFutureListener.CLOSE);
    }

    static void error(Channel ch, int status, String code) {
        reply(ch, status, "application/json", object("error", object("code", code)).toString().getBytes(StandardCharsets.UTF_8));
    }

    private static final class Pending {
        final String id = UUID.randomUUID().toString(), base;
        final Channel channel;
        final byte[] body;
        final long deadline;
        final boolean localPlayer;
        ScheduledFuture<?> timer;
        int read, written, total, status;
        boolean sent;
        Pending(Channel ch, String base, byte[] body, boolean localPlayer, int seconds) {
            channel = ch; this.base = base; this.body = body; this.localPlayer = localPlayer;
            deadline = SystemClock.elapsedRealtime() + seconds * 1000L;
        }
        boolean current() { return channel.isActive() && (written != 0 || SystemClock.elapsedRealtime() < deadline); }
    }

    private void receive(Channel ch, FullHttpRequest req, boolean tls, long epoch) {
        String route = path(req).substring(PREFIX.length()), method = req.method().name();
        byte[] bytes = EMPTY;
        JSONObject body = new JSONObject();
        String requestedPlayer = "", requestedServer = "";
        boolean catalogItems = false;
        if (method.equals("POST")) {
            bytes = new byte[req.content().readableBytes()];
            req.content().getBytes(req.content().readerIndex(), bytes);
            try (JsonReader reader = new JsonReader(new InputStreamReader(new ByteArrayInputStream(bytes), StandardCharsets.UTF_8))) {
                if (reader.peek() != JsonToken.BEGIN_OBJECT) { error(ch, 400, "invalidRequest"); return; }
                reader.beginObject();
                while (reader.hasNext()) {
                    String key = reader.nextName();
                    if (key.equals("playerId") && reader.peek() == JsonToken.STRING) requestedPlayer = reader.nextString();
                    else if (key.equals("serverId") && reader.peek() == JsonToken.STRING) requestedServer = reader.nextString();
                    else {
                        if (key.equals("items")) catalogItems = true;
                        reader.skipValue();
                    }
                }
                reader.endObject();
                if (reader.peek() != JsonToken.END_DOCUMENT) { error(ch, 400, "requestFailed"); return; }
                body = bytes.length > PART / 4 ? null : new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            } catch (Exception invalid) { error(ch, 400, "requestFailed"); return; }
        }
        if (!(method.equals("GET") && (route.equals("info") || route.equals("player")) ||
                method.equals("POST") && (route.equals("browse") || route.equals("resolve") || route.equals("player")))) { error(ch, 404, "unsupported"); return; }
        if (method.equals("GET") && route.equals("player")) {
            String query = android.net.Uri.parse(req.uri()).getQueryParameter("playerId");
            if (query != null) { requestedPlayer = query; body = object("playerId", query); }
        }
        String base = endpoint.isEmpty() ? (tls ? "https://" : "http://") + req.headers().get("Host") : endpoint;
        boolean localPlayer = route.equals("player") && (requestedPlayer.isEmpty() || playerId.equals(requestedPlayer));
        int seconds = localPlayer && catalogItems ? 120 : 10;
        Pending p = new Pending(ch, base, body == null ? bytes : EMPTY, localPlayer, seconds);
        JSONObject event = object("requestId", p.id, "playerId", playerId, "baseOrigin", base, "route", route, "method", method,
                "body", body == null ? JSONObject.NULL : body, "bodyBytes", body == null ? bytes.length : null);
        synchronized (this) {
            if (closed || epoch != generation) { error(ch, tokenChanged ? 401 : 403, tokenChanged ? "unauthorized" : "forbidden"); return; }
            if ((route.equals("player") && !localPlayer && !players) || ((route.equals("browse") || route.equals("resolve"))
                    && !requestedServer.isEmpty() && !requestedServer.equals(share.pwaLibraryId()) && !libraries)) {
                error(ch, 403, "forbidden"); return;
            }
            if (requests.size() >= 32 || (localPlayer && requests.values().stream().filter(entry -> entry.localPlayer).count() >= 16)) {
                error(ch, 400, "busy"); return;
            }
            requests.put(p.id, p);
            p.timer = ch.eventLoop().schedule(() -> {
                synchronized (this) {
                    if (p.written == 0) cancel(p, localPlayer ? "action-timeout" : "timeout");
                }
            }, seconds, TimeUnit.SECONDS);
            ch.closeFuture().addListener(done -> cancel(p, "unavailable"));
        }
        control.post(() -> {
            synchronized (this) {
                if (requests.get(p.id) != p) return;
                if (!p.current() || !pageReady.getAsBoolean()) { cancel(p, "renderer-unavailable"); return; }
                p.sent = true;
                events.send("pwa-request", event);
            }
        });
    }

    void command(String name, JSONObject args, AudioService.Reply reply) throws Exception {
        if (name.equals("pwa.issueGrant")) reply.complete(issue(args), null);
        else responseCommand(name, args, reply);
    }

    private synchronized void responseCommand(String name, JSONObject args, AudioService.Reply reply) throws Exception {
        String id = args.getString("requestId");
        Pending p = requests.get(id);
        if (!current(id)) {
            if (name.equals("pwa.respond") || name.equals("pwa.respondPart")) { reply.complete(object("accepted", false), null); return; }
            throw denied();
        }
        switch (name) {
            case "pwa.readBody" -> {
                int offset = args.getInt("offset");
                if (offset != p.read || offset >= p.body.length) throw denied();
                int length = Math.min(PART, p.body.length - offset);
                p.read += length;
                reply.complete(object("data", Base64.encodeToString(p.body, offset, length, Base64.NO_WRAP),
                        "nextOffset", p.read, "done", p.read == p.body.length), null);
            }
            case "pwa.respond" -> {
                int status = args.getInt("status");
                byte[] data = args.getJSONObject("body").toString().getBytes(StandardCharsets.UTF_8);
                if (p.written != 0 || !responseStatus(status)) throw denied();
                remove(p);
                reply(p.channel, status, "application/json", data);
                reply.complete(object("accepted", true), null);
            }
            case "pwa.respondPart" -> respondPart(p, args, reply);
            default -> throw denied();
        }
    }

    private static boolean responseStatus(int status) { return status >= 200 && status <= 599; }

    // Acknowledge only after the downstream write. A stalled client cannot queue a whole response in Netty.
    private void respondPart(Pending p, JSONObject args, AudioService.Reply reply) throws Exception {
        int offset = args.getInt("offset"), total = args.getInt("total"), status = args.getInt("status");
        String encoded = args.getString("data");
        if (!responseStatus(status) || total < 1 || total > BODY_LIMIT || offset != p.written
                || encoded.length() > 4 * ((PART + 2) / 3)) throw denied();
        byte[] data = Base64.decode(encoded, Base64.DEFAULT);
        boolean done = args.getBoolean("done");
        if (data.length == 0 || data.length > PART || offset + data.length > total || done != (offset + data.length == total)) throw denied();
        if (offset == 0) {
            p.timer.cancel(false);
            p.total = total;
            p.status = status;
            HttpResponse out = new DefaultHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.valueOf(status));
            out.headers().set("Content-Length", total).set("Content-Type", "application/json").set("Cache-Control", "no-store").set("Connection", "close");
            p.channel.write(out);
        } else if (p.total != total || p.status != status) throw denied();
        p.written += data.length;
        ChannelFuture write = p.channel.writeAndFlush(done ? new DefaultLastHttpContent(Unpooled.wrappedBuffer(data))
                : new DefaultHttpContent(Unpooled.wrappedBuffer(data)));
        write.addListener((ChannelFutureListener) result -> {
            synchronized (this) {
                boolean accepted = result.isSuccess() && current(p.id);
                if (accepted && done) remove(p);
                if (!accepted || done) p.channel.close();
                reply.complete(object("accepted", accepted), null);
            }
        });
    }

    static AudioService.HostError denied() {
        return new AudioService.HostError("forbidden", "Remote access changed. Reconnect and try again.");
    }

    record Grant(String server, String track, String media, String art, String address, String format, long expires, boolean local) {
        boolean alive(long now) { return now < expires; }

        LanHttp.Target resolve(Context app, boolean artwork) throws Exception {
            boolean saved = server.startsWith("subsonic:");
            String uri = saved ? SubsonicHost.pwaResource(app, server, track, art, format, artwork) : artwork ? art : media;
            return LanHttp.Target.resolve(uri, saved ? null : address, saved);
        }
    }

    static final class Grants {
        private record Expiring(String key, String sourceToken) {}
        private final Map<String, Grant> byKey = new HashMap<>();
        private final Map<String, String> bySourceToken = new HashMap<>();
        private final Deque<Expiring> expiring = new ArrayDeque<>();

        private void expire(long now) {
            while (!expiring.isEmpty() && !byKey.get(expiring.peek().key).alive(now)) {
                Expiring entry = expiring.remove();
                byKey.remove(entry.key);
                if (entry.sourceToken != null) bySourceToken.remove(entry.sourceToken);
            }
        }

        String issue(Grant grant, long now) {
            return issue(grant, now, grant.local ? grant.media : null);
        }

        String issue(Grant grant, long now, String sourceToken) {
            expire(now);
            String key = bySourceToken.get(sourceToken);
            if (key != null) return key;
            byte[] secret = new byte[24];
            RANDOM.nextBytes(secret);
            key = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
            byKey.put(key, grant);
            if (sourceToken != null) bySourceToken.put(sourceToken, key);
            if (!grant.local) expiring.add(new Expiring(key, sourceToken));
            return key;
        }

        Grant get(String key, long now) { expire(now); return byKey.get(key); }
        void clear() { byKey.clear(); bySourceToken.clear(); expiring.clear(); }
    }

    // One authenticated, opaque capability per queue URL. Only the generation key stays on the phone.
    final class PlayerGrants {
        private final SecretKey key;

        PlayerGrants() throws Exception {
            KeyGenerator generator = KeyGenerator.getInstance("AES");
            generator.init(256);
            key = generator.generateKey();
        }

        String seal(Grant grant, JSONObject player) throws Exception {
            byte[] data = object("server", grant.server, "track", grant.track, "media", grant.media, "art", grant.art,
                    "address", grant.address, "format", grant.format, "player", player).toString().getBytes(StandardCharsets.UTF_8);
            // Leave room for the request line in the existing 4096-byte LAN HTTP decoder.
            if (data.length > 3000) throw new AudioService.HostError("invalidRequest", "The network music request could not be completed.");
            byte[] iv = new byte[12];
            RANDOM.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] packed = Arrays.copyOf(iv, iv.length + cipher.getOutputSize(data.length));
            cipher.doFinal(data, 0, data.length, packed, iv.length);
            return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(packed);
        }

        JSONObject open(String token) throws Exception {
            byte[] packed = java.util.Base64.getUrlDecoder().decode(token);
            if (packed.length < 28) throw denied();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, packed, 0, 12));
            return new JSONObject(new String(cipher.doFinal(packed, 12, packed.length - 12), StandardCharsets.UTF_8));
        }

        void serve(Channel ch, HttpRequest req) {
            Matcher route = RESOURCE.matcher(path(req).substring(PREFIX.length()));
            if (!route.matches()) { reply(ch, 404, null, EMPTY); return; }
            String origin = req.headers().get("Origin");
            if (!allowedHost(req.headers().get("Host"), "") ||
                    origin != null && (req.headers().getAll("Origin").size() != 1 || !allowedOrigin(origin))) {
                reply(ch, 403, null, EMPTY); return;
            }
            JSONObject payload;
            try { payload = open(route.group(2)); }
            catch (Exception invalid) { reply(ch, 404, null, EMPTY); return; }
            JSONObject player = payload.optJSONObject("player");
            synchronized (PwaNetworkHost.this) {
                if (playerGrants != this || closed) { reply(ch, 404, null, EMPTY); return; }
                if (origin != null) addCors(ch, origin);
                if (route.group(1).equals("grant")) {
                    if (!HttpMethod.GET.equals(req.method())) { reply(ch, 405, null, EMPTY); return; }
                    JSONObject target = object("hostId", player.optString("hostId"), "playerId", player.optString("playerId"),
                            "protocolInfo", player.optString("protocolInfo"));
                    reply(ch, 200, "application/json", object("audience", "player", "target", target).toString().getBytes(StandardCharsets.UTF_8));
                    return;
                }
                boolean head = HttpMethod.HEAD.equals(req.method()), artwork = route.group(1).equals("artwork");
                if (!head && !HttpMethod.GET.equals(req.method())) { reply(ch, 405, null, EMPTY); return; }
                if (player.has("address") && !player.optString("address").equals(((InetSocketAddress) ch.remoteAddress()).getAddress().getHostAddress())) {
                    reply(ch, 403, null, EMPTY); return;
                }
                Grant grant = new Grant(payload.optString("server"), payload.optString("track"), payload.optString("media"),
                        payload.optString("art"), payload.optString("address"), payload.optString("format"), Long.MAX_VALUE, false);
                if (artwork && grant.art.isEmpty()) { reply(ch, 404, null, EMPTY); return; }
                watchStream(ch);
                gateway.serveResource(ch, () -> grant.resolve(app, artwork), head, artwork, req.headers().get("Range"),
                        () -> generationCurrent(this), false);
            }
        }
    }

    private synchronized boolean generationCurrent(PlayerGrants owner) { return playerGrants == owner; }

    private Grant resource(JSONObject args, long now) throws Exception {
        String server = args.getString("serverId"), track = args.getString("trackId");
        JSONObject target = args.optJSONObject("target");
        if (target == null) target = new JSONObject();
        boolean local = share.pwaLibraryId().equals(server);
        String media = "", art = "", address = "", format = "raw";
        if (local) {
            Matcher shared = SHARED_TRACK.matcher(track);
            if (!share.pwaSharing() || !shared.matches()) throw denied();
            media = shared.group(1);
            art = media;
        } else {
            if (!libraries || track.isEmpty()) throw denied();
            if (server.startsWith("subsonic:")) {
                media = track;
                art = target.optString("coverArtId");
                String requested = target.optString("format");
                if (!requested.isEmpty()) format = requested;
            } else {
                media = target.optString("uri");
                art = target.optString("artwork");
                address = target.getString("address");
                if (address.isEmpty() || (media.isEmpty() && art.isEmpty())) throw denied();
            }
        }
        return new Grant(server, track, media, art, address, format, local ? Long.MAX_VALUE : now + 3_600_000, local);
    }

    private JSONObject issue(JSONObject args) throws Exception {
        String id = args.getString("requestId"), audience = args.getString("audience");
        String key;
        Grant grant;
        PlayerGrants owner;
        InetAddress incoming;
        JSONObject player = args.optJSONObject("player");
        synchronized (this) {
            if (!current(id)) throw denied();
            Pending p = requests.get(id);
            long now = SystemClock.elapsedRealtime();
            if ("browser".equals(audience) && args.has("playerArtworkToken")) {
                if (!share.isShareOrigin(args.getString("origin"))) return object("foreign", true);
                if (playerGrants == null || !libraries) return object("artwork", "");
                String token = args.getString("playerArtworkToken");
                JSONObject payload = playerGrants.open(token);
                JSONObject destination = payload.getJSONObject("player");
                if (!share.pwaLibraryId().equals(destination.getString("hostId")) ||
                        !args.getString("playerId").equals(destination.getString("playerId"))) throw denied();
                grant = new Grant(payload.getString("server"), payload.getString("track"), "", payload.getString("art"),
                        payload.getString("address"), payload.getString("format"), now + 3_600_000, false);
                return urls(p.base, grants.issue(grant, now, token), grant);
            }
            grant = resource(args, now);
            if ("browser".equals(audience)) return urls(p.base, grants.issue(grant, now), grant);
            if (!"player".equals(audience) || grant.local || player == null || player.getString("hostId").isEmpty() ||
                    player.getString("playerId").isEmpty() || grant.media.isEmpty()) throw denied();
            if (share.pwaLibraryId().equals(player.getString("hostId")) && !playerId.equals(player.getString("playerId"))
                    && (!players || player.optString("address").isEmpty())) throw denied();
            if (playerGrants == null) playerGrants = new PlayerGrants();
            owner = playerGrants;
            key = owner.seal(grant, player);
            incoming = ((InetSocketAddress) p.channel.localAddress()).getAddress();
        }
        // Binding runs on the control thread, outside the lock used by the LAN event loop.
        String base = share.publishPlayerGrants(owner, incoming, player.optString("address"), () -> current(id));
        return urls(base, key, grant);
    }

    private static JSONObject urls(String origin, String key, Grant grant) {
        String base = origin + PREFIX;
        return object("uri", grant.media.isEmpty() ? "" : base + "media/" + key, "artwork", grant.art.isEmpty() ? "" : base + "artwork/" + key);
    }

    private synchronized boolean current(String key, Grant grant) {
        return !closed && grant != null && grant == grants.get(key, SystemClock.elapsedRealtime());
    }

    private synchronized void serve(Channel ch, String key, boolean artwork, boolean head, String range) {
        Grant grant = grants.get(key, SystemClock.elapsedRealtime());
        if (!current(key, grant) || (artwork ? grant.art : grant.media).isEmpty()) { reply(ch, 404, null, EMPTY); return; }
        watchStream(ch);
        if (grant.local) {
            control.post(() -> {
                if (ch.isActive() && current(key, grant)) share.servePwa(ch, grant.media, artwork, range, head, () -> current(key, grant));
                else ch.close();
            });
            return;
        }
        gateway.servePwa(ch, () -> grant.resolve(app, artwork), head, artwork, range, () -> current(key, grant));
    }

    private void watchStream(Channel ch) {
        streams.add(ch);
        ch.closeFuture().addListener(done -> { synchronized (this) { streams.remove(ch); } });
    }

    private void remove(Pending p) {
        requests.remove(p.id);
        p.timer.cancel(false);
    }

    private synchronized void cancel(Pending p, String reason) {
        if (requests.get(p.id) != p) return;
        remove(p);
        if (p.sent) control.post(() -> events.send("pwa-cancelled", object("requestId", p.id)));
        if (p.channel.isActive()) {
            if (p.written != 0) p.channel.close();
            else error(p.channel, reason.equals("unauthorized") ? 401 : reason.equals("forbidden") ? 403 : 400, reason);
        }
    }

    synchronized boolean current(String id) {
        Pending p = requests.get(id);
        return !closed && p != null && p.sent && p.current();
    }

    synchronized void pageGone() { for (Pending p : new ArrayList<>(requests.values())) cancel(p, "renderer-unavailable"); }

    synchronized void permissions(boolean libraries, boolean players, boolean sourcesChanged) {
        if (this.libraries != libraries || this.players != players || sourcesChanged) revoke();
        this.libraries = libraries;
        this.players = players;
    }

    synchronized void sharingChanged(String command, JSONObject args) {
        if (command.equals("share.revoke")) {
            org.json.JSONArray tokens = args.optJSONArray("tokens");
            if (tokens == null) return;
            for (int i = 0; i < tokens.length(); i++) {
                if (grants.bySourceToken.containsKey(tokens.optString(i))) { revoke(); return; }
            }
        } else if (command.equals("share.start") || command.equals("share.stop")) revoke();
    }

    synchronized void revoke() {
        if (closed) return;
        invalidate("forbidden");
    }

    private void invalidate(String reason) {
        generation++;
        PlayerGrants old = playerGrants;
        playerGrants = null;
        if (old != null) control.post(() -> share.releasePlayerGrants(old));
        grants.clear();
        for (Pending p : new ArrayList<>(requests.values())) cancel(p, reason);
        for (Channel ch : new ArrayList<>(streams)) ch.close();
        streams.clear();
        control.post(() -> events.send("pwa-revoked", new JSONObject()));
    }

    synchronized void tokenChanged() { tokenChanged = true; close(); }

    @Override public synchronized void close() {
        if (closed) return;
        closed = true;
        SubsonicHost.unwatchSources(sourceChanged);
        invalidate(tokenChanged ? "unauthorized" : "forbidden");
    }
}

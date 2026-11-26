package com.frieve.effetune;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.SystemClock;
import android.util.Log;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import java.util.*;
import javax.net.ssl.*;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import static com.frieve.effetune.AudioService.object;

final class CastSender implements NetworkOutput.Device {
    private static final String APP = "CC1AD845", RECEIVER = "receiver-0", SENDER = "sender-0";
    private static final String PREFIX = "urn:x-cast:com.google.cast.";
    private static final String CONNECTION = PREFIX + "tp.connection", HEARTBEAT = PREFIX + "tp.heartbeat";
    private static final String APPLICATION = PREFIX + "receiver", MEDIA = PREFIX + "media";
    private final String id, name;
    private final InetAddress address;
    private final int port;
    private CastSender(NsdServiceInfo service) {
        id = txt(service, "id");
        String friendly = txt(service, "fn");
        name = friendly.isEmpty() ? service.getServiceName() : friendly;
        address = service.getHost(); port = service.getPort();
    }
    public String id() { return id; }
    public String name() { return name; }
    public String type() { return "cast"; }
    public InetAddress address() { return address; }
    private static String txt(NsdServiceInfo info, String key) {
        byte[] bytes = info.getAttributes().get(key);
        return bytes == null ? "" : new String(bytes, StandardCharsets.UTF_8).trim();
    }

    static final class Discovery implements NsdManager.DiscoveryListener {
        private final NsdManager nsd;
        private final Handler control;
        private final NetworkOutput.Discovery output;
        private final Map<String, String> ids = new HashMap<>();
        private final ArrayDeque<NsdServiceInfo> queue = new ArrayDeque<>();
        private final Set<String> present = new HashSet<>();
        private boolean resolving, closed, registered;
        Discovery(Context context, Handler control, NetworkOutput.Discovery output) {
            nsd = context.getSystemService(NsdManager.class); this.control = control; this.output = output;
        }
        void start() {
            if (closed) return;
            try { nsd.discoverServices("_googlecast._tcp.", NsdManager.PROTOCOL_DNS_SD, this); registered = true; }
            catch (RuntimeException error) { Log.w("EffeTuneNetwork", "Cast discovery unavailable", error); retry(); }
        }
        private void retry() { if (!closed) control.postDelayed(this::start, 30000); }
        void close() {
            closed = true;
            if (registered) {
                try { nsd.stopServiceDiscovery(this); }
                catch (RuntimeException error) { Log.d("EffeTuneNetwork", "Discovery already stopped", error); }
            }
            queue.clear(); ids.clear(); present.clear();
        }
        @Override public void onDiscoveryStarted(String type) {}
        @Override public void onDiscoveryStopped(String type) {}
        @Override public void onStartDiscoveryFailed(String type, int error) {
            control.post(() -> {
                if (closed) return;
                try { nsd.stopServiceDiscovery(this); } catch (RuntimeException ignored) { }
                registered = false; retry();
            });
        }
        @Override public void onStopDiscoveryFailed(String type, int error) { Log.w("EffeTuneNetwork", "Cast discovery stop: " + error); }
        @Override public void onServiceFound(NsdServiceInfo service) {
            control.post(() -> {
                if (closed) return;
                present.add(service.getServiceName());
                queue.addLast(service); resolveNext();
            });
        }
        @Override public void onServiceLost(NsdServiceInfo service) {
            control.post(() -> {
                if (closed) return;
                present.remove(service.getServiceName());
                String id = ids.remove(service.getServiceName());
                if (id != null) output.lost(id);
            });
        }
        private void resolveNext() {
            if (closed || resolving || queue.isEmpty()) return;
            NsdServiceInfo next = queue.removeFirst();
            resolving = true;
            try {
                nsd.resolveService(next, new NsdManager.ResolveListener() {
                    public void onResolveFailed(NsdServiceInfo info, int error) {
                        control.post(() -> {
                            resolving = false; resolveNext();
                            if (!closed && present.contains(next.getServiceName()))
                                control.postDelayed(() -> { if (!closed && present.contains(next.getServiceName())) { queue.add(next); resolveNext(); } }, 5000);
                        });
                    }
                    public void onServiceResolved(NsdServiceInfo info) {
                        control.post(() -> {
                            resolving = false;
                            if (closed) return;
                            CastSender device = new CastSender(info);
                            if (present.contains(next.getServiceName()) && !device.id.isEmpty()
                                    && NetworkStreamServer.lan(device.address) && !device.address.isLoopbackAddress() && device.port > 0) {
                                ids.put(next.getServiceName(), device.id); output.found(device);
                            }
                            resolveNext();
                        });
                    }
                });
            } catch (RuntimeException error) {
                resolving = false; Log.w("EffeTuneNetwork", "Cannot resolve Cast service", error); resolveNext();
            }
        }
    }

    // Cast receivers use self-signed certificates. Only this socket to the resolved LAN address uses this context.
    private SSLSocket connect() throws Exception {
        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(null, new TrustManager[]{new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            public void checkClientTrusted(X509Certificate[] chain, String auth) throws java.security.cert.CertificateException {
                throw new java.security.cert.CertificateException();
            }
            public void checkServerTrusted(X509Certificate[] chain, String auth) throws java.security.cert.CertificateException {
                if (!NetworkStreamServer.lan(address) || chain == null || chain.length == 0)
                    throw new java.security.cert.CertificateException();
            }
        }}, null);
        SSLSocket socket = (SSLSocket) tls.getSocketFactory().createSocket();
        try {
            socket.connect(new InetSocketAddress(address, port), 5000);
            socket.setSoTimeout(5000); socket.startHandshake();
            return socket;
        } catch (Exception error) { socket.close(); throw error; }
    }

    private static void varint(ByteArrayOutputStream out, int n) {
        while (n >= 128) { out.write((n & 127) | 128); n >>>= 7; }
        out.write(n);
    }
    private static int varint(ByteArrayInputStream in) throws IOException {
        int result = 0;
        for (int shift = 0; shift < 32; shift += 7) {
            int b = in.read();
            if (b < 0) break;
            result |= (b & 127) << shift;
            if ((b & 128) == 0) return result;
        }
        throw new IOException("Invalid Cast varint");
    }
    private static void string(ByteArrayOutputStream out, int field, String value) {
        byte[] b = value.getBytes(StandardCharsets.UTF_8);
        out.write((field << 3) | 2); varint(out, b.length); out.write(b, 0, b.length);
    }

    private static String contentId(JSONObject status) {
        JSONObject media = status.optJSONObject("media");
        return media != null && media.opt("contentId") instanceof String id ? id : null;
    }

    static int loadedMediaId(JSONObject reply, String url) throws IOException, JSONException, NetworkOutput.Failure {
        JSONArray statuses = reply.getJSONArray("status");
        // A direct LOAD reply for a single item may omit media metadata.
        if (statuses.length() == 1) {
            JSONObject status = statuses.getJSONObject(0);
            String content = contentId(status);
            if (content != null && !url.equals(content)) throw new NetworkOutput.Failure("taken");
            return status.getInt("mediaSessionId");
        }
        for (int i = 0; i < statuses.length(); i++) {
            JSONObject status = statuses.optJSONObject(i);
            if (status != null && url.equals(contentId(status))) return status.getInt("mediaSessionId");
        }
        throw new IOException("Missing Cast media session");
    }

    static JSONObject liveMediaStatus(JSONObject reply, int mediaId, String url) throws IOException, NetworkOutput.Failure {
        JSONArray statuses = reply.optJSONArray("status");
        for (int i = 0; statuses != null && i < statuses.length(); i++) {
            JSONObject status = statuses.optJSONObject(i);
            if (status == null || !(status.opt("mediaSessionId") instanceof Number id) || id.doubleValue() != mediaId)
                continue;
            String content = contentId(status);
            if (content != null && !url.equals(content))
                throw new NetworkOutput.Failure("taken");
            if ("IDLE".equals(status.optString("playerState"))
                    && status.opt("idleReason") instanceof String reason && !reason.isEmpty())
                throw new IOException("Cast playback ended (" + reason + ")");
            return status;
        }
        return null;
    }

    private static final class Connection {
        final DataInputStream in;
        final DataOutputStream out;
        final SSLSocket socket;
        final NetworkOutput.Session session;
        int request;
        String transport, sessionId;
        Integer mediaId;
        Connection(SSLSocket socket, NetworkOutput.Session session) throws IOException {
            this.socket = socket; this.session = session;
            in = new DataInputStream(new BufferedInputStream(socket.getInputStream()));
            out = new DataOutputStream(socket.getOutputStream());
        }
        synchronized void send(String ns, String destination, JSONObject message) throws IOException {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            b.write(8); b.write(0);
            string(b, 2, SENDER); string(b, 3, destination); string(b, 4, ns);
            b.write(40); b.write(0); string(b, 6, message.toString());
            out.writeInt(b.size()); b.writeTo(out); out.flush();
        }
        JSONObject request(String ns, String destination, JSONObject msg, int timeout) throws Exception {
            if (session.stream.closed) throw new InterruptedIOException();
            int id = ++request;
            send(ns, destination, msg.put("requestId", id));
            long deadline = SystemClock.elapsedRealtime() + timeout;
            while (!session.stream.closed && SystemClock.elapsedRealtime() < deadline) {
                long now = SystemClock.elapsedRealtime();
                socket.setSoTimeout((int) Math.max(1, deadline - now));
                int size = in.readInt();
                if (size <= 0 || size > 65536) throw new IOException("Invalid Cast frame length");
                byte[] frame = new byte[size]; in.readFully(frame);
                ByteArrayInputStream b = new ByteArrayInputStream(frame);
                String source = "", namespace = "", json = "";
                while (b.available() > 0) {
                    int tag = varint(b), wire = tag & 7;
                    if (wire == 0) { varint(b); continue; }
                    if (wire != 2) throw new IOException("Invalid Cast message");
                    int n = varint(b);
                    if (n < 0 || n > b.available()) throw new IOException("Invalid Cast field");
                    byte[] bytes = new byte[n];
                    if (n != 0 && b.read(bytes, 0, n) != n) throw new EOFException();
                    switch (tag >>> 3) {
                        case 2: source = new String(bytes, StandardCharsets.UTF_8); break;
                        case 4: namespace = new String(bytes, StandardCharsets.UTF_8); break;
                        case 6: json = new String(bytes, StandardCharsets.UTF_8); break;
                        default: break;
                    }
                }
                if (json.isEmpty()) continue;
                JSONObject reply = new JSONObject(json);
                String type = reply.optString("type");
                if (namespace.equals(HEARTBEAT) && type.equals("PING")) send(HEARTBEAT, source, object("type", "PONG"));
                if (namespace.equals(CONNECTION) && type.equals("CLOSE") && source.equals(transport)) {
                    mediaId = null;
                    throw new IOException("Cast transport closed");
                }
                if (namespace.equals(APPLICATION) && type.equals("RECEIVER_STATUS") && sessionId != null) {
                    JSONObject app = application(reply);
                    if (app == null || !app.optString("sessionId").equals(sessionId)) {
                        mediaId = null;
                        throw new NetworkOutput.Failure("taken");
                    }
                }
                if (reply.optInt("requestId") != id || !namespace.equals(ns) || !source.equals(destination)) {
                    if (mediaId != null && namespace.equals(MEDIA) && source.equals(transport) && type.equals("MEDIA_STATUS"))
                        acceptMediaStatus(reply);
                    continue;
                }
                if (!type.equals("MEDIA_STATUS") && !type.equals("RECEIVER_STATUS")) throw new IOException("Cast request rejected");
                return reply;
            }
            throw new SocketTimeoutException();
        }
        JSONObject application(JSONObject response) {
            JSONObject status = response.optJSONObject("status");
            JSONArray apps = status == null ? null : status.optJSONArray("applications");
            for (int i = 0; apps != null && i < apps.length(); i++) {
                JSONObject app = apps.optJSONObject(i);
                if (app != null && APP.equals(app.optString("appId"))) return app;
            }
            return null;
        }
        private JSONObject acceptMediaStatus(JSONObject reply) throws IOException, NetworkOutput.Failure {
            try {
                JSONObject status = liveMediaStatus(reply, mediaId, session.stream.url);
                if (status != null && "PLAYING".equals(status.optString("playerState"))) session.state = "playing";
                return status;
            } catch (IOException | NetworkOutput.Failure error) {
                mediaId = null;
                throw error;
            }
        }

        void start() throws Exception {
            send(CONNECTION, RECEIVER, object("type", "CONNECT"));
            JSONObject app = application(request(APPLICATION, RECEIVER, object("type", "GET_STATUS"), 5000));
            if (app == null) app = application(request(APPLICATION, RECEIVER, object("type", "LAUNCH", "appId", APP), 10000));
            if (app == null) throw new IOException("Missing Cast media receiver");
            sessionId = app.getString("sessionId"); transport = app.getString("transportId");
            send(CONNECTION, transport, object("type", "CONNECT"));
            JSONObject reply = request(MEDIA, transport, object("type", "LOAD", "autoplay", true,
                    "media", object("contentId", session.stream.url, "contentType", "audio/wav", "streamType", "LIVE")), 15000);
            mediaId = loadedMediaId(reply, session.stream.url);
            acceptMediaStatus(reply);
        }
        void monitor() throws Exception {
            ArrayDeque<Double> samples = new ArrayDeque<>();
            int stale = 0, stable = 0;
            double candidate = -1;
            long startDeadline = SystemClock.elapsedRealtime() + 15000;
            boolean measuring = false;
            while (!session.stream.closed) {
                if (session.stream.failure != null) throw new NetworkOutput.Failure(session.stream.failure);
                if (session.measureAgain && !measuring) { measuring = true; samples.clear(); stable = 0; }
                long before = SystemClock.elapsedRealtime();
                boolean starting = !"playing".equals(session.state);
                long remaining = startDeadline - before;
                if (starting && remaining <= 0) throw new NetworkOutput.Failure("startFailed");
                int timeout = starting ? (int) Math.min(5000, remaining) : 5000;
                JSONObject status;
                try {
                    status = acceptMediaStatus(request(MEDIA, transport,
                            object("type", "GET_STATUS", "mediaSessionId", mediaId), timeout));
                } catch (SocketTimeoutException error) {
                    if (!"playing".equals(session.state) && SystemClock.elapsedRealtime() >= startDeadline)
                        throw new NetworkOutput.Failure("startFailed", error);
                    throw error;
                }
                if (status != null && "PLAYING".equals(status.optString("playerState"))) {
                    double ms = session.stream.positionMs() - status.optDouble("currentTime") * 1000;
                    if (SystemClock.elapsedRealtime() - before <= 250 && Double.isFinite(ms) && ms >= 0) {
                        if (ms > 6000) { if (++stale >= 8) throw new IOException("Cast receiver stalled"); }
                        else {
                            stale = 0; samples.addLast(ms);
                            if (samples.size() > 21) samples.removeFirst();
                            if (samples.size() == 21) {
                                double floor = Collections.min(samples);
                                if (Collections.max(samples) - floor > 1000) stable = 0;
                                else if (Math.abs(floor - candidate) >= 20 || stable == 0) { candidate = floor; stable = 1; }
                                else if (++stable >= 21) {
                                    if (session.latency < 0 || Math.abs(session.latency - floor) >= 20)
                                        session.latency = (int) Math.round(floor);
                                    measuring = false; session.measureAgain = false;
                                }
                            }
                        }
                    }
                }
                Thread.sleep(Math.max(1, 250 - (SystemClock.elapsedRealtime() - before)));
            }
        }
    }

    @Override public void play(NetworkOutput.Session s) throws Exception {
        try (SSLSocket socket = connect()) {
            Connection c = new Connection(socket, s);
            Timer heartbeat = new Timer("EffeTune-Cast-heartbeat", true);
            heartbeat.schedule(new TimerTask() {
                @Override public void run() {
                    try { c.send(HEARTBEAT, RECEIVER, object("type", "PING")); }
                    catch (IOException error) {
                        cancel();
                        try { socket.close(); } catch (IOException ignored) { }
                    }
                }
            }, 5000, 5000);
            try { c.start(); c.monitor(); }
            finally {
                heartbeat.cancel();
                if (s.stream.closed && c.mediaId != null)
                    c.send(MEDIA, c.transport, object("type", "STOP", "mediaSessionId", c.mediaId, "requestId", ++c.request));
            }
        }
    }
}

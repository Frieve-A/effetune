package com.frieve.effetune;

import static com.frieve.effetune.AudioService.object;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.util.Log;
import android.util.Pair;
import java.io.BufferedReader;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.StringReader;
import java.net.InetAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.xml.parsers.DocumentBuilderFactory;
import org.json.JSONObject;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.InputSource;

/** Protocol and renderer state belong to the background service control handler. */
final class OpenHomeHost implements Closeable {
    private static final String OH = "openHomeRemoteControl", AV = "upnpAvRemoteControl", NAME = "openHomeFriendlyName";
    private static final String OH_ID = "openHomeDeviceId", AV_ID = "upnpAvDeviceId", UDN_PREFIX = "uuid:";
    private static final String DIDL = "urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/";
    private final SharedPreferences prefs;
    private final Handler control;
    private final AudioService.Events events;
    private final Runnable foregroundChanged;
    private final Ssdp ssdp;
    private final MediaGateway gateway;
    private final LanHttp http;
    private final ConnectivityManager networks;
    private final String defaultName;
    private final Map<String, Pending> pending = new LinkedHashMap<>();
    private final Map<Long, Media> tracks = new HashMap<>();
    private final List<AudioService.Reply> resetWaiters = new ArrayList<>();
    private boolean enabled, avEnabled, rendererReady, needsReset, watching, closed;
    private String friendlyName, resetId, state = "stopped";
    private boolean available = true;
    private long sequence, lastAvSequence;
    private Media live;
    private JSONObject snapshot;
    private Pipe pipe;
    // Service destruction runs on its old control handler and can overlap creation of its successor.
    private static Pipe nativeOwner;
    private Ssdp.Lease lease;
    private int retryMs = 500;
    private final Runnable restart = this::restart;
    private final Runnable resetExpired = () -> finishReset(false);
    private final Runnable startupExpired = () -> failed(pipe);

    OpenHomeHost(Context context, Handler control, Ssdp ssdp, MediaGateway gateway, LanHttp http,
                 AudioService.Events events, Runnable foregroundChanged) {
        this.control = control;
        this.ssdp = ssdp;
        this.gateway = gateway;
        this.http = http;
        this.events = events;
        this.foregroundChanged = foregroundChanged;
        networks = context.getSystemService(ConnectivityManager.class);
        prefs = context.getSharedPreferences("audio", Context.MODE_PRIVATE);
        defaultName = nameOr(Settings.Global.getString(context.getContentResolver(), Settings.Global.DEVICE_NAME),
                nameOr(Build.MODEL, "EffeTune"));
        friendlyName = nameOr(prefs.getString(NAME, null), defaultName);
        enabled = prefs.getBoolean(OH, false);
        avEnabled = prefs.getBoolean(AV, false);
        if (isEnabled()) restart();
    }

    boolean isEnabled() { return enabled || avEnabled; }

    JSONObject getStatus() {
        return object("apiVersion", 1, "enabled", enabled, "upnpAvEnabled", avEnabled,
                "localControlEnabled", false, "friendlyName", friendlyName, "rendererReady", rendererReady,
                "available", available, "state", state);
    }

    void command(String name, JSONObject args, AudioService.Reply reply) throws Exception {
        JSONObject result;
        switch (name) {
            case "openhome.getStatus": result = getStatus(); break;
            case "openhome.setEnabled":
            case "openhome.setUpnpAvEnabled": {
                if (!(args.get("enabled") instanceof Boolean value)) throw new IllegalArgumentException();
                boolean av = name.equals("openhome.setUpnpAvEnabled");
                if ((av ? avEnabled : enabled) != value) {
                    prefs.edit().putBoolean(av ? AV : OH, value).apply();
                    if (av) { avEnabled = value; if (!value) releaseLive(); }
                    else enabled = value;
                    foregroundChanged.run();
                    if (!isEnabled()) { snapshot = null; needsReset = true; releaseAll(); }
                    requestReset();
                    retryMs = 500;
                    restart();
                }
                if (resetId != null) { resetWaiters.add(reply); return; }
                result = getStatus(); break;
            }
            case "openhome.setFriendlyName": {
                if (!(args.get("friendlyName") instanceof String raw)) throw new IllegalArgumentException();
                String value = raw.trim().isEmpty() ? defaultName : nameOr(raw, null);
                if (value == null) throw new IllegalArgumentException();
                if (raw.trim().isEmpty()) prefs.edit().remove(NAME).apply();
                else prefs.edit().putString(NAME, value).apply();
                if (!value.equals(friendlyName)) { friendlyName = value; restart(); }
                result = getStatus(); break;
            }
            case "openhome.rendererReady":
                rendererReady = true; requestReset(); status();
                if (resetId != null) { resetWaiters.add(reply); return; }
                result = getStatus(); break;
            case "openhome.rendererUnavailable":
                rendererUnavailable(); result = new JSONObject(); break;
            case "openhome.respond": result = object("value", respond(args)); break;
            case "openhome.resetAck": {
                boolean match = resetId != null && resetId.equals(args.optString("resetId"));
                if (match) finishReset(Boolean.TRUE.equals(args.opt("ok")));
                result = object("value", match); break;
            }
            case "openhome.publishState": {
                boolean accepted = isEnabled() && rendererReady && !needsReset;
                if (accepted) snapshot = args;
                result = object("value", accepted && state.equals("ready") && write(object("type", "state", "snapshot", args)));
                break;
            }
            case "openhome.liveFeedback":
                if (avEnabled && rendererReady && !needsReset && state.equals("ready") && live != null
                        && live.token().equals(args.optString("sessionId"))) {
                    JSONObject feedback = feedbackMessage(args);
                    if (feedback != null) { gateway.liveFeedback(feedback, reply); return; }
                }
                result = object("value", JSONObject.NULL); break;
            default: throw new IllegalArgumentException();
        }
        reply.complete(result, null);
    }

    void rendererUnavailable() {
        if (!rendererReady) return;
        rendererReady = false;
        needsReset |= isEnabled();
        if (resetId != null) finishReset(false);
        snapshot = null;
        cancelAll("renderer-unavailable");
        releaseAll();
        status();
    }

    private void requestReset() {
        if (!needsReset || !rendererReady || resetId != null) return;
        resetId = "reset-" + ++sequence;
        control.postDelayed(resetExpired, 2000);
        events.send("openhome-reset", object("resetId", resetId));
    }

    private void finishReset(boolean ok) {
        control.removeCallbacks(resetExpired);
        resetId = null;
        needsReset = !ok;
        for (AudioService.Reply waiter : resetWaiters) waiter.complete(getStatus(), null);
        resetWaiters.clear();
    }

    private static String nameOr(String value, String fallback) {
        if (value == null) return fallback;
        String name = value.trim();
        return name.isEmpty() || name.length() > 128 || name.chars().anyMatch(c -> c < 32 || c == 127) ? fallback : name;
    }

    private String deviceId(String key) {
        String id = prefs.getString(key, null);
        if (id == null) { id = UUID.randomUUID().toString(); prefs.edit().putString(key, id).apply(); }
        return UDN_PREFIX + id;
    }

    static boolean isOwnRenderer(SharedPreferences prefs, String udn) {
        if (!udn.startsWith(UDN_PREFIX)) return false;
        String id = udn.substring(UDN_PREFIX.length());
        return id.equals(prefs.getString(OH_ID, null)) || id.equals(prefs.getString(AV_ID, null));
    }

    private final NetworkObserver networkCallback = new NetworkObserver();

    private final class NetworkObserver extends ConnectivityManager.NetworkCallback {
        private Network current;
        private String nic;
        private Set<Pair<InetAddress, Integer>> addresses;
        boolean update(Network network, LinkProperties properties) {
            String name = properties == null ? null : properties.getInterfaceName();
            Set<Pair<InetAddress, Integer>> links = new HashSet<>();
            if (properties != null) {
                for (LinkAddress link : properties.getLinkAddresses()) {
                    links.add(Pair.create(link.getAddress(), link.getPrefixLength()));
                }
            }
            boolean changed = !Objects.equals(nic, name) || !links.equals(addresses);
            current = network; nic = name; addresses = links;
            return changed;
        }
        @Override public void onLinkPropertiesChanged(Network network, LinkProperties properties) {
            if (watching && update(network, properties)) scheduleRestart(200);
        }
        @Override public void onLost(Network network) {
            if (watching && network.equals(current) && update(null, null)) scheduleRestart(200);
        }
    }

    private void watchNetwork(boolean enable) {
        if (watching == enable) return;
        try {
            if (enable) {
                Network initial = networks.getActiveNetwork();
                networkCallback.update(initial, initial == null ? null : networks.getLinkProperties(initial));
                networks.registerDefaultNetworkCallback(networkCallback, control);
            } else networks.unregisterNetworkCallback(networkCallback);
            watching = enable;
        } catch (SecurityException error) { Log.w("EffeTuneNetwork", "OpenHome network callback unavailable", error); }
    }

    private void scheduleRestart(int delay) {
        control.removeCallbacks(restart);
        if (isEnabled() && !closed) control.postDelayed(restart, delay);
    }

    private void restart() {
        control.removeCallbacks(restart);
        stopPipe();
        watchNetwork(isEnabled() && !closed);
        if (!isEnabled() || closed) { state = "stopped"; status(); return; }
        try {
            lease = ssdp.acquireMulticast();
            pipe = new Pipe();
            pipe.start();
            state = "starting";
            write(object("type", "configure", "protocolVersion", 1, "device", object("friendlyName", friendlyName,
                    "udn", deviceId(OH_ID), "openHomeEnabled", enabled, "upnpAvEnabled", avEnabled,
                    "upnpAvUdn", avEnabled ? deviceId(AV_ID) : "")));
            control.postDelayed(startupExpired, 10000);
        } catch (LinkageError error) {
            available = false;
            stopPipe(); state = "unavailable";
            Log.w("EffeTuneNetwork", "OpenHome JNI unavailable", error);
        } catch (Exception error) {
            Log.w("EffeTuneNetwork", "OpenHome startup failed", error);
            failed(pipe);
            return;
        }
        status();
    }

    private void failed(Pipe source) {
        if (pipe != source || closed) return;
        stopPipe();
        state = "failed"; status();
        scheduleRestart(retryMs);
        retryMs = Math.min(30000, retryMs * 2);
    }

    private void stopPipe() {
        control.removeCallbacks(startupExpired);
        cancelAll("service-stopped");
        Pipe previous = pipe;
        pipe = null;
        if (previous != null) previous.close();
        if (lease != null) { lease.close(); lease = null; }
    }

    private void status() { if (!closed) events.send("openhome-status", getStatus()); }

    private final class Pipe implements Closeable {
        private final ThreadPoolExecutor writer = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(16), task -> new Thread(task, "EffeTune-ohNet-write"));
        private OutputStream output;
        private final AtomicReference<byte[]> queuedState = new AtomicReference<>();
        private final Runnable writeState = () -> writeLine(queuedState.getAndSet(null));
        private Thread reader;

        void start() throws IOException {
            ParcelFileDescriptor[] to = ParcelFileDescriptor.createPipe();
            try (ParcelFileDescriptor readFd = to[0]) {
                output = new ParcelFileDescriptor.AutoCloseOutputStream(to[1]);
                ParcelFileDescriptor[] from = ParcelFileDescriptor.createPipe();
                try (ParcelFileDescriptor writeFd = from[1]) {
                    BufferedReader input = new BufferedReader(new InputStreamReader(
                            new ParcelFileDescriptor.AutoCloseInputStream(from[0]), StandardCharsets.UTF_8));
                    try {
                        synchronized (OpenHomeNative.class) {
                            OpenHomeNative.nativeStop();
                            nativeOwner = null;
                            if (!OpenHomeNative.nativeStart(readFd.detachFd(), writeFd.detachFd()))
                                throw new IOException("OpenHome nativeStart failed");
                            nativeOwner = this;
                        }
                        reader = new Thread(() -> read(input), "EffeTune-ohNet-read");
                        reader.start();
                    } catch (IOException | RuntimeException | Error failure) {
                        input.close();
                        throw failure;
                    }
                }
            }
        }

        private void read(BufferedReader input) {
            try (input) {
                String line;
                while ((line = input.readLine()) != null) {
                    JSONObject message = new JSONObject(line);
                    control.post(() -> { if (pipe == this) receive(message); });
                }
            } catch (Exception error) { Log.d("EffeTuneNetwork", "OpenHome pipe read ended", error); }
            control.post(() -> failed(this));
        }

        boolean send(JSONObject message) {
            byte[] line = (message + "\n").getBytes(StandardCharsets.UTF_8);
            if (line.length > 256 * 1024) return false;
            try {
                if ("state".equals(message.optString("type"))) {
                    if (queuedState.getAndSet(line) == null) writer.execute(writeState);
                } else {
                    // Keep pending commands ahead of the latest unsent snapshot.
                    boolean stateWaiting = writer.remove(writeState);
                    writer.execute(() -> writeLine(line));
                    if (stateWaiting) writer.execute(writeState);
                }
                return true;
            } catch (RejectedExecutionException error) { control.post(() -> failed(this)); return false; }
        }

        private void writeLine(byte[] line) {
            try { output.write(line); }
            catch (IOException error) { control.post(() -> failed(this)); }
        }

        @Override public void close() {
            writer.shutdownNow();
            synchronized (OpenHomeNative.class) {
                if (nativeOwner == this) {
                    OpenHomeNative.nativeStop();
                    nativeOwner = null;
                }
            }
            try { if (output != null) output.close(); }
            catch (IOException error) { Log.d("EffeTuneNetwork", "OpenHome pipe close", error); }
            try {
                if (reader != null) reader.join();
                if (!writer.awaitTermination(2, TimeUnit.SECONDS)) Log.w("EffeTuneNetwork", "OpenHome pipe writer still closing");
            }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
    }

    private boolean write(JSONObject message) { return pipe != null && pipe.send(message); }

    private void ready() {
        control.removeCallbacks(startupExpired);
        state = "ready";
        retryMs = 500;
        if (rendererReady && !needsReset && snapshot != null) write(object("type", "state", "snapshot", snapshot));
        status();
    }

    private void receive(JSONObject message) {
        switch (message.optString("type")) {
            case "ready":
                if (message.optInt("protocolVersion") != 1) { failed(pipe); break; }
                ready(); break;
            case "action": queue(message); break;
            case "diagnostic": Log.d("EffeTuneNetwork", "OpenHome: " + message.optString("code")); break;
            default: break;
        }
    }

    private final class Pending {
        final long order = ++sequence;
        final String nativeId, pageId = "oh-" + order, service, action;
        final JSONObject args;
        final long deadline;
        final Runnable timeout = () -> { cancel(this, "action-timeout"); dispatch(); };
        Media media;
        boolean prepared, sent;
        Pending(JSONObject message, long timeoutMs) {
            nativeId = message.optString("requestId");
            service = message.optString("service");
            action = message.optString("action");
            JSONObject parameters = message.optJSONObject("args");
            args = parameters == null ? new JSONObject() : parameters;
            deadline = System.currentTimeMillis() + timeoutMs;
        }
        boolean is(String svc, String op) { return service.equals(svc) && action.equals(op); }
    }

    private void queue(JSONObject message) {
        String id = message.optString("requestId");
        if (!rendererReady || !isEnabled() || needsReset || !state.equals("ready")) {
            reject(id, "renderer-unavailable");
            requestReset();
            return;
        }
        if (pending.size() >= 16 || pending.containsKey(id)) { reject(id, "busy"); return; }
        long timeout = "Catalog".equals(message.optString("service")) ? 120000 : 10000;
        Pending job = new Pending(message, timeout);
        pending.put(id, job);
        control.postDelayed(job.timeout, timeout);
        if (job.is("Playlist", "Insert") || job.is("AVTransport", "SetAVTransportURI") && !job.args.optString("uri").isEmpty()) {
            boolean allowLive = avEnabled && job.is("AVTransport", "SetAVTransportURI");
            try {
                http.submit(() -> register(job.args, allowLive), (result, error) -> control.post(() -> {
                    Media media = result == null ? null : new Media(result);
                    if (pending.get(id) != job) { release(media); return; }
                    if (error != null) cancel(job, "invalid-media-uri");
                    else {
                        job.media = media;
                        job.prepared = true;
                    }
                    dispatch();
                }));
            } catch (RejectedExecutionException error) { cancel(job, "busy"); }
        } else job.prepared = true;
        dispatch();
    }

    private void dispatch() {
        for (Pending job : pending.values()) {
            if (!job.prepared) break;
            if (job.sent) continue;
            job.sent = true;
            if (job.media != null) {
                job.args.remove("liveSessionId");
                job.args.remove("artworkUrl");
                try {
                    job.args.put("playbackUrl", job.media.urls.getString("playbackUrl"));
                    if (job.media.live()) job.args.put("liveSessionId", job.media.token());
                    if (job.media.urls.has("artworkUrl")) job.args.put("artworkUrl", job.media.urls.getString("artworkUrl"));
                } catch (org.json.JSONException error) { throw new IllegalStateException(error); }
            }
            events.send("openhome-action", object("requestId", job.pageId, "service", job.service, "action", job.action,
                    "args", job.args, "localControl", false, "deadlineEpochMs", job.deadline));
        }
    }

    private record Media(JSONObject urls) {
        String token() { return urls.optString("token"); }
        boolean live() { return urls.optBoolean("live"); }
    }

    private JSONObject register(JSONObject args, boolean allowLive) throws Exception {
        String uri = args.getString("uri");
        String didl = args.optString("metadata");
        Element root = allowLive ? metadata(didl, true) : null;
        boolean liveStream = allowLive && liveMetadata(root, uri);
        if (!liveStream && root == null) root = metadata(didl, false);
        JSONObject result = gateway.register(uri, liveStream);
        result.put("live", liveStream);
        String artwork = liveStream ? "" : albumArt(root);
        if (!artwork.isEmpty()) {
            try {
                JSONObject image = gateway.register(artwork, false);
                result.put("artworkToken", image.getString("token")).put("artworkUrl", image.getString("playbackUrl"));
            } catch (Exception error) { Log.d("EffeTuneNetwork", "OpenHome artwork unavailable", error); }
        }
        return result;
    }

    private static String albumArt(Element root) {
        if (root == null) return "";
        var elements = root.getOwnerDocument().getElementsByTagName("*");
        for (int i = 0; i < elements.getLength(); i++) {
            Node element = elements.item(i);
            String name = element.getNodeName();
            if (name.substring(name.lastIndexOf(':') + 1).equalsIgnoreCase("albumArtURI")) {
                String url = element.getTextContent().trim();
                return url.length() <= 8192 ? url : "";
            }
        }
        return "";
    }

    private static Element metadata(String text, boolean namespaces) {
        if (text.isEmpty() || text.contains("<!DOCTYPE")) return null;
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(namespaces);
            return factory.newDocumentBuilder().parse(new InputSource(new StringReader(text))).getDocumentElement();
        } catch (Exception ignored) { return null; }
    }

    private static boolean liveMetadata(Element root, String uri) {
        if (root == null || !DIDL.equals(root.getNamespaceURI()) || !"DIDL-Lite".equals(root.getLocalName())) return false;
        URI target = URI.create(uri);
        if (!"http".equalsIgnoreCase(target.getScheme()) || target.getHost() == null || target.getRawUserInfo() != null
                || target.getRawQuery() != null || target.getRawFragment() != null || !target.getRawPath().matches("/live/[0-9a-f]{32}"))
            return false;
        Element item = null;
        for (Node child = root.getFirstChild(); child != null; child = child.getNextSibling()) {
            if (!(child instanceof Element element)) continue;
            if (item != null || !DIDL.equals(element.getNamespaceURI()) || !"item".equals(element.getLocalName())) return false;
            item = element;
        }
        if (item == null) return false;
        boolean resource = false;
        int kinds = 0;
        for (Node child = item.getFirstChild(); child != null; child = child.getNextSibling()) {
            if (!(child instanceof Element element)) continue;
            String value = element.getTextContent().trim();
            boolean leaf = element.getElementsByTagName("*").getLength() == 0;
            if ("urn:effetune-org:metadata-1-0".equals(element.getNamespaceURI()) && "streamKind".equals(element.getLocalName())) {
                if (!leaf || !"live-pcm-v1".equals(value)) return false;
                kinds++;
            } else if (leaf && DIDL.equals(element.getNamespaceURI()) && "res".equals(element.getLocalName()) && uri.equals(value)) resource = true;
        }
        return kinds == 1 && resource;
    }

    private boolean respond(JSONObject response) {
        String id = response.optString("requestId");
        for (Pending job : pending.values()) {
            if (!job.sent || !job.pageId.equals(id)) continue;
            pending.remove(job.nativeId);
            control.removeCallbacks(job.timeout);
            JSONObject result = response.optJSONObject("result");
            boolean ok = Boolean.TRUE.equals(response.opt("ok"));
            boolean accepted;
            if (ok) {
                accepted = write(object("type", "response", "requestId", job.nativeId, "ok", true,
                        "result", response.has("result") ? response.opt("result") : new JSONObject()));
            } else {
                JSONObject error = response.optJSONObject("error");
                accepted = reject(job.nativeId, error == null ? "action-failed" : error.optString("code"));
            }
            if (accepted && ok) commit(job, result);
            else release(job.media);
            return accepted;
        }
        return false;
    }

    private void commit(Pending job, JSONObject result) {
        if (job.is("AVTransport", "SetAVTransportURI")) {
            if (job.order < lastAvSequence) { release(job.media); return; }
            lastAvSequence = job.order;
            if (job.media != null && job.media.live()) { releaseLive(); live = job.media; return; }
            releaseAll();
        } else if (job.is("Playlist", "DeleteId")) {
            release(tracks.remove(job.args.optLong("id"))); return;
        } else if (job.is("Playlist", "DeleteAll")) { releaseAll(); return; }
        if (job.media == null) return;
        long trackId = result == null ? 0 : result.optLong("newId");
        if (trackId > 0 && trackId <= 0xffffffffL) release(tracks.put(trackId, job.media));
        else release(job.media);
    }

    private boolean reject(String id, String code) {
        return write(object("type", "response", "requestId", id, "ok", false,
                "error", object("code", code.matches("[a-zA-Z][a-zA-Z0-9-]{0,63}") ? code : "action-failed")));
    }

    private void cancel(Pending job, String code) {
        pending.remove(job.nativeId);
        control.removeCallbacks(job.timeout);
        release(job.media);
        if (job.sent) events.send("openhome-cancel", object("requestId", job.pageId));
        reject(job.nativeId, code);
    }

    private void cancelAll(String code) {
        for (Pending job : new ArrayList<>(pending.values())) cancel(job, code);
    }

    private void release(Media media) {
        if (media == null) return;
        gateway.release(media.token());
        if (media.urls.has("artworkToken")) gateway.release(media.urls.optString("artworkToken"));
    }

    private void releaseLive() { release(live); live = null; }

    private void releaseAll() {
        releaseLive();
        for (Media media : tracks.values()) release(media);
        tracks.clear();
    }

    private static JSONObject feedbackMessage(JSONObject args) throws Exception {
        String connection = args.optString("connectionId");
        if (!connection.matches("[0-9a-f]{32}")) return null;
        JSONObject result = object("sessionId", args.getString("sessionId"), "connectionId", connection);
        if (!args.has("probeId")) return result;
        if (!args.optString("probeId").matches("[0-9a-f]{32}")) return null;
        result.put("probeId", args.getString("probeId"));
        for (String key : new String[]{"positionFrames", "revision", "dspMs", "softwareOutputMs", "physicalOutputMs"}) {
            Object value = args.opt(key);
            boolean position = key.equals("positionFrames"), revision = key.equals("revision");
            if (value != JSONObject.NULL || position || revision) {
                if (!(value instanceof Number number)) return null;
                double n = number.doubleValue();
                if (!Double.isFinite(n) || n < (position ? 1 : 0) || n > (position || revision ? 9007199254740991d : 10000)
                        || revision && n != Math.rint(n)) return null;
            }
            result.put(key, value);
        }
        return result;
    }

    @Override public void close() {
        closed = true;
        control.removeCallbacks(restart);
        if (resetId != null) finishReset(false);
        watchNetwork(false);
        stopPipe();
        releaseAll();
    }
}

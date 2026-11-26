package com.frieve.effetune;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.SystemClock;
import android.util.Log;
import java.net.InetAddress;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BiConsumer;
import org.json.JSONArray;
import org.json.JSONObject;
import static com.frieve.effetune.AudioService.object;
import static com.frieve.effetune.NetworkStreamServer.RATE;

/** The service control thread owns settings, sessions and the native packet reader. */
final class NetworkOutput implements AutoCloseable {
    interface Device {
        String id();
        String name();
        String type();
        InetAddress address();
        void play(Session session) throws Exception;
    }
    interface Discovery {
        void found(Device device);
        void lost(String id);
    }
    static final class Failure extends Exception {
        final String note;
        Failure(String note) { super(note); this.note = note; }
        Failure(String note, Exception cause) { super(note, cause); this.note = note; }
    }
    static final class Session {
        final NetworkStreamServer.Stream stream;
        final Device device;
        volatile String state = "connecting";
        volatile int latency = -1;
        volatile boolean measureAgain;
        volatile boolean finished;
        private short[] ring;
        private final short[] block = new short[4096];
        private int cursor, applied, desired, fade;
        private long inputFrame;
        private record Timing(long start, int length, double tap, long revision) {}
        private final ArrayDeque<Timing> history = new ArrayDeque<>();
        Session(Device device, NetworkStreamServer.Stream stream) { this.device = device; this.stream = stream; }

        void write(short[] pcm, int frames, int delay, double tapMs, long revision) {
            if (ring == null) ring = new short[(8 * RATE + 1) * 2];
            history.addLast(new Timing(inputFrame, frames, tapMs, revision));
            while (history.getFirst().start() + history.getFirst().length() <= inputFrame - 8L * RATE)
                history.removeFirst();
            if (delay == 0 && applied == 0 && fade == 0) {
                int samples = frames * 2, first = Math.min(samples, ring.length - cursor);
                System.arraycopy(pcm, 0, ring, cursor, first);
                System.arraycopy(pcm, first, ring, 0, samples - first);
                cursor = (cursor + samples) % ring.length;
                inputFrame += frames;
                stream.write(pcm, frames, tapMs, revision, 0);
                return;
            }
            if (fade == 0 && delay != applied) { desired = delay; fade = 256; }
            int length = ring.length;
            boolean stable = fade == 0;
            for (int frame = 0; frame < frames; frame++) {
                int offset = frame * 2;
                ring[cursor] = pcm[offset]; ring[cursor + 1] = pcm[offset + 1];
                int next = (cursor - 2 * desired + length) % length;
                int old = (cursor - 2 * applied + length) % length;
                if (fade > 0) fade--;
                for (int ch = 0; ch < 2; ch++)
                    block[offset + ch] = (short) ((ring[next + ch] * (256 - fade) + ring[old + ch] * fade) / 256);
                if (fade == 0) applied = desired;
                cursor += 2;
                if (cursor == length) cursor = 0;
            }
            double sourceMs = Double.NaN;
            long source = inputFrame - applied, sourceRevision = -1;
            if (stable) {
                for (Timing timing : history) {
                    if (timing.start() >= source + frames) break;
                    if (timing.start() + timing.length() <= source) continue;
                    if (timing.start() <= source) {
                        sourceMs = timing.tap() + (source - timing.start()) * 1000.0 / RATE;
                        sourceRevision = timing.revision();
                    } else if (sourceRevision != timing.revision() || !Double.isFinite(timing.tap())) {
                        sourceMs = Double.NaN; break;
                    }
                }
            }
            inputFrame += frames;
            stream.write(block, frames, sourceMs, sourceRevision, applied);
        }
    }

    private final Context context;
    private final Handler control;
    private final SharedPreferences prefs;
    private final BiConsumer<String, JSONObject> send;
    private final Runnable foregroundChanged;
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final Map<String, Device> devices = new HashMap<>();
    private final Map<String, Session> sessions = new HashMap<>();
    private final Map<String, String> failures = new HashMap<>();
    private final Map<String, Long> retry = new HashMap<>();
    private final short[] packet = new short[4096], quiet = new short[4096];
    private final long[] indices = new long[4];
    private final double[] timing = new double[4];
    private CastSender.Discovery cast;
    private UpnpRenderer.Discovery upnp;
    private NetworkStreamServer server;
    private NativeEngine engine;
    private boolean enabled, picker, local = true, paused, activeReceive, attached, closed, forceReport;
    private boolean lastLocal = true, lastEnabled, parallel, delayPending;
    private int localTrim, localMs, syncMs, syncRevision, localPathMs, physicalMs;
    private int appliedMs, delayId;
    private long previousPlanRevision = -1;
    private long generation, reportRevision = -1, routeRevision = -1, lastPacket, silenceAt, resyncUntil;
    private boolean marker, reachable;
    private long epoch = -1;
    private short lastLeft, lastRight;
    private boolean concealing;
    private JSONArray targets = new JSONArray();
    private JSONObject snapshot;
    private String published = "";
    private boolean foregroundHeld;

    NetworkOutput(Context context, Handler control, BiConsumer<String, JSONObject> send, Runnable foregroundChanged) {
        this.context = context; this.control = control; this.send = send; this.foregroundChanged = foregroundChanged;
        prefs = context.getSharedPreferences("audio", Context.MODE_PRIVATE);
        try { configure(new JSONObject(prefs.getString("networkOutput", "{}")), false); }
        catch (Exception error) { Log.w("EffeTuneNetwork", "Invalid saved configuration", error); }
        snapshot = status();
    }

    private void configure(JSONObject patch, boolean save) throws Exception {
        JSONArray selected = patch.has("targets") ? patch.getJSONArray("targets") : targets;
        JSONArray clean = new JSONArray();
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < selected.length(); i++) {
            JSONObject t = selected.getJSONObject(i);
            String id = t.getString("id"), type = t.getString("type");
            int trim = t.getInt("trimMs");
            if (id.isEmpty() || !ids.add(id) || !(type.equals("cast") || type.equals("upnp")) || trim < 0 || trim > 2000)
                throw new IllegalArgumentException("Invalid network target");
            clean.put(object("id", id, "name", t.getString("name"), "type", type, "enabled", t.getBoolean("enabled"), "trimMs", trim));
        }
        int trim = patch.has("localTrimMs") ? patch.getInt("localTrimMs") : localTrim;
        if (trim < -2000 || trim > 2000) throw new IllegalArgumentException("Invalid local trim");
        boolean nextEnabled = patch.has("enabled") ? patch.getBoolean("enabled") : enabled;
        boolean nextLocal = patch.has("localEnabled") ? patch.getBoolean("localEnabled") : local;
        if (save) prefs.edit().putString("networkOutput", object("enabled", nextEnabled, "localEnabled", nextLocal,
                "localTrimMs", trim, "targets", clean).toString()).apply();
        enabled = nextEnabled; local = nextLocal; localTrim = trim; targets = clean;
    }

    JSONObject command(String name, JSONObject args, NativeEngine owner) throws Exception {
        switch (name.substring("network.output.".length())) {
            case "getStatus": return snapshot;
            case "getClock": return object("time", SystemClock.elapsedRealtime());
            case "rendererReady": forceReport = true; break;
            case "rendererUnavailable": picker = false; break;
            case "setPickerOpen": picker = args.getBoolean("open"); break;
            case "setConfiguration": configure(args, true); break;
            case "setTargetEnabled": {
                String id = args.getString("id");
                boolean selected = args.getBoolean("enabled");
                JSONArray list = new JSONArray();
                JSONObject choice = null;
                for (int i = 0; i < targets.length(); i++) {
                    JSONObject t = new JSONObject(targets.getJSONObject(i).toString());
                    if (!enabled) t.put("enabled", false);
                    if (id.equals(t.getString("id"))) choice = t; else list.put(t);
                }
                if (choice == null) {
                    Device d = findDevice(id);
                    if (d == null) throw new IllegalArgumentException("Unknown network target");
                    choice = object("id", id, "type", d.type(), "name", d.name(), "trimMs", 0);
                }
                list.put(choice.put("enabled", selected));
                configure(object("enabled", enabled || selected, "targets", list), true);
                failures.remove(id); retry.remove(id);
                break;
            }
            case "resync":
                syncRevision++;
                failures.clear(); retry.clear();
                resyncUntil = SystemClock.elapsedRealtime() + 30000;
                for (Session s : sessions.values()) {
                    if ("cast".equals(s.device.type()) && "playing".equals(s.state)) s.measureAgain = true;
                    else if (s.stream.feedbackLatency < 0) s.stream.close();
                }
                break;
            case "setReceiveSession": {
                long next = args.getLong("generation");
                if (next >= generation) {
                    boolean active = args.getBoolean("active");
                    require(owner.setNetworkReceiveSession(active, next));
                    generation = next; activeReceive = active; forceReport = true;
                }
                break;
            }
            case "setSendPaused":
                paused = args.getBoolean("paused"); require(owner.setNetworkOutput(attached, paused)); break;
            case "updateRoute":
                // Path lengths and packet clock anchors are already available inside the service.
                double outputMs = args.optDouble("physicalOutputMs", -1);
                if (outputMs >= 0 && outputMs <= 10000 && Math.abs(physicalMs - outputMs) >= 20)
                    physicalMs = (int) Math.round(outputMs);
                break;
            default: throw new IllegalArgumentException("Unknown network output command");
        }
        update(owner, false);
        return snapshot;
    }

    private boolean outputHandedOff;

    void setOutputHandedOff(boolean handedOff, NativeEngine owner) {
        if (outputHandedOff == handedOff && !(handedOff && picker)) return;
        if (handedOff) picker = false;
        outputHandedOff = handedOff;
        try { update(owner, false); }
        catch (Exception error) { Log.w("EffeTuneNetwork", "Cannot update network output after navigation", error); }
    }

    JSONObject snapshot() { return snapshot; }
    boolean sending() {
        for (Session s : sessions.values()) if (!s.stream.closed) return true;
        return false;
    }

    private void reconcile(boolean allowed, long now) throws Exception {
        boolean send = allowed && enabled && !outputHandedOff;
        boolean discover = send || (allowed && picker);
        if (discover && cast == null) {
            cast = new CastSender.Discovery(context, control, discovery);
            cast.start();
            upnp = new UpnpRenderer.Discovery(context, control, discovery);
            upnp.start();
        } else if (!discover && cast != null) {
            cast.close(); cast = null;
            if (upnp != null) { upnp.close(); upnp = null; }
            devices.clear();
        }
        Set<String> wanted = new HashSet<>();
        for (int i = 0; send && i < targets.length(); i++) {
            JSONObject t = targets.getJSONObject(i);
            if (t.getBoolean("enabled")) wanted.add(t.getString("id"));
        }
        failures.keySet().retainAll(wanted);
        retry.keySet().retainAll(wanted);
        for (Iterator<Session> it = sessions.values().iterator(); it.hasNext();) {
            Session s = it.next();
            if (!wanted.contains(s.device.id()) || findDevice(s.device.id()) == null) s.stream.close();
            if (s.finished) it.remove();
        }
        for (String id : wanted) {
            Device device = findDevice(id);
            if (device == null || sessions.containsKey(id) || now < retry.getOrDefault(id, 0L)) continue;
            try {
                if (server == null) server = new NetworkStreamServer();
                Session s = new Session(device, server.new Stream(device.address(),
                        device.type().equals("cast") ? "audio/wav" : "audio/flac"));
                sessions.put(id, s); failures.remove(id);
                workers.execute(() -> play(s));
            } catch (Exception error) { failed(id, "startFailed", error); }
        }
        if (sessions.isEmpty() && server != null) { server.close(); server = null; }
    }

    private boolean isOwnRenderer(Device device) {
        return "upnp".equals(device.type()) && OpenHomeHost.isOwnRenderer(prefs, device.id());
    }

    private Device findDevice(String id) {
        Device device = devices.get(id);
        return device == null || isOwnRenderer(device) ? null : device;
    }

    private final Discovery discovery = new Discovery() {
        @Override public void found(Device d) { devices.put(d.id(), d); }
        @Override public void lost(String id) {
            devices.remove(id);
            Session s = sessions.get(id);
            if (s != null) { failures.put(id, "offline"); s.stream.close(); }
        }
    };

    private void failed(String id, String note, Exception error) {
        Log.w("EffeTuneNetwork", "Receiver session failed: " + note, error);
        failures.put(id, note);
        retry.put(id, note.equals("offline") ? SystemClock.elapsedRealtime() + 30000 : Long.MAX_VALUE);
    }

    private void play(Session s) {
        Exception problem = null;
        try { s.device.play(s); }
        catch (Exception error) { problem = error; }
        final Exception cause = problem;
        control.post(() -> {
            if (closed) return;
            if (!s.stream.closed && sessions.get(s.device.id()) == s) {
                String note = cause instanceof Failure ? ((Failure) cause).note : "offline";
                failed(s.device.id(), s.stream.failure != null ? s.stream.failure : note, cause);
            }
            s.stream.close();
            s.finished = true;
        });
    }

    void tick(NativeEngine owner, long revision, int[] outputStats, boolean secondBranch) {
        if (outputHandedOff && !picker && sessions.isEmpty() && !attached && cast == null) return;
        try {
            forceReport |= reportRevision != revision;
            reportRevision = revision;
            if (parallel != secondBranch) {
                parallel = secondBranch;
                if (parallel && (enabled || !local)) appliedMs = -1;
                if (parallel && activeReceive) require(owner.setNetworkReceiveSession(true, generation));
            }
            if (!enabled && !picker && !activeReceive && !forceReport && owner == engine && !attached
                    && !delayPending && sessions.isEmpty() && cast == null) return;
            if (outputStats.length >= 3 && outputStats[0] > 0 && outputStats[2] > 0) {
                int estimate = (int) Math.round(outputStats[2] * 1000.0 / outputStats[0]);
                if (physicalMs == 0 || Math.abs(estimate - physicalMs) >= 20) physicalMs = estimate;
            }
            update(owner, true);
        } catch (Exception error) { Log.w("EffeTuneNetwork", "Network control tick failed", error); }
    }

    private static void require(int result) {
        if (result < 0) throw new IllegalStateException("Native network command failed");
    }

    private void update(NativeEngine owner, boolean tick) throws Exception {
        long now = SystemClock.elapsedRealtime();
        boolean allowed = Build.VERSION.SDK_INT < 37 ||
                context.checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") == PackageManager.PERMISSION_GRANTED;
        if (owner != engine) {
            engine = owner; attached = false; appliedMs = -1;
            epoch = -1; lastLeft = lastRight = 0; concealing = false;
            if (generation > 0 || activeReceive) require(owner.setNetworkReceiveSession(activeReceive, generation));
            forceReport = true;
        }
        reconcile(allowed, now);
        boolean active = sending();
        if (active != attached) {
            require(engine.setNetworkOutput(active, paused));
            attached = active; lastPacket = silenceAt = now;
            epoch = -1; lastLeft = lastRight = 0; concealing = false;
        }
        if (attached && tick) {
            boolean received = false;
            for (int i = 0; i < 8 && engine.popNetworkPacket(packet, indices, timing); i++) {
                try {
                    double tap = indices[2] == indices[3] && timing[2] > 0 ?
                            now + (timing[0] - timing[3]) * 1000.0 / timing[2] : Double.NaN;
                    if (concealing || (epoch >= 0 && indices[0] != epoch)) {
                        for (int f = 0; f < 128; f++) {
                            int gain = f + 1;
                            packet[2 * f] = (short) ((lastLeft * (128 - gain) + packet[2 * f] * gain) / 128);
                            packet[2 * f + 1] = (short) ((lastRight * (128 - gain) + packet[2 * f + 1] * gain) / 128);
                        }
                    }
                    epoch = indices[0]; concealing = false;
                    lastLeft = packet[packet.length - 2]; lastRight = packet[packet.length - 1];
                    feed(packet, packet.length / 2, tap, indices[2]);
                } finally { require(engine.acknowledgeNetwork(indices[0], indices[1])); }
                received = true;
            }
            if (received) lastPacket = silenceAt = now;
            else if (now - lastPacket >= 250) {
                int count = (int) (Math.min(1000, now - silenceAt) * RATE / 1000);
                silenceAt = now;
                while (count > 0) {
                    int n = Math.min(count, quiet.length / 2);
                    if (!concealing) {
                        for (int f = 0; f < Math.min(n, 128); f++) {
                            quiet[2 * f] = (short) (lastLeft * (127 - f) / 128);
                            quiet[2 * f + 1] = (short) (lastRight * (127 - f) / 128);
                        }
                    }
                    feed(quiet, n, Double.NaN, -1); count -= n;
                    if (!concealing) {
                        Arrays.fill(quiet, 0, 256, (short) 0);
                        concealing = true; lastLeft = lastRight = 0;
                    }
                }
            }
        }
        if (forceReport || (tick && (enabled || activeReceive || delayPending))) {
            String report = engine.readNetworkReports(forceReport);
            forceReport = false;
            if (report != null) {
                JSONArray messages = new JSONArray(report);
                for (int i = 0; i < messages.length(); i++) {
                    JSONObject msg = messages.getJSONObject(i);
                    if (msg.optString("type").equals("networkDelayApplied") && msg.optInt("requestId") == delayId) {
                        delayPending = false;
                        msg.put("syncDelayMs", syncMs).put("syncRevision", syncRevision);
                    }
                    if (msg.optString("type").equals("networkRoute")) marker = !msg.isNull("sendId");
                    if (msg.optString("type").equals("networkPaths")) {
                        JSONObject tap = msg.optJSONObject("send");
                        reachable = tap != null && !tap.isNull("localSamples");
                        routeRevision = msg.getLong("tapRevision");
                        localPathMs = reachable ? (int) Math.round((tap.getDouble("localSamples") +
                                msg.getDouble("outputDelaySamples")) * 1000 / msg.getInt("sampleRate")) : 0;
                    }
                    send.accept("network-report", msg);
                }
            }
        }
        plan();
        if (lastEnabled != enabled || lastLocal != local || appliedMs != localMs) {
            require(engine.setNetworkLocalDelay(++delayId, enabled, localMs, local));
            lastEnabled = enabled; lastLocal = local; appliedMs = localMs; delayPending = true;
        }
        if (foregroundHeld != active) { foregroundHeld = active; foregroundChanged.run(); }
        JSONObject next = status();
        String key = next.toString();
        if (!key.equals(published)) { published = key; snapshot = next; send.accept("network-status", next); }
    }

    private boolean measured(Session s) {
        return marker && s != null && s.stream.feedbackRevision == routeRevision &&
                SystemClock.elapsedRealtime() - s.stream.feedbackAt <= 3000 && s.stream.feedbackLatency >= 0;
    }

    private int latency(Session s) {
        if (measured(s)) return s.stream.feedbackLatency;
        return s != null && s.latency >= 0 ? s.latency : 2000;
    }

    private void plan() {
        int goal = 0;
        for (int i = 0; enabled && i < targets.length(); i++) {
            JSONObject target = targets.optJSONObject(i);
            if (!target.optBoolean("enabled")) continue;
            goal = Math.max(marker ? 0 : 2000, Math.max(goal, latency(sessions.get(target.optString("id")))));
            if (marker && local && reachable) goal = Math.max(goal, localPathMs + physicalMs - localTrim);
        }
        int nextLocal = goal == 0 || (marker && (!local || !reachable)) ? 0 :
                Math.min(8000, Math.max(0, goal + localTrim - physicalMs - (marker ? localPathMs : 0)));
        long planRevision = marker && enabled ? routeRevision : -1;
        if (nextLocal != localMs || goal != syncMs || previousPlanRevision != planRevision) syncRevision++;
        localMs = nextLocal; syncMs = goal; previousPlanRevision = planRevision;
    }

    private void feed(short[] samples, int frames, double tap, long revision) {
        for (int i = 0; i < targets.length(); i++) {
            JSONObject t = targets.optJSONObject(i);
            Session s = sessions.get(t.optString("id"));
            if (s == null || s.stream.closed) continue;
            int delayMs = Math.max(0, Math.min(8000, syncMs - latency(s) + t.optInt("trimMs")));
            s.write(samples, frames, (int) Math.round(delayMs * RATE / 1000.0), tap, revision);
        }
    }

    private JSONObject status() {
        Map<String, JSONObject> entries = new HashMap<>();
        for (int i = 0; i < targets.length(); i++) {
            JSONObject t = targets.optJSONObject(i);
            entries.put(t.optString("id"), t);
        }
        for (Device d : devices.values()) {
            if (!isOwnRenderer(d)) entries.putIfAbsent(d.id(), object("id", d.id(), "type", d.type(), "name", d.name()));
        }
        List<JSONObject> rows = new ArrayList<>();
        boolean syncing = false, allMeasured = true;
        int arrival = 0;
        for (JSONObject t : entries.values()) {
            String id = t.optString("id");
            Device device = findDevice(id);
            Session s = sessions.get(id);
            String note = failures.get(id);
            String state = !enabled || !t.optBoolean("enabled") ? "searching" : note != null ? "unreachable" :
                    s == null || s.stream.closed ? "searching" : s.state;
            syncing |= s != null && "cast".equals(s.device.type()) && !s.stream.closed && (s.latency < 0 || s.measureAgain);
            JSONObject row = object("id", id, "name", device == null ? t.optString("name") : device.name(),
                    "type", t.optString("type"), "enabled", t.optBoolean("enabled"), "trimMs", t.optInt("trimMs"),
                    "state", state, "note", note == null ? JSONObject.NULL : note, "present", device != null);
            if (marker && enabled && t.optBoolean("enabled")) {
                int ms = syncMs - latency(s) + t.optInt("trimMs");
                boolean limited = ms > 8000 || (local && reachable && syncMs + localTrim - localPathMs - physicalMs > 8000);
                boolean settled = !limited && measured(s) && s.fade == 0 && s.applied == Math.round(ms * RATE / 1000.0)
                        && (!local || !reachable || physicalMs > 0);
                allMeasured &= settled;
                if (settled) arrival = Math.max(arrival, latency(s) + ms);
                try { row.put("syncState", limited ? "limited" : settled ? "synced" : "unmeasured"); }
                catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
                syncing |= measured(s) && !settled && !limited;
            }
            rows.add(row);
        }
        rows.sort(Comparator.comparing((JSONObject t) -> t.optString("name"), String.CASE_INSENSITIVE_ORDER)
                .thenComparing(t -> t.optString("id")));
        if (!syncing || SystemClock.elapsedRealtime() >= resyncUntil) resyncUntil = 0;
        JSONObject result = object("enabled", enabled, "localEnabled", local, "localTrimMs", localTrim, "localDelayMs", localMs,
                "syncDelayMs", syncMs, "syncRevision", syncRevision, "syncing", syncing, "resyncing", resyncUntil != 0,
                "targets", new JSONArray(rows));
        if (marker && enabled && syncMs > 0) {
            try { result.put("networkTiming", object("measured", allMeasured,
                    "arrivalMs", allMeasured ? arrival : JSONObject.NULL, "revision", routeRevision)); }
            catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
        }
        return result;
    }

    @Override public void close() {
        closed = true;
        if (cast != null) cast.close();
        if (upnp != null) upnp.close();
        if (server != null) server.close();
        workers.shutdown();
    }
}

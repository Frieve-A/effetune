package com.frieve.effetune;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.HashMap;
import java.security.SecureRandom;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.BooleanSupplier;
import java.net.NetworkInterface;
import java.net.Inet4Address;
import org.json.JSONArray;
import org.json.JSONObject;

/** Sole owner of the engine and playback state, independent of the WebView lifetime. */
public final class AudioService extends Service {
    interface Reply { void complete(JSONObject result, HostError error); }
    interface Events { void send(String name, JSONObject value); }
    static final class HostError extends Exception {
        final String code;
        HostError(String code, String message) { super(message); this.code = code; }
    }
    public final class LocalBinder extends Binder { AudioService getService() { return AudioService.this; } }
    private final IBinder binder = new LocalBinder();
    private HandlerThread thread;
    private Handler control;
    private NativeEngine engine;
    private PcmDecoder decoder;
    private MidiInput midi;
    private MidiMappings mappings;
    private boolean resumeEngineOnFocus;
    private long lastMidiHistory = Long.MIN_VALUE;
    private AudioManager audioManager;
    private AudioFocusRequest focus;
    private MediaSession session;
    private Object attached;
    private Events events;
    private boolean visible;
    private boolean telemetryVisible = true;
    private boolean running;
    private volatile boolean destroyed;
    private boolean playing;
    private boolean resumeOnFocus;
    private boolean microphone;
    private int acquiredInputDevice = -1;
    private boolean useInputWithPlayer;
    private boolean masterBypass;
    private boolean decoderEnded;
    private boolean sourceReady;
    private boolean sourceExhausted;
    private boolean autoSuspended;
    private boolean temporalMustProcess;
    private String powerMode = "balanced";
    private double silenceThresholdDb = -80;
    private double suspendDelay = 300;
    private float lastPowerSequence = -1;
    private String powerState = "SUSPENDED";
    private long revision;
    private long generation;
    private long positionUs;
    private long renderStart;
    private long durationUs;
    private double speed = 1;
    private boolean preservePitch = true;
    private float volume = 1;
    private float focusGain = 1;
    private boolean muted;
    private int inputDevice = -1;
    private int preferredOutputDevice;
    private JSONObject source;
    private PlaybackQueueStore queue;
    private JSONObject stagedQueueSettings;
    private String queueTransaction;
    private String queueTransactionRemoteId;
    private int queueIndex = -1;
    private String repeat = "off";
    private boolean shuffle;
    private final SecureRandom random = new SecureRandom();
    private JSONArray pipeline = new JSONArray();
    private JSONObject pipelineRequest;
    private NativeParameterPacker packer;
    private String slot = "A";
    private final HashMap<String, JSONObject> slots = new HashMap<>();
    private final ArrayList<JSONObject> undo = new ArrayList<>();
    private final ArrayList<JSONObject> redo = new ArrayList<>();
    private final HashMap<String, Integer> instances = new HashMap<>();
    private final HashMap<String, String> instanceTypes = new HashMap<>();
    private final HashMap<Integer, String> runtimeEvents = new HashMap<>();
    private long instanceEpoch;
    private int[] telemetryTapIds = new int[0];
    private AssetTransfers assets;
    private MeasurementCapture measurement;
    private RecordingMonitor recordingMonitor;
    private boolean focusHeld;
    private boolean outputRecoveryAttempted;
    private long outputRecoveryFrame;
    private RemoteControlServer remote;
    private boolean rendererReady;
    private JSONObject rendererState = new JSONObject();
    private final HashMap<String, Consumer<JSONObject>> remotePending = new HashMap<>();
    private final HashMap<String, BooleanSupplier> remoteAuthority = new HashMap<>();
    private final HashMap<String, JSONObject> previews = new HashMap<>();

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { control.post(() -> stopAudio()); }
    };
    private final AudioDeviceCallback devices = new AudioDeviceCallback() {
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            control.post(() -> {
                if (engine != null) measurement.invalidate(engine);
                for (AudioDeviceInfo device : removed) {
                    if (device.getId() == inputDevice) {
                        engine.setInputDevice(-1); acquiredInputDevice = -1; inputDevice = -1; microphone = false;
                    }
                }
                changed();
            });
        }
        @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { control.post(() -> changed()); }
    };

    @Override public void onCreate() {
        super.onCreate();
        thread = new HandlerThread("EffeTune control");
        thread.start();
        control = new Handler(thread.getLooper());
        audioManager = getSystemService(AudioManager.class);
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("audio", "Audio playback", NotificationManager.IMPORTANCE_LOW));
        session = new MediaSession(this, "EffeTune");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { internal("playback.play", new JSONObject()); }
            @Override public void onPause() { internal("playback.pause", new JSONObject()); }
            @Override public void onStop() { internal("audio.stop", new JSONObject()); }
            @Override public void onSkipToNext() { internal("playback.next", new JSONObject()); }
            @Override public void onSkipToPrevious() { internal("playback.previous", new JSONObject()); }
            @Override public void onSeekTo(long position) { try { internal("playback.seek", new JSONObject().put("position", position / 1000.0)); } catch (Exception ignored) { } }
        }, control);
        session.setActive(true);
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setOnAudioFocusChangeListener(change -> {
                    if (engine == null) return;
                    focusHeld = change == AudioManager.AUDIOFOCUS_GAIN || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK;
                    focusGain = change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK ? 0.2f : 1;
                    if (change != AudioManager.AUDIOFOCUS_GAIN) measurement.invalidate(engine);
                    engine.setGain(focusGain);
                    if (change == AudioManager.AUDIOFOCUS_GAIN) {
                        if (resumeEngineOnFocus) { resumeEngineOnFocus = false; if (engine.start() >= 0) { running = true; powerState = "ACTIVE"; refreshInputOwnership(); } }
                        if (resumeOnFocus) { resumeOnFocus = false; internal("playback.play", new JSONObject()); }
                    } else if (change != AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                        boolean transientLoss = change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT;
                        boolean resume = transientLoss && playing;
                        clearPreviews(); pause(false); resumeOnFocus = resume; resumeEngineOnFocus = transientLoss && running;
                        engine.setInputDevice(-1); acquiredInputDevice = -1; microphone = false; engine.stop(); running = false; powerState = "SUSPENDED";
                        if (!transientLoss) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); updateRemoteLifetime(); }
                        changed();
                    }
                }, control).build();
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        audioManager.registerAudioDeviceCallback(devices, control);
        control.post(() -> {
            engine = new NativeEngine(48000, 4096);
            useInputWithPlayer = getSharedPreferences("audio", MODE_PRIVATE).getBoolean("useInputWithPlayer", false);
            assets = new AssetTransfers(this);
            measurement = new MeasurementCapture(this);
            recordingMonitor = new RecordingMonitor(audioManager, control, engine::getInputSessionId, () -> {
                measurement.invalidate(engine); engine.setGain(focusGain);
                refreshInputOwnership();
                send("measurement-invalidated", object("reason", "recording-conditions-changed"));
            });
            queue = new PlaybackQueueStore(this);
            try {
                packer = new NativeParameterPacker(this);
                packer.restoreNames(new JSONObject(getSharedPreferences("audio", MODE_PRIVATE).getString("effectNames", "{}")));
            } catch (Exception error) { throw new IllegalStateException("Android DSP contract could not load", error); }
            mappings = new MidiMappings(new MidiMappings.Sink() {
                @Override public JSONArray pipeline() throws Exception { return new JSONArray(pipeline.toString()); }
                @Override public void commit(JSONArray records, boolean physical) throws Exception {
                    for (int i = 0; i < records.length(); i++) packer.packRecord(records.getJSONObject(i));
                    JSONObject prepared = packer.prepareRecords(records, masterBypass, slot);
                    long now = SystemClock.elapsedRealtime();
                    if (physical && (lastMidiHistory == Long.MIN_VALUE || now - lastMidiHistory > 1000)) replacePipeline(prepared); else applyPipeline(prepared);
                    if (physical) lastMidiHistory = now;
                    changed(); send("pipeline-changed", snapshot());
                }
                @Override public void action(String key, int direction) throws Exception { mappingAction(key, direction); }
                @Override public double readGlobal(String key) { return mappingValue(key); }
                @Override public void writeGlobal(String key, double value) { if (key.equals("playbackSpeed")) internal("playback.speed", object("speed", value, "preservePitch", preservePitch)); }
            });
            try { String savedMappings = getSharedPreferences("audio", MODE_PRIVATE).getString("midiMappings", null); if (savedMappings != null) mappings.configure(new JSONObject(savedMappings), SystemClock.elapsedRealtime(), System.currentTimeMillis()); }
            catch (Exception error) { Log.w("EffeTuneMidi", "Stored mappings could not be restored", error); }
            midi = new MidiInput(this, control, this::midiEvent);
            try { String savedMappings = getSharedPreferences("audio", MODE_PRIVATE).getString("midiMappings", null); if (savedMappings != null) midi.configure(new JSONObject(savedMappings)); }
            catch (Exception error) { Log.w("EffeTuneMidi", "Stored device selection could not be restored", error); }
            decoder = new PcmDecoder(this, engine, new PcmDecoder.Listener() {
                @Override public void format(long token, long duration) { control.post(() -> { if (!destroyed && token == generation) { durationUs = duration; changed(); } }); }
                @Override public void ended(long token) { control.post(() -> { if (!destroyed && token == generation) decoderEnded = true; }); }
                @Override public void failed(long token, Exception error) {
                    control.post(() -> {
                        if (destroyed || token != generation) return;
                        Log.e("EffeTuneDecode", "Source decoding failed", error);
                        pause(false); sourceReady = false;
                        send("error", object("code", "source-unavailable", "message", "This audio source cannot be played. Select another file or reconnect to the music server."));
                    });
                }
            });
            try {
                JSONObject savedSlots = new JSONObject(getSharedPreferences("audio", MODE_PRIVATE).getString("slots", "{}"));
                for (String key : new String[]{"A", "B"}) if (savedSlots.has(key)) slots.put(key, savedSlots.getJSONObject(key));
            } catch (Exception error) { Log.w("EffeTune", "Stored comparison slots could not be restored", error); }
            String saved = getSharedPreferences("audio", MODE_PRIVATE).getString("pipeline", null);
            if (saved != null) try { applyPipeline(new JSONObject(saved)); revision = 1; } catch (Exception error) { Log.w("EffeTune", "Stored pipeline could not be restored", error); }
            try {
                JSONObject queueSettings = queue.settings(); queueIndex = queueSettings.optInt("index", -1);
                repeat = queueSettings.optString("repeat", "off"); shuffle = queueSettings.optBoolean("shuffle", false);
                double savedSpeed = queueSettings.optDouble("speed", 1), savedVolume = queueSettings.optDouble("volume", 1);
                if (Double.isFinite(savedSpeed) && savedSpeed >= 0.25 && savedSpeed <= 4) speed = savedSpeed;
                if (Double.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) volume = (float) savedVolume;
                preservePitch = queueSettings.optBoolean("preservePitch", true); muted = queueSettings.optBoolean("muted", false);
                engine.setPlayerGain(muted ? 0 : volume);
                if (queueIndex >= 0 && queueIndex < queue.length()) {
                    source = queue.getJSONObject(queueIndex);
                    if (source.getInt("queueEntryId") == queueSettings.optInt("positionEntryId", -1)) {
                        positionUs = Math.max(0, queueSettings.optLong("positionUs", 0));
                        durationUs = Math.max(0, queueSettings.optLong("durationUs", 0));
                        if (durationUs > 0) positionUs = Math.min(positionUs, durationUs);
                        sourceExhausted = queueSettings.optBoolean("sourceExhausted", false);
                    }
                }
            } catch (Exception error) { Log.w("EffeTune", "Stored queue could not be restored", error); }
            control.post(tick);
        });
    }

    @Override public IBinder onBind(Intent intent) { return binder; }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent != null && intent.getAction() != null) internal(intent.getAction(), new JSONObject());
        return START_NOT_STICKY;
    }

    void attach(Object owner, Events observer, boolean foreground) { control.post(() -> { attached = owner; events = observer; visible = foreground; refreshInputOwnership(); runtimeEvents.clear(); updateRemoteLifetime(); send("snapshot", snapshot()); }); }
    void detach(Object owner) { control.post(() -> { if (attached == owner) { attached = null; events = null; visible = false; clearPreviews(); rendererReady = false; if (mappings != null) mappings.setLearning(false); updateRemoteLifetime(); } }); }
    void setVisible(Object owner, boolean value) { control.post(() -> { if (attached == owner) { visible = value; if (!value) clearPreviews(); else refreshInputOwnership(); updateRemoteLifetime(); } }); }

    void command(JSONObject request, Reply reply, boolean fromVisibleUi) {
        command(request, reply, fromVisibleUi, () -> true);
    }
    private void command(JSONObject request, Reply reply, boolean fromVisibleUi, BooleanSupplier authority) {
        if (destroyed) { reply.complete(null, new HostError("audio-unavailable", "Audio controls closed. Reopen EffeTune and try again.")); return; }
        control.post(() -> {
            try {
                if (destroyed) throw new HostError("audio-unavailable", "Audio controls closed. Reopen EffeTune and try again.");
                if (!authority.getAsBoolean()) throw new HostError("unauthorized", "Remote access changed. Reconnect and try again.");
                String name = request.getString("command");
                if (request.has("expectedRevision") && request.getLong("expectedRevision") != revision) throw new HostError("revision-conflict", "Audio settings changed. Refresh the controls and try again.");
                JSONObject args = request.getJSONObject("payload");
                if (args.has("_remoteRequestId")) requireRemoteAuthority(args.getString("_remoteRequestId"));
                if (name.startsWith("remote.")) { reply.complete(remoteCommand(name, args, fromVisibleUi), null); return; }
                if (name.startsWith("pipeline.asset.")) {
                    JSONObject previous = pipelineRequest == null ? null : new JSONObject(pipelineRequest.toString());
                    JSONObject clearedParameters = name.equals("pipeline.asset.clear") ? AssetTransfers.assetParameters(args.optJSONObject("externalAssetParameters")) : null;
                    JSONObject result = assets.command(name, args, instances, instanceTypes, engine);
                    if (name.equals("pipeline.asset.commit") || name.equals("pipeline.asset.clear")) {
                        if (previous != null) {
                            undo.add(previous); if (undo.size() > 100) undo.remove(0); redo.clear();
                            JSONObject next = new JSONObject(pipelineRequest.toString()).put("assetRefs", assets.snapshot());
                            if (name.equals("pipeline.asset.clear")) {
                                JSONArray records = next.getJSONArray("plugins");
                                for (int i = 0; i < records.length(); i++) {
                                    JSONObject record = records.getJSONObject(i);
                                    if (record.getInt("id") == args.getInt("pluginId")) mergeAssetParameters(record, clearedParameters);
                                }
                            }
                            next.put("descriptor", packer.prepareRecords(next.getJSONArray("plugins"), masterBypass, slot).getString("descriptor"));
                            applyPipeline(next); collectAssets();
                        }
                        changed();
                    }
                    reply.complete(result.put("revision", revision), null); return;
                }
                if (name.startsWith("measurement.")) {
                    if (name.equals("measurement.start") || name.equals("measurement.noise.start")) {
                        if (!fromVisibleUi || !visible || inputDevice < 0 || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) throw new HostError("permission-required", "Select a microphone and allow access before measuring.");
                        startAudio(true); pause(false); decoder.cancel(); generation = engine.beginSource();
                        sourceReady = false;
                        reconcileInputOwnership(true);
                        if (name.equals("measurement.start")) engine.setGain(1);
                        if (!recordingMonitor.arm()) throw new HostError("measurement-unavailable", "The microphone is unavailable or being used by another app. Try the measurement again.");
                    }
                    JSONObject value = measurement.command(name, args, engine);
                    if (!measurement.isRunning()) recordingMonitor.disarm();
                    if (name.equals("measurement.cancel") || name.equals("measurement.noise.stop")) engine.setGain(focusGain);
                    refreshInputOwnership();
                    reply.complete(value, null); return;
                }
                boolean changed = true;
                switch (name) {
                    case "pipeline.catalog":
                        JSONObject names = packer.catalog(args.getJSONArray("effects"));
                        getSharedPreferences("audio", MODE_PRIVATE).edit().putString("effectNames", names.toString()).apply(); changed = false; break;
                    case "pipeline.undo": moveHistory(undo, redo); break;
                    case "pipeline.redo": moveHistory(redo, undo); break;
                    case "pipeline.slot":
                        String destination = args.getString("slot");
                        if (!destination.equals("A") && !destination.equals("B")) throw new IllegalArgumentException("Invalid slot");
                        if (!destination.equals(slot)) replacePipeline(slots.containsKey(destination) ? slots.get(destination) : packer.prepareChain(new JSONArray(), masterBypass, destination));
                        break;
                    case "pipeline.copySlot":
                        String from = args.getString("from"), to = args.getString("to");
                        if ((!from.equals("A") && !from.equals("B")) || (!to.equals("A") && !to.equals("B"))) throw new IllegalArgumentException("Invalid slot");
                        JSONObject copy = new JSONObject((slots.containsKey(from) ? slots.get(from) : packer.prepareChain(new JSONArray(), masterBypass, from)).toString()).put("slot", to);
                        if (to.equals(slot)) replacePipeline(copy); else { slots.put(to, copy); persistSlots(); collectAssets(); }
                        break;
                    case "audio.devices": reply.complete(audioDevices(), null); return;
                    case "audio.clock": reply.complete(object("frame", engine.getAudioFrameTime(), "sampleRate", engine.getSampleRate()), null); return;
                    case "pipeline.preview": preview(args, fromVisibleUi); reply.complete(snapshot(), null); return;
                    case "pipeline.parameters.schedule":
                        Integer instance = instances.get(String.valueOf(args.get("pluginId")));
                        if (instance == null) throw new HostError("stale-pipeline", "The effect changed. Try again.");
                        JSONArray values = args.getJSONArray("parameterValues");
                        if (values.length() > 1024) throw new IllegalArgumentException("Too many parameters");
                        float[] packed = new float[values.length()];
                        for (int i = 0; i < packed.length; i++) { packed[i] = (float) values.getDouble(i); if (!Float.isFinite(packed[i])) throw new IllegalArgumentException("Invalid parameter"); }
                        if (engine.scheduleParameters(instance, packed, (int) args.getLong("layoutHash"), args.getLong("frame")) < 0) throw new HostError("automation-busy", "Too many changes are scheduled. Try again shortly.");
                        changed = false; break;
                    case "midi.configure":
                        mappings.configure(args, SystemClock.elapsedRealtime(), System.currentTimeMillis());
                        midi.configure(args);
                        getSharedPreferences("audio", MODE_PRIVATE).edit().putString("midiMappings", new JSONObject(args.toString()).put("learning", false).toString()).apply();
                        reply.complete(object("nativeKinds", new JSONArray(MidiMappings.NATIVE_KINDS)), null); return;
                    case "midi.list": reply.complete(midi.list(), null); return;
                    case "midi.open": midi.open(args.getString("id"), reply); return;
                    case "midi.close": midi.close(args.getString("id")); changed = false; break;
                    case "snapshot.get": changed = false; break;
                    case "pipeline.set": args.remove("assetRefs"); replacePipeline(args); break;
                    case "pipeline.bypass": replacePipeline(packer.prepareRecords(new JSONArray(pipeline.toString()), args.getBoolean("bypass"), slot)); break;
                    case "audio.start": outputRecoveryAttempted = false; startAudio(fromVisibleUi); break;
                    case "audio.stop": stopAudio(); break;
                    case "audio.input": setInput(args.optInt("deviceId", -1), fromVisibleUi); break;
                    case "audio.configure":
                        if (args.has("useInputWithPlayer")) {
                            boolean previous = useInputWithPlayer;
                            useInputWithPlayer = args.getBoolean("useInputWithPlayer");
                            try { reconcileInputOwnership(measurement.isRunning()); }
                            catch (HostError error) { useInputWithPlayer = previous; throw error; }
                            getSharedPreferences("audio", MODE_PRIVATE).edit().putBoolean("useInputWithPlayer", useInputWithPlayer).apply();
                        }
                        if (args.has("sampleRate") && args.getInt("sampleRate") != engine.getSampleRate()) throw new HostError("unsupported-format", "Use the current device sample rate.");
                        if (args.has("channelCount") && args.getInt("channelCount") != 2) throw new HostError("unsupported-format", "Android playback uses two channels.");
                        if (args.has("powerSettings")) configurePower(args.getJSONObject("powerSettings"));
                        if (args.has("outputDeviceId")) {
                            int device = args.getInt("outputDeviceId");
                            if (device < 0) throw new IllegalArgumentException("Invalid output device");
                            measurement.invalidate(engine);
                            if (engine.setOutputDevice(device) < 0) throw new HostError("output-unavailable", "The selected output is unavailable. Choose another device.");
                            preferredOutputDevice = device;
                        }
                        changed = false; break;
                    case "telemetry.configure": telemetryVisible = args.optBoolean("visible", true); if (telemetryVisible) runtimeEvents.clear(); changed = false; break;
                    case "playback.getPublic": reply.complete(musicPlayback(args.optInt("start", 0), args.optInt("count", 100)), null); return;
                    case "playback.queue.read":
                        int offset = args.getInt("offset"), limit = args.optInt("limit", 64);
                        if (offset < 0 || limit < 1 || limit > 64) throw new IllegalArgumentException("Invalid queue page");
                        JSONArray page = new JSONArray();
                        for (int i = offset; i < queue.length() && page.length() < limit; i++) page.put(sourceSnapshot(queue.getJSONObject(i)));
                        reply.complete(object("items", page, "offset", offset, "total", queue.length()), null); return;
                    case "playback.select":
                        int selectedIndex = args.getInt("index");
                        JSONObject selectedSource = queue.getJSONObject(selectedIndex);
                        queueIndex = selectedIndex; setSource(selectedSource); saveQueue(); break;
                    case "playback.setSource":
                        setSource(args); break;
                    case "playback.setQueue":
                        JSONArray items = args.getJSONArray("items");
                        int index = args.optInt("index", 0);
                        if (items.length() > 4096 || index < 0 || (items.length() > 0 && index >= items.length())) throw new HostError("invalid-queue", "Choose a valid playback queue.");
                        for (int i = 0; i < items.length(); i++) validateSource(items.getJSONObject(i));
                        queue.replace(items); queueIndex = queue.length() == 0 ? -1 : index;
                        setQueueMode(args);
                        if (queueIndex >= 0) setSource(queue.getJSONObject(queueIndex));
                        else { pause(false); decoder.cancel(); generation = engine.beginSource(); source = null; }
                        saveQueue(); break;
                    case "playback.queue.begin":
                        queueTransaction = args.getString("transactionId");
                        queueTransactionRemoteId = args.optString("_remoteRequestId", null);
                        if (queueTransaction.length() > 128 || queueTransaction.isEmpty()) throw new IllegalArgumentException("Invalid queue transaction");
                        queue.begin(); stagedQueueSettings = new JSONObject(args.toString()); changed = false; break;
                    case "playback.queue.append":
                        JSONArray batch = args.getJSONArray("items");
                        if (!args.getString("transactionId").equals(queueTransaction) || queue.stagedLength() < 0 || batch.length() > 64) throw new HostError("stale-queue", "The playback queue changed. Select it again.");
                        for (int i = 0; i < batch.length(); i++) validateSource(batch.getJSONObject(i));
                        queue.append(batch);
                        changed = false; break;
                    case "playback.queue.commit":
                        if (!args.getString("transactionId").equals(queueTransaction) || queue.stagedLength() < 0) throw new HostError("stale-queue", "Choose the playback queue again.");
                        int selected = stagedQueueSettings.optInt("index", 0);
                        if (selected < 0 || selected >= queue.stagedLength()) throw new HostError("invalid-queue", "Choose a valid track in the queue.");
                        boolean preservePlayback = args.optBoolean("preservePlayback");
                        if (preservePlayback) {
                            JSONObject candidate = queue.stagedItem(selected);
                            if (source == null || !source.optString("uri").equals(candidate.optString("uri"))
                                    || !String.valueOf(source.opt("region")).equals(String.valueOf(candidate.opt("region")))) throw new HostError("stale-queue", "The playing track changed. Choose the queue again.");
                        }
                        setQueueMode(stagedQueueSettings); queue.commit(stagedQueueSettings); stagedQueueSettings = null; queueTransaction = null; queueTransactionRemoteId = null;
                        queueIndex = selected;
                        if (preservePlayback) source = queue.getJSONObject(selected); else setSource(queue.getJSONObject(selected));
                        saveQueue(); break;
                    case "playback.queue.abort":
                        if (args.getString("transactionId").equals(queueTransaction)) { queue.abort(); queueTransaction = null; stagedQueueSettings = null; queueTransactionRemoteId = null; }
                        changed = false; break;
                    case "playback.queueMode": setQueueMode(args); saveQueue(); break;
                    case "playback.insert":
                        JSONArray inserted = args.getJSONArray("items"); int insertion = args.getInt("index");
                        for (int i = 0; i < inserted.length(); i++) validateSource(inserted.getJSONObject(i));
                        queue.insert(insertion, inserted); if (queueIndex >= insertion) queueIndex += inserted.length(); saveQueue(); break;
                    case "playback.next": advanceQueue(1, false); break;
                    case "playback.previous": advanceQueue(-1, false); break;
                    case "playback.play":
                        if (source == null) throw new HostError("source-required", "Select a track first.");
                        measurement.invalidate(engine); engine.stopMeasurementNoise(); engine.setGain(focusGain);
                        outputRecoveryAttempted = false; startAudio(fromVisibleUi);
                        if (!sourceReady) seek(sourceExhausted ? 0 : positionUs);
                        playing = true; resumeOnFocus = false; engine.setPlaying(true); renderStart = engine.getRenderedFrames(); break;
                    case "playback.pause": pause(false); changed = false; break;
                    case "playback.stop": pause(false); seek(0); break;
                    case "playback.seek": seek((long) (args.getDouble("position") * 1_000_000)); break;
                    case "playback.speed":
                        double value = args.getDouble("speed");
                        if (!Double.isFinite(value) || value < 0.25 || value > 4) throw new HostError("invalid-speed", "Choose a playback speed between 0.25 and 4.");
                        positionUs = currentPosition(); speed = value; preservePitch = args.optBoolean("preservePitch", true);
                        if (sourceExhausted) saveQueue(); else seek(positionUs); break;
                    case "playback.volume":
                        double gain = args.optDouble("volume", volume);
                        if (!Double.isFinite(gain) || gain < 0 || gain > 1) throw new HostError("invalid-volume", "Choose a volume between 0 and 1.");
                        volume = (float) gain; muted = args.optBoolean("muted", muted); engine.setPlayerGain(muted ? 0 : volume); saveQueue(); break;
                    default: throw new HostError("unsupported-operation", "This operation is not available on Android.");
                }
                if (changed) changed();
                reply.complete(snapshot(), null);
            } catch (HostError error) { refreshInputOwnership(); reply.complete(null, error); }
            catch (Exception error) {
                refreshInputOwnership();
                Log.e("EffeTuneControl", "Command failed", error);
                reply.complete(null, new HostError("operation-failed", "The audio operation could not be completed. Try again."));
            }
        });
    }

    private void internal(String command, JSONObject payload) {
        command(object("command", command, "payload", payload), (result, error) -> {
            if (error != null) send("error", object("code", error.code, "message", error.getMessage()));
        }, false);
    }

    private void applyPipeline(JSONObject value) throws Exception {
        value = new JSONObject(value.toString());
        JSONArray records = value.getJSONArray("plugins");
        JSONObject assetRefs = value.has("assetRefs") ? value.getJSONObject("assetRefs") : assets.compatible(records);
        value.put("assetRefs", assetRefs);
        // Preparation controls belong to the resident version until its replacement commits.
        boolean assetRoutingChanged = false;
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            String prefix = record.getString("type") + ":" + record.getInt("id") + ":";
            java.util.Iterator<String> keys = assetRefs.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (key.startsWith(prefix)) assetRoutingChanged |= mergeAssetParameters(record, assetRefs.getJSONObject(key).optJSONObject("externalAssetParameters"));
            }
        }
        if (assetRoutingChanged) value.put("descriptor", packer.prepareRecords(records, value.optBoolean("masterBypass", false), value.optString("slot", slot)).getString("descriptor"));
        if (records.length() > 128) throw new HostError("pipeline-too-large", "Use at most 128 effects.");
        ArrayList<String> types = new ArrayList<>();
        ArrayList<float[]> parameters = new ArrayList<>();
        ArrayList<Integer> hashes = new ArrayList<>();
        ArrayList<byte[]> parameterBytes = new ArrayList<>();
        HashMap<Integer, Integer> descriptorIds = new HashMap<>();
        ArrayList<String> ids = new ArrayList<>();
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.getJSONObject(index);
            if ("SectionPlugin".equals(record.getString("type"))) continue;
            int id = record.getInt("id");
            if (descriptorIds.containsKey(id)) throw new IllegalArgumentException("Duplicate effect id");
            descriptorIds.put(id, types.size() + 1);
            ids.add(Integer.toString(id));
            types.add(record.getString("type"));
            JSONArray values = record.getJSONArray("parameterValues");
            if (values.length() > 4096) throw new IllegalArgumentException("Too many parameters");
            float[] packed = new float[values.length()];
            for (int p = 0; p < packed.length; p++) {
                packed[p] = (float) values.getDouble(p);
                if (!Float.isFinite(packed[p])) throw new IllegalArgumentException("Invalid parameter");
            }
            parameters.add(packed);
            hashes.add((int) record.getLong("layoutHash"));
            parameterBytes.add(record.has("parameterBytes") ? Base64.decode(record.getString("parameterBytes"), Base64.DEFAULT) : new byte[0]);
        }
        byte[] descriptor = Base64.decode(value.getString("descriptor"), Base64.DEFAULT);
        ByteBuffer bytes = ByteBuffer.wrap(descriptor).order(ByteOrder.LITTLE_ENDIAN);
        if (descriptor.length < 8 || bytes.getInt(0) != 1 || bytes.getInt(4) != types.size() || descriptor.length != 8 + types.size() * 12) throw new IllegalArgumentException("Invalid pipeline descriptor");
        for (int i = 0; i < types.size(); i++) {
            Integer id = descriptorIds.get(bytes.getInt(8 + i * 12));
            if (id == null) throw new IllegalArgumentException("Unknown descriptor effect");
            bytes.putInt(8 + i * 12, id);
        }
        int[] layouts = new int[hashes.size()];
        for (int i = 0; i < layouts.length; i++) layouts[i] = hashes.get(i);
        boolean sameGraph = pipelineRequest != null && value.getString("descriptor").equals(pipelineRequest.optString("descriptor"))
                && records.length() == pipeline.length();
        for (int i = 0; sameGraph && i < records.length(); i++) {
            JSONObject old = pipeline.getJSONObject(i), next = records.getJSONObject(i);
            sameGraph = old.getString("type").equals(next.getString("type")) && old.getInt("id") == next.getInt("id")
                    && old.optLong("layoutHash") == next.optLong("layoutHash");
        }
        if (!slot.equals(value.optString("slot", slot))) previews.clear();
        if (sameGraph) {
            for (int i = 0; i < ids.size(); i++) {
                String id = ids.get(i); JSONObject held = previews.get(id);
                JSONObject next = held == null ? null : previewRecord(records, id);
                if (held != null && (next == null || !next.optBoolean("enabled", true) || !assetRefs.has("SFZNotePlayerPlugin:" + id + ":0"))) {
                    previews.remove(id); held = null;
                }
                float[] effective = held == null ? parameters.get(i) : previewValues(next, held);
                if (engine.setParameters(instances.get(id), effective, layouts[i]) < 0) {
                    throw new HostError("pipeline-invalid", "The effect parameters could not be applied.");
                }
                if (parameterBytes.get(i).length > 0 && engine.setParameterBytes(instances.get(ids.get(i)), parameterBytes.get(i), layouts[i]) < 0) throw new HostError("pipeline-invalid", "The effect routing could not be applied.");
            }
        } else {
            previews.clear();
            int[] handles = engine.configurePipeline(types.toArray(new String[0]), parameters.toArray(new float[0][]), layouts, descriptor, parameterBytes.toArray(new byte[0][]));
            if (handles == null || handles.length != types.size()) throw new HostError("pipeline-invalid", "The effect pipeline could not be applied.");
            instances.clear(); instanceEpoch++; runtimeEvents.clear();
            telemetryTapIds = new int[ids.size()]; for (int i = 0; i < ids.size(); i++) telemetryTapIds[i] = Integer.parseInt(ids.get(i));
            instanceTypes.clear(); assets.discardPending();
            for (int i = 0; i < handles.length; i++) { instances.put(ids.get(i), handles[i]); instanceTypes.put(ids.get(i), types.get(i)); }
        }
        assets.select(assetRefs, instances, instanceTypes, engine, !sameGraph);
        masterBypass = value.optBoolean("masterBypass", false);
        temporalMustProcess = packer.mustProcessPipeline(records, masterBypass);
        engine.setMasterBypass(masterBypass);
        pipeline = new JSONArray(records.toString());
        pipelineRequest = new JSONObject(value.toString());
        engine.setPowerSettings((float) Math.pow(10, silenceThresholdDb / 20), 60, temporalMustProcess || !previews.isEmpty() || powerMode.equals("continuous"));
        slot = value.optString("slot", slot);
        slots.put(slot, new JSONObject(pipelineRequest.toString()));
        persistPipeline();
        if (autoSuspended && visible) startAudio(true);
    }

    private boolean mergeAssetParameters(JSONObject record, JSONObject parameters) throws Exception {
        if (parameters == null || parameters.length() == 0) return false;
        JSONObject current = record.getJSONObject("parameters");
        java.util.Iterator<String> keys = parameters.keys();
        while (keys.hasNext()) { String key = keys.next(); current.put(key, parameters.get(key)); }
        packer.packRecord(record); return true;
    }

    private void replacePipeline(JSONObject value) throws Exception {
        String nextSlot = value.optString("slot", slot);
        if (!nextSlot.equals("A") && !nextSlot.equals("B")) throw new IllegalArgumentException("Invalid pipeline slot");
        JSONObject previous = pipelineRequest == null ? packer.prepareChain(new JSONArray(), masterBypass, slot) : new JSONObject(pipelineRequest.toString());
        applyPipeline(value);
        undo.add(previous); if (undo.size() > 100) undo.remove(0); redo.clear();
        collectAssets();
    }

    private void moveHistory(ArrayList<JSONObject> source, ArrayList<JSONObject> destination) throws Exception {
        if (source.isEmpty()) return;
        JSONObject target = source.get(source.size() - 1);
        JSONObject previous = new JSONObject(pipelineRequest.toString());
        applyPipeline(target); source.remove(source.size() - 1); destination.add(previous);
        collectAssets();
    }

    private void persistPipeline() {
        getSharedPreferences("audio", MODE_PRIVATE).edit().putString("pipeline", pipelineRequest.toString()).apply();
        persistSlots();
    }

    private ArrayList<JSONObject> retainedPipelineStates() {
        ArrayList<JSONObject> states = new ArrayList<>(slots.values()); states.addAll(undo); states.addAll(redo); return states;
    }
    private void collectAssets() throws Exception { assets.collect(retainedPipelineStates()); }

    private void startAudio(boolean userVisible) throws HostError {
        reconcileOutput();
        if (running) return;
        if (!userVisible && !visible) throw new HostError("visible-start-required", "Open EffeTune to start audio.");
        startService(new Intent(this, AudioService.class));
        showNotification(true);
        if (audioManager.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            focusHeld = false;
            stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
            throw new HostError("audio-focus-denied", "Another app is using audio. Try again when it finishes.");
        }
        focusHeld = true;
        focusGain = 1; engine.setGain(focusGain);
        if (autoSuspended) engine.prepareResume();
        if (engine.start() < 0) {
            focusHeld = false;
            audioManager.abandonAudioFocusRequest(focus); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
            throw new HostError("audio-unavailable", "The audio device is unavailable. Reconnect it and try again.");
        }
        engine.setPowerSettings((float) Math.pow(10, silenceThresholdDb / 20), 60, temporalMustProcess || !previews.isEmpty() || powerMode.equals("continuous"));
        running = true;
        reconcileInputOwnership(measurement.isRunning());
        autoSuspended = false; powerState = "ACTIVE"; lastPowerSequence = -1;
        updateRemoteLifetime();
    }

    private void setInput(int device, boolean userVisible) throws HostError {
        if (device != inputDevice) measurement.invalidate(engine);
        if (device >= 0 && (!userVisible || !visible || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)) throw new HostError("permission-required", "Open EffeTune and allow microphone access first.");
        int previous = inputDevice;
        inputDevice = device;
        try {
            if (device >= 0) startAudio(userVisible);
            reconcileInputOwnership(measurement.isRunning());
        } catch (HostError error) { inputDevice = previous; throw error; }
    }

    private void reconcileInputOwnership(boolean measuring) throws HostError {
        // A retained player source owns the route through pause/stop, like the Web player.
        int desired = running && focusHeld && (measuring || source == null || useInputWithPlayer) ? inputDevice : -1;
        if (desired == acquiredInputDevice) return;
        // Releasing input is always allowed; acquiring it requires a visible Activity.
        if (desired >= 0 && (!visible || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)) return;
        boolean previous = microphone;
        if (desired >= 0) { microphone = true; showNotification(true); }
        if (engine.setInputDevice(desired) < 0) {
            microphone = previous;
            if (running) showNotification(true);
            throw new HostError("input-unavailable", "The selected audio input is unavailable.");
        }
        acquiredInputDevice = desired; microphone = desired >= 0;
        if (running) showNotification(true);
    }

    private void refreshInputOwnership() {
        if (engine == null || measurement == null) return;
        try { reconcileInputOwnership(measurement.isRunning()); }
        catch (HostError error) {
            Log.w("EffeTuneAudio", "Cannot restore selected audio input", error);
            send("error", object("code", error.code, "message", error.getMessage()));
        }
    }

    private JSONObject previewRecord(String id) throws Exception { return previewRecord(pipeline, id); }
    private JSONObject previewRecord(JSONArray records, String id) throws Exception {
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            if (id.equals(String.valueOf(record.getInt("id"))) && "SFZNotePlayerPlugin".equals(record.getString("type"))) return record;
        }
        return null;
    }
    private float[] previewValues(JSONObject current, JSONObject note) throws Exception {
        JSONObject record = new JSONObject(current.toString());
        record.getJSONObject("parameters").put("pm", note == null ? -1 : note.getInt("pm")).put("pv", note == null ? 100 : note.getInt("pv"));
        packer.packRecord(record);
        JSONArray values = record.getJSONArray("parameterValues"); float[] packed = new float[values.length()];
        for (int i = 0; i < packed.length; i++) packed[i] = (float) values.getDouble(i);
        return packed;
    }
    private void applyPreview(String id, JSONObject note) throws Exception {
        JSONObject current = previewRecord(id); Integer instance = instances.get(id);
        if (current == null || instance == null) return;
        if (engine.setParameters(instance, previewValues(current, note), (int) current.getLong("layoutHash")) < 0) throw new HostError("preview-unavailable", "The instrument could not play the preview. Try again.");
    }
    private void preview(JSONObject args, boolean userVisible) throws Exception {
        String id = String.valueOf(args.getInt("pluginId")); int note = args.getInt("pm"), velocity = args.optInt("pv", 100);
        if ((note != -1 && (note < 21 || note > 108)) || velocity < 1 || velocity > 127) throw new IllegalArgumentException("Invalid preview note");
        JSONObject record = previewRecord(id);
        if (record == null) throw new HostError("stale-pipeline", "The instrument changed. Try again.");
        if (note >= 0) {
            if (!userVisible || !visible) throw new HostError("visible-start-required", "Open EffeTune to preview an instrument.");
            if (!record.optBoolean("enabled", true) || !assets.snapshot().has("SFZNotePlayerPlugin:" + id + ":0")) throw new HostError("preview-unavailable", "Load an instrument and enable the effect first.");
            startAudio(true);
            JSONObject value = object("pm", note, "pv", velocity); applyPreview(id, value); previews.put(id, value);
        } else { applyPreview(id, null); previews.remove(id); }
        engine.setPowerSettings((float) Math.pow(10, silenceThresholdDb / 20), 60, temporalMustProcess || !previews.isEmpty() || powerMode.equals("continuous"));
    }
    private void clearPreviews() {
        for (String id : new ArrayList<>(previews.keySet())) try { applyPreview(id, null); } catch (Exception error) { Log.w("EffeTune", "Cannot release instrument preview", error); }
        previews.clear();
        if (engine != null) engine.setPowerSettings((float) Math.pow(10, silenceThresholdDb / 20), 60, temporalMustProcess || powerMode.equals("continuous"));
    }

    private void setSource(JSONObject value) throws Exception {
        measurement.invalidate(engine); engine.stopMeasurementNoise(); engine.setGain(focusGain);
        queue.abort(); stagedQueueSettings = null; queueTransaction = null;
        validateSource(value);
        pause(false);
        source = new JSONObject(value.toString());
        reconcileInputOwnership(false);
        durationUs = 0;
        seek((long) (value.optDouble("position", 0) * 1_000_000));
        session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, source.optString("title", "EffeTune")).build());
    }

    private void validateSource(JSONObject value) throws Exception {
        String uri = value.getString("uri");
        String scheme = android.net.Uri.parse(uri).getScheme();
        if (!"content".equals(scheme) && !"https".equals(scheme) && !"http".equals(scheme)) throw new HostError("invalid-source", "Select an audio file or a network music source.");
    }

    private void setQueueMode(JSONObject value) throws Exception {
        String mode = value.optString("repeat", repeat);
        if (!mode.equals("off") && !mode.equals("all") && !mode.equals("one")) throw new HostError("invalid-repeat", "Choose a valid repeat mode.");
        repeat = mode; shuffle = value.optBoolean("shuffle", shuffle);
    }

    private void advanceQueue(int direction, boolean ended) throws Exception {
        if (queue.length() == 0) { endPlayback(); return; }
        int index = queueIndex;
        if (!(ended && repeat.equals("one"))) {
            if (shuffle && queue.length() > 1) index = (index + 1 + random.nextInt(queue.length() - 1)) % queue.length();
            else index += direction;
        }
        if (index < 0 || index >= queue.length()) {
            if (repeat.equals("all")) index = (index + queue.length()) % queue.length();
            else { endPlayback(); return; }
        }
        boolean resume = playing || ended;
        queueIndex = index; setSource(queue.getJSONObject(index));
        if (resume) { playing = true; engine.setPlaying(true); renderStart = engine.getRenderedFrames(); }
        saveQueue();
    }

    private void endPlayback() {
        pause(false); sourceReady = false; sourceExhausted = true;
        saveQueue();
        send("playback-ended", snapshot());
    }

    private void saveQueue() {
        if (queue == null) return;
        queue.saveSettings(object("index", queueIndex, "repeat", repeat, "shuffle", shuffle,
                "speed", speed, "preservePitch", preservePitch, "volume", volume, "muted", muted,
                "positionEntryId", source == null ? -1 : source.optInt("queueEntryId", -1),
                "positionUs", currentPosition(), "durationUs", durationUs, "sourceExhausted", sourceExhausted));
    }

    private JSONObject audioDevices() {
        JSONArray inputs = new JSONArray(), outputs = new JSONArray();
        inputs.put(object("id", -1, "label", "None"));
        for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_ALL)) {
            JSONObject value = object("id", device.getId(), "label", device.getProductName().toString());
            if (device.isSource()) inputs.put(value);
            if (device.isSink()) outputs.put(value);
        }
        return object("inputs", inputs, "outputs", outputs, "unprocessed", unprocessedInputSupported());
    }

    private void seek(long position) throws Exception {
        if (position < 0 || (durationUs > 0 && position > durationUs)) throw new HostError("invalid-position", "Choose a position within the track.");
        positionUs = position;
        sourceExhausted = false;
        decoder.cancel(); generation = engine.beginSource(); renderStart = engine.getRenderedFrames(); decoderEnded = false;
        if (source != null) {
            JSONObject region = source.optJSONObject("region");
            long endUs = region == null ? 0 : (long) (region.optDouble("end", 0) * 1_000_000);
            decoder.start(source, positionUs, speed, preservePitch, endUs, generation);
            sourceReady = true;
        }
        saveQueue();
    }

    private long currentPosition() {
        return positionUs + (playing ? (long) ((engine.getRenderedFrames() - renderStart) * 1_000_000.0 * speed / engine.getSampleRate()) : 0);
    }

    private void pause(boolean abandonFocus) {
        if (engine == null) return;
        positionUs = currentPosition(); playing = false; resumeOnFocus = false; engine.setPlaying(false);
        if (abandonFocus) audioManager.abandonAudioFocusRequest(focus);
        saveQueue();
        changed();
    }

    private void stopAudio() {
        focusHeld = false;
        clearPreviews();
        if (recordingMonitor != null) recordingMonitor.disarm();
        measurement.invalidate(engine);
        pause(true); decoder.cancel(); generation = engine.beginSource(); engine.setInputDevice(-1); acquiredInputDevice = -1;
        sourceReady = false;
        inputDevice = -1; microphone = false; engine.stop(); running = false;
        powerState = "SUSPENDED"; autoSuspended = false;
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
        updateRemoteLifetime();
    }

    private void changed() { refreshInputOwnership(); revision++; sessionState(); send("snapshot", snapshot()); if (remote != null) remote.broadcast(remoteState(null)); }

    private void reconcileOutput() {
        if (!running) return;
        if (engine.getOutputStatus() > 0) {
            if (outputRecoveryAttempted && engine.getAudioFrameTime() > outputRecoveryFrame) outputRecoveryAttempted = false;
            return;
        }
        measurement.invalidate(engine); recordingMonitor.disarm();
        running = false; powerState = "SUSPENDED";
        // One control-owner reopen preserves queued PCM when Android replaces a route.
        // Stop/noisy/focus loss clear running/focusHeld and cannot enter this path.
        if (focusHeld && !outputRecoveryAttempted) {
            outputRecoveryAttempted = true;
            outputRecoveryFrame = engine.getAudioFrameTime();
            if (engine.start() >= 0) { running = true; powerState = "ACTIVE"; changed(); return; }
        }
        stopAudio();
        send("error", object("code", "audio-unavailable", "message", "The audio output disconnected. Reconnect it and press Play."));
    }
    private void send(String name, JSONObject value) { if (events != null) events.send(name, value); }
    private JSONObject snapshot() {
        return object("revision", revision, "sampleRate", engine == null ? 48000 : engine.getSampleRate(), "channelCount", 2,
                "slot", slot, "pipelines", object("A", slots.containsKey("A") ? slots.get("A").optJSONArray("plugins") : new JSONArray(), "B", slots.containsKey("B") ? slots.get("B").optJSONArray("plugins") : new JSONArray()), "canUndo", !undo.isEmpty(), "canRedo", !redo.isEmpty(),
                "routingChannelCount", 2, "pipeline", pipeline, "masterBypass", masterBypass, "powerState", powerState,
                "assetRefs", pipelineRequest == null ? new JSONObject() : pipelineRequest.optJSONObject("assetRefs"),
                "assetDefinitions", AssetTransfers.definitions(pipelineRequest == null ? null : pipelineRequest.optJSONObject("assetRefs")),
                "retainedAssetDefinitions", assets == null ? new JSONArray() : assets.retainedDefinitions(retainedPipelineStates()),
                "inputDeviceId", inputDevice, "useInputWithPlayer", useInputWithPlayer, "outputDeviceId", engine == null ? 0 : engine.getOutputDeviceId(),
                "preferredOutputDeviceId", preferredOutputDevice, "actualOutputDeviceId", engine == null ? 0 : engine.getOutputDeviceId(),
                "playback", object("playing", playing, "position", engine == null ? 0 : currentPosition() / 1_000_000.0,
                        "duration", durationUs / 1_000_000.0, "speed", speed, "preservePitch", preservePitch, "volume", volume, "muted", muted,
                        "queue", publicQueue(), "queueOffset", Math.max(0, queueIndex), "generation", generation,
                        "queueLength", queue == null ? 0 : queue.length(), "index", queueIndex, "repeat", repeat, "shuffle", shuffle,
                        "source", source == null ? JSONObject.NULL : sourceSnapshot(source)));
    }

    private JSONObject sourceSnapshot(JSONObject item) {
        JSONObject result = object("uri", item.optString("uri"), "title", item.optString("title", ""));
        String libraryTrackId = item.optString("libraryTrackId", "");
        if (!libraryTrackId.isEmpty() && libraryTrackId.length() <= 1024) try { result.put("libraryTrackId", libraryTrackId); } catch (Exception ignored) { }
        JSONObject region = item.optJSONObject("region");
        if (region != null) {
            JSONObject copy = new JSONObject();
            for (String key : new String[]{"start", "end", "durationSec"}) {
                if (region.isNull(key) && !key.equals("start")) { try { copy.put(key, JSONObject.NULL); } catch (Exception ignored) { } }
                else { double value = region.optDouble(key, Double.NaN); if (Double.isFinite(value) && value >= 0) try { copy.put(key, value); } catch (Exception ignored) { } }
            }
            if (copy.has("start")) try { result.put("region", copy); } catch (Exception ignored) { }
        }
        JSONObject lyrics = item.optJSONObject("lyricsFile");
        if (lyrics != null && "content".equals(android.net.Uri.parse(lyrics.optString("uri")).getScheme()) && lyrics.optString("uri").length() <= 8192) {
            String name = lyrics.optString("name"), mime = lyrics.optString("mimeType");
            try { result.put("lyricsFile", object("uri", lyrics.getString("uri"), "name", name.substring(0, Math.min(name.length(), 512)),
                    "mimeType", mime.substring(0, Math.min(mime.length(), 128)), "size", Math.max(0, lyrics.optLong("size", 0)))); } catch (Exception ignored) { }
        }
        for (String key : new String[]{"name", "type", "mimeType", "sourceKind"}) if (item.has(key)) {
            String value = item.optString(key); try { result.put(key, value.substring(0, Math.min(value.length(), 512))); } catch (Exception ignored) { }
        }
        JSONObject metadata = item.optJSONObject("metadata");
        if (metadata != null) {
            JSONObject copy = new JSONObject();
            for (String key : new String[]{"title", "artist", "album", "artworkUrl"}) {
                String value = metadata.optString(key); try { copy.put(key, value.substring(0, Math.min(value.length(), key.equals("artworkUrl") ? 8192 : 512))); } catch (Exception ignored) { }
            }
            try { double duration = metadata.optDouble("duration", 0); copy.put("duration", Double.isFinite(duration) && duration >= 0 ? duration : 0); result.put("metadata", copy); } catch (Exception ignored) { }
        }
        return result;
    }

    private JSONArray publicQueue() {
        JSONArray entries = new JSONArray();
        if (queue == null) return entries;
        for (int i = Math.max(0, queueIndex); i < queue.length() && entries.length() < 32; i++) {
            JSONObject item = queue.optJSONObject(i);
            entries.put(sourceSnapshot(item));
        }
        return entries;
    }

    private void sessionState() {
        session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, engine == null ? 0 : currentPosition() / 1000, playing ? (float) speed : 0, SystemClock.elapsedRealtime()).build());
        if (running) showNotification(false);
    }

    private JSONObject remoteCommand(String name, JSONObject args, boolean fromVisibleUi) throws Exception {
        switch (name) {
            case "remote.authorize": requireRemoteAuthority(args.getString("requestId")); return object("current", true);
            case "remote.getStatus": break;
            case "remote.rendererReady": rendererReady = true; break;
            case "remote.rendererUnavailable": rendererReady = false; break;
            case "remote.publishState": rendererState = new JSONObject(args.toString()); break;
            case "remote.respond":
                requireRemoteAuthority(args.getString("requestId"));
                Consumer<JSONObject> pending = remotePending.remove(args.getString("requestId"));
                remoteAuthority.remove(args.getString("requestId"));
                if (pending != null) pending.accept(args);
                break;
            case "remote.rotateToken":
                if (!fromVisibleUi) throw new HostError("visible-start-required", "Open EffeTune to change remote access.");
                if (remote != null) { remote.rotate(); remote.close(); remote = null; }
                getSharedPreferences("remote", MODE_PRIVATE).edit().putString("token", newToken()).apply();
                updateRemoteLifetime(); break;
            case "remote.configure":
                if (!fromVisibleUi) throw new HostError("visible-start-required", "Open EffeTune to change remote access.");
                if (args.optBoolean("enabled") && Build.VERSION.SDK_INT >= 37
                        && checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") != PackageManager.PERMISSION_GRANTED) throw new HostError("permission-required", "Allow local network access in Android settings to use remote control.");
                int port = args.optInt("port", 47300);
                if (port < 1024 || port > 65535) throw new HostError("invalid-port", "Choose a port between 1024 and 65535.");
                if (remote != null) { remote.close(); remote = null; }
                getSharedPreferences("remote", MODE_PRIVATE).edit().putBoolean("enabled", args.optBoolean("enabled"))
                        .putInt("port", port).putString("certificate", args.optString("certificatePem", getSharedPreferences("remote", MODE_PRIVATE).getString("certificate", "")))
                        .putString("privateKey", args.optString("privateKeyPem", getSharedPreferences("remote", MODE_PRIVATE).getString("privateKey", ""))).apply();
                updateRemoteLifetime();
                if (args.optBoolean("enabled") && remote == null) throw new HostError("remote-unavailable", "Remote control could not start. Check the port and any selected certificate files.");
                break;
            default: throw new HostError("unsupported-operation", "This remote control operation is unavailable.");
        }
        JSONObject status = remoteStatus(); send("remote-status", status); return status;
    }

    private String newToken() {
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        return Base64.encodeToString(bytes, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
    }

    private void updateRemoteLifetime() {
        boolean permitted = Build.VERSION.SDK_INT < 37 || checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") == PackageManager.PERMISSION_GRANTED;
        boolean enabled = getSharedPreferences("remote", MODE_PRIVATE).getBoolean("enabled", false);
        if (!enabled || !permitted || (!visible && !running)) {
            if (remote != null) { remote.close(); remote = null; }
            return;
        }
        if (remote != null) return;
        String token = getSharedPreferences("remote", MODE_PRIVATE).getString("token", null);
        if (token == null) { token = newToken(); getSharedPreferences("remote", MODE_PRIVATE).edit().putString("token", token).apply(); }
        try {
            remote = new RemoteControlServer(this, getSharedPreferences("remote", MODE_PRIVATE).getInt("port", 47300), token,
                    getSharedPreferences("remote", MODE_PRIVATE).getString("certificate", ""),
                    getSharedPreferences("remote", MODE_PRIVATE).getString("privateKey", ""),
                    (request, sendReply, current) -> control.post(() -> dispatchRemote(request, sendReply, current)));
        } catch (Exception error) { Log.e("EffeTuneRemote", "Listener could not start", error); }
    }

    private JSONObject remoteStatus() {
        String token = getSharedPreferences("remote", MODE_PRIVATE).getString("token", "");
        int port = remote == null ? getSharedPreferences("remote", MODE_PRIVATE).getInt("port", 47300) : remote.port();
        JSONArray addresses = new JSONArray();
        try {
            java.util.Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                java.util.Enumeration<java.net.InetAddress> ips = network.getInetAddresses();
                while (ips.hasMoreElements()) {
                    java.net.InetAddress ip = ips.nextElement();
                    if (ip instanceof Inet4Address && ip.isSiteLocalAddress()) addresses.put(
                            (getSharedPreferences("remote", MODE_PRIVATE).getString("certificate", "").isEmpty() ? "http://" : "https://")
                                    + ip.getHostAddress() + ":" + port + "/?t=" + token);
                }
            }
        } catch (Exception error) { Log.d("EffeTuneRemote", "No LAN address", error); }
        return object("enabled", getSharedPreferences("remote", MODE_PRIVATE).getBoolean("enabled", false),
                "listening", remote != null, "port", port, "token", token, "addresses", addresses, "clientCount", remote == null ? 0 : remote.clientCount());
    }

    private JSONObject remoteState(Object seq) {
        JSONArray shortPipeline = new JSONArray();
        for (int i = 0; i < pipeline.length(); i++) {
            JSONObject plugin = pipeline.optJSONObject(i);
            try {
                JSONObject state = new JSONObject(plugin.getJSONObject("parameters").toString());
                state.put("nm", plugin.getString("name")).put("en", plugin.optBoolean("enabled", true)); shortPipeline.put(state);
            } catch (Exception error) { Log.w("EffeTuneRemote", "Cannot serialize effect state", error); }
        }
        JSONObject result = object("op", "state", "rev", revision, "app", applicationVersion(), "appName", "EffeTune", "masterBypass", masterBypass,
                "pipeline", shortPipeline, "origin", "remote", "features", rendererReady ? new JSONArray().put("origin").put("savePreset").put("describe1").put("music1") : new JSONArray().put("origin").put("music1"),
                "effects", packer.effectNames(),
                "audio", object("sampleRate", engine.getSampleRate(), "channelCount", 2, "routingChannelCount", 2));
        try {
            for (String key : new String[]{"epoch", "ids", "slot", "host", "effects"}) if (rendererState.has(key)) result.put(key, rendererState.get(key));
            if (seq != null) result.put("seq", seq);
        } catch (Exception error) { throw new IllegalArgumentException(error); }
        return result;
    }

    private void dispatchRemote(JSONObject request, Consumer<JSONObject> sendReply, BooleanSupplier current) {
        if (destroyed || !current.getAsBoolean()) return;
        Object seq = request.opt("seq");
        String op = request.optString("op");
        boolean music = op.equals("listMusicDevices") || op.equals("browseMusic") || op.equals("playMusic") || op.equals("queueMusic") || op.equals("getPlayback") || op.equals("controlPlayback") || op.equals("editPlaybackQueue");
        if (music) {
            remoteAck(sendReply, seq, true, null);
            if (handleNativeMusic(request, sendReply, current)) return;
        }
        if (op.equals("hello") && request.optInt("v") != 1) { remoteAck(sendReply, seq, false, "unsupported-version"); return; }
        if (op.equals("hello") || op.equals("get")) { remoteAck(sendReply, seq, true, null); sendReply.accept(remoteState(seq)); return; }
        try {
            if (op.equals("chain")) {
                JSONObject prepared = packer.prepareChain(request.getJSONArray("pipeline"), masterBypass, slot);
                boolean needsRenderer = false;
                JSONArray records = prepared.getJSONArray("plugins");
                int maximumId = 0;
                for (JSONObject saved : slots.values()) { JSONArray list = saved.getJSONArray("plugins"); for (int i = 0; i < list.length(); i++) maximumId = Math.max(maximumId, list.getJSONObject(i).getInt("id")); }
                for (int i = 0; i < records.length(); i++) {
                    JSONObject record = records.getJSONObject(i); record.put("id", maximumId + i + 1);
                    needsRenderer |= packer.needsAssetPreparation(record.getString("type"));
                }
                if (!needsRenderer) {
                    replacePipeline(packer.prepareRecords(records, masterBypass, slot)); changed(); send("pipeline-changed", snapshot()); remoteAck(sendReply, seq, true, null); return;
                }
            } else if (op.equals("params")) {
                int index = request.getInt("index");
                if (index < 0 || index >= pipeline.length()) throw new IllegalArgumentException("Invalid effect index");
                JSONObject old = pipeline.getJSONObject(index);
                if (!packer.needsAssetPreparation(old.getString("type"))) {
                    JSONArray records = new JSONArray(pipeline.toString()); JSONObject record = records.getJSONObject(index);
                    JSONObject params = record.getJSONObject("parameters"), patch = request.getJSONObject("params");
                    java.util.Iterator<String> keys = patch.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        if (key.equals("en")) record.put("enabled", patch.getBoolean(key));
                        else params.put(key.equals("ch") ? "channel" : key.equals("ib") ? "inputBus" : key.equals("ob") ? "outputBus" : key, patch.get(key));
                    }
                    packer.packRecord(record); replacePipeline(packer.prepareRecords(records, masterBypass, slot)); changed(); send("pipeline-changed", snapshot()); remoteAck(sendReply, seq, true, null); return;
                }
            } else if (op.equals("history") || op.equals("slot") || op.equals("copySlot")) {
                String command = op.equals("history") ? request.getString("dir").equals("undo") ? "pipeline.undo" : request.getString("dir").equals("redo") ? "pipeline.redo" : "invalid" : "pipeline." + op;
                command(object("command", command, "payload", request), (result, error) -> {
                    remoteAck(sendReply, seq, error == null, error == null ? null : error.code);
                    if (error == null) send("pipeline-changed", snapshot());
                }, false, current); return;
            }
        } catch (Exception error) { Log.w("EffeTuneRemote", "Rejected pipeline command", error); remoteAck(sendReply, seq, false, "invalid-op"); return; }
        if (op.equals("bypass")) {
            if (!(request.opt("on") instanceof Boolean)) { remoteAck(sendReply, seq, false, "invalid-op"); return; }
            try { replacePipeline(packer.prepareRecords(new JSONArray(pipeline.toString()), request.getBoolean("on"), slot)); remoteAck(sendReply, seq, true, null); changed(); send("pipeline-changed", snapshot()); }
            catch (Exception error) { remoteAck(sendReply, seq, false, "invalid-op"); }
            return;
        }
        if (!rendererReady || events == null) {
            if (music) musicError(sendReply, seq, "unavailable", "Open EffeTune to browse the music library.");
            else remoteAck(sendReply, seq, false, "renderer-unavailable");
            return;
        }
        if (remotePending.size() >= 64) { if (music) musicError(sendReply, seq, "unavailable", "Try again after the current requests finish."); else remoteAck(sendReply, seq, false, "busy"); return; }
        String id = UUID.randomUUID().toString();
        remoteAuthority.put(id, current);
        remotePending.put(id, result -> {
            if (music) {
                if (result.optBoolean("ok")) sendReply.accept(object("op", "musicResult", "seq", seq, "ok", true, "result", result.optJSONObject("data")));
                else musicError(sendReply, seq, "unavailable", "The music request could not be completed. Open EffeTune and try again.");
                return;
            }
            boolean ok = result.optBoolean("ok"); remoteAck(sendReply, seq, ok, result.optString("error", "operation-failed"));
            if (!ok) return;
            try {
                JSONObject data = null;
                if (op.equals("listPresets")) data = object("op", "presets", "names", result.optJSONArray("names"));
                else if (op.equals("getPreset")) data = object("op", "preset", "name", result.optString("name"), "pipeline", result.optJSONArray("pipeline"));
                else if (op.equals("describeEffects")) data = object("op", "effects", "effects", result.optJSONArray("effects"));
                else if (op.equals("presets")) data = object("op", "presets", "presets", result.optJSONObject("presets"));
                if (data != null) { if (seq != null) data.put("seq", seq); sendReply.accept(data); }
            } catch (Exception error) { Log.w("EffeTuneRemote", "Cannot encode response", error); }
        });
        control.postDelayed(() -> { Consumer<JSONObject> pending = remotePending.get(id); cancelRemoteRequest(id); if (pending != null) pending.accept(object("ok", false, "error", "renderer-unavailable")); }, 20_000);
        send("remote-request", object("requestId", id, "message", request));
    }

    private void requireRemoteAuthority(String id) throws HostError {
        BooleanSupplier authority = remoteAuthority.get(id);
        if (authority == null || !authority.getAsBoolean() || !rendererReady) throw new HostError("unauthorized", "Remote access changed. Reconnect and try again.");
    }

    private void discardRevokedRemoteRequests() {
        for (String id : remoteAuthority.keySet().toArray(new String[0])) {
            if (rendererReady && remoteAuthority.get(id).getAsBoolean()) continue;
            cancelRemoteRequest(id);
        }
    }

    private void cancelRemoteRequest(String id) {
        if (remoteAuthority.remove(id) == null) return;
        remotePending.remove(id);
        if (id.equals(queueTransactionRemoteId)) { queue.abort(); queueTransaction = null; stagedQueueSettings = null; queueTransactionRemoteId = null; }
        send("remote-cancelled", object("requestId", id));
    }

    private boolean handleNativeMusic(JSONObject request, Consumer<JSONObject> sendReply, BooleanSupplier authority) {
        Object seq = request.opt("seq"); String op = request.optString("op");
        String player = request.optString("playerId", "local");
        if (!player.equals("local")) return false;
        try {
            if (op.equals("getPlayback")) {
                sendReply.accept(object("op", "musicResult", "seq", seq, "ok", true, "result", musicPlayback(request.optInt("start", 0), request.optInt("count", 100)))); return true;
            }
            if (op.equals("listMusicDevices") && !rendererReady) {
                sendReply.accept(object("op", "musicResult", "seq", seq, "ok", true, "result", object("libraries", new JSONArray().put(object("serverId", "local", "name", "EffeTune", "available", false, "searchSupported", true)),
                        "players", new JSONArray().put(object("playerId", "local", "name", "EffeTune", "available", running || visible, "isEffeTune", true)), "queueTracksMax", 4096))); return true;
            }
            if (op.equals("controlPlayback")) {
                String action = request.getString("action"), command = "playback." + action;
                JSONObject args = new JSONObject();
                switch (action) {
                    case "play": case "pause": case "stop": case "next": case "previous": break;
                    case "seek": args.put("position", request.getDouble("seconds")); break;
                    case "seekId":
                        int index = queue.indexOfId(request.getInt("id"));
                        if (index < 0) throw new IllegalArgumentException("Missing queue entry");
                        queueIndex = index; setSource(queue.getJSONObject(index)); saveQueue(); command = "playback.play"; break;
                    case "repeat": command = "playback.queueMode"; args.put("repeat", request.getBoolean("value") ? "all" : "off"); break;
                    case "shuffle": command = "playback.queueMode"; args.put("shuffle", request.getBoolean("value")); break;
                    case "volume": command = "playback.volume"; args.put("volume", request.getDouble("value") / 100); break;
                    case "mute": command = "playback.volume"; args.put("muted", request.getBoolean("value")); break;
                    default: throw new IllegalArgumentException("Unsupported playback action");
                }
                command(object("command", command, "payload", args), (result, error) -> {
                    if (error != null) musicError(sendReply, seq, "unavailable", error.getMessage());
                    else try { sendReply.accept(object("op", "musicResult", "seq", seq, "ok", true, "result", musicPlayback(0, 100))); } catch (Exception failure) { musicError(sendReply, seq, "unavailable", "The player is unavailable."); }
                }, false, authority); return true;
            }
            if (op.equals("editPlaybackQueue")) {
                String action = request.getString("action");
                if (action.equals("clear")) {
                    pause(false); decoder.cancel(); generation = engine.beginSource(); source = null; sourceReady = false;
                    queue.replace(new JSONArray()); queueIndex = -1;
                } else if (action.equals("delete")) {
                    int index = queue.indexOfId(request.getInt("id"));
                    if (index < 0) throw new IllegalArgumentException("Missing queue entry");
                    boolean resume = playing; queue.delete(index);
                    if (index < queueIndex) queueIndex--;
                    else if (index == queueIndex) {
                        if (queueIndex < queue.length()) { setSource(queue.getJSONObject(queueIndex)); if (resume) { playing = true; engine.setPlaying(true); renderStart = engine.getRenderedFrames(); } }
                        else { pause(false); decoder.cancel(); generation = engine.beginSource(); source = null; sourceReady = false; queueIndex = -1; }
                    }
                } else throw new IllegalArgumentException("Invalid queue action");
                saveQueue(); changed(); sendReply.accept(object("op", "musicResult", "seq", seq, "ok", true, "result", musicPlayback(0, 100))); return true;
            }
        } catch (Exception error) { Log.w("EffeTuneRemote", "Rejected music request", error); musicError(sendReply, seq, "invalidRequest", "Choose a valid track or playback control."); return true; }
        return false;
    }

    private JSONObject musicPlayback(int start, int count) throws Exception {
        if (start < 0 || count < 1 || count > 500) throw new IllegalArgumentException("Invalid queue page");
        JSONArray entries = new JSONArray();
        for (int i = start; i < queue.length() && entries.length() < count; i++) entries.put(musicTrack(queue.getJSONObject(i)));
        JSONObject current = queueIndex >= 0 && queueIndex < queue.length() ? musicTrack(queue.getJSONObject(queueIndex)) : null;
        JSONObject capabilities = new JSONObject();
        for (String action : new String[]{"play", "pause", "stop", "next", "previous", "seek", "seekId", "delete", "clear", "repeat", "shuffle", "volume", "mute"}) capabilities.put(action, true);
        return object("playerId", "local", "transportState", playing ? "Playing" : source == null ? "Stopped" : "Paused", "currentId", current == null ? 0 : current.getInt("id"),
                "currentTrack", current == null ? JSONObject.NULL : current, "position", currentPosition() / 1_000_000.0, "duration", durationUs / 1_000_000.0,
                "repeat", !repeat.equals("off"), "shuffle", shuffle, "volume", volume * 100, "volumeMax", 100, "mute", muted, "capabilities", capabilities,
                "queue", entries, "start", start, "total", queue.length(), "numberReturned", entries.length());
    }
    private JSONObject musicTrack(JSONObject entry) {
        return object("id", entry.optInt("queueEntryId"), "title", entry.optString("title", ""), "artist", entry.optString("artist", ""), "album", entry.optString("album", ""), "duration", entry.optDouble("duration", 0));
    }
    private void musicError(Consumer<JSONObject> sendReply, Object seq, String code, String message) { sendReply.accept(object("op", "musicResult", "seq", seq, "ok", false, "error", object("code", code, "message", message))); }

    private void remoteAck(Consumer<JSONObject> sendReply, Object seq, boolean ok, String error) {
        if (seq == null) return;
        JSONObject value = object("op", "ack", "seq", seq, "ok", ok);
        if (!ok) try { value.put("error", error); } catch (Exception ignored) { }
        sendReply.accept(value);
    }

    private String applicationVersion() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (PackageManager.NameNotFoundException error) { throw new IllegalStateException(error); }
    }

    private void configurePower(JSONObject settings) throws Exception {
        String mode = settings.optString("mode", powerMode);
        double threshold = settings.optDouble("silenceThresholdDb", silenceThresholdDb);
        Object delay = settings.opt("fullSuspendDelaySeconds");
        double seconds = delay == null ? suspendDelay : "never".equals(delay) ? Double.POSITIVE_INFINITY : settings.getDouble("fullSuspendDelaySeconds");
        if ((!mode.equals("continuous") && !mode.equals("balanced") && !mode.equals("maximum"))
                || threshold < -90 || threshold > -20 || !Double.isFinite(threshold)
                || (seconds != 60 && seconds != 300 && seconds != 900 && seconds != Double.POSITIVE_INFINITY)) throw new IllegalArgumentException("Invalid power settings");
        powerMode = mode; silenceThresholdDb = threshold; suspendDelay = seconds;
        engine.setPowerSettings((float) Math.pow(10, threshold / 20), 60, temporalMustProcess || !previews.isEmpty() || mode.equals("continuous"));
    }

    private void observePower() {
        if (!running) return;
        float[] observation = engine.getPowerObservation();
        if (observation.length < 5 || observation[0] <= lastPowerSequence) return;
        lastPowerSequence = observation[0];
        String next = observation[4] != 0 ? "MONITORING" : "ACTIVE";
        if (!next.equals(powerState)) { powerState = next; changed(); }
        if (playing || measurement.isRunning() || temporalMustProcess || !previews.isEmpty()) return;
        double deadline = !microphone ? powerMode.equals("continuous") ? 30 : powerMode.equals("maximum") ? 3 : 15
                : powerMode.equals("maximum") ? suspendDelay : Double.POSITIVE_INFINITY;
        if (observation[3] < deadline) return;
        if (microphone) { engine.setInputDevice(-1); acquiredInputDevice = -1; microphone = false; }
        engine.stop(); running = false; autoSuspended = true; powerState = "SUSPENDED";
        audioManager.abandonAudioFocusRequest(focus); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); updateRemoteLifetime(); changed();
    }
    private boolean unprocessedInputSupported() { return "true".equals(audioManager.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED)); }

    private void showNotification(boolean foreground) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String action = playing ? "playback.pause" : "playback.play";
        PendingIntent toggle = PendingIntent.getService(this, 1, new Intent(this, AudioService.class).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, AudioService.class).setAction("audio.stop"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, "audio").setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("EffeTune").setContentText(source == null ? "Audio processing" : source.optString("title", "Audio playback"))
                .setContentIntent(open).setOngoing(running).setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Pause" : "Play", toggle).build())
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stop).build())
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1)).build();
        if (foreground) {
            int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
            if (microphone) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            if (Build.VERSION.SDK_INT >= 29) startForeground(1, notification, types);
            else startForeground(1, notification);
        } else getSystemService(NotificationManager.class).notify(1, notification);
    }

    private byte[] remapTelemetry(byte[] data) {
        if (data == null) return null;
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        for (int offset = 0; offset < data.length;) {
            if (data.length - offset < 16) return null;
            int bytes = (16 + Short.toUnsignedInt(buffer.getShort(offset + 12)) + 3) & ~3;
            int tap = buffer.getInt(offset + 4);
            if (bytes > data.length - offset || tap < 1 || tap > telemetryTapIds.length) return null;
            buffer.putInt(offset + 4, telemetryTapIds[tap - 1]); offset += bytes;
        }
        return data;
    }

    private void publishRuntimeEvents() {
        if (events == null || !visible) return;
        int[] values = engine.readRuntimeEvents();
        for (int i = 0; i + 3 < values.length; i += 4) {
            int handle = values[i], generation = values[i + 1], latched = values[i + 2], cause = values[i + 3];
            String signature = generation + ":" + latched + ":" + cause;
            if (signature.equals(runtimeEvents.get(handle))) continue;
            String id = null;
            for (java.util.Map.Entry<String, Integer> entry : instances.entrySet()) if (entry.getValue() == handle) { id = entry.getKey(); break; }
            if (id == null) continue;
            String pluginType = instanceTypes.get(id), type, causeName;
            if (pluginType.equals("TubeSimulatorPlugin")) { type = "tubeSimulatorCircuitFault"; causeName = cause == 1 ? "feedbackOscillation" : cause == 2 ? "processingSafetyFailure" : "none"; }
            else if (pluginType.equals("AdaptivePredictionEffectPlugin")) { type = "adaptivePredictionFault"; causeName = cause == 1 ? "numericalFailure" : "none"; }
            else continue;
            runtimeEvents.put(handle, signature);
            send("dsp-runtime-event", object("revision", revision, "type", type, "pluginId", Integer.parseInt(id), "pluginType", pluginType,
                    "instanceEpoch", instanceEpoch, "generation", generation, "latched", latched != 0, "cause", causeName));
        }
    }

    private void persistSlots() {
        JSONObject saved = new JSONObject();
        for (String key : slots.keySet()) try { saved.put(key, slots.get(key)); } catch (Exception ignored) { }
        getSharedPreferences("audio", MODE_PRIVATE).edit().putString("slots", saved.toString()).apply();
    }

    private void midiEvent(String name, JSONObject value) {
        try {
            String device = value.optString("name", value.optString("id"));
            if (name.equals("midi-disconnected")) mappings.disconnect(device);
            if (name.equals("midi")) {
                JSONArray data = value.getJSONArray("data"); byte[] bytes = new byte[data.length()];
                for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) data.getInt(i);
                value.put("consumed", mappings.consume(device, bytes, SystemClock.elapsedRealtime()));
            }
        } catch (Exception error) { Log.w("EffeTuneMidi", "Controller mapping failed", error); }
        send(name, value);
    }

    private double mappingValue(String key) {
        switch (key) {
            case "masterBypass": return masterBypass ? 1 : 0;
            case "abToggle": return slot.equals("B") ? 1 : 0;
            case "playPause": return playing ? 1 : 0;
            case "playbackSpeed": return speed;
            case "preservePitch": return preservePitch ? 1 : 0;
            case "repeat": return repeat.equals("off") ? 0 : 1;
            case "shuffle": return shuffle ? 1 : 0;
            default: return 0;
        }
    }
    private void mappedCommand(String name, JSONObject payload) {
        command(object("command", name, "payload", payload), (result, error) -> {
            if (error != null) send("error", object("code", error.code, "message", error.getMessage()));
            else if (name.startsWith("pipeline.")) send("pipeline-changed", snapshot());
        }, false);
    }
    private void mappingAction(String key, int direction) throws Exception {
        switch (key) {
            case "masterBypass": mappedCommand("pipeline.bypass", object("bypass", !masterBypass)); break;
            case "abToggle": mappedCommand("pipeline.slot", object("slot", slot.equals("A") ? "B" : "A")); break;
            case "playPause": mappedCommand(playing ? "playback.pause" : "playback.play", new JSONObject()); break;
            case "stop": mappedCommand("playback.stop", new JSONObject()); break;
            case "track": mappedCommand(direction < 0 ? "playback.previous" : "playback.next", new JSONObject()); break;
            case "seek": mappedCommand("playback.seek", object("position", Math.max(0, Math.min(durationUs, currentPosition() + (direction < 0 ? -5_000_000 : 5_000_000))) / 1_000_000.0)); break;
            case "preservePitch": mappedCommand("playback.speed", object("speed", speed, "preservePitch", !preservePitch)); break;
            case "repeat": mappedCommand("playback.queueMode", object("repeat", repeat.equals("off") ? "all" : repeat.equals("all") ? "one" : "off")); break;
            case "shuffle": mappedCommand("playback.queueMode", object("shuffle", !shuffle)); break;
            case "preset": send("midi-action", object("key", key, "direction", direction)); break;
            default: throw new IllegalArgumentException("Unknown controller action");
        }
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (engine != null) {
                reconcileOutput();
                discardRevokedRemoteRequests();
                try { mappings.tick(SystemClock.elapsedRealtime(), System.currentTimeMillis()); } catch (Exception error) { Log.w("EffeTuneMidi", "Scheduled mapping failed", error); }
                observePower(); publishRuntimeEvents();
                if (microphone && visible) {
                    float[] observation = engine.getPowerObservation();
                    double level = observation.length > 1 && observation[1] > 0 ? 20 * Math.log10(observation[1]) : -120;
                    send("measurement.level", object("inputLevelDb", level, "unprocessed", unprocessedInputSupported(), "condition", unprocessedInputSupported() ? "unprocessed" : "processed"));
                }
                if (remote != null && Build.VERSION.SDK_INT >= 37 && checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") != PackageManager.PERMISSION_GRANTED) updateRemoteLifetime();
                if (microphone && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    measurement.invalidate(engine); engine.setInputDevice(-1); acquiredInputDevice = -1; inputDevice = -1; microphone = false; changed();
                }
                if (decoderEnded && playing && engine.getQueuedFrames() == 0) {
                    decoderEnded = false;
                    try { advanceQueue(1, true); changed(); } catch (Exception error) { Log.w("EffeTuneQueue", "Cannot play the next track", error); pause(false); }
                }
                if (visible && telemetryVisible && events != null) {
                    byte[] data = remapTelemetry(engine.readTelemetry());
                    if (data != null && data.length > 0) send("telemetry", object("revision", revision, "packet", Base64.encodeToString(data, Base64.NO_WRAP)));
                }
                if (playing && visible) send("snapshot", snapshot());
            }
            control.postDelayed(this, 100);
        }
    };

    static JSONObject object(Object... pairs) {
        JSONObject result = new JSONObject();
        try { for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]); }
        catch (Exception error) { throw new IllegalArgumentException(error); }
        return result;
    }

    @Override public void onDestroy() {
        destroyed = true;
        unregisterReceiver(noisy); audioManager.unregisterAudioDeviceCallback(devices);
        control.post(() -> {
            control.removeCallbacks(tick);
            if (midi != null) midi.close();
            if (recordingMonitor != null) recordingMonitor.close();
            if (assets != null) assets.discardPending();
            if (measurement != null) { engine.cancelMeasurement(); measurement.clear(); }
            if (queue != null) saveQueue();
            if (remote != null) remote.close();
            if (engine != null) engine.stop();
            audioManager.abandonAudioFocusRequest(focus); session.release();
            Runnable release = () -> control.post(() -> {
                if (engine != null) engine.close();
                if (queue != null) queue.close();
                // Android Binder callbacks can retain a destroyed Service briefly.
                // Its DSP catalog and canonical history no longer belong to that lifetime.
                packer = null; pipelineRequest = null; pipeline = new JSONArray(); source = null;
                slots.clear(); undo.clear(); redo.clear(); remotePending.clear(); remoteAuthority.clear();
                mappings = null; midi = null; decoder = null; assets = null; measurement = null; queue = null; remote = null;
                control.removeCallbacksAndMessages(null);
                thread.quitSafely();
            });
            if (decoder != null) decoder.closeAfterDecode(release); else release.run();
        });
        super.onDestroy();
    }
}

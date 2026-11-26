package com.frieve.effetune;

import android.Manifest;
import android.app.AppOpsManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaMetadataRetriever;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.OperationCanceledException;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.util.Log;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.BitSet;
import java.util.HashMap;
import java.util.HashSet;
import java.security.SecureRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.BooleanSupplier;
import java.net.NetworkInterface;
import java.net.Inet4Address;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Sole owner of the engine and playback state, independent of the WebView lifetime. */
public final class AudioService extends Service {
    interface Reply {
        void complete(JSONObject result, HostError error);
        default void permissionWaiting(boolean waiting) { }
    }
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
    private NetworkOutput networkOutput;
    private OpenHomeHost openHome;
    private LivePcmInput liveInput;
    private LibraryShareServer libraryShare;
    Ssdp ssdp;
    private final LanHttp lanHttp = new LanHttp();
    private final MediaGateway mediaGateway = new MediaGateway(lanHttp);
    private PcmDecoder decoder;
    private MidiInput midi;
    private String loadedScore;
    private boolean liveMidiEnabled;
    private int scoreRevision;
    private boolean scorePreparing;
    private MidiMappings mappings;
    private boolean resumeEngineOnFocus;
    private long lastMidiHistory = Long.MIN_VALUE;
    private AudioManager audioManager;
    private AudioFocusRequest focus;
    private MediaSession session;
    private Object attached;
    private Events events;
    private boolean visible;
    private boolean featurePage;
    private boolean telemetryVisible = true;
    // Desktop setDisplayDspBypassed: display-only effects pass audio through while nothing shows them.
    private boolean skipDisplayDsp = true, displayHidden, displayBypass;
    private NativeEngine displayBypassEngine;
    private boolean running;
    private volatile boolean destroyed;
    private boolean playing;
    private boolean resumeOnFocus;
    private boolean microphone;
    private int acquiredInputDevice = -1;
    // Measurement level metering: the metered channel (-1 off) and the player input it replaced.
    private int meterChannel = -1, meterSavedInput = -1;
    private boolean useInputWithPlayer;
    private int latencyMode = 1;
    private int[] outputStats = new int[8];
    private boolean masterBypass;
    private boolean decoderEnded;
    private boolean gapless = true;
    // Rendered-frame count at which the frames the decoder is producing start to play.
    private long decodeOrigin;
    // The next track whose PCM follows the current track in the same generation.
    private NextTrack nextTrack;
    // Generation of the last track load; a failure in it before any PCM is a load failure.
    private long loadGeneration = -1;
    // Queue entries that failed to load since a track last played; a failure skips them.
    private final HashSet<Integer> failedEntries = new HashSet<>();
    private boolean sourceReady;
    private boolean sourceExhausted;
    private boolean autoSuspended;
    private boolean temporalMustProcess;
    private boolean primaryMustProcess, parallelMustProcess, parallelActive;
    private final HashMap<String, Integer> parallelInstances = new HashMap<>();
    private final HashMap<String, String> parallelTypes = new HashMap<>();
    private AssetTransfers parallelAssets;
    private JSONObject parallelRefs;
    private boolean preparingBlindAssets;
    private boolean parallelReady;
    private String powerMode = "balanced";
    private double silenceThresholdDb = -80;
    private double suspendDelay = 300;
    private float lastPowerSequence = -1;
    private String powerState = "SUSPENDED";
    private long revision;
    private long lastPipelineRevision;
    private boolean pipelineStartupPending = true;
    private long generation;
    private long positionUs;
    private long renderStart;
    private long lastPcmFrame;
    private boolean pcmStalled;
    private long durationUs;
    private double speed = 1;
    private boolean preservePitch = true;
    private float volume = 1;
    private float focusGain = 1;
    private boolean muted;
    private int inputDevice = -1;
    private int preferredOutputDevice;
    private JSONObject source;
    private JSONObject metadataSource;
    private long metadataRevision;
    private String metadataTitle, metadataArtist, metadataAlbum;
    private Bitmap metadataArtwork;
    private MediaMetadata playbackMetadata;
    private final ThreadPoolExecutor metadataWorker = new ThreadPoolExecutor(0, 1, 1, TimeUnit.SECONDS, new LinkedBlockingQueue<>());
    private CancellationSignal metadataCancellation;
    private PlaybackQueueStore queue;
    private JSONObject queueRestoreResult;
    private long lastQueueSave;
    private JSONObject stagedQueueSettings;
    private String queueTransaction;
    private String queueTransactionRemoteId;
    private int queueIndex = -1;
    private long queueRevision, queueFocus;
    private boolean catalogQueue, restoredUnloaded, playbackStopped;
    private String repeat = "off";
    private boolean shuffle;
    private QueueShuffle shuffleOrder = new QueueShuffle(0);
    private int shuffleOffset;
    private final SecureRandom random = new SecureRandom();
    private JSONArray pipeline = new JSONArray();
    private JSONObject pipelineRequest;
    private NativeParameterPacker packer;
    // Effect names remote clients may add (the renderer's list); null until a renderer has published one.
    private JSONArray offeredEffects;
    private String slot = "A";
    private final HashMap<String, JSONObject> slots = new HashMap<>();
    private boolean pageSlotRecords;
    private record PipelineHistory(JSONObject selected, JSONObject other) {}
    private final ArrayList<PipelineHistory> undo = new ArrayList<>();
    private final ArrayList<PipelineHistory> redo = new ArrayList<>();
    private String historyOperationToken;
    private final HashMap<String, Integer> instances = new HashMap<>();
    private final HashMap<String, String> instanceTypes = new HashMap<>();
    private final HashSet<Integer> visualizerTaps = new HashSet<>();
    private final HashMap<Integer, String> runtimeEvents = new HashMap<>();
    private String reportedLatency;
    private long instanceEpoch;
    private AssetTransfers assets;
    private MeasurementCapture measurement;
    private JSONObject measurementPipeline;
    private int meterRate, meterOutputDevice, meterWidth;
    private boolean outputRestorePending;
    private RecordingMonitor recordingMonitor;
    private boolean focusHeld;
    private boolean outputRecoveryAttempted;
    private long outputRecoveryFrame;
    // Skip initial UI autostart once output has started or feature navigation has stopped it.
    private boolean outputStarted;
    private String outputStopReason;
    // The output a failed effect graph or a new processing rate stopped: the next pipeline that builds restores it.
    private boolean resumeOutput, resumePlayback;
    // A pipeline built while EffeTune was hidden: showing it again restores the stopped output.
    private boolean resumeWhenVisible;
    // The foreground holds playback and live processing; a paused queue keeps only its notification.
    private boolean foreground, notified, foregroundMicrophone;
    // An explicit stop removes even a paused notification once independent foreground work finishes.
    private boolean dismissWhenIdle;
    private static final java.util.List<Integer> SAMPLE_RATES = java.util.Arrays.asList(44100, 48000, 88200, 96000);
    private RemoteControlServer remote;
    private boolean pwaPageReady, pwaLibraries, pwaPlayers;
    private RemoteControlServer transportOnWorker;
    private final ThreadPoolExecutor remoteIo = new ThreadPoolExecutor(0, 1, 1, TimeUnit.SECONDS, new LinkedBlockingQueue<>());
    private RemotePairing remotePairing;
    private RemoteEffectsClient effectsClient;
    private Ssdp.Lease remoteAdvertisement;
    private JSONArray remoteAddresses = new JSONArray();
    private Reply remoteStartReply;
    private volatile boolean remotePreferencesReady;
    private boolean remoteStartFailed;
    private int settingsRevision;
    private record PemSelection(String id, String name, String pem) {}
    private final HashMap<String, PemSelection> pemSelections = new HashMap<>();
    private boolean rendererReady;
    private JSONObject rendererState = new JSONObject();
    private final HashMap<String, Consumer<JSONObject>> remotePending = new HashMap<>();
    private final HashMap<String, BooleanSupplier> remoteAuthority = new HashMap<>();
    // IR transfers in flight: a putIR's assembled upload, or the client a getIR's chunks go to.
    private final HashMap<String, RemoteTransfer> remoteTransfers = new HashMap<>();
    // remote-v1 rev advances only when the state clients see changes, as on the desktop host.
    private long remoteRev;
    private String remoteContent;
    private long irsChangedFirstAt;
    private final Runnable irsChanged = () -> { irsChangedFirstAt = 0; if (remote != null) remote.broadcastSync(object("op", "irsChanged")); };
    // A Service-only remote edit was packed without getWorkletPluginData; the next renderer repacks it.
    private boolean remoteRepack;
    private final HashMap<String, JSONObject> previews = new HashMap<>();

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        // Stop the output on disconnect, including live input and effects that generate sound.
        // Keep the input selection and the paused playback notification for manual resume.
        @Override public void onReceive(Context context, Intent intent) {
            control.post(() -> {
                // The duplex measurement observes its actual stream routes.
                if (meterChannel >= 0) return;
                boolean interrupted = !featurePage && (running || autoSuspended || resumeEngineOnFocus || resumeOutput);
                stopAudio(false, false);
                if (interrupted) outputStopReason = "noisy";
                changed();
            });
        }
    };
    private final AudioDeviceCallback devices = new AudioDeviceCallback() {
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            control.post(() -> {
                if (engine == null) return;
                for (AudioDeviceInfo device : removed)
                    if (device.getId() == meterSavedInput) meterSavedInput = -1;
                if (meterChannel >= 0) {
                    int input = engine.measurementInputDevice(), output = engine.getOutputDeviceId();
                    for (AudioDeviceInfo device : removed) {
                        if ((device.isSource() && (device.getId() == input || device.getId() == inputDevice))
                                || (device.isSink() && (device.getId() == output || device.getId() == meterOutputDevice))) {
                            measurementDevicesLost();
                            break;
                        }
                    }
                }
                for (AudioDeviceInfo device : removed) {
                    if (meterChannel < 0 && device.getId() == inputDevice) {
                        engine.setInputDevice(-1); acquiredInputDevice = -1; inputDevice = -1; microphone = false;
                    }
                }
                restoreOutputDevice(); changed();
            });
        }
        @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { control.post(() -> { restoreOutputDevice(); changed(); }); }
    };

    @Override public void onCreate() {
        super.onCreate();
        long created = System.currentTimeMillis();
        thread = new HandlerThread("EffeTune control");
        thread.start();
        control = new Handler(thread.getLooper());
        remoteIo.execute(this::loadRemotePreferences);
        audioManager = getSystemService(AudioManager.class);
        restoreNotificationText();
        session = new MediaSession(this, "EffeTune");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { internal("playback.play", new JSONObject(), true); }
            @Override public void onPause() { internal("playback.pause", new JSONObject(), true); }
            @Override public void onStop() { internal("audio.stop", new JSONObject(), true); }
            @Override public void onSkipToNext() { internal("playback.next", new JSONObject(), true); }
            @Override public void onSkipToPrevious() { internal("playback.previous", new JSONObject(), true); }
            @Override public void onSeekTo(long position) { try { internal("playback.seek", new JSONObject().put("position", position / 1000.0), true); } catch (Exception ignored) { } }
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
                        if (resumeEngineOnFocus) {
                            if (recoverSelectedOutput()) {
                                running = true; powerState = "ACTIVE";
                                scheduleSampleStreams();
                                refreshInputOwnership();
                            } else if (meterChannel >= 0) measurementDevicesLost();
                            resumeEngineOnFocus = false;
                            changed();
                        }
                        updateForeground();
                        if (resumeOnFocus) { resumeOnFocus = false; internal("playback.play", new JSONObject()); }
                    } else if (change != AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                        boolean transientLoss = change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT;
                        boolean resume = transientLoss && filePlaying();
                        // A transient loss keeps the foreground: regaining focus is not a user action that could start it again.
                        resumeEngineOnFocus = transientLoss && running;
                        clearPreviews(); pause(false); resumeOnFocus = resume;
                        engine.setInputDevice(-1); acquiredInputDevice = -1; microphone = false; engine.stop(); running = false; powerState = "SUSPENDED";
                        if (!transientLoss) {
                            if (meterChannel >= 0) measurementDevicesLost();
                            updateRemoteLifetime();
                        }
                        changed();
                    }
                }, control).build();
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        audioManager.registerAudioDeviceCallback(devices, control);
        control.post(() -> {
            // The DSP block matches the Web worklet and desktop default; larger device callbacks are split.
            int savedRate = getSharedPreferences("audio", MODE_PRIVATE).getInt("sampleRate", 48000);
            preferredOutputDevice = savedDevice("outputDevice", AudioManager.GET_DEVICES_OUTPUTS, 0);
            int width = outputWidth(preferredOutputDevice, getSharedPreferences("audio", MODE_PRIVATE).getInt("channelCount", 2));
            engine = new NativeEngine(SAMPLE_RATES.contains(savedRate) ? savedRate : 48000, 128, width);
            ssdp = new Ssdp(this, control, packet -> send("upnp-device", packet));
            networkOutput = new NetworkOutput(this, control, this::send, this::sessionState);
            openHome = new OpenHomeHost(this, control, ssdp, mediaGateway, lanHttp, this::send, this::updateForeground);
            useInputWithPlayer = getSharedPreferences("audio", MODE_PRIVATE).getBoolean("useInputWithPlayer", false);
            gapless = getSharedPreferences("audio", MODE_PRIVATE).getBoolean("gaplessPlayback", true);
            latencyMode =getSharedPreferences("audio", MODE_PRIVATE).getInt("latencyMode", 1);
            if (latencyMode < 0 || latencyMode > 2) latencyMode = 1;
            engine.setLatency(latencyMode);
            engine.setOutputDevice(preferredOutputDevice);
            inputDevice = savedDevice("inputDevice", AudioManager.GET_DEVICES_INPUTS, -1);
            assets = new AssetTransfers(this);
            measurement = new MeasurementCapture(this, () -> send("measurement-invalidated", object("reason", "audio-conditions-changed")));
            recordingMonitor = new RecordingMonitor(audioManager, control, () -> engine.getInputSessionId(), () -> {
                measurement.invalidate(engine); engine.setGain(focusGain);
                refreshInputOwnership();
            });
            queue = new PlaybackQueueStore(this);
            try {
                packer = new NativeParameterPacker(this);
                packer.restoreNames(new JSONObject(getSharedPreferences("audio", MODE_PRIVATE).getString("effectNames", "{}")));
                String offered = getSharedPreferences("audio", MODE_PRIVATE).getString("offeredEffects", null);
                if (offered != null) offeredEffects = new JSONArray(offered);
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
            midi.restoreOutput(getSharedPreferences("audio", MODE_PRIVATE).getString("midiOutputDeviceKey", ""));
            try { String savedMappings = getSharedPreferences("audio", MODE_PRIVATE).getString("midiMappings", null); if (savedMappings != null) midi.configure(new JSONObject(savedMappings)); }
            catch (Exception error) { Log.w("EffeTuneMidi", "Stored device selection could not be restored", error); }
            decoder = createDecoder();
            try {
                JSONObject savedSlots = new JSONObject(getSharedPreferences("audio", MODE_PRIVATE).getString("slots", "{}"));
                for (String key : new String[]{"A", "B"}) if (savedSlots.has(key)) slots.put(key, savedSlots.getJSONObject(key));
            } catch (Exception error) { Log.w("EffeTune", "Stored comparison slots could not be restored", error); }
            String saved = getSharedPreferences("audio", MODE_PRIVATE).getString("pipeline", null);
            if (saved != null) try {
                applyPipeline(new JSONObject(saved));
                pipelineStartupPending = true;
                revision = 1;
            } catch (Exception error) { Log.w("EffeTune", "Stored pipeline could not be restored", error); }
            try {
                JSONObject queueSettings = queue.settings();
                try { queueSettings = pruneStoredQueue(queueSettings); }
                catch (Exception error) { Log.w("EffeTuneQueue", "Stored queue could not be checked", error); }
                queueIndex = queueSettings.optInt("index", -1);
                repeat = queueSettings.optString("repeat", "off"); shuffle = queueSettings.optBoolean("shuffle", false);
                catalogQueue = queueSettings.optBoolean("catalogQueue");
                shuffleOrder = new QueueShuffle(queueSettings.optInt("shuffleSeed"));
                shuffleOffset = queueSettings.optInt("shuffleOffset");
                double savedSpeed = queueSettings.optDouble("speed", 1), savedVolume = queueSettings.optDouble("volume", 1);
                if (Double.isFinite(savedSpeed) && savedSpeed >= 0.25 && savedSpeed <= 4) speed = savedSpeed;
                if (Double.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) volume = (float) savedVolume;
                preservePitch = queueSettings.optBoolean("preservePitch", true); muted = queueSettings.optBoolean("muted", false);
                engine.setPlayerGain(muted ? 0 : volume);
                if (queueIndex >= 0 && queueIndex < queue.length()) {
                    source = queue.getJSONObject(queueIndex);
                    restoredUnloaded = true;
                    playbackStopped = queueSettings.optBoolean("stopped");
                    int entryId = source.getInt("queueEntryId");
                    if (entryId == queueSettings.optInt("positionEntryId", entryId)) {
                        positionUs = Math.max(0, queueSettings.optLong("positionUs", 0));
                        durationUs = Math.max(0, queueSettings.optLong("durationUs", 0));
                        if (durationUs > 0) positionUs = Math.min(positionUs, durationUs);
                        sourceExhausted = queueSettings.optBoolean("sourceExhausted", false);
                    }
                }
            } catch (Exception error) { Log.w("EffeTune", "Stored queue could not be restored", error); }
            MainActivity.deleteUnusedImports(this, queue, created);
            publishMetadata();
            libraryShare = new LibraryShareServer(this, control, ssdp, mediaGateway, this::send, this::updateForeground);
            libraryShare.restore();
            control.post(tick);
        });
    }

    @Override public IBinder onBind(Intent intent) { return binder; }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        String action = intent == null ? null : intent.getAction();
        // Dismissing a paused queue's notification ends the Service once the page closes.
        if (NOTIFICATION_DISMISSED.equals(action)) control.post(() -> {
            if (!foreground) { notified = false; dismissWhenIdle = true; updateForeground(); }
        });
        else if (action != null) internal(action, new JSONObject(), true);
        return START_NOT_STICKY;
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        MainActivity.cancelSharedImports();
        shutDown(true);
    }

    void attach(Object owner, Events observer, boolean foreground) { control.post(() -> { attached = owner; events = observer; visible = foreground; refreshInputOwnership(); runtimeEvents.clear(); updateForeground(); updateRemoteLifetime(); send("snapshot", snapshot()); }); }
    void detach(Object owner) { control.post(() -> { if (attached == owner) { attached = null; events = null; visible = false; pageGone(false); } }); }
    void rendererGone(Object owner) { control.post(() -> { if (attached == owner) pageGone(false); }); }
    void pageStarted(Object owner, boolean nextFeaturePage) {
        control.post(() -> {
            if (attached == owner && (featurePage || nextFeaturePage)) pageGone(nextFeaturePage);
        });
    }
    // What the page held ends with it: its preview sounds, MIDI learning, its remote renderer role,
    // a running measurement or test signal, and the level meter with the microphone that feeds it.
    private void pageGone(boolean nextFeaturePage) {
        boolean stopOutput = featurePage || nextFeaturePage;
        releaseBenchmarkBuffers();
        featurePage = nextFeaturePage;
        if (stopOutput) {
            telemetryVisible = !featurePage;
            outputStarted = true;
            stopAudio(false);
            if (loadedScore != null) releaseScore();
            restoredUnloaded = source != null;
            outputStopReason = "feature-page";
            if (nextFeaturePage) networkOutput.setOutputHandedOff(true, engine);
        }
        if (effectsClient != null) effectsClient.close();
        clearPairingPage();
        stopLiveInput();
        if (libraryShare != null) libraryShare.pageGone();
        pwaPageReady = false;
        if (remote != null && remote.pwa != null) remote.pwa.pageGone();
        if (ssdp != null) ssdp.stopPage();
        if (openHome != null) openHome.rendererUnavailable();
        stopBlindTest(false);
        clearPreviews(); rendererReady = false; rendererState = new JSONObject(); publishRemoteState();
        if (mappings != null) mappings.setLearning(false);
        boolean hadMeter = meterChannel >= 0;
        if (hadMeter) endMeasurementInput();
        else { endMeasurement(); refreshInputOwnership(); }
        if (stopOutput || hadMeter) changed();
        updateForeground();
        updateRemoteLifetime();
    }
    void setVisible(Object owner, boolean value) {
        control.post(() -> {
            if (attached != owner) return;
            visible = value;
            if (!value && remotePairing != null) remotePairing.unavailable();
            if (!value) clearPreviews();
            else if (resumeOutput && resumeWhenVisible) { resumeStoppedOutput(); changed(); }
            else refreshInputOwnership();
            updateForeground();
            updateRemoteLifetime();
        });
    }

    // The benchmark has its own engine and buffers, owned by a worker that exits when idle.
    private final ThreadPoolExecutor benchmarkExecutor = new ThreadPoolExecutor(
            0, 1, 30, TimeUnit.SECONDS, new LinkedBlockingQueue<>());
    private ByteBuffer benchmarkInput, benchmarkAsset;
    private volatile Object benchmarkOwner;

    private void releaseBenchmarkBuffers() {
        if (benchmarkOwner == null) return;
        benchmarkOwner = null;
        benchmarkExecutor.execute(() -> benchmarkInput = benchmarkAsset = null);
    }

    void command(JSONObject request, Reply reply, boolean fromVisibleUi) {
        String name = request.optString("command");
        if (name.startsWith("benchmark.")) {
            control.post(() -> {
                if (destroyed || !featurePage || (!fromVisibleUi && !name.equals("benchmark.release"))) {
                    reply.complete(null, new HostError("benchmark-unavailable", "Open EffeTune to run the performance benchmark."));
                    return;
                }
                if (benchmarkOwner == null) benchmarkOwner = new Object();
                Object owner = benchmarkOwner;
                benchmarkExecutor.execute(() -> {
                    if (destroyed || owner != benchmarkOwner) {
                        reply.complete(null, new HostError("benchmark-unavailable", "Open EffeTune to run the performance benchmark."));
                        return;
                    }
                    try { reply.complete(benchmarkCommand(name, request.getJSONObject("payload")), null); }
                    catch (Exception error) {
                        Log.w("EffeTuneBenchmark", "Benchmark request failed", error);
                        reply.complete(null, new HostError("benchmark-failed", "The performance benchmark could not run. Try running it again."));
                    }
                });
            });
            return;
        }
        command(request, reply, fromVisibleUi, () -> true);
    }

    private JSONObject benchmarkCommand(String name, JSONObject args) throws Exception {
        switch (name) {
            case "benchmark.upload": {
                String kind = args.getString("kind");
                if (kind.equals("input")) benchmarkInput = uploadBenchmarkBytes(benchmarkInput, args);
                else if (kind.equals("asset")) benchmarkAsset = uploadBenchmarkBytes(benchmarkAsset, args);
                else throw new IllegalArgumentException("Unknown benchmark buffer");
                return new JSONObject();
            }
            case "benchmark.run": return runBenchmark(args);
            case "benchmark.release":
                benchmarkInput = benchmarkAsset = null;
                return new JSONObject();
            default: throw new IllegalArgumentException("Unknown benchmark request");
        }
    }

    private static ByteBuffer uploadBenchmarkBytes(ByteBuffer buffer, JSONObject args) throws Exception {
        int size = args.getInt("byteLength"), offset = args.getInt("offset");
        byte[] bytes = Base64.decode(args.getString("data"), Base64.DEFAULT);
        if (size < 1 || size > 32 * 1024 * 1024 || offset < 0 || offset >= size
                || bytes.length == 0 || bytes.length > size - offset)
            throw new IllegalArgumentException("Invalid benchmark upload");
        if (offset == 0) buffer = ByteBuffer.allocate(size);
        if (buffer == null || buffer.capacity() != size || buffer.position() != offset)
            throw new IllegalArgumentException("Benchmark upload is out of order");
        return buffer.put(bytes);
    }

    private JSONObject runBenchmark(JSONObject args) throws Exception {
        ByteBuffer asset = benchmarkAsset;
        benchmarkAsset = null;
        String status = "setup";
        try {
            int rate = args.getInt("rate"), channels = args.getInt("channels");
            int blockSize = args.getInt("blockSize"), warmupBlocks = args.getInt("warmupBlocks");
            if (benchmarkInput == null || benchmarkInput.hasRemaining() || warmupBlocks < 0
                    || (long) warmupBlocks * blockSize > 1024 * 1024)
                throw new IllegalArgumentException("Invalid benchmark input or warmup");
            PackedChain chain = parsePackedChain(args);
            try (NativeEngine candidate = NativeEngine.createBenchmark(rate, blockSize, channels)) {
                int[] handles = candidate.configurePipeline(chain.types.toArray(new String[0]),
                        chain.parameters.toArray(new float[0][]), chain.layouts, chain.pluginIds, chain.descriptor,
                        chain.parameterBytes.toArray(new byte[0][]), chain.flags);
                if (handles == null || handles.length != 1)
                    throw new IllegalArgumentException("The benchmark requires one effect");
                JSONObject metadata = args.optJSONObject("asset");
                if (metadata != null) {
                    status = "asset";
                    prepareBenchmarkAsset(candidate, handles[0], metadata, asset, blockSize, channels);
                }
                status = "processing";
                long[] result = candidate.benchmark(benchmarkInput.array(), channels, warmupBlocks, 1_000_000_000L);
                return object("status", "ok", "elapsedNs", result[0], "blocks", result[1]);
            }
        } catch (Exception error) {
            Log.w("EffeTuneBenchmark", "Effect benchmark failed during " + status, error);
            return object("status", status);
        }
    }

    private static void prepareBenchmarkAsset(NativeEngine candidate, int instance, JSONObject metadata,
                                              ByteBuffer asset, int blockSize, int channels) throws Exception {
        if (asset == null || asset.hasRemaining() || asset.capacity() != metadata.getInt("byteLength"))
            throw new IllegalArgumentException("Incomplete benchmark asset");
        int[] info = {-1, -1, -1, metadata.getInt("headBlock"), metadata.getInt("rateDivider"),
                metadata.optInt("pathCount"), metadata.optInt("inputCount"), metadata.getInt("processingChannels"),
                metadata.getInt("footprintBytes"), asset.capacity()};
        int slot = metadata.getInt("slot");
        int status = candidate.setAsset(instance, slot, info, asset.array(), metadata.getInt("formatTag"), 1);
        if (status < 0) throw new IllegalStateException("Benchmark asset was rejected");
        JSONObject soundFont = metadata.optJSONObject("soundFont");
        long deadline = SystemClock.elapsedRealtime() + 2000;
        byte[] silence = new byte[blockSize * channels * Float.BYTES];
        long[] stream = null;
        do {
            if (soundFont != null && stream == null && (stream = benchmarkSampleStream(candidate, instance)) != null
                    && publishBenchmarkPages(candidate, instance, stream, soundFont.getJSONArray("pages")))
                status = 0;
            int[] notices = candidate.readAssetNotices();
            for (int i = 0; i + 5 < notices.length; i += 6) {
                if (notices[i] != instance || notices[i + 1] != slot || notices[i + 4] != 1) continue;
                if (notices[i + 3] != 0) throw new IllegalStateException("Benchmark asset was rejected");
                if (notices[i + 2] == 3) status = 0;
            }
            if (status == 0) {
                if (soundFont != null) startBenchmarkNotes(candidate, instance, stream, soundFont.getJSONArray("notes"),
                        silence, channels);
                return;
            }
            candidate.benchmark(silence, channels, 1, 0);
            SystemClock.sleep(1);
        } while (SystemClock.elapsedRealtime() < deadline);
        throw new IllegalStateException("Benchmark asset preparation timed out");
    }

    private static long[] benchmarkSampleStream(NativeEngine candidate, int instance) {
        long[] records = candidate.sampleStreams();
        for (int i = 0; i + 3 < records.length; i += 4)
            if (records[i] == instance) return new long[] {records[i + 1], records[i + 2]};
        return null;
    }

    // Resident pages keep every benchmark voice independent of page streaming; true once the bank activates.
    private static boolean publishBenchmarkPages(NativeEngine candidate, int instance, long[] stream, JSONArray pages)
            throws Exception {
        int status = 0;
        for (int i = 0; i < pages.length(); i++) {
            JSONObject page = pages.getJSONObject(i);
            int frames = page.getInt("frames"), channels = page.getInt("channels");
            float[] pcm = new float[frames * channels];
            ByteBuffer.wrap(Base64.decode(page.getString("pcm"), Base64.DEFAULT)).order(ByteOrder.LITTLE_ENDIAN)
                    .asFloatBuffer().get(pcm);
            status = candidate.publishSamplePage(instance, stream[0], stream[1], page.getInt("sample"),
                    page.getLong("pageIndex"), pcm, frames, channels, true);
            if (status < 0) throw new IllegalStateException("Benchmark sample page was rejected");
        }
        return status > 0;
    }

    // Sustained live note-ons keep every voice sounding for the whole measurement.
    private static void startBenchmarkNotes(NativeEngine candidate, int instance, long[] stream, JSONArray notes,
                                            byte[] silence, int channels) throws Exception {
        if (stream == null || candidate.liveMidiSource(true) != 0)
            throw new IllegalStateException("Benchmark notes could not start");
        for (int i = 0; i < notes.length(); i++) {
            if (candidate.liveMidiEvent(0x90 | notes.getInt(i) << 8 | 100 << 16, i + 1, 0, null, 0) != 0)
                throw new IllegalStateException("Benchmark note was rejected");
        }
        // A page poll after the note-ons confirms the resident sample before the voices are admitted.
        for (int block = 0; block < 4; block++) {
            long[] poll = candidate.pollSamplePages(instance, stream[0], stream[1]);
            if (poll.length != 8) throw new IllegalStateException("Benchmark pages are not resident");
            candidate.benchmark(silence, channels, 1, 0);
        }
    }

    private void command(JSONObject request, Reply reply, boolean fromVisibleUi, BooleanSupplier authority) {
        if (destroyed) { reply.complete(null, new HostError("audio-unavailable", "Audio controls closed. Reopen EffeTune and try again.")); return; }
        control.post(() -> {
            try {
                if (destroyed) throw new HostError("audio-unavailable", "Audio controls closed. Reopen EffeTune and try again.");
                if (!authority.getAsBoolean()) throw new HostError("unauthorized", "Remote access changed. Reconnect and try again.");
                String name = request.getString("command");
                if (!remotePreferencesReady && (name.startsWith("remote.") || name.startsWith("remoteClient."))) {
                    deferRemoteCommand(request, reply, fromVisibleUi, authority); return; }
                // Commands act on the track that is playing, including a next track that started since the last tick.
                if (promoteReachedNextTrack()) control.post(() -> changed());
                JSONObject args = request.getJSONObject("payload");
                if (args.has("_remoteRequestId")) requireRemoteAuthority(args.getString("_remoteRequestId"));
                String pwaId = args.optString("_pwaRequestId", null);
                PwaNetworkHost pwaOwner = pwaId == null ? null : requirePwaRequest(pwaId);
                String assetBatch = name.startsWith("pipeline.asset.") ? args.optString("_assetBatch", null) : null;
                if (request.has("expectedRevision")) {
                    long expected = request.getLong("expectedRevision");
                    boolean pipelineEdit = name.equals("pipeline.set") || name.equals("pipeline.ui") || name.equals("pipeline.undo")
                            || name.equals("pipeline.redo") || name.equals("pipeline.slot") || name.equals("pipeline.copySlot")
                            || name.equals("pipeline.readSlot") || name.startsWith("pipeline.asset.");
                    // Playback and power notifications do not invalidate an edit of the same chain.
                    if (expected != revision && !(pipelineEdit && expected >= lastPipelineRevision && expected <= revision))
                        throw new HostError("revision-conflict", "Audio settings changed. Refresh the controls and try again.");
                }
                if (name.equals("remote.irChunk")) { sendIrChunk(args, reply); return; }
                if (name.startsWith("remoteClient.")) { remoteClientCommand(name, args, reply, fromVisibleUi); return; }
                if (name.startsWith("remote.") && remoteSettingsCommand(name, args, reply, fromVisibleUi)) return;
                if (name.startsWith("live.")) { liveCommand(name, args, reply, fromVisibleUi); return; }
                if (name.startsWith("network.output.")) {
                    JSONObject result = networkOutput.command(name, args, engine);
                    if (liveInput != null && name.equals("network.output.setReceiveSession") && args.getBoolean("active"))
                        liveInput.routeGeneration = Math.max(liveInput.routeGeneration, args.getLong("generation"));
                    reply.complete(result, null); return;
                }
                if (name.equals("openhome.rendererUnavailable")) stopLiveInput();
                if (name.startsWith("openhome.")) { openHome.command(name, args, reply); return; }
                if (name.equals("upnp.search")) { ssdp.searchPage(args.optBoolean("enabled", true)); reply.complete(new JSONObject(), null); return; }
                if (name.equals("upnp.http")) { lanHttp.request(args, request.getString("id"), reply, pwaOwner == null ? null : () -> pwaOwner.current(pwaId)); return; }
                if (name.equals("gateway.register")) { lanHttp.submit(() -> mediaGateway.register(args.getString("url"), false), reply); return; }
                if (name.equals("gateway.release")) { reply.complete(object("released", mediaGateway.release(args.getString("token"))), null); return; }
                if (name.startsWith("share.") && remote != null && remote.pwa != null) remote.pwa.sharingChanged(name, args);
                if (name.equals("share.respondPart")) { libraryShare.respondPart(args, reply); return; }
                if (name.startsWith("share.")) { reply.complete(libraryShare.command(name, args), null); return; }
                if (name.startsWith("pwa.")) { pwaCommand(name, args, reply); return; }
                if (name.startsWith("remote.")) { reply.complete(remoteCommand(name, args, fromVisibleUi), null); return; }
                if (name.startsWith("pipeline.asset.")) {
                    int branch = assetBranch(args);
                    if (args.has("inactiveSlot")) {
                        if (branch != 0) throw new IllegalArgumentException("Invalid asset destination");
                        reply.complete(inactiveSlotAsset(name, args).put("revision", revision), null); return;
                    }
                    JSONObject clearedParameters = name.equals("pipeline.asset.clear") ? AssetTransfers.assetParameters(args.optJSONObject("externalAssetParameters")) : null;
                    JSONObject result = branch == 0 ? assets.command(name, args, instances, instanceTypes, engine)
                            : parallelAssets.command(name, args, parallelInstances, parallelTypes, engine);
                    if (name.equals("pipeline.asset.commit") || name.equals("pipeline.asset.clear")) scheduleSampleStreams();
                    String state = result.getString("state");
                    if (branch == 0 && (result.has("reference") || state.equals("empty"))) {
                        JSONObject ref = result.optJSONObject("reference");
                        result.remove("reference");
                        storeSelectedAsset(args.getInt("pluginId"), args.optInt("slot", 0), ref, clearedParameters, assetBatch == null);
                    }
                    reply.complete(result.put("revision", revision), null); return;
                }
                if (name.startsWith("sfz.")) { reply.complete(sfzCommand(name, args), null); return; }
                if (name.equals("measurement.options")) {
                    measurementPipeline = pipelineRequest;
                    JSONArray names = new JSONArray();
                    boolean sectionEnabled = true;
                    for (int i = 0; !masterBypass && i < pipeline.length(); i++) {
                        JSONObject plugin = pipeline.getJSONObject(i);
                        if (plugin.optString("type").equals("SectionPlugin")) {
                            sectionEnabled = plugin.optBoolean("enabled", true);
                        } else if (sectionEnabled && plugin.optBoolean("enabled", true) && !plugin.optBoolean("skip")) {
                            names.put(plugin.getString("name"));
                        }
                    }
                    int rate = engine.getSampleRate();
                    reply.complete(object("sampleRate", rate, "supportedSampleRates", new JSONArray(SAMPLE_RATES),
                            "pipeline", measurementPipeline == null ? JSONObject.NULL : object("sampleRate", rate, "channelCount", engine.getChannelCount()),
                            "pluginNames", names), null); return;
                }
                if (name.equals("measurement.output")) {
                    int width = args.getInt("channelCount");
                    if (width != outputWidth(args.getInt("outputDeviceId"), width)) throw outputFormatError();
                    reply.complete(object("channelCount", width), null); return;
                }
                if (name.equals("measurement.input")) {
                    setMeasurementInput(args.optInt("deviceId", -1), args.optInt("inputChannel", 0),
                            args.optInt("sampleRate", engine.getSampleRate()), args.optInt("outputDeviceId", preferredOutputDevice),
                            args.optInt("outputChannelCount", engine.getChannelCount()), fromVisibleUi);
                    changed(); reply.complete(new JSONObject(), null); return;
                }
                if (name.startsWith("measurement.")) {
                    if (name.equals("measurement.start") || name.equals("measurement.noise.start")) {
                        checkMicrophoneAccess(fromVisibleUi);
                        if (inputDevice < 0) throw new HostError("permission-required", "Select a microphone before measuring.");
                        if (meterChannel < 0 || !measurement.matchesRate(meterRate))
                            throw new HostError("measurement-invalid", "The audio devices changed. Open the measurement again.");
                        try {
                            startOutput(true, false);
                            verifyMeterStreams();
                        } catch (HostError error) {
                            if (meterChannel >= 0) measurementDevicesLost();
                            throw error;
                        }
                        if (measurement.usesPipeline() && (measurementPipeline == null || measurementPipeline != pipelineRequest ||
                                engine.measurementChannels() != engine.getChannelCount() || engine.measurementRate() != engine.getSampleRate()))
                            throw new HostError("measurement-invalid", "The effect pipeline changed. Open the measurement again.");
                        pause(false); decoder.cancel(); generation = engine.beginSource();
                        sourceReady = false;
                        reconcileInputOwnership(true);
                        if (name.equals("measurement.start")) engine.setGain(1);
                        if (!recordingMonitor.arm()) throw new HostError("measurement-unavailable", "The microphone is unavailable or being used by another app. Try the measurement again.");
                        engine.setMeasurementPipeline(measurement.usesPipeline());
                    }
                    JSONObject value = measurement.command(name, args, engine);
                    if (!measurement.isRunning()) recordingMonitor.disarm();
                    if (name.equals("measurement.cancel") || name.equals("measurement.noise.stop")) engine.setGain(focusGain);
                    refreshInputOwnership();
                    reply.complete(value, null); return;
                }
                boolean changed = true;
                switch (name) {
                    case "dbt.restore": {
                        JSONObject a = args.getJSONObject("a").put("slot", "A");
                        JSONObject b = args.optJSONObject("b");
                        if (b != null) {
                            parsePackedChain(b);
                            b.put("slot", "B").put("assetRefs", new JSONObject());
                        }
                        stopBlindTest(true);
                        PipelineHistory previous = pipelineHistory();
                        installPipeline(a.put("assetRefs", new JSONObject()));
                        if (b == null) slots.remove("B"); else slots.put("B", b);
                        recordPipelineEdit(previous, null);
                        persistPipelineEdit();
                        collectAssets();
                        break;
                    }
                    case "dbt.start":
                        reply.complete(startBlindTest(args.getJSONObject("pipeline"), fromVisibleUi), null); return;
                    case "dbt.align":
                        requireBlindTest();
                        reply.complete(alignBlindTest(args), null); return;
                    case "dbt.select":
                        requireBlindTest();
                        if (!parallelReady) throw new IllegalStateException("Blind test preparation is incomplete");
                        if (engine.selectParallel(args.getInt("branch"), args.getDouble("seconds")) < 0)
                            throw new IllegalArgumentException("Invalid blind selection");
                        reply.complete(new JSONObject(), null); return;
                    case "dbt.fade":
                        requireBlindTest();
                        for (int branch = 0; branch <= 1; branch++)
                            if (engine.fadeOutput(branch, (float) args.getDouble("gain"), args.getDouble("seconds")) < 0)
                                throw new IllegalArgumentException("Invalid blind test fade");
                        reply.complete(new JSONObject(), null); return;
                    case "dbt.stop":
                        stopBlindTest(false); reply.complete(new JSONObject(), null); return;
                    case "pipeline.catalog":
                        JSONObject names = packer.catalog(args.getJSONArray("effects"));
                        offeredEffects = args.getJSONArray("offered");
                        getSharedPreferences("audio", MODE_PRIVATE).edit().putString("effectNames", names.toString())
                                .putString("offeredEffects", offeredEffects.toString()).apply();
                        JSONObject catalogSnapshot = snapshot();
                        // The saved graph already satisfies startup unless the page will apply its own graph.
                        if (!args.optBoolean("applyStartupConfig")) pipelineStartupPending = false;
                        reply.complete(catalogSnapshot, null); return;
                    case "pipeline.undo": moveHistory(undo, redo); break;
                    case "pipeline.redo": moveHistory(redo, undo); break;
                    case "pipeline.slot":
                        String destination = args.getString("slot");
                        if (!destination.equals("A") && !destination.equals("B")) throw new IllegalArgumentException("Invalid slot");
                        if (!destination.equals(slot)) {
                            JSONObject target = slots.get(destination);
                            if (target == null) target = slots.containsKey(slot) ? slots.get(slot) : packer.prepareChain(new JSONArray(), masterBypass, slot);
                            replacePipeline(withCurrentBypass(target).put("slot", destination));
                        }
                        break;
                    case "pipeline.copySlot":
                        String from = args.getString("from"), to = args.getString("to");
                        if ((!from.equals("A") && !from.equals("B")) || (!to.equals("A") && !to.equals("B"))) throw new IllegalArgumentException("Invalid slot");
                        if (from.equals("B") && !slots.containsKey("B")) { changed = false; break; }
                        JSONObject copy = withCurrentBypass(slots.containsKey(from) ? slots.get(from) : packer.prepareChain(new JSONArray(), masterBypass, from)).put("slot", to);
                        replacePipeline(copy);
                        break;
                    case "audio.devices": reply.complete(audioDevices(), null); return;
                    case "audio.notificationText":
                        saveNotificationText(args.getJSONObject("text"));
                        reply.complete(new JSONObject(), null); return;
                    case "audio.clock": reply.complete(object("frame", engine.getAudioFrameTime(), "sampleRate", engine.getSampleRate()), null); return;
                    case "pipeline.preview":
                        if (args.has("action")) { long applied = mixerAction(args); reply.complete(snapshot().put("appliedFrame", applied), null); return; }
                        preview(args, fromVisibleUi); reply.complete(snapshot(), null); return;
                    case "pipeline.frequencyPreview":
                        double tone = args.optDouble("frequency", 0);
                        boolean toneActive = Double.isFinite(tone) && tone > 0;
                        if (toneActive) {
                            if (!fromVisibleUi || !visible) throw new HostError("visible-start-required", "Open EffeTune to hear the test tone.");
                            startAudio(true);
                        }
                        engine.setFrequencyPreview(toneActive ? tone : 0, "bandpassNoise".equals(args.optString("sound")));
                        changed = false; break;
                    case "pipeline.resetPlugin":
                        Integer resetInstance = instances.get(String.valueOf(args.get("pluginId")));
                        if (resetInstance == null || engine.resetPlugin(resetInstance) < 0) throw new HostError("stale-pipeline", "The effect changed. Try again.");
                        changed = false; break;
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
                    case "midi.selectOutput": {
                        midi.selectOutput(args.optString("key"), (result, error) -> {
                            if (error == null) getSharedPreferences("audio", MODE_PRIVATE).edit()
                                    .putString("midiOutputDeviceKey", result.optString("selectedOutputKey")).apply();
                            reply.complete(result, error);
                        });
                        return;
                    }
                    case "midi.send":
                        midi.send(args, reply); return;
                    case "midi.liveSource":
                        liveMidiEnabled = args.getBoolean("enabled");
                        if (liveMidiEnabled && !playing && loadedScore != null) {
                            releaseScore(); sourceReady = false;
                        } else if (loadedScore == null) engine.liveMidiSource(liveMidiEnabled);
                        reply.complete(new JSONObject(), null); return;
                    case "midi.liveEvent": {
                        if (loadedScore == null && liveMidiEnabled) {
                            requireMainOutput();
                            if (!running) startAudio(fromVisibleUi);
                            JSONArray history = args.optJSONArray("state");
                            int[] words = null;
                            if (history != null) {
                                if (history.length() > 8192 * 3) throw new IllegalArgumentException("Invalid MIDI history");
                                words = new int[history.length()];
                                for (int i = 0; i < words.length; ++i) words[i] = history.getInt(i);
                            }
                            if (engine.liveMidiEvent(args.getInt("message"), args.getInt("note"), args.getInt("flags"),
                                    words, args.getDouble("delay")) < 0) {
                                stopBlindTest(true);
                                throw new IllegalStateException("Live MIDI delivery failed");
                            }
                        }
                        reply.complete(new JSONObject(), null); return;
                    }
                    case "midi.open": midi.open(args.getString("id"), reply); return;
                    case "midi.close": midi.closePagePort(args.getString("id")); changed = false; break;
                    // A page asks once its listeners exist, so the next tick repeats the latency it could not receive.
                    case "snapshot.get":
                        reportedLatency = null;
                        reply.complete(snapshot().put("midiOutputDeviceKey", midi.selectedOutputKey())
                                .put("preferredOutputChannelCount", savedOutputWidth()), null);
                        return;
                    case "pipeline.readSlot":
                        reply.complete(readSlotPage(args), null); return;
                    case "pipeline.set":
                        String operationToken = args.optString("operationToken", null);
                        args.remove("operationToken"); args.remove("assetRefs");
                        changed = replacePipeline(args, operationToken); remoteRepack = false; break;
                    case "pipeline.ui": changed = updatePipelineUI(args); break;
                    case "pipeline.bypass": replacePipeline(packer.prepareRecords(new JSONArray(pipeline.toString()), args.getBoolean("bypass"), slot)); break;
                    case "audio.start": outputRecoveryAttempted = false; startAudio(fromVisibleUi); break;
                    case "audio.stop": requireMainOutput(); stopAudio(); break;
                    case "audio.input":
                        requireMainOutput();
                        setInput(args.optInt("deviceId", -1), fromVisibleUi);
                        saveDevice("inputDevice", inputDevice, AudioManager.GET_DEVICES_INPUTS); break;
                    case "audio.configure":
                        if (args.has("useInputWithPlayer")) {
                            boolean previous = useInputWithPlayer;
                            useInputWithPlayer = args.getBoolean("useInputWithPlayer");
                            try { reconcileInputOwnership(measurement.isRunning()); }
                            catch (HostError error) { useInputWithPlayer = previous; throw error; }
                            getSharedPreferences("audio", MODE_PRIVATE).edit().putBoolean("useInputWithPlayer", useInputWithPlayer).apply();
                        }
                        if (args.has("gaplessPlayback") && args.getBoolean("gaplessPlayback") != gapless) {
                            gapless = !gapless;
                            getSharedPreferences("audio", MODE_PRIVATE).edit().putBoolean("gaplessPlayback", gapless).apply();
                            // As on the Web, a next track prepared while the setting was on never plays after it is turned off.
                            if (!gapless) withdrawNextTrack();
                        }
                        if (args.has("powerSettings")) configurePower(args.getJSONObject("powerSettings"));
                        int device = args.optInt("outputDeviceId", preferredOutputDevice);
                        if (device < 0) throw new IllegalArgumentException("Invalid output device");
                        String hint = args.optString("latencyHint");
                        int latency = !args.has("latencyHint") ? latencyMode : hint.equals("interactive") ? 0 : hint.equals("playback") ? 2 : 1;
                        int rate = args.optInt("sampleRate", engine.getSampleRate());
                        if (!SAMPLE_RATES.contains(rate)) throw new HostError("unsupported-format", "This sample rate is not available on Android. Choose one from the list.");
                        if (args.has("channelCount") || device != preferredOutputDevice || rate != engine.getSampleRate()) {
                            int requested = args.optInt("channelCount", savedOutputWidth());
                            if (requested < 2 || requested > 16) throw outputFormatError();
                            int width = outputWidth(device, requested);
                            if (width != engine.getChannelCount() || rate != engine.getSampleRate())
                                setEngineFormat(rate, width, device, latency);
                        }
                        // Only a changed setting reopens the output, and both settings share one reopen.
                        boolean reopen = device != preferredOutputDevice || latency != latencyMode;
                        if (reopen) {
                            boolean newDevice = device != preferredOutputDevice;
                            if (!reopenOutput(device, latency)) throw new HostError("output-unavailable", newDevice
                                    ? "The selected output is unavailable. Choose another device." : "The audio output cannot use this latency setting. Choose another one.");
                            if (newDevice) saveDevice("outputDevice", device, AudioManager.GET_DEVICES_OUTPUTS);
                            if (latency != latencyMode) {
                                latencyMode = latency;
                                getSharedPreferences("audio", MODE_PRIVATE).edit().putInt("latencyMode", latency).apply();
                            }
                        }
                        if (args.has("channelCount"))
                            getSharedPreferences("audio", MODE_PRIVATE).edit().putInt("channelCount", args.getInt("channelCount")).apply();
                        if (reopen) reconcileInputOwnership(measurement.isRunning());
                        changed = false; break;
                    case "telemetry.configure": telemetryVisible = args.optBoolean("visible", true); if (telemetryVisible) runtimeEvents.clear(); changed = false;
                        displayHidden = args.optBoolean("displayHidden"); break;
                    case "visualizer.sources": setVisualizerSources(args.getJSONArray("sources")); changed = false; break;
                    case "spectrum.tap": {
                        // The desktop setSpectrumTapRoute and setSpectrumTap port commands.
                        int pluginId = args.getInt("pluginId");
                        int status = args.has("route") ? engine.setSpectrumTapRoute(pluginId, args.getBoolean("route"))
                                : engine.setSpectrumTap(pluginId, args.getBoolean("enabled"),
                                        "compare".equals(args.optString("mode")), "hq".equals(args.optString("quality")));
                        if (status < 0) throw new IllegalStateException("Spectrum overlay unavailable");
                        changed = false; break;
                    }
                    case "visualSync":
                        if (engine.setVisualSync(args.getBoolean("enabled")) < 0) throw new IllegalStateException("Visual sync unavailable");
                        // Telemetry now carries a new route revision; publish the route report that names it.
                        networkOutput.command("network.output.rendererReady", new JSONObject(), engine);
                        changed = false; break;
                    case "audio.outputDelay": {
                        // The desktop setOutputDelay reply: the target once the output applies it, or -1.
                        // The blind test owns the output delays while it runs.
                        int target = parallelActive ? -1 : engine.setVisualSyncDelay(args.getInt("samples"));
                        NativeEngine owner = engine;
                        long deadline = SystemClock.elapsedRealtime() + 2000;
                        control.post(new Runnable() {
                            @Override public void run() {
                                boolean applied = target >= 0 && engine == owner && owner.getAppliedOutputDelay() == target;
                                if (applied || target < 0 || engine != owner || SystemClock.elapsedRealtime() >= deadline)
                                    reply.complete(object("samples", applied ? target : -1), null);
                                else control.postDelayed(this, 5);
                            }
                        });
                        return;
                    }
                    case "playback.getPublic": reply.complete(musicPlayback(args.optInt("start", 0), args.optInt("count", 100),
                            pwaOwner == null ? null : request.getString("id")), null); return;
                    case "playback.queue.takeRestoreResult":
                        JSONObject restoreResult = queueRestoreResult == null ? new JSONObject() : queueRestoreResult;
                        queueRestoreResult = null;
                        reply.complete(restoreResult, null); return;
                    case "playback.queue.read":
                        int offset = args.getInt("offset"), limit = args.optInt("limit", 64);
                        if (offset < 0 || limit < 1 || limit > 64) throw new IllegalArgumentException("Invalid queue page");
                        if (args.optBoolean("retained")) {
                            reply.complete(object("items", queue.retainedUris(offset, limit), "offset", offset,
                                    "total", queue.retainedLength(), "revision", queueRevision), null); return;
                        }
                        boolean canonical = args.optBoolean("canonical");
                        JSONArray page = new JSONArray();
                        for (int i = offset; i < queue.length() && page.length() < limit; i++) {
                            int canonicalIndex = canonical ? i : queueIndexAt(i);
                            page.put(sourceSnapshot(queue.getJSONObject(canonicalIndex)).put("canonicalOrdinal", canonicalIndex)
                                    .put("transportOrdinal", canonical ? queueOrdinalOf(i) : i));
                        }
                        reply.complete(object("items", page, "offset", offset, "total", queue.length(), "revision", queueRevision), null); return;
                    case "playback.queue.readGains":
                        reply.complete(object("items", args.has("afterId") ? queue.gainPage(args.getInt("afterId"))
                                : priorityGainEntries()), null); return;
                    case "playback.queue.updateGains":
                        applyQueueGains(args.getJSONArray("items"));
                        reply.complete(new JSONObject(), null); return;
                    case "playback.select":
                        int selection = args.getInt("index");
                        if (selection < 0 || selection >= queue.length()) throw new HostError("invalid-queue", "Choose a valid position in the playback queue.");
                        selectQueueEntry(args.optBoolean("transportOrder") ? queueIndexAt(selection) : selection, false); break;
                    case "playback.setSource":
                        failedEntries.clear();
                        try { setSource(args); }
                        catch (HostError error) {
                            if (!isLoadError(error)) throw error;
                            if (!args.has("queueEntryId")) { publishMetadata(); changed(); throw error; }
                            recordLoadFailure(args);
                            skipFailedTrack(false);
                        }
                        break;
                    case "playback.setQueue":
                        JSONArray items = args.getJSONArray("items");
                        int index = args.optInt("index", 0);
                        if (items.length() > 4096 || index < 0 || (items.length() > 0 && index >= items.length())) throw new HostError("invalid-queue", "Choose a valid playback queue.");
                        for (int i = 0; i < items.length(); i++) validateSource(items.getJSONObject(i));
                        queue.replace(items); queueIndex = queue.length() == 0 ? -1 : index;
                        setQueueMode(args);
                        installQueueOrder(args, queueIndex);
                        queueFocus++;
                        if (queueIndex >= 0) selectQueueEntry(queueIndex, false);
                        else clearCurrentTrack();
                        saveQueue(); break;
                    case "playback.queue.begin":
                        queueTransaction = args.getString("transactionId");
                        queueTransactionRemoteId = args.optString("_remoteRequestId", args.optString("_pwaRequestId", null));
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
                        int selected = args.optInt("index", stagedQueueSettings.optInt("index", 0));
                        if (selected < 0 || selected >= queue.stagedLength()) throw new HostError("invalid-queue", "Choose a valid track in the queue.");
                        boolean preservePlayback = args.optBoolean("preservePlayback");
                        if (preservePlayback) {
                            if (source == null || !sameTrack(source, queue.stagedItem(selected))) throw new HostError("stale-queue", "The playing track changed. Choose the queue again.");
                        }
                        stagedQueueSettings.put("index", selected);
                        if (args.has("startOrdinal")) stagedQueueSettings.put("startOrdinal", args.getInt("startOrdinal"));
                        String bulkPlayId = stagedQueueSettings.optString("bulkPlayId", null);
                        JSONObject previousQueue = null;
                        if (bulkPlayId != null && !queue.hasCheckpoint(bulkPlayId)) {
                            saveQueue();
                            previousQueue = queue.settings().put("playing", filePlaying()).put("unloaded", restoredUnloaded);
                            if (source != null && !source.has("queueEntryId")) previousQueue.put("detachedSource", source);
                        }
                        setQueueMode(stagedQueueSettings); queue.commit(stagedQueueSettings, bulkPlayId, previousQueue);
                        installQueueOrder(stagedQueueSettings, selected);
                        if (!preservePlayback) queueFocus++;
                        stagedQueueSettings = null; queueTransaction = null; queueTransactionRemoteId = null;
                        queueIndex = selected;
                        if (preservePlayback) {
                            JSONObject previous = source;
                            source = queue.getJSONObject(selected);
                            if (sourceReady && previous.optDouble("replayGainFactor", 1) != source.optDouble("replayGainFactor", 1)) {
                                long position = currentPosition();
                                seek(durationUs > 0 && position > durationUs ? durationUs : position);
                            } else reconcileNextTrack();
                        } else selectQueueEntry(selected, false);
                        saveQueue(); break;
                    case "playback.queue.abort":
                        if (args.getString("transactionId").equals(queueTransaction)) { queue.abort(); queueTransaction = null; stagedQueueSettings = null; queueTransactionRemoteId = null; }
                        changed = false; break;
                    case "playback.queue.restore":
                        changed = restoreQueue(args.getString("operationId"), fromVisibleUi);
                        break;
                    case "playback.queueMode":
                        boolean shuffled = shuffle;
                        setQueueMode(args);
                        if (shuffle != shuffled) { queue.clearOrder(); queueFocus++; queueRevision++; }
                        reconcileNextTrack();
                        saveQueue(); break;
                    case "playback.insert":
                        insertQueue(args);
                        break;
                    case "playback.next": advanceQueue(1, false, fromVisibleUi); break;
                    case "playback.previous": advanceQueue(-1, false, fromVisibleUi); break;
                    case "playback.play": startPlayback(fromVisibleUi); break;
                    case "playback.pause": pause(false); changed = false; break;
                    case "playback.stop": requireMainOutput(); resetCurrentTrack(); saveQueue(); break;
                    case "playback.close":
                        clearPlaybackQueue(); saveQueue(); break;
                    case "playback.seek": requireMainOutput(); seek((long) (args.getDouble("position") * 1_000_000)); break;
                    case "playback.speed":
                        double value = args.getDouble("speed");
                        if (!Double.isFinite(value) || value < 0.25 || value > 4) throw new HostError("invalid-speed", "Choose a playback speed between 0.25 and 4.");
                        positionUs = currentPosition(); speed = value; preservePitch = args.optBoolean("preservePitch", true);
                        if (featurePage) saveQueue();
                        else if (loadedScore != null) { engine.scoreSpeed(speed); saveQueue(); }
                        else if (restoredUnloaded || sourceExhausted || liveInput != null) saveQueue(); else seek(positionUs); break;
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

    private void internal(String command, JSONObject payload) { internal(command, payload, false); }
    // Notification, lock-screen and headset controls are user actions: they may restart the output from the background.
    private void internal(String command, JSONObject payload, boolean userAction) {
        command(object("command", command, "payload", payload), (result, error) -> {
            if (error != null) send("error", object("code", error.code, "message", error.getMessage()));
        }, userAction);
    }

    private boolean applyPipeline(JSONObject value) throws Exception {
        if (!installPipeline(value)) return false;
        persistPipelineEdit();
        return true;
    }

    private boolean installPipeline(JSONObject value) throws Exception {
        JSONObject requested = new JSONObject(value.toString());
        boolean replacePending = requested.has("assetRefs");
        if (!replacePending) {
            JSONObject previous = slots.get(requested.optString("slot", slot));
            JSONObject refs = previous == null ? new JSONObject() : previous.getJSONObject("assetRefs");
            requested.put("assetRefs", AssetTransfers.compatible(requested.getJSONArray("plugins"), refs));
            // A chain the Service derives from the current one keeps the rate that one was packed for.
            if (!requested.has("sampleRate")) requested.put("sampleRate", previous == null ? engine.getSampleRate() : previous.optInt("sampleRate", engine.getSampleRate()));
            if (!requested.has("channelCount")) requested.put("channelCount", previous == null ? engine.getChannelCount() : previous.optInt("channelCount", engine.getChannelCount()));
            if (previous != null && !remoteRepack && pipelineRequest != null && slot.equals(requested.optString("slot", slot))
                    && masterBypass == requested.optBoolean("masterBypass") && requested.getInt("sampleRate") == previous.optInt("sampleRate")
                    && requested.getInt("channelCount") == previous.optInt("channelCount") && sameHistoryState(previous, requested)) {
                pipelineStartupPending = false;
                return false;
            }
        }
        // Keep the user's settings in the slot. The runtime overlays the resident file's
        // controls until the newly requested file is ready.
        applyPipelineRuntime(requested, replacePending);
        // Slots and history retain the selected files while the runtime reports resident files.
        slots.put(slot, requested);
        pipelineStartupPending = false;
        return true;
    }

    /** Native form of one packed chain: validated effect records and the routing descriptor. */
    private static final class PackedChain {
        final ArrayList<String> ids = new ArrayList<>(), types = new ArrayList<>();
        final ArrayList<float[]> parameters = new ArrayList<>();
        final ArrayList<byte[]> parameterBytes = new ArrayList<>();
        int[] layouts, pluginIds;
        byte[] descriptor, flags;
    }

    private static PackedChain parsePackedChain(JSONObject value) throws Exception {
        JSONArray records = value.getJSONArray("plugins");
        if (records.length() > 128) throw new HostError("pipeline-too-large", "Use at most 128 effects.");
        PackedChain chain = new PackedChain();
        ArrayList<Integer> hashes = new ArrayList<>();
        byte[] flags = new byte[records.length()];
        HashSet<Integer> descriptorIds = new HashSet<>();
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.getJSONObject(index);
            if ("SectionPlugin".equals(record.getString("type"))) continue;
            int id = record.getInt("id");
            if (!descriptorIds.add(id)) throw new IllegalArgumentException("Duplicate effect id");
            chain.ids.add(Integer.toString(id));
            chain.types.add(record.getString("type"));
            // A skipped effect has no kernel, so it takes no parameters even after a Service-side repack.
            boolean skip = record.optBoolean("skip");
            JSONArray values = skip ? new JSONArray() : record.getJSONArray("parameterValues");
            if (values.length() > 4096) throw new IllegalArgumentException("Too many parameters");
            float[] packed = new float[values.length()];
            for (int p = 0; p < packed.length; p++) {
                packed[p] = (float) values.getDouble(p);
                if (!Float.isFinite(packed[p])) throw new IllegalArgumentException("Invalid parameter");
            }
            chain.parameters.add(packed);
            hashes.add((int) record.getLong("layoutHash"));
            chain.parameterBytes.add(!skip && record.has("parameterBytes") ? Base64.decode(record.getString("parameterBytes"), Base64.DEFAULT) : new byte[0]);
            flags[chain.types.size() - 1] = (byte) ((skip ? NativeEngine.SKIP_FLAG : 0)
                    | (record.optBoolean("displayOnly") ? NativeEngine.DISPLAY_ONLY_FLAG : 0));
        }
        byte[] descriptor = Base64.decode(value.getString("descriptor"), Base64.DEFAULT);
        ByteBuffer bytes = ByteBuffer.wrap(descriptor).order(ByteOrder.LITTLE_ENDIAN);
        if (descriptor.length < 8 || bytes.getInt(0) != 1 || bytes.getInt(4) != chain.types.size() || descriptor.length != 8 + chain.types.size() * 12) throw new IllegalArgumentException("Invalid pipeline descriptor");
        for (int i = 0; i < chain.types.size(); i++) {
            if (!descriptorIds.contains(bytes.getInt(8 + i * 12))) throw new IllegalArgumentException("Unknown descriptor effect");
        }
        int[] layouts = new int[hashes.size()];
        for (int i = 0; i < layouts.length; i++) layouts[i] = hashes.get(i);
        chain.layouts = layouts;
        chain.pluginIds = new int[chain.ids.size()];
        for (int i = 0; i < chain.pluginIds.length; i++) chain.pluginIds[i] = Integer.parseInt(chain.ids.get(i));
        chain.descriptor = descriptor;
        chain.flags = Arrays.copyOf(flags, chain.types.size());
        return chain;
    }

    private JSONObject startBlindTest(JSONObject value, boolean fromVisibleUi) throws Exception {
        if (parallelActive || slot.equals(value.getString("slot")) ||
                !("A".equals(value.getString("slot")) || "B".equals(value.getString("slot"))) ||
                engine.getSampleRate() != value.getInt("sampleRate") || engine.getChannelCount() != value.getInt("channelCount"))
            throw new IllegalStateException("Blind test pipeline changed");
        JSONObject stored = slots.get(value.getString("slot"));
        JSONObject refs = AssetTransfers.compatible(value.getJSONArray("plugins"),
                stored != null && stored.has("assetRefs") ? stored.getJSONObject("assetRefs") : new JSONObject());
        // Reuse a saved file only for the exact definition requested by this slot.
        JSONObject requested = value.getJSONObject("storedAssets");
        java.util.Iterator<String> keys = refs.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!requested.has(key) || !requested.getString(key).equals(refs.getJSONObject(key).optString("externalAssetSignature")))
                keys.remove();
        }
        JSONArray stale = AssetTransfers.stale(refs, engine.getSampleRate());
        for (int i = 0; i < stale.length(); i++) refs.remove(stale.getString(i));
        applyAssetParameters(value, refs);
        PackedChain chain = parsePackedChain(value);
        try {
            try (android.os.ParcelFileDescriptor score = loadedScore == null ? null
                    : getContentResolver().openFileDescriptor(Uri.parse(loadedScore), "r")) {
                if (loadedScore != null && score == null) throw new IOException("Missing prepared score");
                if (engine.startParallel(score == null ? -1 : score.getFd(), speed) < 0)
                    throw new IllegalStateException("Parallel graph unavailable");
                parallelActive = true;
            }
            int[] handles = engine.configurePipeline(chain.types.toArray(new String[0]), chain.parameters.toArray(new float[0][]),
                    chain.layouts, chain.pluginIds, chain.descriptor, chain.parameterBytes.toArray(new byte[0][]), chain.flags, 1);
            for (int i = 0; i < handles.length; i++) {
                parallelInstances.put(chain.ids.get(i), handles[i]);
                parallelTypes.put(chain.ids.get(i), chain.types.get(i));
            }
            parallelAssets = new AssetTransfers(this, 1);
            parallelRefs = refs;
            parallelAssets.select(refs, parallelInstances, parallelTypes, engine, parallelInstances.keySet(), true);
            scheduleSampleStreams();
            parallelMustProcess = packer.mustProcessPipeline(value.getJSONArray("plugins"), masterBypass);
            preparingBlindAssets = value.getBoolean("prepareAssets");
            updateBlindTestPower();
            if (!running && (preparingBlindAssets || (autoSuspended && parallelMustProcess))) startAudio(fromVisibleUi);
            return object("assetDefinitions", AssetTransfers.definitions(refs), "staleAssets", stale);
        } catch (Exception error) {
            stopBlindTest(false);
            throw error;
        }
    }

    private void requireBlindTest() {
        if (!parallelActive) throw new IllegalStateException("No parallel graph");
    }

    private int assetBranch(JSONObject args) throws Exception {
        int branch = args.has("branch") ? args.getInt("branch") : 0;
        if (branch == 1) requireBlindTest();
        else if (branch != 0) throw new IllegalArgumentException("Invalid asset branch");
        return branch;
    }

    private JSONObject alignBlindTest(JSONObject args) throws Exception {
        observeSampleStreams(0);
        observeSampleStreams(1);
        if (!assets.readyForTest(args.getJSONObject("primary"), engine, sampleStreams)
                || !parallelAssets.readyForTest(args.getJSONObject("secondary"), engine, parallelSampleStreams))
            return object("ready", false);
        double[] a = engine.readPipelineStats(0), b = engine.readPipelineStats(1);
        int latencyA = (int) a[1], latencyB = (int) b[1], target = Math.max(latencyA, latencyB);
        if (engine.setOutputDelay(0, target - latencyA) < 0 || engine.setOutputDelay(1, target - latencyB) < 0)
            throw new IllegalStateException("Delay exceeds output capacity");
        int delayA = (int) a[2], delayB = (int) b[2];
        parallelReady = latencyA + delayA == target && latencyB + delayB == target;
        if (parallelReady && preparingBlindAssets) {
            preparingBlindAssets = false;
            updateBlindTestPower();
        }
        return object("ready", parallelReady,
                "latency", new JSONArray().put(latencyA).put(latencyB), "appliedDelay", new JSONArray().put(delayA).put(delayB));
    }

    private void stopBlindTest(boolean invalidate) {
        if (!parallelActive) return;
        engine.stopParallel();
        engine.setOutputDelay(0, 0);
        engine.fadeOutput(0, 1, .05);
        parallelActive = false;
        parallelReady = false;
        if (parallelAssets != null) parallelAssets.discardPending();
        parallelAssets = null;
        parallelRefs = null;
        parallelSampleStreams.clear();
        preparingBlindAssets = false;
        parallelMustProcess = false;
        parallelInstances.clear();
        parallelTypes.clear();
        updateBlindTestPower();
        if (invalidate) send("dbt-invalidated", new JSONObject());
    }

    private void updateBlindTestPower() {
        temporalMustProcess = primaryMustProcess || parallelMustProcess || preparingBlindAssets;
        engine.setPowerSettings((float) Math.pow(10, silenceThresholdDb / 20), 60,
                temporalMustProcess || !previews.isEmpty() || powerMode.equals("continuous"));
        updateForeground();
    }

    private void applyPipelineRuntime(JSONObject requested, boolean replacePending) throws Exception {
        if (measurement != null && measurement.usesPipeline() && measurement.isRunning()) endMeasurement();
        if (!slot.equals(requested.optString("slot", slot)) || masterBypass != requested.optBoolean("masterBypass", false))
            stopBlindTest(true);
        int rate = engine.getSampleRate();
        if (requested.optInt("sampleRate", rate) != rate ||
                requested.optInt("channelCount", engine.getChannelCount()) != engine.getChannelCount()) {
            // The engine never runs a chain packed for another rate. The record is kept for the UI to
            // pack again, and the engine stays empty and stopped until that chain arrives.
            if (pipelineRequest != null) {
                if (!visible) throw new HostError("visible-start-required", "Open EffeTune to use this effect chain.");
                boolean resume = running || autoSuspended || resumeOutput, wasPlaying = filePlaying() || resumeOutput && resumePlayback;
                int input = playerInput();
                stopAudio();
                applyPipelineRuntime(packer.prepareChain(new JSONArray(), masterBypass, slot).put("assetRefs", new JSONObject()), true);
                setPlayerInput(input); resumeOutput = resume; resumePlayback = wasPlaying;
            }
            pipeline = new JSONArray(requested.getJSONArray("plugins").toString()); pipelineRequest = null;
            masterBypass = requested.optBoolean("masterBypass", false); engine.setMasterBypass(masterBypass);
            slot = requested.optString("slot", slot);
            return;
        }
        JSONObject value = new JSONObject(requested.toString());
        JSONArray records = value.getJSONArray("plugins");
        JSONObject assetRefs = value.getJSONObject("assetRefs");
        // Preparation controls belong to the resident version until its replacement commits.
        applyAssetParameters(value, assets.preparationParameters(assetRefs));
        PackedChain chain = parsePackedChain(value);
        ArrayList<String> ids = chain.ids, types = chain.types;
        ArrayList<float[]> parameters = chain.parameters;
        ArrayList<byte[]> parameterBytes = chain.parameterBytes;
        int[] layouts = chain.layouts;
        boolean sameGraph = pipelineRequest != null && value.getString("descriptor").equals(pipelineRequest.optString("descriptor"))
                && records.length() == pipeline.length();
        for (int i = 0; sameGraph && i < records.length(); i++) {
            JSONObject old = pipeline.getJSONObject(i), next = records.getJSONObject(i);
            sameGraph = old.getString("type").equals(next.getString("type")) && old.getInt("id") == next.getInt("id")
                    && old.optLong("layoutHash") == next.optLong("layoutHash")
                    && old.optBoolean("skip") == next.optBoolean("skip") && old.optBoolean("displayOnly") == next.optBoolean("displayOnly");
        }
        if (!slot.equals(value.optString("slot", slot))) previews.clear();
        HashSet<String> created = new HashSet<>();
        if (sameGraph) {
            for (int i = 0; i < ids.size(); i++) {
                String id = ids.get(i); JSONObject held = previews.get(id);
                JSONObject next = held == null ? null : previewRecord(records, id);
                if (held != null && (next == null || !next.optBoolean("enabled", true) || !assetRefs.has(next.getString("type") + ":" + id + ":0"))) {
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
            for (int i = 0; i < ids.size(); i++) {
                String id = ids.get(i);
                if (!types.get(i).equals(instanceTypes.get(id))) created.add(id);
            }
            int[] handles;
            try {
                handles = engine.configurePipeline(types.toArray(new String[0]), parameters.toArray(new float[0][]), layouts, chain.pluginIds, chain.descriptor, parameterBytes.toArray(new byte[0][]), chain.flags);
            } catch (RuntimeException error) {
                // A failed rebuild leaves the native graph partly replaced: build all of it next time.
                pipelineRequest = null; instances.clear(); instanceTypes.clear();
                throw error;
            }
            if (handles == null || handles.length != types.size()) throw new HostError("pipeline-invalid", "The effect pipeline could not be applied.");
            instances.clear(); instanceEpoch++; runtimeEvents.clear();
            instanceTypes.clear(); assets.discardPending();
            for (int i = 0; i < handles.length; i++) { instances.put(ids.get(i), handles[i]); instanceTypes.put(ids.get(i), types.get(i)); }
        }
        boolean refreshParameters = assets.select(assetRefs, instances, instanceTypes, engine, created, replacePending);
        restoreSamplerControls();
        value.put("assetRefs", assets.snapshot());
        if (refreshParameters) {
            applyPipelineRuntime(requested, false);
            return;
        }
        masterBypass = value.optBoolean("masterBypass", false);
        primaryMustProcess = packer.mustProcessPipeline(records, masterBypass);
        engine.setMasterBypass(masterBypass);
        pipeline = new JSONArray(records.toString());
        pipelineRequest = new JSONObject(value.toString());
        updateBlindTestPower();
        slot = value.optString("slot", slot);
        if (resumeOutput && visible) resumeStoppedOutput();
        else if (resumeOutput) resumeWhenVisible = true;
        else if (autoSuspended && visible) {
            // The edit is already applied: an output that cannot wake must not discard it.
            try { startAudio(true); }
            catch (HostError error) { send("error", object("code", error.code, "message", error.getMessage())); }
        }
    }

    private void applyAssetParameters(JSONObject value, JSONObject refs) throws Exception {
        JSONArray records = value.getJSONArray("plugins");
        boolean changed = false;
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            String prefix = record.getString("type") + ":" + record.getInt("id") + ":";
            java.util.Iterator<String> keys = refs.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (key.startsWith(prefix)) changed |= mergeAssetParameters(record, refs.getJSONObject(key).optJSONObject("externalAssetParameters"));
            }
        }
        if (changed) value.put("descriptor", packer.prepareRecords(records, value.optBoolean("masterBypass", false), value.optString("slot", slot)).getString("descriptor"));
    }

    private boolean mergeAssetParameters(JSONObject record, JSONObject parameters) throws Exception {
        if (parameters == null || parameters.length() == 0) return false;
        JSONObject current = record.getJSONObject("parameters");
        java.util.Iterator<String> keys = parameters.keys();
        boolean changed = false;
        while (keys.hasNext()) {
            String key = keys.next();
            Object value = parameters.get(key);
            if (current.has(key) && java.util.Objects.equals(current.opt(key), value)) continue;
            current.put(key, value);
            changed = true;
        }
        if (changed) packer.packRecord(record);
        return changed;
    }

    private JSONObject inactiveSlotAsset(String command, JSONObject args) throws Exception {
        String name = args.getString("inactiveSlot");
        JSONObject chain = slots.get(name);
        if (name.equals(slot) || chain == null) throw new HostError("revision-conflict", "The effect chain changed.");
        JSONArray records = chain.getJSONArray("plugins");
        int id = args.getInt("pluginId");
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            if (record.getInt("id") != id) continue;
            String type = record.getString("type");
            JSONObject result = assets.command(command, args, -1, type, name, engine);
            String state = result.getString("state");
            if (state.equals("stored") || state.equals("empty")) {
                JSONObject ref = result.optJSONObject("reference");
                JSONObject cleared = ref == null ? AssetTransfers.assetParameters(args.optJSONObject("externalAssetParameters")) : null;
                slots.put(name, withSlotAsset(chain, id, args.getInt("slot"), ref, cleared));
                persistSlots();
                collectAssets();
                send("snapshot", snapshot());
                result.remove("reference");
            }
            return result;
        }
        throw new HostError("stale-pipeline", "The effect changed.");
    }

    private JSONObject withSlotAsset(JSONObject chain, int id, int assetSlot, JSONObject ref, JSONObject clearedParameters) throws Exception {
        JSONObject next = new JSONObject(chain.toString());
        JSONArray records = next.getJSONArray("plugins");
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            if (record.getInt("id") != id) continue;
            String key = record.getString("type") + ":" + id + ":" + assetSlot;
            JSONObject refs = next.getJSONObject("assetRefs");
            if (ref == null) refs.remove(key); else refs.put(key, ref);
            if (mergeAssetParameters(record, ref == null ? clearedParameters : ref.optJSONObject("externalAssetParameters")))
                next.put("descriptor", packer.prepareRecords(records, next.optBoolean("masterBypass"), next.getString("slot")).getString("descriptor"));
            return next;
        }
        throw new HostError("stale-pipeline", "The effect changed.");
    }

    private void storeSelectedAsset(int pluginId, int assetSlot, JSONObject ref, JSONObject clearedParameters,
                                    boolean standaloneEdit) throws Exception {
        JSONObject previous = slots.get(slot);
        if (previous == null) return;
        JSONObject next = withSlotAsset(previous, pluginId, assetSlot, ref, clearedParameters);
        applyPipelineRuntime(next, false);
        // The selected file belongs to the edit even while DSP prepares it. A subsequent
        // copy or Undo can already retain this version. Readiness changes only the runtime.
        boolean edited = standaloneEdit && !sameHistoryState(previous, next);
        if (edited) recordPipelineEdit(pipelineHistory(), null);
        slots.put(slot, next);
        if (edited) persistPipelineEdit(); else persistSlots();
        collectAssets();
        if (edited) changed(); else send("snapshot", snapshot());
    }

    private void finishSelectedAsset(int id, int assetSlot, AssetTransfers.Notice notice, boolean rejected) throws Exception {
        if (rejected) {
            String key = instanceTypes.get(Integer.toString(id)) + ":" + id + ":" + assetSlot;
            if (!notice.historyEntry()) {
                JSONObject chain = slots.get(slot);
                JSONObject selected = chain == null ? null : chain.getJSONObject("assetRefs").optJSONObject(key);
                if (selected == null || !selected.optString("id").equals(notice.rejectedAssetId())) return;
                send("error", object("code", "asset-restore-failed"));
            }
            storeSelectedAsset(id, assetSlot, assets.snapshot().optJSONObject(key), null, false);
        } else if (notice.committed()) {
            applyPipelineRuntime(slots.get(slot), false);
            collectAssets();
            send("snapshot", snapshot());
        }
    }

    private void replacePipeline(JSONObject value) throws Exception {
        replacePipeline(value, null);
    }

    private boolean replacePipeline(JSONObject value, String operationToken) throws Exception {
        String nextSlot = value.optString("slot", slot);
        if (!nextSlot.equals("A") && !nextSlot.equals("B")) throw new IllegalArgumentException("Invalid pipeline slot");
        PipelineHistory previous = pipelineHistory();
        if (!applyPipeline(value)) return false;
        // Packing the current chain again for this rate is not an edit.
        int rate = engine.getSampleRate();
        if (!nextSlot.equals(previous.selected().optString("slot")) ||
                previous.selected().optInt("sampleRate", rate) == rate && !sameHistoryState(previous.selected(), slots.get(slot)))
            recordPipelineEdit(previous, operationToken);
        collectAssets();
        return true;
    }

    private PipelineHistory pipelineHistory() throws Exception {
        JSONObject selected = slots.get(slot);
        if (selected == null) selected = packer.prepareChain(new JSONArray(), masterBypass, slot).put("assetRefs", new JSONObject());
        return new PipelineHistory(selected, slots.get(slot.equals("A") ? "B" : "A"));
    }

    private void recordPipelineEdit(PipelineHistory previous, String operationToken) {
        if (operationToken == null || !operationToken.equals(historyOperationToken) || undo.isEmpty()) {
            undo.add(previous);
            if (undo.size() > 100) undo.remove(0);
        }
        historyOperationToken = operationToken;
        redo.clear();
    }

    private boolean updatePipelineUI(JSONObject args) throws Exception {
        JSONObject previous = slots.get(slot);
        JSONArray states = args.getJSONArray("plugins");
        if (previous == null || !slot.equals(args.getString("slot")) || states.length() != pipeline.length())
            throw new HostError("revision-conflict", "The effect chain changed.");
        JSONObject next = new JSONObject(previous.toString());
        JSONArray records = next.getJSONArray("plugins");
        boolean edited = false;
        for (int i = 0; i < states.length(); i++) {
            JSONObject state = states.getJSONObject(i), record = records.getJSONObject(i);
            if (state.getInt("id") != record.getInt("id"))
                throw new HostError("revision-conflict", "The effect chain changed.");
            edited |= copyPluginUI(state, record.getJSONObject("parameters"));
        }
        if (!edited) return false;
        for (int i = 0; i < states.length(); i++)
            copyPluginUI(states.getJSONObject(i), pipeline.getJSONObject(i).getJSONObject("parameters"));
        recordPipelineEdit(pipelineHistory(), null);
        slots.put(slot, next);
        persistPipelineEdit();
        collectAssets();
        return true;
    }

    private static boolean copyPluginUI(JSONObject state, JSONObject parameters) throws Exception {
        boolean edited = false;
        for (String key : new String[]{"_uiCollapsed", "_uiLocked"}) {
            boolean on = state.optBoolean(key);
            if (parameters.optBoolean(key) == on) continue;
            if (on) parameters.put(key, true); else parameters.remove(key);
            edited = true;
        }
        return edited;
    }

    // As on the Web, master bypass is session state: history and A/B slots record only the chains.
    private JSONObject withCurrentBypass(JSONObject state) throws Exception {
        return new JSONObject(state.toString()).put("masterBypass", masterBypass);
    }

    private static boolean sameHistoryState(JSONObject a, JSONObject b) {
        for (String key : new String[]{"slot", "descriptor", "plugins", "assetRefs"}) {
            if (!String.valueOf(a.opt(key)).equals(String.valueOf(b.opt(key)))) return false;
        }
        return true;
    }

    private void moveHistory(ArrayList<PipelineHistory> source, ArrayList<PipelineHistory> destination) throws Exception {
        if (source.isEmpty()) return;
        PipelineHistory target = source.get(source.size() - 1);
        PipelineHistory previous = pipelineHistory();
        installPipeline(new JSONObject(target.selected().toString()).put("masterBypass", false));
        String other = slot.equals("A") ? "B" : "A";
        if (target.other() == null) slots.remove(other); else slots.put(other, target.other());
        persistPipelineEdit();
        source.remove(source.size() - 1); destination.add(previous);
        historyOperationToken = null;
        collectAssets();
    }

    private HashSet<JSONObject> retainedPipelineStates() {
        HashSet<JSONObject> states = new HashSet<>(slots.values());
        for (var history : Arrays.asList(undo, redo)) for (PipelineHistory entry : history) {
            states.add(entry.selected());
            if (entry.other() != null) states.add(entry.other());
        }
        return states;
    }
    private void collectAssets() throws Exception { assets.collect(retainedPipelineStates()); }

    private void requireMainOutput() throws HostError {
        if (featurePage) throw new HostError("visible-start-required", "Return to EffeTune to start audio.");
    }

    private void startAudio(boolean userVisible) throws HostError {
        requireMainOutput();
        startOutput(userVisible, false);
    }

    private void startOutput(boolean userVisible, boolean startingPlayback) throws HostError {
        boolean metering = meterChannel >= 0;
        reconcileOutput();
        if (metering && meterChannel < 0) throw outputFormatError();
        if (running) return;
        if (!userVisible && !visible) throw new HostError("visible-start-required", "Open EffeTune to start audio.");
        // The service must qualify for audio focus before starting its output.
        updateForeground(true, userVisible);
        if (audioManager.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            focusHeld = false;
            if (!featurePage) {
                outputStarted = true;
                outputStopReason = "audio-focus-denied";
                changed();
            } else updateForeground();
            throw new HostError("audio-focus-denied", "Another app is using audio. Try again when it finishes.");
        }
        focusHeld = true; resumeEngineOnFocus = false;
        focusGain = 1; engine.setGain(focusGain);
        if (autoSuspended) engine.prepareResume();
        if (metering) {
            openMeterStreams();
        } else if (engine.start() < 0) {
            focusHeld = false;
            audioManager.abandonAudioFocusRequest(focus); updateForeground();
            if (engine.getChannelCount() > 2 && outputWidth(preferredOutputDevice, 2) == 2) {
                setEngineFormat(engine.getSampleRate(), 2, preferredOutputDevice, latencyMode);
                remoteRepack = true;
                send("pipeline-changed", snapshot());
                throw outputFormatError();
            }
            throw new HostError("audio-unavailable", "The audio device is unavailable. Reconnect it and try again.");
        }
        engine.setPowerSettings((float) Math.pow(10, silenceThresholdDb / 20), 60, temporalMustProcess || !previews.isEmpty() || powerMode.equals("continuous"));
        running = true; outputStarted = true; resumeOutput = false; dismissWhenIdle = false;
        if (!featurePage) {
            outputStopReason = null;
            networkOutput.setOutputHandedOff(false, engine);
            scheduleSampleStreams();
        }
        reconcileInputOwnership(measurement.isRunning());
        autoSuspended = false; powerState = "ACTIVE"; lastPowerSequence = -1;
        updateRemoteLifetime();
        if (!startingPlayback) updateForeground();
    }

    private void setInput(int device, boolean userVisible) throws HostError {
        if (device >= 0) checkMicrophoneAccess(userVisible);
        if (device != inputDevice) measurement.invalidate(engine);
        int previous = inputDevice;
        inputDevice = device;
        try {
            if (device >= 0) startOutput(userVisible, false);
            reconcileInputOwnership(measurement.isRunning());
        } catch (HostError error) { inputDevice = previous; throw error; }
    }

    @SuppressWarnings("deprecation")
    private void checkMicrophoneAccess(boolean userVisible) throws HostError {
        if (!userVisible || !visible)
            throw new HostError("permission-required", "Open EffeTune to allow microphone access.");
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            throw new HostError("permission-denied", "Allow microphone access in Android settings.");
        AppOpsManager appOps = getSystemService(AppOpsManager.class);
        int mode = Build.VERSION.SDK_INT >= 36
                ? appOps.checkOpRawNoThrow(AppOpsManager.OPSTR_RECORD_AUDIO, getApplicationInfo().uid, getPackageName(), getAttributionTag())
                : appOps.unsafeCheckOpRawNoThrow(AppOpsManager.OPSTR_RECORD_AUDIO, getApplicationInfo().uid, getPackageName());
        if (mode == AppOpsManager.MODE_IGNORED || mode == AppOpsManager.MODE_ERRORED)
            throw new HostError("permission-denied", "Allow microphone access in Android settings.");
    }

    // Device selections persist by what identifies the hardware, because Android reassigns ids on reconnect.
    private static String deviceKey(AudioDeviceInfo device) { return device.getType() + "\n" + device.getProductName() + "\n" + device.getAddress(); }
    private void saveDevice(String name, int id, int flag) {
        String value = String.valueOf(id);
        if (id > 0) for (AudioDeviceInfo device : audioManager.getDevices(flag)) if (device.getId() == id) value = deviceKey(device);
        getSharedPreferences("audio", MODE_PRIVATE).edit().putString(name, value).apply();
    }
    // A saved device that is not connected falls back to the given id (the system default or no input).
    private int savedDevice(String name, int flag, int absent) {
        String value = getSharedPreferences("audio", MODE_PRIVATE).getString(name, null);
        if (value == null) return absent;
        if (value.equals("-1") || value.equals("0")) return Integer.parseInt(value);
        for (AudioDeviceInfo device : audioManager.getDevices(flag)) if (deviceKey(device).equals(value)) return device.getId();
        return absent;
    }

    // The input's buffer capacity follows the output, so an acquired input reopens with it. Reopening in place keeps
    // live input while EffeTune is hidden; an input that cannot reopen is released for the next reconcile.
    private boolean reopenOutput(int device, int latency) {
        if (meterChannel >= 0) endMeasurementInput();
        measurement.invalidate(engine);
        if (engine.setOutput(device, latency) < 0) return false;
        preferredOutputDevice = device;
        if (acquiredInputDevice >= 0 && engine.setInputDevice(acquiredInputDevice) < 0) {
            engine.setInputDevice(-1); acquiredInputDevice = -1; microphone = false;
        }
        return true;
    }

    // Follows the saved output as it connects and disconnects; without it the system default plays.
    private void restoreOutputDevice() {
        if (engine == null) return;
        int device = savedDevice("outputDevice", AudioManager.GET_DEVICES_OUTPUTS, 0);
        int width = outputWidth(device, savedOutputWidth());
        if (meterChannel >= 0) {
            outputRestorePending = device != preferredOutputDevice || width != engine.getChannelCount();
            return;
        }
        outputRestorePending = false;
        if (width != engine.getChannelCount()) {
            try {
                setEngineFormat(engine.getSampleRate(), width, device, latencyMode);
                preferredOutputDevice = device;
                remoteRepack = true;
                send("pipeline-changed", snapshot());
            } catch (HostError error) { send("error", object("code", error.code, "message", error.getMessage())); }
            return;
        }
        if (device != preferredOutputDevice && !reopenOutput(device, latencyMode)) Log.w("EffeTuneAudio", "Cannot restore the saved audio output");
    }

    private int savedOutputWidth() {
        return getSharedPreferences("audio", MODE_PRIVATE).getInt("channelCount", 2);
    }

    // The measurement page owns its input like the desktop measurement device: the input only
    // feeds the level meter and capture, and releasing it restores the player's input.
    private void setMeasurementInput(int device, int channel, int rate, int output, int width, boolean userVisible) throws HostError {
        if (device < 0) { endMeasurementInput(); return; }
        if (channel < 0 || channel > 2) throw new IllegalArgumentException("Invalid input channel");
        checkMicrophoneAccess(userVisible);
        if (!SAMPLE_RATES.contains(rate) || !measurementDeviceSupports(device, AudioManager.GET_DEVICES_INPUTS, rate)
                || !measurementDeviceSupports(output, AudioManager.GET_DEVICES_OUTPUTS, rate))
            throw measurementRateUnavailable();
        if (width != outputWidth(output, width)) throw outputFormatError();
        if (meterChannel >= 0) endMeasurementInput();
        if (playing) pause(false);
        meterSavedInput = inputDevice;
        inputDevice = device;
        meterRate = rate;
        meterOutputDevice = output;
        meterWidth = width;
        meterChannel = channel; engine.setMeasurementMeter(channel);
        try {
            outputRecoveryAttempted = false;
            if (running) openMeterStreams();
            else startOutput(userVisible, false);
        } catch (HostError error) { endMeasurementInput(); throw error; }
    }

    private void openMeterStreams() throws HostError {
        if ((!visible && !(foreground && foregroundMicrophone))
                || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            throw new HostError("permission-required", "Open EffeTune to allow microphone access.");
        microphone = true;
        updateForeground();
        if (engine.openMeasurementStreams(meterRate, inputDevice, meterOutputDevice, meterWidth) < 0)
            throw outputFormatError();
        verifyMeterStreams();
        acquiredInputDevice = inputDevice;
    }

    private void verifyMeterStreams() throws HostError {
        int input = engine.measurementInputDevice(), output = engine.getOutputDeviceId();
        if (inputDevice > 0 && inputDevice != input)
            throw new HostError("input-unavailable", "The selected audio input is unavailable.");
        if ((meterOutputDevice > 0 && meterOutputDevice != output) || meterWidth != engine.measurementChannels())
            throw outputFormatError();
        if (meterRate != engine.measurementRate()
                || !measurementDeviceSupports(input, AudioManager.GET_DEVICES_INPUTS, meterRate)
                || !measurementDeviceSupports(output, AudioManager.GET_DEVICES_OUTPUTS, meterRate))
            throw measurementRateUnavailable();
    }

    private boolean recoverSelectedOutput() {
        if (meterChannel < 0) return engine.start() >= 0;
        try { openMeterStreams(); return true; }
        catch (HostError error) {
            Log.w("EffeTuneAudio", "Cannot restore measurement devices", error);
            return false;
        }
    }

    private void measurementDevicesLost() {
        endMeasurementInput();
        send("measurement-invalidated", object("reason", "devices-unavailable"));
    }

    private static HostError measurementRateUnavailable() {
        return new HostError("measurement-rate-unavailable", "Choose another sampling frequency for these audio devices.");
    }

    private boolean measurementDeviceSupports(int id, int direction, int rate) {
        for (AudioDeviceInfo device : audioManager.getDevices(direction)) {
            if (device.getId() != id) continue;
            int[] rates = device.getSampleRates();
            if (rates.length == 0) return true;
            for (int supported : rates) if (rate == supported) return true;
            return false;
        }
        return true;
    }

    private void endMeasurementInput() {
        endMeasurement();
        if (meterChannel < 0) return;
        // A meter opened on the feature page owns the output clock as well as its input.
        if ((featurePage && running) || (!running && (resumeEngineOnFocus || focusHeld))) stopAudio(false);
        if (engine.closeMeasurementStreams(running) < 0)
            send("error", object("code", "audio-unavailable", "message", "Reconnect the audio device and try playback again."));
        acquiredInputDevice = -1; microphone = false;
        meterChannel = -1; inputDevice = meterSavedInput;
        engine.setMeasurementMeter(-1);
        refreshInputOwnership();
        updateForeground();
        if (outputRestorePending) control.post(() -> {
            if (engine != null && outputRestorePending) { restoreOutputDevice(); changed(); }
        });
    }

    // A sweep or test signal that cannot continue stops, and the output returns to the playback gain.
    private void endMeasurement() {
        measurement.invalidate(engine); recordingMonitor.disarm(); engine.setGain(focusGain);
    }

    // While the measurement page meters, inputDevice is its microphone and the player's selection waits.
    private int playerInput() { return meterChannel >= 0 ? meterSavedInput : inputDevice; }
    private void setPlayerInput(int device) { if (meterChannel >= 0) meterSavedInput = device; else inputDevice = device; }

    private void reconcileInputOwnership(boolean measuring) throws HostError {
        // A retained player source owns the route through pause/stop, like the Web player.
        int desired = running && focusHeld && (measuring || meterChannel >= 0 || (source == null && liveInput == null) || useInputWithPlayer) ? inputDevice : -1;
        if (desired == acquiredInputDevice) return;
        // A microphone foreground service can reopen its input after a transient focus loss.
        boolean resumingMicrophone = resumeEngineOnFocus && foreground && foregroundMicrophone;
        if (desired >= 0 && ((!visible && !resumingMicrophone)
                || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)) return;
        boolean previous = microphone;
        if (desired >= 0) { microphone = true; updateForeground(); }
        if (engine.setInputDevice(desired) < 0) {
            microphone = previous;
            updateForeground();
            throw new HostError("input-unavailable", "The selected audio input is unavailable.");
        }
        acquiredInputDevice = desired; microphone = desired >= 0;
        if (desired < 0) updateForeground();
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
            String type = record.getString("type");
            if (id.equals(String.valueOf(record.getInt("id"))) && (type.equals("SFZNotePlayerPlugin") || type.equals("SoundFontPlayerPlugin"))) return record;
        }
        return null;
    }
    private float[] previewValues(JSONObject current, JSONObject note) throws Exception {
        JSONObject record = new JSONObject(current.toString()), parameters = record.getJSONObject("parameters");
        if (note == null) parameters.put("pm", -1);
        else for (java.util.Iterator<String> keys = note.keys(); keys.hasNext(); ) { String key = keys.next(); parameters.put(key, note.get(key)); }
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
        String id = String.valueOf(args.getInt("pluginId")); int note = args.getInt("pm");
        JSONObject record = previewRecord(id);
        if (record == null) throw new HostError("stale-pipeline", "The instrument changed. Try again.");
        String type = record.getString("type");
        // SoundFont Player previews any MIDI note on a chosen channel; SFZ Note Player keeps its 88-key range and velocity.
        boolean soundFont = type.equals("SoundFontPlayerPlugin");
        int detail = soundFont ? args.optInt("pc", 0) : args.optInt("pv", 100);
        if (soundFont ? note < -1 || note > 127 || detail < 0 || detail > 15
                : (note != -1 && (note < 21 || note > 108)) || detail < 1 || detail > 127) throw new IllegalArgumentException("Invalid preview note");
        if (note >= 0) {
            if (!userVisible || !visible) throw new HostError("visible-start-required", "Open EffeTune to preview an instrument.");
            if (!record.optBoolean("enabled", true) || !assets.snapshot().has(type + ":" + id + ":0")) throw new HostError("preview-unavailable", "Load an instrument and enable the effect first.");
            startAudio(true);
            JSONObject value = object("pm", note, soundFont ? "pc" : "pv", detail); applyPreview(id, value); previews.put(id, value);
        } else { applyPreview(id, null); previews.remove(id); }
        engine.setPowerSettings((float) Math.pow(10, silenceThresholdDb / 20), 60, temporalMustProcess || !previews.isEmpty() || powerMode.equals("continuous"));
        updateForeground();
    }
    private void clearPreviews() {
        for (String id : new ArrayList<>(previews.keySet())) try { applyPreview(id, null); } catch (Exception error) { Log.w("EffeTune", "Cannot release instrument preview", error); }
        previews.clear();
        if (engine != null) engine.setPowerSettings((float) Math.pow(10, silenceThresholdDb / 20), 60, temporalMustProcess || powerMode.equals("continuous"));
        if (engine != null) engine.setFrequencyPreview(0, false);
    }
    /** Decodes a SoundFont Player mixer action exactly as the desktop host does and returns the applied frame. */
    private long mixerAction(JSONObject args) throws Exception {
        String id = String.valueOf(args.getInt("pluginId")); JSONObject action = args.getJSONObject("action");
        JSONObject record = previewRecord(id); Integer instance = instances.get(id);
        if (record == null || instance == null || !record.getString("type").equals("SoundFontPlayerPlugin")) throw new HostError("stale-pipeline", "The instrument changed. Try again.");
        int channel = action.optInt("channel", 16), mix = -1; String kind = action.optString("type");
        int[] messages = new int[0];
        if (channel < 0 || channel > 15) throw new IllegalArgumentException("Invalid mixer channel");
        if (kind.equals("mute") || kind.equals("solo")) {
            mix = (kind.equals("solo") ? 2 : 0) + (action.getBoolean("value") ? 1 : 0);
        } else if (kind.equals("program")) {
            int bank = action.getInt("bank"), program = action.getInt("program"); boolean xg = action.optBoolean("xg", false);
            if (bank < 0 || bank > 128 || program < 0 || program > 127) throw new IllegalArgumentException("Invalid program change");
            messages = bank < 128
                    ? new int[] { 0xb0 | channel | (xg ? 0 : bank) << 16, 0xb0 | channel | 32 << 8 | (xg ? bank : 0) << 16, 0xc0 | channel | program << 8 }
                    : new int[] { 0xc0 | channel | program << 8 };
        } else if (kind.equals("control")) {
            int controller = action.getInt("controller"), value = action.getInt("value");
            if ((controller != 7 && controller != 10 && controller != 11 && controller != 91 && controller != 93) || value < 0 || value > 127) throw new IllegalArgumentException("Invalid controller change");
            messages = new int[] { 0xb0 | channel | controller << 8 | value << 16 };
        } else throw new IllegalArgumentException("Invalid mixer action");
        long frame = engine.soundFontMixerAction(instance, channel, mix, messages);
        if (frame < 0) throw new HostError("mixer-unavailable", "The SoundFont is not ready yet. Wait a moment, then try again.");
        return frame;
    }

    private void setSource(JSONObject value) throws Exception {
        queue.abort(); stagedQueueSettings = null; queueTransaction = null;
        validateSource(value);
        nextTrack = null;
        if (!featurePage) {
            endMeasurementInput();
            stopCurrentTrack();
            if (loadedScore != null) releaseScore();
        }
        source = new JSONObject(value.toString());
        restoredUnloaded = featurePage;
        playbackStopped = false;
        sourceReady = false;
        durationUs = 0;
        long start = (long) (value.optDouble("position", 0) * 1_000_000);
        if (featurePage) {
            positionUs = Math.max(0, start);
            sourceExhausted = false;
            saveQueue();
            publishMetadata();
            return;
        }
        try { seek(start); }
        catch (HostError error) {
            // URI resolution can fail before seek replaces the previous decoder.
            decoder.cancel(); generation = engine.beginSource(); decoderEnded = false;
            positionUs = Math.max(0, start); sourceExhausted = false;
            throw error;
        }
        loadGeneration = generation;
        publishMetadata();
    }

    private void publishMetadata() {
        if (source != metadataSource) {
            metadataSource = featurePage ? null : source;
            long requestedRevision = ++metadataRevision;
            metadataTitle = null; metadataArtist = null; metadataAlbum = null; metadataArtwork = null;
            cancelPlaybackMetadata();
            if (!destroyed && metadataSource != null && !source.has("scoreUri")) {
                JSONObject requested = source;
                CancellationSignal signal = new CancellationSignal();
                metadataCancellation = signal;
                metadataWorker.execute(() -> readPlaybackMetadata(requested, requestedRevision, signal));
            }
        }
        if (source == null) { playbackMetadata = null; session.setMetadata(null); return; }
        JSONObject tags = source.optJSONObject("metadata");
        String title = tags == null ? "" : tags.optString("title", "");
        if (title.isEmpty()) title = metadataTitle == null || metadataTitle.isEmpty() ? source.optString("title", "EffeTune") : metadataTitle;
        MediaMetadata.Builder builder = new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title);
        String artist = tags == null ? "" : tags.optString("artist", "");
        String album = tags == null ? "" : tags.optString("album", "");
        if (artist.isEmpty() && metadataArtist != null) artist = metadataArtist;
        if (album.isEmpty() && metadataAlbum != null) album = metadataAlbum;
        if (!artist.isEmpty()) builder.putString(MediaMetadata.METADATA_KEY_ARTIST, artist);
        if (!album.isEmpty()) builder.putString(MediaMetadata.METADATA_KEY_ALBUM, album);
        if (metadataArtwork != null) builder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, metadataArtwork);
        if (durationUs > 0) builder.putLong(MediaMetadata.METADATA_KEY_DURATION, durationUs / 1000);
        playbackMetadata = builder.build();
        session.setMetadata(playbackMetadata);
    }

    private void cancelPlaybackMetadata() {
        metadataWorker.getQueue().clear();
        if (metadataCancellation != null) {
            CancellationSignal signal = metadataCancellation;
            metadataCancellation = null;
            CompletableFuture.runAsync(signal::cancel);
        }
    }

    private void readPlaybackMetadata(JSONObject requested, long requestedRevision, CancellationSignal signal) {
        String title = null, artist = null, album = null;
        Bitmap artwork = null;
        try (MediaMetadataRetriever retriever = new MediaMetadataRetriever()) {
            Uri uri = SubsonicHost.playbackUri(this, requested);
            if ("content".equals(uri.getScheme())) {
                try (AssetFileDescriptor asset = getContentResolver().openAssetFileDescriptor(uri, "r", signal)) {
                    if (asset == null) throw new IOException("Missing metadata source");
                    signal.throwIfCanceled();
                    long length = asset.getDeclaredLength();
                    if (length < 0) retriever.setDataSource(asset.getFileDescriptor());
                    else retriever.setDataSource(asset.getFileDescriptor(), asset.getStartOffset(), length);
                }
            } else {
                HashMap<String, String> headers = new HashMap<>();
                JSONObject values = requested.optJSONObject("headers");
                if (values != null) {
                    java.util.Iterator<String> keys = values.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        if (key.equalsIgnoreCase("Authorization") || key.equalsIgnoreCase("User-Agent")) headers.put(key, values.getString(key));
                    }
                }
                retriever.setDataSource(uri.toString(), headers);
            }
            title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            album = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
            byte[] picture = retriever.getEmbeddedPicture();
            if (picture != null) {
                BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(picture, 0, picture.length, options);
                options.inSampleSize = 1;
                while (options.outWidth / options.inSampleSize > 512 || options.outHeight / options.inSampleSize > 512)
                    options.inSampleSize *= 2;
                options.inJustDecodeBounds = false;
                artwork = BitmapFactory.decodeByteArray(picture, 0, picture.length, options);
            }
        } catch (OperationCanceledException cancelled) { return; }
        catch (Exception error) { Log.w("EffeTuneMetadata", "Cannot read track metadata", error); }
        String resultTitle = title, resultArtist = artist, resultAlbum = album;
        Bitmap resultArtwork = artwork;
        control.post(() -> {
            if (destroyed || source != requested || metadataRevision != requestedRevision) return;
            metadataTitle = resultTitle; metadataArtist = resultArtist; metadataAlbum = resultAlbum; metadataArtwork = resultArtwork;
            publishMetadata();
            if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q && notified) showNotification(false);
        });
    }

    private void validateSource(JSONObject value) throws Exception {
        String uri = value.getString("uri");
        String scheme = android.net.Uri.parse(uri).getScheme();
        if (value.has("scoreUri")) {
            Uri score = Uri.parse(value.getString("scoreUri"));
            if (!"content".equals(score.getScheme()) || !(getPackageName() + ".files").equals(score.getAuthority()))
                throw new HostError("invalid-source", "Select the score file again.");
        }
        if (!"content".equals(scheme) && !"https".equals(scheme) && !"http".equals(scheme)) throw new HostError("invalid-source", "Select an audio file or a network music source.");
    }

    private void setQueueMode(JSONObject value) throws Exception {
        String mode = value.optString("repeat", repeat);
        if (!mode.equals("off") && !mode.equals("all") && !mode.equals("one")) throw new HostError("invalid-repeat", "Choose a valid repeat mode.");
        boolean enabled = !mode.equals("one") && value.optBoolean("shuffle", shuffle);
        if (enabled && !shuffle) {
            shuffleOrder = new QueueShuffle(random.nextInt());
            shuffleOffset = 0;
        }
        repeat = mode; shuffle = enabled;
    }

    // The same bounded-memory permutation as ReversibleShufflePermutation in transport-shuffle.js.
    private static final class QueueShuffle {
        final int seed;
        final int[] keys = new int[6];

        QueueShuffle(int seed) {
            this.seed = seed;
            int key = seed;
            for (int i = 0; i < keys.length; i++) keys[i] = key = mix(key + 0x9e3779b9 + i);
        }

        private static int mix(int value) {
            value = (value ^ (value >>> 16)) * 0x7feb352d;
            value = (value ^ (value >>> 15)) * 0x846ca68b;
            return value ^ (value >>> 16);
        }

        int map(int index, int length, boolean inverse) {
            if (length <= 1) return index;
            int bits = (33 - Integer.numberOfLeadingZeros(length - 1)) / 2;
            int mask = (1 << bits) - 1;
            do {
                int left = index >>> bits, right = index & mask;
                for (int i = 0; i < keys.length; i++) {
                    if (inverse) {
                        int previous = right ^ (mix(left ^ keys[keys.length - 1 - i]) & mask);
                        right = left; left = previous;
                    } else {
                        int next = left ^ (mix(right ^ keys[i]) & mask);
                        left = right; right = next;
                    }
                }
                index = (left << bits) | right;
            } while (index < 0 || index >= length);
            return index;
        }
    }

    private void installQueueOrder(JSONObject settings, int selected) {
        queueRevision++;
        catalogQueue = settings.optBoolean("catalogQueue");
        if (!shuffle || selected < 0) return;
        shuffleOrder = new QueueShuffle(settings.optInt("shuffleSeed", random.nextInt()));
        int length = queue.length();
        int ordinal = Math.floorMod(settings.optInt("startOrdinal", selected), length);
        shuffleOffset = Math.floorMod(shuffleOrder.map(selected, length, true) - ordinal, length);
    }

    private int queueIndexAt(int ordinal) {
        if (shuffle && queue.hasExplicitOrder()) return queue.indexAtPlayOrdinal(ordinal);
        int length = queue.length();
        return shuffle ? shuffleOrder.map((int)(((long) ordinal + shuffleOffset) % length), length, false) : ordinal;
    }

    private int queueOrdinalOf(int index) {
        if (!shuffle || index < 0) return index;
        if (queue.hasExplicitOrder()) return queue.playOrdinalOf(index);
        return Math.floorMod(shuffleOrder.map(index, queue.length(), true) - shuffleOffset, queue.length());
    }

    private void insertQueue(JSONObject args) throws Exception {
        JSONArray items = args.getJSONArray("items");
        int index = args.getInt("index"), length = queue.length();
        if (index < 0 || index > length) throw new HostError("invalid-queue", "Choose a valid position in the playback queue.");
        for (int i = 0; i < items.length(); i++) validateSource(items.getJSONObject(i));
        if (items.length() == 0) return;
        boolean transport = args.optBoolean("transportOrder");
        int canonical = transport && index > 0 && index < length ? queueIndexAt(index - 1) + 1 : index;
        int ordinal = !shuffle ? -1 : transport || index == length ? index : queueOrdinalOf(index);
        queue.insert(canonical, ordinal, items, this::queueIndexAt);
        if (queueIndex >= canonical) queueIndex += items.length();
        queueRevision++;
        reconcileNextTrack();
        saveQueue();
    }

    private boolean restoreQueue(String operationId, boolean fromVisibleUi) throws Exception {
        JSONObject saved = queue.restore(operationId);
        if (saved == null) return false;
        clearCurrentTrack();
        queueIndex = saved.optInt("index", -1);
        repeat = saved.getString("repeat"); shuffle = saved.getBoolean("shuffle");
        catalogQueue = saved.getBoolean("catalogQueue");
        shuffleOrder = new QueueShuffle(saved.getInt("shuffleSeed"));
        shuffleOffset = saved.getInt("shuffleOffset");
        queueRevision++; queueFocus++;
        source = saved.optJSONObject("detachedSource");
        if (source == null && queueIndex >= 0) source = queue.getJSONObject(queueIndex);
        if (source != null) {
            positionUs = saved.getLong("positionUs");
            durationUs = saved.getLong("durationUs");
            playbackStopped = saved.getBoolean("stopped");
            restoredUnloaded = saved.getBoolean("unloaded");
            sourceExhausted = saved.getBoolean("sourceExhausted");
        }
        publishMetadata();
        saveQueue();
        if (source != null && saved.getBoolean("playing") && !featurePage) startPlayback(fromVisibleUi);
        return true;
    }

    private void advanceQueue(int direction, boolean ended, boolean userVisible) throws Exception {
        requireMainOutput();
        boolean restart = direction < 0 && !catalogQueue && queueIndex >= 0 && currentPosition() > 3_000_000;
        int index = restart ? queueIndex : nextQueueIndex(queueIndex, direction, ended, true);
        if (index < 0 && direction < 0) index = queueIndex;
        if (index < 0) {
            if (ended) endPlayback();
            return;
        }
        boolean wasPlaying = playing;
        if (!ended) queueFocus++;
        selectQueueEntry(index, wasPlaying);
        if (!wasPlaying && sourceReady) startPlayback(userVisible);
    }

    // Preloading may look across a repeat boundary, but only an actual move changes the order.
    private int nextQueueIndex(int from, int direction, boolean ended, boolean commit) {
        int length = queue.length();
        if (length == 0) return -1;
        if (ended && repeat.equals("one")) return from;
        int ordinal = queueOrdinalOf(from);
        int next = ordinal + direction;
        if (next >= 0 && next < length) return queueIndexAt(next);
        if (!repeat.equals("all")) return -1;
        int boundary = direction > 0 ? 0 : length - 1;
        if (!shuffle || length == 1) return boundary;
        QueueShuffle order = new QueueShuffle(shuffleOrder.seed + direction * 0x9e3779b9);
        int index = order.map(boundary, length, false);
        int offset = index == from ? 1 : 0;
        if (offset != 0) index = order.map((boundary + 1) % length, length, false);
        if (commit) {
            queue.clearOrder();
            shuffleOrder = order;
            shuffleOffset = offset;
            queueRevision++;
        }
        return index;
    }

    private void selectQueueEntry(int index, boolean resume) throws Exception {
        failedEntries.clear();
        if (!loadQueueEntry(index, queue.getJSONObject(index), resume)) skipFailedTrack(resume);
    }

    private boolean loadQueueEntry(int index, JSONObject entry, boolean resume) throws Exception {
        queueIndex = index;
        try {
            setSource(entry);
            if (resume) resumeCurrentTrack();
            return true;
        } catch (HostError error) {
            if (!isLoadError(error)) throw error;
            Log.w("EffeTuneDecode", "Cannot open queue entry", error);
            recordLoadFailure(entry);
            return false;
        }
    }

    private static boolean isLoadError(HostError error) {
        return "track-unavailable".equals(error.code) || "source-unavailable".equals(error.code);
    }

    private void recordLoadFailure(JSONObject entry) {
        if (entry != null && entry.has("queueEntryId")) failedEntries.add(entry.optInt("queueEntryId"));
    }

    private void reportSkippedTracks() {
        if (failedEntries.isEmpty()) return;
        if (catalogQueue) send("error", object("code", "track-unavailable", "count", failedEntries.size()));
        failedEntries.clear();
    }

    // All attempts retain the playback intent from before the first failed open.
    private void skipFailedTrack(boolean resume) {
        int length = queue.length();
        if (source != null && source.has("queueEntryId") && length > 1) {
            int index = nextQueueIndex(queueIndex, 1, false, true);
            try {
                for (int attempt = 0; attempt < length && index >= 0; attempt++) {
                    JSONObject entry = queue.getJSONObject(index);
                    if (!failedEntries.contains(entry.getInt("queueEntryId")) && loadQueueEntry(index, entry, resume)) return;
                    index = nextQueueIndex(index, 1, false, true);
                }
            } catch (Exception error) { Log.e("EffeTuneQueue", "Cannot advance the queue", error); }
        }
        stopCurrentTrack(); sourceReady = false; reportSkippedTracks();
        publishMetadata(); saveQueue();
    }

    private static final class NextTrack {
        NativeEngine owner; long generation; JSONObject source;
        // `boundary` is the rendered-frame count at which this track starts to play.
        long startUs, boundary, durationUs, endedFrames = -1;
        long failedFrames = -1;
    }

    private boolean nextTrackValid() { return nextTrack != null && nextTrack.owner == engine && nextTrack.generation == generation; }

    // The decoder wrote every frame of the current track; with gapless playback the next track follows in the same generation.
    private void sourceEnded(long frames) {
        if (frames > 0) reportSkippedTracks();
        if (!gapless || !chainNext(decodeOrigin + frames)) decoderEnded = true;
    }

    private boolean chainNext(long boundary) {
        int index = nextQueueIndex(queueIndex, 1, true, false);
        if (index < 0) return false;
        NextTrack next = new NextTrack();
        try {
            next.source = queue.getJSONObject(index); validateSource(next.source);
            if (next.source.has("scoreUri")) return false;
        } catch (Exception error) { return false; }
        next.owner = engine; next.generation = generation; next.boundary = boundary;
        next.startUs = (long) (next.source.optDouble("position", 0) * 1_000_000);
        nextTrack = next; decodeOrigin = boundary;
        try {
            startDecoder(next.source, SubsonicHost.playbackUri(this, next.source), next.startUs);
        } catch (HostError error) {
            Log.w("EffeTuneDecode", "Cannot open the next track", error);
            next.failedFrames = 0;
        }
        return true;
    }

    // At the boundary, wait for a rendered frame or a terminal decoder result.
    private boolean promoteReachedNextTrack() {
        if (!nextTrackValid()) return false;
        long rendered = engine.getRenderedFrames();
        if (rendered < nextTrack.boundary || (rendered == nextTrack.boundary &&
                nextTrack.failedFrames < 0 && nextTrack.endedFrames < 0)) return false;
        NextTrack next = nextTrack; nextTrack = null;
        int index = queue.indexOfId(next.source.optInt("queueEntryId", -1));
        if (index >= 0) {
            if (shuffle) nextQueueIndex(queueIndex, 1, true, true);
            queueIndex = index;
        }
        source = next.source; positionUs = next.startUs; renderStart = next.boundary; durationUs = next.durationUs; sourceExhausted = false;
        if (next.failedFrames == 0) {
            recordLoadFailure(source);
            skipFailedTrack(playing);
        } else {
            publishMetadata(); saveQueue();
            if (next.failedFrames > 0) stopFailedSource();
            else if (next.endedFrames >= 0) sourceEnded(next.endedFrames);
        }
        return true;
    }

    // Discards the next track's PCM by decoding the current track again from the playing position.
    private void withdrawNextTrack() throws HostError {
        if (!nextTrackValid()) return;
        nextTrack = null;
        long position = currentPosition();
        seek(durationUs > 0 && position > durationUs ? durationUs : position);
    }

    // After a queue edit the prepared next track stays only while it is still the track that follows.
    private void reconcileNextTrack() throws Exception {
        if (!nextTrackValid()) return;
        int index = nextQueueIndex(queueIndex, 1, true, false);
        JSONObject entry = index < 0 ? null : queue.getJSONObject(index);
        if (entry != null && sameTrack(entry, nextTrack.source) &&
                entry.optDouble("replayGainFactor", 1) == nextTrack.source.optDouble("replayGainFactor", 1)) nextTrack.source = entry;
        else withdrawNextTrack();
    }

    private JSONArray priorityGainEntries() throws Exception {
        JSONArray entries = new JSONArray();
        if (source != null && source.has("queueEntryId")) {
            entries.put(PlaybackQueueStore.gainEntry(source, source.getInt("queueEntryId")));
        }
        JSONObject next = nextTrackValid() ? nextTrack.source : null;
        if (next == null && queueIndex >= 0) {
            int index = nextQueueIndex(queueIndex, 1, true, false);
            if (index >= 0 && index != queueIndex) next = queue.getJSONObject(index);
        }
        if (next != null) entries.put(PlaybackQueueStore.gainEntry(next, next.getInt("queueEntryId")));
        return entries;
    }

    private void applyQueueGains(JSONArray items) throws Exception {
        queue.updateReplayGainFactors(items);
        for (int i = 0; i < items.length(); i++) {
            int id = items.getJSONObject(i).getInt("queueEntryId");
            boolean current = source != null && source.optInt("queueEntryId", -1) == id;
            boolean next = nextTrackValid() && nextTrack.source.optInt("queueEntryId", -1) == id;
            if (!current && !next) continue;
            int index = queue.indexOfId(id);
            if (index < 0) continue;
            JSONObject stored = queue.getJSONObject(index);
            if (current) source = stored;
            if (next) nextTrack.source = stored;
            // Once chained, the only producer is the next track, even before it is audible.
            if (next || !nextTrackValid()) decoder.setReplayGainFactor((float) stored.optDouble("replayGainFactor", 1));
        }
    }

    private static boolean sameTrack(JSONObject a, JSONObject b) {
        return a.optString("uri").equals(b.optString("uri")) && String.valueOf(a.opt("region")).equals(String.valueOf(b.opt("region")));
    }

    private void endPlayback() throws Exception {
        stopCurrentTrack(); sourceReady = false; sourceExhausted = true;
        if (loadedScore != null) releaseScore();
        decoder.cancel(); generation = engine.beginSource(); nextTrack = null;
        positionUs = 0;
        if (queue.length() > 0) {
            int first = queueIndexAt(0);
            if (first != queueIndex) {
                source = queue.getJSONObject(first);
                queueIndex = first;
                durationUs = 0;
                publishMetadata();
            }
        }
        playbackStopped = true;
        saveQueue();
        send("playback-ended", snapshot());
    }

    private void saveQueue() {
        if (queue == null) return;
        lastQueueSave = SystemClock.elapsedRealtime();
        queue.saveSettings(object("index", queueIndex, "repeat", repeat, "shuffle", shuffle,
                "catalogQueue", catalogQueue, "shuffleSeed", shuffleOrder.seed, "shuffleOffset", shuffleOffset, "stopped", playbackStopped,
                "speed", speed, "preservePitch", preservePitch, "volume", volume, "muted", muted,
                "positionEntryId", source == null ? -1 : source.optInt("queueEntryId", -1),
                "positionUs", currentPosition(), "durationUs", durationUs, "sourceExhausted", sourceExhausted));
    }

    private void checkpointPlaybackPosition() {
        if (!filePlaying() || source == null || !source.has("queueEntryId") ||
                SystemClock.elapsedRealtime() - lastQueueSave < 10_000) return;
        try { saveQueue(); }
        catch (RuntimeException error) { Log.w("EffeTuneQueue", "Playback position could not be saved", error); }
    }

    // The active table is replaced only after the surviving rows and their remapped state are ready.
    private JSONObject pruneStoredQueue(JSONObject saved) throws Exception {
        int length = queue.length();
        if (length == 0) return saved;
        HashSet<Uri> grants = new HashSet<>();
        for (UriPermission permission : getContentResolver().getPersistedUriPermissions()) {
            if (permission.isReadPermission()) grants.add(permission.getUri());
        }
        String importsAuthority = getPackageName() + ".files";
        BitSet retained = new BitSet(length);
        for (int i = 0; i < length; i++) {
            JSONObject item = queue.getJSONObject(i);
            Uri uri = Uri.parse(item.optString("uri"));
            String score = item.optString("scoreUri");
            if (canRestoreQueueSource(uri, grants, importsAuthority) &&
                    (score.isEmpty() || canRestoreQueueSource(Uri.parse(score), grants, importsAuthority))) retained.set(i);
        }
        int count = retained.cardinality();
        int previous = saved.optInt("index", -1);
        if (count == length && previous >= 0 && previous < length) return saved;
        JSONObject settings = new JSONObject(saved.toString());
        int selected = retained.nextSetBit(Math.max(0, previous));
        if (selected < 0) selected = retained.nextSetBit(0);
        if (selected != previous || selected < 0 || (settings.has("positionEntryId") &&
                settings.getInt("positionEntryId") != queue.getJSONObject(selected).getInt("queueEntryId"))) {
            settings.remove("positionUs");
            settings.remove("durationUs");
            settings.remove("sourceExhausted");
        }
        // The replacement assigns new entry IDs, so the saved position now belongs to the committed ordinal.
        settings.remove("positionEntryId");
        if (count == length) {
            settings.put("index", selected);
            queue.saveSettings(settings);
            return settings;
        }
        queue.begin();
        try {
            JSONArray batch = new JSONArray();
            int index = -1, ordinal = 0;
            for (int i = retained.nextSetBit(0); i >= 0; i = retained.nextSetBit(i + 1)) {
                if (i == selected) index = ordinal;
                ordinal++;
                JSONObject item = queue.getJSONObject(i);
                item.remove("queueEntryId");
                batch.put(item);
                if (batch.length() == 64) { queue.append(batch); batch = new JSONArray(); }
            }
            if (batch.length() > 0) queue.append(batch);
            queue.commit(settings.put("index", index));
            queueRestoreResult = object("omittedCount", length - count, "restoredCount", count);
        } finally { queue.abort(); }
        return settings;
    }

    private boolean canRestoreQueueSource(Uri uri, HashSet<Uri> grants, String importsAuthority) {
        // Like the shared session, restore local sources and omit transient network streams.
        if (!"content".equals(uri.getScheme()) || uri.getAuthority() == null) return false;
        if (importsAuthority.equals(uri.getAuthority())) return MainActivity.importFileExists(this, uri);
        if (grants.contains(uri)) return true;
        // A provider may be offline during startup. Open the document only when loading it.
        return DocumentsContract.isTreeUri(uri) && grants.contains(DocumentsContract.buildTreeDocumentUri(
                uri.getAuthority(), DocumentsContract.getTreeDocumentId(uri)));
    }

    private JSONObject audioDevices() {
        JSONArray inputs = new JSONArray(), outputs = new JSONArray();
        HashSet<String> inputLabels = new HashSet<>(), outputLabels = new HashSet<>();
        for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_ALL)) {
            String label = deviceLabel(device);
            if (label == null) continue;
            if (device.isSource()) inputs.put(object("id", device.getId(), "label", uniqueLabel(label, inputLabels)));
            if (device.isSink()) outputs.put(object("id", device.getId(), "label", uniqueLabel(label, outputLabels),
                    "channelCounts", new JSONArray(outputChannelCounts(device))));
        }
        return object("inputs", inputs, "outputs", outputs, "defaultOutputChannelCounts", new JSONArray(outputChannelCounts(outputDevice(0))),
                "unprocessed", unprocessedInputSupported());
    }

    private AudioDeviceInfo outputDevice(int id) {
        if (id == 0 && Build.VERSION.SDK_INT >= 33) {
            java.util.List<AudioDeviceInfo> route = audioManager.getAudioDevicesForAttributes(
                    new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build());
            return route.size() == 1 ? route.get(0) : null;
        }
        if (id == 0 && preferredOutputDevice == 0 && engine != null) id = engine.getOutputDeviceId();
        for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS))
            if (device.getId() == id) return device;
        return null;
    }

    private static java.util.SortedSet<Integer> outputChannelCounts(AudioDeviceInfo device) {
        java.util.SortedSet<Integer> counts = new java.util.TreeSet<>();
        if (device != null && device.getType() != AudioDeviceInfo.TYPE_BUILTIN_SPEAKER &&
                device.getType() != AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE)
            for (int count : device.getChannelCounts()) if (count >= 2 && count <= 16) counts.add(count);
        if (counts.isEmpty()) counts.add(2);
        return counts;
    }

    private int outputWidth(int device, int requested) {
        java.util.SortedSet<Integer> counts = outputChannelCounts(outputDevice(device));
        int width = counts.first();
        for (int count : counts) if (count <= requested) width = count;
        return width;
    }

    private static HostError outputFormatError() {
        return new HostError("unsupported-format", "The output device cannot use these settings. Choose another device or change the audio settings.");
    }

    /** Media routes only; built-in routes are named by type, external ones by type and product. */
    private static String deviceLabel(AudioDeviceInfo device) {
        CharSequence productName = device.getProductName();
        String product = productName == null ? "" : productName.toString().trim();
        String external;
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "Speaker";
            case AudioDeviceInfo.TYPE_BUILTIN_MIC: return "Built-in microphone";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: return "Wired headphones";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "Wired headset";
            case AudioDeviceInfo.TYPE_LINE_ANALOG: return "Analog line";
            case AudioDeviceInfo.TYPE_LINE_DIGITAL: return "Digital line";
            case AudioDeviceInfo.TYPE_AUX_LINE: return "Aux line";
            case AudioDeviceInfo.TYPE_DOCK:
            case AudioDeviceInfo.TYPE_DOCK_ANALOG: return "Dock";
            case AudioDeviceInfo.TYPE_HDMI:
            case AudioDeviceInfo.TYPE_HDMI_ARC:
            case AudioDeviceInfo.TYPE_HDMI_EARC: external = "HDMI"; break;
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:
            case AudioDeviceInfo.TYPE_USB_HEADSET: external = "USB"; break;
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
            case AudioDeviceInfo.TYPE_BLE_SPEAKER:
            case AudioDeviceInfo.TYPE_BLE_BROADCAST: external = "Bluetooth"; break;
            case AudioDeviceInfo.TYPE_HEARING_AID: external = "Hearing aid"; break;
            default: return null;
        }
        return product.isEmpty() ? external : external + ": " + product;
    }

    private static String uniqueLabel(String label, HashSet<String> used) {
        String value = label;
        for (int index = 2; !used.add(value); index++) value = label + " " + index;
        return value;
    }

    private void liveCommand(String name, JSONObject args, Reply reply, boolean fromVisibleUi) throws Exception {
        String id = args.getString("id");
        if (name.equals("live.start")) {
            requireMainOutput();
            String url = mediaGateway.livePlaybackUrl(args.getString("sessionId"));
            pause(false);
            endMeasurementInput();
            startAudio(fromVisibleUi || foreground);
            decoder.cancel(); generation = engine.beginSource();
            nextTrack = null; sourceReady = false; decoderEnded = false;
            if (loadedScore != null) releaseScore();
            liveInput = new LivePcmInput(id, url, control, engine, reply, input -> {
                if (input == liveInput) stopLiveInput();
            });
            refreshInputOwnership();
            liveInput.start();
            return;
        }
        JSONObject result = new JSONObject();
        if (liveInput != null && liveInput.id.equals(id)) {
            switch (name) {
                case "live.activate":
                    long route = args.getLong("generation");
                    if (route == liveInput.routeGeneration && route > 0) {
                        startAudio(fromVisibleUi || foreground);
                        engine.activateLiveInput(route);
                        playing = true;
                        sessionState();
                        result.put("active", true);
                    }
                    break;
                case "live.position":
                    double cursor = engine.livePosition();
                    int rate = engine.getSampleRate();
                    double[] clock = engine.getVisualClock();
                    result = object("started", cursor >= 0, "positionFrames", cursor >= 0 ? cursor : -1 - cursor,
                            "sampleRate", rate, "outputDelayFrames", engine.getAppliedOutputDelay(),
                            "physicalOutputMs", clock.length >= 3 && clock[2] > 0 ? clock[2] * 1000 / rate : JSONObject.NULL);
                    break;
                case "live.stop": stopLiveInput(); break;
                default: throw new IllegalArgumentException("Unknown live operation");
            }
        }
        reply.complete(result, null);
    }

    private void stopLiveInput() {
        LivePcmInput input = liveInput;
        if (input == null) return;
        liveInput = null;
        input.close();
        playing = false;
        if (input.routeGeneration >= 0) {
            try { networkOutput.command("network.output.setReceiveSession",
                    object("generation", input.routeGeneration, "active", false), engine); }
            catch (Exception error) { Log.w("EffeTuneNetwork", "Live receive route cleanup failed", error); }
        }
        if (destroyed) return;
        send("live-ended", object("id", input.id));
        refreshInputOwnership();
        sessionState();
    }

    private void startPlayback(boolean userVisible) throws HostError {
        requireMainOutput();
        stopLiveInput();
        if (source == null) throw new HostError("source-required", "Select a track first.");
        // Android 12+ starts a foreground Service only for the visible app or a user action, and a paused queue has left it.
        if (!userVisible && !visible && !foreground) throw new HostError("visible-start-required", "Open EffeTune to start audio.");
        endMeasurementInput();
        outputRecoveryAttempted = false; startOutput(userVisible, true);
        try {
            if (!sourceReady) {
                seek(sourceExhausted ? 0 : positionUs);
                loadGeneration = generation;
                if (metadataSource != source) publishMetadata();
            }
            if (!playing) resumeCurrentTrack();
            resumeOnFocus = false;
        } catch (HostError error) {
            if (!isLoadError(error) || !source.has("queueEntryId")) throw error;
            Log.w("EffeTuneDecode", "Cannot start queue entry", error);
            recordLoadFailure(source);
            skipFailedTrack(true);
        } finally { updateForeground(false, userVisible); }
    }

    private void seek(long position) throws HostError {
        stopLiveInput();
        if (position < 0 || (durationUs > 0 && position > durationUs)) throw new HostError("invalid-position", "Choose a position within the track.");
        Uri decodeUri = source == null || source.has("scoreUri") ? null : SubsonicHost.playbackUri(this, source);
        positionUs = position;
        sourceExhausted = false;
        decoder.cancel(); generation = engine.beginSource(); renderStart = engine.getRenderedFrames(); decoderEnded = false;
        lastPcmFrame = renderStart;
        pcmStalled = playing && decodeUri != null;
        nextTrack = null; decodeOrigin = renderStart;
        if (source != null && source.has("scoreUri")) {
            configureScore(position, playing);
            sourceReady = true;
        } else if (decodeUri != null) {
            startDecoder(source, decodeUri, positionUs);
            sourceReady = true;
        }
        if (sourceReady) restoredUnloaded = false;
        saveQueue();
    }

    private void startDecoder(JSONObject value, Uri decodeUri, long position) {
        JSONObject region = value.optJSONObject("region");
        long endUs = region == null ? 0 : (long) (region.optDouble("end", 0) * 1_000_000);
        decoder.start(value, decodeUri, position, speed, preservePitch, endUs, generation);
    }

    private void resumeCurrentTrack() throws HostError {
        if (loadedScore != null) configureScore(positionUs, true);
        playbackStopped = false;
        playing = true;
        renderStart = engine.getRenderedFrames();
        lastPcmFrame = renderStart;
        pcmStalled = loadedScore == null && engine.getQueuedFrames() == 0;
        engine.setPlaying(loadedScore == null);
        decoder.setPaused(false);
    }

    private void configureScore(long position, boolean play) throws HostError {
        String uri = source.optString("scoreUri");
        try (android.os.ParcelFileDescriptor file = uri.equals(loadedScore) ? null
                : getContentResolver().openFileDescriptor(Uri.parse(uri), "r")) {
            if (file == null && !uri.equals(loadedScore)) throw new IOException("Missing prepared score");
            if (file != null) midi.score.load(file);
            double startSeconds = position / 1_000_000.0;
            midi.score.reset(startSeconds);
            durationUs = (long) (1_000_000 * applyScoreTransport(file == null ? -1 : file.getFd(),
                    startSeconds, speed, play));
            loadedScore = uri;
            scoreRevision++;
            control.removeCallbacks(scoreOutputTick);
            if (play) control.post(scoreOutputTick);
        } catch (IOException | RuntimeException error) {
            stopBlindTest(true);
            Log.w("EffeTuneMidi", "Score transport failed", error);
            throw new HostError("track-unavailable", "This score could not be played. Open the file again.");
        }
    }

    private double applyScoreTransport(int fd, double position, double speed, boolean play) {
        try {
            return engine.scoreTransport(fd, position, speed, play);
        } catch (RuntimeException error) {
            if (!parallelActive) throw error;
            Log.w("EffeTuneMidi", "Retrying score on the primary graph", error);
            stopBlindTest(true);
            return engine.scoreTransport(fd, position, speed, play);
        }
    }

    private void releaseScore() {
        control.removeCallbacks(scoreOutputTick);
        midi.score.clear();
        applyScoreTransport(-2, 0, 1, false);
        loadedScore = null;
        scoreRevision++;
        if (liveMidiEnabled) engine.liveMidiSource(true);
    }

    private boolean filePlaying() { return playing && liveInput == null; }

    private long currentPosition() {
        if (liveInput != null) return positionUs;
        if (playing && loadedScore != null) {
            double seconds = engine.scorePosition();
            return seconds < 0 ? positionUs : (long) (seconds * 1_000_000);
        }
        return positionUs + (playing ? (long) ((engine.getRenderedFrames() - renderStart) * 1_000_000.0 * speed / engine.getSampleRate()) : 0);
    }

    private void pause(boolean abandonFocus) {
        if (engine == null) return;
        promoteReachedNextTrack();
        stopCurrentTrack();
        if (abandonFocus) audioManager.abandonAudioFocusRequest(focus);
        saveQueue();
        changed();
    }

    private void stopCurrentTrack() {
        stopLiveInput();
        positionUs = currentPosition();
        if (playing && loadedScore != null) {
            control.removeCallbacks(scoreOutputTick);
            midi.score.reset();
            positionUs = (long) (engine.pauseScore() * 1_000_000);
            scoreRevision++;
        }
        decoder.setPaused(true);
        pcmStalled = false;
        playing = false; resumeOnFocus = false; engine.setPlaying(false);
    }

    private void resetCurrentTrack() {
        stopCurrentTrack();
        if (loadedScore != null) releaseScore();
        decoder.cancel();
        generation = engine.beginSource();
        nextTrack = null;
        decoderEnded = false;
        positionUs = 0;
        sourceReady = false;
        sourceExhausted = false;
        playbackStopped = true;
    }

    private void clearCurrentTrack() {
        resetCurrentTrack();
        source = null;
        queueIndex = -1;
        durationUs = 0;
        restoredUnloaded = false;
        failedEntries.clear();
        publishMetadata();
    }

    private void clearPlaybackQueue() throws Exception {
        queue.abort(); stagedQueueSettings = null; queueTransaction = null; queueTransactionRemoteId = null;
        queue.replace(new JSONArray());
        queueRevision++;
        clearCurrentTrack();
    }

    private void stopAudio() { stopAudio(true); }

    private void stopAudio(boolean deselectInput) { stopAudio(deselectInput, true); }

    private void stopAudio(boolean deselectInput, boolean dismissNotification) {
        control.removeCallbacks(sampleTick);
        sampleTickScheduled = false;
        focusHeld = false; resumeOutput = false; resumeWhenVisible = false; resumeEngineOnFocus = false;
        clearPreviews();
        if (recordingMonitor != null) recordingMonitor.disarm();
        measurement.invalidate(engine);
        pause(true); decoder.cancel(); generation = engine.beginSource(); engine.setInputDevice(-1); acquiredInputDevice = -1;
        sourceReady = false;
        // A stop deselects the player's input; the measurement page keeps the microphone it chose.
        if (deselectInput) setPlayerInput(-1);
        microphone = false; engine.stop(); running = false;
        powerState = "SUSPENDED"; autoSuspended = false;
        dismissWhenIdle = dismissNotification; updateForeground();
        updateRemoteLifetime();
    }

    private void changed() {
        refreshInputOwnership();
        scorePreparing = playing && loadedScore != null && engine.scorePosition() < 0;
        revision++;
        sessionState();
        send("snapshot", snapshot());
        publishRemoteState();
    }

    private void reconcileOutput() {
        if (!running) return;
        int status = engine.getOutputStatus();
        if (status > 0) {
            if (outputRecoveryAttempted && engine.getAudioFrameTime() > outputRecoveryFrame) outputRecoveryAttempted = false;
            return;
        }
        measurement.invalidate(engine); recordingMonitor.disarm();
        running = false; powerState = "SUSPENDED";
        // One control-owner reopen preserves queued PCM when Android replaces a route.
        // Stop/noisy/focus loss clear running/focusHeld and cannot enter this path.
        // A graph that cannot render is not reopened: it would fail the same way.
        if (status != NativeEngine.PIPELINE_FAILED && focusHeld && !outputRecoveryAttempted) {
            outputRecoveryAttempted = true;
            outputRecoveryFrame = engine.getAudioFrameTime();
            if (recoverSelectedOutput()) { running = true; powerState = "ACTIVE"; changed(); return; }
        }
        if (meterChannel >= 0) { measurementDevicesLost(); changed(); return; }
        boolean wasPlaying = filePlaying(); int input = playerInput();
        stopAudio();
        // The input stays selected while stopped, as it does through automatic suspension.
        if (status == NativeEngine.PIPELINE_FAILED) { resumeOutput = true; resumePlayback = wasPlaying; setPlayerInput(input); }
        else outputStopReason = "output-disconnected";
        // stopAudio() published before the output closed; the stopped state goes out ahead of the error.
        changed();
        send("error", status == NativeEngine.PIPELINE_FAILED
                ? object("code", "pipeline-failed", "message", "An effect could not process audio, so the sound stopped. Remove or bypass the effect you changed last and the sound will return.")
                : object("code", "audio-unavailable", "message", "The audio output disconnected. Reconnect it and press Play."));
    }

    // Restores the output, live input, and playback that stopped with the failed effect graph or the previous rate.
    // Playback resumes within the edit that restores the output, so the revision that edit reports is final.
    private void resumeStoppedOutput() {
        boolean play = resumePlayback; resumeWhenVisible = false;
        try { startAudio(true); if (play) startPlayback(true); }
        catch (HostError error) { send("error", object("code", error.code, "message", error.getMessage())); }
    }

    // A decoder reports for the engine it writes to; reports for a replaced engine are stale.
    private PcmDecoder createDecoder() {
        NativeEngine owner = engine;
        return new PcmDecoder(this, owner, new PcmDecoder.Listener() {
            // Every seek restarts the decoder and reports the track's length again; only a new length is published.
            @Override public void format(long token, long duration) {
                control.post(() -> {
                    if (destroyed || owner != engine || token != generation) return;
                    if (nextTrackValid()) nextTrack.durationUs = duration;
                    else if (duration != durationUs) { durationUs = duration; publishMetadata(); changed(); }
                });
            }
            @Override public void ended(long token, long frames) {
                control.post(() -> {
                    if (destroyed || owner != engine || token != generation) return;
                    if (nextTrackValid()) nextTrack.endedFrames = frames; else sourceEnded(frames);
                });
            }
            @Override public void failed(long token, long frames, Exception error) {
                control.post(() -> {
                    if (destroyed || owner != engine || token != generation) return;
                    Log.e("EffeTuneDecode", "Source decoding failed", error);
                    if (nextTrackValid()) {
                        nextTrack.failedFrames = frames;
                        if (promoteReachedNextTrack()) changed();
                        return;
                    }
                    if (frames > 0 || token != loadGeneration || source == null || !source.has("queueEntryId")) stopFailedSource();
                    else { recordLoadFailure(source); skipFailedTrack(playing); }
                    changed();
                });
            }
        });
    }

    private void stopFailedSource() {
        reportSkippedTracks();
        stopCurrentTrack(); sourceReady = false;
        saveQueue();
        send("error", object("code", "source-unavailable", "message", "This audio source cannot be played. Select another file or reconnect to the music server."));
    }

    // A new engine waits for the chain packed for its rate and width.
    private void setEngineFormat(int rate, int width, int device, int latency) throws HostError {
        NativeEngine next;
        try { next = new NativeEngine(rate, 128, width); }
        catch (RuntimeException error) {
            Log.w("EffeTuneAudio", "The engine could not be created for the requested format", error);
            throw outputFormatError();
        }
        next.setOutput(device, latency);
        if (width > 2 && !next.checkOutputFormat()) {
            next.close();
            throw outputFormatError();
        }
        // A restore that is still pending carries over to the new engine.
        if (meterChannel >= 0) endMeasurementInput();
        stopBlindTest(true);
        boolean resume = running || autoSuspended || resumeOutput, wasPlaying = filePlaying() || resumeOutput && resumePlayback;
        int input = playerInput();
        stopAudio();
        NativeEngine previous = engine; PcmDecoder previousDecoder = decoder;
        loadedScore = null;
        engine = next; decoder = createDecoder();
        if (liveMidiEnabled) engine.liveMidiSource(true);
        previousDecoder.close();
        previous.close();
        engine.setPlayerGain(muted ? 0 : volume);
        engine.setMeasurementMeter(meterChannel);
        generation = engine.beginSource();
        pipelineRequest = null; instances.clear(); instanceTypes.clear(); assets.discardPending(); visualizerTaps.clear();
        // Undo and redo steps were packed for the previous rate.
        undo.clear(); redo.clear();
        lastPipelineRevision = revision + 1;
        setPlayerInput(input); resumeOutput = resume; resumePlayback = wasPlaying;
        getSharedPreferences("audio", MODE_PRIVATE).edit().putInt("sampleRate", rate).apply();
        changed();
    }
    private void send(String name, JSONObject value) { if (events != null) events.send(name, value); }
    private Object slotRecords(String selected) {
        if (selected.equals(slot)) return pipeline;
        JSONObject saved = slots.get(selected);
        return saved == null ? (selected.equals("B") ? JSONObject.NULL : new JSONArray()) : saved.optJSONArray("plugins");
    }
    private JSONObject readSlotPage(JSONObject args) throws Exception {
        String selected = args.getString("slot");
        if (!selected.equals("A") && !selected.equals("B")) throw new IllegalArgumentException("Invalid slot");
        Object value = slotRecords(selected);
        if (value == JSONObject.NULL) return object("records", JSONObject.NULL);
        JSONArray records = (JSONArray) value, page = new JSONArray();
        int index = args.getInt("offset");
        if (index < 0 || index > records.length()) throw new IllegalArgumentException("Invalid slot offset");
        int bytes = 0;
        while (index < records.length()) {
            JSONObject record = records.getJSONObject(index);
            JSONObject row = object("id", record.getInt("id"), "name", record.getString("name"),
                    "type", record.getString("type"), "enabled", record.optBoolean("enabled", true),
                    "parameters", record.getJSONObject("parameters"), "reason", record.opt("reason"));
            int size = io.netty.buffer.ByteBufUtil.utf8Bytes(row.toString()) + 1;
            if (page.length() > 0 && bytes + size > 512 * 1024) break;
            page.put(row);
            bytes += size;
            index++;
        }
        return object("records", page, "more", index < records.length());
    }

    private JSONObject snapshot() {
        int rate = engine == null ? 48000 : engine.getSampleRate();
        // The tick observes the running output; a stopped or replaced one must not keep the previous stream's figures.
        if (engine != null && !running) outputStats = engine.observeOutput();
        // The current chain as the Service keeps it: the UI packs it, and prepares its files, again when the rate differs.
        JSONObject chain = slots.get(slot), chainRefs = chain == null ? null : chain.optJSONObject("assetRefs");
        JSONObject other = slots.get(slot.equals("A") ? "B" : "A");
        int width = engine == null ? 2 : engine.getChannelCount();
        String pipelineStartup = chain == null ? "uninitialized" : pipelineStartupPending ? "startup" : "running";
        return object("revision", revision, "sampleRate", rate, "channelCount", width,
                "pipelineStartup", pipelineStartup,
                "outputStopReason", outputStopReason,
                "networkOutput", networkOutput == null ? null : networkOutput.snapshot(),
                "parallelActive", parallelActive, "supportedSampleRates", new JSONArray(SAMPLE_RATES),
                "slot", slot, "pipelines", pageSlotRecords ? null : object("A", slotRecords("A"), "B", slotRecords("B")),
                "canUndo", !undo.isEmpty(), "canRedo", !redo.isEmpty(),
                "routingChannelCount", width, "masterBypass", masterBypass, "powerState", powerState,
                "pipelineRateMismatch", chain != null && (chain.optInt("sampleRate", rate) != rate || chain.optInt("channelCount", width) != width),
                "pipelineRepack", remoteRepack,
                "staleAssets", chainRefs == null ? new JSONArray() : AssetTransfers.stale(chainRefs, rate),
                "assetRefs", pipelineRequest == null ? new JSONObject() : pipelineRequest.optJSONObject("assetRefs"),
                "assetDefinitions", AssetTransfers.definitions(pipelineRequest == null ? null : pipelineRequest.optJSONObject("assetRefs")),
                "otherAssetDefinitions", other == null ? null : AssetTransfers.definitions(other.optJSONObject("assetRefs")),
                "otherStaleAssets", other == null || !other.has("assetRefs") ? null : AssetTransfers.stale(other.optJSONObject("assetRefs"), rate),
                "retainedAssetDefinitions", assets == null ? new JSONArray() : assets.retainedDefinitions(retainedPipelineStates()),
                "inputDeviceId", inputDevice, "useInputWithPlayer", useInputWithPlayer, "gaplessPlayback", gapless, "outputDeviceId", engine == null ? 0 : engine.getOutputDeviceId(),
                "preferredOutputDeviceId", preferredOutputDevice, "actualOutputDeviceId", engine == null ? 0 : engine.getOutputDeviceId(),
                "latencyHint", latencyMode == 0 ? "interactive" : latencyMode == 2 ? "playback" : "balanced", "outputStarted", outputStarted,
                "deviceSampleRate", outputStats[0], "outputHardwareSampleRate", outputStats[7], "outputBurstFrames", outputStats[1], "outputBufferFrames", outputStats[2],
                "outputXRuns", outputStats[3], "outputRenderFailures", outputStats[4], "sourceUnderruns", outputStats[5], "inputUnderruns", outputStats[6],
                "playback", object("playing", playing, "position", engine == null ? 0 : currentPosition() / 1_000_000.0,
                        "liveId", liveInput == null ? null : liveInput.id,
                        "duration", durationUs / 1_000_000.0, "scoreRevision", scoreRevision,
                        "scorePreparing", loadedScore != null && playing && scorePreparing,
                        "pcmStalled", pcmStalled,
                        "speed", speed, "preservePitch", preservePitch, "volume", volume, "muted", muted,
                        "queueRevision", queueRevision, "queueFocus", queueFocus, "generation", generation,
                        "stopped", playbackStopped || source == null, "restoredUnloaded", restoredUnloaded,
                        "shuffleSeed", shuffleOrder.seed, "shuffleOffset", shuffleOffset,
                        "queueLength", queue == null ? 0 : queue.length(), "index", queueIndex, "repeat", repeat, "shuffle", shuffle,
                        "ordinal", queue == null ? -1 : queueOrdinalOf(queueIndex),
                        "explicitOrder", queue != null && shuffle && queue.hasExplicitOrder(),
                        "retainedQueueLength", queue == null ? 0 : queue.retainedLength(),
                        "sourceInQueue", source != null && source.has("queueEntryId"),
                        "source", source == null ? JSONObject.NULL : sourceSnapshot(source)));
    }

    private JSONObject sourceSnapshot(JSONObject item) {
        JSONObject result = object("uri", item.optString("uri"), "title", item.optString("title", ""));
        if (item.has("scoreUri")) try {
            result.put("scoreUri", item.getString("scoreUri")).put("scoreName", item.optString("scoreName"));
        } catch (org.json.JSONException error) { throw new IllegalArgumentException(error); }
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

    private void sessionState() {
        session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
                .setState(playing ? PlaybackState.STATE_PLAYING : playbackStopped || source == null ? PlaybackState.STATE_STOPPED : PlaybackState.STATE_PAUSED,
                        engine == null ? 0 : currentPosition() / 1000, playing && !pcmStalled ? (float) speed : 0, SystemClock.elapsedRealtime()).build());
        boolean wasForeground = foreground;
        updateForeground();
        if (notified && wasForeground == foreground) showNotification(false);
    }

    private boolean needsForeground(boolean startingOutput) {
        return startingOutput || playing || microphone || resumeOnFocus || resumeEngineOnFocus
                || (running && (source == null || temporalMustProcess || !previews.isEmpty()))
                || (libraryShare != null && libraryShare.isEnabled())
                || (openHome != null && openHome.isEnabled())
                || (networkOutput != null && networkOutput.sending());
    }

    private void updateForeground() { updateForeground(false, false); }

    private void updateForeground(boolean startingOutput, boolean userAction) {
        if (destroyed) return;
        if (needsForeground(startingOutput)) {
            if (!foreground && (visible || (userAction && !microphone))) {
                startService(new Intent(this, AudioService.class));
                showNotification(true);
                return;
            }
            // Keep the existing microphone type until the focus resume attempt finishes.
            if (foreground && foregroundMicrophone != microphone && (microphone || !resumeEngineOnFocus)) {
                showNotification(true); return;
            }
        } else if (dismissWhenIdle || (source == null && notified)) {
            stopForeground(STOP_FOREGROUND_REMOVE); getSystemService(NotificationManager.class).cancel(1);
            foreground = false; notified = false; dismissWhenIdle = false; stopSelf();
            return;
        } else if (foreground) {
            stopForeground(STOP_FOREGROUND_DETACH); foreground = false;
            showNotification(false);
        }
    }

    static HostError remoteError(String code) {
        return new HostError(code, "Remote control could not start. Check the port and any selected certificate files.");
    }

    private void remoteClientCommand(String name, JSONObject args, Reply reply, boolean fromVisibleUi) throws Exception {
        if ((!fromVisibleUi || !visible) && !(name.equals("remoteClient.cancel") || name.equals("remoteClient.disconnect") || name.equals("remoteClient.send")))
            throw remoteError("visible-start-required");
        if (effectsClient == null) effectsClient = new RemoteEffectsClient(control, getSharedPreferences("remote-connections", MODE_PRIVATE), this::send, remoteIo);
        if (name.equals("remoteClient.send")) { effectsClient.send(args, reply); return; }
        reply.complete(effectsClient.command(name, args), null);
    }

    private void clearPairingPage() {
        if (remotePairing != null) remotePairing.unavailable();
        pemSelections.clear();
        settingsRevision++;
    }

    void selectRemoteConnectionFile(String kind, String fileName, String pem, Reply reply) {
        control.post(() -> {
            if (!visible || destroyed || !(kind.equals("certificate") || kind.equals("key")) || pem.length() > 256 * 1024) {
                reply.complete(null, remoteError("invalid-certificate")); return;
            }
            PemSelection file = new PemSelection(UUID.randomUUID().toString(), fileName, pem);
            pemSelections.put(kind, file);
            reply.complete(object("selectionId", file.id, "fileName", file.name), null);
        });
    }

    private PemSelection selectedPem(String kind, JSONObject args, boolean clear) throws HostError {
        if (args.has(kind + "Selection")) {
            PemSelection selection = pemSelections.get(kind);
            if (selection == null || !selection.id.equals(args.opt(kind + "Selection"))) throw remoteError("invalid-certificate");
            return selection;
        }
        SharedPreferences prefs = remotePreferences();
        return clear ? new PemSelection("", "", "") : new PemSelection("", prefs.getString(kind + "Name", ""),
                prefs.getString(kind.equals("key") ? "privateKey" : "certificate", ""));
    }

    static String remoteEndpoint(String input) throws HostError {
        if (input.trim().isEmpty()) return "";
        try {
            java.net.URI uri = java.net.URI.create(input.trim());
            String host = uri.getHost();
            if (input.length() > 2048 || !"https".equalsIgnoreCase(uri.getScheme()) || host == null || host.endsWith(".")
                    || uri.getRawUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || uri.getRawAuthority().endsWith(":")
                    || !(uri.getRawPath().isEmpty() || uri.getRawPath().equals("/"))) throw remoteError("invalid-endpoint");
            if (uri.getPort() < 1024 || uri.getPort() > 65535) throw remoteError("invalid-port");
            return "https://" + host.toLowerCase(java.util.Locale.ROOT) + ":" + uri.getPort();
        } catch (IllegalArgumentException error) { throw remoteError("invalid-endpoint"); }
    }

    private boolean remoteSettingsCommand(String name, JSONObject args, Reply reply, boolean fromVisibleUi) throws Exception {
        switch (name) {
            case "remote.configure", "remote.rotateToken", "remote.setConnection", "remote.testConnection", "remote.copyLink", "remote.join" -> {}
            default -> { return false; }
        }
        if (!fromVisibleUi || !visible) throw remoteError("visible-start-required");
        SharedPreferences prefs = remotePreferences();
        switch (name) {
            case "remote.copyLink" -> {
                JSONObject address = remoteAddresses.optJSONObject(args.getInt("index"));
                if (address == null || remote == null) throw remoteError("remote-unavailable");
                getSystemService(android.content.ClipboardManager.class).setPrimaryClip(
                        android.content.ClipData.newPlainText("EffeTune", address.getString("webUrl")));
                reply.complete(object("copied", true), null);
            }
            case "remote.join" -> joinRemote(args.optString("link"), reply);
            case "remote.testConnection" -> testRemoteConnection(reply);
            case "remote.rotateToken" -> {
                settingsRevision++;
                if (remote != null) remote.rotate();
                stopRemoteHost();
                prefs.edit().putString("token", newToken()).apply();
                getSharedPreferences("remote-issued", MODE_PRIVATE).edit().clear().apply();
                restartRemote(reply);
            }
            case "remote.configure" -> {
                boolean enabled = args.has("enabled") ? args.getBoolean("enabled") : prefs.getBoolean("enabled", false);
                if (enabled && Build.VERSION.SDK_INT >= 37 && checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") != PackageManager.PERMISSION_GRANTED)
                    throw new HostError("permission-required", "Allow local network access in Android settings to use remote control.");
                int port = args.has("port") ? args.getInt("port") : prefs.getInt("port", 47300);
                if (port < 1024 || port > 65535 || (args.has("port") && !prefs.getString("endpoint", "").isEmpty() && port != remotePort(prefs)))
                    throw new HostError("invalid-port", "Choose a port between 1024 and 65535.");
                SharedPreferences.Editor changes = prefs.edit().putBoolean("enabled", enabled).putInt("port", port);
                if (args.has("certificatePem") || args.has("privateKeyPem")) {
                    String cert = args.optString("certificatePem", prefs.getString("certificate", ""));
                    String key = args.optString("privateKeyPem", prefs.getString("privateKey", ""));
                    if (args.has("certificatePem")) changes.putString("certificateName", "");
                    if (args.has("privateKeyPem")) changes.putString("keyName", "");
                    validateRemoteSettings(changes, enabled, prefs.getString("endpoint", ""), cert, key, reply);
                } else {
                    settingsRevision++;
                    applyRemoteSettings(changes, enabled, reply);
                }
            }
            case "remote.setConnection" -> {
                String endpoint = remoteEndpoint(args.optString("endpoint", prefs.getString("endpoint", "")));
                boolean clear = args.optBoolean("clearTls");
                PemSelection cert = selectedPem("certificate", args, clear), key = selectedPem("key", args, clear);
                validateRemoteSettings(prefs.edit().putString("certificateName", cert.name).putString("keyName", key.name),
                        prefs.getBoolean("enabled", false), endpoint, cert.pem, key.pem, reply);
            }
        }
        return true;
    }

    private void validateRemoteSettings(SharedPreferences.Editor changes, boolean enabled, String endpoint, String cert, String key, Reply reply) {
        int revision = ++settingsRevision;
        remoteIo.execute(() -> {
            try { RemoteControlServer.validatedTls(cert, key, endpoint); }
            catch (HostError error) { reply.complete(null, error); return; }
            control.post(() -> {
                if (destroyed || !visible || revision != settingsRevision) { reply.complete(null, remoteError("cancelled")); return; }
                pemSelections.clear();
                applyRemoteSettings(changes.putString("endpoint", endpoint).putString("certificate", cert).putString("privateKey", key), enabled, reply);
            });
        });
    }

    private void applyRemoteSettings(SharedPreferences.Editor changes, boolean enabled, Reply reply) {
        if (!enabled && remotePreferences().getBoolean("enabled", false) && effectsClient != null) effectsClient.close();
        stopRemoteHost();
        changes.apply();
        restartRemote(reply);
    }

    private void restartRemote(Reply reply) {
        if (remotePreferences().getBoolean("enabled", false)) {
            remoteStartReply = reply;
            updateRemoteLifetime();
            if (remotePairing == null) completeRemoteStart(false);
        } else {
            JSONObject status = remoteStatus();
            send("remote-status", status);
            reply.complete(status, null);
        }
    }

    private void testRemoteConnection(Reply reply) {
        SharedPreferences prefs = remotePreferences();
        String endpoint = prefs.getString("endpoint", ""), cert = prefs.getString("certificate", ""), key = prefs.getString("privateKey", "");
        boolean listening = remote != null, enabled = prefs.getBoolean("enabled", false);
        remoteIo.execute(() -> {
            String code = listening ? "connected" : "configured";
            boolean ok = true;
            try {
                RemoteControlServer.validatedTls(cert, key, endpoint);
                if (enabled && !listening) throw remoteError("connection-unavailable");
                if (listening && !endpoint.isEmpty()) {
                    java.net.HttpURLConnection probe = (java.net.HttpURLConnection) java.net.URI.create(endpoint + RemotePairing.DESCRIPTION)
                            .toURL().openConnection(java.net.Proxy.NO_PROXY);
                    try {
                        probe.setConnectTimeout(5000); probe.setReadTimeout(5000); probe.setInstanceFollowRedirects(false);
                        if (probe.getResponseCode() != 200) throw remoteError("connection-unavailable");
                    } finally { probe.disconnect(); }
                }
            } catch (HostError error) { code = error.code; ok = false; }
            catch (Exception error) { code = "connection-unavailable"; ok = false; }
            reply.complete(object("ok", ok, "code", code, "running", listening, "endpoint", endpoint), null);
        });
    }

    private void joinRemote(String link, Reply reply) {
        for (int index = 0; index < remoteAddresses.length(); index++) {
            if (link.trim().equals(remoteAddresses.optJSONObject(index).optString("webUrl"))) {
                reply.complete(object("ok", true, "self", true), null); return;
            }
        }
        java.net.URI uri;
        try { uri = RemoteEffectsClient.target(link, true); }
        catch (IllegalArgumentException invalid) { reply.complete(object("ok", false, "self", false), null); return; }
        remoteIo.execute(() -> {
            boolean local = false;
            try {
                for (java.net.InetAddress ip : java.net.InetAddress.getAllByName(uri.getHost())) {
                    if (ip.isLoopbackAddress() || NetworkInterface.getByInetAddress(ip) != null) { local = true; break; }
                }
            } catch (IOException ignored) {}
            boolean localAddress = local;
            control.post(() -> {
                if (destroyed || !visible) { reply.complete(null, remoteError("visible-start-required")); return; }
                boolean self = localAddress && remote != null && uri.getPort() == remote.port();
                try {
                    if (!self) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(uri.toString()))
                            .addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    reply.complete(object("ok", true, "self", self), null);
                } catch (android.content.ActivityNotFoundException | SecurityException failure) {
                    reply.complete(object("ok", false, "self", false), null);
                }
            });
        });
    }

    private JSONObject remoteCommand(String name, JSONObject args, boolean fromVisibleUi) throws Exception {
        switch (name) {
            case "remote.authorize": requireRemoteAuthority(args.getString("requestId")); return object("current", true);
            case "remote.getStatus": break;
            case "remote.rendererReady": rendererReady = true; rendererState = new JSONObject(); publishRemoteState(); break;
            case "remote.rendererUnavailable": rendererReady = false; rendererState = new JSONObject(); publishRemoteState(); break;
            case "remote.publishState": rendererState = new JSONObject(args.toString()); publishRemoteState(); break;
            case "remote.respond": {
                String id = args.getString("requestId");
                requireRemoteAuthority(id);
                Consumer<JSONObject> pending = remotePending.remove(id);
                remoteAuthority.remove(id);
                RemoteTransfer transfer = remoteTransfers.remove(id);
                if (transfer != null && transfer.upload != null) transfer.upload.delete();
                // The renderer's state after the request, so the ack's rev covers the change (it does not publish it again).
                JSONObject snapshot = args.optJSONObject("snapshot");
                if (snapshot != null) { rendererState = snapshot; publishRemoteState(); }
                if (pending != null) pending.accept(args);
                break;
            }
            case "remote.presetsChanged": if (remote != null) remote.broadcastSync(object("op", "presetsChanged")); return new JSONObject();
            case "remote.irsChanged": {
                // Debounced like the desktop host: once a burst pauses for 400 ms, or every 3 s while it continues.
                long now = SystemClock.uptimeMillis();
                if (irsChangedFirstAt == 0) irsChangedFirstAt = now;
                control.removeCallbacks(irsChanged);
                control.postDelayed(irsChanged, Math.max(0, Math.min(400, irsChangedFirstAt + 3000 - now)));
                return new JSONObject();
            }
            case "remote.irRead": {
                String id = args.getString("requestId");
                requireRemoteAuthority(id);
                RemoteTransfer transfer = remoteTransfers.get(id);
                if (transfer == null || transfer.upload == null) throw new HostError("unauthorized", "Remote access changed. Reconnect and try again.");
                try (java.io.RandomAccessFile file = new java.io.RandomAccessFile(transfer.upload, "r")) {
                    long offset = args.getLong("offset");
                    if (offset < 0 || offset >= file.length()) throw new IllegalArgumentException("Invalid upload offset");
                    byte[] part = new byte[(int) Math.min(RemoteControlServer.IR_CHUNK_BYTES, file.length() - offset)];
                    file.seek(offset); file.readFully(part);
                    return object("data", Base64.encodeToString(part, Base64.NO_WRAP));
                }
            }
            case "remote.pairDecision":
                return object("accepted", fromVisibleUi && remotePairing != null && args.opt("allow") instanceof Boolean
                        && remotePairing.decide(args.getString("requestId"), args.getBoolean("allow")));
            default: throw new HostError("unsupported-operation", "This remote control operation is unavailable.");
        }
        return remoteStatus();
    }

    private String newToken() {
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        return Base64.encodeToString(bytes, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
    }

    private SharedPreferences remotePreferences() { return getSharedPreferences("remote", MODE_PRIVATE); }

    private void loadRemotePreferences() {
        try {
            // SharedPreferences blocks the first accessor until the XML read finishes.
            for (String name : new String[]{"remote", "remote-issued", "remote-connections"})
                getSharedPreferences(name, MODE_PRIVATE).contains("enabled");
            remotePreferencesReady = true;
            control.post(this::updateRemoteLifetime);
        } catch (RuntimeException error) { Log.w("EffeTuneRemote", "Remote settings unavailable", error); }
    }

    private void deferRemoteCommand(JSONObject request, Reply reply, boolean visibleUi, BooleanSupplier authority) {
        remoteIo.execute(() -> {
            if (remotePreferencesReady) command(request, reply, visibleUi, authority);
            else reply.complete(null, remoteError("remote-unavailable"));
        });
    }

    private void pwaEvent(String name, JSONObject data) {
        if ("pwa-revoked".equals(name) && !visible && !running) updateRemoteLifetime();
        if ("pwa-cancelled".equals(name) && data.optString("requestId").equals(queueTransactionRemoteId)) {
            queue.abort();
            stagedQueueSettings = null;
            queueTransaction = null;
            queueTransactionRemoteId = null;
        }
        send(name, data);
    }

    private PwaNetworkHost requirePwaRequest(String id) throws HostError {
        PwaNetworkHost host = remote == null ? null : remote.pwa;
        if (host == null || !host.current(id)) throw PwaNetworkHost.denied();
        return host;
    }

    private void pwaCommand(String name, JSONObject args, Reply reply) throws Exception {
        PwaNetworkHost host = remote == null ? null : remote.pwa;
        if (name.equals("pwa.setPermissions")) {
            if (!(args.opt("libraries") instanceof Boolean libraries) || !(args.opt("players") instanceof Boolean players))
                throw PwaNetworkHost.denied();
            if (host != null) host.permissions(libraries, players, args.optBoolean("sourcesChanged"));
            pwaLibraries = libraries;
            pwaPlayers = players;
            pwaPageReady = true;
            reply.complete(object("libraries", libraries, "players", players), null);
        } else if (name.equals("pwa.playerControl")) {
            String id = args.optString("requestId"), action = args.optString("action");
            PwaNetworkHost owner = requirePwaRequest(id);
            JSONObject operation = new JSONObject(args.toString()).put("playerId", "local")
                    .put("op", action.equals("delete") || action.equals("clear") ? "editPlaybackQueue" : "controlPlayback");
            handleNativeMusic(operation, response -> {
                JSONObject error = response.optJSONObject("error");
                if (error != null) reply.complete(null, new HostError(error.optString("code"), error.optString("message")));
                else reply.complete(new JSONObject(), null);
            }, () -> owner.current(id));
        } else if (host != null) {
            try { host.command(name, args, reply); }
            catch (org.json.JSONException | IllegalArgumentException invalid) { throw PwaNetworkHost.denied(); }
        } else if (name.equals("pwa.respond") || name.equals("pwa.respondPart")) reply.complete(object("accepted", false), null);
        else throw PwaNetworkHost.denied();
    }

    private void stopRemoteHost() {
        if (remotePairing == null) return;
        if (remote != null && remote.pwa != null) { remote.pwa.close(); remote.pwa = null; }
        remotePairing.close();
        remotePairing = null;
        if (remoteAdvertisement != null) { remoteAdvertisement.close(); remoteAdvertisement = null; }
        remote = null;
        remoteAddresses = new JSONArray();
        remoteIo.execute(() -> {
            if (transportOnWorker != null) { transportOnWorker.close(); transportOnWorker = null; }
        });
        completeRemoteStart(false);
        if (!destroyed) send("remote-status", remoteStatus());
    }

    private void updateRemoteLifetime() {
        if (!remotePreferencesReady || destroyed) return;
        boolean permitted = Build.VERSION.SDK_INT < 37 || checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") == PackageManager.PERMISSION_GRANTED;
        SharedPreferences prefs = remotePreferences();
        if (!permitted || !prefs.getBoolean("enabled", false) ||
                (!visible && !running && (libraryShare == null || !libraryShare.servesPlayerGrants()))) {
            stopRemoteHost(); return;
        }
        if (remotePairing != null) return;
        if (!prefs.contains("token")) prefs.edit().putString("token", newToken()).apply();
        String token = prefs.getString("token", ""), endpoint = prefs.getString("endpoint", "");
        String certificate = prefs.getString("certificate", ""), key = prefs.getString("privateKey", "");
        int port = remotePort(prefs);
        remoteStartFailed = false;
        RemotePairing owner = new RemotePairing(this, control, this::send, () -> visible && events != null && !destroyed,
                this::newToken, token, endpoint, openHome == null ? "EffeTune" : openHome.getStatus().optString("friendlyName", "EffeTune"));
        remotePairing = owner;
        remoteIo.execute(() -> {
            try {
                RemoteControlServer server = new RemoteControlServer(this, port, token, certificate, key, new RemoteControlServer.Dispatch() {
                    @Override public RemotePairing pairing() { return owner; }
                    @Override public void devicesChanged() {
                        control.post(() -> { if (owner.serving()) send("remote-status", remoteStatus()); });
                    }
                    @Override public void request(JSONObject request, Consumer<JSONObject> sendReply, BooleanSupplier current, BooleanSupplier writable) {
                        control.post(() -> {
                            if (owner.serving() && current.getAsBoolean())
                                dispatchRemote(request, sendReply, () -> owner.serving() && current.getAsBoolean(), writable);
                        });
                    }
                });
                transportOnWorker = server;
                JSONArray addresses = remoteAddresses(server.port(), token, endpoint, !certificate.isEmpty());
                control.post(() -> remoteBound(owner, server, addresses, !certificate.isEmpty()));
            } catch (Exception error) {
                Log.w("EffeTuneRemote", "Listener could not start", error);
                control.post(() -> { if (remotePairing == owner) { remoteStartFailed = true; stopRemoteHost(); } });
            }
        });
    }

    private void remoteBound(RemotePairing owner, RemoteControlServer server, JSONArray addresses, boolean secure) {
        if (destroyed || remotePairing != owner) return;
        remote = server;
        server.pwa = new PwaNetworkHost(this, control, this::pwaEvent, () -> pwaPageReady && events != null && !destroyed,
                libraryShare, mediaGateway, remotePreferences().getString("token", ""), owner.endpoint, owner.playerId, pwaLibraries, pwaPlayers);
        remoteAddresses = addresses;
        owner.start();
        try {
            remoteAdvertisement = ssdp.register(owner.udn, java.util.Collections.singletonList(RemotePairing.SERVICE),
                    ip -> (owner.endpoint.isEmpty() ? (secure ? "https://" : "http://") + ip.getHostAddress() + ":" + server.port()
                            : owner.endpoint) + RemotePairing.DESCRIPTION, ips -> refreshRemoteAddresses(owner, server.port(), secure));
        } catch (IOException | RuntimeException error) { Log.w("EffeTuneRemote", "Remote advertisement unavailable", error); }
        send("remote-status", remoteStatus());
        completeRemoteStart(true);
    }

    private void refreshRemoteAddresses(RemotePairing owner, int port, boolean secure) {
        String token = remotePreferences().getString("token", "");
        remoteIo.execute(() -> {
            JSONArray next = remoteAddresses(port, token, owner.endpoint, secure);
            control.post(() -> {
                if (remotePairing == owner && !next.toString().equals(remoteAddresses.toString())) {
                    remoteAddresses = next;
                    send("remote-status", remoteStatus());
                }
            });
        });
    }

    private void completeRemoteStart(boolean success) {
        Reply reply = remoteStartReply;
        remoteStartReply = null;
        if (reply != null) reply.complete(success ? remoteStatus() : null, success ? null : remoteError("remote-unavailable"));
    }

    private static JSONArray remoteAddresses(int port, String token, String endpoint, boolean secure) {
        JSONArray addresses = new JSONArray();
        if (!endpoint.isEmpty()) {
            String host = java.net.URI.create(endpoint).getHost();
            return addresses.put(object("name", "HTTPS", "address", host, "webUrl", endpoint + "/?t=" + token));
        }
        try {
            java.util.Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                for (java.net.InetAddress ip : java.util.Collections.list(network.getInetAddresses())) {
                    if (ip instanceof Inet4Address && NetworkStreamServer.lan(ip)) addresses.put(object("name", network.getName(),
                            "address", ip.getHostAddress(), "webUrl", (secure ? "https://" : "http://") + ip.getHostAddress() + ":" + port + "/?t=" + token));
                }
            }
        } catch (Exception error) { Log.d("EffeTuneRemote", "No LAN address", error); }
        return addresses;
    }

    private int remotePort(SharedPreferences prefs) {
        String endpoint = prefs.getString("endpoint", "");
        return endpoint.isEmpty() ? prefs.getInt("port", 47300) : java.net.URI.create(endpoint).getPort();
    }

    private JSONObject remoteStatus() {
        SharedPreferences prefs = remotePreferences();
        JSONArray devices = remote == null ? new JSONArray() : remote.devices();
        boolean secure = !prefs.getString("certificate", "").isEmpty();
        return object("enabled", prefs.getBoolean("enabled", false), "running", remote != null, "listening", remote != null,
                "error", remoteStartFailed && prefs.getBoolean("enabled", false), "token", prefs.getString("token", ""),
                "port", remote == null ? remotePort(prefs) : remote.port(), "devices", devices, "clients", devices.length(),
                "addresses", remoteAddresses, "connection", object("secure", secure,
                        "endpoint", prefs.getString("endpoint", ""), "fromEnvironment", false, "certificateConfigured", secure,
                        "keyConfigured", !prefs.getString("privateKey", "").isEmpty(), "certificateName", prefs.getString("certificateName", ""),
                        "keyName", prefs.getString("keyName", "")));
    }

    // What clients see of the host: the renderer's published state while it serves requests, otherwise the
    // Service's own chain (without the renderer's stage ids and epoch). The features follow the same split.
    private JSONObject remoteContent() {
        boolean renderer = rendererReady && events != null;
        JSONObject result = object("features", renderer
                        ? new JSONArray().put("origin").put("savePreset").put("irSync").put("sync1").put("irSelection").put("describe1").put("music1")
                        // history1: the history, slot and copySlot ops of sync1, without its id-addressed edits.
                        : new JSONArray().put("origin").put("music1").put("history1"),
                "audio", object("sampleRate", engine.getSampleRate(), "channelCount", engine.getChannelCount(), "routingChannelCount", engine.getChannelCount()));
        try {
            if (renderer && rendererState.has("pipeline")) {
                for (String key : new String[]{"masterBypass", "pipeline", "ids", "slot", "epoch"}) if (rendererState.has(key)) result.put(key, rendererState.get(key));
            } else result.put("masterBypass", masterBypass).put("pipeline", serviceRemotePipeline()).put("slot", slot);
        } catch (Exception error) { throw new IllegalArgumentException(error); }
        return result;
    }

    // Advances rev only when what clients see changes; a hello or get catches up after remote access starts.
    private void publishRemoteState() {
        if (remote == null || engine == null) return;
        String content = remoteContent().toString();
        if (content.equals(remoteContent)) return;
        remoteContent = content; remoteRev++;
        remote.broadcast(remoteState(null));
    }

    private JSONObject remoteState(Object seq) {
        JSONObject result = remoteContent();
        try {
            result.put("op", "state").put("rev", remoteRev).put("app", applicationVersion()).put("appName", "EffeTune").put("origin", "remote")
                    .put("effects", offeredEffects != null ? offeredEffects : packer.effectNames());
            if (seq != null) result.put("seq", seq);
        } catch (Exception error) { throw new IllegalArgumentException(error); }
        return result;
    }

    private JSONArray serviceRemotePipeline() {
        JSONArray shortPipeline = new JSONArray();
        for (int i = 0; i < pipeline.length(); i++) {
            JSONObject plugin = pipeline.optJSONObject(i);
            try {
                // Same shape as getSerializablePluginStateShort: routing as ch/ib/ob, omitted when unset.
                JSONObject parameters = plugin.getJSONObject("parameters"), state = new JSONObject(parameters.toString());
                for (String key : new String[]{"id", "type", "enabled", "channel", "inputBus", "outputBus", "ch", "ib", "ob"}) state.remove(key);
                if (!parameters.isNull("channel")) state.put("ch", parameters.get("channel"));
                if (!parameters.isNull("inputBus")) state.put("ib", parameters.get("inputBus"));
                if (!parameters.isNull("outputBus")) state.put("ob", parameters.get("outputBus"));
                state.put("nm", plugin.getString("name")).put("en", plugin.optBoolean("enabled", true)); shortPipeline.put(state);
            } catch (Exception error) { Log.w("EffeTuneRemote", "Cannot serialize effect state", error); }
        }
        return shortPipeline;
    }

    private void dispatchRemote(JSONObject request, Consumer<JSONObject> sendReply, BooleanSupplier current, BooleanSupplier writable) {
        String op = request.optString("op");
        // RemoteControlServer assembles putIR chunks into a cache file; the renderer reads it through remote.irRead.
        File upload = op.equals("putIR") ? new File(request.optString("file")) : null;
        request.remove("file");
        if (destroyed || !current.getAsBoolean()) { if (upload != null) upload.delete(); return; }
        Object seq = request.opt("seq");
        boolean music = RemoteControlServer.musicOperation(op);
        if (music) {
            remoteAck(sendReply, seq, true, null);
            if (handleNativeMusic(request, sendReply, current)) return;
        }
        if (op.equals("hello") && request.optInt("v") != 1) { remoteAck(sendReply, seq, false, "unsupported-version"); return; }
        if (op.equals("hello") || op.equals("get")) { publishRemoteState(); remoteAck(sendReply, seq, true, null); sendReply.accept(remoteState(seq)); return; }
        boolean renderer = rendererReady && events != null;
        // With the page attached every edit goes through its controller, as on the desktop, so derived
        // parameters (getWorkletPluginData) stay current. Without it the Service edits its own chain.
        if (!renderer) try {
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
                    replacePipeline(packer.prepareRecords(records, masterBypass, slot)); remoteRepack = true; changed(); send("pipeline-changed", snapshot()); remoteMutated(sendReply, seq); return;
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
                    packer.packRecord(record); replacePipeline(packer.prepareRecords(records, masterBypass, slot)); remoteRepack = true; changed(); send("pipeline-changed", snapshot()); remoteMutated(sendReply, seq); return;
                }
            } else if (op.equals("history") || op.equals("slot") || op.equals("copySlot")) {
                String command = op.equals("history") ? request.getString("dir").equals("undo") ? "pipeline.undo" : request.getString("dir").equals("redo") ? "pipeline.redo" : "invalid" : "pipeline." + op;
                command(object("command", command, "payload", request), (result, error) -> {
                    if (error != null) { remoteAck(sendReply, seq, false, error.code); return; }
                    remoteMutated(sendReply, seq); send("pipeline-changed", snapshot());
                }, false, current); return;
            } else if (op.equals("bypass")) {
                if (!(request.opt("on") instanceof Boolean)) throw new IllegalArgumentException("Invalid bypass");
                replacePipeline(packer.prepareRecords(new JSONArray(pipeline.toString()), request.getBoolean("on"), slot)); changed(); send("pipeline-changed", snapshot()); remoteMutated(sendReply, seq); return;
            }
        } catch (Exception error) { Log.w("EffeTuneRemote", "Rejected pipeline command", error); remoteAck(sendReply, seq, false, "invalid-op"); return; }
        if (!renderer) {
            if (upload != null) upload.delete();
            if (music) musicError(sendReply, seq, "unavailable", "Open EffeTune to browse the music library.");
            else remoteAck(sendReply, seq, false, "renderer-unavailable");
            return;
        }
        if (remotePending.size() >= 64) {
            if (upload != null) upload.delete();
            if (music) musicError(sendReply, seq, "unavailable", "Try again after the current requests finish."); else remoteAck(sendReply, seq, false, "busy");
            return;
        }
        String id = UUID.randomUUID().toString();
        boolean ir = op.equals("getIR") || op.equals("putIR");
        boolean mutating = op.equals("chain") || op.equals("params") || op.equals("bypass") || op.equals("edit") || op.equals("history") || op.equals("slot")
                || op.equals("copySlot") || op.equals("loadPreset") || op.equals("selectIR");
        remoteAuthority.put(id, current);
        if (ir) remoteTransfers.put(id, new RemoteTransfer(upload, op.equals("getIR") ? sendReply : null, writable, request.optString("id"), seq));
        remotePending.put(id, result -> {
            if (music) {
                if (result.optBoolean("ok")) sendReply.accept(object("op", "musicResult", "seq", seq, "ok", true, "result", result.optJSONObject("data")));
                else sendReply.accept(object("op", "musicResult", "seq", seq, "ok", false, "error", result.optJSONObject("error"),
                        "outcome", result.opt("outcome"), "playback", result.optJSONObject("playback")));
                return;
            }
            if (!result.optBoolean("ok")) { remoteAck(sendReply, seq, false, result.optString("error", "operation-failed")); return; }
            if (mutating) { remoteMutated(sendReply, seq, result.optJSONArray("skipped")); return; }
            remoteAck(sendReply, seq, true, null);
            try {
                JSONObject data = null;
                if (op.equals("listPresets")) data = object("op", "presets", "names", result.optJSONArray("names"));
                else if (op.equals("getPreset")) data = object("op", "preset", "name", result.optString("name"), "pipeline", result.optJSONArray("pipeline"));
                else if (op.equals("listIRs")) data = object("op", "irs", "items", result.optJSONArray("items"));
                else if (op.equals("describeEffects")) data = object("op", "effects", "effects", result.optJSONArray("effects"));
                else if (op.equals("presets")) data = object("op", "presets", "presets", result.optJSONObject("presets"));
                if (data != null) { if (seq != null) data.put("seq", seq); sendReply.accept(data); }
            } catch (Exception error) { Log.w("EffeTuneRemote", "Cannot encode response", error); }
        });
        // IR transfers move up to 64 MiB through the bridge, so they get the desktop's 120 s limit.
        control.postDelayed(() -> {
            Consumer<JSONObject> pending = remotePending.get(id);
            cancelRemoteRequest(id);
            if (pending == null) return;
            if (music) musicError(sendReply, seq, "unavailable", "The music request did not finish in time.");
            else pending.accept(object("ok", false, "error", "renderer-unavailable"));
        }, ir ? 120_000 : 20_000);
        send("remote-request", object("requestId", id, "message", request));
    }

    private static final class RemoteTransfer {
        final File upload; final Consumer<JSONObject> send; final BooleanSupplier writable; final String irId; final Object seq;
        RemoteTransfer(File upload, Consumer<JSONObject> send, BooleanSupplier writable, String irId, Object seq) {
            this.upload = upload; this.send = send; this.writable = writable; this.irId = irId; this.seq = seq;
        }
    }

    // One getIR part from the renderer: forward it as the desktop's irChunk, and reply once the socket can take more.
    private void sendIrChunk(JSONObject args, Reply reply) throws Exception {
        String id = args.getString("requestId");
        requireRemoteAuthority(id);
        RemoteTransfer transfer = remoteTransfers.get(id);
        if (transfer == null || transfer.send == null) throw new HostError("unauthorized", "Remote access changed. Reconnect and try again.");
        JSONObject chunk = object("op", "irChunk", "id", transfer.irId, "name", args.getString("name"), "ext", args.getString("ext"),
                "index", args.getInt("index"), "total", args.getInt("total"), "bytes", args.getLong("bytes"), "data", args.getString("data"));
        if (transfer.seq != null) chunk.put("seq", transfer.seq);
        transfer.send.accept(chunk);
        control.post(new Runnable() {
            @Override public void run() {
                if (remoteTransfers.get(id) != transfer || transfer.writable.getAsBoolean()) reply.complete(new JSONObject(), null);
                else control.postDelayed(this, 20);
            }
        });
    }

    private void remoteMutated(Consumer<JSONObject> sendReply, Object seq) { remoteMutated(sendReply, seq, null); }

    // Mutating ops acknowledge with the state revision that contains them, as on the desktop.
    private void remoteMutated(Consumer<JSONObject> sendReply, Object seq, JSONArray skipped) {
        if (seq == null) return;
        JSONObject value = object("op", "ack", "seq", seq, "ok", true, "rev", remoteRev);
        if (skipped != null && skipped.length() > 0) try { value.put("skipped", skipped); } catch (Exception ignored) { }
        sendReply.accept(value);
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
        RemoteTransfer transfer = remoteTransfers.remove(id);
        if (transfer != null && transfer.upload != null) transfer.upload.delete();
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
                        requireMainOutput();
                        int index = queue.indexOfId(request.getInt("id"));
                        if (index < 0) throw new IllegalArgumentException("Missing queue entry");
                        selectQueueEntry(index, false);
                        if (!sourceReady) { changed(); musicError(sendReply, seq, "unavailable", "The player is unavailable."); return true; }
                        command = "playback.play"; break;
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
                promoteReachedNextTrack();
                String action = request.getString("action");
                if (action.equals("clear")) {
                    clearPlaybackQueue();
                } else if (action.equals("delete")) {
                    int index = queue.indexOfId(request.getInt("id"));
                    if (index < 0) throw new IllegalArgumentException("Missing queue entry");
                    boolean resume = playing; queue.delete(index);
                    queueRevision++;
                    if (index < queueIndex) queueIndex--;
                    else if (index == queueIndex) {
                        if (queueIndex < queue.length()) selectQueueEntry(queueIndex, resume);
                        else clearCurrentTrack();
                    }
                    reconcileNextTrack();
                } else throw new IllegalArgumentException("Invalid queue action");
                saveQueue(); changed(); sendReply.accept(object("op", "musicResult", "seq", seq, "ok", true, "result", musicPlayback(0, 100))); return true;
            }
        } catch (Exception error) { Log.w("EffeTuneRemote", "Rejected music request", error); musicError(sendReply, seq, "invalidRequest", "Choose a valid track or playback control."); return true; }
        return false;
    }

    private JSONObject musicPlayback(int start, int count) throws Exception {
        return musicPlayback(start, count, null);
    }

    static int remainingBridgeReplyBytes(String id, JSONObject result) {
        String envelope = object("version", 1, "id", id, "ok", true, "result", result).toString();
        return 1024 * 1024 - io.netty.buffer.ByteBufUtil.utf8Bytes(envelope);
    }

    private JSONObject musicPlayback(int start, int count, String pwaBridgeId) throws Exception {
        if (start < 0 || count < 1 || count > 500) throw new IllegalArgumentException("Invalid queue page");
        JSONArray entries = new JSONArray();
        JSONObject current = queueIndex >= 0 && queueIndex < queue.length() ? musicTrack(queue.getJSONObject(queueIndex)) : null;
        JSONObject capabilities = new JSONObject();
        for (String action : new String[]{"play", "pause", "stop", "next", "previous", "seek", "seekId", "delete", "clear", "repeat", "shuffle", "volume", "mute"}) capabilities.put(action, true);
        JSONObject state = object("playerId", "local", "transportState", playing ? "Playing" : playbackStopped || source == null ? "Stopped" : "Paused", "currentId", current == null ? 0 : current.getInt("id"),
                "currentTrack", current == null ? JSONObject.NULL : current, "position", currentPosition() / 1_000_000.0, "duration", durationUs / 1_000_000.0,
                "repeat", !repeat.equals("off"), "shuffle", shuffle, "volume", volume * 100, "volumeMax", 100, "mute", muted, "capabilities", capabilities,
                "queue", entries, "start", start, "total", queue.length(), "numberReturned", count);
        int remaining = 0;
        if (pwaBridgeId != null) {
            state.put("revision", revision);
            remaining = remainingBridgeReplyBytes(pwaBridgeId, state);
            if (remaining < 0) throw new HostError("too-large", "The current track details are too large to send.");
        }
        for (int i = start; i < queue.length() && entries.length() < count; i++) {
            JSONObject source = queue.getJSONObject(queueIndexAt(i)), item = musicTrack(source);
            if (pwaBridgeId != null) {
                JSONObject metadata = source.optJSONObject("metadata");
                item.put("uri", source.opt("uri")).put("libraryTrackId", source.opt("libraryTrackId"))
                        .put("artwork", metadata == null ? "" : metadata.optString("artworkUrl"));
                remaining -= io.netty.buffer.ByteBufUtil.utf8Bytes(item.toString()) + (entries.length() == 0 ? 0 : 1);
                if (remaining < 0) {
                    if (entries.length() == 0) throw new HostError("too-large", "The track details are too large to send.");
                    break;
                }
            }
            entries.put(item);
        }
        state.put("numberReturned", entries.length());
        return state;
    }
    private JSONObject musicTrack(JSONObject entry) {
        JSONObject tags = entry.optJSONObject("metadata");
        double duration = tags == null ? Double.NaN : tags.optDouble("duration", Double.NaN);
        if (!Double.isFinite(duration) || duration < 0) duration = entry.optDouble("duration", 0);
        return object("id", entry.optInt("queueEntryId"), "title", musicTag(entry, tags, "title"),
                "artist", musicTag(entry, tags, "artist"), "album", musicTag(entry, tags, "album"),
                "duration", Double.isFinite(duration) && duration >= 0 ? duration : 0);
    }

    private static String musicTag(JSONObject entry, JSONObject tags, String key) {
        String value = tags == null || tags.isNull(key) ? "" : tags.optString(key, "");
        return value.isEmpty() ? entry.optString(key, "") : value;
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
        skipDisplayDsp = settings.optBoolean("skipDisplayDspWhenHidden", skipDisplayDsp);
        engine.setPowerSettings((float) Math.pow(10, threshold / 20), 60, temporalMustProcess || !previews.isEmpty() || mode.equals("continuous"));
    }

    private void observePower() {
        if (!running) return;
        float[] observation = engine.getPowerObservation();
        if (observation.length < 5 || observation[0] <= lastPowerSequence) return;
        lastPowerSequence = observation[0];
        String next = observation[4] != 0 ? "MONITORING" : "ACTIVE";
        if (!next.equals(powerState)) { powerState = next; changed(); }
        // A metered measurement input is not processed input, so its signal cannot hold off suspension.
        if (playing || measurement.isRunning() || meterChannel >= 0 || temporalMustProcess || !previews.isEmpty()) return;
        double deadline = !microphone ? powerMode.equals("continuous") ? 30 : powerMode.equals("maximum") ? 3 : 15
                : powerMode.equals("maximum") ? suspendDelay : Double.POSITIVE_INFINITY;
        if (observation[3] < deadline) return;
        if (microphone) { engine.setInputDevice(-1); acquiredInputDevice = -1; microphone = false; }
        engine.stop(); running = false; autoSuspended = true; powerState = "SUSPENDED";
        audioManager.abandonAudioFocusRequest(focus); updateRemoteLifetime(); changed();
    }
    private boolean unprocessedInputSupported() { return "true".equals(audioManager.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED)); }

    private static final String NOTIFICATION_DISMISSED = "notification.dismissed";
    private static final String PLAYBACK_CHANNEL = "audio";
    private static final String NOTIFICATION_TEXT_KEY = "notificationText";
    private JSONObject notificationText = new JSONObject();

    private void restoreNotificationText() {
        try {
            notificationText = new JSONObject(getSharedPreferences("audio", MODE_PRIVATE).getString(NOTIFICATION_TEXT_KEY, "{}"));
        } catch (JSONException error) {
            Log.w("EffeTune", "Cannot restore playback notification text", error);
        }
        updatePlaybackChannel();
    }

    private void saveNotificationText(JSONObject text) {
        notificationText = text;
        getSharedPreferences("audio", MODE_PRIVATE).edit().putString(NOTIFICATION_TEXT_KEY, text.toString()).apply();
        updatePlaybackChannel();
    }

    private String playbackLabel() { return notificationText.optString("playback", "Audio playback"); }

    private void updatePlaybackChannel() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = manager.getNotificationChannel(PLAYBACK_CHANNEL);
        String name = playbackLabel();
        if (channel == null) {
            manager.createNotificationChannel(new NotificationChannel(PLAYBACK_CHANNEL, name, NotificationManager.IMPORTANCE_LOW));
        } else if (!name.contentEquals(channel.getName())) {
            channel.setName(name);
            manager.createNotificationChannel(channel);
        }
    }

    private void showNotification(boolean promote) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String action = playing ? "playback.pause" : "playback.play";
        PendingIntent toggle = PendingIntent.getService(this, 1, new Intent(this, AudioService.class).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, AudioService.class).setAction("audio.stop"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent dismissed = PendingIntent.getService(this, 3, new Intent(this, AudioService.class).setAction(NOTIFICATION_DISMISSED), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String content = source == null ? notificationText.optString("processing", "Audio processing")
                : playbackMetadata == null ? playbackLabel() : playbackMetadata.getString(MediaMetadata.METADATA_KEY_TITLE);
        String toggleLabel = playing ? notificationText.optString("pause", "Pause") : notificationText.optString("play", "Play");
        Notification.Builder builder = new Notification.Builder(this, PLAYBACK_CHANNEL).setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("EffeTune").setContentText(content)
                .setContentIntent(open).setDeleteIntent(dismissed).setOngoing(promote || foreground).setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, toggleLabel, toggle).build())
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, notificationText.optString("stop", "Stop"), stop).build())
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1));
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q && source != null && playbackMetadata != null) {
            builder.setContentTitle(playbackMetadata.getText(MediaMetadata.METADATA_KEY_TITLE))
                    .setContentText(playbackMetadata.getText(MediaMetadata.METADATA_KEY_ARTIST))
                    .setLargeIcon(playbackMetadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART));
        }
        Notification notification = builder.build();
        if (promote) {
            int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
            if (microphone) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            if (Build.VERSION.SDK_INT >= 29) startForeground(1, notification, types);
            else startForeground(1, notification);
            foreground = true; foregroundMicrophone = microphone;
        } else getSystemService(NotificationManager.class).notify(1, notification);
        notified = true;
    }

    private static final String[] VISUALIZER_CHANNEL_PAIRS = {"34", "56", "78", "910", "1112", "1314", "1516"};

    // Same source contract as the desktop engine's setVisualizerSources message.
    private void setVisualizerSources(JSONArray list) throws Exception {
        ArrayList<String> types = new ArrayList<>();
        ArrayList<float[]> parameters = new ArrayList<>();
        ArrayList<Integer> taps = new ArrayList<>(), hashes = new ArrayList<>(), channels = new ArrayList<>();
        ArrayList<Float> gains = new ArrayList<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject source = list.getJSONObject(i);
            long tap = source.optLong("tapId", 0);
            JSONArray values = source.optJSONArray("params");
            int[] channel = visualizerChannels(source.opt("channel"));
            if (tap < 0xf0000000L || tap > 0xffffffffL || values == null || channel == null) continue;
            float[] packed = new float[values.length()];
            for (int j = 0; j < packed.length; j++) packed[j] = (float) values.getDouble(j);
            float gain = (float) source.optDouble("gain", 1);
            types.add(source.optString("type", ""));
            parameters.add(packed);
            taps.add((int) tap);
            hashes.add((int) source.optLong("paramsHash", 0));
            channels.add(channel[0]); channels.add(channel[1]);
            gains.add(gain > 0 ? gain : 1);
        }
        int[] tapArray = new int[taps.size()], hashArray = new int[taps.size()], channelArray = new int[channels.size()];
        float[] gainArray = new float[taps.size()];
        for (int i = 0; i < tapArray.length; i++) { tapArray[i] = taps.get(i); hashArray[i] = hashes.get(i); gainArray[i] = gains.get(i); }
        for (int i = 0; i < channelArray.length; i++) channelArray[i] = channels.get(i);
        if (engine.setVisualizerSources(types.toArray(new String[0]), parameters.toArray(new float[0][]), tapArray, hashArray, channelArray, gainArray) < 0)
            throw new IllegalArgumentException("Invalid visualizer sources");
        visualizerTaps.clear(); visualizerTaps.addAll(taps);
    }

    /** Left and right channel indexes, or null for an unsupported selection. */
    private static int[] visualizerChannels(Object selection) {
        if (!(selection instanceof String)) return new int[] {0, 1};
        String value = (String) selection;
        if (value.equals("L")) return new int[] {0, 0};
        if (value.equals("R")) return new int[] {1, 1};
        for (int i = 0; i < VISUALIZER_CHANNEL_PAIRS.length; i++)
            if (VISUALIZER_CHANNEL_PAIRS[i].equals(value)) return new int[] {2 + 2 * i, 3 + 2 * i};
        if (!value.matches("[1-9]|1[0-6]")) return null;
        int channel = Integer.parseInt(value) - 1;
        return new int[] {channel, channel};
    }

    private byte[] validatedTelemetry(byte[] data) {
        if (data == null) return null;
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        for (int offset = 0; offset < data.length;) {
            if (data.length - offset < 16) return null;
            int bytes = (16 + Short.toUnsignedInt(buffer.getShort(offset + 12)) + 3) & ~3;
            int tap = buffer.getInt(offset + 4);
            if (bytes > data.length - offset || !instanceTypes.containsKey(Integer.toString(tap)) && !visualizerTaps.contains(tap)) return null;
            offset += bytes;
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
            String id = Integer.toString(handle);
            if (!instanceTypes.containsKey(id)) continue;
            String pluginType = instanceTypes.get(id), type, causeName;
            if (pluginType.equals("TubeSimulatorPlugin")) { type = "tubeSimulatorCircuitFault"; causeName = cause == 1 ? "feedbackOscillation" : cause == 2 ? "processingSafetyFailure" : "none"; }
            else if (pluginType.equals("AdaptivePredictionEffectPlugin")) { type = "adaptivePredictionFault"; causeName = cause == 1 ? "numericalFailure" : "none"; }
            else continue;
            runtimeEvents.put(handle, signature);
            send("dsp-runtime-event", object("revision", revision, "type", type, "pluginId", Integer.parseInt(id), "pluginType", pluginType,
                    "instanceEpoch", instanceEpoch, "generation", generation, "latched", latched != 0, "cause", causeName));
        }
    }

    /** Mirrors the desktop host: CPU once per measured second, latency whenever it changes. */
    private void publishPipelineStats() {
        if (events == null || !visible) return;
        double[] stats = engine.readPipelineStats();
        if (stats == null || stats.length < 2) return;
        String latency = (long) stats[1] + ":" + masterBypass;
        if (stats[0] < 0 && latency.equals(reportedLatency)) return;
        reportedLatency = latency;
        JSONObject value = object("latencySamples", (long) stats[1], "compensated", !masterBypass, "sampleRate", engine.getSampleRate());
        if (stats[0] >= 0) try { value.put("cpuAverage", stats[0]); } catch (Exception ignored) { }
        send("pipeline-stats", value);
    }

    /** Desktop audioProcessingOverload: forwarded whether or not the UI is visible, so a clear is never lost. */
    private void publishOverload() {
        int overload = engine.takeOverload();
        if (overload >= 0 && events != null) send("audio-overload", object("active", overload != 0));
    }

    /** Web and desktop rule: bypassed while the setting is on and the page or the effect display is hidden. */
    private void applyDisplayBypass() {
        boolean bypass = skipDisplayDsp && (!visible || !telemetryVisible || displayHidden);
        if (engine == displayBypassEngine && bypass == displayBypass) return;
        // A failed change is retried on the next tick; a new engine starts without the bypass.
        if (engine.setDisplayBypass(bypass) < 0) return;
        displayBypassEngine = engine; displayBypass = bypass;
    }

    private final HashSet<String> midiMeters = new HashSet<>();
    private final HashMap<Integer, JSONObject> sampleStreams = new HashMap<>();
    private final HashMap<Integer, JSONObject> parallelSampleStreams = new HashMap<>();
    private boolean sampleTickScheduled;

    private void restoreSamplerControls() {
        midiMeters.removeIf(id -> !"SoundFontPlayerPlugin".equals(instanceTypes.get(id)));
        for (String id : midiMeters) engine.setMidiMetering(instances.get(id), true);
        scheduleSampleStreams();
    }

    private void scheduleSampleStreams() {
        if (!sampleTickScheduled && !destroyed && !featurePage) {
            sampleTickScheduled = true;
            control.post(sampleTick);
        }
    }

    private final Runnable sampleTick = new Runnable() {
        @Override public void run() {
            sampleTickScheduled = false;
            if (destroyed || engine == null || events == null || featurePage) return;
            try {
                boolean active = observeSampleStreams(0);
                if (parallelActive) active |= observeSampleStreams(1);
                if (active && running) {
                    sampleTickScheduled = true;
                    control.postDelayed(this, 10);
                }
            } catch (Exception error) { Log.w("EffeTuneAudio", "Cannot observe instrument streams", error); }
        }
    };

    private boolean observeSampleStreams(int branch) throws Exception {
        HashMap<Integer, JSONObject> streams = branch == 0 ? sampleStreams : parallelSampleStreams;
        HashMap<String, String> types = branch == 0 ? instanceTypes : parallelTypes;
        AssetTransfers transfers = branch == 0 ? assets : parallelAssets;
        long[] records = engine.sampleStreams(branch);
        HashSet<Integer> retired = new HashSet<>(streams.keySet());
        for (int i = 0; i < records.length; i += 4) {
            int id = (int) records[i];
            long generation = records[i + 1], token = records[i + 2];
            retired.remove(id);
            JSONObject stream = streams.get(id);
            if (stream == null || stream.getLong("generation") != generation || stream.getLong("token") != token) {
                stopSampleStream(streams, id);
                String key = types.get(Integer.toString(id)) + ":" + id + ":0";
                AssetTransfers.Notice notice = transfers.resolve(key, token, false, false);
                if (notice == null) continue;
                stream = object("branch", branch, "pluginId", id, "generation", generation, "token", token,
                        "operationRevision", notice.operationRevision());
                streams.put(id, stream);
                sendSampleEvent(stream, "sfzStreamReady");
            }
            stream.put("preparing", (records[i + 3] & 2) != 0);
            if ((records[i + 3] & 1) != 0 && stream.getLong("operationRevision") >= 0)
                sendSampleEvent(stream, "sfzStreamPollNeeded");
        }
        for (int id : retired) stopSampleStream(streams, id);
        return records.length > 0;
    }

    private void sendSampleEvent(JSONObject stream, String type) throws Exception {
        send("sfz-stream", new JSONObject(stream.toString()).put("type", type));
    }

    private void stopSampleStream(HashMap<Integer, JSONObject> streams, int id) throws Exception {
        JSONObject stream = streams.remove(id);
        if (stream != null) sendSampleEvent(stream, "sfzStreamStop");
    }

    private void finishSampleAsset(int id, JSONObject stream, int state, boolean rejected) throws Exception {
        int branch = stream.getInt("branch");
        String key = (branch == 0 ? instanceTypes : parallelTypes).get(Integer.toString(id)) + ":" + id + ":0";
        AssetTransfers.Notice notice = (branch == 0 ? assets : parallelAssets).resolve(key, stream.getLong("token"), rejected, true);
        if (notice == null) return;
        if (branch == 0) finishSelectedAsset(id, 0, notice, rejected);
        send("asset-state", object("branch", branch, "pluginId", id, "slot", 0, "state", state, "rejected", rejected,
                "reason", rejected ? "sample-read" : null, "operationRevision", stream.getLong("operationRevision")));
        if (branch == 1 && rejected) stopBlindTest(true);
    }

    private JSONObject sfzCommand(String name, JSONObject args) throws Exception {
        int branch = assetBranch(args);
        HashMap<Integer, JSONObject> streams = branch == 0 ? sampleStreams : parallelSampleStreams;
        HashMap<String, String> types = branch == 0 ? instanceTypes : parallelTypes;
        int id = args.getInt("pluginId");
        String key = Integer.toString(id);
        Integer instance = (branch == 0 ? instances : parallelInstances).get(key);
        if (name.equals("sfz.midiMetering")) {
            if (instance != null && !"SoundFontPlayerPlugin".equals(types.get(key))) return object("ok", false);
            boolean enabled = args.getBoolean("enabled");
            if (branch == 0) {
                if (enabled) midiMeters.add(key); else midiMeters.remove(key);
            }
            return object("ok", instance == null || engine.setMidiMetering(instance, enabled, branch) == 0);
        }
        if (instance == null) return object("ok", false);
        if (name.equals("sfz.preparationContext")) {
            double[] c = engine.sfzPreparationContext(instance, branch);
            return c.length == 4 ? object("ok", true, "context", object("sampleRate", c[0],
                    "processingChannels", c[1], "maxFrames", c[2], "minimumPhysicalBpm", c[3])) : object("ok", false);
        }
        if (name.equals("sfz.resume")) {
            // The new page owns a new JS revision of the same persisted bank.
            control.removeCallbacks(sampleTick);
            sampleTick.run();
            JSONObject stream = streams.get(id), slotState = slots.get(slot);
            JSONObject refs = branch == 1 ? parallelRefs : slotState == null ? null : slotState.optJSONObject("assetRefs");
            JSONObject ref = refs == null ? null : refs.optJSONObject(types.get(key) + ":" + id + ":0");
            if (stream == null || ref == null || !args.getString("signature").equals(ref.optString("externalAssetSignature")))
                return object("ok", false);
            AssetTransfers.Notice notice = (branch == 0 ? assets : parallelAssets).resolve(types.get(key) + ":" + id + ":0",
                    stream.getLong("token"), false, false);
            if (notice == null || stream.optBoolean("preparing") && notice.historyEntry()) return object("ok", false);
            if (!args.has("operationRevision")) return object("ok", true, "token", stream.getLong("token"));
            if (args.getLong("token") != stream.getLong("token")) return object("ok", false);
            stream.put("operationRevision", args.getLong("operationRevision"));
            return object("ok", true, "stream", new JSONObject(stream.toString()).put("type", "sfzStreamReady"));
        }
        JSONObject stream = streams.get(id);
        long generation = args.getLong("generation"), token = args.getLong("token");
        if (stream == null || stream.getLong("generation") != generation || stream.getLong("token") != token ||
                stream.getLong("operationRevision") != args.getLong("operationRevision") || !args.isNull("replayEpoch"))
            return object("ok", false);
        if (name.equals("sfz.poll")) {
            long[] values = engine.pollSamplePages(instance, generation, token, branch);
            JSONArray requests = new JSONArray();
            JSONObject result = object("ok", values.length > 0, "requests", requests);
            if (values.length > 1) {
                // The page provider starts polling after its initial sample publication completes.
                stream.put("supplied", true);
                result.put("limited", values[1] != 0).put("readiness", object("generation", values[2],
                        "scope", values[3], "admittedFrames", values[4], "readyAheadFrames", values[5],
                        "plannedPages", values[6], "pendingPages", values[7]));
                for (int i = 8; i < values.length; i += 3)
                    requests.put(object("generation", values[i], "sample", values[i + 1], "pageIndex", values[i + 2]));
            }
            return result;
        }
        if (name.equals("sfz.failed")) {
            boolean ok = engine.failSampleStream(instance, generation, token, branch) >= 0;
            if (ok) finishSampleAsset(id, stream, 0, true);
            return object("ok", ok);
        }
        if (name.equals("sfz.publish")) {
            JSONObject page = args.getJSONObject("page");
            int frames = page.getInt("frames"), channels = page.getInt("channels"), sample = page.getInt("sample");
            long index = page.getLong("pageIndex");
            if (page.getLong("generation") != generation || frames < 1 || frames > 4096 ||
                    (channels != 1 && channels != 2) || sample < 0 || index < 0) return object("ok", false);
            String encoded = page.getString("pcm");
            int bytes = frames * channels * Float.BYTES;
            if (encoded.length() != ((bytes + 2) / 3) * 4) return object("ok", false);
            byte[] raw = Base64.decode(encoded, Base64.DEFAULT);
            if (raw.length != bytes) return object("ok", false);
            float[] pcm = new float[frames * channels];
            ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(pcm);
            int status = engine.publishSamplePage(instance, generation, token, sample, index, pcm,
                    frames, channels, page.optBoolean("resident"), branch);
            if (status > 0) finishSampleAsset(id, stream, status, false);
            return object("ok", status >= 0);
        }
        throw new HostError("unsupported-operation", "This instrument operation is unavailable.");
    }

    private void publishAssetNotices() {
        publishAssetNotices(0);
        if (parallelActive) publishAssetNotices(1);
    }

    private void publishAssetNotices(int branch) {
        int[] values = engine.readAssetNotices(branch);
        if (values == null) return;
        for (int i = 0; i + 5 < values.length; i += 6) {
            int id = values[i], assetSlot = values[i + 1];
            String type = (branch == 0 ? instanceTypes : parallelTypes).get(Integer.toString(id));
            if (type == null) continue;
            boolean rejected = values[i + 3] != 0;
            boolean completed = values[i + 5] != 0;
            try {
                AssetTransfers.Notice notice = (branch == 0 ? assets : parallelAssets).resolve(type + ":" + id + ":" + assetSlot,
                        Integer.toUnsignedLong(values[i + 4]), rejected, completed);
                if (notice == null) continue;
                if (branch == 0 && completed) finishSelectedAsset(id, assetSlot, notice, rejected);
                if (notice.operationRevision() >= 0) {
                    send("asset-state", object("branch", branch, "pluginId", id, "slot", assetSlot,
                            "state", values[i + 2], "rejected", rejected,
                            "operationRevision", notice.operationRevision()));
                }
                if (branch == 1 && (rejected || (values[i + 2] & 255) == 4)) {
                    stopBlindTest(true);
                    return;
                }
            } catch (Exception error) {
                Log.w("EffeTuneAudio", "Cannot publish prepared asset state", error);
            }
        }
    }

    private void persistPipelineEdit() {
        lastPipelineRevision = revision + 1;
        persistSlots();
    }

    private void persistSlots() {
        JSONObject saved = new JSONObject();
        for (String key : slots.keySet()) try { saved.put(key, slots.get(key)); } catch (Exception ignored) { }
        String serialized = saved.toString();
        pageSlotRecords = io.netty.buffer.ByteBufUtil.utf8Bytes(serialized) > 512 * 1024;
        SharedPreferences.Editor editor = getSharedPreferences("audio", MODE_PRIVATE).edit().putString("slots", serialized);
        if (slots.containsKey(slot)) editor.putString("pipeline", slots.get(slot).toString());
        editor.apply();
    }

    private final Runnable scoreOutputTick = new Runnable() {
        @Override public void run() {
            if (!playing || loadedScore == null || engine == null) return;
            if (midi.score.hasOutput()) try {
                midi.score.pump(engine.scorePosition(), speed);
            } catch (IOException | RuntimeException error) {
                Log.w("EffeTuneMidi", "Cannot send prepared score to MIDI output", error);
                midi.score.setPort(null);
            }
            control.postDelayed(this, 30);
        }
    };

    private void midiEvent(String name, JSONObject value) {
        try {
            String device = value.optString("name", value.optString("id"));
            if (name.equals("midi-disconnected") && !"output".equals(value.optString("type")))
                mappings.disconnect(value.optString("key", device));
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
                long previousRevision = revision;
                reconcileOutput();
                outputStats = engine.observeOutput();
                networkOutput.tick(engine, revision, outputStats, parallelActive);
                discardRevokedRemoteRequests();
                try { mappings.tick(SystemClock.elapsedRealtime(), System.currentTimeMillis()); } catch (Exception error) { Log.w("EffeTuneMidi", "Scheduled mapping failed", error); }
                observePower(); publishAssetNotices();
                if (!featurePage) {
                    publishRuntimeEvents();
                    publishPipelineStats();
                }
                publishOverload(); applyDisplayBypass();
                if (meterChannel >= 0 && microphone && visible) {
                    float peak = engine.getMeterLevel();
                    double level = peak > 0 ? 20 * Math.log10(peak) : -120;
                    send("measurement.level", object("inputLevelDb", level, "unprocessed", unprocessedInputSupported(), "condition", unprocessedInputSupported() ? "unprocessed" : "processed"));
                }
                if (remote != null && Build.VERSION.SDK_INT >= 37 && checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") != PackageManager.PERMISSION_GRANTED) updateRemoteLifetime();
                if (microphone && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    if (meterChannel >= 0) measurementDevicesLost();
                    measurement.invalidate(engine); engine.setInputDevice(-1); acquiredInputDevice = -1; inputDevice = -1; microphone = false; changed();
                }
                if (promoteReachedNextTrack()) changed();
                // Buffered audio also confirms a successful selection while playback is paused.
                if (!failedEntries.isEmpty() && sourceReady && (loadedScore != null || engine.getQueuedFrames() > 0
                        || engine.getRenderedFrames() > renderStart)) reportSkippedTracks();
                if (playing && (loadedScore != null ? engine.takeScoreEnded() : decoderEnded && engine.getQueuedFrames() == 0)) {
                    decoderEnded = false;
                    try { advanceQueue(1, true, false); changed(); } catch (Exception error) { Log.w("EffeTuneQueue", "Cannot play the next track", error); pause(false); }
                }
                if (filePlaying() && loadedScore == null) {
                    long frame = engine.getRenderedFrames();
                    boolean stalled = frame == lastPcmFrame;
                    lastPcmFrame = frame;
                    if (pcmStalled != stalled) {
                        pcmStalled = stalled;
                        changed();
                    }
                } else if (revision == previousRevision && playing && loadedScore != null && scorePreparing && engine.scorePosition() >= 0)
                    changed();
                checkpointPlaybackPosition();
                if (!telemetryScheduled && telemetryWanted()) { telemetryScheduled = true; control.post(telemetryTick); }
            }
            control.postDelayed(this, 100);
        }
    };

    private boolean telemetryScheduled;
    private boolean telemetryWanted() { return engine != null && visible && telemetryVisible && events != null; }

    // Forwards telemetry at the Session generation rate (30 Hz) only while the UI shows it; the 100 ms tick restarts it.
    private final Runnable telemetryTick = new Runnable() {
        @Override public void run() {
            if (!telemetryWanted()) { telemetryScheduled = false; return; }
            double[] clock = engine.getVisualClock();
            publishTelemetry(clock);
            publishSpectrum(clock);
            control.postDelayed(this, 33);
        }
    };

    private static final String[] TELEMETRY_TAP_STAGES = {"pipeline", "local", "send", "network"};

    // The desktop host's visual clock fields, plus the output latency and the applied output delay,
    // which the desktop reports in its own messages.
    private JSONObject withVisualClock(JSONObject message, double[] clock) throws JSONException {
        if (clock != null && clock.length == 3)
            message.put("clockPipelineFrame", clock[0]).put("clockTimeNs", clock[1]).put("outputLatencyFrames", clock[2]);
        return message.put("outputDelayFrames", engine.getAppliedOutputDelay());
    }

    // One desktop dspTelemetry message per packet; see NativeEngine::telemetryPackets for the header.
    private void publishTelemetry(double[] clock) {
        byte[] data = engine.readTelemetryPackets();
        if (data == null) return;
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        try {
            for (int offset = 0; data.length - offset >= 40;) {
                int bytes = buffer.getInt(offset + 24), stage = buffer.getInt(offset + 32);
                if (bytes < 0 || bytes > data.length - offset - 40) return;
                byte[] packet = validatedTelemetry(Arrays.copyOfRange(data, offset + 40, offset + 40 + bytes));
                if (packet != null && packet.length > 0) send("telemetry", withVisualClock(object("revision", revision,
                        "packet", Base64.encodeToString(packet, Base64.NO_WRAP), "endFrame", buffer.getLong(offset),
                        "mixerEndFrame", buffer.getLong(offset + 8), "contextFrameOffset", 0, "routeRevision", buffer.getLong(offset + 16),
                        "droppedFrames", Integer.toUnsignedLong(buffer.getInt(offset + 28)),
                        "visualizerTapStage", TELEMETRY_TAP_STAGES[stage >= 0 && stage < 4 ? stage : 0]), clock));
                offset += 40 + bytes;
            }
        } catch (JSONException error) { Log.w("EffeTuneTelemetry", "Telemetry dropped", error); }
    }

    private static JSONObject spectrumAnalysis(double[] f, int base, double rate) {
        return object("highQuality", true, "sampleRate", rate, "points", 12, "hopSamples", f[base + 2],
                "generation", f[base], "captureEndSample", f[base + 5], "frameIndex", f[base + 1],
                "firstValidIndex", f[base + 3], "validCellCount", f[base + 4], "minFrequency", 20, "maxFrequency", 40000,
                "binCount", 2048, "cellCount", 2048, "flags", 0, "timeSeconds", f[base + 5] / rate);
    }

    // One desktop spectrumOverlay message per frame; see packSpectrumFrame in native_engine.cpp for the layout.
    private void publishSpectrum(double[] clock) {
        byte[] data = engine.drainSpectrum();
        if (data == null) return;
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        try {
            for (int offset = 0; data.length - offset >= 188;) {
                double[] f = new double[23];
                for (int i = 0; i < 23; i++) f[i] = buffer.getDouble(offset + 8 * i);
                long bytes = 4L * Integer.toUnsignedLong(buffer.getInt(offset + 184));
                offset += 188;
                if (bytes > data.length - offset) return;
                boolean compare = f[9] != 0, hq = f[10] != 0;
                double rate = f[5];
                if (!(rate > 0)) { offset += (int) bytes; continue; }
                JSONObject timing = object("version", 1, "generation", f[1], "frameIndex", f[2], "captureEndFrame", f[6],
                        "windowAgeFrames", hq ? 8192 : 2048,
                        "completionFrames", hq ? 48 + Math.max(2048L, ((long) rate + 29) / 30) / 16 * 16 : 0L,
                        "tapDelayFrames", f[4]);
                JSONObject message = object("type", "spectrumOverlay", "branch", 0, "mode", compare ? "compare" : "after",
                        "quality", hq ? "hq" : "normal", "spectrumPluginId", f[0], "endFrame", f[7], "routeRevision", f[8],
                        "sampleRate", rate, "time", f[7] / rate, "timing", timing,
                        "packet", Base64.encodeToString(data, offset, (int) bytes, Base64.NO_WRAP));
                if (!hq) message.put("bufferPosition", f[3]);
                else {
                    message.put("outputSpectrum", spectrumAnalysis(f, 17, rate));
                    if (compare) message.put("inputSpectrum", spectrumAnalysis(f, 11, rate));
                }
                send("spectrum-overlay", withVisualClock(message, clock));
                offset += (int) bytes;
            }
        } catch (JSONException error) { Log.w("EffeTuneTelemetry", "Spectrum overlay dropped", error); }
    }

    static JSONObject object(Object... pairs) {
        JSONObject result = new JSONObject();
        try { for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]); }
        catch (Exception error) { throw new IllegalArgumentException(error); }
        return result;
    }

    @Override public void onDestroy() {
        unregisterReceiver(noisy); audioManager.unregisterAudioDeviceCallback(devices);
        // A paused queue's detached notification would otherwise outlive the Service.
        getSystemService(NotificationManager.class).cancel(1);
        shutDown(false);
        super.onDestroy();
    }

    private void shutDown(boolean taskRemoved) {
        if (destroyed) return;
        destroyed = true;
        control.post(() -> {
            if (taskRemoved) {
                stopAudio();
                stopForeground(STOP_FOREGROUND_REMOVE);
                getSystemService(NotificationManager.class).cancel(1);
            }
            control.removeCallbacks(tick); control.removeCallbacks(telemetryTick);
            releaseBenchmarkBuffers();
            benchmarkExecutor.shutdown();
            stopLiveInput();
            if (networkOutput != null) networkOutput.close();
            if (libraryShare != null) libraryShare.close();
            if (openHome != null) openHome.close();
            if (effectsClient != null) effectsClient.close();
            stopRemoteHost(); remoteIo.shutdown();
            if (ssdp != null) ssdp.close();
            mediaGateway.close();
            lanHttp.close();
            if (midi != null) midi.close();
            if (recordingMonitor != null) recordingMonitor.close();
            if (assets != null) assets.discardPending();
            stopBlindTest(false);
            if (measurement != null) { engine.cancelMeasurement(); measurement.clear(); }
            if (queue != null) saveQueue();
            if (engine != null) engine.stop();
            audioManager.abandonAudioFocusRequest(focus); session.release();
            if (decoder != null) decoder.close();
            if (engine != null) engine.close();
            cancelPlaybackMetadata();
            metadataWorker.shutdownNow();
            if (queue != null) queue.close();
            // Android Binder callbacks can retain a destroyed Service briefly.
            // Its DSP catalog and canonical history no longer belong to that lifetime.
            packer = null; pipelineRequest = null; pipeline = new JSONArray(); source = null;
            slots.clear(); undo.clear(); redo.clear(); remotePending.clear(); remoteAuthority.clear();
            mappings = null; midi = null; decoder = null; assets = null; measurement = null; queue = null; remote = null;
            control.removeCallbacksAndMessages(null);
            thread.quitSafely();
            if (taskRemoved) stopSelf();
        });
    }
}

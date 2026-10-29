package com.frieve.effetune;

import static org.junit.Assert.*;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.os.SystemClock;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class AndroidForegroundInputTest {
    @Test public void playerInputOwnershipPersistsThroughPauseAndReturnsAfterClear() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AndroidWebHostTest.awaitReady(scenario);
            try (AndroidHostTest.ServiceLease lease = new AndroidHostTest.ServiceLease()) {
                java.io.File directory = new java.io.File(lease.context.getCacheDir(), "imports");
                assertTrue(directory.isDirectory() || directory.mkdirs());
                java.io.File file = java.io.File.createTempFile("input-ownership-", ".wav", directory);
                try {
                    try (java.io.InputStream input = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("audio/tone.wav");
                         java.io.FileOutputStream output = new java.io.FileOutputStream(file)) {
                        byte[] bytes = new byte[4096]; int count;
                        while ((count = input.read(bytes)) >= 0) output.write(bytes, 0, count);
                    }
                    command(lease, "audio.stop", new JSONObject());
                    command(lease, "playback.setQueue", new JSONObject().put("items", new JSONArray()));
                    command(lease, "pipeline.set", new NativeParameterPacker(lease.context).prepareRecords(new JSONArray(), false, "A"));
                    command(lease, "audio.configure", new JSONObject().put("useInputWithPlayer", false));
                    command(lease, "audio.input", new JSONObject().put("deviceId", 0));
                    assertOwnInputActive(lease);
                    String uri = androidx.core.content.FileProvider.getUriForFile(lease.context, lease.context.getPackageName() + ".files", file).toString();
                    command(lease, "playback.setSource", new JSONObject().put("uri", uri));
                    assertSilentInput(lease);
                    command(lease, "playback.play", new JSONObject());
                    assertSilentInput(lease);
                    command(lease, "playback.pause", new JSONObject());
                    assertSilentInput(lease);
                    command(lease, "playback.stop", new JSONObject());
                    assertSilentInput(lease);
                    command(lease, "measurement.begin", new JSONObject().put("sampleRate", 48000)
                            .put("excitationFrames", 128).put("captureFrames", 4800));
                    command(lease, "measurement.chunk", new JSONObject().put("offset", 0)
                            .put("data", android.util.Base64.encodeToString(new byte[128 * 8], android.util.Base64.NO_WRAP)));
                    command(lease, "measurement.start", new JSONObject());
                    long deadline = SystemClock.elapsedRealtime() + 10000;
                    JSONObject capture;
                    do {
                        SystemClock.sleep(50);
                        capture = command(lease, "measurement.status", new JSONObject());
                    } while (capture.getString("status").equals("running") && SystemClock.elapsedRealtime() < deadline);
                    assertEquals("complete", capture.getString("status"));
                    assertSilentInput(lease);
                    int offset = 0;
                    while (offset < 4800 * 8) {
                        JSONObject chunk = command(lease, "measurement.read", new JSONObject().put("offset", offset).put("length", 4096));
                        assertEquals(offset, chunk.getInt("offset"));
                        offset += android.util.Base64.decode(chunk.getString("data"), android.util.Base64.DEFAULT).length;
                    }
                    assertEquals(4800 * 8, offset);
                    command(lease, "measurement.cancel", new JSONObject());
                    command(lease, "audio.configure", new JSONObject().put("useInputWithPlayer", true));
                    assertOwnInputActive(lease);
                    command(lease, "audio.configure", new JSONObject().put("useInputWithPlayer", false));
                    assertSilentInput(lease);
                    scenario.moveToState(Lifecycle.State.CREATED);
                    SystemClock.sleep(500);
                    command(lease, "playback.setQueue", new JSONObject().put("items", new JSONArray()));
                    assertSilentInput(lease);
                    scenario.moveToState(Lifecycle.State.RESUMED);
                    assertOwnInputActive(lease);
                } finally {
                    scenario.moveToState(Lifecycle.State.RESUMED);
                    command(lease, "audio.stop", new JSONObject());
                    command(lease, "playback.setQueue", new JSONObject().put("items", new JSONArray()));
                    file.delete();
                }
            }
        }
    }

    private static void assertSilentInput(AndroidHostTest.ServiceLease lease) throws Exception {
        lease.onControl(() -> {
            NativeEngine engine = (NativeEngine) lease.field("engine");
            assertEquals("Player-only input releases microphone ownership", 0, engine.getInputSessionId());
            assertFalse((boolean) lease.field("microphone"));
            assertEquals("Selected input survives the ownership handoff", 0, lease.field("inputDevice"));
            assertTrue("Input handoff preserves the DSP output", (boolean) lease.field("running"));
            assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK, lease.service.getForegroundServiceType());
            return null;
        });
    }

    @Test public void naturallySuspendedInputResumesAsMicrophoneForegroundService() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AndroidWebHostTest.awaitReady(scenario);
            try (AndroidHostTest.ServiceLease lease = new AndroidHostTest.ServiceLease()) {
                try {
                    command(lease, "audio.stop", new JSONObject());
                    command(lease, "playback.setQueue", new JSONObject().put("items", new JSONArray()));
                    command(lease, "pipeline.set", new NativeParameterPacker(lease.context).prepareRecords(new JSONArray(), false, "A"));
                    command(lease, "audio.configure", new JSONObject().put("powerSettings", new JSONObject()
                            .put("mode", "maximum").put("silenceThresholdDb", -60).put("fullSuspendDelaySeconds", 60)));
                    command(lease, "audio.input", new JSONObject().put("deviceId", 0));
                    // This explicit user setting exceeds the measured emulator noise (-72.247 dB).
                    // Keep the production threshold and the real microphone suspend deadline unchanged.
                    long deadline = SystemClock.elapsedRealtime() + 75000;
                    JSONObject state;
                    do {
                        SystemClock.sleep(200);
                        state = command(lease, "snapshot.get", new JSONObject());
                    } while (!state.getString("powerState").equals("SUSPENDED") && SystemClock.elapsedRealtime() < deadline);
                    assertEquals("Microphone did not reach its natural silence deadline", "SUSPENDED", state.getString("powerState"));
                    lease.onControl(() -> { AndroidHostTest.assertForeground(lease, false); return null; });
                    command(lease, "audio.start", new JSONObject());
                    lease.onControl(() -> {
                        AndroidHostTest.assertForeground(lease, true);
                        assertTrue((lease.service.getForegroundServiceType() & ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) != 0);
                        assertTrue((boolean) lease.field("microphone")); return null;
                    });
                    assertOwnInputActive(lease);
                    scenario.moveToState(Lifecycle.State.CREATED);
                    SystemClock.sleep(500);
                    assertOwnInputActive(lease);
                    scenario.moveToState(Lifecycle.State.RESUMED);
                    command(lease, "audio.input", new JSONObject().put("deviceId", -1));
                    lease.onControl(() -> {
                        AndroidHostTest.assertForeground(lease, true);
                        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK, lease.service.getForegroundServiceType());
                        assertEquals(0, ((NativeEngine) lease.field("engine")).getInputSessionId());
                        assertTrue((boolean) lease.field("running")); return null;
                    });
                } finally {
                    scenario.moveToState(Lifecycle.State.RESUMED);
                    command(lease, "audio.stop", new JSONObject());
                    command(lease, "audio.configure", new JSONObject().put("powerSettings", new JSONObject()
                            .put("mode", "balanced").put("silenceThresholdDb", -80).put("fullSuspendDelaySeconds", 300)));
                }
            }
        }
    }
    private static void assertOwnInputActive(AndroidHostTest.ServiceLease lease) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 3000;
        RecordingMonitor.State state;
        do {
            state = lease.onControl(() -> {
                int session = ((NativeEngine) lease.field("engine")).getInputSessionId();
                assertTrue("Native input has no allocated recording session", session > 0);
                return RecordingMonitor.find(lease.context.getSystemService(AudioManager.class).getActiveRecordingConfigurations(), session);
            });
            if (state == null) SystemClock.sleep(25);
        } while (state == null && SystemClock.elapsedRealtime() < deadline);
        assertNotNull("Own microphone recording was not active", state);
        assertFalse("Android silenced the microphone", state.silenced);
    }
    private static JSONObject command(AndroidHostTest.ServiceLease lease, String name, JSONObject args) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<JSONObject> result = new AtomicReference<>();
        AtomicReference<AudioService.HostError> failure = new AtomicReference<>();
        lease.service.command(new JSONObject().put("command", name).put("payload", args), (value, error) -> {
            result.set(value); failure.set(error); done.countDown();
        }, true);
        assertTrue(done.await(10, TimeUnit.SECONDS)); assertNull(failure.get()); return result.get();
    }
}

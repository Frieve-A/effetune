package com.frieve.effetune;

import static org.junit.Assert.*;
import android.content.Context;
import android.media.AudioManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class RecordingMonitorTest {
    @Test public void ownNativeSessionAndCaptureConditionChangesAreObserved() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AudioManager manager = context.getSystemService(AudioManager.class);
        HandlerThread thread = new HandlerThread("recording-monitor-test"); thread.start();
        Handler control = new Handler(thread.getLooper());
        AtomicInteger invalidations = new AtomicInteger();
        try (NativeEngine engine = new NativeEngine(48000, 256)) {
            assertEquals(0, engine.start()); assertEquals(0, engine.setInputDevice(0));
            int session = engine.getInputSessionId(); assertTrue("Allocated input session=" + session, session > 0);
            long deadline = SystemClock.elapsedRealtime() + 3000;
            while (RecordingMonitor.find(manager.getActiveRecordingConfigurations(), session) == null
                    && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(10);
            assertNotNull(RecordingMonitor.find(manager.getActiveRecordingConfigurations(), session));
            AtomicReference<Throwable> failure = new AtomicReference<>();
            CountDownLatch done = new CountDownLatch(1);
            control.post(() -> {
                try (RecordingMonitor monitor = new RecordingMonitor(manager, control, engine::getInputSessionId,
                        invalidations::incrementAndGet)) {
                    monitor.accept(new RecordingMonitor.State(session, true, "initial"));
                    assertEquals("Initial configuration must not abort a capture", 0, invalidations.get());
                    assertTrue(monitor.arm());
                    RecordingMonitor.State own = RecordingMonitor.find(manager.getActiveRecordingConfigurations(), session);
                    monitor.accept(own); assertEquals(0, invalidations.get());
                    monitor.accept(new RecordingMonitor.State(session, true, own.conditions));
                    assertEquals("System silencing invalidates", 1, invalidations.get());
                    assertTrue(monitor.arm());
                    monitor.accept(new RecordingMonitor.State(session, false, own.conditions + "/changed-format"));
                    assertEquals("Capture path change invalidates", 2, invalidations.get());
                    assertTrue(monitor.arm()); monitor.disarm();
                    monitor.accept(null); assertEquals("Stopped capture stays disarmed", 2, invalidations.get());
                } catch (Throwable error) { failure.set(error); }
                finally { done.countDown(); }
            });
            assertTrue(done.await(5, TimeUnit.SECONDS));
            if (failure.get() != null) throw new AssertionError(failure.get());
        } finally { thread.quitSafely(); thread.join(3000); assertFalse(thread.isAlive()); }
    }
}

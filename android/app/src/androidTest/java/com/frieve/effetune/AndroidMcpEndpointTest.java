package com.frieve.effetune;

import static org.junit.Assert.*;
import android.content.*;
import android.os.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Paired with tools/test-android-remote.mjs over adb forward; no production token is used. */
@RunWith(AndroidJUnit4.class)
public final class AndroidMcpEndpointTest {
    @Test public void existingMcpClientDrivesRendererIndependentService() throws Exception {
        org.junit.Assume.assumeTrue("Requires the paired existing MCP client", "true".equals(InstrumentationRegistry.getArguments().getString("pairedMcp")));
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        CountDownLatch bound = new CountDownLatch(1), finished = new CountDownLatch(1);
        AtomicReference<AudioService> service = new AtomicReference<>();
        ServiceConnection connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder binder) { service.set(((AudioService.LocalBinder) binder).getService()); bound.countDown(); }
            @Override public void onServiceDisconnected(ComponentName name) { }
        };
        assertTrue(app.bindService(new Intent(app, AudioService.class), connection, Context.BIND_AUTO_CREATE));
        try {
            assertTrue(bound.await(10, TimeUnit.SECONDS));
            Field field = AudioService.class.getDeclaredField("control"); field.setAccessible(true); Handler control = (Handler) field.get(service.get());
            Method dispatch = AudioService.class.getDeclaredMethod("dispatchRemote", JSONObject.class, Consumer.class, java.util.function.BooleanSupplier.class); dispatch.setAccessible(true);
            try (RemoteControlServer server = new RemoteControlServer(app, 47319, "android-contract-test", "", "", (request, reply, current) -> {
                if (request.optString("op").equals("testFinish")) { reply.accept(AudioService.object("op", "ack", "seq", request.opt("seq"), "ok", true)); finished.countDown(); return; }
                control.post(() -> { try { dispatch.invoke(service.get(), request, reply, current); } catch (Exception error) { throw new RuntimeException(error); } });
            })) {
                assertTrue("Run the paired MCP contract client while this instrumentation is waiting", finished.await(60, TimeUnit.SECONDS));
            }
        } finally { app.unbindService(connection); }
    }
}

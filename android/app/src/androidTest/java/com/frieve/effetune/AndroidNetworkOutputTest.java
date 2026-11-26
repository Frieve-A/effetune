package com.frieve.effetune;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class AndroidNetworkOutputTest {
    @Test public void ownRendererIsUnavailableForOutputAndReconnect() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String prefsName = "network-output-test-" + UUID.randomUUID();
        SharedPreferences prefs = app.getSharedPreferences(prefsName, Context.MODE_PRIVATE);
        Context context = new ContextWrapper(app) {
            @Override public SharedPreferences getSharedPreferences(String name, int mode) { return prefs; }
        };
        String ownOh = UUID.randomUUID().toString(), ownAv = UUID.randomUUID().toString();
        String ownOhUdn = "uuid:" + ownOh, ownAvUdn = "uuid:" + ownAv, peerUdn = "uuid:" + UUID.randomUUID();
        JSONObject saved = new JSONObject().put("id", ownAvUdn).put("type", "upnp").put("name", "Saved")
                .put("enabled", true).put("trimMs", 0);
        prefs.edit().putString("openHomeDeviceId", ownOh).putString("upnpAvDeviceId", ownAv)
                .putString("networkOutput", new JSONObject().put("enabled", true)
                        .put("targets", new JSONArray().put(saved)).toString()).apply();

        try (NetworkOutput output = new NetworkOutput(context, new Handler(Looper.getMainLooper()),
                (name, event) -> {}, () -> {})) {
            Field discoveryField = NetworkOutput.class.getDeclaredField("discovery");
            discoveryField.setAccessible(true);
            NetworkOutput.Discovery discovery = (NetworkOutput.Discovery) discoveryField.get(output);
            InetAddress address = InetAddress.getByName("192.168.1.10");
            for (String udn : new String[] { ownOhUdn, ownAvUdn, peerUdn })
                discovery.found(new UpnpRenderer(udn, udn, address, null, null));

            Method status = NetworkOutput.class.getDeclaredMethod("status");
            status.setAccessible(true);
            JSONArray targets = ((JSONObject) status.invoke(output)).getJSONArray("targets");
            Map<String, Boolean> presence = new HashMap<>();
            for (int i = 0; i < targets.length(); i++) {
                JSONObject target = targets.getJSONObject(i);
                presence.put(target.getString("id"), target.getBoolean("present"));
            }
            assertEquals(Map.of(ownAvUdn, false, peerUdn, true), presence);

            Method findDevice = NetworkOutput.class.getDeclaredMethod("findDevice", String.class);
            findDevice.setAccessible(true);
            assertNull(findDevice.invoke(output, ownOhUdn));
            assertNull(findDevice.invoke(output, ownAvUdn));
            assertNotNull(findDevice.invoke(output, peerUdn));
        } finally {
            app.deleteSharedPreferences(prefsName);
        }
    }

    @Test public void castStatusFollowsOnlyTheLoadedSessionAndRequiresAnIdleReasonToEnd() throws Exception {
        String url = "http://192.168.1.10/live/current";
        JSONObject other = new JSONObject().put("mediaSessionId", 4).put("playerState", "IDLE")
                .put("idleReason", "INTERRUPTED").put("media", new JSONObject().put("contentId", url + "-old"));
        JSONObject status = new JSONObject().put("mediaSessionId", 5).put("playerState", "IDLE");
        JSONArray statuses = new JSONArray().put(other);
        JSONObject reply = new JSONObject().put("status", statuses);
        assertNull(CastSender.liveMediaStatus(reply, 5, url));
        assertEquals("taken", assertThrows(NetworkOutput.Failure.class,
                () -> CastSender.loadedMediaId(reply, url)).note);
        assertEquals(5, CastSender.loadedMediaId(new JSONObject().put("status", new JSONArray().put(status)), url));
        statuses.put(status);
        assertSame(status, CastSender.liveMediaStatus(reply, 5, url));
        status.put("idleReason", JSONObject.NULL);
        assertSame(status, CastSender.liveMediaStatus(reply, 5, url));

        status.put("playerState", "PLAYING").put("media", new JSONObject().put("contentId", url));
        assertEquals(5, CastSender.loadedMediaId(reply, url));
        assertSame(status, CastSender.liveMediaStatus(reply, 5, url));
        status.put("media", other.getJSONObject("media"));
        assertEquals("taken", assertThrows(NetworkOutput.Failure.class,
                () -> CastSender.liveMediaStatus(reply, 5, url)).note);

        status.remove("media");
        status.put("playerState", "IDLE").put("idleReason", "FINISHED");
        assertThrows(IOException.class, () -> CastSender.liveMediaStatus(reply, 5, url));
    }
}

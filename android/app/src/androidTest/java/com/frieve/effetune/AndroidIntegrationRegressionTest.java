package com.frieve.effetune;

import static org.junit.Assert.*;
import static com.frieve.effetune.AndroidWebHostTest.*;
import android.content.Context;
import android.os.Build;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class AndroidIntegrationRegressionTest {
    @Test public void canonicalPipelineAndNativeQueueRestore() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitReady(scenario); loadScript(scenario);
            execute(scenario, "window.__integration.pipeline()"); assertTrue(result(scenario).getBoolean("independent"));
            execute(scenario, "window.__integration.queue()"); JSONObject fixture = result(scenario); assertEquals(9, fixture.getInt("length"));
            try {
            scenario.recreate(); awaitReady(scenario);
            execute(scenario, "Promise.resolve({state:window.uiManager.audioPlayer?.stateManager.getStateSnapshot()})");
            JSONObject restored = result(scenario).getJSONObject("state");
            assertEquals(0.2, restored.getDouble("currentTrackPosition"), 0.03);
            assertEquals(42, restored.getInt("playerVolume")); assertTrue(restored.getBoolean("playerMute"));
            assertEquals(evaluate(scenario, "JSON.stringify(window.uiManager.audioPlayer?.stateManager.getStateSnapshot())"), "true", evaluate(scenario, "Boolean(window.uiManager.audioPlayer && window.uiManager.audioPlayer.stateManager.getStateSnapshot().playlistLength===9 && window.uiManager.audioPlayer.stateManager.getStateSnapshot().currentTrackIndex===7 && window.uiManager.audioPlayer.stateManager.getStateSnapshot().preservePitch===false)"));
            } finally {
                execute(scenario, "import('https://appassets.androidplatform.net/assets/web/js/android/bridge.js').then(async m=>{const b=m.getAndroidBridge();await b.request('playback.setQueue',{items:[]});await b.request('playback.volume'," + fixture.getJSONObject("settings") + ");await b.request('playback.speed'," + fixture.getJSONObject("settings") + ");return {done:true};})"); result(scenario);
                InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver().delete(android.net.Uri.parse(fixture.getString("uri")), null, null);
            }
        }
    }

    @Test public void normalMeasurementFormRunsNativeCaptureAnalysisAndSave() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitReady(scenario);
            scenario.onActivity(activity -> {
                try { Field field = MainActivity.class.getDeclaredField("webView"); field.setAccessible(true);
                    ((WebView) field.get(activity)).loadUrl("https://appassets.androidplatform.net/assets/web/features/measurement/measurement.html");
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            waitFor(scenario, "Boolean(window.app?.measurementController && document.body.style.visibility!=='hidden')", 15000);
            loadScript(scenario);
            execute(scenario, "window.__integration.measurement()");
            waitFor(scenario, "window.__hostTestResult!==null", 45000);
            JSONObject result = result(scenario);
            assertTrue(result.getInt("capturedFrames") > 16384); assertTrue(result.getBoolean("saved"));
        }
    }

    @Test public void outboundLanPermissionIsIndependentOfRemoteServer() throws Exception {
        org.junit.Assume.assumeTrue(Build.VERSION.SDK_INT >= 37);
        String peer = InstrumentationRegistry.getArguments().getString("networkUrl");
        org.junit.Assume.assumeNotNull(peer);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitReady(scenario);
            execute(scenario, "import('https://appassets.androidplatform.net/assets/web/js/android/bridge.js').then(async({getAndroidBridge})=>{window.__lanBridge=getAndroidBridge();try{await window.__lanBridge.request('network.ensurePermission',{request:true});return {denied:false};}catch{return {denied:true};}})");
            clickPermission("permission_deny_button"); assertTrue(result(scenario).getBoolean("denied"));
            execute(scenario, "window.__lanBridge.request('network.ensurePermission',{request:true})");
            clickPermission("permission_allow_button"); assertTrue(result(scenario).getBoolean("granted"));
            execute(scenario, "import('https://appassets.androidplatform.net/assets/web/js/network-music/pwa-transport.js').then(async({PwaNetworkMusicTransport})=>{const t=new PwaNetworkMusicTransport({storage:null});try{return await t.register(" + JSONObject.quote(peer + "/?t=fixture") + ");}finally{t.dispose();}})");
            assertEquals("android-lan-fixture", result(scenario).getString("hostId"));
        }
    }

    static void waitFor(ActivityScenario<MainActivity> scenario, String condition, long milliseconds) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + milliseconds;
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluate(scenario, condition))) return;
            Thread.sleep(50);
        }
        fail("UI condition did not complete: " + condition);
    }
    private static void loadScript(ActivityScenario<MainActivity> scenario) throws Exception {
        Context test = InstrumentationRegistry.getInstrumentation().getContext();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (InputStream input = test.getAssets().open("integration-regressions.js")) {
            byte[] bytes = new byte[8192]; int count; while ((count = input.read(bytes)) >= 0) output.write(bytes, 0, count);
        }
        execute(scenario, output.toString("UTF-8")); assertTrue(result(scenario).getBoolean("ready"));
    }
    private static void clickPermission(String id) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 10000;
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            AccessibilityNodeInfo root = InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
            if (root != null) for (AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByViewId("com.android.permissioncontroller:id/" + id)) {
                if (node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
            }
            Thread.sleep(50);
        }
        fail("Local network permission choice was not displayed");
    }
}

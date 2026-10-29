package com.frieve.effetune;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run seed, reinstall the same-signed APK, then verify using upgradePhase. */
@RunWith(AndroidJUnit4.class)
public final class AndroidUpgradeTest {
    @Test public void sameSignatureUpgradeRetainsServiceAndWebStorage() throws Exception {
        String phase = InstrumentationRegistry.getArguments().getString("upgradePhase");
        assumeTrue("seed".equals(phase) || "verify".equals(phase));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        SharedPreferences evidence = context.getSharedPreferences("upgrade-acceptance", Context.MODE_PRIVATE);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AndroidWebHostTest.awaitReady(scenario);
            if (phase.equals("seed")) {
                String marker = UUID.randomUUID().toString();
                AndroidWebHostTest.execute(scenario, "(async()=>{const {getAndroidBridge}=await import('https://appassets.androidplatform.net/assets/web/js/android/bridge.js');const {prepareAndroidPipeline}=await import('https://appassets.androidplatform.net/assets/web/js/android/pipeline.js');const b=getAndroidBridge(),m=window.audioManager,saved=prepareAndroidPipeline(m.pipeline,{sampleRate:48000,masterBypass:m.masterBypass});saved.slot=m.currentPipeline;const p=window.pluginManager.createPlugin('Volume',{audioHostActive:false});p.setParameters({vl:-7});const next=prepareAndroidPipeline([p],{sampleRate:48000});next.slot=saved.slot;await b.request('pipeline.set',next);await b.request('audio.stop');localStorage.setItem('android-upgrade-test'," + JSONObject.quote(marker) + ");const root=await navigator.storage.getDirectory(),file=await root.getFileHandle('android-upgrade-test',{create:true}),w=await file.createWritable();await w.write(new Uint8Array([7,29,37]));await w.close();return {saved};})()");
                JSONObject saved = AndroidWebHostTest.result(scenario);
                awaitLocalStorageCommit(context, marker);
                assertTrue(evidence.edit().putString("marker", marker).putString("saved", saved.getJSONObject("saved").toString()).commit());
            } else {
                String marker = evidence.getString("marker", null);
                assertNotNull("Upgrade seed must run before reinstall", marker);
                AndroidWebHostTest.execute(scenario, "(async()=>{const {getAndroidBridge}=await import('https://appassets.androidplatform.net/assets/web/js/android/bridge.js');const state=await getAndroidBridge().request('snapshot.get'),root=await navigator.storage.getDirectory(),file=await(await root.getFileHandle('android-upgrade-test')).getFile();return {marker:localStorage.getItem('android-upgrade-test'),bytes:[...new Uint8Array(await file.arrayBuffer())],state};})()");
                JSONObject restored = AndroidWebHostTest.result(scenario);
                assertEquals(marker, restored.getString("marker"));
                assertEquals("[7,29,37]", restored.getJSONArray("bytes").toString());
                assertEquals(-7, restored.getJSONObject("state").getJSONArray("pipeline").getJSONObject(0).getJSONObject("parameters").getDouble("vl"), 0);
                assertEquals("SUSPENDED", restored.getJSONObject("state").getString("powerState"));
                AndroidWebHostTest.execute(scenario, "(async()=>{const {getAndroidBridge}=await import('https://appassets.androidplatform.net/assets/web/js/android/bridge.js');await getAndroidBridge().request('pipeline.set'," + evidence.getString("saved", "{}") + ");localStorage.removeItem('android-upgrade-test');await(await navigator.storage.getDirectory()).removeEntry('android-upgrade-test');return {};})()");
                AndroidWebHostTest.result(scenario);
                assertTrue(evidence.edit().clear().commit());
            }
        }
    }

    private static void awaitLocalStorageCommit(Context context, String marker) throws Exception {
        // Instrumentation shutdown kills WebView before its delayed LocalStorage commit can finish.
        File directory = new File(context.getApplicationInfo().dataDir, "app_webview/Default/Local Storage/leveldb");
        long deadline = SystemClock.elapsedRealtime() + 10000;
        do {
            File[] logs = directory.listFiles((parent, name) -> name.matches("[0-9]+\\.log"));
            if (logs != null) for (File log : logs) {
                if (new String(Files.readAllBytes(log.toPath()), StandardCharsets.ISO_8859_1).contains(marker)) return;
            }
            SystemClock.sleep(50);
        } while (SystemClock.elapsedRealtime() < deadline);
        fail("LocalStorage fixture did not reach disk before process shutdown");
    }
}

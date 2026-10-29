package com.frieve.effetune;

import static org.junit.Assert.*;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class AndroidWebHostTest {
    @Test public void destroyedActivityRejectsQueuedBridgeAndDocumentRequests() throws Exception {
        MainActivity[] activity = new MainActivity[1];
        WebHostBridge[] bridge = new WebHostBridge[1];
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(current -> {
                activity[0] = current;
                try {
                    java.lang.reflect.Field field = MainActivity.class.getDeclaredField("bridge");
                    field.setAccessible(true);
                    bridge[0] = (WebHostBridge) field.get(current);
                } catch (Exception error) { throw new AssertionError(error); }
            });
        }
        assertNotNull(bridge[0]);
        JSONObject request = new JSONObject().put("version", 1).put("id", "late-document")
                .put("command", "documents.stat").put("payload", new JSONObject().put("uri", "content://closed/document"));
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            try {
                java.lang.reflect.Method receive = WebHostBridge.class.getDeclaredMethod("receive",
                        androidx.webkit.WebMessageCompat.class, android.net.Uri.class, boolean.class,
                        androidx.webkit.JavaScriptReplyProxy.class);
                receive.setAccessible(true);
                receive.invoke(bridge[0], new androidx.webkit.WebMessageCompat(request.toString()),
                        android.net.Uri.parse(WebHostBridge.ORIGIN), true, null);
                activity[0].dispatch(request, (result, error) -> {
                    assertNull(result);
                    assertNotNull(error);
                    assertEquals("unavailable", error.code);
                });
            } catch (Exception error) { throw new AssertionError(error); }
        });
    }

    @Test public void webMessagePipelineAudioAndRecreationUseServiceState() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitReady(scenario);
            execute(scenario, "(async()=>{const {getAndroidBridge}=await import('https://appassets.androidplatform.net/assets/web/js/android/bridge.js');const {prepareAndroidPipeline}=await import('https://appassets.androidplatform.net/assets/web/js/android/pipeline.js');const b=getAndroidBridge();const saved=prepareAndroidPipeline(window.audioManager.pipeline,{sampleRate:48000,masterBypass:window.audioManager.masterBypass});saved.slot=window.audioManager.currentPipeline;const p=window.pluginManager.createPlugin('Volume',{audioHostActive:false});p.setParameters({vl:-9});const payload=prepareAndroidPipeline([p],{sampleRate:48000});payload.slot=saved.slot;await b.request('pipeline.set',payload);const started=await b.request('audio.start');const clock=await b.request('audio.clock');await new Promise(r=>setTimeout(r,150));const next=await b.request('audio.clock');await b.request('audio.stop');return {saved,started:started.powerState,advanced:next.frame>clock.frame};})()");
            JSONObject first = result(scenario); assertEquals("ACTIVE", first.getString("started")); assertTrue(first.getBoolean("advanced"));
            try {
                scenario.recreate(); awaitReady(scenario);
                execute(scenario, "import('https://appassets.androidplatform.net/assets/web/js/android/bridge.js').then(m=>m.getAndroidBridge().request('snapshot.get'))");
                JSONObject restored = result(scenario);
                assertEquals(1, restored.getJSONArray("pipeline").length());
                assertEquals(-9, restored.getJSONArray("pipeline").getJSONObject(0).getJSONObject("parameters").getDouble("vl"), 0);
                assertEquals("SUSPENDED", restored.getString("powerState"));
            } finally {
                execute(scenario, "import('https://appassets.androidplatform.net/assets/web/js/android/bridge.js').then(m=>m.getAndroidBridge().request('pipeline.set'," + first.getJSONObject("saved").toString() + "))"); result(scenario);
            }
        }
    }
    @Test public void nativeAnalyzerAndFaultEventsReachEditedUiPluginIds() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitReady(scenario);
            execute(scenario, "(async()=>{const {getAndroidBridge}=await import('https://appassets.androidplatform.net/assets/web/js/android/bridge.js');const {prepareAndroidPipeline}=await import('https://appassets.androidplatform.net/assets/web/js/android/pipeline.js');const b=getAndroidBridge(),m=window.audioManager;const saved=prepareAndroidPipeline(m.pipeline,{sampleRate:48000,masterBypass:m.masterBypass});saved.slot=m.currentPipeline;try{const oscillator=window.pluginManager.createPlugin('Oscillator',{audioHostActive:false}),section=window.pluginManager.createPlugin('Section',{audioHostActive:false}),meter=window.pluginManager.createPlugin('Level Meter',{audioHostActive:false}),tube=window.pluginManager.createPlugin('Tube Simulator',{audioHostActive:false});oscillator.id=5001;section.id=5002;meter.id=5003;tube.id=5004;oscillator.setParameters({vl:-12,fr:440});tube.setParameters({mx:0});const payload=prepareAndroidPipeline([oscillator,section,meter,tube],{sampleRate:48000});payload.slot=saved.slot;m.acceptSnapshot(await b.request('pipeline.set',payload));await m.restoreNativePipeline();await b.request('telemetry.configure',{visible:true});const initialPackets=m.telemetryHub.stats.packets;await b.request('audio.start');const deadline=performance.now()+15000;let display,fault;do{display=m.pipeline.find(p=>p.id===5003);fault=m.pipeline.find(p=>p.id===5004);if(m.telemetryHub.stats.packets>initialPackets&&display?.lv?.length&&m.nativeRuntimeEvents.has(5004))break;await new Promise(r=>setTimeout(r,50));}while(performance.now()<deadline);return {levels:display.lv,hasCanvas:document.querySelectorAll('canvas').length>0,faultDelivered:m.nativeRuntimeEvents.has(5004),fault:fault.circuitFault,malformed:m.telemetryHub.stats.malformedPackets,diagnostic:{stats:m.telemetryHub.getStats(),subscribers:[...m.telemetryHub.subscribers.keys()],enabled:display.enabled,section:display._sectionEnabled,tapId:display._dspTelemetryTapId,revision:m.snapshot?.revision,bypass:m.snapshot?.masterBypass,power:m.snapshot?.powerState}};}finally{await b.request('audio.stop');m.acceptSnapshot(await b.request('pipeline.set',saved));await m.restoreNativePipeline();}})()");
            JSONObject actual = result(scenario, 20000);
            assertTrue(actual.toString(), actual.getJSONArray("levels").length() > 0);
            assertTrue(actual.toString(), actual.getJSONArray("levels").getDouble(0) > -30);
            assertTrue(actual.getBoolean("hasCanvas")); assertTrue(actual.getBoolean("faultDelivered"));
            assertEquals("none", actual.getJSONObject("fault").getString("cause")); assertEquals(0, actual.getInt("malformed"));
        }
    }

    @Test public void silentStatelessPipelineSuspendsAndFreshResumeRestartsDeadline() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitReady(scenario);
            execute(scenario, "(async()=>{const {getAndroidBridge}=await import('https://appassets.androidplatform.net/assets/web/js/android/bridge.js');const {prepareAndroidPipeline}=await import('https://appassets.androidplatform.net/assets/web/js/android/pipeline.js');const b=getAndroidBridge(),m=window.audioManager;const saved=prepareAndroidPipeline(m.pipeline,{sampleRate:48000,masterBypass:m.masterBypass});saved.slot=m.currentPipeline;try{const volume=window.pluginManager.createPlugin('Volume',{audioHostActive:false});const payload=prepareAndroidPipeline([volume],{sampleRate:48000});payload.slot=saved.slot;await b.request('pipeline.set',payload);await b.request('audio.input',{deviceId:-1});await b.request('audio.configure',{powerSettings:{mode:'maximum',silenceThresholdDb:-80,fullSuspendDelaySeconds:300}});await b.request('audio.start');await new Promise(r=>setTimeout(r,3800));const idle=await b.request('snapshot.get');await b.request('audio.start');await new Promise(r=>setTimeout(r,200));const resumed=await b.request('snapshot.get');return {idle:idle.powerState,resumed:resumed.powerState};}finally{await b.request('audio.stop');await b.request('audio.configure',{powerSettings:{mode:'balanced',silenceThresholdDb:-80,fullSuspendDelaySeconds:300}});m.acceptSnapshot(await b.request('pipeline.set',saved));await m.restoreNativePipeline();}})()");
            JSONObject actual = result(scenario); assertEquals("SUSPENDED", actual.getString("idle")); assertEquals("ACTIVE", actual.getString("resumed"));
        }
    }

    static void awaitReady(ActivityScenario<MainActivity> scenario) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 45000;
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluate(scenario, "Boolean(window.app?.initialized && window.audioManager?.snapshot && window.pluginManager?.isPluginAvailable('Volume') && window.pipelineManager)"))) return;
            Thread.sleep(100);
        }
        fail("Bundled Android UI did not initialize");
    }
    static void execute(ActivityScenario<MainActivity> scenario, String promise) throws Exception {
        evaluate(scenario, "window.__hostTestResult=null;Promise.resolve(" + promise + ").then(value=>window.__hostTestResult={value},error=>window.__hostTestResult={error:String(error)});void 0");
    }
    static JSONObject result(ActivityScenario<MainActivity> scenario) throws Exception { return result(scenario, 15000); }
    private static JSONObject result(ActivityScenario<MainActivity> scenario, long timeoutMs) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + timeoutMs;
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            String encoded = evaluate(scenario, "JSON.stringify(window.__hostTestResult)");
            if (!encoded.equals("null") && !encoded.equals("\"null\"")) {
                JSONObject response = new JSONObject((String) new JSONTokener(encoded).nextValue());
                assertFalse(response.optString("error"), response.has("error")); return response.getJSONObject("value");
            }
            Thread.sleep(50);
        }
        throw new AssertionError("WebMessage response timed out");
    }
    static String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> output = new AtomicReference<>(); CountDownLatch done = new CountDownLatch(1);
        scenario.onActivity(activity -> {
            try { Field field = MainActivity.class.getDeclaredField("webView"); field.setAccessible(true); ((WebView) field.get(activity)).evaluateJavascript(script, value -> { output.set(value); done.countDown(); }); }
            catch (Exception error) { throw new RuntimeException(error); }
        });
        assertTrue(done.await(5, TimeUnit.SECONDS)); return output.get();
    }
}

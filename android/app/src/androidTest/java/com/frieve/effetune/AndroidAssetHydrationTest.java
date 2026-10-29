package com.frieve.effetune;

import static org.junit.Assert.*;
import static com.frieve.effetune.AndroidWebHostTest.*;
import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.webkit.WebView;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class AndroidAssetHydrationTest {
    @Test public void sourceAssetsRestoreForControlsOfflineAndImmutableUndo() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitReady(scenario); load(scenario);
            try {
                execute(scenario, "window.__assets.seed()"); result(scenario);
                preview(scenario);
                scenario.recreate(); awaitReady(scenario); load(scenario);
                preview(scenario);
                execute(scenario, "window.__assets.verify()");
                assertTrue(result(scenario).getInt("frames") > 0);
            } finally {
                execute(scenario, "window.__assets.cleanup()"); result(scenario);
            }
        }
    }
    private static void preview(ActivityScenario<MainActivity> scenario) throws Exception {
        for (String region : new String[] { "keyboard", "velocity" }) {
            execute(scenario, "window.__assets.previewTarget('" + region + "')");
            JSONObject target = result(scenario);
            long down = SystemClock.uptimeMillis();
            touch(scenario, target, down, MotionEvent.ACTION_DOWN);
            try {
                AndroidIntegrationRegressionTest.waitFor(scenario,
                    "window.__previewPlugin._previewMidi===69 && window.__previewPlugin._previewVelocity===" + target.getInt("velocity") +
                    " && window.__previewPlugin._activeVoices>0", 5000);
                if (region.equals("keyboard")) {
                    execute(scenario, "window.__assets.editWhileHeld()"); result(scenario);
                    AndroidIntegrationRegressionTest.waitFor(scenario,
                        "window.__previewPlugin._previewMidi===69 && window.__previewPlugin._activeVoices>0", 5000);
                }
            } catch (AssertionError error) {
                throw new AssertionError("Preview target=" + target + " actual=" + evaluate(scenario,
                    "JSON.stringify({midi:window.__previewPlugin._previewMidi,velocity:window.__previewPlugin._previewVelocity,voices:window.__previewPlugin._activeVoices,ready:window.audioManager.hasNativePluginAsset(window.__previewPlugin,0)})"), error);
            } finally { touch(scenario, target, down, MotionEvent.ACTION_UP); }
            AndroidIntegrationRegressionTest.waitFor(scenario, "window.__previewPlugin._previewMidi===-1", 5000);
            AndroidIntegrationRegressionTest.waitFor(scenario, "window.__previewPlugin._activeVoices===0", 5000);
        }
        execute(scenario, "window.__assets.previewFinished()");
        result(scenario);
    }
    private static void touch(ActivityScenario<MainActivity> scenario, JSONObject target, long down, int action) throws Exception {
        float x = (float) target.getDouble("x"), y = (float) target.getDouble("y");
        scenario.onActivity(activity -> {
            try {
                Field field = MainActivity.class.getDeclaredField("webView"); field.setAccessible(true);
                WebView view = (WebView) field.get(activity);
                float scale = view.getScale();
                MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x * scale, y * scale, 0);
                view.dispatchTouchEvent(event); event.recycle();
            } catch (Exception error) { throw new RuntimeException(error); }
        });
    }
    private static void load(ActivityScenario<MainActivity> scenario) throws Exception {
        Context test = InstrumentationRegistry.getInstrumentation().getContext();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (InputStream input = test.getAssets().open("asset-hydration.js")) {
            byte[] bytes = new byte[8192]; int count;
            while ((count = input.read(bytes)) >= 0) output.write(bytes, 0, count);
        }
        execute(scenario, output.toString("UTF-8")); result(scenario);
    }
}

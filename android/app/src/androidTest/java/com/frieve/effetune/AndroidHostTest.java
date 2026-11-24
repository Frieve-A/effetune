package com.frieve.effetune;

import static org.junit.Assert.*;
import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.ServiceConnection;
import android.database.sqlite.SQLiteDatabase;
import android.os.IBinder;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class AndroidHostTest {
    @Test public void nativeRemoteParameterEditPreservesHostRouting() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            NativeParameterPacker packer = new NativeParameterPacker(lease.context);
            JSONObject record = new JSONObject().put("id", 7102).put("type", "VolumePlugin").put("name", "Volume").put("enabled", true)
                    .put("parameters", new JSONObject().put("vl", -3).put("inputBus", 2).put("outputBus", 3).put("channel", "R"));
            packer.packRecord(record);
            call(lease.service, "pipeline.set", packer.prepareRecords(new JSONArray().put(record), false, "A"), null, null);
            lease.onControl(() -> {
                java.lang.reflect.Method dispatch = AudioService.class.getDeclaredMethod("dispatchRemote", JSONObject.class, java.util.function.Consumer.class, java.util.function.BooleanSupplier.class);
                dispatch.setAccessible(true);
                java.util.function.Consumer<JSONObject> reply = value -> assertTrue(value.toString(), value.optBoolean("ok"));
                dispatch.invoke(lease.service, new JSONObject().put("op", "params").put("index", 0).put("params", new JSONObject().put("vl", -6)), reply, (java.util.function.BooleanSupplier) () -> true);
                JSONObject prepared = (JSONObject) lease.field("pipelineRequest");
                JSONObject params = prepared.getJSONArray("plugins").getJSONObject(0).getJSONObject("parameters");
                assertEquals(-6, params.getInt("vl")); assertEquals(2, params.getInt("inputBus")); assertEquals(3, params.getInt("outputBus")); assertEquals("R", params.getString("channel"));
                byte[] descriptor = android.util.Base64.decode(prepared.getString("descriptor"), android.util.Base64.DEFAULT);
                assertEquals(2, descriptor[13]); assertEquals(3, descriptor[14]); assertEquals(1, descriptor[15]);
                return null;
            });
        }
    }
    @Test public void serviceReconcilesLostOutputButNeverReopensAfterStop() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            lease.onControl(() -> {
                NativeEngine engine = (NativeEngine) lease.field("engine");
                assertEquals(0, engine.start());
                for (String name : new String[]{"running", "focusHeld"}) { java.lang.reflect.Field field = AudioService.class.getDeclaredField(name); field.setAccessible(true); field.setBoolean(lease.service, true); }
                engine.stop();
                java.lang.reflect.Method reconcile = AudioService.class.getDeclaredMethod("reconcileOutput"); reconcile.setAccessible(true); reconcile.invoke(lease.service);
                assertEquals(1, engine.getOutputStatus()); assertTrue((boolean) lease.field("running"));
                assertEquals(0, engine.setInputDevice(0));
                java.lang.reflect.Field input = AudioService.class.getDeclaredField("inputDevice"); input.setAccessible(true); input.setInt(lease.service, 0);
                java.lang.reflect.Field microphone = AudioService.class.getDeclaredField("microphone"); microphone.setAccessible(true); microphone.setBoolean(lease.service, true);
                java.lang.reflect.Method notification = AudioService.class.getDeclaredMethod("showNotification", boolean.class); notification.setAccessible(true); notification.invoke(lease.service, true);
                assertForeground(lease, true);
                engine.stop(); reconcile.invoke(lease.service);
                assertEquals("No retry before a healthy callback was observed", 0, engine.getOutputStatus());
                assertFalse((boolean) lease.field("running")); assertFalse((boolean) lease.field("focusHeld"));
                assertFalse((boolean) lease.field("microphone")); assertEquals(-1, lease.field("inputDevice")); assertEquals(0, engine.getInputSessionId());
                assertFalse((boolean) lease.field("sourceReady")); assertNull(lease.field("remote"));
                java.lang.reflect.Field task = PcmDecoder.class.getDeclaredField("task"); task.setAccessible(true); assertNull(task.get(lease.field("decoder")));
                assertForeground(lease, false);
                assertEquals(0, engine.start());
                for (String name : new String[]{"running", "focusHeld"}) { java.lang.reflect.Field field = AudioService.class.getDeclaredField(name); field.setAccessible(true); field.setBoolean(lease.service, true); }
                return null;
            });
            Thread.sleep(100);
            lease.onControl(() -> {
                NativeEngine engine = (NativeEngine) lease.field("engine");
                java.lang.reflect.Method reconcile = AudioService.class.getDeclaredMethod("reconcileOutput"); reconcile.setAccessible(true); reconcile.invoke(lease.service);
                assertFalse("Fresh callback progress permits a distinct recovery episode", (boolean) lease.field("outputRecoveryAttempted"));
                engine.stop(); reconcile.invoke(lease.service); assertEquals(1, engine.getOutputStatus());
                return null;
            });
            call(lease.service, "audio.stop", new JSONObject(), null, null);
            lease.onControl(() -> {
                java.lang.reflect.Method reconcile = AudioService.class.getDeclaredMethod("reconcileOutput"); reconcile.setAccessible(true); reconcile.invoke(lease.service);
                assertEquals(0, ((NativeEngine) lease.field("engine")).getOutputStatus()); assertFalse((boolean) lease.field("running"));
                return null;
            });
        }
    }
    static void assertForeground(ServiceLease lease, boolean expected) {
        android.app.ActivityManager manager = lease.context.getSystemService(android.app.ActivityManager.class);
        for (android.app.ActivityManager.RunningServiceInfo info : manager.getRunningServices(100)) {
            if (info.service.getClassName().equals(AudioService.class.getName())) { assertEquals(expected, info.foreground); return; }
        }
        fail("Bound audio Service was not reported by Android");
    }
    @Test public void playAfterTerminalEofDecodesTheSourceAgain() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            File directory = new File(lease.context.getCacheDir(), "imports"); assertTrue(directory.isDirectory() || directory.mkdirs());
            File file = File.createTempFile("eof-", ".wav", directory);
            try {
                try (java.io.InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("audio/tone.wav"); java.io.FileOutputStream output = new java.io.FileOutputStream(file)) {
                    byte[] bytes = new byte[4096]; int count; while ((count = input.read(bytes)) >= 0) output.write(bytes, 0, count);
                }
                JSONObject source = new JSONObject().put("uri", androidx.core.content.FileProvider.getUriForFile(lease.context, lease.context.getPackageName() + ".files", file).toString());
                call(lease.service, "pipeline.set", new NativeParameterPacker(lease.context).prepareRecords(new JSONArray(), false, "A"), null, null);
                call(lease.service, "playback.setSource", source, null, null);
                lease.onControl(() -> {
                    NativeEngine engine = (NativeEngine) lease.field("engine"); assertEquals(0, engine.start());
                    java.lang.reflect.Field running = AudioService.class.getDeclaredField("running"); running.setAccessible(true); running.setBoolean(lease.service, true); return null;
                });
                long previousGeneration = -1;
                for (int replay = 0; replay < 2; replay++) {
                    JSONObject started = call(lease.service, "playback.play", new JSONObject(), null, null).getJSONObject("playback");
                    assertTrue(started.getBoolean("playing"));
                    assertTrue(started.getLong("generation") > previousGeneration); previousGeneration = started.getLong("generation");
                    long deadline = android.os.SystemClock.elapsedRealtime() + 5000; JSONObject state;
                    do { Thread.sleep(20); state = call(lease.service, "snapshot.get", new JSONObject(), null, null).getJSONObject("playback"); }
                    while (state.getBoolean("playing") && android.os.SystemClock.elapsedRealtime() < deadline);
                    assertFalse("Playback did not reach EOF", state.getBoolean("playing"));
                    assertTrue("Source did not render before EOF", state.getDouble("position") >= 0.20);
                }
            } finally { call(lease.service, "audio.stop", new JSONObject(), null, null); assertTrue(file.delete()); }
        }
    }
    @Test public void assetVersionsFollowUndoRedoAndBothSlotsWithoutRenderer() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            AudioService service = lease.service;
            NativeParameterPacker packer = new NativeParameterPacker(lease.context);
            JSONObject record = new JSONObject().put("id", 7101).put("type", "IRReverbPlugin").put("name", "IR Reverb")
                    .put("enabled", true).put("parameters", new JSONObject().put("lt", "0").put("cr", "full").put("dw", 0).put("de", false));
            packer.packRecord(record);
            call(service, "pipeline.set", packer.prepareRecords(new JSONArray().put(record), false, "A"), null, null);
            uploadImpulse(service, 7101, 1);
            String first = call(service, "snapshot.get", new JSONObject(), null, null).getJSONObject("assetRefs").toString();
            call(service, "pipeline.copySlot", new JSONObject().put("from", "A").put("to", "B"), null, null);
            uploadImpulse(service, 7101, 0.25f);
            String second = call(service, "snapshot.get", new JSONObject(), null, null).getJSONObject("assetRefs").toString();
            assertNotEquals(first, second);
            assertEquals(0.025, lease.outputPeak(), 0.005);
            assertEquals(first, call(service, "pipeline.undo", new JSONObject(), null, null).getJSONObject("assetRefs").toString());
            assertEquals(0.1, lease.outputPeak(), 0.005);
            assertEquals(second, call(service, "pipeline.redo", new JSONObject(), null, null).getJSONObject("assetRefs").toString());
            assertEquals(0.025, lease.outputPeak(), 0.005);
            assertEquals(first, call(service, "pipeline.slot", new JSONObject().put("slot", "B"), null, null).getJSONObject("assetRefs").toString());
            assertEquals(0.1, lease.outputPeak(), 0.005);
            assertEquals(second, call(service, "pipeline.slot", new JSONObject().put("slot", "A"), null, null).getJSONObject("assetRefs").toString());
            assertEquals(0.025, lease.outputPeak(), 0.005);
        }
    }

    @Test public void assetDefinitionCommitsWithItsVersionAndPreservesUnrelatedEdits() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            NativeParameterPacker packer = new NativeParameterPacker(lease.context);
            JSONObject record = new JSONObject().put("id", 7201).put("type", "IRReverbPlugin").put("name", "IR Reverb")
                    .put("enabled", true).put("parameters", new JSONObject().put("ir", "source-a").put("lt", "0").put("cr", "full").put("dw", 0));
            packer.packRecord(record);
            call(lease.service, "pipeline.set", packer.prepareRecords(new JSONArray().put(record), false, "A"), null, null);
            uploadImpulse(lease.service, 7201, 1, new JSONObject().put("ir", "source-a"));
            record.getJSONObject("parameters").put("ir", "source-b").put("dw", -6).put("inputBus", 2).put("outputBus", 3);
            packer.packRecord(record);
            JSONObject pending = call(lease.service, "pipeline.set", packer.prepareRecords(new JSONArray().put(record), false, "A"), null, null);
            assertEquals("source-a", pending.getJSONArray("pipeline").getJSONObject(0).getJSONObject("parameters").getString("ir"));
            assertEquals("source-a", pending.getJSONObject("pipelines").getJSONArray("A").getJSONObject(0)
                    .getJSONObject("parameters").getString("ir"));
            uploadImpulse(lease.service, 7201, 0.25f, new JSONObject().put("ir", "source-b"));
            JSONObject committed = call(lease.service, "snapshot.get", new JSONObject(), null, null);
            JSONObject params = committed.getJSONArray("pipeline").getJSONObject(0).getJSONObject("parameters");
            assertEquals("source-b", params.getString("ir")); assertEquals(-6, params.getInt("dw")); assertEquals(2, params.getInt("inputBus")); assertEquals(3, params.getInt("outputBus"));
            assertEquals("source-b", committed.getJSONObject("pipelines").getJSONArray("A").getJSONObject(0)
                    .getJSONObject("parameters").getString("ir"));
            assertEquals("source-b", committed.getJSONObject("assetDefinitions").getJSONObject("IRReverbPlugin:7201:0").getJSONObject("externalAssetParameters").getString("ir"));
            assertTrue(committed.getJSONArray("retainedAssetDefinitions").toString().contains("source-a"));
            JSONObject undo = call(lease.service, "pipeline.undo", new JSONObject(), null, null);
            params = undo.getJSONArray("pipeline").getJSONObject(0).getJSONObject("parameters");
            assertEquals("source-a", params.getString("ir")); assertEquals(-6, params.getInt("dw"));
            call(lease.service, "pipeline.asset.clear", new JSONObject().put("pluginId", 7201).put("slot", 0).put("externalAssetParameters", new JSONObject().put("ir", "")), null, null);
            JSONObject cleared = call(lease.service, "snapshot.get", new JSONObject(), null, null);
            assertEquals("", cleared.getJSONArray("pipeline").getJSONObject(0).getJSONObject("parameters").getString("ir"));
        }
    }
    @Test public void staleAssetRequestsCannotReplaceOrAbortTheCurrentRevision() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            NativeParameterPacker packer = new NativeParameterPacker(lease.context);
            JSONObject record = new JSONObject().put("id", 7301).put("type", "IRReverbPlugin").put("name", "IR Reverb")
                    .put("enabled", true).put("parameters", new JSONObject().put("lt", "0").put("cr", "full").put("dw", 0));
            packer.packRecord(record);
            long previous = call(lease.service, "pipeline.set", packer.prepareRecords(new JSONArray().put(record), false, "A"), null, null).getLong("revision");
            record.getJSONObject("parameters").put("dw", -6);
            packer.packRecord(record);
            long current = call(lease.service, "pipeline.set", packer.prepareRecords(new JSONArray().put(record), false, "A"), previous, null).getLong("revision");
            assertEquals(previous + 1, current);
            byte[] bytes = impulseBytes(0.5f);
            JSONObject target = new JSONObject().put("pluginId", 7301).put("slot", 0);
            JSONObject begin = new JSONObject(target.toString()).put("byteLength", bytes.length).put("formatTag", 1)
                    .put("processingChannels", 2).put("footprintBytes", 32 * 1024 * 1024);
            AtomicReference<AudioService.HostError> rejected = new AtomicReference<>();
            assertNull(call(lease.service, "pipeline.asset.begin", begin, previous, rejected));
            assertEquals("revision-conflict", rejected.get().code);
            assertEquals(current, call(lease.service, "pipeline.asset.begin", begin, current, null).getLong("revision"));
            assertNull(call(lease.service, "pipeline.asset.abort", target, previous, rejected));
            assertEquals("revision-conflict", rejected.get().code);
            JSONObject chunk = new JSONObject(target.toString()).put("offset", 0)
                    .put("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
            assertEquals(current, call(lease.service, "pipeline.asset.chunk", chunk, current, null).getLong("revision"));
            long committed = call(lease.service, "pipeline.asset.commit", target, current, null).getLong("revision");
            assertEquals(current + 1, committed);
            assertNull(call(lease.service, "pipeline.asset.clear", target, current, rejected));
            assertEquals("revision-conflict", rejected.get().code);
            assertTrue(call(lease.service, "snapshot.get", new JSONObject(), null, null).getJSONObject("assetRefs").has("IRReverbPlugin:7301:0"));
            assertEquals(committed + 1, call(lease.service, "pipeline.asset.clear", target, committed, null).getLong("revision"));
            assertFalse(call(lease.service, "snapshot.get", new JSONObject(), null, null).getJSONObject("assetRefs").has("IRReverbPlugin:7301:0"));
        }
    }
    @Test public void ownDeferredAssetCompletionDoesNotInvalidateGuardedSiblingChunks() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            int room = 7311, ir = 7312;
            NativeParameterPacker packer = new NativeParameterPacker(lease.context);
            JSONObject roomRecord = new JSONObject().put("id", room).put("type", "RoomEqPlugin").put("name", "Room EQ")
                    .put("enabled", true).put("parameters", new JSONObject().put("lt", "128").put("fd", 0));
            JSONObject irRecord = new JSONObject().put("id", ir).put("type", "IRReverbPlugin").put("name", "IR Reverb")
                    .put("enabled", true).put("parameters", new JSONObject().put("lt", "0").put("cr", "full"));
            packer.packRecord(roomRecord); packer.packRecord(irRecord);
            call(lease.service, "pipeline.set", packer.prepareRecords(new JSONArray().put(roomRecord).put(irRecord), false, "A"), null, null);
            NativeEngine engine = lease.onControl(() -> (NativeEngine) lease.field("engine"));
            assertEquals(0, (int) lease.onControl(engine::start));
            try {
                uploadImpulse(lease.service, room, 1, new JSONObject(), 128);
                String roomKey = "RoomEqPlugin:" + room + ":0";
                String first = call(lease.service, "snapshot.get", new JSONObject(), null, null)
                        .getJSONObject("assetRefs").getJSONObject(roomKey).getString("id");
                long frame = lease.onControl(engine::getAudioFrameTime);
                long deadline = android.os.SystemClock.elapsedRealtime() + 5000;
                while (lease.onControl(engine::getAudioFrameTime) - frame < 8192
                        && android.os.SystemClock.elapsedRealtime() < deadline)
                    android.os.SystemClock.sleep(10);
                assertTrue(lease.onControl(engine::getAudioFrameTime) - frame >= 8192);
                long base = call(lease.service, "snapshot.get", new JSONObject(), null, null).getLong("revision");
                String batch = java.util.UUID.randomUUID().toString();
                byte[] data = impulseBytes(0.5f);
                for (int id : new int[]{ir, room}) {
                    JSONObject begin = new JSONObject().put("pluginId", id).put("slot", 0).put("_assetBatch", batch)
                            .put("byteLength", data.length).put("formatTag", 1).put("headBlock", id == room ? 128 : 0)
                            .put("processingChannels", 2).put("footprintBytes", 32 * 1024 * 1024);
                    call(lease.service, "pipeline.asset.begin", begin, base, null);
                    int limit = id == ir ? 16 : data.length;
                    JSONObject chunk = new JSONObject().put("pluginId", id).put("slot", 0).put("_assetBatch", batch)
                            .put("offset", 0).put("data", android.util.Base64.encodeToString(data, 0, limit, android.util.Base64.NO_WRAP));
                    call(lease.service, "pipeline.asset.chunk", chunk, base, null);
                }
                JSONObject roomTarget = new JSONObject().put("pluginId", room).put("slot", 0).put("_assetBatch", batch);
                assertEquals("pending", call(lease.service, "pipeline.asset.commit", roomTarget, base, null).getString("state"));
                long advanced = base;
                deadline = android.os.SystemClock.elapsedRealtime() + 5000;
                while (advanced == base && android.os.SystemClock.elapsedRealtime() < deadline) {
                    advanced = call(lease.service, "snapshot.get", new JSONObject(), null, null).getLong("revision");
                    android.os.SystemClock.sleep(10);
                }
                assertEquals(base + 1, advanced);
                JSONObject sibling = new JSONObject().put("pluginId", ir).put("slot", 0).put("_assetBatch", batch);
                JSONObject lastChunk = new JSONObject(sibling.toString()).put("offset", 16)
                        .put("data", android.util.Base64.encodeToString(data, 16, data.length - 16, android.util.Base64.NO_WRAP));
                AtomicReference<AudioService.HostError> rejected = new AtomicReference<>();
                JSONObject competitor = new JSONObject(lastChunk.toString()).put("_assetBatch", java.util.UUID.randomUUID().toString());
                assertNull(call(lease.service, "pipeline.asset.chunk", competitor, base, rejected));
                assertEquals("revision-conflict", rejected.get().code);
                assertEquals(advanced, call(lease.service, "pipeline.asset.chunk", lastChunk, base, null).getLong("revision"));
                String latest = call(lease.service, "snapshot.get", new JSONObject(), null, null)
                        .getJSONObject("assetRefs").getJSONObject(roomKey).getString("id");
                assertNotEquals(first, latest);
                frame = lease.onControl(engine::getAudioFrameTime);
                deadline = android.os.SystemClock.elapsedRealtime() + 5000;
                while (lease.onControl(engine::getAudioFrameTime) - frame < 8192
                        && android.os.SystemClock.elapsedRealtime() < deadline)
                    android.os.SystemClock.sleep(10);
                assertTrue(lease.onControl(engine::getAudioFrameTime) - frame >= 8192);
                int beforeUndo = lease.onControl(() -> ((java.util.List<?>) lease.field("undo")).size());
                lease.onControl(() -> { engine.stop(); return null; });
                JSONObject undo = call(lease.service, "pipeline.undo", new JSONObject(), advanced, null);
                assertEquals(latest, undo.getJSONObject("assetRefs").getJSONObject(roomKey).getString("id"));
                assertNull(call(lease.service, "pipeline.asset.commit", sibling, advanced, rejected));
                assertEquals("revision-conflict", rejected.get().code);
                call(lease.service, "pipeline.asset.abort", sibling, null, null);
                assertEquals(0, (int) lease.onControl(engine::start));
                String restored = latest;
                deadline = android.os.SystemClock.elapsedRealtime() + 5000;
                while (restored.equals(latest) && android.os.SystemClock.elapsedRealtime() < deadline) {
                    restored = call(lease.service, "snapshot.get", new JSONObject(), null, null)
                            .getJSONObject("assetRefs").getJSONObject(roomKey).getString("id");
                    android.os.SystemClock.sleep(10);
                }
                assertEquals(first, restored);
                assertEquals(beforeUndo - 1, (int) lease.onControl(() -> ((java.util.List<?>) lease.field("undo")).size()));
                assertEquals(1, (int) lease.onControl(() -> ((java.util.List<?>) lease.field("redo")).size()));
            } finally {
                lease.onControl(() -> { engine.stop(); return null; });
            }
        }
    }

    @Test public void stoppedSlotAndHistorySelectionsKeepTheirOwnDeferredFiles() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            int room = 7321;
            String key = "RoomEqPlugin:" + room + ":0";
            NativeParameterPacker packer = new NativeParameterPacker(lease.context);
            JSONObject record = new JSONObject().put("id", room).put("type", "RoomEqPlugin").put("name", "Room EQ")
                    .put("enabled", true).put("parameters", new JSONObject().put("lt", "128").put("fd", 0));
            packer.packRecord(record);
            call(lease.service, "pipeline.set", packer.prepareRecords(new JSONArray().put(record), false, "A"), null, null);
            NativeEngine engine = lease.onControl(() -> (NativeEngine) lease.field("engine"));
            assertEquals(0, (int) lease.onControl(engine::start));
            try {
                uploadImpulse(lease.service, room, 1, new JSONObject(), 128);
                String fileA = assetId(call(lease.service, "snapshot.get", new JSONObject(), null, null), key);
                awaitFrames(lease, engine);
                call(lease.service, "pipeline.copySlot", new JSONObject().put("from", "A").put("to", "B"), null, null);
                call(lease.service, "pipeline.slot", new JSONObject().put("slot", "B"), null, null);
                uploadImpulse(lease.service, room, 0.5f, new JSONObject(), 128);
                String fileB = awaitChangedAsset(lease.service, key, fileA);
                awaitFrames(lease, engine);
                lease.onControl(() -> { engine.stop(); return null; });

                for (String selected : new String[]{"A", "B", "A", "B"}) {
                    JSONObject snapshot = call(lease.service, "pipeline.slot", new JSONObject().put("slot", selected), null, null);
                    assertEquals(fileB, assetId(snapshot, key));
                    assertSavedSelection(lease, key, selected, fileA, fileB);
                }
                assertEquals(fileB, assetId(call(lease.service, "pipeline.undo", new JSONObject(), null, null), key));
                assertSavedSelection(lease, key, "A", fileA, fileB);
                assertEquals(fileB, assetId(call(lease.service, "pipeline.redo", new JSONObject(), null, null), key));
                assertSavedSelection(lease, key, "B", fileA, fileB);
                call(lease.service, "pipeline.undo", new JSONObject(), null, null);
                assertSavedSelection(lease, key, "A", fileA, fileB);
                assertEquals(0, (int) lease.onControl(engine::start));
                assertEquals(fileA, awaitChangedAsset(lease.service, key, fileB));
                awaitFrames(lease, engine);
                call(lease.service, "pipeline.redo", new JSONObject(), null, null);
                assertEquals(fileB, awaitChangedAsset(lease.service, key, fileA));
                assertSavedSelection(lease, key, "B", fileA, fileB);
            } finally {
                lease.onControl(() -> { engine.stop(); return null; });
            }
        }
    }

    private static String assetId(JSONObject pipeline, String key) throws Exception {
        return pipeline.getJSONObject("assetRefs").getJSONObject(key).getString("id");
    }

    private static void assertSavedSelection(ServiceLease lease, String key, String selected, String fileA, String fileB) throws Exception {
        android.content.SharedPreferences preferences = lease.service.getSharedPreferences("audio", Context.MODE_PRIVATE);
        JSONObject slots = new JSONObject(preferences.getString("slots", "{}"));
        JSONObject pipeline = new JSONObject(preferences.getString("pipeline", "{}"));
        assertEquals(fileA, assetId(slots.getJSONObject("A"), key));
        assertEquals(fileB, assetId(slots.getJSONObject("B"), key));
        assertEquals(selected, pipeline.getString("slot"));
        assertEquals(selected.equals("A") ? fileA : fileB, assetId(pipeline, key));
    }

    private static String awaitChangedAsset(AudioService service, String key, String original) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 5000;
        do {
            String current = assetId(call(service, "snapshot.get", new JSONObject(), null, null), key);
            if (!current.equals(original)) return current;
            android.os.SystemClock.sleep(10);
        } while (android.os.SystemClock.elapsedRealtime() < deadline);
        throw new AssertionError("The selected asset did not become resident");
    }

    private static void awaitFrames(ServiceLease lease, NativeEngine engine) throws Exception {
        long start = lease.onControl(engine::getAudioFrameTime);
        long deadline = android.os.SystemClock.elapsedRealtime() + 5000;
        while (lease.onControl(engine::getAudioFrameTime) - start < 8192
                && android.os.SystemClock.elapsedRealtime() < deadline)
            android.os.SystemClock.sleep(10);
        assertTrue(lease.onControl(engine::getAudioFrameTime) - start >= 8192);
    }

    private byte[] impulseBytes(float gain) {
        return java.nio.ByteBuffer.allocate(36).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                .putInt(0x31415445).putInt(1).putInt(1).putInt(48000).putInt(1).putInt(0).putInt(0).putInt(0).putFloat(gain).array();
    }
    private void uploadImpulse(AudioService service, int id, float gain) throws Exception { uploadImpulse(service, id, gain, new JSONObject()); }
    private void uploadImpulse(AudioService service, int id, float gain, JSONObject parameters) throws Exception {
        uploadImpulse(service, id, gain, parameters, 0);
    }
    private void uploadImpulse(AudioService service, int id, float gain, JSONObject parameters, int headBlock) throws Exception {
        byte[] bytes = impulseBytes(gain);
        call(service, "pipeline.asset.begin", new JSONObject().put("pluginId", id).put("slot", 0).put("byteLength", bytes.length)
                .put("formatTag", 1).put("headBlock", headBlock).put("processingChannels", 2).put("footprintBytes", 32 * 1024 * 1024)
                .put("externalAssetSignature", parameters.toString()).put("externalAssetParameters", parameters), null, null);
        call(service, "pipeline.asset.chunk", new JSONObject().put("pluginId", id).put("slot", 0).put("offset", 0)
                .put("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)), null, null);
        call(service, "pipeline.asset.commit", new JSONObject().put("pluginId", id).put("slot", 0), null, null);
    }

    static final class ServiceLease implements AutoCloseable {
        final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        final AudioService service;
        final android.os.Handler control;
        final ServiceConnection connection;
        final JSONObject pipeline;
        final java.util.HashMap<String, JSONObject> slots;
        final java.util.ArrayList<JSONObject> undo, redo;
        ServiceLease() throws Exception {
            CountDownLatch connected = new CountDownLatch(1); AtomicReference<AudioService> value = new AtomicReference<>();
            connection = new ServiceConnection() {
                @Override public void onServiceConnected(ComponentName name, IBinder binder) { value.set(((AudioService.LocalBinder) binder).getService()); connected.countDown(); }
                @Override public void onServiceDisconnected(ComponentName name) { }
            };
            assertTrue(context.bindService(new Intent(context, AudioService.class), connection, Context.BIND_AUTO_CREATE));
            assertTrue(connected.await(10, TimeUnit.SECONDS)); service = value.get();
            control = (android.os.Handler) field("control");
            pipeline = onControl(() -> field("pipelineRequest") == null ? null : new JSONObject(field("pipelineRequest").toString()));
            slots = onControl(() -> new java.util.HashMap<>((java.util.HashMap<String, JSONObject>) field("slots")));
            undo = onControl(() -> new java.util.ArrayList<>((java.util.ArrayList<JSONObject>) field("undo")));
            redo = onControl(() -> new java.util.ArrayList<>((java.util.ArrayList<JSONObject>) field("redo")));
        }
        Object field(String name) throws Exception { java.lang.reflect.Field field = AudioService.class.getDeclaredField(name); field.setAccessible(true); return field.get(service); }
        <T> T onControl(java.util.concurrent.Callable<T> action) throws Exception {
            CountDownLatch done = new CountDownLatch(1); AtomicReference<T> value = new AtomicReference<>(); AtomicReference<Throwable> failure = new AtomicReference<>();
            control.post(() -> { try { value.set(action.call()); } catch (Throwable error) { failure.set(error); } finally { done.countDown(); } });
            assertTrue(done.await(15, TimeUnit.SECONDS)); if (failure.get() != null) throw new AssertionError(failure.get()); return value.get();
        }
        float outputPeak() throws Exception {
            return onControl(() -> {
                NativeEngine engine = (NativeEngine) field("engine"); engine.setPlayerGain(1); engine.prepareResume(); long generation = engine.beginSource();
                try {
                long before = engine.getRenderedFrames(); float[] samples = new float[9600]; java.util.Arrays.fill(samples, 0.1f);
                assertEquals(4800, engine.writePcm(samples, 4800, generation)); engine.setPlaying(true); assertEquals(0, engine.start());
                long deadline = android.os.SystemClock.elapsedRealtime() + 3000; float peak = 0;
                while (engine.getRenderedFrames() < before + 4800 && android.os.SystemClock.elapsedRealtime() < deadline) {
                    peak = Math.max(peak, engine.getPowerObservation()[2]); Thread.sleep(2);
                }
                peak = Math.max(peak, engine.getPowerObservation()[2]);
                assertEquals(before + 4800, engine.getRenderedFrames()); return peak;
                } finally {
                    engine.setPlaying(false); engine.stop();
                    engine.setPlayerGain((boolean) field("muted") ? 0 : (float) field("volume"));
                }
            });
        }
        @Override public void close() throws Exception {
            try { onControl(() -> {
                ((NativeEngine) field("engine")).stop();
                if (pipeline != null) { java.lang.reflect.Method apply = AudioService.class.getDeclaredMethod("applyPipeline", JSONObject.class); apply.setAccessible(true); apply.invoke(service, pipeline); }
                java.util.Map<String, JSONObject> currentSlots = (java.util.Map<String, JSONObject>) field("slots"); currentSlots.clear(); currentSlots.putAll(slots);
                java.util.List<JSONObject> currentUndo = (java.util.List<JSONObject>) field("undo"); currentUndo.clear(); currentUndo.addAll(undo);
                java.util.List<JSONObject> currentRedo = (java.util.List<JSONObject>) field("redo"); currentRedo.clear(); currentRedo.addAll(redo);
                java.lang.reflect.Method persist = AudioService.class.getDeclaredMethod("persistSlots"); persist.setAccessible(true); persist.invoke(service); return null;
            }); } finally { context.unbindService(connection); }
        }
    }
    private static String assetText(Context context, String name) throws Exception {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        try (java.io.InputStream input = context.getAssets().open("web/" + name)) {
            byte[] buffer = new byte[8192]; int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        }
        return output.toString("UTF-8");
    }

    @Test public void nativePackingMatchesEveryGeneratedBrowserFixture() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeParameterPacker packer = new NativeParameterPacker(context);
        JSONArray fixtures = new JSONArray(assetText(context, "android-packing-fixtures.json"));
        int effectCount = new JSONObject(assetText(context, "android-dsp-contract.json")).getJSONArray("specs").length();
        assertEquals(effectCount * 2, fixtures.length());
        for (int index = 0; index < fixtures.length(); index++) {
            JSONObject fixture = fixtures.getJSONObject(index);
            String label = fixture.getString("type") + ":" + fixture.getString("name");
            JSONObject record = new JSONObject().put("type", fixture.getString("type")).put("parameters", fixture.getJSONObject("parameters"));
            packer.packRecord(record);
            JSONArray expected = fixture.getJSONArray("floats"), actual = record.getJSONArray("parameterValues");
            assertEquals(label, expected.length(), actual.length());
            for (int n = 0; n < expected.length(); n++) assertEquals(label + "[" + n + "]", Float.floatToRawIntBits((float) expected.getDouble(n)), Float.floatToRawIntBits((float) actual.getDouble(n)));
            assertEquals(label, fixture.getString("bytes"), record.optString("parameterBytes", ""));
        }
    }

    @Test public void temporalConditionsMatchCanonicalPluginMethods() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeParameterPacker packer = new NativeParameterPacker(context);
        JSONArray fixtures = new JSONArray(assetText(context, "android-temporal-fixtures.json"));
        int effectCount = new JSONObject(assetText(context, "android-dsp-contract.json")).getJSONArray("specs").length();
        assertTrue(fixtures.length() >= effectCount * 2);
        for (int i = 0; i < fixtures.length(); i++) {
            JSONObject fixture = fixtures.getJSONObject(i), params = fixture.getJSONObject("parameters");
            JSONObject record = new JSONObject().put("type", fixture.getString("type")).put("parameters", params).put("enabled", params.optBoolean("enabled", true));
            assertEquals(fixture.toString(), fixture.getBoolean("mustProcess"), packer.mustProcess(record));
        }
        JSONObject oscillator = new JSONObject().put("id", 1).put("type", "OscillatorPlugin").put("parameters", new JSONObject()).put("enabled", true);
        JSONObject section = new JSONObject().put("id", 2).put("type", "SectionPlugin").put("parameters", new JSONObject()).put("enabled", false);
        assertTrue(packer.prepareRecords(new JSONArray().put(oscillator), false, "A").getBoolean("temporalMustProcess"));
        assertFalse(packer.prepareRecords(new JSONArray().put(oscillator), true, "A").getBoolean("temporalMustProcess"));
        assertFalse(packer.prepareRecords(new JSONArray().put(section).put(oscillator), false, "A").getBoolean("temporalMustProcess"));
    }

    @Test public void queuedReplacementIsAtomicAndDurable() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(app.getCacheDir(), "queue-test-" + UUID.randomUUID());
        assertTrue(directory.mkdir());
        Context isolated = new ContextWrapper(app) {
            @Override public SQLiteDatabase openOrCreateDatabase(String name, int mode, SQLiteDatabase.CursorFactory factory) {
                return SQLiteDatabase.openOrCreateDatabase(new File(directory, name), factory);
            }
        };
        try {
            try (PlaybackQueueStore store = new PlaybackQueueStore(isolated)) {
                store.begin(); store.append(new JSONArray().put(new JSONObject().put("uri", "content://test/first")));
                store.commit(new JSONObject().put("index", 0));
                store.begin();
                for (int batch = 0; batch < 70; batch++) {
                    JSONArray items = new JSONArray();
                    for (int i = 0; i < 64; i++) items.put(new JSONObject().put("uri", "content://test/" + (batch * 64 + i)));
                    store.append(items);
                }
                assertEquals(1, store.length());
                assertEquals("content://test/first", store.getJSONObject(0).getString("uri"));
                store.commit(new JSONObject().put("index", 4097));
                assertEquals(4480, store.length());
            }
            try (PlaybackQueueStore restored = new PlaybackQueueStore(isolated)) {
                assertEquals(4480, restored.length());
                assertEquals(4097, restored.settings().getInt("index"));
                assertEquals("content://test/4097", restored.getJSONObject(4097).getString("uri"));
                restored.begin(); restored.append(new JSONArray().put(new JSONObject().put("uri", "content://test/cancelled"))); restored.abort();
                assertEquals(4480, restored.length());
            }
        } finally {
            File[] files = directory.listFiles();
            if (files != null) for (File file : files) assertTrue(file.delete());
            assertTrue(directory.delete());
        }
    }

    @Test public void staleUiCannotOverwriteServiceState() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AtomicReference<AudioService> service = new AtomicReference<>();
        CountDownLatch connected = new CountDownLatch(1);
        ServiceConnection connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder binder) { service.set(((AudioService.LocalBinder) binder).getService()); connected.countDown(); }
            @Override public void onServiceDisconnected(ComponentName name) { }
        };
        assertTrue(context.bindService(new Intent(context, AudioService.class), connection, Context.BIND_AUTO_CREATE));
        try {
            assertTrue(connected.await(10, TimeUnit.SECONDS));
            java.lang.reflect.Field revision = AudioService.class.getDeclaredField("revision"); revision.setAccessible(true);
            java.lang.reflect.Field pipeline = AudioService.class.getDeclaredField("pipeline"); pipeline.setAccessible(true);
            java.lang.reflect.Method command = AudioService.class.getDeclaredMethod("command", JSONObject.class, AudioService.Reply.class, boolean.class, java.util.function.BooleanSupplier.class); command.setAccessible(true);
            AtomicReference<Long> beforeRevision = new AtomicReference<>(); AtomicReference<String> beforePipeline = new AtomicReference<>();
            CountDownLatch completed = new CountDownLatch(1); AtomicReference<Throwable> failure = new AtomicReference<>();
            java.util.function.BooleanSupplier observe = () -> {
                try { beforeRevision.set(revision.getLong(service.get())); beforePipeline.set(pipeline.get(service.get()).toString()); return true; }
                catch (Exception error) { throw new AssertionError(error); }
            };
            AudioService.Reply reply = (value, rejected) -> {
                try {
                    assertNotNull(rejected); assertEquals("revision-conflict", rejected.code);
                    assertEquals(beforeRevision.get().longValue(), revision.getLong(service.get()));
                    assertEquals(beforePipeline.get(), pipeline.get(service.get()).toString());
                } catch (Throwable error) { failure.set(error); } finally { completed.countDown(); }
            };
            JSONObject request = new JSONObject().put("command", "pipeline.set").put("expectedRevision", -1)
                    .put("payload", new JSONObject().put("plugins", new JSONArray()).put("descriptor", "AQAAAAAAAAA="));
            command.invoke(service.get(), request, reply, false, observe);
            assertTrue(completed.await(10, TimeUnit.SECONDS));
            if (failure.get() != null) throw new AssertionError(failure.get());
        } finally { context.unbindService(connection); }
    }

    static JSONObject call(AudioService service, String command, JSONObject payload, Long revision,
                            AtomicReference<AudioService.HostError> error) throws Exception {
        JSONObject request = new JSONObject().put("command", command).put("payload", payload);
        if (revision != null) request.put("expectedRevision", revision);
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<JSONObject> result = new AtomicReference<>();
        AtomicReference<AudioService.HostError> failure = error == null ? new AtomicReference<>() : error;
        service.command(request, (value, problem) -> { result.set(value); failure.set(problem); completed.countDown(); }, false);
        assertTrue(completed.await(10, TimeUnit.SECONDS));
        if (error == null) assertNull(failure.get());
        return result.get();
    }
}

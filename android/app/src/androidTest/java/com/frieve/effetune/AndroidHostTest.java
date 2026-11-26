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
    @Test public void backgroundAcknowledgmentsReachTheRemoteClientWhileNewConnectionsRequireVisibility() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            JSONObject ack = call(lease.service, "remoteClient.send", AudioService.object("connectionId", "expired", "received", 1), null, null);
            assertFalse(ack.getBoolean("sent"));
            AtomicReference<AudioService.HostError> error = new AtomicReference<>();
            call(lease.service, "remoteClient.connect", new JSONObject(), null, error);
            assertEquals("visible-start-required", error.get().code);
        }
    }

    @Test public void aSecondDeviceRespondsWhileTheFirstDeviceIsStillWaiting() throws Exception {
        try (LanHttp http = new LanHttp();
             java.net.ServerSocket slow = new java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"));
             java.net.ServerSocket fast = new java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.2"))) {
            slow.setSoTimeout(5000);
            fast.setSoTimeout(5000);
            CountDownLatch slowDone = new CountDownLatch(1);
            http.request(AudioService.object("url", "http://127.0.0.1:" + slow.getLocalPort(), "timeout", 20000),
                    "slow", (value, error) -> slowDone.countDown(), null);
            try (java.net.Socket waiting = slow.accept()) {
                java.util.concurrent.CompletableFuture<JSONObject> result = new java.util.concurrent.CompletableFuture<>();
                http.request(AudioService.object("url", "http://127.0.0.2:" + fast.getLocalPort()), "fast", (value, error) -> {
                    if (error == null) result.complete(value); else result.completeExceptionally(error);
                }, null);
                try (java.net.Socket serving = fast.accept()) {
                    serving.setSoTimeout(5000);
                    java.io.BufferedReader input = new java.io.BufferedReader(new java.io.InputStreamReader(serving.getInputStream(),
                            java.nio.charset.StandardCharsets.US_ASCII));
                    String line;
                    while ((line = input.readLine()) != null && !line.isEmpty()) { }
                    serving.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
                    assertEquals("ok", result.get(5, TimeUnit.SECONDS).getString("text"));
                    assertEquals(1, slowDone.getCount());
                }
            }
        }
    }

    @Test public void publicQueuePagesFitTheBridgeAndResumeAtTheNextTrack() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            Context isolated = new ContextWrapper(lease.context) {
                @Override public SQLiteDatabase openOrCreateDatabase(String name, int mode, SQLiteDatabase.CursorFactory factory) {
                    return SQLiteDatabase.create(null);
                }
            };
            try (PlaybackQueueStore queue = new PlaybackQueueStore(isolated)) {
                String title = "曲\"".repeat(700);
                JSONArray rows = new JSONArray();
                for (int i = 0; i < 400; i++) rows.put(new JSONObject().put("uri", "content://test/" + i).put("title", title));
                queue.replace(rows);
                lease.onControl(() -> {
                    java.lang.reflect.Field field = AudioService.class.getDeclaredField("queue");
                    field.setAccessible(true);
                    Object previous = field.get(lease.service);
                    java.lang.reflect.Method page = AudioService.class.getDeclaredMethod("musicPlayback", int.class, int.class, String.class);
                    page.setAccessible(true);
                    try {
                        field.set(lease.service, queue);
                        int start = 0;
                        while (start < rows.length()) {
                            JSONObject state = (JSONObject) page.invoke(lease.service, start, 500, "page");
                            JSONArray items = state.getJSONArray("queue");
                            assertEquals(start, state.getInt("start"));
                            assertEquals(items.length(), state.getInt("numberReturned"));
                            assertTrue(items.length() > 0 && items.length() < rows.length());
                            String envelope = AudioService.object("version", 1, "id", "page", "ok", true, "result", state).toString();
                            assertTrue(envelope.getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 1024 * 1024);
                            for (int j = 0; j < items.length(); j++) assertEquals("content://test/" + start++, items.getJSONObject(j).getString("uri"));
                        }
                        assertEquals(rows.length(), start);
                    } finally { field.set(lease.service, previous); }
                    return null;
                });
            }
        }
    }

    @Test public void nativeRemoteParameterEditPreservesHostRouting() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            NativeParameterPacker packer = new NativeParameterPacker(lease.context);
            JSONObject record = new JSONObject().put("id", 7102).put("type", "VolumePlugin").put("name", "Volume").put("enabled", true)
                    .put("parameters", new JSONObject().put("vl", -3).put("inputBus", 2).put("outputBus", 3).put("channel", "R"));
            packer.packRecord(record);
            call(lease.service, "pipeline.set", packer.prepareRecords(new JSONArray().put(record), false, "A"), null, null);
            lease.onControl(() -> {
                java.lang.reflect.Method dispatch = AudioService.class.getDeclaredMethod("dispatchRemote", JSONObject.class, java.util.function.Consumer.class,
                        java.util.function.BooleanSupplier.class, java.util.function.BooleanSupplier.class);
                dispatch.setAccessible(true);
                AtomicReference<JSONObject> reply = new AtomicReference<>();
                java.util.function.BooleanSupplier granted = () -> true;
                dispatch.invoke(lease.service, new JSONObject().put("op", "params").put("seq", 1).put("index", 0).put("params", new JSONObject().put("vl", -6)),
                        (java.util.function.Consumer<JSONObject>) reply::set, granted, granted);
                assertNotNull("Remote edit was not acknowledged", reply.get());
                assertTrue(reply.get().toString(), reply.get().optBoolean("ok"));
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
        // Playback starts only while the app is visible, so show the real Activity first.
        try (androidx.test.core.app.ActivityScenario<MainActivity> scenario = androidx.test.core.app.ActivityScenario.launch(MainActivity.class);
             ServiceLease lease = new ServiceLease()) {
            AndroidWebHostTest.awaitReady(scenario);
            File directory = new File(lease.context.getCacheDir(), "imports"); assertTrue(directory.isDirectory() || directory.mkdirs());
            File file = File.createTempFile("eof-", ".wav", directory);
            Object owner = new Object();
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
                // A natural end selects 0 s again, so the rendered span is timed up to the end event.
                java.util.concurrent.atomic.AtomicLong endedAt = new java.util.concurrent.atomic.AtomicLong();
                lease.service.attach(owner, (name, snapshot) -> { if (name.equals("playback-ended")) endedAt.set(android.os.SystemClock.elapsedRealtime()); }, true);
                long previousGeneration = -1;
                for (int replay = 0; replay < 2; replay++) {
                    long playAt = android.os.SystemClock.elapsedRealtime();
                    JSONObject started = call(lease.service, "playback.play", new JSONObject(), null, null).getJSONObject("playback");
                    assertTrue(started.getBoolean("playing"));
                    assertTrue(started.getLong("generation") > previousGeneration); previousGeneration = started.getLong("generation");
                    long deadline = android.os.SystemClock.elapsedRealtime() + 5000; JSONObject state;
                    do { Thread.sleep(20); state = call(lease.service, "snapshot.get", new JSONObject(), null, null).getJSONObject("playback"); }
                    while (state.getBoolean("playing") && android.os.SystemClock.elapsedRealtime() < deadline);
                    assertFalse("Playback did not reach EOF", state.getBoolean("playing"));
                    assertTrue("Source did not render before EOF", endedAt.get() - playAt >= 200);
                }
            } finally { lease.service.detach(owner); call(lease.service, "audio.stop", new JSONObject(), null, null); assertTrue(file.delete()); }
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
            assertEquals(first, call(service, "pipeline.slot", new JSONObject().put("slot", "A"), null, null).getJSONObject("assetRefs").toString());
            assertEquals(0.1, lease.outputPeak(), 0.005);
            assertEquals(second, call(service, "pipeline.slot", new JSONObject().put("slot", "B"), null, null).getJSONObject("assetRefs").toString());
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
            assertFalse(pending.has("pipeline"));
            assertEquals("source-a", pending.getJSONObject("pipelines").getJSONArray("A").getJSONObject(0)
                    .getJSONObject("parameters").getString("ir"));
            uploadImpulse(lease.service, 7201, 0.25f, new JSONObject().put("ir", "source-b"));
            JSONObject committed = call(lease.service, "snapshot.get", new JSONObject(), null, null);
            JSONObject params = committed.getJSONObject("pipelines").getJSONArray("A").getJSONObject(0).getJSONObject("parameters");
            assertEquals("source-b", params.getString("ir")); assertEquals(-6, params.getInt("dw")); assertEquals(2, params.getInt("inputBus")); assertEquals(3, params.getInt("outputBus"));
            assertEquals("source-b", committed.getJSONObject("pipelines").getJSONArray("A").getJSONObject(0)
                    .getJSONObject("parameters").getString("ir"));
            assertEquals("source-b", committed.getJSONObject("assetDefinitions").getJSONObject("IRReverbPlugin:7201:0").getJSONObject("externalAssetParameters").getString("ir"));
            assertTrue(committed.getJSONArray("retainedAssetDefinitions").toString().contains("source-a"));
            JSONObject undo = call(lease.service, "pipeline.undo", new JSONObject(), null, null);
            params = undo.getJSONObject("pipelines").getJSONArray("A").getJSONObject(0).getJSONObject("parameters");
            assertEquals("source-a", params.getString("ir")); assertEquals(-6, params.getInt("dw"));
            call(lease.service, "pipeline.asset.clear", new JSONObject().put("pluginId", 7201).put("slot", 0).put("externalAssetParameters", new JSONObject().put("ir", "")), null, null);
            JSONObject cleared = call(lease.service, "snapshot.get", new JSONObject(), null, null);
            assertEquals("", cleared.getJSONObject("pipelines").getJSONArray("A").getJSONObject(0).getJSONObject("parameters").getString("ir"));
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
                roomRecord.getJSONObject("parameters").put("fd", 64);
                packer.packRecord(roomRecord);
                long base = call(lease.service, "pipeline.set", packer.prepareRecords(new JSONArray().put(roomRecord).put(irRecord), false, "A"), null, null).getLong("revision");
                int editedHistorySize = lease.onControl(() -> ((java.util.List<?>) lease.field("undo")).size());
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
                String latest = awaitChangedAsset(lease.service, roomKey, first);
                long advanced = call(lease.service, "snapshot.get", new JSONObject(), null, null).getLong("revision");
                assertEquals(base, advanced);
                assertEquals(editedHistorySize, (int) lease.onControl(() -> ((java.util.List<?>) lease.field("undo")).size()));
                JSONObject sibling = new JSONObject().put("pluginId", ir).put("slot", 0).put("_assetBatch", batch);
                JSONObject lastChunk = new JSONObject(sibling.toString()).put("offset", 16)
                        .put("data", android.util.Base64.encodeToString(data, 16, data.length - 16, android.util.Base64.NO_WRAP));
                AtomicReference<AudioService.HostError> rejected = new AtomicReference<>();
                JSONObject competitor = new JSONObject(lastChunk.toString()).put("_assetBatch", java.util.UUID.randomUUID().toString());
                assertNull(call(lease.service, "pipeline.asset.chunk", competitor, base, rejected));
                assertEquals("revision-conflict", rejected.get().code);
                assertEquals(advanced, call(lease.service, "pipeline.asset.chunk", lastChunk, base, null).getLong("revision"));
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

    @Test public void stoppedBlindTestRendersRoomEqAssetsInBothBranches() throws Exception {
        try (androidx.test.core.app.ActivityScenario<MainActivity> scenario = androidx.test.core.app.ActivityScenario.launch(MainActivity.class);
             ServiceLease lease = new ServiceLease()) {
            AndroidWebHostTest.awaitReady(scenario);
            NativeParameterPacker packer = new NativeParameterPacker(lease.context);
            int id = 7331;
            JSONObject record = new JSONObject().put("id", id).put("type", "RoomEqPlugin").put("name", "Room EQ")
                    .put("enabled", true).put("parameters", new JSONObject().put("lt", "128").put("fd", 0));
            packer.packRecord(record);
            JSONArray records = new JSONArray().put(record);
            call(lease.service, "pipeline.set", packer.prepareRecords(records, false, "A"), null, null);
            JSONObject stopped = call(lease.service, "audio.stop", new JSONObject(), null, null);
            uploadImpulse(lease.service, id, 1, new JSONObject(), 128);
            call(lease.service, "pipeline.copySlot", new JSONObject().put("from", "A").put("to", "B"), null, null);
            JSONObject required = new JSONObject().put("RoomEqPlugin:" + id + ":0", "{}");
            JSONObject branch = packer.prepareRecords(records, false, "A").put("sampleRate", stopped.getInt("sampleRate"))
                    .put("channelCount", stopped.getInt("channelCount")).put("storedAssets", required).put("prepareAssets", true);
            try {
                call(lease.service, "dbt.start", new JSONObject().put("pipeline", branch), null, null);
                JSONObject align = new JSONObject().put("primary", required).put("secondary", required);
                long deadline = android.os.SystemClock.elapsedRealtime() + 10000;
                while (!call(lease.service, "dbt.align", align, null, null).getBoolean("ready")) {
                    assertTrue("Room EQ assets did not become active", android.os.SystemClock.elapsedRealtime() < deadline);
                    android.os.SystemClock.sleep(40);
                }
                assertFalse(lease.onControl(() -> (boolean) lease.field("preparingBlindAssets")));
            } finally {
                call(lease.service, "dbt.stop", new JSONObject(), null, null);
                call(lease.service, "audio.stop", new JSONObject(), null, null);
            }
        }
    }

    @Test public void firstToggleAndExplicitCopyRestoreBothSlotsAndSelectionOnUndo() throws Exception {
        try (ServiceLease lease = new ServiceLease()) {
            NativeParameterPacker packer = new NativeParameterPacker(lease.context);
            JSONObject record = new JSONObject().put("id", 7410).put("type", "VolumePlugin").put("name", "Volume")
                    .put("enabled", true).put("parameters", new JSONObject().put("vl", -9));
            packer.packRecord(record);
            JSONObject a = packer.prepareRecords(new JSONArray().put(record), false, "A");
            call(lease.service, "dbt.restore", new JSONObject().put("a", a), null, null);
            JSONObject both = call(lease.service, "pipeline.slot", new JSONObject().put("slot", "B"), null, null);
            assertEquals("B", both.getString("slot"));
            assertEquals(both.getJSONObject("pipelines").getJSONArray("A").toString(), both.getJSONObject("pipelines").getJSONArray("B").toString());
            JSONObject before = call(lease.service, "pipeline.undo", new JSONObject(), null, null);
            assertEquals("A", before.getString("slot"));
            assertTrue(before.getJSONObject("pipelines").isNull("B"));
            call(lease.service, "pipeline.redo", new JSONObject(), null, null);
            call(lease.service, "pipeline.set", packer.prepareRecords(new JSONArray(), false, "B"), null, null);
            call(lease.service, "pipeline.slot", new JSONObject().put("slot", "A"), null, null);
            JSONObject copy = call(lease.service, "pipeline.copySlot", new JSONObject().put("from", "A").put("to", "B"), null, null);
            assertEquals("B", copy.getString("slot"));
            assertEquals(1, copy.getJSONObject("pipelines").getJSONArray("B").length());
            before = call(lease.service, "pipeline.undo", new JSONObject(), null, null);
            assertEquals("A", before.getString("slot"));
            assertEquals(0, before.getJSONObject("pipelines").getJSONArray("B").length());
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
            // A removed task has already shut the Service down, leaving nothing to restore.
            try { if (!(boolean) field("destroyed")) onControl(() -> {
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

    @Test public void queueGainUpdatesFollowEntryIdsAndKeepPrivateSources() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context isolated = new ContextWrapper(app) {
            @Override public SQLiteDatabase openOrCreateDatabase(String name, int mode, SQLiteDatabase.CursorFactory factory) {
                return SQLiteDatabase.create(null);
            }
        };
        try (PlaybackQueueStore queue = new PlaybackQueueStore(isolated)) {
            JSONObject source = new JSONObject().put("uri", "https://example.org/stream")
                    .put("headers", new JSONObject().put("Authorization", "Bearer test"))
                    .put("region", new JSONObject().put("start", 3));
            queue.replace(new JSONArray().put(source).put(source));
            JSONArray page = queue.gainPage(0);
            int removed = page.getJSONObject(0).getInt("queueEntryId");
            int kept = page.getJSONObject(1).getInt("queueEntryId");
            assertFalse(page.getJSONObject(1).has("headers"));
            queue.delete(0);
            queue.updateReplayGainFactors(new JSONArray()
                    .put(new JSONObject().put("queueEntryId", removed).put("replayGainFactor", 2))
                    .put(new JSONObject().put("queueEntryId", kept).put("replayGainFactor", 0.5)));
            assertEquals(1, queue.length());
            JSONObject stored = queue.getJSONObject(0);
            assertEquals(kept, stored.getInt("queueEntryId"));
            assertEquals(0.5, stored.getDouble("replayGainFactor"), 0);
            assertEquals("Bearer test", stored.getJSONObject("headers").getString("Authorization"));
            assertEquals(3, stored.getJSONObject("region").getInt("start"));
        }
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

    @Test public void backgroundPlaybackSkipsMissingScoresAndTaskRemovalStopsPlayback() throws Exception {
        try (androidx.test.core.app.ActivityScenario<MainActivity> scenario = androidx.test.core.app.ActivityScenario.launch(MainActivity.class);
             ServiceLease lease = new ServiceLease()) {
            AndroidWebHostTest.awaitReady(scenario);
            File imports = new File(lease.context.getCacheDir(), "imports");
            assertTrue(imports.isDirectory() || imports.mkdirs());
            File tone = File.createTempFile("queue-tone-", ".wav", imports);
            Object owner = new Object();
            try {
                try (java.io.InputStream in = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("audio/tone.wav");
                     java.io.FileOutputStream out = new java.io.FileOutputStream(tone)) {
                    byte[] block = new byte[4096]; int count;
                    while ((count = in.read(block)) >= 0) out.write(block, 0, count);
                }
                String authority = lease.context.getPackageName() + ".files";
                String uri = androidx.core.content.FileProvider.getUriForFile(lease.context, authority, tone).toString();
                String missing = androidx.core.content.FileProvider.getUriForFile(lease.context, authority,
                        new File(imports, UUID.randomUUID() + ".score")).toString();
                JSONObject good = AudioService.object("uri", uri);
                JSONObject bad = AudioService.object("uri", uri, "scoreUri", missing);
                call(lease.service, "playback.setQueue", AudioService.object("items", new JSONArray().put(good).put(bad).put(bad).put(good),
                        "repeat", "off", "shuffle", false), null, null);
                CountDownLatch finished = new CountDownLatch(1);
                java.util.concurrent.atomic.AtomicBoolean started = new java.util.concurrent.atomic.AtomicBoolean();
                java.util.concurrent.atomic.AtomicBoolean reachedLast = new java.util.concurrent.atomic.AtomicBoolean();
                AtomicReference<String> failure = new AtomicReference<>();
                lease.service.attach(owner, (name, snapshot) -> {
                    if (finished.getCount() == 0) return;
                    JSONObject playback = snapshot.optJSONObject("playback");
                    int index = playback.optInt("index");
                    boolean playing = playback.optBoolean("playing");
                    if (name.equals("playback-ended")) {
                        // A natural end stops on the first track at 0 s.
                        if (!reachedLast.get()) failure.set("Playback ended before the last playable track");
                        else if (index != 0 || playing || playback.optDouble("position") != 0) failure.set("Natural end did not select the first track: " + playback);
                        finished.countDown();
                        return;
                    }
                    if (!name.equals("snapshot")) return;
                    if (index == 0 && playing && started.compareAndSet(false, true)) {
                        lease.service.setVisible(owner, false);
                    }
                    if (!started.get()) return;
                    if (!playing && index != 3) failure.set("Published an intermediate pause at " + index);
                    if (index == 3 && playing) {
                        reachedLast.set(true);
                        try {
                            if (!(boolean) lease.field("foreground"))
                                failure.set("Playback lost foreground ownership at the transition");
                        } catch (Exception error) { failure.set(error.toString()); }
                    }
                }, true);
                call(lease.service, "playback.play", new JSONObject(), null, null);
                assertTrue("The last playable track did not finish", finished.await(10, TimeUnit.SECONDS));
                assertNull(failure.get());
                lease.service.setVisible(owner, true);
                assertTrue(call(lease.service, "playback.play", new JSONObject(), null, null)
                        .getJSONObject("playback").getBoolean("playing"));
                lease.service.onTaskRemoved(new Intent());
                // Task removal shuts the Service down, so its final state is read once the control thread has ended.
                android.os.HandlerThread thread = (android.os.HandlerThread) lease.field("thread");
                thread.join(10_000);
                assertFalse(thread.isAlive());
                assertFalse((boolean) lease.field("playing"));
                assertEquals("SUSPENDED", lease.field("powerState"));
                assertEquals(0, (int) lease.field("queueIndex"));
            } finally {
                lease.service.detach(owner);
                if (!(boolean) lease.field("destroyed")) {
                    call(lease.service, "playback.setQueue", AudioService.object("items", new JSONArray()), null, null);
                    call(lease.service, "audio.stop", new JSONObject(), null, null);
                }
                assertTrue(tone.delete());
            }
        }
    }
}

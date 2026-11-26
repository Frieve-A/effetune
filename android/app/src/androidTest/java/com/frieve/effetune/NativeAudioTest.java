package com.frieve.effetune;

import static org.junit.Assert.*;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.util.Collections;
import java.util.HashMap;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class NativeAudioTest {
    @Test public void roomEqAssetSelectionKeepsCommittedReferenceUntilMatchingCompletion() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = Files.createTempDirectory(context.getCacheDir().toPath(), "asset-selection-").toFile();
        AssetTransfers assets = new AssetTransfers(directory);
        int id = 71;
        String key = "RoomEqPlugin:71:0";
        HashMap<String, Integer> handles = new HashMap<>();
        HashMap<String, String> types = new HashMap<>();
        handles.put("71", id);
        types.put("71", "RoomEqPlugin");
        byte[] descriptor = ByteBuffer.allocate(20).order(ByteOrder.LITTLE_ENDIAN)
                .putInt(1).putInt(1).putInt(id).put(new byte[]{1, 0, 0, (byte) 255, 1, 0, 0, 0}).array();
        JSONObject record = new JSONObject().put("type", "RoomEqPlugin").put("parameters", new JSONObject());
        new NativeParameterPacker(context).packRecord(record);
        int hash = (int) record.getLong("layoutHash");
        byte[] payload = ByteBuffer.allocate(36).order(ByteOrder.LITTLE_ENDIAN)
                .putInt(0x31415445).putInt(1).putInt(1).putInt(48000).putInt(1).putInt(0).putInt(0).putInt(0).putFloat(1).array();
        try (NativeEngine engine = new NativeEngine(48000, 128)) {
            assertArrayEquals(new int[]{id}, engine.configurePipeline(new String[]{"RoomEqPlugin"},
                    new float[][]{{1, 0, 0, 0}}, new int[]{hash}, new int[]{id}, descriptor, new byte[][]{new byte[0]}));
            assertEquals(0, engine.start());
            assertEquals("ready", uploadRoomEq(assets, engine, handles, types, payload, 11));
            assertNotNull(awaitAssetNotice(engine, assets, key, 11, false));
            JSONObject initial = assets.snapshot();
            String previous = initial.getJSONObject(key).getString("id");

            byte[] invalid = payload.clone();
            ByteBuffer.wrap(invalid).order(ByteOrder.LITTLE_ENDIAN).putInt(12, 44100);
            assertEquals("pending", uploadRoomEq(assets, engine, handles, types, invalid, 12));
            assertEquals(previous, assets.snapshot().getJSONObject(key).getString("id"));
            assertNull(assets.resolve(key, 1, true, true));
            AssetTransfers.Notice rejected = awaitAssetNotice(engine, assets, key, 12, true);
            assertNotNull(rejected);
            assertFalse(rejected.committed());
            assertEquals(previous, assets.snapshot().getJSONObject(key).getString("id"));

            File resident = new File(directory, previous);
            File hidden = File.createTempFile("resident-fixture-", ".tmp", resident.getParentFile());
            assertTrue(hidden.delete() && resident.renameTo(hidden));
            try {
                assets.select(initial, handles, types, engine, Collections.emptySet(), true);
                assertThrows(Exception.class, () -> assets.select(initial, handles, types, engine, Collections.singleton("71"), true));
                assertEquals(previous, assets.snapshot().getJSONObject(key).getString("id"));
            } finally {
                assertTrue(hidden.renameTo(resident));
            }
            engine.stop();
            assertEquals("pending", uploadRoomEq(assets, engine, handles, types, payload, 13));
            assets.select(initial, handles, types, engine, Collections.emptySet(), true);
            assertEquals(0, engine.start());
            AssetTransfers.Notice supersedingRestore = awaitAssetNotice(engine, assets, key, -1, true);
            assertNotNull(supersedingRestore);
            assertFalse(supersedingRestore.historyEntry());
            awaitAudioFrames(engine);
            assertEquals(previous, assets.snapshot().getJSONObject(key).getString("id"));
            assertEquals("pending", uploadRoomEq(assets, engine, handles, types, payload, 14));
            assertEquals(previous, assets.snapshot().getJSONObject(key).getString("id"));
            AssetTransfers.Notice accepted = awaitAssetNotice(engine, assets, key, 14, true);
            assertNotNull(accepted);
            assertTrue(accepted.committed());
            String current = assets.snapshot().getJSONObject(key).getString("id");
            assertNotEquals(previous, current);
            awaitAudioFrames(engine);

            engine.stop();
            assets.select(initial, handles, types, engine, Collections.emptySet(), true);
            assertEquals(current, assets.snapshot().getJSONObject(key).getString("id"));
            assertEquals(0, engine.start());
            AssetTransfers.Notice restored = awaitAssetNotice(engine, assets, key, -1, true);
            assertNotNull(restored);
            assertTrue(restored.committed());
            assertFalse(restored.historyEntry());
            assertEquals(previous, assets.snapshot().getJSONObject(key).getString("id"));

            assets.select(new JSONObject(), handles, types, engine, Collections.emptySet(), true);
            assertFalse(assets.snapshot().has(key));
        } finally {
            for (File asset : directory.listFiles()) asset.delete();
            directory.delete();
        }
    }

    private static String uploadRoomEq(AssetTransfers assets, NativeEngine engine,
            HashMap<String, Integer> handles, HashMap<String, String> types, byte[] payload, int revision) throws Exception {
        JSONObject request = new JSONObject().put("pluginId", 71).put("slot", 0);
        assets.command("pipeline.asset.begin", new JSONObject(request.toString()).put("byteLength", payload.length)
                .put("formatTag", 1).put("headBlock", 128).put("processingChannels", 2)
                .put("footprintBytes", 32 * 1024 * 1024).put("operationRevision", revision), handles, types, engine);
        assets.command("pipeline.asset.chunk", new JSONObject(request.toString()).put("offset", 0)
                .put("data", Base64.encodeToString(payload, Base64.NO_WRAP)), handles, types, engine);
        return assets.command("pipeline.asset.commit", request, handles, types, engine).getString("state");
    }

    private static void awaitAudioFrames(NativeEngine engine) {
        long start = engine.getAudioFrameTime();
        long deadline = SystemClock.elapsedRealtime() + 5000;
        while (engine.getAudioFrameTime() - start < 8192 && SystemClock.elapsedRealtime() < deadline)
            SystemClock.sleep(10);
        assertTrue(engine.getAudioFrameTime() - start >= 8192);
    }

    private static AssetTransfers.Notice awaitAssetNotice(NativeEngine engine, AssetTransfers assets, String key,
            long revision, boolean completion) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 5000;
        while (SystemClock.elapsedRealtime() < deadline) {
            int[] result = engine.readAssetNotices();
            for (int offset = 0; offset + 5 < result.length; offset += 6) {
                boolean completed = result[offset + 5] != 0;
                AssetTransfers.Notice notice = assets.resolve(key, Integer.toUnsignedLong(result[offset + 4]),
                        result[offset + 3] != 0, completed);
                if (notice != null && notice.operationRevision() == revision &&
                        (completion ? completed : (result[offset + 2] & 255) == 3)) return notice;
            }
            SystemClock.sleep(10);
        }
        return null;
    }

    @Test public void blindSelectionRendersBothGainsAndRestoresPrimaryOutput() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject volume = new JSONObject().put("type", "VolumePlugin").put("parameters", new JSONObject().put("vl", -6));
        new NativeParameterPacker(context).packRecord(volume);
        byte[] descriptor = ByteBuffer.allocate(20).order(ByteOrder.LITTLE_ENDIAN)
                .putInt(1).putInt(1).putInt(1).put(new byte[]{1, 0, 0, (byte) 255, 1, 0, 0, 0}).array();
        try (NativeEngine engine = new NativeEngine(48000, 128)) {
            engine.configurePipeline(new String[]{"VolumePlugin"}, new float[][]{{-6}},
                    new int[]{(int) volume.getLong("layoutHash")}, new int[]{1}, descriptor, new byte[][]{new byte[0]});
            assertEquals(0, engine.startParallel());
            engine.configurePipeline(new String[0], new float[0][], new int[0], new int[0],
                    new byte[]{1, 0, 0, 0, 0, 0, 0, 0}, new byte[0][], new byte[0], 1);
            assertTrue(engine.setOutputDelay(1, Integer.MAX_VALUE) < 0);
            assertEquals(0, engine.setOutputDelay(0, 128));
            assertEquals(128, (int) engine.readPipelineStats(0)[2]);
            assertEquals(0, (int) engine.readPipelineStats(1)[2]);
            float[] tone = new float[4096 * 2];
            for (int i = 0; i < tone.length / 2; i++)
                tone[2 * i] = tone[2 * i + 1] = (float) Math.sin(2 * Math.PI * i / 32);
            long generation = engine.beginSource();
            engine.setPlaying(true);
            assertEquals(0, engine.start());
            assertBlindPeak(engine, tone, generation, .501f);
            assertEquals(0, engine.selectParallel(1, .02));
            assertBlindPeak(engine, tone, generation, 1);
            for (int branch = 0; branch <= 1; branch++) assertEquals(0, engine.fadeOutput(branch, 0, .02));
            assertBlindPeak(engine, tone, generation, 0);
            engine.stopParallel();
            assertEquals(0, engine.setOutputDelay(0, 0));
            assertEquals(0, engine.fadeOutput(0, 1, .05));
            assertBlindPeak(engine, tone, generation, .501f);
            assertEquals(0, (int) engine.readPipelineStats(0)[2]);
        }
    }

    private static void assertBlindPeak(NativeEngine engine, float[] tone, long generation, float expected) {
        long deadline = SystemClock.elapsedRealtime() + 5000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (engine.getQueuedFrames() < 8192) engine.writePcm(tone, tone.length / 2, generation);
            float[] levels = engine.getPowerObservation();
            if (levels[1] > .99f && Math.abs(levels[2] - expected) < .005f) return;
            SystemClock.sleep(10);
        }
        fail("The selected branch did not produce the expected output peak " + expected);
    }

    @Test public void irAssetHandoffPreservesPausedSourceAndRestoresOutputAfterFailure() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeParameterPacker packer = new NativeParameterPacker(context);
        JSONObject record = new JSONObject().put("type", "IRReverbPlugin").put("parameters",
                new JSONObject().put("lt", "0").put("cr", "full").put("dw", 0).put("de", false));
        packer.packRecord(record);
        JSONArray values = record.getJSONArray("parameterValues");
        float[] parameters = new float[values.length()];
        for (int i = 0; i < parameters.length; i++) parameters[i] = (float) values.getDouble(i);
        byte[] descriptor = ByteBuffer.allocate(20).order(ByteOrder.LITTLE_ENDIAN)
                .putInt(1).putInt(1).putInt(1).put(new byte[]{1, 0, 0, (byte) 255, 1, 0, 0, 0}).array();
        byte[] payload = ByteBuffer.allocate(36).order(ByteOrder.LITTLE_ENDIAN)
                .putInt(0x31415445).putInt(1).putInt(1).putInt(48000).putInt(1).putInt(0).putInt(0).putInt(0).putFloat(1).array();
        int[] info = {1, 1, 1, 0, 1, 0, 0, 2, 32 * 1024 * 1024, payload.length};
        try (NativeEngine engine = new NativeEngine(48000, 256)) {
            int[] handles = engine.configurePipeline(new String[]{"IRReverbPlugin"}, new float[][]{parameters},
                    new int[]{(int) record.getLong("layoutHash")}, new int[]{1}, descriptor, new byte[][]{new byte[0]});
            assertEquals(1024, engine.writePcm(new float[2048], 1024, engine.beginSource()));
            assertEquals(0, engine.start());
            assertEquals(0, engine.setAsset(handles[0], 0, info, payload, 1));
            assertEquals(1024, engine.getQueuedFrames());
            assertEquals(0, engine.getRenderedFrames());
            payload[0] = 0;
            assertNotEquals(0, engine.setAsset(handles[0], 0, info, payload, 1));
            long before = engine.getAudioFrameTime();
            SystemClock.sleep(100);
            assertTrue("Failed asset still restores prior output", engine.getAudioFrameTime() > before);
            assertEquals(1024, engine.getQueuedFrames());
            engine.setPlaying(true);
            long deadline = SystemClock.elapsedRealtime() + 5000;
            while (engine.getRenderedFrames() < 1024 && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(10);
            assertEquals(1024, engine.getRenderedFrames());
        }
    }
    @Test public void multichannelPcmReadsOnlyTheRequestedFrames() {
        int channels = 8, frames = 16385;
        float[] block = new float[frames * channels + 1];
        block[frames * channels] = Float.NaN;
        try (NativeEngine engine = new NativeEngine(48000, 256, channels)) {
            assertEquals(frames, engine.writePcm(block, frames, engine.beginSource()));
            assertEquals(frames, engine.getQueuedFrames());
        }
    }

    @Test public void outputRouteReopensWithoutDiscardingPausedPcm() {
        try (NativeEngine engine = new NativeEngine(48000, 256)) {
            long generation = engine.beginSource();
            assertEquals(1024, engine.writePcm(new float[2048], 1024, generation));
            assertEquals(0, engine.start());
            assertEquals(0, engine.setOutputDevice(0));
            assertEquals(1024, engine.getQueuedFrames());
            assertEquals(0, engine.getRenderedFrames());
            engine.setPlaying(true);
            long deadline = SystemClock.elapsedRealtime() + 5000;
            while (engine.getRenderedFrames() < 1024 && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(10);
            assertEquals(1024, engine.getRenderedFrames());
            assertEquals(0, engine.getQueuedFrames());
        }
    }

    @Test public void finiteMicrophoneCaptureProducesReadableStereoFile() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File excitation = File.createTempFile("native-excitation", ".f32", context.getCacheDir());
        File recording = File.createTempFile("native-recording", ".f32", context.getCacheDir());
        try {
            ByteBuffer samples = ByteBuffer.allocate(4800 * 8).order(ByteOrder.LITTLE_ENDIAN);
            for (int frame = 0; frame < 4800; frame++) {
                float value = (float) (Math.sin(frame * 2 * Math.PI * 440 / 48000) * 0.01);
                samples.putFloat(value).putFloat(value);
            }
            try (FileOutputStream file = new FileOutputStream(excitation)) { file.write(samples.array()); }
            try (NativeEngine engine = new NativeEngine(48000, 256);
                 ParcelFileDescriptor input = ParcelFileDescriptor.open(excitation, ParcelFileDescriptor.MODE_READ_ONLY);
                 ParcelFileDescriptor output = ParcelFileDescriptor.open(recording, ParcelFileDescriptor.MODE_READ_WRITE)) {
                assertEquals(0, engine.start());
                assertEquals(0, engine.setInputDevice(0));
                engine.beginMeasurementFiles(input.getFd(), output.getFd(), 4800, 48000, 0, 0, 0);
                long deadline = SystemClock.elapsedRealtime() + 5000;
                int[] state;
                do { SystemClock.sleep(10); state = engine.getMeasurementState(); }
                while (state[0] == 1 && SystemClock.elapsedRealtime() < deadline);
                assertEquals("Capture status after " + state[1] + " frames", 2, state[0]);
                assertEquals(48000, state[1]);
                assertEquals(48000, state[2]);
                assertEquals(2, state[3]);
                assertEquals(48000 * 8, recording.length());
                byte[] chunk = new byte[4096];
                try (RandomAccessFile file = new RandomAccessFile(recording, "r")) { file.readFully(chunk); }
                ByteBuffer recorded = ByteBuffer.wrap(chunk).order(ByteOrder.LITTLE_ENDIAN);
                while (recorded.hasRemaining()) assertTrue(Float.isFinite(recorded.getFloat()));
                engine.cancelMeasurement();
                assertEquals(0, engine.getMeasurementState()[0]);
                engine.beginMeasurementFiles(input.getFd(), output.getFd(), 4800, 48000, 0, 0, 0);
                assertEquals(0, engine.setInputDevice(-1));
                assertEquals("Input release invalidates recording", 3, engine.getMeasurementState()[0]);
                engine.cancelMeasurement();
            }
        } finally {
            assertTrue(excitation.delete());
            assertTrue(recording.delete());
        }
    }
}

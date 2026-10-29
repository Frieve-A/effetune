package com.frieve.effetune;

import static org.junit.Assert.*;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class NativeAudioTest {
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
                    new int[]{(int) record.getLong("layoutHash")}, descriptor, new byte[][]{new byte[0]});
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
                engine.beginMeasurementFiles(input.getFd(), output.getFd(), 4800, 48000);
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
                engine.beginMeasurementFiles(input.getFd(), output.getFd(), 4800, 48000);
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

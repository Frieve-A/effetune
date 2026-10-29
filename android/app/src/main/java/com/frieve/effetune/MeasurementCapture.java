package com.frieve.effetune;

import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.json.JSONObject;

/** Finite file-backed capture; bridge and callback storage stay bounded. */
final class MeasurementCapture {
    private final File directory;
    private File excitation;
    private File result;
    private int excitationFrames;
    private int writtenBytes;
    private int captureFrames;
    private int sampleRate;
    private boolean started;
    private boolean complete;
    private boolean invalid;
    private boolean noise;
    private double noiseLevelDb = -30;

    MeasurementCapture(Context context) { directory = new File(context.getCacheDir(), "measurements"); directory.mkdirs(); }
    boolean isRunning() { return noise || started && !invalid && !complete; }
    void invalidate(NativeEngine engine) {
        if (noise) { engine.stopMeasurementNoise(); noise = false; }
        if (started && !complete && engine.getMeasurementState()[0] != 2) { invalid = true; engine.cancelMeasurement(); }
    }
    void clear() {
        if (excitation != null) excitation.delete();
        if (result != null) result.delete();
        excitation = null; result = null; started = false; complete = false; invalid = false; noise = false;
    }

    JSONObject command(String operation, JSONObject args, NativeEngine engine) throws Exception {
        if (operation.equals("measurement.noise.begin")) {
            engine.stopMeasurementNoise();
            noiseLevelDb = args.optDouble("levelDb", -30);
            int frames = args.getInt("frames");
            if (frames < 1 || frames > (long) args.getInt("sampleRate") * 10) throw new IllegalArgumentException("Invalid noise loop");
            return command("measurement.begin", AudioService.object("sampleRate", args.getInt("sampleRate"), "excitationFrames", frames, "captureFrames", frames), engine);
        }
        if (operation.equals("measurement.noise.chunk")) return command("measurement.chunk", args, engine);
        if (operation.equals("measurement.noise.start")) {
            if (excitation == null || writtenBytes != excitationFrames * 8 || started) throw new IllegalStateException("Incomplete noise upload");
            try (ParcelFileDescriptor input = ParcelFileDescriptor.open(excitation, ParcelFileDescriptor.MODE_READ_ONLY)) { engine.setMeasurementNoiseFile(input.getFd(), excitationFrames); }
            noise = true;
            return command("measurement.noise.level", AudioService.object("levelDb", noiseLevelDb), engine);
        }
        if (operation.equals("measurement.noise.level")) {
            double level = args.getDouble("levelDb");
            if (!Double.isFinite(level) || level < -100 || level > 0) throw new IllegalArgumentException("Invalid noise level");
            noiseLevelDb = level; engine.setGain((float) Math.pow(10, level / 20));
            return AudioService.object("active", noise, "levelDb", noiseLevelDb);
        }
        if (operation.equals("measurement.noise.stop")) { engine.stopMeasurementNoise(); clear(); return AudioService.object("active", false); }
        switch (operation) {
            case "measurement.begin":
                engine.stopMeasurementNoise(); engine.cancelMeasurement(); clear();
                sampleRate = args.getInt("sampleRate"); captureFrames = args.getInt("captureFrames"); excitationFrames = args.getInt("excitationFrames");
                if (sampleRate != engine.getSampleRate() || excitationFrames < 1 || captureFrames < excitationFrames
                        || captureFrames > 16L * 1048576 + 41L * sampleRate) throw new AudioService.HostError("invalid-measurement", "Use the current sample rate and a supported measurement length.");
                excitation = File.createTempFile("excitation-", ".f32", directory);
                result = File.createTempFile("recording-", ".f32", directory); writtenBytes = 0;
                return AudioService.object("sampleRate", sampleRate, "channels", 2);
            case "measurement.chunk":
                if (excitation == null || started) throw new IllegalStateException("No measurement upload");
                String encoded = args.getString("data");
                if (encoded.length() > 349528) throw new IllegalArgumentException("Measurement chunk too large");
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                if (bytes.length > DocumentStore.CHUNK_BYTES || bytes.length % 4 != 0 || args.getInt("offset") != writtenBytes
                        || writtenBytes + bytes.length > (long) excitationFrames * 8) throw new IllegalArgumentException("Invalid measurement range");
                ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
                while (buffer.hasRemaining()) { float value = buffer.getFloat(); if (!Float.isFinite(value) || value < -1 || value > 1) throw new IllegalArgumentException("Invalid excitation"); }
                try (FileOutputStream output = new FileOutputStream(excitation, true)) { output.write(bytes); }
                writtenBytes += bytes.length;
                return AudioService.object("bytesWritten", bytes.length);
            case "measurement.start":
                if (excitation == null || writtenBytes != excitationFrames * 8 || started) throw new IllegalStateException("Incomplete measurement upload");
                try (ParcelFileDescriptor input = ParcelFileDescriptor.open(excitation, ParcelFileDescriptor.MODE_READ_ONLY);
                     ParcelFileDescriptor output = ParcelFileDescriptor.open(result, ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_TRUNCATE)) {
                    engine.beginMeasurementFiles(input.getFd(), output.getFd(), excitationFrames, captureFrames);
                }
                started = true;
                return status(engine);
            case "measurement.status": return status(engine);
            case "measurement.read":
                status(engine);
                if (invalid || !started) throw new AudioService.HostError("measurement-invalid", "Audio conditions changed. Run the measurement again.");
                if (!complete) throw new AudioService.HostError("measurement-incomplete", "Wait for the measurement to finish.");
                long size = (long) captureFrames * 8;
                if (result.length() != size) { invalid = true; throw new AudioService.HostError("measurement-invalid", "The recording was interrupted. Run the measurement again."); }
                int offset = args.optInt("offset", 0), length = args.optInt("length", DocumentStore.CHUNK_BYTES);
                if (offset < 0 || offset % 4 != 0 || offset > size || length < 4 || length > DocumentStore.CHUNK_BYTES || length % 4 != 0) throw new IllegalArgumentException("Invalid recording range");
                byte[] chunk = new byte[(int) Math.min(length, size - offset)];
                try (RandomAccessFile input = new RandomAccessFile(result, "r")) { input.seek(offset); input.readFully(chunk); }
                return AudioService.object("data", Base64.encodeToString(chunk, Base64.NO_WRAP), "offset", offset, "length", chunk.length,
                        "eof", offset + chunk.length == size, "sampleRate", sampleRate, "channels", 2, "frames", captureFrames,
                        "captureStartFrame", 0, "scheduledPlaybackFrame", 0);
            case "measurement.cancel":
                engine.cancelMeasurement(); clear(); return AudioService.object("status", "idle");
            default: throw new AudioService.HostError("unsupported-operation", "This measurement operation is unavailable.");
        }
    }

    private JSONObject status(NativeEngine engine) {
        int[] state = engine.getMeasurementState();
        if (state[0] == 3) invalid = true;
        complete = !invalid && state[0] == 2;
        String name = invalid ? "invalid" : complete ? "complete" : state[0] == 1 ? "running" : "idle";
        return AudioService.object("status", name, "frames", state[1], "sampleRate", state[2], "channels", state[3], "captureFrames", captureFrames);
    }
}

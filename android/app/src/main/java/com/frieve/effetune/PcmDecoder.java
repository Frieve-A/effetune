package com.frieve.effetune;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.Iterator;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import sonic.Sonic;

/** One decoder producer with bounded PCM; no decoder work runs on the audio callback. */
final class PcmDecoder implements AutoCloseable {
    interface Listener { void format(long generation, long durationUs); void ended(long generation); void failed(long generation, Exception error); }
    private final Context context;
    private final NativeEngine engine;
    private final Listener listener;
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>());
    private Future<?> task;

    PcmDecoder(Context context, NativeEngine engine, Listener listener) {
        this.context = context; this.engine = engine; this.listener = listener;
    }

    void start(JSONObject source, long positionUs, double speed, boolean preservePitch, long endUs, long generation) {
        cancel();
        task = worker.submit(() -> decode(source, positionUs, speed, preservePitch, endUs, generation));
    }

    void cancel() {
        if (task != null) task.cancel(true);
        worker.getQueue().clear();
        task = null;
    }

    private void decode(JSONObject source, long positionUs, double speed, boolean preservePitch, long endUs, long generation) {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        PcmResampler resampler = null;
        try {
            Uri uri = Uri.parse(source.getString("uri"));
            String scheme = uri.getScheme();
            if ("content".equals(scheme)) extractor.setDataSource(context, uri, null);
            else if ("https".equals(scheme) || "http".equals(scheme)) {
                HashMap<String, String> headers = new HashMap<>();
                JSONObject values = source.optJSONObject("headers");
                if (values != null) {
                    Iterator<String> keys = values.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        if (key.equalsIgnoreCase("Authorization") || key.equalsIgnoreCase("User-Agent")) headers.put(key, values.getString(key));
                    }
                }
                extractor.setDataSource(uri.toString(), headers);
            } else throw new IllegalArgumentException("Select an audio file or a network music source.");
            MediaFormat format = null;
            for (int track = 0; track < extractor.getTrackCount(); track++) {
                MediaFormat candidate = extractor.getTrackFormat(track);
                String mime = candidate.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) { extractor.selectTrack(track); format = candidate; break; }
            }
            if (format == null) throw new IllegalArgumentException("No supported audio track was found.");
            long duration = format.containsKey(MediaFormat.KEY_DURATION) ? format.getLong(MediaFormat.KEY_DURATION) : 0;
            JSONObject region = source.optJSONObject("region");
            if (region != null) {
                int sourceRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                long regionStart = region.has("startFrame") ? region.getLong("startFrame") * 1_000_000 / sourceRate : (long) (region.optDouble("start", 0) * 1_000_000);
                long regionEnd = region.has("endFrame") ? region.getLong("endFrame") * 1_000_000 / sourceRate : (long) (region.optDouble("end", duration / 1_000_000.0) * 1_000_000);
                if (regionStart < 0 || regionEnd <= regionStart || (duration > 0 && regionStart >= duration)) throw new IllegalArgumentException("Invalid playback region");
                endUs = duration > 0 ? Math.min(duration, regionEnd) : regionEnd;
                duration = endUs - regionStart; positionUs += regionStart;
            }
            listener.format(generation, duration);
            extractor.seekTo(positionUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
            codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            format.setInteger(MediaFormat.KEY_MAX_OUTPUT_CHANNEL_COUNT, 2);
            codec.configure(format, null, null, 0);
            codec.start();
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            int sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            int encoding = AudioFormat.ENCODING_PCM_16BIT;
            StereoDownmix downmix = new StereoDownmix(channels, format.containsKey(MediaFormat.KEY_CHANNEL_MASK) ? format.getInteger(MediaFormat.KEY_CHANNEL_MASK) : 0);
            resampler = new PcmResampler((int) Math.round(sampleRate * (preservePitch ? 1 : speed)), engine.getSampleRate());
            boolean inputEnded = false;
            boolean outputEnded = false;
            Sonic stretch = preservePitch && speed != 1 ? new Sonic(engine.getSampleRate(), 2) : null;
            if (stretch != null) stretch.setSpeed((float) speed);
            while (!outputEnded && !Thread.currentThread().isInterrupted()) {
                if (!inputEnded) {
                    int index = codec.dequeueInputBuffer(10_000);
                    if (index >= 0) {
                        ByteBuffer input = codec.getInputBuffer(index);
                        int bytes = extractor.readSampleData(input, 0);
                        long time = extractor.getSampleTime();
                        if (bytes < 0 || (endUs > 0 && time >= endUs)) {
                            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputEnded = true;
                        } else {
                            codec.queueInputBuffer(index, 0, bytes, time, 0);
                            extractor.advance();
                        }
                    }
                }
                int index = codec.dequeueOutputBuffer(info, 10_000);
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat output = codec.getOutputFormat();
                    int previousRate = sampleRate;
                    sampleRate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    channels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    encoding = output.containsKey(MediaFormat.KEY_PCM_ENCODING) ? output.getInteger(MediaFormat.KEY_PCM_ENCODING) : AudioFormat.ENCODING_PCM_16BIT;
                    if (channels < 1 || channels > 16 || sampleRate < 8000 || sampleRate > 384000
                            || (encoding != AudioFormat.ENCODING_PCM_16BIT && encoding != AudioFormat.ENCODING_PCM_FLOAT)) {
                        throw new IllegalArgumentException("The audio format is not supported by this device.");
                    }
                    downmix = new StereoDownmix(channels, output.containsKey(MediaFormat.KEY_CHANNEL_MASK) ? output.getInteger(MediaFormat.KEY_CHANNEL_MASK) : 0);
                    if (sampleRate != previousRate) {
                        float[] tail = resampler.process(new float[0], 0, true); writeStretched(stretch, tail, tail.length / 2, generation);
                        resampler.close();
                        resampler = new PcmResampler((int) Math.round(sampleRate * (preservePitch ? 1 : speed)), engine.getSampleRate());
                    }
                } else if (index >= 0) {
                    try {
                        ByteBuffer output = codec.getOutputBuffer(index).order(ByteOrder.LITTLE_ENDIAN);
                        int sampleBytes = encoding == AudioFormat.ENCODING_PCM_FLOAT ? 4 : 2;
                        int frames = info.size / (sampleBytes * channels);
                        if (info.size > 4 * 1024 * 1024) throw new IllegalArgumentException("The audio decoder returned an oversized block.");
                        float[] block = new float[2048];
                        int filled = 0;
                        for (int frame = 0; frame < frames; frame++) {
                            long time = info.presentationTimeUs + (long) frame * 1_000_000 / sampleRate;
                            if (time < positionUs || (endUs > 0 && time >= endUs)) continue;
                            int offset = info.offset + frame * channels * sampleBytes;
                            downmix.frame(output, offset, encoding, block, filled); filled += 2;
                            if (filled == block.length) {
                                float[] converted = resampler.process(block, filled / 2, false);
                                writeStretched(stretch, converted, converted.length / 2, generation); filled = 0;
                            }
                        }
                        if (filled > 0) { float[] converted = resampler.process(block, filled / 2, false); writeStretched(stretch, converted, converted.length / 2, generation); }
                        outputEnded = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    } finally { codec.releaseOutputBuffer(index, false); }
                }
            }
            if (!Thread.currentThread().isInterrupted()) {
                float[] tail = resampler.process(new float[0], 0, true); writeStretched(stretch, tail, tail.length / 2, generation);
                if (stretch != null) { stretch.flushStream(); drain(stretch, generation); }
                listener.ended(generation);
            }
        } catch (Exception error) {
            if (!Thread.currentThread().isInterrupted()) listener.failed(generation, error);
        } finally {
            if (resampler != null) resampler.close();
            if (codec != null) { try { codec.stop(); } catch (Exception ignored) { } codec.release(); }
            extractor.release();
        }
    }

    private void write(float[] block, int frames, long generation) throws InterruptedException {
        int offset = 0;
        while (offset < frames) {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            float[] pending;
            if (offset == 0) pending = block;
            else { pending = new float[(frames - offset) * 2]; System.arraycopy(block, offset * 2, pending, 0, pending.length); }
            int written = engine.writePcm(pending, frames - offset, generation);
            if (written < 0) return;
            if (written == 0) Thread.sleep(5);
            else offset += written;
        }
    }

    private void writeStretched(Sonic stretch, float[] block, int frames, long generation) throws InterruptedException {
        if (stretch == null) write(block, frames, generation);
        else { stretch.writeFloatToStream(block, frames); drain(stretch, generation); }
    }

    private void drain(Sonic stretch, long generation) throws InterruptedException {
        float[] block = new float[2048];
        int count;
        while ((count = stretch.readFloatFromStream(block, block.length / 2)) > 0) write(block, count, generation);
    }

    void closeAfterDecode(Runnable finished) {
        cancel();
        worker.execute(finished);
        worker.shutdown();
    }
    @Override public void close() { closeAfterDecode(() -> { }); }
}

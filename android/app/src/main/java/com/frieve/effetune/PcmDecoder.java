package com.frieve.effetune;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.CancellationSignal;
import android.webkit.MimeTypeMap;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import sonic.Sonic;

/** One decoder producer with bounded PCM; no decoder work runs on the audio callback. */
final class PcmDecoder implements AutoCloseable {
    // `frames` counts the PCM frames this decode wrote for its generation.
    interface Listener { void format(long generation, long durationUs); void ended(long generation, long frames); void failed(long generation, long frames, Exception error); }
    private final Context context;
    private final NativeEngine engine;
    private final Listener listener;
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>());
    private final Object playbackGate = new Object();
    private final Object engineWrites = new Object();
    private boolean closed;
    private volatile boolean paused = true;
    private Future<?> task;
    private CancellationSignal cancellation;
    private long framesWritten; // Worker thread only.
    private JSONObject extractorSource; // Network entry opened by the platform decoder; worker thread only.
    private static final class JobGain {
        volatile float factor;
        JobGain(float factor) { this.factor = factor; }
    }
    private JobGain activeGain; // Control thread only.
    private JobGain writingGain; // Bound to the running job on the single decoder thread.
    private final int width;
    private final int outputRate;
    private final float[] pendingPcm;

    PcmDecoder(Context context, NativeEngine engine, Listener listener) {
        this.context = context; this.engine = engine; this.listener = listener;
        width = engine.getChannelCount();
        outputRate = engine.getSampleRate();
        pendingPcm = new float[1024 * width];
    }

    void start(JSONObject source, Uri uri, long positionUs, double speed, boolean preservePitch, long endUs, long generation) {
        cancel();
        JobGain gain = new JobGain((float) source.optDouble("replayGainFactor", 1));
        activeGain = gain;
        CancellationSignal signal = new CancellationSignal();
        cancellation = signal;
        task = worker.submit(() -> {
            writingGain = gain;
            decode(source, uri, positionUs, speed, preservePitch, endUs, generation, signal);
        });
    }

    void setReplayGainFactor(float factor) {
        if (activeGain != null) activeGain.factor = factor;
    }

    void setPaused(boolean paused) {
        synchronized (playbackGate) {
            this.paused = paused;
            if (!paused) playbackGate.notify();
        }
    }

    private void awaitPlayback() throws InterruptedException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
        if (paused) synchronized (playbackGate) {
            while (paused) playbackGate.wait();
        }
    }

    void cancel() {
        activeGain = null;
        if (task != null) task.cancel(true);
        if (cancellation != null) {
            CancellationSignal signal = cancellation;
            cancellation = null;
            CompletableFuture.runAsync(signal::cancel);
        }
        worker.getQueue().clear();
        task = null;
    }

    private void decode(JSONObject source, Uri uri, long positionUs, double speed, boolean preservePitch, long endUs,
                        long generation, CancellationSignal signal) {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        PcmResampler resampler = null;
        framesWritten = 0;
        try {
            float factor = writingGain.factor;
            if (!Float.isFinite(factor) || factor < 0) throw new IllegalArgumentException("Invalid track gain");
            if (source != extractorSource) extractorSource = null;
            String scheme = uri.getScheme();
            boolean network = "https".equals(scheme) || "http".equals(scheme);
            HashMap<String, String> headers = new HashMap<>();
            if (network) {
                JSONObject values = source.optJSONObject("headers");
                if (values != null) {
                    Iterator<String> keys = values.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        if (key.equalsIgnoreCase("Authorization") || key.equalsIgnoreCase("User-Agent")) headers.put(key, values.getString(key));
                    }
                }
            } else if (!"content".equals(scheme)) throw new IllegalArgumentException("Select an audio file or a network music source.");
            String name = uri.getLastPathSegment();
            String type = source.optString("type");
            int separator = type.indexOf(';');
            type = (separator < 0 ? type : type.substring(0, separator)).trim().toLowerCase(Locale.ROOT);
            boolean dsd = dsdName(name) || dsdName(source.optString("title")) || dsdMime(type);
            // Document IDs and network endpoints need not expose the media format.
            String extension = name == null ? "" : name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
            String mimeHint = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
            boolean knownMedia = mediaMime(mimeHint) || (network && (source == extractorSource || mediaMime(type)));
            if ((dsd || !knownMedia)
                    && tryDecodeDsd(uri, headers, dsd, source, positionUs, speed, preservePitch, endUs, generation, signal)) return;
            if (network) extractor.setDataSource(uri.toString(), headers);
            else try (AssetFileDescriptor asset = context.getContentResolver().openAssetFileDescriptor(uri, "r", signal)) {
                if (asset == null) throw new IOException("Missing audio source");
                signal.throwIfCanceled();
                extractor.setDataSource(asset);
            }
            MediaFormat format = null;
            for (int track = 0; track < extractor.getTrackCount(); track++) {
                MediaFormat candidate = extractor.getTrackFormat(track);
                String mime = candidate.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) { extractor.selectTrack(track); format = candidate; break; }
            }
            if (format == null) throw new IllegalArgumentException("No supported audio track was found.");
            long duration = format.containsKey(MediaFormat.KEY_DURATION) ? format.getLong(MediaFormat.KEY_DURATION) : 0;
            DecodeRange range = new DecodeRange(source, format.getInteger(MediaFormat.KEY_SAMPLE_RATE), duration, positionUs, endUs);
            endUs = range.end; positionUs = range.start;
            listener.format(generation, range.duration);
            extractor.seekTo(positionUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
            codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            format.setInteger(MediaFormat.KEY_MAX_OUTPUT_CHANNEL_COUNT,
                    width == 2 ? 2 : format.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
            codec.configure(format, null, null, 0);
            codec.start();
            if (network) extractorSource = source;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            int sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            int encoding = AudioFormat.ENCODING_PCM_16BIT;
            StereoDownmix downmix = width == 2 ? new StereoDownmix(channels, format.containsKey(MediaFormat.KEY_CHANNEL_MASK) ? format.getInteger(MediaFormat.KEY_CHANNEL_MASK) : 0) : null;
            resampler = new PcmResampler((int) Math.round(sampleRate * (preservePitch ? 1 : speed)), outputRate, width);
            boolean inputEnded = false;
            boolean outputEnded = false;
            Sonic stretch = stretch(speed, preservePitch);
            while (!outputEnded && !Thread.currentThread().isInterrupted()) {
                awaitPlayback();
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
                    downmix = width == 2 ? new StereoDownmix(channels, output.containsKey(MediaFormat.KEY_CHANNEL_MASK) ? output.getInteger(MediaFormat.KEY_CHANNEL_MASK) : 0) : null;
                    if (sampleRate != previousRate) {
                        float[] tail = resampler.process(new float[0], 0, true); writeStretched(stretch, tail, tail.length / width, generation);
                        resampler.close();
                        resampler = new PcmResampler((int) Math.round(sampleRate * (preservePitch ? 1 : speed)), outputRate, width);
                    }
                } else if (index >= 0) {
                    try {
                        ByteBuffer output = codec.getOutputBuffer(index).order(ByteOrder.LITTLE_ENDIAN);
                        int sampleBytes = encoding == AudioFormat.ENCODING_PCM_FLOAT ? 4 : 2;
                        int frames = info.size / (sampleBytes * channels);
                        if (info.size > 4 * 1024 * 1024) throw new IllegalArgumentException("The audio decoder returned an oversized block.");
                        float[] block = new float[1024 * width];
                        int filled = 0;
                        for (int frame = 0; frame < frames; frame++) {
                            long time = info.presentationTimeUs + (long) frame * 1_000_000 / sampleRate;
                            if (time < positionUs || (endUs > 0 && time >= endUs)) continue;
                            int offset = info.offset + frame * channels * sampleBytes;
                            mapFrame(output, offset, encoding, channels, downmix, block, filled); filled += width;
                            if (filled == block.length) {
                                float[] converted = resampler.process(block, filled / width, false);
                                writeStretched(stretch, converted, converted.length / width, generation); filled = 0;
                            }
                        }
                        if (filled > 0) { float[] converted = resampler.process(block, filled / width, false); writeStretched(stretch, converted, converted.length / width, generation); }
                        outputEnded = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    } finally { codec.releaseOutputBuffer(index, false); }
                }
            }
            if (!Thread.currentThread().isInterrupted()) {
                float[] tail = resampler.process(new float[0], 0, true); writeStretched(stretch, tail, tail.length / width, generation);
                flushStretch(stretch, generation);
                listener.ended(generation, framesWritten);
            }
        } catch (Exception error) {
            if (!(error instanceof InterruptedException) && !signal.isCanceled()
                    && !Thread.currentThread().isInterrupted())
                listener.failed(generation, framesWritten, error);
        } finally {
            if (resampler != null) resampler.close();
            if (codec != null) { try { codec.stop(); } catch (Exception ignored) { } codec.release(); }
            extractor.release();
        }
    }

    private static boolean dsdName(String name) {
        if (name == null) return false;
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".dsf") || lower.endsWith(".dff");
    }

    private static boolean mediaMime(String type) {
        return type != null && !type.endsWith("/*") && (type.startsWith("audio/") || type.startsWith("video/"));
    }

    private static boolean dsdMime(String type) {
        switch (type) {
            case "audio/dsf": case "audio/x-dsf": case "audio/dff": case "audio/x-dff":
            case "audio/dsd": case "audio/x-dsd": case "audio/dsdiff": case "audio/x-dsdiff": return true;
            default: return false;
        }
    }

    private static final class DecodeRange {
        final long start, end, duration;
        DecodeRange(JSONObject source, int rate, long durationUs, long positionUs, long endUs) throws Exception {
            JSONObject region = source.optJSONObject("region");
            if (region == null) {
                start = positionUs; end = endUs; duration = durationUs;
                return;
            }
            long from = region.has("startFrame") ? region.getLong("startFrame") * 1_000_000 / rate : (long) (region.optDouble("start", 0) * 1_000_000);
            long to = region.has("endFrame") ? region.getLong("endFrame") * 1_000_000 / rate : (long) (region.optDouble("end", durationUs / 1_000_000.0) * 1_000_000);
            if (from < 0 || to <= from || (durationUs > 0 && from >= durationUs)) throw new IllegalArgumentException("Invalid playback region");
            end = durationUs > 0 ? Math.min(durationUs, to) : to;
            duration = end - from; start = from + positionUs;
        }
    }

    private boolean tryDecodeDsd(Uri uri, Map<String, String> headers, boolean recognized, JSONObject source,
                                 long positionUs, double speed, boolean preservePitch, long endUs, long generation,
                                 CancellationSignal signal) throws Exception {
        try (DsdInput input = DsdInput.open(context, uri, headers, signal)) {
            signal.throwIfCanceled();
            if (!recognized) {
                if (!DsdFile.hasSignature(input)) return false;
                recognized = true;
            }
            decodeDsd(new DsdFile(input), source, positionUs, speed, preservePitch, endUs, generation);
        } catch (IOException error) {
            // Ordinary streams can be playable by MediaExtractor without supporting positional reads.
            if (recognized || Thread.currentThread().isInterrupted()) throw error;
            return false;
        }
        if (!Thread.currentThread().isInterrupted()) listener.ended(generation, framesWritten);
        return true;
    }

    private void decodeDsd(DsdFile file, JSONObject source, long positionUs, double speed, boolean preservePitch,
                           long endUs, long generation) throws Exception {
        int rate = outputRate;
        long duration = (long) Math.ceil(file.samples * 1_000_000.0 / file.rate);
        DecodeRange range = new DecodeRange(source, file.rate, duration, positionUs, endUs);
        listener.format(generation, range.duration);
        long end = (long) Math.ceil((double) file.samples / file.rate * rate);
        if (range.end > 0) end = Math.min(end, (long) Math.ceil(range.end * (double) rate / 1_000_000));
        long frame = (long) Math.ceil(range.start * (double) rate / 1_000_000);
        ByteBuffer pcm = ByteBuffer.allocateDirect(1024 * file.channels * Float.BYTES).order(ByteOrder.nativeOrder());
        float[] mapped = new float[1024 * width];
        StereoDownmix mix = width == 2 ? new StereoDownmix(file.channels, file.channelMask) : null;
        Sonic stretch = stretch(speed, preservePitch);
        long converter = file.openConverter(rate);
        try (PcmResampler speedConverter = preservePitch || speed == 1 ? null :
                new PcmResampler((int) Math.round(rate * speed), rate, width)) {
            while (frame < end && !Thread.currentThread().isInterrupted()) {
                awaitPlayback();
                int count = (int) Math.min(1024, end - frame);
                file.convert(converter, frame, count, pcm);
                for (int i = 0; i < count; i++)
                    mapFrame(pcm, i * file.channels * Float.BYTES, AudioFormat.ENCODING_PCM_FLOAT, file.channels, mix, mapped, i * width);
                if (speedConverter == null) writeStretched(stretch, mapped, count, generation);
                else {
                    float[] block = speedConverter.process(mapped, count, false);
                    write(block, block.length / width, generation);
                }
                frame += count;
            }
            if (!Thread.currentThread().isInterrupted()) {
                if (speedConverter != null) {
                    float[] tail = speedConverter.process(mapped, 0, true);
                    write(tail, tail.length / width, generation);
                }
                flushStretch(stretch, generation);
            }
        } finally { DsdFile.destroy(converter); }
    }

    private void mapFrame(ByteBuffer pcm, int offset, int encoding, int channels, StereoDownmix stereo,
                          float[] destination, int target) {
        if (stereo != null) {
            stereo.frame(pcm, offset, encoding, destination, target);
            return;
        }
        int copied = Math.min(width, channels);
        for (int ch = 0; ch < copied; ch++) {
            float sample = encoding == AudioFormat.ENCODING_PCM_FLOAT ? pcm.getFloat(offset + ch * Float.BYTES)
                    : pcm.getShort(offset + ch * Short.BYTES) / 32768.0f;
            destination[target + ch] = Float.isFinite(sample) ? sample : 0;
        }
        if (copied == 1) {
            destination[target + 1] = destination[target];
            copied = 2;
        }
        java.util.Arrays.fill(destination, target + copied, target + width, 0);
    }

    private Sonic stretch(double speed, boolean preservePitch) {
        if (!preservePitch || speed == 1) return null;
        Sonic stretch = new Sonic(outputRate, width);
        stretch.setSpeed((float) speed);
        return stretch;
    }

    private void flushStretch(Sonic stretch, long generation) throws InterruptedException {
        if (stretch != null) { stretch.flushStream(); drain(stretch, generation); }
    }

    private void write(float[] block, int frames, long generation) throws InterruptedException {
        int offset = 0;
        while (offset < frames) {
            float factor = writingGain.factor;
            int count = Math.min(frames - offset, pendingPcm.length / width);
            float[] pending = block;
            if (factor != 1 || offset != 0) {
                pending = pendingPcm;
                if (factor == 1) System.arraycopy(block, offset * width, pending, 0, count * width);
                else for (int i = 0; i < count * width; i++) pending[i] = block[offset * width + i] * factor;
            }
            int written = 0;
            while (written == 0) {
                awaitPlayback();
                if (factor != writingGain.factor) break;
                synchronized (engineWrites) {
                    if (closed) throw new InterruptedException();
                    written = engine.writePcm(pending, count, generation);
                }
                if (written < 0) throw new InterruptedException();
                if (written == 0) Thread.sleep(5);
            }
            offset += written;
            framesWritten += written;
        }
    }

    private void writeStretched(Sonic stretch, float[] block, int frames, long generation) throws InterruptedException {
        if (stretch == null) write(block, frames, generation);
        else { stretch.writeFloatToStream(block, frames); drain(stretch, generation); }
    }

    private void drain(Sonic stretch, long generation) throws InterruptedException {
        float[] block = new float[1024 * width];
        int count;
        while ((count = stretch.readFloatFromStream(block, block.length / width)) > 0) write(block, count, generation);
    }

    @Override public void close() {
        // Only an in-flight ring write can hold this monitor. Provider I/O stays outside it.
        synchronized (engineWrites) { closed = true; }
        cancel();
        worker.shutdown();
    }
}

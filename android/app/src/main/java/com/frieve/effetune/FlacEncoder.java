package com.frieve.effetune;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaFormat;
import android.os.SystemClock;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** One continuous FLAC bitstream per HTTP GET. Only the encoder thread feeds and releases the codec. */
final class FlacEncoder implements AutoCloseable {
    private final ArrayBlockingQueue<byte[]> queue = new ArrayBlockingQueue<>(44);
    private final Consumer<byte[]> output;
    private final Consumer<Exception> failure;
    private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
    private volatile boolean closed;
    private boolean header;
    private long frames;

    static MediaCodec open() throws NetworkOutput.Failure {
        MediaCodec codec = null;
        try {
            codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_FLAC);
            MediaFormat format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_FLAC, NetworkStreamServer.RATE, 2);
            format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
            format.setInteger(MediaFormat.KEY_FLAC_COMPRESSION_LEVEL, 5);
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            codec.start();
            return codec;
        } catch (Exception error) {
            if (codec != null) codec.release();
            throw new NetworkOutput.Failure("encoder", error);
        }
    }

    FlacEncoder(MediaCodec prepared, Consumer<byte[]> output, Consumer<Exception> failure) {
        this.output = output; this.failure = failure;
        new Thread(() -> run(prepared), "EffeTune-FLAC").start();
    }
    boolean write(byte[] pcm) { return !closed && queue.offer(pcm); }
    @Override public void close() { closed = true; queue.clear(); }

    private void run(MediaCodec codec) {
        try {
            if (codec == null) codec = open();
            while (!closed) {
                byte[] pcm = queue.poll(50, TimeUnit.MILLISECONDS);
                if (pcm != null) encode(codec, pcm);
                drain(codec);
            }
        } catch (Exception error) {
            if (!closed) failure.accept(error);
        } finally {
            closed = true; queue.clear();
            if (codec != null) codec.release();
        }
    }

    private void encode(MediaCodec codec, byte[] pcm) throws Exception {
        int offset = 0;
        long deadline = SystemClock.elapsedRealtime() + 2000;
        while (!closed && offset < pcm.length) {
            drain(codec);
            int slot = codec.dequeueInputBuffer(10000);
            if (slot < 0) {
                if (SystemClock.elapsedRealtime() >= deadline) throw new IOException("FLAC encoder stalled");
                continue;
            }
            ByteBuffer buffer = codec.getInputBuffer(slot);
            buffer.clear();
            int bytes = Math.min(pcm.length - offset, Math.min(1152, buffer.remaining() / 4) * 4);
            if (bytes == 0) throw new IOException("Missing FLAC input buffer");
            buffer.put(pcm, offset, bytes);
            codec.queueInputBuffer(slot, 0, bytes, frames * 1000000 / NetworkStreamServer.RATE, 0);
            frames += bytes / 4; offset += bytes;
        }
    }

    private void emit(ByteBuffer buffer, boolean config) throws IOException {
        if (buffer == null || !buffer.hasRemaining() || (config && header)) return;
        byte[] data = new byte[buffer.remaining()];
        buffer.get(data);
        if (!header) {
            if (data.length < 4 || data[0] != 'f' || data[1] != 'L' || data[2] != 'a' || data[3] != 'C')
                throw new IOException("Missing FLAC stream header");
            header = true;
        }
        output.accept(data);
    }

    private void drain(MediaCodec codec) throws IOException {
        while (!closed) {
            int slot = codec.dequeueOutputBuffer(info, 0);
            if (slot == MediaCodec.INFO_TRY_AGAIN_LATER) return;
            if (slot == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                emit(codec.getOutputFormat().getByteBuffer("csd-0"), true);
            } else if (slot >= 0) {
                try {
                    ByteBuffer buffer = codec.getOutputBuffer(slot);
                    if (buffer != null && info.size > 0) {
                        buffer.position(info.offset); buffer.limit(info.offset + info.size);
                        emit(buffer, (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0);
                    }
                } finally { codec.releaseOutputBuffer(slot, false); }
            }
        }
    }
}

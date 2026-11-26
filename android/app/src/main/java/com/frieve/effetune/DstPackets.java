package com.frieve.effetune;

import java.io.IOException;
import java.nio.ByteBuffer;
import static com.frieve.effetune.DsdFile.id;
import static com.frieve.effetune.DsdFile.require;

/** Virtual interleaved DSD bytes backed by independent DST packets. */
final class DstPackets {
    private final DsdFile file;
    private final long begin, end, frames, index;
    private final int samples, packetBytes;
    private long cursor, nextFrame;
    private final ByteBuffer indexPage = ByteBuffer.allocate(12 * 128);
    private long indexStart = -128;
    // Adjacent FIR windows overlap; retain the two most recent decoded packets.
    private final byte[][] decoded;
    private final long[] cached = {-1, -1};
    private byte[] compressed = new byte[0];

    DstPackets(DsdFile file, long begin, long end, long frames, long index) {
        this.file = file; this.begin = begin; this.end = end; this.frames = frames; this.index = index;
        cursor = begin;
        samples = file.rate / 75;
        packetBytes = samples / 8 * file.channels;
        decoded = new byte[2][packetBytes];
    }

    void read(long position, byte[] output, int length) throws IOException {
        for (int written = 0; written < length;) {
            byte[] packet = packet(position / packetBytes);
            int offset = (int) (position % packetBytes);
            int take = Math.min(length - written, packetBytes - offset);
            System.arraycopy(packet, offset, output, written, take);
            written += take; position += take;
        }
    }
    private ByteBuffer chunk(long pos) throws IOException {
        require(pos >= begin && pos <= end - 12);
        ByteBuffer header = file.header(pos, 12);
        long length = header.getLong(4);
        require(length >= 0 && length <= end - pos - 12 && length + (length & 1) <= end - pos - 12);
        return header;
    }
    private byte[] packet(long frame) throws IOException {
        require(frame >= 0 && frame < frames);
        int slot = (int) (frame & 1);
        if (cached[slot] == frame) return decoded[slot];
        if (index >= 0) {
            if (frame < indexStart || frame - indexStart >= 128) {
                indexStart = frame;
                file.input.read(index + frame * 12, indexPage.array(), 0, (int) Math.min(128, frames - frame) * 12);
            }
            int entry = (int) (frame - indexStart) * 12;
            long offset = indexPage.getLong(entry);
            long size = Integer.toUnsignedLong(indexPage.getInt(entry + 8));
            require(offset >= begin + 12 && offset <= end);
            cursor = offset - 12;
            ByteBuffer head = chunk(cursor);
            require(head.getInt(0) == id("DSTF") && head.getLong(4) == size);
            nextFrame = frame;
        } else if (frame < nextFrame) {
            cursor = begin; nextFrame = 0;
        }
        int skipped = 0;
        while (cursor < end) {
            ByteBuffer head = chunk(cursor);
            int tag = head.getInt(0);
            long length = head.getLong(4), payload = cursor + 12;
            cursor = payload + length + (length & 1);
            if (tag != id("DSTF")) {
                require(tag != id("FRTE") && ++skipped <= 10000 && (tag != id("DSTC") || length == 4));
                continue;
            }
            require(length > 1 && length <= 1048576);
            skipped = 0;
            if (nextFrame++ != frame) continue;
            if (compressed.length < length) compressed = new byte[(int) length];
            file.input.read(payload, compressed, 0, (int) length);
            byte[] output = decoded[slot];
            require(decode(compressed, (int) length, file.channels, samples, output));
            if (cursor < end && chunk(cursor).getInt(0) == id("DSTC")) {
                require(file.header(cursor, 12).getLong(4) == 4);
                int expected = file.header(cursor + 12, 4).getInt(0);
                int crc = 0;
                for (byte b : output) {
                    crc ^= b << 24;
                    for (int bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc < 0 ? 0x80000011 : 0);
                }
                require(crc == expected);
                cursor += 16;
            }
            if (frame == frames - 1) {
                while (cursor < end) {
                    ByteBuffer tail = chunk(cursor);
                    int tailTag = tail.getInt(0);
                    require(tailTag != id("DSTF") && tailTag != id("FRTE") && tailTag != id("DSTC") && ++skipped <= 10000);
                    long bytes = tail.getLong(4);
                    cursor += 12 + bytes + (bytes & 1);
                }
            }
            cached[slot] = frame;
            return output;
        }
        throw new IOException("Missing DST packet");
    }
    // The shared DST decoder owns one static predictor table.
    private static synchronized native boolean decode(byte[] input, int bytes, int channels, int samples, byte[] output);
}

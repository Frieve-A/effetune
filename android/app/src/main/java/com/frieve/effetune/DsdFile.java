package com.frieve.effetune;

import android.media.AudioFormat;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** Layout of a DSF or DSDIFF file. All offsets exclude the SAF descriptor's base offset. */
final class DsdFile {
    final DsdInput input;
    int rate, channels, channelMask;
    long samples;
    boolean dsf, lsb;
    private long data = -1, dataSize, index = -1, indexSize;
    private int chunks;
    private long packetCount;
    private DstPackets packets;
    private byte[] buffer = new byte[0];
    private final ByteBuffer header = ByteBuffer.allocate(52);

    static boolean hasSignature(DsdInput input) throws IOException {
        if (input.size < 16) return false;
        ByteBuffer prefix = ByteBuffer.allocate(16);
        input.read(0, prefix.array(), 0, 16);
        return prefix.getInt(0) == id("DSD ") || (prefix.getInt(0) == id("FRM8") && prefix.getInt(12) == id("DSD "));
    }

    DsdFile(DsdInput input) throws IOException {
        this.input = input;
        // The shared kernels address sample positions with exact integer doubles.
        require(input.size >= 16 && input.size <= (1L << 53) - 1);
        int form = header(0, 16).getInt(0);
        dsf = form == id("DSD ");
        if (dsf) parseDsf();
        else {
            require(form == id("FRM8") && header.getInt(12) == id("DSD ") && header.getLong(4) == input.size - 12);
            parseDff();
        }
        require((rate == 2822400 || rate == 5644800 || rate == 11289600) && channels >= 1 && channels <= 6);
        if (packetCount != 0) {
            samples = packetCount * (rate / 75);
            packets = new DstPackets(this, data + 18, data + dataSize, packetCount, index);
        }
        require(samples > 0 && samples < (1L << 53));
    }

    static void require(boolean condition) throws IOException {
        if (!condition) throw new IOException("Invalid or unsupported DSD file");
    }
    static int id(String tag) {
        return tag.charAt(0) << 24 | tag.charAt(1) << 16 | tag.charAt(2) << 8 | tag.charAt(3);
    }
    // Callers consume this scratch header before reading the next one.
    ByteBuffer header(long offset, int bytes) throws IOException {
        input.read(offset, header.array(), 0, bytes);
        return header;
    }
    private void parseDsf() throws IOException {
        header(0, 28).order(ByteOrder.LITTLE_ENDIAN);
        require(header.getLong(4) == 28 && header.getLong(12) == input.size);
        long tags = header.getLong(20);
        header(28, 52);
        require(header.getInt(0) == Integer.reverseBytes(id("fmt ")) && header.getInt(12) == 1 && header.getInt(16) == 0);
        long fmtSize = header.getLong(4);
        require(fmtSize >= 52 && fmtSize <= input.size - 40);
        int layout = header.getInt(20);
        int[] counts = {0, 1, 2, 3, 4, 4, 5, 6};
        channels = header.getInt(24);
        require(layout >= 1 && layout < counts.length && channels == counts[layout]);
        if (layout == 5) channelMask = AudioFormat.CHANNEL_OUT_STEREO | AudioFormat.CHANNEL_OUT_FRONT_CENTER | AudioFormat.CHANNEL_OUT_BACK_CENTER;
        rate = header.getInt(28);
        int order = header.getInt(32);
        require(order == 1 || order == 8);
        lsb = order == 1;
        samples = header.getLong(36);
        require(samples > 0 && samples < (1L << 53) && header.getInt(44) == 4096);
        header(28 + fmtSize, 12);
        require(header.getInt(0) == Integer.reverseBytes(id("data")));
        data = 40 + fmtSize;
        dataSize = ((samples + 32767) / 32768) * 4096 * channels;
        require(header.getLong(4) == dataSize + 12 && dataSize <= input.size - data);
        require(tags == 0 || (tags >= data + dataSize && tags < input.size));
    }

    private long chunkSize(long offset, long end) throws IOException {
        require(++chunks <= 10000 && end - offset >= 12);
        long bytes = header(offset, 12).getLong(4);
        require(bytes >= 0 && bytes <= end - offset - 12 && bytes + (bytes & 1) <= end - offset - 12);
        return bytes;
    }
    private void parseDff() throws IOException {
        boolean properties = false;
        int compression = 0, audio = 0;
        for (long pos = 16; pos < input.size;) {
            long bytes = chunkSize(pos, input.size);
            int tag = header.getInt(0);
            pos += 12;
            if (tag == id("DSD ") || tag == id("DST ")) {
                require(data < 0);
                audio = tag; data = pos; dataSize = bytes;
                if (tag == id("DST ")) {
                    require(bytes >= 18 && header(pos, 18).getInt(0) == id("FRTE") && header.getLong(4) == 6);
                    packetCount = Integer.toUnsignedLong(header.getInt(12));
                    require(packetCount > 0 && header.getShort(16) == 75);
                }
            } else if (tag == id("DSTI")) {
                require(index < 0 && bytes % 12 == 0);
                index = pos; indexSize = bytes;
            } else if (tag == id("PROP")) {
                require(!properties && bytes >= 4 && header(pos, 4).getInt(0) == id("SND "));
                properties = true;
                long end = pos + bytes;
                for (long p = pos + 4; p < end;) {
                    long length = chunkSize(p, end);
                    int field = header.getInt(0);
                    p += 12;
                    if (field == id("FS  ")) {
                        require(rate == 0 && length == 4);
                        rate = header(p, 4).getInt(0);
                    } else if (field == id("CHNL")) {
                        require(channels == 0 && length >= 2);
                        channels = Short.toUnsignedInt(header(p, 2).getShort(0));
                        require(length == 2 + 4L * channels);
                    } else if (field == id("CMPR")) {
                        require(compression == 0 && length >= 5);
                        compression = header(p, 5).getInt(0);
                        require(5 + Byte.toUnsignedInt(header.get(4)) <= length);
                    }
                    p += length + (length & 1);
                }
            }
            pos += bytes + (bytes & 1);
        }
        require(data >= 0 && channels >= 1 && channels <= 6 && compression == audio);
        if (packetCount != 0) require(index < 0 || indexSize == packetCount * 12);
        else {
            require(dataSize % channels == 0);
            samples = dataSize / channels * 8;
        }
    }

    // JNI requests only the filter window. DSF returns whole planar groups, DFF interleaved bytes.
    private byte[] packed(long first, int count) throws IOException {
        long perChannel = (samples + 7) / 8;
        require(count > 0 && count <= 131072 && first >= 0 && first <= perChannel - count);
        long begin = dsf ? first / 4096 * 4096 : first;
        long end = dsf ? (first + count + 4095) / 4096 * 4096 : first + count;
        int length = (int) (end - begin) * channels;
        if (buffer.length < length) buffer = new byte[length];
        if (packets == null) input.read(data + begin * channels, buffer, 0, length);
        else packets.read(begin * channels, buffer, length);
        return buffer;
    }

    static { System.loadLibrary("effetune_android_dsd"); }
    long openConverter(int outputRate) { return create(rate, outputRate, channels, samples, dsf, lsb); }
    private native long create(int sourceRate, int outputRate, int channels, long samples, boolean dsf, boolean lsb);
    native void convert(long handle, long frame, int count, ByteBuffer output) throws IOException;
    static native void destroy(long handle);
}

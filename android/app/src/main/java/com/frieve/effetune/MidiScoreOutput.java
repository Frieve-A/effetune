package com.frieve.effetune;

import android.media.midi.MidiInputPort;
import android.os.ParcelFileDescriptor;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;

/** Mirrors prepared wire messages to a peripheral. All positions come from the DSP scheduler. */
final class MidiScoreOutput {
    private ByteBuffer messages;
    private MidiInputPort port;
    private final java.util.BitSet held = new java.util.BitSet(16 * 128);
    private boolean chase;
    private double chaseFrom;
    private long lastSend;

    void load(ParcelFileDescriptor file) throws IOException {
        clear();
        try (ParcelFileDescriptor.AutoCloseInputStream input = new ParcelFileDescriptor.AutoCloseInputStream(
                ParcelFileDescriptor.dup(file.getFileDescriptor()))) {
            FileChannel channel = input.getChannel();
            long size = channel.size();
            if (size < 16 || size > 64L * 1024 * 1024) throw new IOException("Invalid score length");
            ByteBuffer header = channel.map(FileChannel.MapMode.READ_ONLY, 0, 16).order(ByteOrder.LITTLE_ENDIAN);
            long start = 16 + 20L * header.getInt() + 40L * header.getInt();
            if (start < 16 || start > size) throw new IOException("Invalid output table");
            if (size > start) messages = channel.map(FileChannel.MapMode.READ_ONLY, start, size - start)
                    .order(ByteOrder.LITTLE_ENDIAN);
        }
    }

    void clear() { reset(); messages = null; }
    boolean hasOutput() { return port != null && messages != null; }

    void setPort(MidiInputPort next) {
        if (next == port) return;
        reset(); port = next; lastSend = 0;
    }

    void reset() { reset(Double.NaN); }

    void reset(double startSeconds) {
        if (!chase && port != null && messages != null) {
            try {
                long at = Math.max(System.nanoTime(), lastSend);
                for (int note = held.nextSetBit(0); note >= 0; note = held.nextSetBit(note + 1))
                    port.send(new byte[]{(byte) (0x80 | note >> 7), (byte) (note & 127), 0}, 0, 3, at);
                for (int channel = 0; channel < 16; channel++) {
                    for (int controller : new int[]{121, 64, 123})
                        port.send(new byte[]{(byte) (0xb0 | channel), (byte) controller, 0}, 0, 3, at);
                }
            } catch (IOException error) { android.util.Log.w("EffeTuneMidi", "Output release failed", error); }
        }
        chase = true;
        chaseFrom = startSeconds;
        held.clear();
        if (messages != null) messages.rewind();
    }

    void pump(double seconds, double speed) throws IOException {
        if (port == null || messages == null || seconds < 0) return;
        long now = System.nanoTime();
        if (chase) {
            // Replay device state in original order, starting at the last GM/GS/XG reset.
            int start = 0;
            double boundary = Double.isNaN(chaseFrom) ? seconds : chaseFrom;
            while (messages.hasRemaining() && messages.getDouble(messages.position()) < boundary) {
                int at = messages.position();
                messages.getDouble();
                int length = messages.getInt();
                if (length < 0) start = at;
                skip(length);
            }
            int end = messages.position();
            messages.position(start);
            while (messages.position() < end) {
                messages.getDouble();
                int length = messages.getInt();
                if ((messages.get(messages.position()) & 0xe0) == 0x80) skip(length);
                else write(length, now, true);
            }
            chase = false;
        }
        while (messages.hasRemaining()) {
            double time = messages.getDouble(messages.position());
            double ahead = (time - seconds) / speed;
            if (ahead >= 0.100) break;
            messages.getDouble();
            write(messages.getInt(), now + (long) (Math.max(0, ahead) * 1e9), false);
        }
    }

    private void skip(int taggedLength) throws IOException {
        int size = taggedLength & Integer.MAX_VALUE;
        if (size == 0 || size > messages.remaining()) throw new IOException("Invalid MIDI output record");
        messages.position(messages.position() + size);
    }

    private void write(int taggedLength, long at, boolean restoring) throws IOException {
        int size = taggedLength & Integer.MAX_VALUE;
        if (size == 0 || size > messages.remaining()) throw new IOException("Invalid MIDI output message");
        byte[] data = new byte[size];
        messages.get(data);
        lastSend = Math.max(at, lastSend);
        port.send(data, 0, data.length, lastSend);
        int kind = data[0] & 0xf0;
        if ((kind == 0x80 || kind == 0x90) && data.length == 3)
            held.set((data[0] & 15) * 128 + (data[1] & 127), kind == 0x90 && data[2] != 0);
        if (restoring && taggedLength < 0) lastSend += 100_000_000;
    }
}

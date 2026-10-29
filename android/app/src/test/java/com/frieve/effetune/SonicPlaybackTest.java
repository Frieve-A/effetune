package com.frieve.effetune;

import static org.junit.Assert.*;
import org.junit.Test;
import sonic.Sonic;

public final class SonicPlaybackTest {
    @Test public void floatOutputPreservesIndependentStereoChannels() {
        Sonic stream = new Sonic(48000, 2);
        float[] input = new float[512];
        for (int i = 0; i < 256; i++) { input[i * 2] = 0.125f; input[i * 2 + 1] = -0.375f; }
        stream.writeFloatToStream(input, 256);
        stream.flushStream();
        float[] output = new float[512];
        assertEquals(256, stream.readFloatFromStream(output, 256));
        for (int i = 0; i < 256; i++) { assertEquals(0.125, output[i * 2], 0.0001); assertEquals(-0.375, output[i * 2 + 1], 0.0001); }
    }
    @Test public void overrangeFloatInputSaturatesWithoutChangingPolarity() {
        Sonic stream = new Sonic(48000, 2);
        float[] input = {1.536f, -1.536f, 2.414f, -2.414f, 0.25f, -0.5f};
        stream.writeFloatToStream(input, 3); stream.flushStream();
        float[] output = new float[input.length];
        assertEquals(3, stream.readFloatFromStream(output, 3));
        assertEquals(1, output[0], 0.0001); assertEquals(-1, output[1], 0.0001);
        assertEquals(1, output[2], 0.0001); assertEquals(-1, output[3], 0.0001);
        assertEquals(0.25, output[4], 0.0001); assertEquals(-0.5, output[5], 0.0001);
    }
    @Test public void doubleSpeedKeepsTonePitchAndHalvesDuration() {
        int sampleRate = 48000;
        Sonic stream = new Sonic(sampleRate, 2); stream.setSpeed(2);
        float[] output = new float[sampleRate * 2];
        float[] block = new float[2048];
        int received = 0;
        for (int first = 0; first < sampleRate; first += 1024) {
            int frames = Math.min(1024, sampleRate - first);
            for (int i = 0; i < frames; i++) block[i * 2] = block[i * 2 + 1] = (float) (0.25 * Math.sin((first + i) * 2 * Math.PI * 440 / sampleRate));
            stream.writeFloatToStream(block, frames);
            int count;
            while ((count = stream.readFloatFromStream(block, 1024)) > 0) {
                System.arraycopy(block, 0, output, received * 2, count * 2); received += count;
            }
        }
        stream.flushStream();
        int count;
        while ((count = stream.readFloatFromStream(block, 1024)) > 0) { System.arraycopy(block, 0, output, received * 2, count * 2); received += count; }
        assertEquals(sampleRate / 2.0, received, sampleRate * 0.02);
        int crossings = 0, start = 2000, end = received - 2000;
        for (int i = start + 1; i < end; i++) if (output[(i - 1) * 2] <= 0 && output[i * 2] > 0) crossings++;
        assertEquals(440.0, crossings * (double) sampleRate / (end - start), 5.0);
    }
}

package com.frieve.effetune;

import static org.junit.Assert.*;
import android.media.AudioFormat;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.Test;

public final class StereoDownmixTest {
    @Test public void centerAndSurroundRemainAudibleOnTheirSpeakerSides() {
        StereoDownmix mix = new StereoDownmix(6, AudioFormat.CHANNEL_OUT_5POINT1);
        ByteBuffer input = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN);
        float[] output = new float[2];
        input.putFloat(8, 1); mix.frame(input, 0, AudioFormat.ENCODING_PCM_FLOAT, output, 0);
        assertEquals(Math.sqrt(0.5), output[0], 0.000001); assertEquals(output[0], output[1], 0);
        input.putFloat(8, 0); input.putFloat(16, 1); mix.frame(input, 0, AudioFormat.ENCODING_PCM_FLOAT, output, 0);
        assertEquals(Math.sqrt(0.5), output[0], 0.000001); assertEquals(0, output[1], 0);
        input.putFloat(16, 0); input.putFloat(20, 1); mix.frame(input, 0, AudioFormat.ENCODING_PCM_FLOAT, output, 0);
        assertEquals(0, output[0], 0); assertEquals(Math.sqrt(0.5), output[1], 0.000001);
    }
    @Test public void fullScaleCenterAndSurroundMixSaturatesAtSonicInput() {
        StereoDownmix mix = new StereoDownmix(6, AudioFormat.CHANNEL_OUT_5POINT1);
        ByteBuffer input = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN);
        input.putFloat(0, 1).putFloat(4, -1).putFloat(8, 0.8f).putFloat(16, 1).putFloat(20, -1);
        float[] stereo = new float[2]; mix.frame(input, 0, AudioFormat.ENCODING_PCM_FLOAT, stereo, 0);
        assertTrue(stereo[0] > 1); assertTrue(stereo[1] < -1);
        sonic.Sonic stream = new sonic.Sonic(48000, 2); stream.writeFloatToStream(stereo, 1); stream.flushStream();
        assertEquals(1, stream.readFloatFromStream(stereo, 1));
        assertEquals(1, stereo[0], 0.0001); assertEquals(-1, stereo[1], 0.0001);
    }
    @Test public void monoAndStereoKeepOriginalSamples() {
        ByteBuffer input = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putFloat(0.25f).putFloat(-0.5f);
        float[] output = new float[2];
        new StereoDownmix(1, 0).frame(input, 0, AudioFormat.ENCODING_PCM_FLOAT, output, 0);
        assertArrayEquals(new float[]{0.25f, 0.25f}, output, 0);
        new StereoDownmix(2, 0).frame(input, 0, AudioFormat.ENCODING_PCM_FLOAT, output, 0);
        assertArrayEquals(new float[]{0.25f, -0.5f}, output, 0);
    }
}

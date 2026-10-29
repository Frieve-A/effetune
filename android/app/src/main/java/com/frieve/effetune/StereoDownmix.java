package com.frieve.effetune;

import android.media.AudioFormat;
import java.nio.ByteBuffer;

/** Android position-mask PCM to a stereo speaker mix. */
final class StereoDownmix {
    private final float[] left, right;
    StereoDownmix(int channels, int mask) {
        if (channels < 1 || channels > 16) throw new IllegalArgumentException("Unsupported channel layout");
        left = new float[channels]; right = new float[channels];
        if (channels == 1) { left[0] = right[0] = 1; return; }
        if (channels == 2) { left[0] = right[1] = 1; return; }
        if (mask == 0) {
            switch (channels) {
                case 3: mask = 0x1c; break;
                case 4: mask = AudioFormat.CHANNEL_OUT_QUAD; break;
                case 5: mask = AudioFormat.CHANNEL_OUT_QUAD | AudioFormat.CHANNEL_OUT_FRONT_CENTER; break;
                case 6: mask = AudioFormat.CHANNEL_OUT_5POINT1; break;
                case 7: mask = AudioFormat.CHANNEL_OUT_5POINT1 | AudioFormat.CHANNEL_OUT_BACK_CENTER; break;
                case 8: mask = AudioFormat.CHANNEL_OUT_7POINT1_SURROUND; break;
                default: throw new IllegalArgumentException("The decoder did not describe its channel layout");
            }
        }
        if (Integer.bitCount(mask) != channels) throw new IllegalArgumentException("Invalid channel layout");
        int index = 0;
        for (int bit = 0; bit < 31; bit++) if ((mask & (1 << bit)) != 0) {
            int position = 1 << bit;
            if (position == AudioFormat.CHANNEL_OUT_FRONT_LEFT) left[index] = 1;
            else if (position == AudioFormat.CHANNEL_OUT_FRONT_RIGHT) right[index] = 1;
            else if (position == AudioFormat.CHANNEL_OUT_LOW_FREQUENCY) { /* LFE is omitted from the stereo speaker mix. */ }
            else if (position == AudioFormat.CHANNEL_OUT_BACK_LEFT || position == AudioFormat.CHANNEL_OUT_SIDE_LEFT
                    || position == AudioFormat.CHANNEL_OUT_FRONT_LEFT_OF_CENTER || position == AudioFormat.CHANNEL_OUT_TOP_FRONT_LEFT
                    || position == AudioFormat.CHANNEL_OUT_TOP_BACK_LEFT) left[index] = 0.70710678f;
            else if (position == AudioFormat.CHANNEL_OUT_BACK_RIGHT || position == AudioFormat.CHANNEL_OUT_SIDE_RIGHT
                    || position == AudioFormat.CHANNEL_OUT_FRONT_RIGHT_OF_CENTER || position == AudioFormat.CHANNEL_OUT_TOP_FRONT_RIGHT
                    || position == AudioFormat.CHANNEL_OUT_TOP_BACK_RIGHT) right[index] = 0.70710678f;
            else if (position == AudioFormat.CHANNEL_OUT_FRONT_CENTER) left[index] = right[index] = 0.70710678f;
            else if (position == AudioFormat.CHANNEL_OUT_BACK_CENTER || position == AudioFormat.CHANNEL_OUT_TOP_CENTER
                    || position == AudioFormat.CHANNEL_OUT_TOP_FRONT_CENTER || position == AudioFormat.CHANNEL_OUT_TOP_BACK_CENTER) left[index] = right[index] = 0.5f;
            else throw new IllegalArgumentException("Unsupported channel position");
            index++;
        }
    }
    void frame(ByteBuffer input, int offset, int encoding, float[] output, int target) {
        int bytes = encoding == AudioFormat.ENCODING_PCM_FLOAT ? 4 : 2;
        float l = 0, r = 0;
        for (int i = 0; i < left.length; i++) {
            float sample = bytes == 4 ? input.getFloat(offset + i * bytes) : input.getShort(offset + i * bytes) / 32768.0f;
            if (!Float.isFinite(sample)) sample = 0;
            l += sample * left[i]; r += sample * right[i];
        }
        output[target] = l; output[target + 1] = r;
    }
}

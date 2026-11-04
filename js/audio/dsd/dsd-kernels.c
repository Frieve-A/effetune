/* SPDX-License-Identifier: MIT
 * DSD conversion kernels. Coefficients and phase tables are prepared by the
 * JavaScript controller; this module owns only synchronous arithmetic.
 */
#include <stdint.h>
#include <wasm_simd128.h>

void dsd_decimate_bits(const uint8_t *bytes, double byte_offset, double start,
                       int count, double sample_count, int lsb,
                       const double *coefficients, const double *table,
                       double *output) {
  const int taps = 353;
  const int table_bytes = 45;
  const double full_bytes = __builtin_floor(sample_count / 8);
  for (int frame = 0; frame < count; ++frame) {
    const double first = (start + frame) * 2 - 22;
    // Independent output lanes retain each sample's original summation order.
    if (frame + 1 < count && first >= 0 &&
        first + table_bytes + 2 <= full_bytes) {
      const int offset = (int)(first - byte_offset);
      v128_t sum2 = wasm_f64x2_splat(0);
      for (int byte = 0; byte < table_bytes; ++byte) {
        sum2 = wasm_f64x2_add(
            sum2,
            wasm_f64x2_make(table[byte * 256 + bytes[offset + byte]],
                            table[byte * 256 + bytes[offset + byte + 2]]));
      }
      wasm_v128_store(output + frame, sum2);
      ++frame;
      continue;
    }
    double sum = 0;
    if (first >= 0 && first + table_bytes <= full_bytes) {
      const int offset = (int)(first - byte_offset);
      for (int byte = 0; byte < table_bytes; ++byte) {
        sum += table[byte * 256 + bytes[offset + byte]];
      }
    } else {
      for (int tap = 0; tap < taps; ++tap) {
        const double sample = first * 8 + tap;
        if (sample < 0 || sample >= sample_count)
          continue;
        const double position = __builtin_floor(sample / 8);
        const unsigned bit = (unsigned)(sample - position * 8);
        const unsigned shift = lsb ? bit : 7 - bit;
        const uint8_t value = bytes[(int)(position - byte_offset)];
        sum += ((value >> shift) & 1 ? 1 : -1) * coefficients[tap];
      }
    }
    output[frame] = sum;
  }
}

void dsd_decimate_pcm(const double *input, int count,
                      const double *coefficients, double *output) {
  int frame = 0;
  for (; frame + 1 < count; frame += 2) {
    const int first = frame * 2;
    v128_t sum =
        wasm_f64x2_mul(wasm_f64x2_make(input[first + 31], input[first + 33]),
                       wasm_f64x2_splat(coefficients[31]));
    for (int tap = 0; tap < 31; ++tap) {
      const v128_t left =
          wasm_f64x2_make(input[first + tap], input[first + tap + 2]);
      const v128_t right =
          wasm_f64x2_make(input[first + 62 - tap], input[first + 64 - tap]);
      sum = wasm_f64x2_add(sum,
                           wasm_f64x2_mul(wasm_f64x2_add(left, right),
                                          wasm_f64x2_splat(coefficients[tap])));
    }
    wasm_v128_store(output + frame, sum);
  }
  for (; frame < count; ++frame) {
    const int first = frame * 2;
    double sum = input[first + 31] * coefficients[31];
    for (int tap = 0; tap < 31; ++tap) {
      sum += (input[first + tap] + input[first + 62 - tap]) * coefficients[tap];
    }
    output[frame] = sum;
  }
}

void dsd_resample(const double *pcm, double start_frame, int count,
                  double ratio, double range_start, const double *phases,
                  int length, float *output, double *cache, double *keys,
                  int slots) {
  const int half = (length - 1) / 2;
  for (int frame = 0; frame < count; ++frame) {
    const double position = (start_frame + frame) * ratio;
    const double integer = __builtin_floor(position);
    const double fraction = (position - integer) * 512;
    const int phase = (int)fraction;
    const double blend = fraction - phase;
    const int offset = (int)(integer - half - range_start);
    const int kernel = phase * length;
    double sum = 0;
    if (fraction == 0) {
      sum = pcm[offset + half] * phases[half];
      for (int tap = 0; tap < half; ++tap) {
        sum +=
            (pcm[offset + tap] + pcm[offset + length - 1 - tap]) * phases[tap];
      }
    } else {
      // Reuse only an identical fractional position, without quantizing phase.
      const int slot = phase & (slots - 1);
      double *coefficients = cache + slot * length;
      if (keys[slot] != fraction) {
        const v128_t blend2 = wasm_f64x2_splat(blend);
        int tap = 0;
        for (; tap + 1 < length; tap += 2) {
          const v128_t first = wasm_v128_load(phases + kernel + tap);
          const v128_t second = wasm_v128_load(phases + kernel + length + tap);
          wasm_v128_store(
              coefficients + tap,
              wasm_f64x2_add(
                  first,
                  wasm_f64x2_mul(wasm_f64x2_sub(second, first), blend2)));
        }
        for (; tap < length; ++tap)
          coefficients[tap] =
              phases[kernel + tap] +
              (phases[kernel + length + tap] - phases[kernel + tap]) * blend;
        keys[slot] = fraction;
      }
      int tap = 0;
      for (; tap + 1 < length; tap += 2) {
        const v128_t product =
            wasm_f64x2_mul(wasm_v128_load(pcm + offset + tap),
                           wasm_v128_load(coefficients + tap));
        sum += wasm_f64x2_extract_lane(product, 0);
        sum += wasm_f64x2_extract_lane(product, 1);
      }
      for (; tap < length; ++tap)
        sum += pcm[offset + tap] * coefficients[tap];
    }
    output[frame] = (float)sum;
  }
}

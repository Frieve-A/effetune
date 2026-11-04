/*
 * Direct Stream Transfer decoder, derived from FFmpeg n7.1.1 dstdec.c.
 * Copyright (c) 2014 Peter Ross <pross@xvid.org>
 * Copyright (c) 2026 Yoshiyuki Kobayashi
 * SPDX-License-Identifier: LGPL-2.1-or-later
 * Modified 2026-11-01: freestanding bounded mono/stereo frame decoder,
 * packed DSD output, implicit one-entry probability table support and
 * two-word predictor history updates.
 * See dst-decoder.NOTICE.txt and dst-decoder.LICENSE.txt.
 * This library is distributed WITHOUT ANY WARRANTY, including the implied
 * warranties of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */
#include <stdint.h>

typedef struct {
  const uint8_t *data;
  int length, position, invalid;
} Bits;

static unsigned read_bits(Bits *bits, int count, int arithmetic) {
  if (count < 0 || count > 16 ||
      bits->position + count > bits->length * 8 + (arithmetic ? 16 : 0)) {
    bits->invalid = 1;
    return 0;
  }
  unsigned value = 0;
  for (int bit = 0; bit < count; ++bit) {
    const int position = bits->position++;
    const unsigned byte =
        position / 8 < bits->length ? bits->data[position / 8] : 0;
    value = (value << 1) | ((byte >> (7 - (position & 7))) & 1);
  }
  return value;
}

static int read_rice(Bits *bits, int count) {
  unsigned quotient = 0;
  while (!read_bits(bits, 1, 0)) {
    if (bits->invalid || ++quotient > 65535) {
      bits->invalid = 1;
      return 0;
    }
  }
  const int value = (int)((quotient << count) + read_bits(bits, count, 0));
  return value && read_bits(bits, 1, 0) ? -value : value;
}

typedef struct {
  int elements;
  unsigned map[2];
  int length[2];
  int32_t coefficients[2][128];
} Tables;

static void read_map(Bits *bits, Tables *table, int channels) {
  table->elements = 1;
  table->map[0] = table->map[1] = 0;
  if (!read_bits(bits, 1, 0) && channels == 2) {
    table->map[1] = read_bits(bits, 1, 0);
    table->elements += (int)table->map[1];
  }
}

static int read_tables(Bits *bits, Tables *tables, int probability) {
  static const int filter_predictors[3][3] = {
      {-8, 0, 0}, {-16, 8, 0}, {-9, -5, 6}};
  static const int probability_predictors[3][3] = {
      {-8, 0, 0}, {-16, 8, 0}, {-24, 24, -8}};
  const int(*predictors)[3] =
      probability ? probability_predictors : filter_predictors;
  for (int element = 0; element < tables->elements; ++element) {
    const int length = (int)read_bits(bits, probability ? 6 : 7, 0) + 1;
    tables->length[element] = length;
    int32_t *table = tables->coefficients[element];
    if (probability && length == 1) {
      table[0] = 128;
      continue;
    }
    const int coded = (int)read_bits(bits, 1, 0);
    const int method = coded ? (int)read_bits(bits, 2, 0) : 0;
    if (method == 3 || (coded && method + 1 > length))
      return -1;
    const int direct = coded ? method + 1 : length;
    for (int index = 0; index < direct; ++index) {
      const unsigned value = read_bits(bits, probability ? 7 : 9, 0);
      table[index] = probability ? (int)value + 1
                                 : (int)(value & 255) - (int)(value & 256);
    }
    if (coded) {
      const int rice = (int)read_bits(bits, 3, 0);
      for (int index = direct; index < length; ++index) {
        int64_t prediction = 0;
        for (int tap = 0; tap <= method; ++tap) {
          prediction +=
              (int64_t)predictors[method][tap] * table[index - tap - 1];
        }
        const int64_t correction =
            prediction >= 0 ? (prediction + 4) / 8 : -((-prediction + 3) / 8);
        const int64_t value = (int64_t)read_rice(bits, rice) - correction;
        if (probability && (value < 1 || value > 128))
          return -1;
        // Predictor arithmetic is bounded explicitly before narrowing.
        if (value < INT32_MIN || value > INT32_MAX)
          return -1;
        table[index] = (int32_t)value;
      }
    }
    if (bits->invalid)
      return -1;
  }
  return 0;
}

typedef struct {
  unsigned range, code;
  Bits *bits;
} Arithmetic;

static unsigned arithmetic_bit(Arithmetic *decoder, unsigned probability) {
  const unsigned split =
      ((decoder->range >> 8) | ((decoder->range >> 7) & 1)) * probability;
  const unsigned remaining = decoder->range - split;
  const unsigned bit = decoder->code < remaining;
  if (bit)
    decoder->range = remaining;
  else {
    decoder->range = split;
    decoder->code -= remaining;
  }
  if (decoder->range < 2048) {
    if (decoder->range == 0) {
      decoder->bits->invalid = 1;
      return 0;
    }
    const int shift = __builtin_clz(decoder->range) - 20;
    decoder->range <<= shift;
    decoder->code =
        (decoder->code << shift) | read_bits(decoder->bits, shift, 1);
  }
  return bit;
}

int dst_decode(const uint8_t *packet, int length, int channels, int samples,
               uint8_t *output) {
  if (length <= 1 || length > 1048576 || (channels != 1 && channels != 2) ||
      (samples != 37632 && samples != 75264 && samples != 150528))
    return -1;
  const int output_size = samples / 8 * channels;
  Bits bits = {packet, length, 0, 0};
  if (!read_bits(&bits, 1, 0)) {
    read_bits(&bits, 1, 0);
    if (read_bits(&bits, 6, 0) || length != output_size + 1)
      return -1;
    for (int i = 0; i < output_size; ++i)
      output[i] = packet[i + 1];
    return 0;
  }
  if (!read_bits(&bits, 1, 0) || !read_bits(&bits, 1, 0) ||
      !read_bits(&bits, 1, 0))
    return -2;
  const unsigned same_map = read_bits(&bits, 1, 0);
  Tables filters, probabilities;
  read_map(&bits, &filters, channels);
  if (same_map) {
    probabilities.elements = filters.elements;
    probabilities.map[0] = filters.map[0];
    probabilities.map[1] = filters.map[1];
  } else
    read_map(&bits, &probabilities, channels);
  unsigned half[2] = {0, 0};
  for (int channel = 0; channel < channels; ++channel)
    half[channel] = read_bits(&bits, 1, 0);
  if (read_tables(&bits, &filters, 0) || read_tables(&bits, &probabilities, 1))
    return -1;
  if (read_bits(&bits, 1, 0))
    return -1;
  Arithmetic arithmetic = {4095, read_bits(&bits, 12, 0), &bits};
  if (bits.invalid)
    return -1;
  int16_t lookup[2][16][256];
  for (int element = 0; element < filters.elements; ++element) {
    for (int group = 0; group < 16; ++group) {
      for (unsigned value = 0; value < 256; ++value) {
        int64_t sum = 0;
        for (int bit = 0; bit < 8 && group * 8 + bit < filters.length[element];
             ++bit) {
          sum += (int64_t)((value >> bit) & 1 ? 1 : -1) *
                 filters.coefficients[element][group * 8 + bit];
        }
        if (sum < INT16_MIN || sum > INT16_MAX)
          return -1;
        lookup[element][group][value] = (int16_t)sum;
      }
    }
  }
  // WebAssembly is little-endian, so the byte view retains the lookup order.
  uint64_t history[2][2];
  for (int channel = 0; channel < channels; ++channel) {
    for (int group = 0; group < 2; ++group)
      history[channel][group] = UINT64_C(0xaaaaaaaaaaaaaaaa);
  }
  for (int i = 0; i < output_size; ++i)
    output[i] = 0;
  unsigned reversed = 0;
  for (int bit = 0; bit < 7; ++bit)
    reversed =
        (reversed << 1) | (((uint32_t)filters.coefficients[0][0] >> bit) & 1);
  arithmetic_bit(&arithmetic, reversed + 1);
  for (int sample = 0; sample < samples; ++sample) {
    for (int channel = 0; channel < channels; ++channel) {
      const unsigned element = filters.map[channel];
      const uint8_t *state = (const uint8_t *)history[channel];
      int prediction = 0;
      for (int group = 0; group < 16; ++group)
        prediction += lookup[element][group][state[group]];
      // Reproduce the codec's signed 16-bit prediction without signed overflow.
      prediction = (int)((unsigned)prediction & 32767) -
                   (int)((unsigned)prediction & 32768);
      unsigned probability = 128;
      if (!half[channel] || sample >= filters.length[element]) {
        const unsigned index =
            (unsigned)(prediction < 0 ? -prediction : prediction) >> 3;
        const unsigned table = probabilities.map[channel];
        const unsigned last = (unsigned)probabilities.length[table] - 1;
        probability =
            (unsigned)
                probabilities.coefficients[table][index < last ? index : last];
      }
      const unsigned bit =
          (prediction < 0 ? 1u : 0u) ^ arithmetic_bit(&arithmetic, probability);
      output[(sample >> 3) * channels + channel] |=
          (uint8_t)(bit << (7 - (sample & 7)));
      history[channel][1] =
          (history[channel][1] << 1) | (history[channel][0] >> 63);
      history[channel][0] = (history[channel][0] << 1) | bit;
    }
    if (bits.invalid)
      return -1;
  }
  return 0;
}

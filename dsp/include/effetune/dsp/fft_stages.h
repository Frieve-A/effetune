#ifndef EFFETUNE_DSP_FFT_STAGES_H
#define EFFETUNE_DSP_FFT_STAGES_H

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace effetune::dsp::fft_stages {

constexpr double kPi = 3.1415926535897932384626433832795;

struct ComplexValue {
  float real = 0.0F;
  float imaginary = 0.0F;
};

inline ComplexValue loadComplex(const float *data, std::uint32_t index) noexcept {
  return {data[2u * index], data[2u * index + 1u]};
}

inline void storeComplex(float *data, std::uint32_t index, ComplexValue value) noexcept {
  data[2u * index] = static_cast<float>(value.real);
  data[2u * index + 1u] = static_cast<float>(value.imaginary);
}

inline ComplexValue add(ComplexValue left, ComplexValue right) noexcept {
  return {left.real + right.real, left.imaginary + right.imaginary};
}

inline ComplexValue multiply(ComplexValue left, ComplexValue right) noexcept {
  return {left.real * right.real - left.imaginary * right.imaginary,
          left.real * right.imaginary + left.imaginary * right.real};
}

inline void prepareTwiddles(float *twiddles, std::uint32_t fft_size) noexcept {
  for (std::uint32_t index = 0u; index < fft_size; ++index) {
    const double phase = -2.0 * kPi * static_cast<double>(index) / static_cast<double>(fft_size);
    twiddles[2u * index] = static_cast<float>(std::cos(phase));
    twiddles[2u * index + 1u] = static_cast<float>(std::sin(phase));
  }
}

inline ComplexValue twiddle(const float *twiddles, std::uint32_t index) noexcept {
  return {twiddles[2u * index], twiddles[2u * index + 1u]};
}

inline void packWindowed(const float *input_ring, std::size_t input_offset,
                         std::uint32_t timeline_size, std::uint32_t frame_origin,
                         const float *window, float *subsequences, std::uint32_t fft_size,
                         std::uint32_t begin, std::uint32_t end) noexcept {
  const std::uint32_t subsequence_length = fft_size / 8u;
  const std::uint32_t subsequence_stride = 2u * subsequence_length;
  for (std::uint32_t packed_index = begin; packed_index < end; ++packed_index) {
    const std::uint32_t even_index = 2u * packed_index;
    const std::uint32_t odd_index = even_index + 1u;
    const std::uint32_t even_source = frame_origin + even_index < timeline_size
                                          ? frame_origin + even_index
                                          : frame_origin + even_index - timeline_size;
    const std::uint32_t odd_source = frame_origin + odd_index < timeline_size
                                         ? frame_origin + odd_index
                                         : frame_origin + odd_index - timeline_size;
    const std::uint32_t subsequence = packed_index & 3u;
    const std::uint32_t destination = subsequence * subsequence_stride + 2u * (packed_index >> 2u);
    subsequences[destination] = input_ring[input_offset + even_source] * window[even_index];
    subsequences[destination + 1u] = input_ring[input_offset + odd_source] * window[odd_index];
  }
}

template <std::uint32_t Radix>
inline void packComplexRadix(const float *input, float *subsequences, std::uint32_t complex_size,
                             std::uint32_t begin, std::uint32_t end) noexcept {
  static_assert(Radix > 0u && (Radix & (Radix - 1u)) == 0u);
  const std::uint32_t subsequence_length = complex_size / Radix;
  for (std::uint32_t input_index = begin; input_index < end; ++input_index) {
    const std::uint32_t subsequence = input_index & (Radix - 1u);
    const std::uint32_t destination = subsequence * subsequence_length + input_index / Radix;
    storeComplex(subsequences, destination, loadComplex(input, input_index));
  }
}

inline void packComplex(const float *input, float *subsequences, std::uint32_t complex_size,
                        std::uint32_t begin, std::uint32_t end) noexcept {
  packComplexRadix<4u>(input, subsequences, complex_size, begin, end);
}

inline void combineComplexForward(const float *subsequences, float *spectrum, const float *twiddles,
                                  std::uint32_t complex_size, std::uint32_t twiddle_period,
                                  std::uint32_t begin, std::uint32_t end) noexcept {
  const std::uint32_t subsequence_length = complex_size / 4u;
  const std::uint32_t twiddle_step = twiddle_period / complex_size;
  const std::uint32_t twiddle_mask = twiddle_period - 1u;
  for (std::uint32_t output_index = begin; output_index < end; ++output_index) {
    const std::uint32_t subsequence_bin = output_index % subsequence_length;
    const ComplexValue first = loadComplex(subsequences, subsequence_bin);
    const ComplexValue second =
        multiply(loadComplex(subsequences, subsequence_length + subsequence_bin),
                 twiddle(twiddles, (twiddle_step * output_index) & twiddle_mask));
    const ComplexValue third =
        multiply(loadComplex(subsequences, 2u * subsequence_length + subsequence_bin),
                 twiddle(twiddles, (2u * twiddle_step * output_index) & twiddle_mask));
    const ComplexValue fourth =
        multiply(loadComplex(subsequences, 3u * subsequence_length + subsequence_bin),
                 twiddle(twiddles, (3u * twiddle_step * output_index) & twiddle_mask));
    storeComplex(spectrum, output_index, add(add(first, second), add(third, fourth)));
  }
}

inline void combineComplexForwardRadix2(const float *subsequences, float *spectrum,
                                        const float *twiddles, std::uint32_t complex_size,
                                        std::uint32_t twiddle_period, std::uint32_t begin,
                                        std::uint32_t end) noexcept {
  const std::uint32_t subsequence_length = complex_size / 2u;
  const std::uint32_t twiddle_step = twiddle_period / complex_size;
  const std::uint32_t twiddle_mask = twiddle_period - 1u;
  for (std::uint32_t output_index = begin; output_index < end; ++output_index) {
    const std::uint32_t subsequence_bin = output_index & (subsequence_length - 1u);
    const std::uint32_t first_index = 2u * subsequence_bin;
    const std::uint32_t second_index = 2u * (subsequence_length + subsequence_bin);
    const std::uint32_t twiddle_index = (twiddle_step * output_index) & twiddle_mask;
    const float second_real = subsequences[second_index];
    const float second_imaginary = subsequences[second_index + 1u];
    const float rotation_real = twiddles[2u * twiddle_index];
    const float rotation_imaginary = twiddles[2u * twiddle_index + 1u];
    spectrum[2u * output_index] = subsequences[first_index] + second_real * rotation_real -
                                  second_imaginary * rotation_imaginary;
    spectrum[2u * output_index + 1u] = subsequences[first_index + 1u] +
                                       second_real * rotation_imaginary +
                                       second_imaginary * rotation_real;
  }
}

inline void combineForward(const float *subsequences, float *packed_spectrum, const float *twiddles,
                           std::uint32_t fft_size, std::uint32_t begin,
                           std::uint32_t end) noexcept {
  combineComplexForward(subsequences, packed_spectrum, twiddles, fft_size / 2u, fft_size, begin,
                        end);
}

inline void splitForward(const float *packed_spectrum, float *spectrum, const float *twiddles,
                         std::uint32_t fft_size, std::uint32_t begin, std::uint32_t end) noexcept {
  const std::uint32_t packed_size = fft_size / 2u;
  for (std::uint32_t bin = begin; bin < end; ++bin) {
    if (bin == 0u) {
      const ComplexValue zero = loadComplex(packed_spectrum, 0u);
      spectrum[0u] = static_cast<float>(zero.real + zero.imaginary);
      spectrum[1u] = static_cast<float>(zero.real - zero.imaginary);
      continue;
    }

    const ComplexValue first = loadComplex(packed_spectrum, bin);
    const ComplexValue reflected = loadComplex(packed_spectrum, packed_size - bin);
    const ComplexValue second{reflected.real, -reflected.imaginary};
    const ComplexValue sum = add(first, second);
    const ComplexValue difference{first.real - second.real, first.imaginary - second.imaginary};
    const ComplexValue rotated = multiply(twiddle(twiddles, bin), difference);
    const ComplexValue output{0.5F * (sum.real + rotated.imaginary),
                              0.5F * (sum.imaginary - rotated.real)};
    if (std::isfinite(output.real) && std::isfinite(output.imaginary)) {
      storeComplex(spectrum, bin, output);
    } else {
      storeComplex(spectrum, bin, {});
    }
  }
  if (begin == 0u) {
    if (!std::isfinite(spectrum[0u])) {
      spectrum[0u] = 0.0F;
    }
    if (!std::isfinite(spectrum[1u])) {
      spectrum[1u] = 0.0F;
    }
  }
}

inline void mergeInverse(const float *spectrum, float *packed_spectrum, const float *twiddles,
                         std::uint32_t fft_size, std::uint32_t begin, std::uint32_t end) noexcept {
  const std::uint32_t packed_size = fft_size / 2u;
  for (std::uint32_t bin = begin; bin < end; ++bin) {
    if (bin == 0u) {
      storeComplex(packed_spectrum, 0u, {spectrum[0u] + spectrum[1u], spectrum[0u] - spectrum[1u]});
      continue;
    }

    const ComplexValue first = loadComplex(spectrum, bin);
    const ComplexValue reflected = loadComplex(spectrum, packed_size - bin);
    const ComplexValue second{reflected.real, -reflected.imaginary};
    const ComplexValue sum = add(first, second);
    const ComplexValue difference{first.real - second.real, first.imaginary - second.imaginary};
    ComplexValue inverse_rotation = twiddle(twiddles, bin);
    inverse_rotation.imaginary = -inverse_rotation.imaginary;
    const ComplexValue rotated = multiply(inverse_rotation, difference);
    storeComplex(packed_spectrum, bin,
                 {sum.real - rotated.imaginary, sum.imaginary + rotated.real});
  }
}

template <std::uint32_t Subsequence>
inline void separateComplexInverseSubsequence(const float *spectrum, float *subsequences,
                                              const float *twiddles, std::uint32_t complex_size,
                                              std::uint32_t twiddle_period, std::uint32_t begin,
                                              std::uint32_t end) noexcept {
  const std::uint32_t subsequence_length = complex_size / 4u;
  const std::uint32_t twiddle_step = twiddle_period / complex_size;
  for (std::uint32_t bin = begin; bin < end; ++bin) {
    const ComplexValue first = loadComplex(spectrum, bin);
    const ComplexValue second = loadComplex(spectrum, bin + subsequence_length);
    const ComplexValue third = loadComplex(spectrum, bin + 2u * subsequence_length);
    const ComplexValue fourth = loadComplex(spectrum, bin + 3u * subsequence_length);
    ComplexValue sum;
    if constexpr (Subsequence == 0u) {
      sum = add(add(first, second), add(third, fourth));
    } else if constexpr (Subsequence == 1u) {
      sum = {first.real - second.imaginary - third.real + fourth.imaginary,
             first.imaginary + second.real - third.imaginary - fourth.real};
    } else if constexpr (Subsequence == 2u) {
      sum = {first.real - second.real + third.real - fourth.real,
             first.imaginary - second.imaginary + third.imaginary - fourth.imaginary};
    } else {
      sum = {first.real + second.imaginary - third.real - fourth.imaginary,
             first.imaginary - second.real - third.imaginary + fourth.real};
    }
    if constexpr (Subsequence == 0u) {
      storeComplex(subsequences, bin, sum);
    } else {
      ComplexValue inverse_rotation = twiddle(twiddles, twiddle_step * Subsequence * bin);
      inverse_rotation.imaginary = -inverse_rotation.imaginary;
      storeComplex(subsequences, Subsequence * subsequence_length + bin,
                   multiply(sum, inverse_rotation));
    }
  }
}

inline void separateComplexInverse(const float *spectrum, float *subsequences,
                                   const float *twiddles, std::uint32_t complex_size,
                                   std::uint32_t twiddle_period, std::uint32_t subsequence,
                                   std::uint32_t begin, std::uint32_t end) noexcept {
  switch (subsequence) {
  case 0u:
    separateComplexInverseSubsequence<0u>(spectrum, subsequences, twiddles, complex_size,
                                          twiddle_period, begin, end);
    break;
  case 1u:
    separateComplexInverseSubsequence<1u>(spectrum, subsequences, twiddles, complex_size,
                                          twiddle_period, begin, end);
    break;
  case 2u:
    separateComplexInverseSubsequence<2u>(spectrum, subsequences, twiddles, complex_size,
                                          twiddle_period, begin, end);
    break;
  default:
    separateComplexInverseSubsequence<3u>(spectrum, subsequences, twiddles, complex_size,
                                          twiddle_period, begin, end);
    break;
  }
}

inline void separateComplexInverseRadix2(const float *spectrum, float *subsequences,
                                         const float *twiddles, std::uint32_t complex_size,
                                         std::uint32_t twiddle_period, std::uint32_t subsequence,
                                         std::uint32_t begin, std::uint32_t end) noexcept {
  const std::uint32_t subsequence_length = complex_size / 2u;
  if (subsequence == 0u) {
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      const std::uint32_t first_index = 2u * bin;
      const std::uint32_t second_index = 2u * (bin + subsequence_length);
      subsequences[first_index] = spectrum[first_index] + spectrum[second_index];
      subsequences[first_index + 1u] = spectrum[first_index + 1u] + spectrum[second_index + 1u];
    }
    return;
  }

  const std::uint32_t twiddle_step = twiddle_period / complex_size;
  for (std::uint32_t bin = begin; bin < end; ++bin) {
    const std::uint32_t first_index = 2u * bin;
    const std::uint32_t second_index = 2u * (bin + subsequence_length);
    const float difference_real = spectrum[first_index] - spectrum[second_index];
    const float difference_imaginary = spectrum[first_index + 1u] - spectrum[second_index + 1u];
    const float rotation_real = twiddles[2u * twiddle_step * bin];
    const float rotation_imaginary = -twiddles[2u * twiddle_step * bin + 1u];
    subsequences[second_index] =
        difference_real * rotation_real - difference_imaginary * rotation_imaginary;
    subsequences[second_index + 1u] =
        difference_real * rotation_imaginary + difference_imaginary * rotation_real;
  }
}

inline void separateInverse(const float *packed_spectrum, float *subsequences,
                            const float *twiddles, std::uint32_t fft_size,
                            std::uint32_t subsequence, std::uint32_t begin,
                            std::uint32_t end) noexcept {
  separateComplexInverse(packed_spectrum, subsequences, twiddles, fft_size / 2u, fft_size,
                         subsequence, begin, end);
}

template <std::uint32_t Radix>
inline void unpackComplexRadix(const float *subsequences, float *output, std::uint32_t complex_size,
                               std::uint32_t begin, std::uint32_t end) noexcept {
  static_assert(Radix > 0u && (Radix & (Radix - 1u)) == 0u);
  const std::uint32_t subsequence_length = complex_size / Radix;
  for (std::uint32_t output_index = begin; output_index < end; ++output_index) {
    const std::uint32_t subsequence = output_index & (Radix - 1u);
    const std::uint32_t source = subsequence * subsequence_length + output_index / Radix;
    storeComplex(output, output_index, loadComplex(subsequences, source));
  }
}

inline void unpackComplex(const float *subsequences, float *output, std::uint32_t complex_size,
                          std::uint32_t begin, std::uint32_t end) noexcept {
  unpackComplexRadix<4u>(subsequences, output, complex_size, begin, end);
}

inline float unpackSample(const float *subsequences, std::uint32_t fft_size,
                          std::uint32_t sample_index) noexcept {
  const std::uint32_t packed_index = sample_index / 2u;
  const std::uint32_t subsequence_length = fft_size / 8u;
  const std::uint32_t subsequence_stride = 2u * subsequence_length;
  const std::uint32_t source =
      (packed_index & 3u) * subsequence_stride + 2u * (packed_index >> 2u) + (sample_index & 1u);
  return subsequences[source];
}

} // namespace effetune::dsp::fft_stages

#endif

#ifndef EFFETUNE_DSP_FIR_H
#define EFFETUNE_DSP_FIR_H

#include <cstdint>
#include <cstring>
#if defined(_MSC_VER) && (defined(_M_X64) || defined(_M_IX86))
#include <emmintrin.h>
#endif

namespace effetune::dsp {

namespace fir_detail {
#if (defined(__clang__) || defined(__GNUC__)) &&                                                   \
    (defined(__wasm_simd128__) || defined(__SSE2__) || defined(__aarch64__))
using Pair = double __attribute__((vector_size(16)));

inline Pair load(const double *samples) noexcept {
  Pair pair;
  std::memcpy(&pair, samples, sizeof(pair));
  return pair;
}

inline Pair load(const float *samples) noexcept {
  const Pair pair = {static_cast<double>(samples[0]), static_cast<double>(samples[1])};
  return pair;
}
#endif
} // namespace fir_detail

// Contiguous FIR taps, with double products and independent sums to shorten the dependency chain.
template <typename Sample>
inline double firDot(const double *coefficients, const Sample *samples,
                     std::uint32_t length) noexcept {
  std::uint32_t tap = 0u;
#if (defined(__clang__) || defined(__GNUC__)) &&                                                   \
    (defined(__wasm_simd128__) || defined(__SSE2__) || defined(__aarch64__))
  fir_detail::Pair first = {0.0, 0.0};
  fir_detail::Pair second = {0.0, 0.0};
  for (; tap + 4u <= length; tap += 4u) {
    first += fir_detail::load(coefficients + tap) * fir_detail::load(samples + tap);
    second += fir_detail::load(coefficients + tap + 2u) * fir_detail::load(samples + tap + 2u);
  }
  const auto combined = first + second;
  double sum = combined[0] + combined[1];
#else
  double first = 0.0, second = 0.0, third = 0.0, fourth = 0.0;
  for (; tap + 4u <= length; tap += 4u) {
    first += coefficients[tap] * static_cast<double>(samples[tap]);
    second += coefficients[tap + 1u] * static_cast<double>(samples[tap + 1u]);
    third += coefficients[tap + 2u] * static_cast<double>(samples[tap + 2u]);
    fourth += coefficients[tap + 3u] * static_cast<double>(samples[tap + 3u]);
  }
  double sum = (first + second) + (third + fourth);
#endif
  for (; tap < length; ++tap)
    sum += coefficients[tap] * static_cast<double>(samples[tap]);
  return sum;
}

// Float PCM and coefficients use four SIMD lanes with the same summation order on each host.
inline float firDot(const float *coefficients, const float *samples,
                    std::uint32_t length) noexcept {
  std::uint32_t tap = 0u;
  float lanes[4];
#if defined(_MSC_VER) && (defined(_M_X64) || defined(_M_IX86))
  auto first = _mm_setzero_ps(), second = _mm_setzero_ps();
  for (; tap + 8u <= length; tap += 8u) {
    first = _mm_add_ps(first,
                       _mm_mul_ps(_mm_loadu_ps(coefficients + tap), _mm_loadu_ps(samples + tap)));
    second = _mm_add_ps(second, _mm_mul_ps(_mm_loadu_ps(coefficients + tap + 4u),
                                           _mm_loadu_ps(samples + tap + 4u)));
  }
  _mm_storeu_ps(lanes, _mm_add_ps(first, second));
#elif (defined(__clang__) || defined(__GNUC__)) &&                                                 \
    (defined(__wasm_simd128__) || defined(__SSE2__) || defined(__aarch64__))
  using Quad = float __attribute__((vector_size(16)));
  Quad first = {0, 0, 0, 0}, second = {0, 0, 0, 0};
  const auto load = [](const float *source) {
    Quad values;
    std::memcpy(&values, source, sizeof(values));
    return values;
  };
  for (; tap + 8u <= length; tap += 8u) {
    first += load(coefficients + tap) * load(samples + tap);
    second += load(coefficients + tap + 4u) * load(samples + tap + 4u);
  }
  const auto combined = first + second;
  std::memcpy(lanes, &combined, sizeof(lanes));
#else
  float first[4] = {}, second[4] = {};
  for (; tap + 8u <= length; tap += 8u)
    for (auto lane = 0u; lane < 4u; ++lane) {
      first[lane] += coefficients[tap + lane] * samples[tap + lane];
      second[lane] += coefficients[tap + lane + 4u] * samples[tap + lane + 4u];
    }
  for (auto lane = 0u; lane < 4u; ++lane)
    lanes[lane] = first[lane] + second[lane];
#endif
  float sum = (lanes[0] + lanes[1]) + (lanes[2] + lanes[3]);
  for (; tap < length; ++tap)
    sum += coefficients[tap] * samples[tap];
  return sum;
}

// Symmetric FIRs need one multiplication per pair; samples and coefficients stay double precision.
template <typename Sample>
inline double firSymmetric(const double *coefficients, const Sample *samples,
                           std::uint32_t length) noexcept {
  const std::uint32_t half = length / 2u;
  std::uint32_t tap = 0u;
#if (defined(__clang__) || defined(__GNUC__)) &&                                                   \
    (defined(__wasm_simd128__) || defined(__SSE2__) || defined(__aarch64__))
  fir_detail::Pair first = {0.0, 0.0};
  fir_detail::Pair second = {0.0, 0.0};
  for (; tap + 4u <= half; tap += 4u) {
    const fir_detail::Pair reverse_first = {static_cast<double>(samples[length - 1u - tap]),
                                            static_cast<double>(samples[length - 2u - tap])};
    const fir_detail::Pair reverse_second = {static_cast<double>(samples[length - 3u - tap]),
                                             static_cast<double>(samples[length - 4u - tap])};
    first +=
        fir_detail::load(coefficients + tap) * (fir_detail::load(samples + tap) + reverse_first);
    second += fir_detail::load(coefficients + tap + 2u) *
              (fir_detail::load(samples + tap + 2u) + reverse_second);
  }
  const auto combined = first + second;
  double sum = combined[0] + combined[1];
#else
  double first = 0.0, second = 0.0, third = 0.0, fourth = 0.0;
  for (; tap + 4u <= half; tap += 4u) {
    first += coefficients[tap] *
             (static_cast<double>(samples[tap]) + static_cast<double>(samples[length - 1u - tap]));
    second += coefficients[tap + 1u] * (static_cast<double>(samples[tap + 1u]) +
                                        static_cast<double>(samples[length - 2u - tap]));
    third += coefficients[tap + 2u] * (static_cast<double>(samples[tap + 2u]) +
                                       static_cast<double>(samples[length - 3u - tap]));
    fourth += coefficients[tap + 3u] * (static_cast<double>(samples[tap + 3u]) +
                                        static_cast<double>(samples[length - 4u - tap]));
  }
  double sum = (first + second) + (third + fourth);
#endif
  for (; tap < half; ++tap)
    sum += coefficients[tap] *
           (static_cast<double>(samples[tap]) + static_cast<double>(samples[length - 1u - tap]));
  if ((length & 1u) != 0u)
    sum += coefficients[half] * static_cast<double>(samples[half]);
  return sum;
}

} // namespace effetune::dsp

#endif

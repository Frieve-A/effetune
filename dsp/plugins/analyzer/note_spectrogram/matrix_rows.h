#ifndef EFFETUNE_NOTE_SPECTROGRAM_MATRIX_ROWS_H
#define EFFETUNE_NOTE_SPECTROGRAM_MATRIX_ROWS_H
#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#elif defined(_M_X64) || defined(__SSE2__)
#include <emmintrin.h>
#endif

namespace effetune::plugins::analyzer::harmnet_detail {

// Rows remain in their original order. No horizontal reduction or fused multiply-add.
template <unsigned Rows, unsigned Columns>
inline void accumulateRows(float *output, const float *weights, const float *input) noexcept {
  static_assert(Columns % 4u == 0u);
#if defined(__wasm_simd128__)
  unsigned column = 0;
  for (; column + 16u <= Columns; column += 16u) {
    auto a = wasm_v128_load(output + column);
    auto b = wasm_v128_load(output + column + 4u);
    auto c = wasm_v128_load(output + column + 8u);
    auto d = wasm_v128_load(output + column + 12u);
    for (unsigned row = 0; row < Rows; ++row) {
      const auto x = wasm_f32x4_splat(input[row]);
      const auto *w = weights + row * Columns + column;
      a = wasm_f32x4_add(a, wasm_f32x4_mul(wasm_v128_load(w), x));
      b = wasm_f32x4_add(b, wasm_f32x4_mul(wasm_v128_load(w + 4u), x));
      c = wasm_f32x4_add(c, wasm_f32x4_mul(wasm_v128_load(w + 8u), x));
      d = wasm_f32x4_add(d, wasm_f32x4_mul(wasm_v128_load(w + 12u), x));
    }
    wasm_v128_store(output + column, a);
    wasm_v128_store(output + column + 4u, b);
    wasm_v128_store(output + column + 8u, c);
    wasm_v128_store(output + column + 12u, d);
  }
  for (; column < Columns; column += 4u) {
    auto value = wasm_v128_load(output + column);
    for (unsigned row = 0; row < Rows; ++row)
      value = wasm_f32x4_add(value, wasm_f32x4_mul(wasm_v128_load(weights + row * Columns + column),
                                                   wasm_f32x4_splat(input[row])));
    wasm_v128_store(output + column, value);
  }
#elif defined(_M_X64) || defined(__SSE2__)
  unsigned column = 0;
  for (; column + 16u <= Columns; column += 16u) {
    auto a = _mm_loadu_ps(output + column);
    auto b = _mm_loadu_ps(output + column + 4u);
    auto c = _mm_loadu_ps(output + column + 8u);
    auto d = _mm_loadu_ps(output + column + 12u);
    for (unsigned row = 0; row < Rows; ++row) {
      const auto x = _mm_set1_ps(input[row]);
      const auto *w = weights + row * Columns + column;
      a = _mm_add_ps(a, _mm_mul_ps(_mm_loadu_ps(w), x));
      b = _mm_add_ps(b, _mm_mul_ps(_mm_loadu_ps(w + 4u), x));
      c = _mm_add_ps(c, _mm_mul_ps(_mm_loadu_ps(w + 8u), x));
      d = _mm_add_ps(d, _mm_mul_ps(_mm_loadu_ps(w + 12u), x));
    }
    _mm_storeu_ps(output + column, a);
    _mm_storeu_ps(output + column + 4u, b);
    _mm_storeu_ps(output + column + 8u, c);
    _mm_storeu_ps(output + column + 12u, d);
  }
  for (; column < Columns; column += 4u) {
    auto value = _mm_loadu_ps(output + column);
    for (unsigned row = 0; row < Rows; ++row)
      value = _mm_add_ps(value, _mm_mul_ps(_mm_loadu_ps(weights + row * Columns + column),
                                           _mm_set1_ps(input[row])));
    _mm_storeu_ps(output + column, value);
  }
#else
  for (unsigned row = 0; row < Rows; ++row)
    for (unsigned column = 0; column < Columns; ++column)
      output[column] += weights[row * Columns + column] * input[row];
#endif
}

} // namespace effetune::plugins::analyzer::harmnet_detail
#endif

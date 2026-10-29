#pragma once
#include "drum_weights.h"
#include "tc_tcn.h"
#include <array>
#include <cmath>
#include <cstring>
#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#elif defined(_M_X64) || defined(__SSE2__)
#include <emmintrin.h>
#endif

namespace effetune::plugins::analyzer::drum {
// Expanded once during prepare, then shared read-only by all instances. Accumulators and
// convolution/GRU history remain float32; only the shipped weights use binary16.
struct Weights {
  std::array<float, 566669> values;
  Weights() noexcept {
    for (unsigned i = 0u; i < values.size(); ++i)
      values[i] = rhythm_a3::tcHalfToFloat(kDrumWeights[i]);
  }
  const float *tensor(unsigned index) const noexcept { return values.data() + kDrumOffsets[index]; }
};
inline const Weights &weights() noexcept {
  static const Weights value;
  return value;
}

class Inference {
public:
  void prepare() noexcept {
    static_cast<void>(weights());
    reset();
  }
  void reset() noexcept {
    first_.fill(0.0f);
    second_.fill(0.0f);
    third_.fill(0.0f);
    hidden_.fill(0.0f);
    frame_ = 0u;
  }
  void push(const float *feature, float *logits) noexcept {
    const auto &w = weights();
    const unsigned slot = frame_ % 3u;
    std::memcpy(first_.data() + slot * 128u, feature, 128u * sizeof(float));
    convolution<1u, 16u, 128u, 4u>(first_.data(), second_.data() + slot * 512u, w.tensor(0),
                                   w.tensor(1));
    convolution<16u, 32u, 32u, 4u>(second_.data(), third_.data() + slot * 256u, w.tensor(2),
                                   w.tensor(3));
    float pooled[192], flattened[192];
    convolution<32u, 48u, 8u, 2u>(third_.data(), pooled, w.tensor(4), w.tensor(5));
    // PyTorch flattens [channel, frequency], while convolution stores [frequency, channel].
    for (unsigned c = 0u; c < 48u; ++c)
      for (unsigned f = 0u; f < 4u; ++f)
        flattened[c * 4u + f] = pooled[f * 48u + c];
    gru(flattened, 192u, hidden_.data(), 6u);
    gru(hidden_.data(), 216u, hidden_.data() + 216u, 10u);
    for (unsigned c = 0u; c < 5u; ++c) {
      float value = w.tensor(15u + c * 2u)[0];
      const auto *head = w.tensor(14u + c * 2u);
      for (unsigned i = 0u; i < 216u; ++i)
        value += hidden_[216u + i] * head[i];
      logits[c] = value;
    }
    ++frame_;
  }

private:
  static void multiplyAdd(float *sums, const float *coefficients, float value,
                          unsigned count) noexcept {
    unsigned i = 0u;
#if defined(__wasm_simd128__)
    const auto x = wasm_f32x4_splat(value);
    for (; i + 4u <= count; i += 4u)
      wasm_v128_store(sums + i,
                      wasm_f32x4_add(wasm_v128_load(sums + i),
                                     wasm_f32x4_mul(x, wasm_v128_load(coefficients + i))));
#elif defined(_M_X64) || defined(__SSE2__)
    const auto x = _mm_set1_ps(value);
    for (; i + 4u <= count; i += 4u)
      _mm_storeu_ps(sums + i, _mm_add_ps(_mm_loadu_ps(sums + i),
                                         _mm_mul_ps(x, _mm_loadu_ps(coefficients + i))));
#endif
    for (; i < count; ++i)
      sums[i] += value * coefficients[i];
  }
  template <unsigned In, unsigned Out, unsigned Frequencies, unsigned Pool>
  void convolution(const float *history, float *output, const float *w,
                   const float *bias) noexcept {
    for (unsigned f = 0u; f < Frequencies; ++f) {
      float sums[Out];
      for (unsigned o = 0u; o < Out; ++o)
        sums[o] = bias[o];
      for (unsigned c = 0u; c < In; ++c)
        for (unsigned t = 0u; t < 3u; ++t) {
          const auto *row = history + ((frame_ + t + 1u) % 3u) * Frequencies * In;
          for (unsigned k = 0u; k < 3u; ++k) {
            const int frequency = static_cast<int>(f + k) - 1;
            if (frequency < 0 || frequency >= static_cast<int>(Frequencies))
              continue;
            const float value = row[static_cast<unsigned>(frequency) * In + c];
            const auto *coefficients = w + ((c * 3u + t) * 3u + k) * Out;
            // Contiguous output channels vectorize in baseline/SIMD and native builds.
            multiplyAdd(sums, coefficients, value, Out);
          }
        }
      auto *pooled = output + (f / Pool) * Out;
      for (unsigned o = 0u; o < Out; ++o) {
        const float value = sums[o] > 0.0f ? sums[o] : 0.0f;
        pooled[o] = f % Pool == 0u || value > pooled[o] ? value : pooled[o];
      }
    }
  }
  static float sigmoid(float value) noexcept { return 1.0f / (1.0f + std::exp(-value)); }
  static void dense(float *sums, const float *matrix, const float *input, unsigned rows) noexcept {
#if defined(__wasm__) && !defined(__wasm_simd128__)
    // Four ordered input rows share each accumulator load/store in scalar WASM.
    // This retains the reference addition order while reducing linear-memory traffic.
    for (unsigned i = 0u; i < rows; i += 4u) {
      const auto *w = matrix + i * 648u;
      const float a = input[i], b = input[i + 1u], c = input[i + 2u], d = input[i + 3u];
      for (unsigned o = 0u; o < 648u; ++o) {
        float value = sums[o];
        value += a * w[o];
        value += b * w[648u + o];
        value += c * w[1296u + o];
        value += d * w[1944u + o];
        sums[o] = value;
      }
    }
#else
    for (unsigned i = 0u; i < rows; ++i)
      multiplyAdd(sums, matrix + i * 648u, input[i], 648u);
#endif
  }
  static void gru(const float *input, unsigned inputs, float *hidden, unsigned base) noexcept {
    const auto &w = weights();
    const auto *iw = w.tensor(base), *hw = w.tensor(base + 1u);
    float inputGates[648], hiddenGates[648];
    std::memcpy(inputGates, w.tensor(base + 2u), sizeof(inputGates));
    std::memcpy(hiddenGates, w.tensor(base + 3u), sizeof(hiddenGates));
    dense(inputGates, iw, input, inputs);
    dense(hiddenGates, hw, hidden, 216u);
    for (unsigned i = 0u; i < 216u; ++i) {
      const float r = sigmoid(inputGates[i] + hiddenGates[i]);
      const float z = sigmoid(inputGates[216u + i] + hiddenGates[216u + i]);
      const float n = std::tanh(inputGates[432u + i] + r * hiddenGates[432u + i]);
      hidden[i] = (1.0f - z) * n + z * hidden[i];
    }
  }
  std::array<float, 384> first_{};
  std::array<float, 1536> second_{};
  std::array<float, 768> third_{};
  std::array<float, 432> hidden_{};
  unsigned frame_ = 0u;
};
} // namespace effetune::plugins::analyzer::drum

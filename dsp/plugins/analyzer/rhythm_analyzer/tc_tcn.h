// tcn_g as a causal float32 stream, one tick per push.
// h = inp((x - mu) / sd); for d = 1, 2, ..., 256: h = h + elu(conv_k5_dil_d(h)) on the zero-padded
// past; logits = out(elu(h)); softmax. Each dilated layer keeps its input's last 4 d + 1 ticks in a
// ring (zero history = torch's left zero padding). float32 accumulation in a fixed order per output
// (bias, then inputs c ascending, taps k ascending), vectorisable across outputs without
// reassociation; ELU and softmax through portable_math (double, rounded to float), so native =
// WASM.
#pragma once
#include <cstdint>

#include "portable_math.h"
#include "tc_tcn_weights.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

inline float tcElu(float x) noexcept {
  return x > 0.0f ? x : static_cast<float>(rhythm_d::portableExp(static_cast<double>(x)) - 1.0);
}

class TcTcn {
public:
  static constexpr std::uint32_t kIn = 18u, kCh = 22u, kTaps = 5u, kLayers = 9u, kOut = 3u;
  static constexpr std::uint32_t kReceptive = 1u + (kTaps - 1u) * ((1u << kLayers) - 1u); // 2045
  // Ring rows over all layers: sum of (4 d + 1).
  static constexpr std::uint32_t kRows = (kTaps - 1u) * ((1u << kLayers) - 1u) + kLayers; // 2053

  TcTcn() noexcept {
    std::uint32_t offset = 0u;
    for (std::uint32_t l = 0u; l < kLayers; ++l) {
      offset_[l] = offset;
      rows_[l] = (kTaps - 1u) * (1u << l) + 1u;
      offset += rows_[l];
    }
    reset();
  }

  void reset() noexcept {
    for (float &v : ring_)
      v = 0.0f;
    for (std::uint32_t &h : head_)
      h = 0u;
  }

  // in: the 18 base channels of one tick (float16 values as float); out: softmax (beat, off, none).
  void push(const float in[kIn], float out[kOut]) noexcept {
    float h[kCh], y[kCh];
    for (std::uint32_t o = 0u; o < kCh; ++o)
      h[o] = tc::kTcnInpB[o];
    for (std::uint32_t c = 0u; c < kIn; ++c) {
      const float x = (in[c] - tc::kTcnMu[c]) / tc::kTcnSd[c];
      const float *w = tc::kTcnInpW + c * kCh;
      for (std::uint32_t o = 0u; o < kCh; ++o)
        h[o] += w[o] * x;
    }
    for (std::uint32_t l = 0u; l < kLayers; ++l) {
      const std::uint32_t d = 1u << l, rows = rows_[l], head = head_[l];
      float *ring = ring_ + offset_[l] * kCh;
      float *slot = ring + head * kCh;
      for (std::uint32_t c = 0u; c < kCh; ++c)
        slot[c] = h[c];
      // Tap k reads the layer input at t - (4 - k) d.
      const float *tap[kTaps];
      for (std::uint32_t k = 0u; k < kTaps; ++k)
        tap[k] = ring + ((head + rows - (kTaps - 1u - k) * d) % rows) * kCh;
      for (std::uint32_t o = 0u; o < kCh; ++o)
        y[o] = tc::kTcnConvB[l * kCh + o];
      const float *w = tc::kTcnConvW + l * kCh * kTaps * kCh;
      for (std::uint32_t c = 0u; c < kCh; ++c)
        for (std::uint32_t k = 0u; k < kTaps; ++k) {
          const float x = tap[k][c];
          const float *wk = w + (c * kTaps + k) * kCh;
          for (std::uint32_t o = 0u; o < kCh; ++o)
            y[o] += wk[o] * x;
        }
      for (std::uint32_t o = 0u; o < kCh; ++o)
        h[o] += tcElu(y[o]);
      head_[l] = head + 1u == rows ? 0u : head + 1u;
    }
    float logits[kOut];
    for (std::uint32_t j = 0u; j < kOut; ++j)
      logits[j] = tc::kTcnOutB[j];
    for (std::uint32_t c = 0u; c < kCh; ++c) {
      const float x = tcElu(h[c]);
      for (std::uint32_t j = 0u; j < kOut; ++j)
        logits[j] += tc::kTcnOutW[c * kOut + j] * x;
    }
    float top = logits[0];
    for (std::uint32_t j = 1u; j < kOut; ++j)
      top = logits[j] > top ? logits[j] : top;
    double e[kOut];
    for (std::uint32_t j = 0u; j < kOut; ++j)
      e[j] = rhythm_d::portableExp(static_cast<double>(logits[j]) - static_cast<double>(top));
    const double sum = (e[0] + e[1]) + e[2];
    for (std::uint32_t j = 0u; j < kOut; ++j)
      out[j] = static_cast<float>(e[j] / sum);
  }

  static constexpr std::uint32_t stateBytes() noexcept { return kRows * kCh * sizeof(float); }

private:
  float ring_[kRows * kCh];
  std::uint32_t head_[kLayers];
  std::uint32_t offset_[kLayers], rows_[kLayers];
};

} // namespace effetune::plugins::analyzer::rhythm_a3

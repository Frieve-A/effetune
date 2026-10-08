// Frozen T48M as a causal stream, one tick per push.
// h = inp((x - mu) / sd); for d = 1, 2, ..., 256: h = h + elu(conv_k5_dil_d(h)) on the zero-padded
// past; logits = out(elu(h)); softmax. Parameters are IEEE binary16 codes; each dilated layer keeps
// the binary16 value (nearest even) of its input's last 4 d + 1 ticks in a ring (zero history =
// torch's left zero padding) and its taps read the ring, while the residual h stays float32.
// float32 accumulation in a fixed order per output (bias, then inputs c ascending, taps k
// ascending), vectorisable across outputs without reassociation; binary16 <-> float32 conversions
// are exact and independent of subnormal flushing, ELU and softmax go through portable_math
// (double, rounded to float), so native = WASM.
#pragma once
#include <bit>
#include <cstdint>

#include "portable_math.h"
#include "tc_tcn_weights.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

inline float tcElu(float x) noexcept {
  return x > 0.0f ? x : static_cast<float>(rhythm_d::portableExp(static_cast<double>(x)) - 1.0);
}

// binary16 code -> float, exact for every finite code. Normal codes: exponent and mantissa moved
// into float's fields and the exponent rebiased (+112); zero and subnormal codes: mantissa * 2^-24.
// Every intermediate is a normal float or zero, so hosts that flush subnormals (DAZ/FTZ) get the
// same values; the select is branch-free, so the weight loops vectorise across outputs.
inline float tcHalfToFloat(std::uint16_t h) noexcept {
  const std::uint32_t sign = static_cast<std::uint32_t>(h & 0x8000u) << 16;
  if ((h & 0x7c00u) == 0x7c00u)
    return std::bit_cast<float>(sign | 0x7f800000u |
                                (static_cast<std::uint32_t>(h & 0x3ffu) << 13));
  const std::uint32_t normal = (static_cast<std::uint32_t>(h & 0x7fffu) << 13) + (112u << 23);
  const float small = static_cast<float>(static_cast<std::int32_t>(h & 0x3ffu)) * 0x1p-24f;
  return std::bit_cast<float>(sign |
                              ((h & 0x7c00u) != 0u ? normal : std::bit_cast<std::uint32_t>(small)));
}

// Float -> binary16, round to nearest even using integer arithmetic.
inline std::uint16_t tcFloatToHalf(float x) noexcept {
  const std::uint32_t bits = std::bit_cast<std::uint32_t>(x);
  const std::uint32_t sign = (bits >> 16) & 0x8000u, a = bits & 0x7fffffffu;
  if (a >= 0x477ff000u)
    return static_cast<std::uint16_t>(sign | 0x7c00u);
  if (a >= 0x38800000u) // normal: rebias, drop 13 mantissa bits, ties to even
    return static_cast<std::uint16_t>(sign | ((a - 0x38000000u + 0xfffu + ((a >> 13) & 1u)) >> 13));
  if (a <= 0x33000000u) // |x| <= 2^-25
    return static_cast<std::uint16_t>(sign);
  // Subnormal: units of 2^-24.
  const std::uint32_t shift = 126u - (a >> 23), m = (a & 0x7fffffu) | 0x800000u;
  const std::uint32_t q = m >> shift, rest = m & ((1u << shift) - 1u), half = 1u << (shift - 1u);
  return static_cast<std::uint16_t>(sign | (q + (rest > half || (rest == half && (q & 1u)))));
}

class TcTcn {
public:
  static constexpr std::uint32_t kIn = 500u, kCh = 48u, kTaps = 5u, kLayers = 9u, kOut = 63u;
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
    for (std::uint16_t &v : ring_)
      v = 0u;
    for (std::uint32_t &h : head_)
      h = 0u;
  }

  // Full-precision features; beat/downbeat sigmoid followed by 61 binary16 tempo probabilities.
  void push(const float in[kIn], float out[kOut]) noexcept {
    float h[kCh], y[kCh];
    for (std::uint32_t o = 0u; o < kCh; ++o)
      h[o] = tcHalfToFloat(tc::kTcnInpB[o]);
    for (std::uint32_t c = 0u; c < kIn; ++c) {
      const float x = (in[c] - tc::kTcnMu[c]) / tc::kTcnSd[c];
      const std::uint16_t *w = tc::kTcnInpW + c * kCh;
      for (std::uint32_t o = 0u; o < kCh; ++o)
        h[o] += tcHalfToFloat(w[o]) * x;
    }
    for (std::uint32_t l = 0u; l < kLayers; ++l) {
      const std::uint32_t d = 1u << l, rows = rows_[l], head = head_[l];
      std::uint16_t *ring = ring_ + offset_[l] * kCh;
      std::uint16_t *slot = ring + head * kCh;
      for (std::uint32_t c = 0u; c < kCh; ++c)
        slot[c] = tcFloatToHalf(h[c]);
      // Tap k reads the layer input at t - (4 - k) d.
      const std::uint16_t *tap[kTaps];
      for (std::uint32_t k = 0u; k < kTaps; ++k)
        tap[k] = ring + ((head + rows - (kTaps - 1u - k) * d) % rows) * kCh;
      for (std::uint32_t o = 0u; o < kCh; ++o)
        y[o] = tcHalfToFloat(tc::kTcnConvB[l * kCh + o]);
      const std::uint16_t *w = tc::kTcnConvW + l * kCh * kTaps * kCh;
      for (std::uint32_t c = 0u; c < kCh; ++c)
        for (std::uint32_t k = 0u; k < kTaps; ++k) {
          const float x = tcHalfToFloat(tap[k][c]);
          const std::uint16_t *wk = w + (c * kTaps + k) * kCh;
          for (std::uint32_t o = 0u; o < kCh; ++o)
            y[o] += tcHalfToFloat(wk[o]) * x;
        }
      for (std::uint32_t o = 0u; o < kCh; ++o)
        h[o] += tcElu(y[o]);
      head_[l] = head + 1u == rows ? 0u : head + 1u;
    }
    float logits[kOut];
    for (std::uint32_t j = 0u; j < kOut; ++j)
      logits[j] = tcHalfToFloat(tc::kTcnOutB[j]);
    for (std::uint32_t c = 0u; c < kCh; ++c) {
      const float x = tcElu(h[c]);
      for (std::uint32_t j = 0u; j < kOut; ++j)
        logits[j] += tcHalfToFloat(tc::kTcnOutW[c * kOut + j]) * x;
    }
    for (std::uint32_t j = 0u; j < 2u; ++j)
      out[j] =
          static_cast<float>(1.0 / (1.0 + rhythm_d::portableExp(-static_cast<double>(logits[j]))));
    float top = logits[2];
    for (std::uint32_t j = 3u; j < kOut; ++j)
      top = logits[j] > top ? logits[j] : top;
    double e[kOut];
    double sum = 0.0;
    for (std::uint32_t j = 2u; j < kOut; ++j) {
      e[j] = rhythm_d::portableExp(static_cast<double>(logits[j]) - static_cast<double>(top));
      sum += e[j];
    }
    for (std::uint32_t j = 2u; j < kOut; ++j)
      out[j] = tcHalfToFloat(tcFloatToHalf(static_cast<float>(e[j] / sum)));
  }

  static constexpr std::uint32_t stateBytes() noexcept {
    return kRows * kCh * sizeof(std::uint16_t);
  }
  const std::uint16_t *ring() const noexcept { return ring_; }

private:
  std::uint16_t ring_[kRows * kCh];
  std::uint32_t head_[kLayers];
  std::uint32_t offset_[kLayers], rows_[kLayers];
};

} // namespace effetune::plugins::analyzer::rhythm_a3

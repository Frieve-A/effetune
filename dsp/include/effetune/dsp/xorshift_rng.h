#ifndef EFFETUNE_DSP_XORSHIFT_RNG_H
#define EFFETUNE_DSP_XORSHIFT_RNG_H

#include <cstdint>

namespace effetune::dsp {

class XorShiftRng final {
public:
  static constexpr std::uint64_t kFallbackSeed = 0x00000000effe7a5eULL;

  explicit constexpr XorShiftRng(std::uint64_t seed = kFallbackSeed) noexcept
      : state_(seed == 0ULL ? kFallbackSeed : seed) {}

  constexpr XorShiftRng(std::uint32_t seed_low, std::uint32_t seed_high) noexcept
      : XorShiftRng((static_cast<std::uint64_t>(seed_high) << 32U) | seed_low) {}

  constexpr void seed(std::uint64_t value) noexcept {
    state_ = value == 0ULL ? kFallbackSeed : value;
  }

  constexpr void seed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept {
    seed((static_cast<std::uint64_t>(seed_high) << 32U) | seed_low);
  }

  // One generator step. The map is linear over GF(2), so steps of an XOR of states are the XOR
  // of the stepped states.
  [[nodiscard]] static constexpr std::uint64_t step(std::uint64_t value) noexcept {
    value ^= value << 13U;
    value ^= value >> 7U;
    value ^= value << 17U;
    return value;
  }

  [[nodiscard]] static double toFloat01(std::uint64_t value) noexcept {
    constexpr double scale = 1.0 / 9007199254740992.0;
    return static_cast<double>(value >> 11U) * scale;
  }

  [[nodiscard]] static double toFloatSigned(std::uint64_t value) noexcept {
    return toFloat01(value) * 2.0 - 1.0;
  }

  [[nodiscard]] constexpr std::uint64_t nextU64() noexcept {
    state_ = step(state_);
    return state_;
  }

  [[nodiscard]] double nextFloat01() noexcept { return toFloat01(nextU64()); }

  [[nodiscard]] double nextFloatSigned() noexcept { return toFloatSigned(nextU64()); }
  [[nodiscard]] constexpr std::uint64_t state() const noexcept { return state_; }

private:
  std::uint64_t state_;
};

} // namespace effetune::dsp

#endif

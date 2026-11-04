#ifndef EFFETUNE_SFZ_NOISE_H
#define EFFETUNE_SFZ_NOISE_H
#include "effetune/dsp/xorshift_rng.h"
#include "filters.h"
#include <array>
#include <span>
#include <type_traits>

namespace effetune::plugins::others::sfz {
// Seeded held noise shared by the per-voice noise layer and the static bus FX.
// The explicit profile maps tone 0..1 exponentially to 20 Hz..20 kHz; step is
// the number of extra samples for which the same random value is held.
struct NoiseLayer {
  dsp::XorShiftRng random;
  VoiceFilter filter;
  std::array<float, 2> held{};
  unsigned remaining = 0;
  void reset(std::uint64_t seed) noexcept {
    random.seed(seed);
    filter.reset();
    held = {};
    remaining = 0;
  }
  bool process(float &left, float &right, float rate, float gain, float tone, unsigned step,
               bool stereo, unsigned filterType, std::span<float> comb = {},
               CombJournal *journal = nullptr) noexcept {
    if (!remaining) {
      held[0] = static_cast<float>(random.nextFloatSigned());
      held[1] = static_cast<float>(random.nextFloatSigned());
      remaining = step + 1;
    }
    --remaining;
    float a = held[0], b = stereo ? held[1] : held[0];
    filter.configure(filterType, 20 * std::pow(1000.0F, tone), 0, 0, rate);
    if (!filter.process(a, b, comb, journal))
      return false;
    left += a * gain;
    right += b * gain;
    return true;
  }
};
static_assert(std::is_trivially_copyable_v<NoiseLayer>);
} // namespace effetune::plugins::others::sfz
#endif

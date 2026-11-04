#ifndef EFFETUNE_SFZ_OSCILLATOR_H
#define EFFETUNE_SFZ_OSCILLATOR_H
#include "effetune/dsp/xorshift_rng.h"
#include "sfz_lfo.h"
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>

namespace effetune::plugins::others::sfz::oscillator {
struct Stereo {
  float left = 0, right = 0;
};
struct Settings {
  std::uint32_t wave = 0, mode = 0, multi = 1, quality = 2;
  float detuneCents = 0, phaseDegrees = 0, modDepth = 100;
};
struct State {
  std::array<double, 9> phase{};
  std::array<dsp::XorShiftRng, 9> random;
};
static_assert(sizeof(State) == 144);
inline constexpr std::array<double, 9> kDetune = {0, -1, 1, -.25, .25, -.5, .5, -.75, .75};
inline double wrap(double phase) noexcept { return phase - std::floor(phase); }
inline void reset(State &state, const Settings &settings, std::uint64_t seed) noexcept {
  dsp::XorShiftRng seeds(seed);
  for (std::size_t i = 0; i < state.phase.size(); ++i) {
    state.random[i].seed(seeds.nextU64());
    state.phase[i] = settings.phaseDegrees < 0 ? state.random[i].nextFloat01()
                                               : wrap(settings.phaseDegrees / 360.0);
  }
}
inline double detunedIncrement(double increment, double cents) noexcept {
  const double exponent = cents / 1200;
  const double ratio = std::exp2(exponent < -1022 ? -1022 : exponent > 1022 ? 1022 : exponent);
  const double result = increment * ratio;
  return std::isfinite(result) ? result : std::numeric_limits<double>::max();
}
// readWave reads one prepared cycle, wrapping its own sample addresses. The
// caller supplies nearest/linear or existing band-limited FIR interpolation.
// Its increment is cycles per host frame, independent of the source file rate.
template <class ReadWave>
inline Stereo tick(State &state, const Settings &settings, double frequency, double sampleRate,
                   ReadWave readWave) noexcept {
  if (!(sampleRate > 0) || !std::isfinite(frequency))
    return {};
  const double base = frequency / sampleRate;
  const auto read = [&](std::uint32_t index, double phase, double increment) -> Stereo {
    if (settings.wave == 6)
      return {};
    if (settings.wave == 5) {
      const auto noise = static_cast<float>(state.random[index].nextFloatSigned());
      return {noise, noise};
    }
    return readWave(wrap(phase), increment, settings.quality);
  };
  const auto advance = [&](std::uint32_t index, double increment) {
    state.phase[index] = wrap(state.phase[index] + std::fmod(increment, 1.0));
  };
  if (settings.mode != 0 || settings.multi == 2) {
    const double modIncrement = detunedIncrement(base, settings.detuneCents);
    const Stereo modulator = read(1, state.phase[1], modIncrement);
    const double mod = (static_cast<double>(modulator.left) + modulator.right) * .5;
    const double depth = settings.modDepth * .01;
    const double increment = settings.mode == 2 ? base + modIncrement * depth * mod : base;
    if (!std::isfinite(increment))
      return {};
    const double phase =
        state.phase[0] + (settings.mode == 1 ? depth * mod / 6.2831853071795864769 : 0);
    Stereo output = read(0, phase, increment);
    if (settings.mode == 0) {
      output.left =
          modulation::finiteModulationValue(output.left * (1 - depth + depth * modulator.left));
      output.right =
          modulation::finiteModulationValue(output.right * (1 - depth + depth * modulator.right));
    }
    advance(0, increment);
    advance(1, modIncrement);
    return output;
  }
  Stereo output;
  const auto count = settings.multi < 1 ? 1u : settings.multi > 9 ? 9u : settings.multi;
  for (std::uint32_t i = 0; i < count; ++i) {
    const double increment = detunedIncrement(base, settings.detuneCents * kDetune[i]);
    const Stereo value = read(i, state.phase[i], increment);
    const double left = count == 1 ? 1 : static_cast<double>(i) / (count - 1);
    const double right = count == 1 ? 1 : 1 - left;
    output.left = modulation::finiteModulationValue(output.left + value.left * left);
    output.right = modulation::finiteModulationValue(output.right + value.right * right);
    advance(i, increment);
  }
  return output;
}
} // namespace effetune::plugins::others::sfz::oscillator
#endif

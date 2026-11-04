#ifndef EFFETUNE_SFZ_CYCLE_READER_H
#define EFFETUNE_SFZ_CYCLE_READER_H
#include "effetune/dsp/fir.h"
#include "sfz_oscillator.h"
#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::others::sfz::oscillator {
// Window returns one cyclic, contiguous channel window at the selected packed
// level. Coefficient borrows the sampler's existing Blackman-sinc lookup.
template <class Window, class Coefficient>
Stereo readCycle(std::uint32_t frames, std::uint32_t channels, double phase, double increment,
                 std::uint32_t quality, Window window, Coefficient coefficient) noexcept {
  if (!frames || !std::isfinite(phase) || !std::isfinite(increment))
    return {};
  phase = wrap(phase);
  const double speed = std::abs(increment);
  std::uint64_t offset = 0;
  auto count = frames;
  std::uint32_t previous = 0;
  if (quality >= 2 || speed >= .5) {
    while (count > 1 && (speed >= .5 || speed * count > 8)) {
      offset += count;
      previous = count;
      count = count / 2 + count % 2;
    }
  }
  const auto level = [&](std::uint64_t start, std::uint32_t length, std::uint32_t channel) {
    std::array<float, 514> samples, weights;
    const double position = phase * length;
    if (length == 1 || quality == 0) {
      const auto index = static_cast<std::int64_t>(std::floor(position + .5));
      return window(start, length, index, 1, channel, samples.data())[0];
    }
    const auto integer = static_cast<std::int64_t>(position);
    if (quality == 1) {
      const auto *values = window(start, length, integer, 2, channel, samples.data());
      return static_cast<float>(values[0] + (position - integer) * (values[1] - values[0]));
    }
    const double step = speed * length > 1 ? speed * length : 1;
    const auto radius = static_cast<std::uint32_t>(std::ceil(32 * step));
    const auto taps = 2 * radius + 2;
    const auto *values = window(start, length, integer - radius, taps, channel, samples.data());
    const auto filtered = [&](double fraction) {
      double sum = 0;
      for (auto tap = 0u; tap < taps; ++tap) {
        weights[tap] = coefficient((static_cast<double>(tap) - radius - fraction) / step);
        sum += weights[tap];
      }
      return static_cast<float>(dsp::firDot(weights.data(), values, taps) / sum);
    };
    const double fraction = position - integer;
    const double at = fraction * 64;
    if (quality == 2)
      return filtered(std::floor(at + .5) / 64);
    const double first = std::floor(at);
    const float a = filtered(first / 64);
    const float b = filtered((first + 1) / 64);
    return static_cast<float>(a + (at - first) * (b - a));
  };
  const double step = speed * count;
  // Odd-sized levels use their exact preceding boundary rather than assuming
  // every decimation halves the length. Both sides then meet at blend zero.
  const double begin = previous ? 8.0 * count / previous : 4;
  const double blend = quality >= 2 && count > 1 && step > begin ? (step - begin) / (8 - begin) : 0;
  const auto channel = [&](std::uint32_t index) {
    const float fine = level(offset, count, index);
    if (blend <= 0)
      return fine;
    const float coarse = level(offset + count, count / 2 + count % 2, index);
    return static_cast<float>(fine + blend * (coarse - fine));
  };
  const float left = channel(0);
  return {left, channels == 1 ? left : channel(1)};
}
} // namespace effetune::plugins::others::sfz::oscillator
#endif

#ifndef EFFETUNE_SFZ_RESAMPLING_H
#define EFFETUNE_SFZ_RESAMPLING_H
#include <cmath>
#include <cstdint>
#include <span>

namespace effetune::plugins::others::sfz {
// Shared with the sampler's existing 64-tap, 0.9-Nyquist Blackman kernel.
inline double sincKernel(double distance, double radius) noexcept {
  constexpr double pi = 3.14159265358979323846;
  const auto window =
      .42 + .5 * std::cos(pi * distance / radius) + .08 * std::cos(2.0 * pi * distance / radius);
  return distance >= radius ? 0.0
         : distance == 0.0  ? .9
                            : std::sin(.9 * pi * distance) / (pi * distance) * window;
}

inline std::uint32_t effectImpulseFrames(std::uint32_t frames, double sourceRate,
                                         double hostRate) noexcept {
  if (!frames || !std::isfinite(sourceRate) || !std::isfinite(hostRate) || sourceRate < 1 ||
      hostRate < 1 || sourceRate > 768000 || hostRate > 768000)
    return 0;
  const auto count = std::round(static_cast<double>(frames) * hostRate / sourceRate);
  return count > UINT32_MAX ? 0 : static_cast<std::uint32_t>(count < 1 ? 1 : count);
}

// CONTROL only. The caller owns and budgets the exact planar destination.
// Outside-file taps are zero; normalization uses the complete kernel, avoiding
// an artificial gain increase near either edge. The rate ratio preserves IR
// area (and thus convolution DC gain), rather than audio-playback amplitude.
inline bool prepareEffectImpulse(std::span<const float> interleaved, std::uint32_t channels,
                                 double sourceRate, double hostRate,
                                 std::span<float> planar) noexcept {
  if ((channels != 1 && channels != 2) || interleaved.size() % channels ||
      interleaved.size() / channels > UINT32_MAX)
    return false;
  const auto sourceFrames = static_cast<std::uint32_t>(interleaved.size() / channels);
  const auto outputFrames = effectImpulseFrames(sourceFrames, sourceRate, hostRate);
  if (!outputFrames || planar.size() != static_cast<std::uint64_t>(outputFrames) * channels)
    return false;
  for (const auto value : interleaved)
    if (!std::isfinite(value))
      return false;
  const double ratio = sourceRate / hostRate;
  const double scale = ratio > 1 ? 1 / ratio : 1;
  const double radius = 32 / scale;
  for (auto frame = 0u; frame < outputFrames; ++frame) {
    if (sourceRate == hostRate) {
      for (auto channel = 0u; channel < channels; ++channel)
        planar[static_cast<std::size_t>(channel) * outputFrames + frame] =
            interleaved[static_cast<std::size_t>(frame) * channels + channel];
      continue;
    }
    const double position = frame * ratio;
    const auto first = static_cast<std::int64_t>(std::ceil(position - radius));
    const auto last = static_cast<std::int64_t>(std::floor(position + radius));
    double sum = 0, values[2]{};
    for (auto tap = first; tap <= last; ++tap) {
      const double weight = sincKernel(std::abs(tap - position) * scale, 32);
      sum += weight;
      if (tap >= 0 && static_cast<std::uint64_t>(tap) < sourceFrames)
        for (auto channel = 0u; channel < channels; ++channel)
          values[channel] +=
              weight * interleaved[static_cast<std::size_t>(tap) * channels + channel];
    }
    if (!std::isfinite(sum) || sum <= 0)
      return false;
    for (auto channel = 0u; channel < channels; ++channel)
      planar[static_cast<std::size_t>(channel) * outputFrames + frame] =
          static_cast<float>(values[channel] / sum * ratio);
  }
  return true;
}
} // namespace effetune::plugins::others::sfz
#endif

#ifndef EFFETUNE_SFZ_SAMPLE_RESAMPLING_H
#define EFFETUNE_SFZ_SAMPLE_RESAMPLING_H
#include "nothrow_storage.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::others::sfz {
// All coefficients are prepared in CONTROL. Ordinary ratios use polyphase
// rows; larger ratios read the same immutable prototype without making tables.
class SampleResamplingTables {
public:
  static constexpr std::uint32_t kPhases = 64, kBandsPerOctave = 32, kRows = 65;
  static constexpr std::uint32_t kResolution = 512, kInvalid = UINT32_MAX;
  static constexpr std::array<std::uint32_t, 9> kRadii{31, 15, 4, 8, 12, 16, 20, 24, 28};
  struct Kernel {
    double step = 1;
    std::uint32_t radius = 0, taps = 0, offset = 0, profile = 0;
  };
  bool prepare() noexcept {
    constexpr double pi = 3.14159265358979323846;
    guard_ = std::exp2(1.0 / kBandsPerOctave);
    std::size_t prototypeCount = 0, coefficientCount = 0;
    for (auto profile = 0u; profile < kRadii.size(); ++profile) {
      prototype_offsets_[profile] = static_cast<std::uint32_t>(prototypeCount);
      prototypeCount += kRadii[profile] * kResolution + 2u;
      for (auto row = 0u; row < kRows; ++row) {
        auto &kernel = kernels_[profile * kRows + row];
        kernel.step = std::exp2(static_cast<double>(row) / kBandsPerOctave);
        kernel.radius = static_cast<std::uint32_t>(std::ceil(kRadii[profile] * kernel.step));
        kernel.taps = 2u * kernel.radius + 2u;
        kernel.offset = static_cast<std::uint32_t>(coefficientCount);
        kernel.profile = profile;
        coefficientCount += (kPhases + 1u) * kernel.taps;
      }
    }
    if (!prototypes_.allocate(prototypeCount) || !coefficients_.allocate(coefficientCount))
      return false;
    for (auto profile = 0u; profile < kRadii.size(); ++profile) {
      const auto radius = kRadii[profile];
      auto *prototype = prototypes_.data() + prototype_offsets_[profile];
      for (auto index = 0u; index < radius * kResolution + 2u; ++index) {
        const auto distance = static_cast<double>(index) / kResolution;
        const auto window = .42 + .5 * std::cos(pi * distance / radius) +
                            .08 * std::cos(2 * pi * distance / radius);
        prototype[index] = static_cast<float>(
            distance >= radius ? 0
            : distance == 0    ? .9 / guard_
                               : std::sin(.9 / guard_ * pi * distance) / (pi * distance) * window);
      }
      for (auto row = 0u; row < kRows; ++row) {
        const auto &kernel = kernels_[profile * kRows + row];
        for (auto phase = 0u; phase <= kPhases; ++phase) {
          auto *values = coefficients_.data() + kernel.offset + phase * kernel.taps;
          double weight = 0;
          for (auto tap = 0u; tap < kernel.taps; ++tap) {
            values[tap] = coefficient(profile, (static_cast<double>(tap) - kernel.radius -
                                                static_cast<double>(phase) / kPhases) /
                                                   kernel.step);
            weight += values[tap];
          }
          for (auto tap = 0u; tap < kernel.taps; ++tap)
            values[tap] = static_cast<float>(values[tap] / weight);
        }
      }
    }
    return true;
  }
  std::uint32_t select(std::uint32_t profile, double step) const noexcept {
    if (profile >= kRadii.size() || !std::isfinite(step) || step > 4)
      return kInvalid;
    const auto first = profile * kRows;
    auto low = 0u, high = kRows - 1u;
    while (low < high) {
      const auto middle = low + (high - low) / 2u;
      if (kernels_[first + middle].step < step)
        low = middle + 1u;
      else
        high = middle;
    }
    return first + low;
  }
  const Kernel &kernel(std::uint32_t index) const noexcept { return kernels_[index]; }
  const float *coefficients(std::uint32_t index) const noexcept {
    return coefficients_.data() + kernels_[index].offset;
  }
  bool safe(std::uint32_t index, double step) const noexcept {
    return index < kernels_.size() && step <= kernels_[index].step * guard_;
  }
  bool contains(std::uint32_t index, std::uint32_t profile, double step) const noexcept {
    if (index >= kernels_.size() || kernels_[index].profile != profile ||
        step > kernels_[index].step)
      return false;
    return index % kRows == 0u || step > kernels_[index - 1u].step;
  }
  double maximumBankStep(double step) const noexcept {
    return step <= 4 ? (step > 1 ? step : 1) * guard_ : step;
  }
  float coefficient(std::uint32_t profile, double distance) const noexcept {
    const auto magnitude = distance < 0 ? -distance : distance;
    if (magnitude >= kRadii[profile])
      return 0;
    const auto at = magnitude * kResolution;
    const auto index = static_cast<std::uint32_t>(at);
    const auto fraction = static_cast<float>(at - index);
    const auto *values = prototypes_.data() + prototype_offsets_[profile];
    return values[index] + fraction * (values[index + 1u] - values[index]);
  }
  std::size_t storageBytes() const noexcept {
    return (prototypes_.size() + coefficients_.size()) * sizeof(float);
  }

private:
  std::array<Kernel, kRadii.size() * kRows> kernels_{};
  std::array<std::uint32_t, kRadii.size()> prototype_offsets_{};
  NothrowStorage<float> prototypes_, coefficients_;
  double guard_ = 1;
};
} // namespace effetune::plugins::others::sfz
#endif

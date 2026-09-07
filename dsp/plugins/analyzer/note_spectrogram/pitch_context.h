#ifndef EFFETUNE_NOTE_SPECTROGRAM_PITCH_CONTEXT_H
#define EFFETUNE_NOTE_SPECTROGRAM_PITCH_CONTEXT_H

#include "learned_features.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::analyzer {

class PitchContextFeatures final {
public:
  static constexpr std::uint32_t kSchemaVersion = 8u;
  static constexpr std::uint32_t kPitchCount = LearnedPitchFeatures::kPitchCount;
  static constexpr std::uint32_t kBaseFeatureCount = LearnedPitchFeatures::kFeatureCount;
  static constexpr std::array<int, 10> kOffsets = {-24, -19, -12, -2, -1, 1, 2, 12, 19, 24};
  static constexpr std::array<std::uint32_t, 4> kEvidence = {0u, 8u, 16u, 22u};
  static constexpr std::uint32_t kFeatureCount = kBaseFeatureCount + 3u + 40u;
  using BaseFrame = std::array<std::array<float, kBaseFeatureCount>, kPitchCount>;
  using Frame = std::array<std::array<float, kFeatureCount>, kPitchCount>;

  PitchContextFeatures() {
    for (std::uint32_t pitch = 0; pitch < kPitchCount; ++pitch) {
      const double midi = LearnedPitchFeatures::kFirstMidi + pitch;
      const double hz = 440.0 * std::exp2((midi - 69.0) / 12.0);
      // Fixed reference coordinates describe pitch, independently of the host rate.
      geometry_[pitch] = {static_cast<float>(hz / (44100.0 / 4096.0)),
                          static_cast<float>(44100.0 / hz / 2048.0),
                          static_cast<float>(std::min(3.0, std::floor(2048.0 * hz / 44100.0)))};
    }
  }

  void update(const BaseFrame &base, std::uint32_t begin, std::uint32_t end) noexcept {
    end = std::min(end, kPitchCount);
    for (auto pitch = begin; pitch < end; ++pitch) {
      auto &row = values_[pitch];
      std::copy(base[pitch].begin(), base[pitch].end(), row.begin());
      std::copy(geometry_[pitch].begin(), geometry_[pitch].end(), row.begin() + kBaseFeatureCount);
      auto index = kBaseFeatureCount + 3u;
      for (const auto offset : kOffsets) {
        const int neighbor = static_cast<int>(pitch) + offset;
        for (const auto feature : kEvidence)
          row[index++] = neighbor >= 0 && neighbor < static_cast<int>(kPitchCount)
                             ? base[static_cast<std::uint32_t>(neighbor)][feature]
                             : 0.0F;
      }
    }
  }

  void clear() noexcept {
    for (auto &row : values_)
      row.fill(0.0F);
  }
  const Frame &values() const noexcept { return values_; }

private:
  std::array<std::array<float, 3>, kPitchCount> geometry_{};
  Frame values_{};
};

} // namespace effetune::plugins::analyzer
#endif

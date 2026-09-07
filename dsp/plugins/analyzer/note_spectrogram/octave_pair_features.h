#ifndef EFFETUNE_NOTE_SPECTROGRAM_OCTAVE_PAIR_FEATURES_H
#define EFFETUNE_NOTE_SPECTROGRAM_OCTAVE_PAIR_FEATURES_H

#include "learned_features.h"

namespace effetune::plugins::analyzer {
// A shared classifier sees both members of each C1/B1-to-C2/B2 octave pair.
class OctavePairFeatures final {
public:
  static constexpr std::uint32_t kSchemaVersion = 1u;
  static constexpr std::uint32_t kPairCount = 12u;
  static constexpr std::uint32_t kFeatureCount = 212u;
  using BaseFrame = std::array<std::array<float, LearnedPitchFeatures::kFeatureCount>,
                               LearnedPitchFeatures::kPitchCount>;
  using Frame = std::array<std::array<float, kFeatureCount>, kPairCount>;
  void update(const BaseFrame &short_frame, const BaseFrame &long_frame, std::uint32_t begin,
              std::uint32_t end) noexcept {
    for (auto pair = begin; pair < end; ++pair) {
      auto &row = values_[pair];
      auto column = 0u;
      for (auto offset : {0u, 12u}) {
        const auto pitch = 3u + pair + offset;
        for (const auto *frame : {&short_frame, &long_frame})
          for (auto value : (*frame)[pitch])
            row[column++] = value;
        for (const auto *frame : {&short_frame, &long_frame}) {
          const auto &base = (*frame)[pitch];
          row[column++] = base[0] - base[1];
          row[column++] = base[2] - base[1];
          row[column++] = base[4] - base[3];
          row[column++] = base[6] - base[5];
        }
        for (auto neighbor : {pitch - 1u, pitch + 1u})
          for (auto feature : {0u, 8u, 16u, 22u})
            row[column++] = long_frame[neighbor][feature];
      }
    }
  }
  const Frame &values() const noexcept { return values_; }

private:
  Frame values_{};
};
} // namespace effetune::plugins::analyzer
#endif

#ifndef EFFETUNE_NOTE_SPECTROGRAM_MULTIRES_FEATURES_H
#define EFFETUNE_NOTE_SPECTROGRAM_MULTIRES_FEATURES_H

#include "pitch_context.h"

namespace effetune::plugins::analyzer {
class MultiresolutionFeatures final {
public:
  static constexpr std::uint32_t kSchemaVersion = 9u;
  static constexpr std::uint32_t kPitchCount = PitchContextFeatures::kPitchCount;
  static constexpr std::uint32_t kFeatureCount =
      PitchContextFeatures::kFeatureCount + LearnedPitchFeatures::kFeatureCount;
  using BaseFrame = PitchContextFeatures::BaseFrame;
  using Frame = std::array<std::array<float, kFeatureCount>, kPitchCount>;
  void update(const BaseFrame &short_frame, const BaseFrame &long_frame, std::uint32_t begin,
              std::uint32_t end) noexcept {
    context_.update(short_frame, begin, end);
    end = std::min(end, kPitchCount);
    for (auto pitch = begin; pitch < end; ++pitch) {
      const auto &context = context_.values()[pitch];
      std::copy(context.begin(), context.end(), values_[pitch].begin());
      std::copy(long_frame[pitch].begin(), long_frame[pitch].end(),
                values_[pitch].begin() + PitchContextFeatures::kFeatureCount);
    }
  }
  void clear() noexcept {
    context_.clear();
    for (auto &row : values_)
      row.fill(0.0F);
  }
  const Frame &values() const noexcept { return values_; }

private:
  PitchContextFeatures context_;
  Frame values_{};
};
} // namespace effetune::plugins::analyzer
#endif

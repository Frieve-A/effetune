#ifndef EFFETUNE_ANDROID_PCM_RESAMPLER_H
#define EFFETUNE_ANDROID_PCM_RESAMPLER_H

#include "vendor/oboe-resampler/MultiChannelResampler.h"
#include <cstdint>
#include <memory>
#include <vector>

namespace effetune::android {
class PcmResampler {
public:
  PcmResampler(int inputRate, int outputRate, int channels = 2);
  int channels() const { return channels_; }
  float *wideScratch() { return scratch_.data(); }
  std::vector<float> process(const float *pcm, std::uint32_t frames, bool end);

private:
  std::unique_ptr<oboe::resampler::MultiChannelResampler> resampler_;
  int inputRate_, outputRate_, channels_;
  std::vector<float> scratch_;
  std::uint64_t inputFrames_ = 0, outputFrames_ = 0, discarded_ = 0;
  std::uint64_t delayFrames_ = 0;
  bool ended_ = false;
};
} // namespace effetune::android
#endif

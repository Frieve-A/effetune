#include "pcm_resampler.h"
#include <cmath>
#include <stdexcept>

namespace effetune::android {
PcmResampler::PcmResampler(int inputRate, int outputRate)
    : inputRate_(inputRate), outputRate_(outputRate) {
  // Includes supported source rates after the player's 0.25x..4x speed scaling.
  if (inputRate < 1000 || inputRate > 1536000 || outputRate < 8000 || outputRate > 192000)
    throw std::invalid_argument("Unsupported resampling rates");
  if (inputRate != outputRate) {
    using Resampler = oboe::resampler::MultiChannelResampler;
    resampler_.reset(Resampler::make(2, inputRate, outputRate, Resampler::Quality::Best));
    delayFrames_ =
        (static_cast<std::uint64_t>(resampler_->getNumTaps() / 2) * outputRate + inputRate - 1) /
        inputRate;
  }
}

std::vector<float> PcmResampler::process(const float *stereo, std::uint32_t frames, bool end) {
  if (frames > 1024 || (frames && !stereo) || ended_)
    throw std::invalid_argument("Invalid resampling block");
  for (std::uint32_t i = 0; i < frames * 2; ++i)
    if (!std::isfinite(stereo[i]))
      throw std::invalid_argument("Invalid PCM sample");
  inputFrames_ += frames;
  ended_ = end;
  if (!resampler_)
    return frames ? std::vector<float>(stereo, stereo + frames * 2) : std::vector<float>{};
  const auto target = (inputFrames_ * outputRate_ + inputRate_ / 2) / inputRate_;
  std::vector<float> result;
  result.reserve(static_cast<std::size_t>(
                     (frames + resampler_->getNumTaps() + 2ULL) * outputRate_ / inputRate_ + 2) *
                 2);
  const float silence[2]{};
  std::uint32_t consumed = 0;
  while (consumed < frames || !resampler_->isWriteNeeded() || (end && outputFrames_ < target)) {
    if (resampler_->isWriteNeeded()) {
      if (consumed < frames)
        resampler_->writeNextFrame(stereo + consumed++ * 2);
      else if (end)
        resampler_->writeNextFrame(silence);
      else
        break;
    } else {
      float frame[2];
      resampler_->readNextFrame(frame);
      if (discarded_ < delayFrames_)
        ++discarded_;
      else if (outputFrames_ < target) {
        result.push_back(frame[0]);
        result.push_back(frame[1]);
        ++outputFrames_;
      }
    }
  }
  return result;
}
} // namespace effetune::android

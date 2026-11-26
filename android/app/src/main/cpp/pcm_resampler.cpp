#include "pcm_resampler.h"
#include <cmath>
#include <stdexcept>

namespace effetune::android {
PcmResampler::PcmResampler(int inputRate, int outputRate, int channels)
    : inputRate_(inputRate), outputRate_(outputRate), channels_(channels) {
  // Includes supported source rates after the player's 0.25x..4x speed scaling.
  if (channels < 2 || channels > 16 || inputRate < 1000 || inputRate > 1536000 || outputRate < 8000 || outputRate > 192000)
    throw std::invalid_argument("Unsupported resampling rates");
  if (channels > 2) scratch_.resize((1024 + 2) * channels);
  if (inputRate != outputRate) {
    using Resampler = oboe::resampler::MultiChannelResampler;
    resampler_.reset(Resampler::make(channels, inputRate, outputRate, Resampler::Quality::Best));
    delayFrames_ =
        (static_cast<std::uint64_t>(resampler_->getNumTaps() / 2) * outputRate + inputRate - 1) /
        inputRate;
  }
}

std::vector<float> PcmResampler::process(const float *pcm, std::uint32_t frames, bool end) {
  if (frames > 1024 || (frames && !pcm) || ended_)
    throw std::invalid_argument("Invalid resampling block");
  for (std::uint32_t i = 0; i < frames * channels_; ++i)
    if (!std::isfinite(pcm[i]))
      throw std::invalid_argument("Invalid PCM sample");
  inputFrames_ += frames;
  ended_ = end;
  if (!resampler_)
    return frames ? std::vector<float>(pcm, pcm + frames * channels_) : std::vector<float>{};
  const auto target = (inputFrames_ * outputRate_ + inputRate_ / 2) / inputRate_;
  std::vector<float> result;
  result.reserve(static_cast<std::size_t>(
                     (frames + resampler_->getNumTaps() + 2ULL) * outputRate_ / inputRate_ + 2) *
                 channels_);
  float stereoFrame[2], stereoSilence[2]{};
  float *frame = channels_ == 2 ? stereoFrame : scratch_.data() + 1024 * channels_;
  const float *silence = channels_ == 2 ? stereoSilence : frame + channels_;
  std::uint32_t consumed = 0;
  while (consumed < frames || !resampler_->isWriteNeeded() || (end && outputFrames_ < target)) {
    if (resampler_->isWriteNeeded()) {
      if (consumed < frames)
        resampler_->writeNextFrame(pcm + consumed++ * channels_);
      else if (end)
        resampler_->writeNextFrame(silence);
      else
        break;
    } else {
      resampler_->readNextFrame(frame);
      if (discarded_ < delayFrames_)
        ++discarded_;
      else if (outputFrames_ < target) {
        if (channels_ == 2) {
          result.push_back(frame[0]);
          result.push_back(frame[1]);
        } else result.insert(result.end(), frame, frame + channels_);
        ++outputFrames_;
      }
    }
  }
  return result;
}
} // namespace effetune::android

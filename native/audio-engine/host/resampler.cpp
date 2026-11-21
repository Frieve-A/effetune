#include "host/resampler.h"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <stdexcept>

namespace effetune::audio {

Resampler::Resampler(unsigned channels, unsigned inputRate, unsigned outputRate, bool adaptive)
    : channels_(channels), adaptive_(adaptive), nominal_(0), step_(0) {
  if (!channels || channels > 16 || inputRate < 8000 || inputRate > 384000 || outputRate < 8000 ||
      outputRate > 384000)
    throw std::invalid_argument("Unsupported resampler configuration");
  nominal_ = step_ = static_cast<double>(inputRate) / outputRate;
  if (inputRate == outputRate && !adaptive)
    return;
  // Hold the transition band constant in Hz on the lower-rate side.
  const double scale = std::max(1.0, nominal_);
  const double cutoff = 0.953 / scale;
  taps_ = 2 * static_cast<unsigned>(std::ceil(72 * scale));
  coefficients_.resize(std::size_t(phases + 1) * taps_);
  history_.resize(std::size_t(channels) * taps_ * 2);
  constexpr double pi = std::numbers::pi;
  for (int phase = 0; phase <= phases; ++phase) {
    const double center = taps_ * 0.5 - 1 + static_cast<double>(phase) / phases;
    float *row = coefficients_.data() + phase * taps_;
    double sum = 0;
    for (unsigned tap = 0; tap < taps_; ++tap) {
      const double x = tap - center;
      const double angle = 2 * pi * x / taps_;
      const double window = 0.42 + 0.5 * std::cos(angle) + 0.08 * std::cos(2 * angle);
      const double value = (x == 0 ? cutoff : std::sin(pi * x * cutoff) / (pi * x)) * window;
      row[tap] = static_cast<float>(value);
      sum += value;
    }
    for (unsigned tap = 0; tap < taps_; ++tap)
      row[tap] = static_cast<float>(row[tap] / sum);
  }
}

void Resampler::reset() noexcept {
  std::fill(history_.begin(), history_.end(), 0);
  write_ = 0;
  position_ = 1;
  step_ = nominal_;
}

void Resampler::setCorrection(double fraction) noexcept {
  if (adaptive_)
    step_ = nominal_ * (1 + std::clamp(fraction, -0.002, 0.002));
}

std::size_t Resampler::inputNeeded(std::size_t outputs) const noexcept {
  if (!outputs || !taps_)
    return outputs;
  return static_cast<std::size_t>(position_ + (outputs - 1) * step_);
}

ResampledFrames Resampler::process(const float *input, std::size_t inputStride,
                                   std::size_t inputFrames, float *output, std::size_t outputStride,
                                   std::size_t outputFrames) noexcept {
  if (!taps_) {
    const std::size_t count = std::min(inputFrames, outputFrames);
    if (count && input != output) {
      for (unsigned ch = 0; ch < channels_; ++ch)
        std::copy_n(input + ch * inputStride, count, output + ch * outputStride);
    }
    return {count, count};
  }
  ResampledFrames frames;
  while (frames.produced < outputFrames) {
    while (position_ >= 1) {
      if (frames.consumed == inputFrames)
        return frames;
      for (unsigned ch = 0; ch < channels_; ++ch) {
        float *ring = history_.data() + ch * 2 * taps_;
        ring[write_] = ring[write_ + taps_] = input[ch * inputStride + frames.consumed];
      }
      if (++write_ == taps_)
        write_ = 0;
      ++frames.consumed;
      position_ -= 1;
    }
    const double phase = position_ * phases;
    const auto index = static_cast<unsigned>(phase);
    const float mix = static_cast<float>(phase - index);
    const float *left = coefficients_.data() + index * taps_;
    const float *right = left + taps_;
    for (unsigned ch = 0; ch < channels_; ++ch) {
      const float *samples = history_.data() + ch * 2 * taps_ + write_;
      float a = 0, b = 0;
      for (unsigned tap = 0; tap < taps_; ++tap) {
        a += left[tap] * samples[tap];
        b += right[tap] * samples[tap];
      }
      output[ch * outputStride + frames.produced] = a + mix * (b - a);
    }
    ++frames.produced;
    position_ += step_;
  }
  return frames;
}

} // namespace effetune::audio

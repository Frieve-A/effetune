#include "frequency_preview.h"
#include <algorithm>
#include <cmath>
#include <numbers>
namespace effetune::audio {
bool FrequencyPreview::configure(double frequency, bool noise, unsigned rate) noexcept {
  const bool valid = std::isfinite(frequency) && frequency > 0 && frequency < rate * .5;
  const bool previous = active();
  if (valid) {
    if (noise_ != noise || (!gain_ && !target_)) {
      filterFrequency_ = 0;
      fade_ = 1;
    }
    frequency_ = frequency;
    noise_ = noise;
  }
  target_ = valid ? 1 : 0;
  return previous != valid;
}
double FrequencyPreview::Filter::sample(double white) noexcept {
  const double v3 = white * scale - i2, v1 = a1 * i1 + a2 * v3, v2 = i2 + a2 * i1 + a3 * v3;
  i1 = 2 * v1 - i1;
  i2 = 2 * v2 - i2;
  return v1;
}
void FrequencyPreview::mix(float *bus, unsigned channels, unsigned frames, unsigned rate) noexcept {
  if (!gain_ && !target_)
    return;
  const double step = 1. / (rate * .005), phaseStep = 2 * std::numbers::pi * frequency_ / rate;
  if (noise_ && fade_ == 1 && filterFrequency_ != frequency_) {
    selected_ ^= 1;
    auto &f = filters_[selected_];
    f = {};
    const auto g = std::tan(std::numbers::pi * frequency_ / rate);
    f.a1 = 1. / (1 + g * (g + .25));
    f.a2 = g * f.a1;
    f.a3 = g * f.a2;
    f.scale = std::sqrt(.375 / f.a2);
    fade_ = filterFrequency_ ? 0 : 1;
    filterFrequency_ = frequency_;
  }
  for (unsigned i = 0; i < frames; ++i) {
    gain_ += std::clamp(target_ - gain_, -step, step);
    double v;
    if (noise_) {
      random_ ^= random_ << 13;
      random_ ^= random_ >> 17;
      random_ ^= random_ << 5;
      const auto white = random_ * (2. / 4294967296.) - 1;
      fade_ = std::min(1., fade_ + step);
      v = filters_[selected_].sample(white) * fade_;
      if (fade_ < 1)
        v += filters_[selected_ ^ 1].sample(white) * (1 - fade_);
    } else
      v = std::sin(phase_);
    const float sample = static_cast<float>(v * .251188643150958 * gain_);
    for (unsigned ch = 0; ch < std::min(2u, channels); ++ch)
      bus[ch * frames + i] += sample;
    phase_ += phaseStep;
    if (phase_ >= 2 * std::numbers::pi)
      phase_ -= 2 * std::numbers::pi;
  }
}
} // namespace effetune::audio

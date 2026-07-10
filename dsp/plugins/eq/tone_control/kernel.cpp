#include "effetune/kernel.h"
#include "ToneControlPluginParams.h"
#include "effetune/dsp/biquad.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::eq {
namespace {

constexpr double kTwoPi = 6.283185307179586;
constexpr double kSqrtTwo = 1.4142135623730951;
constexpr double kGainThreshold = 1.0e-6;

using Coefficients = dsp::BiquadCoefficients;

struct ToneState final {
  dsp::BiquadDf1State bass;
  dsp::BiquadDf1State mid;
  dsp::BiquadDf1State treble;

  void reset() noexcept {
    bass.reset();
    mid.reset();
    treble.reset();
  }
};

Coefficients designBass(double sample_rate, double gain_db) noexcept {
  const double a = std::pow(10.0, 0.025 * gain_db);
  const double omega = kTwoPi * 100.0 / sample_rate;
  const double cosine = std::cos(omega);
  const double sine = std::sin(omega);
  const double alpha = sine * 0.5 * kSqrtTwo;
  const double sqrt_a = std::sqrt(a);
  const double two_sqrt_a_alpha = 2.0 * sqrt_a * alpha;
  const double a_plus_one = a + 1.0;
  const double a_minus_one = a - 1.0;
  const double common1 = a_plus_one - a_minus_one * cosine;
  const double common2 = a_plus_one + a_minus_one * cosine;

  const double b0 = a * (common1 + two_sqrt_a_alpha);
  const double b1 = 2.0 * a * (a_minus_one - a_plus_one * cosine);
  const double b2 = a * (common1 - two_sqrt_a_alpha);
  const double a0 = common2 + two_sqrt_a_alpha;
  const double a1 = -2.0 * (a_minus_one + a_plus_one * cosine);
  const double a2 = common2 - two_sqrt_a_alpha;
  const double inverse_a0 = 1.0 / a0;
  return {b0 * inverse_a0, b1 * inverse_a0, b2 * inverse_a0, a1 * inverse_a0, a2 * inverse_a0};
}

Coefficients designMid(double sample_rate, double gain_db) noexcept {
  const double a = std::pow(10.0, 0.025 * gain_db);
  const double omega = kTwoPi * 1000.0 / sample_rate;
  const double cosine = std::cos(omega);
  const double sine = std::sin(omega);
  const double alpha = sine / (2.0 * 0.7);
  const double alpha_times_a = alpha * a;
  const double alpha_over_a = alpha / a;
  const double negative_two_cosine = -2.0 * cosine;

  const double b0 = 1.0 + alpha_times_a;
  const double b1 = negative_two_cosine;
  const double b2 = 1.0 - alpha_times_a;
  const double a0 = 1.0 + alpha_over_a;
  const double a1 = negative_two_cosine;
  const double a2 = 1.0 - alpha_over_a;
  const double inverse_a0 = 1.0 / a0;
  return {b0 * inverse_a0, b1 * inverse_a0, b2 * inverse_a0, a1 * inverse_a0, a2 * inverse_a0};
}

Coefficients designTreble(double sample_rate, double gain_db) noexcept {
  const double a = std::pow(10.0, 0.025 * gain_db);
  const double omega = kTwoPi * 10000.0 / sample_rate;
  const double cosine = std::cos(omega);
  const double sine = std::sin(omega);
  const double alpha = sine * 0.5 * kSqrtTwo;
  const double sqrt_a = std::sqrt(a);
  const double two_sqrt_a_alpha = 2.0 * sqrt_a * alpha;
  const double a_plus_one = a + 1.0;
  const double a_minus_one = a - 1.0;
  const double common1 = a_plus_one + a_minus_one * cosine;
  const double common2 = a_plus_one - a_minus_one * cosine;

  const double b0 = a * (common1 + two_sqrt_a_alpha);
  const double b1 = -2.0 * a * (a_minus_one + a_plus_one * cosine);
  const double b2 = a * (common1 - two_sqrt_a_alpha);
  const double a0 = common2 + two_sqrt_a_alpha;
  const double a1 = 2.0 * (a_minus_one - a_plus_one * cosine);
  const double a2 = common2 - two_sqrt_a_alpha;
  const double inverse_a0 = 1.0 / a0;
  return {b0 * inverse_a0, b1 * inverse_a0, b2 * inverse_a0, a1 * inverse_a0, a2 * inverse_a0};
}

} // namespace

class ToneControlKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::ToneControlPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    states_.resize(max_channels_);
  }

  void reset() noexcept override {
    initialized_ = false;
    for (ToneState &state : states_) {
      state.reset();
    }
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }
    if (!initialized_ || last_channel_count_ != channel_count) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        states_[channel].reset();
      }
      last_channel_count_ = channel_count;
      initialized_ = true;
    }

    const double bass_gain = static_cast<double>(params_.bass);
    const double mid_gain = static_cast<double>(params_.mid);
    const double treble_gain = static_cast<double>(params_.treble);
    const bool bass_active = bass_gain > kGainThreshold || bass_gain < -kGainThreshold;
    const bool mid_active = mid_gain > kGainThreshold || mid_gain < -kGainThreshold;
    const bool treble_active = treble_gain > kGainThreshold || treble_gain < -kGainThreshold;

    const Coefficients bass = bass_active ? designBass(sample_rate_, bass_gain) : Coefficients{};
    const Coefficients mid = mid_active ? designMid(sample_rate_, mid_gain) : Coefficients{};
    const Coefficients treble =
        treble_active ? designTreble(sample_rate_, treble_gain) : Coefficients{};

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      ToneState &state = states_[channel];
      const std::uint32_t offset = channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        double sample = static_cast<double>(audio[offset + frame]);
        if (bass_active) {
          sample = dsp::processBiquadDf1Sample(sample, bass, state.bass);
        }
        if (mid_active) {
          sample = dsp::processBiquadDf1Sample(sample, mid, state.mid);
        }
        if (treble_active) {
          sample = dsp::processBiquadDf1Sample(sample, treble, state.treble);
        }
        audio[offset + frame] = static_cast<float>(sample);
      }
    }
  }

private:
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool initialized_ = false;
  std::vector<ToneState> states_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(ToneControlPlugin, effetune::plugins::eq::ToneControlKernel)

#include "effetune/kernel.h"
#include "LoudnessEqualizerPluginParams.h"
#include "effetune/dsp/biquad.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::eq {
namespace {

constexpr double kTwoPi = 6.283185307179586;

using Coefficients = dsp::BiquadCoefficients;

struct LoudnessState final {
  dsp::BiquadDf1State low;
  dsp::BiquadDf1State high;

  void reset() noexcept {
    low.reset();
    high.reset();
  }
};

Coefficients designLowShelf(double sample_rate, double frequency, double q,
                            double gain_db) noexcept {
  if (q <= 0.0) {
    return {};
  }
  const double a = std::pow(10.0, gain_db / 40.0);
  const double omega = kTwoPi * frequency / sample_rate;
  const double cosine = std::cos(omega);
  const double sine = std::sin(omega);
  const double alpha = sine / (2.0 * q);
  const double two_sqrt_a_alpha = 2.0 * std::sqrt(a) * alpha;
  const double a_plus_one = a + 1.0;
  const double a_minus_one = a - 1.0;

  const double b0 = a * (a_plus_one - a_minus_one * cosine + two_sqrt_a_alpha);
  const double b1 = 2.0 * a * (a_minus_one - a_plus_one * cosine);
  const double b2 = a * (a_plus_one - a_minus_one * cosine - two_sqrt_a_alpha);
  const double a0 = a_plus_one + a_minus_one * cosine + two_sqrt_a_alpha;
  const double a1 = -2.0 * (a_minus_one + a_plus_one * cosine);
  const double a2 = a_plus_one + a_minus_one * cosine - two_sqrt_a_alpha;
  if (a0 < 1.0e-10 && a0 > -1.0e-10) {
    return {};
  }
  const double inverse_a0 = 1.0 / a0;
  return {b0 * inverse_a0, b1 * inverse_a0, b2 * inverse_a0, a1 * inverse_a0, a2 * inverse_a0};
}

Coefficients designHighShelf(double sample_rate, double frequency, double q,
                             double gain_db) noexcept {
  if (q <= 0.0) {
    return {};
  }
  const double a = std::pow(10.0, gain_db / 40.0);
  const double omega = kTwoPi * frequency / sample_rate;
  const double cosine = std::cos(omega);
  const double sine = std::sin(omega);
  const double alpha = sine / (2.0 * q);
  const double two_sqrt_a_alpha = 2.0 * std::sqrt(a) * alpha;
  const double a_plus_one = a + 1.0;
  const double a_minus_one = a - 1.0;

  const double b0 = a * (a_plus_one + a_minus_one * cosine + two_sqrt_a_alpha);
  const double b1 = -2.0 * a * (a_minus_one + a_plus_one * cosine);
  const double b2 = a * (a_plus_one + a_minus_one * cosine - two_sqrt_a_alpha);
  const double a0 = a_plus_one - a_minus_one * cosine + two_sqrt_a_alpha;
  const double a1 = 2.0 * (a_minus_one - a_plus_one * cosine);
  const double a2 = a_plus_one - a_minus_one * cosine - two_sqrt_a_alpha;
  if (a0 < 1.0e-10 && a0 > -1.0e-10) {
    return {};
  }
  const double inverse_a0 = 1.0 / a0;
  return {b0 * inverse_a0, b1 * inverse_a0, b2 * inverse_a0, a1 * inverse_a0, a2 * inverse_a0};
}

} // namespace

class LoudnessEqualizerKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::LoudnessEqualizerPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    states_.resize(max_channels_);
  }

  void reset() noexcept override {
    initialized_ = false;
    coefficients_cached_ = false;
    for (LoudnessState &state : states_) {
      state.reset();
    }
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }

    bool recalculate = false;
    if (!initialized_ || last_channel_count_ != channel_count) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        states_[channel].reset();
      }
      last_channel_count_ = channel_count;
      initialized_ = true;
      recalculate = true;
    }
    if (!recalculate && parametersChanged()) {
      recalculate = true;
    }
    if (recalculate || !coefficients_cached_) {
      calculateCoefficients();
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      LoudnessState &state = states_[channel];
      const std::uint32_t offset = channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double low_output = dsp::processBiquadDf1Sample(
            static_cast<double>(audio[offset + frame]), low_shelf_, state.low);
        const double high_output = dsp::processBiquadDf1Sample(low_output, high_shelf_, state.high);
        audio[offset + frame] = static_cast<float>(high_output);
      }
    }
  }

private:
  [[nodiscard]] bool parametersChanged() const noexcept {
    return !coefficients_cached_ || cached_average_spl_ != params_.averageSpl ||
           cached_low_gain_ != params_.lowGain || cached_low_frequency_ != params_.lowFrequency ||
           cached_low_q_ != params_.lowQ || cached_high_gain_ != params_.highGain ||
           cached_high_frequency_ != params_.highFrequency || cached_high_q_ != params_.highQ ||
           cached_sample_rate_ != sample_rate_;
  }

  void calculateCoefficients() noexcept {
    const double gain_multiplier = (85.0 - static_cast<double>(params_.averageSpl)) / 25.0;
    const double low_gain = static_cast<double>(params_.lowGain) * gain_multiplier;
    const double high_gain = static_cast<double>(params_.highGain) * gain_multiplier;
    low_shelf_ = designLowShelf(sample_rate_, static_cast<double>(params_.lowFrequency),
                                static_cast<double>(params_.lowQ), low_gain);
    high_shelf_ = designHighShelf(sample_rate_, static_cast<double>(params_.highFrequency),
                                  static_cast<double>(params_.highQ), high_gain);

    cached_average_spl_ = params_.averageSpl;
    cached_low_gain_ = params_.lowGain;
    cached_low_frequency_ = params_.lowFrequency;
    cached_low_q_ = params_.lowQ;
    cached_high_q_ = params_.highQ;
    cached_high_gain_ = params_.highGain;
    cached_high_frequency_ = params_.highFrequency;
    cached_sample_rate_ = sample_rate_;
    coefficients_cached_ = true;
  }

  double sample_rate_ = 0.0;
  double cached_sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  float cached_average_spl_ = 0.0F;
  float cached_low_gain_ = 0.0F;
  float cached_low_frequency_ = 0.0F;
  float cached_low_q_ = 0.0F;
  float cached_high_q_ = 0.0F;
  float cached_high_gain_ = 0.0F;
  float cached_high_frequency_ = 0.0F;
  bool initialized_ = false;
  bool coefficients_cached_ = false;
  Coefficients low_shelf_{};
  Coefficients high_shelf_{};
  std::vector<LoudnessState> states_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(LoudnessEqualizerPlugin, effetune::plugins::eq::LoudnessEqualizerKernel)

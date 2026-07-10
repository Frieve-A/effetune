#include "effetune/kernel.h"
#include "TiltEQPluginParams.h"
#include "effetune/dsp/biquad.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::eq {
namespace {

constexpr double kTwoPi = 6.283185307179586;

using Coefficients = dsp::BiquadCoefficients;

struct TiltState final {
  dsp::BiquadDf1State lowShelf;
  dsp::BiquadDf1State highShelf;

  void reset() noexcept {
    lowShelf.reset();
    highShelf.reset();
  }
};

Coefficients designLowShelf(double cosine, double sine, double gain_db) noexcept {
  const double a = std::pow(10.0, gain_db / 40.0);
  const double sqrt_a = std::sqrt(a);
  const double alpha = sine * 0.5 * std::sqrt((a + 1.0 / a) * 1.0 + 2.0);
  const double common1 = a + 1.0;
  const double common2 = a - 1.0;
  const double common3 = 2.0 * sqrt_a * alpha;
  const double common4 = common2 * cosine;
  const double common5 = common1 * cosine;

  const double b0 = a * (common1 - common4 + common3);
  const double b1 = 2.0 * a * (common2 - common5);
  const double b2 = a * (common1 - common4 - common3);
  const double a0 = common1 + common4 + common3;
  const double a1 = -2.0 * (common2 + common5);
  const double a2 = common1 + common4 - common3;
  const double inverse_a0 = 1.0 / a0;
  return {b0 * inverse_a0, b1 * inverse_a0, b2 * inverse_a0, a1 * inverse_a0, a2 * inverse_a0};
}

Coefficients designHighShelf(double cosine, double sine, double gain_db) noexcept {
  const double a = std::pow(10.0, gain_db / 40.0);
  const double sqrt_a = std::sqrt(a);
  const double alpha = sine * 0.5 * std::sqrt((a + 1.0 / a) * 1.0 + 2.0);
  const double common1 = a + 1.0;
  const double common2 = a - 1.0;
  const double common3 = 2.0 * sqrt_a * alpha;
  const double common4 = common2 * cosine;
  const double common5 = common1 * cosine;

  const double b0 = a * (common1 + common4 + common3);
  const double b1 = -2.0 * a * (common2 + common5);
  const double b2 = a * (common1 + common4 - common3);
  const double a0 = common1 - common4 + common3;
  const double a1 = 2.0 * (common2 - common5);
  const double a2 = common1 - common4 - common3;
  const double inverse_a0 = 1.0 / a0;
  return {b0 * inverse_a0, b1 * inverse_a0, b2 * inverse_a0, a1 * inverse_a0, a2 * inverse_a0};
}

} // namespace

class TiltEQKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::TiltEQPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    states_.resize(max_channels_);
  }

  void reset() noexcept override {
    initialized_ = false;
    state_created_ = false;
    for (TiltState &state : states_) {
      state.reset();
    }
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }

    const float raw_pivot = params_.pivotExponent;
    const float raw_slope = params_.slope;
    const double slope = static_cast<double>(raw_slope);
    if (slope < 0.01 && slope > -0.01) {
      return;
    }

    const bool channel_changed = last_channel_count_ != channel_count;
    if (!initialized_ || channel_changed || last_pivot_ != raw_pivot || last_slope_ != raw_slope) {
      configure(channel_count, raw_pivot, raw_slope, channel_changed);
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      TiltState &state = states_[channel];
      const std::uint32_t offset = channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double low_output = dsp::processBiquadDf1Sample(
            static_cast<double>(audio[offset + frame]), low_shelf_, state.lowShelf);
        const double high_output =
            dsp::processBiquadDf1Sample(low_output, high_shelf_, state.highShelf);
        audio[offset + frame] = static_cast<float>(high_output);
      }
      dsp::quantizeBiquadStateToFloat(state.lowShelf);
      dsp::quantizeBiquadStateToFloat(state.highShelf);
    }
  }

private:
  void configure(std::uint32_t channel_count, float raw_pivot, float raw_slope,
                 bool channel_changed) noexcept {
    if (!state_created_ || channel_changed) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        states_[channel].reset();
      }
      state_created_ = true;
    }

    const double pivot = std::exp(static_cast<double>(raw_pivot));
    const double omega = kTwoPi * pivot / sample_rate_;
    const double cosine = std::cos(omega);
    const double sine = std::sin(omega);
    const double slope = static_cast<double>(raw_slope);
    low_shelf_ = designLowShelf(cosine, sine, -2.0 * slope);
    high_shelf_ = designHighShelf(cosine, sine, 2.0 * slope);

    last_channel_count_ = channel_count;
    last_pivot_ = raw_pivot;
    last_slope_ = raw_slope;
    initialized_ = true;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  float last_pivot_ = 0.0F;
  float last_slope_ = 0.0F;
  bool initialized_ = false;
  bool state_created_ = false;
  Coefficients low_shelf_{};
  Coefficients high_shelf_{};
  std::vector<TiltState> states_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(TiltEQPlugin, effetune::plugins::eq::TiltEQKernel)

#include "effetune/kernel.h"
#include "TiltEQPluginParams.h"
#include "effetune/dsp/biquad.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
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
    const auto requested_frames = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005));
    transition_frames_ = requested_frames == 0u ? 1u : requested_frames;
    states_.resize(max_channels_);
  }

  void reset() noexcept override {
    initialized_ = false;
    state_created_ = false;
    transition_remaining_ = 0u;
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
    const bool channel_changed = last_channel_count_ != channel_count;
    if (!initialized_ || channel_changed || last_pivot_ != raw_pivot || last_slope_ != raw_slope) {
      configure(channel_count, raw_pivot, raw_slope, channel_changed);
    }

    // Channel pairs run in one frame loop so their independent recursions overlap; filter state
    // and the coefficient ramp stay in registers. Every pair replays the same ramp, so results
    // match one shared per-frame ramp exactly.
    const std::uint32_t ramp_frames =
        transition_remaining_ < frame_count ? transition_remaining_ : frame_count;
    Coefficients low = low_shelf_;
    Coefficients high = high_shelf_;
    for (std::uint32_t channel = 0u; channel < channel_count; channel += 2u) {
      float *const data = audio + static_cast<std::size_t>(channel) * frame_count;
      if (channel + 1u < channel_count)
        processLanes<2u>(data, frame_count, ramp_frames, &states_[channel], low, high);
      else
        processLanes<1u>(data, frame_count, ramp_frames, &states_[channel], low, high);
    }
    low_shelf_ = low;
    high_shelf_ = high;
    transition_remaining_ -= ramp_frames;
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

    const double slope = static_cast<double>(raw_slope);
    Coefficients next_low{};
    Coefficients next_high{};
    if (slope <= -0.01 || slope >= 0.01) {
      const double pivot = std::exp(static_cast<double>(raw_pivot));
      const double omega = kTwoPi * pivot / sample_rate_;
      const double cosine = std::cos(omega);
      const double sine = std::sin(omega);
      next_low = designLowShelf(cosine, sine, -2.0 * slope);
      next_high = designHighShelf(cosine, sine, 2.0 * slope);
    }

    if (!initialized_) {
      low_shelf_ = next_low;
      high_shelf_ = next_high;
      transition_remaining_ = 0u;
    } else {
      setTransition(low_shelf_, next_low, low_step_);
      setTransition(high_shelf_, next_high, high_step_);
      transition_remaining_ = transition_frames_;
    }

    last_channel_count_ = channel_count;
    last_pivot_ = raw_pivot;
    last_slope_ = raw_slope;
    initialized_ = true;
  }

  void setTransition(const Coefficients &current, const Coefficients &target,
                     Coefficients &step) const noexcept {
    const double divisor = static_cast<double>(transition_frames_);
    step.b0 = (target.b0 - current.b0) / divisor;
    step.b1 = (target.b1 - current.b1) / divisor;
    step.b2 = (target.b2 - current.b2) / divisor;
    step.a1 = (target.a1 - current.a1) / divisor;
    step.a2 = (target.a2 - current.a2) / divisor;
  }

  template <std::uint32_t Lanes>
  void processLanes(float *data, std::uint32_t frame_count, std::uint32_t ramp_frames,
                    TiltState *states, Coefficients &low_out,
                    Coefficients &high_out) const noexcept {
    Coefficients low = low_shelf_;
    Coefficients high = high_shelf_;
    TiltState local[Lanes];
    for (std::uint32_t lane = 0u; lane < Lanes; ++lane)
      local[lane] = states[lane];
    const auto filter = [&](std::uint32_t frame) noexcept {
      for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
        float &sample = data[static_cast<std::size_t>(lane) * frame_count + frame];
        const double low_output =
            dsp::processBiquadDf1Sample(static_cast<double>(sample), low, local[lane].lowShelf);
        sample = static_cast<float>(
            dsp::processBiquadDf1Sample(low_output, high, local[lane].highShelf));
      }
    };
    std::uint32_t frame = 0u;
    for (; frame < ramp_frames; ++frame) {
      stepCoefficients(low, low_step_);
      stepCoefficients(high, high_step_);
      filter(frame);
    }
    for (; frame < frame_count; ++frame)
      filter(frame);
    for (std::uint32_t lane = 0u; lane < Lanes; ++lane)
      states[lane] = local[lane];
    low_out = low;
    high_out = high;
  }

  static void stepCoefficients(Coefficients &coefficients, const Coefficients &step) noexcept {
    coefficients.b0 += step.b0;
    coefficients.b1 += step.b1;
    coefficients.b2 += step.b2;
    coefficients.a1 += step.a1;
    coefficients.a2 += step.a2;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  float last_pivot_ = 0.0F;
  float last_slope_ = 0.0F;
  bool initialized_ = false;
  bool state_created_ = false;
  std::uint32_t transition_frames_ = 1u;
  std::uint32_t transition_remaining_ = 0u;
  Coefficients low_shelf_{};
  Coefficients high_shelf_{};
  Coefficients low_step_{};
  Coefficients high_step_{};
  std::vector<TiltState> states_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(TiltEQPlugin, effetune::plugins::eq::TiltEQKernel)

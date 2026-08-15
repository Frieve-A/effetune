#include "effetune/kernel.h"
#include "ToneControlPluginParams.h"
#include "effetune/dsp/biquad.h"

#include <algorithm>
#include <array>
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
    const auto requested_frames = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005));
    ramp_frames_ = requested_frames == 0u ? 1u : requested_frames;
  }

  void reset() noexcept override {
    initialized_ = false;
    coefficients_initialized_ = false;
    ramp_remaining_ = 0u;
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

    retargetCoefficients();

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      ToneState &state = states_[channel];
      const std::uint32_t offset = channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const auto coefficients = coefficientsAt(frame);
        double sample = static_cast<double>(audio[offset + frame]);
        sample = dsp::processBiquadDf1Sample(sample, coefficients[0], state.bass);
        sample = dsp::processBiquadDf1Sample(sample, coefficients[1], state.mid);
        sample = dsp::processBiquadDf1Sample(sample, coefficients[2], state.treble);
        audio[offset + frame] = static_cast<float>(sample);
      }
    }
    advanceCoefficients(frame_count);
  }

private:
  static Coefficients interpolate(const Coefficients &from, const Coefficients &step,
                                  double position) noexcept {
    return {from.b0 + step.b0 * position, from.b1 + step.b1 * position,
            from.b2 + step.b2 * position, from.a1 + step.a1 * position,
            from.a2 + step.a2 * position};
  }

  void retargetCoefficients() noexcept {
    const std::array<double, 3u> gains{static_cast<double>(params_.bass),
                                       static_cast<double>(params_.mid),
                                       static_cast<double>(params_.treble)};
    std::array<Coefficients, 3u> targets{
        gains[0] > kGainThreshold || gains[0] < -kGainThreshold ? designBass(sample_rate_, gains[0])
                                                                : Coefficients{},
        gains[1] > kGainThreshold || gains[1] < -kGainThreshold ? designMid(sample_rate_, gains[1])
                                                                : Coefficients{},
        gains[2] > kGainThreshold || gains[2] < -kGainThreshold
            ? designTreble(sample_rate_, gains[2])
            : Coefficients{}};
    if (!coefficients_initialized_) {
      current_coefficients_ = target_coefficients_ = targets;
      cached_gains_ = gains;
      coefficients_initialized_ = true;
      return;
    }
    if (gains == cached_gains_)
      return;
    cached_gains_ = gains;
    target_coefficients_ = targets;
    const double inverse = 1.0 / static_cast<double>(ramp_frames_);
    for (std::size_t index = 0u; index < 3u; ++index) {
      const Coefficients &from = current_coefficients_[index];
      const Coefficients &to = target_coefficients_[index];
      coefficient_steps_[index] = {(to.b0 - from.b0) * inverse, (to.b1 - from.b1) * inverse,
                                   (to.b2 - from.b2) * inverse, (to.a1 - from.a1) * inverse,
                                   (to.a2 - from.a2) * inverse};
    }
    ramp_remaining_ = ramp_frames_;
  }

  [[nodiscard]] std::array<Coefficients, 3u> coefficientsAt(std::uint32_t frame) const noexcept {
    const std::uint32_t elapsed = frame + 1u;
    const double position =
        static_cast<double>(elapsed < ramp_remaining_ ? elapsed : ramp_remaining_);
    return {interpolate(current_coefficients_[0], coefficient_steps_[0], position),
            interpolate(current_coefficients_[1], coefficient_steps_[1], position),
            interpolate(current_coefficients_[2], coefficient_steps_[2], position)};
  }

  void advanceCoefficients(std::uint32_t frames) noexcept {
    const std::uint32_t advanced = frames < ramp_remaining_ ? frames : ramp_remaining_;
    for (std::size_t index = 0u; index < 3u; ++index) {
      current_coefficients_[index] =
          interpolate(current_coefficients_[index], coefficient_steps_[index], advanced);
    }
    ramp_remaining_ -= advanced;
    if (ramp_remaining_ == 0u)
      current_coefficients_ = target_coefficients_;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool initialized_ = false;
  bool coefficients_initialized_ = false;
  std::array<double, 3u> cached_gains_{};
  std::array<Coefficients, 3u> current_coefficients_{};
  std::array<Coefficients, 3u> target_coefficients_{};
  std::array<Coefficients, 3u> coefficient_steps_{};
  std::uint32_t ramp_frames_ = 240u;
  std::uint32_t ramp_remaining_ = 0u;
  std::vector<ToneState> states_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(ToneControlPlugin, effetune::plugins::eq::ToneControlKernel)

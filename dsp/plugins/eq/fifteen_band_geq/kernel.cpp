#include "effetune/kernel.h"
#include "FifteenBandGEQPluginParams.h"
#include "effetune/dsp/biquad.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>

namespace effetune::plugins::eq {
namespace {

constexpr std::uint32_t kBands = 15u;
constexpr std::uint32_t kMaxChannels = 16u;
constexpr double kPi = 3.141592653589793;
constexpr double kTwoPi = 6.283185307179586;
constexpr double kGainBypassThreshold = 0.01;
constexpr double kA0Threshold = 1.0e-8;
constexpr double kQ = 2.1;
constexpr std::array<double, kBands> kFrequencies = {25.0,   40.0,   63.0,   100.0,   160.0,
                                                     250.0,  400.0,  630.0,  1000.0,  1600.0,
                                                     2500.0, 4000.0, 6300.0, 10000.0, 16000.0};

} // namespace

class FifteenBandGEQKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::FifteenBandGEQPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = info.sampleRate;
    transition_frames_ = static_cast<std::uint32_t>(
        std::max(1.0, std::ceil(static_cast<double>(sample_rate_) * 0.005)));
    reset();
  }

  void reset() noexcept override {
    for (dsp::BiquadDf1State &state : states_) {
      state.reset();
    }
    previous_gains_.fill(std::numeric_limits<float>::quiet_NaN());
    last_channel_count_ = 0u;
    coefficients_initialized_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > kMaxChannels ||
        frame_count == 0u || sample_rate_ <= 0.0F) {
      return;
    }
    if (last_channel_count_ != channel_count) {
      for (dsp::BiquadDf1State &state : states_) {
        state.reset();
      }
      previous_gains_.fill(std::numeric_limits<float>::quiet_NaN());
      last_channel_count_ = channel_count;
      coefficients_initialized_ = false;
    }
    if (!coefficients_initialized_ || paramsDirty()) {
      updateCoefficients();
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      float *channel_audio = audio + channel * frame_count;
      for (std::uint32_t band = 0u; band < kBands; ++band) {
        if (!ramps_[band].processingRequired()) {
          continue;
        }
        dsp::BiquadDf1State &state = states_[band * kMaxChannels + channel];
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const dsp::BiquadCoefficients coefficients = ramps_[band].value(frame);
          channel_audio[frame] = static_cast<float>(dsp::processBiquadDf1Sample(
              static_cast<double>(channel_audio[frame]), coefficients, state));
        }
      }
    }
    for (CoefficientRamp &ramp : ramps_)
      ramp.advance(frame_count);
  }

private:
  struct CoefficientRamp {
    dsp::BiquadCoefficients current{};
    dsp::BiquadCoefficients target{};
    dsp::BiquadCoefficients step{};
    std::uint32_t remaining = 0u;

    static bool identity(const dsp::BiquadCoefficients &value) noexcept {
      return value.b0 == 1.0 && value.b1 == 0.0 && value.b2 == 0.0 && value.a1 == 0.0 &&
             value.a2 == 0.0;
    }
    void snap(const dsp::BiquadCoefficients &value) noexcept {
      current = target = value;
      step = {};
      remaining = 0u;
    }
    void retarget(const dsp::BiquadCoefficients &value, std::uint32_t frames) noexcept {
      target = value;
      const double denominator = static_cast<double>(frames);
      step = {(target.b0 - current.b0) / denominator, (target.b1 - current.b1) / denominator,
              (target.b2 - current.b2) / denominator, (target.a1 - current.a1) / denominator,
              (target.a2 - current.a2) / denominator};
      remaining = frames;
    }
    [[nodiscard]] bool processingRequired() const noexcept {
      return remaining != 0u || !identity(current);
    }
    [[nodiscard]] dsp::BiquadCoefficients value(std::uint32_t frame) const noexcept {
      const std::uint32_t elapsed = frame + 1u;
      if (elapsed >= remaining)
        return target;
      const double offset = static_cast<double>(elapsed);
      return {current.b0 + step.b0 * offset, current.b1 + step.b1 * offset,
              current.b2 + step.b2 * offset, current.a1 + step.a1 * offset,
              current.a2 + step.a2 * offset};
    }
    void advance(std::uint32_t frames) noexcept {
      if (frames >= remaining) {
        current = target;
        step = {};
        remaining = 0u;
      } else {
        const double offset = static_cast<double>(frames);
        current = {current.b0 + step.b0 * offset, current.b1 + step.b1 * offset,
                   current.b2 + step.b2 * offset, current.a1 + step.a1 * offset,
                   current.a2 + step.a2 * offset};
        remaining -= frames;
      }
    }
  };

  [[nodiscard]] dsp::BiquadCoefficients designBand(std::uint32_t band,
                                                   float gain_value) const noexcept {
    const double gain = gain_value;
    const double gain_abs = gain < 0.0 ? -gain : gain;
    if (gain_abs < kGainBypassThreshold)
      return {};

    const double a = std::sqrt(std::pow(10.0, 0.05 * gain));
    const double w0 = kFrequencies[band] * kTwoPi / sample_rate_;
    const double clamped_w0 = w0 < 1.0e-6 ? 1.0e-6 : (w0 > kPi - 1.0e-6 ? kPi - 1.0e-6 : w0);
    const double cosine = std::cos(clamped_w0);
    const double sine = std::sin(clamped_w0);
    const double alpha = sine / (2.0 * kQ);
    const double alpha_times_a = alpha * a;
    const double alpha_over_a = alpha / a;
    const double negative_two_cosine = -2.0 * cosine;
    const double b0 = 1.0 + alpha_times_a;
    const double b1 = negative_two_cosine;
    const double b2 = 1.0 - alpha_times_a;
    const double a0 = 1.0 + alpha_over_a;
    const double a1 = negative_two_cosine;
    const double a2 = 1.0 - alpha_over_a;
    const double a0_abs = a0 < 0.0 ? -a0 : a0;
    if (a0_abs < kA0Threshold)
      return {};
    const double inverse_a0 = 1.0 / a0;
    return {b0 * inverse_a0, b1 * inverse_a0, b2 * inverse_a0, a1 * inverse_a0, a2 * inverse_a0};
  }

  void updateCoefficients() noexcept {
    std::uint32_t changed_mask = 0u;
    for (std::uint32_t band = 0u; band < kBands; ++band) {
      const float gain_value = params_.bandGain[band];
      if (gain_value != previous_gains_[band])
        changed_mask |= 1u << band;
    }
    for (std::uint32_t band = 0u; band < kBands; ++band) {
      if ((changed_mask & (1u << band)) == 0u)
        continue;
      const float gain_value = params_.bandGain[band];
      previous_gains_[band] = gain_value;
      const dsp::BiquadCoefficients designed = designBand(band, gain_value);
      if (!coefficients_initialized_)
        ramps_[band].snap(designed);
      else
        ramps_[band].retarget(designed, transition_frames_);
    }
    coefficients_initialized_ = true;
  }

  std::array<CoefficientRamp, kBands> ramps_{};
  std::array<dsp::BiquadDf1State, kBands * kMaxChannels> states_{};
  std::array<float, kBands> previous_gains_{};
  float sample_rate_ = 0.0F;
  std::uint32_t last_channel_count_ = 0u;
  bool coefficients_initialized_ = false;
  std::uint32_t transition_frames_ = 1u;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(FifteenBandGEQPlugin, effetune::plugins::eq::FifteenBandGEQKernel)

#include "effetune/kernel.h"
#include "FifteenBandGEQPluginParams.h"
#include "effetune/dsp/biquad.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <limits>

namespace effetune::plugins::eq {
namespace {

constexpr std::uint32_t kBands = 15u;
constexpr std::uint32_t kMaxChannels = 8u;
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
    reset();
  }

  void reset() noexcept override {
    for (dsp::BiquadDf1State &state : states_) {
      state.reset();
    }
    active_.fill(false);
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
        if (!active_[band]) {
          continue;
        }
        dsp::BiquadDf1State &state = states_[band * kMaxChannels + channel];
        const dsp::BiquadCoefficients &coefficients = coefficients_[band];
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          channel_audio[frame] = static_cast<float>(dsp::processBiquadDf1Sample(
              static_cast<double>(channel_audio[frame]), coefficients, state));
        }
      }
    }
  }

private:
  void updateCoefficients() noexcept {
    for (std::uint32_t band = 0u; band < kBands; ++band) {
      const float gain_value = params_.bandGain[band];
      if (gain_value == previous_gains_[band]) {
        continue;
      }
      previous_gains_[band] = gain_value;
      const double gain = gain_value;
      const double gain_abs = gain < 0.0 ? -gain : gain;
      if (gain_abs < kGainBypassThreshold) {
        active_[band] = false;
        continue;
      }

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
      if (a0_abs < kA0Threshold) {
        active_[band] = false;
        continue;
      }
      const double inverse_a0 = 1.0 / a0;
      coefficients_[band] = {b0 * inverse_a0, b1 * inverse_a0, b2 * inverse_a0, a1 * inverse_a0,
                             a2 * inverse_a0};
      active_[band] = true;
    }
    coefficients_initialized_ = true;
  }

  std::array<dsp::BiquadCoefficients, kBands> coefficients_{};
  std::array<dsp::BiquadDf1State, kBands * kMaxChannels> states_{};
  std::array<float, kBands> previous_gains_{};
  std::array<bool, kBands> active_{};
  float sample_rate_ = 0.0F;
  std::uint32_t last_channel_count_ = 0u;
  bool coefficients_initialized_ = false;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(FifteenBandGEQPlugin, effetune::plugins::eq::FifteenBandGEQKernel)

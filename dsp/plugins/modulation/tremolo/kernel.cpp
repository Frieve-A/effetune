#include "effetune/kernel.h"
#include "TremoloPluginParams.h"
#include "effetune/dsp/biquad.h"
#include "effetune/dsp/math.h"
#include "effetune/dsp/xorshift_rng.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::modulation {
namespace {

constexpr double kTwoPi = 6.283185307179586;
constexpr double kDegreesToRadians = 0.017453292519943295;
constexpr double kSqrtTwo = 1.4142135623730951;
constexpr double kMinimumQ = 0.01;

dsp::BiquadCoefficients designNoiseFilter(double sample_rate, double cutoff,
                                          double slope) noexcept {
  const double calculated_q = std::pow(10.0, (slope + 6.0) / 6.0) * (1.0 / kSqrtTwo);
  const double q = calculated_q < kMinimumQ ? kMinimumQ : calculated_q;
  dsp::BiquadCoefficients coefficients{};
  if (cutoff > 0.0 && cutoff < sample_rate * 0.5) {
    const double omega = kTwoPi * cutoff / sample_rate;
    const double cosine = std::cos(omega);
    const double alpha = std::sin(omega) / (2.0 * q);
    const double a0 = 1.0 + alpha;
    if (alpha > 1.0e-9 && a0 > 1.0e-9) {
      const double inverse_a0 = 1.0 / a0;
      const double one_minus_cosine = 1.0 - cosine;
      coefficients.b0 = (one_minus_cosine * 0.5) * inverse_a0;
      coefficients.b1 = one_minus_cosine * inverse_a0;
      coefficients.b2 = coefficients.b0;
      coefficients.a1 = (-2.0 * cosine) * inverse_a0;
      coefficients.a2 = (1.0 - alpha) * inverse_a0;
    }
  }
  return coefficients;
}

} // namespace

class TremoloKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::TremoloPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    channel_noise_states_.resize(max_channels_);
  }

  void reset() noexcept override {
    phase_ = 0.0;
    common_noise_state_.reset();
    for (dsp::BiquadTdf2State &state : channel_noise_states_) {
      state.reset();
    }
    channel_states_initialized_ = false;
    last_channel_count_ = 0u;
    random_.seed(selected_seed_low_, selected_seed_high_);
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    random_.seed(seed_low, seed_high);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }
    if (!channel_states_initialized_ || last_channel_count_ != channel_count) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        channel_noise_states_[channel].reset();
      }
      last_channel_count_ = channel_count;
      channel_states_initialized_ = true;
    }

    const dsp::BiquadCoefficients noise_filter =
        designNoiseFilter(sample_rate_, static_cast<double>(params_.randomnessCutoff),
                          static_cast<double>(params_.randomnessSlope));
    const double phase_increment = kTwoPi * static_cast<double>(params_.rate) / sample_rate_;
    const double channel_phase = static_cast<double>(params_.channelPhase) * kDegreesToRadians;
    const double sync_ratio = static_cast<double>(params_.channelSync) * 0.01;
    const double inverse_sync = 1.0 - sync_ratio;
    const double negative_depth = -static_cast<double>(params_.depth);
    const double negative_randomness_twice = -static_cast<double>(params_.randomness) * 2.0;

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      phase_ += phase_increment;
      if (phase_ >= kTwoPi) {
        phase_ -= kTwoPi;
      }

      const double common_noise = random_.nextFloat01() - 0.5;
      const double filtered_common =
          dsp::processBiquadTdf2Sample(common_noise, noise_filter, common_noise_state_);
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        double current_phase = phase_ + static_cast<double>(channel) * channel_phase;
        current_phase -= kTwoPi * std::floor(current_phase / kTwoPi);

        const double channel_noise = random_.nextFloat01() - 0.5;
        const double filtered_channel = dsp::processBiquadTdf2Sample(
            channel_noise, noise_filter, channel_noise_states_[channel]);
        const double filtered_noise =
            sync_ratio * filtered_common + inverse_sync * filtered_channel;
        const double base_modulation = (1.0 - std::sin(current_phase)) * 0.5;
        const double noise_contribution = filtered_noise * negative_randomness_twice;
        const double total_modulation = base_modulation * negative_depth + noise_contribution;
        const double gain = dsp::db_to_lin(total_modulation);
        const std::uint32_t index = channel * frame_count + frame;
        audio[index] = static_cast<float>(static_cast<double>(audio[index]) * gain);
      }
    }
  }

private:
  double sample_rate_ = 0.0;
  double phase_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool channel_states_initialized_ = false;
  dsp::BiquadTdf2State common_noise_state_{};
  std::vector<dsp::BiquadTdf2State> channel_noise_states_;
  dsp::XorShiftRng random_{};
};

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(TremoloPlugin, effetune::plugins::modulation::TremoloKernel)

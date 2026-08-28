#include "effetune/kernel.h"
#include "VinylArtifactsPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

constexpr double kPi = 3.141592653589793;
constexpr double kDbToLinearFast = 0.11512925464970229;
constexpr double kPopCompensationGain = 16.0;
constexpr double kCrackleCompensationGain = 4.0;
constexpr double kMinimumDbLevel = -80.0;

struct BiquadCoefficients final {
  double b0 = 1.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
};

struct BiquadState final {
  double x1 = 0.0;
  double x2 = 0.0;
  double y1 = 0.0;
  double y2 = 0.0;
};

struct PopState final {
  BiquadState filter;
  BiquadCoefficients coefficients;
};

struct CrackleState final {
  double level = 0.0;
  BiquadState filter;
};

struct RumbleState final {
  double brown = 0.0;
  BiquadState filter;
};

struct PinkState final {
  std::array<float, 7> values{};
};

void resetBiquad(BiquadState &state) noexcept { state = {}; }

void calculateHpf(double frequency, double q, double sample_rate,
                  BiquadCoefficients &output) noexcept {
  const double w0 = 2.0 * kPi * frequency / sample_rate;
  const double cosine = std::cos(w0);
  const double alpha = std::sin(w0) / (2.0 * q);
  const double inverse_a0 = 1.0 / (1.0 + alpha);
  const double half = (1.0 + cosine) * 0.5;
  output.b0 = half * inverse_a0;
  output.b1 = -(1.0 + cosine) * inverse_a0;
  output.b2 = half * inverse_a0;
  output.a1 = -2.0 * cosine * inverse_a0;
  output.a2 = (1.0 - alpha) * inverse_a0;
}

void calculateLpf(double frequency, double q, double sample_rate,
                  BiquadCoefficients &output) noexcept {
  const double w0 = 2.0 * kPi * frequency / sample_rate;
  const double cosine = std::cos(w0);
  const double alpha = std::sin(w0) / (2.0 * q);
  const double inverse_a0 = 1.0 / (1.0 + alpha);
  const double half = (1.0 - cosine) * 0.5;
  output.b0 = half * inverse_a0;
  output.b1 = (1.0 - cosine) * inverse_a0;
  output.b2 = half * inverse_a0;
  output.a1 = -2.0 * cosine * inverse_a0;
  output.a2 = (1.0 - alpha) * inverse_a0;
}

bool calculateLowShelf(double frequency, double db_gain, double q, double sample_rate,
                       BiquadCoefficients &output) noexcept {
  const double absolute_gain = db_gain < 0.0 ? -db_gain : db_gain;
  if (absolute_gain < 0.01) {
    return false;
  }
  const double amplitude = std::pow(10.0, db_gain / 40.0);
  const double w0 = 2.0 * kPi * frequency / sample_rate;
  const double cosine = std::cos(w0);
  const double sine = std::sin(w0);
  const double alpha = sine / (2.0 * q);
  const double beta = 2.0 * std::sqrt(amplitude) * alpha;
  const double amplitude_plus_one = amplitude + 1.0;
  const double amplitude_minus_one = amplitude - 1.0;
  const double inverse_a0 = 1.0 / (amplitude_plus_one + amplitude_minus_one * cosine + beta);
  output.b0 = amplitude * (amplitude_plus_one - amplitude_minus_one * cosine + beta) * inverse_a0;
  output.b1 = 2.0 * amplitude * (amplitude_minus_one - amplitude_plus_one * cosine) * inverse_a0;
  output.b2 = amplitude * (amplitude_plus_one - amplitude_minus_one * cosine - beta) * inverse_a0;
  output.a1 = -2.0 * (amplitude_minus_one + amplitude_plus_one * cosine) * inverse_a0;
  output.a2 = (amplitude_plus_one + amplitude_minus_one * cosine - beta) * inverse_a0;
  return true;
}

bool calculateHighShelf(double frequency, double db_gain, double q, double sample_rate,
                        BiquadCoefficients &output) noexcept {
  const double absolute_gain = db_gain < 0.0 ? -db_gain : db_gain;
  if (absolute_gain < 0.01) {
    return false;
  }
  const double amplitude = std::pow(10.0, db_gain / 40.0);
  const double w0 = 2.0 * kPi * frequency / sample_rate;
  const double cosine = std::cos(w0);
  const double sine = std::sin(w0);
  const double alpha = sine / (2.0 * q);
  const double beta = 2.0 * std::sqrt(amplitude) * alpha;
  const double amplitude_plus_one = amplitude + 1.0;
  const double amplitude_minus_one = amplitude - 1.0;
  const double inverse_a0 = 1.0 / (amplitude_plus_one - amplitude_minus_one * cosine + beta);
  output.b0 = amplitude * (amplitude_plus_one + amplitude_minus_one * cosine + beta) * inverse_a0;
  output.b1 = -2.0 * amplitude * (amplitude_minus_one + amplitude_plus_one * cosine) * inverse_a0;
  output.b2 = amplitude * (amplitude_plus_one + amplitude_minus_one * cosine - beta) * inverse_a0;
  output.a1 = 2.0 * (amplitude_minus_one - amplitude_plus_one * cosine) * inverse_a0;
  output.a2 = (amplitude_plus_one - amplitude_minus_one * cosine - beta) * inverse_a0;
  return true;
}

double processSafeBiquad(double input, BiquadState &state,
                         const BiquadCoefficients *coefficients) noexcept {
  if (coefficients == nullptr) {
    return input;
  }
  double output = coefficients->b0 * input + coefficients->b1 * state.x1 +
                  coefficients->b2 * state.x2 - coefficients->a1 * state.y1 -
                  coefficients->a2 * state.y2;
  output += 1.0e-25;
  if (!std::isfinite(output)) {
    resetBiquad(state);
    return 0.0;
  }
  if (output > 10.0) {
    output = 10.0;
  } else if (output < -10.0) {
    output = -10.0;
  }
  state.x2 = state.x1;
  state.x1 = input;
  state.y2 = state.y1;
  state.y1 = output;
  return output;
}

} // namespace

class VinylArtifactsKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::VinylArtifactsPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    pink_states_.resize(max_channels_);
    pop_states_.resize(max_channels_);
    crackle_states_.resize(max_channels_);
    rumble_states_.resize(max_channels_);
    low_shelf_states_.resize(max_channels_);
    high_shelf_states_.resize(max_channels_);
    last_input_.resize(max_channels_);
    wet_samples_.resize(max_channels_);
    automation_ramp_frames_ =
        std::max(1u, static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005)));
  }

  void reset() noexcept override {
    clearChannelStates();
    energy_smooth_ = 0.0;
    crackle_hpf_coefficients_ = {};
    rumble_lpf_coefficients_ = {};
    low_shelf_coefficients_ = {};
    high_shelf_coefficients_ = {};
    last_channel_count_ = 0u;
    configured_ = false;
    low_shelf_bypassed_ = true;
    high_shelf_bypassed_ = true;
    random_.seed(selected_seed_low_, selected_seed_high_);
    automation_initialized_ = false;
    mix_ramp_remaining_ = 0u;
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    random_.seed(seed_low, seed_high);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u) {
      return;
    }

    const double target_mix = static_cast<double>(params_.mix) / 100.0;
    if (target_mix < 1.0e-6 && (!automation_initialized_ || (mix_ == 0.0 && mix_target_ == 0.0))) {
      return;
    }
    if (!configured_ || last_channel_count_ != channel_count) {
      resetForChannels(channel_count);
    }

    const double inverse_sample_rate = 1.0 / sample_rate_;
    const double react_amount = static_cast<double>(params_.react) / 100.0;
    const double profile_ratio = 1.0 - static_cast<double>(params_.noiseProfile) / 10.0;
    const double low_shelf_db = 20.0 * (1.0 - profile_ratio);
    const double high_shelf_db = -20.0 * (1.0 - profile_ratio);

    calculateHpf(3500.0, 0.707, sample_rate_, crackle_hpf_coefficients_);
    calculateLpf(70.0, 0.707, sample_rate_, rumble_lpf_coefficients_);
    target_low_shelf_coefficients_ = {};
    target_high_shelf_coefficients_ = {};
    calculateLowShelf(50.0, low_shelf_db, 0.707, sample_rate_, target_low_shelf_coefficients_);
    calculateHighShelf(2122.0, high_shelf_db, 0.707, sample_rate_, target_high_shelf_coefficients_);
    if (!automation_initialized_) {
      pop_level_ = params_.popLevel;
      crackle_level_ = params_.crackleLevel;
      hiss_level_ = params_.hissLevel;
      rumble_level_ = params_.rumbleLevel;
      wear_ = static_cast<double>(params_.wear) / 100.0;
      crosstalk_ = (static_cast<double>(params_.crosstalk) / 100.0) * 0.5;
      target_pop_level_ = pop_level_;
      target_crackle_level_ = crackle_level_;
      target_hiss_level_ = hiss_level_;
      target_rumble_level_ = rumble_level_;
      target_wear_ = wear_;
      target_crosstalk_ = crosstalk_;
      target_noise_profile_ = params_.noiseProfile;
      mix_ = target_mix;
      mix_target_ = target_mix;
      mix_ramp_remaining_ = 0u;
      low_shelf_coefficients_ = target_low_shelf_coefficients_;
      high_shelf_coefficients_ = target_high_shelf_coefficients_;
      automation_initialized_ = true;
    } else if (params_.popLevel != target_pop_level_ ||
               params_.crackleLevel != target_crackle_level_ ||
               params_.hissLevel != target_hiss_level_ ||
               params_.rumbleLevel != target_rumble_level_ ||
               static_cast<double>(params_.wear) / 100.0 != target_wear_ ||
               static_cast<double>(params_.crosstalk) / 200.0 != target_crosstalk_ ||
               params_.noiseProfile != target_noise_profile_ || target_mix != mix_target_) {
      target_pop_level_ = params_.popLevel;
      target_crackle_level_ = params_.crackleLevel;
      target_hiss_level_ = params_.hissLevel;
      target_rumble_level_ = params_.rumbleLevel;
      target_wear_ = static_cast<double>(params_.wear) / 100.0;
      target_crosstalk_ = static_cast<double>(params_.crosstalk) / 200.0;
      target_noise_profile_ = params_.noiseProfile;
      mix_target_ = target_mix;
      mix_ramp_remaining_ = automation_ramp_frames_;
    }

    double control_signal = 0.0;
    if (react_amount > 0.0) {
      double energy = 0.0;
      const double inverse_channel_count = 1.0 / channel_count;
      const bool velocity_mode = params_.reactMode == 0.0F;
      if (velocity_mode) {
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          double frame_energy = 0.0;
          for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
            const float sample = audio[channel * frame_count + frame];
            const double difference = static_cast<double>(sample) - last_input_[channel];
            frame_energy += difference * difference;
            last_input_[channel] = sample;
          }
          energy += frame_energy * inverse_channel_count;
        }
      } else {
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          double frame_energy = 0.0;
          for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
            const double sample = audio[channel * frame_count + frame];
            frame_energy += sample * sample;
          }
          energy += frame_energy * inverse_channel_count;
        }
      }
      energy = std::sqrt(energy / frame_count);
      const double smoothing = energy > energy_smooth_ ? 0.05 : 0.3;
      energy_smooth_ += (energy - energy_smooth_) * smoothing;
      const double scaled_energy = energy_smooth_ * 2.0;
      control_signal = (scaled_energy > 1.0 ? 1.0 : scaled_energy) * react_amount;
    }

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      if (mix_ramp_remaining_ != 0u) {
        const double ramp_scale = 1.0 / static_cast<double>(mix_ramp_remaining_);
        pop_level_ += (target_pop_level_ - pop_level_) * ramp_scale;
        crackle_level_ += (target_crackle_level_ - crackle_level_) * ramp_scale;
        hiss_level_ += (target_hiss_level_ - hiss_level_) * ramp_scale;
        rumble_level_ += (target_rumble_level_ - rumble_level_) * ramp_scale;
        wear_ += (target_wear_ - wear_) * ramp_scale;
        crosstalk_ += (target_crosstalk_ - crosstalk_) * ramp_scale;
        mix_ += (mix_target_ - mix_) * ramp_scale;
        rampCoefficients(low_shelf_coefficients_, target_low_shelf_coefficients_, ramp_scale);
        rampCoefficients(high_shelf_coefficients_, target_high_shelf_coefficients_, ramp_scale);
        if (--mix_ramp_remaining_ == 0u) {
          pop_level_ = target_pop_level_;
          crackle_level_ = target_crackle_level_;
          hiss_level_ = target_hiss_level_;
          rumble_level_ = target_rumble_level_;
          wear_ = target_wear_;
          crosstalk_ = target_crosstalk_;
          mix_ = mix_target_;
          low_shelf_coefficients_ = target_low_shelf_coefficients_;
          high_shelf_coefficients_ = target_high_shelf_coefficients_;
        }
      }
      const double pop_gain = pop_level_ <= kMinimumDbLevel || wear_ < 1.0e-6
                                  ? 0.0
                                  : std::exp(pop_level_ * kDbToLinearFast);
      const double crackle_gain = crackle_level_ <= kMinimumDbLevel || wear_ < 1.0e-6
                                      ? 0.0
                                      : std::exp(crackle_level_ * kDbToLinearFast);
      const double hiss_gain = hiss_level_ <= kMinimumDbLevel || wear_ < 1.0e-6
                                   ? 0.0
                                   : std::exp(hiss_level_ * kDbToLinearFast);
      const double rumble_gain =
          rumble_level_ <= kMinimumDbLevel ? 0.0 : std::exp(rumble_level_ * kDbToLinearFast);
      const double pop_probability =
          pop_gain > 0.0 ? params_.popsPerMinute * wear_ / 60.0 * inverse_sample_rate : 0.0;
      const double crackle_probability =
          crackle_gain > 0.0 ? params_.cracklesPerMinute * wear_ / 60.0 * inverse_sample_rate : 0.0;
      const double reactive_pop_probability = pop_probability * (1.0 + control_signal * 15.0);
      const double reactive_crackle_probability =
          crackle_probability * (1.0 + control_signal * 8.0);
      const double hiss_factor = 0.11 * hiss_gain * wear_;
      const double pop_impulse_gain = pop_gain * kPopCompensationGain;
      const double crackle_impulse_gain = crackle_gain * kCrackleCompensationGain;
      const bool pop_trigger = random_.nextFloat01() < reactive_pop_probability;
      const bool crackle_trigger = random_.nextFloat01() < reactive_crackle_probability;

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        double total_noise = 0.0;

        if (pop_gain > 0.0) {
          PopState &pop = pop_states_[channel];
          double pop_input = 0.0;
          if (pop_trigger) {
            const double size = random_.nextFloat01();
            const double inverse_size = 1.0 - size;
            const double frequency = 200.0 + 3800.0 * inverse_size * inverse_size;
            const double q = 0.7 + 0.8 * size;
            calculateHpf(frequency, q, sample_rate_, pop.coefficients);
            pop_input = (random_.nextFloat01() * 2.0 - 1.0) * pop_impulse_gain;
          }
          total_noise += processSafeBiquad(pop_input, pop.filter, &pop.coefficients);
        }

        if (crackle_gain > 0.0) {
          CrackleState &crackle = crackle_states_[channel];
          crackle.level *= 0.992;
          if (crackle_trigger) {
            crackle.level += std::pow(random_.nextFloat01(), 2.5) * 1.2;
          }
          if (crackle.level > 2.0) {
            crackle.level = 2.0;
          }
          double crackle_input = 0.0;
          if (crackle.level > 1.0e-6) {
            crackle_input =
                (random_.nextFloat01() * 2.0 - 1.0) * crackle_impulse_gain * crackle.level;
          }
          total_noise +=
              processSafeBiquad(crackle_input, crackle.filter, &crackle_hpf_coefficients_);
        }

        if (hiss_gain > 0.0) {
          PinkState &pink = pink_states_[channel];
          const double white = random_.nextFloat01() * 2.0 - 1.0;
          const double b0 = 0.99886 * pink.values[0] + white * 0.0555179;
          const double b1 = 0.99332 * pink.values[1] + white * 0.0750759;
          const double b2 = 0.96900 * pink.values[2] + white * 0.1538520;
          const double b3 = 0.86650 * pink.values[3] + white * 0.3104856;
          const double b4 = 0.55000 * pink.values[4] + white * 0.5329522;
          const double b5 = -0.7616 * pink.values[5] - white * 0.0168980;
          total_noise +=
              (b0 + b1 + b2 + b3 + b4 + b5 + pink.values[6] + white * 0.5362) * hiss_factor;
          pink.values[0] = static_cast<float>(b0);
          pink.values[1] = static_cast<float>(b1);
          pink.values[2] = static_cast<float>(b2);
          pink.values[3] = static_cast<float>(b3);
          pink.values[4] = static_cast<float>(b4);
          pink.values[5] = static_cast<float>(b5);
          pink.values[6] = static_cast<float>(white * 0.115926);
        }

        if (rumble_gain > 0.0) {
          RumbleState &rumble = rumble_states_[channel];
          double brown = rumble.brown + (random_.nextFloat01() * 2.0 - 1.0) * 0.02;
          if (brown > 0.95) {
            brown = 0.95;
          } else if (brown < -0.95) {
            brown = -0.95;
          }
          rumble.brown = brown;
          total_noise += processSafeBiquad(rumble.brown * rumble_gain, rumble.filter,
                                           &rumble_lpf_coefficients_);
        }

        const double low_shelf_output =
            processSafeBiquad(total_noise, low_shelf_states_[channel], &low_shelf_coefficients_);
        wet_samples_[channel] = static_cast<float>(processSafeBiquad(
            low_shelf_output, high_shelf_states_[channel], &high_shelf_coefficients_));
      }

      const float dry_left = audio[frame];
      double wet_left = wet_samples_[0];
      if (channel_count > 1u) {
        const float dry_right = audio[frame_count + frame];
        double wet_right = wet_samples_[1];
        if (crosstalk_ > 1.0e-6) {
          const double original_left = wet_left;
          const double original_right = wet_right;
          const double direct_mix = 1.0 - crosstalk_;
          wet_left = original_left * direct_mix + original_right * crosstalk_;
          wet_right = original_right * direct_mix + original_left * crosstalk_;
        }
        audio[frame_count + frame] =
            static_cast<float>(static_cast<double>(dry_right) + wet_right * mix_);
      }
      audio[frame] = static_cast<float>(static_cast<double>(dry_left) + wet_left * mix_);
    }
  }

private:
  static void rampCoefficients(BiquadCoefficients &current, const BiquadCoefficients &target,
                               double ramp_scale) noexcept {
    current.b0 += (target.b0 - current.b0) * ramp_scale;
    current.b1 += (target.b1 - current.b1) * ramp_scale;
    current.b2 += (target.b2 - current.b2) * ramp_scale;
    current.a1 += (target.a1 - current.a1) * ramp_scale;
    current.a2 += (target.a2 - current.a2) * ramp_scale;
  }

  void clearChannelStates() noexcept {
    std::fill(pink_states_.begin(), pink_states_.end(), PinkState{});
    std::fill(pop_states_.begin(), pop_states_.end(), PopState{});
    std::fill(crackle_states_.begin(), crackle_states_.end(), CrackleState{});
    std::fill(rumble_states_.begin(), rumble_states_.end(), RumbleState{});
    std::fill(low_shelf_states_.begin(), low_shelf_states_.end(), BiquadState{});
    std::fill(high_shelf_states_.begin(), high_shelf_states_.end(), BiquadState{});
    std::fill(last_input_.begin(), last_input_.end(), 0.0F);
    std::fill(wet_samples_.begin(), wet_samples_.end(), 0.0F);
  }

  void resetForChannels(std::uint32_t channel_count) noexcept {
    clearChannelStates();
    energy_smooth_ = 0.0;
    crackle_hpf_coefficients_ = {};
    rumble_lpf_coefficients_ = {};
    low_shelf_coefficients_ = {};
    high_shelf_coefficients_ = {};
    last_channel_count_ = channel_count;
    configured_ = true;
    low_shelf_bypassed_ = true;
    high_shelf_bypassed_ = true;
  }

  void updateShelfBypass(std::uint32_t channel_count, bool low_enabled,
                         bool high_enabled) noexcept {
    const bool low_bypassed = !low_enabled;
    if (low_bypassed != low_shelf_bypassed_) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        resetBiquad(low_shelf_states_[channel]);
      }
      low_shelf_bypassed_ = low_bypassed;
    }
    const bool high_bypassed = !high_enabled;
    if (high_bypassed != high_shelf_bypassed_) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        resetBiquad(high_shelf_states_[channel]);
      }
      high_shelf_bypassed_ = high_bypassed;
    }
  }

  double sample_rate_ = 0.0;
  double energy_smooth_ = 0.0;
  std::uint32_t automation_ramp_frames_ = 240u;
  std::uint32_t mix_ramp_remaining_ = 0u;
  double pop_level_ = 0.0;
  double crackle_level_ = 0.0;
  double hiss_level_ = 0.0;
  double rumble_level_ = 0.0;
  double wear_ = 0.0;
  double crosstalk_ = 0.0;
  double mix_ = 0.0;
  double target_pop_level_ = 0.0;
  double target_crackle_level_ = 0.0;
  double target_hiss_level_ = 0.0;
  double target_rumble_level_ = 0.0;
  double target_wear_ = 0.0;
  double target_crosstalk_ = 0.0;
  double mix_target_ = 0.0;
  float target_noise_profile_ = 0.0F;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool configured_ = false;
  bool automation_initialized_ = false;
  bool low_shelf_bypassed_ = true;
  bool high_shelf_bypassed_ = true;
  std::vector<PinkState> pink_states_;
  std::vector<PopState> pop_states_;
  std::vector<CrackleState> crackle_states_;
  std::vector<RumbleState> rumble_states_;
  std::vector<BiquadState> low_shelf_states_;
  std::vector<BiquadState> high_shelf_states_;
  std::vector<float> last_input_;
  std::vector<float> wet_samples_;
  BiquadCoefficients crackle_hpf_coefficients_;
  BiquadCoefficients rumble_lpf_coefficients_;
  BiquadCoefficients low_shelf_coefficients_;
  BiquadCoefficients high_shelf_coefficients_;
  BiquadCoefficients target_low_shelf_coefficients_;
  BiquadCoefficients target_high_shelf_coefficients_;
  dsp::XorShiftRng random_{};
};

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(VinylArtifactsPlugin, effetune::plugins::lofi::VinylArtifactsKernel)

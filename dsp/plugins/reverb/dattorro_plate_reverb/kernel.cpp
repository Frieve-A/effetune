#include "effetune/kernel.h"
#include "DattorroPlateReverbPluginParams.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <numbers>
#include <vector>

namespace effetune::plugins::reverb {
namespace {

constexpr double kDattorroSampleRate = 29761.0;
constexpr double kTwoPi = 6.283185307179586;
constexpr double kHalfPi = 1.5707963267948966;

[[nodiscard]] std::uint32_t scaledDelay(std::uint32_t original, double scale) noexcept {
  const double rounded = std::round(static_cast<double>(original - 1u) * scale);
  const double result = rounded + 1.0;
  return result < 1.0 ? 1u : static_cast<std::uint32_t>(result);
}

[[nodiscard]] std::uint32_t scaledTap(std::uint32_t original, double scale) noexcept {
  const double rounded = std::round(static_cast<double>(original) * scale);
  return rounded < 1.0 ? 1u : static_cast<std::uint32_t>(rounded);
}

[[nodiscard]] float tapped(const std::vector<float> &buffer, std::uint32_t position,
                           std::uint32_t delay, std::uint32_t size) noexcept {
  std::int64_t index = static_cast<std::int64_t>(position) - static_cast<std::int64_t>(delay);
  if (index < 0)
    index += static_cast<std::int64_t>(size);
  return buffer[static_cast<std::size_t>(index)];
}

} // namespace

class DattorroPlateReverbKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::DattorroPlateReverbPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    const double scale = sample_rate_ / kDattorroSampleRate;

    input_diff0_size_ = scaledDelay(142u, scale);
    input_diff1_size_ = scaledDelay(107u, scale);
    input_diff2_size_ = scaledDelay(379u, scale);
    input_diff3_size_ = scaledDelay(277u, scale);
    tank_a_diff1_size_ = scaledDelay(672u, scale);
    tank_a_delay1_size_ = scaledDelay(4453u, scale);
    tank_a_diff2_size_ = scaledDelay(1800u, scale);
    tank_a_delay2_size_ = scaledDelay(3720u, scale);
    tank_b_diff1_size_ = scaledDelay(908u, scale);
    tank_b_delay1_size_ = scaledDelay(4217u, scale);
    tank_b_diff2_size_ = scaledDelay(2656u, scale);
    tank_b_delay2_size_ = scaledDelay(3163u, scale);

    const double pre_delay_ceiling = std::ceil(sample_rate_ * 0.1);
    pre_delay_size_ = pre_delay_ceiling < 1.0 ? 1u : static_cast<std::uint32_t>(pre_delay_ceiling);
    const double modulation_ceiling = std::ceil(17.0 * scale);
    const std::uint32_t modulation_buffer =
        (modulation_ceiling < 1.0 ? 1u : static_cast<std::uint32_t>(modulation_ceiling)) + 2u;

    pre_delay_.resize(pre_delay_size_);
    input_diff0_.resize(input_diff0_size_);
    input_diff1_.resize(input_diff1_size_);
    input_diff2_.resize(input_diff2_size_);
    input_diff3_.resize(input_diff3_size_);
    tank_a_diff1_.resize(tank_a_diff1_size_ + modulation_buffer);
    tank_a_delay1_.resize(tank_a_delay1_size_);
    tank_a_diff2_.resize(tank_a_diff2_size_);
    tank_a_delay2_.resize(tank_a_delay2_size_);
    tank_b_diff1_.resize(tank_b_diff1_size_ + modulation_buffer);
    tank_b_delay1_.resize(tank_b_delay1_size_);
    tank_b_diff2_.resize(tank_b_diff2_size_);
    tank_b_delay2_.resize(tank_b_delay2_size_);

    tap_l_b_delay1_266_ = scaledTap(266u, scale);
    tap_l_b_delay1_2974_ = scaledTap(2974u, scale);
    tap_l_b_diff2_1913_ = scaledTap(1913u, scale);
    tap_l_b_delay2_1996_ = scaledTap(1996u, scale);
    tap_l_a_delay1_1990_ = scaledTap(1990u, scale);
    tap_l_a_diff2_187_ = scaledTap(187u, scale);
    tap_l_a_delay2_1066_ = scaledTap(1066u, scale);
    tap_r_a_delay1_353_ = scaledTap(353u, scale);
    tap_r_a_delay1_3627_ = scaledTap(3627u, scale);
    tap_r_a_diff2_1228_ = scaledTap(1228u, scale);
    tap_r_a_delay2_2673_ = scaledTap(2673u, scale);
    tap_r_b_delay1_2111_ = scaledTap(2111u, scale);
    tap_r_b_diff2_335_ = scaledTap(335u, scale);
    tap_r_b_delay2_121_ = scaledTap(121u, scale);
    reset();
  }

  void reset() noexcept override {
    clear(pre_delay_);
    clear(input_diff0_);
    clear(input_diff1_);
    clear(input_diff2_);
    clear(input_diff3_);
    clear(tank_a_diff1_);
    clear(tank_a_delay1_);
    clear(tank_a_diff2_);
    clear(tank_a_delay2_);
    clear(tank_b_diff1_);
    clear(tank_b_delay1_);
    clear(tank_b_diff2_);
    clear(tank_b_delay2_);
    pre_delay_position_ = 0u;
    input_diff0_position_ = 0u;
    input_diff1_position_ = 0u;
    input_diff2_position_ = 0u;
    input_diff3_position_ = 0u;
    tank_a_diff1_position_ = 0u;
    tank_a_delay1_position_ = 0u;
    tank_a_diff2_position_ = 0u;
    tank_a_delay2_position_ = 0u;
    tank_b_diff1_position_ = 0u;
    tank_b_delay1_position_ = 0u;
    tank_b_diff2_position_ = 0u;
    tank_b_delay2_position_ = 0u;
    input_lpf_state_ = 0.0;
    tank_a_damp_state_ = 0.0;
    tank_b_damp_state_ = 0.0;
    tank_a_output_ = 0.0;
    tank_b_output_ = 0.0;
    lfo_phase1_ = 0.0;
    lfo_phase2_ = kHalfPi;
    tank_a_interpolation_state_ = 0.0;
    tank_b_interpolation_state_ = 0.0;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    const double scale = sample_rate_ / kDattorroSampleRate;
    const double bandwidth = static_cast<double>(params_.bandwidth);
    const double input_diffusion1 = static_cast<double>(params_.inputDiffusion1);
    const double input_diffusion2 = static_cast<double>(params_.inputDiffusion2);
    const double decay = static_cast<double>(params_.decay);
    const double decay_diffusion1 = static_cast<double>(params_.decayDiffusion1);
    double decay_diffusion2 = decay + 0.15;
    if (decay_diffusion2 < 0.25)
      decay_diffusion2 = 0.25;
    if (decay_diffusion2 > 0.5)
      decay_diffusion2 = 0.5;
    const double damping = static_cast<double>(params_.damping);
    const double one_minus_damping = 1.0 - damping;
    const double modulation_depth = static_cast<double>(params_.modulationDepth) * scale;
    const double lfo_increment =
        kTwoPi * static_cast<double>(params_.modulationRate) / sample_rate_;
    const double wet_mix = static_cast<double>(params_.wetMix) * 0.01;
    const double dry_mix = static_cast<double>(params_.dryMix) * 0.01;
    const double pre_delay_value = static_cast<double>(params_.preDelay) * sample_rate_ * 0.001;
    const std::uint32_t pre_delay_samples =
        pre_delay_value > 0.0 ? static_cast<std::uint32_t>(pre_delay_value) : 0u;

    std::uint32_t pre_delay_position = pre_delay_position_;
    std::uint32_t input_diff0_position = input_diff0_position_;
    std::uint32_t input_diff1_position = input_diff1_position_;
    std::uint32_t input_diff2_position = input_diff2_position_;
    std::uint32_t input_diff3_position = input_diff3_position_;
    std::uint32_t tank_a_diff1_position = tank_a_diff1_position_;
    std::uint32_t tank_a_delay1_position = tank_a_delay1_position_;
    std::uint32_t tank_a_diff2_position = tank_a_diff2_position_;
    std::uint32_t tank_a_delay2_position = tank_a_delay2_position_;
    std::uint32_t tank_b_diff1_position = tank_b_diff1_position_;
    std::uint32_t tank_b_delay1_position = tank_b_delay1_position_;
    std::uint32_t tank_b_diff2_position = tank_b_diff2_position_;
    std::uint32_t tank_b_delay2_position = tank_b_delay2_position_;
    double input_lpf_state = input_lpf_state_;
    double tank_a_damp_state = tank_a_damp_state_;
    double tank_b_damp_state = tank_b_damp_state_;
    double tank_a_output = tank_a_output_;
    double tank_b_output = tank_b_output_;
    double lfo_phase1 = lfo_phase1_;
    double lfo_phase2 = lfo_phase2_;
    double tank_a_interpolation_state = tank_a_interpolation_state_;
    double tank_b_interpolation_state = tank_b_interpolation_state_;
    const std::uint32_t tank_a_diff1_length = static_cast<std::uint32_t>(tank_a_diff1_.size());
    const std::uint32_t tank_b_diff1_length = static_cast<std::uint32_t>(tank_b_diff1_.size());

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      double input = 0.0;
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        input +=
            static_cast<double>(audio[static_cast<std::size_t>(channel) * frame_count + frame]);
      }
      input /= static_cast<double>(channel_count);

      double signal = input;
      if (pre_delay_samples > 0u && pre_delay_samples < pre_delay_size_) {
        std::int64_t read = static_cast<std::int64_t>(pre_delay_position) -
                            static_cast<std::int64_t>(pre_delay_samples);
        if (read < 0)
          read += static_cast<std::int64_t>(pre_delay_size_);
        signal = static_cast<double>(pre_delay_[static_cast<std::size_t>(read)]);
      }
      pre_delay_[pre_delay_position] = static_cast<float>(input);
      ++pre_delay_position;
      if (pre_delay_position >= pre_delay_size_)
        pre_delay_position = 0u;

      input_lpf_state += bandwidth * (signal - input_lpf_state);
      signal = input_lpf_state;
      signal = processInputDiffuser(signal, input_diffusion1, input_diff0_, input_diff0_position,
                                    input_diff0_size_);
      signal = processInputDiffuser(signal, input_diffusion1, input_diff1_, input_diff1_position,
                                    input_diff1_size_);
      signal = processInputDiffuser(signal, input_diffusion2, input_diff2_, input_diff2_position,
                                    input_diff2_size_);
      signal = processInputDiffuser(signal, input_diffusion2, input_diff3_, input_diff3_position,
                                    input_diff3_size_);

      lfo_phase1 += lfo_increment;
      lfo_phase2 += lfo_increment;
      if (lfo_phase1 >= kTwoPi)
        lfo_phase1 -= kTwoPi;
      if (lfo_phase2 >= kTwoPi)
        lfo_phase2 -= kTwoPi;
      const double lfo1 = std::sin(lfo_phase1) * modulation_depth;
      const double lfo2 = std::sin(lfo_phase2) * modulation_depth;
      const double previous_a = tank_a_output;
      const double previous_b = tank_b_output;

      const double tank_a_input = signal + decay * previous_b;
      const double tank_a_delayed =
          modulatedDelay(tank_a_diff1_, tank_a_diff1_position, tank_a_diff1_size_, lfo1,
                         tank_a_interpolation_state);
      const double tank_a_diff1_temp = tank_a_input + decay_diffusion1 * tank_a_delayed;
      tank_a_diff1_[tank_a_diff1_position] = static_cast<float>(tank_a_diff1_temp);
      const double tank_a_diff1_output = tank_a_delayed - decay_diffusion1 * tank_a_diff1_temp;
      increment(tank_a_diff1_position, tank_a_diff1_length);
      const double tank_a_delay1_output =
          static_cast<double>(tank_a_delay1_[tank_a_delay1_position]);
      tank_a_delay1_[tank_a_delay1_position] = static_cast<float>(tank_a_diff1_output);
      increment(tank_a_delay1_position, tank_a_delay1_size_);
      tank_a_damp_state += one_minus_damping * (tank_a_delay1_output - tank_a_damp_state);
      const double tank_a_damped = tank_a_damp_state * decay;
      const double tank_a_diff2_delayed = static_cast<double>(tank_a_diff2_[tank_a_diff2_position]);
      const double tank_a_diff2_temp = tank_a_damped - decay_diffusion2 * tank_a_diff2_delayed;
      tank_a_diff2_[tank_a_diff2_position] = static_cast<float>(tank_a_diff2_temp);
      const double tank_a_diff2_output =
          tank_a_diff2_delayed + decay_diffusion2 * tank_a_diff2_temp;
      increment(tank_a_diff2_position, tank_a_diff2_size_);
      tank_a_output = static_cast<double>(tank_a_delay2_[tank_a_delay2_position]);
      tank_a_delay2_[tank_a_delay2_position] = static_cast<float>(tank_a_diff2_output);
      increment(tank_a_delay2_position, tank_a_delay2_size_);

      const double tank_b_input = signal + decay * previous_a;
      const double tank_b_delayed =
          modulatedDelay(tank_b_diff1_, tank_b_diff1_position, tank_b_diff1_size_, lfo2,
                         tank_b_interpolation_state);
      const double tank_b_diff1_temp = tank_b_input + decay_diffusion1 * tank_b_delayed;
      tank_b_diff1_[tank_b_diff1_position] = static_cast<float>(tank_b_diff1_temp);
      const double tank_b_diff1_output = tank_b_delayed - decay_diffusion1 * tank_b_diff1_temp;
      increment(tank_b_diff1_position, tank_b_diff1_length);
      const double tank_b_delay1_output =
          static_cast<double>(tank_b_delay1_[tank_b_delay1_position]);
      tank_b_delay1_[tank_b_delay1_position] = static_cast<float>(tank_b_diff1_output);
      increment(tank_b_delay1_position, tank_b_delay1_size_);
      tank_b_damp_state += one_minus_damping * (tank_b_delay1_output - tank_b_damp_state);
      const double tank_b_damped = tank_b_damp_state * decay;
      const double tank_b_diff2_delayed = static_cast<double>(tank_b_diff2_[tank_b_diff2_position]);
      const double tank_b_diff2_temp = tank_b_damped - decay_diffusion2 * tank_b_diff2_delayed;
      tank_b_diff2_[tank_b_diff2_position] = static_cast<float>(tank_b_diff2_temp);
      const double tank_b_diff2_output =
          tank_b_diff2_delayed + decay_diffusion2 * tank_b_diff2_temp;
      increment(tank_b_diff2_position, tank_b_diff2_size_);
      tank_b_output = static_cast<double>(tank_b_delay2_[tank_b_delay2_position]);
      tank_b_delay2_[tank_b_delay2_position] = static_cast<float>(tank_b_diff2_output);
      increment(tank_b_delay2_position, tank_b_delay2_size_);

      double left = 0.0;
      left +=
          tapped(tank_b_delay1_, tank_b_delay1_position, tap_l_b_delay1_266_, tank_b_delay1_size_);
      left +=
          tapped(tank_b_delay1_, tank_b_delay1_position, tap_l_b_delay1_2974_, tank_b_delay1_size_);
      left -= tapped(tank_b_diff2_, tank_b_diff2_position, tap_l_b_diff2_1913_, tank_b_diff2_size_);
      left +=
          tapped(tank_b_delay2_, tank_b_delay2_position, tap_l_b_delay2_1996_, tank_b_delay2_size_);
      left -=
          tapped(tank_a_delay1_, tank_a_delay1_position, tap_l_a_delay1_1990_, tank_a_delay1_size_);
      left -= tapped(tank_a_diff2_, tank_a_diff2_position, tap_l_a_diff2_187_, tank_a_diff2_size_);
      left -=
          tapped(tank_a_delay2_, tank_a_delay2_position, tap_l_a_delay2_1066_, tank_a_delay2_size_);

      double right = 0.0;
      right +=
          tapped(tank_a_delay1_, tank_a_delay1_position, tap_r_a_delay1_353_, tank_a_delay1_size_);
      right +=
          tapped(tank_a_delay1_, tank_a_delay1_position, tap_r_a_delay1_3627_, tank_a_delay1_size_);
      right -=
          tapped(tank_a_diff2_, tank_a_diff2_position, tap_r_a_diff2_1228_, tank_a_diff2_size_);
      right +=
          tapped(tank_a_delay2_, tank_a_delay2_position, tap_r_a_delay2_2673_, tank_a_delay2_size_);
      right -=
          tapped(tank_b_delay1_, tank_b_delay1_position, tap_r_b_delay1_2111_, tank_b_delay1_size_);
      right -= tapped(tank_b_diff2_, tank_b_diff2_position, tap_r_b_diff2_335_, tank_b_diff2_size_);
      right -=
          tapped(tank_b_delay2_, tank_b_delay2_position, tap_r_b_delay2_121_, tank_b_delay2_size_);
      left *= 0.6;
      right *= 0.6;

      if (channel_count == 1u) {
        const double dry = static_cast<double>(audio[frame]);
        audio[frame] = static_cast<float>(dry * dry_mix + (left + right) * 0.5 * wet_mix);
      } else {
        const std::size_t right_index = frame_count + frame;
        const double dry_left = static_cast<double>(audio[frame]);
        const double dry_right = static_cast<double>(audio[right_index]);
        audio[frame] = static_cast<float>(dry_left * dry_mix + left * wet_mix);
        audio[right_index] = static_cast<float>(dry_right * dry_mix + right * wet_mix);
      }
    }

    pre_delay_position_ = pre_delay_position;
    input_diff0_position_ = input_diff0_position;
    input_diff1_position_ = input_diff1_position;
    input_diff2_position_ = input_diff2_position;
    input_diff3_position_ = input_diff3_position;
    tank_a_diff1_position_ = tank_a_diff1_position;
    tank_a_delay1_position_ = tank_a_delay1_position;
    tank_a_diff2_position_ = tank_a_diff2_position;
    tank_a_delay2_position_ = tank_a_delay2_position;
    tank_b_diff1_position_ = tank_b_diff1_position;
    tank_b_delay1_position_ = tank_b_delay1_position;
    tank_b_diff2_position_ = tank_b_diff2_position;
    tank_b_delay2_position_ = tank_b_delay2_position;
    input_lpf_state_ = input_lpf_state;
    tank_a_damp_state_ = tank_a_damp_state;
    tank_b_damp_state_ = tank_b_damp_state;
    tank_a_output_ = tank_a_output;
    tank_b_output_ = tank_b_output;
    lfo_phase1_ = lfo_phase1;
    lfo_phase2_ = lfo_phase2;
    tank_a_interpolation_state_ = tank_a_interpolation_state;
    tank_b_interpolation_state_ = tank_b_interpolation_state;
  }

private:
  static void clear(std::vector<float> &buffer) noexcept {
    std::fill(buffer.begin(), buffer.end(), 0.0F);
  }

  static void increment(std::uint32_t &position, std::uint32_t size) noexcept {
    ++position;
    if (position >= size)
      position = 0u;
  }

  static double processInputDiffuser(double signal, double coefficient, std::vector<float> &buffer,
                                     std::uint32_t &position, std::uint32_t size) noexcept {
    const double delayed = static_cast<double>(buffer[position]);
    const double temporary = signal - coefficient * delayed;
    buffer[position] = static_cast<float>(temporary);
    const double output = delayed + coefficient * temporary;
    increment(position, size);
    return output;
  }

  static double modulatedDelay(const std::vector<float> &buffer, std::uint32_t position,
                               std::uint32_t nominal_size, double modulation,
                               double &interpolation_state) noexcept {
    const double delay = static_cast<double>(nominal_size) + modulation;
    const std::int32_t integer_delay = static_cast<std::int32_t>(delay);
    const double fraction = delay - static_cast<double>(integer_delay);
    const double alpha = (1.0 - fraction) / (1.0 + fraction);
    const std::int64_t length = static_cast<std::int64_t>(buffer.size());
    std::int64_t index = static_cast<std::int64_t>(position) - integer_delay;
    if (index < 0)
      index += length;
    std::int64_t previous = index - 1;
    if (previous < 0)
      previous += length;
    const double current_sample = static_cast<double>(buffer[static_cast<std::size_t>(index)]);
    const double previous_sample = static_cast<double>(buffer[static_cast<std::size_t>(previous)]);
    const double delayed = alpha * current_sample + previous_sample - alpha * interpolation_state;
    interpolation_state = delayed;
    return delayed;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t pre_delay_size_ = 1u;
  std::uint32_t input_diff0_size_ = 1u;
  std::uint32_t input_diff1_size_ = 1u;
  std::uint32_t input_diff2_size_ = 1u;
  std::uint32_t input_diff3_size_ = 1u;
  std::uint32_t tank_a_diff1_size_ = 1u;
  std::uint32_t tank_a_delay1_size_ = 1u;
  std::uint32_t tank_a_diff2_size_ = 1u;
  std::uint32_t tank_a_delay2_size_ = 1u;
  std::uint32_t tank_b_diff1_size_ = 1u;
  std::uint32_t tank_b_delay1_size_ = 1u;
  std::uint32_t tank_b_diff2_size_ = 1u;
  std::uint32_t tank_b_delay2_size_ = 1u;
  std::uint32_t pre_delay_position_ = 0u;
  std::uint32_t input_diff0_position_ = 0u;
  std::uint32_t input_diff1_position_ = 0u;
  std::uint32_t input_diff2_position_ = 0u;
  std::uint32_t input_diff3_position_ = 0u;
  std::uint32_t tank_a_diff1_position_ = 0u;
  std::uint32_t tank_a_delay1_position_ = 0u;
  std::uint32_t tank_a_diff2_position_ = 0u;
  std::uint32_t tank_a_delay2_position_ = 0u;
  std::uint32_t tank_b_diff1_position_ = 0u;
  std::uint32_t tank_b_delay1_position_ = 0u;
  std::uint32_t tank_b_diff2_position_ = 0u;
  std::uint32_t tank_b_delay2_position_ = 0u;
  std::uint32_t tap_l_b_delay1_266_ = 1u;
  std::uint32_t tap_l_b_delay1_2974_ = 1u;
  std::uint32_t tap_l_b_diff2_1913_ = 1u;
  std::uint32_t tap_l_b_delay2_1996_ = 1u;
  std::uint32_t tap_l_a_delay1_1990_ = 1u;
  std::uint32_t tap_l_a_diff2_187_ = 1u;
  std::uint32_t tap_l_a_delay2_1066_ = 1u;
  std::uint32_t tap_r_a_delay1_353_ = 1u;
  std::uint32_t tap_r_a_delay1_3627_ = 1u;
  std::uint32_t tap_r_a_diff2_1228_ = 1u;
  std::uint32_t tap_r_a_delay2_2673_ = 1u;
  std::uint32_t tap_r_b_delay1_2111_ = 1u;
  std::uint32_t tap_r_b_diff2_335_ = 1u;
  std::uint32_t tap_r_b_delay2_121_ = 1u;
  double input_lpf_state_ = 0.0;
  double tank_a_damp_state_ = 0.0;
  double tank_b_damp_state_ = 0.0;
  double tank_a_output_ = 0.0;
  double tank_b_output_ = 0.0;
  double lfo_phase1_ = 0.0;
  double lfo_phase2_ = kHalfPi;
  double tank_a_interpolation_state_ = 0.0;
  double tank_b_interpolation_state_ = 0.0;
  std::vector<float> pre_delay_;
  std::vector<float> input_diff0_;
  std::vector<float> input_diff1_;
  std::vector<float> input_diff2_;
  std::vector<float> input_diff3_;
  std::vector<float> tank_a_diff1_;
  std::vector<float> tank_a_delay1_;
  std::vector<float> tank_a_diff2_;
  std::vector<float> tank_a_delay2_;
  std::vector<float> tank_b_diff1_;
  std::vector<float> tank_b_delay1_;
  std::vector<float> tank_b_diff2_;
  std::vector<float> tank_b_delay2_;
};

static_assert(sizeof(DattorroPlateReverbKernel) <= 8192u);

} // namespace effetune::plugins::reverb

EFFETUNE_REGISTER_KERNEL(DattorroPlateReverbPlugin,
                         effetune::plugins::reverb::DattorroPlateReverbKernel)

#include "effetune/kernel.h"
#include "DynamicSaturationPluginParams.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::saturation {

class DynamicSaturationKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::DynamicSaturationPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    positions_.resize(max_channels_);
    velocities_.resize(max_channels_);
  }

  void reset() noexcept override {
    clearState();
    initialized_ = false;
    controls_initialized_ = false;
    last_channel_count_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }
    if (!initialized_ || last_channel_count_ != channel_count) {
      clearState();
      initialized_ = true;
      last_channel_count_ = channel_count;
    }

    const double speaker_drive = static_cast<double>(params_.speakerDrive);
    const double stiffness = static_cast<double>(params_.speakerStiffness);
    const double damping = static_cast<double>(params_.speakerDamping);
    const double inverse_mass = 1.0 / static_cast<double>(params_.speakerMass);
    prepareControlRamps();
    const bool controls_ramping = distortion_drive_.active() || distortion_bias_.active() ||
                                  distortion_mix_.active() || cone_mix_.active() ||
                                  output_gain_.active();
    const double stable_distortion_drive = distortion_drive_.current;
    const double stable_bias = distortion_bias_.current;
    const double stable_distortion_mix = distortion_mix_.current * 0.01;
    const double stable_cone_mix = cone_mix_.current * 0.01;
    const double stable_output_gain = std::pow(10.0, output_gain_.current * 0.05);
    const double stable_bias_term = std::tanh(stable_distortion_drive * stable_bias);
    const double time_step = 48000.0 / sample_rate_;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      double position = static_cast<double>(positions_[channel]);
      double velocity = static_cast<double>(velocities_[channel]);
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double distortion_drive =
            controls_ramping ? distortion_drive_.value(frame) : stable_distortion_drive;
        const double bias = controls_ramping ? distortion_bias_.value(frame) : stable_bias;
        const double distortion_mix =
            controls_ramping ? distortion_mix_.value(frame) * 0.01 : stable_distortion_mix;
        const double cone_mix = controls_ramping ? cone_mix_.value(frame) * 0.01 : stable_cone_mix;
        const double output_gain = controls_ramping
                                       ? std::pow(10.0, output_gain_.value(frame) * 0.05)
                                       : stable_output_gain;
        const double bias_term =
            controls_ramping ? std::tanh(distortion_drive * bias) : stable_bias_term;
        const double input = static_cast<double>(audio[offset + frame]);
        const double force = speaker_drive * input - stiffness * position - damping * velocity;
        const double acceleration = force * inverse_mass;

        const double velocity_magnitude = velocity >= 0.0 ? velocity : -velocity;
        const double scaled_velocity = velocity_magnitude * 10.0;
        const double maximum_acceleration = scaled_velocity > 1000.0 ? scaled_velocity : 1000.0;
        double clamped_acceleration = acceleration;
        if (clamped_acceleration < -maximum_acceleration) {
          clamped_acceleration = -maximum_acceleration;
        } else if (clamped_acceleration > maximum_acceleration) {
          clamped_acceleration = maximum_acceleration;
        }

        double new_velocity = velocity + clamped_acceleration * time_step;
        double new_position = position + new_velocity * time_step;
        const double input_magnitude = input >= 0.0 ? input : -input;
        const double scaled_position = input_magnitude * 2.0;
        const double maximum_position = scaled_position > 10.0 ? scaled_position : 10.0;
        const double scaled_input_velocity = input_magnitude * 100.0;
        const double maximum_velocity =
            scaled_input_velocity > 1000.0 ? scaled_input_velocity : 1000.0;
        if (new_position < -maximum_position) {
          new_position = -maximum_position;
        } else if (new_position > maximum_position) {
          new_position = maximum_position;
        }
        if (new_velocity < -maximum_velocity) {
          new_velocity = -maximum_velocity;
        } else if (new_velocity > maximum_velocity) {
          new_velocity = maximum_velocity;
        }
        position = new_position;
        velocity = new_velocity;

        const double wet_distortion = std::tanh(distortion_drive * (position + bias)) - bias_term;
        const double nonlinear_position = position + distortion_mix * (wet_distortion - position);
        const double cone_delta = (nonlinear_position - position) * cone_mix;
        audio[offset + frame] = static_cast<float>((input + cone_delta) * output_gain);
      }
      positions_[channel] = static_cast<float>(position);
      velocities_[channel] = static_cast<float>(velocity);
    }

    distortion_drive_.advance(frame_count);
    distortion_bias_.advance(frame_count);
    distortion_mix_.advance(frame_count);
    cone_mix_.advance(frame_count);
    output_gain_.advance(frame_count);
  }

private:
  struct LinearRamp {
    double current = 0.0;
    double target = 0.0;
    double step = 0.0;
    std::uint32_t remaining = 0u;
    void snap(double value) noexcept {
      current = target = value;
      step = 0.0;
      remaining = 0u;
    }
    void retarget(double value, std::uint32_t frames) noexcept {
      if (value == target)
        return;
      target = value;
      remaining = frames;
      step = (target - current) / static_cast<double>(frames);
    }
    [[nodiscard]] bool active() const noexcept { return remaining != 0u; }
    [[nodiscard]] double value(std::uint32_t frame) const noexcept {
      const std::uint32_t elapsed = frame + 1u;
      return elapsed >= remaining ? target : current + step * static_cast<double>(elapsed);
    }
    void advance(std::uint32_t frames) noexcept {
      if (frames >= remaining) {
        current = target;
        remaining = 0u;
        step = 0.0;
      } else {
        current += step * static_cast<double>(frames);
        remaining -= frames;
      }
    }
  };

  void prepareControlRamps() noexcept {
    const double drive = static_cast<double>(params_.distortionDrive);
    const double bias = static_cast<double>(params_.distortionBias);
    const double distortion_mix = static_cast<double>(params_.distortionMix);
    const double cone_mix = static_cast<double>(params_.coneMotionMix);
    const double output_gain = static_cast<double>(params_.outputGain);
    if (!controls_initialized_) {
      distortion_drive_.snap(drive);
      distortion_bias_.snap(bias);
      distortion_mix_.snap(distortion_mix);
      cone_mix_.snap(cone_mix);
      output_gain_.snap(output_gain);
      controls_initialized_ = true;
      return;
    }
    const auto frames = static_cast<std::uint32_t>(std::max(1.0, std::ceil(sample_rate_ * 0.005)));
    distortion_drive_.retarget(drive, frames);
    distortion_bias_.retarget(bias, frames);
    distortion_mix_.retarget(distortion_mix, frames);
    cone_mix_.retarget(cone_mix, frames);
    output_gain_.retarget(output_gain, frames);
  }

  void clearState() noexcept {
    for (float &position : positions_) {
      position = 0.0F;
    }
    for (float &velocity : velocities_) {
      velocity = 0.0F;
    }
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool initialized_ = false;
  bool controls_initialized_ = false;
  std::vector<float> positions_;
  std::vector<float> velocities_;
  LinearRamp distortion_drive_;
  LinearRamp distortion_bias_;
  LinearRamp distortion_mix_;
  LinearRamp cone_mix_;
  LinearRamp output_gain_;
};

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(DynamicSaturationPlugin,
                         effetune::plugins::saturation::DynamicSaturationKernel)

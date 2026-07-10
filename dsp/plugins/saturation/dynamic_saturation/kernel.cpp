#include "effetune/kernel.h"
#include "DynamicSaturationPluginParams.h"

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
    const double distortion_drive = static_cast<double>(params_.distortionDrive);
    const double bias = static_cast<double>(params_.distortionBias);
    const double distortion_mix = static_cast<double>(params_.distortionMix) * 0.01;
    const double cone_mix = static_cast<double>(params_.coneMotionMix) * 0.01;
    const double output_gain = std::pow(10.0, static_cast<double>(params_.outputGain) * 0.05);
    const double bias_term = std::tanh(distortion_drive * bias);
    const double time_step = 48000.0 / sample_rate_;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      double position = static_cast<double>(positions_[channel]);
      double velocity = static_cast<double>(velocities_[channel]);
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
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
  }

private:
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
  std::vector<float> positions_;
  std::vector<float> velocities_;
};

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(DynamicSaturationPlugin,
                         effetune::plugins::saturation::DynamicSaturationKernel)

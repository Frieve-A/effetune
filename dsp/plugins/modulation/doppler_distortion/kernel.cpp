#include "effetune/kernel.h"
#include "DopplerDistortionPluginParams.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::modulation {

class DopplerDistortionKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::DopplerDistortionPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    const double required = std::ceil(0.085 * sample_rate_);
    buffer_size_ = required > 256.0 ? static_cast<std::uint32_t>(required) : 256u;
    base_delay_samples_ = static_cast<double>(buffer_size_) / 2.0;
    delay_buffers_.resize(static_cast<std::size_t>(max_channels_) * buffer_size_);
    write_indices_.resize(max_channels_);
    speaker_positions_.resize(max_channels_);
    speaker_velocities_.resize(max_channels_);
    reset();
  }

  void reset() noexcept override {
    for (float &sample : delay_buffers_) {
      sample = 0.0F;
    }
    for (std::uint32_t &index : write_indices_) {
      index = 0u;
    }
    for (float &position : speaker_positions_) {
      position = 0.0F;
    }
    for (float &velocity : speaker_velocities_) {
      velocity = 0.0F;
    }
    last_channel_count_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || sample_rate_ <= 0.0 || buffer_size_ < 4u) {
      return;
    }
    if (channel_count != last_channel_count_) {
      resetAudioState();
      last_channel_count_ = channel_count;
    }

    constexpr double kSoundSpeed = 343.0;
    const double mass = static_cast<double>(params_.speakerMass) > 1.0e-6
                            ? static_cast<double>(params_.speakerMass)
                            : 1.0e-6;
    const double time_step = 1.0 / sample_rate_;
    const double half_time_step = 0.5 * time_step;
    const double maximum_delay = static_cast<double>(buffer_size_) - 1.00001;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t audio_offset = static_cast<std::size_t>(channel) * frame_count;
      const std::size_t delay_offset = static_cast<std::size_t>(channel) * buffer_size_;
      float *delay = delay_buffers_.data() + delay_offset;
      std::uint32_t write_index = write_indices_[channel];
      double position = static_cast<double>(speaker_positions_[channel]);
      double velocity = static_cast<double>(speaker_velocities_[channel]);

      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const std::size_t audio_index = audio_offset + frame;
        const double input = static_cast<double>(audio[audio_index]);
        const double signal_force = input * static_cast<double>(params_.coilForce);
        const double spring_force = -static_cast<double>(params_.springConstant) * position;
        const double damping_force = -static_cast<double>(params_.dampingFactor) * velocity;
        double total_force = signal_force + spring_force + damping_force;
        double acceleration = total_force / mass;
        const double half_step_velocity = velocity + acceleration * half_time_step;
        position += half_step_velocity * time_step;
        const double new_spring_force = -static_cast<double>(params_.springConstant) * position;
        const double new_damping_force =
            -static_cast<double>(params_.dampingFactor) * half_step_velocity;
        total_force = signal_force + new_spring_force + new_damping_force;
        acceleration = total_force / mass;
        velocity = half_step_velocity + acceleration * half_time_step;

        delay[write_index] = static_cast<float>(input);
        const double delay_offset_samples = (-position / kSoundSpeed) * sample_rate_;
        double total_delay = base_delay_samples_ + delay_offset_samples;
        if (total_delay < 0.0) {
          total_delay = 0.0;
        } else if (total_delay > maximum_delay) {
          total_delay = maximum_delay;
        }
        double read_index = static_cast<double>(write_index) - total_delay;
        read_index = std::fmod(read_index, static_cast<double>(buffer_size_));
        if (read_index < 0.0) {
          read_index += static_cast<double>(buffer_size_);
        }
        audio[audio_index] = static_cast<float>(interpolate(delay, read_index));
        ++write_index;
        if (write_index == buffer_size_) {
          write_index = 0u;
        }
      }

      write_indices_[channel] = write_index;
      speaker_positions_[channel] = static_cast<float>(position);
      speaker_velocities_[channel] = static_cast<float>(velocity);
    }
  }

private:
  [[nodiscard]] double interpolate(const float *buffer, double index) const noexcept {
    const std::uint32_t x0 = static_cast<std::uint32_t>(std::floor(index));
    const double fraction = index - static_cast<double>(x0);
    const std::uint32_t minus_one = x0 == 0u ? buffer_size_ - 1u : x0 - 1u;
    const std::uint32_t plus_one = x0 + 1u == buffer_size_ ? 0u : x0 + 1u;
    std::uint32_t plus_two = plus_one + 1u;
    if (plus_two == buffer_size_) {
      plus_two = 0u;
    }
    const double xm1 = static_cast<double>(buffer[minus_one]);
    const double x_0 = static_cast<double>(buffer[x0]);
    const double x_1 = static_cast<double>(buffer[plus_one]);
    const double x_2 = static_cast<double>(buffer[plus_two]);
    const double c0 = xm1 * (fraction - 1.0) * (fraction - 2.0) * fraction * (-1.0 / 6.0);
    const double c1 = x_0 * (fraction + 1.0) * (fraction - 1.0) * (fraction - 2.0) * (1.0 / 2.0);
    const double c2 = x_1 * (fraction + 1.0) * fraction * (fraction - 2.0) * (-1.0 / 2.0);
    const double c3 = x_2 * (fraction + 1.0) * fraction * (fraction - 1.0) * (1.0 / 6.0);
    return c0 + c1 + c2 + c3;
  }

  void resetAudioState() noexcept {
    for (float &sample : delay_buffers_) {
      sample = 0.0F;
    }
    for (std::uint32_t &index : write_indices_) {
      index = 0u;
    }
    for (float &position : speaker_positions_) {
      position = 0.0F;
    }
    for (float &velocity : speaker_velocities_) {
      velocity = 0.0F;
    }
  }

  std::vector<float> delay_buffers_;
  std::vector<std::uint32_t> write_indices_;
  std::vector<float> speaker_positions_;
  std::vector<float> speaker_velocities_;
  double sample_rate_ = 0.0;
  double base_delay_samples_ = 0.0;
  std::uint32_t buffer_size_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
};

static_assert(sizeof(DopplerDistortionKernel) <= 8192u);

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(DopplerDistortionPlugin,
                         effetune::plugins::modulation::DopplerDistortionKernel)

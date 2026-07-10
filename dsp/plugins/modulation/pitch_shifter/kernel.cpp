#include "effetune/kernel.h"
#include "PitchShifterPluginParams.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::modulation {
namespace {

constexpr double kMaximumWindowMilliseconds = 500.0;

} // namespace

class PitchShifterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::PitchShifterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    const double maximum_window = kMaximumWindowMilliseconds * sample_rate_ / 1000.0;
    max_window_size_ = maximum_window > 0.0 ? static_cast<std::uint32_t>(maximum_window) : 0u;
    max_buffer_size_ = max_window_size_ * 3u;

    const std::size_t channels = static_cast<std::size_t>(max_channels_);
    input_buffers_.resize(channels * max_window_size_);
    output_buffers_.resize(channels * max_buffer_size_);
    windowed_frames_.resize(channels * max_window_size_);
    final_output_.resize(channels * max_frames_);
    input_write_indices_.resize(max_channels_);
    process_counters_.resize(max_channels_);
    output_write_indices_.resize(max_channels_);
    output_read_positions_.resize(max_channels_);
    reset();
  }

  void reset() noexcept override {
    std::fill(input_buffers_.begin(), input_buffers_.end(), 0.0F);
    std::fill(output_buffers_.begin(), output_buffers_.end(), 0.0F);
    std::fill(windowed_frames_.begin(), windowed_frames_.end(), 0.0F);
    std::fill(final_output_.begin(), final_output_.end(), 0.0F);
    clearIndices();
    configured_ = false;
    current_channel_count_ = 0u;
    current_window_size_ = 0u;
    current_hop_size_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    double pitch_factor = 1.0;
    if (params_.pitchShift != 0.0F || params_.fineTune != 0.0F) {
      const double exponent = static_cast<double>(params_.pitchShift) / 12.0 +
                              static_cast<double>(params_.fineTune) / 1200.0;
      pitch_factor = std::pow(2.0, exponent);
      if (!(pitch_factor > 0.0 && std::isfinite(pitch_factor))) {
        pitch_factor = 1.0;
      }
    }
    if (pitch_factor == 1.0) {
      return;
    }

    const double raw_window = static_cast<double>(params_.windowSize) * sample_rate_ / 1000.0;
    if (!(raw_window > 0.0)) {
      return;
    }
    const std::uint32_t window_size = static_cast<std::uint32_t>(raw_window);
    if (window_size == 0u || window_size > max_window_size_) {
      return;
    }

    const double raw_hop = static_cast<double>(params_.crossfadeTime) * sample_rate_ / 1000.0;
    const std::int32_t requested_hop = static_cast<std::int32_t>(raw_hop);
    const std::uint32_t hop_size =
        requested_hop > 0 && static_cast<std::uint32_t>(requested_hop) < window_size
            ? static_cast<std::uint32_t>(requested_hop)
            : window_size / 2u;
    if (hop_size == 0u) {
      return;
    }
    const std::uint32_t buffer_size = window_size * 3u;

    if (!configured_ || current_channel_count_ != channel_count ||
        current_window_size_ != window_size || current_hop_size_ != hop_size) {
      resetForShape(channel_count, window_size, hop_size);
    }

    const double inverse_hop_size = 1.0 / static_cast<double>(hop_size);
    const double target_unread = static_cast<double>(hop_size) * pitch_factor + 1.0;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      float *input_buffer =
          input_buffers_.data() + static_cast<std::size_t>(channel) * max_window_size_;
      float *output_buffer =
          output_buffers_.data() + static_cast<std::size_t>(channel) * max_buffer_size_;
      float *windowed_frame =
          windowed_frames_.data() + static_cast<std::size_t>(channel) * max_window_size_;
      std::uint32_t input_write_index = input_write_indices_[channel];
      std::uint32_t process_counter = process_counters_[channel];
      std::uint32_t output_write_index = output_write_indices_[channel];
      const std::size_t input_offset = static_cast<std::size_t>(channel) * frame_count;

      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        input_buffer[input_write_index] = audio[input_offset + frame];
        ++input_write_index;
        if (input_write_index == window_size) {
          input_write_index = 0u;
        }
        ++process_counter;

        const std::uint32_t floor_read_position =
            static_cast<std::uint32_t>(output_read_positions_[channel]);
        std::int32_t unread = static_cast<std::int32_t>(output_write_index) -
                              static_cast<std::int32_t>(floor_read_position);
        if (unread < 0) {
          unread += static_cast<std::int32_t>(buffer_size);
        }

        while (static_cast<double>(unread) < target_unread && process_counter >= window_size) {
          for (std::uint32_t index = 0u; index < window_size; ++index) {
            std::uint32_t read_index = input_write_index + index;
            if (read_index >= window_size) {
              read_index -= window_size;
            }
            double window_gain;
            if (index < hop_size) {
              window_gain = std::sqrt(static_cast<double>(index + 1u) * inverse_hop_size);
            } else if (index < window_size - hop_size) {
              window_gain = 1.0;
            } else {
              window_gain = std::sqrt(static_cast<double>(window_size - index) * inverse_hop_size);
            }
            windowed_frame[index] =
                static_cast<float>(static_cast<double>(input_buffer[read_index]) * window_gain);
          }

          for (std::uint32_t index = 0u; index < window_size; ++index) {
            std::uint32_t write_index = output_write_index + index;
            if (write_index >= buffer_size) {
              write_index -= buffer_size;
            }
            if (index < hop_size) {
              output_buffer[write_index] =
                  static_cast<float>(static_cast<double>(output_buffer[write_index]) +
                                     static_cast<double>(windowed_frame[index]));
            } else {
              output_buffer[write_index] = windowed_frame[index];
            }
          }

          output_write_index += window_size - hop_size;
          if (output_write_index >= buffer_size) {
            output_write_index -= buffer_size;
          }
          process_counter -= hop_size;

          const std::uint32_t current_floor_read_position =
              static_cast<std::uint32_t>(output_read_positions_[channel]);
          unread = static_cast<std::int32_t>(output_write_index) -
                   static_cast<std::int32_t>(current_floor_read_position);
          if (unread < 0) {
            unread += static_cast<std::int32_t>(buffer_size);
          }
        }
      }

      input_write_indices_[channel] = input_write_index;
      process_counters_[channel] = process_counter;
      output_write_indices_[channel] = output_write_index;
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const float *output_buffer =
          output_buffers_.data() + static_cast<std::size_t>(channel) * max_buffer_size_;
      const std::size_t output_offset = static_cast<std::size_t>(channel) * frame_count;
      double read_position = output_read_positions_[channel];
      if (!(read_position >= 0.0 && read_position < static_cast<double>(buffer_size))) {
        read_position = 0.0;
      }

      // Both JavaScript unread branches interpolate the ring, including old data.
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const std::uint32_t first = static_cast<std::uint32_t>(read_position);
        const double fraction = read_position - static_cast<double>(first);
        const std::uint32_t second = first + 1u == buffer_size ? 0u : first + 1u;
        const double sample1 = static_cast<double>(output_buffer[first]);
        const double sample2 = static_cast<double>(output_buffer[second]);
        final_output_[output_offset + frame] =
            static_cast<float>(sample1 + (sample2 - sample1) * fraction);

        read_position += pitch_factor;
        while (read_position >= static_cast<double>(buffer_size)) {
          read_position -= static_cast<double>(buffer_size);
        }
      }
      output_read_positions_[channel] = read_position;
    }

    const std::size_t sample_count = static_cast<std::size_t>(channel_count) * frame_count;
    for (std::size_t index = 0u; index < sample_count; ++index) {
      audio[index] = final_output_[index];
    }
  }

private:
  void clearIndices() noexcept {
    std::fill(input_write_indices_.begin(), input_write_indices_.end(), 0u);
    std::fill(process_counters_.begin(), process_counters_.end(), 0u);
    std::fill(output_write_indices_.begin(), output_write_indices_.end(), 0u);
    std::fill(output_read_positions_.begin(), output_read_positions_.end(), 0.0);
  }

  void resetForShape(std::uint32_t channel_count, std::uint32_t window_size,
                     std::uint32_t hop_size) noexcept {
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t input_offset = static_cast<std::size_t>(channel) * max_window_size_;
      const std::size_t output_offset = static_cast<std::size_t>(channel) * max_buffer_size_;
      std::fill_n(input_buffers_.begin() + input_offset, window_size, 0.0F);
      std::fill_n(windowed_frames_.begin() + input_offset, window_size, 0.0F);
      std::fill_n(output_buffers_.begin() + output_offset, window_size * 3u, 0.0F);
    }
    clearIndices();
    current_channel_count_ = channel_count;
    current_window_size_ = window_size;
    current_hop_size_ = hop_size;
    configured_ = true;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t max_window_size_ = 0u;
  std::uint32_t max_buffer_size_ = 0u;
  std::uint32_t current_channel_count_ = 0u;
  std::uint32_t current_window_size_ = 0u;
  std::uint32_t current_hop_size_ = 0u;
  bool configured_ = false;
  std::vector<float> input_buffers_;
  std::vector<float> output_buffers_;
  std::vector<float> windowed_frames_;
  std::vector<float> final_output_;
  std::vector<std::uint32_t> input_write_indices_;
  std::vector<std::uint32_t> process_counters_;
  std::vector<std::uint32_t> output_write_indices_;
  std::vector<double> output_read_positions_;
};

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(PitchShifterPlugin, effetune::plugins::modulation::PitchShifterKernel)

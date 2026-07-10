#ifndef EFFETUNE_DSP_DELAY_LINE_H
#define EFFETUNE_DSP_DELAY_LINE_H

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace effetune::dsp {

// A channel-major circular delay line. prepare() is the only allocating operation.
class DelayLine final {
public:
  [[nodiscard]] bool prepare(std::uint32_t channel_count, std::uint32_t max_delay_samples) {
    if (channel_count == 0U || max_delay_samples == std::numeric_limits<std::uint32_t>::max()) {
      clearStorage();
      return false;
    }

    const std::size_t length = static_cast<std::size_t>(max_delay_samples) + 1U;
    const std::size_t channels = static_cast<std::size_t>(channel_count);
    if (length > std::numeric_limits<std::size_t>::max() / channels) {
      clearStorage();
      return false;
    }

    channel_count_ = channel_count;
    max_delay_samples_ = max_delay_samples;
    length_ = length;
    samples_.assign(channels * length, 0.0F);
    write_indices_.assign(channels, 0U);
    return true;
  }

  void reset() noexcept {
    std::fill(samples_.begin(), samples_.end(), 0.0F);
    std::fill(write_indices_.begin(), write_indices_.end(), 0U);
  }

  void clearChannel(std::uint32_t channel) noexcept {
    if (channel >= channel_count_) {
      return;
    }
    const std::size_t offset = static_cast<std::size_t>(channel) * length_;
    std::fill(samples_.begin() + static_cast<std::ptrdiff_t>(offset),
              samples_.begin() + static_cast<std::ptrdiff_t>(offset + length_), 0.0F);
    write_indices_[channel] = 0U;
  }

  void push(std::uint32_t channel, float sample) noexcept {
    if (channel >= channel_count_ || length_ == 0U) {
      return;
    }
    std::size_t &write_index = write_indices_[channel];
    samples_[static_cast<std::size_t>(channel) * length_ + write_index] = sample;
    ++write_index;
    if (write_index == length_) {
      write_index = 0U;
    }
  }

  [[nodiscard]] float read(std::uint32_t channel, std::uint32_t delay_samples) const noexcept {
    if (channel >= channel_count_ || length_ == 0U) {
      return 0.0F;
    }
    const std::uint32_t delay =
        delay_samples > max_delay_samples_ ? max_delay_samples_ : delay_samples;
    return sampleAt(channel, static_cast<std::size_t>(delay));
  }

  [[nodiscard]] float readLinear(std::uint32_t channel, double delay_samples) const noexcept {
    if (channel >= channel_count_ || length_ == 0U) {
      return 0.0F;
    }
    if (!(delay_samples > 0.0)) {
      delay_samples = 0.0;
    }
    const double maximum = static_cast<double>(max_delay_samples_);
    if (delay_samples > maximum) {
      delay_samples = maximum;
    }

    const auto newer_delay = static_cast<std::size_t>(delay_samples);
    const double fraction = delay_samples - static_cast<double>(newer_delay);
    const float newer = sampleAt(channel, newer_delay);
    if (!(fraction > 0.0)) {
      return newer;
    }
    const float older = sampleAt(channel, newer_delay + 1U);
    return static_cast<float>(static_cast<double>(newer) +
                              (static_cast<double>(older) - newer) * fraction);
  }

  [[nodiscard]] std::uint32_t channelCount() const noexcept { return channel_count_; }
  [[nodiscard]] std::uint32_t maxDelaySamples() const noexcept { return max_delay_samples_; }

private:
  [[nodiscard]] float sampleAt(std::uint32_t channel, std::size_t delay_samples) const noexcept {
    const std::size_t write_index = write_indices_[channel];
    const std::size_t wrapped_delay = delay_samples % length_;
    const std::size_t read_index = (write_index + length_ - 1U - wrapped_delay) % length_;
    return samples_[static_cast<std::size_t>(channel) * length_ + read_index];
  }

  void clearStorage() {
    channel_count_ = 0U;
    max_delay_samples_ = 0U;
    length_ = 0U;
    samples_.clear();
    write_indices_.clear();
  }

  std::uint32_t channel_count_ = 0U;
  std::uint32_t max_delay_samples_ = 0U;
  std::size_t length_ = 0U;
  std::vector<float> samples_;
  std::vector<std::size_t> write_indices_;
};

} // namespace effetune::dsp

#endif

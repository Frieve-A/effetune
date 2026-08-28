#ifndef EFFETUNE_DSP_DELAY_LINE_H
#define EFFETUNE_DSP_DELAY_LINE_H

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <new>
#include <utility>

namespace effetune::dsp {

// A channel-major circular delay line. Only preparation and copying allocate.
class DelayLine final {
public:
  DelayLine() = default;
  DelayLine(const DelayLine &other)
      : channel_count_(other.channel_count_), max_delay_samples_(other.max_delay_samples_),
        length_(other.length_),
        samples_(other.samples_ ? new float[static_cast<std::size_t>(channel_count_) * length_]
                                : nullptr),
        write_indices_(other.write_indices_ ? new std::size_t[channel_count_] : nullptr) {
    std::copy_n(other.samples_.get(), static_cast<std::size_t>(channel_count_) * length_,
                samples_.get());
    std::copy_n(other.write_indices_.get(), channel_count_, write_indices_.get());
  }
  DelayLine &operator=(const DelayLine &other) {
    if (this != &other) {
      DelayLine copy(other);
      swap(copy);
    }
    return *this;
  }
  DelayLine(DelayLine &&other) noexcept { swap(other); }
  DelayLine &operator=(DelayLine &&other) noexcept {
    DelayLine moved(std::move(other));
    swap(moved);
    return *this;
  }

  [[nodiscard]] bool prepare(std::uint32_t channel_count, std::uint32_t max_delay_samples) {
    return prepareStorage(channel_count, max_delay_samples, false);
  }

  // Explicit failure-returning allocation for plans prepared outside the audio thread.
  [[nodiscard]] bool prepareNothrow(std::uint32_t channel_count,
                                    std::uint32_t max_delay_samples) noexcept {
    return prepareStorage(channel_count, max_delay_samples, true);
  }

  void reset() noexcept {
    std::fill_n(samples_.get(), static_cast<std::size_t>(channel_count_) * length_, 0.0F);
    std::fill_n(write_indices_.get(), channel_count_, 0U);
  }

  // Copy the available recent history into already prepared storage. Older samples
  // beyond the source capacity remain zero. Neither operation allocates or frees.
  void copyHistoryFrom(const DelayLine &source) noexcept {
    if (this == &source) {
      return;
    }
    reset();
    const std::uint32_t channels = std::min(channel_count_, source.channel_count_);
    const std::size_t count = std::min(length_, source.length_);
    for (std::uint32_t channel = 0U; channel < channels; ++channel) {
      for (std::size_t age = 0U; age < count; ++age) {
        samples_[static_cast<std::size_t>(channel) * length_ + length_ - 1U - age] =
            source.sampleAt(channel, age);
      }
    }
  }

  void swap(DelayLine &other) noexcept {
    std::swap(channel_count_, other.channel_count_);
    std::swap(max_delay_samples_, other.max_delay_samples_);
    std::swap(length_, other.length_);
    samples_.swap(other.samples_);
    write_indices_.swap(other.write_indices_);
  }

  void clearChannel(std::uint32_t channel) noexcept {
    if (channel >= channel_count_) {
      return;
    }
    const std::size_t offset = static_cast<std::size_t>(channel) * length_;
    std::fill_n(samples_.get() + offset, length_, 0.0F);
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
  [[nodiscard]] bool prepareStorage(std::uint32_t channel_count, std::uint32_t max_delay_samples,
                                    bool nothrow) {
    if (channel_count == 0U || max_delay_samples == std::numeric_limits<std::uint32_t>::max()) {
      return false;
    }

    const std::size_t length = static_cast<std::size_t>(max_delay_samples) + 1U;
    const std::size_t channels = static_cast<std::size_t>(channel_count);
    if (length > std::numeric_limits<std::size_t>::max() / channels / sizeof(float)) {
      return false;
    }

    std::unique_ptr<float[]> samples(nothrow ? new (std::nothrow) float[channels * length]{}
                                             : new float[channels * length]{});
    if (!samples) {
      return false;
    }
    std::unique_ptr<std::size_t[]> write_indices(
        nothrow ? new (std::nothrow) std::size_t[channels]{} : new std::size_t[channels]{});
    if (!write_indices) {
      return false;
    }
    channel_count_ = channel_count;
    max_delay_samples_ = max_delay_samples;
    length_ = length;
    samples_ = std::move(samples);
    write_indices_ = std::move(write_indices);
    return true;
  }

  [[nodiscard]] float sampleAt(std::uint32_t channel, std::size_t delay_samples) const noexcept {
    const std::size_t write_index = write_indices_[channel];
    const std::size_t wrapped_delay = delay_samples % length_;
    const std::size_t read_index = (write_index + length_ - 1U - wrapped_delay) % length_;
    return samples_[static_cast<std::size_t>(channel) * length_ + read_index];
  }

  std::uint32_t channel_count_ = 0U;
  std::uint32_t max_delay_samples_ = 0U;
  std::size_t length_ = 0U;
  std::unique_ptr<float[]> samples_;
  std::unique_ptr<std::size_t[]> write_indices_;
};

} // namespace effetune::dsp

#endif

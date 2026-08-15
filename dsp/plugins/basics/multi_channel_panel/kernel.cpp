#include "effetune/kernel.h"
#include "MultiChannelPanelPluginParams.h"
#include "binary_io.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace effetune::plugins::basics {
namespace {

constexpr std::uint16_t kTapMultiChannelLevels = 10u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kMaximumChannels = 8u;
constexpr std::uint32_t kPayloadHeaderBytes = 4u;
constexpr std::uint32_t kPayloadRecordBytes = 8u;
constexpr std::uint32_t kMaximumPayloadBytes =
    kPayloadHeaderBytes + kMaximumChannels * kPayloadRecordBytes;

using binary_io::writeF32;

} // namespace

class MultiChannelPanelKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MultiChannelPanelPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ =
        std::isfinite(info.sampleRate) && info.sampleRate > 0.0F ? info.sampleRate : 48000.0F;
    const double requested_delay = std::ceil(static_cast<double>(sample_rate_) * 0.03);
    delay_capacity_ = requested_delay < 1.0 ? 1u : static_cast<std::uint32_t>(requested_delay);
    const double requested_peaks = std::floor(static_cast<double>(sample_rate_) / 30.0);
    peak_capacity_ = requested_peaks < 1.0 ? 1u : static_cast<std::uint32_t>(requested_peaks);
    ramp_frames_ = std::max(
        1u, static_cast<std::uint32_t>(std::ceil(static_cast<double>(sample_rate_) * 0.005)));
    delay_lines_.resize(static_cast<std::size_t>(kMaximumChannels) * delay_capacity_);
    peak_windows_.resize(static_cast<std::size_t>(kMaximumChannels) * peak_capacity_);
    reset();
  }

  void reset() noexcept override {
    for (float &sample : delay_lines_)
      sample = 0.0F;
    for (float &peak : peak_windows_)
      peak = 0.0F;
    write_indices_.fill(0u);
    window_peaks_.fill(0.0F);
    effectively_muted_.fill(0u);
    active_channels_ = 0u;
    blocks_per_window_ = 0u;
    block_index_ = 0u;
    telemetry_channels_ = 0u;
    control_initialized_.fill(0u);
    ramp_remaining_.fill(0u);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || frame_count == 0u)
      return;
    const std::uint32_t channels =
        channel_count < kMaximumChannels ? channel_count : kMaximumChannels;
    std::uint32_t blocks_per_window = static_cast<std::uint32_t>(
        std::floor(static_cast<double>(sample_rate_) / 30.0 / static_cast<double>(frame_count)));
    if (blocks_per_window == 0u)
      blocks_per_window = 1u;
    if (blocks_per_window > peak_capacity_)
      blocks_per_window = peak_capacity_;

    if (active_channels_ != channels) {
      clearDelayState();
      clearPeakState();
      active_channels_ = channels;
    }
    if (blocks_per_window_ != blocks_per_window) {
      clearPeakState();
      blocks_per_window_ = blocks_per_window;
    }

    bool any_solo = false;
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      if (params_.solo[channel] != 0.0F) {
        any_solo = true;
        break;
      }
    }

    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      const bool muted = params_.mute[channel] != 0.0F;
      const bool solo = params_.solo[channel] != 0.0F;
      const bool effectively_muted = (any_solo && !solo) || (!any_solo && muted);
      effectively_muted_[channel] = effectively_muted ? 1u : 0u;

      double volume_db = static_cast<double>(params_.volume[channel]);
      if (!std::isfinite(volume_db))
        volume_db = 0.0;
      const double target_gain = std::pow(10.0, volume_db / 20.0);
      double delay_ms = static_cast<double>(params_.delay[channel]);
      if (!std::isfinite(delay_ms))
        delay_ms = 0.0;
      const double target_delay = std::clamp(delay_ms * static_cast<double>(sample_rate_) * 0.001,
                                             0.0, static_cast<double>(delay_capacity_));
      retargetChannel(channel, target_gain, target_delay);

      float *channel_audio = audio + static_cast<std::size_t>(channel) * frame_count;
      float *delay_line = delay_lines_.data() + static_cast<std::size_t>(channel) * delay_capacity_;
      std::uint32_t write_index = write_indices_[channel];
      float block_peak = 0.0F;

      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        advanceChannel(channel);
        const float input = channel_audio[frame];
        const float absolute = input < 0.0F ? -input : input;
        if (absolute > block_peak)
          block_peak = absolute;
        const float processed =
            effectively_muted ? 0.0F
                              : static_cast<float>(static_cast<double>(input) * gains_[channel]);
        channel_audio[frame] = readFractional(delay_line, write_index, processed, delays_[channel]);
        delay_line[write_index] = processed;
        if (++write_index == delay_capacity_)
          write_index = 0u;
      }
      write_indices_[channel] = write_index;

      float *peak_window =
          peak_windows_.data() + static_cast<std::size_t>(channel) * peak_capacity_;
      peak_window[block_index_] = block_peak;
      float window_peak = 0.0F;
      for (std::uint32_t index = 0u; index < blocks_per_window_; ++index) {
        if (peak_window[index] > window_peak)
          window_peak = peak_window[index];
      }
      window_peaks_[channel] = window_peak;
    }

    ++block_index_;
    if (block_index_ == blocks_per_window_)
      block_index_ = 0u;
    telemetry_channels_ = channels;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (telemetry_channels_ == 0u)
      return;
    payload_.fill(0u);
    payload_[0] = static_cast<std::uint8_t>(telemetry_channels_);
    for (std::uint32_t channel = 0u; channel < telemetry_channels_; ++channel) {
      const std::uint32_t offset = kPayloadHeaderBytes + channel * kPayloadRecordBytes;
      writeF32(payload_.data() + offset, window_peaks_[channel]);
      payload_[offset + 4u] = effectively_muted_[channel];
    }
    const std::uint16_t payload_bytes =
        static_cast<std::uint16_t>(kPayloadHeaderBytes + telemetry_channels_ * kPayloadRecordBytes);
    writer.write(kTapMultiChannelLevels, kTelemetryVersion, payload_.data(), payload_bytes);
  }

private:
  void retargetChannel(std::uint32_t channel, double gain, double delay) noexcept {
    if (control_initialized_[channel] == 0u) {
      gains_[channel] = target_gains_[channel] = gain;
      delays_[channel] = target_delays_[channel] = delay;
      control_initialized_[channel] = 1u;
      return;
    }
    if (target_gains_[channel] == gain && target_delays_[channel] == delay)
      return;
    target_gains_[channel] = gain;
    target_delays_[channel] = delay;
    gain_steps_[channel] = (gain - gains_[channel]) / static_cast<double>(ramp_frames_);
    delay_steps_[channel] = (delay - delays_[channel]) / static_cast<double>(ramp_frames_);
    ramp_remaining_[channel] = ramp_frames_;
  }

  void advanceChannel(std::uint32_t channel) noexcept {
    if (ramp_remaining_[channel] == 0u)
      return;
    gains_[channel] += gain_steps_[channel];
    delays_[channel] += delay_steps_[channel];
    if (--ramp_remaining_[channel] == 0u) {
      gains_[channel] = target_gains_[channel];
      delays_[channel] = target_delays_[channel];
    }
  }

  [[nodiscard]] float readFractional(const float *line, std::uint32_t write_index, float current,
                                     double delay) const noexcept {
    if (delay <= 0.0)
      return current;
    const std::uint32_t lower = static_cast<std::uint32_t>(delay);
    const double fraction = delay - static_cast<double>(lower);
    const float newer =
        lower == 0u ? current : line[(write_index + delay_capacity_ - lower) % delay_capacity_];
    if (fraction == 0.0 || lower >= delay_capacity_)
      return newer;
    const float older = line[(write_index + delay_capacity_ - lower - 1u) % delay_capacity_];
    return static_cast<float>(static_cast<double>(newer) +
                              (static_cast<double>(older) - newer) * fraction);
  }

  void clearDelayState() noexcept {
    for (float &sample : delay_lines_)
      sample = 0.0F;
    write_indices_.fill(0u);
  }

  void clearPeakState() noexcept {
    for (float &peak : peak_windows_)
      peak = 0.0F;
    window_peaks_.fill(0.0F);
    block_index_ = 0u;
  }

  float sample_rate_ = 48000.0F;
  std::vector<float> delay_lines_;
  std::vector<float> peak_windows_;
  std::array<std::uint32_t, kMaximumChannels> write_indices_{};
  std::array<float, kMaximumChannels> window_peaks_{};
  std::array<std::uint8_t, kMaximumChannels> effectively_muted_{};
  std::array<std::uint8_t, kMaximumChannels> control_initialized_{};
  std::array<double, kMaximumChannels> gains_{};
  std::array<double, kMaximumChannels> target_gains_{};
  std::array<double, kMaximumChannels> gain_steps_{};
  std::array<double, kMaximumChannels> delays_{};
  std::array<double, kMaximumChannels> target_delays_{};
  std::array<double, kMaximumChannels> delay_steps_{};
  std::array<std::uint32_t, kMaximumChannels> ramp_remaining_{};
  std::array<std::uint8_t, kMaximumPayloadBytes> payload_{};
  std::uint32_t delay_capacity_ = 1u;
  std::uint32_t peak_capacity_ = 1u;
  std::uint32_t active_channels_ = 0u;
  std::uint32_t blocks_per_window_ = 0u;
  std::uint32_t block_index_ = 0u;
  std::uint32_t telemetry_channels_ = 0u;
  std::uint32_t ramp_frames_ = 240u;
};

EFFETUNE_REGISTER_KERNEL(MultiChannelPanelPlugin, MultiChannelPanelKernel)

} // namespace effetune::plugins::basics

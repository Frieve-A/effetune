#include "effetune/kernel.h"
#include "LevelMeterPluginParams.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>

namespace effetune::plugins::analyzer {
namespace {

constexpr std::uint16_t kTapLevel = 1u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kMaxChannels = 8u;
constexpr std::uint32_t kWindowBins = 32u;
constexpr double kWindowRateHz = 30.0;
constexpr std::uint32_t kMaxPayloadBytes = 8u + kMaxChannels * 8u;

void writeU32(std::uint8_t *output, std::uint32_t value) noexcept {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>((value >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((value >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>(value >> 24u);
}

void writeF32(std::uint8_t *output, float value) noexcept {
  std::uint32_t bits = 0u;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&bits, &value, sizeof(bits));
  writeU32(output, bits);
}

} // namespace

class LevelMeterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::LevelMeterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    const double desired_bin_frames =
        static_cast<double>(info.sampleRate) / (kWindowRateHz * kWindowBins);
    if (desired_bin_frames >= static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
      frames_per_bin_ = std::numeric_limits<std::uint32_t>::max();
    } else {
      frames_per_bin_ =
          desired_bin_frames > 1.0 ? static_cast<std::uint32_t>(desired_bin_frames) : 1u;
      if (static_cast<double>(frames_per_bin_) < desired_bin_frames) {
        ++frames_per_bin_;
      }
    }
    reset();
  }

  void reset() noexcept override {
    channel_count_ = 0u;
    current_bin_ = 0u;
    for (std::uint32_t bin = 0u; bin < kWindowBins; ++bin) {
      clearBin(bin);
    }
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > kMaxChannels ||
        frame_count == 0u) {
      return;
    }
    if (channel_count != channel_count_) {
      resetWindow(channel_count);
    }

    std::uint32_t processed_frames = 0u;
    while (processed_frames < frame_count) {
      if (bin_frame_counts_[current_bin_] >= frames_per_bin_) {
        current_bin_ = (current_bin_ + 1u) % kWindowBins;
        clearBin(current_bin_);
      }

      const std::uint32_t available_frames = frames_per_bin_ - bin_frame_counts_[current_bin_];
      const std::uint32_t remaining_frames = frame_count - processed_frames;
      const std::uint32_t segment_frames =
          remaining_frames < available_frames ? remaining_frames : available_frames;

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        float peak = peaks_[current_bin_][channel];
        double sum_squares = sum_squares_[current_bin_][channel];
        std::uint32_t clip_flags = clip_flags_[current_bin_];
        const float *input = audio + channel * frame_count + processed_frames;
        for (std::uint32_t frame = 0u; frame < segment_frames; ++frame) {
          const float sample = input[frame];
          const float absolute = sample < 0.0F ? -sample : sample;
          if (absolute > peak) {
            peak = absolute;
          }
          const double wide_sample = static_cast<double>(sample);
          sum_squares += wide_sample * wide_sample;
          if (absolute > 1.0F) {
            clip_flags |= 1u << channel;
          }
        }
        peaks_[current_bin_][channel] = peak;
        sum_squares_[current_bin_][channel] = sum_squares;
        clip_flags_[current_bin_] = clip_flags;
      }

      bin_frame_counts_[current_bin_] += segment_frames;
      processed_frames += segment_frames;
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (channel_count_ == 0u) {
      return;
    }

    std::uint64_t measured_frames = 0u;
    std::uint32_t clip_flags = 0u;
    for (std::uint32_t bin = 0u; bin < kWindowBins; ++bin) {
      measured_frames += bin_frame_counts_[bin];
      clip_flags |= clip_flags_[bin];
    }
    if (measured_frames == 0u) {
      return;
    }

    std::array<std::uint8_t, kMaxPayloadBytes> payload{};
    writeU32(payload.data(), channel_count_);
    for (std::uint32_t channel = 0u; channel < channel_count_; ++channel) {
      float peak = 0.0F;
      double sum_squares = 0.0;
      for (std::uint32_t bin = 0u; bin < kWindowBins; ++bin) {
        const float bin_peak = peaks_[bin][channel];
        if (bin_peak > peak) {
          peak = bin_peak;
        }
        sum_squares += sum_squares_[bin][channel];
      }
      const float rms =
          static_cast<float>(std::sqrt(sum_squares / static_cast<double>(measured_frames)));
      const std::uint32_t offset = 4u + channel * 8u;
      writeF32(payload.data() + offset, peak);
      writeF32(payload.data() + offset + 4u, rms);
    }
    writeU32(payload.data() + 4u + channel_count_ * 8u, clip_flags);

    const std::uint16_t payload_bytes = static_cast<std::uint16_t>(8u + channel_count_ * 8u);
    writer.write(kTapLevel, kTelemetryVersion, payload.data(), payload_bytes);
  }

private:
  void resetWindow(std::uint32_t channel_count) noexcept {
    channel_count_ = channel_count;
    current_bin_ = 0u;
    for (std::uint32_t bin = 0u; bin < kWindowBins; ++bin) {
      clearBin(bin);
    }
  }

  void clearBin(std::uint32_t bin) noexcept {
    peaks_[bin].fill(0.0F);
    sum_squares_[bin].fill(0.0);
    bin_frame_counts_[bin] = 0u;
    clip_flags_[bin] = 0u;
  }

  std::array<std::array<float, kMaxChannels>, kWindowBins> peaks_{};
  std::array<std::array<double, kMaxChannels>, kWindowBins> sum_squares_{};
  std::array<std::uint32_t, kWindowBins> bin_frame_counts_{};
  std::array<std::uint32_t, kWindowBins> clip_flags_{};
  std::uint32_t frames_per_bin_ = 1u;
  std::uint32_t channel_count_ = 0u;
  std::uint32_t current_bin_ = 0u;
};

} // namespace effetune::plugins::analyzer

EFFETUNE_REGISTER_KERNEL(LevelMeterPlugin, effetune::plugins::analyzer::LevelMeterKernel)

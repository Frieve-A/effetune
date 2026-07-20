#include "effetune/kernel.h"
#include "StereoMeterPluginParams.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

namespace effetune::plugins::analyzer {
namespace {

constexpr std::uint16_t kTapStereoField = 6u;
constexpr std::uint16_t kTelemetryVersion = 2u;
constexpr std::uint32_t kEnvelopeBinCount = 360u;
constexpr std::uint32_t kPayloadHeaderBytes = 8u;
constexpr std::uint32_t kMaxDeltaSamples = 8000u;
constexpr std::uint32_t kSampleBytes = 8u;
constexpr std::uint32_t kPayloadTailBytes = kEnvelopeBinCount * 4u + 16u;
constexpr std::uint32_t kMaxPayloadBytes =
    kPayloadHeaderBytes + kMaxDeltaSamples * kSampleBytes + kPayloadTailBytes;
constexpr std::uint16_t kSampleFlagDiscontinuity = 1u;
constexpr double kRadiansToDegrees = 57.2957795130823208768;
constexpr double kLogTen = 2.30258509299404568402;
constexpr double kEnergyEpsilon = 1.0e-12;

static_assert(kMaxPayloadBytes == 65464u);
static_assert(kMaxPayloadBytes <= std::numeric_limits<std::uint16_t>::max());

void writeU16(std::uint8_t *output, std::uint16_t value) noexcept {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>(value >> 8u);
}

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

float coordinateToFloat(double coordinate) noexcept {
  const double maximum = static_cast<double>(std::numeric_limits<float>::max());
  if (coordinate < -maximum) {
    return -std::numeric_limits<float>::max();
  }
  if (coordinate > maximum) {
    return std::numeric_limits<float>::max();
  }
  return static_cast<float>(coordinate);
}

} // namespace

class StereoMeterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::StereoMeterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ =
        std::isfinite(info.sampleRate) && info.sampleRate > 0.0F ? info.sampleRate : 48000.0F;
    const double required = std::ceil(static_cast<double>(sample_rate_));
    ring_capacity_ = required < 1.0 ? 1u : static_cast<std::uint32_t>(required);
    left_ring_.resize(ring_capacity_);
    right_ring_.resize(ring_capacity_);
    payload_.resize(kMaxPayloadBytes);
    reset();
  }

  void reset() noexcept override {
    for (float &sample : left_ring_) {
      sample = 0.0F;
    }
    for (float &sample : right_ring_) {
      sample = 0.0F;
    }
    for (float &peak : angle_envelope_) {
      peak = 0.0F;
    }
    for (std::uint8_t &byte : payload_) {
      byte = 0u;
    }
    write_position_ = 0u;
    active_window_time_ = 0.1F;
    last_peak_update_time_ = 0.0;
    pending_sample_count_ = 0u;
    payload_bytes_ = 0u;
    has_peak_update_time_ = false;
    has_samples_ = false;
    parameter_state_initialized_ = false;
    pending_discontinuity_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &info) noexcept override {
    if (audio == nullptr || channel_count == 0u || frame_count == 0u || left_ring_.empty() ||
        right_ring_.empty() || payload_.empty()) {
      return;
    }
    synchronizeParameters();

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      float left = audio[frame];
      float right = channel_count > 1u ? audio[frame_count + frame] : left;
      if (!std::isfinite(left)) {
        left = 0.0F;
      }
      if (!std::isfinite(right)) {
        right = 0.0F;
      }
      left_ring_[write_position_] = left;
      right_ring_[write_position_] = right;
      write_position_ = write_position_ + 1u == ring_capacity_ ? 0u : write_position_ + 1u;
      updateAngleEnvelope(left, right);
    }
    if (frame_count > ring_capacity_ - pending_sample_count_) {
      pending_sample_count_ = ring_capacity_;
      pending_discontinuity_ = true;
    } else {
      pending_sample_count_ += frame_count;
    }
    decayAngleEnvelope(info.timeSeconds);
    has_samples_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!has_samples_) {
      return;
    }
    buildPayload();
    writer.write(kTapStereoField, kTelemetryVersion, payload_.data(), payload_bytes_);
    pending_sample_count_ = 0u;
    pending_discontinuity_ = false;
  }

private:
  void synchronizeParameters() noexcept {
    float requested = parameter_state_initialized_ ? active_window_time_ : 0.1F;
    if (paramsDirty()) {
      requested = params_.windowTime;
    }
    if (!std::isfinite(requested)) {
      requested = 0.1F;
    } else if (requested < 0.01F) {
      requested = 0.01F;
    } else if (requested > 1.0F) {
      requested = 1.0F;
    }
    active_window_time_ = requested;
    parameter_state_initialized_ = true;
  }

  void updateAngleEnvelope(float left, float right) noexcept {
    const double x = static_cast<double>(right) - static_cast<double>(left);
    const double y = static_cast<double>(left) + static_cast<double>(right);
    const double angle = -std::atan2(y, x) * kRadiansToDegrees;
    int angle_index =
        static_cast<int>(std::floor(angle + 0.5)) % static_cast<int>(kEnvelopeBinCount);
    if (angle_index < 0) {
      angle_index += static_cast<int>(kEnvelopeBinCount);
    }
    double magnitude = std::sqrt(x * x + y * y);
    const double maximum_float = static_cast<double>(std::numeric_limits<float>::max());
    if (!std::isfinite(magnitude) || magnitude > maximum_float) {
      magnitude = maximum_float;
    }
    const float value = static_cast<float>(magnitude);
    float &peak = angle_envelope_[static_cast<std::uint32_t>(angle_index)];
    if (value > peak) {
      peak = value;
    }
  }

  void decayAngleEnvelope(double time_seconds) noexcept {
    if (!std::isfinite(time_seconds)) {
      return;
    }
    if (!has_peak_update_time_) {
      last_peak_update_time_ = time_seconds;
      has_peak_update_time_ = true;
      return;
    }
    const double delta = time_seconds - last_peak_update_time_;
    if (delta <= 0.0) {
      return;
    }
    const float factor = static_cast<float>(std::exp(-delta * kLogTen));
    for (float &peak : angle_envelope_) {
      peak *= factor;
    }
    last_peak_update_time_ = time_seconds;
  }

  std::uint32_t windowSampleCount() const noexcept {
    const double requested = std::ceil(static_cast<double>(sample_rate_) * active_window_time_);
    if (requested >= static_cast<double>(ring_capacity_)) {
      return ring_capacity_;
    }
    const std::uint32_t count = static_cast<std::uint32_t>(requested);
    return count == 0u ? 1u : count;
  }

  void buildPayload() noexcept {
    const std::uint32_t sample_count = windowSampleCount();
    std::uint32_t position = write_position_ >= sample_count
                                 ? write_position_ - sample_count
                                 : ring_capacity_ - (sample_count - write_position_);
    double sum_lr = 0.0;
    double sum_l2 = 0.0;
    double sum_r2 = 0.0;
    float peak_left = 0.0F;
    float peak_right = 0.0F;

    for (std::uint32_t sample = 0u; sample < sample_count; ++sample) {
      const float left = left_ring_[position];
      const float right = right_ring_[position];
      position = position + 1u == ring_capacity_ ? 0u : position + 1u;

      const float absolute_left = left < 0.0F ? -left : left;
      const float absolute_right = right < 0.0F ? -right : right;
      if (absolute_left > peak_left) {
        peak_left = absolute_left;
      }
      if (absolute_right > peak_right) {
        peak_right = absolute_right;
      }
      const double left_value = static_cast<double>(left);
      const double right_value = static_cast<double>(right);
      sum_lr += left_value * right_value;
      sum_l2 += left_value * left_value;
      sum_r2 += right_value * right_value;
    }

    const bool truncated = pending_sample_count_ > kMaxDeltaSamples;
    const std::uint32_t delta_sample_count = truncated ? kMaxDeltaSamples : pending_sample_count_;
    writeF32(payload_.data(), sample_rate_);
    writeU16(payload_.data() + 4u, static_cast<std::uint16_t>(delta_sample_count));
    writeU16(payload_.data() + 6u,
             pending_discontinuity_ || truncated ? kSampleFlagDiscontinuity : 0u);

    std::uint32_t delta_position = write_position_ >= delta_sample_count
                                       ? write_position_ - delta_sample_count
                                       : ring_capacity_ - (delta_sample_count - write_position_);
    for (std::uint32_t sample = 0u; sample < delta_sample_count; ++sample) {
      const double left = static_cast<double>(left_ring_[delta_position]);
      const double right = static_cast<double>(right_ring_[delta_position]);
      delta_position = delta_position + 1u == ring_capacity_ ? 0u : delta_position + 1u;
      const std::uint32_t offset = kPayloadHeaderBytes + sample * kSampleBytes;
      writeF32(payload_.data() + offset, coordinateToFloat(right - left));
      writeF32(payload_.data() + offset + 4u, coordinateToFloat(left + right));
    }

    const std::uint32_t envelope_offset = kPayloadHeaderBytes + delta_sample_count * kSampleBytes;
    for (std::uint32_t bin = 0u; bin < kEnvelopeBinCount; ++bin) {
      writeF32(payload_.data() + envelope_offset + bin * 4u, angle_envelope_[bin]);
    }

    double correlation = 0.0;
    if (sum_l2 > 0.0 && sum_r2 > 0.0) {
      correlation = sum_lr / (std::sqrt(sum_l2) * std::sqrt(sum_r2));
      if (correlation < -1.0) {
        correlation = -1.0;
      } else if (correlation > 1.0) {
        correlation = 1.0;
      }
    }
    const double balance =
        10.0 * std::log10(sum_r2 + kEnergyEpsilon) - 10.0 * std::log10(sum_l2 + kEnergyEpsilon);
    const std::uint32_t statistics_offset = envelope_offset + kEnvelopeBinCount * 4u;
    writeF32(payload_.data() + statistics_offset, static_cast<float>(correlation));
    writeF32(payload_.data() + statistics_offset + 4u, static_cast<float>(balance));
    writeF32(payload_.data() + statistics_offset + 8u, peak_left);
    writeF32(payload_.data() + statistics_offset + 12u, peak_right);
    payload_bytes_ = static_cast<std::uint16_t>(statistics_offset + 16u);
  }

  std::vector<float> left_ring_;
  std::vector<float> right_ring_;
  std::vector<std::uint8_t> payload_;
  std::array<float, kEnvelopeBinCount> angle_envelope_{};
  float sample_rate_ = 48000.0F;
  float active_window_time_ = 0.1F;
  double last_peak_update_time_ = 0.0;
  std::uint32_t ring_capacity_ = 0u;
  std::uint32_t write_position_ = 0u;
  std::uint32_t pending_sample_count_ = 0u;
  std::uint16_t payload_bytes_ = 0u;
  bool has_peak_update_time_ = false;
  bool has_samples_ = false;
  bool parameter_state_initialized_ = false;
  bool pending_discontinuity_ = false;
};

} // namespace effetune::plugins::analyzer

EFFETUNE_REGISTER_KERNEL(StereoMeterPlugin, effetune::plugins::analyzer::StereoMeterKernel)

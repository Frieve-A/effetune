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
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kGridSize = 64u;
constexpr std::uint32_t kHistogramCellCount = kGridSize * kGridSize;
constexpr std::uint32_t kEnvelopeBinCount = 360u;
constexpr std::uint32_t kHistogramOffset = 2u;
constexpr std::uint32_t kEnvelopeOffset = kHistogramOffset + kHistogramCellCount;
constexpr std::uint32_t kCorrelationOffset = kEnvelopeOffset + kEnvelopeBinCount * 4u;
constexpr std::uint32_t kBalanceOffset = kCorrelationOffset + 4u;
constexpr std::uint32_t kPeakLeftOffset = kBalanceOffset + 4u;
constexpr std::uint32_t kPeakRightOffset = kPeakLeftOffset + 4u;
constexpr std::uint32_t kPayloadBytes = kPeakRightOffset + 4u;
constexpr double kRadiansToDegrees = 57.2957795130823208768;
constexpr double kLogTen = 2.30258509299404568402;
constexpr double kEnergyEpsilon = 1.0e-12;
constexpr double kCoordinateMinimum = -2.0;
constexpr double kCoordinateMaximum = 2.0;
constexpr double kCoordinateToCell = 16.0;

static_assert(kPayloadBytes == 5554u);

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
    histogram_counts_.resize(kHistogramCellCount);
    payload_.resize(kPayloadBytes);
    reset();
  }

  void reset() noexcept override {
    for (float &sample : left_ring_) {
      sample = 0.0F;
    }
    for (float &sample : right_ring_) {
      sample = 0.0F;
    }
    for (std::uint32_t &count : histogram_counts_) {
      count = 0u;
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
    telemetry_write_phase_ = 0u;
    has_peak_update_time_ = false;
    has_samples_ = false;
    parameter_state_initialized_ = false;
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
    decayAngleEnvelope(info.timeSeconds);
    has_samples_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    telemetry_write_phase_ ^= 1u;
    if (telemetry_write_phase_ != 0u || !has_samples_) {
      return;
    }
    buildPayload();
    writer.write(kTapStereoField, kTelemetryVersion, payload_.data(),
                 static_cast<std::uint16_t>(kPayloadBytes));
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
    for (std::uint32_t &count : histogram_counts_) {
      count = 0u;
    }

    const std::uint32_t sample_count = windowSampleCount();
    std::uint32_t position = write_position_ >= sample_count
                                 ? write_position_ - sample_count
                                 : ring_capacity_ - (sample_count - write_position_);
    double sum_lr = 0.0;
    double sum_l2 = 0.0;
    double sum_r2 = 0.0;
    float peak_left = 0.0F;
    float peak_right = 0.0F;
    std::uint32_t maximum_cell_count = 0u;

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

      const double x = right_value - left_value;
      const double y = left_value + right_value;
      if (x < kCoordinateMinimum || x > kCoordinateMaximum || y < kCoordinateMinimum ||
          y > kCoordinateMaximum) {
        continue;
      }
      const double x_cell = (x - kCoordinateMinimum) * kCoordinateToCell;
      const double y_cell = (kCoordinateMaximum - y) * kCoordinateToCell;
      const std::uint32_t column = x_cell >= static_cast<double>(kGridSize)
                                       ? kGridSize - 1u
                                       : static_cast<std::uint32_t>(x_cell);
      const std::uint32_t row = y_cell >= static_cast<double>(kGridSize)
                                    ? kGridSize - 1u
                                    : static_cast<std::uint32_t>(y_cell);
      std::uint32_t &cell = histogram_counts_[row * kGridSize + column];
      ++cell;
      if (cell > maximum_cell_count) {
        maximum_cell_count = cell;
      }
    }

    writeU16(payload_.data(), static_cast<std::uint16_t>(kGridSize));
    if (maximum_cell_count == 0u) {
      for (std::uint32_t cell = 0u; cell < kHistogramCellCount; ++cell) {
        payload_[kHistogramOffset + cell] = 0u;
      }
    } else {
      const double denominator = std::log1p(static_cast<double>(maximum_cell_count));
      for (std::uint32_t cell = 0u; cell < kHistogramCellCount; ++cell) {
        const double normalized =
            std::log1p(static_cast<double>(histogram_counts_[cell])) / denominator;
        payload_[kHistogramOffset + cell] = static_cast<std::uint8_t>(normalized * 255.0 + 0.5);
      }
    }

    for (std::uint32_t bin = 0u; bin < kEnvelopeBinCount; ++bin) {
      writeF32(payload_.data() + kEnvelopeOffset + bin * 4u, angle_envelope_[bin]);
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
    writeF32(payload_.data() + kCorrelationOffset, static_cast<float>(correlation));
    writeF32(payload_.data() + kBalanceOffset, static_cast<float>(balance));
    writeF32(payload_.data() + kPeakLeftOffset, peak_left);
    writeF32(payload_.data() + kPeakRightOffset, peak_right);
  }

  std::vector<float> left_ring_;
  std::vector<float> right_ring_;
  std::vector<std::uint32_t> histogram_counts_;
  std::vector<std::uint8_t> payload_;
  std::array<float, kEnvelopeBinCount> angle_envelope_{};
  float sample_rate_ = 48000.0F;
  float active_window_time_ = 0.1F;
  double last_peak_update_time_ = 0.0;
  std::uint32_t ring_capacity_ = 0u;
  std::uint32_t write_position_ = 0u;
  std::uint32_t telemetry_write_phase_ = 0u;
  bool has_peak_update_time_ = false;
  bool has_samples_ = false;
  bool parameter_state_initialized_ = false;
};

} // namespace effetune::plugins::analyzer

EFFETUNE_REGISTER_KERNEL(StereoMeterPlugin, effetune::plugins::analyzer::StereoMeterKernel)

#include "effetune/kernel.h"
#include "OscilloscopePluginParams.h"
#include "binary_io.h"

#include <cstdint>
#include <cstring>
#include <vector>

namespace effetune::plugins::analyzer {
namespace {

constexpr std::uint16_t kTapScopeSnapshot = 3u;
constexpr std::uint16_t kTelemetryVersion = 2u;
constexpr std::uint32_t kRingSamples = 65536u;
constexpr std::uint32_t kRingMask = kRingSamples - 1u;
constexpr std::uint32_t kMaxRawSamples = 2048u;
constexpr std::uint32_t kM4BucketCount = 512u;
constexpr std::uint32_t kPayloadHeaderBytes = 16u;
constexpr std::uint32_t kM4BucketBytes = 18u;
constexpr std::uint8_t kRawEncoding = 0u;
constexpr std::uint8_t kM4Encoding = 1u;
constexpr std::uint8_t kTriggeredFlag = 1u << 0u;
constexpr std::uint32_t kMaxPayloadBytes = kPayloadHeaderBytes + kM4BucketCount * kM4BucketBytes;

static_assert((kRingSamples + kM4BucketCount - 1u) / kM4BucketCount <= 256u);

using binary_io::writeF32;
using binary_io::writeU16;
using binary_io::writeU32;

} // namespace

class OscilloscopeKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::OscilloscopePluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = info.sampleRate;
    ring_.resize(kRingSamples);
    payload_.resize(kMaxPayloadBytes);
    building_payload_.resize(kMaxPayloadBytes);
    reset();
  }

  void reset() noexcept override {
    for (float &sample : ring_) {
      sample = 0.0F;
    }
    for (std::uint8_t &byte : payload_) {
      byte = 0u;
    }
    for (std::uint8_t &byte : building_payload_) {
      byte = 0u;
    }
    buffer_position_ = 0u;
    trigger_index_ = 0u;
    last_trigger_time_ = 0.0;
    last_auto_sweep_time_ = 0.0;
    trigger_is_real_ = false;
    has_processed_trigger_ = false;
    last_processed_trigger_index_ = 0u;
    capture_active_ = false;
    capture_target_samples_ = 0u;
    capture_samples_ = 0u;
    capture_buffer_position_ = 0u;
    capture_bucket_ = 0u;
    capture_bucket_initialized_ = false;
    capture_triggered_ = false;
    has_snapshot_ = false;
    payload_bytes_ = 0u;
    telemetry_write_phase_ = 0u;
    parameter_state_initialized_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &info) noexcept override {
    if (audio == nullptr || channel_count == 0u || frame_count == 0u || ring_.empty() ||
        payload_.empty() || building_payload_.empty()) {
      return;
    }

    synchronizeParameters();

    std::uint32_t current_position = buffer_position_;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const float left = audio[frame];
      const float right = channel_count > 1u ? audio[frame_count + frame] : left;
      ring_[current_position] = (left + right) * 0.5F;
      current_position = (current_position + 1u) & kRingMask;
    }
    buffer_position_ = current_position;

    // Free-running mode publishes the latest window at telemetry time instead of capturing.
    if (active_free_run_) {
      return;
    }
    detectTrigger(frame_count, info.timeSeconds);
    startCaptureIfNeeded();
    appendAvailableCapture(frame_count);
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    telemetry_write_phase_ ^= 1u;
    if (telemetry_write_phase_ != 0u) {
      return;
    }
    if (active_free_run_) {
      captureLatestWindow();
    }
    if (!has_snapshot_) {
      return;
    }
    writer.write(kTapScopeSnapshot, kTelemetryVersion, payload_.data(), payload_bytes_);
  }

private:
  void synchronizeParameters() noexcept {
    const bool auto_mode = params_.triggerMode < 0.5F;
    const bool free_run = params_.triggerMode >= 1.5F;
    const bool rising_edge = params_.triggerEdge < 0.5F;
    float display_time = params_.displayTime;
    if (display_time < 0.001F) {
      display_time = 0.001F;
    } else if (display_time > 0.1F) {
      display_time = 0.1F;
    }
    float holdoff = params_.holdoff;
    if (holdoff < 0.0001F) {
      holdoff = 0.0001F;
    } else if (holdoff > 0.01F) {
      holdoff = 0.01F;
    }

    if (parameter_state_initialized_ &&
        (display_time != active_display_time_ || auto_mode != active_auto_mode_ ||
         free_run != active_free_run_ || rising_edge != active_rising_edge_)) {
      clearDisplayCapture();
    }
    active_display_time_ = display_time;
    active_auto_mode_ = auto_mode;
    active_free_run_ = free_run;
    active_trigger_level_ = params_.triggerLevel;
    active_rising_edge_ = rising_edge;
    active_holdoff_ = holdoff;
    parameter_state_initialized_ = true;
  }

  void clearDisplayCapture() noexcept {
    has_processed_trigger_ = false;
    capture_active_ = false;
    capture_target_samples_ = 0u;
    capture_samples_ = 0u;
    capture_buffer_position_ = buffer_position_;
    capture_bucket_ = 0u;
    capture_bucket_initialized_ = false;
  }

  void detectTrigger(std::uint32_t frame_count, double time_seconds) noexcept {
    bool triggered = false;
    const std::uint32_t first_index = (buffer_position_ - frame_count) & kRingMask;
    float previous = ring_[first_index];
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const std::uint32_t index = (buffer_position_ - frame_count + frame) & kRingMask;
      const float current = ring_[index];
      const bool crossed =
          active_rising_edge_
              ? previous < active_trigger_level_ && current >= active_trigger_level_
              : previous > active_trigger_level_ && current <= active_trigger_level_;
      if (crossed && time_seconds - last_trigger_time_ >= active_holdoff_) {
        trigger_index_ = index;
        last_trigger_time_ = time_seconds;
        trigger_is_real_ = true;
        triggered = true;
        if (active_auto_mode_) {
          last_auto_sweep_time_ = time_seconds;
        }
        break;
      }
      previous = current;
    }

    if (active_auto_mode_ && !triggered) {
      if (last_auto_sweep_time_ == 0.0) {
        last_auto_sweep_time_ = time_seconds;
      }
      if (time_seconds - last_auto_sweep_time_ >= 0.1) {
        trigger_index_ = buffer_position_;
        trigger_is_real_ = false;
        last_auto_sweep_time_ = time_seconds;
      }
    }
  }

  std::uint32_t displaySampleCount() const noexcept {
    const double desired = static_cast<double>(sample_rate_) * active_display_time_;
    if (desired >= static_cast<double>(kRingSamples)) {
      return kRingSamples;
    }
    const std::uint32_t samples = static_cast<std::uint32_t>(desired);
    return samples == 0u ? 1u : samples;
  }

  void startCaptureIfNeeded() noexcept {
    if (capture_active_ ||
        (has_processed_trigger_ && last_processed_trigger_index_ == trigger_index_)) {
      return;
    }
    has_processed_trigger_ = true;
    last_processed_trigger_index_ = trigger_index_;
    beginCapture(trigger_index_, trigger_is_real_);
  }

  void captureLatestWindow() noexcept {
    beginCapture((buffer_position_ - displaySampleCount()) & kRingMask, false);
    while (capture_samples_ < capture_target_samples_) {
      appendCaptureSample(ring_[(capture_buffer_position_ + capture_samples_) & kRingMask]);
    }
    publishSnapshotPayload();
    capture_active_ = false;
  }

  void beginCapture(std::uint32_t start_position, bool triggered) noexcept {
    capture_active_ = true;
    capture_target_samples_ = displaySampleCount();
    capture_samples_ = 0u;
    capture_buffer_position_ = start_position;
    capture_bucket_ = 0u;
    capture_bucket_initialized_ = false;
    capture_triggered_ = triggered;
    writePayloadHeader(
        building_payload_,
        capture_target_samples_ <= kMaxRawSamples ? 0u : static_cast<std::uint16_t>(kM4BucketCount),
        capture_target_samples_ <= kMaxRawSamples ? kRawEncoding : kM4Encoding);
  }

  void appendCaptureSample(float sample) noexcept {
    const std::uint32_t capture_index = capture_samples_;
    if (capture_target_samples_ <= kMaxRawSamples) {
      writeF32(building_payload_.data() + kPayloadHeaderBytes + capture_index * 4u, sample);
    } else {
      const std::uint32_t bucket_begin = static_cast<std::uint32_t>(
          (static_cast<std::uint64_t>(capture_bucket_) * capture_target_samples_) / kM4BucketCount);
      const std::uint32_t bucket_end = static_cast<std::uint32_t>(
          (static_cast<std::uint64_t>(capture_bucket_ + 1u) * capture_target_samples_) /
          kM4BucketCount);
      if (!capture_bucket_initialized_) {
        capture_bucket_first_ = sample;
        capture_bucket_minimum_ = sample;
        capture_bucket_maximum_ = sample;
        capture_bucket_minimum_index_ = 0u;
        capture_bucket_maximum_index_ = 0u;
        capture_bucket_initialized_ = true;
      } else {
        const std::uint32_t bucket_index = capture_index - bucket_begin;
        if (sample < capture_bucket_minimum_) {
          capture_bucket_minimum_ = sample;
          capture_bucket_minimum_index_ = static_cast<std::uint8_t>(bucket_index);
        }
        if (sample > capture_bucket_maximum_) {
          capture_bucket_maximum_ = sample;
          capture_bucket_maximum_index_ = static_cast<std::uint8_t>(bucket_index);
        }
      }
      capture_bucket_last_ = sample;
      if (capture_index + 1u == bucket_end) {
        const std::uint32_t offset = kPayloadHeaderBytes + capture_bucket_ * kM4BucketBytes;
        writeF32(building_payload_.data() + offset, capture_bucket_first_);
        writeF32(building_payload_.data() + offset + 4u, capture_bucket_minimum_);
        writeF32(building_payload_.data() + offset + 8u, capture_bucket_maximum_);
        writeF32(building_payload_.data() + offset + 12u, capture_bucket_last_);
        building_payload_[offset + 16u] = capture_bucket_minimum_index_;
        building_payload_[offset + 17u] = capture_bucket_maximum_index_;
        ++capture_bucket_;
        capture_bucket_initialized_ = false;
      }
    }
    ++capture_samples_;
  }

  void appendAvailableCapture(std::uint32_t frame_count) noexcept {
    if (!capture_active_) {
      return;
    }

    const std::uint32_t available = (buffer_position_ - capture_buffer_position_) & kRingMask;
    // Consume faster than samples arrive so a delayed trigger catches up without one large call.
    const std::uint32_t budget = frame_count < kRingSamples / 2u ? frame_count * 2u : kRingSamples;
    std::uint32_t append_count = available < budget ? available : budget;
    const std::uint32_t remaining = capture_target_samples_ - capture_samples_;
    if (append_count > remaining) {
      append_count = remaining;
    }
    for (std::uint32_t offset = 0u; offset < append_count; ++offset) {
      appendCaptureSample(ring_[(capture_buffer_position_ + offset) & kRingMask]);
    }
    capture_buffer_position_ = (capture_buffer_position_ + append_count) & kRingMask;

    if (capture_samples_ >= capture_target_samples_) {
      publishSnapshotPayload();
      capture_active_ = false;
    }
  }

  void writePayloadHeader(std::vector<std::uint8_t> &payload, std::uint16_t bucket_count,
                          std::uint8_t encoding) noexcept {
    writeF32(payload.data(), sample_rate_);
    writeU32(payload.data() + 4u, capture_target_samples_);
    writeU32(payload.data() + 8u, 0u);
    writeU16(payload.data() + 12u, bucket_count);
    payload[14u] = encoding;
    payload[15u] = capture_triggered_ ? kTriggeredFlag : 0u;
  }

  void publishSnapshotPayload() noexcept {
    if (capture_target_samples_ <= kMaxRawSamples) {
      payload_bytes_ =
          static_cast<std::uint16_t>(kPayloadHeaderBytes + capture_target_samples_ * 4u);
    } else {
      payload_bytes_ =
          static_cast<std::uint16_t>(kPayloadHeaderBytes + kM4BucketCount * kM4BucketBytes);
    }
    payload_.swap(building_payload_);
    has_snapshot_ = true;
  }

  std::vector<float> ring_;
  std::vector<std::uint8_t> payload_;
  std::vector<std::uint8_t> building_payload_;
  float sample_rate_ = 0.0F;
  float active_display_time_ = 0.01F;
  float active_trigger_level_ = 0.0F;
  float active_holdoff_ = 0.0001F;
  std::uint32_t buffer_position_ = 0u;
  std::uint32_t trigger_index_ = 0u;
  std::uint32_t last_processed_trigger_index_ = 0u;
  std::uint32_t capture_target_samples_ = 0u;
  std::uint32_t capture_samples_ = 0u;
  std::uint32_t capture_buffer_position_ = 0u;
  std::uint32_t capture_bucket_ = 0u;
  float capture_bucket_first_ = 0.0F;
  float capture_bucket_minimum_ = 0.0F;
  float capture_bucket_maximum_ = 0.0F;
  float capture_bucket_last_ = 0.0F;
  std::uint8_t capture_bucket_minimum_index_ = 0u;
  std::uint8_t capture_bucket_maximum_index_ = 0u;
  std::uint16_t payload_bytes_ = 0u;
  double last_trigger_time_ = 0.0;
  double last_auto_sweep_time_ = 0.0;
  bool active_auto_mode_ = true;
  bool active_free_run_ = false;
  bool active_rising_edge_ = true;
  bool trigger_is_real_ = false;
  bool has_processed_trigger_ = false;
  bool capture_active_ = false;
  bool capture_bucket_initialized_ = false;
  bool capture_triggered_ = false;
  bool has_snapshot_ = false;
  bool parameter_state_initialized_ = false;
  std::uint8_t telemetry_write_phase_ = 0u;
};

} // namespace effetune::plugins::analyzer

EFFETUNE_REGISTER_KERNEL(OscilloscopePlugin, effetune::plugins::analyzer::OscilloscopeKernel)

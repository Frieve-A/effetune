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
constexpr std::uint8_t kEnvelopeEncoding = 2u;
constexpr std::uint8_t kTriggeredFlag = 1u << 0u;
constexpr std::uint8_t kRollingFlag = 1u << 1u;
constexpr std::uint32_t kEnvelopeBuckets = 4096u;
constexpr std::uint32_t kEnvelopeRingBuckets = 8192u;
constexpr std::uint32_t kEnvelopeRingMask = kEnvelopeRingBuckets - 1u;
constexpr std::uint32_t kMaxEnvelopeBuckets = 8188u;
constexpr std::uint32_t kEnvelopeHeaderBytes = 28u;
constexpr std::uint32_t kMaxPayloadBytes = kEnvelopeHeaderBytes + kMaxEnvelopeBuckets * 8u;

static_assert(kMaxPayloadBytes <= UINT16_MAX);

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
    envelope_.resize(kEnvelopeRingBuckets * 2u);
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
    rolling_samples_ = 0u;
    rolling_bucket_samples_ = 1u;
    rolling_bucket_index_ = 0u;
    rolling_bucket_fill_ = 0u;
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

    if (active_free_run_ && displaySampleCount() > kMaxRawSamples) {
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const float left = audio[frame];
        const float right = channel_count > 1u ? audio[frame_count + frame] : left;
        const float sample = (left + right) * 0.5F;
        float *extrema = envelope_.data() + rolling_bucket_index_ * 2u;
        if (rolling_bucket_fill_ == 0u) {
          extrema[0] = sample;
          extrema[1] = sample;
        } else {
          if (sample < extrema[0]) {
            extrema[0] = sample;
          }
          if (sample > extrema[1]) {
            extrema[1] = sample;
          }
        }
        if (++rolling_bucket_fill_ == rolling_bucket_samples_) {
          rolling_bucket_fill_ = 0u;
          rolling_bucket_index_ = (rolling_bucket_index_ + 1u) & kEnvelopeRingMask;
        }
      }
      rolling_samples_ += frame_count;
      return;
    }

    std::uint32_t current_position = buffer_position_;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const float left = audio[frame];
      const float right = channel_count > 1u ? audio[frame_count + frame] : left;
      const float sample = (left + right) * 0.5F;
      ring_[current_position] = sample;
      ++rolling_samples_;
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
    if (telemetry_write_phase_ != 0u && !active_free_run_) {
      return;
    }
    if (active_free_run_) {
      captureLatestWindow();
    }
    if (!has_snapshot_) {
      return;
    }
    writer.write(kTapScopeSnapshot, payload_[14u] == kEnvelopeEncoding ? 3u : kTelemetryVersion,
                 payload_.data(), payload_bytes_);
  }

private:
  void synchronizeParameters() noexcept {
    const bool auto_mode = params_.triggerMode < 0.5F;
    const bool free_run = params_.triggerMode >= 1.5F;
    const bool rising_edge = params_.triggerEdge < 0.5F;
    float display_time = params_.displayTime;
    if (display_time < 0.001F) {
      display_time = 0.001F;
    } else if (display_time > 10.0F) {
      display_time = 10.0F;
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
    const bool reset_rolling = !parameter_state_initialized_ ||
                               display_time != active_display_time_ || free_run != active_free_run_;
    active_display_time_ = display_time;
    active_auto_mode_ = auto_mode;
    active_free_run_ = free_run;
    active_trigger_level_ = params_.triggerLevel;
    active_rising_edge_ = rising_edge;
    active_holdoff_ = holdoff;
    if (reset_rolling) {
      rolling_samples_ = 0u;
      rolling_bucket_samples_ = (displaySampleCount() + kEnvelopeBuckets - 1u) / kEnvelopeBuckets;
      rolling_bucket_index_ = 0u;
      rolling_bucket_fill_ = 0u;
    }
    parameter_state_initialized_ = true;
  }

  void clearDisplayCapture() noexcept {
    has_snapshot_ = false;
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
    if (displaySampleCount() > kMaxRawSamples) {
      publishRollingEnvelope();
      return;
    }
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
    capture_bucket_begin_ = 0u;
    capture_bucket_end_ =
        capture_target_samples_ /
        (capture_target_samples_ > kRingSamples ? kEnvelopeBuckets : kM4BucketCount);
    if (capture_target_samples_ > kRingSamples) {
      writeEnvelopeHeader(building_payload_, kEnvelopeBuckets, 0u, 0u, 0u);
      return;
    }
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
      if (!capture_bucket_initialized_) {
        capture_bucket_first_ = sample;
        capture_bucket_minimum_ = sample;
        capture_bucket_maximum_ = sample;
        capture_bucket_minimum_index_ = 0u;
        capture_bucket_maximum_index_ = 0u;
        capture_bucket_initialized_ = true;
      } else {
        const std::uint32_t bucket_index = capture_index - capture_bucket_begin_;
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
      if (capture_index + 1u == capture_bucket_end_) {
        const bool envelope = capture_target_samples_ > kRingSamples;
        if (envelope) {
          const std::uint32_t offset = kEnvelopeHeaderBytes + capture_bucket_ * 8u;
          writeF32(building_payload_.data() + offset, capture_bucket_minimum_);
          writeF32(building_payload_.data() + offset + 4u, capture_bucket_maximum_);
        } else {
          const std::uint32_t offset = kPayloadHeaderBytes + capture_bucket_ * kM4BucketBytes;
          writeF32(building_payload_.data() + offset, capture_bucket_first_);
          writeF32(building_payload_.data() + offset + 4u, capture_bucket_minimum_);
          writeF32(building_payload_.data() + offset + 8u, capture_bucket_maximum_);
          writeF32(building_payload_.data() + offset + 12u, capture_bucket_last_);
          building_payload_[offset + 16u] = capture_bucket_minimum_index_;
          building_payload_[offset + 17u] = capture_bucket_maximum_index_;
        }
        ++capture_bucket_;
        capture_bucket_begin_ = capture_bucket_end_;
        capture_bucket_end_ = static_cast<std::uint32_t>(
            (static_cast<std::uint64_t>(capture_bucket_ + 1u) * capture_target_samples_) /
            (envelope ? kEnvelopeBuckets : kM4BucketCount));
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
    } else if (capture_target_samples_ <= kRingSamples) {
      payload_bytes_ =
          static_cast<std::uint16_t>(kPayloadHeaderBytes + kM4BucketCount * kM4BucketBytes);
    } else {
      payload_bytes_ = static_cast<std::uint16_t>(kEnvelopeHeaderBytes + kEnvelopeBuckets * 8u);
    }
    payload_.swap(building_payload_);
    has_snapshot_ = true;
  }

  void writeEnvelopeHeader(std::vector<std::uint8_t> &payload, std::uint32_t bucket_count,
                           std::uint32_t bucket_samples, std::uint64_t end_sample,
                           std::uint8_t flags) noexcept {
    writePayloadHeader(payload, static_cast<std::uint16_t>(bucket_count), kEnvelopeEncoding);
    payload[15u] = flags | (capture_triggered_ ? kTriggeredFlag : 0u);
    writeU32(payload.data() + 16u, bucket_samples);
    writeU32(payload.data() + 20u, static_cast<std::uint32_t>(end_sample));
    writeU32(payload.data() + 24u, static_cast<std::uint32_t>(end_sample >> 32u));
  }

  void publishRollingEnvelope() noexcept {
    if (rolling_samples_ == 0u) {
      return;
    }
    capture_target_samples_ = displaySampleCount();
    capture_triggered_ = false;
    // Keep a short overlap for render-time interpolation between telemetry updates.
    std::uint32_t overlap = static_cast<std::uint32_t>(sample_rate_ * 0.1F);
    const std::uint32_t max_overlap =
        rolling_bucket_samples_ * (kMaxEnvelopeBuckets - kEnvelopeBuckets - 2u);
    if (overlap > max_overlap) {
      overlap = max_overlap;
    }
    const std::uint64_t history = static_cast<std::uint64_t>(capture_target_samples_) + overlap;
    const std::uint64_t first =
        (rolling_samples_ > history ? rolling_samples_ - history : 0u) / rolling_bucket_samples_;
    const std::uint64_t last = (rolling_samples_ - 1u) / rolling_bucket_samples_;
    const auto count = static_cast<std::uint32_t>(last - first + 1u);
    writeEnvelopeHeader(payload_, count, rolling_bucket_samples_, rolling_samples_, kRollingFlag);
    for (std::uint32_t bucket = 0u; bucket < count; ++bucket) {
      const std::uint32_t index = static_cast<std::uint32_t>((first + bucket) & kEnvelopeRingMask);
      writeF32(payload_.data() + kEnvelopeHeaderBytes + bucket * 8u, envelope_[index * 2u]);
      writeF32(payload_.data() + kEnvelopeHeaderBytes + bucket * 8u + 4u,
               envelope_[index * 2u + 1u]);
    }
    payload_bytes_ = static_cast<std::uint16_t>(kEnvelopeHeaderBytes + count * 8u);
    has_snapshot_ = true;
  }

  std::vector<float> ring_;
  std::vector<float> envelope_;
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
  std::uint32_t capture_bucket_begin_ = 0u;
  std::uint32_t capture_bucket_end_ = 0u;
  std::uint32_t rolling_bucket_samples_ = 1u;
  std::uint32_t rolling_bucket_index_ = 0u;
  std::uint32_t rolling_bucket_fill_ = 0u;
  std::uint64_t rolling_samples_ = 0u;
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

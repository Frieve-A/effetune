#include "effetune/kernel.h"
#include "StereoMeterPluginParams.h"
#include "binary_io.h"

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
constexpr std::uint32_t kBucketSamples = 64u;
constexpr std::uint32_t kBucketsPerSuperBucket = 64u;
constexpr std::uint32_t kSuperBucketSamples = kBucketSamples * kBucketsPerSuperBucket;
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
constexpr double kEnvelopeScaleRenormalizeThreshold = 1.0e-100;

static_assert(kMaxPayloadBytes == 65464u);
static_assert(kMaxPayloadBytes <= std::numeric_limits<std::uint16_t>::max());

using binary_io::writeF32;
using binary_io::writeU16;
using binary_io::writeU32;

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

struct WindowBucket {
  double sum_lr = 0.0;
  double sum_l2 = 0.0;
  double sum_r2 = 0.0;
  float peak_left = 0.0F;
  float peak_right = 0.0F;
  std::uint64_t start_sample = std::numeric_limits<std::uint64_t>::max();
};

} // namespace

class StereoMeterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::StereoMeterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ =
        std::isfinite(info.sampleRate) && info.sampleRate > 0.0F ? info.sampleRate : 48000.0F;
    envelope_decay_per_sample_ = std::exp(-kLogTen / static_cast<double>(sample_rate_));
    const double required = std::ceil(static_cast<double>(sample_rate_));
    ring_capacity_ = required < 1.0 ? 1u : static_cast<std::uint32_t>(required);
    left_ring_.resize(ring_capacity_);
    right_ring_.resize(ring_capacity_);
    window_buckets_.resize((ring_capacity_ + kBucketSamples - 1u) / kBucketSamples + 1u);
    window_super_buckets_.resize((ring_capacity_ + kSuperBucketSamples - 1u) / kSuperBucketSamples +
                                 1u);
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
    for (double &peak : angle_envelope_) {
      peak = 0.0F;
    }
    for (std::uint8_t &byte : payload_) {
      byte = 0u;
    }
    for (WindowBucket &bucket : window_buckets_) {
      bucket = {};
    }
    for (WindowBucket &bucket : window_super_buckets_) {
      bucket = {};
    }
    write_position_ = 0u;
    active_window_time_ = 0.1F;
    pending_sample_count_ = 0u;
    incremental_delta_sample_count_ = 0u;
    absolute_sample_count_ = 0u;
    envelope_scale_ = 1.0;
    payload_bytes_ = 0u;
    has_samples_ = false;
    parameter_state_initialized_ = false;
    pending_discontinuity_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
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
      writeIncrementalDelta(left, right);
      left_ring_[write_position_] = left;
      right_ring_[write_position_] = right;
      write_position_ = write_position_ + 1u == ring_capacity_ ? 0u : write_position_ + 1u;
      updateWindowBucket(left, right);
      advanceAngleEnvelope();
      updateAngleEnvelope(left, right);
      ++absolute_sample_count_;
    }
    if (frame_count > ring_capacity_ - pending_sample_count_) {
      pending_sample_count_ = ring_capacity_;
      pending_discontinuity_ = true;
    } else {
      pending_sample_count_ += frame_count;
    }
    has_samples_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!has_samples_) {
      return;
    }
    buildPayload();
    writer.write(kTapStereoField, kTelemetryVersion, payload_.data(), payload_bytes_);
    pending_sample_count_ = 0u;
    incremental_delta_sample_count_ = 0u;
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
    double &peak = angle_envelope_[static_cast<std::uint32_t>(angle_index)];
    if (magnitude > peak * envelope_scale_) {
      peak = magnitude / envelope_scale_;
    }
  }

  void advanceAngleEnvelope() noexcept {
    // One shared scale preserves per-sample decay without sweeping every angle bin.
    envelope_scale_ *= envelope_decay_per_sample_;
    if (envelope_scale_ >= kEnvelopeScaleRenormalizeThreshold) {
      return;
    }
    for (double &peak : angle_envelope_) {
      peak *= envelope_scale_;
    }
    envelope_scale_ = 1.0;
  }

  void writeIncrementalDelta(float left, float right) noexcept {
    if (incremental_delta_sample_count_ >= kMaxDeltaSamples) {
      return;
    }
    const std::uint32_t offset =
        kPayloadHeaderBytes + incremental_delta_sample_count_ * kSampleBytes;
    writeF32(payload_.data() + offset, coordinateToFloat(static_cast<double>(right) - left));
    writeF32(payload_.data() + offset + 4u, coordinateToFloat(static_cast<double>(left) + right));
    ++incremental_delta_sample_count_;
  }

  void updateWindowBucket(float left, float right) noexcept {
    const std::uint32_t sample_in_bucket =
        static_cast<std::uint32_t>(absolute_sample_count_ % kBucketSamples);
    WindowBucket &bucket = window_buckets_[static_cast<std::size_t>(
        (absolute_sample_count_ / kBucketSamples) % window_buckets_.size())];
    if (sample_in_bucket == 0u) {
      bucket = {};
      bucket.start_sample = absolute_sample_count_;
    }
    const float absolute_left = left < 0.0F ? -left : left;
    const float absolute_right = right < 0.0F ? -right : right;
    bucket.peak_left = absolute_left > bucket.peak_left ? absolute_left : bucket.peak_left;
    bucket.peak_right = absolute_right > bucket.peak_right ? absolute_right : bucket.peak_right;
    const double left_value = static_cast<double>(left);
    const double right_value = static_cast<double>(right);
    bucket.sum_lr += left_value * right_value;
    bucket.sum_l2 += left_value * left_value;
    bucket.sum_r2 += right_value * right_value;
    if (sample_in_bucket + 1u != kBucketSamples) {
      return;
    }

    // Fold completed small buckets into a second level so long windows stay bounded at publish.
    const std::uint64_t bucket_start = bucket.start_sample;
    WindowBucket &super_bucket = window_super_buckets_[static_cast<std::size_t>(
        (bucket_start / kSuperBucketSamples) % window_super_buckets_.size())];
    if (bucket_start % kSuperBucketSamples == 0u) {
      super_bucket = {};
      super_bucket.start_sample = bucket_start;
    }
    super_bucket.sum_lr += bucket.sum_lr;
    super_bucket.sum_l2 += bucket.sum_l2;
    super_bucket.sum_r2 += bucket.sum_r2;
    super_bucket.peak_left =
        bucket.peak_left > super_bucket.peak_left ? bucket.peak_left : super_bucket.peak_left;
    super_bucket.peak_right =
        bucket.peak_right > super_bucket.peak_right ? bucket.peak_right : super_bucket.peak_right;
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
    double sum_lr = 0.0;
    double sum_l2 = 0.0;
    double sum_r2 = 0.0;
    float peak_left = 0.0F;
    float peak_right = 0.0F;

    const auto addSample = [&](std::uint64_t sample_position) noexcept {
      const std::uint32_t position = static_cast<std::uint32_t>(sample_position % ring_capacity_);
      const float left = left_ring_[position];
      const float right = right_ring_[position];
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
    };
    const auto addBucket = [&](const WindowBucket &bucket, std::uint64_t expected_start) noexcept {
      if (bucket.start_sample != expected_start) {
        return false;
      }
      sum_lr += bucket.sum_lr;
      sum_l2 += bucket.sum_l2;
      sum_r2 += bucket.sum_r2;
      peak_left = bucket.peak_left > peak_left ? bucket.peak_left : peak_left;
      peak_right = bucket.peak_right > peak_right ? bucket.peak_right : peak_right;
      return true;
    };
    const std::uint64_t window_start =
        absolute_sample_count_ > sample_count ? absolute_sample_count_ - sample_count : 0u;
    std::uint64_t sample_position = window_start;
    while (sample_position < absolute_sample_count_ && sample_position % kBucketSamples != 0u) {
      addSample(sample_position++);
    }
    while (sample_position + kBucketSamples <= absolute_sample_count_ &&
           sample_position % kSuperBucketSamples != 0u) {
      const WindowBucket &bucket = window_buckets_[static_cast<std::size_t>(
          (sample_position / kBucketSamples) % window_buckets_.size())];
      if (!addBucket(bucket, sample_position)) {
        for (std::uint32_t sample = 0u; sample < kBucketSamples; ++sample) {
          addSample(sample_position + sample);
        }
      }
      sample_position += kBucketSamples;
    }
    while (sample_position + kSuperBucketSamples <= absolute_sample_count_) {
      const WindowBucket &bucket = window_super_buckets_[static_cast<std::size_t>(
          (sample_position / kSuperBucketSamples) % window_super_buckets_.size())];
      if (!addBucket(bucket, sample_position)) {
        for (std::uint32_t sample = 0u; sample < kSuperBucketSamples; ++sample) {
          addSample(sample_position + sample);
        }
      }
      sample_position += kSuperBucketSamples;
    }
    while (sample_position + kBucketSamples <= absolute_sample_count_) {
      const WindowBucket &bucket = window_buckets_[static_cast<std::size_t>(
          (sample_position / kBucketSamples) % window_buckets_.size())];
      if (!addBucket(bucket, sample_position)) {
        for (std::uint32_t sample = 0u; sample < kBucketSamples; ++sample) {
          addSample(sample_position + sample);
        }
      }
      sample_position += kBucketSamples;
    }
    while (sample_position < absolute_sample_count_) {
      addSample(sample_position++);
    }

    const bool truncated = pending_sample_count_ > kMaxDeltaSamples;
    const bool use_incremental_delta = !pending_discontinuity_ && !truncated &&
                                       incremental_delta_sample_count_ == pending_sample_count_;
    const std::uint32_t delta_sample_count = truncated ? kMaxDeltaSamples : pending_sample_count_;
    writeF32(payload_.data(), sample_rate_);
    writeU16(payload_.data() + 4u, static_cast<std::uint16_t>(delta_sample_count));
    writeU16(payload_.data() + 6u,
             pending_discontinuity_ || truncated ? kSampleFlagDiscontinuity : 0u);

    if (!use_incremental_delta) {
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
    }

    const std::uint32_t envelope_offset = kPayloadHeaderBytes + delta_sample_count * kSampleBytes;
    for (std::uint32_t bin = 0u; bin < kEnvelopeBinCount; ++bin) {
      writeF32(payload_.data() + envelope_offset + bin * 4u,
               coordinateToFloat(angle_envelope_[bin] * envelope_scale_));
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
  std::vector<WindowBucket> window_buckets_;
  std::vector<WindowBucket> window_super_buckets_;
  std::vector<std::uint8_t> payload_;
  std::array<double, kEnvelopeBinCount> angle_envelope_{};
  float sample_rate_ = 48000.0F;
  float active_window_time_ = 0.1F;
  double envelope_decay_per_sample_ = 1.0;
  double envelope_scale_ = 1.0;
  std::uint32_t ring_capacity_ = 0u;
  std::uint32_t write_position_ = 0u;
  std::uint32_t pending_sample_count_ = 0u;
  std::uint32_t incremental_delta_sample_count_ = 0u;
  std::uint16_t payload_bytes_ = 0u;
  std::uint64_t absolute_sample_count_ = 0u;
  bool has_samples_ = false;
  bool parameter_state_initialized_ = false;
  bool pending_discontinuity_ = false;
};

} // namespace effetune::plugins::analyzer

EFFETUNE_REGISTER_KERNEL(StereoMeterPlugin, effetune::plugins::analyzer::StereoMeterKernel)

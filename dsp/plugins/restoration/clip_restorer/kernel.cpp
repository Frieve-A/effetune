#include "effetune/kernel.h"
#include "ClipRestorerPluginParams.h"
#include "effetune/dsp/ar_interpolator.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace effetune::plugins::restoration {
namespace {

constexpr std::uint32_t kArOrder = dsp::kArMaximumOrder;
constexpr std::uint32_t kArContextSamples = 512u;
constexpr std::uint32_t kPostContextSamples = 64u;
constexpr std::uint32_t kArUpdateSamples = 64u;
constexpr std::uint32_t kJoinSamples = 8u;
constexpr std::uint32_t kGuardSamples = 2u;
constexpr std::uint32_t kMinimumPlateauSamples = 3u;
constexpr std::uint32_t kPendingIntervalCapacity = 32u;
constexpr double kAutocorrelationTimeConstant = 0.020;
constexpr double kTelemetryTimeConstant = 0.1;
constexpr double kMaximumOvershoot = 4.0;
constexpr std::uint16_t kTelemetryFrameType = 22u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint64_t kNoRepairedSample = std::numeric_limits<std::uint64_t>::max();

void writeRestoredPercent(TelemetryWriter &writer, float restored_percent) noexcept {
  writer.write(kTelemetryFrameType, kTelemetryVersion, &restored_percent,
               static_cast<std::uint16_t>(sizeof(restored_percent)));
}

struct RepairInterval {
  std::uint64_t begin = 0u;
  std::uint64_t end = 0u;
  double threshold = 0.0;
  bool positive = true;
};

struct ClipChannelState {
  dsp::ArAutocorrelation autocorrelation;
  std::array<double, kArOrder> coefficients{};
  std::array<float, 2u * kArOrder> history{};
  std::array<RepairInterval, kPendingIntervalCapacity> pending{};
  std::uint32_t history_count = 0u;
  std::uint32_t history_write = 0u;
  std::uint32_t ar_counter = 0u;
  std::uint32_t warmup_count = 0u;
  std::uint32_t pending_read = 0u;
  std::uint32_t pending_count = 0u;
  std::uint64_t plateau_begin = 0u;
  std::uint64_t last_repaired_sample = kNoRepairedSample;
  double plateau_threshold = 0.0;
  bool ar_valid = false;
  bool plateau_active = false;
  bool plateau_positive = true;
};

} // namespace

class ClipRestorerKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::ClipRestorerPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    prepared_ = false;
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    if (!std::isfinite(sample_rate_) || sample_rate_ <= 0.0 || max_channels_ == 0u ||
        max_frames_ == 0u) {
      return;
    }

    max_repair_samples_ = static_cast<std::uint32_t>(std::lround(0.002 * sample_rate_));
    if (max_repair_samples_ == 0u) {
      max_repair_samples_ = 1u;
    }
    lookahead_samples_ = max_repair_samples_ + kJoinSamples + kGuardSamples + kPostContextSamples;
    ring_stride_ = max_repair_samples_ + kPostContextSamples + kArOrder;
    delayed_ring_offset_ = ring_stride_ - lookahead_samples_;
    window_stride_ = max_repair_samples_ + 2u * kArOrder;
    scratch_stride_ = max_repair_samples_ * (kArOrder + 4u);
    telemetry_alpha_ = 1.0 - std::exp(-1.0 / (kTelemetryTimeConstant * sample_rate_));

    channels_.resize(max_channels_);
    sample_ring_.assign(static_cast<std::size_t>(max_channels_) * ring_stride_, 0.0F);
    repair_window_.assign(static_cast<std::size_t>(max_channels_) * window_stride_, 0.0);
    repair_scratch_.assign(static_cast<std::size_t>(max_channels_) * scratch_stride_, 0.0);
    for (ClipChannelState &state : channels_) {
      state.autocorrelation.prepare(sample_rate_, kAutocorrelationTimeConstant);
    }
    prepared_ = true;
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  void reset() noexcept override {
    std::fill(sample_ring_.begin(), sample_ring_.end(), 0.0F);
    std::fill(repair_window_.begin(), repair_window_.end(), 0.0);
    std::fill(repair_scratch_.begin(), repair_scratch_.end(), 0.0);
    for (ClipChannelState &state : channels_) {
      state.autocorrelation.reset();
      state.coefficients.fill(0.0);
      state.history.fill(0.0F);
      state.pending.fill(RepairInterval{});
      state.history_count = 0u;
      state.history_write = 0u;
      state.ar_counter = 0u;
      state.warmup_count = 0u;
      state.pending_read = 0u;
      state.pending_count = 0u;
      state.plateau_begin = 0u;
      state.last_repaired_sample = kNoRepairedSample;
      state.plateau_threshold = 0.0;
      state.ar_valid = false;
      state.plateau_active = false;
      state.plateau_positive = true;
    }
    absolute_sample_ = 0u;
    ring_position_ = 0u;
    last_channel_count_ = 0u;
    restored_percent_ = 0.0;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }
    if (last_channel_count_ != 0u && last_channel_count_ != channel_count) {
      reset();
    }
    last_channel_count_ = channel_count;

    double threshold_db = static_cast<double>(params_.threshold);
    if (threshold_db < -18.0) {
      threshold_db = -18.0;
    } else if (threshold_db > 0.0) {
      threshold_db = 0.0;
    }
    const double threshold = std::exp(threshold_db * 0.1151292546497022842);
    double output_gain_db = static_cast<double>(params_.outputGain);
    if (output_gain_db < -12.0) {
      output_gain_db = -12.0;
    } else if (output_gain_db > 0.0) {
      output_gain_db = 0.0;
    }
    const float output_gain = static_cast<float>(std::exp(output_gain_db * 0.1151292546497022842));

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      std::uint32_t restored_samples = 0u;
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t block_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const float input = std::isfinite(audio[block_index]) ? audio[block_index] : 0.0F;
        restored_samples += processSample(channel, input, threshold);
        audio[block_index] = delayedSample(channel) * output_gain;
      }
      const double instantaneous_percent =
          100.0 * static_cast<double>(restored_samples) / static_cast<double>(channel_count);
      restored_percent_ += (instantaneous_percent - restored_percent_) * telemetry_alpha_;
      if (++ring_position_ == ring_stride_) {
        ring_position_ = 0u;
      }
      ++absolute_sample_;
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      channels_[channel].autocorrelation.flushDenormals();
    }
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return prepared_ ? lookahead_samples_ : 0u;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    writeRestoredPercent(writer, static_cast<float>(restored_percent_));
  }

private:
  [[nodiscard]] std::size_t ringIndex(std::uint32_t channel, std::uint64_t sample) const noexcept {
    return static_cast<std::size_t>(channel) * ring_stride_ +
           static_cast<std::size_t>(sample % ring_stride_);
  }

  void appendHistory(ClipChannelState &state, float sample) noexcept {
    if (state.history_count < kArOrder) {
      const std::uint32_t write = state.history_count++;
      state.history[write] = sample;
      state.history[write + kArOrder] = sample;
      return;
    }
    state.history[state.history_write] = sample;
    state.history[state.history_write + kArOrder] = sample;
    if (++state.history_write == kArOrder) {
      state.history_write = 0u;
    }
  }

  void enqueueInterval(ClipChannelState &state, std::uint64_t begin, std::uint64_t end,
                       double threshold, bool positive) noexcept {
    if (end <= begin || end - begin < kMinimumPlateauSamples ||
        state.pending_count >= kPendingIntervalCapacity) {
      return;
    }
    const std::uint32_t write =
        (state.pending_read + state.pending_count) % kPendingIntervalCapacity;
    state.pending[write] = {begin, end, threshold, positive};
    ++state.pending_count;
  }

  void closePlateau(ClipChannelState &state) noexcept {
    if (!state.plateau_active) {
      return;
    }
    enqueueInterval(state, state.plateau_begin, absolute_sample_, state.plateau_threshold,
                    state.plateau_positive);
    state.plateau_active = false;
  }

  void updatePlateauState(ClipChannelState &state, float input, double threshold) noexcept {
    const double value = static_cast<double>(input);
    const double magnitude = value < 0.0 ? -value : value;
    const bool qualifies = magnitude >= threshold;
    const bool positive = value >= 0.0;
    if (!qualifies) {
      closePlateau(state);
      return;
    }
    if (state.plateau_active && state.plateau_positive == positive) {
      return;
    }
    closePlateau(state);
    state.plateau_active = true;
    state.plateau_begin = absolute_sample_;
    state.plateau_threshold = threshold;
    state.plateau_positive = positive;
  }

  [[nodiscard]] bool repairedContextTooClose(const ClipChannelState &state,
                                             std::uint64_t begin) const noexcept {
    if (state.last_repaired_sample == kNoRepairedSample) {
      return false;
    }
    if (state.last_repaired_sample >= begin) {
      return true;
    }
    return begin - state.last_repaired_sample <= kArOrder;
  }

  [[nodiscard]] bool repairInterval(std::uint32_t channel, ClipChannelState &state,
                                    const RepairInterval &interval) noexcept {
    const std::uint64_t length64 = interval.end - interval.begin;
    if (length64 == 0u || length64 > max_repair_samples_ || interval.begin < kArOrder ||
        state.warmup_count < kArContextSamples || !state.ar_valid ||
        repairedContextTooClose(state, interval.begin)) {
      return false;
    }

    const std::uint32_t gap = static_cast<std::uint32_t>(length64);
    double *window = repair_window_.data() + static_cast<std::size_t>(channel) * window_stride_;
    double *scratch = repair_scratch_.data() + static_cast<std::size_t>(channel) * scratch_stride_;
    const std::uint64_t window_begin = interval.begin - kArOrder;
    const std::uint32_t window_samples = gap + 2u * kArOrder;
    const double sign = interval.positive ? 1.0 : -1.0;
    float *ring = sample_ring_.data() + static_cast<std::size_t>(channel) * ring_stride_;
    const std::uint32_t window_ring_offset =
        static_cast<std::uint32_t>(window_begin % ring_stride_);
    const std::uint32_t contiguous_window_samples =
        window_samples < ring_stride_ - window_ring_offset ? window_samples
                                                           : ring_stride_ - window_ring_offset;
    for (std::uint32_t offset = 0u; offset < contiguous_window_samples; ++offset) {
      window[offset] = sign * static_cast<double>(ring[window_ring_offset + offset]);
    }
    for (std::uint32_t offset = contiguous_window_samples; offset < window_samples; ++offset) {
      window[offset] = sign * static_cast<double>(ring[offset - contiguous_window_samples]);
    }
    if (!dsp::interpolateArGapBounded(window, kArOrder, gap, kArOrder, state.coefficients.data(),
                                      kArOrder, interval.threshold,
                                      kMaximumOvershoot * interval.threshold, scratch)) {
      return false;
    }
    const std::uint32_t gap_ring_offset = static_cast<std::uint32_t>(interval.begin % ring_stride_);
    const std::uint32_t contiguous_gap_samples =
        gap < ring_stride_ - gap_ring_offset ? gap : ring_stride_ - gap_ring_offset;
    for (std::uint32_t offset = 0u; offset < contiguous_gap_samples; ++offset) {
      ring[gap_ring_offset + offset] = static_cast<float>(sign * window[kArOrder + offset]);
    }
    for (std::uint32_t offset = contiguous_gap_samples; offset < gap; ++offset) {
      ring[offset - contiguous_gap_samples] = static_cast<float>(sign * window[kArOrder + offset]);
    }
    state.last_repaired_sample = interval.end - 1u;
    return true;
  }

  [[nodiscard]] std::uint32_t repairDueIntervals(std::uint32_t channel,
                                                 ClipChannelState &state) noexcept {
    std::uint32_t restored_samples = 0u;
    while (state.pending_count != 0u) {
      const RepairInterval interval = state.pending[state.pending_read];
      const std::uint64_t repair_time = interval.end + kPostContextSamples - 1u;
      if (repair_time > absolute_sample_) {
        break;
      }
      if (repair_time == absolute_sample_ && repairInterval(channel, state, interval)) {
        restored_samples += static_cast<std::uint32_t>(interval.end - interval.begin);
      }
      state.pending_read = (state.pending_read + 1u) % kPendingIntervalCapacity;
      --state.pending_count;
    }
    return restored_samples;
  }

  [[nodiscard]] std::uint32_t processSample(std::uint32_t channel, float input,
                                            double threshold) noexcept {
    ClipChannelState &state = channels_[channel];
    sample_ring_[static_cast<std::size_t>(channel) * ring_stride_ + ring_position_] = input;
    const float *history = state.history.data();
    if (state.history_count == kArOrder) {
      history += state.history_write;
    }
    state.autocorrelation.update(&input, 1u, history, state.history_count);
    if (state.warmup_count < kArContextSamples) {
      ++state.warmup_count;
    }
    if (++state.ar_counter >= kArUpdateSamples) {
      state.ar_counter = 0u;
      state.ar_valid = dsp::solveArCoefficients(state.autocorrelation.lags(), kArOrder,
                                                state.coefficients.data());
      if (!state.ar_valid) {
        state.coefficients.fill(0.0);
      }
    }
    appendHistory(state, input);
    updatePlateauState(state, input, threshold);
    return repairDueIntervals(channel, state);
  }

  [[nodiscard]] float delayedSample(std::uint32_t channel) const noexcept {
    if (absolute_sample_ < lookahead_samples_) {
      return 0.0F;
    }
    std::uint32_t delayed_position = ring_position_ + delayed_ring_offset_;
    if (delayed_position >= ring_stride_) {
      delayed_position -= ring_stride_;
    }
    return sample_ring_[static_cast<std::size_t>(channel) * ring_stride_ + delayed_position];
  }

  std::vector<ClipChannelState> channels_;
  std::vector<float> sample_ring_;
  std::vector<double> repair_window_;
  std::vector<double> repair_scratch_;
  double sample_rate_ = 0.0;
  double telemetry_alpha_ = 0.0;
  double restored_percent_ = 0.0;
  std::uint64_t absolute_sample_ = 0u;
  std::uint32_t ring_position_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t max_repair_samples_ = 0u;
  std::uint32_t lookahead_samples_ = 0u;
  std::uint32_t ring_stride_ = 0u;
  std::uint32_t delayed_ring_offset_ = 0u;
  std::uint32_t window_stride_ = 0u;
  std::uint32_t scratch_stride_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool prepared_ = false;
};

static_assert(sizeof(ClipRestorerKernel) <= 8192u);

} // namespace effetune::plugins::restoration

EFFETUNE_REGISTER_KERNEL(ClipRestorerPlugin, effetune::plugins::restoration::ClipRestorerKernel)

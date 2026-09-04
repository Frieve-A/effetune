#include "effetune/kernel.h"
#include "ClickRemoverPluginParams.h"
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
constexpr std::uint32_t kPendingIntervalCapacity = 16u;
constexpr double kAutocorrelationTimeConstant = 0.020;
constexpr double kMadTimeConstant = 0.005;
constexpr double kTelemetryTimeConstant = 0.1;
constexpr double kSustainRejectRatio = 3.0;
constexpr double kEpsilon = 1.0e-12;
constexpr double kDenormalFlush = 1.0e-20;
constexpr std::uint16_t kTelemetryFrameType = 21u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint64_t kNoRepairedSample = std::numeric_limits<std::uint64_t>::max();

void writeRepairsPerSecond(TelemetryWriter &writer, float repairs_per_second) noexcept {
  writer.write(kTelemetryFrameType, kTelemetryVersion, &repairs_per_second,
               static_cast<std::uint16_t>(sizeof(repairs_per_second)));
}

struct RepairInterval {
  std::uint64_t begin = 0u;
  std::uint64_t end = 0u;
};

struct ClickChannelState {
  dsp::ArAutocorrelation autocorrelation;
  std::array<double, kArOrder> coefficients{};
  std::array<float, kArOrder> history{};
  std::array<RepairInterval, kPendingIntervalCapacity> pending{};
  std::uint32_t history_count = 0u;
  std::uint32_t ar_counter = 0u;
  std::uint32_t warmup_count = 0u;
  std::uint32_t pending_read = 0u;
  std::uint32_t pending_count = 0u;
  std::uint64_t candidate_begin = 0u;
  std::uint64_t last_candidate = 0u;
  std::uint64_t last_repaired_sample = kNoRepairedSample;
  double mad = 0.0;
  bool ar_valid = false;
  bool candidate_active = false;
};

} // namespace

class ClickRemoverKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::ClickRemoverPluginParams)

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
    window_stride_ = max_repair_samples_ + 2u * kArOrder;
    scratch_stride_ = max_repair_samples_ * (kArOrder + 2u);
    mad_alpha_ = 1.0 - std::exp(-1.0 / (kMadTimeConstant * sample_rate_));
    telemetry_alpha_ = 1.0 - std::exp(-1.0 / (kTelemetryTimeConstant * sample_rate_));

    channels_.resize(max_channels_);
    sample_ring_.assign(static_cast<std::size_t>(max_channels_) * ring_stride_, 0.0F);
    normalized_ring_.assign(static_cast<std::size_t>(max_channels_) * ring_stride_, 0.0);
    repair_window_.assign(static_cast<std::size_t>(max_channels_) * window_stride_, 0.0);
    repair_scratch_.assign(static_cast<std::size_t>(max_channels_) * scratch_stride_, 0.0);
    for (ClickChannelState &state : channels_) {
      state.autocorrelation.prepare(sample_rate_, kAutocorrelationTimeConstant);
    }
    prepared_ = true;
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  void reset() noexcept override {
    std::fill(sample_ring_.begin(), sample_ring_.end(), 0.0F);
    std::fill(normalized_ring_.begin(), normalized_ring_.end(), 0.0);
    std::fill(repair_window_.begin(), repair_window_.end(), 0.0);
    std::fill(repair_scratch_.begin(), repair_scratch_.end(), 0.0);
    for (ClickChannelState &state : channels_) {
      state.autocorrelation.reset();
      state.coefficients.fill(0.0);
      state.history.fill(0.0F);
      state.pending.fill(RepairInterval{});
      state.history_count = 0u;
      state.ar_counter = 0u;
      state.warmup_count = 0u;
      state.pending_read = 0u;
      state.pending_count = 0u;
      state.candidate_begin = 0u;
      state.last_candidate = 0u;
      state.last_repaired_sample = kNoRepairedSample;
      state.mad = 0.0;
      state.ar_valid = false;
      state.candidate_active = false;
    }
    absolute_sample_ = 0u;
    last_channel_count_ = 0u;
    repairs_per_second_ = 0.0;
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

    double sensitivity = static_cast<double>(params_.sensitivity);
    if (sensitivity < 0.0) {
      sensitivity = 0.0;
    } else if (sensitivity > 100.0) {
      sensitivity = 100.0;
    }
    const double threshold = 20.0 - 0.16 * sensitivity;
    double maximum_repair_ms = static_cast<double>(params_.maxRepairLength);
    if (maximum_repair_ms < 0.1) {
      maximum_repair_ms = 0.1;
    } else if (maximum_repair_ms > 2.0) {
      maximum_repair_ms = 2.0;
    }
    std::uint32_t allowed_repair_samples =
        static_cast<std::uint32_t>(std::lround(maximum_repair_ms * 0.001 * sample_rate_));
    if (allowed_repair_samples == 0u) {
      allowed_repair_samples = 1u;
    } else if (allowed_repair_samples > max_repair_samples_) {
      allowed_repair_samples = max_repair_samples_;
    }

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      std::uint32_t repaired_events = 0u;
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t block_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const float input = std::isfinite(audio[block_index]) ? audio[block_index] : 0.0F;
        repaired_events += processSample(channel, input, threshold, allowed_repair_samples);
        audio[block_index] = delayedSample(channel);
      }
      const double instantaneous_rate = static_cast<double>(repaired_events) * sample_rate_;
      repairs_per_second_ += (instantaneous_rate - repairs_per_second_) * telemetry_alpha_;
      ++absolute_sample_;
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      ClickChannelState &state = channels_[channel];
      state.autocorrelation.flushDenormals();
      const double mad_magnitude = state.mad < 0.0 ? -state.mad : state.mad;
      if (mad_magnitude < kDenormalFlush) {
        state.mad = 0.0;
      }
    }
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return prepared_ ? lookahead_samples_ : 0u;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    writeRepairsPerSecond(writer, static_cast<float>(repairs_per_second_));
  }

private:
  [[nodiscard]] std::size_t ringIndex(std::uint32_t channel, std::uint64_t sample) const noexcept {
    return static_cast<std::size_t>(channel) * ring_stride_ +
           static_cast<std::size_t>(sample % ring_stride_);
  }

  void appendHistory(ClickChannelState &state, float sample) noexcept {
    if (state.history_count < kArOrder) {
      state.history[state.history_count++] = sample;
      return;
    }
    for (std::uint32_t index = 1u; index < kArOrder; ++index) {
      state.history[index - 1u] = state.history[index];
    }
    state.history[kArOrder - 1u] = sample;
  }

  void enqueueInterval(ClickChannelState &state, std::uint64_t begin, std::uint64_t end) noexcept {
    if (end <= begin || state.pending_count >= kPendingIntervalCapacity) {
      return;
    }
    const std::uint32_t write =
        (state.pending_read + state.pending_count) % kPendingIntervalCapacity;
    state.pending[write] = {begin, end};
    ++state.pending_count;
  }

  void updateCandidateState(ClickChannelState &state, bool candidate) noexcept {
    if (candidate) {
      if (!state.candidate_active) {
        state.candidate_active = true;
        state.candidate_begin = absolute_sample_;
      }
      state.last_candidate = absolute_sample_;
      return;
    }
    if (!state.candidate_active || absolute_sample_ < state.last_candidate + kJoinSamples + 1u) {
      return;
    }

    const std::uint64_t begin =
        state.candidate_begin > kGuardSamples ? state.candidate_begin - kGuardSamples : 0u;
    const std::uint64_t end = state.last_candidate + kGuardSamples + 1u;
    enqueueInterval(state, begin, end);
    state.candidate_active = false;
  }

  [[nodiscard]] bool repairedContextTooClose(const ClickChannelState &state,
                                             std::uint64_t begin) const noexcept {
    if (state.last_repaired_sample == kNoRepairedSample) {
      return false;
    }
    if (state.last_repaired_sample >= begin) {
      return true;
    }
    return begin - state.last_repaired_sample <= kArContextSamples;
  }

  [[nodiscard]] bool repairInterval(std::uint32_t channel, ClickChannelState &state,
                                    const RepairInterval &interval,
                                    std::uint32_t allowed_repair_samples) noexcept {
    const std::uint64_t length64 = interval.end - interval.begin;
    if (length64 == 0u || length64 > allowed_repair_samples || interval.begin < kArOrder ||
        repairedContextTooClose(state, interval.begin) || !state.ar_valid) {
      return false;
    }

    double post_mean = 0.0;
    for (std::uint32_t offset = 0u; offset < kPostContextSamples; ++offset) {
      post_mean += normalized_ring_[ringIndex(channel, interval.end + offset)];
    }
    post_mean /= static_cast<double>(kPostContextSamples);
    if (post_mean > kSustainRejectRatio) {
      return false;
    }

    const std::uint32_t gap = static_cast<std::uint32_t>(length64);
    double *window = repair_window_.data() + static_cast<std::size_t>(channel) * window_stride_;
    double *scratch = repair_scratch_.data() + static_cast<std::size_t>(channel) * scratch_stride_;
    const std::uint64_t window_begin = interval.begin - kArOrder;
    const std::uint32_t window_samples = gap + 2u * kArOrder;
    for (std::uint32_t offset = 0u; offset < window_samples; ++offset) {
      window[offset] = static_cast<double>(sample_ring_[ringIndex(channel, window_begin + offset)]);
    }
    if (!dsp::interpolateArGap(window, kArOrder, gap, kArOrder, state.coefficients.data(), kArOrder,
                               scratch)) {
      return false;
    }
    for (std::uint32_t offset = 0u; offset < gap; ++offset) {
      sample_ring_[ringIndex(channel, interval.begin + offset)] =
          static_cast<float>(window[kArOrder + offset]);
    }
    state.last_repaired_sample = interval.end - 1u;
    return true;
  }

  [[nodiscard]] std::uint32_t repairDueIntervals(std::uint32_t channel, ClickChannelState &state,
                                                 std::uint32_t allowed_repair_samples) noexcept {
    std::uint32_t repaired_events = 0u;
    while (state.pending_count != 0u) {
      const RepairInterval interval = state.pending[state.pending_read];
      const std::uint64_t repair_time = interval.end + kPostContextSamples - 1u;
      if (repair_time > absolute_sample_) {
        break;
      }
      if (repair_time == absolute_sample_ &&
          repairInterval(channel, state, interval, allowed_repair_samples)) {
        ++repaired_events;
      }
      state.pending_read = (state.pending_read + 1u) % kPendingIntervalCapacity;
      --state.pending_count;
    }
    return repaired_events;
  }

  [[nodiscard]] std::uint32_t processSample(std::uint32_t channel, float input, double threshold,
                                            std::uint32_t allowed_repair_samples) noexcept {
    ClickChannelState &state = channels_[channel];
    sample_ring_[ringIndex(channel, absolute_sample_)] = input;
    state.autocorrelation.update(&input, 1u, state.history.data(), state.history_count);
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

    double residual = static_cast<double>(input);
    const std::uint32_t history_terms =
        state.history_count < kArOrder ? state.history_count : kArOrder;
    for (std::uint32_t lag = 1u; lag <= history_terms; ++lag) {
      residual += state.coefficients[lag - 1u] *
                  static_cast<double>(state.history[state.history_count - lag]);
    }
    appendHistory(state, input);
    const double magnitude = residual < 0.0 ? -residual : residual;
    state.mad += (magnitude - state.mad) * mad_alpha_;
    const double normalized = magnitude / (state.mad + kEpsilon);
    normalized_ring_[ringIndex(channel, absolute_sample_)] = normalized;
    const bool candidate =
        state.warmup_count >= kArContextSamples && state.ar_valid && normalized > threshold;
    updateCandidateState(state, candidate);
    return repairDueIntervals(channel, state, allowed_repair_samples);
  }

  [[nodiscard]] float delayedSample(std::uint32_t channel) const noexcept {
    if (absolute_sample_ < lookahead_samples_) {
      return 0.0F;
    }
    return sample_ring_[ringIndex(channel, absolute_sample_ - lookahead_samples_)];
  }

  std::vector<ClickChannelState> channels_;
  std::vector<float> sample_ring_;
  std::vector<double> normalized_ring_;
  std::vector<double> repair_window_;
  std::vector<double> repair_scratch_;
  double sample_rate_ = 0.0;
  double mad_alpha_ = 0.0;
  double telemetry_alpha_ = 0.0;
  double repairs_per_second_ = 0.0;
  std::uint64_t absolute_sample_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t max_repair_samples_ = 0u;
  std::uint32_t lookahead_samples_ = 0u;
  std::uint32_t ring_stride_ = 0u;
  std::uint32_t window_stride_ = 0u;
  std::uint32_t scratch_stride_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool prepared_ = false;
};

static_assert(sizeof(ClickRemoverKernel) <= 8192u);

} // namespace effetune::plugins::restoration

EFFETUNE_REGISTER_KERNEL(ClickRemoverPlugin, effetune::plugins::restoration::ClickRemoverKernel)

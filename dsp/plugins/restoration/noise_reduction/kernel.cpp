#include "effetune/kernel.h"
#include "NoiseReductionPluginParams.h"
#include "effetune/dsp/pffft_incremental.h"
#include "effetune/dsp/stage_scheduler.h"

#include <pffft.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <new>
#include <utility>
#include <vector>

namespace effetune::plugins::restoration {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr std::uint32_t kMaximumChannels = 16u;
constexpr std::uint32_t kSlotSamples = 16u;
// 192 kHz uses all 256 slots. Lowering kSlotSamples requires raising this limit.
constexpr std::uint32_t kMaximumSlots = 256u;
constexpr std::uint32_t kStageCapacity = 1536u;
constexpr double kDepthScale = 1.0;
constexpr double kDelta = 5.0;
constexpr double kDeltaSpread = 1.4142;
constexpr double kHoldTauSeconds = 0.120;
constexpr double kNoisePowerFloor = 1.0e-20;

enum class StageKind : std::uint8_t {
  PackAnalysis,
  BeginForward,
  ForwardStep,
  AccumulatePower,
  NoiseTrack,
  PrepareGain,
  GainTarget,
  GainPrefix,
  GainSmooth,
  ApplyGain,
  ReorderInverse,
  BeginInverse,
  InverseStep,
  OverlapAdd,
};

double bounded(float value, double lower, double upper, double fallback) noexcept {
  if (!std::isfinite(value)) {
    return fallback;
  }
  const double converted = static_cast<double>(value);
  if (converted < lower) {
    return lower;
  }
  return converted > upper ? upper : converted;
}

std::uint32_t fftSizeForSampleRate(double sample_rate) noexcept {
  const double exponent = std::round(std::log2(sample_rate * 0.085));
  double requested = std::pow(2.0, exponent);
  if (requested < 256.0) {
    requested = 256.0;
  } else if (requested > 16384.0) {
    requested = 16384.0;
  }
  auto size = static_cast<std::uint32_t>(requested);
  while (size > 256u && (static_cast<double>(size + size / 4u) / sample_rate) > 0.120) {
    size >>= 1u;
  }
  return size;
}

class AlignedFloatBuffer final {
public:
  AlignedFloatBuffer() = default;
  ~AlignedFloatBuffer() { release(); }

  AlignedFloatBuffer(const AlignedFloatBuffer &) = delete;
  AlignedFloatBuffer &operator=(const AlignedFloatBuffer &) = delete;

  bool allocate(std::size_t count) noexcept {
    release();
    if (count == 0u) {
      return true;
    }
    data_ = static_cast<float *>(pffft_aligned_malloc(count * sizeof(float)));
    if (data_ == nullptr) {
      return false;
    }
    count_ = count;
    clear();
    return true;
  }

  void clear() noexcept {
    if (data_ != nullptr) {
      std::memset(data_, 0, count_ * sizeof(float));
    }
  }

  void release() noexcept {
    pffft_aligned_free(data_);
    data_ = nullptr;
    count_ = 0u;
  }

  [[nodiscard]] float *data() noexcept { return data_; }
  [[nodiscard]] const float *data() const noexcept { return data_; }
  [[nodiscard]] float &operator[](std::size_t index) noexcept { return data_[index]; }
  [[nodiscard]] const float &operator[](std::size_t index) const noexcept { return data_[index]; }

private:
  float *data_ = nullptr;
  std::size_t count_ = 0u;
};

} // namespace

class NoiseReductionKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::NoiseReductionPluginParams)

public:
  ~NoiseReductionKernel() override { releaseResources(); }

  void prepare(const PrepareInfo &info) override {
    releaseResources();
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    if (!std::isfinite(sample_rate_) || sample_rate_ <= 0.0 || max_channels_ == 0u ||
        max_channels_ > kMaximumChannels || max_frames_ == 0u) {
      return;
    }

    fft_size_ = fftSizeForSampleRate(sample_rate_);
    hop_size_ = fft_size_ / 4u;
    timeline_size_ = fft_size_ + hop_size_;
    latency_ = timeline_size_;
    half_bins_ = fft_size_ / 2u + 1u;
    slot_count_ = hop_size_ / kSlotSamples;
    if (slot_count_ == 0u || slot_count_ > kMaximumSlots) {
      return;
    }

    hop_seconds_ = static_cast<double>(hop_size_) / sample_rate_;
    min_history_frames_ = static_cast<std::uint32_t>(std::llround(2.0 / hop_seconds_));
    if (min_history_frames_ < 8u) {
      min_history_frames_ = 8u;
    }
    subwindow_frames_ = (min_history_frames_ + 3u) / 4u;
    init_frames_ = min_history_frames_;
    attack_coefficient_ = std::exp(-hop_seconds_ / 0.120);
    release_coefficient_ = std::exp(-hop_seconds_ / 0.015);
    hold_decay_ = std::exp(-hop_seconds_ / kHoldTauSeconds);

    setup_ = pffft_new_setup(static_cast<int>(fft_size_), PFFFT_REAL);
    if (setup_ != nullptr) {
      const int simd_width = pffft_simd_size();
      const int work_budget = simd_width > 0 ? 1024 / simd_width : 256;
      forward_.reset(
          new (std::nothrow)::effetune::dsp::PffftOrderedRealForward(setup_, work_budget));
      inverse_.reset(
          new (std::nothrow)::effetune::dsp::PffftOrderedRealForward(setup_, work_budget));
    }

    const std::size_t channel_timeline = static_cast<std::size_t>(max_channels_) * timeline_size_;
    const std::size_t channel_spectrum = static_cast<std::size_t>(max_channels_) * fft_size_;
    const bool buffers_ready =
        input_ring_.allocate(channel_timeline) && output_ring_.allocate(channel_timeline) &&
        dry_ring_.allocate(static_cast<std::size_t>(max_channels_) * latency_) &&
        spectra_.allocate(channel_spectrum) && window_.allocate(fft_size_) &&
        time_data_.allocate(fft_size_) && unordered_spectrum_.allocate(fft_size_) &&
        fft_work_.allocate(fft_size_);
    prepared_ = setup_ != nullptr && forward_ != nullptr && forward_->valid() &&
                inverse_ != nullptr && inverse_->valid() && buffers_ready;
    if (!prepared_) {
      releaseResources();
      return;
    }

    forward_step_count_ = static_cast<std::uint32_t>(forward_->stepCount());
    // Before begin(), both incremental states report the ordered-forward count. The unordered
    // inverse completes one step earlier; retaining this one-step upper bound keeps the schedule
    // independent of prepare-time transform calls, and a completed state returns immediately.
    inverse_step_count_ = static_cast<std::uint32_t>(inverse_->stepCount());
    if (forward_step_count_ == 0u || inverse_step_count_ == 0u) {
      releaseResources();
      return;
    }

    pooled_power_.assign(half_bins_, 0.0);
    frequency_power_.assign(half_bins_, 0.0);
    smoothed_power_.assign(half_bins_, 0.0);
    minimum_power_.assign(half_bins_, std::numeric_limits<double>::max());
    temporary_minimum_.assign(half_bins_, std::numeric_limits<double>::max());
    presence_probability_.assign(half_bins_, 0.0);
    noise_power_.assign(half_bins_, 0.0);
    previous_signal_power_.assign(half_bins_, kNoisePowerFloor);
    previous_magnitude_.assign(half_bins_, 0.0);
    gain_db_.assign(half_bins_, 0.0);
    target_db_.assign(half_bins_, 0.0);
    cumulative_db_.assign(half_bins_ + 1u, 0.0);
    final_gain_.assign(half_bins_, 1.0);
    smoothing_half_width_.assign(half_bins_, 0u);
    smoothing_low_.assign(half_bins_, 0u);
    smoothing_high_.assign(half_bins_, 0u);
    smoothing_width_.assign(half_bins_, 1u);
    gain_floor_.assign(half_bins_, 1.0);

    double norm_minimum = std::numeric_limits<double>::max();
    double norm_maximum = 0.0;
    double first_norm = 0.0;
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const double phase = 2.0 * kPi * static_cast<double>(index) / static_cast<double>(fft_size_);
      window_[index] = static_cast<float>(std::sqrt(0.5 - 0.5 * std::cos(phase)));
    }
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      double norm = 0.0;
      for (std::uint32_t overlap = 0u; overlap < 4u; ++overlap) {
        const std::uint32_t offset = (index + overlap * hop_size_) % fft_size_;
        const double value = static_cast<double>(window_[offset]);
        norm += value * value;
      }
      if (index == 0u) {
        first_norm = norm;
      }
      if (norm < norm_minimum) {
        norm_minimum = norm;
      }
      if (norm > norm_maximum) {
        norm_maximum = norm;
      }
    }
    if (first_norm <= 0.0 || norm_maximum - norm_minimum >= 1.0e-6) {
      releaseResources();
      return;
    }
    synthesis_scale_ = 1.0 / first_norm;

    smoothing_cache_ = std::numeric_limits<double>::quiet_NaN();
    reduction_cache_ = std::numeric_limits<double>::quiet_NaN();
    treble_cache_ = std::numeric_limits<double>::quiet_NaN();
    if (!buildStageSchedule()) {
      releaseResources();
      return;
    }
    resetState();
    prepared_ = true;
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return prepared_ ? latency_ : 0u;
  }

  void reset() noexcept override {
    if (prepared_) {
      resetState();
    }
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }
    if (current_channel_count_ != 0u && current_channel_count_ != channel_count) {
      resetState();
    }
    current_channel_count_ = channel_count;
    wet_mix_ = bounded(params_.mix, 0.0, 100.0, 100.0) * 0.01;

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t block_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const float input = std::isfinite(audio[block_index]) ? audio[block_index] : 0.0F;
        const std::size_t timeline_index =
            static_cast<std::size_t>(channel) * timeline_size_ + timeline_position_;
        const std::size_t dry_index = static_cast<std::size_t>(channel) * latency_ + dry_position_;
        const float wet = output_ring_[timeline_index];
        const float dry = dry_ring_[dry_index];
        output_ring_[timeline_index] = 0.0F;
        input_ring_[timeline_index] = input;
        dry_ring_[dry_index] = input;
        const double output =
            wet_mix_ * static_cast<double>(wet) + (1.0 - wet_mix_) * static_cast<double>(dry);
        audio[block_index] = std::isfinite(output) ? static_cast<float>(output) : dry;
      }

      ++timeline_position_;
      if (timeline_position_ == timeline_size_) {
        timeline_position_ = 0u;
      }
      ++dry_position_;
      if (dry_position_ == latency_) {
        dry_position_ = 0u;
      }
      ++absolute_sample_;
      advanceStagedJob();
      if (absolute_sample_ == next_frame_sample_) {
        startStagedJob(channel_count);
        next_frame_sample_ += hop_size_;
      }
    }
  }

  void readSchedulerTrace(std::uint32_t &stage_count, std::uint32_t &slot_count,
                          std::uint32_t &stage_capacity, std::uint32_t &slot_capacity,
                          bool &job_active, std::uint32_t &overrun_count,
                          std::uint32_t &failure_count) const noexcept {
    stage_count = stage_schedule_ == nullptr ? 0u : stage_schedule_->stageCount();
    slot_count = slot_count_;
    stage_capacity = kStageCapacity;
    slot_capacity = kMaximumSlots;
    job_active = job_active_;
    overrun_count = job_overrun_count_;
    failure_count = job_failure_count_;
  }

private:
  using StageSchedule = ::effetune::dsp::StageSchedule<kStageCapacity, kMaximumSlots>;

  void releaseResources() noexcept {
    stage_schedule_.reset();
    forward_.reset();
    inverse_.reset();
    if (setup_ != nullptr) {
      pffft_destroy_setup(setup_);
      setup_ = nullptr;
    }
    input_ring_.release();
    output_ring_.release();
    dry_ring_.release();
    spectra_.release();
    window_.release();
    time_data_.release();
    unordered_spectrum_.release();
    fft_work_.release();
    prepared_ = false;
  }

  void resetState() noexcept {
    input_ring_.clear();
    output_ring_.clear();
    dry_ring_.clear();
    spectra_.clear();
    time_data_.clear();
    unordered_spectrum_.clear();
    fft_work_.clear();
    std::fill(pooled_power_.begin(), pooled_power_.end(), 0.0);
    std::fill(frequency_power_.begin(), frequency_power_.end(), 0.0);
    std::fill(smoothed_power_.begin(), smoothed_power_.end(), 0.0);
    std::fill(minimum_power_.begin(), minimum_power_.end(), std::numeric_limits<double>::max());
    std::fill(temporary_minimum_.begin(), temporary_minimum_.end(),
              std::numeric_limits<double>::max());
    std::fill(presence_probability_.begin(), presence_probability_.end(), 0.0);
    std::fill(noise_power_.begin(), noise_power_.end(), 0.0);
    std::fill(previous_magnitude_.begin(), previous_magnitude_.end(), 0.0);
    std::fill(gain_db_.begin(), gain_db_.end(), 0.0);
    std::fill(target_db_.begin(), target_db_.end(), 0.0);
    std::fill(cumulative_db_.begin(), cumulative_db_.end(), 0.0);
    std::fill(final_gain_.begin(), final_gain_.end(), 1.0);

    const double sensitivity = bounded(params_.sensitivity, -12.0, 12.0, 0.0);
    const double sensitivity_scale = std::pow(10.0, sensitivity * 0.1);
    for (std::uint32_t bin = 0u; bin < half_bins_; ++bin) {
      const double nu = noise_power_[bin] * sensitivity_scale;
      previous_signal_power_[bin] = nu > kNoisePowerFloor ? nu : kNoisePowerFloor;
    }

    timeline_position_ = 0u;
    dry_position_ = 0u;
    current_channel_count_ = 0u;
    absolute_sample_ = 0u;
    next_frame_sample_ = hop_size_;
    subwindow_counter_ = 0u;
    frame_count_ = 0u;
    hold_ = 0.0;
    job_active_ = false;
    job_failed_ = false;
    job_overrun_count_ = 0u;
    job_failure_count_ = 0u;
    job_slot_ = 0u;
    job_start_sample_ = 0u;
    job_frame_origin_ = 0u;
    job_output_origin_ = 0u;
    job_channel_count_ = 0u;
    job_flux_ = 0.0;
    job_flux_denominator_ = 0.0;
    job_lift_ = 0.0;
    job_initializing_ = true;
    job_final_initialization_frame_ = false;
    job_rotate_subwindow_ = false;
  }

  void updateParameterCaches() noexcept {
    const double smoothing = bounded(params_.smoothing, 0.0, 100.0, 50.0);
    if (smoothing != smoothing_cache_) {
      const double octave_width = (1.0 / 24.0) * std::pow(8.0, smoothing * 0.01);
      const double half_width_factor = std::pow(2.0, octave_width * 0.5) - 1.0;
      const std::uint32_t maximum_half_width = fft_size_ / 8u;
      for (std::uint32_t bin = 0u; bin < half_bins_; ++bin) {
        auto half_width =
            static_cast<std::uint32_t>(std::llround(static_cast<double>(bin) * half_width_factor));
        if (half_width > maximum_half_width) {
          half_width = maximum_half_width;
        }
        smoothing_half_width_[bin] = half_width;
        smoothing_low_[bin] = bin > half_width ? bin - half_width : 0u;
        std::uint32_t high = bin + half_width;
        if (high >= half_bins_) {
          high = half_bins_ - 1u;
        }
        smoothing_high_[bin] = high;
        smoothing_width_[bin] = high - smoothing_low_[bin] + 1u;
      }
      smoothing_cache_ = smoothing;
    }

    const double reduction = bounded(params_.reduction, 0.0, 24.0, 12.0);
    const double treble = bounded(params_.trebleCare, 0.0, 100.0, 50.0);
    if (reduction != reduction_cache_ || treble != treble_cache_) {
      for (std::uint32_t bin = 0u; bin < half_bins_; ++bin) {
        const double frequency =
            static_cast<double>(bin) * sample_rate_ / static_cast<double>(fft_size_);
        double transition = 0.0;
        if (frequency >= 12000.0) {
          transition = 1.0;
        } else if (frequency > 6000.0) {
          transition = std::log2(frequency / 6000.0);
        }
        const double depth = reduction * kDepthScale * (1.0 - 0.6 * (treble * 0.01) * transition);
        gain_floor_[bin] = std::pow(10.0, -depth / 20.0);
      }
      reduction_cache_ = reduction;
      treble_cache_ = treble;
    }
  }

  void addStage(StageKind kind, std::uint32_t channel, std::uint32_t begin, std::uint32_t end,
                std::uint32_t weight) noexcept {
    stage_schedule_->addStage(static_cast<std::uint8_t>(kind), channel, begin, end, weight);
  }

  void addLinearStages(StageKind kind, std::uint32_t channel, std::uint32_t begin,
                       std::uint32_t end, std::uint32_t chunks,
                       std::uint32_t work_per_item) noexcept {
    const std::uint32_t item_count = end - begin;
    for (std::uint32_t chunk = 0u; chunk < chunks; ++chunk) {
      const std::uint32_t chunk_begin =
          begin +
          static_cast<std::uint32_t>(static_cast<std::uint64_t>(item_count) * chunk / chunks);
      const std::uint32_t chunk_end =
          begin + static_cast<std::uint32_t>(static_cast<std::uint64_t>(item_count) * (chunk + 1u) /
                                             chunks);
      addStage(kind, channel, chunk_begin, chunk_end, (chunk_end - chunk_begin) * work_per_item);
    }
  }

  [[nodiscard]] bool buildStageSchedule() noexcept {
    stage_schedule_.reset(new (std::nothrow) StageSchedule());
    if (stage_schedule_ == nullptr) {
      return false;
    }
    stage_schedule_->clear();
    for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
      addLinearStages(StageKind::PackAnalysis, channel, 0u, fft_size_, 8u, 7u);
      addStage(StageKind::BeginForward, channel, 0u, 0u, 32u);
      for (std::uint32_t step = 0u; step < forward_step_count_; ++step) {
        addStage(StageKind::ForwardStep, channel, step, step + 1u,
                 static_cast<std::uint32_t>(static_cast<std::uint64_t>(fft_size_) * 2u));
      }
      addLinearStages(StageKind::AccumulatePower, channel, 0u, half_bins_, 4u, 5u);
    }
    addLinearStages(StageKind::NoiseTrack, 0u, 0u, half_bins_, 64u, 80u);
    addStage(StageKind::PrepareGain, 0u, 0u, 0u, 32u);
    addLinearStages(StageKind::GainTarget, 0u, 0u, half_bins_, 64u, 480u);
    addStage(StageKind::GainPrefix, 0u, 0u, half_bins_, half_bins_);
    addLinearStages(StageKind::GainSmooth, 0u, 0u, half_bins_, 64u, 240u);
    for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
      addLinearStages(StageKind::ApplyGain, channel, 0u, half_bins_, 4u, 3u);
      addStage(StageKind::ReorderInverse, channel, 0u, 0u, fft_size_);
      addStage(StageKind::BeginInverse, channel, 0u, 0u, 32u);
      for (std::uint32_t step = 0u; step < inverse_step_count_; ++step) {
        addStage(StageKind::InverseStep, channel, step, step + 1u, fft_size_);
      }
      addLinearStages(StageKind::OverlapAdd, channel, 0u, fft_size_, 8u, 9u);
    }
    return stage_schedule_->stageCount() <= kStageCapacity &&
           stage_schedule_->partition(slot_count_);
  }

  void packAnalysis(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    if (channel >= job_channel_count_ || begin >= end) {
      return;
    }
    const float *ring = input_ring_.data() + static_cast<std::size_t>(channel) * timeline_size_;
    std::uint32_t ring_index = job_frame_origin_ + begin;
    if (ring_index >= timeline_size_) {
      ring_index -= timeline_size_;
    }
    const std::uint32_t count = end - begin;
    const std::uint32_t first =
        count < timeline_size_ - ring_index ? count : timeline_size_ - ring_index;
    for (std::uint32_t offset = 0u; offset < first; ++offset) {
      const std::uint32_t index = begin + offset;
      time_data_[index] = ring[ring_index + offset] * window_[index];
    }
    for (std::uint32_t offset = first; offset < count; ++offset) {
      const std::uint32_t index = begin + offset;
      time_data_[index] = ring[offset - first] * window_[index];
    }
  }

  void beginForward(std::uint32_t channel) noexcept {
    if (channel >= job_channel_count_) {
      return;
    }
    float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    if (!forward_->begin(time_data_.data(), spectrum, fft_work_.data())) {
      job_failed_ = true;
    }
  }

  void transformStep(::effetune::dsp::PffftOrderedRealForward &transform, std::uint32_t step,
                     std::uint32_t step_count, bool has_padding_step) noexcept {
    if (job_failed_) {
      return;
    }
    const int result = transform.step();
    const bool completed = has_padding_step ? step + 2u >= step_count : step + 1u == step_count;
    if ((!completed && result != 0) || (completed && result != 1)) {
      job_failed_ = true;
      ++job_failure_count_;
    }
  }

  void accumulatePower(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    if (channel >= job_channel_count_) {
      return;
    }
    const float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      double power = 0.0;
      if (bin == 0u) {
        power = static_cast<double>(spectrum[0]) * spectrum[0];
      } else if (bin + 1u == half_bins_) {
        power = static_cast<double>(spectrum[1]) * spectrum[1];
      } else {
        const double real = static_cast<double>(spectrum[2u * bin]);
        const double imaginary = static_cast<double>(spectrum[2u * bin + 1u]);
        power = real * real + imaginary * imaginary;
      }
      if (channel == 0u) {
        pooled_power_[bin] = power;
      } else {
        pooled_power_[bin] += power;
      }
    }
  }

  void trackNoise(std::uint32_t begin, std::uint32_t end) noexcept {
    const double delta_low = kDelta / kDeltaSpread;
    const double delta_high = kDelta * kDeltaSpread;
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      const double left = bin == 0u ? pooled_power_[bin] : pooled_power_[bin - 1u];
      const double right = bin + 1u == half_bins_ ? pooled_power_[bin] : pooled_power_[bin + 1u];
      const double filtered = 0.25 * left + 0.5 * pooled_power_[bin] + 0.25 * right;
      frequency_power_[bin] = filtered;
      if (frame_count_ == 0u) {
        smoothed_power_[bin] = filtered;
        minimum_power_[bin] = filtered;
        temporary_minimum_[bin] = filtered;
      } else {
        smoothed_power_[bin] = 0.8 * smoothed_power_[bin] + 0.2 * filtered;
        if (job_rotate_subwindow_) {
          minimum_power_[bin] = temporary_minimum_[bin] < smoothed_power_[bin]
                                    ? temporary_minimum_[bin]
                                    : smoothed_power_[bin];
          temporary_minimum_[bin] = smoothed_power_[bin];
        } else {
          if (smoothed_power_[bin] < minimum_power_[bin]) {
            minimum_power_[bin] = smoothed_power_[bin];
          }
          if (smoothed_power_[bin] < temporary_minimum_[bin]) {
            temporary_minimum_[bin] = smoothed_power_[bin];
          }
        }
      }

      const double minimum =
          minimum_power_[bin] > kNoisePowerFloor ? minimum_power_[bin] : kNoisePowerFloor;
      const double ratio = smoothed_power_[bin] / minimum;
      double indicator = (ratio - delta_low) / (delta_high - delta_low);
      if (indicator < 0.0) {
        indicator = 0.0;
      } else if (indicator > 1.0) {
        indicator = 1.0;
      }
      presence_probability_[bin] = 0.2 * presence_probability_[bin] + 0.8 * indicator;
      if (job_initializing_) {
        if (job_final_initialization_frame_) {
          noise_power_[bin] = minimum_power_[bin];
        }
      } else {
        const double noise_coefficient = 0.95 + 0.05 * presence_probability_[bin];
        noise_power_[bin] =
            noise_coefficient * noise_power_[bin] + (1.0 - noise_coefficient) * filtered;
      }

      const double power = pooled_power_[bin] > 0.0 ? pooled_power_[bin] : 0.0;
      const double magnitude = std::sqrt(power);
      const double rise = magnitude - previous_magnitude_[bin];
      if (rise > 0.0) {
        job_flux_ += rise;
      }
      job_flux_denominator_ += previous_magnitude_[bin];
      previous_magnitude_[bin] = magnitude;
    }
  }

  void prepareGain() noexcept {
    double flux = job_flux_ / (job_flux_denominator_ + kNoisePowerFloor);
    double trigger = (flux - 0.30) / 0.10;
    if (trigger < 0.0) {
      trigger = 0.0;
    } else if (trigger > 1.0) {
      trigger = 1.0;
    }
    const double decayed = hold_ * hold_decay_;
    hold_ = trigger > decayed ? trigger : decayed;
    job_lift_ = 0.75 * hold_;
    if (job_rotate_subwindow_) {
      subwindow_counter_ = 0u;
    } else {
      ++subwindow_counter_;
    }
  }

  void calculateGainTarget(std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_initializing_) {
      for (std::uint32_t bin = begin; bin < end; ++bin) {
        target_db_[bin] = 0.0;
      }
      return;
    }
    const double transient_exponent = 1.0 - job_lift_;
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      const double scaled_noise = noise_power_[bin] * job_sensitivity_scale_;
      const double noise = scaled_noise > kNoisePowerFloor ? scaled_noise : kNoisePowerFloor;
      const double posterior = pooled_power_[bin] / noise;
      const double excess = posterior > 1.0 ? posterior - 1.0 : 0.0;
      double prior = 0.98 * (previous_signal_power_[bin] / noise) + 0.02 * excess;
      if (prior < 0.0) {
        prior = 0.0;
      }
      const double ratio = prior / (prior + 1.0);
      const double wiener = std::pow(ratio, 0.7);
      double gain = wiener > gain_floor_[bin] ? wiener : gain_floor_[bin];
      const double transient_floor = std::pow(gain_floor_[bin], transient_exponent);
      if (transient_floor > gain) {
        gain = transient_floor;
      }
      if (gain < 1.0e-6) {
        gain = 1.0e-6;
      }
      target_db_[bin] = 20.0 * std::log10(gain);
    }
  }

  void calculateGainPrefix() noexcept {
    cumulative_db_[0] = 0.0;
    for (std::uint32_t bin = 0u; bin < half_bins_; ++bin) {
      cumulative_db_[bin + 1u] = cumulative_db_[bin] + target_db_[bin];
    }
  }

  void smoothGain(std::uint32_t begin, std::uint32_t end) noexcept {
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      if (job_initializing_) {
        gain_db_[bin] = 0.0;
        final_gain_[bin] = 1.0;
      } else {
        const double smoothed =
            (cumulative_db_[smoothing_high_[bin] + 1u] - cumulative_db_[smoothing_low_[bin]]) /
            static_cast<double>(smoothing_width_[bin]);
        const double coefficient =
            smoothed < gain_db_[bin] ? attack_coefficient_ : release_coefficient_;
        gain_db_[bin] = coefficient * gain_db_[bin] + (1.0 - coefficient) * smoothed;
        final_gain_[bin] = std::pow(10.0, gain_db_[bin] / 20.0);
      }
      previous_signal_power_[bin] = final_gain_[bin] * final_gain_[bin] * pooled_power_[bin];
    }
    if (end == half_bins_) {
      ++frame_count_;
    }
  }

  void applyGain(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    if (channel >= job_channel_count_ || begin >= end) {
      return;
    }
    float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    std::uint32_t bin = begin;
    if (bin == 0u) {
      spectrum[0] *= static_cast<float>(final_gain_[0]);
      ++bin;
    }
    const std::uint32_t nyquist = half_bins_ - 1u;
    const std::uint32_t middle_end = end < nyquist ? end : nyquist;
    for (; bin < middle_end; ++bin) {
      const float gain = static_cast<float>(final_gain_[bin]);
      spectrum[2u * bin] *= gain;
      spectrum[2u * bin + 1u] *= gain;
    }
    if (end == half_bins_) {
      spectrum[1] *= static_cast<float>(final_gain_[nyquist]);
    }
  }

  void reorderInverse(std::uint32_t channel) noexcept {
    if (channel >= job_channel_count_) {
      return;
    }
    float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    pffft_zreorder(setup_, spectrum, unordered_spectrum_.data(), PFFFT_BACKWARD);
  }

  void beginInverse(std::uint32_t channel) noexcept {
    if (channel >= job_channel_count_) {
      return;
    }
    if (!inverse_->beginUnorderedBackward(unordered_spectrum_.data(), time_data_.data(),
                                          fft_work_.data())) {
      job_failed_ = true;
    }
  }

  void overlapAdd(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    if (channel >= job_channel_count_ || begin >= end || job_failed_) {
      return;
    }
    float *ring = output_ring_.data() + static_cast<std::size_t>(channel) * timeline_size_;
    std::uint32_t ring_index = job_output_origin_ + begin;
    if (ring_index >= timeline_size_) {
      ring_index -= timeline_size_;
    }
    const std::uint32_t count = end - begin;
    const std::uint32_t first =
        count < timeline_size_ - ring_index ? count : timeline_size_ - ring_index;
    const double inverse_scale = synthesis_scale_ / static_cast<double>(fft_size_);
    for (std::uint32_t offset = 0u; offset < first; ++offset) {
      const std::uint32_t index = begin + offset;
      ring[ring_index + offset] += static_cast<float>(static_cast<double>(window_[index]) *
                                                      time_data_[index] * inverse_scale);
    }
    for (std::uint32_t offset = first; offset < count; ++offset) {
      const std::uint32_t index = begin + offset;
      ring[offset - first] += static_cast<float>(static_cast<double>(window_[index]) *
                                                 time_data_[index] * inverse_scale);
    }
  }

  void runStage(const ::effetune::dsp::SchedulerStage &stage) noexcept {
    const auto kind = static_cast<StageKind>(stage.kind);
    switch (kind) {
    case StageKind::PackAnalysis:
      packAnalysis(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::BeginForward:
      beginForward(stage.channel);
      break;
    case StageKind::ForwardStep:
      if (stage.channel < job_channel_count_) {
        transformStep(*forward_, stage.begin, forward_step_count_, false);
      }
      break;
    case StageKind::AccumulatePower:
      accumulatePower(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::NoiseTrack:
      trackNoise(stage.begin, stage.end);
      break;
    case StageKind::PrepareGain:
      prepareGain();
      break;
    case StageKind::GainTarget:
      calculateGainTarget(stage.begin, stage.end);
      break;
    case StageKind::GainPrefix:
      calculateGainPrefix();
      break;
    case StageKind::GainSmooth:
      smoothGain(stage.begin, stage.end);
      break;
    case StageKind::ApplyGain:
      applyGain(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::ReorderInverse:
      reorderInverse(stage.channel);
      break;
    case StageKind::BeginInverse:
      beginInverse(stage.channel);
      break;
    case StageKind::InverseStep:
      if (stage.channel < job_channel_count_) {
        transformStep(*inverse_, stage.begin, inverse_step_count_, true);
      }
      break;
    case StageKind::OverlapAdd:
      overlapAdd(stage.channel, stage.begin, stage.end);
      break;
    }
  }

  void advanceStagedJob() noexcept {
    ::effetune::dsp::advanceStagedJob(
        job_active_, job_slot_, slot_count_, absolute_sample_, job_start_sample_, kSlotSamples,
        *stage_schedule_,
        [this](const ::effetune::dsp::SchedulerStage &stage) noexcept { runStage(stage); });
  }

  void startStagedJob(std::uint32_t channel_count) noexcept {
    if (job_active_) {
      job_failed_ = true;
      job_active_ = false;
      ++job_overrun_count_;
      return;
    }
    updateParameterCaches();
    const double sensitivity = bounded(params_.sensitivity, -12.0, 12.0, 0.0);
    job_sensitivity_scale_ = std::pow(10.0, sensitivity * 0.1);
    job_channel_count_ = channel_count;
    job_start_sample_ = absolute_sample_;
    job_frame_origin_ = (timeline_position_ + timeline_size_ - fft_size_) % timeline_size_;
    job_output_origin_ = timeline_position_ + hop_size_;
    if (job_output_origin_ >= timeline_size_) {
      job_output_origin_ -= timeline_size_;
    }
    job_slot_ = 0u;
    job_failed_ = false;
    job_flux_ = 0.0;
    job_flux_denominator_ = 0.0;
    job_initializing_ = frame_count_ < init_frames_;
    job_final_initialization_frame_ = job_initializing_ && frame_count_ + 1u == init_frames_;
    job_rotate_subwindow_ = subwindow_counter_ + 1u >= subwindow_frames_;
    job_active_ = true;
  }

  PFFFT_Setup *setup_ = nullptr;
  std::unique_ptr<::effetune::dsp::PffftOrderedRealForward> forward_;
  std::unique_ptr<::effetune::dsp::PffftOrderedRealForward> inverse_;
  AlignedFloatBuffer input_ring_;
  AlignedFloatBuffer output_ring_;
  AlignedFloatBuffer dry_ring_;
  AlignedFloatBuffer spectra_;
  AlignedFloatBuffer window_;
  AlignedFloatBuffer time_data_;
  AlignedFloatBuffer unordered_spectrum_;
  AlignedFloatBuffer fft_work_;

  std::vector<double> pooled_power_;
  std::vector<double> frequency_power_;
  std::vector<double> smoothed_power_;
  std::vector<double> minimum_power_;
  std::vector<double> temporary_minimum_;
  std::vector<double> presence_probability_;
  std::vector<double> noise_power_;
  std::vector<double> previous_signal_power_;
  std::vector<double> previous_magnitude_;
  std::vector<double> gain_db_;
  std::vector<double> target_db_;
  std::vector<double> cumulative_db_;
  std::vector<double> final_gain_;
  std::vector<std::uint32_t> smoothing_half_width_;
  std::vector<std::uint32_t> smoothing_low_;
  std::vector<std::uint32_t> smoothing_high_;
  std::vector<std::uint32_t> smoothing_width_;
  std::vector<double> gain_floor_;

  std::unique_ptr<StageSchedule> stage_schedule_;
  double sample_rate_ = 0.0;
  double hop_seconds_ = 0.0;
  double synthesis_scale_ = 0.5;
  double attack_coefficient_ = 0.0;
  double release_coefficient_ = 0.0;
  double hold_decay_ = 0.0;
  double smoothing_cache_ = std::numeric_limits<double>::quiet_NaN();
  double reduction_cache_ = std::numeric_limits<double>::quiet_NaN();
  double treble_cache_ = std::numeric_limits<double>::quiet_NaN();
  double wet_mix_ = 1.0;
  double hold_ = 0.0;
  double job_flux_ = 0.0;
  double job_flux_denominator_ = 0.0;
  double job_lift_ = 0.0;
  double job_sensitivity_scale_ = 1.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t current_channel_count_ = 0u;
  std::uint32_t fft_size_ = 0u;
  std::uint32_t hop_size_ = 0u;
  std::uint32_t timeline_size_ = 0u;
  std::uint32_t latency_ = 0u;
  std::uint32_t half_bins_ = 0u;
  std::uint32_t slot_count_ = 0u;
  std::uint32_t forward_step_count_ = 0u;
  std::uint32_t inverse_step_count_ = 0u;
  std::uint32_t min_history_frames_ = 0u;
  std::uint32_t subwindow_frames_ = 0u;
  std::uint32_t init_frames_ = 0u;
  std::uint32_t timeline_position_ = 0u;
  std::uint32_t dry_position_ = 0u;
  std::uint32_t subwindow_counter_ = 0u;
  std::uint32_t frame_count_ = 0u;
  std::uint32_t job_slot_ = 0u;
  std::uint32_t job_frame_origin_ = 0u;
  std::uint32_t job_output_origin_ = 0u;
  std::uint32_t job_channel_count_ = 0u;
  std::uint32_t job_overrun_count_ = 0u;
  std::uint32_t job_failure_count_ = 0u;
  std::uint64_t absolute_sample_ = 0u;
  std::uint64_t next_frame_sample_ = 0u;
  std::uint64_t job_start_sample_ = 0u;
  bool prepared_ = false;
  bool job_active_ = false;
  bool job_failed_ = false;
  bool job_initializing_ = true;
  bool job_final_initialization_frame_ = false;
  bool job_rotate_subwindow_ = false;
};

extern "C" bool et_noise_reduction_read_scheduler_trace(
    PluginKernel *kernel, std::uint32_t *stage_count, std::uint32_t *slot_count,
    std::uint32_t *stage_capacity, std::uint32_t *slot_capacity, bool *job_active,
    std::uint32_t *overrun_count, std::uint32_t *failure_count) noexcept {
  if (kernel == nullptr || stage_count == nullptr || slot_count == nullptr ||
      stage_capacity == nullptr || slot_capacity == nullptr || job_active == nullptr ||
      overrun_count == nullptr || failure_count == nullptr) {
    return false;
  }
  static_cast<NoiseReductionKernel *>(kernel)->readSchedulerTrace(
      *stage_count, *slot_count, *stage_capacity, *slot_capacity, *job_active, *overrun_count,
      *failure_count);
  return true;
}

} // namespace effetune::plugins::restoration

EFFETUNE_REGISTER_KERNEL(NoiseReductionPlugin, effetune::plugins::restoration::NoiseReductionKernel)

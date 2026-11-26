#include "effetune/kernel.h"
#include "AttackTonalBalancePluginParams.h"
#include "effetune/dsp/pffft_incremental.h"
#include "effetune/dsp/stage_scheduler.h"

#include <pffft.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <new>
#include <utility>
#include <vector>

namespace effetune::plugins::dynamics {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr std::uint32_t kMaximumChannels = 16u;
constexpr std::uint32_t kSlotSamples = 16u;
// 192 kHz uses all 256 slots. Lowering kSlotSamples requires raising this limit.
constexpr std::uint32_t kMaximumSlots = 256u;
constexpr std::uint32_t kStageCapacity = 1536u;
constexpr std::uint32_t kTimeMedian = 9u;
constexpr std::uint32_t kFrequencyMedian = 17u;

// Bins whose medians are sorted together; the branch-free network vectorizes across them.
constexpr std::uint32_t kMedianLanes = 4u;
template <std::size_t N> using MedianWindows = std::array<std::array<double, kMedianLanes>, N>;

// Sorts every lane with Batcher's odd-even merge network, truncated to N elements. The sorted
// values, and so the medians, match any other exact sort.
template <std::size_t N> void sortLanes(MedianWindows<N> &values) noexcept {
  for (std::size_t p = 1u; p < N; p <<= 1u) {
    for (std::size_t k = p; k >= 1u; k >>= 1u) {
      for (std::size_t j = k % p; j + k < N; j += 2u * k) {
        for (std::size_t i = 0u; i < k && i + j + k < N; ++i) {
          if ((i + j) / (2u * p) != (i + j + k) / (2u * p)) {
            continue;
          }
          std::array<double, kMedianLanes> &low = values[i + j];
          std::array<double, kMedianLanes> &high = values[i + j + k];
          for (std::uint32_t lane = 0u; lane < kMedianLanes; ++lane) {
            const double a = low[lane];
            const double b = high[lane];
            low[lane] = a < b ? a : b;
            high[lane] = a < b ? b : a;
          }
        }
      }
    }
  }
}

enum class StageKind : std::uint8_t {
  PackAnalysis,
  BeginForward,
  ForwardStep,
  AccumulatePower,
  StoreMagnitude,
  CalculateGain,
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

class AttackTonalBalanceKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::AttackTonalBalancePluginParams)

public:
  ~AttackTonalBalanceKernel() override { releaseResources(); }

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
    magnitude_.assign(half_bins_, 0.0);
    history_.assign(static_cast<std::size_t>(half_bins_) * kTimeMedian, 0.0);
    final_gain_.assign(half_bins_, 1.0);
    tonal_mask_.assign(half_bins_, 0.0);
    attack_mask_.assign(half_bins_, 0.0);

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

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t block_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const float input = std::isfinite(audio[block_index]) ? audio[block_index] : 0.0F;
        const std::size_t timeline_index =
            static_cast<std::size_t>(channel) * timeline_size_ + timeline_position_;
        const float wet = output_ring_[timeline_index];
        output_ring_[timeline_index] = 0.0F;
        input_ring_[timeline_index] = input;
        audio[block_index] = std::isfinite(wet) ? wet : 0.0F;
      }

      ++timeline_position_;
      if (timeline_position_ == timeline_size_) {
        timeline_position_ = 0u;
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

  bool masksValid() const noexcept {
    for (std::uint32_t bin = 0u; bin < half_bins_; ++bin) {
      const double t = tonal_mask_[bin];
      const double a = attack_mask_[bin];
      const double r = 1.0 - t - a;
      if (!std::isfinite(t + a + r) || t < 0.0 || a < 0.0 || r < 0.0 ||
          std::abs(t + a + r - 1.0) > 1.0e-15) {
        return false;
      }
    }
    return true;
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
    spectra_.clear();
    time_data_.clear();
    unordered_spectrum_.clear();
    fft_work_.clear();
    std::fill(pooled_power_.begin(), pooled_power_.end(), 0.0);
    std::fill(magnitude_.begin(), magnitude_.end(), 0.0);
    std::fill(history_.begin(), history_.end(), 0.0);
    std::fill(final_gain_.begin(), final_gain_.end(), 1.0);
    std::fill(tonal_mask_.begin(), tonal_mask_.end(), 0.0);
    std::fill(attack_mask_.begin(), attack_mask_.end(), 0.0);
    history_position_ = 0u;
    timeline_position_ = 0u;
    current_channel_count_ = 0u;
    absolute_sample_ = 0u;
    next_frame_sample_ = hop_size_;
    job_active_ = false;
    job_failed_ = false;
    job_overrun_count_ = 0u;
    job_failure_count_ = 0u;
    job_slot_ = 0u;
    job_start_sample_ = 0u;
    job_frame_origin_ = 0u;
    job_output_origin_ = 0u;
    job_channel_count_ = 0u;
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
    addLinearStages(StageKind::StoreMagnitude, 0u, 0u, half_bins_, 16u, 8u);
    addLinearStages(StageKind::CalculateGain, 0u, 0u, half_bins_, 64u, 180u);
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

  void storeMagnitude(std::uint32_t begin, std::uint32_t end) noexcept {
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      // Root-sum-square pooling is invariant under channel rotations.
      const double magnitude = std::sqrt(pooled_power_[bin]);
      magnitude_[bin] = magnitude;
      history_[static_cast<std::size_t>(bin) * kTimeMedian + history_position_] = magnitude;
    }
  }

  void calculateGain(std::uint32_t begin, std::uint32_t end) noexcept {
    for (std::uint32_t first_bin = begin; first_bin < end; first_bin += kMedianLanes) {
      MedianWindows<kTimeMedian> temporal{};
      MedianWindows<kFrequencyMedian> frequency{};
      for (std::uint32_t lane = 0u; lane < kMedianLanes; ++lane) {
        // Lanes past the range repeat the last bin and are not stored.
        const std::uint32_t bin = first_bin + lane < end ? first_bin + lane : end - 1u;
        for (std::uint32_t i = 0u; i < kTimeMedian; ++i) {
          temporal[i][lane] = history_[static_cast<std::size_t>(bin) * kTimeMedian + i];
        }
        for (std::uint32_t i = 0u; i < kFrequencyMedian; ++i) {
          const auto neighbor =
              static_cast<std::int32_t>(bin + i) - static_cast<std::int32_t>(kFrequencyMedian / 2u);
          const std::uint32_t clamped = neighbor < 0
                                            ? 0u
                                            : (static_cast<std::uint32_t>(neighbor) >= half_bins_
                                                   ? half_bins_ - 1u
                                                   : static_cast<std::uint32_t>(neighbor));
          frequency[i][lane] = magnitude_[clamped];
        }
      }
      sortLanes(temporal);
      sortLanes(frequency);
      const std::uint32_t lane_count =
          end - first_bin < kMedianLanes ? end - first_bin : kMedianLanes;
      for (std::uint32_t lane = 0u; lane < lane_count; ++lane) {
        storeGain(first_bin + lane, temporal[kTimeMedian / 2u][lane],
                  frequency[kFrequencyMedian / 2u][lane]);
      }
    }
    if (end == half_bins_) {
      history_position_ = (history_position_ + 1u) % kTimeMedian;
    }
  }

  void storeGain(std::uint32_t bin, double h, double p) noexcept {
    const double scale = h > p ? h : p;
    double tonal = 0.0;
    double attack = 0.0;
    if (scale > 0.0) {
      h /= scale;
      p /= scale;
      const double h2 = h * h;
      const double p2 = p * p;
      tonal = h2 / (h2 + 4.0 * p2);
      attack = p2 / (p2 + 4.0 * h2);
      // Rounding can make tonal exactly one while attack remains a tiny positive value.
      const double remaining = 1.0 - tonal;
      if (attack > remaining)
        attack = remaining;
    }
    tonal_mask_[bin] = tonal;
    attack_mask_[bin] = attack;
    // The residual stays at unity; this form is exactly neutral at zero dB.
    final_gain_[bin] = 1.0 + (job_tonal_gain_ - 1.0) * tonal + (job_attack_gain_ - 1.0) * attack;
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
    case StageKind::StoreMagnitude:
      storeMagnitude(stage.begin, stage.end);
      break;
    case StageKind::CalculateGain:
      calculateGain(stage.begin, stage.end);
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
    job_attack_gain_ = params_.attackEnabled != 0.0F
                           ? std::pow(10.0, bounded(params_.attack, -12.0, 12.0, 0.0) / 20.0)
                           : 0.0;
    job_tonal_gain_ = params_.tonalEnabled != 0.0F
                          ? std::pow(10.0, bounded(params_.tonal, -12.0, 12.0, 0.0) / 20.0)
                          : 0.0;
    job_channel_count_ = channel_count;
    job_start_sample_ = absolute_sample_;
    job_frame_origin_ = (timeline_position_ + timeline_size_ - fft_size_) % timeline_size_;
    job_output_origin_ = timeline_position_ + hop_size_;
    if (job_output_origin_ >= timeline_size_) {
      job_output_origin_ -= timeline_size_;
    }
    job_slot_ = 0u;
    job_failed_ = false;
    job_active_ = true;
  }

  PFFFT_Setup *setup_ = nullptr;
  std::unique_ptr<::effetune::dsp::PffftOrderedRealForward> forward_;
  std::unique_ptr<::effetune::dsp::PffftOrderedRealForward> inverse_;
  AlignedFloatBuffer input_ring_;
  AlignedFloatBuffer output_ring_;
  AlignedFloatBuffer spectra_;
  AlignedFloatBuffer window_;
  AlignedFloatBuffer time_data_;
  AlignedFloatBuffer unordered_spectrum_;
  AlignedFloatBuffer fft_work_;

  std::vector<double> pooled_power_;
  std::vector<double> magnitude_;
  std::vector<double> history_;
  std::vector<double> final_gain_;
  std::vector<double> tonal_mask_;
  std::vector<double> attack_mask_;

  std::unique_ptr<StageSchedule> stage_schedule_;
  double sample_rate_ = 0.0;
  double synthesis_scale_ = 0.5;
  double job_attack_gain_ = 1.0;
  double job_tonal_gain_ = 1.0;
  std::uint32_t history_position_ = 0u;
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
  std::uint32_t timeline_position_ = 0u;
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
};

extern "C" bool et_attack_tonal_balance_masks_valid(PluginKernel *kernel) noexcept {
  return kernel != nullptr && static_cast<AttackTonalBalanceKernel *>(kernel)->masksValid();
}

extern "C" bool et_attack_tonal_balance_read_scheduler_trace(
    PluginKernel *kernel, std::uint32_t *stage_count, std::uint32_t *slot_count,
    std::uint32_t *stage_capacity, std::uint32_t *slot_capacity, bool *job_active,
    std::uint32_t *overrun_count, std::uint32_t *failure_count) noexcept {
  if (kernel == nullptr || stage_count == nullptr || slot_count == nullptr ||
      stage_capacity == nullptr || slot_capacity == nullptr || job_active == nullptr ||
      overrun_count == nullptr || failure_count == nullptr) {
    return false;
  }
  static_cast<AttackTonalBalanceKernel *>(kernel)->readSchedulerTrace(
      *stage_count, *slot_count, *stage_capacity, *slot_capacity, *job_active, *overrun_count,
      *failure_count);
  return true;
}

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(AttackTonalBalancePlugin,
                         effetune::plugins::dynamics::AttackTonalBalanceKernel)

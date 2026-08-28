#include "effetune/kernel.h"
#include "PhaseSelectEqPluginParams.h"
#include "binary_io.h"
#include "effetune/dsp/fft_stages.h"
#include "effetune/dsp/pffft_incremental.h"
#include "effetune/dsp/stage_scheduler.h"

#include <pffft.h>

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <new>
#include <utility>
#include <vector>

#if defined(ET_PHASE_SELECT_EQ_COUNTERFACTUAL_MONOLITHIC)
#define PhaseSelectEqKernel PhaseSelectEqCounterfactualKernel
#endif

namespace effetune::plugins::spatial {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kRadiansToDegrees = 180.0 / kPi;
constexpr std::uint32_t kMaximumChannels = 16u;
constexpr std::uint32_t kProcessedChannels = 2u;
constexpr std::uint32_t kRegionCount = 5u;
constexpr std::uint32_t kSlotSamples = 16u;
constexpr std::uint32_t kMaximumSlots = 512u;
constexpr int kForwardWorkBudget = 224;
constexpr std::uint32_t kForwardStepWeight = 28u;
constexpr std::uint32_t kMinimumLinearPassChunks = 2u;
constexpr std::uint32_t kTransformSubsequences = 4u;
constexpr std::uint32_t kMaximumSubtransformChildren = 4u;
constexpr std::uint32_t kMaximumSubtransformCount =
    kTransformSubsequences * kMaximumSubtransformChildren;
constexpr std::uint32_t kSlotsPerLinearPassChunk = 16u;
constexpr std::uint32_t kLinearPassGroupCount = 30u;
constexpr std::uint32_t kFixedStageCount = kProcessedChannels * kMaximumSubtransformCount +
                                           2u * kProcessedChannels * kMaximumSubtransformCount +
                                           kMaximumSlots + 3u;
constexpr std::uint32_t kMaximumLinearPassChunks =
    (kMaximumSlots + kSlotsPerLinearPassChunk - 1u) / kSlotsPerLinearPassChunk;
constexpr std::uint32_t kStageCapacity =
    kFixedStageCount + kLinearPassGroupCount * kMaximumLinearPassChunks;
constexpr std::uint16_t kTapPhaseSelectMap = 20u;
constexpr std::uint16_t kTelemetryVersion = 2u;
constexpr std::uint32_t kTelemetryHeaderBytes = 16u;
constexpr std::uint32_t kMaximumTelemetryPoints = 512u;
constexpr std::uint32_t kMaximumTelemetryPayloadBytes =
    kTelemetryHeaderBytes + kMaximumTelemetryPoints * 16u;
constexpr float kMaximumTelemetryRateHz = 15.0F;
constexpr double kPhaseAbsolutePowerFloor = 1.0e-24;
constexpr double kPhaseRelativePowerFloor = 1.0e-12;
constexpr std::uint16_t kUnusedTelemetryCell = 0xffffu;

enum class StageKind : std::uint8_t {
  PackAnalysis,
  BeginForward,
  ForwardStep,
  ForwardSubtransform,
  CombineForwardSubtransform,
  CombineForward,
  SplitForward,
  BeginMask,
  ClearTelemetry,
  MeasurePower,
  ProcessMask,
  CountTelemetry,
  BeginTelemetry,
  WriteTelemetry,
  FinishTelemetry,
  MergeInverse,
  SeparateInverse,
  SeparateInverseSubtransform,
  InverseSubtransform,
  OverlapAdd,
};

std::uint32_t fftSizeForSampleRate(double sample_rate) noexcept {
  const auto rounded = static_cast<std::uint32_t>(std::llround(sample_rate));
  if (std::abs(sample_rate - static_cast<double>(rounded)) <= 0.01) {
    switch (rounded) {
    case 44100u:
    case 48000u:
      return 4096u;
    case 88200u:
    case 96000u:
      return 8192u;
    case 176400u:
    case 192000u:
      return 16384u;
    default:
      break;
    }
  }

  const double requested = std::ceil(sample_rate * 0.085);
  std::uint32_t size = 2048u;
  while (size < 32768u && static_cast<double>(size) < requested) {
    size <<= 1u;
  }
  return size;
}

using binary_io::writeF32;
using binary_io::writeU16;
using binary_io::writeU32;

class AlignedFloatBuffer final {
public:
  AlignedFloatBuffer() = default;
  ~AlignedFloatBuffer() { release(); }

  AlignedFloatBuffer(const AlignedFloatBuffer &) = delete;
  AlignedFloatBuffer &operator=(const AlignedFloatBuffer &) = delete;

  AlignedFloatBuffer(AlignedFloatBuffer &&other) noexcept { swap(other); }
  AlignedFloatBuffer &operator=(AlignedFloatBuffer &&other) noexcept {
    if (this != &other) {
      release();
      swap(other);
    }
    return *this;
  }

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
  void swap(AlignedFloatBuffer &other) noexcept {
    std::swap(data_, other.data_);
    std::swap(count_, other.count_);
  }

  float *data_ = nullptr;
  std::size_t count_ = 0u;
};

struct RegionSnapshot {
  double outerFrequencyLowLog2 = 0.0;
  double coreFrequencyLowLog2 = 0.0;
  double coreFrequencyHighLog2 = 0.0;
  double outerFrequencyHighLog2 = 0.0;
  double outerPhaseLow = 0.0;
  double corePhaseLow = 0.0;
  double corePhaseHigh = 0.0;
  double outerPhaseHigh = 0.0;
  double outerBalanceLow = -100.0;
  double coreBalanceLow = -100.0;
  double coreBalanceHigh = 100.0;
  double outerBalanceHigh = 100.0;
  double gain = 1.0;
  bool enabled = false;
  bool solo = false;
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

double smooth01(double value) noexcept {
  if (value <= 0.0) {
    return 0.0;
  }
  if (value >= 1.0) {
    return 1.0;
  }
  return 0.5 - 0.5 * std::cos(kPi * value);
}

double lowRamp(double value, double outer, double core) noexcept {
  if (value < outer) {
    return 0.0;
  }
  if (value >= core || core <= outer) {
    return 1.0;
  }
  return smooth01((value - outer) / (core - outer));
}

double highRamp(double value, double core, double outer) noexcept {
  if (value > outer) {
    return 0.0;
  }
  if (value <= core || outer <= core) {
    return 1.0;
  }
  return smooth01((outer - value) / (outer - core));
}

double regionWeight(const RegionSnapshot &region, double frequency_log2, double phase_degrees,
                    double balance) noexcept {
  const double frequency_weight =
      lowRamp(frequency_log2, region.outerFrequencyLowLog2, region.coreFrequencyLowLog2) *
      highRamp(frequency_log2, region.coreFrequencyHighLog2, region.outerFrequencyHighLog2);
  if (frequency_weight == 0.0) {
    return 0.0;
  }
  const double phase_weight = lowRamp(phase_degrees, region.outerPhaseLow, region.corePhaseLow) *
                              highRamp(phase_degrees, region.corePhaseHigh, region.outerPhaseHigh);
  if (phase_weight == 0.0) {
    return 0.0;
  }
  return frequency_weight * phase_weight *
         lowRamp(balance, region.outerBalanceLow, region.coreBalanceLow) *
         highRamp(balance, region.coreBalanceHigh, region.outerBalanceHigh);
}

bool hasBalanceConstraint(const RegionSnapshot &region) noexcept {
  return region.outerBalanceLow != -100.0 || region.coreBalanceLow != -100.0 ||
         region.coreBalanceHigh != 100.0 || region.outerBalanceHigh != 100.0;
}

// Solo replaces the usual product of region gains: the output keeps only the union of the
// soloed region weights, so every Gain and every unsoloed region is ignored while it is active.
double compositeGain(const std::array<RegionSnapshot, kRegionCount> &regions, bool solo_active,
                     double frequency_log2, double phase_degrees, double balance) noexcept {
  if (solo_active) {
    double weight = 0.0;
    for (const RegionSnapshot &region : regions) {
      if (region.enabled && region.solo) {
        const double region_weight = regionWeight(region, frequency_log2, phase_degrees, balance);
        if (region_weight > weight) {
          weight = region_weight;
        }
      }
    }
    return weight;
  }

  double total_gain = 1.0;
  for (const RegionSnapshot &region : regions) {
    if (region.enabled && region.gain != 1.0) {
      const double weight = regionWeight(region, frequency_log2, phase_degrees, balance);
      total_gain *= 1.0 + (region.gain - 1.0) * weight;
    }
  }
  return total_gain;
}

} // namespace

class PhaseSelectEqKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::PhaseSelectEqPluginParams)

public:
  ~PhaseSelectEqKernel() override { releaseSetup(); }

  void prepare(const PrepareInfo &info) override {
    releaseSetup();
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    if (!std::isfinite(sample_rate_) || sample_rate_ <= 0.0 || max_channels_ == 0u ||
        max_channels_ > kMaximumChannels || max_frames_ == 0u) {
      return;
    }

    fft_size_ = fftSizeForSampleRate(sample_rate_);
    hop_size_ = fft_size_ / 4u;
    slot_count_ = hop_size_ / kSlotSamples;
    subtransform_children_ = fft_size_ >= 16384u ? 4u : 1u;
    if (slot_count_ == 0u || slot_count_ > kMaximumSlots) {
      return;
    }
    timeline_size_ = fft_size_ + hop_size_;
    bin_count_ = fft_size_ / 2u + 1u;
    const double display_limit = sample_rate_ * 0.49;
    processing_max_frequency_ = display_limit < 40000.0 ? display_limit : 40000.0;
    telemetry_interval_samples_ =
        static_cast<std::uint64_t>(std::ceil(sample_rate_ / kMaximumTelemetryRateHz));
    if (telemetry_interval_samples_ == 0u) {
      telemetry_interval_samples_ = 1u;
    }

    if (stage_schedule_ == nullptr) {
      stage_schedule_.reset(new (std::nothrow) StageSchedule());
    }
    real_setup_ = pffft_new_setup(static_cast<int>(fft_size_), PFFFT_REAL);
    if (real_setup_ != nullptr) {
      forward_transform_.reset(new (std::nothrow)::effetune::dsp::PffftOrderedRealForward(
          real_setup_, kForwardWorkBudget));
    }
    complex_setup_ =
        pffft_new_setup(static_cast<int>(fft_size_ / (8u * subtransform_children_)), PFFFT_COMPLEX);
    const std::size_t dry_samples = static_cast<std::size_t>(max_channels_) * timeline_size_;
    const std::size_t stereo_timeline_samples =
        static_cast<std::size_t>(kProcessedChannels) * timeline_size_;
    const std::size_t stereo_spectrum_samples =
        static_cast<std::size_t>(kProcessedChannels) * fft_size_;
    prepared_ = stage_schedule_ != nullptr && real_setup_ != nullptr &&
                forward_transform_ != nullptr && forward_transform_->valid() &&
                complex_setup_ != nullptr && input_ring_.allocate(stereo_timeline_samples) &&
                dry_ring_.allocate(dry_samples) && output_ring_.allocate(stereo_timeline_samples) &&
                spectra_.allocate(stereo_spectrum_samples) && window_.allocate(fft_size_) &&
                fft_input_.allocate(fft_size_) && fft_work_.allocate(fft_size_) &&
                fft_stage_.allocate(fft_size_) && twiddles_.allocate(2u * fft_size_);
    if (!prepared_) {
      return;
    }

    bin_log_frequency_.assign(bin_count_, 0.0);
    bin_telemetry_cell_.assign(bin_count_, kUnusedTelemetryCell);
    telemetry_cell_energy_.assign(kMaximumTelemetryPoints, 0.0);
    telemetry_cell_bin_.assign(kMaximumTelemetryPoints, 0u);
    telemetry_cell_phase_.assign(kMaximumTelemetryPoints, 0.0F);
    telemetry_cell_balance_.assign(kMaximumTelemetryPoints, 0.0F);
    telemetry_payload_.assign(kMaximumTelemetryPayloadBytes, 0u);

    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const double phase = 2.0 * kPi * static_cast<double>(index) / static_cast<double>(fft_size_);
      window_[index] = static_cast<float>(std::sqrt(0.5 - 0.5 * std::cos(phase)));
    }
    ::effetune::dsp::fft_stages::prepareTwiddles(twiddles_.data(), fft_size_);
    prepareBinMetadata();
    if (!buildStageSchedule()) {
      prepared_ = false;
      return;
    }
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return prepared_ ? timeline_size_ : 0u;
  }

  void reset() noexcept override {
    input_ring_.clear();
    dry_ring_.clear();
    output_ring_.clear();
    spectra_.clear();
    fft_input_.clear();
    fft_work_.clear();
    fft_stage_.clear();
    timeline_position_ = 0u;
    current_channel_count_ = 0u;
    absolute_sample_ = 0u;
    next_frame_sample_ = hop_size_;
    job_start_sample_ = 0u;
    job_frame_origin_ = 0u;
    job_output_origin_ = 0u;
    job_slot_ = 0u;
    job_active_ = false;
    job_identity_ = true;
    job_solo_active_ = false;
    job_balance_constrained_ = false;
    job_capture_telemetry_ = false;
    job_maximum_left_power_ = 0.0;
    job_maximum_right_power_ = 0.0;
    job_left_floor_ = kPhaseAbsolutePowerFloor;
    job_right_floor_ = kPhaseAbsolutePowerFloor;
    job_total_floor_ = kPhaseAbsolutePowerFloor;
    job_telemetry_maximum_energy_ = 0.0;
    job_telemetry_point_count_ = 0u;
    job_telemetry_write_point_ = 0u;
    job_telemetry_cell_cursor_ = 0u;
    job_telemetry_started_ = false;
    wet_mix_ = 0.0;
    next_telemetry_sample_ = 0u;
    telemetry_payload_bytes_ = 0u;
    telemetry_generation_ = 0u;
    last_written_telemetry_generation_ = 0u;
    has_telemetry_frame_ = false;
    clearTelemetryCells();
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }
    if (current_channel_count_ != 0u && current_channel_count_ != channel_count) {
      reset();
    }
    current_channel_count_ = channel_count;

    const bool target_wet = channel_count >= kProcessedChannels && requestedWet();
    const double mix_step = 1.0 / static_cast<double>(hop_size_);
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      if (!target_wet) {
        wet_mix_ -= mix_step;
        if (wet_mix_ < 0.0) {
          wet_mix_ = 0.0;
        }
      } else if (absolute_sample_ >= timeline_size_) {
        wet_mix_ += mix_step;
        if (wet_mix_ > 1.0) {
          wet_mix_ = 1.0;
        }
      }

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t block_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const std::size_t dry_index =
            static_cast<std::size_t>(channel) * timeline_size_ + timeline_position_;
        const float input = std::isfinite(audio[block_index]) ? audio[block_index] : 0.0F;
        const float dry = dry_ring_[dry_index];
        dry_ring_[dry_index] = input;

        if (channel < kProcessedChannels) {
          const std::size_t stereo_index =
              static_cast<std::size_t>(channel) * timeline_size_ + timeline_position_;
          const float wet = output_ring_[stereo_index];
          input_ring_[stereo_index] = input;
          output_ring_[stereo_index] = 0.0F;
          const double mixed = static_cast<double>(dry) +
                               (static_cast<double>(wet) - static_cast<double>(dry)) * wet_mix_;
          audio[block_index] = std::isfinite(mixed) ? static_cast<float>(mixed) : dry;
        } else {
          audio[block_index] = dry;
        }
      }

      ++timeline_position_;
      if (timeline_position_ == timeline_size_) {
        timeline_position_ = 0u;
      }
      ++absolute_sample_;
      advanceStagedJob();
      if (absolute_sample_ == next_frame_sample_) {
        if (channel_count >= kProcessedChannels) {
          startStagedJob();
        }
        next_frame_sample_ += hop_size_;
      }
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!prepared_ || !has_telemetry_frame_ ||
        last_written_telemetry_generation_ == telemetry_generation_) {
      return;
    }
    if (writer.write(kTapPhaseSelectMap, kTelemetryVersion, telemetry_payload_.data(),
                     telemetry_payload_bytes_)) {
      last_written_telemetry_generation_ = telemetry_generation_;
    }
  }

private:
  void releaseSetup() noexcept {
    forward_transform_.reset();
    if (real_setup_ != nullptr) {
      pffft_destroy_setup(real_setup_);
      real_setup_ = nullptr;
    }
    if (complex_setup_ != nullptr) {
      pffft_destroy_setup(complex_setup_);
      complex_setup_ = nullptr;
    }
    prepared_ = false;
  }

  void prepareBinMetadata() noexcept {
    first_active_bin_ = 0u;
    active_bin_end_ = 0u;
    if (processing_max_frequency_ <= 20.0) {
      return;
    }
    const double minimum_log = std::log2(20.0);
    const double maximum_log = std::log2(processing_max_frequency_);
    const double log_span = maximum_log - minimum_log;
    for (std::uint32_t bin = 1u; bin + 1u < bin_count_; ++bin) {
      const double frequency =
          static_cast<double>(bin) * sample_rate_ / static_cast<double>(fft_size_);
      if (frequency < 20.0 || frequency > processing_max_frequency_) {
        continue;
      }
      const double frequency_log = std::log2(frequency);
      bin_log_frequency_[bin] = frequency_log;
      double position = (frequency_log - minimum_log) / log_span;
      if (position < 0.0) {
        position = 0.0;
      } else if (position > 1.0) {
        position = 1.0;
      }
      std::uint32_t cell =
          static_cast<std::uint32_t>(position * static_cast<double>(kMaximumTelemetryPoints));
      if (cell >= kMaximumTelemetryPoints) {
        cell = kMaximumTelemetryPoints - 1u;
      }
      bin_telemetry_cell_[bin] = static_cast<std::uint16_t>(cell);
      if (active_bin_end_ == 0u) {
        first_active_bin_ = bin;
      }
      active_bin_end_ = bin + 1u;
    }
  }

  [[nodiscard]] static std::uint32_t scaledWeight(std::uint64_t work) noexcept {
    return work == 0u ? 0u : static_cast<std::uint32_t>((work + 99u) / 100u);
  }

  [[nodiscard]] std::uint32_t partialTransformWeight() const noexcept {
    return scaledWeight(4u * static_cast<std::uint64_t>(fft_size_ / (8u * subtransform_children_)));
  }

  void addStage(StageKind kind, std::uint32_t channel, std::uint32_t begin, std::uint32_t end,
                std::uint32_t weight) noexcept {
    stage_schedule_->addStage(static_cast<std::uint8_t>(kind), channel, begin, end, weight);
  }

  void addLinearStages(StageKind kind, std::uint32_t channel, std::uint32_t begin,
                       std::uint32_t end, std::uint32_t chunk_count, std::uint32_t work_per_item,
                       std::uint32_t item_stride = 1u) noexcept {
    const std::uint32_t item_count = (end - begin) / item_stride;
    for (std::uint32_t chunk = 0u; chunk < chunk_count; ++chunk) {
      const std::uint32_t chunk_begin =
          begin +
          static_cast<std::uint32_t>(static_cast<std::uint64_t>(item_count) * chunk / chunk_count) *
              item_stride;
      const std::uint32_t chunk_end =
          begin + static_cast<std::uint32_t>(static_cast<std::uint64_t>(item_count) * (chunk + 1u) /
                                             chunk_count) *
                      item_stride;
      addStage(kind, channel, chunk_begin, chunk_end,
               scaledWeight(static_cast<std::uint64_t>(work_per_item) * (chunk_end - chunk_begin)));
    }
  }

  [[nodiscard]] std::uint32_t linearPassChunks() const noexcept {
    const std::uint32_t chunks =
        (slot_count_ + kSlotsPerLinearPassChunk - 1u) / kSlotsPerLinearPassChunk;
    return chunks < kMinimumLinearPassChunks ? kMinimumLinearPassChunks : chunks;
  }

  [[nodiscard]] bool buildStageSchedule() noexcept {
    stage_schedule_->clear();
    const std::uint32_t packed_size = fft_size_ / 2u;
    const std::uint32_t subsequence_length = fft_size_ / 8u;
    const std::uint32_t child_length = fft_size_ / (8u * subtransform_children_);
    const std::uint32_t transform_weight = partialTransformWeight();
    const std::uint32_t linear_pass_chunks = linearPassChunks();
    for (std::uint32_t channel = 0u; channel < kProcessedChannels; ++channel) {
      addLinearStages(StageKind::PackAnalysis, channel, 0u, fft_size_, linear_pass_chunks, 2u);
      addStage(StageKind::BeginForward, channel, 0u, 0u, 1u);
      for (int step = 0; step < forward_transform_->stepCount(); ++step) {
        addStage(StageKind::ForwardStep, channel, 0u, 0u, kForwardStepWeight);
      }
    }

    addStage(StageKind::BeginMask, 0u, 0u, 0u, 1u);
    addLinearStages(StageKind::ClearTelemetry, 0u, 0u, kMaximumTelemetryPoints, linear_pass_chunks,
                    1u);
    addLinearStages(StageKind::MeasurePower, 0u, first_active_bin_, active_bin_end_,
                    linear_pass_chunks, 1u);
    addLinearStages(StageKind::ProcessMask, 0u, first_active_bin_, active_bin_end_, slot_count_,
                    100u);
    addLinearStages(StageKind::CountTelemetry, 0u, 0u, kMaximumTelemetryPoints, linear_pass_chunks,
                    1u);
    addStage(StageKind::BeginTelemetry, 0u, 0u, 0u, 1u);

    for (std::uint32_t channel = 0u; channel < kProcessedChannels; ++channel) {
      addLinearStages(StageKind::MergeInverse, channel, 0u, packed_size, linear_pass_chunks, 1u);
      for (std::uint32_t subsequence = 0u; subsequence < kTransformSubsequences; ++subsequence) {
        addLinearStages(StageKind::SeparateInverse, subsequence, 0u, subsequence_length,
                        linear_pass_chunks, 6u);
      }
      for (std::uint32_t subsequence = 0u; subsequence < kTransformSubsequences; ++subsequence) {
        for (std::uint32_t child = 0u; child < subtransform_children_; ++child) {
          const std::uint32_t encoded = subsequence * subtransform_children_ + child;
          if (subtransform_children_ > 1u) {
            addStage(StageKind::SeparateInverseSubtransform, encoded, 0u, child_length,
                     scaledWeight(3u * static_cast<std::uint64_t>(child_length)));
          }
          addStage(StageKind::InverseSubtransform, encoded, 0u, 0u, transform_weight);
        }
      }
      addLinearStages(StageKind::OverlapAdd, channel, 0u, fft_size_, linear_pass_chunks, 4u, 8u);
    }
    return stage_schedule_->stageCount() >= slot_count_ && stage_schedule_->partition(slot_count_);
  }

  [[nodiscard]] bool requestedWet() const noexcept {
    for (std::uint32_t region = 0u; region < kRegionCount; ++region) {
      if (params_.enabled[region] < 0.5F) {
        continue;
      }
      if (params_.solo[region] >= 0.5F) {
        return true;
      }
      if (std::isfinite(params_.gain[region]) && params_.gain[region] != 100.0F) {
        return true;
      }
    }
    return false;
  }

  [[nodiscard]] RegionSnapshot snapshotRegion(std::uint32_t index) const noexcept {
    double outer_frequency_low = bounded(params_.outerFrequencyLow[index], 20.0, 40000.0, 80.0);
    double core_frequency_low = bounded(params_.coreFrequencyLow[index], 20.0, 40000.0, 100.0);
    double core_frequency_high = bounded(params_.coreFrequencyHigh[index], 20.0, 40000.0, 10000.0);
    double outer_frequency_high =
        bounded(params_.outerFrequencyHigh[index], 20.0, 40000.0, 12000.0);
    if (core_frequency_low < outer_frequency_low) {
      core_frequency_low = outer_frequency_low;
    }
    if (core_frequency_high < core_frequency_low) {
      core_frequency_high = core_frequency_low;
    }
    if (outer_frequency_high < core_frequency_high) {
      outer_frequency_high = core_frequency_high;
    }

    double outer_phase_low = bounded(params_.outerPhaseLow[index], 0.0, 180.0, 0.0);
    double core_phase_low = bounded(params_.corePhaseLow[index], 0.0, 180.0, 0.0);
    double core_phase_high = bounded(params_.corePhaseHigh[index], 0.0, 180.0, 30.0);
    double outer_phase_high = bounded(params_.outerPhaseHigh[index], 0.0, 180.0, 45.0);
    if (core_phase_low < outer_phase_low) {
      core_phase_low = outer_phase_low;
    }
    if (core_phase_high < core_phase_low) {
      core_phase_high = core_phase_low;
    }
    if (outer_phase_high < core_phase_high) {
      outer_phase_high = core_phase_high;
    }

    double outer_balance_low = bounded(params_.outerBalanceLow[index], -100.0, 100.0, -100.0);
    double core_balance_low = bounded(params_.coreBalanceLow[index], -100.0, 100.0, -100.0);
    double core_balance_high = bounded(params_.coreBalanceHigh[index], -100.0, 100.0, 100.0);
    double outer_balance_high = bounded(params_.outerBalanceHigh[index], -100.0, 100.0, 100.0);
    if (core_balance_low < outer_balance_low) {
      core_balance_low = outer_balance_low;
    }
    if (core_balance_high < core_balance_low) {
      core_balance_high = core_balance_low;
    }
    if (outer_balance_high < core_balance_high) {
      outer_balance_high = core_balance_high;
    }

    RegionSnapshot result;
    result.outerFrequencyLowLog2 = std::log2(outer_frequency_low);
    result.coreFrequencyLowLog2 = std::log2(core_frequency_low);
    result.coreFrequencyHighLog2 = std::log2(core_frequency_high);
    result.outerFrequencyHighLog2 = std::log2(outer_frequency_high);
    result.outerPhaseLow = outer_phase_low;
    result.corePhaseLow = core_phase_low;
    result.corePhaseHigh = core_phase_high;
    result.outerPhaseHigh = outer_phase_high;
    result.outerBalanceLow = outer_balance_low;
    result.coreBalanceLow = core_balance_low;
    result.coreBalanceHigh = core_balance_high;
    result.outerBalanceHigh = outer_balance_high;
    result.gain = bounded(params_.gain[index], 0.0, 200.0, 100.0) / 100.0;
    result.enabled = params_.enabled[index] >= 0.5F;
    result.solo = params_.solo[index] >= 0.5F;
    return result;
  }

  void packAnalysis(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    const std::size_t input_offset = static_cast<std::size_t>(channel) * timeline_size_;
    for (std::uint32_t index = begin; index < end; ++index) {
      const std::uint32_t source = job_frame_origin_ + index < timeline_size_
                                       ? job_frame_origin_ + index
                                       : job_frame_origin_ + index - timeline_size_;
      fft_input_[index] = input_ring_[input_offset + source] * window_[index];
    }
  }

  void beginForward(std::uint32_t channel) noexcept {
    static_cast<void>(forward_transform_->begin(
        fft_input_.data(), spectra_.data() + static_cast<std::size_t>(channel) * fft_size_,
        fft_work_.data()));
  }

  void transformForwardSubsequence(std::uint32_t encoded_subsequence) noexcept {
    const std::uint32_t child_length = fft_size_ / (8u * subtransform_children_);
    float *analysis_subsequences =
        subtransform_children_ == 1u ? fft_stage_.data() : fft_input_.data();
    float *data = analysis_subsequences + 2u * encoded_subsequence * child_length;
    pffft_transform_ordered(complex_setup_, data, data, fft_work_.data(), PFFFT_FORWARD);
  }

  void combineForwardSubtransform(std::uint32_t subsequence, std::uint32_t begin,
                                  std::uint32_t end) noexcept {
    const std::uint32_t subsequence_length = fft_size_ / 8u;
    const std::uint32_t offset = 2u * subsequence * subsequence_length;
    if (subtransform_children_ == 2u) {
      ::effetune::dsp::fft_stages::combineComplexForwardRadix2(
          fft_input_.data() + offset, fft_stage_.data() + offset, twiddles_.data(),
          subsequence_length, fft_size_, begin, end);
    } else {
      ::effetune::dsp::fft_stages::combineComplexForward(
          fft_input_.data() + offset, fft_stage_.data() + offset, twiddles_.data(),
          subsequence_length, fft_size_, begin, end);
    }
  }

  void combineForward(std::uint32_t begin, std::uint32_t end) noexcept {
    const float *subsequences = fft_stage_.data();
    ::effetune::dsp::fft_stages::combineForward(subsequences, fft_input_.data(), twiddles_.data(),
                                                fft_size_, begin, end);
  }

  void splitForward(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    ::effetune::dsp::fft_stages::splitForward(fft_input_.data(), spectrum, twiddles_.data(),
                                              fft_size_, begin, end);
  }

  [[nodiscard]] bool telemetryDue() noexcept {
    if (job_start_sample_ < next_telemetry_sample_) {
      return false;
    }
    do {
      next_telemetry_sample_ += telemetry_interval_samples_;
    } while (next_telemetry_sample_ <= job_start_sample_);
    return true;
  }

  void clearTelemetryCells() noexcept {
    for (std::uint32_t cell = 0u; cell < telemetry_cell_energy_.size(); ++cell) {
      telemetry_cell_energy_[cell] = 0.0;
      telemetry_cell_bin_[cell] = 0u;
      telemetry_cell_phase_[cell] = 0.0F;
      telemetry_cell_balance_[cell] = 0.0F;
    }
  }

  void beginMask() noexcept {
    job_maximum_left_power_ = 0.0;
    job_maximum_right_power_ = 0.0;
    job_left_floor_ = kPhaseAbsolutePowerFloor;
    job_right_floor_ = kPhaseAbsolutePowerFloor;
    job_total_floor_ = kPhaseAbsolutePowerFloor;
    job_telemetry_maximum_energy_ = 0.0;
    job_telemetry_point_count_ = 0u;
    job_telemetry_write_point_ = 0u;
    job_capture_telemetry_ = telemetryDue();
  }

  void clearTelemetry(std::uint32_t begin, std::uint32_t end) noexcept {
    if (!job_capture_telemetry_) {
      return;
    }
    for (std::uint32_t cell = begin; cell < end; ++cell) {
      telemetry_cell_energy_[cell] = 0.0;
      telemetry_cell_bin_[cell] = 0u;
      telemetry_cell_phase_[cell] = 0.0F;
      telemetry_cell_balance_[cell] = 0.0F;
    }
  }

  void measurePower(std::uint32_t begin, std::uint32_t end) noexcept {
    float *left = spectra_.data();
    float *right = spectra_.data() + fft_size_;
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      const std::uint32_t index = 2u * bin;
      const double left_real = static_cast<double>(left[index]);
      const double left_imaginary = static_cast<double>(left[index + 1u]);
      const double right_real = static_cast<double>(right[index]);
      const double right_imaginary = static_cast<double>(right[index + 1u]);
      const double left_power = left_real * left_real + left_imaginary * left_imaginary;
      const double right_power = right_real * right_real + right_imaginary * right_imaginary;
      if (left_power > job_maximum_left_power_) {
        job_maximum_left_power_ = left_power;
      }
      if (right_power > job_maximum_right_power_) {
        job_maximum_right_power_ = right_power;
      }
    }
    if (end == active_bin_end_) {
      job_left_floor_ = job_maximum_left_power_ * kPhaseRelativePowerFloor;
      if (job_left_floor_ < kPhaseAbsolutePowerFloor) {
        job_left_floor_ = kPhaseAbsolutePowerFloor;
      }
      job_right_floor_ = job_maximum_right_power_ * kPhaseRelativePowerFloor;
      if (job_right_floor_ < kPhaseAbsolutePowerFloor) {
        job_right_floor_ = kPhaseAbsolutePowerFloor;
      }
      job_total_floor_ =
          (job_maximum_left_power_ + job_maximum_right_power_) * kPhaseRelativePowerFloor;
      if (job_total_floor_ < kPhaseAbsolutePowerFloor) {
        job_total_floor_ = kPhaseAbsolutePowerFloor;
      }
    }
  }

  void processMask(std::uint32_t begin, std::uint32_t end) noexcept {
    float *left = spectra_.data();
    float *right = spectra_.data() + fft_size_;
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      const std::uint16_t cell = bin_telemetry_cell_[bin];
      const std::uint32_t index = 2u * bin;
      const double left_real = static_cast<double>(left[index]);
      const double left_imaginary = static_cast<double>(left[index + 1u]);
      const double right_real = static_cast<double>(right[index]);
      const double right_imaginary = static_cast<double>(right[index + 1u]);
      const double left_power = left_real * left_real + left_imaginary * left_imaginary;
      const double right_power = right_real * right_real + right_imaginary * right_imaginary;
      const double energy = left_power + right_power;
      if (energy <= job_total_floor_) {
        continue;
      }

      const bool phase_trusted = left_power > job_left_floor_ && right_power > job_right_floor_;
      double signed_phase = 180.0;
      double phase = 180.0;
      if (phase_trusted) {
        const double cross_real = left_real * right_real + left_imaginary * right_imaginary;
        const double cross_imaginary = left_imaginary * right_real - left_real * right_imaginary;
        signed_phase = std::atan2(cross_imaginary, cross_real) * kRadiansToDegrees;
        if (!std::isfinite(signed_phase)) {
          continue;
        }
        phase = signed_phase < 0.0 ? -signed_phase : signed_phase;
      }

      double balance = 0.0;
      if (job_balance_constrained_ || job_capture_telemetry_) {
        const double left_magnitude = std::sqrt(left_power);
        const double right_magnitude = std::sqrt(right_power);
        balance = (right_magnitude - left_magnitude) / (left_magnitude + right_magnitude) * 100.0;
      }
      if (!phase_trusted) {
        signed_phase = balance < 0.0 ? -180.0 : 180.0;
      }
      const double total_gain = job_identity_
                                    ? 1.0
                                    : compositeGain(job_regions_, job_solo_active_,
                                                    bin_log_frequency_[bin], phase, balance);
      if (total_gain != 1.0) {
        const double scaled_left_real = left_real * total_gain;
        const double scaled_left_imaginary = left_imaginary * total_gain;
        const double scaled_right_real = right_real * total_gain;
        const double scaled_right_imaginary = right_imaginary * total_gain;
        if (std::isfinite(scaled_left_real) && std::isfinite(scaled_left_imaginary) &&
            std::isfinite(scaled_right_real) && std::isfinite(scaled_right_imaginary)) {
          left[index] = static_cast<float>(scaled_left_real);
          left[index + 1u] = static_cast<float>(scaled_left_imaginary);
          right[index] = static_cast<float>(scaled_right_real);
          right[index + 1u] = static_cast<float>(scaled_right_imaginary);
        }
      }

      if (job_capture_telemetry_) {
        if (energy > telemetry_cell_energy_[cell]) {
          telemetry_cell_energy_[cell] = energy;
          telemetry_cell_bin_[cell] = bin;
          telemetry_cell_phase_[cell] = static_cast<float>(signed_phase);
          telemetry_cell_balance_[cell] = static_cast<float>(balance);
        }
        if (energy > job_telemetry_maximum_energy_) {
          job_telemetry_maximum_energy_ = energy;
        }
      }
    }
  }

  void countTelemetry(std::uint32_t begin, std::uint32_t end) noexcept {
    if (!job_capture_telemetry_ || job_telemetry_maximum_energy_ <= 0.0) {
      return;
    }
    for (std::uint32_t cell = begin; cell < end; ++cell) {
      if (telemetry_cell_energy_[cell] > 0.0) {
        ++job_telemetry_point_count_;
      }
    }
  }

  void beginTelemetry() noexcept {
    if (!job_capture_telemetry_) {
      return;
    }
    float maximum_db = -144.0F;
    if (job_telemetry_maximum_energy_ > 0.0) {
      const double normalization = static_cast<double>(fft_size_) * static_cast<double>(fft_size_);
      const double level =
          10.0 * std::log10(job_telemetry_maximum_energy_ / normalization + 1.0e-30);
      if (std::isfinite(level)) {
        maximum_db = static_cast<float>(level);
      }
    }
    writeF32(telemetry_payload_.data(), static_cast<float>(sample_rate_));
    writeU16(telemetry_payload_.data() + 4u, job_telemetry_point_count_);
    writeU16(telemetry_payload_.data() + 6u, 0u);
    writeU32(telemetry_payload_.data() + 8u, fft_size_);
    writeF32(telemetry_payload_.data() + 12u, maximum_db);
    job_telemetry_cell_cursor_ = 0u;
    job_telemetry_started_ = true;
  }

  void writeTelemetry(std::uint32_t begin, std::uint32_t end) noexcept {
    if (!job_capture_telemetry_ || job_telemetry_maximum_energy_ <= 0.0) {
      return;
    }
    for (std::uint32_t cell = begin; cell < end; ++cell) {
      const double energy = telemetry_cell_energy_[cell];
      if (energy <= 0.0) {
        continue;
      }
      const std::uint32_t bin = telemetry_cell_bin_[cell];
      const float frequency = static_cast<float>(static_cast<double>(bin) * sample_rate_ /
                                                 static_cast<double>(fft_size_));
      double relative_level = 10.0 * std::log10(energy / job_telemetry_maximum_energy_);
      if (!std::isfinite(relative_level)) {
        relative_level = -300.0;
      } else if (relative_level > 0.0) {
        relative_level = 0.0;
      }
      std::uint8_t *destination = telemetry_payload_.data() + kTelemetryHeaderBytes +
                                  static_cast<std::uint32_t>(job_telemetry_write_point_) * 16u;
      writeF32(destination, frequency);
      writeF32(destination + 4u, telemetry_cell_phase_[cell]);
      writeF32(destination + 8u, telemetry_cell_balance_[cell]);
      writeF32(destination + 12u, static_cast<float>(relative_level));
      ++job_telemetry_write_point_;
    }
  }

  void finishTelemetry() noexcept {
    if (!job_capture_telemetry_) {
      return;
    }
    telemetry_payload_bytes_ = static_cast<std::uint16_t>(
        kTelemetryHeaderBytes + static_cast<std::uint32_t>(job_telemetry_write_point_) * 16u);
    has_telemetry_frame_ = true;
    ++telemetry_generation_;
  }

  void mergeInverse(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    const float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    ::effetune::dsp::fft_stages::mergeInverse(spectrum, fft_input_.data(), twiddles_.data(),
                                              fft_size_, begin, end);
  }

  void separateInverse(std::uint32_t subsequence, std::uint32_t begin, std::uint32_t end) noexcept {
    ::effetune::dsp::fft_stages::separateInverse(
        fft_input_.data(), fft_stage_.data(), twiddles_.data(), fft_size_, subsequence, begin, end);
  }

  void separateInverseSubtransform(std::uint32_t encoded_subsequence, std::uint32_t begin,
                                   std::uint32_t end) noexcept {
    const std::uint32_t subsequence = encoded_subsequence / subtransform_children_;
    const std::uint32_t child = encoded_subsequence & (subtransform_children_ - 1u);
    const std::uint32_t subsequence_length = fft_size_ / 8u;
    const std::uint32_t offset = 2u * subsequence * subsequence_length;
    if (subtransform_children_ == 2u) {
      ::effetune::dsp::fft_stages::separateComplexInverseRadix2(
          fft_stage_.data() + offset, fft_input_.data() + offset, twiddles_.data(),
          subsequence_length, fft_size_, child, begin, end);
    } else {
      ::effetune::dsp::fft_stages::separateComplexInverse(
          fft_stage_.data() + offset, fft_input_.data() + offset, twiddles_.data(),
          subsequence_length, fft_size_, child, begin, end);
    }
  }

  void transformInverseSubsequence(std::uint32_t encoded_subsequence) noexcept {
    const std::uint32_t child_length = fft_size_ / (8u * subtransform_children_);
    float *inverse_subsequences =
        subtransform_children_ == 1u ? fft_stage_.data() : fft_input_.data();
    float *data = inverse_subsequences + 2u * encoded_subsequence * child_length;
    pffft_transform_ordered(complex_setup_, data, data, fft_work_.data(), PFFFT_BACKWARD);
  }

  void overlapAdd(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    const double normalization = 1.0 / (2.0 * static_cast<double>(fft_size_));
    const std::size_t output_offset = static_cast<std::size_t>(channel) * timeline_size_;
    const std::uint32_t child_length = fft_size_ / (8u * subtransform_children_);
    const float *inverse_subsequences =
        subtransform_children_ == 1u ? fft_stage_.data() : fft_input_.data();
    for (std::uint32_t base = begin; base < end; base += 8u) {
      for (std::uint32_t subsequence = 0u; subsequence < kTransformSubsequences; ++subsequence) {
        const std::uint32_t sample_index = base + 2u * subsequence;
        const std::uint32_t packed_sample = sample_index / 2u;
        const std::uint32_t sample_subsequence = packed_sample & (kTransformSubsequences - 1u);
        const std::uint32_t sample_subsequence_index = packed_sample / kTransformSubsequences;
        const std::uint32_t sample_child = sample_subsequence_index & (subtransform_children_ - 1u);
        const std::uint32_t sample_child_index = sample_subsequence_index / subtransform_children_;
        const std::uint32_t sample_source =
            2u * ((sample_subsequence * subtransform_children_ + sample_child) * child_length +
                  sample_child_index);
        for (std::uint32_t component = 0u; component < 2u; ++component) {
          const std::uint32_t index = sample_index + component;
          const std::uint32_t output_index = job_output_origin_ + index < timeline_size_
                                                 ? job_output_origin_ + index
                                                 : job_output_origin_ + index - timeline_size_;
          const double sample =
              static_cast<double>(inverse_subsequences[sample_source + component]) *
              static_cast<double>(window_[index]) * normalization;
          if (std::isfinite(sample)) {
            const double sum =
                static_cast<double>(output_ring_[output_offset + output_index]) + sample;
            if (std::isfinite(sum)) {
              output_ring_[output_offset + output_index] = static_cast<float>(sum);
            }
          }
        }
      }
    }
  }

  void runStage(const ::effetune::dsp::SchedulerStage &stage) noexcept {
    switch (static_cast<StageKind>(stage.kind)) {
    case StageKind::PackAnalysis:
      packAnalysis(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::BeginForward:
      beginForward(stage.channel);
      break;
    case StageKind::ForwardStep:
      static_cast<void>(forward_transform_->step());
      break;
    case StageKind::ForwardSubtransform:
      transformForwardSubsequence(stage.channel);
      break;
    case StageKind::CombineForwardSubtransform:
      combineForwardSubtransform(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::CombineForward:
      combineForward(stage.begin, stage.end);
      break;
    case StageKind::SplitForward:
      splitForward(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::BeginMask:
      beginMask();
      break;
    case StageKind::ClearTelemetry:
      clearTelemetry(stage.begin, stage.end);
      break;
    case StageKind::MeasurePower:
      measurePower(stage.begin, stage.end);
      break;
    case StageKind::ProcessMask:
      processMask(stage.begin, stage.end);
      break;
    case StageKind::CountTelemetry:
      countTelemetry(stage.begin, stage.end);
      break;
    case StageKind::BeginTelemetry:
      beginTelemetry();
      break;
    case StageKind::WriteTelemetry:
      writeTelemetry(stage.begin, stage.end);
      break;
    case StageKind::FinishTelemetry:
      finishTelemetry();
      break;
    case StageKind::MergeInverse:
      mergeInverse(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::SeparateInverse:
      separateInverse(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::SeparateInverseSubtransform:
      separateInverseSubtransform(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::InverseSubtransform:
      transformInverseSubsequence(stage.channel);
      break;
    case StageKind::OverlapAdd:
      overlapAdd(stage.channel, stage.begin, stage.end);
      break;
    }
  }

  void advanceStagedJob() noexcept {
#if defined(ET_PHASE_SELECT_EQ_COUNTERFACTUAL_MONOLITHIC)
    if (!job_active_ || absolute_sample_ - job_start_sample_ < kSlotSamples) {
      return;
    }
    const std::uint32_t end = stage_schedule_->stageCount();
    std::uint32_t index = 0u;
    while (index < end) {
      ::effetune::dsp::SchedulerStage stage = stage_schedule_->stage(index++);
      while (index < end) {
        const ::effetune::dsp::SchedulerStage &next = stage_schedule_->stage(index);
        if (stage.begin == stage.end || next.kind != stage.kind || next.channel != stage.channel ||
            next.begin != stage.end) {
          break;
        }
        stage.end = next.end;
        ++index;
      }
      runStage(stage);
    }
    if (job_telemetry_started_) {
      writeTelemetry(job_telemetry_cell_cursor_, kMaximumTelemetryPoints);
      job_telemetry_cell_cursor_ = kMaximumTelemetryPoints;
      finishTelemetry();
      job_telemetry_started_ = false;
    }
    job_slot_ = slot_count_;
    job_active_ = false;
#else
    while (job_active_ && job_slot_ < slot_count_ &&
           absolute_sample_ - job_start_sample_ >=
               static_cast<std::uint64_t>(job_slot_ + 1u) * kSlotSamples) {
      const std::uint32_t end = stage_schedule_->slotEnd(job_slot_);
      std::uint32_t index = stage_schedule_->slotBegin(job_slot_);
      while (index < end) {
        ::effetune::dsp::SchedulerStage stage = stage_schedule_->stage(index++);
        while (index < end) {
          const auto &next = stage_schedule_->stage(index);
          if (stage.begin == stage.end || next.kind != stage.kind ||
              next.channel != stage.channel || next.begin != stage.end) {
            break;
          }
          stage.end = next.end;
          ++index;
        }
        runStage(stage);
      }
      if (job_telemetry_started_) {
        const std::uint32_t slots_left = slot_count_ - job_slot_;
        const std::uint32_t cells_left = kMaximumTelemetryPoints - job_telemetry_cell_cursor_;
        const std::uint32_t cell_count = (cells_left + slots_left - 1u) / slots_left;
        const std::uint32_t cell_end = job_telemetry_cell_cursor_ + cell_count;
        writeTelemetry(job_telemetry_cell_cursor_, cell_end);
        job_telemetry_cell_cursor_ = cell_end;
      }
      ++job_slot_;
      if (job_slot_ == slot_count_) {
        if (job_telemetry_started_) {
          finishTelemetry();
          job_telemetry_started_ = false;
        }
        job_active_ = false;
      }
    }
#endif
  }

  void startStagedJob() noexcept {
    job_start_sample_ = absolute_sample_;
    job_frame_origin_ = timeline_position_ >= fft_size_
                            ? timeline_position_ - fft_size_
                            : timeline_position_ + timeline_size_ - fft_size_;
    job_output_origin_ = timeline_position_ + hop_size_ < timeline_size_
                             ? timeline_position_ + hop_size_
                             : timeline_position_ + hop_size_ - timeline_size_;
    job_slot_ = 0u;
    job_capture_telemetry_ = false;
    job_maximum_left_power_ = 0.0;
    job_maximum_right_power_ = 0.0;
    job_left_floor_ = kPhaseAbsolutePowerFloor;
    job_right_floor_ = kPhaseAbsolutePowerFloor;
    job_total_floor_ = kPhaseAbsolutePowerFloor;
    job_telemetry_maximum_energy_ = 0.0;
    job_telemetry_cell_cursor_ = 0u;
    job_telemetry_started_ = false;
    bool shaped = false;
    job_solo_active_ = false;
    job_balance_constrained_ = false;
    for (std::uint32_t region = 0u; region < kRegionCount; ++region) {
      job_regions_[region] = snapshotRegion(region);
      if (!job_regions_[region].enabled) {
        continue;
      }
      if (job_regions_[region].solo) {
        job_solo_active_ = true;
      }
      if (hasBalanceConstraint(job_regions_[region])) {
        job_balance_constrained_ = true;
      }
      if (job_regions_[region].gain != 1.0) {
        shaped = true;
      }
    }
    job_identity_ = !shaped && !job_solo_active_;
    job_active_ = true;
  }

  PFFFT_Setup *real_setup_ = nullptr;
  PFFFT_Setup *complex_setup_ = nullptr;
  std::unique_ptr<::effetune::dsp::PffftOrderedRealForward> forward_transform_;
  double sample_rate_ = 0.0;
  double processing_max_frequency_ = 0.0;
  double wet_mix_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t fft_size_ = 0u;
  std::uint32_t hop_size_ = 0u;
  std::uint32_t slot_count_ = 0u;
  std::uint32_t subtransform_children_ = 1u;
  std::uint32_t timeline_size_ = 0u;
  std::uint32_t bin_count_ = 0u;
  std::uint32_t first_active_bin_ = 0u;
  std::uint32_t active_bin_end_ = 0u;
  std::uint32_t timeline_position_ = 0u;
  std::uint32_t current_channel_count_ = 0u;
  std::uint64_t absolute_sample_ = 0u;
  std::uint64_t next_frame_sample_ = 0u;
  std::uint64_t job_start_sample_ = 0u;
  std::uint64_t telemetry_interval_samples_ = 1u;
  std::uint64_t next_telemetry_sample_ = 0u;
  std::uint32_t job_frame_origin_ = 0u;
  std::uint32_t job_output_origin_ = 0u;
  std::uint32_t job_slot_ = 0u;
  std::uint32_t telemetry_generation_ = 0u;
  std::uint32_t last_written_telemetry_generation_ = 0u;
  std::uint16_t telemetry_payload_bytes_ = 0u;
  std::uint16_t job_telemetry_point_count_ = 0u;
  std::uint16_t job_telemetry_write_point_ = 0u;
  std::uint32_t job_telemetry_cell_cursor_ = 0u;
  bool job_active_ = false;
  bool job_identity_ = true;
  bool job_solo_active_ = false;
  bool job_balance_constrained_ = false;
  bool job_capture_telemetry_ = false;
  bool job_telemetry_started_ = false;
  bool prepared_ = false;
  bool has_telemetry_frame_ = false;
  double job_maximum_left_power_ = 0.0;
  double job_maximum_right_power_ = 0.0;
  double job_left_floor_ = kPhaseAbsolutePowerFloor;
  double job_right_floor_ = kPhaseAbsolutePowerFloor;
  double job_total_floor_ = kPhaseAbsolutePowerFloor;
  double job_telemetry_maximum_energy_ = 0.0;
  std::array<RegionSnapshot, kRegionCount> job_regions_{};
  using StageSchedule = ::effetune::dsp::StageSchedule<kStageCapacity, kMaximumSlots>;
  std::unique_ptr<StageSchedule> stage_schedule_;
  AlignedFloatBuffer input_ring_;
  AlignedFloatBuffer dry_ring_;
  AlignedFloatBuffer output_ring_;
  AlignedFloatBuffer spectra_;
  AlignedFloatBuffer window_;
  AlignedFloatBuffer fft_input_;
  AlignedFloatBuffer fft_work_;
  AlignedFloatBuffer fft_stage_;
  AlignedFloatBuffer twiddles_;
  std::vector<double> bin_log_frequency_;
  std::vector<std::uint16_t> bin_telemetry_cell_;
  std::vector<double> telemetry_cell_energy_;
  std::vector<std::uint32_t> telemetry_cell_bin_;
  std::vector<float> telemetry_cell_phase_;
  std::vector<float> telemetry_cell_balance_;
  std::vector<std::uint8_t> telemetry_payload_;
};

static_assert(sizeof(PhaseSelectEqKernel) <= 8192u);

} // namespace effetune::plugins::spatial

#if defined(ET_PHASE_SELECT_EQ_COUNTERFACTUAL_MONOLITHIC)
EFFETUNE_REGISTER_KERNEL(PhaseSelectEqCounterfactualPlugin,
                         effetune::plugins::spatial::PhaseSelectEqCounterfactualKernel)
#else
EFFETUNE_REGISTER_KERNEL(PhaseSelectEqPlugin, effetune::plugins::spatial::PhaseSelectEqKernel)
#endif

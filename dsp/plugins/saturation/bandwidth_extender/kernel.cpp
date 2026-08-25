#include "effetune/kernel.h"
#include "BandwidthExtenderPluginParams.h"
#include "effetune/dsp/fft_stages.h"
#include "effetune/dsp/stage_scheduler.h"
#include "effetune/dsp/xorshift_rng.h"

#include <pffft.h>

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
#include <vector>

namespace effetune::plugins::saturation {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kCeilingHz = 40000.0;
constexpr double kUpperTransitionMaximumHz = 1000.0;
constexpr double kEnvelopeReferenceHz = 500.0;
constexpr double kEnvelopeTargetGain = 1.8;
constexpr double kDetectionMinimumHz = 10000.0;
constexpr double kSchedulingCutoffHz = 16000.0;
constexpr double kHighCutoffSchedulingHz = 20000.0;
constexpr double kCliffReferenceHz = 2000.0;
constexpr double kShoulderRecoveryPower = 0.5;
constexpr double kPhaseAdvanceQuantization = 10000.0;
constexpr std::uint32_t kMaximumHarmonic = 5u;
constexpr std::array<double, kMaximumHarmonic + 1u> kHarmonicGains{0.0,  0.0,  0.28,
                                                                   0.14, 0.07, 0.035};
constexpr double kInverseSqrtTwo = 0.70710678118654752440084436210485;
constexpr std::uint32_t kSlotSamples = 16u;
constexpr std::uint32_t kMaximumSlots = 64u;
constexpr std::uint32_t kStageCapacity = 768u;
constexpr std::uint32_t kTransformSubsequences = 4u;
constexpr std::uint32_t kAnalysisChunks = 4u;
constexpr std::uint32_t kBinChunks = 8u;
constexpr std::uint32_t kCombineChunks = 8u;
constexpr std::uint32_t kSeparateChunks = 4u;
constexpr std::uint32_t kPhaseChunks = 64u;
constexpr std::uint32_t kMinimumDetectorChunks = 80u;
constexpr std::uint32_t kDetectorWeightNumerator = 9u;
constexpr std::uint32_t kDetectorWeightDenominator = 4u;
constexpr std::uint32_t kSynthesisChunks = 8u;
constexpr std::uint32_t kEnvelopeChunks = 32u;
constexpr std::uint32_t kNoisePhaseChunks = 32u;
constexpr std::uint32_t kHarmonicClearChunks = 4u;
constexpr std::uint32_t kHarmonicDonorChunks = 8u;

enum class StageKind : std::uint8_t {
  BeginAnalysis,
  PackAnalysis,
  ForwardSubtransform,
  CombineForward,
  SplitForward,
  AccumulatePower,
  ScalePower,
  SourcePhases,
  BeginDetector,
  DetectorScan,
  FinishDetector,
  BeginSynthesis,
  SynthesisEnvelope,
  EnvelopeReference,
  SpatialReference,
  MonoReference,
  FinishReferences,
  NoisePhases,
  ClearHarmonics,
  BeginHarmonic,
  HarmonicDonor,
  FinishHarmonic,
  HarmonicBody,
  ClearSynthesis,
  BuildHarmonic,
  BuildNoise,
  MergeInverse,
  SeparateInverse,
  InverseSubtransform,
  OverlapAdd,
};

enum class ScheduleKind : std::uint8_t {
  ManualInactive,
  ManualActive,
  ManualHighCutoff,
  Auto,
};

using StageSchedule = ::effetune::dsp::StageSchedule<kStageCapacity, kMaximumSlots>;

std::uint32_t fftSizeForRate(double sample_rate) noexcept {
  if (sample_rate <= 50000.0) {
    return 1024u;
  }
  if (sample_rate <= 100000.0) {
    return 2048u;
  }
  return 4096u;
}

double clamp01(double value) noexcept {
  if (value < 0.0) {
    return 0.0;
  }
  return value > 1.0 ? 1.0 : value;
}

double wrapPhase(double phase) noexcept { return std::remainder(phase, 2.0 * kPi); }

double quantizePhaseAdvance(double phase) noexcept {
  return std::round(phase * kPhaseAdvanceQuantization) / kPhaseAdvanceQuantization;
}

double tonalPeakWeight(double magnitude, double power, double previous_power, double next_power,
                       double reference) noexcept {
  if (reference <= 1.0e-15) {
    return 0.0;
  }
  const double band_prominence = clamp01((magnitude / reference - 2.0) * 0.25);
  const double neighbor_power = previous_power > next_power ? previous_power : next_power;
  const double local_prominence =
      clamp01((power / (neighbor_power + reference * reference * 1.0e-12) - 1.0) / 3.0);
  return band_prominence * local_prominence;
}

} // namespace

class BandwidthExtenderKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::BandwidthExtenderPluginParams)

public:
  ~BandwidthExtenderKernel() override { releaseSetup(); }

  void prepare(const PrepareInfo &info) override {
    releaseSetup();
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    if (!std::isfinite(sample_rate_) || sample_rate_ <= 0.0 || max_channels_ == 0u ||
        max_frames_ == 0u) {
      return;
    }

    fft_size_ = fftSizeForRate(sample_rate_);
    hop_size_ = fft_size_ / 4u;
    timeline_size_ = fft_size_ + hop_size_;
    slot_count_ = hop_size_ / kSlotSamples;
    bin_count_ = fft_size_ / 2u + 1u;
    if (slot_count_ == 0u || slot_count_ > kMaximumSlots) {
      return;
    }

    if (manual_inactive_schedule_ == nullptr) {
      manual_inactive_schedule_.reset(new (std::nothrow) StageSchedule());
    }
    if (manual_active_schedule_ == nullptr) {
      manual_active_schedule_.reset(new (std::nothrow) StageSchedule());
    }
    if (manual_high_cutoff_schedule_ == nullptr) {
      manual_high_cutoff_schedule_.reset(new (std::nothrow) StageSchedule());
    }
    if (auto_schedule_ == nullptr) {
      auto_schedule_.reset(new (std::nothrow) StageSchedule());
    }
    complex_setup_ = pffft_new_setup(static_cast<int>(fft_size_ / 8u), PFFFT_COMPLEX);
    prepared_ = complex_setup_ != nullptr && manual_inactive_schedule_ != nullptr &&
                manual_active_schedule_ != nullptr && manual_high_cutoff_schedule_ != nullptr &&
                auto_schedule_ != nullptr;
    if (!prepared_) {
      return;
    }

    const std::size_t timeline_samples = static_cast<std::size_t>(max_channels_) * timeline_size_;
    const std::size_t spectrum_samples = static_cast<std::size_t>(max_channels_) * fft_size_;
    input_ring_.assign(timeline_samples, 0.0F);
    dry_ring_.assign(timeline_samples, 0.0F);
    harmonic_wet_ring_.assign(timeline_samples, 0.0F);
    noise_wet_ring_.assign(timeline_samples, 0.0F);
    harmonic_amount_delay_.assign(hop_size_, 0.0);
    noise_amount_delay_.assign(hop_size_, 0.0);
    spectra_.assign(spectrum_samples, 0.0F);
    window_.resize(fft_size_);
    fft_input_.assign(fft_size_, 0.0F);
    fft_work_.assign(fft_size_, 0.0F);
    fft_stage_.assign(fft_size_, 0.0F);
    twiddles_.assign(2u * fft_size_, 0.0F);
    synthesis_spectrum_.assign(fft_size_, 0.0F);
    harmonic_spectra_.assign(spectrum_samples, 0.0F);
    shared_power_.assign(bin_count_, 0.0);
    synthesis_envelope_.assign(bin_count_, 0.0);
    noise_cos_.assign(bin_count_, 0.0F);
    noise_sin_.assign(bin_count_, 0.0F);
    secondary_noise_cos_.assign(bin_count_, 0.0F);
    secondary_noise_sin_.assign(bin_count_, 0.0F);
    const std::size_t phase_samples = static_cast<std::size_t>(max_channels_) * bin_count_;
    source_phase_.assign(phase_samples, 0.0);
    source_phase_advance_.assign(phase_samples, 0.0);
    source_phase_valid_.assign(phase_samples, 0u);
    const std::size_t harmonic_phase_samples =
        static_cast<std::size_t>(max_channels_) * (kMaximumHarmonic + 1u) * bin_count_;
    harmonic_phase_.assign(harmonic_phase_samples, 0.0);
    harmonic_phase_valid_.assign(harmonic_phase_samples, 0u);
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const double phase = 2.0 * kPi * static_cast<double>(index) / static_cast<double>(fft_size_);
      window_[index] = static_cast<float>(std::sqrt(0.5 - 0.5 * std::cos(phase)));
    }
    ::effetune::dsp::fft_stages::prepareTwiddles(twiddles_.data(), fft_size_);
    prepareDetectorMetadata();
    if (!buildStageSchedule(*manual_inactive_schedule_, ScheduleKind::ManualInactive) ||
        !buildStageSchedule(*manual_active_schedule_, ScheduleKind::ManualActive) ||
        !buildStageSchedule(*manual_high_cutoff_schedule_, ScheduleKind::ManualHighCutoff) ||
        !buildStageSchedule(*auto_schedule_, ScheduleKind::Auto)) {
      prepared_ = false;
      return;
    }
    component_smoothing_ = 1.0 - std::exp(-1.0 / (0.02 * sample_rate_));
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return prepared_ ? timeline_size_ : 0u;
  }

  void reset() noexcept override {
    clearAudioState();
    selected_seed_low_ = selected_seed_low_ == 0u && selected_seed_high_ == 0u
                             ? static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed)
                             : selected_seed_low_;
    mid_random_.seed(selected_seed_low_, selected_seed_high_);
    side_random_.seed(selected_seed_low_ ^ 0x9e3779b9u, selected_seed_high_ ^ 0x7f4a7c15u);
    timeline_position_ = 0u;
    amount_delay_position_ = 0u;
    absolute_sample_ = 0u;
    next_frame_sample_ = fft_size_;
    job_start_sample_ = 0u;
    job_frame_origin_ = 0u;
    job_output_origin_ = 0u;
    job_slot_ = 0u;
    job_channel_count_ = 0u;
    job_schedule_ = nullptr;
    job_active_ = false;
    last_channel_count_ = 0u;
    stable_frames_ = 0u;
    stable_cutoff_bin_ = 0u;
    detected_cutoff_hz_ = 16000.0;
    detector_confidence_ = 0.0;
    detector_active_ = false;
    harmonic_amount_smoothed_ = 0.0;
    noise_amount_smoothed_ = 0.0;
    resetJobState();
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    mid_random_.seed(seed_low, seed_high);
    side_random_.seed(seed_low ^ 0x9e3779b9u, seed_high ^ 0x7f4a7c15u);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || channel_count > 2u ||
        channel_count > max_channels_ || frame_count == 0u || frame_count > max_frames_) {
      return;
    }
    if (last_channel_count_ != 0u && last_channel_count_ != channel_count) {
      reset();
    }
    last_channel_count_ = channel_count;

    const double requested_harmonic_amount = static_cast<double>(params_.harmonicAmount) * 0.01;
    const double harmonic_amount_target =
        requested_harmonic_amount < 0.0
            ? 0.0
            : (requested_harmonic_amount > 2.0 ? 2.0 : requested_harmonic_amount);
    const double requested_noise_amount = static_cast<double>(params_.noiseAmount) * 0.01;
    const double noise_amount_target =
        requested_noise_amount < 0.0
            ? 0.0
            : (requested_noise_amount > 2.0 ? 2.0 : requested_noise_amount);
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      harmonic_amount_smoothed_ +=
          (harmonic_amount_target - harmonic_amount_smoothed_) * component_smoothing_;
      noise_amount_smoothed_ +=
          (noise_amount_target - noise_amount_smoothed_) * component_smoothing_;
      const double harmonic_amount = harmonic_amount_delay_[amount_delay_position_];
      const double noise_amount = noise_amount_delay_[amount_delay_position_];
      harmonic_amount_delay_[amount_delay_position_] = harmonic_amount_smoothed_;
      noise_amount_delay_[amount_delay_position_] = noise_amount_smoothed_;
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t block_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const std::size_t ring_index =
            static_cast<std::size_t>(channel) * timeline_size_ + timeline_position_;
        const float input = std::isfinite(audio[block_index]) ? audio[block_index] : 0.0F;
        const float dry = dry_ring_[ring_index];
        dry_ring_[ring_index] = input;
        input_ring_[ring_index] = input;
        const float harmonic_wet = harmonic_wet_ring_[ring_index];
        harmonic_wet_ring_[ring_index] = 0.0F;
        const float noise_wet = noise_wet_ring_[ring_index];
        noise_wet_ring_[ring_index] = 0.0F;
        const double output = static_cast<double>(dry) +
                              static_cast<double>(harmonic_wet) * harmonic_amount +
                              static_cast<double>(noise_wet) * noise_amount;
        audio[block_index] = std::isfinite(output) ? static_cast<float>(output) : dry;
      }

      ++timeline_position_;
      if (timeline_position_ == timeline_size_) {
        timeline_position_ = 0u;
      }
      ++amount_delay_position_;
      if (amount_delay_position_ == hop_size_) {
        amount_delay_position_ = 0u;
      }
      ++absolute_sample_;
      advanceStagedJob();
      if (absolute_sample_ == next_frame_sample_) {
        startStagedJob(channel_count);
        next_frame_sample_ += hop_size_;
      }
    }
  }

private:
  void releaseSetup() noexcept {
    if (complex_setup_ != nullptr) {
      pffft_destroy_setup(complex_setup_);
      complex_setup_ = nullptr;
    }
    prepared_ = false;
  }

  void clearAudioState() noexcept {
    for (float &sample : input_ring_) {
      sample = 0.0F;
    }
    for (float &sample : dry_ring_) {
      sample = 0.0F;
    }
    for (float &sample : harmonic_wet_ring_) {
      sample = 0.0F;
    }
    for (float &sample : noise_wet_ring_) {
      sample = 0.0F;
    }
    for (double &amount : harmonic_amount_delay_) {
      amount = 0.0;
    }
    for (double &amount : noise_amount_delay_) {
      amount = 0.0;
    }
    for (float &sample : spectra_) {
      sample = 0.0F;
    }
    for (float &sample : fft_input_) {
      sample = 0.0F;
    }
    for (float &sample : fft_work_) {
      sample = 0.0F;
    }
    for (float &sample : fft_stage_) {
      sample = 0.0F;
    }
    for (float &sample : synthesis_spectrum_) {
      sample = 0.0F;
    }
    for (float &sample : harmonic_spectra_) {
      sample = 0.0F;
    }
    for (double &power : shared_power_) {
      power = 0.0;
    }
    for (double &envelope : synthesis_envelope_) {
      envelope = 0.0;
    }
    for (double &phase : source_phase_) {
      phase = 0.0;
    }
    for (double &advance : source_phase_advance_) {
      advance = 0.0;
    }
    for (std::uint8_t &valid : source_phase_valid_) {
      valid = 0u;
    }
    for (double &phase : harmonic_phase_) {
      phase = 0.0;
    }
    for (std::uint8_t &valid : harmonic_phase_valid_) {
      valid = 0u;
    }
  }

  void resetJobState() noexcept {
    job_manual_ = false;
    job_synthesis_active_ = false;
    job_cutoff_frequency_ = 16000.0;
    job_bin_hz_ = 0.0;
    job_cutoff_bin_ = 0u;
    job_ceiling_bin_ = 0u;
    job_reference_start_ = 0u;
    job_reference_count_ = 0u;
    job_envelope_reference_start_ = 0u;
    job_envelope_reference_count_ = 0u;
    job_envelope_arithmetic_ = 0.0;
    job_average_magnitude_ = 0.0;
    job_mid_energy_ = 0.0;
    job_side_energy_ = 0.0;
    job_cross_real_ = 0.0;
    job_cross_imaginary_ = 0.0;
    job_mid_reference_ = 0.0;
    job_side_reference_ = 0.0;
    job_mid_side_coherence_real_ = 0.0;
    job_mid_side_coherence_imaginary_ = 0.0;
    job_channel_reference_ = 0.0;
    job_best_ratio_ = 1.0;
    job_best_cliff_ = 1.0;
    job_best_reference_ = 0.0;
    job_best_bin_ = 0u;
    job_harmonic_component_ = 0u;
    job_harmonic_order_ = 0u;
    job_harmonic_source_start_ = 0u;
    job_harmonic_source_end_ = 0u;
    job_donor_sum_ = 0.0;
    job_donor_reference_ = 0.0;
  }

  void prepareDetectorMetadata() noexcept {
    const double bin_hz = sample_rate_ / static_cast<double>(fft_size_);
    const double detector_ceiling_hz =
        kCeilingHz < sample_rate_ * 0.46 ? kCeilingHz : sample_rate_ * 0.46;
    detector_first_ = static_cast<std::uint32_t>(std::ceil(kDetectionMinimumHz / bin_hz));
    detector_last_ = static_cast<std::uint32_t>(detector_ceiling_hz / bin_hz);
    const std::uint32_t half_window_raw = static_cast<std::uint32_t>(500.0 / bin_hz);
    detector_half_window_ = half_window_raw < 4u ? 4u : half_window_raw;
    if (detector_first_ < detector_half_window_ + 1u) {
      detector_first_ = detector_half_window_ + 1u;
    }
    if (detector_last_ + detector_half_window_ >= bin_count_) {
      detector_last_ = bin_count_ - detector_half_window_ - 1u;
    }
    detector_ceiling_bin_ = static_cast<std::uint32_t>(detector_ceiling_hz / bin_hz);
    if (detector_ceiling_bin_ >= bin_count_) {
      detector_ceiling_bin_ = bin_count_ - 1u;
    }
    const std::uint32_t cliff_reference_width_raw =
        static_cast<std::uint32_t>(kCliffReferenceHz / bin_hz);
    detector_cliff_reference_width_ =
        cliff_reference_width_raw < 8u ? 8u : cliff_reference_width_raw;
  }

  void addStage(StageKind kind, std::uint32_t channel, std::uint32_t begin, std::uint32_t end,
                std::uint32_t weight) noexcept {
    building_schedule_->addStage(static_cast<std::uint8_t>(kind), channel, begin, end, weight);
  }

  void addLinearStages(StageKind kind, std::uint32_t channel, std::uint32_t begin,
                       std::uint32_t end, std::uint32_t chunks, std::uint32_t work_per_item,
                       std::uint32_t weighted_begin = 0u,
                       std::uint32_t weighted_end = 0xffffffffu) noexcept {
    // The shared scheduler cannot split one stage, so linear passes are chunked here before
    // minimax partitioning assigns them to fixed 16-sample slots.
    const std::uint32_t work_range_begin = begin > weighted_begin ? begin : weighted_begin;
    const std::uint32_t work_range_end = end < weighted_end ? end : weighted_end;
    const bool partition_weighted_range =
        work_range_end > work_range_begin && (work_range_begin > begin || work_range_end < end);
    const std::uint32_t item_count =
        partition_weighted_range ? work_range_end - work_range_begin : end - begin;
    for (std::uint32_t chunk = 0u; chunk < chunks; ++chunk) {
      const std::uint32_t partition_begin = partition_weighted_range ? work_range_begin : begin;
      const std::uint32_t chunk_begin =
          chunk == 0u
              ? begin
              : partition_begin + static_cast<std::uint32_t>(
                                      static_cast<std::uint64_t>(item_count) * chunk / chunks);
      const std::uint32_t chunk_end =
          chunk + 1u == chunks
              ? end
              : partition_begin +
                    static_cast<std::uint32_t>(static_cast<std::uint64_t>(item_count) *
                                               (chunk + 1u) / chunks);
      const std::uint32_t work_begin = chunk_begin > weighted_begin ? chunk_begin : weighted_begin;
      const std::uint32_t work_end = chunk_end < weighted_end ? chunk_end : weighted_end;
      const std::uint32_t weighted_items = work_end > work_begin ? work_end - work_begin : 0u;
      const std::uint64_t work = static_cast<std::uint64_t>(work_per_item) * weighted_items;
      addStage(kind, channel, chunk_begin, chunk_end,
               work == 0u ? 1u : static_cast<std::uint32_t>(work));
    }
  }

  [[nodiscard]] std::uint32_t detectorCandidateWeight(std::uint32_t candidate) const noexcept {
    const std::uint32_t high_side_start = candidate + detector_half_window_;
    const std::uint32_t high_side_count =
        detector_ceiling_bin_ > high_side_start ? detector_ceiling_bin_ - high_side_start : 0u;
    return 4u * detector_half_window_ + high_side_count + detector_cliff_reference_width_;
  }

  void addDetectorStages() noexcept {
    const std::uint32_t end = detector_last_ + 1u;
    const std::uint32_t scaled_chunks = slot_count_ / 2u;
    const std::uint32_t detector_chunks =
        scaled_chunks > kMinimumDetectorChunks ? scaled_chunks : kMinimumDetectorChunks;
    std::uint64_t total_work = 0u;
    for (std::uint32_t candidate = detector_first_; candidate < end; ++candidate) {
      total_work += detectorCandidateWeight(candidate);
    }
    std::uint32_t begin = detector_first_;
    std::uint64_t consumed = 0u;
    for (std::uint32_t chunk = 0u; chunk < detector_chunks; ++chunk) {
      std::uint32_t chunk_end = begin;
      if (chunk + 1u == detector_chunks) {
        chunk_end = end;
      } else {
        const std::uint64_t target = total_work * (chunk + 1u) / detector_chunks;
        while (chunk_end < end - (detector_chunks - chunk - 1u) && consumed < target) {
          consumed += detectorCandidateWeight(chunk_end);
          ++chunk_end;
        }
      }
      std::uint64_t weight = 0u;
      for (std::uint32_t candidate = begin; candidate < chunk_end; ++candidate) {
        weight += detectorCandidateWeight(candidate);
      }
      weight = (weight * kDetectorWeightNumerator + kDetectorWeightDenominator - 1u) /
               kDetectorWeightDenominator;
      addStage(StageKind::DetectorScan, 0u, begin, chunk_end,
               weight == 0u ? 1u : static_cast<std::uint32_t>(weight));
      begin = chunk_end;
    }
  }

  [[nodiscard]] std::uint32_t synthesisCeilingBin() const noexcept {
    const double nyquist = sample_rate_ * 0.5;
    const double ceiling_hz = kCeilingHz < nyquist * 0.92 ? kCeilingHz : nyquist * 0.92;
    const double bin_hz = sample_rate_ / static_cast<double>(fft_size_);
    const std::uint32_t ceiling_bin = static_cast<std::uint32_t>(ceiling_hz / bin_hz);
    return ceiling_bin < bin_count_ ? ceiling_bin : bin_count_ - 1u;
  }

  [[nodiscard]] bool buildStageSchedule(StageSchedule &schedule,
                                        ScheduleKind schedule_kind) noexcept {
    building_schedule_ = &schedule;
    schedule.clear();
    const bool include_detector = schedule_kind == ScheduleKind::Auto;
    const bool include_synthesis = schedule_kind != ScheduleKind::ManualInactive;
    const std::uint32_t packed_size = fft_size_ / 2u;
    const std::uint32_t subsequence_length = fft_size_ / 8u;
    const std::uint32_t synthesis_ceiling_bin = synthesisCeilingBin();
    const std::uint32_t maximum_harmonic_source_end = (synthesis_ceiling_bin - 1u) / 2u + 1u;
    const double bin_hz = sample_rate_ / static_cast<double>(fft_size_);
    const double scheduling_cutoff_hz = schedule_kind == ScheduleKind::ManualHighCutoff
                                            ? kHighCutoffSchedulingHz
                                            : kSchedulingCutoffHz;
    const std::uint32_t scheduling_cutoff_bin =
        static_cast<std::uint32_t>(std::ceil(scheduling_cutoff_hz / bin_hz));
    const std::uint32_t transform_weight = 21u * subsequence_length;
    addStage(StageKind::BeginAnalysis, 0u, 0u, 0u, bin_count_);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      addLinearStages(StageKind::PackAnalysis, channel, 0u, packed_size, kAnalysisChunks, 7u);
      for (std::uint32_t subsequence = 0u; subsequence < kTransformSubsequences; ++subsequence) {
        addStage(StageKind::ForwardSubtransform, channel, subsequence, 0u, transform_weight);
      }
      addLinearStages(StageKind::CombineForward, channel, 0u, packed_size, kCombineChunks, 30u);
      addLinearStages(StageKind::SplitForward, channel, 0u, packed_size, kBinChunks, 20u);
      addLinearStages(StageKind::AccumulatePower, channel, 0u, bin_count_, kAnalysisChunks, 5u);
    }
    addLinearStages(StageKind::ScalePower, 0u, 0u, bin_count_, kBinChunks, 1u);
    for (std::uint32_t component = 0u; component < 2u; ++component) {
      addLinearStages(StageKind::SourcePhases, component, 1u, maximum_harmonic_source_end,
                      kPhaseChunks, 220u);
    }

    if (include_detector) {
      addStage(StageKind::BeginDetector, 0u, 0u, 0u, 180u);
      addDetectorStages();
      addStage(StageKind::FinishDetector, 0u, 0u, 0u, 1500u);
    }
    addStage(StageKind::BeginSynthesis, 0u, 0u, 0u, 500u);
    if (!include_synthesis) {
      building_schedule_ = nullptr;
      return schedule.stageCount() <= kStageCapacity && schedule.partition(slot_count_);
    }
    addLinearStages(StageKind::SynthesisEnvelope, 0u, 1u, synthesis_ceiling_bin, kEnvelopeChunks,
                    100u, scheduling_cutoff_bin, synthesis_ceiling_bin);
    addLinearStages(StageKind::EnvelopeReference, 0u, 1u, synthesis_ceiling_bin, kSynthesisChunks,
                    1u);
    addLinearStages(StageKind::SpatialReference, 0u, 1u, synthesis_ceiling_bin, kSynthesisChunks,
                    2u);
    addLinearStages(StageKind::MonoReference, 0u, 1u, synthesis_ceiling_bin, kSynthesisChunks, 1u);
    addStage(StageKind::FinishReferences, 0u, 0u, 0u, 350u);
    addLinearStages(StageKind::NoisePhases, 0u, 1u, synthesis_ceiling_bin, kNoisePhaseChunks, 180u,
                    scheduling_cutoff_bin, synthesis_ceiling_bin);

    for (std::uint32_t component = 0u; component < 2u; ++component) {
      addLinearStages(StageKind::ClearHarmonics, component, 0u, fft_size_, kHarmonicClearChunks,
                      1u);
    }
    for (std::uint32_t component = 0u; component < 2u; ++component) {
      for (std::uint32_t harmonic = 2u; harmonic <= kMaximumHarmonic; ++harmonic) {
        const std::uint32_t encoded = component * (kMaximumHarmonic + 1u) + harmonic;
        const std::uint32_t harmonic_source_end = (synthesis_ceiling_bin - 1u) / harmonic + 1u;
        const std::uint32_t scheduling_source_start =
            (scheduling_cutoff_bin + harmonic - 1u) / harmonic;
        addStage(StageKind::BeginHarmonic, encoded, 0u, 0u, 135u);
        addLinearStages(StageKind::HarmonicDonor, encoded, 2u, harmonic_source_end,
                        kHarmonicDonorChunks, 12u, scheduling_source_start, harmonic_source_end);
        addStage(StageKind::FinishHarmonic, encoded, 0u, 0u, 115u);
        const std::uint32_t body_chunks = harmonic == 2u ? 4u : 6u;
        addLinearStages(StageKind::HarmonicBody, encoded, 2u, harmonic_source_end, body_chunks,
                        240u, scheduling_source_start, harmonic_source_end);
      }
    }

    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t kind = 0u; kind < 2u; ++kind) {
        const std::uint32_t render_target = kind * 2u + channel;
        addLinearStages(StageKind::ClearSynthesis, render_target, 0u, fft_size_, kBinChunks, 1u);
        addLinearStages(kind == 0u ? StageKind::BuildHarmonic : StageKind::BuildNoise,
                        render_target, 1u, synthesis_ceiling_bin, kBinChunks,
                        kind == 0u ? 11u : 58u, scheduling_cutoff_bin, synthesis_ceiling_bin);
        addLinearStages(StageKind::MergeInverse, render_target, 0u, packed_size, kBinChunks, 13u);
        for (std::uint32_t subsequence = 0u; subsequence < kTransformSubsequences; ++subsequence) {
          const std::uint32_t encoded = render_target * kTransformSubsequences + subsequence;
          addLinearStages(StageKind::SeparateInverse, encoded, 0u, subsequence_length,
                          kSeparateChunks, 17u);
        }
        for (std::uint32_t subsequence = 0u; subsequence < kTransformSubsequences; ++subsequence) {
          addStage(StageKind::InverseSubtransform, render_target, subsequence, 0u,
                   transform_weight);
        }
        addLinearStages(StageKind::OverlapAdd, render_target, 0u, fft_size_, kBinChunks, 9u);
      }
    }
    building_schedule_ = nullptr;
    return schedule.stageCount() <= kStageCapacity && schedule.partition(slot_count_);
  }

  void beginAnalysis() noexcept {
    for (double &power : shared_power_) {
      power = 0.0;
    }
  }

  void packAnalysis(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    if (channel >= job_channel_count_) {
      return;
    }
    const std::size_t input_offset = static_cast<std::size_t>(channel) * timeline_size_;
    ::effetune::dsp::fft_stages::packWindowed(input_ring_.data(), input_offset, timeline_size_,
                                              job_frame_origin_, window_.data(), fft_input_.data(),
                                              fft_size_, begin, end);
  }

  void transformSubsequence(std::uint32_t subsequence, pffft_direction_t direction) noexcept {
    const std::uint32_t subsequence_length = fft_size_ / 8u;
    float *data = fft_input_.data() + 2u * subsequence * subsequence_length;
    pffft_transform_ordered(complex_setup_, data, data, fft_work_.data(), direction);
  }

  void combineForward(std::uint32_t begin, std::uint32_t end) noexcept {
    ::effetune::dsp::fft_stages::combineForward(fft_input_.data(), fft_stage_.data(),
                                                twiddles_.data(), fft_size_, begin, end);
  }

  void splitForward(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    if (channel >= job_channel_count_) {
      return;
    }
    float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    ::effetune::dsp::fft_stages::splitForward(fft_stage_.data(), spectrum, twiddles_.data(),
                                              fft_size_, begin, end);
  }

  void accumulatePower(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    if (channel >= job_channel_count_) {
      return;
    }
    const float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      if (bin == 0u) {
        shared_power_[bin] += static_cast<double>(spectrum[0]) * spectrum[0];
      } else if (bin + 1u == bin_count_) {
        shared_power_[bin] += static_cast<double>(spectrum[1]) * spectrum[1];
      } else {
        const double real = static_cast<double>(spectrum[bin * 2u]);
        const double imaginary = static_cast<double>(spectrum[bin * 2u + 1u]);
        shared_power_[bin] += real * real + imaginary * imaginary;
      }
    }
  }

  void scalePower(std::uint32_t begin, std::uint32_t end) noexcept {
    const double channel_scale = 1.0 / static_cast<double>(job_channel_count_);
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      shared_power_[bin] *= channel_scale;
    }
  }

  void updateSourcePhases(std::uint32_t component, std::uint32_t begin,
                          std::uint32_t end) noexcept {
    if (component >= job_channel_count_) {
      return;
    }
    const double expected_scale =
        2.0 * kPi * static_cast<double>(hop_size_) / static_cast<double>(fft_size_);
    const std::size_t phase_offset = static_cast<std::size_t>(component) * bin_count_;
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      double real = 0.0;
      double imaginary = 0.0;
      analysisBin(component, bin, real, imaginary);
      const double phase = std::atan2(imaginary, real);
      const std::size_t phase_index = phase_offset + bin;
      const double expected = expected_scale * static_cast<double>(bin);
      if (source_phase_valid_[phase_index] != 0u) {
        const double residual = wrapPhase(phase - source_phase_[phase_index] - expected);
        source_phase_advance_[phase_index] = quantizePhaseAdvance(expected + residual);
      } else {
        source_phase_advance_[phase_index] = quantizePhaseAdvance(expected);
        source_phase_valid_[phase_index] = 1u;
      }
      source_phase_[phase_index] = phase;
    }
  }

  void analysisBin(std::uint32_t component, std::uint32_t bin, double &real,
                   double &imaginary) const noexcept {
    const float *left = spectra_.data();
    const double left_real = static_cast<double>(left[bin * 2u]);
    const double left_imaginary = static_cast<double>(left[bin * 2u + 1u]);
    if (job_channel_count_ == 1u) {
      real = left_real;
      imaginary = left_imaginary;
      return;
    }
    const float *right = spectra_.data() + fft_size_;
    const double right_real = static_cast<double>(right[bin * 2u]);
    const double right_imaginary = static_cast<double>(right[bin * 2u + 1u]);
    const double side_sign = component == 0u ? 1.0 : -1.0;
    real = (left_real + side_sign * right_real) * kInverseSqrtTwo;
    imaginary = (left_imaginary + side_sign * right_imaginary) * kInverseSqrtTwo;
  }

  [[nodiscard]] double windowAverage(std::uint32_t top, std::uint32_t width) const noexcept {
    double sum = 0.0;
    for (std::uint32_t offset = 1u; offset <= width; ++offset) {
      sum += shared_power_[top - offset];
    }
    return sum / static_cast<double>(width);
  }

  void beginDetector() noexcept {
    if (job_manual_) {
      return;
    }
    job_best_ratio_ = 1.0;
    job_best_cliff_ = 1.0;
    job_best_reference_ = 0.0;
    job_best_bin_ = 0u;
  }

  void scanDetector(std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_manual_) {
      return;
    }
    for (std::uint32_t candidate = begin; candidate < end; ++candidate) {
      double below = 0.0;
      double above = 0.0;
      std::uint32_t occupied = 0u;
      for (std::uint32_t offset = 1u; offset <= detector_half_window_; ++offset) {
        below += shared_power_[candidate - offset];
        above += shared_power_[candidate + offset];
      }
      const double average_below = below / static_cast<double>(detector_half_window_);
      if (average_below <= 1.0e-12) {
        continue;
      }
      const double occupancy_floor = average_below * 0.08;
      for (std::uint32_t offset = 1u; offset <= detector_half_window_; ++offset) {
        if (shared_power_[candidate - offset] > occupancy_floor) {
          ++occupied;
        }
      }
      if (occupied * 4u < detector_half_window_) {
        continue;
      }
      double high_side = 0.0;
      std::uint32_t high_side_occupied = 0u;
      const std::uint32_t high_side_start = candidate + detector_half_window_;
      const std::uint32_t high_side_count =
          detector_ceiling_bin_ > high_side_start ? detector_ceiling_bin_ - high_side_start : 0u;
      for (std::uint32_t bin = high_side_start; bin < detector_ceiling_bin_; ++bin) {
        high_side += shared_power_[bin];
        if (shared_power_[bin] > occupancy_floor) {
          ++high_side_occupied;
        }
      }
      double average_high_side = 0.0;
      if (high_side_count != 0u) {
        average_high_side = high_side / static_cast<double>(high_side_count);
        if (average_high_side > average_below * 0.02 ||
            high_side_occupied * 10u >= high_side_count) {
          continue;
        }
      }
      const double average_above = above / static_cast<double>(detector_half_window_);
      const double ratio = average_below / (average_above + average_below * 1.0e-8 + 1.0e-20);
      if (ratio > job_best_ratio_) {
        job_best_ratio_ = ratio;
        job_best_bin_ = candidate;
        const std::uint32_t reference_start = candidate > detector_cliff_reference_width_
                                                  ? candidate - detector_cliff_reference_width_
                                                  : 1u;
        double reference = 0.0;
        for (std::uint32_t bin = reference_start; bin < candidate; ++bin) {
          reference += shared_power_[bin];
        }
        job_best_reference_ = reference / static_cast<double>(candidate - reference_start);
        const double floor_power = high_side_count != 0u ? average_high_side : average_above;
        job_best_cliff_ =
            job_best_reference_ / (floor_power + job_best_reference_ * 1.0e-8 + 1.0e-20);
      }
    }
  }

  void finishDetector() noexcept {
    if (job_manual_) {
      return;
    }
    if (job_best_bin_ != 0u) {
      const double recovery_target = job_best_reference_ * kShoulderRecoveryPower;
      std::uint32_t descent_limit = detector_first_ + detector_half_window_;
      if (job_best_bin_ > detector_cliff_reference_width_ &&
          job_best_bin_ - detector_cliff_reference_width_ > descent_limit) {
        descent_limit = job_best_bin_ - detector_cliff_reference_width_;
      }
      while (job_best_bin_ > descent_limit &&
             windowAverage(job_best_bin_, detector_half_window_) < recovery_target) {
        --job_best_bin_;
      }
    }

    double target_confidence = 0.0;
    if (job_best_bin_ != 0u) {
      const double cliff_db = 10.0 * std::log10(job_best_cliff_);
      target_confidence = clamp01((cliff_db - 18.0) / 18.0);
    }
    const double confidence_rate = target_confidence > detector_confidence_ ? 0.25 : 0.05;
    detector_confidence_ += (target_confidence - detector_confidence_) * confidence_rate;

    if (job_best_bin_ != 0u && target_confidence > 0.05) {
      const std::uint32_t stable_distance =
          static_cast<std::uint32_t>(700.0 * static_cast<double>(fft_size_) / sample_rate_);
      const std::uint32_t difference = job_best_bin_ > stable_cutoff_bin_
                                           ? job_best_bin_ - stable_cutoff_bin_
                                           : stable_cutoff_bin_ - job_best_bin_;
      if (stable_cutoff_bin_ != 0u && difference <= stable_distance) {
        if (stable_frames_ < 1000u) {
          ++stable_frames_;
        }
        stable_cutoff_bin_ =
            static_cast<std::uint32_t>(0.8 * static_cast<double>(stable_cutoff_bin_) +
                                       0.2 * static_cast<double>(job_best_bin_));
      } else {
        stable_cutoff_bin_ = job_best_bin_;
        stable_frames_ = 1u;
      }
      detected_cutoff_hz_ =
          static_cast<double>(stable_cutoff_bin_) * sample_rate_ / static_cast<double>(fft_size_);
    } else if (stable_frames_ > 0u) {
      --stable_frames_;
    }

    if (!detector_active_ && stable_frames_ >= 3u && detector_confidence_ >= 0.35) {
      detector_active_ = true;
    } else if (detector_active_ && detector_confidence_ < 0.15) {
      detector_active_ = false;
    }
  }

  void beginSynthesis() noexcept {
    const double requested_cutoff = job_manual_ ? job_cutoff_frequency_ : detected_cutoff_hz_;
    const double nyquist = sample_rate_ * 0.5;
    const double ceiling_hz = kCeilingHz < nyquist * 0.92 ? kCeilingHz : nyquist * 0.92;
    job_synthesis_active_ = job_manual_ ? requested_cutoff + 250.0 < ceiling_hz : detector_active_;
    job_bin_hz_ = sample_rate_ / static_cast<double>(fft_size_);
    job_cutoff_bin_ = static_cast<std::uint32_t>(std::ceil(requested_cutoff / job_bin_hz_));
    job_ceiling_bin_ = static_cast<std::uint32_t>(ceiling_hz / job_bin_hz_);
    if (job_ceiling_bin_ >= bin_count_) {
      job_ceiling_bin_ = bin_count_ - 1u;
    }
    if (job_cutoff_bin_ < 2u) {
      job_cutoff_bin_ = 2u;
    }
    if (job_cutoff_bin_ >= job_ceiling_bin_) {
      job_synthesis_active_ = false;
    }

    const std::uint32_t reference_width_raw = static_cast<std::uint32_t>(2000.0 / job_bin_hz_);
    const std::uint32_t reference_width = reference_width_raw < 8u ? 8u : reference_width_raw;
    job_reference_start_ =
        job_cutoff_bin_ > reference_width ? job_cutoff_bin_ - reference_width : 1u;
    const std::uint32_t envelope_reference_width_raw =
        static_cast<std::uint32_t>(kEnvelopeReferenceHz / job_bin_hz_);
    const std::uint32_t envelope_reference_width =
        envelope_reference_width_raw < 4u ? 4u : envelope_reference_width_raw;
    job_envelope_reference_start_ = job_cutoff_bin_ > envelope_reference_width
                                        ? job_cutoff_bin_ - envelope_reference_width
                                        : 1u;
    job_reference_count_ = job_synthesis_active_ ? job_cutoff_bin_ - job_reference_start_ : 0u;
    job_envelope_reference_count_ =
        job_synthesis_active_ ? job_cutoff_bin_ - job_envelope_reference_start_ : 0u;
    job_envelope_arithmetic_ = 0.0;
    job_average_magnitude_ = 0.0;
    job_mid_energy_ = 0.0;
    job_side_energy_ = 0.0;
    job_cross_real_ = 0.0;
    job_cross_imaginary_ = 0.0;
    job_mid_reference_ = 0.0;
    job_side_reference_ = 0.0;
    job_mid_side_coherence_real_ = 0.0;
    job_mid_side_coherence_imaginary_ = 0.0;
    job_channel_reference_ = 0.0;
  }

  [[nodiscard]] bool synthesisRange(std::uint32_t begin, std::uint32_t end,
                                    std::uint32_t range_begin, std::uint32_t range_end,
                                    std::uint32_t &clipped_begin,
                                    std::uint32_t &clipped_end) const noexcept {
    clipped_begin = begin > range_begin ? begin : range_begin;
    clipped_end = end < range_end ? end : range_end;
    return clipped_begin < clipped_end;
  }

  void accumulateEnvelopeReference(std::uint32_t begin, std::uint32_t end) noexcept {
    if (!job_synthesis_active_) {
      return;
    }
    std::uint32_t clipped_begin = 0u;
    std::uint32_t clipped_end = 0u;
    if (!synthesisRange(begin, end, job_envelope_reference_start_, job_cutoff_bin_, clipped_begin,
                        clipped_end)) {
      return;
    }
    for (std::uint32_t bin = clipped_begin; bin < clipped_end; ++bin) {
      job_envelope_arithmetic_ += std::sqrt(shared_power_[bin] + 1.0e-30);
    }
  }

  void accumulateSpatialReference(std::uint32_t begin, std::uint32_t end) noexcept {
    if (!job_synthesis_active_ || job_channel_count_ != 2u || job_reference_count_ == 0u) {
      return;
    }
    std::uint32_t clipped_begin = 0u;
    std::uint32_t clipped_end = 0u;
    if (!synthesisRange(begin, end, job_reference_start_, job_cutoff_bin_, clipped_begin,
                        clipped_end)) {
      return;
    }
    const float *left_spectrum = spectra_.data();
    const float *right_spectrum = spectra_.data() + fft_size_;
    for (std::uint32_t bin = clipped_begin; bin < clipped_end; ++bin) {
      const double left_real = static_cast<double>(left_spectrum[bin * 2u]);
      const double left_imaginary = static_cast<double>(left_spectrum[bin * 2u + 1u]);
      const double right_real = static_cast<double>(right_spectrum[bin * 2u]);
      const double right_imaginary = static_cast<double>(right_spectrum[bin * 2u + 1u]);
      const double mid_real = (left_real + right_real) * kInverseSqrtTwo;
      const double mid_imaginary = (left_imaginary + right_imaginary) * kInverseSqrtTwo;
      const double side_real = (left_real - right_real) * kInverseSqrtTwo;
      const double side_imaginary = (left_imaginary - right_imaginary) * kInverseSqrtTwo;
      job_mid_energy_ += mid_real * mid_real + mid_imaginary * mid_imaginary;
      job_side_energy_ += side_real * side_real + side_imaginary * side_imaginary;
      job_cross_real_ += mid_real * side_real + mid_imaginary * side_imaginary;
      job_cross_imaginary_ += mid_imaginary * side_real - mid_real * side_imaginary;
    }
  }

  void accumulateMonoReference(std::uint32_t begin, std::uint32_t end) noexcept {
    if (!job_synthesis_active_ || job_channel_count_ != 1u || job_envelope_reference_count_ == 0u) {
      return;
    }
    std::uint32_t clipped_begin = 0u;
    std::uint32_t clipped_end = 0u;
    if (!synthesisRange(begin, end, job_envelope_reference_start_, job_cutoff_bin_, clipped_begin,
                        clipped_end)) {
      return;
    }
    const float *source_spectrum = spectra_.data();
    for (std::uint32_t bin = clipped_begin; bin < clipped_end; ++bin) {
      const double real = static_cast<double>(source_spectrum[bin * 2u]);
      const double imaginary = static_cast<double>(source_spectrum[bin * 2u + 1u]);
      job_channel_reference_ += std::sqrt(real * real + imaginary * imaginary);
    }
  }

  void finishReferences() noexcept {
    job_average_magnitude_ =
        job_envelope_reference_count_ == 0u
            ? 0.0
            : job_envelope_arithmetic_ / static_cast<double>(job_envelope_reference_count_);
    if (job_synthesis_active_ && job_channel_count_ == 2u && job_reference_count_ != 0u) {
      job_mid_reference_ = std::sqrt(job_mid_energy_ / static_cast<double>(job_reference_count_));
      job_side_reference_ = std::sqrt(job_side_energy_ / static_cast<double>(job_reference_count_));
      const double spatial_reference = std::sqrt(
          (job_mid_reference_ * job_mid_reference_ + job_side_reference_ * job_side_reference_) *
          0.5);
      const double envelope_scale =
          spatial_reference > 1.0e-15 ? job_average_magnitude_ / spatial_reference : 0.0;
      job_mid_reference_ *= envelope_scale;
      job_side_reference_ *= envelope_scale;
      const double coherence_denominator = std::sqrt(job_mid_energy_ * job_side_energy_);
      if (coherence_denominator > 1.0e-20) {
        job_mid_side_coherence_real_ = job_cross_real_ / coherence_denominator;
        job_mid_side_coherence_imaginary_ = job_cross_imaginary_ / coherence_denominator;
        const double coherence_power =
            job_mid_side_coherence_real_ * job_mid_side_coherence_real_ +
            job_mid_side_coherence_imaginary_ * job_mid_side_coherence_imaginary_;
        if (coherence_power > 1.0) {
          const double coherence_scale = 1.0 / std::sqrt(coherence_power);
          job_mid_side_coherence_real_ *= coherence_scale;
          job_mid_side_coherence_imaginary_ *= coherence_scale;
        }
      }
    } else if (job_synthesis_active_ && job_channel_count_ == 1u &&
               job_envelope_reference_count_ != 0u) {
      job_channel_reference_ /= static_cast<double>(job_envelope_reference_count_);
    }
  }

  void generateNoisePhases(std::uint32_t begin, std::uint32_t end) noexcept {
    if (!job_synthesis_active_ || job_average_magnitude_ <= 1.0e-15) {
      return;
    }
    std::uint32_t clipped_begin = 0u;
    std::uint32_t clipped_end = 0u;
    if (!synthesisRange(begin, end, job_cutoff_bin_, job_ceiling_bin_, clipped_begin,
                        clipped_end)) {
      return;
    }
    for (std::uint32_t bin = clipped_begin; bin < clipped_end; ++bin) {
      const double mid_phase = mid_random_.nextFloat01() * 2.0 * kPi;
      noise_cos_[bin] = static_cast<float>(std::cos(mid_phase));
      noise_sin_[bin] = static_cast<float>(std::sin(mid_phase));
      if (job_channel_count_ == 2u) {
        const double side_phase = side_random_.nextFloat01() * 2.0 * kPi;
        secondary_noise_cos_[bin] = static_cast<float>(std::cos(side_phase));
        secondary_noise_sin_[bin] = static_cast<float>(std::sin(side_phase));
      }
    }
  }

  void clearHarmonics(std::uint32_t component, std::uint32_t begin, std::uint32_t end) noexcept {
    if (component >= job_channel_count_) {
      return;
    }
    float *spectrum = harmonic_spectra_.data() + static_cast<std::size_t>(component) * fft_size_;
    for (std::uint32_t index = begin; index < end; ++index) {
      spectrum[index] = 0.0F;
    }
  }

  void decodeHarmonic(std::uint32_t encoded, std::uint32_t &component,
                      std::uint32_t &harmonic) const noexcept {
    component = encoded / (kMaximumHarmonic + 1u);
    harmonic = encoded % (kMaximumHarmonic + 1u);
  }

  void beginHarmonic(std::uint32_t encoded) noexcept {
    decodeHarmonic(encoded, job_harmonic_component_, job_harmonic_order_);
    job_harmonic_source_start_ = (job_cutoff_bin_ + job_harmonic_order_ - 1u) / job_harmonic_order_;
    job_harmonic_source_end_ = (job_ceiling_bin_ - 1u) / job_harmonic_order_ + 1u;
    if (job_harmonic_source_start_ < 2u) {
      job_harmonic_source_start_ = 2u;
    }
    if (job_harmonic_source_end_ >= bin_count_) {
      job_harmonic_source_end_ = bin_count_ - 1u;
    }
    job_donor_sum_ = 0.0;
    job_donor_reference_ = 0.0;
  }

  void accumulateHarmonicDonor(std::uint32_t encoded, std::uint32_t begin,
                               std::uint32_t end) noexcept {
    std::uint32_t component = 0u;
    std::uint32_t harmonic = 0u;
    decodeHarmonic(encoded, component, harmonic);
    if (!job_synthesis_active_ || component >= job_channel_count_ ||
        component != job_harmonic_component_ || harmonic != job_harmonic_order_ ||
        job_harmonic_source_start_ >= job_harmonic_source_end_) {
      return;
    }
    std::uint32_t clipped_begin = 0u;
    std::uint32_t clipped_end = 0u;
    if (!synthesisRange(begin, end, job_harmonic_source_start_, job_harmonic_source_end_,
                        clipped_begin, clipped_end)) {
      return;
    }
    for (std::uint32_t source_bin = clipped_begin; source_bin < clipped_end; ++source_bin) {
      double source_real = 0.0;
      double source_imaginary = 0.0;
      analysisBin(component, source_bin, source_real, source_imaginary);
      job_donor_sum_ += std::sqrt(source_real * source_real + source_imaginary * source_imaginary);
    }
  }

  void finishHarmonic() noexcept {
    if (job_harmonic_source_start_ < job_harmonic_source_end_) {
      job_donor_reference_ = job_donor_sum_ / static_cast<double>(job_harmonic_source_end_ -
                                                                  job_harmonic_source_start_);
    }
  }

  [[nodiscard]] double calculateSynthesisEnvelope(std::uint32_t bin) const noexcept {
    const std::uint32_t distance = bin - job_cutoff_bin_;
    const double normalized_distance =
        static_cast<double>(distance) / static_cast<double>(job_ceiling_bin_ - job_cutoff_bin_);
    const double generated_band_hz =
        static_cast<double>(job_ceiling_bin_ - job_cutoff_bin_) * job_bin_hz_;
    const double proportional_upper_transition = generated_band_hz * 0.35;
    const double upper_transition_hz = proportional_upper_transition < kUpperTransitionMaximumHz
                                           ? proportional_upper_transition
                                           : kUpperTransitionMaximumHz;
    const double upper_hz = static_cast<double>(job_ceiling_bin_ - bin) * job_bin_hz_;
    double upper_fade = upper_hz / upper_transition_hz;
    if (upper_fade > 1.0) {
      upper_fade = 1.0;
    }
    return std::exp(-2.3 * normalized_distance) * upper_fade;
  }

  void buildSynthesisEnvelope(std::uint32_t begin, std::uint32_t end) noexcept {
    if (!job_synthesis_active_) {
      return;
    }
    std::uint32_t clipped_begin = 0u;
    std::uint32_t clipped_end = 0u;
    if (!synthesisRange(begin, end, job_cutoff_bin_, job_ceiling_bin_, clipped_begin,
                        clipped_end)) {
      return;
    }
    for (std::uint32_t bin = clipped_begin; bin < clipped_end; ++bin) {
      synthesis_envelope_[bin] = calculateSynthesisEnvelope(bin);
    }
  }

  void generateHarmonicBody(std::uint32_t encoded, std::uint32_t begin,
                            std::uint32_t end) noexcept {
    std::uint32_t component = 0u;
    std::uint32_t harmonic = 0u;
    decodeHarmonic(encoded, component, harmonic);
    if (!job_synthesis_active_ || component >= job_channel_count_ ||
        component != job_harmonic_component_ || harmonic != job_harmonic_order_ ||
        job_donor_reference_ <= 1.0e-15) {
      return;
    }
    std::uint32_t clipped_begin = 0u;
    std::uint32_t clipped_end = 0u;
    if (!synthesisRange(begin, end, job_harmonic_source_start_, job_harmonic_source_end_,
                        clipped_begin, clipped_end)) {
      return;
    }
    float *harmonic_spectrum =
        harmonic_spectra_.data() + static_cast<std::size_t>(component) * fft_size_;
    for (std::uint32_t source_bin = clipped_begin; source_bin < clipped_end; ++source_bin) {
      double source_real = 0.0;
      double source_imaginary = 0.0;
      double previous_real = 0.0;
      double previous_imaginary = 0.0;
      double next_real = 0.0;
      double next_imaginary = 0.0;
      analysisBin(component, source_bin, source_real, source_imaginary);
      analysisBin(component, source_bin - 1u, previous_real, previous_imaginary);
      analysisBin(component, source_bin + 1u, next_real, next_imaginary);
      const double source_power = source_real * source_real + source_imaginary * source_imaginary;
      const double source_magnitude = std::sqrt(source_power);
      const double previous_power =
          previous_real * previous_real + previous_imaginary * previous_imaginary;
      const double next_power = next_real * next_real + next_imaginary * next_imaginary;
      const double peak_weight = tonalPeakWeight(source_magnitude, source_power, previous_power,
                                                 next_power, job_donor_reference_);

      const std::uint32_t target_bin = source_bin * harmonic;
      const double envelope = synthesis_envelope_[target_bin];
      const std::size_t source_phase_index =
          static_cast<std::size_t>(component) * bin_count_ + source_bin;
      const std::size_t harmonic_phase_index =
          (static_cast<std::size_t>(component) * (kMaximumHarmonic + 1u) + harmonic) * bin_count_ +
          target_bin;
      double target_phase = 0.0;
      bool preserve_mid_side_phase = false;
      std::size_t mid_harmonic_phase_index = 0u;
      if (job_channel_count_ == 2u && component == 1u) {
        double mid_real = 0.0;
        double mid_imaginary = 0.0;
        analysisBin(0u, source_bin, mid_real, mid_imaginary);
        const double mid_magnitude = std::sqrt(mid_real * mid_real + mid_imaginary * mid_imaginary);
        mid_harmonic_phase_index = static_cast<std::size_t>(harmonic) * bin_count_ + target_bin;
        preserve_mid_side_phase = mid_magnitude > source_magnitude * 1.0e-6 &&
                                  harmonic_phase_valid_[mid_harmonic_phase_index] != 0u;
      }
      if (preserve_mid_side_phase) {
        const std::size_t mid_source_phase_index = source_bin;
        const double relative_phase =
            wrapPhase(source_phase_[source_phase_index] - source_phase_[mid_source_phase_index]);
        target_phase = wrapPhase(harmonic_phase_[mid_harmonic_phase_index] + relative_phase);
        harmonic_phase_[harmonic_phase_index] = target_phase;
        harmonic_phase_valid_[harmonic_phase_index] = 1u;
      } else if (harmonic_phase_valid_[harmonic_phase_index] != 0u) {
        harmonic_phase_[harmonic_phase_index] =
            wrapPhase(harmonic_phase_[harmonic_phase_index] +
                      static_cast<double>(harmonic) * source_phase_advance_[source_phase_index]);
        target_phase = harmonic_phase_[harmonic_phase_index];
      } else {
        target_phase = wrapPhase(static_cast<double>(harmonic) * source_phase_[source_phase_index]);
        harmonic_phase_[harmonic_phase_index] = target_phase;
        harmonic_phase_valid_[harmonic_phase_index] = 1u;
      }
      const double harmonic_magnitude =
          source_magnitude * kHarmonicGains[harmonic] * envelope * peak_weight;
      harmonic_spectrum[target_bin * 2u] +=
          static_cast<float>(std::cos(target_phase) * harmonic_magnitude);
      harmonic_spectrum[target_bin * 2u + 1u] +=
          static_cast<float>(std::sin(target_phase) * harmonic_magnitude);
    }
  }

  void clearSynthesis(std::uint32_t begin, std::uint32_t end) noexcept {
    for (std::uint32_t index = begin; index < end; ++index) {
      synthesis_spectrum_[index] = 0.0F;
    }
  }

  void buildHarmonic(std::uint32_t render_target, std::uint32_t begin, std::uint32_t end) noexcept {
    const std::uint32_t channel = render_target & 1u;
    if (!job_synthesis_active_ || channel >= job_channel_count_) {
      return;
    }
    std::uint32_t clipped_begin = 0u;
    std::uint32_t clipped_end = 0u;
    if (!synthesisRange(begin, end, job_cutoff_bin_, job_ceiling_bin_, clipped_begin,
                        clipped_end)) {
      return;
    }
    for (std::uint32_t bin = clipped_begin; bin < clipped_end; ++bin) {
      if (job_channel_count_ == 1u) {
        synthesis_spectrum_[bin * 2u] = harmonic_spectra_[bin * 2u];
        synthesis_spectrum_[bin * 2u + 1u] = harmonic_spectra_[bin * 2u + 1u];
      } else {
        const std::size_t side_offset = fft_size_;
        const double side_sign = channel == 0u ? 1.0 : -1.0;
        synthesis_spectrum_[bin * 2u] = static_cast<float>(
            (static_cast<double>(harmonic_spectra_[bin * 2u]) +
             side_sign * static_cast<double>(harmonic_spectra_[side_offset + bin * 2u])) *
            kInverseSqrtTwo);
        synthesis_spectrum_[bin * 2u + 1u] = static_cast<float>(
            (static_cast<double>(harmonic_spectra_[bin * 2u + 1u]) +
             side_sign * static_cast<double>(harmonic_spectra_[side_offset + bin * 2u + 1u])) *
            kInverseSqrtTwo);
      }
      synthesis_spectrum_[bin * 2u] *= static_cast<float>(kEnvelopeTargetGain);
      synthesis_spectrum_[bin * 2u + 1u] *= static_cast<float>(kEnvelopeTargetGain);
    }
  }

  void buildNoise(std::uint32_t render_target, std::uint32_t begin, std::uint32_t end) noexcept {
    const std::uint32_t channel = render_target & 1u;
    if (!job_synthesis_active_ || channel >= job_channel_count_) {
      return;
    }
    std::uint32_t clipped_begin = 0u;
    std::uint32_t clipped_end = 0u;
    if (!synthesisRange(begin, end, job_cutoff_bin_, job_ceiling_bin_, clipped_begin,
                        clipped_end)) {
      return;
    }
    for (std::uint32_t bin = clipped_begin; bin < clipped_end; ++bin) {
      const double envelope = synthesis_envelope_[bin];
      const double mid_real = static_cast<double>(noise_cos_[bin]);
      const double mid_imaginary = static_cast<double>(noise_sin_[bin]);
      double noise_real = 0.0;
      double noise_imaginary = 0.0;
      if (job_channel_count_ == 1u) {
        const double noise_magnitude = job_channel_reference_ * envelope;
        noise_real = mid_real * noise_magnitude;
        noise_imaginary = mid_imaginary * noise_magnitude;
      } else {
        const double independent_real = static_cast<double>(secondary_noise_cos_[bin]);
        const double independent_imaginary = static_cast<double>(secondary_noise_sin_[bin]);
        double coherence_power =
            job_mid_side_coherence_real_ * job_mid_side_coherence_real_ +
            job_mid_side_coherence_imaginary_ * job_mid_side_coherence_imaginary_;
        if (coherence_power > 1.0) {
          coherence_power = 1.0;
        }
        const double independent_weight = std::sqrt(1.0 - coherence_power);
        const double side_unit_real = job_mid_side_coherence_real_ * mid_real +
                                      job_mid_side_coherence_imaginary_ * mid_imaginary +
                                      independent_weight * independent_real;
        const double side_unit_imaginary = job_mid_side_coherence_real_ * mid_imaginary -
                                           job_mid_side_coherence_imaginary_ * mid_real +
                                           independent_weight * independent_imaginary;
        const double shaped_mid_real = mid_real * job_mid_reference_ * envelope;
        const double shaped_mid_imaginary = mid_imaginary * job_mid_reference_ * envelope;
        const double shaped_side_real = side_unit_real * job_side_reference_ * envelope;
        const double shaped_side_imaginary = side_unit_imaginary * job_side_reference_ * envelope;
        const double side_sign = channel == 0u ? 1.0 : -1.0;
        noise_real = (shaped_mid_real + side_sign * shaped_side_real) * kInverseSqrtTwo;
        noise_imaginary =
            (shaped_mid_imaginary + side_sign * shaped_side_imaginary) * kInverseSqrtTwo;
      }
      synthesis_spectrum_[bin * 2u] = static_cast<float>(noise_real * kEnvelopeTargetGain);
      synthesis_spectrum_[bin * 2u + 1u] =
          static_cast<float>(noise_imaginary * kEnvelopeTargetGain);
    }
  }

  void mergeInverse(std::uint32_t begin, std::uint32_t end) noexcept {
    ::effetune::dsp::fft_stages::mergeInverse(synthesis_spectrum_.data(), fft_stage_.data(),
                                              twiddles_.data(), fft_size_, begin, end);
  }

  [[nodiscard]] bool renderTargetEnabled(std::uint32_t render_target) const noexcept {
    return (render_target & 1u) < job_channel_count_;
  }

  void separateInverse(std::uint32_t subsequence, std::uint32_t begin, std::uint32_t end) noexcept {
    ::effetune::dsp::fft_stages::separateInverse(
        fft_stage_.data(), fft_input_.data(), twiddles_.data(), fft_size_, subsequence, begin, end);
  }

  void overlapAdd(std::uint32_t render_target, std::uint32_t begin, std::uint32_t end) noexcept {
    const std::uint32_t channel = render_target & 1u;
    if (channel >= job_channel_count_) {
      return;
    }
    std::vector<float> &wet_ring = render_target < 2u ? harmonic_wet_ring_ : noise_wet_ring_;
    const double normalization = 1.0 / (2.0 * static_cast<double>(fft_size_));
    const std::size_t ring_offset = static_cast<std::size_t>(channel) * timeline_size_;
    for (std::uint32_t index = begin; index < end; ++index) {
      const std::uint32_t ring_index = job_output_origin_ + index < timeline_size_
                                           ? job_output_origin_ + index
                                           : job_output_origin_ + index - timeline_size_;
      const double generated = static_cast<double>(::effetune::dsp::fft_stages::unpackSample(
                                   fft_input_.data(), fft_size_, index)) *
                               static_cast<double>(window_[index]) * normalization;
      wet_ring[ring_offset + ring_index] += static_cast<float>(generated);
    }
  }

  void runStage(const ::effetune::dsp::SchedulerStage &stage) noexcept {
    switch (static_cast<StageKind>(stage.kind)) {
    case StageKind::BeginAnalysis:
      beginAnalysis();
      break;
    case StageKind::PackAnalysis:
      packAnalysis(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::ForwardSubtransform:
      if (stage.channel < job_channel_count_) {
        transformSubsequence(stage.begin, PFFFT_FORWARD);
      }
      break;
    case StageKind::CombineForward:
      if (stage.channel < job_channel_count_) {
        combineForward(stage.begin, stage.end);
      }
      break;
    case StageKind::SplitForward:
      splitForward(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::AccumulatePower:
      accumulatePower(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::ScalePower:
      scalePower(stage.begin, stage.end);
      break;
    case StageKind::SourcePhases:
      updateSourcePhases(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::BeginDetector:
      beginDetector();
      break;
    case StageKind::DetectorScan:
      scanDetector(stage.begin, stage.end);
      break;
    case StageKind::FinishDetector:
      finishDetector();
      break;
    case StageKind::BeginSynthesis:
      beginSynthesis();
      break;
    case StageKind::SynthesisEnvelope:
      buildSynthesisEnvelope(stage.begin, stage.end);
      break;
    case StageKind::EnvelopeReference:
      accumulateEnvelopeReference(stage.begin, stage.end);
      break;
    case StageKind::SpatialReference:
      accumulateSpatialReference(stage.begin, stage.end);
      break;
    case StageKind::MonoReference:
      accumulateMonoReference(stage.begin, stage.end);
      break;
    case StageKind::FinishReferences:
      finishReferences();
      break;
    case StageKind::NoisePhases:
      generateNoisePhases(stage.begin, stage.end);
      break;
    case StageKind::ClearHarmonics:
      clearHarmonics(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::BeginHarmonic:
      beginHarmonic(stage.channel);
      break;
    case StageKind::HarmonicDonor:
      accumulateHarmonicDonor(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::FinishHarmonic:
      finishHarmonic();
      break;
    case StageKind::HarmonicBody:
      generateHarmonicBody(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::ClearSynthesis:
      if (renderTargetEnabled(stage.channel)) {
        clearSynthesis(stage.begin, stage.end);
      }
      break;
    case StageKind::BuildHarmonic:
      buildHarmonic(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::BuildNoise:
      buildNoise(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::MergeInverse:
      if (renderTargetEnabled(stage.channel)) {
        mergeInverse(stage.begin, stage.end);
      }
      break;
    case StageKind::SeparateInverse: {
      const std::uint32_t render_target = stage.channel / kTransformSubsequences;
      if (renderTargetEnabled(render_target)) {
        separateInverse(stage.channel % kTransformSubsequences, stage.begin, stage.end);
      }
      break;
    }
    case StageKind::InverseSubtransform:
      if (renderTargetEnabled(stage.channel)) {
        transformSubsequence(stage.begin, PFFFT_BACKWARD);
      }
      break;
    case StageKind::OverlapAdd:
      overlapAdd(stage.channel, stage.begin, stage.end);
      break;
    }
  }

  void advanceStagedJob() noexcept {
    if (job_schedule_ == nullptr) {
      return;
    }
    ::effetune::dsp::advanceStagedJob(
        job_active_, job_slot_, slot_count_, absolute_sample_, job_start_sample_, kSlotSamples,
        *job_schedule_,
        [this](const ::effetune::dsp::SchedulerStage &stage) noexcept { runStage(stage); });
  }

  void startStagedJob(std::uint32_t channel_count) noexcept {
    job_active_ = false;
    job_start_sample_ = absolute_sample_;
    job_frame_origin_ = timeline_position_ >= fft_size_
                            ? timeline_position_ - fft_size_
                            : timeline_position_ + timeline_size_ - fft_size_;
    job_output_origin_ = timeline_position_ + hop_size_ < timeline_size_
                             ? timeline_position_ + hop_size_
                             : timeline_position_ + hop_size_ - timeline_size_;
    job_channel_count_ = channel_count;
    job_manual_ = static_cast<std::uint32_t>(params_.cutoffMode) == 1u;
    job_cutoff_frequency_ = static_cast<double>(params_.cutoffFrequency);
    const double ceiling_hz = kCeilingHz < sample_rate_ * 0.46 ? kCeilingHz : sample_rate_ * 0.46;
    const bool manual_active = job_cutoff_frequency_ + 250.0 < ceiling_hz;
    if (!job_manual_) {
      job_schedule_ = auto_schedule_.get();
    } else if (!manual_active) {
      job_schedule_ = manual_inactive_schedule_.get();
    } else {
      job_schedule_ = job_cutoff_frequency_ >= 20000.0 ? manual_high_cutoff_schedule_.get()
                                                       : manual_active_schedule_.get();
    }
    job_slot_ = 0u;
    job_active_ = true;
  }

  PFFFT_Setup *complex_setup_ = nullptr;
  double sample_rate_ = 0.0;
  double component_smoothing_ = 0.0;
  double harmonic_amount_smoothed_ = 0.0;
  double noise_amount_smoothed_ = 0.0;
  double detected_cutoff_hz_ = 16000.0;
  double detector_confidence_ = 0.0;
  double job_cutoff_frequency_ = 16000.0;
  double job_bin_hz_ = 0.0;
  double job_envelope_arithmetic_ = 0.0;
  double job_average_magnitude_ = 0.0;
  double job_mid_energy_ = 0.0;
  double job_side_energy_ = 0.0;
  double job_cross_real_ = 0.0;
  double job_cross_imaginary_ = 0.0;
  double job_mid_reference_ = 0.0;
  double job_side_reference_ = 0.0;
  double job_mid_side_coherence_real_ = 0.0;
  double job_mid_side_coherence_imaginary_ = 0.0;
  double job_channel_reference_ = 0.0;
  double job_best_ratio_ = 1.0;
  double job_best_cliff_ = 1.0;
  double job_best_reference_ = 0.0;
  double job_donor_sum_ = 0.0;
  double job_donor_reference_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t fft_size_ = 0u;
  std::uint32_t hop_size_ = 0u;
  std::uint32_t timeline_size_ = 0u;
  std::uint32_t slot_count_ = 0u;
  std::uint32_t bin_count_ = 0u;
  std::uint32_t timeline_position_ = 0u;
  std::uint32_t amount_delay_position_ = 0u;
  std::uint64_t absolute_sample_ = 0u;
  std::uint64_t next_frame_sample_ = 0u;
  std::uint64_t job_start_sample_ = 0u;
  std::uint32_t job_frame_origin_ = 0u;
  std::uint32_t job_output_origin_ = 0u;
  std::uint32_t job_slot_ = 0u;
  std::uint32_t job_channel_count_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t detector_first_ = 0u;
  std::uint32_t detector_last_ = 0u;
  std::uint32_t detector_half_window_ = 0u;
  std::uint32_t detector_ceiling_bin_ = 0u;
  std::uint32_t detector_cliff_reference_width_ = 0u;
  std::uint32_t stable_frames_ = 0u;
  std::uint32_t stable_cutoff_bin_ = 0u;
  std::uint32_t job_best_bin_ = 0u;
  std::uint32_t job_cutoff_bin_ = 0u;
  std::uint32_t job_ceiling_bin_ = 0u;
  std::uint32_t job_reference_start_ = 0u;
  std::uint32_t job_reference_count_ = 0u;
  std::uint32_t job_envelope_reference_start_ = 0u;
  std::uint32_t job_envelope_reference_count_ = 0u;
  std::uint32_t job_harmonic_component_ = 0u;
  std::uint32_t job_harmonic_order_ = 0u;
  std::uint32_t job_harmonic_source_start_ = 0u;
  std::uint32_t job_harmonic_source_end_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool prepared_ = false;
  bool detector_active_ = false;
  bool job_active_ = false;
  bool job_manual_ = false;
  bool job_synthesis_active_ = false;
  StageSchedule *building_schedule_ = nullptr;
  StageSchedule *job_schedule_ = nullptr;
  std::unique_ptr<StageSchedule> manual_inactive_schedule_;
  std::unique_ptr<StageSchedule> manual_active_schedule_;
  std::unique_ptr<StageSchedule> manual_high_cutoff_schedule_;
  std::unique_ptr<StageSchedule> auto_schedule_;
  std::vector<float> input_ring_;
  std::vector<float> dry_ring_;
  std::vector<float> harmonic_wet_ring_;
  std::vector<float> noise_wet_ring_;
  std::vector<double> harmonic_amount_delay_;
  std::vector<double> noise_amount_delay_;
  std::vector<float> spectra_;
  std::vector<float> window_;
  std::vector<float> fft_input_;
  std::vector<float> fft_work_;
  std::vector<float> fft_stage_;
  std::vector<float> twiddles_;
  std::vector<float> synthesis_spectrum_;
  std::vector<float> harmonic_spectra_;
  std::vector<double> shared_power_;
  std::vector<double> synthesis_envelope_;
  std::vector<float> noise_cos_;
  std::vector<float> noise_sin_;
  std::vector<float> secondary_noise_cos_;
  std::vector<float> secondary_noise_sin_;
  std::vector<double> source_phase_;
  std::vector<double> source_phase_advance_;
  std::vector<std::uint8_t> source_phase_valid_;
  std::vector<double> harmonic_phase_;
  std::vector<std::uint8_t> harmonic_phase_valid_;
  dsp::XorShiftRng mid_random_{};
  dsp::XorShiftRng side_random_{};
};

static_assert(sizeof(BandwidthExtenderKernel) <= 8192u);

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(BandwidthExtenderPlugin,
                         effetune::plugins::saturation::BandwidthExtenderKernel)

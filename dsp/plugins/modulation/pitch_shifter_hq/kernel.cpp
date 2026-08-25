#include "effetune/kernel.h"
#include "PitchShifterHQPluginParams.h"
#include "effetune/dsp/fft_stages.h"
#include "effetune/dsp/pffft_incremental.h"
#include "effetune/dsp/stage_scheduler.h"

#include <pffft.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <new>
#include <utility>
#include <vector>

namespace effetune::plugins::modulation {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr std::uint32_t kMaximumChannels = 8u;
constexpr double kPeakFloor = 1.0e-12;
constexpr double kPeakRelativeFloor = 1.0e-9;
constexpr double kPeakInterpolationFloor = 1.0e-30;
constexpr double kPeakProminenceRatio = 1.0001;
constexpr double kPeakTieRatio = 1.00001;
constexpr double kStablePeakProminence = 16.0;
constexpr double kStablePeakTrackingRadiusBins = 2.5;
constexpr std::uint32_t kStablePeakAttackFrames = 3u;
constexpr std::uint32_t kFixedRegionBins = 8u;
constexpr std::uint8_t kReleaseHandoffFrames = 2u;
constexpr double kRatioSmoothingSeconds = 0.03;
constexpr std::uint32_t kSlotSamples = 16u;
constexpr std::uint32_t kMaximumSlots = 256u;
constexpr int kForwardWorkBudget = 256;
constexpr std::uint32_t kMinimumLinearPassChunks = 2u;
constexpr std::uint32_t kStageCapacity = 3072u;
constexpr std::uint32_t kTransformSubsequences = 4u;
constexpr std::uint32_t kLargeTransformChildren = 2u;

enum class StageKind : std::uint8_t {
  PackAnalysis,
  BeginForward,
  ForwardStep,
  ForwardSubtransform,
  CombineForwardSubtransform,
  CombineForward,
  SplitForward,
  AccumulatePower,
  BeginPeakSearch,
  FindMaximumPower,
  BeginPeakScan,
  FindPeaks,
  BeginAnalysisState,
  UpdateFixedAnchorRotations,
  InterpolatePeaks,
  BeginPeakRegions,
  ScanPeakRegions,
  FinishPeakRegions,
  BeginPeakMatching,
  MatchPeaksMutual,
  MatchPeaksRemaining,
  UpdatePeakValues,
  CopyPeakValues,
  FinishPeakState,
  BuildSpectrum,
  PrepareSpectrum,
  SplatBins,
  FinishSpectrum,
  MergeInverse,
  SeparateInverse,
  SeparateInverseSubtransform,
  InverseSubtransform,
  OverlapAdd,
};

std::uint32_t fftSizeForSampleRate(double sample_rate) noexcept {
  const auto rounded = static_cast<std::uint32_t>(std::llround(sample_rate));
  if (std::abs(sample_rate - static_cast<double>(rounded)) > 0.01) {
    return 0u;
  }
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
    return 0u;
  }
}

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

double clampPeakOffset(double offset) noexcept {
  if (offset < -0.5) {
    return -0.5;
  }
  return offset > 0.5 ? 0.5 : offset;
}

} // namespace

class PitchShifterHQKernel final : public PluginKernel {
  using StageSchedule = ::effetune::dsp::StageSchedule<kStageCapacity, kMaximumSlots>;

  EFFETUNE_PARAMS(generated::PitchShifterHQPluginParams)

public:
  ~PitchShifterHQKernel() override { releaseSetup(); }

  void prepare(const PrepareInfo &info) override {
    releaseSetup();
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    fft_size_ = fftSizeForSampleRate(sample_rate_);
    if (fft_size_ == 0u || max_channels_ == 0u || max_channels_ > kMaximumChannels ||
        max_frames_ == 0u) {
      return;
    }
    hop_size_ = fft_size_ / 4u;
    stage_span_ = hop_size_;
    slot_count_ = stage_span_ / kSlotSamples;
    if (slot_count_ == 0u || slot_count_ > kMaximumSlots) {
      return;
    }
    timeline_size_ = fft_size_ + stage_span_;
    bin_count_ = fft_size_ / 2u + 1u;
    subtransform_children_ = fft_size_ >= 16384u ? kLargeTransformChildren : 1u;

    if (stage_schedule_ == nullptr) {
      stage_schedule_.reset(new (std::nothrow) StageSchedule());
    }
    if (identity_stage_schedule_ == nullptr) {
      identity_stage_schedule_.reset(new (std::nothrow) StageSchedule());
    }
    real_setup_ = pffft_new_setup(static_cast<int>(fft_size_), PFFFT_REAL);
    if (real_setup_ != nullptr) {
      forward_transform_.reset(new (std::nothrow)::effetune::dsp::PffftOrderedRealForward(
          real_setup_, kForwardWorkBudget));
    }
    subtransform_setup_ =
        pffft_new_setup(static_cast<int>(fft_size_ / (8u * subtransform_children_)), PFFFT_COMPLEX);
    const std::size_t timeline_samples = static_cast<std::size_t>(max_channels_) * timeline_size_;
    const std::size_t spectrum_samples = static_cast<std::size_t>(max_channels_) * fft_size_;
    prepared_ = stage_schedule_ != nullptr && identity_stage_schedule_ != nullptr &&
                real_setup_ != nullptr && forward_transform_ != nullptr &&
                forward_transform_->valid() && subtransform_setup_ != nullptr &&
                input_ring_.allocate(timeline_samples) && dry_ring_.allocate(timeline_samples) &&
                output_ring_.allocate(timeline_samples) && spectra_.allocate(spectrum_samples) &&
                window_.allocate(fft_size_) && fft_input_.allocate(fft_size_) &&
                fft_work_.allocate(fft_size_) && fft_stage_.allocate(fft_size_) &&
                synthesis_spectrum_.allocate(fft_size_) && twiddles_.allocate(2u * fft_size_);
    if (!prepared_) {
      return;
    }

    shared_power_.assign(bin_count_, 0.0);
    peak_indices_.assign(bin_count_, 0u);
    peak_region_ends_.assign(bin_count_, 0u);
    peak_shift_bins_.assign(bin_count_, 0.0);
    peak_rotation_real_.assign(bin_count_, 1.0);
    peak_rotation_imaginary_.assign(bin_count_, 0.0);
    peak_bins_.assign(bin_count_, 0.0);
    peak_persistence_.assign(bin_count_, 0u);
    peak_is_stable_.assign(bin_count_, static_cast<std::uint8_t>(0));
    peak_handoff_frames_.assign(bin_count_, static_cast<std::uint8_t>(0));
    peak_match_indices_.assign(bin_count_, 0u);
    previous_peak_bins_.assign(bin_count_, 0.0);
    previous_peak_rotation_real_.assign(bin_count_, 1.0);
    previous_peak_rotation_imaginary_.assign(bin_count_, 0.0);
    previous_peak_persistence_.assign(bin_count_, 0u);
    previous_peak_is_stable_.assign(bin_count_, static_cast<std::uint8_t>(0));
    previous_peak_handoff_frames_.assign(bin_count_, static_cast<std::uint8_t>(0));
    previous_peak_matched_.assign(bin_count_, static_cast<std::uint8_t>(0));
    const std::uint32_t fixed_anchor_count = (bin_count_ - 2u) / kFixedRegionBins + 1u;
    fixed_anchor_rotation_real_.assign(fixed_anchor_count, 1.0);
    fixed_anchor_rotation_imaginary_.assign(fixed_anchor_count, 0.0);

    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const double phase = 2.0 * kPi * static_cast<double>(index) / static_cast<double>(fft_size_);
      window_[index] = static_cast<float>(std::sqrt(0.5 - 0.5 * std::cos(phase)));
    }
    ::effetune::dsp::fft_stages::prepareTwiddles(twiddles_.data(), fft_size_);
    ratio_smoothing_coefficient_ =
        1.0 - std::exp(-static_cast<double>(hop_size_) / (kRatioSmoothingSeconds * sample_rate_));
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
    synthesis_spectrum_.clear();
    std::fill(shared_power_.begin(), shared_power_.end(), 0.0);
    resetRotations();
    timeline_position_ = 0u;
    absolute_sample_ = 0u;
    next_frame_sample_ = hop_size_;
    job_start_sample_ = 0u;
    job_frame_origin_ = 0u;
    job_output_origin_ = 0u;
    job_slot_ = 0u;
    job_channel_count_ = 0u;
    job_peak_count_ = 0u;
    job_region_peak_index_ = 0u;
    job_region_valley_ = 0u;
    job_splat_peak_index_ = 0u;
    job_splat_active_anchor_ = 0u;
    job_pitch_shift_ = 0.0F;
    job_fine_tune_ = 0.0F;
    job_target_ratio_ = 1.0;
    job_maximum_power_ = 0.0;
    job_peak_floor_ = kPeakFloor;
    job_fixed_step_real_ = 1.0;
    job_fixed_step_imaginary_ = 0.0;
    job_fixed_rotation_real_ = 1.0;
    job_fixed_rotation_imaginary_ = 0.0;
    job_region_minimum_ = 0.0;
    job_splat_handoff_weight_ = 0.0;
    job_splat_peak_shift_bins_ = 0.0;
    job_splat_peak_rotation_angle_ = 0.0;
    job_splat_shift_bins_ = 0.0;
    job_splat_compensated_rotation_real_ = 1.0;
    job_splat_compensated_rotation_imaginary_ = 0.0;
    job_identity_ = true;
    job_uses_identity_schedule_ = true;
    job_splat_stable_ = false;
    job_active_ = false;
    current_channel_count_ = 0u;
    smoothed_ratio_ = 1.0;
    wet_mix_ = 0.0;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }
    if (current_channel_count_ != channel_count) {
      if (current_channel_count_ != 0u) {
        reset();
      }
      if (!buildStageSchedules(channel_count)) {
        return;
      }
      current_channel_count_ = channel_count;
    }

    const double target_ratio = requestedRatio();
    const bool target_unity = target_ratio == 1.0;
    const double mix_step = 1.0 / static_cast<double>(hop_size_);

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      if (target_unity) {
        wet_mix_ -= mix_step;
        if (wet_mix_ < 0.0) {
          wet_mix_ = 0.0;
        }
      } else if (absolute_sample_ >= timeline_size_) {
        // Start the wet fade only when the delayed stream can contain valid input.
        wet_mix_ += mix_step;
        if (wet_mix_ > 1.0) {
          wet_mix_ = 1.0;
        }
      }

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t block_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const std::size_t ring_index =
            static_cast<std::size_t>(channel) * timeline_size_ + timeline_position_;
        const float input = std::isfinite(audio[block_index]) ? audio[block_index] : 0.0F;
        const float dry = dry_ring_[ring_index];
        const float wet = output_ring_[ring_index];
        input_ring_[ring_index] = input;
        dry_ring_[ring_index] = input;
        output_ring_[ring_index] = 0.0F;
        const double output = static_cast<double>(dry) +
                              (static_cast<double>(wet) - static_cast<double>(dry)) * wet_mix_;
        audio[block_index] = std::isfinite(output) ? static_cast<float>(output) : dry;
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

private:
  void releaseSetup() noexcept {
    forward_transform_.reset();
    if (real_setup_ != nullptr) {
      pffft_destroy_setup(real_setup_);
      real_setup_ = nullptr;
    }
    if (subtransform_setup_ != nullptr) {
      pffft_destroy_setup(subtransform_setup_);
      subtransform_setup_ = nullptr;
    }
    prepared_ = false;
  }

  [[nodiscard]] static double ratioFor(float pitch_shift, float fine_tune) noexcept {
    if (pitch_shift == 0.0F && fine_tune == 0.0F) {
      return 1.0;
    }
    const double exponent =
        static_cast<double>(pitch_shift) / 12.0 + static_cast<double>(fine_tune) / 1200.0;
    const double ratio = std::pow(2.0, exponent);
    return ratio > 0.0 && std::isfinite(ratio) ? ratio : 1.0;
  }

  [[nodiscard]] double requestedRatio() const noexcept {
    return ratioFor(params_.pitchShift, params_.fineTune);
  }

  void resetRotations() noexcept {
    std::fill(peak_rotation_real_.begin(), peak_rotation_real_.end(), 1.0);
    std::fill(peak_rotation_imaginary_.begin(), peak_rotation_imaginary_.end(), 0.0);
    std::fill(peak_persistence_.begin(), peak_persistence_.end(), 0u);
    std::fill(peak_is_stable_.begin(), peak_is_stable_.end(), static_cast<std::uint8_t>(0));
    std::fill(peak_handoff_frames_.begin(), peak_handoff_frames_.end(),
              static_cast<std::uint8_t>(0));
    std::fill(previous_peak_rotation_real_.begin(), previous_peak_rotation_real_.end(), 1.0);
    std::fill(previous_peak_rotation_imaginary_.begin(), previous_peak_rotation_imaginary_.end(),
              0.0);
    std::fill(previous_peak_persistence_.begin(), previous_peak_persistence_.end(), 0u);
    std::fill(previous_peak_is_stable_.begin(), previous_peak_is_stable_.end(),
              static_cast<std::uint8_t>(0));
    std::fill(previous_peak_handoff_frames_.begin(), previous_peak_handoff_frames_.end(),
              static_cast<std::uint8_t>(0));
    std::fill(previous_peak_matched_.begin(), previous_peak_matched_.end(),
              static_cast<std::uint8_t>(0));
    std::fill(fixed_anchor_rotation_real_.begin(), fixed_anchor_rotation_real_.end(), 1.0);
    std::fill(fixed_anchor_rotation_imaginary_.begin(), fixed_anchor_rotation_imaginary_.end(),
              0.0);
    previous_peak_count_ = 0u;
    translation_phase_per_bin_ = 0.0;
    rotations_reset_ = true;
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

  void transformForwardSubsequence(std::uint32_t packed_subsequence) noexcept {
    const std::uint32_t child_length = fft_size_ / (8u * subtransform_children_);
    float *subsequences = subtransform_children_ == 1u ? fft_input_.data() : fft_stage_.data();
    float *data = subsequences + 2u * packed_subsequence * child_length;
    pffft_transform_ordered(subtransform_setup_, data, data, fft_work_.data(), PFFFT_FORWARD);
  }

  void combineForwardSubtransform(std::uint32_t subsequence, std::uint32_t begin,
                                  std::uint32_t end) noexcept {
    const std::uint32_t subsequence_length = fft_size_ / 8u;
    const std::uint32_t child_length = subsequence_length / subtransform_children_;
    const float *children =
        fft_stage_.data() + 2u * subsequence * subtransform_children_ * child_length;
    float *spectrum = fft_input_.data() + 2u * subsequence * subsequence_length;
    if (subtransform_children_ == 2u) {
      ::effetune::dsp::fft_stages::combineComplexForwardRadix2(
          children, spectrum, twiddles_.data(), subsequence_length, fft_size_, begin, end);
    } else {
      ::effetune::dsp::fft_stages::combineComplexForward(children, spectrum, twiddles_.data(),
                                                         subsequence_length, fft_size_, begin, end);
    }
  }

  void combineForward(std::uint32_t begin, std::uint32_t end) noexcept {
    ::effetune::dsp::fft_stages::combineForward(fft_input_.data(), fft_stage_.data(),
                                                twiddles_.data(), fft_size_, begin, end);
  }

  void splitForward(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    ::effetune::dsp::fft_stages::splitForward(fft_stage_.data(), spectrum, twiddles_.data(),
                                              fft_size_, begin, end);
  }

  void accumulatePower(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_identity_) {
      return;
    }
    const float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      if (bin == 0u) {
        shared_power_[0u] += static_cast<double>(spectrum[0u]) * spectrum[0u];
      } else if (bin + 1u == bin_count_) {
        shared_power_[bin] += static_cast<double>(spectrum[1u]) * spectrum[1u];
      } else {
        const double real = static_cast<double>(spectrum[2u * bin]);
        const double imaginary = static_cast<double>(spectrum[2u * bin + 1u]);
        shared_power_[bin] += real * real + imaginary * imaginary;
      }
    }
  }

  void findMaximumPower(std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_identity_) {
      return;
    }
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      if (shared_power_[bin] > job_maximum_power_) {
        job_maximum_power_ = shared_power_[bin];
      }
    }
  }

  void beginPeakScan() noexcept {
    if (job_identity_) {
      job_peak_count_ = 0u;
      return;
    }
    const double relative_floor = job_maximum_power_ * kPeakRelativeFloor;
    const double peak_floor = relative_floor > kPeakFloor ? relative_floor : kPeakFloor;
    job_peak_floor_ = peak_floor;
    job_peak_count_ = 0u;
  }

  void findPeaks(std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_identity_) {
      return;
    }
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      const double power = shared_power_[bin];
      const double far_neighbor = shared_power_[bin - 2u] > shared_power_[bin + 2u]
                                      ? shared_power_[bin - 2u]
                                      : shared_power_[bin + 2u];
      if (power > job_peak_floor_ && power * kPeakTieRatio >= shared_power_[bin - 1u] &&
          power * kPeakTieRatio >= shared_power_[bin + 1u] &&
          power > far_neighbor * kPeakProminenceRatio) {
        if (job_peak_count_ > 0u && peak_indices_[job_peak_count_ - 1u] + 1u == bin) {
          const std::uint32_t previous = peak_indices_[job_peak_count_ - 1u];
          if (power > shared_power_[previous] * kPeakTieRatio) {
            peak_indices_[job_peak_count_ - 1u] = bin;
          }
        } else {
          peak_indices_[job_peak_count_++] = bin;
        }
      }
    }
  }

  [[nodiscard]] double interpolatedPeakBin(std::uint32_t peak) const noexcept {
    const double left = std::log(shared_power_[peak - 1u] + kPeakInterpolationFloor);
    const double center = std::log(shared_power_[peak] + kPeakInterpolationFloor);
    const double right = std::log(shared_power_[peak + 1u] + kPeakInterpolationFloor);
    const double denominator = left - 2.0 * center + right;
    const double offset =
        std::abs(denominator) > 1.0e-20 ? clampPeakOffset(0.5 * (left - right) / denominator) : 0.0;
    return static_cast<double>(peak) + offset;
  }

  [[nodiscard]] double peakProminence(std::uint32_t peak) const noexcept {
    const double far_neighbor = shared_power_[peak - 2u] > shared_power_[peak + 2u]
                                    ? shared_power_[peak - 2u]
                                    : shared_power_[peak + 2u];
    return shared_power_[peak] / (far_neighbor + kPeakInterpolationFloor);
  }

  static void normalizeRotation(double &real, double &imaginary) noexcept {
    const double length_squared = real * real + imaginary * imaginary;
    if (length_squared > 0.0 && std::isfinite(length_squared)) {
      const double inverse_length = 1.0 / std::sqrt(length_squared);
      real *= inverse_length;
      imaginary *= inverse_length;
    } else {
      real = 1.0;
      imaginary = 0.0;
    }
  }

  void beginFixedAnchorRotations(double ratio) noexcept {
    const double phase_increment =
        2.0 * kPi * (ratio - 1.0) * static_cast<double>(hop_size_) / static_cast<double>(fft_size_);
    translation_phase_per_bin_ =
        std::remainder(translation_phase_per_bin_ + phase_increment, 2.0 * kPi);
    const double first_angle =
        translation_phase_per_bin_ * static_cast<double>(kFixedRegionBins / 2u);
    const double step_angle = translation_phase_per_bin_ * static_cast<double>(kFixedRegionBins);
    job_fixed_step_real_ = std::cos(step_angle);
    job_fixed_step_imaginary_ = std::sin(step_angle);
    job_fixed_rotation_real_ = std::cos(first_angle);
    job_fixed_rotation_imaginary_ = std::sin(first_angle);
  }

  void updateFixedAnchorRotations(std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_identity_ || begin >= fixed_anchor_rotation_real_.size()) {
      return;
    }
    if (end > fixed_anchor_rotation_real_.size()) {
      end = static_cast<std::uint32_t>(fixed_anchor_rotation_real_.size());
    }
    for (std::uint32_t index = begin; index < end; ++index) {
      fixed_anchor_rotation_real_[index] = job_fixed_rotation_real_;
      fixed_anchor_rotation_imaginary_[index] = job_fixed_rotation_imaginary_;
      const double next_real = job_fixed_rotation_real_ * job_fixed_step_real_ -
                               job_fixed_rotation_imaginary_ * job_fixed_step_imaginary_;
      job_fixed_rotation_imaginary_ = job_fixed_rotation_real_ * job_fixed_step_imaginary_ +
                                      job_fixed_rotation_imaginary_ * job_fixed_step_real_;
      job_fixed_rotation_real_ = next_real;
      if ((index & 31u) == 31u) {
        normalizeRotation(job_fixed_rotation_real_, job_fixed_rotation_imaginary_);
      }
    }
  }

  [[nodiscard]] std::uint32_t nearestPreviousPeak(double peak_bin,
                                                  bool unmatched_only) const noexcept {
    const auto begin = previous_peak_bins_.begin();
    const auto end = begin + previous_peak_count_;
    auto candidate = std::lower_bound(begin, end, peak_bin - kStablePeakTrackingRadiusBins);
    std::uint32_t best = previous_peak_count_;
    double best_distance = 0.0;
    while (candidate != end && *candidate <= peak_bin + kStablePeakTrackingRadiusBins) {
      const std::uint32_t index = static_cast<std::uint32_t>(candidate - begin);
      const double distance = std::abs(*candidate - peak_bin);
      if ((!unmatched_only || previous_peak_matched_[index] == 0u) &&
          (best == previous_peak_count_ || distance < best_distance)) {
        best = index;
        best_distance = distance;
      }
      ++candidate;
    }
    return best;
  }

  [[nodiscard]] std::uint32_t nearestCurrentPeak(double peak_bin,
                                                 std::uint32_t peak_count) const noexcept {
    const auto begin = peak_bins_.begin();
    const auto end = begin + peak_count;
    auto candidate = std::lower_bound(begin, end, peak_bin - kStablePeakTrackingRadiusBins);
    std::uint32_t best = peak_count;
    double best_distance = 0.0;
    while (candidate != end && *candidate <= peak_bin + kStablePeakTrackingRadiusBins) {
      const std::uint32_t index = static_cast<std::uint32_t>(candidate - begin);
      const double distance = std::abs(*candidate - peak_bin);
      if (best == peak_count || distance < best_distance) {
        best = index;
        best_distance = distance;
      }
      ++candidate;
    }
    return best;
  }

  void beginPeakMatching() noexcept {
    if (job_identity_) {
      return;
    }
    std::fill(peak_match_indices_.begin(), peak_match_indices_.begin() + job_peak_count_,
              previous_peak_count_);
    std::fill(previous_peak_matched_.begin(), previous_peak_matched_.begin() + previous_peak_count_,
              static_cast<std::uint8_t>(0));
  }

  void matchPeaksMutual(std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_identity_ || begin >= job_peak_count_) {
      return;
    }
    if (end > job_peak_count_) {
      end = job_peak_count_;
    }
    for (std::uint32_t index = begin; index < end; ++index) {
      const std::uint32_t previous = nearestPreviousPeak(peak_bins_[index], false);
      if (previous < previous_peak_count_ && previous_peak_matched_[previous] == 0u &&
          nearestCurrentPeak(previous_peak_bins_[previous], job_peak_count_) == index) {
        peak_match_indices_[index] = previous;
        previous_peak_matched_[previous] = 1u;
      }
    }
  }

  void matchPeaksRemaining(std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_identity_ || begin >= job_peak_count_) {
      return;
    }
    if (end > job_peak_count_) {
      end = job_peak_count_;
    }
    for (std::uint32_t index = begin; index < end; ++index) {
      if (peak_match_indices_[index] < previous_peak_count_) {
        continue;
      }
      const std::uint32_t previous = nearestPreviousPeak(peak_bins_[index], true);
      if (previous < previous_peak_count_) {
        peak_match_indices_[index] = previous;
        previous_peak_matched_[previous] = 1u;
      }
    }
  }

  void interpolatePeaks(std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_identity_ || begin >= job_peak_count_) {
      return;
    }
    if (end > job_peak_count_) {
      end = job_peak_count_;
    }
    for (std::uint32_t index = begin; index < end; ++index) {
      peak_bins_[index] = interpolatedPeakBin(peak_indices_[index]);
    }
  }

  void beginPeakRegions() noexcept {
    job_region_peak_index_ = 0u;
    if (!job_identity_ && job_peak_count_ != 0u) {
      job_region_valley_ = peak_indices_[0u];
      job_region_minimum_ = shared_power_[job_region_valley_];
    }
  }

  void scanPeakRegions(std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_identity_ || job_peak_count_ < 2u) {
      return;
    }
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      if (job_region_peak_index_ + 1u >= job_peak_count_) {
        break;
      }
      const std::uint32_t next_peak = peak_indices_[job_region_peak_index_ + 1u];
      if (bin >= next_peak) {
        peak_region_ends_[job_region_peak_index_] = job_region_valley_;
        ++job_region_peak_index_;
        job_region_valley_ = peak_indices_[job_region_peak_index_];
        job_region_minimum_ = shared_power_[job_region_valley_];
        continue;
      }
      if (bin > peak_indices_[job_region_peak_index_] && shared_power_[bin] < job_region_minimum_) {
        job_region_minimum_ = shared_power_[bin];
        job_region_valley_ = bin;
      }
    }
  }

  void finishPeakRegions() noexcept {
    if (!job_identity_ && job_peak_count_ != 0u) {
      peak_region_ends_[job_peak_count_ - 1u] = bin_count_ - 2u;
    }
  }

  void updatePeakValues(std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_identity_ || begin >= job_peak_count_) {
      return;
    }
    if (end > job_peak_count_) {
      end = job_peak_count_;
    }
    for (std::uint32_t index = begin; index < end; ++index) {
      const std::uint32_t peak = peak_indices_[index];
      const std::uint32_t match = peak_match_indices_[index];
      const bool prominent = peakProminence(peak) >= kStablePeakProminence;
      const bool matched_previous = match < previous_peak_count_;
      const bool matched_was_stable = matched_previous && previous_peak_is_stable_[match] != 0u;
      const bool was_stable = prominent && matched_was_stable;
      const std::uint32_t previous_persistence =
          prominent && match < previous_peak_count_ ? previous_peak_persistence_[match] : 0u;
      const std::uint32_t persistence =
          prominent ? (previous_persistence < kStablePeakAttackFrames ? previous_persistence + 1u
                                                                      : kStablePeakAttackFrames)
                    : 0u;
      const bool stable = prominent && (was_stable || persistence >= kStablePeakAttackFrames);
      std::uint8_t handoff_frames = 0u;
      if (!stable && matched_previous) {
        if (matched_was_stable) {
          handoff_frames = kReleaseHandoffFrames;
        } else if (previous_peak_handoff_frames_[match] > 0u) {
          handoff_frames = previous_peak_handoff_frames_[match] - 1u;
        }
      }
      const std::uint32_t anchor_index = peak / kFixedRegionBins;
      double rotation_real = fixed_anchor_rotation_real_[anchor_index];
      double rotation_imaginary = fixed_anchor_rotation_imaginary_[anchor_index];
      const double shift_bins = (smoothed_ratio_ - 1.0) * peak_bins_[index];
      if ((stable && was_stable) || handoff_frames > 0u) {
        const double angle = 2.0 * kPi * shift_bins * static_cast<double>(hop_size_) /
                             static_cast<double>(fft_size_);
        const double cosine = std::cos(angle);
        const double sine = std::sin(angle);
        rotation_real = previous_peak_rotation_real_[match] * cosine -
                        previous_peak_rotation_imaginary_[match] * sine;
        rotation_imaginary = previous_peak_rotation_real_[match] * sine +
                             previous_peak_rotation_imaginary_[match] * cosine;
        normalizeRotation(rotation_real, rotation_imaginary);
      }
      peak_shift_bins_[index] = shift_bins;
      peak_rotation_real_[index] = rotation_real;
      peak_rotation_imaginary_[index] = rotation_imaginary;
      peak_persistence_[index] = persistence;
      peak_is_stable_[index] = stable ? static_cast<std::uint8_t>(1) : static_cast<std::uint8_t>(0);
      peak_handoff_frames_[index] = handoff_frames;
    }
  }

  void copyPeakValues(std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_identity_ || begin >= job_peak_count_) {
      return;
    }
    if (end > job_peak_count_) {
      end = job_peak_count_;
    }
    for (std::uint32_t index = begin; index < end; ++index) {
      previous_peak_bins_[index] = peak_bins_[index];
      previous_peak_rotation_real_[index] = peak_rotation_real_[index];
      previous_peak_rotation_imaginary_[index] = peak_rotation_imaginary_[index];
      previous_peak_persistence_[index] = peak_persistence_[index];
      previous_peak_is_stable_[index] = peak_is_stable_[index];
      previous_peak_handoff_frames_[index] = peak_handoff_frames_[index];
    }
  }

  void finishPeakState() noexcept {
    if (!job_identity_) {
      previous_peak_count_ = job_peak_count_;
    }
  }

  static void addOrderedBin(float *spectrum, std::uint32_t bin, std::uint32_t nyquist_bin,
                            double real, double imaginary) noexcept {
    if (bin == 0u) {
      spectrum[0u] += static_cast<float>(real);
    } else if (bin == nyquist_bin) {
      spectrum[1u] += static_cast<float>(real);
    } else {
      spectrum[2u * bin] += static_cast<float>(real);
      spectrum[2u * bin + 1u] += static_cast<float>(imaginary);
    }
  }

  static void addHermitianBin(float *spectrum, std::int32_t bin, std::uint32_t nyquist_bin,
                              double real, double imaginary) noexcept {
    if (bin < 0) {
      bin = -bin;
      imaginary = -imaginary;
    }
    const std::uint32_t positive_bin = static_cast<std::uint32_t>(bin);
    if (positive_bin <= nyquist_bin) {
      addOrderedBin(spectrum, positive_bin, nyquist_bin, real, imaginary);
    }
  }

  void splat(float *target, double target_bin, double real, double imaginary) const noexcept {
    const std::uint32_t nyquist_bin = bin_count_ - 1u;
    const double floored_target = std::floor(target_bin);
    const std::int32_t lower = static_cast<std::int32_t>(floored_target);
    const double fraction = target_bin - floored_target;
    addHermitianBin(target, lower, nyquist_bin, real * (1.0 - fraction),
                    imaginary * (1.0 - fraction));
    if (fraction > 0.0) {
      addHermitianBin(target, lower + 1, nyquist_bin, -real * fraction, -imaginary * fraction);
    }
  }

  [[nodiscard]] std::uint32_t fixedAnchorBin(std::uint32_t source_bin) const noexcept {
    const std::uint32_t candidate =
        (source_bin / kFixedRegionBins) * kFixedRegionBins + kFixedRegionBins / 2u;
    return candidate < bin_count_ - 1u ? candidate : bin_count_ - 2u;
  }

  void buildSpectrum(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    const float *source = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    const std::size_t count = static_cast<std::size_t>(end - begin) * sizeof(float);
    if (job_identity_) {
      std::memcpy(synthesis_spectrum_.data() + begin, source + begin, count);
    } else {
      std::memset(synthesis_spectrum_.data() + begin, 0, count);
    }
  }

  void prepareSpectrum(std::uint32_t channel) noexcept {
    if (!job_identity_) {
      const float *source = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
      synthesis_spectrum_[0u] = source[0u];
      job_splat_peak_index_ = 0u;
      job_splat_active_anchor_ = static_cast<std::uint32_t>(fixed_anchor_rotation_real_.size());
    }
  }

  void splatBins(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    if (job_identity_ || job_peak_count_ == 0u || begin >= bin_count_ - 1u) {
      return;
    }
    if (begin < 1u) {
      begin = 1u;
    }
    if (end > bin_count_ - 1u) {
      end = bin_count_ - 1u;
    }
    const float *source = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    for (std::uint32_t source_bin = begin; source_bin < end; ++source_bin) {
      while (job_splat_peak_index_ + 1u < job_peak_count_ &&
             source_bin > peak_region_ends_[job_splat_peak_index_]) {
        ++job_splat_peak_index_;
      }
      const std::uint32_t region_start =
          job_splat_peak_index_ == 0u ? 1u : peak_region_ends_[job_splat_peak_index_ - 1u] + 1u;
      if (source_bin == region_start) {
        job_splat_stable_ = peak_is_stable_[job_splat_peak_index_] != 0u;
        job_splat_handoff_weight_ =
            static_cast<double>(peak_handoff_frames_[job_splat_peak_index_]) /
            static_cast<double>(kReleaseHandoffFrames + 1u);
        job_splat_peak_shift_bins_ = peak_shift_bins_[job_splat_peak_index_];
        job_splat_peak_rotation_angle_ =
            job_splat_handoff_weight_ > 0.0
                ? std::atan2(peak_rotation_imaginary_[job_splat_peak_index_],
                             peak_rotation_real_[job_splat_peak_index_])
                : 0.0;
        job_splat_active_anchor_ = static_cast<std::uint32_t>(fixed_anchor_rotation_real_.size());
        job_splat_shift_bins_ = job_splat_peak_shift_bins_;
        job_splat_compensated_rotation_real_ = 1.0;
        job_splat_compensated_rotation_imaginary_ = 0.0;
      }

      const std::uint32_t anchor_index = source_bin / kFixedRegionBins;
      if ((job_splat_stable_ && source_bin == region_start) ||
          (!job_splat_stable_ && anchor_index != job_splat_active_anchor_)) {
        job_splat_active_anchor_ = anchor_index;
        double rotation_real = peak_rotation_real_[job_splat_peak_index_];
        double rotation_imaginary = peak_rotation_imaginary_[job_splat_peak_index_];
        if (!job_splat_stable_) {
          const std::uint32_t anchor_bin = fixedAnchorBin(source_bin);
          const double fixed_shift_bins = (smoothed_ratio_ - 1.0) * static_cast<double>(anchor_bin);
          job_splat_shift_bins_ =
              fixed_shift_bins +
              job_splat_handoff_weight_ * (job_splat_peak_shift_bins_ - fixed_shift_bins);
          rotation_real = fixed_anchor_rotation_real_[anchor_index];
          rotation_imaginary = fixed_anchor_rotation_imaginary_[anchor_index];
          if (job_splat_handoff_weight_ > 0.0) {
            const double fixed_angle = std::atan2(rotation_imaginary, rotation_real);
            const double interpolated_angle =
                fixed_angle +
                job_splat_handoff_weight_ *
                    std::remainder(job_splat_peak_rotation_angle_ - fixed_angle, 2.0 * kPi);
            rotation_real = std::cos(interpolated_angle);
            rotation_imaginary = std::sin(interpolated_angle);
          }
        }
        // This centered-window correction is frame-local and must not enter phase state.
        const double fractional_shift = job_splat_shift_bins_ - std::floor(job_splat_shift_bins_);
        const double compensation_angle = kPi * fractional_shift;
        const double compensation_real = std::cos(compensation_angle);
        const double compensation_imaginary = std::sin(compensation_angle);
        job_splat_compensated_rotation_real_ =
            compensation_real * rotation_real - compensation_imaginary * rotation_imaginary;
        job_splat_compensated_rotation_imaginary_ =
            compensation_real * rotation_imaginary + compensation_imaginary * rotation_real;
      }
      const double source_real = static_cast<double>(source[2u * source_bin]);
      const double source_imaginary = static_cast<double>(source[2u * source_bin + 1u]);
      const double rotated_real = source_real * job_splat_compensated_rotation_real_ -
                                  source_imaginary * job_splat_compensated_rotation_imaginary_;
      const double rotated_imaginary = source_real * job_splat_compensated_rotation_imaginary_ +
                                       source_imaginary * job_splat_compensated_rotation_real_;
      splat(synthesis_spectrum_.data(), static_cast<double>(source_bin) + job_splat_shift_bins_,
            rotated_real, rotated_imaginary);
    }
  }

  void finishSpectrum() noexcept {
    if (!job_identity_) {
      synthesis_spectrum_[1u] = 0.0F;
    }
  }

  void mergeInverse(std::uint32_t begin, std::uint32_t end) noexcept {
    ::effetune::dsp::fft_stages::mergeInverse(synthesis_spectrum_.data(), fft_stage_.data(),
                                              twiddles_.data(), fft_size_, begin, end);
  }

  void separateInverse(std::uint32_t subsequence, std::uint32_t begin, std::uint32_t end) noexcept {
    ::effetune::dsp::fft_stages::separateInverse(
        fft_stage_.data(), fft_input_.data(), twiddles_.data(), fft_size_, subsequence, begin, end);
  }

  void separateInverseSubtransform(std::uint32_t packed_subsequence, std::uint32_t begin,
                                   std::uint32_t end) noexcept {
    const std::uint32_t subsequence = packed_subsequence / subtransform_children_;
    const std::uint32_t child = packed_subsequence % subtransform_children_;
    const std::uint32_t subsequence_length = fft_size_ / 8u;
    const float *spectrum = fft_input_.data() + 2u * subsequence * subsequence_length;
    const std::uint32_t child_length = subsequence_length / subtransform_children_;
    float *children =
        synthesis_spectrum_.data() + 2u * subsequence * subtransform_children_ * child_length;
    if (subtransform_children_ == 2u) {
      ::effetune::dsp::fft_stages::separateComplexInverseRadix2(
          spectrum, children, twiddles_.data(), subsequence_length, fft_size_, child, begin, end);
    } else {
      ::effetune::dsp::fft_stages::separateComplexInverse(
          spectrum, children, twiddles_.data(), subsequence_length, fft_size_, child, begin, end);
    }
  }

  void transformInverseSubsequence(std::uint32_t packed_subsequence) noexcept {
    const std::uint32_t child_length = fft_size_ / (8u * subtransform_children_);
    float *subsequences =
        subtransform_children_ == 1u ? fft_input_.data() : synthesis_spectrum_.data();
    float *data = subsequences + 2u * packed_subsequence * child_length;
    pffft_transform_ordered(subtransform_setup_, data, data, fft_work_.data(), PFFFT_BACKWARD);
  }

  void overlapAdd(std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    const double normalization = 1.0 / (2.0 * static_cast<double>(fft_size_));
    const std::size_t channel_offset = static_cast<std::size_t>(channel) * timeline_size_;
    const std::uint32_t child_length = fft_size_ / (8u * subtransform_children_);
    const float *subsequences =
        subtransform_children_ == 1u ? fft_input_.data() : synthesis_spectrum_.data();
    for (std::uint32_t base = begin; base < end; base += 8u) {
      const std::uint32_t subsequence_index = base / 8u;
      const std::uint32_t child = subsequence_index % subtransform_children_;
      const std::uint32_t child_index = subsequence_index / subtransform_children_;
      for (std::uint32_t subsequence = 0u; subsequence < kTransformSubsequences; ++subsequence) {
        const std::uint32_t sample_index = base + 2u * subsequence;
        const std::uint32_t source_index =
            2u * ((subsequence * subtransform_children_ + child) * child_length + child_index);
        for (std::uint32_t component = 0u; component < 2u; ++component) {
          const std::uint32_t index = sample_index + component;
          const std::uint32_t output_index = job_output_origin_ + index < timeline_size_
                                                 ? job_output_origin_ + index
                                                 : job_output_origin_ + index - timeline_size_;
          const double sample = static_cast<double>(subsequences[source_index + component]) *
                                static_cast<double>(window_[index]) * normalization;
          if (std::isfinite(sample)) {
            output_ring_[channel_offset + output_index] += static_cast<float>(sample);
          }
        }
      }
    }
  }

  void beginAnalysisState() noexcept {
    const bool target_unity = job_target_ratio_ == 1.0;
    if (target_unity) {
      smoothed_ratio_ = 1.0;
    } else {
      smoothed_ratio_ += (job_target_ratio_ - smoothed_ratio_) * ratio_smoothing_coefficient_;
    }
    job_identity_ = target_unity || smoothed_ratio_ == 1.0 || job_peak_count_ == 0u;
    if (job_identity_) {
      if (!rotations_reset_) {
        resetRotations();
      }
    } else {
      rotations_reset_ = false;
      beginFixedAnchorRotations(smoothed_ratio_);
    }
  }

  void addStage(StageKind kind, std::uint32_t channel, std::uint32_t begin, std::uint32_t end,
                std::uint32_t weight) noexcept {
    building_stage_schedule_->addStage(static_cast<std::uint8_t>(kind), channel, begin, end,
                                       weight);
  }

  void addLinearStages(StageKind kind, std::uint32_t channel, std::uint32_t begin,
                       std::uint32_t end, std::uint32_t chunk_count, std::uint32_t stage_weight,
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
      addStage(kind, channel, chunk_begin, chunk_end, stage_weight);
    }
  }

  void addPeakStages(StageKind kind, std::uint32_t chunk_count,
                     std::uint32_t stage_weight) noexcept {
    for (std::uint32_t chunk = 0u; chunk < chunk_count; ++chunk) {
      addStage(kind, chunk_count, chunk, chunk + 1u, stage_weight);
    }
  }

  void peakStageRange(const ::effetune::dsp::SchedulerStage &stage, std::uint32_t &begin,
                      std::uint32_t &end) const noexcept {
    begin = static_cast<std::uint32_t>(static_cast<std::uint64_t>(job_peak_count_) * stage.begin /
                                       stage.channel);
    end = static_cast<std::uint32_t>(static_cast<std::uint64_t>(job_peak_count_) * stage.end /
                                     stage.channel);
  }

  [[nodiscard]] std::uint32_t workSlotCount(std::uint32_t channel_count) const noexcept {
    const std::uint32_t reference_channels = channel_count < 2u ? channel_count : 2u;
    return slot_count_ * reference_channels / channel_count;
  }

  [[nodiscard]] bool buildStageSchedule(std::uint32_t channel_count, StageSchedule &schedule,
                                        bool identity) noexcept {
    building_stage_schedule_ = &schedule;
    schedule.clear();
    const std::uint32_t work_slots = workSlotCount(channel_count);
    const std::uint32_t linear_candidate = (work_slots + 31u) / 32u;
    const std::uint32_t linear_chunks =
        linear_candidate < kMinimumLinearPassChunks ? kMinimumLinearPassChunks : linear_candidate;
    const std::uint32_t peak_candidate = (work_slots + 3u) / 4u;
    const std::uint32_t peak_chunks = peak_candidate < 8u ? 8u : peak_candidate;
    const std::uint32_t splat_candidate = (work_slots + 3u) / 4u;
    const std::uint32_t splat_chunks = splat_candidate < 8u ? 8u : splat_candidate;
    const std::uint32_t output_candidate = (work_slots + 15u) / 16u;
    const std::uint32_t output_chunks =
        output_candidate < kMinimumLinearPassChunks ? kMinimumLinearPassChunks : output_candidate;
    const std::uint32_t split_candidate = (work_slots + 7u) / 8u;
    const std::uint32_t split_chunks =
        split_candidate < kMinimumLinearPassChunks ? kMinimumLinearPassChunks : split_candidate;
    const std::uint32_t packed_size = fft_size_ / 2u;
    const std::uint32_t subsequence_length = fft_size_ / 8u;
    const std::uint32_t child_length = fft_size_ / (8u * subtransform_children_);
    constexpr std::uint32_t transform_weight = 8u;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      addLinearStages(StageKind::PackAnalysis, channel, 0u, fft_size_, output_chunks, 1u);
      addStage(StageKind::BeginForward, channel, 0u, 0u, 1u);
      for (int step = 0; step < forward_transform_->stepCount(); ++step) {
        addStage(StageKind::ForwardStep, channel, 0u, 0u, transform_weight);
      }
      if (!identity) {
        addLinearStages(StageKind::AccumulatePower, channel, 0u, bin_count_, output_chunks, 1u);
      }
    }

    if (identity) {
      addStage(StageKind::BeginAnalysisState, 0u, 0u, 0u, 1u);
    } else {
      addStage(StageKind::BeginPeakSearch, 0u, 0u, 0u, 1u);
      addLinearStages(StageKind::FindMaximumPower, 0u, 0u, bin_count_, linear_chunks, 1u);
      addStage(StageKind::BeginPeakScan, 0u, 0u, 0u, 1u);
      addLinearStages(StageKind::FindPeaks, 0u, 2u, bin_count_ - 2u, split_chunks, 2u);
      addStage(StageKind::BeginAnalysisState, 0u, 0u, 0u, 1u);
      addLinearStages(StageKind::UpdateFixedAnchorRotations, 0u, 0u,
                      static_cast<std::uint32_t>(fixed_anchor_rotation_real_.size()), linear_chunks,
                      1u);
      addPeakStages(StageKind::InterpolatePeaks, peak_chunks, 1u);
      addStage(StageKind::BeginPeakRegions, 0u, 0u, 0u, 1u);
      addLinearStages(StageKind::ScanPeakRegions, 0u, 0u, bin_count_, peak_chunks, 1u);
      addStage(StageKind::FinishPeakRegions, 0u, 0u, 0u, 1u);
      addStage(StageKind::BeginPeakMatching, 0u, 0u, 0u, 1u);
      addPeakStages(StageKind::MatchPeaksMutual, peak_chunks, 3u);
      addPeakStages(StageKind::MatchPeaksRemaining, peak_chunks, 1u);
      addPeakStages(StageKind::UpdatePeakValues, peak_chunks, 2u);
      addPeakStages(StageKind::CopyPeakValues, linear_chunks, 1u);
      addStage(StageKind::FinishPeakState, 0u, 0u, 0u, 1u);
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      addLinearStages(StageKind::BuildSpectrum, channel, 0u, fft_size_, linear_chunks, 1u);
      if (!identity) {
        addStage(StageKind::PrepareSpectrum, channel, 0u, 0u, 1u);
        addLinearStages(StageKind::SplatBins, channel, 1u, bin_count_ - 1u, splat_chunks, 8u);
        addStage(StageKind::FinishSpectrum, channel, 0u, 0u, 1u);
      }
      addLinearStages(StageKind::MergeInverse, channel, 0u, packed_size, output_chunks, 2u);
      for (std::uint32_t subsequence = 0u; subsequence < kTransformSubsequences; ++subsequence) {
        addLinearStages(StageKind::SeparateInverse, subsequence, 0u, subsequence_length,
                        linear_chunks, 2u);
      }
      for (std::uint32_t subsequence = 0u; subsequence < kTransformSubsequences; ++subsequence) {
        for (std::uint32_t child = 0u; child < subtransform_children_; ++child) {
          const std::uint32_t packed_subsequence = subsequence * subtransform_children_ + child;
          if (subtransform_children_ > 1u) {
            addStage(StageKind::SeparateInverseSubtransform, packed_subsequence, 0u, child_length,
                     2u);
          }
        }
        for (std::uint32_t child = 0u; child < subtransform_children_; ++child) {
          addStage(StageKind::InverseSubtransform, subsequence * subtransform_children_ + child, 0u,
                   0u, 2u * transform_weight);
        }
      }
      addLinearStages(StageKind::OverlapAdd, channel, 0u, fft_size_, output_chunks, 6u, 8u);
    }
    const bool partitioned = schedule.partition(slot_count_);
    building_stage_schedule_ = nullptr;
    return partitioned;
  }

  [[nodiscard]] bool buildStageSchedules(std::uint32_t channel_count) noexcept {
    return buildStageSchedule(channel_count, *stage_schedule_, false) &&
           buildStageSchedule(channel_count, *identity_stage_schedule_, true);
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
    case StageKind::AccumulatePower:
      accumulatePower(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::BeginPeakSearch:
      job_maximum_power_ = 0.0;
      break;
    case StageKind::FindMaximumPower:
      findMaximumPower(stage.begin, stage.end);
      break;
    case StageKind::BeginPeakScan:
      beginPeakScan();
      break;
    case StageKind::FindPeaks:
      findPeaks(stage.begin, stage.end);
      break;
    case StageKind::BeginAnalysisState:
      beginAnalysisState();
      break;
    case StageKind::UpdateFixedAnchorRotations:
      updateFixedAnchorRotations(stage.begin, stage.end);
      break;
    case StageKind::InterpolatePeaks: {
      std::uint32_t begin = 0u;
      std::uint32_t end = 0u;
      peakStageRange(stage, begin, end);
      interpolatePeaks(begin, end);
      break;
    }
    case StageKind::BeginPeakRegions:
      beginPeakRegions();
      break;
    case StageKind::ScanPeakRegions:
      scanPeakRegions(stage.begin, stage.end);
      break;
    case StageKind::FinishPeakRegions:
      finishPeakRegions();
      break;
    case StageKind::BeginPeakMatching:
      beginPeakMatching();
      break;
    case StageKind::MatchPeaksMutual: {
      std::uint32_t begin = 0u;
      std::uint32_t end = 0u;
      peakStageRange(stage, begin, end);
      matchPeaksMutual(begin, end);
      break;
    }
    case StageKind::MatchPeaksRemaining: {
      std::uint32_t begin = 0u;
      std::uint32_t end = 0u;
      peakStageRange(stage, begin, end);
      matchPeaksRemaining(begin, end);
      break;
    }
    case StageKind::UpdatePeakValues: {
      std::uint32_t begin = 0u;
      std::uint32_t end = 0u;
      peakStageRange(stage, begin, end);
      updatePeakValues(begin, end);
      break;
    }
    case StageKind::CopyPeakValues: {
      std::uint32_t begin = 0u;
      std::uint32_t end = 0u;
      peakStageRange(stage, begin, end);
      copyPeakValues(begin, end);
      break;
    }
    case StageKind::FinishPeakState:
      finishPeakState();
      break;
    case StageKind::BuildSpectrum:
      buildSpectrum(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::PrepareSpectrum:
      prepareSpectrum(stage.channel);
      break;
    case StageKind::SplatBins:
      splatBins(stage.channel, stage.begin, stage.end);
      break;
    case StageKind::FinishSpectrum:
      finishSpectrum();
      break;
    case StageKind::MergeInverse:
      mergeInverse(stage.begin, stage.end);
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
    const StageSchedule &schedule =
        job_uses_identity_schedule_ ? *identity_stage_schedule_ : *stage_schedule_;
    while (job_active_ && job_slot_ < slot_count_ &&
           absolute_sample_ - job_start_sample_ >=
               static_cast<std::uint64_t>(job_slot_ + 1u) * kSlotSamples) {
      const std::uint32_t end = schedule.slotEnd(job_slot_);
      std::uint32_t index = schedule.slotBegin(job_slot_);
      while (index < end) {
        ::effetune::dsp::SchedulerStage stage = schedule.stage(index++);
        while (index < end) {
          const auto &next = schedule.stage(index);
          if (stage.begin == stage.end || next.kind != stage.kind ||
              next.channel != stage.channel || next.begin != stage.end) {
            break;
          }
          stage.end = next.end;
          ++index;
        }
        runStage(stage);
      }
      ++job_slot_;
      if (job_slot_ == slot_count_) {
        job_active_ = false;
      }
    }
  }

  void startStagedJob(std::uint32_t channel_count) noexcept {
    job_start_sample_ = absolute_sample_;
    job_frame_origin_ = timeline_position_ >= fft_size_
                            ? timeline_position_ - fft_size_
                            : timeline_position_ + timeline_size_ - fft_size_;
    job_output_origin_ = timeline_position_ + stage_span_ < timeline_size_
                             ? timeline_position_ + stage_span_
                             : timeline_position_ + stage_span_ - timeline_size_;
    job_slot_ = 0u;
    job_channel_count_ = channel_count;
    job_peak_count_ = 0u;
    job_pitch_shift_ = params_.pitchShift;
    job_fine_tune_ = params_.fineTune;
    job_target_ratio_ = ratioFor(job_pitch_shift_, job_fine_tune_);
    job_identity_ = job_target_ratio_ == 1.0;
    job_uses_identity_schedule_ = job_identity_;
    if (!job_identity_) {
      std::fill(shared_power_.begin(), shared_power_.end(), 0.0);
    }
    job_active_ = true;
  }

  PFFFT_Setup *real_setup_ = nullptr;
  PFFFT_Setup *subtransform_setup_ = nullptr;
  std::unique_ptr<::effetune::dsp::PffftOrderedRealForward> forward_transform_;
  double sample_rate_ = 0.0;
  double ratio_smoothing_coefficient_ = 1.0;
  double smoothed_ratio_ = 1.0;
  double wet_mix_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t fft_size_ = 0u;
  std::uint32_t hop_size_ = 0u;
  std::uint32_t stage_span_ = 0u;
  std::uint32_t slot_count_ = 0u;
  std::uint32_t subtransform_children_ = 0u;
  std::uint32_t timeline_size_ = 0u;
  std::uint32_t bin_count_ = 0u;
  std::uint32_t timeline_position_ = 0u;
  std::uint32_t current_channel_count_ = 0u;
  std::uint64_t absolute_sample_ = 0u;
  std::uint64_t next_frame_sample_ = 0u;
  std::uint64_t job_start_sample_ = 0u;
  std::uint32_t job_frame_origin_ = 0u;
  std::uint32_t job_output_origin_ = 0u;
  std::uint32_t job_slot_ = 0u;
  std::uint32_t job_channel_count_ = 0u;
  std::uint32_t job_peak_count_ = 0u;
  std::uint32_t previous_peak_count_ = 0u;
  std::uint32_t job_region_peak_index_ = 0u;
  std::uint32_t job_region_valley_ = 0u;
  std::uint32_t job_splat_peak_index_ = 0u;
  std::uint32_t job_splat_active_anchor_ = 0u;
  float job_pitch_shift_ = 0.0F;
  float job_fine_tune_ = 0.0F;
  double job_target_ratio_ = 1.0;
  double job_maximum_power_ = 0.0;
  double job_peak_floor_ = kPeakFloor;
  double job_fixed_step_real_ = 1.0;
  double job_fixed_step_imaginary_ = 0.0;
  double job_fixed_rotation_real_ = 1.0;
  double job_fixed_rotation_imaginary_ = 0.0;
  double job_region_minimum_ = 0.0;
  double job_splat_handoff_weight_ = 0.0;
  double job_splat_peak_shift_bins_ = 0.0;
  double job_splat_peak_rotation_angle_ = 0.0;
  double job_splat_shift_bins_ = 0.0;
  double job_splat_compensated_rotation_real_ = 1.0;
  double job_splat_compensated_rotation_imaginary_ = 0.0;
  bool job_identity_ = true;
  bool job_uses_identity_schedule_ = true;
  bool rotations_reset_ = true;
  bool job_splat_stable_ = false;
  bool job_active_ = false;
  bool prepared_ = false;
  double translation_phase_per_bin_ = 0.0;
  AlignedFloatBuffer input_ring_;
  AlignedFloatBuffer dry_ring_;
  AlignedFloatBuffer output_ring_;
  AlignedFloatBuffer spectra_;
  AlignedFloatBuffer window_;
  AlignedFloatBuffer fft_input_;
  AlignedFloatBuffer fft_work_;
  AlignedFloatBuffer fft_stage_;
  AlignedFloatBuffer synthesis_spectrum_;
  AlignedFloatBuffer twiddles_;
  std::vector<double> shared_power_;
  std::vector<std::uint32_t> peak_indices_;
  std::vector<std::uint32_t> peak_region_ends_;
  std::vector<double> peak_shift_bins_;
  std::vector<double> peak_rotation_real_;
  std::vector<double> peak_rotation_imaginary_;
  std::vector<double> peak_bins_;
  std::vector<std::uint32_t> peak_persistence_;
  std::vector<std::uint8_t> peak_is_stable_;
  std::vector<std::uint8_t> peak_handoff_frames_;
  std::vector<std::uint32_t> peak_match_indices_;
  std::vector<double> previous_peak_bins_;
  std::vector<double> previous_peak_rotation_real_;
  std::vector<double> previous_peak_rotation_imaginary_;
  std::vector<std::uint32_t> previous_peak_persistence_;
  std::vector<std::uint8_t> previous_peak_is_stable_;
  std::vector<std::uint8_t> previous_peak_handoff_frames_;
  std::vector<std::uint8_t> previous_peak_matched_;
  std::vector<double> fixed_anchor_rotation_real_;
  std::vector<double> fixed_anchor_rotation_imaginary_;
  std::unique_ptr<StageSchedule> stage_schedule_;
  std::unique_ptr<StageSchedule> identity_stage_schedule_;
  StageSchedule *building_stage_schedule_ = nullptr;
};

static_assert(sizeof(PitchShifterHQKernel) <= 8192u);

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(PitchShifterHQPlugin, effetune::plugins::modulation::PitchShifterHQKernel)

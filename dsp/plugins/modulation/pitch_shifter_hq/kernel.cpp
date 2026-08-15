#include "effetune/kernel.h"
#include "PitchShifterHQPluginParams.h"

#include <pffft.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
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
constexpr std::uint32_t kAnalysisSlots = 8u;
constexpr std::uint32_t kSynthesisSlots = 8u;
constexpr std::uint32_t kPeakSlot = 16u;
constexpr std::uint32_t kLogicalSlots = 32u;

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
    stage_slot_samples_ = stage_span_ / kLogicalSlots;
    timeline_size_ = fft_size_ + stage_span_;
    bin_count_ = fft_size_ / 2u + 1u;

    setup_ = pffft_new_setup(static_cast<int>(fft_size_), PFFFT_REAL);
    const std::size_t timeline_samples = static_cast<std::size_t>(max_channels_) * timeline_size_;
    const std::size_t spectrum_samples = static_cast<std::size_t>(max_channels_) * fft_size_;
    prepared_ = setup_ != nullptr && input_ring_.allocate(timeline_samples) &&
                dry_ring_.allocate(timeline_samples) && output_ring_.allocate(timeline_samples) &&
                spectra_.allocate(spectrum_samples) && window_.allocate(fft_size_) &&
                fft_input_.allocate(fft_size_) && fft_work_.allocate(fft_size_) &&
                inverse_output_.allocate(fft_size_) && synthesis_spectrum_.allocate(fft_size_);
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
    inverse_output_.clear();
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
    job_pitch_shift_ = 0.0F;
    job_fine_tune_ = 0.0F;
    job_target_ratio_ = 1.0;
    job_identity_ = true;
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
    if (current_channel_count_ != 0u && current_channel_count_ != channel_count) {
      reset();
    }
    current_channel_count_ = channel_count;

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
    if (setup_ != nullptr) {
      pffft_destroy_setup(setup_);
      setup_ = nullptr;
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
  }

  void analyzeChannel(std::uint32_t channel) noexcept {
    const std::size_t input_offset = static_cast<std::size_t>(channel) * timeline_size_;
    const std::size_t spectrum_offset = static_cast<std::size_t>(channel) * fft_size_;
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const std::uint32_t source_index = job_frame_origin_ + index < timeline_size_
                                             ? job_frame_origin_ + index
                                             : job_frame_origin_ + index - timeline_size_;
      fft_input_[index] = input_ring_[input_offset + source_index] * window_[index];
    }
    float *spectrum = spectra_.data() + spectrum_offset;
    pffft_transform_ordered(setup_, fft_input_.data(), spectrum, fft_work_.data(), PFFFT_FORWARD);
    shared_power_[0u] += static_cast<double>(spectrum[0u]) * spectrum[0u];
    shared_power_[bin_count_ - 1u] += static_cast<double>(spectrum[1u]) * spectrum[1u];
    for (std::uint32_t bin = 1u; bin + 1u < bin_count_; ++bin) {
      const double real = static_cast<double>(spectrum[2u * bin]);
      const double imaginary = static_cast<double>(spectrum[2u * bin + 1u]);
      shared_power_[bin] += real * real + imaginary * imaginary;
    }
  }

  [[nodiscard]] std::uint32_t findPeaks() noexcept {
    double maximum_power = 0.0;
    for (double power : shared_power_) {
      if (power > maximum_power) {
        maximum_power = power;
      }
    }
    const double relative_floor = maximum_power * kPeakRelativeFloor;
    const double peak_floor = relative_floor > kPeakFloor ? relative_floor : kPeakFloor;
    std::uint32_t count = 0u;
    for (std::uint32_t bin = 2u; bin + 2u < bin_count_; ++bin) {
      const double power = shared_power_[bin];
      const double far_neighbor = shared_power_[bin - 2u] > shared_power_[bin + 2u]
                                      ? shared_power_[bin - 2u]
                                      : shared_power_[bin + 2u];
      if (power > peak_floor && power * kPeakTieRatio >= shared_power_[bin - 1u] &&
          power * kPeakTieRatio >= shared_power_[bin + 1u] &&
          power > far_neighbor * kPeakProminenceRatio) {
        if (count > 0u && peak_indices_[count - 1u] + 1u == bin) {
          const std::uint32_t previous = peak_indices_[count - 1u];
          if (power > shared_power_[previous] * kPeakTieRatio) {
            peak_indices_[count - 1u] = bin;
          }
        } else {
          peak_indices_[count++] = bin;
        }
      }
    }
    return count;
  }

  [[nodiscard]] std::uint32_t valleyBetween(std::uint32_t left_peak,
                                            std::uint32_t right_peak) const noexcept {
    std::uint32_t valley = left_peak;
    double minimum = shared_power_[left_peak];
    for (std::uint32_t bin = left_peak + 1u; bin < right_peak; ++bin) {
      if (shared_power_[bin] < minimum) {
        minimum = shared_power_[bin];
        valley = bin;
      }
    }
    return valley;
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

  void updateFixedAnchorRotations(double ratio) noexcept {
    const double phase_increment =
        2.0 * kPi * (ratio - 1.0) * static_cast<double>(hop_size_) / static_cast<double>(fft_size_);
    translation_phase_per_bin_ =
        std::remainder(translation_phase_per_bin_ + phase_increment, 2.0 * kPi);
    const double first_angle =
        translation_phase_per_bin_ * static_cast<double>(kFixedRegionBins / 2u);
    const double step_angle = translation_phase_per_bin_ * static_cast<double>(kFixedRegionBins);
    const double step_real = std::cos(step_angle);
    const double step_imaginary = std::sin(step_angle);
    double rotation_real = std::cos(first_angle);
    double rotation_imaginary = std::sin(first_angle);
    for (std::size_t index = 0u; index < fixed_anchor_rotation_real_.size(); ++index) {
      fixed_anchor_rotation_real_[index] = rotation_real;
      fixed_anchor_rotation_imaginary_[index] = rotation_imaginary;
      const double next_real = rotation_real * step_real - rotation_imaginary * step_imaginary;
      rotation_imaginary = rotation_real * step_imaginary + rotation_imaginary * step_real;
      rotation_real = next_real;
      if ((index & 31u) == 31u) {
        normalizeRotation(rotation_real, rotation_imaginary);
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

  void matchPeaks(std::uint32_t peak_count) noexcept {
    std::fill(peak_match_indices_.begin(), peak_match_indices_.begin() + peak_count,
              previous_peak_count_);
    std::fill(previous_peak_matched_.begin(), previous_peak_matched_.begin() + previous_peak_count_,
              static_cast<std::uint8_t>(0));

    for (std::uint32_t index = 0u; index < peak_count; ++index) {
      const std::uint32_t previous = nearestPreviousPeak(peak_bins_[index], false);
      if (previous < previous_peak_count_ && previous_peak_matched_[previous] == 0u &&
          nearestCurrentPeak(previous_peak_bins_[previous], peak_count) == index) {
        peak_match_indices_[index] = previous;
        previous_peak_matched_[previous] = 1u;
      }
    }
    for (std::uint32_t index = 0u; index < peak_count; ++index) {
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

  void updatePeakState(std::uint32_t peak_count, double ratio) noexcept {
    updateFixedAnchorRotations(ratio);
    for (std::uint32_t index = 0u; index < peak_count; ++index) {
      peak_bins_[index] = interpolatedPeakBin(peak_indices_[index]);
      peak_region_ends_[index] =
          index + 1u < peak_count ? valleyBetween(peak_indices_[index], peak_indices_[index + 1u])
                                  : bin_count_ - 2u;
    }
    matchPeaks(peak_count);

    for (std::uint32_t index = 0u; index < peak_count; ++index) {
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
      const double shift_bins = (ratio - 1.0) * peak_bins_[index];
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

    for (std::uint32_t index = 0u; index < peak_count; ++index) {
      previous_peak_bins_[index] = peak_bins_[index];
      previous_peak_rotation_real_[index] = peak_rotation_real_[index];
      previous_peak_rotation_imaginary_[index] = peak_rotation_imaginary_[index];
      previous_peak_persistence_[index] = peak_persistence_[index];
      previous_peak_is_stable_[index] = peak_is_stable_[index];
      previous_peak_handoff_frames_[index] = peak_handoff_frames_[index];
    }
    previous_peak_count_ = peak_count;
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

  void synthesizeChannel(std::uint32_t channel, std::uint32_t peak_count, bool identity) noexcept {
    std::memset(synthesis_spectrum_.data(), 0, static_cast<std::size_t>(fft_size_) * sizeof(float));
    const float *source = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    if (identity || peak_count == 0u) {
      std::memcpy(synthesis_spectrum_.data(), source,
                  static_cast<std::size_t>(fft_size_) * sizeof(float));
    } else {
      synthesis_spectrum_[0u] = source[0u];
      std::uint32_t region_start = 1u;
      for (std::uint32_t peak_index = 0u; peak_index < peak_count; ++peak_index) {
        const std::uint32_t region_end = peak_region_ends_[peak_index];
        const bool stable = peak_is_stable_[peak_index] != 0u;
        const double handoff_weight = static_cast<double>(peak_handoff_frames_[peak_index]) /
                                      static_cast<double>(kReleaseHandoffFrames + 1u);
        const double peak_shift_bins = peak_shift_bins_[peak_index];
        const double peak_rotation_angle =
            handoff_weight > 0.0
                ? std::atan2(peak_rotation_imaginary_[peak_index], peak_rotation_real_[peak_index])
                : 0.0;
        std::uint32_t active_anchor =
            static_cast<std::uint32_t>(fixed_anchor_rotation_real_.size());
        double shift_bins = peak_shift_bins;
        double compensated_rotation_real = 1.0;
        double compensated_rotation_imaginary = 0.0;
        for (std::uint32_t source_bin = region_start; source_bin <= region_end; ++source_bin) {
          const std::uint32_t anchor_index = source_bin / kFixedRegionBins;
          if ((stable && source_bin == region_start) ||
              (!stable && anchor_index != active_anchor)) {
            active_anchor = anchor_index;
            double rotation_real = peak_rotation_real_[peak_index];
            double rotation_imaginary = peak_rotation_imaginary_[peak_index];
            if (!stable) {
              const std::uint32_t anchor_bin = fixedAnchorBin(source_bin);
              const double fixed_shift_bins =
                  (smoothed_ratio_ - 1.0) * static_cast<double>(anchor_bin);
              shift_bins = fixed_shift_bins + handoff_weight * (peak_shift_bins - fixed_shift_bins);
              rotation_real = fixed_anchor_rotation_real_[anchor_index];
              rotation_imaginary = fixed_anchor_rotation_imaginary_[anchor_index];
              if (handoff_weight > 0.0) {
                const double fixed_angle = std::atan2(rotation_imaginary, rotation_real);
                const double interpolated_angle =
                    fixed_angle +
                    handoff_weight * std::remainder(peak_rotation_angle - fixed_angle, 2.0 * kPi);
                rotation_real = std::cos(interpolated_angle);
                rotation_imaginary = std::sin(interpolated_angle);
              }
            }
            // This centered-window correction is frame-local and must not enter phase state.
            const double fractional_shift = shift_bins - std::floor(shift_bins);
            const double compensation_angle = kPi * fractional_shift;
            const double compensation_real = std::cos(compensation_angle);
            const double compensation_imaginary = std::sin(compensation_angle);
            compensated_rotation_real =
                compensation_real * rotation_real - compensation_imaginary * rotation_imaginary;
            compensated_rotation_imaginary =
                compensation_real * rotation_imaginary + compensation_imaginary * rotation_real;
          }
          const double source_real = static_cast<double>(source[2u * source_bin]);
          const double source_imaginary = static_cast<double>(source[2u * source_bin + 1u]);
          const double rotated_real = source_real * compensated_rotation_real -
                                      source_imaginary * compensated_rotation_imaginary;
          const double rotated_imaginary = source_real * compensated_rotation_imaginary +
                                           source_imaginary * compensated_rotation_real;
          splat(synthesis_spectrum_.data(), static_cast<double>(source_bin) + shift_bins,
                rotated_real, rotated_imaginary);
        }
        region_start = region_end + 1u;
      }
      synthesis_spectrum_[1u] = 0.0F;
    }

    pffft_transform_ordered(setup_, synthesis_spectrum_.data(), inverse_output_.data(),
                            fft_work_.data(), PFFFT_BACKWARD);
    const double normalization = 1.0 / (2.0 * static_cast<double>(fft_size_));
    const std::size_t channel_offset = static_cast<std::size_t>(channel) * timeline_size_;
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const std::uint32_t output_index = job_output_origin_ + index < timeline_size_
                                             ? job_output_origin_ + index
                                             : job_output_origin_ + index - timeline_size_;
      const double sample = static_cast<double>(inverse_output_[index]) *
                            static_cast<double>(window_[index]) * normalization;
      if (std::isfinite(sample)) {
        output_ring_[channel_offset + output_index] += static_cast<float>(sample);
      }
    }
  }

  void finishStagedAnalysis() noexcept {
    job_peak_count_ = findPeaks();
    const bool target_unity = job_target_ratio_ == 1.0;
    if (target_unity) {
      smoothed_ratio_ = 1.0;
    } else {
      smoothed_ratio_ += (job_target_ratio_ - smoothed_ratio_) * ratio_smoothing_coefficient_;
    }
    job_identity_ = target_unity || smoothed_ratio_ == 1.0 || job_peak_count_ == 0u;
    if (job_identity_) {
      resetRotations();
    } else {
      updatePeakState(job_peak_count_, smoothed_ratio_);
    }
  }

  [[nodiscard]] static bool channelForSlot(std::uint32_t slot, std::uint32_t channel_count,
                                           std::uint32_t &channel) noexcept {
    const std::uint32_t before = slot * channel_count / kMaximumChannels;
    const std::uint32_t after = (slot + 1u) * channel_count / kMaximumChannels;
    if (after == before) {
      return false;
    }
    channel = after - 1u;
    return true;
  }

  void runStagedSlot(std::uint32_t slot) noexcept {
    std::uint32_t channel = 0u;
    if (slot < kPeakSlot && (slot & 1u) == 0u) {
      const std::uint32_t analysis_slot = slot / 2u;
      if (analysis_slot < kAnalysisSlots &&
          channelForSlot(analysis_slot, job_channel_count_, channel)) {
        analyzeChannel(channel);
      }
      return;
    }
    if (slot == kPeakSlot) {
      finishStagedAnalysis();
      return;
    }
    if (slot > kPeakSlot && (slot & 1u) != 0u) {
      const std::uint32_t synthesis_slot = (slot - kPeakSlot - 1u) / 2u;
      if (synthesis_slot < kSynthesisSlots &&
          channelForSlot(synthesis_slot, job_channel_count_, channel)) {
        synthesizeChannel(channel, job_peak_count_, job_identity_);
      }
    }
  }

  void advanceStagedJob() noexcept {
    while (job_active_ && job_slot_ < kLogicalSlots &&
           absolute_sample_ - job_start_sample_ >=
               static_cast<std::uint64_t>(job_slot_ + 1u) * stage_slot_samples_) {
      runStagedSlot(job_slot_);
      ++job_slot_;
      if (job_slot_ == kLogicalSlots) {
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
    job_identity_ = true;
    std::fill(shared_power_.begin(), shared_power_.end(), 0.0);
    job_active_ = true;
  }

  PFFFT_Setup *setup_ = nullptr;
  double sample_rate_ = 0.0;
  double ratio_smoothing_coefficient_ = 1.0;
  double smoothed_ratio_ = 1.0;
  double wet_mix_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t fft_size_ = 0u;
  std::uint32_t hop_size_ = 0u;
  std::uint32_t stage_span_ = 0u;
  std::uint32_t stage_slot_samples_ = 0u;
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
  float job_pitch_shift_ = 0.0F;
  float job_fine_tune_ = 0.0F;
  double job_target_ratio_ = 1.0;
  bool job_identity_ = true;
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
  AlignedFloatBuffer inverse_output_;
  AlignedFloatBuffer synthesis_spectrum_;
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
};

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(PitchShifterHQPlugin, effetune::plugins::modulation::PitchShifterHQKernel)

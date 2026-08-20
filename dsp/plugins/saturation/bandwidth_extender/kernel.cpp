#include "effetune/kernel.h"
#include "BandwidthExtenderPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <pffft.h>

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::saturation {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kCeilingHz = 40000.0;
constexpr double kUpperTransitionMaximumHz = 1000.0;
constexpr double kEnvelopeReferenceHz = 500.0;
constexpr double kEnvelopeTargetGain = 1.8;
constexpr double kDetectionMinimumHz = 10000.0;
constexpr double kCliffReferenceHz = 2000.0;
constexpr double kShoulderRecoveryPower = 0.5;
constexpr double kPhaseAdvanceQuantization = 10000.0;
constexpr std::uint32_t kMaximumHarmonic = 5u;
constexpr std::array<double, kMaximumHarmonic + 1u> kHarmonicGains{0.0,  0.0,  0.28,
                                                                   0.14, 0.07, 0.035};
constexpr double kInverseSqrtTwo = 0.70710678118654752440084436210485;

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
    fft_size_ = fftSizeForRate(sample_rate_);
    hop_size_ = fft_size_ / 4u;
    bin_count_ = fft_size_ / 2u + 1u;
    setup_ = pffft_new_setup(static_cast<int>(fft_size_), PFFFT_REAL);
    prepared_ = setup_ != nullptr && max_channels_ >= 1u && max_frames_ >= 1u;
    if (!prepared_) {
      return;
    }

    const std::size_t channel_samples = static_cast<std::size_t>(max_channels_) * fft_size_;
    input_ring_.assign(channel_samples, 0.0F);
    dry_ring_.assign(channel_samples, 0.0F);
    harmonic_wet_ring_.assign(channel_samples, 0.0F);
    noise_wet_ring_.assign(channel_samples, 0.0F);
    spectra_.assign(channel_samples, 0.0F);
    window_.resize(fft_size_);
    fft_input_.assign(fft_size_, 0.0F);
    fft_work_.assign(fft_size_, 0.0F);
    inverse_output_.assign(fft_size_, 0.0F);
    synthesis_spectrum_.assign(fft_size_, 0.0F);
    harmonic_spectra_.assign(channel_samples, 0.0F);
    shared_power_.assign(bin_count_, 0.0);
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
    component_smoothing_ = 1.0 - std::exp(-1.0 / (0.02 * sample_rate_));
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return prepared_ ? fft_size_ : 0u;
  }

  void reset() noexcept override {
    clearAudioState();
    selected_seed_low_ = selected_seed_low_ == 0u && selected_seed_high_ == 0u
                             ? static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed)
                             : selected_seed_low_;
    mid_random_.seed(selected_seed_low_, selected_seed_high_);
    side_random_.seed(selected_seed_low_ ^ 0x9e3779b9u, selected_seed_high_ ^ 0x7f4a7c15u);
    input_position_ = 0u;
    dry_position_ = 0u;
    wet_position_ = 0u;
    samples_since_frame_ = 0u;
    samples_received_ = 0u;
    last_channel_count_ = 0u;
    stable_frames_ = 0u;
    stable_cutoff_bin_ = 0u;
    detected_cutoff_hz_ = 16000.0;
    detector_confidence_ = 0.0;
    detector_active_ = false;
    harmonic_amount_smoothed_ = 0.0;
    noise_amount_smoothed_ = 0.0;
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
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t block_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const std::size_t ring_offset = static_cast<std::size_t>(channel) * fft_size_;
        const float input = std::isfinite(audio[block_index]) ? audio[block_index] : 0.0F;
        const float dry = dry_ring_[ring_offset + dry_position_];
        dry_ring_[ring_offset + dry_position_] = input;
        input_ring_[ring_offset + input_position_] = input;
        const float harmonic_wet = harmonic_wet_ring_[ring_offset + wet_position_];
        harmonic_wet_ring_[ring_offset + wet_position_] = 0.0F;
        const float noise_wet = noise_wet_ring_[ring_offset + wet_position_];
        noise_wet_ring_[ring_offset + wet_position_] = 0.0F;
        const double output = static_cast<double>(dry) +
                              static_cast<double>(harmonic_wet) * harmonic_amount_smoothed_ +
                              static_cast<double>(noise_wet) * noise_amount_smoothed_;
        audio[block_index] = std::isfinite(output) ? static_cast<float>(output) : dry;
      }

      input_position_ = (input_position_ + 1u) % fft_size_;
      dry_position_ = (dry_position_ + 1u) % fft_size_;
      wet_position_ = (wet_position_ + 1u) % fft_size_;
      ++samples_received_;
      ++samples_since_frame_;
      if (samples_received_ >= fft_size_ && samples_since_frame_ >= hop_size_) {
        samples_since_frame_ = 0u;
        analyzeAndSynthesize(channel_count);
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
    for (float &sample : spectra_) {
      sample = 0.0F;
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

  void analyzeAndSynthesize(std::uint32_t channel_count) noexcept {
    for (double &power : shared_power_) {
      power = 0.0;
    }
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t channel_offset = static_cast<std::size_t>(channel) * fft_size_;
      for (std::uint32_t index = 0u; index < fft_size_; ++index) {
        const std::uint32_t ring_index = (input_position_ + index) % fft_size_;
        fft_input_[index] = input_ring_[channel_offset + ring_index] * window_[index];
      }
      float *spectrum = spectra_.data() + channel_offset;
      pffft_transform_ordered(setup_, fft_input_.data(), spectrum, fft_work_.data(), PFFFT_FORWARD);
      shared_power_[0] += static_cast<double>(spectrum[0]) * spectrum[0];
      shared_power_[bin_count_ - 1u] += static_cast<double>(spectrum[1]) * spectrum[1];
      for (std::uint32_t bin = 1u; bin + 1u < bin_count_; ++bin) {
        const double real = static_cast<double>(spectrum[bin * 2u]);
        const double imaginary = static_cast<double>(spectrum[bin * 2u + 1u]);
        shared_power_[bin] += real * real + imaginary * imaginary;
      }
    }
    const double channel_scale = 1.0 / static_cast<double>(channel_count);
    for (double &power : shared_power_) {
      power *= channel_scale;
    }
    updateSourcePhases(channel_count);

    const bool manual = static_cast<std::uint32_t>(params_.cutoffMode) == 1u;
    if (!manual) {
      updateDetector();
    }
    const double requested_cutoff =
        manual ? static_cast<double>(params_.cutoffFrequency) : detected_cutoff_hz_;
    const double nyquist = sample_rate_ * 0.5;
    const double ceiling = kCeilingHz < nyquist * 0.92 ? kCeilingHz : nyquist * 0.92;
    const bool active = manual ? requested_cutoff + 250.0 < ceiling : detector_active_;
    synthesize(channel_count, requested_cutoff, ceiling, active);
  }

  [[nodiscard]] double windowAverage(std::uint32_t top, std::uint32_t width) const noexcept {
    double sum = 0.0;
    for (std::uint32_t offset = 1u; offset <= width; ++offset) {
      sum += shared_power_[top - offset];
    }
    return sum / static_cast<double>(width);
  }

  void updateDetector() noexcept {
    const double bin_hz = sample_rate_ / static_cast<double>(fft_size_);
    const double detector_ceiling_hz =
        kCeilingHz < sample_rate_ * 0.46 ? kCeilingHz : sample_rate_ * 0.46;
    std::uint32_t first = static_cast<std::uint32_t>(std::ceil(kDetectionMinimumHz / bin_hz));
    std::uint32_t last = static_cast<std::uint32_t>(detector_ceiling_hz / bin_hz);
    const std::uint32_t half_window_raw = static_cast<std::uint32_t>(500.0 / bin_hz);
    const std::uint32_t half_window = half_window_raw < 4u ? 4u : half_window_raw;
    if (first < half_window + 1u) {
      first = half_window + 1u;
    }
    if (last + half_window >= bin_count_) {
      last = bin_count_ - half_window - 1u;
    }
    std::uint32_t detector_ceiling_bin = static_cast<std::uint32_t>(detector_ceiling_hz / bin_hz);
    if (detector_ceiling_bin >= bin_count_) {
      detector_ceiling_bin = bin_count_ - 1u;
    }
    const std::uint32_t cliff_reference_width_raw =
        static_cast<std::uint32_t>(kCliffReferenceHz / bin_hz);
    const std::uint32_t cliff_reference_width =
        cliff_reference_width_raw < 8u ? 8u : cliff_reference_width_raw;

    double best_ratio = 1.0;
    double best_cliff = 1.0;
    double best_reference = 0.0;
    std::uint32_t best_bin = 0u;
    for (std::uint32_t candidate = first; candidate <= last; ++candidate) {
      double below = 0.0;
      double above = 0.0;
      std::uint32_t occupied = 0u;
      for (std::uint32_t offset = 1u; offset <= half_window; ++offset) {
        below += shared_power_[candidate - offset];
        above += shared_power_[candidate + offset];
      }
      const double average_below = below / static_cast<double>(half_window);
      if (average_below <= 1.0e-12) {
        continue;
      }
      const double occupancy_floor = average_below * 0.08;
      for (std::uint32_t offset = 1u; offset <= half_window; ++offset) {
        if (shared_power_[candidate - offset] > occupancy_floor) {
          ++occupied;
        }
      }
      if (occupied * 4u < half_window) {
        continue;
      }
      double high_side = 0.0;
      std::uint32_t high_side_occupied = 0u;
      const std::uint32_t high_side_start = candidate + half_window;
      const std::uint32_t high_side_count =
          detector_ceiling_bin > high_side_start ? detector_ceiling_bin - high_side_start : 0u;
      for (std::uint32_t bin = high_side_start; bin < detector_ceiling_bin; ++bin) {
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
      const double average_above = above / static_cast<double>(half_window);
      const double ratio = average_below / (average_above + average_below * 1.0e-8 + 1.0e-20);
      if (ratio > best_ratio) {
        best_ratio = ratio;
        best_bin = candidate;
        const std::uint32_t reference_start =
            candidate > cliff_reference_width ? candidate - cliff_reference_width : 1u;
        double reference = 0.0;
        for (std::uint32_t bin = reference_start; bin < candidate; ++bin) {
          reference += shared_power_[bin];
        }
        best_reference = reference / static_cast<double>(candidate - reference_start);
        const double floor_power = high_side_count != 0u ? average_high_side : average_above;
        best_cliff = best_reference / (floor_power + best_reference * 1.0e-8 + 1.0e-20);
      }
    }

    if (best_bin != 0u) {
      const double recovery_target = best_reference * kShoulderRecoveryPower;
      std::uint32_t descent_limit = first + half_window;
      if (best_bin > cliff_reference_width && best_bin - cliff_reference_width > descent_limit) {
        descent_limit = best_bin - cliff_reference_width;
      }
      while (best_bin > descent_limit && windowAverage(best_bin, half_window) < recovery_target) {
        --best_bin;
      }
    }

    double target_confidence = 0.0;
    if (best_bin != 0u) {
      const double cliff_db = 10.0 * std::log10(best_cliff);
      target_confidence = clamp01((cliff_db - 18.0) / 18.0);
    }
    const double confidence_rate = target_confidence > detector_confidence_ ? 0.25 : 0.05;
    detector_confidence_ += (target_confidence - detector_confidence_) * confidence_rate;

    if (best_bin != 0u && target_confidence > 0.05) {
      const std::uint32_t stable_distance =
          static_cast<std::uint32_t>(700.0 * static_cast<double>(fft_size_) / sample_rate_);
      const std::uint32_t difference = best_bin > stable_cutoff_bin_
                                           ? best_bin - stable_cutoff_bin_
                                           : stable_cutoff_bin_ - best_bin;
      if (stable_cutoff_bin_ != 0u && difference <= stable_distance) {
        if (stable_frames_ < 1000u) {
          ++stable_frames_;
        }
        stable_cutoff_bin_ = static_cast<std::uint32_t>(
            0.8 * static_cast<double>(stable_cutoff_bin_) + 0.2 * static_cast<double>(best_bin));
      } else {
        stable_cutoff_bin_ = best_bin;
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

  void updateSourcePhases(std::uint32_t channel_count) noexcept {
    const double expected_scale =
        2.0 * kPi * static_cast<double>(hop_size_) / static_cast<double>(fft_size_);
    for (std::uint32_t component = 0u; component < channel_count; ++component) {
      const std::size_t phase_offset = static_cast<std::size_t>(component) * bin_count_;
      for (std::uint32_t bin = 1u; bin + 1u < bin_count_; ++bin) {
        double real = 0.0;
        double imaginary = 0.0;
        analysisBin(channel_count, component, bin, real, imaginary);
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
  }

  void analysisBin(std::uint32_t channel_count, std::uint32_t component, std::uint32_t bin,
                   double &real, double &imaginary) const noexcept {
    const float *left = spectra_.data();
    const double left_real = static_cast<double>(left[bin * 2u]);
    const double left_imaginary = static_cast<double>(left[bin * 2u + 1u]);
    if (channel_count == 1u) {
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

  double synthesisEnvelope(std::uint32_t bin, std::uint32_t cutoff_bin, std::uint32_t ceiling_bin,
                           double bin_hz) const noexcept {
    const std::uint32_t distance = bin - cutoff_bin;
    const double normalized_distance =
        static_cast<double>(distance) / static_cast<double>(ceiling_bin - cutoff_bin);
    const double generated_band_hz = static_cast<double>(ceiling_bin - cutoff_bin) * bin_hz;
    const double proportional_upper_transition = generated_band_hz * 0.35;
    const double upper_transition_hz = proportional_upper_transition < kUpperTransitionMaximumHz
                                           ? proportional_upper_transition
                                           : kUpperTransitionMaximumHz;
    const double upper_hz = static_cast<double>(ceiling_bin - bin) * bin_hz;
    double upper_fade = upper_hz / upper_transition_hz;
    if (upper_fade > 1.0) {
      upper_fade = 1.0;
    }
    return std::exp(-2.3 * normalized_distance) * upper_fade;
  }

  void generateHarmonics(std::uint32_t channel_count, std::uint32_t cutoff_bin,
                         std::uint32_t ceiling_bin, double bin_hz) noexcept {
    for (std::uint32_t component = 0u; component < channel_count; ++component) {
      float *harmonic_spectrum =
          harmonic_spectra_.data() + static_cast<std::size_t>(component) * fft_size_;
      for (std::uint32_t index = 0u; index < fft_size_; ++index) {
        harmonic_spectrum[index] = 0.0F;
      }
      for (std::uint32_t harmonic = 2u; harmonic <= kMaximumHarmonic; ++harmonic) {
        std::uint32_t source_start = (cutoff_bin + harmonic - 1u) / harmonic;
        std::uint32_t source_end = (ceiling_bin - 1u) / harmonic + 1u;
        if (source_start < 2u) {
          source_start = 2u;
        }
        if (source_end >= bin_count_) {
          source_end = bin_count_ - 1u;
        }
        if (source_start >= source_end) {
          continue;
        }

        double donor_sum = 0.0;
        for (std::uint32_t source_bin = source_start; source_bin < source_end; ++source_bin) {
          double source_real = 0.0;
          double source_imaginary = 0.0;
          analysisBin(channel_count, component, source_bin, source_real, source_imaginary);
          donor_sum += std::sqrt(source_real * source_real + source_imaginary * source_imaginary);
        }
        const double donor_reference = donor_sum / static_cast<double>(source_end - source_start);
        if (donor_reference <= 1.0e-15) {
          continue;
        }

        for (std::uint32_t source_bin = source_start; source_bin < source_end; ++source_bin) {
          double source_real = 0.0;
          double source_imaginary = 0.0;
          double previous_real = 0.0;
          double previous_imaginary = 0.0;
          double next_real = 0.0;
          double next_imaginary = 0.0;
          analysisBin(channel_count, component, source_bin, source_real, source_imaginary);
          analysisBin(channel_count, component, source_bin - 1u, previous_real, previous_imaginary);
          analysisBin(channel_count, component, source_bin + 1u, next_real, next_imaginary);
          const double source_power =
              source_real * source_real + source_imaginary * source_imaginary;
          const double source_magnitude = std::sqrt(source_power);
          const double previous_power =
              previous_real * previous_real + previous_imaginary * previous_imaginary;
          const double next_power = next_real * next_real + next_imaginary * next_imaginary;
          const double peak_weight = tonalPeakWeight(source_magnitude, source_power, previous_power,
                                                     next_power, donor_reference);

          const std::uint32_t target_bin = source_bin * harmonic;
          const double envelope = synthesisEnvelope(target_bin, cutoff_bin, ceiling_bin, bin_hz);
          const std::size_t source_phase_index =
              static_cast<std::size_t>(component) * bin_count_ + source_bin;
          const std::size_t harmonic_phase_index =
              (static_cast<std::size_t>(component) * (kMaximumHarmonic + 1u) + harmonic) *
                  bin_count_ +
              target_bin;
          double target_phase = 0.0;
          bool preserve_mid_side_phase = false;
          std::size_t mid_harmonic_phase_index = 0u;
          if (channel_count == 2u && component == 1u) {
            double mid_real = 0.0;
            double mid_imaginary = 0.0;
            analysisBin(channel_count, 0u, source_bin, mid_real, mid_imaginary);
            const double mid_magnitude =
                std::sqrt(mid_real * mid_real + mid_imaginary * mid_imaginary);
            mid_harmonic_phase_index = static_cast<std::size_t>(harmonic) * bin_count_ + target_bin;
            preserve_mid_side_phase = mid_magnitude > source_magnitude * 1.0e-6 &&
                                      harmonic_phase_valid_[mid_harmonic_phase_index] != 0u;
          }
          if (preserve_mid_side_phase) {
            const std::size_t mid_source_phase_index = source_bin;
            const double relative_phase = wrapPhase(source_phase_[source_phase_index] -
                                                    source_phase_[mid_source_phase_index]);
            target_phase = wrapPhase(harmonic_phase_[mid_harmonic_phase_index] + relative_phase);
            harmonic_phase_[harmonic_phase_index] = target_phase;
            harmonic_phase_valid_[harmonic_phase_index] = 1u;
          } else if (harmonic_phase_valid_[harmonic_phase_index] != 0u) {
            harmonic_phase_[harmonic_phase_index] = wrapPhase(
                harmonic_phase_[harmonic_phase_index] +
                static_cast<double>(harmonic) * source_phase_advance_[source_phase_index]);
            target_phase = harmonic_phase_[harmonic_phase_index];
          } else {
            target_phase =
                wrapPhase(static_cast<double>(harmonic) * source_phase_[source_phase_index]);
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
    }
  }

  void renderWetSpectrum(std::vector<float> &wet_ring, std::uint32_t channel) noexcept {
    synthesis_spectrum_[0] = 0.0F;
    synthesis_spectrum_[1] = 0.0F;
    pffft_transform_ordered(setup_, synthesis_spectrum_.data(), inverse_output_.data(),
                            fft_work_.data(), PFFFT_BACKWARD);
    const double normalization = 1.0 / (2.0 * static_cast<double>(fft_size_));
    const std::size_t ring_offset = static_cast<std::size_t>(channel) * fft_size_;
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const std::uint32_t ring_index = (wet_position_ + index) % fft_size_;
      const double generated = static_cast<double>(inverse_output_[index]) *
                               static_cast<double>(window_[index]) * normalization;
      wet_ring[ring_offset + ring_index] += static_cast<float>(generated);
    }
  }

  void synthesize(std::uint32_t channel_count, double cutoff_hz, double ceiling_hz,
                  bool active) noexcept {
    const double bin_hz = sample_rate_ / static_cast<double>(fft_size_);
    std::uint32_t cutoff_bin = static_cast<std::uint32_t>(std::ceil(cutoff_hz / bin_hz));
    std::uint32_t ceiling_bin = static_cast<std::uint32_t>(ceiling_hz / bin_hz);
    if (ceiling_bin >= bin_count_) {
      ceiling_bin = bin_count_ - 1u;
    }
    if (cutoff_bin < 2u) {
      cutoff_bin = 2u;
    }
    if (cutoff_bin >= ceiling_bin) {
      active = false;
    }

    const std::uint32_t reference_width_raw = static_cast<std::uint32_t>(2000.0 / bin_hz);
    const std::uint32_t reference_width = reference_width_raw < 8u ? 8u : reference_width_raw;
    const std::uint32_t reference_start =
        cutoff_bin > reference_width ? cutoff_bin - reference_width : 1u;
    const std::uint32_t envelope_reference_width_raw =
        static_cast<std::uint32_t>(kEnvelopeReferenceHz / bin_hz);
    const std::uint32_t envelope_reference_width =
        envelope_reference_width_raw < 4u ? 4u : envelope_reference_width_raw;
    const std::uint32_t envelope_reference_start =
        cutoff_bin > envelope_reference_width ? cutoff_bin - envelope_reference_width : 1u;
    const std::uint32_t reference_count = active ? cutoff_bin - reference_start : 0u;
    const std::uint32_t envelope_reference_count =
        active ? cutoff_bin - envelope_reference_start : 0u;
    double envelope_arithmetic = 0.0;
    if (active) {
      for (std::uint32_t bin = envelope_reference_start; bin < cutoff_bin; ++bin) {
        envelope_arithmetic += std::sqrt(shared_power_[bin] + 1.0e-30);
      }
    }
    const double average_magnitude =
        envelope_reference_count == 0u
            ? 0.0
            : envelope_arithmetic / static_cast<double>(envelope_reference_count);

    double mid_reference = 0.0;
    double side_reference = 0.0;
    double mid_side_coherence_real = 0.0;
    double mid_side_coherence_imaginary = 0.0;
    if (active && channel_count == 2u && reference_count != 0u) {
      const float *left_spectrum = spectra_.data();
      const float *right_spectrum = spectra_.data() + fft_size_;
      double mid_energy = 0.0;
      double side_energy = 0.0;
      double cross_real = 0.0;
      double cross_imaginary = 0.0;
      for (std::uint32_t bin = reference_start; bin < cutoff_bin; ++bin) {
        const double left_real = static_cast<double>(left_spectrum[bin * 2u]);
        const double left_imaginary = static_cast<double>(left_spectrum[bin * 2u + 1u]);
        const double right_real = static_cast<double>(right_spectrum[bin * 2u]);
        const double right_imaginary = static_cast<double>(right_spectrum[bin * 2u + 1u]);
        const double mid_real = (left_real + right_real) * kInverseSqrtTwo;
        const double mid_imaginary = (left_imaginary + right_imaginary) * kInverseSqrtTwo;
        const double side_real = (left_real - right_real) * kInverseSqrtTwo;
        const double side_imaginary = (left_imaginary - right_imaginary) * kInverseSqrtTwo;
        mid_energy += mid_real * mid_real + mid_imaginary * mid_imaginary;
        side_energy += side_real * side_real + side_imaginary * side_imaginary;
        cross_real += mid_real * side_real + mid_imaginary * side_imaginary;
        cross_imaginary += mid_imaginary * side_real - mid_real * side_imaginary;
      }
      mid_reference = std::sqrt(mid_energy / static_cast<double>(reference_count));
      side_reference = std::sqrt(side_energy / static_cast<double>(reference_count));
      const double spatial_reference =
          std::sqrt((mid_reference * mid_reference + side_reference * side_reference) * 0.5);
      const double envelope_scale =
          spatial_reference > 1.0e-15 ? average_magnitude / spatial_reference : 0.0;
      mid_reference *= envelope_scale;
      side_reference *= envelope_scale;
      const double coherence_denominator = std::sqrt(mid_energy * side_energy);
      if (coherence_denominator > 1.0e-20) {
        mid_side_coherence_real = cross_real / coherence_denominator;
        mid_side_coherence_imaginary = cross_imaginary / coherence_denominator;
        const double coherence_power = mid_side_coherence_real * mid_side_coherence_real +
                                       mid_side_coherence_imaginary * mid_side_coherence_imaginary;
        if (coherence_power > 1.0) {
          const double coherence_scale = 1.0 / std::sqrt(coherence_power);
          mid_side_coherence_real *= coherence_scale;
          mid_side_coherence_imaginary *= coherence_scale;
        }
      }
    }

    if (active && average_magnitude > 1.0e-15) {
      for (std::uint32_t bin = cutoff_bin; bin < ceiling_bin; ++bin) {
        const double mid_phase = mid_random_.nextFloat01() * 2.0 * kPi;
        noise_cos_[bin] = static_cast<float>(std::cos(mid_phase));
        noise_sin_[bin] = static_cast<float>(std::sin(mid_phase));
        if (channel_count == 2u) {
          const double side_phase = side_random_.nextFloat01() * 2.0 * kPi;
          secondary_noise_cos_[bin] = static_cast<float>(std::cos(side_phase));
          secondary_noise_sin_[bin] = static_cast<float>(std::sin(side_phase));
        }
      }
    }
    if (active) {
      generateHarmonics(channel_count, cutoff_bin, ceiling_bin, bin_hz);
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      for (float &value : synthesis_spectrum_) {
        value = 0.0F;
      }
      if (active) {
        for (std::uint32_t bin = cutoff_bin; bin < ceiling_bin; ++bin) {
          if (channel_count == 1u) {
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
      renderWetSpectrum(harmonic_wet_ring_, channel);

      for (float &value : synthesis_spectrum_) {
        value = 0.0F;
      }
      if (active) {
        double channel_reference = 0.0;
        if (channel_count == 1u) {
          const float *source_spectrum = spectra_.data();
          for (std::uint32_t bin = envelope_reference_start; bin < cutoff_bin; ++bin) {
            const double real = static_cast<double>(source_spectrum[bin * 2u]);
            const double imaginary = static_cast<double>(source_spectrum[bin * 2u + 1u]);
            channel_reference += std::sqrt(real * real + imaginary * imaginary);
          }
          channel_reference /= static_cast<double>(envelope_reference_count);
        }
        for (std::uint32_t bin = cutoff_bin; bin < ceiling_bin; ++bin) {
          const double envelope = synthesisEnvelope(bin, cutoff_bin, ceiling_bin, bin_hz);
          const double mid_real = static_cast<double>(noise_cos_[bin]);
          const double mid_imaginary = static_cast<double>(noise_sin_[bin]);
          double noise_real = 0.0;
          double noise_imaginary = 0.0;
          if (channel_count == 1u) {
            const double noise_magnitude = channel_reference * envelope;
            noise_real = mid_real * noise_magnitude;
            noise_imaginary = mid_imaginary * noise_magnitude;
          } else {
            const double independent_real = static_cast<double>(secondary_noise_cos_[bin]);
            const double independent_imaginary = static_cast<double>(secondary_noise_sin_[bin]);
            double coherence_power = mid_side_coherence_real * mid_side_coherence_real +
                                     mid_side_coherence_imaginary * mid_side_coherence_imaginary;
            if (coherence_power > 1.0) {
              coherence_power = 1.0;
            }
            const double independent_weight = std::sqrt(1.0 - coherence_power);
            const double side_unit_real = mid_side_coherence_real * mid_real +
                                          mid_side_coherence_imaginary * mid_imaginary +
                                          independent_weight * independent_real;
            const double side_unit_imaginary = mid_side_coherence_real * mid_imaginary -
                                               mid_side_coherence_imaginary * mid_real +
                                               independent_weight * independent_imaginary;
            const double shaped_mid_real = mid_real * mid_reference * envelope;
            const double shaped_mid_imaginary = mid_imaginary * mid_reference * envelope;
            const double shaped_side_real = side_unit_real * side_reference * envelope;
            const double shaped_side_imaginary = side_unit_imaginary * side_reference * envelope;
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
      renderWetSpectrum(noise_wet_ring_, channel);
    }
  }

  PFFFT_Setup *setup_ = nullptr;
  double sample_rate_ = 0.0;
  double component_smoothing_ = 0.0;
  double harmonic_amount_smoothed_ = 0.0;
  double noise_amount_smoothed_ = 0.0;
  double detected_cutoff_hz_ = 16000.0;
  double detector_confidence_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t fft_size_ = 0u;
  std::uint32_t hop_size_ = 0u;
  std::uint32_t bin_count_ = 0u;
  std::uint32_t input_position_ = 0u;
  std::uint32_t dry_position_ = 0u;
  std::uint32_t wet_position_ = 0u;
  std::uint32_t samples_since_frame_ = 0u;
  std::uint64_t samples_received_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t stable_frames_ = 0u;
  std::uint32_t stable_cutoff_bin_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool prepared_ = false;
  bool detector_active_ = false;
  std::vector<float> input_ring_;
  std::vector<float> dry_ring_;
  std::vector<float> harmonic_wet_ring_;
  std::vector<float> noise_wet_ring_;
  std::vector<float> spectra_;
  std::vector<float> window_;
  std::vector<float> fft_input_;
  std::vector<float> fft_work_;
  std::vector<float> inverse_output_;
  std::vector<float> synthesis_spectrum_;
  std::vector<float> harmonic_spectra_;
  std::vector<double> shared_power_;
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

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(BandwidthExtenderPlugin,
                         effetune::plugins::saturation::BandwidthExtenderKernel)

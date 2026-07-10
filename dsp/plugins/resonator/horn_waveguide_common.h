#ifndef EFFETUNE_PLUGINS_RESONATOR_HORN_WAVEGUIDE_COMMON_H
#define EFFETUNE_PLUGINS_RESONATOR_HORN_WAVEGUIDE_COMMON_H

#include "effetune/dsp/linkwitz_riley.h"
#include "effetune/kernel.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <numbers>
#include <vector>

namespace effetune::plugins::resonator::horn_waveguide {

constexpr double kSpeedOfSound = 343.0;
constexpr double kAirImpedance = 413.0;
constexpr double kEpsilon = 1.0e-9;
constexpr double kMaximumLengthMeters = 1.2;

enum class Variant {
  Base,
  Plus,
};

struct Parameters final {
  float crossover = 600.0F;
  float length = 70.0F;
  float throatDiameter = 3.0F;
  float mouthDiameter = 60.0F;
  float curve = 40.0F;
  float damping = 0.03F;
  float throatReflection = 0.99F;
  float waveguideGain = 30.0F;
};

template <typename ParamsType>
[[nodiscard]] Parameters fromGeneratedParams(const ParamsType &params) noexcept {
  return {params.crossover, params.length,  params.throatDiameter,   params.mouthDiameter,
          params.curve,     params.damping, params.throatReflection, params.waveguideGain};
}

[[nodiscard]] inline std::uint32_t segmentCount(double sample_rate, double length_meters) noexcept {
  if (!std::isfinite(sample_rate) || sample_rate <= 0.0 || !std::isfinite(length_meters) ||
      length_meters <= 0.0) {
    return 1u;
  }
  const double rounded = std::round(length_meters * sample_rate / kSpeedOfSound);
  return rounded < 1.0 ? 1u : static_cast<std::uint32_t>(rounded);
}

class Processor final {
public:
  void prepare(const PrepareInfo &info) {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    max_segments_ = segmentCount(sample_rate_, kMaximumLengthMeters);
    const std::size_t wave_stride = static_cast<std::size_t>(max_segments_) + 1u;

    impedance_.resize(wave_stride);
    reflections_.resize(max_segments_);
    forward_.resize(static_cast<std::size_t>(max_channels_) * wave_stride);
    reverse_.resize(static_cast<std::size_t>(max_channels_) * wave_stride);
    forward_temp_.resize(wave_stride);
    reverse_temp_.resize(wave_stride);
    low_delay_.resize(static_cast<std::size_t>(max_channels_) * max_segments_);
    low_delay_indices_.resize(max_channels_);
    mouth_x1_.resize(max_channels_);
    mouth_y1_.resize(max_channels_);
    mouth_y2_.resize(max_channels_);
    throat_y1_.resize(max_channels_);
    lowpass_states_.resize(max_channels_);
    highpass_states_.resize(max_channels_);
    reset();
  }

  void reset() noexcept {
    clearFloatBuffer(impedance_);
    clearFloatBuffer(reflections_);
    clearHistory();
    configured_ = false;
    channel_count_ = 0u;
    segment_count_ = 1u;
  }

  template <Variant BoundaryVariant>
  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const Parameters &params) noexcept {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    if (configurationChanged(params, channel_count) &&
        !configure<BoundaryVariant>(params, channel_count)) {
      return;
    }

    const std::uint32_t sections = segment_count_;
    const std::size_t wave_stride = static_cast<std::size_t>(max_segments_) + 1u;
    const double output_gain = std::pow(10.0, static_cast<double>(params.waveguideGain) / 20.0);

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      float *forward = forward_.data() + static_cast<std::size_t>(channel) * wave_stride;
      float *reverse = reverse_.data() + static_cast<std::size_t>(channel) * wave_stride;
      float *delay = low_delay_.data() + static_cast<std::size_t>(channel) * max_segments_;
      std::uint32_t delay_index = low_delay_indices_[channel];
      double mouth_x1 = static_cast<double>(mouth_x1_[channel]);
      double mouth_y1 = static_cast<double>(mouth_y1_[channel]);
      double mouth_y2 = static_cast<double>(mouth_y2_[channel]);
      double throat_y1 = static_cast<double>(throat_y1_[channel]);
      dsp::LinkwitzRiley24State &low_state = lowpass_states_[channel];
      dsp::LinkwitzRiley24State &high_state = highpass_states_[channel];
      float *channel_audio = audio + static_cast<std::size_t>(channel) * frame_count;

      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double input = static_cast<double>(channel_audio[frame]);
        const double output_low =
            dsp::processLinkwitzRiley24Sample(input, crossover_coefficients_.lowpass, low_state);
        const double output_high =
            dsp::processLinkwitzRiley24Sample(input, crossover_coefficients_.highpass, high_state);

        for (std::uint32_t section = 0u; section < sections; ++section) {
          const double reflection = static_cast<double>(reflections_[section]);
          const double forward_in = static_cast<double>(forward[section]);
          const double reverse_in = static_cast<double>(reverse[section + 1u]);
          const double scatter_difference = reflection * (forward_in - reverse_in);
          forward_temp_[section + 1u] =
              static_cast<float>(damping_gain_ * (forward_in + scatter_difference));
          reverse_temp_[section] =
              static_cast<float>(damping_gain_ * (reverse_in + scatter_difference));
        }

        const double mouth_forward = static_cast<double>(forward_temp_[sections]);
        double reflected_mouth = 0.0;
        if constexpr (BoundaryVariant == Variant::Base) {
          reflected_mouth = mouth_b0_ * mouth_forward - mouth_a1_ * mouth_y1;
          mouth_x1 = mouth_forward;
          mouth_y1 = reflected_mouth;
          forward_temp_[0u] = static_cast<float>(
              output_high + throat_reflection_ * static_cast<double>(reverse_temp_[0u]));
        } else {
          reflected_mouth = mouth_b0_ * mouth_forward - mouth_a1_ * mouth_y1 - mouth_a2_ * mouth_y2;
          mouth_y2 = mouth_y1;
          mouth_y1 = reflected_mouth;
          const double filtered_throat =
              throat_b0_ * static_cast<double>(reverse_temp_[0u]) - throat_a1_ * throat_y1;
          throat_y1 = filtered_throat;
          forward_temp_[0u] =
              static_cast<float>(output_high + throat_reflection_ * filtered_throat);
        }
        reverse_temp_[sections] = static_cast<float>(reflected_mouth);

        for (std::uint32_t section = 0u; section <= sections; ++section) {
          forward[section] = forward_temp_[section];
          reverse[section] = reverse_temp_[section];
        }

        const double delayed_low = static_cast<double>(delay[delay_index]);
        delay[delay_index] = static_cast<float>(output_low);
        ++delay_index;
        if (delay_index >= sections)
          delay_index = 0u;

        const double transmitted_high = mouth_forward + reflected_mouth;
        channel_audio[frame] = static_cast<float>(transmitted_high * output_gain + delayed_low);
      }

      mouth_x1_[channel] = static_cast<float>(mouth_x1);
      mouth_y1_[channel] = static_cast<float>(mouth_y1);
      mouth_y2_[channel] = static_cast<float>(mouth_y2);
      throat_y1_[channel] = static_cast<float>(throat_y1);
      low_delay_indices_[channel] = delay_index;
    }
  }

  [[nodiscard]] std::uint32_t maximumSegments() const noexcept { return max_segments_; }

private:
  [[nodiscard]] bool configurationChanged(const Parameters &params,
                                          std::uint32_t channel_count) const noexcept {
    return !configured_ || channel_count_ != channel_count ||
           configured_params_.crossover != params.crossover ||
           configured_params_.length != params.length ||
           configured_params_.throatDiameter != params.throatDiameter ||
           configured_params_.mouthDiameter != params.mouthDiameter ||
           configured_params_.curve != params.curve ||
           configured_params_.damping != params.damping ||
           configured_params_.throatReflection != params.throatReflection;
  }

  template <Variant BoundaryVariant>
  [[nodiscard]] bool configure(const Parameters &params, std::uint32_t channel_count) noexcept {
    const double length_meters = static_cast<double>(params.length) / 100.0;
    const std::uint32_t sections = segmentCount(sample_rate_, length_meters);
    if (sections == 0u || sections > max_segments_)
      return false;

    const double spatial_step = kSpeedOfSound / sample_rate_;
    const double curve_exponent = std::pow(10.0, static_cast<double>(params.curve) / 100.0);
    const double throat_radius = static_cast<double>(params.throatDiameter) / 200.0;
    const double mouth_radius = static_cast<double>(params.mouthDiameter) / 200.0;

    for (std::uint32_t section = 0u; section <= sections; ++section) {
      double radius = 0.0;
      if (section == 0u) {
        radius = throat_radius;
      } else if (section == sections) {
        radius = mouth_radius;
      } else {
        radius = throat_radius +
                 (mouth_radius - throat_radius) *
                     std::pow(static_cast<double>(section) / static_cast<double>(sections),
                              curve_exponent);
      }
      const double radius_squared = radius * radius;
      const double bounded_radius_squared = radius_squared < kEpsilon ? kEpsilon : radius_squared;
      impedance_[section] =
          static_cast<float>(kAirImpedance / (std::numbers::pi_v<double> * bounded_radius_squared));
    }
    for (std::uint32_t section = 0u; section < sections; ++section) {
      const double left = static_cast<double>(impedance_[section]);
      const double right = static_cast<double>(impedance_[section + 1u]);
      const double sum = left + right;
      reflections_[section] = static_cast<float>(sum < kEpsilon ? 0.0 : (right - left) / sum);
    }

    damping_gain_ = std::pow(10.0, -static_cast<double>(params.damping) * spatial_step / 20.0);
    throat_reflection_ = static_cast<double>(params.throatReflection);
    designBoundary<BoundaryVariant>(throat_radius, mouth_radius);
    designCrossover(static_cast<double>(params.crossover));
    clearHistory();

    configured_params_ = params;
    channel_count_ = channel_count;
    segment_count_ = sections;
    configured_ = true;
    return true;
  }

  template <Variant BoundaryVariant>
  void designBoundary(double throat_radius, double mouth_radius) noexcept {
    const double two_pi = 2.0 * std::numbers::pi_v<double>;
    const double mouth_cutoff =
        mouth_radius > kEpsilon ? kSpeedOfSound / (two_pi * mouth_radius) : sample_rate_ / 4.0;
    const double mouth_limit = sample_rate_ * 0.45;
    const double bounded_mouth_cutoff = mouth_cutoff < mouth_limit ? mouth_cutoff : mouth_limit;
    const double mouth_pole = 0.99 * std::exp(-two_pi * bounded_mouth_cutoff / sample_rate_);

    if constexpr (BoundaryVariant == Variant::Base) {
      mouth_b0_ = -(1.0 - mouth_pole);
      mouth_a1_ = -mouth_pole;
      mouth_a2_ = 0.0;
      throat_b0_ = 1.0;
      throat_a1_ = 0.0;
    } else {
      mouth_a1_ = -2.0 * mouth_pole;
      mouth_a2_ = mouth_pole * mouth_pole;
      mouth_b0_ = -1.0 - mouth_a1_ - mouth_a2_;

      const double throat_cutoff =
          throat_radius > kEpsilon ? kSpeedOfSound / (two_pi * throat_radius) : sample_rate_ / 4.0;
      const double bounded_throat_cutoff =
          throat_cutoff < mouth_limit ? throat_cutoff : mouth_limit;
      const double throat_pole = 0.99 * std::exp(-two_pi * bounded_throat_cutoff / sample_rate_);
      throat_b0_ = 1.0 - throat_pole;
      throat_a1_ = -throat_pole;
    }
  }

  void designCrossover(double requested_crossover) noexcept {
    const double maximum = sample_rate_ * 0.5 - 1.0;
    double crossover = requested_crossover > maximum ? maximum : requested_crossover;
    if (crossover < 20.0)
      crossover = 20.0;
    const double omega = std::tan(crossover * std::numbers::pi_v<double> / sample_rate_);
    const double omega_squared = omega * omega;
    const double butterworth = std::numbers::sqrt2_v<double> * omega;
    const double denominator = omega_squared + butterworth + 1.0;
    const double inverse = denominator < kEpsilon ? 1.0 : 1.0 / denominator;

    dsp::BiquadCoefficients &lowpass = crossover_coefficients_.lowpass;
    lowpass.b0 = omega_squared * inverse;
    lowpass.b1 = 2.0 * lowpass.b0;
    lowpass.b2 = lowpass.b0;
    lowpass.a1 = 2.0 * (omega_squared - 1.0) * inverse;
    lowpass.a2 = (omega_squared - butterworth + 1.0) * inverse;

    dsp::BiquadCoefficients &highpass = crossover_coefficients_.highpass;
    highpass.b0 = inverse;
    highpass.b1 = -2.0 * highpass.b0;
    highpass.b2 = highpass.b0;
    highpass.a1 = lowpass.a1;
    highpass.a2 = lowpass.a2;
  }

  static void clearFloatBuffer(std::vector<float> &buffer) noexcept {
    for (float &value : buffer)
      value = 0.0F;
  }

  void clearHistory() noexcept {
    clearFloatBuffer(forward_);
    clearFloatBuffer(reverse_);
    clearFloatBuffer(forward_temp_);
    clearFloatBuffer(reverse_temp_);
    clearFloatBuffer(low_delay_);
    clearFloatBuffer(mouth_x1_);
    clearFloatBuffer(mouth_y1_);
    clearFloatBuffer(mouth_y2_);
    clearFloatBuffer(throat_y1_);
    for (std::uint32_t &index : low_delay_indices_)
      index = 0u;
    for (dsp::LinkwitzRiley24State &state : lowpass_states_) {
      dsp::resetLinkwitzRiley24State(state, dsp::LinkwitzRileyStateStorage::Float64);
    }
    for (dsp::LinkwitzRiley24State &state : highpass_states_) {
      dsp::resetLinkwitzRiley24State(state, dsp::LinkwitzRileyStateStorage::Float64);
    }
  }

  Parameters configured_params_{};
  dsp::LinkwitzRiley24Coefficients crossover_coefficients_{};
  std::vector<float> impedance_;
  std::vector<float> reflections_;
  std::vector<float> forward_;
  std::vector<float> reverse_;
  std::vector<float> forward_temp_;
  std::vector<float> reverse_temp_;
  std::vector<float> low_delay_;
  std::vector<std::uint32_t> low_delay_indices_;
  std::vector<float> mouth_x1_;
  std::vector<float> mouth_y1_;
  std::vector<float> mouth_y2_;
  std::vector<float> throat_y1_;
  std::vector<dsp::LinkwitzRiley24State> lowpass_states_;
  std::vector<dsp::LinkwitzRiley24State> highpass_states_;
  double sample_rate_ = 0.0;
  double damping_gain_ = 1.0;
  double throat_reflection_ = 0.0;
  double mouth_b0_ = 0.0;
  double mouth_a1_ = 0.0;
  double mouth_a2_ = 0.0;
  double throat_b0_ = 0.0;
  double throat_a1_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t max_segments_ = 1u;
  std::uint32_t channel_count_ = 0u;
  std::uint32_t segment_count_ = 1u;
  bool configured_ = false;
};

} // namespace effetune::plugins::resonator::horn_waveguide

#endif

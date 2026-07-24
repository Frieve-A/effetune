#include "effetune/kernel.h"
#include "VinylSimulatorPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTwoPi = 2.0 * kPi;
constexpr double kSqrtHalf = 0.70710678118654752440;
constexpr double kSqrtThree = 1.73205080756887729353;
constexpr double kReferenceVelocity = 0.05;
// The source model's discharge range was calibrated against program peaks at +12 dB.
constexpr double kStaticReferenceGain = 0.251188643150958;
// An ESD edge is much faster than the audio rate. Its audible residual is limited here
// by the longest RC decay in a standard 47 kOhm / 100-200 pF moving-magnet input.
constexpr double kPhonoInputResistance = 47.0e3;
constexpr double kPhonoInputCapacitance = 200.0e-12;
constexpr double kStaticDecaySeconds = kPhonoInputResistance * kPhonoInputCapacitance;
constexpr double kStaticLifetimeSeconds = 12.0 * kStaticDecaySeconds;
constexpr double kCutDisplacementLimit = 25.0e-6;
constexpr double kRoughStep = 50.0e-9;
constexpr double kCorrelationFine = 0.15e-6;
constexpr double kCorrelationMid = 2.0e-6;
constexpr double kCorrelationWave = 30.0e-6;
constexpr double kPatchHalfWidth = 2.5e-6;
constexpr double kPvcEffectiveYoung = 3.0e9 / (1.0 - 0.4 * 0.4);
constexpr double kGrooveHalfWidth = 30.0e-6;
constexpr double kGrooveDepth = 30.0e-6;
constexpr double kMaximumPenetration = 5.0e-6;
constexpr double kRiaaT1 = 3180.0e-6;
constexpr double kRiaaT2 = 318.0e-6;
constexpr double kRiaaT3 = 75.0e-6;
constexpr double kRiaaT4 = 3.18e-6;
constexpr double kMinimumGrooveSpeed = kTwoPi * 0.060 * ((100.0 / 3.0) / 60.0);
constexpr double kMaximumScanRadius = 25.0e-6;
constexpr std::uint32_t kSignalLength = 1u << 15u;
constexpr std::uint32_t kSignalMask = kSignalLength - 1u;
constexpr std::uint32_t kRoughLength = 1u << 18u;
constexpr std::uint32_t kRoughMask = kRoughLength - 1u;
constexpr std::uint32_t kMaximumScanPoints = 25u;
constexpr std::uint32_t kMaximumDust = 176u;
constexpr std::uint32_t kDustTopPoints = 49u;
constexpr std::uint32_t kMaximumStaticPops = 16u;
constexpr std::uint32_t kPreferredDustCount = 128u;
constexpr std::uint32_t kContactStepsPerCycle = 8u;
constexpr std::uint8_t kDustKindFlake = 0u;
constexpr std::uint8_t kDustKindFiber = 1u;
constexpr std::uint8_t kDustKindGrit = 2u;
constexpr std::uint16_t kTelemetryFrameType = 15u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint16_t kTelemetryPayloadBytes = 48u;

struct Biquad final {
  double b0 = 1.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
  double z1 = 0.0;
  double z2 = 0.0;

  void reset() noexcept {
    z1 = 0.0;
    z2 = 0.0;
  }

  double process(double input) noexcept {
    const double output = b0 * input + z1;
    z1 = b1 * input - a1 * output + z2;
    z2 = b2 * input - a2 * output;
    return output;
  }
};

struct FirstOrder final {
  double b0 = 1.0;
  double b1 = 0.0;
  double a1 = 0.0;
  double x1 = 0.0;
  double y1 = 0.0;

  void configure(double zero_time, double pole_time, double sample_rate) noexcept {
    const double k = 2.0 * sample_rate;
    const double inverse_a0 = 1.0 / (1.0 + k * pole_time);
    b0 = (1.0 + k * zero_time) * inverse_a0;
    b1 = (1.0 - k * zero_time) * inverse_a0;
    a1 = (1.0 - k * pole_time) * inverse_a0;
  }

  void reset() noexcept {
    x1 = 0.0;
    y1 = 0.0;
  }

  double process(double input) noexcept {
    const double output = b0 * input + b1 * x1 - a1 * y1;
    x1 = input;
    y1 = output;
    return output;
  }
};

struct RiaaFilter final {
  FirstOrder first;
  FirstOrder second;
  double gain = 1.0;

  void configure(bool playback, double sample_rate) noexcept {
    if (playback) {
      first.configure(kRiaaT2, kRiaaT1, sample_rate);
      second.configure(kRiaaT4, kRiaaT3, sample_rate);
    } else {
      first.configure(kRiaaT1, kRiaaT2, sample_rate);
      second.configure(kRiaaT3, kRiaaT4, sample_rate);
    }
    const auto magnitude = [](double zero_time, double pole_time) noexcept {
      const double omega = kTwoPi * 1000.0;
      return std::sqrt((1.0 + omega * omega * zero_time * zero_time) /
                       (1.0 + omega * omega * pole_time * pole_time));
    };
    const double recording_gain = magnitude(kRiaaT1, kRiaaT2) * magnitude(kRiaaT3, kRiaaT4);
    gain = playback ? recording_gain : 1.0 / recording_gain;
  }

  void reset() noexcept {
    first.reset();
    second.reset();
  }

  double process(double input) noexcept { return second.process(first.process(input)) * gain; }
};

struct DustParticle final {
  bool active = false;
  bool scratch = false;
  bool touched = false;
  bool counted = false;
  bool dying = false;
  bool capacity_dying = false;
  std::uint64_t order = 0u;
  std::uint8_t wall = 0u;
  std::uint8_t kind = 0u;
  std::uint8_t scratch_kind = 0u;
  double center = 0.0;
  double width = 1.0e-6;
  double height = 0.0;
  double felt_height = 0.0;
  double lateral_half = 0.0;
  double land_x = 0.0;
  double residual = 0.15;
  double yield_depth = 0.5e-6;
  double amplitude = 0.0;
  double amplitude_rate = 1.0;
  double gouge = 0.0;
  double burr = 0.0;
  double wall_left = 1.0;
  double wall_right = 1.0;
  double skew = 0.0;
  double lip_offset = 0.9;
  double lip_width = 0.32;
  double gouge_width = 1.0;
  double lip_lead = 0.5;
  double lip_trail = 0.5;
  double scratch_support = 4.0e-6;
  std::array<float, kDustTopPoints> top{};
  bool top_initialized = false;
};

struct StaticPop final {
  bool active = false;
  double time = 0.0;
  double amplitude = 0.0;
};

struct SmoothedControls final {
  double cut_scale = kReferenceVelocity;
  double side_mix = 0.7;
  double groove_speed = kTwoPi * 0.120 * ((100.0 / 3.0) / 60.0);
  double rough_sigma = 13.17e-9;
  double dust_rate = 2.0;
  double static_rate = 0.08;
  double scratch_rate = 0.0;
  double side_radius = 18.0e-6;
  double scan_radius = 8.0e-6;
  double tracking_force = 2.0e-3 * 9.80665;
  double tip_mass = 0.4e-6;
  double compliance = 15.0e-3;
  double damping = 0.25;
  double hf_cutoff = 16000.0;
  double bass_mono_below = 250.0;
  double output_gain = 1.0;
  double mix = 1.0;
};

struct ContactResult final {
  double integral = 0.0;
  double delta = -1.0;
  double centroid = 0.0;
};

struct ContactPair final {
  ContactResult left;
  ContactResult right;
};

struct ContactSegmentIntegral final {
  double area = 0.0;
  double first_moment = 0.0;
};

ContactSegmentIntegral integratePositiveLinearSegment(double left, double right, double step,
                                                      bool calculate_first_moment) noexcept {
  ContactSegmentIntegral result;
  if (left <= 0.0 && right <= 0.0) {
    return result;
  }
  if (left > 0.0 && right > 0.0) {
    result.area = 0.5 * (left + right) * step;
    if (calculate_first_moment) {
      result.first_moment = step * step * (left + 2.0 * right) / 6.0;
    }
    return result;
  }
  if (left > 0.0) {
    const double positive_length = step * left / (left - right);
    result.area = 0.5 * left * positive_length;
    if (calculate_first_moment) {
      result.first_moment = result.area * positive_length / 3.0;
    }
    return result;
  }
  const double positive_length = step * right / (right - left);
  result.area = 0.5 * right * positive_length;
  if (calculate_first_moment) {
    result.first_moment = result.area * (step - positive_length / 3.0);
  }
  return result;
}

ContactSegmentIntegral integrateClippedLinearSegment(double left, double right, double step,
                                                     bool calculate_first_moment) noexcept {
  // clamp(p, 0, limit) = max(p, 0) - max(p - limit, 0) for a linear segment.
  ContactSegmentIntegral result =
      integratePositiveLinearSegment(left, right, step, calculate_first_moment);
  if (left > kMaximumPenetration || right > kMaximumPenetration) {
    const ContactSegmentIntegral excess = integratePositiveLinearSegment(
        left - kMaximumPenetration, right - kMaximumPenetration, step, calculate_first_moment);
    result.area -= excess.area;
    result.first_moment -= excess.first_moment;
  }
  return result;
}

struct StereoValue final {
  double left = 0.0;
  double right = 0.0;
};

struct StereoSample final {
  float left = 0.0F;
  float right = 0.0F;
};

struct PhysicsCoefficients final {
  double foundation;
  double spring;
  double cantilever_damping;
};

struct ScanGeometry final {
  std::array<double, kMaximumScanPoints> offsets;
  std::array<double, kMaximumScanPoints> curves;
  std::array<double, kMaximumScanPoints> signal_offsets;
  std::array<double, kMaximumScanPoints> rough_grid_offsets;
};

void writeU32(std::uint8_t *output, std::uint32_t value) noexcept {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>((value >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((value >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>(value >> 24u);
}

void writeF32(std::uint8_t *output, float value) noexcept {
  std::uint32_t bits = 0u;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&bits, &value, sizeof(bits));
  writeU32(output, bits);
}

double rpmFromIndex(float index) noexcept {
  const int selected = static_cast<int>(index + 0.5F);
  if (selected == 1) {
    return 45.0;
  }
  if (selected >= 2) {
    return 78.0;
  }
  return 100.0 / 3.0;
}

void configureLowPass(Biquad &filter, double frequency, double q, double sample_rate) noexcept {
  double bounded = frequency;
  const double maximum = sample_rate * 0.45;
  if (bounded > maximum) {
    bounded = maximum;
  }
  const double omega = kTwoPi * bounded / sample_rate;
  const double cosine = std::cos(omega);
  const double sine = std::sin(omega);
  const double alpha = sine / (2.0 * q);
  const double inverse_a0 = 1.0 / (1.0 + alpha);
  const double half = (1.0 - cosine) * 0.5;
  filter.b0 = half * inverse_a0;
  filter.b1 = (1.0 - cosine) * inverse_a0;
  filter.b2 = filter.b0;
  filter.a1 = -2.0 * cosine * inverse_a0;
  filter.a2 = (1.0 - alpha) * inverse_a0;
}

void configureHighPass(Biquad &filter, double frequency, double q, double sample_rate) noexcept {
  const double omega = kTwoPi * frequency / sample_rate;
  const double cosine = std::cos(omega);
  const double sine = std::sin(omega);
  const double alpha = sine / (2.0 * q);
  const double inverse_a0 = 1.0 / (1.0 + alpha);
  const double half = (1.0 + cosine) * 0.5;
  filter.b0 = half * inverse_a0;
  filter.b1 = -(1.0 + cosine) * inverse_a0;
  filter.b2 = filter.b0;
  filter.a1 = -2.0 * cosine * inverse_a0;
  filter.a2 = (1.0 - alpha) * inverse_a0;
}

double fastTanh(double input) noexcept {
  if (input >= 3.0) {
    return 1.0;
  }
  if (input <= -3.0) {
    return -1.0;
  }
  const double squared = input * input;
  return input * (27.0 + squared) / (27.0 + 9.0 * squared);
}

double softClipDisplacement(double input) noexcept {
  const double normalized = input / kCutDisplacementLimit;
  const double absolute = normalized < 0.0 ? -normalized : normalized;
  if (absolute <= 0.7) {
    return input;
  }
  const double sign = normalized < 0.0 ? -1.0 : 1.0;
  return sign * kCutDisplacementLimit * (0.7 + 0.3 * fastTanh((absolute - 0.7) / 0.3));
}

} // namespace

class VinylSimulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::VinylSimulatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    const double latency = std::ceil(kMaximumScanRadius * sample_rate_ / kMinimumGrooveSpeed) + 4.0;
    latency_samples_ = latency > 1.0 ? static_cast<std::uint32_t>(latency) : 1u;

    signal_.resize(kSignalLength);
    rough_.resize(kRoughLength);
    dry_left_.resize(static_cast<std::size_t>(latency_samples_) + 1u);
    dry_right_.resize(static_cast<std::size_t>(latency_samples_) + 1u);
    dust_.resize(kMaximumDust);

    configureFixedFilters();
    reset();
  }

  void reset() noexcept override {
    resetSimulation();
    last_quality_ = -1;
    last_shape_ = -1;
    last_pair_channels_ = 0u;
    initialized_ = false;
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    seedRandomStreams();
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override { return latency_samples_; }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    const std::uint32_t pair_channels = channel_count >= 2u ? 2u : 1u;
    int quality = static_cast<int>(params_.quality + 0.5F);
    if (quality < 0) {
      quality = 0;
    } else if (quality > 3) {
      quality = 3;
    }
    int shape = static_cast<int>(params_.stylusShape + 0.5F);
    shape = shape == 0 ? 0 : 1;
    if (!initialized_ || quality != last_quality_ || shape != last_shape_ ||
        pair_channels != last_pair_channels_) {
      resetSimulation();
      last_quality_ = quality;
      last_shape_ = shape;
      last_pair_channels_ = pair_channels;
      initialized_ = true;
    }

    updateControlTargets(shape);
    updateControlRateFilters();
    configureQuality(quality);
    const double smoothing = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.020));
    const double meter_alpha = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.100));
    const double inverse_sample_rate = 1.0 / sample_rate_;
    const double inverse_substeps = 1.0 / static_cast<double>(substeps_);
    const double dt = inverse_sample_rate * inverse_substeps;

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      smoothControls(smoothing);
      const std::size_t left_index = frame;
      const std::size_t right_index = pair_channels == 2u ? frame_count + frame : frame;
      const double input_left = static_cast<double>(audio[left_index]);
      const double input_right = static_cast<double>(audio[right_index]);

      dry_left_[dry_position_] = static_cast<float>(input_left);
      dry_right_[dry_position_] = static_cast<float>(input_right);
      double dry_left = 0.0;
      double dry_right = 0.0;
      if (sample_counter_ >= latency_samples_) {
        const std::uint32_t delayed_position =
            dry_position_ + 1u == dry_left_.size() ? 0u : dry_position_ + 1u;
        dry_left = static_cast<double>(dry_left_[delayed_position]);
        dry_right = static_cast<double>(dry_right_[delayed_position]);
      }

      cutInput(input_left, input_right);
      const double read_sample =
          static_cast<double>(sample_counter_) - static_cast<double>(latency_samples_);
      const double next_s = groove_position_ + controls_.groove_speed * inverse_sample_rate;
      ensureRoughness(next_s + scan_half_ + kRoughStep * 4.0);

      double accumulated_left = 0.0;
      double accumulated_right = 0.0;
      const double effective_radius =
          last_shape_ == 0 ? controls_.side_radius
                           : std::sqrt(controls_.side_radius * controls_.scan_radius);
      PhysicsCoefficients physics;
      physics.foundation =
          (kPvcEffectiveYoung * kSqrtHalf) * std::sqrt(effective_radius / controls_.scan_radius);
      physics.spring = 1.0 / controls_.compliance;
      physics.cantilever_damping =
          2.0 * controls_.damping * std::sqrt(physics.spring * controls_.tip_mass);
      ScanGeometry scan;
      const double inverse_curve = 1.0 / (2.0 * controls_.scan_radius);
      const double samples_per_meter = sample_rate_ / controls_.groove_speed;
      for (std::uint32_t point = 0u; point < scan_points_; ++point) {
        const double offset = -scan_half_ + static_cast<double>(point) * scan_step_;
        scan.offsets[point] = offset;
        scan.curves[point] = offset * offset * inverse_curve;
        scan.signal_offsets[point] = offset * samples_per_meter;
        scan.rough_grid_offsets[point] = offset / kRoughStep;
      }
      for (std::uint32_t substep = 0u; substep < substeps_; ++substep) {
        const double fraction = static_cast<double>(substep + 1u) * inverse_substeps;
        const double center_sample = read_sample - 1.0 + fraction;
        stepPhysics(center_sample, controls_.groove_speed * dt, dt, substep + 1u == substeps_,
                    physics, scan, accumulated_left, accumulated_right);
      }
      groove_position_ = next_s;

      const double pickup_left = accumulated_left * inverse_substeps;
      const double pickup_right = accumulated_right * inverse_substeps;
      const double de_left = playback_riaa_left_.process(pickup_left);
      const double de_right = playback_riaa_right_.process(pickup_right);
      const double inverse_cut_scale =
          controls_.cut_scale > 1.0e-12 ? 1.0 / controls_.cut_scale : 0.0;
      double wet_left = de_left * inverse_cut_scale * controls_.output_gain;
      double wet_right = de_right * inverse_cut_scale * controls_.output_gain;
      if (!std::isfinite(wet_left) || !std::isfinite(wet_right)) {
        reseatStylus();
        wet_left = 0.0;
        wet_right = 0.0;
      }
      const double dry_gain = 1.0 - controls_.mix;
      audio[left_index] = static_cast<float>(dry_gain * dry_left + controls_.mix * wet_left);
      if (pair_channels == 2u) {
        audio[right_index] = static_cast<float>(dry_gain * dry_right + controls_.mix * wet_right);
      }

      const StereoValue ideal = centerSignalPair(read_sample);
      updateStatistics(ideal.left, ideal.right, pickup_left, pickup_right, meter_alpha);
      advanceDefects(inverse_sample_rate);
      ++dry_position_;
      if (dry_position_ == dry_left_.size()) {
        dry_position_ = 0u;
      }
      ++sample_counter_;
    }
    telemetry_available_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!telemetry_available_) {
      return;
    }
    std::array<std::uint8_t, kTelemetryPayloadBytes> payload{};
    writeF32(payload.data(), static_cast<float>(meter_force_left_));
    writeF32(payload.data() + 4u, static_cast<float>(meter_force_right_));
    writeF32(payload.data() + 8u, static_cast<float>(meter_pressure_left_));
    writeF32(payload.data() + 12u, static_cast<float>(meter_pressure_right_));
    writeF32(payload.data() + 16u, static_cast<float>(std::sqrt(meter_tip_velocity_squared_)));
    writeF32(payload.data() + 20u,
             static_cast<float>(trackingRatioDb(signal_power_left_, error_power_left_)));
    writeF32(payload.data() + 24u,
             static_cast<float>(trackingRatioDb(signal_power_right_, error_power_right_)));
    writeF32(payload.data() + 28u, static_cast<float>(std::sqrt(meter_jitter_variance_ns2_)));
    writeU32(payload.data() + 32u, mistrack_count_);
    writeU32(payload.data() + 36u, skip_count_);
    writeU32(payload.data() + 40u, pop_count_);
    writeU32(payload.data() + 44u, dust_hit_count_);
    writer.write(kTelemetryFrameType, kTelemetryVersion, payload.data(),
                 static_cast<std::uint16_t>(payload.size()));
  }

private:
  void configureFixedFilters() noexcept {
    recording_riaa_left_.configure(false, sample_rate_);
    recording_riaa_right_.configure(false, sample_rate_);
    playback_riaa_left_.configure(true, sample_rate_);
    playback_riaa_right_.configure(true, sample_rate_);
    leaky_integrator_coefficient_ = std::exp(-kTwoPi * 5.0 / sample_rate_);
    rough_a_fine_ = std::exp(-kRoughStep / kCorrelationFine);
    rough_a_mid_ = std::exp(-kRoughStep / kCorrelationMid);
    rough_a_wave_ = std::exp(-kRoughStep / kCorrelationWave);
    rough_gain_fine_unit_ = std::sqrt(0.60 * (1.0 - rough_a_fine_ * rough_a_fine_));
    rough_gain_mid_unit_ = std::sqrt(0.30 * (1.0 - rough_a_mid_ * rough_a_mid_));
    rough_gain_wave_unit_ = std::sqrt(0.10 * (1.0 - rough_a_wave_ * rough_a_wave_));
    rough_k_fine_ = std::sqrt(kCorrelationFine / (kCorrelationFine + kPatchHalfWidth));
    rough_k_mid_ = std::sqrt(kCorrelationMid / (kCorrelationMid + kPatchHalfWidth));
    rough_k_wave_ = std::sqrt(kCorrelationWave / (kCorrelationWave + kPatchHalfWidth));
  }

  void updateControlRateFilters() noexcept {
    configureHighPass(rumble_mid_, 20.0, 0.7071, sample_rate_);
    configureHighPass(rumble_side_, 20.0, 0.7071, sample_rate_);
    configureHighPass(side_high_pass_, controls_.bass_mono_below, 0.7071, sample_rate_);
    configureLowPass(hf_left_first_, controls_.hf_cutoff, 0.5412, sample_rate_);
    configureLowPass(hf_left_second_, controls_.hf_cutoff, 1.3066, sample_rate_);
    configureLowPass(hf_right_first_, controls_.hf_cutoff, 0.5412, sample_rate_);
    configureLowPass(hf_right_second_, controls_.hf_cutoff, 1.3066, sample_rate_);
  }

  void updateControlTargets(int shape) noexcept {
    targets_.cut_scale =
        kReferenceVelocity * std::pow(10.0, static_cast<double>(params_.cutLevel) / 20.0);
    targets_.side_mix = static_cast<double>(params_.sideMix) * 0.01;
    targets_.groove_speed = kTwoPi * (static_cast<double>(params_.radius) * 1.0e-3) *
                            (rpmFromIndex(params_.speed) / 60.0);
    targets_.rough_sigma = static_cast<double>(params_.roughness) * 1.0e-9;
    targets_.dust_rate = static_cast<double>(params_.dustRate);
    targets_.static_rate = static_cast<double>(params_.staticRate);
    targets_.scratch_rate = static_cast<double>(params_.scratchRate);
    targets_.side_radius = static_cast<double>(params_.sideRadius) * 1.0e-6;
    targets_.scan_radius =
        shape == 0 ? targets_.side_radius : static_cast<double>(params_.scanRadius) * 1.0e-6;
    targets_.tracking_force = static_cast<double>(params_.trackingForce) * 1.0e-3 * 9.80665;
    targets_.tip_mass = static_cast<double>(params_.tipMass) * 1.0e-6;
    targets_.compliance = static_cast<double>(params_.compliance) * 1.0e-3;
    targets_.damping = static_cast<double>(params_.damping);
    targets_.hf_cutoff = static_cast<double>(params_.hfCutoff);
    targets_.bass_mono_below = static_cast<double>(params_.bassMonoBelow);
    targets_.output_gain = std::pow(10.0, static_cast<double>(params_.outputGain) / 20.0);
    targets_.mix = static_cast<double>(params_.mix) * 0.01;
    if (!controls_initialized_) {
      controls_ = targets_;
      controls_initialized_ = true;
      reseatStylus();
    }
  }

  void smoothControls(double amount) noexcept {
    const auto smooth = [amount](double &value, double target) noexcept {
      value += amount * (target - value);
    };
    smooth(controls_.cut_scale, targets_.cut_scale);
    smooth(controls_.side_mix, targets_.side_mix);
    smooth(controls_.groove_speed, targets_.groove_speed);
    smooth(controls_.rough_sigma, targets_.rough_sigma);
    smooth(controls_.dust_rate, targets_.dust_rate);
    smooth(controls_.static_rate, targets_.static_rate);
    smooth(controls_.scratch_rate, targets_.scratch_rate);
    smooth(controls_.side_radius, targets_.side_radius);
    smooth(controls_.scan_radius, targets_.scan_radius);
    smooth(controls_.tracking_force, targets_.tracking_force);
    smooth(controls_.tip_mass, targets_.tip_mass);
    smooth(controls_.compliance, targets_.compliance);
    smooth(controls_.damping, targets_.damping);
    smooth(controls_.hf_cutoff, targets_.hf_cutoff);
    smooth(controls_.bass_mono_below, targets_.bass_mono_below);
    smooth(controls_.output_gain, targets_.output_gain);
    smooth(controls_.mix, targets_.mix);
    scan_half_ = 0.8 * controls_.scan_radius;
    scan_step_ =
        scan_points_ > 1u ? (2.0 * scan_half_) / static_cast<double>(scan_points_ - 1u) : 0.0;
  }

  std::uint32_t minimumPhysicsSubsteps() const noexcept {
    const double tip_mass =
        controls_.tip_mass < targets_.tip_mass ? controls_.tip_mass : targets_.tip_mass;
    const double tracking_force = controls_.tracking_force > targets_.tracking_force
                                      ? controls_.tracking_force
                                      : targets_.tracking_force;
    const double compliance =
        controls_.compliance < targets_.compliance ? controls_.compliance : targets_.compliance;
    const double control_radius = last_shape_ == 0
                                      ? controls_.side_radius
                                      : std::sqrt(controls_.side_radius * controls_.scan_radius);
    const double target_radius = last_shape_ == 0
                                     ? targets_.side_radius
                                     : std::sqrt(targets_.side_radius * targets_.scan_radius);
    const double effective_radius = control_radius > target_radius ? control_radius : target_radius;
    const double hertz = (4.0 / 3.0) * kPvcEffectiveYoung * std::sqrt(effective_radius);
    const double indentation = std::pow(tracking_force * kSqrtHalf / hertz, 2.0 / 3.0);
    const double contact_stiffness = 1.5 * hertz * std::sqrt(indentation);
    const double resonance_hz =
        std::sqrt((contact_stiffness + 1.0 / compliance) / tip_mass) / kTwoPi;
    return static_cast<std::uint32_t>(
        std::ceil(static_cast<double>(kContactStepsPerCycle) * resonance_hz / sample_rate_));
  }

  void configureQuality(int quality) noexcept {
    if (quality == 0) {
      substeps_ = 2u;
      scan_points_ = 7u;
    } else if (quality == 1) {
      substeps_ = 4u;
      scan_points_ = 9u;
    } else if (quality == 2) {
      substeps_ = 8u;
      scan_points_ = 13u;
    } else {
      substeps_ = 20u;
      scan_points_ = kMaximumScanPoints;
    }
    const std::uint32_t minimum = minimumPhysicsSubsteps();
    if (substeps_ < minimum) {
      substeps_ = minimum;
    }
  }

  void cutInput(double left, double right) noexcept {
    double mid = (left + right) * kSqrtHalf;
    double side = (left - right) * kSqrtHalf;
    mid = rumble_mid_.process(mid);
    side = rumble_side_.process(side);
    const double high_side = side_high_pass_.process(side);
    side = controls_.side_mix * side + (1.0 - controls_.side_mix) * high_side;
    double cut_left = (mid + side) * kSqrtHalf;
    double cut_right = (mid - side) * kSqrtHalf;
    cut_left = hf_left_second_.process(hf_left_first_.process(cut_left));
    cut_right = hf_right_second_.process(hf_right_first_.process(cut_right));
    const double velocity_left = recording_riaa_left_.process(cut_left * controls_.cut_scale);
    const double velocity_right = recording_riaa_right_.process(cut_right * controls_.cut_scale);
    integrator_left_ =
        leaky_integrator_coefficient_ * integrator_left_ + velocity_left / sample_rate_;
    integrator_right_ =
        leaky_integrator_coefficient_ * integrator_right_ + velocity_right / sample_rate_;
    const std::uint32_t position = static_cast<std::uint32_t>(sample_counter_) & kSignalMask;
    signal_[position].left = static_cast<float>(softClipDisplacement(integrator_left_));
    signal_[position].right = static_cast<float>(-softClipDisplacement(integrator_right_));
  }

  double centerSignal(std::uint32_t wall, double sample_position) const noexcept {
    if (sample_position < 0.0) {
      return 0.0;
    }
    const std::int64_t base = static_cast<std::int64_t>(std::floor(sample_position));
    const double fraction = sample_position - static_cast<double>(base);
    const auto read = [this, wall](std::int64_t index) noexcept {
      if (index < 0) {
        return 0.0;
      }
      const StereoSample &sample = signal_[static_cast<std::uint32_t>(index) & kSignalMask];
      return static_cast<double>(wall == 0u ? sample.left : sample.right);
    };
    const double p0 = read(base - 1);
    const double p1 = read(base);
    const double p2 = read(base + 1);
    const double p3 = read(base + 2);
    return p1 + 0.5 * fraction *
                    (p2 - p0 +
                     fraction * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 +
                                 fraction * (3.0 * (p1 - p2) + p3 - p0)));
  }

  StereoValue centerSignalPair(double sample_position) const noexcept {
    StereoValue result;
    if (sample_position < 0.0) {
      return result;
    }
    const std::int64_t base = static_cast<std::int64_t>(std::floor(sample_position));
    const double fraction = sample_position - static_cast<double>(base);
    const auto read = [this](std::int64_t index) noexcept {
      return index < 0 ? StereoSample{} : signal_[static_cast<std::uint32_t>(index) & kSignalMask];
    };
    const StereoSample p0 = read(base - 1);
    const StereoSample p1 = read(base);
    const StereoSample p2 = read(base + 1);
    const StereoSample p3 = read(base + 2);
    const auto interpolate = [fraction](double v0, double v1, double v2, double v3) noexcept {
      return v1 + 0.5 * fraction *
                      (v2 - v0 +
                       fraction * (2.0 * v0 - 5.0 * v1 + 4.0 * v2 - v3 +
                                   fraction * (3.0 * (v1 - v2) + v3 - v0)));
    };
    result.left = interpolate(p0.left, p1.left, p2.left, p3.left);
    result.right = interpolate(p0.right, p1.right, p2.right, p3.right);
    return result;
  }

  void ensureRoughness(double maximum_s) noexcept {
    std::int64_t target = static_cast<std::int64_t>(std::ceil(maximum_s / kRoughStep)) + 2;
    if (target < 0) {
      return;
    }
    const double sigma = controls_.rough_sigma;
    const double gain_fine = sigma * rough_gain_fine_unit_;
    const double gain_mid = sigma * rough_gain_mid_unit_;
    const double gain_wave = sigma * rough_gain_wave_unit_;
    while (rough_index_ < target) {
      ++rough_index_;
      rough_fine_left_ = rough_a_fine_ * rough_fine_left_ +
                         gain_fine * kSqrtThree * rough_random_.nextFloatSigned();
      rough_fine_right_ = rough_a_fine_ * rough_fine_right_ +
                          gain_fine * kSqrtThree * rough_random_.nextFloatSigned();
      rough_mid_left_ =
          rough_a_mid_ * rough_mid_left_ + gain_mid * kSqrtThree * rough_random_.nextFloatSigned();
      rough_mid_right_ =
          rough_a_mid_ * rough_mid_right_ + gain_mid * kSqrtThree * rough_random_.nextFloatSigned();
      rough_wave_left_ = rough_a_wave_ * rough_wave_left_ +
                         gain_wave * kSqrtThree * rough_random_.nextFloatSigned();
      rough_wave_right_ = rough_a_wave_ * rough_wave_right_ +
                          gain_wave * kSqrtThree * rough_random_.nextFloatSigned();
      const std::uint32_t position = static_cast<std::uint32_t>(rough_index_) & kRoughMask;
      rough_[position].left =
          static_cast<float>(rough_k_fine_ * rough_fine_left_ + rough_k_mid_ * rough_mid_left_ +
                             rough_k_wave_ * rough_wave_left_);
      rough_[position].right =
          static_cast<float>(rough_k_fine_ * rough_fine_right_ + rough_k_mid_ * rough_mid_right_ +
                             rough_k_wave_ * rough_wave_right_);
    }
  }

  double roughShift(std::uint32_t wall, double position) const noexcept {
    if (position <= 0.0) {
      return 0.0;
    }
    const double grid = position / kRoughStep;
    const std::int64_t base = static_cast<std::int64_t>(std::floor(grid));
    const double fraction = grid - static_cast<double>(base);
    const StereoSample &first_sample = rough_[static_cast<std::uint32_t>(base) & kRoughMask];
    const StereoSample &second_sample = rough_[static_cast<std::uint32_t>(base + 1) & kRoughMask];
    const double first = static_cast<double>(wall == 0u ? first_sample.left : first_sample.right);
    const double second =
        static_cast<double>(wall == 0u ? second_sample.left : second_sample.right);
    return first + fraction * (second - first);
  }

  StereoValue roughShiftPair(double grid) const noexcept {
    StereoValue result;
    if (grid <= 0.0) {
      return result;
    }
    const std::int64_t base = static_cast<std::int64_t>(std::floor(grid));
    const double fraction = grid - static_cast<double>(base);
    const std::uint32_t first_index = static_cast<std::uint32_t>(base) & kRoughMask;
    const std::uint32_t second_index = static_cast<std::uint32_t>(base + 1) & kRoughMask;
    const StereoSample &first = rough_[first_index];
    const StereoSample &second = rough_[second_index];
    const double left_first = static_cast<double>(first.left);
    const double left_second = static_cast<double>(second.left);
    const double right_first = static_cast<double>(first.right);
    const double right_second = static_cast<double>(second.right);
    result.left = left_first + fraction * (left_second - left_first);
    result.right = right_first + fraction * (right_second - right_first);
    return result;
  }

  StereoValue defectShiftPair(double position) const noexcept {
    StereoValue result;
    for (std::uint32_t active = 0u; active < active_dust_count_; ++active) {
      const DustParticle &particle = dust_[active_dust_[active]];
      if (particle.scratch) {
        const auto scratch_height = [&particle, position](std::uint32_t wall) noexcept {
          const double wall_skew = wall == 0u ? -particle.skew : particle.skew;
          const double u = (position - particle.center - wall_skew) / particle.width;
          if (u > 4.0 || u < -4.0) {
            return 0.0;
          }
          const double gouge_u = u / particle.gouge_width;
          const double gaussian = std::exp(-gouge_u * gouge_u);
          const double lead_u = (u + particle.lip_offset) / particle.lip_width;
          const double trail_u = (u - particle.lip_offset) / particle.lip_width;
          const double wall_gain = wall == 0u ? particle.wall_left : particle.wall_right;
          return wall_gain * particle.amplitude *
                 (-particle.gouge * gaussian +
                  particle.burr * (particle.lip_lead * std::exp(-lead_u * lead_u) +
                                   particle.lip_trail * std::exp(-trail_u * trail_u)));
        };
        result.left += scratch_height(0u);
        result.right += scratch_height(1u);
        continue;
      }
      const double u = (position - particle.center) / particle.width;
      if (u > 4.0 || u < -4.0) {
        continue;
      }
      double height = particle.felt_height * particle.amplitude * std::exp(-u * u);
      if (particle.top_initialized) {
        const double top_position = (u + 4.0) * static_cast<double>(kDustTopPoints - 1u) / 8.0;
        std::uint32_t top_index = static_cast<std::uint32_t>(std::floor(top_position));
        if (top_index > kDustTopPoints - 2u) {
          top_index = kDustTopPoints - 2u;
        }
        const double top_fraction = top_position - static_cast<double>(top_index);
        const double cap = static_cast<double>(particle.top[top_index]) * (1.0 - top_fraction) +
                           static_cast<double>(particle.top[top_index + 1u]) * top_fraction;
        if (cap < height) {
          height = cap;
        }
      }
      if (particle.wall == 0u || particle.wall == 3u) {
        result.left += height;
      }
      if (particle.wall == 1u || particle.wall == 3u) {
        result.right += height;
      }
    }
    return result;
  }

  ContactPair wallContactPair(double distance_left, double distance_right, double center_sample,
                              bool calculate_centroid, const ScanGeometry &scan) const noexcept {
    ContactPair result;
    const double base_left = controls_.side_radius - distance_left;
    const double base_right = controls_.side_radius - distance_right;
    double area_left = 0.0;
    double area_right = 0.0;
    double first_moment_left = 0.0;
    double first_moment_right = 0.0;
    double previous_penetration_left = 0.0;
    double previous_penetration_right = 0.0;
    double previous_offset = 0.0;
    std::int64_t cached_signal_base = std::numeric_limits<std::int64_t>::min();
    std::array<double, 4u> left_coefficients{};
    std::array<double, 4u> right_coefficients{};
    const bool has_active_defects = active_dust_count_ != 0u;
    const double groove_grid = groove_position_ / kRoughStep;
    for (std::uint32_t point = 0u; point < scan_points_; ++point) {
      const double offset = scan.offsets[point];
      const double signal_position = center_sample + scan.signal_offsets[point];
      StereoValue signal;
      if (signal_position >= 0.0) {
        const std::int64_t signal_base = static_cast<std::int64_t>(std::floor(signal_position));
        if (signal_base != cached_signal_base) {
          cached_signal_base = signal_base;
          const auto load = [this, signal_base](std::int64_t relative) noexcept {
            const std::int64_t index = signal_base + relative;
            return index < 0 ? StereoSample{}
                             : signal_[static_cast<std::uint32_t>(index) & kSignalMask];
          };
          const StereoSample p0 = load(-1);
          const StereoSample p1 = load(0);
          const StereoSample p2 = load(1);
          const StereoSample p3 = load(2);
          const auto set_coefficients = [](double v0, double v1, double v2, double v3,
                                           std::array<double, 4u> &coefficients) noexcept {
            coefficients[0] = v1;
            coefficients[1] = 0.5 * (v2 - v0);
            coefficients[2] = 0.5 * (2.0 * v0 - 5.0 * v1 + 4.0 * v2 - v3);
            coefficients[3] = 0.5 * (3.0 * (v1 - v2) + v3 - v0);
          };
          set_coefficients(p0.left, p1.left, p2.left, p3.left, left_coefficients);
          set_coefficients(p0.right, p1.right, p2.right, p3.right, right_coefficients);
        }
        const double fraction = signal_position - static_cast<double>(signal_base);
        const auto evaluate = [fraction](const std::array<double, 4u> &coefficients) noexcept {
          return ((coefficients[3] * fraction + coefficients[2]) * fraction + coefficients[1]) *
                     fraction +
                 coefficients[0];
        };
        signal.left = evaluate(left_coefficients);
        signal.right = evaluate(right_coefficients);
      }
      const StereoValue rough = roughShiftPair(groove_grid + scan.rough_grid_offsets[point]);
      StereoValue defect;
      if (has_active_defects) {
        defect = defectShiftPair(groove_position_ + offset);
      }
      const double penetration_left =
          base_left + signal.left + rough.left + defect.left - scan.curves[point];
      const double penetration_right =
          base_right + signal.right + rough.right + defect.right - scan.curves[point];
      if (penetration_left > result.left.delta) {
        result.left.delta = penetration_left;
      }
      if (penetration_right > result.right.delta) {
        result.right.delta = penetration_right;
      }
      if (point != 0u) {
        const ContactSegmentIntegral left_segment = integrateClippedLinearSegment(
            previous_penetration_left, penetration_left, scan_step_, calculate_centroid);
        const ContactSegmentIntegral right_segment = integrateClippedLinearSegment(
            previous_penetration_right, penetration_right, scan_step_, calculate_centroid);
        area_left += left_segment.area;
        area_right += right_segment.area;
        if (calculate_centroid) {
          first_moment_left += previous_offset * left_segment.area + left_segment.first_moment;
          first_moment_right += previous_offset * right_segment.area + right_segment.first_moment;
        }
      }
      previous_penetration_left = penetration_left;
      previous_penetration_right = penetration_right;
      previous_offset = offset;
    }
    result.left.integral = area_left;
    result.right.integral = area_right;
    if (calculate_centroid) {
      result.left.centroid = area_left > 0.0 ? first_moment_left / area_left : 0.0;
      result.right.centroid = area_right > 0.0 ? first_moment_right / area_right : 0.0;
    }
    return result;
  }

  void crushDust(std::uint32_t wall, double center_sample, double base) noexcept {
    for (std::uint32_t active = 0u; active < active_dust_count_; ++active) {
      DustParticle &particle = dust_[active_dust_[active]];
      if (particle.scratch || (particle.wall != wall && particle.wall != 3u)) {
        continue;
      }
      const double first_position = particle.center - 4.0 * particle.width;
      const double point_step = 8.0 * particle.width / static_cast<double>(kDustTopPoints - 1u);
      std::int32_t first_point = static_cast<std::int32_t>(
          std::ceil((groove_position_ - scan_half_ - first_position) / point_step));
      std::int32_t last_point = static_cast<std::int32_t>(
          std::floor((groove_position_ + scan_half_ - first_position) / point_step));
      if (first_point < 0) {
        first_point = 0;
      }
      if (last_point > static_cast<std::int32_t>(kDustTopPoints - 1u)) {
        last_point = static_cast<std::int32_t>(kDustTopPoints - 1u);
      }
      for (std::int32_t point = first_point; point <= last_point; ++point) {
        const double position = first_position + static_cast<double>(point) * point_step;
        const double normalized = (position - particle.center) / particle.width;
        const double full_height =
            particle.felt_height * particle.amplitude * std::exp(-normalized * normalized);
        const double top = particle.top_initialized
                               ? static_cast<double>(particle.top[static_cast<std::size_t>(point)])
                               : full_height;
        const double existing = top < full_height ? top : full_height;
        if (existing <= 0.0) {
          continue;
        }
        const double offset = position - groove_position_;
        const double ball_height =
            offset * offset / (2.0 * controls_.scan_radius) - base -
            centerSignal(wall, center_sample + offset * sample_rate_ / controls_.groove_speed) -
            roughShift(wall, position);
        if (existing > ball_height) {
          particle.touched = true;
        }
        double allowed = ball_height + particle.yield_depth;
        const double floor_height = particle.residual * full_height;
        if (allowed < floor_height) {
          allowed = floor_height;
        }
        if (allowed < existing) {
          if (!particle.top_initialized) {
            particle.top.fill(std::numeric_limits<float>::infinity());
            particle.top_initialized = true;
          }
          particle.top[static_cast<std::size_t>(point)] = static_cast<float>(allowed);
        }
      }
    }
  }

  void stepPhysics(double center_sample, double spatial_step, double dt, bool collect_metrics,
                   const PhysicsCoefficients &physics, const ScanGeometry &scan,
                   double &output_left, double &output_right) noexcept {
    groove_position_ += spatial_step;
    simulation_time_ += dt;
    const double distance_left = (tip_x_ + tip_y_) * kSqrtHalf;
    const double distance_right = (-tip_x_ + tip_y_) * kSqrtHalf;
    if (active_dust_count_ != 0u) {
      crushDust(0u, center_sample, controls_.side_radius - distance_left);
      crushDust(1u, center_sample, controls_.side_radius - distance_right);
    }
    const ContactPair contact =
        wallContactPair(distance_left, distance_right, center_sample, collect_metrics, scan);
    const ContactResult &left = contact.left;
    const ContactResult &right = contact.right;
    if (!contact_initialized_) {
      previous_integral_left_ = left.integral;
      previous_integral_right_ = right.integral;
      contact_initialized_ = true;
    }
    double force_left = physics.foundation *
                        (left.integral + 2.0e-6 * (left.integral - previous_integral_left_) / dt);
    double force_right =
        physics.foundation *
        (right.integral + 2.0e-6 * (right.integral - previous_integral_right_) / dt);
    previous_integral_left_ = left.integral;
    previous_integral_right_ = right.integral;
    if (force_left < 0.0 || left.integral <= 0.0) {
      force_left = 0.0;
    }
    if (force_right < 0.0 || right.integral <= 0.0) {
      force_right = 0.0;
    }
    if (force_left > 0.25) {
      force_left = 0.25;
    }
    if (force_right > 0.25) {
      force_right = 0.25;
    }

    const double spring_x =
        physics.spring * (arm_x_ - tip_x_) + physics.cantilever_damping * (arm_vx_ - tip_vx_);
    const double spring_y =
        physics.spring * (arm_y_ - tip_y_) + physics.cantilever_damping * (arm_vy_ - tip_vy_);
    const double force_x = (force_left - force_right) * kSqrtHalf + spring_x;
    const double force_y = (force_left + force_right) * kSqrtHalf + spring_y;
    tip_vx_ += force_x * dt / controls_.tip_mass;
    tip_vy_ += force_y * dt / controls_.tip_mass;
    tip_x_ += tip_vx_ * dt;
    tip_y_ += tip_vy_ * dt;

    constexpr double arm_mass = 0.012;
    constexpr double arm_damping = 0.5;
    arm_vx_ += (-spring_x - arm_damping * arm_vx_) * dt / arm_mass;
    arm_vy_ += (-spring_y - controls_.tracking_force - arm_damping * arm_vy_) * dt / arm_mass;
    arm_x_ += arm_vx_ * dt;
    arm_y_ += arm_vy_ * dt;

    const bool contact_loss = left.delta <= 0.0 || right.delta <= 0.0;
    if (contact_loss) {
      contact_loss_time_ += dt;
      if (!in_loss_episode_ && contact_loss_time_ > 30.0e-6) {
        in_loss_episode_ = true;
        ++mistrack_count_;
      }
    } else {
      contact_loss_time_ = 0.0;
      in_loss_episode_ = false;
    }
    if (skip_holdoff_ > 0.0) {
      skip_holdoff_ -= dt;
    }
    const double absolute_x = tip_x_ < 0.0 ? -tip_x_ : tip_x_;
    if (tip_y_ - controls_.side_radius > kGrooveDepth + 6.0e-6 ||
        absolute_x > kGrooveHalfWidth * 2.0 || !std::isfinite(tip_x_) || !std::isfinite(tip_y_)) {
      if (skip_holdoff_ <= 0.0) {
        ++skip_count_;
        skip_holdoff_ = 1.5e-3;
      }
      reseatStylus();
    }

    if (controls_.static_rate > 0.0 && static_random_.nextFloat01() < controls_.static_rate * dt) {
      spawnStaticPop();
    }
    double pickup_left = (tip_vx_ + tip_vy_) * kSqrtHalf;
    double pickup_right = (tip_vx_ - tip_vy_) * kSqrtHalf;
    if (active_static_pop_count_ != 0u) {
      for (StaticPop &pop : static_pops_) {
        if (!pop.active) {
          continue;
        }
        const double age = simulation_time_ - pop.time;
        if (age > kStaticLifetimeSeconds) {
          pop.active = false;
          --active_static_pop_count_;
          continue;
        }
        const double pulse = pop.amplitude * std::exp(-age / kStaticDecaySeconds);
        pickup_left += pulse;
        pickup_right += pulse;
      }
    }
    output_left += pickup_left;
    output_right += pickup_right;

    if (collect_metrics) {
      latest_force_left_ = force_left;
      latest_force_right_ = force_right;
      latest_pressure_left_ =
          left.delta > 0.0 ? force_left / (kPi * controls_.side_radius * left.delta) : 0.0;
      latest_pressure_right_ =
          right.delta > 0.0 ? force_right / (kPi * controls_.side_radius * right.delta) : 0.0;
      latest_jitter_ns_ = 0.5 * (left.centroid + right.centroid) / controls_.groove_speed * 1.0e9;
    }
  }

  void reseatStylus() noexcept {
    const double side_radius = controls_.side_radius > 1.0e-9 ? controls_.side_radius : 18.0e-6;
    const double scan_radius = controls_.scan_radius > 1.0e-9 ? controls_.scan_radius : 8.0e-6;
    const double tracking_force =
        controls_.tracking_force > 1.0e-6 ? controls_.tracking_force : 2.0e-3 * 9.80665;
    const double compliance = controls_.compliance > 1.0e-6 ? controls_.compliance : 15.0e-3;
    const double effective_radius =
        last_shape_ == 0 ? side_radius : std::sqrt(side_radius * scan_radius);
    const double hertz = (4.0 / 3.0) * kPvcEffectiveYoung * std::sqrt(effective_radius);
    const double normal_force = tracking_force * kSqrtHalf;
    const double indentation = std::pow(normal_force / hertz, 2.0 / 3.0);
    tip_x_ = 0.0;
    tip_y_ = (side_radius - indentation) / kSqrtHalf;
    tip_vx_ = 0.0;
    tip_vy_ = 0.0;
    arm_x_ = 0.0;
    arm_y_ = tip_y_ - tracking_force * compliance;
    arm_vx_ = 0.0;
    arm_vy_ = 0.0;
    rest_y_ = tip_y_;
    contact_initialized_ = false;
  }

  void updateStatistics(double ideal_left, double ideal_right, double pickup_left,
                        double pickup_right, double alpha) noexcept {
    const double ideal_x = (ideal_left - ideal_right) * kSqrtHalf;
    const double ideal_y = rest_y_ + (ideal_left + ideal_right) * kSqrtHalf;
    const double error_x = tip_x_ - ideal_x;
    const double error_y = tip_y_ - ideal_y;
    const double error_left = (error_x + error_y) * kSqrtHalf;
    const double error_right = (error_x - error_y) * kSqrtHalf;
    signal_power_left_ += alpha * (ideal_left * ideal_left - signal_power_left_);
    signal_power_right_ += alpha * (ideal_right * ideal_right - signal_power_right_);
    error_power_left_ += alpha * (error_left * error_left - error_power_left_);
    error_power_right_ += alpha * (error_right * error_right - error_power_right_);
    const double pickup_power = 0.5 * (pickup_left * pickup_left + pickup_right * pickup_right);
    meter_tip_velocity_squared_ += alpha * (pickup_power - meter_tip_velocity_squared_);
    meter_force_left_ += alpha * (latest_force_left_ - meter_force_left_);
    meter_force_right_ += alpha * (latest_force_right_ - meter_force_right_);
    meter_pressure_left_ += alpha * (latest_pressure_left_ - meter_pressure_left_);
    meter_pressure_right_ += alpha * (latest_pressure_right_ - meter_pressure_right_);
    const double jitter_delta = latest_jitter_ns_ - meter_jitter_mean_ns_;
    meter_jitter_mean_ns_ += alpha * jitter_delta;
    meter_jitter_variance_ns2_ +=
        alpha * (jitter_delta * jitter_delta - meter_jitter_variance_ns2_);
  }

  static double trackingRatioDb(double signal_power, double error_power) noexcept {
    if (signal_power <= 1.0e-30 && error_power <= 1.0e-30) {
      return 0.0;
    }
    const double ratio = 10.0 * std::log10((signal_power + 1.0e-30) / (error_power + 1.0e-30));
    if (ratio > 120.0) {
      return 120.0;
    }
    if (ratio < -120.0) {
      return -120.0;
    }
    return ratio;
  }

  DustParticle *allocateDust() noexcept {
    DustParticle *oldest = nullptr;
    for (DustParticle &particle : dust_) {
      if (!particle.active) {
        particle = {};
        particle.active = true;
        particle.order = next_dust_order_++;
        ++dust_population_;
        return &particle;
      }
      if (oldest == nullptr || particle.order < oldest->order) {
        oldest = &particle;
      }
    }
    if (oldest != nullptr) {
      *oldest = {};
      oldest->active = true;
      oldest->order = next_dust_order_++;
    }
    return oldest;
  }

  void spawnDust() noexcept {
    DustParticle *particle = allocateDust();
    if (particle == nullptr) {
      return;
    }
    const double ahead_limit = controls_.groove_speed * 2.5;
    double ahead = ahead_limit < 400.0e-6 ? ahead_limit : 400.0e-6;
    if (ahead < 16.0e-6) {
      ahead = 16.0e-6;
    }
    particle->center = groove_position_ + ahead * (0.5 + dust_random_.nextFloat01());
    particle->amplitude_rate =
        controls_.groove_speed / (0.25 * (particle->center - groove_position_));
    const double kind = dust_random_.nextFloat01();
    if (kind < 0.55) {
      particle->kind = kDustKindFlake;
      particle->height = 1.5e-6 * std::exp(0.8 * dustGaussian());
      if (particle->height < 0.3e-6) {
        particle->height = 0.3e-6;
      } else if (particle->height > 12.0e-6) {
        particle->height = 12.0e-6;
      }
      particle->width = particle->height * (0.7 + 1.6 * dust_random_.nextFloat01());
      particle->yield_depth = 0.5e-6;
      particle->residual = 0.15;
    } else if (kind < 0.85) {
      particle->kind = kDustKindFiber;
      particle->height = (1.0 + 2.0 * dust_random_.nextFloat01()) * 1.0e-6;
      const double length = (10.0 + 30.0 * dust_random_.nextFloat01()) * 1.0e-6;
      const double angle = dust_random_.nextFloat01() * kPi / 2.0;
      const double longitudinal = 0.5 * length * std::cos(angle);
      particle->width = particle->height > longitudinal ? particle->height : longitudinal;
      const double lateral = length * std::sin(angle);
      particle->lateral_half = (particle->height > lateral ? particle->height : lateral) / 2.0;
      particle->yield_depth = 0.2e-6;
      particle->residual = 0.10;
    } else {
      particle->kind = kDustKindGrit;
      particle->height = 2.0e-6 * std::exp(0.6 * dustGaussian());
      if (particle->height < 0.5e-6) {
        particle->height = 0.5e-6;
      } else if (particle->height > 6.0e-6) {
        particle->height = 6.0e-6;
      }
      particle->width = particle->height * (0.8 + 0.6 * dust_random_.nextFloat01());
      particle->yield_depth = 3.0e-6;
      particle->residual = 0.85;
    }
    const double landing = dust_random_.nextFloat01();
    if (landing < 0.4) {
      particle->wall = dust_random_.nextFloat01() < 0.5 ? 0u : 1u;
      particle->land_x = (2.0 + 30.0 * dust_random_.nextFloat01()) * 1.0e-6;
      particle->felt_height = 0.0;
    } else if (particle->kind == kDustKindFiber ||
               dust_random_.nextFloat01() < std::exp(-particle->height / 4.0e-6)) {
      particle->wall = dust_random_.nextFloat01() < 0.5 ? 0u : 1u;
      const double wall_position = (3.0 + 39.0 * dust_random_.nextFloat01()) * 1.0e-6;
      const double particle_lateral =
          particle->kind == kDustKindFiber ? particle->lateral_half : 0.5 * particle->height;
      const double lateral =
          (wall_position - controls_.side_radius) / (particle_lateral + kPatchHalfWidth);
      particle->felt_height = particle->height * std::exp(-lateral * lateral);
    } else {
      particle->wall = 3u;
      const double top = (1.4142135623730951 + 1.0) * 0.5 * particle->height;
      double clearance = top - (1.4142135623730951 - 1.0) * controls_.side_radius;
      if (clearance < 0.0) {
        clearance = 0.0;
      }
      particle->felt_height = kSqrtHalf * clearance;
    }
    particle->amplitude = 0.0;
  }

  void spawnScratch() noexcept {
    DustParticle *particle = allocateDust();
    if (particle == nullptr) {
      return;
    }
    particle->scratch = true;
    particle->wall = 2u;
    const double ahead_limit = controls_.groove_speed * 2.5;
    double ahead = ahead_limit < 400.0e-6 ? ahead_limit : 400.0e-6;
    if (ahead < 16.0e-6) {
      ahead = 16.0e-6;
    }
    const double scratch_ahead = ahead * (0.5 + dust_random_.nextFloat01());
    particle->center = groove_position_ + scratch_ahead;
    particle->amplitude_rate = controls_.groove_speed / (0.25 * scratch_ahead);
    const double kind = dust_random_.nextFloat01();
    double wall_right = 1.0;
    if (kind < 0.28) {
      particle->scratch_kind = 0u;
      particle->gouge = (0.2 + 1.3 * dust_random_.nextFloat01()) * 1.0e-6;
      particle->burr = (0.1 + 0.9 * dust_random_.nextFloat01()) * 1.0e-6;
      particle->width = (18.0 + 55.0 * dust_random_.nextFloat01()) * 1.0e-6;
      wall_right = 0.65 + 0.30 * dust_random_.nextFloat01();
    } else if (kind < 0.63) {
      particle->scratch_kind = 1u;
      particle->gouge = (4.0 + 10.0 * dust_random_.nextFloat01()) * 1.0e-6;
      particle->burr = (6.0 + 14.0 * dust_random_.nextFloat01()) * 1.0e-6;
      particle->width = (10.0 + 28.0 * dust_random_.nextFloat01()) * 1.0e-6;
      wall_right = 0.35 + 0.55 * dust_random_.nextFloat01();
    } else if (kind < 0.80) {
      particle->scratch_kind = 2u;
      particle->gouge = (1.0 + 5.0 * dust_random_.nextFloat01()) * 1.0e-6;
      particle->burr = (12.0 + 18.0 * dust_random_.nextFloat01()) * 1.0e-6;
      particle->width = (8.0 + 24.0 * dust_random_.nextFloat01()) * 1.0e-6;
      wall_right = 0.25 + 0.55 * dust_random_.nextFloat01();
    } else if (kind < 0.95) {
      particle->scratch_kind = 3u;
      particle->gouge = (8.0 + 14.0 * dust_random_.nextFloat01()) * 1.0e-6;
      particle->burr = (1.0 + 6.0 * dust_random_.nextFloat01()) * 1.0e-6;
      particle->width = (10.0 + 34.0 * dust_random_.nextFloat01()) * 1.0e-6;
      wall_right = 0.30 + 0.55 * dust_random_.nextFloat01();
    } else {
      particle->scratch_kind = 4u;
      particle->gouge = (12.0 + 16.0 * dust_random_.nextFloat01()) * 1.0e-6;
      particle->burr = (6.0 + 22.0 * dust_random_.nextFloat01()) * 1.0e-6;
      particle->width = (12.0 + 30.0 * dust_random_.nextFloat01()) * 1.0e-6;
      wall_right = 0.05 + 0.30 * dust_random_.nextFloat01();
    }
    double lip_lead = 0.45 + 0.95 * dust_random_.nextFloat01();
    double lip_trail = 0.20 + 0.80 * dust_random_.nextFloat01();
    if (dust_random_.nextFloat01() < 0.5) {
      const double swap = lip_lead;
      lip_lead = lip_trail;
      lip_trail = swap;
    }
    double wall_left = 1.0;
    if (dust_random_.nextFloat01() < 0.5) {
      const double swap = wall_left;
      wall_left = wall_right;
      wall_right = swap;
    }
    particle->lip_offset = 0.75 + 0.55 * dust_random_.nextFloat01();
    particle->lip_width = 0.22 + 0.28 * dust_random_.nextFloat01();
    particle->gouge_width = 0.70 + 0.45 * dust_random_.nextFloat01();
    particle->lip_lead = lip_lead;
    particle->lip_trail = lip_trail;
    particle->wall_left = wall_left;
    particle->wall_right = wall_right;
    particle->skew = (dust_random_.nextFloat01() - 0.5) * particle->width * 1.4;
    const double absolute_skew = particle->skew < 0.0 ? -particle->skew : particle->skew;
    particle->scratch_support = 4.0 * particle->width + absolute_skew;
    particle->height = particle->gouge > particle->burr ? particle->gouge : particle->burr;
    particle->amplitude = 0.0;
  }

  void enforceDustCapacity() noexcept {
    if (dust_population_ <= kPreferredDustCount) {
      return;
    }
    std::uint32_t active_count = 0u;
    std::uint32_t capacity_dying_count = 0u;
    for (const DustParticle &particle : dust_) {
      if (!particle.active) {
        continue;
      }
      ++active_count;
      if (particle.capacity_dying) {
        ++capacity_dying_count;
      }
    }
    const std::uint32_t required_dying =
        active_count > kPreferredDustCount ? active_count - kPreferredDustCount : 0u;
    while (capacity_dying_count < required_dying) {
      DustParticle *oldest = nullptr;
      for (DustParticle &particle : dust_) {
        if (!particle.active || particle.capacity_dying) {
          continue;
        }
        if (oldest == nullptr || particle.order < oldest->order) {
          oldest = &particle;
        }
      }
      if (oldest == nullptr) {
        break;
      }
      oldest->capacity_dying = true;
      oldest->dying = true;
      ++capacity_dying_count;
    }
  }

  void advanceDefects(double dt) noexcept {
    if (controls_.dust_rate > 0.0 && dust_random_.nextFloat01() < controls_.dust_rate * dt) {
      spawnDust();
    }
    if (controls_.scratch_rate > 0.0 && dust_random_.nextFloat01() < controls_.scratch_rate * dt) {
      spawnScratch();
    }
    active_dust_count_ = 0u;
    if (dust_population_ == 0u) {
      return;
    }
    enforceDustCapacity();
    for (std::size_t index = 0u; index < dust_.size(); ++index) {
      DustParticle &particle = dust_[index];
      if (!particle.active) {
        continue;
      }
      if (particle.dying) {
        particle.amplitude -= particle.amplitude_rate * dt;
        if (particle.amplitude <= 0.0) {
          particle.active = false;
          --dust_population_;
          continue;
        }
      } else if (particle.amplitude < 1.0) {
        particle.amplitude += particle.amplitude_rate * dt;
        if (particle.amplitude > 1.0) {
          particle.amplitude = 1.0;
        }
      }
      if (!particle.dying && !particle.scratch && !particle.counted &&
          groove_position_ > particle.center + 2.0 * particle.width) {
        particle.counted = true;
        if (particle.touched) {
          ++dust_hit_count_;
          if (particle.kind == kDustKindGrit) {
            particle.dying = true;
          }
        }
      }
      if (particle.center < groove_position_ - 5.0e-3) {
        particle.active = false;
        --dust_population_;
        continue;
      }
      const double distance = particle.center - groove_position_;
      const double absolute_distance = distance < 0.0 ? -distance : distance;
      const double support = particle.scratch ? particle.scratch_support : 4.0 * particle.width;
      if ((particle.scratch || particle.felt_height > 1.0e-12) &&
          absolute_distance <= support + scan_half_) {
        active_dust_[active_dust_count_] = static_cast<std::uint16_t>(index);
        ++active_dust_count_;
      }
    }
  }

  void spawnStaticPop() noexcept {
    StaticPop *selected = nullptr;
    for (StaticPop &pop : static_pops_) {
      if (!pop.active) {
        selected = &pop;
        break;
      }
      if (selected == nullptr || pop.time < selected->time) {
        selected = &pop;
      }
    }
    if (selected == nullptr) {
      return;
    }
    if (!selected->active) {
      ++active_static_pop_count_;
    }
    selected->active = true;
    selected->time = simulation_time_;
    const double sign = static_random_.nextFloat01() < 0.5 ? -1.0 : 1.0;
    selected->amplitude = sign * (0.5 + 2.5 * static_random_.nextFloat01()) * kReferenceVelocity *
                          kStaticReferenceGain;
    ++pop_count_;
  }

  double dustGaussian() noexcept {
    if (dust_gaussian_has_spare_) {
      dust_gaussian_has_spare_ = false;
      return dust_gaussian_spare_;
    }
    double u = 0.0;
    double v = 0.0;
    double radius_squared = 0.0;
    do {
      u = 2.0 * dust_random_.nextFloat01() - 1.0;
      v = 2.0 * dust_random_.nextFloat01() - 1.0;
      radius_squared = u * u + v * v;
    } while (radius_squared >= 1.0 || radius_squared == 0.0);
    const double multiplier = std::sqrt(-2.0 * std::log(radius_squared) / radius_squared);
    dust_gaussian_spare_ = v * multiplier;
    dust_gaussian_has_spare_ = true;
    return u * multiplier;
  }

  void seedRandomStreams() noexcept {
    const std::uint64_t seed = (static_cast<std::uint64_t>(selected_seed_high_) << 32u) |
                               static_cast<std::uint64_t>(selected_seed_low_);
    dsp::XorShiftRng master(seed);
    const std::uint32_t rough_seed = static_cast<std::uint32_t>(master.nextU64() >> 32u);
    const std::uint32_t dust_seed = static_cast<std::uint32_t>(master.nextU64() >> 32u);
    const std::uint32_t static_seed = static_cast<std::uint32_t>(master.nextU64() >> 32u);
    rough_random_.seed(rough_seed, 0u);
    dust_random_.seed(dust_seed, 0u);
    static_random_.seed(static_seed, 0u);
    dust_gaussian_has_spare_ = false;
    dust_gaussian_spare_ = 0.0;
  }

  void resetSimulation() noexcept {
    rumble_mid_.reset();
    rumble_side_.reset();
    side_high_pass_.reset();
    hf_left_first_.reset();
    hf_left_second_.reset();
    hf_right_first_.reset();
    hf_right_second_.reset();
    recording_riaa_left_.reset();
    recording_riaa_right_.reset();
    playback_riaa_left_.reset();
    playback_riaa_right_.reset();
    integrator_left_ = 0.0;
    integrator_right_ = 0.0;
    sample_counter_ = 0u;
    groove_position_ = 0.0;
    simulation_time_ = 0.0;
    rough_index_ = -1;
    rough_fine_left_ = 0.0;
    rough_fine_right_ = 0.0;
    rough_mid_left_ = 0.0;
    rough_mid_right_ = 0.0;
    rough_wave_left_ = 0.0;
    rough_wave_right_ = 0.0;
    next_dust_order_ = 0u;
    for (DustParticle &particle : dust_) {
      particle = {};
    }
    for (StaticPop &pop : static_pops_) {
      pop = {};
    }
    active_dust_count_ = 0u;
    dust_population_ = 0u;
    active_static_pop_count_ = 0u;
    dry_position_ = 0u;
    controls_initialized_ = false;
    contact_initialized_ = false;
    seedRandomStreams();
    tip_x_ = 0.0;
    tip_y_ = 18.0e-6 / kSqrtHalf;
    tip_vx_ = 0.0;
    tip_vy_ = 0.0;
    arm_x_ = 0.0;
    arm_y_ = tip_y_ - 2.0e-3 * 9.80665 * 15.0e-3;
    arm_vx_ = 0.0;
    arm_vy_ = 0.0;
    rest_y_ = tip_y_;
    previous_integral_left_ = 0.0;
    previous_integral_right_ = 0.0;
    contact_loss_time_ = 0.0;
    in_loss_episode_ = false;
    skip_holdoff_ = 0.0;
    signal_power_left_ = 0.0;
    signal_power_right_ = 0.0;
    error_power_left_ = 0.0;
    error_power_right_ = 0.0;
    meter_tip_velocity_squared_ = 0.0;
    meter_force_left_ = 0.0;
    meter_force_right_ = 0.0;
    meter_pressure_left_ = 0.0;
    meter_pressure_right_ = 0.0;
    meter_jitter_mean_ns_ = 0.0;
    meter_jitter_variance_ns2_ = 0.0;
    latest_force_left_ = 0.0;
    latest_force_right_ = 0.0;
    latest_pressure_left_ = 0.0;
    latest_pressure_right_ = 0.0;
    latest_jitter_ns_ = 0.0;
    mistrack_count_ = 0u;
    skip_count_ = 0u;
    pop_count_ = 0u;
    dust_hit_count_ = 0u;
    telemetry_available_ = false;
  }

  std::vector<StereoSample> signal_;
  std::vector<StereoSample> rough_;
  std::vector<float> dry_left_;
  std::vector<float> dry_right_;
  std::vector<DustParticle> dust_;
  std::array<std::uint16_t, kMaximumDust> active_dust_{};
  std::array<StaticPop, kMaximumStaticPops> static_pops_{};
  dsp::XorShiftRng rough_random_{};
  dsp::XorShiftRng dust_random_{};
  dsp::XorShiftRng static_random_{};
  Biquad rumble_mid_;
  Biquad rumble_side_;
  Biquad side_high_pass_;
  Biquad hf_left_first_;
  Biquad hf_left_second_;
  Biquad hf_right_first_;
  Biquad hf_right_second_;
  RiaaFilter recording_riaa_left_;
  RiaaFilter recording_riaa_right_;
  RiaaFilter playback_riaa_left_;
  RiaaFilter playback_riaa_right_;
  SmoothedControls controls_;
  SmoothedControls targets_;
  double sample_rate_ = 0.0;
  double leaky_integrator_coefficient_ = 0.0;
  double integrator_left_ = 0.0;
  double integrator_right_ = 0.0;
  double groove_position_ = 0.0;
  double simulation_time_ = 0.0;
  double rough_a_fine_ = 0.0;
  double rough_a_mid_ = 0.0;
  double rough_a_wave_ = 0.0;
  double rough_gain_fine_unit_ = 0.0;
  double rough_gain_mid_unit_ = 0.0;
  double rough_gain_wave_unit_ = 0.0;
  double rough_k_fine_ = 0.0;
  double rough_k_mid_ = 0.0;
  double rough_k_wave_ = 0.0;
  double rough_fine_left_ = 0.0;
  double rough_fine_right_ = 0.0;
  double rough_mid_left_ = 0.0;
  double rough_mid_right_ = 0.0;
  double rough_wave_left_ = 0.0;
  double rough_wave_right_ = 0.0;
  double dust_gaussian_spare_ = 0.0;
  std::uint64_t next_dust_order_ = 0u;
  double scan_half_ = 6.4e-6;
  double scan_step_ = 1.6e-6;
  double tip_x_ = 0.0;
  double tip_y_ = 0.0;
  double tip_vx_ = 0.0;
  double tip_vy_ = 0.0;
  double arm_x_ = 0.0;
  double arm_y_ = 0.0;
  double arm_vx_ = 0.0;
  double arm_vy_ = 0.0;
  double rest_y_ = 0.0;
  double previous_integral_left_ = 0.0;
  double previous_integral_right_ = 0.0;
  double contact_loss_time_ = 0.0;
  double skip_holdoff_ = 0.0;
  double signal_power_left_ = 0.0;
  double signal_power_right_ = 0.0;
  double error_power_left_ = 0.0;
  double error_power_right_ = 0.0;
  double meter_tip_velocity_squared_ = 0.0;
  double meter_force_left_ = 0.0;
  double meter_force_right_ = 0.0;
  double meter_pressure_left_ = 0.0;
  double meter_pressure_right_ = 0.0;
  double meter_jitter_mean_ns_ = 0.0;
  double meter_jitter_variance_ns2_ = 0.0;
  double latest_force_left_ = 0.0;
  double latest_force_right_ = 0.0;
  double latest_pressure_left_ = 0.0;
  double latest_pressure_right_ = 0.0;
  double latest_jitter_ns_ = 0.0;
  std::int64_t rough_index_ = -1;
  std::uint64_t sample_counter_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t latency_samples_ = 0u;
  std::uint32_t substeps_ = 4u;
  std::uint32_t scan_points_ = 9u;
  std::uint32_t active_dust_count_ = 0u;
  std::uint32_t dust_population_ = 0u;
  std::uint32_t active_static_pop_count_ = 0u;
  std::uint32_t dry_position_ = 0u;
  std::uint32_t last_pair_channels_ = 0u;
  std::uint32_t mistrack_count_ = 0u;
  std::uint32_t skip_count_ = 0u;
  std::uint32_t pop_count_ = 0u;
  std::uint32_t dust_hit_count_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  int last_quality_ = -1;
  int last_shape_ = -1;
  bool initialized_ = false;
  bool controls_initialized_ = false;
  bool contact_initialized_ = false;
  bool in_loss_episode_ = false;
  bool dust_gaussian_has_spare_ = false;
  bool telemetry_available_ = false;
};

static_assert(sizeof(VinylSimulatorKernel) <= 8192u);

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(VinylSimulatorPlugin, effetune::plugins::lofi::VinylSimulatorKernel)

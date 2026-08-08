#include "effetune/kernel.h"
#include "CassetteArtifactsPluginParams.h"
#include "effetune/dsp/math.h"
#include "effetune/dsp/xorshift_rng.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

// Every constant below is transcribed from plugins/lofi/cassette_artifacts.js.
// The JavaScript reference is the golden source, so the arithmetic here follows
// its expression shapes literally rather than an algebraically equivalent form.
constexpr double kPi = 3.141592653589793;
constexpr double kTwoPi = 6.283185307179586;

// Compact cassette speed, exact by definition (IEC 60094-7).
constexpr double kVelocity = 0.047625;
constexpr double kEqReferenceHz = 1000.0;
constexpr double kPlayGapMeters = 1.0e-6;
constexpr double kSpacingMeters = 0.2e-6;
constexpr double kHeadBumpQ = 1.0;
constexpr double kThicknessThreeDb = 0.742;
constexpr double kGapThreeDb = 1.3916;
constexpr double kSpacingThreeDb = 0.3454;
constexpr double kSaturationReferenceDbfs = -18.0;
// Math.pow(10, -18 / 20).
constexpr double kSaturationReferencePeak = 0.12589254117941673;
constexpr double kSaturationReferenceT = 0.1157;
// CAL.H_II: the reference-configuration floor the hiss control is named against.
constexpr double kHissReferenceDb = -60.5;
constexpr double kHissOffDb = -92.0;
constexpr double kLfTau = 3180.0e-6;

constexpr int kDolbyTableSize = 512;
constexpr double kDolbyTableMaxQ = 4.0;
constexpr double kDolbyTableInvMaxQ = 0.25;
// Math.pow(10, -40 / 20).
constexpr double kDolbySlideQThreshold = 0.010000000000000000;
// Math.log(100) / Math.log(1 + 1 / kDolbySlideQThreshold).
constexpr double kDolbySlideExponent = 0.99784397161095628;
// 1 / (Math.pow(10, -19.2 / 20) * 0.6366197723675814).
constexpr double kDolbyInvRefEnc = 14.325832764573933;
constexpr double kDolbyFadeSeconds = 0.02;
constexpr int kDolbySlotsPerStage = 5;
constexpr int kDolbySlotsPerDir = 2 * kDolbySlotsPerStage;
constexpr int kDolbySlotsPerMode = 2 * kDolbySlotsPerDir;
constexpr int kDolbyCoefStride = 9;

constexpr double kSaturationAsymmetry = 0.12;
constexpr double kMemoryDepth = 0.25;
constexpr double kMemoryAttackSeconds = 0.002;
constexpr double kMemoryReleaseSeconds = 0.015;
constexpr double kDcBlockHz = 5.0;

constexpr double kBiasCornerHz = 40000.0;
constexpr double kBiasCornerExponent = 1.1;
constexpr double kBiasShelfHz = 8000.0;
constexpr double kBiasPeakCurvature = 0.2;
constexpr double kBiasPeakWidthDb = 0.5;
constexpr double kBiasShelfLimitDb = 40.0;
constexpr double kBiasProbeHz = 10000.0;

constexpr double kCapstanHz = 6.8907;
constexpr double kHubHz = 0.42110;
constexpr double kFlutterBandHz = 40.0;
constexpr double kFlutterFloorHz = 1.0;
constexpr double kCapstanSpeedPerPercent = 0.00905396;
constexpr double kHubSpeedPerPercent = 0.00543237;
constexpr double kFlutterSpeedPerPercent = 0.00633777;
constexpr int kTransportIntegrationPoints = 1024;
constexpr double kTransportBaseSeconds = 0.0035;
// Ring sizing, CAL.TRANSPORT. Every term the delay line holds scales with the
// host rate, so the length is chosen per rate in prepare(); kRingMaxLength is
// this kernel's fixed capacity and kRingMinLength holds every rate up to
// 192 kHz at the 2048 the shipped goldens were generated against.
constexpr double kTransportPeakDeviationSeconds = 0.002861;
constexpr double kRingMarginSamples = 4.0;
constexpr std::int32_t kRingMinLength = 2048;
constexpr std::int32_t kRingMaxLength = 4096;

constexpr double kOsH1 = 0.31238803284111993;
constexpr double kOsH3 = -0.089587837502923581;
constexpr double kOsH5 = 0.039210420871375766;
constexpr double kOsH7 = -0.016676371213684291;
constexpr double kOsH9 = 0.0057277622021075980;
constexpr double kOsH11 = -0.0010620071979954024;
constexpr std::int32_t kOsHistory = 16;
constexpr std::int32_t kOsMask = 15;
constexpr std::int32_t kOsLatency = 11;

constexpr double kHissHighPassHz = 60.0;
constexpr double kHissLowPassHz = 12000.0;
constexpr double kModulationLengthMeters = 30.0e-6;

constexpr double kAzPoleTauRatio = 0.2886751345948129;
constexpr int kAzTableSize = 512;
constexpr double kAzWobbleCornerHz = 0.5;
constexpr double kAzWobbleClampSigma = 4.0;
constexpr double kArcminToRadians = 2.908882086657216e-4;
constexpr double kTrackWidthMeters = 0.6e-3;
constexpr double kTrackSpacingMeters = 0.9e-3;
constexpr double kAzMaxArcmin = 6.0;
// The largest azWobbleArcmin in CAL.GRADES (Portable).
constexpr double kAzMaxWobbleArcmin = 4.0;
constexpr double kAzThetaMaxRadians =
    (kAzMaxArcmin + kAzWobbleClampSigma * kAzMaxWobbleArcmin) * kArcminToRadians;

constexpr double kDropoutDefectMinMeters = 1.0e-4;
constexpr double kDropoutDepthMinDb = 3.0;
constexpr double kDropoutDepthSpanDb = 27.0;
// Math.log(CAL.DROPOUT.DEFECT_MAX_M / CAL.DROPOUT.DEFECT_MIN_M).
constexpr double kDropoutLogDefectRatio = 2.3025850929940459;

constexpr double kAWeightingF1 = 20.598997;
constexpr double kAWeightingF2 = 107.65265;
constexpr double kAWeightingF3 = 737.86223;
constexpr double kAWeightingF4 = 12194.217;
constexpr double kAWeightingReferenceHz = 1000.0;
constexpr int kNoiseIntegrationPoints = 4096;

constexpr double kRngScale = 4.656612873077393e-10;
constexpr double kRngUnit = 2.3283064365386963e-10;
constexpr double kDenormalThreshold = 1.0e-30;
constexpr std::int32_t kSeedFallback = 0x1a2b3c4d;

constexpr std::uint32_t kSaltTransport = 0x9E3779B9u;
constexpr std::uint32_t kSaltNoise = 0x85EBCA6Bu;
constexpr std::uint32_t kSaltDropout = 0xC2B2AE35u;
constexpr std::uint32_t kSaltAzimuth = 0x27D4EB2Fu;

constexpr int kSectionRecordEq = 0;
constexpr int kSectionRecordEqB = 1;
constexpr int kSectionBias = 2;
constexpr int kSectionBiasShelf = 3;
constexpr int kSectionLossA = 4;
constexpr int kSectionLossB = 5;
constexpr int kSectionReproduceEq = 6;
constexpr int kSectionReproduceEqB = 7;
constexpr int kSectionHissHp = 8;
constexpr int kSectionHissLp = 9;
constexpr int kSectionModulation = 10;
constexpr int kSectionAzimuth = 11;
constexpr int kSectionRecordLf = 12;
constexpr int kSectionPlayLf = 13;
constexpr int kSectionScratch = 14;
constexpr int kSectionCount = 15;

constexpr int kBiquadRecordAmp = 0;
constexpr int kBiquadHeadBump = 1;
constexpr int kBiquadHeadBump2 = 2;
constexpr int kBiquadHeadBump3 = 3;
constexpr int kBiquadCount = 4;

struct GradeEntry final {
  double trimMaxDb;
  double recordBandwidthHz;
  double lfBoostMaxDb;
  double azWobbleArcmin;
  double contactLengthM;
  double headBumpDb;
  int contourLobes;
};

struct TypeEntry final {
  double eqUs;
  double coating;
  double headroomDb;
  double preEmphDb;
  double dcnDb;
  double deltaS10Db;
  double hissFloorDb;
};

// CAL.GRADES, in the declaration order of the calibration table.
constexpr GradeEntry kGrades[4] = {{29.85, 30000.0, 12.0, 0.0, 1.00e-3, 1.2, 3},
                                   {26.17, 24000.0, 10.0, 1.0, 0.87e-3, 1.5, 3},
                                   {21.73, 18000.0, 8.0, 2.0, 0.75e-3, 2.2, 3},
                                   {17.06, 12000.0, 5.0, 4.0, 0.70e-3, 3.0, 2}};

// CAL.TYPES, with the matching CAL.H_* floor folded in through
// CASSETTE_ARTIFACTS_TYPE_HISS_KEY.
constexpr TypeEntry kTypes[3] = {{120.0, 5.0e-6, -11.0, 11.6, -48.0, 2.5, -56.5},
                                 {70.0, 5.0e-6, -9.2, 14.7, -50.0, 3.0, -60.5},
                                 {70.0, 4.0e-6, -7.8, 8.9, -52.0, 2.0, -58.0}};

struct DolbyStage final {
  double maxBoostDb;
  double cornerHz;
  double refOffsetDb;
  double attackMs;
  double releaseMs;
  double skewHz;
  double antiSatZeroHz;
  double antiSatPoleHz;
};

// CAL.DOLBY['Dolby B'].stages and CAL.DOLBY['Dolby C'].stages.
constexpr DolbyStage kDolbyStagesB[1] = {{10.0, 1700.0, 0.0, 20.0, 40.0, 0.0, 0.0, 0.0}};
constexpr DolbyStage kDolbyStagesC[2] = {{11.0, 400.0, 0.0, 8.0, 80.0, 12800.0, 12000.0, 6000.0},
                                         {11.0, 400.0, -20.0, 8.0, 80.0, 12800.0, 15000.0, 5000.0}};

struct SectionCoefficients final {
  double b0[kSectionCount]{};
  double b1[kSectionCount]{};
  double a1[kSectionCount]{};
};

void firstOrder(double tau_zero, double tau_pole, double two_fs, SectionCoefficients &out,
                int index) noexcept {
  const double nyquist = two_fs * 0.25;
  const double zero_ratio = tau_zero > 0.0 ? kTwoPi * nyquist * tau_zero : 0.0;
  const double pole_ratio = tau_pole > 0.0 ? kTwoPi * nyquist * tau_pole : 0.0;
  const double nyquist_magnitude =
      std::sqrt((1.0 + zero_ratio * zero_ratio) / (1.0 + pole_ratio * pole_ratio));
  const double pole = tau_pole > 0.0 ? std::exp(-2.0 / (tau_pole * two_fs)) : 0.0;
  const double low = 1.0 - pole;
  const double high = (1.0 + pole) * nyquist_magnitude;
  out.b0[index] = (low + high) * 0.5;
  out.b1[index] = (low - high) * 0.5;
  out.a1[index] = -pole;
}

void scaleSection(SectionCoefficients &out, int index, double gain) noexcept {
  out.b0[index] *= gain;
  out.b1[index] *= gain;
}

void invertSection(SectionCoefficients &out, int source, int target) noexcept {
  const double inverse_b0 = 1.0 / out.b0[source];
  out.b0[target] = inverse_b0;
  out.b1[target] = out.a1[source] * inverse_b0;
  out.a1[target] = out.b1[source] * inverse_b0;
}

double sectionMagnitude(const SectionCoefficients &out, int index, double omega) noexcept {
  const double cosine = std::cos(omega);
  const double sine = std::sin(omega);
  const double b0 = out.b0[index];
  const double b1 = out.b1[index];
  const double a1 = out.a1[index];
  const double numerator_real = b0 + b1 * cosine;
  const double numerator_imag = -b1 * sine;
  const double denominator_real = 1.0 + a1 * cosine;
  const double denominator_imag = -a1 * sine;
  const double numerator_sq = numerator_real * numerator_real + numerator_imag * numerator_imag;
  const double denominator_sq =
      denominator_real * denominator_real + denominator_imag * denominator_imag;
  return std::sqrt(numerator_sq / (denominator_sq > 1.0e-300 ? denominator_sq : 1.0e-300));
}

double aWeighting(double frequency) noexcept {
  const double squared = frequency * frequency;
  const double top_squared = kAWeightingF4 * kAWeightingF4;
  return (top_squared * squared * squared) / ((squared + kAWeightingF1 * kAWeightingF1) *
                                              std::sqrt((squared + kAWeightingF2 * kAWeightingF2) *
                                                        (squared + kAWeightingF3 * kAWeightingF3)) *
                                              (squared + top_squared));
}

double cascadeNoiseGain(const SectionCoefficients &out, const int *indices, int index_count,
                        int points, double rate, bool weighted) noexcept {
  // The curve is defined up to a constant; 1 kHz is its unity point.
  const double a_weighting_unity = 1.0 / aWeighting(kAWeightingReferenceHz);
  double total = 0.0;
  for (int k = 0; k < points; k++) {
    const double omega = kPi * (static_cast<double>(k) + 0.5) / static_cast<double>(points);
    double magnitude = 1.0;
    for (int s = 0; s < index_count; s++) {
      magnitude *= sectionMagnitude(out, indices[s], omega);
    }
    if (weighted) {
      magnitude *= aWeighting(omega * rate / kTwoPi) * a_weighting_unity;
    }
    total += magnitude * magnitude;
  }
  const double mean = total / static_cast<double>(points);
  return mean > 1.0e-30 ? std::sqrt(mean) : 1.0e-15;
}

void lowPassBiquad(double *out, int index, double frequency, double quality, double rate) noexcept {
  const int base = index * 5;
  const double omega = kTwoPi * frequency / rate;
  const double cosine = std::cos(omega);
  const double alpha = std::sin(omega) / (2.0 * quality);
  const double a0 = 1.0 + alpha;
  const double inverse = 1.0 / a0;
  const double one_minus_cos = 1.0 - cosine;
  out[base] = (one_minus_cos * 0.5) * inverse;
  out[base + 1] = one_minus_cos * inverse;
  out[base + 2] = out[base];
  out[base + 3] = (-2.0 * cosine) * inverse;
  out[base + 4] = (1.0 - alpha) * inverse;
}

void peakingBiquad(double *out, int index, double frequency, double quality, double gain_db,
                   double rate) noexcept {
  const int base = index * 5;
  const double amplitude = std::pow(10.0, gain_db / 40.0);
  const double omega = kTwoPi * frequency / rate;
  const double cosine = std::cos(omega);
  const double alpha = std::sin(omega) / (2.0 * quality);
  const double a0 = 1.0 + alpha / amplitude;
  const double inverse = 1.0 / a0;
  out[base] = (1.0 + alpha * amplitude) * inverse;
  out[base + 1] = (-2.0 * cosine) * inverse;
  out[base + 2] = (1.0 - alpha * amplitude) * inverse;
  out[base + 3] = (-2.0 * cosine) * inverse;
  out[base + 4] = (1.0 - alpha / amplitude) * inverse;
}

void flushDenormals(double *values, std::size_t count) noexcept {
  for (std::size_t i = 0u; i < count; i++) {
    values[i] = dsp::flush_denorm(values[i], kDenormalThreshold);
  }
}

// 32 bit xorshift, written so that the JavaScript `| 0` wraparound and the
// logical `>>> 17` are reproduced exactly.
std::int32_t nextRandom(std::int32_t state) noexcept {
  std::uint32_t value = static_cast<std::uint32_t>(state);
  value ^= value << 13U;
  value ^= value >> 17U;
  value ^= value << 5U;
  return static_cast<std::int32_t>(value);
}

// One base seed is split into independent per-family streams: XOR with the
// family's odd salt, one xorshift round, a zero guard on both sides.
std::int32_t deriveRngStream(std::int32_t base_seed, std::uint32_t salt) noexcept {
  std::int32_t s = static_cast<std::int32_t>(static_cast<std::uint32_t>(base_seed) ^ salt);
  if (s == 0) {
    s = static_cast<std::int32_t>(salt);
  }
  s = nextRandom(s);
  if (s == 0) {
    s = kSeedFallback;
  }
  return s;
}

double unsignedOf(std::int32_t state) noexcept {
  return static_cast<double>(static_cast<std::uint32_t>(state));
}

// Transport ring length for a host rate, mirroring the ring block of
// plugins/lofi/cassette_artifacts.js expression for expression: the base
// delay, the calibrated wf = 1 % peak excursion, the worst-case azimuth
// half-lag and the interpolator margin, rounded up to a power of two,
// floored at kRingMinLength and capped at this kernel's capacity.
std::int32_t transportRingLength(double sample_rate) noexcept {
  // Math.round rounds halves towards positive infinity.
  const double base = std::floor(kTransportBaseSeconds * sample_rate + 0.5);
  const double azimuth_half_lag =
      0.5 * kTrackSpacingMeters / kVelocity * sample_rate * kAzThetaMaxRadians;
  const double required =
      base + kTransportPeakDeviationSeconds * sample_rate + azimuth_half_lag + kRingMarginSamples;
  std::int32_t length = kRingMinLength;
  while (static_cast<double>(length) < required && length < kRingMaxLength) {
    length *= 2;
  }
  return length;
}

} // namespace

class CassetteArtifactsKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::CassetteArtifactsPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    // The ring is sized here, never in process(): the length depends only on
    // the host rate, and the audio callback may not allocate.
    delay_length_ = transportRingLength(sample_rate_);
    delay_mask_ = delay_length_ - 1;
    const std::size_t channels = static_cast<std::size_t>(max_channels_);
    section_state_.assign(static_cast<std::size_t>(kSectionCount) * channels, 0.0);
    biquad_state_.assign(static_cast<std::size_t>(kBiquadCount) * 2u * channels, 0.0);
    envelope_.assign(channels, 0.0);
    dc_input_.assign(channels, 0.0);
    dc_output_.assign(channels, 0.0);
    oversample_input_.assign(static_cast<std::size_t>(kOsHistory) * channels, 0.0);
    oversample_even_.assign(static_cast<std::size_t>(kOsHistory) * channels, 0.0);
    oversample_odd_.assign(static_cast<std::size_t>(kOsHistory) * channels, 0.0);
    delay_buffers_.assign(static_cast<std::size_t>(delay_length_) * channels, 0.0F);
    dry_buffers_.assign(static_cast<std::size_t>(delay_length_) * channels, 0.0F);
    dropout_local_phase_.assign(channels, 1.0);
    dropout_local_increment_.assign(channels, 0.0);
    dropout_local_depth_.assign(channels, 0.0);
    dropout_local_events_.assign(channels, 0.0);
    dolby_bank_.assign(static_cast<std::size_t>(2 * kDolbySlotsPerMode) * channels, 0.0);
    az_table_.assign(static_cast<std::size_t>(kAzTableSize + 2) * 3u, 0.0);
    dolby_table_b_.assign(static_cast<std::size_t>(kDolbyTableSize + 2), 0.0);
    dolby_table_c_.assign(static_cast<std::size_t>(kDolbyTableSize + 2), 0.0);
  }

  void reset() noexcept override {
    clearState();
    configured_ = false;
    last_channel_count_ = 0u;
    random_.seed(selected_seed_low_, selected_seed_high_);
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    random_.seed(seed_low, seed_high);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u) {
      return;
    }

    // mx = 0 must be a bit-for-bit dry path, and the JavaScript takes that exit
    // before any state - the seed included - is drawn.
    const double mix_ratio = static_cast<double>(params_.mix) * 0.01;
    if (!(mix_ratio > 0.0)) {
      return;
    }

    if (!configured_ || last_channel_count_ != channel_count) {
      createState(channel_count);
    }

    const int channels = static_cast<int>(channel_count);
    int type_index = static_cast<int>(params_.tapeType);
    if (type_index < 0 || type_index > 2) {
      type_index = 1; // The JavaScript falls back to Type II.
    }
    int grade_index = static_cast<int>(params_.deckGrade);
    if (grade_index < 0 || grade_index > 3) {
      grade_index = 2; // CAL.GRADE_DEFAULT is Consumer.
    }
    int nr_index = static_cast<int>(params_.noiseReduction);
    if (nr_index < 0 || nr_index > 2) {
      nr_index = 0;
    }
    const double bias_db = static_cast<double>(params_.bias);
    const double hiss_db = static_cast<double>(params_.hiss);
    if (!has_configuration_ || configuration_type_ != type_index ||
        configuration_grade_ != grade_index || configuration_nr_ != nr_index ||
        configuration_bias_ != bias_db || configuration_hiss_ != hiss_db) {
      updateConfiguration(type_index, grade_index, bias_db, hiss_db);
      has_configuration_ = true;
      configuration_type_ = type_index;
      configuration_grade_ = grade_index;
      configuration_nr_ = nr_index;
      configuration_bias_ = bias_db;
      configuration_hiss_ = hiss_db;
    }

    double *dolby_bank = dolby_bank_.data();

    // --- Dolby mode bookkeeping ------------------------------------------
    if (dolby_mode_ == -1) {
      dolby_mode_ = nr_index;
    } else if (dolby_mode_ != nr_index) {
      const int previous_index = dolby_mode_;
      if (nr_index != 0) {
        const std::size_t new_mode_base = static_cast<std::size_t>(nr_index - 1) *
                                          kDolbySlotsPerMode * static_cast<std::size_t>(channels);
        const int stage_count = nr_index == 1 ? 1 : 2;
        for (int ch = 0; ch < channels; ch++) {
          double enc_seed = 0.0;
          double dec_seed = 0.0;
          if (previous_index != 0) {
            const std::size_t previous_base =
                static_cast<std::size_t>((previous_index - 1) * channels + ch) * kDolbySlotsPerMode;
            enc_seed = dolby_bank[previous_base + 1];
            dec_seed = dolby_bank[previous_base + kDolbySlotsPerDir + 1];
          }
          const std::size_t channel_base =
              new_mode_base + static_cast<std::size_t>(ch) * kDolbySlotsPerMode;
          for (int k = 0; k < kDolbySlotsPerMode; k++) {
            dolby_bank[channel_base + static_cast<std::size_t>(k)] = 0.0;
          }
          for (int st = 0; st < stage_count; st++) {
            dolby_bank[channel_base + static_cast<std::size_t>(st * kDolbySlotsPerStage + 1)] =
                enc_seed;
            dolby_bank[channel_base +
                       static_cast<std::size_t>(kDolbySlotsPerDir + st * kDolbySlotsPerStage + 1)] =
                dec_seed;
          }
        }
      }
      dolby_prev_mode_ = previous_index;
      dolby_mode_ = nr_index;
      dolby_fade_ = dolby_fade_length_;
    }

    const double dropouts_parameter = static_cast<double>(params_.dropouts);
    const double dropouts_per_minute = dropouts_parameter > 0.0 ? dropouts_parameter : 0.0;
    const bool dropouts_active = dropouts_per_minute > 0.0;
    const double dropout_hazard_per_sample =
        dropouts_active ? dropouts_per_minute * (1.0 + static_cast<double>(channels)) * 0.5 /
                              (60.0 * sample_rate_)
                        : 0.0;
    const double wow_flutter = static_cast<double>(params_.wowFlutter);
    const bool transport_active = wow_flutter > 0.0;

    const double *section_b0 = coefficients_.b0;
    const double *section_b1 = coefficients_.b1;
    const double *section_a1 = coefficients_.a1;
    double *section_state = section_state_.data();
    const double *biquad_coefficients = biquad_coefficients_;
    double *biquad_state = biquad_state_.data();
    double *envelope = envelope_.data();
    double *dc_input = dc_input_.data();
    double *dc_output = dc_output_.data();
    float *delay_buffers = delay_buffers_.data();
    float *dry_buffers = dry_buffers_.data();
    double *oversample_input = oversample_input_.data();
    double *oversample_even = oversample_even_.data();
    double *oversample_odd = oversample_odd_.data();
    double *dropout_local_phase = dropout_local_phase_.data();
    double *dropout_local_increment = dropout_local_increment_.data();
    double *dropout_local_depth = dropout_local_depth_.data();
    double *dropout_local_events = dropout_local_events_.data();
    const double *az_table = az_table_.data();

    const double input_trim_gain = std::pow(
        10.0, (kSaturationReferenceDbfs + static_cast<double>(params_.recordLevel)) / 20.0);
    const double makeup_gain = 1.0 / input_trim_gain;
    const double output_gain = std::pow(10.0, static_cast<double>(params_.output) / 20.0);
    const double saturation_base = saturation_base_;
    const double memory_scale = memory_scale_;
    const double attack_coefficient = attack_coefficient_;
    const double release_coefficient = release_coefficient_;
    const double dc_coefficient = dc_coefficient_;
    const double negative_ceiling_scale = 1.0 + kSaturationAsymmetry;
    const double hiss_gain = hiss_gain_ * makeup_gain;
    const double modulation_gain = modulation_gain_;
    const bool noise_active = hiss_gain > 0.0 || modulation_gain > 0.0;
    const double capstan_delay_samples = capstan_delay_per_percent_ * wow_flutter;
    const double hub_delay_samples = hub_delay_per_percent_ * wow_flutter;
    const double flutter_delay_samples = flutter_delay_per_percent_ * wow_flutter;
    const double capstan_increment = capstan_increment_;
    const double hub_increment = hub_increment_;
    const double flutter_coefficient_a = flutter_coefficient_a_;
    const double flutter_coefficient_b = flutter_coefficient_b_;
    const double base_delay_samples = base_delay_samples_;
    // The transport deviation clamp answers to two limits, because the azimuth
    // lag and the deviation are both added to the base delay after it. A read
    // that is too shallow overtakes the write pointer: the cubic interpolator
    // reaches readFloor + 2, so the shortest total delay has to stay behind it.
    // A read that is too deep runs off the far end of the ring: the same
    // interpolator reaches readFloor - 1, so the longest total delay has to
    // stay inside the ring. Both are safety nets: transportRingLength() sizes
    // the ring per rate to hold the calibrated wf = 1 % peak with the azimuth
    // lag and this margin already in it, so at every rate the application
    // offers the first limit is the binding one and neither engages on a
    // calibrated trajectory. What is left for them to catch is the flutter
    // tail beyond the calibrated peak.
    const std::int32_t delay_length = delay_length_;
    const std::int32_t delay_mask = delay_mask_;
    const std::size_t delay_stride = static_cast<std::size_t>(delay_length);
    const double azimuth_max_half_delay = az_half_delay_scale_ * kAzThetaMaxRadians;
    const double write_pointer_room = base_delay_samples - 4.0 - azimuth_max_half_delay;
    const double ring_capacity_room =
        static_cast<double>(delay_length) - 3.0 - base_delay_samples - azimuth_max_half_delay;
    const double deviation_room =
        write_pointer_room < ring_capacity_room ? write_pointer_room : ring_capacity_room;
    const double max_deviation = base_delay_samples > 8.0 ? deviation_room : 1.0;
    const std::int32_t dry_delay_samples =
        (static_cast<std::int32_t>(base_delay_samples) + kOsLatency) & delay_mask;

    const bool azimuth_phase_active = channels > 1;
    const double az_static_radians = static_cast<double>(params_.azimuth) * kArcminToRadians;
    const bool az_wobble_active = az_wobble_sd_radians_ > 0.0;
    const double az_coefficient = az_coefficient_;
    const double az_wobble_scale = az_wobble_scale_;
    const double az_wobble_clamp = az_wobble_clamp_radians_;
    const double az_table_scale = az_table_scale_;
    const double az_half_delay_scale = az_half_delay_scale_;
    double azimuth_b0 = 1.0;
    double azimuth_b1 = 0.0;
    double azimuth_a1 = 0.0;
    double azimuth_half_delay_samples = 0.0;
    // Look the in-track loss coefficients up for |theta| and interpolate. The
    // table covers this Grade's whole reachable range, so the clamp is a bounds
    // guard rather than a physical limit.
    const auto azLookup = [&](double theta) noexcept {
      double position = (theta < 0.0 ? -theta : theta) * az_table_scale;
      if (position > static_cast<double>(kAzTableSize)) {
        position = static_cast<double>(kAzTableSize);
      }
      const int entry = static_cast<int>(position);
      const double fraction = position - static_cast<double>(entry);
      const std::size_t slot = static_cast<std::size_t>(entry) * 3u;
      azimuth_b0 = az_table[slot] + (az_table[slot + 3] - az_table[slot]) * fraction;
      azimuth_b1 = az_table[slot + 1] + (az_table[slot + 4] - az_table[slot + 1]) * fraction;
      azimuth_a1 = az_table[slot + 2] + (az_table[slot + 5] - az_table[slot + 2]) * fraction;
    };
    if (!az_wobble_active) {
      azLookup(az_static_radians);
      azimuth_half_delay_samples = az_half_delay_scale * az_static_radians;
    }

    // The decoder detector reference is the encoder's mapped through the exact
    // inverse makeup, offset by the Dolby Level Error control.
    const double dolby_inv_ref_dec =
        kDolbyInvRefEnc * input_trim_gain *
        std::pow(10.0, static_cast<double>(params_.dolbyLevelError) / 20.0);
    const double dolby_fade_inv = 1.0 / static_cast<double>(dolby_fade_length_);
    std::int32_t dolby_fade = dolby_fade_;
    const int dolby_mode = dolby_mode_;
    const int dolby_prev_mode = dolby_prev_mode_;
    const double *dolby_cur_coef = dolby_mode == 2 ? dolby_coef_c_ : dolby_coef_b_;
    const double *dolby_cur_table = dolby_mode == 2 ? dolby_table_c_.data() : dolby_table_b_.data();
    const int dolby_cur_stages = dolby_mode == 2 ? 2 : (dolby_mode == 1 ? 1 : 0);
    const std::size_t dolby_cur_base = dolby_mode != 0 ? static_cast<std::size_t>(dolby_mode - 1) *
                                                             static_cast<std::size_t>(channels) *
                                                             kDolbySlotsPerMode
                                                       : 0u;
    const bool dolby_stage1 = dolby_cur_stages == 2;
    const double dolby_s0_gain = dolby_cur_stages != 0 ? dolby_cur_coef[0] : 0.0;
    const double dolby_s0_ctrl_a = dolby_cur_stages != 0 ? dolby_cur_coef[1] : 0.0;
    const double dolby_s0_skew_a = dolby_cur_stages != 0 ? dolby_cur_coef[2] : 1.0;
    const double dolby_s0_as_b0 = dolby_cur_stages != 0 ? dolby_cur_coef[3] : 1.0;
    const double dolby_s0_as_b1 = dolby_cur_stages != 0 ? dolby_cur_coef[4] : 0.0;
    const double dolby_s0_as_a1 = dolby_cur_stages != 0 ? dolby_cur_coef[5] : 0.0;
    const double dolby_s0_attack = dolby_cur_stages != 0 ? dolby_cur_coef[6] : 0.0;
    const double dolby_s0_release = dolby_cur_stages != 0 ? dolby_cur_coef[7] : 0.0;
    const double dolby_s0_ref_mul = dolby_cur_stages != 0 ? dolby_cur_coef[8] : 1.0;
    const double dolby_s1_gain = dolby_stage1 ? dolby_cur_coef[kDolbyCoefStride] : 0.0;
    const double dolby_s1_ctrl_a = dolby_stage1 ? dolby_cur_coef[kDolbyCoefStride + 1] : 0.0;
    const double dolby_s1_skew_a = dolby_stage1 ? dolby_cur_coef[kDolbyCoefStride + 2] : 1.0;
    const double dolby_s1_as_b0 = dolby_stage1 ? dolby_cur_coef[kDolbyCoefStride + 3] : 1.0;
    const double dolby_s1_as_b1 = dolby_stage1 ? dolby_cur_coef[kDolbyCoefStride + 4] : 0.0;
    const double dolby_s1_as_a1 = dolby_stage1 ? dolby_cur_coef[kDolbyCoefStride + 5] : 0.0;
    const double dolby_s1_attack = dolby_stage1 ? dolby_cur_coef[kDolbyCoefStride + 6] : 0.0;
    const double dolby_s1_release = dolby_stage1 ? dolby_cur_coef[kDolbyCoefStride + 7] : 0.0;
    const double dolby_s1_ref_mul = dolby_stage1 ? dolby_cur_coef[kDolbyCoefStride + 8] : 1.0;

    // One stage of the sliding-band model, encode direction. Only entered while
    // a mode crossfade is in flight; the steady state runs the unrolled bodies
    // in the channel loop.
    const auto dolbyEncodeSample = [&](int mode, int ch, double x) noexcept {
      const double *coef = mode == 1 ? dolby_coef_b_ : dolby_coef_c_;
      const double *table = mode == 1 ? dolby_table_b_.data() : dolby_table_c_.data();
      const int stage_count = mode == 1 ? 1 : 2;
      const std::size_t base =
          static_cast<std::size_t>((mode - 1) * channels + ch) * kDolbySlotsPerMode;
      double s = x;
      for (int st = 0; st < stage_count; st++) {
        const int c = st * kDolbyCoefStride;
        const std::size_t b = base + static_cast<std::size_t>(st * kDolbySlotsPerStage);
        const double skew_a = coef[c + 2];
        double k = s;
        if (skew_a < 1.0) {
          k = dolby_bank[b + 2] + skew_a * (s - dolby_bank[b + 2]);
          dolby_bank[b + 2] = k;
        }
        double q = dolby_bank[b + 1] * kDolbyInvRefEnc * coef[c + 8];
        if (q > kDolbyTableMaxQ) {
          q = kDolbyTableMaxQ;
        }
        const double pos = std::sqrt(q * kDolbyTableInvMaxQ) * static_cast<double>(kDolbyTableSize);
        const int ti = static_cast<int>(pos);
        const double a = table[ti] + (table[ti + 1] - table[ti]) * (pos - static_cast<double>(ti));
        const double lp_new = dolby_bank[b + 3] + a * (k - dolby_bank[b + 3]);
        const double hp = k - lp_new;
        dolby_bank[b + 3] = lp_new;
        const double m = coef[c + 3] * s + dolby_bank[b + 4];
        dolby_bank[b + 4] = coef[c + 4] * s - coef[c + 5] * m;
        const double clp = dolby_bank[b] + coef[c + 1] * (k - dolby_bank[b]);
        dolby_bank[b] = clp;
        double magnitude = k - clp;
        if (magnitude < 0.0) {
          magnitude = -magnitude;
        }
        const double detector = dolby_bank[b + 1];
        dolby_bank[b + 1] =
            detector + (magnitude > detector ? coef[c + 6] : coef[c + 7]) * (magnitude - detector);
        s = m + coef[c] * hp;
      }
      return s;
    };

    // Decode direction: the complementary feedback expander, each stage solved
    // sample-exactly through its direct term.
    const auto dolbyDecodeSample = [&](int mode, int ch, double u) noexcept {
      const double *coef = mode == 1 ? dolby_coef_b_ : dolby_coef_c_;
      const double *table = mode == 1 ? dolby_table_b_.data() : dolby_table_c_.data();
      const int stage_count = mode == 1 ? 1 : 2;
      const std::size_t base =
          static_cast<std::size_t>((mode - 1) * channels + ch) * kDolbySlotsPerMode +
          kDolbySlotsPerDir;
      double s = u;
      for (int st = stage_count - 1; st >= 0; st--) {
        const int c = st * kDolbyCoefStride;
        const std::size_t b = base + static_cast<std::size_t>(st * kDolbySlotsPerStage);
        const double skew_a = coef[c + 2];
        double q = dolby_bank[b + 1] * dolby_inv_ref_dec * coef[c + 8];
        if (q > kDolbyTableMaxQ) {
          q = kDolbyTableMaxQ;
        }
        const double pos = std::sqrt(q * kDolbyTableInvMaxQ) * static_cast<double>(kDolbyTableSize);
        const int ti = static_cast<int>(pos);
        const double a = table[ti] + (table[ti + 1] - table[ti]) * (pos - static_cast<double>(ti));
        const double one_minus_a = 1.0 - a;
        const double gain = coef[c];
        const double direct = coef[c + 3] + gain * one_minus_a * skew_a;
        const double state_term =
            dolby_bank[b + 4] +
            gain * one_minus_a * ((1.0 - skew_a) * dolby_bank[b + 2] - dolby_bank[b + 3]);
        const double z = (s - state_term) / direct;
        double k = z;
        if (skew_a < 1.0) {
          k = dolby_bank[b + 2] + skew_a * (z - dolby_bank[b + 2]);
          dolby_bank[b + 2] = k;
        }
        dolby_bank[b + 3] = dolby_bank[b + 3] + a * (k - dolby_bank[b + 3]);
        const double m = coef[c + 3] * z + dolby_bank[b + 4];
        dolby_bank[b + 4] = coef[c + 4] * z - coef[c + 5] * m;
        const double clp = dolby_bank[b] + coef[c + 1] * (k - dolby_bank[b]);
        dolby_bank[b] = clp;
        double magnitude = k - clp;
        if (magnitude < 0.0) {
          magnitude = -magnitude;
        }
        const double detector = dolby_bank[b + 1];
        dolby_bank[b + 1] =
            detector + (magnitude > detector ? coef[c + 6] : coef[c + 7]) * (magnitude - detector);
        s = z;
      }
      return s;
    };

    std::int32_t delay_position = delay_position_;
    std::int32_t oversample_position = oversample_position_;
    double capstan_phase = capstan_phase_;
    double hub_phase = hub_phase_;
    double flutter_a = flutter_a_;
    double flutter_b = flutter_b_;
    std::int32_t rng_transport = rng_transport_;
    std::int32_t rng_noise = rng_noise_;
    std::int32_t rng_dropout = rng_dropout_;
    std::int32_t rng_azimuth = rng_azimuth_;
    double az_wobble_a = az_wobble_a_;
    double az_wobble_b = az_wobble_b_;
    double dropout_budget = dropout_budget_;
    double dropout_shared_phase = dropout_shared_phase_;
    double dropout_shared_increment = dropout_shared_increment_;
    double dropout_shared_depth = dropout_shared_depth_;

    for (std::uint32_t i = 0u; i < frame_count; i++) {
      const bool dolby_fade_active = dolby_fade > 0;
      const double dolby_fade_weight =
          dolby_fade_active ? 1.0 - static_cast<double>(dolby_fade) * dolby_fade_inv : 1.0;

      // The transport trajectory is shared by every channel; only the delay
      // line state is per channel.
      double deviation = 0.0;
      if (transport_active) {
        capstan_phase += capstan_increment;
        if (capstan_phase >= kTwoPi) {
          capstan_phase -= kTwoPi;
        }
        hub_phase += hub_increment;
        if (hub_phase >= kTwoPi) {
          hub_phase -= kTwoPi;
        }
        rng_transport = nextRandom(rng_transport);
        const double flutter_draw = unsignedOf(rng_transport) * kRngScale - 1.0;
        flutter_a += flutter_coefficient_a * (flutter_draw - flutter_a);
        flutter_b += flutter_coefficient_b * (flutter_a - flutter_b);
        deviation = std::sin(capstan_phase) * capstan_delay_samples +
                    std::sin(hub_phase) * hub_delay_samples + flutter_b * flutter_delay_samples;
        if (deviation > max_deviation) {
          deviation = max_deviation;
        } else if (deviation < -max_deviation) {
          deviation = -max_deviation;
        }
      }

      // Azimuth wobble, once per sample and ahead of the channels: the head is
      // one piece of metal, so every track sees the same angle.
      if (az_wobble_active) {
        rng_azimuth = nextRandom(rng_azimuth);
        const double az_draw = unsignedOf(rng_azimuth) * kRngScale - 1.0;
        az_wobble_a += az_coefficient * (az_draw - az_wobble_a);
        az_wobble_b += az_coefficient * (az_wobble_a - az_wobble_b);
        double wobble = az_wobble_b * az_wobble_scale;
        if (wobble > az_wobble_clamp) {
          wobble = az_wobble_clamp;
        } else if (wobble < -az_wobble_clamp) {
          wobble = -az_wobble_clamp;
        }
        const double theta = az_static_radians + wobble;
        azLookup(theta);
        azimuth_half_delay_samples = az_half_delay_scale * theta;
      }
      const double read_position =
          static_cast<double>(delay_position) - base_delay_samples - deviation;

      // Dropout scheduler, once per sample, ahead of the channels: events are
      // tape events, their scope decides who hears them.
      double shared_dropout_gain = 1.0;
      if (dropouts_active) {
        if (dropout_budget < 0.0) {
          rng_dropout = nextRandom(rng_dropout);
          dropout_budget = -std::log(1.0 - unsignedOf(rng_dropout) * kRngUnit);
        }
        dropout_budget -= dropout_hazard_per_sample;
        while (dropout_budget <= 0.0) {
          // Fixed four-draw event record: defect length, depth, scope, next
          // deadline - always all four, busy slot or not.
          rng_dropout = nextRandom(rng_dropout);
          const double length_draw = unsignedOf(rng_dropout) * kRngUnit;
          rng_dropout = nextRandom(rng_dropout);
          const double depth_draw = unsignedOf(rng_dropout) * kRngUnit;
          rng_dropout = nextRandom(rng_dropout);
          const double scope_draw = unsignedOf(rng_dropout) * kRngUnit;
          rng_dropout = nextRandom(rng_dropout);
          dropout_budget += -std::log(1.0 - unsignedOf(rng_dropout) * kRngUnit);
          const double defect_meters =
              kDropoutDefectMinMeters * std::exp(length_draw * kDropoutLogDefectRatio);
          const double event_increment = kVelocity / (defect_meters * sample_rate_);
          const double event_depth_db =
              kDropoutDepthMinDb + kDropoutDepthSpanDb * depth_draw * depth_draw;
          const double event_depth = 1.0 - std::pow(10.0, -event_depth_db / 20.0);
          const double scope = scope_draw * (static_cast<double>(channels) + 1.0);
          if (scope < 1.0) {
            if (dropout_shared_phase >= 1.0) {
              dropout_shared_phase = 0.0;
              dropout_shared_increment = event_increment;
              dropout_shared_depth = event_depth;
              dropout_shared_events_ += 1.0;
            }
          } else {
            const int event_channel = static_cast<int>(scope - 1.0);
            if (dropout_local_phase[event_channel] >= 1.0) {
              dropout_local_phase[event_channel] = 0.0;
              dropout_local_increment[event_channel] = event_increment;
              dropout_local_depth[event_channel] = event_depth;
              dropout_local_events[event_channel] += 1.0;
            }
          }
        }
        if (dropout_shared_phase < 1.0) {
          shared_dropout_gain =
              1.0 - dropout_shared_depth * (0.5 - 0.5 * std::cos(kTwoPi * dropout_shared_phase));
          const double advanced = dropout_shared_phase + dropout_shared_increment;
          dropout_shared_phase = advanced < 1.0 ? advanced : 1.0;
        }
      }

      for (int ch = 0; ch < channels; ch++) {
        const std::size_t offset = static_cast<std::size_t>(ch) * frame_count;
        // Sanitise before the sample can reach any state: NaN fails both
        // comparisons, each infinity fails one, and every finite value passes
        // through bit for bit.
        const double raw = static_cast<double>(audio[offset + i]);
        const double input = raw > -std::numeric_limits<double>::infinity() &&
                                     raw < std::numeric_limits<double>::infinity()
                                 ? raw
                                 : 0.0;
        float *dry_line = dry_buffers + static_cast<std::size_t>(ch) * delay_stride;
        dry_line[delay_position] = static_cast<float>(input);
        const double dry =
            static_cast<double>(dry_line[(delay_position - dry_delay_samples) & delay_mask]);
        double x = input * input_trim_gain;

        // Dolby encoder, ahead of the record EQ and the saturation.
        if (dolby_fade_active) {
          const double encode_current = dolby_mode == 0 ? x : dolbyEncodeSample(dolby_mode, ch, x);
          const double encode_previous =
              dolby_prev_mode == 0 ? x : dolbyEncodeSample(dolby_prev_mode, ch, x);
          x = encode_previous + dolby_fade_weight * (encode_current - encode_previous);
        } else if (dolby_cur_stages != 0) {
          const std::size_t enc_base =
              dolby_cur_base + static_cast<std::size_t>(ch) * kDolbySlotsPerMode;
          {
            double k = x;
            if (dolby_s0_skew_a < 1.0) {
              k = dolby_bank[enc_base + 2] + dolby_s0_skew_a * (x - dolby_bank[enc_base + 2]);
              dolby_bank[enc_base + 2] = k;
            }
            double q = dolby_bank[enc_base + 1] * kDolbyInvRefEnc * dolby_s0_ref_mul;
            q = q > kDolbyTableMaxQ ? kDolbyTableMaxQ : q;
            const double pos =
                std::sqrt(q * kDolbyTableInvMaxQ) * static_cast<double>(kDolbyTableSize);
            const int ti = static_cast<int>(pos);
            const double a = dolby_cur_table[ti] + (dolby_cur_table[ti + 1] - dolby_cur_table[ti]) *
                                                       (pos - static_cast<double>(ti));
            const double lp_new = dolby_bank[enc_base + 3] + a * (k - dolby_bank[enc_base + 3]);
            const double hp = k - lp_new;
            dolby_bank[enc_base + 3] = lp_new;
            const double m = dolby_s0_as_b0 * x + dolby_bank[enc_base + 4];
            dolby_bank[enc_base + 4] = dolby_s0_as_b1 * x - dolby_s0_as_a1 * m;
            const double clp = dolby_bank[enc_base] + dolby_s0_ctrl_a * (k - dolby_bank[enc_base]);
            dolby_bank[enc_base] = clp;
            const double magnitude = std::fabs(k - clp);
            const double detector = dolby_bank[enc_base + 1];
            const double detector_delta = magnitude - detector;
            dolby_bank[enc_base + 1] =
                detector + dolby_s0_attack * (detector_delta > 0.0 ? detector_delta : 0.0) +
                dolby_s0_release * (detector_delta <= 0.0 ? detector_delta : 0.0);
            x = m + dolby_s0_gain * hp;
          }
          if (dolby_stage1) {
            const std::size_t b = enc_base + kDolbySlotsPerStage;
            double k = x;
            if (dolby_s1_skew_a < 1.0) {
              k = dolby_bank[b + 2] + dolby_s1_skew_a * (x - dolby_bank[b + 2]);
              dolby_bank[b + 2] = k;
            }
            double q = dolby_bank[b + 1] * kDolbyInvRefEnc * dolby_s1_ref_mul;
            q = q > kDolbyTableMaxQ ? kDolbyTableMaxQ : q;
            const double pos =
                std::sqrt(q * kDolbyTableInvMaxQ) * static_cast<double>(kDolbyTableSize);
            const int ti = static_cast<int>(pos);
            const double a = dolby_cur_table[ti] + (dolby_cur_table[ti + 1] - dolby_cur_table[ti]) *
                                                       (pos - static_cast<double>(ti));
            const double lp_new = dolby_bank[b + 3] + a * (k - dolby_bank[b + 3]);
            const double hp = k - lp_new;
            dolby_bank[b + 3] = lp_new;
            const double m = dolby_s1_as_b0 * x + dolby_bank[b + 4];
            dolby_bank[b + 4] = dolby_s1_as_b1 * x - dolby_s1_as_a1 * m;
            const double clp = dolby_bank[b] + dolby_s1_ctrl_a * (k - dolby_bank[b]);
            dolby_bank[b] = clp;
            const double magnitude = std::fabs(k - clp);
            const double detector = dolby_bank[b + 1];
            const double detector_delta = magnitude - detector;
            dolby_bank[b + 1] = detector +
                                dolby_s1_attack * (detector_delta > 0.0 ? detector_delta : 0.0) +
                                dolby_s1_release * (detector_delta <= 0.0 ? detector_delta : 0.0);
            x = m + dolby_s1_gain * hp;
          }
        }

        // Record chain. The IEC 3180 us flux boost comes first, ahead of the
        // record EQ, the band limit and - crucially - the saturator.
        std::size_t index = static_cast<std::size_t>(kSectionRecordLf) * channels + ch;
        double y = section_b0[kSectionRecordLf] * x + section_state[index];
        section_state[index] = section_b1[kSectionRecordLf] * x - section_a1[kSectionRecordLf] * y;
        x = y;

        index = static_cast<std::size_t>(kSectionRecordEq) * channels + ch;
        y = section_b0[kSectionRecordEq] * x + section_state[index];
        section_state[index] = section_b1[kSectionRecordEq] * x - section_a1[kSectionRecordEq] * y;
        x = y;

        index = static_cast<std::size_t>(kSectionRecordEqB) * channels + ch;
        y = section_b0[kSectionRecordEqB] * x + section_state[index];
        section_state[index] =
            section_b1[kSectionRecordEqB] * x - section_a1[kSectionRecordEqB] * y;
        x = y;

        int base = kBiquadRecordAmp * 5;
        std::size_t state_base = (static_cast<std::size_t>(kBiquadRecordAmp) * channels + ch) * 2u;
        y = biquad_coefficients[base] * x + biquad_state[state_base];
        biquad_state[state_base] = biquad_coefficients[base + 1] * x -
                                   biquad_coefficients[base + 3] * y + biquad_state[state_base + 1];
        biquad_state[state_base + 1] =
            biquad_coefficients[base + 2] * x - biquad_coefficients[base + 4] * y;
        x = y;

        // --- 2x oversampled tape saturation --------------------------------
        const std::size_t os_base = static_cast<std::size_t>(ch) * kOsHistory;
        oversample_input[os_base + oversample_position] = x;
        const double g0 = x;
        const double g1 = oversample_input[os_base + ((oversample_position - 1) & kOsMask)];
        const double g2 = oversample_input[os_base + ((oversample_position - 2) & kOsMask)];
        const double g3 = oversample_input[os_base + ((oversample_position - 3) & kOsMask)];
        const double g4 = oversample_input[os_base + ((oversample_position - 4) & kOsMask)];
        const double g5 = oversample_input[os_base + ((oversample_position - 5) & kOsMask)];
        const double g6 = oversample_input[os_base + ((oversample_position - 6) & kOsMask)];
        const double g7 = oversample_input[os_base + ((oversample_position - 7) & kOsMask)];
        const double g8 = oversample_input[os_base + ((oversample_position - 8) & kOsMask)];
        const double g9 = oversample_input[os_base + ((oversample_position - 9) & kOsMask)];
        const double g10 = oversample_input[os_base + ((oversample_position - 10) & kOsMask)];
        const double g11 = oversample_input[os_base + ((oversample_position - 11) & kOsMask)];
        const double upper_even =
            2.0 * (kOsH11 * (g0 + g11) + kOsH9 * (g1 + g10) + kOsH7 * (g2 + g9) +
                   kOsH5 * (g3 + g8) + kOsH3 * (g4 + g7) + kOsH1 * (g5 + g6));
        const double upper_odd = g5;

        double level = envelope[ch];
        double magnitude = upper_even < 0.0 ? -upper_even : upper_even;
        level +=
            (magnitude > level ? attack_coefficient : release_coefficient) * (magnitude - level);
        double memory = level * memory_scale;
        if (memory > 1.0) {
          memory = 1.0;
        }
        double ceiling = saturation_base / (1.0 + memory);
        if (upper_even < 0.0) {
          ceiling *= negative_ceiling_scale;
        }
        double t = upper_even / ceiling;
        const double saturated_even = upper_even / std::sqrt(1.0 + t * t);

        magnitude = upper_odd < 0.0 ? -upper_odd : upper_odd;
        level +=
            (magnitude > level ? attack_coefficient : release_coefficient) * (magnitude - level);
        envelope[ch] = level;
        memory = level * memory_scale;
        if (memory > 1.0) {
          memory = 1.0;
        }
        ceiling = saturation_base / (1.0 + memory);
        if (upper_odd < 0.0) {
          ceiling *= negative_ceiling_scale;
        }
        t = upper_odd / ceiling;
        const double saturated_odd = upper_odd / std::sqrt(1.0 + t * t);

        // Decimate.
        oversample_even[os_base + oversample_position] = saturated_even;
        oversample_odd[os_base + oversample_position] = saturated_odd;
        const double e1 = oversample_even[os_base + ((oversample_position - 1) & kOsMask)];
        const double e2 = oversample_even[os_base + ((oversample_position - 2) & kOsMask)];
        const double e3 = oversample_even[os_base + ((oversample_position - 3) & kOsMask)];
        const double e4 = oversample_even[os_base + ((oversample_position - 4) & kOsMask)];
        const double e5 = oversample_even[os_base + ((oversample_position - 5) & kOsMask)];
        const double e6 = oversample_even[os_base + ((oversample_position - 6) & kOsMask)];
        const double e7 = oversample_even[os_base + ((oversample_position - 7) & kOsMask)];
        const double e8 = oversample_even[os_base + ((oversample_position - 8) & kOsMask)];
        const double e9 = oversample_even[os_base + ((oversample_position - 9) & kOsMask)];
        const double e10 = oversample_even[os_base + ((oversample_position - 10) & kOsMask)];
        const double e11 = oversample_even[os_base + ((oversample_position - 11) & kOsMask)];
        x = 0.5 * oversample_odd[os_base + ((oversample_position - 6) & kOsMask)] +
            kOsH11 * (saturated_even + e11) + kOsH9 * (e1 + e10) + kOsH7 * (e2 + e9) +
            kOsH5 * (e3 + e8) + kOsH3 * (e4 + e7) + kOsH1 * (e5 + e6);

        x *= makeup_gain;

        index = static_cast<std::size_t>(kSectionBias) * channels + ch;
        y = section_b0[kSectionBias] * x + section_state[index];
        section_state[index] = section_b1[kSectionBias] * x - section_a1[kSectionBias] * y;
        x = y;

        index = static_cast<std::size_t>(kSectionBiasShelf) * channels + ch;
        y = section_b0[kSectionBiasShelf] * x + section_state[index];
        section_state[index] =
            section_b1[kSectionBiasShelf] * x - section_a1[kSectionBiasShelf] * y;
        x = y;

        index = static_cast<std::size_t>(kSectionLossA) * channels + ch;
        y = section_b0[kSectionLossA] * x + section_state[index];
        section_state[index] = section_b1[kSectionLossA] * x - section_a1[kSectionLossA] * y;
        x = y;

        index = static_cast<std::size_t>(kSectionLossB) * channels + ch;
        y = section_b0[kSectionLossB] * x + section_state[index];
        section_state[index] = section_b1[kSectionLossB] * x - section_a1[kSectionLossB] * y;
        x = y;

        // Dropout envelope: the recorded signal is dropped here, ahead of the
        // transport, so the hiss injected further down stays untouched.
        if (dropouts_active) {
          double dropout_gain = shared_dropout_gain;
          const double local_phase = dropout_local_phase[ch];
          if (local_phase < 1.0) {
            dropout_gain *=
                1.0 - dropout_local_depth[ch] * (0.5 - 0.5 * std::cos(kTwoPi * local_phase));
            const double advanced = local_phase + dropout_local_increment[ch];
            dropout_local_phase[ch] = advanced < 1.0 ? advanced : 1.0;
          }
          if (dropout_gain < 1.0) {
            x *= dropout_gain;
          }
        }

        // Transport modulation. The azimuth L/R lag rides the same cubic
        // interpolator: channel 0 reads dt/2 early, channel 1 dt/2 late.
        float *line = delay_buffers + static_cast<std::size_t>(ch) * delay_stride;
        line[delay_position] = static_cast<float>(x);
        double channel_read = read_position;
        if (azimuth_phase_active) {
          if (ch == 0) {
            channel_read = read_position + azimuth_half_delay_samples;
          } else if (ch == 1) {
            channel_read = read_position - azimuth_half_delay_samples;
          }
        }
        const double read_floor = std::floor(channel_read);
        const double fraction = channel_read - read_floor;
        const std::int32_t read_floor_index = static_cast<std::int32_t>(read_floor);
        const double y0 = static_cast<double>(line[(read_floor_index - 1) & delay_mask]);
        const double y1 = static_cast<double>(line[read_floor_index & delay_mask]);
        const double y2 = static_cast<double>(line[(read_floor_index + 1) & delay_mask]);
        const double y3 = static_cast<double>(line[(read_floor_index + 2) & delay_mask]);
        const double c1 = 0.5 * (y2 - y0);
        const double c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        const double c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        x = ((c3 * fraction + c2) * fraction + c1) * fraction + y1;

        // Azimuth in-track loss: an ordinary first-order section whose
        // coefficients were looked up for this sample's angle above.
        index = static_cast<std::size_t>(kSectionAzimuth) * channels + ch;
        y = azimuth_b0 * x + section_state[index];
        section_state[index] = azimuth_b1 * x - azimuth_a1 * y;
        x = y;

        // Head contour: up to three alternating lobes. Unused ones are exact
        // pass-throughs written in the configuration block.
        base = kBiquadHeadBump * 5;
        state_base = (static_cast<std::size_t>(kBiquadHeadBump) * channels + ch) * 2u;
        y = biquad_coefficients[base] * x + biquad_state[state_base];
        biquad_state[state_base] = biquad_coefficients[base + 1] * x -
                                   biquad_coefficients[base + 3] * y + biquad_state[state_base + 1];
        biquad_state[state_base + 1] =
            biquad_coefficients[base + 2] * x - biquad_coefficients[base + 4] * y;
        x = y;

        base = kBiquadHeadBump2 * 5;
        state_base = (static_cast<std::size_t>(kBiquadHeadBump2) * channels + ch) * 2u;
        y = biquad_coefficients[base] * x + biquad_state[state_base];
        biquad_state[state_base] = biquad_coefficients[base + 1] * x -
                                   biquad_coefficients[base + 3] * y + biquad_state[state_base + 1];
        biquad_state[state_base + 1] =
            biquad_coefficients[base + 2] * x - biquad_coefficients[base + 4] * y;
        x = y;

        base = kBiquadHeadBump3 * 5;
        state_base = (static_cast<std::size_t>(kBiquadHeadBump3) * channels + ch) * 2u;
        y = biquad_coefficients[base] * x + biquad_state[state_base];
        biquad_state[state_base] = biquad_coefficients[base + 1] * x -
                                   biquad_coefficients[base + 3] * y + biquad_state[state_base + 1];
        biquad_state[state_base + 1] =
            biquad_coefficients[base + 2] * x - biquad_coefficients[base + 4] * y;
        x = y;

        index = static_cast<std::size_t>(kSectionReproduceEq) * channels + ch;
        y = section_b0[kSectionReproduceEq] * x + section_state[index];
        section_state[index] =
            section_b1[kSectionReproduceEq] * x - section_a1[kSectionReproduceEq] * y;
        x = y;

        index = static_cast<std::size_t>(kSectionReproduceEqB) * channels + ch;
        y = section_b0[kSectionReproduceEqB] * x + section_state[index];
        section_state[index] =
            section_b1[kSectionReproduceEqB] * x - section_a1[kSectionReproduceEqB] * y;
        x = y;

        // IEC 3180 us reproduce side, ahead of the hiss injection.
        index = static_cast<std::size_t>(kSectionPlayLf) * channels + ch;
        y = section_b0[kSectionPlayLf] * x + section_state[index];
        section_state[index] = section_b1[kSectionPlayLf] * x - section_a1[kSectionPlayLf] * y;
        x = y;

        // DC block.
        const double blocked = x - dc_input[ch] + dc_coefficient * dc_output[ch];
        dc_input[ch] = x;
        dc_output[ch] = blocked;
        x = blocked;

        if (noise_active) {
          rng_noise = nextRandom(rng_noise);
          const double hiss_draw = unsignedOf(rng_noise) * kRngScale - 1.0;
          index = static_cast<std::size_t>(kSectionHissHp) * channels + ch;
          y = section_b0[kSectionHissHp] * hiss_draw + section_state[index];
          section_state[index] =
              section_b1[kSectionHissHp] * hiss_draw - section_a1[kSectionHissHp] * y;
          double hiss = y;
          index = static_cast<std::size_t>(kSectionHissLp) * channels + ch;
          y = section_b0[kSectionHissLp] * hiss + section_state[index];
          section_state[index] = section_b1[kSectionHissLp] * hiss - section_a1[kSectionHissLp] * y;
          hiss = y * hiss_gain;

          rng_noise = nextRandom(rng_noise);
          const double modulation_draw = unsignedOf(rng_noise) * kRngScale - 1.0;
          index = static_cast<std::size_t>(kSectionModulation) * channels + ch;
          y = section_b0[kSectionModulation] * modulation_draw + section_state[index];
          section_state[index] =
              section_b1[kSectionModulation] * modulation_draw - section_a1[kSectionModulation] * y;
          double modulation = y * modulation_gain;
          if (modulation > 0.5) {
            modulation = 0.5;
          } else if (modulation < -0.5) {
            modulation = -0.5;
          }
          x = (x + hiss) * (1.0 + modulation);
        }

        // Dolby decoder, after the noise injection and before the output gain.
        if (dolby_fade_active) {
          const double decode_current = dolby_mode == 0 ? x : dolbyDecodeSample(dolby_mode, ch, x);
          const double decode_previous =
              dolby_prev_mode == 0 ? x : dolbyDecodeSample(dolby_prev_mode, ch, x);
          x = decode_previous + dolby_fade_weight * (decode_current - decode_previous);
        } else if (dolby_cur_stages != 0) {
          const std::size_t dec_base = dolby_cur_base +
                                       static_cast<std::size_t>(ch) * kDolbySlotsPerMode +
                                       kDolbySlotsPerDir;
          if (dolby_stage1) {
            const std::size_t b = dec_base + kDolbySlotsPerStage;
            double q = dolby_bank[b + 1] * dolby_inv_ref_dec * dolby_s1_ref_mul;
            q = q > kDolbyTableMaxQ ? kDolbyTableMaxQ : q;
            const double pos =
                std::sqrt(q * kDolbyTableInvMaxQ) * static_cast<double>(kDolbyTableSize);
            const int ti = static_cast<int>(pos);
            const double a = dolby_cur_table[ti] + (dolby_cur_table[ti + 1] - dolby_cur_table[ti]) *
                                                       (pos - static_cast<double>(ti));
            const double one_minus_a = 1.0 - a;
            const double direct = dolby_s1_as_b0 + dolby_s1_gain * one_minus_a * dolby_s1_skew_a;
            const double state_term =
                dolby_bank[b + 4] +
                dolby_s1_gain * one_minus_a *
                    ((1.0 - dolby_s1_skew_a) * dolby_bank[b + 2] - dolby_bank[b + 3]);
            const double z = (x - state_term) / direct;
            double k = z;
            if (dolby_s1_skew_a < 1.0) {
              k = dolby_bank[b + 2] + dolby_s1_skew_a * (z - dolby_bank[b + 2]);
              dolby_bank[b + 2] = k;
            }
            dolby_bank[b + 3] = dolby_bank[b + 3] + a * (k - dolby_bank[b + 3]);
            const double m = dolby_s1_as_b0 * z + dolby_bank[b + 4];
            dolby_bank[b + 4] = dolby_s1_as_b1 * z - dolby_s1_as_a1 * m;
            const double clp = dolby_bank[b] + dolby_s1_ctrl_a * (k - dolby_bank[b]);
            dolby_bank[b] = clp;
            const double magnitude_dec = std::fabs(k - clp);
            const double detector = dolby_bank[b + 1];
            const double detector_delta = magnitude_dec - detector;
            dolby_bank[b + 1] = detector +
                                dolby_s1_attack * (detector_delta > 0.0 ? detector_delta : 0.0) +
                                dolby_s1_release * (detector_delta <= 0.0 ? detector_delta : 0.0);
            x = z;
          }
          {
            double q = dolby_bank[dec_base + 1] * dolby_inv_ref_dec * dolby_s0_ref_mul;
            q = q > kDolbyTableMaxQ ? kDolbyTableMaxQ : q;
            const double pos =
                std::sqrt(q * kDolbyTableInvMaxQ) * static_cast<double>(kDolbyTableSize);
            const int ti = static_cast<int>(pos);
            const double a = dolby_cur_table[ti] + (dolby_cur_table[ti + 1] - dolby_cur_table[ti]) *
                                                       (pos - static_cast<double>(ti));
            const double one_minus_a = 1.0 - a;
            const double direct = dolby_s0_as_b0 + dolby_s0_gain * one_minus_a * dolby_s0_skew_a;
            const double state_term =
                dolby_bank[dec_base + 4] +
                dolby_s0_gain * one_minus_a *
                    ((1.0 - dolby_s0_skew_a) * dolby_bank[dec_base + 2] - dolby_bank[dec_base + 3]);
            const double z = (x - state_term) / direct;
            double k = z;
            if (dolby_s0_skew_a < 1.0) {
              k = dolby_bank[dec_base + 2] + dolby_s0_skew_a * (z - dolby_bank[dec_base + 2]);
              dolby_bank[dec_base + 2] = k;
            }
            dolby_bank[dec_base + 3] =
                dolby_bank[dec_base + 3] + a * (k - dolby_bank[dec_base + 3]);
            const double m = dolby_s0_as_b0 * z + dolby_bank[dec_base + 4];
            dolby_bank[dec_base + 4] = dolby_s0_as_b1 * z - dolby_s0_as_a1 * m;
            const double clp = dolby_bank[dec_base] + dolby_s0_ctrl_a * (k - dolby_bank[dec_base]);
            dolby_bank[dec_base] = clp;
            const double magnitude_dec = std::fabs(k - clp);
            const double detector = dolby_bank[dec_base + 1];
            const double detector_delta = magnitude_dec - detector;
            dolby_bank[dec_base + 1] =
                detector + dolby_s0_attack * (detector_delta > 0.0 ? detector_delta : 0.0) +
                dolby_s0_release * (detector_delta <= 0.0 ? detector_delta : 0.0);
            x = z;
          }
        }

        x *= output_gain;
        if (!(x > -16.0 && x < 16.0)) {
          x = x > 0.0 ? 16.0 : (x < 0.0 ? -16.0 : 0.0);
        }
        audio[offset + i] = static_cast<float>(dry + mix_ratio * (x - dry));
      }

      delay_position = (delay_position + 1) & delay_mask;
      oversample_position = (oversample_position + 1) & kOsMask;
      if (dolby_fade > 0) {
        dolby_fade--;
      }
    }

    const std::size_t channel_span = static_cast<std::size_t>(channels);
    flushDenormals(section_state, static_cast<std::size_t>(kSectionCount) * channel_span);
    flushDenormals(biquad_state, static_cast<std::size_t>(kBiquadCount) * 2u * channel_span);
    flushDenormals(dc_input, channel_span);
    flushDenormals(dc_output, channel_span);
    flushDenormals(envelope, channel_span);
    flushDenormals(oversample_input, static_cast<std::size_t>(kOsHistory) * channel_span);
    flushDenormals(oversample_even, static_cast<std::size_t>(kOsHistory) * channel_span);
    flushDenormals(oversample_odd, static_cast<std::size_t>(kOsHistory) * channel_span);
    flushDenormals(dolby_bank, static_cast<std::size_t>(2 * kDolbySlotsPerMode) * channel_span);

    delay_position_ = delay_position;
    dolby_fade_ = dolby_fade;
    oversample_position_ = oversample_position;
    capstan_phase_ = capstan_phase;
    hub_phase_ = hub_phase;
    flutter_a_ = flutter_a;
    flutter_b_ = flutter_b;
    rng_transport_ = rng_transport;
    rng_noise_ = rng_noise;
    rng_dropout_ = rng_dropout;
    rng_azimuth_ = rng_azimuth;
    az_wobble_a_ = az_wobble_a;
    az_wobble_b_ = az_wobble_b;
    dropout_budget_ = dropout_budget;
    dropout_shared_phase_ = dropout_shared_phase;
    dropout_shared_increment_ = dropout_shared_increment;
    dropout_shared_depth_ = dropout_shared_depth;
  }

private:
  void clearState() noexcept {
    for (double &value : section_state_) {
      value = 0.0;
    }
    for (double &value : biquad_state_) {
      value = 0.0;
    }
    for (double &value : envelope_) {
      value = 0.0;
    }
    for (double &value : dc_input_) {
      value = 0.0;
    }
    for (double &value : dc_output_) {
      value = 0.0;
    }
    for (double &value : oversample_input_) {
      value = 0.0;
    }
    for (double &value : oversample_even_) {
      value = 0.0;
    }
    for (double &value : oversample_odd_) {
      value = 0.0;
    }
    for (float &value : delay_buffers_) {
      value = 0.0F;
    }
    for (float &value : dry_buffers_) {
      value = 0.0F;
    }
    for (double &value : dolby_bank_) {
      value = 0.0;
    }
    for (double &value : az_table_) {
      value = 0.0;
    }
    for (double &value : dolby_table_b_) {
      value = 0.0;
    }
    for (double &value : dolby_table_c_) {
      value = 0.0;
    }
    for (double &value : dropout_local_phase_) {
      value = 1.0;
    }
    for (double &value : dropout_local_increment_) {
      value = 0.0;
    }
    for (double &value : dropout_local_depth_) {
      value = 0.0;
    }
    for (double &value : dropout_local_events_) {
      value = 0.0;
    }
    coefficients_ = {};
    for (double &value : biquad_coefficients_) {
      value = 0.0;
    }
    for (double &value : dolby_coef_b_) {
      value = 0.0;
    }
    for (double &value : dolby_coef_c_) {
      value = 0.0;
    }
    delay_position_ = 0;
    oversample_position_ = 0;
    capstan_phase_ = 0.0;
    hub_phase_ = 0.0;
    flutter_a_ = 0.0;
    flutter_b_ = 0.0;
    rng_transport_ = 0;
    rng_noise_ = 0;
    rng_dropout_ = 0;
    rng_azimuth_ = 0;
    az_wobble_a_ = 0.0;
    az_wobble_b_ = 0.0;
    az_coefficient_ = 0.0;
    az_wobble_scale_ = 0.0;
    az_wobble_sd_radians_ = 0.0;
    az_wobble_clamp_radians_ = 0.0;
    az_table_scale_ = 0.0;
    az_half_delay_scale_ = 0.0;
    dropout_budget_ = -1.0;
    dropout_shared_phase_ = 1.0;
    dropout_shared_increment_ = 0.0;
    dropout_shared_depth_ = 0.0;
    dropout_shared_events_ = 0.0;
    dolby_mode_ = -1;
    dolby_prev_mode_ = 0;
    dolby_fade_ = 0;
    dolby_fade_length_ = 1;
    hiss_gain_ = 0.0;
    modulation_gain_ = 0.0;
    saturation_base_ = 1.0;
    memory_scale_ = 0.0;
    attack_coefficient_ = 0.0;
    release_coefficient_ = 0.0;
    dc_coefficient_ = 0.0;
    capstan_increment_ = 0.0;
    hub_increment_ = 0.0;
    capstan_delay_per_percent_ = 0.0;
    hub_delay_per_percent_ = 0.0;
    flutter_coefficient_a_ = 0.0;
    flutter_coefficient_b_ = 0.0;
    flutter_delay_per_percent_ = 0.0;
    base_delay_samples_ = 0.0;
    has_configuration_ = false;
  }

  // Mirrors the JavaScript state block, which is rebuilt whenever the host rate
  // or the channel count changes and draws one seed from the seeded source as
  // it is built.
  void createState(std::uint32_t channel_count) noexcept {
    clearState();
    // Math.round rounds halves towards positive infinity.
    const double fade_length = std::floor(kDolbyFadeSeconds * sample_rate_ + 0.5);
    dolby_fade_length_ = fade_length > 1.0 ? static_cast<std::int32_t>(fade_length) : 1;
    const double draw = random_.nextFloat01();
    std::int32_t seed =
        static_cast<std::int32_t>(static_cast<std::uint32_t>(std::floor(draw * 4294967296.0)));
    if (seed == 0) {
      seed = kSeedFallback;
    }
    rng_transport_ = deriveRngStream(seed, kSaltTransport);
    rng_noise_ = deriveRngStream(seed, kSaltNoise);
    rng_dropout_ = deriveRngStream(seed, kSaltDropout);
    rng_azimuth_ = deriveRngStream(seed, kSaltAzimuth);
    // A fixed two-draw prefix ahead of any per-sample consumption.
    std::int32_t phase_draw = nextRandom(rng_transport_);
    capstan_phase_ = kTwoPi * (unsignedOf(phase_draw) * kRngUnit);
    phase_draw = nextRandom(phase_draw);
    hub_phase_ = kTwoPi * (unsignedOf(phase_draw) * kRngUnit);
    rng_transport_ = phase_draw;
    configured_ = true;
    last_channel_count_ = channel_count;
  }

  void updateConfiguration(int type_index, int grade_index, double bias_db,
                           double hiss_db) noexcept {
    const TypeEntry &type_entry = kTypes[type_index];
    const GradeEntry &grade = kGrades[grade_index];
    SectionCoefficients &coefficients = coefficients_;
    const double two_fs = 2.0 * sample_rate_;
    const double bias = std::pow(10.0, bias_db / 20.0);
    const double trim_max_gain = std::pow(10.0, grade.trimMaxDb / 20.0);

    // Record pre-emphasis, normalised to 0 dB at 1 kHz: two identical
    // first-order shelves whose product is inverted section by section.
    const double record_pre_tau = type_entry.eqUs * 1e-6;
    const double record_pre_gain = std::pow(10.0, type_entry.preEmphDb / 40.0);
    firstOrder(record_pre_tau, record_pre_tau / record_pre_gain, two_fs, coefficients,
               kSectionRecordEq);
    const double reference_omega = kTwoPi * kEqReferenceHz / sample_rate_;
    const double reference_magnitude =
        sectionMagnitude(coefficients, kSectionRecordEq, reference_omega);
    scaleSection(coefficients, kSectionRecordEq,
                 reference_magnitude > 1.0e-30 ? 1.0 / reference_magnitude : 1.0);
    coefficients.b0[kSectionRecordEqB] = coefficients.b0[kSectionRecordEq];
    coefficients.b1[kSectionRecordEqB] = coefficients.b1[kSectionRecordEq];
    coefficients.a1[kSectionRecordEqB] = coefficients.a1[kSectionRecordEq];
    invertSection(coefficients, kSectionRecordEq, kSectionReproduceEq);
    invertSection(coefficients, kSectionRecordEqB, kSectionReproduceEqB);

    // Playback wavelength loss, each already multiplied by its bounded trim.
    const double thickness_hz = kThicknessThreeDb * kVelocity / (kTwoPi * type_entry.coating);
    const double gap_hz = kGapThreeDb * kVelocity / (kPi * kPlayGapMeters);
    const double spacing_hz = kSpacingThreeDb * kVelocity / (kTwoPi * kSpacingMeters);
    const double short_hz =
        1.0 / std::sqrt(1.0 / (gap_hz * gap_hz) + 1.0 / (spacing_hz * spacing_hz));
    firstOrder(0.0, 1.0 / (kTwoPi * thickness_hz * trim_max_gain), two_fs, coefficients,
               kSectionLossA);
    firstOrder(0.0, 1.0 / (kTwoPi * short_hz * trim_max_gain), two_fs, coefficients, kSectionLossB);

    // IEC 3180 us pair: bounded record-side flux boost, exact reproduce
    // high-pass.
    const double lf_boost = std::pow(10.0, grade.lfBoostMaxDb / 20.0);
    firstOrder(kLfTau, kLfTau * lf_boost, two_fs, coefficients, kSectionRecordLf);
    scaleSection(coefficients, kSectionRecordLf, lf_boost);
    firstOrder(kLfTau, kLfTau, two_fs, coefficients, kSectionPlayLf);
    coefficients.b0[kSectionPlayLf] = (1.0 - coefficients.a1[kSectionPlayLf]) * 0.5;
    coefficients.b1[kSectionPlayLf] = -coefficients.b0[kSectionPlayLf];

    // Bias erasure.
    const double bias_hz = kBiasCornerHz / std::pow(bias, kBiasCornerExponent);
    firstOrder(0.0, 1.0 / (kTwoPi * bias_hz), two_fs, coefficients, kSectionBias);

    // Short-wavelength sensitivity shelf, solved so that the 10 kHz probe drop
    // from the sensitivity peak to bs = 0 is the Type's dS10.
    const double delta_s10_db = type_entry.deltaS10Db;
    const double shelf_omega = kTwoPi * kBiasShelfHz;
    const double probe_hz = kBiasProbeHz < sample_rate_ * 0.45 ? kBiasProbeHz : sample_rate_ * 0.45;
    const double probe_omega = kTwoPi * probe_hz / sample_rate_;
    const double peak_bs = -std::sqrt(delta_s10_db / kBiasPeakCurvature);
    const double erasure_tau = 1.0 / (kTwoPi * kBiasCornerHz);
    firstOrder(0.0, erasure_tau * std::pow(std::pow(10.0, peak_bs / 20.0), kBiasCornerExponent),
               two_fs, coefficients, kSectionBiasShelf);
    const double peak_erasure = sectionMagnitude(coefficients, kSectionBiasShelf, probe_omega);
    firstOrder(0.0, erasure_tau, two_fs, coefficients, kSectionBiasShelf);
    const double shelf_target = std::pow(10.0, delta_s10_db / 20.0) *
                                sectionMagnitude(coefficients, kSectionBiasShelf, probe_omega) /
                                peak_erasure;
    double shelf_low = 1.0;
    double shelf_high = 1.0e6;
    for (int i = 0; i < 30; i++) {
      const double trial = std::sqrt(shelf_low * shelf_high);
      const double trial_root = std::sqrt(trial);
      firstOrder(trial_root / shelf_omega, 1.0 / (trial_root * shelf_omega), two_fs, coefficients,
                 kSectionBiasShelf);
      if (sectionMagnitude(coefficients, kSectionBiasShelf, probe_omega) < shelf_target) {
        shelf_low = trial;
      } else {
        shelf_high = trial;
      }
    }
    const double peak_radius = std::sqrt(peak_bs * peak_bs + kBiasPeakWidthDb * kBiasPeakWidthDb);
    const double shelf_slope =
        20.0 * std::log10(std::sqrt(shelf_low * shelf_high)) / (peak_radius - kBiasPeakWidthDb);
    const double bias_offset = bias_db - peak_bs;
    double shelf_gain_db =
        shelf_slope *
        (peak_radius - std::sqrt(bias_offset * bias_offset + kBiasPeakWidthDb * kBiasPeakWidthDb));
    if (shelf_gain_db > kBiasShelfLimitDb) {
      shelf_gain_db = kBiasShelfLimitDb;
    }
    if (shelf_gain_db < -kBiasShelfLimitDb) {
      shelf_gain_db = -kBiasShelfLimitDb;
    }
    const double bias_shelf_gain = std::pow(10.0, shelf_gain_db / 20.0);
    if (bias_shelf_gain == 1.0) {
      coefficients.b0[kSectionBiasShelf] = 1.0;
      coefficients.b1[kSectionBiasShelf] = 0.0;
      coefficients.a1[kSectionBiasShelf] = 0.0;
    } else {
      const double shelf_root = std::sqrt(bias_shelf_gain);
      firstOrder(shelf_root / shelf_omega, 1.0 / (shelf_root * shelf_omega), two_fs, coefficients,
                 kSectionBiasShelf);
    }

    // Noise shaping.
    const double hiss_high_tau = 1.0 / (kTwoPi * kHissHighPassHz);
    firstOrder(hiss_high_tau, hiss_high_tau, two_fs, coefficients, kSectionHissHp);
    coefficients.b0[kSectionHissHp] = (1.0 - coefficients.a1[kSectionHissHp]) * 0.5;
    coefficients.b1[kSectionHissHp] = -coefficients.b0[kSectionHissHp];
    const double hiss_low_hz =
        kHissLowPassHz < sample_rate_ * 0.45 ? kHissLowPassHz : sample_rate_ * 0.45;
    firstOrder(0.0, 1.0 / (kTwoPi * hiss_low_hz), two_fs, coefficients, kSectionHissLp);
    const double modulation_hz = kVelocity / (kTwoPi * kModulationLengthMeters);
    firstOrder(0.0, 1.0 / (kTwoPi * modulation_hz), two_fs, coefficients, kSectionModulation);

    // Band limits.
    const double record_bandwidth_hz = grade.recordBandwidthHz;
    const double record_hz =
        record_bandwidth_hz < sample_rate_ * 0.45 ? record_bandwidth_hz : sample_rate_ * 0.45;
    lowPassBiquad(biquad_coefficients_, kBiquadRecordAmp, record_hz, 0.7071067811865476,
                  sample_rate_);
    // Head contour: alternating lobes at k v / L, amplitude (-1)^(k+1) A / k
    // and Q_k = k Q_1. Unused lobes are exact pass-throughs.
    const double bump_hz = kVelocity / grade.contactLengthM;
    const int bump_indices[3] = {kBiquadHeadBump, kBiquadHeadBump2, kBiquadHeadBump3};
    for (int lobe = 0; lobe < 3; lobe++) {
      const int order = lobe + 1;
      const double lobe_hz = bump_hz * static_cast<double>(order);
      if (order > grade.contourLobes || !(lobe_hz < sample_rate_ * 0.45)) {
        const int pass_base = bump_indices[lobe] * 5;
        biquad_coefficients_[pass_base] = 1.0;
        biquad_coefficients_[pass_base + 1] = 0.0;
        biquad_coefficients_[pass_base + 2] = 0.0;
        biquad_coefficients_[pass_base + 3] = 0.0;
        biquad_coefficients_[pass_base + 4] = 0.0;
        continue;
      }
      const double lobe_db =
          (order % 2 == 1 ? 1.0 : -1.0) * grade.headBumpDb / static_cast<double>(order);
      peakingBiquad(biquad_coefficients_, bump_indices[lobe], lobe_hz,
                    kHeadBumpQ * static_cast<double>(order), lobe_db, sample_rate_);
    }

    // Saturation operating point.
    saturation_base_ = (kSaturationReferencePeak / kSaturationReferenceT) *
                       std::pow(10.0, type_entry.headroomDb / 20.0) * std::pow(bias, 0.7);
    memory_scale_ = kMemoryDepth / saturation_base_;
    attack_coefficient_ = 1.0 - std::exp(-1.0 / (kMemoryAttackSeconds * sample_rate_ * 2.0));
    release_coefficient_ = 1.0 - std::exp(-1.0 / (kMemoryReleaseSeconds * sample_rate_ * 2.0));
    dc_coefficient_ = std::exp(-kTwoPi * kDcBlockHz / sample_rate_);

    // Noise levels, solved in the flux domain.
    const bool hiss_enabled = hiss_db > kHissOffDb;
    const double type_floor_db = type_entry.hissFloorDb;
    const double noise_offset_db = hiss_db - kHissReferenceDb;
    const double sine_rms = 0.7071067811865476;
    const double hiss_rms =
        hiss_enabled
            ? std::pow(10.0, (type_floor_db + noise_offset_db + kSaturationReferenceDbfs) / 20.0) *
                  sine_rms
            : 0.0;
    const double modulation_depth =
        hiss_enabled ? std::pow(10.0, (type_entry.dcnDb + noise_offset_db) / 20.0) : 0.0;
    const double uniform_rms = 0.5773502691896258;
    const int hiss_indices[2] = {kSectionHissHp, kSectionHissLp};
    const int modulation_indices[1] = {kSectionModulation};
    const double hiss_shape_gain = cascadeNoiseGain(coefficients, hiss_indices, 2,
                                                    kNoiseIntegrationPoints, sample_rate_, true);
    const double modulation_shape_gain = cascadeNoiseGain(
        coefficients, modulation_indices, 1, kNoiseIntegrationPoints, sample_rate_, false);
    hiss_gain_ = hiss_rms / (uniform_rms * hiss_shape_gain);
    modulation_gain_ = modulation_depth / (uniform_rms * modulation_shape_gain);

    // Transport: the speed is fixed, so there is no depth exponent.
    capstan_increment_ = kTwoPi * kCapstanHz / sample_rate_;
    hub_increment_ = kTwoPi * kHubHz / sample_rate_;
    capstan_delay_per_percent_ = kCapstanSpeedPerPercent * sample_rate_ / (kTwoPi * kCapstanHz);
    hub_delay_per_percent_ = kHubSpeedPerPercent * sample_rate_ / (kTwoPi * kHubHz);
    const double flutter_band_coefficient = 1.0 - std::exp(-kTwoPi * kFlutterBandHz / sample_rate_);
    const double flutter_floor_coefficient =
        1.0 - std::exp(-kTwoPi * kFlutterFloorHz / sample_rate_);
    flutter_coefficient_a_ = flutter_band_coefficient;
    flutter_coefficient_b_ = flutter_floor_coefficient;
    double flutter_diff_variance = 0.0;
    const double flutter_band_pole = 1.0 - flutter_band_coefficient;
    const double flutter_floor_pole = 1.0 - flutter_floor_coefficient;
    for (int k = 0; k < kTransportIntegrationPoints; k++) {
      const double omega =
          kPi * (static_cast<double>(k) + 0.5) / static_cast<double>(kTransportIntegrationPoints);
      const double cosine = std::cos(omega);
      const double band_mag_sq =
          (flutter_band_coefficient * flutter_band_coefficient) /
          (1.0 - 2.0 * flutter_band_pole * cosine + flutter_band_pole * flutter_band_pole);
      const double floor_mag_sq =
          (flutter_floor_coefficient * flutter_floor_coefficient) /
          (1.0 - 2.0 * flutter_floor_pole * cosine + flutter_floor_pole * flutter_floor_pole);
      flutter_diff_variance += (2.0 - 2.0 * cosine) * band_mag_sq * floor_mag_sq;
    }
    flutter_diff_variance =
        (flutter_diff_variance / static_cast<double>(kTransportIntegrationPoints)) / 3.0;
    flutter_delay_per_percent_ =
        kFlutterSpeedPerPercent /
        std::sqrt(flutter_diff_variance > 1.0e-30 ? flutter_diff_variance : 1.0e-30);
    // Math.round rounds halves towards positive infinity.
    base_delay_samples_ = std::floor(kTransportBaseSeconds * sample_rate_ + 0.5);

    // Azimuth: the in-track loss coefficients are tabulated over |theta|.
    const double az_table_max_radians =
        (kAzMaxArcmin + kAzWobbleClampSigma * grade.azWobbleArcmin) * kArcminToRadians;
    az_table_scale_ = static_cast<double>(kAzTableSize) / az_table_max_radians;
    double *az_table = az_table_.data();
    for (int i = 0; i <= kAzTableSize + 1; i++) {
      // The last entry is duplicated so the lerp's i+1 read stays in bounds.
      const int index = i <= kAzTableSize ? i : kAzTableSize;
      const double theta =
          az_table_max_radians * static_cast<double>(index) / static_cast<double>(kAzTableSize);
      const double tau_a = kTrackWidthMeters * theta / kVelocity;
      firstOrder(0.0, tau_a * kAzPoleTauRatio, two_fs, coefficients, kSectionScratch);
      az_table[static_cast<std::size_t>(i) * 3u] = coefficients.b0[kSectionScratch];
      az_table[static_cast<std::size_t>(i) * 3u + 1u] = coefficients.b1[kSectionScratch];
      az_table[static_cast<std::size_t>(i) * 3u + 2u] = coefficients.a1[kSectionScratch];
    }
    az_half_delay_scale_ = 0.5 * kTrackSpacingMeters / kVelocity * sample_rate_;
    const double az_coefficient = 1.0 - std::exp(-kTwoPi * kAzWobbleCornerHz / sample_rate_);
    const double az_pole = 1.0 - az_coefficient;
    const double az_pole_sq = az_pole * az_pole;
    const double az_unit_variance =
        std::pow(az_coefficient, 4.0) * (1.0 + az_pole_sq) / std::pow(1.0 - az_pole_sq, 3.0);
    const double az_wobble_sd_radians = grade.azWobbleArcmin * kArcminToRadians;
    az_coefficient_ = az_coefficient;
    az_wobble_sd_radians_ = az_wobble_sd_radians;
    az_wobble_scale_ =
        az_wobble_sd_radians /
        (uniform_rms * std::sqrt(az_unit_variance > 1.0e-30 ? az_unit_variance : 1.0e-30));
    az_wobble_clamp_radians_ = kAzWobbleClampSigma * az_wobble_sd_radians;

    // Dolby B/C: level -> coefficient tables and packed stage coefficients,
    // both modes unconditionally, because a crossfade keeps the outgoing mode
    // running.
    buildDolbyMode(kDolbyStagesB, 1, dolby_table_b_.data(), dolby_coef_b_, coefficients, two_fs);
    buildDolbyMode(kDolbyStagesC, 2, dolby_table_c_.data(), dolby_coef_c_, coefficients, two_fs);
  }

  void buildDolbyMode(const DolbyStage *stages, int stage_count, double *table, double *coef,
                      SectionCoefficients &coefficients, double two_fs) noexcept {
    // All stages of a mode share the quiescent corner, so one table serves the
    // mode; the stagger lives in the per-stage reference multiplier.
    const double quiescent_hz = stages[0].cornerHz;
    for (int i_t = 0; i_t <= kDolbyTableSize + 1; i_t++) {
      const int idx = i_t <= kDolbyTableSize ? i_t : kDolbyTableSize;
      const double warped = static_cast<double>(idx) / static_cast<double>(kDolbyTableSize);
      const double q = warped * warped * kDolbyTableMaxQ;
      const double slide = std::pow(1.0 + q / kDolbySlideQThreshold, kDolbySlideExponent);
      const double argument = kTwoPi * quiescent_hz * slide / sample_rate_;
      table[i_t] = argument > 30.0 ? 1.0 : 1.0 - std::exp(-argument);
    }
    for (int st = 0; st < stage_count; st++) {
      const DolbyStage &stage = stages[st];
      const int c_base = st * kDolbyCoefStride;
      coef[c_base] = std::pow(10.0, stage.maxBoostDb / 20.0) - 1.0;
      coef[c_base + 1] = 1.0 - std::exp(-kTwoPi * stage.cornerHz / sample_rate_);
      const double skew_hz =
          stage.skewHz < sample_rate_ * 0.45 ? stage.skewHz : sample_rate_ * 0.45;
      coef[c_base + 2] =
          stage.skewHz > 0.0 ? 1.0 - std::exp(-kTwoPi * skew_hz / sample_rate_) : 1.0;
      if (stage.antiSatZeroHz > 0.0) {
        firstOrder(1.0 / (kTwoPi * stage.antiSatZeroHz), 1.0 / (kTwoPi * stage.antiSatPoleHz),
                   two_fs, coefficients, kSectionScratch);
        coef[c_base + 3] = coefficients.b0[kSectionScratch];
        coef[c_base + 4] = coefficients.b1[kSectionScratch];
        coef[c_base + 5] = coefficients.a1[kSectionScratch];
      } else {
        coef[c_base + 3] = 1.0;
        coef[c_base + 4] = 0.0;
        coef[c_base + 5] = 0.0;
      }
      coef[c_base + 6] = 1.0 - std::exp(-1.0 / (stage.attackMs * 0.001 * sample_rate_));
      coef[c_base + 7] = 1.0 - std::exp(-1.0 / (stage.releaseMs * 0.001 * sample_rate_));
      coef[c_base + 8] = std::pow(10.0, -stage.refOffsetDb / 20.0);
    }
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool configured_ = false;
  bool has_configuration_ = false;
  int configuration_type_ = -1;
  int configuration_grade_ = -1;
  int configuration_nr_ = -1;
  double configuration_bias_ = 0.0;
  double configuration_hiss_ = 0.0;
  SectionCoefficients coefficients_{};
  double biquad_coefficients_[kBiquadCount * 5]{};
  double dolby_coef_b_[kDolbyCoefStride]{};
  double dolby_coef_c_[2 * kDolbyCoefStride]{};
  std::vector<double> section_state_;
  std::vector<double> biquad_state_;
  std::vector<double> envelope_;
  std::vector<double> dc_input_;
  std::vector<double> dc_output_;
  std::vector<double> oversample_input_;
  std::vector<double> oversample_even_;
  std::vector<double> oversample_odd_;
  std::vector<float> delay_buffers_;
  std::vector<float> dry_buffers_;
  std::vector<double> dropout_local_phase_;
  std::vector<double> dropout_local_increment_;
  std::vector<double> dropout_local_depth_;
  std::vector<double> dropout_local_events_;
  std::vector<double> dolby_bank_;
  std::vector<double> az_table_;
  std::vector<double> dolby_table_b_;
  std::vector<double> dolby_table_c_;
  // Chosen from the host rate in prepare() and never touched after it, so
  // clearState() deliberately leaves both alone.
  std::int32_t delay_length_ = kRingMinLength;
  std::int32_t delay_mask_ = kRingMinLength - 1;
  std::int32_t delay_position_ = 0;
  std::int32_t oversample_position_ = 0;
  double capstan_phase_ = 0.0;
  double hub_phase_ = 0.0;
  double flutter_a_ = 0.0;
  double flutter_b_ = 0.0;
  std::int32_t rng_transport_ = 0;
  std::int32_t rng_noise_ = 0;
  std::int32_t rng_dropout_ = 0;
  std::int32_t rng_azimuth_ = 0;
  double az_wobble_a_ = 0.0;
  double az_wobble_b_ = 0.0;
  double az_coefficient_ = 0.0;
  double az_wobble_scale_ = 0.0;
  double az_wobble_sd_radians_ = 0.0;
  double az_wobble_clamp_radians_ = 0.0;
  double az_table_scale_ = 0.0;
  double az_half_delay_scale_ = 0.0;
  double dropout_budget_ = -1.0;
  double dropout_shared_phase_ = 1.0;
  double dropout_shared_increment_ = 0.0;
  double dropout_shared_depth_ = 0.0;
  double dropout_shared_events_ = 0.0;
  int dolby_mode_ = -1;
  int dolby_prev_mode_ = 0;
  std::int32_t dolby_fade_ = 0;
  std::int32_t dolby_fade_length_ = 1;
  double hiss_gain_ = 0.0;
  double modulation_gain_ = 0.0;
  double saturation_base_ = 1.0;
  double memory_scale_ = 0.0;
  double attack_coefficient_ = 0.0;
  double release_coefficient_ = 0.0;
  double dc_coefficient_ = 0.0;
  double capstan_increment_ = 0.0;
  double hub_increment_ = 0.0;
  double capstan_delay_per_percent_ = 0.0;
  double hub_delay_per_percent_ = 0.0;
  double flutter_coefficient_a_ = 0.0;
  double flutter_coefficient_b_ = 0.0;
  double flutter_delay_per_percent_ = 0.0;
  double base_delay_samples_ = 0.0;
  dsp::XorShiftRng random_{};
};

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(CassetteArtifactsPlugin, effetune::plugins::lofi::CassetteArtifactsKernel)

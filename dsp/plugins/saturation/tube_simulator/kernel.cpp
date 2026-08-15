#include "effetune/kernel.h"
#include "effetune/telemetry.h"
#include "fir_coefficients.generated.h"
#include "phase_c_tables.generated.h"
#include "tube_feedback_table.generated.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

#if __has_include("TubeSimulatorPluginParams.h")
#include "TubeSimulatorPluginParams.h"
#else
namespace effetune::generated {

struct TubeSimulatorPluginParams {
  float inputVolume;
  float tube;
  float bias;
  float plate;
  float sourceZ;
  float supply;
  float outputTrim;
  float mix;
  float inputReference;
  float negativeFeedback;
  float outputStage;
  float powerTube;
  float powerBPlus;
  float cathodeResistor;
  float screenTap;
  float primaryImpedance;
  float speakerLoad;
  float actualSpeakerLoad;
  float safetyTrim;
  float autoGainReduction;
  float seTube;
  float seBPlus;
  float seCathodeResistor;
  float sePrimaryImpedance;
  static constexpr std::uint32_t kHash = 0u;
  static constexpr std::uint32_t kFloatCount = 24u;
};
static_assert(sizeof(TubeSimulatorPluginParams) == sizeof(float) * 24u);

} // namespace effetune::generated
#endif

namespace effetune::plugins::saturation {
namespace {

constexpr int kChannels = 2;
constexpr int kDryDelayFrames = 64;
struct RateConfig {
  double hostRate;
  double internalRate;
  double fastDt;
  double slowDt;
  double firCutoffHz;
  int factor;
  int firLength;
  int slowWindow;
};

constexpr std::array<RateConfig, 6> kRateConfigs = {{
    {44100.0, 352800.0, 1.0 / 352800.0, 22.0 / 352800.0, 22050.0, 8, 513, 22},
    {48000.0, 384000.0, 1.0 / 384000.0, 1.0 / 16000.0, 24000.0, 8, 513, 24},
    {88200.0, 352800.0, 1.0 / 352800.0, 22.0 / 352800.0, 34000.0, 4, 257, 22},
    {96000.0, 384000.0, 1.0 / 384000.0, 1.0 / 16000.0, 34000.0, 4, 257, 24},
    {176400.0, 352800.0, 1.0 / 352800.0, 22.0 / 352800.0, 34000.0, 2, 129, 22},
    {192000.0, 384000.0, 1.0 / 384000.0, 1.0 / 16000.0, 34000.0, 2, 129, 24},
}};

[[nodiscard]] constexpr const RateConfig *findRateConfig(double host_rate) noexcept {
  for (const RateConfig &config : kRateConfigs) {
    if (config.hostRate == host_rate) {
      return &config;
    }
  }
  return nullptr;
}
constexpr double kGridOn = -0.05;
constexpr double kGridScale = 0.04;
constexpr double kGridK = 0.00049032711558883520;
constexpr double kGridAlpha = 1.5;
constexpr double kGridLeakResistance = 470000.0;
constexpr double kBaseCathodeResistance = 1500.0;
constexpr double kBasePlateResistance = 100000.0;
constexpr double kCouplingCapacitance = 22e-9;
constexpr double kCathodeCapacitance = 22e-6;
constexpr double kOutputCapacitance = 220e-9;
constexpr double kOutputLoadResistance = 100000.0;
constexpr double kGmin = 1e-9;
constexpr double kGamma = 2.0 - 1.41421356237309504880168872420969808;
constexpr double kMinimumMillerCapacitance = 0.25e-12;
constexpr double kMaximumMillerCapacitance = 2e-9;
constexpr double kMaximumGridVoltage = 500.0;
constexpr double kMaximumCouplingEquivalentVoltage = 2000.0;
constexpr double kMinimumLocalPlateGain = -1000.0;
constexpr double kMaximumLocalPlateGain = 100.0;
constexpr double kMaximumOutputVoltage = 1000.0;
constexpr double kControlSmoothingMilliseconds = 5.0;
constexpr double kFeedbackTransitionMilliseconds = 5.0;
constexpr double kFeedbackWarmupMilliseconds = 50.0;
constexpr double kFeedbackDetectorWindowMilliseconds = 10.0;
// Output-stage equipment protection. This is not part of the amplifier model: it lives behind
// the model as a linear scalar on the wet path, so the model's own overload character reaches
// the listener unchanged and only its level moves. What it suppresses is digital full-scale
// overshoot; the distortion the model generates is real amplifier behaviour and stays.
//
// The quantity measured is the instantaneous magnitude of every sample, not an averaged level.
// An average reads lower than the true peak by the crest factor of the material, so a programme
// measurement can sit well inside the threshold while the samples themselves run past full
// scale. That is exactly what a 100 ms RMS window did here: with a Circuit preset and
// full-scale music the reduction stayed at 0.0 dB while the output reached about +6 dBFS.
//
// The threshold is a policy value, not a fitted one: 1.0 is digital full scale, the level past
// which a converter cannot reproduce the sample at all.
constexpr double kSafetyPeakThreshold = 1.0;
// One-way ramp. Only ever downward, so no release constant exists.
constexpr double kSafetyRampMilliseconds = 20.0;
// The frozen Float32 goldens are a baseline of the whole plug-in, safety mechanism
// included: four of the eight cases run past full scale at their detection point and are
// recorded with the reduction applied. They are no longer a recording of the amplifier
// model alone. Running a case with Auto Gain Reduction off reproduces the pre-mechanism
// bytes exactly, which is how the two are told apart.
constexpr double kFeedbackTrialMilliseconds = 100.0;
constexpr double kFeedbackGrowthRatio = 1.15;
constexpr double kFeedbackNonDecayRatio = 1.0 / kFeedbackGrowthRatio;
constexpr std::uint32_t kFeedbackGrowthWindows = 3u;
// The feedback detector watches two different physical failures, and the two
// output stages of this plugin fail in different ways, so the thresholds belong
// to the stage rather than to the detector.
//
// The line stage diverges. Its loop has no clipping element that limits the
// travelling wave, so once it goes unstable the wet output and the plate tap run
// away past full scale within tens of milliseconds. A level floor above full
// scale, compared window against window at the 10 ms window, identifies that and
// nothing else.
//
// The power stage does not diverge. Its valves clip, so an unstable loop settles
// into a limit cycle at 0.2 to 0.5 of the 25 V output reference with the
// secondary feedback tap at 1.1 to 7.4 per cent of the output. Three facts,
// measured on the three canonical power circuits at 44.1/48/96/192 kHz with
// 0.9 FS noise for one second followed by silence, fix what the power stage
// needs (10 ms detector windows, output normalised by the 25 V reference):
//
//   quiescent residual, no instability   output <= 9.2e-7   tap <= 3.6e-8
//   established limit cycle              output >= 2.0e-1   tap >= 4.7e-3
//   low-frequency thump after the burst  output <= 6.9e-1   tap <= 2.7e-2
//
// The first two lines are why the line stage's floors are unreachable here and
// why a floor placed on the power stage's own scale has two decades of margin on
// either side. The third line is why a floor alone cannot decide: the thump that
// every one of these circuits produces when a loud passage stops is louder than
// the weakest limit cycle. What separates them is time. The thump is the tail of
// a stable circuit and rings down as a clean exponential - 12.3 dB/s at the
// slowest setting measured that is still stable - while a limit cycle rings down
// at nothing. The existing non-decay ratio cannot see that at the 10 ms window,
// because 1.15 over 10 ms is a decay rate of 121 dB/s and every ring-down reads
// as "not decaying" against it. So the power stage evaluates the same predicates
// over a coarse window accumulated from 25 of the 10 ms windows: over 250 ms the
// slowest stable ring-down loses 3.1 dB where the ratio asks for 1.22 dB, and a
// limit cycle loses nothing. Three consecutive coarse windows latch, so a power
// stage that is oscillating is muted one second after the input goes silent.
//
// The post-input branch also has to decide that the input is no longer what is
// driving the loop, and comparing the input against zero only decides that on a
// file. A live input never reaches bit-exact zero: an ADC noise floor sits at
// -90 to -110 dBFS, 24-bit dither at 2^-23, an upstream effect leaves a tail,
// and one non-zero sample was enough to hold the branch shut for good. A level
// floor on the input cannot stand in for it either - a canonical circuit fed a
// steady 2.0e-6 puts 2.79e-4 through the output floor, so an input floor loose
// enough to cover dither false-latches a shipped preset.
//
// What narrows the two states down is the loop's own return ratio. The
// secondary tap is the signal the loop subtracts from the input, so while the
// input is driving a stable loop the tap is the input times T/(1+T) and cannot
// much exceed it. Over 1026 takes of the shipped power presets - six sample
// rates, five stopping signals, five residual floors, and steady sine, noise and
// programme material from -120 dBFS to full scale - the coarse tap stayed at or
// below 0.383 of the coarse input for as long as the input was actually driving
// the stage, and the largest driven ratio measured anywhere is 0.713. That bound
// holds over the driven interval only. Once the input decays to a residual the
// numerator is the circuit's own tail and the denominator is whatever is left of
// the input, so the ratio diverges as the residual falls, on stable presets as
// much as on oscillating ones: coarse window 3 of the shipped
// power-el34-distributed-20-37w preset at its canonical nf = 4 reads 43.8, more
// than fourteen times the gate, and the three canonical power circuits - all of
// them stable - read 1.17e4 to 2.09e4 against a 1e-9 residual and 98 to 175
// against a 24-bit dither floor, against the 262 to 291 an oscillating stage
// reads on a -90 dBFS ADC floor. Below roughly -60 dBFS of residual the ratio
// does not separate the two states at all and the gate is simply true.
//
// What separates them there is the coarse non-decay test, on its own. Against
// the 1.2140 dB it asks for over 250 ms, the worst coarse window of a shipped
// power preset loses 12.43 to 14.05 dB - 10.2 to 11.6 times the requirement -
// and 5.57 dB at nf = 10, still 4.6 times. Shorten the coarse window span or
// loosen the non-decay ratio and shipped presets false-latch immediately. The
// gate cannot stand in for it.
//
// The gate value has a band of its own, measured at [0.72, 8.30]. Below the
// largest driven ratio, 0.713, driven windows start passing it. Above 8.30 the
// capture of power-el84-pentode-10w at nf = 16 with a -60 dBFS residual is lost:
// its three qualifying coarse windows read 8.30 / 9.14 / 9.27, so gates 3 and 8
// latch and leave a -64.77 dBFS tail while gates 12 and 16 do not latch and
// leave the limit cycle audible at -7.31 dBFS. Three sits near the logarithmic
// centre of that band, 4.2 times above the lower edge and 2.77 times below the
// upper. A drive ratio of zero selects the bit-exact-zero test instead, which is
// what the line stage keeps.
//
// The growth branch had the same blind spot in its own form. It compared the
// output and the tap against their own previous windows and never looked at the
// input, so anything that made the input grow by fifteen per cent per 10 ms
// window for three windows satisfied it, and that is an ordinary swell. Measured
// on the shipped line presets at every sample rate, a 1 kHz tone rising from
// silence to 0.3 FS or more over 50 ms to 500 ms latched the fault and left the
// plugin in permanent dry bypass, as did tremolo'd programme material at any
// attack time at all - 646 of 2652 takes. The predicates now ask whether the
// loop is growing faster than it is being driven, which is what running away
// means and what the branch was always meant to say: the window ratio has to
// beat the input's own window ratio by the same factor. A swell moves both
// together, so the ratio of ratios sits at 1.00 against a threshold of 1.15,
// while a loop that has come off its leash owes nothing to the input. It is
// written as a product so that a silent window, where both inputs are zero,
// keeps the plain ratio test the line stage was calibrated on.
struct FeedbackDetectorProfile {
  double growthOutputRms;
  double growthFeedbackRms;
  double sustainedOutputRms;
  double sustainedFeedbackRms;
  // How many times the coarse secondary tap has to exceed the coarse input
  // before the input counts as no longer driving the loop. Zero selects the
  // bit-exact-zero test.
  double sustainedDriveRatio;
  // How many 10 ms detector windows are accumulated into one window of the
  // post-input branch. One reproduces the 10 ms window exactly.
  std::uint32_t sustainedWindowSpan;
  std::uint32_t sustainedWindows;
};
constexpr FeedbackDetectorProfile kLineFeedbackDetectorProfile = {0.05, 0.01, 1.0, 0.5,
                                                                  0.0,  1u,   3u};
constexpr FeedbackDetectorProfile kPowerFeedbackDetectorProfile = {0.05, 0.01, 1.0e-5, 4.0e-7,
                                                                   3.0,  25u,  3u};
constexpr std::size_t kFeedbackGroupCount = 6u;
constexpr std::size_t kFeedbackKnotsPerGroup = 61u;
constexpr std::size_t kFeedbackFieldsPerKnot = 7u;
constexpr std::size_t kFeedbackGroupStride = 2u + kFeedbackKnotsPerGroup * kFeedbackFieldsPerKnot;
static_assert(effetune::tube_feedback_table_fixture::kBinary64Bits.size() ==
              kFeedbackGroupCount * kFeedbackGroupStride);
constexpr double kMinimumPhysicalPlateVoltage = -100.0;
constexpr double kMaximumPhysicalPlateVoltage = 600.0;
constexpr double kGridFastPathResidualTolerance = 1e-9;
constexpr double kGridFallbackResidualTolerance = 1e-12;
constexpr int kGridMaximumNewtonCorrections = 3;
constexpr int kGridFallbackMaximumIterations = 64;
constexpr double kPlateFastPathResidualTolerance = 1e-9;
constexpr double kPlateFallbackResidualTolerance = 1e-12;
constexpr int kPlateFallbackMaximumIterations = 32;
constexpr std::uint16_t kTelemetryFrameType = 19u;
constexpr std::uint16_t kTelemetryVersion = 2u;
// Twenty per channel plus one shared trailing word: the automatic safety reduction in dB. The
// channel stride stays 20 so every channel-1 read keeps its offset.
constexpr std::size_t kTelemetryPayloadFloats = 41u;
constexpr std::size_t kTelemetrySafetyReductionIndex = 40u;
constexpr std::size_t kTelemetryPayloadBytes = kTelemetryPayloadFloats * sizeof(float);
constexpr double kPowerOutputReferencePeakV = 25.0;
constexpr int kBypassDriverIndex = 3;
constexpr std::uint32_t kRuntimeCauseNone = 0u;
constexpr std::uint32_t kRuntimeCauseFeedbackOscillation = 1u;
constexpr std::uint32_t kRuntimeCauseProcessingSafetyFailure = 2u;
#if defined(ET_TUBE_SIMULATOR_NATIVE_TEST) || defined(ET_DEBUG_STATE)
constexpr std::size_t kDetectorTraceCapacity = 1024u;
constexpr std::size_t kTransitionTraceCapacity = 16u;
#endif

enum class FaultState : std::uint32_t {
  normal = 0u,
  muting = 1u,
  latchedSafeBypass = 2u,
  trial = 3u,
  returning = 4u
};

enum class FeedbackTransitionPhase : std::uint32_t {
  inactive = 0u,
  fadeOut = 1u,
  warmup = 2u,
  fadeIn = 3u
};

enum class CentralResetReason : std::uint32_t {
  none = 0u,
  feedbackTransition = 1u,
  faultCircuit = 2u
};

void writeTelemetryF32(std::uint8_t *output, float value) noexcept {
  const std::uint32_t bits = std::bit_cast<std::uint32_t>(value);
  output[0] = static_cast<std::uint8_t>(bits);
  output[1] = static_cast<std::uint8_t>(bits >> 8u);
  output[2] = static_cast<std::uint8_t>(bits >> 16u);
  output[3] = static_cast<std::uint8_t>(bits >> 24u);
}

struct TubeParameters {
  double mu;
  double ka;
  double alpha;
  double v0;
  double sc;
  double vs;
  double cga;
  double cgk;
  double cak;
  double cathodeResistanceScale;
  double plateResistanceScale;
};

constexpr std::array<TubeParameters, 3> kTubeRows = {{
    {100.0, 0.0010637222, 1.45, -0.5866, 0.15, 25.0, 1.7e-12, 1.6e-12, 0.46e-12, 1.0, 1.0},
    {60.0, 0.0027035449, 1.4, -0.3788, 0.15, 22.0, 1.5e-12, 2.2e-12, 0.5e-12, 0.5, 0.47},
    {17.0, 0.00097874385, 1.3, 0.0014, 0.5, 18.0, 1.5e-12, 1.6e-12, 0.5e-12, 0.4, 0.22},
}};

struct Path2Parameters {
  double driveDb = 0.0;
  int tubeIndex = 2;
  double biasPercent = 0.0;
  double plateV = 250.0;
  double sourceZKOhm = 10.0;
  double supplyKOhm = 10.0;
  double outputDb = 9.0;
  double mixPercent = 100.0;
  double inputReference = 2.828;
  double feedbackDb = 30.0;
  int outputStage = 0;
  int powerTube = 0;
  double powerBPlus = 320.0;
  double cathodeResistor = 270.0;
  int screenTap = 0;
  int primaryImpedance = 2;
  // Assumed (design) speaker load: the tap the amplifier was built around. Discrete, because it
  // selects a measured speaker profile and, with the primary impedance, fixes the turns ratio.
  int speakerLoad = 1;
  // Actual speaker load in ohms: whatever is really connected. Continuous.
  double actualLoadOhm = 8.0;
  // Output-stage safety trim. Attenuation only, applied behind the amplifier model.
  double safetyTrimDb = 0.0;
  bool autoGainReduction = true;
  int seTube = 0;
  double seBPlus = 400.0;
  double seCathodeResistor = 1000.0;
  int sePrimaryImpedance = 1;
};

struct SeTubeModel {
  double mu;
  double ka;
  double alpha;
  double v0;
  double sc;
  double vs;
  double standingCurrentA;
  double windingResistanceOhm;
  double magnetizingInductanceH;
  double leakageInductanceH;
  double coreLossResistanceOhm;
  double resonanceHz;
  double cathodeCapacitanceF;
  double powerTheveninResistanceOhm;
  double powerCapacitanceF;
  double nfbTapTurnsRatio;
};

constexpr std::array<SeTubeModel, 2> kSeTubeModels = {{
    {3.85, 0.000906, 1.5, 9.35, 0.75, 35.0, 0.06, 120.0, 12.0, 0.018, 60000.0, 850.0, 100e-6, 150.0,
     47e-6, 0.1},
    {4.2, 0.000846, 1.5, -2.62, 0.75, 30.0, 0.06, 105.0, 10.0, 0.015, 50000.0, 900.0, 100e-6, 120.0,
     47e-6, 0.1},
}};

[[nodiscard]] constexpr double
effectivePrimaryImpedanceOhm(double primary_impedance_ohm, double assumed_speaker_load_ohm,
                             double actual_speaker_load_ohm) noexcept {
  return primary_impedance_ohm * actual_speaker_load_ohm / assumed_speaker_load_ohm;
}

using PhaseCPowerProfile = effetune::dsp::tube_simulator_phase_c_generated::PowerProfile;
using PhaseCSpeakerProfile = effetune::dsp::tube_simulator_phase_c_generated::SpeakerProfile;

struct PowerLutBracket {
  std::size_t lower = 0u;
  std::size_t upper = 0u;
  double fraction = 0.0;
};

// Reciprocal width of every bracket of a generated axis. The axes are fixed by the generated
// tables, so the reciprocals the analytic derivatives need are compile-time constants instead of
// divisions taken eight times per sample and channel. Entry zero is unused: a bracket whose upper
// index is zero is a clamped bracket and carries no slope.
template <std::size_t Size>
inline constexpr std::array<double, Size>
powerLutInverseStep(const std::array<double, Size> &axis) {
  std::array<double, Size> steps{};
  for (std::size_t index = 1u; index < Size; ++index) {
    steps[index] = 1.0 / (axis[index] - axis[index - 1u]);
  }
  return steps;
}

// One output valve: its three axes, their reciprocal bracket widths, and the two reciprocal
// amplification factors that build the composite control
// voltage. An EL84 cuts off near -15 V of grid and an EL34 near -39 V, and their plate and screen
// swings scale by the same factor, so the two valves carry separate axes rather than sharing one
// set whose knots would sit outside the operating box of whichever valve is selected.
struct PowerTubeTables {
  std::array<double, 11> controlVoltageAxis{};
  std::array<double, 11> plateCathodeAxis{};
  std::array<double, 6> screenCathodeAxis{};
  std::array<double, 11> controlVoltageInverseStep{};
  std::array<double, 11> plateCathodeInverseStep{};
  std::array<double, 6> screenCathodeInverseStep{};
  double inverseScreenAmplificationFactor = 0.0;
  double inversePlateAmplificationFactor = 0.0;
  std::uint32_t lut = 0u;
};

[[nodiscard]] inline PowerTubeTables powerTubeTables(std::uint32_t lut) noexcept {
  using namespace effetune::dsp::tube_simulator_phase_c_generated;
  const OutputTubeModel &model = kOutputTubeModels[lut];
  // The axes are copied into the struct rather than pointed at, so the interpolation reads one
  // contiguous block instead of chasing a pointer per axis eight times a sample and channel.
  return PowerTubeTables{kControlVoltageAxes[lut],
                         kPlateCathodeAxes[lut],
                         kScreenCathodeAxes[lut],
                         powerLutInverseStep(kControlVoltageAxes[lut]),
                         powerLutInverseStep(kPlateCathodeAxes[lut]),
                         powerLutInverseStep(kScreenCathodeAxes[lut]),
                         model.inverseScreenAmplificationFactor,
                         model.inversePlateAmplificationFactor,
                         lut};
}

struct PowerLutScratch {
  PowerLutBracket control{};
  PowerLutBracket plate{};
  PowerLutBracket screen{};
  double ia = 0.0;
  double ig2 = 0.0;
  double iaPlateDerivative = 0.0;
  double iaScreenDerivative = 0.0;
  double ig2PlateDerivative = 0.0;
  double ig2ScreenDerivative = 0.0;
};

struct FixedScreenLutWeights {
  double voltage = 0.0;
  std::array<std::size_t, 2> indices{};
  std::array<double, 2> weights{};
};

// Block constants for the fixed 12AX7 long-tailed pair and the two coupling capacitors.
// None of these depend on a runtime control, so they are recomputed only on a parameter commit.
struct PowerLtpCoefficients {
  double dtOverInputCapacitance = 0.0;
  double dtOverGridCapacitance = 0.0;
  // Fixed pre-power volume: the potentiometer track is split by the frozen wiper position into an
  // upper section towards the driver and a lower section towards ground. Only the upper-section
  // conductance and the two total wiper-node conductances (grid-stopper branch open and closed)
  // are needed at run time, so all three are inverted here instead of per sample.
  double preVolumeSourceConductance = 0.0;
  double inverseWiperConductanceOpen = 0.0;
  double inverseWiperConductanceConducting = 0.0;
  double inverseLtpGridLeak = 0.0;
  double inverseGridLeak = 0.0;
  double inverseGridStopper = 0.0;
  double inverseTailResistance = 0.0;
  double tailSupplyOverTailResistance = 0.0;
  double inversePlateResistance = 0.0;
};

// Output-transformer, screen-tap and speaker coefficients. Every one of these is fixed by the
// circuit profile, the selected speaker and the sample rate, so they are recomputed on a parameter
// commit instead of once per sample. Nothing here may depend on a runtime control.
struct PowerOptCoefficients {
  bool distributedScreenTap = false;
  double screenTapTurnsRatio = 0.0;
  double centerToTapResistanceOhm = 0.0;
  double tapToPlateResistanceOhm = 0.0;
  double screenSeriesResistanceOhm = 0.0;

  double leakageInductanceH = 0.0;
  double magnetizingInductanceH = 0.0;
  double coreLossResistanceOhm = 0.0;
  double effectiveResistanceOhm = 0.0;
  double seriesCapacitanceF = 0.0;
  double inverseSeriesCoefficient = 0.0;
  double seriesHistoryCoefficient = 0.0;
  double capacitorStep = 0.0;
  double inverseMagnetizingCoefficient = 0.0;
  double magnetizingHistoryCoefficient = 0.0;
  double magnetizingStep = 0.0;
  double inverseCoreLossResistanceOhm = 0.0;
  double inverseFastDt = 0.0;

  double turnsRatio = 0.0;
  double halfPrimaryTurnsRatio = 0.0;
  // Half-primary winding resistance and the impedance the half primary reflects from the speaker,
  // plus the ampere-turn drive resistance of the primary. Together they turn the trapezoidal
  // companion of the transformer series branch into the plate load line of one output tube.
  double windingResistanceOhm = 0.0;
  double inverseWindingResistanceOhm = 0.0;
  double centerToTapResistanceShare = 0.0;
  double primaryDriveOhm = 0.0;
  double halfPrimaryReflectedOhm = 0.0;
  double plateLoadFactor = 1.0;
  double speakerLoadOhm = 0.0;
  double voiceStep = 0.0;
  bool voiceStepLimited = false;
  double voiceResistanceOhm = 0.0;
  double resonanceStep = 0.0;
  bool resonanceStepLimited = false;
  double resonanceResistanceOhm = 0.0;
  double speakerCapacitorStep = 0.0;
  double nfbTapGain = 0.0;
};

// Quiescent long-tailed-pair solution, solved off the audio thread on every parameter commit.
struct PowerLtpQuiescent {
  double inputCapacitorV = 0.0;
  double cathodeV = 0.0;
  double plateV = 0.0;
  double gridCouplingV = 0.0;
};

struct SeQuiescent {
  double currentA = 0.0;
  double cathodeV = 0.0;
  double bPlusV = 0.0;
  double plateV = 0.0;
  double residualA = 0.0;
};

// Fast-rate publication of a slow-integrated node voltage. The slow grid integrates the real
// capacitors once per window, but handing that result to the fast solves as a held constant makes
// the node a staircase clocked at the slow rate; the steps intermodulate with the audio and put
// sidebands around 16 kHz and its harmonics, straight in the analyser's face. The fast path
// therefore reads `applied`, which traces a quadratic B-spline through the published slow values:
// each window advances by a per-sample slope that itself advances by a constant curvature, so the
// published voltage is continuous with a continuous first derivative and its images fall off as
// sinc^3 instead of the staircase's sinc. The spline of three points never leaves their convex
// hull, so no overshoot is introduced, and the slope is re-derived from the current applied value
// at every window boundary, so rounding never accumulates. The only cost is two additions per
// sample per node and a group delay of 1.5 slow windows - about 94 microseconds against bias time
// constants of milliseconds to seconds.
struct SlowRamp {
  double applied = 0.0;
  double slope = 0.0;
  double curvature = 0.0;
  double previous1 = 0.0;
  double previous2 = 0.0;
};

inline void seedRamp(SlowRamp &ramp, double value) noexcept {
  ramp = {value, 0.0, 0.0, value, value};
}

inline void retargetRamp(SlowRamp &ramp, double target, double inverse_window,
                         double window) noexcept {
  const double end = 0.5 * (ramp.previous1 + target);
  const double curvature =
      (target - 2.0 * ramp.previous1 + ramp.previous2) * inverse_window * inverse_window;
  ramp.curvature = curvature;
  ramp.slope = (end - ramp.applied) * inverse_window - curvature * (window - 1.0) * 0.5;
  ramp.previous2 = ramp.previous1;
  ramp.previous1 = target;
}

inline double advanceRamp(SlowRamp &ramp) noexcept {
  ramp.applied += ramp.slope;
  ramp.slope += ramp.curvature;
  return ramp.applied;
}

struct PowerState {
  double ltpInputCapV = 0.0;
  double ltpCathodeV = 0.0;
  double ltpPlateAV = 0.0;
  double ltpPlateBV = 0.0;
  double ltpGridAV = 0.0;
  double gridCouplingPushV = 0.0;
  double gridCouplingPullV = 0.0;
  double ltpBalanceV = 0.0;
  double gridPushV = 0.0;
  double gridPullV = 0.0;
  double cathodePushV = 0.0;
  double cathodePullV = 0.0;
  double bPlusV = 0.0;
  double screenTapV = 0.0;
  // Screen supply node. For a pentode connection this is a real state variable, the reservoir the
  // slow step integrates; for a distributed tap it is the mean of the two screen terminals, which
  // is what a meter across the pair would read.
  double screenV = 0.0;
  // Screen terminal of each valve. On a distributed tap the two swing in opposite directions with
  // the plates they are tapped from, so their mean carries none of the signal and cannot show that
  // the tap turns ratio reaches the screen at all.
  double screenPushV = 0.0;
  double screenPullV = 0.0;
  double optCurrentA = 0.0;
  double magnetizingCurrentA = 0.0;
  double optCapacitorV = 0.0;
  double primaryVoltageV = 0.0;
  double speakerVoiceCurrentA = 0.0;
  double speakerResonanceCurrentA = 0.0;
  double speakerCapacitorV = 0.0;
  double feedbackV = 0.0;
  double speakerLoadVoltageV = 0.0;
  double speakerLoadCurrentA = 0.0;
  double platePushV = 0.0;
  double platePullV = 0.0;
  double iaPushA = 0.0;
  double iaPullA = 0.0;
  double ig2PushA = 0.0;
  double ig2PullA = 0.0;
  double slowAccumulatorPushA = 0.0;
  double slowAccumulatorPullA = 0.0;
  double slowAccumulatorScreenA = 0.0;
  // Both phase-inverter triodes hang on the same reservoir node as the output valves, so their
  // plate current has to reach the reservoir KCL through the same window average.
  double slowAccumulatorLtpA = 0.0;
  // Spline publication of the four slow-integrated supply nodes (see SlowRamp). The screen ramp
  // is meaningful for a pentode connection only; a distributed tap computes its screen terminals
  // inside the fast solve.
  SlowRamp cathodePushRamp{};
  SlowRamp cathodePullRamp{};
  SlowRamp bPlusRamp{};
  SlowRamp screenRamp{};
  double vrmsSquareSum = 0.0;
  double realPowerSum = 0.0;
  double publishedVrms = 0.0;
  double publishedRealPower = 0.0;
  std::uint32_t slowCounter = 0u;
  std::uint32_t powerWindowSamples = 0u;
};

struct PowerPlateResult {
  double plateV = 0.0;
  double screenV = 0.0;
  double screenTapV = 0.0;
  double ia = 0.0;
  double ig2 = 0.0;
  // Ampere-turn drive of this half primary: the plate current plus the screen current that crosses
  // the centre-to-tap section, weighted by the tap turns ratio.
  double driveA = 0.0;
  double residual = 0.0;
};

struct FeedbackCalibration {
  double feedbackDb;
  double q;
  double b0;
  double b1;
  double a1;
  double a2;
  double a0;
  double beta;
  double makeup;
};

struct FeedbackFilterState {
  double s1 = 0.0;
  double s2 = 0.0;
  std::array<double, 1> transport{};
  std::uint32_t transportIndex = 0u;
  bool identityDrained = true;
};

struct GridEvaluation {
  double current;
  double derivative;
};

struct PlateEvaluation {
  double current;
  double gridDerivative;
  double plateDerivative;
};

struct PlateSolveResult {
  double vak;
  PlateEvaluation plate;
  bool converged;
};

struct SlowValue {
  double voltage = 0.0;
  double capacitorCurrent = 0.0;
};

struct SlowState {
  std::array<SlowValue, 2> cathode{};
  SlowValue supply{};
  // Spline publication of the two cathode nodes and the supply node (see SlowRamp).
  std::array<SlowRamp, 2> cathodeRamp{};
  SlowRamp supplyRamp{};
};

struct FastStage {
  double gridVoltage = 0.0;
  double plateVoltage = 125.0;
  double couplingCharge = 0.0;
  double millerVoltage = 0.0;
  double millerCapacitance = 100e-12;
  double localPlateGain = -40.0;
  double outputResistance = 50000.0;
  double previousVak = 124.0;
};

struct FastChannel {
  std::array<FastStage, 2> stage{};
  double outputCouplingCharge = 0.0;
  double outputLoadCurrent = 0.0;
};

struct SlowAccumulator {
  double uK1 = 0.0;
  double uK2 = 0.0;
  double uP = 0.0;
  int count = 0;
};

enum class FastKclNode : std::uint32_t {
  none = 0u,
  stage1Grid = 1u,
  stage1Coupling = 2u,
  stage1Miller = 3u,
  stage1Plate = 4u,
  stage2Grid = 5u,
  stage2Coupling = 6u,
  stage2Miller = 7u,
  stage2Plate = 8u,
  output = 9u
};

struct StageResult {
  double plateCurrent;
  double gridCurrent;
  double iCgk;
  double iCga;
  double iCak;
  double couplingCurrent;
  double maximumPhysicalKcl;
  FastKclNode maximumPhysicalKclNode;
};

#if defined(ET_TUBE_SIMULATOR_NATIVE_TEST) || defined(ET_DEBUG_STATE)
#define ET_TUBE_SIMULATOR_TEST_STATE 1
#else
#define ET_TUBE_SIMULATOR_TEST_STATE 0
#endif

#if ET_TUBE_SIMULATOR_TEST_STATE
struct FastKclObservation {
  double residual = 0.0;
  FastKclNode node = FastKclNode::none;
  std::uint32_t channel = 0u;
  std::uint64_t hostFrame = 0u;
  std::uint64_t internalFrame = 0u;
  std::uint32_t internalPhase = 0u;
};

struct DetectorWindowObservation {
  std::uint64_t startFrame = 0u;
  std::uint64_t endFrame = 0u;
  double previousInputRms = 0.0;
  double previousOutputRms = 0.0;
  double previousFeedbackRms = 0.0;
  double inputRms = 0.0;
  double outputRms = 0.0;
  double feedbackRms = 0.0;
  std::uint32_t predicateBits = 0u;
  std::uint32_t growthCount = 0u;
  std::uint32_t sustainedCount = 0u;
  std::uint32_t selectedBranch = 0u;
  RuntimeEventState runtimeEvent{0u, 0u, 0u};
  std::uint32_t faultState = 0u;
};

struct TransitionBoundaryObservation {
  std::uint64_t frame = 0u;
  std::array<std::uint64_t, 12> transition{};
  std::array<double, 17> appliedParameters{};
  std::array<double, 9> feedbackCalibration{};
  std::array<std::uint64_t, 2> centralReset{};
};
#endif

struct ControlState {
  double drive = 1.0;
  double driveTarget = 1.0;
  double output = 1.0;
  double outputTarget = 1.0;
  double mix = 1.0;
  double mixTarget = 1.0;
  double inputReference = 2.828;
  double inputReferenceTarget = 2.828;
  // Manual output safety trim as a linear gain. Smoothed with the same one-pole the other host
  // controls use so that dragging the control does not step the output.
  double safetyUser = 1.0;
  double safetyUserTarget = 1.0;
  double coefficient = 1.0;
  double feedbackDb = 0.0;
  double feedbackQ = 0.0;
  double feedbackB0 = 1.0;
  double feedbackB1 = 0.0;
  double feedbackA1 = 0.0;
  double feedbackA2 = 0.0;
  double feedbackA0 = 1.0;
  double feedbackBeta = 0.0;
  double feedbackMakeup = 1.0;
  double plateReference = 0.0;
  double plateReferenceTarget = 0.0;
  double plateReferenceStep = 0.0;
  std::uint32_t plateReferenceRemaining = 0u;
};

struct FeedbackTransitionState {
  FeedbackTransitionPhase phase = FeedbackTransitionPhase::inactive;
  std::uint32_t progress = 0u;
  std::uint32_t activeGeneration = 0u;
  std::uint32_t stateGeneration = 0u;
  std::uint32_t pendingGeneration = 0u;
  std::uint32_t queuedGeneration = 0u;
  std::uint32_t nextGeneration = 1u;
  std::uint64_t resetCount = 0u;
  std::uint64_t atomicCommitCount = 0u;
  std::uint64_t warmupWetFrames = 0u;
  std::uint64_t warmupAlignedDryMismatches = 0u;
  std::uint64_t oldStateNewNfProcessCount = 0u;
};

double absolute(double value) noexcept { return value >= 0.0 ? value : -value; }

double clampValue(double value, double low, double high) noexcept {
  return value < low ? low : (value > high ? high : value);
}

double feedbackTableValue(std::size_t index) noexcept {
  return std::bit_cast<double>(effetune::tube_feedback_table_fixture::kBinary64Bits[index]);
}

double smoothstep(double value) noexcept {
  const double clamped = value < 0.0 ? 0.0 : (value > 1.0 ? 1.0 : value);
  return clamped * clamped * (3.0 - 2.0 * clamped);
}

double polynomialExp(double value) noexcept {
  constexpr double inverseLn2 = 1.44269504088896340735992468100189214;
  constexpr double ln2 = 0.693147180559945309417232121458176568;
  if (value < -700.0) {
    return 0.0;
  }
  if (value > 700.0) {
    return std::numeric_limits<double>::infinity();
  }
  const double scaled = value * inverseLn2;
  const int exponent = static_cast<int>(scaled + (scaled >= 0.0 ? 0.5 : -0.5));
  const double reduced = value - exponent * ln2;
  double polynomial = 2.7557319223985892511e-7;
  polynomial = 2.7557319223985890653e-6 + reduced * polynomial;
  polynomial = 2.4801587301587301584e-5 + reduced * polynomial;
  polynomial = 1.9841269841269841270e-4 + reduced * polynomial;
  polynomial = 1.3888888888888888889e-3 + reduced * polynomial;
  polynomial = 8.3333333333333333333e-3 + reduced * polynomial;
  polynomial = 4.1666666666666666667e-2 + reduced * polynomial;
  polynomial = 1.6666666666666666667e-1 + reduced * polynomial;
  polynomial = 0.5 + reduced * polynomial;
  polynomial = 1.0 + reduced * polynomial;
  polynomial = 1.0 + reduced * polynomial;
  const std::uint64_t scaleBits = static_cast<std::uint64_t>(exponent + 1023) << 52;
  return polynomial * std::bit_cast<double>(scaleBits);
}

double polynomialLog(double value) noexcept {
  const std::uint64_t bits = std::bit_cast<std::uint64_t>(value);
  int exponent = static_cast<int>((bits >> 52) & 0x7ffu) - 1023;
  const std::uint64_t mantissaBits =
      (bits & ((std::uint64_t{1} << 52) - 1)) | (std::uint64_t{1023} << 52);
  double mantissa = std::bit_cast<double>(mantissaBits);
  if (mantissa > 1.41421356237309504880168872420969808) {
    mantissa *= 0.5;
    ++exponent;
  }
  const double ratio = (mantissa - 1.0) / (mantissa + 1.0);
  const double squared = ratio * ratio;
  double series = 1.0 / 13.0;
  series = 1.0 / 11.0 + squared * series;
  series = 1.0 / 9.0 + squared * series;
  series = 1.0 / 7.0 + squared * series;
  series = 1.0 / 5.0 + squared * series;
  series = 1.0 / 3.0 + squared * series;
  series = 1.0 + squared * series;
  return 2.0 * ratio * series + exponent * 0.693147180559945309417232121458176568;
}

double polynomialPowPositive(double value, double exponent) noexcept {
  return value > 0.0 ? polynomialExp(exponent * polynomialLog(value)) : 0.0;
}

double exactSoftplus(double value) noexcept {
  if (value > 32.0) {
    return value;
  }
  if (value < -32.0) {
    return std::exp(value);
  }
  return std::log1p(std::exp(value));
}

GridEvaluation directGrid(double vgk) noexcept {
  const double z = (vgk - kGridOn) / kGridScale;
  const double softplus = exactSoftplus(z);
  const double exponential = std::exp(z >= 0.0 ? -z : z);
  const double sigmoid = z >= 0.0 ? 1.0 / (1.0 + exponential) : exponential / (1.0 + exponential);
  const double u = kGridScale * softplus;
  const double powered = std::pow(u, kGridAlpha);
  const double derivative =
      u > 0.0 ? kGridK * kGridAlpha * std::pow(u, kGridAlpha - 1.0) * sigmoid : 0.0;
  return {kGridK * powered, derivative};
}

template <std::size_t SegmentCount> struct HermiteTable {
  double minimum;
  double maximum;
  double inverseStep;
  std::array<double, SegmentCount> coefficient0{};
  std::array<double, SegmentCount> coefficient1{};
  std::array<double, SegmentCount> coefficient2{};
  std::array<double, SegmentCount> coefficient3{};

  template <typename Generator>
  HermiteTable(double low, double high, Generator generator)
      : minimum(low), maximum(high), inverseStep(SegmentCount / (high - low)) {
    const double step = 1.0 / inverseStep;
    for (std::size_t index = 0; index < SegmentCount; ++index) {
      const auto first = generator(minimum + static_cast<double>(index) * step);
      const auto second = generator(minimum + static_cast<double>(index + 1u) * step);
      const double delta = second[0] - first[0];
      coefficient0[index] = first[0];
      coefficient1[index] = step * first[1];
      coefficient2[index] = 3.0 * delta - step * (2.0 * first[1] + second[1]);
      coefficient3[index] = -2.0 * delta + step * (first[1] + second[1]);
    }
  }

  std::array<double, 2> evaluate(double input) const noexcept {
    const double limited = input < minimum ? minimum : (input > maximum ? maximum : input);
    const double position = (limited - minimum) * inverseStep;
    std::size_t index = static_cast<std::size_t>(position);
    if (index >= SegmentCount) {
      index = SegmentCount - 1u;
    }
    const double t = position - static_cast<double>(index);
    const double a = coefficient0[index];
    const double b = coefficient1[index];
    const double c = coefficient2[index];
    const double d = coefficient3[index];
    return {((d * t + c) * t + b) * t + a, ((3.0 * d * t + 2.0 * c) * t + b) * inverseStep};
  }
};

struct TubeTables {
  double mu;
  double v0;
  HermiteTable<512> plateAmplitude;
  HermiteTable<256> plateFactor;
  HermiteTable<512> gridCurrent;

  explicit TubeTables(const TubeParameters &tube)
      : mu(tube.mu), v0(tube.v0),
        plateAmplitude(
            tube.sc > 0.25 ? -24.0 * tube.sc : -6.0, 2.0 + 350.0 / tube.mu - tube.v0,
            [tube](double s) {
              const double z = s / tube.sc;
              const double softplus = exactSoftplus(z);
              const double exponential = std::exp(z >= 0.0 ? -z : z);
              const double sigmoid =
                  z >= 0.0 ? 1.0 / (1.0 + exponential) : exponential / (1.0 + exponential);
              const double u = tube.sc * softplus;
              const double powered = std::pow(u, tube.alpha);
              return std::array<double, 2>{
                  tube.ka * powered,
                  u > 0.0 ? tube.ka * tube.alpha * std::pow(u, tube.alpha - 1.0) * sigmoid : 0.0};
            }),
        plateFactor(0.0, 350.0,
                    [tube](double vak) {
                      const double exponential = std::exp(-vak / tube.vs);
                      return std::array<double, 2>{1.0 - exponential, exponential / tube.vs};
                    }),
        gridCurrent(-2.0, 2.0, [](double vgk) {
          const GridEvaluation grid = directGrid(vgk);
          return std::array<double, 2>{grid.current, grid.derivative};
        }) {}

  PlateEvaluation evaluatePlate(double vgk, double vak) const noexcept {
    const double s = vgk + vak / mu - v0;
    const auto amplitude =
        s <= plateAmplitude.minimum ? std::array<double, 2>{0.0, 0.0} : plateAmplitude.evaluate(s);
    const auto factor = vak <= 0.0 ? std::array<double, 2>{0.0, 0.0} : plateFactor.evaluate(vak);
    return {amplitude[0] * factor[0], amplitude[1] * factor[0],
            amplitude[1] * factor[0] / mu + amplitude[0] * factor[1]};
  }

  GridEvaluation evaluateGrid(double vgk) const noexcept {
    if (vgk <= gridCurrent.minimum) {
      return {0.0, 0.0};
    }
    const auto grid = gridCurrent.evaluate(vgk);
    return {grid[0], grid[1]};
  }
};

const std::array<TubeTables, 3> &tubeTables() {
  static const std::array<TubeTables, 3> tables = {
      TubeTables{kTubeRows[0]}, TubeTables{kTubeRows[1]}, TubeTables{kTubeRows[2]}};
  return tables;
}

#if defined(__clang__)
using StereoPair = double __attribute__((ext_vector_type(2)));
#define ET_TUBE_HAS_F64X2 1
#elif defined(__GNUC__)
using StereoPair = double __attribute__((vector_size(2 * sizeof(double))));
#define ET_TUBE_HAS_F64X2 1
#else
#define ET_TUBE_HAS_F64X2 0
#endif

#if ET_TUBE_HAS_F64X2
struct GridEvaluationPair {
  StereoPair current;
  StereoPair derivative;
};

struct PlateEvaluationPair {
  StereoPair current;
  StereoPair gridDerivative;
  StereoPair plateDerivative;
};

struct StageResultPair {
  StereoPair plateCurrent;
  StereoPair gridCurrent;
  StereoPair iCgk;
  StereoPair iCga;
  StereoPair iCak;
  StereoPair couplingCurrent;
  StereoPair maximumPhysicalKcl;
  std::array<FastKclNode, kChannels> maximumPhysicalKclNode;
};
#endif

} // namespace

namespace {

class TubeSimulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::TubeSimulatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    prepared_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    safety_ramp_frames_ = millisecondsToFrames(kSafetyRampMilliseconds);
#if ET_TUBE_SIMULATOR_TEST_STATE
    detector_window_trace_for_testing_.clear();
    detector_window_trace_for_testing_.reserve(kDetectorTraceCapacity);
    detector_window_trace_overflow_for_testing_ = false;
    transition_boundary_trace_for_testing_.clear();
    transition_boundary_trace_for_testing_.reserve(kTransitionTraceCapacity);
    transition_boundary_trace_overflow_for_testing_ = false;
#endif
    const RateConfig *selected_config = findRateConfig(prepared_rate_);
    supported_rate_ = selected_config != nullptr;
    rate_config_ = supported_rate_ ? *selected_config : RateConfig{};
    upsample_history_ =
        supported_rate_
            ? (rate_config_.firLength + rate_config_.factor - 1) / rate_config_.factor - 1
            : 0;
    downsample_history_ = supported_rate_ ? rate_config_.firLength - 1 : 0;
    buffers_ready_ = !supported_rate_;
    if (supported_rate_ && max_frames_ != 0u) {
      const std::size_t host_frames = static_cast<std::size_t>(max_frames_);
      const std::size_t internal_frames =
          host_frames * static_cast<std::size_t>(rate_config_.factor);
      for (int channel = 0; channel < kChannels; ++channel) {
        upsample_state_[channel].assign(static_cast<std::size_t>(upsample_history_), 0.0);
        downsample_state_[channel].assign(static_cast<std::size_t>(downsample_history_), 0.0);
        host_work_[channel].assign(static_cast<std::size_t>(upsample_history_) + host_frames, 0.0);
        internal_input_[channel].assign(internal_frames, 0.0);
        internal_output_[channel].assign(internal_frames, 0.0);
        internal_work_[channel].assign(
            static_cast<std::size_t>(downsample_history_) + internal_frames, 0.0);
      }
      drive_gain_.assign(host_frames, 0.0);
      output_gain_.assign(host_frames, 0.0);
      wet_mix_.assign(host_frames, 0.0);
      input_reference_.assign(host_frames, 0.0);
      feedback_q_.assign(host_frames, 0.0);
      feedback_makeup_.assign(host_frames, 1.0);
      plate_reference_.assign(host_frames, 0.0);
      fault_wet_.assign(host_frames, 1.0);
      transition_wet_.assign(host_frames, 1.0);
      safe_dry_.assign(host_frames * static_cast<std::size_t>(kChannels), 0.0);
      safety_user_.assign(host_frames, 1.0);
      wet_chain_.assign(host_frames * static_cast<std::size_t>(kChannels), 0.0);
      segment_audio_.assign(host_frames * static_cast<std::size_t>(kChannels), 0.0F);
      buffers_ready_ = true;
    } else if (!supported_rate_) {
      coefficients_.clear();
      for (int channel = 0; channel < kChannels; ++channel) {
        upsample_state_[channel].clear();
        downsample_state_[channel].clear();
        host_work_[channel].clear();
        internal_input_[channel].clear();
        internal_output_[channel].clear();
        internal_work_[channel].clear();
      }
      drive_gain_.clear();
      output_gain_.clear();
      wet_mix_.clear();
      input_reference_.clear();
      feedback_q_.clear();
      feedback_makeup_.clear();
      plate_reference_.clear();
      fault_wet_.clear();
      transition_wet_.clear();
      safe_dry_.clear();
      safety_user_.clear();
      wet_chain_.clear();
      segment_audio_.clear();
    }
    static_cast<void>(tubeTables());
    if (supported_rate_) {
      designFir();
    }
    if (parameters_initialized_) {
      applyPath2Parameters(false);
    }
    cancelFeedbackTransition();
    resetModel();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return buffers_ready_; }

  void reset() noexcept override {
    if (runtime_event_.latched == 0u) {
      cancelFeedbackTransition();
      resetModel();
    }
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    capturePendingParameters();
    if (audio == nullptr || !supported_rate_ || !buffers_ready_ ||
        channel_count != static_cast<std::uint32_t>(kChannels) || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }
    commitDecodedParameters();
    std::uint32_t frame_offset = 0u;
    while (frame_offset < frame_count) {
      advanceFeedbackTransitionBoundary();
      handleFaultBoundary();
      std::uint32_t segment_frames = frame_count - frame_offset;
      const std::uint32_t transition_remaining = feedbackTransitionRemainingFrames();
      if (transition_remaining < segment_frames) {
        segment_frames = transition_remaining;
      }
      const std::uint32_t fault_remaining = faultBoundaryRemainingFrames();
      if (fault_remaining < segment_frames) {
        segment_frames = fault_remaining;
      }
      const std::uint32_t detector_remaining = detectorWindowRemainingFrames();
      if (detector_remaining < segment_frames) {
        segment_frames = detector_remaining;
      }
      if (segment_frames == 0u) {
        return;
      }
      for (int channel = 0; channel < kChannels; ++channel) {
        const std::size_t source_offset =
            static_cast<std::size_t>(channel) * frame_count + frame_offset;
        const std::size_t target_offset = static_cast<std::size_t>(channel) * segment_frames;
        std::copy_n(audio + source_offset, segment_frames, segment_audio_.data() + target_offset);
      }
      const FeedbackTransitionPhase segment_phase = feedback_transition_.phase;
      static_cast<void>(processWithFaultHandling(segment_audio_.data(), segment_frames));
      for (int channel = 0; channel < kChannels; ++channel) {
        const std::size_t source_offset = static_cast<std::size_t>(channel) * segment_frames;
        const std::size_t target_offset =
            static_cast<std::size_t>(channel) * frame_count + frame_offset;
        std::copy_n(segment_audio_.data() + source_offset, segment_frames, audio + target_offset);
      }
      frame_offset += segment_frames;
      if (feedback_transition_.phase == segment_phase &&
          segment_phase != FeedbackTransitionPhase::inactive) {
        feedback_transition_.progress += segment_frames;
      }
    }
    advanceFeedbackTransitionBoundary();
    handleFaultBoundary();
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return supported_rate_ ? static_cast<std::uint32_t>(kDryDelayFrames) : 0u;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    std::array<std::uint8_t, kTelemetryPayloadBytes> payload{};
    for (std::size_t index = 0; index < telemetry_payload_.size(); ++index) {
      writeTelemetryF32(payload.data() + index * sizeof(float), telemetry_payload_[index]);
    }
    writer.write(kTelemetryFrameType, kTelemetryVersion, payload.data(),
                 static_cast<std::uint16_t>(payload.size()));
  }

  void readRuntimeEvent(RuntimeEventState &state) const noexcept override {
    state = runtime_event_;
  }

#if ET_TUBE_SIMULATOR_TEST_STATE
  void useSimdForTesting(bool enabled) noexcept {
#if ET_TUBE_HAS_F64X2
    use_simd_for_testing_ = enabled;
#else
    static_cast<void>(enabled);
#endif
  }

  void commitParametersForTesting() noexcept {
    capturePendingParameters();
    if (supported_rate_) {
      commitDecodedParameters();
    }
  }

  [[nodiscard]] std::uint64_t stateDigestForTesting() const noexcept {
    std::uint64_t hash = physicalStateDigestForTesting();
    hashDouble(hash, controls_.driveTarget);
    hashDouble(hash, controls_.outputTarget);
    hashDouble(hash, controls_.mixTarget);
    hashDouble(hash, cathode_resistance_);
    hashDouble(hash, plate_resistance_);
    hashDouble(hash, source_resistance_);
    hashDouble(hash, supply_resistance_);
    hashDouble(hash, supply_capacitance_);
    hashDouble(hash, supply_voltage_);
    hashDouble(hash, applied_parameters_.driveDb);
    hashWord(hash, static_cast<std::uint64_t>(applied_parameters_.tubeIndex));
    hashDouble(hash, applied_parameters_.biasPercent);
    hashDouble(hash, applied_parameters_.plateV);
    hashDouble(hash, applied_parameters_.sourceZKOhm);
    hashDouble(hash, applied_parameters_.supplyKOhm);
    hashDouble(hash, applied_parameters_.outputDb);
    hashDouble(hash, applied_parameters_.mixPercent);
    hashDouble(hash, applied_parameters_.inputReference);
    hashDouble(hash, applied_parameters_.feedbackDb);
    hashWord(hash, static_cast<std::uint64_t>(applied_parameters_.outputStage));
    hashWord(hash, static_cast<std::uint64_t>(applied_parameters_.powerTube));
    hashDouble(hash, applied_parameters_.powerBPlus);
    hashDouble(hash, applied_parameters_.cathodeResistor);
    hashWord(hash, static_cast<std::uint64_t>(applied_parameters_.screenTap));
    hashWord(hash, static_cast<std::uint64_t>(applied_parameters_.primaryImpedance));
    hashWord(hash, static_cast<std::uint64_t>(applied_parameters_.speakerLoad));
    hashDouble(hash, applied_parameters_.actualLoadOhm);
    hashDouble(hash, applied_parameters_.safetyTrimDb);
    hashWord(hash, applied_parameters_.autoGainReduction ? 1u : 0u);
    hashWord(hash, static_cast<std::uint64_t>(applied_parameters_.seTube));
    hashDouble(hash, applied_parameters_.seBPlus);
    hashDouble(hash, applied_parameters_.seCathodeResistor);
    hashWord(hash, static_cast<std::uint64_t>(applied_parameters_.sePrimaryImpedance));
    hashDouble(hash, controls_.safetyUserTarget);
    hashDouble(hash, safety_auto_gain_);
    hashDouble(hash, safety_auto_target_);
    hashDouble(hash, safety_auto_step_);
    hashWord(hash, safety_auto_remaining_);
    hashParameters(hash, committed_parameters_);
    hashWord(hash, has_applied_parameters_ ? 1u : 0u);
    hashWord(hash, pending_transition_parameters_valid_ ? 1u : 0u);
    if (pending_transition_parameters_valid_) {
      hashParameters(hash, pending_transition_parameters_);
    }
    hashWord(hash, queued_transition_parameters_valid_ ? 1u : 0u);
    if (queued_transition_parameters_valid_) {
      hashParameters(hash, queued_transition_parameters_);
    }
    hashWord(hash, pending_fault_parameter_commit_ ? 1u : 0u);
    if (pending_fault_parameter_commit_) {
      hashParameters(hash, pending_fault_parameters_);
    }
    hashWord(hash, fault_reset_pending_ ? 1u : 0u);
    hashWord(hash, trial_after_fault_reset_ ? 1u : 0u);
    hashWord(hash, fault_clear_pending_ ? 1u : 0u);
    hashWord(hash, processed_host_frames_);
    hashWord(hash, detection_frame_for_testing_);
    hashWord(hash, mute_complete_frame_for_testing_);
    hashWord(hash, trial_observation_start_frame_for_testing_);
    hashWord(hash, finite_faults_);
    hashWord(hash, safety_limits_);
    hashWord(hash, slow_publish_count_);
    hashDouble(hash, maximum_kcl_);
    hashDouble(hash, maximum_dc_residual_);
    hashDouble(hash, maximum_energy_residual_);
    hashWord(hash, static_cast<std::uint64_t>(power_profile_index_));
    hashWord(hash, static_cast<std::uint64_t>(power_speaker_index_));
    hashDouble(hash, power_primary_ohm_);
    hashDouble(hash, power_selected_turns_ratio_);
    for (float value : telemetry_payload_) {
      hashWord(hash, std::bit_cast<std::uint32_t>(value));
    }
    return hash;
  }

  [[nodiscard]] std::uint64_t physicalStateDigestForTesting() const noexcept {
    std::uint64_t hash = 1469598103934665603ull;
    for (int channel = 0; channel < kChannels; ++channel) {
      hashFastChannel(hash, fast_[channel]);
      hashSlowState(hash, slow_[channel]);
      hashAccumulator(hash, accumulator_[channel]);
      hashPowerState(hash, power_state_[channel]);
      hashFastChannel(hash, recovery_fast_[channel]);
      hashSlowState(hash, recovery_slow_[channel]);
      for (double value : upsample_state_[channel]) {
        hashDouble(hash, value);
      }
      for (double value : downsample_state_[channel]) {
        hashDouble(hash, value);
      }
      for (double value : dry_delay_[channel]) {
        hashDouble(hash, value);
      }
      for (double value : last_plate_current_[channel]) {
        hashDouble(hash, value);
      }
    }
    hashDouble(hash, controls_.drive);
    hashDouble(hash, controls_.output);
    hashDouble(hash, controls_.mix);
    hashDouble(hash, controls_.feedbackDb);
    hashDouble(hash, controls_.feedbackQ);
    hashDouble(hash, controls_.feedbackB0);
    hashDouble(hash, controls_.feedbackB1);
    hashDouble(hash, controls_.feedbackA1);
    hashDouble(hash, controls_.feedbackA2);
    hashDouble(hash, controls_.feedbackA0);
    hashDouble(hash, controls_.feedbackBeta);
    hashDouble(hash, controls_.feedbackMakeup);
    hashDouble(hash, controls_.plateReference);
    hashDouble(hash, controls_.coefficient);
    hashWord(hash, runtime_event_.generation);
    hashWord(hash, runtime_event_.latched);
    hashWord(hash, runtime_event_.cause);
    hashWord(hash, static_cast<std::uint32_t>(fault_state_));
    hashDouble(hash, fault_wet_current_);
    hashWord(hash, fault_mute_remaining_);
    hashWord(hash, fault_trial_remaining_);
    hashWord(hash, fault_return_remaining_);
    hashWord(hash, static_cast<std::uint64_t>(dry_index_));
    hashDouble(hash, detector_input_energy_);
    hashDouble(hash, detector_output_energy_);
    hashDouble(hash, detector_feedback_energy_);
    hashDouble(hash, detector_previous_input_rms_);
    hashDouble(hash, detector_previous_output_rms_);
    hashDouble(hash, detector_previous_feedback_rms_);
    hashWord(hash, detector_samples_);
    hashWord(hash, detector_driven_growth_windows_);
    hashWord(hash, detector_post_input_nondecay_windows_);
    hashWord(hash, detector_has_previous_ ? 1u : 0u);
    hashDouble(hash, detector_sustained_input_energy_);
    hashDouble(hash, detector_sustained_output_energy_);
    hashDouble(hash, detector_sustained_feedback_energy_);
    hashDouble(hash, detector_sustained_previous_input_rms_);
    hashDouble(hash, detector_sustained_previous_output_rms_);
    hashDouble(hash, detector_sustained_previous_feedback_rms_);
    hashWord(hash, detector_sustained_span_);
    hashWord(hash, detector_sustained_has_previous_ ? 1u : 0u);
    hashWord(hash, static_cast<std::uint32_t>(feedback_transition_.phase));
    hashWord(hash, feedback_transition_.progress);
    hashWord(hash, feedback_transition_.activeGeneration);
    hashWord(hash, feedback_transition_.stateGeneration);
    hashWord(hash, feedback_transition_.pendingGeneration);
    hashWord(hash, feedback_transition_.queuedGeneration);
    hashWord(hash, feedback_transition_.nextGeneration);
    hashWord(hash, feedback_transition_.resetCount);
    hashWord(hash, feedback_transition_.atomicCommitCount);
    hashWord(hash, feedback_transition_.warmupWetFrames);
    hashWord(hash, feedback_transition_.warmupAlignedDryMismatches);
    hashWord(hash, feedback_transition_.oldStateNewNfProcessCount);
    hashWord(hash, central_reset_count_);
    hashWord(hash, static_cast<std::uint32_t>(last_central_reset_reason_));
    return hash;
  }

  [[nodiscard]] std::array<double, 8> accumulatorForTesting() const noexcept {
    return {accumulator_[0].uK1, accumulator_[0].uK2,
            accumulator_[0].uP,  static_cast<double>(accumulator_[0].count),
            accumulator_[1].uK1, accumulator_[1].uK2,
            accumulator_[1].uP,  static_cast<double>(accumulator_[1].count)};
  }

  [[nodiscard]] std::array<double, 6> slowStateForTesting() const noexcept {
    return {slow_[0].cathode[0].voltage, slow_[0].cathode[1].voltage, slow_[0].supply.voltage,
            slow_[1].cathode[0].voltage, slow_[1].cathode[1].voltage, slow_[1].supply.voltage};
  }

  [[nodiscard]] std::array<double, 9> powerDcStateForTesting(int channel) const noexcept {
    if (channel < 0 || channel >= kChannels) {
      const double invalid = std::numeric_limits<double>::quiet_NaN();
      return {invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid};
    }
    const PowerState &state = power_state_[channel];
    return {state.bPlusV,       state.platePushV, state.platePullV,
            state.screenTapV,   state.screenV,    state.cathodePushV,
            state.cathodePullV, state.iaPushA,    state.ig2PushA};
  }

  // Reads the selected output-valve table at one operating point. The DC oracle is only meaningful
  // if the tables answer the datasheet currents there, so the test needs the same interpolation the
  // Newton step uses rather than a reimplementation of it.
  [[nodiscard]] std::array<double, 2> powerTubeCurrentForTesting(double vak, double vg2k,
                                                                 double vgk) const noexcept {
    PowerLutScratch scratch{};
    double ia = 0.0;
    double ig2 = 0.0;
    interpolatePowerTube(vgk, vak, vg2k, scratch, ia, ig2);
    return {ia, ig2};
  }

  [[nodiscard]] std::array<double, 7> powerLtpStateForTesting(int channel) const noexcept {
    if (channel < 0 || channel >= kChannels) {
      const double invalid = std::numeric_limits<double>::quiet_NaN();
      return {invalid, invalid, invalid, invalid, invalid, invalid, invalid};
    }
    const PowerState &state = power_state_[channel];
    return {state.ltpCathodeV,  state.ltpPlateAV,        state.ltpPlateBV,       state.ltpGridAV,
            state.ltpInputCapV, state.gridCouplingPushV, state.gridCouplingPullV};
  }

  [[nodiscard]] std::array<double, 6> powerWindowStateForTesting(int channel) const noexcept {
    if (channel < 0 || channel >= kChannels) {
      const double invalid = std::numeric_limits<double>::quiet_NaN();
      return {invalid, invalid, invalid, invalid, invalid, invalid};
    }
    const PowerState &state = power_state_[channel];
    return {state.vrmsSquareSum,
            state.realPowerSum,
            state.publishedVrms,
            state.publishedRealPower,
            static_cast<double>(state.powerWindowSamples),
            static_cast<double>(state.slowCounter)};
  }

  void accumulatePowerWindowSampleForTesting(int channel, double voltage, double current) noexcept {
    if (channel < 0 || channel >= kChannels) {
      return;
    }
    PowerState &state = power_state_[channel];
    state.speakerLoadVoltageV = voltage;
    state.speakerLoadCurrentA = current;
    accumulatePowerWindow(state);
  }

  void refreshTelemetryForTesting() noexcept { refreshTelemetryFromState(); }

  [[nodiscard]] std::array<double, 9> powerOutputStateForTesting(int channel) const noexcept {
    if (channel < 0 || channel >= kChannels) {
      const double invalid = std::numeric_limits<double>::quiet_NaN();
      return {invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid};
    }
    const PowerState &state = power_state_[channel];
    return {state.optCurrentA,          state.magnetizingCurrentA,      state.optCapacitorV,
            state.speakerVoiceCurrentA, state.speakerResonanceCurrentA, state.speakerCapacitorV,
            state.speakerLoadVoltageV,  state.speakerLoadCurrentA,      state.feedbackV};
  }

  [[nodiscard]] std::array<double, 4> powerProfileForTesting() const noexcept {
    return {static_cast<double>(power_profile_index_), static_cast<double>(power_speaker_index_),
            power_primary_ohm_, power_selected_turns_ratio_};
  }

  [[nodiscard]] std::array<double, 3> controlCurrentForTesting() const noexcept {
    return {controls_.drive, controls_.output, controls_.mix};
  }

  [[nodiscard]] std::array<double, 3> controlTargetsForTesting() const noexcept {
    return {controls_.driveTarget, controls_.outputTarget, controls_.mixTarget};
  }

  [[nodiscard]] std::size_t firCoefficientCountForTesting() const noexcept {
    return coefficients_.size();
  }

  [[nodiscard]] double firCoefficientForTesting(std::size_t index) const noexcept {
    return index < coefficients_.size() ? coefficients_[index]
                                        : std::numeric_limits<double>::quiet_NaN();
  }

  [[nodiscard]] const std::array<float, kTelemetryPayloadFloats> &
  telemetryPayloadForTesting() const noexcept {
    return telemetry_payload_;
  }

  [[nodiscard]] std::uint64_t slowPublishCountForTesting() const noexcept {
    return slow_publish_count_;
  }

  [[nodiscard]] std::uint64_t finiteFaultsForTesting() const noexcept { return finite_faults_; }

  [[nodiscard]] std::uint64_t safetyLimitsForTesting() const noexcept { return safety_limits_; }

  [[nodiscard]] std::uint64_t plateFallbackSuccessesForTesting() const noexcept {
    return plate_fallback_successes_for_testing_;
  }

  [[nodiscard]] const std::array<std::uint64_t, kGridFallbackMaximumIterations + 1> &
  gridFallbackIterationHistogramForTesting() const noexcept {
    return grid_fallback_iteration_histogram_for_testing_;
  }

  [[nodiscard]] double maximumKclResidualForTesting() const noexcept { return maximum_kcl_; }

  [[nodiscard]] double maximumFastKclResidualForTesting() const noexcept {
    return maximum_fast_kcl_for_testing_.residual;
  }

  [[nodiscard]] std::array<std::uint64_t, 5> maximumFastKclLocationForTesting() const noexcept {
    return {static_cast<std::uint64_t>(maximum_fast_kcl_for_testing_.node),
            static_cast<std::uint64_t>(maximum_fast_kcl_for_testing_.channel),
            maximum_fast_kcl_for_testing_.hostFrame, maximum_fast_kcl_for_testing_.internalFrame,
            static_cast<std::uint64_t>(maximum_fast_kcl_for_testing_.internalPhase)};
  }

  [[nodiscard]] double maximumDcResidualForTesting() const noexcept { return maximum_dc_residual_; }

  [[nodiscard]] double maximumEnergyResidualForTesting() const noexcept {
    return maximum_energy_residual_;
  }

  [[nodiscard]] bool solverConvergedForTesting() const noexcept {
    return finite_faults_ == 0u && block_finite_fault_ == false;
  }

  [[nodiscard]] std::uint32_t topologyIdForTesting() const noexcept {
    return static_cast<std::uint32_t>(applied_parameters_.outputStage);
  }

  [[nodiscard]] std::uint32_t circuitProfileIdForTesting() const noexcept {
    if (applied_parameters_.outputStage == 0) {
      return static_cast<std::uint32_t>(tube_index_);
    }
    if (applied_parameters_.outputStage == 1) {
      return static_cast<std::uint32_t>(power_profile_index_ + 1u);
    }
    return 100u + static_cast<std::uint32_t>(applied_parameters_.seTube * 3 +
                                             applied_parameters_.sePrimaryImpedance);
  }

  [[nodiscard]] bool runtimeFiniteForTesting() const noexcept { return finiteRuntimeDomain(); }

  [[nodiscard]] std::array<double, 4> feedbackControlForTesting() const noexcept {
    return {controls_.feedbackDb, controls_.feedbackQ, controls_.feedbackBeta,
            controls_.feedbackMakeup};
  }

  [[nodiscard]] std::array<double, 9> activeFeedbackCalibrationForTesting() const noexcept {
    return {controls_.feedbackDb, controls_.feedbackQ,    controls_.feedbackB0,
            controls_.feedbackB1, controls_.feedbackA1,   controls_.feedbackA2,
            controls_.feedbackA0, controls_.feedbackBeta, controls_.feedbackMakeup};
  }

  [[nodiscard]] std::array<std::uint64_t, 12> feedbackTransitionForTesting() const noexcept {
    return {
        static_cast<std::uint64_t>(feedback_transition_.phase),
        feedback_transition_.progress,
        feedback_transition_.activeGeneration,
        feedback_transition_.stateGeneration,
        feedback_transition_.pendingGeneration,
        feedback_transition_.queuedGeneration,
        feedback_transition_.nextGeneration,
        feedback_transition_.resetCount,
        feedback_transition_.atomicCommitCount,
        feedback_transition_.warmupWetFrames,
        feedback_transition_.warmupAlignedDryMismatches,
        feedback_transition_.oldStateNewNfProcessCount,
    };
  }

  [[nodiscard]] std::array<double, 9>
  feedbackCalibrationForTesting(int tube_index, double feedback_db) const noexcept {
    const FeedbackCalibration calibration = feedbackCalibration(tube_index, feedback_db);
    return {calibration.feedbackDb, calibration.q,    calibration.b0,
            calibration.b1,         calibration.a1,   calibration.a2,
            calibration.a0,         calibration.beta, calibration.makeup};
  }

  [[nodiscard]] std::array<double, 17> appliedParametersForTesting() const noexcept {
    return {
        applied_parameters_.driveDb,
        static_cast<double>(applied_parameters_.tubeIndex),
        applied_parameters_.biasPercent,
        applied_parameters_.plateV,
        applied_parameters_.sourceZKOhm,
        applied_parameters_.supplyKOhm,
        applied_parameters_.outputDb,
        applied_parameters_.mixPercent,
        applied_parameters_.inputReference,
        applied_parameters_.feedbackDb,
        static_cast<double>(applied_parameters_.outputStage),
        static_cast<double>(applied_parameters_.powerTube),
        applied_parameters_.powerBPlus,
        applied_parameters_.cathodeResistor,
        static_cast<double>(applied_parameters_.screenTap),
        static_cast<double>(applied_parameters_.primaryImpedance),
        static_cast<double>(applied_parameters_.speakerLoad),
    };
  }

  // Current reduction, its target and the frames left in the ramp. Exposed so the native tests
  // can assert the law directly instead of trying to infer it from the audio.
  [[nodiscard]] std::array<double, 3> safetyReductionForTesting() const noexcept {
    return {safety_auto_gain_, safety_auto_target_, static_cast<double>(safety_auto_remaining_)};
  }

  [[nodiscard]] std::uint32_t safetyRampFramesForTesting() const noexcept {
    return safety_ramp_frames_;
  }

  [[nodiscard]] std::array<double, 4> plateReferenceForTesting() const noexcept {
    return {controls_.plateReference, controls_.plateReferenceTarget,
            static_cast<double>(controls_.plateReferenceRemaining), controls_.plateReferenceStep};
  }

  [[nodiscard]] std::uint32_t faultStateForTesting() const noexcept {
    return static_cast<std::uint32_t>(fault_state_);
  }

  [[nodiscard]] double faultWetForTesting() const noexcept { return fault_wet_current_; }

  [[nodiscard]] std::uint64_t detectionFrameForTesting() const noexcept {
    return detection_frame_for_testing_;
  }

  [[nodiscard]] std::uint64_t muteCompleteFrameForTesting() const noexcept {
    return mute_complete_frame_for_testing_;
  }

  [[nodiscard]] std::uint64_t trialObservationStartFrameForTesting() const noexcept {
    return trial_observation_start_frame_for_testing_;
  }

  [[nodiscard]] std::array<double, 3> maximumDetectorRmsForTesting() const noexcept {
    return {maximum_detector_input_rms_for_testing_, maximum_detector_output_rms_for_testing_,
            maximum_detector_feedback_rms_for_testing_};
  }

  void beginDetectorObservationForTesting() noexcept {
    resetDetector();
    detector_window_trace_for_testing_.clear();
    detector_window_trace_overflow_for_testing_ = false;
    maximum_detector_input_rms_for_testing_ = 0.0;
    maximum_detector_output_rms_for_testing_ = 0.0;
    maximum_detector_feedback_rms_for_testing_ = 0.0;
    detection_frame_for_testing_ = std::numeric_limits<std::uint64_t>::max();
    mute_complete_frame_for_testing_ = std::numeric_limits<std::uint64_t>::max();
    trial_observation_start_frame_for_testing_ = std::numeric_limits<std::uint64_t>::max();
  }

  [[nodiscard]] std::uint64_t beginFreshObservationForTesting() noexcept {
    beginDetectorObservationForTesting();
    transition_boundary_trace_for_testing_.clear();
    transition_boundary_trace_overflow_for_testing_ = false;
    runtime_event_ = {0u, 0u, kRuntimeCauseNone};
    fault_state_ = FaultState::normal;
    fault_wet_current_ = 1.0;
    fault_mute_remaining_ = 0u;
    fault_trial_remaining_ = 0u;
    fault_return_remaining_ = 0u;
    pending_fault_parameter_commit_ = false;
    fault_reset_pending_ = false;
    trial_after_fault_reset_ = false;
    fault_clear_pending_ = false;
    block_feedback_detection_offset_ = std::numeric_limits<std::uint32_t>::max();
    central_reset_count_ = 0u;
    last_central_reset_reason_ = CentralResetReason::none;
    finite_faults_ = 0u;
    safety_limits_ = 0u;
    maximum_kcl_ = 0.0;
    maximum_dc_residual_ = 0.0;
    maximum_energy_residual_ = 0.0;
    maximum_fast_kcl_for_testing_ = FastKclObservation{};
    step_safety_hit_ = false;
    block_finite_fault_ = false;
    block_safety_hit_ = false;
    return processed_host_frames_;
  }

  [[nodiscard]] int activeTubeForTesting() const noexcept { return tube_index_; }

  [[nodiscard]] std::array<std::uint32_t, 3> detectorWindowStateForTesting() const noexcept {
    return {detector_driven_growth_windows_, detector_post_input_nondecay_windows_,
            detector_has_previous_ ? 1u : 0u};
  }

  [[nodiscard]] const std::vector<DetectorWindowObservation> &
  detectorWindowTraceForTesting() const noexcept {
    return detector_window_trace_for_testing_;
  }

  [[nodiscard]] bool detectorWindowTraceOverflowForTesting() const noexcept {
    return detector_window_trace_overflow_for_testing_;
  }

  [[nodiscard]] const std::vector<TransitionBoundaryObservation> &
  transitionBoundaryTraceForTesting() const noexcept {
    return transition_boundary_trace_for_testing_;
  }

  [[nodiscard]] bool transitionBoundaryTraceOverflowForTesting() const noexcept {
    return transition_boundary_trace_overflow_for_testing_;
  }

  [[nodiscard]] std::array<std::uint64_t, 2> centralResetStateForTesting() const noexcept {
    return {central_reset_count_, static_cast<std::uint64_t>(last_central_reset_reason_)};
  }

  [[nodiscard]] std::array<std::uint32_t, 3> faultRemainingFramesForTesting() const noexcept {
    return {fault_mute_remaining_, fault_trial_remaining_, fault_return_remaining_};
  }

  [[nodiscard]] std::array<std::uint32_t, 3> runtimeEventForTesting() const noexcept {
    return {runtime_event_.generation, runtime_event_.latched, runtime_event_.cause};
  }

  bool observeDetectorWindowForTesting(double input_rms, double output_rms,
                                       double feedback_rms) noexcept {
    const bool detected = evaluateFeedbackDetectorWindow(input_rms, output_rms, feedback_rms, 0u);
    if (detected) {
      fault_state_ = FaultState::muting;
      fault_mute_remaining_ = feedbackTransitionFrames() + 1u;
    }
    return detected;
  }

  void injectFeedbackOscillationForTesting() noexcept {
    const FaultState previous_state = fault_state_;
    latchRuntimeFault(kRuntimeCauseFeedbackOscillation, 0u);
    if (previous_state == FaultState::trial || previous_state == FaultState::returning) {
      fault_state_ = FaultState::latchedSafeBypass;
      fault_wet_current_ = 0.0;
      fault_trial_remaining_ = 0u;
      fault_return_remaining_ = 0u;
      fault_clear_pending_ = false;
      fault_reset_pending_ = false;
      trial_after_fault_reset_ = false;
    } else if (previous_state == FaultState::normal) {
      fault_state_ = FaultState::muting;
      fault_mute_remaining_ = feedbackTransitionFrames() + 1u;
    }
  }

  void injectProcessingSafetyFailureForTesting() noexcept {
    latchRuntimeFault(kRuntimeCauseProcessingSafetyFailure, 0u);
  }

#if defined(ET_DEBUG_STATE)
  [[nodiscard]] bool beginDebugObservation(std::uint64_t &origin) noexcept override {
    origin = beginFreshObservationForTesting();
    return true;
  }

  [[nodiscard]] bool clearDebugDetectorObservation() noexcept override {
    beginDetectorObservationForTesting();
    return true;
  }

  [[nodiscard]] bool readDebugState(DebugStateSnapshot &state) const noexcept override {
    state.digest = stateDigestForTesting();
    state.transition = feedbackTransitionForTesting();
    const auto applied_parameters = appliedParametersForTesting();
    std::copy_n(applied_parameters.begin(), state.appliedParameters.size(),
                state.appliedParameters.begin());
    state.feedbackCalibration = activeFeedbackCalibrationForTesting();
    state.runtimeEvent = runtime_event_;
    const DetectorWindowObservation *window = detector_window_trace_for_testing_.empty()
                                                  ? nullptr
                                                  : &detector_window_trace_for_testing_.back();
    const TransitionBoundaryObservation *boundary =
        transition_boundary_trace_for_testing_.empty()
            ? nullptr
            : &transition_boundary_trace_for_testing_.back();
    state.auxiliaryWords = {
        static_cast<std::uint64_t>(fault_state_),
        fault_mute_remaining_,
        fault_trial_remaining_,
        fault_return_remaining_,
        central_reset_count_,
        static_cast<std::uint64_t>(last_central_reset_reason_),
        detection_frame_for_testing_,
        mute_complete_frame_for_testing_,
        trial_observation_start_frame_for_testing_,
        detector_window_trace_for_testing_.size(),
        detector_window_trace_overflow_for_testing_ ? 1u : 0u,
        window == nullptr ? 0u : detector_window_trace_for_testing_.size() - 1u,
        window == nullptr ? 0u : window->startFrame,
        window == nullptr ? 0u : window->endFrame,
        window == nullptr ? 0u : window->predicateBits,
        window == nullptr ? 0u : window->growthCount,
        window == nullptr ? 0u : window->sustainedCount,
        window == nullptr ? 0u : window->selectedBranch,
        window == nullptr ? 0u : window->runtimeEvent.generation,
        window == nullptr ? 0u : window->runtimeEvent.latched,
        window == nullptr ? 0u : window->runtimeEvent.cause,
        window == nullptr ? 0u : window->faultState,
        transition_boundary_trace_for_testing_.size(),
        transition_boundary_trace_overflow_for_testing_ ? 1u : 0u,
        boundary == nullptr ? 0u : transition_boundary_trace_for_testing_.size() - 1u,
        boundary == nullptr ? 0u : boundary->frame,
        boundary == nullptr ? 0u : boundary->transition[0],
        boundary == nullptr ? 0u : boundary->transition[1],
        boundary == nullptr ? 0u : boundary->transition[2],
        boundary == nullptr ? 0u : boundary->transition[3],
        boundary == nullptr ? 0u : boundary->transition[4],
        boundary == nullptr ? 0u : boundary->transition[5],
        boundary == nullptr ? 0u : boundary->transition[6],
        boundary == nullptr ? 0u : boundary->transition[7],
        boundary == nullptr ? 0u : boundary->transition[8],
        boundary == nullptr ? 0u : boundary->transition[9],
        boundary == nullptr ? 0u : boundary->transition[10],
        boundary == nullptr ? 0u : boundary->transition[11],
        boundary == nullptr ? 0u : boundary->centralReset[0],
        boundary == nullptr ? 0u : boundary->centralReset[1],
    };
    state.auxiliaryValues = {
        fault_wet_current_,
        window == nullptr ? 0.0 : window->previousInputRms,
        window == nullptr ? 0.0 : window->previousOutputRms,
        window == nullptr ? 0.0 : window->previousFeedbackRms,
        window == nullptr ? 0.0 : window->inputRms,
        window == nullptr ? 0.0 : window->outputRms,
        window == nullptr ? 0.0 : window->feedbackRms,
        boundary == nullptr ? 0.0 : boundary->appliedParameters[0],
        boundary == nullptr ? 0.0 : boundary->appliedParameters[1],
        boundary == nullptr ? 0.0 : boundary->appliedParameters[2],
        boundary == nullptr ? 0.0 : boundary->appliedParameters[3],
        boundary == nullptr ? 0.0 : boundary->appliedParameters[4],
        boundary == nullptr ? 0.0 : boundary->appliedParameters[5],
        boundary == nullptr ? 0.0 : boundary->appliedParameters[6],
        boundary == nullptr ? 0.0 : boundary->appliedParameters[7],
        boundary == nullptr ? 0.0 : boundary->appliedParameters[8],
        boundary == nullptr ? 0.0 : boundary->appliedParameters[9],
        boundary == nullptr ? 0.0 : boundary->feedbackCalibration[0],
        boundary == nullptr ? 0.0 : boundary->feedbackCalibration[1],
        boundary == nullptr ? 0.0 : boundary->feedbackCalibration[2],
        boundary == nullptr ? 0.0 : boundary->feedbackCalibration[3],
        boundary == nullptr ? 0.0 : boundary->feedbackCalibration[4],
        boundary == nullptr ? 0.0 : boundary->feedbackCalibration[5],
        boundary == nullptr ? 0.0 : boundary->feedbackCalibration[6],
        boundary == nullptr ? 0.0 : boundary->feedbackCalibration[7],
        boundary == nullptr ? 0.0 : boundary->feedbackCalibration[8],
    };
    return true;
  }

  [[nodiscard]] bool readDebugStateV2(DebugStateSnapshotV2 &state) const noexcept override {
    if (!readDebugState(state.legacy)) {
      return false;
    }
    state.appliedParameters = appliedParametersForTesting();
    const TransitionBoundaryObservation *boundary =
        transition_boundary_trace_for_testing_.empty()
            ? nullptr
            : &transition_boundary_trace_for_testing_.back();
    state.transitionBoundaryAppliedParameters =
        boundary == nullptr ? std::array<double, 17>{} : boundary->appliedParameters;
    return true;
  }
#endif

#if ET_TUBE_SIMULATOR_TEST_STATE
  void beginLineDesignObservationForTesting() noexcept {
    line_design_observation_enabled_for_testing_ = true;
    second_stage_grid_current_peak_for_testing_ = 0.0;
    second_stage_grid_conduction_steps_for_testing_ = 0u;
    second_stage_grid_total_steps_for_testing_ = 0u;
  }

  [[nodiscard]] double secondStageGridCurrentPeakForTesting() const noexcept {
    return second_stage_grid_current_peak_for_testing_;
  }

  [[nodiscard]] double secondStageGridConductionDutyForTesting() const noexcept {
    if (second_stage_grid_total_steps_for_testing_ == 0u) {
      return 0.0;
    }
    return static_cast<double>(second_stage_grid_conduction_steps_for_testing_) /
           static_cast<double>(second_stage_grid_total_steps_for_testing_);
  }

  [[nodiscard]] double stage1ExternalInputPeakForTesting(int channel,
                                                         std::uint32_t frame_count) const noexcept {
    if (channel < 0 || channel >= kChannels || frame_count > max_frames_) {
      return std::numeric_limits<double>::quiet_NaN();
    }
    double peak = 0.0;
    const std::uint32_t internal_frames =
        frame_count * static_cast<std::uint32_t>(rate_config_.factor);
    for (std::uint32_t frame = 0u; frame < internal_frames; ++frame) {
      const double value = internal_input_[channel][frame];
      const double magnitude = value >= 0.0 ? value : -value;
      if (magnitude > peak) {
        peak = magnitude;
      }
    }
    return peak;
  }

  [[nodiscard]] double rawLineOutputForTesting(int channel, std::uint32_t frame) const noexcept {
    if (channel < 0 || channel >= kChannels || frame >= max_frames_) {
      return std::numeric_limits<double>::quiet_NaN();
    }
    const int current = downsample_history_ +
                        static_cast<int>(frame * static_cast<std::uint32_t>(rate_config_.factor));
    double output = 0.0;
    for (int tap = 0; tap < rate_config_.firLength; ++tap) {
      output += coefficients_[static_cast<std::size_t>(tap)] *
                internal_work_[channel][static_cast<std::size_t>(current - tap)];
    }
    return output * 1000.0;
  }
#endif

  [[nodiscard]] bool processBlockForTesting(float *audio, std::uint32_t frame_count) noexcept {
    handleFaultBoundary();
    return processWithFaultHandling(audio, frame_count);
  }

  [[nodiscard]] static constexpr bool simdPathAvailableForTesting() noexcept {
    return ET_TUBE_HAS_F64X2 != 0;
  }
#endif

private:
  [[nodiscard]] bool driverBypassed() const noexcept { return tube_index_ == kBypassDriverIndex; }

  [[nodiscard]] int effectiveDriverTubeIndex() const noexcept {
    // The bypassed driver is dormant, but reset seeding still needs a valid table.
    return driverBypassed() ? 0 : tube_index_;
  }

  [[nodiscard]] const TubeParameters &activeTube() const noexcept {
    return kTubeRows[static_cast<std::size_t>(effectiveDriverTubeIndex())];
  }

  [[nodiscard]] const TubeTables &tubeTable() const noexcept {
    return tubeTables()[static_cast<std::size_t>(effectiveDriverTubeIndex())];
  }

  [[nodiscard]] GridEvaluation evaluateGrid(double vgk) const noexcept {
    return tubeTable().evaluateGrid(vgk);
  }

  [[nodiscard]] PlateEvaluation evaluatePlate(double vgk, double vak) const noexcept {
    return tubeTable().evaluatePlate(vgk, vak);
  }

  void designFir() noexcept {
    const auto canonical =
        effetune::dsp::tube_simulator_generated::findFirCoefficientBits(rate_config_.hostRate);
    coefficients_.assign(static_cast<std::size_t>(rate_config_.firLength), 0.0);
    if (canonical.coefficientCount != coefficients_.size() ||
        canonical.halfCount != (coefficients_.size() + 1u) / 2u) {
      coefficients_.clear();
      return;
    }
    for (std::size_t index = 0; index < canonical.halfCount; ++index) {
      const double coefficient = std::bit_cast<double>(canonical.halfBits[index]);
      coefficients_[index] = coefficient;
      coefficients_[coefficients_.size() - 1u - index] = coefficient;
    }
  }

  [[nodiscard]] bool decodeParameters(Path2Parameters &decoded) const noexcept {
    const double drive = static_cast<double>(params_.inputVolume);
    const double tube = static_cast<double>(params_.tube);
    const double bias = static_cast<double>(params_.bias);
    const double plate = static_cast<double>(params_.plate);
    const double source = static_cast<double>(params_.sourceZ);
    const double supply = static_cast<double>(params_.supply);
    const double output = static_cast<double>(params_.outputTrim);
    const double mix = static_cast<double>(params_.mix);
    const double input_reference = static_cast<double>(params_.inputReference);
    const double feedback = static_cast<double>(params_.negativeFeedback);
    const double output_stage = static_cast<double>(params_.outputStage);
    const double power_tube = static_cast<double>(params_.powerTube);
    const double power_b_plus = static_cast<double>(params_.powerBPlus);
    const double cathode_resistor = static_cast<double>(params_.cathodeResistor);
    const double screen_tap = static_cast<double>(params_.screenTap);
    const double primary_impedance = static_cast<double>(params_.primaryImpedance);
    const double speaker_load = static_cast<double>(params_.speakerLoad);
    const double actual_load = static_cast<double>(params_.actualSpeakerLoad);
    const double safety_trim = static_cast<double>(params_.safetyTrim);
    const double auto_gain_reduction = static_cast<double>(params_.autoGainReduction);
    const double se_tube = static_cast<double>(params_.seTube);
    const double se_b_plus = static_cast<double>(params_.seBPlus);
    const double se_cathode_resistor = static_cast<double>(params_.seCathodeResistor);
    const double se_primary_impedance = static_cast<double>(params_.sePrimaryImpedance);
    if (!std::isfinite(actual_load) || actual_load < 2.0 || actual_load > 32.0) {
      return false;
    }
    if (!std::isfinite(safety_trim) || safety_trim < -96.0 || safety_trim > 0.0 ||
        !std::isfinite(auto_gain_reduction) || auto_gain_reduction < 0.0 ||
        auto_gain_reduction > 1.0 || auto_gain_reduction != std::floor(auto_gain_reduction)) {
      return false;
    }
    if (!std::isfinite(drive) || drive < -96.0 || drive > 0.0 || !std::isfinite(tube) ||
        tube < 0.0 || tube > 3.0 || tube != std::floor(tube) || !std::isfinite(bias) ||
        bias < -50.0 || bias > 50.0 || !std::isfinite(plate) || plate < 150.0 || plate > 300.0 ||
        !std::isfinite(source) || source < 0.6 || source > 100.0 || !std::isfinite(supply) ||
        supply < 0.1 || supply > 47.0 || !std::isfinite(output) || output < -48.0 ||
        output > 48.0 || !std::isfinite(mix) || mix < 0.0 || mix > 100.0 ||
        !std::isfinite(input_reference) || input_reference < 0.1 || input_reference > 300.0 ||
        !std::isfinite(feedback) || feedback < 0.0 || feedback > 30.0 ||
        !std::isfinite(output_stage) || output_stage < 0.0 || output_stage > 2.0 ||
        output_stage != std::floor(output_stage) || !std::isfinite(power_tube) ||
        power_tube < 0.0 || power_tube > 3.0 || power_tube != std::floor(power_tube) ||
        !std::isfinite(power_b_plus) || power_b_plus < 300.0 || power_b_plus > 470.0 ||
        !std::isfinite(cathode_resistor) || cathode_resistor < 270.0 || cathode_resistor > 500.0 ||
        !std::isfinite(screen_tap) || screen_tap < 0.0 || screen_tap > 2.0 ||
        screen_tap != std::floor(screen_tap) || !std::isfinite(primary_impedance) ||
        primary_impedance < 0.0 || primary_impedance > 2.0 ||
        primary_impedance != std::floor(primary_impedance) || !std::isfinite(speaker_load) ||
        speaker_load < 0.0 || speaker_load > 3.0 || speaker_load != std::floor(speaker_load) ||
        !std::isfinite(se_tube) || se_tube < 0.0 || se_tube > 1.0 ||
        se_tube != std::floor(se_tube) || !std::isfinite(se_b_plus) || se_b_plus < 250.0 ||
        se_b_plus > 450.0 || !std::isfinite(se_cathode_resistor) || se_cathode_resistor < 700.0 ||
        se_cathode_resistor > 1300.0 || !std::isfinite(se_primary_impedance) ||
        se_primary_impedance < 0.0 || se_primary_impedance > 2.0 ||
        se_primary_impedance != std::floor(se_primary_impedance)) {
      return false;
    }
    decoded = {drive,
               static_cast<int>(tube),
               bias,
               plate,
               source,
               supply,
               output,
               mix,
               input_reference,
               feedback,
               static_cast<int>(output_stage),
               static_cast<int>(power_tube),
               power_b_plus,
               cathode_resistor,
               static_cast<int>(screen_tap),
               static_cast<int>(primary_impedance),
               static_cast<int>(speaker_load),
               actual_load,
               safety_trim,
               auto_gain_reduction != 0.0,
               static_cast<int>(se_tube),
               se_b_plus,
               se_cathode_resistor,
               static_cast<int>(se_primary_impedance)};
    return true;
  }

  void capturePendingParameters() noexcept {
    if (!paramsDirty()) {
      return;
    }
    Path2Parameters decoded;
    if (decodeParameters(decoded)) {
      decoded_parameters_ = decoded;
      parameter_commit_pending_ = true;
      parameters_initialized_ = true;
    }
  }

  [[nodiscard]] static bool resetClassChanged(const Path2Parameters &left,
                                              const Path2Parameters &right) noexcept {
    if (left.outputStage != right.outputStage) {
      return true;
    }
    if (left.feedbackDb != right.feedbackDb || left.tubeIndex != right.tubeIndex) {
      return true;
    }
    if (left.outputStage == 1) {
      return left.powerTube != right.powerTube || left.screenTap != right.screenTap;
    }
    return left.outputStage == 2 && left.seTube != right.seTube;
  }

  [[nodiscard]] static bool finiteParameters(const Path2Parameters &parameters) noexcept {
    return std::isfinite(parameters.driveDb) && parameters.tubeIndex >= 0 &&
           parameters.tubeIndex < 4 && std::isfinite(parameters.biasPercent) &&
           std::isfinite(parameters.plateV) && std::isfinite(parameters.sourceZKOhm) &&
           std::isfinite(parameters.supplyKOhm) && std::isfinite(parameters.outputDb) &&
           std::isfinite(parameters.mixPercent) && std::isfinite(parameters.inputReference) &&
           std::isfinite(parameters.feedbackDb) && parameters.outputStage >= 0 &&
           parameters.outputStage < 3 && parameters.powerTube >= 0 && parameters.powerTube < 4 &&
           std::isfinite(parameters.powerBPlus) && std::isfinite(parameters.cathodeResistor) &&
           parameters.screenTap >= 0 && parameters.screenTap < 3 &&
           parameters.primaryImpedance >= 0 && parameters.primaryImpedance < 3 &&
           parameters.speakerLoad >= 0 && parameters.speakerLoad < 4 &&
           std::isfinite(parameters.actualLoadOhm) && parameters.actualLoadOhm > 0.0 &&
           std::isfinite(parameters.safetyTrimDb) && parameters.seTube >= 0 &&
           parameters.seTube < 2 && std::isfinite(parameters.seBPlus) &&
           std::isfinite(parameters.seCathodeResistor) && parameters.sePrimaryImpedance >= 0 &&
           parameters.sePrimaryImpedance < 3;
  }

  // Number of active parameter values that differ. Used only by the safety-reduction reset rule,
  // which needs to tell one control write from a whole-record write. A stage change retains the
  // original all-field count so loading a cross-topology preset still clears the reduction.
  [[nodiscard]] static std::uint32_t changedParameterCount(const Path2Parameters &left,
                                                           const Path2Parameters &right) noexcept {
    std::uint32_t count = 0u;
    count += left.driveDb != right.driveDb ? 1u : 0u;
    count += left.tubeIndex != right.tubeIndex ? 1u : 0u;
    count += left.biasPercent != right.biasPercent ? 1u : 0u;
    count += left.plateV != right.plateV ? 1u : 0u;
    count += left.sourceZKOhm != right.sourceZKOhm ? 1u : 0u;
    count += left.supplyKOhm != right.supplyKOhm ? 1u : 0u;
    count += left.outputDb != right.outputDb ? 1u : 0u;
    count += left.mixPercent != right.mixPercent ? 1u : 0u;
    count += left.inputReference != right.inputReference ? 1u : 0u;
    count += left.feedbackDb != right.feedbackDb ? 1u : 0u;
    count += left.safetyTrimDb != right.safetyTrimDb ? 1u : 0u;
    count += left.autoGainReduction != right.autoGainReduction ? 1u : 0u;
    const bool stage_changed = left.outputStage != right.outputStage;
    count += stage_changed ? 1u : 0u;
    if (stage_changed || left.outputStage == 1) {
      count += left.powerTube != right.powerTube ? 1u : 0u;
      count += left.powerBPlus != right.powerBPlus ? 1u : 0u;
      count += left.cathodeResistor != right.cathodeResistor ? 1u : 0u;
      count += left.screenTap != right.screenTap ? 1u : 0u;
      count += left.primaryImpedance != right.primaryImpedance ? 1u : 0u;
    }
    if (stage_changed || left.outputStage != 0) {
      count += left.speakerLoad != right.speakerLoad ? 1u : 0u;
      count += left.actualLoadOhm != right.actualLoadOhm ? 1u : 0u;
    }
    if (stage_changed || left.outputStage == 2) {
      count += left.seTube != right.seTube ? 1u : 0u;
      count += left.seBPlus != right.seBPlus ? 1u : 0u;
      count += left.seCathodeResistor != right.seCathodeResistor ? 1u : 0u;
      count += left.sePrimaryImpedance != right.sePrimaryImpedance ? 1u : 0u;
    }
    return count;
  }

  [[nodiscard]] static bool trialEligibleChanged(const Path2Parameters &left,
                                                 const Path2Parameters &right) noexcept {
    if (resetClassChanged(left, right) || left.biasPercent != right.biasPercent ||
        left.plateV != right.plateV || left.sourceZKOhm != right.sourceZKOhm ||
        left.supplyKOhm != right.supplyKOhm || left.inputReference != right.inputReference) {
      return true;
    }
    if (left.outputStage == 1) {
      return left.powerBPlus != right.powerBPlus || left.cathodeResistor != right.cathodeResistor ||
             left.primaryImpedance != right.primaryImpedance ||
             left.speakerLoad != right.speakerLoad || left.actualLoadOhm != right.actualLoadOhm;
    }
    if (left.outputStage == 2) {
      return left.seBPlus != right.seBPlus || left.seCathodeResistor != right.seCathodeResistor ||
             left.sePrimaryImpedance != right.sePrimaryImpedance ||
             left.speakerLoad != right.speakerLoad || left.actualLoadOhm != right.actualLoadOhm;
    }
    return false;
  }

  [[nodiscard]] static bool fastAutomationOnlyChanged(const Path2Parameters &left,
                                                      const Path2Parameters &right) noexcept {
    return left.tubeIndex == right.tubeIndex && left.biasPercent == right.biasPercent &&
           left.plateV == right.plateV && left.sourceZKOhm == right.sourceZKOhm &&
           left.supplyKOhm == right.supplyKOhm && left.feedbackDb == right.feedbackDb &&
           left.outputStage == right.outputStage && left.powerTube == right.powerTube &&
           left.powerBPlus == right.powerBPlus && left.cathodeResistor == right.cathodeResistor &&
           left.screenTap == right.screenTap && left.primaryImpedance == right.primaryImpedance &&
           left.speakerLoad == right.speakerLoad && left.actualLoadOhm == right.actualLoadOhm &&
           left.autoGainReduction == right.autoGainReduction && left.seTube == right.seTube &&
           left.seBPlus == right.seBPlus && left.seCathodeResistor == right.seCathodeResistor &&
           left.sePrimaryImpedance == right.sePrimaryImpedance &&
           (left.driveDb != right.driveDb || left.outputDb != right.outputDb ||
            left.mixPercent != right.mixPercent || left.inputReference != right.inputReference ||
            left.safetyTrimDb != right.safetyTrimDb);
  }

  [[nodiscard]] FeedbackCalibration feedbackCalibration(int tube_index,
                                                        double feedback_db) const noexcept {
    const std::size_t family = rate_config_.internalRate == 352800.0 ? 0u : 1u;
    const std::size_t group = static_cast<std::size_t>(tube_index) * 2u + family;
    const std::size_t group_offset = group * kFeedbackGroupStride;
    const double detector_real = feedbackTableValue(group_offset);
    const double detector_imaginary = feedbackTableValue(group_offset + 1u);
    if (feedback_db == 0.0) {
      constexpr double kCanonicalA0Family441 = 122.20953976980046;
      constexpr double kCanonicalA0Family48 = 122.21477702125433;
      return {
          0.0, 0.0, 1.0, 0.0, 0.0, 0.0, family == 0u ? kCanonicalA0Family441 : kCanonicalA0Family48,
          0.0, 1.0};
    }

    const double position = feedback_db * 2.0;
    const std::size_t low = static_cast<std::size_t>(std::floor(position));
    const std::size_t high = low < kFeedbackKnotsPerGroup - 1u ? low + 1u : low;
    const double fraction = position - static_cast<double>(low);
    const auto coefficient = [&](std::size_t field) noexcept {
      const std::size_t low_offset = group_offset + 2u + low * kFeedbackFieldsPerKnot + field;
      const std::size_t high_offset = group_offset + 2u + high * kFeedbackFieldsPerKnot + field;
      const double left = feedbackTableValue(low_offset);
      return left + fraction * (feedbackTableValue(high_offset) - left);
    };
    const double b0 = coefficient(0u);
    const double b1 = coefficient(1u);
    const double a1 = coefficient(2u);
    const double a2 = coefficient(3u);
    constexpr double pi = 3.14159265358979323846264338327950288;
    const double angle = 2.0 * pi * 1000.0 / rate_config_.internalRate;
    const double z1_real = std::cos(angle);
    const double z1_imaginary = -std::sin(angle);
    const double z2_real = std::cos(2.0 * angle);
    const double z2_imaginary = -std::sin(2.0 * angle);
    const double numerator_real = b0 + b1 * z1_real;
    const double numerator_imaginary = b1 * z1_imaginary;
    const double denominator_real = 1.0 + a1 * z1_real + a2 * z2_real;
    const double denominator_imaginary = a1 * z1_imaginary + a2 * z2_imaginary;
    const double denominator_magnitude_squared =
        denominator_real * denominator_real + denominator_imaginary * denominator_imaginary;
    const double response_real =
        (numerator_real * denominator_real + numerator_imaginary * denominator_imaginary) /
        denominator_magnitude_squared;
    const double response_imaginary =
        (numerator_imaginary * denominator_real - numerator_real * denominator_imaginary) /
        denominator_magnitude_squared;
    const double detected_real =
        detector_real * response_real - detector_imaginary * response_imaginary;
    const double detected_imaginary =
        detector_real * response_imaginary + detector_imaginary * response_real;
    const double a0 = std::hypot(detected_real, detected_imaginary);
    const double q = std::pow(10.0, feedback_db / 20.0) - 1.0;
    const double beta = q / a0;
    const double response_magnitude = std::hypot(response_real, response_imaginary);
    const double makeup =
        std::hypot(1.0 + beta * detected_real, beta * detected_imaginary) / response_magnitude;
    return {feedback_db, q, b0, b1, a1, a2, a0, beta, makeup};
  }

  void applyFeedbackCalibration() noexcept {
    const int calibration_tube_index = effectiveDriverTubeIndex();
    FeedbackCalibration calibration = feedbackCalibration(
        calibration_tube_index, driverBypassed() && applied_parameters_.outputStage == 0
                                    ? 0.0
                                    : applied_parameters_.feedbackDb);
    if (applied_parameters_.outputStage == 1) {
      // The Power branch carries its own compensator. Its plant is a different circuit from the
      // Line branch - a phase inverter, a push-pull pair, an output transformer and a loudspeaker -
      // and borrowing the Line ladder left a +16.8 dB hump at 1 kHz on the first anchor knot, which
      // on its own put the twenty-kilohertz tilt outside the envelope and stopped the half-decibel
      // walk at zero feedback for every key. The ladder below is derived from the measured Power
      // plant by tests/tools/tube-simulator-lineamp/derive-power-anchors.mjs, on the same
      // two-pole one-zero form and the same acceptance envelope the Line branch uses.
      const std::uint32_t family = rate_config_.internalRate == 352800.0 ? 0u : 1u;
      const effetune::dsp::tube_simulator_phase_c_generated::PowerFeedbackRecord *selected =
          nullptr;
      for (const auto &record :
           effetune::dsp::tube_simulator_phase_c_generated::kPowerFeedbackRecords) {
        if (record.driverTube == static_cast<std::uint32_t>(calibration_tube_index) &&
            record.powerTube == static_cast<std::uint32_t>(applied_parameters_.powerTube) &&
            record.screenTap == static_cast<std::uint32_t>(applied_parameters_.screenTap) &&
            record.primary == static_cast<std::uint32_t>(applied_parameters_.primaryImpedance) &&
            record.speakerLoad == static_cast<std::uint32_t>(applied_parameters_.speakerLoad) &&
            record.family == family) {
          selected = &record;
          break;
        }
      }
      if (selected != nullptr && driverBypassed()) {
        // The measured response contains the selected driver's gain and the fixed interstage
        // divider. Bypass injects Input Reference directly at the phase-inverter coupling
        // capacitor, so remove both factors. The shorter plant uses an identity compensator; the
        // normal instability detector remains the safety boundary for aggressive feedback.
        const std::size_t driver_group = static_cast<std::size_t>(calibration_tube_index) * 2u +
                                         static_cast<std::size_t>(family);
        const std::size_t driver_offset = driver_group * kFeedbackGroupStride;
        const double driver_a0 =
            std::hypot(feedbackTableValue(driver_offset), feedbackTableValue(driver_offset + 1u));
        const double divider =
            power_ltp_.preVolumeSourceConductance * power_ltp_.inverseWiperConductanceOpen;
        const double bypass_a0 =
            std::hypot(selected->detectorReal, selected->detectorImaginary) / driver_a0 / divider;
        calibration.b0 = 1.0;
        calibration.b1 = 0.0;
        calibration.a1 = 0.0;
        calibration.a2 = 0.0;
        calibration.a0 = bypass_a0;
        calibration.beta = calibration.q / bypass_a0;
      } else if (selected != nullptr) {
        // Ladder knot: the compensator is the anchor blended towards the identity filter along
        // v = log1p(q)/log1p(q30), the same rule the Line ladder knots were generated with, so the
        // sixty-one knots the design fixture records are reproduced exactly at every setting.
        constexpr double kLog1pQ30 = 3.4538776394910684;
        const double v = std::log1p(calibration.q) / kLog1pQ30;
        const double b0 = 1.0 + v * (selected->anchorB0 - 1.0);
        const double b1 = v * selected->anchorB1;
        const double a1 = v * selected->anchorA1;
        const double a2 = v * selected->anchorA2;
        constexpr double pi = 3.14159265358979323846264338327950288;
        const double angle = 2.0 * pi * 1000.0 / rate_config_.internalRate;
        const double z1_real = std::cos(angle);
        const double z1_imaginary = -std::sin(angle);
        const double z2_real = std::cos(2.0 * angle);
        const double z2_imaginary = -std::sin(2.0 * angle);
        const double numerator_real = b0 + b1 * z1_real;
        const double numerator_imaginary = b1 * z1_imaginary;
        const double denominator_real = 1.0 + a1 * z1_real + a2 * z2_real;
        const double denominator_imaginary = a1 * z1_imaginary + a2 * z2_imaginary;
        const double denominator_magnitude_squared =
            denominator_real * denominator_real + denominator_imaginary * denominator_imaginary;
        const double response_real =
            (numerator_real * denominator_real + numerator_imaginary * denominator_imaginary) /
            denominator_magnitude_squared;
        const double response_imaginary =
            (numerator_imaginary * denominator_real - numerator_real * denominator_imaginary) /
            denominator_magnitude_squared;
        const double detected_real = selected->detectorReal * response_real -
                                     selected->detectorImaginary * response_imaginary;
        const double detected_imaginary = selected->detectorReal * response_imaginary +
                                          selected->detectorImaginary * response_real;
        const double power_a0 = std::hypot(detected_real, detected_imaginary);
        calibration.b0 = b0;
        calibration.b1 = b1;
        calibration.a1 = a1;
        calibration.a2 = a2;
        calibration.a0 = power_a0;
        calibration.beta = calibration.q / power_a0;
      }
      // The Power branch takes its output level from the transformer secondary, so the loop is not
      // asked to hand back the gain it removed.
      calibration.makeup = 1.0;
    } else if (applied_parameters_.outputStage == 2) {
      calibration.feedbackDb = applied_parameters_.feedbackDb;
      calibration.q = std::pow(10.0, calibration.feedbackDb / 20.0) - 1.0;
      calibration.b0 = 1.0;
      calibration.b1 = 0.0;
      calibration.a1 = 0.0;
      calibration.a2 = 0.0;
      const std::uint32_t family = rate_config_.internalRate == 352800.0 ? 0u : 1u;
      const effetune::dsp::tube_simulator_phase_c_generated::SeFeedbackRecord *selected = nullptr;
      for (const auto &record :
           effetune::dsp::tube_simulator_phase_c_generated::kSeFeedbackRecords) {
        if (record.driverTube == static_cast<std::uint32_t>(calibration_tube_index) &&
            record.seTube == static_cast<std::uint32_t>(applied_parameters_.seTube) &&
            record.primary == static_cast<std::uint32_t>(applied_parameters_.sePrimaryImpedance) &&
            record.speakerLoad == static_cast<std::uint32_t>(applied_parameters_.speakerLoad) &&
            record.family == family) {
          selected = &record;
          break;
        }
      }
      if (selected != nullptr && driverBypassed()) {
        const std::size_t driver_group = static_cast<std::size_t>(calibration_tube_index) * 2u +
                                         static_cast<std::size_t>(family);
        const std::size_t driver_offset = driver_group * kFeedbackGroupStride;
        const double driver_a0 =
            std::hypot(feedbackTableValue(driver_offset), feedbackTableValue(driver_offset + 1u));
        calibration.a0 = selected->a0 / driver_a0;
      } else {
        calibration.a0 = selected == nullptr ? 1.0 : selected->a0;
      }
      calibration.beta = calibration.q / calibration.a0;
      calibration.makeup = 1.0;
    }
    controls_.feedbackDb = calibration.feedbackDb;
    controls_.feedbackQ = calibration.q;
    controls_.feedbackB0 = calibration.b0;
    controls_.feedbackB1 = calibration.b1;
    controls_.feedbackA1 = calibration.a1;
    controls_.feedbackA2 = calibration.a2;
    controls_.feedbackA0 = calibration.a0;
    controls_.feedbackBeta = calibration.beta;
    controls_.feedbackMakeup = calibration.makeup;
  }

#if ET_TUBE_SIMULATOR_TEST_STATE
  void captureTransitionBoundaryForTesting() noexcept {
    if (transition_boundary_trace_for_testing_.size() < kTransitionTraceCapacity &&
        transition_boundary_trace_for_testing_.size() <
            transition_boundary_trace_for_testing_.capacity()) {
      transition_boundary_trace_for_testing_.push_back(
          {processed_host_frames_, feedbackTransitionForTesting(), appliedParametersForTesting(),
           activeFeedbackCalibrationForTesting(), centralResetStateForTesting()});
    } else {
      transition_boundary_trace_overflow_for_testing_ = true;
    }
  }
#endif

  void beginFeedbackTransition(const Path2Parameters &parameters,
                               std::uint32_t generation = 0u) noexcept {
    feedback_transition_.phase = FeedbackTransitionPhase::fadeOut;
    feedback_transition_.progress = 0u;
    feedback_transition_.pendingGeneration =
        generation != 0u ? generation : feedback_transition_.nextGeneration++;
    pending_transition_parameters_ = parameters;
    pending_transition_parameters_valid_ = true;
#if ET_TUBE_SIMULATOR_TEST_STATE
    captureTransitionBoundaryForTesting();
#endif
  }

  void applyNonResetParameters(const Path2Parameters &decoded) noexcept {
    const bool reference_changed = decoded.biasPercent != applied_parameters_.biasPercent ||
                                   decoded.plateV != applied_parameters_.plateV ||
                                   decoded.sourceZKOhm != applied_parameters_.sourceZKOhm ||
                                   decoded.supplyKOhm != applied_parameters_.supplyKOhm;
    applied_parameters_.driveDb = decoded.driveDb;
    applied_parameters_.biasPercent = decoded.biasPercent;
    applied_parameters_.plateV = decoded.plateV;
    applied_parameters_.sourceZKOhm = decoded.sourceZKOhm;
    applied_parameters_.supplyKOhm = decoded.supplyKOhm;
    applied_parameters_.outputDb = decoded.outputDb;
    applied_parameters_.mixPercent = decoded.mixPercent;
    applied_parameters_.inputReference = decoded.inputReference;
    applied_parameters_.powerBPlus = decoded.powerBPlus;
    applied_parameters_.cathodeResistor = decoded.cathodeResistor;
    applied_parameters_.primaryImpedance = decoded.primaryImpedance;
    applied_parameters_.speakerLoad = decoded.speakerLoad;
    applied_parameters_.actualLoadOhm = decoded.actualLoadOhm;
    // The safety trim and its automatic companion sit outside the amplifier model, so they never
    // belong to the reset class: moving the trim must not mute the output for a transition.
    applied_parameters_.safetyTrimDb = decoded.safetyTrimDb;
    applied_parameters_.autoGainReduction = decoded.autoGainReduction;
    applied_parameters_.seBPlus = decoded.seBPlus;
    applied_parameters_.seCathodeResistor = decoded.seCathodeResistor;
    applied_parameters_.sePrimaryImpedance = decoded.sePrimaryImpedance;
    applyPath2Parameters(false);
    if (reference_changed) {
      FastChannel dc_fast{};
      SlowState dc_slow{};
      solveDc(dc_slow, dc_fast);
      schedulePlateReference(dc_fast.stage[1].plateVoltage, false);
    }
  }

  void applyFastAutomationParameters(const Path2Parameters &decoded) noexcept {
    applied_parameters_.driveDb = decoded.driveDb;
    applied_parameters_.outputDb = decoded.outputDb;
    applied_parameters_.mixPercent = decoded.mixPercent;
    applied_parameters_.inputReference = decoded.inputReference;
    applied_parameters_.safetyTrimDb = decoded.safetyTrimDb;
    updateFastControlTargets(false);
  }

  void commitDecodedParameters() noexcept {
    if (!parameter_commit_pending_) {
      return;
    }
    // The accumulated reduction is cleared on exactly two conditions: the safety trim value
    // changed, or two or more active parameter values changed in one commit.
    //
    // The count is the discriminator between a knob and a preset. A control commits one key at a
    // time, so an ordinary move differs in exactly one value and protection is kept; a preset load
    // that actually moves the active circuit differs in several at once. Inactive topology fields
    // are excluded so editing dimmed controls cannot surrender protection; cross-topology presets
    // retain the original all-field count. Re-selecting the preset the circuit is already on after
    // moving one single control differs in that one value alone, so it keeps the reduction rather
    // than clearing it; the trim itself remains the way to give it up deliberately.
    //
    // Both conditions are value differences against the last committed set, never write edges.
    // The host rewrites the whole parameter block on a cadence of its own and paramsDirty()
    // reports "was written", not "changed", so an edge-driven reset would fire on writes that
    // carry identical values and would diverge from the JavaScript reference, which recommits
    // every block.
    if (!has_applied_parameters_) {
      committed_parameters_ = decoded_parameters_;
    } else {
      const bool trim_changed =
          decoded_parameters_.safetyTrimDb != committed_parameters_.safetyTrimDb;
      const std::uint32_t changed =
          changedParameterCount(decoded_parameters_, committed_parameters_);
      committed_parameters_ = decoded_parameters_;
      if (trim_changed || changed >= 2u) {
        resetSafetyReduction();
      }
    }
    const bool circuit_changed = trialEligibleChanged(decoded_parameters_, applied_parameters_);
    const bool host_control_changed =
        decoded_parameters_.driveDb != applied_parameters_.driveDb ||
        decoded_parameters_.outputDb != applied_parameters_.outputDb ||
        decoded_parameters_.mixPercent != applied_parameters_.mixPercent;

    if (runtime_event_.latched != 0u &&
        runtime_event_.cause == kRuntimeCauseProcessingSafetyFailure) {
      applied_parameters_ = decoded_parameters_;
      tube_index_ = applied_parameters_.tubeIndex;
      applyPath2Parameters(false);
      parameter_commit_pending_ = false;
      has_applied_parameters_ = true;
      return;
    }

    // These five host lanes only retarget already-existing smoothers. In particular, they must
    // not enter applyPath2Parameters(), whose power branch recomputes circuit coefficients and
    // performs a quiescent solve even though none of those circuit inputs changed.
    if (has_applied_parameters_ &&
        feedback_transition_.phase == FeedbackTransitionPhase::inactive &&
        fastAutomationOnlyChanged(decoded_parameters_, applied_parameters_)) {
      applyFastAutomationParameters(decoded_parameters_);
      parameter_commit_pending_ = false;
      return;
    }

    if (!has_applied_parameters_) {
      applied_parameters_ = decoded_parameters_;
      tube_index_ = applied_parameters_.tubeIndex;
      applyPath2Parameters(false);
      parameter_commit_pending_ = false;
      has_applied_parameters_ = true;
      resetModel();
      return;
    }

    if (runtime_event_.latched != 0u && runtime_event_.cause == kRuntimeCauseFeedbackOscillation &&
        fault_state_ == FaultState::muting && circuit_changed) {
      pending_fault_parameters_ = decoded_parameters_;
      pending_fault_parameter_commit_ = true;
      if (host_control_changed) {
        applied_parameters_.driveDb = decoded_parameters_.driveDb;
        applied_parameters_.outputDb = decoded_parameters_.outputDb;
        applied_parameters_.mixPercent = decoded_parameters_.mixPercent;
        applyPath2Parameters(false);
      }
      parameter_commit_pending_ = false;
      return;
    }

    if (runtime_event_.latched != 0u && runtime_event_.cause == kRuntimeCauseFeedbackOscillation &&
        circuit_changed) {
      applied_parameters_ = decoded_parameters_;
      tube_index_ = applied_parameters_.tubeIndex;
      applyPath2Parameters(false);
      parameter_commit_pending_ = false;
      has_applied_parameters_ = true;
      fault_reset_pending_ = true;
      trial_after_fault_reset_ = true;
      fault_state_ = FaultState::latchedSafeBypass;
      fault_wet_current_ = 0.0;
      return;
    }

    if (feedback_transition_.phase != FeedbackTransitionPhase::inactive) {
      const bool reset_class_changed = resetClassChanged(decoded_parameters_, applied_parameters_);
      if (feedback_transition_.phase == FeedbackTransitionPhase::fadeOut) {
        pending_transition_parameters_ = decoded_parameters_;
        pending_transition_parameters_valid_ = true;
        if (!reset_class_changed) {
          applyNonResetParameters(decoded_parameters_);
        }
      } else if (reset_class_changed) {
        queued_transition_parameters_ = decoded_parameters_;
        queued_transition_parameters_valid_ = true;
        if (feedback_transition_.queuedGeneration == 0u) {
          feedback_transition_.queuedGeneration = feedback_transition_.nextGeneration++;
        }
      } else {
        applyNonResetParameters(decoded_parameters_);
        queued_transition_parameters_valid_ = false;
        feedback_transition_.queuedGeneration = 0u;
      }
      parameter_commit_pending_ = false;
      return;
    }

    if (resetClassChanged(decoded_parameters_, applied_parameters_)) {
      beginFeedbackTransition(decoded_parameters_);
      parameter_commit_pending_ = false;
      return;
    }

    const bool tube_changed = decoded_parameters_.tubeIndex != applied_parameters_.tubeIndex;
    const bool reference_changed =
        decoded_parameters_.biasPercent != applied_parameters_.biasPercent ||
        decoded_parameters_.plateV != applied_parameters_.plateV ||
        decoded_parameters_.sourceZKOhm != applied_parameters_.sourceZKOhm ||
        decoded_parameters_.supplyKOhm != applied_parameters_.supplyKOhm;
    const bool reset_required = tube_changed;
    applied_parameters_ = decoded_parameters_;
    tube_index_ = applied_parameters_.tubeIndex;
    applyPath2Parameters(false);
    parameter_commit_pending_ = false;
    has_applied_parameters_ = true;
    if (reset_required) {
      resetModel();
    } else if (reference_changed) {
      FastChannel dc_fast{};
      SlowState dc_slow{};
      solveDc(dc_slow, dc_fast);
      schedulePlateReference(dc_fast.stage[1].plateVoltage, false);
    }
  }

  [[nodiscard]] std::uint32_t millisecondsToFrames(double milliseconds) const noexcept {
    const double exact = prepared_rate_ * milliseconds * 0.001;
    const std::uint32_t frames = static_cast<std::uint32_t>(std::ceil(exact));
    return frames == 0u ? 1u : frames;
  }

  [[nodiscard]] std::uint32_t feedbackTransitionFrames() const noexcept {
    const double exact = prepared_rate_ * kFeedbackTransitionMilliseconds * 0.001;
    const std::uint32_t frames = static_cast<std::uint32_t>(std::ceil(exact));
    return frames == 0u ? 1u : frames;
  }

  [[nodiscard]] std::uint32_t feedbackWarmupFrames() const noexcept {
    const double exact = prepared_rate_ * kFeedbackWarmupMilliseconds * 0.001;
    const std::uint32_t frames = static_cast<std::uint32_t>(std::ceil(exact));
    return frames == 0u ? 1u : frames;
  }

  // Clears the accumulated reduction. Reached from a committed safety-trim change or from a
  // commit that changes two or more values at once (a preset load); neither resetModel() nor
  // restoreRuntimeBaseline() may call it, because a model reset and a fault recovery are not
  // the user asking for the protection to be given up.
  void resetSafetyReduction() noexcept {
    safety_auto_gain_ = 1.0;
    safety_auto_target_ = 1.0;
    safety_auto_step_ = 0.0;
    safety_auto_remaining_ = 0u;
  }

  // Lowers the standing target to whatever would have brought this one sample back to full scale.
  // A sample at or below full scale needs nothing, and min() against the standing target is what
  // makes the law monotone - the reduction only ever deepens.
  void observeSafetyPeak(double sample) noexcept {
    const double magnitude = sample < 0.0 ? -sample : sample;
    if (magnitude > kSafetyPeakThreshold) {
      const double candidate = kSafetyPeakThreshold / magnitude;
      if (candidate < safety_auto_target_) {
        safety_auto_target_ = candidate;
      }
    }
  }

  // Observes one frame of the post-model wet chain and returns the reduction to apply to it.
  //
  // The measurement is open loop - it sees the chain before the reduction is applied - so
  // 1 / |sample| is exactly the gain that would have brought that sample to full scale, and no
  // result of the reduction re-enters the measurement. Only a comparison and a division run per
  // sample: no log, no pow, nothing the two engines could round apart. Both channels of the frame
  // are observed, left then right, before the ramp is re-armed at most once for the frame.
  [[nodiscard]] double advanceSafetyReduction(double left, double right) noexcept {
    if (!applied_parameters_.autoGainReduction) {
      // Frozen: nothing is observed, nothing is decided, and whatever reduction is already in
      // force stays in force, mid-ramp or not.
      return safety_auto_gain_;
    }
    const double standing_target = safety_auto_target_;
    observeSafetyPeak(left);
    observeSafetyPeak(right);
    if (safety_auto_target_ < standing_target) {
      // Re-armed only when the target actually drops. The step is divided once, here, and only
      // added from now on.
      safety_auto_remaining_ = safety_ramp_frames_;
      safety_auto_step_ =
          (safety_auto_target_ - safety_auto_gain_) / static_cast<double>(safety_auto_remaining_);
    }
    if (safety_auto_remaining_ != 0u) {
      safety_auto_gain_ += safety_auto_step_;
      --safety_auto_remaining_;
      if (safety_auto_remaining_ == 0u) {
        safety_auto_gain_ = safety_auto_target_;
      }
    }
    return safety_auto_gain_;
  }

  [[nodiscard]] double safetyReductionDb() const noexcept {
    return safety_auto_gain_ > 0.0 ? 20.0 * std::log10(safety_auto_gain_) : -1000.0;
  }

  void schedulePlateReference(double target, bool reset) noexcept {
    controls_.plateReferenceTarget = target;
    if (reset) {
      controls_.plateReference = target;
      controls_.plateReferenceStep = 0.0;
      controls_.plateReferenceRemaining = 0u;
      return;
    }
    controls_.plateReferenceRemaining = feedbackTransitionFrames();
    controls_.plateReferenceStep = (target - controls_.plateReference) /
                                   static_cast<double>(controls_.plateReferenceRemaining);
  }

  void applyPath2Parameters(bool reset_controls) noexcept {
    applyPowerParameters();
    const TubeParameters &tube = activeTube();
    cathode_resistance_ = kBaseCathodeResistance * tube.cathodeResistanceScale *
                          std::pow(2.0, -applied_parameters_.biasPercent / 50.0);
    plate_resistance_ = kBasePlateResistance * tube.plateResistanceScale;
    source_resistance_ = 1000.0 * applied_parameters_.sourceZKOhm;
    supply_resistance_ = 1000.0 * applied_parameters_.supplyKOhm;
    supply_capacitance_ = 22e-6 * 10000.0 / supply_resistance_;
    supply_voltage_ = applied_parameters_.plateV;
    updateFastControlTargets(reset_controls);
    applyFeedbackCalibration();
  }

  void updateFastControlTargets(bool reset_controls) noexcept {
    const double drive =
        applied_parameters_.inputReference * std::pow(10.0, applied_parameters_.driveDb / 20.0);
    const double output = std::pow(10.0, applied_parameters_.outputDb / 20.0);
    const double mix = applied_parameters_.mixPercent / 100.0;
    const double input_reference = applied_parameters_.inputReference;
    const double safety_user = std::pow(10.0, applied_parameters_.safetyTrimDb / 20.0);
    controls_.driveTarget = drive;
    controls_.outputTarget = output;
    controls_.mixTarget = mix;
    controls_.inputReferenceTarget = input_reference;
    controls_.safetyUserTarget = safety_user;
    if (reset_controls) {
      controls_.drive = drive;
      controls_.output = output;
      controls_.mix = mix;
      controls_.inputReference = input_reference;
      controls_.safetyUser = safety_user;
    }
  }

  // Power-branch circuit constants. Called from exactly one place - applyPath2Parameters, which
  // every commit path already goes through - so a commit pays for it once. It used to be invoked
  // directly beside that call on six paths, one of which runs from process(), which put two full
  // quiescent solves (some nine hundred valve-table evaluations) on the audio thread per commit
  // even when the branch was Line and none of the results were ever read.
  void applyPowerParameters() noexcept {
    if (applied_parameters_.outputStage == 2) {
      power_speaker_index_ = static_cast<std::size_t>(applied_parameters_.speakerLoad);
      const PhaseCSpeakerProfile &assumed = powerSpeakerProfile();
      static constexpr std::array<double, 3> primary_values = {2500.0, 3500.0, 5000.0};
      power_primary_ohm_ =
          primary_values[static_cast<std::size_t>(applied_parameters_.sePrimaryImpedance)];
      power_speaker_scale_ = applied_parameters_.actualLoadOhm / assumed.loadOhm;
      power_selected_turns_ratio_ = std::sqrt(power_primary_ohm_ / assumed.loadOhm);
      refreshSeOptCoefficients();
      solveSeQuiescent();
      return;
    }
    if (applied_parameters_.outputStage != 1) {
      return;
    }
    for (std::size_t index = 0u;
         index < effetune::dsp::tube_simulator_phase_c_generated::kPowerProfiles.size(); ++index) {
      const PhaseCPowerProfile &profile =
          effetune::dsp::tube_simulator_phase_c_generated::kPowerProfiles[index];
      if (profile.powerTube == static_cast<std::uint32_t>(applied_parameters_.powerTube) &&
          profile.screenTap == static_cast<std::uint32_t>(applied_parameters_.screenTap) &&
          profile.primary == static_cast<std::uint32_t>(applied_parameters_.primaryImpedance)) {
        power_profile_index_ = index;
        break;
      }
    }
    power_tube_tables_ = powerTubeTables(powerProfile().outputTubeLut);
    power_speaker_index_ = static_cast<std::size_t>(applied_parameters_.speakerLoad);
    const PhaseCSpeakerProfile &assumed = powerSpeakerProfile();
    static constexpr std::array<double, 3> primary_values = {6000.0, 6600.0, 8000.0};
    power_primary_ohm_ =
        primary_values[static_cast<std::size_t>(applied_parameters_.primaryImpedance)];
    power_speaker_scale_ = applied_parameters_.actualLoadOhm / assumed.loadOhm;
    // The turns ratio stays on the assumed load. A different speaker does not rewind the
    // transformer; it is exactly that mismatch that changes the impedance reflected to the valves.
    power_selected_turns_ratio_ = std::sqrt(power_primary_ohm_ / assumed.loadOhm);
    refreshPowerLtpCoefficients();
    refreshPowerOptCoefficients();
    solvePowerLtpQuiescent();
  }

  void refreshSeOptCoefficients() noexcept {
    constexpr double pi = 3.141592653589793238462643383279502884;
    const SeTubeModel &model = kSeTubeModels[static_cast<std::size_t>(applied_parameters_.seTube)];
    const PhaseCSpeakerProfile speaker = scaledSpeakerProfile();
    const double dt = rate_config_.fastDt;
    PowerOptCoefficients &opt = power_opt_coeff_;
    opt.distributedScreenTap = false;
    opt.screenTapTurnsRatio = 0.0;
    opt.centerToTapResistanceOhm = 0.0;
    opt.tapToPlateResistanceOhm = model.windingResistanceOhm;
    opt.screenSeriesResistanceOhm = 0.0;
    opt.leakageInductanceH = model.leakageInductanceH;
    opt.magnetizingInductanceH = model.magnetizingInductanceH;
    opt.coreLossResistanceOhm = model.coreLossResistanceOhm;
    const double reflected_load = effectivePrimaryImpedanceOhm(
        power_primary_ohm_, powerSpeakerProfile().loadOhm, applied_parameters_.actualLoadOhm);
    // The primary winding is in the tube's DC KVL. The transformer port contains the reflected
    // speaker/leakage series branch in parallel with magnetizing inductance and core loss; charging
    // winding DCR here as well would count the same copper loss twice.
    opt.effectiveResistanceOhm = reflected_load;
    opt.seriesCapacitanceF = 1.0 / (2.0 * pi * model.resonanceHz * 2.0 * pi * model.resonanceHz *
                                    model.leakageInductanceH);
    const double leakage_over_dt = model.leakageInductanceH / dt;
    const double capacitor_reactance = dt / (4.0 * opt.seriesCapacitanceF);
    const double series_coefficient =
        leakage_over_dt + opt.effectiveResistanceOhm * 0.5 + capacitor_reactance;
    opt.inverseSeriesCoefficient = 1.0 / series_coefficient;
    opt.seriesHistoryCoefficient =
        leakage_over_dt - opt.effectiveResistanceOhm * 0.5 - capacitor_reactance;
    opt.capacitorStep = dt / (2.0 * opt.seriesCapacitanceF);
    const double magnetizing_over_dt = model.magnetizingInductanceH / dt;
    const double magnetizing_coefficient = magnetizing_over_dt + model.coreLossResistanceOhm * 0.5;
    opt.inverseMagnetizingCoefficient = 1.0 / magnetizing_coefficient;
    opt.magnetizingHistoryCoefficient = magnetizing_over_dt - model.coreLossResistanceOhm * 0.5;
    opt.magnetizingStep = dt / (2.0 * model.magnetizingInductanceH);
    opt.inverseCoreLossResistanceOhm = 1.0 / model.coreLossResistanceOhm;
    opt.inverseFastDt = 1.0 / dt;
    opt.turnsRatio = power_selected_turns_ratio_;
    opt.halfPrimaryTurnsRatio = power_selected_turns_ratio_;
    opt.windingResistanceOhm = model.windingResistanceOhm;
    opt.inverseWindingResistanceOhm = 1.0 / model.windingResistanceOhm;
    opt.centerToTapResistanceShare = 0.0;
    opt.primaryDriveOhm = power_primary_ohm_;
    opt.halfPrimaryReflectedOhm = reflected_load;
    opt.plateLoadFactor = 1.0;
    opt.speakerLoadOhm = speaker.loadOhm;
    const double voice_step_raw = dt / speaker.voiceInductanceH;
    opt.voiceStepLimited = voice_step_raw > 0.25;
    opt.voiceStep = opt.voiceStepLimited ? 0.25 : voice_step_raw;
    opt.voiceResistanceOhm = speaker.voiceResistanceOhm;
    const double resonance_step_raw = dt / speaker.resonanceInductanceH;
    opt.resonanceStepLimited = resonance_step_raw > 0.25;
    opt.resonanceStep = opt.resonanceStepLimited ? 0.25 : resonance_step_raw;
    opt.resonanceResistanceOhm = speaker.resonanceResistanceOhm;
    opt.speakerCapacitorStep = dt / speaker.resonanceCapacitanceF;
    opt.nfbTapGain = model.nfbTapTurnsRatio;
  }

  void solveSeQuiescent() noexcept {
    const SeTubeModel &model = kSeTubeModels[static_cast<std::size_t>(applied_parameters_.seTube)];
    double current = model.standingCurrentA;
    PlateEvaluation evaluation{};
    double residual = 0.0;
    for (int iteration = 0; iteration < 16; ++iteration) {
      const double cathode = current * applied_parameters_.seCathodeResistor;
      const double b_plus =
          applied_parameters_.seBPlus - current * model.powerTheveninResistanceOhm;
      const double plate = b_plus - current * model.windingResistanceOhm;
      evaluation = evaluateSeTriode(model, -cathode, plate - cathode);
      residual = current - evaluation.current;
      const double current_derivative =
          -evaluation.gridDerivative * applied_parameters_.seCathodeResistor -
          evaluation.plateDerivative *
              (model.powerTheveninResistanceOhm + model.windingResistanceOhm +
               applied_parameters_.seCathodeResistor);
      const double derivative = 1.0 - current_derivative;
      if (!std::isfinite(derivative) || absolute(derivative) < 1e-12) {
        break;
      }
      current -= residual / derivative;
      current = current < 0.0 ? 0.0 : (current > 0.25 ? 0.25 : current);
    }
    const double cathode = current * applied_parameters_.seCathodeResistor;
    const double b_plus = applied_parameters_.seBPlus - current * model.powerTheveninResistanceOhm;
    const double plate = b_plus - current * model.windingResistanceOhm;
    evaluation = evaluateSeTriode(model, -cathode, plate - cathode);
    residual = current - evaluation.current;
    se_quiescent_ = {current, cathode, b_plus, plate, residual};
  }

  // The measured profile of the assumed speaker, scaled to the load actually connected by
  // k = actual / assumed: resistances and inductances up, capacitance down. That is ordinary
  // impedance scaling - it moves the impedance level while leaving the resonance frequency and Q
  // where they were measured - so at k == 1 it reproduces the measured profile exactly and every
  // A0 record stays valid at its design point.
  [[nodiscard]] PhaseCSpeakerProfile scaledSpeakerProfile() const noexcept {
    PhaseCSpeakerProfile speaker = powerSpeakerProfile();
    const double scale = power_speaker_scale_;
    speaker.loadOhm *= scale;
    speaker.voiceResistanceOhm *= scale;
    speaker.voiceInductanceH *= scale;
    speaker.resonanceResistanceOhm *= scale;
    speaker.resonanceInductanceH *= scale;
    speaker.resonanceCapacitanceF /= scale;
    return speaker;
  }

  void refreshPowerOptCoefficients() noexcept {
    constexpr double pi = 3.141592653589793238462643383279502884;
    const PhaseCPowerProfile &profile = powerProfile();
    const PhaseCSpeakerProfile speaker = scaledSpeakerProfile();
    const double dt = rate_config_.fastDt;
    PowerOptCoefficients &opt = power_opt_coeff_;
    opt.distributedScreenTap = profile.screenTapTurnsRatio > 0.0;
    opt.screenTapTurnsRatio = profile.screenTapTurnsRatio;
    opt.centerToTapResistanceOhm = profile.primaryCenterToTapResistanceOhm;
    opt.tapToPlateResistanceOhm = profile.primaryTapToPlateResistanceOhm;
    opt.screenSeriesResistanceOhm = profile.screenResistanceOhm;

    opt.leakageInductanceH = profile.leakageInductanceH;
    opt.magnetizingInductanceH = profile.magnetizingInductanceH;
    opt.coreLossResistanceOhm = profile.coreLossResistanceOhm;
    const double reflected_load =
        speaker.loadOhm * power_selected_turns_ratio_ * power_selected_turns_ratio_;
    const double winding =
        profile.primaryCenterToTapResistanceOhm + profile.primaryTapToPlateResistanceOhm;
    // The output impedance is the winding resistance plus the reflected load. Damping comes from
    // the negative feedback loop that is already closed through the secondary tap; it must not be
    // injected a second time by dividing the reflected load by a feedback-derived loop gain.
    opt.effectiveResistanceOhm = winding + reflected_load;
    opt.seriesCapacitanceF = 1.0 / (2.0 * pi * profile.resonanceHz * 2.0 * pi *
                                    profile.resonanceHz * profile.leakageInductanceH);
    const double leakage_over_dt = dt > 0.0 ? profile.leakageInductanceH / dt : 0.0;
    const double capacitor_reactance =
        opt.seriesCapacitanceF > 0.0 ? dt / (4.0 * opt.seriesCapacitanceF) : 0.0;
    const double series_coefficient =
        leakage_over_dt + opt.effectiveResistanceOhm * 0.5 + capacitor_reactance;
    opt.inverseSeriesCoefficient = series_coefficient != 0.0 ? 1.0 / series_coefficient : 0.0;
    opt.seriesHistoryCoefficient =
        leakage_over_dt - opt.effectiveResistanceOhm * 0.5 - capacitor_reactance;
    opt.capacitorStep = opt.seriesCapacitanceF > 0.0 ? dt / (2.0 * opt.seriesCapacitanceF) : 0.0;
    const double magnetizing_over_dt = dt > 0.0 ? profile.magnetizingInductanceH / dt : 0.0;
    const double magnetizing_coefficient =
        magnetizing_over_dt + profile.coreLossResistanceOhm * 0.5;
    opt.inverseMagnetizingCoefficient =
        magnetizing_coefficient != 0.0 ? 1.0 / magnetizing_coefficient : 0.0;
    opt.magnetizingHistoryCoefficient = magnetizing_over_dt - profile.coreLossResistanceOhm * 0.5;
    opt.inverseFastDt = dt > 0.0 ? 1.0 / dt : 0.0;

    opt.turnsRatio = power_selected_turns_ratio_;
    opt.halfPrimaryTurnsRatio = 0.5 * power_selected_turns_ratio_;
    opt.windingResistanceOhm = winding;
    opt.inverseWindingResistanceOhm = winding != 0.0 ? 1.0 / winding : 0.0;
    // The screen taps off part-way along the half primary, so only the centre-to-tap section
    // carries the screen current. Expressed as a share of the whole half-primary resistance this
    // is the weight the screen current enters the plate residual with once that residual is
    // written as a current through the whole winding.
    opt.centerToTapResistanceShare =
        winding != 0.0 ? profile.primaryCenterToTapResistanceOhm / winding : 0.0;
    opt.primaryDriveOhm = power_primary_ohm_ * 0.5;
    opt.halfPrimaryReflectedOhm =
        opt.halfPrimaryTurnsRatio * power_selected_turns_ratio_ * speaker.loadOhm;
    // Jacobian weight of the plate node once the half-primary emf is part of its KVL. A change of
    // the plate current moves the transformer branch current by primaryDriveOhm/seriesCoefficient,
    // which moves the emf by that times halfPrimaryReflectedOhm, so the plate residual sees the
    // tube conductance through this factor instead of once. The branch current itself is not a
    // second current through the winding resistance - it is the load component of the very plate
    // current already on the left-hand side - so it contributes only through the emf.
    opt.plateLoadFactor = 1.0 + opt.inverseSeriesCoefficient * opt.primaryDriveOhm *
                                    opt.halfPrimaryReflectedOhm * opt.inverseWindingResistanceOhm;
    opt.speakerLoadOhm = speaker.loadOhm;
    const double voice_step_raw = dt / speaker.voiceInductanceH;
    opt.voiceStepLimited = voice_step_raw > 0.25;
    opt.voiceStep = opt.voiceStepLimited ? 0.25 : voice_step_raw;
    opt.voiceResistanceOhm = speaker.voiceResistanceOhm;
    const double resonance_step_raw = dt / speaker.resonanceInductanceH;
    opt.resonanceStepLimited = resonance_step_raw > 0.25;
    opt.resonanceStep = opt.resonanceStepLimited ? 0.25 : resonance_step_raw;
    opt.resonanceResistanceOhm = speaker.resonanceResistanceOhm;
    opt.speakerCapacitorStep = dt / speaker.resonanceCapacitanceF;
    opt.nfbTapGain = profile.nfbTapTurnsRatio * profile.nfbPolarity;
  }

  void refreshPowerLtpCoefficients() noexcept {
    const PhaseCPowerProfile &profile = powerProfile();
    power_ltp_.dtOverInputCapacitance = rate_config_.fastDt / profile.ltpInputCapacitanceF;
    power_ltp_.dtOverGridCapacitance = rate_config_.fastDt / profile.gridCouplingCapacitanceF;
    power_ltp_.inverseLtpGridLeak = 1.0 / profile.ltpGridLeakResistanceOhm;
    power_ltp_.inverseGridLeak = 1.0 / profile.gridLeakResistanceOhm;
    power_ltp_.inverseGridStopper = 1.0 / profile.gridStopperResistanceOhm;
    power_ltp_.inverseTailResistance = 1.0 / profile.ltpTailResistanceOhm;
    power_ltp_.tailSupplyOverTailResistance = profile.ltpTailSupplyV / profile.ltpTailResistanceOhm;
    power_ltp_.inversePlateResistance = 1.0 / profile.ltpPlateResistanceOhm;
    // Pre-power volume. The wiper splits the track into R_upper towards the driver output node and
    // R_lower towards ground; the source impedance the phase-inverter grid network sees is their
    // parallel combination, which is why the divider is kept as two resistors instead of a scalar
    // gain. The generator rejects wiper positions outside the open interval, so both sections are
    // strictly positive here.
    const double pre_volume_upper =
        profile.ltpPreVolumeResistanceOhm * (1.0 - profile.ltpPreVolumeWiperPosition);
    const double pre_volume_lower =
        profile.ltpPreVolumeResistanceOhm * profile.ltpPreVolumeWiperPosition;
    power_ltp_.preVolumeSourceConductance = 1.0 / pre_volume_upper;
    const double wiper_conductance = power_ltp_.preVolumeSourceConductance +
                                     1.0 / pre_volume_lower + power_ltp_.inverseLtpGridLeak;
    power_ltp_.inverseWiperConductanceOpen = 1.0 / wiper_conductance;
    power_ltp_.inverseWiperConductanceConducting =
        1.0 / (wiper_conductance + power_ltp_.inverseGridStopper);
  }

  // Zero-signal anode and screen current of one output valve, the published row the reset seed and
  // the reservoir sag are both built from. One definition so the two can never disagree.
  struct PowerStandingCurrent {
    double ia;
    double ig2;
  };

  [[nodiscard]] PowerStandingCurrent powerStandingCurrent() const noexcept {
    const auto index = static_cast<std::size_t>(applied_parameters_.powerTube);
    const auto &model = effetune::dsp::tube_simulator_phase_c_generated::kOutputTubeModels[index];
    return PowerStandingCurrent{model.standingPlateCurrentA, model.standingScreenCurrentA};
  }

  // Reservoir voltage the running branch actually presents to the valves. The supply parameter is
  // the unloaded rail; both output valves' cathode current crosses the reservoir Thevenin
  // resistance before anything downstream sees it, so the centre tap rests one such drop below.
  // Solving the phase inverter - and seeding the reservoir node - at the unloaded rail instead put
  // the output-tube coupling capacitors a full drop (9-11 V) above their equilibrium and drove both
  // output valves into cut-off for the ~100 ms the 22 ms grid network needs to relax, every time a
  // reset-class change, an explicit reset or a finite-fault recovery re-seeded the state.
  [[nodiscard]] double powerSaggedBPlus() const noexcept {
    const PowerStandingCurrent standing = powerStandingCurrent();
    return applied_parameters_.powerBPlus -
           2.0 * (standing.ia + standing.ig2) * powerProfile().powerTheveninResistanceOhm;
  }

  // Quiescent point of the 12AX7 long-tailed pair with both grids at their DC return (0 V).
  // Solved once per parameter commit, never on the audio thread.
  void solvePowerLtpQuiescent() noexcept {
    const PhaseCPowerProfile &profile = powerProfile();
    const TubeTables &tube = tubeTables()[0];
    const double b_plus = powerSaggedBPlus();
    const double inverse_plate_resistance = 1.0 / profile.ltpPlateResistanceOhm;
    const double inverse_tail_resistance = 1.0 / profile.ltpTailResistanceOhm;
    const double tail_supply = profile.ltpTailSupplyV;
    const auto plate_voltage = [&](double cathode) noexcept {
      double plate = b_plus * 0.7;
      for (int iteration = 0; iteration < 32; ++iteration) {
        const PlateEvaluation evaluation = tube.evaluatePlate(-cathode, plate - cathode);
        const double residual = (b_plus - plate) * inverse_plate_resistance - evaluation.current;
        const double derivative = -inverse_plate_resistance - evaluation.plateDerivative;
        if (!std::isfinite(derivative) || absolute(derivative) < 1e-15) {
          break;
        }
        const double step = residual / derivative;
        plate -= step;
        plate = plate < 0.0 ? 0.0 : (plate > b_plus ? b_plus : plate);
        if (absolute(step) < 1e-12) {
          break;
        }
      }
      return plate;
    };
    // (Vk - V_tail)/R_tail - 2*Ia(Vk) is strictly increasing in Vk, so a bisection is exact and
    // cannot stall the way a secant can when one triode is cut off.
    double lower = tail_supply;
    double upper = 40.0;
    for (int iteration = 0; iteration < 80; ++iteration) {
      const double cathode = 0.5 * (lower + upper);
      const double plate = plate_voltage(cathode);
      const PlateEvaluation evaluation = tube.evaluatePlate(-cathode, plate - cathode);
      const double residual =
          (cathode - tail_supply) * inverse_tail_resistance - 2.0 * evaluation.current;
      if (residual > 0.0) {
        upper = cathode;
      } else {
        lower = cathode;
      }
    }
    const double cathode = 0.5 * (lower + upper);
    const double plate = plate_voltage(cathode);
    power_ltp_quiescent_.cathodeV = cathode;
    power_ltp_quiescent_.plateV = plate;
    // The driver signal reaching the phase inverter is taken after the driver output coupling
    // capacitor, whose charge solveDc pre-sets to the stage-two plate voltage, so its DC value is
    // zero. Both coupling capacitors therefore rest at (source DC - grid DC).
    power_ltp_quiescent_.inputCapacitorV = 0.0;
    power_ltp_quiescent_.gridCouplingV = plate;
  }

  [[nodiscard]] const PhaseCPowerProfile &powerProfile() const noexcept {
    return effetune::dsp::tube_simulator_phase_c_generated::kPowerProfiles[power_profile_index_];
  }

  [[nodiscard]] const PhaseCSpeakerProfile &powerSpeakerProfile() const noexcept {
    return effetune::dsp::tube_simulator_phase_c_generated::kSpeakerProfiles[power_speaker_index_];
  }

  // The bracket the previous evaluation landed in is the starting point of the search. An audio
  // signal moves the operating point by far less than one knot between the eight evaluations of a
  // sample, so the walk almost always stops immediately, while a search that restarts at the
  // bottom of the axis pays one comparison per knot below the operating point. The answer is the
  // unique interval with axis[upper - 1] < value <= axis[upper] either way, so the result does not
  // depend on the starting point and stays bit-identical to a full scan.
  template <std::size_t Size>
  static void bracketPowerLutAxis(const std::array<double, Size> &axis, double value,
                                  PowerLutBracket &bracket) noexcept {
    if (value <= axis[0]) {
      bracket = {0u, 0u, 0.0};
      return;
    }
    constexpr std::size_t last = Size - 1u;
    if (value >= axis[last]) {
      bracket = {last, last, 0.0};
      return;
    }
    std::size_t upper = bracket.upper < 1u ? 1u : (bracket.upper > last ? last : bracket.upper);
    while (value > axis[upper]) {
      ++upper;
    }
    while (value <= axis[upper - 1u]) {
      --upper;
    }
    bracket.lower = upper - 1u;
    bracket.upper = upper;
    bracket.fraction = (value - axis[upper - 1u]) / (axis[upper] - axis[upper - 1u]);
  }

  [[nodiscard]] static double powerLutValue(std::uint32_t lut, std::size_t control,
                                            std::size_t plate, std::size_t screen,
                                            std::size_t field) noexcept {
    constexpr std::size_t plate_count =
        effetune::dsp::tube_simulator_phase_c_generated::kPlateCathodeAxes[0].size();
    constexpr std::size_t screen_count =
        effetune::dsp::tube_simulator_phase_c_generated::kScreenCathodeAxes[0].size();
    const std::size_t index =
        ((control * plate_count + plate) * screen_count + screen) * 2u + field;
    const std::uint64_t bits =
        effetune::dsp::tube_simulator_phase_c_generated::kOutputTubeLutBits[lut][index];
    return std::bit_cast<double>(bits);
  }

  // The screen shields the cathode from the anode, so the cathode current of a pentode follows a
  // single composite control voltage Vc = Vgk + Vg2k/mu(g1-g2) + Vak/mu(g1-a) and cuts off exactly
  // at Vc = 0. Carrying Vc as the first table axis puts a knot on that cut-off plane. Bracketing
  // the grid voltage instead would leave the plane running diagonally through the cells, and the
  // interpolated table would still pass tens of milliamps where the valve is already cut off.
  void interpolatePowerTube(double vgk, double vak, double vg2k, PowerLutScratch &scratch,
                            double &ia, double &ig2) const noexcept {
    const PowerTubeTables &tube = power_tube_tables_;
    const double vc = vgk + vg2k * tube.inverseScreenAmplificationFactor +
                      vak * tube.inversePlateAmplificationFactor;
    bracketPowerLutAxis(tube.controlVoltageAxis, vc, scratch.control);
    bracketPowerLutAxis(tube.plateCathodeAxis, vak, scratch.plate);
    bracketPowerLutAxis(tube.screenCathodeAxis, vg2k, scratch.screen);
    ia = 0.0;
    ig2 = 0.0;
    // Exact plate and screen partial derivatives of the bounded trilinear model come from the same
    // eight taps. Each terminal reaches the model through its own axis and its share of the
    // composite control voltage, so both paths are accumulated.
    double ia_plate_derivative = 0.0;
    double ia_screen_derivative = 0.0;
    double ia_control_derivative = 0.0;
    double ig2_plate_derivative = 0.0;
    double ig2_screen_derivative = 0.0;
    double ig2_control_derivative = 0.0;
    const double plate_inverse_step = scratch.plate.upper == scratch.plate.lower
                                          ? 0.0
                                          : tube.plateCathodeInverseStep[scratch.plate.upper];
    const double screen_inverse_step = scratch.screen.upper == scratch.screen.lower
                                           ? 0.0
                                           : tube.screenCathodeInverseStep[scratch.screen.upper];
    const double control_inverse_step = scratch.control.upper == scratch.control.lower
                                            ? 0.0
                                            : tube.controlVoltageInverseStep[scratch.control.upper];
    const std::uint32_t lut = tube.lut;
    for (std::size_t cx = 0u; cx < 2u; ++cx) {
      const std::size_t ci = cx == 0u ? scratch.control.lower : scratch.control.upper;
      const double cw = cx == 0u ? 1.0 - scratch.control.fraction : scratch.control.fraction;
      const double control_slope = cx == 0u ? -control_inverse_step : control_inverse_step;
      for (std::size_t px = 0u; px < 2u; ++px) {
        const std::size_t pi = px == 0u ? scratch.plate.lower : scratch.plate.upper;
        const double pw = px == 0u ? 1.0 - scratch.plate.fraction : scratch.plate.fraction;
        const double plate_slope = px == 0u ? -plate_inverse_step : plate_inverse_step;
        const double control_plate_weight = cw * pw;
        const double plate_slope_weight = cw * plate_slope;
        const double control_slope_weight = pw * control_slope;
        for (std::size_t sx = 0u; sx < 2u; ++sx) {
          const std::size_t si = sx == 0u ? scratch.screen.lower : scratch.screen.upper;
          const double sw = sx == 0u ? 1.0 - scratch.screen.fraction : scratch.screen.fraction;
          const double screen_slope = sx == 0u ? -screen_inverse_step : screen_inverse_step;
          const double ia_value = powerLutValue(lut, ci, pi, si, 0u);
          const double ig2_value = powerLutValue(lut, ci, pi, si, 1u);
          const double screen_scaled = ia_value * sw;
          ia += screen_scaled * control_plate_weight;
          ig2 += ig2_value * control_plate_weight * sw;
          ia_plate_derivative += screen_scaled * plate_slope_weight;
          ia_control_derivative += screen_scaled * control_slope_weight;
          ia_screen_derivative += ia_value * control_plate_weight * screen_slope;
          ig2_plate_derivative += ig2_value * plate_slope_weight * sw;
          ig2_control_derivative += ig2_value * control_slope_weight * sw;
          ig2_screen_derivative += ig2_value * control_plate_weight * screen_slope;
        }
      }
    }
    scratch.ia = ia;
    scratch.ig2 = ig2;
    scratch.iaPlateDerivative =
        ia_plate_derivative + ia_control_derivative * tube.inversePlateAmplificationFactor;
    scratch.iaScreenDerivative =
        ia_screen_derivative + ia_control_derivative * tube.inverseScreenAmplificationFactor;
    scratch.ig2PlateDerivative =
        ig2_plate_derivative + ig2_control_derivative * tube.inversePlateAmplificationFactor;
    scratch.ig2ScreenDerivative =
        ig2_screen_derivative + ig2_control_derivative * tube.inverseScreenAmplificationFactor;
  }

  [[nodiscard]] FixedScreenLutWeights
  fixedScreenLutWeights(double vg2k, PowerLutScratch &scratch) const noexcept {
    bracketPowerLutAxis(power_tube_tables_.screenCathodeAxis, vg2k, scratch.screen);
    return {vg2k,
            {scratch.screen.lower, scratch.screen.upper},
            {1.0 - scratch.screen.fraction, scratch.screen.fraction}};
  }

  void interpolatePowerTubeFixedScreen(double vgk, double vak, const FixedScreenLutWeights &screen,
                                       PowerLutScratch &scratch, double &ia,
                                       double &ig2) const noexcept {
    const PowerTubeTables &tube = power_tube_tables_;
    const double vc = vgk + screen.voltage * tube.inverseScreenAmplificationFactor +
                      vak * tube.inversePlateAmplificationFactor;
    bracketPowerLutAxis(tube.controlVoltageAxis, vc, scratch.control);
    bracketPowerLutAxis(tube.plateCathodeAxis, vak, scratch.plate);
    ia = 0.0;
    ig2 = 0.0;
    double ia_plate_derivative = 0.0;
    double ia_control_derivative = 0.0;
    const double plate_inverse_step = scratch.plate.upper == scratch.plate.lower
                                          ? 0.0
                                          : tube.plateCathodeInverseStep[scratch.plate.upper];
    const double control_inverse_step = scratch.control.upper == scratch.control.lower
                                            ? 0.0
                                            : tube.controlVoltageInverseStep[scratch.control.upper];
    const std::uint32_t lut = tube.lut;
    for (std::size_t cx = 0u; cx < 2u; ++cx) {
      const std::size_t ci = cx == 0u ? scratch.control.lower : scratch.control.upper;
      const double cw = cx == 0u ? 1.0 - scratch.control.fraction : scratch.control.fraction;
      const double control_slope = cx == 0u ? -control_inverse_step : control_inverse_step;
      for (std::size_t px = 0u; px < 2u; ++px) {
        const std::size_t pi = px == 0u ? scratch.plate.lower : scratch.plate.upper;
        const double pw = px == 0u ? 1.0 - scratch.plate.fraction : scratch.plate.fraction;
        const double plate_slope = px == 0u ? -plate_inverse_step : plate_inverse_step;
        const double control_plate_weight = cw * pw;
        const double plate_slope_weight = cw * plate_slope;
        const double control_slope_weight = pw * control_slope;
        for (std::size_t sx = 0u; sx < 2u; ++sx) {
          const std::size_t si = screen.indices[sx];
          const double sw = screen.weights[sx];
          const double ia_value = powerLutValue(lut, ci, pi, si, 0u);
          const double ig2_value = powerLutValue(lut, ci, pi, si, 1u);
          const double screen_scaled = ia_value * sw;
          ia += screen_scaled * control_plate_weight;
          ig2 += ig2_value * control_plate_weight * sw;
          ia_plate_derivative += screen_scaled * plate_slope_weight;
          ia_control_derivative += screen_scaled * control_slope_weight;
        }
      }
    }
    scratch.ia = ia;
    scratch.ig2 = ig2;
    scratch.iaPlateDerivative =
        ia_plate_derivative + ia_control_derivative * tube.inversePlateAmplificationFactor;
  }

  void resetPowerState(PowerState &state) noexcept {
    if (applied_parameters_.outputStage == 2) {
      const double ia = se_quiescent_.currentA;
      state = PowerState{};
      state.cathodePushV = se_quiescent_.cathodeV;
      state.cathodePullV = state.cathodePushV;
      state.bPlusV = se_quiescent_.bPlusV;
      state.platePushV = se_quiescent_.plateV;
      state.platePullV = state.platePushV;
      state.iaPushA = ia;
      state.iaPullA = ia;
      state.magnetizingCurrentA = ia;
      state.primaryVoltageV = 0.0;
      const double dc_residual = absolute(se_quiescent_.residualA);
      maximum_dc_residual_ =
          dc_residual > maximum_dc_residual_ ? dc_residual : maximum_dc_residual_;
      seedRamp(state.cathodePushRamp, state.cathodePushV);
      seedRamp(state.cathodePullRamp, state.cathodePullV);
      seedRamp(state.bPlusRamp, state.bPlusV);
      seedRamp(state.screenRamp, 0.0);
      return;
    }
    const PhaseCPowerProfile &profile = powerProfile();
    const PowerStandingCurrent standing = powerStandingCurrent();
    const double ia = standing.ia;
    const double ig2 = standing.ig2;
    state = PowerState{};
    state.ltpInputCapV = power_ltp_quiescent_.inputCapacitorV;
    state.ltpCathodeV = power_ltp_quiescent_.cathodeV;
    state.ltpPlateAV = power_ltp_quiescent_.plateV;
    state.ltpPlateBV = power_ltp_quiescent_.plateV;
    state.gridCouplingPushV = power_ltp_quiescent_.gridCouplingV;
    state.gridCouplingPullV = power_ltp_quiescent_.gridCouplingV;
    state.cathodePushV = (ia + ig2) * applied_parameters_.cathodeResistor;
    state.cathodePullV = state.cathodePushV;
    state.bPlusV = powerSaggedBPlus();
    state.screenTapV = state.bPlusV - (ia + ig2) * profile.primaryCenterToTapResistanceOhm;
    state.platePushV = state.screenTapV - ia * profile.primaryTapToPlateResistanceOhm;
    state.platePullV = state.platePushV;
    const auto tube_index = static_cast<std::size_t>(applied_parameters_.powerTube);
    const auto &tube_model =
        effetune::dsp::tube_simulator_phase_c_generated::kOutputTubeModels[tube_index];
    state.screenV = profile.screenTapTurnsRatio > 0.0
                        ? state.screenTapV - ig2 * profile.screenResistanceOhm
                        : tube_model.fixedScreenGroundV;
    state.screenPushV = state.screenV;
    state.screenPullV = state.screenV;
    state.iaPushA = ia;
    state.iaPullA = ia;
    state.ig2PushA = ig2;
    state.ig2PullA = ig2;
    seedRamp(state.cathodePushRamp, state.cathodePushV);
    seedRamp(state.cathodePullRamp, state.cathodePullV);
    seedRamp(state.bPlusRamp, state.bPlusV);
    seedRamp(state.screenRamp, state.screenV);
  }

  // Screen terminal voltage of a distributed (ultra-linear) tap. The turns ratio alpha divides the
  // induced emf of the half primary; the terminal voltage then follows from KVL with the IR drop of
  // the centre-to-tap winding section. At DC the induced emf is zero and the expression collapses
  // to the pure IR drop, which is what the frozen EL34 DC oracle assumes.
  [[nodiscard]] double screenTapVoltage(double induced, double ia, double ig2,
                                        double b_plus) const noexcept {
    const PowerOptCoefficients &opt = power_opt_coeff_;
    return b_plus - opt.screenTapTurnsRatio * induced - (ia + ig2) * opt.centerToTapResistanceOhm;
  }

  // Plate node of one output tube. The plate sits at the far end of the whole half primary, so its
  // KVL carries the full induced emf of that winding section, exactly as the screen tap carries the
  // alpha-weighted share of the same emf. Without it the plate could only move by the winding IR
  // drop and the load line stood almost vertical.
  //
  // The resistive part of that KVL is resolved per winding section, the same way the screen tap and
  // the reset seed resolve it: the centre-to-tap section carries the anode and the screen current,
  // the tap-to-plate section carries the anode current alone. Writing the residual as a current
  // through the whole half primary makes the screen term enter with the centre-to-tap share of the
  // winding. The transformer branch current is the load component of that same anode current, not a
  // second current through the winding, so it appears only through the emf; charging it a second IR
  // drop of its own left the plate KVL disagreeing with the screen-tap KVL - and with the reset
  // seed - by (i_series*Rw - ig2*Rct), some 4.7 V near full output on an EL84 6.6k/8 ohm pair.
  //
  // The emf is taken in the same sample. A distributed screen depends on that emf and on both valve
  // currents, so its terminal voltage and the plate voltage are solved together. Keeping those two
  // KVL equations in one Newton step avoids a high-transconductance screen fixed point outside the
  // Jacobian. A fixed screen remains the original scalar plate solve.
  [[nodiscard]] PowerPlateResult solvePowerPlate(bool push, PowerState &state,
                                                 double opposite_drive,
                                                 PowerLutScratch &scratch) noexcept {
    const PowerOptCoefficients &opt = power_opt_coeff_;
    const double direction = push ? 1.0 : -1.0;
    const double cathode = push ? state.cathodePushRamp.applied : state.cathodePullRamp.applied;
    const double grid = push ? state.gridPushV : state.gridPullV;
    const double inverse_resistance = opt.inverseWindingResistanceOhm;
    double plate = push ? state.platePushV : state.platePullV;
    double ia = push ? state.iaPushA : state.iaPullA;
    double ig2 = push ? state.ig2PushA : state.ig2PullA;
    double residual = 0.0;
    const double signed_drive_ohm = direction * opt.primaryDriveOhm;
    const double signed_reflected_ohm = direction * opt.halfPrimaryReflectedOhm;
    const double history = state.optCapacitorV - opt.seriesHistoryCoefficient * state.optCurrentA;
    double drive = ia + opt.screenTapTurnsRatio * ig2;
    double series_current = 0.0;
    double induced = 0.0;
    double screen = state.screenRamp.applied;
    if (!opt.distributedScreenTap) {
      const FixedScreenLutWeights screen_weights = fixedScreenLutWeights(screen - cathode, scratch);
      for (int iteration = 0; iteration < 3; ++iteration) {
        series_current =
            (signed_drive_ohm * (drive - opposite_drive) - history) * opt.inverseSeriesCoefficient;
        induced = signed_reflected_ohm * series_current;
        interpolatePowerTubeFixedScreen(grid - cathode, plate - cathode, screen_weights, scratch,
                                        ia, ig2);
        residual = (state.bPlusRamp.applied - induced - plate) * inverse_resistance - ia -
                   ig2 * opt.centerToTapResistanceShare;
        const double derivative =
            -inverse_resistance - opt.plateLoadFactor * scratch.iaPlateDerivative;
        if (!std::isfinite(derivative) || absolute(derivative) < 1e-12) {
          ++safety_limits_;
          step_safety_hit_ = true;
          break;
        }
        plate -= residual / derivative;
        drive = ia + opt.screenTapTurnsRatio * ig2;
      }
      series_current =
          (signed_drive_ohm * (drive - opposite_drive) - history) * opt.inverseSeriesCoefficient;
      induced = signed_reflected_ohm * series_current;
      interpolatePowerTubeFixedScreen(grid - cathode, plate - cathode, screen_weights, scratch, ia,
                                      ig2);
      drive = ia + opt.screenTapTurnsRatio * ig2;
      const double screen_tap = screenTapVoltage(induced, ia, ig2, state.bPlusRamp.applied);
      residual = (state.bPlusRamp.applied - induced - plate) * inverse_resistance - ia -
                 ig2 * opt.centerToTapResistanceShare;
      return {plate, screen, screen_tap, ia, ig2, drive, residual};
    }
    screen = push ? state.screenPushV : state.screenPullV;
    const double emf_drive_gain =
        opt.primaryDriveOhm * opt.halfPrimaryReflectedOhm * opt.inverseSeriesCoefficient;
    for (int iteration = 0; iteration < 3; ++iteration) {
      interpolatePowerTube(grid - cathode, plate - cathode, screen - cathode, scratch, ia, ig2);
      drive = ia + opt.screenTapTurnsRatio * ig2;
      series_current =
          (signed_drive_ohm * (drive - opposite_drive) - history) * opt.inverseSeriesCoefficient;
      induced = signed_reflected_ohm * series_current;
      residual = (state.bPlusRamp.applied - induced - plate) * inverse_resistance - ia -
                 ig2 * opt.centerToTapResistanceShare;
      const double screen_residual =
          screen - state.bPlusRamp.applied + opt.screenTapTurnsRatio * induced +
          opt.centerToTapResistanceOhm * ia +
          (opt.centerToTapResistanceOhm + opt.screenSeriesResistanceOhm) * ig2;
      const double induced_plate_derivative =
          emf_drive_gain *
          (scratch.iaPlateDerivative + opt.screenTapTurnsRatio * scratch.ig2PlateDerivative);
      const double induced_screen_derivative =
          emf_drive_gain *
          (scratch.iaScreenDerivative + opt.screenTapTurnsRatio * scratch.ig2ScreenDerivative);
      const double j11 = (-1.0 - induced_plate_derivative) * inverse_resistance -
                         scratch.iaPlateDerivative -
                         opt.centerToTapResistanceShare * scratch.ig2PlateDerivative;
      const double j12 = -induced_screen_derivative * inverse_resistance -
                         scratch.iaScreenDerivative -
                         opt.centerToTapResistanceShare * scratch.ig2ScreenDerivative;
      const double j21 = opt.screenTapTurnsRatio * induced_plate_derivative +
                         opt.centerToTapResistanceOhm * scratch.iaPlateDerivative +
                         (opt.centerToTapResistanceOhm + opt.screenSeriesResistanceOhm) *
                             scratch.ig2PlateDerivative;
      const double j22 = 1.0 + opt.screenTapTurnsRatio * induced_screen_derivative +
                         opt.centerToTapResistanceOhm * scratch.iaScreenDerivative +
                         (opt.centerToTapResistanceOhm + opt.screenSeriesResistanceOhm) *
                             scratch.ig2ScreenDerivative;
      const double determinant = j11 * j22 - j12 * j21;
      if (!std::isfinite(determinant) || absolute(determinant) < 1e-12) {
        ++safety_limits_;
        step_safety_hit_ = true;
        break;
      }
      plate += (-residual * j22 + j12 * screen_residual) / determinant;
      screen += (j21 * residual - j11 * screen_residual) / determinant;
    }
    interpolatePowerTube(grid - cathode, plate - cathode, screen - cathode, scratch, ia, ig2);
    drive = ia + opt.screenTapTurnsRatio * ig2;
    series_current =
        (signed_drive_ohm * (drive - opposite_drive) - history) * opt.inverseSeriesCoefficient;
    induced = signed_reflected_ohm * series_current;
    const double screen_tap = screenTapVoltage(induced, ia, ig2, state.bPlusRamp.applied);
    residual = (state.bPlusRamp.applied - induced - plate) * inverse_resistance - ia -
               ig2 * opt.centerToTapResistanceShare;
    return {plate, screen, screen_tap, ia, ig2, drive, residual};
  }

  [[nodiscard]] static double trapezoidPowerRc(double previous, double source_current,
                                               double resistance, double capacitance,
                                               double dt) noexcept {
    const double conductance = 1.0 / resistance;
    const double coefficient = 2.0 * capacitance / dt;
    return ((coefficient - conductance) * previous + 2.0 * source_current) /
           (coefficient + conductance);
  }

  // Bias, reservoir and screen nodes of the output stage. Their capacitors integrate the valve
  // currents continuously, so the drive of one slow step is the mean of the fast currents over that
  // step, not the single sample that happens to sit on the boundary. Sampling the instantaneous
  // current would decimate the valve currents by slowWindow with no anti-aliasing and fold every
  // harmonic above the slow Nyquist back onto the bias nodes, which is exactly what the driver
  // stage avoids by accumulating in updateSlow.
  void updatePowerSlow(PowerState &state) noexcept {
    const PhaseCPowerProfile &profile = powerProfile();
    const double dt = rate_config_.slowDt;
    const double window = static_cast<double>(rate_config_.slowWindow);
    const double inverse_window = 1.0 / window;
    const double mean_push = state.slowAccumulatorPushA * inverse_window;
    const double mean_pull = state.slowAccumulatorPullA * inverse_window;
    const double mean_screen = state.slowAccumulatorScreenA * inverse_window;
    const double mean_ltp = state.slowAccumulatorLtpA * inverse_window;
    state.slowAccumulatorPushA = 0.0;
    state.slowAccumulatorPullA = 0.0;
    state.slowAccumulatorScreenA = 0.0;
    state.slowAccumulatorLtpA = 0.0;
    const double previous_push = state.cathodePushV;
    const double previous_pull = state.cathodePullV;
    const double previous_b_plus = state.bPlusV;
    const double previous_screen = state.screenV;
    state.cathodePushV =
        trapezoidPowerRc(previous_push, mean_push, applied_parameters_.cathodeResistor,
                         profile.cathodeCapacitanceF, dt);
    state.cathodePullV =
        trapezoidPowerRc(previous_pull, mean_pull, applied_parameters_.cathodeResistor,
                         profile.cathodeCapacitanceF, dt);
    const double total_supply = mean_push + mean_pull + mean_ltp;
    const double supply_source =
        applied_parameters_.powerBPlus / profile.powerTheveninResistanceOhm - total_supply;
    state.bPlusV =
        trapezoidPowerRc(previous_b_plus, supply_source, profile.powerTheveninResistanceOhm,
                         profile.powerCapacitanceF, dt);
    if (profile.screenTapTurnsRatio == 0.0) {
      const auto tube_index = static_cast<std::size_t>(applied_parameters_.powerTube);
      const auto &tube_model =
          effetune::dsp::tube_simulator_phase_c_generated::kOutputTubeModels[tube_index];
      const double screen_source =
          (applied_parameters_.powerBPlus - tube_model.fixedScreenSupplyDropV) /
              profile.screenResistanceOhm -
          mean_screen;
      state.screenV = trapezoidPowerRc(previous_screen, screen_source, profile.screenResistanceOhm,
                                       profile.screenCapacitanceF, dt);
      retargetRamp(state.screenRamp, state.screenV, inverse_window, window);
    }
    retargetRamp(state.cathodePushRamp, state.cathodePushV, inverse_window, window);
    retargetRamp(state.cathodePullRamp, state.cathodePullV, inverse_window, window);
    retargetRamp(state.bPlusRamp, state.bPlusV, inverse_window, window);
    const double push_mid = 0.5 * (previous_push + state.cathodePushV);
    const double pull_mid = 0.5 * (previous_pull + state.cathodePullV);
    const double supply_mid = 0.5 * (previous_b_plus + state.bPlusV);
    const double push_residual =
        profile.cathodeCapacitanceF * (state.cathodePushV - previous_push) / dt +
        push_mid / applied_parameters_.cathodeResistor - mean_push;
    const double pull_residual =
        profile.cathodeCapacitanceF * (state.cathodePullV - previous_pull) / dt +
        pull_mid / applied_parameters_.cathodeResistor - mean_pull;
    const double supply_residual =
        profile.powerCapacitanceF * (state.bPlusV - previous_b_plus) / dt + total_supply -
        (applied_parameters_.powerBPlus - supply_mid) / profile.powerTheveninResistanceOhm;
    double residual = absolute(push_residual);
    residual = absolute(pull_residual) > residual ? absolute(pull_residual) : residual;
    residual = absolute(supply_residual) > residual ? absolute(supply_residual) : residual;
    maximum_dc_residual_ = residual > maximum_dc_residual_ ? residual : maximum_dc_residual_;
    ++slow_publish_count_;
  }

  [[nodiscard]] double advancePowerOutputLoad(double source, PowerState &state) noexcept {
    const PowerOptCoefficients &opt = power_opt_coeff_;
    const double old_current = state.optCurrentA;
    const double old_capacitor = state.optCapacitorV;
    const double right_hand = source - old_capacitor + opt.seriesHistoryCoefficient * old_current;
    const double new_current = right_hand * opt.inverseSeriesCoefficient;
    const double new_capacitor = old_capacitor + opt.capacitorStep * (new_current + old_current);
    const double old_magnetizing = state.magnetizingCurrentA;
    const double old_primary_voltage = state.primaryVoltageV;
    const double new_magnetizing =
        applied_parameters_.outputStage == 2
            ? old_magnetizing + opt.magnetizingStep * (old_primary_voltage + source)
            : (source + opt.magnetizingHistoryCoefficient * old_magnetizing) *
                  opt.inverseMagnetizingCoefficient;
    const double midpoint_current = 0.5 * (old_current + new_current);
    const double midpoint_magnetizing = 0.5 * (old_magnetizing + new_magnetizing);
    const double old_energy = 0.5 * opt.leakageInductanceH * old_current * old_current +
                              0.5 * opt.seriesCapacitanceF * old_capacitor * old_capacitor +
                              0.5 * opt.magnetizingInductanceH * old_magnetizing * old_magnetizing;
    const double new_energy = 0.5 * opt.leakageInductanceH * new_current * new_current +
                              0.5 * opt.seriesCapacitanceF * new_capacitor * new_capacitor +
                              0.5 * opt.magnetizingInductanceH * new_magnetizing * new_magnetizing;
    const double midpoint_primary_voltage = 0.5 * (old_primary_voltage + source);
    const double residual =
        applied_parameters_.outputStage == 2
            ? midpoint_primary_voltage *
                      (midpoint_current + midpoint_magnetizing +
                       midpoint_primary_voltage * opt.inverseCoreLossResistanceOhm) -
                  opt.effectiveResistanceOhm * midpoint_current * midpoint_current -
                  midpoint_primary_voltage * midpoint_primary_voltage *
                      opt.inverseCoreLossResistanceOhm -
                  (new_energy - old_energy) * opt.inverseFastDt
            : source * (midpoint_current + midpoint_magnetizing) -
                  opt.effectiveResistanceOhm * midpoint_current * midpoint_current -
                  opt.coreLossResistanceOhm * midpoint_magnetizing * midpoint_magnetizing -
                  (new_energy - old_energy) * opt.inverseFastDt;
    const double absolute_residual = absolute(residual);
    maximum_energy_residual_ =
        absolute_residual > maximum_energy_residual_ ? absolute_residual : maximum_energy_residual_;
    state.optCurrentA = new_current;
    state.optCapacitorV = new_capacitor;
    state.magnetizingCurrentA = new_magnetizing;
    state.primaryVoltageV = source;

    const double secondary_current = new_current * opt.turnsRatio;
    if (opt.voiceStepLimited) {
      ++safety_limits_;
      step_safety_hit_ = true;
    }
    const double load_voltage = secondary_current * opt.speakerLoadOhm;
    state.speakerVoiceCurrentA +=
        opt.voiceStep * (load_voltage - opt.voiceResistanceOhm * state.speakerVoiceCurrentA -
                         state.speakerCapacitorV);
    if (opt.resonanceStepLimited) {
      ++safety_limits_;
      step_safety_hit_ = true;
    }
    state.speakerResonanceCurrentA +=
        opt.resonanceStep *
        (load_voltage - opt.resonanceResistanceOhm * state.speakerResonanceCurrentA -
         state.speakerCapacitorV);
    state.speakerCapacitorV +=
        opt.speakerCapacitorStep * (state.speakerVoiceCurrentA + state.speakerResonanceCurrentA);
    const double output = load_voltage + state.speakerCapacitorV * 0.02;
    state.speakerLoadVoltageV = load_voltage;
    state.speakerLoadCurrentA = secondary_current;
    state.feedbackV = output * opt.nfbTapGain;
    return output;
  }

  [[nodiscard]] double advancePower(int channel, double input,
                                    bool driver_bypassed = false) noexcept {
    PowerState &state = power_state_[channel];
    advanceRamp(state.cathodePushRamp);
    advanceRamp(state.cathodePullRamp);
    advanceRamp(state.bPlusRamp);
    advanceRamp(state.screenRamp);
    const PowerLtpCoefficients &ltp = power_ltp_;
    const TubeTables &ltp_tube = tubeTables()[0];

    // (0) Previous-sample operating point. Both triodes are linearised about it, so the tail and
    // plate nodes below are exact solutions of a companion model rather than an iteration.
    const double ltp_cathode0 = state.ltpCathodeV;
    const double vgk_a0 = state.ltpGridAV - ltp_cathode0;
    const double vak_a0 = state.ltpPlateAV - ltp_cathode0;
    const double vgk_b0 = -ltp_cathode0;
    const double vak_b0 = state.ltpPlateBV - ltp_cathode0;
    const PlateEvaluation triode_a = ltp_tube.evaluatePlate(vgk_a0, vak_a0);
    const PlateEvaluation triode_b = ltp_tube.evaluatePlate(vgk_b0, vak_b0);

    // (1) Fixed pre-power volume and LTP input AC coupling, solved as one network. The 1 MOhm
    // potentiometer hangs off the driver output-coupling node, its lower section returns to ground
    // and its wiper drives the phase-inverter input capacitor; the capacitor holds its voltage
    // across the step, so the wiper node is the only unknown and follows from a single node
    // equation. The grid-stopper branch is the one breakpoint of a piecewise-linear network, so it
    // is resolved by re-solving that same equation once with the branch closed - a case selection
    // with a guaranteed consistent result, not an iteration. Grid conduction charges the capacitor
    // and shifts the grid negative; the grid-leak return relaxes it with tau = (Rth + Rgl)*Cin,
    // where Rth is the parallel combination of the two pot sections.
    const double wiper_source =
        input * ltp.preVolumeSourceConductance + state.ltpInputCapV * ltp.inverseLtpGridLeak;
    // Bypass input is already calibrated as the physical voltage at the power-stage input, so it
    // is injected at the phase-inverter coupling capacitor instead of passing through the fixed
    // interstage volume network.
    double wiper = driver_bypassed ? input : wiper_source * ltp.inverseWiperConductanceOpen;
    double ltp_grid_a = wiper - state.ltpInputCapV;
    double ltp_grid_current = 0.0;
    if (ltp_grid_a > ltp_cathode0) {
      if (!driver_bypassed) {
        wiper = (wiper_source + ltp.inverseGridStopper * (state.ltpInputCapV + ltp_cathode0)) *
                ltp.inverseWiperConductanceConducting;
      }
      ltp_grid_a = wiper - state.ltpInputCapV;
      ltp_grid_current = (ltp_grid_a - ltp_cathode0) * ltp.inverseGridStopper;
    }
    state.ltpInputCapV +=
        ltp.dtOverInputCapacitance * (ltp_grid_a * ltp.inverseLtpGridLeak + ltp_grid_current);

    // (2) Output-tube grid networks seen from the LTP plates. Each coupling capacitor holds its
    // voltage across the step, so the grid node is an affine function of the plate it hangs on and
    // the whole network reduces to a conductance plus a source current. The grid-stopper branch is
    // switched by the diode state observed on the previous sample, exactly like the existing
    // output-tube Ig1 clamp; every other term is exact.
    // Triode A is the driven side and inverts, so it feeds the pull output tube; triode B follows
    // the tail and feeds the push output tube. That keeps the Power forward polarity, and with it
    // the sign of the fixed secondary feedback tap, unchanged.
    const double push_stopper =
        state.gridPushV > state.cathodePushRamp.applied ? ltp.inverseGridStopper : 0.0;
    const double pull_stopper =
        state.gridPullV > state.cathodePullRamp.applied ? ltp.inverseGridStopper : 0.0;
    const double push_load_conductance = ltp.inverseGridLeak + push_stopper;
    const double pull_load_conductance = ltp.inverseGridLeak + pull_stopper;
    const double push_load_source =
        -state.gridCouplingPushV * ltp.inverseGridLeak -
        push_stopper * (state.gridCouplingPushV + state.cathodePushRamp.applied);
    const double pull_load_source =
        -state.gridCouplingPullV * ltp.inverseGridLeak -
        pull_stopper * (state.gridCouplingPullV + state.cathodePullRamp.applied);

    // (3) Tail and both plate nodes solved simultaneously. Substituting each plate equation into
    // the tail equation leaves one scalar unknown, so the three-node companion system is solved in
    // closed form with three divisions and no iteration. Keeping the grid-network conductance in
    // the same sample is what makes the solve unconditionally stable: a one-sample-delayed grid
    // current would close a loop of gain Rgs^-1 / (Ra^-1 + gp) which exceeds one during grid
    // conduction.
    const double transconductance_a = triode_a.gridDerivative + triode_a.plateDerivative;
    const double transconductance_b = triode_b.gridDerivative + triode_b.plateDerivative;
    const double source_a = triode_a.current + triode_a.gridDerivative * (ltp_grid_a - vgk_a0) -
                            triode_a.plateDerivative * vak_a0;
    const double source_b = triode_b.current + triode_b.gridDerivative * (0.0 - vgk_b0) -
                            triode_b.plateDerivative * vak_b0;
    const double inverse_plate_denominator_a =
        1.0 / (ltp.inversePlateResistance + triode_a.plateDerivative + pull_load_conductance);
    const double inverse_plate_denominator_b =
        1.0 / (ltp.inversePlateResistance + triode_b.plateDerivative + push_load_conductance);
    const double b_plus_over_plate_resistance =
        state.bPlusRamp.applied * ltp.inversePlateResistance;
    const double plate_source_a = b_plus_over_plate_resistance - source_a - pull_load_source;
    const double plate_source_b = b_plus_over_plate_resistance - source_b - push_load_source;
    const double tail_conductance =
        ltp.inverseTailResistance + transconductance_a + transconductance_b -
        triode_a.plateDerivative * transconductance_a * inverse_plate_denominator_a -
        triode_b.plateDerivative * transconductance_b * inverse_plate_denominator_b;
    const double tail_source =
        ltp.tailSupplyOverTailResistance + source_a + source_b +
        triode_a.plateDerivative * plate_source_a * inverse_plate_denominator_a +
        triode_b.plateDerivative * plate_source_b * inverse_plate_denominator_b;
    const double ltp_cathode = tail_source / tail_conductance;
    const double ltp_plate_a =
        (plate_source_a + transconductance_a * ltp_cathode) * inverse_plate_denominator_a;
    const double ltp_plate_b =
        (plate_source_b + transconductance_b * ltp_cathode) * inverse_plate_denominator_b;
    state.ltpCathodeV = ltp_cathode;
    state.ltpPlateAV = ltp_plate_a;
    state.ltpPlateBV = ltp_plate_b;
    state.ltpGridAV = ltp_grid_a;
    state.ltpBalanceV = ltp_plate_a - ltp_plate_b;
    // Both phase-inverter plate loads return to the same reservoir node the output valves feed
    // from, so the current they draw belongs in that node's KCL. Leaving it out left the reservoir
    // balance short by roughly two milliamps - 2.7 per cent of the EL84 standing current - and the
    // recorded DC residual could not see the gap because it was written from the same short sum.
    state.slowAccumulatorLtpA +=
        (state.bPlusRamp.applied - ltp_plate_a + state.bPlusRamp.applied - ltp_plate_b) *
        ltp.inversePlateResistance;

    // (4) Advance the two output-tube coupling capacitors on the solved grid currents. Grid
    // conduction charges them and shifts the output-tube bias negative with tau = Rgl*Cg.
    const double grid_push = ltp_plate_b - state.gridCouplingPushV;
    const double push_load = push_load_conductance * ltp_plate_b + push_load_source;
    state.gridCouplingPushV += ltp.dtOverGridCapacitance * push_load;
    state.gridPushV = grid_push;
    const double grid_pull = ltp_plate_a - state.gridCouplingPullV;
    const double pull_load = pull_load_conductance * ltp_plate_a + pull_load_source;
    state.gridCouplingPullV += ltp.dtOverGridCapacitance * pull_load;
    state.gridPullV = grid_pull;

    // Screen current only flows in the centre-to-tap winding section, so its ampere-turn
    // contribution to the primary is scaled by the tap turns ratio. It vanishes for a pentode
    // connection, where the screen is fed from its own supply and never crosses the primary.
    // Each plate solve needs the opposite half primary's drive; that one term is carried over from
    // the previous sample so the two solves stay sequential.
    const double previous_push_drive =
        state.iaPushA + power_opt_coeff_.screenTapTurnsRatio * state.ig2PushA;
    const double previous_pull_drive =
        state.iaPullA + power_opt_coeff_.screenTapTurnsRatio * state.ig2PullA;
    PowerPlateResult push =
        solvePowerPlate(true, state, previous_pull_drive, power_lut_scratch_[channel][0]);
    PowerPlateResult pull =
        solvePowerPlate(false, state, previous_push_drive, power_lut_scratch_[channel][1]);
    state.platePushV = push.plateV;
    state.platePullV = pull.plateV;
    state.iaPushA = push.ia;
    state.iaPullA = pull.ia;
    state.ig2PushA = push.ig2;
    state.ig2PullA = pull.ig2;
    state.screenTapV = 0.5 * (push.screenTapV + pull.screenTapV);
    // For a distributed tap the mean of the two fast-computed screen terminals is the meter
    // reading this field publishes. For a pentode connection screenV is the slow reservoir state
    // itself, and the solver's applied ramp must not be written back into the integrator.
    if (power_opt_coeff_.distributedScreenTap) {
      state.screenV = 0.5 * (push.screenV + pull.screenV);
    }
    state.screenPushV = push.screenV;
    state.screenPullV = pull.screenV;
    const double fast_residual = absolute(push.residual) > absolute(pull.residual)
                                     ? absolute(push.residual)
                                     : absolute(pull.residual);
    maximum_kcl_ = fast_residual > maximum_kcl_ ? fast_residual : maximum_kcl_;
    const double primary_source = (push.driveA - pull.driveA) * power_opt_coeff_.primaryDriveOhm;
    const double output = advancePowerOutputLoad(primary_source, state);
    state.slowAccumulatorPushA += push.ia + push.ig2;
    state.slowAccumulatorPullA += pull.ia + pull.ig2;
    state.slowAccumulatorScreenA += push.ig2 + pull.ig2;
    ++state.slowCounter;
    if (state.slowCounter >= static_cast<std::uint32_t>(rate_config_.slowWindow)) {
      state.slowCounter = 0u;
      updatePowerSlow(state);
    }
    accumulatePowerWindow(state);
    if (!finitePowerState(state) || !std::isfinite(output)) {
      ++finite_faults_;
      block_finite_fault_ = true;
      resetPowerState(state);
      return 0.0;
    }
    return output / kPowerOutputReferencePeakV;
  }

  [[nodiscard]] static PlateEvaluation evaluateSeTriode(const SeTubeModel &model, double vgk,
                                                        double vak) noexcept {
    if (vak <= 0.0) {
      return {0.0, 0.0, 0.0};
    }
    const double z = (vgk + vak / model.mu - model.v0) / model.sc;
    const double softplus = exactSoftplus(z);
    const double exponential = std::exp(z >= 0.0 ? -z : z);
    const double sigmoid = z >= 0.0 ? 1.0 / (1.0 + exponential) : exponential / (1.0 + exponential);
    const double u = model.sc * softplus;
    const double amplitude = model.ka * std::pow(u, model.alpha);
    const double amplitude_derivative =
        u > 0.0 ? model.ka * model.alpha * std::pow(u, model.alpha - 1.0) * sigmoid : 0.0;
    const double knee_exponential = std::exp(-vak / model.vs);
    const double knee = 1.0 - knee_exponential;
    return {amplitude * knee, amplitude_derivative * knee,
            amplitude_derivative * knee / model.mu + amplitude * knee_exponential / model.vs};
  }

  void updateSeSlow(PowerState &state, const SeTubeModel &model) noexcept {
    const double inverse_window = 1.0 / static_cast<double>(rate_config_.slowWindow);
    const double mean_current = state.slowAccumulatorPushA * inverse_window;
    state.slowAccumulatorPushA = 0.0;
    const double previous_cathode = state.cathodePushV;
    const double previous_b_plus = state.bPlusV;
    state.cathodePushV =
        trapezoidPowerRc(previous_cathode, mean_current, applied_parameters_.seCathodeResistor,
                         model.cathodeCapacitanceF, rate_config_.slowDt);
    state.cathodePullV = state.cathodePushV;
    const double supply_source =
        applied_parameters_.seBPlus / model.powerTheveninResistanceOhm - mean_current;
    state.bPlusV =
        trapezoidPowerRc(previous_b_plus, supply_source, model.powerTheveninResistanceOhm,
                         model.powerCapacitanceF, rate_config_.slowDt);
    retargetRamp(state.cathodePushRamp, state.cathodePushV, inverse_window,
                 static_cast<double>(rate_config_.slowWindow));
    retargetRamp(state.cathodePullRamp, state.cathodePullV, inverse_window,
                 static_cast<double>(rate_config_.slowWindow));
    retargetRamp(state.bPlusRamp, state.bPlusV, inverse_window,
                 static_cast<double>(rate_config_.slowWindow));
    ++slow_publish_count_;
  }

  [[nodiscard]] double advanceSingleEnded(int channel, double input) noexcept {
    PowerState &state = power_state_[channel];
    const SeTubeModel &model = kSeTubeModels[static_cast<std::size_t>(applied_parameters_.seTube)];
    advanceRamp(state.cathodePushRamp);
    advanceRamp(state.cathodePullRamp);
    advanceRamp(state.bPlusRamp);
    const double cathode = state.cathodePushRamp.applied;
    double plate = state.platePushV;
    PlateEvaluation evaluation = evaluateSeTriode(model, input - cathode, plate - cathode);
    const PowerOptCoefficients &opt = power_opt_coeff_;
    const double series_history =
        -state.optCapacitorV + opt.seriesHistoryCoefficient * state.optCurrentA;
    const double magnetizing_history =
        state.magnetizingCurrentA + opt.magnetizingStep * state.primaryVoltageV;
    const double transformer_conductance =
        opt.inverseSeriesCoefficient + opt.magnetizingStep + opt.inverseCoreLossResistanceOhm;
    double residual = 0.0;
    for (int iteration = 0; iteration < 4; ++iteration) {
      const double primary_voltage =
          state.bPlusRamp.applied - plate - model.windingResistanceOhm * evaluation.current;
      const double transformer_current = primary_voltage * transformer_conductance +
                                         series_history * opt.inverseSeriesCoefficient +
                                         magnetizing_history;
      residual = evaluation.current - transformer_current;
      const double derivative =
          evaluation.plateDerivative +
          transformer_conductance * (1.0 + model.windingResistanceOhm * evaluation.plateDerivative);
      if (!std::isfinite(derivative) || absolute(derivative) < 1e-12) {
        ++safety_limits_;
        step_safety_hit_ = true;
        break;
      }
      plate -= residual / derivative;
      evaluation = evaluateSeTriode(model, input - cathode, plate - cathode);
    }
    const double primary_voltage =
        state.bPlusRamp.applied - plate - model.windingResistanceOhm * evaluation.current;
    const double transformer_current = primary_voltage * transformer_conductance +
                                       series_history * opt.inverseSeriesCoefficient +
                                       magnetizing_history;
    residual = evaluation.current - transformer_current;
    const double absolute_residual = absolute(residual);
    maximum_kcl_ = absolute_residual > maximum_kcl_ ? absolute_residual : maximum_kcl_;
    state.platePushV = plate;
    state.platePullV = plate;
    state.iaPushA = evaluation.current;
    state.iaPullA = evaluation.current;
    const double output = advancePowerOutputLoad(primary_voltage, state);
    state.slowAccumulatorPushA += evaluation.current;
    ++state.slowCounter;
    if (state.slowCounter >= static_cast<std::uint32_t>(rate_config_.slowWindow)) {
      state.slowCounter = 0u;
      updateSeSlow(state, model);
    }
    accumulatePowerWindow(state);
    if (!finitePowerState(state) || !std::isfinite(output)) {
      ++finite_faults_;
      block_finite_fault_ = true;
      resetPowerState(state);
      return 0.0;
    }
    return output / kPowerOutputReferencePeakV;
  }

  void accumulatePowerWindow(PowerState &state) noexcept {
    state.vrmsSquareSum += state.speakerLoadVoltageV * state.speakerLoadVoltageV;
    state.realPowerSum += state.speakerLoadVoltageV * state.speakerLoadCurrentA;
    ++state.powerWindowSamples;
    const std::uint32_t window_samples =
        static_cast<std::uint32_t>(rate_config_.internalRate / 10.0);
    if (state.powerWindowSamples < window_samples) {
      return;
    }
    const double inverse = 1.0 / static_cast<double>(state.powerWindowSamples);
    state.publishedVrms = std::sqrt(state.vrmsSquareSum * inverse);
    state.publishedRealPower = state.realPowerSum * inverse;
    state.vrmsSquareSum = 0.0;
    state.realPowerSum = 0.0;
    state.powerWindowSamples = 0u;
  }

  [[nodiscard]] SlowValue trBdf2Step(const SlowValue &state, double capacitance, double conductance,
                                     double drive) const noexcept {
    const double derivative1 = 2.0 / (kGamma * rate_config_.slowDt);
    const double history1 = -capacitance * derivative1 * state.voltage - state.capacitorCurrent;
    const double stageVoltage = (drive - history1) / (conductance + capacitance * derivative1);
    const double derivative2 = (2.0 - kGamma) / ((1.0 - kGamma) * rate_config_.slowDt);
    const double coefficient1 = -1.0 / (kGamma * (1.0 - kGamma) * rate_config_.slowDt);
    const double coefficient0 = (1.0 - kGamma) / (kGamma * rate_config_.slowDt);
    const double history2 =
        capacitance * (coefficient1 * stageVoltage + coefficient0 * state.voltage);
    const double voltage = (drive - history2) / (conductance + capacitance * derivative2);
    const double current = capacitance * derivative2 * voltage + history2;
    return {voltage, current};
  }

  void solveDc(SlowState &slow, FastChannel &fast) noexcept {
    double p = supply_voltage_;
    std::array<double, 2> vk = {1.0, 1.0};
    std::array<double, 2> vg = {0.0, 0.0};
    std::array<double, 2> va = {140.0, 140.0};
    std::array<PlateEvaluation, 2> plate{};
    std::array<GridEvaluation, 2> grid{};
    for (int iteration = 0; iteration < 8192; ++iteration) {
      for (int stage = 0; stage < 2; ++stage) {
        for (int grid_iteration = 0; grid_iteration < 8; ++grid_iteration) {
          grid[static_cast<std::size_t>(stage)] = evaluateGrid(vg[static_cast<std::size_t>(stage)] -
                                                               vk[static_cast<std::size_t>(stage)]);
          const double residual = vg[static_cast<std::size_t>(stage)] / kGridLeakResistance +
                                  grid[static_cast<std::size_t>(stage)].current;
          vg[static_cast<std::size_t>(stage)] -=
              residual /
              (1.0 / kGridLeakResistance + grid[static_cast<std::size_t>(stage)].derivative);
        }
        plate[static_cast<std::size_t>(stage)] = evaluatePlate(
            vg[static_cast<std::size_t>(stage)] - vk[static_cast<std::size_t>(stage)],
            va[static_cast<std::size_t>(stage)] - vk[static_cast<std::size_t>(stage)]);
      }
      const double targetP =
          (supply_voltage_ / supply_resistance_ - plate[0].current - plate[1].current) /
          (1.0 / supply_resistance_ + kGmin);
      p += 0.025 * (targetP - p);
      for (int stage = 0; stage < 2; ++stage) {
        const std::size_t index = static_cast<std::size_t>(stage);
        const double targetVk =
            (plate[index].current + grid[index].current) / (1.0 / cathode_resistance_ + kGmin);
        const double targetVa = p - plate_resistance_ * plate[index].current;
        vk[index] += 0.025 * (targetVk - vk[index]);
        va[index] += 0.025 * (targetVa - va[index]);
      }
    }
    slow.cathode[0] = {vk[0], 0.0};
    slow.cathode[1] = {vk[1], 0.0};
    slow.supply = {p, 0.0};
    seedRamp(slow.cathodeRamp[0], vk[0]);
    seedRamp(slow.cathodeRamp[1], vk[1]);
    seedRamp(slow.supplyRamp, p);
    for (int stage = 0; stage < 2; ++stage) {
      const std::size_t index = static_cast<std::size_t>(stage);
      FastStage &state = fast.stage[index];
      plate[index] = evaluatePlate(vg[index] - vk[index], va[index] - vk[index]);
      const double denominator = 1.0 + plate_resistance_ * plate[index].plateDerivative;
      state.gridVoltage = vg[index];
      state.plateVoltage = va[index];
      state.couplingCharge = stage == 0 ? kCouplingCapacitance * (0.0 - vg[index])
                                        : kCouplingCapacitance * (va[0] - vg[index]);
      state.millerVoltage = vg[index];
      state.localPlateGain = -plate_resistance_ * plate[index].gridDerivative / denominator;
      state.millerCapacitance = activeTube().cgk + activeTube().cga * (1.0 - state.localPlateGain);
      state.outputResistance = plate_resistance_ / denominator;
      state.previousVak = va[index] - vk[index];
    }
    fast.outputCouplingCharge = kOutputCapacitance * va[1];
    fast.outputLoadCurrent = 0.0;
    const double gridResidual0 = absolute(vg[0] / kGridLeakResistance + grid[0].current);
    const double gridResidual1 = absolute(vg[1] / kGridLeakResistance + grid[1].current);
    const double cathodeResidual0 =
        absolute((1.0 / cathode_resistance_ + kGmin) * vk[0] - plate[0].current - grid[0].current);
    const double cathodeResidual1 =
        absolute((1.0 / cathode_resistance_ + kGmin) * vk[1] - plate[1].current - grid[1].current);
    const double plateResidual0 = absolute((p - va[0]) / plate_resistance_ - plate[0].current);
    const double plateResidual1 = absolute((p - va[1]) / plate_resistance_ - plate[1].current);
    const double supplyResidual =
        absolute((1.0 / supply_resistance_ + kGmin) * p + plate[0].current + plate[1].current -
                 supply_voltage_ / supply_resistance_);
    const std::array<double, 7> residuals = {gridResidual0,    gridResidual1,  cathodeResidual0,
                                             cathodeResidual1, plateResidual0, plateResidual1,
                                             supplyResidual};
    for (double residual : residuals) {
      if (residual > maximum_dc_residual_) {
        maximum_dc_residual_ = residual;
      }
    }
  }

  void resetModel(bool preserve_dry_and_timeline = false) noexcept {
    const double preserved_fault_wet = fault_wet_current_;
    maximum_kcl_ = 0.0;
    maximum_dc_residual_ = 0.0;
    finite_faults_ = 0u;
    safety_limits_ = 0u;
    slow_publish_count_ = 0u;
    step_safety_hit_ = false;
    block_finite_fault_ = false;
    block_safety_hit_ = false;
    if (!preserve_dry_and_timeline) {
      central_reset_count_ = 0u;
      last_central_reset_reason_ = CentralResetReason::none;
      dry_index_ = 0;
      processed_host_frames_ = 0u;
      detection_frame_for_testing_ = std::numeric_limits<std::uint64_t>::max();
      mute_complete_frame_for_testing_ = std::numeric_limits<std::uint64_t>::max();
      trial_observation_start_frame_for_testing_ = std::numeric_limits<std::uint64_t>::max();
      pending_fault_parameter_commit_ = false;
      fault_reset_pending_ = false;
      trial_after_fault_reset_ = false;
      fault_clear_pending_ = false;
#if ET_TUBE_SIMULATOR_TEST_STATE
      detector_window_trace_for_testing_.clear();
      detector_window_trace_overflow_for_testing_ = false;
      transition_boundary_trace_for_testing_.clear();
      transition_boundary_trace_overflow_for_testing_ = false;
      maximum_detector_input_rms_for_testing_ = 0.0;
      maximum_detector_output_rms_for_testing_ = 0.0;
      maximum_detector_feedback_rms_for_testing_ = 0.0;
      maximum_fast_kcl_for_testing_ = FastKclObservation{};
      current_fast_kcl_host_frame_for_testing_ = 0u;
      current_fast_kcl_internal_frame_for_testing_ = 0u;
      current_fast_kcl_internal_phase_for_testing_ = 0u;
#endif
    }
    resetDetector();
    if (!preserve_dry_and_timeline && fault_state_ == FaultState::normal) {
      fault_wet_current_ = 1.0;
      fault_mute_remaining_ = 0u;
    }
    controls_ = ControlState{};
    controls_.coefficient =
        1.0 - std::exp(-1000.0 / (kControlSmoothingMilliseconds * prepared_rate_));
    applyPath2Parameters(true);
    telemetry_payload_.fill(0.0F);
    for (int channel = 0; channel < kChannels; ++channel) {
      fast_[channel] = FastChannel{};
      slow_[channel] = SlowState{};
      accumulator_[channel] = SlowAccumulator{};
      resetPowerState(power_state_[channel]);
      power_lut_scratch_[channel] = {};
      if (supported_rate_) {
        solveDc(slow_[channel], fast_[channel]);
      }
      recovery_fast_[channel] = fast_[channel];
      recovery_slow_[channel] = slow_[channel];
      last_plate_current_[channel] = {0.0, 0.0};
      feedback_filter_[channel] = FeedbackFilterState{};
      bypass_drive_[static_cast<std::size_t>(channel)] = 0.0;
      if (!upsample_state_[channel].empty()) {
        std::fill(upsample_state_[channel].begin(), upsample_state_[channel].end(), 0.0);
      }
      if (!downsample_state_[channel].empty()) {
        std::fill(downsample_state_[channel].begin(), downsample_state_[channel].end(), 0.0);
      }
      if (!host_work_[channel].empty()) {
        std::fill(host_work_[channel].begin(), host_work_[channel].end(), 0.0);
      }
      if (!internal_input_[channel].empty()) {
        std::fill(internal_input_[channel].begin(), internal_input_[channel].end(), 0.0);
      }
      if (!internal_output_[channel].empty()) {
        std::fill(internal_output_[channel].begin(), internal_output_[channel].end(), 0.0);
      }
      if (!internal_work_[channel].empty()) {
        std::fill(internal_work_[channel].begin(), internal_work_[channel].end(), 0.0);
      }
      if (!preserve_dry_and_timeline) {
        dry_delay_[channel].fill(0.0);
      }
    }
    if (supported_rate_) {
      schedulePlateReference(fast_[0].stage[1].plateVoltage, true);
    }
    std::fill(drive_gain_.begin(), drive_gain_.end(), 0.0);
    std::fill(output_gain_.begin(), output_gain_.end(), 0.0);
    std::fill(wet_mix_.begin(), wet_mix_.end(), 0.0);
    std::fill(input_reference_.begin(), input_reference_.end(), 0.0);
    std::fill(feedback_q_.begin(), feedback_q_.end(), controls_.feedbackQ);
    std::fill(feedback_makeup_.begin(), feedback_makeup_.end(), 1.0);
    std::fill(plate_reference_.begin(), plate_reference_.end(), controls_.plateReference);
    std::fill(transition_wet_.begin(), transition_wet_.end(), 1.0);
    if (preserve_dry_and_timeline) {
      fault_wet_current_ = preserved_fault_wet;
    }
    std::fill(fault_wet_.begin(), fault_wet_.end(), fault_wet_current_);
    std::fill(safety_user_.begin(), safety_user_.end(), controls_.safetyUser);
    std::fill(wet_chain_.begin(), wet_chain_.end(), 0.0);
    // The reduction the detector has already committed survives a model reset: the mechanism
    // only ever attenuates, and a reset is not the user asking for the protection to be given up.
    if (!preserve_dry_and_timeline) {
      std::fill(safe_dry_.begin(), safe_dry_.end(), 0.0);
      std::fill(segment_audio_.begin(), segment_audio_.end(), 0.0F);
    }
    refreshTelemetryFromState();
  }

  void dispatchCentralReset(CentralResetReason reason) noexcept {
    last_central_reset_reason_ = reason;
    ++central_reset_count_;
    resetModel(true);
  }

  void cancelFeedbackTransition() noexcept {
    feedback_transition_ = FeedbackTransitionState{};
    pending_transition_parameters_valid_ = false;
    queued_transition_parameters_valid_ = false;
  }

  void applyFeedbackTransitionReset() noexcept {
    if (feedback_transition_.phase != FeedbackTransitionPhase::fadeOut ||
        !pending_transition_parameters_valid_) {
      return;
    }
    applied_parameters_ = pending_transition_parameters_;
    tube_index_ = applied_parameters_.tubeIndex;
    has_applied_parameters_ = true;
    feedback_transition_.activeGeneration = feedback_transition_.pendingGeneration;
    feedback_transition_.pendingGeneration = 0u;
    pending_transition_parameters_valid_ = false;
    dispatchCentralReset(CentralResetReason::feedbackTransition);
    feedback_transition_.stateGeneration = feedback_transition_.activeGeneration;
    feedback_transition_.phase = FeedbackTransitionPhase::warmup;
    feedback_transition_.progress = 0u;
    ++feedback_transition_.resetCount;
    ++feedback_transition_.atomicCommitCount;
#if ET_TUBE_SIMULATOR_TEST_STATE
    captureTransitionBoundaryForTesting();
#endif
  }

  void finishFeedbackTransition() noexcept {
    feedback_transition_.phase = FeedbackTransitionPhase::inactive;
    feedback_transition_.progress = 0u;
    feedback_transition_.pendingGeneration = 0u;
    pending_transition_parameters_valid_ = false;
#if ET_TUBE_SIMULATOR_TEST_STATE
    captureTransitionBoundaryForTesting();
#endif
    if (queued_transition_parameters_valid_) {
      const Path2Parameters queued = queued_transition_parameters_;
      const std::uint32_t generation = feedback_transition_.queuedGeneration;
      queued_transition_parameters_valid_ = false;
      feedback_transition_.queuedGeneration = 0u;
      beginFeedbackTransition(queued, generation);
    }
  }

  void advanceFeedbackTransitionBoundary() noexcept {
    const std::uint32_t fade_frames = feedbackTransitionFrames();
    if (feedback_transition_.phase == FeedbackTransitionPhase::fadeOut &&
        feedback_transition_.progress == fade_frames) {
      applyFeedbackTransitionReset();
    } else if (feedback_transition_.phase == FeedbackTransitionPhase::warmup &&
               feedback_transition_.progress == feedbackWarmupFrames()) {
      feedback_transition_.phase = FeedbackTransitionPhase::fadeIn;
      feedback_transition_.progress = 0u;
#if ET_TUBE_SIMULATOR_TEST_STATE
      captureTransitionBoundaryForTesting();
#endif
    } else if (feedback_transition_.phase == FeedbackTransitionPhase::fadeIn &&
               feedback_transition_.progress == fade_frames) {
      finishFeedbackTransition();
    }
  }

  [[nodiscard]] std::uint32_t feedbackTransitionRemainingFrames() const noexcept {
    if (feedback_transition_.phase == FeedbackTransitionPhase::fadeOut ||
        feedback_transition_.phase == FeedbackTransitionPhase::fadeIn) {
      return feedbackTransitionFrames() - feedback_transition_.progress;
    }
    if (feedback_transition_.phase == FeedbackTransitionPhase::warmup) {
      return feedbackWarmupFrames() - feedback_transition_.progress;
    }
    return std::numeric_limits<std::uint32_t>::max();
  }

  [[nodiscard]] std::uint32_t faultBoundaryRemainingFrames() const noexcept {
    if (fault_state_ == FaultState::muting && fault_mute_remaining_ != 0u) {
      return fault_mute_remaining_;
    }
    if (fault_state_ == FaultState::trial && fault_trial_remaining_ != 0u) {
      return fault_trial_remaining_;
    }
    if (fault_state_ == FaultState::returning && fault_return_remaining_ != 0u) {
      return fault_return_remaining_;
    }
    return std::numeric_limits<std::uint32_t>::max();
  }

  [[nodiscard]] std::uint32_t detectorWindowRemainingFrames() const noexcept {
    if (runtime_event_.cause == kRuntimeCauseProcessingSafetyFailure ||
        (fault_state_ != FaultState::normal && fault_state_ != FaultState::trial &&
         fault_state_ != FaultState::returning)) {
      return std::numeric_limits<std::uint32_t>::max();
    }
    const std::uint32_t window_samples = static_cast<std::uint32_t>(
        rate_config_.internalRate * kFeedbackDetectorWindowMilliseconds * 0.001);
    if (detector_samples_ >= window_samples) {
      return 1u;
    }
    const std::uint32_t remaining_internal = window_samples - detector_samples_;
    const std::uint32_t factor = static_cast<std::uint32_t>(rate_config_.factor);
    return (remaining_internal + factor - 1u) / factor;
  }

  [[nodiscard]] std::uint32_t feedbackTrialFrames() const noexcept {
    const double exact = prepared_rate_ * kFeedbackTrialMilliseconds * 0.001;
    const std::uint32_t frames = static_cast<std::uint32_t>(std::ceil(exact));
    return frames == 0u ? 1u : frames;
  }

  void handleFaultBoundary() noexcept {
    if (fault_clear_pending_ && runtime_event_.cause == kRuntimeCauseFeedbackOscillation) {
      fault_clear_pending_ = false;
      clearFeedbackFault();
      return;
    }
    if (!fault_reset_pending_ || runtime_event_.cause != kRuntimeCauseFeedbackOscillation) {
      return;
    }
    if (pending_fault_parameter_commit_) {
      applied_parameters_ = pending_fault_parameters_;
      tube_index_ = applied_parameters_.tubeIndex;
      applyPath2Parameters(false);
      pending_fault_parameter_commit_ = false;
      has_applied_parameters_ = true;
      trial_after_fault_reset_ = true;
    }
    fault_reset_pending_ = false;
    dispatchCentralReset(CentralResetReason::faultCircuit);
    fault_wet_current_ = 0.0;
    if (trial_after_fault_reset_) {
      fault_state_ = FaultState::trial;
      fault_trial_remaining_ = feedbackTrialFrames();
      trial_observation_start_frame_for_testing_ = processed_host_frames_;
    } else {
      fault_state_ = FaultState::latchedSafeBypass;
    }
    trial_after_fault_reset_ = false;
  }

  [[nodiscard]] double safetyBound(double value, double low, double high) noexcept {
    if (value < low) {
      ++safety_limits_;
      step_safety_hit_ = true;
      return low;
    }
    if (value > high) {
      ++safety_limits_;
      step_safety_hit_ = true;
      return high;
    }
    return value;
  }

  [[nodiscard]] double plateLoadLineResidual(double vak, const PlateEvaluation &plate,
                                             double delayed_p, double vk,
                                             double delayed_output_load_current) const noexcept {
    return (delayed_p - (vak + vk)) / plate_resistance_ - plate.current -
           delayed_output_load_current;
  }

  [[nodiscard]] bool
  plateCandidateNeedsFallback(double vak, const PlateEvaluation &plate, double delayed_p, double vk,
                              double delayed_output_load_current) const noexcept {
    const double plate_voltage = vak + vk;
    if (!std::isfinite(vak) || !std::isfinite(plate_voltage) ||
        vak < kMinimumPhysicalPlateVoltage || vak > kMaximumPhysicalPlateVoltage ||
        plate_voltage < kMinimumPhysicalPlateVoltage ||
        plate_voltage > kMaximumPhysicalPlateVoltage) {
      return true;
    }
    const double residual =
        plateLoadLineResidual(vak, plate, delayed_p, vk, delayed_output_load_current);
    return !std::isfinite(residual) || absolute(residual) > kPlateFastPathResidualTolerance;
  }

  void refinePlateCandidateOnce(double vgk, double delayed_p, double vk,
                                double delayed_output_load_current, double &vak,
                                PlateEvaluation &plate) const noexcept {
    const double residual =
        plateLoadLineResidual(vak, plate, delayed_p, vk, delayed_output_load_current);
    if (!std::isfinite(residual) || absolute(residual) <= kPlateFastPathResidualTolerance) {
      return;
    }
    const double derivative = -1.0 / plate_resistance_ - plate.plateDerivative;
    vak -= residual / derivative;
    plate = evaluatePlate(vgk, vak);
  }

  [[nodiscard]] PlateSolveResult
  solvePlateFallback(double vgk, double delayed_p, double vk, double delayed_output_load_current,
                     double fast_vak, const PlateEvaluation &fast_plate) const noexcept {
    double lower_vak = kMinimumPhysicalPlateVoltage;
    const double lower_plate_vak = kMinimumPhysicalPlateVoltage - vk;
    if (lower_plate_vak > lower_vak) {
      lower_vak = lower_plate_vak;
    }
    double upper_vak = kMaximumPhysicalPlateVoltage;
    const double upper_plate_vak = kMaximumPhysicalPlateVoltage - vk;
    if (upper_plate_vak < upper_vak) {
      upper_vak = upper_plate_vak;
    }
    if (!std::isfinite(lower_vak) || !std::isfinite(upper_vak) || lower_vak > upper_vak) {
      return {fast_vak, fast_plate, false};
    }

    PlateEvaluation lower_plate = evaluatePlate(vgk, lower_vak);
    PlateEvaluation upper_plate = evaluatePlate(vgk, upper_vak);
    const double lower_residual =
        plateLoadLineResidual(lower_vak, lower_plate, delayed_p, vk, delayed_output_load_current);
    const double upper_residual =
        plateLoadLineResidual(upper_vak, upper_plate, delayed_p, vk, delayed_output_load_current);
    if (!std::isfinite(lower_residual) || !std::isfinite(upper_residual)) {
      return {fast_vak, fast_plate, false};
    }
    if (absolute(lower_residual) <= kPlateFallbackResidualTolerance) {
      return {lower_vak, lower_plate, true};
    }
    if (absolute(upper_residual) <= kPlateFallbackResidualTolerance) {
      return {upper_vak, upper_plate, true};
    }
    if (lower_residual < 0.0 || upper_residual > 0.0) {
      return {fast_vak, fast_plate, false};
    }

    double candidate_vak = 0.5 * (lower_vak + upper_vak);
    for (int iteration = 0; iteration < kPlateFallbackMaximumIterations; ++iteration) {
      const PlateEvaluation candidate_plate = evaluatePlate(vgk, candidate_vak);
      const double candidate_residual = plateLoadLineResidual(
          candidate_vak, candidate_plate, delayed_p, vk, delayed_output_load_current);
      if (!std::isfinite(candidate_residual)) {
        return {fast_vak, fast_plate, false};
      }
      if (absolute(candidate_residual) <= kPlateFallbackResidualTolerance) {
        return {candidate_vak, candidate_plate, true};
      }

      if (candidate_residual > 0.0) {
        lower_vak = candidate_vak;
      } else {
        upper_vak = candidate_vak;
      }
      const double derivative = -1.0 / plate_resistance_ - candidate_plate.plateDerivative;
      const double newton_vak = candidate_vak - candidate_residual / derivative;
      candidate_vak = std::isfinite(newton_vak) && newton_vak > lower_vak && newton_vak < upper_vak
                          ? newton_vak
                          : 0.5 * (lower_vak + upper_vak);
    }

    const PlateEvaluation candidate_plate = evaluatePlate(vgk, candidate_vak);
    const double candidate_residual = plateLoadLineResidual(
        candidate_vak, candidate_plate, delayed_p, vk, delayed_output_load_current);
    return std::isfinite(candidate_residual) &&
                   absolute(candidate_residual) <= kPlateFallbackResidualTolerance
               ? PlateSolveResult{candidate_vak, candidate_plate, true}
               : PlateSolveResult{fast_vak, fast_plate, false};
  }

  [[nodiscard]] StageResult advanceStage(int stage_index, FastStage &stage, double source_voltage,
                                         double source_resistance, double delayed_p, double vk,
                                         double delayed_output_load_current) noexcept {
    const double old_charge = stage.couplingCharge;
    const double cm =
        safetyBound(stage.millerCapacitance, kMinimumMillerCapacitance, kMaximumMillerCapacitance);
    const double miller_conductance = cm / rate_config_.fastDt;
    const double series_resistance = source_resistance + rate_config_.fastDt / kCouplingCapacitance;
    const double passive_numerator = source_voltage - old_charge / kCouplingCapacitance +
                                     series_resistance * miller_conductance * stage.millerVoltage;
    const double passive_denominator =
        1.0 + series_resistance * (1.0 / kGridLeakResistance + miller_conductance);
    const double passive_grid = passive_numerator / passive_denominator;
    const double passive_vgk = passive_grid - vk;
    const double lambda = series_resistance / passive_denominator;
    const GridEvaluation upper = evaluateGrid(passive_vgk);
    double lower_vgk = passive_vgk - lambda * upper.current;
    if (passive_vgk > kGridOn - 2.0 && lower_vgk < kGridOn - 2.0) {
      lower_vgk = kGridOn - 2.0;
    }
    double predictor_vgk = passive_vgk;
    const double overdrive = passive_vgk - kGridOn;
    if (overdrive > 0.0 && lambda * upper.current > 1e-18) {
      const double loading = lambda * kGridK * std::sqrt(overdrive);
      predictor_vgk = kGridOn + overdrive * polynomialPowPositive(1.0 + 1.5 * loading, -2.0 / 3.0);
    }
    predictor_vgk = clampValue(predictor_vgk, lower_vgk, passive_vgk);
    const double physical_residual_scale = passive_denominator / source_resistance;
    double vgk = predictor_vgk;
    GridEvaluation grid = evaluateGrid(vgk);
    double grid_equation_residual = vgk + lambda * grid.current - passive_vgk;
    double absolute_grid_residual = absolute(physical_residual_scale * grid_equation_residual);
    for (int correction = 0; correction < kGridMaximumNewtonCorrections &&
                             absolute_grid_residual > kGridFastPathResidualTolerance;
         ++correction) {
      vgk -= grid_equation_residual / (1.0 + lambda * grid.derivative);
      vgk = clampValue(vgk, lower_vgk, passive_vgk);
      grid = evaluateGrid(vgk);
      grid_equation_residual = vgk + lambda * grid.current - passive_vgk;
      absolute_grid_residual = absolute(physical_residual_scale * grid_equation_residual);
    }
    if (absolute_grid_residual > kGridFastPathResidualTolerance) {
      double fallback_low = lower_vgk;
      double fallback_high = passive_vgk;
#if ET_TUBE_SIMULATOR_TEST_STATE
      int fallback_iterations_for_testing = 0;
#endif
      for (int iteration = 0; iteration < kGridFallbackMaximumIterations &&
                              absolute_grid_residual > kGridFallbackResidualTolerance;
           ++iteration) {
#if ET_TUBE_SIMULATOR_TEST_STATE
        ++fallback_iterations_for_testing;
#endif
        vgk = 0.5 * (fallback_low + fallback_high);
        grid = evaluateGrid(vgk);
        grid_equation_residual = vgk + lambda * grid.current - passive_vgk;
        if (grid_equation_residual > 0.0) {
          fallback_high = vgk;
        } else {
          fallback_low = vgk;
        }
        absolute_grid_residual = absolute(physical_residual_scale * grid_equation_residual);
      }
#if ET_TUBE_SIMULATOR_TEST_STATE
      ++grid_fallback_iteration_histogram_for_testing_[static_cast<std::size_t>(
          fallback_iterations_for_testing)];
#endif
      if (absolute_grid_residual > kGridFallbackResidualTolerance) {
        ++safety_limits_;
        step_safety_hit_ = true;
      }
    }
    const double grid_voltage = safetyBound(vgk + vk, -kMaximumGridVoltage, kMaximumGridVoltage);
    vgk = grid_voltage - vk;
    grid = evaluateGrid(vgk);
    const double i_m = miller_conductance * (grid_voltage - stage.millerVoltage);
    const double series_current = grid_voltage / kGridLeakResistance + grid.current + i_m;
    const double next_charge =
        safetyBound(old_charge + rate_config_.fastDt * series_current,
                    -kCouplingCapacitance * kMaximumCouplingEquivalentVoltage,
                    kCouplingCapacitance * kMaximumCouplingEquivalentVoltage);

    const PlateEvaluation plate_predictor = evaluatePlate(vgk, stage.previousVak);
    const double plate_denominator = 1.0 + plate_resistance_ * plate_predictor.plateDerivative;
    double vak = (delayed_p - vk -
                  plate_resistance_ * (plate_predictor.current -
                                       plate_predictor.plateDerivative * stage.previousVak +
                                       delayed_output_load_current)) /
                 plate_denominator;
    PlateEvaluation plate = evaluatePlate(vgk, vak);
    refinePlateCandidateOnce(vgk, delayed_p, vk, delayed_output_load_current, vak, plate);
    if (plateCandidateNeedsFallback(vak, plate, delayed_p, vk, delayed_output_load_current)) {
      const PlateSolveResult fallback =
          solvePlateFallback(vgk, delayed_p, vk, delayed_output_load_current, vak, plate);
      if (fallback.converged) {
        vak = fallback.vak;
        plate = fallback.plate;
#if ET_TUBE_SIMULATOR_TEST_STATE
        ++plate_fallback_successes_for_testing_;
#endif
      } else {
        ++safety_limits_;
        step_safety_hit_ = true;
      }
    }
    const double plate_voltage = vak + vk;
    const double derivative_denominator = 1.0 + plate_resistance_ * plate.plateDerivative;
    const double local_gain =
        safetyBound(-plate_resistance_ * plate.gridDerivative / derivative_denominator,
                    kMinimumLocalPlateGain, kMaximumLocalPlateGain);
    const double next_cm = safetyBound(activeTube().cgk + activeTube().cga * (1.0 - local_gain),
                                       kMinimumMillerCapacitance, kMaximumMillerCapacitance);
    const double i_cgk = activeTube().cgk / cm * i_m;
    const double i_cga = activeTube().cga * (1.0 - stage.localPlateGain) / cm * i_m;
    const double i_cak = activeTube().cak * (vak - stage.previousVak) / rate_config_.fastDt;
    const double coupling_current = (next_charge - old_charge) / rate_config_.fastDt;
    stage.gridVoltage = grid_voltage;
    stage.plateVoltage = plate_voltage;
    stage.couplingCharge = next_charge;
    stage.millerVoltage = grid_voltage;
    stage.millerCapacitance = next_cm;
    stage.localPlateGain = local_gain;
    stage.outputResistance = plate_resistance_ / derivative_denominator;
    stage.previousVak = vak;
    const double source_branch_current =
        (source_voltage - stage.gridVoltage - stage.couplingCharge / kCouplingCapacitance) /
        source_resistance;
    const double committed_series_current =
        stage.gridVoltage / kGridLeakResistance + grid.current + i_m;
    const double grid_residual = absolute(
        source_branch_current - stage.gridVoltage / kGridLeakResistance - grid.current - i_m);
    const double coupling_residual = absolute(coupling_current - committed_series_current);
    const double miller_split_residual = absolute(i_m - i_cgk - i_cga);
    const double plate_residual = absolute((delayed_p - stage.plateVoltage) / plate_resistance_ -
                                           plate.current - delayed_output_load_current);
    const FastKclNode grid_node =
        stage_index == 0 ? FastKclNode::stage1Grid : FastKclNode::stage2Grid;
    const FastKclNode coupling_node =
        stage_index == 0 ? FastKclNode::stage1Coupling : FastKclNode::stage2Coupling;
    const FastKclNode miller_node =
        stage_index == 0 ? FastKclNode::stage1Miller : FastKclNode::stage2Miller;
    const FastKclNode plate_node =
        stage_index == 0 ? FastKclNode::stage1Plate : FastKclNode::stage2Plate;
    double maximum_physical_kcl = grid_residual;
    FastKclNode maximum_physical_kcl_node = grid_node;
    if (coupling_residual > maximum_physical_kcl) {
      maximum_physical_kcl = coupling_residual;
      maximum_physical_kcl_node = coupling_node;
    }
    if (miller_split_residual > maximum_physical_kcl) {
      maximum_physical_kcl = miller_split_residual;
      maximum_physical_kcl_node = miller_node;
    }
    if (plate_residual > maximum_physical_kcl) {
      maximum_physical_kcl = plate_residual;
      maximum_physical_kcl_node = plate_node;
    }

    return {plate.current,
            grid.current,
            i_cgk,
            i_cga,
            i_cak,
            coupling_current,
            maximum_physical_kcl,
            maximum_physical_kcl_node};
  }

  void updateSlow(int channel, double i_ra1, double i_ra2, const StageResult &first,
                  const StageResult &second) noexcept {
    SlowAccumulator &accumulator = accumulator_[channel];
    accumulator.uK1 += first.plateCurrent + first.gridCurrent + first.iCgk + first.iCak;
    accumulator.uK2 += second.plateCurrent + second.gridCurrent + second.iCgk + second.iCak;
    accumulator.uP += supply_voltage_ / supply_resistance_ - i_ra1 - i_ra2;
    ++accumulator.count;
    if (accumulator.count != rate_config_.slowWindow) {
      return;
    }

    const double inverse_count = 1.0 / static_cast<double>(rate_config_.slowWindow);
    const double u_k1 = accumulator.uK1 * inverse_count;
    const double u_k2 = accumulator.uK2 * inverse_count;
    const double u_p = accumulator.uP * inverse_count;
    SlowState &slow = slow_[channel];
    slow.cathode[0] =
        trBdf2Step(slow.cathode[0], kCathodeCapacitance, 1.0 / cathode_resistance_ + kGmin, u_k1);
    slow.cathode[1] =
        trBdf2Step(slow.cathode[1], kCathodeCapacitance, 1.0 / cathode_resistance_ + kGmin, u_k2);
    slow.supply =
        trBdf2Step(slow.supply, supply_capacitance_, 1.0 / supply_resistance_ + kGmin, u_p);
    const double window = static_cast<double>(rate_config_.slowWindow);
    retargetRamp(slow.cathodeRamp[0], slow.cathode[0].voltage, inverse_count, window);
    retargetRamp(slow.cathodeRamp[1], slow.cathode[1].voltage, inverse_count, window);
    retargetRamp(slow.supplyRamp, slow.supply.voltage, inverse_count, window);

    const double residual1 =
        absolute((1.0 / cathode_resistance_ + kGmin) * slow.cathode[0].voltage +
                 slow.cathode[0].capacitorCurrent - u_k1);
    const double residual2 =
        absolute((1.0 / cathode_resistance_ + kGmin) * slow.cathode[1].voltage +
                 slow.cathode[1].capacitorCurrent - u_k2);
    const double residual_p = absolute((1.0 / supply_resistance_ + kGmin) * slow.supply.voltage +
                                       slow.supply.capacitorCurrent - u_p);
    double maximum = residual1 > residual2 ? residual1 : residual2;
    if (residual_p > maximum) {
      maximum = residual_p;
    }
    if (maximum > maximum_kcl_) {
      maximum_kcl_ = maximum;
    }
    accumulator = SlowAccumulator{};
    ++slow_publish_count_;
  }

  [[nodiscard]] bool finiteStage(const FastStage &stage) const noexcept {
    return std::isfinite(stage.gridVoltage) && std::isfinite(stage.plateVoltage) &&
           std::isfinite(stage.couplingCharge) && std::isfinite(stage.millerVoltage) &&
           std::isfinite(stage.millerCapacitance) && std::isfinite(stage.localPlateGain) &&
           std::isfinite(stage.outputResistance) && std::isfinite(stage.previousVak);
  }

  [[nodiscard]] bool finiteSlowValue(const SlowValue &value) const noexcept {
    return std::isfinite(value.voltage) && std::isfinite(value.capacitorCurrent);
  }

  [[nodiscard]] static bool finiteRamp(const SlowRamp &ramp) noexcept {
    return std::isfinite(ramp.applied) && std::isfinite(ramp.slope) &&
           std::isfinite(ramp.curvature) && std::isfinite(ramp.previous1) &&
           std::isfinite(ramp.previous2);
  }

  [[nodiscard]] static bool finitePowerState(const PowerState &state) noexcept {
    return std::isfinite(state.ltpInputCapV) && std::isfinite(state.ltpCathodeV) &&
           std::isfinite(state.ltpPlateAV) && std::isfinite(state.ltpPlateBV) &&
           std::isfinite(state.ltpGridAV) && std::isfinite(state.gridCouplingPushV) &&
           std::isfinite(state.gridCouplingPullV) && std::isfinite(state.ltpBalanceV) &&
           std::isfinite(state.gridPushV) && std::isfinite(state.gridPullV) &&
           std::isfinite(state.cathodePushV) && std::isfinite(state.cathodePullV) &&
           std::isfinite(state.bPlusV) && std::isfinite(state.screenTapV) &&
           std::isfinite(state.screenV) && std::isfinite(state.screenPushV) &&
           std::isfinite(state.screenPullV) && std::isfinite(state.optCurrentA) &&
           std::isfinite(state.magnetizingCurrentA) && std::isfinite(state.optCapacitorV) &&
           std::isfinite(state.speakerVoiceCurrentA) &&
           std::isfinite(state.speakerResonanceCurrentA) &&
           std::isfinite(state.speakerCapacitorV) && std::isfinite(state.feedbackV) &&
           std::isfinite(state.speakerLoadVoltageV) && std::isfinite(state.speakerLoadCurrentA) &&
           std::isfinite(state.platePushV) && std::isfinite(state.platePullV) &&
           std::isfinite(state.iaPushA) && std::isfinite(state.iaPullA) &&
           std::isfinite(state.ig2PushA) && std::isfinite(state.ig2PullA) &&
           std::isfinite(state.slowAccumulatorPushA) && std::isfinite(state.slowAccumulatorPullA) &&
           std::isfinite(state.slowAccumulatorScreenA) &&
           std::isfinite(state.slowAccumulatorLtpA) && finiteRamp(state.cathodePushRamp) &&
           finiteRamp(state.cathodePullRamp) && finiteRamp(state.bPlusRamp) &&
           finiteRamp(state.screenRamp) && std::isfinite(state.vrmsSquareSum) &&
           std::isfinite(state.realPowerSum) && std::isfinite(state.publishedVrms) &&
           std::isfinite(state.publishedRealPower);
  }

  [[nodiscard]] bool finitePhysicalChannel(int channel) const noexcept {
    const FastChannel &fast = fast_[channel];
    const SlowState &slow = slow_[channel];
    const SlowAccumulator &accumulator = accumulator_[channel];
    return finiteStage(fast.stage[0]) && finiteStage(fast.stage[1]) &&
           std::isfinite(fast.outputCouplingCharge) && std::isfinite(fast.outputLoadCurrent) &&
           finiteSlowValue(slow.cathode[0]) && finiteSlowValue(slow.cathode[1]) &&
           finiteSlowValue(slow.supply) && finiteRamp(slow.cathodeRamp[0]) &&
           finiteRamp(slow.cathodeRamp[1]) && finiteRamp(slow.supplyRamp) &&
           std::isfinite(accumulator.uK1) && std::isfinite(accumulator.uK2) &&
           std::isfinite(accumulator.uP) && accumulator.count >= 0 &&
           accumulator.count < rate_config_.slowWindow;
  }

  [[nodiscard]] bool physicalRangesValid(int channel) const noexcept {
    const FastChannel &fast = fast_[channel];
    const SlowState &slow = slow_[channel];
    if (slow.supply.voltage < 0.0 || slow.supply.voltage > 400.0) {
      return false;
    }
    for (int stage = 0; stage < 2; ++stage) {
      const double cathode = slow.cathode[static_cast<std::size_t>(stage)].voltage;
      const double plate = fast.stage[static_cast<std::size_t>(stage)].plateVoltage;
      const double vak = plate - cathode;
      if (cathode < -100.0 || cathode > 300.0 || plate < -100.0 || plate > 600.0 || vak < -100.0 ||
          vak > 600.0) {
        return false;
      }
    }
    return true;
  }

  void restorePhysicalChannel(int channel) noexcept {
    fast_[channel] = recovery_fast_[channel];
    slow_[channel] = recovery_slow_[channel];
    accumulator_[channel] = SlowAccumulator{};
  }

#if ET_TUBE_SIMULATOR_TEST_STATE
  void beginFastKclStepForTesting(std::uint32_t internal_index, std::uint32_t host_frame) noexcept {
    current_fast_kcl_host_frame_for_testing_ =
        processed_host_frames_ + static_cast<std::uint64_t>(host_frame);
    current_fast_kcl_internal_frame_for_testing_ =
        processed_host_frames_ * static_cast<std::uint64_t>(rate_config_.factor) +
        static_cast<std::uint64_t>(internal_index);
    current_fast_kcl_internal_phase_for_testing_ =
        internal_index % static_cast<std::uint32_t>(rate_config_.factor);
  }

  void observeFastKclForTesting(double residual, FastKclNode node, int channel) noexcept {
    const double magnitude = absolute(residual);
    if (magnitude <= maximum_fast_kcl_for_testing_.residual) {
      return;
    }
    maximum_fast_kcl_for_testing_.residual = magnitude;
    maximum_fast_kcl_for_testing_.node = node;
    maximum_fast_kcl_for_testing_.channel = static_cast<std::uint32_t>(channel);
    maximum_fast_kcl_for_testing_.hostFrame = current_fast_kcl_host_frame_for_testing_;
    maximum_fast_kcl_for_testing_.internalFrame = current_fast_kcl_internal_frame_for_testing_;
    maximum_fast_kcl_for_testing_.internalPhase = current_fast_kcl_internal_phase_for_testing_;
  }

  void observeSecondStageGridForTesting(double vgk, double grid_current) noexcept {
    if (!line_design_observation_enabled_for_testing_) {
      return;
    }
    if (grid_current > second_stage_grid_current_peak_for_testing_) {
      second_stage_grid_current_peak_for_testing_ = grid_current;
    }
    if (vgk >= kGridOn) {
      ++second_stage_grid_conduction_steps_for_testing_;
    }
    ++second_stage_grid_total_steps_for_testing_;
  }
#endif

  // Driver output half. The second stage is driven by the first stage's plate through the
  // one-sample-delayed Thevenin coupling, and the output coupling capacitor hangs off the second
  // plate, so every quantity below is fixed by state that is already settled when the sample
  // begins - the value returned here does not depend on this sample's input at all. Evaluating it
  // before the feedback compensator is therefore not a prediction: it is the same closed-form
  // companion solve the phase inverter uses, with the current-sample sensitivity of the detector
  // to the compensator output identically zero. That is what lets the Power branch close its loop
  // on this sample's tap instead of the previous one.
  [[nodiscard]] double advanceDriverOutput(int channel) noexcept {
    step_safety_hit_ = false;
    FastChannel &fast = fast_[channel];
    SlowState &slow = slow_[channel];
    // The output half runs first in the sample, so the ramps advance here and the input half
    // reads the same values.
    advanceRamp(slow.cathodeRamp[0]);
    advanceRamp(slow.cathodeRamp[1]);
    advanceRamp(slow.supplyRamp);
    DriverSplit &split = driver_split_[channel];
    const double delayed_plate1 = fast.stage[0].plateVoltage;
    const double delayed_resistance1 = fast.stage[0].outputResistance;
    const double delayed_output_load_current = fast.outputLoadCurrent;
    const StageResult second =
        advanceStage(1, fast.stage[1], delayed_plate1, delayed_resistance1, slow.supplyRamp.applied,
                     slow.cathodeRamp[1].applied, delayed_output_load_current);
#if ET_TUBE_SIMULATOR_TEST_STATE
    observeFastKclForTesting(second.maximumPhysicalKcl, second.maximumPhysicalKclNode, channel);
    observeSecondStageGridForTesting(fast.stage[1].gridVoltage - slow.cathodeRamp[1].applied,
                                     second.gridCurrent);
#endif
    const double old_output_charge = fast.outputCouplingCharge;
    const double output_denominator =
        1.0 + rate_config_.fastDt / (kOutputCapacitance * kOutputLoadResistance);
    const double output = safetyBound(
        (fast.stage[1].plateVoltage - old_output_charge / kOutputCapacitance) / output_denominator,
        -kMaximumOutputVoltage, kMaximumOutputVoltage);
    fast.outputCouplingCharge = safetyBound(
        fast.outputCouplingCharge + rate_config_.fastDt * output / kOutputLoadResistance,
        -kOutputCapacitance * kMaximumCouplingEquivalentVoltage,
        kOutputCapacitance * kMaximumCouplingEquivalentVoltage);
    fast.outputLoadCurrent = output / kOutputLoadResistance;
    split.iCout = (fast.outputCouplingCharge - old_output_charge) / rate_config_.fastDt;
#if ET_TUBE_SIMULATOR_TEST_STATE
    observeFastKclForTesting(split.iCout - fast.outputLoadCurrent, FastKclNode::output, channel);
#endif
    split.second = second;
    return output;
  }

  // Driver input half: the first stage, the shared supply and cathode accumulators, and the
  // per-sample validity checks. Splitting the channel here changes only the order in which the two
  // stages are evaluated; neither reads anything the other writes within a sample, so every
  // committed value is bit-for-bit what the single-pass form produced.
  [[nodiscard]] bool advanceDriverInput(int channel, double input) noexcept {
    FastChannel &fast = fast_[channel];
    const SlowState &slow = slow_[channel];
    const DriverSplit &split = driver_split_[channel];
    const StageResult first =
        advanceStage(0, fast.stage[0], input, source_resistance_, slow.supplyRamp.applied,
                     slow.cathodeRamp[0].applied, 0.0);
#if ET_TUBE_SIMULATOR_TEST_STATE
    observeFastKclForTesting(first.maximumPhysicalKcl, first.maximumPhysicalKclNode, channel);
#endif
    const double i_ra1 =
        first.plateCurrent - first.iCga + first.iCak + split.second.couplingCurrent;
    const double i_ra2 =
        split.second.plateCurrent - split.second.iCga + split.second.iCak + split.iCout;
    updateSlow(channel, i_ra1, i_ra2, first, split.second);

    if (!finitePhysicalChannel(channel)) {
      ++finite_faults_;
      block_finite_fault_ = true;
      restorePhysicalChannel(channel);
      return false;
    }
    if (!physicalRangesValid(channel)) {
      ++safety_limits_;
      step_safety_hit_ = true;
    }
    if (step_safety_hit_) {
      block_safety_hit_ = true;
      restorePhysicalChannel(channel);
      return false;
    }

    last_plate_current_[channel][0] = first.plateCurrent;
    last_plate_current_[channel][1] = split.second.plateCurrent;
    return true;
  }

  [[nodiscard]] double advanceChannel(int channel, double input) noexcept {
    const double output = advanceDriverOutput(channel);
    // The driver plate voltage leaves this function in volts. runFastCore applies the Line
    // headroom scale on the Line branch only; the Power phase inverter needs real volts.
    return advanceDriverInput(channel, input) ? output : 0.0;
  }

#if ET_TUBE_HAS_F64X2
  [[nodiscard]] GridEvaluationPair evaluateGridPair(StereoPair vgk) const noexcept {
    const GridEvaluation left = evaluateGrid(vgk[0]);
    const GridEvaluation right = evaluateGrid(vgk[1]);
    return {StereoPair{left.current, right.current}, StereoPair {
              left.derivative,
              right.derivative
            }};
  }

  [[nodiscard]] PlateEvaluationPair evaluatePlatePair(StereoPair vgk,
                                                      StereoPair vak) const noexcept {
    const PlateEvaluation left = evaluatePlate(vgk[0], vak[0]);
    const PlateEvaluation right = evaluatePlate(vgk[1], vak[1]);
    return {StereoPair{left.current, right.current},
            StereoPair{left.gridDerivative, right.gridDerivative}, StereoPair {
              left.plateDerivative,
              right.plateDerivative
            }};
  }

  [[nodiscard]] static StereoPair clampPair(StereoPair value, StereoPair low,
                                            StereoPair high) noexcept {
    for (int lane = 0; lane < kChannels; ++lane) {
      value[lane] = clampValue(value[lane], low[lane], high[lane]);
    }
    return value;
  }

  [[nodiscard]] StereoPair safetyBoundPair(StereoPair value, double low, double high,
                                           std::array<bool, kChannels> &safety_hit) noexcept {
    for (int lane = 0; lane < kChannels; ++lane) {
      if (value[lane] < low) {
        ++safety_limits_;
        safety_hit[static_cast<std::size_t>(lane)] = true;
        value[lane] = low;
      } else if (value[lane] > high) {
        ++safety_limits_;
        safety_hit[static_cast<std::size_t>(lane)] = true;
        value[lane] = high;
      }
    }
    return value;
  }

  [[nodiscard]] StageResultPair advanceStagePair(int stage_index, StereoPair source_voltage,
                                                 StereoPair source_resistance, StereoPair delayed_p,
                                                 StereoPair vk,
                                                 StereoPair delayed_output_load_current,
                                                 std::array<bool, kChannels> &safety_hit) noexcept {
    StereoPair old_charge;
    StereoPair miller_voltage;
    StereoPair miller_capacitance;
    StereoPair local_plate_gain;
    StereoPair previous_vak;
    for (int lane = 0; lane < kChannels; ++lane) {
      const FastStage &stage = fast_[lane].stage[static_cast<std::size_t>(stage_index)];
      old_charge[lane] = stage.couplingCharge;
      miller_voltage[lane] = stage.millerVoltage;
      miller_capacitance[lane] = stage.millerCapacitance;
      local_plate_gain[lane] = stage.localPlateGain;
      previous_vak[lane] = stage.previousVak;
    }

    const StereoPair cm = safetyBoundPair(miller_capacitance, kMinimumMillerCapacitance,
                                          kMaximumMillerCapacitance, safety_hit);
    const StereoPair miller_conductance = cm / rate_config_.fastDt;
    const StereoPair series_resistance =
        source_resistance + rate_config_.fastDt / kCouplingCapacitance;
    const StereoPair passive_numerator = source_voltage - old_charge / kCouplingCapacitance +
                                         series_resistance * miller_conductance * miller_voltage;
    const StereoPair passive_denominator =
        1.0 + series_resistance * (1.0 / kGridLeakResistance + miller_conductance);
    const StereoPair passive_grid = passive_numerator / passive_denominator;
    const StereoPair passive_vgk = passive_grid - vk;
    const StereoPair lambda = series_resistance / passive_denominator;
    const GridEvaluationPair upper = evaluateGridPair(passive_vgk);
    StereoPair lower_vgk = passive_vgk - lambda * upper.current;
    StereoPair predictor_vgk = passive_vgk;
    for (int lane = 0; lane < kChannels; ++lane) {
      if (passive_vgk[lane] > kGridOn - 2.0 && lower_vgk[lane] < kGridOn - 2.0) {
        lower_vgk[lane] = kGridOn - 2.0;
      }
      const double overdrive = passive_vgk[lane] - kGridOn;
      if (overdrive > 0.0 && lambda[lane] * upper.current[lane] > 1e-18) {
        const double loading = lambda[lane] * kGridK * std::sqrt(overdrive);
        predictor_vgk[lane] =
            kGridOn + overdrive * polynomialPowPositive(1.0 + 1.5 * loading, -2.0 / 3.0);
      }
    }
    predictor_vgk = clampPair(predictor_vgk, lower_vgk, passive_vgk);
    const StereoPair physical_residual_scale = passive_denominator / source_resistance;
    StereoPair vgk = predictor_vgk;
    GridEvaluationPair grid = evaluateGridPair(vgk);
    StereoPair grid_equation_residual = vgk + lambda * grid.current - passive_vgk;
    for (int correction = 0; correction < kGridMaximumNewtonCorrections; ++correction) {
      bool needs_correction = false;
      for (int lane = 0; lane < kChannels; ++lane) {
        if (absolute(physical_residual_scale[lane] * grid_equation_residual[lane]) <=
            kGridFastPathResidualTolerance) {
          continue;
        }
        vgk[lane] -= grid_equation_residual[lane] / (1.0 + lambda[lane] * grid.derivative[lane]);
        vgk[lane] = clampValue(vgk[lane], lower_vgk[lane], passive_vgk[lane]);
        needs_correction = true;
      }
      if (!needs_correction) {
        break;
      }
      grid = evaluateGridPair(vgk);
      grid_equation_residual = vgk + lambda * grid.current - passive_vgk;
    }
    for (int lane = 0; lane < kChannels; ++lane) {
      double absolute_grid_residual =
          absolute(physical_residual_scale[lane] * grid_equation_residual[lane]);
      if (absolute_grid_residual <= kGridFastPathResidualTolerance) {
        continue;
      }
      double fallback_low = lower_vgk[lane];
      double fallback_high = passive_vgk[lane];
#if ET_TUBE_SIMULATOR_TEST_STATE
      int fallback_iterations_for_testing = 0;
#endif
      for (int iteration = 0; iteration < kGridFallbackMaximumIterations &&
                              absolute_grid_residual > kGridFallbackResidualTolerance;
           ++iteration) {
#if ET_TUBE_SIMULATOR_TEST_STATE
        ++fallback_iterations_for_testing;
#endif
        vgk[lane] = 0.5 * (fallback_low + fallback_high);
        const GridEvaluation lane_grid = evaluateGrid(vgk[lane]);
        grid.current[lane] = lane_grid.current;
        grid.derivative[lane] = lane_grid.derivative;
        grid_equation_residual[lane] =
            vgk[lane] + lambda[lane] * lane_grid.current - passive_vgk[lane];
        if (grid_equation_residual[lane] > 0.0) {
          fallback_high = vgk[lane];
        } else {
          fallback_low = vgk[lane];
        }
        absolute_grid_residual =
            absolute(physical_residual_scale[lane] * grid_equation_residual[lane]);
      }
#if ET_TUBE_SIMULATOR_TEST_STATE
      ++grid_fallback_iteration_histogram_for_testing_[static_cast<std::size_t>(
          fallback_iterations_for_testing)];
#endif
      if (absolute_grid_residual > kGridFallbackResidualTolerance) {
        ++safety_limits_;
        safety_hit[static_cast<std::size_t>(lane)] = true;
      }
    }
    const StereoPair grid_voltage =
        safetyBoundPair(vgk + vk, -kMaximumGridVoltage, kMaximumGridVoltage, safety_hit);
    vgk = grid_voltage - vk;
    grid = evaluateGridPair(vgk);
    const StereoPair i_m = miller_conductance * (grid_voltage - miller_voltage);
    const StereoPair series_current = grid_voltage / kGridLeakResistance + grid.current + i_m;
    const StereoPair next_charge =
        safetyBoundPair(old_charge + rate_config_.fastDt * series_current,
                        -kCouplingCapacitance * kMaximumCouplingEquivalentVoltage,
                        kCouplingCapacitance * kMaximumCouplingEquivalentVoltage, safety_hit);

    const PlateEvaluationPair plate_predictor = evaluatePlatePair(vgk, previous_vak);
    const StereoPair plate_denominator = 1.0 + plate_resistance_ * plate_predictor.plateDerivative;
    StereoPair vak = (delayed_p - vk -
                      plate_resistance_ * (plate_predictor.current -
                                           plate_predictor.plateDerivative * previous_vak +
                                           delayed_output_load_current)) /
                     plate_denominator;
    PlateEvaluationPair plate = evaluatePlatePair(vgk, vak);
    for (int lane = 0; lane < kChannels; ++lane) {
      double lane_vak = vak[lane];
      PlateEvaluation lane_plate = {plate.current[lane], plate.gridDerivative[lane],
                                    plate.plateDerivative[lane]};
      refinePlateCandidateOnce(vgk[lane], delayed_p[lane], vk[lane],
                               delayed_output_load_current[lane], lane_vak, lane_plate);
      vak[lane] = lane_vak;
      plate.current[lane] = lane_plate.current;
      plate.gridDerivative[lane] = lane_plate.gridDerivative;
      plate.plateDerivative[lane] = lane_plate.plateDerivative;
      if (plateCandidateNeedsFallback(vak[lane], lane_plate, delayed_p[lane], vk[lane],
                                      delayed_output_load_current[lane])) {
        const PlateSolveResult fallback =
            solvePlateFallback(vgk[lane], delayed_p[lane], vk[lane],
                               delayed_output_load_current[lane], vak[lane], lane_plate);
        if (fallback.converged) {
          vak[lane] = fallback.vak;
          plate.current[lane] = fallback.plate.current;
          plate.gridDerivative[lane] = fallback.plate.gridDerivative;
          plate.plateDerivative[lane] = fallback.plate.plateDerivative;
#if ET_TUBE_SIMULATOR_TEST_STATE
          ++plate_fallback_successes_for_testing_;
#endif
        } else {
          ++safety_limits_;
          safety_hit[static_cast<std::size_t>(lane)] = true;
        }
      }
    }
    const StereoPair plate_voltage = vak + vk;
    const StereoPair derivative_denominator = 1.0 + plate_resistance_ * plate.plateDerivative;
    const StereoPair local_gain =
        safetyBoundPair(-plate_resistance_ * plate.gridDerivative / derivative_denominator,
                        kMinimumLocalPlateGain, kMaximumLocalPlateGain, safety_hit);
    const StereoPair next_cm =
        safetyBoundPair(activeTube().cgk + activeTube().cga * (1.0 - local_gain),
                        kMinimumMillerCapacitance, kMaximumMillerCapacitance, safety_hit);
    const StereoPair i_cgk = activeTube().cgk / cm * i_m;
    const StereoPair i_cga = activeTube().cga * (1.0 - local_plate_gain) / cm * i_m;
    const StereoPair i_cak = activeTube().cak * (vak - previous_vak) / rate_config_.fastDt;
    const StereoPair coupling_current = (next_charge - old_charge) / rate_config_.fastDt;
    StereoPair maximum_physical_kcl;
    std::array<FastKclNode, kChannels> maximum_physical_kcl_node{};
    for (int lane = 0; lane < kChannels; ++lane) {
      FastStage &stage = fast_[lane].stage[static_cast<std::size_t>(stage_index)];
      stage.gridVoltage = grid_voltage[lane];
      stage.plateVoltage = plate_voltage[lane];
      stage.couplingCharge = next_charge[lane];
      stage.millerVoltage = grid_voltage[lane];
      stage.millerCapacitance = next_cm[lane];
      stage.localPlateGain = local_gain[lane];
      stage.outputResistance = plate_resistance_ / derivative_denominator[lane];
      stage.previousVak = vak[lane];
      const double source_branch_current =
          (source_voltage[lane] - stage.gridVoltage - stage.couplingCharge / kCouplingCapacitance) /
          source_resistance[lane];
      const double committed_series_current =
          stage.gridVoltage / kGridLeakResistance + grid.current[lane] + i_m[lane];
      const double grid_residual =
          absolute(source_branch_current - stage.gridVoltage / kGridLeakResistance -
                   grid.current[lane] - i_m[lane]);
      const double coupling_residual = absolute(coupling_current[lane] - committed_series_current);
      const double miller_split_residual = absolute(i_m[lane] - i_cgk[lane] - i_cga[lane]);
      const double plate_residual =
          absolute((delayed_p[lane] - stage.plateVoltage) / plate_resistance_ -
                   plate.current[lane] - delayed_output_load_current[lane]);
      const FastKclNode grid_node =
          stage_index == 0 ? FastKclNode::stage1Grid : FastKclNode::stage2Grid;
      const FastKclNode coupling_node =
          stage_index == 0 ? FastKclNode::stage1Coupling : FastKclNode::stage2Coupling;
      const FastKclNode miller_node =
          stage_index == 0 ? FastKclNode::stage1Miller : FastKclNode::stage2Miller;
      const FastKclNode plate_node =
          stage_index == 0 ? FastKclNode::stage1Plate : FastKclNode::stage2Plate;
      double maximum = grid_residual;
      FastKclNode maximum_node = grid_node;
      if (coupling_residual > maximum) {
        maximum = coupling_residual;
        maximum_node = coupling_node;
      }
      if (miller_split_residual > maximum) {
        maximum = miller_split_residual;
        maximum_node = miller_node;
      }
      if (plate_residual > maximum) {
        maximum = plate_residual;
        maximum_node = plate_node;
      }
      maximum_physical_kcl[lane] = maximum;
      maximum_physical_kcl_node[static_cast<std::size_t>(lane)] = maximum_node;
    }
    return {plate.current,
            grid.current,
            i_cgk,
            i_cga,
            i_cak,
            coupling_current,
            maximum_physical_kcl,
            maximum_physical_kcl_node};
  }

  // Vector form of the driver output half; see advanceDriverOutput for why the value it returns
  // carries no dependence on this sample's input.
  [[nodiscard]] StereoPair advanceStereoOutput() noexcept {
    StereoSplit &split = stereo_split_;
    split.safetyHit = {};
    StereoPair delayed_plate1;
    StereoPair delayed_resistance1;
    StereoPair delayed_output_load_current;
    StereoPair old_output_charge;
    StereoPair delayed_p;
    StereoPair vk2;
    for (int lane = 0; lane < kChannels; ++lane) {
      FastChannel &fast = fast_[lane];
      SlowState &slow = slow_[lane];
      advanceRamp(slow.cathodeRamp[0]);
      advanceRamp(slow.cathodeRamp[1]);
      advanceRamp(slow.supplyRamp);
      delayed_plate1[lane] = fast.stage[0].plateVoltage;
      delayed_resistance1[lane] = fast.stage[0].outputResistance;
      delayed_output_load_current[lane] = fast.outputLoadCurrent;
      delayed_p[lane] = slow.supplyRamp.applied;
      vk2[lane] = slow.cathodeRamp[1].applied;
      split.delayedP[static_cast<std::size_t>(lane)] = slow.supplyRamp.applied;
      split.vk1[static_cast<std::size_t>(lane)] = slow.cathodeRamp[0].applied;
      split.vk2[static_cast<std::size_t>(lane)] = slow.cathodeRamp[1].applied;
      old_output_charge[lane] = fast.outputCouplingCharge;
    }
    const StageResultPair second =
        advanceStagePair(1, delayed_plate1, delayed_resistance1, delayed_p, vk2,
                         delayed_output_load_current, split.safetyHit);
#if ET_TUBE_SIMULATOR_TEST_STATE
    for (int lane = 0; lane < kChannels; ++lane) {
      observeFastKclForTesting(second.maximumPhysicalKcl[lane],
                               second.maximumPhysicalKclNode[static_cast<std::size_t>(lane)], lane);
      observeSecondStageGridForTesting(fast_[lane].stage[1].gridVoltage - vk2[lane],
                                       second.gridCurrent[lane]);
    }
#endif

    const double output_denominator =
        1.0 + rate_config_.fastDt / (kOutputCapacitance * kOutputLoadResistance);
    StereoPair second_plate_voltage;
    for (int lane = 0; lane < kChannels; ++lane) {
      second_plate_voltage[lane] = fast_[lane].stage[1].plateVoltage;
    }
    const StereoPair output = safetyBoundPair(
        (second_plate_voltage - old_output_charge / kOutputCapacitance) / output_denominator,
        -kMaximumOutputVoltage, kMaximumOutputVoltage, split.safetyHit);
    const StereoPair next_output_charge =
        safetyBoundPair(old_output_charge + rate_config_.fastDt * output / kOutputLoadResistance,
                        -kOutputCapacitance * kMaximumCouplingEquivalentVoltage,
                        kOutputCapacitance * kMaximumCouplingEquivalentVoltage, split.safetyHit);
    const StereoPair output_load_current = output / kOutputLoadResistance;
    const StereoPair i_cout = (next_output_charge - old_output_charge) / rate_config_.fastDt;
    for (int lane = 0; lane < kChannels; ++lane) {
      const std::size_t slot = static_cast<std::size_t>(lane);
      split.iCout[slot] = i_cout[lane];
      split.second[slot] = {second.plateCurrent[lane],
                            second.gridCurrent[lane],
                            second.iCgk[lane],
                            second.iCga[lane],
                            second.iCak[lane],
                            second.couplingCurrent[lane],
                            second.maximumPhysicalKcl[lane],
                            second.maximumPhysicalKclNode[slot]};
      fast_[lane].outputCouplingCharge = next_output_charge[lane];
      fast_[lane].outputLoadCurrent = output_load_current[lane];
#if ET_TUBE_SIMULATOR_TEST_STATE
      const double output_residual = i_cout[lane] - fast_[lane].outputLoadCurrent;
      observeFastKclForTesting(output_residual, FastKclNode::output, lane);
#endif
    }
    return output;
  }

  // Vector form of the driver input half. Returns the per-lane validity of the sample.
  [[nodiscard]] std::array<bool, kChannels> advanceStereoInput(StereoPair input) noexcept {
    StereoSplit &split = stereo_split_;
    const StereoPair first_source_resistance = {source_resistance_, source_resistance_};
    const StereoPair zero = {0.0, 0.0};
    StereoPair delayed_p;
    StereoPair vk1;
    for (int lane = 0; lane < kChannels; ++lane) {
      delayed_p[lane] = split.delayedP[static_cast<std::size_t>(lane)];
      vk1[lane] = split.vk1[static_cast<std::size_t>(lane)];
    }
    const StageResultPair first =
        advanceStagePair(0, input, first_source_resistance, delayed_p, vk1, zero, split.safetyHit);
#if ET_TUBE_SIMULATOR_TEST_STATE
    for (int lane = 0; lane < kChannels; ++lane) {
      observeFastKclForTesting(first.maximumPhysicalKcl[lane],
                               first.maximumPhysicalKclNode[static_cast<std::size_t>(lane)], lane);
    }
#endif
    std::array<bool, kChannels> valid{};
    for (int lane = 0; lane < kChannels; ++lane) {
      const std::size_t slot = static_cast<std::size_t>(lane);
      const StageResult first_lane = {first.plateCurrent[lane],
                                      first.gridCurrent[lane],
                                      first.iCgk[lane],
                                      first.iCga[lane],
                                      first.iCak[lane],
                                      first.couplingCurrent[lane],
                                      first.maximumPhysicalKcl[lane],
                                      first.maximumPhysicalKclNode[slot]};
      const StageResult &second_lane = split.second[slot];
      const double i_ra1 =
          first_lane.plateCurrent - first_lane.iCga + first_lane.iCak + second_lane.couplingCurrent;
      const double i_ra2 =
          second_lane.plateCurrent - second_lane.iCga + second_lane.iCak + split.iCout[slot];
      updateSlow(lane, i_ra1, i_ra2, first_lane, second_lane);

      if (!finitePhysicalChannel(lane)) {
        ++finite_faults_;
        block_finite_fault_ = true;
        restorePhysicalChannel(lane);
        continue;
      }
      if (!physicalRangesValid(lane)) {
        ++safety_limits_;
        split.safetyHit[static_cast<std::size_t>(lane)] = true;
      }
      if (split.safetyHit[static_cast<std::size_t>(lane)]) {
        block_safety_hit_ = true;
        restorePhysicalChannel(lane);
        continue;
      }
      last_plate_current_[lane][0] = first_lane.plateCurrent;
      last_plate_current_[lane][1] = second_lane.plateCurrent;
      valid[slot] = true;
    }
    return valid;
  }

  [[nodiscard]] StereoPair advanceStereo(StereoPair input) noexcept {
    StereoPair output = advanceStereoOutput();
    const std::array<bool, kChannels> valid = advanceStereoInput(input);
    for (int lane = 0; lane < kChannels; ++lane) {
      if (!valid[static_cast<std::size_t>(lane)]) {
        output[lane] = 0.0;
      }
    }
    return output;
  }
#endif

  [[nodiscard]] bool useSimdPath() const noexcept {
#if defined(ET_SIMD) && ET_TUBE_HAS_F64X2
    return true;
#elif defined(ET_TUBE_SIMULATOR_NATIVE_TEST) && ET_TUBE_HAS_F64X2
    return use_simd_for_testing_;
#else
    return false;
#endif
  }

  [[nodiscard]] double applyFeedbackFilter(int channel, double input, double q,
                                           double plate_reference) noexcept {
    FeedbackFilterState &state = feedback_filter_[channel];
    if (q == 0.0) {
      if (!state.identityDrained) {
        state.s1 = 0.0;
        state.s2 = 0.0;
        state.identityDrained = true;
      }
      return input;
    }
    state.identityDrained = false;
    const double detected =
        state.transport[static_cast<std::size_t>(state.transportIndex)] - plate_reference;
    const double error = input - controls_.feedbackBeta * detected;
    const double output = controls_.feedbackB0 * error + state.s1;
    state.s1 = controls_.feedbackB1 * error - controls_.feedbackA1 * output + state.s2;
    state.s2 = -controls_.feedbackA2 * output;
    return output;
  }

  void observeFeedbackSignal(int channel, double q) noexcept {
    if (q == 0.0) {
      return;
    }
    FeedbackFilterState &state = feedback_filter_[channel];
    state.transport[0] = applied_parameters_.outputStage == 0 ? fast_[channel].stage[1].plateVoltage
                                                              : power_state_[channel].feedbackV;
  }

  [[nodiscard]] const FeedbackDetectorProfile &feedbackDetectorProfile() const noexcept {
    return applied_parameters_.outputStage == 0 ? kLineFeedbackDetectorProfile
                                                : kPowerFeedbackDetectorProfile;
  }

  void resetDetector() noexcept {
    detector_input_energy_ = 0.0;
    detector_output_energy_ = 0.0;
    detector_feedback_energy_ = 0.0;
    detector_previous_input_rms_ = 0.0;
    detector_previous_output_rms_ = 0.0;
    detector_previous_feedback_rms_ = 0.0;
    detector_samples_ = 0u;
    detector_driven_growth_windows_ = 0u;
    detector_post_input_nondecay_windows_ = 0u;
    detector_has_previous_ = false;
    detector_sustained_input_energy_ = 0.0;
    detector_sustained_output_energy_ = 0.0;
    detector_sustained_feedback_energy_ = 0.0;
    detector_sustained_previous_input_rms_ = 0.0;
    detector_sustained_previous_output_rms_ = 0.0;
    detector_sustained_previous_feedback_rms_ = 0.0;
    detector_sustained_span_ = 0u;
    detector_sustained_has_previous_ = false;
  }

  void latchRuntimeFault(std::uint32_t cause, std::uint32_t host_frame_offset = 0u) noexcept {
    if (runtime_event_.cause == kRuntimeCauseProcessingSafetyFailure) {
      return;
    }
    if (cause == kRuntimeCauseProcessingSafetyFailure) {
      if (runtime_event_.latched == 0u ||
          runtime_event_.cause != kRuntimeCauseProcessingSafetyFailure) {
        runtime_event_.latched = 1u;
        runtime_event_.cause = kRuntimeCauseProcessingSafetyFailure;
        ++runtime_event_.generation;
      }
      fault_state_ = FaultState::latchedSafeBypass;
      fault_wet_current_ = 0.0;
      fault_mute_remaining_ = 0u;
      fault_trial_remaining_ = 0u;
      fault_return_remaining_ = 0u;
      fault_clear_pending_ = false;
      fault_reset_pending_ = false;
      pending_fault_parameter_commit_ = false;
      trial_after_fault_reset_ = false;
      cancelFeedbackTransition();
      return;
    }

    const bool first_feedback_detection = runtime_event_.latched == 0u;
    if (first_feedback_detection) {
      runtime_event_.latched = 1u;
      runtime_event_.cause = kRuntimeCauseFeedbackOscillation;
      ++runtime_event_.generation;
    }
    if (block_feedback_detection_offset_ == std::numeric_limits<std::uint32_t>::max()) {
      if (feedback_transition_.phase != FeedbackTransitionPhase::inactive) {
        if (pending_transition_parameters_valid_) {
          pending_fault_parameters_ = pending_transition_parameters_;
          pending_fault_parameter_commit_ = true;
        } else if (queued_transition_parameters_valid_) {
          pending_fault_parameters_ = queued_transition_parameters_;
          pending_fault_parameter_commit_ = true;
        }
        cancelFeedbackTransition();
      }
      block_feedback_detection_offset_ = host_frame_offset;
      if (first_feedback_detection) {
        detection_frame_for_testing_ = processed_host_frames_ + host_frame_offset;
      }
    }
  }

  bool evaluateFeedbackDetectorWindow(double input_rms, double output_rms, double feedback_rms,
                                      std::uint32_t host_frame_offset) noexcept {
#if ET_TUBE_SIMULATOR_TEST_STATE
    if (input_rms > maximum_detector_input_rms_for_testing_) {
      maximum_detector_input_rms_for_testing_ = input_rms;
    }
    if (output_rms > maximum_detector_output_rms_for_testing_) {
      maximum_detector_output_rms_for_testing_ = output_rms;
    }
    if (feedback_rms > maximum_detector_feedback_rms_for_testing_) {
      maximum_detector_feedback_rms_for_testing_ = feedback_rms;
    }
#endif
#if ET_TUBE_SIMULATOR_TEST_STATE
    const bool had_previous = detector_has_previous_;
    const double previous_input_rms = detector_previous_input_rms_;
    const double previous_output_rms = detector_previous_output_rms_;
    const double previous_feedback_rms = detector_previous_feedback_rms_;
#endif
    const FeedbackDetectorProfile &profile = feedbackDetectorProfile();
    const bool ratios_available = detector_has_previous_ && detector_previous_output_rms_ > 0.0 &&
                                  detector_previous_feedback_rms_ > 0.0;
    const bool output_growing =
        ratios_available && output_rms / detector_previous_output_rms_ >= kFeedbackGrowthRatio &&
        output_rms * detector_previous_input_rms_ >=
            kFeedbackGrowthRatio * detector_previous_output_rms_ * input_rms;
    const bool feedback_growing =
        ratios_available &&
        feedback_rms / detector_previous_feedback_rms_ >= kFeedbackGrowthRatio &&
        feedback_rms * detector_previous_input_rms_ >=
            kFeedbackGrowthRatio * detector_previous_feedback_rms_ * input_rms;
    const bool growth_qualifies = output_rms >= profile.growthOutputRms &&
                                  feedback_rms >= profile.growthFeedbackRms && output_growing &&
                                  feedback_growing;
    detector_driven_growth_windows_ = growth_qualifies ? detector_driven_growth_windows_ + 1u : 0u;
    detector_previous_input_rms_ = input_rms;
    detector_previous_output_rms_ = output_rms;
    detector_previous_feedback_rms_ = feedback_rms;
    detector_has_previous_ = true;

    // The post-input branch runs on the coarse window of the stage's profile.
    // A span of one leaves every quantity below equal to the 10 ms window it was
    // accumulated from - sqrt(x * x) is exactly x for every finite double - so
    // the line stage keeps the behaviour it was calibrated for, bit for bit.
    detector_sustained_input_energy_ += input_rms * input_rms;
    detector_sustained_output_energy_ += output_rms * output_rms;
    detector_sustained_feedback_energy_ += feedback_rms * feedback_rms;
    ++detector_sustained_span_;
    bool input_stopped = false;
    bool input_not_growing = false;
    bool input_not_driving = false;
    bool output_not_decaying = false;
    bool feedback_not_decaying = false;
    bool sustained_levels = false;
    bool sustained_qualifies = false;
    if (detector_sustained_span_ >= profile.sustainedWindowSpan) {
      const double span = static_cast<double>(detector_sustained_span_);
      const double coarse_input_rms = std::sqrt(detector_sustained_input_energy_ / span);
      const double coarse_output_rms = std::sqrt(detector_sustained_output_energy_ / span);
      const double coarse_feedback_rms = std::sqrt(detector_sustained_feedback_energy_ / span);
      const bool coarse_ratios_available = detector_sustained_has_previous_ &&
                                           detector_sustained_previous_output_rms_ > 0.0 &&
                                           detector_sustained_previous_feedback_rms_ > 0.0;
      input_stopped = coarse_input_rms == 0.0;
      input_not_growing = detector_sustained_has_previous_ &&
                          (detector_sustained_previous_input_rms_ == 0.0
                               ? input_stopped
                               : coarse_input_rms / detector_sustained_previous_input_rms_ <= 1.0);
      // Written as a product rather than a quotient so that a silent window,
      // where both sides are zero, is decided the same way as every other one
      // and never forms 0/0.
      input_not_driving =
          profile.sustainedDriveRatio > 0.0
              ? coarse_feedback_rms >= profile.sustainedDriveRatio * coarse_input_rms
              : input_stopped && input_not_growing;
      output_not_decaying =
          coarse_ratios_available &&
          coarse_output_rms / detector_sustained_previous_output_rms_ >= kFeedbackNonDecayRatio;
      feedback_not_decaying =
          coarse_ratios_available &&
          coarse_feedback_rms / detector_sustained_previous_feedback_rms_ >= kFeedbackNonDecayRatio;
      sustained_levels = coarse_output_rms >= profile.sustainedOutputRms &&
                         coarse_feedback_rms >= profile.sustainedFeedbackRms;
      sustained_qualifies =
          sustained_levels && input_not_driving && output_not_decaying && feedback_not_decaying;
      detector_post_input_nondecay_windows_ =
          sustained_qualifies ? detector_post_input_nondecay_windows_ + 1u : 0u;
      detector_sustained_previous_input_rms_ = coarse_input_rms;
      detector_sustained_previous_output_rms_ = coarse_output_rms;
      detector_sustained_previous_feedback_rms_ = coarse_feedback_rms;
      detector_sustained_has_previous_ = true;
      detector_sustained_input_energy_ = 0.0;
      detector_sustained_output_energy_ = 0.0;
      detector_sustained_feedback_energy_ = 0.0;
      detector_sustained_span_ = 0u;
    }
    const std::uint32_t selected_branch =
        detector_driven_growth_windows_ >= kFeedbackGrowthWindows           ? 1u
        : detector_post_input_nondecay_windows_ >= profile.sustainedWindows ? 2u
                                                                            : 0u;
    const bool detected = selected_branch != 0u;
    if (detected) {
      latchRuntimeFault(kRuntimeCauseFeedbackOscillation, host_frame_offset);
    }
#if ET_TUBE_SIMULATOR_TEST_STATE
    std::uint32_t predicate_bits = ratios_available ? 1u << 0u : 0u;
    predicate_bits |=
        output_rms >= profile.growthOutputRms && feedback_rms >= profile.growthFeedbackRms
            ? 1u << 1u
            : 0u;
    predicate_bits |= sustained_levels ? 1u << 2u : 0u;
    predicate_bits |= input_stopped ? 1u << 3u : 0u;
    predicate_bits |= input_not_growing ? 1u << 4u : 0u;
    predicate_bits |= output_growing ? 1u << 5u : 0u;
    predicate_bits |= feedback_growing ? 1u << 6u : 0u;
    predicate_bits |= output_not_decaying ? 1u << 7u : 0u;
    predicate_bits |= feedback_not_decaying ? 1u << 8u : 0u;
    predicate_bits |= growth_qualifies ? 1u << 9u : 0u;
    predicate_bits |= sustained_qualifies ? 1u << 10u : 0u;
    predicate_bits |= had_previous ? 1u << 11u : 0u;
    predicate_bits |= input_not_driving ? 1u << 12u : 0u;
    const std::uint64_t end_frame = processed_host_frames_ + host_frame_offset + 1u;
    const std::uint64_t window_frames = static_cast<std::uint64_t>(
        std::ceil(prepared_rate_ * kFeedbackDetectorWindowMilliseconds * 0.001));
    const DetectorWindowObservation observation = {
        end_frame >= window_frames ? end_frame - window_frames : 0u,
        end_frame,
        had_previous ? previous_input_rms : 0.0,
        had_previous ? previous_output_rms : 0.0,
        had_previous ? previous_feedback_rms : 0.0,
        input_rms,
        output_rms,
        feedback_rms,
        predicate_bits,
        detector_driven_growth_windows_,
        detector_post_input_nondecay_windows_,
        selected_branch,
        runtime_event_,
        static_cast<std::uint32_t>(fault_state_),
    };
    if (detector_window_trace_for_testing_.size() < kDetectorTraceCapacity &&
        detector_window_trace_for_testing_.size() < detector_window_trace_for_testing_.capacity()) {
      detector_window_trace_for_testing_.push_back(observation);
    } else {
      detector_window_trace_overflow_for_testing_ = true;
    }
#endif
    return detected;
  }

  void observeFeedbackDetector(double input_left, double input_right, double left, double right,
                               double plate_reference, std::uint32_t host_frame_offset) noexcept {
    if ((fault_state_ != FaultState::normal && fault_state_ != FaultState::trial &&
         fault_state_ != FaultState::returning) ||
        block_feedback_detection_offset_ != std::numeric_limits<std::uint32_t>::max()) {
      return;
    }
    const double wet_scale = feedback_makeup_[host_frame_offset] * output_gain_[host_frame_offset];
    const double feedback_left =
        controls_.feedbackBeta * (applied_parameters_.outputStage == 0
                                      ? fast_[0].stage[1].plateVoltage - plate_reference
                                      : power_state_[0].feedbackV);
    const double feedback_right =
        controls_.feedbackBeta * (applied_parameters_.outputStage == 0
                                      ? fast_[1].stage[1].plateVoltage - plate_reference
                                      : power_state_[1].feedbackV);
    detector_input_energy_ += input_left * input_left + input_right * input_right;
    const double wet_left = left * wet_scale;
    const double wet_right = right * wet_scale;
    detector_output_energy_ += wet_left * wet_left + wet_right * wet_right;
    detector_feedback_energy_ += feedback_left * feedback_left + feedback_right * feedback_right;
    ++detector_samples_;
    const std::uint32_t window_samples = static_cast<std::uint32_t>(
        rate_config_.internalRate * kFeedbackDetectorWindowMilliseconds * 0.001);
    if (detector_samples_ < window_samples) {
      return;
    }
    const double denominator = 2.0 * static_cast<double>(detector_samples_);
    const double input_rms = std::sqrt(detector_input_energy_ / denominator);
    const double output_rms = std::sqrt(detector_output_energy_ / denominator);
    const double feedback_rms = std::sqrt(detector_feedback_energy_ / denominator);
    static_cast<void>(
        evaluateFeedbackDetectorWindow(input_rms, output_rms, feedback_rms, host_frame_offset));
    detector_input_energy_ = 0.0;
    detector_output_energy_ = 0.0;
    detector_feedback_energy_ = 0.0;
    detector_samples_ = 0u;
  }

  void clearFeedbackFault() noexcept {
    runtime_event_.latched = 0u;
    runtime_event_.cause = kRuntimeCauseNone;
    ++runtime_event_.generation;
    fault_state_ = FaultState::normal;
    fault_wet_current_ = 1.0;
    fault_mute_remaining_ = 0u;
    fault_trial_remaining_ = 0u;
    fault_return_remaining_ = 0u;
    fault_clear_pending_ = false;
    resetDetector();
  }

  void prepareFaultWet(std::uint32_t frame_count, FaultState block_start_state) noexcept {
    FaultState state = block_start_state;
    const std::uint32_t mute_frames = feedbackTransitionFrames();
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      if (frame == block_feedback_detection_offset_) {
        if (state == FaultState::normal) {
          state = FaultState::muting;
          fault_mute_remaining_ = mute_frames + 1u;
        } else if (state == FaultState::trial || state == FaultState::returning) {
          state = FaultState::latchedSafeBypass;
          fault_wet_current_ = 0.0;
          fault_trial_remaining_ = 0u;
          fault_return_remaining_ = 0u;
          fault_clear_pending_ = false;
          fault_reset_pending_ = false;
          trial_after_fault_reset_ = false;
        }
      }
      if (state == FaultState::normal) {
        fault_wet_current_ = 1.0;
      } else if (state == FaultState::muting && fault_mute_remaining_ != 0u) {
        const std::uint32_t progress = mute_frames + 1u - fault_mute_remaining_;
        fault_wet_current_ =
            1.0 - smoothstep(static_cast<double>(progress) / static_cast<double>(mute_frames));
        --fault_mute_remaining_;
        if (fault_mute_remaining_ == 0u) {
          state = FaultState::latchedSafeBypass;
          fault_wet_current_ = 0.0;
          mute_complete_frame_for_testing_ = processed_host_frames_ + frame;
          fault_reset_pending_ = true;
          trial_after_fault_reset_ = pending_fault_parameter_commit_;
        }
      } else if (state == FaultState::latchedSafeBypass || state == FaultState::trial) {
        fault_wet_current_ = 0.0;
        if (state == FaultState::trial &&
            block_feedback_detection_offset_ == std::numeric_limits<std::uint32_t>::max() &&
            fault_trial_remaining_ != 0u) {
          --fault_trial_remaining_;
          if (fault_trial_remaining_ == 0u) {
            state = FaultState::returning;
            fault_return_remaining_ = feedbackTransitionFrames();
          }
        }
      } else if (state == FaultState::returning && fault_return_remaining_ != 0u) {
        const std::uint32_t progress = feedbackTransitionFrames() - fault_return_remaining_;
        fault_wet_current_ = smoothstep(static_cast<double>(progress) /
                                        static_cast<double>(feedbackTransitionFrames()));
        --fault_return_remaining_;
        if (fault_return_remaining_ == 0u) {
          fault_clear_pending_ = true;
        }
      }
      fault_wet_[frame] = fault_wet_current_;
    }
    fault_state_ = state;
  }

  void smoothControls(std::uint32_t frame_count) noexcept {
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      controls_.drive += controls_.coefficient * (controls_.driveTarget - controls_.drive);
      controls_.output += controls_.coefficient * (controls_.outputTarget - controls_.output);
      controls_.mix += controls_.coefficient * (controls_.mixTarget - controls_.mix);
      controls_.inputReference +=
          controls_.coefficient * (controls_.inputReferenceTarget - controls_.inputReference);
      controls_.safetyUser +=
          controls_.coefficient * (controls_.safetyUserTarget - controls_.safetyUser);
      if (controls_.plateReferenceRemaining != 0u) {
        controls_.plateReference += controls_.plateReferenceStep;
        --controls_.plateReferenceRemaining;
        if (controls_.plateReferenceRemaining == 0u) {
          controls_.plateReference = controls_.plateReferenceTarget;
        }
      }
      drive_gain_[frame] = controls_.drive;
      output_gain_[frame] = controls_.output;
      wet_mix_[frame] = controls_.mix;
      input_reference_[frame] = controls_.inputReference;
      safety_user_[frame] = controls_.safetyUser;
      feedback_q_[frame] = controls_.feedbackQ;
      feedback_makeup_[frame] = controls_.feedbackMakeup;
      plate_reference_[frame] = controls_.plateReference;
      if (feedback_transition_.phase == FeedbackTransitionPhase::fadeOut) {
        const double position = static_cast<double>(feedback_transition_.progress + frame + 1u) /
                                static_cast<double>(feedbackTransitionFrames());
        transition_wet_[frame] = 1.0 - smoothstep(position);
      } else if (feedback_transition_.phase == FeedbackTransitionPhase::warmup) {
        transition_wet_[frame] = 0.0;
      } else if (feedback_transition_.phase == FeedbackTransitionPhase::fadeIn) {
        const double position = static_cast<double>(feedback_transition_.progress + frame + 1u) /
                                static_cast<double>(feedbackTransitionFrames());
        transition_wet_[frame] = smoothstep(position);
      } else {
        transition_wet_[frame] = 1.0;
      }
    }
  }

  void interpolateInput(const float *audio, std::uint32_t frame_count) noexcept {
    for (int channel = 0; channel < kChannels; ++channel) {
      auto &host_work = host_work_[channel];
      for (int index = 0; index < upsample_history_; ++index) {
        host_work[static_cast<std::size_t>(index)] =
            upsample_state_[channel][static_cast<std::size_t>(index)];
      }
      const std::size_t audio_offset = static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        host_work[static_cast<std::size_t>(upsample_history_) + frame] =
            static_cast<double>(audio[audio_offset + frame]) * drive_gain_[frame];
      }
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const int current = upsample_history_ + static_cast<int>(frame);
        for (int phase = 0; phase < rate_config_.factor; ++phase) {
          double value = 0.0;
          int history = 0;
          for (int tap = phase; tap < rate_config_.firLength; tap += rate_config_.factor) {
            value += coefficients_[static_cast<std::size_t>(tap)] *
                     host_work[static_cast<std::size_t>(current - history)];
            ++history;
          }
          internal_input_[channel][static_cast<std::size_t>(
              frame * static_cast<std::uint32_t>(rate_config_.factor) +
              static_cast<std::uint32_t>(phase))] = value * rate_config_.factor;
        }
      }
      for (int index = 0; index < upsample_history_; ++index) {
        upsample_state_[channel][static_cast<std::size_t>(index)] =
            host_work[static_cast<std::size_t>(frame_count) + static_cast<std::size_t>(index)];
      }
    }
  }

#if ET_TUBE_HAS_F64X2
  void interpolateInputSimd(const float *audio, std::uint32_t frame_count) noexcept {
    for (int index = 0; index < upsample_history_; ++index) {
      host_work_[0][static_cast<std::size_t>(index)] =
          upsample_state_[0][static_cast<std::size_t>(index)];
      host_work_[1][static_cast<std::size_t>(index)] =
          upsample_state_[1][static_cast<std::size_t>(index)];
    }
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double gain = drive_gain_[frame];
      host_work_[0][static_cast<std::size_t>(upsample_history_) + frame] =
          static_cast<double>(audio[frame]) * gain;
      host_work_[1][static_cast<std::size_t>(upsample_history_) + frame] =
          static_cast<double>(audio[frame_count + frame]) * gain;
    }
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const int current = upsample_history_ + static_cast<int>(frame);
      for (int phase = 0; phase < rate_config_.factor; ++phase) {
        StereoPair value = {0.0, 0.0};
        int history = 0;
        for (int tap = phase; tap < rate_config_.firLength; tap += rate_config_.factor) {
          const StereoPair sample = {host_work_[0][static_cast<std::size_t>(current - history)],
                                     host_work_[1][static_cast<std::size_t>(current - history)]};
          value += coefficients_[static_cast<std::size_t>(tap)] * sample;
          ++history;
        }
        const std::size_t internal_index =
            static_cast<std::size_t>(frame * static_cast<std::uint32_t>(rate_config_.factor) +
                                     static_cast<std::uint32_t>(phase));
        value *= rate_config_.factor;
        internal_input_[0][internal_index] = value[0];
        internal_input_[1][internal_index] = value[1];
      }
    }
    for (int index = 0; index < upsample_history_; ++index) {
      upsample_state_[0][static_cast<std::size_t>(index)] =
          host_work_[0][static_cast<std::size_t>(frame_count) + static_cast<std::size_t>(index)];
      upsample_state_[1][static_cast<std::size_t>(index)] =
          host_work_[1][static_cast<std::size_t>(frame_count) + static_cast<std::size_t>(index)];
    }
  }
#endif

  void runFastCore(std::uint32_t frame_count) noexcept {
    const std::uint32_t internal_frames =
        frame_count * static_cast<std::uint32_t>(rate_config_.factor);
    const bool output_stage = applied_parameters_.outputStage != 0;
#if ET_TUBE_HAS_F64X2
    if (useSimdPath()) {
      for (std::uint32_t index = 0u; index < internal_frames; ++index) {
        const std::uint32_t host_frame = index / static_cast<std::uint32_t>(rate_config_.factor);
        if (feedback_transition_.stateGeneration != feedback_transition_.activeGeneration) {
          ++feedback_transition_.oldStateNewNfProcessCount;
        }
#if ET_TUBE_SIMULATOR_TEST_STATE
        beginFastKclStepForTesting(index, host_frame);
#endif
        const double reference = output_stage ? 0.0 : plate_reference_[host_frame];
        StereoPair output;
        if (output_stage) {
          if (driverBypassed()) {
            // Preserve the skipped driver's causal sample boundary explicitly. The power plant is
            // advanced first, this sample's feedback tap is observed, and the newly compensated
            // input is stored for the next fast sample.
            step_safety_hit_ = false;
            output = applied_parameters_.outputStage == 1
                         ? StereoPair{advancePower(0, bypass_drive_[0], true),
                                      advancePower(1, bypass_drive_[1], true)}
                         : StereoPair{advanceSingleEnded(0, bypass_drive_[0]),
                                      advanceSingleEnded(1, bypass_drive_[1])};
            if (step_safety_hit_) {
              block_safety_hit_ = true;
            }
            observeFeedbackSignal(0, feedback_q_[host_frame]);
            observeFeedbackSignal(1, feedback_q_[host_frame]);
            bypass_drive_[0] = applyFeedbackFilter(0, internal_input_[0][index],
                                                   feedback_q_[host_frame], reference);
            bypass_drive_[1] = applyFeedbackFilter(1, internal_input_[1][index],
                                                   feedback_q_[host_frame], reference);
          } else {
            // The whole forward path of this sample is evaluated before the compensator, so the
            // tap it subtracts is this sample's. See advanceDriverOutput.
            const StereoPair driver = advanceStereoOutput();
            const StereoPair powered =
                applied_parameters_.outputStage == 1
                    ? StereoPair{advancePower(0, driver[0]), advancePower(1, driver[1])}
                    : StereoPair{advanceSingleEnded(0, driver[0]),
                                 advanceSingleEnded(1, driver[1])};
            observeFeedbackSignal(0, feedback_q_[host_frame]);
            observeFeedbackSignal(1, feedback_q_[host_frame]);
            const StereoPair input = {applyFeedbackFilter(0, internal_input_[0][index],
                                                          feedback_q_[host_frame], reference),
                                      applyFeedbackFilter(1, internal_input_[1][index],
                                                          feedback_q_[host_frame], reference)};
            const std::array<bool, kChannels> valid = advanceStereoInput(input);
            output = StereoPair{valid[0] ? powered[0] : 0.0, valid[1] ? powered[1] : 0.0};
          }
        } else {
          const StereoPair input = {
              applyFeedbackFilter(0, internal_input_[0][index], feedback_q_[host_frame], reference),
              applyFeedbackFilter(1, internal_input_[1][index], feedback_q_[host_frame],
                                  reference)};
          if (driverBypassed()) {
            output = input / input_reference_[host_frame];
          } else {
            output = advanceStereo(input) * 0.001;
            observeFeedbackSignal(0, feedback_q_[host_frame]);
            observeFeedbackSignal(1, feedback_q_[host_frame]);
          }
        }
        observeFeedbackDetector(internal_input_[0][index], internal_input_[1][index], output[0],
                                output[1], reference, host_frame);
        internal_output_[0][index] = output[0];
        internal_output_[1][index] = output[1];
      }
      return;
    }
#endif
    for (std::uint32_t index = 0u; index < internal_frames; ++index) {
      const std::uint32_t host_frame = index / static_cast<std::uint32_t>(rate_config_.factor);
      if (feedback_transition_.stateGeneration != feedback_transition_.activeGeneration) {
        ++feedback_transition_.oldStateNewNfProcessCount;
      }
#if ET_TUBE_SIMULATOR_TEST_STATE
      beginFastKclStepForTesting(index, host_frame);
#endif
      const double reference = output_stage ? 0.0 : plate_reference_[host_frame];
      if (output_stage) {
        for (int channel = 0; channel < kChannels; ++channel) {
          if (driverBypassed()) {
            const std::size_t slot = static_cast<std::size_t>(channel);
            step_safety_hit_ = false;
            const double powered = applied_parameters_.outputStage == 1
                                       ? advancePower(channel, bypass_drive_[slot], true)
                                       : advanceSingleEnded(channel, bypass_drive_[slot]);
            if (step_safety_hit_) {
              block_safety_hit_ = true;
            }
            observeFeedbackSignal(channel, feedback_q_[host_frame]);
            bypass_drive_[slot] = applyFeedbackFilter(channel, internal_input_[channel][index],
                                                      feedback_q_[host_frame], reference);
            internal_output_[channel][index] = powered;
            continue;
          }
          // One channel at a time: the per-sample safety flag is a single scalar, and the power
          // stage sits between the two halves of the driver here.
          const double driver = advanceDriverOutput(channel);
          const bool driver_safety_hit = step_safety_hit_;
          const double powered = applied_parameters_.outputStage == 1
                                     ? advancePower(channel, driver)
                                     : advanceSingleEnded(channel, driver);
          observeFeedbackSignal(channel, feedback_q_[host_frame]);
          const double error = applyFeedbackFilter(channel, internal_input_[channel][index],
                                                   feedback_q_[host_frame], reference);
          step_safety_hit_ = driver_safety_hit;
          internal_output_[channel][index] = advanceDriverInput(channel, error) ? powered : 0.0;
        }
      } else {
        if (driverBypassed()) {
          internal_output_[0][index] = applyFeedbackFilter(0, internal_input_[0][index],
                                                           feedback_q_[host_frame], reference) /
                                       input_reference_[host_frame];
          internal_output_[1][index] = applyFeedbackFilter(1, internal_input_[1][index],
                                                           feedback_q_[host_frame], reference) /
                                       input_reference_[host_frame];
          observeFeedbackDetector(internal_input_[0][index], internal_input_[1][index],
                                  internal_output_[0][index], internal_output_[1][index], reference,
                                  host_frame);
          continue;
        }
        const double driver_left =
            advanceChannel(0, applyFeedbackFilter(0, internal_input_[0][index],
                                                  feedback_q_[host_frame], reference));
        const double driver_right =
            advanceChannel(1, applyFeedbackFilter(1, internal_input_[1][index],
                                                  feedback_q_[host_frame], reference));
        internal_output_[0][index] = driver_left * 0.001;
        internal_output_[1][index] = driver_right * 0.001;
        observeFeedbackSignal(0, feedback_q_[host_frame]);
        observeFeedbackSignal(1, feedback_q_[host_frame]);
      }
      observeFeedbackDetector(internal_input_[0][index], internal_input_[1][index],
                              internal_output_[0][index], internal_output_[1][index], reference,
                              host_frame);
    }
  }

  void decimateAndMix(float *audio, std::uint32_t frame_count) noexcept {
    const std::uint32_t internal_frames =
        frame_count * static_cast<std::uint32_t>(rate_config_.factor);
    for (int channel = 0; channel < kChannels; ++channel) {
      auto &internal_work = internal_work_[channel];
      for (int index = 0; index < downsample_history_; ++index) {
        internal_work[static_cast<std::size_t>(index)] =
            downsample_state_[channel][static_cast<std::size_t>(index)];
      }
      for (std::uint32_t index = 0u; index < internal_frames; ++index) {
        internal_work[static_cast<std::size_t>(downsample_history_) + index] =
            internal_output_[channel][index];
      }
      const std::size_t audio_offset = static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const int current =
            downsample_history_ +
            static_cast<int>(frame * static_cast<std::uint32_t>(rate_config_.factor));
        double wet = 0.0;
        for (int tap = 0; tap < rate_config_.firLength; ++tap) {
          wet += coefficients_[static_cast<std::size_t>(tap)] *
                 internal_work[static_cast<std::size_t>(current - tap)];
        }
        const int dry_index = (dry_index_ + static_cast<int>(frame)) & (kDryDelayFrames - 1);
        const double dry = dry_delay_[channel][static_cast<std::size_t>(dry_index)];
        safe_dry_[audio_offset + frame] = dry;
        const double input_sample = static_cast<double>(audio[audio_offset + frame]);
        dry_delay_[channel][static_cast<std::size_t>(dry_index)] =
            std::isfinite(input_sample) ? input_sample : 0.0;
        wet_chain_[audio_offset + frame] =
            wet * feedback_makeup_[frame] * output_gain_[frame] * safety_user_[frame];
      }
      for (int index = 0; index < downsample_history_; ++index) {
        downsample_state_[channel][static_cast<std::size_t>(index)] =
            internal_work[static_cast<std::size_t>(internal_frames) +
                          static_cast<std::size_t>(index)];
      }
    }
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      // The detector sees the wet chain before the automatic reduction and without the dry path
      // mixed in. Open loop by construction: no result of the reduction re-enters the measurement,
      // so the monotone law measures the true excess rather than the excess it has already fixed.
      const double safety_auto = advanceSafetyReduction(
          wet_chain_[frame], wet_chain_[static_cast<std::size_t>(frame_count) + frame]);
      const double wet_mix = wet_mix_[frame];
      const double transition_wet = transition_wet_[frame];
      const double fault_wet = fault_wet_[frame];
      for (int channel = 0; channel < kChannels; ++channel) {
        const std::size_t audio_offset = static_cast<std::size_t>(channel) * frame_count;
        const double dry = safe_dry_[audio_offset + frame];
        // The dry path is never attenuated, so mx = 0 stays a bit-transparent bypass.
        const double normal =
            wet_chain_[audio_offset + frame] * safety_auto * wet_mix + dry * (1.0 - wet_mix);
        const double processed = dry + transition_wet * (normal - dry);
        audio[audio_offset + frame] =
            static_cast<float>(processed * fault_wet + dry * (1.0 - fault_wet));
        if (channel == 0 && feedback_transition_.phase == FeedbackTransitionPhase::warmup) {
          ++feedback_transition_.warmupWetFrames;
          if (audio[audio_offset + frame] != static_cast<float>(dry)) {
            ++feedback_transition_.warmupAlignedDryMismatches;
          }
        }
      }
    }
    dry_index_ = (dry_index_ + static_cast<int>(frame_count)) & (kDryDelayFrames - 1);
  }

#if ET_TUBE_HAS_F64X2
  void decimateAndMixSimd(float *audio, std::uint32_t frame_count) noexcept {
    const std::uint32_t internal_frames =
        frame_count * static_cast<std::uint32_t>(rate_config_.factor);
    for (int index = 0; index < downsample_history_; ++index) {
      internal_work_[0][static_cast<std::size_t>(index)] =
          downsample_state_[0][static_cast<std::size_t>(index)];
      internal_work_[1][static_cast<std::size_t>(index)] =
          downsample_state_[1][static_cast<std::size_t>(index)];
    }
    for (std::uint32_t index = 0u; index < internal_frames; ++index) {
      internal_work_[0][static_cast<std::size_t>(downsample_history_) + index] =
          internal_output_[0][index];
      internal_work_[1][static_cast<std::size_t>(downsample_history_) + index] =
          internal_output_[1][index];
    }
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const int current = downsample_history_ +
                          static_cast<int>(frame * static_cast<std::uint32_t>(rate_config_.factor));
      StereoPair wet = {0.0, 0.0};
      for (int tap = 0; tap < rate_config_.firLength; ++tap) {
        const StereoPair sample = {internal_work_[0][static_cast<std::size_t>(current - tap)],
                                   internal_work_[1][static_cast<std::size_t>(current - tap)]};
        wet += coefficients_[static_cast<std::size_t>(tap)] * sample;
      }
      const int dry_index = (dry_index_ + static_cast<int>(frame)) & (kDryDelayFrames - 1);
      const StereoPair dry = {dry_delay_[0][static_cast<std::size_t>(dry_index)],
                              dry_delay_[1][static_cast<std::size_t>(dry_index)]};
      safe_dry_[frame] = dry[0];
      safe_dry_[static_cast<std::size_t>(frame_count) + frame] = dry[1];
      const double input_left = static_cast<double>(audio[frame]);
      const double input_right = static_cast<double>(audio[frame_count + frame]);
      dry_delay_[0][static_cast<std::size_t>(dry_index)] =
          std::isfinite(input_left) ? input_left : 0.0;
      dry_delay_[1][static_cast<std::size_t>(dry_index)] =
          std::isfinite(input_right) ? input_right : 0.0;
      const double wet_mix = wet_mix_[frame];
      // Same expression order as the scalar path, term for term, so the two paths stay digest
      // identical.
      const StereoPair chain =
          wet * feedback_makeup_[frame] * output_gain_[frame] * safety_user_[frame];
      const double safety_auto = advanceSafetyReduction(chain[0], chain[1]);
      const StereoPair normal = chain * safety_auto * wet_mix + dry * (1.0 - wet_mix);
      const StereoPair processed = dry + transition_wet_[frame] * (normal - dry);
      const double fault_wet = fault_wet_[frame];
      const StereoPair mixed = processed * fault_wet + dry * (1.0 - fault_wet);
      audio[frame] = static_cast<float>(mixed[0]);
      audio[frame_count + frame] = static_cast<float>(mixed[1]);
      if (feedback_transition_.phase == FeedbackTransitionPhase::warmup) {
        ++feedback_transition_.warmupWetFrames;
        if (audio[frame] != static_cast<float>(dry[0]) ||
            audio[frame_count + frame] != static_cast<float>(dry[1])) {
          ++feedback_transition_.warmupAlignedDryMismatches;
        }
      }
    }
    for (int index = 0; index < downsample_history_; ++index) {
      downsample_state_[0][static_cast<std::size_t>(index)] =
          internal_work_[0][static_cast<std::size_t>(internal_frames) +
                            static_cast<std::size_t>(index)];
      downsample_state_[1][static_cast<std::size_t>(index)] =
          internal_work_[1][static_cast<std::size_t>(internal_frames) +
                            static_cast<std::size_t>(index)];
    }
    dry_index_ = (dry_index_ + static_cast<int>(frame_count)) & (kDryDelayFrames - 1);
  }
#endif

  [[nodiscard]] bool processBlock(float *audio, std::uint32_t frame_count) noexcept {
    block_finite_fault_ = false;
    block_safety_hit_ = false;
    block_feedback_detection_offset_ = std::numeric_limits<std::uint32_t>::max();
    const FaultState block_start_fault_state = fault_state_;
    smoothControls(frame_count);
#if ET_TUBE_HAS_F64X2
    if (useSimdPath()) {
      interpolateInputSimd(audio, frame_count);
    } else {
      interpolateInput(audio, frame_count);
    }
#else
    interpolateInput(audio, frame_count);
#endif
    runFastCore(frame_count);
    prepareFaultWet(frame_count, block_start_fault_state);
#if ET_TUBE_HAS_F64X2
    if (useSimdPath()) {
      decimateAndMixSimd(audio, frame_count);
    } else {
      decimateAndMix(audio, frame_count);
    }
#else
    decimateAndMix(audio, frame_count);
#endif
    if (block_finite_fault_ || block_safety_hit_ || !finiteRuntimeDomain()) {
      if (!block_finite_fault_ && !block_safety_hit_) {
        ++finite_faults_;
      }
      restoreRuntimeBaseline();
      return false;
    }
    refreshTelemetryFromState();
    processed_host_frames_ += frame_count;
    return true;
  }

  [[nodiscard]] bool processWithFaultHandling(float *audio, std::uint32_t frame_count) noexcept {
    if (runtime_event_.cause == kRuntimeCauseProcessingSafetyFailure) {
      const std::size_t samples = static_cast<std::size_t>(kChannels) * frame_count;
      for (std::size_t index = 0; index < samples; ++index) {
        const std::size_t channel = index / static_cast<std::size_t>(frame_count);
        const std::size_t frame = index % static_cast<std::size_t>(frame_count);
        const int delayed_index = (dry_index_ + static_cast<int>(frame)) & (kDryDelayFrames - 1);
        const double dry = dry_delay_[channel][static_cast<std::size_t>(delayed_index)];
        const double input_sample = static_cast<double>(audio[index]);
        dry_delay_[channel][static_cast<std::size_t>(delayed_index)] =
            std::isfinite(input_sample) ? input_sample : 0.0;
        audio[index] = static_cast<float>(dry);
      }
      dry_index_ = (dry_index_ + static_cast<int>(frame_count)) & (kDryDelayFrames - 1);
      processed_host_frames_ += frame_count;
      return true;
    }
    if (processBlock(audio, frame_count)) {
      return true;
    }
    latchRuntimeFault(kRuntimeCauseProcessingSafetyFailure);
    const std::size_t samples = static_cast<std::size_t>(kChannels) * frame_count;
    for (std::size_t index = 0; index < samples; ++index) {
      audio[index] = static_cast<float>(safe_dry_[index]);
    }
    processed_host_frames_ += frame_count;
    return false;
  }

  template <typename Container>
  [[nodiscard]] static bool finiteContainer(const Container &values) noexcept {
    for (double value : values) {
      if (!std::isfinite(value)) {
        return false;
      }
    }
    return true;
  }

  [[nodiscard]] bool finiteControlState() const noexcept {
    return std::isfinite(controls_.drive) && std::isfinite(controls_.driveTarget) &&
           std::isfinite(controls_.output) && std::isfinite(controls_.outputTarget) &&
           std::isfinite(controls_.mix) && std::isfinite(controls_.mixTarget) &&
           std::isfinite(controls_.inputReference) &&
           std::isfinite(controls_.inputReferenceTarget) && std::isfinite(controls_.safetyUser) &&
           std::isfinite(controls_.safetyUserTarget) && std::isfinite(controls_.coefficient) &&
           std::isfinite(controls_.feedbackQ) && std::isfinite(controls_.feedbackDb) &&
           std::isfinite(controls_.feedbackB0) && std::isfinite(controls_.feedbackB1) &&
           std::isfinite(controls_.feedbackA1) && std::isfinite(controls_.feedbackA2) &&
           std::isfinite(controls_.feedbackA0) && std::isfinite(controls_.feedbackBeta) &&
           std::isfinite(controls_.feedbackMakeup) && std::isfinite(controls_.plateReference) &&
           std::isfinite(controls_.plateReferenceTarget) &&
           std::isfinite(controls_.plateReferenceStep);
  }

  [[nodiscard]] bool finiteRuntimeDomain() const noexcept {
    if (!finiteControlState() || !finiteContainer(coefficients_) || !std::isfinite(maximum_kcl_) ||
        !std::isfinite(maximum_dc_residual_) || !std::isfinite(maximum_energy_residual_) ||
        !std::isfinite(fault_wet_current_) || !std::isfinite(detector_input_energy_) ||
        !std::isfinite(detector_output_energy_) || !std::isfinite(detector_feedback_energy_) ||
        !std::isfinite(detector_previous_input_rms_) ||
        !std::isfinite(detector_previous_output_rms_) ||
        !std::isfinite(detector_previous_feedback_rms_) ||
        !std::isfinite(detector_sustained_input_energy_) ||
        !std::isfinite(detector_sustained_output_energy_) ||
        !std::isfinite(detector_sustained_feedback_energy_) ||
        !std::isfinite(detector_sustained_previous_input_rms_) ||
        !std::isfinite(detector_sustained_previous_output_rms_) ||
        !std::isfinite(detector_sustained_previous_feedback_rms_) ||
        !std::isfinite(safety_auto_gain_) || !std::isfinite(safety_auto_target_) ||
        !std::isfinite(safety_auto_step_) || !finiteParameters(committed_parameters_) ||
        runtime_event_.latched > 1u ||
        runtime_event_.cause > kRuntimeCauseProcessingSafetyFailure ||
        static_cast<std::uint32_t>(fault_state_) >
            static_cast<std::uint32_t>(FaultState::returning) ||
        static_cast<std::uint32_t>(feedback_transition_.phase) >
            static_cast<std::uint32_t>(FeedbackTransitionPhase::fadeIn) ||
        static_cast<std::uint32_t>(last_central_reset_reason_) >
            static_cast<std::uint32_t>(CentralResetReason::faultCircuit) ||
        !finiteParameters(applied_parameters_) ||
        (pending_transition_parameters_valid_ &&
         !finiteParameters(pending_transition_parameters_)) ||
        (queued_transition_parameters_valid_ && !finiteParameters(queued_transition_parameters_)) ||
        (pending_fault_parameter_commit_ && !finiteParameters(pending_fault_parameters_)) ||
        dry_index_ < 0 || dry_index_ >= kDryDelayFrames) {
      return false;
    }
    if ((feedback_transition_.phase == FeedbackTransitionPhase::fadeOut ||
         feedback_transition_.phase == FeedbackTransitionPhase::fadeIn) &&
        feedback_transition_.progress > feedbackTransitionFrames()) {
      return false;
    }
    if (feedback_transition_.phase == FeedbackTransitionPhase::warmup &&
        feedback_transition_.progress > feedbackWarmupFrames()) {
      return false;
    }
    for (float value : telemetry_payload_) {
      if (!std::isfinite(value)) {
        return false;
      }
    }
    for (int channel = 0; channel < kChannels; ++channel) {
      if (!finitePhysicalChannel(channel) || !finitePowerState(power_state_[channel]) ||
          !finiteStage(recovery_fast_[channel].stage[0]) ||
          !finiteStage(recovery_fast_[channel].stage[1]) ||
          !std::isfinite(recovery_fast_[channel].outputCouplingCharge) ||
          !std::isfinite(recovery_fast_[channel].outputLoadCurrent) ||
          !finiteSlowValue(recovery_slow_[channel].cathode[0]) ||
          !finiteSlowValue(recovery_slow_[channel].cathode[1]) ||
          !finiteSlowValue(recovery_slow_[channel].supply) ||
          !finiteContainer(upsample_state_[channel]) ||
          !finiteContainer(downsample_state_[channel]) || !finiteContainer(host_work_[channel]) ||
          !finiteContainer(internal_input_[channel]) ||
          !finiteContainer(internal_output_[channel]) ||
          !finiteContainer(internal_work_[channel]) || !finiteContainer(dry_delay_[channel]) ||
          !finiteContainer(last_plate_current_[channel]) ||
          !std::isfinite(feedback_filter_[channel].s1) ||
          !std::isfinite(feedback_filter_[channel].s2) ||
          !finiteContainer(feedback_filter_[channel].transport) ||
          feedback_filter_[channel].transportIndex != 0u) {
        return false;
      }
    }
    return finiteContainer(bypass_drive_) && finiteContainer(drive_gain_) &&
           finiteContainer(input_reference_) && finiteContainer(output_gain_) &&
           finiteContainer(wet_mix_) && finiteContainer(feedback_q_) &&
           finiteContainer(feedback_makeup_) && finiteContainer(plate_reference_) &&
           finiteContainer(fault_wet_) && finiteContainer(transition_wet_) &&
           finiteContainer(safe_dry_) && finiteContainer(safety_user_) &&
           finiteContainer(wet_chain_) && finiteContainer(segment_audio_);
  }

  void restoreRuntimeBaseline() noexcept {
    const std::uint64_t finite_faults = finite_faults_;
    const std::uint64_t safety_limits = safety_limits_;
    const std::uint64_t slow_publish_count = slow_publish_count_;
    const double maximum_kcl = std::isfinite(maximum_kcl_) ? maximum_kcl_ : 0.0;
    const double maximum_dc_residual =
        std::isfinite(maximum_dc_residual_) ? maximum_dc_residual_ : 0.0;
    const double maximum_energy_residual =
        std::isfinite(maximum_energy_residual_) ? maximum_energy_residual_ : 0.0;
    // A non-finite fault must not hand the user back the headroom the detector already took away,
    // so the reduction is carried across the rebuild exactly like the fault counters. A value that
    // is itself non-finite is the one thing that cannot be carried: it would poison every later
    // block, so it falls back to unity and the detector simply measures again.
    const double safety_auto_gain = std::isfinite(safety_auto_gain_) ? safety_auto_gain_ : 1.0;
    const double safety_auto_target =
        std::isfinite(safety_auto_target_) ? safety_auto_target_ : 1.0;
    const double safety_auto_step = std::isfinite(safety_auto_step_) ? safety_auto_step_ : 0.0;
    const std::uint32_t safety_auto_remaining =
        std::isfinite(safety_auto_step_) ? safety_auto_remaining_ : 0u;
    controls_ = ControlState{};
    controls_.coefficient =
        1.0 - std::exp(-1000.0 / (kControlSmoothingMilliseconds * prepared_rate_));
    applyPath2Parameters(true);
    resetDetector();
    for (int channel = 0; channel < kChannels; ++channel) {
      fast_[channel] = FastChannel{};
      slow_[channel] = SlowState{};
      solveDc(slow_[channel], fast_[channel]);
      recovery_fast_[channel] = fast_[channel];
      recovery_slow_[channel] = slow_[channel];
      accumulator_[channel] = SlowAccumulator{};
      resetPowerState(power_state_[channel]);
      power_lut_scratch_[channel] = {};
      std::fill(upsample_state_[channel].begin(), upsample_state_[channel].end(), 0.0);
      std::fill(downsample_state_[channel].begin(), downsample_state_[channel].end(), 0.0);
      std::fill(host_work_[channel].begin(), host_work_[channel].end(), 0.0);
      std::fill(internal_input_[channel].begin(), internal_input_[channel].end(), 0.0);
      std::fill(internal_output_[channel].begin(), internal_output_[channel].end(), 0.0);
      std::fill(internal_work_[channel].begin(), internal_work_[channel].end(), 0.0);
      last_plate_current_[channel] = {0.0, 0.0};
      feedback_filter_[channel] = FeedbackFilterState{};
      bypass_drive_[static_cast<std::size_t>(channel)] = 0.0;
    }
    schedulePlateReference(fast_[0].stage[1].plateVoltage, true);
    std::fill(drive_gain_.begin(), drive_gain_.end(), controls_.drive);
    std::fill(output_gain_.begin(), output_gain_.end(), controls_.output);
    std::fill(wet_mix_.begin(), wet_mix_.end(), controls_.mix);
    std::fill(input_reference_.begin(), input_reference_.end(), controls_.inputReference);
    std::fill(feedback_q_.begin(), feedback_q_.end(), controls_.feedbackQ);
    std::fill(feedback_makeup_.begin(), feedback_makeup_.end(), 1.0);
    std::fill(plate_reference_.begin(), plate_reference_.end(), controls_.plateReference);
    std::fill(transition_wet_.begin(), transition_wet_.end(), 1.0);
    std::fill(safety_user_.begin(), safety_user_.end(), controls_.safetyUser);
    std::fill(wet_chain_.begin(), wet_chain_.end(), 0.0);
    telemetry_payload_.fill(0.0F);
    safety_auto_gain_ = safety_auto_gain;
    safety_auto_target_ = safety_auto_target;
    safety_auto_step_ = safety_auto_step;
    safety_auto_remaining_ = safety_auto_remaining;
    finite_faults_ = finite_faults;
    safety_limits_ = safety_limits;
    slow_publish_count_ = slow_publish_count;
    maximum_kcl_ = maximum_kcl;
    maximum_dc_residual_ = maximum_dc_residual;
    maximum_energy_residual_ = maximum_energy_residual;
    refreshTelemetryFromState();
  }

  void refreshTelemetryFromState() noexcept {
    telemetry_payload_.fill(0.0F);
    for (int channel = 0; channel < kChannels; ++channel) {
      const FastChannel &fast = fast_[channel];
      const SlowState &slow = slow_[channel];
      const std::size_t offset = static_cast<std::size_t>(channel) * 20u;
      if (!driverBypassed()) {
        telemetry_payload_[offset] = static_cast<float>(slow.cathode[0].voltage);
        telemetry_payload_[offset + 1u] = static_cast<float>(slow.cathode[1].voltage);
        telemetry_payload_[offset + 2u] = static_cast<float>(slow.supply.voltage);
        telemetry_payload_[offset + 3u] =
            static_cast<float>(fast.stage[0].gridVoltage - slow.cathode[0].voltage);
        telemetry_payload_[offset + 4u] =
            static_cast<float>(fast.stage[0].plateVoltage - slow.cathode[0].voltage);
        telemetry_payload_[offset + 5u] = static_cast<float>(last_plate_current_[channel][0]);
        telemetry_payload_[offset + 6u] =
            static_cast<float>(fast.stage[1].gridVoltage - slow.cathode[1].voltage);
        telemetry_payload_[offset + 7u] =
            static_cast<float>(fast.stage[1].plateVoltage - slow.cathode[1].voltage);
        telemetry_payload_[offset + 8u] = static_cast<float>(last_plate_current_[channel][1]);
      }
      if (applied_parameters_.outputStage != 0) {
        const PowerState &power = power_state_[channel];
        telemetry_payload_[offset + 9u] = static_cast<float>(power.ltpBalanceV);
        telemetry_payload_[offset + 10u] =
            static_cast<float>(power.platePushV - power.cathodePushV);
        telemetry_payload_[offset + 11u] =
            static_cast<float>(power.platePullV - power.cathodePullV);
        telemetry_payload_[offset + 12u] = static_cast<float>(power.iaPushA);
        telemetry_payload_[offset + 13u] = static_cast<float>(power.iaPullA);
        telemetry_payload_[offset + 14u] = static_cast<float>(power.bPlusV);
        telemetry_payload_[offset + 15u] =
            static_cast<float>(power.screenPushV - power.cathodePushV);
        telemetry_payload_[offset + 16u] =
            static_cast<float>(power.screenPullV - power.cathodePullV);
        const double magnetizing_inductance =
            applied_parameters_.outputStage == 1
                ? powerProfile().magnetizingInductanceH
                : kSeTubeModels[static_cast<std::size_t>(applied_parameters_.seTube)]
                      .magnetizingInductanceH;
        telemetry_payload_[offset + 17u] =
            static_cast<float>(magnetizing_inductance * power.magnetizingCurrentA);
        telemetry_payload_[offset + 18u] = static_cast<float>(power.publishedVrms);
        telemetry_payload_[offset + 19u] = static_cast<float>(power.publishedRealPower);
      }
    }
    // One shared trailing word, outside the per-channel loop: the automatic action must never be
    // invisible, so the reduction currently in force is published even when it is zero.
    telemetry_payload_[kTelemetrySafetyReductionIndex] = static_cast<float>(safetyReductionDb());
  }

#if ET_TUBE_SIMULATOR_TEST_STATE
  static void hashWord(std::uint64_t &hash, std::uint64_t value) noexcept {
    for (int byte = 0; byte < 8; ++byte) {
      hash ^= static_cast<std::uint8_t>(value >> static_cast<unsigned>(byte * 8));
      hash *= 1099511628211ull;
    }
  }

  static void hashDouble(std::uint64_t &hash, double value) noexcept {
    hashWord(hash, std::bit_cast<std::uint64_t>(value));
  }

  static void hashStage(std::uint64_t &hash, const FastStage &stage) noexcept {
    hashDouble(hash, stage.gridVoltage);
    hashDouble(hash, stage.plateVoltage);
    hashDouble(hash, stage.couplingCharge);
    hashDouble(hash, stage.millerVoltage);
    hashDouble(hash, stage.millerCapacitance);
    hashDouble(hash, stage.localPlateGain);
    hashDouble(hash, stage.outputResistance);
    hashDouble(hash, stage.previousVak);
  }

  static void hashFastChannel(std::uint64_t &hash, const FastChannel &channel) noexcept {
    hashStage(hash, channel.stage[0]);
    hashStage(hash, channel.stage[1]);
    hashDouble(hash, channel.outputCouplingCharge);
    hashDouble(hash, channel.outputLoadCurrent);
  }

  static void hashSlowValue(std::uint64_t &hash, const SlowValue &value) noexcept {
    hashDouble(hash, value.voltage);
    hashDouble(hash, value.capacitorCurrent);
  }

  static void hashRamp(std::uint64_t &hash, const SlowRamp &ramp) noexcept {
    hashDouble(hash, ramp.applied);
    hashDouble(hash, ramp.slope);
    hashDouble(hash, ramp.curvature);
    hashDouble(hash, ramp.previous1);
    hashDouble(hash, ramp.previous2);
  }

  static void hashSlowState(std::uint64_t &hash, const SlowState &state) noexcept {
    hashSlowValue(hash, state.cathode[0]);
    hashSlowValue(hash, state.cathode[1]);
    hashSlowValue(hash, state.supply);
    hashRamp(hash, state.cathodeRamp[0]);
    hashRamp(hash, state.cathodeRamp[1]);
    hashRamp(hash, state.supplyRamp);
  }

  static void hashAccumulator(std::uint64_t &hash, const SlowAccumulator &accumulator) noexcept {
    hashDouble(hash, accumulator.uK1);
    hashDouble(hash, accumulator.uK2);
    hashDouble(hash, accumulator.uP);
    hashWord(hash, static_cast<std::uint64_t>(accumulator.count));
  }

  static void hashPowerState(std::uint64_t &hash, const PowerState &state) noexcept {
    hashDouble(hash, state.ltpInputCapV);
    hashDouble(hash, state.ltpCathodeV);
    hashDouble(hash, state.ltpPlateAV);
    hashDouble(hash, state.ltpPlateBV);
    hashDouble(hash, state.ltpGridAV);
    hashDouble(hash, state.gridCouplingPushV);
    hashDouble(hash, state.gridCouplingPullV);
    hashDouble(hash, state.ltpBalanceV);
    hashDouble(hash, state.gridPushV);
    hashDouble(hash, state.gridPullV);
    hashDouble(hash, state.cathodePushV);
    hashDouble(hash, state.cathodePullV);
    hashDouble(hash, state.bPlusV);
    hashDouble(hash, state.screenTapV);
    hashDouble(hash, state.screenV);
    hashDouble(hash, state.screenPushV);
    hashDouble(hash, state.screenPullV);
    hashDouble(hash, state.optCurrentA);
    hashDouble(hash, state.magnetizingCurrentA);
    hashDouble(hash, state.optCapacitorV);
    hashDouble(hash, state.primaryVoltageV);
    hashDouble(hash, state.speakerVoiceCurrentA);
    hashDouble(hash, state.speakerResonanceCurrentA);
    hashDouble(hash, state.speakerCapacitorV);
    hashDouble(hash, state.feedbackV);
    hashDouble(hash, state.speakerLoadVoltageV);
    hashDouble(hash, state.speakerLoadCurrentA);
    hashDouble(hash, state.platePushV);
    hashDouble(hash, state.platePullV);
    hashDouble(hash, state.iaPushA);
    hashDouble(hash, state.iaPullA);
    hashDouble(hash, state.ig2PushA);
    hashDouble(hash, state.ig2PullA);
    // The three slow-window accumulators and the phase-inverter accumulator carry a partial window
    // of charge across a save/restore boundary; leaving them out of the hash let a restored state
    // differ from the saved one by up to one slow window of bias-node drive without being detected.
    hashDouble(hash, state.slowAccumulatorPushA);
    hashDouble(hash, state.slowAccumulatorPullA);
    hashDouble(hash, state.slowAccumulatorScreenA);
    hashDouble(hash, state.slowAccumulatorLtpA);
    hashRamp(hash, state.cathodePushRamp);
    hashRamp(hash, state.cathodePullRamp);
    hashRamp(hash, state.bPlusRamp);
    hashRamp(hash, state.screenRamp);
    hashDouble(hash, state.vrmsSquareSum);
    hashDouble(hash, state.realPowerSum);
    hashDouble(hash, state.publishedVrms);
    hashDouble(hash, state.publishedRealPower);
    hashWord(hash, state.slowCounter);
    hashWord(hash, state.powerWindowSamples);
  }

  static void hashParameters(std::uint64_t &hash, const Path2Parameters &parameters) noexcept {
    hashDouble(hash, parameters.driveDb);
    hashWord(hash, static_cast<std::uint64_t>(parameters.tubeIndex));
    hashDouble(hash, parameters.biasPercent);
    hashDouble(hash, parameters.plateV);
    hashDouble(hash, parameters.sourceZKOhm);
    hashDouble(hash, parameters.supplyKOhm);
    hashDouble(hash, parameters.outputDb);
    hashDouble(hash, parameters.mixPercent);
    hashDouble(hash, parameters.inputReference);
    hashDouble(hash, parameters.feedbackDb);
    hashWord(hash, static_cast<std::uint64_t>(parameters.outputStage));
    hashWord(hash, static_cast<std::uint64_t>(parameters.powerTube));
    hashDouble(hash, parameters.powerBPlus);
    hashDouble(hash, parameters.cathodeResistor);
    hashWord(hash, static_cast<std::uint64_t>(parameters.screenTap));
    hashWord(hash, static_cast<std::uint64_t>(parameters.primaryImpedance));
    hashWord(hash, static_cast<std::uint64_t>(parameters.speakerLoad));
    hashDouble(hash, parameters.actualLoadOhm);
    hashDouble(hash, parameters.safetyTrimDb);
    hashWord(hash, parameters.autoGainReduction ? 1u : 0u);
    hashWord(hash, static_cast<std::uint64_t>(parameters.seTube));
    hashDouble(hash, parameters.seBPlus);
    hashDouble(hash, parameters.seCathodeResistor);
    hashWord(hash, static_cast<std::uint64_t>(parameters.sePrimaryImpedance));
  }
#endif

  double prepared_rate_ = 0.0;
  RateConfig rate_config_{};
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  int upsample_history_ = 0;
  int downsample_history_ = 0;
  bool supported_rate_ = false;
  bool buffers_ready_ = false;
  bool parameters_initialized_ = false;
  bool parameter_commit_pending_ = false;
  bool has_applied_parameters_ = false;
#if ET_TUBE_SIMULATOR_TEST_STATE && ET_TUBE_HAS_F64X2
  bool use_simd_for_testing_ = false;
#endif
#if ET_TUBE_SIMULATOR_TEST_STATE
  std::uint64_t plate_fallback_successes_for_testing_ = 0u;
  std::array<std::uint64_t, kGridFallbackMaximumIterations + 1>
      grid_fallback_iteration_histogram_for_testing_{};
  bool line_design_observation_enabled_for_testing_ = false;
  double second_stage_grid_current_peak_for_testing_ = 0.0;
  std::uint64_t second_stage_grid_conduction_steps_for_testing_ = 0u;
  std::uint64_t second_stage_grid_total_steps_for_testing_ = 0u;
  double maximum_detector_input_rms_for_testing_ = 0.0;
  double maximum_detector_output_rms_for_testing_ = 0.0;
  double maximum_detector_feedback_rms_for_testing_ = 0.0;
  std::vector<DetectorWindowObservation> detector_window_trace_for_testing_{};
  bool detector_window_trace_overflow_for_testing_ = false;
  std::vector<TransitionBoundaryObservation> transition_boundary_trace_for_testing_{};
  bool transition_boundary_trace_overflow_for_testing_ = false;
#endif
  Path2Parameters applied_parameters_{};
  Path2Parameters decoded_parameters_{};
  Path2Parameters pending_transition_parameters_{};
  Path2Parameters queued_transition_parameters_{};
  bool pending_transition_parameters_valid_ = false;
  bool queued_transition_parameters_valid_ = false;
  int tube_index_ = 0;
  double cathode_resistance_ = kBaseCathodeResistance;
  double plate_resistance_ = kBasePlateResistance;
  double source_resistance_ = 10000.0;
  double supply_resistance_ = 10000.0;
  double supply_capacitance_ = 22e-6;
  double supply_voltage_ = 250.0;
  std::vector<double> coefficients_{};
  std::array<std::vector<double>, kChannels> upsample_state_{};
  std::array<std::vector<double>, kChannels> downsample_state_{};
  std::array<std::vector<double>, kChannels> host_work_{};
  std::array<std::vector<double>, kChannels> internal_input_{};
  std::array<std::vector<double>, kChannels> internal_output_{};
  std::array<std::vector<double>, kChannels> internal_work_{};
  std::array<FastChannel, kChannels> fast_{};
  // Carried between the two halves of one driver sample. Nothing here survives a sample boundary;
  // it exists so the Power branch can read this sample's feedback tap before the compensator runs.
  struct DriverSplit {
    StageResult second{};
    double iCout = 0.0;
  };
  std::array<DriverSplit, kChannels> driver_split_{};
  // Explicit causal handoff for Power-only processing. It replaces the one-fast-sample boundary
  // that naturally exists inside the skipped two-stage driver.
  std::array<double, kChannels> bypass_drive_{};
#if ET_TUBE_HAS_F64X2
  // Held as scalars per lane: a vector-typed member would raise the alignment of the whole kernel
  // above the engine's instance storage alignment.
  struct StereoSplit {
    std::array<StageResult, kChannels> second{};
    std::array<double, kChannels> iCout{};
    std::array<double, kChannels> delayedP{};
    std::array<double, kChannels> vk1{};
    std::array<double, kChannels> vk2{};
    std::array<bool, kChannels> safetyHit{};
  };
  StereoSplit stereo_split_{};
#endif
  std::array<SlowState, kChannels> slow_{};
  std::array<SlowAccumulator, kChannels> accumulator_{};
  std::array<FastChannel, kChannels> recovery_fast_{};
  std::array<SlowState, kChannels> recovery_slow_{};
  std::array<PowerState, kChannels> power_state_{};
  std::array<std::array<PowerLutScratch, 2>, kChannels> power_lut_scratch_{};
  PowerLtpCoefficients power_ltp_{};
  PowerOptCoefficients power_opt_coeff_{};
  PowerLtpQuiescent power_ltp_quiescent_{};
  SeQuiescent se_quiescent_{};
  PowerTubeTables power_tube_tables_ = powerTubeTables(0u);
  std::size_t power_profile_index_ = 2u;
  std::size_t power_speaker_index_ = 1u;
  double power_primary_ohm_ = 8000.0;
  // Actual speaker load divided by the assumed one. Exactly 1.0 at the design point.
  double power_speaker_scale_ = 1.0;
  double power_selected_turns_ratio_ = 31.622776601683792;
  ControlState controls_{};
  std::vector<double> drive_gain_{};
  std::vector<double> output_gain_{};
  std::vector<double> wet_mix_{};
  std::vector<double> input_reference_{};
  std::vector<double> feedback_q_{};
  std::vector<double> feedback_makeup_{};
  std::vector<double> plate_reference_{};
  std::array<FeedbackFilterState, kChannels> feedback_filter_{};
  std::vector<double> fault_wet_{};
  std::vector<double> transition_wet_{};
  std::vector<double> safe_dry_{};
  std::vector<double> safety_user_{};
  // Wet chain observed by the safety detector, staged per channel and consumed per frame. The
  // scalar mix walks channels on the outside, but the detector is stereo-linked and has to see
  // both channels of one frame at once, so the two halves of the mix are separated here. The
  // SIMD path already walks frames on the outside and needs no staging.
  std::vector<double> wet_chain_{};
  std::vector<float> segment_audio_{};
  std::array<std::array<double, kDryDelayFrames>, kChannels> dry_delay_{};
  std::array<std::array<double, 2>, kChannels> last_plate_current_{};
  std::array<float, kTelemetryPayloadFloats> telemetry_payload_{};
  // Output-stage safety reduction. Monotone: safety_auto_gain_ and safety_auto_target_ only ever
  // move downward, and nothing outside a safety-trim change restores them.
  double safety_auto_gain_ = 1.0;
  double safety_auto_target_ = 1.0;
  double safety_auto_step_ = 0.0;
  std::uint32_t safety_auto_remaining_ = 0u;
  // Last committed parameter set. The safety-reduction reset rule compares against this, so it
  // is a snapshot of what was committed rather than of what was applied: several commit paths
  // deliberately leave applied_parameters_ behind.
  Path2Parameters committed_parameters_{};
  // Derived from the host rate once, in prepare(), because it is read on every frame.
  std::uint32_t safety_ramp_frames_ = 1u;
  double maximum_kcl_ = 0.0;
  double maximum_dc_residual_ = 0.0;
  double maximum_energy_residual_ = 0.0;
  std::uint64_t finite_faults_ = 0u;
  std::uint64_t safety_limits_ = 0u;
  std::uint64_t slow_publish_count_ = 0u;
  RuntimeEventState runtime_event_{0u, 0u, kRuntimeCauseNone};
  FeedbackTransitionState feedback_transition_{};
  std::uint64_t central_reset_count_ = 0u;
  CentralResetReason last_central_reset_reason_ = CentralResetReason::none;
  FaultState fault_state_ = FaultState::normal;
  Path2Parameters pending_fault_parameters_{};
  bool pending_fault_parameter_commit_ = false;
  bool fault_reset_pending_ = false;
  bool trial_after_fault_reset_ = false;
  bool fault_clear_pending_ = false;
  double fault_wet_current_ = 1.0;
  std::uint32_t fault_mute_remaining_ = 0u;
  std::uint32_t fault_trial_remaining_ = 0u;
  std::uint32_t fault_return_remaining_ = 0u;
  double detector_input_energy_ = 0.0;
  double detector_output_energy_ = 0.0;
  double detector_feedback_energy_ = 0.0;
  double detector_previous_input_rms_ = 0.0;
  double detector_previous_output_rms_ = 0.0;
  double detector_previous_feedback_rms_ = 0.0;
  std::uint32_t detector_samples_ = 0u;
  std::uint32_t detector_driven_growth_windows_ = 0u;
  std::uint32_t detector_post_input_nondecay_windows_ = 0u;
  bool detector_has_previous_ = false;
  double detector_sustained_input_energy_ = 0.0;
  double detector_sustained_output_energy_ = 0.0;
  double detector_sustained_feedback_energy_ = 0.0;
  double detector_sustained_previous_input_rms_ = 0.0;
  double detector_sustained_previous_output_rms_ = 0.0;
  double detector_sustained_previous_feedback_rms_ = 0.0;
  std::uint32_t detector_sustained_span_ = 0u;
  bool detector_sustained_has_previous_ = false;
  std::uint32_t block_feedback_detection_offset_ = std::numeric_limits<std::uint32_t>::max();
  std::uint64_t processed_host_frames_ = 0u;
  std::uint64_t detection_frame_for_testing_ = std::numeric_limits<std::uint64_t>::max();
  std::uint64_t mute_complete_frame_for_testing_ = std::numeric_limits<std::uint64_t>::max();
  std::uint64_t trial_observation_start_frame_for_testing_ =
      std::numeric_limits<std::uint64_t>::max();
#if ET_TUBE_SIMULATOR_TEST_STATE
  FastKclObservation maximum_fast_kcl_for_testing_{};
  std::uint64_t current_fast_kcl_host_frame_for_testing_ = 0u;
  std::uint64_t current_fast_kcl_internal_frame_for_testing_ = 0u;
  std::uint32_t current_fast_kcl_internal_phase_for_testing_ = 0u;
#endif
  bool step_safety_hit_ = false;
  bool block_finite_fault_ = false;
  bool block_safety_hit_ = false;
  int dry_index_ = 0;
};

// The production object must fit the engine's fixed per-instance storage. The test-state build
// carries diagnostic members (KCL traces, fallback histograms) on top of the production layout
// and only ever lives in the test harness's own storage, which grants it headroom.
#if ET_TUBE_SIMULATOR_TEST_STATE
static_assert(sizeof(TubeSimulatorKernel) <= 12288u);
#else
static_assert(sizeof(TubeSimulatorKernel) <= 8192u);
#endif

} // namespace
} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(TubeSimulatorPlugin, effetune::plugins::saturation::TubeSimulatorKernel)

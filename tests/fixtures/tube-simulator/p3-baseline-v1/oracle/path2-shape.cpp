// Generated mechanically from the immutable P1 source.
#include <array>
#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

#include <emscripten/emscripten.h>

#ifndef P1_USE_SIMD
#define P1_USE_SIMD 1
#endif

#ifndef P1_LUT_ORACLE_EXPORTS
#define P1_LUT_ORACLE_EXPORTS 0
#endif

namespace {

constexpr int kChannels = 2;
constexpr int kHostFrames = 128;
constexpr int kFactor = 4;
constexpr int kInternalFrames = kHostFrames * kFactor;
constexpr int kFirLength = 257;
constexpr int kUpsampleHistory = (kFirLength + kFactor - 1) / kFactor - 1;
constexpr int kDownsampleHistory = kFirLength - 1;
constexpr int kSlowWindow = 24;
constexpr int kResetReplayBlocks = 2;
constexpr int kDryDelayFrames = 64;
constexpr double kHostRate = 96000.0;
constexpr double kInternalRate = kHostRate * kFactor;
constexpr double kFastDt = 1.0 / kInternalRate;
constexpr double kSlowDt = 1.0 / 16000.0;
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
double gCathodeResistance = kBaseCathodeResistance;
double gPlateResistance = kBasePlateResistance;
double gSupplyResistance = 10000.0;
double gSupplyCapacitance = 22e-6;
double gSupplyVoltage = 250.0;
constexpr double kGmin = 1e-9;
constexpr double kGamma = 2.0 - 1.41421356237309504880168872420969808;
constexpr double kPi = 3.141592653589793238462643383279502884;
constexpr double kMinimumMillerCapacitance = 0.25e-12;
constexpr double kMaximumMillerCapacitance = 2e-9;
constexpr double kMaximumGridVoltage = 500.0;
constexpr double kMaximumCouplingEquivalentVoltage = 2000.0;
constexpr double kMinimumLocalPlateGain = -1000.0;
constexpr double kMaximumLocalPlateGain = 100.0;
constexpr double kMaximumOutputVoltage = 1000.0;
constexpr double kControlSmoothingMilliseconds = 5.0;
constexpr double kGridFastPathResidualTolerance = 1e-9;
constexpr double kGridFallbackResidualTolerance = 1e-12;
constexpr int kGridMaximumNewtonCorrections = 3;
constexpr int kGridFallbackMaximumIterations = 64;

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
    {100.0, 0.0010637222, 1.45, -0.5866, 0.15, 25.0, 1.7e-12, 1.6e-12, 0.46e-12,
     1.0, 1.0},
    {60.0, 0.0027035449, 1.4, -0.3788, 0.15, 22.0, 1.5e-12, 2.2e-12, 0.5e-12,
     0.5, 0.47},
    {17.0, 0.00097874385, 1.3, 0.0014, 0.5, 18.0, 1.5e-12, 1.6e-12, 0.5e-12,
     0.4, 0.22},
}};

struct Path2Parameters {
  double driveDb = 0.0;
  int tubeIndex = 0;
  double biasPercent = 0.0;
  double plateV = 250.0;
  double sourceZKOhm = 10.0;
  double supplyKOhm = 10.0;
  double outputDb = 0.0;
  double mixPercent = 100.0;
};

Path2Parameters gPath2Parameters{};
int gTubeIndex = 0;
bool gTubeResetPending = false;
double gSourceResistance = 10000.0;

const TubeParameters &activeTube() { return kTubeRows[gTubeIndex]; }

struct GridEvaluation {
  double current;
  double derivative;
};

struct PlateEvaluation {
  double current;
  double gridDerivative;
  double plateDerivative;
};

struct SlowValue {
  double voltage = 0.0;
  double capacitorCurrent = 0.0;
};

// Fast-rate spline publication of a slow-integrated node voltage; mirrors the production
// kernel's SlowRamp exactly (quadratic B-spline through the published slow values, advanced by
// per-sample slope plus constant curvature, slope re-derived from the current applied value at
// every window boundary).
struct SlowRamp {
  double applied = 0.0;
  double slope = 0.0;
  double curvature = 0.0;
  double previous1 = 0.0;
  double previous2 = 0.0;
};

inline void seedRamp(SlowRamp &ramp, double value) {
  ramp = {value, 0.0, 0.0, value, value};
}

inline void retargetRamp(SlowRamp &ramp, double target, double inverseWindow, double window) {
  const double end = 0.5 * (ramp.previous1 + target);
  const double curvature =
      (target - 2.0 * ramp.previous1 + ramp.previous2) * inverseWindow * inverseWindow;
  ramp.curvature = curvature;
  ramp.slope = (end - ramp.applied) * inverseWindow - curvature * (window - 1.0) * 0.5;
  ramp.previous2 = ramp.previous1;
  ramp.previous1 = target;
}

inline double advanceRamp(SlowRamp &ramp) {
  ramp.applied += ramp.slope;
  ramp.slope += ramp.curvature;
  return ramp.applied;
}

struct SlowState {
  std::array<SlowValue, 2> cathode{};
  SlowValue supply{};
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

struct StageResult {
  double plateCurrent;
  double gridCurrent;
  double iCgk;
  double iCga;
  double iCak;
  double couplingCurrent;
  double maximumPhysicalKcl;
};

#if P1_USE_SIMD
using StereoPair = double __attribute__((ext_vector_type(2)));

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
};
#endif

struct IndependentStageOracle {
  double plateCurrent;
  double gridCurrent;
  double iCgk;
  double iCga;
  double iCak;
  double couplingCurrent;
  double maximumApproximateNonlinearResidual;
  double maximumChargeTransitionIdentity;
  double maximumMillerSplitIdentity;
  double maximumLinearizedTransitionIdentity;
};

struct ControlState {
  double drive = 1.0;
  double driveTarget = 1.0;
  double output = 1.0;
  double outputTarget = 1.0;
  double mix = 1.0;
  double mixTarget = 1.0;
  double coefficient = 1.0;
};

std::array<double, kFirLength> gCoefficients{};
std::array<std::array<double, kUpsampleHistory>, kChannels> gUpsampleState{};
std::array<std::array<double, kDownsampleHistory>, kChannels>
    gDownsampleState{};
std::array<std::array<double, kUpsampleHistory + kHostFrames>, kChannels>
    gHostWork{};
std::array<std::array<double, kDownsampleHistory + kInternalFrames>, kChannels>
    gInternalWork{};
std::array<std::array<double, kInternalFrames>, kChannels> gInternalInput{};
std::array<std::array<double, kInternalFrames>, kChannels> gInternalOutput{};
std::array<std::array<double, kHostFrames>, kChannels> gInput{};
std::array<std::array<double, kHostFrames>, kChannels> gOutput{};
std::array<std::array<double, kDryDelayFrames>, kChannels> gDryDelay{};
std::array<FastChannel, kChannels> gFast{};
std::array<SlowState, kChannels> gSlow{};
std::array<SlowAccumulator, kChannels> gAccumulator{};
ControlState gControls{};
std::array<double, kHostFrames> gDriveGain{};
std::array<double, kHostFrames> gOutputGain{};
std::array<double, kHostFrames> gWetMix{};
std::array<double, 10> gTelemetry{};
std::array<std::array<std::array<double, kHostFrames>, kChannels>, 5>
    gPath2HostObservation{};
std::array<std::array<double, 2>, kChannels> gPath2LastPlateCurrent{};
double gMaximumKcl = 0.0;
double gMaximumDcResidual = 0.0;
double gSanityMaximumQuietSentinelCutSetKcl = 0.0;
double gSanityMaximumDcResidual = 0.0;
double gSanityMaximumNoInputDrift = 0.0;
double gSanityMaximumQuietSentinelPhysicalKcl = 0.0;
double gSanityMaximumIndependentTransientOracleKcl = 0.0;
double gSanityMaximumIndependentTransientOracleDriveDifference = 0.0;
double gSanityMaximumIndependentChargeTransitionIdentity = 0.0;
double gSanityMaximumIndependentMillerSplitIdentity = 0.0;
double gSanityMaximumIndependentOutputTransitionIdentity = 0.0;
double gSanityMaximumIndependentLinearizedTransitionIdentity = 0.0;
int gSanityIndependentTransientOraclePassed = 0;
int gSanityResetReplayBitIdentical = 0;
std::uint64_t gSanityResetReplayFirstFiniteFaults = 0;
std::uint64_t gSanityResetReplayFirstSafetyLimits = 0;
std::uint64_t gSanityResetReplaySecondFiniteFaults = 0;
std::uint64_t gSanityResetReplaySecondSafetyLimits = 0;
std::uint64_t gSanityQuietSentinelFiniteFaults = 0;
std::uint64_t gSanityQuietSentinelSafetyLimits = 0;
std::uint64_t gSanityFiniteFaults = 0;
std::uint64_t gSanitySafetyLimits = 0;
std::uint64_t gFiniteFaults = 0;
std::uint64_t gSafetyLimits = 0;
std::uint64_t gSlowUpdates = 0;
std::uint64_t gObservationFiniteFaultBaseline = 0;
std::uint64_t gObservationSafetyLimitBaseline = 0;
std::uint64_t gObservationSlowUpdateBaseline = 0;
std::array<int, kChannels> gObservationStartSlowPhase{};
std::uint64_t gObservationAcceptedSlowUpdates = 0;
std::uint64_t gObservationAcceptedSlowStartPhaseSum = 0;
std::uint64_t gObservationAcceptedSlowEndPhaseSum = 0;
double gObservationMaximumKcl = 0.0;
bool gObservationActive = false;
bool gStepSafetyHit = false;
bool gBlockFiniteFault = false;
bool gBlockSafetyHit = false;
int gDryIndex = 0;
int gPrepared = 0;

std::array<std::array<std::array<double, kHostFrames>, kChannels>,
           kResetReplayBlocks>
    gReplayOutput{};
std::array<FastChannel, kChannels> gReplayFast{};
std::array<SlowState, kChannels> gReplaySlow{};
std::array<SlowAccumulator, kChannels> gReplayAccumulator{};
std::array<std::array<double, kUpsampleHistory>, kChannels> gReplayUpsample{};
std::array<std::array<double, kDownsampleHistory>, kChannels>
    gReplayDownsample{};
std::array<std::array<double, kDryDelayFrames>, kChannels> gReplayDry{};
ControlState gReplayControls{};
std::array<double, 10> gReplayTelemetry{};
double gReplayMaximumKcl = 0.0;
double gReplayMaximumDcResidual = 0.0;
std::uint64_t gReplayFiniteFaults = 0;
std::uint64_t gReplaySafetyLimits = 0;
std::uint64_t gReplaySlowUpdates = 0;
int gReplayDryIndex = 0;

std::array<FastChannel, kChannels> gZeroBaselineFast{};
std::array<SlowState, kChannels> gZeroBaselineSlow{};
std::array<FastChannel, kChannels> gRecoveryFast{};
std::array<SlowState, kChannels> gRecoverySlow{};
double gMaximumNoInputDrift = 0.0;
double gMaximumNoInputPhysicalKcl = 0.0;
bool gTrackNoInputDrift = false;
bool gTrackIndependentTransientOracle = false;
bool gIndependentTransientOraclePassed = true;
double gMaximumIndependentTransientOracleKcl = 0.0;
double gMaximumIndependentTransientOracleDriveDifference = 0.0;
double gMaximumIndependentChargeTransitionIdentity = 0.0;
double gMaximumIndependentMillerSplitIdentity = 0.0;
double gMaximumIndependentOutputTransitionIdentity = 0.0;
double gMaximumIndependentLinearizedTransitionIdentity = 0.0;

double absolute(double value) { return value >= 0.0 ? value : -value; }

void applyPath2Parameters(bool resetControls) {
  const TubeParameters &tube = activeTube();
  gCathodeResistance = kBaseCathodeResistance * tube.cathodeResistanceScale *
                       std::pow(2.0, -gPath2Parameters.biasPercent / 50.0);
  gPlateResistance = kBasePlateResistance * tube.plateResistanceScale;
  gSourceResistance = 1000.0 * gPath2Parameters.sourceZKOhm;
  gSupplyResistance = 1000.0 * gPath2Parameters.supplyKOhm;
  gSupplyCapacitance = 22e-6 * 10000.0 / gSupplyResistance;
  gSupplyVoltage = gPath2Parameters.plateV;
  const double drive = std::pow(10.0, gPath2Parameters.driveDb / 20.0);
  const double output = std::pow(10.0, gPath2Parameters.outputDb / 20.0);
  const double mix = gPath2Parameters.mixPercent / 100.0;
  gControls.driveTarget = drive;
  gControls.outputTarget = output;
  gControls.mixTarget = mix;
  if (resetControls) {
    gControls.drive = drive;
    gControls.output = output;
    gControls.mix = mix;
  }
}

double clampValue(double value, double low, double high) {
  return value < low ? low : (value > high ? high : value);
}

double safetyBound(double value, double low, double high) {
  if (value < low) {
    ++gSafetyLimits;
    gStepSafetyHit = true;
    return low;
  }
  if (value > high) {
    ++gSafetyLimits;
    gStepSafetyHit = true;
    return high;
  }
  return value;
}

template <std::size_t Size>
bool finiteArray(const std::array<double, Size> &values) {
  for (double value : values) {
    if (!std::isfinite(value))
      return false;
  }
  return true;
}

bool bitEqual(double left, double right) {
  return std::bit_cast<std::uint64_t>(left) ==
         std::bit_cast<std::uint64_t>(right);
}

double polynomialExp(double value) {
  constexpr double inverseLn2 = 1.44269504088896340735992468100189214;
  constexpr double ln2 = 0.693147180559945309417232121458176568;
  if (value < -700.0)
    return 0.0;
  if (value > 700.0)
    return std::numeric_limits<double>::infinity();
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
  const std::uint64_t scaleBits = static_cast<std::uint64_t>(exponent + 1023)
                                  << 52;
  return polynomial * std::bit_cast<double>(scaleBits);
}

double polynomialLog(double value) {
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
  return 2.0 * ratio * series +
         exponent * 0.693147180559945309417232121458176568;
}

double polynomialPowPositive(double value, double exponent) {
  return value > 0.0 ? polynomialExp(exponent * polynomialLog(value)) : 0.0;
}

double exactSoftplus(double value) {
  if (value > 32.0)
    return value;
  if (value < -32.0)
    return std::exp(value);
  return std::log1p(std::exp(value));
}

GridEvaluation directGrid(double vgk) {
  const double z = (vgk - kGridOn) / kGridScale;
  const double softplus = exactSoftplus(z);
  const double exponential = std::exp(z >= 0.0 ? -z : z);
  const double sigmoid =
      z >= 0.0 ? 1.0 / (1.0 + exponential) : exponential / (1.0 + exponential);
  const double u = kGridScale * softplus;
  const double powered = std::pow(u, kGridAlpha);
  const double derivative =
      u > 0.0 ? kGridK * kGridAlpha * std::pow(u, kGridAlpha - 1.0) * sigmoid
              : 0.0;
  return {kGridK * powered, derivative};
}

PlateEvaluation directPlate(double vgk, double vak) {
  const double z =
      (vgk + vak / activeTube().mu - activeTube().v0) / activeTube().sc;
  const double softplus = exactSoftplus(z);
  const double exponential = std::exp(z >= 0.0 ? -z : z);
  const double sigmoid =
      z >= 0.0 ? 1.0 / (1.0 + exponential) : exponential / (1.0 + exponential);
  const double u = activeTube().sc * softplus;
  const double powered = std::pow(u, activeTube().alpha);
  const double amplitude = activeTube().ka * powered;
  const double amplitudeDerivative =
      u > 0.0 ? activeTube().ka * activeTube().alpha *
                    std::pow(u, activeTube().alpha - 1.0) * sigmoid
              : 0.0;
  double factor = 0.0;
  double factorDerivative = 0.0;
  if (vak > 0.0) {
    const double plateExponential = std::exp(-vak / activeTube().vs);
    factor = 1.0 - plateExponential;
    factorDerivative = plateExponential / activeTube().vs;
  }
  return {amplitude * factor, amplitudeDerivative * factor,
          amplitudeDerivative * factor / activeTube().mu +
              amplitude * factorDerivative};
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
      const auto first = generator(minimum + index * step);
      const auto second = generator(minimum + (index + 1) * step);
      const double delta = second[0] - first[0];
      coefficient0[index] = first[0];
      coefficient1[index] = step * first[1];
      coefficient2[index] = 3.0 * delta - step * (2.0 * first[1] + second[1]);
      coefficient3[index] = -2.0 * delta + step * (first[1] + second[1]);
    }
  }

  std::array<double, 2> evaluate(double input) const {
    const double limited =
        input < minimum ? minimum : (input > maximum ? maximum : input);
    const double position = (limited - minimum) * inverseStep;
    std::size_t index = static_cast<std::size_t>(position);
    if (index >= SegmentCount)
      index = SegmentCount - 1;
    const double t = position - index;
    const double a = coefficient0[index];
    const double b = coefficient1[index];
    const double c = coefficient2[index];
    const double d = coefficient3[index];
    return {((d * t + c) * t + b) * t + a,
            ((3.0 * d * t + 2.0 * c) * t + b) * inverseStep};
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
        plateAmplitude(tube.sc > 0.25 ? -24.0 * tube.sc : -6.0,
                       2.0 + 350.0 / tube.mu - tube.v0,
                       [tube](double s) {
                         const double z = s / tube.sc;
                         const double softplus = exactSoftplus(z);
                         const double exponential = std::exp(z >= 0.0 ? -z : z);
                         const double sigmoid =
                             z >= 0.0 ? 1.0 / (1.0 + exponential)
                                      : exponential / (1.0 + exponential);
                         const double u = tube.sc * softplus;
                         const double powered = std::pow(u, tube.alpha);
                         return std::array<double, 2>{
                             tube.ka * powered,
                             u > 0.0
                                 ? tube.ka * tube.alpha *
                                       std::pow(u, tube.alpha - 1.0) * sigmoid
                                 : 0.0};
                       }),
        plateFactor(0.0, 350.0,
                    [tube](double vak) {
                      const double exponential = std::exp(-vak / tube.vs);
                      return std::array<double, 2>{1.0 - exponential,
                                                   exponential / tube.vs};
                    }),
        gridCurrent(-2.0, 2.0, [](double vgk) {
          const GridEvaluation grid = directGrid(vgk);
          return std::array<double, 2>{grid.current, grid.derivative};
        }) {}

  PlateEvaluation evaluatePlate(double vgk, double vak) const {
    const double s = vgk + vak / mu - v0;
    const auto amplitude = s <= plateAmplitude.minimum
                               ? std::array<double, 2>{0.0, 0.0}
                               : plateAmplitude.evaluate(s);
    const auto factor = vak <= 0.0 ? std::array<double, 2>{0.0, 0.0}
                                   : plateFactor.evaluate(vak);
    return {amplitude[0] * factor[0], amplitude[1] * factor[0],
            amplitude[1] * factor[0] / mu + amplitude[0] * factor[1]};
  }

  GridEvaluation evaluateGrid(double vgk) const {
    if (vgk <= gridCurrent.minimum)
      return {0.0, 0.0};
    const auto grid = gridCurrent.evaluate(vgk);
    return {grid[0], grid[1]};
  }
};

const std::array<TubeTables, 3> &tubeTables() {
  static const std::array<TubeTables, 3> tables = {TubeTables{kTubeRows[0]},
                                                   TubeTables{kTubeRows[1]},
                                                   TubeTables{kTubeRows[2]}};
  return tables;
}

const TubeTables &tubeTable() { return tubeTables()[gTubeIndex]; }

GridEvaluation evaluateGrid(double vgk) {
  return tubeTable().evaluateGrid(vgk);
}

PlateEvaluation evaluatePlate(double vgk, double vak) {
  return tubeTable().evaluatePlate(vgk, vak);
}

double besselI0(double value) {
  const double magnitude = value >= 0.0 ? value : -value;
  double term = 1.0;
  double sum = 1.0;
  const double squared = magnitude * magnitude * 0.25;
  for (int index = 1; index < 40; ++index) {
    term *= squared / static_cast<double>(index * index);
    sum += term;
    if (term < sum * 1.0e-16)
      break;
  }
  return sum;
}

void designFir() {
  constexpr double beta = 16.0;
  constexpr double cutoff = 34000.0 / kInternalRate;
  constexpr double center = (kFirLength - 1) * 0.5;
  const double inverseI0 = 1.0 / besselI0(beta);
  double sum = 0.0;
  for (int index = 0; index < kFirLength; ++index) {
    const double offset = static_cast<double>(index) - center;
    const double sinc =
        offset == 0.0 ? 2.0 * cutoff
                      : std::sin(2.0 * kPi * cutoff * offset) / (kPi * offset);
    const double ratio = offset / center;
    const double window =
        besselI0(beta * std::sqrt(1.0 - ratio * ratio)) * inverseI0;
    gCoefficients[index] = sinc * window;
    sum += gCoefficients[index];
  }
  for (double &coefficient : gCoefficients)
    coefficient /= sum;
}

SlowValue trBdf2Step(const SlowValue &state, double capacitance,
                     double conductance, double drive) {
  const double derivative1 = 2.0 / (kGamma * kSlowDt);
  const double history1 =
      -capacitance * derivative1 * state.voltage - state.capacitorCurrent;
  const double stageVoltage =
      (drive - history1) / (conductance + capacitance * derivative1);
  const double derivative2 = (2.0 - kGamma) / ((1.0 - kGamma) * kSlowDt);
  const double coefficient1 = -1.0 / (kGamma * (1.0 - kGamma) * kSlowDt);
  const double coefficient0 = (1.0 - kGamma) / (kGamma * kSlowDt);
  const double history2 = capacitance * (coefficient1 * stageVoltage +
                                         coefficient0 * state.voltage);
  const double voltage =
      (drive - history2) / (conductance + capacitance * derivative2);
  const double current = capacitance * derivative2 * voltage + history2;
  return {voltage, current};
}

void solveDc(SlowState &slow, FastChannel &fast) {
  double p = gSupplyVoltage;
  std::array<double, 2> vk = {1.0, 1.0};
  std::array<double, 2> vg = {0.0, 0.0};
  std::array<double, 2> va = {140.0, 140.0};
  std::array<PlateEvaluation, 2> plate{};
  std::array<GridEvaluation, 2> grid{};
  for (int iteration = 0; iteration < 8192; ++iteration) {
    for (int stage = 0; stage < 2; ++stage) {
      for (int gridIteration = 0; gridIteration < 8; ++gridIteration) {
        grid[stage] = evaluateGrid(vg[stage] - vk[stage]);
        const double residual =
            vg[stage] / kGridLeakResistance + grid[stage].current;
        vg[stage] -=
            residual / (1.0 / kGridLeakResistance + grid[stage].derivative);
      }
      plate[stage] =
          evaluatePlate(vg[stage] - vk[stage], va[stage] - vk[stage]);
    }
    const double targetP = (gSupplyVoltage / gSupplyResistance -
                            plate[0].current - plate[1].current) /
                           (1.0 / gSupplyResistance + kGmin);
    p += 0.025 * (targetP - p);
    for (int stage = 0; stage < 2; ++stage) {
      const double targetVk = (plate[stage].current + grid[stage].current) /
                              (1.0 / gCathodeResistance + kGmin);
      const double targetVa = p - gPlateResistance * plate[stage].current;
      vk[stage] += 0.025 * (targetVk - vk[stage]);
      va[stage] += 0.025 * (targetVa - va[stage]);
    }
  }
  slow.cathode[0] = {vk[0], 0.0};
  slow.cathode[1] = {vk[1], 0.0};
  slow.supply = {p, 0.0};
  seedRamp(slow.cathodeRamp[0], vk[0]);
  seedRamp(slow.cathodeRamp[1], vk[1]);
  seedRamp(slow.supplyRamp, p);
  for (int stage = 0; stage < 2; ++stage) {
    FastStage &state = fast.stage[stage];
    plate[stage] = evaluatePlate(vg[stage] - vk[stage], va[stage] - vk[stage]);
    const double denominator =
        1.0 + gPlateResistance * plate[stage].plateDerivative;
    state.gridVoltage = vg[stage];
    state.plateVoltage = va[stage];
    state.couplingCharge = stage == 0
                               ? kCouplingCapacitance * (0.0 - vg[stage])
                               : kCouplingCapacitance * (va[0] - vg[stage]);
    state.millerVoltage = vg[stage];
    state.localPlateGain =
        -gPlateResistance * plate[stage].gridDerivative / denominator;
    state.millerCapacitance =
        activeTube().cgk + activeTube().cga * (1.0 - state.localPlateGain);
    state.outputResistance = gPlateResistance / denominator;
    state.previousVak = va[stage] - vk[stage];
  }
  fast.outputCouplingCharge = kOutputCapacitance * va[1];
  fast.outputLoadCurrent = 0.0;
  const double gridResidual0 =
      absolute(vg[0] / kGridLeakResistance + grid[0].current);
  const double gridResidual1 =
      absolute(vg[1] / kGridLeakResistance + grid[1].current);
  const double cathodeResidual0 =
      absolute((1.0 / gCathodeResistance + kGmin) * vk[0] - plate[0].current -
               grid[0].current);
  const double cathodeResidual1 =
      absolute((1.0 / gCathodeResistance + kGmin) * vk[1] - plate[1].current -
               grid[1].current);
  const double plateResidual0 =
      absolute((p - va[0]) / gPlateResistance - plate[0].current);
  const double plateResidual1 =
      absolute((p - va[1]) / gPlateResistance - plate[1].current);
  const double supplyResidual =
      absolute((1.0 / gSupplyResistance + kGmin) * p + plate[0].current +
               plate[1].current - gSupplyVoltage / gSupplyResistance);
  const std::array<double, 7> residuals = {
      gridResidual0,  gridResidual1,  cathodeResidual0, cathodeResidual1,
      plateResidual0, plateResidual1, supplyResidual};
  for (double residual : residuals) {
    if (residual > gMaximumDcResidual)
      gMaximumDcResidual = residual;
  }
}

void resetModel() {
  gMaximumKcl = 0.0;
  gMaximumDcResidual = 0.0;
  gMaximumNoInputDrift = 0.0;
  gMaximumNoInputPhysicalKcl = 0.0;
  gTrackNoInputDrift = false;
  gFiniteFaults = 0;
  gSafetyLimits = 0;
  gSlowUpdates = 0;
  gObservationFiniteFaultBaseline = 0;
  gObservationSafetyLimitBaseline = 0;
  gObservationSlowUpdateBaseline = 0;
  gObservationStartSlowPhase.fill(0);
  gObservationAcceptedSlowUpdates = 0;
  gObservationAcceptedSlowStartPhaseSum = 0;
  gObservationAcceptedSlowEndPhaseSum = 0;
  gObservationMaximumKcl = 0.0;
  gObservationActive = false;
  gStepSafetyHit = false;
  gBlockFiniteFault = false;
  gBlockSafetyHit = false;
  gDryIndex = 0;
  gControls = ControlState{};
  gControls.coefficient =
      1.0 - std::exp(-1000.0 / (kControlSmoothingMilliseconds * kHostRate));
  applyPath2Parameters(true);
  gTubeResetPending = false;
  gTelemetry.fill(0.0);
  for (int channel = 0; channel < kChannels; ++channel) {
    gFast[channel] = FastChannel{};
    gSlow[channel] = SlowState{};
    gAccumulator[channel] = SlowAccumulator{};
    solveDc(gSlow[channel], gFast[channel]);
    gUpsampleState[channel].fill(0.0);
    gDownsampleState[channel].fill(0.0);
    gDryDelay[channel].fill(0.0);
  }
  gRecoveryFast = gFast;
  gRecoverySlow = gSlow;
}

constexpr double kMinimumPhysicalPlateVoltage = -100.0;
constexpr double kMaximumPhysicalPlateVoltage = 600.0;
constexpr double kPlateFastPathResidualTolerance = 1e-9;
constexpr double kPlateFallbackResidualTolerance = 1e-12;
constexpr int kPlateFallbackMaximumIterations = 32;

struct PlateSolveResult {
  double vak;
  PlateEvaluation plate;
  bool converged;
};

double plateLoadLineResidual(double vak, const PlateEvaluation &plate,
                             double delayedP, double vk,
                             double delayedOutputLoadCurrent) {
  return (delayedP - (vak + vk)) / gPlateResistance - plate.current -
         delayedOutputLoadCurrent;
}

bool plateCandidateNeedsFallback(double vak, const PlateEvaluation &plate,
                                 double delayedP, double vk,
                                 double delayedOutputLoadCurrent) {
  const double plateVoltage = vak + vk;
  if (!std::isfinite(vak) || !std::isfinite(plateVoltage) ||
      vak < kMinimumPhysicalPlateVoltage ||
      vak > kMaximumPhysicalPlateVoltage ||
      plateVoltage < kMinimumPhysicalPlateVoltage ||
      plateVoltage > kMaximumPhysicalPlateVoltage) {
    return true;
  }
  const double residual =
      plateLoadLineResidual(vak, plate, delayedP, vk, delayedOutputLoadCurrent);
  return !std::isfinite(residual) ||
         absolute(residual) > kPlateFastPathResidualTolerance;
}

void refinePlateCandidateOnce(double vgk, double delayedP, double vk,
                              double delayedOutputLoadCurrent, double &vak,
                              PlateEvaluation &plate) {
  const double residual =
      plateLoadLineResidual(vak, plate, delayedP, vk, delayedOutputLoadCurrent);
  if (!std::isfinite(residual) ||
      absolute(residual) <= kPlateFastPathResidualTolerance) {
    return;
  }
  const double derivative = -1.0 / gPlateResistance - plate.plateDerivative;
  vak -= residual / derivative;
  plate = evaluatePlate(vgk, vak);
}

PlateSolveResult solvePlateFallback(double vgk, double delayedP, double vk,
                                    double delayedOutputLoadCurrent,
                                    double fastVak,
                                    const PlateEvaluation &fastPlate) {
  double lowerVak = kMinimumPhysicalPlateVoltage;
  const double lowerPlateVak = kMinimumPhysicalPlateVoltage - vk;
  if (lowerPlateVak > lowerVak)
    lowerVak = lowerPlateVak;
  double upperVak = kMaximumPhysicalPlateVoltage;
  const double upperPlateVak = kMaximumPhysicalPlateVoltage - vk;
  if (upperPlateVak < upperVak)
    upperVak = upperPlateVak;
  if (!std::isfinite(lowerVak) || !std::isfinite(upperVak) ||
      lowerVak > upperVak) {
    return {fastVak, fastPlate, false};
  }

  PlateEvaluation lowerPlate = evaluatePlate(vgk, lowerVak);
  PlateEvaluation upperPlate = evaluatePlate(vgk, upperVak);
  const double lowerResidual = plateLoadLineResidual(
      lowerVak, lowerPlate, delayedP, vk, delayedOutputLoadCurrent);
  const double upperResidual = plateLoadLineResidual(
      upperVak, upperPlate, delayedP, vk, delayedOutputLoadCurrent);
  if (!std::isfinite(lowerResidual) || !std::isfinite(upperResidual)) {
    return {fastVak, fastPlate, false};
  }
  if (absolute(lowerResidual) <= kPlateFallbackResidualTolerance)
    return {lowerVak, lowerPlate, true};
  if (absolute(upperResidual) <= kPlateFallbackResidualTolerance)
    return {upperVak, upperPlate, true};
  if (lowerResidual < 0.0 || upperResidual > 0.0)
    return {fastVak, fastPlate, false};

  double candidateVak = 0.5 * (lowerVak + upperVak);
  for (int iteration = 0; iteration < kPlateFallbackMaximumIterations;
       ++iteration) {
    const PlateEvaluation candidatePlate = evaluatePlate(vgk, candidateVak);
    const double candidateResidual = plateLoadLineResidual(
        candidateVak, candidatePlate, delayedP, vk, delayedOutputLoadCurrent);
    if (!std::isfinite(candidateResidual)) {
      return {fastVak, fastPlate, false};
    }
    if (absolute(candidateResidual) <= kPlateFallbackResidualTolerance)
      return {candidateVak, candidatePlate, true};

    if (candidateResidual > 0.0) {
      lowerVak = candidateVak;
    } else {
      upperVak = candidateVak;
    }
    const double derivative =
        -1.0 / gPlateResistance - candidatePlate.plateDerivative;
    const double newtonVak = candidateVak - candidateResidual / derivative;
    candidateVak =
        std::isfinite(newtonVak) && newtonVak > lowerVak && newtonVak < upperVak
            ? newtonVak
            : 0.5 * (lowerVak + upperVak);
  }

  const PlateEvaluation candidatePlate = evaluatePlate(vgk, candidateVak);
  const double candidateResidual = plateLoadLineResidual(
      candidateVak, candidatePlate, delayedP, vk, delayedOutputLoadCurrent);
  return std::isfinite(candidateResidual) &&
                 absolute(candidateResidual) <= kPlateFallbackResidualTolerance
             ? PlateSolveResult{candidateVak, candidatePlate, true}
             : PlateSolveResult{fastVak, fastPlate, false};
}

StageResult advanceStage(FastStage &stage, double sourceVoltage,
                         double sourceResistance, double delayedP, double vk,
                         double delayedOutputLoadCurrent) {
  const double oldGrid = stage.gridVoltage;
  const double oldCharge = stage.couplingCharge;
  const double cm =
      safetyBound(stage.millerCapacitance, kMinimumMillerCapacitance,
                  kMaximumMillerCapacitance);
  const double millerConductance = cm / kFastDt;
  const double seriesResistance =
      sourceResistance + kFastDt / kCouplingCapacitance;
  const double passiveNumerator =
      sourceVoltage - oldCharge / kCouplingCapacitance +
      seriesResistance * millerConductance * stage.millerVoltage;
  const double passiveDenominator =
      1.0 + seriesResistance * (1.0 / kGridLeakResistance + millerConductance);
  const double passiveGrid = passiveNumerator / passiveDenominator;
  const double passiveVgk = passiveGrid - vk;
  const double lambda = seriesResistance / passiveDenominator;
  const GridEvaluation upper = evaluateGrid(passiveVgk);
  double lowerVgk = passiveVgk - lambda * upper.current;
  if (passiveVgk > kGridOn - 2.0 && lowerVgk < kGridOn - 2.0) {
    lowerVgk = kGridOn - 2.0;
  }
  double predictorVgk = passiveVgk;
  const double overdrive = passiveVgk - kGridOn;
  if (overdrive > 0.0 && lambda * upper.current > 1e-18) {
    const double loading = lambda * kGridK * std::sqrt(overdrive);
    predictorVgk = kGridOn + overdrive * polynomialPowPositive(
                                             1.0 + 1.5 * loading, -2.0 / 3.0);
  }
  predictorVgk = clampValue(predictorVgk, lowerVgk, passiveVgk);
  const double physicalResidualScale = passiveDenominator / sourceResistance;
  double vgk = predictorVgk;
  GridEvaluation grid = evaluateGrid(vgk);
  double gridEquationResidual = vgk + lambda * grid.current - passiveVgk;
  double absoluteGridResidual =
      absolute(physicalResidualScale * gridEquationResidual);
  for (int correction = 0;
       correction < kGridMaximumNewtonCorrections &&
       absoluteGridResidual > kGridFastPathResidualTolerance;
       ++correction) {
    vgk -= gridEquationResidual / (1.0 + lambda * grid.derivative);
    vgk = clampValue(vgk, lowerVgk, passiveVgk);
    grid = evaluateGrid(vgk);
    gridEquationResidual = vgk + lambda * grid.current - passiveVgk;
    absoluteGridResidual =
        absolute(physicalResidualScale * gridEquationResidual);
  }
  if (absoluteGridResidual > kGridFastPathResidualTolerance) {
    double fallbackLow = lowerVgk;
    double fallbackHigh = passiveVgk;
    for (int iteration = 0;
         iteration < kGridFallbackMaximumIterations &&
         absoluteGridResidual > kGridFallbackResidualTolerance;
         ++iteration) {
      vgk = 0.5 * (fallbackLow + fallbackHigh);
      grid = evaluateGrid(vgk);
      gridEquationResidual = vgk + lambda * grid.current - passiveVgk;
      if (gridEquationResidual > 0.0) {
        fallbackHigh = vgk;
      } else {
        fallbackLow = vgk;
      }
      absoluteGridResidual =
          absolute(physicalResidualScale * gridEquationResidual);
    }
    if (absoluteGridResidual > kGridFallbackResidualTolerance) {
      ++gSafetyLimits;
      gStepSafetyHit = true;
    }
  }
  const double gridVoltage =
      safetyBound(vgk + vk, -kMaximumGridVoltage, kMaximumGridVoltage);
  vgk = gridVoltage - vk;
  grid = evaluateGrid(vgk);
  const double iM = millerConductance * (gridVoltage - stage.millerVoltage);
  const double seriesCurrent =
      gridVoltage / kGridLeakResistance + grid.current + iM;
  const double nextCharge =
      safetyBound(oldCharge + kFastDt * seriesCurrent,
                  -kCouplingCapacitance * kMaximumCouplingEquivalentVoltage,
                  kCouplingCapacitance * kMaximumCouplingEquivalentVoltage);

  const PlateEvaluation platePredictor = evaluatePlate(vgk, stage.previousVak);
  const double plateDenominator =
      1.0 + gPlateResistance * platePredictor.plateDerivative;
  double vak =
      (delayedP - vk -
       gPlateResistance * (platePredictor.current -
                           platePredictor.plateDerivative * stage.previousVak +
                           delayedOutputLoadCurrent)) /
      plateDenominator;
  PlateEvaluation plate = evaluatePlate(vgk, vak);
  refinePlateCandidateOnce(vgk, delayedP, vk, delayedOutputLoadCurrent, vak,
                           plate);
  if (plateCandidateNeedsFallback(vak, plate, delayedP, vk,
                                  delayedOutputLoadCurrent)) {
    const PlateSolveResult fallback = solvePlateFallback(
        vgk, delayedP, vk, delayedOutputLoadCurrent, vak, plate);
    if (fallback.converged) {
      vak = fallback.vak;
      plate = fallback.plate;
    } else {
      ++gSafetyLimits;
      gStepSafetyHit = true;
    }
  }
  const double plateVoltage = vak + vk;
  const double derivativeDenominator =
      1.0 + gPlateResistance * plate.plateDerivative;
  const double localGain = safetyBound(
      -gPlateResistance * plate.gridDerivative / derivativeDenominator,
      kMinimumLocalPlateGain, kMaximumLocalPlateGain);
  const double nextCm =
      safetyBound(activeTube().cgk + activeTube().cga * (1.0 - localGain),
                  kMinimumMillerCapacitance, kMaximumMillerCapacitance);
  const double iCgk = activeTube().cgk / cm * iM;
  const double iCga = activeTube().cga * (1.0 - stage.localPlateGain) / cm * iM;
  const double iCak = activeTube().cak * (vak - stage.previousVak) / kFastDt;
  const double couplingCurrent = (nextCharge - oldCharge) / kFastDt;
  const double sourceBranchCurrent =
      (sourceVoltage - gridVoltage - nextCharge / kCouplingCapacitance) /
      sourceResistance;
  const double gridResidual =
      absolute(sourceBranchCurrent - gridVoltage / kGridLeakResistance -
               grid.current - iM);
  const double couplingResidual = absolute(couplingCurrent - seriesCurrent);
  const double millerSplitResidual = absolute(iM - iCgk - iCga);
  const double plateResidual =
      absolute((delayedP - plateVoltage) / gPlateResistance - plate.current -
               delayedOutputLoadCurrent);
  double maximumPhysicalKcl =
      gridResidual > couplingResidual ? gridResidual : couplingResidual;
  if (millerSplitResidual > maximumPhysicalKcl) {
    maximumPhysicalKcl = millerSplitResidual;
  }
  if (plateResidual > maximumPhysicalKcl) {
    maximumPhysicalKcl = plateResidual;
  }

  stage.gridVoltage = gridVoltage;
  stage.plateVoltage = plateVoltage;
  stage.couplingCharge = nextCharge;
  stage.millerVoltage = gridVoltage;
  stage.millerCapacitance = nextCm;
  stage.localPlateGain = localGain;
  stage.outputResistance = gPlateResistance / derivativeDenominator;
  stage.previousVak = vak;
  return {plate.current,   grid.current,      iCgk, iCga, iCak,
          couplingCurrent, maximumPhysicalKcl};
}

#if P1_USE_SIMD
GridEvaluationPair evaluateGridPair(StereoPair vgk) {
  const GridEvaluation left = evaluateGrid(vgk[0]);
  const GridEvaluation right = evaluateGrid(vgk[1]);
  return {{left.current, right.current}, {left.derivative, right.derivative}};
}

PlateEvaluationPair evaluatePlatePair(StereoPair vgk, StereoPair vak) {
  const PlateEvaluation left = evaluatePlate(vgk[0], vak[0]);
  const PlateEvaluation right = evaluatePlate(vgk[1], vak[1]);
  return {{left.current, right.current},
          {left.gridDerivative, right.gridDerivative},
          {left.plateDerivative, right.plateDerivative}};
}

StereoPair clampPair(StereoPair value, StereoPair low, StereoPair high) {
  for (int lane = 0; lane < kChannels; ++lane) {
    value[lane] = clampValue(value[lane], low[lane], high[lane]);
  }
  return value;
}

StereoPair safetyBoundPair(StereoPair value, double low, double high,
                           std::array<bool, kChannels> &safetyHit) {
  for (int lane = 0; lane < kChannels; ++lane) {
    if (value[lane] < low) {
      ++gSafetyLimits;
      safetyHit[lane] = true;
      value[lane] = low;
    } else if (value[lane] > high) {
      ++gSafetyLimits;
      safetyHit[lane] = true;
      value[lane] = high;
    }
  }
  return value;
}

StageResultPair advanceStagePair(int stageIndex, StereoPair sourceVoltage,
                                 StereoPair sourceResistance,
                                 StereoPair delayedP, StereoPair vk,
                                 StereoPair delayedOutputLoadCurrent,
                                 std::array<bool, kChannels> &safetyHit) {
  StereoPair oldCharge;
  StereoPair millerVoltage;
  StereoPair millerCapacitance;
  StereoPair localPlateGain;
  StereoPair previousVak;
  for (int lane = 0; lane < kChannels; ++lane) {
    const FastStage &stage = gFast[lane].stage[stageIndex];
    oldCharge[lane] = stage.couplingCharge;
    millerVoltage[lane] = stage.millerVoltage;
    millerCapacitance[lane] = stage.millerCapacitance;
    localPlateGain[lane] = stage.localPlateGain;
    previousVak[lane] = stage.previousVak;
  }

  const StereoPair cm =
      safetyBoundPair(millerCapacitance, kMinimumMillerCapacitance,
                      kMaximumMillerCapacitance, safetyHit);
  const StereoPair millerConductance = cm / kFastDt;
  const StereoPair seriesResistance =
      sourceResistance + kFastDt / kCouplingCapacitance;
  const StereoPair passiveNumerator =
      sourceVoltage - oldCharge / kCouplingCapacitance +
      seriesResistance * millerConductance * millerVoltage;
  const StereoPair passiveDenominator =
      1.0 + seriesResistance * (1.0 / kGridLeakResistance + millerConductance);
  const StereoPair passiveGrid = passiveNumerator / passiveDenominator;
  const StereoPair passiveVgk = passiveGrid - vk;
  const StereoPair lambda = seriesResistance / passiveDenominator;
  const GridEvaluationPair upper = evaluateGridPair(passiveVgk);
  StereoPair lowerVgk = passiveVgk - lambda * upper.current;
  StereoPair predictorVgk = passiveVgk;
  for (int lane = 0; lane < kChannels; ++lane) {
    if (passiveVgk[lane] > kGridOn - 2.0 && lowerVgk[lane] < kGridOn - 2.0) {
      lowerVgk[lane] = kGridOn - 2.0;
    }
    const double overdrive = passiveVgk[lane] - kGridOn;
    if (overdrive > 0.0 && lambda[lane] * upper.current[lane] > 1e-18) {
      const double loading = lambda[lane] * kGridK * std::sqrt(overdrive);
      predictorVgk[lane] =
          kGridOn +
          overdrive * polynomialPowPositive(1.0 + 1.5 * loading, -2.0 / 3.0);
    }
  }
  predictorVgk = clampPair(predictorVgk, lowerVgk, passiveVgk);
  const StereoPair physicalResidualScale =
      passiveDenominator / sourceResistance;
  StereoPair vgk = predictorVgk;
  GridEvaluationPair grid = evaluateGridPair(vgk);
  StereoPair gridEquationResidual = vgk + lambda * grid.current - passiveVgk;
  for (int correction = 0; correction < kGridMaximumNewtonCorrections;
       ++correction) {
    bool needsCorrection = false;
    for (int lane = 0; lane < kChannels; ++lane) {
      if (absolute(physicalResidualScale[lane] * gridEquationResidual[lane]) <=
          kGridFastPathResidualTolerance) {
        continue;
      }
      vgk[lane] -= gridEquationResidual[lane] /
                   (1.0 + lambda[lane] * grid.derivative[lane]);
      vgk[lane] = clampValue(vgk[lane], lowerVgk[lane], passiveVgk[lane]);
      needsCorrection = true;
    }
    if (!needsCorrection) {
      break;
    }
    grid = evaluateGridPair(vgk);
    gridEquationResidual = vgk + lambda * grid.current - passiveVgk;
  }
  for (int lane = 0; lane < kChannels; ++lane) {
    double absoluteGridResidual =
        absolute(physicalResidualScale[lane] * gridEquationResidual[lane]);
    if (absoluteGridResidual <= kGridFastPathResidualTolerance) {
      continue;
    }
    double fallbackLow = lowerVgk[lane];
    double fallbackHigh = passiveVgk[lane];
    for (int iteration = 0;
         iteration < kGridFallbackMaximumIterations &&
         absoluteGridResidual > kGridFallbackResidualTolerance;
         ++iteration) {
      vgk[lane] = 0.5 * (fallbackLow + fallbackHigh);
      const GridEvaluation laneGrid = evaluateGrid(vgk[lane]);
      grid.current[lane] = laneGrid.current;
      grid.derivative[lane] = laneGrid.derivative;
      gridEquationResidual[lane] =
          vgk[lane] + lambda[lane] * laneGrid.current - passiveVgk[lane];
      if (gridEquationResidual[lane] > 0.0) {
        fallbackHigh = vgk[lane];
      } else {
        fallbackLow = vgk[lane];
      }
      absoluteGridResidual =
          absolute(physicalResidualScale[lane] * gridEquationResidual[lane]);
    }
    if (absoluteGridResidual > kGridFallbackResidualTolerance) {
      ++gSafetyLimits;
      safetyHit[lane] = true;
    }
  }
  const StereoPair gridVoltage = safetyBoundPair(
      vgk + vk, -kMaximumGridVoltage, kMaximumGridVoltage, safetyHit);
  vgk = gridVoltage - vk;
  grid = evaluateGridPair(vgk);
  const StereoPair iM = millerConductance * (gridVoltage - millerVoltage);
  const StereoPair seriesCurrent =
      gridVoltage / kGridLeakResistance + grid.current + iM;
  const StereoPair nextCharge = safetyBoundPair(
      oldCharge + kFastDt * seriesCurrent,
      -kCouplingCapacitance * kMaximumCouplingEquivalentVoltage,
      kCouplingCapacitance * kMaximumCouplingEquivalentVoltage, safetyHit);

  const PlateEvaluationPair platePredictor =
      evaluatePlatePair(vgk, previousVak);
  const StereoPair plateDenominator =
      1.0 + gPlateResistance * platePredictor.plateDerivative;
  StereoPair vak =
      (delayedP - vk -
       gPlateResistance * (platePredictor.current -
                           platePredictor.plateDerivative * previousVak +
                           delayedOutputLoadCurrent)) /
      plateDenominator;
  PlateEvaluationPair plate = evaluatePlatePair(vgk, vak);
  for (int lane = 0; lane < kChannels; ++lane) {
    PlateEvaluation lanePlate = {plate.current[lane],
                                 plate.gridDerivative[lane],
                                 plate.plateDerivative[lane]};
    double laneVak = vak[lane];
    refinePlateCandidateOnce(vgk[lane], delayedP[lane], vk[lane],
                             delayedOutputLoadCurrent[lane], laneVak,
                             lanePlate);
    vak[lane] = laneVak;
    plate.current[lane] = lanePlate.current;
    plate.gridDerivative[lane] = lanePlate.gridDerivative;
    plate.plateDerivative[lane] = lanePlate.plateDerivative;
    if (plateCandidateNeedsFallback(vak[lane], lanePlate, delayedP[lane],
                                    vk[lane], delayedOutputLoadCurrent[lane])) {
      const PlateSolveResult fallback = solvePlateFallback(
          vgk[lane], delayedP[lane], vk[lane], delayedOutputLoadCurrent[lane],
          vak[lane], lanePlate);
      if (fallback.converged) {
        vak[lane] = fallback.vak;
        plate.current[lane] = fallback.plate.current;
        plate.gridDerivative[lane] = fallback.plate.gridDerivative;
        plate.plateDerivative[lane] = fallback.plate.plateDerivative;
      } else {
        ++gSafetyLimits;
        safetyHit[lane] = true;
      }
    }
  }
  const StereoPair plateVoltage = vak + vk;
  const StereoPair derivativeDenominator =
      1.0 + gPlateResistance * plate.plateDerivative;
  const StereoPair localGain = safetyBoundPair(
      -gPlateResistance * plate.gridDerivative / derivativeDenominator,
      kMinimumLocalPlateGain, kMaximumLocalPlateGain, safetyHit);
  const StereoPair nextCm = safetyBoundPair(
      activeTube().cgk + activeTube().cga * (1.0 - localGain),
      kMinimumMillerCapacitance, kMaximumMillerCapacitance, safetyHit);
  const StereoPair iCgk = activeTube().cgk / cm * iM;
  const StereoPair iCga = activeTube().cga * (1.0 - localPlateGain) / cm * iM;
  const StereoPair iCak = activeTube().cak * (vak - previousVak) / kFastDt;
  const StereoPair couplingCurrent = (nextCharge - oldCharge) / kFastDt;
  const StereoPair sourceBranchCurrent =
      (sourceVoltage - gridVoltage - nextCharge / kCouplingCapacitance) /
      sourceResistance;
  StereoPair maximumPhysicalKcl;
  for (int lane = 0; lane < kChannels; ++lane) {
    const double gridResidual = absolute(
        sourceBranchCurrent[lane] - gridVoltage[lane] / kGridLeakResistance -
        grid.current[lane] - iM[lane]);
    const double couplingResidual =
        absolute(couplingCurrent[lane] - seriesCurrent[lane]);
    const double millerSplitResidual =
        absolute(iM[lane] - iCgk[lane] - iCga[lane]);
    const double plateResidual =
        absolute((delayedP[lane] - plateVoltage[lane]) / gPlateResistance -
                 plate.current[lane] - delayedOutputLoadCurrent[lane]);
    double maximum =
        gridResidual > couplingResidual ? gridResidual : couplingResidual;
    if (millerSplitResidual > maximum)
      maximum = millerSplitResidual;
    if (plateResidual > maximum)
      maximum = plateResidual;
    maximumPhysicalKcl[lane] = maximum;

    FastStage &stage = gFast[lane].stage[stageIndex];
    stage.gridVoltage = gridVoltage[lane];
    stage.plateVoltage = plateVoltage[lane];
    stage.couplingCharge = nextCharge[lane];
    stage.millerVoltage = gridVoltage[lane];
    stage.millerCapacitance = nextCm[lane];
    stage.localPlateGain = localGain[lane];
    stage.outputResistance = gPlateResistance / derivativeDenominator[lane];
    stage.previousVak = vak[lane];
  }
  return {plate.current,   grid.current,      iCgk, iCga, iCak,
          couplingCurrent, maximumPhysicalKcl};
}
#endif

IndependentStageOracle evaluateIndependentStageOracle(
    const FastStage &before, const FastStage &after,
    const StageResult &candidate, double sourceVoltage, double sourceResistance,
    double delayedP, double vk, double delayedOutputLoadCurrent) {
  const double vgk = after.gridVoltage - vk;
  const GridEvaluation grid = evaluateGrid(vgk);
  const PlateEvaluation plate = evaluatePlate(vgk, after.plateVoltage - vk);
  const double millerConductance = before.millerCapacitance / kFastDt;
  const double iM =
      millerConductance * (after.gridVoltage - before.millerVoltage);
  const double iCgk = activeTube().cgk / before.millerCapacitance * iM;
  const double iCga = activeTube().cga * (1.0 - before.localPlateGain) /
                      before.millerCapacitance * iM;
  const double iCak = activeTube().cak *
                      (after.plateVoltage - vk - before.previousVak) / kFastDt;
  const double couplingCurrent =
      (after.couplingCharge - before.couplingCharge) / kFastDt;
  const double sourceCurrent = (sourceVoltage - after.gridVoltage -
                                after.couplingCharge / kCouplingCapacitance) /
                               sourceResistance;
  const double gridKclDiagnostic =
      absolute(sourceCurrent - after.gridVoltage / kGridLeakResistance -
               grid.current - iM);
  const double couplingKclDiagnostic =
      absolute(couplingCurrent - after.gridVoltage / kGridLeakResistance -
               grid.current - iM);
  const double nonlinearPlateKclDiagnostic =
      absolute((delayedP - after.plateVoltage) / gPlateResistance -
               plate.current - delayedOutputLoadCurrent);
  double maximumApproximateNonlinearResidual =
      gridKclDiagnostic > couplingKclDiagnostic ? gridKclDiagnostic
                                                : couplingKclDiagnostic;
  if (nonlinearPlateKclDiagnostic > maximumApproximateNonlinearResidual) {
    maximumApproximateNonlinearResidual = nonlinearPlateKclDiagnostic;
  }
  double maximumChargeTransitionIdentity =
      absolute(candidate.couplingCurrent - couplingCurrent);
  const double iCakDifference = absolute(candidate.iCak - iCak);
  if (iCakDifference > maximumChargeTransitionIdentity) {
    maximumChargeTransitionIdentity = iCakDifference;
  }
  double maximumMillerSplitIdentity = absolute(iM - iCgk - iCga);
  const double iCgkDifference = absolute(candidate.iCgk - iCgk);
  const double iCgaDifference = absolute(candidate.iCga - iCga);
  if (iCgkDifference > maximumMillerSplitIdentity) {
    maximumMillerSplitIdentity = iCgkDifference;
  }
  if (iCgaDifference > maximumMillerSplitIdentity) {
    maximumMillerSplitIdentity = iCgaDifference;
  }
  const PlateEvaluation platePredictor = evaluatePlate(vgk, before.previousVak);
  const double vak = after.plateVoltage - vk;
  const double linearizedPlateCurrent =
      platePredictor.current +
      platePredictor.plateDerivative * (vak - before.previousVak);
  const double maximumLinearizedTransitionIdentity =
      absolute((delayedP - after.plateVoltage) / gPlateResistance -
               linearizedPlateCurrent - delayedOutputLoadCurrent);
  return {plate.current,
          grid.current,
          iCgk,
          iCga,
          iCak,
          couplingCurrent,
          maximumApproximateNonlinearResidual,
          maximumChargeTransitionIdentity,
          maximumMillerSplitIdentity,
          maximumLinearizedTransitionIdentity};
}

void observeIndependentExactIdentity(double value, double &maximum) {
  if (!std::isfinite(value)) {
    maximum = std::numeric_limits<double>::infinity();
    gIndependentTransientOraclePassed = false;
    return;
  }
  if (value > maximum)
    maximum = value;
  if (value > 1e-12)
    gIndependentTransientOraclePassed = false;
}

void observeIndependentTransientOracle(
    const FastStage &firstBefore, const FastStage &firstAfter,
    const FastStage &secondBefore, const FastStage &secondAfter,
    const StageResult &firstCandidate, const StageResult &secondCandidate,
    double sourceVoltage, double delayedPlate1, double delayedResistance1,
    double delayedP, double vk1, double vk2, double delayedOutputLoadCurrent,
    double oldOutputCharge, double newOutputCharge, double outputLoadCurrent,
    double candidateIRa1, double candidateIRa2, double candidateUK1,
    double candidateUK2, double candidateUP) {
  const IndependentStageOracle first = evaluateIndependentStageOracle(
      firstBefore, firstAfter, firstCandidate, sourceVoltage, gSourceResistance,
      delayedP, vk1, 0.0);
  const IndependentStageOracle second = evaluateIndependentStageOracle(
      secondBefore, secondAfter, secondCandidate, delayedPlate1,
      delayedResistance1, delayedP, vk2, delayedOutputLoadCurrent);
  const double outputCapacitorCurrent =
      (newOutputCharge - oldOutputCharge) / kFastDt;
  const double outputTransitionIdentity =
      absolute(outputCapacitorCurrent - outputLoadCurrent);
  const double oracleIRa1 =
      first.plateCurrent - first.iCga + first.iCak + second.couplingCurrent;
  const double oracleIRa2 =
      second.plateCurrent - second.iCga + second.iCak + outputCapacitorCurrent;
  const double oracleUK1 =
      first.plateCurrent + first.gridCurrent + first.iCgk + first.iCak;
  const double oracleUK2 =
      second.plateCurrent + second.gridCurrent + second.iCgk + second.iCak;
  const double oracleUP =
      gSupplyVoltage / gSupplyResistance - oracleIRa1 - oracleIRa2;
  double maximumApproximateNonlinearResidual =
      first.maximumApproximateNonlinearResidual >
              second.maximumApproximateNonlinearResidual
          ? first.maximumApproximateNonlinearResidual
          : second.maximumApproximateNonlinearResidual;
  if (!std::isfinite(maximumApproximateNonlinearResidual)) {
    maximumApproximateNonlinearResidual =
        std::numeric_limits<double>::infinity();
    gIndependentTransientOraclePassed = false;
  }
  if (maximumApproximateNonlinearResidual >
      gMaximumIndependentTransientOracleKcl) {
    gMaximumIndependentTransientOracleKcl = maximumApproximateNonlinearResidual;
  }
  observeIndependentExactIdentity(first.maximumChargeTransitionIdentity,
                                  gMaximumIndependentChargeTransitionIdentity);
  observeIndependentExactIdentity(second.maximumChargeTransitionIdentity,
                                  gMaximumIndependentChargeTransitionIdentity);
  observeIndependentExactIdentity(first.maximumMillerSplitIdentity,
                                  gMaximumIndependentMillerSplitIdentity);
  observeIndependentExactIdentity(second.maximumMillerSplitIdentity,
                                  gMaximumIndependentMillerSplitIdentity);
  observeIndependentExactIdentity(outputTransitionIdentity,
                                  gMaximumIndependentOutputTransitionIdentity);
  observeIndependentExactIdentity(
      first.maximumLinearizedTransitionIdentity,
      gMaximumIndependentLinearizedTransitionIdentity);
  observeIndependentExactIdentity(
      second.maximumLinearizedTransitionIdentity,
      gMaximumIndependentLinearizedTransitionIdentity);
  const std::array<double, 5> differences = {
      absolute(oracleIRa1 - candidateIRa1),
      absolute(oracleIRa2 - candidateIRa2), absolute(oracleUK1 - candidateUK1),
      absolute(oracleUK2 - candidateUK2), absolute(oracleUP - candidateUP)};
  for (double difference : differences) {
    observeIndependentExactIdentity(
        difference, gMaximumIndependentTransientOracleDriveDifference);
  }
}

void updateSlow(int channel, double iRa1, double iRa2, const StageResult &first,
                const StageResult &second) {
  SlowAccumulator &accumulator = gAccumulator[channel];
  accumulator.uK1 +=
      first.plateCurrent + first.gridCurrent + first.iCgk + first.iCak;
  accumulator.uK2 +=
      second.plateCurrent + second.gridCurrent + second.iCgk + second.iCak;
  accumulator.uP += gSupplyVoltage / gSupplyResistance - iRa1 - iRa2;
  ++accumulator.count;
  if (accumulator.count != kSlowWindow)
    return;

  const double inverseCount = 1.0 / static_cast<double>(kSlowWindow);
  const double uK1 = accumulator.uK1 * inverseCount;
  const double uK2 = accumulator.uK2 * inverseCount;
  const double uP = accumulator.uP * inverseCount;
  SlowState &slow = gSlow[channel];
  slow.cathode[0] = trBdf2Step(slow.cathode[0], kCathodeCapacitance,
                               1.0 / gCathodeResistance + kGmin, uK1);
  slow.cathode[1] = trBdf2Step(slow.cathode[1], kCathodeCapacitance,
                               1.0 / gCathodeResistance + kGmin, uK2);
  slow.supply = trBdf2Step(slow.supply, gSupplyCapacitance,
                           1.0 / gSupplyResistance + kGmin, uP);
  const double window = static_cast<double>(kSlowWindow);
  retargetRamp(slow.cathodeRamp[0], slow.cathode[0].voltage, inverseCount, window);
  retargetRamp(slow.cathodeRamp[1], slow.cathode[1].voltage, inverseCount, window);
  retargetRamp(slow.supplyRamp, slow.supply.voltage, inverseCount, window);

  const double residual1 =
      absolute((1.0 / gCathodeResistance + kGmin) * slow.cathode[0].voltage +
               slow.cathode[0].capacitorCurrent - uK1);
  const double residual2 =
      absolute((1.0 / gCathodeResistance + kGmin) * slow.cathode[1].voltage +
               slow.cathode[1].capacitorCurrent - uK2);
  const double residualP =
      absolute((1.0 / gSupplyResistance + kGmin) * slow.supply.voltage +
               slow.supply.capacitorCurrent - uP);
  double maximum = residual1 > residual2 ? residual1 : residual2;
  if (residualP > maximum)
    maximum = residualP;
  if (maximum > gMaximumKcl)
    gMaximumKcl = maximum;
  if (gObservationActive && maximum > gObservationMaximumKcl) {
    gObservationMaximumKcl = maximum;
  }
  accumulator = SlowAccumulator{};
  ++gSlowUpdates;
}

bool finiteStage(const FastStage &stage) {
  return std::isfinite(stage.gridVoltage) &&
         std::isfinite(stage.plateVoltage) &&
         std::isfinite(stage.couplingCharge) &&
         std::isfinite(stage.millerVoltage) &&
         std::isfinite(stage.millerCapacitance) &&
         std::isfinite(stage.localPlateGain) &&
         std::isfinite(stage.outputResistance) &&
         std::isfinite(stage.previousVak);
}

bool finiteSlowValue(const SlowValue &value) {
  return std::isfinite(value.voltage) && std::isfinite(value.capacitorCurrent);
}

bool finiteRamp(const SlowRamp &ramp) {
  return std::isfinite(ramp.applied) && std::isfinite(ramp.slope) &&
         std::isfinite(ramp.curvature) && std::isfinite(ramp.previous1) &&
         std::isfinite(ramp.previous2);
}

bool finitePhysicalChannel(int channel) {
  const FastChannel &fast = gFast[channel];
  const SlowState &slow = gSlow[channel];
  const SlowAccumulator &accumulator = gAccumulator[channel];
  return finiteStage(fast.stage[0]) && finiteStage(fast.stage[1]) &&
         std::isfinite(fast.outputCouplingCharge) &&
         std::isfinite(fast.outputLoadCurrent) &&
         finiteSlowValue(slow.cathode[0]) && finiteSlowValue(slow.cathode[1]) &&
         finiteSlowValue(slow.supply) && finiteRamp(slow.cathodeRamp[0]) &&
         finiteRamp(slow.cathodeRamp[1]) && finiteRamp(slow.supplyRamp) &&
         std::isfinite(accumulator.uK1) &&
         std::isfinite(accumulator.uK2) && std::isfinite(accumulator.uP) &&
         accumulator.count >= 0 && accumulator.count < kSlowWindow;
}

bool physicalRangesValid(int channel) {
  const FastChannel &fast = gFast[channel];
  const SlowState &slow = gSlow[channel];
  if (slow.supply.voltage < 0.0 || slow.supply.voltage > 400.0)
    return false;
  for (int stage = 0; stage < 2; ++stage) {
    const double cathode = slow.cathode[stage].voltage;
    const double plate = fast.stage[stage].plateVoltage;
    const double vak = plate - cathode;
    if (cathode < -100.0 || cathode > 300.0 ||
        plate < kMinimumPhysicalPlateVoltage ||
        plate > kMaximumPhysicalPlateVoltage ||
        vak < kMinimumPhysicalPlateVoltage ||
        vak > kMaximumPhysicalPlateVoltage) {
      return false;
    }
  }
  return true;
}

void restorePhysicalChannel(int channel) {
  gFast[channel] = gRecoveryFast[channel];
  gSlow[channel] = gRecoverySlow[channel];
  gAccumulator[channel] = SlowAccumulator{};
}

double advanceChannel(int channel, double input) {
  gStepSafetyHit = false;
  FastChannel &fast = gFast[channel];
  SlowState &slow = gSlow[channel];
  advanceRamp(slow.cathodeRamp[0]);
  advanceRamp(slow.cathodeRamp[1]);
  advanceRamp(slow.supplyRamp);
  const FastStage firstBefore = fast.stage[0];
  const FastStage secondBefore = fast.stage[1];
  const double delayedPlate1 = fast.stage[0].plateVoltage;
  const double delayedResistance1 = fast.stage[0].outputResistance;
  const double delayedOutputLoadCurrent = fast.outputLoadCurrent;
  const StageResult first =
      advanceStage(fast.stage[0], input, gSourceResistance, slow.supplyRamp.applied,
                   slow.cathodeRamp[0].applied, 0.0);
  const StageResult second = advanceStage(
      fast.stage[1], delayedPlate1, delayedResistance1, slow.supplyRamp.applied,
      slow.cathodeRamp[1].applied, delayedOutputLoadCurrent);

  const double oldOutputCharge = fast.outputCouplingCharge;
  const double outputDenominator =
      1.0 + kFastDt / (kOutputCapacitance * kOutputLoadResistance);
  const double output = safetyBound(
      (fast.stage[1].plateVoltage - oldOutputCharge / kOutputCapacitance) /
          outputDenominator,
      -kMaximumOutputVoltage, kMaximumOutputVoltage);
  fast.outputCouplingCharge = safetyBound(
      fast.outputCouplingCharge + kFastDt * output / kOutputLoadResistance,
      -kOutputCapacitance * kMaximumCouplingEquivalentVoltage,
      kOutputCapacitance * kMaximumCouplingEquivalentVoltage);
  fast.outputLoadCurrent = output / kOutputLoadResistance;
  const double iCout = (fast.outputCouplingCharge - oldOutputCharge) / kFastDt;
  const double iRa1 =
      first.plateCurrent - first.iCga + first.iCak + second.couplingCurrent;
  const double iRa2 = second.plateCurrent - second.iCga + second.iCak + iCout;
  const double candidateUK1 =
      first.plateCurrent + first.gridCurrent + first.iCgk + first.iCak;
  const double candidateUK2 =
      second.plateCurrent + second.gridCurrent + second.iCgk + second.iCak;
  const double candidateUP = gSupplyVoltage / gSupplyResistance - iRa1 - iRa2;
  if (gTrackIndependentTransientOracle) {
    observeIndependentTransientOracle(
        firstBefore, fast.stage[0], secondBefore, fast.stage[1], first, second,
        input, delayedPlate1, delayedResistance1, slow.supplyRamp.applied,
        slow.cathodeRamp[0].applied, slow.cathodeRamp[1].applied,
        delayedOutputLoadCurrent, oldOutputCharge, fast.outputCouplingCharge,
        fast.outputLoadCurrent, iRa1, iRa2, candidateUK1, candidateUK2,
        candidateUP);
  }
  updateSlow(channel, iRa1, iRa2, first, second);

  if (gTrackNoInputDrift) {
    const double outputResidual = absolute(iCout - fast.outputLoadCurrent);
    const double uK1 =
        first.plateCurrent + first.gridCurrent + first.iCgk + first.iCak;
    const double uK2 =
        second.plateCurrent + second.gridCurrent + second.iCgk + second.iCak;
    const double uP = gSupplyVoltage / gSupplyResistance - iRa1 - iRa2;
    const double slowK1Residual =
        absolute((1.0 / gCathodeResistance + kGmin) * slow.cathode[0].voltage +
                 slow.cathode[0].capacitorCurrent - uK1);
    const double slowK2Residual =
        absolute((1.0 / gCathodeResistance + kGmin) * slow.cathode[1].voltage +
                 slow.cathode[1].capacitorCurrent - uK2);
    const double slowSupplyResidual =
        absolute((1.0 / gSupplyResistance + kGmin) * slow.supply.voltage +
                 slow.supply.capacitorCurrent - uP);
    const std::array<double, 7> physicalResiduals = {
        first.maximumPhysicalKcl,
        second.maximumPhysicalKcl,
        outputResidual,
        slowK1Residual,
        slowK2Residual,
        slowSupplyResidual,
        absolute(iRa1 + iRa2 + uP - gSupplyVoltage / gSupplyResistance)};
    for (double residual : physicalResiduals) {
      if (residual > gMaximumNoInputPhysicalKcl) {
        gMaximumNoInputPhysicalKcl = residual;
      }
    }
  }

  if (!finitePhysicalChannel(channel)) {
    ++gFiniteFaults;
    gBlockFiniteFault = true;
    restorePhysicalChannel(channel);
    return 0.0;
  }
  if (!physicalRangesValid(channel)) {
    ++gSafetyLimits;
    gStepSafetyHit = true;
  }
  if (gStepSafetyHit) {
    gBlockSafetyHit = true;
    restorePhysicalChannel(channel);
    return 0.0;
  }

  if (gTrackNoInputDrift) {
    const FastChannel &baselineFast = gZeroBaselineFast[channel];
    const SlowState &baselineSlow = gZeroBaselineSlow[channel];
    const std::array<double, 8> drift = {
        absolute(fast.stage[0].gridVoltage - baselineFast.stage[0].gridVoltage),
        absolute(fast.stage[0].plateVoltage -
                 baselineFast.stage[0].plateVoltage),
        absolute(fast.stage[1].gridVoltage - baselineFast.stage[1].gridVoltage),
        absolute(fast.stage[1].plateVoltage -
                 baselineFast.stage[1].plateVoltage),
        absolute(slow.cathode[0].voltage - baselineSlow.cathode[0].voltage),
        absolute(slow.cathode[1].voltage - baselineSlow.cathode[1].voltage),
        absolute(slow.supply.voltage - baselineSlow.supply.voltage),
        absolute(output)};
    for (double value : drift) {
      if (value > gMaximumNoInputDrift)
        gMaximumNoInputDrift = value;
    }
  }

  gTelemetry[0] += absolute(output);
  gTelemetry[1] = slow.cathode[0].voltage;
  gTelemetry[2] = slow.cathode[1].voltage;
  gTelemetry[3] = slow.supply.voltage;
  gTelemetry[4] = first.plateCurrent;
  gTelemetry[5] = second.plateCurrent;
  gTelemetry[6] = first.gridCurrent;
  gTelemetry[7] = second.gridCurrent;
  gTelemetry[8] = iRa1;
  gTelemetry[9] = iRa2;
  gPath2LastPlateCurrent[channel][0] = first.plateCurrent;
  gPath2LastPlateCurrent[channel][1] = second.plateCurrent;
  return output * 0.001;
}

#if P1_USE_SIMD
StereoPair advanceStereo(StereoPair input) {
  std::array<bool, kChannels> safetyHit{};
  std::array<FastStage, kChannels> firstBefore;
  std::array<FastStage, kChannels> secondBefore;
  StereoPair delayedPlate1;
  StereoPair delayedResistance1;
  StereoPair delayedOutputLoadCurrent;
  StereoPair delayedP;
  StereoPair vk1;
  StereoPair vk2;
  StereoPair oldOutputCharge;
  for (int lane = 0; lane < kChannels; ++lane) {
    FastChannel &fast = gFast[lane];
    SlowState &slow = gSlow[lane];
    advanceRamp(slow.cathodeRamp[0]);
    advanceRamp(slow.cathodeRamp[1]);
    advanceRamp(slow.supplyRamp);
    firstBefore[lane] = fast.stage[0];
    secondBefore[lane] = fast.stage[1];
    delayedPlate1[lane] = fast.stage[0].plateVoltage;
    delayedResistance1[lane] = fast.stage[0].outputResistance;
    delayedOutputLoadCurrent[lane] = fast.outputLoadCurrent;
    delayedP[lane] = slow.supplyRamp.applied;
    vk1[lane] = slow.cathodeRamp[0].applied;
    vk2[lane] = slow.cathodeRamp[1].applied;
    oldOutputCharge[lane] = fast.outputCouplingCharge;
  }
  const StereoPair firstSourceResistance = {gSourceResistance,
                                            gSourceResistance};
  const StereoPair zero = {0.0, 0.0};
  const StageResultPair first = advanceStagePair(
      0, input, firstSourceResistance, delayedP, vk1, zero, safetyHit);
  const StageResultPair second =
      advanceStagePair(1, delayedPlate1, delayedResistance1, delayedP, vk2,
                       delayedOutputLoadCurrent, safetyHit);

  const double outputDenominator =
      1.0 + kFastDt / (kOutputCapacitance * kOutputLoadResistance);
  StereoPair secondPlateVoltage;
  for (int lane = 0; lane < kChannels; ++lane) {
    secondPlateVoltage[lane] = gFast[lane].stage[1].plateVoltage;
  }
  StereoPair output = safetyBoundPair(
      (secondPlateVoltage - oldOutputCharge / kOutputCapacitance) /
          outputDenominator,
      -kMaximumOutputVoltage, kMaximumOutputVoltage, safetyHit);
  StereoPair nextOutputCharge = safetyBoundPair(
      oldOutputCharge + kFastDt * output / kOutputLoadResistance,
      -kOutputCapacitance * kMaximumCouplingEquivalentVoltage,
      kOutputCapacitance * kMaximumCouplingEquivalentVoltage, safetyHit);
  const StereoPair outputLoadCurrent = output / kOutputLoadResistance;
  const StereoPair iCout = (nextOutputCharge - oldOutputCharge) / kFastDt;
  const StereoPair iRa1 =
      first.plateCurrent - first.iCga + first.iCak + second.couplingCurrent;
  const StereoPair iRa2 =
      second.plateCurrent - second.iCga + second.iCak + iCout;
  const StereoPair candidateUK1 =
      first.plateCurrent + first.gridCurrent + first.iCgk + first.iCak;
  const StereoPair candidateUK2 =
      second.plateCurrent + second.gridCurrent + second.iCgk + second.iCak;
  const StereoPair candidateUP =
      gSupplyVoltage / gSupplyResistance - iRa1 - iRa2;
  for (int lane = 0; lane < kChannels; ++lane) {
    gFast[lane].outputCouplingCharge = nextOutputCharge[lane];
    gFast[lane].outputLoadCurrent = outputLoadCurrent[lane];
    const StageResult firstLane = {first.plateCurrent[lane],
                                   first.gridCurrent[lane],
                                   first.iCgk[lane],
                                   first.iCga[lane],
                                   first.iCak[lane],
                                   first.couplingCurrent[lane],
                                   first.maximumPhysicalKcl[lane]};
    const StageResult secondLane = {second.plateCurrent[lane],
                                    second.gridCurrent[lane],
                                    second.iCgk[lane],
                                    second.iCga[lane],
                                    second.iCak[lane],
                                    second.couplingCurrent[lane],
                                    second.maximumPhysicalKcl[lane]};
    const SlowState &slow = gSlow[lane];
    if (gTrackIndependentTransientOracle) {
      observeIndependentTransientOracle(
          firstBefore[lane], gFast[lane].stage[0], secondBefore[lane],
          gFast[lane].stage[1], firstLane, secondLane, input[lane],
          delayedPlate1[lane], delayedResistance1[lane], delayedP[lane],
          vk1[lane], vk2[lane], delayedOutputLoadCurrent[lane],
          oldOutputCharge[lane], nextOutputCharge[lane],
          outputLoadCurrent[lane], iRa1[lane], iRa2[lane], candidateUK1[lane],
          candidateUK2[lane], candidateUP[lane]);
    }
    updateSlow(lane, iRa1[lane], iRa2[lane], firstLane, secondLane);

    if (gTrackNoInputDrift) {
      const double outputResidual =
          absolute(iCout[lane] - outputLoadCurrent[lane]);
      const double slowK1Residual = absolute(
          (1.0 / gCathodeResistance + kGmin) * slow.cathode[0].voltage +
          slow.cathode[0].capacitorCurrent - candidateUK1[lane]);
      const double slowK2Residual = absolute(
          (1.0 / gCathodeResistance + kGmin) * slow.cathode[1].voltage +
          slow.cathode[1].capacitorCurrent - candidateUK2[lane]);
      const double slowSupplyResidual =
          absolute((1.0 / gSupplyResistance + kGmin) * slow.supply.voltage +
                   slow.supply.capacitorCurrent - candidateUP[lane]);
      const std::array<double, 7> physicalResiduals = {
          first.maximumPhysicalKcl[lane],
          second.maximumPhysicalKcl[lane],
          outputResidual,
          slowK1Residual,
          slowK2Residual,
          slowSupplyResidual,
          absolute(iRa1[lane] + iRa2[lane] + candidateUP[lane] -
                   gSupplyVoltage / gSupplyResistance)};
      for (double residual : physicalResiduals) {
        if (residual > gMaximumNoInputPhysicalKcl) {
          gMaximumNoInputPhysicalKcl = residual;
        }
      }
    }

    if (!finitePhysicalChannel(lane)) {
      ++gFiniteFaults;
      gBlockFiniteFault = true;
      restorePhysicalChannel(lane);
      output[lane] = 0.0;
      continue;
    }
    if (!physicalRangesValid(lane)) {
      ++gSafetyLimits;
      safetyHit[lane] = true;
    }
    if (safetyHit[lane]) {
      gBlockSafetyHit = true;
      restorePhysicalChannel(lane);
      output[lane] = 0.0;
      continue;
    }

    if (gTrackNoInputDrift) {
      const FastChannel &baselineFast = gZeroBaselineFast[lane];
      const SlowState &baselineSlow = gZeroBaselineSlow[lane];
      const std::array<double, 8> drift = {
          absolute(gFast[lane].stage[0].gridVoltage -
                   baselineFast.stage[0].gridVoltage),
          absolute(gFast[lane].stage[0].plateVoltage -
                   baselineFast.stage[0].plateVoltage),
          absolute(gFast[lane].stage[1].gridVoltage -
                   baselineFast.stage[1].gridVoltage),
          absolute(gFast[lane].stage[1].plateVoltage -
                   baselineFast.stage[1].plateVoltage),
          absolute(slow.cathode[0].voltage - baselineSlow.cathode[0].voltage),
          absolute(slow.cathode[1].voltage - baselineSlow.cathode[1].voltage),
          absolute(slow.supply.voltage - baselineSlow.supply.voltage),
          absolute(output[lane])};
      for (double value : drift) {
        if (value > gMaximumNoInputDrift)
          gMaximumNoInputDrift = value;
      }
    }

    gTelemetry[0] += absolute(output[lane]);
    gTelemetry[1] = slow.cathode[0].voltage;
    gTelemetry[2] = slow.cathode[1].voltage;
    gTelemetry[3] = slow.supply.voltage;
    gTelemetry[4] = first.plateCurrent[lane];
    gTelemetry[5] = second.plateCurrent[lane];
    gTelemetry[6] = first.gridCurrent[lane];
    gTelemetry[7] = second.gridCurrent[lane];
    gTelemetry[8] = iRa1[lane];
    gTelemetry[9] = iRa2[lane];
    gPath2LastPlateCurrent[lane][0] = first.plateCurrent[lane];
    gPath2LastPlateCurrent[lane][1] = second.plateCurrent[lane];
  }
  return output * 0.001;
}
#endif

bool equalStage(const FastStage &left, const FastStage &right) {
  return bitEqual(left.gridVoltage, right.gridVoltage) &&
         bitEqual(left.plateVoltage, right.plateVoltage) &&
         bitEqual(left.couplingCharge, right.couplingCharge) &&
         bitEqual(left.millerVoltage, right.millerVoltage) &&
         bitEqual(left.millerCapacitance, right.millerCapacitance) &&
         bitEqual(left.localPlateGain, right.localPlateGain) &&
         bitEqual(left.outputResistance, right.outputResistance) &&
         bitEqual(left.previousVak, right.previousVak);
}

bool equalFast(const FastChannel &left, const FastChannel &right) {
  return equalStage(left.stage[0], right.stage[0]) &&
         equalStage(left.stage[1], right.stage[1]) &&
         bitEqual(left.outputCouplingCharge, right.outputCouplingCharge) &&
         bitEqual(left.outputLoadCurrent, right.outputLoadCurrent);
}

bool equalSlowValue(const SlowValue &left, const SlowValue &right) {
  return bitEqual(left.voltage, right.voltage) &&
         bitEqual(left.capacitorCurrent, right.capacitorCurrent);
}

bool equalSlow(const SlowState &left, const SlowState &right) {
  return equalSlowValue(left.cathode[0], right.cathode[0]) &&
         equalSlowValue(left.cathode[1], right.cathode[1]) &&
         equalSlowValue(left.supply, right.supply);
}

bool equalAccumulator(const SlowAccumulator &left,
                      const SlowAccumulator &right) {
  return bitEqual(left.uK1, right.uK1) && bitEqual(left.uK2, right.uK2) &&
         bitEqual(left.uP, right.uP) && left.count == right.count;
}

template <std::size_t Size>
bool equalDoubleArray(const std::array<double, Size> &left,
                      const std::array<double, Size> &right) {
  for (std::size_t index = 0; index < Size; ++index) {
    if (!bitEqual(left[index], right[index]))
      return false;
  }
  return true;
}

bool equalReplayState() {
  for (int channel = 0; channel < kChannels; ++channel) {
    if (!equalFast(gFast[channel], gReplayFast[channel]) ||
        !equalSlow(gSlow[channel], gReplaySlow[channel]) ||
        !equalAccumulator(gAccumulator[channel], gReplayAccumulator[channel]) ||
        !equalDoubleArray(gUpsampleState[channel], gReplayUpsample[channel]) ||
        !equalDoubleArray(gDownsampleState[channel],
                          gReplayDownsample[channel]) ||
        !equalDoubleArray(gDryDelay[channel], gReplayDry[channel]))
      return false;
  }
  return equalDoubleArray(gTelemetry, gReplayTelemetry) &&
         bitEqual(gControls.drive, gReplayControls.drive) &&
         bitEqual(gControls.driveTarget, gReplayControls.driveTarget) &&
         bitEqual(gControls.output, gReplayControls.output) &&
         bitEqual(gControls.outputTarget, gReplayControls.outputTarget) &&
         bitEqual(gControls.mix, gReplayControls.mix) &&
         bitEqual(gControls.mixTarget, gReplayControls.mixTarget) &&
         bitEqual(gControls.coefficient, gReplayControls.coefficient) &&
         bitEqual(gMaximumKcl, gReplayMaximumKcl) &&
         bitEqual(gMaximumDcResidual, gReplayMaximumDcResidual) &&
         gFiniteFaults == gReplayFiniteFaults &&
         gSafetyLimits == gReplaySafetyLimits &&
         gSlowUpdates == gReplaySlowUpdates && gDryIndex == gReplayDryIndex;
}

void fillReplayInput(int block) {
  for (int frame = 0; frame < kHostFrames; ++frame) {
    const std::uint32_t index =
        static_cast<std::uint32_t>(block * kHostFrames + frame + 1);
    const std::int32_t left =
        static_cast<std::int32_t>((index * 1103515245u + 12345u) % 2001u) -
        1000;
    const std::int32_t right =
        static_cast<std::int32_t>((index * 1664525u + 1013904223u) % 2001u) -
        1000;
    gInput[0][frame] = static_cast<double>(left) * 1e-5;
    gInput[1][frame] = static_cast<double>(right) * 1e-5;
  }
}

bool finiteControlState() {
  return std::isfinite(gControls.drive) &&
         std::isfinite(gControls.driveTarget) &&
         std::isfinite(gControls.output) &&
         std::isfinite(gControls.outputTarget) &&
         std::isfinite(gControls.mix) && std::isfinite(gControls.mixTarget) &&
         std::isfinite(gControls.coefficient);
}

bool finiteRuntimeDomain() {
  if (!finiteControlState() || !finiteArray(gCoefficients) ||
      !finiteArray(gDriveGain) || !finiteArray(gOutputGain) ||
      !finiteArray(gWetMix) || !finiteArray(gTelemetry) ||
      !std::isfinite(gMaximumKcl) || !std::isfinite(gMaximumDcResidual) ||
      !std::isfinite(gMaximumNoInputDrift) ||
      !std::isfinite(gMaximumNoInputPhysicalKcl) ||
      !std::isfinite(gObservationMaximumKcl) || gDryIndex < 0 ||
      gDryIndex >= kDryDelayFrames) {
    return false;
  }
  for (int channel = 0; channel < kChannels; ++channel) {
    if (!finitePhysicalChannel(channel) ||
        !finiteStage(gRecoveryFast[channel].stage[0]) ||
        !finiteStage(gRecoveryFast[channel].stage[1]) ||
        !std::isfinite(gRecoveryFast[channel].outputCouplingCharge) ||
        !std::isfinite(gRecoveryFast[channel].outputLoadCurrent) ||
        !finiteSlowValue(gRecoverySlow[channel].cathode[0]) ||
        !finiteSlowValue(gRecoverySlow[channel].cathode[1]) ||
        !finiteSlowValue(gRecoverySlow[channel].supply) ||
        !finiteArray(gUpsampleState[channel]) ||
        !finiteArray(gDownsampleState[channel]) ||
        !finiteArray(gHostWork[channel]) ||
        !finiteArray(gInternalWork[channel]) ||
        !finiteArray(gInternalInput[channel]) ||
        !finiteArray(gInternalOutput[channel]) ||
        !finiteArray(gInput[channel]) || !finiteArray(gOutput[channel]) ||
        !finiteArray(gDryDelay[channel])) {
      return false;
    }
  }
  return true;
}

void restoreRuntimeBaseline() {
  const std::uint64_t finiteFaults = gFiniteFaults;
  const std::uint64_t safetyLimits = gSafetyLimits;
  const std::uint64_t slowUpdates = gSlowUpdates;
  const double maximumKcl = std::isfinite(gMaximumKcl) ? gMaximumKcl : 0.0;
  const double maximumDcResidual =
      std::isfinite(gMaximumDcResidual) ? gMaximumDcResidual : 0.0;
  const double observationMaximumKcl =
      std::isfinite(gObservationMaximumKcl) ? gObservationMaximumKcl : 0.0;
  gFast = gRecoveryFast;
  gSlow = gRecoverySlow;
  for (int channel = 0; channel < kChannels; ++channel) {
    gAccumulator[channel] = SlowAccumulator{};
    gUpsampleState[channel].fill(0.0);
    gDownsampleState[channel].fill(0.0);
    gHostWork[channel].fill(0.0);
    gInternalWork[channel].fill(0.0);
    gInternalInput[channel].fill(0.0);
    gInternalOutput[channel].fill(0.0);
    gInput[channel].fill(0.0);
    gOutput[channel].fill(0.0);
    gDryDelay[channel].fill(0.0);
  }
  gControls = ControlState{};
  gControls.coefficient =
      1.0 - std::exp(-1000.0 / (kControlSmoothingMilliseconds * kHostRate));
  gDriveGain.fill(1.0);
  gOutputGain.fill(1.0);
  gWetMix.fill(1.0);
  gTelemetry.fill(0.0);
  gMaximumKcl = maximumKcl;
  gMaximumDcResidual = maximumDcResidual;
  gMaximumNoInputDrift = 0.0;
  gMaximumNoInputPhysicalKcl = 0.0;
  gObservationMaximumKcl = observationMaximumKcl;
  gDryIndex = 0;
  gFiniteFaults = finiteFaults;
  gSafetyLimits = safetyLimits;
  gSlowUpdates = slowUpdates;
}

int processBlockScalar() {
  gBlockFiniteFault = false;
  gBlockSafetyHit = false;
  for (int frame = 0; frame < kHostFrames; ++frame) {
    gControls.drive +=
        gControls.coefficient * (gControls.driveTarget - gControls.drive);
    gControls.output +=
        gControls.coefficient * (gControls.outputTarget - gControls.output);
    gControls.mix +=
        gControls.coefficient * (gControls.mixTarget - gControls.mix);
    gDriveGain[frame] = gControls.drive;
    gOutputGain[frame] = gControls.output;
    gWetMix[frame] = gControls.mix;
  }
  for (int channel = 0; channel < kChannels; ++channel) {
    auto &hostWork = gHostWork[channel];
    for (int index = 0; index < kUpsampleHistory; ++index) {
      hostWork[index] = gUpsampleState[channel][index];
    }
    for (int frame = 0; frame < kHostFrames; ++frame) {
      hostWork[kUpsampleHistory + frame] =
          gInput[channel][frame] * gDriveGain[frame];
    }
    for (int frame = 0; frame < kHostFrames; ++frame) {
      const int current = kUpsampleHistory + frame;
      for (int phase = 0; phase < kFactor; ++phase) {
        double value = 0.0;
        int history = 0;
        for (int tap = phase; tap < kFirLength; tap += kFactor) {
          value += gCoefficients[tap] * hostWork[current - history];
          ++history;
        }
        gInternalInput[channel][frame * kFactor + phase] = value * kFactor;
      }
    }
    for (int index = 0; index < kUpsampleHistory; ++index) {
      gUpsampleState[channel][index] = hostWork[kHostFrames + index];
    }
  }

  for (int index = 0; index < kInternalFrames; ++index) {
    gInternalOutput[0][index] = advanceChannel(0, gInternalInput[0][index]);
    gInternalOutput[1][index] = advanceChannel(1, gInternalInput[1][index]);
    if ((index & (kFactor - 1)) == kFactor - 1) {
      const int hostFrame = index / kFactor;
      for (int channel = 0; channel < kChannels; ++channel) {
        gPath2HostObservation[0][channel][hostFrame] =
            gSlow[channel].cathode[0].voltage;
        gPath2HostObservation[1][channel][hostFrame] =
            gSlow[channel].cathode[1].voltage;
        gPath2HostObservation[2][channel][hostFrame] =
            gSlow[channel].supply.voltage;
        gPath2HostObservation[3][channel][hostFrame] =
            gPath2LastPlateCurrent[channel][0];
        gPath2HostObservation[4][channel][hostFrame] =
            gPath2LastPlateCurrent[channel][1];
      }
    }
  }

  for (int channel = 0; channel < kChannels; ++channel) {
    auto &internalWork = gInternalWork[channel];
    for (int index = 0; index < kDownsampleHistory; ++index) {
      internalWork[index] = gDownsampleState[channel][index];
    }
    for (int index = 0; index < kInternalFrames; ++index) {
      internalWork[kDownsampleHistory + index] =
          gInternalOutput[channel][index];
    }
    for (int frame = 0; frame < kHostFrames; ++frame) {
      const int current = kDownsampleHistory + frame * kFactor;
      double wet = 0.0;
      for (int tap = 0; tap < kFirLength; ++tap) {
        wet += gCoefficients[tap] * internalWork[current - tap];
      }
      const int dryIndex = (gDryIndex + frame) & (kDryDelayFrames - 1);
      const double dry = gDryDelay[channel][dryIndex];
      gDryDelay[channel][dryIndex] = gInput[channel][frame];
      const double wetMix = gWetMix[frame];
      gOutput[channel][frame] =
          wet * gOutputGain[frame] * wetMix + dry * (1.0 - wetMix);
    }
    for (int index = 0; index < kDownsampleHistory; ++index) {
      gDownsampleState[channel][index] = internalWork[kInternalFrames + index];
    }
  }
  gDryIndex = (gDryIndex + kHostFrames) & (kDryDelayFrames - 1);
  if (gBlockFiniteFault || gBlockSafetyHit || !finiteRuntimeDomain()) {
    if (!gBlockFiniteFault && !gBlockSafetyHit)
      ++gFiniteFaults;
    restoreRuntimeBaseline();
    return 0;
  }
  return 1;
}

#if P1_USE_SIMD
int processBlockSimd() {
  gBlockFiniteFault = false;
  gBlockSafetyHit = false;
  for (int frame = 0; frame < kHostFrames; ++frame) {
    gControls.drive +=
        gControls.coefficient * (gControls.driveTarget - gControls.drive);
    gControls.output +=
        gControls.coefficient * (gControls.outputTarget - gControls.output);
    gControls.mix +=
        gControls.coefficient * (gControls.mixTarget - gControls.mix);
    gDriveGain[frame] = gControls.drive;
    gOutputGain[frame] = gControls.output;
    gWetMix[frame] = gControls.mix;
  }
  for (int index = 0; index < kUpsampleHistory; ++index) {
    gHostWork[0][index] = gUpsampleState[0][index];
    gHostWork[1][index] = gUpsampleState[1][index];
  }
  for (int frame = 0; frame < kHostFrames; ++frame) {
    const double gain = gDriveGain[frame];
    gHostWork[0][kUpsampleHistory + frame] = gInput[0][frame] * gain;
    gHostWork[1][kUpsampleHistory + frame] = gInput[1][frame] * gain;
  }
  for (int frame = 0; frame < kHostFrames; ++frame) {
    const int current = kUpsampleHistory + frame;
    for (int phase = 0; phase < kFactor; ++phase) {
      StereoPair value = {0.0, 0.0};
      int history = 0;
      for (int tap = phase; tap < kFirLength; tap += kFactor) {
        const StereoPair sample = {gHostWork[0][current - history],
                                   gHostWork[1][current - history]};
        value += gCoefficients[tap] * sample;
        ++history;
      }
      const int internalIndex = frame * kFactor + phase;
      value *= kFactor;
      gInternalInput[0][internalIndex] = value[0];
      gInternalInput[1][internalIndex] = value[1];
    }
  }
  for (int index = 0; index < kUpsampleHistory; ++index) {
    gUpsampleState[0][index] = gHostWork[0][kHostFrames + index];
    gUpsampleState[1][index] = gHostWork[1][kHostFrames + index];
  }

  for (int index = 0; index < kInternalFrames; ++index) {
    const StereoPair input = {gInternalInput[0][index],
                              gInternalInput[1][index]};
    const StereoPair output = advanceStereo(input);
    gInternalOutput[0][index] = output[0];
    gInternalOutput[1][index] = output[1];
    if ((index & (kFactor - 1)) == kFactor - 1) {
      const int hostFrame = index / kFactor;
      for (int channel = 0; channel < kChannels; ++channel) {
        gPath2HostObservation[0][channel][hostFrame] =
            gSlow[channel].cathode[0].voltage;
        gPath2HostObservation[1][channel][hostFrame] =
            gSlow[channel].cathode[1].voltage;
        gPath2HostObservation[2][channel][hostFrame] =
            gSlow[channel].supply.voltage;
        gPath2HostObservation[3][channel][hostFrame] =
            gPath2LastPlateCurrent[channel][0];
        gPath2HostObservation[4][channel][hostFrame] =
            gPath2LastPlateCurrent[channel][1];
      }
    }
  }

  for (int index = 0; index < kDownsampleHistory; ++index) {
    gInternalWork[0][index] = gDownsampleState[0][index];
    gInternalWork[1][index] = gDownsampleState[1][index];
  }
  for (int index = 0; index < kInternalFrames; ++index) {
    gInternalWork[0][kDownsampleHistory + index] = gInternalOutput[0][index];
    gInternalWork[1][kDownsampleHistory + index] = gInternalOutput[1][index];
  }
  for (int frame = 0; frame < kHostFrames; ++frame) {
    const int current = kDownsampleHistory + frame * kFactor;
    StereoPair wet = {0.0, 0.0};
    for (int tap = 0; tap < kFirLength; ++tap) {
      const StereoPair sample = {gInternalWork[0][current - tap],
                                 gInternalWork[1][current - tap]};
      wet += gCoefficients[tap] * sample;
    }
    const int dryIndex = (gDryIndex + frame) & (kDryDelayFrames - 1);
    const StereoPair dry = {gDryDelay[0][dryIndex], gDryDelay[1][dryIndex]};
    gDryDelay[0][dryIndex] = gInput[0][frame];
    gDryDelay[1][dryIndex] = gInput[1][frame];
    const double wetMix = gWetMix[frame];
    const StereoPair mixed =
        wet * gOutputGain[frame] * wetMix + dry * (1.0 - wetMix);
    gOutput[0][frame] = mixed[0];
    gOutput[1][frame] = mixed[1];
  }
  for (int index = 0; index < kDownsampleHistory; ++index) {
    gDownsampleState[0][index] = gInternalWork[0][kInternalFrames + index];
    gDownsampleState[1][index] = gInternalWork[1][kInternalFrames + index];
  }
  gDryIndex = (gDryIndex + kHostFrames) & (kDryDelayFrames - 1);
  if (gBlockFiniteFault || gBlockSafetyHit || !finiteRuntimeDomain()) {
    if (!gBlockFiniteFault && !gBlockSafetyHit)
      ++gFiniteFaults;
    restoreRuntimeBaseline();
    return 0;
  }
  return 1;
}
#endif

int processBlock() {
#if P1_USE_SIMD
  return processBlockSimd();
#else
  return processBlockScalar();
#endif
}

bool runResetReplayPass(bool capture) {
  resetModel();
  for (int block = 0; block < kResetReplayBlocks; ++block) {
    fillReplayInput(block);
    if (processBlock() != 1)
      return false;
    for (int channel = 0; channel < kChannels; ++channel) {
      for (int frame = 0; frame < kHostFrames; ++frame) {
        if (capture) {
          gReplayOutput[block][channel][frame] = gOutput[channel][frame];
        } else if (!bitEqual(gReplayOutput[block][channel][frame],
                             gOutput[channel][frame])) {
          return false;
        }
      }
    }
  }
  if (capture) {
    gReplayFast = gFast;
    gReplaySlow = gSlow;
    gReplayAccumulator = gAccumulator;
    gReplayUpsample = gUpsampleState;
    gReplayDownsample = gDownsampleState;
    gReplayDry = gDryDelay;
    gReplayControls = gControls;
    gReplayTelemetry = gTelemetry;
    gReplayMaximumKcl = gMaximumKcl;
    gReplayMaximumDcResidual = gMaximumDcResidual;
    gReplayFiniteFaults = gFiniteFaults;
    gReplaySafetyLimits = gSafetyLimits;
    gReplaySlowUpdates = gSlowUpdates;
    gReplayDryIndex = gDryIndex;
    return true;
  }
  return equalReplayState();
}

bool runResetReplay() {
  gMaximumIndependentTransientOracleKcl = 0.0;
  gMaximumIndependentTransientOracleDriveDifference = 0.0;
  gMaximumIndependentChargeTransitionIdentity = 0.0;
  gMaximumIndependentMillerSplitIdentity = 0.0;
  gMaximumIndependentOutputTransitionIdentity = 0.0;
  gMaximumIndependentLinearizedTransitionIdentity = 0.0;
  gIndependentTransientOraclePassed = true;
  gTrackIndependentTransientOracle = true;
  const bool firstPassed = runResetReplayPass(true);
  gSanityResetReplayFirstFiniteFaults = gFiniteFaults;
  gSanityResetReplayFirstSafetyLimits = gSafetyLimits;
  const bool secondPassed = runResetReplayPass(false);
  gSanityResetReplaySecondFiniteFaults = gFiniteFaults;
  gSanityResetReplaySecondSafetyLimits = gSafetyLimits;
  gTrackIndependentTransientOracle = false;
  return firstPassed && secondPassed;
}

bool runNoInputSentinel() {
  resetModel();
  gZeroBaselineFast = gFast;
  gZeroBaselineSlow = gSlow;
  gTrackNoInputDrift = true;
  for (int block = 0; block < 750; ++block) {
    for (int channel = 0; channel < kChannels; ++channel) {
      gInput[channel].fill(0.0);
    }
    if (processBlock() != 1) {
      gTrackNoInputDrift = false;
      return false;
    }
  }
  gTrackNoInputDrift = false;
  return gFiniteFaults == 0 && gSafetyLimits == 0 &&
         gMaximumDcResidual <= 1e-12 && gMaximumKcl <= 1e-12 &&
         gMaximumNoInputPhysicalKcl <= 1e-12 && gMaximumNoInputDrift <= 1e-9 &&
         finiteRuntimeDomain();
}

} // namespace

extern "C" {

int path2_prepare(double sampleRate, int frames, int channels, int factor,
                  int firLength, int slowWindow) {
  if (sampleRate != kHostRate || frames != kHostFrames ||
      channels != kChannels || factor != kFactor || firLength != kFirLength ||
      slowWindow != kSlowWindow)
    return 0;
  (void)tubeTable();
  designFir();
  resetModel();
  gPrepared = 1;
  return 1;
}

void path2_reset() { resetModel(); }

int path2_set_controls(double driveGain, double outputGain, double mix) {
  if (!std::isfinite(driveGain) || !std::isfinite(outputGain) ||
      !std::isfinite(mix) || driveGain < 0.06309573444801933 ||
      driveGain > 251.188643150958 || outputGain < 0.06309573444801933 ||
      outputGain > 15.848931924611133 || mix < 0.0 || mix > 1.0) {
    return 0;
  }
  gControls.driveTarget = driveGain;
  gControls.outputTarget = outputGain;
  gControls.mixTarget = mix;
  return 1;
}

int path2_set_parameters(double driveDb, int tubeIndex, double biasPercent,
                         double plateV, double sourceZKOhm, double supplyKOhm,
                         double outputDb, double mixPercent) {
  if (!std::isfinite(driveDb) || driveDb < -24.0 || driveDb > 48.0 ||
      tubeIndex < 0 || tubeIndex >= 3 || !std::isfinite(biasPercent) ||
      biasPercent < -50.0 || biasPercent > 50.0 || !std::isfinite(plateV) ||
      plateV < 150.0 || plateV > 300.0 || !std::isfinite(sourceZKOhm) ||
      sourceZKOhm < 0.6 || sourceZKOhm > 100.0 || !std::isfinite(supplyKOhm) ||
      supplyKOhm < 0.1 || supplyKOhm > 47.0 || !std::isfinite(outputDb) ||
      outputDb < -24.0 || outputDb > 24.0 || !std::isfinite(mixPercent) ||
      mixPercent < 0.0 || mixPercent > 100.0) {
    return 0;
  }
  const bool tubeChanged = tubeIndex != gTubeIndex;
  gPath2Parameters = {driveDb,     tubeIndex,  biasPercent, plateV,
                      sourceZKOhm, supplyKOhm, outputDb,    mixPercent};
  gTubeIndex = tubeIndex;
  gTubeResetPending = gTubeResetPending || tubeChanged;
  applyPath2Parameters(false);
  return 1;
}

int path2_parameter_count() { return 8; }

int path2_tube_reset_pending() { return gTubeResetPending ? 1 : 0; }

const double *path2_host_observation_ptr(int field, int channel) {
  return field >= 0 && field < 5 && channel >= 0 && channel < kChannels
             ? gPath2HostObservation[field][channel].data()
             : nullptr;
}

double path2_static_lut_value(int tubeIndex, int field, double vgk,
                              double vak) {
  if (tubeIndex < 0 || tubeIndex >= 3 || field < 0 || field >= 5)
    return std::numeric_limits<double>::quiet_NaN();
  const GridEvaluation grid = tubeTables()[tubeIndex].evaluateGrid(vgk);
  const PlateEvaluation plate = tubeTables()[tubeIndex].evaluatePlate(vgk, vak);
  const std::array<double, 5> result = {grid.current, grid.derivative,
                                        plate.current, plate.gridDerivative,
                                        plate.plateDerivative};
  return result[field];
}

int path2_begin_observation() {
  if (gPrepared != 1)
    return 0;
  gObservationFiniteFaultBaseline = gFiniteFaults;
  gObservationSafetyLimitBaseline = gSafetyLimits;
  gObservationSlowUpdateBaseline = gSlowUpdates;
  for (int channel = 0; channel < kChannels; ++channel) {
    gObservationStartSlowPhase[channel] = gAccumulator[channel].count;
  }
  gObservationAcceptedSlowUpdates = 0;
  gObservationAcceptedSlowStartPhaseSum = 0;
  gObservationAcceptedSlowEndPhaseSum = 0;
  gObservationMaximumKcl = 0.0;
  gObservationActive = true;
  return 1;
}

int path2_run_sanity() {
  if (gPrepared != 1)
    return 0;
  gSanityResetReplayFirstFiniteFaults = 0;
  gSanityResetReplayFirstSafetyLimits = 0;
  gSanityResetReplaySecondFiniteFaults = 0;
  gSanityResetReplaySecondSafetyLimits = 0;
  gSanityQuietSentinelFiniteFaults = 0;
  gSanityQuietSentinelSafetyLimits = 0;
  const bool resetReplayBitIdentical = runResetReplay();
  const double independentTransientOracleKcl =
      gMaximumIndependentTransientOracleKcl;
  const double independentTransientOracleDriveDifference =
      gMaximumIndependentTransientOracleDriveDifference;
  const bool independentTransientOraclePassed =
      gIndependentTransientOraclePassed &&
      independentTransientOracleDriveDifference <= 1e-12;
  const bool noInputPassed = runNoInputSentinel();
  gSanityQuietSentinelFiniteFaults = gFiniteFaults;
  gSanityQuietSentinelSafetyLimits = gSafetyLimits;
  gSanityMaximumQuietSentinelCutSetKcl = gMaximumKcl;
  gSanityMaximumDcResidual = gMaximumDcResidual;
  gSanityMaximumNoInputDrift = gMaximumNoInputDrift;
  gSanityMaximumQuietSentinelPhysicalKcl = gMaximumNoInputPhysicalKcl;
  gSanityMaximumIndependentTransientOracleKcl = independentTransientOracleKcl;
  gSanityMaximumIndependentTransientOracleDriveDifference =
      independentTransientOracleDriveDifference;
  gSanityMaximumIndependentChargeTransitionIdentity =
      gMaximumIndependentChargeTransitionIdentity;
  gSanityMaximumIndependentMillerSplitIdentity =
      gMaximumIndependentMillerSplitIdentity;
  gSanityMaximumIndependentOutputTransitionIdentity =
      gMaximumIndependentOutputTransitionIdentity;
  gSanityMaximumIndependentLinearizedTransitionIdentity =
      gMaximumIndependentLinearizedTransitionIdentity;
  gSanityIndependentTransientOraclePassed =
      independentTransientOraclePassed ? 1 : 0;
  gSanityResetReplayBitIdentical = resetReplayBitIdentical ? 1 : 0;
  gSanityFiniteFaults = gSanityResetReplayFirstFiniteFaults +
                        gSanityResetReplaySecondFiniteFaults +
                        gSanityQuietSentinelFiniteFaults;
  gSanitySafetyLimits = gSanityResetReplayFirstSafetyLimits +
                        gSanityResetReplaySecondSafetyLimits +
                        gSanityQuietSentinelSafetyLimits;
  const int passed = resetReplayBitIdentical &&
                     independentTransientOraclePassed && noInputPassed &&
                     gSanityFiniteFaults == 0 && gSanitySafetyLimits == 0;
  resetModel();
  return passed;
}

int path2_process() {
  if (gPrepared != 1 || gTubeResetPending)
    return 0;
  const std::uint64_t slowUpdatesBefore = gSlowUpdates;
  std::array<int, kChannels> slowPhasesBefore{};
  for (int channel = 0; channel < kChannels; ++channel) {
    slowPhasesBefore[channel] = gAccumulator[channel].count;
  }
  const int result = processBlock();
  if (result == 1 && gObservationActive) {
    gObservationAcceptedSlowUpdates += gSlowUpdates - slowUpdatesBefore;
    for (int channel = 0; channel < kChannels; ++channel) {
      gObservationAcceptedSlowStartPhaseSum += slowPhasesBefore[channel];
      gObservationAcceptedSlowEndPhaseSum += gAccumulator[channel].count;
    }
  }
  return result;
}

double *path2_input_ptr(int channel) {
  return channel >= 0 && channel < kChannels ? gInput[channel].data() : nullptr;
}

const double *path2_output_ptr(int channel) {
  return channel >= 0 && channel < kChannels ? gOutput[channel].data()
                                             : nullptr;
}

const double *path2_telemetry_ptr() { return gTelemetry.data(); }

double path2_maximum_kcl() { return gMaximumKcl; }

double path2_maximum_dc_residual() { return gMaximumDcResidual; }

double path2_sanity_maximum_quiet_sentinel_cut_set_kcl() {
  return gSanityMaximumQuietSentinelCutSetKcl;
}

double path2_sanity_maximum_dc_residual() { return gSanityMaximumDcResidual; }

double path2_sanity_maximum_no_input_drift() {
  return gSanityMaximumNoInputDrift;
}

double path2_sanity_maximum_quiet_sentinel_physical_kcl() {
  return gSanityMaximumQuietSentinelPhysicalKcl;
}

double path2_sanity_maximum_independent_transient_oracle_kcl() {
  return gSanityMaximumIndependentTransientOracleKcl;
}

double path2_sanity_maximum_independent_transient_oracle_drive_difference() {
  return gSanityMaximumIndependentTransientOracleDriveDifference;
}

double path2_sanity_maximum_independent_charge_transition_identity() {
  return gSanityMaximumIndependentChargeTransitionIdentity;
}

double path2_sanity_maximum_independent_miller_split_identity() {
  return gSanityMaximumIndependentMillerSplitIdentity;
}

double path2_sanity_maximum_independent_output_transition_identity() {
  return gSanityMaximumIndependentOutputTransitionIdentity;
}

double path2_sanity_maximum_independent_linearized_transition_identity() {
  return gSanityMaximumIndependentLinearizedTransitionIdentity;
}

int path2_sanity_independent_transient_oracle_passed() {
  return gSanityIndependentTransientOraclePassed;
}

int path2_sanity_reset_replay_bit_identical() {
  return gSanityResetReplayBitIdentical;
}

unsigned long long path2_sanity_reset_replay_first_finite_faults() {
  return gSanityResetReplayFirstFiniteFaults;
}

unsigned long long path2_sanity_reset_replay_first_safety_limits() {
  return gSanityResetReplayFirstSafetyLimits;
}

unsigned long long path2_sanity_reset_replay_second_finite_faults() {
  return gSanityResetReplaySecondFiniteFaults;
}

unsigned long long path2_sanity_reset_replay_second_safety_limits() {
  return gSanityResetReplaySecondSafetyLimits;
}

unsigned long long path2_sanity_quiet_sentinel_finite_faults() {
  return gSanityQuietSentinelFiniteFaults;
}

unsigned long long path2_sanity_quiet_sentinel_safety_limits() {
  return gSanityQuietSentinelSafetyLimits;
}

unsigned long long path2_sanity_finite_faults() { return gSanityFiniteFaults; }

unsigned long long path2_sanity_safety_limits() { return gSanitySafetyLimits; }

unsigned long long path2_finite_faults() { return gFiniteFaults; }

unsigned long long path2_safety_limits() { return gSafetyLimits; }

unsigned long long path2_slow_updates() { return gSlowUpdates; }

unsigned long long path2_observation_finite_faults() {
  return gFiniteFaults - gObservationFiniteFaultBaseline;
}

unsigned long long path2_observation_safety_limits() {
  return gSafetyLimits - gObservationSafetyLimitBaseline;
}

unsigned long long path2_observation_slow_updates() {
  return gSlowUpdates - gObservationSlowUpdateBaseline;
}

int path2_observation_start_slow_phase(int channel) {
  return channel >= 0 && channel < kChannels
             ? gObservationStartSlowPhase[channel]
             : -1;
}

int path2_observation_end_slow_phase(int channel) {
  return channel >= 0 && channel < kChannels ? gAccumulator[channel].count : -1;
}

unsigned long long path2_observation_accepted_slow_updates() {
  return gObservationAcceptedSlowUpdates;
}

unsigned long long path2_observation_accepted_slow_start_phase_sum() {
  return gObservationAcceptedSlowStartPhaseSum;
}

unsigned long long path2_observation_accepted_slow_end_phase_sum() {
  return gObservationAcceptedSlowEndPhaseSum;
}

double path2_observation_maximum_kcl() { return gObservationMaximumKcl; }

int path2_persistent_domain_finite() { return finiteRuntimeDomain() ? 1 : 0; }

int path2_factor() { return kFactor; }
int path2_fir_length() { return kFirLength; }
int path2_slow_window() { return kSlowWindow; }
int path2_slow_owner_count() { return 1; }

#if P1_LUT_ORACLE_EXPORTS
const double *path2_lut_oracle_ptr(double vgk, double vak) {
  static std::array<double, 10> result{};
  const GridEvaluation directGridResult = directGrid(vgk);
  const GridEvaluation lookupGridResult = tubeTable().evaluateGrid(vgk);
  const PlateEvaluation directPlateResult = directPlate(vgk, vak);
  const PlateEvaluation lookupPlateResult = tubeTable().evaluatePlate(vgk, vak);
  result = {
      directGridResult.current,          directGridResult.derivative,
      lookupGridResult.current,          lookupGridResult.derivative,
      directPlateResult.current,         directPlateResult.gridDerivative,
      directPlateResult.plateDerivative, lookupPlateResult.current,
      lookupPlateResult.gridDerivative,  lookupPlateResult.plateDerivative};
  return result.data();
}
#endif
}

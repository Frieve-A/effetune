#define ET_TUBE_SIMULATOR_NATIVE_TEST 1
#include "kernel.cpp"

#include "allocation_guard.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <limits>
#include <new>
#include <string>
#include <string_view>
#include <vector>

namespace {

constexpr std::uint32_t kMaximumFrames = 128u;
// The test-state kernel carries diagnostic members on top of the production layout, so the test
// harness grants it more storage than the engine's production 8192-byte slot (see kernel.cpp).
constexpr std::size_t kKernelStorageBytes = 12288u;
constexpr std::array<float, 6> kSupportedSampleRates = {44100.0F, 48000.0F,  88200.0F,
                                                        96000.0F, 176400.0F, 192000.0F};
constexpr float kTortureOracleMaximumAbsoluteError = 1.0e-5F;
constexpr const char *kTortureOracleFixtureName = "torture-oracle-active-output.f32";
using Kernel = effetune::plugins::saturation::TubeSimulatorKernel;
using Params = Kernel::Params;

#ifndef ET_TUBE_STANDARD_V1_GOLDEN_DIR
#error "ET_TUBE_STANDARD_V1_GOLDEN_DIR must name the immutable P3 baseline fixture root"
#endif

static_assert(std::endian::native == std::endian::little,
              "Tube Simulator Float32 fixture requires a little-endian native target");

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Tube Simulator check failed: %s\n", message);
    ++failures;
  }
}

bool finite(const std::vector<float> &audio) noexcept {
  for (float sample : audio) {
    if (!std::isfinite(sample)) {
      return false;
    }
  }
  return true;
}

std::vector<float> loadFloat32Fixture(const char *fixture_name, std::size_t expected_floats) {
  const std::filesystem::path fixture_path =
      std::filesystem::path(ET_TUBE_STANDARD_V1_GOLDEN_DIR) / fixture_name;
  std::ifstream fixture(fixture_path, std::ios::binary | std::ios::ate);
  check(fixture.is_open(), "Float32 fixture opens");
  if (!fixture.is_open()) {
    return {};
  }
  const std::streamsize expected_bytes =
      static_cast<std::streamsize>(expected_floats * sizeof(float));
  check(fixture.tellg() == expected_bytes, "Float32 fixture has the expected size");
  if (fixture.tellg() != expected_bytes) {
    return {};
  }
  fixture.seekg(0, std::ios::beg);
  std::vector<float> output(expected_floats);
  fixture.read(reinterpret_cast<char *>(output.data()), expected_bytes);
  check(static_cast<bool>(fixture), "Float32 fixture reads completely");
  return fixture ? output : std::vector<float>{};
}

double compareTortureOracleFixture(const std::vector<float> &actual,
                                   const std::vector<float> &expected,
                                   const char *variant) noexcept {
  check(actual.size() == expected.size(), "12AT7 torture oracle comparison shape matches");
  if (actual.size() != expected.size()) {
    return std::numeric_limits<double>::infinity();
  }
  double worst_absolute_error = 0.0;
  bool within_tolerance = true;
  for (std::size_t index = 0; index < actual.size(); ++index) {
    const double difference =
        std::abs(static_cast<double>(actual[index]) - static_cast<double>(expected[index]));
    if (!std::isfinite(difference)) {
      within_tolerance = false;
      worst_absolute_error = std::numeric_limits<double>::infinity();
      break;
    }
    if (difference > worst_absolute_error) {
      worst_absolute_error = difference;
    }
    if (difference > static_cast<double>(kTortureOracleMaximumAbsoluteError)) {
      within_tolerance = false;
    }
  }
  check(within_tolerance, "12AT7 torture output matches the frozen r2 oracle fixture");
  std::fprintf(stdout, "Tube Simulator %s torture oracle worst abs %.9e (limit %.9e)\n", variant,
               worst_absolute_error, static_cast<double>(kTortureOracleMaximumAbsoluteError));
  return worst_absolute_error;
}

Params makeParams(float input_volume = -30.0F, float tube = 2.0F, float bias = 0.0F,
                  float plate = 250.0F, float source_z = 10.0F, float supply = 10.0F,
                  float output_trim = 39.0F, float mix = 100.0F, float input_reference = 2.828F,
                  float negative_feedback = 0.0F, float output_stage = 0.0F,
                  float power_tube = 0.0F, float power_b_plus = 320.0F,
                  float cathode_resistor = 270.0F, float screen_tap = 0.0F,
                  float primary_impedance = 2.0F, float speaker_load = 1.0F,
                  float actual_speaker_load = 8.0F, float safety_trim = 0.0F,
                  float auto_gain_reduction = 1.0F) noexcept {
  return {input_volume,
          tube,
          bias,
          plate,
          source_z,
          supply,
          output_trim,
          mix,
          input_reference,
          negative_feedback,
          output_stage,
          power_tube,
          power_b_plus,
          cathode_resistor,
          screen_tap,
          primary_impedance,
          speaker_load,
          actual_speaker_load,
          safety_trim,
          auto_gain_reduction};
}

std::array<double, 17> parameterValues(const Params &params) noexcept {
  return {
      static_cast<double>(params.inputVolume),    static_cast<double>(params.tube),
      static_cast<double>(params.bias),           static_cast<double>(params.plate),
      static_cast<double>(params.sourceZ),        static_cast<double>(params.supply),
      static_cast<double>(params.outputTrim),     static_cast<double>(params.mix),
      static_cast<double>(params.inputReference), static_cast<double>(params.negativeFeedback),
      static_cast<double>(params.outputStage),    static_cast<double>(params.powerTube),
      static_cast<double>(params.powerBPlus),     static_cast<double>(params.cathodeResistor),
      static_cast<double>(params.screenTap),      static_cast<double>(params.primaryImpedance),
      static_cast<double>(params.speakerLoad),
  };
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate = 96000.0F,
                         std::uint32_t maximum_frames = kMaximumFrames, bool use_simd = false) {
    descriptor_ = et_kernel_descriptor_TubeSimulatorPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr) {
      return;
    }
    check(descriptor_->objectSize <= storage_.size(), "kernel fits the 8192-byte engine storage");
    check(descriptor_->objectAlignment <= alignof(std::max_align_t),
          "kernel alignment fits test storage");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      concrete_ = static_cast<Kernel *>(kernel_);
      kernel_->prepare({sample_rate, 2u, maximum_frames});
      check(kernel_->preparedSuccessfully(), "prepare reports success");
      concrete_->useSimdForTesting(use_simd);
      kernel_->reset();
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  [[nodiscard]] effetune::PluginKernel &kernel() noexcept { return *kernel_; }

  [[nodiscard]] Kernel &concrete() noexcept { return *concrete_; }

  void stage(const Params &params) noexcept {
    const et_status status = kernel_->stageParameters(reinterpret_cast<const float *>(&params),
                                                      Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
  }

  void stageAndCommit(const Params &params) noexcept {
    stage(params);
    kernel_->applyPendingParameters();
    concrete_->commitParametersForTesting();
  }

  void reset() noexcept { kernel_->reset(); }

  void process(std::vector<float> &audio, std::uint32_t frames) noexcept {
    check(audio.size() == static_cast<std::size_t>(frames) * 2u, "audio shape matches");
    const std::uint32_t violations_before = effetune::allocation_guard::violationCount();
    {
      effetune::allocation_guard::Scope allocation_scope;
      kernel_->applyPendingParameters();
      kernel_->process(audio.data(), 2u, frames, {0.0});
    }
    check(effetune::allocation_guard::violationCount() == violations_before,
          "process performs no allocation");
  }

  [[nodiscard]] bool processSuccessfully(std::vector<float> &audio, std::uint32_t frames) noexcept {
    check(audio.size() == static_cast<std::size_t>(frames) * 2u, "audio shape matches");
    const std::uint32_t violations_before = effetune::allocation_guard::violationCount();
    bool succeeded = false;
    {
      effetune::allocation_guard::Scope allocation_scope;
      succeeded = concrete_->processBlockForTesting(audio.data(), frames);
    }
    check(effetune::allocation_guard::violationCount() == violations_before,
          "process performs no allocation");
    return succeeded;
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
  Kernel *concrete_ = nullptr;
};

struct El34PhysicalObservation final {
  std::array<std::array<double, 9>, 2> powerDc;
  std::array<double, 4> powerProfile;
  std::array<std::array<double, 6>, 2> powerWindow;
  std::array<float, 41> telemetry;
};

// Run the branch on silence until the reservoir, cathode-bias, screen and coupling capacitors have
// reached their fixed point. The DC oracle describes the state the running circuit settles to, not
// the seed the reset writes, and the two differ by the reservoir Thevenin drop: the supply
// parameter sits one such drop above the centre tap it feeds.
void settlePowerQuiescentState(KernelHarness &harness, std::uint32_t frames) noexcept {
  std::vector<float> silence(256u, 0.0F);
  for (std::uint32_t settled = 0u; settled < frames; settled += 128u) {
    std::fill(silence.begin(), silence.end(), 0.0F);
    harness.process(silence, 128u);
  }
}

El34PhysicalObservation collectEl34PhysicalObservation() {
  constexpr double sample_rate = 96000.0;
  constexpr double internal_rate = 384000.0;
  constexpr double frequency_hz = 1000.0;
  constexpr double secondary_peak_v = 10.0;
  constexpr double dummy_load_ohm = 8.0;
  constexpr std::uint32_t window_samples = 38400u;
  constexpr double two_pi = 6.283185307179586476925286766559005768;
  KernelHarness harness(static_cast<float>(sample_rate));
  // The global loop is open for the observation. A quiescent point is a property of the circuit,
  // and the tapped output of an output transformer is zero at DC, so the feedback setting cannot
  // move it; what it can do is decide whether the branch has a quiescent point to settle on at all.
  // The contract's 20 dB setting is far above the measured feedback bound of this plant, where the
  // branch runs a steady limit cycle - both anodes swinging between 309 V and 588 V - and no DC
  // observation exists to be made.
  harness.stageAndCommit(makeParams(
      0.0F, 2.0F, 0.0F, 250.0F, 10.0F, 10.0F, 0.0F, 100.0F, 2.828F, 0.0F, 1.0F, 1.0F,
      static_cast<float>(
          effetune::dsp::tube_simulator_phase_c_generated::kEl34NormativeDc.supplyGroundV),
      470.0F, 2.0F, 1.0F, 1.0F));
  // A product physical observation is of the running branch, not of the state the reset writes
  // before a single sample has been processed. Settle the reservoir, cathode-bias, screen and
  // coupling capacitors first; without this the probe published the reset seed and called it a
  // measurement.
  settlePowerQuiescentState(harness, 96000u);
  El34PhysicalObservation observation{};
  observation.powerDc = {harness.concrete().powerDcStateForTesting(0),
                         harness.concrete().powerDcStateForTesting(1)};
  observation.powerProfile = harness.concrete().powerProfileForTesting();
  for (std::uint32_t sample = 0u; sample < window_samples; ++sample) {
    const double voltage = secondary_peak_v * std::sin(two_pi * frequency_hz *
                                                       static_cast<double>(sample) / internal_rate);
    const double current = voltage / dummy_load_ohm;
    for (int channel = 0; channel < 2; ++channel) {
      harness.concrete().accumulatePowerWindowSampleForTesting(channel, voltage, current);
    }
  }
  harness.concrete().refreshTelemetryForTesting();
  observation.powerWindow = {harness.concrete().powerWindowStateForTesting(0),
                             harness.concrete().powerWindowStateForTesting(1)};
  observation.telemetry = harness.concrete().telemetryPayloadForTesting();
  return observation;
}

template <typename Value, std::size_t Size>
void printNumericArray(const std::array<Value, Size> &values) {
  for (std::size_t index = 0u; index < values.size(); ++index) {
    std::printf("%s%.17g", index == 0u ? "" : ",", static_cast<double>(values[index]));
  }
}

std::vector<float> makeSignal(std::uint32_t frames, std::uint32_t phase = 0u, float scale = 0.7F) {
  std::vector<float> signal(static_cast<std::size_t>(frames) * 2u);
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    const std::size_t offset = static_cast<std::size_t>(channel) * frames;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double index = static_cast<double>(frame + phase + channel * 17u);
      signal[offset + frame] =
          static_cast<float>(static_cast<double>(scale) *
                             (0.63 * std::sin(index * 0.071) + 0.29 * std::cos(index * 0.113)));
    }
  }
  return signal;
}

std::vector<float> render(KernelHarness &harness, const std::vector<float> &input,
                          const std::vector<std::uint32_t> &partitions) {
  check(input.size() % 2u == 0u, "render input is channel-major stereo");
  check(!partitions.empty(), "render partitions are present");
  const std::uint32_t total_frames = static_cast<std::uint32_t>(input.size() / 2u);
  std::vector<float> output(input.size(), 0.0F);
  std::uint32_t offset = 0u;
  std::size_t partition_index = 0u;
  while (offset < total_frames) {
    std::uint32_t frames = partitions[partition_index % partitions.size()];
    if (frames > total_frames - offset) {
      frames = total_frames - offset;
    }
    check(frames != 0u && frames <= kMaximumFrames, "partition is within prepared maximum");
    std::vector<float> block(static_cast<std::size_t>(frames) * 2u);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      const std::size_t source = static_cast<std::size_t>(channel) * total_frames + offset;
      const std::size_t destination = static_cast<std::size_t>(channel) * frames;
      std::memcpy(block.data() + destination, input.data() + source,
                  static_cast<std::size_t>(frames) * sizeof(float));
    }
    harness.process(block, frames);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      const std::size_t source = static_cast<std::size_t>(channel) * frames;
      const std::size_t destination = static_cast<std::size_t>(channel) * total_frames + offset;
      std::memcpy(output.data() + destination, block.data() + source,
                  static_cast<std::size_t>(frames) * sizeof(float));
    }
    offset += frames;
    ++partition_index;
  }
  return output;
}

void processFrames(KernelHarness &harness, std::uint32_t frame_count,
                   const std::vector<std::uint32_t> &partitions) {
  std::uint32_t processed = 0u;
  std::size_t partition_index = 0u;
  while (processed < frame_count) {
    std::uint32_t frames = partitions[partition_index % partitions.size()];
    if (frames > frame_count - processed) {
      frames = frame_count - processed;
    }
    std::vector<float> audio(static_cast<std::size_t>(frames) * 2u, 0.0F);
    harness.process(audio, frames);
    processed += frames;
    ++partition_index;
  }
}

void testCanonicalFeedbackTableAndResetTransition() {
  constexpr std::size_t group_stride = 2u + 61u * 7u;
  for (std::size_t family = 0u; family < 2u; ++family) {
    KernelHarness harness(family == 0u ? 44100.0F : 48000.0F);
    for (int tube = 0; tube < 3; ++tube) {
      const std::size_t group = static_cast<std::size_t>(tube) * 2u + family;
      for (std::size_t knot = 0u; knot < 61u; ++knot) {
        const double feedback_db = static_cast<double>(knot) * 0.5;
        const auto calibration =
            harness.concrete().feedbackCalibrationForTesting(tube, feedback_db);
        const std::size_t record = group * group_stride + 2u + knot * 7u;
        for (std::size_t field = 0u; field < 4u; ++field) {
          const double expected = std::bit_cast<double>(
              effetune::tube_feedback_table_fixture::kBinary64Bits[record + field]);
          check(std::bit_cast<std::uint64_t>(calibration[field + 2u]) ==
                    std::bit_cast<std::uint64_t>(expected),
                "native feedback coefficient consumes the canonical binary64 table bit");
        }
      }
      const auto identity = harness.concrete().feedbackCalibrationForTesting(tube, 0.0);
      check(identity[0] == 0.0 && identity[1] == 0.0 && identity[2] == 1.0 && identity[3] == 0.0 &&
                identity[4] == 0.0 && identity[5] == 0.0 && identity[7] == 0.0 &&
                identity[8] == 1.0,
            "nf=0 is the exact identity endpoint");
    }
  }

  constexpr float sample_rate = 96000.0F;
  const std::uint32_t fade_frames = static_cast<std::uint32_t>(std::ceil(sample_rate * 0.005F));
  const std::uint32_t warmup_frames = static_cast<std::uint32_t>(std::ceil(sample_rate * 0.050F));
  KernelHarness harness(sample_rate);
  const Params initial =
      makeParams(-6.0F, 2.0F, 0.0F, 250.0F, 10.0F, 10.0F, 9.0F, 100.0F, 2.828F, 30.0F);
  harness.stageAndCommit(initial);
  processFrames(harness, 257u, {127u, 17u, 5u});

  const Params first_target =
      makeParams(-12.0F, 0.0F, 7.0F, 265.0F, 4.0F, 8.0F, 2.0F, 73.0F, 5.657F, 0.0F);
  harness.stageAndCommit(first_target);
  auto transition = harness.concrete().feedbackTransitionForTesting();
  check(transition[0] == 1u && transition[4] == 1u && transition[2] == 0u && transition[3] == 0u,
        "reset-class event starts one pending fade-out generation");

  processFrames(harness, fade_frames / 2u, {31u, 7u, 1u});
  const auto pre_boundary_applied = harness.concrete().appliedParametersForTesting();
  const auto pre_boundary_targets = harness.concrete().controlTargetsForTesting();
  const auto pre_boundary_calibration = harness.concrete().activeFeedbackCalibrationForTesting();
  const Params coalesced_target =
      makeParams(-18.0F, 1.0F, -9.0F, 278.0F, 6.0F, 11.0F, -3.0F, 61.0F, 4.0F, 12.0F);
  harness.stageAndCommit(coalesced_target);
  transition = harness.concrete().feedbackTransitionForTesting();
  check(transition[4] == 1u, "pre-midpoint full snapshot coalesces into the current generation");
  check(harness.concrete().appliedParametersForTesting() == pre_boundary_applied,
        "mixed fade-out event keeps the complete active snapshot unchanged");
  check(harness.concrete().controlTargetsForTesting() == pre_boundary_targets,
        "mixed fade-out event keeps active control targets unchanged");
  check(harness.concrete().activeFeedbackCalibrationForTesting() == pre_boundary_calibration,
        "mixed fade-out event keeps active feedback calibration unchanged");
  processFrames(harness, fade_frames - fade_frames / 2u, {13u, 29u, 3u});
  transition = harness.concrete().feedbackTransitionForTesting();
  check(transition[0] == 2u && transition[2] == 1u && transition[3] == 1u && transition[4] == 0u &&
            transition[7] == 1u && transition[8] == 1u,
        "dry boundary atomically resets and activates exactly one generation");
  const auto applied = harness.concrete().appliedParametersForTesting();
  check(applied == parameterValues(coalesced_target),
        "midpoint commit applies the complete ten-field snapshot atomically");

  const Params queued =
      makeParams(-9.0F, 2.0F, 3.0F, 255.0F, 7.0F, 9.0F, 1.0F, 88.0F, 2.828F, 30.0F);
  harness.stageAndCommit(queued);
  transition = harness.concrete().feedbackTransitionForTesting();
  check(transition[5] == 2u, "post-midpoint reset-class change reserves the next generation");
  check(harness.concrete().appliedParametersForTesting() == parameterValues(coalesced_target),
        "mixed queued event keeps the complete active snapshot unchanged");
  const Params return_to_active =
      makeParams(-15.0F, 1.0F, -9.0F, 278.0F, 6.0F, 11.0F, 1.0F, 72.0F, 4.0F, 12.0F);
  harness.stageAndCommit(return_to_active);
  transition = harness.concrete().feedbackTransitionForTesting();
  check(transition[5] == 0u, "return to active reset-class values cancels the queued generation");
  check(harness.concrete().appliedParametersForTesting() == parameterValues(return_to_active),
        "pure non-reset event keeps its immediate active path");

  processFrames(harness, warmup_frames, {128u, 37u, 5u});
  transition = harness.concrete().feedbackTransitionForTesting();
  check(transition[0] == 3u && transition[9] == warmup_frames && transition[10] == 0u,
        "50 ms warm-up emits exact latency-aligned dry with zero wet mismatches");
  processFrames(harness, fade_frames, {11u, 127u, 3u});
  transition = harness.concrete().feedbackTransitionForTesting();
  check(transition[0] == 0u && transition[7] == 1u && transition[8] == 1u && transition[11] == 0u,
        "5+50+5 cycle completes once without old-state/new-NFB processing");
}

void testFeedbackDetectorContract() {
  KernelHarness growth;
  growth.stageAndCommit(makeParams());
  check(!growth.concrete().observeDetectorWindowForTesting(0.25, 0.05, 0.01),
        "growth detector arms from a preceding qualifying-level window");
  check(!growth.concrete().observeDetectorWindowForTesting(0.25, 0.06, 0.012),
        "growth detector waits after one qualifying ratio window");
  check(!growth.concrete().observeDetectorWindowForTesting(0.25, 0.072, 0.0144),
        "growth detector waits after two qualifying ratio windows");
  check(growth.concrete().observeDetectorWindowForTesting(0.25, 0.0864, 0.01728),
        "growth detector latches on the third consecutive 1.15-or-greater window");
  check(growth.concrete().detectorWindowStateForTesting()[0] == 3u,
        "growth detector keeps its independent three-window counter");
  check(growth.concrete().runtimeEventForTesting() == std::array<std::uint32_t, 3>{1u, 1u, 1u},
        "growth detector publishes one feedback-oscillation latch generation");

  KernelHarness below_floors;
  below_floors.stageAndCommit(makeParams());
  check(!below_floors.concrete().observeDetectorWindowForTesting(0.1, 0.02, 0.004),
        "growth detector records a below-floor predecessor");
  check(!below_floors.concrete().observeDetectorWindowForTesting(0.1, 0.024, 0.0048),
        "growth ratios do not bypass the branch-specific floors");
  check(!below_floors.concrete().observeDetectorWindowForTesting(0.1, 0.0288, 0.00576),
        "below-floor growth does not accumulate a positive-control count");
  check(below_floors.concrete().detectorWindowStateForTesting()[0] == 0u,
        "growth counter remains zero below the 0.05 and 0.01 RMS floors");

  KernelHarness epsilon_input;
  epsilon_input.stageAndCommit(makeParams());
  check(!epsilon_input.concrete().observeDetectorWindowForTesting(1.0e-12, 1.2, 0.6),
        "sustained detector records a finite epsilon-input predecessor");
  check(!epsilon_input.concrete().observeDetectorWindowForTesting(1.0e-12, 1.1, 0.55),
        "sustained detector requires exactly stopped input");
  check(!epsilon_input.concrete().observeDetectorWindowForTesting(1.0e-12, 1.02, 0.51),
        "epsilon input cannot accumulate the sustained branch");
  check(epsilon_input.concrete().detectorWindowStateForTesting()[1] == 0u,
        "sustained counter remains zero for nonzero input RMS");

  KernelHarness sustained;
  sustained.stageAndCommit(makeParams());
  check(!sustained.concrete().observeDetectorWindowForTesting(0.0, 1.2, 0.6),
        "sustained detector arms from an exact-zero-input predecessor");
  check(!sustained.concrete().observeDetectorWindowForTesting(0.0, 1.1, 0.55),
        "sustained detector waits after one non-decaying window");
  check(!sustained.concrete().observeDetectorWindowForTesting(0.0, 1.01, 0.51),
        "sustained detector waits after two non-decaying windows");
  check(sustained.concrete().observeDetectorWindowForTesting(0.0, 1.0, 0.5),
        "sustained detector latches at the exact 1.0 and 0.5 RMS floors");
  check(sustained.concrete().detectorWindowStateForTesting()[1] == 3u,
        "sustained detector keeps its independent three-window counter");
}

void testFeedbackFaultLifecycleAndSafetyPrecedence() {
  constexpr float sample_rate = 96000.0F;
  const std::uint32_t mute_frames = static_cast<std::uint32_t>(std::ceil(sample_rate * 0.005F));
  const std::uint32_t trial_frames = static_cast<std::uint32_t>(std::ceil(sample_rate * 0.100F));
  KernelHarness recovery(sample_rate);
  const Params initial = makeParams();
  recovery.stageAndCommit(initial);
  recovery.concrete().injectFeedbackOscillationForTesting();
  check(recovery.concrete().runtimeEventForTesting() == std::array<std::uint32_t, 3>{1u, 1u, 1u} &&
            recovery.concrete().faultStateForTesting() == 1u,
        "feedback detection latches once and begins muting");

  const std::uint32_t first_half = mute_frames / 2u;
  processFrames(recovery, first_half, {127u, 17u, 3u});
  const double last_progress =
      static_cast<double>(first_half - 1u) / static_cast<double>(mute_frames);
  const double expected_half_wet =
      1.0 - last_progress * last_progress * (3.0 - 2.0 * last_progress);
  check(std::abs(recovery.concrete().faultWetForTesting() - expected_half_wet) <= 1.0e-15,
        "fault mute follows the fixed cubic 5 ms envelope");

  Params eligible = initial;
  eligible.bias = 1.0F;
  recovery.stageAndCommit(eligible);
  check(recovery.concrete().appliedParametersForTesting()[2] == static_cast<double>(initial.bias),
        "eligible muting event remains a pending full snapshot before safe output");
  processFrames(recovery, mute_frames + 1u - first_half, {5u, 128u, 19u});
  check(recovery.concrete().detectionFrameForTesting() == 0u &&
            recovery.concrete().muteCompleteFrameForTesting() == mute_frames &&
            recovery.concrete().trialObservationStartFrameForTesting() == mute_frames + 1u,
        "fault reset and trial start use the exact detection+5 ms+one-frame schedule");
  check(recovery.concrete().faultStateForTesting() == 3u &&
            recovery.concrete().faultWetForTesting() == 0.0,
        "eligible safe-boundary commit starts a fully dry trial");
  check(recovery.concrete().appliedParametersForTesting()[2] == static_cast<double>(eligible.bias),
        "safe boundary atomically commits the eligible full snapshot");
  check(recovery.concrete().centralResetStateForTesting() == std::array<std::uint64_t, 2>{1u, 2u},
        "fault containment dispatches one central fault-circuit reset");
  check(recovery.concrete().detectorWindowStateForTesting() ==
            std::array<std::uint32_t, 3>{0u, 0u, 0u},
        "fault-circuit reset starts trial with a fresh detector");

  processFrames(recovery, trial_frames, {128u, 31u, 7u});
  check(recovery.concrete().faultStateForTesting() == 4u &&
            recovery.concrete().faultRemainingFramesForTesting()[2] == mute_frames,
        "clean 100 ms trial enters the fixed 5 ms cubic return");
  processFrames(recovery, mute_frames, {11u, 127u, 2u});
  check(recovery.concrete().faultStateForTesting() == 0u &&
            recovery.concrete().faultWetForTesting() == 1.0 &&
            recovery.concrete().runtimeEventForTesting() ==
                std::array<std::uint32_t, 3>{2u, 0u, 0u},
        "clean return reaches normal and publishes one clear generation");
  check(recovery.concrete().centralResetStateForTesting() == std::array<std::uint64_t, 2>{1u, 2u},
        "trial and return do not dispatch an extra circuit reset");

  KernelHarness redetection(sample_rate);
  redetection.stageAndCommit(initial);
  redetection.concrete().injectFeedbackOscillationForTesting();
  Params redetection_target = initial;
  redetection_target.plate = 251.0F;
  redetection.stageAndCommit(redetection_target);
  processFrames(redetection, mute_frames + 1u, {128u, 13u, 1u});
  check(redetection.concrete().faultStateForTesting() == 3u,
        "eligible feedback-fault change begins trial");
  const std::uint64_t first_detection = redetection.concrete().detectionFrameForTesting();
  redetection.concrete().injectFeedbackOscillationForTesting();
  check(redetection.concrete().faultStateForTesting() == 2u &&
            redetection.concrete().faultWetForTesting() == 0.0 &&
            redetection.concrete().runtimeEventForTesting() ==
                std::array<std::uint32_t, 3>{1u, 1u, 1u} &&
            redetection.concrete().detectionFrameForTesting() == first_detection,
        "trial redetection preserves the latch and first detection generation");
  const auto resets_before_explicit = redetection.concrete().centralResetStateForTesting();
  redetection.reset();
  check(redetection.concrete().centralResetStateForTesting() == resets_before_explicit &&
            redetection.concrete().faultStateForTesting() == 2u,
        "explicit reset cannot clear or retrigger a feedback-fault latch");

  redetection.concrete().injectProcessingSafetyFailureForTesting();
  check(redetection.concrete().runtimeEventForTesting() ==
                std::array<std::uint32_t, 3>{2u, 1u, 2u} &&
            redetection.concrete().faultStateForTesting() == 2u &&
            redetection.concrete().faultRemainingFramesForTesting() ==
                std::array<std::uint32_t, 3>{0u, 0u, 0u},
        "processing-safety failure upgrades cause and cancels every recovery phase");
  Params safety_target = redetection_target;
  safety_target.negativeFeedback = 30.0F;
  redetection.stageAndCommit(safety_target);
  processFrames(redetection, 128u, {128u});
  check(redetection.concrete().runtimeEventForTesting() ==
                std::array<std::uint32_t, 3>{2u, 1u, 2u} &&
            redetection.concrete().centralResetStateForTesting() == resets_before_explicit,
        "processing-safety latch never resets, trials, or auto-clears after parameter commits");
}

void testDescriptorSchemaPrepareAndTelemetryDeferral() {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_TubeSimulatorPlugin();
  check(descriptor != nullptr, "descriptor lookup succeeds");
  if (descriptor == nullptr) {
    return;
  }
  check(std::string_view(descriptor->typeName) == "TubeSimulatorPlugin",
        "descriptor type name matches");
  check(descriptor->paramsHash == Params::kHash, "descriptor hash matches parameter struct");
  check(descriptor->paramsFloatCount == 20u, "descriptor exposes 20 Float32 parameters");
  check(descriptor->paramsByteCapacity == 0u, "descriptor has no structured parameter bytes");
  check(descriptor->objectSize == sizeof(Kernel), "descriptor object size matches kernel");
  check(descriptor->objectSize <= kKernelStorageBytes, "descriptor object fits engine storage");

  KernelHarness harness;
  check(harness.kernel().latencySamples() == 64u, "96 kHz latency is 64 host samples");
  const Params defaults = makeParams();
  check(harness.kernel().stageParameters(reinterpret_cast<const float *>(&defaults),
                                         Params::kFloatCount, Params::kHash + 1u) == ET_ERR_HASH,
        "schema rejects a wrong hash");
  check(harness.kernel().stageParameters(reinterpret_cast<const float *>(&defaults),
                                         Params::kFloatCount - 1u, Params::kHash) == ET_ERR_ARGS,
        "schema rejects a wrong float count");

  const auto &payload = harness.concrete().telemetryPayloadForTesting();
  check(payload.size() == 41u, "telemetry payload contains 41 Float32 values");
  bool payload_finite = true;
  for (float value : payload) {
    payload_finite = payload_finite && std::isfinite(value);
  }
  check(payload_finite, "reset telemetry payload is finite");

  effetune::TelemetryRing ring;
  std::array<std::uint8_t, 256> storage{};
  ring.adopt(storage.data(), static_cast<std::uint32_t>(storage.size()));
  std::uint32_t sequence = 0u;
  effetune::TelemetryWriter writer(ring, 41u, sequence);
  harness.kernel().writeTelemetry(writer);
  check(ring.size() == 180u, "type 19 telemetry emits one v2 frame");
  check(sequence == 1u, "registered telemetry consumes one sequence");
}

void testDryImpulseAlignment() {
  KernelHarness harness;
  harness.stageAndCommit(makeParams(0.0F, 0.0F, 0.0F, 250.0F, 10.0F, 10.0F, 0.0F, 0.0F));
  harness.reset();
  constexpr std::uint32_t frames = 132u;
  std::vector<float> impulse(static_cast<std::size_t>(frames) * 2u, 0.0F);
  impulse[0] = 1.0F;
  impulse[frames] = -0.5F;
  const std::vector<float> output = render(harness, impulse, {5u, 7u, 4u, 11u, 1u});
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const float expected_left = frame == 64u ? 1.0F : 0.0F;
    const float expected_right = frame == 64u ? -0.5F : 0.0F;
    check(output[frame] == expected_left, "left dry impulse is aligned at index 64");
    check(output[frames + frame] == expected_right, "right dry impulse is aligned at index 64");
  }
}

void testSupportedRateDryAlignment() {
  constexpr std::uint32_t frames = 132u;
  for (float sample_rate : kSupportedSampleRates) {
    KernelHarness harness(sample_rate);
    check(harness.kernel().latencySamples() == 64u,
          "supported rate reports 64 host samples of latency");
    harness.stageAndCommit(makeParams(0.0F, 0.0F, 0.0F, 250.0F, 10.0F, 10.0F, 0.0F, 0.0F));
    harness.reset();
    std::vector<float> impulse(static_cast<std::size_t>(frames) * 2u, 0.0F);
    impulse[0] = 1.0F;
    impulse[frames] = -0.5F;
    const std::vector<float> output = render(harness, impulse, {5u, 7u, 4u, 11u, 1u});
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const float expected_left = frame == 64u ? 1.0F : 0.0F;
      const float expected_right = frame == 64u ? -0.5F : 0.0F;
      check(output[frame] == expected_left,
            "supported rate left dry impulse is aligned at index 64");
      check(output[frames + frame] == expected_right,
            "supported rate right dry impulse is aligned at index 64");
    }
    check(harness.concrete().runtimeFiniteForTesting(),
          "supported rate processing leaves finite runtime state");
  }
}

void testPreparedMaximumBeyondFrozenBlock() {
  constexpr std::uint32_t frames = 257u;
  KernelHarness harness(96000.0F, frames);
  harness.stageAndCommit(makeParams(-6.0F));
  harness.reset();
  std::vector<float> audio = makeSignal(frames, 17u);
  harness.process(audio, frames);
  check(finite(audio), "prepared maximum above 128 frames processes without a fixed-block limit");
  check(harness.concrete().accumulatorForTesting()[3] == 20.0 &&
            harness.concrete().accumulatorForTesting()[7] == 20.0,
        "large variable block retains the correct slow phase");
}

void testAllocationGuardIsEffective() {
  effetune::allocation_guard::setAbortOnViolationForTesting(false);
  const std::uint32_t before = effetune::allocation_guard::violationCount();
  std::byte *memory = nullptr;
  bool guard_enabled = false;
  {
    effetune::allocation_guard::Scope allocation_scope;
    guard_enabled = effetune::allocation_guard::active();
    memory = new (std::nothrow) std::byte[32u];
  }
  delete[] memory;
  if (!guard_enabled) {
    effetune::allocation_guard::setAbortOnViolationForTesting(true);
    return;
  }
  check(effetune::allocation_guard::violationCount() > before,
        "allocation guard detects a deliberate allocation");
  effetune::allocation_guard::setAbortOnViolationForTesting(true);

  KernelHarness harness;
  harness.stageAndCommit(makeParams());
  std::vector<float> audio = makeSignal(128u, 9u);
  const std::uint32_t process_before = effetune::allocation_guard::violationCount();
  harness.process(audio, 128u);
  check(effetune::allocation_guard::violationCount() == process_before,
        "normal kernel processing leaves guard count unchanged");
}

void testInputReferenceScaling() {
  KernelHarness harness;
  harness.stageAndCommit(makeParams());
  const auto defaults = harness.concrete().controlTargetsForTesting();
  const double expected_default = static_cast<double>(2.828F) * std::pow(10.0, -30.0 / 20.0);
  check(std::abs(defaults[0] - expected_default) <= 1.0e-12,
        "Input Reference and Input Volume form one pre-FIR scaling target");

  const std::uint64_t physical_before = harness.concrete().physicalStateDigestForTesting();
  harness.stageAndCommit(makeParams(-6.0F, 2.0F, 0.0F, 250.0F, 10.0F, 10.0F, 9.0F, 100.0F, 5.657F));
  const auto high_output_dac = harness.concrete().controlTargetsForTesting();
  const double expected_high_output_dac = static_cast<double>(5.657F) * std::pow(10.0, -6.0 / 20.0);
  check(std::abs(high_output_dac[0] - expected_high_output_dac) <= 1.0e-12,
        "4 Vrms Input Reference is attenuated at the input terminal");
  check(harness.concrete().physicalStateDigestForTesting() == physical_before,
        "Input Reference changes preserve the physical two-rate state");
}

void testResetReplay() {
  KernelHarness harness;
  const Params params = makeParams(-11.0F, 0.0F, 17.0F, 278.0F, 3.7F, 8.2F, -2.5F, 73.0F);
  harness.stageAndCommit(params);
  harness.reset();
  const std::vector<float> input = makeSignal(768u, 31u);
  const std::vector<float> first = render(harness, input, {127u, 64u, 113u, 31u});
  const std::uint64_t first_state = harness.concrete().stateDigestForTesting();
  harness.reset();
  const std::vector<float> replay = render(harness, input, {127u, 64u, 113u, 31u});
  check(first == replay, "reset reproduces Float32 output bit-for-bit");
  check(first_state == harness.concrete().stateDigestForTesting(),
        "reset reproduces the full state checkpoint");
  check(finite(first), "reset replay output remains finite");
}

void testParameterStateRules() {
  // The post-model safety reduction deliberately survives reset(), so an instance that has seen
  // audio can legitimately carry a reduction that a never-run instance cannot. This test is about
  // parameter and reset semantics and ends by comparing an evolved checkpoint against a fresh one,
  // so it runs with the mechanism switched off and the comparison stays a comparison of the model.
  const auto withoutSafety = [](Params params) noexcept {
    params.autoGainReduction = 0.0F;
    return params;
  };
  KernelHarness harness;
  harness.stageAndCommit(withoutSafety(makeParams()));
  harness.reset();
  std::vector<float> prefix = makeSignal(2u, 5u);
  harness.process(prefix, 2u);
  const std::uint64_t physical_before = harness.concrete().physicalStateDigestForTesting();
  const auto accumulator_before = harness.concrete().accumulatorForTesting();
  const auto controls_before = harness.concrete().controlCurrentForTesting();
  check(accumulator_before[3] == 8.0 && accumulator_before[7] == 8.0,
        "two host frames retain eight internal endpoints");

  const Params non_reset_change =
      withoutSafety(makeParams(-24.0F, 2.0F, 33.0F, 291.0F, 1.2F, 23.0F, 6.0F, 41.0F));
  harness.stageAndCommit(non_reset_change);
  check(harness.concrete().physicalStateDigestForTesting() == physical_before,
        "non-Tube parameters preserve physical state and histories");
  check(harness.concrete().accumulatorForTesting() == accumulator_before,
        "non-Tube parameters preserve the partial accumulator");
  check(harness.concrete().controlCurrentForTesting() == controls_before,
        "Input Volume/Output Trim/Mix commits preserve smoothed currents");

  const Params tube_change =
      withoutSafety(makeParams(-7.0F, 1.0F, -21.0F, 233.0F, 18.0F, 4.7F, 3.0F, 62.0F));
  harness.stageAndCommit(tube_change);
  check(harness.concrete().accumulatorForTesting() == accumulator_before,
        "Tube reset-class change preserves the old circuit until the dry boundary");
  processFrames(harness, 480u, {127u, 31u, 5u});
  check(harness.concrete().accumulatorForTesting()[3] == 0.0 &&
            harness.concrete().accumulatorForTesting()[7] == 0.0,
        "Tube midpoint reset discards the partial accumulator");
  check(harness.concrete().slowPublishCountForTesting() == 0u,
        "Tube midpoint reset clears slow publish count");

  KernelHarness fresh;
  fresh.stageAndCommit(tube_change);
  harness.reset();
  check(harness.concrete().stateDigestForTesting() == fresh.concrete().stateDigestForTesting(),
        "Tube reset uses all ten newly committed parameters");
}

void testFirstParameterCommitResetsNonDefault12AX7() {
  constexpr std::uint32_t frames = 128u;
  const Params params = makeParams(-7.0F, 0.0F, 8.0F, 255.0F, 9.0F, 12.0F, 1.0F, 91.0F);
  const std::vector<float> input = makeSignal(frames, 17u);
  const auto render_first_commit = [&](bool use_simd) {
    KernelHarness harness(96000.0F, frames, use_simd);
    harness.stage(params);
    std::vector<float> output = input;
    harness.process(output, frames);
    return output;
  };

  const std::vector<float> scalar_output = render_first_commit(false);
  KernelHarness reset_reference(96000.0F, frames, false);
  reset_reference.stageAndCommit(params);
  reset_reference.reset();
  const std::vector<float> expected = render(reset_reference, input, {frames});
  check(scalar_output == expected,
        "first non-default 12AX7 commit matches an explicitly reset instance");

  if (Kernel::simdPathAvailableForTesting()) {
    const std::vector<float> simd_output = render_first_commit(true);
    check(simd_output == expected,
          "first non-default 12AX7 f64x2 commit matches the scalar reset instance");
  }
}

void testNonAlignedPartitionInvariance() {
  KernelHarness canonical;
  KernelHarness fragmented;
  const Params params = makeParams(-18.0F, 2.0F, -13.0F, 267.0F, 6.8F, 14.0F, -1.5F, 84.0F);
  canonical.stageAndCommit(params);
  fragmented.stageAndCommit(params);
  canonical.reset();
  fragmented.reset();
  const std::vector<float> input = makeSignal(1152u, 73u);
  const std::vector<float> canonical_output = render(canonical, input, {128u});
  const std::vector<float> fragmented_output = render(fragmented, input, {5u, 7u, 4u, 11u, 1u});
  check(canonical_output == fragmented_output,
        "non-aligned partitions preserve every Float32 output");
  check(canonical.concrete().stateDigestForTesting() ==
            fragmented.concrete().stateDigestForTesting(),
        "non-aligned partitions preserve the final checkpoint");
  check(canonical.concrete().accumulatorForTesting() ==
            fragmented.concrete().accumulatorForTesting(),
        "non-aligned partitions preserve accumulator phase");
  check(canonical.concrete().slowPublishCountForTesting() ==
            fragmented.concrete().slowPublishCountForTesting(),
        "non-aligned partitions preserve slow publish count");
}

void testSupportedRatePartitionInvariance() {
  const Params params = makeParams(-12.0F, 1.0F, -9.0F, 252.0F, 7.5F, 11.0F, -2.0F, 81.0F);
  const std::vector<float> input = makeSignal(256u, 91u);
  for (float sample_rate : kSupportedSampleRates) {
    KernelHarness canonical(sample_rate);
    KernelHarness fragmented(sample_rate);
    canonical.stageAndCommit(params);
    fragmented.stageAndCommit(params);
    canonical.reset();
    fragmented.reset();
    const std::vector<float> canonical_output = render(canonical, input, {128u});
    const std::vector<float> fragmented_output = render(fragmented, input, {5u, 7u, 4u, 11u, 1u});
    check(canonical_output == fragmented_output,
          "supported rate output is invariant to non-aligned partitions");
    check(canonical.concrete().stateDigestForTesting() ==
              fragmented.concrete().stateDigestForTesting(),
          "supported rate checkpoint is invariant to non-aligned partitions");
  }
}

// ------------------------------------------------------------------------------------------
// Output-stage safety trim. These run at 44.1 kHz because the ramp is measured in host frames
// and the lowest supported rate makes it the cheapest to render.
// ------------------------------------------------------------------------------------------

constexpr float kSafetySampleRate = 44100.0F;
constexpr double kSafetyToneHz = 1000.0;
// Comfortably past the 882-frame ramp, and long enough for the model to settle so the peak the
// detector latches onto stops growing.
constexpr std::uint32_t kSafetySettleBlocks = 48u;

// A full-scale 1 kHz tone through the maximum output trim. The trim sits behind the model, so this
// is simply a wet path whose samples run past digital full scale.
Params makeSafetyParams(float safety_trim = 0.0F, float auto_gain_reduction = 1.0F,
                        float output_trim = 48.0F) noexcept {
  return makeParams(-30.0F, 2.0F, 0.0F, 250.0F, 10.0F, 10.0F, output_trim, 100.0F, 2.828F, 0.0F,
                    0.0F, 0.0F, 320.0F, 270.0F, 0.0F, 2.0F, 1.0F, 8.0F, safety_trim,
                    auto_gain_reduction);
}

std::vector<float> makeSafetyTone(std::uint32_t blocks, std::uint32_t &phase) {
  const std::uint32_t frames = blocks * kMaximumFrames;
  std::vector<float> signal(static_cast<std::size_t>(frames) * 2u, 0.0F);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const double angle = 6.283185307179586476925286766559 * kSafetyToneHz *
                         static_cast<double>(phase + frame) /
                         static_cast<double>(kSafetySampleRate);
    const float sample = static_cast<float>(std::sin(angle));
    signal[frame] = sample;
    signal[static_cast<std::size_t>(frames) + frame] = sample;
  }
  phase += frames;
  return signal;
}

std::vector<float> renderSafetyTone(KernelHarness &harness, std::uint32_t blocks,
                                    std::uint32_t &phase) {
  const std::vector<float> tone = makeSafetyTone(blocks, phase);
  return render(harness, tone, {kMaximumFrames});
}

void renderSafetySilence(KernelHarness &harness, std::uint32_t blocks) {
  const std::vector<float> silence(static_cast<std::size_t>(blocks) * kMaximumFrames * 2u, 0.0F);
  static_cast<void>(render(harness, silence, {kMaximumFrames}));
}

// Commits `params` and advances one block of silence. Silence carries no sample past full scale,
// so nothing the detector does during that block can move the reduction: whatever is observed
// afterwards is what the commit left behind.
double commitAndSettle(KernelHarness &harness, const Params &params) {
  harness.stage(params);
  renderSafetySilence(harness, 1u);
  return harness.concrete().safetyReductionForTesting()[0];
}

double peakMagnitude(const std::vector<float> &audio) noexcept {
  double peak = 0.0;
  for (float sample : audio) {
    const double magnitude = std::abs(static_cast<double>(sample));
    if (magnitude > peak) {
      peak = magnitude;
    }
  }
  return peak;
}

void testSafetyReductionEngagesAndNeverRecovers() {
  KernelHarness harness(kSafetySampleRate);
  harness.stageAndCommit(makeSafetyParams());
  harness.reset();
  check(harness.concrete().safetyRampFramesForTesting() == 882u,
        "the reduction ramp is 20 ms of host frames");
  check(harness.concrete().safetyReductionForTesting()[0] == 1.0,
        "nothing is reduced before any audio");

  std::uint32_t phase = 0u;
  static_cast<void>(renderSafetyTone(harness, kSafetySettleBlocks, phase));
  const std::array<double, 3> engaged = harness.concrete().safetyReductionForTesting();
  check(engaged[0] < 1.0, "a sample above 0 dBFS engages the reduction");
  check(engaged[0] == engaged[1], "the ramp reaches its target");
  check(engaged[2] == 0.0, "the ramp is finished");

  // A limiter would release here. This must not: the reduction is one way.
  renderSafetySilence(harness, kSafetySettleBlocks);
  check(harness.concrete().safetyReductionForTesting()[0] == engaged[0],
        "the reduction does not recover once the signal goes quiet");
}

// The detection point is the wet chain after the output trim and before the mix, and at mx = 100
// with no fault or transition in flight that chain is exactly what leaves the plug-in. So the run
// with the detector disabled is a recording of what the detector saw, and the reduction the law
// calls for is one divided by the largest magnitude in it.
void testSafetySinglePeakSetsTheReduction() {
  KernelHarness observed(kSafetySampleRate);
  KernelHarness reduced(kSafetySampleRate);
  observed.stageAndCommit(makeSafetyParams(0.0F, 0.0F));
  reduced.stageAndCommit(makeSafetyParams(0.0F, 1.0F));
  observed.reset();
  reduced.reset();

  std::uint32_t observed_phase = 0u;
  std::uint32_t reduced_phase = 0u;
  const std::vector<float> chain = renderSafetyTone(observed, kSafetySettleBlocks, observed_phase);
  static_cast<void>(renderSafetyTone(reduced, kSafetySettleBlocks, reduced_phase));

  const double peak = peakMagnitude(chain);
  check(peak > 1.0, "the observation run never went past full scale, so nothing was proved");
  const double expected = 1.0 / peak;
  const std::array<double, 3> engaged = reduced.concrete().safetyReductionForTesting();
  // The recording is Float32 and the detector works in double, so the two agree to the width of a
  // Float32 mantissa and no closer.
  check(std::abs(engaged[1] - expected) <= 1e-6 * expected,
        "the target is not the reciprocal of the loudest sample the detector saw");
  check(engaged[0] == engaged[1], "the ramp reached that target");

  renderSafetySilence(reduced, kSafetySettleBlocks);
  check(reduced.concrete().safetyReductionForTesting()[0] == engaged[0],
        "the reduction that one sample called for did not survive the silence");
}

// The reduction is specified to survive a model reset and a fault rebuild: neither is the user
// asking for the protection to be given up, and the mechanism only ever attenuates. Without this
// test, clearing it in resetModel() or dropping the carry-over in restoreRuntimeBaseline() leaves
// the whole suite green.
void testSafetyReductionSurvivesResetAndFaultRecovery() {
  KernelHarness harness(kSafetySampleRate);
  harness.stageAndCommit(makeSafetyParams());
  harness.reset();
  std::uint32_t phase = 0u;
  static_cast<void>(renderSafetyTone(harness, kSafetySettleBlocks, phase));
  const std::array<double, 3> engaged = harness.concrete().safetyReductionForTesting();
  check(engaged[0] < 1.0, "the reduction engaged before the reset is exercised");

  harness.reset();
  const std::array<double, 3> after_reset = harness.concrete().safetyReductionForTesting();
  check(after_reset[0] == engaged[0], "reset() gave back the reduction the detector had taken");
  check(after_reset[1] == engaged[1], "reset() cleared the standing target");

  // Silence through the rebuilt model must still come out attenuated, which is what proves the
  // reduction is applied and not merely remembered.
  renderSafetySilence(harness, 1u);
  check(harness.concrete().safetyReductionForTesting()[0] == engaged[0],
        "the reduction did not survive the first block after reset()");

  // A non-finite input latches the processing-safety fault and rebuilds the runtime baseline.
  std::vector<float> poisoned(static_cast<std::size_t>(kMaximumFrames) * 2u, 0.0F);
  poisoned[0] = std::numeric_limits<float>::quiet_NaN();
  harness.process(poisoned, kMaximumFrames);
  check(harness.concrete().runtimeEventForTesting()[1] == 1u,
        "the poisoned block latched the processing-safety fault, so recovery really ran");
  const std::array<double, 3> after_fault = harness.concrete().safetyReductionForTesting();
  check(after_fault[0] == engaged[0], "fault recovery gave back the reduction");
  check(after_fault[1] == engaged[1], "fault recovery cleared the standing target");
  renderSafetySilence(harness, 1u);
  check(harness.concrete().safetyReductionForTesting()[0] == engaged[0],
        "the reduction did not survive the block after fault recovery");
}

void testSafetyReductionFreezesWhenDisabled() {
  KernelHarness harness(kSafetySampleRate);
  harness.stageAndCommit(makeSafetyParams(0.0F, 0.0F));
  harness.reset();
  std::uint32_t phase = 0u;
  static_cast<void>(renderSafetyTone(harness, kSafetySettleBlocks, phase));
  const std::array<double, 3> frozen = harness.concrete().safetyReductionForTesting();
  check(frozen[0] == 1.0, "a disabled detector applies no attenuation at all");
  check(frozen[1] == 1.0, "a disabled detector moves no target");
  check(frozen[2] == 0.0, "a disabled detector arms no ramp");
}

void testSafetyReductionResetRule() {
  KernelHarness harness(kSafetySampleRate);
  const Params base = makeSafetyParams();
  harness.stageAndCommit(base);
  harness.reset();
  std::uint32_t phase = 0u;
  static_cast<void>(renderSafetyTone(harness, kSafetySettleBlocks, phase));
  const double engaged = harness.concrete().safetyReductionForTesting()[0];
  check(engaged < 1.0, "the reduction engaged before the reset rule is exercised");

  // The whole point of comparing values rather than write edges: staging the identical record is
  // a write, and a write must not drop protection.
  check(commitAndSettle(harness, base) == engaged,
        "re-writing an identical parameter record does not reset the reduction");

  Params one_field = base;
  one_field.outputTrim = 47.0F;
  check(commitAndSettle(harness, one_field) == engaged,
        "a single control change does not reset the reduction");

  Params frozen = one_field;
  frozen.autoGainReduction = 0.0F;
  check(commitAndSettle(harness, frozen) == engaged,
        "turning auto gain reduction off does not reset the reduction");
  check(commitAndSettle(harness, one_field) == engaged,
        "turning auto gain reduction back on does not reset the reduction");

  Params trim_only = one_field;
  trim_only.safetyTrim = -3.0F;
  check(commitAndSettle(harness, trim_only) == 1.0, "a safety trim change clears the reduction");

  // Re-engage, then write a record that differs in two values the way a preset does. The safety
  // trim is unchanged there, so the count is what has to catch it. The silence in between lets
  // the circuit ring down: straight after the tone the model is still swinging past full scale on
  // its own, and a cleared reduction would re-engage inside the very block that cleared it.
  static_cast<void>(renderSafetyTone(harness, kSafetySettleBlocks, phase));
  renderSafetySilence(harness, kSafetySettleBlocks);
  const double reengaged = harness.concrete().safetyReductionForTesting()[0];
  check(reengaged < 1.0, "the reduction re-engaged after the trim change");
  Params record = trim_only;
  record.outputTrim = 46.0F;
  record.bias = 5.0F;
  check(commitAndSettle(harness, record) == 1.0,
        "a commit changing two values clears the reduction");
}

// The assumed load selects the measured speaker profile and fixes the turns ratio; the actual
// load scales that network by k = actual / assumed. At the design point k is exactly one, so the
// scaled network has to reproduce the measured one bit for bit.
void testActualSpeakerLoadScalesTheNetwork() {
  const auto powerParams = [](float actual_load) noexcept {
    return makeParams(-12.0F, 0.0F, 0.0F, 250.0F, 10.0F, 10.0F, 9.0F, 100.0F, 2.828F, 0.0F, 1.0F,
                      1.0F, 470.0F, 270.0F, 1.0F, 2.0F, 1.0F, actual_load, 0.0F, 0.0F);
  };
  const std::vector<float> input = makeSignal(512u, 37u, 0.6F);

  KernelHarness design(96000.0F);
  KernelHarness matched(96000.0F);
  design.stageAndCommit(makeParams(-12.0F, 0.0F, 0.0F, 250.0F, 10.0F, 10.0F, 9.0F, 100.0F, 2.828F,
                                   0.0F, 1.0F, 1.0F, 470.0F, 270.0F, 1.0F, 2.0F, 1.0F, 8.0F, 0.0F,
                                   0.0F));
  matched.stageAndCommit(powerParams(8.0F));
  design.reset();
  matched.reset();
  const std::vector<float> design_output = render(design, input, {kMaximumFrames});
  const std::vector<float> matched_output = render(matched, input, {kMaximumFrames});
  check(design_output == matched_output,
        "an actual load equal to the assumed load reproduces the design point exactly");
  check(design.concrete().stateDigestForTesting() == matched.concrete().stateDigestForTesting(),
        "the design point checkpoint is unchanged by the actual load parameter");

  KernelHarness mismatched(96000.0F);
  mismatched.stageAndCommit(powerParams(4.0F));
  mismatched.reset();
  const std::vector<float> mismatched_output = render(mismatched, input, {kMaximumFrames});
  check(mismatched_output != design_output,
        "halving the actual load left the plant unchanged, so the scaling is not connected");
  check(finite(mismatched_output), "a mismatched load keeps the output finite");
}

#if ET_TUBE_HAS_F64X2
void testSafetyReductionScalarSimdParity() {
  KernelHarness scalar(kSafetySampleRate, kMaximumFrames, false);
  KernelHarness simd(kSafetySampleRate, kMaximumFrames, true);
  const Params params = makeSafetyParams();
  scalar.stageAndCommit(params);
  simd.stageAndCommit(params);
  scalar.reset();
  simd.reset();
  std::uint32_t scalar_phase = 0u;
  std::uint32_t simd_phase = 0u;
  // The scalar mix runs in two passes so that the stereo-linked detector can see both channels of
  // a frame at once, while the f64x2 mix stays one pass. This is the test that keeps them equal
  // with the detector actually engaged rather than only while it is idle.
  const std::vector<float> scalar_output =
      renderSafetyTone(scalar, kSafetySettleBlocks, scalar_phase);
  const std::vector<float> simd_output = renderSafetyTone(simd, kSafetySettleBlocks, simd_phase);
  check(scalar.concrete().safetyReductionForTesting()[0] < 1.0,
        "the scalar and f64x2 safety comparison runs with the detector engaged");
  check(scalar_output == simd_output,
        "scalar and f64x2 outputs are identical with the reduction engaged");
  check(scalar.concrete().safetyReductionForTesting() ==
            simd.concrete().safetyReductionForTesting(),
        "scalar and f64x2 reach the same reduction");
  check(scalar.concrete().stateDigestForTesting() == simd.concrete().stateDigestForTesting(),
        "scalar and f64x2 checkpoints match with the reduction engaged");
}
#endif

void testResetDiscardsPartialWindow() {
  KernelHarness evolved;
  KernelHarness fresh;
  const Params params = makeParams(-7.0F, 0.0F, 8.0F, 255.0F, 9.0F, 12.0F, 1.0F, 91.0F);
  evolved.stageAndCommit(params);
  fresh.stageAndCommit(params);
  evolved.reset();
  fresh.reset();
  std::vector<float> prefix = makeSignal(128u, 101u);
  evolved.process(prefix, 128u);
  const auto partial = evolved.concrete().accumulatorForTesting();
  check(partial[3] == 8.0 && partial[7] == 8.0, "128 host frames leave phase eight");
  evolved.reset();
  check(evolved.concrete().accumulatorForTesting()[3] == 0.0 &&
            evolved.concrete().accumulatorForTesting()[7] == 0.0,
        "explicit reset discards a partial slow window");
  check(evolved.concrete().slowPublishCountForTesting() == 0u,
        "explicit reset clears publish count");
  check(evolved.concrete().stateDigestForTesting() == fresh.concrete().stateDigestForTesting(),
        "explicit reset returns to a fresh DC checkpoint");

  const std::vector<float> suffix = makeSignal(384u, 401u);
  const std::vector<float> reset_output = render(evolved, suffix, {13u, 29u, 5u});
  const std::vector<float> fresh_output = render(fresh, suffix, {13u, 29u, 5u});
  check(reset_output == fresh_output, "post-reset output matches a fresh instance");
}

void testMidWindowParameterEvent() {
  KernelHarness harness;
  harness.stageAndCommit(makeParams(-13.0F));
  harness.reset();
  std::vector<float> first = makeSignal(2u, 211u, 0.9F);
  harness.process(first, 2u);
  const auto old_accumulator = harness.concrete().accumulatorForTesting();
  const auto old_slow = harness.concrete().slowStateForTesting();
  check(old_accumulator[3] == 8.0 && old_accumulator[7] == 8.0,
        "event begins after eight old endpoints");

  harness.stageAndCommit(makeParams(-13.0F, 2.0F, 29.0F, 250.0F, 10.0F, 27.0F));
  check(harness.concrete().accumulatorForTesting() == old_accumulator,
        "mid-window Bias/Supply event retains old sums");
  check(harness.concrete().slowStateForTesting() == old_slow,
        "mid-window event does not publish early");

  std::vector<float> next_twelve = makeSignal(3u, 213u, 0.9F);
  harness.process(next_twelve, 3u);
  check(harness.concrete().accumulatorForTesting()[3] == 20.0 &&
            harness.concrete().accumulatorForTesting()[7] == 20.0,
        "twelve new endpoints extend the retained phase to 20");
  check(harness.concrete().slowPublishCountForTesting() == 0u,
        "slow state remains unpublished before endpoint 24");

  std::vector<float> final_four = makeSignal(1u, 216u, 0.9F);
  harness.process(final_four, 1u);
  check(harness.concrete().accumulatorForTesting()[3] == 0.0 &&
            harness.concrete().accumulatorForTesting()[7] == 0.0,
        "endpoint 24 publishes and clears both accumulators");
  check(harness.concrete().slowPublishCountForTesting() == 2u,
        "endpoint 24 publishes once per channel");
  check(harness.concrete().slowStateForTesting() != old_slow,
        "published slow checkpoint includes the mixed window");
}

void testScalarSimdParity() {
  if (!Kernel::simdPathAvailableForTesting()) {
    return;
  }
  const Params initial = makeParams(-31.0F, 1.0F, 24.0F, 286.0F, 2.4F, 19.0F, -4.0F, 67.0F);
  const Params event = makeParams(-12.0F, 1.0F, -17.0F, 228.0F, 8.1F, 7.0F, 2.0F, 43.0F, 5.657F);
  for (float sample_rate : kSupportedSampleRates) {
    KernelHarness scalar(sample_rate, kMaximumFrames, false);
    KernelHarness simd(sample_rate, kMaximumFrames, true);
    scalar.stageAndCommit(initial);
    simd.stageAndCommit(initial);
    scalar.reset();
    simd.reset();
    const std::vector<float> input = makeSignal(896u, 503u, 0.95F);
    const std::vector<float> scalar_prefix = render(scalar, input, {127u, 31u, 113u, 17u});
    const std::vector<float> simd_prefix = render(simd, input, {127u, 31u, 113u, 17u});
    check(scalar_prefix == simd_prefix,
          "six-rate scalar and f64x2 event fixture outputs have exact parity");
    scalar.stageAndCommit(event);
    simd.stageAndCommit(event);
    const std::vector<float> event_input = makeSignal(257u, 509u, 0.4F);
    const std::vector<float> scalar_event = render(scalar, event_input, {127u, 31u, 113u, 17u});
    const std::vector<float> simd_event = render(simd, event_input, {127u, 31u, 113u, 17u});
    check(scalar_event == simd_event,
          "six-rate scalar and f64x2 parameter-event outputs have exact parity");
    scalar.reset();
    simd.reset();
    const std::vector<float> reset_input = makeSignal(193u, 521u, 0.2F);
    const std::vector<float> scalar_reset = render(scalar, reset_input, {127u, 31u, 113u, 17u});
    const std::vector<float> simd_reset = render(simd, reset_input, {127u, 31u, 113u, 17u});
    check(scalar_reset == simd_reset, "six-rate scalar and f64x2 reset outputs have exact parity");
    check(scalar.concrete().stateDigestForTesting() == simd.concrete().stateDigestForTesting(),
          "six-rate scalar and f64x2 state checkpoints are identical");
    check(scalar.concrete().telemetryPayloadForTesting() ==
              simd.concrete().telemetryPayloadForTesting(),
          "six-rate scalar and f64x2 telemetry checkpoints are identical");
    check(finite(scalar_prefix) && finite(scalar_event) && finite(scalar_reset),
          "six-rate scalar and f64x2 fixture remains finite");

    KernelHarness scalar_transition(sample_rate, kMaximumFrames, false);
    KernelHarness simd_transition(sample_rate, kMaximumFrames, true);
    const Params feedback_on =
        makeParams(-6.0F, 2.0F, 0.0F, 250.0F, 10.0F, 10.0F, 9.0F, 100.0F, 2.828F, 30.0F);
    Params feedback_off = feedback_on;
    feedback_off.negativeFeedback = 0.0F;
    scalar_transition.stageAndCommit(feedback_on);
    simd_transition.stageAndCommit(feedback_on);
    scalar_transition.reset();
    simd_transition.reset();
    scalar_transition.stageAndCommit(feedback_off);
    simd_transition.stageAndCommit(feedback_off);
    const std::uint32_t fade_frames = static_cast<std::uint32_t>(std::ceil(sample_rate * 0.005F));
    const std::uint32_t warmup_frames = static_cast<std::uint32_t>(std::ceil(sample_rate * 0.050F));
    const std::uint32_t cycle_frames = fade_frames + warmup_frames + fade_frames;
    const std::vector<float> transition_input = makeSignal(cycle_frames, 601u, 0.35F);
    check(render(scalar_transition, transition_input, {127u, 31u, 113u, 17u}) ==
              render(simd_transition, transition_input, {127u, 31u, 113u, 17u}),
          "six-rate scalar and f64x2 reset-transition outputs have exact parity");
    check(scalar_transition.concrete().stateDigestForTesting() ==
              simd_transition.concrete().stateDigestForTesting(),
          "six-rate scalar and f64x2 reset-transition states have exact parity");

    KernelHarness scalar_fault(sample_rate, kMaximumFrames, false);
    KernelHarness simd_fault(sample_rate, kMaximumFrames, true);
    scalar_fault.stageAndCommit(feedback_on);
    simd_fault.stageAndCommit(feedback_on);
    scalar_fault.reset();
    simd_fault.reset();
    scalar_fault.concrete().injectFeedbackOscillationForTesting();
    simd_fault.concrete().injectFeedbackOscillationForTesting();
    const std::vector<float> fault_input = makeSignal(fade_frames + 1u, 701u, 0.2F);
    check(render(scalar_fault, fault_input, {127u, 13u, 1u}) ==
              render(simd_fault, fault_input, {127u, 13u, 1u}),
          "six-rate scalar and f64x2 fault-mute outputs have exact parity");
    check(scalar_fault.concrete().stateDigestForTesting() ==
                  simd_fault.concrete().stateDigestForTesting() &&
              scalar_fault.concrete().runtimeEventForTesting() ==
                  simd_fault.concrete().runtimeEventForTesting(),
          "six-rate scalar and f64x2 fault-mute states and events have exact parity");
  }
}

void testSafeguardedPlateFallbackTortureCorner() {
  KernelHarness scalar(96000.0F, kMaximumFrames, false);
  const Params params = makeParams(0.0F, 1.0F, -50.0F, 300.0F, 0.6F, 0.1F, 0.0F, 100.0F, 1.0F);
  scalar.stageAndCommit(params);
  scalar.reset();

  constexpr std::uint32_t pre_roll_frames = 422400u;
  constexpr std::uint32_t active_frames = 3072u;
  constexpr double amplitude = 0.753565929453;
  constexpr double frequency = 20.0;
  constexpr double sample_rate = 96000.0;
  struct TortureResult {
    std::uint64_t fallbacks = 0u;
    bool succeeded = true;
    bool finite_output = true;
  };
  const auto exercise = [&](KernelHarness &harness, std::vector<float> &block,
                            std::vector<float> &output) {
    TortureResult result;
    for (std::uint32_t offset = 0u; offset < pre_roll_frames; offset += kMaximumFrames) {
      std::fill(block.begin(), block.end(), 0.0F);
      result.succeeded = harness.processSuccessfully(block, kMaximumFrames) && result.succeeded;
      result.finite_output = finite(block) && result.finite_output;
    }

    const std::uint64_t fallbacks_before = harness.concrete().plateFallbackSuccessesForTesting();
    for (std::uint32_t offset = 0u; offset < active_frames; offset += kMaximumFrames) {
      for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
        const std::size_t block_channel_offset = static_cast<std::size_t>(channel) * kMaximumFrames;
        for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
          const double phase = 2.0 * 3.141592653589793238462643383279502884 * frequency *
                               static_cast<double>(offset + frame) / sample_rate;
          block[block_channel_offset + frame] =
              static_cast<float>(std::sin(phase) >= 0.0 ? amplitude : -amplitude);
        }
      }
      result.succeeded = harness.processSuccessfully(block, kMaximumFrames) && result.succeeded;
      result.finite_output = finite(block) && result.finite_output;
      for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
        const std::size_t block_channel_offset = static_cast<std::size_t>(channel) * kMaximumFrames;
        const std::size_t output_channel_offset =
            static_cast<std::size_t>(channel) * active_frames + offset;
        std::memcpy(output.data() + output_channel_offset, block.data() + block_channel_offset,
                    static_cast<std::size_t>(kMaximumFrames) * sizeof(float));
      }
    }
    result.fallbacks = harness.concrete().plateFallbackSuccessesForTesting() - fallbacks_before;
    return result;
  };

  std::vector<float> scalar_block(static_cast<std::size_t>(kMaximumFrames) * 2u, 0.0F);
  std::vector<float> scalar_output(static_cast<std::size_t>(active_frames) * 2u, 0.0F);
  const std::vector<float> oracle_fixture =
      loadFloat32Fixture(kTortureOracleFixtureName, static_cast<std::size_t>(active_frames) * 2u);
  const TortureResult scalar_result = exercise(scalar, scalar_block, scalar_output);
  check(scalar_result.succeeded, "12AT7 torture corner succeeds for every scalar process block");
  check(scalar_result.finite_output, "12AT7 torture corner keeps every scalar output finite");
  check(scalar.concrete().finiteFaultsForTesting() == 0u,
        "12AT7 torture corner records no scalar finite faults");
  check(scalar.concrete().safetyLimitsForTesting() == 0u,
        "12AT7 torture corner records no scalar safety limits");
  check(scalar.concrete().runtimeFiniteForTesting(),
        "12AT7 torture corner leaves scalar runtime state finite");
  check(scalar_result.fallbacks > 0u, "12AT7 torture corner exercises scalar plate fallbacks");
  check(std::any_of(scalar_output.begin(), scalar_output.end(),
                    [](float sample) { return sample != 0.0F; }),
        "12AT7 torture corner produces non-zero scalar output");
  compareTortureOracleFixture(scalar_output, oracle_fixture, "scalar");

  if (!Kernel::simdPathAvailableForTesting()) {
    return;
  }

  KernelHarness simd(96000.0F, kMaximumFrames, true);
  simd.stageAndCommit(params);
  simd.reset();
  std::vector<float> simd_block(static_cast<std::size_t>(kMaximumFrames) * 2u, 0.0F);
  std::vector<float> simd_output(static_cast<std::size_t>(active_frames) * 2u, 0.0F);
  const TortureResult simd_result = exercise(simd, simd_block, simd_output);
  check(simd_result.succeeded, "12AT7 torture corner succeeds for every f64x2 process block");
  check(simd_result.finite_output, "12AT7 torture corner keeps every f64x2 output finite");
  check(simd.concrete().finiteFaultsForTesting() == 0u,
        "12AT7 torture corner records no f64x2 finite faults");
  check(simd.concrete().safetyLimitsForTesting() == 0u,
        "12AT7 torture corner records no f64x2 safety limits");
  check(simd.concrete().runtimeFiniteForTesting(),
        "12AT7 torture corner leaves f64x2 runtime state finite");
  compareTortureOracleFixture(simd_output, oracle_fixture, "f64x2");
  check(scalar_result.fallbacks == simd_result.fallbacks,
        "12AT7 torture corner exercises matching scalar and f64x2 plate fallbacks");
  check(scalar_output == simd_output,
        "12AT7 torture corner has exact scalar and f64x2 Float32 output parity");
  check(scalar.concrete().stateDigestForTesting() == simd.concrete().stateDigestForTesting(),
        "12AT7 torture corner has exact scalar and f64x2 state parity");
  check(scalar.concrete().telemetryPayloadForTesting() ==
            simd.concrete().telemetryPayloadForTesting(),
        "12AT7 torture corner has exact scalar and f64x2 telemetry parity");
}

void testFiniteSafetyRecovery() {
  const Params recovery_params =
      makeParams(-6.0F, 2.0F, 25.0F, 285.0F, 3.3F, 22.0F, -4.0F, 37.0F, 4.0F);
  KernelHarness harness;
  harness.stageAndCommit(recovery_params);
  harness.reset();
  std::vector<float> corner = makeSignal(512u, 607u, 1.0F);
  const std::vector<float> corner_output = render(harness, corner, {128u});
  check(finite(corner_output), "range-corner output remains finite");
  check(harness.concrete().runtimeFiniteForTesting(),
        "range-corner persistent state remains finite");

  std::vector<float> overload(2u, std::numeric_limits<float>::max());
  harness.process(overload, 1u);
  check(finite(overload), "safety recovery output remains finite");
  check(harness.concrete().safetyLimitsForTesting() != 0u ||
            harness.concrete().finiteFaultsForTesting() != 0u,
        "extreme input exercises safety or finite recovery");
  check(harness.concrete().runtimeFiniteForTesting(),
        "safety recovery restores a finite persistent domain");

  std::vector<float> non_finite = {std::numeric_limits<float>::quiet_NaN(), 0.0F};
  const std::uint64_t faults_before = harness.concrete().finiteFaultsForTesting();
  harness.process(non_finite, 1u);
  check(finite(non_finite), "non-finite input recovery emits finite samples");
  check(harness.concrete().finiteFaultsForTesting() == faults_before,
        "latched safety bypass does not re-enter the failed wet circuit");
  check(harness.concrete().runtimeFiniteForTesting(),
        "non-finite recovery restores the persistent domain");
  effetune::RuntimeEventState safety_event{};
  harness.kernel().readRuntimeEvent(safety_event);
  check(safety_event.latched == 1u && safety_event.cause == 2u,
        "non-finite recovery latches the processing safety runtime event");
  const std::array<double, 3> expected_controls = {4.0 * std::pow(10.0, -6.0 / 20.0),
                                                   std::pow(10.0, -4.0 / 20.0), 0.37};
  check(harness.concrete().controlTargetsForTesting() == expected_controls,
        "non-finite recovery retains all applied control targets");
  check(harness.concrete().controlCurrentForTesting() == expected_controls,
        "non-finite recovery reapplies all controls immediately");

  std::vector<float> next = makeSignal(128u, 733u, 0.2F);
  harness.process(next, 128u);
  check(finite(next),
        "the block after non-finite recovery remains in finite aligned-dry safe bypass");

  if (Kernel::simdPathAvailableForTesting()) {
    KernelHarness simd(96000.0F, kMaximumFrames, true);
    simd.stageAndCommit(recovery_params);
    simd.reset();
    std::vector<float> simd_fault = {std::numeric_limits<float>::quiet_NaN(), 0.0F};
    simd.process(simd_fault, 1u);
    check(simd.concrete().controlCurrentForTesting() == expected_controls,
          "f64x2 non-finite recovery reapplies all controls immediately");
    std::vector<float> simd_next = makeSignal(128u, 733u, 0.2F);
    simd.process(simd_next, 128u);
    effetune::RuntimeEventState simd_safety_event{};
    simd.kernel().readRuntimeEvent(simd_safety_event);
    check(simd_safety_event.latched == 1u && simd_safety_event.cause == 2u,
          "f64x2 non-finite recovery latches the processing safety runtime event");
    check(finite(simd_next), "f64x2 non-finite recovery remains in finite aligned-dry safe bypass");
  }
}

void testUnsupportedRatePassThrough() {
  KernelHarness unsupported(32000.0F);
  check(unsupported.kernel().latencySamples() == 0u, "unsupported rate reports zero latency");
  const std::uint64_t state_before = unsupported.concrete().stateDigestForTesting();
  std::vector<float> audio = makeSignal(128u, 701u);
  const std::vector<float> original = audio;
  unsupported.process(audio, 128u);
  check(audio == original, "unsupported rate is a complete pass-through");
  check(unsupported.concrete().stateDigestForTesting() == state_before,
        "unsupported rate does not advance kernel state");
}

void testThreeInstanceIsolation() {
  KernelHarness first;
  KernelHarness second;
  KernelHarness third;
  const Params params = makeParams(-9.0F, 0.0F, -7.0F, 263.0F, 5.0F, 9.0F, 2.0F, 78.0F);
  first.stageAndCommit(params);
  second.stageAndCommit(params);
  third.stageAndCommit(params);
  first.reset();
  second.reset();
  third.reset();
  const std::uint64_t untouched = third.concrete().stateDigestForTesting();
  check(second.concrete().stateDigestForTesting() == untouched,
        "fresh instances begin at the same checkpoint");

  std::vector<float> first_audio = makeSignal(128u, 809u);
  first.process(first_audio, 128u);
  check(second.concrete().stateDigestForTesting() == untouched &&
            third.concrete().stateDigestForTesting() == untouched,
        "processing instance one leaves instances two and three untouched");
  check(first.concrete().stateDigestForTesting() != untouched,
        "processed instance advances independently");

  std::vector<float> second_audio = makeSignal(31u, 977u, 0.3F);
  second.process(second_audio, 31u);
  check(third.concrete().stateDigestForTesting() == untouched,
        "processing instance two leaves instance three untouched");
  check(second.concrete().stateDigestForTesting() != first.concrete().stateDigestForTesting(),
        "instances retain distinct histories");
}

const char *argumentValue(int argc, char **argv, std::string_view name) noexcept {
  for (int index = 1; index + 1 < argc; ++index) {
    if (std::string_view(argv[index]) == name) {
      return argv[index + 1];
    }
  }
  return nullptr;
}

bool parseFloatList(std::string_view source, std::vector<float> &values,
                    std::size_t expected_count) {
  values.clear();
  std::size_t offset = 0u;
  while (offset <= source.size()) {
    const std::size_t separator = source.find(',', offset);
    const std::size_t end = separator == std::string_view::npos ? source.size() : separator;
    const std::string token(source.substr(offset, end - offset));
    char *parse_end = nullptr;
    const float value = std::strtof(token.c_str(), &parse_end);
    if (parse_end == token.c_str() || *parse_end != '\0' || !std::isfinite(value)) {
      return false;
    }
    values.push_back(value);
    if (separator == std::string_view::npos) {
      break;
    }
    offset = separator + 1u;
  }
  return values.size() == expected_count;
}

bool parseFrameList(std::string_view source, std::vector<std::uint32_t> &values) {
  values.clear();
  std::size_t offset = 0u;
  while (offset <= source.size()) {
    const std::size_t separator = source.find(',', offset);
    const std::size_t end = separator == std::string_view::npos ? source.size() : separator;
    const std::string token(source.substr(offset, end - offset));
    char *parse_end = nullptr;
    const unsigned long value = std::strtoul(token.c_str(), &parse_end, 10);
    if (parse_end == token.c_str() || *parse_end != '\0' || value == 0u || value > kMaximumFrames) {
      return false;
    }
    values.push_back(static_cast<std::uint32_t>(value));
    if (separator == std::string_view::npos) {
      break;
    }
    offset = separator + 1u;
  }
  return !values.empty();
}

Params paramsFromValues(const std::vector<float> &values) noexcept {
  if (values.size() == Params::kFloatCount) {
    return {values[0],  values[1],  values[2],  values[3],  values[4],  values[5],  values[6],
            values[7],  values[8],  values[9],  values[10], values[11], values[12], values[13],
            values[14], values[15], values[16], values[17], values[18], values[19]};
  }
  return {values[0], values[1], values[2], values[3], values[4], values[5], values[6],
          values[7], values[8], values[9], 0.0F,      0.0F,      320.0F,    270.0F,
          0.0F,      2.0F,      1.0F,      8.0F,      0.0F,      1.0F};
}

bool parseParameterList(std::string_view source, std::vector<float> &values) {
  return parseFloatList(source, values, Params::kFloatCount) || parseFloatList(source, values, 10u);
}

bool readFloat32File(const std::filesystem::path &path, std::vector<float> &values,
                     std::size_t expected_count) {
  std::ifstream input(path, std::ios::binary | std::ios::ate);
  if (!input || input.tellg() != static_cast<std::streamsize>(expected_count * sizeof(float))) {
    return false;
  }
  input.seekg(0, std::ios::beg);
  values.resize(expected_count);
  input.read(reinterpret_cast<char *>(values.data()),
             static_cast<std::streamsize>(values.size() * sizeof(float)));
  return static_cast<bool>(input);
}

bool writeFloat32File(const std::filesystem::path &path, const std::vector<float> &values) {
  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  output.write(reinterpret_cast<const char *>(values.data()),
               static_cast<std::streamsize>(values.size() * sizeof(float)));
  return static_cast<bool>(output);
}

int describeFir(float sample_rate) {
  KernelHarness harness(sample_rate);
  if (failures != 0) {
    return 1;
  }
  const std::size_t count = harness.concrete().firCoefficientCountForTesting();
  std::printf("{\"sampleRate\":%.0f,\"coefficientBits\":[", sample_rate);
  for (std::size_t index = 0u; index < count; ++index) {
    if (index != 0u) {
      std::fputc(',', stdout);
    }
    const std::uint64_t bits =
        std::bit_cast<std::uint64_t>(harness.concrete().firCoefficientForTesting(index));
    std::printf("\"%016llx\"", static_cast<unsigned long long>(bits));
  }
  std::printf("]}\n");
  return 0;
}

int renderProductCase(int argc, char **argv) {
  const char *sample_rate_text = argumentValue(argc, argv, "--sample-rate");
  const char *frames_text = argumentValue(argc, argv, "--frames");
  const char *simd_text = argumentValue(argc, argv, "--simd");
  const char *input_path = argumentValue(argc, argv, "--input");
  const char *output_path = argumentValue(argc, argv, "--output");
  const char *params_text = argumentValue(argc, argv, "--params");
  const char *event_frame_text = argumentValue(argc, argv, "--event-frame");
  const char *event_params_text = argumentValue(argc, argv, "--event-params");
  const char *event2_frame_text = argumentValue(argc, argv, "--event2-frame");
  const char *event2_params_text = argumentValue(argc, argv, "--event2-params");
  const char *reset_frame_text = argumentValue(argc, argv, "--reset-frame");
  const char *reset2_frame_text = argumentValue(argc, argv, "--reset2-frame");
  const char *observation_frame_text = argumentValue(argc, argv, "--observation-frame");
  const char *chunks_text = argumentValue(argc, argv, "--chunks");
  const char *debug_state_version_text = argumentValue(argc, argv, "--debug-state-version");
  if (sample_rate_text == nullptr || frames_text == nullptr || simd_text == nullptr ||
      input_path == nullptr || output_path == nullptr || params_text == nullptr ||
      event_frame_text == nullptr || event_params_text == nullptr || reset_frame_text == nullptr ||
      reset2_frame_text == nullptr || chunks_text == nullptr) {
    std::fprintf(stderr, "render-product argument is missing\n");
    return 2;
  }

  char *parse_end = nullptr;
  const float sample_rate = std::strtof(sample_rate_text, &parse_end);
  if (parse_end == sample_rate_text || *parse_end != '\0') {
    return 2;
  }
  const unsigned long parsed_frames = std::strtoul(frames_text, &parse_end, 10);
  if (parse_end == frames_text || *parse_end != '\0' || parsed_frames == 0u ||
      parsed_frames > std::numeric_limits<std::uint32_t>::max()) {
    return 2;
  }
  const long event_frame = std::strtol(event_frame_text, &parse_end, 10);
  if (parse_end == event_frame_text || *parse_end != '\0') {
    return 2;
  }
  long event2_frame = -1;
  if (event2_frame_text != nullptr) {
    event2_frame = std::strtol(event2_frame_text, &parse_end, 10);
    if (parse_end == event2_frame_text || *parse_end != '\0') {
      return 2;
    }
  }
  const long reset_frame = std::strtol(reset_frame_text, &parse_end, 10);
  if (parse_end == reset_frame_text || *parse_end != '\0') {
    return 2;
  }
  const long reset2_frame = std::strtol(reset2_frame_text, &parse_end, 10);
  if (parse_end == reset2_frame_text || *parse_end != '\0') {
    return 2;
  }
  long observation_frame = -1;
  if (observation_frame_text != nullptr) {
    observation_frame = std::strtol(observation_frame_text, &parse_end, 10);
    if (parse_end == observation_frame_text || *parse_end != '\0') {
      return 2;
    }
  }
  const bool use_simd = std::string_view(simd_text) == "1";
  if (!use_simd && std::string_view(simd_text) != "0") {
    return 2;
  }
  unsigned long debug_state_version = 1u;
  if (debug_state_version_text != nullptr) {
    debug_state_version = std::strtoul(debug_state_version_text, &parse_end, 10);
    if (parse_end == debug_state_version_text || *parse_end != '\0' ||
        (debug_state_version != 1u && debug_state_version != 2u)) {
      return 2;
    }
  }
  const auto frames = static_cast<std::uint32_t>(parsed_frames);
  if ((event_frame >= 0 && static_cast<unsigned long>(event_frame) >= parsed_frames) ||
      (event2_frame >= 0 && static_cast<unsigned long>(event2_frame) >= parsed_frames) ||
      (reset_frame >= 0 && static_cast<unsigned long>(reset_frame) >= parsed_frames) ||
      (reset2_frame >= 0 && static_cast<unsigned long>(reset2_frame) >= parsed_frames) ||
      (observation_frame >= 0 && static_cast<unsigned long>(observation_frame) >= parsed_frames) ||
      (observation_frame >= 0 && observation_frame != reset_frame) ||
      (event2_frame >= 0 && event_frame < 0) ||
      (event2_frame >= 0 && event2_frame <= event_frame) ||
      (reset2_frame >= 0 && reset_frame < 0) ||
      (reset2_frame >= 0 && reset2_frame <= reset_frame)) {
    return 2;
  }

  std::vector<float> initial_values;
  std::vector<float> event_values;
  std::vector<float> event2_values;
  std::vector<std::uint32_t> chunks;
  if (!parseParameterList(params_text, initial_values) || !parseFrameList(chunks_text, chunks) ||
      (event_frame >= 0 && !parseParameterList(event_params_text, event_values)) ||
      (event2_frame >= 0 &&
       (event2_params_text == nullptr || !parseParameterList(event2_params_text, event2_values)))) {
    return 2;
  }
  if ((event_frame < 0 && std::string_view(event_params_text) != "-") ||
      (event2_frame < 0 && event2_params_text != nullptr &&
       std::string_view(event2_params_text) != "-")) {
    return 2;
  }

  std::vector<float> input;
  if (!readFloat32File(input_path, input, static_cast<std::size_t>(frames) * 2u)) {
    std::fprintf(stderr, "render-product input is invalid\n");
    return 2;
  }

  KernelHarness harness(sample_rate, kMaximumFrames, use_simd);
  const std::uint32_t allocation_violations_before = effetune::allocation_guard::violationCount();
  harness.stageAndCommit(paramsFromValues(initial_values));
  harness.reset();
  const std::uint64_t initial_reset_digest = harness.concrete().stateDigestForTesting();
  std::uint64_t scheduled_reset_digest = 0u;
  std::vector<float> output(input.size(), 0.0F);
  struct BlockObservation {
    std::uint32_t frame;
    std::uint32_t frames;
    std::size_t chunk_index;
  };
  struct LifecycleObservation {
    std::uint32_t frame;
    std::uint32_t faultState;
    double faultWet;
    std::array<std::uint32_t, 3> remaining;
    std::array<std::uint64_t, 2> centralReset;
    std::uint64_t detectionFrame;
    std::uint64_t muteCompleteFrame;
    std::uint64_t trialObservationStartFrame;
    std::array<std::uint32_t, 3> runtimeEvent;
  };
  std::vector<BlockObservation> blocks;
  std::vector<LifecycleObservation> lifecycle;
  std::array<bool, 2> event_observed = {event_frame < 0, event2_frame < 0};
  const std::array<long, 2> reset_frames = {reset_frame, reset2_frame};
  std::array<bool, 2> reset_observed = {reset_frame < 0, reset2_frame < 0};
  std::uint64_t observation_origin = 0u;
  std::uint64_t debug_epoch_frame = 0u;
  auto detector_windows = harness.concrete().detectorWindowTraceForTesting();
  auto transition_boundaries = harness.concrete().transitionBoundaryTraceForTesting();
  detector_windows.clear();
  transition_boundaries.clear();
  std::size_t detector_trace_cursor = 0u;
  std::size_t transition_trace_cursor = 0u;
  bool detector_trace_overflow = false;
  bool transition_trace_overflow = false;
  const auto append_debug_traces = [&]() {
    const auto &current_windows = harness.concrete().detectorWindowTraceForTesting();
    for (; detector_trace_cursor < current_windows.size(); ++detector_trace_cursor) {
      auto observation = current_windows[detector_trace_cursor];
      observation.startFrame = debug_epoch_frame + observation.startFrame - observation_origin;
      observation.endFrame = debug_epoch_frame + observation.endFrame - observation_origin;
      detector_windows.push_back(observation);
    }
    detector_trace_overflow =
        detector_trace_overflow || harness.concrete().detectorWindowTraceOverflowForTesting();
    const auto &current_boundaries = harness.concrete().transitionBoundaryTraceForTesting();
    for (; transition_trace_cursor < current_boundaries.size(); ++transition_trace_cursor) {
      auto observation = current_boundaries[transition_trace_cursor];
      observation.frame = debug_epoch_frame + observation.frame - observation_origin;
      transition_boundaries.push_back(observation);
    }
    transition_trace_overflow =
        transition_trace_overflow || harness.concrete().transitionBoundaryTraceOverflowForTesting();
  };
  std::uint32_t offset = 0u;
  std::size_t partition_index = 0u;
  while (offset < frames) {
    if (!event_observed[0] && offset == static_cast<std::uint32_t>(event_frame)) {
      harness.stageAndCommit(paramsFromValues(event_values));
      event_observed[0] = true;
    }
    if (!event_observed[1] && offset == static_cast<std::uint32_t>(event2_frame)) {
      harness.stageAndCommit(paramsFromValues(event2_values));
      event_observed[1] = true;
    }
    for (std::size_t reset_index = 0u; reset_index < reset_frames.size(); ++reset_index) {
      if (!reset_observed[reset_index] &&
          offset == static_cast<std::uint32_t>(reset_frames[reset_index])) {
        if (observation_frame == reset_frames[reset_index]) {
          observation_origin = harness.concrete().beginFreshObservationForTesting();
          detector_windows.clear();
          transition_boundaries.clear();
          detector_trace_cursor = 0u;
          transition_trace_cursor = 0u;
          detector_trace_overflow = false;
          transition_trace_overflow = false;
          lifecycle.clear();
        } else {
          append_debug_traces();
          harness.reset();
          debug_epoch_frame = offset;
          detector_trace_cursor = 0u;
          transition_trace_cursor = 0u;
        }
        scheduled_reset_digest = harness.concrete().stateDigestForTesting();
        reset_observed[reset_index] = true;
      }
    }
    std::uint32_t block_frames = std::min(chunks[partition_index % chunks.size()], frames - offset);
    for (const long boundary : {event_frame, event2_frame, reset_frame, reset2_frame}) {
      if (boundary > static_cast<long>(offset) &&
          boundary < static_cast<long>(offset + block_frames)) {
        block_frames = static_cast<std::uint32_t>(boundary) - offset;
      }
    }
    std::vector<float> block(static_cast<std::size_t>(block_frames) * 2u);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      const std::size_t source = static_cast<std::size_t>(channel) * frames + offset;
      std::copy_n(input.begin() + static_cast<std::ptrdiff_t>(source), block_frames,
                  block.begin() + static_cast<std::ptrdiff_t>(channel * block_frames));
    }
    harness.process(block, block_frames);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      const std::size_t target = static_cast<std::size_t>(channel) * frames + offset;
      std::copy_n(block.begin() + static_cast<std::ptrdiff_t>(channel * block_frames), block_frames,
                  output.begin() + static_cast<std::ptrdiff_t>(target));
    }
    blocks.push_back({offset, block_frames, partition_index % chunks.size()});
    offset += block_frames;
    if (observation_frame >= 0 && offset < static_cast<std::uint32_t>(observation_frame)) {
      harness.concrete().beginDetectorObservationForTesting();
    }
    const LifecycleObservation lifecycle_observation = {
        offset,
        harness.concrete().faultStateForTesting(),
        harness.concrete().faultWetForTesting(),
        harness.concrete().faultRemainingFramesForTesting(),
        harness.concrete().centralResetStateForTesting(),
        harness.concrete().detectionFrameForTesting(),
        harness.concrete().muteCompleteFrameForTesting(),
        harness.concrete().trialObservationStartFrameForTesting(),
        harness.concrete().runtimeEventForTesting()};
    if (lifecycle.empty() || lifecycle.back().faultState != lifecycle_observation.faultState ||
        lifecycle.back().centralReset != lifecycle_observation.centralReset ||
        lifecycle.back().runtimeEvent != lifecycle_observation.runtimeEvent) {
      lifecycle.push_back(lifecycle_observation);
    }
    ++partition_index;
  }
  append_debug_traces();
  if (!event_observed[0] || !event_observed[1] || !reset_observed[0] || !reset_observed[1] ||
      failures != 0 || !writeFloat32File(output_path, output)) {
    return 1;
  }
  const auto transition = harness.concrete().feedbackTransitionForTesting();
  const auto applied_parameters = harness.concrete().appliedParametersForTesting();
  const auto feedback_calibration = harness.concrete().activeFeedbackCalibrationForTesting();
  const auto runtime_event = harness.concrete().runtimeEventForTesting();
  const auto fault_remaining = harness.concrete().faultRemainingFramesForTesting();
  const auto central_reset = harness.concrete().centralResetStateForTesting();
  const auto left_power_dc = harness.concrete().powerDcStateForTesting(0);
  const auto right_power_dc = harness.concrete().powerDcStateForTesting(1);
  const auto left_power_window = harness.concrete().powerWindowStateForTesting(0);
  const auto right_power_window = harness.concrete().powerWindowStateForTesting(1);
  const auto left_power_output = harness.concrete().powerOutputStateForTesting(0);
  const auto right_power_output = harness.concrete().powerOutputStateForTesting(1);
  const auto power_profile = harness.concrete().powerProfileForTesting();
  const auto telemetry = harness.concrete().telemetryPayloadForTesting();
  const auto print_double_array = [](const auto &values) {
    for (std::size_t index = 0u; index < values.size(); ++index) {
      std::printf("%s%.17g", index == 0u ? "" : ",", static_cast<double>(values[index]));
    }
  };
  std::printf("{\"blocks\":[");
  for (std::size_t index = 0u; index < blocks.size(); ++index) {
    if (index != 0u) {
      std::fputc(',', stdout);
    }
    std::printf("{\"frame\":%u,\"frames\":%u,\"chunkIndex\":%zu}", blocks[index].frame,
                blocks[index].frames, blocks[index].chunk_index);
  }
  std::printf("],\"events\":[");
  if (event_frame >= 0) {
    std::printf("{\"frame\":%ld,\"eventIndex\":0}", event_frame);
  }
  if (event2_frame >= 0) {
    std::printf(",{\"frame\":%ld,\"eventIndex\":1}", event2_frame);
  }
  std::printf("],\"resets\":[");
  if (reset_frame >= 0) {
    std::printf("{\"frame\":%ld,\"resetIndex\":0}", reset_frame);
  }
  if (reset2_frame >= 0) {
    std::printf(",{\"frame\":%ld,\"resetIndex\":1}", reset2_frame);
  }
  std::printf("],\"state\":{\"observationOriginFrame\":%llu,"
              "\"detectorObservationIsolated\":%s,"
              "\"initialResetDigest\":\"%016llx\","
              "\"scheduledResetDigest\":",
              static_cast<unsigned long long>(observation_origin),
              observation_frame >= 0 ? "true" : "false",
              static_cast<unsigned long long>(initial_reset_digest));
  if (reset_frame >= 0) {
    std::printf("\"%016llx\"", static_cast<unsigned long long>(scheduled_reset_digest));
  } else {
    std::printf("null");
  }
  std::printf(",\"finalDigest\":\"%016llx\",\"transition\":[",
              static_cast<unsigned long long>(harness.concrete().stateDigestForTesting()));
  for (std::size_t index = 0u; index < transition.size(); ++index) {
    std::printf("%s%llu", index == 0u ? "" : ",",
                static_cast<unsigned long long>(transition[index]));
  }
  std::printf("],\"appliedParameters\":[");
  const std::size_t applied_parameter_count = debug_state_version == 2u ? 17u : 10u;
  for (std::size_t index = 0u; index < applied_parameter_count; ++index) {
    std::printf("%s%.17g", index == 0u ? "" : ",", applied_parameters[index]);
  }
  std::printf("],\"feedbackCalibration\":[");
  for (std::size_t index = 0u; index < feedback_calibration.size(); ++index) {
    std::printf("%s%.17g", index == 0u ? "" : ",", feedback_calibration[index]);
  }
  std::printf("],\"runtimeEvent\":[%u,%u,%u],\"fault\":{\"faultState\":%u,"
              "\"faultWet\":%.17g,\"remaining\":[%u,%u,%u],\"centralReset\":[%llu,%llu],"
              "\"detectionFrame\":",
              runtime_event[0], runtime_event[1], runtime_event[2],
              harness.concrete().faultStateForTesting(), harness.concrete().faultWetForTesting(),
              fault_remaining[0], fault_remaining[1], fault_remaining[2],
              static_cast<unsigned long long>(central_reset[0]),
              static_cast<unsigned long long>(central_reset[1]));
  const auto relative_debug_frame = [debug_epoch_frame, observation_origin](std::uint64_t frame) {
    return debug_epoch_frame + frame - observation_origin;
  };
  const auto print_optional_frame = [&relative_debug_frame](std::uint64_t frame) {
    if (frame == std::numeric_limits<std::uint64_t>::max()) {
      std::printf("null");
    } else {
      std::printf("%llu", static_cast<unsigned long long>(relative_debug_frame(frame)));
    }
  };
  print_optional_frame(harness.concrete().detectionFrameForTesting());
  std::printf(",\"muteCompleteFrame\":");
  print_optional_frame(harness.concrete().muteCompleteFrameForTesting());
  std::printf(",\"trialObservationStartFrame\":");
  print_optional_frame(harness.concrete().trialObservationStartFrameForTesting());
  std::printf(",\"runtimeEvent\":[%u,%u,%u]},\"detectorTraceOverflow\":%s,"
              "\"detectorWindows\":[",
              runtime_event[0], runtime_event[1], runtime_event[2],
              detector_trace_overflow ? "true" : "false");
  for (std::size_t index = 0u; index < detector_windows.size(); ++index) {
    if (index != 0u) {
      std::fputc(',', stdout);
    }
    const auto &window = detector_windows[index];
    std::printf("{\"index\":%zu,\"startFrame\":%llu,\"endFrame\":%llu,"
                "\"predicateBits\":%u,\"growthCount\":%u,\"sustainedCount\":%u,"
                "\"selectedBranch\":%u,\"runtimeEvent\":[%u,%u,%u],\"faultState\":%u,"
                "\"previousRms\":[%.17g,%.17g,%.17g],\"rms\":[%.17g,%.17g,%.17g]}",
                index, static_cast<unsigned long long>(window.startFrame),
                static_cast<unsigned long long>(window.endFrame), window.predicateBits,
                window.growthCount, window.sustainedCount, window.selectedBranch,
                window.runtimeEvent.generation, window.runtimeEvent.latched,
                window.runtimeEvent.cause, window.faultState, window.previousInputRms,
                window.previousOutputRms, window.previousFeedbackRms, window.inputRms,
                window.outputRms, window.feedbackRms);
  }
  std::printf("],\"lifecycle\":[");
  for (std::size_t index = 0u; index < lifecycle.size(); ++index) {
    if (index != 0u) {
      std::fputc(',', stdout);
    }
    const auto &observation = lifecycle[index];
    std::printf("{\"frame\":%u,\"faultState\":%u,\"faultWet\":%.17g,"
                "\"remaining\":[%u,%u,%u],\"centralReset\":[%llu,%llu],"
                "\"detectionFrame\":",
                observation.frame - static_cast<std::uint32_t>(observation_origin),
                observation.faultState, observation.faultWet, observation.remaining[0],
                observation.remaining[1], observation.remaining[2],
                static_cast<unsigned long long>(observation.centralReset[0]),
                static_cast<unsigned long long>(observation.centralReset[1]));
    print_optional_frame(observation.detectionFrame);
    std::printf(",\"muteCompleteFrame\":");
    print_optional_frame(observation.muteCompleteFrame);
    std::printf(",\"trialObservationStartFrame\":");
    print_optional_frame(observation.trialObservationStartFrame);
    std::printf(",\"runtimeEvent\":[%u,%u,%u]}", observation.runtimeEvent[0],
                observation.runtimeEvent[1], observation.runtimeEvent[2]);
  }
  std::printf("],\"transitionTraceOverflow\":%s,\"transitionBoundaries\":[",
              transition_trace_overflow ? "true" : "false");
  for (std::size_t index = 0u; index < transition_boundaries.size(); ++index) {
    if (index != 0u) {
      std::fputc(',', stdout);
    }
    const auto &boundary = transition_boundaries[index];
    std::printf("{\"index\":%zu,\"frame\":%llu,\"transition\":[", index,
                static_cast<unsigned long long>(boundary.frame));
    for (std::size_t value_index = 0u; value_index < boundary.transition.size(); ++value_index) {
      std::printf("%s%llu", value_index == 0u ? "" : ",",
                  static_cast<unsigned long long>(boundary.transition[value_index]));
    }
    std::printf("],\"appliedParameters\":[");
    for (std::size_t value_index = 0u; value_index < applied_parameter_count; ++value_index) {
      std::printf("%s%.17g", value_index == 0u ? "" : ",", boundary.appliedParameters[value_index]);
    }
    std::printf("],\"feedbackCalibration\":[");
    for (std::size_t value_index = 0u; value_index < boundary.feedbackCalibration.size();
         ++value_index) {
      std::printf("%s%.17g", value_index == 0u ? "" : ",",
                  boundary.feedbackCalibration[value_index]);
    }
    std::printf("],\"centralReset\":[%llu,%llu]}",
                static_cast<unsigned long long>(boundary.centralReset[0]),
                static_cast<unsigned long long>(boundary.centralReset[1]));
  }
  std::printf("],\"productObservation\":{\"powerDc\":[[");
  print_double_array(left_power_dc);
  std::printf("],[");
  print_double_array(right_power_dc);
  std::printf("]],\"powerWindow\":[[");
  print_double_array(left_power_window);
  std::printf("],[");
  print_double_array(right_power_window);
  std::printf("]],\"powerOutput\":[[");
  print_double_array(left_power_output);
  std::printf("],[");
  print_double_array(right_power_output);
  std::printf("]],\"powerProfile\":[");
  print_double_array(power_profile);
  std::printf("],\"telemetry\":[");
  print_double_array(telemetry);
  std::printf("],\"lifetime\":{\"runtimeFinite\":%s,\"solverConverged\":%s,"
              "\"processAllocationViolations\":%u,\"slowPublishCount\":%llu,"
              "\"finiteFaults\":%llu,\"safetyLimits\":%llu,\"maximumKclResidualA\":%.17g,"
              "\"maximumFastKclResidualA\":%.17g,\"maximumDcResidualA\":%.17g,"
              "\"maximumEnergyResidualW\":%.17g}}}}\n",
              harness.concrete().runtimeFiniteForTesting() ? "true" : "false",
              harness.concrete().solverConvergedForTesting() ? "true" : "false",
              effetune::allocation_guard::violationCount() - allocation_violations_before,
              static_cast<unsigned long long>(harness.concrete().slowPublishCountForTesting()),
              static_cast<unsigned long long>(harness.concrete().finiteFaultsForTesting()),
              static_cast<unsigned long long>(harness.concrete().safetyLimitsForTesting()),
              harness.concrete().maximumKclResidualForTesting(),
              harness.concrete().maximumFastKclResidualForTesting(),
              harness.concrete().maximumDcResidualForTesting(),
              harness.concrete().maximumEnergyResidualForTesting());
  return 0;
}

const char *fastKclNodeName(std::uint64_t code) noexcept {
  switch (code) {
  case 1u:
    return "stage1.grid";
  case 2u:
    return "stage1.coupling";
  case 3u:
    return "stage1.miller";
  case 4u:
    return "stage1.plate";
  case 5u:
    return "stage2.grid";
  case 6u:
    return "stage2.coupling";
  case 7u:
    return "stage2.miller";
  case 8u:
    return "stage2.plate";
  case 9u:
    return "output";
  case 0u:
    return "none";
  }
  return "unknown";
}

struct FastKclObservation final {
  double residual;
  std::array<std::uint64_t, 5> location;
  std::array<std::uint64_t, 65> gridFallbackIterationHistogram;
};

FastKclObservation collectFastKclObservation(bool use_simd) {
  constexpr std::uint32_t total_frames = 2048u;
  constexpr std::uint32_t block_frames = 128u;
  KernelHarness harness(96000.0F, block_frames, use_simd);
  harness.stageAndCommit(
      makeParams(0.0F, 1.0F, 0.0F, 250.0F, 10.0F, 10.0F, 0.0F, 100.0F, 1.0F, 0.0F));
  harness.reset();
  for (std::uint32_t offset = 0u; offset < total_frames; offset += block_frames) {
    std::vector<float> audio(static_cast<std::size_t>(block_frames) * 2u);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t frame = 0u; frame < block_frames; ++frame) {
        const std::uint32_t global_frame = offset + frame;
        const int code = static_cast<int>(((global_frame + channel * 19u) * 37u) % 257u) - 128;
        audio[static_cast<std::size_t>(channel) * block_frames + frame] =
            static_cast<float>(code) / 8192.0F;
      }
    }
    harness.process(audio, block_frames);
  }
  return {harness.concrete().maximumFastKclResidualForTesting(),
          harness.concrete().maximumFastKclLocationForTesting(),
          harness.concrete().gridFallbackIterationHistogramForTesting()};
}

void testFastKclScalarSimdDiagnostic() {
  if (!Kernel::simdPathAvailableForTesting()) {
    return;
  }
  constexpr double maximum_fast_kcl_residual = 1e-9;
  const FastKclObservation scalar = collectFastKclObservation(false);
  const FastKclObservation simd = collectFastKclObservation(true);
  const double comparison_tolerance =
      std::max(1e-15, std::max(scalar.residual, simd.residual) * 1e-6);
  check(scalar.residual <= maximum_fast_kcl_residual,
        "fast KCL scalar diagnostic meets the 1e-9 A gate");
  check(simd.residual <= maximum_fast_kcl_residual,
        "fast KCL SIMD diagnostic meets the 1e-9 A gate");
  check(scalar.location == simd.location,
        "fast KCL scalar and SIMD diagnostics identify the same node and frame");
  check(std::abs(scalar.residual - simd.residual) <= comparison_tolerance,
        "fast KCL scalar and SIMD diagnostics report the same residual");
  check(scalar.gridFallbackIterationHistogram == simd.gridFallbackIterationHistogram,
        "fast KCL scalar and SIMD diagnostics report the same grid fallback histogram");
}

void testPhaseCPowerTopologyAndStateRules() {
  using namespace effetune::dsp::tube_simulator_phase_c_generated;
  check(kPowerProfiles.size() == 18u, "Phase C exposes all 18 power profiles");
  check(kSpeakerProfiles.size() == 4u, "Phase C exposes all four speaker profiles");
  check(kPowerFeedbackRecords.size() == 432u, "Phase C exposes all 432 power feedback records");

  for (int power_tube = 0; power_tube < 2; ++power_tube) {
    for (int screen_tap = 0; screen_tap < 3; ++screen_tap) {
      for (int primary = 0; primary < 3; ++primary) {
        KernelHarness harness;
        harness.stageAndCommit(makeParams(-30.0F, 2.0F, 0.0F, 250.0F, 10.0F, 10.0F, 9.0F, 100.0F,
                                          2.828F, 30.0F, 1.0F, static_cast<float>(power_tube),
                                          320.0F, 270.0F, static_cast<float>(screen_tap),
                                          static_cast<float>(primary), 1.0F));
        const auto selected = harness.concrete().powerProfileForTesting();
        const double expected = static_cast<double>(power_tube * 9 + screen_tap * 3 + primary);
        check(selected[0] == expected, "Phase C selects the canonical power profile row");
        check(harness.concrete().topologyIdForTesting() == 1u,
              "Power mode publishes the Power topology id");
      }
    }
  }

  KernelHarness harness;
  const Params el34 =
      makeParams(-30.0F, 2.0F, 0.0F, 250.0F, 10.0F, 10.0F, 9.0F, 100.0F, 2.828F, 30.0F, 1.0F, 1.0F,
                 static_cast<float>(kEl34NormativeDc.supplyGroundV), 470.0F, 2.0F, 1.0F, 1.0F);
  harness.stageAndCommit(el34);
  // The reset seed writes the datasheet currents into the valves and the reservoir voltage those
  // currents produce onto the reservoir node: the supply parameter less the Thevenin drop of both
  // valves' cathode current. Seeding the unloaded rail instead put the whole branch a drop above
  // equilibrium and cut both output valves off while the grid networks relaxed.
  const auto dc = harness.concrete().powerDcStateForTesting(0);
  const PowerProfile &seed_profile = kPowerProfiles[16];
  const double seed_reservoir =
      kEl34NormativeDc.supplyGroundV -
      2.0 * (kEl34NormativeDc.datasheetIaA + kEl34NormativeDc.datasheetIg2A) *
          seed_profile.powerTheveninResistanceOhm;
  check(std::abs(dc[0] - seed_reservoir) <= 1.0e-4,
        "EL34 canonical reset seed starts the reservoir at its loaded voltage");
  check(dc[7] == kEl34NormativeDc.datasheetIaA && dc[8] == kEl34NormativeDc.datasheetIg2A,
        "EL34 canonical reset seed carries the published zero-signal currents");
  // The oracle proper is the settled state of the running branch, taken on its own harness with
  // the global loop open so the measurement is a pure DC observation. Both valves' cathode current
  // crosses the reservoir Thevenin resistance, so the centre tap lands one such drop below the
  // supply parameter and the anode lands on the normative 430 V of the Mullard Issue 2
  // distributed-load row.
  {
    KernelHarness quiescent;
    Params open_loop = el34;
    open_loop.negativeFeedback = 0.0F;
    quiescent.stageAndCommit(open_loop);
    settlePowerQuiescentState(quiescent, 96000u);
    const auto settled = quiescent.concrete().powerDcStateForTesting(0);
    check(std::abs(settled[0] - kEl34NormativeDc.centerTapGroundV) <= 5.0e-3,
          "EL34 canonical B+ settles on the centre tap of the frozen design");
    check(std::abs(settled[1] - kEl34NormativeDc.plateGroundV) <= 5.0e-3,
          "EL34 canonical anode settles on the normative plate voltage");
    check(std::abs(settled[4] - kEl34NormativeDc.screenGroundV) <= 5.0e-3,
          "EL34 canonical screen settles on the frozen design");
    check(std::abs(settled[5] - kEl34NormativeDc.cathodeGroundV) <= 5.0e-3,
          "EL34 canonical cathode settles on the frozen design");
    check(std::abs(settled[7] - kEl34NormativeDc.iaA) <= 1.0e-6 &&
              std::abs(settled[8] - kEl34NormativeDc.ig2A) <= 1.0e-6,
          "EL34 canonical quiescent currents settle on the frozen design");
    check(std::abs(settled[7] - kEl34NormativeDc.datasheetIaA) <=
                  0.01 * kEl34NormativeDc.datasheetIaA &&
              std::abs(settled[8] - kEl34NormativeDc.datasheetIg2A) <=
                  0.01 * kEl34NormativeDc.datasheetIg2A,
          "EL34 settled currents reproduce the published zero-signal row within one per cent");
    check((settled[1] - settled[5]) * settled[7] <=
              kEl34NormativeDc.maximumQuiescentPlateDissipationW,
          "EL34 quiescent plate dissipation stays inside the published rating");
  }

  // The normative DC point has to be a point on the valve tables, not only the seed the reset
  // writes. The earlier surrogate tables answered 21.6 mA where Mullard Issue 2 lists 62.5 mA, so
  // the operating point drifted away as soon as the branch ran. The same tables must also cut off:
  // below the composite control voltage the plate current is exactly zero, at every plate and
  // screen voltage, which is what makes a large signal clip on the valve instead of on a table end.
  for (int power_tube = 0; power_tube < 2; ++power_tube) {
    const OutputTubeModel &model = kOutputTubeModels[static_cast<std::size_t>(power_tube)];
    check(model.inverseScreenAmplificationFactor > 0.0 &&
              model.inversePlateAmplificationFactor > 0.0,
          "Output-tube composite control voltage carries both amplification factors");
    const auto &control_axis = power_tube == 0 ? kEl84ControlVoltageAxis : kEl34ControlVoltageAxis;
    const auto &lut = power_tube == 0 ? kEl84LutBits : kEl34LutBits;
    check(control_axis[0] == 0.0, "Output-tube control-voltage axis starts on the cut-off plane");
    bool cut_off_row_is_zero = true;
    for (std::size_t index = 0u;
         index < kEl84PlateCathodeAxis.size() * kEl84ScreenCathodeAxis.size() * 2u; ++index) {
      cut_off_row_is_zero = cut_off_row_is_zero && lut[index] == 0u;
    }
    check(cut_off_row_is_zero,
          "Output-tube table carries no current at or below the cut-off plane");
  }
  {
    const auto observed = harness.concrete().powerTubeCurrentForTesting(
        kEl34NormativeDc.plateCathodeV, kEl34NormativeDc.screenCathodeV,
        -kEl34NormativeDc.cathodeGroundV);
    // One per cent covers the trilinear discretisation of the continuous model, which is exact at
    // this point; the frozen surrogate answered a third of the published current here.
    check(std::abs(observed[0] - kEl34NormativeDc.datasheetIaA) <=
                  0.01 * kEl34NormativeDc.datasheetIaA &&
              std::abs(observed[1] - kEl34NormativeDc.datasheetIg2A) <=
                  0.01 * kEl34NormativeDc.datasheetIg2A,
          "EL34 valve table reproduces the Mullard Issue 2 zero-signal currents");
    const auto cut_off = harness.concrete().powerTubeCurrentForTesting(
        kEl34NormativeDc.plateCathodeV, kEl34NormativeDc.screenCathodeV, -140.0);
    check(cut_off[0] == 0.0 && cut_off[1] == 0.0,
          "EL34 valve table cuts off completely at a deeply negative grid");
  }

  // The phase inverter is a 12AX7 long-tailed pair whose tail returns to a negative supply. Both
  // grids sit at their DC return, so the two plates must land on the same quiescent voltage, the
  // cathode must sit a volt or two above ground, and each coupling capacitor must rest at the
  // difference between the node it feeds from and the node it feeds.
  const auto ltp = harness.concrete().powerLtpStateForTesting(0);
  const auto &el34_profile = kPowerProfiles[16];
  check(ltp[1] == ltp[2], "LTP plates share one quiescent voltage with both grids at DC return");
  check(ltp[0] > 0.5 && ltp[0] < 6.0, "LTP cathode sits at a plausible 12AX7 quiescent bias");
  check(ltp[3] == 0.0, "LTP driven grid rests at its DC return");
  check(ltp[4] == 0.0, "LTP input coupling capacitor rests at the driver output DC of zero");
  check(ltp[5] == ltp[1] && ltp[6] == ltp[1],
        "output-tube coupling capacitors rest at the LTP plate voltage");
  const double ltp_plate_current = (seed_reservoir - ltp[1]) / el34_profile.ltpPlateResistanceOhm;
  check(ltp_plate_current > 0.0005 && ltp_plate_current < 0.002,
        "each LTP triode idles near one milliampere");
  const double tail_current =
      (ltp[0] - el34_profile.ltpTailSupplyV) / el34_profile.ltpTailResistanceOhm;
  check(std::abs(tail_current - 2.0 * ltp_plate_current) <= 1.0e-9,
        "LTP tail current equals the sum of both plate currents");

  // A0 is the magnitude of the measured Power detector seen through the ladder knot the setting
  // selects, so the expectation is rebuilt from the record the key selects rather than read off a
  // constant. The harness runs at 30 dB with the 8 ohm speaker.
  const PowerFeedbackRecord *expected_record = nullptr;
  for (const PowerFeedbackRecord &record : kPowerFeedbackRecords) {
    if (record.driverTube == 2u && record.powerTube == 1u && record.screenTap == 2u &&
        record.primary == 1u && record.speakerLoad == 1u && record.family == 1u) {
      expected_record = &record;
      break;
    }
  }
  check(expected_record != nullptr, "Phase C carries the Power feedback record of the EL34 key");
  const double expected_q = std::pow(10.0, 30.0 / 20.0) - 1.0;
  const double expected_v = std::log1p(expected_q) / 3.4538776394910684;
  const double expected_b0 = 1.0 + expected_v * (expected_record->anchorB0 - 1.0);
  const double expected_b1 = expected_v * expected_record->anchorB1;
  const double expected_a1 = expected_v * expected_record->anchorA1;
  const double expected_a2 = expected_v * expected_record->anchorA2;
  const double expected_angle = 2.0 * 3.14159265358979323846264338327950288 * 1000.0 / 384000.0;
  const double expected_z1_real = std::cos(expected_angle);
  const double expected_z1_imaginary = -std::sin(expected_angle);
  const double expected_z2_real = std::cos(2.0 * expected_angle);
  const double expected_z2_imaginary = -std::sin(2.0 * expected_angle);
  const double expected_numerator_real = expected_b0 + expected_b1 * expected_z1_real;
  const double expected_numerator_imaginary = expected_b1 * expected_z1_imaginary;
  const double expected_denominator_real =
      1.0 + expected_a1 * expected_z1_real + expected_a2 * expected_z2_real;
  const double expected_denominator_imaginary =
      expected_a1 * expected_z1_imaginary + expected_a2 * expected_z2_imaginary;
  const double expected_denominator_magnitude_squared =
      expected_denominator_real * expected_denominator_real +
      expected_denominator_imaginary * expected_denominator_imaginary;
  const double expected_response_real =
      (expected_numerator_real * expected_denominator_real +
       expected_numerator_imaginary * expected_denominator_imaginary) /
      expected_denominator_magnitude_squared;
  const double expected_response_imaginary =
      (expected_numerator_imaginary * expected_denominator_real -
       expected_numerator_real * expected_denominator_imaginary) /
      expected_denominator_magnitude_squared;
  const double expected_a0 =
      std::hypot(expected_record->detectorReal * expected_response_real -
                     expected_record->detectorImaginary * expected_response_imaginary,
                 expected_record->detectorReal * expected_response_imaginary +
                     expected_record->detectorImaginary * expected_response_real);
  check(harness.concrete().activeFeedbackCalibrationForTesting()[6] == expected_a0,
        "Power feedback calibration selects the measured Power ladder knot");

  std::vector<float> audio = makeSignal(64u, 0u, 0.02F);
  harness.process(audio, 64u);
  check(harness.concrete().runtimeFiniteForTesting(), "Power runtime state remains finite");
  const auto before = harness.concrete().powerWindowStateForTesting(0);
  check(before[4] > 0.0, "Power 100 ms aggregation retains its partial window");
  const auto resets_before = harness.concrete().centralResetStateForTesting();
  Params non_reset = el34;
  non_reset.powerBPlus = 440.0F;
  non_reset.cathodeResistor = 500.0F;
  non_reset.primaryImpedance = 2.0F;
  non_reset.speakerLoad = 3.0F;
  harness.stageAndCommit(non_reset);
  check(harness.concrete().powerWindowStateForTesting(0) == before,
        "pb/kr/zp/sl preserve the partial Power aggregation window");
  check(harness.concrete().centralResetStateForTesting() == resets_before,
        "pb/kr/zp/sl do not dispatch a central reset");
  check(harness.concrete().feedbackTransitionForTesting()[0] == 0u,
        "pb/kr/zp/sl do not begin the reset transition");

  harness.reset();
  const auto reset_window = harness.concrete().powerWindowStateForTesting(0);
  check(reset_window[0] == 0.0 && reset_window[1] == 0.0 && reset_window[4] == 0.0 &&
            reset_window[5] == 0.0,
        "explicit reset clears every Power aggregation and cadence state");

  KernelHarness structural;
  structural.stageAndCommit(el34);
  Params changed_tap = el34;
  changed_tap.screenTap = 1.0F;
  structural.stageAndCommit(changed_tap);
  check(structural.concrete().feedbackTransitionForTesting()[0] != 0u,
        "st begins the reset-class transition");

  KernelHarness line;
  line.stageAndCommit(makeParams());
  const auto &line_telemetry = line.concrete().telemetryPayloadForTesting();
  bool line_power_fields_zero = true;
  for (std::size_t channel = 0u; channel < 2u; ++channel) {
    for (std::size_t field = 9u; field < 20u; ++field) {
      line_power_fields_zero =
          line_power_fields_zero && line_telemetry[channel * 20u + field] == 0.0F;
    }
  }
  check(line_power_fields_zero, "Line telemetry keeps all 11 Power fields zero");
}

void testEl34PhysicalObservation() {
  using namespace effetune::dsp::tube_simulator_phase_c_generated;
  const El34PhysicalObservation observation = collectEl34PhysicalObservation();
  const double expected_turns_ratio = std::sqrt(6600.0 / 8.0);
  check(observation.powerProfile[0] == 16.0 && observation.powerProfile[1] == 1.0 &&
            observation.powerProfile[2] == 6600.0 &&
            std::abs(observation.powerProfile[3] - expected_turns_ratio) <= 1.0e-10,
        "EL34 physical probe selects the frozen OPT and 8 ohm profile");
  // The probe reads the settled running branch, so the expectation is the frozen DC oracle of the
  // design, not the reset seed recomputed here from the very constants the reset assignment uses -
  // an identity that could only ever have failed if that one assignment's arithmetic broke. The
  // seed itself is asserted once, in testPhaseCPowerTopologyAndStateRules.
  const PowerProfile &el34_profile = kPowerProfiles[16];
  const double settled_plate = kEl34NormativeDc.plateGroundV;
  const double settled_screen = kEl34NormativeDc.screenGroundV;
  const double settled_cathode = kEl34NormativeDc.cathodeGroundV;
  // The screen tap is the one node the oracle does not carry explicitly; it is the centre tap less
  // the IR drop of the section both currents cross, which is the design's own definition of it.
  const double settled_screen_tap =
      kEl34NormativeDc.centerTapGroundV -
      (kEl34NormativeDc.iaA + kEl34NormativeDc.ig2A) * el34_profile.primaryCenterToTapResistanceOhm;
  for (std::size_t channel = 0u; channel < observation.powerDc.size(); ++channel) {
    const auto &dc = observation.powerDc[channel];
    check(std::abs(dc[0] - kEl34NormativeDc.centerTapGroundV) <= 5.0e-3 &&
              std::abs(dc[1] - settled_plate) <= 5.0e-3 &&
              std::abs(dc[2] - settled_plate) <= 5.0e-3 &&
              std::abs(dc[3] - settled_screen_tap) <= 5.0e-3 &&
              std::abs(dc[4] - settled_screen) <= 5.0e-3 &&
              std::abs(dc[5] - settled_cathode) <= 5.0e-3 &&
              std::abs(dc[6] - settled_cathode) <= 5.0e-3 &&
              std::abs(dc[7] - kEl34NormativeDc.iaA) <= 1.0e-6 &&
              std::abs(dc[8] - kEl34NormativeDc.ig2A) <= 1.0e-6,
          "EL34 physical probe observes the frozen quiescent circuit");
    const auto &window = observation.powerWindow[channel];
    check(std::abs(window[2] - 7.0710678118654755) <= 0.05 && std::abs(window[3] - 6.25) <= 0.05,
          "EL34 physical probe measures the 8 ohm 10 Vpk dummy load");
    const std::size_t offset = channel * 20u;
    const double plate_cathode = settled_plate - settled_cathode;
    const double screen_cathode = settled_screen - settled_cathode;
    check(std::abs(observation.telemetry[offset + 10u] - plate_cathode) <= 0.05 &&
              std::abs(observation.telemetry[offset + 11u] - plate_cathode) <= 0.05 &&
              std::abs(observation.telemetry[offset + 12u] - kEl34NormativeDc.iaA) <= 1.0e-4 &&
              std::abs(observation.telemetry[offset + 13u] - kEl34NormativeDc.iaA) <= 1.0e-4 &&
              std::abs(observation.telemetry[offset + 14u] - kEl34NormativeDc.centerTapGroundV) <=
                  0.05 &&
              std::abs(observation.telemetry[offset + 15u] - screen_cathode) <= 0.05 &&
              std::abs(observation.telemetry[offset + 16u] - screen_cathode) <= 0.05 &&
              std::abs(observation.telemetry[offset + 18u] - 7.0710678118654755) <= 0.05 &&
              std::abs(observation.telemetry[offset + 19u] - 6.25) <= 0.05,
          "EL34 physical probe publishes the frozen telemetry v2 fields");
  }
}

void printEl34PhysicalObservation(const El34PhysicalObservation &observation) {
  std::printf("{\"contract\":\"tube-phase-c-el34-product-physical-observation-v1\","
              "\"sampleRate\":96000,\"internalRate\":384000,\"frequencyHz\":1000,"
              "\"secondaryPeakV\":10,\"dummyLoadOhm\":8,\"powerDc\":[[");
  printNumericArray(observation.powerDc[0]);
  std::printf("],[");
  printNumericArray(observation.powerDc[1]);
  std::printf("]],\"powerProfile\":[");
  printNumericArray(observation.powerProfile);
  std::printf("],\"powerWindow\":[[");
  printNumericArray(observation.powerWindow[0]);
  std::printf("],[");
  printNumericArray(observation.powerWindow[1]);
  std::printf("]],\"telemetry\":[");
  printNumericArray(observation.telemetry);
  std::printf("]}");
}

int runFastKclDiagnostic(bool use_simd) {
  if (use_simd && !Kernel::simdPathAvailableForTesting()) {
    std::fprintf(stderr, "SIMD path is unavailable in this native build\n");
    return 2;
  }
  const FastKclObservation observation = collectFastKclObservation(use_simd);
  std::printf("{\"implementation\":\"%s\",\"residualA\":%.17g,\"node\":\"%s\",\"channel\":%llu,"
              "\"hostFrame\":%llu,\"internalFrame\":%llu,\"internalPhase\":%llu,"
              "\"gridFallbackIterationHistogram\":[",
              use_simd ? "cpp-simd" : "cpp-scalar", observation.residual,
              fastKclNodeName(observation.location[0]),
              static_cast<unsigned long long>(observation.location[1]),
              static_cast<unsigned long long>(observation.location[2]),
              static_cast<unsigned long long>(observation.location[3]),
              static_cast<unsigned long long>(observation.location[4]));
  for (std::size_t index = 0; index < observation.gridFallbackIterationHistogram.size(); ++index) {
    std::printf("%s%llu", index == 0u ? "" : ",",
                static_cast<unsigned long long>(observation.gridFallbackIterationHistogram[index]));
  }
  std::printf("]}\n");
  return failures == 0 ? 0 : 1;
}

} // namespace

int main(int argc, char **argv) {
  if (argc == 2 && std::string_view(argv[1]) == "--describe") {
    const El34PhysicalObservation physical_observation = collectEl34PhysicalObservation();
    if (failures != 0) {
      return 1;
    }
    std::printf("{\"protocol\":\"tube-native-test-build-v1\","
                "\"compiledKernelSha256\":\"%s\","
                "\"compiledHarnessSha256\":\"%s\","
                "\"compiledParamsSha256\":\"%s\","
                "\"compiledFirSha256\":\"%s\","
                "\"compiledFeedbackTableSha256\":\"%s\","
                "\"compiledPhaseCTableSha256\":\"%s\","
                "\"buildIdentitySha256\":\"%s\",\"physicalObservation\":",
                ET_TUBE_NATIVE_TEST_KERNEL_SHA256, ET_TUBE_NATIVE_TEST_HARNESS_SHA256,
                ET_TUBE_NATIVE_TEST_PARAMS_SHA256, ET_TUBE_NATIVE_TEST_FIR_SHA256,
                ET_TUBE_NATIVE_TEST_FEEDBACK_TABLE_SHA256, ET_TUBE_NATIVE_TEST_PHASE_C_TABLE_SHA256,
                ET_TUBE_NATIVE_TEST_BUILD_SHA256);
    printEl34PhysicalObservation(physical_observation);
    std::printf("}\n");
    return 0;
  }
  if (argc == 3 && std::string_view(argv[1]) == "--describe-fir") {
    char *parse_end = nullptr;
    const float sample_rate = std::strtof(argv[2], &parse_end);
    if (parse_end == argv[2] || *parse_end != '\0') {
      return 2;
    }
    return describeFir(sample_rate);
  }
  if (argc > 2 && std::string_view(argv[1]) == "--render-product") {
    return renderProductCase(argc, argv);
  }
  if (argc == 2 && std::string_view(argv[1]) == "--fast-kcl-diagnostic") {
    return runFastKclDiagnostic(false);
  }
  if (argc == 3 && std::string_view(argv[1]) == "--fast-kcl-diagnostic" &&
      std::string_view(argv[2]) == "--simd") {
    return runFastKclDiagnostic(true);
  }
  if (argc != 1) {
    std::fprintf(stderr, "unknown argument\n");
    return 2;
  }
  testDescriptorSchemaPrepareAndTelemetryDeferral();
  testCanonicalFeedbackTableAndResetTransition();
  testFeedbackDetectorContract();
  testFeedbackFaultLifecycleAndSafetyPrecedence();
  testDryImpulseAlignment();
  testSupportedRateDryAlignment();
  testPreparedMaximumBeyondFrozenBlock();
  testAllocationGuardIsEffective();
  testInputReferenceScaling();
  testResetReplay();
  testParameterStateRules();
  testFirstParameterCommitResetsNonDefault12AX7();
  testNonAlignedPartitionInvariance();
  testSupportedRatePartitionInvariance();
  testSafetyReductionEngagesAndNeverRecovers();
  testSafetySinglePeakSetsTheReduction();
  testSafetyReductionSurvivesResetAndFaultRecovery();
  testSafetyReductionFreezesWhenDisabled();
  testSafetyReductionResetRule();
  testActualSpeakerLoadScalesTheNetwork();
#if ET_TUBE_HAS_F64X2
  testSafetyReductionScalarSimdParity();
#endif
  testResetDiscardsPartialWindow();
  testMidWindowParameterEvent();
  testScalarSimdParity();
  testFastKclScalarSimdDiagnostic();
  testPhaseCPowerTopologyAndStateRules();
  testEl34PhysicalObservation();
  testSafeguardedPlateFallbackTortureCorner();
  testFiniteSafetyRecovery();
  testUnsupportedRatePassThrough();
  testThreeInstanceIsolation();
  return failures == 0 ? 0 : 1;
}

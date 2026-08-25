#include "PhaseSelectEqPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_PhaseSelectEqPlugin() noexcept;

namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 16384u;
constexpr std::uint16_t kTapPhaseSelectMap = 20u;
using Params = effetune::generated::PhaseSelectEqPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Phase Select EQ check failed: %s\n", message);
    ++failures;
  }
}

std::uint16_t readU16(const std::uint8_t *input) noexcept {
  return static_cast<std::uint16_t>(input[0]) |
         static_cast<std::uint16_t>(static_cast<std::uint16_t>(input[1]) << 8u);
}

std::uint32_t readU32(const std::uint8_t *input) noexcept {
  return static_cast<std::uint32_t>(input[0]) | (static_cast<std::uint32_t>(input[1]) << 8u) |
         (static_cast<std::uint32_t>(input[2]) << 16u) |
         (static_cast<std::uint32_t>(input[3]) << 24u);
}

float readF32(const std::uint8_t *input) noexcept {
  const std::uint32_t bits = readU32(input);
  float value = 0.0F;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate = 48000.0F, std::uint32_t max_channels = 8u,
                         std::uint32_t max_frames = kMaximumFrames) {
    descriptor_ = et_kernel_descriptor_PhaseSelectEqPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr) {
      return;
    }
    check(descriptor_->objectSize <= storage_.size(), "kernel fits fixed test storage");
    check(descriptor_->paramsHash == Params::kHash, "descriptor hash matches");
    check(descriptor_->paramsFloatCount == Params::kFloatCount,
          "descriptor parameter count matches");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      kernel_->prepare({sample_rate, max_channels, max_frames});
      check(kernel_->preparedSuccessfully(), "kernel prepares");
      kernel_->reset();
    }
    telemetry_ring_.adopt(telemetry_storage_.data(),
                          static_cast<std::uint32_t>(telemetry_storage_.size()));
  }

  ~KernelHarness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  void stage(const Params &params) noexcept {
    if (kernel_ == nullptr) {
      return;
    }
    const et_status status =
        kernel_->stageParameters(params.enabled, Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
  }

  void process(std::vector<float> &block, std::uint32_t channels, std::uint32_t frames) noexcept {
    if (kernel_ == nullptr) {
      return;
    }
    check(block.size() == static_cast<std::size_t>(channels) * frames,
          "process block shape matches");
    kernel_->applyPendingParameters();
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->process(block.data(), channels, frames, {0.0});
  }

  std::uint32_t readTelemetry(std::vector<std::uint8_t> &output) noexcept {
    if (kernel_ == nullptr) {
      return 0u;
    }
    effetune::TelemetryWriter writer(telemetry_ring_, telemetry_tap_id_, telemetry_sequence_);
    kernel_->writeTelemetry(writer);
    std::uint32_t dropped = 0u;
    return telemetry_ring_.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
  }

  void reset() noexcept {
    if (kernel_ != nullptr) {
      kernel_->reset();
    }
    telemetry_ring_.reset();
  }

  [[nodiscard]] std::uint32_t latency() const noexcept {
    return kernel_ == nullptr ? 0u : kernel_->latencySamples();
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  std::array<std::uint8_t, 16384u> telemetry_storage_{};
  effetune::TelemetryRing telemetry_ring_;
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
  std::uint32_t telemetry_sequence_ = 0u;
  std::uint32_t telemetry_tap_id_ = 0x50455345u;
};

Params defaultParams() noexcept {
  Params result{};
  for (std::uint32_t region = 0u; region < 5u; ++region) {
    result.enabled[region] = region == 0u ? 1.0F : 0.0F;
    result.outerFrequencyLow[region] = 80.0F;
    result.coreFrequencyLow[region] = 100.0F;
    result.coreFrequencyHigh[region] = 10000.0F;
    result.outerFrequencyHigh[region] = 12000.0F;
    result.outerPhaseLow[region] = 0.0F;
    result.corePhaseLow[region] = 0.0F;
    result.corePhaseHigh[region] = 30.0F;
    result.outerPhaseHigh[region] = 45.0F;
    result.gain[region] = 100.0F;
    result.solo[region] = 0.0F;
    result.outerBalanceLow[region] = -100.0F;
    result.coreBalanceLow[region] = -100.0F;
    result.coreBalanceHigh[region] = 100.0F;
    result.outerBalanceHigh[region] = 100.0F;
  }
  return result;
}

void setBalance(Params &params, std::uint32_t region, float outer_low, float core_low,
                float core_high, float outer_high) noexcept {
  params.outerBalanceLow[region] = outer_low;
  params.coreBalanceLow[region] = core_low;
  params.coreBalanceHigh[region] = core_high;
  params.outerBalanceHigh[region] = outer_high;
}

void setRegion(Params &params, std::uint32_t region, float outer_frequency_low,
               float core_frequency_low, float core_frequency_high, float outer_frequency_high,
               float outer_phase_low, float core_phase_low, float core_phase_high,
               float outer_phase_high, float gain, bool solo = false) noexcept {
  params.enabled[region] = 1.0F;
  params.outerFrequencyLow[region] = outer_frequency_low;
  params.coreFrequencyLow[region] = core_frequency_low;
  params.coreFrequencyHigh[region] = core_frequency_high;
  params.outerFrequencyHigh[region] = outer_frequency_high;
  params.outerPhaseLow[region] = outer_phase_low;
  params.corePhaseLow[region] = core_phase_low;
  params.corePhaseHigh[region] = core_phase_high;
  params.outerPhaseHigh[region] = outer_phase_high;
  params.gain[region] = gain;
  params.solo[region] = solo ? 1.0F : 0.0F;
}

std::vector<float> renderWithBlockPattern(KernelHarness &harness, const Params &params,
                                          const std::vector<float> &input, std::uint32_t channels,
                                          std::uint32_t frames, const std::uint32_t *block_sizes,
                                          std::size_t block_size_count) {
  harness.stage(params);
  std::vector<float> output(input.size(), 0.0F);
  check(block_sizes != nullptr && block_size_count != 0u, "render block pattern exists");
  if (block_sizes == nullptr || block_size_count == 0u) {
    return output;
  }
  std::uint32_t offset = 0u;
  std::size_t block_index = 0u;
  while (offset < frames) {
    const std::uint32_t block_size = block_sizes[block_index % block_size_count];
    check(block_size != 0u, "render block size is positive");
    if (block_size == 0u) {
      return output;
    }
    const std::uint32_t count = std::min(block_size, frames - offset);
    std::vector<float> block(static_cast<std::size_t>(channels) * count);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        block[static_cast<std::size_t>(channel) * count + frame] =
            input[static_cast<std::size_t>(channel) * frames + offset + frame];
      }
    }
    harness.process(block, channels, count);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        output[static_cast<std::size_t>(channel) * frames + offset + frame] =
            block[static_cast<std::size_t>(channel) * count + frame];
      }
    }
    offset += count;
    ++block_index;
  }
  return output;
}

std::vector<float> render(KernelHarness &harness, const Params &params,
                          const std::vector<float> &input, std::uint32_t channels,
                          std::uint32_t frames, std::uint32_t block_size) {
  return renderWithBlockPattern(harness, params, input, channels, frames, &block_size, 1u);
}

std::vector<float> noise(std::uint32_t frames, std::uint32_t channels) {
  std::vector<float> output(static_cast<std::size_t>(frames) * channels);
  std::uint32_t state = 0x1729ac5du;
  for (float &sample : output) {
    state = state * 1664525u + 1013904223u;
    sample = static_cast<float>((static_cast<double>(state) / 4294967296.0 - 0.5) * 0.5);
  }
  return output;
}

std::vector<float> stereoTone(std::uint32_t frames, double sample_rate, double frequency,
                              double right_phase_degrees, std::uint32_t channels = 2u) {
  std::vector<float> output(static_cast<std::size_t>(frames) * channels, 0.0F);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    const double phase = channel == 1u ? right_phase_degrees * kPi / 180.0 : 0.0;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      output[static_cast<std::size_t>(channel) * frames + frame] = static_cast<float>(
          0.2 * std::sin(2.0 * kPi * frequency * static_cast<double>(frame) / sample_rate + phase));
    }
  }
  return output;
}

std::vector<float> balancedTone(std::uint32_t frames, double sample_rate, double frequency,
                                double balance, double right_phase_degrees = 0.0) {
  std::vector<float> output = stereoTone(frames, sample_rate, frequency, right_phase_degrees, 2u);
  const double right_to_left = (100.0 + balance) / (100.0 - balance);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    output[frames + frame] = static_cast<float>(output[frames + frame] * right_to_left);
  }
  return output;
}

bool finite(const std::vector<float> &audio) noexcept {
  return std::all_of(audio.begin(), audio.end(),
                     [](float sample) { return std::isfinite(sample); });
}

double rms(const std::vector<float> &audio, std::uint32_t frames, std::uint32_t channel,
           std::uint32_t start, std::uint32_t count) noexcept {
  double energy = 0.0;
  const std::size_t offset = static_cast<std::size_t>(channel) * frames;
  for (std::uint32_t frame = 0u; frame < count; ++frame) {
    const double sample = static_cast<double>(audio[offset + start + frame]);
    energy += sample * sample;
  }
  return std::sqrt(energy / static_cast<double>(count));
}

struct ComplexProjection {
  double real = 0.0;
  double imaginary = 0.0;
};

ComplexProjection projection(const std::vector<float> &audio, std::uint32_t frames,
                             std::uint32_t channel, double sample_rate, double frequency,
                             std::uint32_t start, std::uint32_t count) noexcept {
  ComplexProjection result;
  const std::size_t offset = static_cast<std::size_t>(channel) * frames;
  for (std::uint32_t frame = 0u; frame < count; ++frame) {
    const std::uint32_t absolute_frame = start + frame;
    const double phase = 2.0 * kPi * frequency * static_cast<double>(absolute_frame) / sample_rate;
    const double sample = static_cast<double>(audio[offset + absolute_frame]);
    result.real += sample * std::cos(phase);
    result.imaginary -= sample * std::sin(phase);
  }
  const double scale = 2.0 / static_cast<double>(count);
  result.real *= scale;
  result.imaginary *= scale;
  return result;
}

double relativePhase(ComplexProjection left, ComplexProjection right) noexcept {
  const double cross_real = left.real * right.real + left.imaginary * right.imaginary;
  const double cross_imaginary = left.imaginary * right.real - left.real * right.imaginary;
  return std::atan2(cross_imaginary, cross_real);
}

double steadyGain(const std::vector<float> &input, const std::vector<float> &output,
                  std::uint32_t frames, std::uint32_t channel = 0u) noexcept {
  constexpr std::uint32_t count = 8192u;
  const std::uint32_t start = frames - count;
  return rms(output, frames, channel, start, count) / rms(input, frames, channel, start, count);
}

void checkDelayedDry(const std::vector<float> &input, const std::vector<float> &output,
                     std::uint32_t frames, std::uint32_t channels, std::uint32_t latency,
                     const char *message) noexcept {
  bool equal = true;
  for (std::uint32_t channel = 0u; channel < channels && equal; ++channel) {
    const std::size_t offset = static_cast<std::size_t>(channel) * frames;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const float expected = frame < latency ? 0.0F : input[offset + frame - latency];
      if (output[offset + frame] != expected) {
        equal = false;
        break;
      }
    }
  }
  check(equal, message);
}

Params broadRegion(float gain) noexcept {
  Params params = defaultParams();
  setRegion(params, 0u, 20.0F, 20.0F, 40000.0F, 40000.0F, 0.0F, 0.0F, 180.0F, 180.0F, gain);
  return params;
}

void testLatencyAndDryRouting() {
  const std::array<std::pair<float, std::uint32_t>, 8u> rates{{
      {44100.0F, 5120u},
      {48000.0F, 5120u},
      {50000.0F, 10240u},
      {88200.0F, 10240u},
      {96000.0F, 10240u},
      {176400.0F, 20480u},
      {192000.0F, 20480u},
      {384000.0F, 40960u},
  }};
  for (const auto &[rate, expected] : rates) {
    KernelHarness harness(rate, 1u);
    check(harness.latency() == expected, "latency follows the sample-rate FFT plan");
    const std::uint32_t frames = expected + 257u;
    const std::vector<float> input = noise(frames, 1u);
    const std::vector<float> output = render(harness, broadRegion(200.0F), input, 1u, frames, 63u);
    checkDelayedDry(input, output, frames, 1u, expected,
                    "mono is exact delayed dry even with an active region");
  }

  constexpr std::uint32_t frames = 12289u;
  KernelHarness neutral(48000.0F, 2u);
  const std::vector<float> input = noise(frames, 2u);
  const std::vector<float> output = render(neutral, defaultParams(), input, 2u, frames, 127u);
  checkDelayedDry(input, output, frames, 2u, neutral.latency(),
                  "all-neutral region gains use exact delayed dry in stereo");

  Params disabled_solo = defaultParams();
  disabled_solo.solo[1u] = 1.0F;
  KernelHarness disabled_solo_harness(48000.0F, 2u);
  const std::vector<float> disabled_solo_output =
      render(disabled_solo_harness, disabled_solo, input, 2u, frames, 127u);
  checkDelayedDry(input, disabled_solo_output, frames, 2u, disabled_solo_harness.latency(),
                  "solo on a disabled region keeps the exact delayed dry path");

  KernelHarness multichannel(48000.0F, 4u);
  const std::vector<float> four_channel = stereoTone(32768u, 48000.0, 1500.0, 0.0, 4u);
  const std::vector<float> four_output =
      render(multichannel, broadRegion(200.0F), four_channel, 4u, 32768u, 127u);
  check(steadyGain(four_channel, four_output, 32768u) > 1.9, "the first stereo pair is processed");
  bool extra_dry = true;
  for (std::uint32_t channel = 2u; channel < 4u; ++channel) {
    const std::size_t offset = static_cast<std::size_t>(channel) * 32768u;
    for (std::uint32_t frame = 0u; frame < 32768u; ++frame) {
      const float expected = frame < multichannel.latency()
                                 ? 0.0F
                                 : four_channel[offset + frame - multichannel.latency()];
      if (four_output[offset + frame] != expected) {
        extra_dry = false;
        break;
      }
    }
  }
  check(extra_dry, "channels after the first pair stay exact delayed dry");
}

void testPhaseSelectionAndSymmetry() {
  constexpr std::uint32_t frames = 32768u;
  constexpr double sample_rate = 48000.0;
  constexpr double frequency = 1500.0;
  for (double phase : {0.0, 45.0, 90.0, 135.0, 180.0}) {
    Params params = defaultParams();
    const float low = static_cast<float>(phase > 5.0 ? phase - 5.0 : 0.0);
    const float high = static_cast<float>(phase < 175.0 ? phase + 5.0 : 180.0);
    setRegion(params, 0u, 1400.0F, 1400.0F, 1600.0F, 1600.0F, low, low, high, high, 150.0F);
    const std::vector<float> input = stereoTone(frames, sample_rate, frequency, phase);
    KernelHarness harness;
    const std::vector<float> output = render(harness, params, input, 2u, frames, 127u);
    const double gain = steadyGain(input, output, frames);
    check(std::abs(gain - 1.5) < 0.035, "bin-centered phase targets receive their configured gain");
  }

  Params ninety = defaultParams();
  setRegion(ninety, 0u, 1400.0F, 1400.0F, 1600.0F, 1600.0F, 85.0F, 85.0F, 95.0F, 95.0F, 150.0F);
  const std::vector<float> positive = stereoTone(frames, sample_rate, frequency, 90.0);
  const std::vector<float> negative = stereoTone(frames, sample_rate, frequency, -90.0);
  KernelHarness positive_harness;
  KernelHarness negative_harness;
  const std::vector<float> positive_output =
      render(positive_harness, ninety, positive, 2u, frames, 31u);
  const std::vector<float> negative_output =
      render(negative_harness, ninety, negative, 2u, frames, 128u);
  check(std::abs(steadyGain(positive, positive_output, frames) -
                 steadyGain(negative, negative_output, frames)) < 1.0e-5,
        "positive and negative phase differences receive the same gain");

  const ComplexProjection left =
      projection(positive_output, frames, 0u, sample_rate, frequency, 24576u, 8192u);
  const ComplexProjection right =
      projection(positive_output, frames, 1u, sample_rate, frequency, 24576u, 8192u);
  const double phase_error = std::remainder(relativePhase(left, right) + kPi * 0.5, 2.0 * kPi);
  check(std::abs(phase_error) < 0.002,
        "equal positive spectral gain preserves the L/R phase difference");

  const std::vector<float> outside = stereoTone(frames, sample_rate, frequency, 45.0);
  KernelHarness outside_harness;
  const std::vector<float> outside_output =
      render(outside_harness, ninety, outside, 2u, frames, 127u);
  check(std::abs(steadyGain(outside, outside_output, frames) - 1.0) < 0.002,
        "phase components outside the rectangle remain at unity");
}

void testTransitionsAndOverlap() {
  constexpr std::uint32_t frames = 32768u;
  const std::vector<float> corner_input = stereoTone(frames, 48000.0, 1500.0, 45.0);
  Params corner = defaultParams();
  setRegion(corner, 0u, 750.0F, 3000.0F, 6000.0F, 6000.0F, 0.0F, 90.0F, 135.0F, 135.0F, 200.0F);
  KernelHarness corner_harness;
  const std::vector<float> corner_output =
      render(corner_harness, corner, corner_input, 2u, frames, 127u);
  check(std::abs(steadyGain(corner_input, corner_output, frames) - 1.25) < 0.035,
        "frequency and phase transition midpoints multiply to quarter weight");

  Params overlap = broadRegion(150.0F);
  setRegion(overlap, 1u, 20.0F, 20.0F, 40000.0F, 40000.0F, 0.0F, 0.0F, 180.0F, 180.0F, 50.0F);
  const std::vector<float> input = stereoTone(frames, 48000.0, 1500.0, 30.0);
  KernelHarness overlap_harness;
  const std::vector<float> output = render(overlap_harness, overlap, input, 2u, frames, 65u);
  check(std::abs(steadyGain(input, output, frames) - 0.75) < 0.025,
        "overlapping region gains multiply");
}

void testBalanceSelectionAndConjunction() {
  constexpr std::uint32_t frames = 32768u;
  constexpr double frequency = 1500.0;
  Params selected = broadRegion(150.0F);
  setBalance(selected, 0u, -70.0F, -70.0F, -50.0F, -50.0F);
  const std::vector<float> left_heavy = balancedTone(frames, 48000.0, frequency, -60.0);
  KernelHarness selected_harness;
  const std::vector<float> selected_output =
      render(selected_harness, selected, left_heavy, 2u, frames, 127u);
  check(std::abs(steadyGain(left_heavy, selected_output, frames) - 1.5) < 0.035,
        "a component inside the Balance core receives its configured gain");

  const std::vector<float> centered = balancedTone(frames, 48000.0, frequency, 0.0);
  KernelHarness centered_harness;
  const std::vector<float> centered_output =
      render(centered_harness, selected, centered, 2u, frames, 127u);
  check(std::abs(steadyGain(centered, centered_output, frames) - 1.0) < 0.002,
        "a component outside the Balance range remains at unity");

  Params transition = broadRegion(200.0F);
  setBalance(transition, 0u, -80.0F, -60.0F, -40.0F, -40.0F);
  const std::vector<float> transition_input = balancedTone(frames, 48000.0, frequency, -70.0);
  KernelHarness transition_harness;
  const std::vector<float> transition_output =
      render(transition_harness, transition, transition_input, 2u, frames, 65u);
  check(std::abs(steadyGain(transition_input, transition_output, frames) - 1.5) < 0.035,
        "the Balance transition midpoint has half weight");

  Params conjunction = selected;
  conjunction.outerPhaseLow[0u] = 80.0F;
  conjunction.corePhaseLow[0u] = 85.0F;
  conjunction.corePhaseHigh[0u] = 95.0F;
  conjunction.outerPhaseHigh[0u] = 100.0F;
  KernelHarness phase_miss_harness;
  const std::vector<float> phase_miss_output =
      render(phase_miss_harness, conjunction, left_heavy, 2u, frames, 31u);
  check(std::abs(steadyGain(left_heavy, phase_miss_output, frames) - 1.0) < 0.002,
        "frequency, phase and Balance constraints combine as an AND condition");

  Params core_only = broadRegion(150.0F);
  setBalance(core_only, 0u, -100.0F, 40.0F, 60.0F, 100.0F);
  const std::vector<float> core_input = balancedTone(frames, 48000.0, frequency, 50.0);
  KernelHarness core_harness;
  const std::vector<float> core_output =
      render(core_harness, core_only, core_input, 2u, frames, 127u);
  const double earlier_gain = rms(core_output, frames, 0u, frames - 8192u, 4096u) /
                              rms(core_input, frames, 0u, frames - 8192u, 4096u);
  const double later_gain = rms(core_output, frames, 0u, frames - 4096u, 4096u) /
                            rms(core_input, frames, 0u, frames - 4096u, 4096u);
  check(std::abs(earlier_gain - 1.5) < 0.035 && std::abs(later_gain - 1.5) < 0.035,
        "a Balance core constraint works when both outer boundaries span the full axis");
  check(std::abs(earlier_gain - later_gain) < 0.01,
        "a core-only Balance constraint is independent of telemetry capture cadence");
}

void testUntrustedBinsAndFiniteSafety() {
  constexpr std::uint32_t frames = 24576u;
  std::vector<float> one_sided = stereoTone(frames, 48000.0, 1500.0, 0.0);
  std::fill(one_sided.begin() + frames, one_sided.end(), 0.0F);
  KernelHarness one_sided_harness;
  const std::vector<float> one_sided_output =
      render(one_sided_harness, broadRegion(200.0F), one_sided, 2u, frames, 127u);
  check(std::abs(steadyGain(one_sided, one_sided_output, frames) - 2.0) < 0.035,
        "a one-sided bin is processed as maximum phase");

  Params low_phase = broadRegion(200.0F);
  low_phase.corePhaseHigh[0u] = 45.0F;
  low_phase.outerPhaseHigh[0u] = 45.0F;
  KernelHarness low_phase_harness;
  const std::vector<float> low_phase_output =
      render(low_phase_harness, low_phase, one_sided, 2u, frames, 127u);
  check(std::abs(steadyGain(one_sided, low_phase_output, frames) - 1.0) < 0.002,
        "a one-sided bin is outside a low-phase-only region");

  Params left_balance = broadRegion(200.0F);
  setBalance(left_balance, 0u, -100.0F, -100.0F, -90.0F, -90.0F);
  KernelHarness left_balance_harness;
  const std::vector<float> left_balance_output =
      render(left_balance_harness, left_balance, one_sided, 2u, frames, 127u);
  check(std::abs(steadyGain(one_sided, left_balance_output, frames) - 2.0) < 0.035,
        "a left-only bin has a Balance of minus one hundred percent");

  std::vector<float> special(static_cast<std::size_t>(frames) * 2u);
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      special[static_cast<std::size_t>(channel) * frames + frame] =
          (frame & 1u) == 0u ? 0.25F : -0.15F;
    }
  }
  KernelHarness special_harness;
  const std::vector<float> special_output =
      render(special_harness, broadRegion(200.0F), special, 2u, frames, 31u);
  const double special_gain = steadyGain(special, special_output, frames);
  check(std::abs(special_gain - 1.0) < 0.01,
        "DC and Nyquist dominated input remains effectively unity and finite");

  std::vector<float> invalid = noise(8193u, 2u);
  invalid[17u] = std::numeric_limits<float>::quiet_NaN();
  invalid[8193u + 31u] = std::numeric_limits<float>::infinity();
  invalid[91u] = -std::numeric_limits<float>::infinity();
  KernelHarness invalid_harness;
  const std::vector<float> invalid_output =
      render(invalid_harness, broadRegion(200.0F), invalid, 2u, 8193u, 113u);
  check(finite(invalid_output), "non-finite input is sanitized before delay and STFT state");
}

void testBlocksResetAndParameterChanges() {
  constexpr std::uint32_t frames = 16384u;
  const Params active = broadRegion(50.0F);
  const std::vector<float> input = noise(frames, 2u);
  KernelHarness one_frame;
  KernelHarness irregular;
  const std::vector<float> reference = render(one_frame, active, input, 2u, frames, 1u);
  const std::vector<float> blocked = render(irregular, active, input, 2u, frames, 127u);
  check(reference == blocked, "output is independent of host block boundaries");
  irregular.reset();
  const std::vector<float> replay = render(irregular, active, input, 2u, frames, 31u);
  check(reference == replay, "reset reproduces the staged STFT pipeline");

  constexpr std::uint32_t transition_frames = 32768u;
  const std::vector<float> transition_input = stereoTone(transition_frames, 48000.0, 1500.0, 60.0);
  KernelHarness transition;
  transition.stage(broadRegion(200.0F));
  std::vector<float> transition_output(static_cast<std::size_t>(transition_frames) * 2u, 0.0F);
  std::uint32_t offset = 0u;
  while (offset < transition_frames) {
    if (offset == 16000u) {
      transition.stage(broadRegion(0.0F));
    }
    std::uint32_t count = std::min(127u, transition_frames - offset);
    if (offset < 16000u && offset + count > 16000u) {
      count = 16000u - offset;
    }
    std::vector<float> block(static_cast<std::size_t>(2u) * count);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        block[static_cast<std::size_t>(channel) * count + frame] =
            transition_input[static_cast<std::size_t>(channel) * transition_frames + offset +
                             frame];
      }
    }
    transition.process(block, 2u, count);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        transition_output[static_cast<std::size_t>(channel) * transition_frames + offset + frame] =
            block[static_cast<std::size_t>(channel) * count + frame];
      }
    }
    offset += count;
  }
  double maximum_step = 0.0;
  for (std::uint32_t frame = 1u; frame < transition_frames; ++frame) {
    const double step = std::abs(static_cast<double>(transition_output[frame]) -
                                 static_cast<double>(transition_output[frame - 1u]));
    if (step > maximum_step) {
      maximum_step = step;
    }
  }
  check(finite(transition_output) && maximum_step < 2.0,
        "parameter changes remain finite without a huge output spike");
}

void testVariableFrameDeterminism() {
  constexpr std::uint32_t frames = 28673u;
  constexpr std::array<std::uint32_t, 7u> required_frame_sizes{{1u, 7u, 16u, 32u, 64u, 128u, 129u}};
  const Params active = broadRegion(150.0F);
  const std::vector<float> input = noise(frames, 2u);

  KernelHarness reference_harness(192000.0F, 2u, 129u);
  const std::vector<float> reference = render(reference_harness, active, input, 2u, frames, 1u);
  for (const std::uint32_t frame_size : required_frame_sizes) {
    KernelHarness harness(192000.0F, 2u, 129u);
    const std::vector<float> output = render(harness, active, input, 2u, frames, frame_size);
    check(output == reference, "output is bit-exact for every required host frame size");
  }

  KernelHarness mixed_harness(192000.0F, 2u, 129u);
  const std::vector<float> mixed =
      renderWithBlockPattern(mixed_harness, active, input, 2u, frames, required_frame_sizes.data(),
                             required_frame_sizes.size());
  check(mixed == reference, "output is bit-exact when host frame sizes vary between calls");
}

void testWetStftReconstruction() {
  struct ReconstructionCase {
    float sampleRate;
    std::uint32_t fftSize;
    const char *message;
  };
  constexpr std::array<ReconstructionCase, 4u> cases{{
      {48000.0F, 4096u, "48 kHz wet STFT reconstructs delayed dry within tolerance"},
      {96000.0F, 8192u, "96 kHz wet STFT reconstructs delayed dry within tolerance"},
      {192000.0F, 16384u, "192 kHz wet STFT reconstructs delayed dry within tolerance"},
      {384000.0F, 32768u, "384 kHz wet STFT reconstructs delayed dry within tolerance"},
  }};

  Params params = defaultParams();
  setRegion(params, 0u, 20.0F, 20.0F, 40000.0F, 40000.0F, 170.0F, 170.0F, 180.0F, 180.0F, 200.0F);
  for (const ReconstructionCase &test_case : cases) {
    KernelHarness harness(test_case.sampleRate, 2u);
    const std::uint32_t latency = harness.latency();
    const std::uint32_t frames = latency + 2u * test_case.fftSize;
    const std::vector<float> input =
        stereoTone(frames, static_cast<double>(test_case.sampleRate), 1500.0, 0.0);
    const std::vector<float> output = render(harness, params, input, 2u, frames, 127u);
    const std::uint32_t steady_begin = latency + test_case.fftSize;
    double maximum_error = 0.0;
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      const std::size_t offset = static_cast<std::size_t>(channel) * frames;
      for (std::uint32_t frame = steady_begin; frame < frames; ++frame) {
        const double error = std::abs(static_cast<double>(output[offset + frame]) -
                                      static_cast<double>(input[offset + frame - latency]));
        if (error > maximum_error) {
          maximum_error = error;
        }
      }
    }
    check(maximum_error <= 1.0e-5, test_case.message);
  }
}

void testSolo() {
  constexpr std::uint32_t frames = 32768u;
  constexpr double sample_rate = 48000.0;
  const std::vector<float> inside = stereoTone(frames, sample_rate, 1500.0, 30.0);
  const std::vector<float> outside = stereoTone(frames, sample_rate, 5000.0, 30.0);

  Params neutral_solo = defaultParams();
  setRegion(neutral_solo, 0u, 1400.0F, 1400.0F, 1600.0F, 1600.0F, 0.0F, 0.0F, 180.0F, 180.0F,
            100.0F, true);
  KernelHarness inside_harness;
  const std::vector<float> inside_output =
      render(inside_harness, neutral_solo, inside, 2u, frames, 127u);
  check(std::abs(steadyGain(inside, inside_output, frames) - 1.0) < 0.035,
        "a soloed region passes at unity even with a neutral Gain");
  KernelHarness outside_harness;
  const std::vector<float> outside_output =
      render(outside_harness, neutral_solo, outside, 2u, frames, 127u);
  check(steadyGain(outside, outside_output, frames) < 0.01,
        "solo mutes components outside every soloed region");

  Params boosted_solo = defaultParams();
  setRegion(boosted_solo, 0u, 1400.0F, 1400.0F, 1600.0F, 1600.0F, 0.0F, 0.0F, 180.0F, 180.0F,
            200.0F, true);
  KernelHarness gain_harness;
  const std::vector<float> gain_output =
      render(gain_harness, boosted_solo, inside, 2u, frames, 65u);
  check(std::abs(steadyGain(inside, gain_output, frames) - 1.0) < 0.035,
        "solo ignores the Gain of the soloed region");

  Params union_solo = boosted_solo;
  setRegion(union_solo, 1u, 4500.0F, 4500.0F, 5500.0F, 5500.0F, 0.0F, 0.0F, 180.0F, 180.0F, 50.0F,
            true);
  KernelHarness union_harness;
  const std::vector<float> union_output =
      render(union_harness, union_solo, outside, 2u, frames, 31u);
  check(std::abs(steadyGain(outside, union_output, frames) - 1.0) < 0.035,
        "solo takes the maximum weight over every soloed region");

  Params disabled_solo = broadRegion(150.0F);
  setRegion(disabled_solo, 1u, 4500.0F, 4500.0F, 5500.0F, 5500.0F, 0.0F, 0.0F, 180.0F, 180.0F,
            100.0F, true);
  disabled_solo.enabled[1u] = 0.0F;
  KernelHarness disabled_harness;
  const std::vector<float> disabled_output =
      render(disabled_harness, disabled_solo, inside, 2u, frames, 127u);
  check(std::abs(steadyGain(inside, disabled_output, frames) - 1.5) < 0.035,
        "solo on a disabled region leaves the region gain product active");

  // At 1500 Hz with a 30 degree phase difference the specified weights are, with
  // smooth01(1/2) = 0.5 and smooth01(1/3) = 0.25: region 0 = 0.5 * 0.5 = 0.25 (1500 Hz is the
  // geometric midpoint of 750 and 3000, 30 degrees the midpoint of 0 and 60), region 1 =
  // 1.0 * 0.5 = 0.5 and region 2 = 0.5 * 0.25 = 0.125. The maximum is therefore 0.5, while a
  // hard gate would give 1.0, a sum 0.875, a product 0.015625, the first match 0.25 and the
  // last match 0.125. Region 3 is enabled but not soloed and covers the whole plane with a
  // 200 % Gain, so leaking any unsoloed region into the soloed set or its weight would move
  // the result away from 0.5.
  Params partial_solo = defaultParams();
  setRegion(partial_solo, 0u, 750.0F, 3000.0F, 6000.0F, 6000.0F, 0.0F, 60.0F, 180.0F, 180.0F,
            200.0F, true);
  setRegion(partial_solo, 1u, 1000.0F, 1000.0F, 2000.0F, 2000.0F, 0.0F, 60.0F, 180.0F, 180.0F,
            50.0F, true);
  setRegion(partial_solo, 2u, 750.0F, 3000.0F, 6000.0F, 6000.0F, 0.0F, 90.0F, 180.0F, 180.0F,
            150.0F, true);
  setRegion(partial_solo, 3u, 20.0F, 20.0F, 40000.0F, 40000.0F, 0.0F, 0.0F, 180.0F, 180.0F, 200.0F);
  KernelHarness partial_harness;
  const std::vector<float> partial_output =
      render(partial_harness, partial_solo, inside, 2u, frames, 127u);
  check(std::abs(steadyGain(inside, partial_output, frames) - 0.5) < 0.035,
        "solo takes the maximum of the smooth transition weights, not a gate, sum or product");
}

struct TelemetryPoint {
  float frequency = 0.0F;
  float phase = 0.0F;
  float balance = 0.0F;
  float relativeLevel = 0.0F;
};

std::vector<TelemetryPoint> validateTelemetry(const std::vector<std::uint8_t> &frame,
                                              std::uint32_t bytes,
                                              std::uint32_t expected_sequence) {
  check(bytes >= 32u, "telemetry has a frame and payload header");
  if (bytes < 32u) {
    return {};
  }
  check(readU16(frame.data()) == kTapPhaseSelectMap, "telemetry frame type is Phase Select Map");
  check(readU16(frame.data() + 2u) == 2u, "telemetry format version is two");
  check(readU32(frame.data() + 8u) == expected_sequence, "telemetry sequence advances once");
  const std::uint16_t payload_bytes = readU16(frame.data() + 12u);
  check(bytes == static_cast<std::uint32_t>((16u + payload_bytes + 3u) & ~3u),
        "telemetry byte count matches its payload");
  const std::uint8_t *payload = frame.data() + 16u;
  const std::uint16_t point_count = readU16(payload + 4u);
  check(readF32(payload) == 48000.0F, "telemetry carries the sample rate");
  check(point_count > 0u && point_count <= 512u, "telemetry point count is bounded");
  check(readU16(payload + 6u) == 0u, "telemetry payload flags are clear");
  check(readU32(payload + 8u) == 4096u, "telemetry carries the FFT size");
  check(std::isfinite(readF32(payload + 12u)), "telemetry frame maximum is finite");
  check(payload_bytes == 16u + static_cast<std::uint32_t>(point_count) * 16u,
        "telemetry payload uses one 16-byte record per point");

  std::vector<TelemetryPoint> points;
  points.reserve(point_count);
  for (std::uint32_t point = 0u; point < point_count; ++point) {
    const std::uint8_t *source = payload + 16u + point * 16u;
    const TelemetryPoint value{readF32(source), readF32(source + 4u), readF32(source + 8u),
                               readF32(source + 12u)};
    check(std::isfinite(value.frequency) && value.frequency >= 20.0F && value.frequency <= 23520.0F,
          "telemetry frequency is finite and in range");
    check(std::isfinite(value.phase) && value.phase >= -180.0F && value.phase <= 180.0F,
          "telemetry phase is finite and in range");
    check(std::isfinite(value.balance) && value.balance >= -100.0F && value.balance <= 100.0F,
          "telemetry Balance is finite and in range");
    check(std::isfinite(value.relativeLevel) && value.relativeLevel <= 0.0F,
          "telemetry relative level is finite and non-positive");
    points.push_back(value);
  }
  return points;
}

float phaseNearest(const std::vector<TelemetryPoint> &points, float frequency) noexcept {
  float best_phase = 1000.0F;
  float best_distance = std::numeric_limits<float>::infinity();
  for (const TelemetryPoint &point : points) {
    const float distance = std::abs(point.frequency - frequency);
    if (distance < best_distance) {
      best_distance = distance;
      best_phase = point.phase;
    }
  }
  return best_phase;
}

float balanceNearest(const std::vector<TelemetryPoint> &points, float frequency) noexcept {
  float best_balance = 1000.0F;
  float best_distance = std::numeric_limits<float>::infinity();
  for (const TelemetryPoint &point : points) {
    const float distance = std::abs(point.frequency - frequency);
    if (distance < best_distance) {
      best_distance = distance;
      best_balance = point.balance;
    }
  }
  return best_balance;
}

void testTelemetryAndSwap() {
  constexpr std::uint32_t frames = 16384u;
  const std::vector<float> input = balancedTone(frames, 48000.0, 1500.0, 50.0, 60.0);
  KernelHarness harness;
  static_cast<void>(render(harness, defaultParams(), input, 2u, frames, 127u));
  std::vector<std::uint8_t> frame(16384u);
  const std::uint32_t bytes = harness.readTelemetry(frame);
  const std::vector<TelemetryPoint> points = validateTelemetry(frame, bytes, 0u);
  check(std::abs(phaseNearest(points, 1500.0F) + 60.0F) < 0.2F,
        "telemetry preserves the trusted signed phase");
  check(std::abs(balanceNearest(points, 1500.0F) - 50.0F) < 0.2F,
        "telemetry reports right-positive Balance");
  check(harness.readTelemetry(frame) == 0u, "a telemetry generation is written only once");

  const std::vector<float> opposite_phase = balancedTone(frames, 48000.0, 1500.0, 50.0, -60.0);
  KernelHarness opposite_phase_harness;
  static_cast<void>(
      render(opposite_phase_harness, defaultParams(), opposite_phase, 2u, frames, 31u));
  const std::uint32_t opposite_phase_bytes = opposite_phase_harness.readTelemetry(frame);
  const std::vector<TelemetryPoint> opposite_phase_points =
      validateTelemetry(frame, opposite_phase_bytes, 0u);
  check(std::abs(phaseNearest(opposite_phase_points, 1500.0F) - 60.0F) < 0.2F,
        "opposite trusted phases remain distinct at the same Balance");
  check(std::abs(balanceNearest(opposite_phase_points, 1500.0F) - 50.0F) < 0.2F,
        "trusted phase sign does not change Balance");

  std::vector<float> left_only = stereoTone(frames, 48000.0, 1500.0, 0.0);
  std::fill(left_only.begin() + frames, left_only.end(), 0.0F);
  KernelHarness left_only_harness;
  static_cast<void>(render(left_only_harness, defaultParams(), left_only, 2u, frames, 127u));
  const std::uint32_t left_only_bytes = left_only_harness.readTelemetry(frame);
  const std::vector<TelemetryPoint> left_only_points =
      validateTelemetry(frame, left_only_bytes, 0u);
  check(std::abs(phaseNearest(left_only_points, 1500.0F) + 180.0F) < 0.2F,
        "left-only telemetry uses minus 180 degrees");
  check(std::abs(balanceNearest(left_only_points, 1500.0F) + 100.0F) < 0.2F,
        "left-only telemetry reports minus one hundred percent Balance");

  std::vector<float> right_only(left_only.size(), 0.0F);
  std::copy_n(left_only.begin(), frames, right_only.begin() + frames);
  KernelHarness right_only_harness;
  static_cast<void>(render(right_only_harness, defaultParams(), right_only, 2u, frames, 127u));
  const std::uint32_t right_only_bytes = right_only_harness.readTelemetry(frame);
  const std::vector<TelemetryPoint> right_only_points =
      validateTelemetry(frame, right_only_bytes, 0u);
  check(std::abs(phaseNearest(right_only_points, 1500.0F) - 180.0F) < 0.2F,
        "right-only telemetry uses plus 180 degrees");
  check(std::abs(balanceNearest(right_only_points, 1500.0F) - 100.0F) < 0.2F,
        "right-only telemetry reports plus one hundred percent Balance");

  harness.reset();
  check(harness.readTelemetry(frame) == 0u, "reset discards the previous telemetry frame");
}

} // namespace

int main() {
  testLatencyAndDryRouting();
  testPhaseSelectionAndSymmetry();
  testTransitionsAndOverlap();
  testBalanceSelectionAndConjunction();
  testUntrustedBinsAndFiniteSafety();
  testBlocksResetAndParameterChanges();
  testVariableFrameDeterminism();
  testWetStftReconstruction();
  testSolo();
  testTelemetryAndSwap();
  return failures == 0 ? 0 : 1;
}

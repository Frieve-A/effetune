#include "PitchShifterHQPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <pffft.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <string_view>
#include <utility>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_PitchShifterHQPlugin() noexcept;

namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 16384u;
using Params = effetune::generated::PitchShifterHQPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Pitch Shifter HQ check failed: %s\n", message);
    ++failures;
  }
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate = 48000.0F, std::uint32_t max_channels = 8u,
                         std::uint32_t max_frames = kMaximumFrames) {
    descriptor_ = et_kernel_descriptor_PitchShifterHQPlugin();
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
        kernel_->stageParameters(&params.pitchShift, Params::kFloatCount, Params::kHash);
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

  void reset() noexcept {
    if (kernel_ != nullptr) {
      kernel_->reset();
    }
  }

  [[nodiscard]] std::uint32_t latency() const noexcept {
    return kernel_ == nullptr ? 0u : kernel_->latencySamples();
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

Params params(float pitch = 0.0F, float fine = 0.0F) noexcept { return {pitch, fine}; }

std::vector<float> render(KernelHarness &harness, const Params &active,
                          const std::vector<float> &input, std::uint32_t channels,
                          std::uint32_t frames, std::uint32_t block_size) {
  harness.stage(active);
  std::vector<float> output(input.size(), 0.0F);
  std::uint32_t offset = 0u;
  while (offset < frames) {
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
  }
  return output;
}

std::vector<float> noise(std::uint32_t frames, std::uint32_t channels) {
  std::vector<float> output(static_cast<std::size_t>(frames) * channels);
  std::uint32_t state = 0x7139a52du;
  for (float &sample : output) {
    state = state * 1664525u + 1013904223u;
    sample = static_cast<float>((static_cast<double>(state) / 4294967296.0 - 0.5) * 0.6);
  }
  return output;
}

std::vector<float> highBandNoise(std::uint32_t frames, double sample_rate,
                                 std::uint32_t seed = 0x00a81192u) {
  std::vector<float> output(frames);
  std::uint32_t state = seed;
  double low_pass_1 = 0.0;
  double low_pass_2 = 0.0;
  const double coefficient = 1.0 - std::exp(-2.0 * kPi * 6500.0 / sample_rate);
  for (float &sample : output) {
    state = state * 1664525u + 1013904223u;
    const double value = static_cast<double>(state) / 4294967296.0 * 2.0 - 1.0;
    low_pass_1 += coefficient * (value - low_pass_1);
    low_pass_2 += coefficient * (low_pass_1 - low_pass_2);
    sample = static_cast<float>((value - low_pass_2) * 0.22);
  }
  return output;
}

std::vector<float> tone(std::uint32_t frames, std::uint32_t channels, double sample_rate,
                        double frequency, double phase_step = 0.0) {
  std::vector<float> output(static_cast<std::size_t>(frames) * channels);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    const double phase = static_cast<double>(channel) * phase_step;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      output[static_cast<std::size_t>(channel) * frames + frame] = static_cast<float>(
          0.4 * std::sin(2.0 * kPi * frequency * static_cast<double>(frame) / sample_rate + phase));
    }
  }
  return output;
}

void addTone(std::vector<float> &audio, std::uint32_t frames, std::uint32_t channels,
             double sample_rate, double frequency, double amplitude) {
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      audio[static_cast<std::size_t>(channel) * frames + frame] += static_cast<float>(
          amplitude * std::sin(2.0 * kPi * frequency * static_cast<double>(frame) / sample_rate));
    }
  }
}

std::vector<float> sweep(std::uint32_t frames, double sample_rate) {
  std::vector<float> output(frames);
  double phase = 0.0;
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const double progress = static_cast<double>(frame) / static_cast<double>(frames - 1u);
    const double frequency = 180.0 * std::pow(5000.0 / 180.0, progress);
    phase += 2.0 * kPi * frequency / sample_rate;
    output[frame] = static_cast<float>(0.35 * std::sin(phase));
  }
  return output;
}

std::vector<float> slowLinearSweep(std::uint32_t frames, double sample_rate, double start_frequency,
                                   double end_frequency) {
  std::vector<float> output(frames);
  double phase = 0.0;
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const double progress = static_cast<double>(frame) / static_cast<double>(frames - 1u);
    const double frequency = start_frequency + (end_frequency - start_frequency) * progress;
    phase += 2.0 * kPi * frequency / sample_rate;
    output[frame] = static_cast<float>(0.35 * std::sin(phase));
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
  double real;
  double imaginary;
};

ComplexProjection projection(const std::vector<float> &audio, std::uint32_t frames,
                             std::uint32_t channel, double sample_rate, double frequency,
                             std::uint32_t start, std::uint32_t count) noexcept {
  double real = 0.0;
  double imaginary = 0.0;
  const std::size_t offset = static_cast<std::size_t>(channel) * frames;
  for (std::uint32_t frame = 0u; frame < count; ++frame) {
    const std::uint32_t absolute_frame = start + frame;
    const double phase = 2.0 * kPi * frequency * static_cast<double>(absolute_frame) / sample_rate;
    const double sample = static_cast<double>(audio[offset + absolute_frame]);
    real += sample * std::cos(phase);
    imaginary -= sample * std::sin(phase);
  }
  const double scale = 2.0 / static_cast<double>(count);
  return {real * scale, imaginary * scale};
}

double magnitude(ComplexProjection value) noexcept {
  return std::sqrt(value.real * value.real + value.imaginary * value.imaginary);
}

double highBandHopModulation(const std::vector<float> &audio, std::uint32_t start,
                             std::uint32_t end) {
  constexpr std::uint32_t fft_size = 1024u;
  constexpr std::uint32_t analysis_hop = 256u;
  constexpr std::uint32_t first_bin = 171u;
  PFFFT_Setup *setup = pffft_new_setup(static_cast<int>(fft_size), PFFFT_REAL);
  float *input = static_cast<float *>(pffft_aligned_malloc(fft_size * sizeof(float)));
  float *spectrum = static_cast<float *>(pffft_aligned_malloc(fft_size * sizeof(float)));
  float *work = static_cast<float *>(pffft_aligned_malloc(fft_size * sizeof(float)));
  if (setup == nullptr || input == nullptr || spectrum == nullptr || work == nullptr) {
    check(false, "high-band modulation analyzer allocates");
    pffft_aligned_free(input);
    pffft_aligned_free(spectrum);
    pffft_aligned_free(work);
    if (setup != nullptr) {
      pffft_destroy_setup(setup);
    }
    return 1.0;
  }

  std::vector<double> energies;
  energies.reserve((end - start) / analysis_hop);
  for (std::uint32_t frame_start = start; frame_start + fft_size <= end;
       frame_start += analysis_hop) {
    for (std::uint32_t index = 0u; index < fft_size; ++index) {
      const double phase = 2.0 * kPi * static_cast<double>(index) / static_cast<double>(fft_size);
      const double window = std::sqrt(0.5 - 0.5 * std::cos(phase));
      input[index] = static_cast<float>(static_cast<double>(audio[frame_start + index]) * window);
    }
    pffft_transform_ordered(setup, input, spectrum, work, PFFFT_FORWARD);
    double energy = static_cast<double>(spectrum[1u]) * spectrum[1u];
    for (std::uint32_t bin = first_bin; bin < fft_size / 2u; ++bin) {
      const double real = static_cast<double>(spectrum[2u * bin]);
      const double imaginary = static_cast<double>(spectrum[2u * bin + 1u]);
      energy += real * real + imaginary * imaginary;
    }
    energies.push_back(energy);
  }
  pffft_aligned_free(input);
  pffft_aligned_free(spectrum);
  pffft_aligned_free(work);
  pffft_destroy_setup(setup);

  double mean = 0.0;
  for (double energy : energies) {
    mean += energy;
  }
  mean /= static_cast<double>(energies.size());
  double real = 0.0;
  double imaginary = 0.0;
  for (std::size_t index = 0u; index < energies.size(); ++index) {
    const double centered = energies[index] - mean;
    const double phase = 0.5 * kPi * static_cast<double>(index);
    real += centered * std::cos(phase);
    imaginary -= centered * std::sin(phase);
  }
  return 2.0 * std::hypot(real, imaginary) / (static_cast<double>(energies.size()) * mean);
}

double dominantFrequency(const std::vector<float> &audio, std::uint32_t frames, double sample_rate,
                         double expected, std::uint32_t start, std::uint32_t count) noexcept {
  double best_frequency = expected;
  double best_magnitude = -1.0;
  for (int step = -200; step <= 200; ++step) {
    const double frequency = expected + static_cast<double>(step) * 0.05;
    const double candidate =
        magnitude(projection(audio, frames, 0u, sample_rate, frequency, start, count));
    if (candidate > best_magnitude) {
      best_magnitude = candidate;
      best_frequency = frequency;
    }
  }
  return best_frequency;
}

void testLatencyAndUnity() {
  const std::array<std::pair<float, std::uint32_t>, 6u> rates{{
      {44100.0F, 5120u},
      {48000.0F, 5120u},
      {88200.0F, 10240u},
      {96000.0F, 10240u},
      {176400.0F, 20480u},
      {192000.0F, 20480u},
  }};
  for (const auto &[rate, expected] : rates) {
    KernelHarness harness(rate, 1u);
    check(harness.latency() == expected, "sample-rate-scaled fixed latency is exact");
    const std::uint32_t frames = expected + 257u;
    const std::vector<float> input = noise(frames, 1u);
    const std::vector<float> output = render(harness, params(), input, 1u, frames, 63u);
    check(std::all_of(output.begin(), output.begin() + expected,
                      [](float sample) { return sample == 0.0F; }),
          "unity emits silence before fixed latency");
    check(std::equal(output.begin() + expected, output.end(), input.begin()),
          "unity uses the exact delayed dry signal at every supported rate");
  }

  KernelHarness shifted(192000.0F, 1u);
  const std::uint32_t latency = shifted.latency();
  std::vector<float> full_scale(latency + 1u, 1.0F);
  for (std::uint32_t frame = 1u; frame < full_scale.size(); frame += 2u) {
    full_scale[frame] = -1.0F;
  }
  const std::vector<float> shifted_output =
      render(shifted, params(6.0F, 50.0F), full_scale, 1u,
             static_cast<std::uint32_t>(full_scale.size()), 128u);
  check(std::all_of(shifted_output.begin(), shifted_output.begin() + latency,
                    [](float sample) { return sample == 0.0F; }),
        "non-unity startup stays silent before fixed latency");
  check(std::abs(static_cast<double>(shifted_output[latency]) - full_scale[0u]) < 0.001,
        "the wet startup fade begins from the valid delayed dry stream");
}

void testPitchAndFineTune() {
  constexpr double sample_rate = 48000.0;
  constexpr std::uint32_t frames = 49152u;
  constexpr std::uint32_t start = 24576u;
  constexpr std::uint32_t count = 16384u;

  struct Case {
    double source;
    float pitch;
    float fine;
  };
  const std::array<Case, 5u> cases{{{440.0, 6.0F, 0.0F},
                                    {880.0, -6.0F, 0.0F},
                                    {1000.0, 0.0F, 50.0F},
                                    {1500.0, 0.0F, 39.0F},
                                    {1500.0, 0.0F, 41.0F}}};
  for (const Case &test : cases) {
    KernelHarness harness(48000.0F, 1u);
    const std::vector<float> input = tone(frames, 1u, sample_rate, test.source);
    const std::vector<float> output =
        render(harness, params(test.pitch, test.fine), input, 1u, frames, 127u);
    const double expected =
        test.source * std::pow(2.0, static_cast<double>(test.pitch) / 12.0 +
                                        static_cast<double>(test.fine) / 1200.0);
    const double measured = dominantFrequency(output, frames, sample_rate, expected, start, count);
    check(std::abs(measured - expected) < 0.35, "pitch and fine-tune frequency are accurate");
    const double output_rms = rms(output, frames, 0u, start, count);
    check(output_rms > 0.16 && output_rms < 0.38, "shifted steady-tone gain remains bounded");
    const double target =
        magnitude(projection(output, frames, 0u, sample_rate, measured, start, count));
    check(target > output_rms, "shifted steady tone remains spectrally concentrated");
    const double hop_rate = sample_rate / (static_cast<double>(harness.latency()) * 0.2);
    const double lower_sideband =
        magnitude(projection(output, frames, 0u, sample_rate, measured - hop_rate, start, count));
    const double upper_sideband =
        magnitude(projection(output, frames, 0u, sample_rate, measured + hop_rate, start, count));
    check(lower_sideband < target * 0.2 && upper_sideband < target * 0.2,
          "fractional-bin compensation suppresses hop-rate sidebands");
  }
}

void testAliasAndPeakZero() {
  constexpr std::uint32_t frames = 32768u;
  KernelHarness alias_harness(48000.0F, 1u);
  const std::vector<float> alias_input = tone(frames, 1u, 48000.0, 19000.0);
  const std::vector<float> alias_output =
      render(alias_harness, params(6.0F), alias_input, 1u, frames, 127u);
  check(rms(alias_output, frames, 0u, 16384u, 8192u) < 0.04,
        "content shifted above Nyquist is discarded instead of folded");

  KernelHarness impulse_harness(48000.0F, 1u);
  const std::uint32_t latency = impulse_harness.latency();
  std::vector<float> impulse(frames, 0.0F);
  impulse[latency / 2u] = 1.0F;
  const std::vector<float> impulse_output =
      render(impulse_harness, params(-4.0F), impulse, 1u, frames, 65u);
  double error = 0.0;
  for (std::uint32_t frame = 0u; frame + latency < frames; ++frame) {
    error += std::abs(static_cast<double>(impulse_output[frame + latency]) - impulse[frame]);
  }
  check(error < 0.001, "a peak-free spectrum follows unchanged WOLA with unity rotations");
}

void testStereoComplexRatio() {
  constexpr std::uint32_t frames = 49152u;
  constexpr double source_frequency = 731.0;
  constexpr double phase_offset = 0.73;
  constexpr double ratio = 1.189207115002721;
  const std::vector<float> input = tone(frames, 2u, 48000.0, source_frequency, phase_offset);
  KernelHarness harness(48000.0F, 2u);
  const std::vector<float> output = render(harness, params(3.0F), input, 2u, frames, 127u);
  const double target_frequency = source_frequency * ratio;
  const ComplexProjection left =
      projection(output, frames, 0u, 48000.0, target_frequency, 24576u, 16384u);
  const ComplexProjection right =
      projection(output, frames, 1u, 48000.0, target_frequency, 24576u, 16384u);
  const double denominator = left.real * left.real + left.imaginary * left.imaginary;
  const double ratio_real =
      (right.real * left.real + right.imaginary * left.imaginary) / denominator;
  const double ratio_imaginary =
      (right.imaginary * left.real - right.real * left.imaginary) / denominator;
  check(std::abs(std::hypot(ratio_real, ratio_imaginary) - 1.0) < 0.01,
        "stereo complex-ratio magnitude is preserved");
  check(std::abs(std::remainder(std::atan2(ratio_imaginary, ratio_real) - phase_offset,
                                2.0 * kPi)) < 0.02,
        "stereo complex-ratio phase is preserved");
}

void testChannelsBlocksAndReset() {
  constexpr std::uint32_t frames = 24576u;
  for (std::uint32_t channels = 1u; channels <= 8u; ++channels) {
    const std::vector<float> input = noise(frames, channels);
    KernelHarness reference(96000.0F, channels);
    const std::vector<float> reference_output =
        render(reference, params(-3.0F, 17.0F), input, channels, frames, 1u);
    for (std::uint32_t block_size : {31u, 127u, 128u}) {
      KernelHarness blocked(96000.0F, channels);
      const std::vector<float> blocked_output =
          render(blocked, params(-3.0F, 17.0F), input, channels, frames, block_size);
      check(blocked_output == reference_output,
            "processing is independent of host block boundaries");
    }
    check(finite(reference_output), "all supported channel shapes remain finite");
    reference.reset();
    const std::vector<float> replay =
        render(reference, params(-3.0F, 17.0F), input, channels, frames, 127u);
    check(reference_output == replay, "reset reproduces WOLA and peak-rotation state");
  }
}

void testResetDuringStagedWork() {
  constexpr std::uint32_t channels = 8u;
  constexpr std::uint32_t hop_size = 1024u;
  constexpr std::uint32_t slot_size = 32u;
  constexpr std::uint32_t probe_frames = 12288u;
  const Params active = params(5.0F, -23.0F);
  const std::vector<float> probe = noise(probe_frames, channels);
  KernelHarness reference(48000.0F, channels);
  const std::vector<float> expected = render(reference, active, probe, channels, probe_frames, 31u);

  for (std::uint32_t slot = 0u; slot < 32u; ++slot) {
    const std::uint32_t prefix_frames = hop_size + slot * slot_size + slot_size / 2u;
    KernelHarness interrupted(48000.0F, channels);
    const std::vector<float> prefix = noise(prefix_frames, channels);
    static_cast<void>(render(interrupted, active, prefix, channels, prefix_frames, 31u));
    interrupted.reset();
    const std::vector<float> actual =
        render(interrupted, active, probe, channels, probe_frames, 127u);
    check(actual == expected, "reset discards every staged analysis and synthesis slot");
  }
}

std::vector<float> renderParameterTransition(const std::vector<float> &input,
                                             std::uint32_t change_frame) {
  const std::uint32_t frames = static_cast<std::uint32_t>(input.size());
  KernelHarness harness(48000.0F, 1u);
  harness.stage(params(6.0F));
  std::vector<float> output(frames, 0.0F);
  std::uint32_t offset = 0u;
  while (offset < frames) {
    if (offset == change_frame) {
      harness.stage(params(-6.0F, 31.0F));
    }
    std::uint32_t count = std::min(31u, frames - offset);
    if (offset < change_frame && offset + count > change_frame) {
      count = change_frame - offset;
    }
    std::vector<float> block(count);
    std::copy_n(input.begin() + offset, count, block.begin());
    harness.process(block, 1u, count);
    std::copy(block.begin(), block.end(), output.begin() + offset);
    offset += count;
  }
  return output;
}

void testParameterTransitionLatch() {
  constexpr std::uint32_t frames = 16384u;
  constexpr std::uint32_t hop_size = 1024u;
  constexpr std::uint32_t stage_span = 1024u;
  const std::vector<float> input = tone(frames, 1u, 48000.0, 673.0);
  const std::vector<float> changed_during_job = renderParameterTransition(input, hop_size + 64u);
  const std::vector<float> changed_after_job =
      renderParameterTransition(input, hop_size + stage_span - 1u);
  check(changed_during_job == changed_after_job,
        "an active staged frame uses its latched pitch parameters");
}

void testTransitionsSweepSplitAndMerge() {
  constexpr std::uint32_t frames = 49152u;
  KernelHarness transition(48000.0F, 1u);
  const std::vector<float> input = tone(frames, 1u, 48000.0, 523.25);
  std::vector<float> output(frames, 0.0F);
  transition.stage(params(4.0F));
  std::uint32_t offset = 0u;
  while (offset < frames) {
    if (offset == 24576u) {
      transition.stage(params());
    }
    const std::uint32_t count = std::min(128u, frames - offset);
    std::vector<float> block(count);
    std::copy_n(input.begin() + offset, count, block.begin());
    transition.process(block, 1u, count);
    std::copy(block.begin(), block.end(), output.begin() + offset);
    offset += count;
  }
  check(finite(output), "unity transition remains finite");
  double maximum_step = 0.0;
  for (std::uint32_t frame = 1u; frame < frames; ++frame) {
    maximum_step =
        std::max(maximum_step, std::abs(static_cast<double>(output[frame] - output[frame - 1u])));
  }
  check(maximum_step < 0.8, "unity transition crossfade avoids a full-scale discontinuity");

  KernelHarness sweep_harness(48000.0F, 1u);
  const std::vector<float> sweep_input = sweep(frames, 48000.0);
  const std::vector<float> sweep_output =
      render(sweep_harness, params(5.0F), sweep_input, 1u, frames, 63u);
  check(finite(sweep_output) && rms(sweep_output, frames, 0u, 24576u, 16384u) > 0.05,
        "swept peaks remain finite and audible");

  std::vector<float> two_tones(frames, 0.0F);
  addTone(two_tones, frames, 1u, 48000.0, 700.0, 0.25);
  addTone(two_tones, frames, 1u, 48000.0, 1100.0, 0.25);
  KernelHarness split_harness(48000.0F, 1u);
  const std::vector<float> split_output =
      render(split_harness, params(6.0F), two_tones, 1u, frames, 127u);
  check(magnitude(projection(split_output, frames, 0u, 48000.0, 700.0 * std::sqrt(2.0), 24576u,
                             16384u)) > 0.08,
        "first translated peak survives region splitting");
  check(magnitude(projection(split_output, frames, 0u, 48000.0, 1100.0 * std::sqrt(2.0), 24576u,
                             16384u)) > 0.08,
        "second translated peak survives region splitting");

  KernelHarness merge_harness(48000.0F, 1u);
  const std::vector<float> merge_output =
      render(merge_harness, params(-6.0F), two_tones, 1u, frames, 127u);
  check(finite(merge_output) && rms(merge_output, frames, 0u, 24576u, 16384u) > 0.08,
        "overlapping translated regions merge without instability");
}

void testPeakRotationAcrossBinCrossings() {
  constexpr std::uint32_t frames = 98304u;
  constexpr std::uint32_t hop_size = 1024u;
  KernelHarness harness(48000.0F, 1u);
  const std::vector<float> input = slowLinearSweep(frames, 48000.0, 900.0, 1500.0);
  const std::vector<float> output = render(harness, params(5.0F), input, 1u, frames, 127u);
  constexpr double sample_rate = 48000.0;
  constexpr double start_frequency = 900.0;
  constexpr double end_frequency = 1500.0;
  const double ratio = std::pow(2.0, 5.0 / 12.0);
  const double frequency_step =
      (end_frequency - start_frequency) / static_cast<double>(frames - 1u);
  double previous_observed = 0.0;
  double previous_expected = 0.0;
  double maximum_phase_error = 0.0;
  bool have_previous = false;
  for (std::uint32_t source_center = 16u * hop_size;
       source_center + harness.latency() + 4u * hop_size < frames; source_center += hop_size) {
    const std::uint32_t output_center = source_center + harness.latency();
    const double source_frequency =
        start_frequency + frequency_step * static_cast<double>(source_center);
    const double target_frequency = source_frequency * ratio;
    const ComplexProjection measured =
        projection(output, frames, 0u, sample_rate, target_frequency, output_center - 256u, 512u);
    const double observed = std::atan2(measured.imaginary, measured.real);
    const double n = static_cast<double>(source_center);
    const double input_phase = 2.0 * kPi / sample_rate *
                               ((n + 1.0) * start_frequency + frequency_step * n * (n + 1.0) * 0.5);
    const double expected = ratio * input_phase - 2.0 * kPi * target_frequency *
                                                      static_cast<double>(output_center) /
                                                      sample_rate;
    if (have_previous) {
      const double phase_error = std::abs(std::remainder(
          (observed - previous_observed) - (expected - previous_expected), 2.0 * kPi));
      if (phase_error > maximum_phase_error) {
        maximum_phase_error = phase_error;
      }
    }
    previous_observed = observed;
    previous_expected = expected;
    have_previous = true;
  }
  check(maximum_phase_error < 1.0,
        "slow phase-continuous peak crossings limit hop-to-hop phase discontinuity");
}

void testHighFrequencyQuality() {
  constexpr double sample_rate = 48000.0;
  constexpr std::uint32_t frames = 384000u;
  constexpr std::uint32_t analysis_start = 144000u;
  constexpr std::uint32_t analysis_end = 360000u;
  const std::vector<float> high_noise = highBandNoise(frames, sample_rate);
  KernelHarness noise_harness(static_cast<float>(sample_rate), 1u);
  const std::vector<float> noise_output =
      render(noise_harness, params(3.0F), high_noise, 1u, frames, 127u);
  const double hop_modulation = highBandHopModulation(noise_output, analysis_start, analysis_end);
  check(hop_modulation <= 0.0045, "fixed-anchor noise regions limit high-band hop modulation");

  KernelHarness tone_harness(static_cast<float>(sample_rate), 1u);
  const std::vector<float> tone_input = tone(frames, 1u, sample_rate, 11000.0);
  const std::vector<float> tone_output =
      render(tone_harness, params(3.0F), tone_input, 1u, frames, 127u);
  const double target_frequency = 11000.0 * std::pow(2.0, 3.0 / 12.0);
  const double carrier =
      magnitude(projection(tone_output, frames, 0u, sample_rate, target_frequency, analysis_start,
                           analysis_end - analysis_start));
  const double hop_rate = sample_rate / 1024.0;
  double maximum_sideband = 0.0;
  for (std::uint32_t order = 1u; order <= 3u; ++order) {
    for (double sign : {-1.0, 1.0}) {
      const double sideband =
          magnitude(projection(tone_output, frames, 0u, sample_rate,
                               target_frequency + sign * hop_rate * static_cast<double>(order),
                               analysis_start, analysis_end - analysis_start));
      if (sideband > maximum_sideband) {
        maximum_sideband = sideband;
      }
    }
  }
  const double sideband_db = 20.0 * std::log10(maximum_sideband / carrier);
  check(carrier >= 0.18, "11 kHz tonal carrier remains strong");
  check(sideband_db <= -42.0, "11 kHz tonal hop sidebands stay below -42 dBc");

  constexpr std::uint32_t stereo_frames = 49152u;
  std::vector<float> stereo_input(static_cast<std::size_t>(stereo_frames) * 2u);
  std::copy_n(high_noise.begin(), stereo_frames, stereo_input.begin());
  std::copy_n(high_noise.begin(), stereo_frames, stereo_input.begin() + stereo_frames);
  KernelHarness stereo_harness(static_cast<float>(sample_rate), 2u);
  const std::vector<float> stereo_output =
      render(stereo_harness, params(3.0F), stereo_input, 2u, stereo_frames, 127u);
  check(std::equal(stereo_output.begin(), stereo_output.begin() + stereo_frames,
                   stereo_output.begin() + stereo_frames),
        "identical stereo channels remain sample-identical");
}

void testReleaseHandoffContinuity() {
  constexpr double sample_rate = 48000.0;
  constexpr std::uint32_t hop_size = 1024u;
  constexpr std::uint32_t latency = 5120u;
  constexpr std::uint32_t stable_hops = 38u;
  constexpr std::uint32_t interference_start = 32768u + stable_hops * hop_size;
  constexpr std::uint32_t interference_end = interference_start + 4u * hop_size;
  constexpr std::uint32_t frames = interference_end + latency + 20u * hop_size;
  constexpr double source_frequency = 11035.0;
  constexpr double flank_offset = 2.0 * sample_rate / 4096.0;
  constexpr float pitch = -3.0F;
  constexpr std::uint32_t channels = 2u;

  std::vector<float> input(static_cast<std::size_t>(frames) * channels);
  std::uint32_t state = 0x7a11c0deu;
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    state = state * 1664525u + 1013904223u;
    const double random = static_cast<double>(state) / 4294967296.0 * 2.0 - 1.0;
    const double time = static_cast<double>(frame) / sample_rate;
    double sample = 0.3 * std::sin(2.0 * kPi * source_frequency * time) + random * 0.006;
    if (frame >= interference_start && frame < interference_end) {
      sample += 0.3 * std::sin(2.0 * kPi * (source_frequency - flank_offset) * time + 0.37);
      sample += 0.3 * std::sin(2.0 * kPi * (source_frequency + flank_offset) * time - 0.53);
    }
    const float value = static_cast<float>(sample);
    input[frame] = value;
    input[frames + frame] = value;
  }

  KernelHarness harness(static_cast<float>(sample_rate), channels);
  const std::vector<float> output = render(harness, params(pitch), input, channels, frames, 127u);
  const double target_frequency = source_frequency * std::pow(2.0, pitch / 12.0);
  constexpr std::uint32_t projection_size = 4096u;
  const std::uint32_t release_center = interference_start + latency;
  const ComplexProjection before_release =
      projection(output, frames, 0u, sample_rate, target_frequency,
                 release_center - hop_size - projection_size / 2u, projection_size);
  const ComplexProjection after_release =
      projection(output, frames, 0u, sample_rate, target_frequency,
                 release_center - projection_size / 2u, projection_size);
  const double phase_difference = std::atan2(after_release.imaginary, after_release.real) -
                                  std::atan2(before_release.imaginary, before_release.real);
  const double release_phase_step =
      std::abs(std::atan2(std::sin(phase_difference), std::cos(phase_difference)));
  check(magnitude(before_release) >= 0.05 && magnitude(after_release) >= 0.05 &&
            release_phase_step <= 0.8,
        "two-hop stable-release handoff limits carrier phase discontinuity");

  const std::uint32_t steady_start = interference_end + latency + 8u * hop_size;
  const double steady_carrier = magnitude(
      projection(output, frames, 0u, sample_rate, target_frequency, steady_start, 8u * hop_size));
  check(steady_carrier >= 0.18, "stable-release handoff maintains the shifted carrier");
  check(std::equal(output.begin(), output.begin() + frames, output.begin() + frames),
        "stable-release handoff preserves identical stereo channels");
}

int runBenchmark() {
  constexpr float sample_rate = 192000.0F;
  constexpr std::uint32_t channels = 8u;
  constexpr std::uint32_t block_size = 128u;
  constexpr std::uint32_t seconds = 3u;
  KernelHarness harness(sample_rate, channels, block_size);
  harness.stage(params(6.0F, 50.0F));
  std::vector<float> block(static_cast<std::size_t>(channels) * block_size, 0.1F);
  const std::uint32_t blocks = seconds * static_cast<std::uint32_t>(sample_rate) / block_size;
  const std::clock_t started = std::clock();
  for (std::uint32_t index = 0u; index < blocks; ++index) {
    harness.process(block, channels, block_size);
  }
  const double elapsed = static_cast<double>(std::clock() - started) / CLOCKS_PER_SEC;
  std::printf("Pitch Shifter HQ native RT benchmark: %.2fx realtime (%u Hz, %u ch)\n",
              static_cast<double>(seconds) / elapsed, static_cast<unsigned>(sample_rate), channels);
  return failures == 0 ? 0 : 1;
}

} // namespace

int main(int argc, char **argv) {
  if (argc == 2 && std::string_view(argv[1]) == "--benchmark") {
    return runBenchmark();
  }
  check(argc == 1, "usage: native_test [--benchmark]");
  testLatencyAndUnity();
  testPitchAndFineTune();
  testAliasAndPeakZero();
  testStereoComplexRatio();
  testChannelsBlocksAndReset();
  testResetDuringStagedWork();
  testParameterTransitionLatch();
  testTransitionsSweepSplitAndMerge();
  testPeakRotationAcrossBinCrossings();
  testHighFrequencyQuality();
  testReleaseHandoffContinuity();
  return failures == 0 ? 0 : 1;
}

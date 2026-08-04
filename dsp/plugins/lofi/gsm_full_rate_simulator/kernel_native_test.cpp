#include "GSMFullRateSimulatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_GSMFullRateSimulatorPlugin() noexcept;

namespace {

using Params = effetune::generated::GSMFullRateSimulatorPluginParams;

constexpr std::uint32_t kMaximumFrames = 511u;
constexpr std::size_t kKernelStorageBytes = 8192u;
constexpr std::array<std::uint32_t, 8u> kSupportedRates{44100u,  48000u,  88200u,  96000u,
                                                        176400u, 192000u, 352800u, 384000u};

bool expect(bool condition, const char *message) {
  if (!condition) {
    std::cerr << "FAIL: " << message << '\n';
  }
  return condition;
}

Params defaultParams() noexcept { return {1.0F, 0.0F, 100.0F, 30.0F}; }

class KernelHarness final {
public:
  KernelHarness(float sample_rate, std::uint32_t max_channels) {
    descriptor_ = et_kernel_descriptor_GSMFullRateSimulatorPlugin();
    if (descriptor_ == nullptr || descriptor_->objectSize > storage_.size()) {
      return;
    }
    kernel_ = descriptor_->construct(storage_.data());
    if (kernel_ != nullptr) {
      kernel_->prepare({sample_rate, max_channels, kMaximumFrames});
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  [[nodiscard]] bool ready() const noexcept {
    return kernel_ != nullptr && kernel_->preparedSuccessfully();
  }

  [[nodiscard]] std::uint32_t latency() const noexcept { return kernel_->latencySamples(); }

  void stage(const Params &params) noexcept {
    kernel_->stageParameters(&params.transcodes, Params::kFloatCount, Params::kHash);
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    kernel_->applyPendingParameters();
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->process(audio, channels, frames, {0.0});
  }

  void reset() noexcept { kernel_->reset(); }

  void seed(std::uint32_t low, std::uint32_t high) noexcept { kernel_->setRandomSeed(low, high); }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

std::vector<float> render(float sample_rate, std::uint32_t channels, const Params &params,
                          const std::vector<float> &input,
                          const std::vector<std::uint32_t> &partitions) {
  KernelHarness harness(sample_rate, channels);
  if (!harness.ready()) {
    return {};
  }
  harness.stage(params);
  const std::size_t frames_total = input.size() / channels;
  std::vector<float> output(input.size(), 0.0F);
  std::size_t offset = 0u;
  std::size_t partition = 0u;
  while (offset < frames_total) {
    std::uint32_t frames = partitions[partition++ % partitions.size()];
    const std::size_t remaining = frames_total - offset;
    if (frames > remaining) {
      frames = static_cast<std::uint32_t>(remaining);
    }
    std::vector<float> block(static_cast<std::size_t>(channels) * frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::copy_n(input.data() + static_cast<std::size_t>(channel) * frames_total + offset, frames,
                  block.data() + static_cast<std::size_t>(channel) * frames);
    }
    harness.process(block.data(), channels, frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::copy_n(block.data() + static_cast<std::size_t>(channel) * frames, frames,
                  output.data() + static_cast<std::size_t>(channel) * frames_total + offset);
    }
    offset += frames;
  }
  return output;
}

std::vector<float> renderWithTranscodeEvent(float sample_rate, const std::vector<float> &input,
                                            std::size_t event_frame, float event_transcodes) {
  KernelHarness harness(sample_rate, 1u);
  if (!harness.ready()) {
    return {};
  }
  Params params = defaultParams();
  harness.stage(params);
  std::vector<float> output(input.size(), 0.0F);
  for (std::size_t frame = 0u; frame < input.size(); ++frame) {
    if (frame == event_frame) {
      params.transcodes = event_transcodes;
      harness.stage(params);
    }
    output[frame] = input[frame];
    harness.process(output.data() + frame, 1u, 1u);
  }
  return output;
}

bool checkRateAndDryContracts() {
  bool ok = true;
  for (std::uint32_t sample_rate : kSupportedRates) {
    KernelHarness harness(static_cast<float>(sample_rate), 2u);
    ok &= expect(harness.ready(), "kernel rejects a supported rate");
    if (!harness.ready()) {
      continue;
    }
    ok &= expect(harness.latency() > sample_rate / 100u, "reported latency is implausibly short");
    Params params = defaultParams();
    params.mix = 0.0F;
    harness.stage(params);
    bool impulse_found = false;
    std::uint32_t absolute = 0u;
    while (absolute <= harness.latency() + kMaximumFrames) {
      std::array<float, 2u * kMaximumFrames> audio{};
      if (absolute == 0u) {
        audio[0u] = 1.0F;
        audio[kMaximumFrames] = -1.0F;
      }
      harness.process(audio.data(), 2u, kMaximumFrames);
      for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
        const std::uint32_t index = absolute + frame;
        if (index < harness.latency()) {
          ok &= expect(audio[frame] == 0.0F && audio[kMaximumFrames + frame] == 0.0F,
                       "dry output precedes reported latency");
        } else if (index == harness.latency()) {
          impulse_found = audio[frame] == 1.0F && audio[kMaximumFrames + frame] == -1.0F;
        }
      }
      absolute += kMaximumFrames;
    }
    ok &= expect(impulse_found, "dry impulse is not aligned with latencySamples");
  }
  KernelHarness unsupported(32000.0F, 2u);
  ok &= expect(!unsupported.ready(), "kernel accepts an unsupported rate");
  return ok;
}

bool measureWetLatency() {
  bool ok = true;
  for (std::uint32_t sample_rate : kSupportedRates) {
    std::uint32_t maximum_peak = 0u;
    for (std::uint32_t transcodes = 1u; transcodes <= 3u; ++transcodes) {
      KernelHarness harness(static_cast<float>(sample_rate), 1u);
      Params params = defaultParams();
      params.transcodes = static_cast<float>(transcodes);
      harness.stage(params);
      const std::uint32_t total = harness.latency() + sample_rate / 20u;
      std::uint32_t absolute = 0u;
      std::uint32_t peak_index = 0u;
      float peak = 0.0F;
      while (absolute < total) {
        const std::uint32_t frames =
            total - absolute < kMaximumFrames ? total - absolute : kMaximumFrames;
        std::array<float, kMaximumFrames> audio{};
        if (absolute == 0u) {
          audio[0u] = 0.8F;
        }
        harness.process(audio.data(), 1u, frames);
        for (std::uint32_t frame = 0u; frame < frames; ++frame) {
          const float magnitude = audio[frame] < 0.0F ? -audio[frame] : audio[frame];
          if (magnitude > peak) {
            peak = magnitude;
            peak_index = absolute + frame;
          }
        }
        absolute += frames;
      }
      maximum_peak = peak_index > maximum_peak ? peak_index : maximum_peak;
      std::cout << "wet peak rate=" << sample_rate << " transcodes=" << transcodes
                << " sample=" << peak_index << " reported=" << harness.latency()
                << " magnitude=" << peak << '\n';
      ok &= expect(peak > 0.0001F, "wet impulse produced no measurable output");
      ok &= expect(peak_index == harness.latency(), "wet peak is not aligned with latencySamples");
    }
    std::cout << "wet peak maximum rate=" << sample_rate << " sample=" << maximum_peak << '\n';
  }
  return ok;
}

bool checkVariablePartitionsAndCascade() {
  constexpr std::uint32_t sample_rate = 96000u;
  constexpr std::size_t frames = 24000u;
  std::vector<float> input(frames);
  for (std::size_t index = 0u; index < frames; ++index) {
    input[index] =
        static_cast<float>(0.53 * std::sin(index * 0.071) + 0.21 * std::sin(index * 0.193));
  }
  bool ok = true;
  std::array<std::vector<float>, 3u> outputs{};
  for (std::uint32_t transcodes = 1u; transcodes <= 3u; ++transcodes) {
    Params params = defaultParams();
    params.transcodes = static_cast<float>(transcodes);
    outputs[transcodes - 1u] = render(static_cast<float>(sample_rate), 1u, params, input, {128u});
    const std::vector<float> irregular =
        render(static_cast<float>(sample_rate), 1u, params, input,
               {1u, 17u, 127u, 128u, 129u, 159u, 160u, 161u, 511u});
    ok &= expect(outputs[transcodes - 1u] == irregular,
                 "output depends on host quantum partitioning");
    for (float sample : outputs[transcodes - 1u]) {
      ok &= expect(std::isfinite(sample), "render contains a non-finite sample");
    }
  }
  ok &= expect(outputs[0u] != outputs[1u] && outputs[1u] != outputs[2u],
               "tandem transcodes do not produce independent cascade results");

  const auto render_invalid_transcodes = [&input](float transcodes) {
    Params params = defaultParams();
    params.transcodes = transcodes;
    return render(96000.0F, 1u, params, input, {128u});
  };
  ok &= expect(render_invalid_transcodes(std::numeric_limits<float>::quiet_NaN()) == outputs[0u],
               "NaN transcodes did not use the default single pass");
  ok &= expect(render_invalid_transcodes(std::numeric_limits<float>::infinity()) == outputs[0u],
               "positive infinite transcodes did not use the default single pass");
  ok &= expect(render_invalid_transcodes(-std::numeric_limits<float>::infinity()) == outputs[0u],
               "negative infinite transcodes did not use the default single pass");
  ok &= expect(render_invalid_transcodes(std::numeric_limits<float>::max()) == outputs[2u],
               "huge positive transcodes did not clamp to three passes");
  ok &= expect(render_invalid_transcodes(-std::numeric_limits<float>::max()) == outputs[0u],
               "huge negative transcodes did not clamp to one pass");
  return ok;
}

bool checkFrameBoundaryTranscodeSnapshot() {
  constexpr std::uint32_t sample_rate = 96000u;
  constexpr std::size_t frames = 14000u;
  std::vector<float> input(frames);
  for (std::size_t frame = 0u; frame < frames; ++frame) {
    input[frame] =
        static_cast<float>(0.31 + 0.37 * std::sin(frame * 0.043) + 0.17 * std::sin(frame * 0.179));
  }

  Params baseline_params = defaultParams();
  const std::vector<float> baseline =
      render(static_cast<float>(sample_rate), 1u, baseline_params, input, {127u, 129u});
  constexpr std::size_t first_codec_host_sample = 1u;
  constexpr std::size_t codec_sample_period = sample_rate / 8000u;
  const auto event_host_sample = [](std::size_t codec_sample) {
    return first_codec_host_sample + codec_sample * codec_sample_period;
  };
  const std::vector<float> event_at_1 =
      renderWithTranscodeEvent(static_cast<float>(sample_rate), input, event_host_sample(1u), 3.0F);
  const std::vector<float> event_at_80 = renderWithTranscodeEvent(
      static_cast<float>(sample_rate), input, event_host_sample(80u), 3.0F);
  const std::vector<float> event_at_159 = renderWithTranscodeEvent(
      static_cast<float>(sample_rate), input, event_host_sample(159u), 3.0F);
  const std::vector<float> same_padding_event = renderWithTranscodeEvent(
      static_cast<float>(sample_rate), input, event_host_sample(80u), 2.0F);

  bool ok = true;
  ok &= expect(event_at_1 == event_at_80 && event_at_80 == event_at_159,
               "mid-frame transcode changes did not share the next frame snapshot");
  constexpr std::uint32_t codec_work_stages = 6u;
  constexpr std::uint32_t total_work_stages = 14u;
  constexpr std::uint32_t maximum_work_interval = 128u;
  const std::uint32_t host_frame_samples = sample_rate / 50u;
  const std::uint32_t work_interval =
      std::min(maximum_work_interval, host_frame_samples / total_work_stages);
  const std::size_t next_frame_output = first_codec_host_sample + 2u * host_frame_samples -
                                        codec_sample_period + codec_work_stages * work_interval;
  const auto first_difference =
      std::mismatch(baseline.begin(), baseline.end(), event_at_1.begin()).first;
  std::cout << "frame-boundary first changed output sample="
            << static_cast<std::size_t>(first_difference - baseline.begin())
            << " expected-at-or-after=" << next_frame_output << '\n';
  ok &=
      expect(std::equal(baseline.begin(), baseline.begin() + next_frame_output, event_at_1.begin()),
             "transcode change altered the frame captured before the parameter event");
  ok &= expect(first_difference == baseline.begin() + next_frame_output,
               "new output alignment did not begin at the next frame output stage");
  const auto same_padding_difference =
      std::mismatch(baseline.begin(), baseline.end(), same_padding_event.begin()).first;
  std::cout << "same-padding first changed output sample="
            << static_cast<std::size_t>(same_padding_difference - baseline.begin()) << '\n';
  ok &= expect(std::equal(baseline.begin(), baseline.begin() + next_frame_output,
                          same_padding_event.begin()),
               "same-padding transition cleared the previous frame's FIFO tail");
  ok &= expect(same_padding_difference != baseline.end() &&
                   same_padding_difference > baseline.begin() + next_frame_output,
               "same-padding transition cleared the alignment buffer or cursor");
  return ok;
}

bool checkNonFiniteInputAndControls() {
  KernelHarness harness(96000.0F, 1u);
  if (!expect(harness.ready(), "non-finite-input kernel does not prepare")) {
    return false;
  }
  Params params = defaultParams();
  params.transcodes = std::numeric_limits<float>::quiet_NaN();
  params.outputGain = std::numeric_limits<float>::infinity();
  params.mix = -std::numeric_limits<float>::infinity();
  params.carrierToInterference = std::numeric_limits<float>::quiet_NaN();
  harness.stage(params);

  bool ok = true;
  for (std::uint32_t block = 0u; block < 100u; ++block) {
    std::array<float, kMaximumFrames> audio{};
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      const std::uint32_t absolute = block * kMaximumFrames + frame;
      audio[frame] = static_cast<float>(0.6 * std::sin(absolute * 0.037));
    }
    if (block == 0u) {
      audio[0u] = std::numeric_limits<float>::quiet_NaN();
      audio[1u] = std::numeric_limits<float>::infinity();
      audio[2u] = -std::numeric_limits<float>::infinity();
    }
    harness.process(audio.data(), 1u, kMaximumFrames);
    for (float sample : audio) {
      ok &= expect(std::isfinite(sample), "non-finite input or control escaped the kernel");
    }
  }
  return ok;
}

bool checkChannelsResetAndAllocation() {
  KernelHarness harness(96000.0F, 4u);
  if (!expect(harness.ready(), "four-channel kernel does not prepare")) {
    return false;
  }
  Params params = defaultParams();
  params.transcodes = 2.0F;
  harness.stage(params);
  bool ok = true;
  bool heard_wet = false;
  const std::uint32_t initial_violations = effetune::allocation_guard::violationCount();
  for (std::uint32_t block = 0u; block < 100u; ++block) {
    std::array<float, 4u * kMaximumFrames> audio{};
    std::array<float, 2u * kMaximumFrames> extra{};
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      const std::uint32_t absolute = block * kMaximumFrames + frame;
      audio[frame] = static_cast<float>(0.7 * std::sin(absolute * 0.031));
      audio[kMaximumFrames + frame] = static_cast<float>(0.4 * std::cos(absolute * 0.047));
      audio[2u * kMaximumFrames + frame] = static_cast<float>(frame) * 0.001F;
      audio[3u * kMaximumFrames + frame] = -static_cast<float>(frame) * 0.002F;
      extra[frame] = audio[2u * kMaximumFrames + frame];
      extra[kMaximumFrames + frame] = audio[3u * kMaximumFrames + frame];
    }
    harness.process(audio.data(), 4u, kMaximumFrames);
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      ok &= expect(std::isfinite(audio[frame]) && std::isfinite(audio[kMaximumFrames + frame]),
                   "processed channel contains a non-finite sample");
      ok &= expect(audio[frame] == audio[kMaximumFrames + frame],
                   "wet stereo output is not dual mono");
      ok &= expect(audio[2u * kMaximumFrames + frame] == extra[frame] &&
                       audio[3u * kMaximumFrames + frame] == extra[kMaximumFrames + frame],
                   "extra channels were modified");
      heard_wet = heard_wet || audio[frame] != 0.0F;
    }
  }
  ok &= expect(heard_wet, "wet processing remained silent");
  ok &= expect(effetune::allocation_guard::violationCount() == initial_violations,
               "kernel process allocated memory");

  const auto render_silence = [&params](KernelHarness &target) {
    std::vector<float> result(650u * kMaximumFrames, 0.0F);
    target.stage(params);
    for (std::uint32_t block = 0u; block < 650u; ++block) {
      target.process(result.data() + static_cast<std::size_t>(block) * kMaximumFrames, 1u,
                     kMaximumFrames);
    }
    return result;
  };
  harness.reset();
  const std::vector<float> after_reset = render_silence(harness);
  KernelHarness fresh(96000.0F, 4u);
  const std::vector<float> fresh_silence = render_silence(fresh);
  ok &= expect(after_reset == fresh_silence, "reset leaked pre-reset state into silence");
  const std::size_t tail_start = after_reset.size() - 96000u;
  float tail_peak = 0.0F;
  for (std::size_t index = tail_start; index < after_reset.size(); ++index) {
    const float magnitude = after_reset[index] < 0.0F ? -after_reset[index] : after_reset[index];
    tail_peak = magnitude > tail_peak ? magnitude : tail_peak;
  }
  std::cout << "three-transcode zero-input tail peak=" << tail_peak << '\n';
  ok &= expect(tail_peak < 0.002F,
               "zero-input GSM quantization residue exceeds the independent clean-codec bound");
  return ok;
}

// Radio stimulus. Both tones sit inside the 300-3400 Hz telephony band the codec is specified for,
// and both complete a whole number of periods in the 20 ms window used by the amplitude gates, so
// a window mean measured on the render reports the codec's own offset rather than the tone phase.
constexpr std::size_t kAmplitudeWindowFrames = 1920u;                // 20 ms at 96 kHz.
constexpr double kRadioToneLow = 6.283185307179586 * 30.0 / 1920.0;  // 1500 Hz.
constexpr double kRadioToneHigh = 6.283185307179586 * 44.0 / 1920.0; // 2200 Hz.

float radioStimulus(std::uint32_t absolute) {
  const double phase = static_cast<double>(absolute);
  return static_cast<float>(0.6 * std::sin(phase * kRadioToneLow) +
                            0.2 * std::sin(phase * kRadioToneHigh));
}

// Renders a fixed stimulus with an explicit seed so the radio channel is reproducible.
std::vector<float> renderSeeded(const Params &params, std::uint32_t seed_low,
                                std::uint32_t seed_high, std::uint32_t blocks) {
  KernelHarness harness(96000.0F, 1u);
  if (!harness.ready()) {
    return {};
  }
  harness.seed(seed_low, seed_high);
  harness.stage(params);
  std::vector<float> output(static_cast<std::size_t>(blocks) * kMaximumFrames, 0.0F);
  for (std::uint32_t block = 0u; block < blocks; ++block) {
    float *cursor = output.data() + static_cast<std::size_t>(block) * kMaximumFrames;
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      const std::uint32_t absolute = block * kMaximumFrames + frame;
      cursor[frame] = radioStimulus(absolute);
    }
    harness.process(cursor, 1u, kMaximumFrames);
  }
  return output;
}

// Renders the same stimulus while the carrier-to-interference ratio is switched at runtime, which
// exercises reception that recovers and then degrades again.
std::vector<float> renderCiSchedule(std::uint32_t seed_low, std::uint32_t seed_high,
                                    std::uint32_t segment_blocks) {
  KernelHarness harness(96000.0F, 1u);
  if (!harness.ready()) {
    return {};
  }
  harness.seed(seed_low, seed_high);
  constexpr std::array<float, 4u> kSchedule{30.0F, 8.0F, 30.0F, 8.0F};
  Params params = defaultParams();
  std::vector<float> output(
      static_cast<std::size_t>(kSchedule.size()) * segment_blocks * kMaximumFrames, 0.0F);
  std::uint32_t block_index = 0u;
  for (float carrier : kSchedule) {
    params.carrierToInterference = carrier;
    harness.stage(params);
    for (std::uint32_t block = 0u; block < segment_blocks; ++block, ++block_index) {
      float *cursor = output.data() + static_cast<std::size_t>(block_index) * kMaximumFrames;
      for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
        const std::uint32_t absolute = block_index * kMaximumFrames + frame;
        cursor[frame] = radioStimulus(absolute);
      }
      harness.process(cursor, 1u, kMaximumFrames);
    }
  }
  return output;
}

// Amplitude sanity for any radio render. Substituting an unpopulated frame emits a sustained DC
// step rather than a wild transient, so a peak bound alone cannot see it: the mean over 20 ms
// windows is the gate that catches it. Measured on this stimulus: the largest legitimate window
// mean is 0.0176 FS (the start-up transient of the resampler and the codec de-emphasis) and normal
// erasure concealment contributes up to 0.0107 FS, while substituting the all-zero placeholder
// frame takes the worst window to 0.0479 FS. The 0.03 FS gate sits between the two; the codec
// level assertion in native_test.cpp measures the same defect undiluted by the resampler.
bool checkAmplitudeGates(const std::vector<float> &render, const char *label) {
  double peak = 0.0;
  double worst_mean = 0.0;
  double window_sum = 0.0;
  std::size_t window_count = 0u;
  const auto close_window = [&]() {
    if (window_count == 0u) {
      return;
    }
    const double mean = window_sum / static_cast<double>(window_count);
    const double magnitude = mean < 0.0 ? -mean : mean;
    worst_mean = magnitude > worst_mean ? magnitude : worst_mean;
    window_sum = 0.0;
    window_count = 0u;
  };
  for (float value : render) {
    const double sample = static_cast<double>(value);
    const double magnitude = sample < 0.0 ? -sample : sample;
    peak = magnitude > peak ? magnitude : peak;
    window_sum += sample;
    if (++window_count == kAmplitudeWindowFrames) {
      close_window();
    }
  }
  close_window();
  std::cout << "amplitude gate " << label << " peak=" << peak
            << " worst 20 ms block mean=" << worst_mean << '\n';
  bool ok = true;
  ok &= expect(peak <= 1.5, (std::string(label) + " exceeded the 1.5 FS peak gate").c_str());
  ok &= expect(
      worst_mean <= 0.03,
      (std::string(label) + " exceeded the 0.03 FS 20 ms block mean gate (a concealment DC offset)")
          .c_str());
  return ok;
}

bool checkRadioChannel() {
  bool ok = true;
  // 600 blocks of 511 frames at 96 kHz is roughly 3.2 s, i.e. about 160 speech frames.
  constexpr std::uint32_t kBlocks = 600u;

  Params clean = defaultParams();
  const std::vector<float> clean_seed_a = renderSeeded(clean, 1u, 0u, kBlocks);
  const std::vector<float> clean_seed_b = renderSeeded(clean, 0x9e3779b9u, 0x7f4a7c15u, kBlocks);
  ok &= expect(!clean_seed_a.empty(), "clean radio render did not prepare");
  // The default C/I must short-circuit the whole impairment path, so the seed cannot matter.
  ok &= expect(clean_seed_a == clean_seed_b,
               "default carrier-to-interference is not seed independent");

  Params marginal = defaultParams();
  marginal.carrierToInterference = 12.0F;
  const std::uint32_t initial_violations = effetune::allocation_guard::violationCount();
  const std::vector<float> marginal_a = renderSeeded(marginal, 1u, 0u, kBlocks);
  ok &= expect(effetune::allocation_guard::violationCount() == initial_violations,
               "the degraded radio path allocated memory");
  const std::vector<float> marginal_repeat = renderSeeded(marginal, 1u, 0u, kBlocks);
  const std::vector<float> marginal_other = renderSeeded(marginal, 12345u, 6789u, kBlocks);
  ok &= expect(marginal_a == marginal_repeat, "degraded radio render is not deterministic");
  ok &= expect(marginal_a != marginal_other, "degraded radio render ignores the seed");
  ok &= expect(marginal_a != clean_seed_a, "degraded radio render matches the clean render");

  bool finite = true;
  bool bounded = true;
  for (float sample : marginal_a) {
    finite = finite && std::isfinite(sample);
    bounded = bounded && sample <= 4.0F && sample >= -4.0F;
  }
  ok &= expect(finite, "degraded radio render produced a non-finite sample");
  ok &= expect(bounded, "degraded radio render produced an implausible magnitude");
  ok &= checkAmplitudeGates(clean_seed_a, "clean radio render");
  ok &= checkAmplitudeGates(marginal_a, "degraded radio render");

  // Worst case reception must stay stable rather than diverge, and must audibly differ.
  Params worst = defaultParams();
  worst.carrierToInterference = 4.0F;
  const std::vector<float> worst_render = renderSeeded(worst, 1u, 0u, kBlocks);
  bool worst_finite = true;
  for (float sample : worst_render) {
    worst_finite = worst_finite && std::isfinite(sample) && sample <= 4.0F && sample >= -4.0F;
  }
  ok &= expect(worst_finite, "worst-case reception diverged");
  ok &= expect(worst_render != marginal_a, "worst-case reception matches marginal reception");
  ok &= checkAmplitudeGates(worst_render, "worst-case radio render");

  // Runtime C/I transitions (30 -> 8 -> 30 -> 8) exercise reception that recovers and degrades
  // again. What is asserted here is only reproducibility and seed dependence of the final degraded
  // segment, plus the amplitude gates across the whole schedule; whether a burst that was in
  // flight stays latched across the clean stretch is decided by golden case-012, not here.
  constexpr std::uint32_t kScheduleBlocks = 150u;
  const std::vector<float> schedule_a = renderCiSchedule(1u, 0u, kScheduleBlocks);
  const std::vector<float> schedule_repeat = renderCiSchedule(1u, 0u, kScheduleBlocks);
  const std::vector<float> schedule_other = renderCiSchedule(12345u, 6789u, kScheduleBlocks);
  const std::size_t resumed_offset =
      3u * static_cast<std::size_t>(kScheduleBlocks) * kMaximumFrames;
  ok &= expect(!schedule_a.empty() && schedule_a == schedule_repeat &&
                   schedule_a.size() == schedule_other.size() &&
                   !std::equal(schedule_a.begin() + resumed_offset, schedule_a.end(),
                               schedule_other.begin() + resumed_offset),
               "runtime carrier-to-interference transitions do not restart the erasure process");
  ok &= checkAmplitudeGates(schedule_a, "carrier-to-interference schedule render");

  // Latency is a published contract and must not move with the new parameter.
  KernelHarness reference(96000.0F, 2u);
  KernelHarness degraded(96000.0F, 2u);
  if (reference.ready() && degraded.ready()) {
    degraded.stage(worst);
    ok &= expect(reference.latency() == degraded.latency(),
                 "carrier-to-interference changed the reported latency");
  } else {
    ok &= expect(false, "latency comparison kernels did not prepare");
  }
  return ok;
}

} // namespace

int main() {
  effetune::allocation_guard::setAbortOnViolationForTesting(false);
  bool ok = true;
  ok &= checkRateAndDryContracts();
  ok &= measureWetLatency();
  ok &= checkVariablePartitionsAndCascade();
  ok &= checkFrameBoundaryTranscodeSnapshot();
  ok &= checkNonFiniteInputAndControls();
  ok &= checkChannelsResetAndAllocation();
  ok &= checkRadioChannel();
  if (!ok) {
    return 1;
  }
  std::cout << "GSM-FR kernel realtime tests passed\n";
  return 0;
}

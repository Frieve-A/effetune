#include "BluetoothSBCSimulatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <numbers>
#include <string_view>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_BluetoothSBCSimulatorPlugin() noexcept;
extern "C" std::uint32_t et_test_bluetooth_sbc_runtime_stat(effetune::PluginKernel *kernel,
                                                            std::uint32_t index) noexcept;

namespace {

using Params = effetune::generated::BluetoothSBCSimulatorPluginParams;

constexpr std::uint32_t kMaximumFrames = 257u;
constexpr std::size_t kKernelStorageBytes = 32768u;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Bluetooth SBC Simulator check failed: %s\n", message);
    ++failures;
  }
}

Params defaultParams() noexcept { return {35.0F, 0.0F, 3.0F, 0.0F, 100.0F, 0.0F}; }

std::uint32_t rateFactor(std::uint32_t rate) noexcept {
  return rate >= 352800u ? 8u : (rate >= 176400u ? 4u : (rate >= 88200u ? 2u : 1u));
}

class KernelHarness final {
public:
  KernelHarness(float sample_rate, std::uint32_t channels) {
    descriptor_ = et_kernel_descriptor_BluetoothSBCSimulatorPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr) {
      return;
    }
    check(descriptor_->objectSize <= storage_.size(), "kernel fits test storage");
    check(descriptor_->paramsHash == Params::kHash, "descriptor hash matches");
    if (descriptor_->objectSize > storage_.size()) {
      return;
    }
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      kernel_->prepare({sample_rate, channels, kMaximumFrames});
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
    const et_status status =
        kernel_->stageParameters(&params.bitpool, Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    kernel_->applyPendingParameters();
    const std::uint32_t violations = effetune::allocation_guard::violationCount();
    {
      effetune::allocation_guard::Scope allocation_scope;
      kernel_->process(audio, channels, frames, {0.0});
    }
    check(effetune::allocation_guard::violationCount() == violations,
          "process performs no allocation");
  }

  [[nodiscard]] double processMicros(float *audio, std::uint32_t channels,
                                     std::uint32_t frames) noexcept {
    kernel_->applyPendingParameters();
    const auto start = std::chrono::steady_clock::now();
    kernel_->process(audio, channels, frames, {0.0});
    const auto finish = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::micro>(finish - start).count();
  }

  void reset() noexcept { kernel_->reset(); }

  void seed(std::uint32_t low, std::uint32_t high) noexcept { kernel_->setRandomSeed(low, high); }

  [[nodiscard]] std::uint32_t runtimeStat(std::uint32_t index) const noexcept {
    return et_test_bluetooth_sbc_runtime_stat(kernel_, index);
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

bool finite(const std::vector<float> &audio) noexcept {
  for (const float sample : audio) {
    if (!std::isfinite(sample)) {
      return false;
    }
  }
  return true;
}

struct RuntimeStats {
  std::uint32_t maximum_queued_frames = 0u;
  std::uint32_t maximum_raw_output = 0u;
  std::uint32_t raw_output_drops = 0u;
};

double profilePercentile(const std::vector<double> &sorted, double fraction) noexcept {
  const double position = std::ceil(fraction * static_cast<double>(sorted.size())) - 1.0;
  const std::size_t index = static_cast<std::size_t>(position > 0.0 ? position : 0.0);
  return sorted[index < sorted.size() ? index : sorted.size() - 1u];
}

void profileUniformity() {
  constexpr std::uint32_t kFrames = 16u;
  constexpr std::uint32_t kMeasuredBlocks = 4096u;
  for (const float sample_rate : {48000.0F, 96000.0F, 192000.0F}) {
    KernelHarness harness(sample_rate, 2u);
    Params params = defaultParams();
    params.bitpool = 53.0F;
    harness.stage(params);
    std::array<float, 2u * kFrames> audio{};
    std::uint32_t noise = 0x1729ac5du;
    const auto fill = [&]() {
      for (float &sample : audio) {
        noise = noise * 1664525u + 1013904223u;
        sample = static_cast<float>((static_cast<double>(noise) / 4294967296.0 - 0.5) * 0.5);
      }
    };
    const std::uint32_t warmup_blocks = static_cast<std::uint32_t>(sample_rate) / kFrames;
    for (std::uint32_t block = 0u; block < warmup_blocks; ++block) {
      fill();
      static_cast<void>(harness.processMicros(audio.data(), 2u, kFrames));
    }
    std::vector<double> samples;
    samples.reserve(kMeasuredBlocks);
    for (std::uint32_t block = 0u; block < kMeasuredBlocks; ++block) {
      fill();
      samples.push_back(harness.processMicros(audio.data(), 2u, kFrames));
    }
    std::sort(samples.begin(), samples.end());
    const double median = profilePercentile(samples, 0.5);
    const double p95 = profilePercentile(samples, 0.95);
    const double maximum = samples.back();
    const double g0_limit = 0.1 * 1.0e6 * kFrames / static_cast<double>(sample_rate);
    const bool g0 = maximum <= g0_limit;
    const bool g1 = p95 <= median * 1.5 && maximum <= median * 3.0;
    std::printf("SBC profile %.0f Hz: median %.3f us, p95 %.3f us, max %.3f us, "
                "G0 %s (%.3f us), G1 %s\n",
                static_cast<double>(sample_rate), median, p95, maximum, g0 ? "PASS" : "FAIL",
                g0_limit, g1 ? "PASS" : "FAIL");
  }
}

std::vector<float> render(KernelHarness &harness, Params params, std::uint32_t channels,
                          std::uint32_t frames) {
  std::vector<float> result(static_cast<std::size_t>(channels) * frames);
  std::uint32_t absolute = 0u;
  while (absolute < frames) {
    const std::uint32_t count =
        frames - absolute < kMaximumFrames ? frames - absolute : kMaximumFrames;
    std::vector<float> block(static_cast<std::size_t>(channels) * count);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        const double phase = static_cast<double>(absolute + frame) * 0.071 + channel * 0.31;
        block[channel * count + frame] =
            static_cast<float>(0.57 * std::sin(phase) + 0.19 * std::cos(phase * 0.37));
      }
    }
    harness.stage(params);
    harness.process(block.data(), channels, count);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        result[channel * frames + absolute + frame] = block[channel * count + frame];
      }
    }
    absolute += count;
  }
  return result;
}

std::vector<float> renderPartitioned(float sample_rate, Params params,
                                     const std::vector<std::uint32_t> &partition,
                                     std::uint32_t frames,
                                     std::uint32_t block_transition_period = 0u,
                                     RuntimeStats *stats = nullptr) {
  KernelHarness harness(sample_rate, 2u);
  harness.seed(0x2ec5a4d1u, 0x91b8f063u);
  std::vector<float> result(2u * frames);
  std::uint32_t absolute = 0u;
  std::size_t partition_index = 0u;
  while (absolute < frames) {
    std::uint32_t count = partition[partition_index % partition.size()];
    if (count > frames - absolute) {
      count = frames - absolute;
    }
    if (block_transition_period != 0u) {
      const std::uint32_t next_transition =
          (absolute / block_transition_period + 1u) * block_transition_period;
      if (count > next_transition - absolute) {
        count = next_transition - absolute;
      }
    }
    std::vector<float> block(2u * count);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        const double phase = static_cast<double>(absolute + frame) * 0.071 + channel * 0.31;
        block[channel * count + frame] =
            static_cast<float>(0.57 * std::sin(phase) + 0.19 * std::cos(phase * 0.37));
      }
    }
    Params active_params = params;
    if (block_transition_period != 0u) {
      active_params.blocks = (absolute / block_transition_period) % 2u == 0u ? 3.0F : 0.0F;
    }
    harness.stage(active_params);
    harness.process(block.data(), 2u, count);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        result[channel * frames + absolute + frame] = block[channel * count + frame];
      }
    }
    absolute += count;
    ++partition_index;
  }
  if (stats != nullptr) {
    stats->maximum_queued_frames = harness.runtimeStat(0u);
    stats->maximum_raw_output = harness.runtimeStat(1u);
    stats->raw_output_drops = harness.runtimeStat(2u);
  }
  return result;
}

double renderToneRms(float sample_rate, double frequency) {
  KernelHarness harness(sample_rate, 2u);
  Params params = defaultParams();
  params.bitpool = 53.0F;
  params.channelMode = 1.0F;
  const std::uint32_t factor = rateFactor(static_cast<std::uint32_t>(sample_rate));
  const std::uint32_t settle = harness.latency() + 512u * factor;
  const std::uint32_t total = settle + static_cast<std::uint32_t>(sample_rate * 0.05F);
  double squared = 0.0;
  std::uint32_t measured = 0u;
  std::uint32_t absolute = 0u;
  while (absolute < total) {
    const std::uint32_t frames =
        total - absolute < kMaximumFrames ? total - absolute : kMaximumFrames;
    std::vector<float> audio(2u * frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double phase = 2.0 * std::numbers::pi_v<double> * frequency *
                           static_cast<double>(absolute + frame) / static_cast<double>(sample_rate);
      audio[frame] = static_cast<float>(0.5 * std::sin(phase));
      audio[frames + frame] = audio[frame];
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      if (absolute + frame >= settle) {
        squared += static_cast<double>(audio[frame]) * audio[frame];
        ++measured;
      }
    }
    absolute += frames;
  }
  return measured == 0u ? 0.0 : std::sqrt(squared / measured);
}

void testSupportedRatesAndDryLatency() {
  for (const float sample_rate :
       {44100.0F, 48000.0F, 88200.0F, 96000.0F, 176400.0F, 192000.0F, 352800.0F, 384000.0F}) {
    KernelHarness harness(sample_rate, 2u);
    check(harness.ready(), "supported host rate prepares");
    if (!harness.ready()) {
      continue;
    }
    const std::uint32_t rate = static_cast<std::uint32_t>(sample_rate);
    const std::uint32_t factor = rateFactor(rate);
    const std::uint32_t latency = harness.latency();
    check(latency == 320u * factor, "latency follows the integer host-rate factor");
    Params dry = defaultParams();
    dry.mix = 0.0F;
    std::uint32_t absolute = 0u;
    bool impulse_found = false;
    while (absolute <= latency + kMaximumFrames) {
      std::array<float, 2u * kMaximumFrames> audio{};
      if (absolute == 0u) {
        audio[0u] = 1.0F;
        audio[kMaximumFrames] = -1.0F;
      }
      harness.stage(dry);
      harness.process(audio.data(), 2u, kMaximumFrames);
      for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
        const std::uint32_t index = absolute + frame;
        if (index == latency) {
          impulse_found = audio[frame] == 1.0F && audio[kMaximumFrames + frame] == -1.0F;
        } else if (index < latency) {
          check(audio[frame] == 0.0F && audio[kMaximumFrames + frame] == 0.0F,
                "dry path remains silent before declared latency");
        }
      }
      absolute += kMaximumFrames;
    }
    check(impulse_found, "dry impulse appears at declared latency");
  }
}

void testWetProcessingAndReset() {
  KernelHarness harness(96000.0F, 2u);
  const Params params = defaultParams();
  const std::vector<float> first = render(harness, params, 2u, 4097u);
  harness.reset();
  const std::vector<float> replay = render(harness, params, 2u, 4097u);
  check(first == replay, "reset reproduces the codec stream exactly");
  check(finite(first), "wet output remains finite");
  double energy = 0.0;
  for (const float sample : first) {
    energy += static_cast<double>(sample) * sample;
  }
  check(energy > 0.01, "wet codec output is not silent");
}

void testProcessBoundaryIndependence() {
  constexpr std::uint32_t kFrames = 8193u;
  constexpr std::array<std::uint32_t, 7> kPartitionSizes = {{1u, 7u, 16u, 32u, 64u, 128u, 129u}};
  const std::vector<std::uint32_t> reference_partition = {257u};
  const std::vector<std::uint32_t> varying_partition(kPartitionSizes.begin(),
                                                     kPartitionSizes.end());
  for (const float sample_rate : {48000.0F, 96000.0F, 192000.0F}) {
    for (const float packet_loss : {0.0F, 20.0F}) {
      Params params = defaultParams();
      params.bitpool = 53.0F;
      params.packetLoss = packet_loss;
      const std::vector<float> reference =
          renderPartitioned(sample_rate, params, reference_partition, kFrames);
      for (const std::uint32_t partition_size : kPartitionSizes) {
        const std::vector<float> candidate =
            renderPartitioned(sample_rate, params, {partition_size}, kFrames);
        if (candidate != reference) {
          std::fprintf(
              stderr, "process partition changed output at %.0f Hz, packet loss %.0f, frames %u\n",
              static_cast<double>(sample_rate), static_cast<double>(packet_loss), partition_size);
        }
        check(candidate == reference, "process boundaries leave output bit-exact");
      }
      const std::vector<float> varying =
          renderPartitioned(sample_rate, params, varying_partition, kFrames);
      check(varying == reference, "changing process boundaries leave output bit-exact");
    }
  }

  for (const float sample_rate : {48000.0F, 96000.0F, 192000.0F}) {
    const std::uint32_t factor = rateFactor(static_cast<std::uint32_t>(sample_rate));
    const std::uint32_t transition_period = 313u * factor;
    for (const float packet_loss : {0.0F, 20.0F}) {
      Params changing_blocks = defaultParams();
      changing_blocks.bitpool = 53.0F;
      changing_blocks.packetLoss = packet_loss;
      RuntimeStats reference_stats;
      RuntimeStats fixed_stats;
      RuntimeStats varying_stats;
      const std::vector<float> transition_reference =
          renderPartitioned(sample_rate, changing_blocks, reference_partition, kFrames,
                            transition_period, &reference_stats);
      const std::vector<float> transition_fixed = renderPartitioned(
          sample_rate, changing_blocks, {16u}, kFrames, transition_period, &fixed_stats);
      const std::vector<float> transition_varying =
          renderPartitioned(sample_rate, changing_blocks, varying_partition, kFrames,
                            transition_period, &varying_stats);
      check(transition_fixed == transition_reference,
            "repeated sixteen-to-four transitions stay exact with fixed process frames");
      check(transition_varying == transition_reference,
            "repeated sixteen-to-four transitions stay exact with mixed process frames");
      for (const RuntimeStats stats : {reference_stats, fixed_stats, varying_stats}) {
        check(stats.maximum_queued_frames <= 4u,
              "the scheduled frame queue stays within its four-frame bound");
        check(stats.maximum_raw_output <= 8u * factor,
              "paced synthesis keeps the raw-output queue within one subband block");
        check(stats.raw_output_drops == 0u,
              "repeated block transitions never drop raw codec output");
      }
    }
  }
}

void checkWetLatency(float sample_rate, float block_index, float mix) {
  KernelHarness harness(sample_rate, 2u);
  const std::uint32_t latency = harness.latency();
  const std::uint32_t total_frames = latency + 1024u;
  std::uint32_t absolute = 0u;
  std::uint32_t peak_frame = 0u;
  double peak = 0.0;
  while (absolute < total_frames) {
    const std::uint32_t frames =
        total_frames - absolute < kMaximumFrames ? total_frames - absolute : kMaximumFrames;
    std::vector<float> audio(2u * frames, 0.0F);
    if (absolute == 0u) {
      audio[0u] = 1.0F;
      audio[frames] = -1.0F;
    }
    Params params = defaultParams();
    params.blocks = block_index;
    params.mix = mix;
    harness.stage(params);
    harness.process(audio.data(), 2u, frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double magnitude = std::abs(static_cast<double>(audio[frame]));
      if (magnitude > peak) {
        peak = magnitude;
        peak_frame = absolute + frame;
      }
    }
    absolute += frames;
  }
  // The declared latency is the exact sum of the queue, PQMF and resampler delays, so the wet
  // impulse peak must land on it sample-exactly; any drift is an off-by-one in that accounting.
  const std::int64_t offset =
      static_cast<std::int64_t>(peak_frame) - static_cast<std::int64_t>(latency);
  if (offset != 0) {
    std::fprintf(stderr,
                 "wet peak %u, declared latency %u, offset %+lld samples at %.0f Hz "
                 "(blocks %.0f, mix %.0f)\n",
                 peak_frame, latency, static_cast<long long>(offset),
                 static_cast<double>(sample_rate), static_cast<double>(block_index),
                 static_cast<double>(mix));
  }
  check(peak > 0.0, "wet impulse response is not silent");
  check(offset == 0, "wet and dry paths align sample-exactly");
}

void testWetLatencyAlignment() {
  for (const float sample_rate :
       {44100.0F, 48000.0F, 88200.0F, 96000.0F, 176400.0F, 192000.0F, 352800.0F, 384000.0F}) {
    for (const float block_index : {0.0F, 1.0F, 2.0F, 3.0F}) {
      checkWetLatency(sample_rate, block_index, 100.0F);
    }
    checkWetLatency(sample_rate, 3.0F, 50.0F);
  }
}

void testLatencyAcrossRepeatedBlockTransitions() {
  constexpr std::array<std::uint32_t, 7> kPartitions = {{1u, 7u, 16u, 32u, 64u, 128u, 129u}};
  for (const float sample_rate : {48000.0F, 96000.0F, 192000.0F}) {
    KernelHarness harness(sample_rate, 2u);
    const std::uint32_t factor = rateFactor(static_cast<std::uint32_t>(sample_rate));
    const std::uint32_t transition_period = 313u * factor;
    const std::uint32_t impulse_frame = 4099u * factor;
    const std::uint32_t total_frames = impulse_frame + harness.latency() + 1024u * factor;
    std::uint32_t absolute = 0u;
    std::size_t partition_index = 0u;
    std::uint32_t peak_frame = 0u;
    double peak = 0.0;
    while (absolute < total_frames) {
      std::uint32_t frames = kPartitions[partition_index % kPartitions.size()];
      if (frames > total_frames - absolute) {
        frames = total_frames - absolute;
      }
      const std::uint32_t next_transition = (absolute / transition_period + 1u) * transition_period;
      if (frames > next_transition - absolute) {
        frames = next_transition - absolute;
      }
      std::vector<float> audio(2u * frames, 0.0F);
      if (absolute <= impulse_frame && impulse_frame < absolute + frames) {
        const std::uint32_t local = impulse_frame - absolute;
        audio[local] = 1.0F;
        audio[frames + local] = -1.0F;
      }
      Params params = defaultParams();
      params.bitpool = 53.0F;
      params.blocks = (absolute / transition_period) % 2u == 0u ? 3.0F : 0.0F;
      harness.stage(params);
      harness.process(audio.data(), 2u, frames);
      for (std::uint32_t frame = 0u; frame < frames; ++frame) {
        const double magnitude = std::abs(static_cast<double>(audio[frame]));
        if (magnitude > peak) {
          peak = magnitude;
          peak_frame = absolute + frame;
        }
      }
      absolute += frames;
      ++partition_index;
    }
    const std::uint32_t expected = impulse_frame + harness.latency();
    if (peak_frame != expected) {
      std::fprintf(stderr, "transition impulse peak %u, expected %u at %.0f Hz (offset %+lld)\n",
                   peak_frame, expected, static_cast<double>(sample_rate),
                   static_cast<long long>(peak_frame) - static_cast<long long>(expected));
    }
    check(peak > 0.0, "the transition impulse response is not silent");
    check(peak_frame == expected,
          "repeated sixteen-to-four transitions preserve declared wet latency");
    check(harness.runtimeStat(2u) == 0u,
          "the latency transition stream never drops raw codec output");
  }
}

void testResamplerBandLimit() {
  constexpr std::array<double, 3> passband_tones = {{15000.0, 18000.0, 20000.0}};
  std::array<double, 3> reference_44100{};
  std::array<double, 3> reference_48000{};
  for (std::size_t index = 0u; index < passband_tones.size(); ++index) {
    reference_44100[index] = renderToneRms(44100.0F, passband_tones[index]);
    reference_48000[index] = renderToneRms(48000.0F, passband_tones[index]);
    check(reference_44100[index] > 1.0e-4 && reference_48000[index] > 1.0e-4,
          "direct codec-rate passband tone remains audible");
  }
  const double folded_reference_44100 = renderToneRms(44100.0F, 19050.0);
  const double folded_reference_48000 = renderToneRms(48000.0F, 18000.0);

  for (const float sample_rate :
       {44100.0F, 48000.0F, 88200.0F, 96000.0F, 176400.0F, 192000.0F, 352800.0F, 384000.0F}) {
    const bool family_44100 = static_cast<std::uint32_t>(sample_rate) % 44100u == 0u;
    const auto &reference = family_44100 ? reference_44100 : reference_48000;
    for (std::size_t index = 0u; index < passband_tones.size(); ++index) {
      const double measured = renderToneRms(sample_rate, passband_tones[index]);
      const double ratio = measured / reference[index];
      check(ratio > 0.75 && ratio < 1.25,
            "halfband cascade preserves the codec-rate passband response");
    }
    if (rateFactor(static_cast<std::uint32_t>(sample_rate)) == 1u) {
      continue;
    }
    const double out_of_band = family_44100 ? 25050.0 : 30000.0;
    const double folded_reference = family_44100 ? folded_reference_44100 : folded_reference_48000;
    const double alias = renderToneRms(sample_rate, out_of_band);
    check(alias < folded_reference * 0.02,
          "halfband cascade suppresses a codec-Nyquist folding tone");
  }
}

void testMonoAndExtraChannels() {
  KernelHarness mono(48000.0F, 1u);
  const std::vector<float> mono_output = render(mono, defaultParams(), 1u, 2049u);
  check(finite(mono_output), "mono codec output remains finite");

  KernelHarness multichannel(48000.0F, 4u);
  constexpr std::uint32_t frames = 193u;
  std::array<float, 4u * frames> audio{};
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    audio[2u * frames + frame] = static_cast<float>(frame) * 0.001F;
    audio[3u * frames + frame] = -static_cast<float>(frame) * 0.002F;
  }
  const auto original = audio;
  multichannel.stage(defaultParams());
  multichannel.process(audio.data(), 4u, frames);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    check(audio[2u * frames + frame] == original[2u * frames + frame] &&
              audio[3u * frames + frame] == original[3u * frames + frame],
          "channels outside the selected stereo pair remain unchanged");
  }
}

// Quantization error against the latency-aligned dry path, which the mix control exposes exactly.
double codecErrorEnergy(float sample_rate, std::uint32_t channels, float channel_mode,
                        float bitpool) {
  Params wet = defaultParams();
  wet.channelMode = channel_mode;
  wet.bitpool = bitpool;
  Params dry = wet;
  dry.mix = 0.0F;
  KernelHarness wet_harness(sample_rate, channels);
  KernelHarness dry_harness(sample_rate, channels);
  const std::vector<float> wet_output = render(wet_harness, wet, channels, 8193u);
  const std::vector<float> dry_output = render(dry_harness, dry, channels, 8193u);
  double total = 0.0;
  for (std::size_t index = 0u; index < wet_output.size(); ++index) {
    const double difference = static_cast<double>(wet_output[index]) - dry_output[index];
    total += difference * difference;
  }
  return total;
}

// Dual Channel is the SBC XQ configuration. Joint Stereo and Stereo share one bitpool across the
// pair, while Dual Channel runs the mono allocator once per channel at the full bitpool, so the
// same bitpool buys roughly one extra bit per subband per channel and a far quieter error floor.
void testDualChannelAllocatesPerChannel() {
  const double stereo = codecErrorEnergy(48000.0F, 2u, 1.0F, 38.0F);
  const double dual = codecErrorEnergy(48000.0F, 2u, 2.0F, 38.0F);
  check(stereo > 0.0 && dual > 0.0, "both stereo channel modes quantize the signal");
  if (!(dual < stereo * 0.5)) {
    std::fprintf(stderr, "dual error %.6e, stereo error %.6e, ratio %.3f\n", dual, stereo,
                 stereo > 0.0 ? dual / stereo : 0.0);
  }
  check(dual < stereo * 0.5, "Dual Channel quantizes far finer than Stereo at the same bitpool");

  // The out-of-range guard clamps to the last enum entry rather than wrapping to Joint Stereo.
  check(codecErrorEnergy(48000.0F, 2u, 7.0F, 38.0F) == dual,
        "channel modes above the enum clamp to Dual Channel");

  // A mono stream has no second channel to allocate independently, so the mode cannot matter.
  check(codecErrorEnergy(48000.0F, 1u, 2.0F, 38.0F) == codecErrorEnergy(48000.0F, 1u, 0.0F, 38.0F),
        "mono ignores the channel mode");

  Params dual_params = defaultParams();
  dual_params.channelMode = 2.0F;
  dual_params.bitpool = 47.0F;
  KernelHarness harness(44100.0F, 2u);
  const std::vector<float> first = render(harness, dual_params, 2u, 4097u);
  harness.reset();
  const std::vector<float> replay = render(harness, dual_params, 2u, 4097u);
  check(finite(first), "Dual Channel output remains finite");
  check(first == replay, "reset reproduces the Dual Channel stream exactly");
}

double energy(const std::vector<float> &audio) noexcept {
  double total = 0.0;
  for (const float sample : audio) {
    total += static_cast<double>(sample) * sample;
  }
  return total;
}

// The packet-loss default must short-circuit the link model completely: no random draw may be
// consumed, so the seed cannot influence the rendered stream in any way.
void testPacketLossDefaultIsClean() {
  Params clean = defaultParams();
  KernelHarness first(48000.0F, 2u);
  first.seed(0x11111111u, 0x22222222u);
  const std::vector<float> reference = render(first, clean, 2u, 16385u);

  KernelHarness second(48000.0F, 2u);
  second.seed(0xdeadbeefu, 0x0badf00du);
  const std::vector<float> alternate = render(second, clean, 2u, 16385u);
  check(reference == alternate, "default packet loss ignores the random seed entirely");

  KernelHarness third(48000.0F, 2u);
  third.seed(0x11111111u, 0x22222222u);
  Params explicit_zero = defaultParams();
  explicit_zero.packetLoss = 0.0F;
  check(render(third, explicit_zero, 2u, 16385u) == reference,
        "an explicit zero packet loss matches the clean round trip");
  check(first.latency() == third.latency(), "packet loss leaves the declared latency unchanged");
}

void testPacketLossDegradesDeterministically() {
  Params lossy = defaultParams();
  lossy.packetLoss = 10.0F;
  KernelHarness harness(48000.0F, 2u);
  harness.seed(0x2b3c4d5eu, 0u);
  const std::vector<float> lost = render(harness, lossy, 2u, 16385u);
  harness.reset();
  const std::vector<float> replay = render(harness, lossy, 2u, 16385u);
  check(lost == replay, "reset restores the seed and replays the same loss pattern");
  check(finite(lost), "packet-loss output remains finite");

  KernelHarness other(48000.0F, 2u);
  other.seed(0x7f0e1d2cu, 0u);
  const std::vector<float> different = render(other, lossy, 2u, 16385u);
  check(different != lost, "a different seed draws a different loss pattern");
  check(finite(different), "a different loss pattern remains finite");

  KernelHarness clean_harness(48000.0F, 2u);
  clean_harness.seed(0x2b3c4d5eu, 0u);
  const std::vector<float> clean = render(clean_harness, defaultParams(), 2u, 16385u);
  check(lost != clean, "a ten percent link actually drops frames");
  const double lost_energy = energy(lost);
  const double clean_energy = energy(clean);
  check(lost_energy > clean_energy * 0.05,
        "concealment keeps the stream playing through the outages");
  check(lost_energy < clean_energy,
        "concealment fades the repeated frame instead of adding energy");
  check(harness.latency() == clean_harness.latency(),
        "the concealment path preserves the frame timing");
}

void testPacketLossExtremesAndMono() {
  Params extreme = defaultParams();
  extreme.packetLoss = 20.0F;
  KernelHarness mono(44100.0F, 1u);
  mono.seed(0x5150u, 0u);
  const std::vector<float> mono_output = render(mono, extreme, 1u, 16385u);
  check(finite(mono_output), "mono link outages stay finite at the maximum loss");
  check(energy(mono_output) > 0.0, "mono link outages do not mute the stream permanently");

  Params negative = defaultParams();
  negative.packetLoss = -5.0F;
  KernelHarness guarded(48000.0F, 2u);
  guarded.seed(0x11111111u, 0x22222222u);
  KernelHarness reference_harness(48000.0F, 2u);
  reference_harness.seed(0x11111111u, 0x22222222u);
  check(render(guarded, negative, 2u, 8193u) ==
            render(reference_harness, defaultParams(), 2u, 8193u),
        "an out-of-range negative loss falls back to the clean round trip");
}

// Loss-rate measurement rig. At 48 kHz with sixteen blocks an SBC frame is exactly 128 samples, so
// a 3 kHz tone (eight cycles per frame) makes every encoded frame identical once the codec has
// settled. The synthesis window spans ten blocks, so the samples of blocks nine to fifteen depend
// only on blocks of their own frame: within that region a received frame reproduces the periodic
// reference exactly, while a concealed frame reproduces it scaled by a gain of at most 0.6875. That
// makes the per-frame received/lost decision exact instead of statistical.
constexpr std::uint32_t kLossFrameSamples = 128u;
constexpr std::uint32_t kLossBlockSamples = 256u;
constexpr std::uint32_t kLossSettleFrames = 64u;
constexpr std::uint32_t kLossWindowSamples = 8u;

// The tone repeats exactly every sixteen samples, so every codec frame carries an identical
// waveform and the clean reference is bit-exact from frame to frame.
float toneSample(std::uint32_t index) noexcept {
  const double phase = 2.0 * std::numbers::pi_v<double> * static_cast<double>(index % 16u) / 16.0;
  return static_cast<float>(0.5 * std::sin(phase));
}

std::vector<float> renderLossTone(float packet_loss, std::uint32_t samples, float blocks = 3.0F) {
  KernelHarness harness(48000.0F, 1u);
  harness.seed(0x6d2f91a3u, 0u);
  Params params = defaultParams();
  params.bitpool = 53.0F;
  params.blocks = blocks;
  params.packetLoss = packet_loss;
  std::vector<float> result(samples, 0.0F);
  std::vector<float> block(kLossBlockSamples, 0.0F);
  std::uint32_t absolute = 0u;
  while (absolute < samples) {
    const std::uint32_t count =
        samples - absolute < kLossBlockSamples ? samples - absolute : kLossBlockSamples;
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      block[frame] = toneSample(absolute + frame);
    }
    harness.stage(params);
    harness.process(block.data(), 1u, count);
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      result[absolute + frame] = block[frame];
    }
    absolute += count;
  }
  return result;
}

double windowRms(const std::vector<float> &audio, std::size_t start) noexcept {
  double squared = 0.0;
  for (std::uint32_t index = 0u; index < kLossWindowSamples; ++index) {
    const double sample = static_cast<double>(audio[start + index]);
    squared += sample * sample;
  }
  return std::sqrt(squared / static_cast<double>(kLossWindowSamples));
}

struct LossStatistics {
  bool aligned = false;
  double loss_ratio = 0.0;
  double mean_burst = 0.0;
};

LossStatistics measureFrameLoss(const std::vector<float> &clean, const std::vector<float> &lossy,
                                std::uint32_t frames_measured) {
  LossStatistics statistics;
  for (std::uint32_t offset = 0u; offset < kLossFrameSamples; ++offset) {
    const std::size_t base =
        static_cast<std::size_t>(offset) + kLossSettleFrames * kLossFrameSamples;
    const double reference = windowRms(clean, base);
    if (reference <= 1.0e-6) {
      continue;
    }
    bool ambiguous = false;
    std::uint32_t lost_frames = 0u;
    std::uint32_t bursts = 0u;
    bool previous_lost = false;
    for (std::uint32_t frame = 0u; frame < frames_measured; ++frame) {
      const std::size_t start = base + static_cast<std::size_t>(frame) * kLossFrameSamples;
      if (std::abs(windowRms(clean, start) - reference) > reference * 1.0e-3) {
        ambiguous = true;
        break;
      }
      const double ratio = windowRms(lossy, start) / reference;
      if (ratio > 0.995 && ratio < 1.005) {
        previous_lost = false;
        continue;
      }
      if (ratio > 0.9) {
        ambiguous = true;
        break;
      }
      ++lost_frames;
      if (!previous_lost) {
        ++bursts;
      }
      previous_lost = true;
    }
    if (ambiguous || bursts == 0u) {
      continue;
    }
    statistics.aligned = true;
    statistics.loss_ratio = static_cast<double>(lost_frames) / static_cast<double>(frames_measured);
    statistics.mean_burst = static_cast<double>(lost_frames) / static_cast<double>(bursts);
    break;
  }
  return statistics;
}

// The requested packet loss is the long-run fraction of frames the sink never receives. The link
// model enters a burst that already loses its entry frame and then recovers with probability 1/4
// per frame, so the mean burst is five frames and the entry probability has to be solved from both
// the burst length and the good-run length. Solving it from the recovery probability alone inflates
// the delivered loss by 25 percent, which this measurement pins down directly.
void testPacketLossRateMatchesRequest() {
  constexpr std::uint32_t kMeasuredFrames = 30000u;
  constexpr std::uint32_t kTotalSamples =
      (kLossSettleFrames + kMeasuredFrames + 2u) * kLossFrameSamples;
  const std::vector<float> clean = renderLossTone(0.0F, kTotalSamples);
  const std::vector<float> lossy = renderLossTone(20.0F, kTotalSamples);
  const LossStatistics statistics = measureFrameLoss(clean, lossy, kMeasuredFrames);
  check(statistics.aligned, "the frame-loss detector locks onto the codec frame grid");
  if (!statistics.aligned) {
    return;
  }
  if (statistics.loss_ratio < 0.176 || statistics.loss_ratio > 0.224 ||
      statistics.mean_burst < 4.8 || statistics.mean_burst > 5.8) {
    std::fprintf(stderr, "measured loss ratio %.4f, mean burst %.3f frames (requested 0.20)\n",
                 statistics.loss_ratio, statistics.mean_burst);
  }
  check(statistics.loss_ratio > 0.176 && statistics.loss_ratio < 0.224,
        "the delivered frame-loss ratio matches the requested packet loss");
  // Consecutive outages that happen to be separated by no good frame at all are observed as one
  // burst, so the visible mean sits slightly above the modelled five frames.
  check(statistics.mean_burst > 4.8 && statistics.mean_burst < 5.8,
        "outages last the modelled five-frame retransmission window on average");
}

// Same rig, but the link only degrades after `onset` samples: everything before it is a clean
// round trip, so the first frame the detector marks as lost is necessarily the first outage of the
// stream and therefore the one that follows the zero-to-lossy transition. A clean link draws no
// random numbers at all, so the generator still sits on its seed when the transition happens: this
// seed is chosen so that its first three draws are 0.018, 0.500 and 0.802, which enters the bad
// state on the very first frame after the onset (entry probability 1/21 at twenty percent loss)
// and stays there for at least three frames. That makes the very first outage of the run the frame
// immediately following the transition, which is exactly the moment the concealment history used
// to be empty.
std::vector<float> renderLossOnsetTone(float packet_loss, std::uint32_t onset,
                                       std::uint32_t samples) {
  KernelHarness harness(48000.0F, 1u);
  harness.seed(0x185eaefeu, 0x003a1832u);
  Params params = defaultParams();
  params.bitpool = 53.0F;
  params.blocks = 3.0F;
  std::vector<float> result(samples, 0.0F);
  std::vector<float> block(kLossBlockSamples, 0.0F);
  std::uint32_t absolute = 0u;
  while (absolute < samples) {
    const std::uint32_t count =
        samples - absolute < kLossBlockSamples ? samples - absolute : kLossBlockSamples;
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      block[frame] = toneSample(absolute + frame);
    }
    params.packetLoss = absolute < onset ? 0.0F : packet_loss;
    harness.stage(params);
    harness.process(block.data(), 1u, count);
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      result[absolute + frame] = block[frame];
    }
    absolute += count;
  }
  return result;
}

// A sink always holds the frame it decoded last, so the very first outage after the link starts
// dropping frames must conceal with the audio just heard. Gating the concealment history on the
// packet-loss control left that history empty at the transition, so the first outage emitted hard
// silence, an audible click that no real sink produces. The measurement window covers the blocks
// that depend only on their own frame, so a received frame reproduces the reference exactly and a
// concealed one reproduces it scaled by the fade, which pins the distinction down to a ratio.
void testPacketLossOnsetConcealsWithLiveAudio() {
  constexpr std::uint32_t kOnsetFrame = 96u;
  constexpr std::uint32_t kTotalFrames = 320u;
  constexpr std::uint32_t kTotalSamples = kTotalFrames * kLossFrameSamples;
  const std::vector<float> clean = renderLossTone(0.0F, kTotalSamples);
  const std::vector<float> lossy =
      renderLossOnsetTone(20.0F, kOnsetFrame * kLossFrameSamples, kTotalSamples);

  bool aligned = false;
  double first_loss_ratio = 0.0;
  for (std::uint32_t offset = 0u; offset < kLossFrameSamples; ++offset) {
    const std::size_t base =
        static_cast<std::size_t>(offset) + kLossSettleFrames * kLossFrameSamples;
    const double reference = windowRms(clean, base);
    if (reference <= 1.0e-6) {
      continue;
    }
    const std::uint32_t measured = kTotalFrames - kLossSettleFrames - 2u;
    bool ambiguous = false;
    bool found = false;
    double ratio_at_loss = 0.0;
    for (std::uint32_t frame = 0u; frame < measured; ++frame) {
      const std::size_t start = base + static_cast<std::size_t>(frame) * kLossFrameSamples;
      if (std::abs(windowRms(clean, start) - reference) > reference * 1.0e-3) {
        ambiguous = true;
        break;
      }
      const double ratio = windowRms(lossy, start) / reference;
      if (ratio > 0.995 && ratio < 1.005) {
        continue;
      }
      if (ratio > 0.9) {
        ambiguous = true;
        break;
      }
      found = true;
      ratio_at_loss = ratio;
      break;
    }
    if (ambiguous || !found) {
      continue;
    }
    aligned = true;
    first_loss_ratio = ratio_at_loss;
    break;
  }
  check(aligned, "the onset rig locks onto the codec frame grid and observes an outage");
  if (!aligned) {
    return;
  }
  if (first_loss_ratio <= 0.4) {
    std::fprintf(stderr, "first outage after the packet-loss onset emitted ratio %.6f\n",
                 first_loss_ratio);
  }
  // The fade reaches at worst 0.5 across the measured blocks, so live concealment lands well above
  // 0.4 while the old empty-history behaviour produced an exact zero.
  check(first_loss_ratio > 0.4,
        "the first outage after enabling packet loss conceals with the audio just received");
}

// Burst-duration rig. Outside an outage the concealment path never runs and both renders compute
// the identical arithmetic, so the difference against the clean stream is bit-exact zero; a burst
// is therefore a run of differing samples, extended by the ten-block synthesis window that the
// wrong subbands keep smearing into the following good frames. Gaps shorter than that smear cannot
// be resolved, so they are merged into the surrounding burst.
struct BurstStatistics {
  std::uint32_t bursts = 0u;
  double mean_burst_samples = 0.0;
};

BurstStatistics measureBurstSamples(float blocks, std::uint32_t total_samples) {
  constexpr std::uint32_t kMergeGap = 160u;
  constexpr std::uint32_t kSettleSamples = 8192u;
  const std::vector<float> clean = renderLossTone(0.0F, total_samples, blocks);
  const std::vector<float> lossy = renderLossTone(20.0F, total_samples, blocks);
  BurstStatistics statistics;
  std::uint64_t accumulated = 0u;
  std::uint32_t burst_samples = 0u;
  std::uint32_t gap = 0u;
  bool in_burst = false;
  for (std::uint32_t index = kSettleSamples; index < total_samples; ++index) {
    if (clean[index] != lossy[index]) {
      if (!in_burst) {
        in_burst = true;
        burst_samples = 0u;
        ++statistics.bursts;
      }
      burst_samples += gap + 1u;
      gap = 0u;
    } else if (in_burst) {
      ++gap;
      if (gap >= kMergeGap) {
        accumulated += burst_samples;
        in_burst = false;
        gap = 0u;
      }
    }
  }
  if (in_burst && statistics.bursts != 0u) {
    // The trailing burst is truncated by the end of the render, so it is not a length sample.
    --statistics.bursts;
  }
  if (statistics.bursts != 0u) {
    statistics.mean_burst_samples =
        static_cast<double>(accumulated) / static_cast<double>(statistics.bursts);
  }
  return statistics;
}

// The retransmission window is a property of the link, not of the SBC frame length, so shortening
// the frame must shorten nothing: four blocks has to burst for four times as many frames as sixteen
// blocks to cover the same 640 codec samples. Counting the outages in samples makes the two
// configurations directly comparable, since the smear that extends every measured burst is the same
// ten-block synthesis window in both.
void testBurstDurationIsBlockIndependent() {
  const BurstStatistics wide = measureBurstSamples(3.0F, 1600000u);
  const BurstStatistics narrow = measureBurstSamples(0.0F, 800000u);
  check(wide.bursts > 40u && narrow.bursts > 40u, "both block counts observe enough outages");
  if (wide.bursts <= 40u || narrow.bursts <= 40u) {
    return;
  }
  const double difference =
      std::abs(narrow.mean_burst_samples - wide.mean_burst_samples) / wide.mean_burst_samples;
  if (narrow.mean_burst_samples < 520.0 || narrow.mean_burst_samples > 980.0 || difference > 0.3) {
    std::fprintf(stderr,
                 "mean burst %.1f samples over %u outages at sixteen blocks, %.1f samples over %u "
                 "outages at four blocks\n",
                 wide.mean_burst_samples, wide.bursts, narrow.mean_burst_samples, narrow.bursts);
  }
  // 640 codec samples of outage plus the eighty-sample synthesis smear, whatever the frame length.
  check(narrow.mean_burst_samples > 520.0 && narrow.mean_burst_samples < 980.0,
        "four-block outages last the same retransmission window in samples");
  check(difference < 0.3, "the outage duration does not change when the SBC frame length changes");
}

std::vector<float> renderLossTransition(float phase_three_loss, bool phase_three_tone) {
  constexpr std::uint32_t kPhaseOneSamples = 16384u;
  constexpr std::uint32_t kPhaseTwoSamples = 16384u;
  constexpr std::uint32_t kPhaseThreeSamples = 32768u;
  KernelHarness harness(48000.0F, 2u);
  harness.seed(0x51ab7c3du, 0u);
  Params params = defaultParams();
  params.bitpool = 53.0F;
  params.blocks = 3.0F;
  std::vector<float> tail(2u * kPhaseThreeSamples, 0.0F);
  std::vector<float> block(2u * kLossBlockSamples, 0.0F);
  const std::uint32_t total = kPhaseOneSamples + kPhaseTwoSamples + kPhaseThreeSamples;
  for (std::uint32_t absolute = 0u; absolute < total; absolute += kLossBlockSamples) {
    const bool phase_one = absolute < kPhaseOneSamples;
    const bool phase_three = absolute >= kPhaseOneSamples + kPhaseTwoSamples;
    params.packetLoss = phase_one ? 10.0F : (phase_three ? phase_three_loss : 0.0F);
    const bool tone = phase_one || (phase_three && phase_three_tone);
    for (std::uint32_t frame = 0u; frame < kLossBlockSamples; ++frame) {
      const float sample = tone ? toneSample(absolute + frame) : 0.0F;
      block[frame] = sample;
      block[kLossBlockSamples + frame] = sample;
    }
    harness.stage(params);
    harness.process(block.data(), 2u, kLossBlockSamples);
    if (!phase_three) {
      continue;
    }
    const std::uint32_t base = absolute - (kPhaseOneSamples + kPhaseTwoSamples);
    for (std::uint32_t frame = 0u; frame < kLossBlockSamples; ++frame) {
      tail[base + frame] = block[frame];
      tail[kPhaseThreeSamples + base + frame] = block[kLossBlockSamples + frame];
    }
  }
  return tail;
}

// The concealment history is refreshed on every block, so a clean stretch overwrites whatever was
// captured before it. Re-enabling packet loss must therefore conceal with the audio of that clean
// stretch (silence in this test), never with subbands from before it: the re-enabled link can only
// ever emit silence here.
void testPacketLossReEnableConcealsWithLiveHistory() {
  const std::vector<float> silent_tail = renderLossTransition(10.0F, false);
  double peak = 0.0;
  for (const float sample : silent_tail) {
    peak = std::max(peak, std::abs(static_cast<double>(sample)));
  }
  if (peak > 1.0e-7) {
    std::fprintf(stderr, "stale concealment leaked %.6f into the re-enabled silent link\n", peak);
  }
  check(peak <= 1.0e-7,
        "re-enabled packet loss never conceals with audio from before the clean period");

  const std::vector<float> lossy_tone = renderLossTransition(10.0F, true);
  const std::vector<float> clean_tone = renderLossTransition(0.0F, true);
  check(lossy_tone != clean_tone,
        "the re-enabled link actually drops frames in the measured window");
  check(finite(lossy_tone) && finite(silent_tail),
        "the packet-loss transition keeps the stream finite");
}

} // namespace

int main(int argc, char **argv) {
  if (argc == 2 && std::string_view(argv[1]) == "--profile") {
    profileUniformity();
    return 0;
  }
  testSupportedRatesAndDryLatency();
  testWetProcessingAndReset();
  testProcessBoundaryIndependence();
  testWetLatencyAlignment();
  testLatencyAcrossRepeatedBlockTransitions();
  testResamplerBandLimit();
  testMonoAndExtraChannels();
  testDualChannelAllocatesPerChannel();
  testPacketLossDefaultIsClean();
  testPacketLossDegradesDeterministically();
  testPacketLossExtremesAndMono();
  testPacketLossRateMatchesRequest();
  testPacketLossOnsetConcealsWithLiveAudio();
  testBurstDurationIsBlockIndependent();
  testPacketLossReEnableConcealsWithLiveHistory();
  return failures == 0 ? 0 : 1;
}

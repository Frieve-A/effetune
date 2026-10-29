#include "../../analyzer/note_spectrogram/spectral_analysis.h"
#include "NoteSpectrogramPluginParams.h"
#include "SFZNotePlayerPluginParams.h"
#include "VolumePluginParams.h"
#include "allocation_guard.h"
#include "bank.h"
#include "binary_io.h"
#include "engine.h"
#include "onset_rule.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <latch>
#include <limits>
#include <memory>
#include <thread>
#include <vector>
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_SFZNotePlayerPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_NoteSpectrogramPlugin() noexcept;
namespace {
using namespace effetune;
using namespace effetune::plugins::others::sfz;
int failures = 0;
void check(bool good, const char *expr, int line) {
  if (!good) {
    std::fprintf(stderr, "sfz:%d %s\n", line, expr);
    ++failures;
  }
}
#define CHECK(x) check(static_cast<bool>(x), #x, __LINE__)
using Region = std::array<float, kStride>;
Region region() {
  Region r{};
  r[Frames] = 1024;
  r[Channels] = 1;
  r[Rate] = 48000;
  r[LowKey] = 0;
  r[HighKey] = 127;
  r[LowVelocity] = 1;
  r[HighVelocity] = 127;
  r[HighRandom] = 1;
  r[SequenceLength] = 1;
  r[SequencePosition] = 1;
  r[KeyCenter] = 60;
  r[KeyTrack] = 100;
  r[VelocityTrack] = 0;
  r[End] = 1023;
  r[LoopMode] = 2;
  r[LoopEnd] = 1023;
  r[Sustain] = 100;
  r[Release] = .005F;
  return r;
}
struct Bank {
  std::vector<float> words;
  std::uint32_t footprint = 0;
  explicit Bank(std::vector<Region> regions = {region()}, std::uint32_t samples = 1024) {
    const auto count = static_cast<std::uint32_t>(regions.size());
    words.resize(8u + kHeader + count * kStride + samples, .25F);
    auto *bytes = reinterpret_cast<std::uint8_t *>(words.data());
    std::fill_n(bytes, 32u, std::uint8_t{0});
    binary_io::writeU32(bytes, 0x31415445u);
    binary_io::writeU32(bytes + 4, 1u);
    binary_io::writeU32(bytes + 8, static_cast<std::uint32_t>(words.size()) - 8u);
    binary_io::writeU32(bytes + 12, 1u);
    auto *h = words.data() + 8;
    const std::array<std::uint32_t, kHeader> header = {
        kMagic,
        kVersion,
        count,
        kStride,
        kHeader + count * kStride,
        static_cast<std::uint32_t>(words.size() - 8u),
        1u,
        0u};
    for (std::size_t i = 0; i < header.size(); ++i)
      h[i] = std::bit_cast<float>(header[i]);
    std::uint32_t spans = 0;
    for (std::size_t i = 0; i < regions.size(); ++i) {
      std::copy(regions[i].begin(), regions[i].end(), h + kHeader + i * kStride);
      for (std::uint32_t field = 0; field < kStride; ++field)
        if (isIndexField(field))
          h[kHeader + i * kStride + field] =
              std::bit_cast<float>(static_cast<std::uint32_t>(regions[i][field]));
      spans += static_cast<std::uint32_t>(regions[i][HighKey] - regions[i][LowKey] + 1);
    }
    footprint = static_cast<std::uint32_t>(words.size() * 4u) + 4u * (131u + spans);
  }
  AssetBeginInfo info() const {
    return {1u,        static_cast<std::uint32_t>(words.size() - 8u), 0u, 0u, 1u, 0u, 0u, 2u,
            footprint, static_cast<std::uint32_t>(words.size() * 4u)};
  }
};
struct Harness {
  alignas(std::max_align_t) std::array<std::byte, 8192> storage{};
  const KernelDescriptor *descriptor = et_kernel_descriptor_SFZNotePlayerPlugin();
  PluginKernel *kernel = nullptr;
  float rate;
  std::uint32_t analysis_latency = 0u;
  generated::SFZNotePlayerPluginParams params{.5F,    -30.0F, 3.0F, 28.0F, 91.0F,  32.0F, 0.0F,
                                              100.0F, 0.0F,   0.0F, 1.0F,  1.0F,   1.0F,  0.0F,
                                              18.0F,  0.0F,   0.0F, -1.0F, 100.0F, 0.0F};
  double time = 0;
  explicit Harness(float sampleRate = 48000) : rate(sampleRate) {
    kernel = descriptor->construct(storage.data());
    kernel->prepare({rate, 4, 1024});
    CHECK(kernel->preparedSuccessfully());
    sync();
    plugins::analyzer::SpectralAnalysis analysis;
    analysis.prepare({rate, 4, 1024});
    analysis_latency = analysis.latencySamples();
  }
  ~Harness() { descriptor->destroy(kernel); }
  void sync() {
    CHECK(kernel->stageParameters(reinterpret_cast<float *>(&params), descriptor->paramsFloatCount,
                                  descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }
  std::array<std::uint8_t, 1044> snapshot() {
    std::array<std::uint8_t, 2048> telemetry_storage{};
    std::array<std::uint8_t, 1044> frame{};
    TelemetryRing ring;
    ring.adopt(telemetry_storage.data(), static_cast<std::uint32_t>(telemetry_storage.size()));
    std::uint32_t sequence = 0u;
    TelemetryWriter writer(ring, 17u, sequence);
    {
      allocation_guard::Scope guard;
      kernel->writeTelemetry(writer);
    }
    CHECK(ring.read(frame.data(), static_cast<std::uint32_t>(frame.size()), nullptr) ==
          frame.size());
    CHECK(frame[0] == 30u && frame[2] == 1u && frame[4] == 17u);
    CHECK(frame[12] == 4u && frame[13] == 4u);
    return frame;
  }
  void process(std::vector<float> &audio, unsigned channels = 2,
               const NoteAnalysisView *view = nullptr) {
    const auto frames = static_cast<std::uint32_t>(audio.size() / channels);
    {
      allocation_guard::Scope guard;
      kernel->process(audio.data(), channels, frames, {time, nullptr, view});
    }
    time += frames / rate;
  }
  et_status load(Bank &bank, bool prepare = true) {
    const auto bytes = static_cast<std::uint32_t>(bank.words.size() * 4u);
    auto *target = kernel->beginAsset(0, bank.info());
    CHECK(target);
    if (!target)
      return ET_ERR_ARGS;
    std::memcpy(target, bank.words.data(), bytes);
    et_status status;
    {
      allocation_guard::Scope guard;
      status = kernel->commitAsset(0, bytes, 1);
    }
    if (prepare)
      for (unsigned i = 0; i < 10000 && kernel->assetState(0) == ET_ASSET_STATE_PREPARING; ++i) {
        std::vector<float> a(256);
        process(a);
      }
    kernel->reset();
    time = 0;
    return status;
  }
  std::vector<float> event(unsigned midi, float probability = 1, float level = 0,
                           unsigned frames = 0, unsigned channels = 2) {
    if (!frames)
      frames = static_cast<unsigned>(std::round(rate * .01F)) + 128u;
    NoteAnalysisFrame frame{};
    frame.probabilities[midi - 21] = probability;
    frame.levels[midi - 21] = level;
    NoteAnalysisView view{&frame,
                          1,
                          static_cast<unsigned>(params.minimumMidi),
                          static_cast<unsigned>(params.maximumMidi),
                          frames,
                          time,
                          channels,
                          analysis_latency};
    std::vector<float> audio(static_cast<std::size_t>(frames) * channels);
    process(audio, channels, &view);
    return audio;
  }
  std::vector<float> attack(unsigned midi, float probability = 1, float level = 0,
                            unsigned frames = 256u, unsigned channels = 2u) {
    // Inspect the requested playback window after the fixed output reservation delay.
    const auto half_hop = static_cast<unsigned>(std::round(rate * .01F));
    const auto rendered = event(midi, probability, level, frames + half_hop, channels);
    std::vector<float> audio(static_cast<std::size_t>(frames) * channels);
    for (unsigned channel = 0; channel < channels; ++channel)
      std::copy_n(rendered.begin() + channel * (frames + half_hop) + half_hop, frames,
                  audio.begin() + channel * frames);
    return audio;
  }
};
float peak(const std::vector<float> &a) {
  float p = 0;
  for (float v : a)
    p = std::max(p, std::abs(v));
  return p;
}
void onsetRule() {
  const OnsetRuleSettings settings{.75F, .65F, .5F, .3F, .3F, 6u};
  OnsetRule rule;
  CHECK(!rule.latched() && !rule.active() && rule.cooldown() == 0u);
  rule.step(0, 0, settings);
  CHECK(rule.step(.8F, .8F, settings).fire == OnsetFire::None);
  CHECK(rule.latched() && !rule.active());
  const auto peak = rule.step(.8F, .2F, settings);
  CHECK(peak.fire == OnsetFire::Onset && peak.delta > 0 && peak.delta <= .5);
  CHECK(rule.active() && rule.cooldown() == 6u);
  CHECK(rule.step(0, 0, settings).released);
  CHECK(rule.cooldown() == 5u);
  CHECK(rule.step(.8F, 0, settings).fire == OnsetFire::None);
  CHECK(rule.latched() && !rule.active());
  rule.reset();
  rule.step(0, .5F, settings);
  rule.step(.8F, .7F, settings);
  CHECK(rule.step(.8F, .5F, settings).fire == OnsetFire::None);
  CHECK(!rule.active()); // The peak did not rise enough from the valley.
  rule.reset();
  rule.step(0, .2F, settings);
  rule.step(.8F, .8F, settings);
  const auto earlier = rule.step(.8F, 0, settings);
  CHECK(earlier.fire == OnsetFire::Onset && earlier.delta < 0 && earlier.delta >= -.5);
  rule.reset();
  CHECK(rule.step(.8F, 0, settings).fire == OnsetFire::Fallback);
  CHECK(rule.step(.8F, .8F, settings).fire == OnsetFire::None);
  CHECK(rule.step(.8F, 0, settings).fire == OnsetFire::None);
  rule.reset();
  rule.step(0, 0, settings);
  rule.step(.8F, 1, settings);
  CHECK(rule.step(.8F, 0, settings).delta == 0.0);
}

// These synthetic boundary frames are fixed references from the Python onset rule.
std::vector<float> onsetFrame(Harness &h, unsigned midi, float probability, float onset,
                              unsigned frames = 960u) {
  NoteAnalysisFrame frame{};
  frame.probabilities[midi - 21u] = probability;
  frame.onsets[midi - 21u] = onset;
  NoteAnalysisView view{&frame,
                        1u,
                        static_cast<unsigned>(h.params.minimumMidi),
                        static_cast<unsigned>(h.params.maximumMidi),
                        frames,
                        h.time,
                        2u,
                        h.analysis_latency};
  std::vector<float> audio(2u * frames);
  h.process(audio, 2u, &view);
  return audio;
}
void onsetBoundary() {
  constexpr unsigned hop = 960u;
  const auto run = [](unsigned midi, const std::array<float, 24> &p, const std::array<float, 24> &o,
                      std::initializer_list<unsigned> expected) {
    Harness h;
    h.params.threshold = .75F;
    h.params.noteHoldMs = 0;
    h.params.minimumMidi = 21;
    h.params.maximumMidi = 108;
    h.sync();
    auto r = region();
    r[LowKey] = r[HighKey] = r[KeyCenter] = static_cast<float>(midi);
    r[Frames] = 64;
    r[End] = r[LoopEnd] = 63;
    r[LoopMode] = 1;
    Bank bank({r}, 64);
    CHECK(h.load(bank) == ET_OK);
    CHECK(h.kernel->latencySamples() == h.analysis_latency + hop / 2u);
    std::vector<unsigned> observed;
    bool sounding = false;
    for (unsigned i = 0; i < p.size(); ++i) {
      const auto audio = onsetFrame(h, midi, p[i], o[i], hop);
      for (unsigned j = 0; j < hop; ++j) {
        const bool current = audio[j] != 0;
        if (current && !sounding)
          observed.push_back(i * hop + j);
        sounding = current;
      }
    }
    CHECK(observed == std::vector<unsigned>(expected));
  };
  // refractory-release.
  run(60u, {0.0F,  0.0F,  0.0F,  0.0F,  0.0F,  0.6F,  0.4F,  0.4F,  0.85F, 0.85F, 0.85F, 0.85F,
            0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.2F,  0.2F,  0.2F,  0.2F},
      {0.0F, 0.0F, 0.0F, 0.2F, 0.9F, 0.5F, 0.1F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {5487u});
  run(62u, {0.0F,  0.0F,  0.0F,  0.0F,  0.0F,  0.6F,  0.4F,  0.4F,  0.4F, 0.4F, 0.4F, 0.85F,
            0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.2F, 0.2F, 0.2F, 0.2F},
      {0.0F, 0.0F, 0.0F, 0.2F, 0.9F, 0.5F, 0.1F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {5487u, 11041u});
  run(64u, {0.0F,  0.0F,  0.0F,  0.0F,  0.0F,  0.6F,  0.4F,  0.4F,  0.4F, 0.4F, 0.85F, 0.85F,
            0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.85F, 0.2F, 0.2F, 0.2F,  0.2F},
      {0.0F, 0.0F, 0.0F, 0.2F, 0.9F, 0.5F, 0.1F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {5487u});
  run(65u, {0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.6F, 0.4F, 0.4F, 0.4F, 0.4F, 0.4F, 0.4F,
            0.4F, 0.4F, 0.4F, 0.4F, 0.4F, 0.4F, 0.4F, 0.4F, 0.4F, 0.4F, 0.4F, 0.4F},
      {0.0F, 0.0F, 0.0F, 0.2F, 0.9F, 0.5F, 0.1F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {5487u});
  // same-frame-release-fire.
  run(60u, {0.0F, 0.0F, 0.0F, 0.0F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F,
            0.9F, 0.5F, 0.7F, 0.8F, 0.8F, 0.8F, 0.8F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {0.0F,  0.0F, 0.1F, 0.8F, 0.3F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.05F,
       0.85F, 0.2F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {4458u, 13051u});
  run(64u, {0.0F, 0.0F, 0.0F, 0.0F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F,
            0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {0.0F,  0.0F, 0.1F, 0.8F, 0.3F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.05F,
       0.85F, 0.2F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {4458u, 13051u});
  run(67u, {0.0F, 0.0F, 0.0F, 0.0F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F,
            0.9F, 0.2F, 0.2F, 0.8F, 0.8F, 0.8F, 0.8F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {0.0F,  0.0F, 0.1F, 0.8F, 0.3F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.05F,
       0.85F, 0.2F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {4458u, 14881u});
  // peak-wait-latch.
  run(60u, {0.0F, 0.0F, 0.0F, 0.0F, 0.5F, 0.8F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F,
            0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {0.0F, 0.0F, 0.0F, 0.0F, 0.2F, 0.6F, 0.9F, 0.4F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {7009u});
  run(62u, {0.1F, 0.1F, 0.1F, 0.1F, 0.1F, 0.1F, 0.8F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F,
            0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {0.0F, 0.0F, 0.7F, 0.55F, 0.55F, 0.6F, 0.7F, 0.5F, 0.3F, 0.3F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F,  0.0F,  0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {});
  run(64u, {0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.8F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F,
            0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.9F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {0.0F, 0.0F, 0.0F, 0.0F, 0.1F, 0.45F, 0.9F, 0.3F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F,  0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {5281u});
  // gate-fire.
  run(60u, {0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.5F, 0.5F, 0.5F, 0.5F, 0.5F, 0.0F, 0.0F,
            0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {0.0F, 0.0F, 0.0F, 0.2F, 0.9F, 0.5F, 0.1F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {5487u});
  run(62u, {0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.7F, 0.7F, 0.7F, 0.7F, 0.7F, 0.7F, 0.7F,
            0.7F, 0.7F, 0.7F, 0.2F, 0.2F, 0.2F, 0.2F, 0.2F, 0.2F, 0.2F, 0.2F, 0.2F},
      {0.0F, 0.0F, 0.0F, 0.2F, 0.9F, 0.5F, 0.1F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {5487u});
  run(64u, {0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.3F, 0.1F, 0.1F, 0.1F, 0.0F, 0.0F, 0.0F,
            0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {0.0F, 0.0F, 0.0F, 0.2F, 0.9F, 0.5F, 0.1F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {5487u});
  run(65u, {0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.29F, 0.1F, 0.1F, 0.1F, 0.8F, 0.8F, 0.8F,
            0.8F, 0.8F, 0.8F, 0.8F, 0.8F, 0.8F,  0.8F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {0.0F, 0.0F, 0.0F, 0.2F, 0.9F, 0.5F, 0.1F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {9121u});
  run(83u, {0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.5F, 0.2F, 0.2F, 0.2F, 0.2F, 0.2F, 0.2F,
            0.8F, 0.8F, 0.8F, 0.8F, 0.8F, 0.8F, 0.8F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {0.0F, 0.0F, 0.0F, 0.2F, 0.9F, 0.5F, 0.1F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {5487u, 12001u});
  run(84u, {0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.5F, 0.2F, 0.2F, 0.2F, 0.2F, 0.2F, 0.2F,
            0.8F, 0.8F, 0.8F, 0.8F, 0.8F, 0.8F, 0.8F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {0.0F, 0.0F, 0.0F, 0.2F, 0.9F, 0.5F, 0.1F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F},
      {12001u});
}

void onsetHoldAndReservations() {
  auto shot = region();
  shot[Frames] = 64;
  shot[End] = shot[LoopEnd] = 63;
  shot[LoopMode] = 1;
  Bank short_bank({shot}, 64);
  // A fresh attack retriggers during Note Hold, while a fallback continues at its boundary.
  {
    Harness h;
    h.params.threshold = .75F;
    h.params.noteHoldMs = 100;
    h.sync();
    CHECK(h.load(short_bank) == ET_OK);
    CHECK(peak(onsetFrame(h, 60u, .8F, 0)) > 0);
    for (unsigned i = 0; i < 6u; ++i)
      CHECK(peak(onsetFrame(h, 60u, .8F, 0)) == 0);
    onsetFrame(h, 60u, 0, 0);
    CHECK(peak(onsetFrame(h, 60u, .6F, .8F)) == 0);
    CHECK(peak(onsetFrame(h, 60u, .6F, 0)) > 0);
  }
  for (const auto midi : {60u, 84u})
    for (const auto hold : {0.0F, 19.0F, 20.0F}) {
      Harness h;
      h.params.threshold = .75F;
      h.params.noteHoldMs = hold;
      h.sync();
      CHECK(h.load(short_bank) == ET_OK);
      CHECK(peak(onsetFrame(h, midi, .8F, 0)) > 0);
      for (unsigned i = 0; i < 6u; ++i)
        CHECK(peak(onsetFrame(h, midi, .8F, 0)) == 0);
      onsetFrame(h, midi, 0, 0);
      CHECK((peak(onsetFrame(h, midi, .8F, 0)) > 0) == (hold < 20.0F));
    }
  {
    Harness h;
    h.params.threshold = .75F;
    h.sync();
    Bank bank;
    CHECK(h.load(bank) == ET_OK);
    CHECK(onsetFrame(h, 60u, .8F, 0).back() == .25F);
    CHECK(onsetFrame(h, 60u, 0, 0).back() == .25F);   // Refractory extension, even with Hold 0.
    CHECK(onsetFrame(h, 60u, .8F, 0).back() == .25F); // A no-fire relatch cancels that deadline.
    for (unsigned i = 0; i < 8u; ++i)
      CHECK(onsetFrame(h, 60u, .8F, 0).back() == .25F);
  }
  // Disabling a role cancels a note-on still waiting in the output reservation.
  {
    Harness h;
    h.params.threshold = .75F;
    h.sync();
    CHECK(h.load(short_bank) == ET_OK);
    CHECK(peak(onsetFrame(h, 60u, .8F, 0, 128u)) == 0);
    h.params.playLowest = h.params.playMiddle = h.params.playHighest = 0;
    h.sync();
    CHECK(peak(onsetFrame(h, 60u, .8F, 0)) == 0);
    h.kernel->reset();
    h.params.playLowest = h.params.playMiddle = h.params.playHighest = 1;
    h.sync();
    CHECK(peak(onsetFrame(h, 60u, .8F, 0)) > 0);
    h.kernel->reset();
    CHECK(peak(onsetFrame(h, 60u, 0, 0)) == 0);
  }
}

void playback() {
  Harness h;
  Bank bank;
  CHECK(h.load(bank) == ET_OK);
  CHECK(h.kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
  auto a = h.event(60);
  CHECK(a.back() > .2F);
  a = h.event(60, 0);
  for (int i = 0; i < 76; ++i)
    a = h.event(60, 0);
  CHECK(peak(a) == 0);
  h.kernel->reset();
  a = h.event(60, 0);
  CHECK(peak(a) == 0);
  h.params.threshold = .01F;
  h.sync();
  a = h.event(60);
  CHECK(peak(a) > .2F);
  for (int i = 0; i < 76; ++i)
    a = h.event(60, 0);
  CHECK(peak(a) == 0);
  h.params.minimumMidi = 61;
  h.sync();
  a = h.event(60);
  CHECK(peak(a) == 0);
  auto r = region();
  r[LoopMode] = 1;
  r[End] = r[LoopEnd] = 99;
  Bank shot({r});
  Harness one;
  CHECK(one.load(shot) == ET_OK);
  CHECK(peak(one.event(60)) > 0);
  CHECK(peak(one.event(60)) == 0);
  CHECK(peak(one.event(60)) == 0);
  for (unsigned i = 0; i < 6u; ++i)
    one.event(60, 0);
  CHECK(peak(one.event(60)) > 0);
  r = region();
  r[Pan] = -100;
  r[Volume] = -6;
  r[VelocityTrack] = 100;
  Bank pan({r});
  Harness p;
  CHECK(p.load(pan) == ET_OK);
  auto low = p.event(60, 1, -25);
  p.kernel->reset();
  auto high = p.event(60, 1, 3);
  CHECK(peak(high) > peak(low));
  CHECK(std::all_of(high.begin() + high.size() / 2u, high.end(), [](float x) { return x == 0; }));
  CHECK(high[high.size() / 2u - 1u] > .11F && high[high.size() / 2u - 1u] < .14F);
  r = region();
  r[SequenceLength] = 2;
  r[SequencePosition] = 2;
  Bank seq({r});
  Harness s;
  CHECK(s.load(seq) == ET_OK);
  CHECK(peak(s.event(60)) == 0);
  for (unsigned i = 0; i < 6u; ++i)
    s.event(60, 0);
  CHECK(peak(s.event(60)) > .2F);
  r = region();
  r[LowVelocity] = 127;
  r[HighVelocity] = 127;
  Bank vel({r});
  Harness v;
  CHECK(v.load(vel) == ET_OK);
  CHECK(peak(v.event(60, 1, -96)) == 0);
  for (unsigned i = 0; i < 6u; ++i)
    v.event(60, 0);
  CHECK(peak(v.event(60, 1, 24)) > .2F);
  r = region();
  r[LowRandom] = 0;
  r[HighRandom] = 0;
  Bank rand({r});
  Harness random;
  CHECK(random.load(rand) == ET_OK);
  CHECK(peak(random.event(60)) == 0);
  r = region();
  r[Attack] = .01F;
  r[Hold] = .005F;
  r[Decay] = .01F;
  r[Sustain] = 20;
  Bank env({r});
  Harness e;
  CHECK(e.load(env) == ET_OK);
  CHECK(peak(e.event(60)) < .08F);
  auto sustain = e.event(60, 1, 0, 1024);
  sustain = e.event(60);
  CHECK(std::abs(sustain.back() - .05F) < .002F);
  r = region();
  r[LoopMode] = 3;
  r[LoopStart] = 10;
  r[LoopEnd] = 15;
  r[Offset] = 12;
  Bank loop({r});
  Harness l;
  CHECK(l.load(loop) == ET_OK);
  CHECK(peak(l.event(60)) > .2F);
  for (int i = 0; i < 20; ++i)
    a = l.event(60, 0);
  CHECK(peak(a) == 0);
}
void voiceTelemetry() {
  Harness h;
  h.params.maxVoices = 2;
  h.params.octaveShift = 1;
  h.params.sampleShift = 1;
  h.sync();
  auto r = region();
  Bank bank({r, r});
  CHECK(h.load(bank) == ET_OK);
  const auto snapshot = [&] { return h.snapshot(); };
  const auto count = [](const auto &frame, unsigned midi) { return frame[20u + midi * 8u]; };
  const auto velocity = [](const auto &frame, unsigned midi) {
    float value = 0;
    std::memcpy(&value, frame.data() + 24u + midi * 8u, sizeof(value));
    return value;
  };
  CHECK(snapshot()[16] == 0u && snapshot()[18] == 2u);
  h.attack(84, 1, -13.5F, 256);
  const auto initial = snapshot();
  CHECK(initial[16] == 2u && count(initial, 96u) == 2u);
  CHECK(count(initial, 84u) == 0u && count(initial, 97u) == 0u);
  CHECK(std::abs(velocity(initial, 96u) - 64.0F / 127.0F * std::exp(-256.0F / h.rate)) < 1e-6F);
  h.event(84, 1, -13.5F, 480);
  const auto sustained = snapshot();
  CHECK(sustained[16] == 2u && count(sustained, 96u) == 2u);
  CHECK(std::abs(velocity(sustained, 96u) / velocity(initial, 96u) - std::exp(-480.0F / h.rate)) <
        1e-6F);
  h.attack(85, 1, 0, 256);
  const auto stolen = snapshot();
  CHECK(stolen[16] == 2u && count(stolen, 97u) == 2u && count(stolen, 96u) == 0u);
  h.event(85, 0, 0, 512);
  CHECK(snapshot()[16] == 2u); // Release tails still occupy their sample voices.
  for (unsigned i = 0; i < 10; ++i)
    h.event(85, 0, 0, 1024);
  CHECK(snapshot()[16] == 0u);
  h.params.maxVoices = 1;
  h.sync();
  h.attack(84);
  CHECK(snapshot()[16] == 1u && snapshot()[18] == 1u);
  h.kernel->reset();
  CHECK(snapshot()[16] == 0u);
  h.attack(84);
  h.kernel->clearAsset(0);
  CHECK(snapshot()[16] == 0u);
  h.attack(84);
  CHECK(snapshot()[16] == 0u); // Detection without an instrument cannot light a key.
}

void manualPreview() {
  Harness h;
  h.params.octaveShift = 1;
  h.params.playLowest = h.params.playMiddle = h.params.playHighest = 0;
  h.sync();
  auto low = region(), high = region();
  low[LowKey] = high[LowKey] = 60;
  low[HighKey] = high[HighKey] = 61;
  low[HighVelocity] = 80;
  high[LowVelocity] = 81;
  high[Volume] = -6;
  Bank bank({low, high});
  CHECK(h.load(bank) == ET_OK);
  std::vector<float> audio(512);
  h.params.previewMidi = 60;
  h.params.previewVelocity = 64;
  h.sync();
  h.process(audio);
  CHECK(audio[255] == .25F); // Preview uses the displayed key and velocity, bypassing detection.
  auto frame = h.snapshot();
  CHECK(frame[16] == 1u && frame[20u + 60u * 8u] == 1u && frame[20u + 72u * 8u] == 0u);
  h.params.previewVelocity = 127;
  h.sync();
  std::fill(audio.begin(), audio.end(), 0.0F);
  h.process(audio);
  CHECK(audio.front() == .25F && audio[255] == .25F);
  frame = h.snapshot();
  float velocity = 0;
  std::memcpy(&velocity, frame.data() + 24u + 60u * 8u, sizeof(velocity));
  CHECK(std::abs(velocity - 64.0F / 127.0F * std::exp(-512.0F / h.rate)) < 1e-6F);
  h.params.previewMidi = 61;
  h.sync();
  std::fill(audio.begin(), audio.end(), 0.0F);
  h.process(audio);
  CHECK(std::abs(audio[255] - .25F * std::pow(10.F, -.3F)) < 1e-6F);
  frame = h.snapshot();
  CHECK(frame[16] == 1u && frame[20u + 60u * 8u] == 0u && frame[20u + 61u * 8u] == 1u);
  h.params.previewMidi = -1;
  h.sync();
  std::fill(audio.begin(), audio.end(), 0.0F);
  h.process(audio);
  CHECK(audio[255] == 0 && h.snapshot()[16] == 0u);

  // Releasing the pointer must also stop one-shot regions before their sample ends.
  low[LoopMode] = 1;
  Bank one_shot({low});
  CHECK(h.load(one_shot) == ET_OK);
  h.params.previewMidi = 60;
  h.params.previewVelocity = 64;
  h.sync();
  std::fill(audio.begin(), audio.end(), 0.0F);
  h.process(audio);
  CHECK(audio[255] == .25F);
  h.params.previewMidi = -1;
  h.sync();
  std::fill(audio.begin(), audio.end(), 0.0F);
  h.process(audio);
  CHECK(audio[255] == 0 && h.snapshot()[16] == 0u);

  // Detected note-offs and preview note-offs own separate voices even at the same pitch.
  Harness simultaneous;
  Bank looping;
  CHECK(simultaneous.load(looping) == ET_OK);
  simultaneous.params.previewMidi = 60;
  simultaneous.params.previewVelocity = 100;
  simultaneous.sync();
  simultaneous.attack(60);
  CHECK(simultaneous.snapshot()[16] == 2u);
  for (unsigned i = 0; i < 40; ++i)
    simultaneous.event(60, 0, 0, 512);
  CHECK(simultaneous.snapshot()[16] == 1u);
  simultaneous.attack(60);
  CHECK(simultaneous.snapshot()[16] == 2u);
  simultaneous.params.previewMidi = -1;
  simultaneous.sync();
  simultaneous.event(60, 1, 0, 512);
  CHECK(simultaneous.snapshot()[16] == 1u);
}

void releaseTail() {
  for (const float rate : {48000.F, 96000.F}) {
    for (const float seconds : {0.F, .001F, .005F, 1.1F}) {
      Harness h(rate);
      auto r = region();
      r[Release] = seconds;
      Bank bank({r});
      CHECK(h.load(bank) == ET_OK);
      h.attack(84, 1, 0, 256);
      const auto duration = seconds < .2F ? .2F : seconds;
      const auto releaseFrames = static_cast<unsigned>(duration * rate);
      std::vector<float> tail;
      while (tail.size() < releaseFrames + static_cast<unsigned>(rate * .01F) + 128u) {
        const auto frames = tail.size() % 2 == 0 ? 63u : 128u;
        auto block = h.event(84, 0, 0, frames);
        tail.insert(tail.end(), block.begin(), block.begin() + frames);
      }
      CHECK(std::abs(tail[static_cast<unsigned>(rate * .01F) + releaseFrames / 4u - 1u] - .025F) <
            .0001F);
      CHECK(std::abs(tail[static_cast<unsigned>(rate * .01F) + releaseFrames / 2u - 1u] - .0025F) <
            .00002F);
      CHECK(tail[static_cast<unsigned>(rate * .01F) + releaseFrames - 2u] > 0);
      CHECK(std::all_of(tail.begin() + static_cast<unsigned>(rate * .01F) + releaseFrames - 1u,
                        tail.end(), [](float value) { return value == 0; }));
    }
  }
  // One-shot playback ignores note-off and still ends at the sample boundary.
  Harness h;
  auto r = region();
  r[LoopMode] = 1;
  Bank bank({r});
  CHECK(h.load(bank) == ET_OK);
  h.attack(60, 1, 0, 256);
  const auto continuing = h.event(60, 0, 0, 512);
  CHECK(continuing.front() == .25F && continuing[511] == .25F);
  const auto ending = h.event(60, 0, 0, 512);
  CHECK(ending[255] == .25F && ending[256] == 0);
}
void octaveShift() {
  std::vector<Region> mapped;
  for (int shift = -2; shift <= 2; ++shift) {
    auto r = region();
    r[LowKey] = r[HighKey] = r[KeyCenter] = static_cast<float>(60 + shift * 12);
    r[Volume] = static_cast<float>((shift + 2) * -6);
    mapped.push_back(r);
  }
  Bank mapping(mapped);
  for (int shift = -2; shift <= 2; ++shift) {
    Harness h;
    h.params.minimumMidi = h.params.maximumMidi = 60;
    h.params.octaveShift = static_cast<float>(shift);
    h.sync();
    CHECK(h.load(mapping) == ET_OK);
    const auto a = h.attack(60, 1, 0, 256);
    const auto expected = .25F * std::pow(10.F, static_cast<float>((shift + 2) * -6) / 20.F);
    CHECK(std::abs(a[255] - expected) < .000001F);
    h.kernel->reset();
    CHECK(peak(h.event(59)) == 0);

    // A linear sample makes each playback increment directly observable after the onset fade.
    Bank ramp;
    for (unsigned i = 0; i < 1024; ++i)
      ramp.words[ramp.words.size() - 1024 + i] = static_cast<float>(i) / 1024.F;
    CHECK(h.load(ramp) == ET_OK);
    const auto pitched = h.attack(60, 1, 0, 256);
    CHECK(std::abs(pitched[128] - .125F * std::exp2(static_cast<float>(shift))) < .000001F);
  }
  Harness held;
  Bank ramp;
  for (unsigned i = 0; i < 1024; ++i)
    ramp.words[ramp.words.size() - 1024 + i] = static_cast<float>(i) / 1024.F;
  CHECK(held.load(ramp) == ET_OK);
  held.params.octaveShift = 1;
  held.sync();
  held.attack(60, 1, 0, 256);
  held.params.octaveShift = -1;
  held.sync();
  const auto unchanged = held.event(60, 1, 0, 256);
  CHECK(std::abs(unchanged[128] - .75F) < .000001F);
  // The original detected key still releases this voice after a parameter change.
  std::vector<float> tail;
  for (unsigned i = 0; i < 77; ++i)
    tail = held.event(60, 0);
  CHECK(peak(tail) == 0);
  const auto newNote = held.attack(60, 1, 0, 256);
  CHECK(std::abs(newNote[128] - .0625F) < .000001F);

  Harness boundary;
  Bank allKeys;
  boundary.params.minimumMidi = 21;
  boundary.params.maximumMidi = 108;
  boundary.sync();
  CHECK(boundary.load(allKeys) == ET_OK);
  for (const auto test : {std::array<int, 3>{21, -2, 0}, {108, 2, 0}, {21, -1, 1}, {108, 1, 1}}) {
    boundary.kernel->reset();
    boundary.params.octaveShift = static_cast<float>(test[1]);
    boundary.sync();
    CHECK((peak(boundary.event(static_cast<unsigned>(test[0]))) > .2F) == (test[2] != 0));
  }
}
void sampleShift() {
  std::vector<Region> mapped;
  for (int key = 42; key <= 78; ++key) {
    auto r = region();
    r[LowKey] = r[HighKey] = r[KeyCenter] = static_cast<float>(key);
    r[Volume] = static_cast<float>((key - 42) * -.5);
    mapped.push_back(r);
  }
  Bank bank(mapped);
  for (unsigned i = 0; i < 1024; ++i)
    bank.words[bank.words.size() - 1024 + i] = static_cast<float>(i) / 1024.F;
  Harness h;
  h.params.minimumMidi = h.params.maximumMidi = 60;
  CHECK(h.load(bank) == ET_OK);
  for (const int octave : {-1, 0, 1}) {
    h.params.octaveShift = static_cast<float>(octave);
    for (int shift = -6; shift <= 6; ++shift) {
      h.kernel->reset();
      h.params.sampleShift = static_cast<float>(shift);
      h.sync();
      const auto audio = h.attack(60, 1, 0, 256);
      const auto gain = std::pow(10.F, static_cast<float>((18 + 12 * octave + shift) * -.5) / 20.F);
      const auto step = std::exp2(-static_cast<float>(shift) / 12.F);
      // Region gain identifies the selected key; the ramp reveals pitch compensation.
      CHECK(std::abs(audio[128] - .125F * step * gain) < .000001F);
      CHECK(std::abs(audio[129] - audio[128] - step * gain / 1024.F) < .000001F);
    }
  }
  h.kernel->reset();
  h.params.octaveShift = 0;
  h.params.sampleShift = 1;
  h.sync();
  h.attack(60, 1, 0, 256);
  h.params.sampleShift = -1;
  h.sync();
  const auto held = h.event(60, 1, 0, 256);
  const auto held_step = std::exp2(-1.F / 12.F) * std::pow(10.F, -9.5F / 20.F) / 1024.F;
  CHECK(std::abs(held[129] - held[128] - held_step) < .000001F);
  std::vector<float> tail;
  for (unsigned i = 0; i < 77; ++i)
    tail = h.event(60, 0);
  CHECK(peak(tail) == 0); // Note-off still follows the original detected key.
  const auto next = h.attack(60, 1, 0, 256);
  CHECK(std::abs(next[128] - .125F * std::exp2(1.F / 12.F) * std::pow(10.F, -8.5F / 20.F)) <
        .000001F);

  Harness boundary;
  Bank all_keys;
  boundary.params.minimumMidi = 21;
  boundary.params.maximumMidi = 108;
  CHECK(boundary.load(all_keys) == ET_OK);
  for (const auto test :
       {std::array<int, 4>{24, -2, -1, 0}, {103, 2, 1, 0}, {24, -2, 1, 1}, {103, 2, -1, 1}}) {
    boundary.kernel->reset();
    boundary.params.octaveShift = static_cast<float>(test[1]);
    boundary.params.sampleShift = static_cast<float>(test[2]);
    boundary.sync();
    CHECK((peak(boundary.event(static_cast<unsigned>(test[0]))) > .2F) == (test[3] != 0));
  }
}
void independentDryWet() {
  for (const auto levels : {std::array<float, 2>{0, 100}, {100, 0}, {100, 100}, {0, 0}, {25, 75}}) {
    Harness h;
    Bank bank;
    CHECK(h.load(bank) == ET_OK);
    h.params.dryMix = levels[0];
    h.params.wetMix = levels[1];
    h.params.outputGain = -6;
    h.sync();
    std::vector<float> audio(512);
    for (unsigned block = 0; block < h.kernel->latencySamples() / 128u + 2u; ++block) {
      std::fill_n(audio.begin(), 128, .4F);
      std::fill_n(audio.begin() + 128, 128, -.2F);
      std::fill_n(audio.begin() + 256, 256, .3F);
      NoteAnalysisFrame frame{};
      frame.probabilities[60 - 21] = 1;
      NoteAnalysisView view{&frame, 1, 28, 91, 128, h.time, 4, h.analysis_latency};
      h.process(audio, 4, &view);
    }
    const auto gain = std::pow(10.F, -6.F / 20.F);
    const auto dry = levels[0] * .01F, wet = levels[1] * .01F;
    CHECK(std::abs(audio[127] - (.4F * dry + .25F * wet) * gain) < .000001F);
    CHECK(std::abs(audio[255] - (-.2F * dry + .25F * wet) * gain) < .000001F);
    CHECK(std::abs(audio[383] - .3F * dry * gain) < .000001F);
    CHECK(std::abs(audio[511] - .3F * dry * gain) < .000001F);
  }
}
std::vector<float> chord(Harness &h, std::initializer_list<std::array<float, 3>> notes,
                         unsigned frames = 960u) {
  NoteAnalysisFrame frame{};
  for (const auto &note : notes) {
    const auto pitch = static_cast<unsigned>(note[0]) - 21u;
    frame.probabilities[pitch] = note[1];
    frame.levels[pitch] = note[2];
  }
  NoteAnalysisView view{&frame,
                        1,
                        static_cast<unsigned>(h.params.minimumMidi),
                        static_cast<unsigned>(h.params.maximumMidi),
                        frames,
                        h.time,
                        2,
                        h.analysis_latency};
  std::vector<float> audio(frames * 2u);
  h.process(audio, 2, &view);
  return audio;
}
void sustainedOnset() {
  // Short samples expose each restart as a separate audible burst.
  for (const auto mode : {0.0F, 1.0F}) {
    auto r = region();
    r[Frames] = 240;
    r[End] = r[LoopEnd] = 239;
    r[LoopMode] = mode;
    Bank bank({r}, 240);
    for (const auto rate : {48000.0F, 96000.0F})
      for (unsigned mask = 1u; mask < 8u; ++mask) {
        Harness h(rate);
        CHECK(h.load(bank) == ET_OK);
        h.params.playLowest = (mask & 1u) ? 1.0F : 0.0F;
        h.params.playMiddle = (mask & 2u) ? 1.0F : 0.0F;
        h.params.playHighest = (mask & 4u) ? 1.0F : 0.0F;
        h.params.retriggerDropDb = 96;
        h.sync();
        const auto sustain = [&h, rate](float probability, float level) {
          return chord(
              h, {{84, probability, level}, {87, probability, level}, {90, probability, level}},
              static_cast<unsigned>(rate * .02F));
        };
        unsigned bursts = 0;
        for (unsigned hop = 0; hop <= 10; ++hop)
          bursts += peak(sustain(.5F + .05F * hop, -20.0F + 2.0F * hop)) > 0;
        CHECK(bursts == 1);
        for (unsigned hop = 0; hop < 8; ++hop)
          CHECK(peak(sustain(.45F, 0)) == 0);
        // A large retrigger drop keeps ordinary dips and renewed attacks in one held note.
        for (unsigned cycle = 0; cycle < 8; ++cycle)
          for (const auto level : {-20.0F, 0.0F, 8.0F, -8.0F})
            CHECK(peak(sustain(cycle % 2u ? .45F : 1.0F, level)) == 0);
        CHECK(peak(sustain(0, 8)) == 0);
        CHECK(peak(sustain(1, 8)) > 0);
        h.params.playLowest = h.params.playMiddle = h.params.playHighest = 0;
        h.sync();
        for (unsigned hop = 0; hop < 5; ++hop)
          CHECK(peak(sustain(1, -15)) == 0);
        h.params.playLowest = (mask & 1u) ? 1.0F : 0.0F;
        h.params.playMiddle = (mask & 2u) ? 1.0F : 0.0F;
        h.params.playHighest = (mask & 4u) ? 1.0F : 0.0F;
        h.sync();
        CHECK(peak(sustain(1, -15)) > 0);
        for (unsigned hop = 0; hop < 6; ++hop)
          CHECK(peak(sustain(1, 0)) == 0);
      }
  }
}
void retriggerDrop() {
  for (const auto mode : {0.0F, 1.0F}) {
    auto r = region();
    r[Frames] = 240;
    r[End] = r[LoopEnd] = 239;
    r[LoopMode] = mode;
    Bank bank({r}, 240);
    for (const auto rate : {48000.0F, 96000.0F}) {
      const auto frames = static_cast<unsigned>(rate * .02F);
      for (const auto drop : {6.0F, 18.0F, 96.0F}) {
        Harness h(rate);
        CHECK(h.load(bank) == ET_OK);
        h.params.retriggerDropDb = drop;
        h.sync();
        CHECK(peak(h.event(84, 1, 0, frames)) > 0);
        for (unsigned hop = 0; hop < 4; ++hop)
          CHECK(peak(h.event(84, 1, 0, frames)) == 0);
        // A shallower dip never rearms the note, even after a full recovery.
        CHECK(peak(h.event(84, 1, .5F - drop, frames)) == 0);
        CHECK(peak(h.event(84, 1, 0, frames)) == 0);
        CHECK(peak(h.event(84, 1, -drop, frames)) == 0);
        CHECK(peak(h.event(84, 1, -drop - 2, frames)) == 0);
        CHECK(peak(h.event(84, 1, -drop + 3, frames)) == 0);
        CHECK(peak(h.event(84, .45F, -drop + 4, frames)) == 0);
        // The qualifying dip needs a 6 dB recovery and confident detection.
        CHECK(peak(h.event(84, 1, -drop + 4, frames)) > 0);
        for (unsigned hop = 0; hop < 6; ++hop)
          CHECK(peak(h.event(84, 1, -drop + 4 + hop, frames)) == 0);
      }
      Harness live(rate);
      CHECK(live.load(bank) == ET_OK);
      CHECK(peak(live.event(84, 1, 0, frames)) > 0);
      for (unsigned hop = 0; hop < 4; ++hop)
        CHECK(peak(live.event(84, 1, 0, frames)) == 0);
      CHECK(peak(live.event(84, 1, -18, frames)) == 0);
      live.params.retriggerDropDb = 96;
      live.sync();
      CHECK(peak(live.event(84, 1, 0, frames)) == 0);
      live.params.retriggerDropDb = 6;
      live.sync();
      CHECK(peak(live.event(84, 1, -6, frames)) == 0);
      CHECK(peak(live.event(84, 1, 0, frames)) > 0);
    }
  }
}
void noteHold() {
  Bank bank;
  for (const auto rate : {44100.0F, 48000.0F, 96000.0F})
    for (const auto hold_ms : {0u, 37u, 100u}) {
      Harness h(rate);
      CHECK(h.load(bank) == ET_OK);
      const auto latency = h.kernel->latencySamples();
      h.params.noteHoldMs = static_cast<float>(hold_ms);
      h.sync();
      CHECK(h.kernel->latencySamples() == latency);
      CHECK(h.attack(84, 1, 0, 512).back() == .25F);
      std::vector<float> output;
      const auto capture = [&h, &output](unsigned frames,
                                         const NoteAnalysisFrame *event = nullptr) {
        NoteAnalysisView view{event,
                              event ? 1u : 0u,
                              static_cast<unsigned>(h.params.minimumMidi),
                              static_cast<unsigned>(h.params.maximumMidi),
                              frames,
                              h.time,
                              2u,
                              h.analysis_latency};
        std::vector<float> audio(static_cast<std::size_t>(frames) * 2u);
        h.process(audio, 2, &view);
        output.insert(output.end(), audio.begin(), audio.begin() + frames);
      };
      NoteAnalysisFrame off{};
      off.sampleOffset = 23u;
      capture(97, &off);
      const auto release_at =
          23u + static_cast<unsigned>(std::round(rate * .01F)) +
          static_cast<unsigned>(std::round(static_cast<double>(rate) * hold_ms / 1000.0));
      // Deadlines must fire between analysis frames and across irregular processing blocks.
      while (output.size() <= release_at + static_cast<unsigned>(rate * .2F))
        for (const auto frames : {63u, 128u, 17u, 97u})
          capture(frames);
      CHECK(std::all_of(output.begin(), output.begin() + release_at,
                        [](float value) { return std::abs(value - .25F) < .000001F; }));
      CHECK(output[release_at] > 0 && output[release_at] < .25F);
      CHECK(output.back() == 0);
    }
  auto r = region();
  r[Frames] = 240;
  r[End] = r[LoopEnd] = 239;
  r[LoopMode] = 1;
  Bank short_bank({r}, 240);
  for (const auto rate : {48000.0F, 96000.0F}) {
    Harness h(rate);
    CHECK(h.load(short_bank) == ET_OK);
    h.params.noteHoldMs = 100;
    h.sync();
    const auto half_hold = static_cast<unsigned>(rate / 20);
    CHECK(peak(h.event(84, 1, 0, half_hold)) > 0);
    CHECK(peak(h.event(84, 0, 0, half_hold)) == 0);
    CHECK(peak(h.event(84, 1, 0, half_hold)) == 0);
    CHECK(peak(h.event(84, 1, 0, half_hold)) == 0);
    CHECK(peak(h.event(84, 0, 0, 3u * half_hold)) == 0);
    CHECK(peak(h.event(84, 1, 0, half_hold)) > 0);
    CHECK(peak(h.event(84, 0, 0, 128)) == 0);
    h.kernel->clearAsset(0);
    CHECK(h.load(short_bank) == ET_OK);
    CHECK(peak(h.event(84, 1, 0, 3u * half_hold)) > 0);
  }
}
void noteSelection() {
  Bank bank;
  for (unsigned mask = 0; mask < 8; ++mask) {
    Harness h;
    h.load(bank);
    h.params.playLowest = (mask & 1u) ? 1.0F : 0.0F;
    h.params.playMiddle = (mask & 2u) ? 1.0F : 0.0F;
    h.params.playHighest = (mask & 4u) ? 1.0F : 0.0F;
    h.sync();
    const auto triad = chord(h, {{60, 1, 0}, {64, 1, 0}, {72, 1, 0}});
    const auto count = ((mask & 1u) != 0) + ((mask & 2u) != 0) + ((mask & 4u) != 0);
    CHECK(std::abs(triad.back() - .25F * count) < .000001F);
    h.kernel->reset();
    CHECK(chord(h, {{60, 1, 0}}).back() == ((mask & 5u) ? .25F : 0.0F));
    h.kernel->reset();
    CHECK(chord(h, {{60, 1, 0}, {72, 1, 0}}).back() ==
          .25F * (((mask & 1u) != 0) + ((mask & 4u) != 0)));
  }
  for (bool high : {false, true}) {
    Harness h;
    h.load(bank);
    h.params.playLowest = high ? 0.0F : 1.0F;
    h.params.playMiddle = 0;
    h.params.playHighest = high ? 1.0F : 0.0F;
    h.sync();
    const auto outer = high ? 72.0F : 48.0F;
    const auto farther = high ? 76.0F : 44.0F;
    const auto inside = high ? 74.0F : 46.0F;
    const auto outsideBand = high ? 69.0F : 51.0F;
    CHECK(chord(h, {{outer, .8F, -3}, {60, .6F, -10}}).back() == .25F);
    CHECK(chord(h, {{outer, .8F, -3}, {farther, .7F, -3}, {60, .6F, -10}}).back() == .25F);
    CHECK(std::abs(chord(h, {{outer, .8F, -3}, {farther, .8F, -3}, {60, .6F, -10}}).back() - .5F) <
          .000001F);
    CHECK(std::abs(chord(h, {{outer, .8F, -3}, {farther, .8F, -3}, {inside, .8F, -3}}).back() -
                   .5F) < .000001F);
    CHECK(
        std::abs(
            chord(h, {{outer, .8F, -3}, {farther, .8F, -3}, {inside, .9F, -2}, {outsideBand, 1, 0}})
                .back() -
            .75F) < .000001F);
  }
  Harness memory;
  memory.load(bank);
  memory.params.playLowest = memory.params.playMiddle = 0;
  memory.sync();
  CHECK(chord(memory, {{72, 1, 0}}).back() == .25F);
  std::vector<float> audio;
  for (unsigned i = 0; i < 20; ++i)
    audio = chord(memory, {{48, 1, 0}});
  CHECK(peak(audio) == 0); // The old release ended, but the register has not jumped to the bass.
  for (unsigned i = 0; i < 47; ++i)
    audio = chord(memory, {{48, 1, 0}});
  CHECK(audio.back() == .25F); // A held input can enter once the history catches up.
  for (unsigned i = 0; i < 30; ++i)
    chord(memory, {});
  CHECK(chord(memory, {{36, 1, 0}}).back() == .25F);

  Harness middle;
  middle.load(bank);
  middle.params.playLowest = middle.params.playHighest = 0;
  middle.sync();
  CHECK(std::abs(chord(middle, {{60, 1, 0}, {64, 1, 0}, {72, 1, 0}}).back() - .25F) < .000001F);
  // Held roles survive changes in the chord.
  CHECK(std::abs(chord(middle, {{64, 1, 0}}).back() - .25F) < .000001F);
  middle.params.playMiddle = 0;
  middle.sync();
  const auto tail = chord(middle, {{64, 1, 0}});
  CHECK(tail.front() > .2F && tail.back() < .2F);
  for (unsigned i = 0; i < 12; ++i)
    audio = chord(middle, {{64, 1, 0}});
  CHECK(peak(audio) == 0);
  middle.params.playHighest = 1;
  middle.params.octaveShift = 1;
  middle.sync();
  CHECK(chord(middle, {{64, 1, 0}}).back() == .25F);
  middle.kernel->clearAsset(0);
  CHECK(peak(chord(middle, {{64, 1, 0}})) == 0);
  middle.load(bank);
  CHECK(chord(middle, {{36, 1, 0}}).back() == .25F);
}
void timingOffset() {
  Bank bank;
  for (const float rate : {48000.0F, 96000.0F}) {
    for (const float timing : {-100.0F, 0.0F, 100.0F}) {
      Harness h(rate);
      h.load(bank);
      h.params.timingOffsetMs = timing;
      h.params.dryMix = 100;
      h.params.wetMix = 0;
      h.sync();
      const auto extra = static_cast<unsigned>(std::round(rate * .1F));
      const auto expected = h.analysis_latency + static_cast<unsigned>(std::round(rate * .01F)) +
                            (timing < 0 ? extra : 0u);
      CHECK(h.kernel->latencySamples() ==
            expected); // No process call is needed to report the target.
      std::vector<float> rendered;
      while (rendered.size() < expected + 256u) {
        const unsigned count = rendered.size() % 2u ? 128u : 63u;
        std::vector<float> block(count * 2u);
        if (rendered.empty())
          block[0] = block[count] = 1.0F;
        NoteAnalysisView view{nullptr, 0, 28, 91, count, h.time, 2, h.analysis_latency};
        h.process(block, 2, &view);
        rendered.insert(rendered.end(), block.begin(), block.begin() + count);
      }
      CHECK(rendered[expected] == 1.0F);
      CHECK(std::count(rendered.begin(), rendered.end(), 1.0F) == 1);
      h.kernel->reset();
      h.params.dryMix = 0;
      h.params.wetMix = 100;
      h.sync();
      rendered.clear();
      const auto wetDelay = timing > 0 ? extra : 0u;
      while (rendered.size() < wetDelay + static_cast<unsigned>(rate * .01F) + 512u) {
        const auto block = h.event(60, 1, 0, 128);
        rendered.insert(rendered.end(), block.begin(), block.begin() + 128);
      }
      const auto first =
          std::find_if(rendered.begin(), rendered.end(), [](float v) { return v != 0; });
      CHECK(static_cast<unsigned>(first - rendered.begin()) ==
            wetDelay + static_cast<unsigned>(rate * .01F) + 1u);
      CHECK(rendered.back() == .25F);
    }
  }
  Harness h;
  h.load(bank);
  h.params.timingOffsetMs = 100;
  h.sync();
  for (unsigned i = 0; i < 10; ++i)
    h.event(60, 1, 0, 960);
  std::vector<float> tail;
  for (unsigned i = 0; i < 12; ++i)
    tail = h.event(60, 0, 0, 960);
  CHECK(peak(tail) > 0); // The delayed release survives beyond the voice's 200ms lifetime.
  for (unsigned i = 0; i < 5; ++i)
    tail = h.event(60, 0, 0, 960);
  CHECK(peak(tail) == 0);
  for (unsigned i = 0; i < 10; ++i)
    h.event(60, 1, 0, 960);
  h.params.timingOffsetMs = -100;
  h.sync();
  const auto transition = h.event(60, 1, 0, 128);
  CHECK(std::all_of(transition.begin(), transition.end(), [](float v) { return v == .25F; }));
  h.kernel->reset();
  CHECK(peak(h.event(60, 0)) == 0);
  std::puts("SFZ note roles/history and +/-100ms timing at 48/96k: checked");
}
void assetsAndDelay() {
  for (const float volume : {29.651838F, 144.0F, 144.01F}) {
    auto r = region();
    r[Volume] = volume;
    Bank b({r});
    Harness h;
    CHECK(h.load(b) == ET_OK);
    CHECK(h.kernel->assetState(0) == static_cast<std::uint32_t>(volume <= 144.0F
                                                                    ? ET_ASSET_STATE_ACTIVE
                                                                    : ET_ASSET_STATE_ERROR));
    if (volume <= 144.0F) {
      const auto audio = h.event(60);
      CHECK(std::abs(audio[audio.size() / 2u - 1u] - .25F * std::pow(10.0F, volume * .05F)) <
            std::abs(audio[audio.size() / 2u - 1u]) * .00001F);
    }
  }
  {
    Bank b;
    Harness h;
    CHECK(h.load(b) == ET_OK);
    CHECK(peak(h.event(60)) > .2F);
    h.kernel->clearAsset(0);
    CHECK(h.kernel->assetState(0) == ET_ASSET_STATE_NONE);
    CHECK(peak(h.event(60)) == 0);
    CHECK(h.load(b) == ET_OK);
    CHECK(peak(h.event(60)) > .2F);
  }
  for (unsigned field :
       {Sample, Frames, Channels, Offset, End, LoopStart, LoopEnd, SequenceGroup}) {
    Bank b;
    b.words[8u + kHeader + field] = std::numeric_limits<float>::infinity();
    Harness h;
    h.load(b);
    CHECK(h.kernel->assetState(0) == ET_ASSET_STATE_ERROR);
    CHECK(peak(h.event(60)) == 0);
  }
  {
    Bank b;
    b.words[8u + kHeader + Offset] = .5F;
    Harness h;
    h.load(b);
    CHECK(h.kernel->assetState(0) == ET_ASSET_STATE_ERROR);
  }
  {
    Bank b;
    b.words.back() = std::numeric_limits<float>::quiet_NaN();
    Harness h;
    h.load(b);
    CHECK(h.kernel->assetState(0) == ET_ASSET_STATE_ERROR);
  }
  for (float rate : {44100.F, 48000.F, 96000.F}) {
    Harness h(rate);
    h.params.dryMix = 100;
    h.params.wetMix = 0;
    h.sync();
    const auto delay = h.kernel->latencySamples();
    const auto hop = static_cast<unsigned>(std::round(rate * .02));
    CHECK(delay == 3u * hop + (hop / 16u) * 16u + hop / 2u);
    std::vector<float> output;
    for (unsigned at = 0; at < delay + 1024; at += 128) {
      std::vector<float> a(128);
      if (at == 0)
        a[0] = 1;
      h.process(a, 1);
      output.insert(output.end(), a.begin(), a.end());
    }
    for (unsigned i = 0; i < output.size(); ++i)
      CHECK(output[i] == (i == delay ? 1.F : 0.F));
  }
}
void realAnalysisAndLinks(bool event_detection = false, bool timbre = false) {
  Harness linked, own;
  Bank bank;
  linked.load(bank);
  own.load(bank);
  linked.params.detection = own.params.detection = event_detection ? 1.0F : 0.0F;
  linked.sync();
  own.sync();
  plugins::analyzer::SpectralAnalysis producer;
  producer.setEventEnabled(event_detection);
  producer.setTimbreEnabled(timbre);
  producer.prepare({48000, 2, 1024});
  producer.configure(28, 91, false);
  bool heard = false;
  unsigned first = 0;
  for (unsigned at = 0; at < 48000; at += 128) {
    std::vector<float> a(256);
    for (unsigned i = 0; i < 128; ++i) {
      double t = (at + i) / 48000.;
      float s = 0;
      if (t >= .1 && t < .4)
        for (int harmonic = 1; harmonic <= 8; ++harmonic)
          s += static_cast<float>(
              .1 / harmonic *
              std::sin(6.283185307179586 * 261.625565 * harmonic * t + .37 * harmonic * harmonic));
      a[i] = a[i + 128] = s;
    }
    auto b = a;
    producer.process(a.data(), 2, 128, {linked.time});
    linked.process(a, 2, &producer.view());
    own.process(b);
    CHECK(a == b);
    if (!heard && peak(a) > 0) {
      heard = true;
      first = at;
    }
    if (at > 40000)
      CHECK(peak(a) == 0);
  }
  CHECK(heard);
  const auto delayMs = 1000.0 * (first / 48000.0 - .1);
  CHECK(std::abs(delayMs - 1000.0 * own.kernel->latencySamples() / 48000.0) < 20);
  // A stale producer falls back to self-analysis; leaving a link resets dormant history.
  linked.kernel->reset();
  own.kernel->reset();
  linked.time = own.time = 0;
  for (int i = 0; i < 8; ++i) {
    std::vector<float> a(256, .1F), b = a;
    linked.process(a, 2, &producer.view());
    own.process(b);
    CHECK(a == b);
  }
  auto engine = std::make_unique<Engine>();
  CHECK(engine->prepare(48000, 2, 128, 65536) == ET_OK);
  auto source = engine->createInstance("NoteSpectrogramPlugin"),
       target = engine->createInstance("SFZNotePlayerPlugin");
  CHECK(engine->setInstanceAnalysisSource(target, source) == ET_OK);
  CHECK(engine->setInstanceAnalysisSource(source, target) == ET_ERR_ARGS);
  CHECK(engine->setInstanceAnalysisSource(target, 0) == ET_OK);
  engine->destroyInstance(source);
  CHECK(engine->setInstanceAnalysisSource(target, source) == ET_ERR_ARGS);
}
void detectionSwitch() {
  Harness h;
  Bank bank;
  h.load(bank);
  const auto classic_latency = h.kernel->latencySamples();
  CHECK(peak(h.attack(60)) > 0);
  const auto hop = static_cast<unsigned>(std::round(h.rate * .02F));
  h.params.detection = 1;
  h.sync();
  CHECK(h.kernel->latencySamples() == classic_latency + 7u * hop);
  NoteAnalysisFrame classic{}, event{};
  classic.probabilities[60 - 21] = 1;
  event.probabilities[64 - 21] = 1.0F;
  event.probabilities[84 - 21] = 1.0F;
  const auto render = [&](bool start) {
    event.starts[64 - 21] = start;
    event.starts[84 - 21] = start;
    NoteAnalysisView view{&classic, 1,
                          28,       91,
                          hop,      h.time,
                          2,        h.analysis_latency,
                          &event,   h.analysis_latency + 7u * hop};
    std::vector<float> audio(2u * hop);
    h.process(audio, 2, &view);
    return audio;
  };
  // Neither classic nor event presence alone can fire in Event mode, even at confidence 1.
  CHECK(peak(render(false)) == 0);
  event.probabilities[64 - 21] = event.probabilities[84 - 21] = .2F;
  CHECK(peak(render(false)) == 0);
  event.probabilities[64 - 21] = event.probabilities[84 - 21] = 1.0F;
  CHECK(peak(render(false)) == 0);
  CHECK(peak(render(true)) > 0);
  const auto voices = h.snapshot();
  CHECK(voices[20u + 64u * 8u] == 1u);
  CHECK(voices[20u + 84u * 8u] == 1u); // C6 uses the analyzer's presence-based start.
  // Once a note ends, recovered confidence cannot synthesize another start.
  event.probabilities.fill(0);
  event.ends[64 - 21] = event.ends[84 - 21] = true;
  for (auto i = 0u; i < 16u; ++i)
    render(false);
  event.probabilities[64 - 21] = event.probabilities[84 - 21] = 1.0F;
  event.ends.fill(false);
  CHECK(peak(render(false)) == 0);
  h.params.detection = 0;
  h.sync();
  CHECK(h.kernel->latencySamples() == classic_latency);
  CHECK(peak(h.event(60, 0)) == 0);
  CHECK(peak(h.attack(60)) > 0);
  // An event-mode consumer rejects a classic-only view and analyses its silent input.
  h.params.detection = 1;
  h.sync();
  CHECK(peak(h.event(60)) == 0);
}
void eventNoteHold() {
  for (const float hold : {0.0F, 50.0F, 100.0F}) {
    Harness h;
    Bank bank;
    CHECK(h.load(bank) == ET_OK);
    h.params.detection = 1;
    h.params.threshold = .75F;
    h.params.noteHoldMs = hold;
    h.sync();
    constexpr unsigned hop = 960u;
    NoteAnalysisFrame classic{}, event{};
    const auto render = [&](float probability, bool start, bool end = false) {
      event.probabilities[39] = probability;
      event.starts[39] = start;
      event.ends[39] = end;
      NoteAnalysisView view{&classic, 1u,
                            28u,      91u,
                            hop,      h.time,
                            2u,       h.analysis_latency,
                            &event,   h.analysis_latency + 7u * hop};
      std::vector<float> audio(2u * hop);
      h.process(audio, 2u, &view);
      return audio.back();
    };
    CHECK(render(1, true) == .25F);
    render(.2F, false, true);
    // A second onset cancels the earlier stop, including its output reservation.
    CHECK(render(1, true) >= .25F);
    for (unsigned i = 0; i < 20u; ++i)
      CHECK(render(1, false) >= .25F);
    // Confirmed intervals survive a low presence score without a separate SFZ release.
    for (unsigned i = 0; i < 20u; ++i)
      CHECK(render(.55F, false) == .25F);
    // Same-key reattacks sustain even when confidence is below the Classic threshold.
    CHECK(render(.55F, true) >= .25F);
    for (unsigned i = 0; i < 20u; ++i)
      CHECK(render(.55F, false) >= .25F);
    // Confidence recovery after the hold expires must not add a new attack.
    render(.2F, false, true);
    for (unsigned i = 0; i < 20u; ++i)
      render(.2F, false);
    for (unsigned i = 0; i < 20u; ++i)
      CHECK(render(1, false) == 0);
    CHECK(render(1, true) == .25F);
  }
}
void realHighRegisterRetrigger() {
  auto r = region();
  r[Frames] = 240;
  r[End] = r[LoopEnd] = 239;
  r[LoopMode] = 0;
  r[LowKey] = r[HighKey] = r[KeyCenter] = 84;
  Bank bank({r}, 240);
  Harness retrigger, held;
  for (auto *h : {&retrigger, &held}) {
    CHECK(h->load(bank) == ET_OK);
    h->params.minimumMidi = h->params.maximumMidi = 84;
    h->params.retriggerDropDb = h == &retrigger ? 6.0F : 96.0F;
    h->sync();
  }
  auto producer = std::make_unique<plugins::analyzer::SpectralAnalysis>();
  producer->prepare({48000, 2, 128});
  producer->configure(84, 84, false);
  unsigned attacks = 0, held_attacks = 0, dip_frames = 0;
  bool sounded = false, held_sounded = false;
  float dip_probability = 1;
  for (unsigned at = 0; at < 57600; at += 128) {
    std::vector<float> audio(256);
    for (unsigned i = 0; i < 128; ++i) {
      const double t = (at + i) / 48000.0;
      const double amplitude = t < .1 || t >= 1.0 ? 0 : t >= .45 && t < .65 ? .0356 : .2;
      double value = 0;
      for (unsigned harmonic = 1; harmonic <= 8; ++harmonic)
        value +=
            amplitude / harmonic *
            std::sin(6.283185307179586 * 1046.50226 * harmonic * t + .37 * harmonic * harmonic);
      audio[i] = audio[i + 128] = static_cast<float>(value);
    }
    producer->process(audio.data(), 2, 128, {retrigger.time});
    const auto &view = producer->view();
    // The quieter interval must remain detected, so the recovery tests the level rule.
    for (unsigned i = 0; i < view.count; ++i)
      if (retrigger.time > .6 && retrigger.time < .69) {
        ++dip_frames;
        dip_probability = std::min(dip_probability, view.frames[i].probabilities[63]);
      }
    auto other = audio;
    retrigger.process(audio, 2, &view);
    held.process(other, 2, &view);
    const bool sound = peak(audio) > 0, held_sound = peak(other) > 0;
    attacks += sound && !sounded;
    held_attacks += held_sound && !held_sounded;
    sounded = sound;
    held_sounded = held_sound;
  }
  CHECK(dip_frames > 0u && dip_probability >= .5F);
  CHECK(attacks == 2u);
  CHECK(held_attacks == 1u);
}
void revisedAnalysisTiming() {
  for (const bool event_detection : {false, true})
    for (float rate : {48000.F, 96000.F})
      for (const unsigned onset_ms : {100u, 107u})
        for (const unsigned midi : {48u, 60u, 69u}) {
          Harness linked(rate), own(rate), dry(rate);
          Bank bank;
          linked.load(bank);
          own.load(bank);
          for (auto *h : {&linked, &own, &dry}) {
            h->params.detection = event_detection ? 1.0F : 0.0F;
            h->sync();
          }
          dry.params.dryMix = 100;
          dry.params.wetMix = 0;
          dry.sync();
          plugins::analyzer::SpectralAnalysis producer;
          producer.setEventEnabled(event_detection);
          producer.prepare({rate, 2, 128});
          producer.configure(28, 91, false);
          const auto onset = static_cast<unsigned>(std::round(rate * onset_ms / 1000.0));
          unsigned wet_onset = 0, dry_onset = 0, detection = 0;
          for (unsigned at = 0; at < static_cast<unsigned>(rate * .45F); at += 128) {
            std::vector<float> audio(256);
            for (unsigned i = 0; i < 128; ++i) {
              double value = 0;
              if (at + i >= onset)
                for (unsigned harmonic = 1; harmonic <= 8; ++harmonic)
                  value += .1 / harmonic *
                           std::sin(6.283185307179586 * 440 *
                                        std::exp2((static_cast<double>(midi) - 69) / 12) *
                                        harmonic * (at + i) / rate +
                                    .37 * harmonic * harmonic);
              audio[i] = audio[i + 128] = static_cast<float>(value);
            }
            auto self = audio, original = audio;
            producer.process(audio.data(), 2, 128, {linked.time});
            const auto &view = producer.view();
            CHECK(view.latencySamples == linked.analysis_latency);
            const auto *detected = event_detection ? view.eventFrames : view.frames;
            for (unsigned i = 0; i < view.count; ++i)
              if (!detection && detected[i].probabilities[midi - 21] >= .5F)
                detection = at + detected[i].sampleOffset;
            linked.process(audio, 2, &view);
            own.process(self);
            dry.process(original, 2, &view);
            CHECK(audio == self);
            for (unsigned i = 0; i < 128; ++i) {
              if (!wet_onset && audio[i] != 0)
                wet_onset = at + i;
              if (!dry_onset && original[i] != 0)
                dry_onset = at + i;
            }
          }
          CHECK(detection != 0 && wet_onset != 0);
          CHECK(dry_onset == onset + dry.kernel->latencySamples());
          // Attack detection may refine the frame position; compare the audible paths.
          const auto residual = static_cast<int>(wet_onset) - static_cast<int>(dry_onset);
          CHECK(std::abs(residual) <= static_cast<int>(std::round(rate * .04F)));
        }
  // A mismatched shared source must fall back to this input's own analysis.
  for (const bool wrong_channels : {false, true}) {
    Harness h;
    Bank bank;
    h.load(bank);
    NoteAnalysisFrame frame{};
    frame.probabilities[39] = 1;
    NoteAnalysisView view{&frame,
                          1,
                          28,
                          91,
                          128,
                          h.time,
                          wrong_channels ? 1u : 2u,
                          h.analysis_latency + (wrong_channels ? 0u : 16u)};
    std::vector<float> audio(256);
    h.process(audio, 2, &view);
    CHECK(peak(audio) == 0);
  }
}
void performance() {
  auto r = region();
  r[LowKey] = r[HighKey] = 60;
  Bank bank(std::vector<Region>(128, r));
  Harness h(96000);
  h.params.maxVoices = 128;
  h.params.threshold = .01F;
  h.sync();
  h.load(bank);
  h.event(60);
  const std::array<unsigned, 4> blocks = {16, 63, 128, 17};
  unsigned processed = 0, index = 0;
  double maximum = 0;
  const auto start = std::chrono::steady_clock::now();
  while (processed < 48000) {
    auto frames = blocks[index++ % blocks.size()];
    std::vector<float> a(frames * 2);
    for (unsigned i = 0; i < frames; ++i) {
      float sample = 0;
      for (int harmonic = 1; harmonic <= 8; ++harmonic)
        sample += static_cast<float>(
            .1 / harmonic *
            std::sin(6.283185307179586 * 261.625565 * harmonic * (processed + i) / 96000.0 +
                     .37 * harmonic * harmonic));
      a[i] = a[frames + i] = sample;
    }
    const auto before = std::chrono::steady_clock::now();
    h.process(a);
    maximum = std::max(maximum, std::chrono::duration<double, std::milli>(
                                    std::chrono::steady_clock::now() - before)
                                    .count());
    if (processed > 24000)
      CHECK(peak(a) > 20.0F);
    processed += frames;
  }
  const auto elapsed =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
  std::printf("SFZ 96k 128 voices irregular: %.3f ms / 500ms audio; peak %.3fms\n", elapsed,
              maximum);
}
double toneAmplitude(const std::vector<float> &samples, double frequency) {
  constexpr double pi = 3.14159265358979323846;
  double real = 0.0, imaginary = 0.0, weight = 0.0;
  for (std::size_t frame = 0; frame < samples.size(); ++frame) {
    const auto window = .5 - .5 * std::cos(2.0 * pi * frame / samples.size());
    const auto angle = 2.0 * pi * frequency * frame;
    real += samples[frame] * window * std::cos(angle);
    imaginary += samples[frame] * window * std::sin(angle);
    weight += window;
  }
  return 2.0 * std::sqrt(real * real + imaginary * imaginary) / weight;
}
void antiAliasing() {
  constexpr unsigned sampleFrames = 131072u, measurementFrames = 4096u;
  constexpr double pi = 3.14159265358979323846;
  for (const auto rate : {48000.0F, 96000.0F}) {
    for (const auto step : {1.5, 2.0, 4.0, 8.0, 16.0}) {
      auto r = region();
      r[Frames] = sampleFrames;
      r[End] = r[LoopEnd] = sampleFrames - 1u;
      r[Rate] = static_cast<float>(rate * (step > 8.0 ? step / 2.0 : step));
      r[Transpose] = step > 8.0 ? 12.0F : 0.0F;
      r[KeyTrack] = 0;
      r[LoopMode] = 0;
      Bank bank({r}, sampleFrames);
      for (unsigned frame = 0; frame < sampleFrames; ++frame)
        bank.words[bank.words.size() - sampleFrames + frame] =
            static_cast<float>(.25 * std::sin(2.0 * pi * .125 * frame / step) +
                               .25 * std::sin(2.0 * pi * .501 * frame / step) +
                               .25 * std::sin(2.0 * pi * .6 * frame / step));
      Harness h(rate);
      CHECK(h.load(bank) == ET_OK);
      h.event(60, 1, 0, 1024);
      std::vector<float> output;
      for (unsigned block = 0; block < measurementFrames / 1024u; ++block) {
        const auto audio = h.event(60, 1, 0, 1024);
        output.insert(output.end(), audio.begin(), audio.begin() + 1024u);
      }
      const auto pass = toneAmplitude(output, .125), folded = toneAmplitude(output, .4),
                 near_nyquist = toneAmplitude(output, .499);
      std::printf("SFZ %.0fk step %.1f: pass %.6f, folded %.2f dB, Nyquist %.2f dB\n", rate / 1000,
                  step, pass, 20.0 * std::log10(folded / .25),
                  20.0 * std::log10(near_nyquist / .25));
      CHECK(std::abs(pass - .25) < .002);
      CHECK(folded < .00025);
      CHECK(near_nyquist < .00025);
    }
    // An offset loop crosses both FIR boundaries; fractional phases must retain stereo separation.
    auto r = region();
    r[Frames] = 12040;
    r[Channels] = 2;
    r[Rate] = 44100;
    r[Transpose] = rate == 48000.0F ? 12.0F : 24.0F;
    r[KeyTrack] = 0;
    r[Offset] = r[LoopStart] = 37;
    r[End] = r[LoopEnd] = 11796;
    const auto step = 1.8375;
    Bank bank({r}, 24080);
    auto *pcm = bank.words.data() + bank.words.size() - 24080;
    for (unsigned frame = 0; frame < 12040; ++frame) {
      const auto phase = static_cast<double>(frame) - 37.0;
      pcm[2u * frame] = static_cast<float>(.25 * std::sin(2.0 * pi * .125 * phase / step) +
                                           .25 * std::sin(2.0 * pi * .6 * phase / step));
      pcm[2u * frame + 1u] = static_cast<float>(.2 * std::cos(2.0 * pi * .0625 * phase / step) +
                                                .2 * std::cos(2.0 * pi * .6 * phase / step));
    }
    Harness h(rate);
    CHECK(h.load(bank) == ET_OK);
    for (unsigned block = 0; block < 16; ++block)
      h.event(60, 1, 0, 1024);
    std::vector<float> left, right;
    for (unsigned block = 0; block < 4; ++block) {
      const auto audio = h.event(60, 1, 0, 1024);
      left.insert(left.end(), audio.begin(), audio.begin() + 1024);
      right.insert(right.end(), audio.begin() + 1024, audio.end());
    }
    CHECK(std::abs(toneAmplitude(left, .125) - .25) < .002);
    CHECK(std::abs(toneAmplitude(right, .0625) - .2) < .002);
    CHECK(toneAmplitude(left, .4) < .00025);
    CHECK(toneAmplitude(right, .4) < .0002);
    CHECK(toneAmplitude(right, .125) < .0002);
  }
  // Upsampling must suppress interpolation images as well as downsampling aliases.
  auto r = region();
  r[Frames] = 12000;
  r[End] = r[LoopEnd] = 11999;
  Bank up({r}, 12000);
  for (unsigned frame = 0; frame < 12000; ++frame)
    up.words[up.words.size() - 12000 + frame] =
        static_cast<float>(.25 * std::sin(2.0 * pi * .35 * frame));
  Harness higherRate(96000);
  CHECK(higherRate.load(up) == ET_OK);
  higherRate.event(60, 1, 0, 1024);
  std::vector<float> output;
  for (unsigned block = 0; block < 4; ++block) {
    const auto audio = higherRate.event(60, 1, 0, 1024);
    output.insert(output.end(), audio.begin(), audio.begin() + 1024);
  }
  CHECK(std::abs(toneAmplitude(output, .175) - .25) < .002);
  CHECK(toneAmplitude(output, .325) < .00025);

  // Extreme valid SFZ tuning must remain finite for loops and finite samples.
  r = region();
  r[KeyCenter] = 0;
  r[KeyTrack] = 1200;
  r[Transpose] = 127;
  Harness extreme;
  extreme.params.minimumMidi = extreme.params.maximumMidi = 108;
  extreme.sync();
  Bank dc({r});
  CHECK(extreme.load(dc) == ET_OK);
  CHECK(std::abs(extreme.attack(108, 1, 0, 256).back() - .25F) < .000001F);
  r[LoopMode] = 0;
  Bank finite({r});
  CHECK(extreme.load(finite) == ET_OK);
  CHECK(peak(extreme.attack(108, 1, 0, 256)) == 0);
  // A short ultrasonic loop must not replace its still-audible introductory samples.
  r = region();
  r[Frames] = 8192;
  r[End] = r[LoopEnd] = 4099;
  r[LoopStart] = 4096;
  r[Transpose] = 48;
  Bank introduction({r}, 8192);
  std::fill_n(introduction.words.data() + introduction.words.size() - 8192 + 4096, 4, -.25F);
  Harness intro;
  CHECK(intro.load(introduction) == ET_OK);
  CHECK(std::abs(intro.attack(60, 1, 0, 256)[128] - .25F) < .000001F);
  CHECK(std::abs(intro.event(60, 1, 0, 256).back() + .25F) < .000001F);
  // Different layer tunings fill the cache; stealing all voices must safely reuse its slots.
  std::vector<Region> layers;
  for (unsigned layer = 0; layer < 128; ++layer) {
    auto tuned = region();
    tuned[KeyTrack] = 0;
    tuned[Tune] = static_cast<float>(layer) * 5.0F;
    layers.push_back(tuned);
  }
  Harness many;
  many.params.maxVoices = 128;
  many.sync();
  Bank tuned(layers);
  CHECK(many.load(tuned) == ET_OK);
  CHECK(std::abs(many.attack(60, 1, 0, 256).back() - 32.0F) < .001F);
  many.params.octaveShift = 1;
  many.sync();
  many.event(60, 0, 0, 256);
  CHECK(std::abs(many.attack(61, 1, 0, 256).back() - 32.0F) < .001F);
  for (const auto step : {2.0F, 8.0F}) {
    auto layer = region();
    layer[Rate] = 96000.0F * step;
    layer[KeyTrack] = 0;
    Bank bank(std::vector<Region>(128u, layer));
    Harness h(96000.0F);
    h.params.maxVoices = 128;
    h.sync();
    CHECK(h.load(bank) == ET_OK);
    h.attack(60, 1, 0, 256);
    const auto before = std::chrono::steady_clock::now();
    for (unsigned block = 0; block < 16; ++block)
      CHECK(peak(h.event(60, 1, 0, 256)) > 31.0F);
    const auto elapsed =
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - before)
            .count();
    std::printf("SFZ 96k 128 filtered voices step %.0f: %.3f ms / 42.7ms audio\n", step, elapsed);
  }
}
struct AssetEngineHarness {
  std::unique_ptr<Engine> engine = std::make_unique<Engine>();
  et_instance player = 0u, source = 0u, volume = 0u;
  std::uint64_t frames = 0u;
  std::uint32_t latency = 0u;
  AssetEngineHarness() {
    CHECK(engine->prepare(48000, 2u, 128u, 0u) == ET_OK);
    source = engine->createInstance("NoteSpectrogramPlugin");
    player = engine->createInstance("SFZNotePlayerPlugin");
    volume = engine->createInstance("VolumePlugin");
    const generated::NoteSpectrogramPluginParams analysis{83, 83, 0, 0};
    const generated::SFZNotePlayerPluginParams params{.01F, -30, 3, 83, 83, 32, 0, 100, 0,   0,
                                                      1,    1,   1, 0,  18, 0,  0, -1,  100, 0};
    const generated::VolumePluginParams gain{-6.020599913F};
    CHECK(engine->setInstanceParams(source, reinterpret_cast<const float *>(&analysis),
                                    analysis.kFloatCount, analysis.kHash, 0u) == ET_OK);
    CHECK(engine->setInstanceParams(player, reinterpret_cast<const float *>(&params),
                                    params.kFloatCount, params.kHash, 0u) == ET_OK);
    CHECK(engine->setInstanceParams(volume, reinterpret_cast<const float *>(&gain),
                                    gain.kFloatCount, gain.kHash, 0u) == ET_OK);
    CHECK(engine->setInstanceAnalysisSource(player, source) == ET_OK);
    std::array<std::uint8_t, 8u + 3u * 12u> pipeline{};
    binary_io::writeU32(pipeline.data(), 1u);
    binary_io::writeU32(pipeline.data() + 4u, 3u);
    const std::array instances{source, player, volume};
    for (std::size_t i = 0u; i < instances.size(); ++i) {
      auto *record = pipeline.data() + 8u + i * 12u;
      binary_io::writeU32(record, instances[i]);
      record[4] = record[8] = 1u;
      record[7] = 254u;
    }
    CHECK(engine->configurePipeline(pipeline.data(), static_cast<std::uint32_t>(pipeline.size())) ==
          ET_OK);
    latency = engine->pipelineLatency();
  }
  Engine::InstanceAssetSnapshot capture() {
    Engine::InstanceAssetSnapshot snapshot;
    allocation_guard::Scope guard;
    CHECK(engine->captureInstanceAssetSnapshot(player, 0u, snapshot) == ET_OK);
    return snapshot;
  }
  static et_status prepare(const Engine::InstanceAssetSnapshot &snapshot, const Bank &bank,
                           Engine::InstanceAssetUpdate &update) {
    return Engine::prepareInstanceAssetUpdate(
        snapshot, bank.info(), reinterpret_cast<const std::uint8_t *>(bank.words.data()),
        bank.info().byteSize, ET_ASSET_F32_MULTICH, update);
  }
  void install(const Bank &bank) {
    const bool had_bank = engine->instanceAssetState(player, 0u) != ET_ASSET_STATE_NONE;
    auto snapshot = capture();
    Engine::InstanceAssetUpdate update;
    CHECK(prepare(snapshot, bank, update) == ET_OK);
    {
      allocation_guard::Scope guard;
      CHECK(engine->applyInstanceAssetUpdate(update) == ET_OK);
      CHECK(engine->instanceAssetState(player, 0u) == ET_ASSET_STATE_ACTIVE);
      CHECK(engine->pipelineLatency() == latency);
      CHECK(update.hasRetiredAsset() == had_bank);
    }
    update.reclaim();
  }
  float process() {
    for (auto frame = 0u; frame < 128u; ++frame) {
      const auto input =
          static_cast<float>(.2 * std::sin(6.28318530717958647692 * 1000.0 *
                                           static_cast<double>(frames + frame) / 48000.0));
      engine->combined()[frame] = engine->combined()[128u + frame] = input;
    }
    CHECK(engine->processPipeline(2u, 128u, static_cast<double>(frames) / 48000.0, 0u) == ET_OK);
    frames += 128u;
    return engine->combined()[255u];
  }
  void expect(float value, unsigned blocks = 1u) {
    for (unsigned i = 0u; i < blocks; ++i)
      CHECK(std::abs(process() - value) < 1e-5F);
  }
  void settle() {
    for (auto i = 0u; i < 256u; ++i)
      process();
  }
};

void preparedAssetContinuity() {
  auto r = region();
  r[KeyCenter] = 83;
  Bank original({r}), large({r}, 4u * 1024u * 1024u);
  std::fill(large.words.begin() + 8u + kHeader + kStride, large.words.end(), .5F);
  AssetEngineHarness h;
  h.install(original);
  h.settle();
  h.expect(.125F);
  auto snapshot = h.capture();
  Engine::InstanceAssetUpdate update;
  std::latch allow_preparation(1), prepared(1), allow_retirement(1), retired(1);
  et_status status = ET_ERR_STATE;
  bool retired_on_control = false;
  const auto violations = allocation_guard::violationCount();
  std::thread control([&] {
    allow_preparation.wait();
    status = h.prepare(snapshot, large, update);
    prepared.count_down();
    allow_retirement.wait();
    retired_on_control = !allocation_guard::active() && update.hasRetiredAsset();
    update.reclaim();
    retired_on_control = retired_on_control && !update.hasRetiredAsset();
    retired.count_down();
  });
  {
    allocation_guard::Scope guard;
    // An arbitrarily stalled preparation must never suppress any wet callback.
    h.expect(.125F, 512u);
    allow_preparation.count_down();
    h.expect(.125F, 128u);
    prepared.wait();
    CHECK(status == ET_OK);
    h.expect(.125F, 32u);
    CHECK(h.engine->applyInstanceAssetUpdate(update) == ET_OK);
    CHECK(update.hasRetiredAsset());
    CHECK(h.engine->instanceAssetState(h.player, 0u) == ET_ASSET_STATE_ACTIVE);
    CHECK(h.engine->pipelineLatency() == h.latency);
    // Control may reclaim before the first callback using the replacement bank.
    allow_retirement.count_down();
    h.settle();
    h.expect(.25F, 128u);
    retired.wait();
  }
  control.join();
  CHECK(retired_on_control);
  CHECK(allocation_guard::violationCount() == violations);
  std::puts("SFZ paused preparation: 512 wet callbacks, shared analysis, downstream gain, control "
            "retirement");
}

void preparedAssetUpdatesAndFailures() {
  auto r = region();
  r[KeyCenter] = 83;
  Bank original({r}), replacement({r});
  std::fill(replacement.words.begin() + 8u + kHeader + kStride, replacement.words.end(), .5F);
  AssetEngineHarness h;
  h.install(original);
  h.settle();
  const auto violations = allocation_guard::violationCount();
  Engine::InstanceAssetSnapshot invalid;
  Engine::InstanceAssetUpdate update, stale;
  CHECK(h.prepare(invalid, original, update) == ET_ERR_STATE);
  CHECK(h.engine->applyInstanceAssetUpdate(update) == ET_ERR_STATE);
  CHECK(h.engine->captureInstanceAssetSnapshot(h.player, 1u, invalid) == ET_ERR_UNSUPPORTED);
  CHECK(h.engine->captureInstanceAssetSnapshot(h.volume, 0u, invalid) == ET_ERR_UNSUPPORTED);
  CHECK(h.engine->captureInstanceAssetSnapshot(0u, 0u, invalid) == ET_ERR_ARGS);
  h.expect(.125F);

  auto snapshot = h.capture();
  CHECK(h.prepare(snapshot, replacement, stale) == ET_OK);
  snapshot = h.capture();
  CHECK(h.prepare(snapshot, original, update) == ET_OK);
  CHECK(h.engine->applyInstanceAssetUpdate(stale) == ET_ERR_STATE);
  h.expect(.125F);
  CHECK(h.engine->applyInstanceAssetUpdate(update) == ET_OK);
  CHECK(h.engine->applyInstanceAssetUpdate(update) == ET_ERR_STATE);
  stale.reclaim();
  update.reclaim();
  h.settle();

  // A newer failed request supersedes old work without touching the current bank.
  snapshot = h.capture();
  CHECK(h.prepare(snapshot, replacement, stale) == ET_OK);
  snapshot = h.capture();
  for (auto field : {Volume, Channels, SequenceGroup}) {
    Bank bad({r});
    bad.words[8u + kHeader + field] = std::numeric_limits<float>::infinity();
    CHECK(h.prepare(snapshot, bad, update) == ET_ERR_ARGS);
    CHECK(h.engine->applyInstanceAssetUpdate(update) == ET_ERR_STATE);
    CHECK(h.engine->instanceAssetState(h.player, 0u) == ET_ASSET_STATE_ACTIVE);
    h.expect(.125F);
  }
  Bank bad_pcm({r});
  bad_pcm.words.back() = std::numeric_limits<float>::quiet_NaN();
  CHECK(h.prepare(snapshot, bad_pcm, update) == ET_ERR_ARGS);
  Bank bad_header({r});
  bad_header.words[8u] = 0;
  CHECK(h.prepare(snapshot, bad_header, update) == ET_ERR_ARGS);
  Bank bad_index({r});
  bad_index.footprint = bad_index.info().byteSize + 131u * 4u;
  CHECK(h.prepare(snapshot, bad_index, update) == ET_ERR_ARGS);
  auto info = original.info();
  CHECK(Engine::prepareInstanceAssetUpdate(snapshot, info, nullptr, info.byteSize, 1u, update) ==
        ET_ERR_ARGS);
  CHECK(Engine::prepareInstanceAssetUpdate(
            snapshot, info, reinterpret_cast<const std::uint8_t *>(original.words.data()),
            info.byteSize - 4u, 1u, update) == ET_ERR_ARGS);
  CHECK(Engine::prepareInstanceAssetUpdate(
            snapshot, info, reinterpret_cast<const std::uint8_t *>(original.words.data()),
            info.byteSize, 999u, update) == ET_ERR_ARGS);
  CHECK(h.engine->applyInstanceAssetUpdate(stale) == ET_ERR_STATE);
  stale.reclaim();
  if ((et_build_flags() & ET_BUILD_DEBUG) != 0u)
    for (std::int32_t allocation = 0; allocation < 3; ++allocation) {
      allocation_guard::failNothrowAllocationAfterForTesting(allocation);
      CHECK(h.prepare(snapshot, replacement, update) == ET_ERR_OOM);
      allocation_guard::failNothrowAllocationAfterForTesting(-1);
      CHECK(h.engine->applyInstanceAssetUpdate(update) == ET_ERR_STATE);
      h.expect(.125F);
    }

  for (unsigned i = 0u; i < 6u; ++i) {
    h.install(i % 2u == 0u ? replacement : original);
    h.settle();
    h.expect(i % 2u == 0u ? .25F : .125F);
  }
  for (unsigned i = 0u; i < 12u; ++i) {
    snapshot = h.capture();
    CHECK(h.prepare(snapshot, replacement, update) == ET_OK);
    // Prepared storage must own a copy, independent of the caller's payload.
    replacement.words.back() = std::numeric_limits<float>::quiet_NaN();
    {
      allocation_guard::Scope guard;
      CHECK(h.engine->applyInstanceAssetUpdate(update) == ET_OK);
      CHECK(update.hasRetiredAsset() == (i == 0u));
    }
    replacement.words.back() = .5F;
    update.reclaim();
    h.settle();
    h.expect(.25F);
    snapshot = h.capture();
    CHECK(Engine::prepareInstanceAssetClear(snapshot, update) == ET_OK);
    {
      allocation_guard::Scope guard;
      // No callback is needed to install a clear while the host is stopped.
      CHECK(h.engine->applyInstanceAssetUpdate(update) == ET_OK);
      CHECK(update.hasRetiredAsset());
      CHECK(h.engine->instanceAssetState(h.player, 0u) == ET_ASSET_STATE_NONE);
      CHECK(h.engine->pipelineLatency() == h.latency);
    }
    update.reclaim();
    h.expect(0.0F, 8u);
  }
  CHECK(allocation_guard::violationCount() == violations);
}

void preparedAssetLifetime() {
  Bank bank;
  Engine::InstanceAssetUpdate stale, clear, retired;
  Engine::InstanceAssetSnapshot snapshot;
  auto engine = std::make_unique<Engine>();
  CHECK(engine->prepare(48000, 2u, 128u, 0u) == ET_OK);
  auto instance = engine->createInstance("SFZNotePlayerPlugin");
  const auto prepare = [&](Engine::InstanceAssetUpdate &update) {
    CHECK(engine->captureInstanceAssetSnapshot(instance, 0u, snapshot) == ET_OK);
    CHECK(AssetEngineHarness::prepare(snapshot, bank, update) == ET_OK);
  };
  prepare(retired);
  // A different Engine cannot adopt an update with an identical instance ID.
  auto other = std::make_unique<Engine>();
  CHECK(other->prepare(48000, 2u, 128u, 0u) == ET_OK);
  CHECK(other->createInstance("SFZNotePlayerPlugin") == instance);
  CHECK(other->applyInstanceAssetUpdate(retired) == ET_ERR_STATE);
  CHECK(engine->applyInstanceAssetUpdate(retired) == ET_OK);
  CHECK(!retired.hasRetiredAsset());
  prepare(stale);
  CHECK(engine->captureInstanceAssetSnapshot(instance, 0u, snapshot) == ET_OK);
  CHECK(Engine::prepareInstanceAssetClear(snapshot, clear) == ET_OK);
  CHECK(engine->applyInstanceAssetUpdate(stale) == ET_ERR_STATE);
  CHECK(engine->applyInstanceAssetUpdate(clear) == ET_OK);
  CHECK(clear.hasRetiredAsset());
  CHECK(engine->instanceAssetState(instance, 0u) == ET_ASSET_STATE_NONE);
  stale.reclaim();
  CHECK(engine->captureInstanceAssetSnapshot(instance, 0u, snapshot) == ET_OK);
  CHECK(Engine::prepareInstanceAssetClear(snapshot, stale) == ET_OK);
  prepare(retired);
  CHECK(engine->applyInstanceAssetUpdate(stale) == ET_ERR_STATE);
  CHECK(engine->applyInstanceAssetUpdate(retired) == ET_OK);
  stale.reclaim();
  prepare(stale);
  CHECK(engine->resetInstance(instance) == ET_OK);
  CHECK(engine->applyInstanceAssetUpdate(stale) == ET_ERR_STATE);
  prepare(stale);
  CHECK(engine->reset() == ET_OK);
  CHECK(engine->applyInstanceAssetUpdate(stale) == ET_ERR_STATE);
  prepare(stale);
  engine->abortInstanceAsset(instance, 0u);
  CHECK(engine->applyInstanceAssetUpdate(stale) == ET_ERR_STATE);
  prepare(stale);
  engine->destroyInstance(instance);
  instance = engine->createInstance("SFZNotePlayerPlugin");
  CHECK(engine->applyInstanceAssetUpdate(stale) == ET_ERR_STATE);
  CHECK(engine->instanceAssetState(instance, 0u) == ET_ASSET_STATE_NONE);
  prepare(stale);
  CHECK(engine->prepare(48000, 2u, 128u, 0u) == ET_OK);
  instance = engine->createInstance("SFZNotePlayerPlugin");
  CHECK(engine->applyInstanceAssetUpdate(stale) == ET_ERR_STATE);
  CHECK(engine->instanceAssetState(instance, 0u) == ET_ASSET_STATE_NONE);
  prepare(stale);
  CHECK(engine->applyInstanceAssetUpdate(stale) == ET_OK);
  prepare(retired);
  CHECK(engine->applyInstanceAssetUpdate(retired) == ET_OK);
  CHECK(retired.hasRetiredAsset());
  CHECK(engine->captureInstanceAssetSnapshot(instance, 0u, snapshot) == ET_OK);
  engine.reset();
  // Neither preparing from a copied snapshot nor releasing updates dereferences Engine.
  CHECK(AssetEngineHarness::prepare(snapshot, bank, stale) == ET_OK);
  clear.reclaim();
  retired.reclaim();
  stale.reclaim();
}

void preparedAssetEngineReplacement() {
  Bank bank;
  auto engine = std::make_unique<Engine>();
  Engine::InstanceAssetSnapshot snapshot;
  Engine::InstanceAssetUpdate current, stale, next;
  const auto create = [&] {
    CHECK(engine->prepare(48000, 2u, 128u, 0u) == ET_OK);
    return engine->createInstance("SFZNotePlayerPlugin");
  };
  const auto install = [&](et_instance instance) {
    CHECK(engine->captureInstanceAssetSnapshot(instance, 0u, snapshot) == ET_OK);
    CHECK(AssetEngineHarness::prepare(snapshot, bank, current) == ET_OK);
    CHECK(engine->applyInstanceAssetUpdate(current) == ET_OK);
  };
  const auto old_instance = create();
  install(old_instance);
  CHECK(engine->captureInstanceAssetSnapshot(old_instance, 0u, snapshot) == ET_OK);
  CHECK(AssetEngineHarness::prepare(snapshot, bank, stale) == ET_OK);
  // State replacement can reuse both the Engine address and its first instance ID.
  engine->~Engine();
  new (engine.get()) Engine();
  const auto instance = create();
  CHECK(instance == old_instance);
  install(instance);
  CHECK(engine->captureInstanceAssetSnapshot(instance, 0u, snapshot) == ET_OK);
  CHECK(AssetEngineHarness::prepare(snapshot, bank, next) == ET_OK);
  CHECK(engine->applyInstanceAssetUpdate(stale) == ET_ERR_STATE);
  CHECK(engine->instanceAssetState(instance, 0u) == ET_ASSET_STATE_ACTIVE);
  CHECK(engine->applyInstanceAssetUpdate(next) == ET_OK);
}
} // namespace
int main() {
  onsetRule();
  onsetBoundary();
  onsetHoldAndReservations();
  preparedAssetContinuity();
  preparedAssetUpdatesAndFailures();
  preparedAssetLifetime();
  preparedAssetEngineReplacement();
  playback();
  voiceTelemetry();
  manualPreview();
  releaseTail();
  octaveShift();
  sampleShift();
  independentDryWet();
  sustainedOnset();
  retriggerDrop();
  noteHold();
  noteSelection();
  timingOffset();
  assetsAndDelay();
  realAnalysisAndLinks();
  realAnalysisAndLinks(true);
  realAnalysisAndLinks(true, true);
  detectionSwitch();
  eventNoteHold();
  realHighRegisterRetrigger();
  revisedAnalysisTiming();
  performance();
  antiAliasing();
  return failures ? 1 : 0;
}

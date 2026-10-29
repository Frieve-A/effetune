#include "allocation_guard.h"
#include "drum_decoder.h"
#include "effetune/kernel.h"
#include "rd6_clock.h"
#include "rd6_decoder.h"
#include "rd6_engine.h"
#include "tc_tcn.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <vector>
#if defined(_M_X64) || defined(__x86_64__)
#include <xmmintrin.h>
#endif

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_RhythmAnalyzerPlugin() noexcept;
namespace {
using namespace effetune::plugins::analyzer::rhythm_a3;
int failures = 0;
void check(bool result, const char *expression, int line) {
  if (!result) {
    std::fprintf(stderr, "rhythm_analyzer:%d %s\n", line, expression);
    ++failures;
  }
}
#define CHECK(value) check(static_cast<bool>(value), #value, __LINE__)
std::uint32_t u32(const std::uint8_t *p) {
  return p[0] | (std::uint32_t(p[1]) << 8u) | (std::uint32_t(p[2]) << 16u) |
         (std::uint32_t(p[3]) << 24u);
}
float f32(const std::uint8_t *p) {
  const auto bits = u32(p);
  float out;
  std::memcpy(&out, &bits, 4u);
  return out;
}
struct Harness {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_RhythmAnalyzerPlugin();
  alignas(std::max_align_t) std::array<std::byte, 8192> storage{};
  effetune::PluginKernel *kernel = descriptor->construct(storage.data());
  std::array<std::uint8_t, 16384> ringStorage{}, packets{};
  effetune::TelemetryRing ring;
  std::array<float, 4> params{40.0f, 240.0f, 0.0f, 0.0f};
  std::uint32_t sequence = 0u;
  explicit Harness(float rate) {
    CHECK(descriptor->objectSize <= storage.size());
    kernel->prepare({rate, 4u, 1024u});
    CHECK(kernel->preparedSuccessfully());
    ring.adopt(ringStorage.data(), static_cast<std::uint32_t>(ringStorage.size()));
    apply();
  }
  ~Harness() { descriptor->destroy(kernel); }
  void apply() {
    CHECK(kernel->stageParameters(params.data(), 4u, descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }
  const std::uint8_t *take() {
    effetune::TelemetryWriter writer(ring, 207u, sequence);
    {
      const effetune::allocation_guard::Scope guard;
      kernel->writeTelemetry(writer);
    }
    std::uint32_t dropped = 0u;
    const auto bytes =
        ring.read(packets.data(), static_cast<std::uint32_t>(packets.size()), &dropped);
    CHECK(dropped == 0u);
    if (bytes == 0u)
      return nullptr;
    CHECK(bytes == 2040u && packets[0] == 28u && packets[2] == 5u);
    const auto *p = packets.data() + 16u;
    CHECK(u32(p + 28u) <= 16u);
    CHECK(u32(p + 1500u) <= 16u);
    CHECK(u32(p + 24u) == 0u);
    CHECK(u32(p + 1344u) <= 12u);
    CHECK(std::isfinite(f32(p + 1348u)) && f32(p + 1348u) >= 0.0f);
    for (std::uint32_t i = 0u; i < u32(p + 1344u); ++i) {
      const auto *slot = p + 1352u + 12u * i;
      CHECK(f32(slot + 4u) >= 0.0f && f32(slot + 4u) < 1.0f);
      if (i != 0u)
        CHECK(u32(slot + 8u) == u32(slot - 12u + 8u) + 1u);
    }
    CHECK(std::isfinite(f32(p + 40u)) && f32(p + 40u) >= 0.0f && f32(p + 40u) <= 1.0f);
    for (std::uint32_t i = 0u; i < 192u; ++i)
      CHECK(f32(p + 64u + 4u * i) >= 0.0f && f32(p + 64u + 4u * i) <= 1.0f);
    for (std::uint32_t i = 0u; i < u32(p + 28u); ++i) {
      const auto *slot = p + 832u + i * 32u;
      CHECK(slot[29] <= 5u && slot[30] == 0u && slot[31] == 0u);
      CHECK(f32(slot + 4u) >= 0.0f && f32(slot + 4u) < 1.0f);
    }
    return p;
  }
};
void provisionalClockContract() {
  ProvisionalClock clock;
  auto forward = [&](double time, double period, std::int64_t index, std::uint32_t epoch = 1u) {
    clock.forward({time, 0.0, period, epoch, index});
  };
  auto anchor = [&](double time, double period, std::int64_t index, std::uint32_t epoch = 1u) {
    clock.commit({time, 0.0, period, epoch, index});
  };
  auto at = [&](double time, double expected, double expectedPeriod) {
    double position = 0.0, period = 0.0;
    CHECK(clock.annotate(time, position, period));
    CHECK(std::fabs(position - expected) < 1e-12);
    CHECK(std::fabs(period - expectedPeriod) < 1e-12);
  };
  double position = 0.0, period = 0.0;
  CHECK(!clock.annotate(0.0, position, period));
  forward(1.0, .5, 7);
  forward(1.6, .6, 8);
  at(.75, 6.5, .5);
  at(1.3, 7.5, .6);
  at(2.2, 9.0, .6);
  forward(2.1, .5, 9);
  anchor(1.02, .5, 10);
  at(1.31, 10.5, .58);
  at(2.35, 12.5, .5);
  CHECK(!clock.annotate(.9, position, period));
  clock.reset();
  forward(1.02, .5, 7);
  forward(1.5, .5, 8);
  anchor(1.0, .5, 10);
  at(1.25, 10.5, .5);
  anchor(1.0, .5, 0, 2u);
  at(1.25, .5, .5);
  forward(3.0, .5, 0, 2u);
  at(3.25, .5, .5);
  clock.reset();
  forward(.75, 1.0, 7);
  forward(1.25, 1.0, 8);
  anchor(1.0, 1.0, 10);
  at(1.25, 11.0, .25);
  clock.reset();
  forward(1.15, .5, 7);
  anchor(1.0, .2, 10);
  at(1.15, 11.0, .15);
  clock.reset();
  forward(1.02, .5, 7);
  forward(1.5, .5, 8);
  anchor(1.0, 0.0, 0);
  at(1.25, .5, .5);
  clock.reset();
  forward(1.0, .5, 0);
  forward(1.0, .5, 1);
  forward(1.5, .5, 2);
  at(1.25, .5, .5);
  clock.reset();
  CHECK(!clock.annotate(1.5, position, period));
}
void halfContract() {
  for (std::uint32_t bits = 0u; bits < 0x7c00u; ++bits) {
    const auto half = static_cast<std::uint16_t>(bits);
    CHECK(tcFloatToHalf(tcHalfToFloat(half)) == half);
  }
#if defined(_M_X64) || defined(__x86_64__)
  const auto original = _mm_getcsr();
  _mm_setcsr(original | 0x8040u);
  CHECK(tcHalfToFloat(1u) == 0x1p-24f);
  CHECK(tcFloatToHalf(0x1p-24f) == 1u);
  _mm_setcsr(original);
#endif
  CHECK(tcFloatToHalf(1.0f + 0x1p-11f) == 0x3c00u);
  CHECK(tcFloatToHalf(1.0f + 3.0f * 0x1p-11f) == 0x3c02u);
}
struct DecoderLog {
  std::vector<Rd6Event> forward, analysis;
  static void onForward(void *p, const Rd6Event &e) {
    static_cast<DecoderLog *>(p)->forward.push_back(e);
  }
  static void onAnalysis(void *p, const Rd6Event &e) {
    static_cast<DecoderLog *>(p)->analysis.push_back(e);
  }
};
void decoderContract() {
  auto decoder = std::make_unique<Rd6Decoder>();
  DecoderLog log;
  decoder->sink = {&log, &DecoderLog::onForward, &DecoderLog::onAnalysis};
  decoder->prepare(40.0, 240.0);
  float tempo[61];
  std::fill_n(tempo, 61u, 1.0f / 61.0f);
  auto control = std::make_unique<Rd6Decoder>(*decoder);
  DecoderLog controlLog;
  control->sink = {&controlLog, &DecoderLog::onForward, &DecoderLog::onAnalysis};
  bool earlyPreview = false;
  for (std::uint32_t k = 0u; k < 750u; ++k) {
    decoder->push(k % 47u < 3u ? .98f : .01f, tempo);
    control->push(k % 47u < 3u ? .98f : .01f, tempo);
    Rd6Decoder::Preview preview;
    const auto before = log.analysis.size();
    {
      const effetune::allocation_guard::Scope guard;
      preview = decoder->preview();
    }
    CHECK(log.analysis.size() == before && decoder->committed() == control->committed());
    CHECK(std::equal(decoder->posterior(), decoder->posterior() + decoder->stateCount(),
                     control->posterior()));
    CHECK(std::equal(decoder->viterbi(), decoder->viterbi() + decoder->stateCount(),
                     control->viterbi()));
    CHECK(preview.count <= preview.beats.size());
    if (log.analysis.empty() && preview.count != 0u)
      earlyPreview = true;
    for (std::uint32_t i = 1u; i < preview.count; ++i)
      CHECK(preview.beats[i].tick > preview.beats[i - 1u].tick);
  }
  CHECK(earlyPreview);
  CHECK(log.analysis.size() == controlLog.analysis.size() &&
        log.forward.size() == controlLog.forward.size());
  for (std::size_t i = 0u; i < log.analysis.size(); ++i)
    CHECK(log.analysis[i].tick == controlLog.analysis[i].tick &&
          log.analysis[i].decision == controlLog.analysis[i].decision);
  CHECK(log.forward.size() > 10u && log.analysis.size() > 8u);
  for (std::size_t i = 1u; i < log.forward.size(); ++i) {
    CHECK(log.forward[i].tick > log.forward[i - 1u].tick);
    CHECK(log.forward[i].tick - log.forward[i].decision <= .025 / kBeatDt + 1e-9);
  }
  for (const auto &beat : log.analysis) {
    CHECK(beat.decision >= beat.tick + 94.0);
    CHECK(beat.decision <= beat.tick + 188.0 + 10.0);
  }
  const auto committed = log.analysis;
  decoder->flush();
  CHECK(log.analysis.size() >= committed.size());
  for (std::size_t i = 0u; i < committed.size(); ++i)
    CHECK(log.analysis[i].tick == committed[i].tick);
  decoder->push(.4f, tempo, true);
  CHECK(!decoder->shown() && decoder->confidence() == 0.0);
  decoder->prepare(80.0, 160.0);
  CHECK(decoder->ticks() == 0 && decoder->committed() == 0 && !decoder->shown());
}
void transportContract() {
  for (const float rate : {44100.0f, 48000.0f, 96000.0f, 192000.0f, 37000.0f}) {
    Harness h(rate);
    std::array<float, 4u * 113u> audio{}, original{};
    std::uint64_t at = 0u;
    for (std::uint32_t block = 0u; block < 70u; ++block) {
      const auto frames = block % 2u == 0u ? 97u : 113u;
      for (std::uint32_t i = 0u; i < frames * 4u; ++i)
        audio[i] = static_cast<float>(.1 * std::sin((at + i) * .13));
      original = audio;
      {
        const effetune::allocation_guard::Scope guard;
        h.kernel->process(audio.data(), 4u, frames, {static_cast<double>(at) / rate});
      }
      CHECK(audio == original);
      at += frames;
      const auto *p = h.take();
      if (p == nullptr)
        continue;
      CHECK(u32(p + 4u) != 0u);
      if (rate == 37000.0f)
        CHECK(u32(p + 12u) == 0u && f32(p + 40u) == 0.0f && f32(p + 44u) == 0.0f);
      else
        CHECK(std::fabs(u32(p + 8u) / f32(p) - kBeatDt) < 1e-9);
    }
    h.params[2] = 1.0f;
    h.apply();
    {
      const effetune::allocation_guard::Scope guard;
      h.kernel->process(audio.data(), 4u, 113u, {static_cast<double>(at) / rate});
    }
    h.params[0] = 80.0f;
    h.params[1] = 160.0f;
    h.apply();
    {
      const effetune::allocation_guard::Scope guard;
      h.kernel->process(audio.data(), 4u, 113u, {static_cast<double>(at + 113u) / rate});
    }
    h.kernel->reset();
    audio.fill(0.0f);
    for (std::uint32_t b = 0u; b < static_cast<std::uint32_t>(rate / 113u) + 2u; ++b)
      h.kernel->process(audio.data(), 4u, 113u, {static_cast<double>(b * 113u) / rate});
    const auto *p = h.take();
    CHECK(p != nullptr);
    if (p)
      CHECK(u32(p + 32u) == 0u && f32(p + 40u) == 0.0f && f32(p + 44u) == 0.0f &&
            f32(p + 60u) == 0.0f);
  }
}
void liveControls() {
  Harness h(48000.0f);
  h.params[2] = 1.0f;
  h.apply();
  constexpr std::uint32_t frames = 128u;
  std::array<float, frames * 4u> audio{}, original{};
  std::uint32_t shown = 0u, changed = 0u, generation = 0u;
  for (std::uint32_t block = 0u; block < 3750u; ++block) {
    for (std::uint32_t i = 0u; i < frames; ++i) {
      const double t = static_cast<double>(block * frames + i) / 48000.0;
      const float sample = static_cast<float>((.15 + .5 * std::exp(-std::fmod(t, .5) * 60.0)) *
                                              std::sin(t * 2711.0));
      for (std::uint32_t c = 0u; c < 4u; ++c)
        audio[c * frames + i] = sample;
    }
    original = audio;
    h.kernel->process(audio.data(), 4u, frames, {static_cast<double>(block * frames) / 48000.0});
    for (std::uint32_t i = 0u; i < frames; ++i) {
      changed += audio[i] != original[i] ? 1u : 0u;
      CHECK(audio[i] - original[i] == audio[frames + i] - original[frames + i]);
      CHECK(audio[2u * frames + i] == original[2u * frames + i] &&
            audio[3u * frames + i] == original[3u * frames + i]);
    }
    if (const auto *p = h.take()) {
      generation = u32(p + 4u);
      for (std::uint32_t i = 0u; i < u32(p + 28u); ++i)
        shown += p[832u + i * 32u + 29u] == 2u ? 1u : 0u;
    }
  }
  CHECK(shown > 0u && changed > 0u);
  // Brief digital gaps clear the public silence presentation.
  for (std::uint32_t block = 0u; block < 75u; ++block) {
    audio.fill(0.0f);
    h.kernel->process(audio.data(), 4u, frames, {10.0 + block * frames / 48000.0});
    if (const auto *p = h.take()) {
      if (block == 74u) {
        CHECK(f32(p + 44u) == 0.0f && u32(p + 32u) == 0u && f32(p + 40u) == 0.0f);
      }
    }
  }
  h.params[2] = 0.0f;
  h.apply();
  original = audio;
  h.kernel->process(audio.data(), 4u, frames, {10.0});
  CHECK(audio == original);
  h.params[0] = 80.0f;
  h.params[1] = 160.0f;
  h.apply();
  h.kernel->process(audio.data(), 4u, frames, {10.0 + frames / 48000.0});
  if (const auto *p = h.take()) {
    CHECK(u32(p + 4u) == generation);
    CHECK(f32(p + 44u) == 0.0f);
  }
  h.kernel->reset();
  for (std::uint32_t block = 0u; block < 32u; ++block) {
    for (std::uint32_t i = 0u; i < frames; ++i)
      for (std::uint32_t c = 0u; c < 4u; ++c)
        audio[c * frames + i] = i % 2u == 0u ? 1e-19f : -1e-19f;
    h.kernel->process(audio.data(), 4u, frames, {static_cast<double>(block * frames) / 48000.0});
  }
  const auto *silent = h.take();
  CHECK(silent != nullptr);
  if (silent)
    CHECK(u32(silent + 32u) == 0u && f32(silent + 40u) == 0.0f && f32(silent + 44u) == 0.0f);
}
void provisionalTransport() {
  constexpr std::uint32_t rate = 48000u, frames = 128u, length = rate * 10u;
  std::vector<float> signal(length, 0.0f);
  std::uint32_t seed = 0x1234567u;
  auto noise = [&]() {
    seed = seed * 1664525u + 1013904223u;
    return seed / 2147483648.0 - 1.0;
  };
  auto add = [&](double start, double seconds, const auto &voice) {
    const auto first = static_cast<std::uint32_t>(std::llround(start * rate));
    const auto count = static_cast<std::uint32_t>(std::llround(seconds * rate));
    for (std::uint32_t i = 0u; i < count && first + i < length; ++i)
      signal[first + i] = static_cast<float>(signal[first + i] + voice(i / double(rate)));
  };
  for (std::uint32_t eighth = 0u; eighth < 40u; ++eighth) {
    const double start = eighth * .25;
    add(start, .04, [&](double t) { return .12 * noise() * std::exp(-t / .012); });
    if (eighth % 2u != 0u)
      continue;
    add(start, .3, [](double t) {
      return .7 * std::sin(6.283185307179586 * (50.0 * t + 1.8 * (1.0 - std::exp(-t / .03)))) *
             std::exp(-t / .12);
    });
    if ((eighth / 2u) % 2u != 0u)
      add(start, .2, [&](double t) { return .35 * noise() * std::exp(-t / .05); });
  }
  struct Onset {
    std::array<std::uint8_t, 8> time;
    std::uint8_t band;
    double received;
    bool committed;
  };
  Harness h{float(rate)};
  std::vector<Onset> onsets;
  std::array<std::uint32_t, 6> kinds{};
  std::array<float, frames * 2u> audio{};
  std::uint32_t nextPacket = 800u, replacements = 0u, batchedAnalysis = 0u;
  auto consume = [&](const std::uint8_t *p, double available) {
    std::uint32_t analysis = 0u;
    for (std::uint32_t i = 0u; i < u32(p + 28u); ++i) {
      const auto *slot = p + 832u + 32u * i;
      const auto kind = slot[29];
      ++kinds[kind];
      if (kind == 2u || kind == 4u || kind == 5u) {
        CHECK(slot[28] == 0u && f32(slot + 16u) == 0.0f);
        CHECK(f32(slot + 24u) >= 0.0f);
        analysis += kind == 5u ? 1u : 0u;
        continue;
      }
      auto previous = std::find_if(onsets.begin(), onsets.end(), [&](const Onset &onset) {
        return onset.band == slot[28] && std::memcmp(onset.time.data(), slot, 8u) == 0;
      });
      if (previous == onsets.end()) {
        Onset onset{};
        std::memcpy(onset.time.data(), slot, 8u);
        onset.band = slot[28];
        onset.received = available;
        onset.committed = kind == 0u;
        onsets.push_back(onset);
        const double time = (u32(slot) + double(f32(slot + 4u))) * kBeatDt;
        CHECK(available - time < .3);
      } else if (kind == 0u) {
        CHECK(!previous->committed);
        CHECK(available > previous->received + .5);
        previous->committed = true;
        ++replacements;
      }
    }
    batchedAnalysis += analysis > 1u ? 1u : 0u;
  };
  for (std::uint32_t at = 0u; at < length; at += frames) {
    for (std::uint32_t i = 0u; i < frames; ++i)
      audio[i] = audio[frames + i] = signal[at + i];
    {
      const effetune::allocation_guard::Scope guard;
      h.kernel->process(audio.data(), 2u, frames, {at / double(rate)});
    }
    if (at + frames >= nextPacket) {
      if (const auto *p = h.take())
        consume(p, (at + frames) / double(rate));
      nextPacket += 800u;
    }
  }
  while (const auto *p = h.take())
    consume(p, 10.0);
  CHECK(kinds[0] > 20u && kinds[3] > 20u && replacements > 20u);
  CHECK(kinds[2] > 0u && kinds[4] > 0u && kinds[5] > 10u && batchedAnalysis > 0u);
  std::printf("{\"transport_v5\":true,\"committed_lanes\":%u,\"invalid_lanes\":%u,"
              "\"shown_forward\":%u,\"provisional_lanes\":%u,\"hidden_forward\":%u,"
              "\"committed_beats\":%u,\"matched_replacements\":%u,\"multi_beat_packets\":%u}\n",
              kinds[0], kinds[1], kinds[2], kinds[3], kinds[4], kinds[5], replacements,
              batchedAnalysis);
}
void coldSilenceContract() {
  auto engine = std::make_unique<Rd6Engine>();
  engine->prepare(48000u, 48000.0);
  const auto initialEpoch = engine->anchor().epoch;
  // Quiet nonzero room tone must not trigger the digital-silence cold reset.
  for (std::uint32_t i = 0u; i < 96000u; ++i)
    engine->sample(1e-10f, static_cast<double>(i + 1u) / 48000.0);
  CHECK(engine->anchor().epoch == initialEpoch);
  const auto ticks = engine->ticks();
  for (std::uint32_t i = 0u; i < 9600u; ++i)
    engine->sample(0.0f, 2.0 + static_cast<double>(i + 1u) / 48000.0);
  CHECK(engine->anchor().epoch == initialEpoch && engine->ticks() > ticks);
  for (std::uint32_t i = 0u; i < 48000u; ++i)
    engine->sample(0.0f, 2.2 + static_cast<double>(i + 1u) / 48000.0);
  CHECK(engine->anchor().epoch == initialEpoch + 1u);
  CHECK(engine->anchor().period == 0.0 && !engine->shown() && engine->confidence() == 0.0);
  CHECK(engine->ticks() > ticks + 94u);
}
void benchmark() {
  for (bool click : {false, true}) {
    const auto prepareStart = std::chrono::steady_clock::now();
    Harness h(96000.0f);
    const double prepareMs =
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - prepareStart)
            .count();
    h.params[2] = click ? 1.0f : 0.0f;
    h.params[3] = 1.0f;
    h.apply();
    constexpr std::uint32_t frames = 128u, blocks = 15000u;
    std::array<float, frames * 2u> audio{};
    std::vector<double> durations;
    durations.reserve(blocks);
    double total = 0.0;
    for (std::uint32_t b = 0u; b < blocks; ++b) {
      for (std::uint32_t i = 0u; i < frames; ++i) {
        const double t = static_cast<double>(b * frames + i) / 96000.0;
        const double pulse = std::fmod(t, .5);
        audio[i] = audio[frames + i] =
            static_cast<float>((.15 + .5 * std::exp(-pulse * 60.0)) * std::sin(t * 2711.0));
      }
      const auto start = std::chrono::steady_clock::now();
      h.kernel->process(audio.data(), 2u, frames, {static_cast<double>(b * frames) / 96000.0});
      if (b % 16u == 0u)
        static_cast<void>(h.take());
      const double us =
          std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - start)
              .count();
      durations.push_back(us);
      total += us;
    }
    std::sort(durations.begin(), durations.end());
    std::printf("{\"click\":%s,\"sample_rate\":96000,\"duration_s\":20,\"prepare_ms\":%.6f,\"cpu_"
                "percent\":%.6f,\"block_mean_"
                "us\":%.6f,\"block_p95_us\":%.6f,\"block_p99_us\":%.6f,\"block_max_us\":%.6f}\n",
                click ? "true" : "false", prepareMs, total / 200000.0, total / blocks,
                durations[blocks * 95u / 100u], durations[blocks * 99u / 100u], durations.back());
  }
}
template <class T> std::vector<T> drumFixture(const char *name) {
  const auto path = std::filesystem::path(__FILE__).parent_path() / "fixtures" / name;
  std::ifstream stream(path, std::ios::binary | std::ios::ate);
  CHECK(stream.good());
  if (!stream.good())
    return {};
  const auto size = static_cast<std::size_t>(stream.tellg());
  CHECK(size % sizeof(T) == 0u);
  std::vector<T> result(size / sizeof(T));
  stream.seekg(0);
  stream.read(reinterpret_cast<char *>(result.data()), static_cast<std::streamsize>(size));
  CHECK(stream.good());
  return result;
}
void drumReferenceContract(bool quiet = false) {
  using namespace effetune::plugins::analyzer::drum;
  const auto audio = drumFixture<float>("drum-input.f32");
  const auto features =
      drumFixture<float>(quiet ? "drum-minus20-features.f32" : "drum-features.f32");
  const auto logits = drumFixture<float>(quiet ? "drum-minus20-logits.f32" : "drum-logits.f32");
  const auto expected =
      drumFixture<std::uint32_t>(quiet ? "drum-minus20-events.u32" : "drum-events.u32");
  if (audio.empty() || features.empty() || logits.empty() || expected.empty())
    return;
  struct State {
    Inference inference;
    Decoder decoder;
    const float *features = nullptr, *logits = nullptr;
    const std::uint32_t *events = nullptr;
    std::size_t frame = 0u, eventCount = 0u, expectedCount = 0u;
    float featureError = 0.0f, logitError = 0.0f;
    static void accepted(void *context, unsigned cls, std::int64_t frame, float) {
      auto &s = *static_cast<State *>(context);
      CHECK(s.eventCount < s.expectedCount);
      if (s.eventCount < s.expectedCount) {
        CHECK(s.events[s.eventCount * 2u] == cls);
        CHECK(s.events[s.eventCount * 2u + 1u] == static_cast<std::uint32_t>(frame));
      }
      ++s.eventCount;
    }
    static void feature(void *context, const float *values) {
      auto &s = *static_cast<State *>(context);
      for (unsigned i = 0u; i < 128u; ++i)
        s.featureError =
            std::max(s.featureError, std::fabs(values[i] - s.features[s.frame * 128u + i]));
      float out[5];
      s.inference.push(values, out);
      for (unsigned i = 0u; i < 5u; ++i)
        s.logitError = std::max(s.logitError, std::fabs(out[i] - s.logits[s.frame * 5u + i]));
      s.decoder.push(out, &s, &accepted);
      ++s.frame;
    }
  };
  auto state = std::make_unique<State>();
  state->features = features.data();
  state->logits = logits.data();
  state->events = expected.data();
  state->expectedCount = expected.size() / 2u;
  Frontend frontend;
  frontend.prepare(44100.0);
  state->inference.prepare();
  state->decoder.reset();
  for (unsigned repeat = 0u; repeat < 2u; ++repeat) {
    frontend.reset();
    state->inference.reset();
    state->decoder.reset();
    state->frame = state->eventCount = 0u;
    {
      const effetune::allocation_guard::Scope guard;
      for (float sample : audio)
        frontend.push(quiet ? sample * .1f : sample, state.get(), &State::feature);
      frontend.finish(state.get(), &State::feature);
      state->decoder.finish(state.get(), &State::accepted);
      frontend.finish(state.get(), &State::feature);
      state->decoder.finish(state.get(), &State::accepted);
    }
    CHECK(state->frame == features.size() / 128u);
    CHECK(state->eventCount == state->expectedCount);
  }
  std::printf("{\"gain_db\":%d,\"drum_reference_events\":%zu,\"max_feature_error\":%.9g,\"max_"
              "logit_error\":%.9g}\n",
              quiet ? -20 : 0, state->eventCount, state->featureError, state->logitError);
}
void drumPeakContract() {
  using namespace effetune::plugins::analyzer::drum;
  Decoder decoder;
  decoder.reset();
  struct Events {
    unsigned count = 0;
    static void accept(void *context, unsigned, std::int64_t, float) {
      ++static_cast<Events *>(context)->count;
    }
  } events;
  for (unsigned n = 0u; n < 20u; ++n) {
    float logits[5];
    for (float &value : logits)
      value = n == 7u || n == 8u || n == 10u || n == 13u ? 3.0f : -10.0f;
    decoder.push(logits, &events, &Events::accept);
  }
  decoder.finish(&events, &Events::accept);
  // Right edge of plateau at raw8, raw10 rejected by refractory, raw13 accepted, all classes.
  CHECK(events.count == 10u);
  decoder.reset();
  events.count = 0u;
  for (unsigned n = 0u; n < 9u; ++n) {
    float logits[5];
    for (float &value : logits)
      value = n == 8u ? 3.0f : -10.0f;
    decoder.push(logits, &events, &Events::accept);
  }
  CHECK(events.count == 0u);
  decoder.finish(&events, &Events::accept);
  CHECK(events.count == 5u);
}
void drumSchedulingContract() {
  using namespace effetune::plugins::analyzer::drum;
  const auto audio = drumFixture<float>("drum-input.f32");
  struct Capture {
    struct Hit {
      double time;
      float logit;
      unsigned lane, arrival;
    };
    std::array<Hit, 256> hits{};
    unsigned count = 0u, input = 0u;
    static void event(void *context, double time, float logit, unsigned lane) {
      auto &self = *static_cast<Capture *>(context);
      CHECK(self.count < self.hits.size());
      if (self.count < self.hits.size())
        self.hits[self.count++] = {time, logit, lane, self.input};
    }
  } immediate, staggered;
  auto first = std::make_unique<Detector>(), second = std::make_unique<Detector>();
  first->prepare(44100.0);
  second->prepare(44100.0);
  second->setInstanceSalt(31u);
  first->context = &immediate;
  second->context = &staggered;
  first->event = second->event = &Capture::event;
  const unsigned delay = static_cast<unsigned>(44100.0 * 31.0 / 4000.0);
  CHECK(std::fabs(second->latency() - first->latency() - delay / 44100.0) < 1e-12);
  {
    const effetune::allocation_guard::Scope guard;
    for (unsigned i = 0u; i < audio.size(); ++i) {
      immediate.input = staggered.input = i;
      first->push(audio[i]);
      second->push(audio[i]);
    }
    first->finish();
    second->finish();
  }
  CHECK(immediate.count > 0u && immediate.count == staggered.count);
  for (unsigned i = 0u; i < std::min(immediate.count, staggered.count); ++i) {
    CHECK(immediate.hits[i].time == staggered.hits[i].time);
    CHECK(immediate.hits[i].logit == staggered.hits[i].logit);
    CHECK(immediate.hits[i].lane == staggered.hits[i].lane);
    CHECK(staggered.hits[i].arrival - immediate.hits[i].arrival == delay);
  }
  // Finish immediately after each feature arrives, before the scheduled inference slot.
  for (auto *detector : {first.get(), second.get()})
    detector->reset();
  immediate.count = staggered.count = 0u;
  {
    const effetune::allocation_guard::Scope guard;
    for (unsigned i = 0u; i < 44100u; ++i) {
      first->push(audio[i]);
      second->push(audio[i]);
    }
    first->finish();
    second->finish();
  }
  CHECK(immediate.count == staggered.count);
  for (unsigned i = 0u; i < std::min(immediate.count, staggered.count); ++i) {
    CHECK(immediate.hits[i].time == staggered.hits[i].time);
    CHECK(immediate.hits[i].logit == staggered.hits[i].logit);
  }
}
void drumRateContract() {
  using namespace effetune::plugins::analyzer::drum;
  for (unsigned rate : {8000u, 11025u, 16000u, 22050u, 24000u, 32000u, 44100u, 48000u, 64000u,
                        88200u, 96000u, 176400u, 192000u, 352800u, 384000u}) {
    Frontend frontend;
    frontend.prepare(rate);
    struct Frames {
      unsigned count = 0u;
      static void receive(void *context, const float *features) {
        ++static_cast<Frames *>(context)->count;
        for (unsigned i = 0u; i < 128u; ++i)
          CHECK(std::isfinite(features[i]) && features[i] >= 0.0f);
      }
    } frames;
    const unsigned samples = rate / 10u + 1u;
    const auto outputSamples = (static_cast<std::uint64_t>(samples) * 44100u + rate - 1u) / rate;
    for (unsigned repeat = 0u; repeat < 2u; ++repeat) {
      frontend.reset();
      frames.count = 0u;
      const effetune::allocation_guard::Scope guard;
      for (unsigned i = 0u; i < samples; ++i)
        frontend.push(i == samples / 2u ? 1.0f : 0.0f, &frames, &Frames::receive);
      frontend.finish(&frames, &Frames::receive);
      CHECK(frames.count == (outputSamples + 440u) / 441u);
    }
  }
}
void drumKernelContract() {
  const auto fixture = drumFixture<float>("drum-input.f32");
  const auto expected = drumFixture<std::uint32_t>("drum-events.u32");
  if (fixture.empty() || expected.empty())
    return;
  struct Hit {
    unsigned lane;
    double time;
    float logit;
  };
  for (unsigned rate : {44100u, 48000u, 96000u}) {
    std::vector<Hit> baseline;
    for (unsigned frames : {128u, 37u}) {
      Harness harness(static_cast<float>(rate));
      harness.params[3] = 1.0f;
      harness.apply();
      std::vector<Hit> hits;
      hits.reserve(256u);
      auto collect = [&](const std::uint8_t *p) {
        CHECK(u32(p + 1496u) == 1u);
        CHECK(std::fabs(f32(p + 1504u) - (.07 + (rate == 44100u ? 0.0 : 191.0 / rate))) < 1e-7);
        for (unsigned i = 0u; i < u32(p + 1500u); ++i) {
          const auto *slot = p + 1512u + i * 32u;
          const double time = (u32(slot) + static_cast<double>(f32(slot + 4u))) * kBeatDt;
          const unsigned lane = slot[28];
          CHECK(lane < 5u && std::isfinite(f32(slot + 24u)));
          const auto known = std::find_if(hits.begin(), hits.end(), [&](const Hit &hit) {
            return hit.lane == lane && std::fabs(hit.time - time) < 1e-8;
          });
          if (known == hits.end())
            hits.push_back({lane, time, f32(slot + 24u)});
          else
            CHECK(known->logit == f32(slot + 24u));
        }
      };
      const unsigned length = static_cast<unsigned>((fixture.size() * rate + 44099u) / 44100u);
      std::array<float, 512> audio{}, original{};
      for (unsigned at = 0u; at < length; at += frames) {
        const unsigned count = std::min(frames, length - at);
        for (unsigned i = 0u; i < count; ++i) {
          const double position = static_cast<double>(at + i) * 44100.0 / rate;
          const auto index = static_cast<std::size_t>(position);
          const float left = index < fixture.size() ? fixture[index] : 0.0f;
          const float right = index + 1u < fixture.size() ? fixture[index + 1u] : 0.0f;
          const float value = static_cast<float>(left + (right - left) * (position - index));
          // Four-channel average equals the mono fixture; channels beyond stereo must be read.
          audio[i] = frames == 128u ? value : 0.0f;
          audio[count + i] = frames == 128u ? value : 0.0f;
          audio[2u * count + i] = frames == 128u ? value : 2.0f * value;
          audio[3u * count + i] = frames == 128u ? value : 2.0f * value;
        }
        original = audio;
        {
          const effetune::allocation_guard::Scope guard;
          harness.kernel->process(audio.data(), 4u, count, {static_cast<double>(at) / rate});
        }
        CHECK(audio == original);
        if (const auto *p = harness.take())
          collect(p);
      }
      // Refused writes must preserve the final partial hop and events until the consumer drains.
      harness.kernel->streamBoundary();
      std::array<std::uint8_t, 64> smallStorage{};
      effetune::TelemetryRing smallRing;
      smallRing.adopt(smallStorage.data(), static_cast<std::uint32_t>(smallStorage.size()));
      std::uint32_t sequence = 0u;
      effetune::TelemetryWriter refused(smallRing, 207u, sequence);
      harness.kernel->writeTelemetry(refused);
      CHECK(harness.kernel->streamBoundaryPending());
      effetune::TelemetryWriter writer(harness.ring, 207u, harness.sequence);
      harness.kernel->writeTelemetry(writer);
      CHECK(!harness.kernel->streamBoundaryPending());
      const unsigned bytes = harness.ring.read(
          harness.packets.data(), static_cast<unsigned>(harness.packets.size()), nullptr);
      for (unsigned offset = 0u; offset + 2040u <= bytes; offset += 2040u)
        collect(harness.packets.data() + offset + 16u);
      CHECK(!hits.empty());
      if (frames == 128u)
        baseline = hits;
      else {
        CHECK(hits.size() == baseline.size());
        for (std::size_t i = 0u; i < std::min(hits.size(), baseline.size()); ++i) {
          CHECK(hits[i].lane == baseline[i].lane);
          CHECK(hits[i].time == baseline[i].time);
          CHECK(hits[i].logit == baseline[i].logit);
        }
      }
      if (rate == 44100u) {
        std::size_t display = 0u;
        for (std::size_t i = 0u; i < expected.size(); i += 2u) {
          const auto cls = expected[i];
          CHECK(display < hits.size());
          if (display < hits.size()) {
            CHECK(hits[display].lane == (cls == 3u ? 4u : cls == 4u ? 3u : cls));
            CHECK(std::fabs(hits[display].time - (expected[i + 1u] + 1u) / 100.0) < 1e-7);
          }
          ++display;
        }
        CHECK(display == hits.size());
      }
    }
  }
}
} // namespace
int main(int argc, char **argv) {
  if (argc > 1 && std::strcmp(argv[1], "--benchmark") == 0)
    benchmark();
  else {
    drumReferenceContract();
    drumReferenceContract(true);
    drumPeakContract();
    drumSchedulingContract();
    drumRateContract();
    drumKernelContract();
    halfContract();
    provisionalClockContract();
    decoderContract();
    transportContract();
    liveControls();
    provisionalTransport();
    coldSilenceContract();
  }
  CHECK(effetune::allocation_guard::violationCount() == 0u);
  return failures == 0 ? 0 : 1;
}

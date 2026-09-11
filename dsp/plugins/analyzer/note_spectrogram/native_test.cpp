#include "allocation_guard.h"
#include "effetune/dsp/pffft_incremental.h"
#include "effetune/kernel.h"
#include "pffft.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_NoteSpectrogramPlugin() noexcept;
namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr std::uint32_t kNoteCount = 88u;
constexpr std::uint32_t kFineDivisions = 5u;
constexpr std::uint32_t kFinePitchCount = kNoteCount * kFineDivisions;
constexpr std::uint32_t kConfidenceOffset = 28u;
constexpr std::uint32_t kVolumeOffset = kConfidenceOffset + 4u * kFinePitchCount;
constexpr std::uint32_t kPayloadBytes = kVolumeOffset + 4u * kFinePitchCount;
constexpr std::uint32_t kFrameBytes = 16u + kPayloadBytes;
int failures = 0;
void check(bool value, const char *expression, int line) {
  if (!value) {
    std::fprintf(stderr, "note_spectrogram:%d: %s\n", line, expression);
    ++failures;
  }
}
#define CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)
std::uint32_t readU32(const std::uint8_t *data) {
  return data[0] | (static_cast<std::uint32_t>(data[1]) << 8u) |
         (static_cast<std::uint32_t>(data[2]) << 16u) |
         (static_cast<std::uint32_t>(data[3]) << 24u);
}
std::uint16_t readU16(const std::uint8_t *data) {
  return static_cast<std::uint16_t>(data[0]) |
         static_cast<std::uint16_t>(static_cast<std::uint16_t>(data[1]) << 8u);
}
float readF32(const std::uint8_t *data) {
  const auto bits = readU32(data);
  float value;
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}
struct Harness {
  alignas(std::max_align_t) std::array<std::byte, 8192> storage{};
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_NoteSpectrogramPlugin();
  effetune::PluginKernel *kernel = nullptr;
  std::vector<std::uint8_t> ring_bytes = std::vector<std::uint8_t>(128u * 1024u);
  std::vector<std::uint8_t> bytes = std::vector<std::uint8_t>(128u * 1024u);
  effetune::TelemetryRing ring;
  std::uint32_t sequence = 0;
  explicit Harness(float rate, float minimum_midi = 21.0F, float maximum_midi = 108.0F,
                   float regular_candidates = 8.0F) {
    CHECK(descriptor->objectSize <= storage.size());
    CHECK(descriptor->paramsFloatCount == 3u);
    kernel = descriptor->construct(storage.data());
    kernel->prepare({rate, 4u, 1024u});
    CHECK(kernel->preparedSuccessfully());
    const std::array params = {minimum_midi, maximum_midi, regular_candidates};
    CHECK(kernel->stageParameters(params.data(), static_cast<std::uint32_t>(params.size()),
                                  descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
    ring.adopt(ring_bytes.data(), static_cast<std::uint32_t>(ring_bytes.size()));
  }
  ~Harness() { descriptor->destroy(kernel); }
  std::vector<std::uint8_t> take() {
    effetune::TelemetryWriter writer(ring, 206u, sequence);
    {
      const effetune::allocation_guard::Scope guard;
      kernel->writeTelemetry(writer);
    }
    std::uint32_t dropped = 0;
    const auto size = ring.read(bytes.data(), static_cast<std::uint32_t>(bytes.size()), &dropped);
    CHECK(dropped == 0u);
    CHECK(size % kFrameBytes == 0u);
    for (auto offset = 0u; offset < size; offset += kFrameBytes) {
      CHECK(readU16(bytes.data() + offset) == 24u);
      CHECK(readU16(bytes.data() + offset + 2u) == 3u);
      CHECK(readU16(bytes.data() + offset + 12u) == kPayloadBytes);
    }
    return {bytes.begin(), bytes.begin() + size};
  }
};

std::vector<std::uint8_t> run(Harness &harness, float rate, std::uint32_t samples,
                              const std::vector<std::uint32_t> &blocks,
                              const std::vector<int> &notes = {}, bool drain = true,
                              std::uint32_t channels = 2u, bool cancel = false) {
  std::vector<std::uint8_t> result;
  std::uint32_t processed = 0u, block_index = 0u;
  while (processed < samples) {
    const auto size = std::min(blocks[block_index++ % blocks.size()], samples - processed);
    std::vector<float> audio(static_cast<std::size_t>(size) * channels);
    for (std::uint32_t i = 0u; i < size; ++i) {
      double value = 0.0;
      for (const int midi : notes) {
        const double f = 440.0 * std::exp2((midi - 69.0) / 12.0);
        for (int harmonic = 1; harmonic <= 8 && harmonic * f < rate * 0.5; ++harmonic)
          value += 0.1 * std::pow(0.8, harmonic - 1) *
                   std::sin(2.0 * kPi * harmonic * f * (processed + i) / rate);
      }
      for (std::uint32_t ch = 0u; ch < channels; ++ch)
        audio[ch * size + i] =
            ch >= 2u ? 0.37F : static_cast<float>(cancel && ch == 1u ? -value : value);
    }
    const auto original = audio;
    {
      const effetune::allocation_guard::Scope guard;
      harness.kernel->process(audio.data(), channels, size,
                              {static_cast<double>(processed) / rate});
    }
    CHECK(audio == original);
    processed += size;
    if (drain) {
      const auto frames = harness.take();
      result.insert(result.end(), frames.begin(), frames.end());
    }
  }
  if (!drain)
    result = harness.take();
  return result;
}
const std::uint8_t *lastPayload(const std::vector<std::uint8_t> &data) {
  CHECK(data.size() >= kFrameBytes);
  return data.data() + data.size() - kFrameBytes + 16u;
}
std::array<float, 88> levels(const std::vector<std::uint8_t> &data) {
  std::array<float, 88> result{};
  if (data.size() < kFrameBytes)
    return result;
  const auto payload = lastPayload(data);
  for (std::uint32_t p = 0; p < kNoteCount; ++p)
    for (std::uint32_t division = 0u; division < kFineDivisions; ++division)
      result[p] = std::max(
          result[p], readF32(payload + kConfidenceOffset + (p * kFineDivisions + division) * 4u));
  return result;
}
float bagLevel(const std::uint8_t *payload, std::uint32_t pitch) {
  auto result = 0.0F;
  for (std::uint32_t division = 0u; division < kFineDivisions; ++division)
    result = std::max(
        result, readF32(payload + kConfidenceOffset + (pitch * kFineDivisions + division) * 4u));
  return result;
}
float pitchVolume(const std::uint8_t *payload, std::uint32_t midi, std::uint32_t division = 2u) {
  const auto fine_pitch = (midi - 21u) * kFineDivisions + division;
  return readF32(payload + kVolumeOffset + fine_pitch * 4u);
}
struct Tone {
  double midi;
  double level;
  int timbre;
};
double signal(double t, const std::vector<Tone> &tones, double detune = 0.0) {
  double result = 0.0;
  for (const auto &tone : tones) {
    const auto f = 440.0 * std::exp2((tone.midi - 69.0 + detune) / 12.0);
    for (int h = 1; h <= 20; ++h) {
      if ((tone.timbre == 0 && h != 1) || (tone.timbre == 2 && h % 2 == 0) ||
          (tone.timbre == 3 && (h == 1 || h > 7)))
        continue;
      const auto amplitude =
          tone.timbre == 1 ? 1.0 / std::sqrt(static_cast<double>(h)) : 1.0 / static_cast<double>(h);
      const auto phase = 0.37 * h * h;
      result += tone.level * amplitude * std::sin(2.0 * kPi * h * f * t + phase);
    }
  }
  return result;
}
double harmonicTone(double t, double midi, double level, int harmonics, double phase_scale) {
  const auto frequency = 440.0 * std::exp2((midi - 69.0) / 12.0);
  auto result = 0.0;
  for (auto harmonic = 1; harmonic <= harmonics; ++harmonic)
    result += level / harmonic *
              std::sin(2.0 * kPi * harmonic * frequency * t + phase_scale * harmonic * harmonic);
  return result;
}
template <class Generate>
std::vector<std::uint8_t> render(Harness &harness, float rate, double seconds, Generate generate,
                                 std::uint32_t channels = 2u,
                                 const std::vector<std::uint32_t> &blocks = {128u}) {
  std::vector<std::uint8_t> result;
  const auto samples = static_cast<std::uint32_t>(rate * seconds);
  std::uint32_t processed = 0u, block_index = 0u;
  while (processed < samples) {
    const auto size = std::min(blocks[block_index++ % blocks.size()], samples - processed);
    std::vector<float> audio(static_cast<std::size_t>(size) * channels);
    for (auto i = 0u; i < size; ++i)
      for (auto ch = 0u; ch < channels; ++ch)
        audio[ch * size + i] =
            static_cast<float>(generate(static_cast<double>(processed + i) / rate, ch));
    const auto original = audio;
    {
      const effetune::allocation_guard::Scope guard;
      harness.kernel->process(audio.data(), channels, size,
                              {static_cast<double>(processed) / rate});
    }
    CHECK(audio == original);
    processed += size;
    const auto frames = harness.take();
    result.insert(result.end(), frames.begin(), frames.end());
  }
  return result;
}
void checkPresence(const char *name, const std::vector<std::uint8_t> &frames,
                   const std::vector<int> &expected) {
  unsigned tp = 0u, fp = 0u, fn = 0u;
  unsigned false_streak = 0u, longest_false_streak = 0u;
  float earliest = 1000.0F;
  float maximum_false = 0.0F;
  for (std::size_t offset = 0u; offset < frames.size(); offset += kFrameBytes) {
    const auto frame = frames.data() + offset;
    CHECK(readU16(frame) == 24u && readU16(frame + 2u) == 3u);
    CHECK(readU16(frame + 12u) == kPayloadBytes);
    const auto payload = frame + 16u;
    CHECK(readU32(payload + 20u) == kFineDivisions);
    const auto time = readF32(payload + 4u);
    bool complete = true;
    bool false_frame = false;
    for (int p = 0; p < 88; ++p) {
      const auto value = bagLevel(payload, p);
      CHECK(std::isfinite(value) && value >= 0.0F && value <= 1.0F);
      const auto target = std::find(expected.begin(), expected.end(), p + 21) != expected.end();
      const auto detected = value > 0.5F;
      complete = complete && (!target || detected);
      if (time < 0.3F)
        continue;
      tp += target && detected ? 1u : 0u;
      fp += !target && detected ? 1u : 0u;
      fn += target && !detected ? 1u : 0u;
      if (!target) {
        maximum_false = value > maximum_false ? value : maximum_false;
        false_frame = false_frame || detected;
      }
    }
    if (time >= 0.3F) {
      false_streak = false_frame ? false_streak + 1u : 0u;
      longest_false_streak =
          false_streak > longest_false_streak ? false_streak : longest_false_streak;
    }
    if (complete && time < earliest)
      earliest = time;
  }
  const auto precision = tp + fp == 0u ? 1.0 : static_cast<double>(tp) / (tp + fp);
  const auto recall = tp + fn == 0u ? 1.0 : static_cast<double>(tp) / (tp + fn);
  std::printf("presence %s precision %.3f recall %.3f first %.3f fp %u max-false %.3f "
              "false-streak %u\n",
              name, precision, recall, static_cast<double>(earliest), fp,
              static_cast<double>(maximum_false), longest_false_streak);
  const auto values = levels(frames);
  for (int p = 0; p < 88; ++p)
    if (values[p] > 0.0F)
      std::printf("  note %d confidence %.3f\n", p + 21, static_cast<double>(values[p]));
  CHECK(precision >= 0.98);
  CHECK(recall >= 0.95);
  CHECK(expected.empty() || earliest + 0.02F <= 0.25F);
}
void testVolumeLevels() {
  const auto measured = [](double midi, double amplitude) {
    constexpr auto rate = 48000.0F;
    Harness harness(rate);
    const auto frequency = 440.0 * std::exp2((midi - 69.0) / 12.0);
    const auto frames = render(harness, rate, 0.6, [=](double time, std::uint32_t) {
      return amplitude * std::sin(2.0 * kPi * frequency * time);
    });
    CHECK(!frames.empty());
    return pitchVolume(lastPayload(frames), static_cast<std::uint32_t>(midi));
  };

  const auto a4 = measured(69.0, 1.0);
  const auto a4_minus_20 = measured(69.0, 0.1);
  const auto a1 = measured(33.0, 1.0);
  const auto a4_correction = 3.0 * std::log2(440.0 / 100.0);
  std::printf("volume A4 %.3f dB, A4 -20 dB %.3f dB, A1 %.3f dB\n", static_cast<double>(a4),
              static_cast<double>(a4_minus_20), static_cast<double>(a1));
  CHECK(std::abs(a4 - a4_correction) <= 1.0);
  CHECK(std::abs((a4_minus_20 - a4) + 20.0F) <= 0.5F);
  CHECK(std::abs(a1) <= 1.0F);
}
void testPresenceQuality() {
  const std::vector<std::vector<Tone>> signals = {
      {{69, 0.10, 0}},  {{62, 0.08, 1}}, {{64, 0.10, 3}}, {{60, 0.10, 1}, {61, 0.03, 1}},
      {{72, 0.001, 2}}, {{67, 0.07, 3}}, {{108, 0.06, 0}}};
  const std::array<const char *, 7> names = {"pure",  "bright",  "missing", "adjacent",
                                             "quiet", "detuned", "upper"};
  for (std::size_t c = 0u; c < signals.size(); ++c) {
    Harness harness(48000.0F);
    std::vector<int> expected;
    for (const auto &tone : signals[c])
      expected.push_back(static_cast<int>(tone.midi));
    const auto frames = render(harness, 48000.0F, 0.7, [&](double t, std::uint32_t) {
      return signal(t, signals[c], c == 5u ? 0.19 : 0.0);
    });
    checkPresence(names[c], frames, expected);
  }
  {
    Harness harness(44100.0F);
    const auto frames = render(harness, 44100.0F, 1.0, [](double t, std::uint32_t) {
      return harmonicTone(t, 57.0, 0.15, 12, 0.37);
    });
    checkPresence("sustained-harmonic", frames, {57});
  }
  for (auto kind = 0u; kind < 3u; ++kind) {
    Harness harness(48000.0F);
    std::uint32_t state = 0x6d2b79f5u + kind;
    double colored = 0.0;
    const auto frames = render(harness, 48000.0F, 0.7, [&](double t, std::uint32_t) {
      state = state * 1664525u + 1013904223u;
      const auto white = static_cast<double>(state) / 2147483648.0 - 1.0;
      colored = 0.92 * colored + 0.08 * white;
      return kind == 0u ? white * 0.08
                        : (kind == 1u ? colored * 0.3 : (t < 0.015 ? white * 0.5 : 0.0));
    });
    checkPresence(kind == 0u ? "white" : (kind == 1u ? "colored" : "impact"), frames, {});
  }
}
// Integrating the vibrato frequency keeps the phase continuous through vowel changes.
double movingVoice(double t, double midi, double level, double vibrato_rate, double phase) {
  const double frequency = 440.0 * std::exp2((midi - 69.0) / 12.0);
  const double depth = std::exp2(0.18 / 12.0) - 1.0;
  const double cycles =
      frequency * t + frequency * depth / (2.0 * kPi * vibrato_rate) *
                          (std::cos(phase) - std::cos(2.0 * kPi * vibrato_rate * t + phase));
  const double vowel = 0.5 - 0.5 * std::cos(2.0 * kPi * 0.7 * t + phase);
  double value = 0.0;
  for (int h = 1; h <= 12; ++h) {
    const double first = (h * frequency - (650.0 + 400.0 * vowel)) / 350.0;
    const double second = (h * frequency - (1700.0 + 700.0 * vowel)) / 500.0;
    const double envelope =
        0.25 + std::exp(-0.5 * first * first) + 0.6 * std::exp(-0.5 * second * second);
    value += level / h * envelope * std::sin(2.0 * kPi * h * cycles + 0.37 * h * h + phase * h);
  }
  return value;
}
void testPresenceMovingVoices() {
  for (bool mixture : {false, true}) {
    Harness harness(48000.0F);
    const auto frames = render(harness, 48000.0F, 2.0, [mixture](double t, std::uint32_t) {
      const double lead = movingVoice(t, 62.0, 0.08, 4.7, 0.2);
      return mixture ? lead + movingVoice(t, 69.0, 0.06, 5.3, 1.1) +
                           harmonicTone(t, 45.0, 0.025, 8, 0.61)
                     : lead;
    });
    CHECK(frames.size() == 99u * kFrameBytes);
    const std::vector<int> pitches = mixture ? std::vector<int>{62, 69, 45} : std::vector<int>{62};
    std::array<unsigned, 3> raw{}, strong{}, gap{}, longest_gap{};
    unsigned measured = 0u, ghosts = 0u;
    for (std::size_t offset = 0u; offset < frames.size(); offset += kFrameBytes) {
      const auto payload = frames.data() + offset + 16u;
      CHECK(readU32(payload + 16u) == offset / kFrameBytes);
      const double center = readF32(payload + 4u) - 4096.0 / 96000.0;
      if (center < 0.2 || center >= 1.8)
        continue;
      ++measured;
      for (int p = 0; p < 88; ++p) {
        const float value = bagLevel(payload, p);
        CHECK(std::isfinite(value) && value >= 0.0F && value <= 1.0F);
        if (std::find(pitches.begin(), pitches.end(), p + 21) == pitches.end())
          ghosts += value >= 0.5F ? 1u : 0u;
      }
      for (std::size_t n = 0; n < pitches.size(); ++n) {
        const float value = bagLevel(payload, pitches[n] - 21);
        // A visible low-confidence line must carry substantial evidence, not epsilon values.
        const bool visible = value >= 0.1F;
        raw[n] += visible ? 1u : 0u;
        strong[n] += value >= 0.5F ? 1u : 0u;
        gap[n] = visible ? 0u : gap[n] + 1u;
        longest_gap[n] = std::max(longest_gap[n], gap[n]);
      }
    }
    CHECK(measured == 80u);
    std::printf("moving %s ghosts %u\n", mixture ? "mixture" : "single", ghosts);
    CHECK(ghosts == 0u);
    for (std::size_t n = 0; n < pitches.size(); ++n) {
      std::printf("moving %s note %d raw %u strong %u/%u gap %u\n", mixture ? "mixture" : "single",
                  pitches[n], raw[n], strong[n], measured, longest_gap[n]);
      CHECK(raw[n] * 10u >= measured * 9u);
      CHECK(longest_gap[n] <= 5u);
      // Both voices must remain useful at the 0.5 confidence; accompaniment may be weaker.
      if (pitches[n] != 45)
        CHECK(strong[n] * 4u >= measured * 3u);
    }
  }
}
void testLowOctaveDiscrimination() {
  for (const auto rate : {44100.0F, 48000.0F}) {
    for (auto midi = 24; midi < 36; ++midi) {
      for (auto kind = 0; kind < 4; ++kind) {
        Harness harness(rate);
        std::vector<Tone> tones = {{static_cast<double>(midi), 0.08, kind == 2 ? 3 : kind % 2}};
        if (kind == 3)
          tones.push_back({static_cast<double>(midi + 12), 0.04, 1});
        const auto frames =
            render(harness, rate, 0.8, [&](double t, std::uint32_t) { return signal(t, tones); });
        unsigned tp = 0u, fp = 0u, fn = 0u;
        for (std::size_t offset = 0u; offset < frames.size(); offset += kFrameBytes) {
          const auto *payload = frames.data() + offset + 16u;
          if (readF32(payload + 4u) < 0.4F)
            continue;
          for (auto note = 24; note < 48; ++note) {
            const auto expected = note == midi || (kind == 3 && note == midi + 12);
            const auto detected = bagLevel(payload, note - 21) >= 0.5F;
            tp += expected && detected ? 1u : 0u;
            fp += !expected && detected ? 1u : 0u;
            fn += expected && !detected ? 1u : 0u;
          }
        }
        std::printf("low octave %.0f Hz note %d kind %d tp %u fp %u fn %u\n",
                    static_cast<double>(rate), midi, kind, tp, fp, fn);
        CHECK(tp > 0u);
        CHECK(tp * 100u >= (tp + fp) * 98u);
        CHECK(tp * 100u >= (tp + fn) * 95u);
      }
    }
  }
}
void testConfiguredRecognitionRange() {
  Harness harness(48000.0F, 60.0F, 72.0F, 8.0F);
  const auto frames = render(harness, 48000.0F, 0.7, [](double t, std::uint32_t) {
    return signal(t, {{48, 0.08, 1}, {60, 0.08, 1}, {72, 0.08, 1}, {84, 0.08, 1}});
  });
  CHECK(!frames.empty());
  for (std::size_t offset = 0u; offset < frames.size(); offset += kFrameBytes) {
    const auto *payload = frames.data() + offset + 16u;
    for (auto midi = 21u; midi <= 108u; ++midi) {
      if (midi >= 60u && midi <= 72u)
        continue;
      for (auto division = 0u; division < kFineDivisions; ++division) {
        const auto fine_pitch = (midi - 21u) * kFineDivisions + division;
        CHECK(readF32(payload + kConfidenceOffset + fine_pitch * 4u) == 0.0F);
        CHECK(readF32(payload + kVolumeOffset + fine_pitch * 4u) == -240.0F);
      }
    }
  }
}
void testAnalysisFloor() {
  struct Case {
    const char *name;
    double noise_rms;
    double tone_amplitude;
    double dc;
    bool dither;
  };
  const std::array<Case, 6> cases = {{{"zero", 0.0, 0.0, 0.0, false},
                                      {"noise-100dB", 1.0e-5, 0.0, 0.0, false},
                                      {"noise-180dB", 1.0e-9, 0.0, 0.0, false},
                                      {"dither-100dB", 0.0, 0.0, 0.0, true},
                                      {"tone-140dB", 0.0, 1.0e-7, 0.0, false},
                                      {"dc-160dB", 0.0, 0.0, 1.0e-8, false}}};

  for (const auto &test : cases) {
    Harness harness(44100.0F);
    std::uint32_t state = 0x6d2b79f5u;
    double sample = 0.0;
    const auto frames = render(harness, 44100.0F, 1.0, [&](double t, std::uint32_t channel) {
      if (channel == 0u) {
        state = state * 1664525u + 1013904223u;
        const double first = static_cast<double>(state) / 4294967296.0;
        state = state * 1664525u + 1013904223u;
        const double second = static_cast<double>(state) / 4294967296.0;
        const double white = 2.0 * first - 1.0;
        sample = test.dc + std::sqrt(3.0) * test.noise_rms * white +
                 test.tone_amplitude * std::sin(2.0 * kPi * 220.0 * t) +
                 (test.dither ? 1.0e-5 * (first - second) : 0.0);
      }
      return sample;
    });
    CHECK(!frames.empty());
    for (std::size_t offset = 0u; offset < frames.size(); offset += kFrameBytes) {
      const auto payload = frames.data() + offset + 16u;
      CHECK(readU32(payload + 20u) == kFineDivisions);
      for (auto pitch = 0u; pitch < kFinePitchCount; ++pitch) {
        CHECK(readF32(payload + kConfidenceOffset + 4u * pitch) == 0.0F);
        CHECK(readF32(payload + kVolumeOffset + 4u * pitch) == -240.0F);
      }
    }
    std::printf("analysis floor %s frames %zu\n", test.name, frames.size() / kFrameBytes);
  }
}
void testAnalysisFloorAfterSignal() {

  Harness harness(48000.0F);
  CHECK(!run(harness, 48000.0F, 12000u, {31u, 128u, 511u}, {57}).empty());
  const auto silent = run(harness, 48000.0F, 12000u, {97u, 1u, 1024u});
  CHECK(!silent.empty());
  for (const auto value : levels(silent))
    CHECK(value == 0.0F);
}
void testPresenceRoutingAndLifecycle() {
  for (const auto rate :
       {44100.0F, 48000.0F, 88200.0F, 96000.0F, 176400.0F, 192000.0F, 384000.0F}) {
    Harness harness(rate);
    const auto hop = static_cast<std::uint32_t>(std::round(rate * 0.02F));
    const auto data = run(harness, rate, hop * 12u, {1u, 31u, 97u, 511u});
    CHECK(data.size() == 11u * kFrameBytes);
    for (auto i = 0u; i < data.size() / kFrameBytes; ++i) {
      const auto payload = data.data() + i * kFrameBytes + 16u;
      CHECK(readU32(payload + 16u) == i);
      CHECK(readU32(payload + 20u) == kFineDivisions && readU32(payload + 24u) == 1u);
      CHECK(std::abs(readF32(payload + 4u) - static_cast<float>(i + 1u) * hop / rate) < 1.0e-6F);
      for (auto p = 0u; p < kFinePitchCount; ++p) {
        CHECK(readF32(payload + kConfidenceOffset + p * 4u) == 0.0F);
        CHECK(readF32(payload + kVolumeOffset + p * 4u) == -240.0F);
      }
    }
  }
  Harness stereo(48000.0F), mono(48000.0F), opposite(48000.0F);
  const auto tone = [](double t, std::uint32_t) {
    return signal(t, {{60, 0.1, 1}, {67, 0.04, 2}});
  };
  const auto expected = render(stereo, 48000.0F, 0.45, tone);
  Harness four(48000.0F);
  CHECK(render(four, 48000.0F, 0.45, tone, 4u) == expected);
  CHECK(render(mono, 48000.0F, 0.45, tone, 1u, {31u, 1u, 1024u, 97u}) == expected);
  CHECK(render(opposite, 48000.0F, 0.45, [&](double t, std::uint32_t ch) {
          return (ch == 0u ? 1.0 : -1.0) * tone(t, ch);
        }) == expected);
  stereo.kernel->reset();
  auto cleared = run(stereo, 48000.0F, 3000u, {128u});
  CHECK(readU32(lastPayload(cleared) + 24u) == 2u);
  for (auto value : levels(cleared))
    CHECK(value == 0.0F);
  stereo.kernel->prepare({44100.0F, 2u, 1024u});
  cleared = run(stereo, 44100.0F, 3000u, {97u});
  CHECK(readU32(lastPayload(cleared) + 24u) == 3u);
  for (const auto channels : {1u, 2u, 1u, 2u}) {
    cleared = run(stereo, 44100.0F, 4000u, {97u}, {}, false, channels);
    CHECK(readU32(cleared.data() + 32u) == 0u);
    CHECK(readU32(lastPayload(cleared) + 20u) == kFineDivisions);
    for (auto value : levels(cleared))
      CHECK(value == 0.0F);
  }
  Harness pending(48000.0F);
  const auto queued = run(pending, 48000.0F, 960u * 50u, {97u}, {}, false);
  CHECK(queued.size() == 32u * kFrameBytes);
  CHECK(readU32(queued.data() + 32u) == 17u);
  CHECK(readU32(lastPayload(queued) + 16u) == 48u);
}
} // namespace
int main(int argc, char **argv) {
  if (argc == 2 && std::strcmp(argv[1], "--quality-report") == 0) {
    testPresenceQuality();
    testPresenceMovingVoices();
    return failures == 0 ? 0 : 1;
  }
  if (argc != 1) {
    std::fprintf(stderr, "usage: %s [--quality-report]\n", argv[0]);
    return 2;
  }
  auto *setup = pffft_new_setup(16384, PFFFT_REAL);
  {
    effetune::dsp::PffftOrderedRealForward transform(setup, 64);
    std::printf("maximum FFT transform stages: %d\n", transform.stepCount());
    CHECK(transform.stepCount() <= 281);
  }
  pffft_destroy_setup(setup);
  testAnalysisFloor();
  testAnalysisFloorAfterSignal();
  testVolumeLevels();
  testPresenceRoutingAndLifecycle();
  testConfiguredRecognitionRange();
  testLowOctaveDiscrimination();
  return failures == 0 ? 0 : 1;
}

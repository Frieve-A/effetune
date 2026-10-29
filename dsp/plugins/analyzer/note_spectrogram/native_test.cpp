#include "allocation_guard.h"
#include "effetune/dsp/pffft_incremental.h"
#include "effetune/kernel.h"
#include "event_rule_reference.h"
#include "pffft.h"
#include "spectral_analysis.h"
#include "timbre_reference.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <limits>
#include <memory>
#include <string>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_NoteSpectrogramPlugin() noexcept;
namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr std::uint32_t kNoteCount = 88u;
constexpr std::uint32_t kFineDivisions = 5u;
constexpr std::uint32_t kFinePitchCount = kNoteCount * kFineDivisions;
constexpr std::uint32_t kRevisionAgeOffset = 28u;
constexpr std::uint32_t kConfidenceOffset = 32u;
constexpr std::uint32_t kVolumeOffset = kConfidenceOffset + 4u * kFinePitchCount;
constexpr std::uint32_t kRevisedOffset = kVolumeOffset + 4u * kFinePitchCount;
constexpr std::uint32_t kIntermediateOffset = kRevisedOffset + 4u * kFinePitchCount;
constexpr std::uint32_t kRevisionBytes = 4u + 4u * kFinePitchCount;
constexpr std::uint32_t kPitchCentsOffset = kIntermediateOffset + 2u * kRevisionBytes;
constexpr std::uint32_t kPayloadBytes = kPitchCentsOffset + 4u * kNoteCount;
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
  std::vector<std::uint8_t> ring_bytes = std::vector<std::uint8_t>(512u * 1024u);
  std::vector<std::uint8_t> bytes = std::vector<std::uint8_t>(512u * 1024u);
  effetune::TelemetryRing ring;
  std::uint32_t sequence = 0;
  std::vector<std::uint8_t> chord_frames;
  explicit Harness(float rate, float minimum_midi = 21.0F, float maximum_midi = 108.0F,
                   bool timbre_enabled = false, bool chord_key_enabled = false) {
    CHECK(descriptor->objectSize <= storage.size());
    CHECK(descriptor->paramsFloatCount == 4u);
    kernel = descriptor->construct(storage.data());
    kernel->prepare({rate, 4u, 1024u});
    CHECK(kernel->preparedSuccessfully());
    const std::array params = {minimum_midi, maximum_midi, timbre_enabled ? 1.0F : 0.0F,
                               chord_key_enabled ? 1.0F : 0.0F};
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
    std::vector<std::uint8_t> pitch_frames;
    for (auto offset = 0u; offset < size;) {
      const auto frame_bytes = 16u + readU16(bytes.data() + offset + 12u);
      if (readU16(bytes.data() + offset) == 32u) {
        CHECK(frame_bytes == 48u);
        chord_frames.insert(chord_frames.end(), bytes.begin() + offset + 16u,
                            bytes.begin() + offset + frame_bytes);
        offset += frame_bytes;
        continue;
      }
      if (readU16(bytes.data() + offset) == 31u) {
        offset += frame_bytes;
        continue;
      }
      CHECK(readU16(bytes.data() + offset) == 24u);
      CHECK(readU16(bytes.data() + offset + 2u) == 6u);
      CHECK(readU16(bytes.data() + offset + 12u) == kPayloadBytes);
      const auto *payload = bytes.data() + offset + 16u;
      const auto age = readU32(payload + kRevisionAgeOffset);
      CHECK(age == (readU32(payload + 16u) >= 8u ? 8u : 0u));
      CHECK(readU32(payload + 24u) != 0u);
      for (auto pitch = 0u; pitch < kNoteCount; ++pitch)
        CHECK(std::isfinite(readF32(payload + kPitchCentsOffset + pitch * 4u)));
      for (auto revision = 0u; revision < 2u; ++revision) {
        const auto expected_age = 2u << revision;
        const auto plane = kIntermediateOffset + revision * kRevisionBytes;
        const auto intermediate_age = readU32(payload + plane);
        CHECK(intermediate_age == (readU32(payload + 16u) >= expected_age ? expected_age : 0u));
        for (auto pitch = 0u; pitch < kFinePitchCount; ++pitch) {
          const auto value = readF32(payload + plane + 4u + pitch * 4u);
          CHECK(std::isfinite(value) && value >= 0.0F && value <= 1.0F);
          CHECK(intermediate_age != 0u || value == 0.0F);
        }
      }
      for (auto pitch = 0u; pitch < kFinePitchCount; ++pitch) {
        const auto immediate = readF32(payload + kConfidenceOffset + pitch * 4u);
        CHECK(std::isfinite(immediate) && immediate >= 0.0F && immediate <= 1.0F);
        const auto revised = readF32(payload + kRevisedOffset + pitch * 4u);
        CHECK(std::isfinite(revised) && revised >= 0.0F && revised <= 1.0F);
        CHECK(age != 0u || revised == 0.0F);
      }
      pitch_frames.insert(pitch_frames.end(), bytes.begin() + offset,
                          bytes.begin() + offset + frame_bytes);
      offset += frame_bytes;
    }
    return pitch_frames;
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
float bagLevel(const std::uint8_t *payload, std::uint32_t pitch,
               std::uint32_t confidence_offset = kConfidenceOffset) {
  auto result = 0.0F;
  for (std::uint32_t division = 0u; division < kFineDivisions; ++division)
    result = std::max(
        result, readF32(payload + confidence_offset + (pitch * kFineDivisions + division) * 4u));
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
    CHECK(readU16(frame) == 24u && readU16(frame + 2u) == 6u);
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
  const auto measured = [](double midi, double amplitude, bool harmonic = false) {
    constexpr auto rate = 48000.0F;
    Harness harness(rate);
    const auto frequency = 440.0 * std::exp2((midi - 69.0) / 12.0);
    const auto frames = render(harness, rate, 0.6, [=](double time, std::uint32_t) {
      return harmonic ? signal(time, {{midi, amplitude, 1}})
                      : amplitude * std::sin(2.0 * kPi * frequency * time);
    });
    CHECK(!frames.empty());
    const auto *payload = lastPayload(frames);
    if (amplitude == 1.0) {
      // Full-scale tones have a real level in every fine division.
      for (auto division = 0u; division < kFineDivisions; ++division)
        CHECK(pitchVolume(payload, static_cast<std::uint32_t>(midi), division) > -240.0F);
    }
    return pitchVolume(payload, static_cast<std::uint32_t>(midi));
  };

  // The signal-derived level plane is independent of both confidence heads.
  const auto a4_correction = 3.0 * std::log2(440.0 / 100.0);
  CHECK(std::abs(measured(69.0, 1.0) - a4_correction) <= 1.0);
  CHECK(std::abs(measured(33.0, 1.0)) <= 1.0);
  const auto a4 = measured(69.0, 0.1);
  const auto a4_minus_20 = measured(69.0, 0.01);
  const auto a1 = measured(33.0, 0.1, true);
  std::printf("volume A4 %.3f dB, A4 -20 dB %.3f dB, A1 %.3f dB\n", static_cast<double>(a4),
              static_cast<double>(a4_minus_20), static_cast<double>(a1));
  CHECK(std::abs(a4 - (-20.0 + a4_correction)) <= 1.0);
  CHECK(std::abs((a4_minus_20 - a4) + 20.0F) <= 0.5F);
  double harmonic_power = 0.0;
  for (auto h = 1u; h <= 16u; ++h)
    harmonic_power += .01 / h;
  CHECK(std::abs(a1 - 10.0 * std::log10(harmonic_power)) <= 1.0);
}
void testEstimatedPitchCents() {
  constexpr auto rate = 48000.0F;
  constexpr auto midi = 69u;
  for (const auto cents : {-33.7, 7.3, 53.7}) {
    Harness harness(rate);
    const auto frequency = 440.0 * std::exp2(cents / 1200.0);
    const auto frames = render(harness, rate, 0.4, [=](double time, std::uint32_t) {
      return 0.1 * std::sin(2.0 * kPi * frequency * time);
    });
    const auto *payload = lastPayload(frames);
    const auto estimate = readF32(payload + kPitchCentsOffset + (midi - 21u) * 4u);
    std::printf("pitch cents expected %.3f estimated %.3f\n", cents, static_cast<double>(estimate));
    // Preserve the peak interpolation, including estimates beyond a note's half-semitone.
    CHECK(std::abs(estimate - cents) < 0.5);
  }
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
      // Fundamental-bearing tones retain their quality guard. Missing-fundamental
      // tones are compared with the independent model reference separately.
      for (const auto kind : {0, 1, 3}) {
        Harness harness(rate);
        std::vector<Tone> tones = {{static_cast<double>(midi), 0.08, kind % 2}};
        if (kind == 3)
          tones.push_back({static_cast<double>(midi + 12), 0.04, 1});
        const auto frames =
            render(harness, rate, 1.0, [&](double t, std::uint32_t) { return signal(t, tones); });
        unsigned fp = 0u, measured = 0u;
        unsigned lower_detected = 0u, upper_detected = 0u;
        // Harmonic low notes may also produce an octave-up detection. The model can miss
        // the upper real note in kind 3, so only the lower note's recall is required here.
        for (std::size_t offset = 0u; offset < frames.size(); offset += kFrameBytes) {
          const auto *payload = frames.data() + offset + 16u;
          // Score the same 0.4-0.8 s frames after their final R160 display revision arrives.
          const auto age = readU32(payload + kRevisionAgeOffset);
          const auto frame = readU32(payload + 16u);
          if (age == 0u || frame < age || frame - age < 19u || frame - age >= 39u)
            continue;
          ++measured;
          for (auto note = 24; note < 48; ++note) {
            const auto probability = bagLevel(payload, note - 21, kRevisedOffset);
            const auto detected = probability >= 0.5F;
            const auto allowed_octave = kind != 0 && note == midi + 12;
            fp += note != midi && detected && !allowed_octave ? 1u : 0u;
            lower_detected += note == midi && detected ? 1u : 0u;
            upper_detected += note == midi + 12 && detected ? 1u : 0u;
          }
        }
        std::printf("low octave %.0f Hz note %d kind %d lower %u upper %u fp %u\n",
                    static_cast<double>(rate), midi, kind, lower_detected, upper_detected, fp);
        CHECK(measured == 20u);
        CHECK(lower_detected * 100u >= measured * 95u);
        CHECK(fp == 0u);
      }
    }
  }
}
int testMissingFundamentalReference(const std::string &directory) {
  std::array<std::array<std::array<float, 2>, 20>, 2> expected{};
  std::ifstream input(directory + "/missing-fundamental.f32", std::ios::binary);
  input.read(reinterpret_cast<char *>(expected.data()), sizeof(expected));
  if (!input)
    return 2;
  auto condition = 0u;
  float maximum = 0.0F;
  for (const auto rate : {44100.0F, 48000.0F}) {
    Harness harness(rate);
    const auto frames = render(harness, rate, 1.0,
                               [](double t, std::uint32_t) { return signal(t, {{35.0, .08, 3}}); });
    auto measured = 0u;
    for (std::size_t offset = 0u; offset < frames.size(); offset += kFrameBytes) {
      const auto *payload = frames.data() + offset + 16u;
      const auto frame = readU32(payload + 16u);
      if (frame < 27u || frame >= 47u)
        continue;
      for (auto pitch = 0u; pitch < 2u; ++pitch) {
        const auto actual = bagLevel(payload, (pitch ? 47u : 35u) - 21u, kRevisedOffset);
        maximum = std::max(maximum, std::abs(actual - expected[condition][measured][pitch]));
      }
      ++measured;
    }
    CHECK(measured == 20u);
    ++condition;
  }
  std::printf("missing-fundamental independent PyTorch reference max %.9g\n", maximum);
  CHECK(maximum <= .0001F);
  return failures == 0 ? 0 : 1;
}
void testConfiguredRecognitionRange() {
  Harness harness(48000.0F, 60.0F, 72.0F);
  Harness full_range(48000.0F);
  const auto signal_in_range = [](double t, std::uint32_t) {
    return signal(t, {{48, 0.08, 1}, {60, 0.08, 1}, {72, 0.08, 1}, {84, 0.08, 1}});
  };
  const auto frames = render(harness, 48000.0F, 0.7, signal_in_range);
  const auto full_frames = render(full_range, 48000.0F, 0.7, signal_in_range);
  CHECK(!frames.empty());
  CHECK(frames.size() == full_frames.size());
  for (std::size_t offset = 0u; offset < frames.size(); offset += kFrameBytes) {
    const auto *payload = frames.data() + offset + 16u;
    const auto *full_payload = full_frames.data() + offset + 16u;
    for (auto midi = 21u; midi <= 108u; ++midi) {
      const auto cents_offset = kPitchCentsOffset + (midi - 21u) * 4u;
      CHECK(readF32(payload + cents_offset) ==
            (midi >= 60u && midi <= 72u ? readF32(full_payload + cents_offset) : 0.0F));
      for (auto division = 0u; division < kFineDivisions; ++division) {
        const auto fine_pitch = (midi - 21u) * kFineDivisions + division;
        if (midi >= 60u && midi <= 72u) {
          for (const auto plane : {kConfidenceOffset, kRevisedOffset, kVolumeOffset})
            CHECK(readF32(payload + plane + fine_pitch * 4u) ==
                  readF32(full_payload + plane + fine_pitch * 4u));
          continue;
        }
        CHECK(readF32(payload + kConfidenceOffset + fine_pitch * 4u) == 0.0F);
        CHECK(readF32(payload + kRevisedOffset + fine_pitch * 4u) == 0.0F);
        CHECK(readF32(payload + kVolumeOffset + fine_pitch * 4u) == -240.0F);
      }
    }
  }
}
void testSampleRateFiniteSignal() {
  for (const auto rate : {16000.0F, 48000.0F, 96000.0F, 384000.0F}) {
    Harness harness(rate);
    const auto frames = render(harness, rate, 0.4, [](double t, std::uint32_t) {
      return signal(t, {{60, 0.08, 1}, {96, 0.04, 0}});
    });
    CHECK(!frames.empty());
    for (auto offset = 0u; offset < frames.size(); offset += kFrameBytes) {
      const auto *payload = frames.data() + offset + 16u;
      for (auto p = 0u; p < kFinePitchCount; ++p) {
        const auto probability = readF32(payload + kConfidenceOffset + p * 4u);
        const auto level = readF32(payload + kVolumeOffset + p * 4u);
        CHECK(std::isfinite(probability) && probability >= 0.0F && probability <= 1.0F);
        CHECK(std::isfinite(level) && level >= -240.0F);
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
      for (auto pitch = 0u; pitch < kNoteCount; ++pitch)
        CHECK(readF32(payload + kPitchCentsOffset + pitch * 4u) == 0.0F);
      for (auto pitch = 0u; pitch < kFinePitchCount; ++pitch) {
        CHECK(readF32(payload + kConfidenceOffset + 4u * pitch) == 0.0F);
        CHECK(readF32(payload + kRevisedOffset + 4u * pitch) == 0.0F);
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
       {16000.0F, 44100.0F, 48000.0F, 88200.0F, 96000.0F, 176400.0F, 192000.0F, 384000.0F}) {
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
  const auto cancelled = render(opposite, 48000.0F, 0.45, [&](double t, std::uint32_t ch) {
    return (ch == 0u ? 1.0 : -1.0) * tone(t, ch);
  });
  CHECK(!cancelled.empty());
  for (auto offset = 0u; offset < cancelled.size(); offset += kFrameBytes) {
    const auto *payload = cancelled.data() + offset + 16u;
    for (auto p = 0u; p < kFinePitchCount; ++p) {
      CHECK(readF32(payload + kConfidenceOffset + p * 4u) == 0.0F);
      CHECK(readF32(payload + kRevisedOffset + p * 4u) == 0.0F);
      CHECK(readF32(payload + kVolumeOffset + p * 4u) == -240.0F);
    }
  }
  stereo.kernel->reset();
  auto cleared = run(stereo, 48000.0F, 3000u, {128u});
  CHECK(readU32(lastPayload(cleared) + 24u) == 2u);
  for (auto value : levels(cleared))
    CHECK(value == 0.0F);
  stereo.kernel->prepare({44100.0F, 2u, 1024u});
  cleared = run(stereo, 44100.0F, 3000u, {97u});
  CHECK(readU32(lastPayload(cleared) + 24u) == 3u);
  for (const auto channels : {1u, 2u, 4u, 2u, 1u, 2u}) {
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
void testAnalysisOnsets() {
  constexpr auto rate = 48000.0F;
  Harness harness(rate, 60.0F, 72.0F);
  const auto check_frames = [&](bool signal_present) {
    auto frame_count = 0u;
    bool positive = false;
    for (auto block = 0u; block < 40u; ++block) {
      std::array<float, 960> audio{};
      if (signal_present)
        for (auto i = 0u; i < audio.size(); ++i)
          audio[i] = static_cast<float>(
              0.1 * std::sin(2.0 * kPi * 440.0 * (block * audio.size() + i) / rate));
      {
        const effetune::allocation_guard::Scope guard;
        harness.kernel->process(audio.data(), 1u, static_cast<std::uint32_t>(audio.size()),
                                {static_cast<double>(block * audio.size()) / rate});
      }
      const auto *view = harness.kernel->noteAnalysisView();
      CHECK(view != nullptr);
      if (!view)
        continue;
      frame_count += view->count;
      for (auto i = 0u; i < view->count; ++i)
        for (auto pitch = 0u; pitch < kNoteCount; ++pitch) {
          const auto value = view->frames[i].onsets[pitch];
          CHECK(std::isfinite(value) && value >= 0.0F && value <= 1.0F);
          if (!signal_present || pitch + 21u < 60u || pitch + 21u > 72u)
            CHECK(value == 0.0F);
          else
            positive = positive || value > 0.0F;
        }
    }
    CHECK(frame_count != 0u);
    CHECK(!signal_present || positive);
  };
  check_frames(false);
  check_frames(true);
  harness.kernel->reset();
  CHECK(harness.kernel->noteAnalysisView()->count == 0u);
  check_frames(false);
}
void testRevisionsRetainCapturedPitchShape() {
  Harness harness(48000.0F);
  const auto frames = render(harness, 48000.0F, 0.5, [](double t, std::uint32_t) {
    return 0.1 * std::sin(2.0 * kPi * 440.0 * (t + 0.25 * t * t));
  });
  for (const auto age : {2u, 4u, 8u}) {
    const auto plane =
        age == 8u ? kRevisedOffset : kIntermediateOffset + (age == 2u ? 0u : kRevisionBytes) + 4u;
    auto compared = 0u;
    for (std::size_t frame = age; frame < frames.size() / kFrameBytes; ++frame) {
      const auto *revised = frames.data() + frame * kFrameBytes + 16u;
      const auto *original = frames.data() + (frame - age) * kFrameBytes + 16u;
      for (auto pitch = 0u; pitch < kNoteCount; ++pitch) {
        const auto original_peak = bagLevel(original, pitch, kConfidenceOffset);
        const auto revised_peak = bagLevel(revised, pitch, plane);
        if (original_peak <= 1.0e-20F || revised_peak <= 1.0e-20F)
          continue;
        for (auto division = 0u; division < kFineDivisions; ++division) {
          const auto cell = 4u * (pitch * kFineDivisions + division);
          CHECK(std::abs(readF32(original + kConfidenceOffset + cell) / original_peak -
                         readF32(revised + plane + cell) / revised_peak) < 1.0e-5F);
        }
        ++compared;
      }
    }
    CHECK(compared > 0u);
  }
}
void testTimbreHead() {
  using effetune::plugins::analyzer::TimbreAnalysis;
  using namespace timbre_reference;
  auto observer = std::make_unique<TimbreAnalysis>();
  observer->reset(kContextStartFrame);
  float maximum_logits = 0.0F, maximum_probability = 0.0F;
  float maximum_projection = 0.0F;
  float maximum_ctx = 0.0F, maximum_link = 0.0F, maximum_inv = 0.0F;
  const auto compare = [](const auto &actual, const auto &expected, float &maximum) {
    for (auto i = 0u; i < actual.size(); ++i)
      maximum = std::max(maximum, std::abs(actual[i] - expected[i]));
  };
  for (auto begin = 0u; begin < kNotes.size();) {
    auto end = begin + 1u;
    while (end < kNotes.size() && kNotes[end].confirmFrame == kNotes[begin].confirmFrame)
      ++end;
    std::array<TimbreAnalysis::Record, kNotes.size()> batch{};
    std::array<TimbreAnalysis::Features, kNotes.size()> features{};
    for (auto i = begin; i < end; ++i) {
      const auto &reference = kNotes[i];
      const TimbreAnalysis::Result boundary{
          i + 1u, reference.midi, reference.confirmFrame - 4u, reference.endFrame, 0u, {}};
      batch[i - begin] = TimbreAnalysis::makeRecord(boundary, reference.input.data());
      batch[i - begin].cx = reference.cx;
      compare(batch[i - begin].logits, reference.baseLogits, maximum_logits);
      compare(batch[i - begin].p, reference.baseProbabilities, maximum_probability);
      compare(batch[i - begin].z, reference.z, maximum_projection);
    }
    observer->evaluateBatch(batch.data(), end - begin, features.data());
    for (auto i = begin; i < end; ++i) {
      const auto &reference = kNotes[i];
      const auto &actual = features[i - begin];
      compare(actual.ctx, reference.ctx, maximum_ctx);
      compare(actual.link, reference.link, maximum_link);
      compare(actual.inv, reference.inv, maximum_inv);
      compare(actual.logits, reference.logits, maximum_logits);
      compare(actual.probabilities, reference.probabilities, maximum_probability);
    }
    begin = end;
  }
  std::printf(
      "timbre sequence reference max ctx %.9g link %.9g inv %.9g logits %.9g z %.9g p %.9g\n",
      maximum_ctx, maximum_link, maximum_inv, maximum_logits, maximum_projection,
      maximum_probability);
  CHECK(maximum_ctx < 2.0e-5F);
  CHECK(maximum_link < 2.0e-5F);
  CHECK(maximum_inv < 2.0e-5F);
  CHECK(maximum_logits < 2.0e-4F);
  CHECK(maximum_projection <= .001F);
  CHECK(maximum_probability < 2.0e-5F);
}
void testTimbreObservations() {
  using effetune::plugins::analyzer::TimbreAnalysis;
  auto immediate = std::make_unique<TimbreAnalysis>();
  auto delayed = std::make_unique<TimbreAnalysis>();
  immediate->reset();
  delayed->reset();
  std::vector<TimbreAnalysis::Result> first, second;
  const auto emit_first = [&](const auto &result) { first.push_back(result); };
  const auto emit_second = [&](const auto &result) { second.push_back(result); };
  for (auto index = 0u; index < 14u; ++index) {
    for (auto *observer : {immediate.get(), delayed.get()}) {
      auto &frame = observer->beginFrame(index);
      frame.a.fill(.01F * static_cast<float>(index));
      frame.c.fill(.02F * static_cast<float>(index));
      std::array<float, 300> inputs{};
      for (auto bin = 0u; bin < 300u; ++bin)
        inputs[bin] = std::log1p((index + 1.0F) * (bin + 1.0F));
      TimbreAnalysis::setInput(frame, inputs.data(), inputs.data());
    }
    if (index == 1u)
      immediate->start(48u, 1u, emit_first);
    if (index == 9u)
      delayed->start(48u, 1u, emit_second);
    immediate->advance(index, emit_first);
    if (index >= 8u)
      delayed->advance(index - 8u, emit_second);
  }
  CHECK(first.size() == 2u && second.size() == 2u);
  CHECK(first.back().probabilities == second.back().probabilities);
  CHECK(immediate->observations() == 3u && delayed->observations() == 3u);
  CHECK(immediate->decisions() == 1u && delayed->decisions() == 1u);
  // A short note reuses its last live observation, even when another note starts meanwhile.
  delayed->reset();
  second.clear();
  std::array<float, 1337> expected{};
  for (auto index = 0u; index < 7u; ++index) {
    auto &frame = delayed->beginFrame(index);
    frame.a.fill(.1F * index);
    frame.c.fill(.2F * index);
    frame.amplitudes.fill(.02F);
    frame.envelope.fill(-33.9794F);
    if (index == 1u) {
      delayed->start(48u, 1u, emit_second);
      std::fill_n(expected.data(), 216u, .1F);
      TimbreAnalysis::descriptor(frame, 48u, frame.envelope.data(), expected.data() + 216u);
      std::copy_n(expected.data(), 424u, expected.data() + 424u);
      std::copy_n(expected.data(), 424u, expected.data() + 848u);
      std::fill_n(expected.data() + 1272u, 64u, .2F);
      expected[1336] = 48.0F / 87.0F;
    }
    if (index == 2u)
      delayed->stop(48u, 2u, emit_second);
    if (index == 3u)
      delayed->start(48u, 3u, emit_second);
    delayed->advance(index, emit_second);
  }
  auto reference = std::make_unique<TimbreAnalysis>();
  reference->reset();
  auto record = TimbreAnalysis::makeRecord({1u, 69u, 1u, 2u, 0u, {}}, expected.data());
  record.cx = {0.0F, 1.0F, std::log1p(1.0F)};
  reference->evaluateBatch(&record, 1u);
  auto results = 0u;
  for (const auto &event : second)
    if (event.event == 2u) {
      ++results;
      CHECK(event.start == 1u && event.end == 2u);
      CHECK(event.probabilities == record.boundary.probabilities);
    }
  CHECK(results == 1u);
  delayed->reset();
  CHECK(delayed->find(1u) == nullptr && delayed->decisions() == 0u);
}
void testTimbreHistory() {
  using effetune::plugins::analyzer::TimbreAnalysis;
  auto observer = std::make_unique<TimbreAnalysis>();
  observer->reset();
  auto seed = TimbreAnalysis::makeRecord({1u, 21u, 0u, 5u, 0u, {}},
                                         timbre_reference::kNotes[0].input.data());
  std::vector<TimbreAnalysis::Record> history;
  float maximum_inv = 0.0F;
  // Ten minutes of logical time exercise the infinite-window decay without rendering audio.
  for (auto i = 0u; i <= 1000u; ++i) {
    auto record = seed;
    record.time = 4u + i * 30u;
    record.boundary = {i + 1u, 21u + i % 88u, record.time - 4u, record.time + 1u, 0u, {}};
    for (auto k = 0u; k < 9u; ++k)
      record.p[k] = static_cast<float>((i + k) % 9u + 1u) / 45.0F;
    TimbreAnalysis::Features features;
    observer->evaluateBatch(&record, 1u, &features);
    std::array<std::array<double, 10>, 2> exact{};
    for (const auto &past : history) {
      const auto decay = std::exp(-static_cast<double>(record.time - past.time) / 1000.0);
      const auto distance = (static_cast<double>(record.boundary.midi) - past.boundary.midi) / 4.0;
      const auto pitch_weight = std::exp(-.5 * distance * distance);
      for (auto group = 0u; group < 2u; ++group) {
        const auto weight = decay * (group ? pitch_weight : 1.0);
        for (auto k = 0u; k < 9u; ++k)
          exact[group][k] += weight * past.p[k];
        exact[group][9] += weight;
      }
    }
    for (auto group = 0u; group < 2u; ++group) {
      for (auto k = 0u; k < 9u; ++k) {
        const auto expected =
            static_cast<float>((exact[group][k] + .5 / 9.0) / (exact[group][9] + .5));
        maximum_inv = std::max(maximum_inv, std::abs(expected - features.inv[group * 10u + k]));
      }
      CHECK(std::abs(features.inv[group * 10u + 9u] -
                     static_cast<float>(std::log1p(exact[group][9]))) < 1.0e-6F);
    }
    history.push_back(record);
  }
  std::printf("timbre 10-minute inventory max %.9g\n", maximum_inv);
  CHECK(maximum_inv < 1.0e-6F);
  observer->reset();
  auto recent = std::make_unique<TimbreAnalysis>();
  recent->reset();
  std::array<TimbreAnalysis::Record, 88> batch{};
  std::array<TimbreAnalysis::Features, 88> features{};
  // Maximum simultaneous pitch count; overflow the ring while keeping the last 192 candidates.
  for (auto frame = 4u; frame <= 54u; ++frame) {
    for (auto pitch = 0u; pitch < 88u; ++pitch) {
      batch[pitch] = seed;
      batch[pitch].time = frame;
      batch[pitch].boundary = {
          (frame - 4u) * 88u + pitch + 1u, pitch + 21u, frame - 4u, frame + 1u, 0u, {}};
    }
    auto comparison = batch;
    observer->evaluateBatch(batch.data(), 88u, features.data());
    if (frame >= 51u)
      recent->evaluateBatch(comparison.data(), 88u);
    for (const auto &feature : features) {
      CHECK(std::abs(feature.ctx[8] - std::log1p(88.0F)) < 1.0e-6F);
      for (const auto probability : feature.probabilities)
        CHECK(std::isfinite(probability));
    }
  }
  CHECK(observer->latestFeatures(0u).link == recent->latestFeatures(0u).link);
  observer->reset(54u);
  recent->reset(54u);
  auto first = seed, second = seed;
  first.time = second.time = 58u;
  first.boundary.start = second.boundary.start = 54u;
  observer->evaluateBatch(&first, 1u);
  recent->evaluateBatch(&second, 1u);
  CHECK(first.boundary.probabilities == second.boundary.probabilities);
  CHECK(observer->latestFeatures(0u).ctx[30] == 4.0F / 750.0F);
}
int testEventModel(const std::string &directory) {
  using effetune::plugins::analyzer::HarmNetInference;
  using Input = std::array<float, 600>;
  using Output = std::array<float, 528>;
  std::array<Input, 40> inputs{};
  std::array<Output, 40> expected{}, reference{};
  std::array<std::array<float, 4u * 64u>, 40> expected_hidden{};
  std::ifstream input(directory + "/event-model-input.f32", std::ios::binary);
  std::ifstream targets(directory + "/event-model-expected.f32", std::ios::binary);
  std::ifstream hidden(directory + "/event-model-z.f32", std::ios::binary);
  input.read(reinterpret_cast<char *>(inputs.data()), sizeof(inputs));
  targets.read(reinterpret_cast<char *>(expected.data()), sizeof(expected));
  hidden.read(reinterpret_cast<char *>(expected_hidden.data()), sizeof(expected_hidden));
  if (!input || !targets || !hidden)
    return 2;
  const auto step = [](HarmNetInference &model, const Input &features, bool chunked) {
    model.begin();
    const auto bins = chunked ? 23u : 300u, pitches = chunked ? 7u : 88u;
    for (auto channel = 0u; channel < 2u; ++channel)
      for (auto begin = 0u; begin < 300u; begin += bins)
        model.setInput(channel, features.data() + channel * 300u, begin,
                       std::min(begin + bins, 300u));
    for (auto layer = 0u; layer < 8u; ++layer)
      for (auto begin = 0u; begin < 300u; begin += bins)
        model.convolution(layer, begin, std::min(begin + bins, 300u));
    for (auto begin = 0u; begin < 88u; begin += pitches)
      model.gather(begin, std::min(begin + pitches, 88u));
    for (auto begin = 0u; begin < 88u; begin += pitches)
      model.pitchConvolution(begin, std::min(begin + pitches, 88u));
    model.updateEventFlux(features.data());
    for (auto begin = 0u; begin < 88u; begin += pitches)
      model.recurrent(begin, std::min(begin + pitches, 88u));
    for (auto begin = 0u; begin < 88u; begin += pitches)
      model.inferEvents(begin, std::min(begin + pitches, 88u));
    Output output{};
    for (auto pitch = 0u; pitch < 88u; ++pitch) {
      for (auto head = 0u; head < 4u; ++head)
        output[pitch * 4u + head] = model.probability(pitch, head);
      output[352u + pitch] = model.onset(pitch);
      output[440u + pitch] = model.eventOnset(pitch);
    }
    return output;
  };
  auto model = std::make_unique<HarmNetInference>();
  std::array<float, 3> maximum{};
  float maximum_hidden = 0.0F;
  for (auto pass = 0u; pass < 3u; ++pass) {
    model->reset();
    model->setEventEnabled(true);
    for (auto frame = 0u; frame < inputs.size(); ++frame) {
      const auto output = step(*model, inputs[frame], pass == 1u);
      if (pass == 0u) {
        reference[frame] = output;
        for (auto column = 0u; column < output.size(); ++column) {
          const auto group = column < 352u ? 0u : column < 440u ? 1u : 2u;
          maximum[group] =
              std::max(maximum[group], std::abs(output[column] - expected[frame][column]));
        }
        constexpr std::array<unsigned, 4> pitches = {0u, 15u, 48u, 87u};
        for (auto p = 0u; p < pitches.size(); ++p)
          for (auto c = 0u; c < 64u; ++c)
            maximum_hidden =
                std::max(maximum_hidden, std::abs(model->hidden()[pitches[p] * 64u + c] -
                                                  expected_hidden[frame][p * 64u + c]));
      } else {
        CHECK(output == reference[frame]);
      }
    }
  }
  CHECK(*std::max_element(maximum.begin(), maximum.end()) <= .0001F);
  CHECK(maximum_hidden <= .001F);
  auto shadow = std::make_unique<HarmNetInference>();
  model->reset();
  shadow->reset();
  model->setEventEnabled(true);
  shadow->setEventEnabled(false);
  for (auto frame = 0u; frame < inputs.size(); ++frame) {
    if (frame == 16u) {
      model->setEventEnabled(false);
      model->resetEvent();
    }
    if (frame == 32u) {
      model->resetEvent();
      shadow->resetEvent();
      model->setEventEnabled(true);
      shadow->setEventEnabled(true);
    }
    if (frame == 16u || frame == 32u)
      for (auto pitch = 0u; pitch < 88u; ++pitch)
        CHECK(model->eventOnset(pitch) == 0.0F);
    const auto actual = step(*model, inputs[frame], false);
    const auto fresh = step(*shadow, inputs[frame], true);
    for (auto column = 0u; column < (frame >= 32u ? 528u : 440u); ++column)
      CHECK(actual[column] == fresh[column]);
  }
  effetune::plugins::analyzer::harmnet_detail::EventKernel event;
  event.updateFlux(inputs[0].data());
  CHECK(std::all_of(event.flux().begin(), event.flux().end(),
                    [](float value) { return value == 0.0F; }));
  event.updateFlux(inputs[1].data());
  event.reset();
  event.updateFlux(inputs[2].data());
  CHECK(std::all_of(event.flux().begin(), event.flux().end(),
                    [](float value) { return value == 0.0F; }));
  std::printf("event model presence %.9g age1 %.9g event7 %.9g z %.9g; chunk/reset/toggle exact\n",
              maximum[0], maximum[1], maximum[2], maximum_hidden);
  return failures == 0 ? 0 : 1;
}
int testTimbreAudioFixture(const std::string &directory) {
  using namespace effetune::plugins::analyzer;
  std::array<float, 30720> audio{};
  std::array<std::array<float, 600>, 40> expected_features{};
  std::array<std::array<float, 1337>, 3> expected_h{};
  std::array<std::array<float, 9>, 3> expected_probabilities{};
  const auto read = [&](const char *name, auto &value) {
    std::ifstream input(directory + "/" + name, std::ios::binary);
    input.read(reinterpret_cast<char *>(value.data()), sizeof(value));
    return static_cast<bool>(input);
  };
  if (!read("timbre-audio.f32", audio) || !read("event-model-input.f32", expected_features) ||
      !read("timbre-h.f32", expected_h) ||
      !read("timbre-h-probabilities.f32", expected_probabilities))
    return 2;
  std::array<std::unique_ptr<HarmNetFrontend>, 2> frontends;
  auto schedule = std::make_unique<effetune::dsp::StageSchedule<2048u, 512u>>();
  schedule->clear();
  for (auto lane = 0u; lane < 2u; ++lane) {
    frontends[lane] = std::make_unique<HarmNetFrontend>();
    CHECK(frontends[lane]->prepare(96000.0F, lane == 1u));
    frontends[lane]->appendStages(*schedule, lane, 120u);
  }
  CHECK(schedule->partition(120u));
  auto model = std::make_unique<HarmNetInference>();
  auto timbre = std::make_unique<TimbreAnalysis>();
  model->reset();
  timbre->reset();
  constexpr std::array<unsigned, 3> origins = {8u, 11u, 14u}, pitches = {15u, 39u, 48u};
  float maximum_features = 0.0F, maximum_h = 0.0F, maximum_p = 0.0F;
  const auto emit = [](const auto &) {};
  for (auto frame_index = 0u; frame_index < expected_features.size(); ++frame_index) {
    for (auto sample = 0u; sample < 1920u; ++sample) {
      const auto at = frame_index * 1920u + sample;
      for (auto &frontend : frontends)
        frontend->push(at < audio.size() ? audio[at] : 0.0F);
    }
    for (auto &frontend : frontends)
      CHECK(frontend->begin());
    std::array<std::array<float, 300>, 2> features{};
    for (auto stage_index = 0u; stage_index < schedule->stageCount(); ++stage_index) {
      const auto &stage = schedule->stage(stage_index);
      CHECK(frontends[stage.channel]->run(static_cast<NoteSpectrogramStage>(stage.kind),
                                          stage.begin, stage.end, features[stage.channel].data()));
    }
    model->begin();
    for (auto lane = 0u; lane < 2u; ++lane) {
      model->setInput(lane, features[lane].data(), 0u, 300u);
      for (auto bin = 0u; bin < 300u; ++bin)
        maximum_features =
            std::max(maximum_features, std::abs(features[lane][bin] -
                                                expected_features[frame_index][lane * 300u + bin]));
    }
    for (auto layer = 0u; layer < 8u; ++layer)
      model->convolution(layer, 0u, 300u);
    model->gather(0u, 88u);
    model->pitchConvolution(0u, 88u);
    model->recurrent(0u, 88u);
    auto &frame = timbre->beginFrame(frame_index);
    TimbreAnalysis::setInput(frame, features[0].data(), features[1].data());
    for (const auto pitch : pitches)
      model->copyTimbreFeatures(pitch, frame.a.data() + pitch * 216u, frame.c.data() + pitch * 64u);
    for (auto i = 0u; i < origins.size(); ++i)
      if (frame_index == origins[i])
        timbre->start(pitches[i], origins[i], emit);
    timbre->advance(frame_index, emit);
    for (auto i = 0u; i < origins.size(); ++i) {
      if (frame_index != origins[i] + 4u)
        continue;
      const auto *input = timbre->latestInput(pitches[i]);
      CHECK(input != nullptr);
      if (!input)
        continue;
      for (auto column = 0u; column < 1337u; ++column)
        maximum_h = std::max(maximum_h, std::abs(input[column] - expected_h[i][column]));
      std::array<float, 9> logits{}, probabilities{};
      TimbreAnalysis::infer(input, logits.data(), probabilities.data());
      for (auto column = 0u; column < 9u; ++column)
        maximum_p = std::max(maximum_p,
                             std::abs(probabilities[column] - expected_probabilities[i][column]));
    }
  }
  std::printf("synthetic audio reference features %.9g H %.9g timbre p %.9g\n", maximum_features,
              maximum_h, maximum_p);
  CHECK(maximum_features <= .0001F);
  CHECK(maximum_h <= .001F);
  CHECK(maximum_p <= .0001F);
  return failures == 0 ? 0 : 1;
}
void testTimbreTracking() {
  using namespace effetune::plugins::analyzer::event_rule_reference;
  effetune::plugins::analyzer::TimbreTracking rule;
  for (std::size_t row = 0; row < kInput.size() / 3u; ++row) {
    const auto offset = row * 3u;
    if (kInput[offset + 2u] != 0.0F)
      rule.reset();
    const auto decision =
        rule.step(kInput[offset], kInput[offset + 1u], kInput[offset + 2u] != 0.0F);
    CHECK(decision.start == (kExpected[offset] != 0.0F));
    CHECK(decision.end == (kExpected[offset + 1u] != 0.0F));
    CHECK(rule.active() == (kExpected[offset + 2u] != 0.0F));
  }
}
void testTimbreToggle() {
  auto actual = std::make_unique<effetune::plugins::analyzer::SpectralAnalysis>();
  auto baseline = std::make_unique<effetune::plugins::analyzer::SpectralAnalysis>();
  for (auto *analysis : {actual.get(), baseline.get()}) {
    analysis->prepare({48000, 2, 128});
    analysis->configure(21, 108, false);
  }
  actual->setTimbreEnabled(true);
  unsigned resets = 0;
  for (unsigned at = 0; at < 72000; at += 128) {
    if (at == 24064 || at == 48000) {
      if (at == 24064)
        CHECK(actual->timbreAnalysis()->decisions() > 0);
      actual->setTimbreEnabled(at == 48000);
      CHECK(actual->timbreAnalysis()->decisions() == 0);
      CHECK(actual->timbreAnalysis()->observations() == 0);
      for (unsigned frame = 0; frame < 80; ++frame)
        CHECK(actual->timbreAnalysis()->find(frame) == nullptr);
      ++resets;
    }
    std::array<float, 256> audio{};
    for (unsigned i = 0; i < 128; ++i) {
      const double time = (at + i) / 48000.0;
      const double phase = std::fmod(time, .2);
      double value = 0;
      if (phase >= .02 && phase < .16)
        for (unsigned harmonic = 1; harmonic <= 8; ++harmonic)
          value += .1 / harmonic *
                   std::sin(6.283185307179586 * 261.625565 * harmonic * time +
                            .37 * harmonic * harmonic);
      audio[i] = audio[i + 128] = static_cast<float>(value);
    }
    auto other = audio;
    actual->process(audio.data(), 2, 128, {at / 48000.0});
    baseline->process(other.data(), 2, 128, {at / 48000.0});
    CHECK(audio == other);
    const auto &a = actual->view(), &b = baseline->view();
    CHECK(a.count == b.count);
    for (unsigned frame = 0; frame < a.count; ++frame) {
      CHECK(a.frames[frame].probabilities == b.frames[frame].probabilities);
      CHECK(a.frames[frame].levels == b.frames[frame].levels);
      CHECK(a.frames[frame].onsets == b.frames[frame].onsets);
    }
  }
  CHECK(resets == 2);
  CHECK(actual->timbreAnalysis()->decisions() > 0);
  std::printf("spectral continuous ON/OFF/ON: history/stats cleared; shared SFZ frames exact\n");
}

void testTimbreIsolation() {
  using effetune::plugins::analyzer::SpectralAnalysis;
  auto off = std::make_unique<SpectralAnalysis>();
  auto on = std::make_unique<SpectralAnalysis>();
  off->prepare({96000.0F, 2u, 128u});
  on->prepare({96000.0F, 2u, 128u});
  off->configure(21u, 108u, false);
  on->configure(21u, 108u, false);
  on->setTimbreEnabled(true);
  std::array<float, 256> a{}, b{};
  std::array<std::uint8_t, 65536> off_bytes{}, on_bytes{};
  effetune::TelemetryRing off_ring, on_ring;
  off_ring.adopt(off_bytes.data(), static_cast<std::uint32_t>(off_bytes.size()));
  on_ring.adopt(on_bytes.data(), static_cast<std::uint32_t>(on_bytes.size()));
  std::uint32_t off_sequence = 0u, on_sequence = 0u;
  std::array<std::uint8_t, 65536> off_read{}, on_read{};
  auto result_count = 0u;
  std::vector<std::array<std::uint32_t, 2>> main_pitches;
  std::vector<effetune::plugins::analyzer::TimbreAnalysis::Result> intervals;
  for (auto block = 0u; block < 4500u; ++block) {
    for (auto i = 0u; i < 128u; ++i) {
      const auto time = static_cast<double>(block * 128u + i) / 96000.0;
      double value = 0.0;
      if (time >= .24 && time < 5.04) {
        const auto attack = static_cast<std::uint32_t>((time - .24) / .24);
        const auto local = time - (.24 + attack * .24);
        const auto duration = attack % 5u == 0u ? .06 : .19;
        if (attack < 20u && local < duration) {
          const auto chord = attack % 4u == 0u;
          const std::array<std::uint32_t, 6> notes = {45u, 52u, 57u, 60u, 64u, 69u};
          const auto count = chord ? 6u : 2u;
          for (auto note = 0u; note < count; ++note) {
            const auto midi = chord ? notes[note] : note == 0u ? 45u + attack % 5u * 5u : 69u;
            const auto frequency = 440.0 * std::exp2((static_cast<double>(midi) - 69.0) / 12.0);
            for (auto harmonic = 1u; harmonic <= 8u; ++harmonic)
              value += std::sin(2.0 * kPi * frequency * harmonic * local) / harmonic;
          }
          value *= .07 * std::min({1.0, local / .003, (duration - local) / .015}) /
                   std::sqrt(static_cast<double>(count));
        }
      }
      a[i] = a[128u + i] = static_cast<float>(value);
    }
    b = a;
    {
      const effetune::allocation_guard::Scope guard;
      off->process(a.data(), 2u, 128u, {static_cast<double>(block * 128u) / 96000.0});
      on->process(b.data(), 2u, 128u, {static_cast<double>(block * 128u) / 96000.0});
    }
    CHECK(a == b);
    const auto &off_view = off->view();
    const auto &on_view = on->view();
    CHECK(off_view.count == on_view.count);
    for (auto frame = 0u; frame < off_view.count; ++frame)
      CHECK(std::memcmp(&off_view.frames[frame], &on_view.frames[frame],
                        sizeof(effetune::NoteAnalysisFrame)) == 0);
    effetune::TelemetryWriter ow(off_ring, 1u, off_sequence), nw(on_ring, 1u, on_sequence);
    off->writeTelemetry(ow);
    on->writeTelemetry(nw);
    std::uint32_t dropped = 0u;
    const auto os =
        off_ring.read(off_read.data(), static_cast<std::uint32_t>(off_read.size()), &dropped);
    const auto ns =
        on_ring.read(on_read.data(), static_cast<std::uint32_t>(on_read.size()), &dropped);
    auto offset = 0u;
    for (auto position = 0u; position < ns;) {
      const auto type = readU16(on_read.data() + position);
      const auto size = readU16(on_read.data() + position + 12u);
      const auto *payload = on_read.data() + position + 16u;
      if (type == 24u) {
        CHECK(offset + kFrameBytes <= os);
        if (offset + kFrameBytes <= os)
          CHECK(std::memcmp(payload, off_read.data() + offset + 16u, kPayloadBytes) == 0);
        if (readU32(payload + kRevisionAgeOffset) == 8u)
          for (auto pitch = 0u; pitch < 88u; ++pitch) {
            if (bagLevel(payload, pitch, kRevisedOffset) >= .5F)
              main_pitches.push_back({readU32(payload + 16u) - 8u, pitch + 21u});
          }
        offset += kFrameBytes;
      } else {
        CHECK(type == 31u && size == 80u);
        const auto identity = readU32(payload + 20u);
        auto found = std::find_if(intervals.begin(), intervals.end(),
                                  [identity](const auto &note) { return note.noteId == identity; });
        if (found == intervals.end()) {
          intervals.push_back({identity,
                               readU32(payload + 24u),
                               readU32(payload + 32u),
                               readU32(payload + 36u),
                               0u,
                               {}});
          found = intervals.end() - 1;
        }
        if (readU32(payload + 36u) != 0xffffffffu)
          found->end = readU32(payload + 36u);
        if (readU32(payload + 28u) == 2u) {
          found->event = 2u;
          ++result_count;
          CHECK(readU32(payload + 16u) == readU32(payload + 32u) + 12u);
        }
      }
      position += 16u + size;
    }
    CHECK(offset == os);
  }
  CHECK(result_count > 0u);
  CHECK(main_pitches.size() > 500u);
  for (const auto &cell : main_pitches)
    CHECK(std::any_of(intervals.begin(), intervals.end(), [&](const auto &note) {
      return note.event == 2u && note.midi == cell[1] && note.start <= cell[0] &&
             cell[0] < note.end;
    }));
  CHECK(off->timbreAnalysis()->decisions() == 0u && off->timbreAnalysis()->observations() == 0u);
  on->setTimbreEnabled(false);
  CHECK(on->timbreAnalysis()->decisions() == 0u);
}
void testTimbreBlockSizes() {
  using effetune::plugins::analyzer::SpectralAnalysis;
  const auto render = [](std::uint32_t block_frames) {
    auto analysis = std::make_unique<SpectralAnalysis>();
    analysis->prepare({96000.0F, 1u, block_frames});
    analysis->configure(21u, 108u, false);
    analysis->setTimbreEnabled(true);
    std::array<std::uint8_t, 65536> storage{}, bytes{};
    effetune::TelemetryRing ring;
    ring.adopt(storage.data(), static_cast<std::uint32_t>(storage.size()));
    std::uint32_t sequence = 0u;
    std::vector<std::array<std::uint8_t, 60>> results;
    for (auto offset = 0u; offset < 96000u; offset += block_frames) {
      std::array<float, 1024> audio{};
      const auto count = std::min(block_frames, 96000u - offset);
      for (auto i = 0u; i < count; ++i) {
        const auto time = static_cast<double>(offset + i) / 96000.0;
        if (time >= .24 && time < .75) {
          const auto frequency = time < .5 ? 220.0 : 330.0;
          audio[i] = static_cast<float>(.1 * std::sin(2.0 * kPi * frequency * time) +
                                        .05 * std::sin(2.0 * kPi * frequency * 2.0 * time));
        }
      }
      analysis->process(audio.data(), 1u, count, {static_cast<double>(offset) / 96000.0});
      effetune::TelemetryWriter writer(ring, 1u, sequence);
      analysis->writeTelemetry(writer);
      std::uint32_t dropped = 0u;
      const auto size = ring.read(bytes.data(), static_cast<std::uint32_t>(bytes.size()), &dropped);
      CHECK(dropped == 0u);
      for (auto position = 0u; position < size;) {
        if (readU16(bytes.data() + position) == 31u) {
          std::array<std::uint8_t, 60> result{};
          // Source/emit frames, identity, boundaries, and all nine probabilities.
          std::copy_n(bytes.data() + position + 32u, result.size(), result.data());
          results.push_back(result);
        }
        position += 16u + readU16(bytes.data() + position + 12u);
      }
    }
    CHECK(std::any_of(results.begin(), results.end(),
                      [](const auto &result) { return readU32(result.data() + 12u) == 2u; }));
    return results;
  };
  const auto expected = render(128u);
  CHECK(expected == render(16u));
  CHECK(expected == render(1024u));
}
std::vector<std::uint8_t> readBinary(const std::string &path) {
  std::ifstream stream(path, std::ios::binary | std::ios::ate);
  if (!stream) {
    CHECK(false);
    return {};
  }
  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(stream.tellg()));
  stream.seekg(0);
  stream.read(reinterpret_cast<char *>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  CHECK(static_cast<bool>(stream));
  return bytes;
}
int writeChordKeyFixture(const char *input_path, const char *directory) {
  const auto input = readBinary(input_path);
  if (input.empty() || input.size() % (128u * sizeof(float)))
    return 2;
  const auto path = std::string(directory) + "/";
  std::ofstream planes(path + "chord-key-planes.bin", std::ios::binary);
  std::ofstream scores(path + "chord-key-native-scores.f32", std::ios::binary);
  std::ofstream telemetry(path + "chord-key-telemetry.bin", std::ios::binary);
  auto analysis = std::make_unique<effetune::plugins::analyzer::SpectralAnalysis>();
  analysis->prepare({48000.0F, 1u, 128u});
  analysis->configure(28u, 91u, true);
  analysis->reset(2u);
  Harness harness(48000.0F, 28.0F, 91.0F, false, true);
  harness.kernel->reset();
  unsigned cadence = 0u, rows = 0u;
  for (std::size_t offset = 0u; offset < input.size() / sizeof(float); offset += 128u) {
    std::array<float, 128> audio{};
    std::memcpy(audio.data(), input.data() + offset * sizeof(float), sizeof(audio));
    analysis->process(audio.data(), 1u, 128u, {static_cast<double>(offset) / 48000.0});
    harness.kernel->process(audio.data(), 1u, 128u, {static_cast<double>(offset) / 48000.0});
    effetune::TelemetryWriter writer(harness.ring, 206u, harness.sequence);
    analysis->writeTelemetry(writer);
    std::uint32_t dropped = 0u;
    const auto size = harness.ring.read(harness.bytes.data(),
                                        static_cast<std::uint32_t>(harness.bytes.size()), &dropped);
    CHECK(dropped == 0u);
    for (auto at = 0u; at < size; at += 16u + readU16(harness.bytes.data() + at + 12u)) {
      if (readU16(harness.bytes.data() + at) != 32u)
        continue;
      const auto &head = analysis->chordKeyHead();
      CHECK(
          std::equal(head.result().begin(), head.result().end(), harness.bytes.data() + at + 36u));
      planes.write(reinterpret_cast<const char *>(head.planes().data()), head.planes().size());
      scores.write(reinterpret_cast<const char *>(head.jointScores().data()), 457u * sizeof(float));
      scores.write(reinterpret_cast<const char *>(head.keyScores().data()), 25u * sizeof(float));
      ++rows;
    }
    cadence += 128u;
    if (cadence >= 800u) {
      cadence %= 800u;
      harness.kernel->writeTelemetry(writer);
      const auto count = harness.ring.read(
          harness.bytes.data(), static_cast<std::uint32_t>(harness.bytes.size()), &dropped);
      for (auto at = 0u; at < count; at += 16u + readU16(harness.bytes.data() + at + 12u))
        if (readU16(harness.bytes.data() + at) == 32u)
          telemetry.write(reinterpret_cast<const char *>(harness.bytes.data() + at), 48u);
    }
  }
  std::printf("chord/key fixture rows: %u\n", rows);
  CHECK(rows > 100u);
  return planes && scores && telemetry && failures == 0 ? 0 : 1;
}
int testChordKeyFixture(const char *directory) {
  using Head = effetune::plugins::analyzer::ChordKeyHead;
  const auto path = std::string(directory) + "/";
  const auto planes = readBinary(path + "chord-key-planes.bin");
  const auto scores = readBinary(path + "chord-key-scores.f32");
  const auto labels = readBinary(path + "chord-key-reference.bin");
  const auto restart = readBinary(path + "chord-key-restart-reference.bin");
  const auto restart52 = readBinary(path + "chord-key-restart52-reference.bin");
  const auto margins = readBinary(path + "chord-key-margins.f32");
  const auto metadata_bytes = readBinary(path + "chord-key.json");
  const std::string metadata(metadata_bytes.begin(), metadata_bytes.end());
  const auto margin_field = metadata.find("\"marginThreshold\"");
  const auto margin_colon = metadata.find(':', margin_field);
  CHECK(margin_colon != std::string::npos);
  if (margin_colon == std::string::npos)
    return 1;
  const auto margin_threshold = std::strtof(metadata.c_str() + margin_colon + 1u, nullptr);
  CHECK(margin_threshold > 0.0F && margin_threshold < .002F);
  const auto rows = planes.size() / sizeof(Head::Planes);
  CHECK(rows > 100u && scores.size() == rows * 482u * sizeof(float) && labels.size() == rows * 8u);
  if (scores.size() != rows * 482u * sizeof(float) || labels.size() != rows * 8u ||
      restart.size() != labels.size() || restart52.size() != labels.size() ||
      margins.size() != rows * 8u)
    return 1;
  Head head, decoder, boundary_decoder, boundary52_decoder, restarted, fresh;
  head.reset();
  decoder.reset();
  boundary_decoder.reset();
  boundary52_decoder.reset();
  restarted.reset();
  fresh.reset();
  auto max_error = 0.0F;
  std::vector<std::array<std::uint8_t, 8>> actual;
  std::vector<unsigned> actual_raw_keys, reference_raw_keys;
  for (std::size_t row = 0u; row < rows; ++row) {
    Head::Planes plane;
    std::copy_n(planes.data() + row * plane.size(), plane.size(), plane.data());
    head.foldPlanes(plane);
    head.recurrent(0u, 12u);
    head.decode();
    CHECK(head.planes() == plane);
    Head::ChordScores joint;
    Head::KeyScores key;
    std::memcpy(joint.data(), scores.data() + row * 482u * sizeof(float), sizeof(joint));
    std::memcpy(key.data(), scores.data() + (row * 482u + 457u) * sizeof(float), sizeof(key));
    for (auto i = 0u; i < 457u; ++i)
      max_error = std::max(max_error, std::abs(joint[i] - head.jointScores()[i]));
    for (auto i = 0u; i < 25u; ++i)
      max_error = std::max(max_error, std::abs(key[i] - head.keyScores()[i]));
    actual.push_back(head.result());
    actual_raw_keys.push_back(
        static_cast<unsigned>(std::max_element(head.keyScores().begin(), head.keyScores().end()) -
                              head.keyScores().begin()));
    reference_raw_keys.push_back(
        static_cast<unsigned>(std::max_element(key.begin(), key.end()) - key.begin()));
    decoder.decodeScores(joint, key);
    CHECK(std::equal(decoder.result().begin(), decoder.result().end(), labels.data() + row * 8u));
    if (row == 45u) {
      boundary_decoder.reset();
      restarted.reset();
    }
    boundary_decoder.decodeScores(joint, key);
    CHECK(std::equal(boundary_decoder.result().begin(), boundary_decoder.result().end(),
                     restart.data() + row * 8u));
    if (row == 52u)
      boundary52_decoder.reset();
    boundary52_decoder.decodeScores(joint, key);
    CHECK(std::equal(boundary52_decoder.result().begin(), boundary52_decoder.result().end(),
                     restart52.data() + row * 8u));
    restarted.foldPlanes(plane);
    restarted.recurrent(0u, 12u);
    restarted.decode();
    if (row >= 45u) {
      fresh.foldPlanes(plane);
      fresh.recurrent(0u, 12u);
      fresh.decode();
      CHECK(restarted.jointScores() == fresh.jointScores());
      CHECK(restarted.keyScores() == fresh.keyScores());
      CHECK(restarted.result() == fresh.result());
    }
  }
  CHECK(max_error < 1e-3F);
  const auto audio_bytes = readBinary(path + "chord-key-input.f32");
  auto analysis = std::make_unique<effetune::plugins::analyzer::SpectralAnalysis>();
  analysis->prepare({48000.0F, 1u, 128u});
  analysis->configure(28u, 91u, true);
  analysis->reset(2u);
  std::size_t plane_row = 0u;
  unsigned plane_mismatches = 0u;
  for (std::size_t offset = 0u; offset < audio_bytes.size() / sizeof(float); offset += 128u) {
    std::array<float, 128> audio{};
    std::memcpy(audio.data(), audio_bytes.data() + offset * sizeof(float), sizeof(audio));
    analysis->process(audio.data(), 1u, 128u, {static_cast<double>(offset) / 48000.0});
    if (analysis->view().count == 0u)
      continue;
    CHECK(plane_row < rows);
    if (plane_row >= rows)
      return 1;
    const auto &actual_planes = analysis->chordKeyHead().planes();
    Head copied;
    copied.foldPlanes(actual_planes);
    CHECK(copied.planes() == analysis->chordKeyHead().planes());
    for (auto i = 0u; i < actual_planes.size(); ++i) {
      const auto expected = planes[plane_row * actual_planes.size() + i];
      const auto signed_level = i % 4u == 3u;
      const auto actual_value =
          static_cast<int>(actual_planes[i]) - (signed_level && actual_planes[i] >= 128u ? 256 : 0);
      const auto expected_value =
          static_cast<int>(expected) - (signed_level && expected >= 128u ? 256 : 0);
      const auto difference = std::abs(actual_value - expected_value);
      plane_mismatches += difference != 0 ? 1u : 0u;
      CHECK(difference <= 1);
    }
    ++plane_row;
  }
  CHECK(plane_row == rows);
  std::printf("chord/key plane differences: %u (at most one LSB)\n", plane_mismatches);
  unsigned mismatches = 0u;
  for (std::size_t row = 0u; row < rows; ++row) {
    const auto *expected = labels.data() + row * 8u;
    if (!std::equal(actual[row].begin(), actual[row].begin() + 3u, expected)) {
      ++mismatches;
      CHECK(readF32(margins.data() + row * 8u) < margin_threshold);
    }
    if (actual_raw_keys[row] != reference_raw_keys[row]) {
      ++mismatches;
      CHECK(readF32(margins.data() + row * 8u + 4u) < margin_threshold);
    }
  }
  std::printf("chord/key maximum log-score error %.9g; immediate/raw-key mismatches %u\n",
              max_error, mismatches);
  return failures == 0 ? 0 : 1;
}
void testChordKeyHysteresis() {
  using Head = effetune::plugins::analyzer::ChordKeyHead;
  Head head;
  Head::ChordScores chords;
  chords.fill(-20.0F);
  chords[0] = 0.0F;
  Head::KeyScores key;
  key.fill(-20.0F);
  key[17] = 0.0F;
  for (auto pass = 0u; pass < 2u; ++pass) {
    head.reset();
    for (auto row = 0u; row < 15u; ++row) {
      head.decodeScores(chords, key);
      CHECK(head.result()[6] == 255u && head.result()[7] == 255u);
    }
    head.decodeScores(chords, key);
    CHECK(head.result()[6] == 17u && head.result()[7] == 17u);
  }
  key[0] = .25F;
  for (auto row = 0u; row < 10u; ++row) {
    head.decodeScores(chords, key);
    CHECK(head.result()[6] == 17u);
  }
  CHECK(head.result()[7] == 0u); // Overall counts raw keys, including sub-margin observations.
  key[0] = .3F;
  for (auto row = 0u; row < 4u; ++row) {
    head.decodeScores(chords, key);
    CHECK(head.result()[6] == 17u);
  }
  auto invalid = key;
  invalid[8] = std::numeric_limits<float>::quiet_NaN();
  head.decodeScores(chords, invalid);
  CHECK(head.result()[6] == 17u && head.result()[7] == 0u);
  head.decodeScores(chords, key);
  CHECK(head.result()[6] == 0u); // A NaN row preserves the pending streak.
  key[24] = 1.0F;
  for (auto row = 0u; row < 5u; ++row)
    head.decodeScores(chords, key);
  CHECK(head.result()[6] == 24u && head.result()[7] == 0u);
  head.reset();
  for (auto row = 0u; row < 20u; ++row)
    head.decodeScores(chords, key);
  CHECK(head.result()[6] == 24u && head.result()[7] == 255u);
  key.fill(0.0F);
  head.reset();
  for (auto row = 0u; row < 16u; ++row)
    head.decodeScores(chords, key);
  CHECK(head.result()[6] == 0u && head.result()[7] == 0u);
}

void testChordHysteresis() {
  using Head = effetune::plugins::analyzer::ChordKeyHead;
  Head head;
  Head::ChordScores scores;
  scores.fill(-20.0F);
  scores[0] = 0.0F;
  Head::KeyScores key{};
  head.reset();
  head.decodeScores(scores, key);
  scores[38] = 1.0F;
  for (auto row = 0u; row < 10u; ++row) {
    head.decodeScores(scores, key);
    CHECK(head.result()[3] == 0u);
  }
  scores[38] = 1.5F;
  for (auto row = 0u; row < 9u; ++row) {
    head.decodeScores(scores, key);
    CHECK(head.result()[0] == 1u && head.result()[3] == 0u);
  }
  head.decodeScores(scores, key);
  CHECK(head.result()[3] == 1u);
  head.reset();
  head.decodeScores(scores, key);
  CHECK(head.result()[3] == 1u);
  scores[0] = scores[38];
  head.reset();
  head.decodeScores(scores, key);
  CHECK(head.result()[0] == 0u && head.result()[3] == 0u);
}
void testConfirmedChordProbability() {
  using Head = effetune::plugins::analyzer::ChordKeyHead;
  constexpr auto delay = effetune::plugins::analyzer::chord_key_weights::kChordStreak - 1u;
  Head head;
  Head::KeyScores key;
  key.fill(std::log(1.0F / 25.0F));
  std::array<Head::ChordScores, 60> observations;
  for (auto pass = 0u; pass < 2u; ++pass) {
    head.reset();
    CHECK(head.confirmedProbability() == 0.0F);
    auto delayed_selection = false;
    for (auto row = 0u; row < observations.size(); ++row) {
      auto &scores = observations[row];
      scores.fill(std::log(.00001F));
      const auto best = row < 20u ? 0u : row < 40u ? 38u : 456u;
      scores[best] = std::log(.6F + static_cast<float>(row % 7u) * .05F);
      head.decodeScores(scores, key);
      const auto &result = head.result();
      const auto selected = result[3] == 255u ? 456u : result[3] * 38u;
      CHECK(selected == 0u || selected == 38u || selected == 456u);
      const auto historical_row = row > delay ? row - delay : 0u;
      const auto expected = std::exp(observations[historical_row][selected]);
      CHECK(std::abs(head.confirmedProbability() - expected) < 1e-6F);
      CHECK(head.confirmedProbability() >= 0.0F && head.confirmedProbability() <= 1.0F);
      delayed_selection = delayed_selection || selected != best;
    }
    CHECK(delayed_selection);
    CHECK(head.result()[3] == 255u && head.confirmedProbability() > .5F);
  }
}

void testChordKeyLifecycle() {
  using Analysis = effetune::plugins::analyzer::SpectralAnalysis;
  auto render = [](bool enabled, unsigned block, unsigned minimum, unsigned maximum, bool boundary,
                   std::vector<std::uint8_t> *notes, std::vector<std::uint8_t> *timbre,
                   std::vector<effetune::NoteAnalysisFrame> *views, float gain = 1.0F) {
    auto analysis = std::make_unique<Analysis>();
    analysis->prepare({48000.0F, 2u, 1024u});
    analysis->configure(minimum, maximum, enabled);
    analysis->setTimbreEnabled(true);
    analysis->reset(3u);
    std::vector<std::uint8_t> storage(512u * 1024u), bytes(storage.size()), chords;
    effetune::TelemetryRing ring;
    ring.adopt(storage.data(), static_cast<std::uint32_t>(storage.size()));
    unsigned sequence = 0u;
    for (auto offset = 0u; offset < 76800u; offset += block) {
      if (boundary && offset == 30720u)
        analysis->restartChordKey();
      std::vector<float> audio(block * 2u);
      for (auto i = 0u; i < block; ++i)
        audio[i] = audio[block + i] =
            gain * static_cast<float>(
                       signal((offset + i) / 48000.0, {{48, .1, 1}, {64, .1, 1}, {67, .1, 1}}));
      const auto original = audio;
      analysis->process(audio.data(), 2u, block, {offset / 48000.0});
      CHECK(audio == original);
      if (views)
        for (auto i = 0u; i < analysis->view().count; ++i)
          views->push_back(analysis->view().frames[i]);
      effetune::TelemetryWriter writer(ring, 206u, sequence);
      analysis->writeTelemetry(writer);
      unsigned dropped = 0u;
      const auto size = ring.read(bytes.data(), static_cast<std::uint32_t>(bytes.size()), &dropped);
      CHECK(dropped == 0u);
      for (auto at = 0u; at < size; at += 16u + readU16(bytes.data() + at + 12u)) {
        const auto type = readU16(bytes.data() + at), count = readU16(bytes.data() + at + 12u);
        if (type == 32u) {
          CHECK(count == 32u);
          const auto probability = readF32(bytes.data() + at + 44u);
          CHECK(std::isfinite(probability) && probability >= 0.0F && probability <= 1.0F);
        }
        auto *target = type == 32u ? &chords : type == 24u ? notes : timbre;
        if (target)
          target->insert(target->end(), bytes.begin() + at + 16u, bytes.begin() + at + 16u + count);
      }
    }
    return chords;
  };
  for (auto minimum : {28u, 21u}) {
    const auto maximum = minimum == 28u ? 91u : 108u;
    std::vector<std::uint8_t> off_notes, on_notes, off_timbre, on_timbre;
    std::vector<effetune::NoteAnalysisFrame> off_views, on_views;
    CHECK(
        render(false, 128u, minimum, maximum, false, &off_notes, &off_timbre, &off_views).empty());
    const auto chords =
        render(true, 128u, minimum, maximum, false, &on_notes, &on_timbre, &on_views);
    CHECK(!chords.empty());
    CHECK(off_notes == on_notes);
    CHECK(off_timbre == on_timbre);
    CHECK(off_views.size() == on_views.size());
    for (std::size_t i = 0u; i < std::min(off_views.size(), on_views.size()); ++i) {
      CHECK(off_views[i].sampleOffset == on_views[i].sampleOffset);
      CHECK(off_views[i].probabilities == on_views[i].probabilities);
      CHECK(off_views[i].levels == on_views[i].levels);
      CHECK(off_views[i].onsets == on_views[i].onsets);
    }
    if (minimum == 28u) {
      CHECK(chords == render(true, 16u, minimum, maximum, false, nullptr, nullptr, nullptr));
      CHECK(chords == render(true, 1024u, minimum, maximum, false, nullptr, nullptr, nullptr));
      std::vector<std::uint8_t> boundary_notes, boundary_timbre;
      const auto restarted =
          render(true, 128u, minimum, maximum, true, &boundary_notes, &boundary_timbre, nullptr);
      CHECK(boundary_notes == on_notes);
      CHECK(boundary_timbre == on_timbre);
      unsigned empty = 0u;
      for (std::size_t at = 32u * 30u; at < restarted.size(); at += 32u)
        if (restarted[at + 27u] == 255u)
          ++empty;
      CHECK(empty >= 15u);
    }
  }
  Harness harness(48000.0F, 28.0F, 91.0F, false, true);
  const auto silence = render(true, 128u, 28u, 91u, false, nullptr, nullptr, nullptr, 0.0F);
  CHECK(!silence.empty());
  unsigned trusted_silence_run = 0u;
  for (std::size_t at = 0u; at < silence.size(); at += 32u) {
    CHECK(silence[at + 26u] == (at / 32u < 15u ? 255u : 24u));
    CHECK(silence[at + 27u] == 255u);
    trusted_silence_run = silence[at + 23u] == 255u && readF32(silence.data() + at + 28u) > .5F
                              ? trusted_silence_run + 1u
                              : 0u;
  }
  CHECK(trusted_silence_run >= 9u);
  run(harness, 48000.0F, 38400u, {128u}, {48, 64, 67});
  const auto first = harness.chord_frames;
  harness.chord_frames.clear();
  harness.kernel->reset();
  run(harness, 48000.0F, 38400u, {128u}, {48, 64, 67});
  CHECK(first.size() == harness.chord_frames.size());
  for (std::size_t at = 0u; at < first.size(); at += 32u)
    CHECK(std::equal(first.begin() + at + 16u, first.begin() + at + 32u,
                     harness.chord_frames.begin() + at + 16u));
}

int writeTelemetryFixture(const char *input_path, const char *output_path) {
  std::ifstream input(input_path, std::ios::binary | std::ios::ate);
  if (!input || input.tellg() <= 0 || input.tellg() % (128u * sizeof(float)) != 0)
    return 2;
  std::vector<float> samples(static_cast<std::size_t>(input.tellg()) / sizeof(float));
  input.seekg(0);
  input.read(reinterpret_cast<char *>(samples.data()),
             static_cast<std::streamsize>(samples.size() * sizeof(float)));
  std::ofstream output(output_path, std::ios::binary);
  if (!input || !output)
    return 2;
  Harness harness(96000.0F, 21.0F, 108.0F, true);
  // Engine::createInstance resets each kernel once after prepare.
  harness.kernel->reset();
  unsigned telemetry_frames = 0u, pitch_frames = 0u;
  std::array<unsigned, 4> events{};
  for (std::size_t offset = 0u; offset < samples.size(); offset += 128u) {
    std::array<float, 128> audio{};
    std::copy_n(samples.data() + offset, audio.size(), audio.data());
    {
      const effetune::allocation_guard::Scope guard;
      harness.kernel->process(audio.data(), 1u, 128u, {static_cast<double>(offset) / 96000.0});
    }
    CHECK(std::equal(audio.begin(), audio.end(), samples.data() + offset));
    // Match the public engine's 60 Hz telemetry cadence for this 96 kHz input.
    telemetry_frames += 128u;
    if (telemetry_frames < 1600u)
      continue;
    telemetry_frames %= 1600u;
    effetune::TelemetryWriter writer(harness.ring, 206u, harness.sequence);
    harness.kernel->writeTelemetry(writer);
    std::uint32_t dropped = 0u;
    const auto size = harness.ring.read(harness.bytes.data(),
                                        static_cast<std::uint32_t>(harness.bytes.size()), &dropped);
    CHECK(dropped == 0u);
    for (auto at = 0u; at < size;) {
      const auto *record = harness.bytes.data() + at;
      const auto type = readU16(record);
      CHECK(type == 24u || type == 31u);
      if (type == 24u)
        ++pitch_frames;
      else if (type == 31u) {
        const auto event = readU32(record + 44u);
        CHECK(event > 0u && event < events.size());
        if (event < events.size())
          ++events[event];
      }
      at += (16u + readU16(record + 12u) + 3u) & ~3u;
    }
    output.write(reinterpret_cast<const char *>(harness.bytes.data()), size);
  }
  std::printf("native telemetry reference: pitch %u start %u decision %u stop %u\n", pitch_frames,
              events[1], events[2], events[3]);
  CHECK(pitch_frames > 50u);
  CHECK(events[1] > 0u && events[2] > 0u && events[3] > 0u);
  return output && failures == 0 ? 0 : 1;
}
} // namespace
int main(int argc, char **argv) {
  if (argc == 2 && std::strcmp(argv[1], "--chord-schedule-weight") == 0) {
    auto analysis = std::make_unique<effetune::plugins::analyzer::SpectralAnalysis>();
    analysis->prepare({96000.0F, 2u, 128u});
    analysis->configure(21u, 108u, false);
    std::array<float, 3840> silence{};
    analysis->process(silence.data(), 2u, 1920u, {});
    std::printf("%.0f\n", analysis->scheduleWeight());
    return 0;
  }
  if (argc == 4 && std::strcmp(argv[1], "--write-chord-key-fixture") == 0)
    return writeChordKeyFixture(argv[2], argv[3]);
  if (argc == 3 && std::strcmp(argv[1], "--chord-key-fixture") == 0)
    return testChordKeyFixture(argv[2]);
  if (argc == 2 && std::strcmp(argv[1], "--chord-key-only") == 0) {
    testChordKeyHysteresis();
    testChordHysteresis();
    testConfirmedChordProbability();
    testChordKeyLifecycle();
    return failures == 0 ? 0 : 1;
  }
  if (argc == 4 && std::strcmp(argv[1], "--write-telemetry-fixture") == 0)
    return writeTelemetryFixture(argv[2], argv[3]);
  if (argc == 3 && std::strcmp(argv[1], "--model-fixture") == 0) {
    if (testChordKeyFixture(argv[2]) != 0)
      return 1;
    if (testEventModel(argv[2]) != 0)
      return 1;
    if (testTimbreAudioFixture(argv[2]) != 0)
      return 1;
    return testMissingFundamentalReference(argv[2]);
  }
  if (argc == 2 && std::strcmp(argv[1], "--timbre-only") == 0) {
    testTimbreHead();
    testTimbreObservations();
    testTimbreHistory();
    testTimbreTracking();
    testTimbreIsolation();
    testTimbreToggle();
    testTimbreBlockSizes();
    return failures == 0 ? 0 : 1;
  }
  if (argc == 2 && std::strcmp(argv[1], "--quality-report") == 0) {
    testPresenceQuality();
    testPresenceMovingVoices();
    return failures == 0 ? 0 : 1;
  }
  if (argc != 1) {
    std::fprintf(stderr, "usage: %s [--quality-report]\n", argv[0]);
    return 2;
  }
  testChordKeyHysteresis();
  testChordHysteresis();
  testConfirmedChordProbability();
  testChordKeyLifecycle();
  testTimbreHead();
  testTimbreObservations();
  testTimbreHistory();
  testTimbreTracking();
  testTimbreIsolation();
  testTimbreToggle();
  testTimbreBlockSizes();
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
  testEstimatedPitchCents();
  testPresenceRoutingAndLifecycle();
  testConfiguredRecognitionRange();
  testAnalysisOnsets();
  testRevisionsRetainCapturedPitchShape();
  testSampleRateFiniteSignal();
  testLowOctaveDiscrimination();
  return failures == 0 ? 0 : 1;
}

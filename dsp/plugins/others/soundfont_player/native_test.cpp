#include "../../../test/sample_player_fixture.h"
#include "../sfz/envelope.h"
#include "../sfz/equalizer.h"
#include "../sfz/sample_cache.h"
#include "../sfz/sf2_profile.h"
#include "../sfz_note_player/bank.h"
#include "SFZModulationSchema.h"
#include "SoundFontPlayerPluginParams.h"
#include "allocation_guard.h"
#include "binary_io.h"
#include "effetune/kernel.h"
#include "modulation_fixture.h"
#include "playback_fixture.h"
#include "script_fixture.h"
#include "sf2_fixture.h"
#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <span>
#include <string>
#include <vector>
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_SoundFontPlayerPlugin() noexcept;
namespace {
using namespace effetune;
using namespace effetune::plugins::others::sfz;
int failures = 0;
#define CHECK(x)                                                                                   \
  do {                                                                                             \
    if (!(x)) {                                                                                    \
      std::fprintf(stderr, "sfz-midi:%d %s\n", __LINE__, #x);                                      \
      ++failures;                                                                                  \
    }                                                                                              \
  } while (false)
using Region = std::array<float, kStride>;
std::array<std::uint8_t, 584> readMixer(PluginKernel &kernel);
float mixerPeak(const std::array<std::uint8_t, 584> &state, unsigned channel);
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
  r[LowChannel] = 1;
  r[HighChannel] = 16;
  r[LowBend] = -8192;
  r[HighBend] = 8191;
  r[HighChannelAftertouch] = r[HighPolyAftertouch] = r[HighProgram] = 127;
  for (auto field = static_cast<unsigned>(SwitchLow); field <= SwitchDefault; ++field)
    r[field] = -1;
  r[Polyphony] = r[NotePolyphony] = 128;
  r[BendUp] = 200;
  r[BendDown] = -200;
  r[LoopCount] = -1;
  r[Cutoff] = 20000;
  r[AmpKeyCenter] = 60;
  r[OffTime] = .006F;
  r[EQ1Frequency] = 50;
  r[EQ2Frequency] = 500;
  r[EQ3Frequency] = 5000;
  r[EQ1Bandwidth] = r[EQ2Bandwidth] = r[EQ3Bandwidth] = 1;
  return r;
}
using Controls = std::vector<std::pair<std::uint32_t, float>>;
struct Bank {
  std::vector<float> words;
  std::uint32_t footprint = 0;
  explicit Bank(std::vector<Region> regions = {region()}, std::uint32_t samples = 1024,
                bool condition = false, Controls controls = {},
                std::span<const std::uint8_t> script = {}, bool streamed = false) {
    if (condition)
      controls.emplace_back(1u, 64.0F);
    std::sort(controls.begin(), controls.end());
    const auto controlWords = static_cast<std::uint32_t>(controls.size()) * 2u;
    const auto count = static_cast<std::uint32_t>(regions.size());
    const auto headerWords = streamed ? kStreamHeader : kHeader;
    words.resize(8u + headerWords + count * kStride + controlWords + script.size() / 4u +
                     (streamed ? 12u : samples),
                 .25F);
    auto *bytes = reinterpret_cast<std::uint8_t *>(words.data());
    std::fill_n(bytes, 32u, std::uint8_t{0});
    binary_io::writeU32(bytes, 0x31415445u);
    binary_io::writeU32(bytes + 4, 1u);
    binary_io::writeU32(bytes + 8, static_cast<std::uint32_t>(words.size()) - 8u);
    binary_io::writeU32(bytes + 12, 1u);
    auto *h = words.data() + 8;
    const std::array<std::uint32_t, kStreamHeader> header = {
        kMagic,
        streamed ? kStreamVersion : kVersion,
        count,
        kStride,
        headerWords + count * kStride + controlWords +
            static_cast<std::uint32_t>(script.size() / 4u) + (streamed ? 12u : 0u),
        static_cast<std::uint32_t>(words.size() - 8u),
        1u,
        controlWords,
        headerWords + count * kStride + controlWords,
        static_cast<std::uint32_t>(script.size()),
        0u,
        0u,
        streamed ? headerWords + count * kStride + controlWords +
                       static_cast<std::uint32_t>(script.size() / 4u)
                 : 0u,
        streamed ? 1u : 0u,
        streamed ? 4u : 0u,
        streamed ? 1u : 0u};
    for (std::size_t i = 0; i < headerWords; ++i)
      h[i] = std::bit_cast<float>(header[i]);
    std::uint32_t spans = 0;
    for (std::size_t i = 0; i < regions.size(); ++i) {
      std::copy(regions[i].begin(), regions[i].end(), h + headerWords + i * kStride);
      for (std::uint32_t field = 0; field < kStride; ++field)
        if (isIndexField(field))
          h[headerWords + i * kStride + field] =
              std::bit_cast<float>(static_cast<std::uint32_t>(regions[i][field]));
      if (!controls.empty()) {
        auto *r = h + headerWords + i * kStride;
        r[ControlOffset] = std::bit_cast<float>(headerWords + count * kStride);
        r[ControlCount] = std::bit_cast<float>(static_cast<std::uint32_t>(controls.size()));
      }
      spans += static_cast<std::uint32_t>(regions[i][HighKey] - regions[i][LowKey] + 1);
    }
    for (auto i = 0u; i < controls.size(); ++i) {
      h[headerWords + count * kStride + 2u * i] = std::bit_cast<float>(controls[i].first);
      h[headerWords + count * kStride + 2u * i + 1u] = controls[i].second;
    }
    if (!script.empty())
      std::memcpy(h + headerWords + count * kStride + controlWords, script.data(), script.size());
    footprint = static_cast<std::uint32_t>(words.size() * 4u) + 4u * (131u + spans);
    if (streamed) {
      auto *table = h + header[12];
      std::fill_n(table, 12, 0.0F);
      table[0] = std::bit_cast<float>(samples);
      table[2] = std::bit_cast<float>(1u);
      table[3] = std::bit_cast<float>(48000u);
      footprint += 4u * (4096u * 4u + 32u) + 16u * 4u + 32u + 4096u * 24u;
    }
  }
  AssetBeginInfo info(unsigned sampleRate = 48000) const {
    AssetBeginInfo result{
        1u,        static_cast<std::uint32_t>(words.size() - 8u), 0u, 0u, 1u, 0u, 0u, 2u,
        footprint, static_cast<std::uint32_t>(words.size() * 4u)};
    // Invalid-metadata tests still exercise the real asset validator. Valid
    // fixtures use the same complete target-native query as public hosts.
    (void)test::addSamplePlayerFixtureStorage(
        result, {reinterpret_cast<const std::uint8_t *>(words.data()), words.size() * 4u},
        {static_cast<float>(sampleRate), 2, 128}, ET_SAMPLE_PLAYER_MAIN);
    return result;
  }
};

struct Player {
  alignas(std::max_align_t) std::array<std::byte, 16384> storage{};
  const KernelDescriptor *descriptor = et_kernel_descriptor_SoundFontPlayerPlugin();
  PluginKernel *kernel = descriptor->construct(storage.data());
  std::array<float, 256> audio{};
  unsigned sampleRate = 48000;
  Player(std::vector<Region> regions = {region()}, bool ramp = false, bool condition = false,
         Controls controls = {}, bool sine = false, std::span<const std::uint8_t> script = {},
         unsigned rate = 48000, unsigned initialMidiGeneration = 1, bool stageDefaults = true) {
    sampleRate = rate;
    kernel->prepare({static_cast<float>(rate), 2, 128});
    CHECK(kernel->preparedSuccessfully());
    if (stageDefaults)
      configure(0);
    Bank bank(regions, 1024, condition, std::move(controls), script);
    if (ramp)
      for (auto frame = 0u; frame < 1024u; ++frame)
        bank.words[bank.words.size() - 1024u + frame] = static_cast<float>(frame) / 1024.0F;
    if (sine)
      for (auto frame = 0u; frame < 1024u; ++frame)
        bank.words[bank.words.size() - 1024u + frame] =
            .25F * std::sin(6.283185307179586F * frame / 32.0F);
    std::unique_ptr<PreparedAsset> asset;
    CHECK(kernel->assetPreparer(0)({static_cast<float>(rate), 2, 128}, bank.info(rate),
                                   reinterpret_cast<const std::uint8_t *>(bank.words.data()), 1,
                                   asset) == ET_OK);
    CHECK(kernel->exchangePreparedAsset(0, asset) == ET_OK);
    kernel->reset();
    if (initialMidiGeneration)
      CHECK(kernel->setMidiEvents(nullptr, 0, initialMidiGeneration, ET_MIDI_RESET) == ET_OK);
  }
  ~Player() { descriptor->destroy(kernel); }
  bool loadCompiled(std::span<const std::uint8_t> bytes, std::uint32_t footprint) {
    AssetBeginInfo info{1,         static_cast<std::uint32_t>((bytes.size() - 32u) / 4u),
                        0,         0,
                        1,         0,
                        0,         2,
                        footprint, static_cast<std::uint32_t>(bytes.size())};
    CHECK(test::addSamplePlayerFixtureStorage(info, bytes, {static_cast<float>(sampleRate), 2, 128},
                                              ET_SAMPLE_PLAYER_MAIN) == ET_OK);
    std::unique_ptr<PreparedAsset> asset;
    const auto status = kernel->assetPreparer(0)({static_cast<float>(sampleRate), 2, 128}, info,
                                                 bytes.data(), 1, asset);
    CHECK(status == ET_OK);
    if (status != ET_OK) {
      std::fprintf(stderr, "compiled fixture: bytes=%zu footprint=%u status=%d\n", bytes.size(),
                   footprint, status);
      return false;
    }
    CHECK(kernel->exchangePreparedAsset(0, asset) == ET_OK);
    kernel->reset();
    CHECK(kernel->setMidiEvents(nullptr, 0, 2, ET_MIDI_RESET) == ET_OK);
    return true;
  }
  static void fillModulationPage(std::span<float> samples, std::uint32_t page) {
    for (auto i = 0u; i < samples.size(); ++i) {
      const auto frame = static_cast<double>(page) * 4096 + i;
      samples[i] = static_cast<float>(.2 * std::sin(6.283185307179586 * frame / 37) +
                                      .05 * std::sin(6.283185307179586 * frame / 11));
    }
  }
  bool loadPagedModulation(bool allResident) {
    const auto bytes = static_cast<std::uint32_t>(kV3PagedPayload.size());
    AssetBeginInfo info{1, (bytes - 32u) / 4u, 0, 0, 1, 0, 0, 2, kV3PagedFootprint, bytes};
    CHECK(test::addSamplePlayerFixtureStorage(info, kV3PagedPayload,
                                              {static_cast<float>(sampleRate), 2, 128},
                                              ET_SAMPLE_PLAYER_MAIN) == ET_OK);
    auto *destination = kernel->beginAsset(0, info);
    CHECK(destination);
    if (!destination)
      return false;
    std::memcpy(destination, kV3PagedPayload.data(), bytes);
    const auto status = kernel->commitAsset(0, bytes, 1);
    CHECK(status == ET_OK);
    if (status != ET_OK)
      return false;
    CHECK(kernel->configureSampleStream(71) == ET_OK);
    std::array<float, 4096> page{};
    for (auto i = 0u; i < (allResident ? 4u : 1u); ++i) {
      fillModulationPage(page, i);
      CHECK(kernel->publishSamplePage(71, 0, i, page.data(), 4096, 1, 1) == ET_OK);
    }
    CHECK((kernel->assetState(0) & 255u) == ET_ASSET_STATE_ACTIVE);
    kernel->reset();
    CHECK(events({}, ET_MIDI_RESET, 2) == ET_OK);
    return true;
  }
  void configure(unsigned channel, float gain = 0, unsigned voices = 64, unsigned quality = 0,
                 bool fallback = true, int previewMidi = -1, unsigned previewChannel = 0,
                 bool strict = false) {
    generated::SoundFontPlayerPluginParams params{static_cast<float>(channel),
                                                  static_cast<float>(voices),
                                                  gain,
                                                  static_cast<float>(quality),
                                                  fallback ? 1.0F : 0.0F,
                                                  static_cast<float>(previewMidi),
                                                  static_cast<float>(previewChannel),
                                                  strict ? 1.0F : 0.0F};
    CHECK(kernel->stageParameters(reinterpret_cast<const float *>(&params),
                                  descriptor->paramsFloatCount, descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }
  et_status events(std::initializer_list<et_midi_event> events, std::uint32_t flags = 0,
                   std::uint32_t generation = 1) {
    allocation_guard::Scope guard;
    return kernel->setMidiEvents(events.begin(), static_cast<std::uint32_t>(events.size()),
                                 generation, flags);
  }
  void process(float input = 0) {
    audio.fill(input);
    allocation_guard::Scope guard;
    kernel->process(audio.data(), 2, 128, {0});
  }
  float peak() const {
    float p = 0;
    for (float s : audio)
      if (std::abs(s) > p)
        p = std::abs(s);
    return p;
  }
  void loadSf2(Controls generators = {}, bool effects = true, bool highBand = false,
               bool publishOnset = true, unsigned midiGeneration = 2,
               unsigned filterController = 128u, unsigned filterGenerator = 8u,
               float filterAmount = 1200.0F,
               std::span<const std::array<std::uint32_t, 2>> presetKeys = {}) {
    const auto bytes = static_cast<unsigned>(kSf2NativeFixture.size());
    AssetBeginInfo info{1, (bytes - 32u) / 4u, 0, 0, 1, 0, 0, 2, kSf2NativeFootprint, bytes};
    CHECK(test::addSamplePlayerFixtureStorage(info, kSf2NativeFixture,
                                              {static_cast<float>(sampleRate), 2, 128},
                                              ET_SAMPLE_PLAYER_MAIN) == ET_OK);
    auto *data = kernel->beginAsset(0, info);
    CHECK(data);
    std::memcpy(data, kSf2NativeFixture.data(), bytes);
    auto *header = reinterpret_cast<float *>(data) + 8u;
    if (!presetKeys.empty()) {
      CHECK(presetKeys.size() == std::bit_cast<unsigned>(header[17]));
      auto *presets = header + std::bit_cast<unsigned>(header[16]);
      for (auto index = 0u; index < presetKeys.size(); ++index) {
        presets[index * 4u] = std::bit_cast<float>(presetKeys[index][0]);
        presets[index * 4u + 1u] = std::bit_cast<float>(presetKeys[index][1]);
      }
    }
    auto *modulation = header + std::bit_cast<unsigned>(header[10]);
    auto *directory = modulation + std::bit_cast<unsigned>(modulation[5]);
    auto *values = modulation + std::bit_cast<unsigned>(modulation[8]);
    for (auto regionIndex = 0u; regionIndex < std::bit_cast<unsigned>(header[2]); ++regionIndex)
      for (const auto &[generator, value] : generators)
        values[std::bit_cast<unsigned>(directory[regionIndex * 4u + 2u]) + generator] = value;
    if (!effects) {
      auto *routes = modulation + std::bit_cast<unsigned>(modulation[6]);
      for (auto index = 0u; index < std::bit_cast<unsigned>(modulation[3]); ++index)
        if (const auto target = std::bit_cast<unsigned>(routes[index * 10u]);
            target == 0x1000fu || target == 0x10010u)
          routes[index * 10u + 3u] = 0;
    }
    if (filterController < 128u) {
      auto *route = modulation + std::bit_cast<unsigned>(modulation[6]);
      route[0] = std::bit_cast<float>(0x10000u | filterGenerator);
      route[1] = std::bit_cast<float>(0x80u | filterController);
      route[3] = filterAmount;
    }
    CHECK(kernel->commitAsset(0, bytes, ET_ASSET_F32_MULTICH) == ET_OK);
    CHECK(kernel->configureSampleStream(9) == ET_OK);
    std::array<float, 64> sample;
    sample.fill(.25F);
    if (highBand)
      for (unsigned frame = 0; frame < sample.size(); ++frame)
        sample[frame] = .25F * std::sin(static_cast<float>(6.283185307179586 * frame * 3 / 8));
    if (publishOnset)
      CHECK(kernel->publishSamplePage(9, 0, 0, sample.data(), 64, 1, 1) == ET_OK);
    CHECK(kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
    if (midiGeneration) {
      CHECK(events({}, ET_MIDI_RESET, midiGeneration) == ET_OK);
      CHECK(kernel->setMidiClock(0, midiGeneration, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    }
  }
};
et_midi_event event(unsigned offset, unsigned status, unsigned key, unsigned value,
                    unsigned id = 0) {
  return {offset, status | (key << 8u) | (value << 16u), id, 0, 0, 0};
}
struct ScriptMessages {
  std::vector<std::string> text;
  unsigned dropped = 0;
};
ScriptMessages readScriptMessages(PluginKernel &kernel) {
  std::array<std::uint8_t, 8192> storage{}, output{};
  TelemetryRing ring;
  ring.adopt(storage.data(), static_cast<unsigned>(storage.size()));
  std::uint32_t sequence = 0;
  TelemetryWriter writer(ring, 1, sequence);
  {
    allocation_guard::Scope guard;
    kernel.writeTelemetry(writer);
  }
  const auto bytes = ring.read(output.data(), static_cast<unsigned>(output.size()), nullptr);
  const auto read16 = [&](unsigned offset) {
    return output[offset] | static_cast<unsigned>(output[offset + 1u]) << 8u;
  };
  ScriptMessages messages;
  for (auto offset = 0u; offset < bytes;) {
    const auto size = read16(offset + 12u);
    if (read16(offset) == 33u) {
      const auto length = read16(offset + 20u);
      CHECK(size == 8u + length && length <= 127u);
      messages.text.emplace_back(reinterpret_cast<const char *>(output.data() + offset + 24u),
                                 length);
      for (auto byte = 0u; byte < 4u; ++byte)
        messages.dropped += static_cast<unsigned>(output[offset + 16u + byte]) << (8u * byte);
    }
    offset += (16u + size + 3u) & ~3u;
  }
  return messages;
}
void genericModulation() {
  const auto start = [](Player &p) {
    CHECK(p.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127, 1)}, 0, 2) == ET_OK);
  };
  {
    Player p;
    if (!p.loadCompiled(kV3BasicPayload, kV3BasicFootprint))
      return;
    start(p);
    p.process();
    p.process();
    CHECK(std::abs(p.peak() - .25F * std::pow(10.0F, -6.0F / 20)) < .00001F);
    CHECK(p.events({event(0, 0x80, 60, 0, 1)}, 0, 2) == ET_OK);
    for (auto i = 0u; i < 8u; ++i)
      p.process();
    CHECK(p.peak() == 0);
  }
  {
    Player p;
    if (!p.loadCompiled(kV3DelayedPayload, kV3DelayedFootprint))
      return;
    start(p);
    p.process();
    CHECK(p.peak() == 0);
    p.process();
    CHECK(p.audio[0] == 0 && p.audio[127] > .01F);
  }
  {
    Player p;
    if (!p.loadCompiled(kV3FlexiblePayload, kV3FlexibleFootprint))
      return;
    start(p);
    for (auto i = 0u; i < 4u; ++i)
      p.process();
    CHECK(p.peak() > .24F);
    CHECK(p.events({event(0, 0x80, 60, 0, 1)}, 0, 2) == ET_OK);
    for (auto i = 0u; i < 8u; ++i)
      p.process();
    CHECK(p.peak() == 0);
  }
  {
    Player p;
    if (!p.loadCompiled(kV3LfoPayload, kV3LfoFootprint))
      return;
    start(p);
    p.process();
    p.process();
    const auto positive = p.peak();
    for (auto i = 0u; i < 8u; ++i)
      p.process();
    CHECK(positive > .4F && p.peak() < .25F);
  }
  {
    Player p;
    if (!p.loadCompiled(kV3ControllersPayload, kV3ControllersFootprint))
      return;
    start(p);
    p.process();
    p.process();
    CHECK(std::abs(p.peak() - .25F) < .00001F);
    CHECK(p.events({event(0, 0xb0, 1, 127)}, 0, 2) == ET_OK);
    p.process();
    CHECK(p.audio[0] > .24F && p.audio[127] > .1F);
    for (auto i = 0u; i < 5u; ++i)
      p.process();
    CHECK(std::abs(p.peak() - .25F * std::pow(10.0F, -12.0F / 20)) < .00001F);
  }
  {
    Player p;
    if (!p.loadCompiled(kV3FiltersPayload, kV3FiltersFootprint))
      return;
    start(p);
    for (auto i = 0u; i < 6u; ++i)
      p.process();
    CHECK(p.peak() > .01F && p.peak() < .12F);
  }
  for (const auto bend : {0u, 8192u, 16383u}) {
    Player p;
    if (!p.loadCompiled(kV3BendSourcePayload, kV3BendSourceFootprint))
      return;
    CHECK(p.events({event(0, 0xb0, 7, 127), event(0, 0xe0, bend & 127u, bend >> 7u),
                    event(0, 0x90, 60, 127, 1)},
                   0, 2) == ET_OK);
    p.process();
    p.process();
    const auto expected = .25F * std::pow(10.0F, 12.0F * (bend / 16383.0F) / 20);
    CHECK(std::abs(p.peak() - expected) < .00001F);
  }
  {
    Player p;
    if (!p.loadCompiled(kV3OffsetSourcePayload, kV3OffsetSourceFootprint))
      return;
    start(p);
    p.process();
    p.process();
    CHECK(std::abs(p.peak() - .25F * std::pow(10.0F, 1.6F / 20)) < .00001F);
  }
}
void variableModulationAudioAndCheckpoint() {
  struct Fixture {
    std::span<const std::uint8_t> variable, control;
    std::uint32_t variableFootprint, controlFootprint;
  };
  const std::array fixtures{Fixture{kV3VariableProductPayload, kV3VariableProductControlPayload,
                                    kV3VariableProductFootprint,
                                    kV3VariableProductControlFootprint},
                            Fixture{kV3VariableAddPayload, kV3VariableAddControlPayload,
                                    kV3VariableAddFootprint, kV3VariableAddControlFootprint},
                            Fixture{kV3VariableCurvePayload, kV3VariableCurveControlPayload,
                                    kV3VariableCurveFootprint, kV3VariableCurveControlFootprint}};
  for (auto index = 0u; index < fixtures.size(); ++index) {
    const auto &fixture = fixtures[index];
    Player variable, control;
    if (!variable.loadCompiled(fixture.variable, fixture.variableFootprint) ||
        !control.loadCompiled(fixture.control, fixture.controlFootprint))
      return;
    // The independent ordinary routes express the same established response:
    // three weighted inputs multiply, omitted mode adds, and curve2 is applied
    // to the input before its variable modulates the audio target.
    for (auto *player : {&variable, &control}) {
      CHECK(player->events({event(0u, 0xb0u, 7u, 127u),
                            event(0u, 0xb0u, 84u, index == 2u ? 64u : 127u),
                            event(0u, 0xb0u, 85u, index == 1u ? 0u : 127u),
                            event(0u, 0xb0u, 86u, 127u), event(0u, 0x90u, 60u, 127u, 1u)},
                           0u, 2u) == ET_OK);
      player->process();
      player->process();
    }
    CHECK(variable.audio == control.audio);
    for (auto *player : {&variable, &control}) {
      CHECK(player->events({event(64u, 0xb0u, 84u, index == 2u ? 127u : 0u)}, 0u, 2u) == ET_OK);
      player->process();
    }
    CHECK(variable.audio == control.audio);
    CHECK(variable.audio[32] != variable.audio[96]);
    if (index == 0u) {
      // Changing either of the remaining product inputs must also invalidate
      // the held voice's derived value, rather than only the first controller.
      CHECK(variable.events({event(0u, 0xb0u, 84u, 127u), event(0u, 0xb0u, 85u, 0u)}, 0u, 2u) ==
            ET_OK);
      CHECK(control.events({event(0u, 0xb0u, 84u, 0u)}, 0u, 2u) == ET_OK);
      variable.process();
      control.process();
      CHECK(variable.audio == control.audio);
      CHECK(variable.events({event(0u, 0xb0u, 85u, 127u), event(0u, 0xb0u, 86u, 0u)}, 0u, 2u) ==
            ET_OK);
      variable.process();
      control.process();
      CHECK(variable.audio == control.audio);
      CHECK(variable.events({event(0u, 0xb0u, 86u, 127u)}, 0u, 2u) == ET_OK);
      CHECK(control.events({event(0u, 0xb0u, 84u, 127u)}, 0u, 2u) == ET_OK);
      variable.process();
      control.process();
      CHECK(variable.audio == control.audio);
    }
  }
  {
    Player dry, withFx;
    if (!dry.loadCompiled(kV3VariableProductPayload, kV3VariableProductFootprint) ||
        !withFx.loadCompiled(kV3VariableFxPayload, kV3VariableFxFootprint))
      return;
    for (auto *player : {&dry, &withFx}) {
      CHECK(player->events({event(0u, 0xb0u, 7u, 127u), event(0u, 0xb0u, 84u, 127u),
                            event(0u, 0xb0u, 85u, 127u), event(0u, 0xb0u, 86u, 127u),
                            event(0u, 0x90u, 60u, 127u, 1u)},
                           0u, 2u) == ET_OK);
      player->process();
      player->process();
      CHECK((player->kernel->assetState(0u) & 255u) == ET_ASSET_STATE_ACTIVE);
    }
    const auto gain = std::pow(10.0F, -6.0F / 20.0F);
    for (auto frame = 0u; frame < dry.audio.size(); ++frame)
      CHECK(std::abs(withFx.audio[frame] - dry.audio[frame] * gain) < .00001F);
    CHECK(withFx.peak() > .01F && withFx.peak() < dry.peak());
  }
  Player original, restored;
  if (!original.loadCompiled(kV3VariableProductPayload, kV3VariableProductFootprint) ||
      !restored.loadCompiled(kV3VariableProductPayload, kV3VariableProductFootprint))
    return;
  CHECK(original.kernel->setMidiClock(0u, 2u, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  CHECK(original.events({event(0u, 0xb0u, 7u, 127u), event(0u, 0xb0u, 84u, 64u),
                         event(0u, 0xb0u, 85u, 127u), event(0u, 0xb0u, 86u, 127u),
                         event(0u, 0x90u, 60u, 127u, 1u)},
                        0u, 2u) == ET_OK);
  original.process();
  original.process();
  const auto expected = .25F * std::pow(10.0F, -6.0F * (64.0F / 127.0F) / 20.0F);
  CHECK(std::abs(original.peak() - expected) < .00001F);
  CHECK(original.events({}, ET_MIDI_PAUSE, 3u) == ET_OK);
  std::vector<std::uint8_t> snapshot(original.kernel->midiCheckpointSize());
  CHECK(!snapshot.empty());
  {
    allocation_guard::Scope guard;
    CHECK(original.kernel->writeMidiCheckpoint(snapshot.data(),
                                               static_cast<unsigned>(snapshot.size())) == ET_OK);
    CHECK(restored.kernel->readMidiCheckpoint(snapshot.data(),
                                              static_cast<unsigned>(snapshot.size())) == ET_OK);
  }
  const auto clock = static_cast<unsigned>(original.kernel->midiClock());
  for (auto *player : {&original, &restored}) {
    CHECK(player->events({}, ET_MIDI_RESUME, 4u) == ET_OK);
    CHECK(player->events({{0u, 0u, 0u, ET_MIDI_RESUME, clock, 0u}}, 0u, 4u) == ET_OK);
    player->process();
  }
  CHECK(original.audio == restored.audio);
  // The normal reattack fade finishes before the next held-value/CC boundary.
  for (auto *player : {&original, &restored}) {
    CHECK(player->events({event(64u, 0xb0u, 86u, 0u)}, 0u, 4u) == ET_OK);
    player->process();
  }
  CHECK(original.audio == restored.audio);
  CHECK(std::abs(restored.audio[32] - expected) < .00001F);
  CHECK(original.audio[32] != original.audio[96]);
  CHECK(std::abs(restored.peak() - .25F) < .00001F);
  CHECK(original.kernel->midiClock() == restored.kernel->midiClock());
}
void genericModulationRetryAndCheckpoint() {
  Player reference, paged;
  if (!reference.loadPagedModulation(true) || !paged.loadPagedModulation(false))
    return;
  for (auto *player : {&reference, &paged}) {
    CHECK(player->kernel->setMidiClock(0, 2, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    CHECK(player->events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127, 1)}, 0, 2) == ET_OK);
  }
  unsigned retries = 0;
  std::array<float, 4096> page{};
  for (auto block = 0u; block < 160u; ++block) {
    const ProcessInfo info{block * 128.0 / 48000};
    reference.audio.fill(0);
    {
      allocation_guard::Scope guard;
      CHECK(reference.kernel->processOffline(reference.audio.data(), 2, 128, info) == ET_OK);
    }
    const auto clock = paged.kernel->midiClock();
    bool complete = false;
    for (auto attempt = 0u; attempt < 8u; ++attempt) {
      paged.audio.fill(0);
      et_status result;
      {
        allocation_guard::Scope guard;
        result = paged.kernel->processOffline(paged.audio.data(), 2, 128, info);
      }
      if (result == ET_OK) {
        complete = true;
        break;
      }
      CHECK(result == ET_NEED_SAMPLE);
      CHECK(paged.kernel->midiClock() == clock);
      ++retries;
      std::array<et_sfz_sample_request, 8> requests{};
      unsigned count = 0;
      CHECK(paged.kernel->takeSampleRequests(
                requests.data(), static_cast<unsigned>(requests.size()), count) == ET_OK);
      CHECK(count > 0);
      for (auto i = 0u; i < count; ++i) {
        const auto &request = requests[i];
        CHECK(request.generation_low == 71 && request.sample == 0 && request.page_high == 0);
        Player::fillModulationPage(page, request.page_low);
        allocation_guard::Scope guard;
        CHECK(paged.kernel->publishSamplePage(71, 0, request.page_low, page.data(), 4096, 1, 0) ==
              ET_OK);
      }
    }
    CHECK(complete);
    CHECK(paged.audio == reference.audio);
  }
  CHECK(retries >= 3u);
  Player source;
  if (!source.loadCompiled(kV3LfoPayload, kV3LfoFootprint))
    return;
  CHECK(source.kernel->setMidiClock(0, 2, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  CHECK(source.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127, 1)}, 0, 2) == ET_OK);
  for (auto i = 0u; i < 7u; ++i)
    source.process();
  CHECK(source.events({}, ET_MIDI_PAUSE, 3) == ET_OK);
  std::vector<std::uint8_t> snapshot(source.kernel->midiCheckpointSize());
  CHECK(!snapshot.empty());
  {
    allocation_guard::Scope guard;
    CHECK(source.kernel->writeMidiCheckpoint(snapshot.data(),
                                             static_cast<unsigned>(snapshot.size())) == ET_OK);
  }
  for (const auto rate : {48000u, 96000u}) {
    Player restored({region()}, false, false, {}, false, {}, rate);
    if (!restored.loadCompiled(kV3LfoPayload, kV3LfoFootprint))
      return;
    {
      allocation_guard::Scope guard;
      CHECK(restored.kernel->readMidiCheckpoint(snapshot.data(),
                                                static_cast<unsigned>(snapshot.size())) == ET_OK);
    }
    const auto clock = restored.kernel->midiClock();
    CHECK(restored.events({}, ET_MIDI_RESUME, 4) == ET_OK);
    CHECK(restored.events({{7, 0, 0, ET_MIDI_RESUME, static_cast<unsigned>(clock), 0}}, 0, 4) ==
          ET_OK);
    restored.process();
    for (auto frame = 0u; frame < 7u; ++frame)
      CHECK(restored.audio[frame] == 0);
    CHECK(restored.peak() > .1F);
  }
}
void genericPitchAndScope() {
  const auto start = [](Player &player, bool bent = false) {
    CHECK(player.events({event(0, 0xb0, 7, 127), event(0, 0xe0, bent ? 127 : 0, bent ? 127 : 64),
                         event(0, 0x90, 60, 127, 1)},
                        0, 2) == ET_OK);
    player.process();
    player.process();
  };
  Player gain;
  if (!gain.loadCompiled(kV3ScopePayload, kV3ScopeFootprint))
    return;
  start(gain);
  CHECK(std::abs(gain.peak() - .25F * .2F * std::pow(10.0F, -6.0F / 20)) < .00001F);
  auto tunedRegion = region();
  tunedRegion[Tune] = 1200;
  Player reference({tunedRegion}, false, false, {}, true), scoped;
  if (!scoped.loadCompiled(kV3ScopePitchPayload, kV3ScopePitchFootprint))
    return;
  CHECK(reference.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127, 1)}) == ET_OK);
  reference.process();
  reference.process();
  start(scoped);
  for (auto i = 0u; i < scoped.audio.size(); ++i)
    CHECK(std::abs(scoped.audio[i] - reference.audio[i]) < .0001F);
  auto immediate = std::vector<std::uint8_t>(kV3BendPayload.begin(), kV3BendPayload.end());
  const auto u32 = [&](std::size_t at) {
    return static_cast<std::uint32_t>(immediate[at]) |
           static_cast<std::uint32_t>(immediate[at + 1]) << 8u |
           static_cast<std::uint32_t>(immediate[at + 2]) << 16u |
           static_cast<std::uint32_t>(immediate[at + 3]) << 24u;
  };
  const auto modulation = 32u + u32(32u + 10u * 4u) * 4u;
  const auto parameters = modulation + u32(modulation + 10u * 4u) * 4u;
  for (auto p = 0u; p < u32(modulation + 11u * 4u); ++p)
    if (u32(parameters + p * 16u + 4u) == static_cast<std::uint32_t>(schema::Property::BendSmooth))
      binary_io::writeF32(immediate.data() + parameters + p * 16u + 8u, 0);
  for (const auto bornBent : {false, true}) {
    Player smooth, snap;
    if (!smooth.loadCompiled(kV3BendPayload, kV3BendFootprint) ||
        !snap.loadCompiled(immediate, kV3BendFootprint))
      return;
    start(smooth, bornBent);
    start(snap, bornBent);
    CHECK(smooth.audio == snap.audio); // Birth starts at the current bend without a ramp.
    if (!bornBent) {
      CHECK(smooth.events({event(0, 0xe0, 127, 127)}, 0, 2) == ET_OK);
      CHECK(snap.events({event(0, 0xe0, 127, 127)}, 0, 2) == ET_OK);
      smooth.process();
      snap.process();
      CHECK(smooth.audio != snap.audio);
      const auto unchanged = .25F * std::sin(6.283185307179586F / 32.0F);
      CHECK(std::abs(smooth.audio[1] - unchanged) < std::abs(snap.audio[1] - unchanged));
    }
  }
  Player precise;
  if (!precise.loadCompiled(kV3InitialPayload, kV3InitialFootprint))
    return;
  start(precise);
  CHECK(std::abs(precise.peak() - .25F * std::pow(10.0F, -.5001F)) < .000001F);
  CHECK(precise.events({}, ET_MIDI_PAUSE, 3) == ET_OK);
  std::vector<std::uint8_t> checkpoint(precise.kernel->midiCheckpointSize());
  CHECK(precise.kernel->writeMidiCheckpoint(checkpoint.data(),
                                            static_cast<unsigned>(checkpoint.size())) == ET_OK);
  Player resumed;
  if (!resumed.loadCompiled(kV3InitialPayload, kV3InitialFootprint))
    return;
  CHECK(resumed.kernel->readMidiCheckpoint(checkpoint.data(),
                                           static_cast<unsigned>(checkpoint.size())) == ET_OK);
  CHECK(resumed.events({}, ET_MIDI_RESUME, 4) == ET_OK);
  const auto clock = resumed.kernel->midiClock();
  CHECK(resumed.events({{0, 0, 0, ET_MIDI_RESUME, static_cast<unsigned>(clock), 0}}, 0, 4) ==
        ET_OK);
  resumed.process();
  resumed.process();
  CHECK(std::abs(resumed.peak() - .25F * std::pow(10.0F, -.5001F)) < .000001F);
  CHECK(resumed.events({event(0, 0xb0, 1, 64)}, 0, 4) == ET_OK);
  resumed.process();
  CHECK(std::abs(resumed.peak() - .25F * std::pow(10.0F, -64.0F / 127)) < .000001F);
}
void genericSourceAndKeyOffsets() {
  Player shifted;
  if (!shifted.loadCompiled(kV3KeyOffsetsPayload, kV3KeyOffsetsFootprint))
    return;
  CHECK(shifted.events(
            {event(0, 0xb0, 7, 127), event(0, 0x90, 22, 127, 1), event(0, 0x90, 48, 127, 2)}, 0,
            2) == ET_OK);
  shifted.process();
  shifted.process();
  CHECK(shifted.peak() > .24F);
  CHECK(shifted.events({event(0, 0x80, 48, 0, 2)}, 0, 2) == ET_OK);
  for (auto i = 0u; i < 3u; ++i)
    shifted.process();
  CHECK(shifted.peak() == 0);
  Player oscillator;
  if (!oscillator.loadCompiled(kV3OscillatorPayload, kV3OscillatorFootprint))
    return;
  CHECK(oscillator.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127, 1)}, 0, 2) == ET_OK);
  oscillator.process();
  oscillator.process();
  CHECK(oscillator.peak() > .20F && oscillator.peak() < .26F);
  CHECK(oscillator.events({event(0, 0xb0, 64, 127), event(0, 0xb0, 120, 0)}, 0, 2) == ET_OK);
  for (auto i = 0u; i < 8u; ++i)
    oscillator.process();
  CHECK(oscillator.peak() == 0);
  CHECK(oscillator.events({event(0, 0x90, 60, 127, 2)}, 0, 2) == ET_OK);
  oscillator.process();
  oscillator.process();
  CHECK(oscillator.peak() > .20F);
}
void forcedVoiceLifetimes() {
  for (const auto typed : {false, true}) {
    for (const auto normal : {false, true}) {
      Player player;
      if (typed) {
        if (!(normal ? player.loadCompiled(kV3ChokeNormalPayload, kV3ChokeNormalFootprint)
                     : player.loadCompiled(kV3ChokeFastPayload, kV3ChokeFastFootprint)))
          return;
      } else {
        auto sounding = region(), silent = region();
        sounding[LowKey] = sounding[HighKey] = 60;
        sounding[OffBy] = 1;
        sounding[OffMode] = normal ? 1.0F : 0.0F;
        sounding[OffTime] = sounding[Release] = .01F;
        silent[LowKey] = silent[HighKey] = 61;
        silent[Group] = 1;
        silent[Volume] = -144;
        silent[Frames] = 64;
        silent[End] = silent[LoopEnd] = 63;
        silent[LoopMode] = 0;
        Bank bank({sounding, silent});
        CHECK(player.loadCompiled({reinterpret_cast<const std::uint8_t *>(bank.words.data()),
                                   bank.words.size() * sizeof(float)},
                                  bank.footprint));
      }
      CHECK(player.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127, 1)}, 0, 2) == ET_OK);
      player.process();
      player.process();
      CHECK(player.peak() > .24F);
      CHECK(player.events({event(0, 0x90, 61, 127, 2)}, 0, 2) == ET_OK);
      for (auto block = 0; block < 8; ++block) {
        if (block)
          CHECK(player.events({event(0, 0x90, 61, 127, 2u + block)}, 0, 2) == ET_OK);
        player.process();
      }
      CHECK(player.peak() < .00001F);
      CHECK(!(player.kernel->midiState() & ET_MIDI_STATE_VOICES));
      CHECK(player.events({event(0, 0x80, 60, 0, 1)}, 0, 2) == ET_OK);
      player.process();
      CHECK(player.peak() < .00001F);
      CHECK(player.events({event(0, 0x90, 60, 127, 3)}, 0, 2) == ET_OK);
      player.process();
      player.process();
      CHECK(player.peak() > .24F);
    }
    for (const auto sameNote : {false, true}) {
      Player player;
      if (typed) {
        if (!(sameNote
                  ? player.loadCompiled(kV3NotePolyphonyOneShotPayload,
                                        kV3NotePolyphonyOneShotFootprint)
                  : player.loadCompiled(kV3PolyphonyOneShotPayload, kV3PolyphonyOneShotFootprint)))
          return;
      } else {
        auto sample = region();
        sample[LoopMode] = 1;
        sample[Release] = .001F;
        sample[sameNote ? NotePolyphony : Polyphony] = 1;
        Bank bank({sample});
        CHECK(player.loadCompiled({reinterpret_cast<const std::uint8_t *>(bank.words.data()),
                                   bank.words.size() * sizeof(float)},
                                  bank.footprint));
      }
      CHECK(player.events({event(0, 0xb0, 7, 127), event(0, 0xb1, 7, 127),
                           event(0, 0x91, 60, 127, 3), event(0, 0x90, 60, 127, 1)},
                          0, 2) == ET_OK);
      player.process();
      CHECK(player.events({event(0, 0x90, sameNote ? 60 : 61, 127, 2)}, 0, 2) == ET_OK);
      for (auto block = 0; block < 3; ++block)
        player.process();
      CHECK(std::abs(player.peak() - .5F) < .00001F);
      CHECK(player.events({event(0, 0x80, sameNote ? 60 : 61, 0, 2)}, 0, 2) == ET_OK);
      player.process();
      CHECK(player.peak() >
            .49F); // Ordinary key release cannot stop a one-shot or another channel.
    }
  }
}
void channelStateHydration() {
  auto r = region();
  r[LowProgram] = r[HighProgram] = 3;
  r[LowPolyAftertouch] = r[HighPolyAftertouch] = 90;
  Player scripted({r}, false, false, {}, false, kScriptHydrationFixture);
  CHECK(scripted.events({}, ET_MIDI_RETIME, 17) == ET_OK);
  CHECK(
      scripted.events({event(0, 0x90, 60, 127, 90), event(0, 0xb0, 1, 99),   event(0, 0xd0, 45, 0),
                       event(0, 0xe0, 0, 0),        event(0, 0xb0, 121, 0),  event(0, 0xb0, 1, 127),
                       event(0, 0xb0, 64, 127),     event(0, 0xb0, 66, 127), event(0, 0xb0, 120, 0),
                       event(0, 0xb0, 123, 0),      event(0, 0xb0, 101, 0),  event(0, 0xb0, 100, 0),
                       event(0, 0xb0, 6, 12),       event(0, 0xb0, 99, 2),   event(0, 0xb0, 98, 3),
                       event(0, 0xb0, 6, 2),        event(0, 0xb0, 38, 17),  event(0, 0xd0, 73, 0),
                       event(0, 0xe0, 0, 0),        event(0, 0xa0, 60, 90),  event(0, 0xc0, 3, 0),
                       event(0, 0x80, 61, 0)},
                      ET_MIDI_HYDRATE_CHANNEL_STATE, 17) == ET_OK);
  CHECK(scripted.kernel->midiClock() == 0 && scripted.kernel->midiState() == 0);
  scripted.process();
  CHECK(scripted.peak() == 0 && scripted.kernel->midiClock() == 0);
  CHECK(readScriptMessages(*scripted.kernel).text.empty());
  CHECK(scripted.events({}, ET_MIDI_HYDRATE_CHANNEL_STATE | ET_MIDI_RESET, 17) == ET_ERR_ARGS);
  CHECK(scripted.events({}, ET_MIDI_HYDRATE_CHANNEL_STATE, 16) == ET_ERR_STATE);
  CHECK(scripted.events({{0, 0, 0, ET_MIDI_RESUME, 0, 0}}, ET_MIDI_HYDRATE_CHANNEL_STATE, 17) ==
        ET_ERR_ARGS);
  CHECK(scripted.events({{0, 0, 0, ET_MIDI_RESUME, 0, 0}}, 0, 17) == ET_OK);
  scripted.process();
  CHECK(scripted.peak() > .1F);
  const auto messages = readScriptMessages(*scripted.kernel);
  CHECK(messages.dropped == 0);
  CHECK(messages.text ==
        std::vector<std::string>({"127", "73", "-8192", "0", "3", "2", "127", "127"}));
  const auto clock = scripted.kernel->midiClock();
  const auto state = scripted.kernel->midiState();
  CHECK(scripted.events({event(0, 0xb0, 120, 0), event(0, 0xb0, 123, 0), event(0, 0xb0, 121, 0)},
                        ET_MIDI_HYDRATE_CHANNEL_STATE, 17) == ET_OK);
  CHECK(scripted.kernel->midiClock() == clock && scripted.kernel->midiState() == state);
  scripted.process();
  CHECK(scripted.audio[127] > .1F);
  CHECK(readScriptMessages(*scripted.kernel).text.empty());

  Player expected({region()}, false, false, {}, true);
  Player live({region()}, false, false, {}, true), hydrated({region()}, false, false, {}, true);
  const std::array transaction{
      event(0, 0xb0, 101, 0), event(0, 0xb0, 100, 0), event(0, 0xb0, 6, 12),
      event(0, 0xb0, 38, 50), event(0, 0xb0, 99, 2),  event(0, 0xb0, 98, 3),
      event(0, 0xb0, 6, 2),   event(0, 0xb0, 38, 17), event(0, 0xe0, 0, 0)};
  CHECK(expected.events({transaction[0], transaction[1], transaction[2], transaction[3],
                         transaction.back(), event(0, 0x90, 60, 127, 1)}) == ET_OK);
  {
    allocation_guard::Scope guard;
    CHECK(live.kernel->setMidiEvents(transaction.data(), static_cast<unsigned>(transaction.size()),
                                     1, 0) == ET_OK);
  }
  live.process();
  CHECK(live.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  CHECK(hydrated.events({}, ET_MIDI_RETIME, 17) == ET_OK);
  {
    allocation_guard::Scope guard;
    CHECK(hydrated.kernel->setMidiEvents(transaction.data(),
                                         static_cast<unsigned>(transaction.size()), 17,
                                         ET_MIDI_HYDRATE_CHANNEL_STATE) == ET_OK);
  }
  CHECK(hydrated.events({{0, 0, 0, ET_MIDI_RESUME, 0, 0}, event(0, 0x90, 60, 127, 1)}, 0, 17) ==
        ET_OK);
  expected.process();
  live.process();
  hydrated.process();
  CHECK(live.audio == expected.audio && hydrated.audio == expected.audio);

  Player collection, reference;
  collection.loadSf2({}, false);
  reference.loadSf2({}, false);
  CHECK(collection.events({}, ET_MIDI_RETIME, 17) == ET_OK);
  std::vector<et_midi_event> channels, notes;
  for (auto channel = 0u; channel < 16u; ++channel) {
    channels.push_back(event(0, 0xb0u | channel, 0, channel == 2u ? 1 : 0));
    channels.push_back(event(0, 0xc0u | channel,
                             channel == 2u   ? 2
                             : channel == 9u ? 0
                                             : channel & 1u,
                             0));
    notes.push_back(event(0, 0x90u | channel, 72, 127, channel + 1u));
  }
  {
    allocation_guard::Scope guard;
    CHECK(collection.kernel->setMidiEvents(channels.data(), static_cast<unsigned>(channels.size()),
                                           17, ET_MIDI_HYDRATE_CHANNEL_STATE) == ET_OK);
    CHECK(reference.kernel->setMidiEvents(channels.data(), static_cast<unsigned>(channels.size()),
                                          2, 0) == ET_OK);
  }
  reference.process();
  {
    allocation_guard::Scope guard;
    CHECK(reference.kernel->setMidiEvents(notes.data(), static_cast<unsigned>(notes.size()), 2,
                                          0) == ET_OK);
  }
  notes.insert(notes.begin(), {0, 0, 0, ET_MIDI_RESUME, 0, 0});
  {
    allocation_guard::Scope guard;
    CHECK(collection.kernel->setMidiEvents(notes.data(), static_cast<unsigned>(notes.size()), 17,
                                           0) == ET_OK);
  }
  reference.process();
  collection.process();
  CHECK(collection.audio == reference.audio);
}
void timingAndUnity() {
  Player p;
  p.process(.125F);
  for (auto sample : p.audio)
    CHECK(sample == .125F);
  CHECK(p.events({event(17, 0x90, 60, 127, 1)}) == ET_OK);
  p.process(.125F);
  for (auto i = 0u; i <= 17u; ++i)
    CHECK(p.audio[i] == .125F && p.audio[128 + i] == .125F);
  CHECK(p.audio[120] > .125F);
  CHECK(p.kernel->setMidiGain(0) == ET_OK);
  p.process(.125F);
  for (auto sample : p.audio)
    CHECK(sample == .125F);
  CHECK(p.events({event(0, 0x90, 60, 127)}, 0, 2) == ET_ERR_STATE);
  CHECK(p.events({event(128, 0x80, 60, 0)}) == ET_ERR_ARGS);
  CHECK(p.events({{0, 0x808080u, 0, 0, 0, 0}}) == ET_ERR_ARGS);
  CHECK(p.events({}, ET_MIDI_RESET, 2) == ET_OK);
  CHECK(p.events({event(0, 0x90, 60, 127)}, 0, 1) == ET_ERR_STATE);
}
void independentNotesAndPedals() {
  Player p;
  CHECK(p.events({event(0, 0x90, 60, 127, 1), event(1, 0x90, 60, 127, 2)}) == ET_OK);
  p.process();
  p.process();
  const auto two = p.peak();
  CHECK(p.events({event(0, 0x80, 60, 0, 1)}) == ET_OK);
  for (int n = 0; n < 6; ++n)
    p.process();
  const auto one = p.peak();
  CHECK(one > 0 && one < two * .6F);
  CHECK(p.events({event(0, 0xb0, 64, 127), event(1, 0x80, 60, 0, 2)}) == ET_OK);
  for (int n = 0; n < 6; ++n)
    p.process();
  CHECK(p.peak() > 0);
  CHECK(p.events({event(0, 0xb0, 64, 0)}) == ET_OK);
  for (int n = 0; n < 6; ++n)
    p.process();
  CHECK(p.peak() == 0);
}
void dynamicAndRestore() {
  auto r = region();
  r[LowKey] = r[HighKey] = 60;
  r[SwitchLow] = r[SwitchHigh] = 24;
  r[SwitchLast] = 24;
  Player p({r}, false, true);
  CHECK(p.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  p.process();
  CHECK(p.peak() == 0);
  CHECK(p.events({}, ET_MIDI_RESET, 2) == ET_OK);
  CHECK(p.events({event(0, 0x90, 24, 100), event(0, 0x80, 24, 0), event(0, 0xb0, 1, 100),
                  event(0, 0x90, 60, 127, 42)},
                 ET_MIDI_STATE_ONLY, 2) == ET_OK);
  p.process();
  CHECK(p.peak() == 0);
  CHECK(p.events({}, ET_MIDI_REATTACK, 2) == ET_OK);
  p.process();
  p.process();
  CHECK(p.peak() > 0);
  CHECK(p.events({event(0, 0x80, 60, 0, 42)}, 0, 2) == ET_OK);
  for (int n = 0; n < 6; ++n)
    p.process();
  CHECK(p.peak() == 0);
}
void releaseRegions() {
  auto attack = region();
  attack[Volume] = -144;
  auto release = region();
  release[Trigger] = 1;
  release[LoopMode] = 0;
  Player p({attack, release});
  CHECK(p.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  p.process();
  CHECK(p.peak() < .000001F);
  CHECK(p.events({event(13, 0x80, 60, 10, 1)}) == ET_OK);
  p.process();
  CHECK(p.peak() > .01F);
}
void sampleAndModulation() {
  auto forward = region();
  forward[LoopMode] = 0;
  auto reverse = forward;
  reverse[Direction] = 1;
  Player a({forward}, true), b({reverse}, true);
  CHECK(a.events({event(0, 0x90, 60, 127)}) == ET_OK);
  CHECK(b.events({event(0, 0x90, 60, 127)}) == ET_OK);
  a.process();
  b.process();
  CHECK(b.audio[120] > a.audio[120] * 2.0F);
  auto finite = region();
  finite[End] = finite[LoopEnd] = 31;
  finite[LoopCount] = 0;
  Player c({finite});
  CHECK(c.events({event(0, 0x90, 60, 127)}) == ET_OK);
  c.process();
  c.process();
  CHECK(c.peak() == 0);
  finite[LoopCount] = -1;
  Player d({finite});
  CHECK(d.events({event(0, 0x90, 60, 127)}) == ET_OK);
  d.process();
  d.process();
  CHECK(d.peak() > 0);
  auto tremolo = region();
  tremolo[AmpLFOFrequency] = 100;
  tremolo[AmpLFODepth] = 6;
  Player e, f({tremolo});
  CHECK(e.events({event(0, 0x90, 60, 127)}) == ET_OK);
  CHECK(f.events({event(0, 0x90, 60, 127)}) == ET_OK);
  e.process();
  f.process();
  e.process();
  f.process();
  CHECK(std::abs(e.audio[72] - f.audio[72]) > .01F);
  auto lowpass = region();
  lowpass[FilterType] = 2;
  lowpass[Cutoff] = 20;
  Player g({lowpass});
  CHECK(g.events({event(0, 0x90, 60, 127)}) == ET_OK);
  g.process();
  CHECK(g.peak() < e.peak() * .1F);
}
void historyReattackBoundary() {
  auto oneShot = region();
  oneShot[LoopMode] = 1;
  oneShot[End] = 479;
  oneShot[LoopEnd] = 479;
  Player released({oneShot});
  CHECK(released.events({event(0, 0x90, 60, 127, 1), event(0, 0x80, 60, 0)}, ET_MIDI_STATE_ONLY) ==
        ET_OK);
  CHECK(released.events({}, ET_MIDI_REATTACK) == ET_OK);
  released.process();
  CHECK(released.peak() == 0);
  auto releaseTrigger = oneShot;
  releaseTrigger[Trigger] = 1;
  Player tail({releaseTrigger});
  CHECK(tail.events({event(0, 0x90, 60, 127, 1), event(0, 0x80, 60, 0)}, ET_MIDI_STATE_ONLY) ==
        ET_OK);
  CHECK(tail.events({}, ET_MIDI_REATTACK) == ET_OK);
  tail.process();
  CHECK(tail.peak() == 0);
  // The planned seek rule deliberately reattacks a MIDI key that remains held.
  Player held({oneShot});
  CHECK(held.events({event(0, 0x90, 60, 127, 1)}, ET_MIDI_STATE_ONLY) == ET_OK);
  CHECK(held.events({{17u, 0u, 0u, ET_MIDI_REATTACK, 0u, 0u}}) == ET_OK);
  held.process();
  for (auto frame = 0u; frame <= 17u; ++frame)
    CHECK(held.audio[frame] == 0);
  CHECK(held.audio[120] > .01F);
}
void naturalOneShotTail() {
  auto r = region();
  r[LoopMode] = 1;
  Player p({r});
  CHECK(p.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  p.process();
  CHECK(p.events({event(0, 0xb0, 64, 0), event(0, 0xb0, 66, 0), event(0, 0xb0, 123, 0)}) == ET_OK);
  p.process();
  CHECK(p.events({}, ET_MIDI_RESET | ET_MIDI_PRESERVE_RELEASE, 2) == ET_OK);
  p.process();
  CHECK(p.peak() > .01F);
  CHECK(p.events({}, ET_MIDI_RESET, 3) == ET_OK);
  p.process();
  p.process();
  CHECK(p.peak() == 0);
}
void naturalReleaseLoopTail() {
  for (const auto trigger : {1.0F, 2.0F})
    for (const auto sustain : {false, true}) {
      auto r = region();
      r[Trigger] = trigger;
      r[LoopCount] = 2;
      r[Release] = 1;
      Player player({r});
      CHECK(player.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
      player.process();
      CHECK(player.peak() == 0);
      CHECK(player.events({event(0, 0xb0, 64, sustain ? 127 : 0),
                           event(7, 0x80, 60, 0),
                           {7, 0, 0, ET_MIDI_NATURAL_END, 135, 0}}) == ET_OK);
      player.process();
      CHECK(player.peak() > .1F);
      for (auto block = 0; block < 22; ++block) {
        const auto clock = player.kernel->midiClock();
        CHECK(player.events({}, ET_MIDI_NATURAL_END) == ET_OK);
        player.process();
        CHECK(player.kernel->midiClock() == clock + 128u);
      }
      CHECK(player.peak() > .1F);
      for (auto block = 0; block < 4; ++block)
        player.process();
      CHECK(player.peak() == 0);
      CHECK((player.kernel->midiState() & ET_MIDI_STATE_VOICES) == 0);
    }
  auto r = region();
  Player held({r});
  CHECK(held.events({event(0, 0xb0, 64, 127), event(0, 0x90, 60, 127, 1),
                     event(1, 0xb0, 66, 127)}) == ET_OK);
  held.process();
  CHECK(held.events({event(7, 0x80, 60, 0), {7, 0, 0, ET_MIDI_NATURAL_END, 135, 0}}) == ET_OK);
  for (auto block = 0; block < 8; ++block)
    held.process();
  CHECK(held.peak() == 0);
  Player pending({region()}, false, false, {}, false, kScriptPendingFixture);
  CHECK(pending.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  CHECK(pending.events({event(0, 0x90, 60, 127, 1), {7, 0, 0, ET_MIDI_NATURAL_END, 7, 0}}) ==
        ET_OK);
  for (auto block = 0; block < 8; ++block)
    pending.process();
  CHECK(pending.peak() == 0);
  CHECK((pending.kernel->midiState() & ET_MIDI_STATE_CALLBACKS) != 0);
  auto generated = 0.0F;
  for (auto block = 0; block < 400; ++block) {
    CHECK(pending.events({}, ET_MIDI_NATURAL_END) == ET_OK);
    pending.process();
    generated = std::max(generated, pending.peak());
  }
  CHECK(generated > .01F);
  CHECK((pending.kernel->midiState() &
         (ET_MIDI_STATE_CALLBACKS | ET_MIDI_STATE_GENERATED | ET_MIDI_STATE_VOICES)) == 0);
}
void sourceVoiceOwnership() {
  for (auto kind = 0u; kind < 3u; ++kind)
    for (auto mode = 0u; mode < 6u; ++mode) {
      auto r = region();
      r[Trigger] = kind == 2u ? 0.0F : static_cast<float>(kind + 1u);
      r[LoopMode] = mode < 2u ? static_cast<float>(mode) : 2.0F;
      r[LoopCount] = mode == 2u ? 2.0F : -1.0F;
      r[Release] = 1;
      if (mode == 4u)
        r[Delay] = .01F;
      if (mode == 5u)
        r[AmpDelay] = .01F;
      Controls controls;
      if (kind == 2u)
        controls = {{OnLowCC * 512u + 1u, 1.0F}, {OnHighCC * 512u + 1u, 127.0F}};
      Player player({r}, false, false, controls);
      CHECK(player.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
      player.process();
      CHECK(player.events(
                {event(7, kind == 2u ? 0xb0 : 0x80, kind == 2u ? 1 : 60, kind == 2u ? 127 : 0),
                 {7, 0, 0, ET_MIDI_NATURAL_END, 135, 0}}) == ET_OK);
      player.process();
      if (mode < 4u)
        CHECK(player.peak() > .1F);
      const auto naturalLevel = player.peak();
      CHECK(player.events({event(0, 0xb0, 64, 0), event(0, 0xb0, 66, 0), event(0, 0xb0, 121, 0),
                           event(0, 0xb0, 123, 0)}) == ET_OK);
      player.process();
      if (mode < 4u)
        CHECK(player.peak() == naturalLevel);
      CHECK(player.events({}, ET_MIDI_RESET | ET_MIDI_PRESERVE_RELEASE, 2) == ET_OK);
      for (auto block = 0; block < 4; ++block) {
        player.process();
        if (mode >= 4u)
          CHECK(player.peak() == 0);
      }
      CHECK(mode < 3u ? player.peak() > .1F : player.peak() == 0);
      for (auto block = 0; block < 32; ++block)
        player.process();
      CHECK(player.peak() == 0);
      CHECK((player.kernel->midiState() & ET_MIDI_STATE_VOICES) == 0);
    }
  Player held;
  CHECK(held.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  held.process();
  CHECK(held.events({}, ET_MIDI_RESET | ET_MIDI_PRESERVE_RELEASE, 2) == ET_OK);
  for (auto block = 0; block < 4; ++block)
    held.process();
  CHECK(held.peak() == 0);

  auto r = region();
  r[LoopMode] = 1;
  Player controller({r}, false, false,
                    {{OnLowCC * 512u + 1u, 1.0F}, {OnHighCC * 512u + 1u, 127.0F}});
  CHECK(controller.events({event(0, 0xb0, 64, 127), event(0, 0xb0, 1, 127)}) == ET_OK);
  controller.process();
  CHECK(controller.peak() > .1F);
  CHECK(controller.events({}, ET_MIDI_PAUSE, 2) == ET_OK);
  for (auto block = 0; block < 4; ++block)
    controller.process();
  CHECK(controller.events({}, ET_MIDI_RESUME, 3) == ET_OK);
  CHECK(controller.events({{0, 0, 0, ET_MIDI_RESUME, 128, 0}}, 0, 3) == ET_OK);
  controller.process();
  CHECK(controller.peak() == 0);
}
void selectedChannelAndHeldHistory() {
  auto first = region(), second = first;
  first[SequenceLength] = second[SequenceLength] = 2;
  first[SequencePosition] = 1;
  second[SequencePosition] = 2;
  first[AmpRandom] = second[AmpRandom] = 6;
  second[Volume] = -144;
  Player selected({first, second}), reference({first, second});
  for (auto *player : {&selected, &reference})
    player->configure(2);
  CHECK(selected.events({event(0, 0x90, 60, 127, 1), event(1, 0x91, 60, 127, 2)}) == ET_OK);
  CHECK(reference.events({event(1, 0x91, 60, 127, 2)}) == ET_OK);
  selected.process();
  reference.process();
  CHECK(selected.audio == reference.audio);
  selected.process();
  reference.process();
  CHECK(selected.peak() > .01F);
  CHECK(selected.audio == reference.audio);
  for (auto *player : {&selected, &reference})
    CHECK(player->events({}, ET_MIDI_RESET, 2) == ET_OK);
  CHECK(selected.events({event(0, 0x90, 60, 127, 1), event(0, 0x80, 60, 0, 1),
                         event(0, 0xb0, 1, 127), event(0, 0x91, 60, 127, 2)},
                        ET_MIDI_STATE_ONLY, 2) == ET_OK);
  CHECK(reference.events({event(0, 0x91, 60, 127, 2)}, ET_MIDI_STATE_ONLY, 2) == ET_OK);
  for (auto *player : {&selected, &reference}) {
    CHECK(player->events({}, ET_MIDI_REATTACK, 2) == ET_OK);
    player->process();
    player->process();
  }
  CHECK(selected.peak() > .01F);
  CHECK(selected.audio == reference.audio);

  auto held = region(), release = region();
  held[LowKey] = held[HighKey] = 60;
  release[LowKey] = release[HighKey] = 61;
  release[Trigger] = 2;
  release[LoopMode] = 1;
  Player p({held, release});
  std::vector<et_midi_event> history{event(0, 0x90, 60, 127, 1), event(0, 0x90, 60, 127, 2),
                                     event(0, 0xb0, 64, 127), event(0, 0x80, 60, 0, 1)};
  for (auto n = 0u; n < 80u; ++n) {
    history.push_back(event(0, 0x90, 61, 127, 3 + n));
    history.push_back(event(0, 0x80, 61, 0, 3 + n));
  }
  CHECK(p.kernel->setMidiEvents(history.data(), static_cast<unsigned>(history.size()), 1,
                                ET_MIDI_STATE_ONLY) == ET_OK);
  CHECK(p.events({}, ET_MIDI_REATTACK) == ET_OK);
  p.process();
  p.process();
  const auto both = p.peak();
  CHECK(both > .2F);
  CHECK(p.events({event(0, 0xb0, 64, 0)}) == ET_OK);
  for (auto n = 0; n < 6; ++n)
    p.process();
  CHECK(p.peak() > 0 && p.peak() < both * .6F);

  held[OffBy] = 7;
  release[Group] = 7;
  Player choked({held, release});
  CHECK(choked.events(
            {event(0, 0x90, 60, 127, 1), event(0, 0x90, 61, 127, 2), event(0, 0x80, 61, 0, 2)},
            ET_MIDI_STATE_ONLY) == ET_OK);
  CHECK(choked.events({}, ET_MIDI_REATTACK) == ET_OK);
  choked.process();
  CHECK(choked.peak() == 0);

  Player stopped;
  CHECK(
      stopped.events({event(0, 0x90, 60, 127, 1), event(0, 0xb0, 64, 127), event(0, 0xb0, 120, 0)},
                     ET_MIDI_STATE_ONLY) == ET_OK);
  CHECK(stopped.events({}, ET_MIDI_REATTACK) == ET_OK);
  stopped.process();
  CHECK(stopped.peak() == 0);

  Player reset;
  CHECK(reset.events({event(0, 0x90, 60, 127, 1)}, ET_MIDI_STATE_ONLY) == ET_OK);
  CHECK(reset.events({}, ET_MIDI_RESET, 2) == ET_OK);
  CHECK(reset.events({event(0, 0xb0, 64, 127)}, ET_MIDI_STATE_ONLY, 2) == ET_OK);
  CHECK(reset.events({}, ET_MIDI_REATTACK, 2) == ET_OK);
  reset.process();
  CHECK(reset.peak() == 0);
}
void channelConfigurationOwnership() {
  auto first = region(), second = first;
  first[SequenceLength] = second[SequenceLength] = 2;
  second[SequencePosition] = 2;
  second[Volume] = -144;
  Player p({first, second});
  p.configure(1);
  CHECK(p.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  p.process();
  p.process();
  const auto original = p.peak();
  CHECK(original > .01F);
  p.configure(1, -6);
  p.process();
  CHECK(std::abs(p.peak() - original * std::pow(10.0F, -.3F)) < .000001F);

  p.configure(2);
  CHECK(p.events({event(0, 0x80, 60, 0, 1)}) == ET_OK);
  p.process();
  p.process(.125F);
  for (auto sample : p.audio)
    CHECK(sample == .125F);
  CHECK(p.events({event(0, 0x91, 60, 127, 2)}) == ET_OK);
  p.process();
  p.process();
  CHECK(p.peak() == original);

  // Configuration retirement also runs when no event batch arrives.
  p.configure(1);
  p.process();
  p.process();
  CHECK(p.peak() == 0);
}
void stagedEnvelopeTiming() {
  EnvelopeParameters values;
  values.value = {.01F, 20.0F, .02F, .01F, .02F, 50.0F, .01F};
  Envelope envelope;
  envelope.reset(values, 1000);
  std::array<float, 70> output{};
  for (auto &sample : output)
    sample = envelope.next(values);
  CHECK(output[9] == 0.0F);
  CHECK(std::abs(output[11] - .2F) < .05F);
  CHECK(output[31] > .99F);
  CHECK(output[41] > .5F);
  CHECK(std::abs(output[65] - .5F) < .00001F);
  envelope.release(values);
  for (auto i = 0u; i < 12u; ++i)
    envelope.next(values);
  CHECK(envelope.done());

  values.value = {0, 0, .1F, 0, 0, 100, .1F};
  Envelope fixed, dynamic;
  fixed.reset(values, 1000);
  dynamic.reset(values, 1000);
  for (auto i = 0u; i < 10u; ++i) {
    fixed.next(values);
    dynamic.next(values);
  }
  values.value[EnvelopeParameters::Attack] = .02F;
  fixed.parametersChanged(values, false);
  dynamic.parametersChanged(values, true);
  float slow = 0, fast = 0;
  for (auto i = 0u; i < 15u; ++i) {
    slow = fixed.next(values);
    fast = dynamic.next(values);
  }
  CHECK(slow < .3F && fast > .99F);
  // Dynamic release duration follows a half-pedal controller change without
  // restarting the attack or resurrecting a completed envelope.
  dynamic.release(values);
  for (auto i = 0u; i < 10u; ++i)
    dynamic.next(values);
  values.value[EnvelopeParameters::Release] = .02F;
  dynamic.parametersChanged(values, true);
  for (auto i = 0u; i < 12u; ++i)
    dynamic.next(values);
  CHECK(dynamic.done());
}
void scriptWaitAndHistory() {
  static_assert(sizeof(et_midi_event) == 24u);
  Player player({region()}, false, false, {}, false, kScriptNoteWaitFixture);
  Bank replacement({region()}, 1024, false, {}, kScriptNoteWaitFixture);
  std::unique_ptr<PreparedAsset> prepared;
  CHECK(player.kernel->assetPreparer(0)(
            {48000, 2, 128}, replacement.info(),
            reinterpret_cast<const std::uint8_t *>(replacement.words.data()), ET_ASSET_F32_MULTICH,
            prepared) == ET_OK);
  {
    allocation_guard::Scope guard;
    CHECK(player.kernel->exchangePreparedAsset(0, prepared) == ET_OK);
  }
  player.process();
  CHECK(player.peak() == 0);
  CHECK(player.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  CHECK(player.events({event(0, 0x90, 60, 127, 7)}) == ET_OK);
  player.process();
  CHECK(player.peak() == 0);
  CHECK((player.kernel->midiState() & ET_MIDI_STATE_CALLBACKS) != 0u);
  CHECK(player.events({{0, 0, 0, ET_MIDI_NATURAL_END, 128, 0}}) == ET_OK);
  player.process();
  CHECK(player.peak() == 0);
  player.process();
  CHECK(player.peak() == 0);
  player.process();
  CHECK(player.peak() > .001F);
  CHECK((player.kernel->midiState() & ET_MIDI_STATE_GENERATED) != 0u);
  for (auto i = 0u; i < 15u; ++i)
    player.process();
  CHECK(player.peak() == 0);

  CHECK(player.events({}, ET_MIDI_RESET, 2) == ET_OK);
  CHECK((player.kernel->midiState() & (ET_MIDI_STATE_CALLBACKS | ET_MIDI_STATE_GENERATED)) == 0u);
  auto on = event(0, 0x90, 60, 127, 8);
  auto off = event(0, 0x80, 60, 0, 8);
  off.render_frame_low = 128;
  CHECK(player.events({on, off}, ET_MIDI_STATE_ONLY, 2) == ET_OK);
  CHECK(player.kernel->setMidiClock(960, 2, ET_MIDI_CLOCK_HISTORY) == ET_OK);
  for (auto i = 0u; i < 100u && (player.kernel->midiState() & ET_MIDI_STATE_HISTORY_PENDING); ++i) {
    player.process();
    CHECK(player.peak() == 0);
  }
  CHECK(player.kernel->midiClock() == 960);
  CHECK((player.kernel->midiState() & ET_MIDI_STATE_HISTORY_PENDING) == 0u);
  CHECK(player.events({{7, 0, 0, ET_MIDI_REATTACK, 960, 0}}, 0, 2) == ET_OK);
  player.process();
  for (auto i = 0u; i <= 7u; ++i)
    CHECK(player.audio[i] == 0);
  CHECK(player.peak() > .001F);
  for (auto i = 0u; i < 15u; ++i)
    player.process();
  CHECK(player.peak() == 0);
}
void scriptCheckpointResume() {
  Player source({region()}, false, false, {}, false, kScriptNoteWaitFixture);
  CHECK(source.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  CHECK(source.events({event(0, 0x90, 60, 127, 17)}) == ET_OK);
  source.process();
  source.process();
  CHECK(source.kernel->midiClock() == 256);
  CHECK(source.events({}, ET_MIDI_PAUSE, 2) == ET_OK);
  const auto bytes = source.kernel->midiCheckpointSize();
  CHECK(bytes > 1000000 && bytes < 32u * 1024u * 1024u);
  std::vector<std::uint8_t> snapshot(bytes);
  {
    allocation_guard::Scope guard;
    CHECK(source.kernel->writeMidiCheckpoint(snapshot.data(), bytes) == ET_OK);
  }
  for (auto i = 0u; i < 100u; ++i)
    source.process();
  CHECK(source.kernel->midiClock() == 256);
  for (auto rate : {48000u, 96000u, 44100u}) {
    Player restored({region()}, false, false, {}, false, kScriptNoteWaitFixture, rate);
    restored.process();
    CHECK(restored.peak() == 0);
    {
      allocation_guard::Scope guard;
      CHECK(restored.kernel->readMidiCheckpoint(snapshot.data(), bytes) == ET_OK);
    }
    const auto clock = static_cast<unsigned>(std::floor(256.0 * rate / 48000.0 + .5));
    CHECK(restored.kernel->midiClock() == clock);
    CHECK(restored.events({}, ET_MIDI_RESUME, 3) == ET_OK);
    CHECK(restored.kernel->setMidiClock(clock, 2, 0) == ET_ERR_STATE);
    CHECK(restored.events({event(0, 0x90, 60, 100)}, 0, 2) == ET_ERR_STATE);
    CHECK(restored.events({{7, 0, 0, ET_MIDI_RESUME, clock, 0}}, 0, 3) == ET_OK);
    restored.process();
    for (auto i = 0u; i < 7u; ++i)
      CHECK(restored.audio[i] == 0);
    float peak = restored.peak();
    for (auto i = 0u; i < 10u; ++i) {
      restored.process();
      peak = std::max(peak, restored.peak());
    }
    CHECK(peak > .001F);
    for (auto i = 0u; i < 40u; ++i)
      restored.process();
    CHECK(restored.peak() == 0);
  }
  auto different = region();
  different[Volume] = -6;
  Player mismatched({different}, false, false, {}, false, kScriptNoteWaitFixture);
  CHECK(mismatched.kernel->readMidiCheckpoint(snapshot.data(), bytes) == ET_ERR_ARGS);
}
void scriptInitRestoreBoundary() {
  Player source({region()}, false, false, {}, false, kScriptInitFixture);
  for (auto i = 0u; i < 3u; ++i)
    source.process();
  CHECK(source.peak() == 0);
  CHECK(source.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  source.process();
  const auto once = source.peak();
  CHECK(once > .01F);
  CHECK(source.events({}, ET_MIDI_PAUSE, 2) == ET_OK);
  std::vector<std::uint8_t> snapshot(source.kernel->midiCheckpointSize());
  CHECK(source.kernel->writeMidiCheckpoint(snapshot.data(),
                                           static_cast<unsigned>(snapshot.size())) == ET_OK);
  Player restored({region()}, false, false, {}, false, kScriptInitFixture);
  for (auto i = 0u; i < 3u; ++i)
    restored.process();
  CHECK(restored.peak() == 0);
  CHECK(restored.kernel->readMidiCheckpoint(snapshot.data(),
                                            static_cast<unsigned>(snapshot.size())) == ET_OK);
  CHECK(restored.events({}, ET_MIDI_RESUME, 3) == ET_OK);
  CHECK(restored.events({{0, 0, 0, ET_MIDI_RESUME, 128, 0}}, 0, 3) == ET_OK);
  restored.process();
  CHECK(restored.peak() > once * .9F && restored.peak() < once * 1.1F);
}
void scriptAdmissionBoundaries() {
  auto wrong = region(), right = region();
  wrong[LowKey] = wrong[HighKey] = 60;
  wrong[Volume] = -80;
  right[LowKey] = right[HighKey] = 72;
  Player reference({wrong, right});
  CHECK(reference.events({event(0, 0x90, 72, 64, 1)}) == ET_OK);
  reference.process();
  const auto expected = reference.audio;
  for (const auto script : {std::span<const std::uint8_t>(kScriptChildFixture),
                            std::span<const std::uint8_t>(kScriptOriginalFixture),
                            std::span<const std::uint8_t>(kScriptChildLoopFixture),
                            std::span<const std::uint8_t>(kScriptOriginalLoopFixture)}) {
    Player player({wrong, right}, false, false, {}, false, script);
    CHECK(player.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    CHECK(player.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
    player.process();
    CHECK(player.audio == expected);
    CHECK((player.kernel->midiState() & ET_MIDI_STATE_SCRIPT_ERROR) == 0);
  }
  Player before({region()}, false, true, {}, false, kScriptOrderBeforeFixture);
  Player after({region()}, false, true, {}, false, kScriptOrderAfterFixture);
  for (auto *player : {&before, &after}) {
    CHECK(player->kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    CHECK(player->events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
    player->process();
  }
  CHECK(before.peak() == 0);
  CHECK(after.peak() > .01F);
}
void pagedOfflineRetry(bool evictCoefficients = false) {
  auto r = region();
  r[Frames] = 8192;
  r[End] = r[LoopEnd] = 8191;
  r[AmpRandom] = 6;
  std::vector<Region> regions{r};
  if (evictCoefficients) {
    regions.clear();
    for (auto key : {60u, 72u})
      for (auto layer = 0u; layer < 128u; ++layer) {
        auto value = r;
        value[LowKey] = value[HighKey] = static_cast<float>(key);
        value[Tune] = layer * .5F;
        regions.push_back(value);
      }
  }
  const auto pcm = [evictCoefficients](unsigned frame) {
    return evictCoefficients ? .25F * std::sin(6.283185307179586F * frame / 31.0F)
           : frame < 4096    ? .25F
                             : .5F;
  };
  Player resident, paged, prefetched, late, vmReference;
  const auto install = [&](Player &player, bool stream,
                           std::span<const std::uint8_t> overrideScript = {}) {
    const auto script = !overrideScript.empty() ? overrideScript
                        : evictCoefficients
                            ? std::span<const std::uint8_t>(kScriptCacheEvictionFixture)
                            : std::span<const std::uint8_t>(kScriptOriginalLoopFixture);
    Bank data(regions, 8192, false, {}, script, stream);
    if (!stream)
      for (auto frame = 0u; frame < 8192u; ++frame)
        data.words[data.words.size() - 8192u + frame] = pcm(frame);
    auto *destination = player.kernel->beginAsset(0, data.info());
    CHECK(destination != nullptr);
    std::memcpy(destination, data.words.data(), data.words.size() * 4u);
    CHECK(player.kernel->commitAsset(0, static_cast<unsigned>(data.words.size() * 4u),
                                     ET_ASSET_F32_MULTICH) == ET_OK);
    if (stream) {
      CHECK(player.kernel->configureSampleStream(7) == ET_OK);
      std::array<float, 4096> head;
      for (auto frame = 0u; frame < head.size(); ++frame)
        head[frame] = pcm(frame);
      CHECK(player.kernel->publishSamplePage(7, 0, 0, head.data(), 4096, 1, 1) == ET_OK);
    }
    for (auto i = 0u; i < 100u && player.kernel->assetState(0) == ET_ASSET_STATE_PREPARING; ++i)
      player.process();
    CHECK(player.kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
    CHECK(player.kernel->prepareOfflineProcessing() == ET_OK);
    player.configure(0, 0, evictCoefficients ? 128 : 64);
    CHECK(player.events({}, ET_MIDI_RESET, 2) == ET_OK);
    CHECK(player.kernel->setMidiClock(0, 2, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    if (!overrideScript.empty()) {
      // The init callback runs on the musical render clock before external notes.
      player.process();
      readScriptMessages(*player.kernel);
    }
    CHECK(player.events({event(0, 0x90, 60, 127, 1)}, 0, 2) == ET_OK);
    return reinterpret_cast<float *>(destination) + 8u + kStreamHeader;
  };
  install(resident, false);
  install(paged, true);
  CHECK(paged.kernel->setMidiMetering(true) == ET_OK);
  install(prefetched, true);
  install(late, true, kScriptHydrationFixture);
  install(vmReference, false, kScriptHydrationFixture);
  const auto forecastNote = event(0, 0x90, 60, 127, 1);
  const auto beforeForecast = prefetched.kernel->midiState();
  CHECK(prefetched.kernel->prefetchSampleEvents(&forecastNote, 1, 2, 12000, 1) == ET_OK);
  CHECK(prefetched.kernel->midiClock() == 0);
  CHECK(prefetched.kernel->midiState() == beforeForecast);
  std::array<et_sfz_sample_request, 8> forecasts{};
  unsigned forecastCount = 0;
  CHECK(prefetched.kernel->takeSampleRequests(
            forecasts.data(), static_cast<unsigned>(forecasts.size()), forecastCount) == ET_OK);
  CHECK(forecastCount == 1);
  CHECK(prefetched.kernel->prefetchSampleEvents(nullptr, 0, 2, 12000, 2) == ET_ERR_STATE);
  std::array<float, 4096> forecastPage;
  for (auto frame = 0u; frame < forecastPage.size(); ++frame)
    forecastPage[frame] = pcm(4096u + frame);
  CHECK(prefetched.kernel->publishSamplePage(7, 0, 1, forecastPage.data(), 4096, 1, 0) == ET_OK);
  CHECK(prefetched.kernel->prefetchSampleEvents(nullptr, 0, 2, 12000, 2) == ET_OK);
  unsigned retries = 0;
  bool underrun = false, recovered = false;
  unsigned unavailableBlocks = 0;
  for (auto block = 0u; block < 40u; ++block) {
    if (evictCoefficients && block == 1u)
      for (auto *player : {&resident, &paged, &prefetched, &late, &vmReference})
        CHECK(player->events({event(0, 0x90, 72, 127, 2)}, 0, 2) == ET_OK);
    resident.process();
    prefetched.process();
    CHECK(prefetched.audio == resident.audio);
    CHECK(prefetched.kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
    vmReference.process();
    const auto beforeLateClock = late.kernel->midiClock();
    late.process();
    CHECK(late.kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
    CHECK(late.kernel->midiClock() == beforeLateClock + 128u);
    RuntimeEventState availability{};
    late.kernel->readRuntimeEvent(availability);
    CHECK(availability.latched == 0u);
    if (availability.cause == 1u) {
      underrun = true;
      CHECK(availability.generation == 1u);
      if (++unavailableBlocks == 3u)
        CHECK(late.kernel->publishSamplePage(7, 0, 1, forecastPage.data(), 4096, 1, 0) == ET_OK);
    } else if (underrun) {
      recovered = true;
      CHECK(availability.generation == 2u);
      CHECK(late.peak() > .01F);
    }
    const auto clock = paged.kernel->midiClock();
    (void)readMixer(*paged.kernel); // Begin a fresh measured interval for this quantum.
    for (auto attempt = 0u; attempt < 3u; ++attempt) {
      paged.audio.fill(0);
      et_status status;
      {
        allocation_guard::Scope guard;
        status = paged.kernel->processOffline(paged.audio.data(), 2, 128, {0});
      }
      if (status == ET_OK)
        break;
      CHECK(status == ET_NEED_SAMPLE);
      CHECK(mixerPeak(readMixer(*paged.kernel), 0) == 0);
      CHECK(paged.kernel->midiClock() == clock);
      ++retries;
      std::array<et_sfz_sample_request, 8> requests{};
      unsigned count = 0;
      CHECK(paged.kernel->takeSampleRequests(
                requests.data(), static_cast<unsigned>(requests.size()), count) == ET_OK);
      CHECK(count > 0);
      for (auto i = 0u; i < count; ++i) {
        const auto &request = requests[i];
        CHECK(request.sample == 0 && request.page_low == 1 && request.page_high == 0);
        std::array<float, 4096> page;
        for (auto frame = 0u; frame < page.size(); ++frame)
          page[frame] = pcm(4096u + frame);
        CHECK(paged.kernel->publishSamplePage(7, 0, 1, page.data(), 4096, 1, 0) == ET_OK);
      }
    }
    CHECK(paged.audio == resident.audio);
  }
  CHECK(retries == 1);
  CHECK(underrun && recovered && unavailableBlocks == 3u);
  const auto messages = readScriptMessages(*late.kernel);
  const auto referenceMessages = readScriptMessages(*vmReference.kernel);
  CHECK(messages.text == referenceMessages.text);
  CHECK(std::count(referenceMessages.text.begin(), referenceMessages.text.end(), "note") >=
        (evictCoefficients ? 2 : 1));
  // Corrupting a validated sample identity is an invariant failure, not page latency.
  Player invalid;
  auto *invalidRegion = install(invalid, true);
  invalidRegion[Sample] = std::bit_cast<float>(1u);
  invalid.process();
  CHECK(invalid.kernel->assetState(0) == ET_ASSET_STATE_ERROR);
}
void pagedCheckpointPrefetch() {
  for (const auto scripted : {false, true}) {
    auto r = region();
    r[Frames] = 20000;
    r[Offset] = r[LoopStart] = scripted ? 5000.0F : 10000.0F;
    r[End] = r[LoopEnd] = 19999;
    const auto pcm = [scripted](unsigned frame) {
      return scripted ? .25F * std::sin(6.283185307179586F * frame / 31.0F) : .25F;
    };
    const auto publish = [&](Player &player, unsigned page) {
      std::array<float, 4096> values;
      const auto count = page == 4 ? 3616u : 4096u;
      for (auto frame = 0u; frame < count; ++frame)
        values[frame] = pcm(page * 4096u + frame);
      CHECK(player.kernel->publishSamplePage(7, 0, page, values.data(), count, 1,
                                             page == 4 || page == (scripted ? 1u : 2u) ? 1u : 0u) ==
            ET_OK);
    };
    const auto install = [&](Player &player, bool initialScriptPage) {
      Bank data({r}, 20000, false, {},
                scripted ? std::span<const std::uint8_t>(kScriptCacheEvictionFixture)
                         : std::span<const std::uint8_t>{},
                true);
      if (scripted) {
        data.words[8u + 14u] = std::bit_cast<float>(8u);
        data.footprint += 4u * (4096u * 4u + 32u) + 16u * 4u;
      }
      auto *destination = player.kernel->beginAsset(0, data.info());
      CHECK(destination);
      std::memcpy(destination, data.words.data(), data.words.size() * 4u);
      CHECK(player.kernel->commitAsset(0, static_cast<unsigned>(data.words.size() * 4u),
                                       ET_ASSET_F32_MULTICH) == ET_OK);
      CHECK(player.kernel->configureSampleStream(7) == ET_OK);
      publish(player, scripted ? 1u : 2u);
      publish(player, 4);
      if (initialScriptPage)
        publish(player, 0);
      CHECK(player.kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
      CHECK(player.events({}, ET_MIDI_RESET, 2) == ET_OK);
    };
    Player source;
    install(source, scripted);
    CHECK(source.kernel->setMidiClock(0, 2, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    CHECK(source.events({event(0, 0x90, scripted ? 72 : 60, 127, 1)}, 0, 2) == ET_OK);
    source.process();
    const auto expectedReattack = source.audio;
    CHECK(source.events({}, ET_MIDI_PAUSE, 3) == ET_OK);
    std::vector<std::uint8_t> checkpoint(source.kernel->midiCheckpointSize());
    CHECK(source.kernel->writeMidiCheckpoint(checkpoint.data(),
                                             static_cast<unsigned>(checkpoint.size())) == ET_OK);
    Player restored;
    install(restored, false);
    CHECK(restored.kernel->readMidiCheckpoint(checkpoint.data(),
                                              static_cast<unsigned>(checkpoint.size())) == ET_OK);
    CHECK(restored.kernel->prefetchSampleEvents(nullptr, 0, 3, scripted ? 1000 : 12000, 1) ==
          ET_OK);
    std::array<et_sfz_sample_request, 8> requests{};
    unsigned count = 0;
    CHECK(restored.kernel->takeSampleRequests(requests.data(), 8, count) == ET_OK);
    // Four slots hold resident onsets2/4 and the actual future page3. Default-zero
    // geometry would incorrectly pin0/1 and prevent the required page from loading.
    CHECK(count == 1 && requests[0].page_low == (scripted ? 0u : 3u));
    for (auto index = 0u; index < count; ++index)
      publish(restored, requests[index].page_low);
    CHECK(restored.kernel->prefetchSampleEvents(nullptr, 0, 3, scripted ? 1000 : 12000, 2) ==
          ET_OK);
    CHECK(restored.events({}, ET_MIDI_RESUME, 4) == ET_OK);
    CHECK(restored.events({{0, 0, 0, ET_MIDI_RESUME, 128, 0}}, 0, 4) == ET_OK);
    restored.process();
    CHECK(restored.audio == expectedReattack);
    CHECK(restored.kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
  }
}
void sf2CollectionPlayback() {
  Player base;
  base.loadSf2();
  CHECK(base.events({event(0, 0x90, 72, 127, 1)}, 0, 2) == ET_OK);
  base.process();
  base.process();
  const auto reference = base.peak();
  CHECK(reference > .01F);
  for (auto channel = 0u; channel < 16u; ++channel) {
    Player player;
    player.loadSf2();
    CHECK(player.events({event(0, 0xc0u | channel, channel & 1u, 0),
                         event(0, 0xb0u | ((channel + 1u) & 15u), 7, 0),
                         event(0, 0x90u | channel, 72, 127, 1)},
                        0, 2) == ET_OK);
    player.process();
    player.process();
    // Standard compatibility scales the 400cB and 200cB attenuation generators by 0.4.
    const auto expected = channel == 9   ? std::pow(10.0F, -.8F)
                          : channel & 1u ? std::pow(10.0F, -.4F)
                                         : 1.0F;
    CHECK(std::abs(player.peak() / reference - expected) < .0001F);
  }
  // SF2.04 Strict applies the attenuation generators literally.
  std::array<float, 2> strictPeaks{};
  for (auto program = 0u; program < 2u; ++program) {
    Player strict;
    strict.loadSf2();
    strict.configure(0, 0, 64, 0, true, -1, 0, true);
    CHECK(strict.events({event(0, 0xc0, program, 0), event(0, 0x90, 72, 127, 1)}, 0, 2) == ET_OK);
    strict.process();
    strict.process();
    strictPeaks[program] = strict.peak();
  }
  CHECK(std::abs(strictPeaks[1] / strictPeaks[0] - .1F) < .0001F);
  Player pendingBank, committedBank, drum;
  for (auto *player : {&pendingBank, &committedBank, &drum})
    player->loadSf2();
  CHECK(pendingBank.events({event(0, 0xb0, 0, 1), event(0, 0x90, 72, 127, 1)}, 0, 2) == ET_OK);
  CHECK(
      committedBank.events({event(0, 0xb0, 0, 1), event(0, 0xc0, 2, 0), event(0, 0x90, 72, 127, 1)},
                           0, 2) == ET_OK);
  CHECK(drum.events({event(0, 0x99, 72, 127, 1)}, 0, 2) == ET_OK);
  for (auto *player : {&pendingBank, &committedBank, &drum}) {
    player->process();
    player->process();
  }
  CHECK(std::abs(pendingBank.peak() / reference - 1.0F) < .0001F);
  CHECK(std::abs(committedBank.peak() / reference - std::pow(10.0F, -.2F)) < .0001F);
  CHECK(std::abs(drum.peak() / reference - std::pow(10.0F, -.8F)) < .0001F);
  Player unchanged, changed;
  for (auto *player : {&unchanged, &changed}) {
    player->loadSf2();
    CHECK(player->events({event(0, 0x90, 72, 127, 1)}, 0, 2) == ET_OK);
    player->process();
  }
  CHECK(changed.events({event(0, 0xc0, 1, 0)}, 0, 2) == ET_OK);
  for (auto block = 0u; block < 8u; ++block) {
    unchanged.process();
    changed.process();
    CHECK(changed.audio == unchanged.audio);
  }
  CHECK(changed.events({event(0, 0xb0, 0, 1), event(0, 0xc0, 2, 0)}, 0, 2) == ET_OK);
  unchanged.process();
  changed.process();
  CHECK(changed.audio == unchanged.audio);
  CHECK(changed.events(
            {event(0, 0x80, 72, 0, 1),
             {0, 0, 0, ET_MIDI_NATURAL_END, static_cast<unsigned>(changed.kernel->midiClock()), 0}},
            0, 2) == ET_OK);
  float tail = 0;
  for (auto block = 0u; block < 80u; ++block) {
    CHECK(changed.events({}, ET_MIDI_NATURAL_END, 2) == ET_OK);
    changed.process();
    if (block > 20)
      tail = std::max(tail, changed.peak());
  }
  CHECK(tail > .00001F);
  CHECK((changed.kernel->midiState() & ET_MIDI_STATE_VOICES) != 0u);
  for (auto block = 0u; block < 3000u; ++block)
    changed.process();
  CHECK(changed.peak() == 0);
  CHECK((changed.kernel->midiState() & ET_MIDI_STATE_VOICES) == 0u);
}
void sf2PreparedFilterReselection() {
  for (const bool resetControllers : {false, true}) {
    Player reference, changed;
    for (auto *player : {&reference, &changed}) {
      player->loadSf2({}, false);
      CHECK(player->events({event(0u, 0xb0u, 7u, 127u), event(0u, 0xb0u, 101u, 0u),
                            event(0u, 0xb0u, 100u, 0u), event(0u, 0xb0u, 6u, 12u),
                            event(0u, 0x90u, 72u, 127u, 1u)},
                           0u, 2u) == ET_OK);
      for (auto block = 0u; block < 4u; ++block)
        player->process();
    }
    CHECK(reference.audio == changed.audio);
    // Step two is prepared at birth. Full bend requests step four, which has no
    // prepared slot here; the original exact fallback remains usable.
    CHECK(changed.events({event(0u, 0xe0u, 127u, 127u)}, 0u, 2u) == ET_OK);
    changed.process();
    reference.process();
    CHECK(std::all_of(changed.audio.begin(), changed.audio.end(),
                      [](float value) { return std::isfinite(value); }));
    CHECK(changed.peak() > .01F);
    CHECK(
        changed.events({resetControllers ? event(0u, 0xb0u, 121u, 0u) : event(0u, 0xe0u, 0u, 64u)},
                       0u, 2u) == ET_OK);
    for (auto block = 0u; block < 8u; ++block) {
      changed.process();
      reference.process();
    }
    // Constant periodic PCM and integer source steps remove phase/position as
    // variables. Returning to the prepared step must use its same FIR arithmetic.
    CHECK(changed.audio == reference.audio);
    CHECK(changed.kernel->midiClock() == reference.kernel->midiClock());
    CHECK((changed.kernel->midiState() & ET_MIDI_STATE_VOICES) != 0u);
  }
}
void sf2SoundOffAndModulation() {
  Player p;
  p.loadSf2({}, false);
  CHECK(p.events({event(0, 0xb0, 64, 127), event(0, 0x90, 72, 127, 1), event(0, 0x91, 72, 127, 2),
                  event(1, 0xb0, 66, 127), event(2, 0x80, 72, 0)},
                 0, 2) == ET_OK);
  for (auto i = 0; i < 4; ++i)
    p.process();
  const auto both = p.peak();
  CHECK(p.events({event(0, 0xb0, 120, 13)}, 0, 2) == ET_OK);
  for (auto i = 0; i < 8; ++i)
    p.process();
  CHECK(std::abs(p.peak() / both - .5F) < .0001F);
  CHECK(p.events({event(0, 0xb1, 120, 0), event(0, 0x80, 72, 0)}, 0, 2) == ET_OK);
  for (auto i = 0; i < 8; ++i)
    p.process();
  CHECK(p.peak() < 1e-15F);
  CHECK(p.events({event(0, 0x90, 72, 127, 3)}, 0, 2) == ET_OK);
  for (auto i = 0; i < 4; ++i)
    p.process();
  CHECK(std::abs(p.peak() / both - .5F) < .0001F);
  CHECK(p.events({}, ET_MIDI_RESET, 3) == ET_OK);
  CHECK(p.events({event(0, 0x90, 72, 127, 4), event(0, 0xb0, 64, 127), event(0, 0xb0, 120, 0)},
                 ET_MIDI_STATE_ONLY, 3) == ET_OK);
  CHECK(p.events({}, ET_MIDI_REATTACK, 3) == ET_OK);
  for (auto i = 0; i < 8; ++i)
    p.process();
  CHECK(p.peak() < 1e-15F);

  Player reference, positive, negative;
  reference.loadSf2({}, false);
  positive.loadSf2({{13, 100.0F}, {21, -32768.0F}}, false);
  negative.loadSf2({{13, -100.0F}, {21, -32768.0F}}, false);
  for (auto *player : {&reference, &positive, &negative})
    CHECK(player->events({event(0, 0x90, 72, 127, 1)}, 0, 2) == ET_OK);
  for (auto block = 0u; block < 37u; ++block) {
    reference.process();
    positive.process();
    negative.process();
    if (block == 11u || block == 34u) {
      const auto up = positive.audio[64] / reference.audio[64];
      const auto down = negative.audio[64] / reference.audio[64];
      // Like FluidSynth, the LFO only attenuates: the boosting half-cycle stays at unity.
      CHECK(block == 11u ? std::abs(up - 1.0F) < .001F && down < .34F
                         : up < .34F && std::abs(down - 1.0F) < .001F);
    }
  }
  float center = 0;
  for (const auto pan : {0, -250, 250, -500, 500}) {
    Player player;
    player.loadSf2({{17, static_cast<float>(pan)}}, false);
    CHECK(player.events({event(0, 0x90, 72, 127, 1)}, 0, 2) == ET_OK);
    for (auto i = 0; i < 4; ++i)
      player.process();
    if (pan == 0)
      center = player.audio[64] * std::sqrt(2.0F);
    const auto left = player.audio[64] / center, right = player.audio[192] / center;
    const auto angle = (pan * .002F + 1.0F) * .78539816F;
    CHECK(std::abs(left - std::cos(angle)) < .0001F);
    CHECK(std::abs(right - std::sin(angle)) < .0001F);
    CHECK(std::abs(left * left + right * right - 1) < .0001F);
  }
}
void scriptVoiceAutomation() {
  auto quiet = region();
  quiet[Volume] = -20;
  Player final({quiet}, false, false, {}, false, kScriptGainFinalFixture);
  CHECK(final.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  CHECK(final.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  final.process();
  final.process();
  CHECK(std::abs(final.audio[64] - .25F * std::pow(10.0F, -.3F)) < .0001F);
  for (auto i = 0; i < 3; ++i)
    final.process();
  const auto relative = .25F * std::pow(10.0F, -.3F) * .1F * (100.0F / 127.0F) * (100.0F / 127.0F);
  CHECK(std::abs(final.audio[64] - relative) < .0001F);
  CHECK(final.events({}, ET_MIDI_RESET, 2) == ET_OK);
  final.process();
  final.process();
  CHECK(final.peak() == 0);

  Player fade({region()}, false, false, {}, false, kScriptPanFadeFixture);
  CHECK(fade.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  CHECK(fade.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  fade.process();
  CHECK(fade.audio[127] > 0 && fade.audio[255] == 0);
  for (auto i = 0; i < 3; ++i)
    fade.process();
  CHECK(fade.audio[127] > fade.audio[255]);
  fade.process();
  CHECK(fade.audio[255] > fade.audio[127]);
  for (auto i = 0; i < 3; ++i)
    fade.process();
  CHECK(fade.peak() == 0);

  Player envelope({region()}, false, false, {}, false, kScriptAmpFixture);
  CHECK(envelope.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  CHECK(envelope.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  envelope.process();
  CHECK(envelope.peak() < .03F);
  for (auto i = 0; i < 17; ++i)
    envelope.process();
  CHECK(std::abs(envelope.peak() - .25F * .5F * (100.0F / 127.0F) * (100.0F / 127.0F)) < .001F);
  CHECK(envelope.events({event(0, 0x80, 60, 0, 1)}) == ET_OK);
  for (auto i = 0; i < 4; ++i)
    envelope.process();
  CHECK(envelope.peak() == 0);
}
void scriptBoundedMessages() {
  Player player({region()}, false, false, {}, false, kScriptMessageFixture);
  CHECK(player.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  player.process();
  std::array<std::uint8_t, 8192> ringStorage{};
  std::array<std::uint8_t, 4096> output{};
  TelemetryRing ring;
  ring.adopt(ringStorage.data(), static_cast<std::uint32_t>(ringStorage.size()));
  std::uint32_t sequence = 0;
  TelemetryWriter writer(ring, 1, sequence);
  {
    allocation_guard::Scope guard;
    player.kernel->writeTelemetry(writer);
  }
  const auto bytes = ring.read(output.data(), static_cast<std::uint32_t>(output.size()), nullptr);
  auto messages = 0u, dropped = 0u;
  for (auto offset = 0u; offset < bytes;) {
    const auto type = output[offset] | static_cast<unsigned>(output[offset + 1]) << 8u;
    const auto payloadBytes = output[offset + 12] | static_cast<unsigned>(output[offset + 13])
                                                        << 8u;
    if (type == 33) {
      dropped += output[offset + 16];
      CHECK(output[offset + 20] == 1);
      CHECK(output[offset + 24] == '0' + messages);
      ++messages;
    }
    offset += (16u + payloadBytes + 3u) & ~3u;
  }
  CHECK(messages == 8 && dropped == 4);
}
void scriptTerminalFailure() {
  for (const auto mode : {0, 1, 2, 3}) {
    const bool offline = (mode & 1) != 0, streamed = (mode & 2) != 0;
    auto r = region();
    r[Release] = .001F;
    Player player({r}, false, false, {}, false, kScriptRuntimeFailureFixture);
    const auto generation = streamed ? 2u : 1u;
    if (streamed) {
      Bank data({r}, 1024, false, {}, kScriptRuntimeFailureFixture, true);
      auto *destination = player.kernel->beginAsset(0, data.info());
      CHECK(destination);
      std::memcpy(destination, data.words.data(), data.words.size() * 4u);
      CHECK(player.kernel->commitAsset(0, static_cast<unsigned>(data.words.size() * 4u),
                                       ET_ASSET_F32_MULTICH) == ET_OK);
      CHECK(player.kernel->configureSampleStream(7) == ET_OK);
      std::array<float, 1024> page;
      page.fill(.25F);
      CHECK(player.kernel->publishSamplePage(7, 0, 0, page.data(), 1024, 1, 1) == ET_OK);
      for (auto block = 0; block < 100 && player.kernel->assetState(0) == ET_ASSET_STATE_PREPARING;
           ++block)
        player.process();
      CHECK(player.kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
      CHECK(player.kernel->prepareOfflineProcessing() == ET_OK);
      CHECK(player.events({}, ET_MIDI_RESET, generation) == ET_OK);
    }
    CHECK(player.kernel->setMidiClock(0, generation, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    CHECK(player.events({event(0, 0x90, 60, 127, 1)}, 0, generation) == ET_OK);
    bool audible = false, failed = false;
    for (auto block = 0u; block < 12u && !failed; ++block) {
      if (offline) {
        player.audio.fill(.125F);
        allocation_guard::Scope guard;
        const auto status = player.kernel->processOffline(player.audio.data(), 2, 128, {0});
        failed = status == ET_ERR_STATE;
        CHECK(status == ET_OK || failed);
      } else {
        player.process(.125F);
        failed = player.kernel->assetState(0) == ET_ASSET_STATE_ERROR;
      }
      if (!failed)
        audible |= player.peak() > .2F;
    }
    CHECK(audible && failed);
    CHECK(player.kernel->assetState(0) == ET_ASSET_STATE_ERROR);
    CHECK(player.kernel->midiState() == ET_MIDI_STATE_SCRIPT_ERROR);
    CHECK(player.events({event(0, 0x80, 60, 0)}, 0, generation) == ET_ERR_STATE);
    for (auto i = 0; i < 450; ++i) {
      player.process(.125F);
      CHECK(player.kernel->midiState() == ET_MIDI_STATE_SCRIPT_ERROR);
      for (auto value : player.audio)
        CHECK(value == .125F);
    }
    CHECK(player.kernel->processOffline(player.audio.data(), 2, 128, {0}) == ET_ERR_STATE);
    CHECK(player.events({}, ET_MIDI_RESET, generation + 1u) == ET_OK);
    {
      allocation_guard::Scope guard;
      player.kernel->reset();
    }
    CHECK(player.kernel->midiState() == ET_MIDI_STATE_SCRIPT_ERROR);
    std::array<std::uint8_t, 8192> storage{}, output{};
    TelemetryRing ring;
    ring.adopt(storage.data(), static_cast<unsigned>(storage.size()));
    std::uint32_t sequence = 0;
    TelemetryWriter writer(ring, 1, sequence);
    {
      allocation_guard::Scope guard;
      player.kernel->writeTelemetry(writer);
    }
    const auto bytes = ring.read(output.data(), static_cast<unsigned>(output.size()), nullptr);
    auto diagnostics = 0u;
    for (auto offset = 0u; offset < bytes;) {
      const auto size = output[offset + 12u] | static_cast<unsigned>(output[offset + 13u]) << 8u;
      if ((output[offset] | static_cast<unsigned>(output[offset + 1u]) << 8u) == 33u) {
        const auto *text = reinterpret_cast<const char *>(output.data() + offset + 24u);
        CHECK(std::strstr(text, "NKSP runtime error 4 at instruction ") == text);
        ++diagnostics;
      }
      offset += (16u + size + 3u) & ~3u;
    }
    CHECK(diagnostics == 1u);
    player.loadSf2({}, false);
    CHECK(player.events({event(0, 0x90, 72, 127, 2)}, 0, 2) == ET_OK);
    for (auto block = 0; block < 4; ++block)
      player.process();
    CHECK(player.peak() > .01F);
  }
}
void scriptCurrentEventAndDomains() {
  Player ignored({region()}, false, false, {}, false, kScriptIgnoreCurrentFixture);
  CHECK(ignored.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  CHECK(ignored.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  ignored.process();
  CHECK(ignored.peak() == 0);
  CHECK(ignored.events({event(0, 0xb0, 7, 0), event(1, 0x90, 72, 127, 2)}) == ET_OK);
  for (auto block = 0; block < 4; ++block)
    ignored.process();
  CHECK(ignored.peak() > .1F);
  auto r = region();
  r[Volume] = -20;
  for (const auto script : {std::span<const std::uint8_t>(kScriptFinalFadeFixture),
                            std::span<const std::uint8_t>(kScriptGainDomainFixture)}) {
    Player player({r}, false, false, {}, false, script);
    CHECK(player.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    CHECK(player.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
    std::array<float, 2048> output{};
    for (auto block = 0u; block < 16u; ++block) {
      player.process();
      std::copy_n(player.audio.data(), 128, output.data() + block * 128);
    }
    for (auto boundary : {480u, 720u})
      CHECK(std::abs(output[boundary] - output[boundary - 1u]) < .001F);
    if (script.data() == kScriptFinalFadeFixture.data()) {
      CHECK(output[479] > .12F && output[481] > .12F);
      CHECK(output.back() == 0);
    } else {
      CHECK(output[479] < .01F && output[481] < .01F);
      CHECK(output[719] > output[479]);
    }
  }
  Player reference({r}, false, false, {}, false, kScriptGainDomainFixture);
  Player source({r}, false, false, {}, false, kScriptGainDomainFixture);
  for (auto *player : {&reference, &source}) {
    CHECK(player->kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    CHECK(player->events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
    for (auto block = 0; block < 6; ++block)
      player->process();
  }
  CHECK(source.events({}, ET_MIDI_PAUSE, 2) == ET_OK);
  std::vector<std::uint8_t> checkpoint(source.kernel->midiCheckpointSize());
  CHECK(source.kernel->writeMidiCheckpoint(checkpoint.data(),
                                           static_cast<unsigned>(checkpoint.size())) == ET_OK);
  CHECK(checkpoint[4] == 9u);
  Player resumed({r}, false, false, {}, false, kScriptGainDomainFixture);
  CHECK(resumed.kernel->readMidiCheckpoint(checkpoint.data(),
                                           static_cast<unsigned>(checkpoint.size())) == ET_OK);
  CHECK(resumed.events({}, ET_MIDI_RESUME, 3) == ET_OK);
  CHECK(resumed.events({{0, 0, 0, ET_MIDI_RESUME, 768, 0}}, 0, 3) == ET_OK);
  for (auto block = 0; block < 16; ++block) {
    reference.process();
    resumed.process();
    // Held-note restoration deliberately reattacks with the established2ms fade.
    // Its automation clock and affine coefficients must otherwise match uninterrupted PCM.
    auto expected = reference.audio;
    if (block == 0)
      for (auto index = 0u; index < expected.size(); ++index)
        if (const auto frame = index % 128u; frame < 96u)
          expected[index] *= 1.0F - static_cast<float>(96u - frame) / 96.0F;
    CHECK(expected == resumed.audio);
  }
  for (const auto pan : {false, true}) {
    auto value = region();
    value[pan ? Pan : Tune] = pan ? 50.0F : 1200.0F;
    Player player({value}, !pan, false, {}, false,
                  pan ? std::span<const std::uint8_t>(kScriptPanDomainFixture)
                      : std::span<const std::uint8_t>(kScriptTuneDomainFixture));
    CHECK(player.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    CHECK(player.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
    std::array<float, 512> output{};
    for (auto block = 0u; block < 4u; ++block) {
      player.process();
      std::copy_n(player.audio.data() + (pan ? 128u : 0u), 128, output.data() + block * 128);
    }
    CHECK(std::abs(output[480] - output[479]) < .001F);
    if (!pan) {
      const auto before = output[479] - output[478], after = output[481] - output[480];
      CHECK(after / before > .95F && after / before < 1.05F);
    }
  }
}
double scriptDifference(Region r, std::span<const std::uint8_t> script, bool release = false) {
  Player reference({r}, false, false, {}, true), controlled({r}, false, false, {}, true, script);
  CHECK(controlled.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  for (auto *player : {&reference, &controlled})
    CHECK(player->events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  auto difference = 0.0;
  for (auto block = 0u; block < 24u; ++block) {
    if (release && block == 8u)
      for (auto *player : {&reference, &controlled})
        CHECK(player->events({event(0, 0x80, 60, 0, 1)}) == ET_OK);
    reference.process();
    controlled.process();
    if (!release || block >= 8u)
      for (auto i = 0u; i < controlled.audio.size(); ++i)
        difference = std::max(
            difference, static_cast<double>(std::abs(controlled.audio[i] - reference.audio[i])));
  }
  return difference;
}
void scriptFilterAndLfoControls() {
  auto filter = region();
  filter[FilterType] = 2;
  filter[Cutoff] = 1500;
  filter[Resonance] = 6;
  CHECK(scriptDifference(filter, kScriptCutoffFixture) > .01);
  CHECK(scriptDifference(filter, kScriptResonanceFixture) > .01);
  filter[Cutoff] = 200;
  filter[FilterEGDepth] = 4800;
  filter[FilterEGSustain] = 100;
  CHECK(scriptDifference(filter, kScriptFilterAttackFixture) > .01);
  CHECK(scriptDifference(filter, kScriptFilterSustainFixture) > .01);
  filter[Release] = .1F;
  filter[FilterEGRelease] = .1F;
  CHECK(scriptDifference(filter, kScriptFilterReleaseFixture, true) > .01);
  filter[FilterEGSustain] = 0;
  CHECK(scriptDifference(filter, kScriptFilterDecayFixture) > .01);
  auto lfo = region();
  lfo[AmpLFOFrequency] = 5;
  lfo[AmpLFODepth] = 6;
  CHECK(scriptDifference(lfo, kScriptAmpLfoDepthFixture) > .01);
  CHECK(scriptDifference(lfo, kScriptAmpLfoFrequencyFixture) > .01);
  lfo = region();
  lfo[PitchLFOFrequency] = 5;
  lfo[PitchLFODepth] = 1200;
  CHECK(scriptDifference(lfo, kScriptPitchLfoDepthFixture) > .01);
  CHECK(scriptDifference(lfo, kScriptPitchLfoFrequencyFixture) > .01);
  lfo = region();
  lfo[FilterType] = 2;
  lfo[Cutoff] = 200;
  lfo[FilterLFOFrequency] = 5;
  lfo[FilterLFODepth] = 4800;
  CHECK(scriptDifference(lfo, kScriptFilterLfoDepthFixture) > .01);
  CHECK(scriptDifference(lfo, kScriptFilterLfoFrequencyFixture) > .01);
}
void envelopeControllers() {
  auto r = region();
  r[Attack] = .1F;
  Player fixed({r}, false, false, {{AmpAttackCC * 512u + 1u, -.08F}});
  r[AmpDynamic] = 1;
  Player dynamic({r}, false, false, {{AmpAttackCC * 512u + 1u, -.08F}});
  for (auto *player : {&fixed, &dynamic}) {
    CHECK(player->events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
    for (auto i = 0u; i < 4u; ++i)
      player->process();
    CHECK(player->events({event(0, 0xb0, 1, 127)}) == ET_OK);
    for (auto i = 0u; i < 7u; ++i)
      player->process();
  }
  CHECK(dynamic.peak() > fixed.peak() * 2.0F);

  r = region();
  Player delayed({r}, false, false, {{AmpDelayCC * 512u + 1u, .01F}});
  CHECK(delayed.events({event(0, 0xb0, 1, 127), event(0, 0x90, 60, 127, 1)}) == ET_OK);
  delayed.process();
  CHECK(delayed.peak() == 0);
  for (auto i = 0u; i < 5u; ++i)
    delayed.process();
  CHECK(delayed.peak() > .1F);

  r[Attack] = .1F;
  Player start({r}, false, false, {{AmpStartCC * 512u + 1u, 50.0F}});
  CHECK(start.events({event(0, 0xb0, 1, 127), event(0, 0x90, 60, 127, 1)}) == ET_OK);
  start.process();
  CHECK(start.peak() > .07F);

  r = region();
  r[Sustain] = 0;
  for (auto family : {AmpHoldCC, AmpDecayCC}) {
    Player stage({r}, false, false, {{family * 512u + 1u, .02F}});
    CHECK(stage.events({event(0, 0xb0, 1, 127), event(0, 0x90, 60, 127, 1)}) == ET_OK);
    stage.process();
    CHECK(stage.peak() > .01F);
    for (auto i = 0u; i < 10u; ++i)
      stage.process();
    CHECK(stage.peak() == 0);
  }
  r = region();
  Player sustain({r}, false, false, {{AmpSustainCC * 512u + 1u, -100.0F}});
  CHECK(sustain.events({event(0, 0xb0, 1, 127), event(0, 0x90, 60, 127, 1)}) == ET_OK);
  sustain.process();
  CHECK(sustain.peak() == 0);
  Player release({r}, false, false, {{AmpReleaseCC * 512u + 1u, .02F}});
  CHECK(release.events({event(0, 0xb0, 1, 127), event(0, 0x90, 60, 127, 1)}) == ET_OK);
  release.process();
  CHECK(release.events({event(0, 0x80, 60, 0, 1)}) == ET_OK);
  for (auto i = 0u; i < 3u; ++i)
    release.process();
  CHECK(release.peak() > .0001F);
  for (auto i = 0u; i < 12u; ++i)
    release.process();
  CHECK(release.peak() == 0);
}
void equalizerResponse() {
  const auto energy = [](const Player &player) {
    double value = 0;
    for (auto sample : player.audio)
      value += sample * sample;
    return value;
  };
  Player reference({region()}, false, false, {}, true);
  CHECK(reference.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  for (auto i = 0u; i < 50u; ++i)
    reference.process();
  const auto unfiltered = energy(reference);
  for (auto band = 0u; band < 3u; ++band) {
    auto r = region();
    r[EQ1Frequency + 3u * band] = 1500;
    r[EQ1Gain + 3u * band] = -12;
    Player cut({r}, false, false, {}, true);
    CHECK(cut.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
    for (auto i = 0u; i < 50u; ++i)
      cut.process();
    CHECK(std::abs(energy(cut) / unfiltered - std::pow(10.0, -1.2)) < .001);
    r[EQ1Gain + 3u * band] = 0;
    Player controlled({r}, false, false, {{(EQ1GainCC + 3u * band) * 512u + 1u, -12.0F}}, true);
    CHECK(controlled.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
    for (auto i = 0u; i < 50u; ++i)
      controlled.process();
    CHECK(std::abs(energy(controlled) - unfiltered) < .00001);
    CHECK(controlled.events({event(0, 0xb0, 1, 127)}) == ET_OK);
    for (auto i = 0u; i < 50u; ++i)
      controlled.process();
    CHECK(std::abs(energy(controlled) / unfiltered - std::pow(10.0, -1.2)) < .001);
  }
  auto r = region();
  r[EQ1Gain] = -12;
  Player frequency({r}, false, false, {{EQ1FrequencyCC * 512u + 1u, 1450.0F}}, true);
  CHECK(frequency.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  for (auto i = 0u; i < 50u; ++i)
    frequency.process();
  CHECK(energy(frequency) / unfiltered > .95);
  CHECK(frequency.events({event(0, 0xb0, 1, 127)}) == ET_OK);
  for (auto i = 0u; i < 50u; ++i)
    frequency.process();
  CHECK(std::abs(energy(frequency) / unfiltered - std::pow(10.0, -1.2)) < .001);
  r[EQ1Frequency] = 1000;
  r[EQ1Bandwidth] = .1F;
  Player bandwidth({r}, false, false, {{EQ1BandwidthCC * 512u + 1u, 2.0F}}, true);
  CHECK(bandwidth.events({event(0, 0x90, 60, 127, 1)}) == ET_OK);
  for (auto i = 0u; i < 50u; ++i)
    bandwidth.process();
  const auto narrow = energy(bandwidth);
  CHECK(bandwidth.events({event(0, 0xb0, 1, 127)}) == ET_OK);
  for (auto i = 0u; i < 50u; ++i)
    bandwidth.process();
  CHECK(energy(bandwidth) < narrow * .6);
}
double renderedAmplitude(Player &player, double frequency) {
  for (unsigned block = 0; block < 16; ++block)
    player.process();
  double real = 0, imaginary = 0;
  constexpr auto count = 8192u;
  for (unsigned at = 0; at < count; at += 128) {
    player.process();
    for (unsigned frame = 0; frame < 128; ++frame) {
      const auto phase = 6.283185307179586 * frequency * (at + frame) / player.sampleRate;
      real += player.audio[frame] * std::cos(phase);
      imaginary += player.audio[frame] * std::sin(phase);
    }
  }
  return 2 * std::hypot(real, imaginary) / count;
}
void resamplingImages() {
  for (const auto controlled : {false, true}) {
    for (const auto octaves : {false, true}) {
      Player player({region()}, false, false, {}, false, {}, 96000);
      const bool loaded =
          octaves ? (controlled ? player.loadCompiled(kV3AAUpOctavesControlledPayload,
                                                      kV3AAUpOctavesControlledFootprint)
                                : player.loadCompiled(kV3AAUpOctavesCachedPayload,
                                                      kV3AAUpOctavesCachedFootprint))
                  : (controlled
                         ? player.loadCompiled(kV3AAUpControlledPayload, kV3AAUpControlledFootprint)
                         : player.loadCompiled(kV3AAUpCachedPayload, kV3AAUpCachedFootprint));
      if (!loaded)
        continue;
      CHECK(player.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
      const auto wanted = renderedAmplitude(player, octaves ? 4500 : 9000);
      const auto image = renderedAmplitude(player, octaves ? 7500 : 15000);
      CHECK(wanted > .249 && wanted < .251);
      CHECK(image < wanted * .0001);
    }
    Player down;
    if (controlled ? down.loadCompiled(kV3AADownControlledPayload, kV3AADownControlledFootprint)
                   : down.loadCompiled(kV3AADownCachedPayload, kV3AADownCachedFootprint)) {
      CHECK(down.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
      CHECK(renderedAmplitude(down, 12000) < .0001);
    }
  }
  Player sf2({region()}, false, false, {}, false, {}, 96000);
  sf2.loadSf2({}, false, true);
  CHECK(sf2.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
  sf2.process();
  CHECK(sf2.events({event(0, 0xb0, 101, 0), event(0, 0xb0, 100, 0), event(0, 0xb0, 6, 12),
                    event(0, 0xe0, 0, 0)},
                   0, 2) == ET_OK);
  const auto wanted = renderedAmplitude(sf2, 9000);
  CHECK(wanted > .001);
  CHECK(renderedAmplitude(sf2, 15000) < wanted * .0001);
}
std::uint16_t mixerU16(const std::uint8_t *data) {
  return static_cast<std::uint16_t>(data[0] | (static_cast<unsigned>(data[1]) << 8u));
}
std::array<std::uint8_t, 584> readMixer(PluginKernel &kernel) {
  std::array<std::uint8_t, 8192> storage{}, output{};
  TelemetryRing ring;
  ring.adopt(storage.data(), static_cast<unsigned>(storage.size()));
  std::uint32_t sequence = 0;
  TelemetryWriter writer(ring, 1u, sequence);
  {
    allocation_guard::Scope guard;
    kernel.writeTelemetry(writer);
  }
  const auto bytes = ring.read(output.data(), static_cast<unsigned>(output.size()), nullptr);
  std::array<std::uint8_t, 584> mixer{};
  bool found = false;
  for (auto offset = 0u; offset + 16u <= bytes;) {
    const auto size = mixerU16(output.data() + offset + 12u);
    if (mixerU16(output.data() + offset) == 35u) {
      CHECK(size == mixer.size() && mixerU16(output.data() + offset + 2u) == 2u);
      std::copy_n(output.data() + offset + 16u, mixer.size(), mixer.data());
      found = true;
    }
    offset += (16u + size + 3u) & ~3u;
  }
  CHECK(found);
  return mixer;
}
float mixerPeak(const std::array<std::uint8_t, 584> &state, unsigned channel) {
  std::uint32_t bits = 0;
  for (auto byte = 0u; byte < 4u; ++byte)
    bits |= static_cast<std::uint32_t>(state[520u + channel * 4u + byte]) << (8u * byte);
  return std::bit_cast<float>(bits);
}
void midiChannelAudioMeters() {
  Player reference, measured;
  for (auto *player : {&reference, &measured}) {
    player->loadSf2({}, false, true);
    player->configure(0, -6, 64, 2);
    CHECK(player->events({event(0, 0xb0, 7, 127), event(0, 0xb0, 11, 127), event(0, 0x90, 60, 100)},
                         0, 2) == ET_OK);
  }
  CHECK(mixerPeak(readMixer(*measured.kernel), 0) == 0);
  {
    allocation_guard::Scope guard;
    CHECK(measured.kernel->setMidiMetering(true) == ET_OK);
  }
  for (auto block = 0u; block < 12u; ++block) {
    reference.process();
    measured.process();
    CHECK(reference.audio == measured.audio);
    CHECK(reference.kernel->midiClock() == measured.kernel->midiClock());
    const auto state = readMixer(*measured.kernel);
    CHECK(mixerPeak(state, 0) == measured.peak());
    for (auto channel = 1u; channel < 16u; ++channel)
      CHECK(mixerPeak(state, channel) == 0);
  }
  // Peak capture covers the complete interval, including a short sound followed
  // by silence. A failed enqueue must not consume it.
  measured.process();
  const auto shortPeak = measured.peak();
  CHECK(shortPeak > 0);
  CHECK(measured.kernel->setMidiChannelMix(0, ET_MIDI_CHANNEL_MUTE) == ET_OK);
  for (auto block = 0u; block < 4u; ++block)
    measured.process();
  CHECK(measured.peak() == 0);
  std::array<std::uint8_t, 256> small{};
  TelemetryRing tooSmall;
  tooSmall.adopt(small.data(), static_cast<unsigned>(small.size()));
  std::uint32_t sequence = 0;
  TelemetryWriter writer(tooSmall, 1, sequence);
  {
    allocation_guard::Scope guard;
    measured.kernel->writeTelemetry(writer);
  }
  CHECK(mixerPeak(readMixer(*measured.kernel), 0) == shortPeak);
  CHECK(mixerPeak(readMixer(*measured.kernel), 0) == 0);
  CHECK(measured.kernel->setMidiChannelMix(0, ET_MIDI_CHANNEL_UNMUTE) == ET_OK);
  CHECK(measured.events({event(13, 0xb0, 10, 0), event(37, 0xb0, 7, 64), event(83, 0xb0, 11, 64)},
                        0, 2) == ET_OK);
  measured.process();
  CHECK(mixerPeak(readMixer(*measured.kernel), 0) == measured.peak());
  CHECK(measured.kernel->setMidiMetering(false) == ET_OK);
  measured.process();
  CHECK(measured.peak() > 0 && mixerPeak(readMixer(*measured.kernel), 0) == 0);
  CHECK(measured.kernel->setMidiMetering(true) == ET_OK);
  CHECK(measured.events({}, ET_MIDI_RESET, 3) == ET_OK);
  CHECK(mixerPeak(readMixer(*measured.kernel), 0) == 0);
  // Sum voices before measuring: opposite samples on one channel cancel. With
  // separate channels the master may cancel while each channel remains audible.
  for (const auto separate : {false, true}) {
    auto a = region(), b = region();
    a[Frames] = b[Frames] = 1024;
    a[End] = a[LoopEnd] = 511;
    b[Offset] = b[LoopStart] = 512;
    if (separate) {
      a[HighChannel] = a[LowChannel] = 1;
      b[HighChannel] = b[LowChannel] = 2;
    }
    Bank bank({a, b});
    std::fill_n(bank.words.end() - 1024, 512, .25F);
    std::fill_n(bank.words.end() - 512, 512, -.25F);
    Player player;
    const auto bytes = std::span<const std::uint8_t>(
        reinterpret_cast<const std::uint8_t *>(bank.words.data()), bank.words.size() * 4u);
    if (!player.loadCompiled(bytes, bank.footprint))
      continue;
    player.configure(0, 0, 64, 2);
    CHECK(player.kernel->setMidiMetering(true) == ET_OK);
    if (separate)
      CHECK(player.events({event(0, 0x90, 60, 100), event(0, 0x91, 60, 100)}, 0, 2) == ET_OK);
    else
      CHECK(player.events({event(0, 0x90, 60, 100)}, 0, 2) == ET_OK);
    player.process();
    const auto state = readMixer(*player.kernel);
    CHECK(mixerU16(state.data()) == 2);
    CHECK(player.peak() == 0);
    CHECK(separate ? mixerPeak(state, 0) > 0 && mixerPeak(state, 1) > 0 : mixerPeak(state, 0) == 0);
  }
}
void midiHeldKeyTelemetry() {
  const auto held = [](Player &player, unsigned key) {
    const auto state = readMixer(*player.kernel);
    return (state[8u + 16u + key / 8u] & (1u << (key % 8u))) != 0;
  };
  Player player;
  player.configure(0, 0, 1);
  CHECK(player.events({event(0, 0x90, 60, 127), event(32, 0x90, 61, 127)}) == ET_OK);
  player.process();
  CHECK(held(player, 60) && held(player, 61)); // Stealing a voice does not release its input key.
  CHECK(player.events({event(0, 0x80, 60, 0), event(0, 0xb0, 64, 127), event(13, 0x80, 61, 0)}) ==
        ET_OK);
  player.process();
  CHECK(!held(player, 60) && !held(player, 61));
  CHECK(mixerU16(readMixer(*player.kernel).data() + 8u + 12u) == 1u);
  CHECK(player.events({event(0, 0x90, 62, 127), event(0, 0x90, 62, 127), event(17, 0x90, 62, 0)}) ==
        ET_OK);
  player.process();
  CHECK(held(player, 62)); // One release leaves the second input note held.
  CHECK(player.events({event(0, 0xb0, 123, 0)}) == ET_OK);
  player.process();
  CHECK(!held(player, 62));
  CHECK(player.events({event(0, 0x90, 62, 127)}) == ET_OK);
  player.process();
  CHECK(player.events({}, ET_MIDI_PAUSE, 2) == ET_OK);
  std::vector<std::uint8_t> checkpoint(player.kernel->midiCheckpointSize());
  CHECK(player.kernel->writeMidiCheckpoint(checkpoint.data(),
                                           static_cast<unsigned>(checkpoint.size())) == ET_OK);
  CHECK(player.events({}, ET_MIDI_RESET, 3) == ET_OK);
  CHECK(!held(player, 62));
  CHECK(player.kernel->readMidiCheckpoint(checkpoint.data(),
                                          static_cast<unsigned>(checkpoint.size())) == ET_OK);
  CHECK(held(player, 62));
  CHECK(player.events({}, ET_MIDI_RESET, 4) == ET_OK);
  CHECK(!held(player, 62));
  auto unmatched = region();
  unmatched[LowKey] = unmatched[HighKey] = 60;
  Player silent({unmatched});
  CHECK(silent.events({event(0, 0x90, 72, 127)}) == ET_OK);
  silent.process();
  CHECK(mixerU16(readMixer(*silent.kernel).data()) == 0u && held(silent, 72));
  CHECK(silent.events({}, ET_MIDI_RESET, 2) == ET_OK);
  CHECK(!held(silent, 72));
}
void previewVoiceOwnership() {
  const auto voices = [](Player &player, unsigned channel) {
    return mixerU16(readMixer(*player.kernel).data() + 8u + channel * 32u + 12u);
  };
  const auto sounding = [&](Player &player, unsigned channel) {
    return player.peak() > .01F && voices(player, channel) == 1u;
  };
  const auto silent = [&](Player &player, unsigned channel) {
    for (auto block = 0; block < 3; ++block)
      player.process();
    return player.peak() == 0 && voices(player, channel) == 0u;
  };
  const auto resume = [](Player &player, unsigned generation) {
    const auto clock = static_cast<unsigned>(player.kernel->midiClock());
    CHECK(player.events({}, ET_MIDI_RESUME, generation) == ET_OK);
    CHECK(player.events({{0, 0, 0, ET_MIDI_RESUME, clock, 0}}, 0, generation) == ET_OK);
  };
  Player player({region()}, false, false, {}, false, {}, 48000u, 1u, false);
  CHECK(player.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  CHECK(silent(player, 0));
  player.configure(0, 0, 64, 0, true, 60, 3);
  player.process();
  CHECK(sounding(player, 3) && voices(player, 0) == 0u);
  const auto state = readMixer(*player.kernel);
  CHECK((state[8u + 3u * 32u + 16u + 60u / 8u] & (1u << (60u % 8u))) == 0); // Not an input key.
  // Song note-offs and bulk releases on the preview channel leave the preview voice alone.
  CHECK(player.events({event(0, 0x83, 60, 0), event(0, 0xb3, 123, 0), event(0, 0xb3, 120, 0)}) ==
        ET_OK);
  player.process();
  player.process();
  CHECK(sounding(player, 3));
  // A held preview sounds through pause and resume.
  CHECK(player.events({}, ET_MIDI_PAUSE, 2) == ET_OK);
  player.process();
  CHECK(sounding(player, 3));
  resume(player, 3);
  // The resume marker clears the voices inside the block, so the preview reattacks in the next one.
  player.process();
  player.process();
  CHECK(sounding(player, 3));
  // Releasing it while paused stays silent after resume.
  CHECK(player.events({}, ET_MIDI_PAUSE, 4) == ET_OK);
  player.configure(0, 0, 64, 0, true, -1, 3);
  CHECK(silent(player, 3));
  resume(player, 5);
  CHECK(silent(player, 3));
  // Moving to another key is a note-off, so the previous note's release overlaps the new one.
  player.configure(0, 0, 64, 0, true, 60, 5);
  player.process();
  CHECK(sounding(player, 5));
  player.configure(0, 0, 64, 0, true, 64, 5);
  player.process();
  CHECK(voices(player, 5) == 2u);
  player.process();
  player.process();
  CHECK(sounding(player, 5));
  // Moving the preview to another channel releases the previous voice.
  player.configure(0, 0, 64, 0, true, 64, 7);
  for (auto block = 0; block < 3; ++block)
    player.process();
  CHECK(sounding(player, 7) && voices(player, 5) == 0u);
  // A checkpoint restore reattacks a held preview, and releasing it is final.
  CHECK(player.events({}, ET_MIDI_PAUSE, 6) == ET_OK);
  std::vector<std::uint8_t> checkpoint(player.kernel->midiCheckpointSize());
  CHECK(!checkpoint.empty());
  CHECK(player.kernel->writeMidiCheckpoint(checkpoint.data(),
                                           static_cast<unsigned>(checkpoint.size())) == ET_OK);
  CHECK(player.kernel->readMidiCheckpoint(checkpoint.data(),
                                          static_cast<unsigned>(checkpoint.size())) == ET_OK);
  player.process();
  CHECK(sounding(player, 7));
  player.configure(0, 0, 64, 0, true, -1, 7);
  CHECK(silent(player, 7));
  resume(player, 7);
  CHECK(silent(player, 7));
  // The natural song end does not release the preview either.
  player.configure(0, 0, 64, 0, true, 60, 3);
  player.process();
  CHECK(player.events({}, ET_MIDI_NATURAL_END, 7) == ET_OK);
  player.process();
  player.process();
  CHECK(sounding(player, 3));
  player.configure(0, 0, 64, 0, true, -1, 3);
  CHECK(silent(player, 3));
}
void sf2InitialAndFallbackPresets() {
  Player initial({region()}, false, false, {}, false, {}, 48000u, 0u);
  initial.loadSf2({}, false, false, true, 0u);
  const auto defaults = readMixer(*initial.kernel);
  for (auto channel = 0u; channel < 16u; ++channel) {
    const auto *row = defaults.data() + 8u + channel * 32u;
    CHECK(mixerU16(row) == (channel == 9u ? 128u : 0u));
    CHECK(row[2] == 0u && row[9] == 0u && row[14] == 0u && row[15] == 0u);
    CHECK(row[3] == 100u && row[4] == 64u && row[5] == 127u);
  }
  for (auto block = 0u; block < 32u; ++block)
    initial.process();
  const auto processedDefaults = readMixer(*initial.kernel);
  CHECK(std::equal(defaults.begin() + 8u, defaults.end(), processedDefaults.begin() + 8u));
  CHECK(initial.kernel->midiClock() == 0u && initial.kernel->midiGeneration() == 0u);

  Player implicit, explicitDrum;
  for (auto *player : {&implicit, &explicitDrum})
    player->loadSf2({}, false, false, true, 0u);
  CHECK(implicit.events({event(0u, 0x99u, 72u, 127u)}) == ET_OK);
  CHECK(explicitDrum.events({event(0u, 0xc9u, 0u, 0u), event(0u, 0x99u, 72u, 127u)}) == ET_OK);
  for (auto block = 0u; block < 4u; ++block) {
    implicit.process();
    explicitDrum.process();
    CHECK(implicit.audio == explicitDrum.audio);
  }
  CHECK(implicit.peak() > 0);

  for (auto source = 0u; source < 3u; ++source) {
    Player fromSfz;
    if (source == 2u)
      fromSfz.kernel->clearAsset(0u);
    const auto mode = source == 1u ? static_cast<std::uint32_t>(ET_MIDI_HYDRATE_CHANNEL_STATE) : 0u;
    // Hydration restores the bank latched by the last PC, followed by pending CC0.
    CHECK(fromSfz.events(
              {event(0u, 0xb0u, 0u, 1u), event(0u, 0xc0u, 2u, 0u), event(0u, 0xb0u, 0u, 7u)},
              mode) == ET_OK);
    fromSfz.process();
    fromSfz.loadSf2({}, false, false, true, 0u);
    const auto state = readMixer(*fromSfz.kernel);
    const auto *row = state.data() + 8u;
    CHECK(mixerU16(row) == 1u && row[2] == 2u);
    CHECK(row[9] == 2u && row[14] == 7u);
    CHECK(fromSfz.events({event(0u, 0xc0u, 2u, 0u)}) == ET_OK);
    fromSfz.process();
    CHECK(mixerU16(readMixer(*fromSfz.kernel).data() + 8u) == 0u);
  }

  for (const auto &request : std::array<std::array<unsigned, 5>, 3>{
           {{0u, 77u, 1u, 0u, 1u}, {0u, 77u, 99u, 0u, 0u}, {9u, 77u, 99u, 128u, 0u}}}) {
    Player fallback({region()}, false, false, {}, false, {}, 48000u, 1u, false), explicitPreset;
    for (auto *player : {&fallback, &explicitPreset})
      player->loadSf2({}, false);
    const auto channel = request[0];
    CHECK(fallback.events({event(0u, 0xb0u | channel, 0u, request[1]),
                           event(0u, 0xc0u | channel, request[2], 0u),
                           event(0u, 0x90u | channel, 72u, 127u)},
                          0u, 2u) == ET_OK);
    CHECK(explicitPreset.events(
              {event(0u, 0xb0u | channel, 0u, request[3] == 128u ? 0u : request[3]),
               event(0u, 0xc0u | channel, request[4], 0u), event(0u, 0x90u | channel, 72u, 127u)},
              0u, 2u) == ET_OK);
    for (auto block = 0u; block < 4u; ++block) {
      fallback.process();
      explicitPreset.process();
      CHECK(fallback.audio == explicitPreset.audio);
    }
    CHECK(fallback.peak() > 0);
    // With automatic fallback off, the same missing preset stays silent.
    Player strict;
    strict.loadSf2({}, false);
    strict.configure(0u, 0, 64u, 0u, false);
    CHECK(strict.events({event(0u, 0xb0u | channel, 0u, request[1]),
                         event(0u, 0xc0u | channel, request[2], 0u),
                         event(0u, 0x90u | channel, 72u, 127u)},
                        0u, 2u) == ET_OK);
    for (auto block = 0u; block < 4u; ++block)
      strict.process();
    CHECK(strict.peak() == 0);
  }

  Player edited;
  edited.loadSf2({}, false);
  const auto select = [&](unsigned channel, unsigned bank, unsigned program, unsigned effectiveBank,
                          unsigned effectiveProgram) {
    CHECK(edited.events(
              {event(0u, 0xb0u | channel, 0u, bank), event(0u, 0xc0u | channel, program, 0u)}, 0u,
              2u) == ET_OK);
    edited.process();
    const auto state = readMixer(*edited.kernel);
    const auto *row = state.data() + 8u + channel * 32u;
    CHECK(mixerU16(row) == effectiveBank && row[2] == effectiveProgram);
    CHECK(row[9] == program && row[14] == bank);
  };
  select(0u, 1u, 2u, 1u, 2u);
  select(0u, 77u, 1u, 0u, 1u);
  select(0u, 77u, 99u, 0u, 0u);
  select(9u, 77u, 99u, 128u, 0u);
  select(0u, 77u, 1u, 0u, 1u);
  CHECK(edited.events({event(0u, 0xb0u, 32u, 4u), event(0u, 0xb0u, 7u, 39u),
                       event(0u, 0xb0u, 10u, 42u), event(0u, 0xb0u, 11u, 85u),
                       event(0u, 0xb0u, 91u, 53u), event(0u, 0xb0u, 93u, 29u)},
                      0u, 2u) == ET_OK);
  edited.process();
  CHECK(edited.kernel->setMidiClock(12345u, 2u, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  constexpr std::array<std::array<std::uint32_t, 2>, 4> replacement{
      {{0u, 0u}, {0u, 2u}, {1u, 3u}, {128u, 0u}}};
  edited.loadSf2({}, false, false, true, 0u, 128u, 8u, 1200.0F, replacement);
  const auto replaced = readMixer(*edited.kernel);
  const auto *row = replaced.data() + 8u;
  CHECK(mixerU16(row) == 0u && row[2] == 0u && row[9] == 1u && row[14] == 77u && row[15] == 4u);
  CHECK(row[3] == 39u && row[4] == 42u && row[5] == 85u && row[6] == 53u && row[7] == 29u);
  CHECK(edited.kernel->midiClock() == 12345u && edited.kernel->midiGeneration() == 2u);
  edited.loadSf2({}, false, false, true, 0u);
  CHECK(readMixer(*edited.kernel)[8u + 2u] == 1u);
  CHECK(edited.kernel->midiClock() == 12345u);

  constexpr std::array<std::array<std::uint32_t, 2>, 4> unrelated{
      {{2u, 0u}, {2u, 1u}, {3u, 2u}, {128u, 3u}}};
  edited.loadSf2({}, false, false, true, 0u, 128u, 8u, 1200.0F, unrelated);
  const auto absent = readMixer(*edited.kernel);
  CHECK(mixerU16(absent.data() + 8u) == 0xffffu);
  CHECK(mixerU16(absent.data() + 8u + 9u * 32u) == 0xffffu);
}
void sf2UnchangedFilterEvent() {
  Player reference, edited;
  for (auto *player : {&reference, &edited}) {
    player->loadSf2(
        {{8u, 5000.0F}, {11u, 2400.0F}, {26u, -32768.0F}, {27u, -32768.0F}, {29u, 0.0F}}, false);
    CHECK(player->events({event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
    for (auto block = 0u; block < 12u; ++block)
      player->process();
  }
  CHECK(reference.audio == edited.audio);
  CHECK(edited.events({event(13, 0xb0, 119, 0)}, 0, 2) == ET_OK);
  for (auto block = 0u; block < 4u; ++block) {
    reference.process();
    edited.process();
    CHECK(reference.audio == edited.audio);
  }
  // A real cutoff controller applies the full current modulation immediately,
  // rather than briefly removing the envelope's two-octave contribution.
  for (const auto zeroDepth : {false, true}) {
    Player controlled;
    controlled.loadSf2({{8u, 5000.0F},
                        {11u, 2400.0F},
                        {25u, -32768.0F},
                        {26u, -32768.0F},
                        {27u, -32768.0F},
                        {28u, -32768.0F},
                        {29u, 0.0F}},
                       false, false, true, 2, 74, zeroDepth ? 11u : 8u,
                       zeroDepth ? -2400.0F : 1200.0F);
    CHECK(controlled.events({event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
    sf2::Lowpass expected;
    expected.configure(48000, sf2::frequency(5000) * 4, 0);
    for (auto block = 0u; block < 40u; ++block) {
      controlled.process();
      for (auto frame = 0u; frame < 128u; ++frame)
        expected.process(.25F, 0);
    }
    const auto gain = controlled.audio[127] / expected.process(.25F, 0);
    CHECK(controlled.events({event(13, 0xb0, 74, 127)}, 0, 2) == ET_OK);
    controlled.process();
    for (auto frame = 0u; frame < 128u; ++frame) {
      if (frame == 13u)
        expected.configure(48000, zeroDepth ? sf2::frequency(5000) : sf2::frequency(6200) * 4, 0);
      const auto value = expected.process(.25F, 0) * gain;
      CHECK(std::abs(controlled.audio[frame] - value) < .00001F);
    }
  }
}
void systemResetAndDemandPreparation() {
  Player noHeads;
  noHeads.loadSf2({}, false, false, false);
  CHECK(noHeads.kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
  Player idle({region()}, false, false, {}, false, {}, 48000, 0);
  idle.loadSf2({}, false, false, false, 0);
  idle.process();
  CHECK(idle.kernel->midiGeneration() == 0u && idle.kernel->midiClock() == 0u);
  CHECK(idle.events({event(0u, 0xb0, 7, 98)}, ET_MIDI_CONTROL_ONLY, 0) == ET_OK);
  CHECK(readMixer(*idle.kernel)[8u + 3u] == 98u);
  for (const auto kind : {ET_MIDI_SYSTEM_GM, ET_MIDI_SYSTEM_GS, ET_MIDI_SYSTEM_XG}) {
    Player p;
    p.loadSf2({{38u, 0.0F}}, false);
    CHECK(p.kernel->setMidiChannelMix(0u, ET_MIDI_CHANNEL_MUTE) == ET_OK);
    CHECK(p.kernel->setMidiChannelMix(1u, ET_MIDI_CHANNEL_SOLO) == ET_OK);
    const auto before = p.kernel->midiClock();
    const et_midi_event reset{64u, 0u, static_cast<std::uint32_t>(kind), ET_MIDI_SYSTEM_RESET,
                              0u,  0u};
    CHECK(p.events({event(0u, 0xb0, 7, 20), event(0u, 0x90, 72, 127, 1), reset,
                    event(64u, 0xb0, 7, 127), event(64u, 0xc0, 1, 0), event(64u, 0x90, 72, 127, 2)},
                   0, 2) == ET_OK);
    p.process();
    CHECK(p.kernel->midiClock() == before + 128u && p.kernel->midiGeneration() == 2u);
    const auto state = readMixer(*p.kernel);
    CHECK(mixerU16(state.data()) == 1u && state[8u + 8u] == 0u);
    CHECK(state[8u + 2u] == 1u && state[8u + 3u] == 127u);
    CHECK(mixerU16(state.data() + 8u + 9u * 32u) == 128u);
    CHECK(std::all_of(p.audio.begin(), p.audio.begin() + 64u, [](float x) { return x == 0; }));
    CHECK(
        std::any_of(p.audio.begin() + 64u, p.audio.begin() + 128u, [](float x) { return x != 0; }));
    CHECK(p.kernel->setMidiChannelMix(0u, ET_MIDI_CHANNEL_MUTE) == ET_OK);
    const et_midi_event hydrate{0u, 0u, static_cast<std::uint32_t>(kind), ET_MIDI_SYSTEM_RESET,
                                0u, 0u};
    const auto current = p.kernel->midiClock();
    CHECK(p.events({hydrate}, ET_MIDI_HYDRATE_CHANNEL_STATE, 2) == ET_OK);
    const auto hydrated = readMixer(*p.kernel);
    CHECK(mixerU16(hydrated.data()) == 1u && hydrated[8u + 8u] == 1u);
    CHECK(hydrated[8u + 3u] == 100u && hydrated[8u + 9u] == 0u);
    CHECK(p.kernel->midiClock() == current);
    CHECK(p.kernel->prefetchSampleEvents(&hydrate, 1u, 2u, 128u, 1u) == ET_OK);
    CHECK(p.kernel->prefetchSampleEvents(nullptr, 0u, 2u, 128u, 2u) == ET_OK);
    auto invalid = hydrate;
    invalid.note_id = 4u;
    CHECK(p.events({invalid}, 0, 2) == ET_ERR_ARGS);
  }
}
void percussionDesignation() {
  const auto mode = [](unsigned channel, unsigned value, unsigned offset = 0u) {
    return et_midi_event{offset, (channel << 8u) | (value << 16u), 0u, ET_MIDI_DRUM_MODE, 0u, 0u};
  };
  Player reference;
  reference.loadSf2({}, false);
  CHECK(reference.events({event(0, 0x99, 72, 127, 1)}, 0, 2) == ET_OK);
  reference.process();
  reference.process();
  const auto drumPeak = reference.peak();
  for (auto channel = 0u; channel < 16u; ++channel)
    for (auto value = 1u; value <= 3u; ++value) {
      Player actual;
      actual.loadSf2({}, false);
      CHECK(actual.events({mode(channel, value, 64), event(64, 0x90u | channel, 72, 127, 1)}, 0,
                          2) == ET_OK);
      actual.process();
      CHECK(std::all_of(actual.audio.begin(), actual.audio.begin() + 64,
                        [](float x) { return x == 0; }));
      CHECK(mixerU16(readMixer(*actual.kernel).data() + 8u + channel * 32u) == 128u);
      actual.process();
      CHECK(std::abs(actual.peak() - drumPeak) < .00001F);
      CHECK(actual.events({event(0, 0xb0u | channel, 120, 0), event(0, 0xb0u | channel, 0, 1),
                           mode(channel, 0), event(0, 0x90u | channel, 72, 127, 2)},
                          0, 2) == ET_OK);
      actual.process();
      actual.process();
      // A pending bank select remains pending when returning to melodic mode.
      CHECK(mixerU16(readMixer(*actual.kernel).data() + 8u + channel * 32u) == 0u);
      CHECK(std::abs(actual.peak() / drumPeak - std::pow(10.0F, .8F)) < .001F);
    }
  const std::array<std::array<std::uint32_t, 2>, 4> presets{{{0, 0}, {0, 1}, {128, 1}, {128, 0}}};
  Player kit;
  kit.loadSf2({}, false, false, true, 2, 128, 8, 1200, presets);
  CHECK(kit.events({mode(2, 2), event(0, 0xc2, 1, 0)}, ET_MIDI_HYDRATE_CHANNEL_STATE, 2) == ET_OK);
  CHECK(kit.events({event(0, 0x92, 72, 127, 1)}, 0, 2) == ET_OK);
  kit.process();
  kit.process();
  CHECK(std::abs(kit.peak() / drumPeak - std::pow(10.0F, .6F)) < .001F);
  CHECK(kit.events({}, ET_MIDI_PAUSE, 2) == ET_OK);
  std::vector<std::uint8_t> checkpoint(kit.kernel->midiCheckpointSize());
  CHECK(!checkpoint.empty());
  CHECK(kit.kernel->writeMidiCheckpoint(checkpoint.data(),
                                        static_cast<unsigned>(checkpoint.size())) == ET_OK);
  CHECK(kit.events({mode(2, 0)}, ET_MIDI_HYDRATE_CHANNEL_STATE, 2) == ET_OK);
  CHECK(mixerU16(readMixer(*kit.kernel).data() + 8u + 2u * 32u) == 0u);
  CHECK(kit.kernel->readMidiCheckpoint(checkpoint.data(),
                                       static_cast<unsigned>(checkpoint.size())) == ET_OK);
  CHECK(mixerU16(readMixer(*kit.kernel).data() + 8u + 2u * 32u) == 128u);
  CHECK(kit.kernel->prefetchSampleEvents(nullptr, 0, 2, 128, 1) == ET_OK);
  const auto designation = mode(2, 3);
  CHECK(kit.kernel->prefetchSampleEvents(&designation, 1, 2, 128, 0) == ET_OK);
  CHECK(kit.kernel->prefetchSampleEvents(nullptr, 0, 2, 128, 2) == ET_OK);
  CHECK(kit.events({{0, 0, ET_MIDI_SYSTEM_GS, ET_MIDI_SYSTEM_RESET, 0, 0}}, 0, 2) == ET_OK);
  kit.process();
  CHECK(mixerU16(readMixer(*kit.kernel).data() + 8u + 2u * 32u) == 0u);
  auto invalid = designation;
  invalid.message |= 4u << 16u;
  CHECK(kit.events({invalid}, 0, 2) == ET_ERR_ARGS);
}
void transientChannelMixer() {
  Player reference, mixed;
  for (auto *p : {&reference, &mixed}) {
    p->loadSf2({{38u, 0.0F}}, false);
    CHECK(p->events({event(0, 0xb0, 7, 127), event(0, 0x90, 72, 127, 1)}, 0, 2) == ET_OK);
    p->process();
    p->process();
  }
  CHECK(mixed.peak() > .001F);
  CHECK(mixed.kernel->setMidiChannelMix(0u, ET_MIDI_CHANNEL_MUTE) == ET_OK);
  CHECK(mixed.kernel->setMidiChannelMix(0x10000u, 0u) == ET_ERR_ARGS);
  CHECK(mixed.kernel->setMidiChannelMix(0u, 4u) == ET_ERR_ARGS);
  for (auto block = 0u; block < 4u; ++block) {
    reference.process();
    mixed.process();
    CHECK(mixed.peak() == 0);
  }
  CHECK(mixed.kernel->midiClock() == reference.kernel->midiClock());
  auto state = readMixer(*mixed.kernel);
  CHECK(state[8u + 8u] == 1u);
  CHECK(mixerU16(state.data()) == 1u);
  CHECK(state[8u + 16u + 72u / 8u] & (1u << (72u % 8u)));
  CHECK(mixed.kernel->setMidiChannelMix(0u, ET_MIDI_CHANNEL_UNMUTE) == ET_OK);
  reference.process();
  mixed.process();
  CHECK(mixed.audio == reference.audio);
  CHECK(mixed.kernel->setMidiChannelMix(1u, ET_MIDI_CHANNEL_SOLO) == ET_OK);
  mixed.process();
  CHECK(mixed.peak() == 0);
  CHECK(mixed.events({event(0, 0xb0, 0, 1), event(0, 0xc0, 2, 0), event(0, 0xb0, 7, 99),
                      event(0, 0xb0, 10, 23), event(0, 0xb0, 11, 88), event(0, 0xb0, 91, 37),
                      event(0, 0xb0, 93, 49), event(0, 0x80, 72, 0, 1)},
                     0, 2) == ET_OK);
  mixed.process();
  state = readMixer(*mixed.kernel);
  const auto *row = state.data() + 8u;
  CHECK(mixerU16(row) == 1u && row[2] == 2u && row[9] == 2u && row[14] == 1u);
  CHECK(row[3] == 99u && row[4] == 23u && row[5] == 88u && row[6] == 37u && row[7] == 49u);
  CHECK(mixerU16(row + 12u) == 1u); // Release tails remain active voices.
  CHECK(state[8u + 32u + 8u] == 2u);
  CHECK(mixed.events({}, ET_MIDI_RESET, 3) == ET_OK);
  state = readMixer(*mixed.kernel);
  CHECK(state[8u + 8u] == 0 && state[8u + 32u + 8u] == 0);
  CHECK(mixed.events({event(64u, 0xb0, 7, 40)}, 0, 3) == ET_OK);
  CHECK(mixed.events({event(0u, 0xb0, 7, 100)}, ET_MIDI_CONTROL_ONLY, 3) == ET_OK);
  state = readMixer(*mixed.kernel);
  CHECK(state[8u + 3u] == 100u);
  mixed.process(); // The queued file event is preserved and remains authoritative.
  state = readMixer(*mixed.kernel);
  CHECK(state[8u + 3u] == 40u);
  CHECK(mixed.events({}, ET_MIDI_PAUSE, 3) == ET_OK);
  const auto pausedClock = mixed.kernel->midiClock();
  CHECK(mixed.events({event(0u, 0xb0, 10, 17), event(0u, 0xc0, 0, 0)}, ET_MIDI_CONTROL_ONLY, 3) ==
        ET_OK);
  CHECK(mixed.events({event(0u, 0x90, 60, 127)}, ET_MIDI_CONTROL_ONLY, 3) == ET_ERR_ARGS);
  CHECK(mixed.events({event(0u, 0xb0, 64, 127)}, ET_MIDI_CONTROL_ONLY, 3) == ET_ERR_ARGS);
  CHECK(mixed.kernel->midiClock() == pausedClock);
  state = readMixer(*mixed.kernel);
  CHECK(state[8u + 4u] == 17u && state[8u + 9u] == 0u);
  std::vector<std::uint8_t> edited(mixed.kernel->midiCheckpointSize());
  CHECK(!edited.empty());
  CHECK(mixed.kernel->writeMidiCheckpoint(edited.data(), static_cast<unsigned>(edited.size())) ==
        ET_OK);
}
void partialSampleWindows() {
  for (const auto channels : {1u, 2u}) {
    const SampleMetadata metadata{2u * SamplePageCache::kPageFrames, channels, 48000u};
    SamplePageCache cache;
    CHECK(cache.configure(93u, &metadata, 1u, 2u));
    std::array<float, 2u * SamplePageCache::kPageFrames> pcm;
    pcm.fill(.25F);
    std::array<float, 4> window;
    window.fill(-1.0F);
    allocation_guard::Scope guard;
    CHECK(cache.publish({93u, 0u, 0u}, pcm.data(), SamplePageCache::kPageFrames, channels));
    bool allMissing = true;
    CHECK(cache.readWindow(0u, SamplePageCache::kPageFrames - 2u, 4u, channels - 1u, window.data(),
                           nullptr, &allMissing) == SampleReadStatus::Unavailable);
    CHECK(!allMissing && window[0] == .25F && window[1] == .25F && window[2] == 0 &&
          window[3] == 0);
    window.fill(-1.0F);
    CHECK(cache.readWindow(0u, SamplePageCache::kPageFrames + 2u, 4u, channels - 1u, window.data(),
                           nullptr, &allMissing) == SampleReadStatus::Unavailable);
    CHECK(allMissing && std::all_of(window.begin(), window.end(), [](float x) { return x == 0; }));
    SamplePageRequest request;
    CHECK(cache.takeRequests(&request, 1u) == 1u && request.page == 1u);
    for (auto repeat = 0u; repeat < 128u; ++repeat) {
      CHECK(cache.readWindow(0u, SamplePageCache::kPageFrames + 2u, 4u, channels - 1u,
                             window.data(), nullptr, &allMissing) == SampleReadStatus::Unavailable);
      SamplePageRequest duplicate;
      CHECK(cache.takeRequests(&duplicate, 1u) == 0u);
    }
    pcm.fill(.5F);
    CHECK(cache.publish(request, pcm.data(), SamplePageCache::kPageFrames, channels));
    CHECK(cache.readWindow(0u, SamplePageCache::kPageFrames - 2u, 4u, channels - 1u, window.data(),
                           nullptr, &allMissing) == SampleReadStatus::Ready);
    CHECK(!allMissing && window[0] == .25F && window[1] == .25F && window[2] == .5F &&
          window[3] == .5F);
  }
}
void sampleRequestOwnership() {
  const SampleMetadata metadata{3u * SamplePageCache::kPageFrames, 1u, 48000u};
  std::array<float, SamplePageCache::kPageFrames> pcm;
  pcm.fill(.25F);
  for (const bool forecast : {false, true}) {
    SamplePageCache cache;
    CHECK(cache.configure(91u, &metadata, 1u, 1u));
    allocation_guard::Scope guard;
    float invalidValue = 0.0F;
    CHECK(cache.readSample(1u, 0u, 0u, invalidValue) == SampleReadStatus::Invalid);
    CHECK(cache.readSample(0u, metadata.frames, 0u, invalidValue) == SampleReadStatus::Invalid);
    CHECK(cache.readSample(0u, 0u, 1u, invalidValue) == SampleReadStatus::Invalid);
    CHECK(cache.readWindow(0u, 0u, 0u, 0u, pcm.data()) == SampleReadStatus::Invalid);
    CHECK(cache.readWindow(0u, metadata.frames - 1u, 2u, 0u, pcm.data()) ==
          SampleReadStatus::Invalid);
    if (forecast)
      cache.beginForecast();
    CHECK(!cache.requestWindow(0u, SamplePageCache::kPageFrames, 1u));
    SamplePageRequest request;
    CHECK(cache.takeRequests(&request, 1u) == 1u);
    if (forecast) {
      cache.cancelForecast();
      cache.beginForecast();
    }
    for (unsigned quantum = 0; quantum < 4u; ++quantum) {
      cache.beginQuantum();
      CHECK(!cache.requestWindow(0u, SamplePageCache::kPageFrames, 1u));
      SamplePageRequest duplicate;
      CHECK(cache.takeRequests(&duplicate, 1u) == 0u);
    }
    CHECK(cache.publish(request, pcm.data(), SamplePageCache::kPageFrames, 1u));
    if (forecast)
      CHECK(cache.commitForecast());
    SamplePageRequest next;
    CHECK(cache.takeRequests(&next, 1u) == 0u);
    float value = 0.0F;
    CHECK(cache.sample(0u, SamplePageCache::kPageFrames, 0u, value) && value == .25F);
    cache.clearForecast();
    cache.beginQuantum();
    CHECK(!cache.requestWindow(0u, 0u, 1u));
    // A known preload also retires queued work, before the host takes it.
    CHECK(cache.publish({91u, 0u, 0u}, pcm.data(), SamplePageCache::kPageFrames, 1u));
    CHECK(cache.takeRequests(&next, 1u) == 0u);
    // Eviction is a real miss even when the same identity was published earlier.
    CHECK(!cache.sample(0u, SamplePageCache::kPageFrames, 0u, value));
    CHECK(cache.takeRequests(&next, 1u) == 1u);
    CHECK(next.sample == 0u && next.page == 1u && !cache.requestOverflow());
  }
  SamplePageCache full;
  const SampleMetadata large{(SamplePageCache::kMaxRequests + 1u) * SamplePageCache::kPageFrames,
                             1u, 48000u};
  CHECK(full.configure(92u, &large, 1u, 1u));
  allocation_guard::Scope guard;
  CHECK(!full.requestWindow(0u, 0u, SamplePageCache::kMaxRequests * SamplePageCache::kPageFrames));
  float value = 0.0F;
  CHECK(full.readSample(0u, SamplePageCache::kMaxRequests * SamplePageCache::kPageFrames, 0u,
                        value) == SampleReadStatus::Overflow);
}
// Compare a fully ACKed prediction with a reference that can read the whole source.
// Neither renderer services requests after playback starts, so a missing tail page
// is an audible discrepancy rather than a test-side request count assumption.
void knownForecastReleaseAndReset() {
  const auto verify = [](std::span<const std::uint8_t> fixture,
                         std::vector<et_midi_event> trajectory, unsigned origin, unsigned horizon,
                         unsigned renderFrames) {
    Player predicted, complete;
    std::array<float, 4096> page;
    page.fill(.25F);
    for (auto *player : {&predicted, &complete}) {
      const auto bytes = static_cast<unsigned>(fixture.size());
      AssetBeginInfo info{1u, (bytes - 32u) / 4u, 0u, 0u, 1u, 0u, 0u, 2u, bytes, bytes};
      CHECK(test::addSamplePlayerFixtureStorage(info, fixture, {48000, 2, 128},
                                                ET_SAMPLE_PLAYER_MAIN) == ET_OK);
      auto *target = player->kernel->beginAsset(0u, info);
      CHECK(target);
      if (!target)
        return;
      std::memcpy(target, fixture.data(), bytes);
      CHECK(player->kernel->commitAsset(0u, bytes, ET_ASSET_F32_MULTICH) == ET_OK);
      CHECK(player->kernel->configureSampleStream(29u) == ET_OK);
      CHECK(player->events({}, ET_MIDI_RESET, 2u) == ET_OK);
      CHECK(player->kernel->setMidiClock(0u, 2u, ET_MIDI_CLOCK_RUNNING) == ET_OK);
      if (origin || player == &complete)
        for (auto index = 0u; index < (origin == 3u ? 3u : player == &complete ? 4u : 1u); ++index)
          CHECK(player->kernel->publishSamplePage(29u, 0u, index, page.data(), 4096u, 1u, 0u) ==
                ET_OK);
      if (origin) {
        CHECK(player->events({event(0u, 0xb0u, 7u, 127u), event(0u, 0x90u, 60u, 127u, 1u)}, 0u,
                             2u) == ET_OK);
        for (auto block = 0u; block < (origin == 3u ? 110u : 1u); ++block)
          player->process();
        if (origin >= 2u)
          CHECK(player->events({}, ET_MIDI_PAUSE, 2u) == ET_OK);
        if (origin == 3u) {
          // Retire the sounding pool, then evict the attack while the paused copy
          // retains a source position in page2.
          for (auto block = 0u; block < 4u; ++block)
            player->process();
          for (auto index = 4u; index < 8u; ++index)
            CHECK(player->kernel->publishSamplePage(29u, 0u, index, page.data(), 4096u, 1u, 0u) ==
                  ET_OK);
          player->process();
        }
      }
    }
    const auto mixer = readMixer(*predicted.kernel);
    const auto clock = predicted.kernel->midiClock();
    const auto midiState = predicted.kernel->midiState();
    std::vector<std::uint8_t> checkpoint(predicted.kernel->midiCheckpointSize());
    if (!checkpoint.empty())
      CHECK(predicted.kernel->writeMidiCheckpoint(
                checkpoint.data(), static_cast<unsigned>(checkpoint.size())) == ET_OK);
    CHECK(predicted.kernel->prefetchSampleEvents(trajectory.data(),
                                                 static_cast<unsigned>(trajectory.size()), 2u,
                                                 horizon, 5u) == ET_OK);
    auto status = predicted.kernel->prefetchSampleEvents(nullptr, 0u, 2u, horizon, 6u);
    for (auto attempt = 0u; status == ET_NEED_SAMPLE && attempt < 4u; ++attempt) {
      std::array<et_sfz_sample_request, 8> requests{};
      unsigned count = 0;
      CHECK(predicted.kernel->takeSampleRequests(requests.data(), 8u, count) == ET_OK && count);
      for (auto index = 0u; index < count; ++index) {
        const auto &request = requests[index];
        CHECK(request.generation_low == 29u && request.generation_high == 0u &&
              request.sample == 0u && request.page_high == 0u && request.page_low < 4u);
        CHECK(predicted.kernel->publishSamplePage(29u, 0u, request.page_low, page.data(), 4096u, 1u,
                                                  0u) == ET_OK);
      }
      status = predicted.kernel->prefetchSampleEvents(nullptr, 0u, 2u, horizon, 6u);
    }
    CHECK(status == ET_OK);
    et_stream_readiness ready{};
    CHECK(predicted.kernel->sampleStreamReadiness(ready) == ET_OK &&
          ready.scope == ET_STREAM_SCOPE_KNOWN_MIDI && ready.ready_ahead_frames == horizon &&
          ready.pending_pages == 0u && ready.planned_pages >= 2u);
    CHECK(readMixer(*predicted.kernel) == mixer && predicted.kernel->midiClock() == clock &&
          predicted.kernel->midiState() == midiState);
    if (!checkpoint.empty()) {
      std::vector<std::uint8_t> after(checkpoint.size());
      CHECK(predicted.kernel->writeMidiCheckpoint(after.data(),
                                                  static_cast<unsigned>(after.size())) == ET_OK);
      CHECK(after == checkpoint);
    }
    if (origin == 3u)
      for (auto index = 0u; index < 3u; ++index)
        CHECK(complete.kernel->publishSamplePage(29u, 0u, index, page.data(), 4096u, 1u, 0u) ==
              ET_OK);
    if (origin >= 2u) {
      for (auto *player : {&predicted, &complete})
        CHECK(player->events({}, ET_MIDI_RESUME, 2u) == ET_OK);
      trajectory.insert(trajectory.begin(),
                        {0u, 0u, 0u, ET_MIDI_RESUME, static_cast<unsigned>(clock), 0u});
    }
    double tailEnergy = 0;
    for (auto at = 0u; at < renderFrames; at += 128u) {
      std::array<et_midi_event, 12> block{};
      unsigned count = 0;
      for (auto entry : trajectory)
        if (entry.offset_frames >= at && entry.offset_frames < at + 128u) {
          entry.offset_frames -= at;
          block[count++] = entry;
        }
      for (auto *player : {&predicted, &complete}) {
        CHECK(player->kernel->setMidiEvents(block.data(), count, 2u, 0u) == ET_OK);
        player->process();
      }
      CHECK(predicted.audio == complete.audio);
      if (at + 512u >= renderFrames)
        for (const auto sample : complete.audio)
          tailEnergy += sample * sample;
    }
    CHECK(tailEnergy > .000001);
    CHECK(predicted.kernel->midiClock() == complete.kernel->midiClock());
    CHECK(readMixer(*predicted.kernel) == readMixer(*complete.kernel));
    CHECK((predicted.kernel->assetState(0u) & 255u) == ET_ASSET_STATE_ACTIVE);
  };
  // New births and already sounding/paused voices all need the nonloop continuation.
  for (const auto origin : {0u, 1u, 2u}) {
    std::vector<et_midi_event> notes;
    if (!origin)
      notes = {event(0u, 0xb0u, 7u, 127u), event(0u, 0x90u, 60u, 127u, 1u)};
    notes.push_back(event(128u, 0x80u, 60u, 0u, 1u));
    verify(kSf2ForecastReleaseFixture, notes, origin, 12000u, 6400u);
  }
  for (const auto release : {0u, 1u, 2u, 3u, 4u}) {
    std::vector<et_midi_event> notes{event(0u, 0xb0u, 7u, 127u), event(0u, 0x90u, 60u, 127u, 1u)};
    if (release == 0u)
      notes.push_back(event(128u, 0x90u, 60u, 0u, 1u));
    else if (release <= 2u) {
      const auto pedal = release == 1u ? 64u : 66u;
      notes.push_back(event(64u, 0xb0u, pedal, 127u));
      notes.push_back(event(128u, 0x80u, 60u, 0u, 1u));
      notes.push_back(event(256u, 0xb0u, pedal, 0u));
    } else if (release == 3u)
      notes.push_back(event(128u, 0xb0u, 123u, 0u));
    else {
      notes.push_back(event(64u, 0xb0u, 64u, 127u));
      notes.push_back(event(128u, 0x80u, 60u, 0u, 1u));
      notes.push_back(event(256u, 0xb0u, 121u, 0u));
    }
    verify(kSf2ForecastReleaseFixture, notes, 0u, 12000u, 6400u);
  }
  // Paused reattack must admit its evicted onset, not just its old loop page.
  verify(kSf2ForecastPausedFixture, {}, 3u, 12000u, 1024u);
  // A short onset still reads FIR guards wrapped from the retained loop state.
  verify(kSf2ForecastPausedFixture, {}, 3u, 1024u, 1024u);
  // A reset changes effective pitch inputs even though the incoming CC is 121.
  for (const bool custom : {false, true}) {
    std::vector<et_midi_event> notes{event(0u, 0xe0u, 0u, 0u), event(0u, 0xb0u, 1u, 127u),
                                     event(0u, 0xb0u, 7u, 127u), event(0u, 0x90u, 60u, 127u, 1u),
                                     event(128u, 0xb0u, 121u, 0u)};
    verify(custom ? std::span<const std::uint8_t>(kSf2ForecastResetCcFixture)
                  : std::span<const std::uint8_t>(kSf2ForecastResetFixture),
           notes, 0u, 4500u, 4480u);
  }
}
void selectedPresetPrefixGeometry() {
  Player player;
  const auto bytes = static_cast<std::uint32_t>(kSf2ForecastPrefixFixture.size());
  AssetBeginInfo info{1u, (bytes - 32u) / 4u, 0u, 0u, 1u, 0u, 0u, 2u, bytes, bytes};
  CHECK(test::addSamplePlayerFixtureStorage(info, kSf2ForecastPrefixFixture, {48000, 2, 128},
                                            ET_SAMPLE_PLAYER_MAIN) == ET_OK);
  auto *destination = player.kernel->beginAsset(0u, info);
  CHECK(destination);
  if (!destination)
    return;
  std::memcpy(destination, kSf2ForecastPrefixFixture.data(), bytes);
  CHECK(player.kernel->commitAsset(0u, bytes, ET_ASSET_F32_MULTICH) == ET_OK);
  CHECK(player.kernel->configureSampleStream(37u) == ET_OK);
  CHECK(player.events({}, ET_MIDI_RESET, 2u) == ET_OK);
  player.process();

  const auto verify = [&](std::span<const et_midi_event> notes, unsigned flags, unsigned pages,
                          bool pressure = false, bool captureCheckpoint = false) {
    const auto mixer = readMixer(*player.kernel);
    const auto clock = player.kernel->midiClock();
    const auto state = player.kernel->midiState();
    std::vector<std::uint8_t> checkpoint(player.kernel->midiCheckpointSize());
    if (captureCheckpoint) {
      CHECK(!checkpoint.empty());
      CHECK(player.kernel->writeMidiCheckpoint(checkpoint.data(),
                                               static_cast<unsigned>(checkpoint.size())) == ET_OK);
    }
    {
      allocation_guard::Scope guard;
      CHECK(player.kernel->prefetchSampleEvents(notes.data(), static_cast<unsigned>(notes.size()),
                                                2u, 128u, flags) == ET_OK);
    }
    const auto status = player.kernel->prefetchSampleEvents(nullptr, 0u, 2u, 128u, 6u);
    if (pressure) {
      CHECK(status == ET_ERR_OOM);
    } else {
      CHECK(status == ET_NEED_SAMPLE || status == ET_OK);
      et_stream_readiness ready{};
      CHECK(player.kernel->sampleStreamReadiness(ready) == ET_OK);
      CHECK(ready.scope == static_cast<std::uint32_t>(flags & 8u ? ET_STREAM_SCOPE_SELECTED_PRESETS
                                                                 : ET_STREAM_SCOPE_KNOWN_MIDI));
      CHECK(ready.planned_pages == pages);
      std::array<et_sfz_sample_request, 4> requests{};
      unsigned count = 0u;
      CHECK(player.kernel->takeSampleRequests(requests.data(), 4u, count) == ET_OK);
      std::array<float, 4096> pcm;
      pcm.fill(.25F);
      for (auto index = 0u; index < count; ++index) {
        const auto &request = requests[index];
        CHECK(request.generation_low == 37u && request.generation_high == 0u &&
              request.sample == 0u && request.page_high == 0u && request.page_low < pages);
        CHECK(player.kernel->publishSamplePage(37u, 0u, request.page_low, pcm.data(), 4096u, 1u,
                                               0u) == ET_OK);
      }
      CHECK(player.kernel->prefetchSampleEvents(nullptr, 0u, 2u, 128u, 6u) == ET_OK);
      CHECK(player.kernel->sampleStreamReadiness(ready) == ET_OK && ready.pending_pages == 0u &&
            ready.planned_pages == pages);
    }
    CHECK(readMixer(*player.kernel) == mixer && player.kernel->midiClock() == clock &&
          player.kernel->midiState() == state);
    if (captureCheckpoint) {
      std::vector<std::uint8_t> after(checkpoint.size());
      CHECK(player.kernel->writeMidiCheckpoint(after.data(), static_cast<unsigned>(after.size())) ==
            ET_OK);
      CHECK(after == checkpoint);
    }
  };
  // 15 * 274 selected melodic origins share 274 prefix geometries, not 4110 slots.
  verify({}, 13u, 2u);
  // The last melodic channel has the largest step: its pitch must survive dedup.
  CHECK(player.events({event(0u, 0xbeu, 101u, 0u), event(0u, 0xbeu, 100u, 0u),
                       event(0u, 0xbeu, 6u, 12u), event(0u, 0xbeu, 38u, 0u),
                       event(0u, 0xeeu, 127u, 127u)},
                      0u, 2u) == ET_OK);
  player.process();
  verify({}, 13u, 4u);
  CHECK(player.events({event(0u, 0xbeu, 121u, 0u)}, 0u, 2u) == ET_OK);
  player.process();
  std::array<et_midi_event, 15> notes{};
  auto count = 0u;
  for (auto channel = 0u; channel < 16u; ++channel)
    if (channel != 9u)
      notes[count++] = event(0u, 0x90u | channel, 127u, 127u);
  // Known notes retain channel dependencies and real source-capacity pressure.
  verify(notes, 5u, 0u, true);
  verify(std::span<const et_midi_event>(notes.data(), 1u), 5u, 2u);
  CHECK(player.events({}, ET_MIDI_PAUSE, 2u) == ET_OK);
  player.process();
  verify({}, 13u, 2u, false, true);
}
void admittedSampleForecasts() {
  const auto install = [](Player &player, unsigned generation) {
    const auto size = static_cast<unsigned>(kSf2HostFixture.size());
    AssetBeginInfo info{1, (size - 32u) / 4u, 0, 0, 1, 0, 0, 2, size, size};
    CHECK(test::addSamplePlayerFixtureStorage(info, kSf2HostFixture,
                                              {static_cast<float>(player.sampleRate), 2, 128},
                                              ET_SAMPLE_PLAYER_MAIN) == ET_OK);
    auto *target = player.kernel->beginAsset(0, info);
    CHECK(target);
    if (!target)
      return false;
    std::memcpy(target, kSf2HostFixture.data(), size);
    CHECK(player.kernel->commitAsset(0, size, ET_ASSET_F32_MULTICH) == ET_OK);
    CHECK(player.kernel->configureSampleStream(19u) == ET_OK);
    CHECK(player.kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
    if (generation)
      CHECK(player.events({}, ET_MIDI_RESET, generation) == ET_OK);
    player.process();
    return true;
  };
  const auto acknowledge = [](Player &player, bool lastFirst) {
    std::array<et_sfz_sample_request, 8> requests{};
    std::uint32_t count = 0;
    CHECK(player.kernel->takeSampleRequests(requests.data(), 8u, count) == ET_OK);
    if (lastFirst)
      std::reverse(requests.begin(), requests.begin() + count);
    std::array<float, 4096> page;
    page.fill(.25F);
    for (auto i = 0u; i < count; ++i) {
      const auto &request = requests[i];
      const auto generation =
          static_cast<std::uint64_t>(request.generation_high) << 32u | request.generation_low;
      const auto index = static_cast<std::uint64_t>(request.page_high) << 32u | request.page_low;
      CHECK(player.kernel->publishSamplePage(generation, request.sample, index, page.data(), 4096u,
                                             1u, 0u) == ET_OK);
    }
    return count;
  };
  Player plain;
  if (!install(plain, 2u))
    return;
  const et_midi_event late = event(7168u, 0x90u, 60u, 127u);
  CHECK(plain.kernel->prefetchSampleEvents(&late, 1u, 2u, 8192u, 5u) == ET_OK);
  CHECK(plain.kernel->prefetchSampleEvents(nullptr, 0u, 2u, 8192u, 6u) == ET_NEED_SAMPLE);
  et_stream_readiness before{};
  CHECK(plain.kernel->sampleStreamReadiness(before) == ET_OK);
  CHECK(before.scope == ET_STREAM_SCOPE_KNOWN_MIDI && before.planned_pages == 1u &&
        before.pending_pages == 1u && before.ready_ahead_frames == 0u);
  CHECK(acknowledge(plain, false) == 1u);
  CHECK(plain.kernel->prefetchSampleEvents(nullptr, 0u, 2u, 8192u, 6u) == ET_OK);
  plain.process(); // No musical clock is running, but a render block was completed.
  CHECK(plain.kernel->midiClock() == 0u);
  CHECK(plain.kernel->sampleStreamReadiness(before) == ET_OK);
  CHECK(before.ready_ahead_frames == 8192u - 128u && before.pending_pages == 0u);

  Player bent;
  if (!install(bent, 2u))
    return;
  const std::array<et_midi_event, 6> trajectory{late,
                                                event(7296u, 0xb0u, 101u, 0u),
                                                event(7296u, 0xb0u, 100u, 0u),
                                                event(7296u, 0xb0u, 6u, 24u),
                                                event(7296u, 0xb0u, 38u, 0u),
                                                event(7424u, 0xe0u, 127u, 127u)};
  CHECK(bent.kernel->prefetchSampleEvents(trajectory.data(), 6u, 2u, 8192u, 5u) == ET_OK);
  CHECK(bent.kernel->prefetchSampleEvents(nullptr, 0u, 2u, 8192u, 6u) == ET_NEED_SAMPLE);
  et_stream_readiness state{};
  CHECK(bent.kernel->sampleStreamReadiness(state) == ET_OK);
  CHECK(state.planned_pages == 2u && state.pending_pages == 2u && state.ready_ahead_frames == 0u);
  CHECK(acknowledge(bent, true) == 2u);
  CHECK(bent.kernel->prefetchSampleEvents(nullptr, 0u, 2u, 8192u, 6u) == ET_OK);
  CHECK(bent.kernel->sampleStreamReadiness(state) == ET_OK && state.ready_ahead_frames == 8192u);
  CHECK(bent.events({event(0, 0xb0, 7, 100)}, ET_MIDI_CONTROL_ONLY, 2u) == ET_OK);
  CHECK(bent.kernel->sampleStreamReadiness(state) == ET_OK && state.scope == ET_STREAM_SCOPE_NONE);

  Player resetPreview;
  if (!install(resetPreview, 2u))
    return;
  CHECK(resetPreview.events(
            {event(0u, 0xb0u, 0u, 9u), event(0u, 0xc0u, 127u, 0u), event(0u, 0xb0u, 7u, 23u)},
            ET_MIDI_CONTROL_ONLY, 2u) == ET_OK);
  CHECK(resetPreview.kernel->prefetchSampleEvents(&late, 1u, 2u, 8192u, 5u) == ET_OK);
  // The missing requested preset forecasts the available base-bank fallback.
  CHECK(resetPreview.kernel->prefetchSampleEvents(nullptr, 0u, 2u, 8192u, 6u) == ET_NEED_SAMPLE);
  CHECK(resetPreview.kernel->sampleStreamReadiness(state) == ET_OK && state.planned_pages == 1u);
  const et_midi_event reset{512u, 0u, ET_MIDI_SYSTEM_GM, ET_MIDI_SYSTEM_RESET, 0u, 0u};
  const std::array<et_midi_event, 2> resetThenNote{reset, late};
  CHECK(resetPreview.kernel->prefetchSampleEvents(resetThenNote.data(), 2u, 2u, 8192u, 5u) ==
        ET_OK);
  CHECK(resetPreview.kernel->prefetchSampleEvents(nullptr, 0u, 2u, 8192u, 6u) == ET_NEED_SAMPLE);
  CHECK(resetPreview.kernel->sampleStreamReadiness(state) == ET_OK && state.planned_pages == 1u);
  const auto actual = readMixer(*resetPreview.kernel);
  CHECK(actual[8u + 9u] == 127u && actual[8u + 3u] == 23u);
  CHECK(mixerU16(actual.data() + 8u + 10u) == 0u);
  CHECK(acknowledge(resetPreview, false) == 1u);
  CHECK(resetPreview.kernel->prefetchSampleEvents(nullptr, 0u, 2u, 8192u, 6u) == ET_OK);

  Player prefix({region()}, false, false, {}, false, {}, 48000, 0u);
  if (!install(prefix, 0u))
    return;
  CHECK(prefix.kernel->prefetchSampleEvents(nullptr, 0u, 0u, 72000u, 13u) == ET_OK);
  CHECK(prefix.kernel->prefetchSampleEvents(nullptr, 0u, 0u, 72000u, 6u) == ET_NEED_SAMPLE);
  CHECK(acknowledge(prefix, false) > 0u);
  CHECK(prefix.kernel->prefetchSampleEvents(nullptr, 0u, 0u, 72000u, 6u) == ET_OK);
  CHECK(prefix.kernel->sampleStreamReadiness(state) == ET_OK);
  CHECK(state.generation == 0u && state.scope == ET_STREAM_SCOPE_SELECTED_PRESETS &&
        state.pending_pages == 0u && state.ready_ahead_frames == 0u && state.planned_pages <= 2u);
  CHECK(prefix.events({event(0, 0xc0, 1, 0)}, 0u, 0u) == ET_ERR_ARGS);
}
void extendedVoiceCapacity() {
  for (const auto source : {0u, 1u, 2u}) {
    auto r = region();
    r[Polyphony] = r[NotePolyphony] = source == 1u ? 64.0F : 0.0F;
    Player player({r});
    if (source == 2u)
      player.loadSf2({{54u, 1.0F}}, false);
    player.configure(0, -40, 1024, 2);
    std::array<et_midi_event, 1024> notes{};
    for (auto note = 0u; note < notes.size(); ++note)
      notes[note] = event(0, 0x90, 60, 100, note + 1u);
    CHECK(player.kernel->setMidiEvents(notes.data(), static_cast<unsigned>(notes.size()),
                                       source == 2u ? 2u : 1u, 0) == ET_OK);
    for (auto block = 0u; block < 4u; ++block)
      player.process();
    CHECK(mixerU16(readMixer(*player.kernel).data()) == (source == 1u ? 64u : 1024u));
  }
  Player original;
  original.configure(0, -40, 1024);
  CHECK(original.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  std::vector<et_midi_event> notes;
  notes.reserve(1024);
  for (auto channel = 0u; channel < 8u; ++channel)
    for (auto key = 0u; key < 128u; ++key)
      notes.push_back(event(0, 0x90u | channel, key, 100, channel * 128u + key + 1u));
  {
    allocation_guard::Scope guard;
    CHECK(original.kernel->setMidiEvents(notes.data(), 1024, 1, 0) == ET_OK);
  }
  original.process();
  CHECK(mixerU16(readMixer(*original.kernel).data()) == 1024u);
  CHECK(original.kernel->midiClock() == 128u);
  for (const auto value : original.audio)
    CHECK(std::isfinite(value));
  CHECK(original.events({}, ET_MIDI_PAUSE, 2) == ET_OK);
  std::vector<std::uint8_t> checkpoint(original.kernel->midiCheckpointSize());
  CHECK(!checkpoint.empty());
  CHECK(original.kernel->writeMidiCheckpoint(checkpoint.data(),
                                             static_cast<unsigned>(checkpoint.size())) == ET_OK);
  Player restored;
  restored.configure(0, -40, 1024);
  CHECK(restored.kernel->readMidiCheckpoint(checkpoint.data(),
                                            static_cast<unsigned>(checkpoint.size())) == ET_OK);
  Player cappedRestore;
  cappedRestore.configure(0, -40, 64);
  CHECK(cappedRestore.kernel->readMidiCheckpoint(
            checkpoint.data(), static_cast<unsigned>(checkpoint.size())) == ET_OK);
  CHECK(cappedRestore.events({}, ET_MIDI_RESUME, 3) == ET_OK);
  CHECK(cappedRestore.events({{0, 0, 0, ET_MIDI_RESUME, 128, 0}}, 0, 3) == ET_OK);
  cappedRestore.process();
  CHECK(mixerU16(readMixer(*cappedRestore.kernel).data()) == 64u);
  CHECK(original.events({}, ET_MIDI_RESUME, 3) == ET_OK);
  CHECK(restored.events({}, ET_MIDI_RESUME, 3) == ET_OK);
  CHECK(original.events({{0, 0, 0, ET_MIDI_RESUME, 128, 0}}, 0, 3) == ET_OK);
  CHECK(restored.events({{0, 0, 0, ET_MIDI_RESUME, 128, 0}}, 0, 3) == ET_OK);
  original.process();
  restored.process();
  CHECK(original.audio == restored.audio);
  CHECK(mixerU16(readMixer(*restored.kernel).data()) == 1024u);
  restored.configure(0, -40, 64);
  restored.process();
  const auto reduced = readMixer(*restored.kernel);
  CHECK(mixerU16(reduced.data()) == 64u);
  // Lowering polyphony retires sound, not the input key state of other channels.
  CHECK((reduced[8u + 7u * 32u + 16u] & 1u) != 0u);
  restored.configure(0, -40, 1025);
  restored.process();
  CHECK(mixerU16(readMixer(*restored.kernel).data() + 2u) == 1024u);
  // The typed per-voice state allocation follows the same Main capacity.
  Player typed;
  if (typed.loadCompiled(kV3VariableProductPayload, kV3VariableProductFootprint)) {
    typed.configure(0, -40, 1024, 2);
    for (auto &note : notes)
      note.message = (note.message & 0xffu) | (60u << 8u) | (100u << 16u);
    CHECK(typed.kernel->setMidiEvents(notes.data(), 1024, 2, 0) == ET_OK);
    typed.process();
    CHECK(mixerU16(readMixer(*typed.kernel).data()) == 1024u);
    for (const auto value : typed.audio)
      CHECK(std::isfinite(value));
  }
}
void selectableSampleQuality() {
  static_assert(generated::SoundFontPlayerPluginParams::kFloatCount == 8u);
  auto r = region();
  r[LoopStart] = r[Offset] = 37;
  r[LoopEnd] = 1006;
  r[KeyCenter] = 55;
  Player current({r}, false, false, {}, true);
  CHECK(current.descriptor->paramsFloatCount == 8u);
  CHECK(current.descriptor->paramsHash == generated::SoundFontPlayerPluginParams::kHash);
  const std::array<float, 8> defaults{0, 64, 0, 0, 1, -1, 0, 0};
  CHECK(current.kernel->stageParameters(defaults.data(), 3, current.descriptor->paramsHash) ==
        ET_ERR_ARGS);
  CHECK(current.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  CHECK(current.events({event(0, 0x90, 60, 127)}) == ET_OK);
  std::array<std::array<float, 256>, 3> output{};
  for (const auto quality : {0u, 1u, 2u, 0u}) {
    const auto clock = current.kernel->midiClock();
    {
      allocation_guard::Scope guard;
      current.configure(0, 0, 64, quality);
    }
    CHECK(current.kernel->midiClock() == clock);
    current.process();
    CHECK(current.kernel->midiClock() == clock + 128);
    CHECK(mixerU16(readMixer(*current.kernel).data()) == 1u);
    CHECK(current.peak() > .01F);
    for (const auto value : current.audio)
      CHECK(std::isfinite(value));
    output[quality] = current.audio;
  }
  CHECK(output[0] != output[1] && output[1] != output[2]);
  // Every mode restores a held, already-looped note through the same public
  // checkpoint and reattack path, without rebuilding immutable filter tables.
  for (const auto quality : {0u, 1u, 2u}) {
    Player original({r}, false, false, {}, true), restored({r}, false, false, {}, true);
    original.configure(0, 0, 64, quality);
    restored.configure(0, 0, 64, quality);
    CHECK(original.events({event(0, 0x90, 60, 127)}) == ET_OK);
    for (auto block = 0u; block < 16u; ++block)
      original.process();
    CHECK(original.events({}, ET_MIDI_PAUSE, 2) == ET_OK);
    std::vector<std::uint8_t> checkpoint(original.kernel->midiCheckpointSize());
    CHECK(!checkpoint.empty());
    {
      allocation_guard::Scope guard;
      CHECK(original.kernel->writeMidiCheckpoint(
                checkpoint.data(), static_cast<unsigned>(checkpoint.size())) == ET_OK);
      CHECK(checkpoint[4] == 9u);
      if (quality == 0u) {
        checkpoint[4] = 8u;
        CHECK(restored.kernel->readMidiCheckpoint(
                  checkpoint.data(), static_cast<unsigned>(checkpoint.size())) == ET_ERR_ARGS);
        checkpoint[4] = 9u;
      }
      CHECK(restored.kernel->readMidiCheckpoint(checkpoint.data(),
                                                static_cast<unsigned>(checkpoint.size())) == ET_OK);
    }
    const auto clock = original.kernel->midiClock();
    for (auto *player : {&original, &restored}) {
      CHECK(player->events({}, ET_MIDI_RESUME, 3) == ET_OK);
      CHECK(player->events({{0, 0, 0, ET_MIDI_RESUME, static_cast<std::uint32_t>(clock),
                             static_cast<std::uint32_t>(clock >> 32u)}},
                           0, 3) == ET_OK);
      player->process();
    }
    CHECK(original.audio == restored.audio);
  }
  // Continuous per-sample pitch crosses unity and several table boundaries.
  // A steady low-frequency source must not acquire a discontinuous impulse.
  r = region();
  Player sweep({r}, false, false, {}, true);
  CHECK(sweep.events({event(0, 0x90, 60, 127)}) == ET_OK);
  for (auto block = 0u; block < 4u; ++block)
    sweep.process();
  auto last = sweep.audio[127];
  float maximumJump = 0;
  for (auto block = 0u; block < 8u; ++block) {
    std::array<et_midi_event, 128> bends{};
    for (auto frame = 0u; frame < 128u; ++frame) {
      const auto bend = static_cast<unsigned>(
          8192 + std::round(7000 * std::sin(6.283185307179586 * (block * 128u + frame) / 1024)));
      bends[frame] = event(frame, 0xe0, bend & 127u, bend >> 7u);
    }
    {
      allocation_guard::Scope guard;
      CHECK(sweep.kernel->setMidiEvents(bends.data(), 128, 1, 0) == ET_OK);
    }
    sweep.process();
    for (auto frame = 0u; frame < 128u; ++frame) {
      CHECK(std::isfinite(sweep.audio[frame]));
      maximumJump = std::max(maximumJump, std::abs(sweep.audio[frame] - last));
      last = sweep.audio[frame];
    }
  }
  CHECK(maximumJump < .08F);
  // Copy-to-filter handoff also needs a high-frequency input: a small first
  // pitch departure must not replace its full amplitude in a single frame.
  r = region();
  r[Offset] = r[LoopStart] = 17;
  Player highFrequency({r});
  Bank highBank({r});
  for (auto frame = 0u; frame < 1024u; ++frame)
    highBank.words[highBank.words.size() - 1024u + frame] =
        static_cast<float>(.25 * std::sin(6.283185307179586 * 441 * frame / 1024));
  std::unique_ptr<PreparedAsset> prepared;
  CHECK(highFrequency.kernel->assetPreparer(0)(
            {48000, 2, 128}, highBank.info(),
            reinterpret_cast<const std::uint8_t *>(highBank.words.data()), 1, prepared) == ET_OK);
  CHECK(highFrequency.kernel->exchangePreparedAsset(0, prepared) == ET_OK);
  CHECK(highFrequency.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127)}) == ET_OK);
  for (auto block = 0u; block < 3u; ++block)
    highFrequency.process();
  const auto unchanged = highBank.words[highBank.words.size() - 1024u + 401u];
  CHECK(highFrequency.events({event(0, 0xe0, 1, 64)}) == ET_OK);
  highFrequency.process();
  CHECK(std::abs(highFrequency.audio[0] - unchanged) < .03F);
  CHECK(highFrequency.events({event(0, 0xe0, 0, 64)}) == ET_OK);
  highFrequency.process();
  const auto advanced = 529.0 + 128 * (std::exp2(200.0 / 8192 / 1200) - 1);
  const auto unfiltered =
      static_cast<float>(.25 * std::sin(6.283185307179586 * 441 * advanced / 1024));
  CHECK(std::abs(highFrequency.audio[0] - unfiltered) > .005F);
}
} // namespace
int main() {
  extendedVoiceCapacity();
  selectableSampleQuality();
  selectedPresetPrefixGeometry();
  knownForecastReleaseAndReset();
  admittedSampleForecasts();
  sampleRequestOwnership();
  partialSampleWindows();
  transientChannelMixer();
  systemResetAndDemandPreparation();
  percussionDesignation();
  resamplingImages();
  {
    Player beat;
    if (beat.loadCompiled(kPlaybackBeatsPayload, kPlaybackBeatsFootprint)) {
      const et_midi_transport_point tempo{0, 0, 0, 120, 4, 4};
      CHECK(beat.kernel->setMidiTransportMap(&tempo, 1) == ET_OK);
      CHECK(beat.kernel->setMidiTransport(0, 0, 1, 10, 3) == ET_OK);
      CHECK(beat.kernel->setMidiClock(0, 2, ET_MIDI_CLOCK_RUNNING) == ET_OK);
      CHECK(beat.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
      beat.process();
      CHECK(beat.peak() == 0);
      beat.process();
      CHECK(beat.audio[110] == 0 && beat.audio[127] > 0);
      beat.process();
      beat.process();
      beat.process();
      CHECK(beat.peak() > .2F);
      beat.process();
      CHECK(beat.audio[79] > 0 && beat.audio[80] == 0);
    }
    Player reverse;
    if (reverse.loadCompiled(kPlaybackReversePayload, kPlaybackReverseFootprint)) {
      CHECK(
          reverse.events({event(0, 0xb0, 7, 127), event(0, 0xb0, 2, 127), event(0, 0x90, 60, 127)},
                         0, 2) == ET_OK);
      reverse.process();
      CHECK(std::abs(reverse.audio[96] - 31.0F / 512) < .00001F);
      CHECK(reverse.audio[127] == 0);
    }
    Player alternate;
    if (alternate.loadCompiled(kPlaybackAlternatePayload, kPlaybackAlternateFootprint)) {
      CHECK(alternate.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
      alternate.process();
      alternate.process();
      for (unsigned frame = 0; frame < 128; ++frame) {
        const auto phase = (128u + frame - 32u) % 62u;
        const auto address = 32u + (phase <= 31 ? phase : 62u - phase);
        CHECK(std::abs(alternate.audio[frame] - address / 512.0F) < .00001F);
      }
    }
    Player source;
    if (source.loadCompiled(kPlaybackDelaySamplesPayload, kPlaybackDelaySamplesFootprint)) {
      CHECK(source.kernel->setMidiClock(0, 2, ET_MIDI_CLOCK_RUNNING) == ET_OK);
      CHECK(source.events({event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
      source.process();
      CHECK(source.events({}, ET_MIDI_PAUSE, 2) == ET_OK);
      std::vector<std::uint8_t> checkpoint(source.kernel->midiCheckpointSize());
      CHECK(source.kernel->writeMidiCheckpoint(checkpoint.data(),
                                               static_cast<unsigned>(checkpoint.size())) == ET_OK);
      Player restored({region()}, false, false, {}, false, {}, 96000);
      if (restored.loadCompiled(kPlaybackDelaySamplesPayload, kPlaybackDelaySamplesFootprint)) {
        CHECK(restored.kernel->readMidiCheckpoint(
                  checkpoint.data(), static_cast<unsigned>(checkpoint.size())) == ET_OK);
        CHECK(restored.events({}, ET_MIDI_RESUME, 3) == ET_OK);
        const auto clock = restored.kernel->midiClock();
        CHECK(restored.events({{7, 0, 0, ET_MIDI_RESUME, static_cast<unsigned>(clock), 0}}, 0, 3) ==
              ET_OK);
        restored.process();
        CHECK(restored.peak() == 0);
        restored.process();
        CHECK(restored.audio[102] == 0 && restored.audio[127] > 0);
      }
    }
  }
  {
    Player delayed;
    if (delayed.loadCompiled(kPlaybackDelaySamplesPayload, kPlaybackDelaySamplesFootprint)) {
      CHECK(delayed.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
      delayed.process();
      CHECK(delayed.peak() == 0);
      delayed.process();
      CHECK(delayed.audio[110] == 0 && delayed.audio[127] > 0);
      CHECK(delayed.events({event(0, 0x80, 60, 0)}, 0, 2) == ET_OK);
      delayed.process();
      delayed.process();
      CHECK(delayed.peak() == 0);
    }
    Player repeated;
    if (repeated.loadCompiled(kPlaybackRepeatsPayload, kPlaybackRepeatsFootprint)) {
      CHECK(repeated.events({event(0, 0xb0, 7, 127), event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
      repeated.process();
      repeated.process();
      repeated.process();
      CHECK(std::abs(repeated.audio[120] - .25F) < .0001F);
      repeated.process();
      CHECK(repeated.peak() == 0);
    }
    Player pedal;
    if (pedal.loadCompiled(kPlaybackPedalPayload, kPlaybackPedalFootprint)) {
      CHECK(pedal.events({event(0, 0xb0, 1, 1), event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
      pedal.process();
      pedal.process();
      CHECK(pedal.events({event(0, 0x80, 60, 0)}, 0, 2) == ET_OK);
      pedal.process();
      pedal.process();
      CHECK(pedal.peak() > .1F);
      CHECK(pedal.events({event(0, 0xb0, 1, 0)}, 0, 2) == ET_OK);
      for (unsigned i = 0; i < 4; ++i)
        pedal.process();
      CHECK(pedal.peak() == 0);
    }
    Player controller;
    if (controller.loadCompiled(kPlaybackControllerPayload, kPlaybackControllerFootprint)) {
      CHECK(controller.events({event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
      controller.process();
      CHECK(controller.peak() == 0);
      CHECK(controller.events({event(0, 0xb0, 1, 64)}, ET_MIDI_HYDRATE_CHANNEL_STATE, 2) == ET_OK);
      controller.process();
      CHECK(controller.peak() == 0);
      CHECK(controller.events({event(0, 0xb0, 1, 64)}, 0, 2) == ET_OK);
      controller.process();
      controller.process();
      CHECK(controller.peak() > .1F);
      CHECK(controller.events({event(0, 0xb0, 2, 127)}, 0, 2) == ET_OK);
      controller.process();
      controller.process();
      CHECK(controller.peak() == 0);
    }
    Player silent;
    if (silent.loadCompiled(kPlaybackSilentPayload, kPlaybackSilentFootprint)) {
      CHECK(silent.events({event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
      silent.process();
      silent.process();
      CHECK(silent.peak() > .1F);
      CHECK(silent.events({event(0, 0x90, 61, 127)}, 0, 2) == ET_OK);
      silent.process();
      silent.process();
      CHECK(silent.peak() == 0);
      CHECK((silent.kernel->midiState() & ET_MIDI_STATE_VOICES) == 0);
    }
  }
  {
    Player fixed, dynamic, cents, low, high;
    const auto energy = [](const Player &p) {
      double value = 0;
      for (const auto sample : p.audio)
        value += sample * sample;
      return value;
    };
    if (fixed.loadCompiled(kV3EqStaticPayload, kV3EqStaticFootprint) &&
        dynamic.loadCompiled(kV3EqDynamicPayload, kV3EqDynamicFootprint) &&
        cents.loadCompiled(kV3EqCentsPayload, kV3EqCentsFootprint) &&
        low.loadCompiled(kV3EqLowShelfPayload, kV3EqLowShelfFootprint) &&
        high.loadCompiled(kV3EqHighShelfPayload, kV3EqHighShelfFootprint)) {
      for (auto *p : {&fixed, &dynamic, &cents, &low, &high}) {
        CHECK(p->events({event(0, 0x90, 60, 127)}, 0, 2) == ET_OK);
        for (unsigned i = 0; i < 40; ++i)
          p->process();
      }
      const auto fixedEnergy = energy(fixed), dynamicEnergy = energy(dynamic),
                 centsEnergy = energy(cents);
      CHECK(std::abs(low.audio[127] / high.audio[127] - std::pow(10.0, .3)) < .01);
      for (auto *p : {&fixed, &dynamic, &cents}) {
        CHECK(p->events({event(0, 0xb0, 1, 127)}, 0, 2) == ET_OK);
        for (unsigned i = 0; i < 40; ++i)
          p->process();
      }
      CHECK(std::abs(energy(fixed) / fixedEnergy - 1) < .001);
      CHECK(std::abs(energy(dynamic) / dynamicEnergy - std::pow(10.0, .6)) < .03);
      CHECK(energy(cents) > centsEnergy * 2);
    }
  }
  genericModulation();
  variableModulationAudioAndCheckpoint();
  genericModulationRetryAndCheckpoint();
  genericPitchAndScope();
  genericSourceAndKeyOffsets();
  forcedVoiceLifetimes();
  channelStateHydration();
  timingAndUnity();
  independentNotesAndPedals();
  dynamicAndRestore();
  releaseRegions();
  sampleAndModulation();
  historyReattackBoundary();
  naturalOneShotTail();
  naturalReleaseLoopTail();
  sourceVoiceOwnership();
  selectedChannelAndHeldHistory();
  channelConfigurationOwnership();
  stagedEnvelopeTiming();
  envelopeControllers();
  equalizerResponse();
  scriptWaitAndHistory();
  scriptCheckpointResume();
  scriptInitRestoreBoundary();
  scriptVoiceAutomation();
  scriptAdmissionBoundaries();
  pagedOfflineRetry();
  pagedOfflineRetry(true);
  pagedCheckpointPrefetch();
  sf2CollectionPlayback();
  sf2InitialAndFallbackPresets();
  sf2SoundOffAndModulation();
  sf2PreparedFilterReselection();
  sf2UnchangedFilterEvent();
  midiChannelAudioMeters();
  midiHeldKeyTelemetry();
  previewVoiceOwnership();
  scriptBoundedMessages();
  scriptTerminalFailure();
  scriptCurrentEventAndDomains();
  scriptFilterAndLfoControls();
  return failures ? 1 : 0;
}

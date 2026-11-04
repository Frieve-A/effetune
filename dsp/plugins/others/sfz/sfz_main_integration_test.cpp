#include "../../../test/sample_player_fixture.h"
#include "../../analyzer/note_spectrogram/spectral_analysis.h"
#include "../soundfont_player/effects_fixture.h"
#include "../soundfont_player/future_main_fixture.h"
#include "../soundfont_player/storage_fixture.h"
#include "SFZNotePlayerPluginParams.h"
#include "SoundFontPlayerPluginParams.h"
#include "allocation_guard.h"
#include "bank.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_SoundFontPlayerPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_SFZNotePlayerPlugin() noexcept;
namespace {
using namespace effetune;
using namespace effetune::plugins::others::sfz;
int failures = 0;
#define CHECK(condition)                                                                           \
  do {                                                                                             \
    if (!(condition)) {                                                                            \
      std::fprintf(stderr, "sfz-main:%d %s\n", __LINE__, #condition);                              \
      ++failures;                                                                                  \
    }                                                                                              \
  } while (false)
et_midi_event message(unsigned offset, unsigned status, unsigned first, unsigned second = 0,
                      unsigned flags = 0) {
  return {offset, status | (first << 8u) | (second << 16u), 0, flags, 0, 0};
}
struct Player {
  alignas(std::max_align_t) std::array<std::byte, 16384> storage{};
  const KernelDescriptor *descriptor;
  PluginKernel *kernel;
  bool note;
  unsigned channels;
  float rate;
  double time = 0;
  unsigned analysisLatency = 0;
  generated::SFZNotePlayerPluginParams noteParams{.5F, -30, 3, 28, 91, 32, 0,  100, 0, 0, 1,
                                                  1,   1,   0, 18, 0,  0,  60, 127, 0, -1};
  std::array<float, 512> audio{};
  explicit Player(bool noteRole = false, unsigned outputs = 2, float sampleRate = 48000)
      : descriptor(noteRole ? et_kernel_descriptor_SFZNotePlayerPlugin()
                            : et_kernel_descriptor_SoundFontPlayerPlugin()),
        kernel(descriptor->construct(storage.data())), note(noteRole), channels(outputs),
        rate(sampleRate) {
    kernel->prepare({rate, channels, 128});
    CHECK(kernel->preparedSuccessfully());
    if (note) {
      plugins::analyzer::SpectralAnalysis analysis;
      analysis.prepare({rate, channels, 128});
      analysisLatency = analysis.latencySamples();
      configureNote(0, 100, 0, 0);
    } else
      configureMidi(0);
    kernel->setRandomSeed(19, 23);
  }
  ~Player() { descriptor->destroy(kernel); }
  void configureMidi(float gain, unsigned selectedChannel = 0) {
    std::array<float, generated::SoundFontPlayerPluginParams::kFloatCount> values;
    values.fill(-1);
    values[0] = static_cast<float>(selectedChannel);
    values[1] = 64;
    values[2] = gain;
    CHECK(kernel->stageParameters(values.data(), descriptor->paramsFloatCount,
                                  descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }
  void configureNote(float dry, float wet, float gain, float timing) {
    noteParams.dryMix = dry;
    noteParams.wetMix = wet;
    noteParams.outputGain = gain;
    noteParams.timingOffsetMs = timing;
    CHECK(kernel->stageParameters(reinterpret_cast<const float *>(&noteParams),
                                  descriptor->paramsFloatCount, descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }
  AssetBeginInfo assetInfo(std::span<const std::uint8_t> payload, std::uint32_t base,
                           const PrepareInfo &prepare, bool oneByteShort = false) {
    AssetBeginInfo info{1,    static_cast<unsigned>((payload.size() - 32u) / 4u),
                        0,    0,
                        1,    0,
                        0,    channels,
                        base, static_cast<unsigned>(payload.size())};
    CHECK(test::addSamplePlayerFixtureStorage(info, payload, prepare,
                                              note ? ET_SAMPLE_PLAYER_NOTE
                                                   : ET_SAMPLE_PLAYER_MAIN) == ET_OK);
    if (oneByteShort)
      --info.footprintBytes;
    return info;
  }
  bool load(std::span<const std::uint8_t> payload, std::uint32_t base, bool oneByteShort = false) {
    const PrepareInfo prepare{rate, channels, 128, 0};
    const auto info = assetInfo(payload, base, prepare, oneByteShort);
    std::unique_ptr<PreparedAsset> asset;
    const auto status =
        kernel->assetPreparer(0)(prepare, info, payload.data(), ET_ASSET_F32_MULTICH, asset);
    if (oneByteShort) {
      CHECK(status == ET_ERR_OOM);
      return status == ET_ERR_OOM;
    }
    CHECK(status == ET_OK);
    if (status != ET_OK)
      return false;
    CHECK(kernel->exchangePreparedAsset(0, asset) == ET_OK);
    kernel->reset();
    if (!note) {
      CHECK(events({}, ET_MIDI_RESET) == ET_OK);
      CHECK(kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    }
    return true;
  }
  bool loadPaged(bool allPages, std::span<const std::uint8_t> payload, unsigned footprint) {
    const PrepareInfo prepare{rate, channels, 128, 0};
    const auto info = assetInfo(payload, footprint, prepare);
    auto *destination = kernel->beginAssetWithContext(0, info, prepare);
    CHECK(destination);
    if (!destination)
      return false;
    std::memcpy(destination, payload.data(), payload.size());
    CHECK(kernel->commitAsset(0, info.byteSize, ET_ASSET_F32_MULTICH) == ET_OK);
    CHECK(kernel->configureSampleStream(91) == ET_OK);
    std::array<float, 4096> page;
    page.fill(.25F);
    for (unsigned index = 0; index < (allPages ? 4u : 1u); ++index)
      CHECK(kernel->publishSamplePage(91, 0, index, page.data(), 4096, 1, 1) == ET_OK);
    CHECK(kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
    kernel->reset();
    CHECK(events({}, ET_MIDI_RESET) == ET_OK);
    CHECK(kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    return true;
  }
  et_status events(std::initializer_list<et_midi_event> input, unsigned flags = 0) {
    allocation_guard::Scope guard;
    return kernel->setMidiEvents(input.begin(), static_cast<unsigned>(input.size()), 1, flags);
  }
  void process(float input = 0, const HostTransport *transport = nullptr) {
    audio.fill(input);
    NoteAnalysisView view{nullptr, 0, 28, 91, 128, time, channels, analysisLatency};
    allocation_guard::Scope guard;
    kernel->process(audio.data(), channels, 128, {time, transport, note ? &view : nullptr});
    time += 128.0 / rate;
    CHECK(kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
  }
  void start() {
    if (!note)
      CHECK(events({message(0, 0x90, 60, 127)}) == ET_OK);
    for (unsigned block = 0; block < 16; ++block)
      process();
  }
  double energy(unsigned channel = 0, unsigned first = 0, unsigned last = 128) const {
    double sum = 0;
    for (auto frame = first; frame < last; ++frame) {
      const auto value = audio[channel * 128u + frame];
      sum += value * value;
    }
    return sum;
  }
};
double toneAmplitude(const Player &player, unsigned cycles) {
  double real = 0, imaginary = 0;
  for (unsigned frame = 0; frame < 128; ++frame) {
    const auto phase = 6.283185307179586 * cycles * frame / 128;
    real += player.audio[frame] * std::cos(phase);
    imaginary += player.audio[frame] * std::sin(phase);
  }
  return 2.0 * std::hypot(real, imaginary) / 128;
}
void resolvedPlaybackAndHostTransport() {
  const auto fullVolume = [](Player &player) {
    CHECK(player.events({message(0, 0xb0, 7, 127)}) == ET_OK);
    player.process();
  };
  {
    Player player;
    if (player.load(kFutureLoopTuneQualityPayload, kFutureLoopTuneQualityBaseFootprint)) {
      fullVolume(player);
      player.start();
      CHECK((player.kernel->midiState() & ET_MIDI_STATE_VOICES) != 0);
      CHECK(toneAmplitude(player, 32) < .001);
    }
  }
  {
    Player player;
    if (player.load(kFutureDynamicLoopTunePayload, kFutureDynamicLoopTuneBaseFootprint)) {
      fullVolume(player);
      player.start();
      CHECK(toneAmplitude(player, 4) > .05);
      CHECK(player.events({message(0, 0xb0, 1, 127)}) == ET_OK);
      for (unsigned block = 0; block < 16; ++block)
        player.process();
      CHECK(toneAmplitude(player, 4) < .01);
      CHECK(toneAmplitude(player, 8) > .05);
    }
  }
  {
    Player player;
    if (player.load(kFutureDynamicLoopBoundsPayload, kFutureDynamicLoopBoundsBaseFootprint)) {
      fullVolume(player);
      player.start();
      CHECK(player.events({message(0, 0xb0, 2, 127), message(0, 0xb0, 3, 127)}) == ET_OK);
      for (unsigned block = 0; block < 24; ++block)
        player.process();
      float minimum = 1, maximum = -1;
      for (unsigned block = 0; block < 32; ++block) {
        player.process();
        for (unsigned frame = 0; frame < 128; ++frame) {
          minimum = std::min(minimum, player.audio[frame]);
          maximum = std::max(maximum, player.audio[frame]);
        }
      }
      CHECK(minimum > -.21F && minimum < -.15F);
      CHECK(maximum > .15F && maximum < .21F);
    }
  }
  {
    Player player;
    if (player.load(kFutureDynamicFadeoutPayload, kFutureDynamicFadeoutBaseFootprint)) {
      fullVolume(player);
      CHECK(player.events({message(0, 0xb0, 1, 127), message(0, 0x90, 60, 127)}) == ET_OK);
      float early = 0, nearEnd = 0;
      for (unsigned block = 0; block < 32; ++block) {
        player.process();
        if (block == 7)
          early = player.audio[104];
        if (block == 31)
          nearEnd = player.audio[32];
      }
      CHECK(early > .23F && early < .27F);
      CHECK(nearEnd / early > .25F && nearEnd / early < .4F);
    }
  }
  {
    Player player;
    if (player.load(kFutureHostPlayingPayload, kFutureHostPlayingBaseFootprint)) {
      fullVolume(player);
      CHECK(player.kernel->setMidiClock(player.kernel->midiClock(), 1, 0) == ET_OK);
      const HostTransport host{HostTransport::kPlaying | HostTransport::kTempoValid |
                                   HostTransport::kPositionValid,
                               120, 1};
      CHECK(player.events({message(0, 0x90, 60, 127)}) == ET_OK);
      for (unsigned block = 0; block < 16; ++block)
        player.process(0, &host);
      CHECK(toneAmplitude(player, 0) > .4);
    }
  }
  for (double tempo : {0.0, std::numeric_limits<double>::quiet_NaN()}) {
    Player player;
    if (player.load(kFutureHostPositionPayload, kFutureHostPositionBaseFootprint)) {
      fullVolume(player);
      CHECK(player.kernel->setMidiClock(player.kernel->midiClock(), 1, 0) == ET_OK);
      const HostTransport host{HostTransport::kPlaying | HostTransport::kPositionValid, tempo, 1};
      CHECK(player.events({message(0, 0x90, 60, 127)}) == ET_OK);
      for (unsigned block = 0; block < 16; ++block)
        player.process(0, &host);
      CHECK(toneAmplitude(player, 0) > .4);
    }
  }
}
void amplifierVelocityResponse() {
  const auto start = [](Player &player, std::span<const std::uint8_t> payload, unsigned footprint,
                        unsigned velocity = 64) {
    if (!player.load(payload, footprint))
      return false;
    CHECK(player.events({message(0, 0xb0, 7, 127), message(0, 0x90, 60, velocity)}) == ET_OK);
    for (unsigned block = 0; block < 16; ++block)
      player.process();
    return true;
  };
  Player full;
  if (!start(full, kFutureAmpOrdinaryPayload, kFutureAmpOrdinaryBaseFootprint, 127))
    return;
  const auto projection = [&full](const Player &player, unsigned first = 0, unsigned last = 128) {
    double numerator = 0, denominator = 0;
    for (auto frame = first; frame < last; ++frame) {
      numerator += static_cast<double>(player.audio[frame]) * full.audio[frame];
      denominator += static_cast<double>(full.audio[frame]) * full.audio[frame];
    }
    return numerator / denominator;
  };
  struct Case {
    std::span<const std::uint8_t> payload;
    unsigned footprint;
    double expected;
  };
  // Independent public-reference signed amplitude anchors, not helper calls.
  for (const auto &test :
       {Case{kFutureAmpHalfPayload, kFutureAmpHalfBaseFootprint, .6269762539525079},
        {kFutureAmpNegativePayload, kFutureAmpNegativeBaseFootprint, -.7460474920949842},
        {kFutureAmpCurveHalfPayload, kFutureAmpCurveHalfBaseFootprint, .875},
        {kFutureAmpCurveNegativePayload, kFutureAmpCurveNegativeBaseFootprint, -.25}}) {
    Player player;
    if (start(player, test.payload, test.footprint))
      CHECK(std::abs(projection(player) - test.expected) < 2e-5);
  }

  Player omitted, zero, randomized, negative, custom;
  if (!start(omitted, kFutureAmpOrdinaryPayload, kFutureAmpOrdinaryBaseFootprint) ||
      !start(zero, kFutureAmpExplicitZeroPayload, kFutureAmpExplicitZeroBaseFootprint) ||
      !start(randomized, kFutureAmpRandomPayload, kFutureAmpRandomBaseFootprint) ||
      !start(negative, kFutureAmpRandomNegativePayload, kFutureAmpRandomNegativeBaseFootprint) ||
      !start(custom, kFutureAmpRandomCurvePayload, kFutureAmpRandomCurveBaseFootprint))
    return;
  CHECK(omitted.audio == zero.audio);
  const auto curve = projection(omitted), randomGain = projection(randomized);
  const auto inferredDraw = (curve - randomGain) / (.25 * (1 - curve));
  CHECK(inferredDraw >= 0 && inferredDraw <= 1);
  CHECK(std::abs(randomGain - curve) > .001);
  CHECK(projection(negative) < 0 && projection(custom) < 0);
  // The same birth fact applies to resolved default/custom curves, with raw
  // signed depth before their shared response. No proprietary seed is assumed.
  const auto negativeTrack = 1 - 100 * inferredDraw;
  const auto expectedNegative =
      negativeTrack >= 0 ? 1 - negativeTrack * (1 - curve) : negativeTrack * (1 - curve);
  const auto expectedCustom = negativeTrack >= 0 ? 1 - negativeTrack * .25 : negativeTrack * .25;
  CHECK(std::abs(projection(negative) - expectedNegative) < 2e-4);
  CHECK(std::abs(projection(custom) - expectedCustom) < 2e-4);
  Player maximumPositive, maximumNegative;
  if (start(maximumPositive, kFutureAmpRandomPayload, kFutureAmpRandomBaseFootprint, 127) &&
      start(maximumNegative, kFutureAmpRandomNegativePayload, kFutureAmpRandomNegativeBaseFootprint,
            127)) {
    CHECK(maximumPositive.audio == full.audio);
    CHECK(maximumNegative.energy() < 1e-12);
  }

  Player readout, panZero;
  if (!start(readout, kFutureAmpRandomReadoutPayload, kFutureAmpRandomReadoutBaseFootprint) ||
      !start(panZero, kFutureAmpPanZeroPayload, kFutureAmpPanZeroBaseFootprint))
    return;
  const auto panRatio = readout.energy(1) / readout.energy(0);
  const auto zeroPanRatio = panZero.energy(1) / panZero.energy(0);
  CHECK(std::abs(panRatio - zeroPanRatio) < 2e-5);
  const auto panDraw = 4 * std::atan(std::sqrt(panRatio)) / 3.14159265358979323846 - 1;
  CHECK(std::abs(inferredDraw - panDraw) > .05);

  Player dynamic;
  if (!start(dynamic, kFutureAmpRandomDynamicPayload, kFutureAmpRandomDynamicBaseFootprint))
    return;
  const auto initial = dynamic.audio;
  const auto low = projection(dynamic);
  CHECK(dynamic.events({message(64, 0xb0, 1, 127)}) == ET_OK);
  dynamic.process();
  CHECK(std::abs(projection(dynamic, 0, 32) - low) < 2e-5);
  CHECK(std::abs((projection(dynamic, 80, 128) - low) - (curve - 1)) < 2e-5);
  CHECK(dynamic.events({message(0, 0xb0, 1, 0)}) == ET_OK);
  dynamic.process();
  dynamic.process();
  for (unsigned frame = 0; frame < dynamic.audio.size(); ++frame)
    CHECK(std::abs(dynamic.audio[frame] - initial[frame]) < 2e-7F);
  CHECK(dynamic.events({}, ET_MIDI_PAUSE) == ET_OK);
  std::vector<std::uint8_t> checkpoint(dynamic.kernel->midiCheckpointSize());
  CHECK(!checkpoint.empty());
  CHECK(dynamic.kernel->writeMidiCheckpoint(checkpoint.data(),
                                            static_cast<unsigned>(checkpoint.size())) == ET_OK);
  CHECK(dynamic.kernel->readMidiCheckpoint(checkpoint.data(),
                                           static_cast<unsigned>(checkpoint.size())) == ET_OK);
  const auto clock = dynamic.kernel->midiClock();
  CHECK(dynamic.events({et_midi_event{0, 0, 0, ET_MIDI_RESUME, static_cast<std::uint32_t>(clock),
                                      static_cast<std::uint32_t>(clock >> 32u)}}) == ET_OK);
  for (unsigned block = 0; block < 16; ++block)
    dynamic.process();
  CHECK(std::abs(projection(dynamic) - low) < 2e-5);

  Player stealing;
  if (start(stealing, kFutureAmpNegativeStealPayload, kFutureAmpNegativeStealBaseFootprint)) {
    CHECK(stealing.events({message(0, 0x90, 60, 64)}) == ET_OK);
    for (unsigned block = 0; block < 16; ++block)
      stealing.process();
    CHECK(projection(stealing) < -.7);
    CHECK(stealing.events({message(0, 0x80, 60)}) == ET_OK);
    stealing.process();
    CHECK(projection(stealing) < 0);
    for (unsigned block = 0; block < 32; ++block)
      stealing.process();
    CHECK(stealing.energy() < 1e-9);
  }
}

void voiceDspAndNoise() {
  struct Case {
    Player *player;
    std::span<const std::uint8_t> payload;
    unsigned footprint;
  };
  Player dry, drive, bits, decimation, order0, order1, order14;
  for (const auto &test : {Case{&dry, kFutureDryPayload, kFutureDryBaseFootprint},
                           {&drive, kFutureDrivePayload, kFutureDriveBaseFootprint},
                           {&bits, kFutureBitPayload, kFutureBitBaseFootprint},
                           {&decimation, kFutureDecimPayload, kFutureDecimBaseFootprint},
                           {&order0, kFutureOrder0Payload, kFutureOrder0BaseFootprint},
                           {&order1, kFutureOrder1Payload, kFutureOrder1BaseFootprint},
                           {&order14, kFutureOrder14Payload, kFutureOrder14BaseFootprint}}) {
    if (test.player->load(test.payload, test.footprint))
      test.player->start();
  }
  const auto difference = [](const Player &a, const Player &b) {
    double sum = 0;
    for (unsigned frame = 0; frame < 256; ++frame)
      sum += std::abs(a.audio[frame] - b.audio[frame]);
    return sum;
  };
  CHECK(dry.energy() > .1);
  for (const auto *changed : {&drive, &bits, &decimation})
    CHECK(difference(dry, *changed) > .01);
  CHECK(difference(order0, order1) > .01);
  std::fprintf(stderr, "order energies: %.9g %.9g %.9g differences %.9g %.9g\n", order0.energy(),
               order1.energy(), order14.energy(), difference(order0, order1),
               difference(order1, order14));
  CHECK(difference(order1, order14) > .01);
  Player mono, repeated, stereo, comb, separateFamilies;
  for (const auto &test : {Case{&mono, kFutureNoiseMonoPayload, kFutureNoiseMonoBaseFootprint},
                           {&repeated, kFutureNoiseMonoPayload, kFutureNoiseMonoBaseFootprint},
                           {&stereo, kFutureNoiseStereoPayload, kFutureNoiseStereoBaseFootprint},
                           {&comb, kFutureNoiseCombPayload, kFutureNoiseCombBaseFootprint}}) {
    if (test.player->load(test.payload, test.footprint))
      test.player->start();
  }
  CHECK(mono.energy() > .01 && stereo.energy() > .01 && comb.energy() > .001);
  CHECK(mono.audio == repeated.audio);
  CHECK(mono.energy(0) == mono.energy(1));
  CHECK(stereo.energy(0) != stereo.energy(1));
  CHECK(separateFamilies.load(kFutureOptionalUnionPayload, kFutureOptionalUnionBaseFootprint));
}
void globalSources() {
  struct Case {
    std::span<const std::uint8_t> payload;
    unsigned footprint, status, first, second;
  };
  for (const auto &test :
       {Case{kFutureFxGlobalPayload, kFutureFxGlobalBaseFootprint, 0xb2, 7, 127},
        {kFutureFxBendPayload, kFutureFxBendBaseFootprint, 0xe2, 127, 127},
        {kFutureFxPressurePayload, kFutureFxPressureBaseFootprint, 0xd2, 127, 0},
        {kFutureFxPolyPressurePayload, kFutureFxPolyPressureBaseFootprint, 0xa2, 62, 127}}) {
    Player player;
    if (!player.load(test.payload, test.footprint))
      continue;
    const auto lowFirst = test.status == 0xb2 ? 7u : test.status == 0xa2 ? 62u : 0u;
    CHECK(player.events({message(0, test.status, lowFirst, 0), message(0, 0x90, 60, 127)}) ==
          ET_OK);
    for (unsigned block = 0; block < 16; ++block)
      player.process();
    const auto quiet = player.energy();
    CHECK(player.events({message(64, test.status, test.first, test.second)}) == ET_OK);
    player.process();
    CHECK(std::abs(player.energy(0, 64) / player.energy(0, 0, 64) - std::pow(10.0, 1.2)) < .01);
    player.process();
    CHECK(std::abs(player.energy() / quiet - std::pow(10.0, 1.2)) < .01);
    CHECK(
        player.events({message(0, 0xbfu, 7, 100, ET_MIDI_HYDRATE_CHANNEL_ONLY),
                       message(0, test.status, test.first, test.second, ET_MIDI_HYDRATE_GLOBAL_CC)},
                      ET_MIDI_HYDRATE_CHANNEL_STATE) == ET_OK);
    player.process();
    CHECK(std::abs(player.energy() / quiet - std::pow(10.0, 1.2)) < .01);
    CHECK(player.events({}, ET_MIDI_PAUSE) == ET_OK);
    std::vector<std::uint8_t> checkpoint(player.kernel->midiCheckpointSize());
    CHECK(!checkpoint.empty());
    CHECK(player.kernel->writeMidiCheckpoint(checkpoint.data(),
                                             static_cast<unsigned>(checkpoint.size())) == ET_OK);
    CHECK(player.kernel->readMidiCheckpoint(checkpoint.data(),
                                            static_cast<unsigned>(checkpoint.size())) == ET_OK);
    const auto clock = player.kernel->midiClock();
    CHECK(player.events({et_midi_event{0, 0, 0, ET_MIDI_RESUME, static_cast<std::uint32_t>(clock),
                                       static_cast<std::uint32_t>(clock >> 32u)}}) == ET_OK);
    for (unsigned block = 0; block < 16; ++block)
      player.process();
    std::fprintf(stderr, "CP source%x: restored %.9g before %.9g ratio %.9g\n", test.status,
                 player.energy(), quiet, player.energy() / quiet);
    CHECK(std::abs(player.energy() / quiet - std::pow(10.0, 1.2)) < .01);
  }
}
void outputAndBudget() {
  for (const bool note : {false, true}) {
    Player direct(note, 4), auxiliary(note, 4);
    if (!direct.load(kFxDryPayload, kFxDryFootprint) ||
        !auxiliary.load(kFxAuxPayload, kFxAuxFootprint))
      continue;
    if (note) {
      direct.configureNote(25, 75, -6, 3);
      auxiliary.configureNote(25, 75, -6, 3);
    } else {
      direct.configureMidi(-6);
      auxiliary.configureMidi(-6);
      CHECK(direct.kernel->setMidiGain(.5F) == ET_OK);
      CHECK(auxiliary.kernel->setMidiGain(.5F) == ET_OK);
      CHECK(direct.events({message(0, 0xb0, 7, 127)}) == ET_OK);
      CHECK(auxiliary.events({message(0, 0xb0, 7, 127)}) == ET_OK);
      direct.process();
      auxiliary.process();
    }
    direct.start();
    auxiliary.start();
    const auto blocks = note ? direct.kernel->latencySamples() / 128 + 4 : 4;
    for (unsigned block = 0; block < blocks; ++block) {
      direct.process(.4F);
      auxiliary.process(.4F);
    }
    const auto gain = std::pow(10.0F, -.3F);
    const auto dry = note ? .4F * .25F * gain : .4F;
    const auto wet = .25F * (note ? .75F : .5F) * gain;
    std::fprintf(stderr, "output role%u: direct %.9g aux0 %.9g aux2 %.9g dry %.9g wet %.9g\n", note,
                 direct.audio[127], auxiliary.audio[127], auxiliary.audio[383], dry, wet);
    CHECK(std::abs(direct.audio[127] - dry - wet) < 1e-5F);
    CHECK(std::abs(auxiliary.audio[127] - dry) < 1e-5F);
    CHECK(std::abs(auxiliary.audio[383] - dry - wet * std::pow(10.0F, .3F)) < 1e-5F);
  }
  Player exact, shortBudget;
  CHECK(exact.load(kFxGainPayload, kFxGainFootprint));
  CHECK(shortBudget.load(kFxGainPayload, kFxGainFootprint, true));
}
void beatTiming() {
  for (const double speed : {0.0, .25, .5, 2.0, 4.0}) {
    Player player;
    if (!player.load(kFuturePlaybackBeatPayload, kFuturePlaybackBeatBaseFootprint))
      continue;
    if (speed) {
      const et_midi_transport_point point{0, 0, 0, 90, 4, 4};
      CHECK(player.kernel->setMidiTransportMap(&point, 1) == ET_OK);
      CHECK(player.kernel->setMidiTransport(
                0, 0, speed, 60, ET_MIDI_TRANSPORT_ENABLED | ET_MIDI_TRANSPORT_PLAYING) == ET_OK);
    }
    CHECK(player.events({message(0, 0x90, 60, 127)}) == ET_OK);
    unsigned first = UINT32_MAX;
    for (unsigned block = 0; block < 16; ++block) {
      player.process();
      for (unsigned frame = 0; frame < 128; ++frame)
        if (first == UINT32_MAX && std::abs(player.audio[frame]) > 1e-6F)
          first = block * 128 + frame;
    }
    const auto expected = .01 * 60 * 48000 / (speed ? 90 * speed : 120);
    CHECK(std::abs(static_cast<double>(first) - expected) <= 2);
  }
}
void sparseGlobalInitialization() {
  Player player;
  if (!player.load(kFutureFxGlobalInitPayload, kFutureFxGlobalInitBaseFootprint))
    return;
  player.start();
  const auto authored = player.energy();
  CHECK(player.events({message(0, 0xb2, 121, 0, ET_MIDI_HYDRATE_CHANNEL_ONLY),
                       message(0, 0xb2, 7, 100, ET_MIDI_HYDRATE_CHANNEL_ONLY)},
                      ET_MIDI_HYDRATE_CHANNEL_STATE) == ET_OK);
  player.process();
  CHECK(player.energy() == authored);
  CHECK(player.events({message(0, 0xb2, 7, 0)}, ET_MIDI_HYDRATE_CHANNEL_STATE) == ET_OK);
  player.process();
  CHECK(std::abs(player.energy() / authored - std::pow(10.0, -.3)) < .001);
  CHECK(player.events({message(0, 0xb2, 7, 127, ET_MIDI_HYDRATE_GLOBAL_CC)},
                      ET_MIDI_HYDRATE_CHANNEL_STATE) == ET_OK);
  player.process();
  CHECK(std::abs(player.energy() / authored - std::pow(10.0, .9)) < .001);
}
void pagedEffectsRetry(std::span<const std::uint8_t> payload, unsigned footprint) {
  Player resident, paged;
  if (!resident.loadPaged(true, payload, footprint) || !paged.loadPaged(false, payload, footprint))
    return;
  CHECK(resident.events({message(0, 0x90, 60, 127)}) == ET_OK);
  CHECK(paged.events({message(0, 0x90, 60, 127)}) == ET_OK);
  unsigned retries = 0;
  for (unsigned block = 0; block < 48; ++block) {
    resident.audio.fill(0);
    {
      allocation_guard::Scope guard;
      CHECK(resident.kernel->processOffline(resident.audio.data(), 2, 128, {resident.time}) ==
            ET_OK);
    }
    const auto before = paged.kernel->midiClock();
    bool complete = false;
    for (unsigned attempt = 0; attempt < 4; ++attempt) {
      paged.audio.fill(0);
      et_status status;
      {
        allocation_guard::Scope guard;
        status = paged.kernel->processOffline(paged.audio.data(), 2, 128, {paged.time});
      }
      if (status == ET_OK) {
        complete = true;
        break;
      }
      CHECK(status == ET_NEED_SAMPLE);
      CHECK(paged.kernel->midiClock() == before);
      ++retries;
      std::array<et_sfz_sample_request, 8> requests{};
      unsigned count = 0;
      CHECK(paged.kernel->takeSampleRequests(requests.data(), 8, count) == ET_OK);
      CHECK(count > 0);
      std::array<float, 4096> page;
      page.fill(.25F);
      for (unsigned index = 0; index < count; ++index) {
        const auto &request = requests[index];
        CHECK(request.generation_low == 91 && request.sample == 0 && request.page_high == 0);
        CHECK(paged.kernel->publishSamplePage(91, 0, request.page_low, page.data(), 4096, 1, 0) ==
              ET_OK);
      }
    }
    CHECK(complete);
    CHECK(paged.audio == resident.audio);
    CHECK(paged.kernel->midiClock() == resident.kernel->midiClock());
    paged.time += 128.0 / paged.rate;
    resident.time += 128.0 / resident.rate;
  }
  CHECK(retries > 0);
}
void shiftedNoteForecast() {
  for (const unsigned physicalKey : {60u, 120u}) {
    Player player;
    if (!player.loadPaged(false, kFutureShiftedOffsetPayload, kFutureShiftedOffsetBaseFootprint))
      continue;
    CHECK(player.events({message(0, 0xb0, 7, 127), message(0, 0xb0, 1, 127)}) == ET_OK);
    player.process();
    const auto note = message(0, 0x90, physicalKey, 127);
    CHECK(player.kernel->prefetchSampleEvents(&note, 1, 1, 128, 1) == ET_OK);
    std::array<et_sfz_sample_request, 8> requests{};
    unsigned count = 0;
    CHECK(player.kernel->takeSampleRequests(requests.data(), static_cast<unsigned>(requests.size()),
                                            count) == ET_OK);
    const auto requestedPage2 =
        std::any_of(requests.begin(), requests.begin() + count,
                    [](const auto &request) { return request.page_low == 2; });
    CHECK(requestedPage2 == (physicalKey == 60));
    std::array<float, 4096> page;
    page.fill(.25F);
    for (unsigned index = 0; index < count; ++index) {
      const auto &request = requests[index];
      CHECK(request.sample == 0 && request.page_high == 0 && request.page_low < 4);
      CHECK(player.kernel->publishSamplePage(91, 0, request.page_low, page.data(), 4096, 1, 0) ==
            ET_OK);
    }
    CHECK(player.kernel->prefetchSampleEvents(nullptr, 0, 1, 128, 2) == ET_OK);
    CHECK(player.events({note}) == ET_OK);
    player.process();
    const auto audible = std::any_of(player.audio.begin(), player.audio.begin() + 128,
                                     [](float value) { return std::abs(value) > .2F; });
    CHECK(audible == (physicalKey == 60));
    RuntimeEventState runtime{};
    player.kernel->readRuntimeEvent(runtime);
    CHECK(runtime.cause == 0 && runtime.latched == 0);
  }
}
void capturedPreparationContext() {
  Player player;
  const et_midi_transport_point point{0, 0, 0, 120, 4, 4};
  CHECK(player.kernel->setMidiTransportMap(&point, 1) == ET_OK);
  CHECK(player.kernel->minimumMidiPreparationBpm() == 30);
  const PrepareInfo candidate{48000, 2, 128, 15};
  const auto info = player.assetInfo(kFxSyncPayload, kFxSyncFootprint, candidate);
  auto *destination = player.kernel->beginAssetWithContext(0, info, candidate);
  CHECK(destination);
  if (!destination)
    return;
  std::memcpy(destination, kFxSyncPayload.data(), kFxSyncPayload.size());
  CHECK(player.kernel->minimumMidiPreparationBpm() == 30);
  CHECK(player.kernel->commitAsset(0, info.byteSize, ET_ASSET_F32_MULTICH) == ET_OK);
  for (unsigned block = 0; block < 16 && player.kernel->assetState(0) == ET_ASSET_STATE_PREPARING;
       ++block) {
    player.audio.fill(0);
    allocation_guard::Scope guard;
    player.kernel->process(player.audio.data(), 2, 128, {block * 128.0 / 48000});
  }
  CHECK(player.kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
  CHECK(player.kernel->minimumMidiPreparationBpm() == 30);
  const et_midi_transport_point candidateMap{0, 0, 0, 60, 4, 4};
  CHECK(player.kernel->setMidiTransportMap(&candidateMap, 1) == ET_OK);
  CHECK(player.kernel->setMidiTransport(
            0, 0, .25, 60, ET_MIDI_TRANSPORT_ENABLED | ET_MIDI_TRANSPORT_PLAYING) == ET_OK);
  CHECK(player.events({}, ET_MIDI_RESET) == ET_OK);
  CHECK(player.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
  player.process();
}
void combPreparationBudget() {
  for (const float rate : {48000.0F, 96000.0F}) {
    const PrepareInfo preparation{rate, 2, 128, 0};
    AssetBeginInfo info{1,
                        static_cast<unsigned>((kFutureNoiseCombPayload.size() - 32u) / 4u),
                        0,
                        0,
                        1,
                        0,
                        0,
                        2,
                        kFutureNoiseCombBaseFootprint,
                        static_cast<unsigned>(kFutureNoiseCombPayload.size())};
    std::uint64_t additional = 0;
    CHECK(SFZBank::estimateSfzEffects(preparation, info, kFutureNoiseCombPayload.data(),
                                      ET_ASSET_F32_MULTICH, additional) == ET_OK);
    CHECK(additional > 1000000 && additional < UINT32_MAX - info.byteSize);
    info.footprintBytes = info.byteSize + static_cast<unsigned>(additional);
    for (const bool shortBudget : {false, true}) {
      SFZBank bank;
      CHECK(bank.allocate(info) == ET_OK);
      std::memcpy(bank.payload_.data(), kFutureNoiseCombPayload.data(),
                  kFutureNoiseCombPayload.size());
      CHECK(bank.commit(info.byteSize, ET_ASSET_F32_MULTICH) == ET_OK);
      bank.prepareSlice(UINT64_MAX);
      CHECK(bank.state_ == ET_ASSET_STATE_ACTIVE);
      // The complete public query already charged native base ownership. Check
      // the remaining concrete processing reservation independently.
      const auto processing = bank.sfz_effect_budget_bytes_;
      CHECK(processing > 1000000);
      bank.sfz_effect_budget_bytes_ = processing - (shortBudget ? 1u : 0u);
      CHECK(bank.prepareProcessing(preparation) == (shortBudget ? ET_ERR_OOM : ET_OK));
      const auto actual = bank.comb_samples_.size() * sizeof(float) +
                          bank.comb_writes_.size() * sizeof(CombWrite) +
                          bank.comb_journals_.size() * sizeof(CombJournal);
      if (shortBudget)
        CHECK(actual == 0 && !bank.modulation_prepared_);
      else
        CHECK(actual == processing && bank.sfz_effect_budget_bytes_ == 0);
    }
  }
}
void storageFormatsAndResidency() {
  constexpr unsigned frames = SamplePageCache::kPageFrames;
  std::array<float, frames * 2> pcm{};
  for (unsigned i = 0; i < pcm.size(); ++i)
    pcm[i] = static_cast<float>(static_cast<int>(i % 2048) - 1024) / 32768.0F;
  const std::array metadata{SampleMetadata{frames * 3u, 2u, 48000u},
                            SampleMetadata{frames * 3u, 2u, 48000u}};
  const std::array<std::uint8_t, 2> modes{0, 1};
  SamplePageCache mixed;
  CHECK(mixed.configure(92, metadata.data(), metadata.size(), 4, 2, modes.data()));
  SamplePageCache::StorageRequirements f32, i16, both;
  CHECK(SamplePageCache::storageRequirements(1, 4, 0, 2, f32, true));
  CHECK(SamplePageCache::storageRequirements(1, 4, 4, 2, i16, true));
  CHECK(SamplePageCache::storageRequirements(2, 4, 2, 2, both, true));
  CHECK(f32.pcmBytes == i16.pcmBytes * 2);
  CHECK(mixed.capacityBytes() == both.pcmBytes);
  {
    allocation_guard::Scope guard;
    CHECK(mixed.publish({92, 0, 0}, pcm.data(), frames, 2, true));
    CHECK(mixed.publish({92, 0, 1}, pcm.data(), frames, 2, true));
    for (const auto sample : {0u, 1u}) {
      std::array<float, 4> window;
      const float *view = nullptr;
      bool allMissing = true;
      CHECK(mixed.readWindow(sample, frames - 2, 4, 1, window.data(), &view, &allMissing) ==
            SampleReadStatus::Unavailable);
      CHECK(!allMissing && window[0] == pcm[(frames - 2) * 2 + 1] &&
            window[1] == pcm[(frames - 1) * 2 + 1] && window[2] == 0 && window[3] == 0);
      window.fill(-1);
      CHECK(mixed.readWindow(sample, frames + 2, 4, 1, window.data(), &view, &allMissing) ==
            SampleReadStatus::Unavailable);
      CHECK(allMissing &&
            std::all_of(window.begin(), window.end(), [](float x) { return x == 0; }));
    }
    std::array<SamplePageRequest, 2> requests;
    CHECK(mixed.takeRequests(requests.data(), 2) == 2);
    CHECK(mixed.takeRequests(requests.data(), 2) == 0);
    for (const auto sample : {0u, 1u}) {
      CHECK(mixed.publish({92, 1, sample}, pcm.data(), frames, 2));
      std::array<float, 514> scratch{};
      CHECK(mixed.readWindow(sample, 4000, 514, 1, scratch.data()) == SampleReadStatus::Ready);
      for (unsigned i = 0; i < scratch.size(); ++i)
        CHECK(scratch[i] == pcm[((4000 + i) % frames) * 2 + 1]);
    }
    CHECK(mixed.beginForecast());
    CHECK(mixed.requestWindow(1, 0, frames * 2));
    CHECK(mixed.commitForecast());
    mixed.beginQuantum();
    CHECK(!mixed.publish({92, 2, 1}, pcm.data(), frames, 2));
    mixed.clearForecast();
    CHECK(mixed.publish({92, 2, 1}, pcm.data(), frames, 2));
  }
  for (const auto mode : std::array<std::uint8_t, 2>{0, 1}) {
    SamplePageCache mono;
    const SampleMetadata metadataMono{frames, 1, 48000};
    CHECK(mono.configure(93, &metadataMono, 1, 1, mode ? 1 : 0, &mode));
    CHECK(mono.publish({93, 0, 0}, pcm.data(), frames, 1));
    SampleReadStatus status;
    const auto *borrow = mono.readyMonoWindow(0, 100, 100, &status);
    CHECK(status == SampleReadStatus::Ready && ((borrow != nullptr) == (mode == 0)));
  }

  Player floating, packed;
  const auto open = [&](Player &player, std::span<const std::uint8_t> payload, unsigned base) {
    const PrepareInfo preparation{48000, 2, 128, 0};
    const auto info = player.assetInfo(payload, base, preparation);
    auto *destination = player.kernel->beginAssetWithContext(0, info, preparation);
    CHECK(destination);
    if (!destination)
      return false;
    std::memcpy(destination, payload.data(), payload.size());
    CHECK(player.kernel->commitAsset(0, info.byteSize, ET_ASSET_F32_MULTICH) == ET_OK);
    CHECK(player.kernel->configureSampleStream(94) == ET_OK);
    CHECK(player.kernel->assetState(0) == ET_ASSET_STATE_PREPARING);
    // Only the authored source window is pinned. The actual onset is page1.
    CHECK(player.kernel->publishSamplePage(94, 0, 0, pcm.data(), frames, 2, 1) == ET_OK);
    CHECK(player.kernel->assetState(0) == ET_ASSET_STATE_ACTIVE);
    CHECK(player.events({}, ET_MIDI_RESET) == ET_OK);
    CHECK(player.kernel->setMidiClock(0, 1, ET_MIDI_CLOCK_RUNNING) == ET_OK);
    CHECK(player.events({message(0, 0x90, 60, 127)}) == ET_OK);
    return true;
  };
  if (!open(floating, kStorage0Payload, kStorage0BaseFootprint) ||
      !open(packed, kStorage1Payload, kStorage1BaseFootprint))
    return;
  const auto cost0 =
      floating.assetInfo(kStorage0Payload, kStorage0BaseFootprint, {48000, 2, 128, 0})
          .footprintBytes;
  const auto cost1 =
      packed.assetInfo(kStorage1Payload, kStorage1BaseFootprint, {48000, 2, 128, 0}).footprintBytes;
  CHECK(cost0 - cost1 == 8u * frames * 2u * 2u);
  unsigned retries = 0;
  for (unsigned block = 0; block < 112; ++block) {
    for (auto *player : {&floating, &packed}) {
      const auto clock = player->kernel->midiClock();
      bool complete = false;
      for (unsigned attempt = 0; attempt < 5; ++attempt) {
        player->audio.fill(0);
        et_status status;
        {
          allocation_guard::Scope guard;
          status = player->kernel->processOffline(player->audio.data(), 2, 128, {player->time});
        }
        if (status == ET_OK) {
          complete = true;
          break;
        }
        CHECK(status == ET_NEED_SAMPLE && player->kernel->midiClock() == clock);
        std::array<et_sfz_sample_request, 8> requests;
        unsigned count = 0;
        CHECK(player->kernel->takeSampleRequests(requests.data(), 8, count) == ET_OK && count > 0);
        for (unsigned i = 0; i < count; ++i) {
          const auto &request = requests[i];
          CHECK(request.page_low > 0 && request.page_low < 4);
          CHECK(player->kernel->publishSamplePage(94, request.sample, request.page_low, pcm.data(),
                                                  frames, 2, 0) == ET_OK);
        }
        ++retries;
      }
      CHECK(complete && player->kernel->midiClock() == clock + 128);
      player->time += 128.0 / 48000.0;
    }
    CHECK(floating.audio == packed.audio);
  }
  CHECK(retries >= 4);
  CHECK(packed.energy() > 0);
}

} // namespace
int main() {
  storageFormatsAndResidency();
  resolvedPlaybackAndHostTransport();
  amplifierVelocityResponse();
  shiftedNoteForecast();
  voiceDspAndNoise();
  globalSources();
  outputAndBudget();
  beatTiming();
  sparseGlobalInitialization();
  pagedEffectsRetry(kFxPagedPayload, kFxPagedFootprint);
  pagedEffectsRetry(kFuturePagedVoiceNoisePayload, kFuturePagedVoiceNoiseBaseFootprint);
  capturedPreparationContext();
  combPreparationBudget();
  return failures ? 1 : 0;
}

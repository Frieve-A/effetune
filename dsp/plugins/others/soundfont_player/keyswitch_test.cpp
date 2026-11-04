#include "../../../test/sample_player_fixture.h"
#include "SoundFontPlayerPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"
#include "keyswitch_fixture.h"
#include <array>
#include <bit>
#include <cstdio>
#include <cstdlib>
#include <memory>
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_SoundFontPlayerPlugin() noexcept;
using namespace effetune;
static void require(bool value, const char *message) {
  if (!value) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
static std::array<std::int16_t, 16> switches(PluginKernel &kernel) {
  std::array<std::uint8_t, 4096> storage{}, packet{};
  TelemetryRing ring;
  ring.adopt(storage.data(), static_cast<unsigned>(storage.size()));
  std::uint32_t sequence = 0;
  TelemetryWriter writer(ring, 7, sequence);
  {
    allocation_guard::Scope guard;
    kernel.writeTelemetry(writer);
  }
  const auto count = ring.read(packet.data(), static_cast<unsigned>(packet.size()), nullptr);
  const auto u16 = [&](unsigned at) {
    return static_cast<std::uint16_t>(packet[at] | static_cast<unsigned>(packet[at + 1]) << 8u);
  };
  for (unsigned at = 0; at < count; at += (16u + u16(at + 12u) + 3u) & ~3u) {
    if (u16(at) != 34u)
      continue;
    require(u16(at + 2) == 1 && u16(at + 12) == 32,
            "frame34 exact version and sixteen-channel shape");
    std::array<std::int16_t, 16> result{};
    for (unsigned channel = 0; channel < 16; ++channel)
      result[channel] = std::bit_cast<std::int16_t>(u16(at + 16u + channel * 2u));
    return result;
  }
  std::abort();
}
int main() {
  alignas(std::max_align_t) std::array<std::byte, 16384> storage{};
  const auto *descriptor = et_kernel_descriptor_SoundFontPlayerPlugin();
  auto *kernel = descriptor->construct(storage.data());
  kernel->prepare({48000, 2, 128});
  require(kernel->preparedSuccessfully(), "kernel prepare");
  const generated::SoundFontPlayerPluginParams params{0, 64, 0, 0};
  require(kernel->stageParameters(reinterpret_cast<const float *>(&params), params.kFloatCount,
                                  descriptor->paramsHash) == ET_OK,
          "normal parameters");
  kernel->applyPendingParameters();
  AssetBeginInfo info{1,
                      static_cast<std::uint32_t>((kKeyswitchPayload.size() - 32) / 4),
                      0,
                      0,
                      1,
                      0,
                      0,
                      2,
                      kKeyswitchFootprint,
                      static_cast<std::uint32_t>(kKeyswitchPayload.size())};
  require(test::addSamplePlayerFixtureStorage(info, kKeyswitchPayload, {48000, 2, 128},
                                              ET_SAMPLE_PLAYER_MAIN) == ET_OK,
          "normal bank preparation storage");
  std::unique_ptr<PreparedAsset> asset;
  require(kernel->assetPreparer(0)({48000, 2, 128}, info, kKeyswitchPayload.data(), 1, asset) ==
              ET_OK,
          "normal authored switch bank");
  require(kernel->exchangePreparedAsset(0, asset) == ET_OK, "activate bank");
  kernel->reset();
  require(kernel->setMidiEvents(nullptr, 0, 1, ET_MIDI_RESET) == ET_OK, "fresh generation");
  std::array<float, 256> audio{};
  const auto process = [&] {
    audio.fill(0);
    allocation_guard::Scope guard;
    kernel->process(audio.data(), 2, 128, {0});
  };
  const auto note = [&](unsigned channel, unsigned key, unsigned identity) {
    const et_midi_event event{0, (0x90u | channel) | (key << 8u) | (100u << 16u), identity, 0, 0,
                              0};
    require(kernel->setMidiEvents(&event, 1, 1, 0) == ET_OK, "accepted note event");
    process();
  };
  process();
  auto selected = switches(*kernel);
  require(selected[0] == 24 && selected[1] == 36 && selected[2] == -1,
          "channel-scoped defaults and unset");
  note(0, 25, 1);
  note(0, 60, 2);
  note(1, 37, 3);
  note(1, 25, 4);
  selected = switches(*kernel);
  require(selected[0] == 25 && selected[1] == 37 && selected[2] == -1,
          "ordinary notes and other-channel switch ranges do not replace accepted switch");
  note(0, 26, 5);
  require(switches(*kernel)[0] == 26, "latest accepted configured switch wins");
  descriptor->destroy(kernel);
  std::puts("SFZ native keyswitch telemetry tests passed");
}

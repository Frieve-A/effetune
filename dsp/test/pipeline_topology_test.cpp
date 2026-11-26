#include "allocation_guard.h"
#include "engine.h"
#include <algorithm>
#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <vector>

namespace {
using namespace effetune;
void check(bool value, const char *message) {
  if (!value) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
struct Route {
  et_instance instance;
  std::int8_t channel;
  std::uint8_t input = 0, output = 0;
};
std::vector<std::uint8_t> descriptor(const std::vector<Route> &nodes) {
  std::vector<std::uint8_t> bytes(8 + 12 * nodes.size());
  bytes[0] = 1;
  bytes[4] = static_cast<std::uint8_t>(nodes.size());
  for (std::size_t i = 0; i < nodes.size(); ++i) {
    auto *row = bytes.data() + 8 + 12 * i;
    std::memcpy(row, &nodes[i].instance, 4);
    row[4] = row[8] = 1;
    row[5] = nodes[i].input;
    row[6] = nodes[i].output;
    row[7] = static_cast<std::uint8_t>(nodes[i].channel);
  }
  return bytes;
}
} // namespace

int main() {
  using namespace effetune;
  auto engine = std::make_unique<Engine>();
  check(engine->prepare(48000, 2, 128, 0) == ET_OK, "prepare");
  const auto delay = engine->createInstance("TestDelayPlugin");
  const auto unity = engine->createInstance("VolumePlugin");
  const auto before = descriptor({{delay, std::int8_t{0}}});
  const auto after = descriptor({{unity, std::int8_t{-2}}, {delay, std::int8_t{0}}});
  check(engine->configurePipeline(before.data(), static_cast<std::uint32_t>(before.size())) ==
            ET_OK,
        "initial pipeline");
  // L has a 192-frame kernel delay. R is given an equal output-compensation delay.
  engine->combined()[0] = 0.75f;
  engine->combined()[128] = -0.25f;
  check(engine->processPipeline(2, 128, 0, 0) == ET_OK, "prime histories");
  Engine::PipelineTopologySnapshot snapshot;
  check(engine->capturePipelineTopology(after.data(), static_cast<std::uint32_t>(after.size()),
                                        snapshot) == ET_OK,
        "capture");
  Engine::PipelineLatencyUpdate prepared;
  check(Engine::preparePipelineTopology(snapshot, prepared) == ET_OK, "prepare update");
  {
    allocation_guard::Scope guard;
    check(!engine->topologyNeedsGate(snapshot, prepared),
          "adding zero-delay unit should preserve signal");
    check(engine->publishPipelineTopology(snapshot, prepared) == ET_OK, "publish");
    check(engine->publishPipelineTopology(snapshot, prepared) == ET_ERR_STATE,
          "reject consumed update");
  }
  std::fill_n(engine->combined(), 256, 0.0f);
  check(engine->processPipeline(2, 128, 128.0 / 48000.0, 0) == ET_OK, "after insertion");
  check(engine->combined()[64] == 0.75f && engine->combined()[128 + 64] == -0.25f,
        "kernel and output compensation histories must both survive");
  const auto substitute = engine->createInstance("VolumePlugin");
  check(engine->setInstanceTap(unity, 17) == ET_OK &&
            engine->setInstanceTap(substitute, 17) == ET_OK,
        "stable logical node");
  const auto original = descriptor({{delay, std::int8_t{0}}, {unity, std::int8_t{-2}}});
  const auto swapped = descriptor({{delay, std::int8_t{0}}, {substitute, std::int8_t{-2}}});
  check(engine->configurePipeline(original.data(), static_cast<unsigned>(original.size())) == ET_OK,
        "configure time-aligned node");
  std::fill_n(engine->combined(), 256, 0.f);
  engine->combined()[128] = .375f;
  check(engine->processPipeline(2, 128, 0, 0) == ET_OK, "prime logical node compensation");
  check(engine->capturePipelineTopology(swapped.data(), static_cast<unsigned>(swapped.size()),
                                        snapshot) == ET_OK &&
            Engine::preparePipelineTopology(snapshot, prepared) == ET_OK &&
            !engine->topologyNeedsGate(snapshot, prepared) &&
            engine->publishPipelineTopology(snapshot, prepared) == ET_OK,
        "replace display instance with bypass");
  std::fill_n(engine->combined(), 256, 0.f);
  check(engine->processPipeline(2, 128, 128. / 48000., 0) == ET_OK &&
            engine->combined()[128 + 64] == .375f,
        "replacement preserved the right-channel impulse");

  const auto parallel = descriptor({{unity, -2, 0, 1}, {delay, -2}, {substitute, -2, 1, 0}});
  check(engine->configurePipeline(parallel.data(), static_cast<unsigned>(parallel.size())) == ET_OK,
        "configure delayed main path and unity return");
  Engine::RoutedTaps taps;
  engine->tracePipelineOutputs(0, taps);
  check(taps[2].instance == substitute && taps[2].output.local == 192 && taps[2].input.local == 192,
        "unity return observes both taps before incoming merge compensation");

  const auto align = descriptor({{unity, 1}, {delay, 0}, {substitute, -2}});
  check(engine->configurePipeline(align.data(), static_cast<unsigned>(align.size())) == ET_OK,
        "configure stereo send with right input compensation");
  engine->tracePipelineOutputs(substitute, taps);
  check(taps[2].instance == substitute && taps[2].input.local == 0 && taps[2].input.network == 0 &&
            taps[2].output.network == -1,
        "send marker observes aligned input before taking the network branch");
  check(taps[0].instance == unity && taps[0].output.local == 192 && taps[0].output.network == 192,
        "upstream right channel traverses the alignment delay to both outputs");
}

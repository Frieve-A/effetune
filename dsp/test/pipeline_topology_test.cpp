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
std::vector<std::uint8_t>
descriptor(const std::vector<std::pair<et_instance, std::int8_t>> &nodes) {
  std::vector<std::uint8_t> bytes(8 + 12 * nodes.size());
  bytes[0] = 1;
  bytes[4] = static_cast<std::uint8_t>(nodes.size());
  for (std::size_t i = 0; i < nodes.size(); ++i) {
    auto *row = bytes.data() + 8 + 12 * i;
    std::memcpy(row, &nodes[i].first, 4);
    row[4] = row[8] = 1;
    row[7] = static_cast<std::uint8_t>(nodes[i].second);
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
}

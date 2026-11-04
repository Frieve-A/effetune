#include "../generated/cpp/RoomEqPluginParams.h"
#include "../generated/cpp/SoundFontPlayerPluginParams.h"
#include "../plugins/others/soundfont_player/effects_fixture.h"
#include "../plugins/others/soundfont_player/sf2_fixture.h"
#include "allocation_guard.h"
#include "effetune/abi.h"
#include "engine.h"
#include "test_support.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <span>
#include <string>
#include <vector>

namespace {

int failures = 0;

#define GRAPH_CHECK(expression)                                                                    \
  do {                                                                                             \
    if (!(expression)) {                                                                           \
      std::fprintf(stderr, "%s:%d: check failed: %s\n", __FILE__, __LINE__, #expression);          \
      ++failures;                                                                                  \
    }                                                                                              \
  } while (false)

constexpr std::uint32_t kEndpoint = 0xffffffffu;
constexpr std::uint32_t kEnabled = 1u;
constexpr std::uint32_t kRequiresAsset = 2u;
constexpr std::uint32_t kUniformLatency = 4u;
constexpr std::uint32_t kMute = 1u;
constexpr std::uint32_t kSolo = 2u;
constexpr std::uint32_t kPan = 4u;
constexpr std::uint32_t kTestGainHash = 0xa17e5eedu;
constexpr std::uint32_t kVolumeHash = 0x66796aa7u;
constexpr std::uint32_t kIrReverbHash = 0x96be6b1au;

struct NodeRecord {
  et_instance instance;
  std::string id;
  std::uint32_t flags = kEnabled;
  std::int32_t channel = -2;
};

struct EdgeRecord {
  std::uint32_t source;
  std::uint32_t destination;
  std::string id;
  std::string mixGroup;
  float gain = 1.0F;
  float pan = 0.0F;
  std::uint32_t flags = 0u;
};

void writeU32(std::uint8_t *output, std::uint32_t value) {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>((value >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((value >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>(value >> 24u);
}

std::uint32_t readU32(const std::uint8_t *input) {
  return static_cast<std::uint32_t>(input[0]) | (static_cast<std::uint32_t>(input[1]) << 8u) |
         (static_cast<std::uint32_t>(input[2]) << 16u) |
         (static_cast<std::uint32_t>(input[3]) << 24u);
}

void writeF32(std::uint8_t *output, float value) {
  writeU32(output, std::bit_cast<std::uint32_t>(value));
}

std::vector<std::uint8_t> descriptor(const std::vector<NodeRecord> &nodes,
                                     const std::vector<EdgeRecord> &edges) {
  constexpr std::uint32_t header_bytes = 32u;
  constexpr std::uint32_t node_bytes = 24u;
  constexpr std::uint32_t edge_bytes = 40u;
  std::vector<std::uint8_t> strings;
  struct Range {
    std::uint32_t offset;
    std::uint32_t length;
  };
  const auto append = [&strings](const std::string &value) {
    const Range range{static_cast<std::uint32_t>(strings.size()),
                      static_cast<std::uint32_t>(value.size())};
    strings.insert(strings.end(), value.begin(), value.end());
    return range;
  };
  std::vector<Range> node_ids;
  std::vector<std::array<Range, 2>> edge_strings;
  for (const NodeRecord &node : nodes) {
    node_ids.push_back(append(node.id));
  }
  for (const EdgeRecord &edge : edges) {
    edge_strings.push_back(
        {append(edge.id), append(edge.mixGroup.empty() ? "default" : edge.mixGroup)});
  }
  std::vector<std::uint8_t> result(
      header_bytes + nodes.size() * node_bytes + edges.size() * edge_bytes + strings.size(), 0u);
  writeU32(result.data(), 0x31475445u);
  writeU32(result.data() + 4u, 1u);
  writeU32(result.data() + 8u, static_cast<std::uint32_t>(nodes.size()));
  writeU32(result.data() + 12u, static_cast<std::uint32_t>(edges.size()));
  writeU32(result.data() + 16u, static_cast<std::uint32_t>(strings.size()));
  for (std::uint32_t index = 0u; index < nodes.size(); ++index) {
    std::uint8_t *record = result.data() + header_bytes + index * node_bytes;
    writeU32(record, nodes[index].instance);
    writeU32(record + 4u, node_ids[index].offset);
    writeU32(record + 8u, node_ids[index].length);
    writeU32(record + 12u, nodes[index].flags);
    writeU32(record + 16u, std::bit_cast<std::uint32_t>(nodes[index].channel));
  }
  const std::uint32_t edges_offset =
      header_bytes + static_cast<std::uint32_t>(nodes.size()) * node_bytes;
  for (std::uint32_t index = 0u; index < edges.size(); ++index) {
    std::uint8_t *record = result.data() + edges_offset + index * edge_bytes;
    writeU32(record, edges[index].source);
    writeU32(record + 4u, edges[index].destination);
    writeU32(record + 8u, edge_strings[index][0].offset);
    writeU32(record + 12u, edge_strings[index][0].length);
    writeU32(record + 16u, edge_strings[index][1].offset);
    writeU32(record + 20u, edge_strings[index][1].length);
    writeF32(record + 24u, edges[index].gain);
    writeF32(record + 28u, edges[index].pan);
    writeU32(record + 32u, edges[index].flags);
  }
  std::memcpy(result.data() + edges_offset + edges.size() * edge_bytes, strings.data(),
              strings.size());
  return result;
}

et_engine makeEngine(std::uint32_t channels = 2u) {
  const et_engine engine = et_engine_create();
  GRAPH_CHECK(engine != 0u);
  GRAPH_CHECK(et_engine_prepare(engine, 48000.0F, channels, 128u, 256u) == ET_OK);
  return engine;
}

et_instance makeGain(et_engine engine, float gain = 1.0F) {
  const et_instance instance = et_instance_create(engine, "TestGainPlugin");
  GRAPH_CHECK(instance != 0u);
  GRAPH_CHECK(et_instance_set_params(engine, instance, &gain, 1u, kTestGainHash, 0u) == ET_OK);
  return instance;
}

void testCapabilityAndIdentity() {
  GRAPH_CHECK((et_build_flags() & ET_BUILD_GRAPH) != 0u);
  GRAPH_CHECK((et_graph_capabilities() & ET_GRAPH_CAPABILITY_V1) != 0u);
  GRAPH_CHECK(et_graph_version() == 1u);
  const et_engine engine = makeEngine();
  const auto empty = descriptor({}, {});
  GRAPH_CHECK(et_graph_configure(engine, empty.data(), static_cast<std::uint32_t>(empty.size())) ==
              ET_OK);
  GRAPH_CHECK(et_graph_latency(engine) == 0u);
  float *audio = et_arena_combined_ptr(engine);
  audio[0] = 1.0F;
  audio[128] = -1.0F;
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.0) == ET_OK);
  GRAPH_CHECK(audio[0] == 1.0F && audio[128] == -1.0F);
  const std::uint32_t snapshot_size = et_graph_snapshot_size(engine);
  GRAPH_CHECK(snapshot_size == 192u);
  std::vector<std::uint8_t> snapshot(snapshot_size);
  GRAPH_CHECK(et_graph_snapshot_copy(engine, snapshot.data(), snapshot_size) == ET_OK);
  GRAPH_CHECK(readU32(snapshot.data()) == 0x31535445u);
  GRAPH_CHECK((readU32(snapshot.data() + 36u) & 1u) != 0u);
  et_engine_destroy(engine);
}

void testSerialDisabledAndControlMix() {
  const et_engine engine = makeEngine();
  const et_instance gain = makeGain(engine, 2.0F);
  auto serial =
      descriptor({{gain, "gain"}}, {{kEndpoint, 0u, "in", ""}, {0u, kEndpoint, "out", ""}});
  GRAPH_CHECK(et_graph_configure(engine, serial.data(),
                                 static_cast<std::uint32_t>(serial.size())) == ET_OK);
  float *audio = et_arena_combined_ptr(engine);
  std::fill_n(audio, 256u, 1.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.0) == ET_OK);
  GRAPH_CHECK(audio[0] == 2.0F && audio[255] == 2.0F);

  auto invalid = serial;
  writeU32(invalid.data() + 4u, 2u);
  GRAPH_CHECK(
      et_graph_configure(engine, invalid.data(), static_cast<std::uint32_t>(invalid.size())) ==
      ET_ERR_GRAPH_INVALID);
  std::fill_n(audio, 256u, 1.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.05) == ET_OK);
  GRAPH_CHECK(audio[0] == 2.0F && audio[255] == 2.0F);

  auto bypass =
      descriptor({{0u, "bypass", 0u}}, {{kEndpoint, 0u, "in", ""}, {0u, kEndpoint, "out", ""}});
  GRAPH_CHECK(et_graph_configure(engine, bypass.data(),
                                 static_cast<std::uint32_t>(bypass.size())) == ET_OK);
  std::fill_n(audio, 256u, 3.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.1) == ET_OK);
  GRAPH_CHECK(audio[0] == 3.0F && audio[255] == 3.0F);

  auto controls =
      descriptor({}, {{kEndpoint, kEndpoint, "normal", "mix", 4.0F, 0.0F, 0u},
                      {kEndpoint, kEndpoint, "solo", "mix", 2.0F, 1.0F, kSolo | kPan},
                      {kEndpoint, kEndpoint, "muted-solo", "mix", 4.0F, 0.0F, kMute | kSolo}});
  GRAPH_CHECK(et_graph_configure(engine, controls.data(),
                                 static_cast<std::uint32_t>(controls.size())) == ET_OK);
  std::fill_n(audio, 256u, 1.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.2) == ET_OK);
  GRAPH_CHECK(audio[0] == 0.0F && audio[128] == 2.0F);

  auto muted_solo = descriptor(
      {{gain, "volume"}}, {{kEndpoint, 0u, "input-volume", ""},
                           {kEndpoint, kEndpoint, "muted-solo", "main", 1.0F, 0.0F, kMute | kSolo},
                           {0u, kEndpoint, "volume-output", "main"}});
  GRAPH_CHECK(et_graph_configure(engine, muted_solo.data(),
                                 static_cast<std::uint32_t>(muted_solo.size())) == ET_OK);
  std::fill_n(audio, 256u, 1.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.3) == ET_OK);
  GRAPH_CHECK(std::all_of(audio, audio + 256u, [](float sample) { return sample == 0.0F; }));
  std::vector<std::uint8_t> muted_solo_snapshot(et_graph_snapshot_size(engine));
  GRAPH_CHECK(et_graph_snapshot_copy(engine, muted_solo_snapshot.data(),
                                     static_cast<std::uint32_t>(muted_solo_snapshot.size())) ==
              ET_OK);
  GRAPH_CHECK((readU32(muted_solo_snapshot.data() + 36u) & 2u) != 0u);
  const std::uint32_t nodes_offset = readU32(muted_solo_snapshot.data() + 52u);
  GRAPH_CHECK((readU32(muted_solo_snapshot.data() + nodes_offset) & 2u) != 0u);
  const std::uint32_t edges_offset = readU32(muted_solo_snapshot.data() + 56u);
  GRAPH_CHECK((readU32(muted_solo_snapshot.data() + edges_offset) & 4u) != 0u);
  GRAPH_CHECK((readU32(muted_solo_snapshot.data() + edges_offset + 80u) & 2u) != 0u);
  GRAPH_CHECK((readU32(muted_solo_snapshot.data() + edges_offset + 160u) & 2u) != 0u);
  et_engine_destroy(engine);
}

void testLatencyCompensationAndPreNodeAlignment() {
  constexpr std::uint32_t latency = 192u;
  const et_engine engine = makeEngine();
  const et_instance delay = et_instance_create(engine, "TestDelayPlugin");
  GRAPH_CHECK(delay != 0u);
  auto diamond = descriptor({{delay, "delay", kEnabled | kUniformLatency}},
                            {{kEndpoint, 0u, "wet-in", ""},
                             {0u, kEndpoint, "wet-out", ""},
                             {kEndpoint, kEndpoint, "dry", ""}});
  GRAPH_CHECK(et_graph_configure(engine, diamond.data(),
                                 static_cast<std::uint32_t>(diamond.size())) == ET_OK);
  GRAPH_CHECK(et_graph_latency(engine) == latency);
  float *audio = et_arena_combined_ptr(engine);
  std::fill_n(audio, 256u, 0.0F);
  audio[0] = 1.0F;
  audio[128] = 1.0F;
  const std::uint32_t before = effetune::allocation_guard::violationCount();
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.0) == ET_OK);
  GRAPH_CHECK(effetune::allocation_guard::violationCount() == before);
  std::fill_n(audio, 256u, 0.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 128.0 / 48000.0) == ET_OK);
  GRAPH_CHECK(audio[latency - 128u] == 2.0F);
  GRAPH_CHECK(audio[128u + latency - 128u] == 2.0F);

  GRAPH_CHECK(et_engine_reset(engine) == ET_OK);
  const et_instance stereo = makeGain(engine);
  auto aligned =
      descriptor({{delay, "left-delay", kEnabled | kUniformLatency, 0}, {stereo, "stereo"}},
                 {{kEndpoint, 0u, "a", ""}, {0u, 1u, "b", ""}, {1u, kEndpoint, "c", ""}});
  GRAPH_CHECK(et_graph_configure(engine, aligned.data(),
                                 static_cast<std::uint32_t>(aligned.size())) == ET_OK);
  GRAPH_CHECK(et_graph_latency(engine) == latency);
  const std::uint32_t snapshot_size = et_graph_snapshot_size(engine);
  std::vector<std::uint8_t> snapshot(snapshot_size);
  GRAPH_CHECK(et_graph_snapshot_copy(engine, snapshot.data(), snapshot_size) == ET_OK);
  const std::uint32_t nodes_offset = readU32(snapshot.data() + 52u);
  const std::uint8_t *stereo_record = snapshot.data() + nodes_offset + 224u;
  GRAPH_CHECK(readU32(stereo_record + 160u) == 0u);
  GRAPH_CHECK(readU32(stereo_record + 164u) == latency);
  std::fill_n(audio, 256u, 0.0F);
  audio[0] = 1.0F;
  audio[128] = 1.0F;
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.0) == ET_OK);
  std::fill_n(audio, 256u, 0.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 128.0 / 48000.0) == ET_OK);
  GRAPH_CHECK(audio[latency - 128u] == 1.0F);
  GRAPH_CHECK(audio[128u + latency - 128u] == 1.0F);
  et_engine_destroy(engine);
}

void testHostTransportFollowsNodeLatency() {
  auto engine = std::make_unique<effetune::Engine>();
  GRAPH_CHECK(engine->prepare(48000.0F, 2u, 128u, 0u) == ET_OK);
  const et_instance delay = engine->createInstance("TestDelayPlugin");
  const et_instance gain = engine->createInstance("TestGainPlugin");
  auto serial = descriptor({{delay, "delay", kEnabled | kUniformLatency}, {gain, "gain"}},
                           {{kEndpoint, 0u, "a", ""}, {0u, 1u, "b", ""}, {1u, kEndpoint, "c", ""}});
  GRAPH_CHECK(engine->configureGraph(serial.data(), static_cast<std::uint32_t>(serial.size())) ==
              ET_OK);
  effetune::HostTransport host{};
  host.flags = effetune::HostTransport::kPlaying | effetune::HostTransport::kTempoValid |
               effetune::HostTransport::kPositionValid;
  host.tempoBpm = 150.0;
  host.ppqPosition = 4.0;
  engine->setHostTransport(&host);
  GRAPH_CHECK(engine->processGraph(2u, 128u, 0.0) == ET_OK);
  const effetune::HostTransport *received =
      effetune::test::testGainTransport(et_engine_instance_kernel_for_testing(engine.get(), gain));
  GRAPH_CHECK(received != nullptr &&
              std::fabs(received->ppqPosition - (4.0 - 192.0 * 2.5 / 48000.0)) < 1e-12);
}

void testSixteenChannelLatencySnapshot() {
  auto engine_storage = std::make_unique<effetune::Engine>();
  effetune::Engine &engine = *engine_storage;
  GRAPH_CHECK(engine.prepare(48000.0F, 16u, 128u, 0u) == ET_OK);
  std::vector<NodeRecord> nodes;
  std::vector<EdgeRecord> edges;
  const auto append = [&](et_instance instance, const std::string &id, std::int32_t channel) {
    const auto index = static_cast<std::uint32_t>(nodes.size());
    nodes.push_back({instance, id, kEnabled | kUniformLatency, channel});
    edges.push_back({index == 0u ? kEndpoint : index - 1u, index, "in-" + id, ""});
  };
  for (std::uint32_t channel = 0u; channel < 16u; ++channel) {
    const et_instance room = engine.createInstance("RoomEqPlugin");
    const std::array<float, 4> params{1.0F, static_cast<float>(channel + 1u), 0.0F, 0.0F};
    GRAPH_CHECK(engine.setInstanceParams(room, params.data(), 4u,
                                         effetune::generated::RoomEqPluginParams::kHash,
                                         0u) == ET_OK);
    auto *payload =
        engine.beginInstanceAsset(room, 0u, {1u, 1u, 1u, 128u, 1u, 0u, 0u, 1u, 65536u, 36u});
    GRAPH_CHECK(payload != nullptr);
    if (payload == nullptr) {
      return;
    }
    std::memset(payload, 0, 36u);
    writeU32(payload, 0x31415445u);
    writeU32(payload + 4u, 1u);
    writeU32(payload + 8u, 1u);
    writeU32(payload + 12u, 48000u);
    writeU32(payload + 16u, 1u);
    writeF32(payload + 32u, 1.0F);
    GRAPH_CHECK(engine.commitInstanceAsset(room, 0u, 36u, ET_ASSET_F32_MULTICH) == ET_OK);
    std::array<float, 128> silence{};
    for (std::uint32_t calls = 0u;
         (engine.instanceAssetState(room, 0u) & 0xffu) == ET_ASSET_STATE_PREPARING && calls < 64u;
         ++calls) {
      GRAPH_CHECK(engine.processInstance(room, silence.data(), 1u, 128u, 0.0) == ET_OK);
    }
    GRAPH_CHECK((engine.instanceAssetState(room, 0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
    GRAPH_CHECK(engine.resetInstance(room) == ET_OK);
    append(room, "room-" + std::to_string(channel), static_cast<std::int32_t>(channel));
  }
  edges.push_back({15u, kEndpoint, "out", ""});
  const auto unaligned = descriptor(nodes, edges);
  GRAPH_CHECK(engine.configureGraph(unaligned.data(),
                                    static_cast<std::uint32_t>(unaligned.size())) == ET_OK);
  std::vector<std::uint8_t> unaligned_snapshot(engine.graphSnapshotSize());
  if (unaligned_snapshot.empty())
    return;
  GRAPH_CHECK(engine.copyGraphSnapshot(unaligned_snapshot.data(),
                                       static_cast<std::uint32_t>(unaligned_snapshot.size())) ==
              ET_OK);
  for (std::uint32_t channel = 0u; channel < 16u; ++channel) {
    GRAPH_CHECK(readU32(unaligned_snapshot.data() + 64u + channel * 4u) == 129u + channel);
    GRAPH_CHECK(readU32(unaligned_snapshot.data() + 128u + channel * 4u) == 15u - channel);
  }
  edges.pop_back();
  const et_instance volume = engine.createInstance("VolumePlugin");
  const float unity = 0.0F;
  GRAPH_CHECK(engine.setInstanceParams(volume, &unity, 1u, kVolumeHash, 0u) == ET_OK);
  append(volume, "align", -2);
  edges.push_back({kEndpoint, 16u, "dry-align", ""});
  edges.push_back({16u, kEndpoint, "out", ""});
  const auto graph = descriptor(nodes, edges);
  GRAPH_CHECK(engine.configureGraph(graph.data(), static_cast<std::uint32_t>(graph.size())) ==
              ET_OK);
  std::vector<std::uint8_t> snapshot(engine.graphSnapshotSize());
  if (snapshot.empty())
    return;
  GRAPH_CHECK(engine.copyGraphSnapshot(snapshot.data(),
                                       static_cast<std::uint32_t>(snapshot.size())) == ET_OK);
  const auto nodes_offset = readU32(snapshot.data() + 52u);
  const auto edges_offset = readU32(snapshot.data() + 56u);
  const auto *align = snapshot.data() + nodes_offset + 16u * 224u;
  const auto *dry = snapshot.data() + edges_offset + 17u * 80u;
  for (std::uint32_t channel = 0u; channel < 16u; ++channel) {
    GRAPH_CHECK(readU32(align + 32u + channel * 4u) == 129u + channel);
    GRAPH_CHECK(readU32(align + 96u + channel * 4u) == 144u);
    GRAPH_CHECK(readU32(align + 160u + channel * 4u) == 15u - channel);
    GRAPH_CHECK(readU32(dry + 16u + channel * 4u) == 129u + channel);
  }
}

void testValidationPreparationAndWideGraph() {
  const et_engine engine = makeEngine();
  auto dormant =
      descriptor({{0u, "dormant", kEnabled}},
                 {{kEndpoint, 0u, "in", ""}, {0u, kEndpoint, "muted-out", "", 1.0F, 0.0F, kMute}});
  GRAPH_CHECK(et_graph_configure(engine, dormant.data(),
                                 static_cast<std::uint32_t>(dormant.size())) == ET_OK);
  std::vector<std::uint8_t> dormant_snapshot(et_graph_snapshot_size(engine));
  GRAPH_CHECK(et_graph_snapshot_copy(engine, dormant_snapshot.data(),
                                     static_cast<std::uint32_t>(dormant_snapshot.size())) == ET_OK);
  const std::uint32_t dormant_nodes_offset = readU32(dormant_snapshot.data() + 52u);
  GRAPH_CHECK((readU32(dormant_snapshot.data() + dormant_nodes_offset) & 2u) != 0u);

  const et_instance delay = et_instance_create(engine, "TestDelayPlugin");
  GRAPH_CHECK(delay != 0u);
  auto authoritative_latency =
      descriptor({{delay, "delay"}}, {{kEndpoint, 0u, "in", ""}, {0u, kEndpoint, "out", ""}});
  GRAPH_CHECK(et_graph_configure(engine, authoritative_latency.data(),
                                 static_cast<std::uint32_t>(authoritative_latency.size())) ==
              ET_OK);

  const et_instance asset = makeGain(engine);
  auto forged_asset_flag = descriptor({{asset, "asset", kEnabled | kRequiresAsset}},
                                      {{kEndpoint, 0u, "in", ""}, {0u, kEndpoint, "out", ""}});
  GRAPH_CHECK(et_graph_configure(engine, forged_asset_flag.data(),
                                 static_cast<std::uint32_t>(forged_asset_flag.size())) == ET_OK);

  const et_instance required_asset = et_instance_create(engine, "GroupDelayEqPlugin");
  GRAPH_CHECK(required_asset != 0u);
  auto omitted_asset_flag = descriptor({{required_asset, "required-asset"}},
                                       {{kEndpoint, 0u, "in", ""}, {0u, kEndpoint, "out", ""}});
  GRAPH_CHECK(et_graph_configure(engine, omitted_asset_flag.data(),
                                 static_cast<std::uint32_t>(omitted_asset_flag.size())) ==
              ET_ERR_GRAPH_INSTANCE_PREPARE);
  et_graph_diagnostic diagnostic{};
  GRAPH_CHECK(et_graph_read_diagnostic(engine, &diagnostic) == ET_OK);
  GRAPH_CHECK(diagnostic.kind == ET_GRAPH_DIAGNOSTIC_NODE && diagnostic.index == 0u &&
              diagnostic.path == ET_GRAPH_PATH_NODE_ASSET);

  auto cycle =
      descriptor({{makeGain(engine), "a"}, {makeGain(engine), "b"}}, {{kEndpoint, 0u, "in", ""},
                                                                      {0u, 1u, "ab", ""},
                                                                      {1u, 0u, "ba", ""},
                                                                      {1u, kEndpoint, "out", ""}});
  GRAPH_CHECK(et_graph_configure(engine, cycle.data(), static_cast<std::uint32_t>(cycle.size())) ==
              ET_ERR_GRAPH_CYCLE);

  std::vector<NodeRecord> nodes;
  std::vector<EdgeRecord> edges;
  for (std::uint32_t index = 0u; index < 6u; ++index) {
    nodes.push_back({makeGain(engine), std::string("branch-") + static_cast<char>('f' - index)});
    edges.push_back({kEndpoint, index, std::string("in-") + static_cast<char>('a' + index), ""});
    edges.push_back({index, kEndpoint, std::string("out-") + static_cast<char>('a' + index), ""});
  }
  auto wide = descriptor(nodes, edges);
  GRAPH_CHECK(et_graph_configure(engine, wide.data(), static_cast<std::uint32_t>(wide.size())) ==
              ET_OK);
  const std::uint32_t snapshot_size = et_graph_snapshot_size(engine);
  std::vector<std::uint8_t> snapshot(snapshot_size);
  GRAPH_CHECK(et_graph_snapshot_copy(engine, snapshot.data(), snapshot_size) == ET_OK);
  GRAPH_CHECK(readU32(snapshot.data() + 24u) == 7u);
  GRAPH_CHECK(readU32(snapshot.data() + readU32(snapshot.data() + 48u)) == 5u);
  float *audio = et_arena_combined_ptr(engine);
  std::fill_n(audio, 256u, 1.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.0) == ET_OK);
  GRAPH_CHECK(audio[0] == 6.0F && audio[255] == 6.0F);
  et_engine_destroy(engine);
}

void testGraphOwnershipAndSafeUpdates() {
  const et_engine engine = makeEngine();
  const et_instance gain = makeGain(engine);
  auto serial =
      descriptor({{gain, "gain"}}, {{kEndpoint, 0u, "in", ""}, {0u, kEndpoint, "out", ""}});
  GRAPH_CHECK(et_graph_configure(engine, serial.data(),
                                 static_cast<std::uint32_t>(serial.size())) == ET_OK);

  float *graph_audio = et_arena_combined_ptr(engine);
  std::fill_n(graph_audio, 256u, 1.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.0) == ET_OK);
  std::array<float, 256> expected_audio{};
  std::copy_n(graph_audio, expected_audio.size(), expected_audio.begin());

  const et_instance unrelated = makeGain(engine, 0.25F);
  et_instance_destroy(engine, unrelated);
  std::fill_n(graph_audio, 256u, 1.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.1) == ET_OK);
  GRAPH_CHECK(std::equal(expected_audio.begin(), expected_audio.end(), graph_audio));

  const float replacement_gain = 0.5F;
  std::array<float, 256> direct_audio{};
  GRAPH_CHECK(et_instance_set_params(engine, gain, &replacement_gain, 1u, kTestGainHash, 0u) ==
              ET_ERR_STATE);
  GRAPH_CHECK(et_instance_set_seed(engine, gain, 1u, 2u) == ET_ERR_STATE);
  GRAPH_CHECK(et_instance_reset(engine, gain) == ET_ERR_STATE);
  GRAPH_CHECK(et_instance_process(engine, gain, direct_audio.data(), 2u, 128u, 0.0) ==
              ET_ERR_STATE);
  GRAPH_CHECK(et_instance_asset_begin(engine, gain, 0u, 1u, 1u, 1u, 0u, 1u, 0u, 0u, 2u, 64u, 36u) ==
              0u);
  GRAPH_CHECK(et_instance_asset_commit(engine, gain, 0u, 36u, ET_ASSET_F32_MULTICH) ==
              ET_ERR_STATE);
  et_instance_destroy(engine, gain);
  GRAPH_CHECK(et_instance_set_params(engine, gain, &replacement_gain, 1u, kTestGainHash, 0u) ==
              ET_ERR_STATE);

  const auto empty = descriptor({}, {});
  GRAPH_CHECK(et_graph_configure(engine, empty.data(), static_cast<std::uint32_t>(empty.size())) ==
              ET_OK);
  GRAPH_CHECK(et_instance_set_params(engine, gain, &replacement_gain, 1u, kTestGainHash, 0u) ==
              ET_OK);

  const et_instance volume = et_instance_create(engine, "VolumePlugin");
  GRAPH_CHECK(volume != 0u);
  float initial_volume = -6.0F;
  GRAPH_CHECK(et_instance_set_params(engine, volume, &initial_volume, 1u, kVolumeHash, 0u) ==
              ET_OK);
  auto volume_graph =
      descriptor({{volume, "volume"}}, {{kEndpoint, 0u, "in", ""}, {0u, kEndpoint, "out", ""}});
  GRAPH_CHECK(et_graph_configure(engine, volume_graph.data(),
                                 static_cast<std::uint32_t>(volume_graph.size())) == ET_OK);
  float unity_volume = 0.0F;
  GRAPH_CHECK(et_graph_set_instance_params(engine, volume, &unity_volume, 1u, kVolumeHash, 0u) ==
              ET_OK);
  float *audio = et_arena_combined_ptr(engine);
  std::fill_n(audio, 256u, 1.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.0) == ET_OK);
  GRAPH_CHECK(audio[0] == 1.0F && audio[255] == 1.0F);
  GRAPH_CHECK(et_graph_reset(engine) == ET_OK);
  std::fill_n(audio, 256u, 1.0F);
  GRAPH_CHECK(et_graph_process(engine, 2u, 128u, 0.1) == ET_OK);
  GRAPH_CHECK(std::abs(audio[0] - 0.5011872F) < 1.0e-6F);
  et_engine_destroy(engine);
}

void testUnicodeMixGroupAndEffectiveCapacity() {
  const et_engine engine = makeEngine();
  const et_instance gain = makeGain(engine);
  std::string unicode_id;
  for (std::uint32_t index = 0u; index < 128u; ++index) {
    unicode_id += "\xe7\x95\x8c";
  }
  auto valid_unicode = descriptor({{gain, unicode_id}},
                                  {{kEndpoint, 0u, "in", "mix"}, {0u, kEndpoint, "out", "mix"}});
  GRAPH_CHECK(et_graph_configure(engine, valid_unicode.data(),
                                 static_cast<std::uint32_t>(valid_unicode.size())) == ET_OK);
  unicode_id += "\xe7\x95\x8c";
  auto invalid_unicode = descriptor({{gain, unicode_id}},
                                    {{kEndpoint, 0u, "in", "mix"}, {0u, kEndpoint, "out", "mix"}});
  GRAPH_CHECK(et_graph_configure(engine, invalid_unicode.data(),
                                 static_cast<std::uint32_t>(invalid_unicode.size())) ==
              ET_ERR_GRAPH_INVALID);

  auto empty_mix =
      descriptor({{gain, "gain"}}, {{kEndpoint, 0u, "in", "mix"}, {0u, kEndpoint, "out", "mix"}});
  writeU32(empty_mix.data() + 32u + 24u + 20u, 0u);
  GRAPH_CHECK(
      et_graph_configure(engine, empty_mix.data(), static_cast<std::uint32_t>(empty_mix.size())) ==
      ET_ERR_GRAPH_INVALID);
  et_graph_diagnostic diagnostic{};
  GRAPH_CHECK(et_graph_read_diagnostic(engine, &diagnostic) == ET_OK);
  GRAPH_CHECK(diagnostic.kind == ET_GRAPH_DIAGNOSTIC_EDGE && diagnostic.index == 0u &&
              diagnostic.path == ET_GRAPH_PATH_EDGE_CONTROL);

  std::vector<NodeRecord> nodes;
  std::vector<EdgeRecord> edges;
  for (std::uint32_t index = 0u; index < 97u; ++index) {
    nodes.push_back({gain, std::string("node-") + std::to_string(index)});
    edges.push_back({index == 0u ? kEndpoint : index - 1u, index,
                     std::string("edge-") + std::to_string(index), "mix"});
  }
  edges.push_back({96u, kEndpoint, "out", "mix"});
  auto over_capacity = descriptor(nodes, edges);
  GRAPH_CHECK(et_graph_configure(engine, over_capacity.data(),
                                 static_cast<std::uint32_t>(over_capacity.size())) ==
              ET_ERR_GRAPH_CAPACITY);
  GRAPH_CHECK(et_graph_read_diagnostic(engine, &diagnostic) == ET_OK);
  GRAPH_CHECK(diagnostic.kind == ET_GRAPH_DIAGNOSTIC_NODE && diagnostic.index == 96u &&
              diagnostic.path == ET_GRAPH_PATH_NODE_INSTANCE && diagnostic.required == 97u &&
              diagnostic.capacity == 96u);
  et_engine_destroy(engine);
}

void testWorkspaceCapacityBoundary() {
  constexpr std::uint32_t branch_count = 63u;
  constexpr std::uint32_t exact_frames = 262144u;
  constexpr std::uint32_t workspace_capacity = 64u * 1024u * 1024u;
  const auto make_parallel_graph = [](et_instance instance) {
    std::vector<NodeRecord> nodes;
    std::vector<EdgeRecord> edges;
    for (std::uint32_t index = 0u; index < branch_count; ++index) {
      nodes.push_back({instance, std::string("branch-") + std::to_string(index)});
      edges.push_back({kEndpoint, index, std::string("in-") + std::to_string(index), "mix"});
      edges.push_back({index, kEndpoint, std::string("out-") + std::to_string(index), "mix"});
    }
    return descriptor(nodes, edges);
  };

  const et_engine exact_engine = et_engine_create();
  GRAPH_CHECK(exact_engine != 0u);
  GRAPH_CHECK(et_engine_prepare(exact_engine, 48000.0F, 1u, exact_frames, 0u) == ET_OK);
  const et_instance exact_gain = makeGain(exact_engine);
  const auto exact_graph = make_parallel_graph(exact_gain);
  GRAPH_CHECK(et_graph_configure(exact_engine, exact_graph.data(),
                                 static_cast<std::uint32_t>(exact_graph.size())) == ET_OK);
  std::vector<std::uint8_t> snapshot(et_graph_snapshot_size(exact_engine));
  GRAPH_CHECK(et_graph_snapshot_copy(exact_engine, snapshot.data(),
                                     static_cast<std::uint32_t>(snapshot.size())) == ET_OK);
  GRAPH_CHECK(readU32(snapshot.data() + 24u) == branch_count + 1u);
  GRAPH_CHECK(readU32(snapshot.data() + 32u) == workspace_capacity);
  et_engine_destroy(exact_engine);

  const et_engine over_engine = et_engine_create();
  GRAPH_CHECK(over_engine != 0u);
  GRAPH_CHECK(et_engine_prepare(over_engine, 48000.0F, 1u, exact_frames + 1u, 0u) == ET_OK);
  const et_instance over_gain = makeGain(over_engine);
  const auto over_graph = make_parallel_graph(over_gain);
  GRAPH_CHECK(et_graph_configure(over_engine, over_graph.data(),
                                 static_cast<std::uint32_t>(over_graph.size())) ==
              ET_ERR_GRAPH_CAPACITY);
  et_graph_diagnostic diagnostic{};
  GRAPH_CHECK(et_graph_read_diagnostic(over_engine, &diagnostic) == ET_OK);
  GRAPH_CHECK(diagnostic.kind == ET_GRAPH_DIAGNOSTIC_GRAPH &&
              diagnostic.path == ET_GRAPH_PATH_GRAPH_MEMORY &&
              diagnostic.required == workspace_capacity + (branch_count + 1u) * sizeof(float) &&
              diagnostic.capacity == workspace_capacity);
  et_engine_destroy(over_engine);
}

void testIrAuthoritativeLatencyAndOwnership() {
  auto engine_storage = std::make_unique<effetune::Engine>();
  effetune::Engine &engine = *engine_storage;
  GRAPH_CHECK(engine.prepare(48000.0F, 2u, 128u, 0u) == ET_OK);
  const et_instance ir = engine.createInstance("IRReverbPlugin");
  GRAPH_CHECK(ir != 0u);
  std::array<float, 7> params{0.0F, 1.0F, 1.0F, 0.0F, 1.0F, 0.0F, 0.0F};
  GRAPH_CHECK(engine.setInstanceParams(ir, params.data(), static_cast<std::uint32_t>(params.size()),
                                       kIrReverbHash, 0u) == ET_OK);

  constexpr std::uint32_t payload_bytes = 36u;
  const effetune::AssetBeginInfo info{
      1u, 1u, 1u, 128u, 1u, 0u, 0u, 2u, 4u * 1024u * 1024u, payload_bytes};
  std::uint8_t *staging = engine.beginInstanceAsset(ir, 0u, info);
  GRAPH_CHECK(staging != nullptr);
  if (staging != nullptr) {
    std::memset(staging, 0, payload_bytes);
    writeU32(staging, 0x31415445u);
    writeU32(staging + 4u, 1u);
    writeU32(staging + 8u, 1u);
    writeU32(staging + 12u, 48000u);
    writeU32(staging + 16u, 1u);
    writeF32(staging + 32u, 1.0F);
    GRAPH_CHECK(engine.commitInstanceAsset(ir, 0u, payload_bytes, ET_ASSET_F32_MULTICH) == ET_OK);
  }
  std::array<float, 256> silence{};
  for (std::uint32_t calls = 0u;
       (engine.instanceAssetState(ir, 0u) & 0xffu) == ET_ASSET_STATE_PREPARING && calls < 64u;
       ++calls) {
    GRAPH_CHECK(engine.processInstance(ir, silence.data(), 2u, 128u, 0.0) == ET_OK);
  }
  GRAPH_CHECK((engine.instanceAssetState(ir, 0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
  GRAPH_CHECK(engine.resetInstance(ir) == ET_OK);

  auto graph = descriptor({{ir, "ir", kEnabled | kUniformLatency}},
                          {{kEndpoint, 0u, "in", "mix"}, {0u, kEndpoint, "out", "mix"}});
  GRAPH_CHECK(engine.configureGraph(graph.data(), static_cast<std::uint32_t>(graph.size())) ==
              ET_ERR_GRAPH_UNSUPPORTED_CAPABILITY);
  GRAPH_CHECK(engine.graphDiagnostic().path == ET_GRAPH_PATH_NODE_LATENCY);

  params[5] = -96.0F;
  GRAPH_CHECK(engine.setInstanceParams(ir, params.data(), static_cast<std::uint32_t>(params.size()),
                                       kIrReverbHash, 0u) == ET_OK);
  graph = descriptor({{ir, "ir"}}, {{kEndpoint, 0u, "in", "mix"}, {0u, kEndpoint, "out", "mix"}});
  GRAPH_CHECK(engine.configureGraph(graph.data(), static_cast<std::uint32_t>(graph.size())) ==
              ET_OK);
  GRAPH_CHECK(engine.beginInstanceAsset(ir, 0u, info) == nullptr);
  GRAPH_CHECK(engine.commitInstanceAsset(ir, 0u, payload_bytes, ET_ASSET_F32_MULTICH) ==
              ET_ERR_STATE);
  engine.abortInstanceAsset(ir, 0u);
  GRAPH_CHECK((engine.instanceAssetState(ir, 0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);

  params[5] = 0.0F;
  GRAPH_CHECK(
      engine.setGraphInstanceParams(ir, params.data(), static_cast<std::uint32_t>(params.size()),
                                    kIrReverbHash, 5u) == ET_ERR_GRAPH_UNSUPPORTED_CAPABILITY);
  GRAPH_CHECK(engine.graphDiagnostic().path == ET_GRAPH_PATH_NODE_LATENCY);
  params[5] = -100.0F;
  GRAPH_CHECK(engine.setGraphInstanceParams(ir, params.data(),
                                            static_cast<std::uint32_t>(params.size()),
                                            kIrReverbHash, 5u) == ET_OK);
  params[4] = 0.0F;
  GRAPH_CHECK(engine.setGraphInstanceParams(ir, params.data(),
                                            static_cast<std::uint32_t>(params.size()),
                                            kIrReverbHash, 4u) == ET_OK);
  params[5] = 0.0F;
  GRAPH_CHECK(engine.setGraphInstanceParams(ir, params.data(),
                                            static_cast<std::uint32_t>(params.size()),
                                            kIrReverbHash, 5u) == ET_OK);
  params[4] = 1.0F;
  GRAPH_CHECK(
      engine.setGraphInstanceParams(ir, params.data(), static_cast<std::uint32_t>(params.size()),
                                    kIrReverbHash, 4u) == ET_ERR_GRAPH_UNSUPPORTED_CAPABILITY);
  GRAPH_CHECK(engine.resetGraph() == ET_OK);
  const auto empty = descriptor({}, {});
  GRAPH_CHECK(engine.configureGraph(empty.data(), static_cast<std::uint32_t>(empty.size())) ==
              ET_OK);
  params[4] = 1.0F;
  params[5] = -96.0F;
  GRAPH_CHECK(engine.setInstanceParams(ir, params.data(), static_cast<std::uint32_t>(params.size()),
                                       kIrReverbHash, 0u) == ET_OK);
}

struct OfflineGraphHarness {
  std::unique_ptr<effetune::Engine> engine = std::make_unique<effetune::Engine>();
  et_instance early = 0u, late = 0u;
  std::vector<std::uint8_t> graph;
  std::uint64_t generation = 0u;

  OfflineGraphHarness() {
    GRAPH_CHECK(engine->prepare(48000, 2u, 128u, 4096u) == ET_OK);
    const auto before = engine->createInstance("TestDelayPlugin");
    early = engine->createInstance("TestGainPlugin");
    const auto after = engine->createInstance("TestDelayPlugin");
    late = engine->createInstance("TestGainPlugin");
    const float gain = 2.0F;
    for (auto instance : {early, late}) {
      GRAPH_CHECK(engine->setInstanceParams(instance, &gain, 1u, kTestGainHash, 0u) == ET_OK);
      GRAPH_CHECK(engine->setInstanceTap(instance, instance) == ET_OK);
    }
    GRAPH_CHECK(engine->setTelemetryRate(240.0F) == ET_OK);
    // The left-only delay requires right-channel preDelay at the first stereo node;
    // the dry output edge also exercises graph-edge and final-output compensation.
    graph = descriptor({{before, "before", kEnabled | kUniformLatency, 0},
                        {early, "early"},
                        {after, "after", kEnabled | kUniformLatency},
                        {late, "late"}},
                       {{kEndpoint, 0u, "input", ""},
                        {0u, 1u, "early-in", ""},
                        {1u, 2u, "after-in", ""},
                        {2u, 3u, "late-in", ""},
                        {3u, kEndpoint, "wet", ""},
                        {kEndpoint, kEndpoint, "dry", ""}});
    configure();
  }
  void configure() {
    GRAPH_CHECK(engine->configureGraph(graph.data(), static_cast<std::uint32_t>(graph.size())) ==
                ET_OK);
  }
  void prepareOffline() { GRAPH_CHECK(engine->prepareOfflineGraph(generation) == ET_OK); }
  effetune::PluginKernel *kernel(et_instance instance) {
    return et_engine_instance_kernel_for_testing(engine.get(), instance);
  }
  et_status offline(unsigned frames, double time) {
    return engine->processOfflineGraph(2u, frames, time, generation);
  }
};

void testOfflinePreparationFailure() {
  OfflineGraphHarness graph;
  const auto unused = graph.engine->createInstance("TestGainPlugin");
  effetune::test::testGainOfflinePreparationStatus(graph.kernel(unused), ET_ERR_OOM);
  graph.prepareOffline();
  const auto previous = graph.generation;
  effetune::test::testGainOfflinePreparationStatus(graph.kernel(graph.early), ET_ERR_OOM);
  std::uint64_t failed = previous;
  GRAPH_CHECK(graph.engine->prepareOfflineGraph(failed) == ET_ERR_OOM);
  GRAPH_CHECK(failed == 0);
  GRAPH_CHECK(graph.engine->processOfflineGraph(2, 128, 0, previous) == ET_ERR_STATE);
  effetune::test::testGainOfflinePreparationStatus(graph.kernel(graph.early), ET_OK);
  graph.prepareOffline();
  GRAPH_CHECK(graph.generation != previous);
  GRAPH_CHECK(graph.offline(128, 0) == ET_OK);
}
void testOfflineNodeRetry() {
  OfflineGraphHarness reference, blocked;
  blocked.prepareOffline();
  constexpr std::array<unsigned, 8> sizes{128u, 37u, 91u, 128u, 17u, 128u, 128u, 64u};
  unsigned total_frames = 0u;
  for (auto block = 0u; block < sizes.size(); ++block) {
    const auto frames = sizes[block];
    const auto time = total_frames / 48000.0;
    effetune::HostTransport transport{};
    transport.flags = effetune::HostTransport::kPlaying | effetune::HostTransport::kTempoValid |
                      effetune::HostTransport::kPositionValid;
    transport.tempoBpm = 120;
    transport.ppqPosition = block;
    for (auto *harness : {&reference, &blocked}) {
      harness->engine->setHostTransport(&transport);
      for (auto sample = 0u; sample < 2u * frames; ++sample)
        harness->engine->combined()[sample] = static_cast<float>((sample + block) % 31u) * .0625F;
    }
    effetune::test::testGainBlockOffline(blocked.kernel(blocked.early), block % 3u + 1u);
    effetune::test::testGainBlockOffline(blocked.kernel(blocked.late), 1u);
    const auto violations = effetune::allocation_guard::violationCount();
    GRAPH_CHECK(reference.engine->processGraph(2u, frames, time) == ET_OK);
    auto status = blocked.offline(frames, time);
    unsigned retries = 0u;
    while (status == ET_NEED_SAMPLE && retries++ < 8u) {
      GRAPH_CHECK(std::all_of(blocked.engine->combined(), blocked.engine->combined() + 2u * frames,
                              [](float value) { return value == 0.0F; }));
      GRAPH_CHECK(blocked.engine->processGraph(2u, frames, time) == ET_ERR_STATE);
      GRAPH_CHECK(blocked.offline(frames - 1u, time) == ET_ERR_ARGS);
      GRAPH_CHECK(blocked.offline(frames, time + 1.0) == ET_ERR_ARGS);
      GRAPH_CHECK(blocked.engine->processOfflineGraph(1u, frames, time, blocked.generation) ==
                  ET_ERR_ARGS);
      GRAPH_CHECK(blocked.engine->processOfflineGraph(2u, frames, time, blocked.generation - 1u) ==
                  ET_ERR_STATE);
      GRAPH_CHECK(blocked.engine->setInstanceMidiEvents(blocked.early, nullptr, 0u, 1u,
                                                        ET_MIDI_RESET) == ET_ERR_STATE);
      GRAPH_CHECK(blocked.engine->setInstanceMidiGain(blocked.early, .5F) == ET_ERR_STATE);
      GRAPH_CHECK(blocked.engine->setInstanceMidiClock(blocked.early, 0u, 1u,
                                                       ET_MIDI_CLOCK_RUNNING) == ET_ERR_STATE);
      GRAPH_CHECK(blocked.engine->readInstanceMidiCheckpoint(blocked.early, nullptr, 0u) ==
                  ET_ERR_STATE);
      // Neither caller output storage nor host transport is borrowed across the wait.
      std::fill_n(blocked.engine->combined(), 2u * frames, -123.0F);
      blocked.engine->setHostTransport(nullptr);
      status = blocked.offline(frames, time);
    }
    GRAPH_CHECK(status == ET_OK && retries == block % 3u + 2u);
    GRAPH_CHECK(effetune::allocation_guard::violationCount() == violations);
    GRAPH_CHECK(std::equal(reference.engine->combined(), reference.engine->combined() + 2u * frames,
                           blocked.engine->combined()));
    total_frames += frames;
    for (auto pair : {std::array<et_instance, 2>{reference.early, blocked.early},
                      std::array<et_instance, 2>{reference.late, blocked.late}}) {
      const auto expected = effetune::test::testGainOfflineState(reference.kernel(pair[0]));
      const auto actual = effetune::test::testGainOfflineState(blocked.kernel(pair[1]));
      GRAPH_CHECK(actual.commits == block + 1u && actual.frames == total_frames);
      GRAPH_CHECK(actual.telemetry == expected.telemetry);
      const auto *expected_transport = effetune::test::testGainTransport(reference.kernel(pair[0]));
      const auto *actual_transport = effetune::test::testGainTransport(blocked.kernel(pair[1]));
      GRAPH_CHECK(expected_transport && actual_transport &&
                  expected_transport->ppqPosition == actual_transport->ppqPosition);
    }
  }
}

void testOfflineCancelAndGeneration() {
  OfflineGraphHarness reference, blocked;
  blocked.prepareOffline();
  for (auto reconfigure : {false, true}) {
    std::fill_n(blocked.engine->combined(), 256u, 1.0F);
    effetune::test::testGainBlockOffline(blocked.kernel(blocked.late), 1u);
    GRAPH_CHECK(blocked.offline(128u, 0.0) == ET_NEED_SAMPLE);
    const auto stale = blocked.generation;
    if (reconfigure) {
      blocked.configure();
      reference.configure();
    } else {
      const auto violations = effetune::allocation_guard::violationCount();
      effetune::allocation_guard::Scope guard;
      GRAPH_CHECK(blocked.engine->resetGraph() == ET_OK);
      GRAPH_CHECK(reference.engine->resetGraph() == ET_OK);
      GRAPH_CHECK(effetune::allocation_guard::violationCount() == violations);
    }
    blocked.prepareOffline();
    GRAPH_CHECK(blocked.generation != stale);
    GRAPH_CHECK(blocked.engine->processOfflineGraph(2u, 128u, 0.0, stale) == ET_ERR_STATE);
    for (auto block = 0u; block < 5u; ++block) {
      for (auto *harness : {&reference, &blocked})
        std::fill_n(harness->engine->combined(), 256u, static_cast<float>(block + 1u));
      GRAPH_CHECK(reference.engine->processGraph(2u, 128u, block) == ET_OK);
      GRAPH_CHECK(blocked.offline(128u, block) == ET_OK);
      GRAPH_CHECK(std::equal(reference.engine->combined(), reference.engine->combined() + 256u,
                             blocked.engine->combined()));
    }
  }
  // A terminal kernel error requires cancellation, not another partially advanced block.
  effetune::test::testGainBlockOffline(blocked.kernel(blocked.early), 1u, ET_ERR_UNSUPPORTED);
  GRAPH_CHECK(blocked.offline(128u, 10.0) == ET_ERR_UNSUPPORTED);
  const auto attempts =
      effetune::test::testGainOfflineState(blocked.kernel(blocked.early)).attempts;
  GRAPH_CHECK(blocked.offline(128u, 10.0) == ET_ERR_STATE);
  GRAPH_CHECK(effetune::test::testGainOfflineState(blocked.kernel(blocked.early)).attempts ==
              attempts);
  const auto stale = blocked.generation;
  {
    effetune::allocation_guard::Scope guard;
    GRAPH_CHECK(blocked.engine->reset() == ET_OK);
  }
  blocked.prepareOffline();
  GRAPH_CHECK(blocked.engine->processOfflineGraph(2u, 128u, 10.0, stale) == ET_ERR_STATE);
  GRAPH_CHECK(blocked.offline(128u, 10.0) == ET_OK);
}

void testOfflinePipelineChannelRouting() {
  const auto chain = makeEngine(), graph = makeEngine();
  std::array<et_instance, 4> chain_nodes{}, graph_nodes{};
  for (auto *nodes : {&chain_nodes, &graph_nodes}) {
    const auto engine = nodes == &chain_nodes ? chain : graph;
    (*nodes)[0] = et_instance_create(engine, "TestDelayPlugin");
    (*nodes)[1] = makeGain(engine, 2.0F);
    (*nodes)[2] = makeGain(engine, 0.5F);
    (*nodes)[3] = makeGain(engine, 3.0F);
  }
  std::vector<std::uint8_t> chain_bytes(8u + 4u * 12u, 0u);
  writeU32(chain_bytes.data(), 1u);
  writeU32(chain_bytes.data() + 4u, 4u);
  const std::array<std::array<std::uint8_t, 3>, 4> routes{
      {{0u, 1u, 0u}, {0u, 1u, 1u}, {1u, 0u, 254u}, {0u, 0u, 0u}}};
  for (auto index = 0u; index < 4u; ++index) {
    auto *record = chain_bytes.data() + 8u + index * 12u;
    writeU32(record, chain_nodes[index]);
    record[4] = record[8] = 1u;
    std::copy(routes[index].begin(), routes[index].end(), record + 5u);
  }
  GRAPH_CHECK(et_pipeline_configure(chain, chain_bytes.data(),
                                    static_cast<std::uint32_t>(chain_bytes.size())) == ET_OK);
  const std::vector<EdgeRecord> edges{{kEndpoint, 0u, "00", "mix"},
                                      {kEndpoint, 1u, "01", "mix"},
                                      {0u, 2u, "02", "mix"},
                                      {1u, 2u, "03", "mix"},
                                      {kEndpoint, 3u, "04", "mix"},
                                      {2u, 3u, "05", "mix"},
                                      {kEndpoint, kEndpoint, "06", "mix"},
                                      {2u, kEndpoint, "07", "mix"},
                                      {3u, kEndpoint, "08", "mix"}};
  auto bytes = descriptor({{graph_nodes[0], "0", kEnabled, 0},
                           {graph_nodes[1], "1", kEnabled, 1},
                           {graph_nodes[2], "2", kEnabled, -2},
                           {graph_nodes[3], "3", kEnabled, 0}},
                          edges);
  writeU32(bytes.data(), 0x464f5445u);
  const std::array<std::uint32_t, 9> masks{1u, 2u, 1u, 2u, 1u, 1u, 2u, 2u, 1u};
  for (auto index = 0u; index < masks.size(); ++index)
    writeU32(bytes.data() + 32u + 4u * 24u + index * 40u + 36u, masks[index]);
  GRAPH_CHECK(et_graph_configure(graph, bytes.data(), static_cast<std::uint32_t>(bytes.size())) ==
              ET_ERR_GRAPH_INVALID);
  GRAPH_CHECK(et_graph_configure_offline(graph, bytes.data(),
                                         static_cast<std::uint32_t>(bytes.size())) == ET_OK);
  GRAPH_CHECK(et_graph_latency(graph) == et_pipeline_latency(chain));
  std::uint32_t low = 0u, high = 0u;
  GRAPH_CHECK(et_graph_prepare_offline(graph, &low, &high) == ET_OK);
  for (auto block = 0u; block < 9u; ++block) {
    const auto frames = 64u + block * 7u;
    auto *expected = et_arena_combined_ptr(chain), *actual = et_arena_combined_ptr(graph);
    for (auto i = 0u; i < frames * 2u; ++i)
      expected[i] = actual[i] = static_cast<float>((i + block * 13u) % 31u) / 32.0F;
    GRAPH_CHECK(et_pipeline_process(chain, 2u, frames, block, 0u) == ET_OK);
    GRAPH_CHECK(et_graph_process_offline(graph, 2u, frames, block, low, high) == ET_OK);
    GRAPH_CHECK(std::equal(expected, expected + frames * 2u, actual));
  }
  GRAPH_CHECK(et_graph_reset(graph) == ET_OK);
  GRAPH_CHECK(et_graph_process_offline(graph, 2u, 128u, 0.0, low, high) == ET_ERR_STATE);
  et_engine_destroy(chain);
  et_engine_destroy(graph);
}

void testNativeMidiHostAndStrictOffline() {
  constexpr std::uint32_t kHostRate = 48000u, kOversampling = 2u;
  constexpr std::uint32_t kRate = kHostRate * kOversampling, kFrames = 128u;
  const et_engine engine = et_engine_create();
  GRAPH_CHECK(engine != 0u);
  GRAPH_CHECK(et_engine_prepare(engine, static_cast<float>(kRate), 2u, kFrames, 0u) == ET_OK);
  const et_instance instrument = et_instance_create(engine, "SoundFontPlayerPlugin");
  GRAPH_CHECK(instrument != 0u);
  std::array<float, effetune::generated::SoundFontPlayerPluginParams::kFloatCount> parameters;
  parameters.fill(-1.0F);
  parameters[0] = parameters[2] = 0.0F;
  parameters[1] = 64.0F;
  GRAPH_CHECK(et_instance_set_params(engine, instrument, parameters.data(),
                                     static_cast<std::uint32_t>(parameters.size()),
                                     effetune::generated::SoundFontPlayerPluginParams::kHash,
                                     0u) == ET_OK);
  const auto bytes = static_cast<std::uint32_t>(kSf2HostFixture.size());
  std::uint64_t additional = 0u;
  GRAPH_CHECK(et_sample_player_preparation_bytes(kSf2HostFixture.data(), bytes, bytes,
                                                 ET_ASSET_F32_MULTICH, static_cast<float>(kRate),
                                                 2u, kFrames, 0.0, &additional,
                                                 ET_SAMPLE_PLAYER_MAIN) == ET_OK);
  GRAPH_CHECK(additional <= UINT32_MAX - bytes);
  const auto footprint = bytes + static_cast<std::uint32_t>(additional);
  if constexpr (sizeof(void *) > sizeof(std::uint32_t)) {
    GRAPH_CHECK(et_instance_asset_begin(engine, instrument, 0u, 1u, (bytes - 32u) / 4u, 0u, 0u, 1u,
                                        0u, 0u, 2u, footprint, bytes) == 0u);
    GRAPH_CHECK(et_instance_asset_state(engine, instrument, 0u) == ET_ASSET_STATE_NONE);
  }
  auto *payload = et_instance_asset_begin_ptr(engine, instrument, 0u, 1u, (bytes - 32u) / 4u, 0u,
                                              0u, 1u, 0u, 0u, 2u, footprint, bytes, 0.0);
  GRAPH_CHECK(payload != nullptr);
  if (!payload) {
    et_engine_destroy(engine);
    return;
  }
  std::memcpy(payload, kSf2HostFixture.data(), bytes);
  GRAPH_CHECK(et_instance_asset_commit(engine, instrument, 0u, bytes, ET_ASSET_F32_MULTICH) ==
              ET_OK);
  GRAPH_CHECK(et_instance_stream_configure(engine, instrument, 11u, 0u) == ET_OK);
  std::array<float, 4096> page;
  page.fill(.25F);
  GRAPH_CHECK(et_instance_stream_publish(engine, instrument, 11u, 0u, 0u, 0u, 0u, page.data(),
                                         4096u, 1u, 1u) == ET_OK);
  GRAPH_CHECK(et_instance_asset_state(engine, instrument, 0u) == ET_ASSET_STATE_ACTIVE);
  GRAPH_CHECK(et_instance_set_midi_events(engine, instrument, nullptr, 0u, 7u, ET_MIDI_RESET) ==
              ET_OK);

  // A stopped DAW still delivers live MIDI. Offsets are local to each engine slice.
  et_host_transport transport{
      ET_HOST_TRANSPORT_TEMPO_VALID | ET_HOST_TRANSPORT_POSITION_VALID, 90.0, 4.0, 0.0, 0u, 0u};
  const auto renderSlice = [&](std::uint32_t hostOffset, std::uint32_t hostFrames,
                               std::span<const et_midi_event> events) {
    const auto frames = hostFrames * kOversampling;
    transport.ppq_position = 4.0 + hostOffset * 90.0 / (60.0 * kHostRate);
    std::array<float, 256> audio{};
    effetune::allocation_guard::Scope guard;
    GRAPH_CHECK(et_engine_set_host_transport(engine, &transport) == ET_OK);
    GRAPH_CHECK(et_instance_set_midi_clock(engine, instrument, hostOffset * kOversampling, 0u, 7u,
                                           ET_MIDI_CLOCK_RUNNING) == ET_OK);
    GRAPH_CHECK(et_instance_set_midi_events(engine, instrument, events.data(),
                                            static_cast<std::uint32_t>(events.size()), 7u,
                                            0u) == ET_OK);
    GRAPH_CHECK(et_instance_process(engine, instrument, audio.data(), 2u, frames,
                                    static_cast<double>(hostOffset) / kHostRate) == ET_OK);
    GRAPH_CHECK(et_instance_midi_clock_low(engine, instrument) ==
                (hostOffset + hostFrames) * kOversampling);
    return audio;
  };
  const auto first = renderSlice(0u, 13u, {});
  GRAPH_CHECK(std::all_of(first.begin(), first.end(), [](float value) { return value == 0.0F; }));
  const std::array<et_midi_event, 1> events{
      {{(17u - 13u) * kOversampling, 0x90u | (60u << 8u) | (127u << 16u), 1u, 0u, 0u, 0u}}};
  const auto second = renderSlice(13u, 51u, events);
  GRAPH_CHECK(
      std::all_of(second.begin(), second.begin() + 8u, [](float value) { return value == 0.0F; }));
  // SF2's default timecents envelope delay precedes the audible note.
  const et_midi_event noteOff{(113u - 64u) * kOversampling, 0x80u | (60u << 8u), 1u, 0u, 0u, 0u};
  const auto third = renderSlice(64u, 64u, {&noteOff, 1u});
  GRAPH_CHECK(
      std::any_of(third.begin(), third.end(), [](float value) { return std::fabs(value) > .01F; }));
  const et_midi_event panic{0u, 0xb0u | (120u << 8u), 0u, 0u, 0u, 0u};
  renderSlice(128u, 64u, {&panic, 1u});
  // All Sound Off releases voices; a host reset also clears the send-effect tail.
  GRAPH_CHECK(et_instance_reset(engine, instrument) == ET_OK);
  GRAPH_CHECK((et_instance_midi_state(engine, instrument) & ET_MIDI_STATE_VOICES) == 0u);

  // The same public node handle and prepared asset work in a strict offline graph.
  auto graph = descriptor({{instrument, "instrument", kEnabled | kRequiresAsset}},
                          {{kEndpoint, 0u, "input", ""}, {0u, kEndpoint, "output", ""}});
  writeU32(graph.data(), 0x464f5445u);
  for (auto edge = 0u; edge < 2u; ++edge)
    writeU32(graph.data() + 32u + 24u + edge * 40u + 36u, 3u);
  GRAPH_CHECK(et_graph_configure_offline(engine, graph.data(),
                                         static_cast<std::uint32_t>(graph.size())) == ET_OK);
  std::uint32_t low = 0u, high = 0u;
  GRAPH_CHECK(et_graph_prepare_offline(engine, &low, &high) == ET_OK);
  GRAPH_CHECK(et_instance_set_midi_events(engine, instrument, nullptr, 0u, 8u, ET_MIDI_RESET) ==
              ET_OK);
  GRAPH_CHECK(et_instance_set_midi_clock(engine, instrument, 0u, 0u, 8u, ET_MIDI_CLOCK_RUNNING) ==
              ET_OK);
  const et_midi_event note{0u, 0x90u | (60u << 8u) | (127u << 16u), 2u, 0u, 0u, 0u};
  GRAPH_CHECK(et_instance_set_midi_events(engine, instrument, &note, 1u, 8u, 0u) == ET_OK);
  bool retried = false;
  for (auto block = 0u; block < 80u && !retried; ++block) {
    auto *audio = et_arena_combined_ptr(engine);
    std::fill_n(audio, 2u * kFrames, 0.0F);
    const auto clock = et_instance_midi_clock_low(engine, instrument);
    const double time = static_cast<double>(block * kFrames) / kRate;
    et_status status;
    {
      effetune::allocation_guard::Scope guard;
      status = et_graph_process_offline(engine, 2u, kFrames, time, low, high);
    }
    if (status == ET_NEED_SAMPLE) {
      GRAPH_CHECK(et_instance_midi_clock_low(engine, instrument) == clock);
      GRAPH_CHECK(et_instance_asset_state(engine, instrument, 0u) == ET_ASSET_STATE_ACTIVE);
      {
        effetune::allocation_guard::Scope guard;
        GRAPH_CHECK(et_graph_process_offline(engine, 2u, kFrames, time, low, high) ==
                    ET_NEED_SAMPLE);
      }
      GRAPH_CHECK(et_instance_midi_clock_low(engine, instrument) == clock);
      std::array<et_sfz_sample_request, 8> requests{};
      std::uint32_t count = 0u;
      GRAPH_CHECK(et_instance_stream_take_requests(engine, instrument, requests.data(),
                                                   static_cast<std::uint32_t>(requests.size()),
                                                   &count) == ET_OK);
      GRAPH_CHECK(count != 0u);
      for (auto index = 0u; index < count; ++index) {
        const auto &request = requests[index];
        GRAPH_CHECK(request.sample == 0u && request.page_low == 1u && request.page_high == 0u);
        GRAPH_CHECK(et_instance_stream_publish(engine, instrument, request.generation_low,
                                               request.generation_high, request.sample,
                                               request.page_low, request.page_high, page.data(),
                                               4096u, 1u, 0u) == ET_OK);
      }
      {
        effetune::allocation_guard::Scope guard;
        status = et_graph_process_offline(engine, 2u, kFrames, time, low, high);
      }
      GRAPH_CHECK(status == ET_OK);
      GRAPH_CHECK(et_instance_midi_clock_low(engine, instrument) == clock + kFrames);
      GRAPH_CHECK(std::any_of(audio, audio + 2u * kFrames,
                              [](float value) { return std::fabs(value) > .01F; }));
      retried = true;
    } else {
      GRAPH_CHECK(status == ET_OK);
      GRAPH_CHECK(et_instance_midi_clock_low(engine, instrument) == clock + kFrames);
    }
  }
  GRAPH_CHECK(retried);
  et_engine_destroy(engine);
}

void testNativePreparationFloor() {
  constexpr float rate = 48000.0F;
  constexpr std::uint32_t frames = 128u;
  for (const double minimum : {30.0, 0.0}) {
    const auto engine = et_engine_create();
    GRAPH_CHECK(engine != 0u);
    GRAPH_CHECK(et_engine_prepare(engine, rate, 2u, frames, 0u) == ET_OK);
    const auto instrument = et_instance_create(engine, "SoundFontPlayerPlugin");
    GRAPH_CHECK(instrument != 0u);
    std::array<float, effetune::generated::SoundFontPlayerPluginParams::kFloatCount> parameters;
    parameters.fill(-1.0F);
    parameters[0] = parameters[2] = 0.0F;
    parameters[1] = 64.0F;
    GRAPH_CHECK(et_instance_set_params(engine, instrument, parameters.data(),
                                       static_cast<std::uint32_t>(parameters.size()),
                                       effetune::generated::SoundFontPlayerPluginParams::kHash,
                                       0u) == ET_OK);
    if (minimum == 0.0) {
      const et_midi_transport_point slowMap{0.0, 0.0, 0.0, 60.0, 4u, 4u};
      GRAPH_CHECK(et_instance_set_midi_transport_map(engine, instrument, &slowMap, 1u) == ET_OK);
    }
    const auto bytes = static_cast<std::uint32_t>(kFxSyncPayload.size());
    std::uint64_t additional = 0u;
    GRAPH_CHECK(et_sample_player_preparation_bytes(kFxSyncPayload.data(), bytes, bytes,
                                                   ET_ASSET_F32_MULTICH, rate, 2u, frames, minimum,
                                                   &additional, ET_SAMPLE_PLAYER_MAIN) == ET_OK);
    GRAPH_CHECK(additional <= UINT32_MAX - bytes);
    const auto footprint = bytes + static_cast<std::uint32_t>(additional);
    const auto begin = [&](double bound) {
      return et_instance_asset_begin_ptr(engine, instrument, 0u, 1u, (bytes - 32u) / 4u, 0u, 0u, 1u,
                                         0u, 0u, 2u, footprint, bytes, bound);
    };
    GRAPH_CHECK(begin(-1.0) == nullptr);
    GRAPH_CHECK(et_instance_asset_state(engine, instrument, 0u) == ET_ASSET_STATE_NONE);
    auto *payload = begin(minimum);
    GRAPH_CHECK(payload != nullptr);
    if (payload) {
      std::memcpy(payload, kFxSyncPayload.data(), bytes);
      GRAPH_CHECK(et_instance_asset_commit(engine, instrument, 0u, bytes, ET_ASSET_F32_MULTICH) ==
                  ET_OK);
      const et_host_transport transport{ET_HOST_TRANSPORT_PLAYING | ET_HOST_TRANSPORT_TEMPO_VALID |
                                            ET_HOST_TRANSPORT_POSITION_VALID,
                                        minimum == 0.0 ? 120.0 : minimum,
                                        0.0,
                                        0.0,
                                        0u,
                                        0u};
      GRAPH_CHECK(et_engine_set_host_transport(engine, &transport) == ET_OK);
      for (auto block = 0u;
           block < 16u && et_instance_asset_state(engine, instrument, 0u) != ET_ASSET_STATE_ACTIVE;
           ++block) {
        std::array<float, frames * 2u> audio{};
        GRAPH_CHECK(et_instance_process(engine, instrument, audio.data(), 2u, frames,
                                        static_cast<double>(block * frames) / rate) == ET_OK);
      }
      GRAPH_CHECK(et_instance_asset_state(engine, instrument, 0u) == ET_ASSET_STATE_ACTIVE);
      GRAPH_CHECK(begin(-1.0) == nullptr);
      GRAPH_CHECK(et_instance_asset_state(engine, instrument, 0u) == ET_ASSET_STATE_ACTIVE);
    }
    et_engine_destroy(engine);
  }
}

} // namespace

int main() {
  testNativeMidiHostAndStrictOffline();
  testNativePreparationFloor();
  testCapabilityAndIdentity();
  testSerialDisabledAndControlMix();
  testLatencyCompensationAndPreNodeAlignment();
  testHostTransportFollowsNodeLatency();
  testSixteenChannelLatencySnapshot();
  testValidationPreparationAndWideGraph();
  testGraphOwnershipAndSafeUpdates();
  testUnicodeMixGroupAndEffectiveCapacity();
  testWorkspaceCapacityBoundary();
  testIrAuthoritativeLatencyAndOwnership();
  testOfflinePipelineChannelRouting();
  testOfflineNodeRetry();
  testOfflinePreparationFailure();
  testOfflineCancelAndGeneration();
  if (failures != 0) {
    std::fprintf(stderr, "%d Graph test check(s) failed\n", failures);
    return 1;
  }
  std::puts("All DSP Graph tests passed");
  return 0;
}

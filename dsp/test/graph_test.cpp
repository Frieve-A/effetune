#include "allocation_guard.h"
#include "effetune/abi.h"
#include "engine.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
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
constexpr std::uint32_t kIrReverbHash = 0x831d7030u;

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
  GRAPH_CHECK(snapshot_size == 128u);
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
  GRAPH_CHECK((readU32(muted_solo_snapshot.data() + edges_offset + 48u) & 2u) != 0u);
  GRAPH_CHECK((readU32(muted_solo_snapshot.data() + edges_offset + 96u) & 2u) != 0u);
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
  const std::uint8_t *stereo_record = snapshot.data() + nodes_offset + 128u;
  GRAPH_CHECK(readU32(stereo_record + 96u) == 0u);
  GRAPH_CHECK(readU32(stereo_record + 100u) == latency);
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
  effetune::Engine engine;
  GRAPH_CHECK(engine.prepare(48000.0F, 2u, 128u, 0u) == ET_OK);
  const et_instance ir = engine.createInstance("IRReverbPlugin");
  GRAPH_CHECK(ir != 0u);
  std::array<float, 6> params{0.0F, 1.0F, 1.0F, 0.0F, 0.0F, 0.0F};
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

  params[4] = -96.0F;
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

  params[4] = 0.0F;
  GRAPH_CHECK(
      engine.setGraphInstanceParams(ir, params.data(), static_cast<std::uint32_t>(params.size()),
                                    kIrReverbHash, 4u) == ET_ERR_GRAPH_UNSUPPORTED_CAPABILITY);
  GRAPH_CHECK(engine.graphDiagnostic().path == ET_GRAPH_PATH_NODE_LATENCY);
  params[4] = -100.0F;
  GRAPH_CHECK(engine.setGraphInstanceParams(ir, params.data(),
                                            static_cast<std::uint32_t>(params.size()),
                                            kIrReverbHash, 4u) == ET_OK);
  GRAPH_CHECK(engine.resetGraph() == ET_OK);
  const auto empty = descriptor({}, {});
  GRAPH_CHECK(engine.configureGraph(empty.data(), static_cast<std::uint32_t>(empty.size())) ==
              ET_OK);
  params[4] = -96.0F;
  GRAPH_CHECK(engine.setInstanceParams(ir, params.data(), static_cast<std::uint32_t>(params.size()),
                                       kIrReverbHash, 0u) == ET_OK);
}

} // namespace

int main() {
  testCapabilityAndIdentity();
  testSerialDisabledAndControlMix();
  testLatencyCompensationAndPreNodeAlignment();
  testValidationPreparationAndWideGraph();
  testGraphOwnershipAndSafeUpdates();
  testUnicodeMixGroupAndEffectiveCapacity();
  testWorkspaceCapacityBoundary();
  testIrAuthoritativeLatencyAndOwnership();
  if (failures != 0) {
    std::fprintf(stderr, "%d Graph test check(s) failed\n", failures);
    return 1;
  }
  std::puts("All DSP Graph tests passed");
  return 0;
}

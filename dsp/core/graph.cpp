#include "graph.h"

#include "allocation_guard.h"
#include "binary_io.h"
#include "engine.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstring>
#include <limits>
#include <span>
#include <utility>

namespace effetune {
namespace {

constexpr std::uint32_t kDescriptorMagic = 0x31475445u;
constexpr std::uint32_t kSnapshotMagic = 0x31535445u;
constexpr std::uint32_t kDescriptorHeaderBytes = 32u;
constexpr std::uint32_t kDescriptorNodeBytes = 24u;
constexpr std::uint32_t kDescriptorEdgeBytes = 40u;
constexpr std::uint32_t kSnapshotHeaderBytes = 128u;
constexpr std::uint32_t kSnapshotNodeBytes = 128u;
constexpr std::uint32_t kSnapshotEdgeBytes = 48u;
constexpr std::uint32_t kNodeFlagEnabled = 1u << 0u;
constexpr std::uint32_t kNodeFlagRequiresActiveAsset = 1u << 1u;
constexpr std::uint32_t kNodeFlagUniformOutputLatency = 1u << 2u;
constexpr std::uint32_t kEdgeFlagMute = 1u << 0u;
constexpr std::uint32_t kEdgeFlagSolo = 1u << 1u;
constexpr std::uint32_t kEdgeFlagPan = 1u << 2u;

std::uint32_t readU32(const std::uint8_t *input) noexcept {
  return static_cast<std::uint32_t>(input[0]) | (static_cast<std::uint32_t>(input[1]) << 8u) |
         (static_cast<std::uint32_t>(input[2]) << 16u) |
         (static_cast<std::uint32_t>(input[3]) << 24u);
}

std::int32_t readI32(const std::uint8_t *input) noexcept {
  return std::bit_cast<std::int32_t>(readU32(input));
}

float readF32(const std::uint8_t *input) noexcept { return std::bit_cast<float>(readU32(input)); }

using binary_io::writeU32;

bool validUtf8(std::span<const std::uint8_t> bytes, std::uint32_t max_scalars) noexcept {
  std::size_t index = 0u;
  std::uint32_t scalars = 0u;
  while (index < bytes.size()) {
    if (++scalars > max_scalars) {
      return false;
    }
    const std::uint8_t lead = bytes[index++];
    if (lead <= 0x7fu) {
      continue;
    }
    std::uint32_t codepoint = 0u;
    std::size_t continuation = 0u;
    if (lead >= 0xc2u && lead <= 0xdfu) {
      codepoint = lead & 0x1fu;
      continuation = 1u;
    } else if (lead >= 0xe0u && lead <= 0xefu) {
      codepoint = lead & 0x0fu;
      continuation = 2u;
    } else if (lead >= 0xf0u && lead <= 0xf4u) {
      codepoint = lead & 0x07u;
      continuation = 3u;
    } else {
      return false;
    }
    if (continuation > bytes.size() - index) {
      return false;
    }
    for (std::size_t offset = 0u; offset < continuation; ++offset) {
      const std::uint8_t next = bytes[index++];
      if ((next & 0xc0u) != 0x80u) {
        return false;
      }
      codepoint = (codepoint << 6u) | (next & 0x3fu);
    }
    if ((continuation == 2u && codepoint < 0x800u) ||
        (continuation == 3u && codepoint < 0x10000u) ||
        (codepoint >= 0xd800u && codepoint <= 0xdfffu) || codepoint > 0x10ffffu) {
      return false;
    }
  }
  return true;
}

bool byteLess(const std::string &left, const std::string &right) noexcept {
  return std::lexicographical_compare(
      left.begin(), left.end(), right.begin(), right.end(), [](char lhs, char rhs) {
        return static_cast<unsigned char>(lhs) < static_cast<unsigned char>(rhs);
      });
}

std::uint32_t maximum(const std::array<std::uint32_t, 8> &values, std::uint32_t channels) noexcept {
  std::uint32_t result = 0u;
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    result = values[channel] > result ? values[channel] : result;
  }
  return result;
}

} // namespace

void GraphPlan::fail(et_status status, std::uint32_t kind, std::uint32_t index, std::uint32_t path,
                     std::uint32_t required, std::uint32_t capacity) noexcept {
  diagnostic_ = {status, kind, index, path, required, capacity};
}

et_status GraphPlan::configure(Engine &engine, const std::uint8_t *descriptor,
                               std::uint32_t descriptor_bytes) {
  diagnostic_ = {ET_OK, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_NONE, 0u, 0u};
  const et_status parsed = parseDescriptor(engine, descriptor, descriptor_bytes);
  if (parsed != ET_OK) {
    return parsed;
  }
  const et_status structural = validateStructure();
  if (structural != ET_OK) {
    return structural;
  }
  const et_status effective = buildEffectivePlan(engine);
  if (effective != ET_OK) {
    return effective;
  }
  const et_status planned = buildLatencyAndStorage(engine);
  if (planned != ET_OK) {
    return planned;
  }
  buildSnapshot();
  configured_ = true;
  return ET_OK;
}

et_status GraphPlan::parseDescriptor(Engine &engine, const std::uint8_t *descriptor,
                                     std::uint32_t descriptor_bytes) {
  nodes_.clear();
  edges_.clear();
  structural_order_.clear();
  schedule_.clear();
  output_edges_.clear();
  buffers_.clear();
  snapshot_.clear();
  output_latency_ = {};
  output_delays_ = {};
  max_channels_ = engine.max_channels_;
  max_frames_ = engine.max_frames_;
  identity_ = false;
  silence_ = false;
  configured_ = false;

  if (descriptor == nullptr || descriptor_bytes < kDescriptorHeaderBytes) {
    fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_DOCUMENT);
    return ET_ERR_GRAPH_INVALID;
  }
  const std::uint32_t magic = readU32(descriptor);
  const std::uint32_t version = readU32(descriptor + 4u);
  const std::uint32_t node_count = readU32(descriptor + 8u);
  const std::uint32_t edge_count = readU32(descriptor + 12u);
  const std::uint32_t string_bytes = readU32(descriptor + 16u);
  if (magic != kDescriptorMagic || version != kDescriptorVersion ||
      readU32(descriptor + 20u) != 0u || readU32(descriptor + 24u) != 0u ||
      readU32(descriptor + 28u) != 0u) {
    fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_DOCUMENT);
    return ET_ERR_GRAPH_INVALID;
  }
  if (node_count > kMaxNodes) {
    fail(ET_ERR_GRAPH_CAPACITY, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_GRAPH_BUFFERS,
         node_count, kMaxNodes);
    return ET_ERR_GRAPH_CAPACITY;
  }
  if (edge_count > kMaxEdges) {
    fail(ET_ERR_GRAPH_CAPACITY, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_GRAPH_BUFFERS,
         edge_count, kMaxEdges);
    return ET_ERR_GRAPH_CAPACITY;
  }
  const std::uint64_t records_bytes =
      static_cast<std::uint64_t>(node_count) * kDescriptorNodeBytes +
      static_cast<std::uint64_t>(edge_count) * kDescriptorEdgeBytes;
  const std::uint64_t expected_bytes = kDescriptorHeaderBytes + records_bytes + string_bytes;
  if (expected_bytes != descriptor_bytes) {
    fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_DOCUMENT);
    return ET_ERR_GRAPH_INVALID;
  }
  const std::uint8_t *node_records = descriptor + kDescriptorHeaderBytes;
  const std::uint8_t *edge_records = node_records + node_count * kDescriptorNodeBytes;
  const std::uint8_t *strings = edge_records + edge_count * kDescriptorEdgeBytes;
  const auto read_string = [&](std::uint32_t offset, std::uint32_t length,
                               std::uint32_t max_scalars, bool empty_allowed, std::string &result) {
    if ((!empty_allowed && length == 0u) || length > max_scalars * 4u || offset > string_bytes ||
        length > string_bytes - offset) {
      return false;
    }
    const std::span<const std::uint8_t> bytes(strings + offset, length);
    if (!validUtf8(bytes, max_scalars)) {
      return false;
    }
    result.assign(reinterpret_cast<const char *>(bytes.data()), bytes.size());
    return true;
  };

  nodes_.reserve(node_count);
  for (std::uint32_t index = 0u; index < node_count; ++index) {
    const std::uint8_t *record = node_records + index * kDescriptorNodeBytes;
    Node node{};
    node.instance = readU32(record);
    node.originalIndex = index;
    node.flags = readU32(record + 12u);
    node.channelSpec = readI32(record + 16u);
    node.enabled = (node.flags & kNodeFlagEnabled) != 0u;
    if (!read_string(readU32(record + 4u), readU32(record + 8u), 128u, false, node.id)) {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_NODE, index, ET_GRAPH_PATH_NODE_ID);
      return ET_ERR_GRAPH_INVALID;
    }
    if ((node.flags & ~(kNodeFlagEnabled | kNodeFlagRequiresActiveAsset |
                        kNodeFlagUniformOutputLatency)) != 0u ||
        readU32(record + 20u) != 0u ||
        (!node.enabled && (node.instance != 0u || node.flags != 0u))) {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_NODE, index, ET_GRAPH_PATH_NODE_INSTANCE);
      return ET_ERR_GRAPH_INVALID;
    }
    if (node.channelSpec == -2) {
      node.firstChannel = 0u;
      node.channelCount = max_channels_;
    } else if (node.channelSpec == -1) {
      node.firstChannel = 0u;
      node.channelCount = 2u;
    } else if (node.channelSpec >= 0 && node.channelSpec <= 7) {
      node.firstChannel = static_cast<std::uint32_t>(node.channelSpec);
      node.channelCount = 1u;
    } else if (node.channelSpec >= 16 && node.channelSpec <= 19) {
      node.firstChannel = static_cast<std::uint32_t>(node.channelSpec - 16) * 2u;
      node.channelCount = 2u;
    } else {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_NODE, index, ET_GRAPH_PATH_NODE_CHANNEL);
      return ET_ERR_GRAPH_INVALID;
    }
    if (node.firstChannel + node.channelCount > max_channels_) {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_NODE, index, ET_GRAPH_PATH_NODE_CHANNEL);
      return ET_ERR_GRAPH_INVALID;
    }
    for (const Node &prior : nodes_) {
      if (prior.id == node.id) {
        fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_NODE, index, ET_GRAPH_PATH_NODE_ID);
        return ET_ERR_GRAPH_INVALID;
      }
    }
    nodes_.push_back(std::move(node));
  }

  edges_.reserve(edge_count);
  for (std::uint32_t index = 0u; index < edge_count; ++index) {
    const std::uint8_t *record = edge_records + index * kDescriptorEdgeBytes;
    Edge edge{};
    edge.originalIndex = index;
    edge.source = readU32(record);
    edge.destination = readU32(record + 4u);
    edge.gain = readF32(record + 24u);
    edge.pan = readF32(record + 28u);
    edge.flags = readU32(record + 32u);
    if (!read_string(readU32(record + 8u), readU32(record + 12u), 128u, false, edge.id)) {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_EDGE, index, ET_GRAPH_PATH_EDGE_ID);
      return ET_ERR_GRAPH_INVALID;
    }
    if (!read_string(readU32(record + 16u), readU32(record + 20u), 128u, false, edge.mixGroup)) {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_EDGE, index, ET_GRAPH_PATH_EDGE_CONTROL);
      return ET_ERR_GRAPH_INVALID;
    }
    if (edge.source != kEndpoint && edge.source >= node_count) {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_EDGE, index, ET_GRAPH_PATH_EDGE_SOURCE);
      return ET_ERR_GRAPH_INVALID;
    }
    if (edge.destination != kEndpoint && edge.destination >= node_count) {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_EDGE, index, ET_GRAPH_PATH_EDGE_DESTINATION);
      return ET_ERR_GRAPH_INVALID;
    }
    if (edge.source != kEndpoint && edge.source == edge.destination) {
      fail(ET_ERR_GRAPH_CYCLE, ET_GRAPH_DIAGNOSTIC_EDGE, index, ET_GRAPH_PATH_GRAPH_CYCLE);
      return ET_ERR_GRAPH_CYCLE;
    }
    if (!std::isfinite(edge.gain) || edge.gain < 0.0F || edge.gain > 4.0F) {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_EDGE, index, ET_GRAPH_PATH_EDGE_GAIN);
      return ET_ERR_GRAPH_INVALID;
    }
    if ((edge.flags & ~(kEdgeFlagMute | kEdgeFlagSolo | kEdgeFlagPan)) != 0u ||
        readU32(record + 36u) != 0u) {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_EDGE, index, ET_GRAPH_PATH_EDGE_CONTROL);
      return ET_ERR_GRAPH_INVALID;
    }
    if ((edge.flags & kEdgeFlagPan) != 0u) {
      if (max_channels_ != 2u || !std::isfinite(edge.pan) || edge.pan < -1.0F || edge.pan > 1.0F) {
        fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_EDGE, index, ET_GRAPH_PATH_EDGE_PAN);
        return ET_ERR_GRAPH_INVALID;
      }
    } else if (edge.pan != 0.0F) {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_EDGE, index, ET_GRAPH_PATH_EDGE_PAN);
      return ET_ERR_GRAPH_INVALID;
    }
    for (const Edge &prior : edges_) {
      if (prior.id == edge.id) {
        fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_EDGE, index, ET_GRAPH_PATH_EDGE_ID);
        return ET_ERR_GRAPH_INVALID;
      }
    }
    edges_.push_back(std::move(edge));
  }
  identity_ = nodes_.empty() && edges_.empty();
  return ET_OK;
}

et_status GraphPlan::validateStructure() {
  const std::uint32_t node_count = static_cast<std::uint32_t>(nodes_.size());
  std::vector<std::uint32_t> indegree(node_count, 0u);
  std::vector<std::vector<std::uint32_t>> outgoing(node_count);
  for (std::uint32_t index = 0u; index < edges_.size(); ++index) {
    const Edge &edge = edges_[index];
    if (edge.source != kEndpoint && edge.destination != kEndpoint) {
      ++indegree[edge.destination];
      outgoing[edge.source].push_back(edge.destination);
    }
  }

  structural_order_.clear();
  structural_order_.reserve(node_count);
  std::vector<bool> emitted(node_count, false);
  while (structural_order_.size() < node_count) {
    std::uint32_t selected = kNoIndex;
    for (std::uint32_t index = 0u; index < node_count; ++index) {
      if (emitted[index] || indegree[index] != 0u) {
        continue;
      }
      if (selected == kNoIndex || byteLess(nodes_[index].id, nodes_[selected].id)) {
        selected = index;
      }
    }
    if (selected == kNoIndex) {
      fail(ET_ERR_GRAPH_CYCLE, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_GRAPH_CYCLE);
      return ET_ERR_GRAPH_CYCLE;
    }
    emitted[selected] = true;
    structural_order_.push_back(selected);
    for (std::uint32_t destination : outgoing[selected]) {
      --indegree[destination];
    }
  }

  std::vector<bool> from_input(node_count, false);
  for (const Edge &edge : edges_) {
    if (edge.source == kEndpoint && edge.destination != kEndpoint) {
      from_input[edge.destination] = true;
    }
  }
  for (std::uint32_t source : structural_order_) {
    if (!from_input[source]) {
      continue;
    }
    for (std::uint32_t destination : outgoing[source]) {
      from_input[destination] = true;
    }
  }

  std::vector<bool> to_output(node_count, false);
  for (const Edge &edge : edges_) {
    if (edge.source != kEndpoint && edge.destination == kEndpoint) {
      to_output[edge.source] = true;
    }
  }
  for (auto iterator = structural_order_.rbegin(); iterator != structural_order_.rend();
       ++iterator) {
    const std::uint32_t source = *iterator;
    for (std::uint32_t destination : outgoing[source]) {
      if (to_output[destination]) {
        to_output[source] = true;
      }
    }
  }

  for (std::uint32_t index = 0u; index < node_count; ++index) {
    if (!from_input[index] || !to_output[index]) {
      fail(ET_ERR_GRAPH_DISCONNECTED, ET_GRAPH_DIAGNOSTIC_NODE, index,
           ET_GRAPH_PATH_GRAPH_CONNECTIVITY);
      return ET_ERR_GRAPH_DISCONNECTED;
    }
  }
  for (std::uint32_t index = 0u; index < edges_.size(); ++index) {
    const Edge &edge = edges_[index];
    const bool source_connected = edge.source == kEndpoint || from_input[edge.source];
    const bool destination_connected = edge.destination == kEndpoint || to_output[edge.destination];
    if (!source_connected || !destination_connected) {
      fail(ET_ERR_GRAPH_DISCONNECTED, ET_GRAPH_DIAGNOSTIC_EDGE, index,
           ET_GRAPH_PATH_GRAPH_CONNECTIVITY);
      return ET_ERR_GRAPH_DISCONNECTED;
    }
  }
  return ET_OK;
}

et_status GraphPlan::buildEffectivePlan(Engine &engine) {
  for (Edge &edge : edges_) {
    bool has_solo = false;
    for (const Edge &candidate : edges_) {
      if (candidate.destination == edge.destination && candidate.mixGroup == edge.mixGroup &&
          (candidate.flags & kEdgeFlagSolo) != 0u) {
        has_solo = true;
        break;
      }
    }
    edge.active =
        (edge.flags & kEdgeFlagMute) == 0u && (!has_solo || (edge.flags & kEdgeFlagSolo) != 0u);
  }

  std::vector<bool> reaches_output(nodes_.size(), false);
  for (const Edge &edge : edges_) {
    if (edge.active && edge.source != kEndpoint && edge.destination == kEndpoint) {
      reaches_output[edge.source] = true;
    }
  }
  for (auto iterator = structural_order_.rbegin(); iterator != structural_order_.rend();
       ++iterator) {
    const std::uint32_t source = *iterator;
    for (const Edge &edge : edges_) {
      if (edge.active && edge.source == source && edge.destination != kEndpoint &&
          reaches_output[edge.destination]) {
        reaches_output[source] = true;
      }
    }
  }

  schedule_.clear();
  std::uint32_t effective_instance_count = 0u;
  std::uint32_t first_over_capacity_node = kNoIndex;
  for (std::uint32_t index : structural_order_) {
    Node &node = nodes_[index];
    node.effective = reaches_output[index];
    node.dormant = !node.effective;
    if (!node.effective) {
      continue;
    }
    node.scheduleIndex = static_cast<std::uint32_t>(schedule_.size());
    schedule_.push_back(index);
    if (!node.enabled) {
      continue;
    }
    ++effective_instance_count;
    if (effective_instance_count == Engine::kMaxInstances + 1u) {
      first_over_capacity_node = node.originalIndex;
    }
  }
  if (effective_instance_count > Engine::kMaxInstances) {
    fail(ET_ERR_GRAPH_CAPACITY, ET_GRAPH_DIAGNOSTIC_NODE, first_over_capacity_node,
         ET_GRAPH_PATH_NODE_INSTANCE, effective_instance_count, Engine::kMaxInstances);
    return ET_ERR_GRAPH_CAPACITY;
  }

  for (std::uint32_t index : schedule_) {
    Node &node = nodes_[index];
    if (!node.enabled) {
      continue;
    }
    Engine::InstanceSlot *slot = engine.findInstance(node.instance);
    if (slot == nullptr) {
      fail(ET_ERR_GRAPH_INVALID, ET_GRAPH_DIAGNOSTIC_NODE, node.originalIndex,
           ET_GRAPH_PATH_NODE_INSTANCE);
      return ET_ERR_GRAPH_INVALID;
    }
    slot->kernel->applyPendingParameters();
    if (engine.graphRequiresActiveAsset(*slot) &&
        slot->kernel->assetState(0u) != ET_ASSET_STATE_ACTIVE) {
      fail(ET_ERR_GRAPH_INSTANCE_PREPARE, ET_GRAPH_DIAGNOSTIC_NODE, node.originalIndex,
           ET_GRAPH_PATH_NODE_ASSET);
      return ET_ERR_GRAPH_INSTANCE_PREPARE;
    }
    node.kernelLatency = slot->kernel->latencySamples();
    if (node.kernelLatency != 0u && !engine.graphUniformOutputLatency(*slot)) {
      fail(ET_ERR_GRAPH_UNSUPPORTED_CAPABILITY, ET_GRAPH_DIAGNOSTIC_NODE, node.originalIndex,
           ET_GRAPH_PATH_NODE_LATENCY);
      return ET_ERR_GRAPH_UNSUPPORTED_CAPABILITY;
    }
  }

  for (Edge &edge : edges_) {
    edge.dormant =
        edge.active && ((edge.source != kEndpoint && !nodes_[edge.source].effective) ||
                        (edge.destination != kEndpoint && !nodes_[edge.destination].effective));
    if (!edge.active || edge.dormant) {
      continue;
    }
    if (edge.destination == kEndpoint) {
      output_edges_.push_back(edge.originalIndex);
    } else {
      nodes_[edge.destination].incomingEdges.push_back(edge.originalIndex);
    }
  }
  const auto edge_order = [&](std::uint32_t left, std::uint32_t right) {
    return byteLess(edges_[left].id, edges_[right].id);
  };
  std::sort(output_edges_.begin(), output_edges_.end(), edge_order);
  for (Node &node : nodes_) {
    std::sort(node.incomingEdges.begin(), node.incomingEdges.end(), edge_order);
  }

  std::vector<bool> input_reaches(nodes_.size(), false);
  bool input_reaches_output = false;
  for (std::uint32_t node_index : schedule_) {
    Node &node = nodes_[node_index];
    for (std::uint32_t edge_index : node.incomingEdges) {
      const Edge &edge = edges_[edge_index];
      if (edge.source == kEndpoint || input_reaches[edge.source]) {
        input_reaches[node_index] = true;
        break;
      }
    }
  }
  for (std::uint32_t edge_index : output_edges_) {
    const Edge &edge = edges_[edge_index];
    if (edge.source == kEndpoint || input_reaches[edge.source]) {
      input_reaches_output = true;
      break;
    }
  }
  bool has_effective_generator = false;
  for (std::uint32_t node_index : schedule_) {
    has_effective_generator = has_effective_generator || nodes_[node_index].enabled;
  }
  silence_ = !identity_ && !input_reaches_output && !has_effective_generator;
  return ET_OK;
}

et_status GraphPlan::buildLatencyAndStorage(Engine &engine) {
  static_cast<void>(engine);
  for (std::uint32_t node_index : schedule_) {
    Node &node = nodes_[node_index];
    node.inputLatency = {};
    for (std::uint32_t edge_index : node.incomingEdges) {
      const Edge &edge = edges_[edge_index];
      const std::array<std::uint32_t, 8> *source_latency =
          edge.source == kEndpoint ? nullptr : &nodes_[edge.source].outputLatency;
      for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
        const std::uint32_t latency = source_latency == nullptr ? 0u : (*source_latency)[channel];
        node.inputLatency[channel] =
            latency > node.inputLatency[channel] ? latency : node.inputLatency[channel];
      }
    }
    for (std::uint32_t edge_index : node.incomingEdges) {
      Edge &edge = edges_[edge_index];
      const std::array<std::uint32_t, 8> *source_latency =
          edge.source == kEndpoint ? nullptr : &nodes_[edge.source].outputLatency;
      for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
        const std::uint32_t latency = source_latency == nullptr ? 0u : (*source_latency)[channel];
        edge.compensation[channel] = node.inputLatency[channel] - latency;
      }
    }
    node.outputLatency = node.inputLatency;
    if (!node.enabled) {
      continue;
    }
    std::uint32_t group_latency = 0u;
    for (std::uint32_t offset = 0u; offset < node.channelCount; ++offset) {
      const std::uint32_t channel = node.firstChannel + offset;
      group_latency =
          node.inputLatency[channel] > group_latency ? node.inputLatency[channel] : group_latency;
    }
    if (node.kernelLatency > std::numeric_limits<std::uint32_t>::max() - group_latency) {
      fail(ET_ERR_GRAPH_LATENCY_OVERFLOW, ET_GRAPH_DIAGNOSTIC_NODE, node.originalIndex,
           ET_GRAPH_PATH_GRAPH_LATENCY);
      return ET_ERR_GRAPH_LATENCY_OVERFLOW;
    }
    const std::uint32_t output_latency = group_latency + node.kernelLatency;
    for (std::uint32_t offset = 0u; offset < node.channelCount; ++offset) {
      const std::uint32_t channel = node.firstChannel + offset;
      node.preDelay[channel] = group_latency - node.inputLatency[channel];
      node.outputLatency[channel] = output_latency;
    }
  }

  output_latency_ = {};
  for (std::uint32_t edge_index : output_edges_) {
    const Edge &edge = edges_[edge_index];
    const std::array<std::uint32_t, 8> *source_latency =
        edge.source == kEndpoint ? nullptr : &nodes_[edge.source].outputLatency;
    for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
      const std::uint32_t latency = source_latency == nullptr ? 0u : (*source_latency)[channel];
      output_latency_[channel] =
          latency > output_latency_[channel] ? latency : output_latency_[channel];
    }
  }
  for (std::uint32_t edge_index : output_edges_) {
    Edge &edge = edges_[edge_index];
    const std::array<std::uint32_t, 8> *source_latency =
        edge.source == kEndpoint ? nullptr : &nodes_[edge.source].outputLatency;
    for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
      const std::uint32_t latency = source_latency == nullptr ? 0u : (*source_latency)[channel];
      edge.compensation[channel] = output_latency_[channel] - latency;
    }
  }
  latency_samples_ = maximum(output_latency_, max_channels_);
  for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
    output_delays_[channel] = latency_samples_ - output_latency_[channel];
  }
  if (identity_ || silence_) {
    latency_samples_ = 0u;
    output_latency_ = {};
    output_delays_ = {};
  }

  const std::uint32_t output_position = static_cast<std::uint32_t>(schedule_.size());
  for (std::uint32_t node_index : schedule_) {
    Node &node = nodes_[node_index];
    node.lastUse = node.scheduleIndex;
  }
  for (const Edge &edge : edges_) {
    if (!edge.active || edge.dormant || edge.source == kEndpoint) {
      continue;
    }
    const std::uint32_t use =
        edge.destination == kEndpoint ? output_position : nodes_[edge.destination].scheduleIndex;
    nodes_[edge.source].lastUse =
        use > nodes_[edge.source].lastUse ? use : nodes_[edge.source].lastUse;
  }
  std::vector<std::uint32_t> slot_last_use;
  for (std::uint32_t position = 0u; position < schedule_.size(); ++position) {
    Node &node = nodes_[schedule_[position]];
    std::uint32_t slot = kNoIndex;
    for (std::uint32_t candidate = 0u; candidate < slot_last_use.size(); ++candidate) {
      if (slot_last_use[candidate] < position) {
        slot = candidate;
        break;
      }
    }
    if (slot == kNoIndex) {
      slot = static_cast<std::uint32_t>(slot_last_use.size());
      slot_last_use.push_back(node.lastUse);
    } else {
      slot_last_use[slot] = node.lastUse;
    }
    node.bufferSlot = slot;
  }
  buffer_slot_count_ =
      identity_ || silence_ ? 0u : static_cast<std::uint32_t>(slot_last_use.size()) + 1u;
  if (silence_) {
    for (std::uint32_t node_index : schedule_) {
      nodes_[node_index].bufferSlot = kNoIndex;
    }
  }
  if (buffer_slot_count_ > kMaxBufferSlots) {
    fail(ET_ERR_GRAPH_CAPACITY, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_GRAPH_BUFFERS,
         buffer_slot_count_, kMaxBufferSlots);
    return ET_ERR_GRAPH_CAPACITY;
  }

  const std::uint64_t slab_floats = static_cast<std::uint64_t>(max_channels_) * max_frames_;
  std::uint64_t workspace_bytes =
      slab_floats * buffer_slot_count_ * static_cast<std::uint64_t>(sizeof(float));
  const auto add_delay = [&](std::uint32_t delay) {
    if (delay != 0u) {
      workspace_bytes += static_cast<std::uint64_t>(max_channels_) * (delay + 1ull) *
                         static_cast<std::uint64_t>(sizeof(float));
    }
  };
  for (const Edge &edge : edges_) {
    if (edge.active && !edge.dormant) {
      add_delay(maximum(edge.compensation, max_channels_));
    }
  }
  for (std::uint32_t node_index : schedule_) {
    add_delay(maximum(nodes_[node_index].preDelay, max_channels_));
  }
  add_delay(maximum(output_delays_, max_channels_));
  if (workspace_bytes > kMaxWorkspaceBytes ||
      workspace_bytes > std::numeric_limits<std::uint32_t>::max()) {
    fail(ET_ERR_GRAPH_CAPACITY, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_GRAPH_MEMORY,
         workspace_bytes > std::numeric_limits<std::uint32_t>::max()
             ? std::numeric_limits<std::uint32_t>::max()
             : static_cast<std::uint32_t>(workspace_bytes),
         kMaxWorkspaceBytes);
    return ET_ERR_GRAPH_CAPACITY;
  }
  workspace_bytes_ = static_cast<std::uint32_t>(workspace_bytes);
  buffers_.assign(static_cast<std::size_t>(slab_floats) * buffer_slot_count_, 0.0F);
  for (Edge &edge : edges_) {
    const std::uint32_t delay = maximum(edge.compensation, max_channels_);
    if (edge.active && !edge.dormant && delay != 0u &&
        !edge.delayLine.prepare(max_channels_, delay)) {
      fail(ET_ERR_OOM, ET_GRAPH_DIAGNOSTIC_EDGE, edge.originalIndex, ET_GRAPH_PATH_GRAPH_DELAY);
      return ET_ERR_OOM;
    }
  }
  for (std::uint32_t node_index : schedule_) {
    Node &node = nodes_[node_index];
    const std::uint32_t delay = maximum(node.preDelay, max_channels_);
    if (delay != 0u && !node.preDelayLine.prepare(max_channels_, delay)) {
      fail(ET_ERR_OOM, ET_GRAPH_DIAGNOSTIC_NODE, node.originalIndex, ET_GRAPH_PATH_GRAPH_DELAY);
      return ET_ERR_OOM;
    }
  }
  const std::uint32_t output_delay = maximum(output_delays_, max_channels_);
  if (output_delay != 0u && !output_delay_line_.prepare(max_channels_, output_delay)) {
    fail(ET_ERR_OOM, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_GRAPH_DELAY);
    return ET_ERR_OOM;
  }
  return ET_OK;
}

void GraphPlan::buildSnapshot() {
  const std::uint64_t schedule_bytes = schedule_.size() * sizeof(std::uint32_t);
  const std::uint64_t node_bytes = nodes_.size() * kSnapshotNodeBytes;
  const std::uint64_t edge_bytes = edges_.size() * kSnapshotEdgeBytes;
  const std::uint64_t total = kSnapshotHeaderBytes + schedule_bytes + node_bytes + edge_bytes;
  snapshot_.assign(static_cast<std::size_t>(total), 0u);
  std::uint8_t *header = snapshot_.data();
  const std::uint32_t schedule_offset = kSnapshotHeaderBytes;
  const std::uint32_t nodes_offset = schedule_offset + static_cast<std::uint32_t>(schedule_bytes);
  const std::uint32_t edges_offset = nodes_offset + static_cast<std::uint32_t>(node_bytes);
  writeU32(header, kSnapshotMagic);
  writeU32(header + 4u, kSnapshotVersion);
  writeU32(header + 8u, static_cast<std::uint32_t>(nodes_.size()));
  writeU32(header + 12u, static_cast<std::uint32_t>(edges_.size()));
  writeU32(header + 16u, static_cast<std::uint32_t>(schedule_.size()));
  writeU32(header + 20u, max_channels_);
  writeU32(header + 24u, buffer_slot_count_);
  writeU32(header + 28u, latency_samples_);
  writeU32(header + 32u, workspace_bytes_);
  writeU32(header + 36u, (identity_ ? 1u : 0u) | (silence_ ? 2u : 0u));
  writeU32(header + 40u, kSnapshotNodeBytes);
  writeU32(header + 44u, kSnapshotEdgeBytes);
  writeU32(header + 48u, schedule_offset);
  writeU32(header + 52u, nodes_offset);
  writeU32(header + 56u, edges_offset);
  writeU32(header + 60u, static_cast<std::uint32_t>(total));
  for (std::uint32_t channel = 0u; channel < 8u; ++channel) {
    writeU32(header + 64u + channel * 4u, output_latency_[channel]);
    writeU32(header + 96u + channel * 4u, output_delays_[channel]);
  }
  for (std::uint32_t index = 0u; index < schedule_.size(); ++index) {
    writeU32(header + schedule_offset + index * 4u, nodes_[schedule_[index]].originalIndex);
  }
  for (const Node &node : nodes_) {
    std::uint8_t *record = header + nodes_offset + node.originalIndex * kSnapshotNodeBytes;
    const std::uint32_t flags = (node.effective ? 1u : 0u) | (node.dormant ? 2u : 0u) |
                                (node.enabled ? 4u : 0u) |
                                (node.effective && !node.enabled ? 8u : 0u);
    writeU32(record, flags);
    writeU32(record + 4u, node.scheduleIndex);
    writeU32(record + 8u, node.bufferSlot);
    writeU32(record + 12u, node.instance);
    writeU32(record + 16u, node.firstChannel);
    writeU32(record + 20u, node.channelCount);
    writeU32(record + 24u, node.kernelLatency);
    for (std::uint32_t channel = 0u; channel < 8u; ++channel) {
      writeU32(record + 32u + channel * 4u, node.inputLatency[channel]);
      writeU32(record + 64u + channel * 4u, node.outputLatency[channel]);
      writeU32(record + 96u + channel * 4u, node.preDelay[channel]);
    }
  }
  for (const Edge &edge : edges_) {
    std::uint8_t *record = header + edges_offset + edge.originalIndex * kSnapshotEdgeBytes;
    const std::uint32_t flags = (edge.active && !edge.dormant ? 1u : 0u) |
                                (!edge.active ? 2u : 0u) | (edge.dormant ? 4u : 0u);
    writeU32(record, flags);
    writeU32(record + 4u, edge.source);
    writeU32(record + 8u, edge.destination);
    for (std::uint32_t channel = 0u; channel < 8u; ++channel) {
      writeU32(record + 16u + channel * 4u, edge.compensation[channel]);
    }
  }
}

float *GraphPlan::buffer(std::uint32_t slot) noexcept {
  if (slot >= buffer_slot_count_) {
    return nullptr;
  }
  const std::size_t slab = static_cast<std::size_t>(max_channels_) * max_frames_;
  return buffers_.data() + static_cast<std::size_t>(slot) * slab;
}

const float *GraphPlan::sourceBuffer(const Engine &engine, std::uint32_t source) const noexcept {
  if (source == kEndpoint) {
    return const_cast<Engine &>(engine).arena_.combined();
  }
  const std::uint32_t slot = nodes_[source].bufferSlot;
  const std::size_t slab = static_cast<std::size_t>(max_channels_) * max_frames_;
  return slot >= buffer_slot_count_ ? nullptr
                                    : buffers_.data() + static_cast<std::size_t>(slot) * slab;
}

void GraphPlan::mixEdge(Edge &edge, const float *source, float *destination,
                        std::uint32_t frame_count) noexcept {
  for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
    float channel_gain = edge.gain;
    if ((edge.flags & kEdgeFlagPan) != 0u) {
      if (channel == 0u && edge.pan > 0.0F) {
        channel_gain *= 1.0F - edge.pan;
      } else if (channel == 1u && edge.pan < 0.0F) {
        channel_gain *= 1.0F + edge.pan;
      }
    }
    const float *input = source + channel * frame_count;
    float *output = destination + channel * frame_count;
    const std::uint32_t delay = edge.compensation[channel];
    if (delay == 0u) {
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        output[frame] += input[frame] * channel_gain;
      }
      continue;
    }
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const float routed = input[frame] * channel_gain;
      edge.delayLine.push(channel, routed);
      output[frame] += edge.delayLine.read(channel, delay);
    }
  }
}

et_status GraphPlan::process(Engine &engine, std::uint32_t channel_count, std::uint32_t frame_count,
                             double time_seconds) noexcept {
  if (!configured_) {
    return ET_ERR_STATE;
  }
  if (channel_count != max_channels_) {
    return ET_ERR_ARGS;
  }
  if (identity_) {
    return ET_OK;
  }
  allocation_guard::Scope allocation_scope;
  float *main_bus = engine.arena_.combined();
  const std::uint32_t total_floats = channel_count * frame_count;
  if (silence_) {
    std::memset(main_bus, 0, static_cast<std::size_t>(total_floats) * sizeof(float));
    return ET_OK;
  }

  for (std::uint32_t node_index : schedule_) {
    Node &node = nodes_[node_index];
    float *output = buffer(node.bufferSlot);
    std::memset(output, 0, static_cast<std::size_t>(total_floats) * sizeof(float));
    for (std::uint32_t edge_index : node.incomingEdges) {
      Edge &edge = edges_[edge_index];
      mixEdge(edge, sourceBuffer(engine, edge.source), output, frame_count);
    }
    const std::uint32_t pre_delay = maximum(node.preDelay, max_channels_);
    if (pre_delay != 0u) {
      for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
        const std::uint32_t delay = node.preDelay[channel];
        if (delay == 0u) {
          continue;
        }
        float *audio = output + channel * frame_count;
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          node.preDelayLine.push(channel, audio[frame]);
          audio[frame] = node.preDelayLine.read(channel, delay);
        }
      }
    }
    if (!node.enabled) {
      continue;
    }
    Engine::InstanceSlot *slot = engine.findInstance(node.instance);
    if (slot == nullptr) {
      return ET_ERR_STATE;
    }
    engine.processSlot(*slot, output + node.firstChannel * frame_count, node.channelCount,
                       frame_count, time_seconds);
  }

  float *output = buffer(buffer_slot_count_ - 1u);
  std::memset(output, 0, static_cast<std::size_t>(total_floats) * sizeof(float));
  for (std::uint32_t edge_index : output_edges_) {
    Edge &edge = edges_[edge_index];
    mixEdge(edge, sourceBuffer(engine, edge.source), output, frame_count);
  }
  for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
    const std::uint32_t delay = output_delays_[channel];
    if (delay == 0u) {
      continue;
    }
    float *audio = output + channel * frame_count;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      output_delay_line_.push(channel, audio[frame]);
      audio[frame] = output_delay_line_.read(channel, delay);
    }
  }
  std::memcpy(main_bus, output, static_cast<std::size_t>(total_floats) * sizeof(float));
  return ET_OK;
}

void GraphPlan::reset() noexcept {
  std::fill(buffers_.begin(), buffers_.end(), 0.0F);
  for (Edge &edge : edges_) {
    edge.delayLine.reset();
  }
  for (Node &node : nodes_) {
    node.preDelayLine.reset();
  }
  output_delay_line_.reset();
}

bool GraphPlan::references(et_instance instance) const noexcept {
  for (const Node &node : nodes_) {
    if (node.enabled && node.effective && node.instance == instance) {
      return true;
    }
  }
  return false;
}

std::uint32_t GraphPlan::originalIndex(et_instance instance) const noexcept {
  for (const Node &node : nodes_) {
    if (node.enabled && node.effective && node.instance == instance) {
      return node.originalIndex;
    }
  }
  return kNoIndex;
}

} // namespace effetune

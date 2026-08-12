#ifndef EFFETUNE_CORE_GRAPH_H
#define EFFETUNE_CORE_GRAPH_H

#include "effetune/abi.h"
#include "effetune/dsp/delay_line.h"
#include "graph-v1-capacity.h"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace effetune {

class Engine;

class GraphPlan final {
public:
  static constexpr std::uint32_t kDescriptorVersion = 1u;
  static constexpr std::uint32_t kSnapshotVersion = 1u;
  static constexpr std::uint32_t kMaxNodes =
      static_cast<std::uint32_t>(graph_contract::kMaxStructuralNodes);
  static constexpr std::uint32_t kMaxEdges = static_cast<std::uint32_t>(graph_contract::kMaxEdges);
  static constexpr std::uint32_t kMaxBufferSlots =
      static_cast<std::uint32_t>(graph_contract::kMaxLiveBuffers);
  static constexpr std::uint32_t kMaxWorkspaceBytes =
      static_cast<std::uint32_t>(graph_contract::kMaxWorkspaceBytes);

  GraphPlan() = default;
  GraphPlan(GraphPlan &&) noexcept = default;
  GraphPlan &operator=(GraphPlan &&) noexcept = default;
  GraphPlan(const GraphPlan &) = delete;
  GraphPlan &operator=(const GraphPlan &) = delete;

  et_status configure(Engine &engine, const std::uint8_t *descriptor,
                      std::uint32_t descriptor_bytes);
  et_status process(Engine &engine, std::uint32_t channel_count, std::uint32_t frame_count,
                    double time_seconds) noexcept;
  void reset() noexcept;

  [[nodiscard]] bool configured() const noexcept { return configured_; }
  [[nodiscard]] std::uint32_t latency() const noexcept {
    return configured_ ? latency_samples_ : 0u;
  }
  [[nodiscard]] const std::vector<std::uint8_t> &snapshot() const noexcept { return snapshot_; }
  [[nodiscard]] const et_graph_diagnostic &diagnostic() const noexcept { return diagnostic_; }
  [[nodiscard]] bool references(et_instance instance) const noexcept;
  [[nodiscard]] std::uint32_t originalIndex(et_instance instance) const noexcept;

private:
  static constexpr std::uint32_t kEndpoint = 0xffffffffu;
  static constexpr std::uint32_t kNoIndex = 0xffffffffu;

  struct Node {
    et_instance instance = 0u;
    std::string id;
    std::uint32_t originalIndex = 0u;
    std::uint32_t flags = 0u;
    std::int32_t channelSpec = -2;
    std::uint32_t firstChannel = 0u;
    std::uint32_t channelCount = 0u;
    std::uint32_t kernelLatency = 0u;
    std::uint32_t scheduleIndex = kNoIndex;
    std::uint32_t bufferSlot = kNoIndex;
    std::uint32_t lastUse = 0u;
    bool enabled = false;
    bool effective = false;
    bool dormant = false;
    std::array<std::uint32_t, 8> inputLatency{};
    std::array<std::uint32_t, 8> outputLatency{};
    std::array<std::uint32_t, 8> preDelay{};
    std::vector<std::uint32_t> incomingEdges;
    dsp::DelayLine preDelayLine;
  };

  struct Edge {
    std::string id;
    std::string mixGroup;
    std::uint32_t originalIndex = 0u;
    std::uint32_t source = kEndpoint;
    std::uint32_t destination = kEndpoint;
    float gain = 1.0F;
    float pan = 0.0F;
    std::uint32_t flags = 0u;
    bool active = false;
    bool dormant = false;
    std::array<std::uint32_t, 8> compensation{};
    dsp::DelayLine delayLine;
  };

  void fail(et_status status, std::uint32_t kind, std::uint32_t index, std::uint32_t path,
            std::uint32_t required = 0u, std::uint32_t capacity = 0u) noexcept;
  [[nodiscard]] et_status parseDescriptor(Engine &engine, const std::uint8_t *descriptor,
                                          std::uint32_t descriptor_bytes);
  [[nodiscard]] et_status validateStructure();
  [[nodiscard]] et_status buildEffectivePlan(Engine &engine);
  [[nodiscard]] et_status buildLatencyAndStorage(Engine &engine);
  void buildSnapshot();
  void mixEdge(Edge &edge, const float *source, float *destination,
               std::uint32_t frame_count) noexcept;
  [[nodiscard]] float *buffer(std::uint32_t slot) noexcept;
  [[nodiscard]] const float *sourceBuffer(const Engine &engine,
                                          std::uint32_t source) const noexcept;

  std::vector<Node> nodes_;
  std::vector<Edge> edges_;
  std::vector<std::uint32_t> structural_order_;
  std::vector<std::uint32_t> schedule_;
  std::vector<std::uint32_t> output_edges_;
  std::vector<float> buffers_;
  std::vector<std::uint8_t> snapshot_;
  dsp::DelayLine output_delay_line_;
  std::array<std::uint32_t, 8> output_latency_{};
  std::array<std::uint32_t, 8> output_delays_{};
  et_graph_diagnostic diagnostic_{ET_OK, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_NONE, 0u, 0u};
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t buffer_slot_count_ = 0u;
  std::uint32_t latency_samples_ = 0u;
  std::uint32_t workspace_bytes_ = 0u;
  bool identity_ = false;
  bool silence_ = false;
  bool configured_ = false;
};

} // namespace effetune

#endif

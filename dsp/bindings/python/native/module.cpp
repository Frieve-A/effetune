#include "effetune/abi.h"
#include "effetune/kernel.h"
#include "engine.h"

#include <nanobind/nanobind.h>
#include <nanobind/ndarray.h>
#include <nanobind/stl/string.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace nb = nanobind;

namespace {

using PlanarFloat32 = nb::ndarray<nb::numpy, float, nb::ndim<2>, nb::c_contig, nb::device::cpu>;
using PlanarConstFloat32 =
    nb::ndarray<nb::numpy, const float, nb::ndim<2>, nb::c_contig, nb::device::cpu>;
using PackedFloat32 =
    nb::ndarray<nb::numpy, const float, nb::ndim<1>, nb::c_contig, nb::device::cpu>;
using PackedUint8 =
    nb::ndarray<nb::numpy, const std::uint8_t, nb::ndim<1>, nb::c_contig, nb::device::cpu>;
using MatrixUint32 =
    nb::ndarray<nb::numpy, const std::uint32_t, nb::ndim<2>, nb::c_contig, nb::device::cpu>;

constexpr std::uint32_t kAssetHeaderBytes = 32u;
constexpr std::uint32_t kAssetMagic = 0x31415445u;
constexpr std::uint32_t kPathRecordBytes = 12u;
constexpr std::uint32_t kTelemetryRingBytes = 256u * 1024u;
constexpr float kTelemetryRateHz = 60.0F;
constexpr std::size_t kAssetCapacity = 32u * 1024u * 1024u;
constexpr std::size_t kConvolverImplUpperBound = 512u;
constexpr std::size_t kConvolverStageUpperBound = 512u;
constexpr std::size_t kPffftSetupFixedUpperBound = 136u;

void checkStatus(const char *operation, et_status status) {
  if (status != ET_OK) {
    throw std::runtime_error(std::string(operation) + " failed");
  }
}

void writeU32(std::uint8_t *bytes, std::uint32_t value) noexcept {
  bytes[0] = static_cast<std::uint8_t>(value);
  bytes[1] = static_cast<std::uint8_t>(value >> 8u);
  bytes[2] = static_cast<std::uint8_t>(value >> 16u);
  bytes[3] = static_cast<std::uint8_t>(value >> 24u);
}

std::uint32_t readU32(const std::uint8_t *bytes) noexcept {
  return static_cast<std::uint32_t>(bytes[0]) | (static_cast<std::uint32_t>(bytes[1]) << 8u) |
         (static_cast<std::uint32_t>(bytes[2]) << 16u) |
         (static_cast<std::uint32_t>(bytes[3]) << 24u);
}

std::size_t nextPowerOfTwo(std::size_t value) noexcept {
  std::size_t result = 1u;
  while (result < value) {
    result *= 2u;
  }
  return result;
}

struct HostStage {
  std::uint32_t block;
  std::uint32_t offset;
  std::uint32_t frames;
};

std::vector<HostStage> hostStages(std::uint32_t frames, std::uint32_t head_block) {
  const std::uint32_t head = head_block == 0u ? 128u : head_block;
  std::vector<HostStage> stages;
  const auto add = [&](std::uint32_t block, std::uint32_t offset, std::uint32_t end) {
    if (offset < frames && end > offset) {
      stages.push_back({block, offset, std::min(end, frames) - offset});
    }
  };
  add(head, head_block == 0u ? 128u : 0u, 4u * head);
  for (std::uint32_t block = 2u * head; block < 4096u; block *= 2u) {
    add(block, 2u * block, 4u * block);
  }
  add(4096u, 8192u, frames);
  return stages;
}

std::uint32_t topologyPathCount(std::uint32_t topology, std::uint32_t asset_channels,
                                std::uint32_t processing_channels,
                                std::uint32_t matrix_paths) noexcept {
  if (topology == 1u) {
    return processing_channels;
  }
  if (topology == 3u) {
    return 4u;
  }
  if (topology == 4u) {
    return matrix_paths;
  }
  return asset_channels;
}

std::uint32_t topologyInputCount(std::uint32_t topology, std::uint32_t processing_channels,
                                 std::uint32_t matrix_inputs) noexcept {
  if (topology == 3u) {
    return 2u;
  }
  if (topology == 4u) {
    return matrix_inputs;
  }
  return processing_channels;
}

std::size_t convolverUpperBound(std::uint32_t frames, std::uint32_t asset_channels,
                                std::uint32_t topology, std::uint32_t processing_channels,
                                std::uint32_t head_block, std::uint32_t matrix_paths,
                                std::uint32_t matrix_inputs) {
  const std::uint32_t paths =
      topologyPathCount(topology, asset_channels, processing_channels, matrix_paths);
  const std::uint32_t inputs = topologyInputCount(topology, processing_channels, matrix_inputs);
  std::size_t required_ring = static_cast<std::size_t>(head_block) + 4096u;
  std::size_t bytes = kConvolverImplUpperBound;
  for (const HostStage &stage : hostStages(frames, head_block)) {
    required_ring = std::max(required_ring, static_cast<std::size_t>(head_block) + stage.offset +
                                                stage.block + 4096u);
    const std::size_t fft = 2u * static_cast<std::size_t>(stage.block);
    const std::size_t partitions =
        (static_cast<std::size_t>(stage.frames) + stage.block - 1u) / stage.block;
    const std::size_t floats =
        3u * static_cast<std::size_t>(inputs) * stage.block + 2u * fft +
        static_cast<std::size_t>(inputs + asset_channels) * partitions * fft +
        2u * static_cast<std::size_t>(processing_channels) * fft;
    bytes += kConvolverStageUpperBound + floats * sizeof(float) +
             nextPowerOfTwo(paths) * kPathRecordBytes + kPffftSetupFixedUpperBound +
             fft * sizeof(float);
  }
  bytes +=
      static_cast<std::size_t>(processing_channels) * nextPowerOfTwo(required_ring) * sizeof(float);
  if (head_block == 0u) {
    bytes += static_cast<std::size_t>(asset_channels + inputs) * 128u * sizeof(float);
  }
  return bytes + static_cast<std::size_t>(inputs) * sizeof(float);
}

std::size_t assetFootprint(std::uint32_t frames, std::uint32_t asset_channels,
                           std::uint32_t topology, std::uint32_t processing_channels,
                           std::uint32_t head_block, std::uint32_t matrix_paths,
                           std::uint32_t matrix_inputs) {
  const std::size_t payload =
      kAssetHeaderBytes +
      (topology == 4u ? static_cast<std::size_t>(matrix_paths) * kPathRecordBytes : 0u) +
      static_cast<std::size_t>(frames) * asset_channels * sizeof(float);
  const std::size_t begin_upper_bound =
      payload + static_cast<std::size_t>(frames) * asset_channels * 16u + 2u * 1024u * 1024u;
  return std::max(begin_upper_bound, payload + convolverUpperBound(frames, asset_channels, topology,
                                                                   processing_channels, head_block,
                                                                   matrix_paths, matrix_inputs));
}

std::int8_t channelSpec(const std::string &channel) {
  if (channel == "all") {
    return -2;
  }
  if (channel == "stereo") {
    return -1;
  }
  if (channel == "left") {
    return 0;
  }
  if (channel == "right") {
    return 1;
  }
  if (channel.size() == 1u && channel[0] >= '1' && channel[0] <= '8') {
    return static_cast<std::int8_t>(channel[0] - '1');
  }
  if (channel == "34") {
    return 17;
  }
  if (channel == "56") {
    return 18;
  }
  if (channel == "78") {
    return 19;
  }
  throw std::invalid_argument("unsupported channel selection");
}

std::uint32_t topologyCode(const std::string &topology) {
  if (topology == "mono") {
    return 1u;
  }
  if (topology == "independent") {
    return 2u;
  }
  if (topology == "trueStereo") {
    return 3u;
  }
  if (topology == "matrix") {
    return 4u;
  }
  throw std::invalid_argument("unsupported IR topology");
}

class NativeChain final {
public:
  NativeChain(double sample_rate, std::uint32_t channels, std::uint32_t block_size)
      : sample_rate_(sample_rate), channels_(channels), block_size_(block_size),
        engine_(std::make_unique<effetune::Engine>()) {
    if (!std::isfinite(sample_rate) || sample_rate <= 0.0 ||
        sample_rate > static_cast<double>(std::numeric_limits<float>::max()) || channels == 0u ||
        channels > 8u || block_size == 0u) {
      throw std::invalid_argument("invalid native chain configuration");
    }
    checkStatus("DSP preparation", engine_->prepare(static_cast<float>(sample_rate), channels,
                                                    block_size, kTelemetryRingBytes));
    checkStatus("DSP telemetry configuration", engine_->setTelemetryRate(0.0F));
    telemetry_buffer_.resize(kTelemetryRingBytes);
  }

  std::uint32_t addEffect(const std::string &internal_type, PackedFloat32 parameters,
                          std::uint32_t layout_hash, std::uint32_t seed,
                          const std::string &channel) {
    requireOpen();
    if (finished_ || parameters.shape(0) > std::numeric_limits<std::uint32_t>::max()) {
      throw std::invalid_argument("cannot add this effect");
    }
    const et_instance handle = engine_->createInstance(internal_type.c_str());
    if (handle == 0u) {
      throw std::runtime_error("DSP effect preparation failed");
    }
    checkStatus("DSP telemetry mapping",
                engine_->setInstanceTap(handle, static_cast<std::uint32_t>(nodes_.size() + 1u)));
    checkStatus("DSP seed staging", engine_->setInstanceSeed(handle, seed, 0u));
    checkStatus("DSP parameter staging",
                engine_->setInstanceParams(handle, parameters.data(),
                                           static_cast<std::uint32_t>(parameters.shape(0)),
                                           layout_hash, 0u));
    Node node;
    node.handle = handle;
    node.channel_spec = channelSpec(channel);
    node.seed = seed;
    node.layout_hash = layout_hash;
    node.parameters.assign(parameters.data(), parameters.data() + parameters.shape(0));
    nodes_.push_back(std::move(node));
    return static_cast<std::uint32_t>(nodes_.size() - 1u);
  }

  void setIr(std::uint32_t node_index, PlanarConstFloat32 samples, std::uint32_t asset_sample_rate,
             const std::string &topology_name, std::uint32_t head_block, std::uint32_t rate_divider,
             MatrixUint32 paths, std::uint32_t input_count, std::uint32_t processing_channels) {
    requireOpen();
    if (finished_ || node_index >= nodes_.size() || samples.shape(0) == 0u ||
        samples.shape(0) > 8u || samples.shape(1) == 0u ||
        samples.shape(0) > std::numeric_limits<std::uint32_t>::max() ||
        samples.shape(1) > std::numeric_limits<std::uint32_t>::max() || paths.shape(1) != 3u ||
        paths.shape(0) > std::numeric_limits<std::uint32_t>::max()) {
      throw std::invalid_argument("invalid impulse-response asset");
    }
    const auto asset_channels = static_cast<std::uint32_t>(samples.shape(0));
    const auto frames = static_cast<std::uint32_t>(samples.shape(1));
    const auto path_count = static_cast<std::uint32_t>(paths.shape(0));
    const std::uint32_t topology = topologyCode(topology_name);
    if ((topology != 4u && (path_count != 0u || input_count != 0u)) ||
        (topology == 4u && (path_count == 0u || input_count == 0u))) {
      throw std::invalid_argument("invalid impulse-response matrix routes");
    }
    const std::size_t sample_bytes =
        static_cast<std::size_t>(asset_channels) * frames * sizeof(float);
    const std::size_t path_bytes =
        topology == 4u ? static_cast<std::size_t>(path_count) * kPathRecordBytes : 0u;
    const std::size_t payload_bytes = kAssetHeaderBytes + path_bytes + sample_bytes;
    const std::size_t footprint = assetFootprint(
        frames, asset_channels, topology, processing_channels, head_block, path_count, input_count);
    if (payload_bytes > kAssetCapacity || footprint > kAssetCapacity ||
        payload_bytes > std::numeric_limits<std::uint32_t>::max() ||
        footprint > std::numeric_limits<std::uint32_t>::max()) {
      throw std::invalid_argument(
          "impulse-response asset exceeds the native 32 MiB footprint limit");
    }
    std::vector<std::uint8_t> payload(payload_bytes, 0u);
    writeU32(payload.data(), kAssetMagic);
    writeU32(payload.data() + 4u, asset_channels);
    writeU32(payload.data() + 8u, frames);
    writeU32(payload.data() + 12u, asset_sample_rate);
    writeU32(payload.data() + 16u, topology);
    writeU32(payload.data() + 20u, topology == 4u ? path_count : 0u);
    for (std::uint32_t index = 0u; index < path_count; ++index) {
      std::uint8_t *record =
          payload.data() + kAssetHeaderBytes + static_cast<std::size_t>(index) * kPathRecordBytes;
      writeU32(record, paths(index, 0u));
      writeU32(record + 4u, paths(index, 1u));
      writeU32(record + 8u, paths(index, 2u));
    }
    std::memcpy(payload.data() + kAssetHeaderBytes + path_bytes, samples.data(), sample_bytes);
    const effetune::AssetBeginInfo info{asset_channels,
                                        frames,
                                        topology,
                                        head_block,
                                        rate_divider,
                                        topology == 4u ? path_count : 0u,
                                        topology == 4u ? input_count : 0u,
                                        processing_channels,
                                        static_cast<std::uint32_t>(footprint),
                                        static_cast<std::uint32_t>(payload_bytes)};
    std::uint8_t *staging = engine_->beginInstanceAsset(nodes_[node_index].handle, 0u, info);
    if (staging == nullptr) {
      throw std::runtime_error("DSP rejected the impulse-response asset");
    }
    std::memcpy(staging, payload.data(), payload.size());
    checkStatus("DSP asset commit",
                engine_->commitInstanceAsset(nodes_[node_index].handle, 0u,
                                             static_cast<std::uint32_t>(payload.size()),
                                             ET_ASSET_F32_MULTICH));
    asset_nodes_.push_back({node_index, processing_channels});
  }

  void finish() {
    requireOpen();
    if (finished_) {
      return;
    }
    std::vector<std::uint8_t> descriptor(8u + nodes_.size() * 12u, 0u);
    writeU32(descriptor.data(), effetune::Engine::kPipelineDescriptorVersion);
    writeU32(descriptor.data() + 4u, static_cast<std::uint32_t>(nodes_.size()));
    for (std::size_t index = 0u; index < nodes_.size(); ++index) {
      std::uint8_t *record = descriptor.data() + 8u + index * 12u;
      writeU32(record, nodes_[index].handle);
      record[4] = 1u;
      record[5] = 0u;
      record[6] = 0u;
      record[7] = static_cast<std::uint8_t>(nodes_[index].channel_spec);
      record[8] = 1u;
    }
    checkStatus("DSP pipeline configuration",
                engine_->configurePipeline(descriptor.data(),
                                           static_cast<std::uint32_t>(descriptor.size())));
    prewarmAssets();
    checkStatus("DSP reset", engine_->reset());
    finished_ = true;
  }

  et_status finishGraph(PackedUint8 descriptor_input) {
    requireOpen();
    if (finished_ || descriptor_input.shape(0) < 32u ||
        descriptor_input.shape(0) > std::numeric_limits<std::uint32_t>::max()) {
      throw std::invalid_argument("invalid Graph descriptor");
    }
    std::vector<std::uint8_t> descriptor(descriptor_input.data(),
                                         descriptor_input.data() + descriptor_input.shape(0));
    const std::uint32_t node_count = readU32(descriptor.data() + 8u);
    const std::size_t node_bytes = static_cast<std::size_t>(node_count) * 24u;
    if (node_bytes > descriptor.size() - 32u) {
      throw std::invalid_argument("invalid Graph node records");
    }
    for (std::uint32_t index = 0u; index < node_count; ++index) {
      std::uint8_t *record = descriptor.data() + 32u + static_cast<std::size_t>(index) * 24u;
      const std::uint32_t token = readU32(record);
      if (token == 0u) {
        continue;
      }
      if (token > nodes_.size()) {
        throw std::invalid_argument("invalid Graph instance token");
      }
      writeU32(record, nodes_[token - 1u].handle);
    }
    prewarmAssets();
    checkStatus("DSP reset", engine_->reset());
    restoreInitialNodeConfiguration();
    const et_status status =
        engine_->configureGraph(descriptor.data(), static_cast<std::uint32_t>(descriptor.size()));
    if (status == ET_OK) {
      graph_mode_ = true;
      finished_ = true;
    }
    return status;
  }

  void setEffectParameters(std::uint32_t node_index, PackedFloat32 parameters,
                           std::uint32_t layout_hash) {
    requireOpen();
    if (!finished_ || node_index >= nodes_.size() ||
        parameters.shape(0) > std::numeric_limits<std::uint32_t>::max()) {
      throw std::invalid_argument("cannot update this effect");
    }
    checkStatus("DSP parameter staging",
                engine_->setInstanceParams(nodes_[node_index].handle, parameters.data(),
                                           static_cast<std::uint32_t>(parameters.shape(0)),
                                           layout_hash, 0u));
  }

  et_status setGraphInstanceParameters(std::uint32_t node_index, PackedFloat32 parameters,
                                       std::uint32_t layout_hash, std::uint32_t changed_index) {
    requireOpen();
    if (!finished_ || !graph_mode_ || node_index >= nodes_.size() ||
        parameters.shape(0) > std::numeric_limits<std::uint32_t>::max()) {
      throw std::invalid_argument("cannot update this Graph effect");
    }
    return engine_->setGraphInstanceParams(nodes_[node_index].handle, parameters.data(),
                                           static_cast<std::uint32_t>(parameters.shape(0)),
                                           layout_hash, changed_index);
  }

  void setEffectParameterBytes(std::uint32_t node_index, PackedUint8 parameters,
                               std::uint32_t layout_hash) {
    requireOpen();
    if (node_index >= nodes_.size() ||
        parameters.shape(0) > std::numeric_limits<std::uint32_t>::max()) {
      throw std::invalid_argument("cannot update this effect");
    }
    checkStatus("DSP structured parameter staging",
                engine_->setInstanceParamBytes(nodes_[node_index].handle, parameters.data(),
                                               static_cast<std::uint32_t>(parameters.shape(0)),
                                               layout_hash, 0u));
    if (!finished_) {
      nodes_[node_index].parameter_bytes.assign(parameters.data(),
                                                parameters.data() + parameters.shape(0));
      nodes_[node_index].layout_hash = layout_hash;
    }
  }

  void processInPlace(PlanarFloat32 audio) {
    requireOpen();
    if (!finished_ || audio.shape(0) != channels_ || audio.shape(1) == 0u ||
        audio.shape(1) > block_size_) {
      throw std::invalid_argument("invalid native audio block");
    }
    const auto frames = static_cast<std::uint32_t>(audio.shape(1));
    const std::size_t floats = static_cast<std::size_t>(channels_) * frames;
    std::memcpy(engine_->combined(), audio.data(), floats * sizeof(float));
    checkStatus("DSP pipeline processing",
                engine_->processPipeline(
                    channels_, frames, static_cast<double>(processed_frames_) / sample_rate_, 0u));
    std::memcpy(audio.data(), engine_->combined(), floats * sizeof(float));
    processed_frames_ += frames;
  }

  void processGraphInPlace(PlanarFloat32 audio) {
    requireOpen();
    if (!finished_ || !graph_mode_ || audio.shape(0) != channels_ || audio.shape(1) == 0u ||
        audio.shape(1) > block_size_) {
      throw std::invalid_argument("invalid native Graph audio block");
    }
    const auto frames = static_cast<std::uint32_t>(audio.shape(1));
    const std::size_t floats = static_cast<std::size_t>(channels_) * frames;
    std::memcpy(engine_->combined(), audio.data(), floats * sizeof(float));
    checkStatus("DSP Graph processing",
                engine_->processGraph(channels_, frames,
                                      static_cast<double>(processed_frames_) / sample_rate_));
    std::memcpy(audio.data(), engine_->combined(), floats * sizeof(float));
    processed_frames_ += frames;
  }

  void reset() {
    requireOpen();
    if (!finished_) {
      throw std::runtime_error("native chain is not ready");
    }
    checkStatus("DSP reset", graph_mode_ ? engine_->resetGraph() : engine_->reset());
    processed_frames_ = 0u;
  }

  void setTelemetryEnabled(bool enabled) {
    requireOpen();
    checkStatus("DSP telemetry configuration",
                engine_->setTelemetryRate(enabled ? kTelemetryRateHz : 0.0F));
  }

  nb::bytes readTelemetry() {
    requireOpen();
    last_telemetry_dropped_ = 0u;
    const std::uint32_t bytes = engine_->readTelemetry(
        telemetry_buffer_.data(), kTelemetryRingBytes, &last_telemetry_dropped_);
    return nb::bytes(reinterpret_cast<const char *>(telemetry_buffer_.data()), bytes);
  }

  std::uint32_t lastTelemetryDropped() const noexcept { return last_telemetry_dropped_; }

  std::uint64_t latencySamples() const {
    requireOpen();
    if (!finished_) {
      throw std::runtime_error("native chain is not ready");
    }
    std::uint64_t latency = 0u;
    for (const Node &node : nodes_) {
      latency += engine_->instanceLatency(node.handle);
    }
    return latency;
  }

  std::uint32_t graphLatencySamples() const {
    requireOpen();
    if (!finished_ || !graph_mode_) {
      throw std::runtime_error("native Graph is not ready");
    }
    return engine_->graphLatency();
  }

  nb::bytes graphSnapshot() const {
    requireOpen();
    if (!finished_ || !graph_mode_) {
      throw std::runtime_error("native Graph is not ready");
    }
    std::vector<std::uint8_t> bytes(engine_->graphSnapshotSize());
    checkStatus("DSP Graph snapshot",
                engine_->copyGraphSnapshot(bytes.data(), static_cast<std::uint32_t>(bytes.size())));
    return nb::bytes(reinterpret_cast<const char *>(bytes.data()), bytes.size());
  }

  nb::tuple graphDiagnostic() const {
    requireOpen();
    const et_graph_diagnostic &diagnostic = engine_->graphDiagnostic();
    return nb::make_tuple(diagnostic.status, diagnostic.kind, diagnostic.index, diagnostic.path,
                          diagnostic.required, diagnostic.capacity);
  }

  void close() noexcept {
    engine_.reset();
    nodes_.clear();
    asset_nodes_.clear();
    finished_ = false;
    processed_frames_ = 0u;
    last_telemetry_dropped_ = 0u;
    graph_mode_ = false;
  }

private:
  struct Node {
    et_instance handle = 0u;
    std::int8_t channel_spec = -2;
    std::uint32_t seed = 0u;
    std::uint32_t layout_hash = 0u;
    std::vector<float> parameters;
    std::vector<std::uint8_t> parameter_bytes;
  };

  struct AssetNode {
    std::uint32_t node_index;
    std::uint32_t processing_channels;
  };

  void requireOpen() const {
    if (engine_ == nullptr) {
      throw std::runtime_error("native chain is closed");
    }
  }

  void prewarmAssets() {
    const std::uint32_t quantum = std::min(block_size_, 128u);
    for (const AssetNode &asset_node : asset_nodes_) {
      std::vector<float> silence(static_cast<std::size_t>(asset_node.processing_channels) * quantum,
                                 0.0F);
      std::uint32_t calls = 0u;
      while ((engine_->instanceAssetState(nodes_[asset_node.node_index].handle, 0u) & 0xffu) ==
                 ET_ASSET_STATE_PREPARING &&
             calls < 2000u) {
        checkStatus("DSP asset preparation",
                    engine_->processInstance(nodes_[asset_node.node_index].handle, silence.data(),
                                             asset_node.processing_channels, quantum, 0.0));
        ++calls;
      }
      if ((engine_->instanceAssetState(nodes_[asset_node.node_index].handle, 0u) & 0xffu) !=
          ET_ASSET_STATE_ACTIVE) {
        throw std::runtime_error("impulse-response asset did not become active");
      }
    }
  }

  void restoreInitialNodeConfiguration() {
    for (const Node &node : nodes_) {
      checkStatus("DSP seed restoration", engine_->setInstanceSeed(node.handle, node.seed, 0u));
      checkStatus("DSP parameter restoration",
                  engine_->setInstanceParams(node.handle, node.parameters.data(),
                                             static_cast<std::uint32_t>(node.parameters.size()),
                                             node.layout_hash, 0u));
      if (!node.parameter_bytes.empty()) {
        checkStatus(
            "DSP structured parameter restoration",
            engine_->setInstanceParamBytes(node.handle, node.parameter_bytes.data(),
                                           static_cast<std::uint32_t>(node.parameter_bytes.size()),
                                           node.layout_hash, 0u));
      }
    }
  }

  double sample_rate_;
  std::uint32_t channels_;
  std::uint32_t block_size_;
  std::unique_ptr<effetune::Engine> engine_;
  std::vector<Node> nodes_;
  std::vector<AssetNode> asset_nodes_;
  std::vector<std::uint8_t> telemetry_buffer_;
  std::uint64_t processed_frames_ = 0u;
  std::uint32_t last_telemetry_dropped_ = 0u;
  bool finished_ = false;
  bool graph_mode_ = false;
};

} // namespace

NB_MODULE(_native, module) {
  module.doc() = "Private static-link adapter for the EffeTune Python DSP package";
  nb::class_<NativeChain>(module, "_NativeChain")
      .def(nb::init<double, std::uint32_t, std::uint32_t>(), nb::arg("sample_rate"),
           nb::arg("channels"), nb::arg("block_size"))
      .def("add_effect", &NativeChain::addEffect, nb::arg("internal_type"),
           nb::arg("parameters").noconvert(), nb::arg("layout_hash"), nb::arg("seed"),
           nb::arg("channel"))
      .def("set_ir", &NativeChain::setIr, nb::arg("node_index"), nb::arg("samples").noconvert(),
           nb::arg("sample_rate"), nb::arg("topology"), nb::arg("head_block"),
           nb::arg("rate_divider"), nb::arg("paths").noconvert(), nb::arg("input_count"),
           nb::arg("processing_channels"))
      .def("finish", &NativeChain::finish)
      .def("finish_graph", &NativeChain::finishGraph, nb::arg("descriptor").noconvert())
      .def("set_effect_parameters", &NativeChain::setEffectParameters, nb::arg("node_index"),
           nb::arg("parameters").noconvert(), nb::arg("layout_hash"))
      .def("set_graph_instance_parameters", &NativeChain::setGraphInstanceParameters,
           nb::arg("node_index"), nb::arg("parameters").noconvert(), nb::arg("layout_hash"),
           nb::arg("changed_index"))
      .def("set_effect_parameter_bytes", &NativeChain::setEffectParameterBytes,
           nb::arg("node_index"), nb::arg("parameters").noconvert(), nb::arg("layout_hash"))
      .def("process_in_place", &NativeChain::processInPlace, nb::arg("audio").noconvert())
      .def("process_graph_in_place", &NativeChain::processGraphInPlace,
           nb::arg("audio").noconvert())
      .def("set_telemetry_enabled", &NativeChain::setTelemetryEnabled, nb::arg("enabled"))
      .def("read_telemetry", &NativeChain::readTelemetry)
      .def("last_telemetry_dropped", &NativeChain::lastTelemetryDropped)
      .def("reset", &NativeChain::reset)
      .def("latency_samples", &NativeChain::latencySamples)
      .def("graph_latency_samples", &NativeChain::graphLatencySamples)
      .def("graph_snapshot", &NativeChain::graphSnapshot)
      .def("graph_diagnostic", &NativeChain::graphDiagnostic)
      .def("close", &NativeChain::close);
}

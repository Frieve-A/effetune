#include "effetune/kernel.h"
#include "MatrixPluginParams.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace effetune::plugins::basics {
namespace {

constexpr std::uint16_t kTapChannelCount = 9u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kMaximumRoutes = 1024u;

struct Route {
  std::uint8_t input = 0u;
  std::uint8_t output = 0u;
  std::uint8_t phase = 0u;
};

void writeU32(std::uint8_t *output, std::uint32_t value) noexcept {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>((value >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((value >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>(value >> 24u);
}

std::uint16_t readU16(const std::uint8_t *input) noexcept {
  return static_cast<std::uint16_t>(input[0]) |
         static_cast<std::uint16_t>(static_cast<std::uint16_t>(input[1]) << 8u);
}

} // namespace

class MatrixKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MatrixPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    input_.resize(static_cast<std::size_t>(info.maxChannels) * info.maxFrames);
    reset();
  }

  void reset() noexcept override {
    active_routes_[0] = {0u, 0u, 0u};
    active_routes_[1] = {1u, 1u, 0u};
    active_route_count_ = 2u;
    staged_route_count_ = 0u;
    routes_pending_ = false;
    telemetry_channels_ = 0u;
  }

  et_status stageParameterBytes(const std::uint8_t *packed, std::uint32_t byte_count,
                                std::uint32_t params_hash) noexcept override {
    if (params_hash != generated::MatrixPluginParams::kHash)
      return ET_ERR_HASH;
    if (packed == nullptr || byte_count < 4u || packed[0] != 1u || packed[1] != 0u) {
      return ET_ERR_ARGS;
    }
    const std::uint32_t route_count = readU16(packed + 2u);
    if (route_count > kMaximumRoutes || byte_count != 4u + route_count * 3u) {
      return ET_ERR_ARGS;
    }
    for (std::uint32_t route_index = 0u; route_index < route_count; ++route_index) {
      const std::uint8_t *source = packed + 4u + route_index * 3u;
      if (source[0] > 8u || source[1] > 8u || source[2] > 1u)
        return ET_ERR_ARGS;
      staged_routes_[route_index] = {source[0], source[1], source[2]};
    }
    staged_route_count_ = route_count;
    routes_pending_ = true;
    return ET_OK;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    telemetry_channels_ = channel_count;
    if (audio == nullptr || channel_count == 0u || frame_count == 0u)
      return;
    if (routes_pending_) {
      for (std::uint32_t index = 0u; index < staged_route_count_; ++index) {
        active_routes_[index] = staged_routes_[index];
      }
      active_route_count_ = staged_route_count_;
      routes_pending_ = false;
    }

    const std::size_t sample_count = static_cast<std::size_t>(channel_count) * frame_count;
    std::memcpy(input_.data(), audio, sample_count * sizeof(float));
    std::memset(audio, 0, sample_count * sizeof(float));
    for (std::uint32_t route_index = 0u; route_index < active_route_count_; ++route_index) {
      const Route route = active_routes_[route_index];
      if (route.input >= channel_count || route.output >= channel_count)
        continue;
      const float multiplier = route.phase == 0u ? 1.0F : -1.0F;
      const float *source = input_.data() + static_cast<std::size_t>(route.input) * frame_count;
      float *target = audio + static_cast<std::size_t>(route.output) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        target[frame] += source[frame] * multiplier;
      }
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (telemetry_channels_ == 0u)
      return;
    std::array<std::uint8_t, 4> payload{};
    writeU32(payload.data(), telemetry_channels_);
    writer.write(kTapChannelCount, kTelemetryVersion, payload.data(),
                 static_cast<std::uint16_t>(payload.size()));
  }

private:
  std::array<Route, kMaximumRoutes> active_routes_{};
  std::array<Route, kMaximumRoutes> staged_routes_{};
  std::vector<float> input_;
  std::uint32_t active_route_count_ = 0u;
  std::uint32_t staged_route_count_ = 0u;
  std::uint32_t telemetry_channels_ = 0u;
  bool routes_pending_ = false;
};

EFFETUNE_REGISTER_KERNEL(MatrixPlugin, MatrixKernel)

} // namespace effetune::plugins::basics

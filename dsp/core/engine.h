#ifndef EFFETUNE_CORE_ENGINE_H
#define EFFETUNE_CORE_ENGINE_H

#include "arena.h"
#include "effetune/kernel.h"
#include "effetune/telemetry.h"

#include <array>
#include <cstddef>
#include <cstdint>

namespace effetune {

class Engine {
public:
  static constexpr std::uint32_t kMaxInstances = 96;
  static constexpr std::uint32_t kMaxPipelineNodes = 128;
  static constexpr std::uint32_t kKernelStorageBytes = 8192;
  static constexpr std::uint32_t kPipelineDescriptorVersion = 1;

  Engine() = default;
  ~Engine();
  Engine(const Engine &) = delete;
  Engine &operator=(const Engine &) = delete;

  et_status prepare(float sample_rate, std::uint32_t max_channels, std::uint32_t max_frames,
                    std::uint32_t telemetry_ring_bytes) noexcept;
  et_status reset() noexcept;
  et_status setTelemetryRate(float rate_hz) noexcept;

  et_instance createInstance(const char *type_name) noexcept;
  void destroyInstance(et_instance instance) noexcept;
  et_status resetInstance(et_instance instance) noexcept;
  [[nodiscard]] std::uint32_t instanceLatency(et_instance instance) const noexcept;
  et_status setInstanceTap(et_instance instance, std::uint32_t tap_id) noexcept;
  et_status setInstanceSeed(et_instance instance, std::uint32_t seed_low,
                            std::uint32_t seed_high) noexcept;
  et_status setInstanceParams(et_instance instance, const float *packed, std::uint32_t float_count,
                              std::uint32_t params_hash, std::uint32_t offset_frames) noexcept;
  et_status setInstanceParamBytes(et_instance instance, const std::uint8_t *packed,
                                  std::uint32_t byte_count, std::uint32_t params_hash,
                                  std::uint32_t offset_frames) noexcept;
  et_status processInstance(et_instance instance, float *audio, std::uint32_t channel_count,
                            std::uint32_t frame_count, double time_seconds) noexcept;

  et_status configurePipeline(const std::uint8_t *descriptor,
                              std::uint32_t descriptor_bytes) noexcept;
  et_status processPipeline(std::uint32_t channel_count, std::uint32_t frame_count,
                            double time_seconds, std::uint32_t master_bypass) noexcept;

  [[nodiscard]] bool prepared() const noexcept { return prepared_; }
  [[nodiscard]] float *combined() noexcept { return arena_.combined(); }
  [[nodiscard]] float *bus(std::uint32_t index) noexcept { return arena_.bus(index); }
  [[nodiscard]] float *scratch(std::uint32_t index) noexcept { return arena_.scratch(index); }
  [[nodiscard]] char *byteScratch() noexcept { return arena_.byteScratch(); }
  [[nodiscard]] std::uint8_t *telemetryStaging() noexcept { return arena_.telemetryStaging(); }
  [[nodiscard]] std::uint32_t telemetryCapacity() const noexcept {
    return arena_.telemetryCapacity();
  }
  std::uint32_t readTelemetry(std::uint8_t *output, std::uint32_t max_bytes,
                              std::uint32_t *dropped_frames) noexcept {
    return telemetry_.read(output, max_bytes, dropped_frames);
  }

private:
  struct InstanceSlot {
    alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage{};
    const KernelDescriptor *descriptor = nullptr;
    PluginKernel *kernel = nullptr;
    std::uint16_t generation = 1;
    std::uint32_t tapId = 0;
    std::uint32_t telemetrySequence = 0;
    double telemetryFrames = 0.0;
  };

  struct PipelineNode {
    et_instance instance = 0;
    std::uint8_t enabled = 0;
    std::uint8_t inputBus = 0;
    std::uint8_t outputBus = 0;
    std::int8_t channelSpec = -2;
    std::uint8_t sectionGate = 1;
  };

  [[nodiscard]] static et_instance makeHandle(std::uint32_t slot,
                                              std::uint16_t generation) noexcept;
  [[nodiscard]] InstanceSlot *findInstance(et_instance instance) noexcept;
  [[nodiscard]] const InstanceSlot *findInstance(et_instance instance) const noexcept;
  void destroySlot(InstanceSlot &slot) noexcept;
  void destroyAllInstances() noexcept;
  et_status validateProcessArgs(const float *audio, std::uint32_t channel_count,
                                std::uint32_t frame_count, double time_seconds) const noexcept;
  void processSlot(InstanceSlot &slot, float *audio, std::uint32_t channel_count,
                   std::uint32_t frame_count, double time_seconds) noexcept;
  void maybeWriteTelemetry(InstanceSlot &slot, std::uint32_t frame_count) noexcept;

  Arena arena_;
  TelemetryRing telemetry_;
  std::array<InstanceSlot, kMaxInstances> instances_{};
  std::array<PipelineNode, kMaxPipelineNodes> pipeline_{};
  std::uint32_t pipeline_count_ = 0;
  float sample_rate_ = 0.0F;
  float telemetry_rate_hz_ = 60.0F;
  std::uint32_t max_channels_ = 0;
  std::uint32_t max_frames_ = 0;
  bool prepared_ = false;
  bool pipeline_configured_ = false;
};

} // namespace effetune

#endif

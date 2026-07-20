#ifndef EFFETUNE_KERNEL_H
#define EFFETUNE_KERNEL_H

#include "effetune/abi.h"
#include "effetune/telemetry.h"

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <new>

namespace effetune {

struct PrepareInfo {
  float sampleRate;
  std::uint32_t maxChannels;
  std::uint32_t maxFrames;
};

struct ProcessInfo {
  double timeSeconds;
};

struct AssetBeginInfo {
  std::uint32_t channels;
  std::uint32_t frames;
  std::uint32_t topology;
  std::uint32_t headBlock;
  std::uint32_t rateDivider;
  std::uint32_t pathCount;
  std::uint32_t inputCount;
  std::uint32_t processingChannels;
  std::uint32_t footprintBytes;
  std::uint32_t byteSize;
};

class PluginKernel {
public:
  virtual ~PluginKernel() = default;
  virtual void prepare(const PrepareInfo &info) = 0;
  [[nodiscard]] virtual bool preparedSuccessfully() const noexcept { return true; }
  virtual void reset() noexcept = 0;
  virtual void setRandomSeed(std::uint32_t, std::uint32_t) noexcept {}
  virtual void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                       const ProcessInfo &info) noexcept = 0;
  [[nodiscard]] virtual std::uint32_t latencySamples() const noexcept { return 0; }
  virtual void writeTelemetry(TelemetryWriter &) noexcept {}

  [[nodiscard]] virtual std::uint32_t parameterHash() const noexcept = 0;
  [[nodiscard]] virtual std::uint32_t parameterFloatCount() const noexcept = 0;
  virtual et_status stageParameters(const float *packed, std::uint32_t float_count,
                                    std::uint32_t params_hash) noexcept = 0;
  [[nodiscard]] virtual std::uint32_t parameterByteCapacity() const noexcept { return 0u; }
  virtual et_status stageParameterBytes(const std::uint8_t *, std::uint32_t,
                                        std::uint32_t) noexcept {
    return ET_ERR_ARGS;
  }
  [[nodiscard]] virtual std::uint32_t assetCapacity(std::uint32_t) const noexcept { return 0u; }
  virtual std::uint8_t *beginAsset(std::uint32_t, const AssetBeginInfo &) noexcept {
    return nullptr;
  }
  virtual et_status commitAsset(std::uint32_t, std::uint32_t, std::uint32_t) noexcept {
    return ET_ERR_UNSUPPORTED;
  }
  virtual void clearAsset(std::uint32_t) noexcept {}
  [[nodiscard]] virtual std::uint32_t assetState(std::uint32_t) const noexcept {
    return ET_ASSET_STATE_NONE;
  }
  virtual void applyPendingParameters() noexcept = 0;
};

struct KernelDescriptor {
  const char *typeName;
  std::uint32_t paramsHash;
  std::uint32_t paramsFloatCount;
  std::uint32_t paramsByteCapacity;
  std::uint32_t (*assetCapacity)(std::uint32_t slot) noexcept;
  std::uint32_t objectSize;
  std::uint32_t objectAlignment;
  PluginKernel *(*construct)(void *storage) noexcept;
  void (*destroy)(PluginKernel *kernel) noexcept;
};

template <typename KernelType> PluginKernel *constructKernel(void *storage) noexcept {
  return new (storage) KernelType();
}

template <typename KernelType> void destroyKernel(PluginKernel *kernel) noexcept {
  static_cast<KernelType *>(kernel)->~KernelType();
}

template <typename ParamsType> consteval std::uint32_t paramByteCapacity() noexcept {
  if constexpr (requires { ParamsType::kParamBytesCapacity; }) {
    return ParamsType::kParamBytesCapacity;
  }
  return 0u;
}

template <typename KernelType> std::uint32_t kernelAssetCapacity(std::uint32_t slot) noexcept {
  if constexpr (requires { KernelType::assetCapacityForSlot(slot); }) {
    return KernelType::assetCapacityForSlot(slot);
  } else {
    return 0u;
  }
}

#define EFFETUNE_PARAMS(ParamsType)                                                                \
private:                                                                                           \
  ParamsType params_{};                                                                            \
  ParamsType staged_params_{};                                                                     \
  bool params_pending_ = false;                                                                    \
  bool params_dirty_ = false;                                                                      \
                                                                                                   \
public:                                                                                            \
  using Params = ParamsType;                                                                       \
  [[nodiscard]] std::uint32_t parameterHash() const noexcept final { return ParamsType::kHash; }   \
  [[nodiscard]] std::uint32_t parameterFloatCount() const noexcept final {                         \
    return ParamsType::kFloatCount;                                                                \
  }                                                                                                \
  [[nodiscard]] std::uint32_t parameterByteCapacity() const noexcept final {                       \
    return ::effetune::paramByteCapacity<ParamsType>();                                            \
  }                                                                                                \
  et_status stageParameters(const float *packed, std::uint32_t float_count,                        \
                            std::uint32_t params_hash) noexcept final {                            \
    if (params_hash != ParamsType::kHash) {                                                        \
      return ET_ERR_HASH;                                                                          \
    }                                                                                              \
    if (float_count != ParamsType::kFloatCount || (float_count != 0u && packed == nullptr) ||      \
        (float_count != 0u && sizeof(ParamsType) != sizeof(float) * ParamsType::kFloatCount)) {    \
      return ET_ERR_ARGS;                                                                          \
    }                                                                                              \
    if (float_count != 0u) {                                                                       \
      std::memcpy(&staged_params_, packed, sizeof(ParamsType));                                    \
    }                                                                                              \
    params_pending_ = true;                                                                        \
    return ET_OK;                                                                                  \
  }                                                                                                \
  void applyPendingParameters() noexcept final {                                                   \
    params_dirty_ = params_pending_;                                                               \
    if (params_pending_) {                                                                         \
      params_ = staged_params_;                                                                    \
      params_pending_ = false;                                                                     \
    }                                                                                              \
  }                                                                                                \
                                                                                                   \
protected:                                                                                         \
  [[nodiscard]] bool paramsDirty() const noexcept { return params_dirty_; }

#define EFFETUNE_REGISTER_KERNEL(Name, KernelType)                                                 \
  extern "C" const ::effetune::KernelDescriptor *et_kernel_descriptor_##Name() noexcept {          \
    static constexpr ::effetune::KernelDescriptor descriptor = {                                   \
        #Name,                                                                                     \
        KernelType::Params::kHash,                                                                 \
        KernelType::Params::kFloatCount,                                                           \
        ::effetune::paramByteCapacity<typename KernelType::Params>(),                              \
        &::effetune::kernelAssetCapacity<KernelType>,                                              \
        static_cast<std::uint32_t>(sizeof(KernelType)),                                            \
        static_cast<std::uint32_t>(alignof(KernelType)),                                           \
        &::effetune::constructKernel<KernelType>,                                                  \
        &::effetune::destroyKernel<KernelType>};                                                   \
    return &descriptor;                                                                            \
  }

} // namespace effetune

#endif

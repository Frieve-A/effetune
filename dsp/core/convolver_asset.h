#ifndef EFFETUNE_CORE_CONVOLVER_ASSET_H
#define EFFETUNE_CORE_CONVOLVER_ASSET_H

#include "effetune/dsp/partitioned_convolver.h"
#include "effetune/kernel.h"
#include "nothrow_storage.h"
#include <cstring>
#include <limits>

namespace effetune::dsp {
// The convolver keeps pointers into the coefficients while preparing its FFT partitions.
struct ConvolverAssetStorage {
  PartitionedConvolver convolver;
  NothrowStorage<float> payload;

  void swap(ConvolverAssetStorage &other) noexcept {
    convolver.swap(other.convolver);
    payload.swap(other.payload);
  }

  static bool admitted(std::uint32_t footprint) noexcept {
    const auto bytes = static_cast<std::uint64_t>(footprint) + 1024u * 1024u;
    NothrowStorage<std::uint8_t> probe;
    return bytes <= std::numeric_limits<std::size_t>::max() &&
           probe.allocate(static_cast<std::size_t>(bytes));
  }

  bool reserve(const ConvolverConfig &config, const AssetBeginInfo &info) noexcept {
    return payload.allocate(info.byteSize / sizeof(float)) && convolver.reserve(config) &&
           convolver.memoryBytes() + info.byteSize <= info.footprintBytes;
  }
};

struct PreparedConvolverAsset : PreparedAsset {
  ConvolverAssetStorage storage;
  AssetBeginInfo info{};
  std::uint32_t sliceOffset{};
  std::uint32_t error{};

  [[nodiscard]] bool hasPreparationError() const noexcept override { return error != 0; }

  template <typename Commit>
  void build(const ConvolverConfig &config, const std::uint8_t *payload, float rate,
             std::uint32_t format, Commit commit, bool keepInvalidPayload = false) noexcept {
    if (!storage.reserve(config, info)) {
      error = 2;
    } else {
      std::memcpy(storage.payload.data(), payload, info.byteSize);
      error = commit(storage, info, rate, format);
    }
    if (error && (!keepInvalidPayload || error == 2)) {
      storage.convolver.clear();
      storage.payload.release();
    } else if (error) {
      storage.payload.clear();
    }
  }

  template <typename Asset = PreparedConvolverAsset, typename Build>
  static et_status prepare(const PrepareInfo &context, const AssetBeginInfo &info,
                           const std::uint8_t *payload, std::unique_ptr<PreparedAsset> &out,
                           Build build) noexcept {
    auto next = std::unique_ptr<Asset>(new (std::nothrow) Asset);
    if (!next)
      return ET_ERR_OOM;
    next->info = info;
    next->sliceOffset = context.sliceOffset;
    if (payload) {
      const auto status = build(*next);
      if (status != ET_OK)
        return status;
    }
    out = std::move(next);
    return ET_OK;
  }
};
} // namespace effetune::dsp
#endif

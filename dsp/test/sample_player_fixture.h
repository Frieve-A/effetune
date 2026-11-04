#ifndef EFFETUNE_SAMPLE_PLAYER_FIXTURE_H
#define EFFETUNE_SAMPLE_PLAYER_FIXTURE_H

#include "effetune/kernel.h"

#include <span>

namespace effetune::test {
// The native query owns every reservation beyond the compiled payload bytes.
// Producer footprint estimates must not be added a second time.
inline et_status
addSamplePlayerFixtureStorage(AssetBeginInfo &info, std::span<const std::uint8_t> payload,
                              const PrepareInfo &preparation,
                              std::uint32_t playerKind = ET_SAMPLE_PLAYER_NOTE) noexcept {
  std::uint64_t additional = 0;
  const auto status = et_sample_player_preparation_bytes(
      payload.data(), static_cast<std::uint32_t>(payload.size()), info.byteSize,
      ET_ASSET_F32_MULTICH, preparation.sampleRate, info.processingChannels, preparation.maxFrames,
      preparation.minimumPhysicalBpm, &additional, playerKind);
  if (status != ET_OK)
    return status;
  if (additional > UINT32_MAX - info.byteSize)
    return ET_ERR_OOM;
  info.footprintBytes = info.byteSize + static_cast<std::uint32_t>(additional);
  return ET_OK;
}
} // namespace effetune::test

#endif

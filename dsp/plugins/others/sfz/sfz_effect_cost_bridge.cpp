#include "bank.h"
#include "sfz_processing_cost.h"

namespace effetune::plugins::others::sfz {
et_status processingPreparationBytes(std::span<const std::uint8_t> control,
                                     std::uint32_t payloadBytes, std::uint32_t formatTag,
                                     const PrepareInfo &preparation, std::uint32_t actualChannels,
                                     std::uint64_t &bytes, std::uint32_t voices) noexcept {
  bytes = 0;
  if (payloadBytes < 32 || payloadBytes % 4)
    return ET_ERR_ARGS;
  const AssetBeginInfo info{
      1, (payloadBytes - 32) / 4, 0, 0, 1, 0, 0, actualChannels, payloadBytes, payloadBytes};
  return SFZBank::estimateProcessing(preparation, info, control, formatTag, bytes, voices);
}
} // namespace effetune::plugins::others::sfz

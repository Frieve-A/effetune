#ifndef EFFETUNE_SFZ_PROCESSING_COST_H
#define EFFETUNE_SFZ_PROCESSING_COST_H
#include "effetune/kernel.h"
#include <span>

namespace effetune::plugins::others::sfz {
// CONTROL only. The prefix ends at the compiled bank's PCM pool offset; a
// streamed bank has no inline PCM, so its complete payload is metadata. The
// declared payload size supplies resident sample extent without reading PCM.
// Returns all per-bank native-owned storage beyond the supplied compiled asset
// extent: indices, typed state, cache and CONTROL forecast scratch, optional
// script state and COMB/bus-FX/SF2-send preparation. Required admission is exactly
// payloadBytes + bytes. The external streamed library extent is not payloadBytes.
// Fixed instance preparation, allocator metadata and process RSS are separate.
// Allocation and query share the same target-native storage geometry.
et_status processingPreparationBytes(std::span<const std::uint8_t> control,
                                     std::uint32_t payloadBytes, std::uint32_t formatTag,
                                     const PrepareInfo &preparation, std::uint32_t actualChannels,
                                     std::uint64_t &bytes, std::uint32_t voices = 128u) noexcept;
} // namespace effetune::plugins::others::sfz
#endif

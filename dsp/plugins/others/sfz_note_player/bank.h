#ifndef EFFETUNE_SFZ_BANK_H
#define EFFETUNE_SFZ_BANK_H
#include <bit>
#include <cstdint>
namespace effetune::plugins::others::sfz {
inline constexpr std::uint32_t kCapacity = 1024u * 1024u * 1024u;
inline constexpr std::uint32_t kHeader = 8u, kStride = 30u, kMagic = 0x53465au;
inline constexpr std::uint32_t kVersion = 2u;
// The header and six sample indices are uint32 bit lanes; other fields and PCM are floats.
// Sample offsets count floats from the pool; playback and loop ends are inclusive frames.
enum Field : std::uint32_t {
  Sample,
  Frames,
  Channels,
  Rate,
  LowKey,
  HighKey,
  LowVelocity,
  HighVelocity,
  LowRandom,
  HighRandom,
  SequenceLength,
  SequencePosition,
  SequenceGroup,
  KeyCenter,
  KeyTrack,
  Transpose,
  Tune,
  Volume,
  Pan,
  VelocityTrack,
  Offset,
  End,
  LoopMode,
  LoopStart,
  LoopEnd,
  Attack,
  Hold,
  Decay,
  Sustain,
  Release
};
inline constexpr bool isIndexField(std::uint32_t field) noexcept {
  return field == Sample || field == Frames || field == Offset || field == End ||
         field == LoopStart || field == LoopEnd;
}
inline std::uint32_t indexValue(const float *region, Field field) noexcept {
  return std::bit_cast<std::uint32_t>(region[field]);
}
} // namespace effetune::plugins::others::sfz
#endif

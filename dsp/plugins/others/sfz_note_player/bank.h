#ifndef EFFETUNE_SFZ_BANK_H
#define EFFETUNE_SFZ_BANK_H
#include <bit>
#include <cstdint>
namespace effetune::plugins::others::sfz {
inline constexpr std::uint32_t kCapacity = 1024u * 1024u * 1024u;
inline constexpr std::uint32_t kHeader = 12u, kStride = 113u, kMagic = 0x53465au;
inline constexpr std::uint32_t kVersion = 6u;
inline constexpr std::uint32_t kModulationVersion = 7u, kStreamVersion = 8u, kStreamHeader = 16u;
inline constexpr std::uint32_t kSf2Version = 9u, kSf2Header = 18u;
// Enable only together with the native SF2 generator/modulator evaluator.
inline constexpr bool kSf2RenderingSupported = true;
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
  Release,
  Trigger,
  LowChannel,
  HighChannel,
  LowBend,
  HighBend,
  LowChannelAftertouch,
  HighChannelAftertouch,
  LowPolyAftertouch,
  HighPolyAftertouch,
  LowProgram,
  HighProgram,
  SwitchLow,
  SwitchHigh,
  SwitchLast,
  SwitchLowLast,
  SwitchHighLast,
  SwitchDown,
  SwitchUp,
  SwitchPrevious,
  SwitchDefault,
  Group,
  OffBy,
  OffMode,
  OffTime,
  Polyphony,
  NotePolyphony,
  BendUp,
  BendDown,
  Cutoff,
  Resonance,
  FilterType,
  AmpDelay,
  AmpStart,
  AmpKeyTrack,
  AmpKeyCenter,
  AmpRandom,
  PitchVelocityTrack,
  PitchRandom,
  Delay,
  DelayRandom,
  PitchEGDelay,
  PitchEGStart,
  PitchEGAttack,
  PitchEGHold,
  PitchEGDecay,
  PitchEGSustain,
  PitchEGRelease,
  PitchEGDepth,
  FilterEGDelay,
  FilterEGStart,
  FilterEGAttack,
  FilterEGHold,
  FilterEGDecay,
  FilterEGSustain,
  FilterEGRelease,
  FilterEGDepth,
  AmpLFODelay,
  AmpLFOFade,
  AmpLFOFrequency,
  AmpLFODepth,
  PitchLFODelay,
  PitchLFOFade,
  PitchLFOFrequency,
  PitchLFODepth,
  FilterLFODelay,
  FilterLFOFade,
  FilterLFOFrequency,
  FilterLFODepth,
  Direction,
  LoopCount,
  LoopCrossfade,
  AmpDynamic,
  EQ1Frequency,
  EQ1Bandwidth,
  EQ1Gain,
  EQ2Frequency,
  EQ2Bandwidth,
  EQ2Gain,
  EQ3Frequency,
  EQ3Bandwidth,
  EQ3Gain,
  ControlOffset,
  ControlCount
};
enum ControllerFamily : std::uint32_t {
  LowCC,
  HighCC,
  InitialCC,
  VolumeCC,
  PanCC,
  TuneCC,
  CutoffCC,
  ResonanceCC,
  OnLowCC,
  OnHighCC,
  AmpDelayCC,
  AmpStartCC,
  AmpAttackCC,
  AmpHoldCC,
  AmpDecayCC,
  AmpSustainCC,
  AmpReleaseCC,
  EQ1FrequencyCC,
  EQ1BandwidthCC,
  EQ1GainCC,
  EQ2FrequencyCC,
  EQ2BandwidthCC,
  EQ2GainCC,
  EQ3FrequencyCC,
  EQ3BandwidthCC,
  EQ3GainCC,
  ControllerFamilyCount
};
inline constexpr float controllerDefault(std::uint32_t family) noexcept {
  return family == HighCC                                                 ? 127.0F
         : family == InitialCC || family == OnLowCC || family == OnHighCC ? -1.0F
                                                                          : 0.0F;
}

inline constexpr bool isIndexField(std::uint32_t field) noexcept {
  return field == Sample || field == Frames || field == Offset || field == End ||
         field == LoopStart || field == LoopEnd || field == ControlOffset || field == ControlCount;
}
inline std::uint32_t indexValue(const float *region, Field field) noexcept {
  return std::bit_cast<std::uint32_t>(region[field]);
}
} // namespace effetune::plugins::others::sfz
#endif

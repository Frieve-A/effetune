// MD Simulator (ATRAC3 LP2 / LP4) constant tables.
//
// Provenance policy (implementation plan section 2), identical to tables.h:
//   EffeTune is MIT licensed.  atracdenc and the FFmpeg atrac3 decoder are LGPL,
//   so no code and no coefficient array is copied from them.  Every table below
//   is derived from a closed-form expression or from a documented construction
//   rule that is reproduced in the comment above it, so the table can be
//   regenerated from scratch and is checked against its own derivation by the
//   core self test.
//
//   Supervisor decision S-20 accepted that this plugin cannot interoperate with a
//   real ATRAC bitstream, because the ATRAC1 BFU boundary and amount tables were
//   already self derived.  The same reasoning applies here, so the normative
//   ATRAC3 spectral Huffman tables and the normative MDCT window are not
//   transcribed either: they would carry LGPL exposure without buying anything
//   that is still reachable.  What the plan needs from them - a *variable length*
//   spectral cost that feeds back into the allocation decision, and a
//   Princen-Bradley window - is provided by the closed-form Rice code and the
//   sine window documented below.
//
#ifndef EFFETUNE_MD_SIMULATOR_ATRAC3_TABLES_H
#define EFFETUNE_MD_SIMULATOR_ATRAC3_TABLES_H

#include "tables.h"

#include <array>
#include <cstddef>
#include <cstdint>

namespace effetune::md_simulator::atrac3 {

// ---------------------------------------------------------------------------
// Frame geometry (ATRAC3, MDLP)
// ---------------------------------------------------------------------------
// One frame is 1024 PCM samples per channel at the codec native 44.1 kHz
// (23.2 ms).  Bit budget (plan section 3.2): LP2 carries 192 bytes per channel
// per frame, LP4 carries 192 bytes for the whole stereo pair.
inline constexpr std::size_t kFrameSamples = 1024u;
inline constexpr std::size_t kSpectrumSize = kFrameSamples;
inline constexpr std::size_t kLp2FrameBytes = 192u;
inline constexpr std::size_t kLp4PairFrameBytes = 192u;
inline constexpr std::size_t kLp2FrameBits = kLp2FrameBytes * 8u;         // 1536
inline constexpr std::size_t kLp4PairFrameBits = kLp4PairFrameBytes * 8u; // 1536

// ---------------------------------------------------------------------------
// QMF band layout
// ---------------------------------------------------------------------------
// A full two level QMF tree, i.e. four uniform bands of 5.5125 kHz each, unlike
// the asymmetric three band tree of ATRAC1.  Each band carries 256 samples per
// frame.
//
// Band ordering.  Decimating the upper output of a half band split mirrors the
// frequency axis, so a subband is spectrally reversed exactly when it took an
// odd number of "upper" branches.  Sorted by real frequency the four leaves are
//     band 0 = lower  -> lower   0 flips    0      - 5.5125 kHz
//     band 1 = lower  -> upper   1 flip     5.5125 - 11.025 kHz
//     band 2 = upper  -> upper   2 flips   11.025  - 16.5375 kHz
//     band 3 = upper  -> lower   1 flip    16.5375 - 22.05 kHz
// so the reversal flag alternates and the second stage of the upper branch has
// its two outputs swapped relative to the lower branch.  Unlike ATRAC1 every
// band traverses both stages, so no band needs a compensating delay line.
inline constexpr std::size_t kBandCount = 4u;
inline constexpr std::size_t kBandSamples = 256u; // per band, per frame
inline constexpr std::array<bool, kBandCount> kBandReversed = {false, true, false, true};

// ---------------------------------------------------------------------------
// MDCT
// ---------------------------------------------------------------------------
// One 256 coefficient MDCT per band per frame, fed with 512 windowed samples
// (previous band region followed by the current one).  ATRAC3 has no block
// switching; gain control replaces it, which is the structural difference to
// ATRAC1 (plan section 3.2 step 3).
inline constexpr std::size_t kBlockSize = kBandSamples; // 256 coefficients
inline constexpr std::size_t kWindowSize = 2u * kBlockSize;

// Window: the standard sine window w[n] = sin(pi/(2B) * (n + 0.5)), n in [0,2B).
// It is symmetric, w[2B-1-n] = w[n], and satisfies the Princen-Bradley condition
// w[n]^2 + w[n+B]^2 = sin^2 + cos^2 = 1, which is what TDAC needs.  It is
// computed at prepare() time from the formula rather than tabulated here,
// because 512 doubles of table would say less than the one line of arithmetic.

// ---------------------------------------------------------------------------
// Quantization units
// ---------------------------------------------------------------------------
// 32 quantization units (QUs) tile the 1024 spectral coefficients.  Each QU
// carries one scale factor and one word length, so a QU may never straddle a
// band boundary (the two sides would need different reversal handling).
//
// Derivation rule (self created).  QUs are handed to the bands in proportion to
// their Bark width - band 0 spans about 19 of the 24.7 Bark of the spectrum, the
// remaining three bands about 3.7 / 1.3 / 0.6 - and then clamped so that no unit
// is wider than about 1 kHz (48 bins at 21.53 Hz per bin), because a scale
// factor shared by more than that stops tracking the spectrum at all.  The clamp
// is what stops the top three bands from collapsing into two units each, and it
// is why the widths restart at each band boundary instead of growing monotonically
// across the whole spectrum: they grow monotonically *within* a band, and the per
// band unit count is fixed.  Resulting split: 14 / 6 / 6 / 6 units.
//
// The self test asserts all four invariants directly: 32 units, each band summing
// to exactly 256 bins, widths non decreasing inside a band, and every width in
// [4, 48].
inline constexpr std::size_t kQuCount = 32u;
inline constexpr std::array<std::uint16_t, kBandCount + 1u> kBandQuStart = {0u, 14u, 20u, 26u, 32u};

inline constexpr std::array<std::uint16_t, kQuCount> kQuWidth = {
    4,  4,  6,  8,  10, 12, 14, 16, 20, 24, 28, 32, 36, 42, 36, 40,
    42, 44, 46, 48, 40, 42, 42, 44, 44, 44, 40, 42, 42, 44, 44, 44};

inline constexpr std::array<std::uint16_t, kQuCount + 1u> kQuOffset = {
    0,   4,   8,   14,  22,  32,  44,  58,  74,  94,  118, 146, 178, 214, 256, 292, 332,
    374, 418, 464, 512, 552, 594, 636, 680, 724, 768, 808, 850, 892, 936, 980, 1024};

// Coded bandwidth per mode, expressed as the largest number of QUs the encoder is
// allowed to activate.  This is the one deliberately "encoder discretion" knob
// that shapes the mode character: 26 units end exactly on the band 2 boundary at
// 16.54 kHz, which is where real LP2 material rolls off, and 22 units end at
// 12.79 kHz, close to the LP4 roll off.  Everything above simply is not coded,
// which is where the "thin, wobbling highs" of LP4 comes from.
inline constexpr std::uint16_t kLp2MaxActiveUnits = 26u;
inline constexpr std::uint16_t kLp4MaxActiveUnits = 22u;
inline constexpr std::uint16_t kMinActiveUnits = 8u;

// ---------------------------------------------------------------------------
// Gain control
// ---------------------------------------------------------------------------
// Per band, per frame, the 256 sample region carries a piecewise gain envelope.
// The encoder divides the band signal by it before the MDCT and the decoder
// multiplies the overlap added result by the same envelope, so quantization noise
// - flat across the MDCT frame - is re-shaped to follow the envelope.  Attenuating
// the loud part of a transient therefore pushes the noise under the transient and
// keeps it out of the quiet run up, which is the ATRAC3 answer to pre-echo, and
// the coarseness of the 8 sub-block grid is where the characteristic pumping
// comes from (plan section 3.2 step 2).
//
// The envelope is transmitted as up to two change points.  A point is a
// (location, level) pair: location is the sub-block the change lands on and level
// is the base 2 exponent of the new gain.  Between points the gain is constant at
// 2^level; across a point it moves along a straight line in the log domain over
// kGainRampSamples samples, so the encoder and the decoder both evaluate
// exp2(interpolated exponent) and the round trip is exact to one ulp.  The level
// in force at the end of a frame carries into the next one, which is why a frame
// that has no transient still emits a point (location 0, level 0) to release.
inline constexpr std::size_t kGainSubBlocks = 8u;
inline constexpr std::size_t kGainSubBlockSamples = kBandSamples / kGainSubBlocks; // 32
inline constexpr std::size_t kGainRampSamples = 16u;
inline constexpr std::size_t kMaxGainPoints = 2u;
inline constexpr int kMaxGainLevel = 7;

// ---------------------------------------------------------------------------
// Side information field widths
// ---------------------------------------------------------------------------
// Only the widths matter here: no byte packing happens on the production path
// (plan section 6.1), but every field that costs bits has to be charged against
// the frame budget because that is what the allocator trades against.
inline constexpr std::size_t kToneCountBits = 5u;   // always transmitted as 0
inline constexpr std::size_t kActiveUnitBits = 5u;  // transmits activeUnits - 1
inline constexpr std::size_t kWordLengthBits = 3u;  // word length index 0..7
inline constexpr std::size_t kScaleFactorBits = 6u; // only when word length > 0
inline constexpr std::size_t kGainCountBits = 2u;   // points in this band, 0..2
inline constexpr std::size_t kGainPointBits = 6u;   // 3 location + 3 level
inline constexpr std::size_t kJointModeBits = 2u;   // LP4 only, once per frame
inline constexpr int kMaxWordLengthIndex = 7;

// ---------------------------------------------------------------------------
// Spectral variable length code
// ---------------------------------------------------------------------------
// Word length index w in 1..7 selects a quantizer whose magnitudes span
// [0, 2^w - 1]; w = 0 means the unit is not coded.  The quantized values are then
// entropy coded, which is a real property of ATRAC3 (unlike ATRAC1, whose
// spectral field is plain PCM) and the reason the budget has to be computed from
// the data rather than from the word lengths alone.
//
// Code: a Rice code on the magnitude with parameter k(w), plus one sign bit for
// non zero values.  Length(m) = (m >> k) + 1 + k + (m != 0).  A Rice code is the
// optimal prefix code for a two sided geometric source, which is the standard
// model for MDCT coefficients normalised by their own scale factor, so this is
// the closed-form stand-in for the normative Huffman books.  k is chosen as w - 3
// so the quotient stays in [0, 7] for every representable magnitude: the code is
// therefore bounded without an escape, the worst case is w + 6 bits (13 bits at
// w = 7: quotient 7 costs a 7-one/1-zero unary field of 8 bits, plus the k = 4
// remainder bits, plus 1 sign bit) and the expected length sits slightly below
// the w + 1 bits a PCM field would need, while zeros - the overwhelming
// majority at LP4 rates - cost a single bit.
[[nodiscard]] inline constexpr int riceParameter(int wordLengthIndex) noexcept {
  return wordLengthIndex >= 3 ? wordLengthIndex - 3 : 0;
}

[[nodiscard]] inline constexpr std::size_t riceLength(std::int32_t value, int k) noexcept {
  const std::uint32_t magnitude =
      value < 0 ? static_cast<std::uint32_t>(-static_cast<std::int64_t>(value))
                : static_cast<std::uint32_t>(value);
  std::size_t length = static_cast<std::size_t>(magnitude >> k) + 1u + static_cast<std::size_t>(k);
  if (magnitude != 0u) {
    ++length; // sign
  }
  return length;
}

// ---------------------------------------------------------------------------
// Quantizer scaling
// ---------------------------------------------------------------------------
// The scale factor table is shared with ATRAC1 (kScaleFactor in tables.h, the
// 2^((i-15)/3) law).  kSpectrumScale is likewise shared: the MDCT is unnormalised
// so a bin centred full scale tone lands near 128 in a 256 coefficient band, and
// the 2^8 scaling puts that at scale factor index 60, leaving 6 dB of headroom
// before the table saturates.  Gain control only ever divides the band signal, so
// it moves coefficients away from the ceiling, never towards it.

// ---------------------------------------------------------------------------
// Allocation profile (encoder discretion, plan section 3.2 step 5)
// ---------------------------------------------------------------------------
// Same two component law as ATRAC1: btot = T * bvar + (1 - T) * bfix with T the
// tonality (one minus spectral flatness).  bfix ramps down with frequency; the
// top is one bit lower than the ATRAC1 profile because the LP budget per
// coefficient is roughly a third of SP.
inline constexpr double kFixedProfileTop = 5.0;
inline constexpr double kFixedProfileSlope = 5.0;
inline constexpr double kEnergyFloor = 1.0e-30;
// A QU counts as occupied when its peak is within 80 dB of the frame peak.
inline constexpr double kQuActivityFloor = 1.0e-4;
// Bounded bisection for the allocation offset.  The low end of the bracket always
// forces every word length to zero, which always fits, so the search cannot fail.
inline constexpr double kAllocSearchSpan = 128.0;
inline constexpr std::size_t kAllocSearchIterations = 24u;

// Transient detector driving gain control.  Deliberately coarse, in the same
// spirit as the ATRAC1 block switch detector: a sub-block has to beat the decayed
// running peak by 12 dB before the envelope moves, so gentle attacks get no gain
// control at all and pre-echo through, exactly as real hardware does.
inline constexpr double kGainAttackRatio = 4.0;
inline constexpr double kGainFloor = 1.0e-5;
inline constexpr double kGainDecay = 0.75;

// Release slack, in gain levels.  A gain that has been raised has to be able to
// come back down again, but the MDCT block a region is coded in also covers the
// whole neighbouring region, so a level that drops while the neighbour is still
// held high breaks the amplification bound by exactly the size of the step.
// Allowing one level of slack on the way down bounds the amplified coding noise
// at twice the local peak during a release and lets the envelope walk back to
// unity one level per region; without it a level that is raised once can never
// be released on steady material and the band stays permanently attenuated.
inline constexpr int kGainReleaseSlack = 1;

} // namespace effetune::md_simulator::atrac3

#endif

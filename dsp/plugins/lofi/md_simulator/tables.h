// MD Simulator (ATRAC1 SP) constant tables.
//
// Provenance policy (implementation plan section 2):
//   EffeTune is MIT licensed.  atracdenc and the FFmpeg atrac1/atrac3 decoders are
//   LGPL, so no code or coefficient array is copied from them.  Every table below
//   is derived from a closed-form expression or from a documented construction
//   rule that is reproduced in the comment above it, so that the table can be
//   regenerated from scratch and is verified against its own derivation formula by
//   native_test.cpp (verification plan section 7.2 oracle 5).
//
#ifndef EFFETUNE_MD_SIMULATOR_TABLES_H
#define EFFETUNE_MD_SIMULATOR_TABLES_H

#include <array>
#include <cstddef>
#include <cstdint>

namespace effetune::md_simulator {

// ---------------------------------------------------------------------------
// Sound unit geometry (ATRAC1 SP, MiniDisc)
// ---------------------------------------------------------------------------
// One sound unit is 512 PCM samples per channel at the codec-native 44.1 kHz,
// carried in 212 bytes = 1696 bits per channel.  Channels are coded
// independently (ATRAC1 has no joint stereo).
inline constexpr std::uint32_t kCodecSampleRate = 44100u;
inline constexpr std::size_t kSoundUnitSamples = 512u;
inline constexpr std::size_t kSoundUnitBytes = 212u;
inline constexpr std::size_t kSoundUnitBits = kSoundUnitBytes * 8u; // 1696

// Fixed side-information overhead, in bits, per sound unit:
//   block size mode      : 2 bits x 3 bands + 2 dummy bits =  8
//   BFU amount index     : 3 bits + 5 reserved bits        =  8
//   trailing reserved    :                                   24
//                                                          ----
//                                                            40
inline constexpr std::size_t kFixedOverheadBits = 40u;
// Per active BFU: 4-bit IDWL field + 6-bit scale factor index.
inline constexpr std::size_t kSideInfoBitsPerBfu = 10u;

// ---------------------------------------------------------------------------
// QMF band layout
// ---------------------------------------------------------------------------
// Two-stage QMF tree.  Stage 1 splits 0-22.05 kHz into 0-11.025 / 11.025-22.05.
// Stage 2 splits the lower half again into 0-5.5125 / 5.5125-11.025.
// Per sound unit the bands therefore carry 128 / 128 / 256 samples.
inline constexpr std::size_t kBandCount = 3u;
inline constexpr std::array<std::size_t, kBandCount> kBandSamples = {128u, 128u, 256u};
inline constexpr std::array<std::size_t, kBandCount> kBandBase = {0u, 128u, 256u};
// Number of short blocks a band is split into when the transient detector selects
// the short block mode.  Long mode always uses a single block per band.
inline constexpr std::array<std::size_t, kBandCount> kShortBlocks = {4u, 4u, 8u};
inline constexpr std::size_t kShortBlockSize = 32u;
// Fixed sine overlap length shared by long and short blocks.  Because both window
// shapes place their 32-sample ramps on the same block boundaries, long and short
// blocks can be interleaved with no start/stop window redesign.
inline constexpr std::size_t kOverlapSamples = 32u;

// ---------------------------------------------------------------------------
// Block Floating Unit (BFU) partition
// ---------------------------------------------------------------------------
// 52 BFUs: 20 in the low band, 16 in the mid band, 16 in the high band.
//
// Derivation rule (self-created, plan section 3.1 step 3).  Each band is tiled by
// "width groups".  A band with nsub short sub-blocks has sub-block length
// sub = bins / nsub, and the group widths tile sub exactly:
//     low  band: sub = 32 = 8 + 4 + 8 + 6 + 6  -> groups (r=1,w=8) (1,4) (1,8) (2,6)
//     mid  band: sub = 32 = 6 + 8 + 8 + 10     -> groups (1,6) (1,8) (1,8) (1,10)
//     high band: sub = 32 = 12 + 20            -> groups (1,12) (1,20)
// Group g owns nsub * r_g BFUs, all of width w_g, occupying the intra-sub-block
// offset window [o_g, o_g + r_g*w_g) of every sub-block, where o_g is the sum of
// r*w over the preceding groups.
//   * In long mode the group's BFUs are laid out contiguously in the band's
//     spectrum. Width grows monotonically with frequency in the mid band
//     (6,8,8,10) and the high band (12,20), a coarse approximation of critical
//     band widening; the low band is not monotone, since its four groups run
//     8,4,8,6 (see the derivation above), so callers that assume a single
//     monotone ramp across all 512 spectral positions are wrong for the low
//     band specifically.
//   * In short mode BFU index (groupBase + s*r_g + j) covers offset o_g + j*w_g
//     inside sub-block s, so a BFU always describes the same frequency slice no
//     matter which sub-block it belongs to.
// Both layouts tile all 512 spectral positions exactly once; native_test.cpp
// re-derives them from this rule and asserts equality.
inline constexpr std::size_t kBfuCount = 52u;
// First BFU index of each band, plus the end sentinel.
inline constexpr std::array<std::uint16_t, kBandCount + 1u> kBandBfuStart = {0u, 20u, 36u, 52u};

inline constexpr std::array<std::uint16_t, kBfuCount> kSpecsPerBfu = {
    8,  8,  8,  8,  4,  4,  4,  4,  8,  8,  8,  8,  6,  6,  6,  6,  6,  6,
    6,  6,  6,  6,  6,  6,  8,  8,  8,  8,  8,  8,  8,  8,  10, 10, 10, 10,
    12, 12, 12, 12, 12, 12, 12, 12, 20, 20, 20, 20, 20, 20, 20, 20};

inline constexpr std::array<std::uint16_t, kBfuCount> kBfuStartLong = {
    0,   8,   16,  24,  32,  36,  40,  44,  48,  56,  64,  72,  80,  86,  92,  98,  104, 110,
    116, 122, 128, 134, 140, 146, 152, 160, 168, 176, 184, 192, 200, 208, 216, 226, 236, 246,
    256, 268, 280, 292, 304, 316, 328, 340, 352, 372, 392, 412, 432, 452, 472, 492};

inline constexpr std::array<std::uint16_t, kBfuCount> kBfuStartShort = {
    0,   32,  64,  96,  8,   40,  72,  104, 12,  44,  76,  108, 20,  26,  52,  58,  84,  90,
    116, 122, 128, 160, 192, 224, 134, 166, 198, 230, 142, 174, 206, 238, 150, 182, 214, 246,
    256, 288, 320, 352, 384, 416, 448, 480, 268, 300, 332, 364, 396, 428, 460, 492};

// The active BFU count is transmitted as a 3-bit index into this table.  Entries
// 20 / 36 / 52 coincide with the band boundaries so the encoder can drop whole
// bands, and the intermediate steps let the high band be truncated progressively.
inline constexpr std::array<std::uint16_t, 8u> kBfuAmountTable = {20u, 28u, 32u, 36u,
                                                                  40u, 44u, 48u, 52u};

// ---------------------------------------------------------------------------
// Scale factor table
// ---------------------------------------------------------------------------
// 64 entries on a 2 dB grid: kScaleFactor[i] = 2^((i - 15) / 3).
// This is the ATRAC scale factor law (index 15 is unity, three steps per octave).
// native_test.cpp recomputes it from the formula and asserts a tight match.
inline constexpr std::array<double, 64u> kScaleFactor = {
    3.12500000000000000e-02, 3.93725328092147803e-02, 4.96062828740062439e-02,
    6.25000000000000000e-02, 7.87450656184295744e-02, 9.92125657480124601e-02,
    1.25000000000000000e-01, 1.57490131236859149e-01, 1.98425131496024920e-01,
    2.50000000000000000e-01, 3.14980262473718298e-01, 3.96850262992049896e-01,
    5.00000000000000000e-01, 6.29960524947436595e-01, 7.93700525984099792e-01,
    1.00000000000000000e+00, 1.25992104989487319e+00, 1.58740105196819936e+00,
    2.00000000000000000e+00, 2.51984209978974638e+00, 3.17480210393639917e+00,
    4.00000000000000000e+00, 5.03968419957949276e+00, 6.34960420787279745e+00,
    8.00000000000000000e+00, 1.00793683991589855e+01, 1.26992084157455949e+01,
    1.60000000000000000e+01, 2.01587367983179675e+01, 2.53984168314911969e+01,
    3.20000000000000000e+01, 4.03174735966359350e+01, 5.07968336629823938e+01,
    6.40000000000000000e+01, 8.06349471932718700e+01, 1.01593667325964788e+02,
    1.28000000000000000e+02, 1.61269894386543740e+02, 2.03187334651929575e+02,
    2.56000000000000000e+02, 3.22539788773087650e+02, 4.06374669303858923e+02,
    5.12000000000000000e+02, 6.45079577546175301e+02, 8.12749338607717846e+02,
    1.02400000000000000e+03, 1.29015915509235060e+03, 1.62549867721543569e+03,
    2.04800000000000000e+03, 2.58031831018470120e+03, 3.25099735443087138e+03,
    4.09600000000000000e+03, 5.16063662036940241e+03, 6.50199470886174277e+03,
    8.19200000000000000e+03, 1.03212732407388048e+04, 1.30039894177234855e+04,
    1.63840000000000000e+04, 2.06425464814776096e+04, 2.60079788354469711e+04,
    3.27680000000000000e+04, 4.12850929629552193e+04, 5.20159576708939421e+04,
    6.55360000000000000e+04};

// Spectral coefficients handed to the quantizer are scaled so that a 0 dBFS
// input lands near scale factor index 60 (2^15), leaving about 6 dB of headroom
// before the table saturates at index 63 while still spanning ~120 dB of range
// downwards.  The MDCT here is the unnormalised transform (the 2/B normalisation
// lives in the inverse), so a bin centred 0 dBFS tone produces a coefficient of
// about B/2, i.e. 128 in the 256 coefficient high band.  Scaling by 2^8 puts that
// worst case at 128 * 256 = 32768, which is exactly scale factor index 60.
inline constexpr double kSpectrumScale = 256.0;

// ---------------------------------------------------------------------------
// MDCT overlap ramp
// ---------------------------------------------------------------------------
// kOverlapRamp[j] = sin(pi/2 * (j + 0.5) / 32), j = 0..31.
// The analysis/synthesis window of a B-coefficient MDCT (2B input samples) is
//     w[n] = 0                                  n < B/2 - 16
//     w[n] = ramp[n - (B/2 - 16)]               B/2 - 16 <= n < B/2 + 16
//     w[n] = 1                                  B/2 + 16 <= n < 3B/2 - 16
//     w[n] = ramp[31 - (n - (3B/2 - 16))]       3B/2 - 16 <= n < 3B/2 + 16
//     w[n] = 0                                  n >= 3B/2 + 16
// which satisfies both the symmetry w[2B-1-n] = w[n] and the Princen-Bradley
// condition w[n]^2 + w[n+B]^2 = 1, because ramp[j]^2 + ramp[31-j]^2 =
// sin^2(x) + cos^2(x) = 1.  native_test.cpp asserts both properties directly.
inline constexpr std::array<double, kOverlapSamples> kOverlapRamp = {
    2.45412285229122881e-02, 7.35645635996674263e-02, 1.22410675199216196e-01,
    1.70961888760301217e-01, 2.19101240156869798e-01, 2.66712757474898365e-01,
    3.13681740398891518e-01, 3.59895036534988111e-01, 4.05241314004989861e-01,
    4.49611329654606540e-01, 4.92898192229784038e-01, 5.34997619887097153e-01,
    5.75808191417845339e-01, 6.15231590580626819e-01, 6.53172842953776756e-01,
    6.89540544737066829e-01, 7.24247082951466892e-01, 7.57208846506484567e-01,
    7.88346427626606228e-01, 8.17584813151583711e-01, 8.44853565249707006e-01,
    8.70086991108711350e-01, 8.93224301195515324e-01, 9.14209755703530691e-01,
    9.32992798834738846e-01, 9.49528180593036675e-01, 9.63776065795439840e-01,
    9.75702130038528570e-01, 9.85277642388941222e-01, 9.92479534598709967e-01,
    9.97290456678690207e-01, 9.99698818696204250e-01};

// ---------------------------------------------------------------------------
// QMF prototype filter
// ---------------------------------------------------------------------------
// 48-tap linear-phase symmetric half-band prototype h0.  The analysis pair is
// h1[n] = (-1)^n h0[n] and the synthesis pair is f0 = 2*h0, f1 = -2*h1, which
// cancels the aliasing term structurally; the residual round-trip transfer is
// (A(w)^2 + A(w+pi)^2) * z^-47, so perfect reconstruction reduces to power
// complementarity of the prototype amplitude response A.
//
// Derivation (deterministic, no random seed; the generator script is recorded in
// the implementation notes).  The 24 free half-taps are initialised from a
// Hamming-windowed half-band sinc and then optimised with 30000 Adam steps
// (lr 2e-4, halved every 10000 steps) on a 4097-point uniform grid over [0, pi]
// minimising
//     J = mean_grid[ stop(w) * A(w)^2 + 3000 * (A(w)^2 + A(pi-w)^2 - 1)^2 ]
// where stop(w) is 1 for w >= pi/2 + 0.18*pi and 0 otherwise.  The result is
// finally normalised to exactly unit DC gain.  Measured on an 8193-point grid:
//     power-complementarity ripple    0.00048 dB
//     passband ripple                 0.00024 dB
//     stopband attenuation          -56.41 dB
//     A(pi/2)                         0.7071032  (the -3 dB crossover that power
//                                                 complementarity requires)
inline constexpr std::size_t kQmfTaps = 48u;
inline constexpr std::size_t kQmfDelay = kQmfTaps - 1u; // 47, round-trip group delay
inline constexpr std::array<double, kQmfTaps> kQmfPrototype = {
    1.65626149047610343e-04,  -5.17954233313558518e-04, 3.79411962564228807e-04,
    4.10169017499072608e-04,  -3.03008018670914976e-04, -6.91798396565344994e-04,
    -2.22262112332691442e-04, 1.72177129264134126e-03,  1.35050832207954928e-03,
    -4.45733544826977870e-03, -2.48937090092543308e-03, 9.77840439886194790e-03,
    2.20196210980278971e-03,  -1.78996668767089882e-02, 1.30027417122859697e-03,
    2.83456353866453833e-02,  -9.57968547550670443e-03, -4.09599287352200234e-02,
    2.43665356370188248e-02,  5.87029203572854430e-02,  -5.18471618614359947e-02,
    -9.91238605182276772e-02, 1.40317219185965208e-01,  4.59051594586537159e-01,
    4.59051594586537159e-01,  1.40317219185965208e-01,  -9.91238605182276772e-02,
    -5.18471618614359947e-02, 5.87029203572854430e-02,  2.43665356370188248e-02,
    -4.09599287352200234e-02, -9.57968547550670443e-03, 2.83456353866453833e-02,
    1.30027417122859697e-03,  -1.78996668767089882e-02, 2.20196210980278971e-03,
    9.77840439886194790e-03,  -2.48937090092543308e-03, -4.45733544826977870e-03,
    1.35050832207954928e-03,  1.72177129264134126e-03,  -2.22262112332691442e-04,
    -6.91798396565344994e-04, -3.03008018670914976e-04, 4.10169017499072608e-04,
    3.79411962564228807e-04,  -5.17954233313558518e-04, 1.65626149047610343e-04};

// Split of the stage-2 round-trip delay (47 samples at the stage-1 subband rate)
// between the analysis and the synthesis side of the high band.  The analysis
// share is round(47/2) = 24 so the three bands are co-registered to within half a
// subband sample when their MDCT windows are taken; the remaining 23 samples are
// applied on the synthesis side, which keeps the total high-band path delay at
// exactly 47 and therefore preserves perfect reconstruction of the whole tree.
inline constexpr std::size_t kHighAnalysisDelay = 24u;
inline constexpr std::size_t kHighSynthesisDelay = kQmfDelay - kHighAnalysisDelay; // 23

} // namespace effetune::md_simulator

#endif

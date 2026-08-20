// MD Simulator (ATRAC1 SP, ATRAC3 LP2/LP4) native tests.
//
// Coverage map against the implementation plan:
//   7.1  functional safety and RT plumbing: all eight host rates x all three
//        modes, measured latency vs latencySamples(), variable block sizes,
//        NaN/Inf/denormal and over-range input, mono and extra channels,
//        reset-on-resume, mode switching, allocation free process (the
//        WRAP_MALLOC allocation guard), and the engine inline kernel storage
//        limit.  The ATRAC3 transform, allocator and bitstream themselves are
//        covered by the standalone core checks and are not repeated here; what
//        is tested here is only what exists after the kernel wiring.
//   7.2  in-repo algorithm oracles: (1) QMF perfect reconstruction through a
//        transparent encode/decode, (2) MDCT against a direct high precision
//        reference plus TDAC, (3) bit budget accounting with fuzzing, (4)
//        quantisation round trip midpoint property, (5) scale factor table
//        against its derivation formula.
//   7.3  test_adapter sound unit pack/unpack self consistency.  Byte exact
//        interoperability with a real ATRAC1 decoder is out of reach because the
//        BFU tables are self derived (see test_adapter.h) and is recorded as
//        residual risk.

#include "atrac1_core.h"
#include "atrac3_core.h"
#include "tables.h"
#include "test_adapter.h"

#include "MDSimulatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <string_view>
#include <utility>
#include <vector>

#if defined(_MSC_VER) && defined(_DEBUG)
#include <crtdbg.h>
#endif

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_MDSimulatorPlugin() noexcept;
extern "C" bool
et_md_copy_diagnostic(const effetune::PluginKernel *kernel,
                      effetune::md_simulator::KernelDiagnostic *diagnostic) noexcept;

namespace {

namespace md = effetune::md_simulator;
namespace adapter = effetune::md_simulator::test_adapter;
using Params = effetune::generated::MDSimulatorPluginParams;

constexpr std::uint32_t kMaximumFrames = 1024u;
constexpr std::size_t kKernelStorageBytes = 65536u;
// The real engine constructs every kernel inside a fixed inline buffer (see
// dsp/core/engine.h).  The local storage above is deliberately larger so a
// mistake shows up as a readable assertion instead of a truncated run, but the
// engine limit is what actually ships, so it is asserted separately.
constexpr std::size_t kEngineKernelStorageBytes = 8192u;

constexpr std::array<std::uint32_t, 8u> kHostRates = {44100u,  48000u,  88200u,  96000u,
                                                      176400u, 192000u, 352800u, 384000u};

// md parameter values: 0 = SP (ATRAC1 292 kbps), 1 = LP2 (ATRAC3 132 kbps),
// 2 = LP4 (ATRAC3 66 kbps joint stereo).
constexpr std::array<float, 3u> kModes = {0.0F, 1.0F, 2.0F};
constexpr std::array<const char *, 3u> kModeNames = {"SP", "LP2", "LP4"};

// Frame budget of the ATRAC3 modes, mirrored from atrac3_tables.h so that a
// silent table change shows up here.
[[nodiscard]] constexpr std::uint32_t expectedBudgetBits(float mode,
                                                         std::uint32_t channels) noexcept {
  if (mode < 0.5F) {
    return 0u;
  }
  if (mode > 1.5F) {
    return channels >= 2u ? 1536u : 768u;
  }
  return 1536u * (channels >= 2u ? 2u : 1u);
}

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "MD Simulator check failed: %s\n", message);
    ++failures;
  }
}

// Deterministic 32 bit xorshift so every stimulus is reproducible.
class Random final {
public:
  explicit Random(std::uint32_t seed) noexcept : state_(seed | 1u) {}

  std::uint32_t next() noexcept {
    state_ ^= state_ << 13u;
    state_ ^= state_ >> 17u;
    state_ ^= state_ << 5u;
    return state_;
  }

  double uniform() noexcept {
    return static_cast<double>(next() >> 8u) / static_cast<double>(1u << 24u);
  }

  double bipolar() noexcept { return 2.0 * uniform() - 1.0; }

private:
  std::uint32_t state_;
};

// ---------------------------------------------------------------------------
// 7.2 (5) scale factor table
// ---------------------------------------------------------------------------
void testScaleFactorTable() {
  for (std::size_t index = 0u; index < md::kScaleFactor.size(); ++index) {
    const double expected = std::pow(2.0, (static_cast<double>(index) - 15.0) / 3.0);
    const double relative = std::fabs(md::kScaleFactor[index] - expected) / expected;
    check(relative < 1.0e-12, "scale factor table does not match 2^((i - 15) / 3)");
  }
  check(std::fabs(md::kScaleFactor[15] - 1.0) < 1.0e-15, "scale factor index 15 is not unity gain");
}

// ---------------------------------------------------------------------------
// BFU geometry: both layouts must tile the 512 coefficient positions exactly
// once, otherwise the encoder would silently drop or double count spectra.
// ---------------------------------------------------------------------------
void testBfuGeometry() {
  std::size_t total = 0u;
  for (const std::uint16_t width : md::kSpecsPerBfu) {
    total += width;
  }
  check(total == md::kSoundUnitSamples, "BFU widths do not sum to 512");

  for (int shortMode = 0; shortMode < 2; ++shortMode) {
    std::array<std::uint8_t, md::kSoundUnitSamples> hits{};
    for (std::size_t bfu = 0u; bfu < md::kBfuCount; ++bfu) {
      const std::size_t start = md::bfuStart(bfu, shortMode != 0);
      const std::size_t width = md::kSpecsPerBfu[bfu];
      check(start + width <= md::kSoundUnitSamples, "BFU extends past the sound unit");
      for (std::size_t index = 0u; index < width; ++index) {
        ++hits[start + index];
      }
    }
    for (const std::uint8_t count : hits) {
      check(count == 1u, "BFU layout does not tile the sound unit exactly once");
    }
  }

  for (std::size_t bfu = 0u; bfu + 1u < md::kBfuCount; ++bfu) {
    check(md::kBfuStartLong[bfu] < md::kBfuStartLong[bfu + 1u],
          "long BFU starts are not monotone in frequency");
  }
  for (std::size_t band = 0u; band < md::kBandCount; ++band) {
    for (std::size_t bfu = md::kBandBfuStart[band]; bfu < md::kBandBfuStart[band + 1u]; ++bfu) {
      check(md::bfuBand(bfu) == band, "BFU band mapping disagrees with the band start table");
    }
  }
  check(md::wordLengthForIdwl(0) == 0, "IDWL 0 must zero the BFU");
  for (int idwl = 1; idwl <= md::kMaxIdwl; ++idwl) {
    check(md::wordLengthForIdwl(idwl) == idwl + 1, "IDWL to word length mapping is not n + 1");
  }
}

// ---------------------------------------------------------------------------
// 7.2 (2) MDCT against a direct reference, and TDAC
// ---------------------------------------------------------------------------
void testMdctReference() {
  md::Mdct mdct;
  mdct.prepare();
  Random random(0x51ED4C17u);

  const std::array<std::size_t, 3u> sizes = {md::kShortBlockSize, md::kBandSamples[0],
                                             md::kBandSamples[2]};
  for (const std::size_t blockSize : sizes) {
    std::vector<double> input(2u * blockSize, 0.0);
    for (double &value : input) {
      value = random.bipolar();
    }
    std::vector<double> spectrum(blockSize, 0.0);
    mdct.forward(blockSize, input.data(), spectrum.data());

    double worst = 0.0;
    double scale = 0.0;
    for (std::size_t k = 0u; k < blockSize; ++k) {
      double sum = 0.0;
      for (std::size_t n = 0u; n < 2u * blockSize; ++n) {
        const double angle = md::kPi / static_cast<double>(blockSize) *
                             (static_cast<double>(n) + 0.5 + 0.5 * static_cast<double>(blockSize)) *
                             (static_cast<double>(k) + 0.5);
        sum += input[n] * std::cos(angle);
      }
      worst = std::max(worst, std::fabs(sum - spectrum[k]));
      scale = std::max(scale, std::fabs(sum));
    }
    check(worst < 1.0e-9 * std::max(1.0, scale),
          "fast MDCT disagrees with the direct reference transform");
  }

  // Princen-Bradley: the window must satisfy w[n]^2 + w[n + B]^2 == 1 on the
  // overlap, which is what makes the 50 % overlap add cancel the time domain
  // alias.
  for (const std::size_t blockSize : sizes) {
    for (std::size_t n = 0u; n < blockSize; ++n) {
      const double first = md::mdctWindow(blockSize, n);
      const double second = md::mdctWindow(blockSize, n + blockSize);
      check(std::fabs(first * first + second * second - 1.0) < 1.0e-12,
            "MDCT window is not power complementary");
      check(std::fabs(md::mdctWindow(blockSize, 2u * blockSize - 1u - n) - first) < 1.0e-12,
            "MDCT window is not symmetric");
    }
  }

  // TDAC: windowed analysis and synthesis of overlapping blocks reconstructs the
  // signal exactly in the fully overlapped region.
  for (const std::size_t blockSize : sizes) {
    constexpr std::size_t kBlocks = 6u;
    const std::size_t length = (kBlocks + 1u) * blockSize;
    std::vector<double> signal(length, 0.0);
    for (double &value : signal) {
      value = random.bipolar();
    }
    std::vector<double> output(length, 0.0);
    std::vector<double> windowed(2u * blockSize, 0.0);
    std::vector<double> spectrum(blockSize, 0.0);
    std::vector<double> reconstructed(2u * blockSize, 0.0);
    for (std::size_t block = 0u; block + 1u < kBlocks; ++block) {
      const std::size_t origin = block * blockSize;
      for (std::size_t n = 0u; n < 2u * blockSize; ++n) {
        windowed[n] = signal[origin + n] * md::mdctWindow(blockSize, n);
      }
      mdct.forward(blockSize, windowed.data(), spectrum.data());
      mdct.inverse(blockSize, spectrum.data(), reconstructed.data());
      for (std::size_t n = 0u; n < 2u * blockSize; ++n) {
        output[origin + n] += reconstructed[n] * md::mdctWindow(blockSize, n);
      }
    }
    for (std::size_t n = blockSize; n + 2u * blockSize < length; ++n) {
      check(std::fabs(output[n] - signal[n]) < 1.0e-10,
            "MDCT overlap add does not cancel the time domain alias");
    }
  }
}

// ---------------------------------------------------------------------------
// QMF alias cancellation, exercised directly on the analysis/synthesis pair.
// ---------------------------------------------------------------------------
void testQmfPerfectReconstruction() {
  constexpr std::size_t kBlock = 512u;
  constexpr std::size_t kBlocks = 8u;
  md::QmfAnalysis analysis;
  md::QmfSynthesis synthesis;
  analysis.prepare(kBlock);
  synthesis.prepare(kBlock / 2u);

  Random random(0x2C7B19A5u);
  std::vector<double> input(kBlocks * kBlock, 0.0);
  for (double &value : input) {
    value = random.bipolar() * 0.5;
  }
  std::vector<double> output(kBlocks * kBlock, 0.0);
  std::vector<double> low(kBlock / 2u, 0.0);
  std::vector<double> high(kBlock / 2u, 0.0);
  for (std::size_t block = 0u; block < kBlocks; ++block) {
    analysis.process(input.data() + block * kBlock, kBlock, low.data(), high.data());
    synthesis.process(low.data(), high.data(), kBlock / 2u, output.data() + block * kBlock);
  }
  double worst = 0.0;
  for (std::size_t n = md::kQmfDelay; n < kBlocks * kBlock; ++n) {
    worst = std::max(worst, std::fabs(output[n] - input[n - md::kQmfDelay]));
  }
  // The prototype is power complementary to a measured 0.0005 dB ripple, so the
  // residual is the ripple, not an alias term.
  check(worst < 2.0e-4, "one QMF stage does not reconstruct within the design ripple");
}

// ---------------------------------------------------------------------------
// 7.2 (1) transparent encode/decode: the whole analysis chain, quantisation
// bypassed, must return the input delayed by kCodecDelaySamples.
// ---------------------------------------------------------------------------
void testTransparentRoundTrip() {
  md::Mdct mdct;
  mdct.prepare();
  md::Atrac1Channel channel;
  channel.prepare(&mdct);
  channel.encoder().setTransparent(true);

  constexpr std::size_t kUnits = 24u;
  const std::size_t length = kUnits * md::kSoundUnitSamples;
  std::vector<double> input(length, 0.0);
  Random random(0x71C4A93Du);
  for (std::size_t n = 0u; n < length; ++n) {
    const double t = static_cast<double>(n);
    input[n] =
        0.30 * std::sin(t * 0.031) + 0.20 * std::sin(t * 0.41 + 0.7) + 0.05 * random.bipolar();
  }
  std::vector<double> output(length, 0.0);
  for (std::size_t unit = 0u; unit < kUnits; ++unit) {
    channel.processUnit(input.data() + unit * md::kSoundUnitSamples,
                        output.data() + unit * md::kSoundUnitSamples);
  }

  double worst = 0.0;
  // Skip the first two sound units: the pipeline is still filling and the QMF
  // history has not converged.
  for (std::size_t n = 3u * md::kSoundUnitSamples; n < length; ++n) {
    worst = std::max(worst, std::fabs(output[n] - input[n - md::kCodecDelaySamples]));
  }
  if (worst >= 5.0e-3) {
    std::fprintf(stderr, "MD Simulator transparent worst error = %.6e\n", worst);
  }
  check(worst < 5.0e-3,
        "transparent encode/decode does not reconstruct the input at the declared delay");

  // The delay constant itself: search for the best alignment and require it to be
  // the documented one.
  std::size_t bestShift = 0u;
  double bestError = 1.0e30;
  for (std::size_t shift = md::kCodecDelaySamples - 24u; shift <= md::kCodecDelaySamples + 24u;
       ++shift) {
    double error = 0.0;
    for (std::size_t n = 4u * md::kSoundUnitSamples; n < length; ++n) {
      const double difference = output[n] - input[n - shift];
      error += difference * difference;
    }
    if (error < bestError) {
      bestError = error;
      bestShift = shift;
    }
  }
  check(bestShift == md::kCodecDelaySamples,
        "the best transparent alignment is not the documented codec delay");
}

// ---------------------------------------------------------------------------
// 7.2 (1) for the ATRAC3 path.  The LP transform chain - the four band QMF tree,
// the band MDCTs and the gain control - is otherwise only ever exercised through
// the kernel, where the quantiser hides how much of the error is the transform.
// With the allocator in transparent mode the whole chain has to return the input
// delayed by the documented codec delay, to within the QMF ripple.
// ---------------------------------------------------------------------------
void testAtrac3TransparentRoundTrip() {
  namespace lp = md::atrac3;
  md::Mdct mdct;
  mdct.prepare();
  // 13 KB of codec state: the kernel keeps it on the heap for the same reason.
  std::vector<lp::Atrac3Codec> codec(1u);
  codec[0].prepare(&mdct);
  codec[0].configure(lp::Mode::Lp2, 2u);
  codec[0].setTransparent(true);

  constexpr std::size_t kFrames = 20u;
  const std::size_t length = kFrames * lp::kFrameSamples;
  std::vector<double> input(2u * length, 0.0);
  std::vector<double> output(2u * length, 0.0);
  Random random(0x5D3A0E77u);
  for (std::size_t n = 0u; n < length; ++n) {
    const double t = static_cast<double>(n);
    input[n] =
        0.30 * std::sin(t * 0.017) + 0.18 * std::sin(t * 0.29 + 0.4) + 0.06 * random.bipolar();
    input[length + n] =
        0.26 * std::sin(t * 0.023 + 1.1) + 0.15 * std::sin(t * 0.37) + 0.06 * random.bipolar();
  }
  for (std::size_t frame = 0u; frame < kFrames; ++frame) {
    const std::size_t offset = frame * lp::kFrameSamples;
    codec[0].processFrame(input.data() + offset, output.data() + offset, length);
  }

  double worst = 0.0;
  // Skip the frames that are still filling the QMF and MDCT history.
  const std::size_t from = 2u * lp::kFrameSamples + lp::kCodecDelaySamples;
  for (std::size_t n = from; n < length; ++n) {
    worst = std::max(worst, std::fabs(output[n] - input[n - lp::kCodecDelaySamples]));
    worst =
        std::max(worst, std::fabs(output[length + n] - input[length + n - lp::kCodecDelaySamples]));
  }
  if (worst >= 5.0e-4) {
    std::fprintf(stderr, "MD Simulator ATRAC3 transparent worst error = %.6e\n", worst);
  }
  // The four band tree runs the same power complementary prototype three times,
  // so the residual is the accumulated pass band ripple, not an alias term.
  check(worst < 5.0e-4,
        "the ATRAC3 transform chain does not reconstruct the input at the declared delay");

  std::size_t bestShift = 0u;
  double bestError = 1.0e300;
  for (std::size_t shift = lp::kCodecDelaySamples - 32u; shift <= lp::kCodecDelaySamples + 32u;
       ++shift) {
    double error = 0.0;
    for (std::size_t n = from; n < length; ++n) {
      const double difference = output[n] - input[n - shift];
      error += difference * difference;
    }
    if (error < bestError) {
      bestError = error;
      bestShift = shift;
    }
  }
  check(bestShift == lp::kCodecDelaySamples,
        "the best ATRAC3 transparent alignment is not the documented codec delay");
}

bool sameAtrac3Frame(const md::atrac3::Atrac3Frame &left,
                     const md::atrac3::Atrac3Frame &right) noexcept {
  if (left.activeUnits != right.activeUnits ||
      left.toneComponentCount != right.toneComponentCount || left.usedBits != right.usedBits ||
      left.wordLength != right.wordLength || left.scaleFactorIndex != right.scaleFactorIndex ||
      left.quantized != right.quantized) {
    return false;
  }
  for (std::size_t band = 0u; band < md::atrac3::kBandCount; ++band) {
    if (left.gain[band].pointCount != right.gain[band].pointCount ||
        left.gain[band].location != right.gain[band].location ||
        left.gain[band].level != right.gain[band].level) {
      return false;
    }
  }
  return true;
}

// LP2 is dual channel: each channel owns a complete 192 byte frame and must not
// borrow budget or allocation decisions from the other one.  LP4 is the inverse
// contract: its mid and side frames share one 192 byte joint stereo budget.
void testAtrac3StereoBudgetIsolation() {
  namespace lp = md::atrac3;
  md::Mdct mdct;
  mdct.prepare();
  std::vector<lp::Atrac3Codec> lp2(2u);
  for (lp::Atrac3Codec &codec : lp2) {
    codec.prepare(&mdct);
    codec.configure(lp::Mode::Lp2, 2u);
  }
  std::vector<lp::Atrac3Codec> lp4(1u);
  lp4[0].prepare(&mdct);
  lp4[0].configure(lp::Mode::Lp4, 2u);

  std::vector<double> referenceInput(2u * lp::kFrameSamples, 0.0);
  std::vector<double> changedInput(2u * lp::kFrameSamples, 0.0);
  std::vector<double> referenceOutput(2u * lp::kFrameSamples, 0.0);
  std::vector<double> changedOutput(2u * lp::kFrameSamples, 0.0);
  std::vector<double> lp4Output(2u * lp::kFrameSamples, 0.0);
  Random random(0xA3274C19u);
  bool sawRightFrameDifference = false;

  constexpr std::size_t kFrames = 16u;
  for (std::size_t frame = 0u; frame < kFrames; ++frame) {
    for (std::size_t n = 0u; n < lp::kFrameSamples; ++n) {
      const double t = static_cast<double>(frame * lp::kFrameSamples + n);
      const double left = 0.42 * std::sin(t * 0.019) + 0.17 * std::cos(t * 0.37);
      referenceInput[n] = left;
      changedInput[n] = left;
      referenceInput[lp::kFrameSamples + n] = 0.02 * std::sin(t * 0.011);
      changedInput[lp::kFrameSamples + n] = 0.72 * random.bipolar() + 0.18 * std::sin(t * 0.43);
    }

    lp2[0].processFrame(referenceInput.data(), referenceOutput.data(), lp::kFrameSamples);
    lp2[1].processFrame(changedInput.data(), changedOutput.data(), lp::kFrameSamples);

    for (const lp::Atrac3Codec &codec : lp2) {
      const lp::Atrac3Frame &left = codec.lastFrame(0u);
      const lp::Atrac3Frame &right = codec.lastFrame(1u);
      check(left.usedBits <= lp::kLp2FrameBits, "an LP2 left frame exceeded 1536 bits");
      check(right.usedBits <= lp::kLp2FrameBits, "an LP2 right frame exceeded 1536 bits");
      check(codec.lastFrameBits() == left.usedBits + right.usedBits,
            "the LP2 diagnostic is not the sum of its independent channel frames");
    }

    check(sameAtrac3Frame(lp2[0].lastFrame(0u), lp2[1].lastFrame(0u)),
          "changing only the LP2 right channel changed the left coded frame");
    check(std::equal(referenceOutput.begin(),
                     referenceOutput.begin() + static_cast<std::ptrdiff_t>(lp::kFrameSamples),
                     changedOutput.begin()),
          "changing only the LP2 right channel changed the left decoded output");
    sawRightFrameDifference =
        sawRightFrameDifference || !sameAtrac3Frame(lp2[0].lastFrame(1u), lp2[1].lastFrame(1u));

    lp4[0].processFrame(changedInput.data(), lp4Output.data(), lp::kFrameSamples);
    const lp::Atrac3Frame &mid = lp4[0].lastFrame(0u);
    const lp::Atrac3Frame &side = lp4[0].lastFrame(1u);
    check(lp4[0].lastFrameBits() == lp::kJointModeBits + mid.usedBits + side.usedBits,
          "the LP4 diagnostic does not include both channels and joint side information");
    check(lp4[0].lastFrameBits() <= lp::kLp4PairFrameBits,
          "an LP4 stereo pair exceeded its shared 1536 bit budget");
  }
  check(sawRightFrameDifference,
        "the LP2 channel-isolation stimulus did not change the right frame");
}

// ---------------------------------------------------------------------------
// 7.2 (3) bit budget accounting, with fuzzing, plus the 7.3 pack/unpack adapter.
// ---------------------------------------------------------------------------
void testBitBudgetAndAdapter() {
  md::Mdct mdct;
  mdct.prepare();
  md::Atrac1Channel channel;
  channel.prepare(&mdct);

  Random random(0x1F3B7705u);
  std::vector<double> unitInput(md::kSoundUnitSamples, 0.0);
  std::vector<double> unitOutput(md::kSoundUnitSamples, 0.0);
  bool sawShort = false;
  bool sawLong = false;

  constexpr std::size_t kUnits = 220u;
  for (std::size_t unit = 0u; unit < kUnits; ++unit) {
    // Rotate through stimulus families: noise, tone bursts, silence, transients
    // and hard clipped content, so the allocation loop is fuzzed across regimes.
    const std::size_t family = unit % 5u;
    const double amplitude = (family == 2u) ? 0.0 : (0.05 + 0.95 * random.uniform());
    for (std::size_t n = 0u; n < md::kSoundUnitSamples; ++n) {
      const double t = static_cast<double>(unit * md::kSoundUnitSamples + n);
      double value = 0.0;
      switch (family) {
      case 0u:
        value = random.bipolar();
        break;
      case 1u:
        value = std::sin(t * 0.021) + 0.5 * std::sin(t * 0.53);
        break;
      case 2u:
        value = 0.0;
        break;
      case 3u:
        value = (n >= 300u && n < 316u) ? random.bipolar() : 1.0e-5 * random.bipolar();
        break;
      default:
        value = std::sin(t * 0.11) > 0.0 ? 1.0 : -1.0;
        break;
      }
      unitInput[n] = amplitude * value;
    }
    channel.processUnit(unitInput.data(), unitOutput.data());
    const md::SoundUnit &sound = channel.lastUnit();

    for (const double value : unitOutput) {
      check(std::isfinite(value), "decoded sound unit produced a non finite sample");
    }

    sawShort = sawShort || sound.blockMode[0] != 0u || sound.blockMode[1] != 0u ||
               sound.blockMode[2] != 0u;
    sawLong = sawLong ||
              (sound.blockMode[0] == 0u && sound.blockMode[1] == 0u && sound.blockMode[2] == 0u);

    // The plan formula, asserted verbatim.
    std::size_t bits = md::kFixedOverheadBits + md::kSideInfoBitsPerBfu * sound.bfuCount;
    for (std::size_t bfu = 0u; bfu < sound.bfuCount; ++bfu) {
      const std::size_t wordLength = sound.wordLength[bfu];
      check(wordLength == 0u || (wordLength >= 2u && wordLength <= 16u),
            "word length is neither zero nor a valid IDWL + 1 value");
      bits += wordLength * md::kSpecsPerBfu[bfu];
    }
    check(bits == sound.usedBits, "reported sound unit size disagrees with the budget formula");
    check(bits <= md::kSoundUnitBits, "sound unit exceeds the 1,696 bit budget");
    for (std::size_t bfu = sound.bfuCount; bfu < md::kBfuCount; ++bfu) {
      check(sound.wordLength[bfu] == 0u, "an inactive BFU carries a non zero word length");
    }

    bool amountValid = false;
    for (const std::uint16_t amount : md::kBfuAmountTable) {
      amountValid = amountValid || amount == sound.bfuCount;
    }
    check(amountValid, "active BFU count is not one of the table entries");

    // 7.3: the unit must serialise into the physical 212 byte container and
    // survive the round trip unchanged.
    adapter::SoundUnitBytes bytes{};
    const std::size_t packed = adapter::packSoundUnit(sound, bytes);
    check(packed != 0u && packed <= md::kSoundUnitBits,
          "sound unit does not fit the 212 byte container");
    md::SoundUnit restored;
    check(adapter::unpackSoundUnit(bytes, restored), "sound unit byte image did not unpack");
    check(restored.bfuAmountIndex == sound.bfuAmountIndex && restored.bfuCount == sound.bfuCount,
          "unpacked BFU amount differs");
    for (std::size_t band = 0u; band < md::kBandCount; ++band) {
      check(restored.blockMode[band] == sound.blockMode[band], "unpacked block mode differs");
    }
    for (std::size_t bfu = 0u; bfu < sound.bfuCount; ++bfu) {
      check(restored.wordLength[bfu] == sound.wordLength[bfu], "unpacked word length differs");
      if (sound.wordLength[bfu] == 0u) {
        continue;
      }
      check(restored.scaleFactorIndex[bfu] == sound.scaleFactorIndex[bfu],
            "unpacked scale factor index differs");
      const bool shortLayout =
          sound.blockMode[0] != 0u || sound.blockMode[1] != 0u || sound.blockMode[2] != 0u;
      const std::size_t start = md::bfuStart(bfu, shortLayout);
      for (std::size_t index = 0u; index < md::kSpecsPerBfu[bfu]; ++index) {
        check(restored.quantized[start + index] == sound.quantized[start + index],
              "unpacked spectral word differs");
      }
    }
  }
  check(sawShort, "the transient fuzzing never selected a short block");
  check(sawLong, "the fuzzing never produced a long block unit");

  // AEA container header, written by the developer side ffmpeg diagnostic.
  std::array<std::uint8_t, adapter::kAeaHeaderBytes> header{};
  adapter::writeAeaHeader(header, "MDSIM", 1234u, 2u);
  check(header[0] == 0x00u && header[1] == 0x08u && header[2] == 0x00u && header[3] == 0x00u,
        "AEA magic is wrong");
  check(header[4] == 'M' && header[8] == 'M' && header[9] == '\0', "AEA title field is wrong");
  const std::uint32_t units = static_cast<std::uint32_t>(header[260]) |
                              (static_cast<std::uint32_t>(header[261]) << 8u) |
                              (static_cast<std::uint32_t>(header[262]) << 16u) |
                              (static_cast<std::uint32_t>(header[263]) << 24u);
  check(units == 1234u && header[264] == 2u, "AEA unit or channel count is wrong");
}

// ---------------------------------------------------------------------------
// 7.2 (4) quantisation round trip
// ---------------------------------------------------------------------------
void testQuantizationRoundTrip() {
  Random random(0x63A1E5B9u);
  for (int wordLength = 2; wordLength <= 16; ++wordLength) {
    const int maxq = (1 << (wordLength - 1)) - 1;
    const int minq = -(1 << (wordLength - 1));
    for (std::size_t sfi = 0u; sfi < md::kScaleFactor.size(); sfi += 7u) {
      const double sf = md::kScaleFactor[sfi];
      const double step = sf / static_cast<double>(maxq);
      for (std::size_t trial = 0u; trial < 64u; ++trial) {
        const double value = sf * random.bipolar();
        long quantized = std::lround(value / step);
        quantized = std::min<long>(std::max<long>(quantized, minq), maxq);
        const double restored = static_cast<double>(quantized) * step;
        // The decoder reconstructs the midpoint of the quantisation cell, so the
        // error is bounded by half a step everywhere the value is in range.
        if (quantized > minq && quantized < maxq) {
          check(std::fabs(restored - value) <= 0.5 * step * (1.0 + 1.0e-9),
                "quantisation round trip is not the midpoint reconstruction");
        } else {
          check(std::fabs(restored - value) <= step * (1.0 + 1.0e-9),
                "clamped quantisation round trip left more than one step of error");
        }
      }
      // Exactly representable points must survive unchanged.
      for (int q = minq + 1; q <= maxq; q += std::max(1, maxq / 8)) {
        const double exact = static_cast<double>(q) * step;
        const long quantized = std::lround(exact / step);
        check(quantized == q, "an exactly representable level did not survive the round trip");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Kernel level tests (7.1)
// ---------------------------------------------------------------------------
Params defaultParams() noexcept { return {0.0F, 0.0F, 100.0F}; }

Params modeParams(float mode) noexcept { return {mode, 0.0F, 100.0F}; }

class KernelHarness final {
public:
  KernelHarness(float sample_rate, std::uint32_t channels,
                std::uint32_t max_frames = kMaximumFrames) {
    descriptor_ = et_kernel_descriptor_MDSimulatorPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr || descriptor_->objectSize > storage_.size()) {
      check(false, "kernel does not fit the test storage");
      return;
    }
    check(descriptor_->objectSize <= kEngineKernelStorageBytes,
          "kernel object does not fit the engine inline kernel storage");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      check(descriptor_->paramsHash == Params::kHash, "descriptor parameter hash matches");
      kernel_->prepare({sample_rate, channels, max_frames});
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  [[nodiscard]] bool ready() const noexcept {
    return kernel_ != nullptr && kernel_->preparedSuccessfully();
  }

  [[nodiscard]] std::uint32_t latency() const noexcept {
    return kernel_ != nullptr ? kernel_->latencySamples() : 0u;
  }

  void stage(const Params &params) noexcept {
    const et_status status =
        kernel_->stageParameters(&params.mode, Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    kernel_->applyPendingParameters();
    const std::uint32_t violations = effetune::allocation_guard::violationCount();
    {
      effetune::allocation_guard::Scope allocation_scope;
      kernel_->process(audio, channels, frames, {0.0});
    }
    check(effetune::allocation_guard::violationCount() == violations,
          "process performs no allocation");
  }

  void reset() noexcept { kernel_->reset(); }

  [[nodiscard]] bool diagnostic(md::KernelDiagnostic &out) const noexcept {
    return et_md_copy_diagnostic(kernel_, &out);
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

// Measures the wet impulse peak position at one host rate.
std::uint32_t measureWetLatency(std::uint32_t rate, float mode, std::uint32_t &peakIndex,
                                double &peakValue) {
  KernelHarness harness(static_cast<float>(rate), 2u);
  if (!harness.ready()) {
    peakIndex = 0u;
    peakValue = 0.0;
    return 0u;
  }
  Params params = modeParams(mode);
  const std::uint32_t total = 4u * rate / 10u;
  constexpr std::uint32_t kBlock = 512u;
  std::vector<float> audio(2u * kBlock, 0.0F);
  std::uint32_t absolute = 0u;
  peakIndex = 0u;
  peakValue = 0.0;
  while (absolute < total) {
    const std::uint32_t count = std::min<std::uint32_t>(kBlock, total - absolute);
    std::fill(audio.begin(), audio.end(), 0.0F);
    if (absolute == 0u) {
      audio[0] = 1.0F;
      audio[count] = 1.0F;
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, count);
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      const double value = std::fabs(static_cast<double>(audio[frame]));
      if (value > peakValue) {
        peakValue = value;
        peakIndex = absolute + frame;
      }
    }
    absolute += count;
  }
  return harness.latency();
}

// Measures the group delay of the wet path by finding the integer shift that
// best aligns the decoded output with the input.  This is more precise than the
// impulse peak, because a lossy codec spreads an impulse over a whole sound unit
// but leaves the group delay of a broadband signal intact.
std::uint32_t measureWetAlignment(std::uint32_t rate, float mode, std::uint32_t &declared) {
  KernelHarness harness(static_cast<float>(rate), 2u);
  declared = harness.ready() ? harness.latency() : 0u;
  if (!harness.ready()) {
    return 0u;
  }
  Params params = modeParams(mode);
  constexpr std::uint32_t kSearch = 64u;
  const std::uint32_t total = declared + rate / 4u;
  constexpr std::uint32_t kBlock = 512u;
  std::vector<float> audio(2u * kBlock, 0.0F);
  std::vector<double> stimulus(total, 0.0);
  std::vector<double> captured(total, 0.0);
  Random random(0x33C9F51Bu ^ rate);
  // Band limited stimulus: a slow sweep well inside the codec passband, so the
  // coding loss does not bias the alignment.
  double phase = 0.0;
  for (std::uint32_t index = 0u; index < total; ++index) {
    const double sweep = 200.0 + 1800.0 * static_cast<double>(index) / static_cast<double>(total);
    phase += 6.2831853071795865 * sweep / static_cast<double>(rate);
    stimulus[index] = 0.5 * std::sin(phase) + 0.02 * random.bipolar();
  }
  std::uint32_t absolute = 0u;
  while (absolute < total) {
    const std::uint32_t count = std::min<std::uint32_t>(kBlock, total - absolute);
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      audio[frame] = static_cast<float>(stimulus[absolute + frame]);
      audio[count + frame] = audio[frame];
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, count);
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      captured[absolute + frame] = static_cast<double>(audio[frame]);
    }
    absolute += count;
  }
  std::uint32_t best = declared;
  double bestError = 1.0e300;
  const std::uint32_t from = declared > kSearch ? declared - kSearch : 0u;
  for (std::uint32_t shift = from; shift <= declared + kSearch; ++shift) {
    double error = 0.0;
    for (std::uint32_t index = declared + kSearch + 2048u; index < total; ++index) {
      const double difference = captured[index] - stimulus[index - shift];
      error += difference * difference;
    }
    if (error < bestError) {
      bestError = error;
      best = shift;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 7.1 safety gate stimuli.
//
// The gate has to fire on the two shapes the quality pass found in the ATRAC3
// gain control, neither of which a sustained tone produces:
//   * transient dense material - broadband noise chopped by a hard gate, which
//     puts an MDCT block across a gain region boundary on every edge;
//   * steady near full scale pink noise, which is what exposed the 48 kHz family
//     (the rational resampler path) on its own.
// Both are generated in full ahead of the run so the measured input peak, which
// the divergence limit is relative to, is known before the first sample.
// ---------------------------------------------------------------------------
enum class SafetyStimulus : std::uint8_t { Tone = 0u, GateBurst = 1u, PinkNoise = 2u };

constexpr std::array<const char *, 3u> kSafetyStimulusNames = {"tone", "gate-burst", "pink"};

// Scales a planar stereo stimulus to -1 dBFS, the level the quality census used.
void normalizeStimulus(std::vector<double> &stimulus) noexcept {
  double peak = 0.0;
  for (const double value : stimulus) {
    peak = std::max(peak, std::fabs(value));
  }
  if (peak <= 0.0) {
    return;
  }
  const double gain = 0.891250938 / peak;
  for (double &value : stimulus) {
    value *= gain;
  }
}

// Planar stereo: [0, total) is the left channel, [total, 2 * total) the right.
void fillSafetyStimulus(SafetyStimulus kind, std::uint32_t rate, std::uint32_t total,
                        std::vector<double> &stimulus) {
  stimulus.assign(2u * static_cast<std::size_t>(total), 0.0);
  Random random(0x4A17BE33u ^ rate);
  const std::size_t count = static_cast<std::size_t>(total);
  switch (kind) {
  case SafetyStimulus::Tone: {
    for (std::size_t n = 0u; n < count; ++n) {
      const double t =
          static_cast<double>(n) * 6.2831853071795865 * 1000.0 / static_cast<double>(rate);
      stimulus[n] = 0.5 * std::sin(t) + 0.05 * random.bipolar();
      stimulus[count + n] = 0.4 * std::cos(t * 1.7);
    }
    break;
  }
  case SafetyStimulus::GateBurst: {
    // Eight noise bursts per second at every host rate, 50 % duty, with 1 ms
    // raised cosine edges: silence long enough for the gain control envelope to
    // release fully, then an attack far faster than it can follow.  The noise is
    // band limited to 4 kHz first, which is what the material this models looks
    // like and, more to the point, keeps the codec's own ringing on the burst
    // near unity so the divergence limit below is not measuring the stimulus.
    const std::uint32_t period = std::max<std::uint32_t>(64u, rate / 8u);
    const std::uint32_t open = period / 2u;
    const std::uint32_t ramp = std::max<std::uint32_t>(4u, rate / 1000u);
    const double pole = std::exp(-6.2831853071795865 * 4000.0 / static_cast<double>(rate));
    double filtered = 0.0;
    for (std::size_t n = 0u; n < count; ++n) {
      filtered = pole * filtered + (1.0 - pole) * random.bipolar();
      const std::uint32_t phase = static_cast<std::uint32_t>(n % period);
      double gate = 0.0;
      if (phase < open) {
        gate = 1.0;
        if (phase < ramp) {
          gate = 0.5 - 0.5 * std::cos(3.14159265358979324 * static_cast<double>(phase) /
                                      static_cast<double>(ramp));
        } else if (phase + ramp >= open) {
          gate = 0.5 - 0.5 * std::cos(3.14159265358979324 * static_cast<double>(open - phase) /
                                      static_cast<double>(ramp));
        }
      }
      const double value = gate * filtered;
      stimulus[n] = value;
      stimulus[count + n] = 0.97 * value;
    }
    break;
  }
  case SafetyStimulus::PinkNoise: {
    // Three pole pink filter (Kellet), one independent state per channel.
    std::array<double, 3u> left{};
    std::array<double, 3u> right{};
    for (std::size_t n = 0u; n < count; ++n) {
      const double wl = random.bipolar();
      left[0] = 0.99765 * left[0] + wl * 0.0990460;
      left[1] = 0.96300 * left[1] + wl * 0.2965164;
      left[2] = 0.57000 * left[2] + wl * 1.0526913;
      stimulus[n] = left[0] + left[1] + left[2] + wl * 0.1848;
      const double wr = random.bipolar();
      right[0] = 0.99765 * right[0] + wr * 0.0990460;
      right[1] = 0.96300 * right[1] + wr * 0.2965164;
      right[2] = 0.57000 * right[2] + wr * 1.0526913;
      stimulus[count + n] = right[0] + right[1] + right[2] + wr * 0.1848;
    }
    break;
  }
  }
  normalizeStimulus(stimulus);
}

void testAllRatesFunctionalSafety() {
  constexpr std::array<SafetyStimulus, 3u> kSafetyStimuli = {
      SafetyStimulus::Tone, SafetyStimulus::GateBurst, SafetyStimulus::PinkNoise};
  for (std::size_t modeIndex = 0u; modeIndex < kModes.size(); ++modeIndex) {
    const float mode = kModes[modeIndex];
    for (const std::uint32_t rate : kHostRates) {
      for (const SafetyStimulus kind : kSafetyStimuli) {
        const bool tone = kind == SafetyStimulus::Tone;
        KernelHarness harness(static_cast<float>(rate), 2u);
        check(harness.ready(), "kernel prepares at a supported host rate");
        if (!harness.ready()) {
          continue;
        }
        check(harness.latency() != 0u, "supported host rate declares a latency");

        Params params = modeParams(mode);
        // The tone runs a little over one second, which is enough for many sound
        // units at every rate, including 384 kHz where the output queue has to
        // carry an 8x burst.  The two divergence stimuli run half of that: the
        // failure mode they cover fires within the first few frames.
        const std::uint32_t total = tone ? rate + 777u : rate / 2u + 777u;
        std::vector<double> stimulus;
        fillSafetyStimulus(kind, rate, total, stimulus);
        double inputPeak = 0.0;
        for (const double value : stimulus) {
          inputPeak = std::max(inputPeak, std::fabs(value));
        }
        // Divergence limit, relative to what actually went in.  An absolute
        // limit cannot work: the two defects the quality pass found overshot by
        // up to 30x on gated bursts and 20x on steady pink noise at some rates
        // but by only 3.5x at others, so a fixed 8.0 on a -1 dBFS stimulus never
        // saw the second class at all.  2.0x catches every one of them - scored
        // against the pre-fix build, these three stimuli go red on 15 of the 36
        // runs at the first four host rates alone, the worst at 30x - while the
        // shipping code's worst measured case over all eight rates, all three
        // modes and all three stimuli is 1.38x, clearing the limit by 45 %.
        const double limit = 2.0 * inputPeak;
        check(inputPeak > 0.1, "safety stimulus is silent");

        constexpr std::uint32_t kBlock = 640u;
        std::vector<float> audio(2u * kBlock, 0.0F);
        std::uint32_t absolute = 0u;
        bool reported = false;
        while (absolute < total) {
          const std::uint32_t count = std::min<std::uint32_t>(kBlock, total - absolute);
          for (std::uint32_t frame = 0u; frame < count; ++frame) {
            const std::size_t index = static_cast<std::size_t>(absolute) + frame;
            audio[frame] = static_cast<float>(stimulus[index]);
            audio[count + frame] = static_cast<float>(stimulus[total + index]);
          }
          harness.stage(params);
          harness.process(audio.data(), 2u, count);
          for (std::uint32_t index = 0u; index < 2u * count; ++index) {
            check(std::isfinite(audio[index]), "kernel produced a non finite sample");
            const double magnitude = std::fabs(static_cast<double>(audio[index]));
            if (magnitude > limit && !reported) {
              reported = true;
              std::fprintf(stderr,
                           "MD Simulator %s %u Hz %s: output %.4f exceeds %.4f "
                           "(input peak %.4f)\n",
                           kModeNames[modeIndex], rate,
                           kSafetyStimulusNames[static_cast<std::size_t>(kind)], magnitude, limit,
                           inputPeak);
            }
            check(magnitude <= limit, "kernel output diverged past twice the input peak");
          }
          absolute += count;
        }

        md::KernelDiagnostic diagnostic{};
        check(harness.diagnostic(diagnostic), "diagnostic snapshot is available");
        if (tone) {
          check(diagnostic.completedUnits > 20u, "too few coding windows completed in one second");
        }
        check(diagnostic.outputUnderflows == 0u, "the output queue ran dry");
        check(diagnostic.outputOverflows == 0u, "the output queue overflowed");
        check(diagnostic.latencySamples == harness.latency(),
              "diagnostic latency disagrees with latencySamples()");
        const bool fortyFourFamily = (rate % 44100u) == 0u;
        check(diagnostic.baseRate == (fortyFourFamily ? 44100u : 48000u),
              "host rate routed to the wrong base rate");
        check(diagnostic.rationalStages == (fortyFourFamily ? 0u : 4u),
              "rational stage count does not match the host family");

        // Mode plumbing.  The bit budget itself is an ATRAC3 core property and is
        // covered by the core tests; what only exists after the kernel wiring is
        // that the md parameter reaches the codec and that the packed frame stays
        // inside the selected budget at every host rate.
        check(diagnostic.activeMode == static_cast<std::uint32_t>(modeIndex),
              "the md parameter did not reach the codec");
        if (mode > 0.5F) {
          check(diagnostic.lpBudgetBits == expectedBudgetBits(mode, 2u),
                "the ATRAC3 frame budget does not match the selected mode");
          check(diagnostic.lpFrameBits > 0u, "the ATRAC3 frame packed no bits");
          if (diagnostic.lpFrameBits > diagnostic.lpBudgetBits) {
            std::fprintf(stderr, "MD Simulator %s %u Hz: %u bits over a %u bit budget\n",
                         kModeNames[modeIndex], rate, diagnostic.lpFrameBits,
                         diagnostic.lpBudgetBits);
          }
          check(diagnostic.lpFrameBits <= diagnostic.lpBudgetBits,
                "the ATRAC3 frame exceeded its bit budget");
        } else {
          check(diagnostic.lpFrameBits == 0u, "SP produced ATRAC3 frame bits");
        }
      }
    }
  }
}

void testWetLatencyMatchesDeclaration() {
  for (std::size_t modeIndex = 0u; modeIndex < kModes.size(); ++modeIndex) {
    const float mode = kModes[modeIndex];
    for (const std::uint32_t rate : kHostRates) {
      std::uint32_t peakIndex = 0u;
      double peakValue = 0.0;
      const std::uint32_t declared = measureWetLatency(rate, mode, peakIndex, peakValue);
      check(peakValue > 0.02, "the wet impulse response is missing");
      // The codec is lossy, so the impulse peak is only expected within a coding
      // window of the declared latency; a systematic misdeclaration is much
      // larger.
      const std::uint32_t tolerance = 64u + rate / 1000u;
      const std::uint32_t difference =
          peakIndex > declared ? peakIndex - declared : declared - peakIndex;
      if (difference > tolerance) {
        std::fprintf(stderr, "MD Simulator latency %s %u Hz: declared %u, measured peak %u\n",
                     kModeNames[modeIndex], rate, declared, peakIndex);
      }
      check(difference <= tolerance, "declared latency does not match the measured impulse peak");

      // The group delay measurement is tight: the declared value has to be the
      // best alignment of the wet output against the input, to within the half
      // sample ambiguity that the 48 kHz family rational stages introduce.  All
      // three modes share one declaration, so all three have to land on it.
      std::uint32_t declaredAgain = 0u;
      const std::uint32_t aligned = measureWetAlignment(rate, mode, declaredAgain);
      const std::uint32_t drift =
          aligned > declaredAgain ? aligned - declaredAgain : declaredAgain - aligned;
      if (drift > 2u) {
        std::fprintf(stderr, "MD Simulator alignment %s %u Hz: declared %u, measured %u\n",
                     kModeNames[modeIndex], rate, declaredAgain, aligned);
      }
      check(drift <= 2u, "declared latency is not the best wet alignment");
    }
  }
}

void testDryLatencyAlignment() {
  for (const float mode : kModes) {
    for (const std::uint32_t rate : kHostRates) {
      KernelHarness harness(static_cast<float>(rate), 2u);
      check(harness.ready(), "dry alignment kernel prepares");
      if (!harness.ready()) {
        continue;
      }
      Params params = modeParams(mode);
      params.mix = 0.0F;
      const std::uint32_t latency = harness.latency();
      const std::uint32_t total = latency + 4096u;
      constexpr std::uint32_t kBlock = 512u;
      std::vector<float> audio(2u * kBlock, 0.0F);
      std::vector<float> captured(total, 0.0F);
      std::uint32_t absolute = 0u;
      while (absolute < total) {
        const std::uint32_t count = std::min<std::uint32_t>(kBlock, total - absolute);
        for (std::uint32_t frame = 0u; frame < count; ++frame) {
          const double t = static_cast<double>(absolute + frame);
          const float value = static_cast<float>(0.5 * std::sin(t * 0.017));
          audio[frame] = value;
          audio[count + frame] = value;
        }
        harness.stage(params);
        harness.process(audio.data(), 2u, count);
        for (std::uint32_t frame = 0u; frame < count; ++frame) {
          captured[absolute + frame] = audio[frame];
        }
        absolute += count;
      }
      double worst = 0.0;
      for (std::uint32_t index = latency; index < total; ++index) {
        const double expected = 0.5 * std::sin(static_cast<double>(index - latency) * 0.017);
        worst = std::max(worst, std::fabs(static_cast<double>(captured[index]) - expected));
      }
      // The mix control is smoothed over 20 ms, but it starts at its target, so
      // the dry path is exact from the first sample.  The declared latency is
      // shared by all three modes, so the dry alignment holds for all three.
      check(worst < 2.0e-6, "mix = 0 output is not the input delayed by latencySamples()");
    }
  }
}

void testVariableBlockSizesForMode(float mode) {
  constexpr std::array<std::uint32_t, 8u> sizes = {1u, 17u, 127u, 128u, 129u, 511u, 512u, 1024u};
  KernelHarness reference(96000.0F, 2u);
  check(reference.ready(), "variable block size reference kernel prepares");
  if (!reference.ready()) {
    return;
  }
  Params params = modeParams(mode);

  // A single long run of one signal, played back in blocks of one size, must give
  // the same output as the same signal in blocks of any other size.
  constexpr std::uint32_t kTotal = 24000u;
  std::vector<std::vector<float>> results;
  for (const std::uint32_t size : sizes) {
    KernelHarness harness(96000.0F, 2u);
    check(harness.ready(), "variable block size kernel prepares");
    if (!harness.ready()) {
      return;
    }
    std::vector<float> captured(kTotal, 0.0F);
    std::vector<float> audio(2u * kMaximumFrames, 0.0F);
    std::uint32_t absolute = 0u;
    while (absolute < kTotal) {
      const std::uint32_t count = std::min<std::uint32_t>(size, kTotal - absolute);
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        const double t = static_cast<double>(absolute + frame);
        audio[frame] = static_cast<float>(0.45 * std::sin(t * 0.0231) + 0.25 * std::sin(t * 0.157));
        audio[count + frame] = static_cast<float>(0.35 * std::cos(t * 0.031));
      }
      harness.stage(params);
      harness.process(audio.data(), 2u, count);
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        captured[absolute + frame] = audio[frame];
      }
      absolute += count;
    }
    for (const float value : captured) {
      check(std::isfinite(value), "variable block size run produced a non finite sample");
    }
    results.push_back(std::move(captured));
  }
  for (std::size_t index = 1u; index < results.size(); ++index) {
    double worst = 0.0;
    for (std::uint32_t frame = 0u; frame < kTotal; ++frame) {
      worst = std::max(worst, std::fabs(static_cast<double>(results[index][frame]) -
                                        static_cast<double>(results[0][frame])));
    }
    check(worst < 1.0e-6, "output depends on the host block size");
  }
}

// The SP encoder runs on 512 sample units and the ATRAC3 encoder on 1024 sample
// frames, but both are driven from the same 1024 sample window schedule, so the
// block size independence has to hold for every mode.
void testVariableBlockSizes() {
  for (const float mode : kModes) {
    testVariableBlockSizesForMode(mode);
  }
}

// Captures the wet output of one mode for a shared stimulus, aligned to the
// declared latency.  Used to prove that the three modes really are three codecs
// and not one codec behind three labels.
void captureMode(std::uint32_t rate, float mode, const std::vector<double> &stimulus,
                 std::vector<double> &captured, std::uint32_t &latency) {
  KernelHarness harness(static_cast<float>(rate), 2u);
  latency = harness.ready() ? harness.latency() : 0u;
  captured.assign(stimulus.size(), 0.0);
  if (!harness.ready()) {
    return;
  }
  Params params = modeParams(mode);
  constexpr std::uint32_t kBlock = 512u;
  std::vector<float> audio(2u * kBlock, 0.0F);
  std::uint32_t absolute = 0u;
  const std::uint32_t total = static_cast<std::uint32_t>(stimulus.size());
  while (absolute < total) {
    const std::uint32_t count = std::min<std::uint32_t>(kBlock, total - absolute);
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      audio[frame] = static_cast<float>(stimulus[absolute + frame]);
      audio[count + frame] = audio[frame];
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, count);
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      captured[absolute + frame] = static_cast<double>(audio[frame]);
    }
    absolute += count;
  }
}

struct ModeQuality {
  double correlation = 0.0;
  double outputRms = 0.0;
};

ModeQuality gradeMode(const std::vector<double> &stimulus, const std::vector<double> &captured,
                      std::uint32_t latency, std::uint32_t settle) {
  double cross = 0.0;
  double inputEnergy = 0.0;
  double outputEnergy = 0.0;
  std::size_t count = 0u;
  for (std::size_t index = latency + settle; index < captured.size(); ++index) {
    const double reference = stimulus[index - latency];
    const double value = captured[index];
    cross += reference * value;
    inputEnergy += reference * reference;
    outputEnergy += value * value;
    ++count;
  }
  ModeQuality quality;
  const double denominator = std::sqrt(inputEnergy * outputEnergy);
  quality.correlation = denominator > 0.0 ? cross / denominator : 0.0;
  quality.outputRms = count == 0u ? 0.0 : std::sqrt(outputEnergy / static_cast<double>(count));
  return quality;
}

double modeDistance(const std::vector<double> &first, const std::vector<double> &second,
                    std::uint32_t from) {
  double energy = 0.0;
  std::size_t count = 0u;
  for (std::size_t index = from; index < first.size(); ++index) {
    const double difference = first[index] - second[index];
    energy += difference * difference;
    ++count;
  }
  return count == 0u ? 0.0 : std::sqrt(energy / static_cast<double>(count));
}

std::vector<double> qualityStimulus(std::uint32_t rate, std::uint32_t total) {
  std::vector<double> stimulus(total, 0.0);
  Random random(0x5F2A91C7u ^ rate);
  double phase = 0.0;
  for (std::uint32_t index = 0u; index < total; ++index) {
    const double sweep = 220.0 + 2200.0 * static_cast<double>(index % 8192u) / 8192.0;
    phase += 6.2831853071795865 * sweep / static_cast<double>(rate);
    stimulus[index] = 0.45 * std::sin(phase) + 0.05 * random.bipolar();
  }
  return stimulus;
}

// The three modes have to be three different codecs: each one has to reproduce
// the input (so the wiring is real and not silence), and the pairwise difference
// has to be far above the numerical noise floor (so LP2 and LP4 are not quietly
// running the SP core, which is what Phase 1 shipped).
void testModesAreDistinct() {
  constexpr std::uint32_t kRate = 44100u;
  constexpr std::uint32_t kTotal = 65536u;
  const std::vector<double> stimulus = qualityStimulus(kRate, kTotal);
  std::array<std::vector<double>, 3u> captured{};
  std::array<std::uint32_t, 3u> latency{};
  for (std::size_t index = 0u; index < kModes.size(); ++index) {
    captureMode(kRate, kModes[index], stimulus, captured[index], latency[index]);
    check(latency[index] == latency[0], "the declared latency is not shared by all modes");
    const ModeQuality quality = gradeMode(stimulus, captured[index], latency[index], 8192u);
    if (quality.correlation < 0.9 || quality.outputRms < 0.1) {
      std::fprintf(stderr, "MD Simulator %s: correlation %.4f, output rms %.4f\n",
                   kModeNames[index], quality.correlation, quality.outputRms);
    }
    check(quality.correlation > 0.9, "a mode does not reproduce its input");
    check(quality.outputRms > 0.1, "a mode produced a nearly silent output");
  }
  const std::uint32_t from = latency[0] + 8192u;
  const double spToLp2 = modeDistance(captured[0], captured[1], from);
  const double spToLp4 = modeDistance(captured[0], captured[2], from);
  const double lp2ToLp4 = modeDistance(captured[1], captured[2], from);
  if (spToLp2 < 1.0e-3 || spToLp4 < 1.0e-3 || lp2ToLp4 < 1.0e-3) {
    std::fprintf(stderr, "MD Simulator mode distances: SP-LP2 %.6f, SP-LP4 %.6f, LP2-LP4 %.6f\n",
                 spToLp2, spToLp4, lp2ToLp4);
  }
  check(spToLp2 > 1.0e-3, "LP2 is indistinguishable from SP");
  check(spToLp4 > 1.0e-3, "LP4 is indistinguishable from SP");
  check(lp2ToLp4 > 1.0e-3, "LP4 is indistinguishable from LP2");
  // Lower bit rates have to cost quality, otherwise the allocator is not honouring
  // the mode budget.
  check(spToLp4 > spToLp2, "LP4 is not further from SP than LP2 is");
}

// Switching md is a structural change: the two cores keep separate transform
// history and the ATRAC3 codec drops its state.  The switch may only happen on a
// window boundary, so the output queue must never run dry or overflow across it,
// and the stream has to stay bounded.
void testModeSwitching() {
  for (const std::uint32_t rate : {44100u, 96000u, 384000u}) {
    KernelHarness harness(static_cast<float>(rate), 2u);
    check(harness.ready(), "mode switching kernel prepares");
    if (!harness.ready()) {
      continue;
    }
    // Deliberately not a multiple of the 1024 sample coding window, so the mode
    // change lands in the middle of a window and has to be deferred.
    constexpr std::uint32_t kBlock = 373u;
    std::vector<float> audio(2u * kBlock, 0.0F);
    // SP, LP2, LP4, LP2, SP, LP4, SP ... every ordered transition is exercised.
    constexpr std::array<float, 8u> kSequence = {0.0F, 1.0F, 2.0F, 1.0F, 0.0F, 2.0F, 0.0F, 1.0F};
    const std::uint32_t blocksPerStep = rate / (4u * kBlock) + 1u;
    for (std::size_t step = 0u; step < kSequence.size(); ++step) {
      Params params = modeParams(kSequence[step]);
      for (std::uint32_t block = 0u; block < blocksPerStep; ++block) {
        for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
          const double t = static_cast<double>(block * kBlock + frame);
          audio[frame] = static_cast<float>(0.6 * std::sin(t * 0.0271));
          audio[kBlock + frame] = static_cast<float>(0.6 * std::cos(t * 0.0193));
        }
        harness.stage(params);
        harness.process(audio.data(), 2u, kBlock);
        for (std::uint32_t index = 0u; index < 2u * kBlock; ++index) {
          check(std::isfinite(audio[index]), "a mode switch produced a non finite sample");
          check(std::fabs(audio[index]) < 8.0, "a mode switch made the output diverge");
        }
      }
      md::KernelDiagnostic diagnostic{};
      check(harness.diagnostic(diagnostic), "mode switching diagnostic is available");
      check(diagnostic.activeMode == static_cast<std::uint32_t>(kSequence[step] + 0.5F),
            "the codec did not follow the md parameter across a switch");
      check(diagnostic.outputUnderflows == 0u, "the output queue ran dry across a mode switch");
      check(diagnostic.outputOverflows == 0u, "the output queue overflowed across a mode switch");
      if (kSequence[step] > 0.5F) {
        check(diagnostic.lpBudgetBits == expectedBudgetBits(kSequence[step], 2u),
              "the frame budget did not follow the md parameter");
        check(diagnostic.lpFrameBits <= diagnostic.lpBudgetBits,
              "a frame exceeded its budget after a mode switch");
      }
    }
  }
}

// LP4 is joint stereo with a shared pair budget, so the mono path is a different
// configuration rather than the same one run twice.  A channel count change has
// to reconfigure it on a window boundary and reset cleanly.
void testLpMonoAndChannelChange() {
  KernelHarness harness(44100.0F, 4u);
  check(harness.ready(), "LP multi channel kernel prepares");
  if (!harness.ready()) {
    return;
  }
  constexpr std::uint32_t kBlock = 256u;
  std::vector<float> audio(4u * kBlock, 0.0F);
  for (const float mode : {1.0F, 2.0F}) {
    Params params = modeParams(mode);
    for (std::uint32_t block = 0u; block < 300u; ++block) {
      for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
        const double t = static_cast<double>(block * kBlock + frame);
        audio[frame] = static_cast<float>(0.5 * std::sin(t * 0.019));
      }
      harness.stage(params);
      harness.process(audio.data(), 1u, kBlock);
      for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
        check(std::isfinite(audio[frame]), "LP mono output is not finite");
        check(std::fabs(audio[frame]) < 8.0, "LP mono output diverged");
      }
    }
    md::KernelDiagnostic mono{};
    check(harness.diagnostic(mono), "LP mono diagnostic is available");
    check(mono.activeChannels == 1u, "LP mono run did not switch the codec to one channel");
    check(mono.lpBudgetBits == expectedBudgetBits(mode, 1u),
          "the LP mono frame budget is not the mono operating point");
    check(mono.lpFrameBits > 0u && mono.lpFrameBits <= mono.lpBudgetBits,
          "the LP mono frame does not fit its budget");

    for (std::uint32_t block = 0u; block < 300u; ++block) {
      for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
        const double t = static_cast<double>(block * kBlock + frame);
        for (std::uint32_t channel = 0u; channel < 4u; ++channel) {
          audio[channel * kBlock + frame] =
              static_cast<float>(0.11 * static_cast<double>(channel + 1u) * std::sin(t * 0.013));
        }
      }
      std::vector<float> expected(audio.begin() + 2 * kBlock, audio.begin() + 4 * kBlock);
      harness.stage(params);
      harness.process(audio.data(), 4u, kBlock);
      for (std::uint32_t index = 0u; index < 2u * kBlock; ++index) {
        check(audio[2u * kBlock + index] == expected[index],
              "an extra channel was not passed through untouched in an LP mode");
        check(std::isfinite(audio[index]), "LP stereo output is not finite after a channel change");
      }
    }
    md::KernelDiagnostic stereo{};
    check(harness.diagnostic(stereo), "LP stereo diagnostic is available");
    check(stereo.activeChannels == 2u, "LP run did not switch the codec back to two channels");
    check(stereo.lpBudgetBits == expectedBudgetBits(mode, 2u),
          "the LP stereo frame budget did not follow the channel count");
  }
}

// reset-on-resume for the ATRAC3 modes: the overlap-add history, the gain control
// reference and the half filled coding window all have to be dropped, so a
// resumed silent stream must be silent.
void testLpResetOnResume() {
  for (const float mode : {1.0F, 2.0F}) {
    KernelHarness harness(96000.0F, 2u);
    check(harness.ready(), "LP reset kernel prepares");
    if (!harness.ready()) {
      continue;
    }
    Params params = modeParams(mode);
    constexpr std::uint32_t kBlock = 480u;
    std::vector<float> audio(2u * kBlock, 0.0F);
    for (std::uint32_t block = 0u; block < 200u; ++block) {
      for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
        const double t = static_cast<double>(block * kBlock + frame);
        audio[frame] = static_cast<float>(0.9 * std::sin(t * 0.037));
        audio[kBlock + frame] = static_cast<float>(0.9 * std::cos(t * 0.041));
      }
      harness.stage(params);
      harness.process(audio.data(), 2u, kBlock);
    }
    // A partial block leaves the coding window half full.
    std::fill(audio.begin(), audio.end(), 0.9F);
    harness.stage(params);
    harness.process(audio.data(), 2u, 137u);

    harness.reset();

    md::KernelDiagnostic afterReset{};
    check(harness.diagnostic(afterReset), "LP diagnostic after reset");
    check(afterReset.completedUnits == 0u, "reset did not clear the LP window counter");
    check(afterReset.lpFrameBits == 0u, "reset did not clear the LP frame accounting");

    double worst = 0.0;
    for (std::uint32_t block = 0u; block < 40u; ++block) {
      std::fill(audio.begin(), audio.end(), 0.0F);
      harness.stage(params);
      harness.process(audio.data(), 2u, kBlock);
      for (const float value : audio) {
        worst = std::max(worst, std::fabs(static_cast<double>(value)));
      }
    }
    check(worst < 1.0e-6, "LP audio from before the reset leaked into the resumed stream");

    md::KernelDiagnostic resumed{};
    check(harness.diagnostic(resumed), "LP diagnostic after resume");
    check(resumed.outputUnderflows == 0u, "the output queue ran dry after an LP reset");
    check(resumed.outputOverflows == 0u, "the output queue overflowed after an LP reset");
  }
}

void testHostileInput() {
  KernelHarness harness(48000.0F, 2u);
  check(harness.ready(), "hostile input kernel prepares");
  if (!harness.ready()) {
    return;
  }
  Params params = defaultParams();
  constexpr std::uint32_t kBlock = 256u;
  std::vector<float> audio(2u * kBlock, 0.0F);
  const std::array<float, 6u> poison = {std::numeric_limits<float>::quiet_NaN(),
                                        std::numeric_limits<float>::infinity(),
                                        -std::numeric_limits<float>::infinity(),
                                        std::numeric_limits<float>::denorm_min(),
                                        1.0e12F,
                                        -1.0e12F};
  for (std::uint32_t block = 0u; block < 200u; ++block) {
    for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
      const float value = poison[(block + frame) % poison.size()];
      audio[frame] = value;
      audio[kBlock + frame] = value;
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, kBlock);
    for (std::uint32_t index = 0u; index < 2u * kBlock; ++index) {
      check(std::isfinite(audio[index]), "hostile input produced a non finite output");
    }
  }
  // The first blocks of any phase still flush the content that is legitimately
  // in flight (one codec delay plus the resampler ring), so they are not part of
  // the steady state assertions below.
  constexpr std::uint32_t kFlushBlocks = 40u;

  // Sustained over-range but finite input.  Every check above is satisfied by a
  // codec that quietly turns the spectrum into zeros - silence is finite and
  // bounded - which is what a rounding path that saturates to zero instead of to
  // the largest quantiser step does to every band whose scale factor has run out
  // of range.  Assert that signal still comes out.
  double overRangePeak = 0.0;
  for (std::uint32_t block = 0u; block < 120u; ++block) {
    for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
      const std::uint32_t position = block * kBlock + frame;
      // A 1 kHz square at 48 kHz: in band, so no band of the codec sees silence.
      const float value = (((position / 24u) % 2u) == 0u) ? 1.0e12F : -1.0e12F;
      audio[frame] = value;
      audio[kBlock + frame] = value;
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, kBlock);
    for (std::uint32_t index = 0u; index < 2u * kBlock; ++index) {
      check(std::isfinite(audio[index]), "over range input produced a non finite output");
      if (block >= kFlushBlocks) {
        overRangePeak = std::max(overRangePeak, static_cast<double>(std::fabs(audio[index])));
      }
    }
  }
  check(overRangePeak > 1.0, "the codec collapsed to silence on sustained over range input");

  // Recovery: after the poison, ordinary audio must come back through unharmed.
  for (std::uint32_t block = 0u; block < 200u; ++block) {
    for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
      const double t = static_cast<double>(block * kBlock + frame);
      audio[frame] = static_cast<float>(0.4 * std::sin(t * 0.021));
      audio[kBlock + frame] = audio[frame];
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, kBlock);
    for (std::uint32_t index = 0u; index < 2u * kBlock; ++index) {
      check(std::isfinite(audio[index]), "the kernel did not recover from hostile input");
      if (block >= kFlushBlocks) {
        check(std::fabs(audio[index]) < 8.0,
              "the kernel did not settle back to a bounded output after hostile input");
      }
    }
  }
}

void testMonoAndExtraChannels() {
  KernelHarness harness(44100.0F, 4u);
  check(harness.ready(), "multi channel kernel prepares");
  if (!harness.ready()) {
    return;
  }
  Params params = defaultParams();
  constexpr std::uint32_t kBlock = 256u;
  std::vector<float> audio(4u * kBlock, 0.0F);

  for (std::uint32_t block = 0u; block < 300u; ++block) {
    for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
      const double t = static_cast<double>(block * kBlock + frame);
      audio[frame] = static_cast<float>(0.5 * std::sin(t * 0.019));
    }
    harness.stage(params);
    harness.process(audio.data(), 1u, kBlock);
    for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
      check(std::isfinite(audio[frame]), "mono output is not finite");
    }
  }
  md::KernelDiagnostic mono{};
  check(harness.diagnostic(mono), "mono diagnostic is available");
  check(mono.activeChannels == 1u, "mono run did not switch the codec to one channel");
  check(mono.completedUnits > 0u, "mono run completed no sound unit");

  // Four channels: the first two are processed, the extras pass through byte for
  // byte.  A channel count change also has to reset cleanly.
  for (std::uint32_t block = 0u; block < 300u; ++block) {
    std::array<float, 4u> marker{};
    for (std::uint32_t channel = 0u; channel < 4u; ++channel) {
      marker[channel] = static_cast<float>(0.11 * static_cast<double>(channel + 1u));
    }
    for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
      const double t = static_cast<double>(block * kBlock + frame);
      for (std::uint32_t channel = 0u; channel < 4u; ++channel) {
        audio[channel * kBlock + frame] = static_cast<float>(marker[channel] * std::sin(t * 0.013));
      }
    }
    std::vector<float> expected(audio.begin() + 2 * kBlock, audio.begin() + 4 * kBlock);
    harness.stage(params);
    harness.process(audio.data(), 4u, kBlock);
    for (std::uint32_t index = 0u; index < 2u * kBlock; ++index) {
      check(audio[2u * kBlock + index] == expected[index],
            "an extra channel was not passed through untouched");
    }
    for (std::uint32_t index = 0u; index < 2u * kBlock; ++index) {
      check(std::isfinite(audio[index]), "stereo output is not finite after a channel change");
    }
  }
  md::KernelDiagnostic stereo{};
  check(harness.diagnostic(stereo), "stereo diagnostic is available");
  check(stereo.activeChannels == 2u, "extra channel run did not switch the codec to two channels");
}

void testResetOnResume() {
  KernelHarness harness(96000.0F, 2u);
  check(harness.ready(), "reset kernel prepares");
  if (!harness.ready()) {
    return;
  }
  Params params = defaultParams();
  constexpr std::uint32_t kBlock = 480u;
  std::vector<float> audio(2u * kBlock, 0.0F);

  // Fill the pipeline with loud audio, stop mid sound unit, then reset.
  for (std::uint32_t block = 0u; block < 200u; ++block) {
    for (std::uint32_t frame = 0u; frame < kBlock; ++frame) {
      const double t = static_cast<double>(block * kBlock + frame);
      audio[frame] = static_cast<float>(0.9 * std::sin(t * 0.037));
      audio[kBlock + frame] = static_cast<float>(0.9 * std::cos(t * 0.041));
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, kBlock);
  }
  // A partial block leaves the unit accumulator half full.
  std::fill(audio.begin(), audio.end(), 0.9F);
  harness.stage(params);
  harness.process(audio.data(), 2u, 137u);

  harness.reset();

  md::KernelDiagnostic afterReset{};
  check(harness.diagnostic(afterReset), "diagnostic after reset");
  check(afterReset.completedUnits == 0u, "reset did not clear the sound unit counter");

  double worst = 0.0;
  for (std::uint32_t block = 0u; block < 40u; ++block) {
    std::fill(audio.begin(), audio.end(), 0.0F);
    harness.stage(params);
    harness.process(audio.data(), 2u, kBlock);
    for (const float value : audio) {
      worst = std::max(worst, std::fabs(static_cast<double>(value)));
    }
  }
  check(worst < 1.0e-6, "audio from before the reset leaked into the resumed stream");

  md::KernelDiagnostic resumed{};
  check(harness.diagnostic(resumed), "diagnostic after resume");
  check(resumed.outputUnderflows == 0u, "the output queue ran dry after a reset");
}

void testGainAndMix() {
  KernelHarness harness(44100.0F, 2u);
  check(harness.ready(), "gain kernel prepares");
  if (!harness.ready()) {
    return;
  }
  Params params = defaultParams();
  params.mix = 0.0F;
  params.outputGain = -6.0F;
  const double expectedGain = std::pow(10.0, -6.0 / 20.0);
  const std::uint32_t latency = harness.latency();
  constexpr std::uint32_t kBlock = 512u;
  const std::uint32_t total = latency + 8192u;
  std::vector<float> audio(2u * kBlock, 0.0F);
  std::vector<float> captured(total, 0.0F);
  std::uint32_t absolute = 0u;
  while (absolute < total) {
    const std::uint32_t count = std::min<std::uint32_t>(kBlock, total - absolute);
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      audio[frame] = 0.5F;
      audio[count + frame] = 0.5F;
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, count);
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      captured[absolute + frame] = audio[frame];
    }
    absolute += count;
  }
  for (std::uint32_t index = latency + 4096u; index < total; ++index) {
    check(std::fabs(static_cast<double>(captured[index]) - 0.5 * expectedGain) < 1.0e-5,
          "output gain is not applied as a linear dB law");
  }
}

void printLatencyTable() {
  for (std::size_t modeIndex = 0u; modeIndex < kModes.size(); ++modeIndex) {
    for (const std::uint32_t rate : kHostRates) {
      std::uint32_t peakIndex = 0u;
      double peakValue = 0.0;
      const std::uint32_t declared =
          measureWetLatency(rate, kModes[modeIndex], peakIndex, peakValue);
      std::uint32_t declaredAgain = 0u;
      const std::uint32_t aligned = measureWetAlignment(rate, kModes[modeIndex], declaredAgain);
      std::printf("%s\t%u\tdeclared=%u\tpeak=%u\taligned=%u\tamplitude=%.6f\n",
                  kModeNames[modeIndex], rate, declared, peakIndex, aligned, peakValue);
    }
  }
}

} // namespace

int main(int argc, char **argv) {
#if defined(_MSC_VER) && defined(_DEBUG)
  _CrtSetReportMode(_CRT_WARN, _CRTDBG_MODE_FILE);
  _CrtSetReportFile(_CRT_WARN, _CRTDBG_FILE_STDERR);
  _CrtSetReportMode(_CRT_ERROR, _CRTDBG_MODE_FILE);
  _CrtSetReportFile(_CRT_ERROR, _CRTDBG_FILE_STDERR);
  _CrtSetReportMode(_CRT_ASSERT, _CRTDBG_MODE_FILE);
  _CrtSetReportFile(_CRT_ASSERT, _CRTDBG_FILE_STDERR);
  _set_abort_behavior(0u, _WRITE_ABORT_MSG | _CALL_REPORTFAULT);
#endif
  if (argc == 2 && std::string_view(argv[1]) == "--print-latency") {
    printLatencyTable();
    return 0;
  }
  testScaleFactorTable();
  testBfuGeometry();
  testMdctReference();
  testQmfPerfectReconstruction();
  testTransparentRoundTrip();
  testAtrac3TransparentRoundTrip();
  testAtrac3StereoBudgetIsolation();
  testBitBudgetAndAdapter();
  testQuantizationRoundTrip();
  testAllRatesFunctionalSafety();
  testWetLatencyMatchesDeclaration();
  testDryLatencyAlignment();
  testVariableBlockSizes();
  testHostileInput();
  testMonoAndExtraChannels();
  testResetOnResume();
  testGainAndMix();
  testModesAreDistinct();
  testModeSwitching();
  testLpMonoAndChannelChange();
  testLpResetOnResume();
  return failures == 0 ? 0 : 1;
}

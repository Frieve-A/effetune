#include "diagnostic.h"
#include "mp3_core.h"

#include "MP3CodecSimulatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <limits>
#include <numbers>
#include <string_view>
#include <vector>

#if defined(_MSC_VER) && defined(_DEBUG)
#include <crtdbg.h>
#endif

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_MP3CodecSimulatorPlugin() noexcept;

namespace {

namespace mp3 = effetune::plugins::lofi::mp3;
using Params = effetune::generated::MP3CodecSimulatorPluginParams;

constexpr std::uint32_t kMaximumFrames = 257u;
constexpr std::size_t kKernelStorageBytes = 65536u;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "MP3 Codec Simulator check failed: %s\n", message);
    ++failures;
  }
}

bool closeEnough(float first, float second, float tolerance = 1.0e-5F) noexcept {
  const float difference = first > second ? first - second : second - first;
  return difference <= tolerance;
}

void testProfilePolicies() {
  constexpr std::array<std::uint32_t, 12u> mpeg1_cutoffs = {287u, 352u, 417u, 470u, 522u, 522u,
                                                            522u, 522u, 522u, 522u, 522u, 522u};
  constexpr std::array<std::uint32_t, 9u> mpeg2_cutoffs = {391u, 470u, 522u, 548u, 548u,
                                                           548u, 548u, 548u, 548u};
  constexpr std::array<std::uint32_t, 12u> mpeg1_long_bands = {19u, 21u, 21u, 22u, 22u, 22u,
                                                               22u, 22u, 22u, 22u, 22u, 22u};
  constexpr std::array<std::uint32_t, 9u> mpeg2_long_bands = {19u, 21u, 22u, 22u, 22u,
                                                              22u, 22u, 22u, 22u};
  constexpr std::array<std::uint32_t, 12u> short_bands = {11u, 12u, 13u, 13u, 13u, 13u,
                                                          13u, 13u, 13u, 13u, 13u, 13u};
  constexpr std::array<float, 12u> nmr = {6.0F,  3.0F,  0.0F,  -1.5F, -3.0F, -4.0F,
                                          -5.0F, -6.0F, -7.0F, -8.0F, -9.0F, -10.0F};

  for (std::uint32_t index = 0u; index < 12u; ++index) {
    const mp3::ProfilePolicy mpeg1 = mp3::profilePolicy(mp3::Profile::Mpeg1, index);
    check(mpeg1.sampleRate == 44100u && mpeg1.frameSamples == 1152u && mpeg1.granules == 2u,
          "MPEG-1 profile shape differs from the standard family");
    check(mpeg1.cutoffLine == mpeg1_cutoffs[index] &&
              mpeg1.shortCutoffLine == mpeg1_cutoffs[index] / 3u,
          "MPEG-1 cutoff derivation is incorrect");
    check(mpeg1.activeLongBands == mpeg1_long_bands[index] &&
              mpeg1.activeShortBands == short_bands[index],
          "MPEG-1 scale-factor band derivation is incorrect");
    check(mpeg1.initialNmrDb == nmr[index], "MPEG-1 NMR policy is incorrect");

    const mp3::ProfilePolicy mpeg2 = mp3::profilePolicy(mp3::Profile::Mpeg2Lsf, index);
    const std::uint32_t clamped_index = index < 8u ? index : 7u;
    check(mpeg2.sampleRate == 22050u && mpeg2.frameSamples == 576u && mpeg2.granules == 1u,
          "MPEG-2 profile shape differs from the standard family");
    check(mpeg2.bitrateKbps == mp3::kBitratesKbps[clamped_index],
          "MPEG-2 bitrate did not clamp to 160 kbit/s");
    check(mpeg2.cutoffLine == mpeg2_cutoffs[clamped_index] &&
              mpeg2.shortCutoffLine == mpeg2_cutoffs[clamped_index] / 3u,
          "MPEG-2 cutoff derivation is incorrect");
    check(mpeg2.activeLongBands == mpeg2_long_bands[clamped_index] &&
              mpeg2.activeShortBands == short_bands[clamped_index],
          "MPEG-2 scale-factor band derivation is incorrect");
  }
}

void testBlockSwitchOracle() {
  mp3::BlockType state = mp3::BlockType::Long;
  state = mp3::nextBlockType(state, false, true);
  check(state == mp3::BlockType::Start, "attack did not select a START block");
  state = mp3::nextBlockType(state, true, false);
  check(state == mp3::BlockType::Short, "START was not followed by a SHORT block");
  state = mp3::nextBlockType(state, false, false);
  check(state == mp3::BlockType::Stop, "SHORT did not transition to STOP");
  state = mp3::nextBlockType(state, false, false);
  check(state == mp3::BlockType::Long, "STOP did not return to LONG");

  state = mp3::nextBlockType(mp3::BlockType::Start, true, true);
  state = mp3::nextBlockType(state, true, true);
  check(state == mp3::BlockType::Short, "continued attack did not retain the SHORT block state");

  // Back-to-back attacks: the trailing attack granule must itself stay SHORT
  // even though the lookahead granule carries no further attack.
  state = mp3::BlockType::Long;
  state = mp3::nextBlockType(state, false, true);
  check(state == mp3::BlockType::Start, "leading attack did not arm the window switch");
  state = mp3::nextBlockType(state, true, true);
  check(state == mp3::BlockType::Short, "first attack granule was not SHORT");
  state = mp3::nextBlockType(state, true, false);
  check(state == mp3::BlockType::Short,
        "trailing attack of a consecutive transient run lost its SHORT window");
  state = mp3::nextBlockType(state, false, false);
  check(state == mp3::BlockType::Stop, "attack run did not close with a STOP window");
}

void testFrameBudgets() {
  struct Fixture final {
    mp3::Profile profile;
    std::uint32_t bitrate;
    std::uint32_t channels;
    bool reservoir;
  };
  constexpr std::array<Fixture, 4u> fixtures = {Fixture{mp3::Profile::Mpeg1, 32u, 1u, false},
                                                Fixture{mp3::Profile::Mpeg1, 64u, 2u, true},
                                                Fixture{mp3::Profile::Mpeg2Lsf, 32u, 1u, true},
                                                Fixture{mp3::Profile::Mpeg2Lsf, 64u, 2u, false}};

  for (const Fixture &fixture : fixtures) {
    mp3::FrameBudgetState state;
    bool saw_unpadded = false;
    bool saw_padded = false;
    for (std::uint32_t frame = 0u; frame < 4u; ++frame) {
      mp3::FrameBudget budget =
          state.beginFrame(fixture.profile, fixture.bitrate, fixture.channels, fixture.reservoir);
      const std::uint32_t sample_rate = fixture.profile == mp3::Profile::Mpeg1 ? 44100u : 22050u;
      const std::uint32_t coefficient = fixture.profile == mp3::Profile::Mpeg1 ? 144u : 72u;
      const std::uint64_t numerator =
          static_cast<std::uint64_t>(coefficient) * fixture.bitrate * 1000u;
      check(budget.frameBytes == numerator / sample_rate + budget.paddingSlotBytes,
            "frameBytes does not match the CBR formula");
      check(budget.physicalMainDataAreaBits ==
                budget.frameBytes * 8u - budget.headerBits - budget.sideInfoBits,
            "physical main-data capacity is incorrect");
      check(budget.mainDataBegin == budget.reservoirBeforeBits / 8u,
            "main_data_begin does not match the byte reservoir cursor");
      if (!fixture.reservoir) {
        check(budget.mainDataBegin == 0u && budget.reservoirBeforeBits == 0u,
              "reservoir-off frame retained prior credit");
      } else if (frame != 0u) {
        check(budget.mainDataBegin > 0u, "reservoir-on sequence never used prior credit");
      }
      state.commitFrame(fixture.profile, budget, 0u);
      check(budget.valid, "zero-length diagnostic ADU exceeded its frame budget");
      check(budget.ancillaryBits + budget.reservoirAfterBits ==
                budget.physicalMainDataAreaBits + budget.reservoirBeforeBits,
            "main data, reservoir, and ancillary accounting do not balance");
      saw_unpadded = saw_unpadded || budget.paddingSlotBytes == 0u;
      saw_padded = saw_padded || budget.paddingSlotBytes == 1u;
    }
    check(saw_unpadded && saw_padded,
          "four-frame diagnostic sequence does not cover both padding states");
  }

  mp3::FrameBudgetState state;
  mp3::FrameBudget invalid = state.beginFrame(mp3::Profile::Mpeg1, 32u, 1u, false);
  state.commitFrame(mp3::Profile::Mpeg1, invalid, invalid.physicalMainDataAreaBits + 1u);
  check(!invalid.valid, "reservoir-off over-budget ADU was accepted");
}

void testHuffmanLengthOracle() {
  const std::uint32_t invalid = std::numeric_limits<std::uint32_t>::max();
  check(mp3::huffmanPairLength(0u, 0, 0) == 0u,
        "Huffman table 0 did not encode a zero pair with zero bits");
  check(mp3::huffmanPairLength(0u, 1, 0) == invalid, "Huffman table 0 accepted a non-zero pair");
  check(mp3::huffmanPairLength(1u, 0, 0) == 1u && mp3::huffmanPairLength(1u, 0, -1) == 4u &&
            mp3::huffmanPairLength(1u, 1, 0) == 3u && mp3::huffmanPairLength(1u, -1, 1) == 5u,
        "Huffman table 1 code and sign lengths differ from the independent oracle");
  check(mp3::huffmanPairLength(2u, 2, -2) == 8u && mp3::huffmanPairLength(3u, -1, 1) == 4u,
        "Huffman table 2/3 sentinel lengths are incorrect");
  check(mp3::huffmanPairLength(15u, 15, -15) == 15u,
        "Huffman table 15 differs from the ISO Annex B oracle");
  check(mp3::huffmanPairLength(16u, 16, 0) == 11u,
        "Huffman table 16 linbits differ from the ISO Annex B oracle");
  check(mp3::huffmanPairLength(23u, 8191, -15) == 36u,
        "Huffman table 23 linbits differ from the ISO Annex B oracle");
  check(mp3::huffmanPairLength(23u, 8207, 0) == invalid,
        "Huffman table 23 accepted a magnitude above its ISO range");

  std::array<std::int32_t, mp3::kGranuleSamples> values{};
  mp3::HuffmanRegions empty =
      mp3::selectHuffmanRegions(values.data(), mp3::Profile::Mpeg1, mp3::BlockType::Long, 417u);
  check(empty.bigValues == 0u && empty.totalBits() == 0u,
        "all-zero spectrum consumed Huffman bits");
  values[0u] = 1;
  mp3::HuffmanRegions one_pair =
      mp3::selectHuffmanRegions(values.data(), mp3::Profile::Mpeg1, mp3::BlockType::Long, 417u);
  check(one_pair.bigValues == 0u && one_pair.count1 == 1u && one_pair.totalBits() == 5u,
        "single non-zero value did not use the exact count1 partition");
  values[0u] = 300;
  values[1u] = -17;
  mp3::HuffmanRegions escape =
      mp3::selectHuffmanRegions(values.data(), mp3::Profile::Mpeg1, mp3::BlockType::Long, 417u);
  check(escape.bigValues == 1u && escape.totalBits() != invalid && escape.tableSelect[0u] >= 16u,
        "large quantized pair did not select a finite escape table");

  // big_values_end == 2 (mod 4) with non-zero |q|<=1 lines up to the very top of
  // the granule: the count1 quad run cannot be aligned inside the 576-line array,
  // so the ragged pair must be absorbed into big_values (regression for the
  // heap out-of-bounds read and the count1 accounting mismatch).
  //
  // The two ragged cases below deliberately use cutoff line 575, which no production
  // policy ever selects: the cutoff tables top out at 522 (MPEG-1) and 548 (MPEG-2 LSF),
  // so used_lines never exceeds 549 and count1_end never exceeds 552. The
  // count1_end > kGranuleSamples branch they exercise is therefore a defensive
  // invariant, kept so that any future widening of the cutoff tables cannot
  // reintroduce the out-of-bounds partition. The production-maximum boundary case that
  // must *not* take that branch is asserted after them.
  values.fill(0);
  values[573u] = 2;
  values[574u] = 1;
  values[575u] = -1;
  mp3::HuffmanRegions ragged =
      mp3::selectHuffmanRegions(values.data(), mp3::Profile::Mpeg1, mp3::BlockType::Long, 575u);
  check(ragged.bigValues == 288u && ragged.count1 == 0u && ragged.count1Bits == 0u &&
            ragged.totalBits() != invalid,
        "mod-4 ragged top-of-granule partition was not folded into big_values");
  values.fill(0);
  values[569u] = 2;
  values[575u] = 1;
  mp3::HuffmanRegions ragged_gap =
      mp3::selectHuffmanRegions(values.data(), mp3::Profile::Mpeg1, mp3::BlockType::Long, 575u);
  check(ragged_gap.bigValues == 286u && ragged_gap.count1 == 1u &&
            ragged_gap.totalBits() != invalid,
        "mod-4 ragged partition with a trailing count1 quad was mispartitioned");

  // Production maximum: MPEG-2 LSF cutoff line 548 is the widest any policy selects, so
  // used_lines tops out at 549 and count1_end at 552. With a big_values run ending at
  // 546 and a lone |q| == 1 line at 548 the partition ends at line 550, comfortably
  // inside the 576-line array, and the defensive fold above must stay untaken.
  values.fill(0);
  values[545u] = 2;
  values[548u] = 1;
  mp3::HuffmanRegions boundary =
      mp3::selectHuffmanRegions(values.data(), mp3::Profile::Mpeg2Lsf, mp3::BlockType::Long, 548u);
  check(boundary.bigValues == 273u && boundary.count1 == 1u &&
            boundary.bigValues * 2u + boundary.count1 * 4u == 550u && boundary.count1Bits != 0u &&
            boundary.totalBits() != invalid,
        "production-maximum cutoff mispartitioned the top of the granule");
}

void testFrameMidSideCompatibility() {
  mp3::LogicalFrame frame;
  frame.channels = 2u;
  frame.granules = 2u;
  frame.data[0u][0u].blockType = mp3::BlockType::Long;
  frame.data[0u][1u].blockType = mp3::BlockType::Long;
  frame.data[1u][0u].blockType = mp3::BlockType::Short;
  frame.data[1u][1u].blockType = mp3::BlockType::Long;
  check(!mp3::midSideBlockTypesCompatible(frame),
        "second-granule one-sided transient incorrectly allowed frame M/S");
  frame.data[1u][1u].blockType = mp3::BlockType::Short;
  check(mp3::midSideBlockTypesCompatible(frame),
        "matching block types across both granules did not allow frame M/S");
}

void testLogicalDecodeOracle() {
  mp3::GranuleChannel silence;
  std::array<float, mp3::kGranuleSamples> silent_spectrum{};
  mp3::decodeLogicalSpectrum(silence, mp3::Profile::Mpeg1, 575u, silent_spectrum.data());
  for (const float sample : silent_spectrum) {
    check(sample == 0.0F,
          "zero-length packed fixture disagrees with the logical decoder silence oracle");
  }

  mp3::GranuleChannel channel;
  channel.globalGain = 214u;
  channel.scalefactorCount = 3u;
  channel.scalefactors[0u] = 2u;
  channel.scalefactors[1u] = 0u;
  channel.scalefactors[2u] = 0u;
  channel.quantized[0u] = -8;
  channel.quantized[4u] = 1;
  channel.quantized[8u] = 27;
  std::array<float, mp3::kGranuleSamples> decoded{};
  mp3::decodeLogicalSpectrum(channel, mp3::Profile::Mpeg1, 8u, decoded.data());
  const float first = static_cast<float>(-std::pow(8.0, 4.0 / 3.0));
  const float second = 2.0F;
  const float third = static_cast<float>(std::pow(27.0, 4.0 / 3.0) * 2.0);
  check(closeEnough(decoded[0u], first) && closeEnough(decoded[4u], second) &&
            closeEnough(decoded[8u], third, 1.0e-3F),
        "logical decoder did not reconstruct the independent 4/3-power sentinels");
  check(decoded[9u] == 0.0F && decoded[575u] == 0.0F,
        "logical decoder emitted data above the selected cutoff");

  mp3::GranuleChannel short_channel;
  short_channel.blockType = mp3::BlockType::Short;
  short_channel.globalGain = 210u;
  short_channel.scalefactorCount = 36u;
  short_channel.scalefactors[0u] = 2u;
  short_channel.quantized[0u] = 1;
  short_channel.quantized[522u] = 1;
  std::array<float, mp3::kGranuleSamples> short_decoded{};
  mp3::decodeLogicalSpectrum(short_channel, mp3::Profile::Mpeg2Lsf, 575u, short_decoded.data());
  check(closeEnough(short_decoded[0u], 0.5F) && closeEnough(short_decoded[522u], 1.0F),
        "short terminal band reused the first transmitted scalefactor instead of implicit zero");

  std::array<float, mp3::kGranuleSamples> spectrum{};
  for (std::uint32_t index = 0u; index < spectrum.size(); ++index) {
    spectrum[index] = static_cast<float>(std::sin(static_cast<double>(index) * 0.071));
  }
  const auto original = spectrum;
  mp3::applyAliasReduction(spectrum.data(), false);
  mp3::applyAliasReduction(spectrum.data(), true);
  for (std::uint32_t index = 0u; index < spectrum.size(); ++index) {
    check(closeEnough(spectrum[index], original[index], 2.0e-6F),
          "alias-reduction inverse did not restore the original spectrum");
  }
}

Params defaultParams() noexcept { return {1.0F, 2.0F, 0.0F, 1.0F, 0.0F, 100.0F}; }

class KernelHarness final {
public:
  KernelHarness(float sample_rate, std::uint32_t channels) {
    descriptor_ = et_kernel_descriptor_MP3CodecSimulatorPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr || descriptor_->objectSize > storage_.size()) {
      return;
    }
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      check(descriptor_->paramsHash == Params::kHash, "descriptor parameter hash matches");
      kernel_->prepare({sample_rate, channels, kMaximumFrames});
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr)
      descriptor_->destroy(kernel_);
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
        kernel_->stageParameters(&params.codecRate, Params::kFloatCount, Params::kHash);
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

  [[nodiscard]] bool diagnostic(mp3::ProductionDiagnosticSnapshot &snapshot) const noexcept {
    return et_mp3_copy_production_diagnostic(kernel_, &snapshot);
  }

  [[nodiscard]] bool renderLogicalFrames(const mp3::LogicalFrame *frames, std::uint32_t frame_count,
                                         float *decoded_pcm) noexcept {
    return et_mp3_render_production_logical_frames(kernel_, frames, frame_count, decoded_pcm);
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

void processTone(KernelHarness &harness, const Params &params, std::uint32_t frames) {
  std::uint32_t absolute = 0u;
  while (absolute < frames) {
    const std::uint32_t count =
        frames - absolute < kMaximumFrames ? frames - absolute : kMaximumFrames;
    std::array<float, 2u * kMaximumFrames> audio{};
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      const double phase = static_cast<double>(absolute + frame) * 0.037;
      audio[frame] = static_cast<float>(0.63 * std::sin(phase));
      audio[count + frame] = static_cast<float>(0.51 * std::cos(phase * 1.17));
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, count);
    absolute += count;
  }
}

void testFrameControlFastPath() {
  KernelHarness harness(44100.0F, 2u);
  check(harness.ready(), "frame-control kernel prepares");
  if (!harness.ready()) {
    return;
  }
  Params params = defaultParams();
  processTone(harness, params, 5000u);
  mp3::ProductionDiagnosticSnapshot first{};
  check(harness.diagnostic(first), "production diagnostic captures a steady frame");
  processTone(harness, params, 5000u);
  mp3::ProductionDiagnosticSnapshot steady{};
  check(harness.diagnostic(steady), "production diagnostic captures a later steady frame");
  check(steady.completedFrames > first.completedFrames &&
            steady.resamplerBuildCount == first.resamplerBuildCount,
        "steady frame controls rebuilt resampler coefficients");

  params.bitrate = 3.0F;
  processTone(harness, params, 5000u);
  mp3::ProductionDiagnosticSnapshot bitrate{};
  check(harness.diagnostic(bitrate) && bitrate.resamplerBuildCount == steady.resamplerBuildCount,
        "bitrate-only change rebuilt resampler coefficients");

  // The 44.1 kHz host prepares only the MPEG-2 LSF rational stage pair; MPEG-1 runs
  // straight off the halfband cascade at the codec rate.
  check(first.resamplerBuildCount == 2u,
        "44.1 kHz host did not prepare exactly one rational stage pair");

  params.codecRate = 0.0F;
  processTone(harness, params, 5000u);
  mp3::ProductionDiagnosticSnapshot profile{};
  check(harness.diagnostic(profile) && profile.resamplerBuildCount == bitrate.resamplerBuildCount,
        "codec-rate change rebuilt resampler coefficients instead of switching stages");
}

void testPreparedResamplerStages() {
  // Both profile topologies are designed in prepare(), so a 48 kHz host holds two
  // rational stage pairs and a 44.1 kHz host only one.
  for (const float rate : {44100.0F, 88200.0F, 176400.0F, 352800.0F}) {
    KernelHarness harness(rate, 2u);
    Params params = defaultParams();
    processTone(harness, params, 60000u);
    mp3::ProductionDiagnosticSnapshot snapshot{};
    check(harness.diagnostic(snapshot) && snapshot.resamplerBuildCount == 2u,
          "44.1 kHz family host prepared an unexpected number of rational stages");
  }
  for (const float rate : {48000.0F, 96000.0F, 192000.0F, 384000.0F}) {
    KernelHarness harness(rate, 2u);
    Params params = defaultParams();
    processTone(harness, params, 60000u);
    mp3::ProductionDiagnosticSnapshot snapshot{};
    const bool available = harness.diagnostic(snapshot);
    if (!available || snapshot.resamplerBuildCount != 4u) {
      std::fprintf(stderr, "prepared stage detail rate=%.0f available=%d count=%u\n", rate,
                   available ? 1 : 0, snapshot.resamplerBuildCount);
    }
    check(available && snapshot.resamplerBuildCount == 4u,
          "48 kHz family host prepared an unexpected number of rational stages");
  }
}

void testCompletedDiagnosticSurvivesProfileBoundary() {
  KernelHarness harness(44100.0F, 2u);
  check(harness.ready(), "profile-boundary diagnostic kernel prepares");
  if (!harness.ready()) {
    return;
  }
  Params params = defaultParams();
  processTone(harness, params, 5000u);
  mp3::ProductionDiagnosticSnapshot before{};
  check(harness.diagnostic(before), "profile-boundary diagnostic captures a steady frame");
  if (before.completedFrames == 0u) {
    return;
  }

  params.codecRate = 0.0F;
  mp3::ProductionDiagnosticSnapshot boundary{};
  bool promoted = false;
  for (std::uint32_t attempt = 0u; attempt < 8u && !promoted; ++attempt) {
    processTone(harness, params, kMaximumFrames);
    promoted = harness.diagnostic(boundary) && boundary.completedFrames > before.completedFrames;
  }
  check(promoted, "profile change did not promote the completed MPEG-1 frame");
  if (!promoted) {
    return;
  }
  check(boundary.logical.profile == mp3::Profile::Mpeg1 && boundary.frameSamples == 1152u,
        "profile boundary relabeled the completed MPEG-1 diagnostic");
  double decoded_energy = 0.0;
  for (std::uint32_t channel = 0u; channel < boundary.logical.channels; ++channel) {
    for (std::uint32_t sample = 0u; sample < boundary.frameSamples; ++sample) {
      const double value = boundary.decodedPcm[channel * 1152u + sample];
      decoded_energy += value * value;
    }
  }
  check(decoded_energy > 1.0e-12, "profile change cleared the completed frame diagnostic PCM");
}

void testContinuationPcmMatchesLogicalRender() {
  KernelHarness live(44100.0F, 1u);
  KernelHarness reference(44100.0F, 1u);
  check(live.ready() && reference.ready(), "continuation PCM comparison kernels prepare");
  if (!live.ready() || !reference.ready()) {
    return;
  }
  Params params = defaultParams();
  params.bitrate = 8.0F;
  std::array<mp3::ProductionDiagnosticSnapshot, 3u> snapshots{};
  std::uint32_t captured = 0u;
  std::uint64_t completed = 0u;
  std::uint32_t absolute = 0u;
  while (captured < snapshots.size() && absolute < 10000u) {
    constexpr std::uint32_t frames = kMaximumFrames;
    std::array<float, frames> audio{};
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double index = static_cast<double>(absolute + frame);
      audio[frame] =
          static_cast<float>(0.61 * std::sin(index * 0.037) + 0.17 * std::cos(index * 0.011));
    }
    live.stage(params);
    live.process(audio.data(), 1u, frames);
    mp3::ProductionDiagnosticSnapshot snapshot{};
    if (live.diagnostic(snapshot) && snapshot.completedFrames != completed) {
      completed = snapshot.completedFrames;
      snapshots[captured++] = snapshot;
    }
    absolute += frames;
  }
  check(captured == snapshots.size(), "continuation PCM comparison captured three frames");
  if (captured != snapshots.size()) {
    return;
  }
  std::array<mp3::LogicalFrame, 3u> logical{};
  for (std::uint32_t frame = 0u; frame < logical.size(); ++frame) {
    logical[frame] = snapshots[frame].logical;
  }
  std::array<float, 3u * 2u * 1152u> decoded{};
  check(reference.renderLogicalFrames(logical.data(), static_cast<std::uint32_t>(logical.size()),
                                      decoded.data()),
        "continuation logical frames render through production synthesis");
  bool pcm_matches = true;
  for (std::uint32_t frame = 0u; frame < logical.size(); ++frame) {
    for (std::uint32_t sample = 0u; sample < snapshots[frame].frameSamples; ++sample) {
      pcm_matches = pcm_matches &&
                    decoded[frame * 2u * 1152u + sample] == snapshots[frame].decodedPcm[sample];
    }
  }
  check(pcm_matches, "continuation PCM differs from production logical-frame synthesis");
}

// The lookahead granule of frame N holds exactly the samples that become granule 0 of
// frame N+1. When both were run through detectAttack(), the second evaluation compared
// the window against its own energy, so total/old collapsed to 1 and that criterion was
// permanently dead for every frame's granule 0 - the granule nextBlockType() consumes as
// current_attack. The stimulus below is built so total/old is the *only* criterion that
// can see the two transients: the tone period is exactly 96 samples, so all six
// sub-windows of a granule carry identical energy (largestRise == 1) and the tone is far
// below the highFrequency threshold; the amplitude only ever steps at granule
// boundaries. Absolute granule 5 is frame 2's granule 1 and absolute granule 6 is frame
// 3's granule 0, so the trailing attack of the run lands on a frame's granule 0.
void testAttackCarryAcrossFrameBoundary() {
  KernelHarness harness(44100.0F, 2u);
  check(harness.ready(), "attack-carry kernel prepares");
  if (!harness.ready()) {
    return;
  }
  // MPEG-1 at a 44.1 kHz host is a direct codec-rate path (no halfband, no rational
  // stage), so codec sample k is host sample k and granule g spans [576g, 576g + 576).
  Params params = defaultParams();
  params.codecRate = 1.0F;
  constexpr std::uint32_t kGranuleSpan = 576u;
  constexpr std::uint32_t kLeadingAttackGranule = 5u;
  constexpr std::uint32_t kTrailingAttackGranule = 6u;
  constexpr std::uint32_t kBlockFrames = 64u;
  std::array<mp3::ProductionDiagnosticSnapshot, 4u> frames{};
  std::uint32_t captured = 0u;
  std::uint64_t completed = 0u;
  std::uint32_t absolute = 0u;
  std::array<float, 2u * kBlockFrames> audio{};
  while (captured < frames.size() && absolute < 12000u) {
    for (std::uint32_t frame = 0u; frame < kBlockFrames; ++frame) {
      const std::uint32_t index = absolute + frame;
      const std::uint32_t granule = index / kGranuleSpan;
      // 0.05 -> 0.125 -> 0.3125 is a 6.25x energy step at each boundary, i.e. above
      // the 4.0 total/old attack threshold and nothing else.
      const double amplitude = granule < kLeadingAttackGranule    ? 0.05
                               : granule < kTrailingAttackGranule ? 0.125
                                                                  : 0.3125;
      const double phase = 2.0 * std::numbers::pi_v<double> * static_cast<double>(index) / 96.0;
      audio[frame] = static_cast<float>(amplitude * std::sin(phase));
      audio[kBlockFrames + frame] = audio[frame];
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, kBlockFrames);
    absolute += kBlockFrames;
    mp3::ProductionDiagnosticSnapshot snapshot{};
    if (harness.diagnostic(snapshot) && snapshot.completedFrames != completed) {
      completed = snapshot.completedFrames;
      frames[captured++] = snapshot;
    }
  }
  check(captured == frames.size(), "attack-carry probe captured four completed frames");
  if (captured != frames.size()) {
    return;
  }
  check(frames[3u].logical.granules == 2u && frames[3u].logical.channels == 2u,
        "attack-carry probe did not run the MPEG-1 two-granule stereo layout");
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    const mp3::BlockType armed = frames[2u].logical.data[0u][channel].blockType;
    const mp3::BlockType leading = frames[2u].logical.data[1u][channel].blockType;
    const mp3::BlockType trailing = frames[3u].logical.data[0u][channel].blockType;
    const mp3::BlockType closing = frames[3u].logical.data[1u][channel].blockType;
    if (armed != mp3::BlockType::Start || leading != mp3::BlockType::Short ||
        trailing != mp3::BlockType::Short || closing != mp3::BlockType::Stop) {
      std::fprintf(stderr,
                   "attack-carry detail channel=%u armed=%d leading=%d trailing=%d closing=%d\n",
                   channel, static_cast<int>(armed), static_cast<int>(leading),
                   static_cast<int>(trailing), static_cast<int>(closing));
    }
    check(armed == mp3::BlockType::Start, "granule before the transient run did not arm a START");
    check(leading == mp3::BlockType::Short, "leading attack granule was not SHORT");
    check(trailing == mp3::BlockType::Short,
          "trailing attack on a frame's granule 0 lost its SHORT window");
    check(closing == mp3::BlockType::Stop, "transient run did not close with a STOP window");
  }
}

void testShortCutoffAndSwitchedRegions() {
  constexpr std::uint32_t cutoff = 287u;
  check(mp3::shortWindowLine(mp3::Profile::Mpeg1, 307u) == 95u &&
            mp3::codedLine(mp3::Profile::Mpeg1, mp3::BlockType::Short, 307u, cutoff),
        "short cutoff omitted window 2 coefficient 95 at reordered index 307");
  check(mp3::shortWindowLine(mp3::Profile::Mpeg1, 308u) == 96u &&
            !mp3::codedLine(mp3::Profile::Mpeg1, mp3::BlockType::Short, 308u, cutoff) &&
            mp3::lastCodedLine(mp3::Profile::Mpeg1, mp3::BlockType::Short, cutoff) == 307u,
        "short cutoff did not stop at the exact reordered coefficient");

  std::array<std::int32_t, mp3::kGranuleSamples> values{};
  values[306u] = 2;
  values[307u] = -2;
  values[308u] = 8191;
  const mp3::HuffmanRegions regions =
      mp3::selectHuffmanRegions(values.data(), mp3::Profile::Mpeg1, mp3::BlockType::Short, cutoff);
  check(regions.bigValues == 154u && regions.boundaryLines[0u] == 36u &&
            regions.boundaryLines[1u] == 308u && regions.tableSelect[2u] == 0u,
        "short block did not use the switched two-region Huffman layout");
}

void testMpeg2LsfScaleFactors() {
  check(mp3::scaleFactorBits(mp3::Profile::Mpeg1, mp3::BlockType::Short, 36u) == 126u,
        "MPEG-1 short scalefactor partition changed while adding LSF support");
  const mp3::ScaleFactorLayout long_layout =
      mp3::scaleFactorLayout(mp3::Profile::Mpeg2Lsf, mp3::BlockType::Long);
  const mp3::ScaleFactorLayout short_layout =
      mp3::scaleFactorLayout(mp3::Profile::Mpeg2Lsf, mp3::BlockType::Short);
  check(long_layout.scalefacCompress == 399u && long_layout.count == 21u &&
            long_layout.groupCounts == std::array<std::uint8_t, 4>{6u, 5u, 5u, 5u} &&
            mp3::scaleFactorBits(mp3::Profile::Mpeg2Lsf, mp3::BlockType::Long, 21u) == 74u,
        "MPEG-2 LSF long scalefactor partition is incorrect");
  check(short_layout.scalefacCompress == 399u && short_layout.count == 36u &&
            short_layout.groupCounts == std::array<std::uint8_t, 4>{9u, 9u, 9u, 9u} &&
            mp3::scaleFactorBits(mp3::Profile::Mpeg2Lsf, mp3::BlockType::Short, 36u) == 126u,
        "MPEG-2 LSF short scalefactor partition is incorrect");
  std::uint8_t three_bit_stimulus = 6u;
  three_bit_stimulus = mp3::incrementScaleFactor(long_layout, 11u, three_bit_stimulus);
  check(three_bit_stimulus == 7u &&
            mp3::incrementScaleFactor(long_layout, 11u, three_bit_stimulus) == 7u,
        "three-bit noise-shaping refinement did not reach and saturate at seven");
  for (const mp3::Profile profile : {mp3::Profile::Mpeg1, mp3::Profile::Mpeg2Lsf}) {
    for (const mp3::BlockType block : {mp3::BlockType::Long, mp3::BlockType::Short}) {
      const mp3::ScaleFactorLayout layout = mp3::scaleFactorLayout(profile, block);
      for (std::uint32_t factor = 0u; factor < layout.count; ++factor) {
        const std::uint32_t width = mp3::scaleFactorBitWidth(layout, factor);
        const std::uint32_t maximum = mp3::scaleFactorMaximum(layout, factor);
        check(width != 0u && maximum == (1u << width) - 1u &&
                  mp3::incrementScaleFactor(layout, factor, static_cast<std::uint8_t>(maximum)) ==
                      maximum,
              "scalefactor field maximum does not follow its syntax width");
      }
    }
  }

  KernelHarness harness(44100.0F, 2u);
  Params params = defaultParams();
  params.codecRate = 0.0F;
  processTone(harness, params, 12000u);
  mp3::ProductionDiagnosticSnapshot snapshot{};
  check(harness.diagnostic(snapshot), "MPEG-2 LSF production diagnostic is available");
  if (harness.diagnostic(snapshot)) {
    std::int32_t maximum_quantized_magnitude = 0;
    bool uses_escape_table = false;
    for (std::uint32_t channel = 0u; channel < snapshot.logical.channels; ++channel) {
      const mp3::GranuleChannel &logical = snapshot.logical.data[0u][channel];
      check(logical.scalefacCompress == 399u && logical.scalefactorCount > 0u &&
                logical.part2Length > 0u && logical.part3Length > 0u,
            "MPEG-2 LSF production frame omitted scalefactor or Huffman payload");
      const mp3::ScaleFactorLayout layout =
          mp3::scaleFactorLayout(mp3::Profile::Mpeg2Lsf, logical.blockType);
      for (std::uint32_t factor = 0u; factor < logical.scalefactorCount; ++factor) {
        check(logical.scalefactors[factor] <= mp3::scaleFactorMaximum(layout, factor),
              "production scalefactor exceeded its syntax field width");
      }
      for (const std::uint8_t table : logical.huffman.tableSelect) {
        uses_escape_table = uses_escape_table || table >= 16u;
      }
      for (const std::int32_t value : logical.quantized) {
        const std::int32_t magnitude = value < 0 ? -value : value;
        maximum_quantized_magnitude =
            magnitude > maximum_quantized_magnitude ? magnitude : maximum_quantized_magnitude;
      }
    }
    check(uses_escape_table && maximum_quantized_magnitude >= 15,
          "production quantizer did not consume the analyzed MDCT spectrum");
  }
}

std::vector<float> render(KernelHarness &harness, const Params &params, std::uint32_t channels,
                          std::uint32_t total_frames, std::uint32_t fixed_partition = 0u) {
  std::vector<float> output(static_cast<std::size_t>(channels) * total_frames);
  constexpr std::array<std::uint32_t, 6u> partitions = {1u, 17u, 127u, 128u, 129u, 257u};
  std::uint32_t absolute = 0u;
  std::uint32_t partition = 0u;
  while (absolute < total_frames) {
    std::uint32_t frames =
        fixed_partition == 0u ? partitions[partition % partitions.size()] : fixed_partition;
    if (frames > total_frames - absolute)
      frames = total_frames - absolute;
    std::vector<float> block(static_cast<std::size_t>(channels) * frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t frame = 0u; frame < frames; ++frame) {
        const double index = static_cast<double>(absolute + frame);
        block[static_cast<std::size_t>(channel) * frames + frame] =
            static_cast<float>(0.61 * std::sin(index * 0.037 + channel * 0.19) +
                               0.17 * std::cos(index * 0.011 + channel * 0.31));
      }
    }
    harness.stage(params);
    harness.process(block.data(), channels, frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t frame = 0u; frame < frames; ++frame) {
        output[static_cast<std::size_t>(channel) * total_frames + absolute + frame] =
            block[static_cast<std::size_t>(channel) * frames + frame];
      }
    }
    absolute += frames;
    ++partition;
  }
  return output;
}

void testSchedulerCompletionAndPartitioning() {
  constexpr std::array<float, 8u> rates = {44100.0F,  48000.0F,  88200.0F,  96000.0F,
                                           176400.0F, 192000.0F, 352800.0F, 384000.0F};
  for (const float rate : rates) {
    for (const float profile : {1.0F, 0.0F}) {
      Params params = defaultParams();
      params.codecRate = profile;
      params.bitrate = profile == 0.0F ? 7.0F : 8.0F;
      KernelHarness varied(rate, 2u);
      KernelHarness fixed(rate, 2u);
      check(varied.ready() && fixed.ready(), "scheduler test kernels prepare");
      if (!varied.ready() || !fixed.ready()) {
        continue;
      }
      constexpr std::uint32_t totalFrames = 70000u;
      const std::vector<float> variedOutput = render(varied, params, 2u, totalFrames);
      const std::vector<float> fixedOutput = render(fixed, params, 2u, totalFrames, 128u);
      check(variedOutput == fixedOutput, "scheduler output changed with the host input partition");
      for (KernelHarness *harness : {&varied, &fixed}) {
        mp3::ProductionDiagnosticSnapshot snapshot{};
        check(harness->diagnostic(snapshot) && snapshot.completedFrames >= 2u,
              "scheduler did not complete multiple codec frames");
        check(snapshot.schedulerDeadlineMisses == 0u,
              "scheduler did not complete a codec frame before its input deadline");
        check(snapshot.outputUnderflowsAfterStartup == 0u,
              "scheduler allowed the wet output queue to underflow after startup");
        if (snapshot.minimumFrameCompletionMargin * 25u < snapshot.frameSamples) {
          std::fprintf(stderr,
                       "scheduler margin detail rate=%.0f profile=%.0f margin=%u frame=%u\n", rate,
                       profile, snapshot.minimumFrameCompletionMargin, snapshot.frameSamples);
        }
        check(snapshot.minimumFrameCompletionMargin * 25u >= snapshot.frameSamples,
              "scheduler retained less than four percent frame-completion margin");
      }
    }
  }
}

void testKernelSafetyAndReset() {
  for (const float rate :
       {44100.0F, 48000.0F, 88200.0F, 96000.0F, 176400.0F, 192000.0F, 352800.0F, 384000.0F}) {
    KernelHarness harness(rate, 2u);
    check(harness.ready(), "supported host rate prepares");
    if (!harness.ready())
      continue;
    const std::vector<float> output = render(harness, defaultParams(), 2u, 4609u);
    for (const float sample : output) {
      check(std::isfinite(sample), "supported host rate produced non-finite output");
    }
  }

  KernelHarness mono(96000.0F, 1u);
  check(mono.ready(), "mono kernel prepares");
  if (mono.ready()) {
    const std::vector<float> first = render(mono, defaultParams(), 1u, 16001u);
    mono.reset();
    const std::vector<float> second = render(mono, defaultParams(), 1u, 16001u);
    check(first == second, "reset did not produce a deterministic clean restart");
  }

  KernelHarness extra(48000.0F, 4u);
  check(extra.ready(), "four-channel kernel prepares");
  if (extra.ready()) {
    std::array<float, 4u * kMaximumFrames> audio{};
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      audio[2u * kMaximumFrames + frame] = static_cast<float>(frame) * 0.001F;
      audio[3u * kMaximumFrames + frame] = -static_cast<float>(frame) * 0.002F;
    }
    const auto original = audio;
    extra.stage(defaultParams());
    extra.process(audio.data(), 4u, kMaximumFrames);
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      check(audio[2u * kMaximumFrames + frame] == original[2u * kMaximumFrames + frame] &&
                audio[3u * kMaximumFrames + frame] == original[3u * kMaximumFrames + frame],
            "channels outside the first stereo pair were modified");
    }
  }
}

std::vector<float> renderImpulse(KernelHarness &harness, const Params &params,
                                 std::uint32_t total_frames) {
  std::vector<float> result(total_frames);
  for (std::uint32_t absolute = 0u; absolute < total_frames; absolute += kMaximumFrames) {
    const std::uint32_t frames =
        total_frames - absolute < kMaximumFrames ? total_frames - absolute : kMaximumFrames;
    std::array<float, kMaximumFrames> audio{};
    if (absolute == 0u) {
      audio[0u] = 1.0F;
    }
    harness.stage(params);
    harness.process(audio.data(), 1u, frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      result[absolute + frame] = audio[frame];
    }
  }
  return result;
}

void testWetImpulseAlignment() {
  for (const float rate :
       {44100.0F, 48000.0F, 88200.0F, 96000.0F, 176400.0F, 192000.0F, 352800.0F, 384000.0F}) {
    for (const float profile : {1.0F, 0.0F}) {
      KernelHarness harness(rate, 1u);
      Params params = defaultParams();
      params.codecRate = profile;
      params.bitrate = profile == 0.0F ? 7.0F : 8.0F;
      constexpr std::uint32_t total = 70000u;
      const std::vector<float> output = renderImpulse(harness, params, total);
      std::uint32_t peak_index = 0u;
      float peak = 0.0F;
      for (std::uint32_t frame = 0u; frame < output.size(); ++frame) {
        const float magnitude = output[frame] < 0.0F ? -output[frame] : output[frame];
        if (magnitude > peak) {
          peak = magnitude;
          peak_index = frame;
        }
      }
      if (!(peak > 1.0e-6F && peak_index == harness.latency())) {
        std::fprintf(stderr,
                     "wet latency detail rate=%.0f profile=%.0f expected=%u actual=%u peak=%g\n",
                     rate, profile, harness.latency(), peak_index, peak);
      }
      check(peak > 1.0e-6F && peak_index == harness.latency(),
            "full wet impulse peak did not match the fixed reported latency");
    }
  }
}

void testWetImpulseAlignmentAcrossBitrates() {
  for (const float profile : {1.0F, 0.0F}) {
    const std::uint32_t bitrateCount = profile == 0.0F ? 8u : 9u;
    for (std::uint32_t bitrate = 0u; bitrate < bitrateCount; ++bitrate) {
      KernelHarness harness(96000.0F, 1u);
      Params params = defaultParams();
      params.codecRate = profile;
      params.bitrate = static_cast<float>(bitrate);
      const std::vector<float> output = renderImpulse(harness, params, 20001u);
      std::uint32_t peakIndex = 0u;
      float peak = 0.0F;
      for (std::uint32_t frame = 0u; frame < output.size(); ++frame) {
        const float magnitude = output[frame] < 0.0F ? -output[frame] : output[frame];
        if (magnitude > peak) {
          peak = magnitude;
          peakIndex = frame;
        }
      }
      check(peak > 1.0e-6F && peakIndex == harness.latency(),
            "wet impulse peak changed with bitrate instead of retaining fixed latency");
    }
  }
}

void testMixAlignment() {
  for (const float profile : {1.0F, 0.0F}) {
    Params wet_params = defaultParams();
    wet_params.codecRate = profile;
    wet_params.bitrate = profile == 0.0F ? 7.0F : 8.0F;
    Params dry_params = wet_params;
    dry_params.mix = 0.0F;
    Params mixed_params = wet_params;
    mixed_params.mix = 50.0F;

    KernelHarness wet_impulse_harness(96000.0F, 1u);
    KernelHarness dry_impulse_harness(96000.0F, 1u);
    KernelHarness mixed_impulse_harness(96000.0F, 1u);
    constexpr std::uint32_t impulse_frames = 20001u;
    const std::vector<float> wet_impulse =
        renderImpulse(wet_impulse_harness, wet_params, impulse_frames);
    const std::vector<float> dry_impulse =
        renderImpulse(dry_impulse_harness, dry_params, impulse_frames);
    const std::vector<float> mixed_impulse =
        renderImpulse(mixed_impulse_harness, mixed_params, impulse_frames);
    for (std::uint32_t frame = 0u; frame < impulse_frames; ++frame) {
      check(closeEnough(mixed_impulse[frame], 0.5F * (dry_impulse[frame] + wet_impulse[frame]),
                        2.0e-5F),
            "Mix 50 impulse did not combine latency-aligned dry and wet paths");
    }

    KernelHarness wet_sweep_harness(96000.0F, 1u);
    KernelHarness dry_sweep_harness(96000.0F, 1u);
    KernelHarness mixed_sweep_harness(96000.0F, 1u);
    constexpr std::uint32_t sweep_frames = 24001u;
    const std::vector<float> wet_sweep = render(wet_sweep_harness, wet_params, 1u, sweep_frames);
    const std::vector<float> dry_sweep = render(dry_sweep_harness, dry_params, 1u, sweep_frames);
    const std::vector<float> mixed_sweep =
        render(mixed_sweep_harness, mixed_params, 1u, sweep_frames);
    for (std::uint32_t frame = 0u; frame < sweep_frames; ++frame) {
      check(closeEnough(mixed_sweep[frame], 0.5F * (dry_sweep[frame] + wet_sweep[frame]), 2.0e-5F),
            "Mix 50 sweep did not combine latency-aligned dry and wet paths");
    }
  }
}

void testMaximumMonoBitrates() {
  for (const float profile : {1.0F, 0.0F}) {
    Params low_params = defaultParams();
    low_params.codecRate = profile;
    low_params.bitrate = 0.0F;
    Params high_params = low_params;
    high_params.bitrate = profile == 0.0F ? 7.0F : 8.0F;
    KernelHarness low_harness(96000.0F, 1u);
    KernelHarness high_harness(96000.0F, 1u);
    constexpr std::uint32_t frames = 30001u;
    const std::vector<float> low = render(low_harness, low_params, 1u, frames);
    const std::vector<float> high = render(high_harness, high_params, 1u, frames);
    mp3::ProductionDiagnosticSnapshot snapshot{};
    check(high_harness.diagnostic(snapshot) &&
              snapshot.logical.bitrateKbps == (profile == 0.0F ? 160u : 192u),
          "maximum bitrate did not reach the production codec path");
    double high_energy = 0.0;
    double difference_energy = 0.0;
    bool finite = true;
    for (std::uint32_t frame = high_harness.latency(); frame < frames; ++frame) {
      finite = finite && std::isfinite(high[frame]);
      high_energy += static_cast<double>(high[frame]) * high[frame];
      const double difference = static_cast<double>(high[frame]) - low[frame];
      difference_energy += difference * difference;
    }
    check(finite, "maximum mono bitrate produced non-finite output");
    check(high_energy > 1.0e-8, "160/192 kbit/s mono codec path remained effectively silent");
    check(difference_energy > 1.0e-8,
          "minimum and maximum mono bitrates produced identical output");
  }
}

void testDryLatencyForBothProfiles() {
  for (const float profile : {1.0F, 0.0F}) {
    KernelHarness harness(96000.0F, 2u);
    check(harness.ready(), "dry-latency kernel prepares");
    if (!harness.ready())
      continue;
    Params params = defaultParams();
    params.codecRate = profile;
    params.mix = 0.0F;
    const std::uint32_t latency = harness.latency();
    bool impulse_found = false;
    std::uint32_t absolute = 0u;
    while (absolute <= latency + kMaximumFrames) {
      std::array<float, 2u * kMaximumFrames> audio{};
      if (absolute == 0u) {
        audio[0u] = 1.0F;
        audio[kMaximumFrames] = -1.0F;
      }
      harness.stage(params);
      harness.process(audio.data(), 2u, kMaximumFrames);
      for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
        const std::uint32_t index = absolute + frame;
        if (index < latency) {
          check(audio[frame] == 0.0F && audio[kMaximumFrames + frame] == 0.0F,
                "dry output preceded the reported latency");
        } else if (index == latency) {
          impulse_found = audio[frame] == 1.0F && audio[kMaximumFrames + frame] == -1.0F;
        }
      }
      absolute += kMaximumFrames;
    }
    check(impulse_found, "dry impulse did not appear at the reported latency");
  }
}

[[nodiscard]] std::uint32_t rateFactor(std::uint32_t rate) noexcept {
  return rate / (rate % 44100u == 0u ? 44100u : 48000u);
}

// Steady-state wet RMS of a single tone. Absolute levels are meaningless through
// MP3 quantization, so every criterion below compares this figure across host
// rates at identical codec settings, which isolates the resampler chain.
double renderToneRms(float sample_rate, double frequency, float profile) {
  KernelHarness harness(sample_rate, 2u);
  if (!harness.ready()) {
    return 0.0;
  }
  Params params = defaultParams();
  params.codecRate = profile;
  params.bitrate = profile == 0.0F ? 7.0F : 8.0F;
  const std::uint32_t factor = rateFactor(static_cast<std::uint32_t>(sample_rate));
  const std::uint32_t settle = harness.latency() + 2048u * factor;
  const std::uint32_t total = settle + static_cast<std::uint32_t>(sample_rate * 0.05F);
  double squared = 0.0;
  std::uint32_t measured = 0u;
  std::uint32_t absolute = 0u;
  std::vector<float> audio(2u * kMaximumFrames, 0.0F);
  while (absolute < total) {
    const std::uint32_t frames =
        total - absolute < kMaximumFrames ? total - absolute : kMaximumFrames;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double phase = 2.0 * std::numbers::pi_v<double> * frequency *
                           static_cast<double>(absolute + frame) / static_cast<double>(sample_rate);
      audio[frame] = static_cast<float>(0.5 * std::sin(phase));
      audio[frames + frame] = audio[frame];
    }
    harness.stage(params);
    harness.process(audio.data(), 2u, frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      if (absolute + frame >= settle) {
        squared += static_cast<double>(audio[frame]) * audio[frame];
        ++measured;
      }
    }
    absolute += frames;
  }
  return measured == 0u ? 0.0 : std::sqrt(squared / measured);
}

struct ResponseCase final {
  float profile;
  std::array<double, 3u> passbandTones;
  double outOfBand44100;
  double folded44100;
  double outOfBand48000;
  double folded48000;
  bool aliasAtBaseRate;
};

void checkResamplerResponse(const ResponseCase &fixture) {
  constexpr std::array<float, 8u> rates = {44100.0F,  48000.0F,  88200.0F,  96000.0F,
                                           176400.0F, 192000.0F, 352800.0F, 384000.0F};
  std::array<double, 3u> reference44100{};
  std::array<double, 3u> reference48000{};
  for (std::size_t index = 0u; index < fixture.passbandTones.size(); ++index) {
    reference44100[index] = renderToneRms(44100.0F, fixture.passbandTones[index], fixture.profile);
    reference48000[index] = renderToneRms(48000.0F, fixture.passbandTones[index], fixture.profile);
    check(reference44100[index] > 1.0e-3 && reference48000[index] > 1.0e-3,
          "base-rate passband tone remains audible through the codec");
  }
  const double foldedReference44100 = renderToneRms(44100.0F, fixture.folded44100, fixture.profile);
  const double foldedReference48000 = renderToneRms(48000.0F, fixture.folded48000, fixture.profile);

  for (const float rate : rates) {
    const bool family44100 = static_cast<std::uint32_t>(rate) % 44100u == 0u;
    const auto &reference = family44100 ? reference44100 : reference48000;
    for (std::size_t index = 0u; index < fixture.passbandTones.size(); ++index) {
      const double measured = renderToneRms(rate, fixture.passbandTones[index], fixture.profile);
      const double ratio = reference[index] > 0.0 ? measured / reference[index] : 0.0;
      if (!(ratio > 0.95 && ratio < 1.05)) {
        std::fprintf(stderr,
                     "passband detail rate=%.0f profile=%.0f tone=%.0f ratio=%.4f rms=%.6f "
                     "ref=%.6f\n",
                     rate, static_cast<double>(fixture.profile), fixture.passbandTones[index],
                     ratio, measured, reference[index]);
      }
      check(ratio > 0.95 && ratio < 1.05,
            "resampler chain did not preserve the base-rate passband response");
    }
    if (!fixture.aliasAtBaseRate && rateFactor(static_cast<std::uint32_t>(rate)) == 1u) {
      continue;
    }
    const double outOfBand = family44100 ? fixture.outOfBand44100 : fixture.outOfBand48000;
    const double foldedReference = family44100 ? foldedReference44100 : foldedReference48000;
    const double alias = renderToneRms(rate, outOfBand, fixture.profile);
    const double ratio = foldedReference > 0.0 ? alias / foldedReference : 0.0;
    if (!(ratio < 0.02)) {
      std::fprintf(stderr,
                   "alias detail rate=%.0f profile=%.0f tone=%.0f ratio=%.3e alias=%.3e "
                   "folded=%.6f\n",
                   rate, static_cast<double>(fixture.profile), outOfBand, ratio, alias,
                   foldedReference);
    }
    check(ratio < 0.02, "resampler chain did not suppress a codec-Nyquist folding tone");
  }
}

// The 44.1 kHz family MPEG-1 route has no rational stage at all: its band limit is the
// halfband cascade alone (cutoff = input/4, half-transition about 2386 Hz at an 88.2 kHz
// input). The worst folding input for the guaranteed passband edge is therefore
// 44100 - 19982.813 = 24117 Hz, not the 25050 Hz probe of checkResamplerResponse, whose
// margin argument only holds for the rational stages. This probe sits at 24200 Hz, which
// folds onto 19900 Hz - the same tone the passband section measures at the base rate.
void checkMpeg1HalfbandWorstFold() {
  constexpr double kProbeHz = 24200.0;
  constexpr double kFoldedHz = 19900.0;
  constexpr std::array<float, 3u> rates = {88200.0F, 176400.0F, 352800.0F};
  const double foldedReference = renderToneRms(44100.0F, kFoldedHz, 1.0F);
  check(foldedReference > 1.0e-3, "MPEG-1 worst-fold reference tone remains audible");
  for (const float rate : rates) {
    const double alias = renderToneRms(rate, kProbeHz, 1.0F);
    const double ratio = foldedReference > 0.0 ? alias / foldedReference : 0.0;
    std::fprintf(stderr, "recorded mpeg1 worst-fold rate=%.0f tone=%.0f ratio=%.3e alias=%.3e\n",
                 static_cast<double>(rate), kProbeHz, ratio, alias);
    check(ratio < 0.02,
          "halfband cascade did not suppress the worst MPEG-1 codec-Nyquist folding tone");
  }
}

// Recorded deviation lock, NOT a passband gate. The MPEG-2 LSF rational stage has to hold
// 10489.063 Hz (the guaranteed passband edge) flat while stopping 11025 Hz, a 536 Hz
// spread against a 660-720 Hz transition width at 383 taps, so the edge necessarily sits
// inside the transition band. Per 00-overview §9.4 a numeric resampler-spec miss is a
// recorded design/audibility datum rather than something to redesign around, so the floor
// below is deliberately loose (0.7) and only locks the measured droop against silent
// regression. The 0.95 passband gate stays on the 10400 Hz tone in checkResamplerResponse.
void recordMpeg2PassbandEdgeDroop() {
  constexpr double kEdgeHz = 10489.063;
  constexpr double kInputRms = 0.35355339059327373;
  constexpr std::array<float, 2u> rates = {44100.0F, 48000.0F};
  for (const float rate : rates) {
    const double rms = renderToneRms(rate, kEdgeHz, 0.0F);
    const double ratio = rms / kInputRms;
    std::fprintf(stderr,
                 "recorded mpeg2 passband-edge droop rate=%.0f tone=%.3f ratio=%.4f "
                 "db=%.2f rms=%.6f\n",
                 static_cast<double>(rate), kEdgeHz, ratio,
                 20.0 * std::log10(ratio > 0.0 ? ratio : 1.0e-12), rms);
    check(ratio > 0.7, "MPEG-2 LSF passband-edge droop regressed past its recorded deviation");
  }
}

void testResamplerResponse() {
  // MPEG-1: guaranteed passband edge 19982.813 Hz, codec Nyquist 22050 Hz.
  checkResamplerResponse(
      {1.0F, {{15000.0, 18000.0, 19900.0}}, 25050.0, 19050.0, 30000.0, 18000.0, false});
  // MPEG-2 LSF: guaranteed passband edge 10489.063 Hz, codec Nyquist 11025 Hz.
  // The rational stage carries the whole band limit here, so the base rates are
  // exercised as well.
  checkResamplerResponse(
      {0.0F, {{7500.0, 9000.0, 10400.0}}, 13000.0, 9050.0, 13000.0, 9050.0, true});
  checkMpeg1HalfbandWorstFold();
  recordMpeg2PassbandEdgeDroop();
}

void testWetUnityGain() {
  // Regression for the halved wet path (synthesis normalized by 1/18 instead of
  // the TDAC unity 1/9): at the top bitrate a mid-band tone must come back at
  // unity level. The +-1 dB window tolerates codec quantization and passband
  // ripple but fails hard on any 0.5x (or 2x) chain gain.
  constexpr double kInputRms = 0.35355339059327373;
  struct UnityCase final {
    float rate;
    double tone;
    float profile;
  };
  constexpr std::array<UnityCase, 4u> cases = {
      UnityCase{44100.0F, 1000.0, 1.0F}, UnityCase{48000.0F, 1000.0, 1.0F},
      UnityCase{44100.0F, 1000.0, 0.0F}, UnityCase{96000.0F, 1000.0, 1.0F}};
  for (const UnityCase &fixture : cases) {
    const double rms = renderToneRms(fixture.rate, fixture.tone, fixture.profile);
    const double ratio = rms / kInputRms;
    if (!(ratio > 0.891 && ratio < 1.122)) {
      std::fprintf(stderr, "wet unity detail rate=%.0f profile=%.0f rms=%.6f ratio=%.4f\n",
                   fixture.rate, static_cast<double>(fixture.profile), rms, ratio);
    }
    check(ratio > 0.891 && ratio < 1.122,
          "wet codec path is not unity gain for a mid-band tone at the top bitrate");
  }
}

void testWetOutputForBothProfiles() {
  for (const float profile : {1.0F, 0.0F}) {
    KernelHarness harness(96000.0F, 2u);
    check(harness.ready(), "wet-output kernel prepares");
    if (!harness.ready())
      continue;
    Params params = defaultParams();
    params.codecRate = profile;
    const std::vector<float> output = render(harness, params, 2u, 20001u);
    double energy = 0.0;
    bool non_silent = false;
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t frame = harness.latency(); frame < 20001u; ++frame) {
        const float sample = output[static_cast<std::size_t>(channel) * 20001u + frame];
        energy += static_cast<double>(sample) * sample;
        non_silent = non_silent || sample != 0.0F;
      }
    }
    check(non_silent && energy > 1.0e-8,
          "wet codec path remained silent after the reported latency");
  }
}

template <typename Value> void writeDiagnosticValue(std::ofstream &output, const Value &value) {
  output.write(reinterpret_cast<const char *>(&value), sizeof(value));
}

bool writeProductionDiagnostic(std::string_view fixture_id, const char *path) {
  const bool mpeg1 = fixture_id.starts_with("mpeg1-");
  const bool mono = fixture_id.find("mono") != std::string_view::npos;
  const bool reservoir = fixture_id.find("reservoir-on") != std::string_view::npos;
  const bool joint = fixture_id.find("joint") != std::string_view::npos;
  const bool supported =
      fixture_id == "mpeg1-mono-reservoir-off" || fixture_id == "mpeg1-joint-reservoir-on" ||
      fixture_id == "mpeg2-mono-reservoir-on" || fixture_id == "mpeg2-stereo-reservoir-off";
  if (!supported) {
    std::fprintf(stderr, "Unsupported MP3 diagnostic fixture: %.*s\n",
                 static_cast<int>(fixture_id.size()), fixture_id.data());
    return false;
  }

  const std::uint32_t channels = mono ? 1u : 2u;
  KernelHarness harness(44100.0F, channels);
  if (!harness.ready()) {
    return false;
  }
  Params params = defaultParams();
  params.codecRate = mpeg1 ? 1.0F : 0.0F;
  params.bitrate = mpeg1 ? (mono ? 0.0F : 2.0F) : (mono ? 0.0F : 2.0F);
  params.stereoMode = joint ? 0.0F : 1.0F;
  params.bitReservoir = reservoir ? 1.0F : 0.0F;

  std::array<mp3::ProductionDiagnosticSnapshot, 4u> snapshots{};
  std::uint32_t captured = 0u;
  std::uint64_t previous_frame = 0u;
  std::uint32_t absolute = 0u;
  while (captured < snapshots.size() && absolute < 30000u) {
    constexpr std::uint32_t block_frames = 128u;
    std::array<float, 2u * block_frames> audio{};
    for (std::uint32_t frame = 0u; frame < block_frames; ++frame) {
      const double sample = static_cast<double>(absolute + frame);
      const bool lsf_short_coverage = !mpeg1 && !mono;
      const double envelope =
          lsf_short_coverage && ((absolute + frame) / 192u) % 6u < 3u ? 0.015 : 0.64;
      audio[frame] = lsf_short_coverage ? static_cast<float>(envelope * std::sin(sample * 0.37))
                                        : static_cast<float>(0.41 * std::sin(sample * 0.031) +
                                                             0.23 * std::cos(sample * 0.071));
      if (channels == 2u) {
        audio[block_frames + frame] =
            lsf_short_coverage ? static_cast<float>(envelope * std::cos(sample * 0.41 + 0.23))
                               : static_cast<float>(0.37 * std::cos(sample * 0.043) -
                                                    0.19 * std::sin(sample * 0.083));
      }
    }
    harness.stage(params);
    harness.process(audio.data(), channels, block_frames);
    mp3::ProductionDiagnosticSnapshot snapshot{};
    if (harness.diagnostic(snapshot) && snapshot.completedFrames != previous_frame) {
      snapshots[captured++] = snapshot;
      previous_frame = snapshot.completedFrames;
    }
    absolute += block_frames;
  }
  if (captured != snapshots.size()) {
    std::fprintf(stderr, "MP3 production diagnostic did not complete four frames\n");
    return false;
  }
  const auto production_snapshots = snapshots;

  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  if (!output) {
    std::fprintf(stderr, "Unable to create MP3 production diagnostic output\n");
    return false;
  }
  constexpr std::array<char, 8u> magic = {'E', 'T', 'M', 'P', '3', 'D', '2', '\0'};
  output.write(magic.data(), magic.size());
  const std::uint32_t version = 2u;
  const std::uint32_t frame_count = static_cast<std::uint32_t>(production_snapshots.size());
  const std::uint32_t profile = mpeg1 ? 1u : 0u;
  const std::uint32_t sample_rate = mpeg1 ? 44100u : 22050u;
  writeDiagnosticValue(output, version);
  writeDiagnosticValue(output, frame_count);
  writeDiagnosticValue(output, profile);
  writeDiagnosticValue(output, channels);
  writeDiagnosticValue(output, sample_rate);
  for (const auto &snapshot : production_snapshots) {
    const mp3::LogicalFrame &frame = snapshot.logical;
    writeDiagnosticValue(output, snapshot.frameSamples);
    writeDiagnosticValue(output, frame.bitrateKbps);
    const std::uint32_t granules = frame.granules;
    const std::uint32_t frame_channels = frame.channels;
    writeDiagnosticValue(output, granules);
    writeDiagnosticValue(output, frame_channels);
    const std::uint32_t mid_side = frame.midSide ? 1u : 0u;
    writeDiagnosticValue(output, mid_side);
    output.write(reinterpret_cast<const char *>(frame.scfsi.data()), frame.scfsi.size());
    const std::array<std::uint32_t, 12u> budget = {
        frame.budget.frameBytes,          frame.budget.paddingSlotBytes,
        frame.budget.headerBits,          frame.budget.crcBits,
        frame.budget.sideInfoBits,        frame.budget.physicalMainDataAreaBits,
        frame.budget.logicalAduBits,      frame.budget.mainDataBegin,
        frame.budget.reservoirBeforeBits, frame.budget.reservoirAfterBits,
        frame.budget.ancillaryBits,       frame.budget.valid ? 1u : 0u};
    for (const auto value : budget) {
      writeDiagnosticValue(output, value);
    }
    for (std::uint32_t granule = 0u; granule < frame.granules; ++granule) {
      for (std::uint32_t channel = 0u; channel < frame.channels; ++channel) {
        const mp3::GranuleChannel &logical = frame.data[granule][channel];
        const std::array<std::uint32_t, 21u> fields = {
            static_cast<std::uint32_t>(logical.blockType),
            logical.mixedBlock ? 1u : 0u,
            logical.globalGain,
            logical.scalefacCompress,
            logical.scalefactorCount,
            logical.part2Length,
            logical.part3Length,
            logical.subblockGain[0u],
            logical.subblockGain[1u],
            logical.subblockGain[2u],
            logical.huffman.tableSelect[0u],
            logical.huffman.tableSelect[1u],
            logical.huffman.tableSelect[2u],
            logical.huffman.boundaryLines[0u],
            logical.huffman.boundaryLines[1u],
            logical.huffman.count1TableSelect,
            logical.huffman.bigValues,
            logical.huffman.count1,
            logical.huffman.bigValueBits,
            logical.huffman.count1Bits,
            logical.huffman.totalBits()};
        for (const auto value : fields) {
          writeDiagnosticValue(output, value);
        }
        output.write(reinterpret_cast<const char *>(logical.scalefactors.data()),
                     logical.scalefactors.size());
        output.write(reinterpret_cast<const char *>(logical.quantized.data()),
                     static_cast<std::streamsize>(logical.quantized.size() * sizeof(std::int32_t)));
      }
    }
    for (std::uint32_t channel = 0u; channel < frame.channels; ++channel) {
      const float *pcm = snapshot.decodedPcm.data() + channel * 1152u;
      output.write(reinterpret_cast<const char *>(pcm),
                   static_cast<std::streamsize>(snapshot.frameSamples * sizeof(float)));
    }
  }
  return output.good();
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
  if (argc == 4 && std::string_view(argv[1]) == "--production-diagnostic") {
    return writeProductionDiagnostic(argv[2], argv[3]) ? 0 : 1;
  }
  testProfilePolicies();
  testBlockSwitchOracle();
  testFrameBudgets();
  testHuffmanLengthOracle();
  testFrameMidSideCompatibility();
  testLogicalDecodeOracle();
  testAttackCarryAcrossFrameBoundary();
  testShortCutoffAndSwitchedRegions();
  testMpeg2LsfScaleFactors();
  testFrameControlFastPath();
  testPreparedResamplerStages();
  testCompletedDiagnosticSurvivesProfileBoundary();
  testContinuationPcmMatchesLogicalRender();
  testSchedulerCompletionAndPartitioning();
  testKernelSafetyAndReset();
  testWetImpulseAlignment();
  testWetImpulseAlignmentAcrossBitrates();
  testMixAlignment();
  testMaximumMonoBitrates();
  testDryLatencyForBothProfiles();
  testWetUnityGain();
  testWetOutputForBothProfiles();
  testResamplerResponse();
  return failures == 0 ? 0 : 1;
}

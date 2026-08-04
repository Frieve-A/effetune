#pragma once

#include "tables.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace effetune::plugins::lofi::mp3 {

constexpr std::uint32_t kGranuleSamples = 576u;
constexpr std::uint32_t kMaximumGranules = 2u;
constexpr std::uint32_t kMaximumChannels = 2u;
constexpr std::uint32_t kMaximumScaleFactors = 39u;
constexpr std::uint32_t kMaximumReservoirMpeg1Bytes = 511u;
constexpr std::uint32_t kMaximumReservoirMpeg2Bytes = 255u;

enum class Profile : std::uint8_t { Mpeg2Lsf, Mpeg1 };
enum class BlockType : std::uint8_t { Long, Start, Short, Stop };

inline constexpr BlockType nextBlockType(BlockType previous, bool current_attack,
                                         bool next_attack) noexcept {
  if (previous == BlockType::Long) {
    return next_attack ? BlockType::Start : BlockType::Long;
  }
  if (previous == BlockType::Start) {
    return BlockType::Short;
  }
  if (previous == BlockType::Short) {
    // The current granule's own attack must keep the short window: with
    // back-to-back attacks the trailing attack is otherwise coded with a
    // long-family STOP window and pre-echoes.
    return current_attack || next_attack ? BlockType::Short : BlockType::Stop;
  }
  return next_attack ? BlockType::Start : BlockType::Long;
}

inline constexpr std::array<std::uint32_t, 12> kBitratesKbps = {32u,  48u,  64u,  80u,  96u,  112u,
                                                                128u, 160u, 192u, 224u, 256u, 320u};

struct ProfilePolicy final {
  std::uint32_t sampleRate = 44100u;
  std::uint32_t frameSamples = 1152u;
  std::uint32_t granules = 2u;
  std::uint32_t bitrateKbps = 64u;
  std::uint32_t cutoffLine = 417u;
  std::uint32_t shortCutoffLine = 139u;
  std::uint32_t activeLongBands = 21u;
  std::uint32_t activeShortBands = 13u;
  float initialNmrDb = 0.0F;
};

template <std::size_t N>
constexpr std::uint32_t activeBands(const std::array<std::uint16_t, N> &boundaries,
                                    std::uint32_t cutoff_line) noexcept {
  std::uint32_t result = 0u;
  while (result + 1u < N && boundaries[result] <= cutoff_line) {
    ++result;
  }
  return result;
}

inline constexpr ProfilePolicy profilePolicy(Profile profile,
                                             std::uint32_t bitrate_index) noexcept {
  const std::uint32_t maximum_index = profile == Profile::Mpeg1 ? 11u : 7u;
  if (bitrate_index > maximum_index) {
    bitrate_index = maximum_index;
  }
  const bool mpeg1 = profile == Profile::Mpeg1;
  const std::uint32_t cutoff =
      mpeg1 ? kMpeg1CutoffLines[bitrate_index] : kMpeg2CutoffLines[bitrate_index];
  return {mpeg1 ? 44100u : 22050u,
          mpeg1 ? 1152u : 576u,
          mpeg1 ? 2u : 1u,
          kBitratesKbps[bitrate_index],
          cutoff,
          cutoff / 3u,
          mpeg1 ? activeBands(kMpeg1LongBoundaries, cutoff)
                : activeBands(kMpeg2LongBoundaries, cutoff),
          mpeg1 ? activeBands(kMpeg1ShortBoundaries, cutoff / 3u)
                : activeBands(kMpeg2ShortBoundaries, cutoff / 3u),
          kInitialNmrDb[bitrate_index]};
}

struct FrameBudget final {
  std::uint32_t frameBytes = 0u;
  std::uint32_t paddingSlotBytes = 0u;
  std::uint32_t headerBits = 32u;
  std::uint32_t crcBits = 0u;
  std::uint32_t sideInfoBits = 0u;
  std::uint32_t physicalMainDataAreaBits = 0u;
  std::uint32_t logicalAduBits = 0u;
  std::uint32_t mainDataBegin = 0u;
  std::uint32_t reservoirBeforeBits = 0u;
  std::uint32_t reservoirAfterBits = 0u;
  std::uint32_t ancillaryBits = 0u;
  bool reservoirEnabled = true;
  bool valid = true;
};

class FrameBudgetState final {
public:
  void reset() noexcept {
    paddingAccumulator_ = 0u;
    reservoirBits_ = 0u;
  }

  void resetPadding() noexcept { paddingAccumulator_ = 0u; }

  void clearReservoir() noexcept { reservoirBits_ = 0u; }

  void clampReservoir(Profile profile) noexcept {
    const std::uint32_t maximum = maximumReservoirBits(profile);
    if (reservoirBits_ > maximum) {
      reservoirBits_ = maximum;
    }
  }

  [[nodiscard]] std::uint32_t reservoirBits() const noexcept { return reservoirBits_; }

  [[nodiscard]] FrameBudget beginFrame(Profile profile, std::uint32_t bitrate_kbps,
                                       std::uint32_t channels, bool reservoir_enabled) noexcept {
    const std::uint64_t sample_rate = profile == Profile::Mpeg1 ? 44100u : 22050u;
    const std::uint64_t coefficient = profile == Profile::Mpeg1 ? 144u : 72u;
    const std::uint64_t numerator = coefficient * static_cast<std::uint64_t>(bitrate_kbps) * 1000u;
    std::uint32_t frame_bytes = static_cast<std::uint32_t>(numerator / sample_rate);
    paddingAccumulator_ += numerator % sample_rate;
    std::uint32_t padding = 0u;
    if (paddingAccumulator_ >= sample_rate) {
      paddingAccumulator_ -= sample_rate;
      padding = 1u;
      ++frame_bytes;
    }

    const bool mono = channels == 1u;
    const std::uint32_t side_info =
        profile == Profile::Mpeg1 ? (mono ? 136u : 256u) : (mono ? 72u : 136u);
    FrameBudget result{};
    result.frameBytes = frame_bytes;
    result.paddingSlotBytes = padding;
    result.sideInfoBits = side_info;
    const std::uint32_t overhead = result.headerBits + result.crcBits + result.sideInfoBits;
    const std::uint32_t total = frame_bytes * 8u;
    result.physicalMainDataAreaBits = total > overhead ? total - overhead : 0u;
    result.reservoirEnabled = reservoir_enabled;
    if (!reservoir_enabled) {
      reservoirBits_ = 0u;
    }
    clampReservoir(profile);
    result.reservoirBeforeBits = reservoirBits_;
    result.mainDataBegin = reservoir_enabled ? reservoirBits_ / 8u : 0u;
    return result;
  }

  void commitFrame(Profile profile, FrameBudget &budget, std::uint32_t logical_adu_bits) noexcept {
    budget.logicalAduBits = logical_adu_bits;
    const std::uint32_t available = budget.physicalMainDataAreaBits + budget.reservoirBeforeBits;
    if (logical_adu_bits > available ||
        (!budget.reservoirEnabled && logical_adu_bits > budget.physicalMainDataAreaBits)) {
      budget.valid = false;
      budget.reservoirAfterBits = 0u;
      budget.ancillaryBits = 0u;
      reservoirBits_ = 0u;
      return;
    }
    const std::uint32_t remaining = available - logical_adu_bits;
    if (budget.reservoirEnabled) {
      const std::uint32_t byte_aligned = remaining & ~7u;
      const std::uint32_t maximum = maximumReservoirBits(profile);
      reservoirBits_ = byte_aligned < maximum ? byte_aligned : maximum;
    } else {
      reservoirBits_ = 0u;
    }
    budget.reservoirAfterBits = reservoirBits_;
    budget.ancillaryBits = remaining - reservoirBits_;
  }

private:
  static constexpr std::uint32_t maximumReservoirBits(Profile profile) noexcept {
    return (profile == Profile::Mpeg1 ? kMaximumReservoirMpeg1Bytes : kMaximumReservoirMpeg2Bytes) *
           8u;
  }

  std::uint64_t paddingAccumulator_ = 0u;
  std::uint32_t reservoirBits_ = 0u;
};

struct HuffmanRegions final {
  std::array<std::uint8_t, 3> tableSelect{};
  std::array<std::uint16_t, 2> boundaryLines{};
  std::uint8_t count1TableSelect = 0u;
  std::uint16_t bigValues = 0u;
  std::uint16_t count1 = 0u;
  std::uint32_t bigValueBits = 0u;
  std::uint32_t count1Bits = 0u;

  [[nodiscard]] constexpr std::uint32_t totalBits() const noexcept {
    return bigValueBits + count1Bits;
  }
};

struct ScaleFactorLayout final {
  std::uint16_t scalefacCompress = 0u;
  std::array<std::uint8_t, 4> slen{};
  std::array<std::uint8_t, 4> groupCounts{};
  std::uint8_t count = 0u;
};

inline constexpr ScaleFactorLayout scaleFactorLayout(Profile profile,
                                                     BlockType block_type) noexcept {
  if (profile == Profile::Mpeg2Lsf) {
    // scalefac_compress 399 selects the ISO LSF non-intensity partition with
    // slen {4, 4, 3, 3}. The initial implementation supports pure long and
    // pure short blocks; mixed blocks are not produced by this encoder.
    return block_type == BlockType::Short
               ? ScaleFactorLayout{399u, {4u, 4u, 3u, 3u}, {9u, 9u, 9u, 9u}, 36u}
               : ScaleFactorLayout{399u, {4u, 4u, 3u, 3u}, {6u, 5u, 5u, 5u}, 21u};
  }
  return block_type == BlockType::Short
             ? ScaleFactorLayout{15u, {4u, 3u, 0u, 0u}, {18u, 18u, 0u, 0u}, 36u}
             : ScaleFactorLayout{15u, {4u, 3u, 0u, 0u}, {11u, 10u, 0u, 0u}, 21u};
}

inline constexpr std::uint32_t scaleFactorBitWidth(const ScaleFactorLayout &layout,
                                                   std::uint32_t index) noexcept {
  std::uint32_t cursor = 0u;
  for (std::uint32_t group = 0u; group < layout.groupCounts.size(); ++group) {
    cursor += layout.groupCounts[group];
    if (index < cursor) {
      return layout.slen[group];
    }
  }
  return 0u;
}

inline constexpr std::uint8_t scaleFactorMaximum(const ScaleFactorLayout &layout,
                                                 std::uint32_t index) noexcept {
  const std::uint32_t width = scaleFactorBitWidth(layout, index);
  return static_cast<std::uint8_t>(width == 0u ? 0u : (1u << width) - 1u);
}

inline constexpr std::uint8_t incrementScaleFactor(const ScaleFactorLayout &layout,
                                                   std::uint32_t index,
                                                   std::uint8_t value) noexcept {
  const std::uint8_t maximum = scaleFactorMaximum(layout, index);
  return value < maximum ? static_cast<std::uint8_t>(value + 1u) : maximum;
}

inline constexpr std::uint32_t scaleFactorBits(Profile profile, BlockType block_type,
                                               std::uint32_t count) noexcept {
  const ScaleFactorLayout layout = scaleFactorLayout(profile, block_type);
  const std::uint32_t bounded_count = count < layout.count ? count : layout.count;
  std::uint32_t result = 0u;
  for (std::uint32_t index = 0u; index < bounded_count; ++index) {
    result += scaleFactorBitWidth(layout, index);
  }
  return result;
}

inline constexpr std::uint32_t shortWindowLine(Profile profile,
                                               std::uint32_t reordered_line) noexcept {
  const auto &boundaries =
      profile == Profile::Mpeg1 ? kMpeg1ShortBoundaries : kMpeg2ShortBoundaries;
  std::uint32_t cursor = 0u;
  for (std::uint32_t band = 0u; band + 1u < boundaries.size(); ++band) {
    const std::uint32_t width = boundaries[band + 1u] - boundaries[band];
    for (std::uint32_t window = 0u; window < 3u; ++window) {
      if (reordered_line < cursor + width) {
        return boundaries[band] + reordered_line - cursor;
      }
      cursor += width;
    }
  }
  return kGranuleSamples;
}

inline constexpr bool codedLine(Profile profile, BlockType block_type, std::uint32_t reordered_line,
                                std::uint32_t cutoff_line) noexcept {
  return block_type == BlockType::Short
             ? shortWindowLine(profile, reordered_line) <= cutoff_line / 3u
             : reordered_line <= cutoff_line;
}

inline constexpr std::uint32_t lastCodedLine(Profile profile, BlockType block_type,
                                             std::uint32_t cutoff_line) noexcept {
  for (std::uint32_t line = kGranuleSamples; line != 0u; --line) {
    if (codedLine(profile, block_type, line - 1u, cutoff_line)) {
      return line - 1u;
    }
  }
  return 0u;
}

inline constexpr std::uint32_t unsignedMagnitude(std::int32_t value) noexcept {
  return value < 0 ? static_cast<std::uint32_t>(-static_cast<std::int64_t>(value))
                   : static_cast<std::uint32_t>(value);
}

inline constexpr std::uint32_t huffmanPairLength(std::uint8_t table, std::int32_t first,
                                                 std::int32_t second) noexcept {
  const std::uint32_t x = unsignedMagnitude(first);
  const std::uint32_t y = unsignedMagnitude(second);
  const std::uint32_t signs = (x != 0u ? 1u : 0u) + (y != 0u ? 1u : 0u);
  if (table == 0u) {
    return x == 0u && y == 0u ? 0u : std::numeric_limits<std::uint32_t>::max();
  }
  if (table == 1u) {
    constexpr std::array<std::uint8_t, 4> lengths = {1u, 3u, 2u, 3u};
    return x <= 1u && y <= 1u ? lengths[x * 2u + y] + signs
                              : std::numeric_limits<std::uint32_t>::max();
  }
  if (table == 2u) {
    constexpr std::array<std::uint8_t, 9> lengths = {1u, 3u, 6u, 3u, 3u, 5u, 5u, 5u, 6u};
    return x <= 2u && y <= 2u ? lengths[x * 3u + y] + signs
                              : std::numeric_limits<std::uint32_t>::max();
  }
  if (table == 3u) {
    constexpr std::array<std::uint8_t, 9> lengths = {2u, 2u, 6u, 3u, 2u, 5u, 5u, 5u, 6u};
    return x <= 2u && y <= 2u ? lengths[x * 3u + y] + signs
                              : std::numeric_limits<std::uint32_t>::max();
  }
  if (table == 15u) {
    return x <= 15u && y <= 15u ? kHuffman15CodeLengths[x * 16u + y] + signs
                                : std::numeric_limits<std::uint32_t>::max();
  }

  constexpr std::array<std::uint8_t, 8> table16_linbits = {1u, 2u, 3u, 4u, 6u, 8u, 10u, 13u};
  constexpr std::array<std::uint8_t, 8> table24_linbits = {4u, 5u, 6u, 7u, 8u, 9u, 11u, 13u};
  const bool table16_family = table >= 16u && table <= 23u;
  const bool table24_family = table >= 24u && table <= 31u;
  if (!table16_family && !table24_family) {
    return std::numeric_limits<std::uint32_t>::max();
  }
  const std::uint32_t family_index = table16_family ? table - 16u : table - 24u;
  const std::uint32_t linbits =
      table16_family ? table16_linbits[family_index] : table24_linbits[family_index];
  const std::uint32_t maximum = 15u + ((1u << linbits) - 1u);
  if (x > maximum || y > maximum) {
    return std::numeric_limits<std::uint32_t>::max();
  }
  const auto &lengths = table16_family ? kHuffman16CodeLengths : kHuffman24CodeLengths;
  return lengths[(x < 15u ? x : 15u) * 16u + (y < 15u ? y : 15u)] + signs +
         (x >= 15u ? linbits : 0u) + (y >= 15u ? linbits : 0u);
}

inline std::uint32_t regionLength(const std::int32_t *values, std::uint32_t begin,
                                  std::uint32_t end, std::uint8_t table) noexcept {
  std::uint32_t result = 0u;
  for (std::uint32_t line = begin; line < end; line += 2u) {
    const std::uint32_t length = huffmanPairLength(table, values[line], values[line + 1u]);
    if (length == std::numeric_limits<std::uint32_t>::max() ||
        result > std::numeric_limits<std::uint32_t>::max() - length) {
      return std::numeric_limits<std::uint32_t>::max();
    }
    result += length;
  }
  return result;
}

inline HuffmanRegions selectHuffmanRegions(const std::int32_t *values, Profile profile,
                                           BlockType block_type,
                                           std::uint32_t cutoff_line) noexcept {
  HuffmanRegions result{};
  std::uint32_t used_lines = lastCodedLine(profile, block_type, cutoff_line) + 1u;
  while (used_lines != 0u && values[used_lines - 1u] == 0) {
    --used_lines;
  }
  std::uint32_t big_values_end = 0u;
  for (std::uint32_t line = used_lines; line != 0u; --line) {
    if (unsignedMagnitude(values[line - 1u]) > 1u) {
      big_values_end = (line + 1u) & ~1u;
      break;
    }
  }
  std::uint32_t count1_end = big_values_end + ((used_lines - big_values_end + 3u) & ~3u);
  if (count1_end > kGranuleSamples) {
    // The quad run cannot be aligned inside the granule (big_values_end == 2 mod 4
    // near the top line); absorb one more pair into big_values so every count1
    // quad stays fully inside the 576-line array.
    big_values_end += 2u;
    if (used_lines < big_values_end) {
      used_lines = big_values_end;
    }
    count1_end = big_values_end + ((used_lines - big_values_end + 3u) & ~3u);
  }
  result.bigValues = static_cast<std::uint16_t>(big_values_end / 2u);
  result.count1 = static_cast<std::uint16_t>((count1_end - big_values_end) / 4u);
  const auto &long_boundaries =
      profile == Profile::Mpeg1 ? kMpeg1LongBoundaries : kMpeg2LongBoundaries;
  const auto &short_boundaries =
      profile == Profile::Mpeg1 ? kMpeg1ShortBoundaries : kMpeg2ShortBoundaries;
  const bool switched = block_type != BlockType::Long;
  const std::uint32_t first_boundary =
      block_type == BlockType::Short ? short_boundaries[3u] * 3u : long_boundaries[8u];
  result.boundaryLines = {
      static_cast<std::uint16_t>(first_boundary),
      static_cast<std::uint16_t>(switched ? big_values_end : long_boundaries[15u])};
  if (result.boundaryLines[0] > big_values_end) {
    result.boundaryLines[0] = static_cast<std::uint16_t>(big_values_end);
  }
  if (result.boundaryLines[1] > big_values_end) {
    result.boundaryLines[1] = static_cast<std::uint16_t>(big_values_end);
  }
  result.boundaryLines[0] &= static_cast<std::uint16_t>(~1u);
  result.boundaryLines[1] &= static_cast<std::uint16_t>(~1u);
  const std::array<std::uint32_t, 4> region_points = {0u, result.boundaryLines[0],
                                                      result.boundaryLines[1], big_values_end};
  constexpr std::array<std::uint8_t, 21> candidate_tables = {0u,  1u,  2u,  3u,  15u, 16u, 17u,
                                                             18u, 19u, 20u, 21u, 22u, 23u, 24u,
                                                             25u, 26u, 27u, 28u, 29u, 30u, 31u};
  const std::uint32_t region_count = switched ? 2u : 3u;
  for (std::uint32_t region = 0u; region < region_count; ++region) {
    std::uint8_t best_table = 0u;
    std::uint32_t best_length =
        regionLength(values, region_points[region], region_points[region + 1u], 0u);
    for (const std::uint8_t table : candidate_tables) {
      const std::uint32_t length =
          regionLength(values, region_points[region], region_points[region + 1u], table);
      if (length < best_length) {
        best_length = length;
        best_table = table;
      }
    }
    result.tableSelect[region] = best_table;
    result.bigValueBits += best_length;
  }

  std::array<std::uint32_t, 2> count1_bits{};
  for (std::uint32_t line = big_values_end; line < count1_end; line += 4u) {
    std::uint32_t pattern = 0u;
    for (std::uint32_t offset = 0u; offset < 4u; ++offset) {
      pattern = (pattern << 1u) | (values[line + offset] != 0 ? 1u : 0u);
    }
    count1_bits[0u] += kCount1TotalLengths[0u][pattern];
    count1_bits[1u] += kCount1TotalLengths[1u][pattern];
  }
  result.count1TableSelect = count1_bits[1u] < count1_bits[0u] ? 1u : 0u;
  result.count1Bits = count1_bits[result.count1TableSelect];
  return result;
}

struct GranuleChannel final {
  BlockType blockType = BlockType::Long;
  bool mixedBlock = false;
  std::uint8_t globalGain = 210u;
  std::uint16_t scalefacCompress = 0u;
  std::array<std::uint8_t, 3> subblockGain{};
  std::array<std::uint8_t, kMaximumScaleFactors> scalefactors{};
  std::uint8_t scalefactorCount = 0u;
  HuffmanRegions huffman{};
  std::uint16_t part2Length = 0u;
  std::uint16_t part3Length = 0u;
  std::array<std::int32_t, kGranuleSamples> quantized{};

  [[nodiscard]] constexpr std::uint32_t part23Length() const noexcept {
    return static_cast<std::uint32_t>(part2Length) + part3Length;
  }
};

struct LogicalFrame final {
  Profile profile = Profile::Mpeg1;
  std::uint8_t channels = 2u;
  std::uint8_t granules = 2u;
  std::uint32_t bitrateKbps = 64u;
  bool midSide = false;
  std::array<std::uint8_t, 8> scfsi{};
  FrameBudget budget{};
  std::array<std::array<GranuleChannel, kMaximumChannels>, kMaximumGranules> data{};
};

inline constexpr bool midSideBlockTypesCompatible(const LogicalFrame &frame) noexcept {
  if (frame.channels != 2u) {
    return false;
  }
  for (std::uint32_t granule = 0u; granule < frame.granules; ++granule) {
    if (frame.data[granule][0u].blockType != frame.data[granule][1u].blockType) {
      return false;
    }
  }
  return true;
}

inline float requantizeLine(const GranuleChannel &channel, std::uint32_t line,
                            std::uint32_t scalefactor_band) noexcept {
  const std::int32_t code = channel.quantized[line];
  if (code == 0) {
    return 0.0F;
  }
  const double magnitude = static_cast<double>(code < 0 ? -code : code);
  const double scalefactor = scalefactor_band < channel.scalefactorCount
                                 ? static_cast<double>(channel.scalefactors[scalefactor_band])
                                 : 0.0;
  const double step =
      std::exp2((static_cast<double>(channel.globalGain) - 210.0) * 0.25 - scalefactor * 0.5);
  const double restored = std::pow(magnitude, 4.0 / 3.0) * step;
  return static_cast<float>(code < 0 ? -restored : restored);
}

inline void decodeLogicalSpectrum(const GranuleChannel &channel, Profile profile,
                                  std::uint32_t cutoff_line, float *output) noexcept {
  if (channel.blockType == BlockType::Short) {
    const auto &boundaries =
        profile == Profile::Mpeg1 ? kMpeg1ShortBoundaries : kMpeg2ShortBoundaries;
    const std::uint32_t short_cutoff = cutoff_line / 3u;
    std::uint32_t line = 0u;
    for (std::uint32_t band = 0u; band + 1u < boundaries.size(); ++band) {
      const std::uint32_t width = boundaries[band + 1u] - boundaries[band];
      for (std::uint32_t window = 0u; window < 3u; ++window) {
        for (std::uint32_t offset = 0u; offset < width; ++offset) {
          output[line] = boundaries[band] + offset <= short_cutoff
                             ? requantizeLine(channel, line, band * 3u + window)
                             : 0.0F;
          ++line;
        }
      }
    }
    while (line < kGranuleSamples) {
      output[line++] = 0.0F;
    }
    return;
  }

  const auto &boundaries = profile == Profile::Mpeg1 ? kMpeg1LongBoundaries : kMpeg2LongBoundaries;
  std::uint32_t band = 0u;
  for (std::uint32_t line = 0u; line < kGranuleSamples; ++line) {
    while (band + 1u < boundaries.size() && line >= boundaries[band + 1u]) {
      ++band;
    }
    output[line] = line <= cutoff_line ? requantizeLine(channel, line, band) : 0.0F;
  }
}

inline void applyAliasReduction(float *spectrum, bool inverse) noexcept {
  for (std::uint32_t subband = 1u; subband < 32u; ++subband) {
    for (std::uint32_t index = 0u; index < 8u; ++index) {
      const std::uint32_t lower = subband * 18u - 1u - index;
      const std::uint32_t upper = subband * 18u + index;
      const float left = spectrum[lower];
      const float right = spectrum[upper];
      if (inverse) {
        spectrum[lower] = left * kAliasCs[index] + right * kAliasCa[index];
        spectrum[upper] = right * kAliasCs[index] - left * kAliasCa[index];
      } else {
        spectrum[lower] = left * kAliasCs[index] - right * kAliasCa[index];
        spectrum[upper] = right * kAliasCs[index] + left * kAliasCa[index];
      }
    }
  }
}

} // namespace effetune::plugins::lofi::mp3

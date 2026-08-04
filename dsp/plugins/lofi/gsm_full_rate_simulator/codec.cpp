#include "codec.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace effetune::plugins::lofi::gsmfr {
namespace {

constexpr std::array<Word, kLarCount> kA{20480, 20480, 20480, 20480, 13964, 15360, 8534, 9036};
constexpr std::array<Word, kLarCount> kB{0, 0, 2048, -2560, 94, -1792, -341, -1144};
constexpr std::array<Word, kLarCount> kMic{-32, -32, -16, -16, -8, -8, -4, -4};
constexpr std::array<Word, kLarCount> kMac{31, 31, 15, 15, 7, 7, 3, 3};
constexpr std::array<Word, kLarCount> kInverseA{13107, 13107, 13107, 13107,
                                                19223, 17476, 31454, 29708};
constexpr std::array<Word, 3u> kGainDecision{6554, 16384, 26214};
constexpr std::array<Word, 4u> kGainReconstruction{3277, 11469, 21299, 32767};
constexpr std::array<Word, 11u> kWeighting{-134, -374, 0, 2054, 5741, 8192,
                                           5741, 2054, 0, -374, -134};
constexpr std::array<Word, 8u> kNormalizedReciprocal{29128, 26215, 23832, 21846,
                                                     20165, 18725, 17476, 16384};
constexpr std::array<Word, 8u> kFactor{18431, 20479, 22527, 24575, 26623, 28671, 30719, 32767};
constexpr std::array<unsigned, kLarCount> kLarWidths{6u, 6u, 5u, 5u, 4u, 4u, 3u, 3u};

#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
OverflowCounters *active_encoder_counters = nullptr;
OverflowCounters *active_decoder_counters = nullptr;

[[nodiscard]] bool wordAddOverflows(Word first, Word second) noexcept {
  const std::int32_t result = static_cast<std::int32_t>(first) + second;
  return result > std::numeric_limits<Word>::max() || result < std::numeric_limits<Word>::min();
}

[[nodiscard]] bool wordSubtractOverflows(Word first, Word second) noexcept {
  const std::int32_t result = static_cast<std::int32_t>(first) - second;
  return result > std::numeric_limits<Word>::max() || result < std::numeric_limits<Word>::min();
}

[[nodiscard]] bool longAddOverflows(Longword first, Longword second) noexcept {
  const std::int64_t result = static_cast<std::int64_t>(first) + second;
  return result > std::numeric_limits<Longword>::max() ||
         result < std::numeric_limits<Longword>::min();
}
#endif

void decodeLar(const std::array<Word, kLarCount> &coded,
               std::array<Word, kLarCount> &decoded) noexcept {
  for (std::size_t index = 0u; index < kLarCount; ++index) {
    Word value = add(coded[index], kMic[index]);
    value = arithmeticShiftLeft(value, 10u);
    value = subtract(value, arithmeticShiftLeft(kB[index], 1u));
    value = multiplyRounded(kInverseA[index], value);
    decoded[index] = add(value, value);
  }
}

void interpolateLar(const std::array<Word, kLarCount> &previous,
                    const std::array<Word, kLarCount> &current, unsigned segment,
                    std::array<Word, kLarCount> &result) noexcept {
  for (std::size_t index = 0u; index < kLarCount; ++index) {
    if (segment == 0u) {
      result[index] = add(
          add(arithmeticShiftRight(previous[index], 1u), arithmeticShiftRight(previous[index], 2u)),
          arithmeticShiftRight(current[index], 2u));
    } else if (segment == 1u) {
      result[index] =
          add(arithmeticShiftRight(previous[index], 1u), arithmeticShiftRight(current[index], 1u));
    } else if (segment == 2u) {
      result[index] = add(
          arithmeticShiftRight(previous[index], 2u),
          add(arithmeticShiftRight(current[index], 1u), arithmeticShiftRight(current[index], 2u)));
    } else {
      result[index] = current[index];
    }
  }
}

void larToReflection(std::array<Word, kLarCount> &lar) noexcept {
  for (Word &value : lar) {
    const bool negative = value < 0;
    Word magnitude = absolute(value);
    if (magnitude < 11059) {
      magnitude = arithmeticShiftLeft(magnitude, 1u);
    } else if (magnitude < 20070) {
      magnitude = add(magnitude, 11059);
    } else {
      magnitude = add(arithmeticShiftRight(magnitude, 2u), 26112);
    }
    value = negative ? static_cast<Word>(-magnitude) : magnitude;
  }
}

void analyzeSegment(Word *samples, std::size_t count, const std::array<Word, kLarCount> &reflection,
                    std::array<Word, kLarCount> &state) noexcept {
  for (std::size_t sample = 0u; sample < count; ++sample) {
    Word residual = samples[sample];
    Word saved = residual;
    for (std::size_t index = 0u; index < kLarCount; ++index) {
      const Word first_product = multiplyRounded(reflection[index], residual);
      const Word second_product = multiplyRounded(reflection[index], state[index]);
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
      if (active_encoder_counters != nullptr && wordAddOverflows(state[index], first_product)) {
        ++active_encoder_counters->encoderAnalysisFirstAdd;
      }
      if (active_encoder_counters != nullptr && wordAddOverflows(residual, second_product)) {
        ++active_encoder_counters->encoderAnalysisSecondAdd;
      }
#endif
      const Word temporary = add(state[index], first_product);
      residual = add(residual, second_product);
      state[index] = saved;
      saved = temporary;
    }
    samples[sample] = residual;
  }
}

void synthesizeSegment(Word *samples, std::size_t count,
                       const std::array<Word, kLarCount> &reflection,
                       std::array<Word, 9u> &state) noexcept {
  for (std::size_t sample = 0u; sample < count; ++sample) {
    Word value = samples[sample];
    for (std::size_t reverse = kLarCount; reverse-- > 0u;) {
      const Word first_product = multiplyRounded(reflection[reverse], state[reverse]);
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
      if (active_decoder_counters != nullptr && wordSubtractOverflows(value, first_product)) {
        ++active_decoder_counters->decoderSynthesisFirstAdd;
      }
#endif
      value = subtract(value, first_product);
      const Word second_product = multiplyRounded(reflection[reverse], value);
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
      if (active_decoder_counters != nullptr && wordAddOverflows(state[reverse], second_product)) {
        ++active_decoder_counters->decoderSynthesisSecondAdd;
      }
#endif
      state[reverse + 1u] = add(state[reverse], second_product);
    }
    state[0u] = value;
    samples[sample] = value;
  }
}

void transformReflectionToLar(std::array<Word, kLarCount> &reflection) noexcept {
  for (Word &value : reflection) {
    const bool negative = value < 0;
    Word magnitude = absolute(value);
    if (magnitude < 22118) {
      magnitude = arithmeticShiftRight(magnitude, 1u);
    } else if (magnitude < 31130) {
      magnitude = subtract(magnitude, 11059);
    } else {
      magnitude = arithmeticShiftLeft(subtract(magnitude, 26112), 2u);
    }
    value = negative ? static_cast<Word>(-magnitude) : magnitude;
  }
}

void reflectionFromAutocorrelation(const std::array<Longword, 9u> &autocorrelation,
                                   std::array<Word, kLarCount> &reflection) noexcept {
  reflection.fill(0);
  if (autocorrelation[0u] == 0) {
    return;
  }
  const Word shift = normalize(autocorrelation[0u]);
  std::array<Word, 9u> p{};
  std::array<Word, 9u> k{};
  for (std::size_t index = 0u; index < 9u; ++index) {
    const Longword scaled =
        arithmeticShiftLeft(autocorrelation[index], static_cast<unsigned>(shift));
    p[index] = static_cast<Word>(arithmeticShiftRight(scaled, 16u));
  }
  for (std::size_t index = 1u; index <= 7u; ++index) {
    k[9u - index] = p[index];
  }
  for (std::size_t order = 1u; order <= kLarCount; ++order) {
    if (p[0u] < absolute(p[1u])) {
      return;
    }
    Word coefficient = divide(absolute(p[1u]), p[0u]);
    if (p[1u] > 0) {
      coefficient = static_cast<Word>(-coefficient);
    }
    reflection[order - 1u] = coefficient;
    if (order == kLarCount) {
      return;
    }
    p[0u] = add(p[0u], multiplyRounded(p[1u], coefficient));
    for (std::size_t index = 1u; index <= kLarCount - order; ++index) {
      const Word next = p[index + 1u];
      const std::size_t backward = 9u - index;
      p[index] = add(next, multiplyRounded(k[backward], coefficient));
      k[backward] = add(k[backward], multiplyRounded(next, coefficient));
    }
  }
}

void weightResidual(const Word *residual, std::array<Word, kSubframeSamples> &weighted) noexcept {
  std::array<Word, 50u> padded{};
  for (std::size_t index = 0u; index < kSubframeSamples; ++index) {
    padded[index + 5u] = residual[index];
  }
  for (std::size_t sample = 0u; sample < kSubframeSamples; ++sample) {
    Longword sum = 8192;
    for (std::size_t tap = 0u; tap < kWeighting.size(); ++tap) {
      sum = longAdd(sum, longMultiply(padded[sample + tap], kWeighting[tap]));
    }
    for (unsigned scaling = 0u; scaling < 2u; ++scaling) {
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
      if (active_encoder_counters != nullptr && longAddOverflows(sum, sum)) {
        ++active_encoder_counters->encoderWeightingScale;
      }
#endif
      sum = longAdd(sum, sum);
    }
    weighted[sample] = saturateWord(arithmeticShiftRight(sum, 16u));
  }
}

Word selectGrid(const std::array<Word, kSubframeSamples> &weighted,
                std::array<Word, kPulseCount> &selected) noexcept {
  Longword best_energy = 0;
  Word best_grid = 0;
  for (Word grid = 0; grid < 4; ++grid) {
    Longword energy = 0;
    for (std::size_t pulse = 0u; pulse < kPulseCount; ++pulse) {
      const Word value =
          arithmeticShiftRight(weighted[static_cast<std::size_t>(grid) + 3u * pulse], 2u);
      energy = longAdd(energy, longMultiply(value, value));
    }
    if (energy > best_energy) {
      best_energy = energy;
      best_grid = grid;
    }
  }
  for (std::size_t pulse = 0u; pulse < kPulseCount; ++pulse) {
    selected[pulse] = weighted[static_cast<std::size_t>(best_grid) + 3u * pulse];
  }
  return best_grid;
}

void exponentAndMantissa(Word maximum_code, Word &exponent, Word &mantissa) noexcept {
  exponent = 0;
  if (maximum_code > 15) {
    exponent = subtract(arithmeticShiftRight(maximum_code, 3u), 1);
  }
  mantissa = subtract(maximum_code, arithmeticShiftLeft(exponent, 3u));
  if (mantissa == 0) {
    exponent = -4;
    mantissa = 7;
    return;
  }
  for (unsigned index = 0u; index < 3u && mantissa <= 7; ++index) {
    mantissa = static_cast<Word>((mantissa << 1u) | 1);
    --exponent;
  }
  mantissa = subtract(mantissa, 8);
}

Word apcmQuantize(const std::array<Word, kPulseCount> &selected,
                  std::array<Word, kPulseCount> &codes) noexcept {
  Word maximum = 0;
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
  bool saturated_absolute = false;
#endif
  for (Word value : selected) {
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
    saturated_absolute = saturated_absolute || value == std::numeric_limits<Word>::min();
#endif
    const Word magnitude = absolute(value);
    if (magnitude > maximum) {
      maximum = magnitude;
    }
  }
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
  if (active_encoder_counters != nullptr && saturated_absolute) {
    ++active_encoder_counters->encoderApcmAbsolute;
  }
#endif
  Word exponent = 0;
  Word temporary = arithmeticShiftRight(maximum, 9u);
  for (unsigned index = 0u; index < 6u; ++index) {
    if (temporary > 0) {
      ++exponent;
    }
    temporary = arithmeticShiftRight(temporary, 1u);
  }
  const Word maximum_code = add(arithmeticShiftRight(maximum, static_cast<unsigned>(exponent + 5)),
                                arithmeticShiftLeft(exponent, 3u));
  Word mantissa = 0;
  exponentAndMantissa(maximum_code, exponent, mantissa);
  const unsigned shift = static_cast<unsigned>(6 - exponent);
  for (std::size_t pulse = 0u; pulse < kPulseCount; ++pulse) {
    Word value = arithmeticShiftLeft(selected[pulse], shift);
    value = multiply(value, kNormalizedReciprocal[static_cast<std::size_t>(mantissa)]);
    codes[pulse] = static_cast<Word>(arithmeticShiftRight(value, 12u) + 4);
  }
  return maximum_code;
}

void apcmDecode(Word maximum_code, const std::array<Word, kPulseCount> &codes,
                std::array<Word, kPulseCount> &decoded) noexcept {
  Word exponent = 0;
  Word mantissa = 0;
  exponentAndMantissa(maximum_code, exponent, mantissa);
  const Word factor = kFactor[static_cast<std::size_t>(mantissa)];
  const unsigned shift = static_cast<unsigned>(6 - exponent);
  const Word rounding =
      shift == 0u ? static_cast<Word>(0) : arithmeticShiftLeft(static_cast<Word>(1), shift - 1u);
  for (std::size_t pulse = 0u; pulse < kPulseCount; ++pulse) {
    Word value = subtract(arithmeticShiftLeft(codes[pulse], 1u), 7);
    value = arithmeticShiftLeft(value, 12u);
    value = multiplyRounded(factor, value);
    value = add(value, rounding);
    decoded[pulse] = arithmeticShiftRight(value, shift);
  }
}

void positionGrid(Word grid, const std::array<Word, kPulseCount> &pulses,
                  std::array<Word, kSubframeSamples> &residual) noexcept {
  residual.fill(0);
  const std::size_t offset = grid >= 0 && grid <= 3 ? static_cast<std::size_t>(grid) : 0u;
  for (std::size_t pulse = 0u; pulse < kPulseCount; ++pulse) {
    residual[offset + 3u * pulse] = pulses[pulse];
  }
}

class BitWriter final {
public:
  explicit BitWriter(std::array<std::uint8_t, kPackedBytes> &bytes) noexcept : bytes_(bytes) {}
  void write(unsigned value, unsigned width) noexcept {
    for (unsigned bit = width; bit-- > 0u;) {
      const unsigned byte = position_ >> 3u;
      const unsigned offset = 7u - (position_ & 7u);
      bytes_[byte] = static_cast<std::uint8_t>(bytes_[byte] | (((value >> bit) & 1u) << offset));
      ++position_;
    }
  }

private:
  std::array<std::uint8_t, kPackedBytes> &bytes_;
  unsigned position_ = 0u;
};

class BitReader final {
public:
  explicit BitReader(const std::array<std::uint8_t, kPackedBytes> &bytes) noexcept
      : bytes_(bytes) {}
  [[nodiscard]] unsigned read(unsigned width) noexcept {
    unsigned value = 0u;
    for (unsigned bit = 0u; bit < width; ++bit) {
      const unsigned byte = position_ >> 3u;
      const unsigned offset = 7u - (position_ & 7u);
      value = (value << 1u) | ((bytes_[byte] >> offset) & 1u);
      ++position_;
    }
    return value;
  }

private:
  const std::array<std::uint8_t, kPackedBytes> &bytes_;
  unsigned position_ = 0u;
};

} // namespace

Word saturateWord(std::int64_t value) noexcept {
  if (value > std::numeric_limits<Word>::max()) {
    return std::numeric_limits<Word>::max();
  }
  if (value < std::numeric_limits<Word>::min()) {
    return std::numeric_limits<Word>::min();
  }
  return static_cast<Word>(value);
}

Longword saturateLong(std::int64_t value) noexcept {
  if (value > std::numeric_limits<Longword>::max()) {
    return std::numeric_limits<Longword>::max();
  }
  if (value < std::numeric_limits<Longword>::min()) {
    return std::numeric_limits<Longword>::min();
  }
  return static_cast<Longword>(value);
}

Word add(Word first, Word second) noexcept {
  return saturateWord(static_cast<std::int32_t>(first) + static_cast<std::int32_t>(second));
}

Word subtract(Word first, Word second) noexcept {
  return saturateWord(static_cast<std::int32_t>(first) - static_cast<std::int32_t>(second));
}

Longword longAdd(Longword first, Longword second) noexcept {
  return saturateLong(static_cast<std::int64_t>(first) + static_cast<std::int64_t>(second));
}

Longword longSubtract(Longword first, Longword second) noexcept {
  return saturateLong(static_cast<std::int64_t>(first) - static_cast<std::int64_t>(second));
}

Word absolute(Word value) noexcept {
  return value == std::numeric_limits<Word>::min() ? std::numeric_limits<Word>::max()
                                                   : static_cast<Word>(value < 0 ? -value : value);
}

Word multiply(Word first, Word second) noexcept {
  if (first == std::numeric_limits<Word>::min() && second == std::numeric_limits<Word>::min()) {
    return std::numeric_limits<Word>::max();
  }
  return static_cast<Word>((static_cast<std::int32_t>(first) * second) >> 15u);
}

Word multiplyRounded(Word first, Word second) noexcept {
  if (first == std::numeric_limits<Word>::min() && second == std::numeric_limits<Word>::min()) {
    return std::numeric_limits<Word>::max();
  }
  return saturateWord((static_cast<std::int32_t>(first) * second + 16384) >> 15u);
}

Longword longMultiply(Word first, Word second) noexcept {
  if (first == std::numeric_limits<Word>::min() && second == std::numeric_limits<Word>::min()) {
    return std::numeric_limits<Longword>::max();
  }
  return static_cast<Longword>(static_cast<std::int64_t>(first) * second * 2);
}

Word arithmeticShiftRight(Word value, unsigned shift) noexcept {
  if (shift == 0u) {
    return value;
  }
  if (shift >= 15u) {
    return value < 0 ? static_cast<Word>(-1) : static_cast<Word>(0);
  }
  return value >= 0 ? static_cast<Word>(value >> shift)
                    : static_cast<Word>(-1 - ((-1 - static_cast<std::int32_t>(value)) >> shift));
}

Longword arithmeticShiftRight(Longword value, unsigned shift) noexcept {
  if (shift == 0u) {
    return value;
  }
  if (shift >= 31u) {
    return value < 0 ? -1 : 0;
  }
  return value >= 0
             ? static_cast<Longword>(value >> shift)
             : static_cast<Longword>(-1 - ((-1 - static_cast<std::int64_t>(value)) >> shift));
}

Word arithmeticShiftLeft(Word value, unsigned shift) noexcept {
  if (shift >= 31u) {
    return value < 0   ? std::numeric_limits<Word>::min()
           : value > 0 ? std::numeric_limits<Word>::max()
                       : 0;
  }
  return saturateWord(static_cast<std::int64_t>(value) * (std::int64_t{1} << shift));
}

Longword arithmeticShiftLeft(Longword value, unsigned shift) noexcept {
  if (shift >= 63u) {
    return value < 0   ? std::numeric_limits<Longword>::min()
           : value > 0 ? std::numeric_limits<Longword>::max()
                       : 0;
  }
  return saturateLong(static_cast<std::int64_t>(value) * (std::int64_t{1} << shift));
}

Word normalize(Longword value) noexcept {
  if (value == 0) {
    return 0;
  }
  std::uint32_t magnitude =
      value < 0 ? static_cast<std::uint32_t>(~value) : static_cast<std::uint32_t>(value);
  if (magnitude == 0u) {
    // value == -1: ~value is 0 and would loop forever; ETSI norm_l returns 31.
    return 31;
  }
  Word count = 0;
  while (magnitude < 0x40000000u) {
    magnitude <<= 1u;
    ++count;
  }
  return count;
}

Word divide(Word numerator, Word denominator) noexcept {
  if (numerator <= 0) {
    return 0;
  }
  if (numerator >= denominator) {
    return 32767;
  }
  std::uint32_t dividend = static_cast<std::uint16_t>(numerator);
  const std::uint32_t divisor = static_cast<std::uint16_t>(denominator);
  std::uint32_t quotient = 0u;
  for (unsigned bit = 0u; bit < 15u; ++bit) {
    quotient <<= 1u;
    dividend <<= 1u;
    if (dividend >= divisor) {
      dividend -= divisor;
      ++quotient;
    }
  }
  return static_cast<Word>(quotient);
}

void Encoder::reset() noexcept {
  offset_input_state_ = 0;
  offset_state_ = 0;
  preemphasis_state_ = 0;
  previous_lar_.fill(0);
  analysis_state_.fill(0);
  residual_history_.fill(0);
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
  counters_ = {};
#endif
}

void Encoder::preprocess(std::array<Word, kFrameSamples> &samples) noexcept {
  for (Word &sample : samples) {
    const Word downscaled = arithmeticShiftLeft(arithmeticShiftRight(sample, 3u), 2u);
    const Word difference = subtract(downscaled, offset_input_state_);
    offset_input_state_ = downscaled;
    const Word most = static_cast<Word>(arithmeticShiftRight(offset_state_, 15u));
    const Longword least = longSubtract(offset_state_, static_cast<Longword>(most) * 32768);
    Longword filtered = arithmeticShiftLeft(static_cast<Longword>(difference), 15u);
    filtered = longAdd(filtered, multiplyRounded(static_cast<Word>(least), 32735));
    offset_state_ = longAdd(arithmeticShiftRight(longMultiply(most, 32735), 1u), filtered);
    const Word current =
        static_cast<Word>(arithmeticShiftRight(longAdd(offset_state_, 16384), 15u));
    sample = add(current, multiplyRounded(preemphasis_state_, -28180));
    preemphasis_state_ = current;
  }
}

void Encoder::analyzeLpc(std::array<Word, kFrameSamples> &samples,
                         std::array<Word, kLarCount> &lar) noexcept {
  Word maximum = 0;
  for (Word sample : samples) {
    const Word magnitude = absolute(sample);
    if (magnitude > maximum) {
      maximum = magnitude;
    }
  }
  Word scale = 0;
  if (maximum != 0) {
    const Word shift = normalize(arithmeticShiftLeft(static_cast<Longword>(maximum), 16u));
    scale = subtract(4, shift);
  }
  if (scale > 0) {
    const Word factor =
        arithmeticShiftRight(static_cast<Word>(16384), static_cast<unsigned>(scale - 1));
    for (Word &sample : samples) {
      sample = multiplyRounded(sample, factor);
    }
  }
  std::array<Longword, 9u> autocorrelation{};
  for (std::size_t lag = 0u; lag < autocorrelation.size(); ++lag) {
    Longword sum = 0;
    for (std::size_t index = lag; index < kFrameSamples; ++index) {
      sum = longAdd(sum, longMultiply(samples[index], samples[index - lag]));
    }
    autocorrelation[lag] = sum;
  }
  if (scale > 0) {
    for (Word &sample : samples) {
      sample = arithmeticShiftLeft(sample, static_cast<unsigned>(scale));
    }
  }
  reflectionFromAutocorrelation(autocorrelation, lar);
  transformReflectionToLar(lar);
}

void Encoder::quantizeLar(std::array<Word, kLarCount> &lar) noexcept {
  for (std::size_t index = 0u; index < kLarCount; ++index) {
    Word value = multiply(kA[index], lar[index]);
    value = add(value, kB[index]);
    value = add(value, 256);
    value = arithmeticShiftRight(value, 9u);
    if (value > kMac[index]) {
      lar[index] = subtract(kMac[index], kMic[index]);
    } else if (value < kMic[index]) {
      lar[index] = 0;
    } else {
      lar[index] = subtract(value, kMic[index]);
    }
  }
}

void Encoder::shortTermAnalysis(const std::array<Word, kLarCount> &coded_lar,
                                std::array<Word, kFrameSamples> &samples) noexcept {
  std::array<Word, kLarCount> decoded{};
  std::array<Word, kLarCount> reflection{};
  decodeLar(coded_lar, decoded);
  constexpr std::array<std::size_t, 4u> kStarts{0u, 13u, 27u, 40u};
  constexpr std::array<std::size_t, 4u> kLengths{13u, 14u, 13u, 120u};
  for (unsigned segment = 0u; segment < 4u; ++segment) {
    interpolateLar(previous_lar_, decoded, segment, reflection);
    larToReflection(reflection);
    analyzeSegment(samples.data() + kStarts[segment], kLengths[segment], reflection,
                   analysis_state_);
  }
  previous_lar_ = decoded;
}

void Encoder::encodeSubframe(const Word *residual, Subframe &subframe,
                             Word *reconstructed) noexcept {
  Word maximum = 0;
  for (std::size_t index = 0u; index < kSubframeSamples; ++index) {
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
    if (active_encoder_counters != nullptr && residual[index] == std::numeric_limits<Word>::min()) {
      ++active_encoder_counters->encoderLtpAbsolute;
    }
#endif
    const Word magnitude = absolute(residual[index]);
    if (magnitude > maximum) {
      maximum = magnitude;
    }
  }
  Word scale = 0;
  if (maximum != 0) {
    const Word normalization = normalize(arithmeticShiftLeft(static_cast<Longword>(maximum), 16u));
    scale = normalization > 6 ? 0 : subtract(6, normalization);
  }
  std::array<Word, kSubframeSamples> scaled{};
  for (std::size_t index = 0u; index < kSubframeSamples; ++index) {
    scaled[index] = arithmeticShiftRight(residual[index], static_cast<unsigned>(scale));
  }
  Longword best = 0;
  Word lag = 40;
  for (Word candidate = 40; candidate <= 120; ++candidate) {
    Longword correlation = 0;
    for (std::size_t index = 0u; index < kSubframeSamples; ++index) {
      correlation = longAdd(
          correlation, longMultiply(scaled[index],
                                    reconstructed[static_cast<std::ptrdiff_t>(index) - candidate]));
    }
    if (correlation > best) {
      best = correlation;
      lag = candidate;
    }
  }
  best = arithmeticShiftRight(best, static_cast<unsigned>(6 - scale));
  Longword power = 0;
  for (std::size_t index = 0u; index < kSubframeSamples; ++index) {
    const Word value =
        arithmeticShiftRight(reconstructed[static_cast<std::ptrdiff_t>(index) - lag], 3u);
    power = longAdd(power, longMultiply(value, value));
  }
  Word gain = 0;
  if (best > 0 && best < power) {
    const Word normalization = normalize(power);
    const Word numerator = static_cast<Word>(
        arithmeticShiftRight(arithmeticShiftLeft(best, static_cast<unsigned>(normalization)), 16u));
    const Word denominator = static_cast<Word>(arithmeticShiftRight(
        arithmeticShiftLeft(power, static_cast<unsigned>(normalization)), 16u));
    for (; gain < 3; ++gain) {
      if (numerator <= multiply(denominator, kGainDecision[static_cast<std::size_t>(gain)])) {
        break;
      }
    }
  } else if (best >= power && best > 0) {
    gain = 3;
  }
  subframe.lag = lag;
  subframe.gain = gain;
  const Word reconstructed_gain = kGainReconstruction[static_cast<std::size_t>(gain)];
  std::array<Word, kSubframeSamples> long_term_residual{};
  for (std::size_t index = 0u; index < kSubframeSamples; ++index) {
    const Word prediction = multiplyRounded(
        reconstructed_gain, reconstructed[static_cast<std::ptrdiff_t>(index) - lag]);
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
    if (active_encoder_counters != nullptr && wordSubtractOverflows(residual[index], prediction)) {
      ++active_encoder_counters->encoderLongTermSubtract;
    }
#endif
    long_term_residual[index] = subtract(residual[index], prediction);
  }
  std::array<Word, kSubframeSamples> weighted{};
  weightResidual(long_term_residual.data(), weighted);
  std::array<Word, kPulseCount> selected{};
  subframe.grid = selectGrid(weighted, selected);
  subframe.maximum = apcmQuantize(selected, subframe.pulses);
  std::array<Word, kPulseCount> decoded_pulses{};
  apcmDecode(subframe.maximum, subframe.pulses, decoded_pulses);
  std::array<Word, kSubframeSamples> excitation{};
  positionGrid(subframe.grid, decoded_pulses, excitation);
  for (std::size_t index = 0u; index < kSubframeSamples; ++index) {
    const Word prediction = multiplyRounded(
        reconstructed_gain, reconstructed[static_cast<std::ptrdiff_t>(index) - lag]);
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
    if (active_encoder_counters != nullptr && wordAddOverflows(excitation[index], prediction)) {
      ++active_encoder_counters->encoderHistoryAdd;
    }
#endif
    reconstructed[index] = add(excitation[index], prediction);
  }
}

Frame Encoder::encode(const std::array<Word, kFrameSamples> &input) noexcept {
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
  active_encoder_counters = &counters_;
#endif
  std::array<Word, kFrameSamples> samples = input;
  preprocess(samples);
  Frame frame{};
  analyzeLpc(samples, frame.lar);
  quantizeLar(frame.lar);
  shortTermAnalysis(frame.lar, samples);
  Word *history = residual_history_.data() + 120u;
  for (std::size_t subframe = 0u; subframe < kSubframes; ++subframe) {
    encodeSubframe(samples.data() + subframe * kSubframeSamples, frame.subframes[subframe],
                   history + subframe * kSubframeSamples);
  }
  std::copy(residual_history_.begin() + 160, residual_history_.end(), residual_history_.begin());
  return frame;
}

void Decoder::reset() noexcept {
  previous_frame_ = Frame{};
  has_good_frame_ = false;
  concealment_state_ = 0u;
  previous_lag_ = 40;
  deemphasis_state_ = 0;
  previous_lar_.fill(0);
  synthesis_state_.fill(0);
  residual_history_.fill(0);
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
  counters_ = {};
#endif
}

void Decoder::shortTermSynthesis(const std::array<Word, kLarCount> &coded_lar,
                                 std::array<Word, kFrameSamples> &samples) noexcept {
  std::array<Word, kLarCount> decoded{};
  std::array<Word, kLarCount> reflection{};
  decodeLar(coded_lar, decoded);
  constexpr std::array<std::size_t, 4u> kStarts{0u, 13u, 27u, 40u};
  constexpr std::array<std::size_t, 4u> kLengths{13u, 14u, 13u, 120u};
  for (unsigned segment = 0u; segment < 4u; ++segment) {
    interpolateLar(previous_lar_, decoded, segment, reflection);
    larToReflection(reflection);
    synthesizeSegment(samples.data() + kStarts[segment], kLengths[segment], reflection,
                      synthesis_state_);
  }
  previous_lar_ = decoded;
}

std::array<Word, kFrameSamples> Decoder::decode(const Frame &frame, bool bad_frame) noexcept {
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
  active_decoder_counters = &counters_;
#endif
  // GSM 06.11 error concealment. A good frame is used verbatim and clears the substitution run,
  // so this path stays bit-identical to the plain decoder whenever bad_frame is false.
  Frame effective = frame;
  bool mute_excitation = false;
  if (bad_frame) {
    // Erasures that arrive before any good frame have nothing to substitute. The all-zero
    // placeholder is not silence for this codec: Xmaxc 0 remaps to the largest APCM factor and
    // every pulse code 0 decodes to -7, so repeating it emits a loud negative DC offset. Mute
    // straight away instead, reusing the machinery of the six consecutive erasure mute state.
    const bool no_reference = !has_good_frame_;
    effective = previous_frame_;
    for (Subframe &subframe : effective.subframes) {
      const Word attenuated = static_cast<Word>(subframe.maximum - kConcealmentMaximumStep);
      subframe.maximum = attenuated > 0 ? attenuated : 0;
    }
    if (concealment_state_ < kConcealmentMuteState) {
      ++concealment_state_;
    }
    mute_excitation = no_reference || concealment_state_ >= kConcealmentMuteState;
    if (mute_excitation) {
      // The reconstruction gain for code 3 is unity, so a muted excitation alone would leave the
      // long term predictor recirculating its history forever. Collapse the gain as well.
      for (Subframe &subframe : effective.subframes) {
        subframe.gain = 0;
        if (no_reference) {
          subframe.maximum = 0;
        }
      }
    }
  } else {
    concealment_state_ = 0u;
    has_good_frame_ = true;
  }
  previous_frame_ = effective;

  std::array<Word, kFrameSamples> result{};
  Word *history = residual_history_.data() + 120u;
  for (std::size_t subframe_index = 0u; subframe_index < kSubframes; ++subframe_index) {
    const Subframe &subframe = effective.subframes[subframe_index];
    std::array<Word, kPulseCount> pulses{};
    std::array<Word, kSubframeSamples> excitation{};
    apcmDecode(subframe.maximum, subframe.pulses, pulses);
    positionGrid(subframe.grid, pulses, excitation);
    if (mute_excitation) {
      excitation.fill(0);
    }
    const Word lag = subframe.lag >= 40 && subframe.lag <= 120 ? subframe.lag : previous_lag_;
    previous_lag_ = lag;
    const Word gain = subframe.gain >= 0 && subframe.gain <= 3 ? subframe.gain : 0;
    const Word factor = kGainReconstruction[static_cast<std::size_t>(gain)];
    Word *current = history + subframe_index * kSubframeSamples;
    for (std::size_t index = 0u; index < kSubframeSamples; ++index) {
      const Word prediction =
          multiplyRounded(factor, current[static_cast<std::ptrdiff_t>(index) - lag]);
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
      if (wordAddOverflows(excitation[index], prediction)) {
        ++counters_.decoderLongTermAdd;
      }
#endif
      current[index] = add(excitation[index], prediction);
      result[subframe_index * kSubframeSamples + index] = current[index];
    }
  }
  std::copy(residual_history_.begin() + 160, residual_history_.end(), residual_history_.begin());
  shortTermSynthesis(effective.lar, result);
  for (Word &sample : result) {
    const Word deemphasis = multiplyRounded(deemphasis_state_, 28180);
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
    if (wordAddOverflows(sample, deemphasis)) {
      ++counters_.decoderDeemphasisAdd;
    }
#endif
    deemphasis_state_ = add(sample, deemphasis);
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
    if (wordAddOverflows(deemphasis_state_, deemphasis_state_)) {
      ++counters_.decoderUpscaleAdd;
    }
#endif
    const Word doubled = add(deemphasis_state_, deemphasis_state_);
    sample = static_cast<Word>(static_cast<std::uint16_t>(doubled) & 0xfff8u);
  }
  return result;
}

std::array<Word, kFrameWords> frameToWords(const Frame &frame) noexcept {
  std::array<Word, kFrameWords> words{};
  std::size_t position = 0u;
  for (Word value : frame.lar) {
    words[position++] = value;
  }
  for (const Subframe &subframe : frame.subframes) {
    words[position++] = subframe.lag;
    words[position++] = subframe.gain;
    words[position++] = subframe.grid;
    words[position++] = subframe.maximum;
    for (Word pulse : subframe.pulses) {
      words[position++] = pulse;
    }
  }
  return words;
}

Frame wordsToFrame(const std::array<Word, kFrameWords> &words) noexcept {
  Frame frame{};
  std::size_t position = 0u;
  for (Word &value : frame.lar) {
    value = words[position++];
  }
  for (Subframe &subframe : frame.subframes) {
    subframe.lag = words[position++];
    subframe.gain = words[position++];
    subframe.grid = words[position++];
    subframe.maximum = words[position++];
    for (Word &pulse : subframe.pulses) {
      pulse = words[position++];
    }
  }
  return frame;
}

std::array<std::uint8_t, kPackedBytes> packFrame(const Frame &frame) noexcept {
  std::array<std::uint8_t, kPackedBytes> bytes{};
  BitWriter writer(bytes);
  writer.write(0xdu, 4u);
  for (std::size_t index = 0u; index < kLarCount; ++index) {
    writer.write(static_cast<unsigned>(frame.lar[index]), kLarWidths[index]);
  }
  for (const Subframe &subframe : frame.subframes) {
    writer.write(static_cast<unsigned>(subframe.lag), 7u);
    writer.write(static_cast<unsigned>(subframe.gain), 2u);
    writer.write(static_cast<unsigned>(subframe.grid), 2u);
    writer.write(static_cast<unsigned>(subframe.maximum), 6u);
    for (Word pulse : subframe.pulses) {
      writer.write(static_cast<unsigned>(pulse), 3u);
    }
  }
  return bytes;
}

bool unpackFrame(const std::array<std::uint8_t, kPackedBytes> &bytes, Frame &frame) noexcept {
  BitReader reader(bytes);
  if (reader.read(4u) != 0xdu) {
    return false;
  }
  for (std::size_t index = 0u; index < kLarCount; ++index) {
    frame.lar[index] = static_cast<Word>(reader.read(kLarWidths[index]));
  }
  for (Subframe &subframe : frame.subframes) {
    subframe.lag = static_cast<Word>(reader.read(7u));
    subframe.gain = static_cast<Word>(reader.read(2u));
    subframe.grid = static_cast<Word>(reader.read(2u));
    subframe.maximum = static_cast<Word>(reader.read(6u));
    for (Word &pulse : subframe.pulses) {
      pulse = static_cast<Word>(reader.read(3u));
    }
  }
  return true;
}

} // namespace effetune::plugins::lofi::gsmfr

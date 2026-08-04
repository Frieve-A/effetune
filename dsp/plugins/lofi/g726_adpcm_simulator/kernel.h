#ifndef EFFETUNE_G726_ADPCM_SIMULATOR_KERNEL_H
#define EFFETUNE_G726_ADPCM_SIMULATOR_KERNEL_H

#include <array>
#include <cstddef>
#include <cstdint>

namespace effetune::plugins::lofi::g726 {

// ITU-T G.726 uses fixed-width words throughout the signal path. This core keeps
// those words unsigned and masks every update so native and WebAssembly builds do
// not depend on signed overflow or implementation-defined shifts.
class Codec final {
public:
  struct StateSnapshot final {
    std::uint32_t yl;
    std::uint32_t yu;
    std::uint32_t dms;
    std::uint32_t dml;
    std::uint32_t ap;
    std::array<std::uint16_t, 2u> a;
    std::array<std::uint16_t, 6u> b;
    std::array<std::uint16_t, 2u> pk;
    std::array<std::uint16_t, 6u> dq;
    std::array<std::uint16_t, 2u> sr;
    std::uint16_t td;
  };

  struct Analysis final {
    std::uint32_t se;
    std::uint32_t sez;
    std::uint32_t y;
    std::uint32_t difference;
    std::uint32_t normalizedLog;
    std::uint32_t sign;
    std::uint8_t code;
  };

  explicit Codec(std::uint32_t bits_per_sample = 4u) noexcept { reset(bits_per_sample); }

  void reset(std::uint32_t bits_per_sample) noexcept {
    bits_ = validBits(bits_per_sample) ? bits_per_sample : 4u;
    state_ = {};
    state_.yl = 34816u;
    state_.yu = 544u;
    state_.dq.fill(32u);
    state_.sr.fill(32u);
  }

  [[nodiscard]] std::uint32_t bitsPerSample() const noexcept { return bits_; }

  [[nodiscard]] static std::int16_t annexALimit(std::uint32_t reconstructed) noexcept {
    return limitOutput(reconstructed);
  }

  [[nodiscard]] StateSnapshot stateSnapshot() const noexcept {
    return {state_.yl, state_.yu, state_.dms, state_.dml, state_.ap, state_.a,
            state_.b,  state_.pk, state_.dq,  state_.sr,  state_.td};
  }

  [[nodiscard]] Analysis analyze(std::int16_t linear_pcm) const noexcept {
    const Predictor predictor = predict(state_);
    const std::uint32_t y = scale(state_);
    const std::uint32_t sl = static_cast<std::uint16_t>(linear_pcm) & 16383u;
    const std::uint32_t sli = (sl & 8192u) == 0u ? sl : 49152u + sl;
    const std::uint32_t sei = (predictor.se & 16384u) == 0u ? predictor.se : 32768u + predictor.se;
    const std::uint32_t difference = (sli + 65536u - sei) & 65535u;
    const LogValue logged = logarithm(difference);
    const std::uint32_t dln = (logged.value + 4096u - (y >> 2u)) & 4095u;
    return {predictor.se,
            predictor.sez,
            y,
            difference,
            dln,
            logged.sign,
            quantize(dln, logged.sign, bits_)};
  }

  [[nodiscard]] std::uint8_t encode(std::int16_t linear_pcm) noexcept {
    const Analysis analysis = analyze(linear_pcm);
    const Predictor predictor{analysis.se, analysis.sez};
    const std::uint8_t code = analysis.code;
    const std::uint32_t dq = inverseQuantize(code, bits_, analysis.y);
    update(state_, code, bits_, analysis.y, dq, predictor);
    return code;
  }

  [[nodiscard]] std::int16_t decode(std::uint8_t code) noexcept {
    const std::uint32_t mask = (1u << bits_) - 1u;
    if (static_cast<std::uint32_t>(code) > mask) {
      return 0;
    }
    const Predictor predictor = predict(state_);
    const std::uint32_t y = scale(state_);
    const std::uint32_t dq = inverseQuantize(code, bits_, y);
    const std::uint32_t sr = reconstructedSignal(dq, predictor.se);
    update(state_, code, bits_, y, dq, predictor);
    return limitOutput(sr);
  }

private:
  struct State final {
    std::uint32_t yl = 0u;
    std::uint32_t yu = 0u;
    std::uint32_t dms = 0u;
    std::uint32_t dml = 0u;
    std::uint32_t ap = 0u;
    std::array<std::uint16_t, 2u> a{};
    std::array<std::uint16_t, 6u> b{};
    std::array<std::uint16_t, 2u> pk{};
    std::array<std::uint16_t, 6u> dq{};
    std::array<std::uint16_t, 2u> sr{};
    std::uint16_t td = 0u;
  };

  struct Predictor final {
    std::uint32_t se = 0u;
    std::uint32_t sez = 0u;
  };

  struct LogValue final {
    std::uint32_t value = 0u;
    std::uint32_t sign = 0u;
  };

  static constexpr std::array<int, 15u> kDecision40{-122, -16, 68,  139, 198, 250, 298, 339,
                                                    378,  413, 445, 475, 502, 528, 553};
  static constexpr std::array<int, 7u> kDecision32{-124, 80, 178, 246, 300, 349, 400};
  static constexpr std::array<int, 3u> kDecision24{8, 218, 331};
  static constexpr std::array<int, 1u> kDecision16{261};

  static constexpr std::array<std::uint16_t, 16u> kReconstruct40{
      2048u, 4030u, 28u,  104u, 169u, 224u, 274u, 318u,
      358u,  395u,  429u, 459u, 488u, 514u, 539u, 566u};
  static constexpr std::array<std::uint16_t, 8u> kReconstruct32{2048u, 4u,   135u, 213u,
                                                                273u,  323u, 373u, 425u};
  static constexpr std::array<std::uint16_t, 4u> kReconstruct24{2048u, 135u, 273u, 373u};
  static constexpr std::array<std::uint16_t, 2u> kReconstruct16{116u, 365u};

  static constexpr std::array<std::uint16_t, 16u> kScale40{
      14u, 14u, 24u, 39u, 40u, 41u, 58u, 100u, 141u, 179u, 219u, 280u, 358u, 440u, 529u, 696u};
  static constexpr std::array<std::uint16_t, 8u> kScale32{4084u, 18u,  41u,  64u,
                                                          112u,  198u, 355u, 1122u};
  static constexpr std::array<std::uint16_t, 4u> kScale24{4092u, 30u, 137u, 582u};
  static constexpr std::array<std::uint16_t, 2u> kScale16{4074u, 439u};

  static constexpr std::array<std::uint8_t, 16u> kFunction40{0u, 0u, 0u, 0u, 0u, 1u, 1u, 1u,
                                                             1u, 1u, 2u, 3u, 4u, 5u, 6u, 6u};
  static constexpr std::array<std::uint8_t, 8u> kFunction32{0u, 0u, 0u, 1u, 1u, 1u, 3u, 7u};
  static constexpr std::array<std::uint8_t, 4u> kFunction24{0u, 1u, 2u, 7u};
  static constexpr std::array<std::uint8_t, 2u> kFunction16{0u, 7u};

  static bool validBits(std::uint32_t bits) noexcept {
    return bits == 2u || bits == 3u || bits == 4u || bits == 5u;
  }

  static std::int32_t signedWord(std::uint32_t word, std::uint32_t bits) noexcept {
    const std::uint32_t sign = 1u << (bits - 1u);
    const std::uint32_t mask = (sign << 1u) - 1u;
    const std::uint32_t value = word & mask;
    return (value & sign) == 0u
               ? static_cast<std::int32_t>(value)
               : static_cast<std::int32_t>(value) - static_cast<std::int32_t>(sign << 1u);
  }

  static std::uint16_t word16(std::int32_t value) noexcept {
    return static_cast<std::uint16_t>(static_cast<std::uint32_t>(value) & 65535u);
  }

  static std::uint32_t exponent(std::uint32_t magnitude) noexcept {
    std::uint32_t result = 0u;
    while (magnitude != 0u) {
      ++result;
      magnitude >>= 1u;
    }
    return result;
  }

  static LogValue logarithm(std::uint32_t difference) noexcept {
    const std::uint32_t sign = difference >> 15u;
    const std::uint32_t magnitude = sign == 0u ? difference : (65536u - difference) & 32767u;
    const std::uint32_t exp = magnitude == 0u ? 0u : exponent(magnitude) - 1u;
    const std::uint32_t mantissa = ((magnitude << 7u) >> exp) & 127u;
    return {(exp << 7u) + mantissa, sign};
  }

  template <std::size_t Size>
  static std::uint32_t thresholdIndex(int normalized,
                                      const std::array<int, Size> &thresholds) noexcept {
    std::uint32_t index = 0u;
    while (index < Size && normalized >= thresholds[index]) {
      ++index;
    }
    return index;
  }

  static std::uint8_t quantize(std::uint32_t dln, std::uint32_t sign, std::uint32_t bits) noexcept {
    const int normalized = signedWord(dln, 12u);
    std::uint32_t index = 0u;
    switch (bits) {
    case 5u:
      index = thresholdIndex(normalized, kDecision40);
      break;
    case 4u:
      index = thresholdIndex(normalized, kDecision32);
      break;
    case 3u:
      index = thresholdIndex(normalized, kDecision24);
      break;
    default:
      index = thresholdIndex(normalized, kDecision16);
      break;
    }
    const std::uint32_t mask = (1u << bits) - 1u;
    if (sign != 0u) {
      return static_cast<std::uint8_t>(mask - index);
    }
    if (bits != 2u && index == 0u) {
      return static_cast<std::uint8_t>(mask);
    }
    return static_cast<std::uint8_t>(index);
  }

  static std::uint32_t magnitudeIndex(std::uint8_t code, std::uint32_t bits) noexcept {
    const std::uint32_t sign = static_cast<std::uint32_t>(code) >> (bits - 1u);
    const std::uint32_t magnitude_mask = (1u << (bits - 1u)) - 1u;
    return sign == 0u ? static_cast<std::uint32_t>(code) & magnitude_mask
                      : (((1u << bits) - 1u) - static_cast<std::uint32_t>(code)) & magnitude_mask;
  }

  static std::uint16_t reconstructedLog(std::uint8_t code, std::uint32_t bits) noexcept {
    const std::uint32_t index = magnitudeIndex(code, bits);
    switch (bits) {
    case 5u:
      return kReconstruct40[index];
    case 4u:
      return kReconstruct32[index];
    case 3u:
      return kReconstruct24[index];
    default:
      return kReconstruct16[index];
    }
  }

  static std::uint16_t scaleMultiplier(std::uint8_t code, std::uint32_t bits) noexcept {
    const std::uint32_t index = magnitudeIndex(code, bits);
    switch (bits) {
    case 5u:
      return kScale40[index];
    case 4u:
      return kScale32[index];
    case 3u:
      return kScale24[index];
    default:
      return kScale16[index];
    }
  }

  static std::uint8_t adaptationFunction(std::uint8_t code, std::uint32_t bits) noexcept {
    const std::uint32_t index = magnitudeIndex(code, bits);
    switch (bits) {
    case 5u:
      return kFunction40[index];
    case 4u:
      return kFunction32[index];
    case 3u:
      return kFunction24[index];
    default:
      return kFunction16[index];
    }
  }

  static std::uint32_t inverseQuantize(std::uint8_t code, std::uint32_t bits,
                                       std::uint32_t y) noexcept {
    const std::uint32_t dqln = reconstructedLog(code, bits);
    const std::uint32_t dql = (dqln + (y >> 2u)) & 4095u;
    const std::uint32_t negative_log = dql >> 11u;
    const std::uint32_t dex = (dql >> 7u) & 15u;
    const std::uint32_t mantissa = dql & 127u;
    const std::uint32_t dqt = 128u + mantissa;
    // Spec dynamics keep dql <= 1846 so dex <= 14; the saturating clamp only
    // removes the shift-count UB of the otherwise unreachable dex == 15 case.
    const std::uint32_t shift = dex <= 14u ? 14u - dex : 0u;
    const std::uint32_t magnitude = negative_log == 0u ? ((dqt << 7u) >> shift) : 0u;
    const std::uint32_t sign = static_cast<std::uint32_t>(code) >> (bits - 1u);
    return (sign << 15u) + magnitude;
  }

  static std::uint32_t multiply(std::uint16_t coefficient, std::uint16_t sample) noexcept {
    const std::uint32_t coefficient_sign = static_cast<std::uint32_t>(coefficient) >> 15u;
    const std::uint32_t shifted = static_cast<std::uint32_t>(coefficient) >> 2u;
    const std::uint32_t coefficient_magnitude =
        coefficient_sign == 0u ? shifted : (16384u - shifted) & 8191u;
    const std::uint32_t coefficient_exponent = exponent(coefficient_magnitude);
    const std::uint32_t coefficient_mantissa =
        coefficient_magnitude == 0u ? 32u : (coefficient_magnitude << 6u) >> coefficient_exponent;
    const std::uint32_t sample_sign = static_cast<std::uint32_t>(sample) >> 10u;
    const std::uint32_t sample_exponent = (static_cast<std::uint32_t>(sample) >> 6u) & 15u;
    const std::uint32_t sample_mantissa = static_cast<std::uint32_t>(sample) & 63u;
    const std::uint32_t product_exponent = sample_exponent + coefficient_exponent;
    const std::uint32_t product_mantissa = ((sample_mantissa * coefficient_mantissa) + 48u) >> 4u;
    const std::uint32_t product_magnitude =
        product_exponent <= 26u ? (product_mantissa << 7u) >> (26u - product_exponent)
                                : ((product_mantissa << 7u) << (product_exponent - 26u)) & 32767u;
    return (sample_sign ^ coefficient_sign) == 0u ? product_magnitude
                                                  : (65536u - product_magnitude) & 65535u;
  }

  static Predictor predict(const State &state) noexcept {
    std::uint32_t zero_sum = 0u;
    for (std::size_t index = 0u; index < state.b.size(); ++index) {
      zero_sum = (zero_sum + multiply(state.b[index], state.dq[index])) & 65535u;
    }
    std::uint32_t full_sum = (zero_sum + multiply(state.a[1u], state.sr[1u])) & 65535u;
    full_sum = (full_sum + multiply(state.a[0u], state.sr[0u])) & 65535u;
    return {full_sum >> 1u, zero_sum >> 1u};
  }

  static std::uint32_t scale(const State &state) noexcept {
    const std::uint32_t al = state.ap >= 256u ? 64u : state.ap >> 2u;
    const std::uint32_t difference = (state.yu + 16384u - (state.yl >> 6u)) & 16383u;
    const std::uint32_t sign = difference >> 13u;
    const std::uint32_t magnitude = sign == 0u ? difference : (16384u - difference) & 8191u;
    const std::uint32_t product_magnitude = (magnitude * al) >> 6u;
    const std::uint32_t product =
        sign == 0u ? product_magnitude : (16384u - product_magnitude) & 16383u;
    return ((state.yl >> 6u) + product) & 8191u;
  }

  static std::uint32_t reconstructedSignal(std::uint32_t dq, std::uint32_t se) noexcept {
    const std::uint32_t dq_sign = dq >> 15u;
    const std::uint32_t dqi = dq_sign == 0u ? dq : (65536u - (dq & 32767u)) & 65535u;
    const std::uint32_t sei = (se & 16384u) == 0u ? se : 32768u + se;
    return (dqi + sei) & 65535u;
  }

  static std::uint16_t floatDifference(std::uint32_t dq) noexcept {
    const std::uint32_t sign = dq >> 15u;
    const std::uint32_t magnitude = dq & 32767u;
    const std::uint32_t exp = exponent(magnitude);
    const std::uint32_t mantissa = magnitude == 0u ? 32u : (magnitude << 6u) >> exp;
    return static_cast<std::uint16_t>((sign << 10u) + (exp << 6u) + mantissa);
  }

  static std::uint16_t floatSignal(std::uint32_t sr) noexcept {
    const std::uint32_t sign = sr >> 15u;
    const std::uint32_t magnitude = sign == 0u ? sr : (65536u - sr) & 32767u;
    const std::uint32_t exp = exponent(magnitude);
    const std::uint32_t mantissa = magnitude == 0u ? 32u : (magnitude << 6u) >> exp;
    return static_cast<std::uint16_t>((sign << 10u) + (exp << 6u) + mantissa);
  }

  static std::uint16_t updatePoleOne(std::uint32_t pk0, std::uint32_t pk1, std::uint16_t a1,
                                     std::uint32_t zero) noexcept {
    const std::uint32_t uga = zero != 0u ? 0u : ((pk0 ^ pk1) == 0u ? 192u : 65344u);
    const std::uint32_t sign = static_cast<std::uint32_t>(a1) >> 15u;
    const std::uint32_t leak =
        sign == 0u ? (65536u - (static_cast<std::uint32_t>(a1) >> 8u)) & 65535u
                   : (65536u - ((static_cast<std::uint32_t>(a1) >> 8u) + 65280u)) & 65535u;
    return static_cast<std::uint16_t>((static_cast<std::uint32_t>(a1) + uga + leak) & 65535u);
  }

  static std::uint16_t updatePoleTwo(std::uint32_t pk0, std::uint32_t pk1, std::uint32_t pk2,
                                     std::uint16_t a1, std::uint16_t a2,
                                     std::uint32_t zero) noexcept {
    const std::uint32_t first_sign = pk0 ^ pk1;
    const std::uint32_t second_sign = pk0 ^ pk2;
    const std::uint32_t uga2a = second_sign == 0u ? 16384u : 114688u;
    const std::uint32_t a1_sign = static_cast<std::uint32_t>(a1) >> 15u;
    std::uint32_t fa1 = 0u;
    if (a1_sign == 0u) {
      fa1 = (static_cast<std::uint32_t>(a1) <= 8191u ? static_cast<std::uint32_t>(a1) : 8191u)
            << 2u;
    } else {
      fa1 = static_cast<std::uint32_t>(a1) >= 57345u
                ? (static_cast<std::uint32_t>(a1) << 2u) & 131071u
                : 24577u << 2u;
    }
    const std::uint32_t fa = first_sign != 0u ? fa1 : (131072u - fa1) & 131071u;
    const std::uint32_t uga2b = (uga2a + fa) & 131071u;
    const std::uint32_t uga2_sign = uga2b >> 16u;
    const std::uint32_t uga2 =
        zero != 0u ? 0u : (uga2_sign == 0u ? uga2b >> 7u : (uga2b >> 7u) + 64512u);
    const std::uint32_t a2_sign = static_cast<std::uint32_t>(a2) >> 15u;
    const std::uint32_t leak =
        a2_sign == 0u ? (65536u - (static_cast<std::uint32_t>(a2) >> 7u)) & 65535u
                      : (65536u - ((static_cast<std::uint32_t>(a2) >> 7u) + 65024u)) & 65535u;
    return static_cast<std::uint16_t>((static_cast<std::uint32_t>(a2) + uga2 + leak) & 65535u);
  }

  static std::uint16_t limitPoleTwo(std::uint16_t value) noexcept {
    const std::int32_t signed_value = signedWord(value, 16u);
    if (signed_value < -12288) {
      return word16(-12288);
    }
    if (signed_value > 12288) {
      return word16(12288);
    }
    return value;
  }

  static std::uint16_t limitPoleOne(std::uint16_t value, std::uint16_t a2) noexcept {
    const std::int32_t signed_a2 = signedWord(a2, 16u);
    const std::int32_t lower = signed_a2 - 15360;
    const std::int32_t upper = 15360 - signed_a2;
    const std::int32_t signed_value = signedWord(value, 16u);
    if (signed_value < lower) {
      return word16(lower);
    }
    if (signed_value > upper) {
      return word16(upper);
    }
    return value;
  }

  static std::uint16_t updateZero(std::uint32_t sign_difference, std::uint16_t coefficient,
                                  std::uint32_t dq_magnitude, std::uint32_t bits) noexcept {
    const std::uint32_t gradient =
        dq_magnitude == 0u ? 0u : (sign_difference == 0u ? 128u : 65408u);
    const std::uint32_t sign = static_cast<std::uint32_t>(coefficient) >> 15u;
    const std::uint32_t shift = bits == 5u ? 9u : 8u;
    const std::uint32_t extension = bits == 5u ? 65408u : 65280u;
    const std::uint32_t leak =
        sign == 0u
            ? (65536u - (static_cast<std::uint32_t>(coefficient) >> shift)) & 65535u
            : (65536u - ((static_cast<std::uint32_t>(coefficient) >> shift) + extension)) & 65535u;
    return static_cast<std::uint16_t>((static_cast<std::uint32_t>(coefficient) + gradient + leak) &
                                      65535u);
  }

  static std::uint32_t transition(const State &state, std::uint32_t dq) noexcept {
    if (state.td == 0u) {
      return 0u;
    }
    const std::uint32_t magnitude = dq & 32767u;
    const std::uint32_t integer = state.yl >> 15u;
    const std::uint32_t fraction = (state.yl >> 10u) & 31u;
    const std::uint32_t threshold1 = (32u + fraction) << integer;
    const std::uint32_t threshold2 = integer > 9u ? 31u << 10u : threshold1;
    const std::uint32_t threshold = (threshold2 + (threshold2 >> 1u)) >> 1u;
    return magnitude > threshold ? 1u : 0u;
  }

  static void updateScale(State &state, std::uint8_t code, std::uint32_t bits,
                          std::uint32_t y) noexcept {
    const std::uint32_t wi = scaleMultiplier(code, bits);
    const std::uint32_t difference = ((wi << 5u) + 131072u - y) & 131071u;
    const std::uint32_t signed_difference =
        (difference >> 16u) == 0u ? difference >> 5u : (difference >> 5u) + 4096u;
    const std::uint32_t yut = (y + signed_difference) & 8191u;
    const std::uint32_t upper = ((yut + 11264u) & 16383u) >> 13u;
    const std::uint32_t lower = ((yut + 15840u) & 16383u) >> 13u;
    const std::uint32_t yup = lower != 0u ? 544u : (upper == 0u ? 5120u : yut);

    const std::uint32_t slow_difference = (yup + ((1048576u - state.yl) >> 6u)) & 16383u;
    const std::uint32_t slow_signed =
        (slow_difference >> 13u) == 0u ? slow_difference : slow_difference + 507904u;
    state.yu = yup;
    state.yl = (state.yl + slow_signed) & 524287u;
  }

  static void updateSpeed(State &state, std::uint8_t code, std::uint32_t bits, std::uint32_t y,
                          std::uint32_t tone, std::uint32_t transition_detected) noexcept {
    const std::uint32_t fi = adaptationFunction(code, bits);
    const std::uint32_t short_difference = ((fi << 9u) + 8192u - state.dms) & 8191u;
    const std::uint32_t short_signed =
        (short_difference >> 12u) == 0u ? short_difference >> 5u : (short_difference >> 5u) + 3840u;
    const std::uint32_t dmsp = (state.dms + short_signed) & 4095u;

    const std::uint32_t long_difference = ((fi << 11u) + 32768u - state.dml) & 32767u;
    const std::uint32_t long_signed =
        (long_difference >> 14u) == 0u ? long_difference >> 7u : (long_difference >> 7u) + 16128u;
    const std::uint32_t dmlp = (state.dml + long_signed) & 16383u;

    const std::uint32_t magnitude_difference = ((dmsp << 2u) + 32768u - dmlp) & 32767u;
    const std::uint32_t magnitude = (magnitude_difference >> 14u) == 0u
                                        ? magnitude_difference
                                        : (32768u - magnitude_difference) & 16383u;
    const std::uint32_t ax = y >= 1536u && magnitude < (dmlp >> 3u) && tone == 0u ? 0u : 1u;
    const std::uint32_t ap_difference = ((ax << 9u) + 2048u - state.ap) & 2047u;
    const std::uint32_t ap_signed =
        (ap_difference >> 10u) == 0u ? ap_difference >> 4u : (ap_difference >> 4u) + 896u;
    const std::uint32_t app = (state.ap + ap_signed) & 1023u;

    state.dms = dmsp;
    state.dml = dmlp;
    state.ap = transition_detected == 0u ? app : 256u;
  }

  static void update(State &state, std::uint8_t code, std::uint32_t bits, std::uint32_t y,
                     std::uint32_t dq, const Predictor &predictor) noexcept {
    const std::uint32_t transition_detected = transition(state, dq);
    const std::uint32_t sr = reconstructedSignal(dq, predictor.se);

    const std::uint32_t dqi = (dq >> 15u) == 0u ? dq : (65536u - (dq & 32767u)) & 65535u;
    const std::uint32_t sezi =
        (predictor.sez & 16384u) == 0u ? predictor.sez : 32768u + predictor.sez;
    const std::uint32_t dqsez = (dqi + sezi) & 65535u;
    const std::uint32_t pk0 = dqsez >> 15u;
    const std::uint32_t zero = dqsez == 0u ? 1u : 0u;

    const std::uint16_t unlimited_a2 =
        updatePoleTwo(pk0, state.pk[0u], state.pk[1u], state.a[0u], state.a[1u], zero);
    const std::uint16_t limited_a2 = limitPoleTwo(unlimited_a2);
    const std::uint16_t unlimited_a1 = updatePoleOne(pk0, state.pk[0u], state.a[0u], zero);
    const std::uint16_t limited_a1 = limitPoleOne(unlimited_a1, limited_a2);
    const std::uint32_t tone = static_cast<std::uint32_t>(limited_a2) >= 32768u &&
                                       static_cast<std::uint32_t>(limited_a2) < 53760u
                                   ? 1u
                                   : 0u;

    const std::uint32_t dq_magnitude = dq & 32767u;
    const std::uint32_t dq_sign = dq >> 15u;
    std::array<std::uint16_t, 6u> next_b{};
    for (std::size_t index = 0u; index < state.b.size(); ++index) {
      const std::uint32_t delayed_sign = static_cast<std::uint32_t>(state.dq[index]) >> 10u;
      const std::uint16_t updated =
          updateZero(dq_sign ^ delayed_sign, state.b[index], dq_magnitude, bits);
      next_b[index] = transition_detected == 0u ? updated : 0u;
    }

    state.a[0u] = transition_detected == 0u ? limited_a1 : 0u;
    state.a[1u] = transition_detected == 0u ? limited_a2 : 0u;
    state.b = next_b;
    state.pk[1u] = state.pk[0u];
    state.pk[0u] = static_cast<std::uint16_t>(pk0);
    state.sr[1u] = state.sr[0u];
    state.sr[0u] = floatSignal(sr);
    for (std::size_t index = state.dq.size() - 1u; index > 0u; --index) {
      state.dq[index] = state.dq[index - 1u];
    }
    state.dq[0u] = floatDifference(dq);

    updateScale(state, code, bits, y);
    updateSpeed(state, code, bits, y, tone, transition_detected);
    state.td = transition_detected == 0u ? static_cast<std::uint16_t>(tone) : 0u;
  }

  static std::int16_t limitOutput(std::uint32_t sr) noexcept {
    if (sr > 8191u && sr < 32768u) {
      return 8191;
    }
    if (sr > 32767u && sr < 57344u) {
      return -8192;
    }
    const std::uint32_t limited = sr & 16383u;
    return static_cast<std::int16_t>((limited & 8192u) == 0u
                                         ? static_cast<std::int32_t>(limited)
                                         : static_cast<std::int32_t>(limited) - 16384);
  }

  State state_{};
  std::uint32_t bits_ = 4u;
};

} // namespace effetune::plugins::lofi::g726

#endif

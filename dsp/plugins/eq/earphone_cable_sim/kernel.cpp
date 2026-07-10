#include "effetune/kernel.h"
#include "EarphoneCableSimPluginParams.h"
#include "effetune/dsp/biquad.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace effetune::plugins::eq {
namespace {

constexpr std::size_t kResonances = 5u;
constexpr std::size_t kMaxPolynomialTerms = 12u;
constexpr std::size_t kMaxRoots = kMaxPolynomialTerms - 1u;
constexpr std::size_t kMaxSections = kMaxRoots;
constexpr std::size_t kMaxChannels = 8u;
constexpr double kTwoPi = 6.283185307179586;

struct ComplexValue final {
  double real = 0.0;
  double imaginary = 0.0;
};

ComplexValue add(ComplexValue left, ComplexValue right) noexcept {
  return {left.real + right.real, left.imaginary + right.imaginary};
}

ComplexValue subtract(ComplexValue left, ComplexValue right) noexcept {
  return {left.real - right.real, left.imaginary - right.imaginary};
}

ComplexValue multiply(ComplexValue left, ComplexValue right) noexcept {
  return {left.real * right.real - left.imaginary * right.imaginary,
          left.real * right.imaginary + left.imaginary * right.real};
}

ComplexValue divide(ComplexValue numerator, ComplexValue denominator) noexcept {
  double divisor =
      denominator.real * denominator.real + denominator.imaginary * denominator.imaginary;
  if (divisor < 1.0e-300) {
    divisor = 1.0e-300;
  }
  return {
      (numerator.real * denominator.real + numerator.imaginary * denominator.imaginary) / divisor,
      (numerator.imaginary * denominator.real - numerator.real * denominator.imaginary) / divisor};
}

double magnitude(ComplexValue value) noexcept { return std::hypot(value.real, value.imaginary); }

struct Polynomial final {
  std::array<double, kMaxPolynomialTerms> values{};
  std::size_t length = 1u;
};

Polynomial constantPolynomial(double value) noexcept {
  Polynomial result;
  result.values[0] = value;
  return result;
}

Polynomial linearPolynomial(double constant, double linear) noexcept {
  Polynomial result;
  result.values[0] = constant;
  result.values[1] = linear;
  result.length = 2u;
  return result;
}

Polynomial quadraticPolynomial(double constant, double linear, double quadratic) noexcept {
  Polynomial result;
  result.values[0] = constant;
  result.values[1] = linear;
  result.values[2] = quadratic;
  result.length = 3u;
  return result;
}

Polynomial multiplyPolynomials(const Polynomial &left, const Polynomial &right) noexcept {
  Polynomial result;
  result.length = left.length + right.length - 1u;
  if (result.length > kMaxPolynomialTerms) {
    result.length = kMaxPolynomialTerms;
  }
  for (std::size_t left_index = 0u; left_index < left.length; ++left_index) {
    for (std::size_t right_index = 0u; right_index < right.length; ++right_index) {
      const std::size_t output_index = left_index + right_index;
      if (output_index < result.length) {
        result.values[output_index] += left.values[left_index] * right.values[right_index];
      }
    }
  }
  return result;
}

Polynomial addPolynomials(const Polynomial &left, const Polynomial &right) noexcept {
  Polynomial result;
  result.length = left.length > right.length ? left.length : right.length;
  for (std::size_t index = 0u; index < left.length; ++index) {
    result.values[index] += left.values[index];
  }
  for (std::size_t index = 0u; index < right.length; ++index) {
    result.values[index] += right.values[index];
  }
  return result;
}

struct RootSet final {
  std::array<ComplexValue, kMaxRoots> values{};
  std::size_t count = 0u;
};

ComplexValue evaluateMonic(const std::array<double, kMaxPolynomialTerms> &values,
                           std::size_t length, ComplexValue point) noexcept {
  ComplexValue result{};
  for (std::size_t index = length; index > 0u; --index) {
    result = add(multiply(result, point), {values[index - 1u], 0.0});
  }
  return result;
}

RootSet findRoots(const Polynomial &polynomial) noexcept {
  std::array<double, kMaxPolynomialTerms> normalized = polynomial.values;
  std::size_t length = polynomial.length;
  while (length > 1u) {
    const double last = normalized[length - 1u];
    const double absolute = last < 0.0 ? -last : last;
    if (absolute >= 1.0e-14) {
      break;
    }
    --length;
  }

  RootSet roots;
  if (length <= 1u) {
    return roots;
  }
  roots.count = length - 1u;
  const double leading = normalized[length - 1u];
  for (std::size_t index = 0u; index < length; ++index) {
    normalized[index] /= leading;
  }
  for (std::size_t index = 0u; index < roots.count; ++index) {
    const double angle =
        kTwoPi * static_cast<double>(index) / static_cast<double>(roots.count) + 0.4;
    roots.values[index] = {0.5 * std::cos(angle), 0.5 * std::sin(angle)};
  }

  for (std::size_t iteration = 0u; iteration < 500u; ++iteration) {
    double maximum_delta = 0.0;
    for (std::size_t index = 0u; index < roots.count; ++index) {
      ComplexValue denominator{1.0, 0.0};
      for (std::size_t other = 0u; other < roots.count; ++other) {
        if (other != index) {
          denominator = multiply(denominator, subtract(roots.values[index], roots.values[other]));
        }
      }
      const ComplexValue delta =
          divide(evaluateMonic(normalized, length, roots.values[index]), denominator);
      roots.values[index] = subtract(roots.values[index], delta);
      const double delta_magnitude = magnitude(delta);
      if (delta_magnitude > maximum_delta) {
        maximum_delta = delta_magnitude;
      }
    }
    if (maximum_delta < 1.0e-13) {
      break;
    }
  }
  return roots;
}

struct RootSections final {
  std::array<std::array<double, 3u>, kMaxSections> values{};
  std::size_t count = 0u;
};

RootSections pairRoots(const RootSet &roots) noexcept {
  RootSections sections;
  std::array<bool, kMaxRoots> used{};
  for (std::size_t index = 0u; index < roots.count; ++index) {
    if (used[index]) {
      continue;
    }
    const ComplexValue root = roots.values[index];
    const double imaginary_absolute = root.imaginary < 0.0 ? -root.imaginary : root.imaginary;
    if (imaginary_absolute < 1.0e-9) {
      used[index] = true;
      sections.values[sections.count++] = {1.0, -root.real, 0.0};
      continue;
    }

    std::size_t best = roots.count;
    double best_distance = HUGE_VAL;
    for (std::size_t candidate = index + 1u; candidate < roots.count; ++candidate) {
      if (used[candidate]) {
        continue;
      }
      double real_distance = roots.values[candidate].real - root.real;
      if (real_distance < 0.0) {
        real_distance = -real_distance;
      }
      double imaginary_distance = roots.values[candidate].imaginary + root.imaginary;
      if (imaginary_distance < 0.0) {
        imaginary_distance = -imaginary_distance;
      }
      const double distance = real_distance + imaginary_distance;
      if (distance < best_distance) {
        best_distance = distance;
        best = candidate;
      }
    }
    used[index] = true;
    if (best < roots.count) {
      used[best] = true;
    }
    const double magnitude_squared = root.real * root.real + root.imaginary * root.imaginary;
    sections.values[sections.count++] = {1.0, -2.0 * root.real, magnitude_squared};
  }
  return sections;
}

RootSet mapRootsToZPlane(RootSet roots, double scale) noexcept {
  for (std::size_t index = 0u; index < roots.count; ++index) {
    const double mapped_magnitude = std::exp(roots.values[index].real * scale);
    const double mapped_angle = roots.values[index].imaginary * scale;
    roots.values[index] = {mapped_magnitude * std::cos(mapped_angle),
                           mapped_magnitude * std::sin(mapped_angle)};
  }
  return roots;
}

double cascadeMagnitude(const std::array<dsp::BiquadCoefficients, kMaxSections> &sections,
                        std::size_t section_count, double frequency, double sample_rate) noexcept {
  const double angular_frequency = kTwoPi * frequency / sample_rate;
  const ComplexValue z1{std::cos(-angular_frequency), std::sin(-angular_frequency)};
  const ComplexValue z2 = multiply(z1, z1);
  ComplexValue response{1.0, 0.0};
  for (std::size_t index = 0u; index < section_count; ++index) {
    const dsp::BiquadCoefficients &section = sections[index];
    const ComplexValue numerator = add(add({section.b0, 0.0}, multiply({section.b1, 0.0}, z1)),
                                       multiply({section.b2, 0.0}, z2));
    const ComplexValue denominator =
        add(add({1.0, 0.0}, multiply({section.a1, 0.0}, z1)), multiply({section.a2, 0.0}, z2));
    response = multiply(response, divide(numerator, denominator));
  }
  return magnitude(response);
}

struct Resonance final {
  double frequency = 0.0;
  double q = 0.0;
  double impedance = 0.0;
};

} // namespace

class EarphoneCableSimKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::EarphoneCableSimPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = info.sampleRate;
    reset();
  }

  void reset() noexcept override {
    resetStates(active_states_);
    resetStates(old_states_);
    active_section_count_ = 0u;
    old_section_count_ = 0u;
    last_channel_count_ = 0u;
    fade_ = 1.0;
    fade_step_ = 0.0;
    initialized_ = false;
    old_available_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > kMaxChannels ||
        frame_count == 0u || sample_rate_ <= 0.0F) {
      return;
    }

    if (!initialized_ || last_channel_count_ != channel_count) {
      buildCascade(active_coefficients_, active_section_count_);
      resetStates(active_states_);
      resetStates(old_states_);
      old_section_count_ = 0u;
      old_available_ = false;
      fade_ = 1.0;
      fade_step_ = 0.0;
      last_channel_count_ = channel_count;
      initialized_ = true;
    } else if (paramsDirty()) {
      old_coefficients_ = active_coefficients_;
      old_states_ = active_states_;
      old_section_count_ = active_section_count_;
      old_available_ = true;
      buildCascade(active_coefficients_, active_section_count_);
      resetStates(active_states_);
      std::uint32_t fade_samples =
          static_cast<std::uint32_t>(std::round(static_cast<double>(sample_rate_) * 0.02));
      if (fade_samples < 128u) {
        fade_samples = 128u;
      }
      fade_step_ = 1.0 / static_cast<double>(fade_samples);
      fade_ = 0.0;
    }

    const bool fading = fade_ < 1.0 && old_available_;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double blend = fade_ < 1.0 ? fade_ : 1.0;
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::uint32_t audio_index = channel * frame_count + frame;
        const double input = audio[audio_index];
        const double active = processCascade(input, channel, active_coefficients_, active_states_,
                                             active_section_count_);
        if (fading) {
          const double old =
              processCascade(input, channel, old_coefficients_, old_states_, old_section_count_);
          audio[audio_index] = static_cast<float>(old + (active - old) * blend);
        } else {
          audio[audio_index] = static_cast<float>(active);
        }
      }
      if (fading && fade_ < 1.0) {
        fade_ += fade_step_;
        if (fade_ > 1.0) {
          fade_ = 1.0;
        }
      }
    }
    if (!fading) {
      fade_ = 1.0;
    }
    if (fade_ >= 1.0) {
      old_available_ = false;
      old_section_count_ = 0u;
    }
  }

private:
  using Coefficients = std::array<dsp::BiquadCoefficients, kMaxSections>;
  using States = std::array<dsp::BiquadDf1State, kMaxSections * kMaxChannels>;

  static void resetStates(States &states) noexcept {
    for (dsp::BiquadDf1State &state : states) {
      state.reset();
    }
  }

  static double processCascade(double input, std::uint32_t channel,
                               const Coefficients &coefficients, States &states,
                               std::size_t section_count) noexcept {
    double value = input;
    for (std::size_t section = 0u; section < section_count; ++section) {
      value = dsp::processBiquadDf1Sample(value, coefficients[section],
                                          states[section * kMaxChannels + channel]);
    }
    return value;
  }

  void buildCascade(Coefficients &output, std::size_t &section_count) noexcept {
    constexpr double kReferenceAngularFrequency = kTwoPi * 1000.0;
    std::array<Resonance, kResonances> resonances{};
    std::size_t resonance_count = 0u;
    for (std::size_t index = 0u; index < kResonances; ++index) {
      if (params_.resonanceEnabled[index] >= 0.5F) {
        resonances[resonance_count++] = {params_.resonanceFrequency[index],
                                         params_.resonanceQ[index],
                                         params_.resonanceImpedance[index]};
      }
    }

    const double voice_coil =
        static_cast<double>(params_.voiceCoilInductance) * 1.0e-3 * kReferenceAngularFrequency;
    const double cable_inductance =
        static_cast<double>(params_.cableInductance) * 1.0e-6 * kReferenceAngularFrequency;
    const double series_resistance =
        static_cast<double>(params_.outputImpedance) + params_.cableResistance;

    std::array<Polynomial, kResonances> resonance_denominators{};
    for (std::size_t index = 0u; index < resonance_count; ++index) {
      const double x0 = resonances[index].frequency / 1000.0;
      resonance_denominators[index] =
          quadraticPolynomial(resonances[index].q * x0, 1.0, resonances[index].q / x0);
    }

    Polynomial denominator_product = constantPolynomial(1.0);
    for (std::size_t index = 0u; index < resonance_count; ++index) {
      denominator_product = multiplyPolynomials(denominator_product, resonance_denominators[index]);
    }

    std::array<Polynomial, kResonances> other_denominators{};
    for (std::size_t index = 0u; index < resonance_count; ++index) {
      other_denominators[index] = constantPolynomial(1.0);
      for (std::size_t other = 0u; other < resonance_count; ++other) {
        if (other != index) {
          other_denominators[index] =
              multiplyPolynomials(other_denominators[index], resonance_denominators[other]);
        }
      }
    }

    Polynomial load_numerator = multiplyPolynomials(
        linearPolynomial(params_.baseImpedance, voice_coil), denominator_product);
    for (std::size_t index = 0u; index < resonance_count; ++index) {
      const double impedance_delta = resonances[index].impedance - params_.baseImpedance;
      load_numerator =
          addPolynomials(load_numerator, multiplyPolynomials(linearPolynomial(0.0, impedance_delta),
                                                             other_denominators[index]));
    }
    const Polynomial denominator =
        addPolynomials(multiplyPolynomials(linearPolynomial(series_resistance, cable_inductance),
                                           denominator_product),
                       load_numerator);

    const double root_scale = kReferenceAngularFrequency / static_cast<double>(sample_rate_);
    const RootSections zero_sections =
        pairRoots(mapRootsToZPlane(findRoots(load_numerator), root_scale));
    const RootSections pole_sections =
        pairRoots(mapRootsToZPlane(findRoots(denominator), root_scale));
    section_count =
        zero_sections.count > pole_sections.count ? zero_sections.count : pole_sections.count;
    if (section_count > kMaxSections) {
      section_count = kMaxSections;
    }
    for (std::size_t index = 0u; index < section_count; ++index) {
      const std::array<double, 3u> numerator = index < zero_sections.count
                                                   ? zero_sections.values[index]
                                                   : std::array<double, 3u>{1.0, 0.0, 0.0};
      const std::array<double, 3u> section_denominator =
          index < pole_sections.count ? pole_sections.values[index]
                                      : std::array<double, 3u>{1.0, 0.0, 0.0};
      output[index] = {numerator[0], numerator[1], numerator[2], section_denominator[1],
                       section_denominator[2]};
    }

    double sum = 0.0;
    constexpr std::size_t kPoints = 256u;
    constexpr double kMinimumFrequency = 20.0;
    constexpr double kMaximumFrequency = 20000.0;
    for (std::size_t index = 0u; index < kPoints; ++index) {
      const double ratio = static_cast<double>(index) / static_cast<double>(kPoints - 1u);
      const double frequency =
          kMinimumFrequency * std::pow(kMaximumFrequency / kMinimumFrequency, ratio);
      const double response =
          cascadeMagnitude(output, section_count, frequency, static_cast<double>(sample_rate_));
      sum += response * response;
    }
    const double average = std::sqrt(sum / static_cast<double>(kPoints));
    const double makeup = average > 1.0e-9 ? 1.0 / average : 1.0;
    if (section_count > 0u) {
      output[0].b0 *= makeup;
      output[0].b1 *= makeup;
      output[0].b2 *= makeup;
    }
  }

  Coefficients active_coefficients_{};
  Coefficients old_coefficients_{};
  States active_states_{};
  States old_states_{};
  float sample_rate_ = 0.0F;
  std::size_t active_section_count_ = 0u;
  std::size_t old_section_count_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  double fade_ = 1.0;
  double fade_step_ = 0.0;
  bool initialized_ = false;
  bool old_available_ = false;
};

static_assert(sizeof(EarphoneCableSimKernel) <= 8192u);

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(EarphoneCableSimPlugin, effetune::plugins::eq::EarphoneCableSimKernel)

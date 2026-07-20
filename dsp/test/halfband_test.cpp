#include "effetune/dsp/halfband.h"

#include <cmath>
#include <cstdio>
#include <vector>

namespace {

int failures = 0;

#define HB_CHECK(condition)                                                                        \
  do {                                                                                             \
    if (!(condition)) {                                                                            \
      std::fprintf(stderr, "halfband check failed: %s:%d: %s\n", __FILE__, __LINE__, #condition);  \
      ++failures;                                                                                  \
    }                                                                                              \
  } while (false)

double magnitude(const effetune::dsp::Halfband2x &filter, double cyclesPerInputSample) {
  constexpr double twoPi = 6.28318530717958647692;
  double real = 0.0;
  double imaginary = 0.0;
  const auto &coefficients = filter.coefficients();
  for (std::size_t tap = 0u; tap < coefficients.size(); ++tap) {
    const double phase = -twoPi * cyclesPerInputSample * static_cast<double>(tap);
    real += coefficients[tap] * std::cos(phase);
    imaginary += coefficients[tap] * std::sin(phase);
  }
  return std::sqrt(real * real + imaginary * imaginary);
}

} // namespace

int main() {
  effetune::dsp::Halfband2x filter;
  double minimumPass = 1.0;
  double maximumPass = 0.0;
  double maximumStop = 0.0;
  for (int index = 0; index <= 400; ++index) {
    const double response = magnitude(filter, 0.2 * static_cast<double>(index) / 400.0);
    minimumPass = response < minimumPass ? response : minimumPass;
    maximumPass = response > maximumPass ? response : maximumPass;
  }
  for (int index = 0; index <= 400; ++index) {
    const double response = magnitude(filter, 0.3 + 0.2 * static_cast<double>(index) / 400.0);
    maximumStop = response > maximumStop ? response : maximumStop;
  }
  const double passRippleDb = 20.0 * std::log10(maximumPass / minimumPass);
  const double stopDb = 20.0 * std::log10(maximumStop);
  std::printf("halfband response: passband ripple %.6f dB, stopband %.3f dB\n", passRippleDb,
              stopDb);
  HB_CHECK(passRippleDb < 0.01);
  HB_CHECK(stopDb <= -90.0);

  float output = 0.0F;
  HB_CHECK(!filter.decimate(1.0F, output));
  HB_CHECK(filter.decimate(0.0F, output));
  filter.reset();
  HB_CHECK(!filter.decimate(0.0F, output));

  std::vector<float> highRate(512u, 0.0F);
  for (std::size_t index = 0u; index < highRate.size(); ++index)
    highRate[index] = static_cast<float>(std::sin(0.031 * static_cast<double>(index)));
  filter.reset();
  for (std::size_t frame = 0u; frame < highRate.size(); ++frame) {
    const bool produced = filter.decimate(highRate[frame], output);
    if (!produced)
      continue;
    double reference = 0.0;
    for (std::size_t tap = 0u; tap < filter.coefficients().size() && tap <= frame; ++tap)
      reference += static_cast<double>(highRate[frame - tap]) * filter.coefficients()[tap];
    HB_CHECK(std::abs(static_cast<double>(output) - reference) < 1.0e-6);
  }

  std::vector<float> lowRate(256u, 0.0F);
  std::vector<float> zeroStuffed(2u * lowRate.size(), 0.0F);
  for (std::size_t index = 0u; index < lowRate.size(); ++index) {
    lowRate[index] = static_cast<float>(std::cos(0.047 * static_cast<double>(index)));
    zeroStuffed[2u * index] = 2.0F * lowRate[index];
  }
  filter.reset();
  for (std::size_t frame = 0u; frame < lowRate.size(); ++frame) {
    float first = 0.0F;
    float second = 0.0F;
    filter.interpolate(lowRate[frame], first, second);
    for (std::size_t phase = 0u; phase < 2u; ++phase) {
      const std::size_t highFrame = 2u * frame + phase;
      double reference = 0.0;
      for (std::size_t tap = 0u; tap < filter.coefficients().size() && tap <= highFrame; ++tap)
        reference += static_cast<double>(zeroStuffed[highFrame - tap]) * filter.coefficients()[tap];
      const float measured = phase == 0u ? first : second;
      HB_CHECK(std::abs(static_cast<double>(measured) - reference) < 1.0e-6);
    }
  }
  return failures == 0 ? 0 : 1;
}

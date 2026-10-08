#include "effetune/dsp/delay_line.h"
#include "effetune/dsp/denormal_noise.h"
#include "effetune/dsp/fir.h"
#include "effetune/dsp/math.h"
#include "effetune/dsp/oversampled_shaper.h"
#include "effetune/dsp/smoothing.h"
#include "effetune/dsp/xorshift_rng.h"

#include <array>
#include <cmath>
#include <cstdio>
#include <limits>
#include <vector>

namespace {

int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "primitives_test.cpp:%d: check failed: %s\n", line, expression);
    ++failures;
  }
}

#define PRIMITIVE_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

bool near(double actual, double expected, double tolerance = 1.0e-12) noexcept {
  const double difference = actual - expected;
  const double magnitude = difference < 0.0 ? -difference : difference;
  return magnitude <= tolerance;
}

void testDelayLine() {
  effetune::dsp::DelayLine delay;
  PRIMITIVE_CHECK(!delay.prepare(0U, 8U));
  PRIMITIVE_CHECK(delay.prepare(2U, 4U));
  PRIMITIVE_CHECK(delay.channelCount() == 2U);
  PRIMITIVE_CHECK(delay.maxDelaySamples() == 4U);

  delay.push(0U, 1.0F);
  delay.push(0U, 2.0F);
  delay.push(0U, 3.0F);
  delay.push(1U, -4.0F);
  PRIMITIVE_CHECK(delay.read(0U, 0U) == 3.0F);
  PRIMITIVE_CHECK(delay.read(0U, 1U) == 2.0F);
  PRIMITIVE_CHECK(delay.read(0U, 2U) == 1.0F);
  PRIMITIVE_CHECK(delay.readLinear(0U, 1.5) == 1.5F);
  PRIMITIVE_CHECK(delay.read(1U, 0U) == -4.0F);
  PRIMITIVE_CHECK(delay.read(0U, 99U) == 0.0F);

  delay.clearChannel(0U);
  PRIMITIVE_CHECK(delay.read(0U, 0U) == 0.0F);
  PRIMITIVE_CHECK(delay.read(1U, 0U) == -4.0F);
  delay.reset();
  PRIMITIVE_CHECK(delay.read(1U, 0U) == 0.0F);

  for (std::uint32_t frame = 1U; frame <= 12U; ++frame) {
    delay.push(0U, static_cast<float>(frame));
    delay.push(1U, -static_cast<float>(frame));
    for (std::uint32_t age = 0U; age <= 4U; ++age) {
      const float expected = frame > age ? static_cast<float>(frame - age) : 0.0F;
      PRIMITIVE_CHECK(delay.read(0U, age) == expected);
      PRIMITIVE_CHECK(delay.read(1U, age) == -expected);
    }
  }
  PRIMITIVE_CHECK(delay.readLinear(0U, 1.5) == 10.5F);
}

void testSmoothing() {
  effetune::dsp::OnePole pole;
  pole.reset(0.0);
  pole.setCoefficient(0.25);
  PRIMITIVE_CHECK(near(pole.process(1.0), 0.25));
  PRIMITIVE_CHECK(near(pole.process(1.0), 0.4375));
  pole.setTimeMilliseconds(0.0, 48000.0);
  PRIMITIVE_CHECK(pole.process(-2.0) == -2.0);

  effetune::dsp::AttackReleaseEnvelope envelope;
  envelope.setCoefficients(1.0, 0.25);
  PRIMITIVE_CHECK(envelope.process(1.0) == 1.0);
  PRIMITIVE_CHECK(near(envelope.process(0.0), 0.75));
  PRIMITIVE_CHECK(near(envelope.process(-1.0), 0.5625));

  effetune::dsp::LinearSmoother smoother;
  smoother.reset(0.0);
  smoother.setTarget(1.0, 4U);
  PRIMITIVE_CHECK(near(smoother.next(), 0.25));
  PRIMITIVE_CHECK(near(smoother.next(), 0.5));
  PRIMITIVE_CHECK(near(smoother.next(), 0.75));
  PRIMITIVE_CHECK(near(smoother.next(), 1.0));
  PRIMITIVE_CHECK(smoother.next() == 1.0);
  smoother.setTarget(-3.0, 0U);
  PRIMITIVE_CHECK(smoother.value() == -3.0);
}

void testRng() {
  effetune::dsp::XorShiftRng rng(1ULL);
  PRIMITIVE_CHECK(rng.nextU64() == 0x0000000040822041ULL);
  PRIMITIVE_CHECK(rng.nextU64() == 0x100041060c011441ULL);
  PRIMITIVE_CHECK(rng.nextU64() == 0x9b1e842f6e862629ULL);
  rng.seed(0ULL);
  PRIMITIVE_CHECK(rng.state() == effetune::dsp::XorShiftRng::kFallbackSeed);
  rng.seed(1U, 0U);
  PRIMITIVE_CHECK(near(rng.nextFloat01(), 5.866995778092132e-11, 1.0e-24));
  const double sample = rng.nextFloatSigned();
  PRIMITIVE_CHECK(sample >= -1.0 && sample < 1.0);
}

void testMath() {
  PRIMITIVE_CHECK(near(effetune::dsp::db_to_lin(0.0), 1.0));
  PRIMITIVE_CHECK(near(effetune::dsp::db_to_lin(20.0), 10.0));
  PRIMITIVE_CHECK(near(effetune::dsp::lin_to_db(0.1), -20.0));
  PRIMITIVE_CHECK(effetune::dsp::lin_to_db(0.0) == -240.0);
  PRIMITIVE_CHECK(effetune::dsp::flush_denorm(1.0e-40) == 0.0);
  PRIMITIVE_CHECK(effetune::dsp::flush_denorm(-2.0) == -2.0);
  PRIMITIVE_CHECK(effetune::dsp::clamp_value(5, 1, 4) == 4);
}

void testDenormalNoise() {
  using DenormalNoise = effetune::dsp::NyquistDenormalNoise;
  effetune::dsp::NyquistDenormalNoise noise;
  PRIMITIVE_CHECK(noise.sample(0u) == DenormalNoise::kAmplitude);
  PRIMITIVE_CHECK(noise.sample(1u) == -DenormalNoise::kAmplitude);
  PRIMITIVE_CHECK(noise.sample(0u) + noise.sample(1u) == 0.0);
  noise.advance(127u);
  PRIMITIVE_CHECK(noise.sample(0u) == -DenormalNoise::kAmplitude);
  noise.advance(129u);
  PRIMITIVE_CHECK(noise.sample(0u) == DenormalNoise::kAmplitude);
  noise.reset();
  PRIMITIVE_CHECK(noise.sample(0u) == DenormalNoise::kAmplitude);

  PRIMITIVE_CHECK(static_cast<float>(DenormalNoise::kAmplitude) >=
                  std::numeric_limits<float>::min());
  double positive_sum = 0.0;
  double negative_sum = 0.0;
  for (std::uint32_t plugin = 0u; plugin < DenormalNoise::kMaximumPluginCount; ++plugin) {
    for (std::uint32_t site = 0u; site < DenormalNoise::kMaximumCoherentSitesPerPlugin; ++site) {
      positive_sum += noise.sample(0u);
      negative_sum += noise.sample(1u);
    }
  }
  PRIMITIVE_CHECK(positive_sum <= DenormalNoise::kMaximumOutputNoiseAmplitude);
  PRIMITIVE_CHECK(negative_sum >= -DenormalNoise::kMaximumOutputNoiseAmplitude);
  PRIMITIVE_CHECK(positive_sum + negative_sum == 0.0);
}

void testFir() {
  std::array<double, 1026> coefficients{};
  std::array<double, 1026> samples{};
  std::array<float, 1026> float_samples{};
  for (std::uint32_t index = 0u; index < samples.size(); ++index) {
    samples[index] = std::sin(static_cast<double>(index) * 0.13);
    float_samples[index] = static_cast<float>(samples[index]);
    coefficients[index] = std::cos(static_cast<double>(index) * 0.31) * 0.03;
  }
  // Offset views exercise unaligned vector loads, all remainder sizes, and both sample formats.
  for (const std::uint32_t length : {0u, 1u, 2u, 3u, 4u, 5u, 8u, 9u, 64u, 65u, 129u, 513u, 1025u}) {
    double expected = 0.0, float_expected = 0.0;
    for (std::uint32_t tap = 0u; tap < length; ++tap) {
      expected += coefficients[tap + 1u] * samples[tap + 1u];
      float_expected += coefficients[tap + 1u] * static_cast<double>(float_samples[tap + 1u]);
    }
    PRIMITIVE_CHECK(near(
        effetune::dsp::firDot(coefficients.data() + 1u, samples.data() + 1u, length), expected));
    PRIMITIVE_CHECK(
        near(effetune::dsp::firDot(coefficients.data() + 1u, float_samples.data() + 1u, length),
             float_expected));
    auto symmetric = coefficients;
    for (std::uint32_t tap = 0u; tap < length / 2u; ++tap)
      symmetric[length - tap] = symmetric[tap + 1u];
    expected = float_expected = 0.0;
    for (std::uint32_t tap = 0u; tap < length; ++tap) {
      expected += symmetric[tap + 1u] * samples[tap + 1u];
      float_expected += symmetric[tap + 1u] * static_cast<double>(float_samples[tap + 1u]);
    }
    PRIMITIVE_CHECK(near(
        effetune::dsp::firSymmetric(symmetric.data() + 1u, samples.data() + 1u, length), expected));
    PRIMITIVE_CHECK(
        near(effetune::dsp::firSymmetric(symmetric.data() + 1u, float_samples.data() + 1u, length),
             float_expected));
  }
}

void testOversampledShaper() {
  constexpr std::uint32_t frames = 1200u;
  constexpr double pi = 3.14159265358979323846;
  std::array<std::array<double, frames>, 2> input{};
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    input[0][frame] = std::sin(frame * 0.37) + (frame == 0u ? 1.0 : 0.0);
    input[1][frame] = 0.9 * std::cos(frame * 0.17);
  }
  const auto shape = [](double value) {
    return value > 0.35 ? 0.35 : value < -0.35 ? -0.35 : value;
  };
  effetune::dsp::OversampledShaper shaper;
  shaper.prepare(2u);
  for (const std::uint32_t rate : {1u, 2u, 4u, 8u, 16u}) {
    const std::uint32_t length = 64u * rate + 1u;
    std::vector<double> filter(length);
    double sum = 0.0;
    for (std::uint32_t tap = 0u; tap < length; ++tap) {
      const double offset = static_cast<double>(tap) - 32.0 * rate;
      const double angle = 2.0 * pi * tap / (length - 1u);
      const double window = 0.42 - 0.5 * std::cos(angle) + 0.08 * std::cos(2.0 * angle);
      const double cutoff = 0.475 / rate;
      filter[tap] =
          (offset == 0.0 ? 2.0 * cutoff : std::sin(2.0 * pi * cutoff * offset) / (pi * offset)) *
          window;
      sum += filter[tap];
    }
    for (double &coefficient : filter)
      coefficient /= sum;
    for (int repetition = 0; repetition < 2; ++repetition) {
      // Reconfiguration and explicit reset must both discard the mirrored histories.
      if (repetition != 0)
        shaper.reset();
      shaper.configure(rate, 2u);
      double maximum_error = 0.0;
      for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
        std::vector<double> reference(frames * rate);
        for (std::uint32_t frame = 0u; frame < frames; ++frame) {
          double expected = shape(input[channel][frame]);
          if (rate > 1u) {
            // Independent direct convolution, without circular indexing or folded coefficients.
            for (std::uint32_t phase = 0u; phase < rate; ++phase) {
              double interpolated = 0.0;
              for (std::uint32_t tap = phase, delay = 0u; tap < length; tap += rate, ++delay) {
                if (delay <= frame)
                  interpolated += filter[tap] * input[channel][frame - delay];
              }
              reference[frame * rate + phase] = shape(interpolated * rate);
            }
            expected = 0.0;
            for (std::uint32_t tap = 0u; tap < length && tap <= frame * rate; ++tap)
              expected += filter[tap] * reference[frame * rate - tap];
          }
          const double actual = shaper.process(channel, input[channel][frame], shape);
          const double difference = std::abs(actual - expected);
          if (difference > maximum_error)
            maximum_error = difference;
          const double dry = shaper.delay(channel, input[channel][frame]);
          const double expected_dry = rate == 1u ? input[channel][frame]
                                      : frame < shaper.kLatency
                                          ? 0.0
                                          : input[channel][frame - shaper.kLatency];
          PRIMITIVE_CHECK(dry == expected_dry);
        }
      }
      PRIMITIVE_CHECK(maximum_error < 1.0e-12);
    }
  }
  shaper.configure(8u, 1u);
  PRIMITIVE_CHECK(shaper.process(0u, 0.0, shape) == 0.0);
}

} // namespace

int main() {
  testDelayLine();
  testSmoothing();
  testRng();
  testMath();
  testDenormalNoise();
  testFir();
  testOversampledShaper();

  if (failures != 0) {
    std::fprintf(stderr, "%d primitive test check(s) failed\n", failures);
    return 1;
  }
  std::puts("All DSP primitive tests passed");
  return 0;
}

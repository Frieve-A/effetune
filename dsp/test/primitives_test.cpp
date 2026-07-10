#include "effetune/dsp/delay_line.h"
#include "effetune/dsp/math.h"
#include "effetune/dsp/smoothing.h"
#include "effetune/dsp/xorshift_rng.h"

#include <cmath>
#include <cstdio>

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

} // namespace

int main() {
  testDelayLine();
  testSmoothing();
  testRng();
  testMath();

  if (failures != 0) {
    std::fprintf(stderr, "%d primitive test check(s) failed\n", failures);
    return 1;
  }
  std::puts("All DSP primitive tests passed");
  return 0;
}

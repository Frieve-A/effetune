#include "effetune/dsp/biquad.h"

#include <array>
#include <cmath>
#include <cstdio>
#include <limits>
#include <span>
#include <type_traits>

namespace {

using effetune::dsp::BiquadCoefficients;
using effetune::dsp::BiquadDf1State;
using effetune::dsp::BiquadTdf2State;
using effetune::dsp::processBiquadDf1Sample;
using effetune::dsp::processBiquadTdf2Sample;
using effetune::dsp::quantizeBiquadStatesToFloatAtBlockBoundary;
using effetune::dsp::quantizeBiquadStateToFloat;
using effetune::dsp::resetBiquadStates;

int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "biquad_test.cpp:%d: check failed: %s\n", line, expression);
    ++failures;
  }
}

#define BIQUAD_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

bool near(double actual, double expected, double tolerance = 1.0e-12) noexcept {
  const double difference = actual - expected;
  const double absolute = difference < 0.0 ? -difference : difference;
  return absolute <= tolerance;
}

double roundToFloat(double value) noexcept {
  return static_cast<double>(static_cast<float>(value));
}

constexpr BiquadCoefficients kReferenceCoefficients{0.25, 0.5, 0.25, -0.5, 0.25};

constexpr std::array<double, 6> kReferenceImpulseResponse{0.25,    0.625,     0.5,
                                                          0.09375, -0.078125, -0.0625};

static_assert(std::is_trivially_copyable_v<BiquadCoefficients>);
static_assert(std::is_trivially_copyable_v<BiquadDf1State>);
static_assert(std::is_trivially_copyable_v<BiquadTdf2State>);
static_assert(std::is_standard_layout_v<BiquadDf1State>);
static_assert(std::is_standard_layout_v<BiquadTdf2State>);

void testIdentity() {
  const BiquadCoefficients coefficients{};
  BiquadDf1State df1_state{};
  BiquadTdf2State tdf2_state{};
  constexpr std::array<double, 5> input{0.25, -0.5, 1.0, 0.0, -0.125};

  BIQUAD_CHECK(coefficients.isFinite());
  for (double sample : input) {
    BIQUAD_CHECK(processBiquadDf1Sample(sample, coefficients, df1_state) == sample);
    BIQUAD_CHECK(processBiquadTdf2Sample(sample, coefficients, tdf2_state) == sample);
  }

  BIQUAD_CHECK(df1_state.x1 == -0.125);
  BIQUAD_CHECK(df1_state.x2 == 0.0);
  BIQUAD_CHECK(df1_state.y1 == -0.125);
  BIQUAD_CHECK(df1_state.y2 == 0.0);
  BIQUAD_CHECK(tdf2_state.s1 == 0.0);
  BIQUAD_CHECK(tdf2_state.s2 == 0.0);
}

void testReferenceImpulseResponse() {
  BiquadDf1State df1_state{};
  BiquadTdf2State tdf2_state{};

  for (std::size_t index = 0; index < kReferenceImpulseResponse.size(); ++index) {
    const double input = index == 0 ? 1.0 : 0.0;
    const double df1_output = processBiquadDf1Sample(input, kReferenceCoefficients, df1_state);
    const double tdf2_output = processBiquadTdf2Sample(input, kReferenceCoefficients, tdf2_state);
    BIQUAD_CHECK(near(df1_output, kReferenceImpulseResponse[index]));
    BIQUAD_CHECK(near(tdf2_output, kReferenceImpulseResponse[index]));
    BIQUAD_CHECK(near(df1_output, tdf2_output));
  }
}

void testReset() {
  std::array<BiquadDf1State, 3> df1_states{};
  std::array<BiquadTdf2State, 3> tdf2_states{};

  for (std::size_t channel = 0; channel < df1_states.size(); ++channel) {
    const double input = static_cast<double>(channel + 1);
    (void)processBiquadDf1Sample(input, kReferenceCoefficients, df1_states[channel]);
    (void)processBiquadTdf2Sample(input, kReferenceCoefficients, tdf2_states[channel]);
  }

  resetBiquadStates(std::span{df1_states});
  resetBiquadStates(std::span{tdf2_states});

  for (std::size_t channel = 0; channel < df1_states.size(); ++channel) {
    BIQUAD_CHECK(df1_states[channel].x1 == 0.0);
    BIQUAD_CHECK(df1_states[channel].x2 == 0.0);
    BIQUAD_CHECK(df1_states[channel].y1 == 0.0);
    BIQUAD_CHECK(df1_states[channel].y2 == 0.0);
    BIQUAD_CHECK(tdf2_states[channel].s1 == 0.0);
    BIQUAD_CHECK(tdf2_states[channel].s2 == 0.0);
  }

  BIQUAD_CHECK(processBiquadDf1Sample(0.0, kReferenceCoefficients, df1_states[0]) == 0.0);
  BIQUAD_CHECK(processBiquadTdf2Sample(0.0, kReferenceCoefficients, tdf2_states[0]) == 0.0);
}

void testBlockBoundaryFloatQuantization() {
  std::array<BiquadDf1State, 2> df1_states{
      BiquadDf1State{1.0 / 3.0, -1.0 / 7.0, 2.0 / 9.0, -2.0 / 11.0},
      BiquadDf1State{-4.0 / 13.0, 4.0 / 15.0, -8.0 / 17.0, 8.0 / 19.0}};
  std::array<BiquadTdf2State, 2> tdf2_states{BiquadTdf2State{1.0 / 3.0, -1.0 / 7.0},
                                             BiquadTdf2State{-4.0 / 13.0, 4.0 / 15.0}};
  const auto original_df1_states = df1_states;
  const auto original_tdf2_states = tdf2_states;

  BIQUAD_CHECK(df1_states[0].x1 != roundToFloat(df1_states[0].x1));
  BIQUAD_CHECK(tdf2_states[0].s1 != roundToFloat(tdf2_states[0].s1));

  quantizeBiquadStateToFloat(df1_states[0]);
  quantizeBiquadStateToFloat(tdf2_states[0]);
  quantizeBiquadStatesToFloatAtBlockBoundary(std::span{df1_states}.subspan(1));
  quantizeBiquadStatesToFloatAtBlockBoundary(std::span{tdf2_states}.subspan(1));

  for (std::size_t channel = 0; channel < df1_states.size(); ++channel) {
    BIQUAD_CHECK(df1_states[channel].x1 == roundToFloat(original_df1_states[channel].x1));
    BIQUAD_CHECK(df1_states[channel].x2 == roundToFloat(original_df1_states[channel].x2));
    BIQUAD_CHECK(df1_states[channel].y1 == roundToFloat(original_df1_states[channel].y1));
    BIQUAD_CHECK(df1_states[channel].y2 == roundToFloat(original_df1_states[channel].y2));
    BIQUAD_CHECK(tdf2_states[channel].s1 == roundToFloat(original_tdf2_states[channel].s1));
    BIQUAD_CHECK(tdf2_states[channel].s2 == roundToFloat(original_tdf2_states[channel].s2));
  }
}

void testFiniteBehavior() {
  BiquadCoefficients invalid_coefficients{};
  invalid_coefficients.a2 = std::numeric_limits<double>::infinity();
  BIQUAD_CHECK(!invalid_coefficients.isFinite());
  invalid_coefficients.a2 = std::numeric_limits<double>::quiet_NaN();
  BIQUAD_CHECK(!invalid_coefficients.isFinite());

  BiquadDf1State df1_state{};
  BiquadTdf2State tdf2_state{};
  df1_state.y2 = std::numeric_limits<double>::infinity();
  tdf2_state.s2 = std::numeric_limits<double>::quiet_NaN();
  BIQUAD_CHECK(!df1_state.isFinite());
  BIQUAD_CHECK(!tdf2_state.isFinite());
  df1_state.reset();
  tdf2_state.reset();
  BIQUAD_CHECK(df1_state.isFinite());
  BIQUAD_CHECK(tdf2_state.isFinite());

  for (std::size_t index = 0; index < 4096; ++index) {
    const double input = (index & 1U) == 0U ? 1.0e20 : -1.0e20;
    const double df1_output = processBiquadDf1Sample(input, kReferenceCoefficients, df1_state);
    const double tdf2_output = processBiquadTdf2Sample(input, kReferenceCoefficients, tdf2_state);
    BIQUAD_CHECK(std::isfinite(df1_output));
    BIQUAD_CHECK(std::isfinite(tdf2_output));
  }
  BIQUAD_CHECK(df1_state.isFinite());
  BIQUAD_CHECK(tdf2_state.isFinite());
}

void testDf1ChannelStateSeparation() {
  std::array<BiquadDf1State, 2> states{};

  const double channel_0_first = processBiquadDf1Sample(1.0, kReferenceCoefficients, states[0]);
  const double channel_1_first = processBiquadDf1Sample(0.0, kReferenceCoefficients, states[1]);
  const double channel_0_second = processBiquadDf1Sample(0.0, kReferenceCoefficients, states[0]);
  const double channel_1_second = processBiquadDf1Sample(-2.0, kReferenceCoefficients, states[1]);

  BIQUAD_CHECK(near(channel_0_first, 0.25));
  BIQUAD_CHECK(near(channel_1_first, 0.0));
  BIQUAD_CHECK(near(channel_0_second, 0.625));
  BIQUAD_CHECK(near(channel_1_second, -0.5));
  BIQUAD_CHECK(states[0].x1 == 0.0);
  BIQUAD_CHECK(states[1].x1 == -2.0);
}

void testTdf2ChannelStateSeparation() {
  std::array<BiquadTdf2State, 2> states{};

  const double channel_0_first = processBiquadTdf2Sample(1.0, kReferenceCoefficients, states[0]);
  const double channel_1_first = processBiquadTdf2Sample(0.0, kReferenceCoefficients, states[1]);
  const double channel_0_second = processBiquadTdf2Sample(0.0, kReferenceCoefficients, states[0]);
  const double channel_1_second = processBiquadTdf2Sample(-2.0, kReferenceCoefficients, states[1]);

  BIQUAD_CHECK(near(channel_0_first, 0.25));
  BIQUAD_CHECK(near(channel_1_first, 0.0));
  BIQUAD_CHECK(near(channel_0_second, 0.625));
  BIQUAD_CHECK(near(channel_1_second, -0.5));
  BIQUAD_CHECK(near(states[0].s1, 0.5));
  BIQUAD_CHECK(near(states[1].s1, -1.25));
}

} // namespace

int main() {
  testIdentity();
  testReferenceImpulseResponse();
  testReset();
  testBlockBoundaryFloatQuantization();
  testFiniteBehavior();
  testDf1ChannelStateSeparation();
  testTdf2ChannelStateSeparation();

  if (failures != 0) {
    std::fprintf(stderr, "%d Biquad test check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Biquad tests passed");
  return 0;
}

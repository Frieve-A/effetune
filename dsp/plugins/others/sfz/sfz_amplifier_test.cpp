#include "sfz_amplifier.h"
#include <array>
#include <cstdio>
#include <cstdlib>
namespace a = effetune::plugins::others::sfz::amplifier;
static void near(float actual, float expected, const char *message) {
  if (std::abs(actual - expected) > 1e-5F) {
    std::fprintf(stderr, "%s: %g != %g\n", message, actual, expected);
    std::exit(1);
  }
}
int main() {
  const std::array points{a::CurvePoint{1, .2F}, a::CurvePoint{3, .3F}};
  near(a::velocityCurve(2, points), .25F, "published interpolated point");
  near(a::velocityCurve(0, points), 0, "implicit zero endpoint");
  near(a::velocityCurve(127, points), 1, "implicit full endpoint");
  near(a::velocityGain(63.5F, 100), .25F, "standard squared amplitude");
  near(a::velocityGain(127, -100), 0, "negative tracking silent endpoint");
  near(a::velocityGain(0, -100), -1, "negative tracking signed endpoint");
  near(a::velocityGain(2, 100, points), .25F, "custom curve replaces default square");
  near(a::velocityGain(2, 50, points), .625F, "reference half tracking uses resolved custom curve");
  near(a::velocityGain(0, 0, points), 1, "disabled tracking has unity gain");
  // Direct public-reference ordinary-response anchors at velocity64.
  near(a::velocityGain(64, 50), .62697625395F, "reference ordinary half tracking");
  near(a::velocityGain(64, -100), -.74604749209F, "reference signed ordinary tracking");
  const std::array custom{a::CurvePoint{64, .75F}};
  near(a::velocityGain(64, 50, custom), .875F, "reference custom half tracking");
  near(a::velocityGain(64, -100, custom), -.25F, "reference custom negative tracking");
  near(a::velocityResponse(.25F, 1.5F), -.125F, "positive effective track can invert output");
  near(a::velocityResponse(.25F, -.5F), -.375F, "negative effective track remains signed");
  near(a::velocityResponse(1, -1), 0, "maximum velocity negative branch is zero");
  near(a::velocityResponse(1, 1), 1, "maximum velocity nonnegative branch is unity");
  const auto draw = a::velocityBirthRandom(4, 1);
  near(a::velocityBirthRandom(4, 1), draw, "immutable birth identity reconstructs draw");
  if (!(draw >= 0 && draw < 1 && draw != a::velocityBirthRandom(4, 2) &&
        draw != a::velocityBirthRandom(5, 1)))
    std::exit(1);
  a::PanSettings pan{2, 60, 20, 10, 1, 1};
  near(a::panOffset(pan, 72, 127, -1), 34, "key velocity and birth random add once");
  near(a::panGains(150, 1).left, 0, "pan clamps at endpoint");
  near(a::panGains(0, 1).left, 1, "balance center left unity");
  near(a::panGains(0, 1).right, 1, "balance center right unity");
  const auto mma = a::panGains(0, 2);
  near(mma.left * mma.left + mma.right * mma.right, 1, "MMA center equal power");
  near(.25F + .25F * a::phaseGain(pan), 0, "inverted identical signal cancels");
  const a::PositionSettings position{2, 60, -20, 100};
  near(static_cast<float>(a::positionOffset(position, 72, 127, 0)), 4,
       "position adds key and unipolar velocity before final clamp");
  near(static_cast<float>(a::positionOffset(position, 72, 127, 1)), 104,
       "positive position random reaches the signed depth endpoint");
  auto negative = position;
  negative.random = -100;
  near(static_cast<float>(a::positionOffset(negative, 72, 127, .25F)), -21,
       "negative random mirrors positive one-sided position offset");
  for (const auto key : {49.F, 50.F, 51.F, 69.F, 70.F, 71.F}) {
    const float expected = key <= 50 ? -100.F : key >= 70 ? 100.F : (key - 60) * 10;
    const auto offset = a::positionOffset({10, 60, 0, 0}, key, 127, .5F);
    near(a::bounded(static_cast<float>(offset), -100, 100), expected,
         "position adjacent saturation boundary");
  }
  near(static_cast<float>(a::positionOffset({}, 0, 1, 1)), 0,
       "default position tracking leaves existing bank behavior unchanged");
  const a::Crossfade fadeIn{2, 0, 127, 127, 127, 0}, fadeOut{2, 0, 0, 0, 127, 0};
  near(a::crossfadeGain(fadeIn, 0), 0, "CC fade starts silent");
  near(a::crossfadeGain(fadeIn, 127), 1, "CC fade ends full");
  for (float value : {0.F, 31.75F, 63.5F, 95.25F, 127.F}) {
    near(a::crossfadeGain(fadeIn, value) + a::crossfadeGain(fadeOut, value), 1,
         "linear pair constant amplitude");
    auto powerIn = fadeIn, powerOut = fadeOut;
    powerIn.power = powerOut.power = 1;
    const auto in = a::crossfadeGain(powerIn, value), out = a::crossfadeGain(powerOut, value);
    near(in * in + out * out, 1, "power pair constant energy");
  }
  const std::array fades{a::Crossfade{0, 48, 72, 127, 127, 0}, a::Crossfade{1, 0, 127, 127, 127, 0},
                         fadeIn};
  near(a::crossfadeGain(fades, 60, 63.5F, [](std::uint32_t cc) { return cc == 0 ? 63.5F : 0.F; }),
       .125F, "independent key velocity and CC crossfades multiply");
  std::puts("SFZ amplifier tests passed");
}

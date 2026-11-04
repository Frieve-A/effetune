#include "sfz_pitch.h"
#include <cstdio>
#include <cstdlib>
#include <type_traits>

namespace p = effetune::plugins::others::sfz::pitch;
static void require(bool condition, const char *message) {
  if (!condition) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
static void near(float actual, float expected, const char *message) {
  require(std::abs(actual - expected) < .001F, message);
}
int main() {
  static_assert(std::is_trivially_copyable_v<p::BendState>);
  p::BendSettings settings;
  near(p::bendTarget(settings, -8192, 2), -200, "negative bend endpoint");
  near(p::bendTarget(settings, 8191, 2), 200, "positive bend endpoint");
  near(p::bendTarget(settings, 0, 2), 0, "center");
  near(p::bendTarget(settings, 51, 2), 1, "public default one-cent quantization");
  settings.up = -1200;
  settings.down = 700;
  settings.stepUp = 100;
  settings.stepDown = 200;
  near(p::bendTarget(settings, 4096, 2), -600, "negative up range");
  near(p::bendTarget(settings, -4096, 2), 400, "positive down range and nearest step");
  near(p::bendTarget(settings, 8191, 12), -7200, "existing RPN range scaling");
  near(p::bendTarget(settings, -8192, 0), 0, "zero RPN range");
  settings = {};
  settings.smoothMs = 100;
  p::BendState state;
  near(p::tickBend(state, settings, 8191, 2, .01), 200, "no artificial onset ramp");
  near(p::tickBend(state, settings, -8192, 2, .01), 160, "first smoothing sample");
  auto trial = state;
  for (int i = 0; i < 9; ++i)
    near(p::tickBend(state, settings, -8192, 2, .01), p::tickBend(trial, settings, -8192, 2, .01),
         "trial copy preserves ramp exactly");
  near(state.current, -200, "smoothing reaches endpoint");
  p::BendState independent;
  near(p::tickBend(independent, settings, 0, 2, .01), 0, "independent voice/channel state");
  require(p::shiftedKey(60, -12) == 48 && p::shiftedKey(60, 3) == 63,
          "separate note and switch shifts");
  require(p::shiftedKey(0, -1) == -1 && p::shiftedKey(127, 1) == -1,
          "out-of-range keys do not alias endpoint notes");
  std::puts("SFZ pitch tests passed");
}

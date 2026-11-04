#include "sfz_oscillator.h"
#include <cstdio>
#include <cstdlib>
#include <type_traits>
#include <vector>
namespace o = effetune::plugins::others::sfz::oscillator;
static void require(bool condition, const char *message) {
  if (!condition) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
static void near(double actual, double expected, double tolerance, const char *message) {
  require(std::abs(actual - expected) <= tolerance, message);
}
int main() {
  static_assert(std::is_trivially_copyable_v<o::State>);
  const auto sine = [](double phase, double, std::uint32_t) {
    const float value = static_cast<float>(std::sin(phase * 6.2831853071795864769));
    return o::Stereo{value, value};
  };
  o::Settings settings;
  o::State state;
  for (double rate : {44100.0, 48000.0, 96000.0}) {
    o::reset(state, settings, 42);
    int crossings = 0;
    float previous = 0;
    for (int frame = 0; frame < static_cast<int>(rate); ++frame) {
      const auto value = o::tick(state, settings, 440, rate, sine).left;
      if (previous < 0 && value >= 0)
        ++crossings;
      previous = value;
    }
    require(crossings >= 439 && crossings <= 440, "440Hz across host rates");
  }
  settings.phaseDegrees = 90;
  o::reset(state, settings, 42);
  near(o::tick(state, settings, 440, 48000, sine).left, 1, 1e-6, "degrees at birth");
  settings.multi = 5;
  settings.detuneCents = 100;
  o::reset(state, settings, 42);
  std::vector<double> frequencies;
  const auto unison =
      o::tick(state, settings, 440, 48000, [&](double, double increment, std::uint32_t) {
        frequencies.push_back(increment * 48000);
        return o::Stereo{1, 1};
      });
  const std::array<double, 5> expected = {440, 415.30469758, 466.16376152, 433.6918074,
                                          446.3999474};
  for (std::size_t i = 0; i < expected.size(); ++i)
    near(frequencies[i], expected[i], .001, "published unison tuning");
  near(unison.left, 2.5, 1e-6, "published left gains sum");
  near(unison.right, 2.5, 1e-6, "published right gains sum");
  settings = {};
  settings.multi = 2;
  o::reset(state, settings, 42);
  double mean = 0;
  for (int i = 0; i < 4800; ++i)
    mean += o::tick(state, settings, 480, 48000, sine).left / 4800;
  near(mean, .5, 1e-6, "ring modulation produces sine-squared DC");
  settings = {};
  settings.phaseDegrees = 90;
  settings.mode = 1;
  o::reset(state, settings, 42);
  near(o::tick(state, settings, 440, 48000, sine).left, std::cos(1.0), 1e-6,
       "phase modulation index one");
  for (std::uint32_t mode : {1u, 2u}) {
    settings = {};
    settings.mode = mode;
    settings.modDepth = 0;
    o::reset(state, settings, 42);
    for (int i = 0; i < 1000; ++i)
      near(o::tick(state, settings, 440, 48000, sine).left,
           std::sin(i * 440.0 / 48000 * 6.2831853071795864769), 1e-5,
           "zero PM/FM index is carrier");
  }
  settings = {};
  settings.wave = 5;
  o::reset(state, settings, 42);
  auto trial = state;
  std::array<float, 8192> first{};
  bool repeats = true;
  for (int i = 0; i < 16384; ++i) {
    const auto value = o::tick(state, settings, 440, 48000, sine).left;
    near(value, o::tick(trial, settings, 440, 48000, sine).left, 0, "noise exact trial");
    require(value >= -1 && value <= 1, "bounded white noise");
    if (i < 8192)
      first[i] = value;
    else
      repeats &= value == first[i - 8192];
  }
  require(!repeats, "noise never loops the old 8192-frame sample");
  settings.phaseDegrees = -5;
  o::reset(state, settings, 1);
  o::reset(trial, settings, 2);
  require(state.phase != trial.phase, "random phase has independent reproducible seeds");
  std::puts("SFZ oscillator tests passed");
}

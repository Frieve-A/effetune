#include "sfz_cycle_reader.h"
#include "sfz_resampling.h"
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace o = effetune::plugins::others::sfz::oscillator;
static void require(bool condition, const char *message) {
  if (!condition) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
struct Cycle {
  std::uint32_t frames;
  std::vector<float> pcm;
  std::uint32_t largestWindow = 0;
  explicit Cycle(std::uint32_t length, double harmonic = 1, double dc = .125) : frames(length) {
    for (auto n = length;; n = n / 2 + n % 2) {
      for (auto i = 0u; i < n; ++i) {
        const double tone =
            n > 1 && harmonic < n * .5 ? std::sin(6.2831853071795864769 * harmonic * i / n) : 0;
        pcm.push_back(static_cast<float>(dc + tone));
        pcm.push_back(static_cast<float>(dc - tone));
      }
      if (n == 1)
        break;
    }
  }
  o::Stereo read(double phase, double step, std::uint32_t quality) {
    return o::readCycle(
        frames, 2, phase, step, quality,
        [&](std::uint64_t offset, std::uint32_t length, std::int64_t first, std::uint32_t count,
            std::uint32_t channel, float *scratch) {
          require(count <= 514, "bounded FIR window");
          largestWindow = std::max(count, largestWindow);
          for (auto i = 0u; i < count; ++i) {
            const auto at = (first + i) % static_cast<std::int64_t>(length);
            const auto wrapped = at < 0 ? at + length : at;
            scratch[i] = pcm[(offset + wrapped) * 2 + channel];
          }
          return scratch;
        },
        [](double distance) {
          return static_cast<float>(
              effetune::plugins::others::sfz::sincKernel(std::abs(distance), 32));
        });
  }
};
int main() {
  for (const auto n : {1u, 31u, 1024u, 1025u, 65537u}) {
    Cycle cycle(n);
    for (const auto quality : {0u, 1u, 2u, 3u}) {
      for (const double speed : {.5, -.5, 1.0, -123.25}) {
        const auto value = cycle.read(.273, speed, quality);
        require(std::abs(value.left - .125) < 1e-7 && value.left == value.right,
                "at and above Nyquist retain original stereo DC");
      }
    }
    for (const auto quality : {2u, 3u}) {
      for (int i = 0; i < 250; ++i) {
        const double speed = std::exp2(-20 + i * .075);
        const auto forward = cycle.read(.173, speed, quality);
        const auto reverse = cycle.read(.173, -speed, quality);
        require(forward.left == reverse.left && forward.right == reverse.right,
                "signed FM uses absolute increment for band limiting");
        require(std::abs(forward.left + forward.right - .25) < 2e-6,
                "normalized stereo FIR preserves DC through every level");
      }
      // Probe the same physical phase on both sides of every level transition.
      for (auto size = n; size > 16; size = size / 2 + size % 2) {
        const double boundary = 8.0 / size;
        const auto a = cycle.read(.173, boundary * (1 - 1e-8), quality);
        const auto b = cycle.read(.173, boundary * (1 + 1e-8), quality);
        require(std::abs(a.left - b.left) < 2e-6, "continuous odd/even pyramid transition");
      }
    }
  }
  Cycle passband(1025), stopband(1025, 31, 0);
  for (const auto quality : {2u, 3u}) {
    double error = 0, alias = 0;
    for (int i = 0; i < 1000; ++i) {
      const double phase = o::wrap(i * .02);
      const auto value = passband.read(phase, .02, quality).left;
      const double expected = .125 + std::sin(phase * 6.2831853071795864769);
      error += (value - expected) * (value - expected);
      const double rejected = stopband.read(phase, .02, quality).left;
      alias += rejected * rejected;
    }
    require(std::sqrt(error / 1000) < .0002, "pitched fundamental amplitude and phase");
    require(std::sqrt(alias / 1000) < .0002, "above-Nyquist harmonic rejected without alias");
    double phase = .173, sweepError = 0;
    for (int i = 0; i < 4096; ++i) {
      const double speed = std::exp2(2 + 4.0 * i / 4095) / passband.frames;
      const double expected = .125 + std::sin(phase * 6.2831853071795864769);
      const double difference = passband.read(phase, speed, quality).left - expected;
      sweepError += difference * difference;
      phase = o::wrap(phase + speed);
    }
    require(std::sqrt(sweepError / 4096) < .001,
            "continuous pitch sweep preserves phase and gain across four levels");
  }
  Cycle tiny(4, 1, 0);
  require(tiny.read(.125, .01, 0).left == 1, "quality zero nearest cyclic sample");
  require(std::abs(tiny.read(.125, .01, 1).left - .5) < 1e-7,
          "quality one linear cyclic interpolation");
  o::Settings settings;
  o::State state;
  o::reset(state, settings, 1);
  const auto dc = o::tick(state, settings, 48000, 48000,
                          [&](double phase, double speed, std::uint32_t quality) {
                            return passband.read(phase, speed, quality);
                          });
  require(dc.left == .125F, "oscillator dispatch delegates high-frequency DC to reader");
  std::puts("SFZ cyclic pyramid reader tests passed");
}

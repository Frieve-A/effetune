#include "allocation_guard.h"
#include "effetune/dsp/fir.h"
#include "sample_resampling.h"
#include <array>
#include <bit>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <limits>

using effetune::plugins::others::sfz::SampleResamplingTables;
namespace allocation_guard = effetune::allocation_guard;
namespace {
int failures = 0;
#define CHECK(expression)                                                                          \
  do {                                                                                             \
    if (!(expression)) {                                                                           \
      std::fprintf(stderr, "sample-resampling:%d %s\n", __LINE__, #expression);                    \
      ++failures;                                                                                  \
    }                                                                                              \
  } while (false)

std::uint64_t coefficientHash(const SampleResamplingTables &tables) {
  std::uint64_t hash = 14695981039346656037ull;
  for (auto index = 0u; index < tables.kRadii.size() * tables.kRows; ++index) {
    const auto &kernel = tables.kernel(index);
    const auto *values = tables.coefficients(index);
    for (auto word = 0u; word < tables.kRows * kernel.taps; ++word) {
      hash ^= std::bit_cast<std::uint32_t>(values[word]);
      hash *= 1099511628211ull;
    }
  }
  return hash;
}

double response(const SampleResamplingTables &tables, unsigned index, unsigned phase,
                double frequency) {
  const auto &kernel = tables.kernel(index);
  const auto *values = tables.coefficients(index) + phase * kernel.taps;
  double real = 0, imaginary = 0;
  for (auto tap = 0u; tap < kernel.taps; ++tap) {
    const auto angle = 6.2831853071795864769 * frequency * tap;
    real += values[tap] * std::cos(angle);
    imaginary += values[tap] * std::sin(angle);
  }
  return std::hypot(real, imaginary);
}

void geometryAndSelection(const SampleResamplingTables &tables) {
  static_assert(SampleResamplingTables::kPhases == 64u && SampleResamplingTables::kRows == 65u &&
                SampleResamplingTables::kBandsPerOctave == 32u);
  CHECK(tables.kRadii == (std::array<std::uint32_t, 9>{31, 15, 4, 8, 12, 16, 20, 24, 28}));
  CHECK(tables.kernel(0u).taps == 64u);
  CHECK(tables.kernel(tables.kRows).taps == 32u);
  std::size_t coefficientWords = 0, prototypeWords = 0;
  const auto guard = std::exp2(1.0 / tables.kBandsPerOctave);
  for (auto profile = 0u; profile < tables.kRadii.size(); ++profile) {
    prototypeWords += tables.kRadii[profile] * tables.kResolution + 2u;
    for (auto row = 0u; row < tables.kRows; ++row) {
      const auto index = profile * tables.kRows + row;
      const auto &kernel = tables.kernel(index);
      CHECK(kernel.profile == profile && kernel.offset == coefficientWords);
      CHECK(kernel.radius == std::ceil(tables.kRadii[profile] * kernel.step));
      CHECK(kernel.taps == 2u * kernel.radius + 2u);
      CHECK(kernel.step >= 1 && kernel.step <= 4);
      if (row) {
        CHECK(kernel.step > tables.kernel(index - 1u).step);
        CHECK(tables.coefficients(index) ==
              tables.coefficients(index - 1u) + tables.kRows * tables.kernel(index - 1u).taps);
      }
      CHECK(tables.select(profile, kernel.step) == index);
      CHECK(tables.contains(index, profile, kernel.step));
      CHECK(tables.safe(index, kernel.step * guard));
      CHECK(!tables.safe(
          index, std::nextafter(kernel.step * guard, std::numeric_limits<double>::infinity())));
      coefficientWords += static_cast<std::size_t>(tables.kRows) * kernel.taps;
    }
    for (const auto step : {.125, .5, 1.0})
      CHECK(tables.select(profile, step) == profile * tables.kRows);
    for (const auto step : {1.01, 1.5, 2.38, 4.0}) {
      const auto index = tables.select(profile, step);
      CHECK(index != tables.kInvalid);
      if (index == tables.kInvalid)
        return;
      const auto &kernel = tables.kernel(index);
      CHECK(kernel.step >= step && kernel.step <= tables.maximumBankStep(step));
      CHECK(kernel.radius > tables.kRadii[profile]);
      CHECK(tables.safe(index, step) && tables.contains(index, profile, step));
      CHECK(!tables.contains(index, (profile + 1u) % tables.kRadii.size(), step));
      CHECK(tables.maximumBankStep(step) >= step);
    }
  }
  CHECK(tables.storageBytes() == (coefficientWords + prototypeWords) * sizeof(float));
  CHECK(tables.storageBytes() < 12u * 1024u * 1024u);
  CHECK(tables.select(9u, 1) == tables.kInvalid);
  CHECK(tables.select(0u, std::nextafter(4.0, 5.0)) == tables.kInvalid);
  CHECK(tables.select(0u, std::numeric_limits<double>::infinity()) == tables.kInvalid);
  CHECK(tables.select(0u, std::numeric_limits<double>::quiet_NaN()) == tables.kInvalid);
  CHECK(!tables.safe(tables.kInvalid, 1));
  CHECK(!tables.contains(tables.kInvalid, 0u, 1));
  CHECK(tables.maximumBankStep(.25) == guard);
  CHECK(tables.maximumBankStep(8) == 8);
}

void normalizationAndResponse(const SampleResamplingTables &tables) {
  for (auto profile = 0u; profile < tables.kRadii.size(); ++profile)
    for (const auto step : {1.0, 1.5, 2.38, 4.0}) {
      const auto index = tables.select(profile, step);
      CHECK(index != tables.kInvalid);
      if (index == tables.kInvalid)
        return;
      const auto &kernel = tables.kernel(index);
      for (const auto phase : {0u, 24u, 64u}) {
        const auto *values = tables.coefficients(index) + phase * kernel.taps;
        double sum = 0;
        for (auto tap = 0u; tap < kernel.taps; ++tap) {
          CHECK(std::isfinite(values[tap]));
          sum += values[tap];
        }
        CHECK(std::abs(sum - 1) < .000001);
        std::array<float, 2u * SampleResamplingTables::kRadii[0] * 4u + 2u> input{};
        CHECK(kernel.taps <= input.size());
        for (const auto level : {.1F, .25F, -.31F, 1.0F}) {
          input.fill(level);
          const auto output = effetune::dsp::firDot(values, input.data(), kernel.taps);
          CHECK(std::abs(output - level) < .000001F);
        }
        if (profile <= 1u) {
          // High preserves a wider passband; Balanced intentionally uses fewer
          // taps. Bounds specify their distinct anti-alias responses in amplitude.
          const auto pass = response(tables, index, phase, (profile ? .30 : .35) / step);
          const auto stop = response(tables, index, phase, .5 / step);
          CHECK(std::abs(pass - 1) < (profile ? .01 : .005));
          CHECK(stop < (profile ? .06 : .0004));
        }
      }
    }
  for (const auto step : {1.0, 1.5, 2.38, 4.0}) {
    const auto highIndex = tables.select(0u, step);
    const auto balancedIndex = tables.select(1u, step);
    CHECK(highIndex != tables.kInvalid && balancedIndex != tables.kInvalid);
    if (highIndex == tables.kInvalid || balancedIndex == tables.kInvalid)
      return;
    const auto high = response(tables, highIndex, 24u, .5 / step);
    const auto balanced = response(tables, balancedIndex, 24u, .5 / step);
    CHECK(high * 16 < balanced);
  }
}

void prototypeFallback(const SampleResamplingTables &tables) {
  for (auto profile = 0u; profile < tables.kRadii.size(); ++profile) {
    const auto radius = static_cast<double>(tables.kRadii[profile]);
    CHECK(tables.coefficient(profile, 0) > 0);
    CHECK(tables.coefficient(profile, radius) == 0);
    CHECK(tables.coefficient(profile, radius + 1) == 0);
    for (const auto step : {4.01, 8.0, 32.0}) {
      CHECK(tables.select(profile, step) == tables.kInvalid);
      for (const auto distance : {0.0, .125, 1.375, 3.875}) {
        const auto value = tables.coefficient(profile, distance / step);
        CHECK(std::isfinite(value));
        CHECK(value == tables.coefficient(profile, -distance / step));
      }
    }
  }
}
} // namespace

int main() {
  SampleResamplingTables tables;
  CHECK(!allocation_guard::active());
  const auto wallStart = std::chrono::steady_clock::now();
  const auto cpuStart = std::clock();
  if (!tables.prepare()) {
    std::fprintf(stderr, "sample-resampling: CONTROL preparation failed\n");
    return 1;
  }
  const auto prepareWallMs =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - wallStart)
          .count();
  const auto prepareCpuMs = 1000.0 * (std::clock() - cpuStart) / CLOCKS_PER_SEC;
  const auto bytes = tables.storageBytes();
  std::printf("sample-resampling: prepare wallMs=%.3f cpuMs=%.3f storageBytes=%zu\n", prepareWallMs,
              prepareCpuMs, bytes);
  const auto hash = coefficientHash(tables);
  const auto *first = tables.coefficients(0u);
  const auto violations = allocation_guard::violationCount();
  {
    allocation_guard::Scope guard;
    geometryAndSelection(tables);
    normalizationAndResponse(tables);
    prototypeFallback(tables);
    CHECK(tables.storageBytes() == bytes && tables.coefficients(0u) == first);
    CHECK(coefficientHash(tables) == hash);
    CHECK(allocation_guard::violationCount() == violations);
  }
  return failures ? 1 : 0;
}

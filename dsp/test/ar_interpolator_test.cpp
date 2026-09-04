#include "effetune/dsp/ar_interpolator.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

namespace {

constexpr std::uint32_t kProcessSamples = 4096u;
constexpr std::uint32_t kMissingBegin = 2048u;
constexpr std::uint32_t kMissingSamples = 64u;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "AR interpolator check failed: %s\n", message);
    ++failures;
  }
}

class Random final {
public:
  explicit Random(std::uint32_t seed) noexcept : state_(seed | 1u) {}

  double bipolar() noexcept {
    state_ ^= state_ << 13u;
    state_ ^= state_ >> 17u;
    state_ ^= state_ << 5u;
    return 2.0 * static_cast<double>(state_ >> 8u) / static_cast<double>(1u << 24u) - 1.0;
  }

private:
  std::uint32_t state_;
};

std::vector<double> ar2Process() {
  std::vector<double> samples(kProcessSamples, 0.0);
  Random random(0xeffe7a5eu);
  samples[0] = 0.3;
  samples[1] = -0.1;
  for (std::uint32_t index = 2u; index < kProcessSamples; ++index) {
    const bool interpolation_region =
        index >= kMissingBegin && index < kMissingBegin + kMissingSamples + 2u;
    const double noise = interpolation_region ? 0.0 : 0.08 * random.bipolar();
    samples[index] = 1.6 * samples[index - 1u] - 0.8 * samples[index - 2u] + noise;
  }
  return samples;
}

std::array<double, 3u> autocorrelation(const std::vector<double> &samples) noexcept {
  std::array<double, 3u> lags{};
  constexpr std::uint32_t first = 128u;
  const double scale = 1.0 / static_cast<double>(samples.size() - first);
  for (std::uint32_t index = first; index < samples.size(); ++index) {
    for (std::uint32_t lag = 0u; lag < lags.size(); ++lag) {
      lags[lag] += samples[index] * samples[index - lag] * scale;
    }
  }
  return lags;
}

std::array<double, 2u> solveKnownProcess(const std::vector<double> &samples) noexcept {
  const std::array<double, 3u> lags = autocorrelation(samples);
  std::array<double, 2u> coefficients{};
  check(effetune::dsp::solveArCoefficients(lags.data(), 2u, coefficients.data()),
        "known AR(2) process solves");
  std::printf("AR(2) measured coefficients %.9f %.9f\n", coefficients[0], coefficients[1]);

  const double diagonal = lags[0] * (1.0 + effetune::dsp::kArWhitening);
  const double determinant = diagonal * diagonal - lags[1] * lags[1];
  const std::array<double, 2u> dense_reference{
      lags[1] * (lags[2] - diagonal) / determinant,
      (lags[1] * lags[1] - diagonal * lags[2]) / determinant,
  };
  check(std::abs(coefficients[0] - dense_reference[0]) <= 1.0e-12,
        "AR(2) first coefficient matches the loaded dense system");
  check(std::abs(coefficients[1] - dense_reference[1]) <= 1.0e-12,
        "AR(2) second coefficient matches the loaded dense system");
  check(std::abs(coefficients[0] + 1.6) < 0.12, "known AR(2) first coefficient is recovered");
  check(std::abs(coefficients[1] - 0.8) < 0.12, "known AR(2) second coefficient is recovered");
  return coefficients;
}

void testKnownProcessAndGapRestoration() {
  const std::vector<double> samples = ar2Process();
  solveKnownProcess(samples);
  constexpr std::array<double, 2u> coefficients{-1.6, 0.8};
  constexpr std::uint32_t context = 64u;
  std::array<double, 2u * context + kMissingSamples> window{};
  const std::uint32_t window_begin = kMissingBegin - context;
  for (std::uint32_t index = 0u; index < window.size(); ++index) {
    window[index] = samples[window_begin + index];
  }
  for (std::uint32_t index = 0u; index < kMissingSamples; ++index) {
    window[context + index] = 0.0;
  }
  std::array<double, kMissingSamples * 4u> scratch{};
  check(effetune::dsp::interpolateArGap(window.data(), context, kMissingSamples, context,
                                        coefficients.data(), 2u, scratch.data()),
        "64-sample AR gap solves");

  double error_power = 0.0;
  double signal_power = 0.0;
  for (std::uint32_t index = 0u; index < kMissingSamples; ++index) {
    const double expected = samples[kMissingBegin + index];
    const double error = window[context + index] - expected;
    error_power += error * error;
    signal_power += expected * expected;
  }
  check(signal_power > 0.0, "gap reference has non-zero energy");
  std::printf("AR gap measured RMS ratio %.9f\n", std::sqrt(error_power / signal_power));
  check(error_power < 1.0e-18 * signal_power,
        "64-sample no-innovation gap is reconstructed from its context");
}

double normalCorrelation(const std::vector<double> &coefficients, std::uint32_t distance) noexcept {
  double value = 0.0;
  const std::uint32_t order = static_cast<std::uint32_t>(coefficients.size());
  for (std::uint32_t index = 0u; index + distance <= order; ++index) {
    const double first = index == 0u ? 1.0 : coefficients[index - 1u];
    const std::uint32_t second_index = index + distance;
    const double second = second_index == 0u ? 1.0 : coefficients[second_index - 1u];
    value += first * second;
  }
  return value;
}

double knownContribution(const std::vector<double> &window, std::uint32_t pre, std::uint32_t gap,
                         const std::vector<double> &coefficients, std::uint32_t unknown) noexcept {
  const std::uint32_t order = static_cast<std::uint32_t>(coefficients.size());
  const std::uint32_t gap_end = pre + gap;
  const std::uint32_t sample_index = pre + unknown;
  double rhs = 0.0;
  for (std::uint32_t residual_offset = 0u; residual_offset <= order; ++residual_offset) {
    const double gradient = residual_offset == 0u ? 1.0 : coefficients[residual_offset - 1u];
    double known_residual = 0.0;
    for (std::uint32_t lag = 0u; lag <= order; ++lag) {
      const std::uint32_t source = sample_index + residual_offset - lag;
      if (source < pre || source >= gap_end) {
        const double coefficient = lag == 0u ? 1.0 : coefficients[lag - 1u];
        known_residual += coefficient * window[source];
      }
    }
    rhs -= gradient * known_residual;
  }
  return rhs;
}

std::vector<double> denseReference(const std::vector<double> &window, std::uint32_t pre,
                                   std::uint32_t gap, const std::vector<double> &coefficients) {
  const std::uint32_t order = static_cast<std::uint32_t>(coefficients.size());
  std::vector<double> matrix(static_cast<std::size_t>(gap) * gap, 0.0);
  std::vector<double> rhs(gap, 0.0);
  for (std::uint32_t row = 0u; row < gap; ++row) {
    rhs[row] = knownContribution(window, pre, gap, coefficients, row);
    for (std::uint32_t column = 0u; column < gap; ++column) {
      const std::uint32_t distance = row > column ? row - column : column - row;
      if (distance <= order) {
        matrix[static_cast<std::size_t>(row) * gap + column] =
            normalCorrelation(coefficients, distance);
      }
    }
  }

  for (std::uint32_t pivot = 0u; pivot < gap; ++pivot) {
    std::uint32_t best = pivot;
    for (std::uint32_t row = pivot + 1u; row < gap; ++row) {
      if (std::abs(matrix[static_cast<std::size_t>(row) * gap + pivot]) >
          std::abs(matrix[static_cast<std::size_t>(best) * gap + pivot])) {
        best = row;
      }
    }
    check(std::abs(matrix[static_cast<std::size_t>(best) * gap + pivot]) > 1.0e-14,
          "dense reference pivot is non-zero");
    if (best != pivot) {
      for (std::uint32_t column = pivot; column < gap; ++column) {
        std::swap(matrix[static_cast<std::size_t>(pivot) * gap + column],
                  matrix[static_cast<std::size_t>(best) * gap + column]);
      }
      std::swap(rhs[pivot], rhs[best]);
    }
    const double diagonal = matrix[static_cast<std::size_t>(pivot) * gap + pivot];
    for (std::uint32_t row = pivot + 1u; row < gap; ++row) {
      const double scale = matrix[static_cast<std::size_t>(row) * gap + pivot] / diagonal;
      for (std::uint32_t column = pivot; column < gap; ++column) {
        matrix[static_cast<std::size_t>(row) * gap + column] -=
            scale * matrix[static_cast<std::size_t>(pivot) * gap + column];
      }
      rhs[row] -= scale * rhs[pivot];
    }
  }
  for (std::uint32_t remaining = gap; remaining != 0u; --remaining) {
    const std::uint32_t row = remaining - 1u;
    for (std::uint32_t column = row + 1u; column < gap; ++column) {
      rhs[row] -= matrix[static_cast<std::size_t>(row) * gap + column] * rhs[column];
    }
    rhs[row] /= matrix[static_cast<std::size_t>(row) * gap + row];
  }
  return rhs;
}

void testBandedAndBoundedSolves() {
  constexpr std::uint32_t order = 4u;
  constexpr std::uint32_t pre = 6u;
  constexpr std::uint32_t gap = 11u;
  constexpr std::uint32_t post = 6u;
  const std::vector<double> coefficients{-0.85, 0.31, -0.12, 0.04};
  std::vector<double> source(pre + gap + post, 0.0);
  for (std::uint32_t index = 0u; index < source.size(); ++index) {
    source[index] = 0.37 * std::sin(0.23 * static_cast<double>(index)) +
                    0.11 * std::cos(0.61 * static_cast<double>(index));
  }
  std::fill(source.begin() + pre, source.begin() + pre + gap, 0.0);
  const std::vector<double> dense = denseReference(source, pre, gap, coefficients);

  std::vector<double> banded = source;
  std::array<double, gap *(order + 2u)> scratch{};
  check(effetune::dsp::interpolateArGap(banded.data(), pre, gap, post, coefficients.data(), order,
                                        scratch.data()),
        "banded reference problem solves");
  double maximum_difference = 0.0;
  for (std::uint32_t index = 0u; index < gap; ++index) {
    maximum_difference = std::max(maximum_difference, std::abs(banded[pre + index] - dense[index]));
  }
  check(maximum_difference <= 1.0e-10, "banded Cholesky matches the independent dense solve");

  std::vector<double> inactive = source;
  std::array<double, gap *(order + 4u)> bounded_scratch{};
  check(effetune::dsp::interpolateArGapBounded(inactive.data(), pre, gap, post, coefficients.data(),
                                               order, -10.0, 10.0, bounded_scratch.data()),
        "inactive bounded problem solves");
  maximum_difference = 0.0;
  for (std::uint32_t index = 0u; index < gap; ++index) {
    maximum_difference =
        std::max(maximum_difference, std::abs(inactive[pre + index] - banded[pre + index]));
  }
  check(maximum_difference <= 1.0e-12, "inactive bounds preserve the unconstrained solution");

  std::vector<double> active = source;
  bounded_scratch.fill(0.0);
  check(effetune::dsp::interpolateArGapBounded(active.data(), pre, gap, post, coefficients.data(),
                                               order, -0.05, 0.05, bounded_scratch.data()),
        "active bounded problem solves");
  for (std::uint32_t index = 0u; index < gap; ++index) {
    check(active[pre + index] >= -0.05 && active[pre + index] <= 0.05,
          "active bounded solution stays inside both bounds");
  }
}

void testFailureContracts() {
  std::array<double, effetune::dsp::kArMaximumOrder + 1u> silent_lags{};
  std::array<double, 4u> coefficients{{1.0, 2.0, 3.0, 4.0}};
  const std::array<double, 4u> original = coefficients;
  check(!effetune::dsp::solveArCoefficients(silent_lags.data(), 4u, coefficients.data()),
        "silent autocorrelation is rejected");
  check(coefficients == original, "failed coefficient solve leaves output unchanged");

  std::array<double, 9u> too_short_window{};
  std::array<double, 4u> interpolation_scratch{};
  check(!effetune::dsp::interpolateArGap(too_short_window.data(), 1u, 1u, 1u, coefficients.data(),
                                         2u, interpolation_scratch.data()),
        "interpolation rejects context shorter than the AR order");
}

} // namespace

int main() {
  testKnownProcessAndGapRestoration();
  testBandedAndBoundedSolves();
  testFailureContracts();
  if (failures != 0) {
    std::fprintf(stderr, "%d AR interpolator native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All AR interpolator native tests passed");
  return 0;
}

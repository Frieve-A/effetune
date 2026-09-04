#ifndef EFFETUNE_DSP_AR_INTERPOLATOR_H
#define EFFETUNE_DSP_AR_INTERPOLATOR_H

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace effetune::dsp {

inline constexpr std::uint32_t kArMaximumOrder = 24u;
inline constexpr double kArWhitening = 1.0e-2;

// Running lag-domain autocorrelation, updated one sample at a time.
class ArAutocorrelation final {
public:
  void prepare(double sample_rate, double time_constant_seconds) noexcept {
    if (std::isfinite(sample_rate) && sample_rate > 0.0 && std::isfinite(time_constant_seconds) &&
        time_constant_seconds > 0.0) {
      alpha_ = 1.0 - std::exp(-1.0 / (sample_rate * time_constant_seconds));
    } else {
      alpha_ = 0.0;
    }
    reset();
  }

  void reset() noexcept {
    lags_.fill(0.0);
    lag_samples_.fill(0.0);
  }

  void update(const float *samples, std::uint32_t count, const float *history,
              std::uint32_t history_count) noexcept {
    if (samples == nullptr || count == 0u || alpha_ <= 0.0) {
      return;
    }

    const std::uint32_t available_history =
        history_count < kArMaximumOrder ? history_count : kArMaximumOrder;
    for (std::uint32_t sample = 0u; sample < count; ++sample) {
      const double current = static_cast<double>(samples[sample]);
      lag_samples_.fill(0.0);
      lag_samples_[0] = current;

      const std::uint32_t samples_available = sample < kArMaximumOrder ? sample : kArMaximumOrder;
      for (std::uint32_t lag = 1u; lag <= samples_available; ++lag) {
        lag_samples_[lag] = static_cast<double>(samples[sample - lag]);
      }

      if (history != nullptr) {
        const std::uint32_t first_history_lag = samples_available + 1u;
        const std::uint32_t last_history_lag = sample + available_history < kArMaximumOrder
                                                   ? sample + available_history
                                                   : kArMaximumOrder;
        for (std::uint32_t lag = first_history_lag; lag <= last_history_lag; ++lag) {
          const std::uint32_t distance = lag - sample;
          lag_samples_[lag] = static_cast<double>(history[history_count - distance]);
        }
      }

      const double alpha = alpha_;
      for (std::uint32_t lag = 0u; lag <= kArMaximumOrder; ++lag) {
        const double estimate = current * lag_samples_[lag];
        lags_[lag] += (estimate - lags_[lag]) * alpha;
      }
    }
  }

  void flushDenormals() noexcept {
    for (double &lag : lags_) {
      const double magnitude = lag < 0.0 ? -lag : lag;
      if (magnitude < 1.0e-20) {
        lag = 0.0;
      }
    }
  }

  [[nodiscard]] const double *lags() const noexcept { return lags_.data(); }

private:
  std::array<double, kArMaximumOrder + 1u> lags_{};
  std::array<double, kArMaximumOrder + 1u> lag_samples_{};
  double alpha_ = 0.0;
};

// Levinson-Durbin on lags[0..order]. The output is unchanged on failure.
inline bool solveArCoefficients(const double *lags, std::uint32_t order,
                                double *coefficients) noexcept {
  if (lags == nullptr || coefficients == nullptr || order == 0u || order > kArMaximumOrder ||
      !std::isfinite(lags[0]) || lags[0] <= 0.0) {
    return false;
  }

  std::array<double, kArMaximumOrder> current{};
  std::array<double, kArMaximumOrder> next{};
  double prediction_error = lags[0] * (1.0 + kArWhitening);
  if (!std::isfinite(prediction_error) || prediction_error <= 0.0) {
    return false;
  }

  for (std::uint32_t iteration = 0u; iteration < order; ++iteration) {
    if (!std::isfinite(lags[iteration + 1u])) {
      return false;
    }
    double numerator = lags[iteration + 1u];
    for (std::uint32_t coefficient = 0u; coefficient < iteration; ++coefficient) {
      numerator += current[coefficient] * lags[iteration - coefficient];
    }
    const double reflection = -numerator / prediction_error;
    const double reflection_magnitude = reflection < 0.0 ? -reflection : reflection;
    if (!std::isfinite(reflection) || reflection_magnitude >= 1.0) {
      return false;
    }

    next = current;
    for (std::uint32_t coefficient = 0u; coefficient < iteration; ++coefficient) {
      next[coefficient] = current[coefficient] + reflection * current[iteration - coefficient - 1u];
    }
    next[iteration] = reflection;
    prediction_error *= 1.0 - reflection * reflection;
    if (!std::isfinite(prediction_error) || prediction_error <= 0.0) {
      return false;
    }
    current = next;
  }

  for (std::uint32_t coefficient = 0u; coefficient < order; ++coefficient) {
    coefficients[coefficient] = current[coefficient];
  }
  return true;
}

namespace ar_interpolator_detail {

inline double arTerm(const double *coefficients, std::uint32_t index) noexcept {
  return index == 0u ? 1.0 : coefficients[index - 1u];
}

inline bool buildCorrelations(const double *coefficients, std::uint32_t order,
                              double *correlations) noexcept {
  for (std::uint32_t distance = 0u; distance <= order; ++distance) {
    double value = 0.0;
    for (std::uint32_t index = 0u; index + distance <= order; ++index) {
      value += arTerm(coefficients, index) * arTerm(coefficients, index + distance);
    }
    if (!std::isfinite(value)) {
      return false;
    }
    correlations[distance] = value;
  }
  return true;
}

inline double knownContribution(const double *window, std::uint32_t pre, std::uint32_t gap,
                                const double *coefficients, std::uint32_t order,
                                std::uint32_t unknown) noexcept {
  const std::uint32_t gap_end = pre + gap;
  const std::uint32_t window_index = pre + unknown;
  double rhs = 0.0;
  for (std::uint32_t residual_offset = 0u; residual_offset <= order; ++residual_offset) {
    const std::uint32_t residual_index = window_index + residual_offset;
    double known_residual = 0.0;
    for (std::uint32_t lag = 0u; lag <= order; ++lag) {
      const std::uint32_t source_index = residual_index - lag;
      if (source_index < pre || source_index >= gap_end) {
        known_residual += arTerm(coefficients, lag) * window[source_index];
      }
    }
    rhs -= arTerm(coefficients, residual_offset) * known_residual;
  }
  return rhs;
}

inline void buildKnownRhs(const double *window, std::uint32_t pre, std::uint32_t gap,
                          const double *coefficients, std::uint32_t order, double *rhs) noexcept {
  for (std::uint32_t unknown = 0u; unknown < gap; ++unknown) {
    rhs[unknown] = 0.0;
  }

  const std::uint32_t residual_count = gap + order;
  for (std::uint32_t residual = 0u; residual < residual_count; ++residual) {
    const std::uint32_t window_index = pre + residual;
    double known_residual = 0.0;
    if (residual >= gap) {
      const std::uint32_t last_post_lag = residual - gap < order ? residual - gap : order;
      for (std::uint32_t lag = 0u; lag <= last_post_lag; ++lag) {
        known_residual += arTerm(coefficients, lag) * window[window_index - lag];
      }
    }
    const std::uint32_t first_pre_lag = residual < order ? residual + 1u : order + 1u;
    for (std::uint32_t lag = first_pre_lag; lag <= order; ++lag) {
      known_residual += arTerm(coefficients, lag) * window[window_index - lag];
    }

    const std::uint32_t first_unknown = residual > order ? residual - order : 0u;
    const std::uint32_t last_unknown = residual < gap ? residual : gap - 1u;
    for (std::uint32_t unknown = first_unknown; unknown <= last_unknown; ++unknown) {
      rhs[unknown] -= arTerm(coefficients, residual - unknown) * known_residual;
    }
  }
}

inline bool factorAndSolve(double *factor, double *rhs, std::uint32_t count,
                           std::uint32_t order) noexcept {
  const std::uint32_t stride = order + 1u;
  for (std::uint32_t row = 0u; row < count; ++row) {
    const std::uint32_t first_column = row > order ? row - order : 0u;
    for (std::uint32_t column = first_column; column <= row; ++column) {
      double value = factor[static_cast<std::size_t>(row) * stride + row - column];
      for (std::uint32_t inner = first_column; inner < column; ++inner) {
        value -= factor[static_cast<std::size_t>(row) * stride + row - inner] *
                 factor[static_cast<std::size_t>(column) * stride + column - inner];
      }
      if (row == column) {
        if (!std::isfinite(value) || value <= 0.0) {
          return false;
        }
        factor[static_cast<std::size_t>(row) * stride] = std::sqrt(value);
      } else {
        const double diagonal = factor[static_cast<std::size_t>(column) * stride];
        value /= diagonal;
        if (!std::isfinite(value)) {
          return false;
        }
        factor[static_cast<std::size_t>(row) * stride + row - column] = value;
      }
    }
  }

  for (std::uint32_t row = 0u; row < count; ++row) {
    const std::uint32_t first_column = row > order ? row - order : 0u;
    double value = rhs[row];
    for (std::uint32_t column = first_column; column < row; ++column) {
      value -= factor[static_cast<std::size_t>(row) * stride + row - column] * rhs[column];
    }
    value /= factor[static_cast<std::size_t>(row) * stride];
    if (!std::isfinite(value)) {
      return false;
    }
    rhs[row] = value;
  }

  for (std::uint32_t remaining = count; remaining != 0u; --remaining) {
    const std::uint32_t row = remaining - 1u;
    const std::uint32_t last_column = row + order < count - 1u ? row + order : count - 1u;
    double value = rhs[row];
    for (std::uint32_t column = row + 1u; column <= last_column; ++column) {
      value -= factor[static_cast<std::size_t>(column) * stride + column - row] * rhs[column];
    }
    value /= factor[static_cast<std::size_t>(row) * stride];
    if (!std::isfinite(value)) {
      return false;
    }
    rhs[row] = value;
  }
  return true;
}

inline void buildFullFactor(double *factor, std::uint32_t gap, std::uint32_t order,
                            const double *correlations) noexcept {
  const std::uint32_t stride = order + 1u;
  for (std::uint32_t row = 0u; row < gap; ++row) {
    for (std::uint32_t distance = 0u; distance <= order; ++distance) {
      factor[static_cast<std::size_t>(row) * stride + distance] =
          distance <= row ? correlations[distance] : 0.0;
    }
  }
}

} // namespace ar_interpolator_detail

// Solves an AR interpolation problem using a lower-banded Cholesky factor.
inline bool interpolateArGap(double *window, std::uint32_t pre, std::uint32_t gap,
                             std::uint32_t post, const double *coefficients, std::uint32_t order,
                             double *scratch) noexcept {
  if (window == nullptr || coefficients == nullptr || scratch == nullptr || gap == 0u ||
      order == 0u || order > kArMaximumOrder || pre < order || post < order) {
    return false;
  }

  std::array<double, kArMaximumOrder + 1u> correlations{};
  if (!ar_interpolator_detail::buildCorrelations(coefficients, order, correlations.data())) {
    return false;
  }

  const std::uint32_t stride = order + 1u;
  double *factor = scratch;
  double *rhs = factor + static_cast<std::size_t>(gap) * stride;
  ar_interpolator_detail::buildFullFactor(factor, gap, order, correlations.data());
  for (std::uint32_t unknown = 0u; unknown < gap; ++unknown) {
    rhs[unknown] =
        ar_interpolator_detail::knownContribution(window, pre, gap, coefficients, order, unknown);
  }
  if (!ar_interpolator_detail::factorAndSolve(factor, rhs, gap, order)) {
    return false;
  }
  for (std::uint32_t unknown = 0u; unknown < gap; ++unknown) {
    window[pre + unknown] = rhs[unknown];
  }
  return true;
}

// Solves once unconstrained, pins bound violations, then solves the reduced system once.
inline bool interpolateArGapBounded(double *window, std::uint32_t pre, std::uint32_t gap,
                                    std::uint32_t post, const double *coefficients,
                                    std::uint32_t order, double lower_bound, double upper_bound,
                                    double *scratch) noexcept {
  if (window == nullptr || coefficients == nullptr || scratch == nullptr || gap == 0u ||
      order == 0u || order > kArMaximumOrder || pre < order || post < order ||
      !std::isfinite(lower_bound) || !std::isfinite(upper_bound) || lower_bound > upper_bound) {
    return false;
  }

  std::array<double, kArMaximumOrder + 1u> correlations{};
  if (!ar_interpolator_detail::buildCorrelations(coefficients, order, correlations.data())) {
    return false;
  }

  const std::uint32_t stride = order + 1u;
  double *factor = scratch;
  double *rhs = factor + static_cast<std::size_t>(gap) * stride;
  double *saved = rhs + gap;
  double *active = saved + gap;
  for (std::uint32_t row = 0u; row < gap; ++row) {
    const std::uint32_t last_distance = row < order ? row : order;
    for (std::uint32_t distance = 0u; distance <= last_distance; ++distance) {
      factor[static_cast<std::size_t>(row) * stride + distance] = correlations[distance];
    }
  }
  ar_interpolator_detail::buildKnownRhs(window, pre, gap, coefficients, order, rhs);
  for (std::uint32_t unknown = 0u; unknown < gap; ++unknown) {
    saved[unknown] = rhs[unknown];
  }
  if (!ar_interpolator_detail::factorAndSolve(factor, rhs, gap, order)) {
    return false;
  }

  std::uint32_t active_count = 0u;
  for (std::uint32_t unknown = 0u; unknown < gap; ++unknown) {
    if (rhs[unknown] < lower_bound) {
      window[pre + unknown] = lower_bound;
      active[unknown] = 1.0;
      ++active_count;
    } else if (rhs[unknown] > upper_bound) {
      window[pre + unknown] = upper_bound;
      active[unknown] = 1.0;
      ++active_count;
    } else {
      window[pre + unknown] = rhs[unknown];
      active[unknown] = 0.0;
    }
  }
  if (active_count == 0u || active_count == gap) {
    return true;
  }

  std::uint32_t free_count = 0u;
  for (std::uint32_t unknown = 0u; unknown < gap; ++unknown) {
    if (active[unknown] == 0.0) {
      rhs[free_count++] = static_cast<double>(unknown);
    }
  }

  for (std::uint32_t row = 0u; row < free_count; ++row) {
    const std::uint32_t original_row = static_cast<std::uint32_t>(rhs[row]);
    const std::uint32_t last_distance = row < order ? row : order;
    for (std::uint32_t distance = 0u; distance <= last_distance; ++distance) {
      double value = 0.0;
      const std::uint32_t original_column = static_cast<std::uint32_t>(rhs[row - distance]);
      const std::uint32_t original_distance = original_row - original_column;
      if (original_distance <= order) {
        value = correlations[original_distance];
      }
      factor[static_cast<std::size_t>(row) * stride + distance] = value;
    }
  }

  for (std::uint32_t row = 0u; row < free_count; ++row) {
    const std::uint32_t original_row = static_cast<std::uint32_t>(rhs[row]);
    double value = saved[original_row];
    const std::uint32_t first = original_row > order ? original_row - order : 0u;
    const std::uint32_t last = original_row + order < gap - 1u ? original_row + order : gap - 1u;
    for (std::uint32_t original_column = first; original_column <= last; ++original_column) {
      if (active[original_column] != 0.0) {
        const std::uint32_t original_distance = original_row > original_column
                                                    ? original_row - original_column
                                                    : original_column - original_row;
        value -= correlations[original_distance] * window[pre + original_column];
      }
    }
    rhs[row] = value;
  }

  if (!ar_interpolator_detail::factorAndSolve(factor, rhs, free_count, order)) {
    return false;
  }
  std::uint32_t free_index = 0u;
  for (std::uint32_t unknown = 0u; unknown < gap; ++unknown) {
    if (active[unknown] != 0.0) {
      continue;
    }
    double value = rhs[free_index++];
    if (value < lower_bound) {
      value = lower_bound;
    } else if (value > upper_bound) {
      value = upper_bound;
    }
    window[pre + unknown] = value;
  }
  return true;
}

} // namespace effetune::dsp

#endif

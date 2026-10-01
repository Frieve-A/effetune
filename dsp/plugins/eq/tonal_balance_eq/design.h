// Tonal Balance EQ: cascade graphic-EQ design (rd-report 2.7).
//
// 31 third-octave command points 20 Hz .. 20480 Hz carry one second-order
// section each: RBJ S = 1 shelves at the two edges, Orfanidis peaking sections
// (bandwidth 2/3 octave, bandwidth gain fraction c = 0.7) in between.  The
// section gains come from the Abel-Berners / Valimaki-Liski interaction-matrix
// least squares at the command points, their geometric midpoints and hold
// points outside the range, with one re-linearisation at the obtained gains.
// Every step is allocation-free and uses the portable transcendental functions
// so the coefficients are bit-identical on the parity surface.
#ifndef EFFETUNE_TONAL_BALANCE_EQ_DESIGN_H
#define EFFETUNE_TONAL_BALANCE_EQ_DESIGN_H

#include "analysis.h"
#include "effetune/dsp/biquad.h"

#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::eq::tonal_balance {

inline constexpr std::uint32_t kSectionCount = 31u;
inline constexpr std::uint32_t kHoldPointsPerSide = 1u;
inline constexpr std::uint32_t kMaximumDesignPoints =
    2u * kSectionCount - 1u + 2u * kHoldPointsPerSide;
inline constexpr double kLowestCommandHz = 20.0;
inline constexpr double kCommandSpacingOctaves = 1.0 / 3.0;
inline constexpr double kSectionBandwidthOctaves = 2.0 / 3.0;
inline constexpr double kBandwidthGainFraction = 0.7;
inline constexpr double kPrototypeGainDb = 6.0;
inline constexpr double kShelfUpperRatio = 0.45;   // high shelf corner <= 0.45 fs
inline constexpr double kDesignUpperRatio = 0.495; // design points < Nyquist
inline constexpr double kIdentityGainDb = 1e-9;    // |g| below: identity section
inline constexpr double kLineariseGainDb = 1e-6;   // |g| below: prototype column

// cos / sin of omega and 2 omega at one evaluation frequency.
struct TrigPoint final {
  double cos1 = 1.0;
  double sin1 = 0.0;
  double cos2 = 1.0;
  double sin2 = 0.0;
};

[[nodiscard]] inline TrigPoint trigAt(double omega) noexcept {
  return {portableCos(omega), portableSin(omega), portableCos(2.0 * omega),
          portableSin(2.0 * omega)};
}

// |H(e^jw)|^2 of one section.
[[nodiscard]] inline double responsePower(const dsp::BiquadCoefficients &c,
                                          const TrigPoint &t) noexcept {
  const double num_re = c.b0 + c.b1 * t.cos1 + c.b2 * t.cos2;
  const double num_im = -(c.b1 * t.sin1 + c.b2 * t.sin2);
  const double den_re = 1.0 + c.a1 * t.cos1 + c.a2 * t.cos2;
  const double den_im = -(c.a1 * t.sin1 + c.a2 * t.sin2);
  return (num_re * num_re + num_im * num_im) / (den_re * den_re + den_im * den_im);
}

// Command curve: values at the 41 band centres, linear in log2 f between them,
// held outside.
struct CorrectionCurve final {
  std::array<double, kBandCount> value_db{};
};

// Precomputed lookup of a CorrectionCurve at a fixed frequency.
struct CurveSample final {
  std::uint32_t index = 0u; // <= kBandCount - 2
  double fraction = 0.0;    // 0..1 towards index + 1
};

[[nodiscard]] inline CurveSample
curveSampleAt(double log2_frequency, const std::array<double, kBandCount> &log2_band) noexcept {
  CurveSample sample;
  if (log2_frequency <= log2_band[0]) {
    return sample;
  }
  if (log2_frequency >= log2_band[kBandCount - 1u]) {
    sample.index = kBandCount - 2u;
    sample.fraction = 1.0;
    return sample;
  }
  std::uint32_t index = 0u;
  while (index + 2u < kBandCount && log2_band[index + 1u] <= log2_frequency) {
    ++index;
  }
  sample.index = index;
  sample.fraction =
      (log2_frequency - log2_band[index]) / (log2_band[index + 1u] - log2_band[index]);
  return sample;
}

[[nodiscard]] inline double sampleCurve(const CorrectionCurve &curve,
                                        const CurveSample &sample) noexcept {
  const double a = curve.value_db[sample.index];
  const double b = curve.value_db[sample.index + 1u];
  return a + sample.fraction * (b - a);
}

// Fixed per-section geometry (sample-rate dependent, computed once).
struct SectionGeometry final {
  double omega0 = 0.0;
  double delta_omega = 0.0;
  double cos_omega0 = 1.0;
  double sin_omega0 = 0.0;
  double tan_half_delta = 0.0;
  bool low_shelf = false;
  bool high_shelf = false;
};

// RBJ shelf, slope S = 1.
[[nodiscard]] inline dsp::BiquadCoefficients designShelf(const SectionGeometry &s, double gain_db,
                                                         bool low) noexcept {
  const double a = portableDecadePower(gain_db / 40.0);
  const double sqrt_a = std::sqrt(a);
  // RBJ: alpha = sin(w0)/2 * sqrt((A + 1/A)(1/S - 1) + 2) with S = 1.
  const double alpha = s.sin_omega0 * 0.5 * std::sqrt(2.0);
  const double ap1 = a + 1.0;
  const double am1 = a - 1.0;
  const double sa = 2.0 * sqrt_a * alpha;
  const double c = s.cos_omega0;
  double b0 = 0.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a0 = 1.0;
  double a1 = 0.0;
  double a2 = 0.0;
  if (low) {
    b0 = a * (ap1 - am1 * c + sa);
    b1 = 2.0 * a * (am1 - ap1 * c);
    b2 = a * (ap1 - am1 * c - sa);
    a0 = ap1 + am1 * c + sa;
    a1 = -2.0 * (am1 + ap1 * c);
    a2 = ap1 + am1 * c - sa;
  } else {
    b0 = a * (ap1 + am1 * c + sa);
    b1 = -2.0 * a * (am1 + ap1 * c);
    b2 = a * (ap1 + am1 * c - sa);
    a0 = ap1 - am1 * c + sa;
    a1 = 2.0 * (am1 - ap1 * c);
    a2 = ap1 - am1 * c - sa;
  }
  const double inverse = 1.0 / a0;
  return {b0 * inverse, b1 * inverse, b2 * inverse, a1 * inverse, a2 * inverse};
}

// Orfanidis peaking section: gain G at omega0, gain G^c at the bandwidth edges.
[[nodiscard]] inline dsp::BiquadCoefficients designPeaking(const SectionGeometry &s,
                                                           double gain_db) noexcept {
  const double g = portableDecadePower(gain_db / 20.0);
  const double gb = portableDecadePower(kBandwidthGainFraction * gain_db / 20.0);
  const double numerator = gb * gb - 1.0;
  const double denominator = g * g - gb * gb;
  const double ratio =
      (numerator < 0.0 ? -numerator : numerator) / (denominator < 0.0 ? -denominator : denominator);
  const double beta = std::sqrt(ratio) * s.tan_half_delta;
  const double inverse = 1.0 / (1.0 + beta);
  const double b1 = -2.0 * s.cos_omega0 * inverse;
  return {(1.0 + g * beta) * inverse, b1, (1.0 - g * beta) * inverse, b1, (1.0 - beta) * inverse};
}

// Least-squares cascade design for one sample rate.  The per-hop work is
// split into small steps so the kernel can schedule it evenly.
class CascadeDesigner final {
public:
  [[nodiscard]] bool prepare(double sample_rate) noexcept {
    sample_rate_ = sample_rate;
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      log2_band_[b] = portableLog2(bandCentreHz(b));
    }

    // Active sections: command points below 0.45 fs plus the high shelf.
    const double shelf_limit = kShelfUpperRatio * sample_rate;
    std::uint32_t below = 0u;
    for (std::uint32_t m = 0; m < kSectionCount; ++m) {
      if (commandFrequencyHz(m) < shelf_limit) {
        below = m + 1u;
      }
    }
    active_count_ = below + 1u > kSectionCount ? kSectionCount : below + 1u;
    if (active_count_ < 3u) {
      return false;
    }
    const double two_pi_over_fs = 2.0 * kPi / sample_rate;
    const double bandwidth_span =
        portableDecadePower(kSectionBandwidthOctaves * 0.5 * 0.30102999566398120) -
        portableDecadePower(-kSectionBandwidthOctaves * 0.5 * 0.30102999566398120);
    for (std::uint32_t m = 0; m < active_count_; ++m) {
      SectionGeometry &s = sections_[m];
      s.low_shelf = m == 0u;
      s.high_shelf = m == active_count_ - 1u;
      double frequency = commandFrequencyHz(m);
      if (s.high_shelf && frequency > shelf_limit) {
        frequency = shelf_limit;
      }
      s.omega0 = two_pi_over_fs * frequency;
      s.delta_omega = two_pi_over_fs * frequency * bandwidth_span;
      s.cos_omega0 = portableCos(s.omega0);
      s.sin_omega0 = portableSin(s.omega0);
      s.tan_half_delta = portableTan(0.5 * s.delta_omega);
    }

    // Design points: commands and midpoints (ascending), then hold points.
    const double upper = kDesignUpperRatio * sample_rate;
    point_count_ = 0u;
    const double top = commandFrequencyHz(active_count_ - 1u);
    for (std::uint32_t m = 0; m < active_count_; ++m) {
      addDesignPoint(commandFrequencyHz(m), upper, top);
      if (m + 1u < active_count_) {
        addDesignPoint(commandFrequencyHz(m) *
                           portableDecadePower(kCommandSpacingOctaves * 0.5 * 0.30102999566398120),
                       upper, top);
      }
    }
    for (std::uint32_t k = 1; k <= kHoldPointsPerSide; ++k) {
      const double ratio = portableDecadePower(static_cast<double>(k) * kCommandSpacingOctaves *
                                               0.30102999566398120);
      addDesignPoint(kLowestCommandHz / ratio, upper, top);
      addDesignPoint(top * ratio, upper, top);
    }
    for (std::uint32_t i = 0; i < kGridCount; ++i) {
      grid_trig_[i] = trigAt(two_pi_over_fs * gridFrequencyHz(i));
    }

    // Prototype interaction matrix and its normal-equation factor.
    for (std::uint32_t m = 0; m < active_count_; ++m) {
      const dsp::BiquadCoefficients prototype = section(m, kPrototypeGainDb);
      for (std::uint32_t p = 0; p < point_count_; ++p) {
        prototype_[p][m] =
            portablePowerDb(tonal_balance::responsePower(prototype, point_trig_[p])) /
            kPrototypeGainDb;
      }
    }
    for (std::uint32_t i = 0; i < active_count_; ++i) {
      for (std::uint32_t j = 0; j <= i; ++j) {
        double sum = 0.0;
        for (std::uint32_t p = 0; p < point_count_; ++p) {
          sum += prototype_[p][i] * prototype_[p][j];
        }
        prototype_factor_[i][j] = sum;
      }
    }
    if (!choleskyFactor(prototype_factor_)) {
      return false;
    }
    return true;
  }

  // Stage 1: targets at the design points (frequency clipped to the command
  // range, then held outside the band centres).
  void setTargets(const CorrectionCurve &curve) noexcept {
    for (std::uint32_t p = 0; p < point_count_; ++p) {
      targets_[p] = sampleCurve(curve, point_sample_[p]);
    }
  }

  // Stage 2: g = (B0' B0)^-1 B0' t.
  void firstPass() noexcept {
    for (std::uint32_t m = 0; m < active_count_; ++m) {
      double sum = 0.0;
      for (std::uint32_t p = 0; p < point_count_; ++p) {
        sum += prototype_[p][m] * targets_[p];
      }
      gains_[m] = sum;
    }
    choleskySolve(prototype_factor_, gains_);
  }

  // Stage 3: interaction matrix columns [begin, end) at the current gains.
  void linearise(std::uint32_t begin, std::uint32_t end) noexcept {
    end = end > active_count_ ? active_count_ : end;
    for (std::uint32_t m = begin; m < end; ++m) {
      const double g = gains_[m];
      const double magnitude = g < 0.0 ? -g : g;
      if (magnitude < kLineariseGainDb) {
        for (std::uint32_t p = 0; p < point_count_; ++p) {
          interaction_[p][m] = prototype_[p][m];
        }
        continue;
      }
      const dsp::BiquadCoefficients coefficients = section(m, g);
      const double inverse = 1.0 / g;
      for (std::uint32_t p = 0; p < point_count_; ++p) {
        interaction_[p][m] =
            portablePowerDb(tonal_balance::responsePower(coefficients, point_trig_[p])) * inverse;
      }
    }
  }

  // Stage 4: rows [begin, end) of the lower triangle of B' B and of B' t.
  void normal(std::uint32_t begin, std::uint32_t end) noexcept {
    end = end > active_count_ ? active_count_ : end;
    for (std::uint32_t i = begin; i < end; ++i) {
      for (std::uint32_t j = 0; j <= i; ++j) {
        double sum = 0.0;
        for (std::uint32_t p = 0; p < point_count_; ++p) {
          sum += interaction_[p][i] * interaction_[p][j];
        }
        factor_[i][j] = sum;
      }
      double sum = 0.0;
      for (std::uint32_t p = 0; p < point_count_; ++p) {
        sum += interaction_[p][i] * targets_[p];
      }
      right_[i] = sum;
    }
  }

  // Stage 5: solve; keeps the first-pass gains when the factorisation fails.
  void solve() noexcept {
    if (!choleskyFactor(factor_)) {
      return;
    }
    choleskySolve(factor_, right_);
    for (std::uint32_t m = 0; m < active_count_; ++m) {
      gains_[m] = right_[m];
    }
  }

  // Stage 6: final coefficients from the gains.
  void designSections() noexcept {
    for (std::uint32_t m = 0; m < kSectionCount; ++m) {
      coefficients_[m] = m < active_count_ ? section(m, gains_[m]) : dsp::BiquadCoefficients{};
    }
    response_power_.fill(1.0);
  }

  // Stage 7: multiply sections [begin, end) into the grid response power.
  void accumulateResponse(std::uint32_t begin, std::uint32_t end) noexcept {
    end = end > active_count_ ? active_count_ : end;
    for (std::uint32_t m = begin; m < end; ++m) {
      const dsp::BiquadCoefficients &c = coefficients_[m];
      for (std::uint32_t i = 0; i < kGridCount; ++i) {
        response_power_[i] *= tonal_balance::responsePower(c, grid_trig_[i]);
      }
    }
  }

  // Stage 8: grid response in dB.
  void finishResponse() noexcept {
    for (std::uint32_t i = 0; i < kGridCount; ++i) {
      response_db_[i] = portablePowerDb(response_power_[i]);
    }
  }

  // Section m at gain_db (identity below kIdentityGainDb).
  [[nodiscard]] dsp::BiquadCoefficients section(std::uint32_t m, double gain_db) const noexcept {
    const SectionGeometry &s = sections_[m];
    const double magnitude = gain_db < 0.0 ? -gain_db : gain_db;
    if (magnitude < kIdentityGainDb) {
      return dsp::BiquadCoefficients{};
    }
    if (s.low_shelf) {
      return designShelf(s, gain_db, true);
    }
    if (s.high_shelf) {
      return designShelf(s, gain_db, false);
    }
    return designPeaking(s, gain_db);
  }

  [[nodiscard]] static double commandFrequencyHz(std::uint32_t m) noexcept {
    return kLowestCommandHz * portableDecadePower(static_cast<double>(m) * kCommandSpacingOctaves *
                                                  0.30102999566398120);
  }

  [[nodiscard]] std::uint32_t activeSectionCount() const noexcept { return active_count_; }
  [[nodiscard]] const std::array<double, kBandCount> &log2BandCentres() const noexcept {
    return log2_band_;
  }
  [[nodiscard]] const std::array<dsp::BiquadCoefficients, kSectionCount> &
  coefficients() const noexcept {
    return coefficients_;
  }
  [[nodiscard]] const std::array<double, kGridCount> &responsePower() const noexcept {
    return response_power_;
  }
  [[nodiscard]] const std::array<double, kGridCount> &responseDb() const noexcept {
    return response_db_;
  }

private:
  using Matrix = std::array<std::array<double, kSectionCount>, kSectionCount>;

  void addDesignPoint(double frequency, double upper, double top) noexcept {
    frequency = frequency > upper ? upper : frequency;
    for (std::uint32_t p = 0; p < point_count_; ++p) {
      if (point_hz_[p] == frequency) {
        return;
      }
    }
    const double held =
        frequency < kLowestCommandHz ? kLowestCommandHz : (frequency > top ? top : frequency);
    point_hz_[point_count_] = frequency;
    point_trig_[point_count_] = trigAt(2.0 * kPi * frequency / sample_rate_);
    point_sample_[point_count_] = curveSampleAt(portableLog2(held), log2_band_);
    ++point_count_;
  }

  // In-place Cholesky of the lower triangle (active_count_ rows).
  [[nodiscard]] bool choleskyFactor(Matrix &a) const noexcept {
    for (std::uint32_t i = 0; i < active_count_; ++i) {
      for (std::uint32_t j = 0; j <= i; ++j) {
        double sum = a[i][j];
        for (std::uint32_t k = 0; k < j; ++k) {
          sum -= a[i][k] * a[j][k];
        }
        if (i == j) {
          if (!(sum > 0.0)) {
            return false;
          }
          a[i][i] = std::sqrt(sum);
        } else {
          a[i][j] = sum / a[j][j];
        }
      }
    }
    return true;
  }

  // Solves L L' x = b in place.
  void choleskySolve(const Matrix &l, std::array<double, kSectionCount> &x) const noexcept {
    for (std::uint32_t i = 0; i < active_count_; ++i) {
      double sum = x[i];
      for (std::uint32_t k = 0; k < i; ++k) {
        sum -= l[i][k] * x[k];
      }
      x[i] = sum / l[i][i];
    }
    for (std::uint32_t n = active_count_; n > 0u; --n) {
      const std::uint32_t i = n - 1u;
      double sum = x[i];
      for (std::uint32_t k = i + 1u; k < active_count_; ++k) {
        sum -= l[k][i] * x[k];
      }
      x[i] = sum / l[i][i];
    }
  }

  double sample_rate_ = 0.0;
  std::uint32_t active_count_ = 0u;
  std::uint32_t point_count_ = 0u;
  std::array<double, kBandCount> log2_band_{};
  std::array<SectionGeometry, kSectionCount> sections_{};
  std::array<double, kMaximumDesignPoints> point_hz_{};
  std::array<TrigPoint, kMaximumDesignPoints> point_trig_{};
  std::array<CurveSample, kMaximumDesignPoints> point_sample_{};
  std::array<TrigPoint, kGridCount> grid_trig_{};
  std::array<std::array<double, kSectionCount>, kMaximumDesignPoints> prototype_{};
  std::array<std::array<double, kSectionCount>, kMaximumDesignPoints> interaction_{};
  Matrix prototype_factor_{};
  Matrix factor_{};
  std::array<double, kMaximumDesignPoints> targets_{};
  std::array<double, kSectionCount> right_{};
  std::array<double, kSectionCount> gains_{};
  std::array<dsp::BiquadCoefficients, kSectionCount> coefficients_{};
  std::array<double, kGridCount> response_power_{};
  std::array<double, kGridCount> response_db_{};
};

} // namespace effetune::plugins::eq::tonal_balance

#endif // EFFETUNE_TONAL_BALANCE_EQ_DESIGN_H

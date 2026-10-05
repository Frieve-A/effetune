// The TD tempo prior's model (rd5 kn, export_tables): the oblivious trees over the used-feature row
// with binary16 leaves summed in float64 tree by tree, the softmax over the trained classes, the
// temperature/floor calibration, and the prior row on the decoder's log2-tempo grid (np.interp of
// ln(P / class step) over the class centres, softmax, rounded to binary16 as the decoder reads it).
// Sums follow numpy's pairwise order and logs/exps are the portable ones, so the values match the
// numpy reference bit for bit. Real-time safe: fixed-size members only, no allocation; the work
// (kTrees x 4 compares, kTrees x kTreeDims adds) runs once per row (1 Hz).
#pragma once
#include <cstdint>

#include "portable_math.h"
#include "rhythm_d.h"
#include "tc_tcn.h"
#include "tc_v0.h"
#include "tdp_tables.generated.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class TdpTrees {
public:
  static constexpr std::uint32_t kClasses = tdp_tables::kClasses, kGrid = tdp_tables::kGrid;

  // row: the tdp_tables::kUsedCols used features (NaN compares false).
  void evaluate(const float *row) noexcept {
    namespace T = tdp_tables;
    using rhythm_d::portableExp;
    using rhythm_d::portableLog;
    using tc_detail::npSum;
    double raw[T::kTreeDims] = {};
    for (std::uint32_t t = 0u; t < T::kTrees; ++t) {
      std::uint32_t leaf = 0u;
      for (std::uint32_t i = 0u; i < 4u; ++i)
        leaf |= (row[T::kTreeFeat[t][i]] > T::kTreeBorder[t][i] ? 1u : 0u) << i;
      const std::uint16_t *v = T::kTreeLeaf + (t * 16u + leaf) * T::kTreeDims;
      for (std::uint32_t d = 0u; d < T::kTreeDims; ++d)
        raw[d] += static_cast<double>(tcHalfToFloat(v[d]));
    }
    // Softmax over the trained dimensions; the other classes have probability 0.
    double e[T::kTreeDims], m = raw[0];
    for (std::uint32_t d = 1u; d < T::kTreeDims; ++d)
      m = raw[d] > m ? raw[d] : m;
    for (std::uint32_t d = 0u; d < T::kTreeDims; ++d)
      e[d] = portableExp(raw[d] - m);
    const double s = npSum(e, T::kTreeDims);
    for (double &p : p_)
      p = 0.0;
    for (std::uint32_t d = 0u; d < T::kTreeDims; ++d)
      p_[T::kTreeClass[d]] = e[d] / s;
    // Calibration: (1 - lam) softmax(ln max(p, 1e-12) / T) + lam / kClasses.
    double q[kClasses];
    for (std::uint32_t c = 0u; c < kClasses; ++c) {
      q[c] = portableLog(floored(p_[c])) / T::kCalT;
      m = c == 0u || q[c] > m ? q[c] : m;
    }
    for (double &v : q)
      v = portableExp(v - m);
    const double qs = npSum(q, kClasses), keep = 1.0 - T::kCalLam,
                 lift = T::kCalLam / static_cast<double>(kClasses);
    for (std::uint32_t c = 0u; c < kClasses; ++c)
      p_[c] = keep * q[c] / qs + lift;
    // The grid row: np.interp of ln(P / step) between the class centres, then its softmax.
    double lp[kClasses], g[kGrid];
    for (std::uint32_t c = 0u; c < kClasses; ++c)
      lp[c] = portableLog(floored(p_[c]) / T::kClassStep);
    for (std::uint32_t i = 0u; i < kGrid; ++i) {
      const int j = T::kGridLo[i];
      if (j < 0)
        g[i] = lp[0];
      else if (j >= static_cast<int>(kClasses) - 1)
        g[i] = lp[kClasses - 1u];
      else
        g[i] = (lp[j + 1] - lp[j]) / T::kCentreStep[j] * T::kGridDx[i] + lp[j];
      m = i == 0u || g[i] > m ? g[i] : m;
    }
    for (double &v : g)
      v = portableExp(v - m);
    const double gs = npSum(g, kGrid);
    for (std::uint32_t i = 0u; i < kGrid; ++i)
      grid_[i] = static_cast<float>(rhythm_d::roundHalf(g[i] / gs));
  }

  void reset() noexcept {
    for (double &p : p_)
      p = 0.0;
    for (float &g : grid_)
      g = 0.0f;
  }

  // The calibrated class probabilities; grid(): the prior row (binary16 values) on kGrid points.
  const double *p() const noexcept { return p_; }
  const float *grid() const noexcept { return grid_; }

private:
  static double floored(double p) noexcept { return p > 1e-12 ? p : 1e-12; }

  double p_[kClasses] = {};
  float grid_[kGrid] = {};
};

} // namespace effetune::plugins::analyzer::rhythm_a3

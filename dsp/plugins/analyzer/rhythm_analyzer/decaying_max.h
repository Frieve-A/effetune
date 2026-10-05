// The 20 s decaying maximum of fx (rd5 base_features) in its log-domain form: at tick n (counted
// from the owner's reset or restart), max_{i <= n} (lx_i + i ld) - n ld, with lx = log x and
// ld = (1 / 93.75) / 20 (one tick over tau = 20 s). Shared by the TD prior's activity gate and
// the relative quiet rule (RelativeQuiet) so that both use one definition. Real-time safe.
#pragma once
#include <cstdint>

namespace effetune::plugins::analyzer::rhythm_a3 {

class DecayingLogMax {
public:
  static constexpr double kLogDecay = (1.0 / 93.75) / 20.0;

  void reset() noexcept { logMax_ = 0.0; }

  // Pushes lx = log x at tick n and returns the log of the decayed maximum (n == 0 starts afresh).
  double update(double lx, std::int64_t n) noexcept {
    const double shift = static_cast<double>(n) * kLogDecay;
    const double v = lx + shift;
    logMax_ = n == 0 || v > logMax_ ? v : logMax_;
    return logMax_ - shift;
  }

private:
  double logMax_ = 0.0;
};

// The relative quiet rule shared by every silence gate: a tick is quiet when its level (dB) is
// below max(20 s decaying max of the level - 50 dB, -120 dBFS). The max is taken in the log domain
// of the mean square, as the TD prior gate does.
class RelativeQuiet {
public:
  static constexpr double kRelDb = 50.0, kFloorDb = -120.0;

  void reset() noexcept {
    n_ = 0;
    thr_ = kFloorDb;
  }

  // Pushes the level of the next tick and returns whether that tick is quiet.
  bool push(double db) noexcept {
    const double thr = max_.update(db * kDbToLog, n_++) / kDbToLog - kRelDb;
    thr_ = thr < kFloorDb ? kFloorDb : thr;
    return db < thr_;
  }

  // Threshold (dB) of the last pushed tick (kFloorDb before the first).
  double thresholdDb() const noexcept { return thr_; }

private:
  static constexpr double kDbToLog = 0.23025850929940458; // ln(10) / 10
  DecayingLogMax max_;
  std::int64_t n_ = 0;
  double thr_ = kFloorDb;
};

} // namespace effetune::plugins::analyzer::rhythm_a3

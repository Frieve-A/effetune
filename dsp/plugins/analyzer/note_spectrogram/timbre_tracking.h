#pragma once

namespace effetune::plugins::analyzer {
// Event-first classification intervals; public SFZ age1 is consumed independently.
class TimbreTracking final {
public:
  struct Decision {
    bool start = false, end = false;
  };
  void reset() noexcept { *this = {}; }
  bool active() const noexcept { return active_; }
  Decision step(float probability, float onset, bool prime) noexcept {
    const auto peak = previous_ >= before_previous_ && previous_ > onset;
    // Keep the double threshold used by the frozen decoder at its float32 boundary.
    const auto attack = peak && previous_ >= .8 && previous_ - valley_ >= .3;
    const auto present = !active_ && !blocked_ && probability >= .5F;
    Decision result;
    if (prime) {
      // An already sounding note stays unclassified until release or a fresh onset.
      blocked_ = probability >= .5F;
    } else if (attack || present) {
      // An attack wins a simultaneous release and keeps this frame active.
      result.start = true;
      active_ = true;
      blocked_ = false;
    } else if (probability < .4) {
      result.end = active_;
      active_ = blocked_ = false;
    }
    if (peak || onset < valley_)
      valley_ = onset;
    before_previous_ = previous_;
    previous_ = onset;
    return result;
  }

private:
  float before_previous_ = 0.0F, previous_ = 0.0F, valley_ = 1.0F;
  bool active_ = false, blocked_ = false;
};
} // namespace effetune::plugins::analyzer

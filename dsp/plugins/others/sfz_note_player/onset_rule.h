#ifndef EFFETUNE_SFZ_ONSET_RULE_H
#define EFFETUNE_SFZ_ONSET_RULE_H
#include <cstdint>
namespace effetune::plugins::others::sfz {
// Per-frame rule settings. Pitches above the onset range pass onset 0 and refractory 0, which
// leaves the plain latch rule.
struct OnsetRuleSettings {
  float threshold, off, onset, prominence, gate;
  std::uint32_t refractory;
};
enum class OnsetFire : std::uint8_t { None, Onset, Fallback };
struct OnsetDecision {
  OnsetFire fire = OnsetFire::None;
  bool released = false;
  // Peak position within [-0.5, 0.5] frames of the analysed frame for onset fires, else 0.
  double delta = 0.0;
};
// One pitch of onset-head peak picking, with the pitch latch as the fallback trigger.
class OnsetRule {
public:
  void reset() noexcept { *this = OnsetRule{}; }
  bool latched() const noexcept { return latched_; }
  // The latch started with a fire.
  bool active() const noexcept { return active_; }
  std::uint32_t cooldown() const noexcept { return cool_; }
  OnsetDecision step(float probability, float onset, const OnsetRuleSettings &s) noexcept {
    OnsetDecision result;
    if (cool_)
      --cool_;
    if (latched_ && probability < s.off) {
      latched_ = active_ = false;
      result.released = true;
    }
    // The previous frame is a local peak of the onset probability.
    const auto a = o2_, b = o1_, c = onset;
    const auto peak = b >= a && b > c;
    if (peak && b >= s.onset && b - valley_ >= s.prominence && probability >= s.gate && !cool_) {
      result.fire = OnsetFire::Onset;
      // The triangle fit is exact for the triangular training target.
      const auto rising = c > a;
      const auto num = rising ? static_cast<double>(c - a) : -static_cast<double>(a - c);
      const auto den = 2.0 * static_cast<double>(rising ? b - a : b - c);
      const auto delta = den > 1e-9 ? num / den : 0.0;
      result.delta = delta < -.5 ? -.5 : delta > .5 ? .5 : delta;
    } else if (!latched_ && probability >= s.threshold && c < s.onset && !cool_) {
      // A new latch yields while an onset peak is pending.
      result.fire = OnsetFire::Fallback;
    }
    if (peak || c < valley_)
      valley_ = c;
    if (result.fire != OnsetFire::None) {
      cool_ = s.refractory;
      latched_ = active_ = true;
    } else if (probability >= s.threshold)
      latched_ = true;
    o2_ = o1_;
    o1_ = c;
    return result;
  }

private:
  // With a positive prominence, zero history and a valley of 1 cannot fire in the first two
  // frames and leave the valley at their minimum, as a scan that starts at the first frame.
  float o1_ = 0.0F, o2_ = 0.0F, valley_ = 1.0F;
  std::uint32_t cool_ = 0u;
  bool latched_ = false, active_ = false;
};
} // namespace effetune::plugins::others::sfz
#endif

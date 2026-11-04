#ifndef EFFETUNE_SFZ_EFFECT_CONTROLS_H
#define EFFETUNE_SFZ_EFFECT_CONTROLS_H
#include "sfz_effect_plan.h"
#include "sfz_modulation.h"

namespace effetune::plugins::others::sfz {
class EffectControls {
public:
  bool prepare(const EffectPlan &plan, unsigned nodeIndex) noexcept {
    node_ = plan.node(nodeIndex);
    routes_ = plan.routes(node_);
    if (!base_.allocate(node_[3]) || !resolved_.allocate(node_[3]) || !ramps_.allocate(node_[5]))
      return false;
    for (auto index = 0u; index < node_[3]; ++index)
      base_.data()[index] = plan.parameter(node_, index);
    reset();
    return true;
  }
  void reset() noexcept {
    for (auto index = 0u; index < ramps_.size(); ++index)
      ramps_.data()[index] = {};
  }
  // Source values are borrowed instrument-global latest-accepted facts. The
  // owner maintains event chronology across MIDI channels, including pure state
  // hydration. This resolver never guesses a channel or advances another clock.
  std::span<const float> resolve(const modulation::SourceFrame &source,
                                 std::span<const modulation::Curve> curves, double rate) noexcept {
    std::copy_n(base_.data(), base_.size(), resolved_.data());
    modulation::RegionView curveView{};
    curveView.curves = curves;
    for (auto index = 0u; index < ramps_.size(); ++index) {
      const auto route = routes_.subspan(index * fxschema::kRouteWords, fxschema::kRouteWords);
      const float input = route[1] < source.values.size() ? source.values[route[1]] : 0;
      const auto shaped = modulation::curveValue(curveView, route[3], input, false);
      float amount = modulation::finiteModulationValue(static_cast<double>(shaped) *
                                                       EffectPlan::value(route[2]));
      const auto step = EffectPlan::value(route[5]);
      if (step > 0)
        amount = modulation::finiteModulationValue(std::round(static_cast<double>(amount) / step) *
                                                   step);
      amount =
          modulation::tickRamp(ramps_.data()[index], amount, EffectPlan::value(route[4]), 1 / rate);
      resolved_.data()[route[0]] = modulation::finiteModulationValue(
          static_cast<double>(resolved_.data()[route[0]]) + amount);
    }
    const auto &type = fxschema::kTypes[node_[0] - 1];
    for (auto index = 0u; index < resolved_.size(); ++index) {
      const auto &spec = fxschema::kParameters[type.firstParameter + index];
      auto &value = resolved_.data()[index];
      value = value < spec.minimum ? spec.minimum : value > spec.maximum ? spec.maximum : value;
      if (spec.integer)
        value = std::round(value);
    }
    return {resolved_.data(), resolved_.size()};
  }
  bool bypassed(const modulation::SourceFrame &source) const noexcept {
    const auto controller = node_[7];
    return controller && controller - 1 < source.values.size() &&
           source.values[controller - 1] >= .5F;
  }

private:
  std::span<const std::uint32_t> node_, routes_;
  NothrowStorage<float> base_, resolved_;
  NothrowStorage<modulation::RampState> ramps_;
};
} // namespace effetune::plugins::others::sfz
#endif

#ifndef EFFETUNE_SFZ_MODULATION_H
#define EFFETUNE_SFZ_MODULATION_H
#include "SFZModulationSchema.h"
#include "sfz_envelopes.h"
#include "sfz_lfo.h"
#include <array>
#include <span>

namespace effetune::plugins::others::sfz::modulation {
using Kind = schema::Kind;
using Property = schema::Property;
struct Route {
  std::uint32_t target = 0, sourceA = 0, sourceB = 0;
  float depth = 0;
  std::uint32_t curveA = 0, curveB = 0;
  float smoothMs = 0, step = 0;
  std::uint32_t flags = 0, transform = 0;
};
struct Instance {
  std::uint32_t kind = 0, authoredIndex = 0, parent = UINT32_MAX;
  std::uint32_t firstParameter = 0, parameterCount = 0, flags = 0;
};
struct Parameter {
  std::uint32_t instance = 0, property = 0;
  float base = 0;
  std::uint32_t combine = 0;
};
struct Curve {
  std::uint32_t id = 0;
  std::array<float, 128> values{};
};
struct VariableInputs {
  std::uint32_t firstRoute = 0, count = 0;
  bool continuous = false;
};
static_assert(sizeof(VariableInputs) <= sizeof(FixedEnvelopeParameters));
struct PreparedGenerator {
  union Parameters {
    FixedEnvelopeParameters fixed;
    LfoParameters lfo;
    VariableInputs variable;
    constexpr Parameters() noexcept : fixed{} {}
  } parameters;
  bool constant = false;
  bool hasSuboscillators = false;
  mutable ScalarMathCache math{};
};
struct RegionView {
  std::span<const Instance> instances;
  std::span<const Parameter> parameters;
  std::span<const Route> routes;
  std::span<const Curve> curves;
  std::span<const std::uint32_t> stateIndices;
  std::span<const schema::PropertySpec *const> parameterSpecs;
  std::span<const std::uint32_t> dynamicParameters{};
  std::span<const PreparedGenerator> preparedGenerators{};
  bool hasGeneratorRoutes = true;
  std::uint8_t variableFlags = 0; // Bit0: variables; bit1: independently changing virtual CCs.
};
struct Layout {
  std::uint32_t envelopes = 0, lfos = 0, ramps = 0, parameters = 0, sources = 0;
};
struct BornFacts {
  float key = 0, velocity = 0, noteOffVelocity = 0, random = 0;
  bool gate = true;
  std::uint32_t seed = 1;
};
struct SourceFrame {
  std::span<const float> values;
  std::uint64_t renderFrame = 0;
};
// Borrowed integration hook for existing per-note script parameter controls.
// It is used only during this call and is never part of mutable/checkpoint state.
struct ParameterTransform {
  void *owner = nullptr, *voice = nullptr;
  float (*apply)(void *, void *, std::uint32_t, std::uint32_t, float, float) noexcept = nullptr;
};
struct StateView {
  std::span<EnvelopeState> envelopes;
  std::span<LfoState> lfos;
  std::span<RampState> ramps;
  std::span<float> parameters, previousSources;
  BornFacts *birth = nullptr;
  ParameterTransform transform{};
};
struct ResolvedTargets {
  std::span<const float> parameters;
  float ampEG = 1;
  bool ampDone = false, ampWaiting = false;
};
inline bool isEnvelope(std::uint32_t kind) noexcept { return kind >= 1 && kind <= 4; }
inline bool isLfo(std::uint32_t kind) noexcept { return kind >= 6 && kind <= 10; }
inline bool isPhysical(std::uint32_t kind) noexcept {
  return kind == 0 || (kind >= 12 && kind <= 29);
}
inline const schema::PropertySpec *propertySpec(std::uint32_t kind,
                                                std::uint32_t property) noexcept {
  for (const auto &p : schema::kProperties)
    if (static_cast<std::uint32_t>(p.kind) == kind &&
        static_cast<std::uint32_t>(p.property) == property)
      return &p;
  return nullptr;
}
inline bool prepareLayout(const RegionView &v, std::span<std::uint32_t> indices,
                          Layout &layout) noexcept {
  if (indices.size() != v.instances.size())
    return false;
  layout = {};
  layout.ramps = static_cast<std::uint32_t>(v.routes.size());
  layout.parameters = static_cast<std::uint32_t>(v.parameters.size());
  layout.sources = static_cast<std::uint32_t>(v.instances.size());
  for (std::uint32_t i = 0; i < v.instances.size(); ++i) {
    const auto &instance = v.instances[i];
    // Wire admission is separately restricted by the engine's implemented-kind mask.
    if (instance.kind > 30 || instance.firstParameter > v.parameters.size() ||
        instance.parameterCount > v.parameters.size() - instance.firstParameter)
      return false;
    indices[i] = isEnvelope(instance.kind) ? layout.envelopes++
                 : isLfo(instance.kind)    ? layout.lfos++
                                           : UINT32_MAX;
  }
  return true;
}
inline float value(const RegionView &v, StateView s, std::uint32_t instance,
                   Property property) noexcept {
  const auto &i = v.instances[instance];
  if (v.parameterSpecs.size() == v.parameters.size()) {
    // Prepared banks materialize every valid default and sort each instance's
    // properties. Missing properties therefore mean zero, without a schema scan.
    const auto rank = schema::parameterRank(i.kind, static_cast<std::uint32_t>(property));
    return rank < i.parameterCount ? s.parameters[i.firstParameter + rank] : 0;
  }
  for (auto index = i.firstParameter; index < i.firstParameter + i.parameterCount; ++index)
    if (v.parameters[index].property == static_cast<std::uint32_t>(property))
      return s.parameters[index];
  const auto *spec = propertySpec(i.kind, static_cast<std::uint32_t>(property));
  return spec ? spec->defaultValue : 0;
}
inline float curveValue(const RegionView &v, std::uint32_t id, float input,
                        bool discrete) noexcept {
  if (id == 0)
    return input;
  const float x = input < 0 ? 0 : input > 1 ? 1 : input;
  if (id == 1)
    return 2 * x - 1;
  if (id == 2)
    return 1 - x;
  if (id == 3)
    return 1 - 2 * x;
  for (const auto &curve : v.curves)
    if (curve.id == id) {
      const float position = x * 127;
      const auto left = static_cast<std::uint32_t>(position);
      if (discrete || left == 127)
        return curve.values[left];
      const double fraction = position - left;
      return finiteModulationValue(curve.values[left] * (1 - fraction) +
                                   curve.values[left + 1] * fraction);
    }
  return 0;
}
inline float generatorSource(const RegionView &v, StateView s, std::uint32_t index,
                             bool previous) noexcept {
  if (index >= v.instances.size())
    return 0;
  if (previous)
    return s.previousSources[index];
  const auto state = v.stateIndices[index];
  const auto kind = v.instances[index].kind;
  if (isEnvelope(kind))
    return finiteModulationValue(
        s.envelopes[state].current *
        static_cast<double>((kind == 2 || kind == 3) ? value(v, s, index, Property::Depth) : 1));
  if (isLfo(kind)) {
    const auto depth = value(v, s, index, Property::Depth);
    return finiteModulationValue(s.lfos[state].current * static_cast<double>(kind == 9
                                                                                 ? depth * .01F
                                                                             : kind == 10 ? 1
                                                                                          : depth));
  }
  return 0;
}
inline float sourceValue(const RegionView &v, StateView s, const SourceFrame &source,
                         std::uint32_t id, bool previous) noexcept {
  if (id == 0)
    return 1;
  const auto type = id & 0xffff0000u, index = id & 0xffffu;
  if (type == 0x10000)
    return index < source.values.size() ? source.values[index] : 0;
  if (type == 0x30000 || type == 0x40000)
    return generatorSource(v, s, index, previous);
  if (type == 0x60000u)
    return index < v.instances.size() && index < s.previousSources.size() &&
                   v.instances[index].kind == static_cast<std::uint32_t>(Kind::Variable)
               ? s.previousSources[index]
               : 0.0F;
  if (type == 0x50000 && s.birth) {
    if (index == 0)
      return s.birth->key / 127;
    if (index == 1)
      return s.birth->velocity / 127;
    if (index == 2)
      return s.birth->noteOffVelocity / 127;
  }
  return 0;
}
inline const schema::PropertySpec *parameterSpec(const RegionView &v, std::uint32_t i) noexcept {
  if (i < v.parameterSpecs.size())
    return v.parameterSpecs[i];
  const auto &p = v.parameters[i];
  return propertySpec(v.instances[p.instance].kind, p.property);
}
inline std::uint32_t equalizerInstance(const RegionView &v, std::uint32_t property) noexcept {
  const auto first = static_cast<std::uint32_t>(Property::Eq1Frequency);
  if (property < first || property > static_cast<std::uint32_t>(Property::Eq3Gain))
    return UINT32_MAX;
  const auto band = (property - first) / 3u + 1u;
  for (auto index = 0u; index < v.instances.size(); ++index)
    if (v.instances[index].kind == static_cast<std::uint32_t>(Kind::Equalizer) &&
        v.instances[index].authoredIndex == band)
      return index;
  return UINT32_MAX;
}
inline bool activeParameter(const RegionView &v, std::uint32_t i, bool physical,
                            bool birth) noexcept {
  const auto *spec = parameterSpec(v, i);
  if (v.instances[v.parameters[i].instance].kind == static_cast<std::uint32_t>(Kind::Variable))
    return false; // Variable inputs are resolved at their source-update boundary.
  if (!birth && v.instances[v.parameters[i].instance].kind == 0u) {
    const auto equalizer = equalizerInstance(v, v.parameters[i].property);
    if (equalizer != UINT32_MAX &&
        v.parameters[v.instances[equalizer].firstParameter +
                     schema::parameterRank(static_cast<std::uint32_t>(Kind::Equalizer),
                                           static_cast<std::uint32_t>(Property::Dynamic))]
                .base == 0)
      return false;
  }
  return isPhysical(v.instances[v.parameters[i].instance].kind) == physical &&
         (birth || !spec || spec->sampling != schema::Sampling::Birth);
}
inline bool centsParameter(const RegionView &v, StateView s, std::uint32_t i) noexcept {
  const auto *spec = parameterSpec(v, i);
  const auto equalizer = equalizerInstance(v, v.parameters[i].property);
  if (equalizer != UINT32_MAX &&
      (v.parameters[i].property - static_cast<std::uint32_t>(Property::Eq1Frequency)) % 3u == 0u)
    return v.parameters[v.instances[equalizer].firstParameter +
                        schema::parameterRank(static_cast<std::uint32_t>(Kind::Equalizer),
                                              static_cast<std::uint32_t>(Property::FilterMode))]
               .base == 0;
  if (!spec || spec->unit != schema::Unit::Hertz || spec->modulationUnit != schema::Unit::Cents)
    return false;
  float mode = 0;
  const auto &instance = v.instances[v.parameters[i].instance];
  for (auto p = instance.firstParameter; p < instance.firstParameter + instance.parameterCount; ++p)
    if (v.parameters[p].property == static_cast<std::uint32_t>(Property::FilterMode))
      mode = v.parameters[p].base;
  (void)s;
  return mode == 0;
}
inline double centsRatio(const RegionView &v, std::uint32_t parameter, double cents) noexcept {
  const auto instance = v.parameters[parameter].instance;
  return instance < v.preparedGenerators.size()
             ? v.preparedGenerators[instance].math.exponential(cents / 1200.0)
             : std::exp2(cents / 1200.0);
}
inline bool continuousVariableController(std::uint32_t controller) noexcept {
  return (controller >= 142u && controller <= 152u && controller != 144u) || controller == 154u;
}
inline VariableInputs variableInputs(const RegionView &v, std::uint32_t instance) noexcept {
  if (instance < v.preparedGenerators.size())
    return v.preparedGenerators[instance].parameters.variable;
  // Standalone/control preparation can use an unprepared view. Wire admission
  // requires every variable's inputs to form one contiguous route group.
  VariableInputs inputs;
  const auto target = v.instances[instance].firstParameter;
  for (auto route = 0u; route < v.routes.size(); ++route)
    if (v.routes[route].target == target) {
      if (!inputs.count)
        inputs.firstRoute = route;
      ++inputs.count;
      inputs.continuous |= continuousVariableController(v.routes[route].sourceA & 65535u);
    }
  return inputs;
}
inline void refreshVariables(const RegionView &v, StateView s, const SourceFrame &source,
                             bool continuousOnly = false) noexcept {
  if (!(v.variableFlags & (continuousOnly ? 2u : 1u)))
    return;
  for (auto instance = 0u; instance < v.instances.size(); ++instance) {
    const auto &node = v.instances[instance];
    if (node.kind != static_cast<std::uint32_t>(Kind::Variable))
      continue;
    const auto inputs = variableInputs(v, instance);
    if (continuousOnly && !inputs.continuous)
      continue;
    bool changed = inputs.count == 0u;
    for (auto i = inputs.firstRoute; i < inputs.firstRoute + inputs.count; ++i) {
      const auto &route = v.routes[i];
      if (continuousOnly && !continuousVariableController(route.sourceA & 65535u))
        continue;
      auto &cached = s.ramps[i];
      const auto raw = sourceValue(v, s, source, route.sourceA, false);
      if (cached.initialized && cached.target == raw)
        continue;
      // These input routes have no smoothing. Reuse their existing ramp storage
      // for the raw input and its weighted/curved contribution.
      cached.target = raw;
      cached.current = finiteModulationValue(
          static_cast<double>(curveValue(v, route.curveA, raw, false)) * route.depth);
      cached.initialized = true;
      changed = true;
    }
    if (!changed)
      continue;
    auto value = v.parameters[node.firstParameter].base;
    for (auto i = inputs.firstRoute; i < inputs.firstRoute + inputs.count; ++i)
      value = finiteModulationValue(v.routes[i].flags & 1u
                                        ? static_cast<double>(value) * s.ramps[i].current
                                        : static_cast<double>(value) + s.ramps[i].current);
    s.parameters[node.firstParameter] = value;
    s.previousSources[instance] = value;
  }
}
inline void resolveParameters(const RegionView &v, StateView s, const SourceFrame &source,
                              double seconds, bool physical, bool birth) noexcept {
  if (!physical && !birth && !s.transform.apply && !v.hasGeneratorRoutes)
    return;
  const auto visitParameters = [&](auto operation) {
    if (!birth && !s.transform.apply && v.parameterSpecs.size() == v.parameters.size()) {
      // CONTROL preparation lists only routed targets. Unrouted parameters keep
      // their resolved birth values; script-controlled instances use the full path.
      for (const auto i : v.dynamicParameters)
        if (activeParameter(v, i, physical, false))
          operation(i);
    } else {
      for (std::uint32_t i = 0; i < v.parameters.size(); ++i)
        if (activeParameter(v, i, physical, birth))
          operation(i);
    }
  };
  visitParameters([&](std::uint32_t i) { s.parameters[i] = 0; });
  for (std::uint32_t r = 0; r < v.routes.size(); ++r) {
    const auto &route = v.routes[r];
    if (route.flags & static_cast<std::uint32_t>(schema::RouteFlag::IntegerDepth))
      continue;
    if (!activeParameter(v, route.target, physical, birth))
      continue;
    const auto a = curveValue(v, route.curveA, sourceValue(v, s, source, route.sourceA, !physical),
                              route.flags & 2);
    const auto b = curveValue(v, route.curveB, sourceValue(v, s, source, route.sourceB, !physical),
                              route.flags & 4);
    float amount = finiteModulationValue(static_cast<double>(a) * b * route.depth);
    if (route.step > 0)
      amount =
          finiteModulationValue(std::round(static_cast<double>(amount) / route.step) * route.step);
    amount = tickRamp(s.ramps[r], amount, route.smoothMs, seconds);
    if (!(route.flags & 1))
      s.parameters[route.target] =
          finiteModulationValue(static_cast<double>(s.parameters[route.target]) + amount);
  }
  visitParameters([&](std::uint32_t i) {
    s.parameters[i] =
        centsParameter(v, s, i)
            ? finiteModulationValue(v.parameters[i].base * centsRatio(v, i, s.parameters[i]))
            : finiteModulationValue(static_cast<double>(v.parameters[i].base) + s.parameters[i]);
  });
  for (std::uint32_t r = 0; r < v.routes.size(); ++r) {
    const auto &route = v.routes[r];
    if (route.flags & static_cast<std::uint32_t>(schema::RouteFlag::IntegerDepth))
      continue;
    if (!(route.flags & 1) || !activeParameter(v, route.target, physical, birth))
      continue;
    const auto *spec = parameterSpec(v, route.target);
    const auto amount = s.ramps[r].current;
    const double factor = centsParameter(v, s, route.target) ? centsRatio(v, route.target, amount)
                          : spec && spec->modulationUnit == schema::Unit::Percent ? amount * .01
                                                                                  : amount;
    s.parameters[route.target] = finiteModulationValue(s.parameters[route.target] * factor);
  }
  visitParameters([&](std::uint32_t i) {
    const auto *spec = parameterSpec(v, i);
    auto &result = s.parameters[i];
    if (spec) {
      result = result < spec->minimum   ? spec->minimum
               : result > spec->maximum ? spec->maximum
                                        : result;
      if (spec->integer)
        result = std::round(result);
    }
    if (s.transform.apply) {
      const auto &parameter = v.parameters[i];
      result = s.transform.apply(s.transform.owner, s.transform.voice,
                                 v.instances[parameter.instance].kind, parameter.property, result,
                                 parameter.base);
    }
  });
}
inline FixedEnvelopeParameters fixedParameters(const RegionView &v, StateView s,
                                               std::uint32_t i) noexcept {
  if (!s.transform.apply && i < v.preparedGenerators.size() && v.preparedGenerators[i].constant)
    return v.preparedGenerators[i].parameters.fixed;
  return {value(v, s, i, Property::Delay),           value(v, s, i, Property::Start),
          value(v, s, i, Property::Attack),          value(v, s, i, Property::Hold),
          value(v, s, i, Property::Decay),           value(v, s, i, Property::Sustain),
          value(v, s, i, Property::Release),         value(v, s, i, Property::AttackShape),
          value(v, s, i, Property::DecayShape),      value(v, s, i, Property::ReleaseShape),
          value(v, s, i, Property::Dynamic) != 0,    value(v, s, i, Property::DecayZero) != 0,
          value(v, s, i, Property::ReleaseZero) != 0};
}
inline FlexibleEnvelopeParameters flexibleParameters(const RegionView &v, StateView s,
                                                     std::uint32_t i) noexcept {
  return {static_cast<std::uint32_t>(value(v, s, i, Property::Points)),
          static_cast<std::uint32_t>(value(v, s, i, Property::SustainPoint)),
          static_cast<int>(value(v, s, i, Property::Loop)),
          static_cast<std::uint32_t>(value(v, s, i, Property::LoopCount)),
          value(v, s, i, Property::Dynamic) != 0};
}
inline EnvelopePoint envelopePoint(const RegionView &v, StateView s, std::uint32_t parent,
                                   std::uint32_t point) noexcept {
  for (std::uint32_t i = 0; i < v.instances.size(); ++i)
    if (v.instances[i].kind == 5 && v.instances[i].parent == parent &&
        v.instances[i].authoredIndex == point)
      return {value(v, s, i, Property::Time), value(v, s, i, Property::Level),
              value(v, s, i, Property::Shape),
              static_cast<std::uint32_t>(value(v, s, i, Property::Curve))};
  return {};
}
inline LfoParameters lfoParameters(const RegionView &v, StateView s, std::uint32_t i) noexcept {
  if (!s.transform.apply && i < v.preparedGenerators.size() && v.preparedGenerators[i].constant)
    return v.preparedGenerators[i].parameters.lfo;
  return {value(v, s, i, Property::Frequency),
          value(v, s, i, Property::Delay),
          value(v, s, i, Property::Fade),
          value(v, s, i, Property::Phase),
          value(v, s, i, Property::Ratio),
          value(v, s, i, Property::Scale),
          value(v, s, i, Property::Offset),
          value(v, s, i, Property::Smooth),
          static_cast<int>(value(v, s, i, Property::Wave)),
          static_cast<int>(value(v, s, i, Property::Count)),
          static_cast<std::uint32_t>(value(v, s, i, Property::Steps))};
}
inline float lfoStep(const RegionView &v, StateView s, std::uint32_t parent,
                     std::uint32_t step) noexcept {
  for (std::uint32_t i = 0; i < v.instances.size(); ++i)
    if (v.instances[i].kind == 11 && v.instances[i].parent == parent &&
        v.instances[i].authoredIndex == step + 1)
      return value(v, s, i, Property::StepLevel) * .01F;
  return 0;
}
inline void resetVoice(const RegionView &v, StateView s, const BornFacts &birth,
                       const SourceFrame &source, float rate) noexcept {
  if (s.birth)
    *s.birth = birth;
  for (auto &e : s.envelopes)
    e = {};
  for (auto &l : s.lfos)
    l = {};
  for (auto &r : s.ramps)
    r = {};
  for (auto &p : s.previousSources)
    p = 0;
  for (std::uint32_t i = 0; i < v.parameters.size(); ++i)
    s.parameters[i] = v.parameters[i].base;
  resolveParameters(v, s, source, 1.0 / rate, false, true);
  refreshVariables(v, s, source);
  resolveParameters(v, s, source, 1.0 / rate, true, true);
  for (std::uint32_t i = 0; i < v.instances.size(); ++i) {
    const auto kind = v.instances[i].kind, index = v.stateIndices[i];
    if (kind >= 1 && kind <= 3)
      resetFixedEnvelope(s.envelopes[index], fixedParameters(v, s, i));
    else if (kind == 4)
      resetFlexibleEnvelope(s.envelopes[index], flexibleParameters(v, s, i),
                            [&](std::uint32_t p) { return envelopePoint(v, s, i, p); });
    else if (isLfo(kind)) {
      auto p = lfoParameters(v, s, i);
      if (kind == 10)
        p.phase = value(v, s, v.instances[i].parent, Property::Phase);
      resetLfo(s.lfos[index], p, birth.seed ^ (i * 2654435761u));
    }
  }
  // The first physical route value uses the first generated sample, not the
  // provisional zero source vector used while establishing birth parameters.
  for (std::uint32_t r = 0; r < v.routes.size(); ++r)
    if (isPhysical(v.instances[v.parameters[v.routes[r].target].instance].kind) &&
        (v.routes[r].sourceA >= 0x30000 || v.routes[r].sourceB >= 0x30000))
      s.ramps[r].initialized = false;
}
inline void releaseVoice(const RegionView &v, StateView s, const SourceFrame &source,
                         float rate) noexcept {
  if (s.birth)
    s.birth->gate = false;
  refreshVariables(v, s, source);
  resolveParameters(v, s, source, 0, false, false);
  for (std::uint32_t i = 0; i < v.instances.size(); ++i) {
    const auto kind = v.instances[i].kind, index = v.stateIndices[i];
    if (kind >= 1 && kind <= 3)
      releaseFixedEnvelope(s.envelopes[index], fixedParameters(v, s, i));
    else if (kind == 4)
      releaseFlexibleEnvelope(s.envelopes[index], flexibleParameters(v, s, i),
                              [&](std::uint32_t p) { return envelopePoint(v, s, i, p); });
  }
  (void)rate;
}
inline void tickVoice(const RegionView &v, StateView s, const SourceFrame &source, float rate,
                      ResolvedTargets &result) noexcept {
  const double seconds = 1.0 / rate;
  resolveParameters(v, s, source, seconds, false, false);
  result = {s.parameters, 1, false};
  bool replacement = false;
  for (std::uint32_t i = 0; i < v.instances.size(); ++i)
    if (v.instances[i].kind == 4 && value(v, s, i, Property::AmpEnvelope) != 0)
      replacement = true;
  for (std::uint32_t i = 0; i < v.instances.size(); ++i) {
    const auto kind = v.instances[i].kind, index = v.stateIndices[i];
    if (kind >= 1 && kind <= 3) {
      const auto output = tickFixedEnvelope(s.envelopes[index], fixedParameters(v, s, i), seconds);
      if (kind == 1 && !replacement) {
        result.ampDone = s.envelopes[index].done;
        result.ampWaiting = s.envelopes[index].stage == 0;
      }
      (void)output;
    } else if (kind == 4) {
      tickFlexibleEnvelope(
          s.envelopes[index], flexibleParameters(v, s, i),
          [&](std::uint32_t p) { return envelopePoint(v, s, i, p); }, seconds,
          [&](std::uint32_t id, float x) { return curveValue(v, id, x, false); });
      if (value(v, s, i, Property::AmpEnvelope) != 0)
        result.ampDone = s.envelopes[index].done;
    } else if (kind >= 6 && kind <= 9) {
      auto p = lfoParameters(v, s, i);
      auto &state = s.lfos[index];
      const bool stopped = p.count >= 0 && state.cycles >= p.count;
      auto *cache = i < v.preparedGenerators.size() ? &v.preparedGenerators[i].math : nullptr;
      float output =
          tickLfo(state, p, [&](std::uint32_t n) { return lfoStep(v, s, i, n); }, seconds, cache);
      for (std::uint32_t sub = 0;
           (i >= v.preparedGenerators.size() || v.preparedGenerators[i].hasSuboscillators) &&
           sub < v.instances.size();
           ++sub)
        if (v.instances[sub].kind == 10 && v.instances[sub].parent == i) {
          auto subParameters = lfoParameters(v, s, sub);
          subParameters.frequency = p.frequency;
          subParameters.count = -1;
          auto &subState = s.lfos[v.stateIndices[sub]];
          subState.delay = state.delay;
          subState.fade = state.fade;
          if (stopped)
            subState.current = 0;
          else
            output = finiteModulationValue(
                static_cast<double>(output) +
                tickLfo(
                    subState, subParameters, [](std::uint32_t) { return 0.0F; }, seconds,
                    sub < v.preparedGenerators.size() ? &v.preparedGenerators[sub].math : nullptr));
        }
      state.current = output;
    }
  }
  refreshVariables(v, s, source, true);
  resolveParameters(v, s, source, seconds, true, false);
  for (std::uint32_t i = 0; i < v.instances.size(); ++i)
    if (v.instances[i].kind != static_cast<std::uint32_t>(Kind::Variable))
      s.previousSources[i] = generatorSource(v, s, i, false);
}
inline bool rescaleState(StateView, float oldRate, float newRate) noexcept {
  return std::isfinite(oldRate) && oldRate > 0 && std::isfinite(newRate) && newRate > 0;
}
} // namespace effetune::plugins::others::sfz::modulation
#endif

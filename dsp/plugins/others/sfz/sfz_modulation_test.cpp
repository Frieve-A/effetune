#include "sfz_modulation.h"
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <vector>
namespace m = effetune::plugins::others::sfz::modulation;
static void require(bool condition, const char *message) {
  if (!condition) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
static void near(float actual, float expected, float tolerance, const char *message) {
  require(std::abs(actual - expected) <= tolerance, message);
}
static void variables() {
  using K = effetune::plugins::others::sfz::schema::Kind;
  using P = effetune::plugins::others::sfz::schema::Property;
  std::array<m::Instance, 2> nodes{
      {{0u, 0u, UINT32_MAX, 0u, 1u}, {static_cast<unsigned>(K::Variable), 1u, UINT32_MAX, 1u, 1u}}};
  std::array<m::Parameter, 2> parameters{{{0u, static_cast<unsigned>(P::Volume), 0.0F},
                                          {1u, static_cast<unsigned>(P::VariableValue), 1.0F}}};
  std::array<m::Route, 4> routes{{{0u, 0x60001u, 0u, 12.0F},
                                  {1u, 0x10001u, 0u, 1.0F, 0u, 0u, 0.0F, 0.0F, 1u},
                                  {1u, 0x10002u, 0u, 1.0F, 0u, 0u, 0.0F, 0.0F, 1u},
                                  {1u, 0x10003u, 0u, 1.0F, 0u, 0u, 0.0F, 0.0F, 1u}}};
  std::array<std::uint32_t, 2> indices{UINT32_MAX, UINT32_MAX};
  m::RegionView view{nodes, parameters, routes, {}, indices, {}};
  view.variableFlags = 1u;
  m::Layout layout;
  require(m::prepareLayout(view, indices, layout), "variable needs no envelope/LFO allocation");
  require(layout.envelopes == 0 && layout.lfos == 0 && layout.sources == 2,
          "variable reuses the existing instance source slot");
  std::array<m::RampState, 4> ramps{};
  std::array<float, 2> values{}, previous{};
  m::BornFacts birth;
  m::StateView state{{}, {}, ramps, values, previous, &birth};
  std::array<float, 156> cc{};
  cc[1] = cc[2] = cc[3] = .5F;
  m::SourceFrame source{cc};
  m::resetVoice(view, state, birth, source, 48000);
  near(previous[1], .125F, 0, "three-controller variable product");
  near(values[0], 1.5F, 0, "variable source resolves into physical destination at birth");
  m::ResolvedTargets result;
  for (auto frame = 0u; frame < 32u; ++frame)
    m::tickVoice(view, state, source, 48000, result);
  near(previous[1], .125F, 0, "generator tick must retain the variable source");
  cc[2] = .25F;
  m::refreshVariables(view, state, source);
  m::tickVoice(view, state, source, 48000, result);
  near(values[0], .75F, 0, "accepted event refresh updates the physical value");
  parameters[1].base = 0;
  for (auto i = 1u; i < routes.size(); ++i)
    routes[i].flags = 0;
  cc[2] = .5F;
  routes[1].curveA = 2u;
  cc[1] = .75F;
  m::resetVoice(view, state, birth, source, 48000);
  near(previous[1], 1.25F, 0, "add uses per-input curves without clipping sum to one");
  near(values[0], 15.0F, 0, "variable identity curve preserves sums above one");
  // Prepared banks carry the same grouping facts without scanning routes.
  std::array<m::PreparedGenerator, 2> prepared{};
  prepared[1].parameters.variable = {1u, 3u, true};
  view.preparedGenerators = prepared;
  view.variableFlags = 3u;
  routes[1].sourceA = 0x10000u | 145u;
  routes[1].curveA = 0;
  cc[145] = .25F;
  m::resetVoice(view, state, birth, source, 48000);
  cc[145] = .75F;
  m::tickVoice(view, state, source, 48000, result);
  near(previous[1], 1.75F, 0, "time-dependent virtual input refreshes without MIDI revision");
  // Cached state copying is the same operation used by strict trial/restore.
  const auto savedRamps = ramps;
  const auto savedValues = values, savedPrevious = previous;
  cc[145] = 0;
  m::tickVoice(view, state, source, 48000, result);
  ramps = savedRamps;
  values = savedValues;
  previous = savedPrevious;
  cc[145] = .75F;
  m::tickVoice(view, state, source, 48000, result);
  require(values == savedValues && previous == savedPrevious,
          "restored cache resumes without a stale variable or extra state field");
  routes[1].sourceA = 0x10000u | 130u;
  prepared[1].parameters.variable.continuous = false;
  view.variableFlags = 1u;
  cc[130] = .25F;
  m::resetVoice(view, state, birth, source, 48000);
  near(previous[1], 1.25F, 0, "voice-specific pressure uses that voice's source frame");
}
int main() {
  variables();
  m::RampState ramp;
  near(m::tickRamp(ramp, 5, 100, .01), 5, 0, "route birth must not ramp from zero");
  near(m::tickRamp(ramp, 15, 100, .01), 6, 1e-6F, "linear ramp first step");
  for (int i = 0; i < 9; ++i)
    m::tickRamp(ramp, 15, 100, .01);
  near(ramp.current, 15, 1e-5F, "linear ramp endpoint");
  m::FixedEnvelopeParameters fixed;
  fixed.decay = 1;
  fixed.sustain = 50;
  fixed.decayShape = 0;
  fixed.release = .5F;
  fixed.releaseShape = 0;
  m::EnvelopeState envelope;
  m::resetFixedEnvelope(envelope, fixed);
  for (int i = 0; i < 6; ++i)
    m::tickFixedEnvelope(envelope, fixed, .1);
  near(envelope.current, .5F, 1e-5F, "fixed fullscale decay reaches half sustain at half duration");
  require(envelope.stage == 4, "fixed fullscale decay enters sustain early");
  fixed.releaseZero = true;
  m::releaseFixedEnvelope(envelope, fixed);
  near(m::tickFixedEnvelope(envelope, fixed, .1), .5F, 1e-6F, "release starts at current level");
  m::tickFixedEnvelope(envelope, fixed, .1);
  m::tickFixedEnvelope(envelope, fixed, .1);
  m::tickFixedEnvelope(envelope, fixed, .1);
  require(envelope.done, "fullscale release from half level ends after half time");
  fixed.decayZero = false;
  fixed.releaseZero = false;
  m::resetFixedEnvelope(envelope, fixed);
  for (int i = 0; i < 6; ++i)
    m::tickFixedEnvelope(envelope, fixed, .1);
  near(envelope.current, .75F, 1e-5F, "fixed scaled decay uses entire duration");
  near(m::envelopeCurve(.5, -10.3616F, false), .9944F, .001F,
       "negative descending shape is exponential");
  std::array<m::EnvelopePoint, 4> points{{{0, 0, 0}, {.25F, 1, 0}, {.25F, .5F, 0}, {.5F, 0, 0}}};
  const auto pointAt = [&](std::uint32_t i) { return points[i]; };
  m::FlexibleEnvelopeParameters flex{4, 2, 1, 1, false};
  m::resetFlexibleEnvelope(envelope, flex, pointAt);
  for (int i = 0; i < 10; ++i)
    m::tickFlexibleEnvelope(envelope, flex, pointAt, .125);
  require(envelope.loops == 1 && envelope.holding, "finite flex loop returns to sustain");
  m::releaseFlexibleEnvelope(envelope, flex, pointAt);
  require(envelope.stage == 3 && !envelope.holding, "flex release exits to stage after sustain");
  for (int i = 0; i < 5; ++i)
    m::tickFlexibleEnvelope(envelope, flex, pointAt, .125);
  require(envelope.done, "flex release completes");
  flex.loopCount = 0;
  m::resetFlexibleEnvelope(envelope, flex, pointAt);
  for (int i = 0; i < 25; ++i)
    m::tickFlexibleEnvelope(envelope, flex, pointAt, .125);
  require(envelope.loops > 1 && !envelope.holding, "infinite flex loop continues while held");
  m::releaseFlexibleEnvelope(envelope, flex, pointAt);
  require(envelope.stage == 3, "release immediately leaves infinite loop");
  flex.loop = -1;
  points[1].curve = 7;
  m::resetFlexibleEnvelope(envelope, flex, pointAt);
  m::tickFlexibleEnvelope(envelope, flex, pointAt, .125,
                          [](std::uint32_t, float x) { return x * x; });
  near(m::tickFlexibleEnvelope(envelope, flex, pointAt, .125,
                               [](std::uint32_t, float x) { return x * x; }),
       .25F, 1e-6F, "flex segment uses custom curve");
  points[1].curve = 0;
  fixed.dynamic = true;
  fixed.attack = 1;
  fixed.decay = 0;
  fixed.sustain = 100;
  m::resetFixedEnvelope(envelope, fixed);
  for (int i = 0; i < 5; ++i)
    m::tickFixedEnvelope(envelope, fixed, .1);
  const auto before = envelope.current;
  fixed.attack = 2;
  near(m::tickFixedEnvelope(envelope, fixed, .1), before, 1e-6F,
       "dynamic envelope retimes without level discontinuity");
  for (int i = 0; i < 17; ++i)
    m::tickFixedEnvelope(envelope, fixed, .1);
  require(envelope.stage == 4, "dynamic duration change does not restart indefinitely");
  m::LfoParameters lfo;
  lfo.frequency = 1;
  lfo.phase = .25F;
  lfo.count = 1;
  m::LfoState oscillator;
  m::resetLfo(oscillator, lfo, 19);
  const auto step = [](std::uint32_t i) { return i ? -.5F : .5F; };
  near(m::tickLfo(oscillator, lfo, step, .25), 1, 1e-6F,
       "LFO initial phase sampled before advancing");
  for (int i = 0; i < 3; ++i)
    m::tickLfo(oscillator, lfo, step, .25);
  near(m::tickLfo(oscillator, lfo, step, .25), 0, 0, "finite LFO count ends");
  lfo.phase = 0;
  lfo.steps = 2;
  lfo.count = -1;
  m::resetLfo(oscillator, lfo, 19);
  near(m::tickLfo(oscillator, lfo, step, .5), .5F, 0, "step LFO first point");
  near(m::tickLfo(oscillator, lfo, step, .5), -.5F, 0, "step LFO second point");
  lfo.steps = 0;
  lfo.wave = 12;
  m::resetLfo(oscillator, lfo, 19);
  const auto first = m::tickLfo(oscillator, lfo, step, .25);
  near(m::tickLfo(oscillator, lfo, step, .25), first, 0, "sample hold holds half period");
  require(m::tickLfo(oscillator, lfo, step, .25) != first, "sample hold changes twice per period");
  std::array<m::Instance, 1> instances{{{0, 0, UINT32_MAX, 0, 1, 0}}};
  std::array<m::Parameter, 1> parameters{{{0, 0, 0, 0}}};
  std::array<m::Route, 1> routes{{{0, 0x10001, 0, 10, 0, 0, 100, 2, 0, 0}}};
  std::array<std::uint32_t, 1> indices{};
  m::RegionView view{instances, parameters, routes, {}, indices, {}};
  m::Layout layout;
  require(m::prepareLayout(view, indices, layout), "layout prepared");
  std::array<m::RampState, 1> ramps{};
  std::array<float, 1> values{}, previous{};
  m::BornFacts facts;
  m::StateView state{{}, {}, ramps, values, previous, &facts};
  std::array<float, 138> controllers{};
  controllers[1] = .51F;
  m::SourceFrame source{controllers, 0};
  m::resetVoice(view, state, facts, source, 100);
  near(values[0], 6, 0, "route target-unit nearest step before smoothing at birth");
  controllers[1] = 1;
  m::ResolvedTargets result;
  m::tickVoice(view, state, source, 100, result);
  near(values[0], 6.4F, 1e-5F, "route CC change smooths stepped target");
  require(m::rescaleState(state, 100, 200), "rate conversion accepts finite rates");
  require(!m::rescaleState(state, 100, 0), "rate conversion rejects zero");
  std::array<m::Instance, 3> coupledInstances{};
  std::vector<m::Parameter> coupledParameters;
  std::array<std::uint32_t, 3> frequencySlots{};
  for (std::uint32_t i = 0; i < 3; ++i) {
    const auto kind = i ? m::Kind::LFO : m::Kind::Region;
    auto &instance = coupledInstances[i];
    instance.kind = static_cast<std::uint32_t>(kind);
    instance.firstParameter = static_cast<std::uint32_t>(coupledParameters.size());
    for (const auto &spec : effetune::plugins::others::sfz::schema::kProperties) {
      if (spec.kind != kind)
        continue;
      float base = spec.defaultValue;
      if (spec.property == m::Property::Frequency) {
        base = 1;
      }
      if (spec.property == m::Property::Phase)
        base = .25F;
      coupledParameters.push_back(
          {i, static_cast<std::uint32_t>(spec.property), base, spec.combine});
      ++instance.parameterCount;
    }
    std::sort(coupledParameters.begin() + instance.firstParameter, coupledParameters.end(),
              [](const auto &a, const auto &b) { return a.property < b.property; });
    for (auto p = instance.firstParameter; p < coupledParameters.size(); ++p)
      if (coupledParameters[p].property == static_cast<std::uint32_t>(m::Property::Frequency))
        frequencySlots[i] = p;
  }
  std::array<m::Route, 3> coupledRoutes{{{frequencySlots[1], 0x40002, 0, .1F, 0, 0, 0, 0, 0, 0},
                                         {frequencySlots[2], 0x40001, 0, .1F, 0, 0, 0, 0, 0, 0},
                                         {0, 0x40001, 0, 1, 0, 0, 500, 0, 0, 0}}};
  std::array<std::uint32_t, 3> coupledIndices{};
  m::RegionView coupledView{
      coupledInstances, coupledParameters, coupledRoutes, {}, coupledIndices, {}};
  require(m::prepareLayout(coupledView, coupledIndices, layout), "coupled layout prepared");
  std::array<m::LfoState, 2> coupledLfos{};
  std::array<m::RampState, 3> coupledRamps{};
  std::array<float, 3> coupledPrevious{};
  std::vector<float> coupledValues(coupledParameters.size());
  m::StateView coupledState{{}, coupledLfos, coupledRamps, coupledValues, coupledPrevious, &facts};
  m::resetVoice(coupledView, coupledState, facts, source, 100);
  m::tickVoice(coupledView, coupledState, source, 100, result);
  near(coupledValues[0], 1, 1e-6F,
       "physical source keeps first-sample phase without fake smoothing ramp");
  const auto firstSampleValues = coupledValues;
  near(coupledValues[frequencySlots[1]], 1, 1e-6F,
       "cross-generator first sample uses prior zero vector");
  m::tickVoice(coupledView, coupledState, source, 100, result);
  near(coupledValues[frequencySlots[1]], 1.1F, 1e-6F,
       "cross-generator uses previous sample output");
  near(coupledValues[frequencySlots[1]], coupledValues[frequencySlots[2]], 0,
       "mutual modulation is independent of instance order");
  const auto savedLfos = coupledLfos;
  const auto savedRamps = coupledRamps;
  const auto savedPrevious = coupledPrevious;
  const auto savedValues = coupledValues;
  m::tickVoice(coupledView, coupledState, source, 100, result);
  const auto expectedValues = coupledValues;
  coupledLfos = savedLfos;
  coupledRamps = savedRamps;
  coupledPrevious = savedPrevious;
  coupledValues = savedValues;
  m::tickVoice(coupledView, coupledState, source, 100, result);
  require(coupledValues == expectedValues, "POD state rollback reproduces exact next sample");
  m::resetVoice(coupledView, coupledState, facts, source, 100);
  m::tickVoice(coupledView, coupledState, source, 100, result);
  require(coupledValues == firstSampleValues,
          "reused generator slots reset to fresh first-sample values");
  std::vector<const effetune::plugins::others::sfz::schema::PropertySpec *> cachedSpecs;
  for (const auto &parameter : coupledParameters)
    cachedSpecs.push_back(
        m::propertySpec(coupledInstances[parameter.instance].kind, parameter.property));
  const std::array<std::uint32_t, 3> dynamicSlots{0, frequencySlots[1], frequencySlots[2]};
  auto preparedView = coupledView;
  preparedView.parameterSpecs = cachedSpecs;
  preparedView.dynamicParameters = dynamicSlots;
  auto preparedLfos = coupledLfos;
  auto preparedRamps = coupledRamps;
  auto preparedPrevious = coupledPrevious;
  auto preparedValues = coupledValues;
  m::StateView preparedState{{},    preparedLfos, preparedRamps, preparedValues, preparedPrevious,
                             &facts};
  for (auto sample = 0u; sample < 200u; ++sample) {
    m::tickVoice(coupledView, coupledState, source, 100, result);
    m::tickVoice(preparedView, preparedState, source, 100, result);
    require(coupledValues == preparedValues,
            "prepared routed-target processing preserves exact full-path output");
  }
  lfo.ratio = std::numeric_limits<float>::max();
  lfo.scale = std::numeric_limits<float>::max();
  lfo.offset = std::numeric_limits<float>::max();
  m::resetLfo(oscillator, lfo, 9);
  for (int i = 0; i < 8; ++i)
    require(std::isfinite(m::tickLfo(oscillator, lfo, step, .01)),
            "finite extreme LFO parameters stay finite");
  std::printf("SFZ helper tests passed; state bytes EG=%zu LFO=%zu ramp=%zu\n",
              sizeof(m::EnvelopeState), sizeof(m::LfoState), sizeof(m::RampState));
}

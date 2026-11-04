#ifndef EFFETUNE_SFZ_MODULATION_BANK_H
#define EFFETUNE_SFZ_MODULATION_BANK_H
#include "effetune/abi.h"
#include "nothrow_storage.h"
#include "sfz_modulation.h"
#include "sfz_noise.h"
#include "sfz_oscillator.h"
#include "sfz_playback_preparation.h"
#include "sfz_voice_dsp.h"
#include <algorithm>
#include <bit>
#include <limits>
#include <memory>

namespace effetune::plugins::others::sfz {
// Immutable typed preparation is separate from per-voice mutable processing.
// Serialized indices are region-local; native offsets never enter checkpoints.
struct ModulationRegion {
  static constexpr std::array<schema::Property, 15> kRegionProperties{
      schema::Property::Volume,       schema::Property::Amplitude,    schema::Property::Pitch,
      schema::Property::Pan,          schema::Property::Width,        schema::Property::Position,
      schema::Property::Eq1Frequency, schema::Property::Eq1Bandwidth, schema::Property::Eq1Gain,
      schema::Property::Eq2Frequency, schema::Property::Eq2Bandwidth, schema::Property::Eq2Gain,
      schema::Property::Eq3Frequency, schema::Property::Eq3Bandwidth, schema::Property::Eq3Gain};
  static constexpr std::array<schema::Property, 5> kFilterProperties{
      schema::Property::Enabled, schema::Property::FilterType, schema::Property::Cutoff,
      schema::Property::Resonance, schema::Property::Gain};
  std::uint32_t firstRoute = 0, routeCount = 0, firstInstance = 0, instanceCount = 0,
                firstParameter = 0, parameterCount = 0;
  modulation::Layout layout{};
  std::array<std::uint32_t, 2> filters{UINT32_MAX, UINT32_MAX};
  std::uint32_t combMask = 0;
  std::uint32_t dynamicParameterCount = 0;
  bool hasGeneratorRoutes = false, noteEnabled = true, silentAction = false;
  std::uint8_t variableFlags = 0;
  std::array<std::uint32_t, 15> regionParameters{};
  std::array<std::array<std::uint32_t, 5>, 2> filterParameters{};
  std::uint32_t playback = UINT32_MAX;
  std::uint32_t sourceInstance = UINT32_MAX, amplifierInstance = UINT32_MAX;
  std::uint32_t voiceDspInstance = UINT32_MAX, noiseInstance = UINT32_MAX;
  std::uint32_t tempoInstance = UINT32_MAX, timerInstance = UINT32_MAX;
  std::array<std::uint32_t, 3> equalizers{UINT32_MAX, UINT32_MAX, UINT32_MAX};
  std::array<std::span<const std::uint32_t>, 3> conditions{};
  ModulationRegion() noexcept {
    regionParameters.fill(UINT32_MAX);
    for (auto &parameters : filterParameters)
      parameters.fill(UINT32_MAX);
  }
};

class ModulationStatePool {
public:
  bool prepare(const modulation::Layout &maximum, std::uint32_t voices, bool hasSource = false,
               bool hasVoiceDsp = false, bool hasNoise = false) noexcept {
    maximum_ = maximum;
    return envelopes_.allocate(static_cast<std::size_t>(maximum.envelopes) * voices) &&
           lfos_.allocate(static_cast<std::size_t>(maximum.lfos) * voices) &&
           ramps_.allocate(static_cast<std::size_t>(maximum.ramps) * voices) &&
           parameters_.allocate(static_cast<std::size_t>(maximum.parameters) * voices) &&
           sources_.allocate(static_cast<std::size_t>(maximum.sources) * voices) &&
           births_.allocate(voices) && oscillators_.allocate(hasSource ? voices : 0) &&
           voice_dsp_.allocate(hasVoiceDsp ? voices : 0) && noise_.allocate(hasNoise ? voices : 0);
  }
  modulation::StateView state(std::uint32_t voice, const modulation::Layout &used) noexcept {
    return {slice(envelopes_, voice, maximum_.envelopes, used.envelopes),
            slice(lfos_, voice, maximum_.lfos, used.lfos),
            slice(ramps_, voice, maximum_.ramps, used.ramps),
            slice(parameters_, voice, maximum_.parameters, used.parameters),
            slice(sources_, voice, maximum_.sources, used.sources),
            births_.data() + voice};
  }
  oscillator::State &oscillatorState(std::uint32_t voice) noexcept {
    return oscillators_.data()[voice];
  }
  bool hasOscillatorState() const noexcept { return oscillators_.size() != 0; }
  VoiceDsp &voiceDspState(std::uint32_t voice) noexcept { return voice_dsp_.data()[voice]; }
  NoiseLayer &noiseState(std::uint32_t voice) noexcept { return noise_.data()[voice]; }
  void copyFrom(const ModulationStatePool &source) noexcept {
    copy(envelopes_, source.envelopes_);
    copy(lfos_, source.lfos_);
    copy(ramps_, source.ramps_);
    copy(parameters_, source.parameters_);
    copy(sources_, source.sources_);
    copy(births_, source.births_);
    copy(oscillators_, source.oscillators_);
    copy(voice_dsp_, source.voice_dsp_);
    copy(noise_, source.noise_);
  }
  void clear() noexcept {
    fill(envelopes_);
    fill(lfos_);
    fill(ramps_);
    fill(parameters_);
    fill(sources_);
    fill(births_);
    fill(voice_dsp_);
    if (noise_.size()) {
      NoiseLayer empty;
      std::fill_n(noise_.data(), noise_.size(), empty);
    }
    if (oscillators_.size()) {
      oscillator::State empty;
      std::fill_n(oscillators_.data(), oscillators_.size(), empty);
    }
  }

private:
  template <class T>
  static std::span<T> slice(NothrowStorage<T> &storage, std::uint32_t voice, std::uint32_t stride,
                            std::uint32_t used) noexcept {
    return used ? std::span<T>(storage.data() + static_cast<std::size_t>(voice) * stride, used)
                : std::span<T>{};
  }
  template <class T>
  static void copy(NothrowStorage<T> &target, const NothrowStorage<T> &source) noexcept {
    if (source.size())
      std::copy_n(source.data(), source.size(), target.data());
  }
  template <class T> static void fill(NothrowStorage<T> &storage) noexcept {
    if (storage.size())
      std::fill_n(storage.data(), storage.size(), T{});
  }
  modulation::Layout maximum_{};
  NothrowStorage<modulation::EnvelopeState> envelopes_;
  NothrowStorage<modulation::LfoState> lfos_;
  NothrowStorage<modulation::RampState> ramps_;
  NothrowStorage<float> parameters_, sources_;
  NothrowStorage<modulation::BornFacts> births_;
  NothrowStorage<oscillator::State> oscillators_;
  NothrowStorage<VoiceDsp> voice_dsp_;
  NothrowStorage<NoiseLayer> noise_;
};

class ModulationBank {
public:
  std::uint64_t footprint = 0;
  modulation::Layout maximum{};
  std::uint32_t combMask = 0;
  bool hasSource = false, hasVoiceDsp = false, hasNoise = false;
  ModulationStatePool state;
  ModulationStatePool preview;
  modulation::RegionView region(std::uint32_t index) const noexcept {
    const auto &r = regions_.data()[index];
    return {span(instances_, r.firstInstance, r.instanceCount),
            span(parameters_, r.firstParameter, r.parameterCount),
            span(routes_, r.firstRoute, r.routeCount),
            span(curves_, 0, static_cast<std::uint32_t>(curves_.size())),
            span(indices_, r.firstInstance, r.instanceCount),
            span(specs_, r.firstParameter, r.parameterCount),
            span(dynamic_parameters_, r.firstParameter, r.dynamicParameterCount),
            span(generators_, r.firstInstance, r.instanceCount),
            r.hasGeneratorRoutes,
            r.variableFlags};
  }
  const ModulationRegion &plan(std::uint32_t index) const noexcept {
    return regions_.data()[index];
  }
  double pitchRatio(std::uint32_t region, double cents) noexcept {
    return generators_.data()[regions_.data()[region].firstInstance].math.exponential(cents /
                                                                                      1200.0);
  }
  bool prepareState(std::uint32_t voices = 128u) noexcept {
    if (!state.prepare(maximum, voices, hasSource, hasVoiceDsp, hasNoise) ||
        !preview.prepare(maximum, 1, hasSource, hasVoiceDsp, hasNoise))
      return false;
    for (auto n = 0u; n < regions_.size(); ++n) {
      const auto &plan = regions_.data()[n];
      auto view = region(n);
      view.preparedGenerators = {};
      auto values = preview.state(0, plan.layout);
      for (auto p = 0u; p < view.parameters.size(); ++p)
        values.parameters[p] = view.parameters[p].base;
      for (auto i = 0u; i < view.instances.size(); ++i) {
        auto &prepared = generators_.data()[plan.firstInstance + i];
        if (!prepared.constant)
          continue;
        if (view.instances[i].kind <= 3u)
          prepared.parameters.fixed = modulation::fixedParameters(view, values, i);
        else
          std::construct_at(&prepared.parameters.lfo, modulation::lfoParameters(view, values, i));
      }
    }
    return true;
  }
  std::int32_t noteOffset() const noexcept { return note_offset_; }
  std::int32_t switchOffset() const noexcept { return switch_offset_; }
  float initialController(std::uint32_t controller) const noexcept {
    return controller < initial_cc_.size() ? initial_cc_.data()[controller] : -1;
  }
  using SupportsProperty = bool (*)(std::uint32_t, std::uint32_t);
  std::uint64_t integerBase(std::uint32_t regionIndex, std::uint32_t parameter) const noexcept {
    const auto &r = regions_.data()[regionIndex];
    return parameter < r.parameterCount ? integer_bases_.data()[r.firstParameter + parameter] : 0;
  }
  double integerContribution(std::uint32_t regionIndex, std::uint32_t parameter,
                             std::span<const std::uint8_t> rawCC) const noexcept {
    return integerContributionWithController(regionIndex, parameter, [&](std::uint32_t cc) {
      return cc < rawCC.size() ? static_cast<double>(rawCC[cc]) / 127.0 : 0.0;
    });
  }
  template <class ControllerValue>
  double integerContributionWithController(std::uint32_t regionIndex, std::uint32_t parameter,
                                           ControllerValue controller) const noexcept {
    const auto &r = regions_.data()[regionIndex];
    const auto view = region(regionIndex);
    double result = 0;
    for (auto i = 0u; i < r.routeCount; ++i) {
      const auto &route = routes_.data()[r.firstRoute + i];
      if (route.target != parameter ||
          !(route.flags & static_cast<std::uint32_t>(schema::RouteFlag::IntegerDepth)))
        continue;
      const auto cc = route.sourceA & 65535u;
      const double normalized = controller(cc);
      const double source =
          route.curveA == 0
              ? normalized
              : modulation::curveValue(view, route.curveA, static_cast<float>(normalized),
                                       route.flags & 2u);
      double amount = source * integer_depths_.data()[r.firstRoute + i];
      if (route.step > 0)
        amount = std::round(amount / route.step) * route.step;
      result += amount;
    }
    return result;
  }
  const playback::PreparedPlayback *playbackPlan(std::uint32_t regionIndex) const noexcept {
    const auto index = regions_.data()[regionIndex].playback;
    return index == UINT32_MAX ? nullptr : playbacks_.data() + index;
  }
  et_status load(const float *data, std::uint32_t words, std::uint32_t regionCount,
                 std::uint64_t budget, std::uint32_t supportedKinds = 0x1fffu,
                 SupportsProperty supportsProperty = nullptr,
                 std::uint32_t voices = 128u) noexcept {
    if (!data || words < schema::kHeaderWords)
      return ET_ERR_ARGS;
    maximum = {};
    combMask = 0;
    hasSource = hasVoiceDsp = hasNoise = false;
    note_offset_ = switch_offset_ = 0;
    initial_cc_.release();
    std::uint32_t initialControllerCount = 0;
    const auto u = [data](std::uint32_t index) {
      return std::bit_cast<std::uint32_t>(data[index]);
    };
    const auto routeCount = u(3), curveCount = u(4), instanceCount = u(9), parameterCount = u(11);
    const bool effects = u(1) == 4u;
    const auto headerWords = effects ? 16u : schema::kHeaderWords;
    if (words < headerWords)
      return ET_ERR_ARGS;
    const auto modulationEnd = effects ? u(14) : words;
    if (effects &&
        (modulationEnd < headerWords || modulationEnd > words || u(15) != words - modulationEnd))
      return ET_ERR_ARGS;
    if (u(0) != 0x31525453u || (u(1) != schema::kVersion && !effects) || u(2) != regionCount ||
        u(12) != schema::kProfile || u(13) || u(5) != headerWords ||
        u(6) != u(5) + static_cast<std::uint64_t>(regionCount) * schema::kDirectoryWords ||
        u(7) != u(6) + static_cast<std::uint64_t>(routeCount) * schema::kRouteWords ||
        u(8) != u(7) + static_cast<std::uint64_t>(curveCount) * schema::kCurveWords ||
        u(10) != u(8) + static_cast<std::uint64_t>(instanceCount) * schema::kInstanceWords ||
        modulationEnd !=
            u(10) + static_cast<std::uint64_t>(parameterCount) * schema::kParameterWords ||
        routeCount > 1048576u || curveCount > 248u || instanceCount < regionCount)
      return ET_ERR_ARGS;
    footprint =
        static_cast<std::uint64_t>(routeCount) * (sizeof(modulation::Route) + sizeof(double)) +
        static_cast<std::uint64_t>(instanceCount) *
            (sizeof(modulation::Instance) + 2u * sizeof(std::uint32_t) +
             sizeof(modulation::PreparedGenerator)) +
        static_cast<std::uint64_t>(parameterCount) *
            (sizeof(modulation::Parameter) + sizeof(const schema::PropertySpec *) +
             sizeof(std::uint32_t) + sizeof(std::uint64_t)) +
        static_cast<std::uint64_t>(curveCount) * sizeof(modulation::Curve) +
        static_cast<std::uint64_t>(regionCount) * sizeof(ModulationRegion);
    if (footprint > budget)
      return ET_ERR_ARGS;
    if (!routes_.allocate(routeCount) || !curves_.allocate(curveCount) ||
        !instances_.allocate(instanceCount) || !parameters_.allocate(parameterCount) ||
        !indices_.allocate(instanceCount) || !specs_.allocate(parameterCount) ||
        !dynamic_parameters_.allocate(parameterCount) || !regions_.allocate(regionCount) ||
        !generators_.allocate(instanceCount) || !integer_bases_.allocate(parameterCount) ||
        !integer_depths_.allocate(routeCount) || !condition_indices_.allocate(instanceCount))
      return ET_ERR_OOM;
    dynamic_parameters_.clear();
    integer_bases_.clear();
    integer_depths_.clear();
    auto previousCurve = 6u;
    for (auto i = 0u; i < curveCount; ++i) {
      auto &curve = curves_.data()[i];
      const auto offset = u(7) + i * schema::kCurveWords;
      curve.id = u(offset);
      if (curve.id <= previousCurve || curve.id > 254u)
        return ET_ERR_ARGS;
      previousCurve = curve.id;
      for (auto p = 0u; p < 128u; ++p) {
        curve.values[p] = data[offset + 1u + p];
        if (!std::isfinite(curve.values[p]))
          return ET_ERR_ARGS;
      }
    }
    std::uint32_t nextRoute = 0, nextInstance = 0, nextParameter = 0;
    for (auto n = 0u; n < regionCount; ++n) {
      const auto d = u(5) + n * schema::kDirectoryWords;
      auto &r = regions_.data()[n];
      r.firstRoute = u(d);
      r.routeCount = u(d + 1);
      r.firstInstance = u(d + 2);
      r.instanceCount = u(d + 3);
      r.firstParameter = u(d + 4);
      r.parameterCount = u(d + 5);
      if (r.firstRoute != nextRoute || r.routeCount > routeCount - nextRoute ||
          r.firstInstance != nextInstance || !r.instanceCount || r.instanceCount > 65536u ||
          r.instanceCount > instanceCount - nextInstance || r.firstParameter != nextParameter ||
          r.parameterCount > parameterCount - nextParameter)
        return ET_ERR_ARGS;
      std::uint32_t localParameter = 0;
      std::array<std::uint32_t, 3> conditionCounts{};
      std::uint32_t regionInitialCount = 0;
      for (auto i = 0u; i < r.instanceCount; ++i) {
        const auto at = u(8) + (r.firstInstance + i) * schema::kInstanceWords;
        auto &node = instances_.data()[r.firstInstance + i];
        node = {u(at), u(at + 1), u(at + 2), u(at + 3), u(at + 4), u(at + 5)};
        if (node.kind > 30u || !validIndex(node.kind, node.authoredIndex) || node.flags ||
            node.firstParameter != localParameter ||
            node.parameterCount > r.parameterCount - localParameter)
          return ET_ERR_ARGS;
        if (!(supportedKinds & (1u << node.kind)))
          return ET_ERR_UNSUPPORTED;
        if (node.kind == static_cast<std::uint32_t>(schema::Kind::Variable)) {
          std::construct_at(&generators_.data()[r.firstInstance + i].parameters.variable);
          r.variableFlags |= 1u;
        }
        generators_.data()[r.firstInstance + i].constant =
            (node.kind >= 1u && node.kind <= 3u) || modulation::isLfo(node.kind);
        std::uint32_t requiredParameters = 0;
        for (const auto &spec : schema::kProperties)
          if (static_cast<std::uint32_t>(spec.kind) == node.kind)
            ++requiredParameters;
        if (node.parameterCount != requiredParameters)
          return ET_ERR_ARGS;
        if (i == 0u ? node.kind != 0u || node.authoredIndex != 0u || node.parent != UINT32_MAX
                    : node.kind == 0u)
          return ET_ERR_ARGS;
        if (node.kind == 5u || node.kind == 10u || node.kind == 11u || node.kind == 16u) {
          if (node.parent >= i)
            return ET_ERR_ARGS;
          const auto parent = instances_.data()[r.firstInstance + node.parent].kind;
          if (node.kind == 5u ? parent != 4u : node.kind == 16u ? parent != 15u : parent != 9u)
            return ET_ERR_ARGS;
          if (node.kind == 10u && (node.authoredIndex < 2u || node.authoredIndex > 8u))
            return ET_ERR_ARGS;
          if (node.kind == 10u)
            generators_.data()[r.firstInstance + node.parent].hasSuboscillators = true;
        } else if (node.parent != UINT32_MAX)
          return ET_ERR_ARGS;
        if ((node.kind == 4u || node.kind == 9u) && node.authoredIndex == 0u)
          return ET_ERR_ARGS;
        if (node.kind == 12u) {
          if (node.authoredIndex < 1u || node.authoredIndex > 2u ||
              r.filters[node.authoredIndex - 1u] != UINT32_MAX)
            return ET_ERR_ARGS;
          r.filters[node.authoredIndex - 1u] = i;
        }
        if (node.kind == 13u) {
          r.sourceInstance = i;
          hasSource = true;
        }
        if (node.kind == 21u)
          r.amplifierInstance = i;
        if (node.kind == 17u) {
          r.voiceDspInstance = i;
          hasVoiceDsp = true;
        }
        if (node.kind == 18u) {
          r.noiseInstance = i;
          hasNoise = true;
        }
        if (node.kind == 27u)
          r.tempoInstance = i;
        if (node.kind == 28u)
          r.timerInstance = i;
        if (node.kind == 29u)
          r.equalizers[node.authoredIndex - 1u] = i;
        if (node.kind >= 24u && node.kind <= 26u)
          ++conditionCounts[node.kind - 24u];
        auto previousProperty = UINT32_MAX;
        for (auto p = 0u; p < node.parameterCount; ++p) {
          const auto index = r.firstParameter + node.firstParameter + p,
                     atParameter = u(10) + index * schema::kParameterWords;
          auto &parameter = parameters_.data()[index];
          parameter = {u(atParameter), u(atParameter + 1), data[atParameter + 2],
                       u(atParameter + 3)};
          const auto *spec = modulation::propertySpec(node.kind, parameter.property);
          specs_.data()[index] = spec;
          if (parameter.instance != i || !spec || (p && parameter.property <= previousProperty))
            return ET_ERR_ARGS;
          double exact = parameter.base;
          if (spec->storage != schema::Storage::Float) {
            const auto low = u(atParameter + 2), high = u(atParameter + 3);
            if ((spec->storage == schema::Storage::UInt32 && high) || high > 1u || (high && low))
              return ET_ERR_ARGS;
            const auto value =
                static_cast<std::uint64_t>(low) | (static_cast<std::uint64_t>(high) << 32);
            integer_bases_.data()[index] = value;
            exact = static_cast<double>(value);
            parameter.base = 0;
            parameter.combine = spec->combine;
          } else if (parameter.combine != spec->combine)
            return ET_ERR_ARGS;
          if (!std::isfinite(exact) || exact < spec->minimum || exact > spec->maximum ||
              (spec->integer && std::floor(exact) != exact))
            return ET_ERR_ARGS;
          previousProperty = parameter.property;
          // Later pitch/control additions stay closed until their ingress is connected.
          if (!(supportsProperty ? supportsProperty(node.kind, parameter.property)
                                 : node.kind != 0u || supportsRegionProperty(parameter.property)) &&
              exact != spec->defaultValue)
            return ET_ERR_UNSUPPORTED;
          if (node.kind == 0u)
            for (auto slot = 0u; slot < ModulationRegion::kRegionProperties.size(); ++slot)
              if (parameter.property ==
                  static_cast<std::uint32_t>(ModulationRegion::kRegionProperties[slot]))
                r.regionParameters[slot] = node.firstParameter + p;
          if (node.kind == 12u)
            for (auto slot = 0u; slot < ModulationRegion::kFilterProperties.size(); ++slot)
              if (parameter.property ==
                  static_cast<std::uint32_t>(ModulationRegion::kFilterProperties[slot]))
                r.filterParameters[node.authoredIndex - 1u][slot] = node.firstParameter + p;
          if (parameter.property == static_cast<std::uint32_t>(schema::Property::Wave) &&
              parameter.base >= 8 && parameter.base <= 11)
            return ET_ERR_ARGS;
          if (parameter.property == static_cast<std::uint32_t>(schema::Property::Curve) &&
              !validCurve(static_cast<std::uint32_t>(parameter.base)))
            return ET_ERR_ARGS;
          if (node.kind == 12u &&
              parameter.property == static_cast<std::uint32_t>(schema::Property::FilterType) &&
              parameter.base == static_cast<float>(schema::FilterType::comb))
            r.combMask |= 1u << (node.authoredIndex - 1u);
          if (node.kind == 18u &&
              parameter.property == static_cast<std::uint32_t>(schema::Property::NoiseFilter) &&
              parameter.base == static_cast<float>(schema::FilterType::comb))
            r.combMask |= 4u;
        }
        const auto base = [&](schema::Property property) {
          const auto rank = schema::parameterRank(node.kind, static_cast<std::uint32_t>(property));
          return rank < node.parameterCount
                     ? parameters_.data()[r.firstParameter + node.firstParameter + rank].base
                     : 0;
        };
        using P = schema::Property;
        if (node.kind == 0u) {
          r.noteEnabled = base(P::NoteEnabled) != 0;
          r.silentAction = base(P::SilentAction) != 0;
          const auto note = static_cast<std::int32_t>(base(P::NoteOffset));
          const auto sw = static_cast<std::int32_t>(base(P::SwitchOffset));
          if (n == 0) {
            note_offset_ = note;
            switch_offset_ = sw;
          } else if (note != note_offset_ || sw != switch_offset_)
            return ET_ERR_ARGS;
        }
        if (node.kind == 19u) {
          const auto value = base(P::InitialValue);
          if (n == 0) {
            if (!initial_cc_.size()) {
              footprint += 128u * sizeof(float);
              if (footprint > budget)
                return ET_ERR_ARGS;
              if (!initial_cc_.allocate(128))
                return ET_ERR_OOM;
              std::fill_n(initial_cc_.data(), 128, -1.F);
            }
            initial_cc_.data()[node.authoredIndex] = value;
          } else if (initialController(node.authoredIndex) != value)
            return ET_ERR_ARGS;
          ++regionInitialCount;
        }
        if (node.kind == 15u) {
          const auto curve = base(P::OffCurve);
          if (curve != -2 && curve != -1 && curve != 0 && curve != 1 && curve != 2 && curve != 10)
            return ET_ERR_ARGS;
        }
        if (node.kind == 20u && base(P::ReverseLow) > base(P::ReverseHigh))
          return ET_ERR_ARGS;
        if (node.kind == 23u &&
            (base(P::InLow) > base(P::InHigh) || base(P::OutLow) > base(P::OutHigh)))
          return ET_ERR_ARGS;
        if (node.kind >= 24u && node.kind <= 26u) {
          const auto low = base(P::ConditionLow), high = base(P::ConditionHigh);
          if ((low < 0 && low != -1) || (high < 0 && high != -1) ||
              (low >= 0 && high >= 0 && low > high))
            return ET_ERR_ARGS;
        }
        if (node.kind == 27u && base(P::BpmLow) > base(P::BpmHigh))
          return ET_ERR_ARGS;
        if (node.kind == 28u && base(P::TimerLow) > base(P::TimerHigh))
          return ET_ERR_ARGS;
        localParameter += node.parameterCount;
      }
      if (n == 0)
        initialControllerCount = regionInitialCount;
      else if (regionInitialCount != initialControllerCount)
        return ET_ERR_ARGS;
      if (localParameter != r.parameterCount)
        return ET_ERR_ARGS;
      auto *identities = indices_.data() + r.firstInstance;
      for (auto i = 0u; i < r.instanceCount; ++i)
        identities[i] = i;
      const auto identity = [&](std::uint32_t index) {
        const auto &node = instances_.data()[r.firstInstance + index];
        return std::array{node.kind, node.authoredIndex, node.parent};
      };
      std::sort(identities, identities + r.instanceCount,
                [&](auto a, auto b) { return identity(a) < identity(b); });
      for (auto i = 1u; i < r.instanceCount; ++i)
        if (identity(identities[i - 1u]) == identity(identities[i]))
          return ET_ERR_ARGS;
      auto conditionFirst = r.firstInstance;
      for (auto kind = 24u; kind <= 26u; ++kind) {
        auto at = conditionFirst;
        for (auto i = 0u; i < r.instanceCount; ++i)
          if (instances_.data()[r.firstInstance + i].kind == kind)
            condition_indices_.data()[at++] = i;
        r.conditions[kind - 24u] =
            conditionCounts[kind - 24u]
                ? std::span<const std::uint32_t>(condition_indices_.data() + conditionFirst,
                                                 conditionCounts[kind - 24u])
                : std::span<const std::uint32_t>{};
        conditionFirst = at;
      }
      for (auto i = 0u; i < r.instanceCount; ++i) {
        const auto &node = instances_.data()[r.firstInstance + i];
        if (node.kind == static_cast<std::uint32_t>(schema::Kind::Variable)) {
          const auto base = parameters_.data()[r.firstParameter + node.firstParameter].base;
          if (base != 0.0F && base != 1.0F)
            return ET_ERR_ARGS;
        }
      }
      for (auto i = 0u; i < r.routeCount; ++i) {
        const auto at = u(6) + (r.firstRoute + i) * schema::kRouteWords;
        auto &route = routes_.data()[r.firstRoute + i];
        route = {u(at),     u(at + 1),    u(at + 2),    data[at + 3], u(at + 4),
                 u(at + 5), data[at + 6], data[at + 7], u(at + 8),    u(at + 9)};
        if (route.target >= r.parameterCount || !validSource(route.sourceA, r) ||
            !validSource(route.sourceB, r) ||
            (!(route.flags & static_cast<std::uint32_t>(schema::RouteFlag::IntegerDepth)) &&
             !std::isfinite(route.depth)) ||
            !validCurve(route.curveA) || !validCurve(route.curveB) ||
            !std::isfinite(route.smoothMs) || route.smoothMs < 0 || !std::isfinite(route.step) ||
            route.step < 0 || (route.flags & ~63u) || route.transform != 0u)
          return ET_ERR_ARGS;
        const auto &target = parameters_.data()[r.firstParameter + route.target];
        const auto targetKind = instances_.data()[r.firstInstance + target.instance].kind;
        if (targetKind >= 22u && targetKind <= 29u)
          return ET_ERR_ARGS;
        if (targetKind == static_cast<std::uint32_t>(schema::Kind::Variable)) {
          if (target.property != static_cast<std::uint32_t>(schema::Property::VariableValue) ||
              (route.sourceA & 0xffff0000u) != 0x10000u || route.sourceB || route.curveB ||
              route.smoothMs != 0.0F || route.step != 0.0F || route.depth < 0.0F ||
              route.depth > 1.0F || route.flags > 1u ||
              (route.flags == 1u) != (target.base == 1.0F))
            return ET_ERR_ARGS;
          auto &inputs = generators_.data()[r.firstInstance + target.instance].parameters.variable;
          if (!inputs.count)
            inputs.firstRoute = i;
          // New variable wire invariant: a group's input order is preserved,
          // and its routes must be contiguous even for caller-supplied blobs.
          if (i != inputs.firstRoute + inputs.count)
            return ET_ERR_ARGS;
          ++inputs.count;
          inputs.continuous |= modulation::continuousVariableController(route.sourceA & 65535u);
          if (inputs.continuous)
            r.variableFlags |= 2u;
        } else if (((route.sourceA & 0xffff0000u) == 0x60000u ||
                    (route.sourceB & 0xffff0000u) == 0x60000u) &&
                   !modulation::isPhysical(targetKind))
          return ET_ERR_ARGS;
        if (!(supportsProperty ? supportsProperty(targetKind, target.property)
                               : targetKind != 0u || supportsRegionProperty(target.property)))
          return ET_ERR_UNSUPPORTED;
        if (route.flags & static_cast<std::uint32_t>(schema::RouteFlag::IntegerDepth)) {
          const auto low = u(at + 3),
                     high =
                         (route.flags & static_cast<std::uint32_t>(schema::RouteFlag::IntegerHigh))
                             ? 1u
                             : 0u;
          if (targetKind != static_cast<std::uint32_t>(schema::Kind::SamplePlayback) ||
              (target.property != static_cast<std::uint32_t>(schema::Property::DelaySamples) &&
               target.property != static_cast<std::uint32_t>(schema::Property::Offset)) ||
              route.sourceA < 0x10000u || route.sourceA > 0x1007fu || route.sourceB ||
              route.curveB || (route.flags & 5u) || (high && low))
            return ET_ERR_ARGS;
          if (target.property == static_cast<std::uint32_t>(schema::Property::Offset)) {
            const auto &node = instances_.data()[r.firstInstance + target.instance];
            const auto rank = schema::parameterRank(
                node.kind, static_cast<std::uint32_t>(schema::Property::OffsetMode));
            if (parameters_.data()[r.firstParameter + node.firstParameter + rank].base != 0)
              return ET_ERR_ARGS;
          }
          double depth = static_cast<double>(low) + static_cast<double>(high) * 4294967296.0;
          if (route.flags & static_cast<std::uint32_t>(schema::RouteFlag::IntegerNegative))
            depth = -depth;
          integer_depths_.data()[r.firstRoute + i] = depth;
          route.depth = 0;
        } else if (route.flags & (static_cast<std::uint32_t>(schema::RouteFlag::IntegerHigh) |
                                  static_cast<std::uint32_t>(schema::RouteFlag::IntegerNegative)))
          return ET_ERR_ARGS;
        dynamic_parameters_.data()[r.firstParameter + route.target] = 1;
        generators_.data()[r.firstInstance + target.instance].constant = false;
        if (!modulation::isPhysical(targetKind) &&
            targetKind != static_cast<std::uint32_t>(schema::Kind::Variable))
          r.hasGeneratorRoutes = true;
      }
      for (auto i = 0u; i < r.parameterCount; ++i)
        if (dynamic_parameters_.data()[r.firstParameter + i] &&
            specs_.data()[r.firstParameter + i]->sampling != schema::Sampling::Birth)
          dynamic_parameters_.data()[r.firstParameter + r.dynamicParameterCount++] = i;
      auto view = region(n);
      if (!modulation::prepareLayout(view, {indices_.data() + r.firstInstance, r.instanceCount},
                                     r.layout))
        return ET_ERR_ARGS;
      maximum.envelopes = std::max(maximum.envelopes, r.layout.envelopes);
      maximum.lfos = std::max(maximum.lfos, r.layout.lfos);
      maximum.ramps = std::max(maximum.ramps, r.layout.ramps);
      maximum.parameters = std::max(maximum.parameters, r.layout.parameters);
      maximum.sources = std::max(maximum.sources, r.layout.sources);
      combMask |= r.combMask;
      nextRoute += r.routeCount;
      nextInstance += r.instanceCount;
      nextParameter += r.parameterCount;
    }
    if (nextRoute != routeCount || nextInstance != instanceCount || nextParameter != parameterCount)
      return ET_ERR_ARGS;
    std::uint32_t playbackCount = 0, segmentCount = 0, reverseCount = 0;
    bool hasPlaybackState = false;
    for (auto n = 0u; n < regionCount; ++n) {
      auto &r = regions_.data()[n];
      bool hasPlayback = false;
      for (const auto &node : region(n).instances) {
        if (node.kind == 14u || node.kind == 15u || node.kind == 16u || node.kind == 20u)
          hasPlayback = true;
        if (node.kind == 16u)
          ++segmentCount;
        if (node.kind == 20u)
          ++reverseCount;
        if (node.kind == 14u)
          hasPlaybackState = true;
      }
      if (hasPlayback)
        r.playback = playbackCount++;
    }
    footprint += static_cast<std::uint64_t>(playbackCount) * sizeof(playback::PreparedPlayback) +
                 static_cast<std::uint64_t>(segmentCount) * sizeof(playback::PreparedDecaySegment) +
                 static_cast<std::uint64_t>(reverseCount) * sizeof(playback::ReverseCondition);
    const std::uint64_t extraState = (hasSource ? schema::kStorageOscillatorStateBytes : 0u) +
                                     (hasVoiceDsp ? schema::kStorageVoiceDspStateBytes : 0u) +
                                     (hasNoise ? schema::kStorageNoiseStateBytes : 0u) +
                                     (hasPlaybackState ? schema::kStoragePlaybackStateBytes : 0u);
    const auto perVoice =
        static_cast<std::uint64_t>(maximum.envelopes) * sizeof(modulation::EnvelopeState) +
        static_cast<std::uint64_t>(maximum.lfos) * sizeof(modulation::LfoState) +
        static_cast<std::uint64_t>(maximum.ramps) * sizeof(modulation::RampState) +
        static_cast<std::uint64_t>(maximum.parameters + maximum.sources) * sizeof(float) +
        sizeof(modulation::BornFacts) + extraState;
    footprint += (2ull * voices + 1u) * perVoice;
    if (footprint > budget)
      return ET_ERR_ARGS;
    if (!playbacks_.allocate(playbackCount) || !decay_segments_.allocate(segmentCount) ||
        !reverse_conditions_.allocate(reverseCount))
      return ET_ERR_OOM;
    std::uint32_t segmentFirst = 0, reverseFirst = 0;
    for (auto n = 0u; n < regionCount; ++n) {
      const auto &r = regions_.data()[n];
      if (r.playback == UINT32_MAX)
        continue;
      std::uint32_t segments = 0, reverse = 0;
      const auto view = region(n);
      for (const auto &node : view.instances) {
        if (node.kind == 16u)
          ++segments;
        if (node.kind == 20u)
          ++reverse;
      }
      playbacks_.data()[r.playback] = playback::prepareSettings(
          view, [&](std::uint32_t p) { return integerBase(n, p); },
          segments ? std::span<playback::PreparedDecaySegment>(
                         decay_segments_.data() + segmentFirst, segments)
                   : std::span<playback::PreparedDecaySegment>{},
          reverse ? std::span<playback::ReverseCondition>(reverse_conditions_.data() + reverseFirst,
                                                          reverse)
                  : std::span<playback::ReverseCondition>{});
      if (!playbacks_.data()[r.playback].valid)
        return ET_ERR_ARGS;
      segmentFirst += segments;
      reverseFirst += reverse;
    }
    return ET_OK;
  }

private:
  static bool validIndex(std::uint32_t kind, std::uint32_t index) noexcept {
    if (kind > 30u)
      return false;
    if (kind == 30u)
      return index >= 1u && index <= 65535u;
    if (kind == 4u || kind == 9u || kind == 5u || kind == 11u)
      return index <= 65535u;
    if (kind == 10u)
      return index >= 2u && index <= 8u;
    if (kind == 12u)
      return index >= 1u && index <= 2u;
    if (kind == 16u)
      return true;
    if (kind == 19u || kind == 20u || kind == 22u || (kind >= 24u && kind <= 26u))
      return index <= 127u;
    if (kind == 23u)
      return index <= 129u;
    if (kind == 29u)
      return index >= 1u && index <= 3u;
    return index == 0u;
  }
  static bool supportsRegionProperty(std::uint32_t property) noexcept {
    using P = schema::Property;
    return property <= static_cast<std::uint32_t>(P::BendStepDown) ||
           property == static_cast<std::uint32_t>(P::ScopeTune) ||
           property == static_cast<std::uint32_t>(P::ScopeVolume) ||
           property == static_cast<std::uint32_t>(P::ScopeAmplitude);
  }
  template <class T>
  static std::span<const T> span(const NothrowStorage<T> &storage, std::uint32_t first,
                                 std::uint32_t count) noexcept {
    return count ? std::span<const T>(storage.data() + first, count) : std::span<const T>{};
  }
  bool validCurve(std::uint32_t id) const noexcept {
    if (id <= 3u)
      return true;
    for (std::size_t i = 0; i < curves_.size(); ++i)
      if (curves_.data()[i].id == id)
        return true;
    return false;
  }
  bool validSource(std::uint32_t id, const ModulationRegion &region) const noexcept {
    if (!id)
      return true;
    const auto type = id & 0xffff0000u, index = id & 65535u;
    if (type == 0x10000u)
      return index <= 137u || (index >= 140u && index <= 155u);
    if (type == 0x50000u)
      return index <= 2u;
    if (index >= region.instanceCount)
      return false;
    const auto kind = instances_.data()[region.firstInstance + index].kind;
    if (type == 0x60000u)
      return kind == static_cast<std::uint32_t>(schema::Kind::Variable);
    return type == 0x30000u ? modulation::isEnvelope(kind)
                            : type == 0x40000u && modulation::isLfo(kind);
  }
  NothrowStorage<modulation::Instance> instances_;
  NothrowStorage<modulation::Parameter> parameters_;
  NothrowStorage<modulation::Route> routes_;
  NothrowStorage<modulation::Curve> curves_;
  NothrowStorage<modulation::PreparedGenerator> generators_;
  NothrowStorage<std::uint32_t> indices_, dynamic_parameters_, condition_indices_;
  NothrowStorage<const schema::PropertySpec *> specs_;
  NothrowStorage<ModulationRegion> regions_;
  std::int32_t note_offset_ = 0, switch_offset_ = 0;
  NothrowStorage<float> initial_cc_;
  NothrowStorage<std::uint64_t> integer_bases_;
  NothrowStorage<double> integer_depths_;
  NothrowStorage<playback::PreparedPlayback> playbacks_;
  NothrowStorage<playback::PreparedDecaySegment> decay_segments_;
  NothrowStorage<playback::ReverseCondition> reverse_conditions_;
};
static_assert(sizeof(modulation::EnvelopeState) <= schema::kStorageEnvelopeStateBytes);
static_assert(sizeof(modulation::LfoState) <= schema::kStorageLfoStateBytes);
static_assert(sizeof(modulation::RampState) <= schema::kStorageRouteStateBytes);
static_assert(sizeof(modulation::BornFacts) <= schema::kStorageBornFactsBytes);
static_assert(sizeof(modulation::PreparedGenerator) <= schema::kStorageGeneratorParametersBytes);
static_assert(sizeof(ModulationRegion) <= schema::kStorageRegionPlanBytes);
static_assert(sizeof(VoiceDsp) <= schema::kStorageVoiceDspStateBytes);
static_assert(sizeof(NoiseLayer) <= schema::kStorageNoiseStateBytes);
static_assert(sizeof(std::uint64_t) <= schema::kStorageIntegerBaseBytes);
static_assert(sizeof(double) <= schema::kStorageIntegerDepthBytes);
static_assert(sizeof(playback::PreparedPlayback) <= schema::kStoragePlaybackPlanBytes);
static_assert(sizeof(playback::PreparedDecaySegment) <= schema::kStorageReleaseSegmentBytes);
static_assert(sizeof(playback::ReverseCondition) <= schema::kStorageReverseConditionBytes);
static_assert(sizeof(const schema::PropertySpec *) <= schema::kStoragePropertyPointerBytes);
} // namespace effetune::plugins::others::sfz
#endif

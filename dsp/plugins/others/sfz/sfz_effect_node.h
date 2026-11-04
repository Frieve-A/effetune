#ifndef EFFETUNE_SFZ_EFFECT_NODE_H
#define EFFETUNE_SFZ_EFFECT_NODE_H
#include "sfz_effect_activity.h"
#include "sfz_effect_controls.h"
#include "sfz_effect_convolver.h"
#include "sfz_effect_delay.h"
#include "sfz_effect_distortion.h"
#include "sfz_effect_dynamics.h"
#include "sfz_effect_equalizer.h"
#include "sfz_effect_lofi.h"
#include "sfz_effect_pan.h"
#include "sfz_effect_phaser.h"
#include "sfz_effect_rectifier.h"
#include "sfz_effect_reverb.h"
#include "sfz_effect_static.h"
#include "sfz_effect_strings.h"

namespace effetune::plugins::others::sfz {
class EffectNode {
public:
  struct DelayBounds {
    double seconds = 0, beats = 0, extra = 0;
    [[nodiscard]] double at(float bpm) const noexcept {
      return std::max(seconds, beats * 60 / effectPhysicalTempo(bpm)) + extra;
    }
  };
  static DelayBounds delayBounds(const EffectPlan &plan, unsigned index) noexcept {
    const auto node = plan.node(index);
    std::array<float, fxschema::kParameters.size()> upper{};
    for (auto parameter = 0u; parameter < node[3]; ++parameter)
      upper[parameter] = plan.parameter(node, parameter);
    const auto routes = plan.routes(node);
    const auto &spec = fxschema::kTypes[node[0] - 1];
    for (auto route = 0u; route < routes.size(); route += fxschema::kRouteWords) {
      const auto parameter = routes[route];
      upper[parameter] = fxschema::kParameters[spec.firstParameter + parameter].maximum;
    }
    const auto parameter = [&](fxschema::Parameter name) {
      return upper[static_cast<unsigned>(name)];
    };
    using P = fxschema::Parameter;
    const std::array<double, 3> time{parameter(P::delay_timel), parameter(P::delay_timec),
                                     parameter(P::delay_timer)};
    const std::array<double, 3> sync{parameter(P::delay_syncl), parameter(P::delay_syncc),
                                     parameter(P::delay_syncr)};
    DelayBounds result;
    for (auto tap = 0u; tap < time.size(); ++tap) {
      result.seconds = std::max(result.seconds, time[tap]);
      result.beats = std::max(result.beats, sync[tap]);
    }
    result.extra = 2 * parameter(P::delay_time_tap) + .0003 * parameter(P::delay_moddepth);
    return result;
  }
  static double delaySeconds(const EffectPlan &plan, unsigned index,
                             float minimumTempoBpm) noexcept {
    return !std::isfinite(minimumTempoBpm) || minimumTempoBpm < 0
               ? -1
               : delayBounds(plan, index).at(effectPreparationTempo(minimumTempoBpm));
  }
  bool prepare(const EffectPlan &plan, unsigned index, const PrepareInfo &info, std::uint64_t seed,
               double maximumDelaySeconds, std::span<const float> impulse = {},
               unsigned impulseChannels = 0, unsigned impulseFrames = 0, float minimumTempoBpm = 1,
               std::size_t convolutionBudget = std::numeric_limits<std::size_t>::max()) {
    const auto node = plan.node(index);
    type_ = static_cast<fxschema::Type>(node[0]);
    rate_ = info.sampleRate;
    if (!controls_.prepare(plan, index) || !std::isfinite(rate_) || rate_ <= 0)
      return false;
    quietFrames_ = static_cast<std::uint64_t>(std::ceil(rate_ * kEffectQuietSeconds));
    usesTempo_ = false;
    switch (type_) {
    case fxschema::Type::delay: {
      if (!std::isfinite(minimumTempoBpm) || minimumTempoBpm < 0)
        return false;
      delayBounds_ = delayBounds(plan, index);
      preparedDelayFrames_ = EffectDelay::storageFrames(rate_, maximumDelaySeconds);
      for (const auto parameter :
           {fxschema::Parameter::delay_syncl, fxschema::Parameter::delay_syncc,
            fxschema::Parameter::delay_syncr}) {
        const auto id = static_cast<unsigned>(parameter);
        usesTempo_ |= plan.parameter(node, id) > 0;
        const auto routes = plan.routes(node);
        for (auto route = 0u; route < routes.size(); route += fxschema::kRouteWords)
          usesTempo_ |= routes[route] == id;
      }
      if (!delay_.prepare(rate_, maximumDelaySeconds))
        return false;
      if (delaySeconds(plan, index, minimumTempoBpm) > maximumDelaySeconds)
        return false;
      quietFrames_ = static_cast<std::uint64_t>(std::ceil(rate_ * maximumDelaySeconds));
      break;
    }
    case fxschema::Type::filter:
      if (!comb_.allocate(2u * VoiceFilter::maximumCombFrames(rate_)))
        return false;
      break;
    case fxschema::Type::fverb:
      quietFrames_ = static_cast<std::uint64_t>(std::ceil(rate_ * 1.2));
      if (!reverb_.prepare(info))
        return false;
      break;
    case fxschema::Type::chorus:
      if (!chorus_.prepare(info))
        return false;
      break;
    case fxschema::Type::staticNoise:
      if (!static_.prepare(rate_, seed))
        return false;
      break;
    case fxschema::Type::strings:
      if (!strings_.prepare(rate_, static_cast<unsigned>(plan.parameter(node, 0))))
        return false;
      break;
    case fxschema::Type::tdfir:
      quietFrames_ = impulseFrames;
      if (!convolver_.prepare(impulse, impulseChannels, impulseFrames, convolutionBudget))
        return false;
      break;
    default:
      break;
    }
    reset();
    return true;
  }
  void reset() noexcept {
    controls_.reset();
    pan_.reset(0);
    dynamics_.reset();
    delay_.reset();
    distortion_.reset();
    rectifier_.reset();
    equalizer_.reset();
    filter_.reset();
    comb_.clear();
    reverb_.reset();
    chorus_.reset();
    lofi_.reset();
    phaser_.reset();
    static_.reset();
    strings_.reset();
    convolver_.reset();
    generates_ = false;
    active_ = false;
    quietElapsed_ = 0;
  }
  void process(float &left, float &right, const modulation::SourceFrame &sources,
               std::span<const modulation::Curve> curves, const ProcessInfo &info) noexcept {
    const bool input = left != 0 || right != 0;
    const auto values = controls_.resolve(sources, curves, rate_);
    if (controls_.bypassed(sources)) {
      generates_ = false;
      observeActivity(input, left, right);
      return;
    }
    const auto value = [&](fxschema::Parameter parameter) {
      return values[static_cast<unsigned>(parameter)];
    };
    const auto percent = [&](fxschema::Parameter parameter) { return value(parameter) * .01F; };
    using P = fxschema::Parameter;
    switch (type_) {
    case fxschema::Type::apan:
      pan_.process(left, right, rate_, value(P::apan_freq), value(P::apan_phase),
                   static_cast<int>(value(P::apan_waveform)), percent(P::apan_depth),
                   percent(P::apan_dry), percent(P::apan_wet));
      break;
    case fxschema::Type::comp:
      dynamics_.configure(rate_, value(P::comp_attack), value(P::comp_release));
      dynamics_.compress(left, right, value(P::comp_threshold), value(P::comp_ratio),
                         value(P::comp_gain), value(P::comp_stlink) != 0);
      break;
    case fxschema::Type::gate:
      dynamics_.configure(rate_, value(P::gate_attack), value(P::gate_release),
                          value(P::gate_hold));
      dynamics_.gate(left, right, value(P::gate_threshold), percent(P::gate),
                     value(P::gate_stlink) != 0);
      break;
    case fxschema::Type::limiter:
      EffectDynamics::limit(left, right);
      break;
    case fxschema::Type::disto:
      distortion_.process(left, right, rate_, percent(P::disto_depth),
                          static_cast<unsigned>(value(P::disto_stages)), percent(P::disto_tone),
                          percent(P::disto_dry), percent(P::disto_wet));
      break;
    case fxschema::Type::gain: {
      const float gain = std::pow(10.0F, value(P::gain) * .05F);
      left *= gain;
      right *= gain;
      break;
    }
    case fxschema::Type::rectify:
      rectifier_.process(left, right, percent(P::rectify), value(P::rectify_mode) != 0);
      break;
    case fxschema::Type::lofi:
      lofi_.process(left, right, percent(P::bitred), percent(P::decim));
      break;
    case fxschema::Type::eq:
      equalizer_.process(left, right, rate_, value(P::eq_freq), value(P::eq_bw), value(P::eq_gain),
                         static_cast<unsigned>(value(P::eq_type)));
      break;
    case fxschema::Type::filter:
      filter_.configure(static_cast<unsigned>(value(P::filter_type)), value(P::filter_cutoff),
                        value(P::filter_resonance), value(P::filter_gain), rate_);
      filter_.process(left, right, {comb_.data(), comb_.size()});
      break;
    case fxschema::Type::fverb:
      reverb_.process(left, right,
                      {percent(P::reverb_damp), percent(P::reverb_dry), percent(P::reverb_input),
                       value(P::reverb_predelay), percent(P::reverb_size), percent(P::reverb_tone),
                       percent(P::reverb_wet), static_cast<unsigned>(value(P::reverb_type))},
                      info);
      break;
    case fxschema::Type::chorus:
      chorus_.process(left, right, info);
      break;
    case fxschema::Type::phaser:
      phaser_.process(left, right, rate_, value(P::phaser_freq), value(P::phaser_phase) * 3.6F,
                      static_cast<int>(value(P::phaser_waveform)),
                      static_cast<unsigned>(value(P::phaser_stages)), percent(P::phaser_depth),
                      percent(P::phaser_feedback), percent(P::phaser_wet));
      break;
    case fxschema::Type::strings:
      strings_.process(left, right, percent(P::strings_wet));
      break;
    case fxschema::Type::tdfir:
      convolver_.process(left, right, percent(P::tdfir_dry), percent(P::tdfir_wet),
                         percent(P::tdfir_gain));
      break;
    case fxschema::Type::staticNoise: {
      const EffectStaticParameters p{
          percent(P::static_cyclic_level), value(P::static_cyclic_time),
          percent(P::static_level),        percent(P::static_random_level),
          value(P::static_random_maxtime), value(P::static_random_mintime),
          percent(P::static_tone),         static_cast<unsigned>(value(P::static_filter)),
          value(P::static_stereo) != 0};
      static_.process(left, right, p);
      generates_ = EffectStatic::generates(p);
      break;
    }
    case fxschema::Type::delay: {
      EffectDelayParameters p;
      p.cutoff = value(P::delay_cutoff);
      p.dampHigh = percent(P::delay_damphi);
      p.dampLow = percent(P::delay_damplo);
      p.dry = percent(P::delay_dry);
      p.feedback = percent(P::delay_feedback);
      p.input = percent(P::delay_input);
      p.filter = static_cast<unsigned>(value(P::delay_filter));
      p.mode = static_cast<unsigned>(value(P::delay_mode));
      p.level = {percent(P::delay_levell), percent(P::delay_levelc), percent(P::delay_levelr)};
      p.pan = {percent(P::delay_panl), percent(P::delay_panc), percent(P::delay_panr)};
      p.sync = {value(P::delay_syncl), value(P::delay_syncc), value(P::delay_syncr)};
      p.time = {value(P::delay_timel), value(P::delay_timec), value(P::delay_timer)};
      p.lfoFrequency = value(P::delay_lfofreq);
      p.modDepth = percent(P::delay_moddepth);
      p.resonance = value(P::delay_resonance);
      p.spread = percent(P::delay_spread);
      p.tapTime = value(P::delay_time_tap);
      p.wet = percent(P::delay_wet);
      const float bpm = sources.values.size() > 142 ? sources.values[142] : 0;
      delay_.process(left, right, p, bpm);
      break;
    }
    }
    observeActivity(input, left, right);
  }
  [[nodiscard]] std::uint64_t minimumQuietFrames() const noexcept { return quietFrames_; }
  [[nodiscard]] bool active() const noexcept { return active_; }
  [[nodiscard]] bool generates() const noexcept { return generates_; }
  [[nodiscard]] std::size_t convolutionBytes() const noexcept { return convolver_.memoryBytes(); }
  [[nodiscard]] bool acceptsTempo(float bpm) const noexcept {
    if (!usesTempo_)
      return true;
    if (!std::isfinite(bpm) || bpm < 0)
      return false;
    const auto required =
        EffectDelay::storageFrames(rate_, std::max(1.0 / rate_, delayBounds_.at(bpm)));
    return required && required <= preparedDelayFrames_;
  }

private:
  void observeActivity(bool input, float left, float right) noexcept {
    const bool audible =
        input || generates_ || effectOutputAudible(left) || effectOutputAudible(right);
    if (!active_ && !audible)
      return;
    quietElapsed_ = audible ? 0 : quietElapsed_ + 1;
    active_ = audible || quietElapsed_ < quietFrames_;
  }
  EffectControls controls_;
  EffectPan pan_;
  EffectDynamics dynamics_;
  EffectDelay delay_;
  EffectDistortion distortion_;
  EffectRectifier rectifier_;
  EffectEqualizer equalizer_;
  VoiceFilter filter_;
  NothrowStorage<float> comb_;
  EffectReverb reverb_;
  EffectChorus chorus_;
  EffectLofi lofi_;
  EffectPhaser phaser_;
  EffectStatic static_;
  EffectStrings strings_;
  EffectConvolver convolver_;
  fxschema::Type type_ = fxschema::Type::limiter;
  DelayBounds delayBounds_{};
  std::uint32_t preparedDelayFrames_ = 0;
  float rate_ = 0;
  std::uint64_t quietFrames_ = 0, quietElapsed_ = 0;
  bool generates_ = false, usesTempo_ = false, active_ = false;
};
} // namespace effetune::plugins::others::sfz
#endif

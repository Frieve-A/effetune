#ifndef EFFETUNE_SF2_PROFILE_H
#define EFFETUNE_SF2_PROFILE_H
#include "effetune/dsp/denormal.h"
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <span>

namespace effetune::plugins::others::sfz::sf2 {
// Independently implemented from Creative/E-mu SoundFont 2.04 sections 8 and 9.
constexpr std::uint32_t kGeneratorCount = 61, kRouteWords = 10;
inline float clamp(float value, float low, float high) noexcept {
  return value < low ? low : value > high ? high : value;
}
struct Inputs {
  const std::uint8_t *cc = nullptr;
  std::uint32_t key = 60, velocity = 127, polyPressure = 0, channelPressure = 0;
  int bend = 0;
  float bendRangeSemitones = 2.0F;
  // Follows the SoundFont 2.04 text literally instead of the E-mu hardware
  // behavior that common synthesizers emulate and banks are authored for.
  bool strictSpec = false;
};
struct RouteSpan {
  const float *words = nullptr;
  std::uint32_t count = 0;
};
struct EnvelopeParameters {
  float delay = 0, attack = 0, hold = 0, decay = 0, sustain = 0, release = 0;
};
struct LfoParameters {
  float delay = 0, frequency = 0;
};
struct Resolved {
  std::array<float, kGeneratorCount> generators{};
  EnvelopeParameters volEnv{}, modEnv{};
  LfoParameters modLfo{}, vibLfo{};
  float pitchCents = 0, cutoffHz = 20000, resonanceDb = 0, attenuationCb = 0, pan = 0;
  float panLeft = .70710678F, panRight = .70710678F;
  float chorusSend = 0, reverbSend = 0;
  std::uint32_t effectiveKey = 60, effectiveVelocity = 127, exclusiveClass = 0;
};

struct Lowpass {
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  std::array<double, 2> z1{}, z2{};
  // Arguments of the coefficients currently held.
  double lastRate = 0, lastFrequency = 0, lastResonanceDb = 0;
  bool configured = false;
  // Resonance terms of the last clamped resonance; a cutoff sweep reuses them.
  double resonanceKey = 0, resonanceQ = 0, resonanceDc = 0;
  bool resonanceCached = false;
  // The filter is never bypassed: a modulated cutoff crossing a bypass
  // threshold would switch the response and state abruptly.
  void configure(double rate, double frequency, double resonanceDb) noexcept {
    // Identical arguments reproduce identical coefficients; the state is kept.
    if (configured && rate == lastRate && frequency == lastFrequency &&
        resonanceDb == lastResonanceDb)
      return;
    configured = true;
    lastRate = rate;
    lastFrequency = frequency;
    lastResonanceDb = resonanceDb;
    frequency = frequency < 5 ? 5 : frequency > rate * .45 ? rate * .45 : frequency;
    resonanceDb = resonanceDb < 0 ? 0 : resonanceDb > 96 ? 96 : resonanceDb;
    const auto omega = 6.2831853071795864769 * frequency / rate;
    const auto cosine = std::cos(omega);
    // At cutoff the biquad gain relative to DC is Q. As in common SF2
    // synthesizers, Q is the resonance offset by -3.01 dB, so zero resonance is
    // the Butterworth response; half the resonant gain is removed from DC.
    if (!resonanceCached || resonanceDb != resonanceKey) {
      resonanceCached = true;
      resonanceKey = resonanceDb;
      resonanceQ = .7071067811865475244 * std::pow(10.0, resonanceDb * .05);
      resonanceDc = std::pow(10.0, -resonanceDb * .025);
    }
    const auto q = resonanceQ, dc = resonanceDc;
    const auto alpha = std::sin(omega) / (2 * q), scale = 1 / (1 + alpha);
    b0 = (1 - cosine) * .5 * scale * dc;
    b1 = 2 * b0;
    b2 = b0;
    a1 = -2 * cosine * scale;
    a2 = (1 - alpha) * scale;
  }
  float process(float input, unsigned channel) noexcept {
    input = dsp::flushSubnormal(input);
    const auto output = b0 * input + z1[channel];
    z1[channel] = dsp::flushSubnormal(b1 * input - a1 * output + z2[channel]);
    z2[channel] = dsp::flushSubnormal(b2 * input - a2 * output);
    return dsp::flushSubnormal(static_cast<float>(output));
  }
  // process() without per-frame flushing, for hot loops that call
  // flushState() after each run. A subnormal only arises in the last steps of
  // a decay to silence, where a few unflushed frames change nothing audible.
  float processUnflushed(float input, unsigned channel) noexcept {
    const auto output = b0 * input + z1[channel];
    z1[channel] = b1 * input - a1 * output + z2[channel];
    z2[channel] = b2 * input - a2 * output;
    return static_cast<float>(output);
  }
  void flushState() noexcept {
    z1 = {dsp::flushSubnormal(z1[0]), dsp::flushSubnormal(z1[1])};
    z2 = {dsp::flushSubnormal(z2[0]), dsp::flushSubnormal(z2[1])};
  }
};

// The public PDF's endpoint examples are inconsistent. This profile preserves
// exact zero/full-scale unipolar endpoints and the MIDI bipolar center at 64.
inline float curve(float value, std::uint32_t type) noexcept {
  value = clamp(value, 0.0F, 1.0F);
  if (type == 0u)
    return value;
  if (type == 3u)
    return value >= .5F ? 1.0F : 0.0F;
  if (value <= 0.0F || value >= 1.0F)
    return value;
  constexpr float scale = 5.0F / 12.0F;
  return type == 1u ? clamp(-scale * std::log10(1.0F - value), 0.0F, 1.0F)
                    : clamp(1.0F + scale * std::log10(value), 0.0F, 1.0F);
}
inline float mapSource(float normalized, std::uint32_t source, bool linked = false) noexcept {
  const auto type = source >> 10u;
  const bool bipolar = (source & 512u) != 0u, reverse = (source & 256u) != 0u;
  if (linked && type == 0u)
    return reverse ? (bipolar ? -normalized : 1.0F - normalized) : normalized;
  auto value = bipolar ? clamp(normalized, -1.0F, 1.0F) : clamp(normalized, 0.0F, 1.0F);
  if (reverse)
    value = bipolar ? -value : 1.0F - value;
  if (!bipolar)
    return curve(value, type);
  return value < 0.0F ? -curve(-value, type) : curve(value, type);
}
inline float sourceValue(std::uint32_t source, const Inputs &input) noexcept {
  const auto index = source & 127u;
  if (!(source & 128u) && index == 0u)
    return 1.0F;
  float raw = 0;
  if (source & 128u)
    raw = input.cc ? input.cc[index] : 0.0F;
  else {
    switch (index) {
    case 2:
      raw = static_cast<float>(input.velocity);
      break;
    case 3:
      raw = static_cast<float>(input.key);
      break;
    case 10:
      raw = static_cast<float>(input.polyPressure);
      break;
    case 13:
      raw = static_cast<float>(input.channelPressure);
      break;
    case 14:
      return mapSource((source & 512u)
                           ? (input.bend < 0 ? input.bend / 8192.0F : input.bend / 8191.0F)
                           : (input.bend + 8192.0F) / 16383.0F,
                       source);
    case 16:
      raw = input.bendRangeSemitones;
      break;
    default:
      return 0.0F;
    }
  }
  const auto normalized = (source & 512u)
                              ? (raw < 64.0F ? (raw - 64.0F) / 64.0F : (raw - 64.0F) / 63.0F)
                              : raw / 127.0F;
  return mapSource(normalized, source);
}
inline float timecents(float value, float maximum = 8000.0F) noexcept {
  return value <= -32768.0F ? 0.0F : std::exp2(clamp(value, -12000.0F, maximum) / 1200.0F);
}
inline float frequency(float cents) noexcept { return 8.17579891564F * std::exp2(cents / 1200.0F); }
inline EnvelopeParameters envelopeParameters(const std::array<float, kGeneratorCount> &g,
                                             std::uint32_t key, bool volume) noexcept {
  const auto first = volume ? 33u : 25u;
  const auto tracking = 60.0F - static_cast<float>(key);
  return {
      timecents(g[first], 5000.0F),
      timecents(g[first + 1u]),
      g[first + 2u] <= -32768.0F
          ? 0.0F
          : timecents(g[first + 2u] + clamp(g[first + 6u], -1200.0F, 1200.0F) * tracking, 5000.0F),
      timecents(g[first + 3u] + clamp(g[first + 7u], -1200.0F, 1200.0F) * tracking),
      volume ? clamp(g[first + 4u], 0.0F, 1440.0F)
             : 1.0F - clamp(g[first + 4u], 0.0F, 1000.0F) * .001F,
      timecents(g[first + 5u])};
}

// Scratch is shared control-time storage sized to the largest region's route
// count. The immutable graph is topologically ordered and uses local link IDs.
inline bool evaluate(std::span<const float, kGeneratorCount> generators, RouteSpan routes,
                     Inputs input, std::span<float> linkedScratch, float sampleRoot,
                     float pitchCorrection, Resolved &result) noexcept {
  if (linkedScratch.size() < routes.count || (routes.count && !routes.words))
    return false;
  for (std::uint32_t i = 0; i < kGeneratorCount; ++i) {
    if (!std::isfinite(generators[i]))
      return false;
    result.generators[i] = generators[i];
  }
  // E-mu hardware, and the synthesizers that emulate it, scale only the
  // attenuation generator by 0.4; modulator contributions are unscaled.
  if (!input.strictSpec)
    result.generators[48] *= .4F;
  input.key = generators[46] >= 0.0F && generators[46] <= 127.0F
                  ? static_cast<std::uint32_t>(generators[46])
                  : input.key;
  input.velocity = generators[47] >= 0.0F && generators[47] <= 127.0F
                       ? static_cast<std::uint32_t>(generators[47])
                       : input.velocity;
  for (std::uint32_t i = 0; i < routes.count; ++i)
    linkedScratch[i] = 0.0F;
  for (std::uint32_t i = 0; i < routes.count; ++i) {
    const auto *route = routes.words + i * kRouteWords;
    const auto target = std::bit_cast<std::uint32_t>(route[0]);
    const auto sourceA = std::bit_cast<std::uint32_t>(route[1]);
    const auto sourceB = std::bit_cast<std::uint32_t>(route[2]);
    const auto flags = std::bit_cast<std::uint32_t>(route[8]);
    const auto transform = std::bit_cast<std::uint32_t>(route[9]);
    // Common synthesizers do not apply the default velocity-to-cutoff
    // modulator, including a bank's own copy of it, so banks do not rely on it.
    if (!input.strictSpec && target == 0x10008u && sourceA == 0x0102u && sourceB == 0u &&
        transform == 0u)
      continue;
    float first;
    if ((sourceA & 0xffff0000u) == 0x20000u) {
      const auto index = sourceA & 0xffffu;
      if (index != i)
        return false;
      first = mapSource(linkedScratch[index], flags, true);
    } else
      first = sourceValue(sourceA, input);
    if (sourceB > 0xffffu || !std::isfinite(route[3]))
      return false;
    auto amount = first * sourceValue(sourceB, input) * route[3];
    if (transform == 2u)
      amount = amount < 0.0F ? -amount : amount;
    else if (transform != 0u)
      return false;
    if (!std::isfinite(amount))
      return false;
    if ((target & 0xffff0000u) == 0x20000u) {
      const auto index = target & 0xffffu;
      if (index <= i || index >= routes.count)
        return false;
      linkedScratch[index] += amount;
    } else if ((target & 0xffff0000u) == 0x10000u && (target & 0xffffu) < kGeneratorCount)
      result.generators[target & 0xffffu] += amount;
    else
      return false;
  }
  auto &g = result.generators;
  for (auto value : g)
    if (!std::isfinite(value))
      return false;
  for (const auto index : {5u, 6u, 7u, 10u, 11u})
    g[index] = clamp(g[index], -12000.0F, 12000.0F);
  g[13] = clamp(g[13], -960.0F, 960.0F);
  result.effectiveKey = input.key;
  result.effectiveVelocity = input.velocity;
  const auto root = g[58] >= 0.0F && g[58] <= 127.0F ? g[58] : sampleRoot;
  result.pitchCents = (static_cast<float>(input.key) - root) * clamp(g[56], 0.0F, 1200.0F) +
                      clamp(g[51], -120.0F, 120.0F) * 100.0F + clamp(g[52], -99.0F, 99.0F) +
                      pitchCorrection + g[60];
  result.cutoffHz = frequency(clamp(g[8], 1500.0F, 13500.0F));
  result.resonanceDb = clamp(g[9], 0.0F, 960.0F) * .1F;
  result.attenuationCb = clamp(g[48], 0.0F, 1440.0F);
  result.pan = clamp(g[17], -500.0F, 500.0F) * .002F;
  // Constant-power sine/cosine pan law, as in common SF2 synthesizers.
  const auto panAngle = (result.pan + 1.0F) * .78539816F;
  result.panLeft = result.pan >= 1.0F ? 0.0F : std::cos(panAngle);
  result.panRight = result.pan >= 1.0F ? 1.0F : std::sin(panAngle);
  result.chorusSend = clamp(g[15], 0.0F, 1000.0F) * .001F;
  result.reverbSend = clamp(g[16], 0.0F, 1000.0F) * .001F;
  result.exclusiveClass = static_cast<std::uint32_t>(clamp(g[57], 0.0F, 127.0F));
  result.volEnv = envelopeParameters(g, input.key, true);
  result.modEnv = envelopeParameters(g, input.key, false);
  result.modLfo = {timecents(g[21], 5000.0F), frequency(clamp(g[22], -16000.0F, 4500.0F))};
  result.vibLfo = {timecents(g[23], 5000.0F), frequency(clamp(g[24], -16000.0F, 4500.0F))};
  return true;
}

class Lfo {
public:
  void reset() noexcept { phase_ = 0; }
  float next(float rate, float frequencyHz, float delaySeconds, double elapsedSeconds) noexcept {
    if (elapsedSeconds < delaySeconds)
      return 0.0F;
    const auto value = phase_ < .25   ? phase_ * 4.0
                       : phase_ < .75 ? 2.0 - phase_ * 4.0
                                      : phase_ * 4.0 - 4.0;
    advancePhase(frequencyHz / rate);
    return static_cast<float>(value);
  }
  void advanceSilent(float rate, float frequencyHz, float delaySeconds,
                     std::uint64_t firstElapsedFrame, std::uint32_t renderedFrames) noexcept {
    if (!renderedFrames)
      return;
    std::uint32_t first = 0;
    if (static_cast<double>(firstElapsedFrame) / rate < delaySeconds) {
      if (static_cast<double>(firstElapsedFrame + renderedFrames - 1u) / rate < delaySeconds)
        return;
      // Locate the first active frame with the same comparison as next().
      auto end = renderedFrames;
      while (first < end) {
        const auto middle = first + (end - first) / 2u;
        if (static_cast<double>(firstElapsedFrame + middle) / rate < delaySeconds)
          first = middle + 1u;
        else
          end = middle;
      }
    }
    const auto increment = frequencyHz / rate;
    for (auto frame = first; frame < renderedFrames; ++frame)
      advancePhase(increment);
  }

private:
  void advancePhase(double increment) noexcept {
    phase_ += increment;
    phase_ -= std::floor(phase_);
  }
  double phase_ = 0;
};

// Volume decay/release rates are in centibels (100 dB per full-scale time),
// whereas modulation decay/release rates are linear full-scale units per time.
class Envelope {
public:
  enum class Stage : std::uint8_t { Delay, Attack, Hold, Decay, Sustain, Release, Done };
  void reset(const EnvelopeParameters &parameters, float rate, bool volume) noexcept {
    rate_ = rate;
    volume_ = volume;
    value_ = 0;
    forced_ = false;
    lastSustain_ = -1;
    if (volume)
      parametersChanged<true>(parameters);
    else
      parametersChanged<false>(parameters);
    enter(Stage::Delay, parameters);
  }
  void release(const EnvelopeParameters &parameters) noexcept {
    if (!done() && stage_ != Stage::Release) {
      forced_ = false;
      enter(Stage::Release, parameters);
    }
  }
  void forceRelease(float seconds) noexcept {
    if (done())
      return;
    forced_ = true;
    stage_ = Stage::Release;
    elapsed_ = 0;
    forcedSeconds_ = seconds;
    duration_ = -1;
    configure(seconds, 0.0F);
  }
  bool done() const noexcept { return stage_ == Stage::Done; }
  bool waiting() const noexcept { return stage_ == Stage::Delay; }
  bool sustained() const noexcept { return stage_ == Stage::Sustain; }
  float value() const noexcept { return value_; }
  // Parameter evaluation owns normalization; the sample phase only progresses
  // envelope state. A pure pow inside next() can be speculatively hoisted past
  // a source-level cache guard by the WASM optimizer.
  template <bool Volume> void parametersChanged(const EnvelopeParameters &parameters) noexcept {
    if (lastSustain_ != parameters.sustain) {
      lastSustain_ = parameters.sustain;
      if constexpr (Volume)
        sustain_ = std::pow(10.0F, -parameters.sustain * .005F);
      else
        sustain_ = parameters.sustain;
    }
  }
  float next(const EnvelopeParameters &parameters) noexcept {
    for (unsigned transitions = 0; transitions < 7; ++transitions) {
      if (done())
        return 0.0F;
      const auto seconds = forced_ ? forcedSeconds_ : stageSeconds(parameters);
      const auto target = stage_ == Stage::Decay || stage_ == Stage::Sustain ? sustain_ : 0.0F;
      configure(seconds, target);
      if (stage_ == Stage::Sustain) {
        value_ = target;
        return value_;
      }
      if (stage_ == Stage::Delay || stage_ == Stage::Attack || stage_ == Stage::Hold) {
        if (elapsed_ >= duration_) {
          value_ = stage_ == Stage::Delay ? 0.0F : 1.0F;
          enter(static_cast<Stage>(static_cast<unsigned>(stage_) + 1u), parameters);
          continue;
        }
      } else if (duration_ <= 0 || value_ <= (stage_ == Stage::Decay ? target_
                                              : volume_              ? .00001F
                                                                     : 0.0F)) {
        value_ = stage_ == Stage::Decay ? target_ : 0.0F;
        enter(stage_ == Stage::Decay ? Stage::Sustain : Stage::Done, parameters);
        continue;
      }
      break;
    }
    if (stage_ == Stage::Attack) {
      const auto progress = static_cast<float>((elapsed_ + 1.0) / duration_);
      value_ = volume_ ? clamp(progress, 0.0F, 1.0F) : curve(progress, 2u);
    } else if (stage_ == Stage::Hold)
      value_ = 1.0F;
    else if (stage_ == Stage::Decay || stage_ == Stage::Release) {
      value_ = volume_ && !forced_ ? value_ * multiplier_ : value_ - decrement_;
      if (value_ < target_)
        value_ = target_;
    }
    ++elapsed_;
    return value_;
  }
  // Equals up to n successive next() calls with unchanged parameters. Returns
  // the number of outputs written; fewer than n means the next call reached
  // Done, which is absorbing, so the caller's next() repeats that frame exactly.
  // After next() configures a stage, its configure() calls are no-ops until a
  // transition, so each stage extends with only its own state update.
  std::uint32_t render(const EnvelopeParameters &parameters, float *out, std::uint32_t n) noexcept {
    std::uint32_t i = 0;
    while (i < n) {
      const auto first = next(parameters);
      if (done())
        return i;
      out[i++] = first;
      auto value = value_;
      auto elapsed = elapsed_;
      const auto duration = duration_;
      switch (stage_) {
      case Stage::Sustain:
        for (; i < n; ++i)
          out[i] = value;
        return n;
      case Stage::Delay:
        for (; i < n && !(elapsed >= duration); ++elapsed)
          out[i++] = value;
        break;
      case Stage::Attack:
        for (; i < n && !(elapsed >= duration); ++elapsed) {
          const auto progress = static_cast<float>((elapsed + 1.0) / duration);
          value = volume_ ? clamp(progress, 0.0F, 1.0F) : curve(progress, 2u);
          out[i++] = value;
        }
        break;
      case Stage::Hold:
        for (; i < n && !(elapsed >= duration); ++elapsed)
          out[i++] = value = 1.0F;
        break;
      case Stage::Decay:
      case Stage::Release: {
        const auto target = target_;
        const auto threshold = stage_ == Stage::Decay ? target : volume_ ? .00001F : 0.0F;
        if (duration <= 0)
          break;
        if (volume_ && !forced_) {
          const auto multiplier = multiplier_;
          for (; i < n && !(value <= threshold); ++elapsed) {
            value = value * multiplier;
            if (value < target)
              value = target;
            out[i++] = value;
          }
        } else {
          const auto decrement = decrement_;
          for (; i < n && !(value <= threshold); ++elapsed) {
            value = value - decrement;
            if (value < target)
              value = target;
            out[i++] = value;
          }
        }
        break;
      }
      default:
        break;
      }
      value_ = value;
      elapsed_ = elapsed;
    }
    return i;
  }

private:
  void enter(Stage stage, const EnvelopeParameters &) noexcept {
    stage_ = stage;
    elapsed_ = 0;
    duration_ = -1;
  }
  float stageSeconds(const EnvelopeParameters &p) const noexcept {
    switch (stage_) {
    case Stage::Delay:
      return p.delay;
    case Stage::Attack:
      return p.attack;
    case Stage::Hold:
      return p.hold;
    case Stage::Decay:
      return p.decay;
    case Stage::Release:
      return p.release;
    default:
      return 0.0F;
    }
  }
  void configure(float seconds, float target) noexcept {
    const auto duration = static_cast<double>(seconds) * rate_;
    if (duration == duration_ && target == target_)
      return;
    duration_ = duration;
    target_ = target;
    decrement_ = duration > 0 ? static_cast<float>((forced_ ? value_ : 1.0F) / duration) : 1.0F;
    multiplier_ =
        duration > 0 ? static_cast<float>(std::exp(-5.0 * std::log(10.0) / duration)) : 0.0F;
  }
  Stage stage_ = Stage::Done;
  float rate_ = 48000, value_ = 0, target_ = 0, decrement_ = 1, multiplier_ = 0, forcedSeconds_ = 0;
  float lastSustain_ = -1, sustain_ = 0;
  double elapsed_ = 0, duration_ = -1;
  bool volume_ = false, forced_ = false;
};
} // namespace effetune::plugins::others::sfz::sf2
#endif

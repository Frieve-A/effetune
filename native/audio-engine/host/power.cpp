#include "power.h"
#include "pipeline.h"
#include <algorithm>
#include <cmath>
#include <numbers>

namespace effetune::audio {
void PowerControl::full() noexcept {
  state_.directive = Directive::full;
  state_.monitoring = false;
  state_.arm = PowerState::Arm::disarmed;
  state_.command = state_.epoch = state_.armSequence = -1;
  silent_ = 0;
  warmup_ = settled_ = false;
  waitingCheckpoint_ = false;
}
void PowerControl::configure(PowerConfig config, Pipeline &pipeline, Directive guard,
                             std::int64_t guardId, std::int64_t guardEpoch) {
  const bool same = config.graph == state_.graph && config.topology == state_.topology;
  const bool retained = same && state_.directive >= Directive::monitor;
  if (!same) {
    lastEpoch_ = lastCommand_ = -1;
    first_ = requested_ = -1;
  }
  config_ = config;
  config_.coverageValid &= config_.pluginCount == config_.count &&
                           pipeline.coverage({config_.ids.data(), config_.count});
  config_.fast &= config_.coverageValid;
  config_.skip &= config_.coverageValid;
  state_.fast = config_.fast;
  state_.graph = config_.graph;
  state_.topology = config_.topology;
  dc_ = std::exp(-2 * std::numbers::pi * 5 / config_.rate);
  if (!retained || !config_.enabled)
    full();
  if (config_.enabled && guard >= Directive::monitor && guardId >= 0 && guardEpoch >= 0 &&
      (!same || (guardId > lastCommand_ && guardEpoch > lastEpoch_))) {
    state_.directive = guard;
    state_.monitoring = guard == Directive::monitor;
    lastCommand_ = state_.command = first_ = guardId;
    lastEpoch_ = state_.epoch = guardEpoch;
    if (!retained)
      state_.skipped = 0;
  }
  reason_ = "config-wake";
}
bool PowerControl::command(Directive directive, std::int64_t id, std::int64_t epoch,
                           std::int64_t after, bool preserve) {
  if (!enabled() || id <= lastCommand_ || (directive != Directive::full && epoch <= lastEpoch_))
    return false;
  lastCommand_ = id;
  const bool hostSkip = state_.directive >= Directive::monitor;
  if ((directive == Directive::full && hostSkip) ||
      (directive >= Directive::monitor && !config_.skip &&
       !(preserve && state_.directive == directive)))
    return false;
  if (directive == Directive::automatic &&
      (!config_.fast || !settled_ || state_.directive != Directive::full || after < 0 ||
       std::uint64_t(after) > state_.sequence))
    return false;
  const auto previous = state_.directive;
  full();
  state_.directive = directive;
  state_.monitoring = directive == Directive::monitor;
  state_.command = first_ = id;
  if (directive != Directive::full) {
    state_.epoch = lastEpoch_ = epoch;
    if (!preserve || previous != directive)
      state_.skipped = 0;
  }
  if (directive == Directive::automatic) {
    state_.arm = PowerState::Arm::armed;
    state_.armSequence = after;
  }
  return true;
}
bool PowerControl::resume(Pipeline &pipeline, std::int64_t command, std::int64_t epoch,
                          std::int64_t resumeId) {
  if (!enabled() || state_.directive < Directive::monitor || state_.command != command ||
      state_.epoch != epoch || resumeId <= lastCommand_ || !config_.coverageValid ||
      !pipeline.resetTemporal({config_.resets.data(), config_.resetCount}))
    return false;
  full();
  state_.command = first_ = lastCommand_ = resumeId;
  pipeline.resumeInstruments();
  reason_ = "config-wake";
  return true;
}
void PowerControl::mutation(Pipeline &pipeline) noexcept {
  if (state_.directive == Directive::automatic) {
    full();
    pipeline.resumeInstruments();
    reason_ = "config-wake";
  }
}
void PowerControl::threshold(double db) noexcept { config_.threshold = std::pow(10., db / 10.); }
PowerControl::Level PowerControl::measure(const float *data, unsigned channels, unsigned frames,
                                          Detector &d) noexcept {
  Level level;
  for (unsigned ch = 0; ch < channels; ++ch) {
    double sum = 0, x = d.x[ch], y = d.y[ch];
    for (unsigned i = 0; i < frames; ++i) {
      double next = data[ch * frames + i];
      if (!std::isfinite(next)) {
        next = 0;
        level.nonfinite = true;
      }
      y = next - x + dc_ * y;
      x = next;
      sum += y * y;
      level.peak = std::max(level.peak, next * next);
    }
    d.x[ch] = x;
    d.y[ch] = y;
    level.mean = std::max(level.mean, sum / frames);
  }
  d.ewma += -std::expm1(-double(frames) / (2. * config_.rate)) * (level.mean - d.ewma);
  return level;
}
bool PowerControl::begin(Pipeline &pipeline, const float *input, unsigned channels, unsigned frames,
                         bool sourceActive) noexcept {
  if (!enabled() && requested_ < 0)
    return true;
  ++state_.sequence;
  sourceActive_ = sourceActive;
  inputLevel_ = measure(input, channels, frames, input_);
  const bool wake = sourceActive || inputLevel_.nonfinite || inputLevel_.peak > config_.wakeFloor ||
                    (config_.wakeAny && inputLevel_.peak > 0);
  if (state_.monitoring && wake) {
    if (state_.directive == Directive::monitor)
      reason_ = "host-temporal-resume-required";
    else if (state_.fast) {
      full();
      pipeline.resumeInstruments();
      reason_ = "signal-wake";
    }
  }
  (void)pipeline;
  return !state_.monitoring && state_.directive != Directive::zero &&
         state_.directive != Directive::bypass;
}
bool PowerControl::emit(PowerEvent::Type type, const char *reason) noexcept {
  const auto w = write_.load(std::memory_order_relaxed);
  if (w - read_.load(std::memory_order_acquire) == events_.size())
    return false;
  events_[w % events_.size()] = {type, reason, state_};
  if (type == PowerEvent::Type::first)
    events_[w % events_.size()].state.command = first_;
  write_.store(w + 1, std::memory_order_release);
  return true;
}
bool PowerControl::take(PowerEvent &event) noexcept {
  const auto r = read_.load(std::memory_order_relaxed);
  if (r == write_.load(std::memory_order_acquire))
    return false;
  event = events_[r % events_.size()];
  read_.store(r + 1, std::memory_order_release);
  return true;
}
void PowerControl::finish(Pipeline &pipeline, const float *output, unsigned channels,
                          unsigned frames, bool ran) noexcept {
  if (!enabled() && requested_ < 0)
    return;
  const auto out = measure(output, channels, frames, output_);
  const bool inActive = sourceActive_ || inputLevel_.nonfinite || input_.ewma > config_.threshold;
  const bool outActive = out.nonfinite || output_.ewma > config_.threshold;
  if (inActive || outActive)
    ++state_.activityEpoch;
  const bool runtimeChanged = state_.runtimeRevision != pipeline.runtimeRevision();
  if (inActive || outActive || runtimeChanged)
    waitingCheckpoint_ = false;
  state_.runtimeRevision = pipeline.runtimeRevision();
  const bool midi = pipeline.midi.pending();
  const bool sfz = pipeline.assetPending();
  const bool edge = inActive != state_.inputActive || outActive != state_.outputActive ||
                    midi != state_.midiPending || sfz != state_.sfzPending || runtimeChanged;
  state_.inputActive = inActive;
  state_.outputActive = outActive;
  state_.inputPower = input_.ewma;
  state_.outputPower = output_.ewma;
  state_.midiPending = midi;
  state_.midiGeneration = pipeline.midi.generation();
  state_.sfzPending = sfz;
  if (ran)
    ++state_.fullQuanta;
  else {
    state_.skipped += frames;
    if (state_.monitoring)
      ++state_.monitorQuanta;
    else if (state_.directive == Directive::zero)
      ++state_.zeroQuanta;
    else
      ++state_.bypassQuanta;
  }
  if (ran && state_.directive == Directive::full)
    settled_ = true;
  if (first_ >= 0 && emit(PowerEvent::Type::first, nullptr))
    first_ = -1;
  if (ran && state_.arm == PowerState::Arm::armed) {
    silent_ = inActive || outActive || midi || sfz ? 0 : silent_ + frames;
    if (silent_ >= config_.seconds * config_.rate && !inActive && !outActive && !midi && !sfz) {
      if (pipeline.needsInstrumentCheckpoint()) {
        if (!waitingCheckpoint_)
          waitingCheckpoint_ = emit(PowerEvent::Type::instrumentCheckpoint, nullptr);
      } else if (config_.resetCount && !warmup_) {
        if (pipeline.resetTemporal({config_.resets.data(), config_.resetCount})) {
          warmup_ = true;
          reason_ = "automatic-preparation";
        } else {
          full();
          state_.fast = false;
          reason_ = "temporal-preparation-runtime-failed";
        }
      } else {
        state_.monitoring = true;
        state_.arm = PowerState::Arm::consumed;
        state_.skipped = 0;
        reason_ = "automatic-silence";
      }
    }
  }
  heartbeat_ += frames;
  state_.observation = requested_;
  if (edge || reason_ || requested_ >= 0 || heartbeat_ >= config_.rate) {
    const auto type = (!edge && !reason_ && requested_ < 0) ? PowerEvent::Type::heartbeat
                                                            : PowerEvent::Type::observation;
    if (emit(type, reason_)) {
      requested_ = -1;
      reason_ = nullptr;
      heartbeat_ = 0;
    }
  }
}
void PowerControl::requestWhileDisabled(std::int64_t id, unsigned graph, unsigned topology,
                                        unsigned rate) noexcept {
  state_.graph = graph;
  state_.topology = topology;
  config_.rate = rate;
  dc_ = std::exp(-2 * std::numbers::pi * 5 / rate);
  request(id);
}
} // namespace effetune::audio

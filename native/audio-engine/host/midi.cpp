#include "midi.h"
#include <algorithm>
#include <cmath>

namespace effetune::audio {
namespace {
// Seek history the kernel has yet to apply; a failed script is never awaited.
bool historyPending(Engine &engine, unsigned instance) noexcept {
  return (engine.instanceMidiState(instance) &
          (ET_MIDI_STATE_HISTORY_PENDING | ET_MIDI_STATE_SCRIPT_ERROR)) ==
         ET_MIDI_STATE_HISTORY_PENDING;
}
} // namespace
void MidiScheduler::reset() noexcept {
  states_ = {};
  liveCount_ = 0;
  pending_ = false;
  prepared_.store(0);
  preparedNotified_ = false;
  ended_.store(0);
  pausing_ = pauseComplete_ = endingBlock_ = false;
  paused_.store(false, std::memory_order_release);
  pauseReady_.store(0);
  nextReport_ = 0;
  publishedGeneration_.store(transport_.generation, std::memory_order_release);
}
bool MidiScheduler::configureInput(unsigned generation, bool enabled,
                                   std::uint64_t anchor) noexcept {
  if (generation < transport_.generation)
    return false;
  live_ = true;
  transport_.generation = generation;
  reset();
  transport_.playing = enabled;
  transport_.preparing = false;
  transport_.draining = false;
  transport_.anchor = anchor;
  transport_.gain = 1;
  return true;
}
bool MidiScheduler::enqueue(unsigned generation, std::span<const LiveEvent> events) noexcept {
  if (!live_ || !transport_.playing || generation != transport_.generation ||
      events.size() > liveEvents_.size() - liveCount_)
    return false;
  std::copy(events.begin(), events.end(), liveEvents_.begin() + liveCount_);
  ++batchSerial_;
  for (std::size_t i = 0; i < events.size(); ++i)
    liveEvents_[liveCount_ + i].batch = batchSerial_;
  liveCount_ += events.size();
  pending_ = true;
  return true;
}
bool MidiScheduler::configure(Transport &next) noexcept {
  if (next.generation < transport_.generation || !(next.speed > 0))
    return false;
  if (!next.hasTimeline) {
    next.events.swap(transport_.events);
    next.points.swap(transport_.points);
    next.duration = transport_.duration;
  } else {
    const auto firstNote = std::find_if(next.events.begin(), next.events.end(), [](const Event &e) {
      return (e.data.message & 0xf0) == 0x90 && (e.data.message & 0x7f0000) != 0;
    });
    firstNoteSeconds_ = firstNote == next.events.end() ? 0 : firstNote->seconds;
  }
  transport_.events.swap(next.events);
  transport_.hasTimeline = next.hasTimeline || transport_.hasTimeline;
  transport_.points.swap(next.points);
  transport_.generation = next.generation;
  transport_.anchor = next.anchor;
  transport_.position = next.position;
  transport_.duration = next.duration;
  transport_.speed = next.speed;
  transport_.gain = next.gain;
  transport_.playing = next.playing;
  transport_.preparing = next.preparing;
  transport_.preserveRelease = next.preserveRelease;
  transport_.draining = next.draining;
  live_ = false;
  reset();
  return true;
}
MidiScheduler::State &MidiScheduler::state(const Instrument &target) noexcept {
  // Engine handles encode their 1-based slot index in the low word; the host
  // may reuse a plugin ID with a different handle or a new asset revision.
  auto &entry = states_[(target.instance & 0xffffu) - 1];
  if (entry.instance != target.instance || entry.token != target.token ||
      entry.channelMask != target.channelMask)
    entry = {target.instance, target.token, target.channelMask};
  return entry;
}
bool MidiScheduler::hydrate(Engine &engine, const Instrument &target, unsigned generation,
                            std::span<const et_midi_event> events) noexcept {
  if (!live_ || generation != transport_.generation || events.size() > 8192)
    return false;
  auto &s = state(target);
  if (!s.initialized &&
      engine.setInstanceMidiEvents(target.instance, nullptr, 0, generation,
                                   ET_MIDI_RESET | ET_MIDI_PRESERVE_RELEASE) != ET_OK)
    return false;
  while (!events.empty()) {
    const auto n = std::min(events.size(), batch_.size());
    if (engine.setInstanceMidiEvents(target.instance, events.data(), static_cast<unsigned>(n),
                                     generation, ET_MIDI_HYDRATE_CHANNEL_STATE) != ET_OK)
      return false;
    events = events.subspan(n);
  }
  s.initialized = true;
  return true;
}
bool MidiScheduler::installMap(Engine &engine, unsigned instance) const {
  return engine.setInstanceMidiTransportMap(instance, transport_.points.data(),
                                            static_cast<unsigned>(transport_.points.size())) ==
         ET_OK;
}
void MidiScheduler::resumeInput(unsigned instance) noexcept {
  auto &s = states_[(instance & 0xffffu) - 1];
  if (live_ && s.instance == instance && s.initialized)
    s.resumeInput = true;
}
bool MidiScheduler::prepare(Engine &engine, std::span<const Instrument> targets) {
  if (live_)
    return true;
  bool ok = true;
  for (const auto &t : targets) {
    auto &s = state(t);
    if (transport_.draining) {
      if (t.enabled && t.ready) {
        s.clockBase = engine.instanceMidiClock(t.instance);
        s.clockAnchor = transport_.anchor;
        s.initialized = s.ended = true;
        s.cursor = transport_.events.size();
        ok &= engine.setInstanceMidiEvents(t.instance, nullptr, 0, generation(),
                                           ET_MIDI_NATURAL_END) == ET_OK;
      }
      continue;
    }
    const bool mapped = installMap(engine, t.instance);
    if (t.enabled && t.ready && !mapped)
      ok = false;
    if (s.initialized || !t.enabled)
      continue;
    const auto gen = transport_.generation;
    if (engine.setInstanceMidiEvents(
            t.instance, nullptr, 0, gen,
            ET_MIDI_RESET | (transport_.preserveRelease ? ET_MIDI_PRESERVE_RELEASE : 0)) != ET_OK) {
      if (t.ready)
        ok = false;
      continue;
    }
    if (mapped)
      s.initialized = s.restoring = true;
  }
  if (!ok)
    transport_.preparing = transport_.playing = false;
  return ok;
}
bool MidiScheduler::restore(Engine &engine, const Instrument &target, State &s, std::uint64_t frame,
                            unsigned rate) noexcept {
  // Match the worklet: restore seek history in bounded slices on successive
  // blocks and let the kernel advance script time after each slice, so a long
  // song never stalls the audio callback.
  const auto pending = [&] { return historyPending(engine, target.instance); };
  if (pending())
    return false;
  // History belongs to the generation the kernel was reset to; a pause that
  // arrives mid-restore switches generations at the activation marker.
  const auto gen = engine.instanceMidiGeneration(target.instance);
  const auto &events = transport_.events;
  const auto at = pausing_ ? std::min(frame, pauseFrame_) : frame;
  const auto seconds = position(at - std::min<std::uint64_t>(at, target.inputLatency), rate);
  const auto songFrame = [&](double t) {
    return static_cast<std::uint64_t>(std::round(t * rate / transport_.speed));
  };
  unsigned count = 0;
  while (count < 256 && s.cursor < events.size() && events[s.cursor].seconds < seconds) {
    const auto &e = events[s.cursor++];
    auto data = e.data;
    if (!(data.flags & (ET_MIDI_SYSTEM_RESET | ET_MIDI_DRUM_MODE))) {
      const auto eventFrame = songFrame(e.seconds);
      data.render_frame_low = static_cast<unsigned>(eventFrame);
      data.render_frame_high = static_cast<unsigned>(eventFrame >> 32);
    }
    batch_[count++] = data;
  }
  if (count) {
    engine.setInstanceMidiEvents(target.instance, batch_.data(), count, gen, ET_MIDI_STATE_ONLY);
    engine.setInstanceMidiClock(target.instance, songFrame(events[s.cursor - 1].seconds), gen,
                                ET_MIDI_CLOCK_HISTORY);
  }
  if (pending() || (s.cursor < events.size() && events[s.cursor].seconds < seconds))
    return false;
  const auto seekFrame = songFrame(seconds);
  if (!s.historyRequested) {
    engine.setInstanceMidiClock(target.instance, seekFrame, gen, ET_MIDI_CLOCK_HISTORY);
    s.historyRequested = true;
    if (pending())
      return false;
  }
  s.restoring = false;
  s.clockBase = seekFrame;
  s.activation = ET_MIDI_REATTACK;
  return true;
}
bool MidiScheduler::start(unsigned generation, std::uint64_t anchor) noexcept {
  if (generation != transport_.generation)
    return false;
  transport_.playing = true;
  transport_.preparing = false;
  transport_.anchor = anchor;
  return true;
}
void MidiScheduler::speed(double value, std::uint64_t frame, unsigned rate) noexcept {
  if (value <= 0)
    return;
  if (transport_.playing && frame > transport_.anchor)
    transport_.position += (frame - transport_.anchor) * transport_.speed / rate;
  transport_.anchor = frame;
  transport_.speed = value;
}
double MidiScheduler::position(std::uint64_t frame, unsigned rate) const noexcept {
  return std::min(transport_.duration,
                  transport_.position + (transport_.playing && frame > transport_.anchor
                                             ? (frame - transport_.anchor) * transport_.speed / rate
                                             : 0));
}
bool MidiScheduler::pause(unsigned gen, std::uint64_t frame, unsigned rate) noexcept {
  if (live_ || gen <= transport_.generation)
    return false;
  pauseFrame_ = frame;
  pausePosition_ = position(frame, rate);
  pausing_ = true;
  transport_.generation = gen;
  transport_.playing = true;
  publishedGeneration_.store(gen);
  return true;
}
std::size_t MidiScheduler::cursor(unsigned instance) const noexcept {
  for (const auto &s : states_)
    if (s.instance == instance)
      return s.cursor;
  return 0;
}
bool MidiScheduler::restoreCursor(const Instrument &target, std::size_t cursor,
                                  std::uint64_t clock) noexcept {
  if (cursor > transport_.events.size())
    return false;
  auto &s = state(target);
  s.initialized = true;
  s.cursor = cursor;
  s.clockBase = clock;
  s.activation = ET_MIDI_RESUME;
  return true;
}
void MidiScheduler::finishedBlock(std::uint64_t frame, unsigned rate) noexcept {
  delivered_.store(blockDelivered_, std::memory_order_release);
  if (pauseComplete_) {
    transport_.position = pausePosition_;
    transport_.playing = false;
    pausing_ = pauseComplete_ = false;
    paused_.store(true, std::memory_order_release);
    reportedPosition_.store(pausePosition_);
    pauseReady_.store(transport_.generation, std::memory_order_release);
  } else if (endingBlock_) {
    transport_.position = transport_.duration;
    transport_.playing = false;
    transport_.draining = true;
    endingBlock_ = false;
    reportedPosition_.store(transport_.duration);
    positionFrame_.store(frame);
    positionGen_.store(transport_.generation);
    ended_.store(transport_.generation, std::memory_order_release);
  } else if (!live_ && transport_.playing && frame >= nextReport_) {
    // Match the worklet midiPosition cadence (ceil(rate / 30)) for visual readers.
    nextReport_ = frame + (rate + 29) / 30;
    reportedPosition_.store(position(frame, rate));
    positionFrame_.store(frame);
    positionGen_.store(transport_.generation);
  }
}
bool MidiScheduler::reportPosition(unsigned &generation, double &seconds,
                                   std::uint64_t &frame) noexcept {
  generation = positionGen_.exchange(0);
  seconds = reportedPosition_.load();
  frame = positionFrame_.load();
  return generation != 0;
}
double MidiScheduler::minimumBpm() const noexcept {
  if (live_ || transport_.points.empty())
    return 0;
  return .25 * std::min_element(transport_.points.begin(), transport_.points.end(),
                                [](const auto &a, const auto &b) { return a.bpm < b.bpm; })
                   ->bpm;
}
void MidiScheduler::forecast(Engine &e, const Instrument &t, Forecast &f, std::uint64_t frame,
                             unsigned rate, bool main, bool preview,
                             et_stream_readiness &r) noexcept {
  if (!t.enabled || e.instanceStreamReadiness(t.instance, r) != ET_OK)
    return;
  const auto gen = e.instanceMidiGeneration(t.instance);
  const bool known = main && !live_ && !preview && transport_.hasTimeline &&
                     (transport_.preparing || transport_.playing);
  const unsigned scope = known ? ET_STREAM_SCOPE_KNOWN_MIDI : ET_STREAM_SCOPE_SELECTED_PRESETS;
  const bool changed = f.generation != generation() || f.nativeGeneration != gen ||
                       f.speed != transport_.speed || f.scope != scope;
  if (changed) {
    f = {};
    f.generation = generation();
    f.nativeGeneration = gen;
    f.speed = transport_.speed;
    f.scope = scope;
  }
  const bool refill = known ? r.ready_ahead_frames <= f.window / 2
                            : (e.instanceMidiState(t.instance) & 7) != 0 && frame >= f.next;
  if (f.ready && !changed && !refill)
    return;
  if (f.limited && !f.scanning && frame < f.next)
    return;
  if (!f.scanning) {
    f.ready = false;
    f.scanning = true;
    f.began = false;
    f.window = f.attempt == 0 ? (3 * rate + 1) / 2 : f.attempt == 1 ? rate : rate / 4;
    f.start = position(frame > t.inputLatency ? frame - t.inputLatency : 0, rate);
    // A silent lead-in needs no sample pages. Admit the opening notes before Play,
    // retaining earlier bank/program changes at offset zero for sample selection.
    if (known)
      f.start = std::max(f.start, firstNoteSeconds_);
    f.cursor = cursor(t.instance);
  }
  std::array<et_midi_event, 256> events{};
  unsigned count = 0, visited = 0;
  bool scanned = !known;
  const auto horizon = f.start + f.window * f.speed / rate;
  while (known && f.cursor < transport_.events.size() &&
         transport_.events[f.cursor].seconds < horizon && visited++ < events.size()) {
    const auto &entry = transport_.events[f.cursor++];
    const auto status = entry.data.message & 0xf0;
    if (entry.seconds < f.start && (status == 0x80 || status == 0x90))
      continue;
    auto event = entry.data;
    event.offset_frames =
        static_cast<unsigned>(std::max(0., std::round((entry.seconds - f.start) * rate / f.speed)));
    // Rounding can place an event inside `horizon` yet on the window end; it
    // completes the scan exactly like an event past the horizon.
    if (event.offset_frames >= f.window) {
      --f.cursor;
      scanned = true;
      break;
    }
    event.note_id = (event.flags & ET_MIDI_SYSTEM_RESET) ? event.note_id : 0;
    events[count++] = event;
  }
  et_status status = ET_OK;
  if (!f.began || count) {
    const unsigned flags = ET_STREAM_FORECAST_ADMIT | (f.began ? 0 : ET_STREAM_FORECAST_BEGIN) |
                           (!f.began && !known ? ET_STREAM_FORECAST_SELECTED_PRESETS : 0);
    status = e.prefetchInstanceSamples(t.instance, events.data(), count, gen, f.window, flags);
    f.began = status == ET_OK;
  }
  if (status == ET_OK && (scanned || f.cursor == transport_.events.size() ||
                          transport_.events[f.cursor].seconds >= horizon)) {
    status = e.prefetchInstanceSamples(t.instance, nullptr, 0, gen, f.window,
                                       ET_STREAM_FORECAST_ADMIT | ET_STREAM_FORECAST_COMMIT);
    if (status == ET_OK) {
      e.instanceStreamReadiness(t.instance, r);
      f.ready =
          r.scope != ET_STREAM_SCOPE_NONE && !r.pending_pages && (!known || r.ready_ahead_frames);
      f.limited = f.attempt != 0;
      f.scanning = false;
      // A known score refills when half of its admitted audio remains. Even a
      // reduced window was admitted and must be refilled before its notes start.
      f.next = known ? frame : frame + rate / 2;
    }
  }
  if (status == ET_ERR_OOM) {
    f.scanning = false;
    if (f.attempt < 2)
      ++f.attempt;
    else {
      f.limited = true;
      f.next = frame + rate / 2;
      f.attempt = 0;
    }
  } else if (status < 0)
    f.scanning = false;
}
bool MidiScheduler::joinPlaying(Engine &engine, const Instrument &target, State &s,
                                std::uint64_t frame, unsigned frames, unsigned rate) noexcept {
  if (!s.joining) {
    if (engine.setInstanceMidiEvents(target.instance, nullptr, 0, generation(), ET_MIDI_RESET) !=
        ET_OK)
      return false;
    s.joining = true;
  }
  const auto stop = pausing_ ? pauseFrame_ + target.inputLatency : UINT64_MAX;
  const auto at = stop < frame + frames ? stop : frame;
  const auto seconds = position(at - std::min<std::uint64_t>(at, target.inputLatency), rate);
  // A bank joining playback inherits channel transactions, never historical notes.
  // Match the worklet's bounded history slice while the other instruments keep rendering.
  const auto begin = s.cursor, end = std::min(begin + 256, transport_.events.size());
  unsigned count = 0;
  while (s.cursor < end && transport_.events[s.cursor].seconds < seconds) {
    const auto &data = transport_.events[s.cursor++].data;
    if ((data.message & 0xe0) != 0x80)
      batch_[count++] = data;
  }
  if (count && engine.setInstanceMidiEvents(target.instance, batch_.data(), count, generation(),
                                            ET_MIDI_HYDRATE_CHANNEL_STATE) != ET_OK) {
    s.cursor = begin;
    return false;
  }
  if (s.cursor < transport_.events.size() && transport_.events[s.cursor].seconds < seconds)
    return false;
  if (target.streaming) {
    et_stream_readiness ready{};
    if (engine.instanceStreamReadiness(target.instance, ready) != ET_OK || !ready.scope ||
        ready.pending_pages ||
        (ready.scope == ET_STREAM_SCOPE_KNOWN_MIDI && !ready.ready_ahead_frames))
      return false;
  }
  s.initialized = true;
  s.joining = false;
  s.joinedDuringPlayback = true;
  s.activation = ET_MIDI_RESUME;
  return true;
}
void MidiScheduler::render(Engine &engine, std::span<const Instrument> targets, std::uint64_t frame,
                           unsigned frames, unsigned rate) noexcept {
  if (!transport_.generation)
    return;
  unsigned maxDelay = 0;
  auto retryFrom = liveCount_;
  bool prepared = true;
  bool active = false, allEnded = true, allPaused = true;
  for (const auto &t : targets) {
    auto &s = state(t);
    if (!t.enabled || (!live_ && !t.ready)) {
      if (t.enabled && t.streaming && transport_.preparing)
        prepared = false;
      if (!live_ && transport_.playing && (s.initialized || s.joining))
        s = {t.instance, t.token, t.channelMask};
      continue;
    }
    if (!s.initialized &&
        (live_ || !transport_.playing || !joinPlaying(engine, t, s, frame, frames, rate))) {
      allPaused = false;
      continue;
    }
    if (s.restoring && (transport_.playing || transport_.preparing) &&
        !restore(engine, t, s, frame, rate)) {
      prepared = allEnded = allPaused = false;
      active = true;
      continue;
    }
    if (t.streaming && transport_.preparing) {
      et_stream_readiness r{};
      if (engine.instanceStreamReadiness(t.instance, r) != ET_OK || !r.scope || r.pending_pages ||
          (r.scope == ET_STREAM_SCOPE_KNOWN_MIDI && !r.ready_ahead_frames))
        prepared = false;
    }
    maxDelay = std::max(maxDelay, t.inputLatency);
    const auto origin = transport_.anchor + t.inputLatency;
    // The instrument clock counts rendered samples from its own activation.
    // A speed change moves the song anchor without rewinding that clock.
    const auto clockAt = [&](std::uint64_t at) {
      const auto clockOrigin = live_ ? origin : s.clockAnchor;
      return s.clockBase + (!s.activation && at > clockOrigin ? at - clockOrigin : 0);
    };
    const auto clock = clockAt(frame);
    const auto gen = transport_.generation;
    engine.setInstanceMidiGain(t.instance, static_cast<float>(transport_.gain));
    if (s.paused)
      continue;
    engine.setInstanceMidiClock(t.instance, clock, gen,
                                (transport_.playing || transport_.draining) && t.ready &&
                                        !s.activation
                                    ? ET_MIDI_CLOCK_RUNNING
                                    : 0);
    std::size_t count = 0;
    if (live_) {
      if (s.resumeInput) {
        // The marker and the first incoming notes must share a kernel batch.
        engine.setInstanceMidiEvents(t.instance, nullptr, 0, gen, ET_MIDI_RESUME);
        batch_[count++] = {0,
                           0,
                           0,
                           ET_MIDI_RESUME,
                           static_cast<unsigned>(clock),
                           static_cast<unsigned>(clock >> 32)};
        s.resumeInput = false;
      }
      for (std::size_t i = 0; i < liveCount_; ++i) {
        auto &e = liveEvents_[i];
        if (e.frame + t.inputLatency >= frame + frames)
          continue;
        auto target =
            std::lower_bound(e.targets.begin(), e.targets.end(), t.id,
                             [](const LiveTarget &item, unsigned id) { return item.id < id; });
        if (target == e.targets.end() || target->id != t.id || target->token != t.token ||
            target->delivered)
          continue;
        const auto at = e.frame + t.inputLatency;
        if (count == batch_.size()) {
          retryFrom = std::min(retryFrom, i);
          break;
        }
        target->delivered = true;
        if (!t.ready && (e.data.message & 0xe0) == 0x80)
          continue;
        auto data = e.data;
        data.offset_frames = at > frame ? static_cast<unsigned>(at - frame) : 0;
        batch_[count++] = data;
      }
    } else if (transport_.playing && t.ready) {
      if (s.activation && origin < frame + frames) {
        const auto status = engine.setInstanceMidiEvents(
            t.instance, nullptr, 0, gen,
            s.activation == ET_MIDI_RESUME ? ET_MIDI_RESUME : ET_MIDI_RETIME);
        if (status == ET_OK) {
          s.clockAnchor = std::max(frame, origin);
          batch_[count++] = {static_cast<unsigned>(s.clockAnchor - frame),
                             0,
                             0,
                             s.activation,
                             static_cast<unsigned>(s.clockBase),
                             static_cast<unsigned>(s.clockBase >> 32)};
          s.activation = 0;
        }
      }
      const auto atFrame = [&](double seconds) {
        return static_cast<std::uint64_t>(std::max(
            0., double(origin) +
                    std::round((seconds - transport_.position) * rate / transport_.speed)));
      };
      if (!transport_.points.empty()) {
        const auto mapFrame =
            s.joinedDuringPlayback ? std::max(s.clockAnchor, origin) : transport_.anchor;
        const auto mapSeconds = s.joinedDuringPlayback ? position(mapFrame - t.inputLatency, rate)
                                                       : transport_.position;
        engine.setInstanceMidiTransport(t.instance, clockAt(mapFrame), mapSeconds, transport_.speed,
                                        transport_.duration,
                                        ET_MIDI_TRANSPORT_ENABLED | ET_MIDI_TRANSPORT_PLAYING);
      }
      while (s.cursor < transport_.events.size() && count + 2 < batch_.size()) {
        const auto &e = transport_.events[s.cursor];
        const auto at = atFrame(e.seconds);
        if (at >= frame + frames || (pausing_ && at >= pauseFrame_ + t.inputLatency))
          break;
        auto data = e.data;
        data.offset_frames = at > frame ? static_cast<unsigned>(at - frame) : 0;
        if (!(data.flags & (ET_MIDI_SYSTEM_RESET | ET_MIDI_DRUM_MODE))) {
          const auto eventClock = clockAt(std::max(at, frame));
          data.render_frame_low = static_cast<unsigned>(eventClock);
          data.render_frame_high = static_cast<unsigned>(eventClock >> 32);
        }
        batch_[count++] = data;
        ++s.cursor;
      }
      const auto end = atFrame(transport_.duration);
      if (pausing_ && pauseFrame_ + t.inputLatency < frame + frames) {
        const auto at = pauseFrame_ + t.inputLatency;
        const auto n = at > frame ? static_cast<unsigned>(at - frame) : 0;
        const auto pauseClock = clockAt(std::max(at, frame));
        if (engine.instanceMidiGeneration(t.instance) != gen)
          engine.setInstanceMidiEvents(t.instance, nullptr, 0, gen, ET_MIDI_RETIME);
        batch_[count++] = {n,
                           0,
                           0,
                           ET_MIDI_PAUSE,
                           static_cast<unsigned>(pauseClock),
                           static_cast<unsigned>(pauseClock >> 32)};
        s.paused = true;
      } else if (!pausing_ && !s.ended && end < frame + frames) {
        const auto endClock = clockAt(std::max(end, frame));
        batch_[count++] = {end > frame ? static_cast<unsigned>(end - frame) : 0,
                           0,
                           0,
                           ET_MIDI_NATURAL_END,
                           static_cast<unsigned>(endClock),
                           static_cast<unsigned>(endClock >> 32)};
        s.ended = true;
      }
      allEnded &= s.ended;
      allPaused &= s.paused;
    }
    if (count)
      engine.setInstanceMidiEvents(t.instance, batch_.data(), static_cast<unsigned>(count), gen, 0);
    active |= (engine.instanceMidiState(t.instance) &
               (ET_MIDI_STATE_VOICES | ET_MIDI_STATE_CALLBACKS | ET_MIDI_STATE_GENERATED)) ||
              historyPending(engine, t.instance);
  }
  if (live_) {
    std::size_t kept = 0;
    for (std::size_t i = 0; i < liveCount_; ++i)
      if (i >= retryFrom || liveEvents_[i].frame + maxDelay >= frame + frames)
        liveEvents_[kept++] = liveEvents_[i];
    liveCount_ = kept;
    blockDelivered_ = batchSerial_;
    for (std::size_t i = 0; i < kept; ++i)
      blockDelivered_ = std::min(blockDelivered_, liveEvents_[i].batch - 1);
  } else if (pausing_ && allPaused && frame + frames > pauseFrame_) {
    pauseComplete_ = true;
  } else if (!pausing_ && transport_.playing && allEnded &&
             frame + frames >= transport_.anchor + maxDelay +
                                   std::max(0., (transport_.duration - transport_.position) * rate /
                                                    transport_.speed)) {
    endingBlock_ = true;
  }
  pending_ = active || liveCount_ || (!live_ && transport_.playing);
  if (!live_ && transport_.preparing && prepared && !preparedNotified_) {
    prepared_ = transport_.generation;
    preparedNotified_ = true;
  }
}
} // namespace effetune::audio

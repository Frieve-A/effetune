#include "midi_control.h"
#include "host/pipeline.h"
#include "instrument_control.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <deque>
#include <iostream>

namespace effetune::audio {
namespace {
using Object = JsonValue::Object;
void send(Object m) { writeFrame(std::cout, {FrameKind::Control, std::move(m), {}}); }
unsigned field(const JsonValue &v, const char *name) { return v.GetUInt32(name).value_or(0); }
std::uint64_t position(const JsonValue &v, const char *key) {
  const auto n = v.GetNumber(key).value_or(0);
  if (n < 0 || n > 9007199254740991. || std::floor(n) != n)
    throw std::runtime_error("invalid MIDI frame");
  return static_cast<std::uint64_t>(n);
}
et_midi_event decode(const JsonValue &v, unsigned serial) {
  const unsigned status = field(v, "status"), a = field(v, "data1"), b = field(v, "data2");
  if (status > 255 || a > 127 || b > 127)
    throw std::runtime_error("invalid MIDI message");
  const auto reset = field(v, "systemReset");
  const auto flags = reset                                   ? unsigned(ET_MIDI_SYSTEM_RESET)
                     : v.GetBool("drumMode").value_or(false) ? unsigned(ET_MIDI_DRUM_MODE)
                                                             : field(v, "flags");
  const auto note = reset ? reset : (status & 0xf0) == 0x90 && b ? serial : 0;
  return {0, status | (a << 8) | (b << 16), note, flags, 0, 0};
}
const JsonValue::Array &array(const JsonValue &v, const char *key) {
  const auto *list = v.Find(key);
  if (!list || !list->IsArray())
    throw std::runtime_error("invalid MIDI list");
  return list->AsArray();
}
template <class T> T load(const std::uint8_t *p) {
  T v;
  std::memcpy(&v, p, sizeof(v));
  return v;
}
et_midi_event liveData(const std::uint8_t *p) {
  const auto data = load<std::uint32_t>(p);
  if ((data & 0xff808000u) != 0)
    throw std::runtime_error("invalid MIDI data bytes");
  return {0, data, load<std::uint32_t>(p + 8), load<std::uint32_t>(p + 4), 0, 0};
}
unsigned liveCount(const Frame &frame, unsigned stride) {
  const auto count = frame.message.GetUInt32("eventCount");
  if (!count || frame.attachment.size() != std::uint64_t(*count) * stride)
    throw std::runtime_error("invalid live MIDI buffer");
  return *count;
}
struct InputBatch {
  std::vector<MidiScheduler::LiveEvent> events;
  std::vector<MidiScheduler::LiveTarget> targets;
};
struct PendingInput {
  unsigned gen;
  std::uint64_t batch;
  JsonValue request;
  // Callback events borrow the target spans until this batch has been rendered.
  std::shared_ptr<InputBatch> data;
};
std::array<std::deque<PendingInput>, 2> inputs;
void timeline(MidiScheduler::Transport &t, const JsonValue &value,
              std::span<const std::uint8_t> bytes) {
  t.hasTimeline = true;
  t.duration = value.GetNumber("duration").value_or(0);
  unsigned serial = 0;
  if (value.Find("eventsCount")) {
    const auto start = field(value, "eventsOffset"), count = field(value, "eventsCount");
    if (start > bytes.size() || count > (bytes.size() - start) / 24)
      throw std::runtime_error("invalid MIDI event range");
    t.events.reserve(count);
    for (unsigned i = 0; i < count; ++i) {
      const auto *record = bytes.data() + start + std::size_t(i) * 24;
      const double seconds = load<double>(record);
      const auto status = load<unsigned>(record + 8), a = load<unsigned>(record + 12),
                 b = load<unsigned>(record + 16);
      const auto reset = load<std::uint16_t>(record + 20), drum = load<std::uint16_t>(record + 22);
      if (!std::isfinite(seconds) || seconds < 0 ||
          (!t.events.empty() && seconds < t.events.back().seconds) || status > 255 || a > 127 ||
          b > 127)
        throw std::runtime_error("invalid MIDI event");
      ++serial;
      const unsigned flags = reset ? ET_MIDI_SYSTEM_RESET : drum ? ET_MIDI_DRUM_MODE : 0;
      t.events.push_back(
          {{0, status | (a << 8) | (b << 16),
            reset ? reset : ((status & 0xf0) == 0x90 && b ? serial : 0), flags, 0, 0},
           seconds});
    }
  } else
    for (const auto &e : array(value, "events")) {
      const auto seconds = e.GetNumber("seconds").value_or(-1);
      if (seconds < 0 || (!t.events.empty() && seconds < t.events.back().seconds))
        throw std::runtime_error("invalid MIDI timeline");
      t.events.push_back({decode(e, ++serial), seconds});
    }
  if (value.Find("tempoCount") || value.Find("meterCount")) {
    const auto tempoStart = field(value, "tempoOffset"), tempoCount = field(value, "tempoCount"),
               meterStart = field(value, "meterOffset"), meterCount = field(value, "meterCount");
    if (tempoStart > bytes.size() || tempoCount > (bytes.size() - tempoStart) / 20 ||
        meterStart > bytes.size() || meterCount > (bytes.size() - meterStart) / 24)
      throw std::runtime_error("invalid MIDI tempo range");
    unsigned ti = 0, mi = 0;
    const std::uint8_t *tempo = nullptr, *meter = nullptr;
    while (ti < tempoCount || mi < meterCount) {
      const auto *tp = ti < tempoCount ? bytes.data() + tempoStart + std::size_t(ti) * 20 : nullptr;
      const auto *mp = mi < meterCount ? bytes.data() + meterStart + std::size_t(mi) * 24 : nullptr;
      const auto a = tp ? load<double>(tp) : INFINITY, b = mp ? load<double>(mp) : INFINITY;
      if ((tp && !std::isfinite(a)) || (mp && !std::isfinite(b)))
        throw std::runtime_error("invalid MIDI tempo time");
      const auto time = std::min(a, b);
      // The SMF parser includes defaults as well as explicit changes at tick zero.
      // The last tempo and meter at each timestamp define a single DSP map point.
      while (ti < tempoCount && load<double>(bytes.data() + tempoStart + 20 * ti) == time)
        tempo = bytes.data() + tempoStart + 20 * ti++;
      while (mi < meterCount && load<double>(bytes.data() + meterStart + 24 * mi) == time)
        meter = bytes.data() + meterStart + 24 * mi++;
      if (!tempo || !meter)
        continue;
      const unsigned us = load<unsigned>(tempo + 16), numerator = load<unsigned>(meter + 16),
                     denominator = load<unsigned>(meter + 20);
      if (!us || !numerator || !denominator)
        throw std::runtime_error("invalid MIDI tempo");
      const double bpm = 60000000. / us;
      t.points.push_back({time, load<double>(tempo + 8) + (time - load<double>(tempo)) * bpm / 60.,
                          load<double>(meter + 8), bpm, numerator, denominator});
    }
    return;
  }
  const auto *tempos = value.Find("tempoMap"), *meters = value.Find("timeSignatures");
  if (!tempos || !meters || !tempos->IsArray() || !meters->IsArray())
    return;
  const auto &a = tempos->AsArray(), &b = meters->AsArray();
  std::size_t i = 0, j = 0;
  const JsonValue *tempo = nullptr, *meter = nullptr;
  while (i < a.size() || j < b.size()) {
    const auto timeA = i < a.size() ? a[i].GetNumber("seconds").value_or(0) : INFINITY;
    const auto timeB = j < b.size() ? b[j].GetNumber("seconds").value_or(0) : INFINITY;
    const auto time = std::min(timeA, timeB);
    while (i < a.size() && a[i].GetNumber("seconds").value_or(0) == time)
      tempo = &a[i++];
    while (j < b.size() && b[j].GetNumber("seconds").value_or(0) == time)
      meter = &b[j++];
    if (!tempo || !meter)
      continue;
    const auto micros = tempo->GetNumber("microsecondsPerQuarter").value_or(0);
    if (!(micros > 0))
      throw std::runtime_error("invalid MIDI tempo");
    const double bpm = 60000000. / micros;
    t.points.push_back({time,
                        tempo->GetNumber("quarter").value_or(0) +
                            (time - tempo->GetNumber("seconds").value_or(0)) * bpm / 60.,
                        meter->GetNumber("quarter").value_or(0), bpm, field(*meter, "numerator"),
                        field(*meter, "denominator")});
  }
}
} // namespace
bool isMidiControl(std::string_view type) noexcept {
  return type == "midiTransport" || type == "sfzGetPreparationContext" || type == "midiStart" ||
         type == "midiGain" || type == "midiSpeed" || type == "midiInputConfigure" ||
         type == "midiInputState" || type == "midiInputEvents" || type == "midiPause" ||
         isInstrumentControl(type);
}
void notifyMidi(Session &session, unsigned branch) {
  if (!session.pipeline())
    return;
  auto &midi = session.pipeline()->midi;
  auto &acks = inputs[branch];
  while (!acks.empty()) {
    const auto &a = acks.front();
    bool current = a.gen == midi.publishedGeneration();
    if (current && midi.deliveredBatch() < a.batch)
      break;
    send({{"type", "midiInputAccepted"},
          {"branch", double(branch)},
          {"generation", double(a.gen)},
          {"requestId", a.request},
          {"accepted", current}});
    acks.pop_front();
  }
  if (const auto gen = midi.takePaused())
    send({{"type", "midiPauseReady"},
          {"branch", double(branch)},
          {"generation", double(gen)},
          {"position", midi.lastReportedPosition()}});
  unsigned report;
  double seconds;
  std::uint64_t frame;
  if (midi.reportPosition(report, seconds, frame))
    send({{"type", "midiPosition"},
          {"branch", double(branch)},
          {"generation", double(report)},
          {"position", seconds},
          {"processedFrame", double(frame)}});
  if (const auto gen = midi.takePrepared())
    send({{"type", "midiPrepared"}, {"branch", double(branch)}, {"generation", double(gen)}});
  if (const auto gen = midi.takeEnded())
    send({{"type", "midiEnded"}, {"branch", double(branch)}, {"generation", double(gen)}});
}
void clearMidiRequests(unsigned branch) { inputs[branch].clear(); }
void retireParallelMidiRequests(DeviceHost &device) {
  if (inputs[1].empty())
    return;
  // A callback may still be rendering the just-detached branch. Retain its
  // borrowed event targets until the audio thread accepts another command.
  auto retired = std::make_shared<std::deque<PendingInput>>();
  retired->swap(inputs[1]);
  if (!device.submit([](Session &) {}, [retired] {})) {
    retired->swap(inputs[1]);
    throw std::runtime_error("audio command queue full");
  }
}
void handleMidiControl(DeviceHost &device, Session &session, const Frame &frame) {
  const auto &m = frame.message;
  const auto type = m.GetString("type");
  auto *p = session.pipeline();
  if (!p)
    throw std::runtime_error("MIDI outside session");
  const auto gen = field(m, "generation"), id = field(m, "pluginId"), token = field(m, "token"),
             branch = field(m, "branch");
  const auto anchor = position(m, "anchorFrame");
  const auto offset = m.GetUInt32("delayFrames");
  bool accepted = true;
  if (type == "midiTransport") {
    // The worklet applies a transport inside its render quantum. Apply it on
    // the audio thread too, so instrument tails and pipeline effects keep
    // rendering instead of passing through an output ownership gap.
    struct Request {
      MidiScheduler::Transport next;
      Frame frame;
      bool ok = true;
    };
    auto request = std::make_shared<Request>();
    auto &next = request->next;
    if (auto *data = m.Find("timeline"); data && !data->IsNull())
      timeline(next, *data, frame.attachment);
    next.position = m.GetNumber("position").value_or(0);
    next.speed = m.GetNumber("speed").value_or(1);
    next.gain = m.GetNumber("gain").value_or(1);
    next.generation = gen;
    next.playing = m.GetBool("playing").value_or(false);
    next.preparing = m.GetBool("preparing").value_or(false);
    next.preserveRelease = m.GetBool("preserveRelease").value_or(false);
    next.draining = m.GetString("mode") == "drain";
    const bool resume = m.GetString("mode") == "resume" && m.Find("checkpoints");
    if (resume)
      request->frame = frame;
    accepted = device.submit(
        [=, &session](Session &) {
          auto &next = request->next;
          const auto now = session.position();
          next.anchor = next.draining ? now : offset ? now + *offset : anchor;
          if (!p->midi.configure(next))
            return;
          // Configure swapped the previous timeline into the request, which the
          // control thread releases with this command.
          request->ok =
              (!resume || restoreCheckpoints(session, request->frame)) && p->prepareMidi();
          if (request->ok)
            session.power().mutation(*p);
        },
        [=] {
          if (!request->ok)
            send({{"type", "midiTransportError"},
                  {"branch", double(branch)},
                  {"generation", double(gen)}});
        });
  } else if (type == "midiPause") {
    auto ok = std::make_shared<bool>();
    accepted = device.submit(
        [=, &session](Session &) {
          const auto now = session.position(), at = offset ? now + *offset : anchor;
          *ok = at >= now && p->midi.pause(gen, at, session.format().sampleRate);
          if (*ok)
            session.power().mutation(*p);
        },
        [=] {
          if (!*ok)
            send({{"type", "midiCheckpointError"},
                  {"branch", double(branch)},
                  {"generation", double(gen)}});
        });
  } else if (isInstrumentControl(*type)) {
    handleInstrumentControl(device, session, frame);
  } else if (type == "sfzGetPreparationContext") {
    auto result = std::make_shared<Object>(
        Object{{"type", "sfzPreparationContext"}, {"branch", double(branch)}});
    if (auto *value = m.Find("requestId"))
      result->emplace("requestId", *value);
    // Read the context after transports queued before this request.
    accepted = device.submit(
        [=, &session](Session &) {
          const auto channels = p->processingChannels(id, session.format().width());
          result->emplace("ok", channels != 0);
          if (channels)
            result->emplace("context",
                            Object{{"sampleRate", double(session.format().sampleRate)},
                                   {"processingChannels", double(channels)},
                                   {"maxFrames", double(std::max(32u, session.maxBlock()))},
                                   {"minimumPhysicalBpm", p->midi.minimumBpm()}});
        },
        [=] { send(std::move(*result)); });
  } else if (type == "midiInputConfigure") {
    accepted =
        device.submit([=, &session, enabled = m.GetBool("enabled").value_or(false)](Session &) {
          if (p->midi.configureInput(gen, enabled, anchor))
            session.power().mutation(*p);
        });
  } else if (type == "midiInputState") {
    std::vector<et_midi_event> events;
    if (m.Find("eventCount")) {
      const auto count = liveCount(frame, 12);
      events.reserve(count);
      for (unsigned i = 0; i < count; ++i)
        events.push_back(liveData(frame.attachment.data() + std::size_t(i) * 12));
    } else {
      for (const auto &e : array(m, "events"))
        events.push_back(decode(e, field(e, "noteId")));
    }
    accepted = device.submit(
        [=, items = std::move(events)](Session &) { p->hydrateMidi(id, token, gen, items); });
  } else if (type == "midiInputEvents") {
    const auto request = m.Find("requestId") ? *m.Find("requestId") : JsonValue();
    auto data = std::make_shared<InputBatch>();
    auto append = [&](et_midi_event event, std::uint64_t at, std::size_t targetStart) {
      auto targets = std::span(data->targets).subspan(targetStart);
      std::sort(targets.begin(), targets.end(),
                [](const auto &a, const auto &b) { return a.id < b.id; });
      data->events.push_back({event, at, targets});
    };
    if (m.Find("eventCount")) {
      const auto count = m.GetUInt32("eventCount").value_or(0);
      const auto bytes = frame.attachment.size();
      const auto headers = std::uint64_t(count) * 24;
      if (count > 4096 || bytes < headers || (bytes - headers) % 8)
        throw std::runtime_error("invalid live MIDI events");
      data->events.reserve(count);
      data->targets.reserve(static_cast<std::size_t>((bytes - headers) / 8));
      std::size_t offsetBytes = 0;
      for (unsigned i = 0; i < count; ++i) {
        if (bytes - offsetBytes < 24)
          throw std::runtime_error("incomplete live MIDI event");
        const auto *record = frame.attachment.data() + offsetBytes;
        const auto at = load<double>(record + 12);
        if (!std::isfinite(at) || at < 0 || at > 9007199254740991. || std::floor(at) != at)
          throw std::runtime_error("invalid live MIDI frame");
        const auto n = load<unsigned>(record + 20);
        offsetBytes += 24;
        if (n > 128 || n > (bytes - offsetBytes) / 8 ||
            n > data->targets.capacity() - data->targets.size())
          throw std::runtime_error("invalid live MIDI target count");
        const auto targetStart = data->targets.size();
        for (unsigned j = 0; j < n; ++j) {
          const auto *target = frame.attachment.data() + offsetBytes;
          data->targets.push_back({load<unsigned>(target), load<unsigned>(target + 4)});
          offsetBytes += 8;
        }
        append(liveData(record), static_cast<std::uint64_t>(at), targetStart);
      }
      if (bytes != offsetBytes)
        throw std::runtime_error("invalid live MIDI target buffer");
    } else {
      unsigned serial = 0;
      const auto &events = array(m, "events");
      std::size_t targetCount = 0;
      for (const auto &e : events)
        targetCount += array(e, "targets").size();
      data->targets.reserve(targetCount);
      for (const auto &e : events) {
        const auto start = data->targets.size();
        for (const auto &target : array(e, "targets"))
          data->targets.push_back({field(target, "id"), field(target, "token")});
        append(decode(e, ++serial), position(e, "frame"), start);
      }
    }
    auto batch = std::make_shared<std::uint64_t>(0);
    accepted = device.submit(
        [=, &session](Session &) {
          if (p->midi.enqueue(gen, data->events)) {
            *batch = p->midi.lastBatch();
            session.power().mutation(*p);
          }
        },
        [=] {
          if (*batch) {
            inputs[branch].push_back({gen, *batch, request, data});
            return;
          }
          send({{"type", "midiInputAccepted"},
                {"branch", double(branch)},
                {"requestId", request},
                {"generation", double(gen)},
                {"accepted", false}});
        });
  } else if (type == "midiStart") {
    accepted = device.submit([=, &session](Session &) {
      if (p->midi.start(gen, offset ? session.position() + *offset : anchor))
        session.power().mutation(*p);
    });
  } else if (type == "midiSpeed") {
    accepted = device.submit([p, &session, speed = m.GetNumber("speed").value_or(1)](Session &) {
      p->midi.speed(speed, session.position(), session.format().sampleRate);
    });
  } else if (type == "midiGain") {
    accepted = device.submit(
        [p, gain = m.GetNumber("gain").value_or(1)](Session &) { p->midi.gain(gain); });
  }
  if (!accepted)
    throw std::runtime_error("audio command queue full");
}
} // namespace effetune::audio

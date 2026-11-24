#include "instrument_control.h"
#include "engine.h"
#include "host/pipeline.h"
#include <cmath>
#include <functional>
#include <iostream>
#include <memory>
#include <optional>
#include <string>

namespace effetune::audio {
namespace {
using Object = JsonValue::Object;
using List = JsonValue::Array;
using Instrument = Pipeline::Instrument;
constexpr unsigned maxCheckpoint = 32 * 1024 * 1024;
void send(Object result, std::vector<std::uint8_t> bytes = {}) {
  writeFrame(std::cout, {FrameKind::Control, std::move(result), std::move(bytes)});
}
unsigned number(const JsonValue &m, const char *key) { return m.GetUInt32(key).value_or(0); }
Object capture(Session &s, const Instrument &i, std::vector<std::uint8_t> &bytes, bool pause) {
  const unsigned k = i.target.instance;
  auto &e = i.engine;
  if (pause && e.setInstanceMidiEvents(k, nullptr, 0, std::max(1u, e.instanceMidiGeneration(k)),
                                       ET_MIDI_PAUSE) != ET_OK)
    throw std::runtime_error("instrument pause failed");
  const auto n = e.instanceMidiCheckpointSize(k);
  if (!n || n > maxCheckpoint || bytes.size() + n > 1024ull * 1024 * 1024)
    throw std::runtime_error("instrument checkpoint size");
  const unsigned offset = static_cast<unsigned>(bytes.size());
  bytes.resize(offset + n);
  if (e.writeInstanceMidiCheckpoint(k, bytes.data() + offset, n) != ET_OK)
    throw std::runtime_error("instrument checkpoint export failed");
  Object record{{"pluginId", double(i.target.id)},
                {"type", i.settings.type},
                {"sf", i.settings.sf},
                {"channel", double(i.settings.midiChannelMask)},
                {"instanceId", double(k)},
                {"instanceEpoch", double(k)},
                {"token", double(i.target.token)},
                {"sampleRate", double(s.format().sampleRate)},
                {"captureFrame", double(s.position())},
                {"nativeState", double(e.instanceMidiState(k))},
                {"graph", double(s.power().config().graph)},
                {"generation", double(e.instanceMidiGeneration(k))},
                {"clockFrame", double(e.instanceMidiClock(k))},
                {"cursor", double(s.pipeline()->midi.cursor(k))},
                {"byteOffset", double(offset)},
                {"byteLength", double(n)}};
  if (i.replayEpoch)
    record.emplace("replayEpoch", double(*i.replayEpoch));
  return record;
}
bool restore(Session &s, const Instrument &i, const JsonValue &r,
             std::span<const std::uint8_t> bytes, bool midi) {
  const auto offset = number(r, "byteOffset"), len = number(r, "byteLength"),
             rate = number(r, "sampleRate");
  const bool migration = r.GetBool("plannedMigration").value_or(false);
  if (!rate || !len || len > maxCheckpoint || offset > bytes.size() ||
      len > bytes.size() - offset || number(r, "pluginId") != i.target.id ||
      r.GetString("sf").value_or("") != i.settings.sf || r.GetString("type") != i.settings.type ||
      number(r, "channel") != i.settings.midiChannelMask ||
      (!migration &&
       (rate != s.format().sampleRate || number(r, "instanceId") != i.target.instance ||
        number(r, "instanceEpoch") != i.target.instance || number(r, "token") != i.target.token ||
        r.GetUInt32("replayEpoch") != i.replayEpoch)))
    return false;
  if (i.engine.readInstanceMidiCheckpoint(i.target.instance, bytes.data() + offset, len) != ET_OK)
    return false;
  return !midi || s.pipeline()->midi.restoreCursor(i.target, number(r, "cursor"),
                                                   i.engine.instanceMidiClock(i.target.instance));
}
struct MixerAction {
  unsigned token = 0, channel = 0, mix = 0, count = 0;
  std::optional<unsigned> replayEpoch;
  std::array<et_midi_event, 3> events{};
};
std::optional<MixerAction> mixerAction(const JsonValue &m) {
  const auto *a = m.Find("action");
  if (!a)
    return std::nullopt;
  MixerAction action;
  action.token = number(m, "token");
  action.replayEpoch = m.GetUInt32("replayEpoch");
  action.channel = a->GetUInt32("channel").value_or(16);
  if (action.channel > 15)
    return std::nullopt;
  auto kind = a->GetString("type");
  if (kind == "mute" || kind == "solo") {
    auto v = a->GetBool("value");
    if (!v)
      return std::nullopt;
    action.mix = (kind == "solo" ? 2u : 0u) + static_cast<unsigned>(*v);
    return action;
  }
  const auto add = [&](unsigned status, unsigned d1, unsigned d2) {
    action.events[action.count++].message = status | action.channel | (d1 << 8) | (d2 << 16);
  };
  if (kind == "program") {
    auto bank = a->GetUInt32("bank"), program = a->GetUInt32("program");
    if (!bank || *bank > 128 || !program || *program > 127)
      return std::nullopt;
    if (*bank < 128) {
      const bool xg = a->GetBool("xg").value_or(false);
      add(0xb0, 0, xg ? 0 : *bank);
      add(0xb0, 32, xg ? *bank : 0);
    }
    add(0xc0, *program, 0);
  } else if (kind == "control") {
    auto cc = a->GetUInt32("controller"), v = a->GetUInt32("value");
    if (!cc || (*cc != 7 && *cc != 10 && *cc != 11 && *cc != 91 && *cc != 93) || !v || *v > 127)
      return std::nullopt;
    add(0xb0, *cc, *v);
  } else
    return std::nullopt;
  return action;
}
bool applyMixer(const Instrument &t, const MixerAction &action) {
  if (t.settings.type != "SoundFontPlayerPlugin" || !t.target.ready ||
      t.target.token != action.token || t.replayEpoch != action.replayEpoch)
    return false;
  if (!action.count)
    return t.engine.setInstanceMidiChannelMix(t.target.instance, action.channel, action.mix) ==
           ET_OK;
  return t.engine.setInstanceMidiEvents(t.target.instance, action.events.data(), action.count,
                                        t.engine.instanceMidiGeneration(t.target.instance),
                                        ET_MIDI_CONTROL_ONLY) == ET_OK;
}
Object mixerReply(const JsonValue &m) {
  Object result{{"type", "soundFontMixerActionApplied"},
                {"branch", double(number(m, "branch"))},
                {"ok", false},
                {"checkpoints", List{}}};
  if (const auto *request = m.Find("requestId"))
    result.emplace("requestId", *request);
  return result;
}
struct Reply {
  Object result;
  std::vector<std::uint8_t> bytes;
  std::optional<Object> identity;
};
// Instrument state belongs to the audio thread, as in the worklet. Apply each
// request as one audio command and send its reply from the control thread.
void submitReply(DeviceHost &host, Object result, std::function<void(Reply &)> action) {
  auto reply = std::make_shared<Reply>(Reply{std::move(result), {}, {}});
  if (!host.submit([reply, action = std::move(action)](Session &) { action(*reply); },
                   [reply] {
                     if (reply->identity)
                       send(std::move(*reply->identity));
                     send(std::move(reply->result), std::move(reply->bytes));
                   }))
    throw std::runtime_error("audio command queue full");
}
} // namespace
bool isInstrumentControl(std::string_view t) noexcept {
  return t == "sfzCaptureCheckpoints" || t == "sfzStartRuntime" || t == "midiCaptureCheckpoint" ||
         t == "sfzResumeRuntime" || t == "soundFontMidiMetering" || t == "soundFontMixerAction";
}
bool restoreCheckpoints(Session &s, const Frame &f) {
  auto *a = f.message.Find("checkpoints");
  if (!a || !a->IsArray())
    return false;
  for (const auto &r : a->AsArray()) {
    auto t = s.pipeline()->instrument(number(r, "pluginId"));
    if (t && !restore(s, *t, r, f.attachment, true))
      return false;
  }
  return true;
}
void handleInstrumentControl(DeviceHost &host, Session &s, const Frame &f) {
  const auto &m = f.message;
  auto type = m.GetString("type");
  const auto branch = number(m, "branch"), id = number(m, "pluginId");
  auto &p = *s.pipeline();
  if (type == "soundFontMixerAction") {
    auto result = mixerReply(m);
    const auto action = mixerAction(m);
    if (!action) {
      send(std::move(result));
      return;
    }
    submitReply(host, std::move(result), [action = *action, id, &s, &p](Reply &r) {
      try {
        const auto i = p.instrument(id);
        if (!i || !applyMixer(*i, action))
          return;
        List checkpoints;
        // The paused checkpoint must contain the edited controllers.
        if (action.count && p.midi.paused())
          checkpoints.emplace_back(capture(s, *i, r.bytes, false));
        r.result.insert_or_assign("checkpoints", std::move(checkpoints));
        r.result.emplace("appliedFrame", double(s.position()));
        r.result.insert_or_assign("ok", true);
        s.power().mutation(p);
      } catch (const std::exception &) {
        r.bytes.clear();
      }
    });
    return;
  }
  if (type == "sfzResumeRuntime") {
    if (!host.submit([&p](Session &) { p.resumeInstruments(); }))
      throw std::runtime_error("audio command queue full");
    return;
  }
  if (type == "soundFontMidiMetering") {
    const auto epoch = number(m, "instanceEpoch");
    auto enabled = m.GetBool("enabled");
    if (enabled && !host.submit([=, &p](Session &) {
          auto i = p.instrument(id);
          if (i && i->target.instance == epoch)
            i->engine.setInstanceMidiMetering(epoch, *enabled);
        }))
      throw std::runtime_error("audio command queue full");
    return;
  }
  Object result{{"branch", double(branch)}};
  if (auto *request = m.Find("requestId"))
    result.emplace("requestId", *request);
  auto request = std::make_shared<const Frame>(f);
  submitReply(
      host, std::move(result), [request, type = std::string(*type), branch, id, &s, &p](Reply &r) {
        const auto &m = request->message;
        auto &result = r.result;
        auto &bytes = r.bytes;
        List records;
        bool ok = true;
        try {
          if (type == "midiCaptureCheckpoint" || type == "sfzCaptureCheckpoints") {
            const bool midi = type == "midiCaptureCheckpoint";
            result.emplace("type", midi ? "midiCheckpoints" : "sfzCheckpoints");
            result.emplace("generation", double(p.midi.generation()));
            result.emplace("position", p.midi.position(s.position(), s.format().sampleRate));
            if (midi && (!p.midi.paused() || p.midi.generation() != number(m, "generation")))
              throw std::runtime_error("stale MIDI checkpoint");
            if (!midi && m.GetString("reason") == "monitoring") {
              const auto *proof = m.Find("proof");
              const auto &state = s.power().state();
              if (!s.power().checkpointRequested() || !proof ||
                  proof->GetNumber("activityEpoch") != double(state.activityEpoch) ||
                  proof->GetNumber("runtimeRevision") != double(p.runtimeRevision()) ||
                  number(*proof, "workletGraphGeneration") != state.graph ||
                  number(*proof, "topologyRevision") != state.topology ||
                  proof->GetNumber("commandId") != double(state.command) ||
                  proof->GetNumber("skipEpoch") != double(state.epoch) ||
                  number(*proof, "midiGeneration") != p.midi.generation() ||
                  state.arm != PowerState::Arm::armed)
                throw std::runtime_error("stale instrument power proof");
            }
            for (auto plugin : p.instrumentIds()) {
              auto i = p.instrument(plugin);
              if (!i || (midi && !i->target.enabled))
                continue;
              const bool unused =
                  i->settings.type == "SoundFontPlayerPlugin" && !p.midi.generation();
              if (unused && (midi || m.GetString("reason") == "graph"))
                continue;
              if (!midi && m.GetString("reason") != "graph" && i->target.enabled &&
                  !p.midi.paused() && (i->engine.instanceMidiState(i->target.instance) & 23))
                throw std::runtime_error("instrument is active");
              auto record = capture(s, *i, bytes, !midi && !p.midi.paused());
              if (!midi) {
                if (i->engine.resetInstance(i->target.instance) != ET_OK ||
                    !restore(s, *i, record, bytes, false))
                  throw std::runtime_error("instrument verification failed");
                p.freeze(plugin, s.position(), unused, true, false);
              }
              records.emplace_back(std::move(record));
            }
          } else if (type == "sfzStartRuntime") {
            result.emplace("type", "sfzRuntimeStarted");
            auto i = p.instrument(id);
            if (!i || i->target.token != number(m, "token"))
              throw std::runtime_error("stale instrument");
            auto *checkpoint = m.Find("checkpoint");
            const bool restoring = checkpoint && !checkpoint->IsNull();
            if (restoring) {
              if (!restore(s, *i, *checkpoint, request->attachment, false))
                throw std::runtime_error("instrument restore failed");
              records.emplace_back(capture(s, *i, bytes, false));
            }
            if (i->settings.type == "SFZNotePlayerPlugin") {
              const auto k = i->target.instance;
              const bool deferred = m.GetBool("deferStart").value_or(false);
              const bool streamed = p.sampleStream(id) != nullptr;
              if (restoring) {
                p.freeze(id,
                         static_cast<std::uint64_t>(
                             std::max(0., checkpoint->GetNumber("captureFrame").value_or(0))),
                         false, checkpoint->GetBool("sameContext").value_or(true), !deferred);
              } else {
                const auto gen = std::max(1u, i->engine.instanceMidiGeneration(k));
                if (i->engine.setInstanceMidiEvents(k, nullptr, 0, gen, ET_MIDI_RETIME) != ET_OK ||
                    i->engine.setInstanceMidiClock(
                        k, i->engine.instanceMidiClock(k), gen,
                        deferred || streamed ? 0 : ET_MIDI_CLOCK_RUNNING) != ET_OK)
                  throw std::runtime_error("instrument clock failed");
                if (deferred || streamed)
                  p.freeze(id, s.position(), true, false, !deferred);
              }
            }
            r.identity = Object{{"type", "sfzRuntimeIdentity"},
                                {"branch", double(branch)},
                                {"pluginId", double(id)},
                                {"instanceId", double(i->target.instance)},
                                {"instanceEpoch", double(i->target.instance)},
                                {"token", double(i->target.token)}};
          }
        } catch (const std::exception &) {
          ok = false;
          bytes.clear();
          records.clear();
          if (type == "midiCaptureCheckpoint")
            result.insert_or_assign("type", "midiCheckpointError");
          else if (type == "sfzCaptureCheckpoints")
            p.resumeInstruments();
        }
        result.emplace("ok", ok);
        result.emplace("checkpoints", std::move(records));
      });
}
} // namespace effetune::audio

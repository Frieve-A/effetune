#include "power_control.h"
#include "host/pipeline.h"
#include <algorithm>
#include <cmath>
#include <iostream>
namespace effetune::audio {
namespace {
using Object = JsonValue::Object;
struct ObservationRequest {
  std::int64_t tag;
  unsigned graph, topology;
  JsonValue id;
};
std::array<std::deque<ObservationRequest>, 2> requests;
std::int64_t nextTag = 0;
void send(Object m) { writeFrame(std::cout, {FrameKind::Control, std::move(m), {}}); }
void refreshDisplay(DeviceHost &host, Session &session, bool bypass) {
  std::shared_ptr<Pipeline::TopologyChange> change = session.pipeline()->prepareDisplay(bypass);
  if (!change)
    return;
  auto ok = std::make_shared<bool>();
  host.beginAsset();
  if (!host.submit([=](Session &) { *ok = change->capture(); },
                   [=, &host] {
                     if (!*ok || !change->prepare()) {
                       host.endAsset();
                       return;
                     }
                     if (!host.submit([=](Session &) { *ok = change->publish(); },
                                      [&host] { host.endAsset(); }))
                       throw std::runtime_error("audio command queue full");
                   }))
    throw std::runtime_error("audio command queue full");
}
constexpr const char *names[]{"full-process", "allow-automatic", "force-monitoring",
                              "bypass-transport", "zero-output-transport"};
Directive directive(std::optional<std::string_view> value) {
  for (unsigned i = 0; i < std::size(names); ++i)
    if (value == names[i])
      return static_cast<Directive>(i);
  return Directive::full;
}
std::int64_t number(const JsonValue &m, const char *key) {
  const auto n = m.GetNumber(key);
  return n && *n >= 0 && *n <= 9007199254740991. && std::floor(*n) == *n
             ? static_cast<std::int64_t>(*n)
             : -1;
}
JsonValue optional(std::int64_t value) {
  return value < 0 ? JsonValue() : JsonValue(double(value));
}
Object fields(const PowerState &s, unsigned branch) {
  const bool armed = s.arm != PowerState::Arm::disarmed;
  return {{"branch", double(branch)},
          {"workletGraphGeneration", double(s.graph)},
          {"topologyRevision", double(s.topology)},
          {"commandId", optional(s.command)},
          {"skipEpoch", optional(s.epoch)},
          {"renderSequence", double(s.sequence)},
          {"state", s.monitoring ? "monitoring" : "active"},
          {"processingDirective", names[static_cast<unsigned>(s.directive)]},
          {"inputActive", s.inputActive},
          {"outputActive", s.outputActive},
          {"inputPower", s.inputPower},
          {"outputPower", s.outputPower},
          {"midiPending", s.midiPending},
          {"midiGeneration", double(s.midiGeneration)},
          {"sfzPending", s.sfzPending},
          {"sfzRuntimeRevision", double(s.runtimeRevision)},
          {"skippedFrameCount", double(s.skipped)},
          {"observationRequestId", optional(s.observation)},
          {"monitoringFastWakeEligible", s.fast},
          {"monitoringFastWakeBlockerReason",
           s.fast ? JsonValue() : JsonValue("temporal-preparation-not-worklet-local")},
          {"automaticMonitoringArm",
           Object{{"state", !armed                            ? "disarmed"
                            : s.arm == PowerState::Arm::armed ? "armed"
                                                              : "consumed"},
                  {"commandId", optional(armed ? s.command : -1)},
                  {"skipEpoch", optional(armed ? s.epoch : -1)},
                  {"armAfterRenderSequence", optional(armed ? s.armSequence : -1)}}},
          {"counters", Object{{"fullProcessQuanta", double(s.fullQuanta)},
                              {"fullWasmProcessQuanta", double(s.fullQuanta)},
                              {"monitoringQuanta", double(s.monitorQuanta)},
                              {"bypassTransportQuanta", double(s.bypassQuanta)},
                              {"zeroOutputTransportQuanta", double(s.zeroQuanta)}}}};
}
PowerConfig configuration(const JsonValue &m, unsigned rate) {
  PowerConfig c;
  c.enabled = m.GetBool("enabled").value_or(false);
  c.graph = m.GetUInt32("workletGraphGeneration").value_or(0);
  c.topology = m.GetUInt32("topologyRevision").value_or(0);
  c.fast = m.GetBool("monitoringFastWakeEligible").value_or(false);
  c.skip = m.GetBool("temporalSkipEligible").value_or(false);
  c.wakeAny = m.GetBool("wakeOnAnyInput").value_or(false);
  c.telemetry = m.GetBool("uiTelemetryEnabled").value_or(true);
  c.displayBypass = m.GetBool("displayDspBypassed").value_or(false);
  c.rate = rate;
  c.pluginCount = m.GetUInt32("enabledPluginCount").value_or(0);
  const auto db = m.GetNumber("silenceThresholdDb").value_or(-80);
  c.threshold = std::pow(10., db / 10.);
  c.wakeFloor = std::pow(10., (db - m.GetNumber("wakeGainMarginDb").value_or(0)) / 10.);
  c.seconds = std::max(0., m.GetNumber("silenceDurationSeconds").value_or(1.));
  if (const auto *cap = m.Find("monitoringPreparationCapabilities"); cap && cap->IsArray())
    for (const auto &item : cap->AsArray()) {
      const auto id = item.GetUInt32("pluginId");
      const auto kind = item.GetString("capability");
      if (!id || c.count >= c.ids.size() ||
          std::find(c.ids.begin(), c.ids.begin() + c.count, *id) != c.ids.begin() + c.count) {
        c.coverageValid = false;
        break;
      }
      c.ids[c.count++] = *id;
      if (kind == "reset-on-resume") {
        const auto *descriptor = item.Find("descriptor");
        if (descriptor && !descriptor->IsNull() &&
            descriptor->GetString("primitive") != "canonical-reset")
          c.coverageValid = false;
        c.resets[c.resetCount++] = *id;
      } else if (kind != "stateless")
        c.coverageValid = false;
    }
  return c;
}
} // namespace
bool isPowerControl(std::string_view type) noexcept {
  return type == "configurePowerPolicy" || type == "setPowerProcessingState" ||
         type == "requestPowerObservation" || type == "setUiTelemetryEnabled" ||
         type == "setDisplayDspBypassed" || type == "prepareTemporalStateAndResume" ||
         type == "userActivity" || type == "updateSilenceThreshold";
}
void handlePowerControl(DeviceHost &host, Session &s, const Frame &frame) {
  if (!s.isOpen())
    return;
  const auto &m = frame.message;
  const auto type = m.GetString("type").value_or("");
  if (type == "userActivity" || type == "updateSilenceThreshold") {
    const bool activity = type == "userActivity";
    auto threshold = m.GetNumber("threshold");
    if (!host.submit([=, &s](Session &) {
          if (activity)
            s.power().activity();
          else if (threshold)
            s.power().threshold(*threshold);
        }))
      throw std::runtime_error("audio command queue full");
    return;
  }
  const auto branch = m.GetUInt32("branch").value_or(0),
             graph = m.GetUInt32("workletGraphGeneration").value_or(0),
             topo = m.GetUInt32("topologyRevision").value_or(0);
  const auto id = number(m, "commandId"), epoch = number(m, "skipEpoch");
  struct Response {
    PowerState state;
    bool send = false, ok = false;
    unsigned count = 0, resets = 0;
    std::optional<bool> display{};
  };
  auto reply = std::make_shared<Response>();
  std::function<void(Session &)> apply;
  if (type == "configurePowerPolicy") {
    auto config = configuration(m, s.format().sampleRate);
    const auto guard = directive(m.GetString("hostGuardDirective"));
    const auto guardEpoch = number(m, "hostGuardSkipEpoch");
    apply = [=, &s](Session &) {
      auto &power = s.power();
      power.configure(config, *s.pipeline(), guard, id, guardEpoch);
      s.telemetry()->enabled = config.telemetry;
      reply->display = config.enabled && config.displayBypass;
      reply->state = power.state();
      reply->send = config.enabled;
      reply->ok = true;
    };
  } else {
    const auto dir = directive(m.GetString("processingDirective"));
    const auto after = number(m, "armAfterRenderSequence");
    const auto preserve = m.GetBool("preserveHostSkipState").value_or(false);
    std::int64_t requested = -1;
    if (type == "requestPowerObservation") {
      if (const auto *value = m.Find("observationRequestId");
          value && (value->IsNumber() || value->IsString())) {
        requested = ++nextTag;
        auto &queue = requests.at(branch);
        if (queue.size() >= 128)
          queue.pop_front();
        queue.push_back({requested, graph, topo, *value});
      }
    }
    const auto resume = number(m, "resumeCommandId");
    const auto telemetry = m.GetBool("enabled").value_or(false);
    const auto displayBypass = m.GetBool("bypassed").value_or(false);
    const auto ownedType = std::string(type);
    apply = [=, &s](Session &) {
      auto &power = s.power();
      if (ownedType == "requestPowerObservation" && !power.enabled()) {
        power.requestWhileDisabled(requested, graph, topo, s.format().sampleRate);
        return;
      }
      if (!power.enabled() || power.state().graph != graph || power.state().topology != topo)
        return;
      if (ownedType == "requestPowerObservation") {
        power.request(requested);
        return;
      }
      if (ownedType == "setDisplayDspBypassed") {
        power.setDisplayBypass(displayBypass);
        reply->display = displayBypass;
        return;
      }
      if (ownedType == "setUiTelemetryEnabled") {
        s.telemetry()->enabled = telemetry;
        reply->ok = true;
      } else if (ownedType == "prepareTemporalStateAndResume") {
        reply->ok = power.resume(*s.pipeline(), id, epoch, resume);
        reply->count = power.config().count;
        reply->resets = power.config().resetCount;
      } else
        reply->ok = power.command(dir, id, epoch, after, preserve);
      reply->state = power.state();
      reply->send = true;
    };
  }
  Object extra;
  for (const auto *key :
       {"commandId", "ownerOperationId", "resumeCommandId", "ackCommandId", "origin"})
    if (const auto *v = m.Find(key))
      extra.emplace(key, *v);
  const auto command = std::string(type);
  const bool automatic = m.GetString("processingDirective") == "allow-automatic";
  const bool telemetry = m.GetBool("enabled").value_or(false);
  if (!host.submit(std::move(apply), [=, &host, &s, extra = std::move(extra)]() mutable {
        if (reply->display)
          refreshDisplay(host, s, *reply->display);
        if (!reply->send)
          return;
        auto out = fields(reply->state, branch);
        out.insert_or_assign("type", command == "prepareTemporalStateAndResume"
                                         ? "temporalStateResumed"
                                         : "powerStateAck");
        for (auto &[key, v] : extra)
          out.insert_or_assign(key, std::move(v));
        if (command == "configurePowerPolicy")
          out.emplace("configured", true);
        if (command == "setUiTelemetryEnabled")
          out.emplace("uiTelemetryEnabled", telemetry);
        if (command == "setPowerProcessingState") {
          out.emplace("commandAccepted", reply->ok);
          out.emplace("automaticArmAccepted", automatic ? JsonValue(reply->ok) : JsonValue());
          out.emplace("commandRejectedReason",
                      reply->ok ? JsonValue() : JsonValue("unsafe-power-command"));
        }
        if (command == "prepareTemporalStateAndResume") {
          out.insert_or_assign("state", reply->ok ? "acknowledged" : "error");
          out.insert_or_assign("skipEpoch", optional(epoch));
          out.emplace("enabledPluginCount", double(reply->count));
          out.emplace("coveredPluginCount", double(reply->ok ? reply->count : 0));
          out.emplace("appliedPolicyCounts",
                      Object{{"stateless", double(reply->count - reply->resets)},
                             {"resetOnResume", double(reply->resets)},
                             {"agedBySkippedFrames", 0.},
                             {"mustProcess", 0.}});
          out.emplace("errorCode", reply->ok
                                       ? JsonValue()
                                       : JsonValue("temporal-prevalidated-coverage-mismatch"));
        }
        send(std::move(out));
      }))
    throw std::runtime_error("audio command queue full");
}
void notifyPower(DeviceHost &host, Session &s, unsigned branch) {
  if (!s.isOpen())
    return;
  PowerEvent e;
  while (s.power().take(e)) {
    if (e.type == PowerEvent::Type::instrumentCheckpoint) {
      send({{"type", "sfzCheckpointNeeded"},
            {"branch", double(branch)},
            {"proof", Object{{"workletGraphGeneration", double(e.state.graph)},
                             {"topologyRevision", double(e.state.topology)},
                             {"commandId", double(e.state.command)},
                             {"skipEpoch", double(e.state.epoch)},
                             {"activityEpoch", double(e.state.activityEpoch)},
                             {"runtimeRevision", double(e.state.runtimeRevision)},
                             {"midiGeneration", double(e.state.midiGeneration)}}}});
      continue;
    }
    auto out = fields(e.state, branch);
    out.emplace("type", e.type == PowerEvent::Type::first         ? "powerFirstRender"
                        : e.type == PowerEvent::Type::observation ? "powerObservation"
                                                                  : "powerHeartbeat");
    out.emplace("reason", e.reason ? JsonValue(e.reason) : JsonValue());
    out.emplace("deviceDiscontinuities", double(host.discontinuities()));
    out.emplace("callbackOverruns", double(host.callbackOverruns()));
    out.emplace("telemetryDroppedFrames", double(s.telemetry()->dropped()));
    if (e.type == PowerEvent::Type::observation && e.state.observation >= 0) {
      auto &queue = requests.at(branch);
      while (!queue.empty() && queue.front().tag <= e.state.observation) {
        auto request = std::move(queue.front());
        queue.pop_front();
        if (request.graph != e.state.graph || request.topology != e.state.topology)
          continue;
        out.insert_or_assign("observationRequestId", std::move(request.id));
        send(out);
      }
      continue;
    }
    out.insert_or_assign("observationRequestId", nullptr);
    send(std::move(out));
  }
}
void clearPowerRequests(unsigned branch) { requests.at(branch).clear(); }
} // namespace effetune::audio

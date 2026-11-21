#include "network_reports.h"
#include "device_host.h"
#include "frame.h"
#include "host/io_pipeline.h"
#include "host/network_paths.h"
#include "host/pipeline.h"
#include <iostream>
#include <stdexcept>

namespace effetune::audio {
namespace {
using Object = JsonValue::Object;
void send(Object value) { writeFrame(std::cout, {FrameKind::Control, std::move(value), {}}); }
JsonValue optionalId(unsigned id) { return id ? JsonValue(double(id)) : JsonValue(nullptr); }
JsonValue delay(std::int64_t value) {
  return value >= 0 ? JsonValue(double(value)) : JsonValue(nullptr);
}
Object path(const Engine::RoutedDelay &d) {
  return {{"localSamples", delay(d.local)}, {"networkSamples", delay(d.network)}};
}
void publish(const NetworkPaths &p, unsigned branch) {
  const double revision = double(p.revision);
  send({{"type", "networkRoute"},
        {"branch", double(branch)},
        {"sendId", optionalId(p.sendId)},
        {"receiveId", optionalId(p.receiveId)},
        {"receiveActive", p.receiving},
        {"generation", double(p.generation)},
        {"revision", revision},
        {"localDelaySamples", double(p.localDelay)},
        {"visualizerTapStage", p.stage}});
  Object taps, dsp;
  JsonValue sender(nullptr), receiver(nullptr);
  for (unsigned i = 0; i < p.count; ++i) {
    const auto id = p.pluginIds[i];
    if (!id)
      continue;
    const auto &tap = p.taps[i];
    if (id == p.sendId)
      sender = path(tap.input);
    if (id == p.receiveId)
      receiver = path(tap.input);
    const auto key = std::to_string(id);
    taps.emplace(key, Object{{"input", path(tap.input)}, {"output", path(tap.output)}});
    dsp.emplace(key, Object{{"input", double(p.latencies[i].input)},
                            {"output", double(p.latencies[i].output)},
                            {"execution", "wasm"},
                            {"instanceId", double(tap.instance)}});
  }
  send({{"type", "networkPaths"},
        {"branch", double(branch)},
        {"revision", revision},
        {"tapRevision", double(p.tapRevision)},
        {"sampleRate", double(p.sampleRate)},
        {"outputDelaySamples", double(p.outputDelay)},
        {"localDelaySamples", double(p.localDelay)},
        {"localDelayRevision", double(p.localDelayRevision)},
        {"visualizerTapStage", p.stage},
        {"send", std::move(sender)},
        {"receive", std::move(receiver)},
        {"taps", std::move(taps)}});
  send({{"type", "dspLatency"},
        {"branch", double(branch)},
        {"samples", double(p.latency)},
        {"sampleRate", double(p.sampleRate)},
        {"compensated", !p.bypassed},
        {"taps", std::move(dsp)}});
}
} // namespace

void reportNetworkPaths(DeviceHost &host, unsigned branch) {
  auto *s = host.session.branch(branch);
  if (!s || !s->isOpen())
    return;
  auto p = std::make_shared<NetworkPaths>();
  if (!host.submit(
          [s, p](Session &) {
            const auto *io = s->io();
            s->pipeline()->traceOutputs(*p);
            p->revision = io->routeRevision;
            p->tapRevision = io->tapRevision;
            p->localDelayRevision = io->localDelayRevision;
            p->generation = io->receiveGeneration;
            p->receiving = io->receiving;
            p->sampleRate = s->format().sampleRate;
            p->latency = s->latency();
            p->outputDelay = s->output().appliedDelay();
            p->localDelay = io->delay.samples();
            constexpr const char *stages[] = {"pipeline", "local", "send", "network"};
            p->stage = stages[static_cast<unsigned>(visualizerStage(
                io->delay.active(), io->visualSync, p->sendId != 0, io->receiving))];
          },
          [p, branch] { publish(*p, branch); }))
    throw std::runtime_error("network report queue full");
}

void checkNetworkDelays(DeviceHost &host) {
  for (unsigned branch = 0; branch < 2; ++branch) {
    auto *s = host.session.branch(branch);
    auto *io = s ? s->io() : nullptr;
    if (!io)
      continue;
    const bool l0Applied =
        io->pendingDelayRequest &&
        io->appliedDelayRequest.load(std::memory_order_acquire) == io->pendingDelayRequest;
    if (l0Applied) {
      send({{"type", "networkDelayApplied"},
            {"branch", double(branch)},
            {"requestId", double(io->pendingDelayRequest)},
            {"localDelaySamples", double(io->requestedLocalDelay)}});
      io->pendingDelayRequest = 0;
    }
    const unsigned outputDelay = s->output().appliedDelay();
    if (io->reportedOutputDelay != outputDelay) {
      io->reportedOutputDelay = outputDelay;
      if (!host.submit([io](Session &) { io->markTapChanged(); }))
        throw std::runtime_error("network delay revision queue full");
      reportNetworkPaths(host, branch);
    } else if (l0Applied) {
      reportNetworkPaths(host, branch);
    }
  }
}
} // namespace effetune::audio

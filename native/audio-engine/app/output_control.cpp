#include "output_control.h"
#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstring>
#include <iostream>
namespace effetune::audio {
namespace {
using Object = JsonValue::Object;
void send(Object message) { writeFrame(std::cout, {FrameKind::Control, std::move(message), {}}); }
} // namespace
bool isOutputControl(std::string_view type) noexcept {
  return type == "requestDspLatency" || type == "setOutputDelay" || type == "fadeOutput" ||
         type == "awaitOutputReady" || type == "setVisualizerSources" || type == "setSpectrumTap" ||
         type == "setSpectrumTapRoute" || type == "streamBoundary" ||
         type == "setAudioProcessingOverloadMonitoring";
}
void handleOutputControl(DeviceHost &host, Session &branch, const Frame &frame) {
  if (!branch.isOpen())
    throw std::runtime_error("output request outside session");
  const auto &m = frame.message;
  const auto type = m.GetString("type");
  const auto branchId = m.GetUInt32("branch").value_or(0);
  if (type == "setAudioProcessingOverloadMonitoring") {
    if (!host.submit([&branch, on = m.GetBool("enabled").value_or(false),
                      delay = m.GetNumber("delaySeconds").value_or(0.),
                      headroom = m.GetNumber("headroomMs").value_or(0.)](Session &) {
          branch.overload(on, delay, headroom);
        }))
      throw std::runtime_error("audio command queue full");
    return;
  }
  if (type == "streamBoundary") {
    struct Reservations {
      StreamBoundaries::List incoming, reclaimed;
    };
    auto nodes = std::make_shared<Reservations>();
    unsigned replace = 0;
    const auto add = [&](const char *key, unsigned kind) {
      const auto *value = m.Find(key);
      if (!value)
        return;
      replace |= kind;
      if (value->IsNull())
        return;
      const auto frameNumber = m.GetNumber(key);
      if (!frameNumber || !std::isfinite(*frameNumber) || *frameNumber < 0 ||
          *frameNumber > 9007199254740991.)
        throw std::runtime_error("invalid stream boundary");
      nodes->incoming.push_back({static_cast<std::uint64_t>(std::round(*frameNumber)), kind});
    };
    add("frame", 1);
    add("endFrame", 2);
    if (!host.submit([&branch, nodes, replace](Session &) {
          branch.reserveBoundaries(replace, nodes->incoming, nodes->reclaimed);
        }))
      throw std::runtime_error("audio command queue full");
    return;
  }
  if (type == "setSpectrumTapRoute") {
    if (!host.submit([&branch, id = m.GetUInt32("pluginId").value_or(0),
                      on = m.GetBool("enabled").value_or(false)](Session &) {
          branch.spectrum().route(id, on);
        }))
      throw std::runtime_error("audio command queue full");
    return;
  }
  if (type == "setSpectrumTap") {
    auto update = branch.spectrum().prepare(
        m.GetUInt32("pluginId").value_or(0), m.GetBool("enabled").value_or(false),
        m.GetString("mode") == "compare", m.GetString("quality") == "hq");
    if (!host.submit(
            [&branch, update = std::move(update)](Session &) { branch.spectrum().apply(update); }))
      throw std::runtime_error("audio command queue full");
    return;
  }
  if (type == "setVisualizerSources") {
    std::vector<VisualizerSource> sources;
    if (const auto *list = m.Find("sources"); list && list->IsArray())
      for (const auto &v : list->AsArray()) {
        VisualizerSource source;
        source.tap = v.GetUInt32("tapId").value_or(0);
        source.hash = v.GetUInt32("paramsHash").value_or(0);
        source.gain = static_cast<float>(v.GetNumber("gain").value_or(1));
        if (!(source.gain > 0))
          source.gain = 1;
        source.type = v.GetString("type").value_or("");
        const auto *params = v.Find("params");
        if (source.tap < 0xf0000000u || !params || !params->IsArray())
          continue;
        for (const auto &p : params->AsArray()) {
          if (!p.IsNumber())
            throw std::runtime_error("invalid visualizer parameter");
          source.params.push_back(static_cast<float>(p.AsNumber()));
        }
        const auto selection = v.GetString("channel");
        if (selection == "L")
          source.right = 0;
        else if (selection == "R")
          source.left = 1;
        else if (selection) {
          constexpr std::string_view pairs[]{"34", "56", "78", "910", "1112", "1314", "1516"};
          const auto match = std::find(std::begin(pairs), std::end(pairs), *selection);
          if (match != std::end(pairs)) {
            source.left = 2 + 2 * static_cast<unsigned>(match - std::begin(pairs));
            source.right = source.left + 1;
          } else {
            unsigned n = 0;
            auto [ptr, ec] =
                std::from_chars(selection->data(), selection->data() + selection->size(), n);
            if (ec != std::errc{} || ptr != selection->data() + selection->size() || n < 1 ||
                n > 16)
              continue;
            source.left = source.right = n - 1;
          }
        }
        sources.push_back(std::move(source));
      }
    auto detached = std::make_shared<std::unique_ptr<Visualizer>>();
    if (!host.submit([detached, &branch](Session &) { branch.exchangeVisualizer(*detached); },
                     [sources = std::move(sources), detached, branchId, &host]() {
                       auto *target = host.session.branch(branchId);
                       if (!target || !target->isOpen() || sources.empty())
                         return;
                       if (!*detached)
                         *detached = std::make_unique<Visualizer>(target->format().sampleRate,
                                                                  target->maxBlock());
                       if (!(*detached)->configure(sources)) {
                         send({{"type", "dspFailure"},
                               {"stage", "visualizer"},
                               {"branch", double(branchId)}});
                         return;
                       }
                       if (!host.submit([target, detached](Session &) {
                             target->exchangeVisualizer(*detached);
                           }))
                         throw std::runtime_error("audio command queue full");
                     }))
      throw std::runtime_error("audio command queue full");
    return;
  }
  Object result{{"branch", double(branchId)}};
  for (const auto *key : {"requestId", "token"})
    if (const auto *value = m.Find(key))
      result.emplace(key, *value);
  bool accepted = true;
  if (type == "requestDspLatency") {
    result.emplace("type", "dspLatencyResponse");
    struct Latency {
      unsigned samples;
      bool compensated;
    };
    auto value = std::make_shared<Latency>();
    accepted = host.submit(
        [&branch, value](Session &) {
          value->samples = branch.latency();
          value->compensated = !branch.masterBypass();
        },
        [result = std::move(result), value]() mutable {
          result.emplace("samples", double(value->samples));
          result.emplace("compensated", value->compensated);
          send(std::move(result));
        });
  } else if (type == "awaitOutputReady") {
    result.emplace("type", "outputReady");
    host.waitForOutput(
        branchId, [](const OutputStage &output) { return output.ready(); },
        [result = std::move(result)]() mutable { send(std::move(result)); });
  } else if (type == "setOutputDelay") {
    const auto samples = m.GetUInt32("samples").value_or(0);
    const auto target = std::min(samples, branch.output().maxDelay());
    result.emplace("type", "outputDelaySet");
    result.emplace("samples", double(target));
    accepted = host.submit(
        [&branch, target, running = host.running()](Session &) {
          branch.output().delay(target, running);
        },
        [&host, branchId, target, result = std::move(result)]() mutable {
          host.waitForOutput(
              branchId, [target](const OutputStage &o) { return o.appliedDelay() == target; },
              [result = std::move(result)]() mutable { send(std::move(result)); });
        });
  } else {
    const auto gain = static_cast<float>(std::clamp(m.GetNumber("gain").value_or(1.), 0., 1.));
    const auto seconds = std::clamp(m.GetNumber("duration").value_or(0.), 0., 60.);
    const unsigned frames =
        host.running() ? static_cast<unsigned>(std::round(seconds * branch.format().sampleRate))
                       : 0;
    result.emplace("type", "outputFaded");
    result.emplace("gain", double(gain));
    accepted = host.submit(
        [&branch, gain, frames](Session &) { branch.output().fade(gain, frames); },
        [&host, branchId, gain, result = std::move(result)]() mutable {
          host.waitForOutput(
              branchId, [gain](const OutputStage &o) { return o.completedGain() == gain; },
              [result = std::move(result)]() mutable { send(std::move(result)); });
        });
  }
  if (!accepted)
    throw std::runtime_error("audio command queue full");
}
void sendSpectrum(DeviceHost &host, Session &session, unsigned branch) {
  if (!session.isOpen())
    return;
  session.spectrum().drain([&](const SpectrumFrame &f) {
    const auto age = f.hq ? 8192u : 2048u;
    const auto completion = f.hq ? 48u + std::max(2048u, (f.rate + 29) / 30) / 16 * 16 : 0;
    Object m{{"type", "spectrumOverlay"},
             {"branch", double(branch)},
             {"mode", f.compare ? "compare" : "after"},
             {"quality", f.hq ? "hq" : "normal"},
             {"spectrumPluginId", double(f.id)},
             {"endFrame", double(f.end)},
             {"routeRevision", double(f.revision)},
             {"sampleRate", double(f.rate)},
             {"time", double(f.end) / f.rate},
             {"timing", Object{{"version", 1.},
                               {"generation", double(f.generation)},
                               {"frameIndex", double(f.index)},
                               {"captureEndFrame", double(f.captured)},
                               {"windowAgeFrames", double(age)},
                               {"completionFrames", double(completion)},
                               {"tapDelayFrames", double(f.delay)}}}};
    if (f.hq) {
      const auto snapshot = [&](const SpectrumFrame::Analysis &a) {
        return Object{{"highQuality", true},
                      {"sampleRate", double(f.rate)},
                      {"points", 12.},
                      {"hopSamples", double(a.hop)},
                      {"generation", double(a.generation)},
                      {"captureEndSample", double(a.captured)},
                      {"frameIndex", double(a.index)},
                      {"firstValidIndex", double(a.first)},
                      {"validCellCount", double(a.valid)},
                      {"minFrequency", 20.},
                      {"maxFrequency", 40000.},
                      {"binCount", 2048.},
                      {"cellCount", 2048.},
                      {"flags", 0.},
                      {"timeSeconds", double(a.captured) / f.rate}};
      };
      m.emplace("outputSpectrum", snapshot(f.output));
      if (f.compare)
        m.emplace("inputSpectrum", snapshot(f.input));
    } else
      m.emplace("bufferPosition", double(f.position));
    DeviceHost::ClockSnapshot clock{};
    if (host.clock(clock)) {
      m.emplace("clockPipelineFrame", double(clock.pipelineFrame));
      m.emplace("clockTimeNs", double(clock.timeNs));
    }
    std::vector<std::uint8_t> bytes(f.samples.size() * sizeof(float));
    std::memcpy(bytes.data(), f.samples.data(), bytes.size());
    writeFrame(std::cout, {FrameKind::Telemetry, std::move(m), std::move(bytes)});
  });
}
} // namespace effetune::audio

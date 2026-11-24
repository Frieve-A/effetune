#include "measurement_control.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>

namespace effetune::audio {
namespace {
using Object = JsonValue::Object;
void reply(Object message, std::vector<std::uint8_t> bytes = {}) {
  writeFrame(std::cout, {FrameKind::Control, std::move(message), std::move(bytes)});
}
void state(const char *value) { reply({{"type", "measurementState"}, {"state", value}}); }
void reject(std::string_view type, const char *reason) {
  reply({{"type", "commandRejected"}, {"command", std::string(type)}, {"reason", reason}});
}
unsigned framesAt(unsigned frames, unsigned rate, unsigned deviceRate) {
  return static_cast<unsigned>(std::llround(static_cast<double>(frames) * rate / deviceRate));
}
bool validClock(const JsonValue &m, std::string_view key, std::uint64_t &value) {
  const auto n = m.GetNumber(key).value_or(0);
  if (!std::isfinite(n) || n < 0 || n > 9007199254740991. || std::floor(n) != n)
    return false;
  value = static_cast<std::uint64_t>(n);
  return true;
}
} // namespace
bool isMeasurementCommand(std::string_view type) noexcept {
  return type == "openMeasurement" || type == "closeMeasurement" || type.starts_with("measurement");
}
bool handleMeasurement(DeviceHost &host, Frame &frame) {
  const auto &m = frame.message;
  const auto type = m.GetString("type").value_or("");
  auto &measurement = host.measurement;
  if (type == "openMeasurement") {
    std::vector<unsigned> indices;
    const auto *list = m.Find("inputChannelIndices");
    if (list && list->IsArray() && list->AsArray().size() <= 2)
      for (const auto &item : list->AsArray()) {
        if (!item.IsNumber() || item.AsNumber() < 0 || item.AsNumber() > UINT32_MAX ||
            std::floor(item.AsNumber()) != item.AsNumber()) {
          indices.clear();
          break;
        }
        indices.push_back(static_cast<unsigned>(item.AsNumber()));
      }
    const auto rate = m.GetUInt32("sampleRate").value_or(48000);
    const auto error = host.openMeasurement(
        rate, std::string(m.GetString("outputDeviceId").value_or("default")),
        m.GetUInt32("outputChannels").value_or(2),
        std::string(m.GetString("inputDeviceId").value_or("default")), std::move(indices),
        m.GetUInt32("deviceRate").value_or(rate), m.GetUInt32("captureRate").value_or(rate),
        m.GetBool("synchronousInput").value_or(false));
    if (error == DeviceError::Busy)
      reject(type, "busy");
    else if (error != DeviceError::None)
      reply({{"type", "measurementState"},
             {"state", "failed"},
             {"reason", std::string(deviceErrorName(error))}});
    else {
      const auto &out = host.outputFormat(), &in = host.inputFormat();
      reply({{"type", "measurementState"},
             {"state", "open"},
             {"sampleRate", double(rate)},
             {"outputChannels", double(out.selectedChannels)},
             {"inputChannels", double(in.selectedChannels)},
             {"outputDeviceRate", double(out.sampleRate)},
             {"inputDeviceRate", double(in.sampleRate)},
             {"outputLatencyFrames", double(framesAt(out.latencyFrames, rate, out.sampleRate))},
             {"inputLatencyFrames", double(framesAt(in.latencyFrames, rate, in.sampleRate))},
             {"synchronousInput", in.synchronousInput}});
    }
    return true;
  }
  if (!host.measuring()) {
    if (!isMeasurementCommand(type))
      return false;
    reject(type, "unavailable");
    return true;
  }
  if (type == "measurementBegin") {
    if (measurement.begin(m.GetUInt32("excitationFrames").value_or(0),
                          m.GetUInt32("captureFrames").value_or(0),
                          m.GetBool("loop").value_or(false),
                          static_cast<float>(m.GetNumber("overloadPeak").value_or(0)),
                          m.GetUInt32("overloadTailFrames").value_or(0)))
      state("ready");
    else
      reject(type, "invalid");
  } else if (type == "measurementChunk") {
    if (!measurement.chunk(m.GetUInt32("offset").value_or(UINT32_MAX), frame.attachment))
      reject(type, "invalid");
  } else if (type == "measurementStart") {
    if (measurement.start())
      state("running");
    else
      reject(type, "invalid");
  } else if (type == "measurementStatus") {
    const auto status = measurement.state();
    Object message{{"type", "measurementStatus"},
                   {"inputPeak", double(measurement.takePeak())},
                   {"overloadStopped", measurement.overloadStopped()},
                   {"status", status == Measurement::State::Failed     ? "failed"
                              : status == Measurement::State::Complete ? "complete"
                                                                       : "running"}};
    if (status == Measurement::State::Failed)
      message.emplace("reason", measurement.deviceLost() ? "deviceLost" : "interrupted");
    reply(std::move(message));
  } else if (type == "measurementRead") {
    const auto offset = m.GetUInt32("offset").value_or(0),
               frames = m.GetUInt32("frames").value_or(0);
    const auto data = frames <= 65536 ? measurement.read(offset, frames) : std::span<const float>{};
    if (data.empty()) {
      reject(type, "invalid");
    } else {
      std::vector<std::uint8_t> bytes(data.size_bytes());
      std::memcpy(bytes.data(), data.data(), bytes.size());
      const auto start = measurement.playbackStartFrame();
      reply({{"type", "measurementData"},
             {"offset", double(offset)},
             {"frames", double(frames)},
             {"playbackStartFrame", start ? JsonValue(*start) : JsonValue(nullptr)},
             {"captureStartFrame", start ? JsonValue(0.) : JsonValue(nullptr)}},
            std::move(bytes));
    }
  } else if (type == "measurementCancel") {
    measurement.cancel();
    state("open");
  } else if (type == "closeMeasurement") {
    host.closeMeasurement();
    state("closed");
  } else if (!host.physical() && type == "testDeviceReset") {
    measurement.deviceReset();
  } else if (!host.physical() && (type == "renderNullDevice" || type == "captureNull")) {
    const auto frames = m.GetUInt32("frames").value_or(0);
    DeviceClock clock{};
    clock.discontinuity = m.GetBool("discontinuity").value_or(false);
    if (!frames || frames > 32768 || !validClock(m, "position", clock.position) ||
        !validClock(m, "deviceTimeNs", clock.deviceTimeNs)) {
      reject(type, "invalid");
    } else if (type == "renderNullDevice") {
      const auto channels = host.outputFormat().selectedChannels;
      std::vector<float> samples(std::size_t(channels) * frames);
      measurement.render(samples, frames, clock);
      std::vector<std::uint8_t> bytes(samples.size() * sizeof(float));
      std::memcpy(bytes.data(), samples.data(), bytes.size());
      reply(
          {{"type", "nullOutput"}, {"frames", double(frames)}, {"channelCount", double(channels)}},
          std::move(bytes));
    } else {
      const auto indices = host.measurementIndices();
      const auto channels = m.GetUInt32("channelCount").value_or(0);
      if (channels > 16 ||
          frame.attachment.size() != std::size_t(channels) * frames * sizeof(float) ||
          *std::max_element(indices.begin(), indices.end()) >= channels) {
        reject(type, "invalid");
      } else {
        std::vector<float> samples(indices.size() * frames);
        for (std::size_t i = 0; i < indices.size(); ++i)
          std::memcpy(samples.data() + i * frames,
                      frame.attachment.data() + std::size_t(indices[i]) * frames * sizeof(float),
                      std::size_t(frames) * sizeof(float));
        measurement.capture(samples, frames, clock);
      }
    }
  } else {
    reject(type, "busy");
  }
  return true;
}
} // namespace effetune::audio

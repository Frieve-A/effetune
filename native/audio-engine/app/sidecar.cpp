#include "device/null/null_device.h"
#include "device_host.h"
#include "effetune/abi.h"
#include "frame.h"
#include "host/io_pipeline.h"
#include "host/pipeline.h"
#include "instrument_control.h"
#include "measurement_control.h"
#include "midi_control.h"
#include "network_reports.h"
#include "output_control.h"
#include "power_control.h"
#include "sampler_control.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <iostream>
#include <mutex>
#include <string_view>
#include <thread>

bool initializeAudioEnginePlatform();

namespace effetune::audio {
namespace {
using Object = JsonValue::Object;
using Array = JsonValue::Array;

std::uint32_t readNumber(const JsonValue &message, std::string_view key, std::uint32_t fallback) {
  if (!message.Find(key))
    return fallback;
  const auto value = message.GetUInt32(key);
  if (!value)
    throw std::runtime_error("invalid numeric field");
  return *value;
}

void send(Object message, std::vector<std::uint8_t> attachment = {}) {
  writeFrame(std::cout, {FrameKind::Control, JsonValue(std::move(message)), std::move(attachment)});
}

class AssetTransfers {
public:
  bool assemble(Frame &frame) {
    const auto type = frame.message.GetString("type");
    if (type != "beginPluginAsset" && type != "pluginAssetChunk" && type != "finishPluginAsset")
      return true;
    const auto branch = readNumber(frame.message, "branch", 0);
    const auto id = frame.message.GetUInt32("transferId");
    if (branch >= transfers_.size() || !id)
      throw std::runtime_error("invalid asset transfer");
    auto &slot = transfers_[branch];
    if (type == "beginPluginAsset") {
      const auto bytes = readNumber(frame.message, "byteLength", 0);
      if (slot || bytes < 32 || bytes > 1024u * 1024u * 1024u || !frame.attachment.empty())
        throw std::runtime_error("invalid asset transfer size");
      slot.emplace(Transfer{*id, bytes, std::move(frame)});
      slot->frame.attachment.reserve(bytes);
      return false;
    }
    if (!slot || slot->id != *id)
      throw std::runtime_error("unknown asset transfer");
    auto &payload = slot->frame.attachment;
    if (type == "pluginAssetChunk") {
      if (readNumber(frame.message, "offset", UINT32_MAX) != payload.size() ||
          frame.attachment.empty() || frame.attachment.size() > slot->bytes - payload.size())
        throw std::runtime_error("invalid asset chunk");
      payload.insert(payload.end(), frame.attachment.begin(), frame.attachment.end());
      return false;
    }
    if (payload.size() != slot->bytes || !frame.attachment.empty())
      throw std::runtime_error("incomplete asset transfer");
    frame = std::move(slot->frame);
    frame.message.AsObject().insert_or_assign("type", "setPluginAsset");
    slot.reset();
    return true;
  }

private:
  struct Transfer {
    std::uint32_t id, bytes;
    Frame frame;
  };
  std::array<std::optional<Transfer>, 2> transfers_;
};

void sendDspReady(DeviceHost &device, unsigned branch, unsigned recoveryId = 0,
                  unsigned requestId = 0) {
  Array kernels;
  for (std::uint32_t i = 0; i < et_kernel_count(); ++i) {
    char name[128]{};
    if (et_kernel_name(i, name, sizeof(name)) < 0)
      throw std::runtime_error("cannot describe DSP kernel");
    kernels.emplace_back(Object{{"name", name},
                                {"hash", double(et_kernel_params_hash(i))},
                                {"byteCapacity", double(et_kernel_param_bytes_capacity(i))},
                                {"assetCapacity", double(et_kernel_asset_capacity(i, 0))}});
  }
  send({{"type", "dspReady"},
        {"branch", double(branch)},
        {"endpointEpoch", double(device.endpointEpoch(branch))},
        {"requestId", double(requestId)},
        {"recoveryId", double(recoveryId)},
        {"abiVersion", double(et_abi_version())},
        {"sfzSampleStreaming", et_sfz_stream_capability() != 0},
        {"simd", true},
        {"kernels", std::move(kernels)}});
}

std::span<const std::uint8_t> slice(const Frame &frame, std::uint32_t offset, std::size_t bytes) {
  if (offset > frame.attachment.size() || bytes > frame.attachment.size() - offset)
    throw std::runtime_error("binary field outside frame");
  return std::span(frame.attachment).subspan(offset, bytes);
}

PluginSettings pluginSettings(const Frame &frame, const JsonValue &message) {
  PluginSettings settings;
  settings.id = readNumber(message, "id", 0);
  // Single-plugin updates use pluginType because type identifies the command.
  settings.type = message.GetString("pluginType").value_or(message.GetString("type").value_or(""));
  settings.layoutHash = readNumber(message, "layoutHash", 0);
  const auto count = readNumber(message, "paramsCount", 0);
  const auto params = slice(frame, readNumber(message, "paramsOffset", 0), std::size_t(count) * 4);
  settings.params.resize(count);
  if (!params.empty())
    std::memcpy(settings.params.data(), params.data(), params.size());
  if (!std::all_of(settings.params.begin(), settings.params.end(),
                   [](float v) { return std::isfinite(v); }))
    throw std::runtime_error("non-finite DSP parameter");
  const auto bytes =
      slice(frame, readNumber(message, "bytesOffset", 0), readNumber(message, "bytesLength", 0));
  settings.bytes.assign(bytes.begin(), bytes.end());
  settings.skip = message.GetBool("skip").value_or(false);
  settings.displayOnly = message.GetBool("displayOnly").value_or(false);
  settings.assetPending = message.GetBool("assetPending");
  settings.noteAnalysisSource = readNumber(message, "noteAnalysisSource", 0);
  settings.sf = message.GetString("sf").value_or("");
  settings.midiChannelMask = readNumber(message, "midiChannelMask", 0);
  return settings;
}

struct Configuration {
  std::vector<PluginSettings> plugins;
  std::vector<std::uint8_t> descriptor;
};

Configuration configuration(const Frame &frame) {
  const auto *items = frame.message.Find("plugins");
  if (!items || !items->IsArray())
    throw std::runtime_error("invalid pipeline configuration");
  std::vector<PluginSettings> plugins;
  for (const auto &item : items->AsArray())
    plugins.push_back(pluginSettings(frame, item));
  const auto descriptor = slice(frame, readNumber(frame.message, "descriptorOffset", 0),
                                readNumber(frame.message, "descriptorBytes", 0));
  return {std::move(plugins), {descriptor.begin(), descriptor.end()}};
}
void pipelineApplied(const Frame &frame, const char *path) {
  send({{"type", "pipelineApplied"},
        {"branch", double(readNumber(frame.message, "branch", 0))},
        {"revision", double(readNumber(frame.message, "revision", 0))},
        {"path", path}});
}
void configurePipeline(Session &session, const Frame &frame) {
  auto config = configuration(frame);
  if (!session.pipeline() ||
      !session.pipeline()->configure(std::move(config.plugins), std::move(config.descriptor)))
    throw std::runtime_error("pipeline configuration failed");
  session.setMasterBypass(frame.message.GetBool("masterBypass").value_or(false));
  session.io()->markTapChanged();
  pipelineApplied(frame, "control");
}

class PendingTopology {
public:
  enum class Progress { Waiting, Gated, Done };
  Progress advance(DeviceHost &device, const Frame &frame) {
    if (frame.message.GetBool("gate").value_or(false) || phase_.load() == Phase::Fallback)
      return Progress::Gated;
    auto *session = device.session.branch(readNumber(frame.message, "branch", 0));
    if (!session || !session->pipeline() ||
        session->masterBypass() != frame.message.GetBool("masterBypass").value_or(false))
      return Progress::Gated;
    if (std::chrono::steady_clock::now() > deadline_ && device.running() &&
        !device.commandsSettled())
      device.stall();
    switch (phase_.load(std::memory_order_acquire)) {
    case Phase::New: {
      if (!device.commandsSettled())
        return Progress::Waiting;
      change_.reset();
      auto config = configuration(frame);
      change_ = session->pipeline()->prepareChange(std::move(config.plugins),
                                                   std::move(config.descriptor));
      if (!change_) {
        phase_.store(Phase::Fallback);
        return Progress::Gated;
      }
      phase_.store(Phase::Capturing);
      if (!device.submit([this](Session &) {
            phase_.store(change_->capture() ? Phase::Captured : Phase::Fallback,
                         std::memory_order_release);
          }))
        phase_.store(Phase::Fallback);
      return Progress::Waiting;
    }
    case Phase::Captured:
      if (!change_->prepare()) {
        phase_.store(Phase::Fallback);
        return Progress::Gated;
      }
      phase_.store(Phase::Publishing);
      if (!device.submit([this, session](Session &) {
            const bool done = change_->publish();
            if (done)
              session->io()->markTapChanged();
            phase_.store(done ? Phase::Published
                         : change_->retryable() && std::chrono::steady_clock::now() < deadline_
                             ? Phase::New
                             : Phase::Fallback,
                         std::memory_order_release);
          }))
        phase_.store(Phase::Fallback);
      return Progress::Waiting;
    case Phase::Published:
      return Progress::Done;
    case Phase::Fallback:
      return Progress::Gated;
    default:
      return Progress::Waiting;
    }
  }

private:
  enum class Phase { New, Capturing, Captured, Publishing, Published, Fallback };
  const std::chrono::steady_clock::time_point deadline_ =
      std::chrono::steady_clock::now() + std::chrono::seconds(2);
  std::unique_ptr<Pipeline::TopologyChange> change_;
  std::atomic<Phase> phase_{Phase::New};
};

void submitPluginAsset(DeviceHost &device, Pipeline &pipeline,
                       const std::shared_ptr<Pipeline::AssetChange> &change, Object reply) {
  auto done = [&pipeline, change, reply = std::move(reply)](bool ok) mutable {
    if (!ok && change->awaitsPages()) {
      change->retain(change);
      reply.emplace("type", "assetState");
      reply.emplace("state", double(ET_ASSET_STATE_PREPARING));
      send(std::move(reply));
      return;
    }
    if (!ok) {
      pipeline.releaseBank(change.get());
      std::cerr << "Plugin asset update rejected during " << change->failureStage() << '\n';
    }
    if (ok && change->deferred())
      return;
    reply.emplace("type", ok ? "assetState" : "assetLoadRejected");
    if (ok)
      reply.emplace("state", double(change->state()));
    else
      reply.emplace("reason", "capacity");
    send(std::move(reply));
  };
  submitBank(device, change, std::move(done));
}

void changeAsset(DeviceHost &device, Session &session, Frame &frame, bool clear) {
  const auto &message = frame.message;
  const auto id = readNumber(message, "pluginId", 0), slot = readNumber(message, "slot", 0);
  auto *pipeline = session.pipeline();
  if (!pipeline)
    throw std::runtime_error("asset outside session");
  if (!slot)
    pipeline->cancelStream(id);
  std::optional<AssetData> candidate;
  if (!clear) {
    auto &asset = candidate.emplace();
    asset.payload = std::move(frame.attachment);
    asset.formatTag = readNumber(message, "formatTag", 0);
    asset.processingChannels = readNumber(message, "processingChannels", 0);
    asset.headBlock = readNumber(message, "headBlock", 0);
    asset.rateDivider = readNumber(message, "rateDivider", 1);
    asset.pathCount = readNumber(message, "pathCount", 0);
    asset.inputCount = readNumber(message, "inputCount", 0);
    asset.footprintBytes = readNumber(message, "footprintBytes", 0);
    asset.operationRevision = message.GetUInt32("operationRevision");
    asset.replayEpoch = message.GetUInt32("replayEpoch");
    if (const auto *context = message.Find("preparationContext"))
      asset.minimumPhysicalBpm = context->GetNumber("minimumPhysicalBpm");
  }
  Object reply{{"branch", double(readNumber(message, "branch", 0))},
               {"pluginId", double(id)},
               {"slot", double(slot)}};
  for (const auto *key : {"operationRevision", "replayEpoch"})
    if (const auto value = message.GetUInt32(key))
      reply.emplace(key, double(*value));
  auto change = pipeline->assetChange(id, slot, std::move(candidate));
  submitPluginAsset(device, *pipeline, change, std::move(reply));
}

std::uint64_t frameIndex(const JsonValue &message, std::string_view field) {
  const auto n = message.GetNumber(field);
  if (!n || *n < 0 || *n > 9007199254740991. || std::floor(*n) != *n)
    throw std::runtime_error("invalid frame position");
  return static_cast<std::uint64_t>(*n);
}

void writePcm(ClockedFifo &fifo, const Frame &frame, FileFifo *file = nullptr) {
  const auto channels = readNumber(frame.message, "channelCount", 0);
  const auto frames = readNumber(frame.message, "frames", 0);
  const auto count = std::size_t(channels) * frames;
  if (!channels || channels > 16 || !frames || frame.attachment.size() != count * sizeof(float))
    throw std::runtime_error("invalid planar PCM size");
  std::vector<float> samples(count);
  std::memcpy(samples.data(), frame.attachment.data(), frame.attachment.size());
  const auto generation = frameIndex(frame.message, "generation");
  const auto source = frameIndex(frame.message, "sourceFrame");
  if (file && frame.message.GetString("stream") == "file") {
    if (channels > FileFifo::maxChannels || frames > 8192)
      throw std::runtime_error("invalid file PCM size");
    file->write({generation, frameIndex(frame.message, "track"), source,
                 readNumber(frame.message, "sampleRate", 0), channels, 0.f},
                samples.data(), frames);
  } else {
    fifo.write(samples.data(), channels, frames, generation, source);
  }
}

void sendFileNextResult(std::uint64_t generation, std::uint64_t track, bool accepted) {
  send({{"type", "fileNextResult"},
        {"generation", double(generation)},
        {"track", double(track)},
        {"accepted", accepted}});
}

bool acceptFileControl(FileFifo &fifo, const JsonValue &message) {
  if (!isFileControl(message))
    return false;
  const auto type = message.GetString("type");
  const auto generation = frameIndex(message, "generation");
  if (type == "fileFlush") {
    if (!fifo.flush(generation))
      throw std::runtime_error("file command queue full");
    return true;
  }
  const auto track = frameIndex(message, "track");
  bool accepted;
  if (type == "fileStart" || type == "fileNext") {
    const bool next = type == "fileNext";
    accepted =
        fifo.start({generation, track, next ? 0 : frameIndex(message, "startFrame"),
                    readNumber(message, "sampleRate", 0), readNumber(message, "channelCount", 0),
                    static_cast<float>(message.GetNumber("gain").value_or(1.)),
                    message.GetBool("fadeIn").value_or(false)},
                   next);
    if (next && !accepted) {
      sendFileNextResult(generation, track, false);
      return true;
    }
  } else if (type == "fileCancelNext") {
    accepted = fifo.cancelNext(generation, track);
  } else if (type == "fileEnd") {
    accepted = fifo.end(generation, track, frameIndex(message, "totalFrames"));
  } else {
    accepted =
        fifo.gain(generation, track, static_cast<float>(message.GetNumber("gain").value_or(1.)));
  }
  if (!accepted)
    throw std::runtime_error("file command rejected");
  return true;
}

void sendFileEvents(FileFifo &fifo) {
  FileFifo::Event event{};
  while (fifo.popEvent(event)) {
    using Type = FileFifo::Event::Type;
    if (event.type == Type::Ended) {
      send({{"type", "fileEnded"},
            {"generation", double(event.generation)},
            {"track", double(event.track)},
            {"pipelineFrame", double(event.pipelineFrame)}});
    } else if (event.type == Type::NextAccepted || event.type == Type::NextRejected) {
      sendFileNextResult(event.generation, event.track, event.type == Type::NextAccepted);
    } else {
      send({{"type", "fileCancelNextResult"},
            {"generation", double(event.generation)},
            {"track", double(event.track)},
            {"result", event.type == Type::Cancelled ? "cancelled" : "already-playing"}});
    }
  }
}

void setFileClock(Object &message, const FileFifo::Snapshot &file) {
  message.emplace("fileGeneration", double(file.generation));
  message.emplace("fileTrack", double(file.track));
  message.emplace("fileReadFrame", double(file.readFrame));
  message.emplace("fileConverterDelayFrames", file.converterDelay);
  message.emplace("fileWrittenFrames", double(file.writtenFrames));
  message.emplace("fileQueuedFrames", double(file.queuedFrames));
  message.emplace("fileUnderruns", double(file.underruns));
  message.emplace("fileGaps", double(file.gaps));
  message.emplace("fileOverflows", double(file.overflows));
  message.emplace("fileRunning", file.running);
  message.emplace("filePipelineFrame", double(file.pipelineFrame));
}

void sendNetworkPackets(Session &session) {
  auto *io = session.io();
  NetworkPacket packet;
  while (io && io->sender.pop(packet)) {
    std::vector<std::uint8_t> bytes(sizeof(packet.pcm));
    std::memcpy(bytes.data(), packet.pcm.data(), bytes.size());
    Object metadata{{"type", "pcm"},
                    {"sampleRate", double(NetworkPacket::sampleRate)},
                    {"channelCount", 2.0},
                    {"frames", double(NetworkPacket::frames)},
                    {"sourceEpoch", double(packet.sourceEpoch)},
                    {"sourceFrame", double(packet.sourceFrame)},
                    {"contextFrame", packet.contextFrame},
                    {"contextFrameStep", packet.contextFrameStep},
                    {"contextSampleRate", double(packet.contextSampleRate)},
                    {"routeRevision", double(packet.routeRevision)},
                    {"routeRevisionEnd", double(packet.routeRevisionEnd)}};
    writeFrame(std::cout, {FrameKind::Network, JsonValue(std::move(metadata)), std::move(bytes)});
  }
}

void sendAssetNotices(DeviceHost &device, Session &session, unsigned branch) {
  if (!session.pipeline())
    return;
  Pipeline::AssetNotice notice;
  while (session.pipeline()->takeNotice(notice)) {
    if (notice.identity) {
      send({{"type", "sfzRuntimeIdentity"},
            {"pluginId", double(notice.id)},
            {"instanceId", double(notice.identity)},
            {"instanceEpoch", double(notice.identity)},
            {"token", double(notice.revision.value_or(0))},
            {"branch", double(branch)}});
      continue;
    }
    Object m{
        {"pluginId", double(notice.id)}, {"slot", double(notice.slot)}, {"branch", double(branch)}};
    if (notice.revision)
      m.emplace("operationRevision", double(*notice.revision));
    if (notice.epoch)
      m.emplace("replayEpoch", double(*notice.epoch));
    if (notice.completed) {
      auto bank = session.pipeline()->releaseBank(notice.completed);
      if (!bank)
        throw std::runtime_error("unowned completed bank");
      if (bank->stale()) {
        submitPluginAsset(device, *session.pipeline(), bank, std::move(m));
        continue;
      }
      if (!notice.rejected)
        bank->finish();
    }
    m.emplace("type", notice.rejected ? "assetLoadRejected" : "assetState");
    if (notice.rejected)
      m.emplace("reason", "capacity");
    else
      m.emplace("state", double(notice.state));
    send(std::move(m));
  }
}

void sendTelemetry(DeviceHost &device, Session &session, unsigned branch) {
  auto *telemetry = session.telemetry();
  if (!telemetry)
    return;
  const double cpu = session.takeCpuUsage();
  if (cpu >= 0)
    send({{"type", "pipelineCpuUsage"}, {"average", cpu}, {"branch", double(branch)}});
  const int overload = session.takeOverload();
  if (overload >= 0)
    send({{"type", "audioProcessingOverload"},
          {"active", overload != 0},
          {"branch", double(branch)}});
  if (session.takeLatencyChange())
    reportNetworkPaths(device, branch);
  constexpr const char *stages[]{"pipeline", "local", "send", "network"};
  while (const auto *packet = telemetry->front()) {
    Object m{{"type", "dspTelemetry"},
             {"branch", double(branch)},
             {"recycle", false},
             {"bytes", double(packet->bytes)},
             {"endFrame", double(packet->endFrame)},
             {"mixerEndFrame", double(packet->mixerEndFrame)},
             {"contextFrameOffset", 0.},
             {"routeRevision", double(packet->revision)},
             {"droppedFrames", double(packet->dropped)},
             {"visualizerTapStage", stages[static_cast<unsigned>(packet->stage)]}};
    DeviceHost::ClockSnapshot clock{};
    if (device.clock(clock)) {
      m.emplace("clockPipelineFrame", double(clock.pipelineFrame));
      m.emplace("clockTimeNs", double(clock.timeNs));
    }
    writeFrame(std::cout, {FrameKind::Telemetry,
                           std::move(m),
                           {packet->data.begin(), packet->data.begin() + packet->bytes}});
    telemetry->pop();
  }
}

bool handleAudioIo(DeviceHost &device, Session &session, Frame &frame, std::string_view type) {
  const auto &m = frame.message;
  if (type == "flushFeed" || type == "feedSilence") {
    const auto gen = frameIndex(m, "generation");
    if (type == "flushFeed")
      session.feed().flush(gen);
    else
      session.feed().silence(
          gen, m.Find("sourceFrame") ? std::optional(frameIndex(m, "sourceFrame")) : std::nullopt);
    return true;
  }
  auto *io = session.io();
  if (!io)
    return false;
  if (type == "setInputMix") {
    return device.submit([enabled = m.GetBool("enabled").value_or(false)](Session &s) {
      s.io()->inputEnabled = enabled;
    });
  } else if (type == "setNetworkOutputPort") {
    return device.submit([attached = m.GetBool("attached").value_or(false)](Session &s) {
      s.io()->sender.setAttached(attached);
    });
  } else if (type == "setNetworkOutputSendPaused") {
    return device.submit(
        [paused = m.GetBool("paused").value_or(false)](Session &s) { s.io()->paused = paused; });
  } else if (type == "setNetworkReceiveSession") {
    const auto generation = frameIndex(m, "generation");
    const bool active = m.GetBool("active").value_or(false);
    if (generation > io->receiveGeneration ||
        (generation == io->receiveGeneration && active != io->receiving)) {
      io->receiveGeneration = generation;
      io->receiving = active;
      if (!session.pipeline()->setNetworkRouting(io->receiving, session.masterBypass()))
        throw std::runtime_error("cannot change receive routing");
      io->markTapChanged();
    }
  } else if (type == "setVisualSync") {
    if (!device.submit([io, enabled = m.GetBool("enabled").value_or(false)](Session &) {
          if (io->visualSync != enabled)
            ++io->routeRevision;
          io->visualSync = enabled;
        }))
      return false;
  } else if (type == "setNetworkOutputLocalDelay") {
    const auto ms = std::clamp(m.GetNumber("delayMs").value_or(0), 0., 8000.);
    const auto samples =
        static_cast<unsigned>(std::round(ms * session.format().sampleRate / 1000.));
    const auto request = static_cast<unsigned>(readNumber(m, "requestId", 0));
    io->pendingDelayRequest = request;
    if (!device.submit([io, request, samples, active = m.GetBool("active").value_or(false),
                        local = m.GetBool("localEnabled").value_or(true)](Session &) {
          io->requestLocalDelay(request, active, samples, local);
        }))
      return false;
  } else if (type == "pcm-ack") {
    return device.submit([epoch = frameIndex(m, "sourceEpoch"), pos = frameIndex(m, "sourceFrame")](
                             Session &s) { s.io()->sender.acknowledge(epoch, pos); });
  } else if (type == "captureNull") {
    writePcm(io->capture(), frame);
  } else if (type == "renderNullDevice") {
    const auto frames = readNumber(m, "frames", 0);
    const auto channels = session.format().outputChannels;
    if (!frames || frames > 32768)
      throw std::runtime_error("invalid null callback period");
    std::vector<float> samples(std::size_t(channels) * frames);
    if (!session.renderDevice(samples, frames))
      throw std::runtime_error("null callback failed");
    std::vector<std::uint8_t> bytes(samples.size() * sizeof(float));
    std::memcpy(bytes.data(), samples.data(), bytes.size());
    send({{"type", "nullOutput"},
          {"frames", double(frames)},
          {"channelCount", double(channels)},
          {"feedUnderruns", double(session.feed().underruns())},
          {"feedGaps", double(session.feed().gaps())},
          {"feedOverflows", double(session.feed().overflows())},
          {"pipelineFrame", double(session.position())},
          {"outputConverterDelayFrames", io->outputDelayFrames()}},
         std::move(bytes));
  } else {
    return false;
  }
  if (type == "setNetworkReceiveSession" || type == "setVisualSync" ||
      type == "setNetworkOutputLocalDelay") {
    reportNetworkPaths(device, readNumber(m, "branch", 0));
  }
  return true;
}

DeviceLatency deviceLatency(const JsonValue &message) {
  const auto hint = message.GetString("latency");
  if (hint == "interactive" || hint == "low")
    return DeviceLatency::Low;
  if (hint == "playback" || hint == "high")
    return DeviceLatency::High;
  return DeviceLatency::Balanced;
}

void sendInputState(DeviceHost &device, unsigned requestId = 0, bool reopened = false) {
  Object state{{"type", "inputState"},
               {"requestId", double(requestId)},
               {"reopened", reopened},
               {"inputChannels", double(device.inputFormat().selectedChannels)},
               {"state", device.inputError() == DeviceError::None
                             ? (device.inputFormat().selectedChannels ? "acquired" : "none")
                             : "failed"}};
  if (device.inputError() != DeviceError::None)
    state.emplace("reason", std::string(deviceErrorName(device.inputError())));
  send(std::move(state));
}

void sendOpenState(DeviceHost &device, bool reportInput = false) {
  const auto &format = device.session.format();
  send({{"type", "sessionState"},
        {"state", "open"},
        {"recoveryId", double(device.recoveryId())},
        {"sampleRate", double(format.sampleRate)},
        {"deviceRate", double(format.deviceRate)},
        {"captureRate", double(format.captureRate)},
        {"inputChannels", double(format.inputChannels)},
        {"inputFailed", device.inputError() != DeviceError::None},
        {"outputChannels", double(format.outputChannels)},
        {"periodFrames", double(format.periodFrames)},
        {"width", double(format.width())},
        {"outputLatencyFrames", double(device.outputFormat().latencyFrames)},
        {"inputLatencyFrames", double(device.inputFormat().latencyFrames)}});
  if (reportInput)
    sendInputState(device, 0, true);
  if (device.rebuilt()) {
    for (unsigned branch = 0; branch < 2; ++branch) {
      clearSampleStreams(branch);
      clearPowerRequests(branch);
      clearMidiRequests(branch);
    }
    sendDspReady(device, 0, device.recoveryId());
  }
}

// An input change can reopen the output to widen the session. If that reopen
// fails the session is closed, so report a failed output reset and let the
// renderer run its normal output recovery.
void sendInputChange(DeviceHost &device, bool wasOpen, DeviceError result, unsigned requestId = 0) {
  if (wasOpen && !device.session.isOpen()) {
    send({{"type", "deviceReset"}, {"direction", "output"}, {"reasons", 0.}});
    send({{"type", "sessionState"},
          {"state", "failed"},
          {"reason", std::string(deviceErrorName(result))}});
  } else if (device.rebuilt() && device.session.isOpen()) {
    sendOpenState(device);
  }
  sendInputState(device, requestId);
}

bool acceptsEndpoint(DeviceHost &device, const JsonValue &message) {
  if (!message.Find("endpointEpoch"))
    return true;
  const auto branch = readNumber(message, "branch", 0);
  const auto epoch = readNumber(message, "endpointEpoch", 0);
  if (branch > 1 || !epoch || epoch > device.endpointEpoch(branch))
    throw std::runtime_error("invalid endpoint epoch");
  if (epoch == device.endpointEpoch(branch) && device.session.isOpen() &&
      device.session.branch(branch))
    return true;
  Object reply{
      {"type", "endpointRetired"}, {"branch", double(branch)}, {"endpointEpoch", double(epoch)}};
  if (const auto *request = message.Find("requestId"))
    reply.emplace("requestId", *request);
  send(std::move(reply));
  return false;
}

bool serviceLatencyReservations(DeviceHost &device) {
  auto *parallel = device.session.branch(1);
  if (!device.session.needsLatencyReservation() &&
      !(parallel && parallel->needsLatencyReservation()))
    return true;
  if (!device.acquire())
    return false;
  for (auto *branch : {&device.session, parallel})
    if (branch && branch->isOpen() && branch->needsLatencyReservation() &&
        !branch->reserveLatency())
      throw std::runtime_error("pipeline latency reservation failed");
  device.release();
  return true;
}

void handleControl(DeviceHost &device, Frame &frame) {
  if (handleMeasurement(device, frame))
    return;
  const auto type = frame.message.GetString("type");
  const auto branchId = readNumber(frame.message, "branch", 0);
  Session *branch = device.session.branch(branchId);
  if (!branch)
    throw std::runtime_error("unknown audio branch");
  if (branchId &&
      (type == "flushFeed" || type == "feedSilence" || type == "renderNullDevice" ||
       type == "captureNull" || type == "setInputMix" || type == "setNetworkOutputPort"))
    throw std::runtime_error("invalid branch command");
  if (type == "openSession") {
    SessionFormat format{readNumber(frame.message, "sampleRate", 48000),
                         readNumber(frame.message, "inputChannels", 0),
                         readNumber(frame.message, "outputChannels", 2),
                         readNumber(frame.message, "periodFrames", 128),
                         readNumber(frame.message, "deviceRate", 0),
                         readNumber(frame.message, "captureRate", 0)};
    const auto error = device.open(
        format, std::string(frame.message.GetString("outputDeviceId").value_or("default")),
        std::string(frame.message.GetString("inputDeviceId").value_or("")),
        deviceLatency(frame.message),
        std::string(frame.message.GetString("loopbackEndpointId").value_or("")));
    if (error != DeviceError::None) {
      send({{"type", "sessionState"},
            {"state", "failed"},
            {"reason", std::string(deviceErrorName(error))}});
      return;
    }
    sendOpenState(device, true);
  } else if (type == "releaseRecovery") {
    const auto id = readNumber(frame.message, "recoveryId", 0);
    const auto reply = [id](bool accepted) {
      send({{"type", "recoveryReleased"}, {"recoveryId", double(id)}, {"accepted", accepted}});
    };
    if (branchId || !device.releaseRecovery(id, [reply] { reply(true); }))
      reply(false);
  } else if (type == "testReadOutput") {
    unsigned frames = 0;
    float peak = 0;
    if (device.readTestOutput(frames, peak))
      send({{"type", "testOutput"}, {"frames", double(frames)}, {"peak", peak}});
    else
      send({{"type", "commandRejected"}, {"command", "testReadOutput"}});
  } else if (type == "testSetInput") {
    send({{"type", "testInputSet"},
          {"accepted", device.setTestInput(frame.message.GetNumber("level").value_or(-1.))}});
  } else if (type == "testDeviceReset") {
    if (!device.resetTestDevice(readNumber(frame.message, "deviceRate", 0),
                                readNumber(frame.message, "outputChannels", 0),
                                frame.message.GetString("unavailableOutputId").value_or(""),
                                frame.message.GetBool("loseInput").value_or(false)))
      send({{"type", "commandRejected"}, {"command", "testDeviceReset"}});
  } else if (type == "replaceInput") {
    const bool wasOpen = device.session.isOpen();
    const auto result = device.replaceInput(
        std::string(frame.message.GetString("inputDeviceId").value_or("")),
        deviceLatency(frame.message),
        std::string(frame.message.GetString("loopbackEndpointId").value_or("")));
    sendInputChange(device, wasOpen, result, readNumber(frame.message, "requestId", 0));
  } else if (type == "startStream" || type == "stopStream") {
    if (type == "stopStream")
      device.stop();
    const auto result = type == "startStream" ? device.start() : DeviceError::None;
    send({{"type", "sessionState"},
          {"state", result == DeviceError::None ? (type == "startStream" ? "running" : "stopped")
                                                : "failed"}});
  } else if (type == "closeSession") {
    device.stop();
    device.finishCommands();
    device.close();
    clearSampleStreams(0);
    clearSampleStreams(1);
    clearPowerRequests(0);
    clearPowerRequests(1);
    clearMidiRequests(0);
    clearMidiRequests(1);
    send({{"type", "sessionState"}, {"state", "closed"}});
  } else if (type == "startParallel") {
    if (!device.startParallel(frame.message.GetString("selection") == "B"))
      throw std::runtime_error("cannot start parallel pipeline");
    sendDspReady(device, 1, 0, readNumber(frame.message, "requestId", 0));
  } else if (type == "stopParallel") {
    clearSampleStreams(1);
    device.session.stopParallel();
    clearPowerRequests(1);
    retireParallelMidiRequests(device);
  } else if (type == "setBlindSelection") {
    device.session.selectParallel(frame.message.GetString("selection") == "B",
                                  frame.message.GetNumber("duration").value_or(.03));
  } else if (type == "configurePipeline") {
    bool published = false;
    if (!device.physical() && device.running()) {
      PendingTopology update;
      auto result = update.advance(device, frame);
      while (result == PendingTopology::Progress::Waiting)
        result = update.advance(device, frame);
      published = result == PendingTopology::Progress::Done;
    }
    if (published)
      pipelineApplied(frame, "continuous");
    else
      configurePipeline(*branch, frame);
    reportNetworkPaths(device, branchId);
  } else if (type == "resetProcessingState") {
    auto ok = std::make_shared<bool>(false);
    const auto *request = frame.message.Find("requestId");
    if (!device.submit([branch, ok](Session &) { *ok = branch->resetProcessing(); },
                       [ok, id = request ? *request : JsonValue(nullptr), branchId] {
                         send({{"type", "processingStateReset"},
                               {"ok", *ok},
                               {"requestId", id},
                               {"branch", double(branchId)}});
                       }))
      throw std::runtime_error("audio command queue full");
  } else if (type == "resetPluginState") {
    const auto id = frame.message.GetUInt32("pluginId").value_or(0);
    if (!device.submit([branch, id](Session &) { branch->pipeline()->resetTemporal({&id, 1}); }))
      throw std::runtime_error("audio command queue full");
  } else if (type && isOutputControl(*type)) {
    handleOutputControl(device, *branch, frame);
  } else if (type && isMidiControl(*type)) {
    handleMidiControl(device, *branch, frame);
  } else if (type && isPowerControl(*type)) {
    handlePowerControl(device, *branch, frame);
  } else if (type == "dspSetTelemetryRate") {
    const auto hz = static_cast<float>(frame.message.GetNumber("hz").value_or(0));
    const bool midiMetering = frame.message.GetBool("midiMetering").value_or(false);
    if (!device.submit(
            [branch, hz, midiMetering](Session &) { branch->setTelemetryRate(hz, midiMetering); }))
      throw std::runtime_error("audio command queue full");
  } else if (type == "frequencyPreview") {
    if (!device.submit([branch, f = frame.message.GetNumber("frequency").value_or(0.),
                        noise = frame.message.GetString("sound") == "bandpassNoise"](Session &) {
          branch->preview(f, noise);
        }))
      throw std::runtime_error("audio command queue full");
  } else if (type == "dspTelemetryReturn") {
    // Framed messages carry an independent buffer owned by the renderer.
  } else if (type == "setPluginAsset" || type == "clearPluginAsset") {
    changeAsset(device, *branch, frame, type == "clearPluginAsset");
  } else if (type == "updateParameters") {
    if (!device.session.isOpen())
      throw std::runtime_error("parameter update outside session");
    auto settings = pluginSettings(frame, frame.message);
    if (!device.submit([branch, settings = std::move(settings)](Session &) mutable {
          branch->updateParameter(settings);
        }))
      throw std::runtime_error("audio command queue full");
  } else if (type == "renderNull") {
    const auto frames = readNumber(frame.message, "frames", 0);
    if (device.physical())
      throw std::runtime_error("null render on physical backend");
    std::uint64_t processingNs = 0;
    auto result = NullDevice::render(device.session, frame.attachment, frames, &processingNs);
    send({{"type", "nullOutput"},
          {"frames", double(frames)},
          {"channelCount", double(device.session.format().width())},
          {"processingNanoseconds", double(processingNs)}},
         std::move(result));
  } else if (!type) {
    throw std::runtime_error("missing control message type");
  } else if (!handleSampleStream(device, *branch, frame) &&
             !handleAudioIo(device, *branch, frame, *type)) {
    send({{"type", "commandRejected"},
          {"command", std::string(*type)},
          {"reason", "unsupported"},
          {"branch", double(branchId)}});
  }
  if (!device.physical())
    serviceLatencyReservations(device);
  sendNetworkPackets(device.session);
  checkNetworkDelays(device);
  if (auto *active = device.session.branch(branchId); active && active->isOpen()) {
    notifySampleStreams(*active, branchId);
    notifyMidi(*active, branchId);
    notifyPower(device, *active, branchId);
  }
  for (unsigned i = 0; i < 2; ++i)
    if (auto *s = device.session.branch(i)) {
      sendAssetNotices(device, *s, i);
      sendTelemetry(device, *s, i);
      sendSpectrum(device, *s, i);
    }
  device.finishCommands();
}

int run(int argc, char **argv) {
  bool list = false;
  bool muteOutput = false;
  std::string_view backend;
  for (int i = 1; i < argc; ++i) {
    const std::string_view arg = argv[i];
    if (arg == "--backend" && i + 1 < argc)
      backend = argv[++i];
    else if (arg == "--list-devices")
      list = true;
    else if (arg == "--mute-device-output")
      muteOutput = true;
    else
      throw std::runtime_error("unknown command-line option");
  }
  DeviceHost device(backend, muteOutput);
  if (list) {
    const auto devices = [](const std::vector<DeviceInfo> &items) {
      Array output;
      for (const auto &item : items)
        output.emplace_back(Object{{"id", item.id},
                                   {"name", item.name},
                                   {"channels", double(item.channels)},
                                   {"isDefault", item.isDefault}});
      return output;
    };
    const auto result = device.list();
    std::cout << JsonValue(Object{{"backend", result.backend},
                                  {"outputs", devices(result.outputs)},
                                  {"inputs", devices(result.inputs)}})
                     .Serialize()
              << '\n';
    return std::cout ? 0 : 1;
  }
  Array backends{"null"};
  if (backend != "null")
    backends.emplace_back(std::string(backend));
  send({{"type", "hello"}, {"version", 1.0}, {"backends", std::move(backends)}});
  Frame frame;
  if (!readFrame(std::cin, frame))
    return 0;
  if (frame.kind != FrameKind::Control || frame.message.GetString("type") != "hello" ||
      frame.message.GetUInt32("version") != 1u)
    throw std::runtime_error("unsupported protocol version");
  const auto acceptFeed = [&](const Frame &incoming) {
    if (incoming.kind == FrameKind::Feed) {
      writePcm(device.session.feed(), incoming, &device.file);
    } else if (acceptFileControl(device.file, incoming.message)) {
      return;
    } else {
      const auto &m = incoming.message;
      device.session.feed().silence(
          frameIndex(m, "generation"),
          m.Find("sourceFrame") ? std::optional(frameIndex(m, "sourceFrame")) : std::nullopt);
    }
  };
  if (!device.physical()) {
    AssetTransfers transfers;
    while (readFrame(std::cin, frame, acceptFeed)) {
      if (frame.kind == FrameKind::Feed)
        acceptFeed(frame);
      else if (frame.kind == FrameKind::Control) {
        if (transfers.assemble(frame) && !acceptFileControl(device.file, frame.message) &&
            acceptsEndpoint(device, frame.message)) {
          handleControl(device, frame);
          if (frame.message.GetString("type") == "renderNullDevice") {
            const auto file = device.file.snapshot();
            if (file.generation) {
              Object clock{{"type", "clock"}, {"pipelineFrame", double(device.session.position())}};
              setFileClock(clock, file);
              send(std::move(clock));
            }
          }
        }
      } else
        throw std::runtime_error("unexpected frame kind");
      sendFileEvents(device.file);
    }
    return 0;
  }

  std::mutex mutex;
  std::condition_variable changed;
  std::deque<Frame> queue;
  std::size_t queuedBytes = 0;
  bool ended = false;
  std::exception_ptr readerError;
  std::thread reader([&] {
    try {
      AssetTransfers transfers;
      Frame incoming;
      while (readFrame(std::cin, incoming, acceptFeed)) {
        if (incoming.kind == FrameKind::Feed) {
          acceptFeed(incoming);
          continue;
        }
        if (incoming.kind != FrameKind::Control)
          throw std::runtime_error("unexpected frame kind");
        if (!transfers.assemble(incoming))
          continue;
        const auto type = incoming.message.GetString("type");
        if (acceptFileControl(device.file, incoming.message))
          continue;
        if (type == "flushFeed" || type == "feedSilence") {
          const auto gen = frameIndex(incoming.message, "generation");
          if (type == "flushFeed")
            device.session.feed().flush(gen);
          else
            acceptFeed(incoming);
          continue;
        }
        std::unique_lock lock(mutex);
        changed.wait(lock, [&] { return queue.size() < 64 && queuedBytes < 64 * 1024 * 1024; });
        queuedBytes += incoming.attachment.size();
        queue.emplace_back(std::move(incoming));
        changed.notify_one();
      }
    } catch (...) {
      std::lock_guard lock(mutex);
      readerError = std::current_exception();
    }
    std::lock_guard lock(mutex);
    ended = true;
    changed.notify_one();
  });
  try {
    std::optional<Frame> pending;
    std::optional<PendingTopology> topology;
    struct StopBeforeCommandReclamation {
      DeviceHost &host;
      ~StopBeforeCommandReclamation() { host.stop(); }
    } stopBeforeReclaim{device};
    auto nextClock = std::chrono::steady_clock::now();
    int resetReasons = 0;
    while (true) {
      {
        std::unique_lock lock(mutex);
        changed.wait_for(lock, std::chrono::milliseconds(2),
                         [&] { return ended || (!pending && !queue.empty()); });
        if (readerError)
          std::rethrow_exception(readerError);
        if (!pending && !queue.empty()) {
          queuedBytes -= queue.front().attachment.size();
          pending.emplace(std::move(queue.front()));
          queue.pop_front();
          changed.notify_one();
        }
        if (ended && !pending && !device.assetBusy() && device.commandsSettled())
          break;
      }
      device.poll();
      device.finishCommands();
      checkNetworkDelays(device);
      for (unsigned i = 0; i < 2; ++i)
        if (auto *s = device.session.branch(i)) {
          notifySampleStreams(*s, i);
          sendAssetNotices(device, *s, i);
          notifyMidi(*s, i);
          sendTelemetry(device, *s, i);
          notifyPower(device, *s, i);
          sendSpectrum(device, *s, i);
        }
      sendNetworkPackets(device.session);
      resetReasons |= device.takeReset();
      if (resetReasons && !topology && !device.assetBusy() && device.session.isOpen()) {
        const bool inputOnly = (resetReasons & 0xff) == 0;
        {
          send({{"type", "deviceReset"},
                {"direction", inputOnly ? "input" : "output"},
                {"reasons", double(resetReasons)}});
          const auto result = device.recoverReset(resetReasons);
          if (inputOnly) {
            sendInputChange(device, true, result);
          } else if (result == DeviceError::None) {
            sendOpenState(device, true);
          } else {
            send({{"type", "sessionState"},
                  {"state", "failed"},
                  {"reason", std::string(deviceErrorName(result))}});
          }
          resetReasons = 0;
        }
      }
      sendFileEvents(device.file);
      if (device.running() && std::chrono::steady_clock::now() >= nextClock) {
        DeviceHost::ClockSnapshot clock{};
        if (device.clock(clock)) {
          Object message{{"type", "clock"},
                         {"pipelineFrame", double(clock.pipelineFrame)},
                         {"timeNs", double(clock.timeNs)},
                         {"outputConverterDelayFrames", clock.converterDelay},
                         {"feedDelayFrames", double(clock.feedDelay)},
                         {"feedTargetFrames", double(clock.feedTarget)},
                         {"captureTargetFrames", double(clock.captureTarget)},
                         {"feedUnderruns", double(clock.feedUnderruns)},
                         {"feedGaps", double(device.session.feed().gaps())},
                         {"feedBackwardGaps", double(device.session.feed().backwardGaps())},
                         {"lastFeedGapExpected", double(device.session.feed().lastGapExpected())},
                         {"lastFeedGapReceived", double(device.session.feed().lastGapReceived())},
                         {"feedOverflows", double(device.session.feed().overflows())},
                         {"captureUnderruns", double(clock.captureUnderruns)},
                         {"captureFifoState", clock.captureState == 2   ? "running"
                                              : clock.captureState == 1 ? "priming"
                                                                        : "idle"},
                         {"captureRatio", clock.captureRatio},
                         {"deviceDiscontinuities", double(device.discontinuities())},
                         {"callbackOverruns", double(device.callbackOverruns())},
                         {"outputLatencyFrames", double(device.outputFormat().latencyFrames)},
                         {"inputLatencyFrames", double(device.inputFormat().latencyFrames)}};
          setFileClock(message, device.file.snapshot());
          send(std::move(message));
        }
        nextClock = std::chrono::steady_clock::now() + std::chrono::milliseconds(20);
      }
      if (!topology && !device.assetBusy() && !serviceLatencyReservations(device))
        continue;
      if (!pending || device.assetBusy())
        continue;
      if (!acceptsEndpoint(device, pending->message)) {
        pending.reset();
        continue;
      }
      const auto type = pending->message.GetString("type");
      if (device.measuring() || (type && isMeasurementCommand(*type))) {
        handleMeasurement(device, *pending);
        pending.reset();
        continue;
      }
      if (type == "stopParallel" && !device.commandsSettled())
        continue;
      if (type == "renderNull" || type == "renderNullDevice" || type == "captureNull")
        throw std::runtime_error("null test command on physical backend");
      if (type == "configurePipeline" && device.running()) {
        if (!topology)
          topology.emplace();
        const auto progress = topology->advance(device, *pending);
        if (progress == PendingTopology::Progress::Waiting)
          continue;
        if (progress == PendingTopology::Progress::Done) {
          topology.reset();
          pipelineApplied(*pending, "continuous");
          reportNetworkPaths(device, readNumber(pending->message, "branch", 0));
          pending.reset();
          continue;
        }
      }
      const bool needsOwnership =
          (type != "closeSession" && type != "stopStream" && type != "startStream" &&
           type != "startParallel" && type != "stopParallel" && type != "setBlindSelection" &&
           type != "updateParameters" && type != "setInputMix" && type != "pcm-ack" &&
           type != "setNetworkOutputPort" && type != "setNetworkOutputSendPaused" &&
           type != "sfzPublishPage" && type != "sfzPollPages" && type != "dspSetTelemetryRate" &&
           type != "dspTelemetryReturn" && type != "replaceInput" && type != "frequencyPreview" &&
           type != "testDeviceReset" && type != "testReadOutput" && type != "testSetInput" &&
           type != "releaseRecovery" && type != "setPluginAsset" && type != "clearPluginAsset" &&
           type != "resetPluginState" && type != "setVisualSync" &&
           type != "setNetworkOutputLocalDelay" &&
           (!type || (!isOutputControl(*type) && !isPowerControl(*type) && !isMidiControl(*type))));
      if (needsOwnership && !device.acquire())
        continue;
      topology.reset();
      handleControl(device, *pending);
      if (needsOwnership)
        device.release();
      pending.reset();
    }
  } catch (const std::exception &error) {
    // stdin may still be blocked in a parent which has stopped reading stdout.
    // Release physical resources before ending the outstanding pipe read.
    device.close();
    std::cerr << error.what() << std::endl;
    std::_Exit(1);
  }
  reader.join();
  return 0;
}
} // namespace
} // namespace effetune::audio

int runAudioEngine(int argc, char **argv) {
  if (!initializeAudioEnginePlatform())
    return 1;
  try {
    return effetune::audio::run(argc, argv);
  } catch (const std::exception &error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}

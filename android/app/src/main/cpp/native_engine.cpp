#include "native_engine.h"
#include "device/null/null_device.h"
#include "engine.h"
#include "host/io_pipeline.h"
#include "host/network_paths.h"
#include <sstream>
#include <aaudio/AAudio.h>
#include <algorithm>
#include <android/log.h>
#include <chrono>
#include <cmath>
#include <cstring>
#include <numbers>
#include <stdexcept>
#include <sys/mman.h>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>

namespace effetune::android {

namespace {

// Input capacity while no output is open to size it from.
constexpr std::int32_t kDefaultInputCapacity = 16384;

// Burst and buffer sizes count frames of the wrapped AAudio stream, whose rate
// Oboe's conversion wrapper hides behind the host rate.
int deviceFrameRate(oboe::AudioStream &stream) {
  const auto rate =
      stream.getAudioApi() == oboe::AudioApi::AAudio
          ? AAudioStream_getSampleRate(
                static_cast<AAudioStream *>(stream.getUnderlyingStream()))
          : 0;
  return rate > 0 ? rate : stream.getSampleRate();
}

} // namespace

// The same input-frame clock and polyphase filter as live-pcm-core.js. The file
// FIFO supplies batches at the sender's rate. Only the consumer owns FIR history.
struct NativeEngine::LiveInput {
  static constexpr unsigned rate = 44100, capacity = 88200, preroll = 5292, taps = 64, phases = 1024;
  // A power-of-two backing keeps PcmRing's wrapping uint32 indices contiguous.
  // The producer enforces the protocol's smaller two-second limit.
  PcmRing<131072> fifo;
  const std::uint64_t source = fifo.beginSource();
  std::array<float, phases * taps> coefficients;
  // Duplicate a 128-sample window to read each 64-tap span contiguously.
  float history[2][256]{};
  std::uint64_t written = 0, fetched = 0, route = 0;
  double cursor = 0, drift = 0, integral = 0, filtered = 0, gain = 0;
  double activationGain = 0;
  bool started = false;
  static_assert(std::atomic<double>::is_always_lock_free);
  std::atomic<double> position{-1};

  explicit LiveInput(int outputRate) {
    const double cutoff = 0.94 * std::min(1., double(outputRate) / rate);
    for (unsigned phase = 0; phase < phases; ++phase) {
      double sum = 0;
      auto *bank = coefficients.data() + phase * taps;
      for (unsigned tap = 0; tap < taps; ++tap) {
        const double angle = std::numbers::pi * cutoff * (double(tap) - 31 - double(phase) / phases);
        const double window = 2 * std::numbers::pi * tap / (taps - 1);
        const double value = cutoff * (angle == 0 ? 1 : std::sin(angle) / angle) *
                             (0.42 - 0.5 * std::cos(window) + 0.08 * std::cos(2 * window));
        bank[tap] = static_cast<float>(value);
        sum += value;
      }
      for (unsigned tap = 0; tap < taps; ++tap) bank[tap] = static_cast<float>(bank[tap] / sum);
    }
  }

  int write(const float *pcm, unsigned frames) {
    const double reported = position.load(std::memory_order_relaxed);
    const double consumed = reported < 0 ? -1 - reported : reported;
    if (written + frames - consumed > capacity - taps) return 0;
    if (fifo.write(pcm, frames, source) != frames) return 0;
    written += frames;
    return written >= preroll ? 2 : 1;
  }

  void refill(unsigned count) noexcept {
    float batch[2 * taps]{};
    fifo.read(batch, count, true);
    for (unsigned ch = 0; ch < 2; ++ch) {
      for (unsigned i = 0; i < count; ++i) {
        const auto index = (fetched + i) % 128;
        history[ch][index] = history[ch][index + 128] = batch[ch * count + i];
      }
    }
    fetched += count;
  }

  bool render(float *audio, int frames, int channels, int outputRate, float volume) noexcept {
    const auto end = fetched + fifo.queued();
    const double buffered = end - cursor;
    if (!started && buffered < preroll) return true;
    started = true;
    const double seconds = double(frames) / outputRate;
    const double error = (buffered - seconds * rate * (1 + drift) / 2 - preroll) / preroll;
    filtered += (error - filtered) * (1 - std::exp(-seconds / 2));
    integral = std::clamp(integral + filtered * .00002 * seconds, -.002, .002);
    drift += (std::clamp(filtered * .002 + integral, -.002, .002) - drift) * (1 - std::exp(-seconds / .5));
    const double step = double(rate) / outputRate * (1 + drift);
    const double fade = std::ceil(outputRate * .005);
    for (int i = 0; i < frames; ++i) {
      const auto center = static_cast<std::uint64_t>(cursor);
      if (center + taps / 2 >= end) {
        started = false;
        drift = integral = filtered = gain = 0;
        break;
      }
      if (center + taps / 2 >= fetched)
        refill(static_cast<unsigned>(std::min<std::uint64_t>(taps, end - fetched)));
      const auto offset = (center - (taps / 2 - 1)) % 128;
      const auto *bank = coefficients.data() + static_cast<unsigned>((cursor - center) * phases) * taps;
      double left = 0, right = 0;
      for (unsigned tap = 0; tap < taps; ++tap) {
        left += double(history[0][offset + tap]) * bank[tap];
        right += double(history[1][offset + tap]) * bank[tap];
      }
      gain = std::min({1., gain + 1 / fade, (end - taps / 2 - cursor) / (step * fade)});
      activationGain = std::min(1., activationGain + 1 / (outputRate * .01));
      const auto scale = volume * gain * activationGain;
      audio[i] += static_cast<float>(left * scale);
      if (channels > 1) audio[frames + i] += static_cast<float>(right * scale);
      cursor += step;
    }
    position.store(started ? cursor : -1 - cursor, std::memory_order_relaxed);
    return started;
  }
};

void NativeEngine::setLiveInput(bool enabled) {
  auto next = enabled ? std::make_unique<LiveInput>(sampleRate_) : nullptr;
  acquire();
  liveInput_.swap(next);
  release();
}

void NativeEngine::activateLiveInput(std::uint64_t generation) {
  if (run([&]() noexcept {
        if (!liveInput_ || !session_.io()->receiving || session_.io()->receiveGeneration != generation)
          return ET_ERR_STATE;
        liveInput_->route = generation;
        return ET_OK;
      }) != ET_OK) throw std::runtime_error("Receive route changed");
}

int NativeEngine::writeLivePcm(const float *pcm, unsigned frames) {
  return liveInput_ ? liveInput_->write(pcm, frames) : 0;
}

double NativeEngine::livePosition() const noexcept {
  return liveInput_ ? liveInput_->position.load(std::memory_order_relaxed) : -1.;
}

NativeEngine::NativeEngine(std::int32_t sampleRate, std::int32_t maxFrames,
                           std::uint32_t channels)
    : sampleRate_(sampleRate), maxFrames_(maxFrames), channels_(channels), streamChannels_(channels) {
  if (sampleRate < 8000 || sampleRate > 192000 || maxFrames < 64 ||
      maxFrames > 4096 || channels < 1 || channels > 16) {
    throw std::invalid_argument("Invalid audio format");
  }
  pcm_.setChannels(channels);
  microphone_.resize(static_cast<std::size_t>(maxFrames) * 2);
  planarIn_.resize(static_cast<std::size_t>(maxFrames) * channels);
  planarOut_.resize(planarIn_.size());
  if (!session_.open({static_cast<unsigned>(sampleRate), channels, channels,
                      static_cast<unsigned>(maxFrames)}))
    throw std::runtime_error("Engine prepare failed");
}

NativeEngine::~NativeEngine() {
  stop();
  if (input_)
    input_->close();
}

std::vector<std::uint64_t> NativeEngine::benchmark(
    const std::vector<float> &planarLoop, std::uint32_t channels,
    std::uint32_t warmupBlocks, std::uint64_t durationNs) {
  if (output_ || channels != session_.format().width())
    throw std::invalid_argument("Invalid benchmark input");
  const auto timing = audio::NullDevice::benchmark(
      session_, planarLoop, static_cast<std::uint32_t>(maxFrames_), warmupBlocks, durationNs);
  return {timing.elapsedNs, timing.blocks};
}

int NativeEngine::openOutput() {
  if (channels_ < 2) return lastOutputError_ = static_cast<int>(oboe::Result::ErrorInvalidFormat);
  outputError_ = std::make_shared<OutputError>();
  // Playback trades latency for the deep buffer of the regular mixer path.
  const bool lowLatency = latency_ != 2;
  oboe::AudioStreamBuilder builder;
  builder.setDirection(oboe::Direction::Output)
      ->setFormat(oboe::AudioFormat::Float)
      ->setChannelCount(channels_)
      ->setSampleRate(sampleRate_)
      ->setSampleRateConversionQuality(
          oboe::SampleRateConversionQuality::Medium)
      ->setPerformanceMode(lowLatency ? oboe::PerformanceMode::LowLatency
                                      : oboe::PerformanceMode::None)
      ->setSharingMode(oboe::SharingMode::Shared)
      ->setUsage(oboe::Usage::Media)
      ->setDeviceId(preferredOutput_)
      ->setErrorCallback(outputError_)
      ->setDataCallback(this);
  auto status = builder.openStream(output_);
  if (status != oboe::Result::OK)
    return lastOutputError_ = static_cast<int>(status);
  if (output_->getChannelCount() != channels_ ||
      (channels_ > 2 && preferredOutput_ > 0 && output_->getDeviceId() != preferredOutput_)) {
    output_->close();
    output_.reset();
    return lastOutputError_ = static_cast<int>(oboe::Result::ErrorInvalidFormat);
  }
  return 0;
}

bool NativeEngine::checkOutputFormat() {
  if (openOutput() != 0) return false;
  output_->close();
  output_.reset();
  return true;
}

int NativeEngine::start() {
  if (outputStatus() == 1) return 0;
  if (openOutput() != 0) return lastOutputError_;
  const auto rate = deviceFrameRate(*output_);
  if (latency_ != 2) {
    // The tuner starts at two bursts; observeOutput() widens it after XRuns.
    tuner_ = std::make_unique<oboe::LatencyTuner>(*output_);
    if (latency_ == 1) {
      // Balanced starts near 40 ms, in whole device bursts.
      const auto burst = std::max(1, output_->getFramesPerBurst());
      output_->setBufferSizeInFrames(
          std::min(output_->getBufferCapacityInFrames(),
                   (rate / 25 + burst - 1) / burst * burst));
    }
  }
  // Oboe reports the callback load to the OS (ADPF) on streams and devices
  // that support it and ignores the request elsewhere.
  output_->setPerformanceHintEnabled(true);
  renderFailed_.store(false, std::memory_order_release);
  owner_.store(session_.output().topologyReady() ? Owner::Audio : Owner::Returned,
               std::memory_order_release);
  // Match the desktop monitor's render headroom to the output buffer duration.
  const double headroomMs = rate > 0 ? 1000.0 * output_->getBufferSizeInFrames() / rate : 0;
  session_.overload(true, .05, headroomMs);
  auto status = output_->requestStart();
  if (status != oboe::Result::OK) {
    tuner_.reset();
    output_->close();
    output_.reset();
    return lastOutputError_ = static_cast<int>(status);
  }
  __android_log_print(
      ANDROID_LOG_INFO, "EffeTuneAudio",
      "Output api=%d mmap=%d rate=%d hardware=%d host=%d burst=%d buffer=%d "
      "capacity=%d mode=%d latency=%d",
      static_cast<int>(output_->getAudioApi()),
      output_->getAudioApi() == oboe::AudioApi::AAudio &&
              oboe::OboeExtensions::isMMapUsed(output_.get())
          ? 1
          : 0,
      rate, output_->getHardwareSampleRate(), sampleRate_,
      output_->getFramesPerBurst(), output_->getBufferSizeInFrames(),
      output_->getBufferCapacityInFrames(),
      static_cast<int>(output_->getPerformanceMode()), latency_);
  running_ = true;
  lastOutputError_ = 0;
  return 0;
}

void NativeEngine::stop() {
  closeOutput();
  applyPending();
  if (capture_)
    capture_->invalidate();
  if (streamChannels_ != channels_) {
    capture_.reset();
    std::vector<float>().swap(measurementPlanar_);
    streamChannels_ = channels_;
  }
  directMeasurementStreams_ = false;
  measurementNoise_.clear();
  lastOutputError_ = 0;
}

int NativeEngine::outputStatus() {
  int error =
      outputError_ ? outputError_->error.load(std::memory_order_acquire) : 0;
  if (running_ && error == 0 && output_) {
    const auto state = output_->getState();
    if (state == oboe::StreamState::Disconnected ||
        state == oboe::StreamState::Closed ||
        state == oboe::StreamState::Stopped)
      error = static_cast<int>(oboe::Result::ErrorDisconnected);
  }
  if (running_ && error == 0 && renderFailed_.load(std::memory_order_acquire))
    error = kPipelineFailed;
  if (error != 0) {
    stop();
    lastOutputError_ = error;
  }
  return running_ ? 1 : lastOutputError_;
}

std::vector<int> NativeEngine::observeOutput() {
  std::vector<int> result(8);
  if (outputStatus() == 1) {
    if (tuner_)
      tuner_->tune();
    result[0] = deviceFrameRate(*output_);
    result[1] = output_->getFramesPerBurst();
    result[2] = output_->getBufferSizeInFrames();
    const auto xruns = output_->getXRunCount();
    result[3] = xruns ? xruns.value() : 0;
    // Zero while the OS does not report the rate of the output hardware.
    result[7] = std::max(0, output_->getHardwareSampleRate());
  }
  result[4] = renderFailures_.load(std::memory_order_relaxed);
  result[5] = sourceUnderruns_.load(std::memory_order_relaxed);
  result[6] = inputUnderruns_.load(std::memory_order_relaxed);
  return result;
}

int NativeEngine::inputSessionId() const {
  if (!input_)
    return 0;
  auto session = static_cast<int>(input_->getSessionId());
  // The conversion wrapper retains the requested Allocate value. Query the
  // actual AAudio stream when Oboe has not propagated its allocated session.
  if (session <= 0 && input_->getAudioApi() == oboe::AudioApi::AAudio)
    session = AAudioStream_getSessionId(
        static_cast<AAudioStream *>(input_->getUnderlyingStream()));
  return session > 0 ? session : 0;
}

void NativeEngine::closeOutput() {
  tuner_.reset();
  if (output_) {
    output_->requestStop();
    output_->close();
    output_.reset();
  }
  // Desktop fadeOutOutput contract; a pending warning is cleared.
  session_.overload(false, 0, 0);
  running_ = false;
  owner_.store(Owner::Audio, std::memory_order_release);
  outputError_.reset();
}

void NativeEngine::acquire() {
  if (outputStatus() != 1)
    return;
  owner_.store(Owner::Requested, std::memory_order_release);
  const auto deadline =
      std::chrono::steady_clock::now() + std::chrono::seconds(2);
  while (owner_.load(std::memory_order_acquire) != Owner::Control) {
    if (std::chrono::steady_clock::now() >= deadline) {
      // A stalled callback cannot hand the graph over. Closing joins it.
      stop();
      lastOutputError_ = static_cast<int>(oboe::Result::ErrorTimeout);
      return;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
}

void NativeEngine::release() noexcept {
  if (running_)
    owner_.store(Owner::Returned, std::memory_order_release);
}

int NativeEngine::outputDeviceId() const {
  return output_ ? output_->getDeviceId() : 0;
}

int NativeEngine::setNetworkOutput(bool attached, bool paused) {
  const int result = run([&]() noexcept {
    auto *io = session_.io();
    if (networkAttached_ != attached) {
      io->sender.setAttached(attached);
      networkAttached_ = attached;
    }
    io->paused = paused;
    return ET_OK;
  });
  if (result == ET_OK && !attached) {
    audio::NetworkPacket stale;
    while (session_.io()->sender.pop(stale)) {}
  }
  return result;
}

int NativeEngine::setNetworkLocalDelay(unsigned request, bool active, double ms, bool local) {
  auto *io = session_.io();
  auto *secondary = session_.branch(1);
  const auto samples = static_cast<unsigned>(std::round(std::clamp(ms, 0., 8000.) * sampleRate_ / 1000.));
  const auto result = run([&]() noexcept {
    io->requestLocalDelay(request, active, samples, local);
    if (secondary)
      secondary->io()->requestLocalDelay(request, active, samples, local);
    return ET_OK;
  });
  if (result == ET_OK)
    io->pendingDelayRequest = request;
  return result;
}

int NativeEngine::setNetworkReceiveSession(bool active, std::uint64_t generation) {
  auto *io = session_.io();
  auto *secondary = session_.branch(1);
  const auto current = [&](audio::Session &path) {
    return generation == path.io()->receiveGeneration && active == path.io()->receiving;
  };
  if (generation < io->receiveGeneration || (current(session_) && (!secondary || current(*secondary))))
    return ET_OK;
  acquire();
  const auto route = [&](audio::Session &path) {
    if (current(path)) return true;
    if (!path.pipeline()->setNetworkRouting(active, path.masterBypass())) return false;
    path.io()->receiveGeneration = generation;
    path.io()->receiving = active;
    path.io()->markTapChanged();
    return true;
  };
  const bool ok = route(session_) && (!secondary || route(*secondary));
  release();
  return ok ? ET_OK : ET_ERR_STATE;
}

bool NativeEngine::popNetworkPacket(audio::NetworkPacket &packet) {
  return session_.io()->sender.pop(packet);
}

int NativeEngine::acknowledgeNetwork(std::uint64_t epoch, std::uint64_t frame) {
  return run([&]() noexcept {
    session_.io()->sender.acknowledge(epoch, frame);
    return ET_OK;
  });
}

std::string NativeEngine::networkReports(bool force) {
  audio::NetworkPaths p;
  auto *io = session_.io();
  unsigned applied = 0;
  bool publish = false;
  const auto result = run([&]() noexcept {
    const unsigned outputDelay = session_.output().appliedDelay();
    if (io->reportedOutputDelay != outputDelay) {
      io->reportedOutputDelay = outputDelay;
      io->markTapChanged();
    }
    if (io->pendingDelayRequest &&
        io->appliedDelayRequest.load(std::memory_order_acquire) == io->pendingDelayRequest) {
      applied = io->pendingDelayRequest;
      io->pendingDelayRequest = 0;
    }
    publish = force || applied || reportedRoute_ != io->routeRevision;
    if (!publish)
      return ET_OK;
    session_.pipeline()->traceOutputs(p);
    p.revision = io->routeRevision;
    p.tapRevision = io->tapRevision;
    p.localDelayRevision = io->localDelayRevision;
    p.generation = io->receiveGeneration;
    p.receiving = io->receiving;
    p.sampleRate = sampleRate_;
    p.latency = session_.latency();
    p.outputDelay = outputDelay;
    p.localDelay = io->delay.samples();
    constexpr const char *stages[] = {"pipeline", "local", "send", "network"};
    p.stage = stages[static_cast<unsigned>(audio::visualizerStage(
        io->delay.active(), io->visualSync, p.sendId != 0, io->receiving))];
    return ET_OK;
  });
  if (result != ET_OK || !publish)
    return {};
  reportedRoute_ = p.revision;
  const auto optionalId = [](unsigned id) { return id ? std::to_string(id) : "null"; };
  const auto path = [](const Engine::RoutedDelay &d) {
    const auto delay = [](auto n) { return n < 0 ? std::string("null") : std::to_string(n); };
    return "{\"localSamples\":" + delay(d.local) + ",\"networkSamples\":" + delay(d.network) + "}";
  };
  std::ostringstream out, taps, dsp;
  std::string send = "null", receive = "null";
  bool first = true;
  for (unsigned i = 0; i < p.count; ++i) {
    const auto id = p.pluginIds[i];
    if (!id) continue;
    const auto &tap = p.taps[i];
    const auto input = path(tap.input);
    if (id == p.sendId) send = input;
    if (id == p.receiveId) receive = input;
    const auto key = std::string(first ? "\"" : ",\"") + std::to_string(id) + "\":";
    first = false;
    taps << key << "{\"input\":" << input << ",\"output\":" << path(tap.output) << "}";
    dsp << key << "{\"input\":" << p.latencies[i].input << ",\"output\":" << p.latencies[i].output
        << ",\"execution\":\"wasm\",\"instanceId\":" << tap.instance << "}";
  }
  out << std::boolalpha << '[';
  if (applied)
    out << "{\"type\":\"networkDelayApplied\",\"branch\":0,\"requestId\":" << applied
        << ",\"localDelaySamples\":" << p.localDelay << "},";
  out << "{\"type\":\"networkRoute\",\"branch\":0,\"sendId\":" << optionalId(p.sendId)
      << ",\"receiveId\":" << optionalId(p.receiveId) << ",\"receiveActive\":" << p.receiving
      << ",\"generation\":" << p.generation << ",\"revision\":" << p.revision
      << ",\"localDelaySamples\":" << p.localDelay << ",\"visualizerTapStage\":\"" << p.stage
      << "\"},{\"type\":\"networkPaths\",\"branch\":0,\"revision\":" << p.revision
      << ",\"tapRevision\":" << p.tapRevision << ",\"sampleRate\":" << p.sampleRate
      << ",\"outputDelaySamples\":" << p.outputDelay << ",\"localDelaySamples\":" << p.localDelay
      << ",\"localDelayRevision\":" << p.localDelayRevision << ",\"visualizerTapStage\":\"" << p.stage
      << "\",\"send\":" << send << ",\"receive\":" << receive << ",\"taps\":{" << taps.str()
      << "}},{\"type\":\"dspLatency\",\"branch\":0,\"samples\":" << p.latency << ",\"sampleRate\":" << p.sampleRate
      << ",\"compensated\":" << !p.bypassed << ",\"taps\":{" << dsp.str() << "}}]";
  return out.str();
}

void NativeEngine::prepareResume() {
  Command command(Command::Kind::Resume);
  submit(command);
}

int NativeEngine::setOutput(int deviceId, int mode) {
  if (deviceId < 0)
    throw std::invalid_argument("Invalid output device");
  if (mode < 0 || mode > 2)
    throw std::invalid_argument("Invalid latency mode");
  const bool restart = running_;
  const int previousDevice = preferredOutput_, previousMode = latency_;
  stop();
  preferredOutput_ = deviceId;
  latency_ = mode;
  if (!restart)
    return 0;
  const int result = start();
  if (result != 0) {
    preferredOutput_ = previousDevice;
    latency_ = previousMode;
    start();
  }
  return result;
}

void NativeEngine::startMeasurementSignal(Command &command) {
  if (measurementPipeline_.load() && !directMeasurementStreams_) {
    // Clear effect and compensation delays on control before publishing this signal.
    acquire();
    if (!session_.resetProcessing()) {
      release();
      throw std::runtime_error("Cannot reset the measurement pipeline");
    }
    // resetProcessing has already opened the topology gate for the first signal block.
    owner_.store(Owner::Audio, std::memory_order_release);
  }
  if (submit(command) != ET_OK)
    throw std::runtime_error("Cannot start the measurement signal");
}

void NativeEngine::setMeasurementNoiseFile(int fd, std::uint32_t frames) {
  struct stat info{};
  if (frames == 0 || frames > static_cast<std::uint32_t>(sampleRate_) * 10 ||
      fstat(fd, &info) || !S_ISREG(info.st_mode) ||
      info.st_size != static_cast<std::int64_t>(frames) * streamChannels_ * static_cast<int>(sizeof(float)))
    throw std::invalid_argument("Invalid measurement noise file");
  Command command(Command::Kind::MeasurementNoise);
  command.floats.resize(static_cast<std::size_t>(frames) * streamChannels_);
  const auto bytes = command.floats.size() * sizeof(float);
  if (pread(fd, command.floats.data(), bytes, 0) != static_cast<ssize_t>(bytes))
    throw std::runtime_error("Cannot read measurement noise file");
  for (float value : command.floats)
    if (!std::isfinite(value) || std::abs(value) > 1)
      throw std::invalid_argument("Invalid noise sample");
  startMeasurementSignal(command);
}

void NativeEngine::stopMeasurementNoise() {
  Command command(Command::Kind::MeasurementNoise);
  submit(command);
}

// Direct measurements can clock the duplex streams independently of the graph.
// Replace the streams on control and reuse the callback buffers.
int NativeEngine::openMeasurementStreams(int rate, int inputDevice, int outputDevice, int width) {
  if (width < 2 || width > 16) return static_cast<int>(oboe::Result::ErrorInvalidFormat);
  stop();
  setInputDevice(-1);
  directMeasurementStreams_ = rate != sampleRate_ || width != channels_;
  streamChannels_ = width;
  if (width > channels_) measurementPlanar_.resize(std::size_t(maxFrames_) * width);
  oboe::AudioStreamBuilder builder;
  builder.setFormat(oboe::AudioFormat::Float)->setSampleRate(rate)->setChannelCount(width)
      ->setSharingMode(oboe::SharingMode::Shared)->setPerformanceMode(oboe::PerformanceMode::LowLatency);
  outputError_ = std::make_shared<OutputError>();
  builder.setDirection(oboe::Direction::Output)->setUsage(oboe::Usage::Media)
      ->setDeviceId(outputDevice)->setErrorCallback(outputError_)->setDataCallback(this);
  auto status = builder.openStream(output_);
  if (status != oboe::Result::OK) return static_cast<int>(status);
  if (output_->getChannelCount() != width || (outputDevice > 0 && output_->getDeviceId() != outputDevice))
    return static_cast<int>(oboe::Result::ErrorInvalidFormat);
  oboe::AudioStreamBuilder input;
  input.setDirection(oboe::Direction::Input)->setFormat(oboe::AudioFormat::Float)
      ->setSampleRate(rate)->setChannelCount(2)->setChannelConversionAllowed(true)
      ->setDeviceId(inputDevice)->setInputPreset(oboe::InputPreset::Unprocessed)
      ->setSessionId(oboe::SessionId::Allocate)->setSharingMode(oboe::SharingMode::Shared)
      ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
      ->setBufferCapacityInFrames(output_->getBufferCapacityInFrames() * 2);
  status = input.openStream(input_);
  if (status != oboe::Result::OK) return static_cast<int>(status);
  if (measurementRate() != rate) return static_cast<int>(oboe::Result::ErrorInvalidRate);
  inputBurst_ = inputBurstFrames(input_->getFramesPerBurst(), deviceFrameRate(*input_), rate);
  inputPrimed_ = false;
  inputWait_ = 0;
  renderFailed_.store(false, std::memory_order_release);
  status = input_->requestStart();
  if (status == oboe::Result::OK) status = output_->requestStart();
  running_ = status == oboe::Result::OK;
  return static_cast<int>(status);
}

int NativeEngine::closeMeasurementStreams(bool restart) {
  stop();
  setInputDevice(-1);
  return restart ? start() : 0;
}

void NativeEngine::startDuplexCapture(int excitationFd, int resultFd, unsigned excitationFrames,
                                      unsigned frames, float overloadPeak, unsigned overloadTail, int channel) {
  const auto rate = measurementRate();
  if (rate == sampleRate_)
    return beginMeasurementFiles(excitationFd, resultFd, excitationFrames, frames, overloadPeak, overloadTail, channel);
  if (!directMeasurementStreams_ || rate <= 0 || frames > 16ULL * 1048576 + 41ULL * rate)
    throw std::invalid_argument("Invalid direct measurement format or duration");
  Command command(Command::Kind::MeasurementStart);
  command.capture = std::make_unique<FiniteCapture>(excitationFd, resultFd, excitationFrames, frames,
                                                    overloadPeak, overloadTail, channel, streamChannels_);
  startMeasurementSignal(command);
}

int NativeEngine::setInputDevice(int deviceId) {
  Command command(Command::Kind::Input);
  if (deviceId >= 0) {
    oboe::AudioStreamBuilder builder;
    builder.setDirection(oboe::Direction::Input)
        ->setFormat(oboe::AudioFormat::Float)
        ->setChannelCount(2)
        ->setChannelConversionAllowed(true)
        ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
        ->setSharingMode(oboe::SharingMode::Shared)
        ->setBufferCapacityInFrames(
            output_ ? output_->getBufferCapacityInFrames() * 2
                    : kDefaultInputCapacity)
        ->setSampleRate(sampleRate_)
        ->setSampleRateConversionQuality(
            oboe::SampleRateConversionQuality::Medium)
        ->setInputPreset(oboe::InputPreset::Unprocessed)
        ->setSessionId(oboe::SessionId::Allocate)
        ->setDeviceId(deviceId);
    auto status = builder.openStream(command.input);
    if (status != oboe::Result::OK)
      return static_cast<int>(status);
    status = command.input->requestStart();
    if (status != oboe::Result::OK) {
      command.input->close();
      return static_cast<int>(status);
    }
    const auto deviceRate = deviceFrameRate(*command.input);
    // Oboe's FilterAudioStream scales frame counters but retains the child
    // stream's burst size. Convert that size to the application's frame domain.
    command.inputBurst = inputBurstFrames(command.input->getFramesPerBurst(),
                                          deviceRate, sampleRate_);
    __android_log_print(ANDROID_LOG_DEBUG, "EffeTuneAudio",
                        "Input rate=%d host=%d deviceBurst=%d hostBurst=%u",
                        deviceRate, sampleRate_,
                        command.input->getFramesPerBurst(), command.inputBurst);
  }
  const auto status = submit(command);
  // The callback first exchanges to the new source (or running silence). Only
  // afterwards does control release the old microphone stream.
  if (command.input)
    command.input->close();
  return status;
}

static audio::MidiScheduler::Transport readScore(int fd);

int NativeEngine::startParallel(int scoreFd, double speed) {
  auto score = readScore(scoreFd);
  auto state = std::make_unique<ParallelMidi>();
  // Session allocates and publishes the second graph on the control thread.
  if (!session_.startParallel(false))
    return ET_ERR_STATE;
  auto *path = session_.branch(1);
  auto &midi = path->pipeline()->midi;
  state->scheduler = &midi;
  const bool ownGraph = scoreFd >= 0 || session_.masterBypass();
  if (ownGraph) acquire();
  try {
    if (session_.masterBypass()) path->setMasterBypass(true);
    if (scoreFd >= 0) {
      score.anchor = session_.position();
      score.position = session_.pipeline()->midi.position(score.anchor, sampleRate_);
      score.generation = session_.pipeline()->midi.generation();
      score.speed = speed;
      score.gain = playerGain_.load();
      score.preparing = scoreWaiting_ != 0;
      score.playing = scoreRunning_ && !score.preparing;
      if (!midi.configure(score))
        throw std::runtime_error("Parallel score rejected");
      if (score.preparing) scoreWaiting_ |= 2;
    }
    run([&]() noexcept {
      if (scoreFd < 0 && liveMidi_)
        midi.configureInput(session_.pipeline()->midi.generation(), true, session_.position());
      parallelMidi_.swap(state);
      return ET_OK;
    });
  } catch (...) {
    session_.stopParallel();
    if (ownGraph) release();
    throw;
  }
  if (ownGraph) release();
  return ET_OK;
}

void NativeEngine::stopParallel() {
  if (!session_.branch(1))
    return;
  // Detach between callbacks so the session releases the bank memory here.
  acquire();
  discardParallel();
  release();
}

void NativeEngine::discardParallel() {
  session_.stopParallel();
  parallelMidi_.reset();
  if (scoreWaiting_ == 2) {
    auto &primary = session_.pipeline()->midi;
    primary.start(primary.generation(), session_.position());
  }
  scoreWaiting_ &= 1;
}

int NativeEngine::selectParallel(int branch, double seconds) {
  if (!session_.branch(1) || (branch != 0 && branch != 1) ||
      !std::isfinite(seconds) || seconds < 0 || seconds > 60)
    return ET_ERR_ARGS;
  session_.selectParallel(branch == 1, seconds);
  return ET_OK;
}

int NativeEngine::setOutputDelay(int branch, int samples) {
  auto *path = session_.branch(branch);
  if (!path || samples < 0 || static_cast<unsigned>(samples) > path->output().maxDelay())
    return ET_ERR_ARGS;
  return run([&]() noexcept {
    path->output().delay(samples, running_ && !monitoring_);
    return ET_OK;
  });
}

int NativeEngine::fadeOutput(int branch, float gain, double seconds) {
  auto *path = session_.branch(branch);
  if (!path || !std::isfinite(gain) || gain < 0 || gain > 1 ||
      !std::isfinite(seconds) || seconds < 0 || seconds > 60)
    return ET_ERR_ARGS;
  return run([&]() noexcept {
    path->output().fade(gain, static_cast<unsigned>(seconds * sampleRate_ + .5));
    return ET_OK;
  });
}

std::vector<int> NativeEngine::configure(
    const std::vector<std::string> &types,
    const std::vector<std::vector<float>> &parameters,
    const std::vector<std::uint32_t> &hashes,
    const std::vector<std::uint32_t> &ids,
    std::vector<std::uint8_t> descriptor,
    const std::vector<std::vector<std::uint8_t>> &structured,
    const std::vector<std::uint8_t> &flags, int branch) {
  auto *path = session_.branch(branch);
  if (!path)
    throw std::invalid_argument("Missing pipeline branch");
  if (types.size() > 128 || types.size() != parameters.size() ||
      types.size() != hashes.size() || types.size() != ids.size() ||
      descriptor.size() != 8 + types.size() * 12 ||
      (!structured.empty() && structured.size() != types.size()) ||
      (!flags.empty() && flags.size() != types.size()))
    throw std::invalid_argument("Invalid pipeline");
  std::vector<audio::PluginSettings> plugins;
  std::map<std::uint32_t, audio::PluginSettings> nextSettings;
  std::vector<std::uint32_t> nextInstruments;
  for (std::size_t i = 0; i < types.size(); ++i) {
    audio::PluginSettings plugin;
    plugin.id = ids[i];
    plugin.type = types[i];
    plugin.layoutHash = hashes[i];
    plugin.params = parameters[i];
    if (!structured.empty())
      plugin.bytes = structured[i];
    // Desktop configure fields: bit 0 skip (unsupported here), bit 1 display-only.
    if (!flags.empty()) {
      plugin.skip = (flags[i] & 1) != 0;
      plugin.displayOnly = (flags[i] & 2) != 0;
    }
    if (plugin.id == 0 || !nextSettings.emplace(plugin.id, plugin).second)
      throw std::invalid_argument("Invalid effect ID");
    if (plugin.type == "SFZNotePlayerPlugin" || plugin.type == "SoundFontPlayerPlugin")
      nextInstruments.push_back(plugin.id);
    plugins.push_back(std::move(plugin));
  }
  if (branch == 0)
    run([&]() noexcept {
      for (auto &scheduled : scheduled_)
        scheduled.active = false;
      return ET_OK;
    });
  auto *pipeline = path->pipeline();
  const auto publishSettings = [&]() noexcept {
    if (branch == 0)
      instruments_.swap(nextInstruments);
    silenceFrames_ = 0;
    monitoring_ = false;
  };
  bool configured = false;
  if (outputStatus() == 1) {
    auto change = pipeline->prepareChange(plugins, descriptor);
    if (change && run([&]() noexcept { return change->capture() ? ET_OK : ET_ERR_STATE; }) == ET_OK &&
        change->prepare()) {
      configured = run([&]() noexcept {
        if (!change->publish())
          return ET_ERR_STATE;
        publishSettings();
        return ET_OK;
      }) == ET_OK;
    }
  }
  if (!configured) {
    // A full rebuild owns the graph while the callback keeps the stream running
    // on discarded silence, as the desktop sidecar does.
    acquire();
    configured = pipeline->configure(std::move(plugins), std::move(descriptor));
    if (!configured) {
      if (branch == 1) {
        discardParallel();
        release();
        throw std::invalid_argument("Invalid parallel pipeline routing");
      }
      // A failed rebuild may already have dropped instances: stop instead of
      // resuming on that graph.
      stop();
      lastOutputError_ = kPipelineFailed;
      throw std::invalid_argument("Invalid pipeline routing");
    }
    run([&]() noexcept {
      publishSettings();
      return ET_OK;
    });
    release();
  }
  (branch == 0 ? settings_ : parallelMidi_->settings).swap(nextSettings);
  if (branch == 1) parallelMidi_->refreshTargets = true;
  return {ids.begin(), ids.end()};
}

int NativeEngine::setParameters(int instance, std::vector<float> values,
                                std::uint32_t hash, int branch) {
  if (!session_.branch(branch)) return ET_ERR_ARGS;
  auto &entries = branch == 0 ? settings_ : parallelMidi_->settings;
  const auto found = entries.find(instance);
  if (found == entries.end() || found->second.layoutHash != hash ||
      found->second.params.size() != values.size())
    return ET_ERR_ARGS;
  if (values.empty())
    return ET_OK;
  auto settings = found->second;
  settings.params = values;
  const auto status = run([&]() noexcept { return applyParameters(settings, branch); });
  if (status == ET_OK)
    found->second.params = std::move(values);
  return status;
}

int NativeEngine::setParameterBytes(int instance,
                                    std::vector<std::uint8_t> values,
                                    std::uint32_t hash, int branch) {
  if (!session_.branch(branch)) return ET_ERR_ARGS;
  auto &entries = branch == 0 ? settings_ : parallelMidi_->settings;
  const auto found = entries.find(instance);
  if (found == entries.end() || found->second.layoutHash != hash)
    return ET_ERR_ARGS;
  auto settings = found->second;
  settings.bytes = values;
  const auto status = run([&]() noexcept { return applyParameters(settings, branch); });
  if (status == ET_OK)
    found->second.bytes = std::move(values);
  return status;
}

int NativeEngine::applyParameters(audio::PluginSettings &settings, int branch) noexcept {
  silenceFrames_ = 0;
  monitoring_ = false;
  return session_.branch(branch)->updateParameter(settings) ? ET_OK : ET_ERR_ARGS;
}

void NativeEngine::setBypass(bool bypass) {
  if (session_.masterBypass() == bypass)
    return;
  acquire();
  session_.setMasterBypass(bypass);
  release();
}

audio::Session &NativeEngine::assetSession(int branch) {
  auto *path = session_.branch(branch);
  if (!path || !path->pipeline())
    throw std::invalid_argument("Invalid asset branch");
  return *path;
}

int NativeEngine::assetState(int instance, int slot, int branch) {
  auto *pipeline = assetSession(branch).pipeline();
  return run([&]() noexcept { return static_cast<int>(pipeline->assetState(instance, slot)); });
}

int NativeEngine::setAsset(int instance, int slot, const AssetBeginInfo &info,
                           const std::vector<std::uint8_t> &bytes, std::uint32_t format,
                           std::optional<std::uint32_t> revision, int branch) {
  return prepareAsset(instance, slot, info, bytes.data(),
                      static_cast<std::uint32_t>(bytes.size()), format, revision, branch);
}

int NativeEngine::setAssetFile(int instance, int slot, const AssetBeginInfo &info, int fd,
                               std::uint32_t byteSize, std::uint32_t format,
                               std::optional<std::uint32_t> revision, int branch) {
  struct stat file{};
  if (fd < 0 || byteSize == 0 || byteSize > 1024u * 1024u * 1024u ||
      fstat(fd, &file) != 0 || file.st_size < byteSize || !S_ISREG(file.st_mode))
    return ET_ERR_ARGS;
  void *mapped = mmap(nullptr, byteSize, PROT_READ, MAP_PRIVATE, fd, 0);
  if (mapped == MAP_FAILED)
    return ET_ERR_OOM;
  const auto unmap = [byteSize](void *address) { munmap(address, byteSize); };
  const std::unique_ptr<void, decltype(unmap)> mapping(mapped, unmap);
  return prepareAsset(instance, slot, info, static_cast<const std::uint8_t *>(mapping.get()),
                      byteSize, format, revision, branch);
}

int NativeEngine::prepareAsset(int instance, int slot, const AssetBeginInfo &info,
                               const std::uint8_t *data, std::uint32_t byteSize,
                               std::uint32_t format, std::optional<std::uint32_t> revision, int branch) {
  if (slot < 0 || (byteSize && (!data || byteSize != info.byteSize)))
    return ET_ERR_ARGS;
  auto *pipeline = assetSession(branch).pipeline();
  if (slot == 0)
    pipeline->cancelStream(instance);
  std::optional<audio::AssetData> asset;
  if (byteSize) {
    auto &candidate = asset.emplace();
    candidate.headBlock = info.headBlock;
    candidate.rateDivider = info.rateDivider;
    candidate.pathCount = info.pathCount;
    candidate.inputCount = info.inputCount;
    candidate.processingChannels = info.processingChannels;
    if (channels_ > 2 || info.processingChannels > 2) {
      // A retained instrument bank may have been prepared for the previous output.
      const auto &entries = branch == 0 ? settings_ : parallelMidi_->settings;
      const auto instrument = entries.find(instance);
      if (instrument != entries.end() && (instrument->second.type == "SoundFontPlayerPlugin" ||
                                          instrument->second.type == "SFZNotePlayerPlugin")) {
        const int width = run([&]() noexcept {
          return static_cast<int>(pipeline->processingChannels(instance, channels_));
        });
        if (width < 0) return width;
        if (width > 0) candidate.processingChannels = static_cast<unsigned>(width);
      }
    }
    candidate.footprintBytes = info.footprintBytes;
    candidate.formatTag = format;
    candidate.operationRevision = revision;
    candidate.payload.assign(data, data + byteSize);
  }
  return submitAssetChange(pipeline->assetChange(instance, slot, std::move(asset)), branch);
}

int NativeEngine::submitAssetChange(const std::shared_ptr<audio::Pipeline::AssetChange> &change, int branch) {
  if (branch == 1) parallelMidi_->refreshTargets = true;
  for (;;) {
    int result = ET_ERR_ARGS;
    if (run([&]() noexcept { return change->capture() ? ET_OK : ET_ERR_STATE; }) == ET_OK &&
        change->prepare()) {
      if (change->awaitsPages()) {
        change->retain(change);
        return 1;
      }
      result = activateBank(change);
      if (result >= 0)
        return result;
      if (change->stale())
        continue;
    }
    assetSession(branch).pipeline()->releaseBank(change.get());
    return result;
  }
}

int NativeEngine::activateBank(const std::shared_ptr<audio::Pipeline::AssetChange> &change) {
  if (run([&]() noexcept { return change->captureRoute() ? ET_OK : ET_ERR_STATE; }) != ET_OK ||
      !change->prepareRoute())
    return ET_ERR_STATE;
  const int result = run([&]() noexcept {
    silenceFrames_ = 0;
    monitoring_ = false;
    return change->apply() ? ET_OK : ET_ERR_ARGS;
  });
  if (result != ET_OK)
    return result;
  if (change->deferred())
    return 1;
  change->finish();
  return ET_OK;
}

// Mirrors the desktop setVisualizerSources contract: detach the current
// visualizer on the audio thread, reconfigure it here, then attach it again.
int NativeEngine::setVisualizerSources(std::vector<audio::VisualizerSource> sources) {
  std::unique_ptr<audio::Visualizer> visualizer;
  run([&]() noexcept {
    session_.exchangeVisualizer(visualizer);
    return ET_OK;
  });
  if (sources.empty())
    return ET_OK;
  try {
    if (!visualizer)
      visualizer = std::make_unique<audio::Visualizer>(session_.format().sampleRate,
                                                       session_.maxBlock());
    if (!visualizer->configure(sources))
      return ET_ERR_ARGS;
  } catch (...) {
    return ET_ERR_OOM;
  }
  return run([&]() noexcept {
    session_.exchangeVisualizer(visualizer);
    return ET_OK;
  });
}

std::vector<int> NativeEngine::runtimeEvents() {
  std::vector<int> result;
  result.reserve(settings_.size() * 4);
  run([&]() noexcept {
    for (const auto id : session_.pipeline()->instrumentIds()) {
      RuntimeEventState state{};
      if (session_.pipeline()->readRuntimeEvent(id, state)) {
        for (const auto field : {id, state.generation, state.latched, state.cause})
          result.push_back(static_cast<int>(field));
      }
    }
    return ET_OK;
  });
  return result;
}

std::vector<double> NativeEngine::pipelineStats(int branch) {
  auto *path = session_.branch(branch);
  if (!path)
    throw std::invalid_argument("Missing pipeline branch");
  unsigned latency = 0, delay = 0;
  // The pipeline latency belongs to the audio owner, as on the desktop host.
  run([&]() noexcept {
    latency = path->latency();
    delay = path->output().appliedDelay();
    return ET_OK;
  });
  return {path->takeCpuUsage(), static_cast<double>(latency), static_cast<double>(delay)};
}

int NativeEngine::setDisplayBypass(bool bypass) {
  run([&]() noexcept {
    session_.power().setDisplayBypass(bypass);
    return ET_OK;
  });
  // The desktop refreshDisplay sequence: capture and publish on the audio
  // owner, prepare the passthrough targets on control. Unchanged state has no
  // change to apply.
  auto change = session_.pipeline()->prepareDisplay(bypass);
  if (!change)
    return ET_OK;
  if (run([&]() noexcept { return change->capture() ? ET_OK : ET_ERR_STATE; }) != ET_OK ||
      !change->prepare())
    return ET_ERR_STATE;
  return run([&]() noexcept { return change->publish() ? ET_OK : ET_ERR_STATE; });
}

void NativeEngine::setFrequencyPreview(double frequency, bool noise) {
  run([&]() noexcept {
    session_.preview(frequency, noise);
    // A tone wakes monitoring the way audible input does; its output keeps it awake.
    if (frequency > 0) {
      if (monitoring_)
        resetTemporal();
      monitoring_ = false;
      silenceFrames_ = 0;
    }
    return ET_OK;
  });
}

int NativeEngine::resetPlugin(int instance) {
  if (settings_.find(instance) == settings_.end())
    return ET_ERR_ARGS;
  const auto id = static_cast<std::uint32_t>(instance);
  return run([&]() noexcept {
    session_.pipeline()->resetTemporal(std::span(&id, 1));
    return ET_OK;
  });
}

std::int64_t NativeEngine::soundFontMixerAction(int instance, int channel, int mix,
                                                const std::vector<std::uint32_t> &messages) {
  std::array<et_midi_event, 3> events{};
  if (channel < 0 || channel > 15 || mix > 3 || messages.size() > events.size() ||
      (mix < 0) == messages.empty())
    return ET_ERR_ARGS;
  for (std::size_t i = 0; i < messages.size(); ++i)
    events[i].message = messages[i];
  std::uint64_t frame = 0;
  const int status = run([&]() noexcept -> int {
    const auto target = session_.pipeline()->instrument(static_cast<unsigned>(instance));
    if (!target || target->settings.type != "SoundFontPlayerPlugin")
      return ET_ERR_ARGS;
    auto &engine = target->engine;
    const auto k = target->target.instance;
    const auto result =
        mix >= 0 ? engine.setInstanceMidiChannelMix(k, static_cast<std::uint32_t>(channel),
                                                    static_cast<std::uint32_t>(mix))
                 : engine.setInstanceMidiEvents(k, events.data(),
                                                static_cast<std::uint32_t>(messages.size()),
                                                engine.instanceMidiGeneration(k),
                                                ET_MIDI_CONTROL_ONLY);
    if (result != ET_OK)
      return static_cast<int>(result);
    // The edit must be heard: wake monitoring as an audible change does.
    if (monitoring_)
      resetTemporal();
    monitoring_ = false;
    silenceFrames_ = 0;
    frame = session_.position();
    return ET_OK;
  });
  return status == ET_OK ? static_cast<std::int64_t>(frame) : status;
}

std::vector<double> NativeEngine::sfzPreparationContext(int instance, int branch) {
  auto &path = assetSession(branch);
  auto *pipeline = path.pipeline();
  unsigned channels = 0;
  double minimumBpm = 0;
  run([&]() noexcept {
    channels = pipeline->processingChannels(instance, path.format().width());
    minimumBpm = pipeline->midi.minimumBpm();
    return ET_OK;
  });
  if (!channels)
    return {};
  return {double(sampleRate_), double(channels), double(std::max(32, maxFrames_)), minimumBpm};
}

// fd >= 0 installs the packed score, -1 reuses the installed timeline, -2 releases it.
static audio::MidiScheduler::Transport readScore(int fd) {
  audio::MidiScheduler::Transport next;
  next.hasTimeline = fd != -1;
  if (fd >= 0) {
    struct stat st{};
    if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_size < 16 || st.st_size > 64 * 1024 * 1024)
      throw std::invalid_argument("Invalid score file");
    std::uint32_t counts[2]{};
    if (pread(fd, counts, sizeof(counts), 0) != static_cast<ssize_t>(sizeof(counts)))
      throw std::invalid_argument("Incomplete score");
    const auto size = 16 + 20ull * counts[0] + 40ull * counts[1];
    if (size > 16000000 || size > static_cast<std::uint64_t>(st.st_size))
      throw std::invalid_argument("Invalid score table sizes");
    std::vector<std::uint8_t> bytes(size);
    if (pread(fd, bytes.data(), bytes.size(), 0) != static_cast<ssize_t>(bytes.size()))
      throw std::invalid_argument("Incomplete score file");
    std::size_t offset = 0;
    const auto read = [&]<typename T>(T &value) {
      std::memcpy(&value, bytes.data() + offset, sizeof(T));
      offset += sizeof(T);
    };
    std::uint32_t events, points;
    read(events); read(points); read(next.duration);
    if (16 + 20ull * events + 40ull * points != bytes.size() ||
        !std::isfinite(next.duration) || next.duration < 0)
      throw std::invalid_argument("Invalid score layout");
    next.events.resize(events);
    double last = 0;
    for (auto &e : next.events) {
      read(e.seconds); read(e.data.message); read(e.data.note_id); read(e.data.flags);
      if (!std::isfinite(e.seconds) || e.seconds < last || (e.data.message & 0xff808000u) ||
          (e.data.flags & ~(ET_MIDI_SYSTEM_RESET | ET_MIDI_DRUM_MODE)))
        throw std::invalid_argument("Invalid score event");
      last = e.seconds;
    }
    next.points.reserve(points);
    last = 0;
    for (unsigned i = 0; i < points; ++i) {
      double time, ppq, bar, bpm;
      unsigned numerator, denominator;
      read(time); read(ppq); read(bar); read(bpm); read(numerator); read(denominator);
      if (!std::isfinite(time) || time < last || !std::isfinite(ppq) || !std::isfinite(bar) ||
          !std::isfinite(bpm) || bpm <= 0 || !numerator || !denominator)
        throw std::invalid_argument("Invalid score tempo");
      next.points.push_back({time, ppq, bar, bpm, numerator, denominator});
      last = time;
    }
  }
  return next;
}

static bool installScore(audio::Pipeline *pipeline, audio::MidiScheduler::Transport &next,
                         std::span<const unsigned> ids) {
  next.generation = pipeline->midi.generation() + 1;
  // Paused kernels are still resident. Preserve their cursors and voice clocks for resume.
  struct Cursor { audio::MidiScheduler::Instrument target; std::size_t index; std::uint64_t clock; };
  std::array<Cursor, 128> paused{};
  unsigned count = 0;
  if (!next.hasTimeline && next.preparing && pipeline->midi.paused())
    for (auto id : ids) {
      const auto t = pipeline->instrument(id);
      if (t && t->target.enabled && t->settings.type == "SoundFontPlayerPlugin" &&
          t->engine.instanceMidiGeneration(t->target.instance) == pipeline->midi.generation()) {
        paused[count++] = {t->target, pipeline->midi.cursor(t->target.instance),
                            t->engine.instanceMidiClock(t->target.instance)};
      }
    }
  bool ok = pipeline->midi.configure(next);
  for (unsigned i = 0; ok && i < count; ++i)
    ok = pipeline->midi.restoreCursor(paused[i].target, paused[i].index, paused[i].clock);
  return ok && pipeline->prepareMidi();
}

double NativeEngine::scoreTransport(int fd, double position, double speed, bool play) {
  auto next = readScore(fd);
  next.position = position;
  next.speed = speed;
  next.gain = playerGain_.load();
  next.preparing = play;
  const double duration = next.hasTimeline ? next.duration : scoreDuration_;
  auto *secondary = session_.branch(1);
  std::optional<audio::MidiScheduler::Transport> other;
  if (secondary) other.emplace(next);
  // Each scheduler swaps its own timeline. Map installation may resize kernel storage.
  acquire();
  bool ok;
  try {
    next.anchor = session_.position();
    ok = installScore(session_.pipeline(), next, instruments_);
    if (secondary) {
      other->anchor = next.anchor;
      auto *p = secondary->pipeline();
      ok = installScore(p, *other, p->instrumentIds()) && ok;
    }
  } catch (...) {
    release();
    throw;
  }
  run([&]() noexcept {
    scoreRunning_ = ok && play;
    scoreWaiting_ = scoreRunning_ ? (secondary ? 3 : 1) : 0;
    liveMidi_ = false;
    if (play) { silenceFrames_ = 0; monitoring_ = false; }
    return ET_OK;
  });
  scoreDuration_ = duration;
  release();
  if (!ok) throw std::runtime_error("Score transport rejected");
  liveDeliveries_.clear();
  if (secondary) parallelMidi_->deliveries.clear();
  return duration;
}

double NativeEngine::scorePosition() {
  double seconds = 0;
  run([&]() noexcept {
    seconds = scoreWaiting_ ? -1 : session_.pipeline()->midi.position(session_.position(), sampleRate_);
    return ET_OK;
  });
  return seconds;
}

double NativeEngine::pauseScore() {
  double seconds = 0;
  run([&]() noexcept {
    auto &midi = session_.pipeline()->midi;
    const auto frame = session_.position();
    seconds = midi.position(frame, sampleRate_);
    midi.pause(midi.generation() + 1, frame, sampleRate_);
    if (parallelMidi_) {
      auto &other = *parallelMidi_->scheduler;
      other.pause(other.generation() + 1, frame, sampleRate_);
    }
    scoreRunning_ = false;
    scoreWaiting_ = 0;
    return ET_OK;
  });
  return seconds;
}

void NativeEngine::scoreSpeed(double speed) {
  run([&]() noexcept {
    const auto frame = session_.position();
    session_.pipeline()->midi.speed(speed, frame, sampleRate_);
    if (parallelMidi_) parallelMidi_->scheduler->speed(speed, frame, sampleRate_);
    return ET_OK;
  });
}

bool NativeEngine::takeScoreEnded() {
  return session_.pipeline()->midi.takeEnded() != 0;
}

int NativeEngine::liveMidiSource(bool enabled) {
  if (scoreRunning_) return ET_ERR_STATE;
  const auto configure = [&](audio::Pipeline *p, std::span<const unsigned> ids, std::uint64_t frame) noexcept {
    const unsigned generation = p->midi.generation() + 1;
    p->midi.configureInput(generation, enabled, frame);
    for (auto id : ids)
      if (auto target = p->instrument(id); target && target->settings.type == "SoundFontPlayerPlugin")
        target->engine.setInstanceMidiEvents(target->target.instance, nullptr, 0, generation, ET_MIDI_RESET);
  };
  int result = ET_OK;
  if (parallelMidi_) {
    auto *p = session_.branch(1)->pipeline();
    acquire();
    const auto frame = session_.position();
    configure(session_.pipeline(), instruments_, frame);
    configure(p, p->instrumentIds(), frame);
    release();
    parallelMidi_->deliveries.clear();
    parallelMidi_->hydrated = {};
    parallelMidi_->refreshTargets = true;
  } else {
    result = run([&]() noexcept {
      configure(session_.pipeline(), instruments_, session_.position());
      return ET_OK;
    });
  }
  if (result == ET_OK) {
    hydratedMidi_ = {};
    liveMidi_ = enabled;
    liveDeliveries_.clear();
    liveChannelState_.clear();
  }
  return result;
}

bool NativeEngine::refreshParallelMidiTargets() {
  auto &state = *parallelMidi_;
  auto *p = session_.branch(1)->pipeline();
  state.targets.clear();
  state.targets.reserve(state.settings.size());
  // Prepare sorted targets and restore channel history outside the audio callback.
  acquire();
  bool ready = true;
  std::size_t i = 0;
  for (const auto &[id, settings] : state.settings) {
    if (settings.type != "SoundFontPlayerPlugin") continue;
    auto &identity = state.hydrated[i++];
    const auto t = p->instrument(id);
    if (!t || !t->target.enabled) {
      identity = {};
      continue;
    }
    const auto current = std::pair{t->target.instance, t->target.token};
    if (current != identity && !p->hydrateMidi(id, t->target.token, p->midi.generation(), liveChannelState_)) {
      ready = false;
      continue;
    }
    identity = current;
    state.targets.push_back({id, t->target.token});
  }
  release();
  state.refreshTargets = !ready;
  return ready;
}

int NativeEngine::liveMidiEvent(unsigned message, unsigned note, unsigned flags,
                                std::optional<std::vector<et_midi_event>> history, double delay) {
  auto *p = session_.pipeline();
  if (history) liveChannelState_.swap(*history);
  const auto reserve = [](auto &queue, const auto &scheduler) -> LiveDelivery * {
    const auto delivered = scheduler.deliveredBatch();
    std::erase_if(queue, [delivered](const auto &item) { return item->batch <= delivered; });
    if (queue.size() >= 4096) return nullptr;
    return queue.emplace_back(std::make_unique<LiveDelivery>()).get();
  };
  LiveDelivery *other = nullptr;
  bool otherFailed = false;
  if (parallelMidi_) {
    if (parallelMidi_->refreshTargets) otherFailed = !refreshParallelMidiTargets();
    if (!parallelMidi_->targets.empty()) {
      other = reserve(parallelMidi_->deliveries, *parallelMidi_->scheduler);
      if (other)
        std::copy(parallelMidi_->targets.begin(), parallelMidi_->targets.end(), other->targets.begin());
      else
        otherFailed = true;
    }
  }
  auto *delivery = reserve(liveDeliveries_, p->midi);
  if (!delivery) {
    if (other) parallelMidi_->deliveries.pop_back();
    return ET_ERR_STATE;
  }
  int result = run([&]() noexcept {
    if (!liveMidi_) return ET_ERR_STATE;
    unsigned count = 0;
    for (unsigned i = 0; i < instruments_.size(); ++i) {
      const auto target = p->instrument(instruments_[i]);
      if (!target || !target->target.enabled || target->settings.type != "SoundFontPlayerPlugin") {
        hydratedMidi_[i] = {};
        continue;
      }
      const auto &t = target->target;
      const auto identity = std::pair{t.instance, t.token};
      if (hydratedMidi_[i] != identity) {
        if (!p->hydrateMidi(t.id, t.token, p->midi.generation(), liveChannelState_)) continue;
        hydratedMidi_[i] = identity;
      }
      delivery->targets[count++] = {t.id, t.token};
    }
    if (!count && !other) return otherFailed ? ET_ERR_STATE : ET_OK;
    auto targets = std::span(delivery->targets).first(count);
    std::sort(targets.begin(), targets.end(), [](const auto &a, const auto &b) { return a.id < b.id; });
    audio::MidiScheduler::LiveEvent event{{0, message, note, flags, 0, 0},
        session_.position() + static_cast<unsigned>(sampleRate_ * delay), targets};
    if (count) {
      if (!p->midi.enqueue(p->midi.generation(), std::span(&event, 1))) return ET_ERR_STATE;
      delivery->batch = p->midi.lastBatch();
    }
    if (other) {
      auto &scheduler = *parallelMidi_->scheduler;
      event.targets = std::span(other->targets).first(parallelMidi_->targets.size());
      if (!scheduler.enqueue(scheduler.generation(), std::span(&event, 1))) return ET_ERR_STATE;
      other->batch = scheduler.lastBatch();
    }
    silenceFrames_ = 0;
    monitoring_ = false;
    return otherFailed ? ET_ERR_STATE : ET_OK;
  });
  if (!delivery->batch) liveDeliveries_.pop_back();
  if (other && !other->batch) parallelMidi_->deliveries.pop_back();
  return result;
}

int NativeEngine::setMidiMetering(int instance, bool enabled, int branch) {
  auto *pipeline = assetSession(branch).pipeline();
  return run([&]() noexcept -> int {
    auto target = pipeline->instrument(instance);
    if (!target || target->settings.type != "SoundFontPlayerPlugin")
      return ET_ERR_ARGS;
    return target->engine.setInstanceMidiMetering(target->target.instance, enabled);
  });
}

static std::uint64_t samplerTimeNs() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
}

// Stream bookkeeping and detached banks belong to the serialized control caller.
std::vector<std::int64_t> NativeEngine::sampleStreams(int branch) {
  auto *pipeline = assetSession(branch).pipeline();
  const auto now = samplerTimeNs();
  std::vector<std::int64_t> records;
  for (const auto &[id, state] : pipeline->streams()) {
    auto &stream = *pipeline->sampleStream(id);
    const bool poll = !state.pollPending && now >= state.nextPollNs;
    records.insert(records.end(), {id, static_cast<std::int64_t>(state.generation),
                                   state.operationRevision.value_or(0), poll | (pipeline->pendingStream(id) ? 2 : 0)});
    if (poll)
      stream.pollPending = true;
  }
  return records;
}

std::vector<std::int64_t> NativeEngine::pollSamplePages(int instance, std::uint64_t generation,
                                                        std::uint32_t token, int branch) {
  auto &path = assetSession(branch);
  auto *pipeline = path.pipeline();
  auto *stream = pipeline->sampleStream(instance);
  if (!stream || stream->generation != generation || stream->operationRevision != token)
    return {};
  stream->pollPending = false;
  stream->nextPollNs = samplerTimeNs() + 10000000;
  if (pipeline->pendingStream(instance))
    return {0};
  std::array<et_sfz_sample_request, 1024> requests;
  std::uint32_t count = 0;
  et_stream_readiness ready{};
  bool limited = false;
  if (run([&]() noexcept {
        return pipeline->takeRequests(instance, requests, count, ready, path.position(), limited)
                   ? ET_OK : ET_ERR_STATE;
      }) != ET_OK)
    return {};
  std::vector<std::int64_t> result{1, limited, static_cast<std::int64_t>(ready.generation),
                                   ready.scope, ready.admitted_frames, ready.ready_ahead_frames,
                                   ready.planned_pages, ready.pending_pages};
  for (unsigned i = 0; i < count; ++i) {
    const auto &q = requests[i];
    result.insert(result.end(), {std::int64_t(q.generation_high) * 0x100000000LL + q.generation_low,
                                 q.sample, std::int64_t(q.page_high) * 0x100000000LL + q.page_low});
  }
  return result;
}

int NativeEngine::publishSamplePage(int instance, std::uint64_t generation, std::uint32_t token,
                                    unsigned sample, std::uint64_t page, const std::vector<float> &pcm,
                                    int frames, int channels, bool resident, int branch) {
  auto *pipeline = assetSession(branch).pipeline();
  const auto *stream = pipeline->sampleStream(instance);
  if (!stream || stream->generation != generation || stream->operationRevision != token ||
      frames < 1 || frames > 4096 || (channels != 1 && channels != 2) ||
      pcm.size() != static_cast<std::size_t>(frames * channels))
    return ET_ERR_ARGS;
  if (auto bank = pipeline->pendingStream(instance)) {
    if (!bank->publish(generation, sample, page, pcm, frames, channels, resident))
      return ET_ERR_STATE;
    if (!bank->awaitsPages()) {
      const int status = activateBank(bank);
      if (status < 0)
        return status;
      if (status == ET_OK) {
        if (branch == 1) parallelMidi_->refreshTargets = true;
        return static_cast<int>(bank->state());
      }
    }
    return ET_OK;
  }
  return run([&]() noexcept {
    return pipeline->publishPage(instance, generation, sample, page, pcm, frames, channels, resident)
               ? ET_OK : ET_ERR_STATE;
  });
}

int NativeEngine::failSampleStream(int instance, std::uint64_t generation, std::uint32_t token, int branch) {
  auto *pipeline = assetSession(branch).pipeline();
  const auto *stream = pipeline->sampleStream(instance);
  if (!stream || stream->generation != generation || stream->operationRevision != token)
    return ET_ERR_ARGS;
  if (!pipeline->pendingStream(instance))
    return submitAssetChange(pipeline->assetChange(instance, 0, std::nullopt), branch);
  pipeline->cancelStream(instance);
  return ET_OK;
}

std::vector<int> NativeEngine::assetNotices(int branch) {
  auto &path = assetSession(branch);
  auto *pipeline = path.pipeline();
  if (path.needsLatencyReservation()) {
    acquire();
    if (path.reserveLatency()) {
      release();
    } else {
      // Without its latency the graph cannot render: stop instead of resuming.
      stop();
      lastOutputError_ = kPipelineFailed;
    }
  }
  std::vector<int> result;
  audio::Pipeline::AssetNotice notice;
  while (pipeline->takeNotice(notice)) {
    if (branch == 1) parallelMidi_->refreshTargets = true;
    if (notice.completed) {
      if (auto bank = pipeline->releaseBank(notice.completed)) {
        if (bank->stale()) {
          const auto result = submitAssetChange(bank, branch);
          if (result == 1)
            continue;
          notice.rejected = result != ET_OK;
          notice.state = bank->state();
        } else if (!notice.rejected) {
          bank->finish();
        }
      }
    }
    if (!notice.identity && notice.revision) {
      for (const auto field : {notice.id, notice.slot, notice.state,
                               static_cast<unsigned>(notice.rejected), *notice.revision,
                               static_cast<unsigned>(notice.completed != nullptr)})
        result.push_back(static_cast<int>(field));
    }
  }
  return result;
}

void NativeEngine::beginMeasurementFiles(int excitationFd, int resultFd,
                                         std::uint32_t excitationFrames,
                                         std::uint32_t frames, float overloadPeak,
                                         std::uint32_t overloadTailFrames,
                                         int inputChannel) {
  if (frames == 0 || frames > 16ULL * 1048576 + 41ULL * sampleRate_ ||
      excitationFrames > frames)
    throw std::invalid_argument("Invalid finite measurement size");
  Command command(Command::Kind::MeasurementStart);
  command.capture = std::make_unique<FiniteCapture>(
      excitationFd, resultFd, excitationFrames, frames, overloadPeak,
      overloadTailFrames, inputChannel, streamChannels_);
  startMeasurementSignal(command);
}

void NativeEngine::cancelMeasurement() {
  Command command(Command::Kind::MeasurementCancel);
  submit(command);
}

std::vector<int> NativeEngine::measurementState() {
  Command command(Command::Kind::MeasurementState);
  submit(command);
  return {command.result, static_cast<int>(command.frame), sampleRate_, 2};
}

void NativeEngine::setPowerSettings(float threshold, float monitoringSeconds,
                                    bool mustProcess) {
  if (!std::isfinite(threshold) || threshold <= 0 || threshold > 1 ||
      !std::isfinite(monitoringSeconds) || monitoringSeconds < 3)
    throw std::invalid_argument("Invalid power settings");
  Command command(Command::Kind::PowerSettings);
  command.floats = {threshold, monitoringSeconds, mustProcess ? 1.0F : 0.0F};
  submit(command);
}

std::vector<float> NativeEngine::powerObservation() {
  Command command(Command::Kind::PowerObservation);
  command.floats.resize(5);
  submit(command);
  return std::move(command.floats);
}

float NativeEngine::meterLevel() {
  float level = 0;
  run([&]() noexcept {
    level = meterPeak_;
    meterPeak_ = 0;
    return ET_OK;
  });
  return level;
}

int NativeEngine::scheduleParameters(int instance, std::vector<float> values,
                                     std::uint32_t hash, std::uint64_t frame) {
  const auto found = settings_.find(instance);
  if (found == settings_.end() || found->second.layoutHash != hash ||
      found->second.params.size() != values.size() || values.size() > 1024)
    return ET_ERR_ARGS;
  // A byte-only effect has no float automation to schedule.
  if (values.empty())
    return ET_OK;
  auto settings = found->second;
  settings.params = std::move(values);
  return run([&]() noexcept {
    for (auto &scheduled : scheduled_) {
      if (!scheduled.active) {
        std::swap(scheduled.settings, settings);
        scheduled.frame = frame;
        scheduled.active = true;
        return ET_OK;
      }
    }
    return ET_ERR_STATE;
  });
}

void NativeEngine::resetTemporal() noexcept {
  auto *pipeline = session_.pipeline();
  std::array<std::uint32_t, Engine::kMaxInstances> reset{};
  std::size_t count = 0;
  for (const auto id : pipeline->instrumentIds()) {
    const bool protectedInstrument =
        std::find(instruments_.begin(), instruments_.end(), id) != instruments_.end() &&
        (pipeline->assetState(id, 0) & 255u) == ET_ASSET_STATE_ACTIVE;
    if (!protectedInstrument)
      reset[count++] = id;
  }
  pipeline->resetTemporal(std::span(reset).first(count));
}

std::uint64_t NativeEngine::audioFrameTime() {
  Command command(Command::Kind::AudioFrameTime);
  submit(command);
  return command.frame;
}

int NativeEngine::setSpectrumTap(unsigned id, bool enabled, bool compare, bool hq) {
  if (!session_.isOpen())
    return ET_ERR_STATE;
  audio::SpectrumTaps::Update update;
  try {
    update = session_.spectrum().prepare(id, enabled, compare, hq);
  } catch (...) {
    return ET_ERR_OOM;
  }
  return run([&]() noexcept {
    session_.spectrum().apply(update);
    return ET_OK;
  });
}

int NativeEngine::setSpectrumTapRoute(unsigned id, bool enabled) {
  if (!session_.isOpen())
    return ET_ERR_STATE;
  return run([&]() noexcept {
    session_.spectrum().route(id, enabled);
    return ET_OK;
  });
}

namespace {
template <typename T> void appendLittleEndian(std::vector<std::uint8_t> &out, T value) {
  std::uint8_t bytes[sizeof(T)];
  std::memcpy(bytes, &value, sizeof(T));
  out.insert(out.end(), bytes, bytes + sizeof(T));
}

// One overlay frame: 23 little-endian doubles (the frame fields, then the input
// and output analyses, in the order below), a u32 sample count, and the samples.
void packSpectrumFrame(std::vector<std::uint8_t> &out, const audio::SpectrumFrame &f) {
  const auto analysis = [](const audio::SpectrumFrame::Analysis &a) {
    return std::array<double, 6>{double(a.generation), double(a.index), double(a.hop),
                                 double(a.first), double(a.valid), double(a.captured)};
  };
  const auto input = analysis(f.input), output = analysis(f.output);
  const std::array<double, 11> header{double(f.id),       double(f.generation), double(f.index),
                                      double(f.position), double(f.delay),      double(f.rate),
                                      double(f.captured), double(f.end),        double(f.revision),
                                      f.compare ? 1. : 0., f.hq ? 1. : 0.};
  for (const auto value : header)
    appendLittleEndian(out, value);
  for (const auto value : input)
    appendLittleEndian(out, value);
  for (const auto value : output)
    appendLittleEndian(out, value);
  appendLittleEndian(out, static_cast<std::uint32_t>(f.samples.size()));
  const auto *bytes = reinterpret_cast<const std::uint8_t *>(f.samples.data());
  out.insert(out.end(), bytes, bytes + f.samples.size() * sizeof(float));
}
} // namespace

std::vector<std::uint8_t> NativeEngine::drainSpectrum() {
  std::vector<std::uint8_t> out;
  if (session_.isOpen())
    session_.spectrum().drain([&](const audio::SpectrumFrame &f) { packSpectrumFrame(out, f); });
  return out;
}

std::vector<std::uint8_t> NativeEngine::telemetryPackets() {
  auto *telemetry = session_.telemetry();
  std::vector<std::uint8_t> out;
  for (unsigned count = 0; telemetry && count < 3; ++count) {
    const auto *packet = telemetry->front();
    if (!packet)
      break;
    appendLittleEndian(out, packet->endFrame);
    appendLittleEndian(out, packet->mixerEndFrame);
    appendLittleEndian(out, packet->revision);
    appendLittleEndian(out, packet->bytes);
    appendLittleEndian(out, packet->dropped);
    appendLittleEndian(out, static_cast<std::uint32_t>(packet->stage));
    appendLittleEndian(out, std::uint32_t{0});
    out.insert(out.end(), packet->data.begin(), packet->data.begin() + packet->bytes);
    telemetry->pop();
  }
  return out;
}

std::vector<double> NativeEngine::visualClock() {
  const auto sequence = clockSequence_.load();
  if (!sequence || (sequence & 1) || !running_ || !output_)
    return {};
  const double timeNs = static_cast<double>(clockTimeNs_.load());
  const double position = static_cast<double>(clockPosition_.load());
  if (clockSequence_.load() != sequence)
    return {};
  const auto latency = output_->calculateLatencyMillis();
  if (!latency || !(latency.value() >= 0))
    return {};
  return {position, timeNs, latency.value() * sampleRate_ / 1000.};
}

int NativeEngine::setVisualSync(bool enabled) {
  auto *io = session_.io();
  if (!io)
    return ET_ERR_STATE;
  return run([&]() noexcept {
    if (io->visualSync != enabled)
      ++io->routeRevision;
    io->visualSync = enabled;
    return ET_OK;
  });
}

int NativeEngine::setVisualSyncDelay(unsigned samples) {
  const unsigned maximum = session_.output().maxDelay();
  const unsigned target = samples < maximum ? samples : maximum;
  const int status = setOutputDelay(0, static_cast<int>(target));
  return status < 0 ? status : static_cast<int>(target);
}

int NativeEngine::submit(Command &command) {
  if (outputStatus() != 1) {
    apply(command);
    return command.result;
  }
  pending_.store(&command, std::memory_order_release);
  const auto deadline =
      std::chrono::steady_clock::now() + std::chrono::seconds(1);
  while (!command.done.load(std::memory_order_acquire)) {
    if (std::chrono::steady_clock::now() >= deadline) {
      // A disconnected output may no longer call back. Closing joins its
      // callbacks before control takes ownership and consumes the command.
      stop();
      lastOutputError_ = static_cast<int>(oboe::Result::ErrorTimeout);
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return command.result;
}

void NativeEngine::applyPending() noexcept {
  if (auto *command = pending_.exchange(nullptr, std::memory_order_acq_rel)) {
    apply(*command);
    command->done.store(true, std::memory_order_release);
  }
}

void NativeEngine::apply(Command &command) noexcept {
  switch (command.kind) {
  case Command::Kind::Run:
    command.result = command.work(command.context);
    break;
  case Command::Kind::Resume:
    resetTemporal();
    silenceFrames_ = 0;
    monitoring_ = false;
    break;
  case Command::Kind::Input:
    input_.swap(command.input);
    inputBurst_ = command.inputBurst;
    inputPrimed_ = input_ == nullptr;
    inputWait_ = 0;
    measurementNoise_.swap(command.floats);
    if (capture_)
      capture_->invalidate();
    break;
  case Command::Kind::MeasurementStart:
    if (!input_) {
      command.result = ET_ERR_STATE;
      break;
    }
    capture_.swap(command.capture);
    measurementNoise_.swap(command.floats);
    silenceFrames_ = 0;
    monitoring_ = false;
    break;
  case Command::Kind::MeasurementCancel:
    capture_.swap(command.capture);
    break;
  case Command::Kind::MeasurementState:
    command.result = capture_ ? capture_->status() : 0;
    command.frame = capture_ ? capture_->frames() : 0;
    break;
  case Command::Kind::MeasurementNoise:
    if (!command.floats.empty())
      capture_.swap(command.capture);
    measurementNoise_.swap(command.floats);
    noisePosition_ = 0;
    break;
  case Command::Kind::PowerSettings:
    silenceThreshold_ = command.floats[0];
    monitoringSeconds_ = command.floats[1];
    mustProcess_ = command.floats[2] != 0;
    silenceFrames_ = 0;
    monitoring_ = false;
    break;
  case Command::Kind::PowerObservation:
    command.floats[0] = static_cast<float>(clockFrames_ / maxFrames_);
    command.floats[1] = inputPeak_;
    command.floats[2] = outputPeak_;
    command.floats[3] = static_cast<float>(silenceFrames_) / sampleRate_;
    command.floats[4] = monitoring_ ? 1 : 0;
    break;
  case Command::Kind::AudioFrameTime:
    command.frame = clockFrames_;
    break;
  }
}

oboe::DataCallbackResult NativeEngine::onAudioReady(oboe::AudioStream *,
                                                    void *data,
                                                    std::int32_t frameCount) {
  auto *output = static_cast<float *>(data);
  std::int32_t offset = 0;
  bool renderFailed = false, starved = false, inputShort = false;
  clockSequence_.fetch_add(1);
  clockTimeNs_.store(static_cast<std::uint64_t>(
      std::chrono::duration_cast<std::chrono::nanoseconds>(
          std::chrono::steady_clock::now().time_since_epoch()).count()));
  clockPosition_.store(session_.position());
  clockSequence_.fetch_add(1);
  while (offset < frameCount) {
    applyPending();
    auto owner = owner_.load(std::memory_order_acquire);
    if (owner == Owner::Returned) {
      session_.output().settleTopology();
      owner_.compare_exchange_strong(owner, Owner::Audio,
                                     std::memory_order_acq_rel);
      owner = owner_.load(std::memory_order_acquire);
    }
    if (owner == Owner::Requested)
      session_.output().closeTopology();
    // While control owns the graph, this callback must leave it untouched.
    const bool held = owner == Owner::Control;
    auto frames = std::min(maxFrames_, frameCount - offset);
    for (auto &event : scheduled_) {
      if (held || !event.active)
        continue;
      if (event.frame <= clockFrames_) {
        applyParameters(event.settings);
        event.active = false;
      } else if (event.frame - clockFrames_ <
                 static_cast<std::uint64_t>(frames)) {
        frames = static_cast<std::int32_t>(event.frame - clockFrames_);
      }
    }
    auto *audio = measurementPlanar_.empty() ? planarIn_.data() : measurementPlanar_.data();
    const int samples = frames * streamChannels_;
    std::fill_n(audio, samples, 0.0F);
    int microphoneFrames = 0;
    bool inputReady = input_ != nullptr;
    if (input_ && (!inputPrimed_ || (capture_ && capture_->frames() == 0))) {
      // Prime the complete output callback plus two input bursts before the
      // first excitation frame and before the first frame of a new input.
      // Input and output callbacks arrive independently; starting on one small
      // DSP slice can exhaust input in the same callback.
      const auto needed = frameCount + static_cast<int>(inputBurst_) * 2;
      const auto available = input_->getAvailableFrames();
      inputReady = available && available.value() >= needed;
      if (capture_) {
        if (!available)
          capture_->invalidate();
      } else if (!available || (inputWait_ += frames) > needed * 2) {
        // A live input that cannot report or hold this margin starts without it.
        inputReady = true;
      }
      inputPrimed_ = inputPrimed_ || inputReady;
    }
    const int meter = meterChannel_.load(std::memory_order_relaxed);
    if (inputReady) {
      const auto read = input_->read(microphone_.data(), frames, 0);
      if (read && read.value() > 0) {
        microphoneFrames = read.value();
        // A metered measurement input stays out of the playback path.
        for (int i = 0; meter < 0 && i < read.value(); ++i) {
          audio[i] = microphone_[i * 2];
          audio[frames + i] = microphone_[i * 2 + 1];
        }
      }
      if (!read && capture_)
        capture_->invalidate();
      inputShort = inputShort || !read || read.value() < frames;
    }
    const bool measuring = meter >= 0 || directMeasurementStreams_ ||
                           capture_ != nullptr || !measurementNoise_.empty();
    const bool pipelineSignal = !directMeasurementStreams_ && measurementPipeline_.load(std::memory_order_relaxed) &&
                                ((capture_ && capture_->status() == 1) || !measurementNoise_.empty());
    float microphonePeak = 0;
    for (int i = 0; i < microphoneFrames; ++i) {
      // The meter reads the recorded channel, as FiniteCapture does.
      const float left = microphone_[i * 2], right = microphone_[i * 2 + 1];
      const float sample = meter == 0   ? left
                           : meter == 1 ? right
                           : meter == 2 ? 0.5F * (left + right)
                                        : std::max(std::abs(left), std::abs(right));
      microphonePeak = std::max(microphonePeak, std::abs(sample));
    }
    if (capture_)
      capture_->process(microphone_.data(), microphoneFrames, audio, frames);
    else if (!measurementNoise_.empty()) {
      for (int i = 0; i < frames; ++i) {
        for (int ch = 0; ch < streamChannels_; ++ch)
          audio[ch * frames + i] = measurementNoise_[noisePosition_++];
        if (noisePosition_ == measurementNoise_.size())
          noisePosition_ = 0;
      }
    }
    // A held graph leaves the player source queued, as a closed stream did.
    const bool playing =
        !measuring && !held && playing_.load(std::memory_order_relaxed);
    const auto consumed =
        measuring || held
            ? 0u
            : pcm_.read(audio, frames, playing,
                        playerGain_.load(std::memory_order_relaxed));
    rendered_.fetch_add(consumed, std::memory_order_relaxed);
    if (!held && !measuring && liveInput_ && liveInput_->route && session_.io()->receiving &&
        liveInput_->route == session_.io()->receiveGeneration) {
      if (session_.pipeline()->receiveId()) std::fill_n(audio, samples, 0.f);
      if (!liveInput_->render(audio, frames, streamChannels_, sampleRate_, playerGain_.load(std::memory_order_relaxed)))
        starved = true;
    }
    starved = starved || (playing && consumed < static_cast<std::uint32_t>(frames));
    inputPeak_ = 0;
    for (int i = 0; i < samples; ++i)
      inputPeak_ = std::max(inputPeak_, std::abs(audio[i]));
    if (measuring)
      inputPeak_ = microphonePeak;
    // Held until the level meter reads it. The metered input is not part of
    // the processed input.
    meterPeak_ =
        std::max(meterPeak_, meter >= 0 ? microphonePeak : inputPeak_);
    if (!held && monitoring_ &&
        (inputPeak_ > silenceThreshold_ || mustProcess_ || measuring)) {
      resetTemporal();
      monitoring_ = false;
      silenceFrames_ = 0;
    }
    if (pipelineSignal || (!monitoring_ && !measuring)) {
      if (!measuring && !held && scoreRunning_) {
        auto &midi = session_.pipeline()->midi;
        const auto gain = playerGain_.load(std::memory_order_relaxed);
        midi.gain(gain);
        auto *other = parallelMidi_ ? parallelMidi_->scheduler : nullptr;
        if (other) other->gain(gain);
        if (scoreWaiting_) {
          if ((scoreWaiting_ & 1) && midi.takePrepared()) scoreWaiting_ &= ~1u;
          if ((scoreWaiting_ & 2) && other->takePrepared()) scoreWaiting_ &= ~2u;
          if (!scoreWaiting_) {
            const auto frame = session_.position();
            midi.start(midi.generation(), frame);
            if (other) other->start(other->generation(), frame);
          }
        }
      }
      // Render excitation directly through the effects, bypassing playback output routing.
      const auto rendered = pipelineSignal
          ? owner == Owner::Audio &&
                session_.render(std::span(audio, samples), frames, {}, true,
                                audio::Session::RenderRoute::Measurement)
          : session_.renderDevice(std::span(planarOut_).first(samples), frames,
                                  std::span(planarIn_).first(samples), held);
      if (!pipelineSignal)
        audio = planarOut_.data();
      if (pipelineSignal && !rendered && capture_)
        capture_->invalidate();
      if (!rendered)
        std::fill_n(audio, samples, 0.0F);
      renderFailed = renderFailed || (!rendered && (!pipelineSignal || owner == Owner::Audio));
    }
    // While control holds the graph, only a measurement signal is audible;
    // Monitoring would otherwise pass the unprocessed input through.
    if (held && !measuring)
      std::fill_n(audio, samples, 0.0F);
    // The last graph access of this slice is done; control may take it now.
    if (owner == Owner::Requested &&
        (measuring || monitoring_ || session_.output().topologyClosed()))
      owner_.compare_exchange_strong(owner, Owner::Control,
                                     std::memory_order_acq_rel);
    outputPeak_ = 0;
    for (int i = 0; i < samples; ++i)
      outputPeak_ = std::max(outputPeak_, std::abs(audio[i]));
    if (pipelineSignal && capture_ && outputPeak_ > 1.0F) {
      capture_->outputClipped();
      std::fill_n(audio, samples, 0.0F);
    }
    if (inputPeak_ > silenceThreshold_ || outputPeak_ > silenceThreshold_ ||
        mustProcess_ || measuring || (!held && scoreRunning_))
      silenceFrames_ = 0;
    else
      silenceFrames_ += frames;
    if (!mustProcess_ && silenceFrames_ >= monitoringSeconds_ * sampleRate_)
      monitoring_ = true;
    clockFrames_ += frames;
    const auto gain = gain_.load(std::memory_order_relaxed);
    if (streamChannels_ == 2) {
      for (int i = 0; i < frames; ++i) {
        output[(offset + i) * 2] = audio[i] * gain;
        output[(offset + i) * 2 + 1] = audio[frames + i] * gain;
      }
    } else {
      for (int ch = 0; ch < streamChannels_; ++ch)
        for (int i = 0; i < frames; ++i)
          output[(offset + i) * streamChannels_ + ch] = audio[ch * frames + i] * gain;
    }
    offset += frames;
  }
  // Counted once per callback; control reads them on its own tick.
  if (renderFailed) {
    renderFailures_.fetch_add(1, std::memory_order_relaxed);
    renderFailed_.store(true, std::memory_order_release);
  }
  if (starved)
    sourceUnderruns_.fetch_add(1, std::memory_order_relaxed);
  if (inputShort)
    inputUnderruns_.fetch_add(1, std::memory_order_relaxed);
  return oboe::DataCallbackResult::Continue;
}

} // namespace effetune::android

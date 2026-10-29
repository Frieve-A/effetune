#include "native_engine.h"
#include <aaudio/AAudio.h>
#include <algorithm>
#include <android/log.h>
#include <chrono>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <sys/mman.h>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>

namespace effetune::android {

NativeEngine::NativeEngine(std::int32_t sampleRate, std::int32_t maxFrames)
    : engine_(std::make_unique<Engine>()), sampleRate_(sampleRate),
      maxFrames_(maxFrames) {
  if (sampleRate < 8000 || sampleRate > 192000 || maxFrames < 64 ||
      maxFrames > 4096) {
    throw std::invalid_argument("Invalid audio format");
  }
  microphone_.resize(static_cast<std::size_t>(maxFrames) * 2);
  if (engine_->prepare(static_cast<float>(sampleRate), 2, maxFrames, 65536) !=
      ET_OK) {
    throw std::runtime_error("Engine prepare failed");
  }
  const std::uint8_t empty[] = {1, 0, 0, 0, 0, 0, 0, 0};
  if (engine_->configurePipeline(empty, sizeof(empty)) != ET_OK) {
    throw std::runtime_error("Empty pipeline failed");
  }
}

NativeEngine::~NativeEngine() {
  stop();
  if (input_)
    input_->close();
}

int NativeEngine::start() {
  if (outputStatus() == 1)
    return 0;
  outputError_ = std::make_shared<OutputError>();
  oboe::AudioStreamBuilder builder;
  builder.setDirection(oboe::Direction::Output)
      ->setFormat(oboe::AudioFormat::Float)
      ->setChannelCount(2)
      ->setSampleRate(sampleRate_)
      ->setSampleRateConversionQuality(
          oboe::SampleRateConversionQuality::Medium)
      ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
      ->setSharingMode(oboe::SharingMode::Shared)
      ->setUsage(oboe::Usage::Media)
      ->setDeviceId(preferredOutput_)
      ->setErrorCallback(outputError_)
      ->setDataCallback(this);
  auto status = builder.openStream(output_);
  if (status != oboe::Result::OK)
    return lastOutputError_ = static_cast<int>(status);
  status = output_->requestStart();
  if (status != oboe::Result::OK) {
    output_->close();
    output_.reset();
    return lastOutputError_ = static_cast<int>(status);
  }
  running_ = true;
  lastOutputError_ = 0;
  return 0;
}

void NativeEngine::stop() {
  closeOutput();
  applyPending();
  if (capture_)
    capture_->invalidate();
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
  if (error != 0) {
    stop();
    lastOutputError_ = error;
  }
  return running_ ? 1 : lastOutputError_;
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
  if (output_) {
    output_->requestStop();
    output_->close();
    output_.reset();
  }
  running_ = false;
  outputError_.reset();
}

int NativeEngine::outputDeviceId() const {
  return output_ ? output_->getDeviceId() : 0;
}

void NativeEngine::prepareResume() {
  Command command(Command::Kind::Resume);
  submit(command);
}

int NativeEngine::setOutputDevice(int deviceId) {
  if (deviceId < 0)
    throw std::invalid_argument("Invalid output device");
  const bool restart = running_;
  const int previous = preferredOutput_;
  stop();
  preferredOutput_ = deviceId;
  if (!restart)
    return 0;
  const int result = start();
  if (result != 0) {
    preferredOutput_ = previous;
    start();
  }
  return result;
}

void NativeEngine::setMeasurementNoiseFile(int fd, std::uint32_t frames) {
  struct stat info{};
  if (frames == 0 || frames > static_cast<std::uint32_t>(sampleRate_) * 10 ||
      fstat(fd, &info) || !S_ISREG(info.st_mode) ||
      info.st_size != static_cast<std::int64_t>(frames) * 8)
    throw std::invalid_argument("Invalid measurement noise file");
  Command command(Command::Kind::MeasurementNoise);
  command.floats.resize(static_cast<std::size_t>(frames) * 2);
  const auto bytes = command.floats.size() * sizeof(float);
  if (pread(fd, command.floats.data(), bytes, 0) != static_cast<ssize_t>(bytes))
    throw std::runtime_error("Cannot read measurement noise file");
  for (float value : command.floats)
    if (!std::isfinite(value) || std::abs(value) > 1)
      throw std::invalid_argument("Invalid noise sample");
  submit(command);
}

void NativeEngine::stopMeasurementNoise() {
  Command command(Command::Kind::MeasurementNoise);
  submit(command);
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
            output_ ? output_->getBufferCapacityInFrames() * 2 : maxFrames_ * 4)
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
    auto deviceRate = command.input->getHardwareSampleRate();
    if (deviceRate <= 0 &&
        command.input->getAudioApi() == oboe::AudioApi::AAudio)
      deviceRate = AAudioStream_getSampleRate(
          static_cast<AAudioStream *>(command.input->getUnderlyingStream()));
    if (deviceRate <= 0)
      deviceRate = sampleRate_;
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

std::vector<int> NativeEngine::configure(
    const std::vector<std::string> &types,
    const std::vector<std::vector<float>> &parameters,
    const std::vector<std::uint32_t> &hashes,
    std::vector<std::uint8_t> descriptor,
    const std::vector<std::vector<std::uint8_t>> &structured) {
  if (types.size() > 128 || types.size() != parameters.size() ||
      types.size() != hashes.size() ||
      descriptor.size() != 8 + types.size() * 12 ||
      (!structured.empty() && structured.size() != types.size()))
    throw std::invalid_argument("Invalid pipeline");
  Command command(Command::Kind::Replace);
  command.engine = std::make_unique<Engine>();
  if (command.engine->prepare(static_cast<float>(sampleRate_), 2, maxFrames_,
                              65536) != ET_OK) {
    throw std::runtime_error("Pipeline prepare failed");
  }
  std::vector<int> instances;
  for (std::size_t i = 0; i < types.size(); ++i) {
    const auto instance = command.engine->createInstance(types[i].c_str());
    if (instance == 0 || command.engine->setInstanceParams(
                             instance, parameters[i].data(),
                             static_cast<std::uint32_t>(parameters[i].size()),
                             hashes[i], 0) != ET_OK) {
      throw std::invalid_argument("Invalid effect parameters");
    }
    command.engine->setInstanceTap(instance, static_cast<std::uint32_t>(i + 1));
    if (!structured.empty() && !structured[i].empty() &&
        command.engine->setInstanceParamBytes(
            instance, structured[i].data(),
            static_cast<std::uint32_t>(structured[i].size()), hashes[i],
            0) != ET_OK)
      throw std::invalid_argument("Invalid structured effect parameters");
    instances.push_back(static_cast<int>(instance));
  }
  for (std::size_t i = 0; i < types.size(); ++i) {
    const auto offset = 8 + i * 12;
    std::uint32_t index = 0;
    std::memcpy(&index, descriptor.data() + offset, 4);
    if (index == 0 || index > instances.size())
      throw std::invalid_argument("Invalid effect index");
    const auto handle = static_cast<std::uint32_t>(instances[index - 1]);
    std::memcpy(descriptor.data() + offset, &handle, 4);
  }
  if (command.engine->configurePipeline(
          descriptor.data(), static_cast<std::uint32_t>(descriptor.size())) !=
          ET_OK ||
      command.engine->reservePipelineLatency() != ET_OK)
    throw std::invalid_argument("Invalid pipeline routing");
  if (submit(command) != ET_OK)
    throw std::runtime_error("Pipeline apply failed");
  contracts_.clear();
  for (std::size_t i = 0; i < instances.size(); ++i)
    contracts_.push_back({static_cast<std::uint32_t>(instances[i]), hashes[i],
                          static_cast<std::uint32_t>(parameters[i].size())});
  legacyAssetInstances_.clear();
  for (std::size_t i = 0; i < types.size(); ++i)
    if (types[i] == "IRReverbPlugin")
      legacyAssetInstances_.push_back(instances[i]);
  return instances;
}

int NativeEngine::setParameters(int instance, std::vector<float> values,
                                std::uint32_t hash) {
  Command command(Command::Kind::Parameters);
  command.instance = instance;
  command.hash = hash;
  command.floats = std::move(values);
  return submit(command);
}

int NativeEngine::setParameterBytes(int instance,
                                    std::vector<std::uint8_t> values,
                                    std::uint32_t hash) {
  Command command(Command::Kind::Bytes);
  command.instance = instance;
  command.hash = hash;
  command.bytes = std::move(values);
  return submit(command);
}

int NativeEngine::setAsset(int instance, int slot, const AssetBeginInfo &info,
                           const std::vector<std::uint8_t> &bytes,
                           std::uint32_t format) {
  return prepareAsset(instance, slot, info, bytes.data(),
                      static_cast<std::uint32_t>(bytes.size()), format);
}

int NativeEngine::setAssetFile(int instance, int slot,
                               const AssetBeginInfo &info, int fd,
                               std::uint32_t byteSize, std::uint32_t format) {
  struct stat file{};
  if (fd < 0 || byteSize == 0 || byteSize > 1024u * 1024u * 1024u ||
      fstat(fd, &file) != 0 || file.st_size < byteSize ||
      !S_ISREG(file.st_mode))
    return ET_ERR_ARGS;
  void *mapped = mmap(nullptr, byteSize, PROT_READ, MAP_PRIVATE, fd, 0);
  if (mapped == MAP_FAILED)
    return ET_ERR_OOM;
  const auto status =
      prepareAsset(instance, slot, info,
                   static_cast<const std::uint8_t *>(mapped), byteSize, format);
  munmap(mapped, byteSize);
  return status;
}

int NativeEngine::prepareAsset(int instance, int slot,
                               const AssetBeginInfo &info,
                               const std::uint8_t *data, std::uint32_t byteSize,
                               std::uint32_t format) {
  Command capture(Command::Kind::CaptureAsset);
  capture.instance = instance;
  capture.slot = slot;
  auto status = submit(capture);
  if (status == ET_ERR_UNSUPPORTED &&
      std::find(legacyAssetInstances_.begin(), legacyAssetInstances_.end(),
                instance) != legacyAssetInstances_.end()) {
    if (byteSize != 0 && (!data || byteSize != info.byteSize))
      return ET_ERR_ARGS;
    // IR uses the core's begin/commit contract, which allocates during begin.
    // Join output before handing its Engine to control, then restore only the
    // previously running output. Input, source queue and other effects survive.
    const bool restart = running_;
    closeOutput();
    if (capture_)
      capture_->invalidate();
    if (byteSize == 0) {
      engine_->abortInstanceAsset(instance, slot);
      status = ET_OK;
    } else if (auto *staging =
                   engine_->beginInstanceAsset(instance, slot, info)) {
      std::memcpy(staging, data, byteSize);
      status = engine_->commitInstanceAsset(instance, slot, byteSize, format);
      if (status != ET_OK)
        engine_->abortInstanceAsset(instance, slot);
    } else
      status = ET_ERR_ARGS;
    const auto latency = engine_->refreshPipelineLatency();
    const auto reserve =
        latency == ET_OK ? engine_->reservePipelineLatency() : latency;
    if (status == ET_OK)
      status = reserve;
    if (restart) {
      const auto resumed = start();
      if (status == ET_OK && resumed != 0)
        status = ET_ERR_STATE;
    }
    return status;
  }
  if (status != ET_OK)
    return status;
  Command update(Command::Kind::ApplyAsset);
  status =
      byteSize == 0
          ? Engine::prepareInstanceAssetClear(capture.snapshot, update.asset)
          : Engine::prepareInstanceAssetUpdate(capture.snapshot, info, data,
                                               byteSize, format, update.asset);
  if (status != ET_OK)
    return status;
  status = submit(update);
  if (status != ET_OK)
    return status;
  Command captureLatency(Command::Kind::CaptureLatency);
  status = submit(captureLatency);
  if (status != ET_OK)
    return status;
  Command applyLatency(Command::Kind::ApplyLatency);
  status = Engine::preparePipelineLatencyUpdate(captureLatency.latencySnapshot,
                                                applyLatency.latencyUpdate);
  return status == ET_OK ? submit(applyLatency) : status;
}

std::vector<std::uint8_t> NativeEngine::telemetry() {
  Command command(Command::Kind::Telemetry);
  command.bytes.resize(65536);
  if (submit(command) != ET_OK)
    return {};
  return std::move(command.bytes);
}

std::vector<int> NativeEngine::runtimeEvents() {
  Command command(Command::Kind::RuntimeEvents);
  command.bytes.resize(contracts_.size() * 16);
  submit(command);
  std::vector<int> result(command.slot * 4);
  if (!result.empty())
    std::memcpy(result.data(), command.bytes.data(),
                result.size() * sizeof(int));
  return result;
}

void NativeEngine::beginMeasurementFiles(int excitationFd, int resultFd,
                                         std::uint32_t excitationFrames,
                                         std::uint32_t frames) {
  if (frames == 0 || frames > 16ULL * 1048576 + 41ULL * sampleRate_ ||
      excitationFrames > frames)
    throw std::invalid_argument("Invalid finite measurement size");
  Command command(Command::Kind::MeasurementStart);
  command.capture = std::make_unique<FiniteCapture>(excitationFd, resultFd,
                                                    excitationFrames, frames);
  if (submit(command) != ET_OK)
    throw std::runtime_error("Measurement requires microphone input");
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

int NativeEngine::scheduleParameters(int instance, std::vector<float> values,
                                     std::uint32_t hash, std::uint64_t frame) {
  if (values.size() > 1024)
    return ET_ERR_ARGS;
  const auto contract = std::find_if(
      contracts_.begin(), contracts_.end(), [instance](const auto &entry) {
        return entry[0] == static_cast<std::uint32_t>(instance);
      });
  if (contract == contracts_.end() || (*contract)[1] != hash ||
      (*contract)[2] != values.size())
    return ET_ERR_ARGS;
  Command command(Command::Kind::ScheduleParameters);
  command.instance = instance;
  command.hash = hash;
  command.floats = std::move(values);
  command.frame = frame;
  return submit(command);
}

std::uint64_t NativeEngine::audioFrameTime() {
  Command command(Command::Kind::AudioFrameTime);
  submit(command);
  return command.frame;
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
  case Command::Kind::Resume:
    command.result = engine_->reset();
    silenceFrames_ = 0;
    monitoring_ = false;
    break;
  case Command::Kind::Replace:
    engine_.swap(command.engine);
    silenceFrames_ = 0;
    monitoring_ = false;
    for (auto &event : scheduled_)
      event.active = false;
    break;
  case Command::Kind::Input:
    input_.swap(command.input);
    inputBurst_ = command.inputBurst;
    measurementNoise_.swap(command.floats);
    if (capture_)
      capture_->invalidate();
    break;
  case Command::Kind::Parameters:
    command.result = engine_->setInstanceParams(
        command.instance, command.floats.data(),
        static_cast<std::uint32_t>(command.floats.size()), command.hash, 0);
    silenceFrames_ = 0;
    monitoring_ = false;
    break;
  case Command::Kind::Bytes:
    command.result = engine_->setInstanceParamBytes(
        command.instance, command.bytes.data(),
        static_cast<std::uint32_t>(command.bytes.size()), command.hash, 0);
    silenceFrames_ = 0;
    monitoring_ = false;
    break;
  case Command::Kind::CaptureAsset:
    command.result = engine_->captureInstanceAssetSnapshot(
        command.instance, command.slot, command.snapshot);
    break;
  case Command::Kind::ApplyAsset:
    command.result = engine_->applyInstanceAssetUpdate(command.asset);
    silenceFrames_ = 0;
    monitoring_ = false;
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
  case Command::Kind::CaptureLatency:
    command.result =
        engine_->capturePipelineLatencySnapshot(command.latencySnapshot);
    break;
  case Command::Kind::ApplyLatency:
    command.result = engine_->applyPipelineLatencyUpdate(command.latencyUpdate);
    break;
  case Command::Kind::ScheduleParameters: {
    command.result = ET_ERR_STATE;
    for (auto &event : scheduled_) {
      if (event.active)
        continue;
      event.instance = command.instance;
      event.hash = command.hash;
      event.frame = command.frame;
      event.count = static_cast<std::uint32_t>(command.floats.size());
      std::copy(command.floats.begin(), command.floats.end(),
                event.values.begin());
      event.active = true;
      command.result = ET_OK;
      break;
    }
    break;
  }
  case Command::Kind::Telemetry: {
    std::uint32_t dropped = 0;
    command.bytes.resize(engine_->readTelemetry(
        command.bytes.data(), static_cast<std::uint32_t>(command.bytes.size()),
        &dropped));
    break;
  }
  case Command::Kind::RuntimeEvents: {
    for (const auto &contract : contracts_) {
      RuntimeEventState state{};
      if (engine_->readInstanceRuntimeEvent(contract[0], state) != ET_OK)
        continue;
      const std::uint32_t values[]{contract[0], state.generation, state.latched,
                                   state.cause};
      std::memcpy(command.bytes.data() + command.slot * sizeof(values), values,
                  sizeof(values));
      ++command.slot;
    }
    break;
  }
  }
}

oboe::DataCallbackResult NativeEngine::onAudioReady(oboe::AudioStream *,
                                                    void *data,
                                                    std::int32_t frameCount) {
  auto *output = static_cast<float *>(data);
  std::int32_t offset = 0;
  while (offset < frameCount) {
    applyPending();
    auto frames = std::min(maxFrames_, frameCount - offset);
    for (auto &event : scheduled_) {
      if (!event.active)
        continue;
      if (event.frame <= clockFrames_) {
        engine_->setInstanceParams(event.instance, event.values.data(),
                                   event.count, event.hash, 0);
        event.active = false;
        silenceFrames_ = 0;
        monitoring_ = false;
      } else if (event.frame - clockFrames_ <
                 static_cast<std::uint64_t>(frames)) {
        frames = static_cast<std::int32_t>(event.frame - clockFrames_);
      }
    }
    auto *audio = engine_->combined();
    std::fill_n(audio, frames * 2, 0.0F);
    int microphoneFrames = 0;
    bool inputReady = input_ != nullptr;
    if (input_ && capture_ && capture_->frames() == 0) {
      // Prime the complete output callback plus two input bursts before the
      // first excitation frame. Input and output callbacks arrive
      // independently; starting on one small DSP slice can exhaust input in the
      // same callback.
      const auto available = input_->getAvailableFrames();
      inputReady =
          available &&
          available.value() >= frameCount + static_cast<int>(inputBurst_) * 2;
      if (!available)
        capture_->invalidate();
    }
    if (inputReady) {
      const auto read = input_->read(microphone_.data(), frames, 0);
      if (read && read.value() > 0) {
        microphoneFrames = read.value();
        for (int i = 0; i < read.value(); ++i) {
          audio[i] = microphone_[i * 2];
          audio[frames + i] = microphone_[i * 2 + 1];
        }
      }
      if (!read && capture_)
        capture_->invalidate();
    }
    const bool measuring = capture_ != nullptr || !measurementNoise_.empty();
    float microphonePeak = 0;
    for (int i = 0; i < microphoneFrames * 2; ++i)
      microphonePeak = std::max(microphonePeak, std::abs(microphone_[i]));
    if (capture_)
      capture_->process(microphone_.data(), microphoneFrames, audio, frames);
    else if (!measurementNoise_.empty()) {
      for (int i = 0; i < frames; ++i) {
        audio[i] = measurementNoise_[noisePosition_++];
        audio[frames + i] = measurementNoise_[noisePosition_++];
        if (noisePosition_ == measurementNoise_.size())
          noisePosition_ = 0;
      }
    }
    const auto consumed =
        measuring
            ? 0u
            : pcm_.read(audio, frames, playing_.load(std::memory_order_relaxed),
                        playerGain_.load(std::memory_order_relaxed));
    rendered_.fetch_add(consumed, std::memory_order_relaxed);
    inputPeak_ = 0;
    for (int i = 0; i < frames * 2; ++i)
      inputPeak_ = std::max(inputPeak_, std::abs(audio[i]));
    if (measuring)
      inputPeak_ = microphonePeak;
    if (monitoring_ &&
        (inputPeak_ > silenceThreshold_ || mustProcess_ || measuring)) {
      std::copy_n(audio, frames * 2, microphone_.data());
      engine_->reset();
      std::copy_n(microphone_.data(), frames * 2, audio);
      monitoring_ = false;
      silenceFrames_ = 0;
    }
    et_status status = ET_OK;
    if (!monitoring_ && !measuring) {
      status = engine_->processPipeline(
          2, frames, static_cast<double>(clockFrames_) / sampleRate_,
          bypass_.load(std::memory_order_relaxed));
      engine_->refreshPipelineLatencyRealtime();
    }
    outputPeak_ = 0;
    for (int i = 0; i < frames * 2; ++i)
      outputPeak_ = std::max(outputPeak_, std::abs(audio[i]));
    if (inputPeak_ > silenceThreshold_ || outputPeak_ > silenceThreshold_ ||
        mustProcess_ || measuring)
      silenceFrames_ = 0;
    else
      silenceFrames_ += frames;
    if (!mustProcess_ && silenceFrames_ >= monitoringSeconds_ * sampleRate_)
      monitoring_ = true;
    clockFrames_ += frames;
    const auto gain = gain_.load(std::memory_order_relaxed);
    for (int i = 0; i < frames; ++i) {
      output[(offset + i) * 2] = status == ET_OK ? audio[i] * gain : 0;
      output[(offset + i) * 2 + 1] =
          status == ET_OK ? audio[frames + i] * gain : 0;
    }
    offset += frames;
  }
  return oboe::DataCallbackResult::Continue;
}

} // namespace effetune::android

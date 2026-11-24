#include "native_engine.h"
#include "engine.h"
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
    : sampleRate_(sampleRate), maxFrames_(maxFrames) {
  if (sampleRate < 8000 || sampleRate > 192000 || maxFrames < 64 ||
      maxFrames > 4096) {
    throw std::invalid_argument("Invalid audio format");
  }
  microphone_.resize(static_cast<std::size_t>(maxFrames) * 2);
  planarIn_.resize(microphone_.size());
  planarOut_.resize(microphone_.size());
  if (!session_.open({static_cast<unsigned>(sampleRate), 2, 2, static_cast<unsigned>(maxFrames)}))
    throw std::runtime_error("Engine prepare failed");
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
    const std::vector<std::uint32_t> &ids,
    std::vector<std::uint8_t> descriptor,
    const std::vector<std::vector<std::uint8_t>> &structured) {
  if (types.size() > 128 || types.size() != parameters.size() ||
      types.size() != hashes.size() || types.size() != ids.size() ||
      descriptor.size() != 8 + types.size() * 12 ||
      (!structured.empty() && structured.size() != types.size()))
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
    if (plugin.id == 0 || !nextSettings.emplace(plugin.id, plugin).second)
      throw std::invalid_argument("Invalid effect ID");
    if (plugin.type == "SFZNotePlayerPlugin" || plugin.type == "SoundFontPlayerPlugin")
      nextInstruments.push_back(plugin.id);
    plugins.push_back(std::move(plugin));
  }
  run([&]() noexcept {
    for (auto &scheduled : scheduled_)
      scheduled.active = false;
    return ET_OK;
  });
  auto *pipeline = session_.pipeline();
  const auto publishSettings = [&]() noexcept {
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
    const bool restart = outputStatus() == 1;
    if (restart)
      closeOutput();
    configured = pipeline->configure(std::move(plugins), std::move(descriptor));
    if (configured)
      publishSettings();
    if (restart && start() != 0)
      throw std::runtime_error("Pipeline output restart failed");
    if (!configured)
      throw std::invalid_argument("Invalid pipeline routing");
  }
  settings_.swap(nextSettings);
  return {ids.begin(), ids.end()};
}

int NativeEngine::setParameters(int instance, std::vector<float> values,
                                std::uint32_t hash) {
  const auto found = settings_.find(instance);
  if (found == settings_.end() || found->second.layoutHash != hash ||
      found->second.params.size() != values.size())
    return ET_ERR_ARGS;
  if (values.empty())
    return ET_OK;
  auto settings = found->second;
  settings.params = values;
  const auto status = run([&]() noexcept { return applyParameters(settings); });
  if (status == ET_OK)
    found->second.params = std::move(values);
  return status;
}

int NativeEngine::setParameterBytes(int instance,
                                    std::vector<std::uint8_t> values,
                                    std::uint32_t hash) {
  const auto found = settings_.find(instance);
  if (found == settings_.end() || found->second.layoutHash != hash)
    return ET_ERR_ARGS;
  auto settings = found->second;
  settings.bytes = values;
  const auto status = run([&]() noexcept { return applyParameters(settings); });
  if (status == ET_OK)
    found->second.bytes = std::move(values);
  return status;
}

int NativeEngine::applyParameters(audio::PluginSettings &settings) noexcept {
  silenceFrames_ = 0;
  monitoring_ = false;
  return session_.updateParameter(settings) ? ET_OK : ET_ERR_ARGS;
}

void NativeEngine::setBypass(bool bypass) {
  if (session_.masterBypass() == bypass)
    return;
  const bool restart = outputStatus() == 1;
  if (restart)
    closeOutput();
  session_.setMasterBypass(bypass);
  if (restart)
    lastOutputError_ = start();
}

int NativeEngine::setAsset(int instance, int slot, const AssetBeginInfo &info,
                           const std::vector<std::uint8_t> &bytes, std::uint32_t format,
                           std::optional<std::uint32_t> revision) {
  return prepareAsset(instance, slot, info, bytes.data(),
                      static_cast<std::uint32_t>(bytes.size()), format, revision);
}

int NativeEngine::setAssetFile(int instance, int slot, const AssetBeginInfo &info, int fd,
                               std::uint32_t byteSize, std::uint32_t format,
                               std::optional<std::uint32_t> revision) {
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
                      byteSize, format, revision);
}

int NativeEngine::prepareAsset(int instance, int slot, const AssetBeginInfo &info,
                               const std::uint8_t *data, std::uint32_t byteSize,
                               std::uint32_t format, std::optional<std::uint32_t> revision) {
  const auto plugin = settings_.find(instance);
  if (slot < 0 || (byteSize && (!data || byteSize != info.byteSize)))
    return ET_ERR_ARGS;
  auto *pipeline = session_.pipeline();
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
    candidate.footprintBytes = info.footprintBytes;
    candidate.formatTag = format;
    candidate.operationRevision = revision;
    if (slot == 0 && plugin != settings_.end()) {
      const auto &type = plugin->second.type;
      if (type == "SFZNotePlayerPlugin" || type == "SoundFontPlayerPlugin") {
        std::uint64_t additional = 0;
        const auto kind = type == "SFZNotePlayerPlugin" ? ET_SAMPLE_PLAYER_NOTE : ET_SAMPLE_PLAYER_MAIN;
        const auto status = et_sample_player_preparation_bytes(
            data, byteSize, byteSize, format, static_cast<float>(sampleRate_),
            info.processingChannels, maxFrames_, 0, &additional, kind);
        if (status != ET_OK)
          return status;
        const auto required = static_cast<std::uint64_t>(byteSize) + additional;
        if (required > info.footprintBytes || required > UINT32_MAX)
          return ET_ERR_OOM;
        candidate.footprintBytes = static_cast<std::uint32_t>(required);
      }
    }
    candidate.payload.assign(data, data + byteSize);
  }
  return submitAssetChange(pipeline->assetChange(instance, slot, std::move(asset)));
}

int NativeEngine::submitAssetChange(const std::shared_ptr<audio::Pipeline::AssetChange> &change) {
  for (;;) {
    int result = ET_ERR_ARGS;
    if (run([&]() noexcept { return change->capture() ? ET_OK : ET_ERR_STATE; }) == ET_OK &&
        change->prepare()) {
      if (change->awaitsPages()) {
        __android_log_write(ANDROID_LOG_WARN, "EffeTune", "Android requires resident instrument assets");
        result = ET_ERR_UNSUPPORTED;
      } else if (run([&]() noexcept { return change->captureRoute() ? ET_OK : ET_ERR_STATE; }) == ET_OK &&
                 change->prepareRoute()) {
        result = run([&]() noexcept {
          silenceFrames_ = 0;
          monitoring_ = false;
          return change->apply() ? ET_OK : ET_ERR_ARGS;
        });
        if (result == ET_OK) {
          if (change->deferred())
            return 1;
          change->finish();
          return ET_OK;
        }
        if (change->stale())
          continue;
      }
    }
    session_.pipeline()->releaseBank(change.get());
    return result;
  }
}

std::vector<std::uint8_t> NativeEngine::telemetry() {
  auto *telemetry = session_.telemetry();
  std::vector<std::uint8_t> data;
  for (unsigned count = 0; count < 3; ++count) {
    const auto *packet = telemetry->front();
    if (!packet)
      break;
    data.insert(data.end(), packet->data.begin(), packet->data.begin() + packet->bytes);
    telemetry->pop();
  }
  return data;
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

std::vector<int> NativeEngine::assetNotices() {
  auto *pipeline = session_.pipeline();
  if (session_.needsLatencyReservation()) {
    const bool restart = outputStatus() == 1;
    if (restart)
      closeOutput();
    session_.reserveLatency();
    if (restart)
      lastOutputError_ = start();
  }
  std::vector<int> result;
  audio::Pipeline::AssetNotice notice;
  while (pipeline->takeNotice(notice)) {
    if (notice.completed) {
      if (auto bank = pipeline->releaseBank(notice.completed)) {
        if (bank->stale()) {
          const auto result = submitAssetChange(bank);
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
  while (offset < frameCount) {
    applyPending();
    auto frames = std::min(maxFrames_, frameCount - offset);
    for (auto &event : scheduled_) {
      if (!event.active)
        continue;
      if (event.frame <= clockFrames_) {
        applyParameters(event.settings);
        event.active = false;
      } else if (event.frame - clockFrames_ <
                 static_cast<std::uint64_t>(frames)) {
        frames = static_cast<std::int32_t>(event.frame - clockFrames_);
      }
    }
    auto *audio = planarIn_.data();
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
      resetTemporal();
      monitoring_ = false;
      silenceFrames_ = 0;
    }
    if (!monitoring_ && !measuring) {
      const auto samples = static_cast<std::size_t>(frames) * 2u;
      const auto rendered = session_.renderDevice(std::span(planarOut_).first(samples), frames,
                                       std::span(planarIn_).first(samples));
      audio = planarOut_.data();
      if (!rendered)
        std::fill_n(audio, samples, 0.0F);
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
      output[(offset + i) * 2] = audio[i] * gain;
      output[(offset + i) * 2 + 1] =
          audio[frames + i] * gain;
    }
    offset += frames;
  }
  return oboe::DataCallbackResult::Continue;
}

} // namespace effetune::android

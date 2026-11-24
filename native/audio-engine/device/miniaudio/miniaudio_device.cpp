#include "device/device.h"
#include "device/planar_buffer.h"
#include "negotiation.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <limits>

namespace effetune::audio {
namespace miniaudio {

std::uint32_t listChannels(const ma_device_info &info) noexcept {
  std::uint32_t maximum = 0;
  for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i) {
    const auto count = info.nativeDataFormats[i].channels;
    if (count == 0)
      return 2;
    maximum = std::max(maximum, count);
  }
  return maximum;
}

std::uint32_t selectAlsaRate(const ma_device_info &info, std::uint32_t channels,
                             std::uint32_t targetRate) noexcept {
  std::uint32_t nearest = std::numeric_limits<std::uint32_t>::max();
  std::uint32_t maximum = 0;
  for (ma_uint32 i = 0; i < info.nativeDataFormatCount; ++i) {
    const auto &format = info.nativeDataFormats[i];
    if ((format.channels != 0 && format.channels != channels) ||
        (format.flags & MA_DATA_FORMAT_FLAG_EXCLUSIVE_MODE))
      continue;
    if (format.sampleRate == 0 || format.sampleRate == targetRate)
      return targetRate;
    maximum = std::max(maximum, format.sampleRate);
    if (format.sampleRate > targetRate)
      nearest = std::min(nearest, format.sampleRate);
  }
  return nearest != std::numeric_limits<std::uint32_t>::max() ? nearest : maximum;
}

ma_device_config deviceConfig(ma_device_type type, DeviceLatency latency) {
  auto config = ma_device_config_init(type);
  config.playback.format = ma_format_f32;
  config.capture.format = ma_format_f32;
  config.noFixedSizedCallback = MA_TRUE;
  config.noClip = MA_TRUE;
  config.noPreSilencedOutputBuffer = MA_TRUE;
  config.alsa.noAutoResample = MA_TRUE;
  config.alsa.noAutoChannels = MA_TRUE;
  config.coreaudio.allowNominalSampleRateChange = MA_FALSE;
  config.performanceProfile = ma_performance_profile_low_latency;
  config.periodSizeInMilliseconds = latency == DeviceLatency::Low    ? 4u
                                    : latency == DeviceLatency::High ? 30u
                                                                     : 10u;
  config.periods = latency == DeviceLatency::High ? 3u : 2u;
  return config;
}

} // namespace miniaudio
namespace {

using Clock = std::chrono::steady_clock;

std::uint64_t timeNs(Clock::time_point time = Clock::now()) noexcept {
  return static_cast<std::uint64_t>(
      std::chrono::duration_cast<std::chrono::nanoseconds>(time.time_since_epoch()).count());
}

DeviceError classify(ma_result result) noexcept {
  switch (result) {
  case MA_SUCCESS:
    return DeviceError::None;
  case MA_NO_DEVICE:
  case MA_DOES_NOT_EXIST:
  case MA_NO_BACKEND:
  case MA_UNAVAILABLE:
    return DeviceError::Unavailable;
  case MA_ACCESS_DENIED:
    return DeviceError::Permission;
  case MA_BUSY:
  case MA_ALREADY_IN_USE:
    return DeviceError::Busy;
  case MA_FORMAT_NOT_SUPPORTED:
  case MA_INVALID_DEVICE_CONFIG:
    return DeviceError::UnsupportedFormat;
  default:
    return DeviceError::Internal;
  }
}

std::string deviceId(ma_backend backend, const ma_device_id &id) {
  switch (backend) {
  case ma_backend_pulseaudio:
    return id.pulse;
  case ma_backend_alsa:
    return id.alsa;
  case ma_backend_coreaudio:
    return id.coreaudio;
  case ma_backend_null:
    return std::to_string(id.nullbackend);
  default:
    return {};
  }
}

ma_device_type deviceType(DeviceDirection direction) noexcept {
  return direction == DeviceDirection::Output ? ma_device_type_playback : ma_device_type_capture;
}

miniaudio::NegotiatedFormat negotiated(const ma_device &device, bool output) noexcept {
  const auto &converter = output ? device.playback.converter : device.capture.converter;
  return {
      output ? device.playback.channels : device.capture.channels,
      output ? device.playback.internalChannels : device.capture.internalChannels,
      device.sampleRate,
      output ? device.playback.internalSampleRate : device.capture.internalSampleRate,
      converter.hasChannelConverter != 0,
      converter.hasResampler != 0,
      ma_data_converter_get_input_latency(&converter) != 0 ||
          ma_data_converter_get_output_latency(&converter) != 0,
  };
}

class MiniaudioStream {
public:
  MiniaudioStream(DeviceCallbacks callbacks, DeviceDirection direction)
      : callbacks_(callbacks), direction_(direction) {}
  ~MiniaudioStream() { close(); }

  DeviceError open(ma_context &context, const DeviceRequest &request) {
    const auto type = deviceType(direction_);
    const bool output = direction_ == DeviceDirection::Output;
    backend_ = context.backend;
    ma_device_id explicitId{};
    const ma_device_id *id = nullptr;
    if (!request.selection.id.empty() && request.selection.id != "default") {
      ma_device_info *outputs = nullptr, *inputs = nullptr;
      ma_uint32 outputCount = 0, inputCount = 0;
      const auto status =
          ma_context_get_devices(&context, &outputs, &outputCount, &inputs, &inputCount);
      if (status != MA_SUCCESS)
        return classify(status);
      const std::span<const ma_device_info> devices =
          output ? std::span<const ma_device_info>(outputs, outputCount)
                 : std::span<const ma_device_info>(inputs, inputCount);
      const auto device =
          std::find_if(devices.begin(), devices.end(), [&](const ma_device_info &candidate) {
            return deviceId(backend_, candidate.id) == request.selection.id;
          });
      if (device == devices.end())
        return DeviceError::Unavailable;
      explicitId = device->id;
      id = &explicitId;
    }
    ma_device_info info{};
    const auto probe = ma_context_get_device_info(&context, type, id, &info);
    if (probe != MA_SUCCESS)
      return classify(probe);
    const auto physicalChannels = miniaudio::listChannels(info);
    if (!selectDeviceChannels(physicalChannels, request.selection.channels, channels_))
      return DeviceError::UnsupportedFormat;

    auto config = miniaudio::deviceConfig(type, request.latency);
    config.pUserData = this;
    config.notificationCallback = onNotification;
    config.dataCallback = onData;
    config.playback.pDeviceID = output ? id : nullptr;
    config.capture.pDeviceID = output ? nullptr : id;
    if (backend_ == ma_backend_alsa || backend_ == ma_backend_null) {
      if (output)
        config.playback.channels = physicalChannels;
      else
        config.capture.channels = physicalChannels;
      config.sampleRate = miniaudio::selectAlsaRate(info, physicalChannels, request.pipelineRate);
      if (config.sampleRate == 0)
        return DeviceError::UnsupportedFormat;
    }
    auto status = ma_device_init(&context, &config, &device_);
    if (status != MA_SUCCESS)
      return classify(status);
    opened_ = true;
    auto format = negotiated(device_, output);
    auto approval = miniaudio::verifyNegotiatedFormat(physicalChannels, format);
    if (approval == miniaudio::Negotiation::RetryAtInternalRate) {
      config.sampleRate = format.internalRate;
      close();
      status = ma_device_init(&context, &config, &device_);
      if (status != MA_SUCCESS)
        return classify(status);
      opened_ = true;
      format = negotiated(device_, output);
      approval = miniaudio::verifyNegotiatedFormat(physicalChannels, format);
    }
    const auto period = output ? device_.playback.internalPeriodSizeInFrames
                               : device_.capture.internalPeriodSizeInFrames;
    const auto periods =
        output ? device_.playback.internalPeriods : device_.capture.internalPeriods;
    if (approval != miniaudio::Negotiation::Accept || period == 0 || periods == 0 ||
        periods > std::numeric_limits<std::uint32_t>::max() / period)
      return DeviceError::UnsupportedFormat;

    format_ = {format.internalRate, format.internalChannels,
               static_cast<std::uint32_t>(channels_.size()), period, period * periods};
    planar_.resize(std::size_t(period) * channels_.size());
    return DeviceError::None;
  }

  const DeviceStreamFormat &format() const noexcept { return format_; }

  DeviceError start() {
    if (running_.exchange(true, std::memory_order_acq_rel))
      return DeviceError::None;
    observed_ = position_.load(std::memory_order_relaxed);
    lastProgress_ = Clock::now();
    const auto status = ma_device_start(&device_);
    if (status != MA_SUCCESS)
      running_.store(false, std::memory_order_release);
    return classify(status);
  }

  void stop() noexcept {
    if (running_.exchange(false, std::memory_order_acq_rel))
      ma_device_stop(&device_);
  }

  void poll(Clock::time_point now) noexcept {
    if (!running_.load(std::memory_order_acquire))
      return;
    const auto position = position_.load(std::memory_order_relaxed);
    if (position != observed_) {
      observed_ = position;
      lastProgress_ = now;
      return;
    }
    const auto timeout = std::chrono::milliseconds(std::max<std::uint64_t>(
        2000u, std::uint64_t(format_.periodFrames) * 10000u / format_.sampleRate));
    if (now - lastProgress_ >= timeout) {
      lastProgress_ = now;
      requestReset(DeviceResetReason::Stalled);
    }
  }

private:
  void close() noexcept {
    if (opened_) {
      stop();
      ma_device_uninit(&device_);
      opened_ = false;
    }
  }

  void requestReset(DeviceResetReason reason) const noexcept {
    if (callbacks_.reset)
      callbacks_.reset(callbacks_.context, direction_, reason);
  }

  static void onNotification(const ma_device_notification *notification) {
    const auto &stream = *static_cast<MiniaudioStream *>(notification->pDevice->pUserData);
    if (!stream.running_.load(std::memory_order_acquire))
      return;
    switch (notification->type) {
    case ma_device_notification_type_rerouted:
      if (stream.backend_ != ma_backend_pulseaudio)
        stream.requestReset(DeviceResetReason::Rerouted);
      break;
    case ma_device_notification_type_stopped:
      stream.requestReset(DeviceResetReason::Stopped);
      break;
    case ma_device_notification_type_interruption_began:
      stream.requestReset(DeviceResetReason::Interrupted);
      break;
    default:
      break;
    }
  }

  static void onData(ma_device *device, void *output, const void *input, ma_uint32 frames) {
    const auto stamp = timeNs();
    auto &stream = *static_cast<MiniaudioStream *>(device->pUserData);
    stream.transfer(static_cast<float *>(output), static_cast<const float *>(input), frames, stamp);
  }

  void transfer(float *output, const float *input, std::uint32_t frames,
                std::uint64_t stamp) noexcept {
    const auto position = position_.fetch_add(frames, std::memory_order_relaxed);
    const auto physicalChannels = format_.channels;
    for (std::uint32_t offset = 0; offset < frames;) {
      const auto count = std::min(frames - offset, format_.periodFrames);
      const auto at = stamp + std::uint64_t(offset) * 1000000000u / format_.sampleRate;
      const DeviceClock clock{position + offset, at, false};
      std::span<float> block(planar_.data(), std::size_t(count) * channels_.size());
      const auto sampleOffset = std::size_t(offset) * physicalChannels;
      if (output) {
        std::fill_n(output + sampleOffset, std::size_t(count) * physicalChannels, 0.0f);
        std::fill(block.begin(), block.end(), 0.0f);
        if (callbacks_.render)
          callbacks_.render(callbacks_.context, block, {}, count, clock);
        packInterleaved(
            block, count, physicalChannels, channels_,
            [&](std::size_t index, float sample) { output[sampleOffset + index] = sample; });
      }
      if (input && callbacks_.capture) {
        unpackPlanar(block, count, physicalChannels, channels_,
                     [&](std::size_t index) { return input[sampleOffset + index]; });
        callbacks_.capture(callbacks_.context, block, count, clock);
      }
      offset += count;
    }
  }

  ma_device device_{};
  DeviceCallbacks callbacks_;
  DeviceDirection direction_;
  ma_backend backend_{};
  DeviceStreamFormat format_{};
  std::vector<std::uint32_t> channels_;
  std::vector<float> planar_;
  std::atomic<std::uint64_t> position_{};
  std::atomic<bool> running_{};
  std::uint64_t observed_{};
  Clock::time_point lastProgress_{};
  bool opened_{};
};

class MiniaudioDevice final : public AudioDevice {
public:
  MiniaudioDevice(DeviceCallbacks callbacks, bool useTestNull) : callbacks_(callbacks) {
    auto config = ma_context_config_init();
    config.pulse.pApplicationName = "EffeTune";
    config.pulse.tryAutoSpawn = MA_FALSE;
#if defined(__linux__)
    config.threadPriority = ma_thread_priority_realtime;
#endif
    const ma_backend backends[] = {
#if defined(__APPLE__)
        ma_backend_coreaudio,
#else
        ma_backend_pulseaudio,
        ma_backend_alsa,
#endif
    };
    const ma_backend null[] = {ma_backend_null};
    const auto selected =
        useTestNull ? std::span<const ma_backend>(null) : std::span<const ma_backend>(backends);
    status_ = ma_context_init(selected.data(), static_cast<ma_uint32>(selected.size()), &config,
                              &context_);
  }

  ~MiniaudioDevice() override {
    close();
    if (status_ == MA_SUCCESS)
      ma_context_uninit(&context_);
  }

  DeviceError list(DeviceList &result) override {
    result = {};
    if (status_ != MA_SUCCESS)
      return status_ == MA_NO_BACKEND ? DeviceError::None : classify(status_);
    result.backend = ma_get_backend_name(context_.backend);
    ma_device_info *outputs = nullptr, *inputs = nullptr;
    ma_uint32 outputCount = 0, inputCount = 0;
    const auto status =
        ma_context_get_devices(&context_, &outputs, &outputCount, &inputs, &inputCount);
    if (status == MA_NO_DEVICE)
      return DeviceError::None;
    if (status != MA_SUCCESS)
      return classify(status);
    listDirection({outputs, outputCount}, ma_device_type_playback, result.outputs);
    listDirection({inputs, inputCount}, ma_device_type_capture, result.inputs);
    return DeviceError::None;
  }

  DeviceError openOutput(const DeviceRequest &request, DeviceStreamFormat &result) override {
    if (status_ != MA_SUCCESS || output_)
      return status_ == MA_SUCCESS ? DeviceError::Internal : classify(status_);
    auto stream = std::make_unique<MiniaudioStream>(callbacks_, DeviceDirection::Output);
    const auto error = stream->open(context_, request);
    if (error != DeviceError::None)
      return error;
    result = stream->format();
    output_ = std::move(stream);
    return DeviceError::None;
  }

  DeviceError replaceInput(const DeviceRequest *request, DeviceStreamFormat &result) override {
    input_.reset();
    result = {};
    if (!request)
      return DeviceError::None;
    if (request->selection.id == systemAudioId)
      return DeviceError::Unavailable;
    if (status_ != MA_SUCCESS)
      return classify(status_);
    auto stream = std::make_unique<MiniaudioStream>(callbacks_, DeviceDirection::Input);
    auto error = stream->open(context_, *request);
    if (error == DeviceError::None)
      error = stream->start();
    if (error != DeviceError::None)
      return error;
    result = stream->format();
    input_ = std::move(stream);
    return DeviceError::None;
  }

  DeviceError start() override { return output_ ? output_->start() : DeviceError::Internal; }

  void stop() noexcept override {
    if (output_)
      output_->stop();
  }

  void close() noexcept override {
    stop();
    input_.reset();
    output_.reset();
  }

  void poll() noexcept override {
    const auto now = Clock::now();
    if (output_)
      output_->poll(now);
    if (input_)
      input_->poll(now);
  }

private:
  void listDirection(std::span<const ma_device_info> devices, ma_device_type type,
                     std::vector<DeviceInfo> &result) {
    for (const auto &device : devices) {
      ma_device_info info{};
      if (ma_context_get_device_info(&context_, type, &device.id, &info) != MA_SUCCESS)
        continue;
      const auto channels = miniaudio::listChannels(info);
      auto id = deviceId(context_.backend, device.id);
      if (channels != 0 && !id.empty())
        result.push_back({std::move(id), device.name, channels, device.isDefault != 0});
    }
  }

  DeviceCallbacks callbacks_;
  ma_context context_{};
  ma_result status_{};
  std::unique_ptr<MiniaudioStream> output_, input_;
};
} // namespace

std::unique_ptr<AudioDevice> makeMiniaudioDevice(DeviceCallbacks callbacks, bool useTestNull) {
  return std::make_unique<MiniaudioDevice>(callbacks, useTestNull);
}

} // namespace effetune::audio

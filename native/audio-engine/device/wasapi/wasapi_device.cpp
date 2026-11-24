#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <initguid.h>
#include <mmdeviceapi.h>

#include <audioclient.h>
#include <audiopolicy.h>
#include <avrt.h>
#include <functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#include <wrl/client.h>

#include "device/device.h"
#include "device/planar_buffer.h"
#include "loopback_silence.h"
#include "render_priority.h"
#include "sample_format.h"

#include <atomic>
#include <cstdio>
#include <future>
#include <limits>
#include <thread>

namespace effetune::audio {
namespace {
using Microsoft::WRL::ComPtr;
constexpr auto deviceRole = eConsole;
constexpr auto defaultId = "default";

class ComThread {
public:
  ComThread() : result_(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) {}
  ~ComThread() {
    if (SUCCEEDED(result_))
      CoUninitialize();
  }
  explicit operator bool() const noexcept { return SUCCEEDED(result_); }

private:
  HRESULT result_;
};

struct CoTaskMemory {
  void operator()(void *memory) const noexcept { CoTaskMemFree(memory); }
};

struct WinHandle {
  void operator()(void *handle) const noexcept { CloseHandle(handle); }
};

class AudioThreadPriority {
public:
  AudioThreadPriority() noexcept { restore(); }
  ~AudioThreadPriority() {
    demote();
    if (failedOperation_)
      std::fprintf(stderr,
                   "WASAPI could not enable the audio thread priority (MMCSS "
                   "%s error %lu).\n",
                   failedOperation_, error_);
  }

  void restore() noexcept {
    if (registered() || failedOperation_)
      return;
    DWORD index = 0;
    task_ = AvSetMmThreadCharacteristicsW(L"Pro Audio", &index);
    if (!task_)
      rememberFailure("registration");
    else if (!AvSetMmThreadPriority(task_, AVRT_PRIORITY_CRITICAL))
      rememberFailure("adjustment");
  }

  void demote() noexcept {
    if (task_ && AvRevertMmThreadCharacteristics(task_))
      task_ = nullptr;
  }

  bool registered() const noexcept { return task_ != nullptr; }
  bool available() const noexcept { return registered() || !failedOperation_; }

private:
  void rememberFailure(const char *operation) noexcept {
    error_ = GetLastError();
    failedOperation_ = operation;
  }

  HANDLE task_ = nullptr;
  const char *failedOperation_ = nullptr;
  DWORD error_ = 0;
};

DeviceError classify(HRESULT hr) noexcept {
  if (SUCCEEDED(hr))
    return DeviceError::None;
  std::fprintf(stderr, "WASAPI operation failed (HRESULT 0x%08lX).\n",
               static_cast<unsigned long>(hr));
  if (hr == E_NOTFOUND || hr == HRESULT_FROM_WIN32(ERROR_NOT_FOUND) ||
      hr == AUDCLNT_E_DEVICE_INVALIDATED || hr == AUDCLNT_E_ENDPOINT_CREATE_FAILED)
    return DeviceError::Unavailable;
  if (hr == AUDCLNT_E_DEVICE_IN_USE || hr == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED)
    return DeviceError::Busy;
  if (hr == AUDCLNT_E_UNSUPPORTED_FORMAT)
    return DeviceError::UnsupportedFormat;
  if (hr == E_ACCESSDENIED)
    return DeviceError::Permission;
  return DeviceError::Internal;
}

std::string utf8(const wchar_t *text) {
  const int size =
      WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 1)
    return {};
  std::string result(static_cast<std::size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, result.data(), size, nullptr,
                      nullptr);
  result.pop_back();
  return result;
}

std::wstring wide(const std::string &text) {
  if (text.empty() || text.find('\0') != std::string::npos ||
      text.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
    return {};
  const auto length = static_cast<int>(text.size());
  const int size =
      MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), length, nullptr, 0);
  if (size <= 0)
    return {};
  std::wstring result(static_cast<std::size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), length, result.data(), size);
  return result;
}

EDataFlow flow(DeviceDirection direction) noexcept {
  return direction == DeviceDirection::Output ? eRender : eCapture;
}

std::wstring endpointId(IMMDevice *device) {
  LPWSTR id = nullptr;
  if (FAILED(device->GetId(&id)))
    return {};
  const std::unique_ptr<wchar_t, CoTaskMemory> release(id);
  return id;
}

HRESULT activateAudioClient(IMMDevice *device, ComPtr<IAudioClient> &client) {
  return device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                          reinterpret_cast<void **>(client.ReleaseAndGetAddressOf()));
}

WasapiSampleFormat sampleFormat(const WAVEFORMATEX &format) noexcept {
  auto validBits = format.wBitsPerSample;
  auto tag = format.wFormatTag;
  if (tag == WAVE_FORMAT_EXTENSIBLE &&
      format.cbSize >= sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)) {
    const auto &extended = reinterpret_cast<const WAVEFORMATEXTENSIBLE &>(format);
    validBits = extended.Samples.wValidBitsPerSample;
    if (IsEqualGUID(extended.SubFormat, KSDATAFORMAT_SUBTYPE_PCM))
      tag = WAVE_FORMAT_PCM;
    else if (IsEqualGUID(extended.SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT))
      tag = WAVE_FORMAT_IEEE_FLOAT;
  }
  if ((tag != WAVE_FORMAT_PCM && tag != WAVE_FORMAT_IEEE_FLOAT) || format.wBitsPerSample % 8 ||
      format.nBlockAlign != format.nChannels * (format.wBitsPerSample / 8u))
    return {};
  return {format.wBitsPerSample / 8u, validBits, tag == WAVE_FORMAT_IEEE_FLOAT};
}

std::uint64_t monotonicNs() noexcept {
  LARGE_INTEGER counter{};
  QueryPerformanceCounter(&counter);
  static const auto ticksPerSecond = [] {
    LARGE_INTEGER frequency{};
    QueryPerformanceFrequency(&frequency);
    return static_cast<std::uint64_t>(frequency.QuadPart);
  }();
  const auto ticks = static_cast<std::uint64_t>(counter.QuadPart);
  return ticks / ticksPerSecond * 1000000000u +
         ticks % ticksPerSecond * 1000000000u / ticksPerSecond;
}

class StreamNotification final : public IMMNotificationClient, public IAudioSessionEvents {
public:
  StreamNotification(DeviceCallbacks callbacks, DeviceDirection direction, std::wstring id,
                     bool defaultDevice)
      : callbacks_(callbacks), direction_(direction), id_(std::move(id)), default_(defaultDevice) {}

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void **object) noexcept override {
    if (!object)
      return E_POINTER;
    if (iid == __uuidof(IUnknown) || iid == __uuidof(IMMNotificationClient))
      *object = static_cast<IMMNotificationClient *>(this);
    else if (iid == __uuidof(IAudioSessionEvents))
      *object = static_cast<IAudioSessionEvents *>(this);
    else {
      *object = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() noexcept override { return ++refs_; }
  ULONG STDMETHODCALLTYPE Release() noexcept override {
    const auto remaining = --refs_;
    if (remaining == 0)
      delete this;
    return remaining;
  }

  HRESULT STDMETHODCALLTYPE OnDeviceStateChanged(LPCWSTR id, DWORD state) noexcept override {
    if (matches(id) && state != DEVICE_STATE_ACTIVE)
      notify(DeviceResetReason::Unavailable);
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnDeviceAdded(LPCWSTR) noexcept override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnDeviceRemoved(LPCWSTR id) noexcept override {
    if (matches(id))
      notify(DeviceResetReason::Unavailable);
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnDefaultDeviceChanged(EDataFlow deviceFlow, ERole role,
                                                   LPCWSTR id) noexcept override {
    if (default_ && deviceFlow == flow(direction_) && role == deviceRole && !matches(id))
      notify(DeviceResetReason::DefaultChanged);
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnPropertyValueChanged(LPCWSTR id,
                                                   const PROPERTYKEY key) noexcept override {
    if (matches(id) && IsEqualPropertyKey(key, PKEY_AudioEngine_DeviceFormat))
      notify(DeviceResetReason::FormatChanged);
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnDisplayNameChanged(LPCWSTR, LPCGUID) noexcept override {
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnIconPathChanged(LPCWSTR, LPCGUID) noexcept override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnSimpleVolumeChanged(float, BOOL, LPCGUID) noexcept override {
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnChannelVolumeChanged(DWORD, float[], DWORD,
                                                   LPCGUID) noexcept override {
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnGroupingParamChanged(LPCGUID, LPCGUID) noexcept override {
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnStateChanged(AudioSessionState) noexcept override { return S_OK; }
  HRESULT STDMETHODCALLTYPE
  OnSessionDisconnected(AudioSessionDisconnectReason reason) noexcept override {
    if (reason == DisconnectReasonFormatChanged)
      notify(DeviceResetReason::FormatChanged);
    else if (reason == DisconnectReasonDeviceRemoval)
      notify(DeviceResetReason::Unavailable);
    else
      notify(DeviceResetReason::Interrupted);
    return S_OK;
  }

  void deactivate() noexcept { active_.store(false, std::memory_order_release); }

private:
  bool matches(LPCWSTR id) const noexcept { return id && id_ == id; }
  void notify(DeviceResetReason reason) const noexcept {
    if (active_.load(std::memory_order_acquire) && callbacks_.reset)
      callbacks_.reset(callbacks_.context, direction_, reason);
  }

  std::atomic<ULONG> refs_{1};
  std::atomic<bool> active_{true};
  DeviceCallbacks callbacks_;
  DeviceDirection direction_;
  std::wstring id_;
  bool default_;
};

HRESULT initializeSharedStream(IAudioClient *client, const WAVEFORMATEX *format,
                               DeviceDirection direction, DeviceLatency latency, bool loopback,
                               std::uint64_t &periodNs) {
  const auto flags = static_cast<DWORD>(AUDCLNT_STREAMFLAGS_EVENTCALLBACK) |
                     (loopback ? AUDCLNT_STREAMFLAGS_LOOPBACK : 0u) |
                     (direction == DeviceDirection::Output ? AUDCLNT_STREAMFLAGS_NOPERSIST : 0u);
  // IAudioClient::Initialize supports the nonpersistent playback session flag.
  REFERENCE_TIME defaultPeriod = 0;
  const auto periodResult = client->GetDevicePeriod(&defaultPeriod, nullptr);
  if (FAILED(periodResult))
    return periodResult;
  periodNs = static_cast<std::uint64_t>(defaultPeriod) * 100u;
  // Each period event refills the whole buffer, so capacity beyond one period
  // is the margin for a late render. Requests at or below the engine minimum
  // (about two periods) all leave a single period and make the levels equal.
  const REFERENCE_TIME periods = latency == DeviceLatency::Low    ? 3
                                 : latency == DeviceLatency::High ? 9
                                                                  : 5;
  return client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, periods * defaultPeriod, 0, format,
                            nullptr);
}

class WasapiStream {
public:
  WasapiStream(DeviceCallbacks callbacks, DeviceDirection direction)
      : callbacks_(callbacks), direction_(direction) {}
  ~WasapiStream() { close(); }

  DeviceError open(IMMDeviceEnumerator *enumerator, const DeviceRequest &request,
                   const WasapiStream *output = nullptr) {
    // Resolve the counter frequency before either audio thread can use it.
    (void)monotonicNs();
    enumerator_ = enumerator;
    const bool input = direction_ == DeviceDirection::Input;
    loopback_ = input && request.selection.id == systemAudioId;
    measureClock_ = request.measureClock;
    const bool usingDefault = request.selection.id.empty() || request.selection.id == defaultId;
    ComPtr<IMMDevice> endpoint;
    HRESULT hr;
    if (usingDefault || (loopback_ && request.loopbackEndpointId.empty())) {
      hr = enumerator_->GetDefaultAudioEndpoint(loopback_ ? eRender : flow(direction_), deviceRole,
                                                &endpoint);
    } else {
      const auto id = wide(loopback_ ? request.loopbackEndpointId : request.selection.id);
      if (id.empty())
        return DeviceError::Unavailable;
      hr = enumerator_->GetDevice(id.c_str(), &endpoint);
    }
    if (FAILED(hr))
      return classify(hr);
    id_ = endpointId(endpoint.Get());
    if (id_.empty() || (loopback_ && output && output->id_ == id_))
      return DeviceError::Unavailable;

    ComPtr<IAudioClient> enumerated;
    hr = activateAudioClient(endpoint.Get(), enumerated);
    if (FAILED(hr))
      return classify(hr);
    WAVEFORMATEX *listedMix = nullptr;
    hr = enumerated->GetMixFormat(&listedMix);
    if (FAILED(hr))
      return classify(hr);
    const std::unique_ptr<WAVEFORMATEX, CoTaskMemory> listedFormat(listedMix);
    hr = activateAudioClient(endpoint.Get(), client_);
    if (FAILED(hr))
      return classify(hr);
    WAVEFORMATEX *rawMix = nullptr;
    hr = client_->GetMixFormat(&rawMix);
    if (FAILED(hr))
      return classify(hr);
    const std::unique_ptr<WAVEFORMATEX, CoTaskMemory> mix(rawMix);

    sample_ = sampleFormat(*mix);
    if (mix->nChannels != listedFormat->nChannels || !sample_.supported() ||
        mix->nSamplesPerSec == 0 ||
        !selectDeviceChannels(mix->nChannels, request.selection.channels, channels_))
      return DeviceError::UnsupportedFormat;
    hr = initializeSharedStream(client_.Get(), mix.get(), direction_, request.latency, loopback_,
                                periodNs_);
    if (FAILED(hr))
      return classify(hr);
    event_.reset(CreateEventW(nullptr, FALSE, FALSE, nullptr));
    stopEvent_.reset(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event_ || !stopEvent_)
      return DeviceError::Internal;
    UINT32 buffer = 0;
    REFERENCE_TIME latency = 0;
    hr = client_->SetEventHandle(event_.get());
    if (SUCCEEDED(hr))
      hr = client_->GetBufferSize(&buffer);
    if (SUCCEEDED(hr))
      hr = client_->GetStreamLatency(&latency);
    if (FAILED(hr) || buffer == 0)
      return FAILED(hr) ? classify(hr) : DeviceError::Internal;
    const auto bufferedLatency =
        (static_cast<std::uint64_t>(std::max(latency, REFERENCE_TIME{0})) * mix->nSamplesPerSec +
         9999999u) /
        10000000u;
    format_ = {mix->nSamplesPerSec, mix->nChannels, static_cast<std::uint32_t>(channels_.size()),
               buffer, static_cast<std::uint32_t>(bufferedLatency + (input ? 0u : buffer))};
    planar_.resize(std::size_t(buffer) * channels_.size());
    notifications_.Attach(new StreamNotification(callbacks_, direction_, id_, usingDefault));
    hr = client_->GetService(IID_PPV_ARGS(&sessionControl_));
    if (SUCCEEDED(hr))
      hr = sessionControl_->RegisterAudioSessionNotification(notifications_.Get());
    if (SUCCEEDED(hr))
      sessionRegistered_ = true;
    if (SUCCEEDED(hr))
      hr = enumerator_->RegisterEndpointNotificationCallback(notifications_.Get());
    if (SUCCEEDED(hr))
      endpointRegistered_ = true;
    return classify(hr);
  }

  const DeviceStreamFormat &format() const noexcept { return format_; }

  DeviceError start() {
    if (worker_.joinable())
      return DeviceError::None;
    ResetEvent(stopEvent_.get());
    std::promise<HRESULT> startResult;
    auto status = startResult.get_future();
    worker_ = std::thread([this, result = std::move(startResult)]() mutable { run(result); });
    const HRESULT hr = status.get();
    if (FAILED(hr))
      worker_.join();
    return classify(hr);
  }

  void stop() noexcept {
    if (worker_.joinable()) {
      SetEvent(stopEvent_.get());
      worker_.join();
    }
  }

private:
  void close() noexcept {
    if (notifications_)
      notifications_->deactivate();
    stop();
    if (endpointRegistered_)
      enumerator_->UnregisterEndpointNotificationCallback(notifications_.Get());
    if (sessionRegistered_)
      sessionControl_->UnregisterAudioSessionNotification(notifications_.Get());
  }

  std::span<float> planar(UINT32 frames) noexcept {
    return {planar_.data(), std::size_t(frames) * channels_.size()};
  }

  HRESULT render(IAudioRenderClient *service, IAudioClock *clock, std::uint64_t frequency,
                 UINT32 &frames) noexcept {
    UINT32 padding = 0;
    const auto hr = client_->GetCurrentPadding(&padding);
    if (FAILED(hr))
      return hr;
    if (padding >= format_.periodFrames)
      return S_OK;
    frames = format_.periodFrames - padding;
    BYTE *bytes = nullptr;
    const auto got = service->GetBuffer(frames, &bytes);
    if (FAILED(got))
      return got;
    auto block = planar(frames);
    std::fill(block.begin(), block.end(), 0.0f);
    std::uint64_t deviceNs = 0, devicePosition = 0, qpc = 0;
    if (clock && frequency && clock->GetPosition(&devicePosition, &qpc) == S_OK) {
      const double seconds = static_cast<double>(writtenFrames_) / format_.sampleRate -
                             static_cast<double>(devicePosition) / frequency;
      const double ns = static_cast<double>(qpc) * 100. + seconds * 1.e9;
      if (ns > 0)
        deviceNs = static_cast<std::uint64_t>(ns + .5);
    }
    if (callbacks_.render)
      callbacks_.render(callbacks_.context, block, {}, frames,
                        {position_, monotonicNs(), false, deviceNs});
    position_ += frames;
    writtenFrames_ += frames;
    sample_.silence(bytes, std::size_t(frames) * format_.channels);
    packInterleaved(block, frames, format_.channels, channels_,
                    [&](std::size_t index, float value) {
                      sample_.encode(value, bytes + index * sample_.bytes);
                    });
    return service->ReleaseBuffer(frames, 0);
  }

  HRESULT capture(IAudioCaptureClient *service) noexcept {
    UINT32 available = 0;
    for (;;) {
      auto hr = service->GetNextPacketSize(&available);
      if (FAILED(hr))
        return hr;
      if (available == 0) {
        if (loopback_ && silence_.takeBoundary(monotonicNs(), periodNs_) && callbacks_.capture)
          callbacks_.capture(callbacks_.context, {}, 0, {});
        return S_OK;
      }
      BYTE *bytes = nullptr;
      DWORD flags = 0;
      UINT32 frames = 0;
      UINT64 position = 0, clock100ns = 0;
      hr = service->GetBuffer(&bytes, &frames, &flags, &position, &clock100ns);
      if (FAILED(hr))
        return hr;
      if (frames <= format_.periodFrames && callbacks_.capture) {
        auto block = planar(frames);
        if (flags & AUDCLNT_BUFFERFLAGS_SILENT)
          std::fill(block.begin(), block.end(), 0.0f);
        else
          unpackPlanar(block, frames, format_.channels, channels_, [&](std::size_t index) {
            return sample_.decode(bytes + index * sample_.bytes);
          });
        const bool invalidClock = (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) != 0;
        const auto now = invalidClock ? monotonicNs() : clock100ns * 100u;
        if (invalidClock)
          position = position_;
        callbacks_.capture(callbacks_.context, block, frames,
                           {position, now, (flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) != 0,
                            invalidClock ? 0 : now});
        position_ = position + frames;
        if (loopback_)
          silence_.supplied(monotonicNs());
      }
      hr = service->ReleaseBuffer(frames);
      if (FAILED(hr) || frames > format_.periodFrames)
        return FAILED(hr) ? hr : E_FAIL;
    }
  }

  void run(std::promise<HRESULT> &result) {
    ComThread com;
    ComPtr<IAudioRenderClient> renderService;
    ComPtr<IAudioCaptureClient> captureService;
    ComPtr<IAudioClock> audioClock;
    std::uint64_t frequency = 0;
    HRESULT hr = E_FAIL;
    if (com && direction_ == DeviceDirection::Output) {
      hr = client_->GetService(IID_PPV_ARGS(&renderService));
      if (measureClock_ && SUCCEEDED(client_->GetService(IID_PPV_ARGS(&audioClock))))
        audioClock->GetFrequency(&frequency);
      writtenFrames_ = format_.periodFrames;
      if (SUCCEEDED(hr)) {
        BYTE *buffer = nullptr;
        hr = renderService->GetBuffer(format_.periodFrames, &buffer);
        if (SUCCEEDED(hr))
          hr = renderService->ReleaseBuffer(format_.periodFrames, AUDCLNT_BUFFERFLAGS_SILENT);
      }
    } else if (com) {
      hr = client_->GetService(IID_PPV_ARGS(&captureService));
    }
    AudioThreadPriority priority;
    WasapiRenderPriority renderPriority;
    if (SUCCEEDED(hr))
      hr = client_->Start();
    result.set_value(hr);
    if (SUCCEEDED(hr)) {
      const auto timeout = static_cast<DWORD>(
          loopback_ ? std::max<std::uint64_t>(1, (periodNs_ + 999999) / 1000000)
                    : std::max<std::uint64_t>(2000u, std::uint64_t(format_.periodFrames) * 10000u /
                                                         format_.sampleRate));
      const HANDLE handles[] = {stopEvent_.get(), event_.get()};
      for (;;) {
        const DWORD status = WaitForMultipleObjects(2, handles, FALSE, timeout);
        if (status == WAIT_OBJECT_0)
          break;
        if (status == WAIT_OBJECT_0 + 1 || (loopback_ && status == WAIT_TIMEOUT)) {
          if (renderService) {
            UINT32 frames = 0;
            const auto started = monotonicNs();
            hr = render(renderService.Get(), audioClock.Get(), frequency, frames);
            if (SUCCEEDED(hr) && frames && priority.available()) {
              const auto audioNs = std::uint64_t(frames) * 1'000'000'000 / format_.sampleRate;
              const auto change = renderPriority.observe(monotonicNs() - started, audioNs);
              if (change == WasapiRenderPriority::Change::Demote)
                priority.demote();
              else if (change == WasapiRenderPriority::Change::Restore)
                priority.restore();
              // If Windows kept the MMCSS boost, actually wait between
              // callbacks so a queued render event cannot monopolize a core.
              if (renderPriority.demoted() && priority.registered() &&
                  WaitForSingleObject(stopEvent_.get(), 1) == WAIT_OBJECT_0)
                break;
            }
          } else {
            hr = capture(captureService.Get());
          }
          if (SUCCEEDED(hr))
            continue;
        }
        if (callbacks_.reset) {
          const auto reason = status == WAIT_TIMEOUT && !loopback_ ? DeviceResetReason::Stalled
                              : hr == AUDCLNT_E_DEVICE_INVALIDATED ? DeviceResetReason::Unavailable
                                                                   : DeviceResetReason::StreamError;
          callbacks_.reset(callbacks_.context, direction_, reason);
        }
        break;
      }
      client_->Stop();
      client_->Reset();
    }
  }

  DeviceCallbacks callbacks_;
  DeviceDirection direction_;
  ComPtr<IMMDeviceEnumerator> enumerator_;
  ComPtr<IAudioClient> client_;
  ComPtr<IAudioSessionControl> sessionControl_;
  ComPtr<StreamNotification> notifications_;
  std::unique_ptr<void, WinHandle> event_;
  std::unique_ptr<void, WinHandle> stopEvent_;
  std::vector<std::uint32_t> channels_;
  std::vector<float> planar_;
  std::thread worker_;
  WasapiSampleFormat sample_;
  std::wstring id_;
  std::uint64_t periodNs_{};
  LoopbackSilence silence_;
  bool loopback_{};
  bool measureClock_{};
  std::uint64_t writtenFrames_{};
  DeviceStreamFormat format_;
  std::uint64_t position_{};
  bool endpointRegistered_{};
  bool sessionRegistered_{};
};

class WasapiDevice final : public AudioDevice {
public:
  explicit WasapiDevice(DeviceCallbacks callbacks) : callbacks_(callbacks) {
    if (com_)
      CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                       IID_PPV_ARGS(&enumerator_));
  }

  DeviceError list(DeviceList &result) override {
    if (!enumerator_)
      return DeviceError::Internal;
    result = {"WASAPI", {}, {}};
    auto error = listDirection(eRender, result.outputs);
    if (error == DeviceError::None)
      error = listDirection(eCapture, result.inputs);
    return error;
  }

  DeviceError openOutput(const DeviceRequest &request, DeviceStreamFormat &result) override {
    if (!enumerator_ || output_)
      return DeviceError::Internal;
    auto stream = std::make_unique<WasapiStream>(callbacks_, DeviceDirection::Output);
    const auto error = stream->open(enumerator_.Get(), request);
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
    if (!enumerator_)
      return DeviceError::Internal;
    auto stream = std::make_unique<WasapiStream>(callbacks_, DeviceDirection::Input);
    auto error = stream->open(enumerator_.Get(), *request, output_.get());
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

  void poll() noexcept override {}

private:
  DeviceError listDirection(EDataFlow deviceFlow, std::vector<DeviceInfo> &result) {
    ComPtr<IMMDevice> defaultDevice;
    std::wstring defaultEndpoint;
    if (SUCCEEDED(enumerator_->GetDefaultAudioEndpoint(deviceFlow, deviceRole, &defaultDevice)))
      defaultEndpoint = endpointId(defaultDevice.Get());
    ComPtr<IMMDeviceCollection> devices;
    auto hr = enumerator_->EnumAudioEndpoints(deviceFlow, DEVICE_STATE_ACTIVE, &devices);
    UINT count = 0;
    if (SUCCEEDED(hr))
      hr = devices->GetCount(&count);
    if (FAILED(hr))
      return classify(hr);
    for (UINT i = 0; i < count; ++i) {
      ComPtr<IMMDevice> endpoint;
      ComPtr<IAudioClient> client;
      WAVEFORMATEX *rawMix = nullptr;
      if (FAILED(devices->Item(i, &endpoint)) ||
          FAILED(activateAudioClient(endpoint.Get(), client)) ||
          FAILED(client->GetMixFormat(&rawMix)))
        continue;
      const std::unique_ptr<WAVEFORMATEX, CoTaskMemory> mix(rawMix);
      const auto id = endpointId(endpoint.Get());
      if (id.empty() || mix->nChannels == 0)
        continue;
      auto name = utf8(id.c_str());
      ComPtr<IPropertyStore> store;
      PROPVARIANT value{};
      if (SUCCEEDED(endpoint->OpenPropertyStore(STGM_READ, &store)) &&
          SUCCEEDED(store->GetValue(PKEY_Device_FriendlyName, &value)) && value.vt == VT_LPWSTR)
        name = utf8(value.pwszVal);
      PropVariantClear(&value);
      result.push_back({utf8(id.c_str()), std::move(name), mix->nChannels, id == defaultEndpoint});
    }
    return DeviceError::None;
  }

  DeviceCallbacks callbacks_;
  ComThread com_;
  ComPtr<IMMDeviceEnumerator> enumerator_;
  std::unique_ptr<WasapiStream> output_, input_;
};
} // namespace

std::unique_ptr<AudioDevice> makeWasapiDevice(DeviceCallbacks callbacks) {
  return std::make_unique<WasapiDevice>(callbacks);
}

} // namespace effetune::audio

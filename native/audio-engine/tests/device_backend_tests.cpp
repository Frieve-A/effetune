#include "device/device.h"
#include "device/miniaudio/negotiation.h"
#include "device/planar_buffer.h"
#include "device/wasapi/loopback_silence.h"
#include "device/wasapi/render_priority.h"
#include "device/wasapi/sample_format.h"

#include <array>
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <thread>

namespace {
using namespace effetune::audio;
using namespace std::chrono_literals;

void check(bool condition, const char *message) {
  if (!condition) {
    std::cerr << message << '\n';
    std::exit(1);
  }
}

void formatConversion() {
  LoopbackSilence silence;
  check(!silence.takeBoundary(100, 10), "empty input emitted a boundary");
  silence.supplied(100);
  check(!silence.takeBoundary(115, 10) && !silence.takeBoundary(129, 10),
        "a late loopback packet must not end the burst");
  check(silence.takeBoundary(130, 10) && !silence.takeBoundary(160, 10),
        "silence must emit one boundary per idle interval");
  silence.supplied(170);
  check(silence.takeBoundary(201, 10), "capture did not rearm the silence boundary");
  const std::array formats{WasapiSampleFormat{1, 8, false},  WasapiSampleFormat{2, 16, false},
                           WasapiSampleFormat{3, 24, false}, WasapiSampleFormat{4, 24, false},
                           WasapiSampleFormat{4, 32, false}, WasapiSampleFormat{4, 32, true}};
  for (const auto format : formats) {
    check(format.supported(), "valid PCM format was rejected");
    for (const float sample : {-1.0f, -0.75f, 0.0f, 0.5f}) {
      std::array<std::uint8_t, 4> bytes{};
      format.encode(sample, bytes.data());
      check(format.decode(bytes.data()) == sample, "PCM conversion changed sample level");
    }
    std::array<std::uint8_t, 4> bytes{};
    format.silence(bytes.data(), 1);
    check(format.decode(bytes.data()) == 0.0f, "format silence did not decode to zero");
    format.encode(-2.0f, bytes.data());
    check(format.decode(bytes.data()) == (format.floating ? -2.0f : -1.0f),
          "integer PCM saturates and float PCM passes through");
  }
  check(!WasapiSampleFormat{3, 32, false}.supported(), "invalid PCM precision was accepted");

  std::vector<std::uint32_t> selected;
  check(selectDeviceChannels(32, {}, selected) && selected.size() == 16 && selected.back() == 15,
        "automatic selection must cap application width only");
  check(!selectDeviceChannels(4, std::array{0u, 0u}, selected), "duplicate channel was accepted");
  check(!selectDeviceChannels(4, std::array{4u}, selected), "out-of-range channel was accepted");
  check(selectDeviceChannels(4, std::array{3u, 1u}, selected), "scattered channels were rejected");
  const std::array interleaved{10.0f, 20.0f, 30.0f, 40.0f, 11.0f, 21.0f, 31.0f, 41.0f};
  std::array<float, 4> planar{};
  unpackPlanar(planar, 2, 4, selected, [&](std::size_t at) { return interleaved[at]; });
  check(planar == std::array{40.0f, 41.0f, 20.0f, 21.0f}, "capture channel order is wrong");
  std::array<float, 8> written{};
  packInterleaved(planar, 2, 4, selected,
                  [&](std::size_t at, float value) { written[at] = value; });
  check(written == std::array{0.0f, 20.0f, 0.0f, 40.0f, 0.0f, 21.0f, 0.0f, 41.0f},
        "output selected channels or silence are wrong");
}

void wasapiRenderPriority() {
  using Change = WasapiRenderPriority::Change;
  constexpr auto block = 10'000'000u;
  WasapiRenderPriority priority;
  check(priority.observe(block * 20, block) == Change::None,
        "one slow render must retain priority");
  for (int i = 0; i < 10; ++i)
    check(priority.observe(block / 2, block) == Change::None,
          "a transient followed by headroom must retain priority");
  for (int i = 0; i < 20; ++i) {
    const auto work = i % 2 ? 8'900'000u : 9'100'000u;
    check(priority.observe(work, block) == (i == 19 ? Change::Demote : Change::None),
          "jitter around the sustained load threshold must demote once");
  }
  check(priority.demoted(), "sustained load must relinquish multimedia priority");
  for (int i = 0; i < 90; ++i)
    check(priority.observe(block / 2, block) == Change::None,
          "brief headroom must not reacquire multimedia priority");
  for (int i = 0; i < 10; ++i)
    check(priority.observe(block, block) == Change::None,
          "renewed contention must reset recovery without demoting twice");
  for (int i = 0; i < 100; ++i)
    check(priority.observe(block / 2, block) == (i == 99 ? Change::Restore : Change::None),
          "one second of headroom must restore multimedia priority");
  check(!priority.demoted(), "restored render priority must handle later overload");
  check(priority.observe(0, 0) == Change::None, "empty wakes do not carry audio");
  int demotions = 0;
  for (int i = 0; i < 20; ++i) {
    const auto work = i % 2 ? block / 5 : block * 2;
    if (priority.observe(work, block) == Change::Demote)
      ++demotions;
  }
  check(priority.demoted() && demotions == 1,
        "alternating bursts beyond the audio budget must demote again");
}

void negotiation() {
  using namespace miniaudio;
  const auto config = deviceConfig(ma_device_type_playback, DeviceLatency::Low);
  check(config.playback.format == ma_format_f32 && config.capture.format == ma_format_f32 &&
            config.noFixedSizedCallback && config.noClip && config.noPreSilencedOutputBuffer &&
            config.alsa.noAutoResample && config.alsa.noAutoChannels && !config.alsa.noAutoFormat &&
            !config.coreaudio.allowNominalSampleRateChange,
        "device must only permit sample-format conversion");
  ma_device_info device{};
  device.nativeDataFormatCount = 4;
  device.nativeDataFormats[0] = {ma_format_f32, 8, 44100, 0};
  device.nativeDataFormats[1] = {ma_format_s16, 8, 48000, 0};
  device.nativeDataFormats[2] = {ma_format_f32, 8, 96000, 0};
  device.nativeDataFormats[3] = {ma_format_f32, 2, 88200, 0};
  check(listChannels(device) == 8, "ALSA exact native channel count is wrong");
  check(selectAlsaRate(device, 8, 48000) == 48000, "ALSA must prefer an exact rate");
  check(selectAlsaRate(device, 8, 88200) == 96000, "ALSA must prefer the next compatible rate");
  check(selectAlsaRate(device, 8, 192000) == 96000, "ALSA must offer its highest compatible rate");
  device.nativeDataFormats[0] = {ma_format_unknown, 0, 0, 0};
  check(listChannels(device) == 2 && selectAlsaRate(device, 2, 192000) == 192000,
        "ALSA conversion-layer defaults must open as stereo at the requested rate");

  using enum Negotiation;
  check(verifyNegotiatedFormat(8, {8, 8, 48000, 48000}) == Accept,
        "sample-format-only conversion must pass");
  check(verifyNegotiatedFormat(8, {2, 2, 48000, 48000}) == Reject,
        "negotiated channel count must match the listing");
  check(verifyNegotiatedFormat(8, {8, 8, 44100, 48000, false, true, true}) == RetryAtInternalRate,
        "negotiated rate mismatch should retry once at the actual rate");
  check(verifyNegotiatedFormat(8, {8, 8, 48000, 48000, false, true, true}) == Reject &&
            verifyNegotiatedFormat(8, {8, 8, 48000, 48000, true}) == Reject,
        "active channel remapping, rate conversion or buffering must fail");
}

struct Progress {
  std::atomic<unsigned> output{}, input{}, errors{}, resets{};
};

bool waitFor(const std::atomic<unsigned> &value, unsigned minimum) {
  const auto deadline = std::chrono::steady_clock::now() + 3s;
  while (value.load() < minimum && std::chrono::steady_clock::now() < deadline)
    std::this_thread::sleep_for(2ms);
  return value.load() >= minimum;
}

void miniaudioNull() {
  Progress progress;
  DeviceCallbacks callbacks{
      &progress,
      [](void *context, std::span<float> samples, std::span<const float> synchronous,
         std::uint32_t frames, DeviceClock clock) noexcept {
        auto &state = *static_cast<Progress *>(context);
        if (samples.size() != frames || !synchronous.empty() || clock.timeNs == 0)
          ++state.errors;
        std::fill(samples.begin(), samples.end(), 0.25f);
        ++state.output;
      },
      [](void *context, std::span<const float> samples, std::uint32_t frames,
         DeviceClock clock) noexcept {
        auto &state = *static_cast<Progress *>(context);
        if (samples.size() != frames || clock.timeNs == 0 ||
            std::any_of(samples.begin(), samples.end(),
                        [](float sample) { return sample != 0.0f; }))
          ++state.errors;
        ++state.input;
      },
      [](void *context, DeviceDirection, DeviceResetReason) noexcept {
        ++static_cast<Progress *>(context)->resets;
      },
  };
  auto device = makeMiniaudioDevice(callbacks, true);
  DeviceList listing;
  check(device->list(listing) == DeviceError::None && !listing.outputs.empty() &&
            !listing.inputs.empty(),
        "miniaudio null device listing failed");
  const DeviceRequest output{{listing.outputs.front().id, {1}}, 48000, DeviceLatency::Low};
  const DeviceRequest input{{listing.inputs.front().id, {0}}, 44100, DeviceLatency::Low};
  DeviceStreamFormat playback, capture;
  check(device->openOutput(output, playback) == DeviceError::None && playback.sampleRate == 48000 &&
            playback.channels == 2 && playback.selectedChannels == 1 && playback.periodFrames > 0,
        "miniaudio null playback negotiated the wrong format");
  check(device->start() == DeviceError::None && waitFor(progress.output, 3),
        "playback did not start");
  check(device->replaceInput(&input, capture) == DeviceError::None && capture.sampleRate == 44100 &&
            capture.channels == 2 && capture.selectedChannels == 1 && !capture.synchronousInput &&
            waitFor(progress.input, 3),
        "asynchronous capture did not attach");
  check(device->replaceInput(nullptr, capture) == DeviceError::None && capture.sampleRate == 0,
        "capture could not be detached");
  const auto captured = progress.input.load();
  const auto rendered = progress.output.load();
  check(waitFor(progress.output, rendered + 3) && progress.input == captured,
        "capture continued or playback stopped after capture detach");
  check(device->replaceInput(&input, capture) == DeviceError::None,
        "capture could not be reattached");
  device->poll();
  device->stop();
  const auto stopped = progress.output.load();
  check(waitFor(progress.input, progress.input.load() + 3), "capture stopped with playback");
  check(progress.output == stopped && progress.errors == 0 && progress.resets == 0,
        "a stopped device delivered callbacks, bad data or an unexpected reset");
  check(device->start() == DeviceError::None && waitFor(progress.output, stopped + 3),
        "playback could not restart");
  const DeviceRequest loopback{{systemAudioId, {}}, 44100, DeviceLatency::Balanced};
  check(device->replaceInput(&loopback, capture) == DeviceError::Unavailable,
        "miniaudio must reject the Windows loopback endpoint");
  device->close();
}

} // namespace

int main() {
  formatConversion();
  wasapiRenderPriority();
  negotiation();
  miniaudioNull();
}

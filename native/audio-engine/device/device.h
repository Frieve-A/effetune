#pragma once

#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace effetune::audio {

enum class DeviceDirection { Output, Input };
enum class DeviceResetReason {
  Unavailable,
  DefaultChanged,
  FormatChanged,
  Rerouted,
  Stopped,
  Interrupted,
  StreamError,
  Stalled,
};
enum class DeviceError { None, Unavailable, Busy, UnsupportedFormat, Permission, Internal };
enum class DeviceLatency { Low, Balanced, High };
inline constexpr char systemAudioId[] = "system-audio";

inline std::string_view deviceErrorName(DeviceError value) {
  switch (value) {
  case DeviceError::Unavailable:
    return "unavailable";
  case DeviceError::Permission:
    return "permission";
  case DeviceError::Busy:
    return "busy";
  case DeviceError::UnsupportedFormat:
    return "unsupportedFormat";
  default:
    return "internal";
  }
}

struct DeviceInfo {
  std::string id;
  std::string name;
  std::uint32_t channels{};
  bool isDefault{};
};

struct DeviceList {
  std::string backend;
  std::vector<DeviceInfo> outputs;
  std::vector<DeviceInfo> inputs;
};

struct DeviceSelection {
  std::string id{"default"};
  std::vector<std::uint32_t> channels;
};

struct DeviceRequest {
  DeviceSelection selection;
  std::uint32_t pipelineRate{48000};
  DeviceLatency latency{DeviceLatency::Balanced};
  bool measureClock{};
  std::string loopbackEndpointId{};
};

struct DeviceStreamFormat {
  std::uint32_t sampleRate{};
  std::uint32_t channels{};
  std::uint32_t selectedChannels{};
  std::uint32_t periodFrames{};
  std::uint32_t latencyFrames{};
  bool synchronousInput{};
};

struct DeviceClock {
  std::uint64_t position{};
  std::uint64_t timeNs{};
  bool discontinuity{};
  std::uint64_t deviceTimeNs{};
};

struct DeviceCallbacks {
  void *context{};
  // Each planar span stores one contiguous frames-sized range per channel.
  void (*render)(void *, std::span<float>, std::span<const float>, std::uint32_t,
                 DeviceClock) noexcept {};
  void (*capture)(void *, std::span<const float>, std::uint32_t, DeviceClock) noexcept {};
  // Reset notifications can arrive from a backend provider or audio thread.
  void (*reset)(void *, DeviceDirection, DeviceResetReason) noexcept {};
};

class AudioDevice {
public:
  virtual ~AudioDevice() = default;

  virtual DeviceError list(DeviceList &result) = 0;
  virtual DeviceError openOutput(const DeviceRequest &request, DeviceStreamFormat &result) = 0;
  // Capture lifetime follows selection independently of the output stream.
  virtual DeviceError replaceInput(const DeviceRequest *request, DeviceStreamFormat &result) = 0;
  virtual DeviceError start() = 0;
  virtual void stop() noexcept = 0;
  virtual void close() noexcept = 0;
  virtual void poll() noexcept = 0;
};

std::unique_ptr<AudioDevice> makeWasapiDevice(DeviceCallbacks callbacks);
std::unique_ptr<AudioDevice> makeMiniaudioDevice(DeviceCallbacks callbacks,
                                                 bool useTestNull = false);

} // namespace effetune::audio

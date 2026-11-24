#pragma once
#include "device/device.h"
#include "host/resampler.h"
#include <atomic>
#include <optional>

namespace effetune::audio {
// Device callbacks only copy samples. The control owner converts complete buffers.
class Measurement {
public:
  enum class State { Open, Ready, Running, Complete, Failed };
  void configure(unsigned rate, const DeviceStreamFormat &out, const DeviceStreamFormat &in);
  void cancel() noexcept;
  bool begin(unsigned excitationFrames, unsigned captureFrames, bool loop, float peak,
             unsigned tail);
  bool chunk(unsigned offset, std::span<const std::uint8_t> interleaved);
  bool start();
  void render(std::span<float> output, unsigned frames, DeviceClock clock) noexcept;
  void capture(std::span<const float> input, unsigned frames, DeviceClock clock) noexcept;
  void interrupt() noexcept;
  void deviceReset() noexcept { deviceLost_.store(true); }
  void beginDeviceSession() noexcept { deviceLost_.store(false); }
  std::span<const float> read(unsigned offset, unsigned frames);
  std::optional<double> playbackStartFrame() const noexcept;
  bool deviceLost() const noexcept { return deviceLost_.load(); }
  State state() const noexcept { return deviceLost() ? State::Failed : state_.load(); }
  bool overloadStopped() const noexcept { return overloaded_.load(); }
  float takePeak() noexcept { return peak_.exchange(0); }
  unsigned sampleRate() const noexcept { return rate_; }

private:
  void waitForCallbacks() const noexcept;
  unsigned rate_ = 0;
  DeviceStreamFormat out_{}, in_{};
  std::optional<Resampler> toOutput_, fromInput_;
  std::vector<float> source_, output_, captured_, recording_;
  std::size_t sourceFrames_{}, sourceStride_{}, uploaded_{}, outputFrames_{}, outputStride_{},
      captureFrames_{}, loopWarmup_{};
  std::size_t outputPosition_{}, capturePosition_{}, leadFrames_{}, overloadTail_{}, stopAt_{};
  float threshold_{};
  bool loop_{}, converted_{};
  std::optional<std::uint64_t> expectedInput_, expectedOutput_;
  std::atomic<unsigned> callbacks_{0};
  std::atomic<State> state_{State::Open};
  std::atomic<bool> deviceLost_{false};
  std::atomic<float> peak_{0};
  std::atomic<bool> overloaded_{false};
  std::atomic<std::uint64_t> outputNs_{0}, inputNs_{0};
};
} // namespace effetune::audio

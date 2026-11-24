#pragma once

#include "device/device.h"
#include "host/file_fifo.h"
#include "host/session.h"
#include "measurement.h"
#include <array>
#include <atomic>
#include <chrono>
#include <deque>
#include <functional>

namespace effetune::audio {
class DeviceHost {
public:
  explicit DeviceHost(std::string_view backend, bool muteOutput = false);
  ~DeviceHost();
  FileFifo file;
  Session session;
  DeviceList list();
  DeviceError openMeasurement(unsigned rate, const std::string &outputId, unsigned channels,
                              const std::string &inputId, std::vector<unsigned> indices,
                              unsigned deviceRate, unsigned captureRate, bool synchronous);
  void closeMeasurement() noexcept;
  bool measuring() const noexcept { return measuring_.load(); }
  Measurement measurement;
  std::span<const unsigned> measurementIndices() const noexcept { return measurementIndices_; }
  bool physical() const noexcept { return device_ != nullptr; }
  bool running() const noexcept { return running_; }
  void beginAsset() noexcept {
    assetDeadline_ = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  }
  void endAsset() noexcept { assetDeadline_.reset(); }
  bool assetBusy() const noexcept { return assetDeadline_.has_value(); }
  DeviceError open(SessionFormat &format, const std::string &output, const std::string &input,
                   DeviceLatency latency, const std::string &loopbackEndpointId = {});
  DeviceError start();
  void stop() noexcept;
  void stall() noexcept;
  void close() noexcept;
  void poll() noexcept;
  // Request ownership without blocking. Continue polling timers and input while
  // the callback ramps to silence. A stopped device transfers immediately.
  bool acquire() noexcept;
  void release() noexcept;
  bool submit(std::function<void(Session &)> action);
  bool submit(std::function<void(Session &)> action, std::function<void()> finish);
  void finishCommands();
  void waitForOutput(unsigned branch, std::function<bool(const OutputStage &)> ready,
                     std::function<void()> finish);
  bool commandsSettled() const noexcept {
    return written_.load(std::memory_order_acquire) == consumed_.load(std::memory_order_acquire);
  }
  DeviceError replaceInput(const std::string &id, DeviceLatency latency,
                           const std::string &loopbackEndpointId = {});
  DeviceError recover(bool inputOnly);
  DeviceError recoverReset(int reasons);
  bool resetTestDevice(unsigned sampleRate, unsigned channels, std::string_view unavailableId,
                       bool loseInput);
  unsigned endpointEpoch(unsigned branch) const { return endpointEpochs_.at(branch); }
  bool startParallel(bool selectB);
  bool rebuilt() const noexcept { return rebuilt_; }
  unsigned recoveryId() const noexcept { return pendingRecovery_; }
  bool releaseRecovery(unsigned id, std::function<void()> released);
  bool readTestOutput(unsigned &frames, float &peak);
  bool setTestInput(float level);
  int takeReset() noexcept { return reset_.exchange(0, std::memory_order_acq_rel); }
  const DeviceStreamFormat &outputFormat() const noexcept { return output_; }
  const DeviceStreamFormat &inputFormat() const noexcept { return input_; }
  struct ClockSnapshot {
    std::uint64_t timeNs, pipelineFrame, feedDelay, feedUnderruns, captureUnderruns;
    double converterDelay, captureRatio;
    unsigned captureState, feedTarget, captureTarget;
  };
  bool clock(ClockSnapshot &out) const noexcept;
  std::uint64_t discontinuities() const noexcept { return discontinuities_.load(); }
  std::uint64_t callbackOverruns() const noexcept {
    return overruns_.load(std::memory_order_relaxed);
  }
  DeviceError inputError() const noexcept { return inputError_; }

private:
  enum class Owner { Audio, Requested, Control, Returned };
  static void render(void *, std::span<float>, std::span<const float>, unsigned,
                     DeviceClock) noexcept;
  static void capture(void *, std::span<const float>, unsigned, DeviceClock) noexcept;
  static void reset(void *, DeviceDirection, DeviceResetReason) noexcept;
  void renderOutput(std::span<float>, std::span<const float>, unsigned, DeviceClock) noexcept;
  void applyCommands() noexcept;
  std::unique_ptr<AudioDevice> device_;
  std::atomic<bool> measuring_{false};
  std::vector<unsigned> measurementIndices_;
  DeviceStreamFormat output_{}, input_{};
  DeviceError inputError_ = DeviceError::None;
  SessionFormat requested_;
  std::string outputId_, inputId_, loopbackEndpointId_;
  DeviceLatency latency_ = DeviceLatency::Balanced;
  bool reopening_ = false, rebuilt_ = false;
  bool openedOnce_ = false;
  std::array<unsigned, 2> endpointEpochs_{};
  unsigned lastRecovery_ = 0, pendingRecovery_ = 0;
  std::atomic<Owner> owner_{Owner::Control};
  std::atomic<int> reset_{0};
  std::atomic<bool> captureReady_{false};
  // Control owns this gate while playback is stopped. Capture callbacks only
  // try it once.
  std::atomic<bool> captureBusy_{true};
  std::atomic<std::uint64_t> captureGeneration_{0};
  // Producer overwrites each slot only after the audio consumer has returned
  // it.
  std::array<std::function<void(Session &)>, 64> commands_;
  std::deque<std::pair<std::uint64_t, std::function<void()>>> completions_;
  struct OutputWait {
    unsigned branch;
    std::function<bool(const OutputStage &)> ready;
    std::function<void()> finish;
  };
  std::vector<OutputWait> outputWaits_;
  std::atomic<std::uint64_t> written_{0}, consumed_{0};
  std::uint64_t reclaimed_ = 0;
  std::atomic<std::uint64_t> clockSequence_{0}, timeNs_{0}, position_{0}, feedDelay_{0},
      feedUnderruns_{0}, captureUnderruns_{0}, discontinuities_{0}, overruns_{0};
  std::atomic<double> converterDelay_{0}, captureRatio_{1};
  std::atomic<unsigned> captureState_{0}, feedTarget_{0}, captureTarget_{0};
  bool running_ = false, resumeAfterStall_ = false;
  const bool muteOutput_;
  std::chrono::steady_clock::time_point deadline_{};
  std::optional<std::chrono::steady_clock::time_point> assetDeadline_;
};
} // namespace effetune::audio

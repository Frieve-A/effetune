#include "realtime_null.h"
#include <algorithm>
#include <atomic>
#include <bit>
#include <chrono>
#include <cmath>
#include <thread>
namespace effetune::audio {
namespace {
class RealtimeNull final : public AudioDevice {
public:
  explicit RealtimeNull(DeviceCallbacks callbacks) : callbacks_(callbacks) {}
  ~RealtimeNull() override { close(); }
  DeviceError list(DeviceList &devices) override {
    devices = {"null",
               {{outputId_, "Null output", availableChannels_, true}},
               {{"null-in", "Null input", 16, true}}};
    return DeviceError::None;
  }
  DeviceError openOutput(const DeviceRequest &request, DeviceStreamFormat &format) override {
    if (rate_)
      return DeviceError::Busy;
    if (request.selection.id != "default" && request.selection.id != outputId_)
      return DeviceError::Unavailable;
    rate_ = nextRate_ ? nextRate_ : request.pipelineRate;
    channels_ = request.selection.channels.empty()
                    ? 2u
                    : static_cast<unsigned>(request.selection.channels.size());
    const unsigned latency = request.latency == DeviceLatency::Low    ? 5u
                             : request.latency == DeviceLatency::High ? 40u
                                                                      : 10u;
    frames_ = std::max(1u, rate_ * latency / 1000);
    format = {rate_, availableChannels_, channels_, frames_, frames_, false};
    buffer_.resize(std::size_t(frames_) * channels_);
    captureBuffer_.resize(std::size_t(frames_) * 2);
    return DeviceError::None;
  }
  DeviceError replaceInput(const DeviceRequest *request, DeviceStreamFormat &format) override {
    if (request && (inputUnavailable_ ||
                    (request->selection.id != "default" && request->selection.id != "null-in")))
      return DeviceError::Unavailable;
    format =
        request ? DeviceStreamFormat{rate_, 16, 2, frames_, frames_, false} : DeviceStreamFormat{};
    capture_.store(request != nullptr);
    return DeviceError::None;
  }
  DeviceError start() override {
    if (!rate_)
      return DeviceError::Unavailable;
    if (worker_.joinable())
      return DeviceError::None;
    stopRequested_.store(false);
    worker_ = std::thread([this] {
      using Clock = std::chrono::steady_clock;
      auto deadline = Clock::now();
      const auto period = std::chrono::nanoseconds(std::uint64_t(frames_) * 1000000000 / rate_);
      while (!stopRequested_.load()) {
        const auto now = Clock::now();
        const auto ns =
            std::chrono::duration_cast<std::chrono::nanoseconds>(now.time_since_epoch()).count();
        const DeviceClock clock{position_, static_cast<std::uint64_t>(ns), false};
        if (capture_.load()) {
          std::fill(captureBuffer_.begin(), captureBuffer_.end(), level_.load());
          callbacks_.capture(callbacks_.context, captureBuffer_, frames_, clock);
        }
        callbacks_.render(callbacks_.context, buffer_, {}, frames_, clock);
        float peak = 0;
        for (float value : buffer_)
          peak = std::max(peak, std::abs(value));
        auto previous = meter_.load();
        for (;;) {
          const auto total = std::min<std::uint64_t>(UINT32_MAX, (previous >> 32) + frames_);
          const auto high = std::max(peak, std::bit_cast<float>(static_cast<unsigned>(previous)));
          if (meter_.compare_exchange_weak(previous, total << 32 | std::bit_cast<unsigned>(high)))
            break;
        }
        position_ += frames_;
        deadline += period;
        if (deadline < now)
          deadline = now + period;
        std::this_thread::sleep_until(deadline);
      }
    });
    return DeviceError::None;
  }
  void stop() noexcept override {
    if (worker_.joinable()) {
      stopRequested_.store(true);
      worker_.join();
    }
  }
  void close() noexcept override {
    stop();
    rate_ = frames_ = channels_ = 0;
    position_ = 0;
    buffer_.clear();
    capture_.store(false);
  }
  void poll() noexcept override {}
  void readOutput(unsigned &frames, float &peak) {
    auto value = meter_.exchange(0);
    frames = static_cast<unsigned>(value >> 32);
    peak = std::bit_cast<float>(static_cast<unsigned>(value));
  }
  bool setInput(float level) {
    if (!(level >= 0 && level <= 1))
      return false;
    level_.store(level);
    return true;
  }
  bool reset(unsigned rate, unsigned channels, std::string_view unavailable, bool loseInput) {
    if ((rate && (rate < 8000 || rate > 384000)) || channels > 16 ||
        (!unavailable.empty() && unavailable != outputId_))
      return false;
    if (rate)
      nextRate_ = rate;
    if (channels)
      availableChannels_ = channels;
    if (!unavailable.empty())
      outputId_ = "null-replacement";
    inputUnavailable_ = loseInput;
    callbacks_.reset(callbacks_.context, DeviceDirection::Output,
                     unavailable.empty() ? DeviceResetReason::FormatChanged
                                         : DeviceResetReason::Unavailable);
    return true;
  }

private:
  DeviceCallbacks callbacks_;
  std::string outputId_ = "null-out";
  bool inputUnavailable_ = false;
  unsigned nextRate_ = 0, availableChannels_ = 16;
  std::thread worker_;
  std::atomic<bool> stopRequested_{false};
  unsigned rate_ = 0, channels_ = 0, frames_ = 0;
  std::uint64_t position_ = 0;
  std::vector<float> buffer_, captureBuffer_;
  std::atomic<bool> capture_{false};
  std::atomic<float> level_{0};
  std::atomic<std::uint64_t> meter_{0};
};
} // namespace
std::unique_ptr<AudioDevice> makeRealtimeNull(DeviceCallbacks callbacks) {
  return std::make_unique<RealtimeNull>(callbacks);
}
bool resetRealtimeNull(AudioDevice *device, unsigned sampleRate, unsigned channels,
                       std::string_view unavailableId, bool loseInput) {
  auto *test = dynamic_cast<RealtimeNull *>(device);
  return test && test->reset(sampleRate, channels, unavailableId, loseInput);
}
bool readRealtimeNullOutput(AudioDevice *device, unsigned &frames, float &peak) {
  auto *test = dynamic_cast<RealtimeNull *>(device);
  if (test)
    test->readOutput(frames, peak);
  return test != nullptr;
}
bool setRealtimeNullInput(AudioDevice *device, float level) {
  auto *test = dynamic_cast<RealtimeNull *>(device);
  return test && test->setInput(level);
}
} // namespace effetune::audio

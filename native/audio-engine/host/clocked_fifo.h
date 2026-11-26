#pragma once

#include "host/resampler.h"
#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <optional>

namespace effetune::audio {

enum class FifoState { idle, priming, running };

// Single producer (capture or stdin) and single audio consumer. Opening a
// session resets the consumer only; the producer can keep writing meanwhile.
class ClockedFifo {
public:
  ClockedFifo(unsigned maxChannels, std::size_t capacityFrames);
  // Clock for write arrivalNs and read nowNs; only live FIFOs use them.
  static std::uint64_t nowNs() noexcept {
    return std::chrono::duration_cast<std::chrono::nanoseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
  }
  bool write(const float *planar, unsigned channels, std::size_t frames, std::uint64_t generation,
             std::uint64_t sourceFrame, std::uint64_t arrivalNs = 0) noexcept;
  void flush(std::uint64_t generation) noexcept;
  void silence(std::uint64_t generation, std::optional<std::uint64_t> first = {}) noexcept;
  // A live FIFO carries device input: it follows packet arrival times and drops
  // input that is already stale when playback of it starts.
  void open(unsigned channels, unsigned inputRate, unsigned outputRate, std::size_t targetFrames,
            bool live = false);
  // Both producer and consumer must be stopped when restarting the capture clock.
  void restartCapture() noexcept;
  void read(float *planar, std::size_t stride, std::size_t frames,
            std::uint64_t nowNs = 0) noexcept;
  FifoState state() const noexcept { return state_; }
  std::size_t queued() const noexcept;
  std::size_t target() const noexcept { return target_; }
  std::uint64_t overflows() const noexcept { return overflows_.load(std::memory_order_relaxed); }
  std::uint64_t gaps() const noexcept { return gaps_.load(std::memory_order_relaxed); }
  std::uint64_t backwardGaps() const noexcept {
    return backwardGaps_.load(std::memory_order_relaxed);
  }
  std::uint64_t lastGapExpected() const noexcept {
    return lastExpected_.load(std::memory_order_relaxed);
  }
  std::uint64_t lastGapReceived() const noexcept {
    return lastReceived_.load(std::memory_order_relaxed);
  }
  std::uint64_t underruns() const noexcept { return underruns_; }
  double inputPerOutput() const noexcept { return resampler_->inputPerOutput(); }
  double delayInputFrames() const noexcept { return resampler_->delayInputFrames(); }
  double sourceFrame() const noexcept { return sourceFrame_; }
  double sourceStep() const noexcept { return sourceStep_; }

private:
  void resetReader() noexcept;
  void discardBuffered() noexcept;
  void beginFade() noexcept;
  void applyFade(float *planar, std::size_t stride, std::size_t frames) noexcept;
  const unsigned maxChannels_;
  const std::size_t capacity_;
  std::vector<float> pcm_;
  std::vector<std::uint8_t> silenceMarks_;
  std::vector<std::uint64_t> positions_;
  struct PacketEnd {
    std::size_t frames = 0;
    std::uint64_t arrivalNs = 0;
  };
  std::unique_ptr<PacketEnd[]> packetEnds_;
  std::atomic<PacketEnd *> producerPacketEnds_{nullptr};
  std::atomic<std::uint64_t> write_{0}, read_{0}, discardBefore_{0}, overflows_{0}, gaps_{0};
  std::atomic<std::uint64_t> resetSerial_{0};
  std::atomic<std::uint64_t> backwardGaps_{0}, lastExpected_{0}, lastReceived_{0};
  // Producer fields.
  std::uint64_t generation_ = 0;
  std::optional<std::uint64_t> expected_;
  // Consumer fields.
  std::optional<Resampler> resampler_;
  std::uint64_t scan_ = 0, underruns_ = 0, seenReset_ = 0;
  std::size_t target_ = 0, tail_ = 0;
  unsigned channels_ = 0, outputRate_ = 0, fadeLength_ = 0, fadeLeft_ = 0;
  double nominal_ = 1, correction_ = 0, sourceFrame_ = 0, sourceStep_ = 1, inputRate_ = 0;
  bool live_ = false;
  FifoState state_ = FifoState::idle;
  std::array<float, 16> last_{}, fadeFrom_{};
  std::vector<float> zero_;
};

} // namespace effetune::audio

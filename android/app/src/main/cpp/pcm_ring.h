#ifndef EFFETUNE_ANDROID_PCM_RING_H
#define EFFETUNE_ANDROID_PCM_RING_H

#include <array>
#include <atomic>
#include <cstdint>

namespace effetune::android {

// One decoder producer and one audio consumer. Source changes invalidate queued
// frames without resetting a counter owned by another thread.
template <std::uint32_t Capacity> class PcmRing {
public:
  std::uint64_t beginSource() noexcept { return generation_.fetch_add(1) + 1; }
  std::uint32_t write(const float *stereo, std::uint32_t frames,
                      std::uint64_t generation) noexcept {
    if (generation != generation_.load(std::memory_order_acquire))
      return 0;
    const auto write = write_.load(std::memory_order_relaxed);
    const auto read = read_.load(std::memory_order_acquire);
    const auto available = Capacity - (write - read);
    if (frames > available)
      frames = available;
    for (std::uint32_t i = 0; i < frames; ++i) {
      auto &frame = frames_[(write + i) % Capacity];
      frame.left = stereo[i * 2];
      frame.right = stereo[i * 2 + 1];
      frame.generation = generation;
    }
    write_.store(write + frames, std::memory_order_release);
    return frames;
  }
  std::uint32_t read(float *planar, std::uint32_t frames, bool playing,
                     float gain = 1) noexcept {
    auto read = read_.load(std::memory_order_relaxed);
    const auto write = write_.load(std::memory_order_acquire);
    const auto generation = generation_.load(std::memory_order_acquire);
    std::uint32_t copied = 0;
    while (read != write) {
      const auto &frame = frames_[read % Capacity];
      if (frame.generation != generation) {
        ++read;
        continue;
      }
      if (!playing || copied == frames)
        break;
      planar[copied] += frame.left * gain;
      planar[frames + copied] += frame.right * gain;
      ++copied;
      ++read;
    }
    read_.store(read, std::memory_order_release);
    return copied;
  }
  std::uint32_t queued() const noexcept {
    const auto read = read_.load(std::memory_order_acquire);
    return write_.load(std::memory_order_acquire) - read;
  }

private:
  struct Frame {
    float left = 0, right = 0;
    std::uint64_t generation = 0;
  };
  std::array<Frame, Capacity> frames_{};
  std::atomic<std::uint32_t> write_{0}, read_{0};
  std::atomic<std::uint64_t> generation_{1};
};

} // namespace effetune::android
#endif

#ifndef EFFETUNE_ANDROID_PCM_RING_H
#define EFFETUNE_ANDROID_PCM_RING_H

#include <array>
#include <atomic>
#include <cstdint>
#include <vector>

namespace effetune::android {

// One decoder producer and one audio consumer. Source changes invalidate queued
// frames without resetting a counter owned by another thread.
template <std::uint32_t Capacity> class PcmRing {
public:
  // Called once, on control, before either endpoint starts.
  void setChannels(unsigned channels) {
    extraChannels_ = channels > 2 ? channels - 2 : 0;
    extra_.resize(std::size_t(Capacity) * extraChannels_);
  }
  unsigned channels() const { return 2 + extraChannels_; }
  std::uint64_t beginSource() noexcept { return generation_.fetch_add(1) + 1; }
  int writableFrames(std::uint64_t generation) const noexcept {
    if (generation != generation_.load(std::memory_order_acquire))
      return -1;
    return static_cast<int>(Capacity - queued());
  }
  std::uint32_t write(const float *pcm, std::uint32_t frames,
                      std::uint64_t generation) noexcept {
    return extraChannels_ ? writeFrames<true>(pcm, frames, generation)
                          : writeFrames<false>(pcm, frames, generation);
  }
  std::uint32_t read(float *planar, std::uint32_t frames, bool playing,
                     float gain = 1) noexcept {
    return extraChannels_ ? readFrames<true>(planar, frames, playing, gain)
                          : readFrames<false>(planar, frames, playing, gain);
  }
  std::uint32_t queued() const noexcept {
    const auto read = read_.load(std::memory_order_acquire);
    return write_.load(std::memory_order_acquire) - read;
  }

private:
  template <bool Wide>
  std::uint32_t writeFrames(const float *pcm, std::uint32_t frames, std::uint64_t generation) noexcept {
    if (generation != generation_.load(std::memory_order_acquire))
      return 0;
    const auto write = write_.load(std::memory_order_relaxed);
    const auto read = read_.load(std::memory_order_acquire);
    const auto available = Capacity - (write - read);
    if (frames > available)
      frames = available;
    for (std::uint32_t i = 0; i < frames; ++i) {
      auto &frame = frames_[(write + i) % Capacity];
      const auto *source = pcm + i * (Wide ? channels() : 2);
      frame.left = source[0];
      frame.right = source[1];
      if constexpr (Wide)
        for (unsigned ch = 0; ch < extraChannels_; ++ch)
          extra_[((write + i) % Capacity) * extraChannels_ + ch] = source[ch + 2];
      frame.generation = generation;
    }
    write_.store(write + frames, std::memory_order_release);
    return frames;
  }
  template <bool Wide>
  std::uint32_t readFrames(float *planar, std::uint32_t frames, bool playing, float gain) noexcept {
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
      if constexpr (Wide)
        for (unsigned ch = 0; ch < extraChannels_; ++ch)
          planar[(ch + 2) * frames + copied] += extra_[(read % Capacity) * extraChannels_ + ch] * gain;
      ++copied;
      ++read;
    }
    read_.store(read, std::memory_order_release);
    return copied;
  }
  struct Frame {
    float left = 0, right = 0;
    std::uint64_t generation = 0;
  };
  std::array<Frame, Capacity> frames_{};
  unsigned extraChannels_ = 0;
  std::vector<float> extra_;
  std::atomic<std::uint32_t> write_{0}, read_{0};
  std::atomic<std::uint64_t> generation_{1};
};

} // namespace effetune::android
#endif

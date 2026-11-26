#ifndef EFFETUNE_ANDROID_FINITE_CAPTURE_H
#define EFFETUNE_ANDROID_FINITE_CAPTURE_H

#include "pcm_ring.h"
#include <atomic>
#include <cstdint>
#include <thread>
#include <vector>

namespace effetune::android {
// A bounded exchange between the audio callback and one file-I/O worker.
// Construction, joining and descriptor release belong to control.
class FiniteCapture {
public:
  // overloadPeak > 0 stops the capture overloadTailFrames after the selected input
  // (0 left, 1 right, 2 mean of both) first reaches that magnitude.
  FiniteCapture(int excitationFd, int resultFd, std::uint32_t excitationFrames,
                std::uint32_t captureFrames, float overloadPeak = 0,
                std::uint32_t overloadTailFrames = 0, int inputChannel = 0,
                unsigned outputChannels = 2);
  ~FiniteCapture();
  FiniteCapture(const FiniteCapture &) = delete;
  void process(const float *microphone, std::uint32_t microphoneFrames,
               float *output, std::uint32_t frames) noexcept;
  void invalidate() {
    int running = 1;
    status_.compare_exchange_strong(running, 3);
  }
  int status() const { return status_.load(); }
  void outputClipped() { status_.store(4); }
  std::uint32_t frames() const { return captured_.load(); }

private:
  void transfer() noexcept;
  int excitationFd_ = -1, resultFd_ = -1;
  std::uint32_t excitationFrames_, captureFrames_;
  float overloadPeak_;
  std::uint32_t overloadTail_;
  int inputChannel_;
  const unsigned outputChannels_;
  static constexpr unsigned capacity = 65536;
  std::vector<float> excitation_;
  std::atomic<std::uint32_t> loaded_{0};
  PcmRing<capacity> recording_;
  std::atomic<std::uint32_t> end_;
  std::atomic<int> status_{1};
  std::atomic<std::uint32_t> captured_{0};
  std::atomic<bool> stopping_{false};
  std::thread worker_;
};
} // namespace effetune::android
#endif

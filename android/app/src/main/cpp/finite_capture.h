#ifndef EFFETUNE_ANDROID_FINITE_CAPTURE_H
#define EFFETUNE_ANDROID_FINITE_CAPTURE_H

#include "pcm_ring.h"
#include <atomic>
#include <cstdint>
#include <thread>

namespace effetune::android {
// A bounded exchange between the audio callback and one file-I/O worker.
// Construction, joining and descriptor release belong to control.
class FiniteCapture {
public:
  FiniteCapture(int excitationFd, int resultFd, std::uint32_t excitationFrames,
                std::uint32_t captureFrames);
  ~FiniteCapture();
  FiniteCapture(const FiniteCapture &) = delete;
  void process(const float *microphone, std::uint32_t microphoneFrames,
               float *output, std::uint32_t frames) noexcept;
  void invalidate() {
    int running = 1;
    status_.compare_exchange_strong(running, 3);
  }
  int status() const { return status_.load(); }
  std::uint32_t frames() const { return captured_.load(); }

private:
  void transfer() noexcept;
  int excitationFd_ = -1, resultFd_ = -1;
  std::uint32_t excitationFrames_, captureFrames_;
  PcmRing<65536> excitation_, recording_;
  std::atomic<int> status_{1};
  std::atomic<std::uint32_t> captured_{0};
  std::atomic<bool> stopping_{false};
  std::thread worker_;
};
} // namespace effetune::android
#endif

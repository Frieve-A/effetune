#include "finite_capture.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <stdexcept>
#include <sys/stat.h>
#include <unistd.h>

namespace effetune::android {
FiniteCapture::FiniteCapture(int excitationFd, int resultFd, std::uint32_t excitationFrames,
                             std::uint32_t captureFrames, float overloadPeak,
                             std::uint32_t overloadTailFrames, int inputChannel, unsigned outputChannels)
    : excitationFrames_(excitationFrames), captureFrames_(captureFrames),
      overloadPeak_(overloadPeak), overloadTail_(std::max(1u, overloadTailFrames)),
      inputChannel_(inputChannel), outputChannels_(outputChannels), end_(captureFrames) {
  struct stat excitationInfo{}, resultInfo{};
  if (outputChannels < 2 || outputChannels > 16 || excitationFrames == 0 || captureFrames < excitationFrames ||
      !(overloadPeak >= 0 && overloadPeak <= 1) || inputChannel < 0 || inputChannel > 2 ||
      fstat(excitationFd, &excitationInfo) || fstat(resultFd, &resultInfo) ||
      !S_ISREG(excitationInfo.st_mode) || !S_ISREG(resultInfo.st_mode) ||
      excitationInfo.st_size != static_cast<std::int64_t>(excitationFrames) * outputChannels * static_cast<int>(sizeof(float)))
    throw std::invalid_argument("Invalid finite capture files");
  excitation_.resize(std::size_t(capacity) * outputChannels);
  excitationFd_ = dup(excitationFd);
  resultFd_ = dup(resultFd);
  if (excitationFd_ < 0 || resultFd_ < 0 ||
      ftruncate(resultFd_, static_cast<off_t>(captureFrames) * 8)) {
    if (excitationFd_ >= 0)
      close(excitationFd_);
    if (resultFd_ >= 0)
      close(resultFd_);
    throw std::runtime_error("Cannot prepare finite capture files");
  }
  try {
    worker_ = std::thread(&FiniteCapture::transfer, this);
  } catch (...) {
    close(excitationFd_);
    close(resultFd_);
    throw;
  }
}

FiniteCapture::~FiniteCapture() {
  stopping_.store(true);
  worker_.join();
  close(excitationFd_);
  close(resultFd_);
}

void FiniteCapture::process(const float *microphone, std::uint32_t microphoneFrames, float *output,
                            std::uint32_t frames) noexcept {
  std::fill_n(output, frames * outputChannels_, 0.0F);
  if (status_.load() != 1)
    return;
  const auto captured = captured_.load(std::memory_order_relaxed);
  const auto end = end_.load(std::memory_order_relaxed);
  if (captured >= end)
    return;
  auto count = std::min(frames, end - captured);
  const auto excitationCount =
      captured < excitationFrames_ ? std::min(count, excitationFrames_ - captured) : 0;
  if (microphoneFrames < count || (excitationCount && loaded_.load(std::memory_order_acquire) < captured + excitationCount)) {
    if (captured != 0)
      status_.store(3);
    return;
  }
  if (overloadPeak_ > 0 && end == captureFrames_) {
    for (std::uint32_t i = 0; i < count; ++i) {
      const float *frame = microphone + static_cast<std::size_t>(i) * 2;
      const float sample =
          inputChannel_ == 2 ? 0.5F * (frame[0] + frame[1]) : frame[inputChannel_];
      if (sample >= overloadPeak_ || -sample >= overloadPeak_) {
        // Keep a short tail after the overload, then finish early like the desktop engine.
        const auto stop = static_cast<std::uint64_t>(captured) + i + overloadTail_;
        if (stop < end) {
          end_.store(static_cast<std::uint32_t>(stop), std::memory_order_relaxed);
          count = std::min(count, static_cast<std::uint32_t>(stop) - captured);
        }
        break;
      }
    }
  }
  if (recording_.write(microphone, count, 1) != count) {
    status_.store(3);
    return;
  }
  for (unsigned i = 0; i < std::min(count, excitationCount); ++i) {
    const float *source = excitation_.data() + ((captured + i) % capacity) * outputChannels_;
    for (unsigned ch = 0; ch < outputChannels_; ++ch) output[ch * frames + i] = source[ch];
  }
  captured_.store(captured + count, std::memory_order_release);
}

void FiniteCapture::transfer() noexcept {
  std::array<float, 8192> planar{}, interleaved{};
  std::uint32_t readFrames = 0, writtenFrames = 0;
  while (!stopping_.load() && status_.load() == 1) {
    if (readFrames < excitationFrames_ && readFrames - captured_.load(std::memory_order_acquire) <= capacity - 4096) {
      const unsigned index = readFrames % capacity;
      const auto count = std::min({4096u, excitationFrames_ - readFrames, capacity - index});
      const auto size = std::size_t(count) * outputChannels_ * sizeof(float);
      auto *samples = excitation_.data() + std::size_t(index) * outputChannels_;
      if (pread(excitationFd_, samples, size, static_cast<off_t>(readFrames) * outputChannels_ * sizeof(float)) !=
          static_cast<ssize_t>(size)) {
        status_.store(3);
        break;
      }
      for (std::uint32_t i = 0; i < count * outputChannels_; ++i) {
        if (!std::isfinite(samples[i]) || samples[i] < -1 || samples[i] > 1) {
          status_.store(3);
          return;
        }
      }
      readFrames += count;
      loaded_.store(readFrames, std::memory_order_release);
    }
    std::fill(planar.begin(), planar.end(), 0.0F);
    const auto count = recording_.read(planar.data(), 4096, true);
    if (count != 0) {
      for (std::uint32_t i = 0; i < count; ++i) {
        interleaved[i * 2] = planar[i];
        interleaved[i * 2 + 1] = planar[4096 + i];
      }
      const auto size = static_cast<std::size_t>(count) * 8;
      if (pwrite(resultFd_, interleaved.data(), size, static_cast<off_t>(writtenFrames) * 8) !=
          static_cast<ssize_t>(size)) {
        status_.store(3);
        break;
      }
      writtenFrames += count;
      // end_ is stored before the ring write that publishes the final frames.
      if (writtenFrames == end_.load(std::memory_order_relaxed)) {
        const auto finished = fsync(resultFd_) == 0 ? 2 : 3;
        int running = 1;
        status_.compare_exchange_strong(running, finished);
        break;
      }
    }
    if (count == 0)
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
}
} // namespace effetune::android

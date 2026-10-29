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
                             std::uint32_t captureFrames)
    : excitationFrames_(excitationFrames), captureFrames_(captureFrames) {
  struct stat excitationInfo{}, resultInfo{};
  if (excitationFrames == 0 || captureFrames < excitationFrames ||
      fstat(excitationFd, &excitationInfo) || fstat(resultFd, &resultInfo) ||
      !S_ISREG(excitationInfo.st_mode) || !S_ISREG(resultInfo.st_mode) ||
      excitationInfo.st_size != static_cast<std::int64_t>(excitationFrames) * 8)
    throw std::invalid_argument("Invalid finite capture files");
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
  std::fill_n(output, frames * 2, 0.0F);
  if (status_.load() != 1)
    return;
  const auto captured = captured_.load(std::memory_order_relaxed);
  if (captured == captureFrames_)
    return;
  const auto count = std::min(frames, captureFrames_ - captured);
  const auto excitationCount =
      captured < excitationFrames_ ? std::min(count, excitationFrames_ - captured) : 0;
  if (microphoneFrames < count || excitation_.queued() < excitationCount) {
    if (captured != 0)
      status_.store(3);
    return;
  }
  if (recording_.write(microphone, count, 1) != count) {
    status_.store(3);
    return;
  }
  // read() uses the requested planar stride. The trailing output is already zero.
  excitation_.read(output, frames, true);
  captured_.store(captured + count, std::memory_order_release);
}

void FiniteCapture::transfer() noexcept {
  std::array<float, 8192> excitation{}, planar{}, interleaved{};
  std::uint32_t readFrames = 0, writtenFrames = 0;
  while (!stopping_.load() && status_.load() == 1) {
    if (readFrames < excitationFrames_ && excitation_.queued() <= 65536 - 4096) {
      const auto count = std::min(4096u, excitationFrames_ - readFrames);
      const auto size = static_cast<std::size_t>(count) * 8;
      if (pread(excitationFd_, excitation.data(), size, static_cast<off_t>(readFrames) * 8) !=
          static_cast<ssize_t>(size)) {
        status_.store(3);
        break;
      }
      for (std::uint32_t i = 0; i < count * 2; ++i) {
        if (!std::isfinite(excitation[i]) || excitation[i] < -1 || excitation[i] > 1) {
          status_.store(3);
          return;
        }
      }
      readFrames += excitation_.write(excitation.data(), count, 1);
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
      if (writtenFrames == captureFrames_) {
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

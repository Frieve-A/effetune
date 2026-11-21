#include "host/clocked_fifo.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace effetune::audio {

ClockedFifo::ClockedFifo(unsigned maxChannels, std::size_t capacityFrames)
    : maxChannels_(maxChannels), capacity_(capacityFrames) {
  if (!maxChannels || maxChannels > 16 || capacityFrames < 4 ||
      capacityFrames > std::numeric_limits<std::size_t>::max() / maxChannels)
    throw std::invalid_argument("Unsupported audio FIFO size");
  pcm_.resize(maxChannels * capacityFrames);
  silenceMarks_.resize(capacityFrames);
  positions_.resize(capacityFrames);
}

void ClockedFifo::flush(std::uint64_t generation) noexcept {
  if (generation <= generation_)
    return;
  generation_ = generation;
  expected_.reset();
  discardBefore_.store(write_.load(std::memory_order_relaxed), std::memory_order_release);
  resetSerial_.fetch_add(1, std::memory_order_release);
}

bool ClockedFifo::write(const float *planar, unsigned channels, std::size_t frames,
                        std::uint64_t generation, std::uint64_t sourceFrame) noexcept {
  if (!frames || !channels || channels > maxChannels_ || !planar || generation < generation_)
    return false;
  flush(generation);
  const auto end = write_.load(std::memory_order_relaxed);
  const auto used = end - read_.load(std::memory_order_acquire);
  // Reserve a slot for the end of this burst even when PCM fills the FIFO.
  if (frames >= capacity_ - used) {
    overflows_.fetch_add(1, std::memory_order_relaxed);
    return false;
  }
  if (expected_ && *expected_ != sourceFrame) {
    lastExpected_.store(*expected_, std::memory_order_relaxed);
    lastReceived_.store(sourceFrame, std::memory_order_relaxed);
    if (sourceFrame < *expected_)
      backwardGaps_.fetch_add(1, std::memory_order_relaxed);
    gaps_.fetch_add(1, std::memory_order_relaxed);
    discardBefore_.store(end, std::memory_order_release);
    resetSerial_.fetch_add(1, std::memory_order_release);
  }
  for (std::size_t offset = 0; offset < frames;) {
    const auto index = static_cast<std::size_t>((end + offset) % capacity_);
    const auto count = std::min(frames - offset, capacity_ - index);
    for (unsigned ch = 0; ch < maxChannels_; ++ch) {
      auto *dest = pcm_.data() + ch * capacity_ + index;
      if (ch < channels)
        std::copy_n(planar + ch * frames + offset, count, dest);
      else
        std::fill_n(dest, count, 0);
    }
    std::fill_n(silenceMarks_.data() + index, count, 0);
    for (std::size_t i = 0; i < count; ++i)
      positions_[index + i] = sourceFrame + offset + i;
    offset += count;
  }
  expected_ = sourceFrame + frames;
  write_.store(end + frames, std::memory_order_release);
  return true;
}

void ClockedFifo::silence(std::uint64_t generation, std::optional<std::uint64_t> first) noexcept {
  if (generation < generation_)
    return;
  flush(generation);
  if (!expected_ && !first)
    return;
  const auto end = write_.load(std::memory_order_relaxed);
  if (end - read_.load(std::memory_order_acquire) >= capacity_)
    return;
  positions_[end % capacity_] = first.value_or(expected_.value_or(0));
  silenceMarks_[end % capacity_] = 1;
  write_.store(end + 1, std::memory_order_release);
  expected_.reset();
}

void ClockedFifo::open(unsigned channels, unsigned inputRate, unsigned outputRate,
                       std::size_t targetFrames) {
  if (channels > maxChannels_ || !targetFrames || targetFrames >= capacity_)
    throw std::invalid_argument("Invalid FIFO reader configuration");
  resampler_.emplace(channels, inputRate, outputRate, true);
  channels_ = channels;
  outputRate_ = outputRate;
  nominal_ = resampler_->inputPerOutput();
  target_ = targetFrames;
  zero_.assign(static_cast<std::size_t>(2 * resampler_->delayInputFrames()), 0);
  fadeLength_ = std::max(1u, outputRate / 1000);
  discardBuffered();
}

void ClockedFifo::restartCapture() noexcept {
  expected_.reset();
  discardBuffered();
}

void ClockedFifo::discardBuffered() noexcept {
  fadeLeft_ = 0;
  last_.fill(0);
  seenReset_ = resetSerial_.load(std::memory_order_acquire);
  scan_ = write_.load(std::memory_order_acquire);
  read_.store(scan_, std::memory_order_release);
  sourceFrame_ = 0;
  resetReader();
}

void ClockedFifo::resetReader() noexcept {
  resampler_->reset();
  tail_ = 0;
  correction_ = 0;
  state_ = FifoState::idle;
}

void ClockedFifo::beginFade() noexcept {
  fadeFrom_ = last_;
  fadeLeft_ = fadeLength_;
}

void ClockedFifo::applyFade(float *planar, std::size_t stride, std::size_t frames) noexcept {
  const auto count = std::min<std::size_t>(frames, fadeLeft_);
  for (unsigned ch = 0; ch < channels_; ++ch) {
    float *channel = planar + ch * stride;
    for (std::size_t i = 0; i < count; ++i) {
      const float gain = static_cast<float>(fadeLeft_ - i) / fadeLength_;
      channel[i] += gain * (fadeFrom_[ch] - channel[i]);
    }
    if (frames)
      last_[ch] = channel[frames - 1];
  }
  fadeLeft_ -= static_cast<unsigned>(count);
}

std::size_t ClockedFifo::queued() const noexcept {
  const auto cursor = read_.load(std::memory_order_acquire);
  return static_cast<std::size_t>(write_.load(std::memory_order_acquire) - cursor);
}

void ClockedFifo::read(float *planar, std::size_t stride, std::size_t frames) noexcept {
  for (unsigned ch = 0; ch < channels_; ++ch)
    std::fill_n(planar + ch * stride, frames, 0);
  auto cursor = read_.load(std::memory_order_relaxed);
  const auto end = write_.load(std::memory_order_acquire);
  const auto serial = resetSerial_.load(std::memory_order_acquire);
  const auto discard = discardBefore_.load(std::memory_order_acquire);
  if (seenReset_ != serial) {
    seenReset_ = serial;
    cursor = scan_ = std::max(cursor, discard);
    beginFade();
    resetReader();
  }
  // Scan each slot once to locate the next explicit silence boundary.
  while (scan_ < end && !silenceMarks_[scan_ % capacity_])
    ++scan_;
  const bool ending = scan_ < end;
  const auto available = scan_ - cursor;
  if (ending && !available && state_ != FifoState::running) {
    sourceFrame_ = double(positions_[cursor % capacity_]);
    scan_ = ++cursor;
    resetReader();
  }
  if (state_ == FifoState::idle && available)
    state_ = FifoState::priming;
  if (state_ == FifoState::priming && (available >= target_ || ending)) {
    state_ = FifoState::running;
    beginFade();
  }
  std::size_t produced = 0;
  sourceStep_ = nominal_;
  if (state_ == FifoState::priming && available) {
    sourceStep_ = 0.;
    sourceFrame_ = double(positions_[cursor % capacity_]) - resampler_->delayInputFrames();
  }
  if (state_ == FifoState::running) {
    const double error = (static_cast<double>(available) - target_) / target_;
    const double alpha = std::min(1.0, 2.0 * frames / outputRate_);
    correction_ += alpha * (std::clamp(0.01 * error, -0.002, 0.002) - correction_);
    resampler_->setCorrection(correction_);
    sourceStep_ = resampler_->inputPerOutput();
    while (cursor < scan_ && produced < frames) {
      const auto index = static_cast<std::size_t>(cursor % capacity_);
      const auto count = std::min<std::size_t>(scan_ - cursor, capacity_ - index);
      const auto result = resampler_->process(pcm_.data() + index, capacity_, count,
                                              planar + produced, stride, frames - produced);
      cursor += result.consumed;
      produced += result.produced;
      if (result.consumed)
        sourceFrame_ = static_cast<double>(positions_[index + result.consumed - 1] + 1) +
                       resampler_->nextInputOffset() - resampler_->delayInputFrames();
      else
        sourceFrame_ += result.produced * sourceStep_;
    }
    if (produced < frames && ending) {
      if (!tail_)
        tail_ = zero_.size();
      const auto result =
          resampler_->process(zero_.data(), 0, tail_, planar + produced, stride, frames - produced);
      tail_ -= result.consumed;
      sourceFrame_ += result.produced * sourceStep_;
      produced += result.produced;
      if (!tail_) {
        scan_ = ++cursor;
        resetReader();
      }
    }
  }
  applyFade(planar, stride, produced);
  if (produced < frames && state_ == FifoState::running && !ending) {
    ++underruns_;
    beginFade();
    resetReader();
    state_ = FifoState::priming;
  }
  applyFade(planar + produced, stride, frames - produced);
  sourceFrame_ += sourceStep_ * (frames - produced);
  read_.store(cursor, std::memory_order_release);
}

} // namespace effetune::audio

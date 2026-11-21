#include "host/network_output.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace effetune::audio {
namespace {
unsigned outputCapacity(unsigned inputRate, unsigned maxFrames) {
  if (inputRate < 8000 || inputRate > 384000 || !maxFrames || maxFrames > 32768)
    throw std::invalid_argument("Invalid network output format");
  return static_cast<unsigned>(
             std::ceil(double(maxFrames) * NetworkPacket::sampleRate / inputRate)) +
         2;
}
std::int16_t quantize(float value) noexcept {
  if (!std::isfinite(value))
    return 0;
  const double sample = std::clamp(value, -1.f, 1.f);
  return static_cast<std::int16_t>(std::floor(sample * (sample < 0 ? 32768. : 32767.) + 0.5));
}
} // namespace

NetworkSender::NetworkSender(unsigned sampleRate, unsigned maxFrames)
    : sampleRate_(sampleRate), maxFrames_(maxFrames),
      maxConverted_(outputCapacity(sampleRate, maxFrames)),
      converter_(2, sampleRate, NetworkPacket::sampleRate), input_(2 * maxFrames_),
      converted_(2 * maxConverted_) {}

void NetworkSender::setAttached(bool attached) noexcept {
  attached_ = attached;
  sending_ = false;
  ++epoch_;
  sourceFrame_ = fill_ = outstanding_ = 0;
  credits_.fill({});
  converter_.reset();
}

void NetworkSender::stopSending() noexcept {
  if (sending_)
    ++epoch_;
  sending_ = false;
  sourceFrame_ = fill_ = 0;
}

void NetworkSender::acknowledge(std::uint64_t epoch, std::uint64_t frame) noexcept {
  for (auto &item : credits_)
    if (item.used && item.epoch == epoch && item.frame == frame) {
      item.used = false;
      --outstanding_;
      return;
    }
}

void NetworkSender::render(const float *left, const float *right, unsigned frames,
                           std::uint64_t contextFrame, std::uint64_t revision,
                           bool sendAllowed) noexcept {
  if (!attached_ || !sendAllowed || outstanding_ == capacity || frames > maxFrames_) {
    stopSending();
    return;
  }
  if (!sending_) {
    sending_ = true;
    converter_.reset();
    nextContextFrame_ = static_cast<double>(contextFrame) - converter_.delayInputFrames();
    origin_ = contextFrame;
  }
  std::copy_n(left, frames, input_.data());
  std::copy_n(right ? right : left, frames, input_.data() + maxFrames_);
  const auto result = converter_.process(input_.data(), maxFrames_, frames, converted_.data(),
                                         maxConverted_, maxConverted_);
  const double step = converter_.inputPerOutput();
  for (std::size_t i = 0; i < result.produced; ++i, nextContextFrame_ += step) {
    if (nextContextFrame_ < static_cast<double>(origin_))
      continue;
    const auto cursor = write_.load(std::memory_order_relaxed);
    if (outstanding_ == capacity || cursor - read_.load(std::memory_order_acquire) == capacity) {
      stopSending();
      return;
    }
    auto &packet = packets_[cursor % capacity];
    if (!fill_) {
      packet.sourceEpoch = epoch_;
      packet.sourceFrame = sourceFrame_;
      packet.contextFrame = nextContextFrame_;
      packet.contextFrameStep = step;
      packet.contextSampleRate = sampleRate_;
      packet.routeRevision = revision;
    }
    packet.routeRevisionEnd = revision;
    packet.pcm[2 * fill_] = quantize(converted_[i]);
    packet.pcm[2 * fill_ + 1] = quantize(converted_[maxConverted_ + i]);
    if (++fill_ == NetworkPacket::frames) {
      for (auto &item : credits_)
        if (!item.used) {
          item = {true, epoch_, sourceFrame_};
          break;
        }
      ++outstanding_;
      sourceFrame_ += fill_;
      fill_ = 0;
      write_.store(cursor + 1, std::memory_order_release);
    }
  }
}

bool NetworkSender::pop(NetworkPacket &packet) noexcept {
  const auto cursor = read_.load(std::memory_order_relaxed);
  if (cursor == write_.load(std::memory_order_acquire))
    return false;
  packet = packets_[cursor % capacity];
  read_.store(cursor + 1, std::memory_order_release);
  return true;
}

VisualizerStage visualizerStage(bool localDelayActive, bool visualSync, bool sendMarker,
                                bool receiveActive) noexcept {
  if (!localDelayActive)
    return VisualizerStage::pipeline;
  if (!visualSync)
    return VisualizerStage::local;
  return sendMarker && !receiveActive ? VisualizerStage::send : VisualizerStage::network;
}

NetworkLocalDelay::NetworkLocalDelay(unsigned sampleRate, unsigned channels)
    : channels_(channels), length_(sampleRate * 8 + 1) {
  if (!channels || channels > 16 || sampleRate < 8000 || sampleRate > 384000)
    throw std::invalid_argument("Invalid local delay format");
  ring_.resize(static_cast<std::size_t>(length_) * channels_);
}

void NetworkLocalDelay::set(bool active, unsigned samples) noexcept {
  const Target target{active, active ? std::min(samples, length_ - 1) : 0};
  if (!active_ && active) {
    active_ = true;
    index_ = current_ = 0;
    written_ = 0;
  }
  if (transition_) {
    pending_ = target;
  } else if (active_ && (target.samples != current_ || !active)) {
    transition_ = target;
    progress_ = 0;
  }
}

void NetworkLocalDelay::process(float *planar, unsigned frames) noexcept {
  if (!active_)
    return;
  constexpr unsigned ramp = 256;
  for (unsigned ch = 0; ch < channels_; ++ch) {
    auto *channel = planar + ch * frames;
    auto *ring = ring_.data() + ch * length_;
    auto write = index_;
    for (unsigned i = 0; i < frames; ++i) {
      ring[write] = channel[i];
      const auto delayed = [&](unsigned delay) {
        return ring[write >= delay ? write - delay : write + length_ - delay];
      };
      float sample = delayed(current_);
      if (transition_) {
        const unsigned delay = transition_->samples;
        const auto filled = written_ + i + 1;
        const float available =
            delay == 0 ? 1.f
            : filled <= delay
                ? 0.f
                : static_cast<float>(std::min<std::uint64_t>(ramp, filled - delay)) / ramp;
        const float mix = static_cast<float>(std::min(ramp, progress_ + i + 1)) / ramp;
        sample += (available * delayed(delay) - sample) * mix;
      }
      channel[i] = sample;
      if (++write == length_)
        write = 0;
    }
  }
  index_ = (index_ + frames) % length_;
  written_ = std::min<std::uint64_t>(length_ + ramp, written_ + frames);
  if (!transition_)
    return;
  progress_ = std::min(ramp, progress_ + frames);
  if (progress_ < ramp || (transition_->samples && written_ < transition_->samples + ramp))
    return;
  current_ = transition_->samples;
  active_ = transition_->active;
  transition_.reset();
  if (pending_) {
    const auto next = *pending_;
    pending_.reset();
    set(next.active, next.samples);
  }
}

void NetworkLocalGain::process(float *planar, unsigned channels, unsigned frames,
                               bool enabled) noexcept {
  const float target = enabled ? 1.f : 0.f;
  if (gain_ == 1 && enabled)
    return;
  for (unsigned i = 0; i < frames; ++i) {
    gain_ += std::clamp(target - gain_, -1.f / 256, 1.f / 256);
    for (unsigned ch = 0; ch < channels; ++ch)
      planar[ch * frames + i] *= gain_;
  }
}
} // namespace effetune::audio

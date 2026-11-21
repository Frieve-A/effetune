#include "output_stage.h"
#include <algorithm>

namespace effetune::audio {
void OutputStage::open(unsigned sampleRate, unsigned channels) {
  // Keep the renderer Visual Sync range (half a second) ready at open.
  capacity_ = (sampleRate + 1) / 2;
  channels_ = channels;
  transitionFrames_ = std::max(1u, sampleRate / 100);
  recoveryHeld_ = false;
  recoveryRamp_ = 0;
  ring_.resize(std::size_t(channels) * capacity_);
  desired_ = current_ = write_ = valid_ = left_ = gateFrames_ = 0;
  gate_ = gain_ = target_ = 1;
  applied_.store(0);
  completedGain_.store(1);
  ready_.store(true);
  topologyGain_ = 1;
  phase_ = Phase::open;
  topologyReady_.store(true);
  holdLimit_ = 3 * sampleRate;
}
void OutputStage::gateRecovery(float *audio, float *marker, float *parallel,
                               unsigned frames) noexcept {
  if (!recoveryHeld_ && !recoveryRamp_)
    return;
  const auto count = recoveryHeld_ ? frames : std::min(frames, recoveryRamp_);
  for (unsigned i = 0; i < count; ++i) {
    const float gain =
        recoveryHeld_ ? 0.f : float(transitionFrames_ - recoveryRamp_--) / transitionFrames_;
    for (unsigned ch = 0; ch < channels_; ++ch) {
      audio[ch * frames + i] *= gain;
      if (parallel)
        parallel[ch * frames + i] *= gain;
    }
    if (marker) {
      marker[i] *= gain;
      marker[frames + i] *= gain;
    }
  }
}
void OutputStage::closeTopology() noexcept {
  if (phase_ != Phase::closed)
    phase_ = Phase::closing;
  topologyReady_.store(false, std::memory_order_release);
}
void OutputStage::resetHistory() noexcept {
  write_ = valid_ = 0;
  gateFrames_ = 0;
  current_ = desired_;
  applied_.store(current_);
  gate_ = 1;
  ready_.store(true);
  topologyGain_ = 1;
  phase_ = Phase::open;
  topologyReady_.store(true);
  elapsed_ = holdFrames_ = 0;
}
void OutputStage::settleTopology() noexcept {
  elapsed_ = holdFrames_ = 0;
  topologyGain_ = 0;
  phase_ = Phase::settling;
}
void OutputStage::gateTopology(float *audio, float *marker, float *parallel, unsigned frames,
                               unsigned latency, bool hold) noexcept {
  if (phase_ == Phase::open)
    return;
  const float step = 1.f / transitionFrames_;
  const unsigned settling = latency + desired_;
  for (unsigned i = 0; i < frames; ++i) {
    if (phase_ == Phase::closing) {
      topologyGain_ = std::max(0.f, topologyGain_ - step);
      if (topologyGain_ == 0)
        phase_ = Phase::closed;
    } else if (phase_ == Phase::settling) {
      if (hold && holdFrames_ < holdLimit_) {
        ++holdFrames_;
        elapsed_ = 0;
      } else if (elapsed_ >= settling)
        phase_ = Phase::opening;
      else
        ++elapsed_;
    }
    if (phase_ == Phase::opening) {
      topologyGain_ = std::min(1.f, topologyGain_ + step);
      if (topologyGain_ == 1) {
        phase_ = Phase::open;
        topologyReady_.store(true, std::memory_order_release);
      }
    }
    for (unsigned ch = 0; ch < channels_; ++ch) {
      audio[ch * frames + i] *= topologyGain_;
      if (parallel)
        parallel[ch * frames + i] *= topologyGain_;
    }
    if (marker) {
      marker[i] *= topologyGain_;
      marker[frames + i] *= topologyGain_;
    }
  }
}
void OutputStage::fade(float gain, unsigned frames) noexcept {
  target_ = gain;
  left_ = frames;
  step_ = frames ? (target_ - gain_) / frames : 0;
  if (!frames)
    gain_ = target_;
  completedGain_.store(frames ? -1.f : gain_);
}
void OutputStage::delay(unsigned samples, bool running) noexcept {
  if (samples > capacity_ || samples == desired_)
    return;
  desired_ = samples;
  if (!running) {
    current_ = desired_;
    applied_.store(current_);
    write_ = valid_ = 0;
    gateFrames_ = 0;
    gate_ = 1;
    ready_.store(true);
  } else {
    gateFrames_ = transitionFrames_;
    ready_.store(false);
  }
}
void OutputStage::process(float *audio, float *marker, unsigned frames, bool useDelay,
                          const float *wetHistory) noexcept {
  if (!current_ && ready_.load(std::memory_order_relaxed) && !left_ && gain_ == 1)
    return;
  for (unsigned i = 0; i < frames; ++i) {
    const float gain = gate_ * gain_;
    for (unsigned ch = 0; ch < channels_; ++ch) {
      auto &sample = audio[ch * frames + i];
      if (current_ && useDelay) {
        auto &previous = ring_[std::size_t(ch) * capacity_ + write_];
        const float value = previous;
        previous = wetHistory ? wetHistory[ch * frames + i] : sample;
        if (!wetHistory)
          sample = valid_ >= current_ ? value : 0;
      }
      sample *= gain;
    }
    if (current_ && useDelay) {
      if (++write_ == current_)
        write_ = 0;
      if (valid_ < current_)
        ++valid_;
    }
    if (marker) {
      marker[i] *= gain;
      marker[frames + i] *= gain;
    }
    if (left_) {
      gain_ += step_;
      if (!--left_) {
        gain_ = target_;
        completedGain_.store(gain_);
      }
    }
    if (gateFrames_) {
      const bool closing = current_ != desired_;
      gate_ += ((closing ? 0.f : 1.f) - gate_) / gateFrames_;
      if (!--gateFrames_) {
        if (closing) {
          current_ = desired_;
          write_ = valid_ = 0;
          gate_ = 0;
          applied_.store(current_);
          gateFrames_ = transitionFrames_;
        } else {
          gate_ = 1;
          ready_.store(true);
        }
      }
    }
  }
}
} // namespace effetune::audio

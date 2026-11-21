#pragma once
#include <atomic>
#include <cstdint>
#include <vector>

namespace effetune::audio {
class OutputStage {
public:
  void open(unsigned sampleRate, unsigned channels);
  void holdRecovery() noexcept { recoveryHeld_ = true; }
  void releaseRecovery() noexcept {
    recoveryHeld_ = false;
    recoveryRamp_ = transitionFrames_;
  }
  void gateRecovery(float *audio, float *marker, float *parallel, unsigned frames) noexcept;
  void fade(float gain, unsigned frames) noexcept;
  void delay(unsigned samples, bool running) noexcept;
  void resetHistory() noexcept;
  void process(float *audio, float *marker, unsigned frames, bool useDelay,
               const float *wetHistory = nullptr) noexcept;
  unsigned appliedDelay() const noexcept { return applied_.load(std::memory_order_acquire); }
  unsigned maxDelay() const noexcept { return capacity_; }
  bool ready() const noexcept { return ready_.load(std::memory_order_acquire) && topologyReady(); }
  void closeTopology() noexcept;
  void settleTopology() noexcept;
  bool topologyClosed() const noexcept { return phase_ == Phase::closed; }
  bool topologySilent() const noexcept {
    return phase_ == Phase::closed || phase_ == Phase::settling;
  }
  bool topologyReady() const noexcept { return topologyReady_.load(std::memory_order_acquire); }
  void gateTopology(float *audio, float *marker, float *parallel, unsigned frames, unsigned latency,
                    bool hold) noexcept;
  float completedGain() const noexcept { return completedGain_.load(std::memory_order_acquire); }

private:
  std::vector<float> ring_;
  unsigned capacity_ = 0, channels_ = 0, transitionFrames_ = 0, write_ = 0, valid_ = 0;
  unsigned desired_ = 0, current_ = 0, gateFrames_ = 0, left_ = 0;
  float gate_ = 1, gain_ = 1, target_ = 1, step_ = 0;
  bool recoveryHeld_ = false;
  unsigned recoveryRamp_ = 0;
  std::atomic<unsigned> applied_{0};
  std::atomic<float> completedGain_{1};
  std::atomic<bool> ready_{true};
  enum class Phase { open, closing, closed, settling, opening };
  Phase phase_ = Phase::open;
  float topologyGain_ = 1;
  unsigned elapsed_ = 0, holdFrames_ = 0, holdLimit_ = 0;
  std::atomic<bool> topologyReady_{true};
};
} // namespace effetune::audio

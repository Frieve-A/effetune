#pragma once
#include "drum_calibration.h"
#include "drum_frontend.h"
#include "drum_inference.h"
#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>

namespace effetune::plugins::analyzer::drum {
class Decoder {
public:
  using Callback = void (*)(void *, unsigned, std::int64_t, float);
  void reset() noexcept {
    raw_ = scored_ = 0;
    ended_ = false;
    minimum_.fill(std::numeric_limits<float>::infinity());
    previous_.fill(0.0f);
    before_.fill(0.0f);
    last_.fill(-100);
  }
  void push(const float *logits, void *context, Callback callback) noexcept {
    if (ended_)
      return;
    for (unsigned c = 0u; c < 5u; ++c)
      if (logits[c] < minimum_[c])
        minimum_[c] = logits[c];
    if (raw_++ >= 6)
      score(logits, context, callback);
  }
  void finish(void *context, Callback callback) noexcept {
    if (ended_)
      return;
    if (raw_ > 6)
      for (unsigned i = 0u; i < 6u; ++i)
        score(minimum_.data(), context, callback);
    ended_ = true;
  }

private:
  void score(const float *next, void *context, Callback callback) noexcept {
    const auto anchor = scored_ - 1;
    for (unsigned c = 0u; c < 5u; ++c) {
      const float value = previous_[c];
      if (anchor >= 1 && value >= before_[c] && value > next[c] && value >= kThresholds[c] &&
          anchor - last_[c] >= 3) {
        last_[c] = anchor;
        callback(context, c, anchor, value);
      }
      before_[c] = value;
      previous_[c] = next[c];
    }
    ++scored_;
  }
  std::array<float, 5> minimum_{}, previous_{}, before_{};
  std::array<std::int64_t, 5> last_{};
  std::int64_t raw_ = 0, scored_ = 0;
  bool ended_ = false;
};

class Detector {
public:
  void *context = nullptr;
  void (*event)(void *, double, float, unsigned) = nullptr;
  void prepare(double rate) {
    rate_ = rate;
    setInstanceSalt(salt_);
    frontend_.prepare(rate);
    inference_.prepare();
    reset();
  }
  void reset() noexcept {
    frontend_.reset();
    inference_.reset();
    decoder_.reset();
    pending_ = false;
  }
  void setInstanceSalt(std::uint32_t salt) noexcept {
    salt_ = salt;
    delaySamples_ = static_cast<unsigned>(rate_ * (salt % 32u) / 4000.0);
  }
  double latency() const noexcept { return .07 + frontend_.delay() + delaySamples_ / rate_; }
  void push(float value) noexcept {
    frontend_.push(value, this, &frame);
    if (pending_) {
      if (remaining_ == 0u)
        infer();
      else
        --remaining_;
    }
  }
  void finish() noexcept {
    if (pending_)
      infer();
    frontend_.finish(this, &frame);
    if (pending_)
      infer();
    decoder_.finish(this, &accepted);
  }

private:
  static void frame(void *context, const float *feature) noexcept {
    auto &self = *static_cast<Detector *>(context);
    if (self.pending_)
      self.infer();
    std::copy_n(feature, 128u, self.feature_.data());
    self.remaining_ = self.delaySamples_;
    self.pending_ = true;
  }
  void infer() noexcept {
    float logits[5];
    inference_.push(feature_.data(), logits);
    decoder_.push(logits, this, &accepted);
    pending_ = false;
  }
  static void accepted(void *context, unsigned cls, std::int64_t anchor, float logit) noexcept {
    auto &self = *static_cast<Detector *>(context);
    const double time = static_cast<double>(anchor + 1) / 100.0 - self.frontend_.delay();
    if (time < 0.0 || !self.event)
      return;
    for (unsigned lane = 0u; lane < 5u; ++lane)
      if (kTelemetryClasses[lane] == cls)
        self.event(self.context, time, logit, lane);
  }
  Frontend frontend_;
  Inference inference_;
  Decoder decoder_;
  std::array<float, 128> feature_{};
  double rate_ = 44100.0;
  std::uint32_t salt_ = 0u, delaySamples_ = 0u, remaining_ = 0u;
  bool pending_ = false;
};
} // namespace effetune::plugins::analyzer::drum

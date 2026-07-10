#ifndef EFFETUNE_DSP_SMOOTHING_H
#define EFFETUNE_DSP_SMOOTHING_H

#include <cmath>
#include <cstdint>

namespace effetune::dsp {

class OnePole final {
public:
  void reset(double value = 0.0) noexcept { state_ = value; }

  void setCoefficient(double coefficient) noexcept {
    if (!(coefficient > 0.0)) {
      coefficient_ = 0.0;
      return;
    }
    coefficient_ = coefficient > 1.0 ? 1.0 : coefficient;
  }

  void setTimeMilliseconds(double milliseconds, double sample_rate) noexcept {
    if (!(milliseconds > 0.0) || !(sample_rate > 0.0)) {
      coefficient_ = 1.0;
      return;
    }
    coefficient_ = 1.0 - std::exp(-1000.0 / (milliseconds * sample_rate));
  }

  [[nodiscard]] double process(double input) noexcept {
    state_ += coefficient_ * (input - state_);
    return state_;
  }

  [[nodiscard]] double value() const noexcept { return state_; }
  [[nodiscard]] double coefficient() const noexcept { return coefficient_; }

private:
  double state_ = 0.0;
  double coefficient_ = 1.0;
};

class AttackReleaseEnvelope final {
public:
  void reset(double value = 0.0) noexcept { state_ = value; }

  void setCoefficients(double attack, double release) noexcept {
    attack_ = clampCoefficient(attack);
    release_ = clampCoefficient(release);
  }

  void setTimesMilliseconds(double attack_ms, double release_ms, double sample_rate) noexcept {
    attack_ = timeCoefficient(attack_ms, sample_rate);
    release_ = timeCoefficient(release_ms, sample_rate);
  }

  [[nodiscard]] double process(double magnitude) noexcept {
    if (!(magnitude > 0.0)) {
      magnitude = 0.0;
    }
    const double coefficient = magnitude > state_ ? attack_ : release_;
    state_ += coefficient * (magnitude - state_);
    return state_;
  }

  [[nodiscard]] double value() const noexcept { return state_; }

private:
  [[nodiscard]] static double clampCoefficient(double coefficient) noexcept {
    if (!(coefficient > 0.0)) {
      return 0.0;
    }
    return coefficient > 1.0 ? 1.0 : coefficient;
  }

  [[nodiscard]] static double timeCoefficient(double milliseconds, double sample_rate) noexcept {
    if (!(milliseconds > 0.0) || !(sample_rate > 0.0)) {
      return 1.0;
    }
    return 1.0 - std::exp(-1000.0 / (milliseconds * sample_rate));
  }

  double state_ = 0.0;
  double attack_ = 1.0;
  double release_ = 1.0;
};

class LinearSmoother final {
public:
  void reset(double value = 0.0) noexcept {
    current_ = value;
    target_ = value;
    step_ = 0.0;
    remaining_ = 0U;
  }

  void setTarget(double target, std::uint32_t sample_count) noexcept {
    target_ = target;
    if (sample_count == 0U) {
      current_ = target;
      step_ = 0.0;
      remaining_ = 0U;
      return;
    }
    step_ = (target - current_) / static_cast<double>(sample_count);
    remaining_ = sample_count;
  }

  [[nodiscard]] double next() noexcept {
    if (remaining_ == 0U) {
      return current_;
    }
    --remaining_;
    if (remaining_ == 0U) {
      current_ = target_;
    } else {
      current_ += step_;
    }
    return current_;
  }

  [[nodiscard]] double value() const noexcept { return current_; }
  [[nodiscard]] double target() const noexcept { return target_; }
  [[nodiscard]] std::uint32_t remainingSamples() const noexcept { return remaining_; }

private:
  double current_ = 0.0;
  double target_ = 0.0;
  double step_ = 0.0;
  std::uint32_t remaining_ = 0U;
};

} // namespace effetune::dsp

#endif

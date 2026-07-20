#ifndef EFFETUNE_DSP_HALFBAND_H
#define EFFETUNE_DSP_HALFBAND_H

#include <array>
#include <cmath>
#include <cstddef>

namespace effetune::dsp {

class Halfband2x {
public:
  static constexpr std::size_t kTapCount = 127u;
  static constexpr std::size_t kLatency = (kTapCount - 1u) / 2u;

  Halfband2x() noexcept : coefficients_(design()) { reset(); }

  void reset() noexcept {
    history_.fill(0.0F);
    position_ = 0u;
    phase_ = 0u;
  }

  bool decimate(float input, float &output) noexcept {
    push(input);
    phase_ ^= 1u;
    if (phase_ != 0u)
      return false;
    output = convolve();
    return true;
  }

  void interpolate(float input, float &first, float &second) noexcept {
    push(input * 2.0F);
    first = convolve();
    push(0.0F);
    second = historyAtDelay(kLatency) * coefficients_[kLatency];
  }

  [[nodiscard]] const std::array<float, kTapCount> &coefficients() const noexcept {
    return coefficients_;
  }

private:
  static double besselI0(double value) noexcept {
    double sum = 1.0;
    double term = 1.0;
    const double quarter = value * value * 0.25;
    for (int index = 1; index <= 24; ++index) {
      term *= quarter / static_cast<double>(index * index);
      sum += term;
    }
    return sum;
  }

  static std::array<float, kTapCount> design() noexcept {
    std::array<float, kTapCount> result{};
    constexpr double pi = 3.14159265358979323846;
    constexpr double beta = 10.8;
    constexpr double center = static_cast<double>(kLatency);
    const double denominator = besselI0(beta);
    double sum = 0.0;
    for (std::size_t index = 0u; index < kTapCount; ++index) {
      const double offset = static_cast<double>(index) - center;
      const double ideal = offset == 0.0 ? 0.5 : std::sin(0.5 * pi * offset) / (pi * offset);
      const double ratio = offset / center;
      const double inside = 1.0 - ratio * ratio;
      const double window = besselI0(beta * std::sqrt(inside > 0.0 ? inside : 0.0)) / denominator;
      result[index] = static_cast<float>(ideal * window);
      sum += result[index];
    }
    for (float &coefficient : result)
      coefficient = static_cast<float>(coefficient / sum);
    return result;
  }

  void push(float input) noexcept {
    history_[position_] = input;
    position_ = position_ + 1u == kTapCount ? 0u : position_ + 1u;
  }

  [[nodiscard]] float historyAtDelay(std::size_t delay) const noexcept {
    std::size_t index = position_ + kTapCount - 1u - delay;
    if (index >= kTapCount)
      index -= kTapCount;
    return history_[index];
  }

  [[nodiscard]] float convolve() const noexcept {
    float sum = 0.0F;
    for (std::size_t tap = 0u; tap < kLatency; tap += 2u) {
      sum += (historyAtDelay(tap) + historyAtDelay(kTapCount - 1u - tap)) * coefficients_[tap];
    }
    sum += historyAtDelay(kLatency) * coefficients_[kLatency];
    return sum;
  }

  std::array<float, kTapCount> coefficients_{};
  std::array<float, kTapCount> history_{};
  std::size_t position_ = 0u;
  unsigned phase_ = 0u;
};

} // namespace effetune::dsp

#endif

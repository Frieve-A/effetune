#ifndef EFFETUNE_DSP_RATIONAL_RESAMPLER_H
#define EFFETUNE_DSP_RATIONAL_RESAMPLER_H

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <numeric>
#include <vector>

namespace effetune::dsp {

class RationalResampler final {
public:
  static constexpr std::size_t kTapCount = 383u;
  static constexpr std::size_t kCenter = (kTapCount - 1u) / 2u;
  static constexpr std::size_t kMaximumOutputs = 6u;

  void prepare(std::uint32_t input_rate, std::uint32_t output_rate, double cutoff_hz) {
    input_rate_ = input_rate;
    output_rate_ = output_rate;
    cutoff_hz_ = cutoff_hz;
    phase_step_ = std::gcd(input_rate_, output_rate_);
    phase_count_ = output_rate_ / phase_step_;
    coefficients_.assign(phase_count_ * kTapCount, 0.0F);
    design();
    reset();
  }

  void reset() noexcept {
    history_.fill(0.0F);
    history_position_ = 0u;
    input_index_ = 0u;
    next_output_numerator_ = 0u;
  }

  [[nodiscard]] std::size_t push(float input, std::array<float, kMaximumOutputs> &output) noexcept {
    history_[history_position_] = input;
    history_position_ = history_position_ + 1u == kTapCount ? 0u : history_position_ + 1u;

    const std::uint64_t current_numerator = input_index_ * output_rate_;
    std::size_t count = 0u;
    while (next_output_numerator_ <= current_numerator && count < output.size()) {
      const std::uint64_t delta = current_numerator - next_output_numerator_;
      const std::size_t phase = static_cast<std::size_t>(delta / phase_step_);
      output[count++] = convolve(phase < phase_count_ ? phase : phase_count_ - 1u);
      next_output_numerator_ += input_rate_;
    }
    ++input_index_;
    return count;
  }

private:
  [[nodiscard]] static double besselI0(double value) noexcept {
    double sum = 1.0;
    double term = 1.0;
    const double quarter = value * value * 0.25;
    for (int index = 1; index <= 24; ++index) {
      term *= quarter / static_cast<double>(index * index);
      sum += term;
    }
    return sum;
  }

  [[nodiscard]] static double sinc(double value) noexcept {
    const double magnitude = value < 0.0 ? -value : value;
    if (magnitude < 1.0e-12) {
      return 1.0;
    }
    constexpr double kPi = 3.14159265358979323846;
    const double angle = kPi * value;
    return std::sin(angle) / angle;
  }

  void design() noexcept {
    constexpr double kBeta = 9.0;
    const double denominator = besselI0(kBeta);
    const double cutoff = cutoff_hz_ / static_cast<double>(input_rate_);
    for (std::size_t phase = 0u; phase < phase_count_; ++phase) {
      const double fraction =
          static_cast<double>(phase * phase_step_) / static_cast<double>(output_rate_);
      double sum = 0.0;
      for (std::size_t tap = 0u; tap < kTapCount; ++tap) {
        const double offset = static_cast<double>(tap) - (static_cast<double>(kCenter) + fraction);
        const double ratio = offset / static_cast<double>(kCenter);
        const double inside = 1.0 - ratio * ratio;
        const double window =
            besselI0(kBeta * std::sqrt(inside > 0.0 ? inside : 0.0)) / denominator;
        const double coefficient = 2.0 * cutoff * sinc(2.0 * cutoff * offset) * window;
        coefficients_[phase * kTapCount + tap] = static_cast<float>(coefficient);
        sum += coefficient;
      }
      if (sum != 0.0) {
        for (std::size_t tap = 0u; tap < kTapCount; ++tap) {
          coefficients_[phase * kTapCount + tap] =
              static_cast<float>(static_cast<double>(coefficients_[phase * kTapCount + tap]) / sum);
        }
      }
    }
  }

  [[nodiscard]] float convolve(std::size_t phase) const noexcept {
    const float *coefficients = coefficients_.data() + phase * kTapCount;
    const float *history = history_.data() + history_position_;
    double sum = 0.0;
    std::size_t tap = 0u;
    for (; tap < history_position_; ++tap) {
      sum += static_cast<double>(*--history) * coefficients[tap];
    }
    history = history_.data() + kTapCount;
    for (; tap < kTapCount; ++tap) {
      sum += static_cast<double>(*--history) * coefficients[tap];
    }
    return static_cast<float>(sum);
  }

  std::uint32_t input_rate_ = 1u;
  std::uint32_t output_rate_ = 1u;
  std::uint32_t phase_step_ = 1u;
  std::size_t phase_count_ = 1u;
  double cutoff_hz_ = 1.0;
  std::vector<float> coefficients_{};
  std::array<float, kTapCount> history_{};
  std::size_t history_position_ = 0u;
  std::uint64_t input_index_ = 0u;
  std::uint64_t next_output_numerator_ = 0u;
};

} // namespace effetune::dsp

#endif

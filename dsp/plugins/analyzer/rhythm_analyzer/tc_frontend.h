// Causal 24 kHz multi-resolution front end. Lane analysis remains independent.
#pragma once
#include "rhythm_d.h"
#include "tc_constants.h"
#include "tc_tcn.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::analyzer::rhythm_a3 {
class BeatDecimator {
public:
  void prepare(std::uint32_t rate) noexcept {
    factor_ = rate / 24000u;
    taps_ = 32u * factor_ + 1u;
    coefficients_ = factor_ == 2u ? tc::kFir48 : factor_ == 4u ? tc::kFir96 : tc::kFir192;
    reset();
  }
  void reset() noexcept {
    samples_.fill(0.0f);
    inputs_ = 0u;
    next_ = (taps_ - 1u) / 2u;
  }
  template <class Emit> void push(float value, Emit &&emit) noexcept {
    samples_[inputs_ & 511u] = value;
    if (inputs_ == next_) {
      double sum = 0.0;
      const auto count = inputs_ + 1u < taps_ ? static_cast<std::uint32_t>(inputs_ + 1u) : taps_;
      for (std::uint32_t k = 0u; k < count; ++k)
        sum += coefficients_[k] * static_cast<double>(samples_[(inputs_ - k) & 511u]);
      emit(static_cast<float>(sum));
      next_ += factor_;
    }
    ++inputs_;
  }
  double delay() const noexcept {
    return static_cast<double>(taps_ - 1u) / (2.0 * factor_ * 24000.0);
  }

private:
  std::array<float, 512> samples_{};
  const double *coefficients_ = nullptr;
  std::uint64_t inputs_ = 0u, next_ = 0u;
  std::uint32_t taps_ = 65u, factor_ = 2u;
};

class TcFrontEnd {
public:
  void prepare() noexcept {
    static_cast<void>(rhythm_d::fftTables());
    reset();
  }
  void reset() noexcept {
    samples_.fill(0.0f);
    previous_.fill(0.0f);
    features_.fill(0.0f);
    position_ = 0u;
  }
  void push(float value) noexcept { samples_[position_++ & 2047u] = value; }
  const float *features() noexcept {
    const float *windows[3] = {tc::kHann512, tc::kHann1024, tc::kHann2048};
    for (std::uint32_t group = 0u; group < 3u; ++group) {
      const std::uint32_t size = 512u << group, half = size / 2u, first = position_ - size;
      for (std::uint32_t i = 0u; i < half; ++i) {
        real_[i] = static_cast<double>(samples_[(first + 2u * i) & 2047u] * windows[group][2u * i]);
        imaginary_[i] = static_cast<double>(samples_[(first + 2u * i + 1u) & 2047u] *
                                            windows[group][2u * i + 1u]);
      }
      rhythm_d::complexFft(real_.data(), imaginary_.data(), half);
      magnitude_[0] =
          static_cast<float>(std::fabs(rhythm_d::realBinZero(real_.data(), imaginary_.data())));
      magnitude_[half] =
          static_cast<float>(std::fabs(rhythm_d::realBinNyquist(real_.data(), imaginary_.data())));
      for (std::uint32_t bin = 1u; bin < half; ++bin) {
        const auto value = rhythm_d::realBin(real_.data(), imaginary_.data(), half, bin);
        magnitude_[bin] = static_cast<float>(std::sqrt(value.re * value.re + value.im * value.im));
      }
      for (std::uint32_t b = tc::kGroupOffsets[group]; b < tc::kGroupOffsets[group + 1u]; ++b) {
        const auto &filter = tc::kFilterBands[b];
        float sum = 0.0f;
        for (std::uint32_t i = 0u; i < filter.count; ++i)
          sum += magnitude_[filter.first + i] * tc::kFilterWeights[filter.offset + i];
        const float log = static_cast<float>(
            rhythm_d::portableLog(static_cast<double>(1.0f + sum)) / 2.30258509299404568402);
        const float difference = log - previous_[b];
        features_[b] = log;
        features_[250u + b] = difference > 0.0f ? difference : 0.0f;
        previous_[b] = log;
      }
    }
    return features_.data();
  }

private:
  std::array<float, 2048> samples_{};
  std::array<float, 1025> magnitude_{};
  std::array<float, 250> previous_{};
  std::array<float, 500> features_{};
  std::array<double, 1024> real_{}, imaginary_{};
  std::uint32_t position_ = 0u;
};
} // namespace effetune::plugins::analyzer::rhythm_a3

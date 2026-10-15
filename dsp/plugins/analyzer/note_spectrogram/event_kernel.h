#ifndef EFFETUNE_NOTE_SPECTROGRAM_EVENT_KERNEL_H
#define EFFETUNE_NOTE_SPECTROGRAM_EVENT_KERNEL_H

#include "harmnet_weights.h"
#include "matrix_rows.h"
#include <algorithm>
#include <array>
#include <cmath>

namespace effetune::plugins::analyzer::harmnet_detail {
// Fixed event head; input normalization is folded into its affine coefficients.
class EventKernel final {
public:
  void reset() noexcept {
    state_.fill(0.0F);
    previous_.fill(0.0F);
    flux_.fill(0.0F);
    projected_flux_.fill(0.0F);
    initialized_ = false;
  }
  void updateFlux(const float *short_spectrum) noexcept {
    flux_.fill(0.0F);
    if (initialized_)
      for (auto band = 0u; band < 8u; ++band) {
        const auto begin = band * 300u / 8u, end = (band + 1u) * 300u / 8u;
        float sum = 0.0F;
        for (auto bin = begin; bin < end; ++bin) {
          auto prior = previous_[bin];
          if (bin && previous_[bin - 1u] > prior)
            prior = previous_[bin - 1u];
          if (bin + 1u < 300u && previous_[bin + 1u] > prior)
            prior = previous_[bin + 1u];
          const auto difference = short_spectrum[bin] - prior;
          sum += difference > 0.0F ? difference : 0.0F;
        }
        flux_[band] = sum / static_cast<float>(end - begin);
      }
    std::copy_n(short_spectrum, 300u, previous_.data());
    initialized_ = true;
    std::copy_n(weights(harmnet_weights::kEventInputBias), 16u, projected_flux_.data());
    accumulateRows<8u, 16u>(projected_flux_.data(), weights(harmnet_weights::kEventFluxWeight),
                            flux_.data());
  }
  const std::array<float, 8> &flux() const noexcept { return flux_; }
  float infer(unsigned pitch, const float *context) noexcept {
    using namespace harmnet_weights;
    std::array<float, 16> projected{};
    std::copy(projected_flux_.begin(), projected_flux_.end(), projected.begin());
    accumulateRows<64u, 16u>(projected.data(), weights(kEventContextWeight), context);
    for (auto &value : projected)
      value = value > 0.0F ? value : 0.0F;
    auto *hidden = state_.data() + pitch * 16u;
    std::array<float, 48> gi{}, gh{};
    std::copy_n(weights(kEventGruInputBias), 48u, gi.data());
    std::copy_n(weights(kEventGruHiddenBias), 48u, gh.data());
    accumulateRows<16u, 48u>(gi.data(), weights(kEventGruInputWeight), projected.data());
    accumulateRows<16u, 48u>(gh.data(), weights(kEventGruHiddenWeight), hidden);
    for (auto j = 0u; j < 16u; ++j) {
      const auto r = sigmoid(gi[j] + gh[j]);
      const auto z = sigmoid(gi[16u + j] + gh[16u + j]);
      const auto n = std::tanh(gi[32u + j] + r * gh[32u + j]);
      hidden[j] = (1.0F - z) * n + z * hidden[j];
    }
    auto value = weights(kEventPitchBias)[pitch];
    for (auto j = 0u; j < 16u; ++j)
      value += weights(kEventOutputWeight)[j] * hidden[j];
    return value;
  }

private:
  static const float *weights(std::size_t offset) noexcept {
    return harmnet_weights::kWeights.data() + offset;
  }
  static float sigmoid(float value) noexcept {
    const auto limited = value < -20.0F ? -20.0F : value > 20.0F ? 20.0F : value;
    return 1.0F / (1.0F + std::exp(-limited));
  }
  std::array<float, 88u * 16u> state_{};
  std::array<float, 300> previous_{};
  std::array<float, 8> flux_{};
  std::array<float, 16> projected_flux_{};
  bool initialized_ = false;
};
} // namespace effetune::plugins::analyzer::harmnet_detail
#endif

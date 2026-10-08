#ifndef EFFETUNE_NOTE_SPECTROGRAM_HARMNET_INFERENCE_H
#define EFFETUNE_NOTE_SPECTROGRAM_HARMNET_INFERENCE_H

#include "harmnet_weights.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::analyzer {
// Fixed HarmNet L inference, with no allocation or adaptation in the processing path.
class HarmNetInference final {
  static constexpr std::uint32_t kChannels = 16u, kHidden = 48u, kHarmonics = 9u;
  static constexpr std::uint32_t kPadding = 8u, kStride = 316u, kGates = 3u * kHidden;
  struct Conv {
    std::uint32_t inputs = 0u, kernel = 0u, dilation = 0u, position = 0u;
    const float *weights = nullptr, *bias = nullptr;
    std::array<float, 3u * kChannels * kStride> history{};
    float *slot(std::uint32_t age) noexcept {
      return history.data() + ((position + 3u - age) % 3u) * inputs * kStride;
    }
  };
  static const float *weights(std::size_t offset) noexcept {
    return harmnet_weights::kWeights.data() + offset;
  }

public:
  static constexpr std::uint32_t kPitches = 88u, kBins = 300u, kHeads = 4u;
  HarmNetInference() {
    using namespace harmnet_weights;
    conv_[0].inputs = 2u;
    conv_[0].kernel = 7u;
    conv_[0].dilation = 1u;
    conv_[1].inputs = conv_[2].inputs = kChannels;
    conv_[1].kernel = conv_[2].kernel = 5u;
    conv_[1].dilation = 1u;
    conv_[2].dilation = 3u;
    conv_[0].weights = weights(kConv0Weight);
    conv_[0].bias = weights(kConv0Bias);
    conv_[1].weights = weights(kConv1Weight);
    conv_[1].bias = weights(kConv1Bias);
    conv_[2].weights = weights(kConv2Weight);
    conv_[2].bias = weights(kConv2Bias);
    constexpr std::array<double, kHarmonics> harmonics = {.5, 1, 2, 3, 4, 5, 6, 7, 8};
    for (auto p = 0u; p < kPitches; ++p)
      for (auto h = 0u; h < kHarmonics; ++h) {
        const auto index = static_cast<int>(p * 3u + 1u) +
                           static_cast<int>(std::lround(36.0 * std::log2(harmonics[h])));
        indices_[p * kHarmonics + h] = index < 0 || index >= static_cast<int>(kBins)
                                           ? kBins
                                           : static_cast<std::uint32_t>(index);
      }
  }
  void reset() noexcept {
    for (auto &conv : conv_) {
      conv.position = 0u;
      conv.history.fill(0.0F);
    }
    convolved_.fill(0.0F);
    hidden_.fill(0.0F);
    projected_.fill(0.0F);
    pitch_features_.fill(0.0F);
    logits_.fill(0.0F);
  }
  void begin() noexcept {
    for (auto &conv : conv_)
      conv.position = (conv.position + 1u) % 3u;
  }
  void setInput(std::uint32_t channel, const float *features, std::uint32_t begin,
                std::uint32_t end) noexcept {
    auto *dest = conv_[0].slot(0u) + channel * kStride + kPadding;
    const auto *scale = weights(harmnet_weights::kInputScale) + channel * kBins;
    const auto *shift = weights(harmnet_weights::kInputShift) + channel * kBins;
    for (auto i = begin; i < end; ++i)
      dest[i] = features[i] * scale[i] + shift[i];
  }
  void convolution(std::uint32_t layer, std::uint32_t begin, std::uint32_t end) noexcept {
    auto &conv = conv_[layer];
    auto *output = layer < 2u ? conv_[layer + 1u].slot(0u) : convolved_.data();
    for (auto co = 0u; co < kChannels; ++co) {
      auto *dest = output + co * kStride + kPadding;
      for (auto f = begin; f < end; ++f)
        dest[f] = conv.bias[co];
      for (auto tap = 0u; tap < 3u; ++tap) {
        const auto *source = conv.slot(2u - tap);
        for (auto ci = 0u; ci < conv.inputs; ++ci) {
          const auto *x = source + ci * kStride + kPadding;
          const auto *w = conv.weights + ((co * conv.inputs + ci) * 3u + tap) * conv.kernel;
          if (conv.kernel == 7u)
            convolveRow<7u>(dest, x, w, conv.dilation, begin, end);
          else
            convolveRow<5u>(dest, x, w, conv.dilation, begin, end);
        }
      }
      for (auto f = begin; f < end; ++f)
        if (dest[f] < 0.0F)
          dest[f] = 0.0F;
    }
  }
  void gather(std::uint32_t begin, std::uint32_t end) noexcept {
    using namespace harmnet_weights;
    for (auto p = begin; p < end; ++p) {
      auto *a = projected_.data() + p * kHidden;
      const auto *pe = weights(kPitchEmbedding) + p * kHidden;
      for (auto j = 0u; j < kHidden; ++j)
        a[j] = weights(kProjectionBias)[j] + pe[j];
      for (auto c = 0u; c < kChannels; ++c) {
        const auto *source = convolved_.data() + c * kStride + kPadding;
        for (auto h = 0u; h < kHarmonics; ++h) {
          const auto index = indices_[p * kHarmonics + h];
          const auto value = index < kBins ? source[index] : 0.0F;
          const auto *w = weights(kProjectionWeight) + (c * kHarmonics + h) * kHidden;
          for (auto j = 0u; j < kHidden; ++j)
            a[j] += w[j] * value;
        }
      }
      for (auto j = 0u; j < kHidden; ++j)
        if (a[j] < 0.0F)
          a[j] = 0.0F;
    }
  }
  void pitchConvolution(std::uint32_t begin, std::uint32_t end) noexcept {
    using namespace harmnet_weights;
    for (auto p = begin; p < end; ++p) {
      auto *a = pitch_features_.data() + p * kHidden;
      std::copy_n(weights(kPitchConvBias), kHidden, a);
      for (auto k = 0u; k < 5u; ++k) {
        const auto pp = static_cast<int>(p) + static_cast<int>(k) - 2;
        if (pp < 0 || pp >= static_cast<int>(kPitches))
          continue;
        const auto *input = projected_.data() + pp * kHidden;
        for (auto i = 0u; i < kHidden; ++i) {
          const auto value = input[i];
          const auto *w = weights(kPitchConvWeight) + (k * kHidden + i) * kHidden;
          for (auto o = 0u; o < kHidden; ++o)
            a[o] += w[o] * value;
        }
      }
      const auto *residual = projected_.data() + p * kHidden;
      for (auto j = 0u; j < kHidden; ++j)
        a[j] = residual[j] + (a[j] > 0.0F ? a[j] : 0.0F);
    }
  }
  void recurrent(std::uint32_t begin, std::uint32_t end) noexcept {
    using namespace harmnet_weights;
    std::array<float, kGates> gi{}, gh{};
    for (auto p = begin; p < end; ++p) {
      const auto *x = pitch_features_.data() + p * kHidden;
      auto *hp = hidden_.data() + p * kHidden;
      std::copy_n(weights(kGruInputBias), kGates, gi.data());
      std::copy_n(weights(kGruHiddenBias), kGates, gh.data());
      for (auto i = 0u; i < kHidden; ++i) {
        const auto *wi = weights(kGruInputWeight) + i * kGates,
                   *wh = weights(kGruHiddenWeight) + i * kGates;
        for (auto j = 0u; j < kGates; ++j) {
          gi[j] += wi[j] * x[i];
          gh[j] += wh[j] * hp[i];
        }
      }
      for (auto j = 0u; j < kHidden; ++j) {
        const auto r = sigmoid(gi[j] + gh[j]), z = sigmoid(gi[kHidden + j] + gh[kHidden + j]);
        const auto n = std::tanh(gi[2u * kHidden + j] + r * gh[2u * kHidden + j]);
        hp[j] = (1.0F - z) * n + z * hp[j];
      }
      for (auto d = 0u; d < kHeads; ++d) {
        const auto *w = weights(kHeadWeight) + d * kHidden;
        auto value = weights(kHeadBias)[d] + weights(kPitchBias)[p * kHeads + d];
        for (auto j = 0u; j < kHidden; ++j)
          value += w[j] * hp[j];
        logits_[p * kHeads + d] = value;
      }
    }
  }
  float probability(std::uint32_t pitch, std::uint32_t head) const noexcept {
    return sigmoid(logits_[pitch * kHeads + head] + harmnet_weights::kCalibration[head]);
  }
  const auto &logits() const noexcept { return logits_; }

private:
  static float sigmoid(float x) noexcept { return 1.0F / (1.0F + std::exp(-x)); }
  template <std::uint32_t Kernel>
  static void convolveRow(float *dest, const float *source, const float *w, std::uint32_t dilation,
                          std::uint32_t begin, std::uint32_t end) noexcept {
    for (auto f = begin; f < end; ++f) {
      auto value = dest[f];
      for (auto k = 0u; k < Kernel; ++k)
        value +=
            w[k] *
            source[static_cast<int>(f) + static_cast<int>(dilation) *
                                             (static_cast<int>(k) - static_cast<int>(Kernel / 2u))];
      dest[f] = value;
    }
  }
  std::array<Conv, 3> conv_;
  std::array<std::uint32_t, kPitches * kHarmonics> indices_{};
  std::array<float, kChannels * kStride> convolved_{};
  std::array<float, kPitches * kHidden> projected_{}, pitch_features_{}, hidden_{};
  std::array<float, kPitches * kHeads> logits_{};
};
} // namespace effetune::plugins::analyzer
#endif

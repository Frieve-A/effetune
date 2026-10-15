#ifndef EFFETUNE_NOTE_SPECTROGRAM_HARMNET_INFERENCE_H
#define EFFETUNE_NOTE_SPECTROGRAM_HARMNET_INFERENCE_H
#include "event_kernel.h"
#include "harmnet_weights.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
namespace effetune::plugins::analyzer {
namespace harmnet_detail::stem {
inline constexpr std::uint32_t kPitches = 88u, kBins = 300u, kChannels = 24u, kHidden = 64u,
                               kRank = 16u;
inline constexpr std::uint32_t kHeads = 4u, kLayers = 8u, kGates = 3u * kHidden, kFluxBands = 8u;
// Ring of the input of stem layer `layer`: 3 frames of inputs x (300 + 2 x padding) floats.
constexpr std::uint32_t ringInputs(std::uint32_t layer) noexcept {
  return layer == 0u ? 2u : kChannels;
}
constexpr std::uint32_t ringDilation(std::uint32_t layer) noexcept {
  return static_cast<std::uint32_t>(harmnet_weights::kStemDilations[layer]);
}
constexpr std::uint32_t ringPadding(std::uint32_t layer) noexcept {
  return 3u * ringDilation(layer);
}
constexpr std::uint32_t ringStride(std::uint32_t layer) noexcept {
  return kBins + 2u * ringPadding(layer);
}
constexpr std::size_t ringOffset(std::uint32_t layer) noexcept {
  std::size_t offset = 0u;
  for (auto l = 0u; l < layer; ++l)
    offset += 3u * ringInputs(l) * ringStride(l);
  return offset;
}
inline constexpr std::size_t kHistoryFloats = ringOffset(kLayers);
static_assert(kHistoryFloats == 207900u);

} // namespace harmnet_detail::stem
// Fixed causal stem, interval mixer and recurrent heads; no processing-time allocation.
class HarmNetInference final {
public:
  static constexpr std::uint32_t kPitches = 88u, kBins = 300u, kChannels = 24u, kHidden = 64u;
  static constexpr std::uint32_t kRank = 16u, kHeads = 4u, kLayers = 8u, kGates = 192u;

private:
  struct Separable {
    std::size_t depthwise_weight, depthwise_bias, pointwise_weight, pointwise_bias;
  };
  static constexpr std::array<Separable, kLayers> kSeparable = {{
      {0u, 0u, 0u, 0u},
      {harmnet_weights::kDepthwise1Weight, harmnet_weights::kDepthwise1Bias,
       harmnet_weights::kPointwise1Weight, harmnet_weights::kPointwise1Bias},
      {harmnet_weights::kDepthwise2Weight, harmnet_weights::kDepthwise2Bias,
       harmnet_weights::kPointwise2Weight, harmnet_weights::kPointwise2Bias},
      {harmnet_weights::kDepthwise3Weight, harmnet_weights::kDepthwise3Bias,
       harmnet_weights::kPointwise3Weight, harmnet_weights::kPointwise3Bias},
      {harmnet_weights::kDepthwise4Weight, harmnet_weights::kDepthwise4Bias,
       harmnet_weights::kPointwise4Weight, harmnet_weights::kPointwise4Bias},
      {harmnet_weights::kDepthwise5Weight, harmnet_weights::kDepthwise5Bias,
       harmnet_weights::kPointwise5Weight, harmnet_weights::kPointwise5Bias},
      {harmnet_weights::kDepthwise6Weight, harmnet_weights::kDepthwise6Bias,
       harmnet_weights::kPointwise6Weight, harmnet_weights::kPointwise6Bias},
      {harmnet_weights::kDepthwise7Weight, harmnet_weights::kDepthwise7Bias,
       harmnet_weights::kPointwise7Weight, harmnet_weights::kPointwise7Bias},
  }};
  static const float *weight(std::size_t offset) noexcept {
    return harmnet_weights::kWeights.data() + offset;
  }

public:
  void reset() noexcept {
    position_ = 0u;
    history_.fill(0.0F);
    depthwise_.fill(0.0F);
    pointwise_.fill(0.0F);
    stem_.fill(0.0F);
    gathered_.fill(0.0F);
    normalized_.fill(0.0F);
    hidden_.fill(0.0F);
    logits_.fill(0.0F);
    onset_logits_.fill(0.0F);
    resetEvent();
  }
  void begin() noexcept { position_ = (position_ + 1u) % 3u; }
  void setInput(std::uint32_t channel, const float *features, std::uint32_t begin,
                std::uint32_t end) noexcept {
    auto *dest = slot(0u, 0u) + channel * harmnet_detail::stem::ringStride(0u) +
                 harmnet_detail::stem::ringPadding(0u);
    const auto *scale = weight(harmnet_weights::kInputScale) + channel * kBins;
    const auto *shift = weight(harmnet_weights::kInputShift) + channel * kBins;
    for (auto i = begin; i < end; ++i)
      dest[i] = features[i] * scale[i] + shift[i];
  }
  void convolution(std::uint32_t layer, std::uint32_t begin, std::uint32_t end) noexcept {
    if (layer == 0u)
      denseConvolution(begin, end);
    else
      separableConvolution(layer, begin, end);
  }
  void gather(std::uint32_t begin, std::uint32_t end) noexcept {
    for (auto p = begin; p < end; ++p) {
      auto *a = gathered_.data() + p * kHidden;
      std::copy_n(weight(harmnet_weights::kGatherBias) + p * kHidden, kHidden, a);
      for (auto k = 0u; k < harmnet_weights::kGatherStarts.size(); ++k) {
        const auto bin = static_cast<int>(3u * p) + harmnet_weights::kGatherStarts[k];
        if (bin < 0 || bin >= static_cast<int>(kBins))
          continue;
        harmnet_detail::accumulateRows<kChannels, kHidden>(
            a, weight(harmnet_weights::kGatherWeight) + k * kChannels * kHidden,
            stem_.data() + bin * kChannels);
      }
      for (auto j = 0u; j < kHidden; ++j)
        if (a[j] < 0.0F)
          a[j] = 0.0F;
    }
  }
  void pitchConvolution(std::uint32_t begin, std::uint32_t end) noexcept {
    for (auto p = begin; p < end; ++p) {
      std::array<float, kRank> m{};
      std::copy_n(weight(harmnet_weights::kIntervalBias), kRank, m.data());
      for (auto q = 0u; q < harmnet_weights::kIntervalOffsets.size(); ++q) {
        const auto pp = static_cast<int>(p) + harmnet_weights::kIntervalOffsets[q];
        if (pp < 0 || pp >= static_cast<int>(kPitches))
          continue;
        harmnet_detail::accumulateRows<kHidden, kRank>(
            m.data(), weight(harmnet_weights::kIntervalWeight) + q * kHidden * kRank,
            gathered_.data() + pp * kHidden);
      }
      for (auto &value : m)
        value = value > 0.0F ? value : 0.0F;
      auto *y = normalized_.data() + p * kHidden;
      std::copy_n(weight(harmnet_weights::kMixBias), kHidden, y);
      harmnet_detail::accumulateRows<kRank, kHidden>(y, weight(harmnet_weights::kMixWeight),
                                                     m.data());

      const auto *residual = gathered_.data() + p * kHidden;
      float mean = 0.0F;
      for (auto j = 0u; j < kHidden; ++j) {
        y[j] += residual[j];
        mean += y[j];
      }
      mean /= static_cast<float>(kHidden);
      float variance = 0.0F;
      for (auto j = 0u; j < kHidden; ++j) {
        const auto d = y[j] - mean;
        variance += d * d;
      }
      variance /= static_cast<float>(kHidden);
      const auto inverse = 1.0F / std::sqrt(variance + 1e-5F);
      const auto *gamma = weight(harmnet_weights::kNormWeight),
                 *beta = weight(harmnet_weights::kNormBias);
      for (auto j = 0u; j < kHidden; ++j)
        y[j] = (y[j] - mean) * inverse * gamma[j] + beta[j];
    }
  }
  void setEventEnabled(bool enabled) noexcept { event_enabled_ = enabled; }
  void resetEvent() noexcept {
    event_.reset();
    event_onsets_.fill(0.0F);
  }
  void updateEventFlux(const float *spectrum) noexcept {
    if (event_enabled_)
      event_.updateFlux(spectrum);
  }
  void inferEvents(std::uint32_t begin, std::uint32_t end) noexcept {
    if (event_enabled_)
      for (auto p = begin; p < end; ++p)
        event_onsets_[p] = sigmoid(event_.infer(p, hidden_.data() + p * kHidden));
  }
  void recurrent(std::uint32_t begin, std::uint32_t end) noexcept {
    std::array<float, kGates> gi{}, gh{};
    for (auto p = begin; p < end; ++p) {
      const auto *x = normalized_.data() + p * kHidden;
      auto *hp = hidden_.data() + p * kHidden;
      std::copy_n(weight(harmnet_weights::kGruInputBias), kGates, gi.data());
      std::copy_n(weight(harmnet_weights::kGruHiddenBias), kGates, gh.data());
      harmnet_detail::accumulateRows<kHidden, kGates>(gi.data(),
                                                      weight(harmnet_weights::kGruInputWeight), x);
      harmnet_detail::accumulateRows<kHidden, kGates>(
          gh.data(), weight(harmnet_weights::kGruHiddenWeight), hp);

      for (auto j = 0u; j < kHidden; ++j) {
        const auto r = sigmoid(gi[j] + gh[j]), z = sigmoid(gi[kHidden + j] + gh[kHidden + j]);
        const auto n = std::tanh(gi[2u * kHidden + j] + r * gh[2u * kHidden + j]);
        hp[j] = (1.0F - z) * n + z * hp[j];
      }
      auto *logit = logits_.data() + p * kHeads;
      std::copy_n(weight(harmnet_weights::kPresenceBias) + p * kHeads, kHeads, logit);
      harmnet_detail::accumulateRows<kHidden, kHeads>(logit,
                                                      weight(harmnet_weights::kPresenceWeight), hp);

      const auto *onset_weights = weight(harmnet_weights::kOnsetWeight) + p * kHidden;
      auto onset = weight(harmnet_weights::kOnsetBias)[p];
      for (auto j = 0u; j < kHidden; ++j)
        onset += onset_weights[j] * hp[j];
      onset_logits_[p] = onset;
    }
  }
  void copyTimbreFeatures(std::uint32_t pitch, float *a, float *z) const noexcept {
    for (auto h = 0u; h < harmnet_weights::kTimbreStarts.size(); ++h) {
      const auto bin = static_cast<int>(3u * pitch) + harmnet_weights::kTimbreStarts[h];
      if (bin < 0 || bin >= static_cast<int>(kBins))
        std::fill_n(a + h * kChannels, kChannels, 0.0F);
      else
        std::copy_n(stem_.data() + bin * kChannels, kChannels, a + h * kChannels);
    }
    std::copy_n(hidden_.data() + pitch * kHidden, kHidden, z);
  }
  float probability(std::uint32_t pitch, std::uint32_t head) const noexcept {
    return sigmoid(logits_[pitch * kHeads + head]);
  }
  float onset(std::uint32_t pitch) const noexcept { return sigmoid(onset_logits_[pitch]); }
  float eventOnset(std::uint32_t pitch) const noexcept { return event_onsets_[pitch]; }

  const auto &hidden() const noexcept { return hidden_; }
  const auto &logits() const noexcept { return logits_; }

private:
  float *slot(std::uint32_t layer, std::uint32_t age) noexcept {
    return history_.data() + harmnet_detail::stem::ringOffset(layer) +
           ((position_ + 3u - age) % 3u) * harmnet_detail::stem::ringInputs(layer) *
               harmnet_detail::stem::ringStride(layer);
  }
  // Layer 0: dense 3 x 7 convolution of the 2 input windows, then relu (harmnet_inference.h
  // convolution).
  void denseConvolution(std::uint32_t begin, std::uint32_t end) noexcept {
    const auto *w = weight(harmnet_weights::kConv0Weight),
               *bias = weight(harmnet_weights::kConv0Bias);
    auto *output = slot(1u, 0u) + harmnet_detail::stem::ringPadding(1u);
    for (auto co = 0u; co < kChannels; ++co) {
      auto *dest = output + co * harmnet_detail::stem::ringStride(1u);
      for (auto f = begin; f < end; ++f)
        dest[f] = bias[co];
      for (auto tap = 0u; tap < 3u; ++tap) {
        const auto *source = slot(0u, 2u - tap) + harmnet_detail::stem::ringPadding(0u);
        for (auto ci = 0u; ci < 2u; ++ci)
          convolveRow<7u>(dest, source + ci * harmnet_detail::stem::ringStride(0u),
                          w + ((co * 2u + ci) * 3u + tap) * 7u, 1u, begin, end);
      }
      for (auto f = begin; f < end; ++f)
        if (dest[f] < 0.0F)
          dest[f] = 0.0F;
    }
  }
  // Layers 1..7: depthwise 3 x 7 at the layer's dilation, pointwise 24 x 24, and the residual input
  // + relu(y). The output is the next layer's ring, or after layer 7 the stem output transposed to
  // [300][24].
  void separableConvolution(std::uint32_t layer, std::uint32_t begin, std::uint32_t end) noexcept {
    const auto &blocks = kSeparable[layer];
    const auto *dw = weight(blocks.depthwise_weight), *dw_bias = weight(blocks.depthwise_bias);
    const auto *pw = weight(blocks.pointwise_weight), *pw_bias = weight(blocks.pointwise_bias);
    const auto in_stride = harmnet_detail::stem::ringStride(layer),
               in_padding = harmnet_detail::stem::ringPadding(layer),
               dil = harmnet_detail::stem::ringDilation(layer);
    for (auto c = 0u; c < kChannels; ++c) {
      auto *dest = depthwise_.data() + c * kBins;
      for (auto f = begin; f < end; ++f)
        dest[f] = dw_bias[c];
      for (auto tap = 0u; tap < 3u; ++tap)
        convolveRow<7u>(dest, slot(layer, 2u - tap) + c * in_stride + in_padding,
                        dw + (c * 3u + tap) * 7u, dil, begin, end);
    }

    const auto *input = slot(layer, 0u) + in_padding;
    for (auto co = 0u; co < kChannels; ++co) {
      auto *acc = pointwise_.data();
      for (auto f = begin; f < end; ++f)
        acc[f] = pw_bias[co];
      for (auto ci = 0u; ci < kChannels; ++ci) {
        const auto w = pw[co * kChannels + ci];
        const auto *x = depthwise_.data() + ci * kBins;
        for (auto f = begin; f < end; ++f)
          acc[f] += w * x[f];
      }
      const auto *residual = input + co * in_stride;
      if (layer + 1u < kLayers) {
        auto *dest = slot(layer + 1u, 0u) + co * harmnet_detail::stem::ringStride(layer + 1u) +
                     harmnet_detail::stem::ringPadding(layer + 1u);
        for (auto f = begin; f < end; ++f)
          dest[f] = residual[f] + (acc[f] > 0.0F ? acc[f] : 0.0F);
      } else {
        for (auto f = begin; f < end; ++f)
          stem_[f * kChannels + co] = residual[f] + (acc[f] > 0.0F ? acc[f] : 0.0F);
      }
    }
  }
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

  std::uint32_t position_ = 0u;
  std::array<float, harmnet_detail::stem::kHistoryFloats> history_{};
  std::array<float, kChannels * kBins> depthwise_{};
  std::array<float, kBins> pointwise_{};
  std::array<float, kBins * kChannels> stem_{};
  std::array<float, kPitches * kHidden> gathered_{}, normalized_{}, hidden_{};
  std::array<float, kPitches * kHeads> logits_{};
  std::array<float, kPitches> onset_logits_{};
  harmnet_detail::EventKernel event_;
  std::array<float, kPitches> event_onsets_{};
  bool event_enabled_ = false;
};
} // namespace effetune::plugins::analyzer
#endif

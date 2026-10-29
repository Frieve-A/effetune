#pragma once
#include "drum_frontend_tables.h"
#include "effetune/dsp/rational_resampler.h"
#include "rhythm_d.h"
#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::analyzer::drum {
class Frontend {
public:
  using Callback = void (*)(void *, const float *);
  void prepare(double rate) {
    rate_ = static_cast<std::uint32_t>(rate);
    if (rate_ != 44100u)
      resampler_.prepare(rate_, 44100u, .47 * (rate_ < 44100u ? rate_ : 44100u));
    static_cast<void>(rhythm_d::fftTables());
    reset();
  }
  void reset() noexcept {
    ring_.fill(0.0f);
    head_ = hop_ = 0u;
    inputs_ = outputs_ = 0u;
    agcEnergy_ = 0.0;
    agcFrames_ = 0u;
    ended_ = false;
    resampler_.reset();
  }
  double delay() const noexcept { return rate_ == 44100u ? 0.0 : 191.0 / rate_; }
  void push(float sample, void *context, Callback callback) noexcept {
    if (ended_)
      return;
    ++inputs_;
    if (rate_ == 44100u) {
      sampleAtRate(sample, context, callback);
      return;
    }
    std::array<float, dsp::RationalResampler::kMaximumOutputs> values;
    const auto count = resampler_.push(sample, values);
    for (std::size_t i = 0u; i < count; ++i)
      sampleAtRate(values[i], context, callback);
  }
  void finish(void *context, Callback callback) noexcept {
    if (ended_)
      return;
    const auto target = (inputs_ * 44100u + rate_ - 1u) / rate_;
    while (outputs_ < target) {
      std::array<float, dsp::RationalResampler::kMaximumOutputs> values;
      const auto count = resampler_.push(0.0f, values);
      for (std::size_t i = 0u; i < count && outputs_ < target; ++i)
        sampleAtRate(values[i], context, callback);
    }
    while (hop_ != 0u)
      sampleAtRate(0.0f, context, callback);
    ended_ = true;
  }

private:
  void sampleAtRate(float sample, void *context, Callback callback) noexcept {
    ring_[head_] = sample;
    head_ = (head_ + 1u) % 2048u;
    ++outputs_;
    if (++hop_ != 441u)
      return;
    hop_ = 0u;
    double re[1024], im[1024];
    for (unsigned i = 0u; i < 1024u; ++i) {
      re[i] = ring_[(head_ + 2u * i) % 2048u] * kHann[2u * i];
      im[i] = ring_[(head_ + 2u * i + 1u) % 2048u] * kHann[2u * i + 1u];
    }
    rhythm_d::complexFft(re, im, 1024u);
    float power[1025];
    const float dc = static_cast<float>(rhythm_d::realBinZero(re, im));
    const float nyquist = static_cast<float>(rhythm_d::realBinNyquist(re, im));
    power[0] = dc * dc;
    power[1024] = nyquist * nyquist;
    for (unsigned i = 1u; i < 1024u; ++i) {
      const auto bin = rhythm_d::realBin(re, im, 1024u, i);
      const float real = static_cast<float>(bin.re), imaginary = static_cast<float>(bin.im);
      power[i] = real * real + imaginary * imaginary;
    }
    float feature[128];
    double broadband = 0.0;
    for (unsigned band = 0u; band < 128u; ++band) {
      const auto *shape = kMelBands[band];
      float energy = 0.0f;
      for (unsigned i = 0u; i < shape[1]; ++i)
        energy += power[shape[0] + i] * kMelWeights[shape[2] + i];
      feature[band] = energy;
      broadband += energy;
    }
    constexpr double smooth = 1.0 / 300.0, reference = 7764.884088152459;
    agcEnergy_ = smooth * broadband + (1.0 - smooth) * agcEnergy_;
    const double correction = -std::expm1(++agcFrames_ * std::log1p(-smooth));
    const double mean = agcEnergy_ / correction;
    const double gain = reference / (mean < reference * 1e-6 ? reference * 1e-6 : mean);
    for (float &energy : feature) {
      const float normalized = static_cast<float>(energy * gain);
      energy = std::log1p(10.0f * normalized);
    }
    callback(context, feature);
  }
  dsp::RationalResampler resampler_;
  std::array<float, 2048> ring_{};
  std::uint64_t inputs_ = 0u, outputs_ = 0u;
  double agcEnergy_ = 0.0;
  std::uint64_t agcFrames_ = 0u;
  std::uint32_t rate_ = 44100u, head_ = 0u, hop_ = 0u;
  bool ended_ = false;
};
} // namespace effetune::plugins::analyzer::drum

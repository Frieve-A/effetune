#ifndef EFFETUNE_CHORD_KEY_HEAD_H
#define EFFETUNE_CHORD_KEY_HEAD_H
#include "chord_key_weights.h"
#include "matrix_rows.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::analyzer {
class ChordKeyHead final {
public:
  using Planes = std::array<std::uint8_t, 88u * 4u>;
  using ChordScores = std::array<float, 457>;
  using KeyScores = std::array<float, 25>;
  using Result = std::array<std::uint8_t, 8>;
  void reset() noexcept {
    hidden_.fill(0.0F);
    cur_ = 0xFFFFu;
    cnt_ = 0u;
    key_cur_ = 255u;
    key_cnt_ = 0u;
    for (auto &row : joint_history_)
      row.fill(0.0F);
    key_counts_.fill(0u);
    rows_ = 0u;
    result_.fill(255u);
    confirmed_probability_ = 0.0F;
  }
  template <class Network>
  void fold(const Network &network, const std::array<float, 88> &levels) noexcept {
    Planes planes;
    for (auto p = 0u; p < 88u; ++p) {
      planes[p * 4u] = quantize(network.probability(p, 1u) * 255.0F, 0, 255);
      planes[p * 4u + 1u] = quantize(network.probability(p, 3u) * 255.0F, 0, 255);
      planes[p * 4u + 2u] = quantize(network.onset(p) * 255.0F, 0, 255);
      planes[p * 4u + 3u] = quantize(levels[p], -128, 127);
    }
    foldPlanes(planes);
  }
  void foldPlanes(const Planes &planes) noexcept {
    planes_ = planes;
    folded_.fill(0.0F);
    constexpr std::array<unsigned, 4> bands = {0u, 3u, 5u, 9u};
    for (auto pc = 0u; pc < 12u; ++pc)
      for (auto band = 0u; band < 3u; ++band) {
        auto *out = folded_.data() + pc * 18u + band * 6u;
        for (auto slot = bands[band]; slot < bands[band + 1u]; ++slot) {
          const auto pitch = static_cast<int>(12u + slot * 12u + pc) - 21;
          if (pitch < 0 || pitch >= 88)
            continue;
          const auto *in = planes.data() + static_cast<unsigned>(pitch) * 4u;
          const auto p2 = in[0] / 255.0F, p8 = in[1] / 255.0F, onset = in[2] / 255.0F;
          const auto db = in[3] < 128u ? static_cast<int>(in[3]) : static_cast<int>(in[3]) - 256;
          const auto raw = (static_cast<float>(db) + 100.0F) / 100.0F;
          const auto level = raw < 0.0F ? 0.0F : raw > 1.2F ? 1.2F : raw;
          out[0] = out[0] > p2 ? out[0] : p2;
          out[1] += p2;
          out[2] = out[2] > p8 ? out[2] : p8;
          out[3] += p8;
          out[4] = out[4] > onset ? out[4] : onset;
          out[5] = out[5] > level ? out[5] : level;
        }
      }
  }
  void recurrent(unsigned begin, unsigned end) noexcept {
    using namespace chord_key_weights;
    for (auto pc = begin; pc < end; ++pc) {
      std::array<float, 216> input;
      for (auto k = 0u; k < 12u; ++k)
        std::copy_n(folded_.data() + ((pc + k) % 12u) * 18u, 18u, input.data() + k * 18u);
      auto x = kConvBias;
      harmnet_detail::accumulateRows<216, 64>(x.data(), kConvWeight.data(), input.data());
      for (auto &v : x)
        v = v > 0.0F ? v : 0.0F;
      auto gi = kGruBiasIhL0, gh = kGruBiasHhL0;
      auto *h = hidden_.data() + pc * 64u;
      harmnet_detail::accumulateRows<64, 192>(gi.data(), kGruWeightIhL0.data(), x.data());
      harmnet_detail::accumulateRows<64, 192>(gh.data(), kGruWeightHhL0.data(), h);
      for (auto i = 0u; i < 64u; ++i) {
        const auto r = sigmoid(gi[i] + gh[i]);
        const auto z = sigmoid(gi[64u + i] + gh[64u + i]);
        const auto n = std::tanh(gi[128u + i] + r * gh[128u + i]);
        h[i] = (1.0F - z) * n + z * h[i];
      }
      auto out = kHeadBias;
      harmnet_detail::accumulateRows<64, 12>(out.data(), kHeadWeight.data(), h);
      std::copy_n(out.data(), 11u, chord_.data() + pc * 11u);
      bass_[pc] = out[11];
      for (auto mode = 0u; mode < 2u; ++mode)
        key_[mode * 12u + pc] = dot(h, kKheadWeight.data() + mode * 64u, kKheadBias[mode]);
    }
  }
  void decode() noexcept {
    using namespace chord_key_weights;
    std::array<float, 64> mean{};
    for (auto pc = 0u; pc < 12u; ++pc)
      for (auto i = 0u; i < 64u; ++i)
        mean[i] += hidden_[pc * 64u + i];
    for (auto &v : mean)
      v /= 12.0F;
    chord_[132] = dot(mean.data(), kNheadWeight.data(), kNheadBias[0]);
    bass_[12] = dot(mean.data(), kNheadWeight.data() + 64u, kNheadBias[1]);
    key_[24] = dot(mean.data(), kNheadWeight.data() + 128u, kNheadBias[2]);
    logSoftmax(chord_);
    logSoftmax(bass_);
    logSoftmax(key_);
    for (auto root = 0u; root < 12u; ++root)
      for (auto v = 0u; v < 38u; ++v)
        joint_[root * 38u + v] =
            chord_[root * 11u + kVocabulary[v][0]] + bass_[(root + kVocabulary[v][1]) % 12u];
    joint_[456] = chord_[132] + bass_[12];
    decodeScores(joint_, key_);
  }
  void decodeScores(const ChordScores &joint, const KeyScores &key) noexcept {
    using namespace chord_key_weights;
    joint_history_[rows_ % kChordStreak] = joint;
    const auto raw = argmax(joint.data(), 457u);
    if (cur_ == 0xFFFFu) {
      cur_ = static_cast<std::uint16_t>(raw);
      cnt_ = 0u;
    } else if (joint[raw] - joint[cur_] > kChordMargin) {
      if (++cnt_ >= kChordStreak) {
        cur_ = static_cast<std::uint16_t>(raw);
        cnt_ = 0u;
      }
    } else {
      cnt_ = 0u;
    }
    const auto steps = rows_ < kChordStreak - 1u ? rows_ : kChordStreak - 1u;
    // The confirmed label describes the beginning of its evidence interval.
    confirmed_probability_ = std::exp(joint_history_[(rows_ - steps) % kChordStreak][cur_]);
    encode(raw, result_.data());
    encode(cur_, result_.data() + 3u);
    result_[6] = 255u;
    result_[7] = 255u;
    if (rows_ >= kKeyLag) {
      if (std::none_of(key.begin(), key.end(), [](float value) { return std::isnan(value); })) {
        const auto best = argmax(key.data(), 25u);
        if (key_cur_ == 255u) {
          key_cur_ = static_cast<std::uint8_t>(best);
          key_cnt_ = 0u;
        } else if (key[best] - key[key_cur_] > kKeyMargin) {
          if (++key_cnt_ >= kKeyStreak) {
            key_cur_ = static_cast<std::uint8_t>(best);
            key_cnt_ = 0u;
          }
        } else {
          key_cnt_ = 0u;
        }
        if (best < 24u)
          ++key_counts_[best];
      }
      result_[6] = key_cur_;
      const auto overall_key = argmax(key_counts_.data(), 24u);
      if (key_counts_[overall_key] != 0u)
        result_[7] = static_cast<std::uint8_t>(overall_key);
    }
    ++rows_;
  }
  const Planes &planes() const noexcept { return planes_; }
  const ChordScores &jointScores() const noexcept { return joint_; }
  const KeyScores &keyScores() const noexcept { return key_; }
  const Result &result() const noexcept { return result_; }
  float confirmedProbability() const noexcept { return confirmed_probability_; }

private:
  static std::uint8_t quantize(float value, int low, int high) noexcept {
    const auto rounded = std::nearbyint(value);
    const auto bounded = rounded < low ? low : rounded > high ? high : static_cast<int>(rounded);
    return static_cast<std::uint8_t>(bounded);
  }
  static float sigmoid(float x) noexcept { return 1.0F / (1.0F + std::exp(-x)); }
  static float dot(const float *x, const float *w, float bias) noexcept {
    for (auto i = 0u; i < 64u; ++i)
      bias += x[i] * w[i];
    return bias;
  }
  template <class T> static unsigned argmax(const T *values, unsigned count) noexcept {
    auto best = 0u;
    for (auto j = 1u; j < count; ++j)
      if (values[j] > values[best])
        best = j;
    return best;
  }
  template <std::size_t N> static void logSoftmax(std::array<float, N> &values) noexcept {
    const auto maximum = values[argmax(values.data(), static_cast<unsigned>(N))];
    auto sum = 0.0F;
    for (auto v : values)
      sum += std::exp(v - maximum);
    const auto logsum = std::log(sum);
    for (auto &v : values)
      v = v - maximum - logsum;
  }
  static void encode(unsigned index, std::uint8_t *out) noexcept {
    if (index == 456u) {
      std::fill_n(out, 3u, std::uint8_t{255u});
      return;
    }
    const auto root = index / 38u;
    const auto &entry = chord_key_weights::kVocabulary[index % 38u];
    out[0] = static_cast<std::uint8_t>(root);
    out[1] = entry[0];
    out[2] = static_cast<std::uint8_t>((root + entry[1]) % 12u);
  }
  Planes planes_{};
  std::array<float, 216> folded_{};
  std::array<float, 768> hidden_{};
  std::array<float, 133> chord_{};
  std::array<float, 13> bass_{};
  KeyScores key_{};
  ChordScores joint_{};
  std::array<ChordScores, chord_key_weights::kChordStreak> joint_history_{};
  std::uint16_t cur_ = 0xFFFFu;
  std::uint8_t cnt_ = 0u, key_cur_ = 255u, key_cnt_ = 0u;
  std::array<std::uint32_t, 24> key_counts_{};
  std::uint64_t rows_ = 0u;
  Result result_{};
  float confirmed_probability_ = 0.0F;
};
} // namespace effetune::plugins::analyzer
#endif

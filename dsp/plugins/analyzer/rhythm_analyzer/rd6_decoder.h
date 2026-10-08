// Frozen RD6 V1 forward filter and immutable one-second-lag Viterbi blocks.
#pragma once
#include "portable_math.h"
#include "rd6_math.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>

namespace effetune::plugins::analyzer::rhythm_a3 {
inline constexpr double kBeatRate = 24000.0, kBeatDt = 256.0 / kBeatRate;
inline constexpr double kBeatLatency = 512.0 / kBeatRate, kBeatT0 = kBeatDt - kBeatLatency;

struct Rd6Event {
  double tick = 0.0, period = 0.0;
  std::int64_t decision = 0;
  bool shown = false;
};

class Rd6Decoder {
public:
  static constexpr std::uint32_t kMinInterval = 23u, kMaxInterval = 141u;
  static constexpr std::uint32_t kChains = kMaxInterval - kMinInterval + 1u;
  static constexpr std::uint32_t kStates = (kMinInterval + kMaxInterval) * kChains / 2u;
  static constexpr std::uint32_t kBlock = 94u, kLag = 94u, kBack = kBlock + kLag + 1u;
  struct Preview {
    std::array<Rd6Event, kBack / kMinInterval + 2u> beats{};
    std::uint32_t count = 0u;
    double period = 0.0;
  };
  struct Sink {
    void *context = nullptr;
    void (*forward)(void *, const Rd6Event &) = nullptr;
    void (*analysis)(void *, const Rd6Event &) = nullptr;
  } sink;

  // Range preparation writes preallocated tables and is safe at a control boundary.
  void prepare(double minimum, double maximum) noexcept {
    low_ = static_cast<std::uint32_t>(std::nearbyint(60.0 / (kBeatDt * maximum)));
    high_ = static_cast<std::uint32_t>(std::nearbyint(60.0 / (kBeatDt * minimum)));
    count_ = high_ - low_ + 1u;
    minPeriod_ = 60.0 / (kBeatDt * maximum);
    states_ = 0u;
    for (std::uint32_t c = 0u; c < count_; ++c) {
      const auto interval = low_ + c;
      first_[c] = states_;
      const double bpm = 60.0 / (kBeatDt * interval);
      double best = std::numeric_limits<double>::infinity();
      for (std::uint32_t t = 0u; t < 61u; ++t) {
        const double delta = rhythm_d::portableLog(bpm) -
                             (rhythm_d::portableLog(30.0) + rhythm_d::portableLog(10.0) * t / 60.0);
        const double distance = delta < 0.0 ? -delta : delta;
        if (distance < best) {
          best = distance;
          tempo_[c] = t;
        }
      }
      for (std::uint32_t p = 0u; p < interval; ++p) {
        const double phase = static_cast<double>(p) / interval;
        chain_[states_] = static_cast<std::uint8_t>(c);
        beat_[states_] = phase < 1.0 / 16.0;
        cos_[states_] = rhythm_d::portableCos(6.283185307179586 * phase);
        sin_[states_] = rhythm_d::portableSin(6.283185307179586 * phase);
        ++states_;
      }
      last_[c] = states_ - 1u;
    }
    // Source-row normalization follows the frozen transition model. Each destination keeps
    // predecessors in increasing source order, making ties deterministic.
    for (std::uint32_t d = 0u; d < count_; ++d)
      edges_[d] = 0u;
    for (std::uint32_t s = 0u; s < count_; ++s) {
      double row[kChains], sum = 0.0;
      for (std::uint32_t d = 0u; d < count_; ++d) {
        const double delta = static_cast<double>(low_ + d) / (low_ + s) - 1.0;
        double weight = rhythm_d::portableExp(-100.0 * (delta < 0.0 ? -delta : delta));
        if (weight <= 0x1p-52)
          weight = 0.0;
        row[d] = weight;
        sum += weight;
      }
      for (std::uint32_t d = 0u; d < count_; ++d) {
        if (row[d] == 0.0)
          continue;
        const auto edge = edges_[d]++;
        sources_[d][edge] = static_cast<std::uint8_t>(s);
        probability_[d][edge] = row[d] / sum;
        logProbability_[d][edge] = static_cast<float>(rhythm_d::portableLog(row[d] / sum));
      }
    }
    reset();
  }

  void reset() noexcept {
    const double uniform = states_ ? 1.0 / states_ : 0.0;
    const float uniformLog = states_ ? static_cast<float>(-rhythm_d::portableLog(states_)) : 0.0f;
    std::fill_n(alpha_.data(), states_, uniform);
    std::fill_n(dp_.data(), states_, uniformLog);
    tick_ = committed_ = 0;
    bestState_ = 0u;
    lastBeat_ = short_ = long_ = 0.0;
    period_ = confidence_ = evidence_ = 0.0;
    shown_ = region_ = false;
    std::fill(marginal_.begin(), marginal_.end(), 0.0);
  }

  void push(float activation, const float *tempo, bool hardSilence = false) noexcept {
    const double a = activation, off = (1.0 - a) / 15.0;
    const float onLog = static_cast<float>(rhythm_d::portableLog(a));
    const float offLog = static_cast<float>(rhythm_d::portableLog(off));
    for (std::uint32_t d = 0u; d < count_; ++d) {
      double forward = 0.0;
      float best = -std::numeric_limits<float>::infinity();
      std::uint8_t choice = 0u;
      for (std::uint32_t e = 0u; e < edges_[d]; ++e) {
        const auto source = sources_[d][e];
        forward += alpha_[last_[source]] * probability_[d][e];
        const float candidate = dp_[last_[source]] + logProbability_[d][e];
        if (candidate > best) {
          best = candidate;
          choice = source;
        }
      }
      new_[first_[d]] = forward;
      nextDp_[first_[d]] = best;
      back_[static_cast<std::uint32_t>(tick_) % kBack][d] = choice;
      const double p = tempo[tempo_[d]] < 1e-4f ? 1e-4 : static_cast<double>(tempo[tempo_[d]]);
      const double log = .03 * rhythm_d::portableLog(p);
      prior_[d] = rhythm_d::portableExp(log);
      logPrior_[d] = static_cast<float>(log);
    }
    double total = 0.0;
    for (std::uint32_t s = 0u; s < states_; ++s) {
      if (s != first_[chain_[s]]) {
        new_[s] = alpha_[s - 1u];
        nextDp_[s] = dp_[s - 1u];
      }
      new_[s] *= beat_[s] ? a : off;
      total += new_[s];
      const float observed = nextDp_[s] + (beat_[s] ? onLog : offLog);
      nextDp_[s] = observed + logPrior_[chain_[s]];
    }
    evidence_ = total > 0.0 ? rhythm_d::portableLog(16.0 * total) : -50.0;
    if (!std::isfinite(evidence_))
      evidence_ = -50.0;
    // scipy lfilter([dt/tau], [1, dt/tau-1], evidence), with zero initial state.
    short_ = (kBeatDt / .5) * evidence_ + (1.0 - kBeatDt / .5) * short_;
    long_ = (kBeatDt / 2.0) * evidence_ + (1.0 - kBeatDt / 2.0) * long_;
    shown_ = short_ > 0.0 || (shown_ && long_ > .02);
    confidence_ =
        1.0 / (1.0 + rhythm_d::portableExp(-(-1.0543807556114948 + 31.820095025649806 * short_)));
    if (hardSilence) {
      short_ = long_ = confidence_ = 0.0;
      shown_ = false;
    }
    double priorTotal = 0.0;
    const double inverse = total > 0.0 ? 1.0 / total : 0.0;
    float top = nextDp_[0];
    bestState_ = 0u;
    for (std::uint32_t s = 0u; s < states_; ++s) {
      new_[s] *= inverse;
      new_[s] *= prior_[chain_[s]];
      priorTotal += new_[s];
      if (nextDp_[s] > top) {
        top = nextDp_[s];
        bestState_ = s;
      }
    }
    double cosine = 0.0, sine = 0.0;
    std::fill_n(marginal_.data(), count_, 0.0);
    const double priorInverse = priorTotal > 0.0 ? 1.0 / priorTotal : 0.0;
    for (std::uint32_t s = 0u; s < states_; ++s) {
      alpha_[s] = new_[s] * priorInverse;
      dp_[s] = nextDp_[s] - top;
      marginal_[chain_[s]] += alpha_[s];
      cosine += alpha_[s] * cos_[s];
      sine += alpha_[s] * sin_[s];
    }
    std::uint32_t best = 0u;
    for (std::uint32_t c = 1u; c < count_; ++c)
      if (marginal_[c] > marginal_[best])
        best = c;
    period_ = low_ + best;
    double phase = rd6_math::atan2(sine, cosine) / 6.283185307179586;
    if (phase < 0.0)
      phase += 1.0;
    const double distance = phase >= .5 ? (1.0 - phase) * period_ : -phase * period_;
    const double prediction = static_cast<double>(tick_) + distance;
    if (distance <= .025 / kBeatDt && prediction >= lastBeat_ + minPeriod_) {
      lastBeat_ = prediction;
      if (sink.forward != nullptr)
        sink.forward(sink.context, {prediction, period_, tick_, shown_});
    }
    activation_[static_cast<std::uint32_t>(tick_) % kBack] = activation;
    if (tick_ >= committed_ + kBlock - 1u + kLag)
      commit(committed_ + kBlock, tick_);
    ++tick_;
  }

  // Evaluation-only EOF flush; real-time silence follows the cold-reset contract instead.
  void flush() noexcept {
    if (committed_ < tick_)
      commit(tick_, tick_ - 1);
    closeRegion(tick_ - 1);
  }
  bool shown() const noexcept { return shown_; }
  double confidence() const noexcept { return confidence_; }
  double shortEvidence() const noexcept { return short_; }
  double evidence() const noexcept { return evidence_; }
  double period() const noexcept { return period_; }
  std::int64_t ticks() const noexcept { return tick_; }
  std::int64_t committed() const noexcept { return committed_; }
  const double *posterior() const noexcept { return alpha_.data(); }
  const float *viterbi() const noexcept { return dp_.data(); }
  std::uint32_t stateCount() const noexcept { return states_; }
  // Read the current best path without committing it or changing forward/click events.
  Preview preview() const noexcept {
    Preview result;
    if (tick_ == 0)
      return result;
    result.period = low_ + chain_[bestState_];
    std::array<std::uint32_t, kBack> path{};
    trace(tick_, tick_ - 1, path);
    bool region = region_;
    auto peak = regionPeak_;
    float activation = regionActivation_;
    double period = regionPeriod_;
    const auto append = [&]() {
      if (region && result.count < result.beats.size())
        result.beats[result.count++] = {static_cast<double>(peak), period, tick_ - 1, true};
    };
    for (auto j = committed_; j < tick_; ++j) {
      const auto slot = static_cast<std::uint32_t>(j) % kBack;
      const auto selected = path[slot];
      if (!beat_[selected]) {
        append();
        region = false;
        continue;
      }
      if (!region || activation_[slot] > activation) {
        peak = j;
        activation = activation_[slot];
        period = low_ + chain_[selected];
      }
      region = true;
    }
    append();
    return result;
  }
  void tempogram(float *out, float &bpm) const noexcept {
    std::fill_n(out, 192u, 0.0f);
    for (std::uint32_t c = 0u; c < count_; ++c) {
      const double tempo = 60.0 / (kBeatDt * (low_ + c));
      const double bin = 48.0 * rhythm_d::portableLog(tempo / 30.0) / 0.6931471805599453 - .5;
      const auto left = static_cast<int>(std::floor(bin));
      const double fraction = bin - left;
      if (left >= 0 && left < 192)
        out[left] += static_cast<float>(marginal_[c] * (1.0 - fraction));
      if (left + 1 >= 0 && left + 1 < 192)
        out[left + 1] += static_cast<float>(marginal_[c] * fraction);
    }
    float peak = 0.0f;
    for (std::uint32_t i = 0u; i < 192u; ++i)
      if (out[i] > peak)
        peak = out[i];
    if (peak > 0.0f)
      for (std::uint32_t i = 0u; i < 192u; ++i)
        out[i] /= peak;
    bpm = period_ > 0.0 ? static_cast<float>(60.0 / (period_ * kBeatDt)) : 0.0f;
  }

private:
  void closeRegion(std::int64_t decision) noexcept {
    if (!region_)
      return;
    if (sink.analysis != nullptr)
      sink.analysis(sink.context,
                    {static_cast<double>(regionPeak_), regionPeriod_, decision, true});
    region_ = false;
  }
  void commit(std::int64_t end, std::int64_t deciding) noexcept {
    trace(end, deciding, path_);
    for (std::int64_t j = committed_; j < end; ++j) {
      const auto slot = static_cast<std::uint32_t>(j) % kBack;
      const auto selected = path_[slot];
      if (!beat_[selected]) {
        closeRegion(deciding);
        continue;
      }
      if (!region_ || activation_[slot] > regionActivation_) {
        regionPeak_ = j;
        regionActivation_ = activation_[slot];
        regionPeriod_ = low_ + chain_[selected];
      }
      region_ = true;
    }
    committed_ = end;
  }
  void trace(std::int64_t end, std::int64_t deciding,
             std::array<std::uint32_t, kBack> &path) const noexcept {
    auto state = bestState_;
    for (auto j = deciding; j >= committed_; --j) {
      if (j < end)
        path[static_cast<std::uint32_t>(j) % kBack] = state;
      const auto chain = chain_[state];
      state = state == first_[chain] ? last_[back_[static_cast<std::uint32_t>(j) % kBack][chain]]
                                     : state - 1u;
    }
  }
  std::uint32_t bestState_ = 0u;
  std::uint32_t low_ = kMinInterval, high_ = kMaxInterval, count_ = 0u, states_ = 0u;
  std::array<std::uint32_t, kChains> first_{}, last_{}, tempo_{}, edges_{};
  std::array<std::array<std::uint8_t, kChains>, kChains> sources_{};
  std::array<std::array<double, kChains>, kChains> probability_{};
  std::array<std::array<float, kChains>, kChains> logProbability_{};
  std::array<std::uint8_t, kStates> chain_{};
  std::array<bool, kStates> beat_{};
  std::array<double, kStates> cos_{}, sin_{}, alpha_{}, new_{};
  std::array<float, kStates> dp_{}, nextDp_{};
  std::array<std::array<std::uint8_t, kChains>, kBack> back_{};
  std::array<float, kBack> activation_{};
  std::array<std::uint32_t, kBack> path_{};
  std::array<double, kChains> prior_{}, marginal_{};
  std::array<float, kChains> logPrior_{};
  std::int64_t tick_ = 0, committed_ = 0, regionPeak_ = 0;
  double minPeriod_ = 0.0, lastBeat_ = 0.0, short_ = 0.0, long_ = 0.0, period_ = 0.0;
  double confidence_ = 0.0, evidence_ = 0.0, regionPeriod_ = 0.0;
  float regionActivation_ = 0.0f;
  bool shown_ = false, region_ = false;
};
} // namespace effetune::plugins::analyzer::rhythm_a3

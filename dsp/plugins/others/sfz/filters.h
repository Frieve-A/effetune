#ifndef EFFETUNE_SFZ_FILTERS_H
#define EFFETUNE_SFZ_FILTERS_H
#include "SFZModulationSchema.h"
#include "effetune/dsp/denormal.h"
#include <array>
#include <cmath>
#include <cstdint>
#include <span>

namespace effetune::plugins::others::sfz {
// The public filter names specify responses, not reference-engine coefficients.
// One-pole band filters use one pole on each edge; higher-order low/high filters
// use Butterworth sections. SV filters use a trapezoidal state-variable topology.
// Comb and pink responses are independently authored, rate-aware profiles.
struct CombWrite {
  std::uint32_t index = 0;
  float previous = 0;
};
struct CombJournal {
  std::span<CombWrite> entries;
  std::uint32_t count = 0;
  bool record(std::uint32_t index, float previous) noexcept {
    if (count == entries.size())
      return false;
    entries[count++] = {index, previous};
    return true;
  }
  void rollback(std::span<float> storage) noexcept {
    while (count) {
      const auto &entry = entries[--count];
      storage[entry.index] = entry.previous;
    }
  }
};

class VoiceFilter {
public:
  using Type = schema::FilterType;
  static constexpr std::uint32_t maximumCombFrames(float rate) noexcept {
    return static_cast<std::uint32_t>(rate / 5.0F) + 3u;
  }
  void reset() noexcept {
    for (auto &section : sections_)
      section.state = {};
    sv_ = {};
    pink_ = {};
    comb_position_ = comb_valid_ = 0;
  }
  void copyConfiguration(const VoiceFilter &source) noexcept {
    if (type_ == source.type_ && frequency_ == source.frequency_ &&
        resonance_ == source.resonance_ && gain_ == source.gain_ && rate_ == source.rate_)
      return;
    if (type_ != source.type_ || rate_ != source.rate_)
      reset();
    type_ = source.type_;
    frequency_ = source.frequency_;
    resonance_ = source.resonance_;
    gain_ = source.gain_;
    rate_ = source.rate_;
    section_count_ = source.section_count_;
    for (auto i = 0u; i < sections_.size(); ++i)
      static_cast<Coefficients &>(sections_[i]) = source.sections_[i];
    sv_g_ = source.sv_g_;
    sv_k_ = source.sv_k_;
    sv_a_ = source.sv_a_;
    pink_b_ = source.pink_b_;
    pink_a_ = source.pink_a_;
    pink_weight_ = source.pink_weight_;
    comb_delay_ = source.comb_delay_;
    comb_feedback_ = source.comb_feedback_;
  }
  bool configure(std::uint32_t type, float frequency, float resonance, float gain,
                 float rate) noexcept {
    if (type > static_cast<std::uint32_t>(Type::peq) || !std::isfinite(frequency) ||
        !std::isfinite(resonance) || !std::isfinite(gain) || !std::isfinite(rate) || rate < 1)
      return false;
    const auto upper = rate * .45F, lower = upper < 5 ? upper : 5;
    frequency = frequency < lower ? lower : frequency > upper ? upper : frequency;
    resonance = resonance < 0 ? 0 : resonance > 40 ? 40 : resonance;
    gain = gain < -144 ? -144 : gain > 144 ? 144 : gain;
    if (type_ == type && frequency_ == frequency && resonance_ == resonance && gain_ == gain &&
        rate_ == rate)
      return true;
    if (type_ != type || rate_ != rate)
      reset();
    type_ = type;
    frequency_ = frequency;
    resonance_ = resonance;
    gain_ = gain;
    rate_ = rate;
    section_count_ = 0;
    if (!type)
      return true;
    const auto omega = 6.283185307179586 * frequency / rate;
    const auto q = .70710678 * std::pow(10.0, resonance * .05);
    const auto mode = static_cast<Type>(type);
    if (mode == Type::lpf_1p || mode == Type::hpf_1p || mode == Type::apf_1p) {
      onePole(sections_[0], mode, omega);
      section_count_ = 1;
    } else if (mode == Type::bpf_1p || mode == Type::brf_1p) {
      onePole(sections_[0], Type::hpf_1p, omega);
      onePole(sections_[1], Type::lpf_1p, omega);
      section_count_ = 2;
    } else if (type >= static_cast<std::uint32_t>(Type::lpf_2p_sv) &&
               type <= static_cast<std::uint32_t>(Type::pkf_2p)) {
      sv_g_ = std::tan(omega * .5F);
      sv_k_ = 1 / q;
      sv_a_ = 1 / (1 + sv_g_ * (sv_g_ + sv_k_));
    } else if (mode == Type::lpf_4p || mode == Type::hpf_4p || mode == Type::lpf_6p ||
               mode == Type::hpf_6p) {
      const bool high = mode == Type::hpf_4p || mode == Type::hpf_6p;
      section_count_ = mode == Type::lpf_4p || mode == Type::hpf_4p ? 2u : 3u;
      const auto order = 2u * section_count_;
      const auto boost = std::pow(10.0, resonance / (20.0 * section_count_));
      for (auto i = 0u; i < section_count_; ++i) {
        const auto stageQ = .5 / std::cos(3.141592653589793 * (2u * i + 1u) / (2u * order));
        biquad(sections_[i], high ? Type::hpf_2p : Type::lpf_2p, omega, stageQ * boost, 0);
      }
    } else if (mode == Type::comb) {
      comb_delay_ = rate / frequency;
      comb_feedback_ = 1 - std::pow(10.0F, -.05F * resonance);
    } else if (mode == Type::pink) {
      const auto low = rate / 4096.0F;
      auto weightSum = 0.0F;
      for (auto i = 0u; i < pink_.size(); ++i) {
        const auto hz = low * std::pow(1843.2F, static_cast<float>(i) / (pink_.size() - 1u));
        const auto k = std::tan(3.141592653589793F * hz / rate);
        pink_b_[i] = k / (1 + k);
        pink_a_[i] = (k - 1) / (1 + k);
        pink_weight_[i] = 1 / std::sqrt(hz);
        weightSum += pink_weight_[i];
      }
      for (auto &weight : pink_weight_)
        weight /= weightSum;
    } else {
      biquad(sections_[0], mode, omega, q, gain);
      section_count_ = 1;
    }
    return true;
  }
  bool process(float &left, float &right, std::span<float> comb = {},
               CombJournal *journal = nullptr) noexcept {
    left = dsp::flushSubnormal(left);
    right = dsp::flushSubnormal(right);
    if (!type_)
      return true;
    if (type_ == static_cast<std::uint32_t>(Type::comb)) {
      const auto frames = comb.size() / 2u;
      if (frames < 3u || comb_delay_ + 1 >= frames ||
          (journal && journal->entries.size() - journal->count < 2u))
        return false;
      for (auto channel = 0u; channel < 2u; ++channel) {
        auto &input = channel ? right : left;
        const auto integer = static_cast<std::uint32_t>(comb_delay_);
        const auto fraction = comb_delay_ - integer;
        const auto read = [&](std::uint32_t age) {
          return age <= comb_valid_
                     ? comb[channel * frames + (comb_position_ + frames - age) % frames]
                     : 0.0F;
        };
        const auto delayed = read(integer) * (1 - fraction) + read(integer + 1u) * fraction;
        const auto output = dsp::flushSubnormal(input + comb_feedback_ * delayed);
        const auto index = static_cast<std::uint32_t>(channel * frames + comb_position_);
        if (journal)
          journal->record(index, comb[index]);
        comb[index] = input = output;
      }
      comb_position_ = static_cast<std::uint32_t>((comb_position_ + 1u) % frames);
      if (comb_valid_ + 1u < frames)
        ++comb_valid_;
      return true;
    }
    for (auto channel = 0u; channel < 2u; ++channel) {
      auto &input = channel ? right : left;
      const auto original = input;
      if (type_ >= static_cast<std::uint32_t>(Type::lpf_2p_sv) &&
          type_ <= static_cast<std::uint32_t>(Type::pkf_2p)) {
        auto &state = sv_[channel];
        const auto band = sv_a_ * (state[0] + sv_g_ * (input - state[1]));
        const auto low = state[1] + sv_g_ * band;
        state[0] = dsp::flushSubnormal(2 * band - state[0]);
        state[1] = dsp::flushSubnormal(2 * low - state[1]);
        const auto high = input - sv_k_ * band - low;
        input = dsp::flushSubnormal(static_cast<float>(
            type_ == static_cast<std::uint32_t>(Type::lpf_2p_sv)   ? low
            : type_ == static_cast<std::uint32_t>(Type::hpf_2p_sv) ? high
            : type_ == static_cast<std::uint32_t>(Type::bpf_2p_sv) ? sv_k_ * band
            : type_ == static_cast<std::uint32_t>(Type::brf_2p_sv) ? high + low
                                                                   : low - high));
      } else if (type_ == static_cast<std::uint32_t>(Type::pink)) {
        auto output = 0.0F;
        for (auto i = 0u; i < pink_.size(); ++i) {
          auto &state = pink_[i][channel];
          const auto value = dsp::flushSubnormal(pink_b_[i] * input + state);
          state = dsp::flushSubnormal(pink_b_[i] * input - pink_a_[i] * value);
          output += pink_weight_[i] * value;
        }
        input = dsp::flushSubnormal(output);
      } else {
        for (auto i = 0u; i < section_count_; ++i)
          input = sections_[i].process(input, channel);
        if (type_ == static_cast<std::uint32_t>(Type::bpf_1p))
          input *= 2;
        else if (type_ == static_cast<std::uint32_t>(Type::brf_1p))
          input = original - 2 * input;
      }
    }
    return true;
  }

private:
  struct Coefficients {
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  };
  struct Section : Coefficients {
    std::array<std::array<double, 2>, 2> state{};
    float process(float input, unsigned channel) noexcept {
      auto &s = state[channel];
      const auto output = b0 * input + s[0];
      s[0] = dsp::flushSubnormal(b1 * input - a1 * output + s[1]);
      s[1] = dsp::flushSubnormal(b2 * input - a2 * output);
      return dsp::flushSubnormal(static_cast<float>(output));
    }
  };
  static void onePole(Section &s, Type type, double omega) noexcept {
    const auto k = std::tan(omega * .5), scale = 1.0 / (1 + k);
    s.a1 = (k - 1) * scale;
    s.a2 = s.b2 = 0;
    s.b0 = type == Type::lpf_1p ? k * scale : type == Type::apf_1p ? s.a1 : scale;
    s.b1 = type == Type::lpf_1p ? s.b0 : type == Type::apf_1p ? 1 : -s.b0;
  }
  static void biquad(Section &s, Type type, double omega, double q, double gain) noexcept {
    const auto cosine = std::cos(omega), sine = std::sin(omega);
    const auto alpha = sine / (2 * q);
    auto a0 = 1 + alpha;
    s.a1 = -2 * cosine;
    s.a2 = 1 - alpha;
    if (type == Type::lpf_2p) {
      s.b0 = s.b2 = (1 - cosine) * .5F;
      s.b1 = 1 - cosine;
    } else if (type == Type::hpf_2p) {
      s.b0 = s.b2 = (1 + cosine) * .5F;
      s.b1 = -(1 + cosine);
    } else if (type == Type::bpf_2p) {
      s.b0 = alpha;
      s.b1 = 0;
      s.b2 = -alpha;
    } else if (type == Type::brf_2p) {
      s.b0 = s.b2 = 1;
      s.b1 = -2 * cosine;
    } else if (type == Type::peq) {
      const auto a = std::pow(10.0, gain / 40);
      s.b0 = 1 + alpha * a;
      s.b1 = -2 * cosine;
      s.b2 = 1 - alpha * a;
      a0 = 1 + alpha / a;
      s.a2 = 1 - alpha / a;
    } else {
      const auto a = std::pow(10.0, gain / 40), root = 2 * std::sqrt(a) * alpha;
      if (type == Type::lsh) {
        s.b0 = a * (a + 1 - (a - 1) * cosine + root);
        s.b1 = 2 * a * (a - 1 - (a + 1) * cosine);
        s.b2 = a * (a + 1 - (a - 1) * cosine - root);
        a0 = a + 1 + (a - 1) * cosine + root;
        s.a1 = -2 * (a - 1 + (a + 1) * cosine);
        s.a2 = a + 1 + (a - 1) * cosine - root;
      } else {
        s.b0 = a * (a + 1 + (a - 1) * cosine + root);
        s.b1 = -2 * a * (a - 1 + (a + 1) * cosine);
        s.b2 = a * (a + 1 + (a - 1) * cosine - root);
        a0 = a + 1 - (a - 1) * cosine + root;
        s.a1 = 2 * (a - 1 - (a + 1) * cosine);
        s.a2 = a + 1 - (a - 1) * cosine - root;
      }
    }
    const auto scale = 1 / a0;
    s.b0 *= scale;
    s.b1 *= scale;
    s.b2 *= scale;
    s.a1 *= scale;
    s.a2 *= scale;
  }
  std::array<Section, 3> sections_{};
  std::array<std::array<double, 2>, 2> sv_{};
  std::array<std::array<float, 2>, 8> pink_{};
  std::array<float, 8> pink_b_{}, pink_a_{}, pink_weight_{};
  float frequency_ = -1, resonance_ = -1, gain_ = -1, rate_ = 0;
  double sv_g_ = 0, sv_k_ = 0, sv_a_ = 0;
  float comb_delay_ = 1, comb_feedback_ = 0;
  std::uint32_t type_ = 0, section_count_ = 0, comb_position_ = 0, comb_valid_ = 0;
};
} // namespace effetune::plugins::others::sfz
#endif

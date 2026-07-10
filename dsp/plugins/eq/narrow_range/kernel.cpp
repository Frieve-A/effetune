#include "effetune/kernel.h"
#include "NarrowRangePluginParams.h"
#include "effetune/dsp/biquad.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::eq {
namespace {

constexpr std::size_t kMaximumStages = 4u;
constexpr double kPi = 3.141592653589793;
constexpr double kSqrtTwo = 1.4142135623730951;

using Coefficients = dsp::BiquadCoefficients;
using State = dsp::BiquadDf1State;

struct StageCounts final {
  std::size_t firstOrder = 0u;
  std::size_t secondOrder = 0u;
};

struct FilterBank final {
  StageCounts counts{};
  Coefficients firstOrder{};
  Coefficients secondOrder{};
  std::vector<State> states;
};

StageCounts computeStageCounts(float raw_slope) noexcept {
  const double slope = static_cast<double>(raw_slope);
  const double absolute_slope = slope < 0.0 ? -slope : slope;
  if (absolute_slope < 3.0) {
    return {};
  }
  const int order = static_cast<int>(absolute_slope / 6.0 + 0.5);
  if (order == 0) {
    return {};
  }
  if (order % 2 != 0) {
    return {1u, static_cast<std::size_t>((order - 1) >> 1)};
  }
  return {0u, static_cast<std::size_t>(order >> 1)};
}

Coefficients designFirstOrder(double sample_rate, double frequency, bool high_pass) noexcept {
  const double tangent_argument = kPi * frequency / sample_rate;
  if (frequency <= 0.0 || tangent_argument >= kPi * 0.5 - 1.0e-9) {
    return {};
  }
  const double c = std::tan(tangent_argument);
  const double one_plus_c = 1.0 + c;
  const double inverse = one_plus_c != 0.0 ? 1.0 / one_plus_c : 0.0;
  const double a1 = -(1.0 - c) * inverse;
  if (high_pass) {
    return {inverse, -inverse, 0.0, a1, 0.0};
  }
  const double c_term = c * inverse;
  return {c_term, c_term, 0.0, a1, 0.0};
}

Coefficients designSecondOrder(double sample_rate, double frequency, bool high_pass) noexcept {
  if (frequency <= 0.0 || frequency >= sample_rate * 0.5) {
    return {};
  }
  const double omega = 2.0 * kPi * frequency / sample_rate;
  const double cosine = std::cos(omega);
  const double alpha = std::sin(omega) * (kSqrtTwo * 0.5);
  const double inverse_a0 = 1.0 / (1.0 + alpha);
  const double a1 = (-2.0 * cosine) * inverse_a0;
  const double a2 = (1.0 - alpha) * inverse_a0;
  if (high_pass) {
    const double b0 = ((1.0 + cosine) * 0.5) * inverse_a0;
    return {b0, -(1.0 + cosine) * inverse_a0, b0, a1, a2};
  }
  const double b0 = ((1.0 - cosine) * 0.5) * inverse_a0;
  return {b0, (1.0 - cosine) * inverse_a0, b0, a1, a2};
}

} // namespace

class NarrowRangeKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::NarrowRangePluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    const std::size_t state_count = kMaximumStages * static_cast<std::size_t>(max_channels_);
    high_pass_.states.resize(state_count);
    low_pass_.states.resize(state_count);
  }

  void reset() noexcept override {
    slopes_cached_ = false;
    high_frequency_cached_ = false;
    low_frequency_cached_ = false;
    states_initialized_ = false;
    for (State &state : high_pass_.states) {
      state.reset();
    }
    for (State &state : low_pass_.states) {
      state.reset();
    }
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }

    bool reinitialize = false;
    bool recalculate_high = false;
    bool recalculate_low = false;
    if (!slopes_cached_ || last_high_slope_ != params_.highPassSlope ||
        last_low_slope_ != params_.lowPassSlope) {
      last_high_slope_ = params_.highPassSlope;
      last_low_slope_ = params_.lowPassSlope;
      high_pass_.counts = computeStageCounts(params_.highPassSlope);
      low_pass_.counts = computeStageCounts(params_.lowPassSlope);
      slopes_cached_ = true;
      states_initialized_ = false;
      reinitialize = true;
    }
    if (!high_frequency_cached_ || last_high_frequency_ != params_.highPassFrequency) {
      last_high_frequency_ = params_.highPassFrequency;
      high_frequency_cached_ = true;
      recalculate_high = true;
    }
    if (!low_frequency_cached_ || last_low_frequency_ != params_.lowPassFrequency) {
      last_low_frequency_ = params_.lowPassFrequency;
      low_frequency_cached_ = true;
      recalculate_low = true;
    }

    if (reinitialize || !states_initialized_) {
      initializeStates(high_pass_, channel_count);
      initializeStates(low_pass_, channel_count);
      states_initialized_ = true;
      reinitialize = true;
      recalculate_high = true;
      recalculate_low = true;
    }
    if (recalculate_high || reinitialize) {
      const double frequency = static_cast<double>(params_.highPassFrequency);
      high_pass_.firstOrder = designFirstOrder(sample_rate_, frequency, true);
      high_pass_.secondOrder = designSecondOrder(sample_rate_, frequency, true);
    }
    if (recalculate_low || reinitialize) {
      const double frequency = static_cast<double>(params_.lowPassFrequency);
      low_pass_.firstOrder = designFirstOrder(sample_rate_, frequency, false);
      low_pass_.secondOrder = designSecondOrder(sample_rate_, frequency, false);
    }

    if (totalStages(high_pass_) == 0u && totalStages(low_pass_) == 0u) {
      return;
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        double sample = static_cast<double>(audio[offset + frame]);
        sample = processBankSample(high_pass_, sample, channel);
        sample = processBankSample(low_pass_, sample, channel);
        audio[offset + frame] = static_cast<float>(sample);
      }
    }
  }

private:
  [[nodiscard]] static std::size_t totalStages(const FilterBank &bank) noexcept {
    return bank.counts.firstOrder + bank.counts.secondOrder;
  }

  void initializeStates(FilterBank &bank, std::uint32_t channel_count) noexcept {
    const double positive_seed = static_cast<double>(static_cast<float>(1.0e-25));
    const double negative_seed = static_cast<double>(static_cast<float>(-1.0e-25));
    std::size_t stage = 0u;
    for (; stage < bank.counts.firstOrder; ++stage) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        State &state = bank.states[stage * max_channels_ + channel];
        state.reset();
        state.x1 = positive_seed;
        state.y1 = positive_seed;
      }
    }
    for (; stage < totalStages(bank); ++stage) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        State &state = bank.states[stage * max_channels_ + channel];
        state.x1 = positive_seed;
        state.x2 = negative_seed;
        state.y1 = positive_seed;
        state.y2 = negative_seed;
      }
    }
  }

  double processBankSample(FilterBank &bank, double input, std::uint32_t channel) noexcept {
    std::size_t stage = 0u;
    for (; stage < bank.counts.firstOrder; ++stage) {
      State &state = bank.states[stage * max_channels_ + channel];
      input = dsp::processBiquadDf1Sample(input, bank.firstOrder, state);
      dsp::quantizeBiquadStateToFloat(state);
    }
    for (; stage < totalStages(bank); ++stage) {
      State &state = bank.states[stage * max_channels_ + channel];
      input = dsp::processBiquadDf1Sample(input, bank.secondOrder, state);
      dsp::quantizeBiquadStateToFloat(state);
    }
    return input;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  float last_high_frequency_ = 0.0F;
  float last_low_frequency_ = 0.0F;
  float last_high_slope_ = 0.0F;
  float last_low_slope_ = 0.0F;
  bool slopes_cached_ = false;
  bool high_frequency_cached_ = false;
  bool low_frequency_cached_ = false;
  bool states_initialized_ = false;
  FilterBank high_pass_;
  FilterBank low_pass_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(NarrowRangePlugin, effetune::plugins::eq::NarrowRangeKernel)

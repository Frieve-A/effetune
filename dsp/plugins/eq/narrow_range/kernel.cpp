#include "effetune/kernel.h"
#include "NarrowRangePluginParams.h"
#include "effetune/dsp/biquad.h"

#include <algorithm>
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
  Coefficients targetFirstOrder{};
  Coefficients targetSecondOrder{};
  Coefficients firstOrderStep{};
  Coefficients secondOrderStep{};
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
    const auto requested_frames = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005));
    ramp_frames_ = requested_frames == 0u ? 1u : requested_frames;
  }

  void reset() noexcept override {
    slopes_cached_ = false;
    high_frequency_cached_ = false;
    low_frequency_cached_ = false;
    states_initialized_ = false;
    ramp_remaining_ = 0u;
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
    if (recalculate_high || recalculate_low || reinitialize)
      retargetFrequencies(reinitialize);

    if (totalStages(high_pass_) == 0u && totalStages(low_pass_) == 0u) {
      return;
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const std::uint32_t elapsed = frame + 1u;
        const double position =
            static_cast<double>(elapsed < ramp_remaining_ ? elapsed : ramp_remaining_);
        double sample = static_cast<double>(audio[offset + frame]);
        sample = processBankSample(
            high_pass_, sample, channel,
            interpolate(high_pass_.firstOrder, high_pass_.firstOrderStep, position),
            interpolate(high_pass_.secondOrder, high_pass_.secondOrderStep, position));
        sample = processBankSample(
            low_pass_, sample, channel,
            interpolate(low_pass_.firstOrder, low_pass_.firstOrderStep, position),
            interpolate(low_pass_.secondOrder, low_pass_.secondOrderStep, position));
        audio[offset + frame] = static_cast<float>(sample);
      }
    }
    advanceFrequencies(frame_count);
  }

private:
  static Coefficients interpolate(const Coefficients &from, const Coefficients &step,
                                  double position) noexcept {
    return {from.b0 + step.b0 * position, from.b1 + step.b1 * position,
            from.b2 + step.b2 * position, from.a1 + step.a1 * position,
            from.a2 + step.a2 * position};
  }

  static Coefficients difference(const Coefficients &from, const Coefficients &to,
                                 double scale) noexcept {
    return {(to.b0 - from.b0) * scale, (to.b1 - from.b1) * scale, (to.b2 - from.b2) * scale,
            (to.a1 - from.a1) * scale, (to.a2 - from.a2) * scale};
  }

  void retargetFrequencies(bool snap) noexcept {
    high_pass_.targetFirstOrder =
        designFirstOrder(sample_rate_, static_cast<double>(params_.highPassFrequency), true);
    high_pass_.targetSecondOrder =
        designSecondOrder(sample_rate_, static_cast<double>(params_.highPassFrequency), true);
    low_pass_.targetFirstOrder =
        designFirstOrder(sample_rate_, static_cast<double>(params_.lowPassFrequency), false);
    low_pass_.targetSecondOrder =
        designSecondOrder(sample_rate_, static_cast<double>(params_.lowPassFrequency), false);
    if (snap) {
      high_pass_.firstOrder = high_pass_.targetFirstOrder;
      high_pass_.secondOrder = high_pass_.targetSecondOrder;
      low_pass_.firstOrder = low_pass_.targetFirstOrder;
      low_pass_.secondOrder = low_pass_.targetSecondOrder;
      ramp_remaining_ = 0u;
      return;
    }
    const double inverse = 1.0 / static_cast<double>(ramp_frames_);
    high_pass_.firstOrderStep =
        difference(high_pass_.firstOrder, high_pass_.targetFirstOrder, inverse);
    high_pass_.secondOrderStep =
        difference(high_pass_.secondOrder, high_pass_.targetSecondOrder, inverse);
    low_pass_.firstOrderStep =
        difference(low_pass_.firstOrder, low_pass_.targetFirstOrder, inverse);
    low_pass_.secondOrderStep =
        difference(low_pass_.secondOrder, low_pass_.targetSecondOrder, inverse);
    ramp_remaining_ = ramp_frames_;
  }

  void advanceFrequencies(std::uint32_t frames) noexcept {
    const std::uint32_t advanced = frames < ramp_remaining_ ? frames : ramp_remaining_;
    const double position = static_cast<double>(advanced);
    high_pass_.firstOrder = interpolate(high_pass_.firstOrder, high_pass_.firstOrderStep, position);
    high_pass_.secondOrder =
        interpolate(high_pass_.secondOrder, high_pass_.secondOrderStep, position);
    low_pass_.firstOrder = interpolate(low_pass_.firstOrder, low_pass_.firstOrderStep, position);
    low_pass_.secondOrder = interpolate(low_pass_.secondOrder, low_pass_.secondOrderStep, position);
    ramp_remaining_ -= advanced;
    if (ramp_remaining_ == 0u) {
      high_pass_.firstOrder = high_pass_.targetFirstOrder;
      high_pass_.secondOrder = high_pass_.targetSecondOrder;
      low_pass_.firstOrder = low_pass_.targetFirstOrder;
      low_pass_.secondOrder = low_pass_.targetSecondOrder;
    }
  }

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

  double processBankSample(FilterBank &bank, double input, std::uint32_t channel,
                           const Coefficients &first, const Coefficients &second) noexcept {
    std::size_t stage = 0u;
    for (; stage < bank.counts.firstOrder; ++stage) {
      State &state = bank.states[stage * max_channels_ + channel];
      input = dsp::processBiquadDf1Sample(input, first, state);
      dsp::quantizeBiquadStateToFloat(state);
    }
    for (; stage < totalStages(bank); ++stage) {
      State &state = bank.states[stage * max_channels_ + channel];
      input = dsp::processBiquadDf1Sample(input, second, state);
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
  std::uint32_t ramp_frames_ = 240u;
  std::uint32_t ramp_remaining_ = 0u;
  FilterBank high_pass_;
  FilterBank low_pass_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(NarrowRangePlugin, effetune::plugins::eq::NarrowRangeKernel)

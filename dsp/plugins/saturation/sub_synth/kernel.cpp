#include "effetune/kernel.h"
#include "SubSynthPluginParams.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::saturation {
namespace {

constexpr double kPi = 3.141592653589793;
constexpr double kTwoPi = 6.283185307179586;
constexpr double kInverseSqrtTwo = 0.7071067811865475;
constexpr std::uint32_t kMaximumStages = 2u;

struct StageLayout final {
  std::uint32_t order1 = 0u;
  std::uint32_t order2 = 0u;

  [[nodiscard]] std::uint32_t total() const noexcept { return order1 + order2; }
};

struct FirstOrderCoefficients final {
  double b0 = 0.0;
  double b1 = 0.0;
  double a1 = 0.0;
};

struct SecondOrderCoefficients final {
  double b0 = 0.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
};

struct FilterState final {
  double x1 = 0.0;
  double x2 = 0.0;
  double y1 = 0.0;
  double y2 = 0.0;
};

StageLayout computeStages(float slope_value) noexcept {
  if (!std::isfinite(slope_value)) {
    return {};
  }
  constexpr float minimum_slope = -static_cast<float>(kMaximumStages * 12u);
  if (slope_value < minimum_slope) {
    slope_value = minimum_slope;
  }
  if (slope_value > 0.0F) {
    slope_value = 0.0F;
  }
  const int magnitude = -static_cast<int>(slope_value);
  const std::uint32_t count = static_cast<std::uint32_t>(magnitude / 6);
  if (magnitude == 0) {
    return {};
  }
  if ((count & 1u) != 0u) {
    return {1u, (count - 1u) / 2u};
  }
  return {0u, count / 2u};
}

FirstOrderCoefficients firstOrderLowpass(double frequency, double sample_rate) noexcept {
  const double coefficient = std::tan(kPi * frequency / sample_rate);
  const double denominator = 1.0 + coefficient;
  return {coefficient / denominator, coefficient / denominator,
          -((1.0 - coefficient) / denominator)};
}

FirstOrderCoefficients firstOrderHighpass(double frequency, double sample_rate) noexcept {
  const double coefficient = std::tan(kPi * frequency / sample_rate);
  const double inverse = 1.0 / (1.0 + coefficient);
  return {inverse, -inverse, -((1.0 - coefficient) / (1.0 + coefficient))};
}

SecondOrderCoefficients secondOrderLowpass(double frequency, double sample_rate) noexcept {
  const double omega = kTwoPi * frequency / sample_rate;
  const double cosine = std::cos(omega);
  const double alpha = std::sin(omega) / (2.0 * kInverseSqrtTwo);
  const double a0 = 1.0 + alpha;
  return {((1.0 - cosine) * 0.5) / a0, (1.0 - cosine) / a0, ((1.0 - cosine) * 0.5) / a0,
          (-2.0 * cosine) / a0, (1.0 - alpha) / a0};
}

SecondOrderCoefficients secondOrderHighpass(double frequency, double sample_rate) noexcept {
  const double omega = kTwoPi * frequency / sample_rate;
  const double cosine = std::cos(omega);
  const double alpha = std::sin(omega) / (2.0 * kInverseSqrtTwo);
  const double a0 = 1.0 + alpha;
  return {((1.0 + cosine) * 0.5) / a0, (-(1.0 + cosine)) / a0, ((1.0 + cosine) * 0.5) / a0,
          (-2.0 * cosine) / a0, (1.0 - alpha) / a0};
}

double processFirstOrder(double input, FilterState &state,
                         const FirstOrderCoefficients &coefficients) noexcept {
  const double output =
      coefficients.b0 * input + coefficients.b1 * state.x1 - coefficients.a1 * state.y1;
  state.x1 = input;
  state.y1 = output;
  return output;
}

double processSecondOrder(double input, FilterState &state,
                          const SecondOrderCoefficients &coefficients) noexcept {
  const double output = coefficients.b0 * input + coefficients.b1 * state.x1 +
                        coefficients.b2 * state.x2 - coefficients.a1 * state.y1 -
                        coefficients.a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = input;
  state.y2 = state.y1;
  state.y1 = output;
  return output;
}

} // namespace

class SubSynthKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::SubSynthPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    const std::size_t state_count = static_cast<std::size_t>(max_channels_) * kMaximumStages;
    sub_lowpass_states_.resize(state_count);
    sub_highpass_states_.resize(state_count);
    dry_highpass_states_.resize(state_count);
  }

  void reset() noexcept override {
    clearStates();
    initialized_ = false;
    sub_lowpass_layout_ = {};
    sub_highpass_layout_ = {};
    dry_highpass_layout_ = {};
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }

    const StageLayout sub_lowpass = computeStages(params_.subLowPassSlope);
    const StageLayout sub_highpass = computeStages(params_.subHighPassSlope);
    const StageLayout dry_highpass = computeStages(params_.dryHighPassSlope);
    if (!initialized_) {
      clearStates();
      sub_lowpass_layout_ = sub_lowpass;
      sub_highpass_layout_ = sub_highpass;
      dry_highpass_layout_ = dry_highpass;
      initialized_ = true;
    } else {
      if (!sameShape(sub_lowpass_layout_, sub_lowpass)) {
        clearStates(sub_lowpass_states_);
        sub_lowpass_layout_ = sub_lowpass;
      }
      if (!sameShape(sub_highpass_layout_, sub_highpass)) {
        clearStates(sub_highpass_states_);
        sub_highpass_layout_ = sub_highpass;
      }
      if (!sameShape(dry_highpass_layout_, dry_highpass)) {
        clearStates(dry_highpass_states_);
        dry_highpass_layout_ = dry_highpass;
      }
    }

    const FirstOrderCoefficients sub_lowpass_first =
        firstOrderLowpass(static_cast<double>(params_.subLowPassFrequency), sample_rate_);
    const SecondOrderCoefficients sub_lowpass_second =
        secondOrderLowpass(static_cast<double>(params_.subLowPassFrequency), sample_rate_);
    const FirstOrderCoefficients sub_highpass_first =
        firstOrderHighpass(static_cast<double>(params_.subHighPassFrequency), sample_rate_);
    const SecondOrderCoefficients sub_highpass_second =
        secondOrderHighpass(static_cast<double>(params_.subHighPassFrequency), sample_rate_);
    const FirstOrderCoefficients dry_highpass_first =
        firstOrderHighpass(static_cast<double>(params_.dryHighPassFrequency), sample_rate_);
    const SecondOrderCoefficients dry_highpass_second =
        secondOrderHighpass(static_cast<double>(params_.dryHighPassFrequency), sample_rate_);
    const double sub_gain = static_cast<double>(params_.subLevel) / 100.0;
    const double dry_gain = static_cast<double>(params_.dryLevel) / 100.0;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        double dry = static_cast<double>(audio[offset + frame]);
        double sub = dry >= 0.0 ? dry : -dry;
        if (sub_lowpass.total() != 0u) {
          sub = processChain(sub, channel, sub_lowpass, sub_lowpass_states_, sub_lowpass_first,
                             sub_lowpass_second);
        }
        if (sub_highpass.total() != 0u) {
          sub = processChain(sub, channel, sub_highpass, sub_highpass_states_, sub_highpass_first,
                             sub_highpass_second);
        }
        if (dry_highpass.total() != 0u) {
          dry = processChain(dry, channel, dry_highpass, dry_highpass_states_, dry_highpass_first,
                             dry_highpass_second);
        }
        audio[offset + frame] = static_cast<float>(dry * dry_gain + sub * sub_gain);
      }
    }
  }

private:
  [[nodiscard]] static bool sameShape(const StageLayout &left, const StageLayout &right) noexcept {
    return left.order1 == right.order1 && left.order2 == right.order2;
  }

  static void clearStates(std::vector<FilterState> &states) noexcept {
    for (FilterState &state : states) {
      state = {};
    }
  }

  double processChain(double sample, std::uint32_t channel, const StageLayout &layout,
                      std::vector<FilterState> &states, const FirstOrderCoefficients &first,
                      const SecondOrderCoefficients &second) noexcept {
    std::uint32_t stage_index = 0u;
    if (layout.order1 != 0u) {
      FilterState &state = states[static_cast<std::size_t>(stage_index) * max_channels_ + channel];
      sample = processFirstOrder(sample, state, first);
      ++stage_index;
    }
    for (std::uint32_t stage = 0u; stage < layout.order2; ++stage) {
      FilterState &state = states[static_cast<std::size_t>(stage_index) * max_channels_ + channel];
      sample = processSecondOrder(sample, state, second);
      ++stage_index;
    }
    return sample;
  }

  void clearStates() noexcept {
    clearStates(sub_lowpass_states_);
    clearStates(sub_highpass_states_);
    clearStates(dry_highpass_states_);
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  StageLayout sub_lowpass_layout_{};
  StageLayout sub_highpass_layout_{};
  StageLayout dry_highpass_layout_{};
  bool initialized_ = false;
  std::vector<FilterState> sub_lowpass_states_;
  std::vector<FilterState> sub_highpass_states_;
  std::vector<FilterState> dry_highpass_states_;
};

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(SubSynthPlugin, effetune::plugins::saturation::SubSynthKernel)

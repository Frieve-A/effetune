#include "effetune/kernel.h"
#include "LoPassFilterPluginParams.h"
#include "effetune/dsp/biquad.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::eq {
namespace {

constexpr std::size_t kMaximumSections = 8u;
constexpr double kPi = 3.141592653589793;

using Coefficients = dsp::BiquadCoefficients;
using State = dsp::BiquadDf1State;

Coefficients designFirstOrder(double sample_rate, double frequency) noexcept {
  const double k = 2.0 * sample_rate;
  const double omega = 2.0 * sample_rate * std::tan(kPi * frequency / sample_rate);
  const double a0 = k + omega;
  return {omega / a0, omega / a0, 0.0, (omega - k) / a0, 0.0};
}

Coefficients designSecondOrder(double sample_rate, double frequency, double q) noexcept {
  const double k = 2.0 * sample_rate;
  const double omega = 2.0 * sample_rate * std::tan(kPi * frequency / sample_rate);
  const double k2 = k * k;
  const double omega2 = omega * omega;
  const double k2q = k2 * q;
  const double omega2q = omega2 * q;
  const double a0 = k2q + k * omega + omega2q;
  return {omega2q / a0, 2.0 * omega2q / a0, omega2q / a0, (-2.0 * k2q + 2.0 * omega2q) / a0,
          (k2q - k * omega + omega2q) / a0};
}

std::size_t designSections(double sample_rate, double frequency, int slope,
                           std::array<Coefficients, kMaximumSections> &output) noexcept {
  if (slope == 0 || frequency <= 0.0 || frequency >= sample_rate * 0.5) {
    return 0u;
  }
  const int absolute_slope = slope < 0 ? -slope : slope;
  if (absolute_slope % 12 != 0) {
    return 0u;
  }
  const int order = absolute_slope / 12;
  if (order <= 0 || order > 8) {
    return 0u;
  }

  std::size_t butterworth_count = 0u;
  if (order % 2 != 0) {
    output[butterworth_count++] = designFirstOrder(sample_rate, frequency);
  }
  const int pairs = order / 2;
  for (int index = 1; index <= pairs; ++index) {
    const double theta = static_cast<double>(2 * index - 1) * kPi / static_cast<double>(2 * order);
    const double q = 1.0 / (2.0 * std::sin(theta));
    output[butterworth_count++] = designSecondOrder(sample_rate, frequency, q);
  }

  for (std::size_t index = 0u; index < butterworth_count; ++index) {
    output[butterworth_count + index] = output[index];
  }
  return butterworth_count * 2u;
}

} // namespace

class LoPassFilterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::LoPassFilterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    states_.resize(kMaximumSections * static_cast<std::size_t>(max_channels_));
  }

  void reset() noexcept override {
    configured_ = false;
    section_count_ = 0u;
    for (State &state : states_) {
      state.reset();
    }
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }

    const double frequency = static_cast<double>(params_.frequency);
    const float raw_slope = params_.slope;
    if (!configured_ || last_channel_count_ != channel_count || last_frequency_ != frequency ||
        last_slope_ != raw_slope) {
      configure(channel_count, frequency, raw_slope);
    }
    if (section_count_ == 0u) {
      return;
    }

    for (std::size_t section = 0u; section < section_count_; ++section) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        State &state = states_[section * max_channels_ + channel];
        const std::uint32_t offset = channel * frame_count;
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const double output = dsp::processBiquadDf1Sample(
              static_cast<double>(audio[offset + frame]), coefficients_[section], state);
          audio[offset + frame] = static_cast<float>(output);
        }
        dsp::quantizeBiquadStateToFloat(state);
      }
    }
  }

private:
  void configure(std::uint32_t channel_count, double frequency, float raw_slope) noexcept {
    const double nyquist_limit = sample_rate_ * 0.499;
    const double lower_bounded = frequency < 10.0 ? 10.0 : frequency;
    const double clamped_frequency = lower_bounded > nyquist_limit ? nyquist_limit : lower_bounded;
    section_count_ =
        designSections(sample_rate_, clamped_frequency, static_cast<int>(raw_slope), coefficients_);

    const double positive_seed = static_cast<double>(static_cast<float>(1.0e-25));
    const double negative_seed = static_cast<double>(static_cast<float>(-1.0e-25));
    for (std::size_t section = 0u; section < section_count_; ++section) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        State &state = states_[section * max_channels_ + channel];
        state.x1 = positive_seed;
        state.x2 = negative_seed;
        state.y1 = positive_seed;
        state.y2 = negative_seed;
      }
    }

    last_channel_count_ = channel_count;
    last_frequency_ = frequency;
    last_slope_ = raw_slope;
    configured_ = true;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  double last_frequency_ = 0.0;
  float last_slope_ = 0.0F;
  bool configured_ = false;
  std::size_t section_count_ = 0u;
  std::array<Coefficients, kMaximumSections> coefficients_{};
  std::vector<State> states_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(LoPassFilterPlugin, effetune::plugins::eq::LoPassFilterKernel)

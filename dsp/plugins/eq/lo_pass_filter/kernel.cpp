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
    for (Bank &bank : banks_) {
      bank.states.resize(kMaximumSections * static_cast<std::size_t>(max_channels_));
    }
  }

  void reset() noexcept override {
    configured_ = false;
    fade_remaining_ = 0u;
    for (Bank &bank : banks_) {
      bank.section_count = 0u;
      for (State &state : bank.states)
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
    if (!configured_ || last_channel_count_ != channel_count || last_slope_ != raw_slope) {
      configureInitial(channel_count, frequency, raw_slope);
    } else if (frequency != requested_frequency_) {
      requested_frequency_ = frequency;
      if (fade_remaining_ == 0u)
        beginFrequencyTransition(frequency);
    }
    if (fade_remaining_ == 0u && active_frequency_ != requested_frequency_) {
      beginFrequencyTransition(requested_frequency_);
    }
    if (banks_[active_bank_].section_count == 0u) {
      return;
    }

    if (fade_remaining_ == 0u) {
      processStable(audio, channel_count, frame_count, banks_[active_bank_]);
      return;
    }

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      if (fade_remaining_ == 0u) {
        Bank &bank = banks_[active_bank_];
        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
          audio[index] = processSample(audio[index], channel, bank);
        }
        continue;
      }
      Bank &old_bank = banks_[active_bank_];
      Bank &new_bank = banks_[1u - active_bank_];
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
        const float input = audio[index];
        const float old_output = processSample(input, channel, old_bank);
        const float new_output = processSample(input, channel, new_bank);
        const double fade =
            1.0 - static_cast<double>(fade_remaining_) / static_cast<double>(fade_frames_);
        audio[index] = static_cast<float>(static_cast<double>(old_output) +
                                          (static_cast<double>(new_output) - old_output) * fade);
      }
      --fade_remaining_;
      if (fade_remaining_ == 0u) {
        active_bank_ = 1u - active_bank_;
        active_frequency_ = transition_frequency_;
        if (active_frequency_ != requested_frequency_) {
          beginFrequencyTransition(requested_frequency_);
        }
      }
    }
    quantizeStates(channel_count, banks_[0u]);
    quantizeStates(channel_count, banks_[1u]);
  }

private:
  struct Bank {
    std::array<Coefficients, kMaximumSections> coefficients{};
    std::vector<State> states;
    std::size_t section_count = 0u;
  };

  void design(Bank &bank, double frequency, float raw_slope) noexcept {
    const double nyquist_limit = sample_rate_ * 0.499;
    const double lower_bounded = frequency < 10.0 ? 10.0 : frequency;
    const double clamped_frequency = lower_bounded > nyquist_limit ? nyquist_limit : lower_bounded;
    bank.section_count = designSections(sample_rate_, clamped_frequency,
                                        static_cast<int>(raw_slope), bank.coefficients);
  }

  void seedStates(Bank &bank, std::uint32_t channel_count) noexcept {
    const double positive_seed = static_cast<double>(static_cast<float>(1.0e-25));
    const double negative_seed = static_cast<double>(static_cast<float>(-1.0e-25));
    for (State &state : bank.states)
      state.reset();
    for (std::size_t section = 0u; section < bank.section_count; ++section) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        State &state = bank.states[section * max_channels_ + channel];
        state.x1 = positive_seed;
        state.x2 = negative_seed;
        state.y1 = positive_seed;
        state.y2 = negative_seed;
      }
    }
  }

  void configureInitial(std::uint32_t channel_count, double frequency, float raw_slope) noexcept {
    active_bank_ = 0u;
    design(banks_[active_bank_], frequency, raw_slope);
    seedStates(banks_[active_bank_], channel_count);
    banks_[1u].section_count = banks_[0u].section_count;
    seedStates(banks_[1u], channel_count);
    const auto requested_frames = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005));
    fade_frames_ = requested_frames == 0u ? 1u : requested_frames;
    fade_remaining_ = 0u;
    last_channel_count_ = channel_count;
    active_frequency_ = requested_frequency_ = transition_frequency_ = frequency;
    last_slope_ = raw_slope;
    configured_ = true;
  }

  void beginFrequencyTransition(double frequency) noexcept {
    Bank &source = banks_[active_bank_];
    Bank &target = banks_[1u - active_bank_];
    design(target, frequency, last_slope_);
    target.states = source.states;
    transition_frequency_ = frequency;
    fade_remaining_ = fade_frames_;
  }

  [[nodiscard]] float processSample(float input, std::uint32_t channel, Bank &bank) noexcept {
    float output = input;
    for (std::size_t section = 0u; section < bank.section_count; ++section) {
      State &state = bank.states[section * max_channels_ + channel];
      output = static_cast<float>(dsp::processBiquadDf1Sample(static_cast<double>(output),
                                                              bank.coefficients[section], state));
    }
    return output;
  }

  void processStable(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                     Bank &bank) noexcept {
    for (std::size_t section = 0u; section < bank.section_count; ++section) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        State &state = bank.states[section * max_channels_ + channel];
        const std::uint32_t offset = channel * frame_count;
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          audio[offset + frame] = static_cast<float>(dsp::processBiquadDf1Sample(
              static_cast<double>(audio[offset + frame]), bank.coefficients[section], state));
        }
        dsp::quantizeBiquadStateToFloat(state);
      }
    }
  }

  void quantizeStates(std::uint32_t channel_count, Bank &bank) noexcept {
    for (std::size_t section = 0u; section < bank.section_count; ++section)
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel)
        dsp::quantizeBiquadStateToFloat(bank.states[section * max_channels_ + channel]);
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  double active_frequency_ = 0.0;
  double requested_frequency_ = 0.0;
  double transition_frequency_ = 0.0;
  float last_slope_ = 0.0F;
  bool configured_ = false;
  std::uint32_t active_bank_ = 0u;
  std::uint32_t fade_frames_ = 1u;
  std::uint32_t fade_remaining_ = 0u;
  std::array<Bank, 2u> banks_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(LoPassFilterPlugin, effetune::plugins::eq::LoPassFilterKernel)

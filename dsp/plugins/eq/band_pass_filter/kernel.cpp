#include "effetune/kernel.h"
#include "BandPassFilterPluginParams.h"
#include "effetune/dsp/biquad.h"
#include "effetune/dsp/denormal_noise.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <utility>
#include <vector>

namespace effetune::plugins::eq {
namespace {

constexpr std::size_t kMaximumSections = 4u;
constexpr double kPi = 3.141592653589793;

using Coefficients = dsp::BiquadCoefficients;
using State = dsp::BiquadDf1State;

struct FilterBank final {
  std::array<Coefficients, kMaximumSections> coefficients{};
  std::vector<State> states;
  std::size_t sectionCount = 0u;
  std::uint32_t lastChannelCount = 0u;
  double lastFrequency = 0.0;
  float lastSlope = 0.0F;
  bool configured = false;
};

Coefficients designFirstOrder(double sample_rate, double frequency, bool high_pass) noexcept {
  const double k = 2.0 * sample_rate;
  const double omega = 2.0 * sample_rate * std::tan(kPi * frequency / sample_rate);
  const double a0 = k + omega;
  if (high_pass) {
    return {-k / a0, k / a0, 0.0, (omega - k) / a0, 0.0};
  }
  return {omega / a0, omega / a0, 0.0, (omega - k) / a0, 0.0};
}

Coefficients designSecondOrder(double sample_rate, double frequency, double q,
                               bool high_pass) noexcept {
  const double k = 2.0 * sample_rate;
  const double omega = 2.0 * sample_rate * std::tan(kPi * frequency / sample_rate);
  const double k2 = k * k;
  const double omega2 = omega * omega;
  const double k2q = k2 * q;
  const double omega2q = omega2 * q;
  const double a0 = k2q + k * omega + omega2q;
  const double a1 = (-2.0 * k2q + 2.0 * omega2q) / a0;
  const double a2 = (k2q - k * omega + omega2q) / a0;
  if (high_pass) {
    return {k2q / a0, -2.0 * k2q / a0, k2q / a0, a1, a2};
  }
  return {omega2q / a0, 2.0 * omega2q / a0, omega2q / a0, a1, a2};
}

std::size_t designSections(double sample_rate, double frequency, int slope, bool high_pass,
                           std::array<Coefficients, kMaximumSections> &output) noexcept {
  if (slope == 0 || frequency <= 0.0 || frequency >= sample_rate * 0.5) {
    return 0u;
  }
  const int absolute_slope = slope < 0 ? -slope : slope;
  if (absolute_slope % 12 != 0) {
    return 0u;
  }
  const int order = absolute_slope / 12;
  if (order <= 0 || order > 4) {
    return 0u;
  }

  std::size_t butterworth_count = 0u;
  if (order % 2 != 0) {
    output[butterworth_count++] = designFirstOrder(sample_rate, frequency, high_pass);
  }
  const int pairs = order / 2;
  for (int index = 1; index <= pairs; ++index) {
    const double theta = static_cast<double>(2 * index - 1) * kPi / static_cast<double>(2 * order);
    const double q = 1.0 / (2.0 * std::sin(theta));
    output[butterworth_count++] = designSecondOrder(sample_rate, frequency, q, high_pass);
  }

  for (std::size_t index = 0u; index < butterworth_count; ++index) {
    output[butterworth_count + index] = output[index];
  }
  return butterworth_count * 2u;
}

} // namespace

class BandPassFilterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::BandPassFilterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    const std::size_t state_count = kMaximumSections * static_cast<std::size_t>(max_channels_);
    for (FilterBank &bank : high_pass_) {
      bank.states.resize(state_count);
    }
    for (FilterBank &bank : low_pass_) {
      bank.states.resize(state_count);
    }
    const std::size_t scratch_count =
        static_cast<std::size_t>(info.maxFrames) * static_cast<std::size_t>(max_channels_);
    active_scratch_.resize(scratch_count);
    target_scratch_.resize(scratch_count);
  }

  void reset() noexcept override {
    for (FilterBank &bank : high_pass_) {
      resetBank(bank);
    }
    for (FilterBank &bank : low_pass_) {
      resetBank(bank);
    }
    active_bank_ = 0u;
    fade_frame_ = 0u;
    fade_frames_ = 0u;
    denormal_noise_.reset();
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }

    const double high_frequency = static_cast<double>(params_.highPassFrequency);
    const double low_frequency = static_cast<double>(params_.lowPassFrequency);
    FilterBank &active_high = high_pass_[active_bank_];
    FilterBank &active_low = low_pass_[active_bank_];

    if (!active_high.configured || !active_low.configured ||
        active_high.lastChannelCount != channel_count ||
        active_low.lastChannelCount != channel_count) {
      reset();
      configureChain(active_bank_, channel_count, high_frequency, low_frequency);
    }

    if (fade_frames_ == 0u && (needsConfiguration(high_pass_[active_bank_], channel_count,
                                                  high_frequency, params_.highPassSlope) ||
                               needsConfiguration(low_pass_[active_bank_], channel_count,
                                                  low_frequency, params_.lowPassSlope))) {
      const std::uint32_t target_bank = 1u - active_bank_;
      configureChain(target_bank, channel_count, high_frequency, low_frequency);
      fade_frame_ = 0u;
      const auto requested_frames = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005));
      fade_frames_ = requested_frames == 0u ? 1u : requested_frames;
    }

    if (fade_frames_ == 0u) {
      applyChain(active_bank_, audio, channel_count, frame_count);
      denormal_noise_.advance(frame_count);
      return;
    }

    const std::size_t sample_count =
        static_cast<std::size_t>(channel_count) * static_cast<std::size_t>(frame_count);
    std::memcpy(active_scratch_.data(), audio, sample_count * sizeof(float));
    std::memcpy(target_scratch_.data(), audio, sample_count * sizeof(float));
    applyChain(active_bank_, active_scratch_.data(), channel_count, frame_count);
    applyChain(1u - active_bank_, target_scratch_.data(), channel_count, frame_count);

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t offset = static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double position =
            static_cast<double>(fade_frame_ + frame + 1u) / static_cast<double>(fade_frames_);
        const double alpha = position < 1.0 ? position : 1.0;
        const std::size_t index = offset + frame;
        audio[index] =
            static_cast<float>(static_cast<double>(active_scratch_[index]) * (1.0 - alpha) +
                               static_cast<double>(target_scratch_[index]) * alpha);
      }
    }

    fade_frame_ += frame_count;
    if (fade_frame_ >= fade_frames_) {
      active_bank_ = 1u - active_bank_;
      fade_frame_ = 0u;
      fade_frames_ = 0u;
    }
    denormal_noise_.advance(frame_count);
  }

private:
  static void resetBank(FilterBank &bank) noexcept {
    bank.configured = false;
    bank.sectionCount = 0u;
    for (State &state : bank.states) {
      state.reset();
    }
  }

  static bool needsConfiguration(const FilterBank &bank, std::uint32_t channel_count,
                                 double frequency, float slope) noexcept {
    return !bank.configured || bank.lastChannelCount != channel_count ||
           bank.lastFrequency != frequency || bank.lastSlope != slope;
  }

  void configureBank(FilterBank &bank, std::uint32_t channel_count, double frequency,
                     float raw_slope, bool high_pass) noexcept {
    const double nyquist_limit = sample_rate_ * 0.45;
    const double lower_bounded = frequency < 10.0 ? 10.0 : frequency;
    const double clamped_frequency = lower_bounded > nyquist_limit ? nyquist_limit : lower_bounded;
    bank.sectionCount = designSections(sample_rate_, clamped_frequency, static_cast<int>(raw_slope),
                                       high_pass, bank.coefficients);

    const double positive_seed = static_cast<double>(static_cast<float>(1.0e-25));
    const double negative_seed = static_cast<double>(static_cast<float>(-1.0e-25));
    for (std::size_t section = 0u; section < bank.sectionCount; ++section) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        State &state = bank.states[section * max_channels_ + channel];
        state.x1 = positive_seed;
        state.x2 = negative_seed;
        state.y1 = positive_seed;
        state.y2 = negative_seed;
      }
    }

    bank.lastChannelCount = channel_count;
    bank.lastFrequency = frequency;
    bank.lastSlope = raw_slope;
    bank.configured = true;
  }

  void configureChain(std::uint32_t bank_index, std::uint32_t channel_count, double high_frequency,
                      double low_frequency) noexcept {
    configureBank(high_pass_[bank_index], channel_count, high_frequency, params_.highPassSlope,
                  true);
    configureBank(low_pass_[bank_index], channel_count, low_frequency, params_.lowPassSlope, false);
  }

  void applyChain(std::uint32_t bank_index, float *audio, std::uint32_t channel_count,
                  std::uint32_t frame_count) noexcept {
    applyBank(high_pass_[bank_index], audio, channel_count, frame_count);
    applyBank(low_pass_[bank_index], audio, channel_count, frame_count);
  }

  void applyBank(FilterBank &bank, float *audio, std::uint32_t channel_count,
                 std::uint32_t frame_count) noexcept {
    for (std::size_t section = 0u; section < bank.sectionCount; ++section) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        State &state = bank.states[section * max_channels_ + channel];
        const std::uint32_t offset = channel * frame_count;
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const double output = dsp::processBiquadDf1SampleWithDenormalNoise(
              static_cast<double>(audio[offset + frame]), bank.coefficients[section], state,
              denormal_noise_.sample(frame));
          audio[offset + frame] = static_cast<float>(output);
        }
      }
    }
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::array<FilterBank, 2u> high_pass_;
  std::array<FilterBank, 2u> low_pass_;
  std::uint32_t active_bank_ = 0u;
  std::uint32_t fade_frame_ = 0u;
  std::uint32_t fade_frames_ = 0u;
  std::vector<float> active_scratch_;
  std::vector<float> target_scratch_;
  dsp::NyquistDenormalNoise denormal_noise_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(BandPassFilterPlugin, effetune::plugins::eq::BandPassFilterKernel)

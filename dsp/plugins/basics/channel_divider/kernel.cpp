#include "effetune/kernel.h"
#include "ChannelDividerPluginParams.h"
#include "binary_io.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace effetune::plugins::basics {
namespace {

constexpr std::uint16_t kTapChannelCount = 9u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kCrossoverCount = 3u;
constexpr std::uint32_t kMaximumSections = 8u;
constexpr double kPi = 3.14159265358979323846264338327950288;

struct Coefficients {
  double b0 = 0.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
};

struct FilterState {
  float x1 = 0.0F;
  float x2 = 0.0F;
  float y1 = 0.0F;
  float y2 = 0.0F;
};

struct FilterBank {
  std::array<Coefficients, kMaximumSections> coefficients{};
  std::array<std::array<FilterState, 2>, kMaximumSections> states{};
  std::uint32_t count = 0u;
};

using binary_io::writeU32;

} // namespace

class ChannelDividerKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::ChannelDividerPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ =
        std::isfinite(info.sampleRate) && info.sampleRate > 0.0F ? info.sampleRate : 48000.0F;
    const std::size_t stereo_frames = static_cast<std::size_t>(info.maxFrames) * 2u;
    input_.resize(stereo_frames);
    temporary_one_.resize(stereo_frames);
    temporary_two_.resize(stereo_frames);
    reset();
  }

  void reset() noexcept override {
    for (auto &set : low_pass_)
      for (FilterBank &bank : set)
        resetBank(bank);
    for (auto &set : high_pass_)
      for (FilterBank &bank : set)
        resetBank(bank);
    configured_ = false;
    configured_channels_ = 0u;
    configured_bands_ = 0u;
    fade_counter_ = 0u;
    fade_length_ = 0u;
    transition_remaining_ = 0u;
    telemetry_channels_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    telemetry_channels_ = channel_count;
    if (audio == nullptr || frame_count == 0u || channel_count < 4u || (channel_count & 1u) != 0u) {
      return;
    }

    const std::uint32_t maximum_bands = channel_count / 2u;
    std::uint32_t band_count = requestedBandCount();
    if (band_count > maximum_bands)
      band_count = maximum_bands;
    if (channel_count == 4u && band_count > 2u)
      band_count = 2u;
    if (channel_count == 6u && band_count > 3u)
      band_count = 3u;

    const std::array<float, kCrossoverCount> frequencies = {finiteOr(params_.frequency1, 2000.0F),
                                                            finiteOr(params_.frequency2, 4000.0F),
                                                            finiteOr(params_.frequency3, 8000.0F)};
    const std::array<float, kCrossoverCount> slopes = {finiteOr(params_.slope1, -24.0F),
                                                       finiteOr(params_.slope2, -24.0F),
                                                       finiteOr(params_.slope3, -24.0F)};

    if (!configured_ || configured_channels_ != channel_count || configured_bands_ != band_count ||
        configured_slopes_ != slopes) {
      configureInitial(channel_count, band_count, frequencies, slopes, frame_count);
    } else if (requested_frequencies_ != frequencies) {
      requested_frequencies_ = frequencies;
      if (transition_remaining_ == 0u)
        beginTransition(frequencies);
    }
    if (transition_remaining_ == 0u && configured_frequencies_ != requested_frequencies_) {
      beginTransition(requested_frequencies_);
    }

    const std::size_t stereo_samples = static_cast<std::size_t>(frame_count) * 2u;
    std::memcpy(input_.data(), audio, stereo_samples * sizeof(float));
    if (transition_remaining_ == 0u) {
      renderBands(input_.data(), audio, channel_count, band_count, frame_count,
                  low_pass_[active_bank_], high_pass_[active_bank_], temporary_one_.data(),
                  temporary_two_.data());
    } else {
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        std::array<float, 8u> active_output{};
        std::array<float, 8u> target_output{};
        const float left = input_[frame];
        const float right = input_[frame_count + frame];
        renderFrame(left, right, band_count, low_pass_[active_bank_], high_pass_[active_bank_],
                    active_output);
        const std::uint32_t target_bank = 1u - active_bank_;
        renderFrame(left, right, band_count, low_pass_[target_bank], high_pass_[target_bank],
                    target_output);
        const double fade = 1.0 - static_cast<double>(transition_remaining_) /
                                      static_cast<double>(transition_length_);
        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
          const double old_sample = channel < active_output.size() ? active_output[channel] : 0.0;
          const double new_sample = channel < target_output.size() ? target_output[channel] : 0.0;
          audio[index] = static_cast<float>(old_sample + (new_sample - old_sample) * fade);
        }
        --transition_remaining_;
        if (transition_remaining_ == 0u) {
          active_bank_ = target_bank;
          configured_frequencies_ = transition_frequencies_;
          if (configured_frequencies_ != requested_frequencies_) {
            beginTransition(requested_frequencies_);
          }
        }
      }
    }

    applyFade(audio, channel_count, frame_count);
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (telemetry_channels_ == 0u)
      return;
    std::array<std::uint8_t, 4> payload{};
    writeU32(payload.data(), telemetry_channels_);
    writer.write(kTapChannelCount, kTelemetryVersion, payload.data(),
                 static_cast<std::uint16_t>(payload.size()));
  }

private:
  static float finiteOr(float value, float fallback) noexcept {
    return std::isfinite(value) ? value : fallback;
  }

  std::uint32_t requestedBandCount() const noexcept {
    if (!std::isfinite(params_.bandCount))
      return 2u;
    const int requested = static_cast<int>(params_.bandCount);
    if (requested < 2)
      return 2u;
    if (requested > 4)
      return 4u;
    return static_cast<std::uint32_t>(requested);
  }

  static void resetBank(FilterBank &bank) noexcept {
    bank.count = 0u;
    constexpr float dc_offset = 1.0e-25F;
    for (auto &stereo_state : bank.states) {
      for (FilterState &state : stereo_state) {
        state.x1 = dc_offset;
        state.x2 = -dc_offset;
        state.y1 = dc_offset;
        state.y2 = -dc_offset;
      }
    }
  }

  static Coefficients designFirstOrder(double sample_rate, double frequency,
                                       bool high_pass) noexcept {
    const double k = 2.0 * sample_rate;
    const double omega = 2.0 * sample_rate * std::tan(kPi * frequency / sample_rate);
    const double a0 = k + omega;
    const double b0 = high_pass ? -k : omega;
    const double b1 = high_pass ? k : omega;
    return {b0 / a0, b1 / a0, 0.0, (omega - k) / a0, 0.0};
  }

  static Coefficients designSecondOrder(double sample_rate, double frequency, double q,
                                        bool high_pass) noexcept {
    const double k = 2.0 * sample_rate;
    const double omega = 2.0 * sample_rate * std::tan(kPi * frequency / sample_rate);
    const double k_squared = k * k;
    const double omega_squared = omega * omega;
    const double k_squared_q = k_squared * q;
    const double omega_squared_q = omega_squared * q;
    const double a0 = k_squared_q + k * omega + omega_squared_q;
    const double numerator = high_pass ? k_squared_q : omega_squared_q;
    return {numerator / a0, (high_pass ? -2.0 * numerator : 2.0 * numerator) / a0, numerator / a0,
            (-2.0 * k_squared_q + 2.0 * omega_squared_q) / a0,
            (k_squared_q - k * omega + omega_squared_q) / a0};
  }

  static void designBank(FilterBank &bank, double sample_rate, double frequency, float slope_value,
                         bool high_pass) noexcept {
    resetBank(bank);
    if (!std::isfinite(slope_value))
      slope_value = -24.0F;
    constexpr float minimum_slope = -static_cast<float>(kMaximumSections * 12u);
    if (slope_value < minimum_slope)
      slope_value = minimum_slope;
    if (slope_value > -12.0F)
      slope_value = -12.0F;
    const int absolute_slope = -static_cast<int>(slope_value);
    if (absolute_slope == 0 || absolute_slope % 12 != 0)
      return;
    int order = absolute_slope / 12;
    if (order > static_cast<int>(kMaximumSections)) {
      order = static_cast<int>(kMaximumSections);
    }
    std::array<Coefficients, kMaximumSections / 2u> butterworth{};
    std::uint32_t count = 0u;
    if ((order & 1) != 0) {
      butterworth[count++] = designFirstOrder(sample_rate, frequency, high_pass);
    }
    const int pairs = order / 2;
    for (int pair = 1; pair <= pairs; ++pair) {
      const double theta = (2.0 * pair - 1.0) * kPi / (2.0 * order);
      const double q = 1.0 / (2.0 * std::sin(theta));
      butterworth[count++] = designSecondOrder(sample_rate, frequency, q, high_pass);
    }
    for (std::uint32_t index = 0u; index < count; ++index) {
      bank.coefficients[index] = butterworth[index];
      bank.coefficients[index + count] = butterworth[index];
    }
    bank.count = count * 2u;
  }

  void designSet(std::uint32_t bank_index, std::uint32_t band_count,
                 const std::array<float, kCrossoverCount> &frequencies,
                 const std::array<float, kCrossoverCount> &slopes, bool preserve_state) noexcept {
    for (std::uint32_t index = 0u; index < kCrossoverCount; ++index) {
      const FilterBank low_state = low_pass_[active_bank_][index];
      const FilterBank high_state = high_pass_[active_bank_][index];
      resetBank(low_pass_[bank_index][index]);
      resetBank(high_pass_[bank_index][index]);
      if (index >= band_count - 1u)
        continue;
      double frequency = static_cast<double>(frequencies[index]);
      const double maximum = static_cast<double>(sample_rate_) * 0.499;
      if (frequency < 10.0)
        frequency = 10.0;
      if (frequency > maximum)
        frequency = maximum;
      designBank(low_pass_[bank_index][index], sample_rate_, frequency, slopes[index], false);
      designBank(high_pass_[bank_index][index], sample_rate_, frequency, slopes[index], true);
      if (preserve_state) {
        low_pass_[bank_index][index].states = low_state.states;
        high_pass_[bank_index][index].states = high_state.states;
      }
    }
  }

  void configureInitial(std::uint32_t channel_count, std::uint32_t band_count,
                        const std::array<float, kCrossoverCount> &frequencies,
                        const std::array<float, kCrossoverCount> &slopes,
                        std::uint32_t frame_count) noexcept {
    active_bank_ = 0u;
    designSet(active_bank_, band_count, frequencies, slopes, false);
    configured_ = true;
    configured_channels_ = channel_count;
    configured_bands_ = band_count;
    configured_frequencies_ = frequencies;
    requested_frequencies_ = frequencies;
    transition_frequencies_ = frequencies;
    configured_slopes_ = slopes;
    fade_counter_ = 0u;
    const std::uint32_t requested_fade =
        static_cast<std::uint32_t>(std::ceil(static_cast<double>(sample_rate_) * 0.005));
    fade_length_ = requested_fade < frame_count ? requested_fade : frame_count;
    transition_length_ = requested_fade < 1u ? 1u : requested_fade;
    transition_remaining_ = 0u;
  }

  void beginTransition(const std::array<float, kCrossoverCount> &frequencies) noexcept {
    const std::uint32_t target_bank = 1u - active_bank_;
    designSet(target_bank, configured_bands_, frequencies, configured_slopes_, true);
    transition_frequencies_ = frequencies;
    transition_remaining_ = transition_length_;
  }

  static void filter(const float *input, float *output, std::uint32_t frame_count,
                     FilterBank &bank) noexcept {
    if (bank.count == 0u) {
      if (input != output) {
        std::memcpy(output, input, static_cast<std::size_t>(frame_count) * 2u * sizeof(float));
      }
      return;
    }
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      const std::size_t channel_offset = static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        float value = input[channel_offset + frame];
        for (std::uint32_t section = 0u; section < bank.count; ++section) {
          const Coefficients &coefficients = bank.coefficients[section];
          FilterState &state = bank.states[section][channel];
          const double filtered = coefficients.b0 * value + coefficients.b1 * state.x1 +
                                  coefficients.b2 * state.x2 - coefficients.a1 * state.y1 -
                                  coefficients.a2 * state.y2;
          state.x2 = state.x1;
          state.x1 = value;
          state.y2 = state.y1;
          value = static_cast<float>(filtered);
          state.y1 = value;
        }
        output[channel_offset + frame] = value;
      }
    }
  }

  static float filterSample(float input, std::uint32_t channel, FilterBank &bank) noexcept {
    float value = input;
    for (std::uint32_t section = 0u; section < bank.count; ++section) {
      const Coefficients &coefficients = bank.coefficients[section];
      FilterState &state = bank.states[section][channel];
      const double filtered = coefficients.b0 * value + coefficients.b1 * state.x1 +
                              coefficients.b2 * state.x2 - coefficients.a1 * state.y1 -
                              coefficients.a2 * state.y2;
      state.x2 = state.x1;
      state.x1 = value;
      state.y2 = state.y1;
      value = static_cast<float>(filtered);
      state.y1 = value;
    }
    return value;
  }

  static void renderFrame(float left, float right, std::uint32_t band_count,
                          std::array<FilterBank, kCrossoverCount> &low_pass,
                          std::array<FilterBank, kCrossoverCount> &high_pass,
                          std::array<float, 8u> &output) noexcept {
    const std::array<float, 2u> input = {left, right};
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      output[channel] = filterSample(input[channel], channel, low_pass[0]);
      float remainder = filterSample(input[channel], channel, high_pass[0]);
      if (band_count == 2u) {
        output[2u + channel] = remainder;
        continue;
      }
      output[2u + channel] = filterSample(remainder, channel, low_pass[1]);
      remainder = filterSample(remainder, channel, high_pass[1]);
      if (band_count == 3u) {
        output[4u + channel] = remainder;
        continue;
      }
      output[4u + channel] = filterSample(remainder, channel, low_pass[2]);
      output[6u + channel] = filterSample(remainder, channel, high_pass[2]);
    }
  }

  static void copyBand(float *audio, const float *source, std::uint32_t first_channel,
                       std::uint32_t frame_count) noexcept {
    std::memcpy(audio + static_cast<std::size_t>(first_channel) * frame_count, source,
                static_cast<std::size_t>(frame_count) * 2u * sizeof(float));
  }

  static void renderBands(const float *input, float *output, std::uint32_t channel_count,
                          std::uint32_t band_count, std::uint32_t frame_count,
                          std::array<FilterBank, kCrossoverCount> &low_pass,
                          std::array<FilterBank, kCrossoverCount> &high_pass, float *temporary_one,
                          float *temporary_two) noexcept {
    std::memset(output, 0, static_cast<std::size_t>(channel_count) * frame_count * sizeof(float));
    filter(input, temporary_one, frame_count, low_pass[0]);
    filter(input, temporary_two, frame_count, high_pass[0]);
    copyBand(output, temporary_one, 0u, frame_count);
    if (band_count == 2u) {
      copyBand(output, temporary_two, 2u, frame_count);
      return;
    }
    filter(temporary_two, temporary_one, frame_count, low_pass[1]);
    filter(temporary_two, temporary_two, frame_count, high_pass[1]);
    copyBand(output, temporary_one, 2u, frame_count);
    if (band_count == 3u) {
      copyBand(output, temporary_two, 4u, frame_count);
      return;
    }
    filter(temporary_two, temporary_one, frame_count, low_pass[2]);
    filter(temporary_two, temporary_two, frame_count, high_pass[2]);
    copyBand(output, temporary_one, 4u, frame_count);
    copyBand(output, temporary_two, 6u, frame_count);
  }

  void applyFade(float *audio, std::uint32_t channel_count, std::uint32_t frame_count) noexcept {
    if (fade_counter_ >= fade_length_)
      return;
    for (std::uint32_t frame = 0u; frame < frame_count && fade_counter_ < fade_length_;
         ++frame, ++fade_counter_) {
      const float gain = static_cast<float>(fade_counter_) / static_cast<float>(fade_length_);
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        audio[static_cast<std::size_t>(channel) * frame_count + frame] *= gain;
      }
    }
  }

  float sample_rate_ = 48000.0F;
  std::array<std::array<FilterBank, kCrossoverCount>, 2u> low_pass_{};
  std::array<std::array<FilterBank, kCrossoverCount>, 2u> high_pass_{};
  std::vector<float> input_;
  std::vector<float> temporary_one_;
  std::vector<float> temporary_two_;
  std::array<float, kCrossoverCount> configured_frequencies_{};
  std::array<float, kCrossoverCount> requested_frequencies_{};
  std::array<float, kCrossoverCount> transition_frequencies_{};
  std::array<float, kCrossoverCount> configured_slopes_{};
  std::uint32_t configured_channels_ = 0u;
  std::uint32_t configured_bands_ = 0u;
  std::uint32_t fade_counter_ = 0u;
  std::uint32_t fade_length_ = 0u;
  std::uint32_t active_bank_ = 0u;
  std::uint32_t transition_length_ = 1u;
  std::uint32_t transition_remaining_ = 0u;
  std::uint32_t telemetry_channels_ = 0u;
  bool configured_ = false;
};

EFFETUNE_REGISTER_KERNEL(ChannelDividerPlugin, ChannelDividerKernel)

} // namespace effetune::plugins::basics

#include "effetune/kernel.h"
#include "ChannelDividerPluginParams.h"

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

void writeU32(std::uint8_t *output, std::uint32_t value) noexcept {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>((value >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((value >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>(value >> 24u);
}

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
    for (FilterBank &bank : low_pass_)
      resetBank(bank);
    for (FilterBank &bank : high_pass_)
      resetBank(bank);
    configured_ = false;
    configured_channels_ = 0u;
    configured_bands_ = 0u;
    fade_counter_ = 0u;
    fade_length_ = 0u;
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
        configured_frequencies_ != frequencies || configured_slopes_ != slopes) {
      configure(channel_count, band_count, frequencies, slopes, frame_count);
    }

    const std::size_t stereo_samples = static_cast<std::size_t>(frame_count) * 2u;
    std::memcpy(input_.data(), audio, stereo_samples * sizeof(float));
    std::memset(audio, 0, static_cast<std::size_t>(channel_count) * frame_count * sizeof(float));

    if (band_count == 2u) {
      filter(input_.data(), temporary_one_.data(), frame_count, low_pass_[0]);
      filter(input_.data(), temporary_two_.data(), frame_count, high_pass_[0]);
      copyBand(audio, temporary_one_.data(), 0u, frame_count);
      copyBand(audio, temporary_two_.data(), 2u, frame_count);
    } else if (band_count == 3u) {
      filter(input_.data(), temporary_one_.data(), frame_count, low_pass_[0]);
      filter(input_.data(), temporary_two_.data(), frame_count, high_pass_[0]);
      copyBand(audio, temporary_one_.data(), 0u, frame_count);
      filter(temporary_two_.data(), temporary_one_.data(), frame_count, low_pass_[1]);
      filter(temporary_two_.data(), temporary_two_.data(), frame_count, high_pass_[1]);
      copyBand(audio, temporary_one_.data(), 2u, frame_count);
      copyBand(audio, temporary_two_.data(), 4u, frame_count);
    } else {
      filter(input_.data(), temporary_one_.data(), frame_count, low_pass_[0]);
      filter(input_.data(), temporary_two_.data(), frame_count, high_pass_[0]);
      copyBand(audio, temporary_one_.data(), 0u, frame_count);
      filter(temporary_two_.data(), temporary_one_.data(), frame_count, low_pass_[1]);
      filter(temporary_two_.data(), temporary_two_.data(), frame_count, high_pass_[1]);
      copyBand(audio, temporary_one_.data(), 2u, frame_count);
      filter(temporary_two_.data(), temporary_one_.data(), frame_count, low_pass_[2]);
      filter(temporary_two_.data(), temporary_two_.data(), frame_count, high_pass_[2]);
      copyBand(audio, temporary_one_.data(), 4u, frame_count);
      copyBand(audio, temporary_two_.data(), 6u, frame_count);
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

  void configure(std::uint32_t channel_count, std::uint32_t band_count,
                 const std::array<float, kCrossoverCount> &frequencies,
                 const std::array<float, kCrossoverCount> &slopes,
                 std::uint32_t frame_count) noexcept {
    for (std::uint32_t index = 0u; index < kCrossoverCount; ++index) {
      resetBank(low_pass_[index]);
      resetBank(high_pass_[index]);
      if (index >= band_count - 1u)
        continue;
      double frequency = static_cast<double>(frequencies[index]);
      const double maximum = static_cast<double>(sample_rate_) * 0.499;
      if (frequency < 10.0)
        frequency = 10.0;
      if (frequency > maximum)
        frequency = maximum;
      designBank(low_pass_[index], sample_rate_, frequency, slopes[index], false);
      designBank(high_pass_[index], sample_rate_, frequency, slopes[index], true);
    }
    configured_ = true;
    configured_channels_ = channel_count;
    configured_bands_ = band_count;
    configured_frequencies_ = frequencies;
    configured_slopes_ = slopes;
    fade_counter_ = 0u;
    const std::uint32_t requested_fade =
        static_cast<std::uint32_t>(std::ceil(static_cast<double>(sample_rate_) * 0.005));
    fade_length_ = requested_fade < frame_count ? requested_fade : frame_count;
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

  static void copyBand(float *audio, const float *source, std::uint32_t first_channel,
                       std::uint32_t frame_count) noexcept {
    std::memcpy(audio + static_cast<std::size_t>(first_channel) * frame_count, source,
                static_cast<std::size_t>(frame_count) * 2u * sizeof(float));
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
  std::array<FilterBank, kCrossoverCount> low_pass_{};
  std::array<FilterBank, kCrossoverCount> high_pass_{};
  std::vector<float> input_;
  std::vector<float> temporary_one_;
  std::vector<float> temporary_two_;
  std::array<float, kCrossoverCount> configured_frequencies_{};
  std::array<float, kCrossoverCount> configured_slopes_{};
  std::uint32_t configured_channels_ = 0u;
  std::uint32_t configured_bands_ = 0u;
  std::uint32_t fade_counter_ = 0u;
  std::uint32_t fade_length_ = 0u;
  std::uint32_t telemetry_channels_ = 0u;
  bool configured_ = false;
};

EFFETUNE_REGISTER_KERNEL(ChannelDividerPlugin, ChannelDividerKernel)

} // namespace effetune::plugins::basics

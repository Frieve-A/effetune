#include "effetune/kernel.h"
#include "FiveBandDynamicEQParams.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <numbers>
#include <utility>
#include <vector>

namespace effetune::plugins::eq {
namespace {

constexpr std::uint32_t kBandCount = 5u;
constexpr double kMinimumEnvelope = 1.0e-9;
constexpr double kGainThreshold = 1.0e-4;
constexpr std::uint16_t kTelemetryFrameType = 14u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kTelemetryPayloadBytes = 24u;

enum class FilterType : std::uint32_t { Peak = 0u, LowShelf = 1u, HighShelf = 2u, BandPass = 3u };

struct BiquadCoefficients final {
  double b0 = 1.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
};

struct EnvelopeFollower final {
  double attack_coefficient = 0.0;
  double release_coefficient = 0.0;
  double envelope = kMinimumEnvelope;

  void reset() noexcept {
    attack_coefficient = 0.0;
    release_coefficient = 0.0;
    envelope = kMinimumEnvelope;
  }

  void setAttack(double milliseconds, double sample_rate) noexcept {
    attack_coefficient = std::exp(-1000.0 / (milliseconds * sample_rate));
  }

  void setRelease(double milliseconds, double sample_rate) noexcept {
    release_coefficient = std::exp(-1000.0 / (milliseconds * sample_rate));
  }

  double processLevel(double input) noexcept {
    const double magnitude = input < 0.0 ? -input : input;
    envelope = magnitude > envelope ? attack_coefficient * (envelope - magnitude) + magnitude
                                    : release_coefficient * (envelope - magnitude) + magnitude;
    if (envelope < kMinimumEnvelope)
      envelope = kMinimumEnvelope;
    return 20.0 * std::log10(envelope);
  }

  double processGain(double target_gain_db) noexcept {
    envelope = target_gain_db > envelope
                   ? attack_coefficient * (envelope - target_gain_db) + target_gain_db
                   : release_coefficient * (envelope - target_gain_db) + target_gain_db;
    return envelope;
  }
};

struct BandState final {
  EnvelopeFollower level_detector;
  EnvelopeFollower gain_envelope;
  double mono_sidechain_w1 = 0.0;
  double mono_sidechain_w2 = 0.0;
  double smoothed_gain = 0.0;

  void reset() noexcept {
    level_detector.reset();
    gain_envelope.reset();
    mono_sidechain_w1 = 0.0;
    mono_sidechain_w2 = 0.0;
    smoothed_gain = 0.0;
  }
};

struct ChannelBandState final {
  double w1 = 0.0;
  double w2 = 0.0;
  double last_gain = std::numeric_limits<double>::quiet_NaN();
  BiquadCoefficients last_coefficients{};

  void reset() noexcept {
    w1 = 0.0;
    w2 = 0.0;
    last_gain = std::numeric_limits<double>::quiet_NaN();
    last_coefficients = {};
  }
};

struct BlockBand final {
  BiquadCoefficients sidechain_coefficients{};
  double threshold = 0.0;
  double half_knee = 0.0;
  double ratio = 1.0;
  double slope_factor = 0.0;
  double maximum_gain = 0.0;
  double frequency = 0.0;
  double q = 1.0;
  double knee = 0.0;
  FilterType filter_type = FilterType::Peak;
  bool enabled = false;
};

void writeF32(std::uint8_t *output, float value) noexcept {
  std::uint32_t bits = 0u;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&bits, &value, sizeof(bits));
  output[0] = static_cast<std::uint8_t>(bits & 0xffu);
  output[1] = static_cast<std::uint8_t>((bits >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((bits >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>(bits >> 24u);
}

BiquadCoefficients calculateCoefficients(FilterType type, double frequency, double q,
                                         double gain_db, double sample_rate) noexcept {
  if (gain_db > -1.0e-5 && gain_db < 1.0e-5 &&
      (type == FilterType::Peak || type == FilterType::LowShelf || type == FilterType::HighShelf)) {
    return {};
  }

  const double omega = 2.0 * std::numbers::pi_v<double> * frequency / sample_rate;
  const double cosine = std::cos(omega);
  const double sine = std::sin(omega);
  const double alpha = sine / (2.0 * q);
  double b0 = 1.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a0 = 1.0;
  double a1 = 0.0;
  double a2 = 0.0;

  switch (type) {
  case FilterType::Peak: {
    const double gain = std::pow(10.0, gain_db / 40.0);
    const double alpha_times_gain = alpha * gain;
    const double alpha_over_gain = alpha / gain;
    b0 = 1.0 + alpha_times_gain;
    b1 = -2.0 * cosine;
    b2 = 1.0 - alpha_times_gain;
    a0 = 1.0 + alpha_over_gain;
    a1 = -2.0 * cosine;
    a2 = 1.0 - alpha_over_gain;
    break;
  }
  case FilterType::LowShelf: {
    const double gain = std::pow(10.0, gain_db / 20.0);
    const double difference = gain - 1.0;
    const double beta_term = gain * ((gain * gain + 1.0) / q - difference * difference);
    const double beta = std::sqrt(beta_term < 0.0 ? 0.0 : beta_term);
    b0 = gain * ((gain + 1.0) - difference * cosine + beta * sine);
    b1 = 2.0 * gain * (difference - (gain + 1.0) * cosine);
    b2 = gain * ((gain + 1.0) - difference * cosine - beta * sine);
    a0 = (gain + 1.0) + difference * cosine + beta * sine;
    a1 = -2.0 * (difference + (gain + 1.0) * cosine);
    a2 = (gain + 1.0) + difference * cosine - beta * sine;
    break;
  }
  case FilterType::HighShelf: {
    const double gain = std::pow(10.0, gain_db / 20.0);
    const double difference = gain - 1.0;
    const double beta_term = gain * ((gain * gain + 1.0) / q - difference * difference);
    const double beta = std::sqrt(beta_term < 0.0 ? 0.0 : beta_term);
    b0 = gain * ((gain + 1.0) + difference * cosine + beta * sine);
    b1 = -2.0 * gain * (difference + (gain + 1.0) * cosine);
    b2 = gain * ((gain + 1.0) + difference * cosine - beta * sine);
    a0 = (gain + 1.0) - difference * cosine + beta * sine;
    a1 = 2.0 * (difference - (gain + 1.0) * cosine);
    a2 = (gain + 1.0) - difference * cosine - beta * sine;
    break;
  }
  case FilterType::BandPass:
    b0 = alpha;
    b1 = 0.0;
    b2 = -alpha;
    a0 = 1.0 + alpha;
    a1 = -2.0 * cosine;
    a2 = 1.0 - alpha;
    break;
  }

  const double inverse_a0 = 1.0 / a0;
  return {b0 * inverse_a0, b1 * inverse_a0, b2 * inverse_a0, a1 * inverse_a0, a2 * inverse_a0};
}

FilterType decodeFilterType(float encoded) noexcept {
  const std::uint32_t index = static_cast<std::uint32_t>(encoded);
  if (index == 1u)
    return FilterType::LowShelf;
  if (index == 2u)
    return FilterType::HighShelf;
  return FilterType::Peak;
}

} // namespace

class FiveBandDynamicEQKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::FiveBandDynamicEQParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    channel_states_.resize(static_cast<std::size_t>(kBandCount) * max_channels_);
    current_samples_.resize(max_channels_);
    processed_samples_.resize(max_channels_);
    reset();
  }

  void reset() noexcept override {
    for (BandState &band : bands_)
      band.reset();
    for (ChannelBandState &state : channel_states_)
      state.reset();
    std::fill(current_samples_.begin(), current_samples_.end(), 0.0F);
    std::fill(processed_samples_.begin(), processed_samples_.end(), 0.0F);
    latest_gains_.fill(0.0F);
    active_channels_ = 0u;
    has_measurement_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }
    if (active_channels_ != channel_count)
      initializeChannels(channel_count);

    std::array<BlockBand, kBandCount> block_bands{};
    for (std::uint32_t band_index = 0u; band_index < kBandCount; ++band_index) {
      BlockBand &block_band = block_bands[band_index];
      block_band.enabled = params_.enabled[band_index] != 0.0F;
      block_band.threshold = static_cast<double>(params_.threshold[band_index]);
      block_band.ratio = static_cast<double>(params_.ratio[band_index]);
      block_band.maximum_gain = static_cast<double>(params_.maxGain[band_index]);
      block_band.frequency = static_cast<double>(params_.frequency[band_index]);
      block_band.q = static_cast<double>(params_.q[band_index]);
      block_band.knee = static_cast<double>(params_.knee[band_index]);
      block_band.half_knee = block_band.knee * 0.5;
      block_band.filter_type = decodeFilterType(params_.filterType[band_index]);
      const double slope = 1.0 - 1.0 / block_band.ratio;
      block_band.slope_factor = slope < 0.0 ? -slope : slope;
      if (!block_band.enabled)
        continue;

      block_band.sidechain_coefficients = calculateCoefficients(
          FilterType::BandPass, static_cast<double>(params_.sidechainFrequency[band_index]),
          static_cast<double>(params_.sidechainQ[band_index]), 0.0, sample_rate_);
      BandState &band = bands_[band_index];
      const double attack = static_cast<double>(params_.attack[band_index]);
      const double release = static_cast<double>(params_.release[band_index]);
      band.level_detector.setAttack(attack, sample_rate_);
      band.level_detector.setRelease(release, sample_rate_);
      band.gain_envelope.setAttack(attack, sample_rate_);
      band.gain_envelope.setRelease(release, sample_rate_);
    }

    latest_gains_.fill(0.0F);
    float *current = current_samples_.data();
    float *processed = processed_samples_.data();
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      double mono_sample = 0.0;
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const float sample = audio[static_cast<std::size_t>(channel) * frame_count + frame];
        current[channel] = sample;
        mono_sample += static_cast<double>(sample);
      }
      mono_sample /= static_cast<double>(channel_count);
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        processed[channel] = current[channel];
      }

      for (std::uint32_t band_index = 0u; band_index < kBandCount; ++band_index) {
        const BlockBand &block_band = block_bands[band_index];
        if (!block_band.enabled)
          continue;
        BandState &band = bands_[band_index];
        const BiquadCoefficients &sidechain = block_band.sidechain_coefficients;
        const double sidechain_output = sidechain.b0 * mono_sample + band.mono_sidechain_w1;
        band.mono_sidechain_w1 =
            sidechain.b1 * mono_sample - sidechain.a1 * sidechain_output + band.mono_sidechain_w2;
        band.mono_sidechain_w2 = sidechain.b2 * mono_sample - sidechain.a2 * sidechain_output;

        const double level_db = band.level_detector.processLevel(sidechain_output);
        const double delta_db = level_db - block_band.threshold;
        double gain_magnitude = 0.0;
        if (delta_db > -block_band.half_knee) {
          if (block_band.knee > 1.0e-9 && delta_db <= block_band.half_knee) {
            const double knee_position = delta_db + block_band.half_knee;
            gain_magnitude =
                block_band.slope_factor * knee_position * knee_position / (2.0 * block_band.knee);
          } else {
            gain_magnitude = block_band.slope_factor * block_band.half_knee +
                             block_band.slope_factor * (delta_db - block_band.half_knee);
          }
        }
        const double clamped_gain =
            gain_magnitude > block_band.maximum_gain ? block_band.maximum_gain : gain_magnitude;
        const double target_gain = block_band.ratio >= 1.0 ? -clamped_gain : clamped_gain;
        const double smoothed_gain = band.gain_envelope.processGain(target_gain);
        if (frame + 1u == frame_count) {
          latest_gains_[band_index] = static_cast<float>(smoothed_gain);
          band.smoothed_gain = smoothed_gain;
        }

        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          ChannelBandState &state = channelState(band_index, channel);
          const double gain_difference = smoothed_gain - state.last_gain;
          const bool keep_coefficients =
              gain_difference > -kGainThreshold && gain_difference < kGainThreshold;
          if (!keep_coefficients) {
            state.last_coefficients =
                calculateCoefficients(block_band.filter_type, block_band.frequency, block_band.q,
                                      smoothed_gain, sample_rate_);
            state.last_gain = smoothed_gain;
          }
          const BiquadCoefficients &coefficients = state.last_coefficients;
          const double input = static_cast<double>(current[channel]);
          const double output = coefficients.b0 * input + state.w1;
          state.w1 = coefficients.b1 * input - coefficients.a1 * output + state.w2;
          state.w2 = coefficients.b2 * input - coefficients.a2 * output;
          processed[channel] = static_cast<float>(output);
        }
        std::swap(current, processed);
      }

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        audio[static_cast<std::size_t>(channel) * frame_count + frame] = current[channel];
      }
    }
    has_measurement_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!has_measurement_)
      return;
    std::array<std::uint8_t, kTelemetryPayloadBytes> payload{};
    payload[0] = static_cast<std::uint8_t>(kBandCount);
    for (std::uint32_t band = 0u; band < kBandCount; ++band) {
      writeF32(payload.data() + 4u + band * 4u, latest_gains_[band]);
    }
    writer.write(kTelemetryFrameType, kTelemetryVersion, payload.data(),
                 static_cast<std::uint16_t>(payload.size()));
  }

private:
  ChannelBandState &channelState(std::uint32_t band, std::uint32_t channel) noexcept {
    return channel_states_[static_cast<std::size_t>(band) * max_channels_ + channel];
  }

  void initializeChannels(std::uint32_t channel_count) noexcept {
    for (BandState &band : bands_)
      band.reset();
    for (ChannelBandState &state : channel_states_)
      state.reset();
    latest_gains_.fill(0.0F);
    active_channels_ = channel_count;
    has_measurement_ = false;
  }

  std::array<BandState, kBandCount> bands_{};
  std::vector<ChannelBandState> channel_states_;
  std::vector<float> current_samples_;
  std::vector<float> processed_samples_;
  std::array<float, kBandCount> latest_gains_{};
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t active_channels_ = 0u;
  bool has_measurement_ = false;
};

static_assert(sizeof(FiveBandDynamicEQKernel) <= 8192u);

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(FiveBandDynamicEQ, effetune::plugins::eq::FiveBandDynamicEQKernel)

#include "effetune/kernel.h"
#include "MultibandExpanderPluginParams.h"

#include "../multiband_common.h"
#include "../multiband_telemetry.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::dynamics {
namespace {

constexpr double kMinimumEnvelope = 1.0e-6;
constexpr double kLog2 = 0.6931471805599453;
constexpr double kLog10Times20 = 8.685889638065035;
constexpr double kGainFactor = 0.11512925464970229;

class ExpanderLookup final {
public:
  void prepare() {
    db_.resize(kDbSize);
    gain_.resize(kGainSize);
    for (std::uint32_t index = 0u; index < kDbSize; ++index) {
      const double value = static_cast<double>(index) / kDbScale;
      db_[index] =
          static_cast<float>(value < kMinimumEnvelope ? -120.0 : kLog10Times20 * std::log(value));
    }
    for (std::uint32_t index = 0u; index < kGainSize; ++index) {
      const double decibels = kMinimumGainDb + static_cast<double>(index) / kGainScale;
      gain_[index] = static_cast<float>(std::exp(decibels * kGainFactor));
    }
  }

  [[nodiscard]] double decibels(double value) const noexcept {
    if (value < kMinimumEnvelope)
      return -120.0;
    const double scaled = value * kDbScale;
    const std::uint32_t index = scaled > static_cast<double>(kDbSize - 1u)
                                    ? kDbSize - 1u
                                    : static_cast<std::uint32_t>(scaled);
    return static_cast<double>(db_[index]);
  }

  [[nodiscard]] double gain(double decibels) const noexcept {
    if (decibels <= kMinimumGainDb)
      return static_cast<double>(gain_[0u]);
    if (decibels >= kMaximumGainDb)
      return static_cast<double>(gain_[kGainSize - 1u]);
    const double scaled = (decibels - kMinimumGainDb) * kGainScale;
    const std::uint32_t index = scaled > static_cast<double>(kGainSize - 1u)
                                    ? kGainSize - 1u
                                    : static_cast<std::uint32_t>(scaled);
    return static_cast<double>(gain_[index]);
  }

private:
  static constexpr std::uint32_t kDbSize = 4096u;
  static constexpr double kDbScale = 4096.0 / 10.0;
  static constexpr std::uint32_t kGainSize = 4096u;
  static constexpr double kMinimumGainDb = -60.0;
  static constexpr double kMaximumGainDb = 20.0;
  static constexpr double kGainScale = 4096.0 / 80.0;

  std::vector<float> db_;
  std::vector<float> gain_;
};

} // namespace

class MultibandExpanderKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MultibandExpanderPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    crossover_.prepare(info);
    envelopes_.resize(static_cast<std::size_t>(info.maxChannels) *
                      multiband_detail::kFiveBandCount);
    output_.resize(info.maxFrames);
    envelope_work_.resize(info.maxFrames);
    lookup_.prepare();
    reset();
  }

  void reset() noexcept override {
    crossover_.reset();
    for (double &envelope : envelopes_)
      envelope = 0.0;
    for (float &sample : output_)
      sample = 0.0F;
    for (float &sample : envelope_work_)
      sample = 0.0F;
    latest_values_.fill(0.0F);
    has_measurement_ = false;
    fade_counter_ = 0u;
    fade_length_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    const std::array<float, multiband_detail::kFiveBandCrossoverCount> frequencies = {
        params_.frequency1, params_.frequency2, params_.frequency3, params_.frequency4};
    const multiband_detail::CrossoverChange change =
        crossover_.configure(frequencies, channel_count);
    if (change.filtersReset)
      startFade();
    if (change.dynamicsReset) {
      for (double &envelope : envelopes_) {
        envelope = kMinimumEnvelope;
      }
    }
    crossover_.split(audio, channel_count, frame_count);

    std::array<float, multiband_detail::kFiveBandCount * 2u> time_constants{};
    const double sample_rate_ms = sample_rate_ / 1000.0;
    for (std::uint32_t band = 0u; band < multiband_detail::kFiveBandCount; ++band) {
      double attack_samples = static_cast<double>(params_.attack[band]) * sample_rate_ms;
      if (attack_samples < 1.0)
        attack_samples = 1.0;
      double release_samples = static_cast<double>(params_.release[band]) * sample_rate_ms;
      if (release_samples < 1.0)
        release_samples = 1.0;
      time_constants[band * 2u] = static_cast<float>(std::exp(-kLog2 / attack_samples));
      time_constants[band * 2u + 1u] = static_cast<float>(std::exp(-kLog2 / release_samples));
    }

    const bool fade_active = fade_counter_ < fade_length_;
    const std::uint32_t fade_start = fade_counter_;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame)
        output_[frame] = 0.0F;
      const std::size_t envelope_offset =
          static_cast<std::size_t>(channel) * multiband_detail::kFiveBandCount;

      for (std::uint32_t band = 0u; band < multiband_detail::kFiveBandCount; ++band) {
        const float *band_signal = crossover_.band(channel, band);
        const double attack = static_cast<double>(time_constants[band * 2u]);
        const double release = static_cast<double>(time_constants[band * 2u + 1u]);
        double envelope = envelopes_[envelope_offset + band];
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const double input = static_cast<double>(band_signal[frame]);
          const double magnitude = input >= 0.0 ? input : -input;
          const double coefficient = magnitude > envelope ? attack : release;
          envelope = envelope * coefficient + magnitude * (1.0 - coefficient);
          if (envelope < kMinimumEnvelope)
            envelope = kMinimumEnvelope;
          envelope_work_[frame] = static_cast<float>(envelope);
        }
        envelopes_[envelope_offset + band] = envelope;

        const double threshold = static_cast<double>(params_.threshold[band]);
        double ratio = static_cast<double>(params_.ratio[band]);
        if (ratio < 0.05)
          ratio = 0.05;
        double knee = static_cast<double>(params_.knee[band]);
        if (knee < 0.0)
          knee = 0.0;
        const double half_knee = knee * 0.5;
        const double slope = ratio - 1.0;
        const double makeup_db = static_cast<double>(params_.gain[band]);
        latest_values_[band] = 0.0F;

        double last_gain_boost = 0.0;
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const double difference =
              lookup_.decibels(static_cast<double>(envelope_work_[frame])) - threshold;
          double gain_boost = 0.0;
          if (difference <= -half_knee) {
            gain_boost = difference * slope;
          } else if (difference >= half_knee) {
            gain_boost = 0.0;
          } else {
            const double position = (difference + half_knee) / knee;
            const double below = -half_knee * slope;
            const double remaining = 1.0 - position;
            gain_boost = below * remaining * remaining;
          }
          const double multiplier = lookup_.gain(makeup_db + gain_boost);
          const double sum = static_cast<double>(output_[frame]) +
                             static_cast<double>(band_signal[frame]) * multiplier;
          output_[frame] = static_cast<float>(sum);
          if (frame + 1u == frame_count) {
            last_gain_boost = gain_boost >= 0.0 ? gain_boost : -gain_boost;
          }
        }
        latest_values_[band] = static_cast<float>(last_gain_boost);
      }

      float *channel_audio = audio + static_cast<std::size_t>(channel) * frame_count;
      if (fade_active) {
        std::uint32_t frame = 0u;
        for (; frame < frame_count && fade_start + frame < fade_length_; ++frame) {
          const double fade =
              static_cast<double>(fade_start + frame) / static_cast<double>(fade_length_);
          channel_audio[frame] = static_cast<float>(static_cast<double>(output_[frame]) * fade);
        }
        for (; frame < frame_count; ++frame)
          channel_audio[frame] = output_[frame];
      } else {
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          channel_audio[frame] = output_[frame];
        }
      }
    }

    if (fade_active) {
      const std::uint32_t next = fade_start + frame_count;
      fade_counter_ = next >= fade_length_ ? fade_length_ : next;
    }
    has_measurement_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (has_measurement_) {
      multiband_telemetry::write(writer, multiband_telemetry::ValueKind::ExpansionMagnitude,
                                 latest_values_);
    }
  }

private:
  void startFade() noexcept {
    fade_length_ = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005));
    fade_counter_ = 0u;
  }

  multiband_detail::FiveBandCrossover crossover_{dsp::LinkwitzRileyStateStorage::Float64};
  ExpanderLookup lookup_;
  std::vector<double> envelopes_;
  std::vector<float> output_;
  std::vector<float> envelope_work_;
  std::array<float, multiband_detail::kFiveBandCount> latest_values_{};
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t fade_counter_ = 0u;
  std::uint32_t fade_length_ = 0u;
  bool has_measurement_ = false;
};

static_assert(sizeof(MultibandExpanderKernel) <= 8192u);

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(MultibandExpanderPlugin,
                         effetune::plugins::dynamics::MultibandExpanderKernel)

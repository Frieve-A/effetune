#include "effetune/kernel.h"
#include "TransientShaperPluginParams.h"

#include "../auto_leveler/group_b_telemetry.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::dynamics {

class TransientShaperKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::TransientShaperPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    fast_envelopes_.resize(info.maxChannels);
    slow_envelopes_.resize(info.maxChannels);
    reset();
  }

  void reset() noexcept override {
    for (float &envelope : fast_envelopes_) {
      envelope = 0.0F;
    }
    for (float &envelope : slow_envelopes_) {
      envelope = 0.0F;
    }
    gain_ = 1.0;
    latest_gain_db_ = 0.0F;
    last_channel_count_ = 0u;
    has_measurement_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > fast_envelopes_.size() ||
        frame_count == 0u || sample_rate_ <= 0.0) {
      return;
    }
    if (channel_count != last_channel_count_) {
      for (float &envelope : fast_envelopes_) {
        envelope = 0.0F;
      }
      for (float &envelope : slow_envelopes_) {
        envelope = 0.0F;
      }
      gain_ = 1.0;
      last_channel_count_ = channel_count;
    }

    constexpr double kLn10Over20 = 0.11512925464970229;
    const double transient_gain =
        std::exp(static_cast<double>(params_.transientGain) * kLn10Over20);
    const double sustain_gain = std::exp(static_cast<double>(params_.sustainGain) * kLn10Over20);
    const double fast_attack = coefficient(params_.fastAttack);
    const double fast_release = coefficient(params_.fastRelease);
    const double slow_attack = coefficient(params_.slowAttack);
    const double slow_release = coefficient(params_.slowRelease);
    const double smoothing = coefficient(params_.gainSmoothing);
    double gain = gain_;

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      double maximum_difference = 0.0;
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
        const double input = static_cast<double>(audio[index]);
        const double magnitude = input < 0.0 ? -input : input;

        const double previous_fast = static_cast<double>(fast_envelopes_[channel]);
        const double fast_coefficient = magnitude > previous_fast ? fast_attack : fast_release;
        fast_envelopes_[channel] = static_cast<float>(previous_fast * fast_coefficient +
                                                      magnitude * (1.0 - fast_coefficient));

        const double previous_slow = static_cast<double>(slow_envelopes_[channel]);
        const double slow_coefficient = magnitude > previous_slow ? slow_attack : slow_release;
        slow_envelopes_[channel] = static_cast<float>(previous_slow * slow_coefficient +
                                                      magnitude * (1.0 - slow_coefficient));

        const double difference = static_cast<double>(fast_envelopes_[channel]) -
                                  static_cast<double>(slow_envelopes_[channel]);
        if (difference > maximum_difference) {
          maximum_difference = difference;
        }
      }

      const double transient = maximum_difference > 0.0 ? maximum_difference : 0.0;
      const double transient_value = 1.0 + (transient_gain - 1.0) * transient;
      const double sustain_value = 1.0 + (sustain_gain - 1.0) * (1.0 - transient);
      const double target = transient_value * sustain_value;
      gain = (1.0 - smoothing) * target + smoothing * gain;

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
        double output = static_cast<double>(audio[index]) * gain;
        if (output > 1.0) {
          output = 1.0;
        } else if (output < -1.0) {
          output = -1.0;
        }
        audio[index] = static_cast<float>(output);
      }
    }

    gain_ = gain;
    latest_gain_db_ = static_cast<float>(20.0 * std::log10(gain));
    has_measurement_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (has_measurement_) {
      group_b_detail::writeTransientGain(writer, latest_gain_db_);
    }
  }

private:
  [[nodiscard]] double coefficient(float milliseconds) const noexcept {
    return std::exp(-1.0 / (static_cast<double>(milliseconds) * 0.001 * sample_rate_));
  }

  std::vector<float> fast_envelopes_;
  std::vector<float> slow_envelopes_;
  double sample_rate_ = 0.0;
  double gain_ = 1.0;
  float latest_gain_db_ = 0.0F;
  std::uint32_t last_channel_count_ = 0u;
  bool has_measurement_ = false;
};

static_assert(sizeof(TransientShaperKernel) <= 8192u);

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(TransientShaperPlugin, effetune::plugins::dynamics::TransientShaperKernel)

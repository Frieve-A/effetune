#include "effetune/kernel.h"
#include "GatePluginParams.h"
#include "effetune/dsp/smoothing.h"

#include "../compressor/dynamics_common.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::dynamics {

class GateKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::GatePluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    envelopes_.resize(info.maxChannels);
    lookup_.prepare();
    reset();
  }

  void reset() noexcept override {
    for (dsp::AttackReleaseEnvelope &envelope : envelopes_) {
      detail::resetEnvelope(envelope);
    }
    last_channel_count_ = 0u;
    latest_amount_db_ = 0.0F;
    has_measurement_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > envelopes_.size() ||
        frame_count == 0u || sample_rate_ <= 0.0) {
      return;
    }
    if (channel_count != last_channel_count_) {
      for (dsp::AttackReleaseEnvelope &envelope : envelopes_) {
        detail::resetEnvelope(envelope);
      }
      last_channel_count_ = channel_count;
    }

    const double threshold = static_cast<double>(params_.threshold);
    const double ratio_slope = static_cast<double>(params_.ratio) - 1.0;
    const double knee = static_cast<double>(params_.knee);
    const double half_knee = knee * 0.5;
    const double output_gain = std::exp(static_cast<double>(params_.gain) * detail::kGainFactor);
    double maximum_reduction = 0.0;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      dsp::AttackReleaseEnvelope &envelope = envelopes_[channel];
      detail::setLegacyEnvelopeCoefficients(envelope, params_.attack, params_.release,
                                            sample_rate_);
      float *channel_audio = audio + channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double input = static_cast<double>(channel_audio[frame]);
        const double magnitude = input >= 0.0 ? input : -input;
        double envelope_value = envelope.process(magnitude);
        if (envelope_value < detail::kMinimumEnvelope) {
          envelope_value = detail::kMinimumEnvelope;
          envelope.reset(envelope_value);
        }

        const double difference = threshold - lookup_.decibels(envelope_value);
        double reduction = 0.0;
        if (ratio_slope > 1.0e-9 && difference > -half_knee) {
          if (difference >= half_knee) {
            reduction = difference * ratio_slope;
          } else if (knee > 1.0e-9) {
            const double knee_position = (difference + half_knee) / knee;
            reduction = 0.5 * ratio_slope * knee * knee_position * knee_position;
          }
          if (reduction < 0.0) {
            reduction = 0.0;
          }
        }
        if (reduction > maximum_reduction) {
          maximum_reduction = reduction;
        }

        double total_gain = output_gain;
        if (reduction > 1.0e-9) {
          total_gain *= lookup_.reductionGain(reduction);
        }
        if (total_gain != 1.0) {
          channel_audio[frame] = static_cast<float>(input * total_gain);
        }
      }
      detail::persistEnvelopeAsFloat(envelope);
    }

    latest_amount_db_ = static_cast<float>(maximum_reduction);
    has_measurement_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (has_measurement_) {
      detail::writeGainReductionTelemetry(writer, latest_amount_db_);
    }
  }

private:
  detail::GateLookup lookup_;
  std::vector<dsp::AttackReleaseEnvelope> envelopes_;
  double sample_rate_ = 0.0;
  std::uint32_t last_channel_count_ = 0u;
  float latest_amount_db_ = 0.0F;
  bool has_measurement_ = false;
};

static_assert(sizeof(GateKernel) <= 8192u);

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(GatePlugin, effetune::plugins::dynamics::GateKernel)

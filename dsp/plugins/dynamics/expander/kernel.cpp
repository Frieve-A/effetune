#include "effetune/kernel.h"
#include "ExpanderPluginParams.h"
#include "effetune/dsp/smoothing.h"

#include "../compressor/dynamics_common.h"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::dynamics {

class ExpanderKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::ExpanderPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    envelopes_.resize(info.maxChannels);
    work_buffer_.resize(info.maxFrames);
    lookup_.prepare();
    reset();
  }

  void reset() noexcept override {
    for (dsp::AttackReleaseEnvelope &envelope : envelopes_) {
      detail::resetEnvelope(envelope);
    }
    for (float &sample : work_buffer_) {
      sample = 0.0F;
    }
    last_channel_count_ = 0u;
    latest_amount_db_ = 0.0F;
    has_measurement_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > envelopes_.size() ||
        frame_count == 0u || frame_count > work_buffer_.size() || sample_rate_ <= 0.0) {
      return;
    }
    if (channel_count != last_channel_count_) {
      for (dsp::AttackReleaseEnvelope &envelope : envelopes_) {
        detail::resetEnvelope(envelope);
      }
      last_channel_count_ = channel_count;
    }

    const double threshold = static_cast<double>(params_.threshold);
    const double expansion_slope = static_cast<double>(params_.ratio) - 1.0;
    const double knee = static_cast<double>(params_.knee);
    const double half_knee = knee * 0.5;
    const double makeup_db = static_cast<double>(params_.gain);
    double maximum_boost = 0.0;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      dsp::AttackReleaseEnvelope &envelope = envelopes_[channel];
      detail::setLegacyEnvelopeCoefficients(envelope, params_.attack, params_.release,
                                            sample_rate_);
      float *channel_audio = audio + channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double input = static_cast<double>(channel_audio[frame]);
        const double magnitude = input >= 0.0 ? input : -input;
        const double envelope_value = envelope.process(magnitude);
        work_buffer_[frame] = static_cast<float>(
            envelope_value < detail::kMinimumEnvelope ? detail::kMinimumEnvelope : envelope_value);
      }

      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double difference = lookup_.decibels(work_buffer_[frame]) - threshold;
        double boost = 0.0;
        if (difference <= -half_knee) {
          boost = difference * expansion_slope;
        } else if (difference >= half_knee) {
          boost = 0.0;
        } else {
          const double knee_position = (difference + half_knee) / knee;
          const double below_knee = -half_knee * expansion_slope;
          const double remaining = 1.0 - knee_position;
          boost = below_knee * remaining * remaining;
        }
        const double gain = lookup_.gain(makeup_db + boost);
        channel_audio[frame] = static_cast<float>(static_cast<double>(channel_audio[frame]) * gain);
        const double magnitude = boost >= 0.0 ? boost : -boost;
        if (magnitude > maximum_boost) {
          maximum_boost = magnitude;
        }
      }
    }

    latest_amount_db_ = static_cast<float>(maximum_boost);
    has_measurement_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (has_measurement_) {
      detail::writeGainReductionTelemetry(writer, latest_amount_db_);
    }
  }

private:
  detail::CompressorExpanderLookup lookup_;
  std::vector<dsp::AttackReleaseEnvelope> envelopes_;
  std::vector<float> work_buffer_;
  double sample_rate_ = 0.0;
  std::uint32_t last_channel_count_ = 0u;
  float latest_amount_db_ = 0.0F;
  bool has_measurement_ = false;
};

static_assert(sizeof(ExpanderKernel) <= 8192u);

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(ExpanderPlugin, effetune::plugins::dynamics::ExpanderKernel)

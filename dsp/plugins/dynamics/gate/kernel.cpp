#include "effetune/kernel.h"
#include "GatePluginParams.h"
#include "effetune/dsp/smoothing.h"

#include "../compressor/dynamics_common.h"

#include <algorithm>
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
    curve_initialized_ = false;
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

    prepareCurveRamps();
    double maximum_reduction = 0.0;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      dsp::AttackReleaseEnvelope &envelope = envelopes_[channel];
      detail::setLegacyEnvelopeCoefficients(envelope, params_.attack, params_.release,
                                            sample_rate_);
      float *channel_audio = audio + channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double threshold = threshold_.value(frame);
        const double ratio_slope = ratio_.value(frame) - 1.0;
        const double knee = knee_.value(frame);
        const double half_knee = knee * 0.5;
        const double output_gain = std::exp(gain_.value(frame) * detail::kGainFactor);
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

    threshold_.advance(frame_count);
    ratio_.advance(frame_count);
    knee_.advance(frame_count);
    gain_.advance(frame_count);

    latest_amount_db_ = static_cast<float>(maximum_reduction);
    has_measurement_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (has_measurement_) {
      detail::writeGainReductionTelemetry(writer, latest_amount_db_);
    }
  }

private:
  struct LinearRamp {
    double current = 0.0;
    double target = 0.0;
    double step = 0.0;
    std::uint32_t remaining = 0u;

    void snap(double value) noexcept {
      current = value;
      target = value;
      step = 0.0;
      remaining = 0u;
    }
    void retarget(double value, std::uint32_t frames) noexcept {
      if (value == target)
        return;
      target = value;
      remaining = frames;
      step = (target - current) / static_cast<double>(frames);
    }
    [[nodiscard]] double value(std::uint32_t frame) const noexcept {
      const std::uint32_t elapsed = frame + 1u;
      return elapsed >= remaining ? target : current + step * static_cast<double>(elapsed);
    }
    void advance(std::uint32_t frames) noexcept {
      if (frames >= remaining) {
        current = target;
        remaining = 0u;
        step = 0.0;
      } else {
        current += step * static_cast<double>(frames);
        remaining -= frames;
      }
    }
  };

  void prepareCurveRamps() noexcept {
    const double threshold = static_cast<double>(params_.threshold);
    const double ratio = static_cast<double>(params_.ratio);
    const double knee = static_cast<double>(params_.knee);
    const double gain = static_cast<double>(params_.gain);
    if (!curve_initialized_) {
      threshold_.snap(threshold);
      ratio_.snap(ratio);
      knee_.snap(knee);
      gain_.snap(gain);
      curve_initialized_ = true;
      return;
    }
    const auto frames = static_cast<std::uint32_t>(std::max(1.0, sample_rate_ * 0.005));
    threshold_.retarget(threshold, frames);
    ratio_.retarget(ratio, frames);
    knee_.retarget(knee, frames);
    gain_.retarget(gain, frames);
  }

  detail::GateLookup lookup_;
  std::vector<dsp::AttackReleaseEnvelope> envelopes_;
  double sample_rate_ = 0.0;
  std::uint32_t last_channel_count_ = 0u;
  float latest_amount_db_ = 0.0F;
  bool has_measurement_ = false;
  bool curve_initialized_ = false;
  LinearRamp threshold_;
  LinearRamp ratio_;
  LinearRamp knee_;
  LinearRamp gain_;
};

static_assert(sizeof(GateKernel) <= 8192u);

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(GatePlugin, effetune::plugins::dynamics::GateKernel)

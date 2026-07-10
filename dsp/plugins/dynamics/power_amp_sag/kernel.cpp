#include "effetune/kernel.h"
#include "PowerAmpSagPluginParams.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace effetune::plugins::dynamics {

namespace power_amp_sag_detail {

constexpr std::uint16_t kTapPowerAmpSag = 12u;
constexpr std::uint16_t kTelemetryVersion = 1u;

void writeF32(std::uint8_t *output, float value) noexcept {
  std::uint32_t bits = 0u;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&bits, &value, sizeof(bits));
  output[0] = static_cast<std::uint8_t>(bits & 0xffu);
  output[1] = static_cast<std::uint8_t>((bits >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((bits >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>(bits >> 24u);
}

} // namespace power_amp_sag_detail

class PowerAmpSagKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::PowerAmpSagPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    psu_voltage_.resize(info.maxChannels);
    envelope_.resize(info.maxChannels);
    reset();
  }

  void reset() noexcept override {
    for (double &voltage : psu_voltage_) {
      voltage = 1.0;
    }
    for (double &envelope : envelope_) {
      envelope = 0.0;
    }
    shared_psu_voltage_ = 1.0;
    shared_envelope_ = 0.0;
    last_channel_count_ = 0u;
    last_monoblock_ = false;
    initialized_ = false;
    has_measurement_ = false;
    latest_input_envelope_percent_ = 0.0F;
    latest_gain_reduction_db_ = 0.0F;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > psu_voltage_.size() ||
        frame_count == 0u || sample_rate_ <= 0.0) {
      return;
    }

    const bool monoblock = params_.monoblock != 0.0F;
    if (!initialized_ || monoblock != last_monoblock_ || channel_count != last_channel_count_) {
      resetAudioState();
      initialized_ = true;
      last_monoblock_ = monoblock;
      last_channel_count_ = channel_count;
    }

    constexpr double kLn10Over20 = 0.11512925464970229;
    const double sag_sensitivity =
        std::exp(static_cast<double>(params_.sagSensitivity) * kLn10Over20);
    const double attack = std::exp(-1.0 / (0.001 * sample_rate_));
    const double release = std::exp(-1.0 / (0.010 * sample_rate_));
    const double inverse_attack = 1.0 - attack;
    const double inverse_release = 1.0 - release;
    const double capacitance =
        0.001 + (static_cast<double>(params_.powerStability) / 100.0) * 0.099;
    const double charge_rate = 2.0 + (static_cast<double>(params_.recoverySpeed) / 100.0) * 18.0;
    const double inverse_sample_rate = 1.0 / sample_rate_;

    double maximum_envelope = 0.0;
    double gain_reduction = 0.0;
    if (monoblock) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t offset = static_cast<std::size_t>(channel) * frame_count;
        double voltage = psu_voltage_[channel];
        double envelope = envelope_[channel];
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const std::size_t index = offset + frame;
          const double sample = static_cast<double>(audio[index]);
          const double adjusted = sample * sag_sensitivity;
          const double level = adjusted >= 0.0 ? adjusted : -adjusted;
          if (level > envelope) {
            envelope = envelope * attack + level * inverse_attack;
          } else {
            envelope = envelope * release + level * inverse_release;
          }
          if (envelope > maximum_envelope) {
            maximum_envelope = envelope;
          }

          const double output_envelope = envelope * voltage;
          const double current_draw = output_envelope * output_envelope;
          const double discharge = (current_draw / capacitance) * inverse_sample_rate;
          const double recharge = charge_rate * (1.0 - voltage) * inverse_sample_rate;
          voltage = voltage - discharge + recharge;
          audio[index] = static_cast<float>(sample * voltage);
        }
        psu_voltage_[channel] = voltage;
        envelope_[channel] = envelope;
      }

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        gain_reduction += 20.0 * std::log10(psu_voltage_[channel]);
      }
      gain_reduction /= static_cast<double>(channel_count);
    } else {
      double voltage = shared_psu_voltage_;
      double envelope = shared_envelope_;
      const double inverse_channel_count = 1.0 / static_cast<double>(channel_count);
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        double level_squared = 0.0;
        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
          const double adjusted = static_cast<double>(audio[index]) * sag_sensitivity;
          level_squared += adjusted * adjusted;
        }
        const double level = std::sqrt(level_squared * inverse_channel_count);
        if (level > envelope) {
          envelope = envelope * attack + level * inverse_attack;
        } else {
          envelope = envelope * release + level * inverse_release;
        }
        if (envelope > maximum_envelope) {
          maximum_envelope = envelope;
        }

        const double output_envelope = envelope * voltage;
        const double current_draw = output_envelope * output_envelope;
        const double discharge = (current_draw / capacitance) * inverse_sample_rate;
        const double recharge = charge_rate * (1.0 - voltage) * inverse_sample_rate;
        voltage = voltage - discharge + recharge;
        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
          audio[index] = static_cast<float>(static_cast<double>(audio[index]) * voltage);
        }
      }
      shared_psu_voltage_ = voltage;
      shared_envelope_ = envelope;
      gain_reduction = 20.0 * std::log10(voltage);
    }

    latest_input_envelope_percent_ = static_cast<float>(maximum_envelope * 100.0);
    latest_gain_reduction_db_ = static_cast<float>(gain_reduction);
    has_measurement_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!has_measurement_) {
      return;
    }
    std::array<std::uint8_t, 8u> payload{};
    power_amp_sag_detail::writeF32(payload.data(), latest_input_envelope_percent_);
    power_amp_sag_detail::writeF32(payload.data() + 4u, latest_gain_reduction_db_);
    writer.write(power_amp_sag_detail::kTapPowerAmpSag, power_amp_sag_detail::kTelemetryVersion,
                 payload.data(), static_cast<std::uint16_t>(payload.size()));
  }

private:
  void resetAudioState() noexcept {
    for (double &voltage : psu_voltage_) {
      voltage = 1.0;
    }
    for (double &envelope : envelope_) {
      envelope = 0.0;
    }
    shared_psu_voltage_ = 1.0;
    shared_envelope_ = 0.0;
  }

  std::vector<double> psu_voltage_;
  std::vector<double> envelope_;
  double sample_rate_ = 0.0;
  double shared_psu_voltage_ = 1.0;
  double shared_envelope_ = 0.0;
  std::uint32_t last_channel_count_ = 0u;
  bool last_monoblock_ = false;
  bool initialized_ = false;
  bool has_measurement_ = false;
  float latest_input_envelope_percent_ = 0.0F;
  float latest_gain_reduction_db_ = 0.0F;
};

static_assert(sizeof(PowerAmpSagKernel) <= 8192u);

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(PowerAmpSagPlugin, effetune::plugins::dynamics::PowerAmpSagKernel)

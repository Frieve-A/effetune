#include "effetune/kernel.h"
#include "MultibandCompressorPluginParams.h"

#include "../multiband_common.h"
#include "../multiband_telemetry.h"

#include <algorithm>
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

class CompressorLookup final {
public:
  void prepare() {
    db_.resize(kDbSize);
    gain_.resize(kGainSize);
    inverse_gain_.resize(kGainSize);
    for (std::uint32_t index = 0u; index < kDbSize; ++index) {
      const double value = static_cast<double>(index) / kDbScale;
      db_[index] =
          static_cast<float>(value < kMinimumEnvelope ? -120.0 : kLog10Times20 * std::log(value));
    }
    for (std::uint32_t index = 0u; index < kGainSize; ++index) {
      const double decibels = static_cast<double>(index) / kGainScale;
      gain_[index] = static_cast<float>(std::exp(-decibels * kGainFactor));
      inverse_gain_[index] = 1.0 / static_cast<double>(gain_[index]);
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

  // Returns the gain that applies a decibels-sized reduction, or its reciprocal for a boost.
  [[nodiscard]] double gain(double decibels, bool boost) const noexcept {
    if (decibels <= 0.0)
      return 1.0;
    std::uint32_t index = kGainSize - 1u;
    if (decibels < 60.0) {
      const double scaled = decibels * kGainScale;
      if (scaled <= static_cast<double>(kGainSize - 1u))
        index = static_cast<std::uint32_t>(scaled);
    }
    return boost ? inverse_gain_[index] : static_cast<double>(gain_[index]);
  }

private:
  static constexpr std::uint32_t kDbSize = 4096u;
  static constexpr double kDbScale = 4096.0 / 10.0;
  static constexpr std::uint32_t kGainSize = 2048u;
  static constexpr double kGainScale = 2048.0 / 60.0;

  std::vector<float> db_;
  std::vector<float> gain_;
  std::vector<double> inverse_gain_;
};

} // namespace

class MultibandCompressorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MultibandCompressorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    crossover_.prepare(info);
    envelopes_.resize(static_cast<std::size_t>(info.maxChannels) *
                      multiband_detail::kFiveBandCount);
    lookup_.prepare();
    ramp_frames_ = std::max(1u, static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005)));
    reset();
  }

  void reset() noexcept override {
    crossover_.reset();
    for (float &envelope : envelopes_)
      envelope = 0.0F;
    latest_values_.fill(0.0F);
    has_measurement_ = false;
    fade_counter_ = 0u;
    fade_length_ = 0u;
    controls_initialized_ = false;
    control_ramp_remaining_ = 0u;
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
      for (float &envelope : envelopes_) {
        envelope = static_cast<float>(kMinimumEnvelope);
      }
    }
    crossover_.split(audio, channel_count, frame_count);
    retargetControls();

    std::array<double, multiband_detail::kFiveBandCount * 2u> time_constants{};
    const double sample_rate_ms = sample_rate_ / 1000.0;
    for (std::uint32_t band = 0u; band < multiband_detail::kFiveBandCount; ++band) {
      double attack_samples = static_cast<double>(params_.attack[band]) * sample_rate_ms;
      if (attack_samples < 1.0)
        attack_samples = 1.0;
      double release_samples = static_cast<double>(params_.release[band]) * sample_rate_ms;
      if (release_samples < 1.0)
        release_samples = 1.0;
      time_constants[band * 2u] =
          static_cast<double>(static_cast<float>(std::exp(-kLog2 / attack_samples)));
      time_constants[band * 2u + 1u] =
          static_cast<double>(static_cast<float>(std::exp(-kLog2 / release_samples)));
    }

    // Without a pending ramp every control equals its current value, so each band's derived
    // controls are computed once per block.
    if (control_ramp_remaining_ == 0u) {
      BandControls stable{};
      for (std::uint32_t band = 0u; band < multiband_detail::kFiveBandCount; ++band)
        stable[band] = bandControl(band, 0u);
      processChannels(audio, channel_count, frame_count, time_constants,
                      [&stable](std::uint32_t) noexcept -> const BandControls & { return stable; });
    } else {
      processChannels(
          audio, channel_count, frame_count, time_constants, [this](std::uint32_t frame) noexcept {
            BandControls controls{};
            for (std::uint32_t band = 0u; band < multiband_detail::kFiveBandCount; ++band)
              controls[band] = bandControl(band, frame);
            return controls;
          });
    }
    advanceControls(frame_count);

    if (fade_counter_ < fade_length_) {
      const std::uint32_t next = fade_counter_ + frame_count;
      fade_counter_ = next >= fade_length_ ? fade_length_ : next;
    }
    has_measurement_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (has_measurement_) {
      multiband_telemetry::write(writer, multiband_telemetry::ValueKind::GainReduction,
                                 latest_values_);
    }
  }

private:
  struct BandControl {
    double threshold;
    double knee;
    double half_knee;
    double slope;
    double makeup;
  };
  using BandControls = std::array<BandControl, multiband_detail::kFiveBandCount>;

  [[nodiscard]] BandControl bandControl(std::uint32_t band, std::uint32_t frame) const noexcept {
    const std::size_t base = static_cast<std::size_t>(band) * 4u;
    const double ratio = std::clamp(controlAt(base + 1u, frame), 0.5, 20.0);
    double knee = controlAt(base + 2u, frame);
    if (knee < 0.0)
      knee = 0.0;
    return {controlAt(base, frame), knee, knee * 0.5, ratio == 1.0 ? 0.0 : 1.0 - 1.0 / ratio,
            std::exp(controlAt(base + 3u, frame) * kGainFactor)};
  }

  // Runs the five independent band envelopes and gain computers of each channel in one frame
  // loop so their recursions overlap. Bands are summed in ascending order as single floats.
  template <typename ControlsAt>
  void
  processChannels(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                  const std::array<double, multiband_detail::kFiveBandCount * 2u> &time_constants,
                  ControlsAt controls_at) noexcept {
    constexpr std::uint32_t kBands = multiband_detail::kFiveBandCount;
    const std::uint32_t fade_start = fade_counter_;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      float *const envelopes = envelopes_.data() + static_cast<std::size_t>(channel) * kBands;
      const float *band_signals[kBands];
      double envelope[kBands];
      double last_reduction[kBands];
      for (std::uint32_t band = 0u; band < kBands; ++band) {
        band_signals[band] = crossover_.band(channel, band);
        envelope[band] = static_cast<double>(envelopes[band]);
        last_reduction[band] = 0.0;
      }
      float *channel_audio = audio + static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const BandControls &controls = controls_at(frame);
        float output = 0.0F;
        for (std::uint32_t band = 0u; band < kBands; ++band) {
          const BandControl &control = controls[band];
          const double input = static_cast<double>(band_signals[band][frame]);
          const double magnitude = input >= 0.0 ? input : -input;
          const double coefficient = magnitude > envelope[band] ? time_constants[band * 2u]
                                                                : time_constants[band * 2u + 1u];
          double next = envelope[band] * coefficient + magnitude * (1.0 - coefficient);
          if (next < kMinimumEnvelope)
            next = kMinimumEnvelope;
          envelope[band] = next;
          const double difference =
              lookup_.decibels(static_cast<double>(static_cast<float>(next))) - control.threshold;
          double gain_change = 0.0;
          if (difference <= -control.half_knee) {
            gain_change = 0.0;
          } else if (difference >= control.half_knee) {
            gain_change = difference * control.slope;
          } else {
            const double position =
                control.knee > 0.0 ? (difference + control.half_knee) / control.knee : 1.0;
            gain_change = control.slope * control.knee * position * position * 0.5;
          }
          const double reduction = gain_change >= 0.0 ? gain_change : -gain_change;
          const double multiplier = lookup_.gain(reduction, gain_change < 0.0);
          output =
              static_cast<float>(static_cast<double>(output) + input * control.makeup * multiplier);
          last_reduction[band] = reduction;
        }
        if (fade_start + frame < fade_length_) {
          const double fade =
              static_cast<double>(fade_start + frame) / static_cast<double>(fade_length_);
          output = static_cast<float>(static_cast<double>(output) * fade);
        }
        channel_audio[frame] = output;
      }
      for (std::uint32_t band = 0u; band < kBands; ++band) {
        envelopes[band] = static_cast<float>(envelope[band]);
        latest_values_[band] = static_cast<float>(last_reduction[band]);
      }
    }
  }

  void retargetControls() noexcept {
    std::array<double, multiband_detail::kFiveBandCount * 4u> targets{};
    for (std::size_t band = 0u; band < multiband_detail::kFiveBandCount; ++band) {
      const std::size_t base = band * 4u;
      targets[base] = params_.threshold[band];
      targets[base + 1u] = params_.ratio[band];
      targets[base + 2u] = params_.knee[band];
      targets[base + 3u] = params_.gain[band];
    }
    if (!controls_initialized_) {
      current_controls_ = target_controls_ = targets;
      controls_initialized_ = true;
      return;
    }
    if (targets == target_controls_)
      return;
    target_controls_ = targets;
    for (std::size_t index = 0u; index < targets.size(); ++index) {
      control_steps_[index] =
          (targets[index] - current_controls_[index]) / static_cast<double>(ramp_frames_);
    }
    control_ramp_remaining_ = ramp_frames_;
  }

  double controlAt(std::size_t index, std::uint32_t frame) const noexcept {
    return current_controls_[index] +
           control_steps_[index] *
               static_cast<double>(std::min(frame + 1u, control_ramp_remaining_));
  }

  void advanceControls(std::uint32_t frames) noexcept {
    const std::uint32_t advanced = std::min(frames, control_ramp_remaining_);
    for (std::size_t index = 0u; index < current_controls_.size(); ++index) {
      current_controls_[index] += control_steps_[index] * static_cast<double>(advanced);
    }
    control_ramp_remaining_ -= advanced;
    if (control_ramp_remaining_ == 0u)
      current_controls_ = target_controls_;
  }

  void startFade() noexcept {
    const double requested = std::ceil(sample_rate_ * 0.005);
    const std::uint32_t requested_frames = static_cast<std::uint32_t>(requested);
    fade_length_ = requested_frames;
    fade_counter_ = 0u;
  }

  multiband_detail::FiveBandCrossover crossover_;
  CompressorLookup lookup_;
  std::vector<float> envelopes_;
  std::array<float, multiband_detail::kFiveBandCount> latest_values_{};
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t fade_counter_ = 0u;
  std::uint32_t fade_length_ = 0u;
  bool has_measurement_ = false;
  bool controls_initialized_ = false;
  std::array<double, multiband_detail::kFiveBandCount * 4u> current_controls_{};
  std::array<double, multiband_detail::kFiveBandCount * 4u> target_controls_{};
  std::array<double, multiband_detail::kFiveBandCount * 4u> control_steps_{};
  std::uint32_t ramp_frames_ = 240u;
  std::uint32_t control_ramp_remaining_ = 0u;
};

static_assert(sizeof(MultibandCompressorKernel) <= 8192u);

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(MultibandCompressorPlugin,
                         effetune::plugins::dynamics::MultibandCompressorKernel)

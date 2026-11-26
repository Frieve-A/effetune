#include "effetune/kernel.h"
#include "../biquad_band_chain.h"
#include "../five_band_peq/peq_coefficients.h"
#include "FifteenBandPEQPluginParams.h"
#include "effetune/dsp/biquad.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>

namespace effetune::plugins::eq {
namespace {

constexpr std::uint32_t kBands = 15u;
constexpr std::uint32_t kMaxChannels = 16u;

} // namespace

class FifteenBandPEQKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::FifteenBandPEQPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = info.sampleRate;
    transition_frames_ = static_cast<std::uint32_t>(
        std::max(1.0, std::ceil(static_cast<double>(sample_rate_) * 0.005)));
    reset();
  }

  void reset() noexcept override {
    for (dsp::BiquadDf1State &state : states_) {
      state.reset();
    }
    previous_frequency_.fill(std::numeric_limits<float>::quiet_NaN());
    previous_gain_.fill(std::numeric_limits<float>::quiet_NaN());
    previous_q_.fill(std::numeric_limits<float>::quiet_NaN());
    previous_type_.fill(std::numeric_limits<float>::quiet_NaN());
    previous_enabled_.fill(std::numeric_limits<float>::quiet_NaN());
    previous_master_gain_ = std::numeric_limits<float>::quiet_NaN();
    last_channel_count_ = 0u;
    coefficients_initialized_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > kMaxChannels ||
        frame_count == 0u || sample_rate_ <= 0.0F) {
      return;
    }
    if (last_channel_count_ != channel_count) {
      for (dsp::BiquadDf1State &state : states_) {
        state.reset();
      }
      last_channel_count_ = channel_count;
    }
    if (!coefficients_initialized_ || paramsDirty()) {
      updateCoefficients();
    }
    if (params_.masterGain != previous_master_gain_) {
      const double target = std::pow(10.0, static_cast<double>(params_.masterGain) / 20.0);
      if (std::isnan(previous_master_gain_)) {
        master_current_ = target;
        master_step_ = 0.0;
        master_remaining_ = 0u;
      } else {
        master_step_ = (target - master_current_) / static_cast<double>(transition_frames_);
        master_remaining_ = transition_frames_;
      }
      master_target_ = target;
      previous_master_gain_ = params_.masterGain;
    }
    const bool apply_master = master_remaining_ != 0u || master_current_ != 1.0;

    detail::processBandChain(audio, channel_count, frame_count, ramps_, states_.data(),
                             kMaxChannels);
    for (std::uint32_t channel = 0u; apply_master && channel < channel_count; ++channel) {
      float *channel_audio = audio + channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const std::uint32_t elapsed = frame + 1u;
        const double gain = elapsed >= master_remaining_
                                ? master_target_
                                : master_current_ + master_step_ * static_cast<double>(elapsed);
        channel_audio[frame] = static_cast<float>(static_cast<double>(channel_audio[frame]) * gain);
      }
    }
    for (detail::CoefficientRamp &ramp : ramps_)
      ramp.advance(frame_count);
    if (frame_count >= master_remaining_) {
      master_current_ = master_target_;
      master_step_ = 0.0;
      master_remaining_ = 0u;
    } else {
      master_current_ += master_step_ * static_cast<double>(frame_count);
      master_remaining_ -= frame_count;
    }
  }

private:
  void updateCoefficients() noexcept {
    std::uint32_t changed_mask = 0u;
    std::uint32_t topology_mask = 0u;
    for (std::uint32_t band = 0u; band < kBands; ++band) {
      const bool topology_changed = params_.filterType[band] != previous_type_[band] ||
                                    params_.bandEnabled[band] != previous_enabled_[band];
      const bool continuous_changed = params_.frequency[band] != previous_frequency_[band] ||
                                      params_.gain[band] != previous_gain_[band] ||
                                      params_.q[band] != previous_q_[band];
      if (topology_changed || continuous_changed)
        changed_mask |= 1u << band;
      if (topology_changed)
        topology_mask |= 1u << band;
    }
    for (std::uint32_t band = 0u; band < kBands; ++band) {
      if ((changed_mask & (1u << band)) == 0u)
        continue;
      dsp::BiquadCoefficients designed{};
      const bool active = detail::makePeqCoefficients(
          params_.gain[band], params_.filterType[band], params_.frequency[band], params_.q[band],
          params_.bandEnabled[band], sample_rate_, designed);
      if (!active)
        designed = {};
      if (!coefficients_initialized_ || (topology_mask & (1u << band)) != 0u)
        ramps_[band].snap(designed);
      else
        ramps_[band].retarget(designed, transition_frames_);
      previous_frequency_[band] = params_.frequency[band];
      previous_gain_[band] = params_.gain[band];
      previous_q_[band] = params_.q[band];
      previous_type_[band] = params_.filterType[band];
      previous_enabled_[band] = params_.bandEnabled[band];
    }
    coefficients_initialized_ = true;
  }

  std::array<detail::CoefficientRamp, kBands> ramps_{};
  std::array<dsp::BiquadDf1State, kBands * kMaxChannels> states_{};
  std::array<float, kBands> previous_frequency_{};
  std::array<float, kBands> previous_gain_{};
  std::array<float, kBands> previous_q_{};
  std::array<float, kBands> previous_type_{};
  std::array<float, kBands> previous_enabled_{};
  double master_current_ = 1.0;
  double master_target_ = 1.0;
  double master_step_ = 0.0;
  std::uint32_t master_remaining_ = 0u;
  float previous_master_gain_ = std::numeric_limits<float>::quiet_NaN();
  float sample_rate_ = 0.0F;
  std::uint32_t last_channel_count_ = 0u;
  bool coefficients_initialized_ = false;
  std::uint32_t transition_frames_ = 1u;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(FifteenBandPEQPlugin, effetune::plugins::eq::FifteenBandPEQKernel)

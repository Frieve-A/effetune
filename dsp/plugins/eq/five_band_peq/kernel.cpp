#include "effetune/kernel.h"
#include "FiveBandPEQPluginParams.h"
#include "effetune/dsp/biquad.h"
#include "peq_coefficients.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>

namespace effetune::plugins::eq {
namespace {

constexpr std::uint32_t kBands = 5u;
constexpr std::uint32_t kMaxChannels = 16u;

} // namespace

class FiveBandPEQKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::FiveBandPEQPluginParams)

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

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      float *channel_audio = audio + channel * frame_count;
      for (std::uint32_t band = 0u; band < kBands; ++band) {
        if (!ramps_[band].processingRequired()) {
          continue;
        }
        dsp::BiquadDf1State &state = states_[band * kMaxChannels + channel];
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const dsp::BiquadCoefficients coefficients = ramps_[band].value(frame);
          channel_audio[frame] = static_cast<float>(dsp::processBiquadDf1Sample(
              static_cast<double>(channel_audio[frame]), coefficients, state));
        }
      }
    }
    for (CoefficientRamp &ramp : ramps_)
      ramp.advance(frame_count);
  }

private:
  struct CoefficientRamp {
    dsp::BiquadCoefficients current{};
    dsp::BiquadCoefficients target{};
    dsp::BiquadCoefficients step{0.0, 0.0, 0.0, 0.0, 0.0};
    std::uint32_t remaining = 0u;
    static bool identity(const dsp::BiquadCoefficients &value) noexcept {
      return value.b0 == 1.0 && value.b1 == 0.0 && value.b2 == 0.0 && value.a1 == 0.0 &&
             value.a2 == 0.0;
    }
    void snap(const dsp::BiquadCoefficients &value) noexcept {
      current = target = value;
      step = {0.0, 0.0, 0.0, 0.0, 0.0};
      remaining = 0u;
    }
    void retarget(const dsp::BiquadCoefficients &value, std::uint32_t frames) noexcept {
      target = value;
      const double denominator = static_cast<double>(frames);
      step = {(target.b0 - current.b0) / denominator, (target.b1 - current.b1) / denominator,
              (target.b2 - current.b2) / denominator, (target.a1 - current.a1) / denominator,
              (target.a2 - current.a2) / denominator};
      remaining = frames;
    }
    [[nodiscard]] bool processingRequired() const noexcept {
      return remaining != 0u || !identity(current);
    }
    [[nodiscard]] dsp::BiquadCoefficients value(std::uint32_t frame) const noexcept {
      const std::uint32_t elapsed = frame + 1u;
      if (elapsed >= remaining)
        return target;
      const double offset = static_cast<double>(elapsed);
      return {current.b0 + step.b0 * offset, current.b1 + step.b1 * offset,
              current.b2 + step.b2 * offset, current.a1 + step.a1 * offset,
              current.a2 + step.a2 * offset};
    }
    void advance(std::uint32_t frames) noexcept {
      if (frames >= remaining) {
        current = target;
        step = {0.0, 0.0, 0.0, 0.0, 0.0};
        remaining = 0u;
      } else {
        const double offset = static_cast<double>(frames);
        current = {current.b0 + step.b0 * offset, current.b1 + step.b1 * offset,
                   current.b2 + step.b2 * offset, current.a1 + step.a1 * offset,
                   current.a2 + step.a2 * offset};
        remaining -= frames;
      }
    }
  };

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

  std::array<CoefficientRamp, kBands> ramps_{};
  std::array<dsp::BiquadDf1State, kBands * kMaxChannels> states_{};
  std::array<float, kBands> previous_frequency_{};
  std::array<float, kBands> previous_gain_{};
  std::array<float, kBands> previous_q_{};
  std::array<float, kBands> previous_type_{};
  std::array<float, kBands> previous_enabled_{};
  float sample_rate_ = 0.0F;
  std::uint32_t last_channel_count_ = 0u;
  bool coefficients_initialized_ = false;
  std::uint32_t transition_frames_ = 1u;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(FiveBandPEQPlugin, effetune::plugins::eq::FiveBandPEQKernel)

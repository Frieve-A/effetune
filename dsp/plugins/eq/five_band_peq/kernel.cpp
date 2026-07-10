#include "effetune/kernel.h"
#include "FiveBandPEQPluginParams.h"
#include "effetune/dsp/biquad.h"
#include "peq_coefficients.h"

#include <array>
#include <cstdint>

namespace effetune::plugins::eq {
namespace {

constexpr std::uint32_t kBands = 5u;
constexpr std::uint32_t kMaxChannels = 8u;

} // namespace

class FiveBandPEQKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::FiveBandPEQPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = info.sampleRate;
    reset();
  }

  void reset() noexcept override {
    for (dsp::BiquadDf1State &state : states_) {
      state.reset();
    }
    active_.fill(false);
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
        if (!active_[band]) {
          continue;
        }
        dsp::BiquadDf1State &state = states_[band * kMaxChannels + channel];
        const dsp::BiquadCoefficients &coefficients = coefficients_[band];
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          channel_audio[frame] = static_cast<float>(dsp::processBiquadDf1Sample(
              static_cast<double>(channel_audio[frame]), coefficients, state));
        }
      }
    }
  }

private:
  void updateCoefficients() noexcept {
    for (std::uint32_t band = 0u; band < kBands; ++band) {
      active_[band] = detail::makePeqCoefficients(
          params_.gain[band], params_.filterType[band], params_.frequency[band], params_.q[band],
          params_.bandEnabled[band], sample_rate_, coefficients_[band]);
    }
    coefficients_initialized_ = true;
  }

  std::array<dsp::BiquadCoefficients, kBands> coefficients_{};
  std::array<dsp::BiquadDf1State, kBands * kMaxChannels> states_{};
  std::array<bool, kBands> active_{};
  float sample_rate_ = 0.0F;
  std::uint32_t last_channel_count_ = 0u;
  bool coefficients_initialized_ = false;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(FiveBandPEQPlugin, effetune::plugins::eq::FiveBandPEQKernel)

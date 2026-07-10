#include "effetune/kernel.h"
#include "FDNReverbPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::reverb {
namespace {

constexpr std::uint32_t kLineCount = 8u;
constexpr double kTwoPi = 6.283185307179586;
constexpr std::array<std::array<int, kLineCount>, kLineCount> kHadamard = {{
    {{1, 1, 1, 1, 1, 1, 1, 1}},
    {{1, -1, 1, -1, 1, -1, 1, -1}},
    {{1, 1, -1, -1, 1, 1, -1, -1}},
    {{1, -1, -1, 1, 1, -1, -1, 1}},
    {{1, 1, 1, 1, -1, -1, -1, -1}},
    {{1, -1, 1, -1, -1, 1, -1, 1}},
    {{1, 1, -1, -1, -1, -1, 1, 1}},
    {{1, -1, -1, 1, -1, 1, 1, -1}},
}};

} // namespace

class FDNReverbKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::FDNReverbPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    const double delay_ceiling = std::ceil(sample_rate_ * 0.175);
    delay_line_length_ = delay_ceiling < 1.0 ? 1u : static_cast<std::uint32_t>(delay_ceiling);
    const double pre_delay_ceiling = std::ceil(sample_rate_ * 0.1);
    pre_delay_length_ =
        pre_delay_ceiling < 1.0 ? 1u : static_cast<std::uint32_t>(pre_delay_ceiling);
    for (std::vector<float> &line : delay_lines_)
      line.resize(delay_line_length_);
    pre_delay_.resize(static_cast<std::size_t>(max_channels_) * pre_delay_length_);
    pre_delay_positions_.resize(max_channels_);
    clearRuntimeState();
  }

  void reset() noexcept override {
    clearRuntimeState();
    random_.seed(selected_seed_low_, selected_seed_high_);
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    random_.seed(seed_low, seed_high);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }
    if (!tank_initialized_)
      initializeTank();
    if (active_channel_count_ != channel_count)
      resetPreDelay(channel_count);

    std::uint32_t density = static_cast<std::uint32_t>(params_.density);
    if (density < 1u)
      density = 1u;
    if (density > kLineCount)
      density = kLineCount;
    const double diffusion = static_cast<double>(params_.diffusion) * 0.01;
    const double modulation_depth =
        std::pow(2.0, static_cast<double>(params_.modulationDepth) / 1200.0) - 1.0;
    const double lfo_increment =
        kTwoPi * static_cast<double>(params_.modulationRate) / sample_rate_;
    const double wet_mix = static_cast<double>(params_.wetMix) * 0.01;
    const double dry_mix = static_cast<double>(params_.dryMix) * 0.01;
    const double stereo_width = static_cast<double>(params_.stereoWidth) * 0.01;
    const double pre_delay_value = static_cast<double>(params_.preDelay) * sample_rate_ * 0.001;
    const std::uint32_t pre_delay_samples =
        pre_delay_value > 0.0 ? static_cast<std::uint32_t>(pre_delay_value) : 0u;

    double hf_normalized = static_cast<double>(params_.highFrequencyDamp) / 12.0;
    if (hf_normalized < 0.0)
      hf_normalized = 0.0;
    if (hf_normalized > 1.0)
      hf_normalized = 1.0;
    const double hf_cutoff = 20000.0 * std::pow(500.0 / 20000.0, hf_normalized);
    double lowpass_alpha = 0.0;
    if (hf_cutoff < sample_rate_ * 0.495) {
      lowpass_alpha = std::exp(-kTwoPi * hf_cutoff / sample_rate_);
      if (lowpass_alpha < 0.0)
        lowpass_alpha = 0.0;
      if (lowpass_alpha > 0.99999)
        lowpass_alpha = 0.99999;
    }

    const double low_cut = static_cast<double>(params_.lowCut);
    double highpass_alpha = 0.0;
    const bool apply_highpass = low_cut > 1.0;
    if (apply_highpass) {
      highpass_alpha = std::exp(-kTwoPi * low_cut / sample_rate_);
      if (highpass_alpha < 0.0)
        highpass_alpha = 0.0;
      if (highpass_alpha > 0.99999)
        highpass_alpha = 0.99999;
    }

    std::array<float, kLineCount> delay_times{};
    std::array<float, kLineCount> feedback_gains{};
    const double base_delay = static_cast<double>(params_.baseDelay) * sample_rate_ * 0.001;
    const double delay_spread = static_cast<double>(params_.delaySpread) * sample_rate_ * 0.001;
    for (std::uint32_t line = 0u; line < density; ++line) {
      double deterministic_delay = base_delay;
      if (density > 1u) {
        const double ratio = static_cast<double>(line) / static_cast<double>(density - 1u);
        deterministic_delay += delay_spread * std::pow(ratio, 0.8);
      }
      const double random_offset =
          static_cast<double>(random_delay_offsets_ms_[line]) * sample_rate_ * 0.001;
      double delay = deterministic_delay + random_offset;
      if (delay < 1.0)
        delay = 1.0;
      delay_times[line] = static_cast<float>(delay);
    }
    const double reverb_time = static_cast<double>(params_.reverbTime);
    for (std::uint32_t line = 0u; line < density; ++line) {
      std::int32_t effective = static_cast<std::int32_t>(delay_times[line]);
      if (effective < 1)
        effective = 1;
      double gain = 0.0;
      if (reverb_time > 0.0) {
        gain = std::pow(0.001, static_cast<double>(effective) / (sample_rate_ * reverb_time));
      }
      if (gain < -0.99999)
        gain = -0.99999;
      if (gain > 0.99999)
        gain = 0.99999;
      feedback_gains[line] = static_cast<float>(gain);
    }

    const double inverse_sqrt_density = 1.0 / std::sqrt(static_cast<double>(density));
    const std::uint32_t left_count = (density + 1u) >> 1u;
    const std::uint32_t right_count = density >> 1u;
    const double inverse_sqrt_left =
        left_count > 0u ? 1.0 / std::sqrt(static_cast<double>(left_count)) : 0.0;
    const double inverse_sqrt_right =
        right_count > 0u ? 1.0 / std::sqrt(static_cast<double>(right_count)) : 0.0;
    std::array<float, kLineCount> fdn_outputs{};
    std::array<float, kLineCount> hadamard_outputs{};

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      for (std::uint32_t line = 0u; line < kLineCount; ++line) {
        float phase = static_cast<float>(static_cast<double>(lfo_phases_[line]) + lfo_increment);
        if (static_cast<double>(phase) >= kTwoPi) {
          phase = static_cast<float>(static_cast<double>(phase) - kTwoPi);
        }
        lfo_phases_[line] = phase;
      }

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t audio_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const double input = static_cast<double>(audio[audio_index]);
        float *pre_delay =
            pre_delay_.data() + static_cast<std::size_t>(channel) * pre_delay_length_;
        std::uint32_t &pre_position = pre_delay_positions_[channel];
        double tank_input = input;
        if (pre_delay_samples > 0u) {
          const std::uint32_t wrapped_delay = pre_delay_samples % pre_delay_length_;
          const std::uint32_t read =
              (pre_position + pre_delay_length_ - wrapped_delay) % pre_delay_length_;
          tank_input = static_cast<double>(pre_delay[read]);
        }
        pre_delay[pre_position] = static_cast<float>(input);
        ++pre_position;
        if (pre_position >= pre_delay_length_)
          pre_position = 0u;

        for (std::uint32_t line = 0u; line < density; ++line) {
          const std::vector<float> &delay_line = delay_lines_[line];
          const std::uint32_t write = delay_positions_[line];
          const double lfo = std::sin(static_cast<double>(lfo_phases_[line]) +
                                      static_cast<double>(lfo_offsets_[line]));
          double modulated =
              static_cast<double>(delay_times[line]) * (1.0 + modulation_depth * lfo);
          if (modulated < 0.0)
            modulated = 0.0;
          const double upper = static_cast<double>(delay_line_length_) - 1.00001;
          if (modulated > upper)
            modulated = upper;
          const std::int32_t integer_delay = static_cast<std::int32_t>(modulated);
          const double fraction = modulated - static_cast<double>(integer_delay);
          const std::int64_t length = static_cast<std::int64_t>(delay_line_length_);
          std::int64_t index0 = static_cast<std::int64_t>(write) - 1 - integer_delay;
          std::int64_t index1 = index0 - 1;
          if (index0 < 0)
            index0 += length;
          if (index1 < 0)
            index1 += length;
          const double sample0 = static_cast<double>(delay_line[static_cast<std::size_t>(index0)]);
          const double sample1 = static_cast<double>(delay_line[static_cast<std::size_t>(index1)]);
          fdn_outputs[line] = static_cast<float>(sample0 + (sample1 - sample0) * fraction);
        }

        for (std::uint32_t row = 0u; row < density; ++row) {
          double sum = 0.0;
          for (std::uint32_t column = 0u; column < density; ++column) {
            sum += static_cast<double>(kHadamard[row][column]) *
                   static_cast<double>(fdn_outputs[column]);
          }
          hadamard_outputs[row] = static_cast<float>(sum * inverse_sqrt_density);
        }

        for (std::uint32_t line = 0u; line < density; ++line) {
          const std::uint32_t write = delay_positions_[line];
          const double diffused = static_cast<double>(hadamard_outputs[line]) * diffusion;
          double signal = tank_input + diffused * static_cast<double>(feedback_gains[line]);
          if (lowpass_alpha > 0.0) {
            lowpass_states_[line] =
                static_cast<float>((1.0 - lowpass_alpha) * signal +
                                   lowpass_alpha * static_cast<double>(lowpass_states_[line]));
            signal = static_cast<double>(lowpass_states_[line]);
          }
          if (apply_highpass) {
            const double low_component =
                (1.0 - highpass_alpha) * signal +
                highpass_alpha * static_cast<double>(highpass_states_[line]);
            signal -= low_component;
            highpass_states_[line] = static_cast<float>(low_component);
          }
          delay_lines_[line][write] = static_cast<float>(signal);
          std::uint32_t next = write + 1u;
          if (next >= delay_line_length_)
            next = 0u;
          delay_positions_[line] = next;
        }

        double left_sum = 0.0;
        double right_sum = 0.0;
        for (std::uint32_t line = 0u; line < density; ++line) {
          if ((line & 1u) == 0u) {
            left_sum += static_cast<double>(fdn_outputs[line]);
          } else {
            right_sum += static_cast<double>(fdn_outputs[line]);
          }
        }
        const double left_wet = left_sum * inverse_sqrt_left;
        const double right_wet = right_sum * inverse_sqrt_right;
        const double mono = (left_wet + right_wet) * 0.5;
        double wet = mono;
        if (channel_count != 1u) {
          double width = stereo_width * 0.5;
          if (width < 0.0)
            width = 0.0;
          if (width > 1.0)
            width = 1.0;
          const double side = channel == 0u ? left_wet : right_wet;
          wet = mono * (1.0 - width) + side * width;
        }
        audio[audio_index] = static_cast<float>(input * dry_mix + wet * wet_mix);
      }
    }
  }

private:
  void clearRuntimeState() noexcept {
    for (std::vector<float> &line : delay_lines_) {
      std::fill(line.begin(), line.end(), 0.0F);
    }
    std::fill(pre_delay_.begin(), pre_delay_.end(), 0.0F);
    std::fill(pre_delay_positions_.begin(), pre_delay_positions_.end(), 0u);
    delay_positions_.fill(0u);
    lfo_phases_.fill(0.0F);
    lfo_offsets_.fill(0.0F);
    lowpass_states_.fill(0.0F);
    highpass_states_.fill(0.0F);
    random_delay_offsets_ms_.fill(0.0F);
    active_channel_count_ = 0u;
    tank_initialized_ = false;
  }
  void initializeTank() noexcept {
    for (std::vector<float> &line : delay_lines_) {
      std::fill(line.begin(), line.end(), 0.0F);
    }
    delay_positions_.fill(0u);
    lowpass_states_.fill(0.0F);
    highpass_states_.fill(0.0F);
    for (std::uint32_t line = 0u; line < kLineCount; ++line) {
      random_delay_offsets_ms_[line] = static_cast<float>((random_.nextFloat01() - 0.5) * 6.0);
    }
    for (std::uint32_t line = 0u; line < kLineCount; ++line) {
      lfo_phases_[line] = static_cast<float>(random_.nextFloat01() * kTwoPi);
      lfo_offsets_[line] =
          static_cast<float>(static_cast<double>(line) * kTwoPi / static_cast<double>(kLineCount));
    }
    tank_initialized_ = true;
  }

  void resetPreDelay(std::uint32_t channel_count) noexcept {
    std::fill(pre_delay_.begin(), pre_delay_.end(), 0.0F);
    std::fill(pre_delay_positions_.begin(), pre_delay_positions_.end(), 0u);
    active_channel_count_ = channel_count;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t delay_line_length_ = 1u;
  std::uint32_t pre_delay_length_ = 1u;
  std::uint32_t active_channel_count_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool tank_initialized_ = false;
  dsp::XorShiftRng random_{};
  std::array<std::vector<float>, kLineCount> delay_lines_;
  std::array<std::uint32_t, kLineCount> delay_positions_{};
  std::array<float, kLineCount> lfo_phases_{};
  std::array<float, kLineCount> lfo_offsets_{};
  std::array<float, kLineCount> lowpass_states_{};
  std::array<float, kLineCount> highpass_states_{};
  std::array<float, kLineCount> random_delay_offsets_ms_{};
  std::vector<float> pre_delay_;
  std::vector<std::uint32_t> pre_delay_positions_;
};

static_assert(sizeof(FDNReverbKernel) <= 8192u);

} // namespace effetune::plugins::reverb

EFFETUNE_REGISTER_KERNEL(FDNReverbPlugin, effetune::plugins::reverb::FDNReverbKernel)

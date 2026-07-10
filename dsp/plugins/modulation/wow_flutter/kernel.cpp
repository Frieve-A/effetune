#include "effetune/kernel.h"
#include "WowFlutterPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::modulation {

class WowFlutterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::WowFlutterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    const double raw_size = std::ceil(0.1 * sample_rate_);
    buffer_size_ = raw_size > 0.0 ? static_cast<std::uint32_t>(raw_size) : 1u;
    delay_buffers_.resize(static_cast<std::size_t>(max_channels_) * buffer_size_);
    channel_x1_.resize(max_channels_);
    channel_x2_.resize(max_channels_);
    reset();
  }

  void reset() noexcept override {
    clearAudioState();
    last_channel_count_ = 0u;
    initialized_ = false;
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
        frame_count == 0u || sample_rate_ <= 0.0 || buffer_size_ == 0u) {
      return;
    }
    if (!initialized_ || channel_count != last_channel_count_) {
      clearAudioState();
      initialized_ = true;
      last_channel_count_ = channel_count;
    }

    constexpr double kTwoPi = 6.283185307179586;
    constexpr double kDegreesToRadians = 0.017453292519943295;
    constexpr double kInverseSqrtTwo = 0.7071067811865475;
    const double phase_increment = kTwoPi * static_cast<double>(params_.rate) / sample_rate_;
    const double channel_phase = static_cast<double>(params_.channelPhase) * kDegreesToRadians;
    const double sync = static_cast<double>(params_.channelSync) * 0.01;
    const double independent = 1.0 - sync;
    const double milliseconds_to_samples = sample_rate_ * 0.001;

    const double calculated_q =
        std::pow(10.0, (static_cast<double>(params_.randomnessSlope) + 6.0) / 6.0) *
        kInverseSqrtTwo;
    const double q = calculated_q < 0.01 ? 0.01 : calculated_q;
    const double cutoff = static_cast<double>(params_.randomnessCutoff);
    double b0 = 1.0;
    double b1 = 0.0;
    double b2 = 0.0;
    double a1 = 0.0;
    double a2 = 0.0;
    if (cutoff > 0.0 && cutoff < sample_rate_ * 0.5) {
      const double omega = kTwoPi * cutoff / sample_rate_;
      const double cosine = std::cos(omega);
      const double alpha = std::sin(omega) / (2.0 * q);
      const double a0 = 1.0 + alpha;
      if (alpha > 1.0e-9 && a0 > 1.0e-9) {
        const double inverse_a0 = 1.0 / a0;
        const double one_minus_cosine = 1.0 - cosine;
        b0 = (one_minus_cosine * 0.5) * inverse_a0;
        b1 = one_minus_cosine * inverse_a0;
        b2 = b0;
        a1 = (-2.0 * cosine) * inverse_a0;
        a2 = (1.0 - alpha) * inverse_a0;
      }
    } else if (cutoff <= 0.0) {
      common_x1_ = 0.0;
      common_x2_ = 0.0;
      for (float &value : channel_x1_) {
        value = 0.0F;
      }
      for (float &value : channel_x2_) {
        value = 0.0F;
      }
    }

    double phase = phase_;
    std::uint32_t buffer_position = buffer_position_;
    double common_x1 = common_x1_;
    double common_x2 = common_x2_;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      phase += phase_increment;
      if (phase >= kTwoPi) {
        phase -= kTwoPi;
      }

      const double common_noise = random_.nextFloat01() - 0.5;
      const double filtered_common = b0 * common_noise + common_x1;
      common_x1 = b1 * common_noise - a1 * filtered_common + common_x2;
      common_x2 = b2 * common_noise - a2 * filtered_common;

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t delay_offset = static_cast<std::size_t>(channel) * buffer_size_;
        float *delay = delay_buffers_.data() + delay_offset;
        const std::size_t audio_index = static_cast<std::size_t>(channel) * frame_count + frame;
        delay[buffer_position] = audio[audio_index];

        double current_channel_phase = phase + static_cast<double>(channel) * channel_phase;
        current_channel_phase -= kTwoPi * std::floor(current_channel_phase / kTwoPi);

        const double channel_noise = random_.nextFloat01() - 0.5;
        const double x1 = static_cast<double>(channel_x1_[channel]);
        const double x2 = static_cast<double>(channel_x2_[channel]);
        const double filtered_channel = b0 * channel_noise + x1;
        channel_x1_[channel] = static_cast<float>(b1 * channel_noise - a1 * filtered_channel + x2);
        channel_x2_[channel] = static_cast<float>(b2 * channel_noise - a2 * filtered_channel);

        const double filtered_noise = sync * filtered_common + independent * filtered_channel + 0.5;
        const double base_delay = (1.0 - std::sin(current_channel_phase)) * 0.5;
        const double total_delay_ms = base_delay * static_cast<double>(params_.depth) +
                                      filtered_noise * static_cast<double>(params_.randomness);
        const double delay_samples = total_delay_ms * milliseconds_to_samples;
        const double read_position = static_cast<double>(buffer_position) - delay_samples;
        double wrapped = std::fmod(read_position, static_cast<double>(buffer_size_));
        if (wrapped < 0.0) {
          wrapped += static_cast<double>(buffer_size_);
        }
        const std::uint32_t first = static_cast<std::uint32_t>(std::floor(wrapped));
        const double fraction = wrapped - static_cast<double>(first);
        const std::uint32_t second = first + 1u >= buffer_size_ ? 0u : first + 1u;
        const double sample1 = static_cast<double>(delay[first]);
        const double sample2 = static_cast<double>(delay[second]);
        audio[audio_index] = static_cast<float>(sample1 + fraction * (sample2 - sample1));
      }

      ++buffer_position;
      if (buffer_position >= buffer_size_) {
        buffer_position = 0u;
      }
    }

    phase_ = phase;
    buffer_position_ = buffer_position;
    common_x1_ = common_x1;
    common_x2_ = common_x2;
  }

private:
  void clearAudioState() noexcept {
    for (float &sample : delay_buffers_) {
      sample = 0.0F;
    }
    for (float &value : channel_x1_) {
      value = 0.0F;
    }
    for (float &value : channel_x2_) {
      value = 0.0F;
    }
    phase_ = 0.0;
    buffer_position_ = 0u;
    common_x1_ = 0.0;
    common_x2_ = 0.0;
  }

  std::vector<float> delay_buffers_;
  std::vector<float> channel_x1_;
  std::vector<float> channel_x2_;
  dsp::XorShiftRng random_{};
  double sample_rate_ = 0.0;
  double phase_ = 0.0;
  double common_x1_ = 0.0;
  double common_x2_ = 0.0;
  std::uint32_t buffer_size_ = 0u;
  std::uint32_t buffer_position_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool initialized_ = false;
};

static_assert(sizeof(WowFlutterKernel) <= 8192u);

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(WowFlutterPlugin, effetune::plugins::modulation::WowFlutterKernel)

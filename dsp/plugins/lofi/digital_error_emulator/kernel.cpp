#include "effetune/kernel.h"
#include "DigitalErrorEmulatorPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

constexpr std::uint32_t kMaximumPlcSamples = 8192u;
constexpr std::uint32_t kCdSymbolCount = 24u;
constexpr double kTwoPi = 6.283185307179586;
constexpr double kBluetoothDecay = 0.995;
constexpr double kBluetoothWarbleHz = 4.3;
constexpr double kBluetoothWarbleAmplitude = 0.002;
constexpr double kLc3BlendFactor = 0.95;
constexpr double kLc3ArtifactAmplitude = 0.0002;

enum class Mode : std::uint32_t {
  BitHold = 0u,
  ShortHold,
  ShortMute,
  RowCorruption,
  RowMute,
  MicroFrameDrop,
  Udp64,
  Udp128,
  Udp256,
  BluetoothA2dp,
  BluetoothLe,
  WisaMute,
  RfSquelch,
  CdHold,
  CdInterpolated
};

constexpr std::uint32_t kModeCount = 15u;

double clampSample(double value) noexcept {
  if (value > 1.0) {
    return 1.0;
  }
  return value < -1.0 ? -1.0 : value;
}

double jsRound(double value) noexcept { return std::floor(value + 0.5); }

bool isCdMode(Mode mode) noexcept { return mode == Mode::CdHold || mode == Mode::CdInterpolated; }

bool isUdpMode(Mode mode) noexcept {
  return mode == Mode::Udp64 || mode == Mode::Udp128 || mode == Mode::Udp256;
}

std::uint32_t fixedUnitSize(Mode mode) noexcept {
  switch (mode) {
  case Mode::BitHold:
    return 1u;
  case Mode::ShortHold:
  case Mode::ShortMute:
  case Mode::WisaMute:
    return 32u;
  case Mode::RowCorruption:
  case Mode::RowMute:
    return 192u;
  case Mode::Udp64:
    return 64u;
  case Mode::Udp128:
    return 128u;
  case Mode::Udp256:
    return 256u;
  case Mode::BluetoothA2dp:
    return 360u;
  case Mode::BluetoothLe:
    return 480u;
  case Mode::RfSquelch:
    return 48u;
  case Mode::CdHold:
  case Mode::CdInterpolated:
    return 588u;
  case Mode::MicroFrameDrop:
    return 0u;
  }
  return 1u;
}

std::uint32_t fixedBitsPerUnit(Mode mode) noexcept {
  switch (mode) {
  case Mode::BitHold:
    return 24u;
  case Mode::ShortHold:
  case Mode::ShortMute:
  case Mode::WisaMute:
    return 1024u;
  case Mode::RowCorruption:
  case Mode::RowMute:
    return 6144u;
  case Mode::RfSquelch:
    return 1536u;
  default:
    return 0u;
  }
}

} // namespace

class DigitalErrorEmulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::DigitalErrorEmulatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;

    plc_buffer_.resize(static_cast<std::size_t>(max_channels_) * kMaximumPlcSamples);
    pink_noise_state_.resize(max_channels_);
    last_good_samples_.resize(max_channels_);
    delay_buffer_.resize(max_channels_);
    error_last_good_samples_.resize(max_channels_);
    wet_data_.resize(static_cast<std::size_t>(max_channels_) * max_frames_);
    delayed_data_.resize(static_cast<std::size_t>(max_channels_) * max_frames_);
    shared_error_probability_.resize(max_frames_);
    shared_bit_position_.resize(max_frames_);
    shared_warble_phase_.resize(max_frames_);
  }

  void reset() noexcept override {
    clearChannelStorage();
    std::fill(wet_data_.begin(), wet_data_.end(), 0.0F);
    std::fill(delayed_data_.begin(), delayed_data_.end(), 0.0F);
    std::fill(shared_error_probability_.begin(), shared_error_probability_.end(), 0.0);
    std::fill(shared_bit_position_.begin(), shared_bit_position_.end(), std::uint8_t{0});
    std::fill(shared_warble_phase_.begin(), shared_warble_phase_.end(), 0.0);
    symbol_error_flags_.fill(std::uint8_t{0});

    sample_count_ = 0u;
    next_event_time_ = -1.0;
    last_channel_count_ = 0u;
    configured_ = false;
    last_params_valid_ = false;
    delay_buffer_valid_ = false;
    clearErrorState();
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
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }

    if (!configured_ || last_channel_count_ != channel_count) {
      resetForChannels(channel_count);
    }

    const Mode mode = currentMode();
    const double bit_error_exponent = static_cast<double>(params_.bitErrorRateExponent);
    const double reference_fs = static_cast<double>(params_.referenceFs);
    const double wet_mix = static_cast<double>(params_.wetMix) / 100.0;
    const double dry_mix = 1.0 - wet_mix;

    if (!last_params_valid_ || last_bit_error_exponent_ != bit_error_exponent ||
        last_mode_ != mode || last_reference_fs_ != reference_fs ||
        last_sample_rate_ != sample_rate_) {
      next_event_time_ = -1.0;
      clearErrorState();
      last_bit_error_exponent_ = bit_error_exponent;
      last_mode_ = mode;
      last_reference_fs_ = reference_fs;
      last_sample_rate_ = sample_rate_;
      last_params_valid_ = true;
    }

    const std::uint32_t unit_samples = calculateUnitSamples(mode, reference_fs);
    const double bits_per_unit = calculateBitsPerUnit(mode, unit_samples, channel_count);
    const double event_probability =
        calculateEventProbability(mode, bit_error_exponent, bits_per_unit);

    scheduleNextEvent(event_probability, unit_samples);

    const std::size_t audio_samples = static_cast<std::size_t>(channel_count) * frame_count;
    std::copy_n(audio, audio_samples, wet_data_.data());
    if (mode == Mode::CdInterpolated) {
      prepareDelayedData(audio, channel_count, frame_count);
    }

    std::uint32_t frame = 0u;
    while (frame < frame_count) {
      const std::uint64_t current_global_sample = sample_count_ + frame;

      if (error_active_) {
        const std::uint32_t block_remaining = frame_count - frame;
        const std::uint32_t samples_to_process =
            block_remaining < error_samples_remaining_ ? block_remaining : error_samples_remaining_;
        processOngoingError(audio, channel_count, frame_count, frame, samples_to_process,
                            unit_samples, current_global_sample);
        error_samples_remaining_ -= samples_to_process;
        if (error_samples_remaining_ == 0u) {
          error_active_ = false;
          next_event_time_ = -1.0;
        }
        frame += samples_to_process;
        continue;
      }

      if (static_cast<double>(current_global_sample) >= next_event_time_) {
        std::uint32_t error_duration =
            determineErrorDuration(mode, unit_samples, bit_error_exponent);
        if (error_duration == 0u) {
          next_event_time_ = -1.0;
          ++frame;
          continue;
        }

        const std::uint32_t block_remaining = frame_count - frame;
        const std::uint32_t samples_in_block =
            block_remaining < error_duration ? block_remaining : error_duration;
        captureErrorHistory(audio, channel_count, frame_count, frame, unit_samples);
        applyNewError(audio, channel_count, frame_count, frame, samples_in_block, error_duration,
                      unit_samples, mode, current_global_sample);

        if (error_duration > samples_in_block) {
          error_active_ = true;
          error_samples_remaining_ = error_duration - samples_in_block;
          error_mode_ = mode;
          error_total_duration_ = error_duration;
        } else {
          clearErrorState();
          next_event_time_ = -1.0;
        }
        frame += samples_in_block;
      } else {
        ++frame;
      }
    }

    sample_count_ += frame_count;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      last_good_samples_[channel] = wet_data_[offset + frame_count - 1u];
      for (std::uint32_t index = 0u; index < frame_count; ++index) {
        const std::uint32_t audio_index = offset + index;
        audio[audio_index] =
            static_cast<float>(static_cast<double>(audio[audio_index]) * dry_mix +
                               static_cast<double>(wet_data_[audio_index]) * wet_mix);
      }
    }
  }

private:
  Mode currentMode() const noexcept {
    double raw = static_cast<double>(params_.mode);
    if (!std::isfinite(raw) || raw < 0.0) {
      raw = 0.0;
    }
    std::uint32_t index = static_cast<std::uint32_t>(raw);
    if (index >= kModeCount) {
      index = kModeCount - 1u;
    }
    return static_cast<Mode>(index);
  }

  void clearChannelStorage() noexcept {
    std::fill(plc_buffer_.begin(), plc_buffer_.end(), 0.0F);
    std::fill(pink_noise_state_.begin(), pink_noise_state_.end(), 0.0F);
    std::fill(last_good_samples_.begin(), last_good_samples_.end(), 0.0F);
    std::fill(delay_buffer_.begin(), delay_buffer_.end(), 0.0F);
    std::fill(error_last_good_samples_.begin(), error_last_good_samples_.end(), 0.0F);
  }

  void clearErrorState() noexcept {
    error_active_ = false;
    error_samples_remaining_ = 0u;
    error_mode_ = Mode::BitHold;
    error_total_duration_ = 0u;
  }

  void resetForChannels(std::uint32_t channel_count) noexcept {
    clearChannelStorage();
    delay_buffer_valid_ = false;
    last_channel_count_ = channel_count;
    configured_ = true;
    next_event_time_ = -1.0;
    clearErrorState();
  }

  std::uint32_t calculateUnitSamples(Mode mode, double reference_fs) const noexcept {
    double unit = static_cast<double>(fixedUnitSize(mode));
    if (mode == Mode::MicroFrameDrop) {
      unit = jsRound(sample_rate_ * 0.000125);
    } else if (isUdpMode(mode)) {
      const double scale = sample_rate_ / (reference_fs * 1000.0);
      unit = jsRound(unit * scale);
    } else if (mode == Mode::RfSquelch) {
      unit = jsRound(48.0 * sample_rate_ / 48000.0);
    } else if (isCdMode(mode)) {
      unit = jsRound(sample_rate_ / 7350.0);
    }
    if (!std::isfinite(unit) || unit < 1.0) {
      return 1u;
    }
    if (unit > static_cast<double>(kMaximumPlcSamples)) {
      return kMaximumPlcSamples;
    }
    return static_cast<std::uint32_t>(unit);
  }

  double calculateBitsPerUnit(Mode mode, std::uint32_t unit_samples,
                              std::uint32_t channel_count) const noexcept {
    if (mode == Mode::MicroFrameDrop) {
      return static_cast<double>(unit_samples) * 32.0 * channel_count;
    }
    if (isUdpMode(mode)) {
      return static_cast<double>(fixedUnitSize(mode)) * 24.0 * channel_count + 432.0;
    }
    if (mode == Mode::BluetoothA2dp) {
      return static_cast<double>(unit_samples) * 16.0 * channel_count + 128.0;
    }
    if (mode == Mode::BluetoothLe) {
      return static_cast<double>(unit_samples) * 16.0 * channel_count + 112.0;
    }
    if (isCdMode(mode)) {
      return 588.0;
    }
    return static_cast<double>(fixedBitsPerUnit(mode));
  }

  double calculateEventProbability(Mode mode, double bit_error_exponent,
                                   double bits_per_unit) const noexcept {
    double probability = 0.0;
    if (isCdMode(mode)) {
      probability = 1.0;
    } else {
      const double ber = std::pow(10.0, bit_error_exponent);
      if (ber > 0.0 && bits_per_unit > 0.0) {
        double effective_ber = ber;
        if (mode == Mode::BluetoothA2dp) {
          effective_ber *= 0.1;
        } else if (mode == Mode::BluetoothLe) {
          effective_ber *= 0.05;
        }
        double no_error_probability = 1.0 - effective_ber;
        if (no_error_probability < 0.0) {
          no_error_probability = 0.0;
        }
        probability = 1.0 - std::pow(no_error_probability, bits_per_unit);
      }
    }
    if (probability < 0.0) {
      return 0.0;
    }
    return probability > 0.999999999999 ? 0.999999999999 : probability;
  }

  void scheduleNextEvent(double probability, std::uint32_t unit_samples) noexcept {
    if (!(next_event_time_ < static_cast<double>(sample_count_)) || error_active_) {
      return;
    }
    if (probability > 1.0e-12) {
      double random_value = random_.nextFloat01();
      if (random_value < 1.0e-15) {
        random_value = 1.0e-15;
      } else if (random_value > 1.0 - 1.0e-15) {
        random_value = 1.0 - 1.0e-15;
      }
      const double units = std::floor(std::log1p(-random_value) / std::log1p(-probability));
      const double offset = (units > 0.0 ? units : 0.0) * unit_samples;
      next_event_time_ = static_cast<double>(sample_count_) + offset;
    } else {
      next_event_time_ = std::numeric_limits<double>::infinity();
    }
  }

  void prepareDelayedData(const float *audio, std::uint32_t channel_count,
                          std::uint32_t frame_count) noexcept {
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      if (delay_buffer_valid_) {
        delayed_data_[offset] = delay_buffer_[channel];
        for (std::uint32_t frame = 1u; frame < frame_count; ++frame) {
          delayed_data_[offset + frame] = audio[offset + frame - 1u];
        }
      } else {
        std::copy_n(audio + offset, frame_count, delayed_data_.data() + offset);
      }
      delay_buffer_[channel] = audio[offset + frame_count - 1u];
    }
    delay_buffer_valid_ = true;
  }

  void processOngoingError(const float *audio, std::uint32_t channel_count,
                           std::uint32_t frame_count, std::uint32_t start, std::uint32_t count,
                           std::uint32_t unit_samples,
                           std::uint64_t current_global_sample) noexcept {
    if (error_mode_ == Mode::ShortMute || error_mode_ == Mode::RowMute ||
        error_mode_ == Mode::WisaMute || error_mode_ == Mode::RfSquelch) {
      for (std::uint32_t index = 0u; index < count; ++index) {
        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          wet_data_[channel * frame_count + start + index] = 0.0F;
        }
      }
      return;
    }

    if (error_mode_ == Mode::BluetoothA2dp || error_mode_ == Mode::BluetoothLe) {
      const std::uint32_t total_duration =
          error_total_duration_ != 0u ? error_total_duration_ : unit_samples;
      const std::uint32_t processed = total_duration - error_samples_remaining_;
      const bool ends_in_block = start + count < frame_count;
      for (std::uint32_t index = 0u; index < count; ++index) {
        const std::uint32_t progress = processed + index;
        const double warble_phase = kTwoPi * kBluetoothWarbleHz *
                                    static_cast<double>(current_global_sample + index) /
                                    sample_rate_;
        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          const std::uint32_t offset = channel * frame_count;
          const float last_good = error_last_good_samples_[channel];
          double concealed;
          if (error_mode_ == Mode::BluetoothA2dp) {
            concealed = static_cast<double>(last_good) * std::pow(kBluetoothDecay, progress) +
                        std::sin(warble_phase) * kBluetoothWarbleAmplitude;
          } else {
            const float next_good = ends_in_block ? audio[offset + start + count] : last_good;
            const double alpha =
                static_cast<double>(progress + 1u) / static_cast<double>(total_duration + 1u);
            concealed = static_cast<double>(last_good) * (1.0 - alpha) +
                        static_cast<double>(next_good) * alpha;
            concealed *= std::exp(-static_cast<double>(progress) * 0.1);
            updatePinkNoise(channel);
            concealed +=
                static_cast<double>(pink_noise_state_[channel]) * kLc3ArtifactAmplitude * 0.5;
            concealed = concealed * kLc3BlendFactor +
                        static_cast<double>(last_good) * (1.0 - kLc3BlendFactor);
          }
          wet_data_[offset + start + index] = static_cast<float>(clampSample(concealed));
        }
      }
      return;
    }

    if (error_mode_ == Mode::CdHold || error_mode_ == Mode::CdInterpolated) {
      const std::uint32_t total_duration =
          error_total_duration_ != 0u ? error_total_duration_ : unit_samples;
      const std::uint32_t processed = total_duration - error_samples_remaining_;
      for (std::uint32_t index = 0u; index < count; ++index) {
        const std::uint32_t progress = processed + index;
        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          const std::uint32_t offset = channel * frame_count;
          const float last_good = last_good_samples_[channel];
          const float next_good =
              error_mode_ == Mode::CdInterpolated ? delay_buffer_[channel] : last_good;
          const double concealed =
              error_mode_ == Mode::CdInterpolated
                  ? concealCdInterpolated(last_good, next_good, progress, total_duration)
                  : concealCdStandard(last_good, next_good, progress, total_duration);
          wet_data_[offset + start + index] = static_cast<float>(concealed);
        }
      }
    }
  }

  std::uint32_t determineErrorDuration(Mode mode, std::uint32_t unit_samples,
                                       double bit_error_exponent) noexcept {
    if (mode == Mode::RfSquelch) {
      const double squelch_ms = 1.0 + random_.nextFloat01() * 49.0;
      const double duration = jsRound(squelch_ms * sample_rate_ * 0.001);
      return duration > 0.0 ? static_cast<std::uint32_t>(duration) : 0u;
    }
    if (!isCdMode(mode)) {
      return unit_samples;
    }

    const double ber = std::pow(10.0, bit_error_exponent);
    const double expected_channel_errors = 588.0 * ber;
    std::uint32_t channel_bit_errors = 0u;
    if (expected_channel_errors < 0.1) {
      channel_bit_errors = random_.nextFloat01() < expected_channel_errors ? 1u : 0u;
    } else if (expected_channel_errors < 10.0) {
      double product = random_.nextFloat01();
      const double threshold = std::exp(-expected_channel_errors);
      while (product > threshold) {
        ++channel_bit_errors;
        product *= random_.nextFloat01();
      }
    } else {
      const double variance = 588.0 * ber * (1.0 - ber);
      const double normal = standardNormal();
      const double sampled = jsRound(expected_channel_errors + std::sqrt(variance) * normal);
      channel_bit_errors = sampled > 0.0 ? static_cast<std::uint32_t>(sampled) : 0u;
    }

    std::uint32_t efm_demod_errors = 0u;
    if (channel_bit_errors > 0u) {
      if (channel_bit_errors <= 10u) {
        for (std::uint32_t index = 0u; index < channel_bit_errors; ++index) {
          if (random_.nextFloat01() < 0.3) {
            ++efm_demod_errors;
          }
        }
      } else {
        const double expected = static_cast<double>(channel_bit_errors) * 0.3;
        const double variance = static_cast<double>(channel_bit_errors) * 0.3 * 0.7;
        const double sampled = jsRound(expected + std::sqrt(variance) * standardNormal());
        efm_demod_errors = sampled > 0.0 ? static_cast<std::uint32_t>(sampled) : 0u;
      }
    }

    const double data_error_probability = ber * 0.1;
    const double expected_data_errors = 192.0 * data_error_probability;
    std::uint32_t data_bit_errors = 0u;
    if (expected_data_errors < 0.1) {
      data_bit_errors = random_.nextFloat01() < expected_data_errors ? 1u : 0u;
    } else if (expected_data_errors < 10.0) {
      double product = random_.nextFloat01();
      const double threshold = std::exp(-expected_data_errors);
      while (product > threshold) {
        ++data_bit_errors;
        product *= random_.nextFloat01();
      }
    } else {
      const double variance = 192.0 * data_error_probability * (1.0 - data_error_probability);
      const double sampled = jsRound(expected_data_errors + std::sqrt(variance) * standardNormal());
      data_bit_errors = sampled > 0.0 ? static_cast<std::uint32_t>(sampled) : 0u;
    }

    symbol_error_flags_.fill(std::uint8_t{0});
    std::uint32_t total_symbol_errors = 0u;
    markSymbolErrors(efm_demod_errors, total_symbol_errors);
    markSymbolErrors(data_bit_errors, total_symbol_errors);

    std::uint32_t c1_failed = 0u;
    if (total_symbol_errors == 1u) {
      c1_failed = random_.nextFloat01() < 0.02 ? 1u : 0u;
    } else if (total_symbol_errors == 2u) {
      c1_failed = random_.nextFloat01() < 0.15 ? total_symbol_errors : 0u;
    } else if (total_symbol_errors <= 4u && total_symbol_errors != 0u) {
      c1_failed = static_cast<std::uint32_t>(
          std::floor(total_symbol_errors * (0.7 + random_.nextFloat01() * 0.3)));
    } else if (total_symbol_errors > 4u) {
      c1_failed = static_cast<std::uint32_t>(
          std::floor(total_symbol_errors * (1.1 + random_.nextFloat01() * 0.2)));
      if (c1_failed > kCdSymbolCount) {
        c1_failed = kCdSymbolCount;
      }
    }

    std::uint32_t c2_failed = 0u;
    if (c1_failed <= 2u && c1_failed != 0u) {
      c2_failed = random_.nextFloat01() < 0.05 ? 1u : 0u;
    } else if (c1_failed <= 4u && c1_failed != 0u) {
      c2_failed =
          static_cast<std::uint32_t>(std::floor(c1_failed * (0.3 + random_.nextFloat01() * 0.4)));
    } else if (c1_failed > 4u) {
      c2_failed =
          static_cast<std::uint32_t>(std::floor(c1_failed * (0.8 + random_.nextFloat01() * 0.2)));
    }

    if (c2_failed == 0u) {
      return 0u;
    }

    std::uint32_t duration;
    if (c2_failed == 1u) {
      duration = 1u + static_cast<std::uint32_t>(std::floor(random_.nextFloat01() * 2.0));
    } else if (c2_failed <= 3u) {
      duration = 2u + static_cast<std::uint32_t>(std::floor(random_.nextFloat01() * 8.0));
    } else if (c2_failed <= 6u) {
      duration = 8u + static_cast<std::uint32_t>(std::floor(random_.nextFloat01() * 24.0));
    } else if (c2_failed <= 12u) {
      duration = 32u + static_cast<std::uint32_t>(std::floor(random_.nextFloat01() * 96.0));
    } else {
      duration = 128u + static_cast<std::uint32_t>(std::floor(random_.nextFloat01() * 256.0));
    }

    double scaled = jsRound(static_cast<double>(duration) * sample_rate_ / 44100.0);
    if (scaled < 1.0) {
      scaled = 1.0;
    }
    const double variation = 0.8 + random_.nextFloat01() * 0.4;
    scaled = jsRound(scaled * variation);
    return scaled < 1.0 ? 1u : static_cast<std::uint32_t>(scaled);
  }

  double standardNormal() noexcept {
    const double first = random_.nextFloat01();
    const double second = random_.nextFloat01();
    return std::sqrt(-2.0 * std::log(first)) * std::cos(kTwoPi * second);
  }

  void markSymbolErrors(std::uint32_t count, std::uint32_t &total) noexcept {
    for (std::uint32_t index = 0u; index < count; ++index) {
      const std::uint32_t position =
          static_cast<std::uint32_t>(std::floor(random_.nextFloat01() * kCdSymbolCount));
      if (symbol_error_flags_[position] == 0u) {
        symbol_error_flags_[position] = 1u;
        ++total;
      }
    }
  }

  void captureErrorHistory(const float *audio, std::uint32_t channel_count,
                           std::uint32_t frame_count, std::uint32_t start,
                           std::uint32_t unit_samples) noexcept {
    const std::uint32_t history = start < unit_samples ? start : unit_samples;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      error_last_good_samples_[channel] =
          start > 0u ? wet_data_[offset + start - 1u] : last_good_samples_[channel];
      if (history == 0u) {
        continue;
      }
      const std::uint32_t source_start = start - history;
      const std::uint32_t destination_start = unit_samples - history;
      float *plc = plc_buffer_.data() + static_cast<std::size_t>(channel) * kMaximumPlcSamples;
      for (std::uint32_t index = 0u; index < history; ++index) {
        plc[destination_start + index] = audio[offset + source_start + index];
      }
    }
  }

  void applyNewError(const float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                     std::uint32_t start, std::uint32_t count, std::uint32_t total_duration,
                     std::uint32_t unit_samples, Mode mode,
                     std::uint64_t current_global_sample) noexcept {
    if (mode == Mode::BitHold) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::uint32_t offset = channel * frame_count;
        for (std::uint32_t index = 0u; index < count; ++index) {
          wet_data_[offset + start + index] = error_last_good_samples_[channel];
        }
      }
      return;
    }

    for (std::uint32_t index = 0u; index < count; ++index) {
      shared_error_probability_[index] = random_.nextFloat01();
      shared_bit_position_[index] =
          static_cast<std::uint8_t>(std::floor(random_.nextFloat01() * 24.0));
      shared_warble_phase_[index] = kTwoPi * kBluetoothWarbleHz *
                                    static_cast<double>(current_global_sample + index) /
                                    sample_rate_;
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      float *plc = plc_buffer_.data() + static_cast<std::size_t>(channel) * kMaximumPlcSamples;
      const float last_good = error_last_good_samples_[channel];
      const bool ends_in_block = start + total_duration < frame_count;
      float next_good;
      if (mode == Mode::CdInterpolated) {
        next_good =
            ends_in_block ? delayed_data_[offset + start + total_duration] : delay_buffer_[channel];
      } else {
        next_good = ends_in_block ? audio[offset + start + total_duration] : last_good;
      }

      for (std::uint32_t index = 0u; index < count; ++index) {
        const std::uint32_t audio_index = offset + start + index;
        double value = static_cast<double>(wet_data_[audio_index]);
        switch (mode) {
        case Mode::ShortHold:
          value = plc[(unit_samples - total_duration + index) % unit_samples];
          break;
        case Mode::ShortMute:
        case Mode::RowMute:
        case Mode::WisaMute:
        case Mode::RfSquelch:
          value = 0.0;
          break;
        case Mode::RowCorruption:
          value = corruptRowSample(value, index, unit_samples);
          break;
        case Mode::MicroFrameDrop: {
          const double alpha =
              static_cast<double>(index + 1u) / static_cast<double>(total_duration + 1u);
          value = static_cast<double>(last_good) * (1.0 - alpha) +
                  static_cast<double>(next_good) * alpha;
          break;
        }
        case Mode::Udp64:
        case Mode::Udp128:
        case Mode::Udp256: {
          double lambda = static_cast<double>(index) / unit_samples * 2.0;
          if (lambda > 1.0) {
            lambda = 1.0;
          }
          value = plc[(unit_samples - total_duration + index) % unit_samples] * (1.0 - lambda);
          break;
        }
        case Mode::BluetoothA2dp:
          value = static_cast<double>(last_good) * std::pow(kBluetoothDecay, index) +
                  std::sin(shared_warble_phase_[index]) * kBluetoothWarbleAmplitude;
          break;
        case Mode::BluetoothLe: {
          const double alpha =
              static_cast<double>(index + 1u) / static_cast<double>(total_duration + 1u);
          value = (static_cast<double>(last_good) * (1.0 - alpha) +
                   static_cast<double>(next_good) * alpha) *
                  std::exp(-static_cast<double>(index) * 0.1);
          updatePinkNoise(channel);
          value += static_cast<double>(pink_noise_state_[channel]) * kLc3ArtifactAmplitude * 0.5;
          value =
              value * kLc3BlendFactor + static_cast<double>(last_good) * (1.0 - kLc3BlendFactor);
          break;
        }
        case Mode::CdHold:
          value = concealCdStandard(last_good, next_good, index, total_duration);
          break;
        case Mode::CdInterpolated:
          value = concealCdInterpolated(last_good, next_good, index, total_duration);
          break;
        case Mode::BitHold:
          break;
        }
        wet_data_[audio_index] = static_cast<float>(clampSample(value));
      }
    }
  }

  double corruptRowSample(double input, std::uint32_t index,
                          std::uint32_t unit_samples) const noexcept {
    double rounded = jsRound(input * 8388607.0);
    if (rounded > 8388607.0) {
      rounded = 8388607.0;
    } else if (rounded < -8388608.0) {
      rounded = -8388608.0;
    }
    std::int32_t sample = static_cast<std::int32_t>(rounded);
    if (shared_error_probability_[index] < 2.0 / unit_samples) {
      std::uint32_t word = std::bit_cast<std::uint32_t>(sample);
      word ^= 1u << shared_bit_position_[index];
      sample = std::bit_cast<std::int32_t>(word);
    }
    return clampSample(static_cast<double>(sample) / 8388607.0);
  }

  void updatePinkNoise(std::uint32_t channel) noexcept {
    const double white = random_.nextFloat01() - 0.5;
    pink_noise_state_[channel] = static_cast<float>(
        0.99765 * static_cast<double>(pink_noise_state_[channel]) + white * 0.0990460);
  }

  double concealCdStandard(float last_good, float next_good, std::uint32_t progress,
                           std::uint32_t total_duration) noexcept {
    if (total_duration <= 2u) {
      const double alpha =
          static_cast<double>(progress + 1u) / static_cast<double>(total_duration + 1u);
      return static_cast<double>(last_good) * (1.0 - alpha) +
             static_cast<double>(next_good) * alpha;
    }
    if (total_duration <= 10u) {
      return static_cast<double>(last_good) * std::pow(0.996, progress);
    }
    if (total_duration <= 32u) {
      if (static_cast<double>(progress) < total_duration * 0.3) {
        return static_cast<double>(last_good) * std::pow(0.992, progress);
      }
      if (static_cast<double>(progress) > total_duration * 0.7) {
        const std::uint32_t interpolation_start =
            static_cast<std::uint32_t>(std::floor(total_duration * 0.7));
        const double interpolation = static_cast<double>(progress - interpolation_start) /
                                     static_cast<double>(total_duration - interpolation_start);
        const double held = static_cast<double>(last_good) * std::pow(0.992, interpolation_start);
        return held * (1.0 - interpolation) + static_cast<double>(next_good) * interpolation;
      }
      const double jitter = (random_.nextFloat01() - 0.5) * 0.02;
      return static_cast<double>(last_good) * std::pow(0.992, progress) * (1.0 + jitter);
    }
    if (total_duration <= 128u) {
      if (progress < 8u) {
        return static_cast<double>(last_good) * std::pow(0.85, progress);
      }
      return (random_.nextFloat01() - 0.5) * 0.001 * std::pow(0.95, progress - 8u);
    }
    if (progress < 16u) {
      return static_cast<double>(last_good) * std::pow(0.7, progress);
    }
    return 0.0;
  }

  static double concealCdInterpolated(float last_good, float next_good, std::uint32_t progress,
                                      std::uint32_t total_duration) noexcept {
    if (total_duration <= 10u) {
      const double alpha =
          static_cast<double>(progress + 1u) / static_cast<double>(total_duration + 1u);
      return static_cast<double>(last_good) * (1.0 - alpha) +
             static_cast<double>(next_good) * alpha;
    }
    const double midpoint = (static_cast<double>(last_good) + static_cast<double>(next_good)) * 0.5;
    if (total_duration <= 32u) {
      const double half = static_cast<double>(total_duration) * 0.5;
      if (static_cast<double>(progress) < half) {
        const double alpha = static_cast<double>(progress) / half;
        return static_cast<double>(last_good) * (1.0 - alpha) + midpoint * alpha;
      }
      const double alpha = (static_cast<double>(progress) - half) / half;
      return midpoint * (1.0 - alpha) + static_cast<double>(next_good) * alpha;
    }
    if (total_duration <= 128u) {
      if (progress < 16u) {
        const double alpha = static_cast<double>(progress) / 16.0;
        return static_cast<double>(last_good) * (1.0 - alpha) + midpoint * alpha;
      }
      if (progress > total_duration - 16u) {
        const double alpha = static_cast<double>(progress - (total_duration - 16u)) / 16.0;
        return midpoint * (1.0 - alpha) + static_cast<double>(next_good) * alpha;
      }
      const double fade_progress =
          static_cast<double>(progress - 16u) / static_cast<double>(total_duration - 32u);
      return midpoint * std::pow(0.995, fade_progress * 20.0);
    }
    if (progress < 16u) {
      return static_cast<double>(last_good) * std::pow(0.7, progress);
    }
    return 0.0;
  }

  double sample_rate_ = 0.0;
  double next_event_time_ = -1.0;
  double last_bit_error_exponent_ = 0.0;
  double last_reference_fs_ = 0.0;
  double last_sample_rate_ = 0.0;
  std::uint64_t sample_count_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t error_samples_remaining_ = 0u;
  std::uint32_t error_total_duration_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  Mode last_mode_ = Mode::BitHold;
  Mode error_mode_ = Mode::BitHold;
  bool configured_ = false;
  bool last_params_valid_ = false;
  bool delay_buffer_valid_ = false;
  bool error_active_ = false;
  std::vector<float> plc_buffer_;
  std::vector<float> pink_noise_state_;
  std::vector<float> last_good_samples_;
  std::vector<float> delay_buffer_;
  std::vector<float> error_last_good_samples_;
  std::vector<float> wet_data_;
  std::vector<float> delayed_data_;
  std::vector<double> shared_error_probability_;
  std::vector<std::uint8_t> shared_bit_position_;
  std::vector<double> shared_warble_phase_;
  std::array<std::uint8_t, kCdSymbolCount> symbol_error_flags_{};
  dsp::XorShiftRng random_{};
};

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(DigitalErrorEmulatorPlugin,
                         effetune::plugins::lofi::DigitalErrorEmulatorKernel)

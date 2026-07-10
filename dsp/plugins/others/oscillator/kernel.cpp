#include "effetune/kernel.h"
#include "OscillatorPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::others {
namespace {

constexpr double kPi = 3.141592653589793;
constexpr double kTwoPi = 6.283185307179586;
constexpr double kInversePi = 0.3183098861837907;
constexpr double kInverseTwoPi = 0.15915494309189535;
constexpr double kNyquistGuard = 1.0;
constexpr std::uint32_t kMinimumTableSize = 2048u;
constexpr std::uint32_t kMaximumTableSize = 16384u;
constexpr std::uint32_t kTableStride = kMaximumTableSize + 1u;
constexpr std::uint32_t kMaximumCacheEntries = 64u;

struct TableEntry final {
  std::uint32_t waveform = 0u;
  std::uint32_t harmonic_limit = 0u;
  std::uint32_t table_size = 0u;
  bool active = false;
};

} // namespace

class OscillatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::OscillatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    samples_.resize(max_frames_);
    table_storage_.resize(static_cast<std::size_t>(kMaximumCacheEntries) * kTableStride);
  }

  void reset() noexcept override {
    phase_ = 0.0;
    pulse_time_ = 0.0;
    for (float &value : pink_state_) {
      value = 0.0F;
    }
    for (TableEntry &entry : table_entries_) {
      entry = {};
    }
    cache_count_ = 0u;
    oldest_cache_entry_ = 0u;
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
        frame_count > max_frames_) {
      return;
    }

    const double safe_sample_rate = sample_rate_ > 0.0 ? sample_rate_ : 44100.0;
    const double frequency = static_cast<double>(params_.frequency);
    const double volume_db = static_cast<double>(params_.volume);
    const double volume = volume_db <= -96.0 ? 0.0 : std::pow(10.0, volume_db / 20.0);
    double panning = static_cast<double>(params_.panning);
    if (panning < -1.0) {
      panning = -1.0;
    } else if (panning > 1.0) {
      panning = 1.0;
    }
    const double pan_angle = (panning + 1.0) * kPi * 0.25;
    const double pan_gain_left = std::cos(pan_angle);
    const double pan_gain_right = std::sin(pan_angle);
    std::uint32_t waveform = static_cast<std::uint32_t>(params_.waveform);
    if (waveform > 5u) {
      waveform = 0u;
    }
    const bool pulsed = static_cast<std::uint32_t>(params_.mode) == 1u;
    const double interval_samples =
        static_cast<double>(params_.interval) * 0.001 * safe_sample_rate;
    double pulse_width_samples = static_cast<double>(params_.width) * 0.001 * safe_sample_rate;
    const double maximum_width = interval_samples * 0.5;
    if (pulse_width_samples > maximum_width) {
      pulse_width_samples = maximum_width;
    }
    const double pulse_duration = pulse_width_samples * 2.0;

    if (waveform == 4u) {
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        samples_[frame] = static_cast<float>(random_.nextFloatSigned());
      }
    } else if (waveform == 5u) {
      generatePink(frame_count);
    } else {
      generateOscillator(waveform, frequency, safe_sample_rate, frame_count);
    }

    if (pulsed) {
      double pulse_time = pulse_time_;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double pulse_position = std::fmod(pulse_time, interval_samples);
        double pulse_gain = 0.0;
        if (pulse_position < pulse_duration) {
          const double normalized = pulse_position / pulse_duration;
          pulse_gain = 0.5 * (1.0 - std::cos(kTwoPi * normalized));
        }
        samples_[frame] = static_cast<float>(static_cast<double>(samples_[frame]) * pulse_gain);
        pulse_time += 1.0;
      }
      pulse_time_ = pulse_time;
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      double pan_gain = 1.0;
      if (channel_count >= 2u) {
        pan_gain = channel == 0u ? pan_gain_left : pan_gain_right;
        if (channel > 1u) {
          pan_gain = 0.0;
        }
      }
      const double gain = volume * pan_gain;
      if (gain != 0.0) {
        const std::uint32_t offset = channel * frame_count;
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          audio[offset + frame] = static_cast<float>(static_cast<double>(audio[offset + frame]) +
                                                     static_cast<double>(samples_[frame]) * gain);
        }
      }
    }
  }

private:
  void generatePink(std::uint32_t frame_count) noexcept {
    double b0 = static_cast<double>(pink_state_[0]);
    double b1 = static_cast<double>(pink_state_[1]);
    double b2 = static_cast<double>(pink_state_[2]);
    double b3 = static_cast<double>(pink_state_[3]);
    double b4 = static_cast<double>(pink_state_[4]);
    double b5 = static_cast<double>(pink_state_[5]);
    double b6 = static_cast<double>(pink_state_[6]);
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double white = random_.nextFloatSigned();
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      samples_[frame] =
          static_cast<float>((b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11);
      b6 = white * 0.115926;
    }
    pink_state_[0] = static_cast<float>(b0);
    pink_state_[1] = static_cast<float>(b1);
    pink_state_[2] = static_cast<float>(b2);
    pink_state_[3] = static_cast<float>(b3);
    pink_state_[4] = static_cast<float>(b4);
    pink_state_[5] = static_cast<float>(b5);
    pink_state_[6] = static_cast<float>(b6);
  }

  void generateOscillator(std::uint32_t waveform, double frequency, double sample_rate,
                          std::uint32_t frame_count) noexcept {
    const double phase_increment = kTwoPi * frequency / sample_rate;
    const double nyquist_candidate = sample_rate * 0.5 - kNyquistGuard;
    const double usable_nyquist = nyquist_candidate > 0.0 ? nyquist_candidate : 0.0;
    const bool band_limited = waveform == 1u || waveform == 2u || waveform == 3u;
    const std::uint32_t harmonic_limit =
        frequency > 0.0 && frequency <= usable_nyquist
            ? static_cast<std::uint32_t>(std::floor(usable_nyquist / frequency))
            : 0u;

    if (waveform != 0u && !band_limited) {
      clearSamples(frame_count);
      return;
    }
    if (harmonic_limit < 1u) {
      clearSamples(frame_count);
      return;
    }

    double phase = phase_;
    if (waveform == 0u) {
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        samples_[frame] = static_cast<float>(std::sin(phase));
        phase += phase_increment;
        if (phase >= kTwoPi) {
          phase -= kTwoPi;
        } else if (phase < 0.0) {
          phase += kTwoPi;
        }
      }
      phase_ = phase;
      return;
    }

    std::uint32_t synthesis_limit = harmonic_limit;
    const std::uint32_t maximum_harmonic = (kMaximumTableSize >> 1u) - 1u;
    if (synthesis_limit > maximum_harmonic) {
      synthesis_limit = maximum_harmonic;
    }
    std::uint32_t table_size = kMinimumTableSize;
    const std::uint32_t required_size = (synthesis_limit + 1u) << 1u;
    while (table_size < required_size && table_size < kMaximumTableSize) {
      table_size <<= 1u;
    }
    const float *table = findOrBuildTable(waveform, synthesis_limit, table_size);
    const double table_scale = static_cast<double>(table_size) * kInverseTwoPi;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double table_position = phase * table_scale;
      const std::uint32_t table_index = static_cast<std::uint32_t>(table_position);
      const double fraction = table_position - static_cast<double>(table_index);
      const double first = static_cast<double>(table[table_index]);
      const double second = static_cast<double>(table[table_index + 1u]);
      samples_[frame] = static_cast<float>(first + (second - first) * fraction);
      phase += phase_increment;
      if (phase >= kTwoPi) {
        phase -= kTwoPi;
      } else if (phase < 0.0) {
        phase += kTwoPi;
      }
    }
    phase_ = phase;
  }

  void clearSamples(std::uint32_t frame_count) noexcept {
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      samples_[frame] = 0.0F;
    }
  }

  const float *findOrBuildTable(std::uint32_t waveform, std::uint32_t harmonic_limit,
                                std::uint32_t table_size) noexcept {
    for (std::uint32_t index = 0u; index < kMaximumCacheEntries; ++index) {
      const TableEntry &entry = table_entries_[index];
      if (entry.active && entry.waveform == waveform && entry.harmonic_limit == harmonic_limit &&
          entry.table_size == table_size) {
        return table_storage_.data() + static_cast<std::size_t>(index) * kTableStride;
      }
    }

    std::uint32_t entry_index;
    if (cache_count_ < kMaximumCacheEntries) {
      entry_index = cache_count_;
      ++cache_count_;
    } else {
      entry_index = oldest_cache_entry_;
      ++oldest_cache_entry_;
      if (oldest_cache_entry_ == kMaximumCacheEntries) {
        oldest_cache_entry_ = 0u;
      }
    }
    TableEntry &entry = table_entries_[entry_index];
    entry.waveform = waveform;
    entry.harmonic_limit = harmonic_limit;
    entry.table_size = table_size;
    entry.active = true;
    float *table = table_storage_.data() + static_cast<std::size_t>(entry_index) * kTableStride;
    buildTable(table, waveform, harmonic_limit, table_size);
    return table;
  }

  static void buildTable(float *table, std::uint32_t waveform, std::uint32_t harmonic_limit,
                         std::uint32_t table_size) noexcept {
    for (std::uint32_t index = 0u; index <= table_size; ++index) {
      table[index] = 0.0F;
    }
    for (std::uint32_t harmonic = 1u; harmonic <= harmonic_limit; ++harmonic) {
      if ((waveform == 1u || waveform == 2u) && (harmonic & 1u) == 0u) {
        continue;
      }

      double coefficient;
      if (waveform == 3u) {
        coefficient = (2.0 * kInversePi) * (((harmonic & 1u) == 0u) ? -1.0 : 1.0) /
                      static_cast<double>(harmonic);
      } else if (waveform == 1u) {
        coefficient = 4.0 * kInversePi / static_cast<double>(harmonic);
      } else {
        const std::uint32_t odd_index = (harmonic - 1u) >> 1u;
        coefficient = (((odd_index & 1u) == 0u) ? 1.0 : -1.0) * 8.0 * kInversePi * kInversePi /
                      (static_cast<double>(harmonic) * harmonic);
      }

      const double harmonic_step =
          kTwoPi * static_cast<double>(harmonic) / static_cast<double>(table_size);
      const double sine_step = std::sin(harmonic_step);
      const double cosine_step = std::cos(harmonic_step);
      double sine = 0.0;
      double cosine = 1.0;
      for (std::uint32_t index = 0u; index < table_size; ++index) {
        table[index] = static_cast<float>(static_cast<double>(table[index]) + coefficient * sine);
        const double next_sine = sine * cosine_step + cosine * sine_step;
        cosine = cosine * cosine_step - sine * sine_step;
        sine = next_sine;
      }
    }

    double maximum = 0.0;
    for (std::uint32_t index = 0u; index < table_size; ++index) {
      const double value = static_cast<double>(table[index]);
      const double magnitude = value >= 0.0 ? value : -value;
      if (magnitude > maximum) {
        maximum = magnitude;
      }
    }
    if (maximum > 0.0) {
      const double gain = 1.0 / maximum;
      for (std::uint32_t index = 0u; index < table_size; ++index) {
        table[index] = static_cast<float>(static_cast<double>(table[index]) * gain);
      }
    }
    table[table_size] = table[0];
  }

  double sample_rate_ = 0.0;
  double phase_ = 0.0;
  double pulse_time_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t cache_count_ = 0u;
  std::uint32_t oldest_cache_entry_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  std::array<float, 7> pink_state_{};
  std::array<TableEntry, kMaximumCacheEntries> table_entries_{};
  std::vector<float> samples_;
  std::vector<float> table_storage_;
  dsp::XorShiftRng random_{};
};

} // namespace effetune::plugins::others

EFFETUNE_REGISTER_KERNEL(OscillatorPlugin, effetune::plugins::others::OscillatorKernel)

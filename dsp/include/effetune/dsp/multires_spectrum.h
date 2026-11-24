#ifndef EFFETUNE_DSP_MULTIRES_SPECTRUM_H
#define EFFETUNE_DSP_MULTIRES_SPECTRUM_H

#include "effetune/dsp/pffft_incremental.h"
#include "effetune/dsp/stage_scheduler.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <new>
#include <vector>

namespace effetune::dsp {

// Version 2 uses a 48-byte header followed by ascending spectrum dB pairs or
// descending spectrogram intensities. Capture time is an exclusive sample end
// relative to the current generation, not a rounded wall-clock timestamp.
struct MultiresSpectrumFrame {
  std::uint64_t captureEndSample = 0u;
  std::uint32_t generation = 0u;
  std::uint32_t frameIndex = 0u;
  std::uint32_t hopSamples = 0u;
  std::uint32_t points = 12u;
  std::uint32_t cellCount = 0u;
  std::uint32_t firstValidIndex = 0u;
  std::uint32_t validCellCount = 0u;
};

class MultiresSpectrum final {
public:
  static constexpr std::uint32_t kSpectrumCells = 2048u;
  static constexpr std::uint32_t kSpectrogramCells = 256u;
  static constexpr std::uint32_t kHeaderBytes = 48u;
  static constexpr std::uint32_t kFirTaps = 97u;
  static constexpr std::uint32_t kFirDelay = 48u;
  static constexpr double kMinimumFrequency = 20.0;
  static constexpr double kMaximumFrequency = 40000.0;

  ~MultiresSpectrum() { release(); }
  MultiresSpectrum() = default;
  MultiresSpectrum(const MultiresSpectrum &) = delete;
  MultiresSpectrum &operator=(const MultiresSpectrum &) = delete;

  [[nodiscard]] bool prepare(float sample_rate, bool spectrogram) {
    release();
    sample_rate_ = sample_rate;
    spectrogram_ = spectrogram;
    cell_count_ = spectrogram ? kSpectrogramCells : kSpectrumCells;
    const std::uint32_t maximum_hop = hopForSize(kMaximumSize);
    short_size_ = 1u;
    // The short window ends 1.5 sizes before the capture end (see startJob).
    while (short_size_ < kMaximumSize * 5u / 2u + maximum_hop + kFirTaps + 4u) {
      short_size_ <<= 1u;
    }
    long_size_ = 1u;
    while (long_size_ < kMaximumSize + (maximum_hop + 3u) / 4u + 4u) {
      long_size_ <<= 1u;
    }
    short_ring_.resize(short_size_);
    long_ring_.resize(long_size_);
    storage_ = static_cast<float *>(pffft_aligned_malloc(sizeof(float) * kMaximumSize * 8u));
    if (storage_ == nullptr) {
      return false;
    }
    for (std::uint32_t lane = 0u; lane < 2u; ++lane) {
      input_[lane] = storage_ + lane * kMaximumSize * 4u;
      output_[lane] = input_[lane] + kMaximumSize;
      work_[lane] = output_[lane] + kMaximumSize;
      power_[lane] = work_[lane] + kMaximumSize;
    }
    prepareFir();
    for (std::uint32_t index = 0u; index < kPointCount; ++index) {
      auto &config = configs_[index];
      config.reset(new (std::nothrow) Configuration());
      if (config == nullptr || !prepareConfiguration(*config, index + kMinimumPoints)) {
        return false;
      }
    }
    ready_ = true;
    reset(12u);
    generation_ = 0u;
    return true;
  }

  void reset(std::uint32_t points) noexcept {
    active_ = configs_[points - kMinimumPoints].get();
    ++generation_;
    samples_ = 0u;
    decimated_samples_ = 0u;
    latest_decimator_end_ = 0u;
    fir_sum_ = 0.0;
    frame_index_ = 0u;
    job_active_ = false;
    job_slot_ = 0u;
    if (active_ != nullptr) {
      const std::uint32_t first =
          spectrogram_ || active_->hop < active_->size ? active_->hop : active_->size;
      next_job_ = first;
    }
  }

  [[nodiscard]] bool ready() const noexcept { return ready_; }
  [[nodiscard]] std::uint32_t generation() const noexcept { return generation_; }
  [[nodiscard]] const std::array<double, kFirTaps> &firCoefficients() const noexcept {
    return fir_;
  }

  template <class Sink> void push(float sample, Sink &sink) noexcept {
    if (!ready_ || active_ == nullptr) {
      return;
    }
    short_ring_[static_cast<std::uint32_t>(samples_) & (short_size_ - 1u)] = sample;
    // One polyphase branch per input sample. Only every fourth output is
    // evaluated, and the convolution work is spread across all four inputs.
    const std::uint32_t phase = static_cast<std::uint32_t>(samples_) & 3u;
    const std::uint32_t first_tap = 3u - phase;
    for (std::uint32_t tap = first_tap; tap < kFirTaps; tap += 4u) {
      const std::uint32_t delay = tap - first_tap;
      if (samples_ >= delay) {
        fir_sum_ +=
            fir_[tap] *
            static_cast<double>(
                short_ring_[static_cast<std::uint32_t>(samples_ - delay) & (short_size_ - 1u)]);
      }
    }
    ++samples_;
    if (phase == 3u) {
      if (samples_ >= kFirTaps) {
        long_ring_[static_cast<std::uint32_t>(decimated_samples_) & (long_size_ - 1u)] =
            static_cast<float>(fir_sum_);
        ++decimated_samples_;
        latest_decimator_end_ = samples_;
      }
      fir_sum_ = 0.0;
    }
    if (job_active_ && samples_ == next_slot_sample_) {
      const auto &schedule = active_->schedule;
      for (std::uint32_t index = schedule.slotBegin(job_slot_); index < schedule.slotEnd(job_slot_);
           ++index) {
        runStage(schedule.stage(index), sink);
      }
      ++job_slot_;
      if (job_slot_ == active_->slots) {
        job_active_ = false;
        sink.hqCommit();
      } else {
        next_slot_sample_ += kSlotSamples;
      }
    }
    if (samples_ == next_job_) {
      if (decimated_samples_ >= active_->size) {
        startJob(sink);
      }
      next_job_ += active_->hop;
    }
  }

private:
  static constexpr double kPi = 3.14159265358979323846264338327950288;
  static constexpr std::uint32_t kMinimumPoints = 8u;
  static constexpr std::uint32_t kPointCount = 7u;
  static constexpr std::uint32_t kMaximumSize = 16384u;
  static constexpr std::uint32_t kSlotSamples = 16u;
  static constexpr std::uint32_t kMaximumSlots = 4096u;
  enum Stage : std::uint8_t { Pack, Transform, Power, Map };
  struct BandMap {
    double position = 0.0;
    double lower = 0.0;
    double upper = 0.0;
  };
  struct Cell {
    std::array<BandMap, 2u> bands{};
    double longWeight = 0.0;
    bool valid = false;
  };
  struct Configuration {
    ~Configuration() {
      transforms[0].reset();
      transforms[1].reset();
      if (setup != nullptr) {
        pffft_destroy_setup(setup);
      }
    }
    PFFFT_Setup *setup = nullptr;
    std::array<std::unique_ptr<PffftOrderedRealForward>, 2u> transforms;
    std::vector<float> window;
    std::vector<Cell> cells;
    StageSchedule<8192u, kMaximumSlots> schedule;
    double powerNormalization = 0.0;
    std::uint32_t points = 12u;
    std::uint32_t size = 4096u;
    std::uint32_t hop = 2048u;
    std::uint32_t slots = 128u;
    std::uint32_t firstValidIndex = 0u;
    std::uint32_t validCellCount = 0u;
  };

  void release() noexcept {
    for (auto &config : configs_) {
      config.reset();
    }
    if (storage_ != nullptr) {
      pffft_aligned_free(storage_);
      storage_ = nullptr;
    }
    active_ = nullptr;
    ready_ = false;
  }

  [[nodiscard]] std::uint32_t hopForSize(std::uint32_t size) const noexcept {
    const auto rate_hop = static_cast<std::uint32_t>(std::ceil(sample_rate_ / 30.0));
    return !spectrogram_ && rate_hop > size / 2u ? rate_hop : size / 2u;
  }

  static double besselI0(double value) noexcept {
    double sum = 1.0;
    double term = 1.0;
    for (std::uint32_t order = 1u; order < 100u; ++order) {
      term *= value * value / (4.0 * order * order);
      sum += term;
      if (term < sum * 1.0e-17) {
        break;
      }
    }
    return sum;
  }

  void prepareFir() noexcept {
    // A -156 dB alias budget leaves 12 dB below the deepest displayed floor.
    // The 97-tap, beta-18 design measures below -170 dB over [3 Fs/16, Fs/2],
    // including all three bands that can alias into the contributing low band.
    const double denominator = besselI0(18.0);
    double sum = 0.0;
    for (std::uint32_t tap = 0u; tap < kFirTaps; ++tap) {
      const double offset = static_cast<double>(tap) - kFirDelay;
      const double position = offset / kFirDelay;
      const double sinc = offset == 0.0 ? 0.25 : std::sin(kPi * 0.25 * offset) / (kPi * offset);
      fir_[tap] = sinc * besselI0(18.0 * std::sqrt(1.0 - position * position)) / denominator;
      sum += fir_[tap];
    }
    for (double &coefficient : fir_) {
      coefficient /= sum;
    }
  }

  [[nodiscard]] bool prepareConfiguration(Configuration &config, std::uint32_t points) {
    config.points = points;
    config.size = 1u << points;
    config.hop = hopForSize(config.size);
    config.slots = config.hop / kSlotSamples;
    if (config.slots == 0u || config.slots > kMaximumSlots) {
      return false;
    }
    config.setup = pffft_new_setup(static_cast<int>(config.size), PFFFT_REAL);
    if (config.setup == nullptr) {
      return false;
    }
    for (auto &transform : config.transforms) {
      transform.reset(new (std::nothrow) PffftOrderedRealForward(config.setup, 64));
      if (transform == nullptr || !transform->valid()) {
        return false;
      }
    }
    config.window.resize(config.size);
    double sum = 0.0;
    for (std::uint32_t index = 0u; index < config.size; ++index) {
      config.window[index] = static_cast<float>(
          0.5 * (1.0 - std::cos(2.0 * kPi * static_cast<double>(index) / config.size)));
      sum += config.window[index];
    }
    config.powerNormalization = 1.0 / (sum * sum);
    config.cells.resize(cell_count_);
    const double log_step = std::log(kMaximumFrequency / kMinimumFrequency) / (cell_count_ - 1u);
    const double bin_hz = static_cast<double>(sample_rate_) / config.size;
    const double lower = 32.0 * bin_hz < sample_rate_ / 32.0 ? 32.0 * bin_hz : sample_rate_ / 32.0;
    const double upper = 64.0 * bin_hz < sample_rate_ / 16.0 ? 64.0 * bin_hz : sample_rate_ / 16.0;
    config.firstValidIndex = cell_count_;
    for (std::uint32_t index = 0u; index < cell_count_; ++index) {
      const std::uint32_t ascending = spectrogram_ ? cell_count_ - 1u - index : index;
      const double frequency = ascending == cell_count_ - 1u
                                   ? kMaximumFrequency
                                   : kMinimumFrequency * std::exp(ascending * log_step);
      auto &cell = config.cells[index];
      cell.valid = frequency <= sample_rate_ * 0.5;
      if (cell.valid) {
        if (config.firstValidIndex == cell_count_) {
          config.firstValidIndex = index;
        }
        ++config.validCellCount;
      }
      cell.longWeight = frequency <= lower
                            ? 1.0
                            : (frequency >= upper ? 0.0 : (upper - frequency) / (upper - lower));
      const double low = ascending == 0u ? frequency : frequency * std::exp(-0.5 * log_step);
      const double high =
          ascending == cell_count_ - 1u ? frequency : frequency * std::exp(0.5 * log_step);
      for (std::uint32_t lane = 0u; lane < 2u; ++lane) {
        const double scale = (lane == 0u ? 1.0 : 4.0) / bin_hz;
        cell.bands[lane] = {frequency * scale, low * scale, high * scale};
      }
    }
    if (config.validCellCount == 0u) {
      config.firstValidIndex = 0u;
    }
    const auto add_chunks = [&config](Stage stage, std::uint32_t lane, std::uint32_t count,
                                      std::uint32_t chunk, std::uint32_t weight) {
      for (std::uint32_t begin = 0u; begin < count; begin += chunk) {
        const std::uint32_t end = begin + chunk < count ? begin + chunk : count;
        config.schedule.addStage(stage, lane, begin, end, (end - begin) * weight);
      }
    };
    for (std::uint32_t lane = 0u; lane < 2u; ++lane) {
      add_chunks(Pack, lane, config.size, 64u, 8u);
    }
    for (std::uint32_t lane = 0u; lane < 2u; ++lane) {
      const auto steps = static_cast<std::uint32_t>(config.transforms[lane]->stepCount());
      for (std::uint32_t step = 0u; step < steps; ++step) {
        config.schedule.addStage(Transform, lane, step, step + 1u, 512u);
      }
      add_chunks(Power, lane, config.size / 2u + 1u, 32u, 16u);
    }
    add_chunks(Map, 0u, cell_count_, 8u, 64u);
    return config.schedule.partition(config.slots);
  }

  template <class Sink> void startJob(Sink &sink) noexcept {
    // All slots finish before the next nominal hop, including non-multiples of 16.
    if (job_active_) {
      ready_ = false;
      return;
    }
    job_capture_end_ = latest_decimator_end_ - kFirDelay;
    // Both windows share the long window's centre, so every cell describes the same instant.
    job_short_begin_ = job_capture_end_ - active_->size * 5u / 2u;
    job_long_begin_ = decimated_samples_ - active_->size;
    job_slot_ = 0u;
    next_slot_sample_ = samples_ + kSlotSamples;
    for (std::uint32_t lane = 0u; lane < 2u; ++lane) {
      if (!active_->transforms[lane]->begin(input_[lane], output_[lane], work_[lane])) {
        ready_ = false;
        return;
      }
    }
    sink.hqBegin(MultiresSpectrumFrame{job_capture_end_, generation_, frame_index_++, active_->hop,
                                       active_->points, cell_count_, active_->firstValidIndex,
                                       active_->validCellCount});
    job_active_ = true;
  }

  [[nodiscard]] double interpolate(std::uint32_t lane, double position) const noexcept {
    const std::uint32_t last = active_->size / 2u;
    if (position < 0.0 || position > last) {
      return 0.0;
    }
    const auto first = static_cast<std::uint32_t>(position);
    const std::uint32_t second = first < last ? first + 1u : first;
    return power_[lane][first] +
           (static_cast<double>(power_[lane][second]) - power_[lane][first]) * (position - first);
  }

  [[nodiscard]] double mapPower(std::uint32_t lane, const BandMap &band) const noexcept {
    if (band.upper - band.lower < 1.0) {
      return interpolate(lane, band.position);
    }
    double value = interpolate(lane, band.lower);
    const double upper = band.upper < active_->size / 2u ? band.upper : active_->size / 2u;
    const double edge = interpolate(lane, upper);
    value = value > edge ? value : edge;
    const auto begin = static_cast<std::uint32_t>(std::ceil(band.lower));
    const auto end = static_cast<std::uint32_t>(upper);
    for (std::uint32_t bin = begin; bin <= end; ++bin) {
      value = value > power_[lane][bin] ? value : power_[lane][bin];
    }
    return value;
  }

  template <class Sink> void runStage(const SchedulerStage &stage, Sink &sink) noexcept {
    const std::uint32_t lane = stage.channel;
    switch (stage.kind) {
    case Pack:
      for (std::uint32_t index = stage.begin; index < stage.end; ++index) {
        const float sample =
            lane == 0u ? short_ring_[static_cast<std::uint32_t>(job_short_begin_ + index) &
                                     (short_size_ - 1u)]
                       : long_ring_[static_cast<std::uint32_t>(job_long_begin_ + index) &
                                    (long_size_ - 1u)];
        input_[lane][index] = sample * active_->window[index];
      }
      break;
    case Transform:
      if (active_->transforms[lane]->step() < 0) {
        ready_ = false;
      }
      break;
    case Power:
      for (std::uint32_t bin = stage.begin; bin < stage.end; ++bin) {
        const bool endpoint = bin == 0u || bin == active_->size / 2u;
        const std::uint32_t real_index = bin == 0u ? 0u : (endpoint ? 1u : 2u * bin);
        const double real = output_[lane][real_index];
        const double imaginary = endpoint ? 0.0 : output_[lane][2u * bin + 1u];
        power_[lane][bin] =
            static_cast<float>((real * real + imaginary * imaginary) * active_->powerNormalization *
                               (endpoint ? 1.0 : 4.0));
      }
      break;
    case Map:
      for (std::uint32_t index = stage.begin; index < stage.end; ++index) {
        const auto &cell = active_->cells[index];
        double power = 0.0;
        if (cell.valid) {
          const double long_power = cell.longWeight > 0.0 ? mapPower(1u, cell.bands[1]) : 0.0;
          const double short_power = cell.longWeight < 1.0 ? mapPower(0u, cell.bands[0]) : 0.0;
          power = cell.longWeight * long_power + (1.0 - cell.longWeight) * short_power;
        }
        sink.hqCell(index,
                    static_cast<float>(10.0 * std::log10(power > 1.0e-24 ? power : 1.0e-24)));
      }
      break;
    default:
      break;
    }
  }

  std::array<std::unique_ptr<Configuration>, kPointCount> configs_;
  Configuration *active_ = nullptr;
  std::vector<float> short_ring_;
  std::vector<float> long_ring_;
  std::array<double, kFirTaps> fir_{};
  std::array<float *, 2u> input_{};
  std::array<float *, 2u> output_{};
  std::array<float *, 2u> work_{};
  std::array<float *, 2u> power_{};
  float *storage_ = nullptr;
  float sample_rate_ = 48000.0F;
  double fir_sum_ = 0.0;
  std::uint64_t samples_ = 0u;
  std::uint64_t decimated_samples_ = 0u;
  std::uint64_t latest_decimator_end_ = 0u;
  std::uint64_t next_job_ = 0u;
  std::uint64_t next_slot_sample_ = 0u;
  std::uint64_t job_capture_end_ = 0u;
  std::uint64_t job_short_begin_ = 0u;
  std::uint64_t job_long_begin_ = 0u;
  std::uint32_t short_size_ = 0u;
  std::uint32_t long_size_ = 0u;
  std::uint32_t generation_ = 0u;
  std::uint32_t frame_index_ = 0u;
  std::uint32_t cell_count_ = kSpectrumCells;
  std::uint32_t job_slot_ = 0u;
  bool spectrogram_ = false;
  bool job_active_ = false;
  bool ready_ = false;
};

} // namespace effetune::dsp

#endif

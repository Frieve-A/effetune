#ifndef EFFETUNE_NOTE_SPECTROGRAM_HARMNET_FRONTEND_H
#define EFFETUNE_NOTE_SPECTROGRAM_HARMNET_FRONTEND_H

#include "effetune/dsp/pffft_incremental.h"
#include "effetune/dsp/stage_scheduler.h"
#include "pffft.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

namespace effetune::plugins::analyzer {
enum class NoteSpectrogramStage : std::uint8_t {
  Pack,
  Transform,
  Spectrum,
  Features,
  Prefix,
  Convolution,
  Gather,
  PitchConvolution,
  Recurrent,
  Fine,
  Publish,
  Commit
};

class HarmNetFrontend final {
  struct SetupDeleter {
    void operator()(PFFFT_Setup *p) const noexcept {
      if (p)
        pffft_destroy_setup(p);
    }
  };
  struct BufferDeleter {
    void operator()(float *p) const noexcept {
      if (p)
        pffft_aligned_free(p);
    }
  };
  using Buffer = std::unique_ptr<float, BufferDeleter>;
  using Transform = ::effetune::dsp::PffftOrderedRealForward;
  using Stage = NoteSpectrogramStage;
  struct Row {
    std::uint32_t first = 0u, offset = 0u, length = 0u;
  };
  static constexpr double kPi = 3.14159265358979323846;
  static constexpr double kFloorPower = 2.511886431509582e-10;

public:
  static constexpr std::uint32_t kBins = 300u;
  static std::uint32_t referenceDelaySamples(float rate, bool long_window) noexcept {
    return static_cast<std::uint32_t>(std::round(rate * (long_window ? .02 : .01)));
  }
  bool prepare(float rate, bool long_window) {
    rate_ = rate;
    window_length_ =
        static_cast<std::uint32_t>(std::round(rate * (long_window ? 16384.0 : 4096.0) / 48000.0));
    fft_size_ = 32u;
    while (fft_size_ < window_length_)
      fft_size_ *= 2u;
    ring_size_ = fft_size_ * 2u;
    setup_.reset(pffft_new_setup(static_cast<int>(fft_size_), PFFFT_REAL));
    if (!setup_)
      return false;
    ring_ = allocate(ring_size_);
    input_ = allocate(fft_size_);
    output_ = allocate(fft_size_);
    work_ = allocate(fft_size_);
    transform_ = std::make_unique<Transform>(setup_.get(), 64);
    if (!ring_ || !input_ || !output_ || !work_ || !transform_->valid())
      return false;
    const auto fall = referenceDelaySamples(rate, long_window);
    const auto rise = window_length_ - fall;
    std::vector<double> raw(window_length_);
    double sum = 0.0;
    for (auto i = 0u; i < window_length_; ++i) {
      raw[i] = i < rise ? .5 * (1.0 - std::cos(kPi * (i + .5) / rise))
                        : .5 * (1.0 + std::cos(kPi * (i - rise + .5) / fall));
      sum += raw[i];
    }
    window_.resize(window_length_);
    window_energy_ = 0.0;
    for (auto i = 0u; i < window_length_; ++i) {
      window_[i] = static_cast<float>(raw[i] / sum);
      window_energy_ += static_cast<double>(window_[i]) * window_[i];
    }
    const auto bins = fft_size_ / 2u + 1u;
    magnitude_.resize(bins);
    prefix_.resize(bins + 1u);
    weights_.clear();
    std::vector<double> column(bins);
    const auto df = binHz();
    for (auto k = 0u; k < kBins; ++k) {
      const double midi = 21.0 + (static_cast<double>(k) - 1.0) / 3.0;
      const auto center = midiHz(midi), low = midiHz(midi - 1.0 / 3.0),
                 high = midiHz(midi + 1.0 / 3.0);
      auto &row = rows_[k];
      row = {0u, static_cast<std::uint32_t>(weights_.size()), 0u};
      // Out-of-band rows are zero, including the interpolation fallback at low sample rates.
      if (center > rate_ * .5)
        continue;
      double total = 0.0;
      for (auto j = 0u; j < bins; ++j) {
        const auto hz = j * df;
        const auto a = (hz - low) / (center - low), b = (high - hz) / (high - center);
        const auto value = a < b ? a : b;
        column[j] = value > 0.0 ? value : 0.0;
        total += column[j];
      }
      if ((high - low) / 2.0 > df && total > 0.0) {
        for (auto &value : column)
          value /= total;
      } else {
        std::fill(column.begin(), column.end(), 0.0);
        const auto position = center / df;
        const auto first = static_cast<std::uint32_t>(std::floor(position));
        if (first < bins)
          column[first] = 1.0 - (position - first);
        if (first + 1u < bins)
          column[first + 1u] = position - first;
      }
      auto first = 0u, last = bins;
      while (first < bins && column[first] == 0.0)
        ++first;
      while (last > first && column[last - 1u] == 0.0)
        --last;
      row.first = first;
      row.length = last - first;
      for (auto j = first; j < last; ++j)
        weights_.push_back(static_cast<float>(column[j]));
    }
    reset();
    return true;
  }
  void reset() noexcept {
    write_position_ = 0u;
    sum_ = squares_ = sum_correction_ = square_correction_ = 0.0;
    if (ring_)
      std::fill_n(ring_.get(), ring_size_, 0.0F);
    below_floor_ = true;
  }
  void push(float mono) noexcept {
    const auto leaving = (write_position_ + ring_size_ - window_length_) & (ring_size_ - 1u);
    const auto old = ring_.get()[leaving];
    accumulate(static_cast<double>(mono) - old, sum_, sum_correction_);
    accumulate(static_cast<double>(mono) * mono - static_cast<double>(old) * old, squares_,
               square_correction_);
    ring_.get()[write_position_] = mono;
    write_position_ = (write_position_ + 1u) & (ring_size_ - 1u);
  }
  bool begin() noexcept {
    origin_ = (write_position_ + ring_size_ - window_length_) & (ring_size_ - 1u);
    const double mean = sum_ / window_length_;
    below_floor_ = !(squares_ / window_length_ - mean * mean >= kFloorPower);
    return transform_->begin(input_.get(), output_.get(), work_.get());
  }
  template <class Schedule>
  void appendStages(Schedule &schedule, std::uint32_t lane, std::uint32_t slots) const {
    const auto add = [&](Stage kind, auto count, auto chunks, auto weight) {
      for (auto i = 0u; i < chunks; ++i) {
        const auto begin =
            static_cast<std::uint32_t>(static_cast<std::uint64_t>(count) * i / chunks);
        const auto end =
            static_cast<std::uint32_t>(static_cast<std::uint64_t>(count) * (i + 1u) / chunks);
        schedule.addStage(static_cast<std::uint8_t>(kind), lane, begin, end,
                          weight * (end - begin));
      }
    };
    add(Stage::Pack, window_length_, std::min(slots, 64u), 15u);
    for (auto i = 0; i < transform_->stepCount(); ++i)
      schedule.addStage(static_cast<std::uint8_t>(Stage::Transform), lane, 0u, 0u, 4096u);
    const auto bins = static_cast<std::uint32_t>(magnitude_.size());
    add(Stage::Spectrum, bins, std::min(slots, 128u), 48u);
    add(Stage::Features, kBins, std::min(slots, kBins), 300u);
    if (lane == 0u)
      schedule.addStage(static_cast<std::uint8_t>(Stage::Prefix), lane, 0u, bins, bins * 12u);
  }
  bool run(Stage kind, std::uint32_t begin, std::uint32_t end, float *features) noexcept {
    switch (kind) {
    case Stage::Pack:
      if (begin == 0u)
        std::fill_n(input_.get() + window_length_, fft_size_ - window_length_, 0.0F);
      for (auto i = begin; i < end; ++i)
        input_.get()[i] = ring_.get()[(origin_ + i) & (ring_size_ - 1u)] * window_[i];
      break;
    case Stage::Transform:
      return transform_->step() >= 0;
    case Stage::Spectrum:
      for (auto i = begin; i < end; ++i) {
        const auto re = output_.get()[i == fft_size_ / 2u ? 1u : 2u * i];
        const auto im = i > 0u && i < fft_size_ / 2u ? output_.get()[2u * i + 1u] : 0.0F;
        magnitude_[i] = std::sqrt(re * re + im * im);
      }
      break;
    case Stage::Features:
      for (auto i = begin; i < end; ++i) {
        const auto &row = rows_[i];
        float value = 0.0F;
        for (auto j = 0u; j < row.length; ++j)
          value += weights_[row.offset + j] * magnitude_[row.first + j];
        features[i] = std::log1p(1.0e4F * value);
      }
      break;
    case Stage::Prefix:
      prefix_[0] = 0.0;
      for (auto i = begin; i < end; ++i)
        prefix_[i + 1u] = prefix_[i] + static_cast<double>(magnitude_[i]) * magnitude_[i];
      break;
    default:
      return false;
    }
    return true;
  }
  // The long-window peaks determine shape only; the network supplies its probability.
  void fineShape(std::uint32_t pitch, float *shape) const noexcept {
    const auto fundamental = midiHz(21.0 + pitch), df = binHz();
    double weighted = 0.0, weight = 0.0;
    for (auto h = 1u; h <= 4u; ++h) {
      const auto center = fundamental * h;
      if (center >= rate_ * .45)
        break;
      const auto cents_width = center * (std::exp2(60.0 / 1200.0) - 1.0);
      const auto width = cents_width > df ? cents_width : df;
      const auto lower = std::floor((center - width) / df + .5);
      const auto upper = std::floor((center + width) / df + .5);
      const auto first = static_cast<std::uint32_t>(lower > 1.0 ? lower : 1.0);
      const auto last = static_cast<std::uint32_t>(
          upper < magnitude_.size() - 2.0 ? upper : magnitude_.size() - 2u);
      if (first > last)
        continue;
      auto best = first;
      for (auto k = first + 1u; k <= last; ++k)
        if (magnitude_[k] > magnitude_[best])
          best = k;
      const auto magnitude = magnitude_[best];
      if (magnitude < magnitude_[best - 1u] || magnitude < magnitude_[best + 1u])
        continue;
      const auto log_power = [](float m) { return std::log(static_cast<double>(m) * m + 1.0e-30); };
      const auto a = log_power(magnitude_[best - 1u]), b = log_power(magnitude),
                 c = log_power(magnitude_[best + 1u]);
      const auto curvature = a - 2.0 * b + c;
      auto delta = curvature < 0.0 ? .5 * (a - c) / curvature : 0.0;
      const auto peak_magnitude = std::exp(.5 * (b - .25 * (a - c) * delta));
      if (peak_magnitude < 1.12e-5)
        continue;
      const auto cents = 1200.0 * std::log2((best + delta) * df / center);
      weighted += cents * peak_magnitude;
      weight += peak_magnitude;
    }
    if (!(weight > 0.0)) {
      for (auto i = 0u; i < 5u; ++i)
        shape[i] = i == 2u ? 1.0F : 0.0F;
      return;
    }
    const auto cents = weighted / weight;
    const auto nearest = std::clamp(static_cast<int>(std::floor((cents + 50.0) / 20.0)), 0, 4);
    const auto peak_delta = (nearest - 2.0) * 20.0 - cents;
    // Normalize in the exponent so an outlying interpolated peak cannot underflow all cells.
    for (auto i = 0u; i < 5u; ++i) {
      const auto delta = (static_cast<double>(i) - 2.0) * 20.0 - cents;
      shape[i] =
          static_cast<float>(std::exp(-.5 * (delta * delta - peak_delta * peak_delta) / 400.0));
    }
  }
  bool belowFloor() const noexcept { return below_floor_; }
  double binHz() const noexcept { return rate_ / fft_size_; }
  double amplitudePowerScale() const noexcept { return 4.0 / (fft_size_ * window_energy_); }
  const auto &powerPrefix() const noexcept { return prefix_; }

private:
  static double midiHz(double midi) { return 440.0 * std::exp2((midi - 69.0) / 12.0); }
  static Buffer allocate(std::uint32_t n) {
    return Buffer(static_cast<float *>(pffft_aligned_malloc(sizeof(float) * n)));
  }
  static void accumulate(double delta, double &sum, double &correction) noexcept {
    const auto adjusted = delta - correction, next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  std::unique_ptr<PFFFT_Setup, SetupDeleter> setup_;
  Buffer ring_, input_, output_, work_;
  std::unique_ptr<Transform> transform_;
  std::vector<float> window_, magnitude_, weights_;
  std::vector<double> prefix_;
  std::array<Row, kBins> rows_{};
  float rate_ = 48000.0F;
  std::uint32_t window_length_ = 0u, fft_size_ = 0u, ring_size_ = 0u, write_position_ = 0u,
                origin_ = 0u;
  double window_energy_ = 0.0, sum_ = 0.0, squares_ = 0.0, sum_correction_ = 0.0,
         square_correction_ = 0.0;
  bool below_floor_ = true;
};
} // namespace effetune::plugins::analyzer
#endif

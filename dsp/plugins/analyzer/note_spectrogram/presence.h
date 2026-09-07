#ifndef EFFETUNE_MULTI_F0_PRESENCE_H
#define EFFETUNE_MULTI_F0_PRESENCE_H

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::analyzer {
// Shallow frequency/periodicity salience with continuous support at repeated periods.
// Local RMS contrast measures evidence, rather than selecting a discrete set of notes.
class PresenceEstimator final {
public:
  static constexpr std::uint32_t kGridSize = 353u;

  void prepare(float sample_rate, std::uint32_t fft_size, std::uint32_t pitch_divisions = 4u,
               bool centered_bags = false) {
    fft_size_ = fft_size;
    half_ = fft_size / 2u;
    bin_hz_ = sample_rate / static_cast<double>(fft_size);
    minimum_lag_ = sample_rate / 4186.009;
    spectrum_.resize(half_ + 1u);
    cepstrum_.resize(half_ + 1u);
    cepstrum_prefix_.resize(half_ + 2u);
    spectrum_prefix_.resize(half_ + 2u);
    pitch_divisions_ = pitch_divisions != 0u ? pitch_divisions : 4u;
    centered_bags_ = centered_bags;
    grid_size_ = centered_bags_ ? 88u * pitch_divisions_ : kGridSize;
    grid_first_midi_ = centered_bags_
                           ? 21.0 - static_cast<double>(pitch_divisions_ / 2u) / pitch_divisions_
                           : 20.5;
    queries_.resize(grid_size_);
    salience_.resize(grid_size_);
    scores_.resize(grid_size_);
    fine_values_.resize(centered_bags_ ? grid_size_ : 0u);
    for (std::uint32_t p = 0u; p < grid_size_; ++p) {
      auto &query = queries_[p];
      const double midi = grid_first_midi_ + static_cast<double>(p) / pitch_divisions_;
      const double frequency = 440.0 * std::exp2((midi - 69.0) / 12.0);
      const double lag = sample_rate / frequency;
      query.frequency = point(frequency / bin_hz_);
      query.frequency_band = band(frequency / bin_hz_);
      query.period_band = band(lag);
      query.periods = 0u;
      for (std::uint32_t k = 1u; k <= 3u && k * lag <= half_; ++k)
        query.period[query.periods++] = point(k * lag);
      query.observable = query.periods != 0u && frequency <= sample_rate * 0.5;
    }
    reset();
  }
  void reset() noexcept {
    values_.fill(0.0F);
    std::fill(fine_values_.begin(), fine_values_.end(), 0.0F);
  }

  void mapPower(const float *spectrum, std::uint32_t begin, std::uint32_t end,
                std::uint32_t channel, std::uint32_t channels) noexcept {
    for (auto n = begin; n < end; ++n) {
      const double re = real(spectrum, n);
      const double im = n == 0u || n == half_ ? 0.0 : spectrum[2u * n + 1u];
      const double power = (re * re + im * im) / channels;
      const float value = std::isfinite(power) ? static_cast<float>(power) : 0.0F;
      if (channel == 0u)
        spectrum_[n] = value;
      else
        spectrum_[n] += value;
    }
  }
  void packSpectrum(float *input, std::uint32_t begin, std::uint32_t end) const noexcept {
    for (auto n = begin; n < end; ++n) {
      const float value = std::pow(std::sqrt(spectrum_[n]), 0.24F);
      packEven(input, n, std::isfinite(value) ? value : 0.0F);
    }
  }
  void packCepstrum(const float *output, float *input, std::uint32_t begin,
                    std::uint32_t end) noexcept {
    if (begin == 0u)
      cepstrum_prefix_[0] = 0.0;
    for (auto n = begin; n < end; ++n) {
      const float value = real(output, n) / static_cast<float>(fft_size_);
      cepstrum_[n] = value;
      cepstrum_prefix_[n + 1u] = cepstrum_prefix_[n] + static_cast<double>(value) * value;
      const float compressed = value > 0.0F && n >= minimum_lag_ ? std::pow(value, 0.6F) : 0.0F;
      packEven(input, n, compressed);
    }
  }
  void captureSpectrum(const float *output, std::uint32_t begin, std::uint32_t end) noexcept {
    if (begin == 0u)
      spectrum_prefix_[0] = 0.0;
    for (auto n = begin; n < end; ++n) {
      const float value = real(output, n) / static_cast<float>(fft_size_);
      spectrum_prefix_[n + 1u] = spectrum_prefix_[n] + static_cast<double>(value) * value;
      spectrum_[n] = value > 0.0F && n * bin_hz_ >= 27.5 ? value : 0.0F;
    }
  }
  void evaluate(const float *compressed_cepstrum, std::uint32_t begin, std::uint32_t end) noexcept {
    for (auto p = begin; p < end; ++p) {
      const auto &query = queries_[p];
      salience_[p] = scores_[p] = 0.0F;
      if (!query.observable)
        continue;
      double support = 0.0, mass = 0.0;
      for (std::uint32_t k = 0u; k < query.periods; ++k) {
        const auto value = interpolate(cepstrum_.data(), query.period[k]);
        support += value;
        mass += std::abs(value);
      }
      const double coherence = mass > 0.0 && support > 0.0 ? support / mass : 0.0;
      const double spectral = interpolate(spectrum_.data(), query.frequency);
      const double compressed = interpolate(compressed_cepstrum, query.period[0]);
      salience_[p] = static_cast<float>(spectral * compressed * coherence);
      const double c0 = positive(cepstrum_[query.period[0].index]);
      const double c1 = positive(cepstrum_[query.period[0].index + 1u]);
      const double periodic = c0 + query.period[0].fraction * (c1 - c0);
      const double periodic_rms = rms(cepstrum_prefix_, query.period_band);
      const double spectral_rms = rms(spectrum_prefix_, query.frequency_band);
      if (periodic_rms <= 0.0 || spectral_rms <= 0.0)
        continue;
      const double ratio =
          coherence * std::pow(periodic / periodic_rms, 0.6) * (spectral / spectral_rms);
      if (ratio > 1.0 && std::isfinite(ratio))
        scores_[p] = static_cast<float>((ratio - 1.0) / (ratio + 1.0));
    }
  }
  void finish() noexcept {
    values_.fill(0.0F);
    // The final grid point supplies the upper neighbor of C8 but is not a row itself.
    for (std::uint32_t p = 0u; p + 1u < kGridSize; ++p) {
      const auto first = p > 2u ? p - 2u : 0u;
      const auto last = std::min(p + 2u, kGridSize - 1u);
      bool ridge = true;
      for (auto neighbor = first; neighbor <= last; ++neighbor)
        if (salience_[neighbor] > salience_[p])
          ridge = false;
      if (ridge && scores_[p] > values_[p / 4u])
        values_[p / 4u] = scores_[p];
    }
  }
  void finishFine() noexcept {
    std::fill(fine_values_.begin(), fine_values_.end(), 0.0F);
    const auto radius = std::max(1u, pitch_divisions_ / 2u);
    for (std::uint32_t p = 0u; p < grid_size_; ++p) {
      const auto first = p > radius ? p - radius : 0u;
      const auto last = std::min(p + radius, grid_size_ - 1u);
      bool ridge = true;
      for (auto neighbor = first; neighbor <= last; ++neighbor)
        if (salience_[neighbor] > salience_[p])
          ridge = false;
      if (ridge)
        fine_values_[p] = scores_[p];
    }
  }
  const std::array<float, 88> &values() const noexcept { return values_; }
  const std::vector<float> &fineValues() const noexcept { return fine_values_; }
  const std::vector<float> &fineSalience() const noexcept { return salience_; }
  std::uint32_t gridSize() const noexcept { return grid_size_; }
  const std::vector<float> &spectrum() const noexcept { return spectrum_; }
  const std::vector<float> &cepstrum() const noexcept { return cepstrum_; }
  const std::vector<double> &spectrumPrefix() const noexcept { return spectrum_prefix_; }
  const std::vector<double> &cepstrumPrefix() const noexcept { return cepstrum_prefix_; }

private:
  struct Point {
    std::uint32_t index = 0u;
    double fraction = 0.0;
  };
  struct Band {
    std::uint32_t begin = 0u, end = 0u;
  };
  struct Query {
    Point frequency;
    std::array<Point, 3> period{};
    Band frequency_band, period_band;
    std::uint32_t periods = 0u;
    bool observable = false;
  };
  Point point(double coordinate) const noexcept {
    coordinate = std::clamp(coordinate, 0.0, static_cast<double>(half_));
    const auto index = std::min(static_cast<std::uint32_t>(coordinate), half_ - 1u);
    return {index, coordinate - index};
  }
  Band band(double center) const noexcept {
    constexpr double root_two = 1.4142135623730951;
    const double begin = std::min(std::ceil(center / root_two), std::ceil(center) - 1.0);
    const double end = std::max(std::floor(center * root_two) + 1.0, std::ceil(center) + 1.0);
    return {static_cast<std::uint32_t>(std::clamp(begin, 0.0, static_cast<double>(half_))),
            static_cast<std::uint32_t>(std::clamp(end, 1.0, static_cast<double>(half_ + 1u)))};
  }
  static double rms(const std::vector<double> &prefix, Band range) noexcept {
    const double energy = prefix[range.end] - prefix[range.begin];
    return energy > 0.0 ? std::sqrt(energy / (range.end - range.begin)) : 0.0;
  }
  static double positive(float value) noexcept { return value > 0.0F ? value : 0.0; }
  static double interpolate(const float *data, Point query) noexcept {
    return data[query.index] +
           query.fraction * (static_cast<double>(data[query.index + 1u]) - data[query.index]);
  }
  float real(const float *spectrum, std::uint32_t bin) const noexcept {
    return spectrum[bin == half_ ? 1u : 2u * bin];
  }
  void packEven(float *input, std::uint32_t bin, float value) const noexcept {
    input[bin] = value;
    if (bin != 0u && bin != half_)
      input[fft_size_ - bin] = value;
  }
  std::uint32_t fft_size_ = 0u, half_ = 0u;
  double bin_hz_ = 0.0, minimum_lag_ = 0.0;
  std::vector<float> spectrum_, cepstrum_;
  std::vector<double> spectrum_prefix_, cepstrum_prefix_;
  std::vector<Query> queries_;
  std::vector<float> salience_, scores_, fine_values_;
  std::array<float, 88> values_{};
  std::uint32_t pitch_divisions_ = 4u, grid_size_ = kGridSize;
  double grid_first_midi_ = 20.5;
  bool centered_bags_ = false;
};
} // namespace effetune::plugins::analyzer
#endif

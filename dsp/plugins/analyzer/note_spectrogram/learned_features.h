#ifndef EFFETUNE_MULTI_F0_LEARNED_FEATURES_H
#define EFFETUNE_MULTI_F0_LEARNED_FEATURES_H

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::analyzer {

// Pitch-relative features shared by the offline trainer and the runtime classifier.
class LearnedPitchFeatures final {
public:
  static constexpr std::uint32_t kPitchCount = 88u;
  static constexpr std::uint32_t kFirstMidi = 21u;
  static constexpr std::uint32_t kDetuneCount = 4u;
  static constexpr std::uint32_t kHarmonicCount = 8u;
  static constexpr std::uint32_t kBaseFeatureCount = 29u;
  static constexpr std::uint32_t kTemporalFeaturesPerHarmonic = 2u;
  static constexpr std::uint32_t kFeatureCount =
      kBaseFeatureCount + kHarmonicCount * kTemporalFeaturesPerHarmonic;
  static constexpr std::uint32_t kSchemaVersion = 7u;
  static constexpr std::array<double, kDetuneCount> kDetuneSemitones = {-0.375, -0.125, 0.125,
                                                                        0.375};

  void prepare(double sample_rate, std::uint32_t fft_size, std::uint32_t hop_samples) {
    fft_size_ = fft_size;
    half_ = fft_size / 2u;
    bin_hz_ = sample_rate / fft_size;
    constexpr double reference_hz = 22050.0;
    reference_spectrum_bins_ = std::min(
        half_, std::max(1u, static_cast<std::uint32_t>(std::lround(reference_hz / bin_hz_))));
    raw_prefix_.assign(half_ + 2u, 0.0);
    const double hop_seconds = static_cast<double>(hop_samples) / sample_rate;
    ema_alpha_60ms_ = static_cast<float>(1.0 - std::exp(-hop_seconds / 0.060));
    ema_alpha_200ms_ = static_cast<float>(1.0 - std::exp(-hop_seconds / 0.200));
    for (std::uint32_t pitch = 0u; pitch < kPitchCount; ++pitch) {
      const double midi = static_cast<double>(kFirstMidi + pitch);
      std::uint32_t center_observable = 0u;
      for (std::uint32_t q = 0u; q < kDetuneCount; ++q) {
        auto &query = queries_[pitch][q];
        const double frequency = 440.0 * std::exp2((midi + kDetuneSemitones[q] - 69.0) / 12.0);
        const double lag = sample_rate / frequency;
        query.frequency = point(frequency / bin_hz_);
        query.frequency_band = octaveBand(frequency / bin_hz_, half_);
        for (std::uint32_t period = 0u; period < 3u; ++period) {
          query.period[period] = point((period + 1u) * lag);
          query.period_observable[period] = (period + 1u) * lag <= half_;
        }
        query.period_band = octaveBand(lag, half_);
        query.observable_harmonics = 0u;
        for (std::uint32_t harmonic = 0u; harmonic < kHarmonicCount; ++harmonic) {
          const double harmonic_bin = (harmonic + 1u) * frequency / bin_hz_;
          auto &target = query.harmonics[harmonic];
          target.observable = harmonic_bin <= reference_spectrum_bins_;
          target.position = point(harmonic_bin);
          target.cell = frequencyCell(harmonic_bin);
          target.background = octaveBand(harmonic_bin, reference_spectrum_bins_);
          if (target.observable)
            ++query.observable_harmonics;
        }
        if (q == 1u || q == 2u)
          center_observable = std::max(center_observable, query.observable_harmonics);
      }
      center_observable_[pitch] = center_observable;
    }
    clear();
  }

  void clear() noexcept {
    for (auto &row : values_)
      row.fill(0.0F);
    for (auto &row : ema_60ms_)
      row.fill(0.0F);
    for (auto &row : ema_200ms_)
      row.fill(0.0F);
    if (!raw_prefix_.empty())
      raw_prefix_[0] = 0.0;
  }

  // Prefix stages must be called in ascending, contiguous bin order.
  void accumulateRawPrefix(const float *raw_spectrum, std::uint32_t begin,
                           std::uint32_t end) noexcept {
    if (!raw_spectrum || raw_prefix_.empty() || begin > half_)
      return;
    end = std::min(end, half_ + 1u);
    if (begin == 0u)
      raw_prefix_[0] = 0.0;
    for (auto bin = begin; bin < end; ++bin) {
      const double value = finitePositive(raw_spectrum[bin]);
      raw_prefix_[bin + 1u] = raw_prefix_[bin] + value;
    }
  }

  static float poolRatios(const std::array<double, kDetuneCount> &ratios) noexcept {
    double sum = 0.0;
    for (const double ratio : ratios)
      sum += ratio;
    return logRatio(sum, kDetuneCount);
  }

  static std::array<float, 2u>
  summarizeDetune(const std::array<float, kDetuneCount> &values) noexcept {
    double sum = 0.0;
    float maximum = values[0];
    for (const float value : values) {
      sum += value;
      maximum = value > maximum ? value : maximum;
    }
    return {static_cast<float>(sum / kDetuneCount), maximum};
  }

  void extractRaw(const float *raw_spectrum, std::uint32_t begin_pitch,
                  std::uint32_t end_pitch) noexcept {
    if (!raw_spectrum || raw_prefix_.empty())
      return;
    end_pitch = std::min(end_pitch, kPitchCount);
    const double full_energy = raw_prefix_[reference_spectrum_bins_ + 1u] - raw_prefix_[1u];
    const double full_mean = full_energy / reference_spectrum_bins_;
    for (auto pitch = begin_pitch; pitch < end_pitch; ++pitch) {
      auto &row = values_[pitch];
      std::array<std::array<double, kDetuneCount>, kHarmonicCount> global_ratios{};
      std::array<std::array<double, kDetuneCount>, kHarmonicCount> local_ratios{};
      for (std::uint32_t q = 0u; q < kDetuneCount; ++q) {
        const auto &query = queries_[pitch][q];
        for (std::uint32_t harmonic = 0u; harmonic < kHarmonicCount; ++harmonic) {
          const auto &target = query.harmonics[harmonic];
          if (!target.observable)
            continue;
          const double power = cellMean(raw_spectrum, target.position, target.cell);
          const double local_mean = bandMean(raw_prefix_, target.background);
          global_ratios[harmonic][q] = positiveRatio(power, full_mean);
          local_ratios[harmonic][q] = positiveRatio(power, local_mean);
        }
      }
      for (std::uint32_t harmonic = 0u; harmonic < kHarmonicCount; ++harmonic) {
        row[harmonic] = poolRatios(global_ratios[harmonic]);
        row[kHarmonicCount + harmonic] = poolRatios(local_ratios[harmonic]);
      }
      row[28u] = static_cast<float>(center_observable_[pitch]) / kHarmonicCount;
    }
  }

  void extractCfp(const float *cepstrum, const std::vector<double> &cepstrum_prefix,
                  const float *second_spectrum, const std::vector<double> &second_spectrum_prefix,
                  std::uint32_t begin_pitch, std::uint32_t end_pitch) noexcept {
    if (!cepstrum || !second_spectrum)
      return;
    end_pitch = std::min(end_pitch, kPitchCount);
    for (auto pitch = begin_pitch; pitch < end_pitch; ++pitch) {
      auto &row = values_[pitch];
      std::array<std::array<float, kDetuneCount>, 6u> detune_values{};
      for (std::uint32_t q = 0u; q < kDetuneCount; ++q) {
        const auto &query = queries_[pitch][q];
        const double periodic_rms = bandRms(cepstrum_prefix, query.period_band);
        double support = 0.0, mass = 0.0;
        for (std::uint32_t period = 0u; period < 3u; ++period) {
          if (query.period_observable[period]) {
            const double value = interpolateSigned(cepstrum, query.period[period]);
            support += value;
            mass += std::abs(value);
            detune_values[period][q] = boundedRatio(value, periodic_rms, -32.0, 32.0);
          }
        }
        const double spectral_rms = bandRms(second_spectrum_prefix, query.frequency_band);
        const double spectral = interpolatePositive(second_spectrum, query.frequency);
        detune_values[3u][q] = boundedRatio(spectral, spectral_rms, 0.0, 32.0);
        detune_values[4u][q] =
            static_cast<float>(mass > 0.0 && support > 0.0 ? std::min(1.0, support / mass) : 0.0);
        const float larger_multiple = detune_values[1u][q] > detune_values[2u][q]
                                          ? detune_values[1u][q]
                                          : detune_values[2u][q];
        detune_values[5u][q] =
            detune_values[0u][q] - (larger_multiple > 0.0F ? larger_multiple : 0.0F);
      }
      for (std::uint32_t statistic = 0u; statistic < detune_values.size(); ++statistic) {
        const auto summary = summarizeDetune(detune_values[statistic]);
        row[16u + 2u * statistic] = summary[0];
        row[17u + 2u * statistic] = summary[1];
      }
    }
  }

  void updateTemporal(std::uint32_t begin_pitch, std::uint32_t end_pitch,
                      bool below_analysis_floor) noexcept {
    end_pitch = std::min(end_pitch, kPitchCount);
    for (auto pitch = begin_pitch; pitch < end_pitch; ++pitch) {
      auto &row = values_[pitch];
      auto &short_history = ema_60ms_[pitch];
      auto &long_history = ema_200ms_[pitch];
      if (below_analysis_floor) {
        std::fill(row.begin() + kBaseFeatureCount, row.end(), 0.0F);
        short_history.fill(0.0F);
        long_history.fill(0.0F);
        continue;
      }
      for (std::uint32_t harmonic = 0u; harmonic < kHarmonicCount; ++harmonic) {
        const auto offset = kBaseFeatureCount + harmonic * kTemporalFeaturesPerHarmonic;
        const float current = row[harmonic];
        const float past_short = short_history[harmonic];
        const float past_long = long_history[harmonic];
        row[offset] = current - past_short;
        row[offset + 1u] = current - past_long;
        short_history[harmonic] = past_short + ema_alpha_60ms_ * (current - past_short);
        long_history[harmonic] = past_long + ema_alpha_200ms_ * (current - past_long);
      }
    }
  }

  const std::array<std::array<float, kFeatureCount>, kPitchCount> &values() const noexcept {
    return values_;
  }

private:
  struct Point {
    std::uint32_t index = 0u;
    double fraction = 0.0;
  };
  struct Band {
    std::uint32_t begin = 0u, end = 1u;
  };
  struct ContinuousBand {
    double begin = 0.0, end = 0.0;
  };
  struct HarmonicQuery {
    Point position;
    ContinuousBand cell;
    Band background;
    bool observable = false;
  };
  struct Query {
    Point frequency;
    std::array<Point, 3> period{};
    std::array<bool, 3> period_observable{};
    Band frequency_band, period_band;
    std::array<HarmonicQuery, kHarmonicCount> harmonics{};
    std::uint32_t observable_harmonics = 0u;
  };

  Point point(double coordinate) const noexcept {
    coordinate = std::clamp(coordinate, 0.0, static_cast<double>(half_));
    const auto index = std::min(static_cast<std::uint32_t>(coordinate), half_ - 1u);
    return {index, coordinate - index};
  }
  Band octaveBand(double center, std::uint32_t upper_bin) const noexcept {
    constexpr double root_two = 1.4142135623730951;
    const double begin = std::min(std::ceil(center / root_two), std::ceil(center) - 1.0);
    const double end = std::max(std::floor(center * root_two) + 1.0, std::ceil(center) + 1.0);
    return {static_cast<std::uint32_t>(std::clamp(begin, 0.0, static_cast<double>(upper_bin))),
            static_cast<std::uint32_t>(std::clamp(end, 1.0, static_cast<double>(upper_bin + 1u)))};
  }
  ContinuousBand frequencyCell(double center) const noexcept {
    constexpr double lower = 0.99280572049126892, upper = 1.0072464122237039;
    return {std::clamp(center * lower, 0.0, static_cast<double>(half_)),
            std::clamp(center * upper, 0.0, static_cast<double>(half_))};
  }
  static double finitePositive(float value) noexcept {
    return std::isfinite(value) && value > 0.0F ? value : 0.0;
  }
  static double interpolatePositive(const float *data, Point query) noexcept {
    const double first = finitePositive(data[query.index]);
    const double second = finitePositive(data[query.index + 1u]);
    return first + query.fraction * (second - first);
  }
  static double interpolateSigned(const float *data, Point query) noexcept {
    const double first = std::isfinite(data[query.index]) ? data[query.index] : 0.0;
    const double second = std::isfinite(data[query.index + 1u]) ? data[query.index + 1u] : 0.0;
    return first + query.fraction * (second - first);
  }
  double cellMean(const float *data, Point center, ContinuousBand cell) const noexcept {
    const double width = cell.end - cell.begin;
    if (!(width >= 1.0))
      return interpolatePositive(data, center);
    const double integral = linearPrimitive(data, cell.end) - linearPrimitive(data, cell.begin);
    return integral > 0.0 ? integral / width : 0.0;
  }
  double linearPrimitive(const float *data, double coordinate) const noexcept {
    coordinate = std::clamp(coordinate, 0.0, static_cast<double>(half_));
    const auto index = static_cast<std::uint32_t>(coordinate);
    if (index >= half_)
      return raw_prefix_[half_] - 0.5 * finitePositive(data[0]) + 0.5 * finitePositive(data[half_]);
    const double first = finitePositive(data[index]);
    const double second = finitePositive(data[index + 1u]);
    const double fraction = coordinate - index;
    const double complete = raw_prefix_[index] - 0.5 * finitePositive(data[0]) + 0.5 * first;
    return complete + fraction * first + 0.5 * fraction * fraction * (second - first);
  }
  static double bandMean(const std::vector<double> &prefix, Band band) noexcept {
    if (band.end <= band.begin || band.end >= prefix.size())
      return 0.0;
    const double energy = prefix[band.end] - prefix[band.begin];
    return energy > 0.0 ? energy / (band.end - band.begin) : 0.0;
  }
  static double bandRms(const std::vector<double> &prefix, Band band) noexcept {
    if (band.end <= band.begin || band.end >= prefix.size())
      return 0.0;
    const double energy = prefix[band.end] - prefix[band.begin];
    return energy > 0.0 ? std::sqrt(energy / (band.end - band.begin)) : 0.0;
  }
  static float logRatio(double numerator, double denominator) noexcept {
    const double ratio = positiveRatio(numerator, denominator);
    return ratio > 0.0 ? static_cast<float>(std::log1p(ratio)) : 0.0F;
  }
  static double positiveRatio(double numerator, double denominator) noexcept {
    if (!(numerator > 0.0) || !(denominator > 0.0))
      return 0.0;
    const double ratio = std::min(numerator / denominator, 1.0e12);
    return std::isfinite(ratio) ? ratio : 0.0;
  }
  static float boundedRatio(double numerator, double denominator, double lower,
                            double upper) noexcept {
    if (!(denominator > 0.0))
      return 0.0F;
    const double ratio = numerator / denominator;
    return std::isfinite(ratio) ? static_cast<float>(std::clamp(ratio, lower, upper)) : 0.0F;
  }
  std::uint32_t fft_size_ = 0u, half_ = 0u, reference_spectrum_bins_ = 0u;
  double bin_hz_ = 0.0;
  std::vector<double> raw_prefix_;
  std::array<std::array<Query, kDetuneCount>, kPitchCount> queries_{};
  std::array<std::uint32_t, kPitchCount> center_observable_{};
  std::array<std::array<float, kFeatureCount>, kPitchCount> values_{};
  std::array<std::array<float, kHarmonicCount>, kPitchCount> ema_60ms_{}, ema_200ms_{};
  float ema_alpha_60ms_ = 0.0F, ema_alpha_200ms_ = 0.0F;
};

} // namespace effetune::plugins::analyzer

#endif

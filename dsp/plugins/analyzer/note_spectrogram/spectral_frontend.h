#ifndef EFFETUNE_NOTE_SPECTROGRAM_SPECTRAL_FRONTEND_H
#define EFFETUNE_NOTE_SPECTROGRAM_SPECTRAL_FRONTEND_H

#include "effetune/dsp/pffft_incremental.h"
#include "effetune/dsp/stage_scheduler.h"
#include "learned_features.h"
#include "pffft.h"
#include "presence.h"

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
  Map,
  PackSpectrum,
  BeginFeatureTransform,
  PackCepstrum,
  CaptureSpectrum,
  RawPrefix,
  RawFeatures,
  CfpFeatures,
  TemporalFeatures,
  FinePresence,
  FinishFinePresence,
  Initialize,
  EvaluateFirst,
  SelectCandidates,
  EvaluateCandidates,
  RefineCandidates,
  EvaluateRemaining,
  InitializePairs,
  EvaluatePairsFirst,
  SelectPairs,
  EvaluatePairsRemaining,
  SelectLowCandidates,
  PrepareFine,
  EvaluateFine,
  Finalize,
  Commit
};

// One causal resolution, shared by the short and long analysis windows.
class SpectralFrontend final {
  struct SetupDeleter {
    void operator()(PFFFT_Setup *value) const noexcept {
      if (value)
        pffft_destroy_setup(value);
    }
  };
  struct BufferDeleter {
    void operator()(float *value) const noexcept {
      if (value)
        pffft_aligned_free(value);
    }
  };
  using Buffer = std::unique_ptr<float, BufferDeleter>;
  using Transform = ::effetune::dsp::PffftOrderedRealForward;
  using Stage = NoteSpectrogramStage;
  static constexpr double kPi = 3.14159265358979323846;
  static constexpr double kFloorPower = 2.511886431509582e-10;
  static constexpr std::uint32_t kPitches = LearnedPitchFeatures::kPitchCount;

public:
  bool prepare(float rate, std::uint32_t hop, std::uint32_t window_scale) {
    rate_ = rate;
    for (auto &transform : transforms_)
      transform.reset();
    setup_.reset();
    window_length_ =
        std::clamp(static_cast<std::uint32_t>(std::round(rate * (4096.0 * window_scale) / 48000.0)),
                   32u, 65536u);
    fft_size_ = 32u;
    while (fft_size_ < window_length_)
      fft_size_ *= 2u;
    ring_size_ = fft_size_ * 2u;
    setup_.reset(pffft_new_setup(static_cast<int>(fft_size_), PFFFT_REAL));
    if (!setup_)
      return false;
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      rings_[channel] = allocate(ring_size_);
      inputs_[channel] = allocate(fft_size_);
      outputs_[channel] = allocate(fft_size_);
      work_[channel] = allocate(fft_size_);
      transforms_[channel] = std::make_unique<Transform>(setup_.get(), 64u);
      if (!rings_[channel] || !inputs_[channel] || !outputs_[channel] || !work_[channel] ||
          !transforms_[channel]->valid())
        return false;
    }
    estimator_ = std::make_unique<PresenceEstimator>();
    estimator_->prepare(rate, fft_size_, 5u, true);
    features_ = std::make_unique<LearnedPitchFeatures>();
    features_->prepare(rate, fft_size_, hop);
    window_.resize(window_length_);
    window_energy_ = 0.0;
    for (std::uint32_t sample = 0u; sample < window_length_; ++sample) {
      window_[sample] =
          static_cast<float>(0.5 * (1.0 - std::cos(2.0 * kPi * sample / window_length_)));
      window_energy_ += static_cast<double>(window_[sample]) * window_[sample];
    }
    reset();
    return true;
  }

  void reset() noexcept {
    write_position_ = 0u;
    sums_.fill(0.0);
    squares_.fill(0.0);
    sum_corrections_.fill(0.0);
    square_corrections_.fill(0.0);
    for (auto &ring : rings_)
      if (ring)
        std::fill_n(ring.get(), ring_size_, 0.0F);
    if (estimator_)
      estimator_->reset();
    if (features_)
      features_->clear();
    below_floor_ = true;
  }

  void push(float left, float right) noexcept {
    const auto leaving = (write_position_ + ring_size_ - window_length_) & (ring_size_ - 1u);
    const std::array<float, 2> incoming = {left, right};
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      const float old = rings_[channel].get()[leaving];
      const float value = incoming[channel];
      accumulate(static_cast<double>(value) - old, sums_[channel], sum_corrections_[channel]);
      accumulate(static_cast<double>(value) * value - static_cast<double>(old) * old,
                 squares_[channel], square_corrections_[channel]);
      rings_[channel].get()[write_position_] = value;
    }
    write_position_ = (write_position_ + 1u) & (ring_size_ - 1u);
  }

  bool begin(std::uint32_t channels) noexcept {
    job_channels_ = channels;
    origin_ = (write_position_ + ring_size_ - window_length_) & (ring_size_ - 1u);
    double power = 0.0;
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      const double mean = sums_[channel] / window_length_;
      power += squares_[channel] / window_length_ - mean * mean;
    }
    below_floor_ = !(power / channels >= kFloorPower);
    if (below_floor_)
      estimator_->reset();
    for (std::uint32_t channel = 0u; channel < channels; ++channel)
      if (!transforms_[channel]->begin(inputs_[channel].get(), outputs_[channel].get(),
                                       work_[channel].get()))
        return false;
    return true;
  }

  template <class Schedule>
  bool appendStages(Schedule &schedule, std::uint32_t lane, std::uint32_t slots) const {
    const auto add = [&](Stage kind, std::uint32_t channel, std::uint32_t begin, std::uint32_t end,
                         std::uint32_t weight) {
      schedule.addStage(static_cast<std::uint8_t>(kind), lane + channel, begin, end, weight);
    };
    const auto packs = std::min(64u, slots);
    const auto maps = std::min(128u, slots);
    const auto bins = fft_size_ / 2u + 1u;
    const auto steps = static_cast<std::uint32_t>(transforms_[0]->stepCount());
    if (steps == 0u)
      return false;
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t i = 0u; i < packs; ++i) {
        const auto begin =
            static_cast<std::uint32_t>(static_cast<std::uint64_t>(window_length_) * i / packs);
        const auto end = static_cast<std::uint32_t>(static_cast<std::uint64_t>(window_length_) *
                                                    (i + 1u) / packs);
        add(Stage::Pack, channel, begin, end, 15u * (end - begin));
      }
      for (std::uint32_t i = 0u; i < steps; ++i)
        // Each incremental step has a fixed work budget of 64. The step count,
        // not the per-step weight, grows with FFT size.
        add(Stage::Transform, channel, 0u, 0u, 4096u);
      for (std::uint32_t i = 0u; i < maps; ++i) {
        const auto begin = static_cast<std::uint32_t>(static_cast<std::uint64_t>(bins) * i / maps);
        const auto end =
            static_cast<std::uint32_t>(static_cast<std::uint64_t>(bins) * (i + 1u) / maps);
        add(Stage::Map, channel, begin, end, 48u * (end - begin));
      }
    }
    const auto add_bins = [&](Stage kind, std::uint32_t weight) {
      for (std::uint32_t i = 0u; i < maps; ++i) {
        const auto begin = static_cast<std::uint32_t>(static_cast<std::uint64_t>(bins) * i / maps);
        const auto end =
            static_cast<std::uint32_t>(static_cast<std::uint64_t>(bins) * (i + 1u) / maps);
        add(kind, 0u, begin, end, weight * (end - begin));
      }
    };
    const auto add_pitches = [&](Stage kind, std::uint32_t weight) {
      const auto chunks = std::min(kPitches, slots);
      for (std::uint32_t i = 0u; i < chunks; ++i) {
        const auto begin = kPitches * i / chunks;
        const auto end = kPitches * (i + 1u) / chunks;
        add(kind, 0u, begin, end, weight * (end - begin));
      }
    };
    add_bins(Stage::RawPrefix, 12u);
    add_pitches(Stage::RawFeatures, 1800u);
    add_bins(Stage::PackSpectrum, 100u);
    for (auto capture : {Stage::PackCepstrum, Stage::CaptureSpectrum}) {
      add(Stage::BeginFeatureTransform, 0u, 0u, 0u, 1u);
      for (std::uint32_t i = 0u; i < steps; ++i)
        add(Stage::Transform, 0u, 0u, 0u, 4096u);
      add_bins(capture, capture == Stage::PackCepstrum ? 100u : 16u);
    }
    add_pitches(Stage::CfpFeatures, 600u);
    add_pitches(Stage::TemporalFeatures, 80u);
    const auto fine_pitches = estimator_->gridSize();
    const auto fine_chunks = std::min(fine_pitches, slots);
    for (std::uint32_t i = 0u; i < fine_chunks; ++i) {
      const auto begin = fine_pitches * i / fine_chunks;
      const auto end = fine_pitches * (i + 1u) / fine_chunks;
      add(Stage::FinePresence, 0u, begin, end, 160u * (end - begin));
    }
    add(Stage::FinishFinePresence, 0u, 0u, 0u, 2400u);
    return true;
  }

  bool run(Stage kind, std::uint32_t channel, std::uint32_t begin, std::uint32_t end) noexcept {
    if (channel >= job_channels_)
      return true;
    auto *input = inputs_[channel].get();
    auto *output = outputs_[channel].get();
    switch (kind) {
    case Stage::Pack:
      if (begin == 0u)
        std::fill(input + window_length_, input + fft_size_, 0.0F);
      for (auto i = begin; i < end; ++i)
        input[i] = rings_[channel].get()[(origin_ + i) & (ring_size_ - 1u)] * window_[i];
      break;
    case Stage::Transform:
      return transforms_[channel]->step() >= 0;
    case Stage::Map:
      estimator_->mapPower(output, begin, end, channel, job_channels_);
      break;
    case Stage::PackSpectrum:
      estimator_->packSpectrum(input, begin, end);
      break;
    case Stage::BeginFeatureTransform:
      return transforms_[0]->begin(input, output, work_[0].get());
    case Stage::PackCepstrum:
      estimator_->packCepstrum(output, input, begin, end);
      break;
    case Stage::CaptureSpectrum:
      estimator_->captureSpectrum(output, begin, end);
      break;
    case Stage::RawPrefix:
      features_->accumulateRawPrefix(estimator_->spectrum().data(), begin, end);
      break;
    case Stage::RawFeatures:
      features_->extractRaw(estimator_->spectrum().data(), begin, end);
      break;
    case Stage::CfpFeatures:
      features_->extractCfp(estimator_->cepstrum().data(), estimator_->cepstrumPrefix(),
                            estimator_->spectrum().data(), estimator_->spectrumPrefix(), begin,
                            end);
      break;
    case Stage::TemporalFeatures:
      features_->updateTemporal(begin, end, below_floor_);
      break;
    case Stage::FinePresence:
      estimator_->evaluate(input, begin, end);
      break;
    case Stage::FinishFinePresence:
      estimator_->finishFine();
      break;
    default:
      return false;
    }
    return true;
  }

  bool belowFloor() const noexcept { return below_floor_; }
  const auto &values() const noexcept { return features_->values(); }
  const auto &finePresence() const noexcept { return estimator_->fineValues(); }
  const auto &rawPrefix() const noexcept { return features_->rawPrefix(); }
  double binHz() const noexcept { return rate_ / fft_size_; }
  double amplitudePowerScale() const noexcept {
    return window_energy_ > 0.0 ? 4.0 / (fft_size_ * window_energy_) : 0.0;
  }

private:
  static Buffer allocate(std::uint32_t size) {
    return Buffer(static_cast<float *>(pffft_aligned_malloc(sizeof(float) * size)));
  }
  static void accumulate(double delta, double &sum, double &correction) noexcept {
    const double adjusted = delta - correction;
    const double next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  std::unique_ptr<PFFFT_Setup, SetupDeleter> setup_;
  std::array<Buffer, 2> rings_, inputs_, outputs_, work_;
  std::array<std::unique_ptr<Transform>, 2> transforms_;
  std::unique_ptr<PresenceEstimator> estimator_;
  std::unique_ptr<LearnedPitchFeatures> features_;
  std::vector<float> window_;
  float rate_ = 48000.0F;
  double window_energy_ = 0.0;
  std::array<double, 2> sums_{}, squares_{}, sum_corrections_{}, square_corrections_{};
  std::uint32_t window_length_ = 0u, fft_size_ = 0u, ring_size_ = 0u;
  std::uint32_t write_position_ = 0u, origin_ = 0u, job_channels_ = 1u;
  bool below_floor_ = true;
};

} // namespace effetune::plugins::analyzer
#endif

// Tonal Balance EQ kernel: measures the programme's long-term band spectrum
// (analysis.h), derives the cut-only correction of rd-report 2.6 against the
// learned style target or the mechanical Tilt target, shaped by the five Target
// Adjust bands, realises it with the least-squares section cascade
// (design.h) and publishes telemetry frame 29.  All per-hop work runs as
// evenly scheduled stages; the audio path is a 31-section TDF2 cascade with
// per-sample coefficient interpolation and one loudness-matched make-up gain.
#include "effetune/kernel.h"
#include "../five_band_peq/peq_coefficients.h"
#include "TonalBalanceEQPluginParams.h"
#include "analysis.h"
#include "binary_io.h"
#include "calibration_tables.h"
#include "design.h"
#include "effetune/dsp/biquad.h"
#include "effetune/dsp/denormal_noise.h"
#include "effetune/dsp/k_weighting.h"
#include "effetune/dsp/pffft_incremental.h"
#include "effetune/dsp/stage_scheduler.h"
#include "target_tables.h"

#include <pffft.h>

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <new>
#include <type_traits>
#include <vector>

#if defined(ET_SIMD) && defined(__wasm_simd128__)
#include <wasm_simd128.h>
#define ET_TONAL_BALANCE_SIMD 1
#endif

namespace effetune::plugins::eq::tonal_balance {
namespace {

constexpr std::uint32_t kSlotSamples = 16u;
constexpr std::uint32_t kMaximumSlots = 512u;
constexpr std::uint32_t kMaximumStages = 4096u;
constexpr int kForwardWorkBudget = 224;
constexpr std::uint32_t kForwardStepWeight = 28u;
constexpr std::uint32_t kWindowChunkSamples = 1024u;
constexpr std::uint32_t kWindowChunkWeight = 16u;
constexpr std::uint32_t kLineariseSectionsPerStage = 4u;
constexpr std::uint32_t kNormalRowsPerStage = 8u;
constexpr std::uint32_t kResponseSectionsPerStage = 8u;
constexpr double kAveragingTimeInfinity = 100.0; // Averaging Time top value = infinity (S-25)
constexpr double kMaximumTelemetryRateHz = 15.0;
constexpr std::uint16_t kTelemetryFrameType = 29u;
constexpr std::uint16_t kTelemetryFormatVersion = 1u;
constexpr std::uint32_t kTelemetryPayloadBytes = 1564u;
constexpr std::uint32_t kAdjustBandCount =
    std::extent_v<decltype(generated::TonalBalanceEQPluginParams::adjustGain)>;
// adjustType values pk / ls / hs as makePeqCoefficients type codes.
constexpr std::array<float, 3> kAdjustTypeCodes = {0.0F, 3.0F, 4.0F};
constexpr std::uint32_t kAllStyle = 0u;                 // "All" leads the learned tables
constexpr std::uint32_t kTiltStyle = kTargetStyleCount; // S-7: past the learned tables

enum class StageKind : std::uint8_t {
  Window, // ring -> windowed FFT input, samples [begin, end)
  BeginForward,
  ForwardStep,
  Accumulate, // spectrum -> band powers of one channel
  Finish,     // hop observation -> analysis engine
  Offset,     // target offset of bands [begin, end)
  Correction, // band statistics -> command curve
  FirstPass,
  Linearise, // sections [begin, end)
  Normal,    // rows [begin, end)
  Solve,
  Sections,
  Response, // sections [begin, end)
  Publish,
};

// pffft-aligned float buffer.
class AlignedFloatBuffer final {
public:
  AlignedFloatBuffer() = default;
  AlignedFloatBuffer(const AlignedFloatBuffer &) = delete;
  AlignedFloatBuffer &operator=(const AlignedFloatBuffer &) = delete;
  ~AlignedFloatBuffer() { release(); }

  [[nodiscard]] bool allocate(std::size_t count) {
    release();
    data_ = static_cast<float *>(pffft_aligned_malloc(count * sizeof(float)));
    if (data_ == nullptr) {
      return false;
    }
    std::memset(data_, 0, count * sizeof(float));
    return true;
  }
  void release() noexcept {
    if (data_ != nullptr) {
      pffft_aligned_free(data_);
      data_ = nullptr;
    }
  }
  [[nodiscard]] float *data() noexcept { return data_; }
  [[nodiscard]] const float *data() const noexcept { return data_; }

private:
  float *data_ = nullptr;
};

using Coefficients = dsp::BiquadCoefficients;
using SectionArray = std::array<Coefficients, kSectionCount>;

void addCoefficients(SectionArray &target, const SectionArray &step) noexcept {
  for (std::uint32_t m = 0; m < kSectionCount; ++m) {
    target[m].b0 += step[m].b0;
    target[m].b1 += step[m].b1;
    target[m].b2 += step[m].b2;
    target[m].a1 += step[m].a1;
    target[m].a2 += step[m].a2;
  }
}

class TonalBalanceEQKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::TonalBalanceEQPluginParams)

public:
  TonalBalanceEQKernel() = default;
  TonalBalanceEQKernel(const TonalBalanceEQKernel &) = delete;
  TonalBalanceEQKernel &operator=(const TonalBalanceEQKernel &) = delete;
  ~TonalBalanceEQKernel() override { releaseSetup(); }

  void prepare(const PrepareInfo &info) override {
    prepared_ = false;
    releaseSetup();
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    if (!(sample_rate_ > 0.0) || !std::isfinite(sample_rate_) || max_channels_ == 0u ||
        max_channels_ > kMaximumChannels || max_frames_ == 0u) {
      return;
    }
    if (!state_) {
      state_.reset(new (std::nothrow) State());
      if (!state_) {
        return;
      }
    }
    state_->analyzer.prepare(sample_rate_);
    family_ = &kCalibrationFamilies[state_->analyzer.family()];
    state_->engine.prepare(state_->analyzer, *family_);
    if (!state_->designer.prepare(sample_rate_)) {
      return;
    }
    const std::uint32_t fft_size = state_->analyzer.fftSize();
    hop_size_ = state_->analyzer.hopSize();
    setup_ = pffft_new_setup(static_cast<int>(fft_size), PFFFT_REAL);
    if (setup_ == nullptr) {
      return;
    }
    forward_.reset(new (std::nothrow) dsp::PffftOrderedRealForward(setup_, kForwardWorkBudget));
    schedule_.reset(new (std::nothrow) Schedule());
    if (!forward_ || !forward_->valid() || !schedule_) {
      releaseSetup();
      return;
    }
    if (!fft_input_.allocate(fft_size) || !spectrum_.allocate(fft_size) ||
        !work_.allocate(fft_size)) {
      releaseSetup();
      return;
    }
    ring_size_ = 2u * fft_size;
    ring_mask_ = ring_size_ - 1u;
    ring_.assign(static_cast<std::size_t>(max_channels_) * ring_size_, 0.0F);
    prepareOffset();

    slot_count_ = hop_size_ / kSlotSamples;
    slot_count_ = slot_count_ > kMaximumSlots ? kMaximumSlots : slot_count_;
    slot_samples_ = hop_size_ / slot_count_;
    forward_step_count_ = static_cast<std::uint32_t>(forward_->stepCount());
    telemetry_interval_ =
        static_cast<std::uint64_t>(std::ceil(sample_rate_ / kMaximumTelemetryRateHz));
    kernel_sigma_ = 0.0;
    settings_applied_ = false;
    // The widest channel layout must fit the stage table; narrower ones always do.
    configureChannels(max_channels_);
    if (!schedule_valid_) {
      releaseSetup();
      return;
    }
    prepared_ = true;
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  void reset() noexcept override {
    if (!prepared_) {
      return;
    }
    state_->engine.reset();
    absolute_sample_ = 0u;
    next_hop_sample_ = hop_size_;
    next_telemetry_sample_ = 0u;
    write_position_ = 0u;
    std::memset(ring_.data(), 0, ring_.size() * sizeof(float));
    for (std::uint32_t m = 0; m < kSectionCount; ++m) {
      state_->state1[m].fill(0.0);
      state_->state2[m].fill(0.0);
    }
    state_->current.fill(Coefficients{});
    state_->target.fill(Coefficients{});
    state_->pending.fill(Coefficients{});
    state_->step.fill(Coefficients{0.0, 0.0, 0.0, 0.0, 0.0}); // the default is identity, not zero
    makeup_current_ = 1.0;
    makeup_target_ = 1.0;
    makeup_pending_ = 1.0;
    makeup_step_ = 0.0;
    makeup_db_ = 0.0;
    denormal_noise_.reset();
    state_->command_db.fill(0.0);
    state_->curve.value_db.fill(0.0);
    state_->in_range.fill(false);
    offset_dirty_ = true;
    offset_running_ = false;
    job_active_ = false;
    job_slot_ = 0u;
    has_telemetry_frame_ = false;
    telemetry_generation_ = 0u;
    last_written_generation_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }
    if (channel_count != active_channels_) {
      reset();
      configureChannels(channel_count);
    }
    if (paramsDirty() || !settings_applied_) {
      applySettings();
    }

    const bool measurement_paused = params_.measurementPaused > 0.5F;
    std::array<double, kMaximumChannels> samples{};
    for (std::uint32_t n = 0; n < frame_count; ++n) {
      const double noise = denormal_noise_.sample(n);
      for (std::uint32_t c = 0; c < channel_count; ++c) {
        float value = audio[c * frame_count + n];
        value = std::isfinite(value) ? value : 0.0F;
        // Keep preview audio out of both the current measurement and the next FFT window.
        if (!measurement_paused) {
          ring_[c * ring_size_ + write_position_] = value;
        }
        samples[c] = static_cast<double>(value) + noise;
      }
      if (!measurement_paused) {
        write_position_ = (write_position_ + 1u) & ring_mask_;
      }

      addCoefficients(state_->current, state_->step);
      makeup_current_ += makeup_step_;
      filterFrame(samples.data(), channel_count);
      for (std::uint32_t c = 0; c < channel_count; ++c) {
        audio[c * frame_count + n] = static_cast<float>(samples[c] * makeup_current_);
      }

      ++absolute_sample_;
      dsp::advanceStagedJob(job_active_, job_slot_, slot_count_, absolute_sample_,
                            job_start_sample_, slot_samples_, *schedule_,
                            [this](const dsp::SchedulerStage &stage) noexcept { runStage(stage); });
      if (absolute_sample_ == next_hop_sample_) {
        beginHop();
        next_hop_sample_ += hop_size_;
      }
    }
    denormal_noise_.advance(frame_count);
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!prepared_ || !has_telemetry_frame_ || last_written_generation_ == telemetry_generation_) {
      return;
    }
    if (writer.write(kTelemetryFrameType, kTelemetryFormatVersion, telemetry_payload_.data(),
                     static_cast<std::uint16_t>(kTelemetryPayloadBytes))) {
      last_written_generation_ = telemetry_generation_;
    }
  }

private:
  void releaseSetup() noexcept {
    forward_.reset();
    schedule_.reset();
    if (setup_ != nullptr) {
      pffft_destroy_setup(setup_);
      setup_ = nullptr;
    }
  }

  // Builds the per-hop stage list for channel_count channels.  The offset chunks
  // are capped at the largest weight of the table without them (S-6).
  void configureChannels(std::uint32_t channel_count) noexcept {
    active_channels_ = channel_count;
    buildSchedule(channel_count, 0u);
    std::uint32_t largest = 0u;
    for (std::uint32_t i = 0; i < schedule_->stageCount(); ++i) {
      const std::uint32_t weight = schedule_->stage(i).weight;
      largest = weight > largest ? weight : largest;
    }
    buildSchedule(channel_count, largest);
    schedule_valid_ = schedule_->partition(slot_count_);
  }

  // offset_cap = 0 leaves out the offset chunks.
  void buildSchedule(std::uint32_t channel_count, std::uint32_t offset_cap) noexcept {
    schedule_->clear();
    const std::uint32_t fft_size = state_->analyzer.fftSize();
    const std::uint32_t accumulate_weight = state_->analyzer.binCount() / 64u + 1u;
    for (std::uint32_t c = 0; c < channel_count; ++c) {
      for (std::uint32_t begin = 0; begin < fft_size; begin += kWindowChunkSamples) {
        const std::uint32_t end =
            begin + kWindowChunkSamples < fft_size ? begin + kWindowChunkSamples : fft_size;
        schedule_->addStage(static_cast<std::uint8_t>(StageKind::Window), c, begin, end,
                            kWindowChunkWeight);
      }
      schedule_->addStage(static_cast<std::uint8_t>(StageKind::BeginForward), c, 0u, 0u, 1u);
      for (std::uint32_t s = 0; s < forward_step_count_; ++s) {
        schedule_->addStage(static_cast<std::uint8_t>(StageKind::ForwardStep), c, s, s + 1u,
                            kForwardStepWeight);
      }
      schedule_->addStage(static_cast<std::uint8_t>(StageKind::Accumulate), c, 0u, 0u,
                          accumulate_weight);
    }
    schedule_->addStage(static_cast<std::uint8_t>(StageKind::Finish), 0u, 0u, 0u, 8u);
    if (offset_cap > 0u) {
      addOffsetStages(offset_cap);
    }
    schedule_->addStage(static_cast<std::uint8_t>(StageKind::Correction), 0u, 0u, 0u, 8u);
    schedule_->addStage(static_cast<std::uint8_t>(StageKind::FirstPass), 0u, 0u, 0u, 4u);
    const std::uint32_t sections = state_->designer.activeSectionCount();
    for (std::uint32_t begin = 0; begin < sections; begin += kLineariseSectionsPerStage) {
      schedule_->addStage(static_cast<std::uint8_t>(StageKind::Linearise), 0u, begin,
                          begin + kLineariseSectionsPerStage, 20u);
    }
    for (std::uint32_t begin = 0; begin < sections; begin += kNormalRowsPerStage) {
      schedule_->addStage(static_cast<std::uint8_t>(StageKind::Normal), 0u, begin,
                          begin + kNormalRowsPerStage, 12u);
    }
    schedule_->addStage(static_cast<std::uint8_t>(StageKind::Solve), 0u, 0u, 0u, 8u);
    schedule_->addStage(static_cast<std::uint8_t>(StageKind::Sections), 0u, 0u, 0u, 2u);
    for (std::uint32_t begin = 0; begin < sections; begin += kResponseSectionsPerStage) {
      schedule_->addStage(static_cast<std::uint8_t>(StageKind::Response), 0u, begin,
                          begin + kResponseSectionsPerStage, 12u);
    }
    schedule_->addStage(static_cast<std::uint8_t>(StageKind::Publish), 0u, 0u, 0u, 2u);
  }

  // D-1: runs of whole measured bands up to `cap` bins; a band over budget is its
  // own chunk.  Weight is one per bin: measured in wasm SIMD and scalar (Tilt plus
  // five sections, job dirty every hop) a bin costs about as much as a unit of the
  // FFT-path stages that make up most of the table, and this gave the lowest
  // per-quantum peaks of the bin-per-weight ratios tried (1, 2, 4, 8).
  void addOffsetStages(std::uint32_t cap) noexcept {
    const FrameAnalyzer &analyzer = state_->analyzer;
    const std::uint32_t measured = analyzer.measuredBandCount();
    const auto add = [&](std::uint32_t begin, std::uint32_t end, std::uint32_t bins) {
      schedule_->addStage(static_cast<std::uint8_t>(StageKind::Offset), 0u, begin, end,
                          bins > cap ? cap : bins);
    };
    std::uint32_t begin = 0u;
    std::uint32_t bins = 0u;
    for (std::uint32_t b = 0; b < measured; ++b) {
      const std::uint32_t band_bins = analyzer.bandBinEnd(b) - analyzer.bandBinBegin(b);
      if (b > begin && bins + band_bins > cap) {
        add(begin, b, bins);
        begin = b;
        bins = 0u;
      }
      bins += band_bins;
    }
    add(begin, measured, bins);
  }

  void applySettings() noexcept {
    const double averaging_time = static_cast<double>(params_.averagingTime);
    const bool infinite = averaging_time >= kAveragingTimeInfinity;
    AnalysisSettings settings;
    settings.alpha = infinite ? 0.0 : hopAlpha(averaging_time, state_->analyzer.hopSeconds());
    double tau_noise =
        infinite
            ? kMaximumNoiseTauSeconds
            : (averaging_time < kMaximumNoiseTauSeconds ? averaging_time : kMaximumNoiseTauSeconds);
    tau_noise = tau_noise < family_->evidence_seconds ? family_->evidence_seconds : tau_noise;
    settings.tau_noise_seconds = tau_noise;
    settings.alpha_noise = infinite ? 0.0 : hopAlpha(tau_noise, state_->analyzer.hopSeconds());
    settings.average_spl_db = static_cast<double>(params_.averageSpl);
    state_->engine.setSettings(settings);
    settings_applied_ = true;
    if (!sameOffsetInputs(params_, offset_inputs_)) {
      offset_inputs_ = params_;
      offset_dirty_ = true;
    }
  }

  // D-1: the offset depends on the target, the adjust bands and the tilt only.
  [[nodiscard]] static bool sameOffsetInputs(const Params &a, const Params &b) noexcept {
    bool same = a.target == b.target && a.tiltSlope == b.tiltSlope && a.tiltCorner == b.tiltCorner;
    for (std::uint32_t i = 0; i < kAdjustBandCount; ++i) {
      same = same && a.adjustEnabled[i] == b.adjustEnabled[i] &&
             a.adjustType[i] == b.adjustType[i] && a.adjustFrequency[i] == b.adjustFrequency[i] &&
             a.adjustGain[i] == b.adjustGain[i] && a.adjustQ[i] == b.adjustQ[i];
    }
    return same;
  }

  // Per-bin evaluation points of the offset job (allocates; prepare only).
  void prepareOffset() {
    const std::uint32_t bins = state_->analyzer.binCount();
    const double fft_size = static_cast<double>(state_->analyzer.fftSize());
    state_->bin_trig.assign(bins, TrigPoint{});
    state_->bin_log_hz.assign(bins, 0.0);
    for (std::uint32_t k = 0; k < bins; ++k) {
      const double index = static_cast<double>(k);
      state_->bin_trig[k] = trigAt(2.0 * kPi * index / fft_size);
      state_->bin_log_hz[k] = portableLog(index * sample_rate_ / fft_size);
    }
    state_->adjust_db.fill(0.0);
    state_->adjust_staging.fill(0.0);
    published_style_ = targetIndex();
  }

  // D-1/D-2/S-7: one chunk of the offset job.  The first chunk latches the
  // parameters, the last publishes the offsets together with the latched style.
  void evaluateOffset(std::uint32_t begin, std::uint32_t end) noexcept {
    if (begin == 0u) {
      if (!offset_dirty_) {
        return;
      }
      latchOffset();
    }
    if (!offset_running_) {
      return;
    }
    for (std::uint32_t b = begin; b < end; ++b) {
      state_->adjust_staging[b] = offset_evaluate_ ? bandOffsetDb(b) : 0.0;
    }
    if (end == state_->analyzer.measuredBandCount()) {
      state_->adjust_db = state_->adjust_staging;
      published_style_ = offset_style_;
      offset_running_ = false;
    }
  }

  void latchOffset() noexcept {
    offset_dirty_ = false;
    offset_running_ = true;
    offset_style_ = targetIndex();
    offset_tilt_ = offset_style_ == kTiltStyle;
    tilt_exponent_ = static_cast<double>(params_.tiltSlope) / 3.0;
    tilt_log_corner_ = portableLog(static_cast<double>(params_.tiltCorner));
    offset_section_count_ = 0u;
    for (std::uint32_t i = 0; i < kAdjustBandCount; ++i) {
      const double raw = std::floor(static_cast<double>(params_.adjustType[i]) + 0.5);
      const std::uint32_t type =
          raw < 0.0 ? 0u : (raw > 2.0 ? 2u : static_cast<std::uint32_t>(raw));
      if (detail::makePeqCoefficients(params_.adjustGain[i], kAdjustTypeCodes[type],
                                      params_.adjustFrequency[i], params_.adjustQ[i],
                                      params_.adjustEnabled[i], static_cast<float>(sample_rate_),
                                      state_->adjust_sections[offset_section_count_])) {
        ++offset_section_count_;
      }
    }
    offset_evaluate_ = offset_tilt_ || offset_section_count_ > 0u;
  }

  // D-2: 10 log10 of the band's mean bin power of the adjust cascade; S-7 Tilt:
  // the bin-power sum of T(f) times the cascade (no mean, base 0).
  [[nodiscard]] double bandOffsetDb(std::uint32_t band) const noexcept {
    const std::uint32_t begin = state_->analyzer.bandBinBegin(band);
    const std::uint32_t end = state_->analyzer.bandBinEnd(band);
    double sum = 0.0;
    for (std::uint32_t k = begin; k < end; ++k) {
      const double log_hz = state_->bin_log_hz[k];
      double power = offset_tilt_ && log_hz > tilt_log_corner_
                         ? portableExp(tilt_exponent_ * (log_hz - tilt_log_corner_))
                         : 1.0;
      for (std::uint32_t i = 0; i < offset_section_count_; ++i) {
        power *= responsePower(state_->adjust_sections[i], state_->bin_trig[k]);
      }
      sum += power;
    }
    return portablePowerDb(offset_tilt_ ? sum : sum / static_cast<double>(end - begin));
  }

  // Hop boundary: commits the pending design and starts the analysis job.
  void beginHop() noexcept {
    state_->current = state_->target;
    state_->target = state_->pending;
    const double inverse_hop = 1.0 / static_cast<double>(hop_size_);
    for (std::uint32_t m = 0; m < kSectionCount; ++m) {
      state_->step[m].b0 = (state_->target[m].b0 - state_->current[m].b0) * inverse_hop;
      state_->step[m].b1 = (state_->target[m].b1 - state_->current[m].b1) * inverse_hop;
      state_->step[m].b2 = (state_->target[m].b2 - state_->current[m].b2) * inverse_hop;
      state_->step[m].a1 = (state_->target[m].a1 - state_->current[m].a1) * inverse_hop;
      state_->step[m].a2 = (state_->target[m].a2 - state_->current[m].a2) * inverse_hop;
    }
    makeup_current_ = makeup_target_;
    makeup_target_ = makeup_pending_;
    makeup_step_ = (makeup_target_ - makeup_current_) * inverse_hop;

    if (job_active_) {
      return;
    }
    frame_start_ = (write_position_ + ring_size_ - state_->analyzer.fftSize()) & ring_mask_;
    state_->analyzer.beginHop(state_->observation);
    job_start_sample_ = absolute_sample_;
    job_slot_ = 0u;
    job_active_ = true;
  }

  void runStage(const dsp::SchedulerStage &stage) noexcept {
    switch (static_cast<StageKind>(stage.kind)) {
    case StageKind::Window: {
      const float *ring = ring_.data() + static_cast<std::size_t>(stage.channel) * ring_size_;
      const float *window = state_->analyzer.window();
      float *input = fft_input_.data();
      for (std::uint32_t n = stage.begin; n < stage.end; ++n) {
        input[n] = ring[(frame_start_ + n) & ring_mask_] * window[n];
      }
      break;
    }
    case StageKind::BeginForward:
      if (!forward_->begin(fft_input_.data(), spectrum_.data(), work_.data())) {
        std::memset(spectrum_.data(), 0, state_->analyzer.fftSize() * sizeof(float));
      }
      break;
    case StageKind::ForwardStep:
      (void)forward_->step();
      break;
    case StageKind::Accumulate:
      state_->analyzer.accumulateChannel(
          spectrum_.data(), dsp::k_weighting::channelWeight(stage.channel, active_channels_),
          stage.channel, state_->observation);
      break;
    case StageKind::Finish:
      state_->analyzer.finishHop(state_->observation);
      if (params_.measurementPaused <= 0.5F) {
        state_->engine.submit(state_->observation);
      }
      break;
    case StageKind::Offset:
      evaluateOffset(stage.begin, stage.end);
      break;
    case StageKind::Correction:
      computeCorrection();
      state_->designer.setTargets(state_->curve);
      break;
    case StageKind::FirstPass:
      state_->designer.firstPass();
      break;
    case StageKind::Linearise:
      state_->designer.linearise(stage.begin, stage.end);
      break;
    case StageKind::Normal:
      state_->designer.normal(stage.begin, stage.end);
      break;
    case StageKind::Solve:
      state_->designer.solve();
      break;
    case StageKind::Sections:
      state_->designer.designSections();
      break;
    case StageKind::Response:
      state_->designer.accumulateResponse(stage.begin, stage.end);
      break;
    case StageKind::Publish:
      state_->designer.finishResponse();
      computeMakeup();
      state_->pending = state_->designer.coefficients();
      makeup_pending_ = portableDecadePower(makeup_db_ / 20.0);
      if (absolute_sample_ >= next_telemetry_sample_) {
        buildTelemetry();
        next_telemetry_sample_ = absolute_sample_ + telemetry_interval_;
      }
      break;
    }
  }

  [[nodiscard]] std::uint32_t targetIndex() const noexcept {
    const double raw = std::floor(static_cast<double>(params_.target) + 0.5);
    const double limit = static_cast<double>(kTiltStyle);
    const double clamped = raw < 0.0 ? 0.0 : (raw > limit ? limit : raw);
    return static_cast<std::uint32_t>(clamped);
  }

  // D-3 / S-7 target terms of the published style.
  [[nodiscard]] bool targetHasTarget(std::uint32_t style, std::uint32_t band) const noexcept {
    return style == kTiltStyle ? band < state_->analyzer.measuredBandCount()
                               : kTargetHasTarget[style][band] != 0u;
  }
  [[nodiscard]] double targetMuDb(std::uint32_t style, std::uint32_t band) const noexcept {
    return (style == kTiltStyle ? 0.0 : kTargetMuDb[style][band]) + state_->adjust_db[band];
  }
  [[nodiscard]] double targetShrinkSigmaDb(std::uint32_t style, std::uint32_t band) const noexcept {
    return kTargetSigmaDb[style == kTiltStyle ? kAllStyle : style][band];
  }
  [[nodiscard]] double targetFrameSigmaDb(std::uint32_t style, std::uint32_t band) const noexcept {
    return style == kTiltStyle ? 0.0 : kTargetSigmaDb[style][band];
  }
  [[nodiscard]] double targetSeMuDb(std::uint32_t style, std::uint32_t band) const noexcept {
    return style == kTiltStyle ? 0.0 : kTargetSeMuDb[style][band];
  }

  // Gaussian smoothing kernel over band distance in octaves (rebuilt when
  // Smoothing changes).
  void ensureKernel(double sigma_octaves) noexcept {
    if (sigma_octaves == kernel_sigma_) {
      return;
    }
    kernel_sigma_ = sigma_octaves;
    const std::array<double, kBandCount> &log2 = state_->designer.log2BandCentres();
    const double inverse = 1.0 / sigma_octaves;
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      for (std::uint32_t k = 0; k <= b; ++k) {
        const double z = (log2[b] - log2[k]) * inverse;
        const double value = portableExp(-0.5 * z * z);
        state_->kernel[b][k] = value;
        state_->kernel[k][b] = value;
      }
    }
  }

  // rd-report 2.6: alignment, clipped deficit, shrinkage, presence-weighted
  // smoothing, Amount, cut-only shift and edge hold.
  void computeCorrection() noexcept {
    const std::uint32_t style = published_style_;
    const double amount = static_cast<double>(params_.amount) / 100.0;
    const double range = static_cast<double>(params_.range);
    const double low = static_cast<double>(params_.low);
    const double high = static_cast<double>(params_.high);
    ensureKernel(static_cast<double>(params_.smoothing));
    const std::uint32_t measured = state_->engine.measuredBandCount();

    std::array<bool, kBandCount> participating{};
    std::array<double, kBandCount> presence{};
    std::array<double, kBandCount> deficit{};
    double sum_presence = 0.0;
    double sum_persistence = 0.0;
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      const BandStatistics &band = state_->engine.band(b);
      const double centre_hz = state_->analyzer.centreHz(b);
      state_->in_range[b] = centre_hz >= low && centre_hz <= high;
      participating[b] = b < measured && band.has_level && targetHasTarget(style, b);
      presence[b] = band.persistence * band.content;
      if (participating[b] && state_->in_range[b]) {
        sum_presence += presence[b];
        sum_persistence += band.persistence;
      }
    }

    // 1. Alignment offset.
    const bool unit_weights = !(sum_persistence > 0.0);
    const double coverage = unit_weights ? 0.0 : sum_presence / sum_persistence;
    double weighted = 0.0;
    double weight_sum = 0.0;
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      if (!participating[b] || !state_->in_range[b]) {
        continue;
      }
      const double w =
          unit_weights ? 1.0 : presence[b] + (1.0 - coverage) * state_->engine.band(b).persistence;
      weighted += w * (targetMuDb(style, b) - state_->engine.levelDb(b));
      weight_sum += w;
    }
    const double offset = weight_sum > 0.0 ? weighted / weight_sum : 0.0;

    // 2. Clipped deficit with shrinkage.
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      if (!participating[b] || !state_->in_range[b]) {
        continue;
      }
      double d = targetMuDb(style, b) - state_->engine.levelDb(b) - offset;
      d = d > range ? range : (d < -range ? -range : d);
      const double sigma = targetShrinkSigmaDb(style, b);
      const double sigma2 = sigma * sigma;
      const double count = state_->engine.effectiveCount(b);
      const double se2 = count > 0.0 ? state_->engine.band(b).level_variance / count : 0.0;
      const double se_mu = targetSeMuDb(style, b);
      const double se_mu2 = se_mu * se_mu;
      deficit[b] = d * sigma2 / (sigma2 + se2 + se_mu2);
    }

    // 3-4. Presence-weighted smoothing over the corrected range, Amount.
    std::uint32_t first = kBandCount;
    std::uint32_t last = kBandCount;
    double maximum = 0.0;
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      if (!state_->in_range[b]) {
        state_->command_db[b] = 0.0;
        continue;
      }
      double numerator = 0.0;
      double denominator = 0.0;
      for (std::uint32_t k = 0; k < kBandCount; ++k) {
        if (!state_->in_range[k]) {
          continue;
        }
        const double weight = deficit[k] > 0.0 ? presence[k] : 1.0;
        numerator += state_->kernel[b][k] * weight * deficit[k];
        denominator += state_->kernel[b][k];
      }
      state_->command_db[b] = amount * numerator / denominator;
      if (first == kBandCount) {
        first = b;
        maximum = state_->command_db[b];
      }
      last = b;
      maximum = state_->command_db[b] > maximum ? state_->command_db[b] : maximum;
    }

    // 4-5. Cut-only shift and edge hold.
    if (first == kBandCount) {
      state_->curve.value_db.fill(0.0);
      return;
    }
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      const std::uint32_t source = b < first ? first : (b > last ? last : b);
      state_->curve.value_db[b] = state_->command_db[source] - maximum;
    }
  }

  // rd-report 2.6 (7): K-weighted loudness of the output equals that of the
  // input; bounded by 2 * Amount * Range.
  void computeMakeup() noexcept {
    const std::array<double, kGridCount> &power = state_->engine.integratedCellPower();
    const std::array<double, kGridCount> &response = state_->designer.responsePower();
    double weighted = 0.0;
    double total = 0.0;
    for (std::uint32_t i = 0; i < kGridCount; ++i) {
      weighted += power[i] * response[i];
      total += power[i];
    }
    double gain_db = 0.0;
    if (total > 0.0 && weighted > 0.0) {
      gain_db = -portablePowerDb(weighted / total);
    }
    const double cap =
        2.0 * (static_cast<double>(params_.amount) / 100.0) * static_cast<double>(params_.range);
    makeup_db_ = gain_db > cap ? cap : gain_db;
  }

  void buildTelemetry() noexcept {
    std::uint8_t *out = telemetry_payload_.data();
    std::memset(out, 0, kTelemetryPayloadBytes);
    const std::uint32_t style = published_style_;
    bool target_valid = false;
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      target_valid = target_valid || targetHasTarget(style, b);
    }
    std::uint8_t state = 0u;
    state |= state_->engine.absoluteGate() ? 0x01u : 0u;
    state |= state_->engine.relativeGate() ? 0x02u : 0u;
    state |= state_->engine.loudnessValid() ? 0x04u : 0u;
    state |= target_valid ? 0x08u : 0u;
    binary_io::writeF32(out + 0u, static_cast<float>(sample_rate_));
    binary_io::writeU16(out + 4u, static_cast<std::uint16_t>(kBandCount));
    binary_io::writeU16(out + 6u, static_cast<std::uint16_t>(kGridCount));
    out[8] = state;
    out[9] = static_cast<std::uint8_t>(style);
    binary_io::writeF32(out + 12u, state_->engine.loudnessValid()
                                       ? static_cast<float>(state_->engine.integratedLoudnessLkfs())
                                       : 0.0F);
    binary_io::writeF32(out + 16u, static_cast<float>(makeup_db_));
    binary_io::writeU32(out + 20u, state_->engine.gatedHopCount());
    const std::array<double, kGridCount> &response = state_->designer.responseDb();
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      const BandStatistics &band = state_->engine.band(b);
      const bool has_target = targetHasTarget(style, b);
      const bool has_level = b < state_->engine.measuredBandCount() && band.has_level;
      binary_io::writeF32(out + 24u + 4u * b,
                          has_level ? static_cast<float>(state_->engine.levelSplDb(b)) : 0.0F);
      binary_io::writeF32(out + 188u + 4u * b, static_cast<float>(band.persistence));
      binary_io::writeF32(out + 352u + 4u * b, static_cast<float>(band.persistence * band.content));
      binary_io::writeF32(out + 516u + 4u * b, static_cast<float>(state_->command_db[b]));
      binary_io::writeF32(out + 680u + 4u * b,
                          has_target ? static_cast<float>(targetMuDb(style, b)) : 0.0F);
      binary_io::writeF32(out + 844u + 4u * b,
                          has_target ? static_cast<float>(targetFrameSigmaDb(style, b)) : 0.0F);
      std::uint8_t flags = 0u;
      flags |= band.stationary ? 0x01u : 0u;
      flags |= band.floor ? 0x02u : 0u;
      flags |= has_target ? 0x04u : 0u;
      flags |= has_level ? 0x08u : 0u;
      flags |= state_->in_range[b] ? 0x10u : 0u;
      out[1008u + b] = flags;
    }
    for (std::uint32_t i = 0; i < kGridCount; ++i) {
      binary_io::writeF32(out + 1052u + 4u * i, static_cast<float>(response[i] + makeup_db_));
    }
    has_telemetry_frame_ = true;
    ++telemetry_generation_;
  }

  // 31-section TDF2 cascade over all channels, in place on samples[].
  void filterFrame(double *samples, std::uint32_t channel_count) noexcept {
#if defined(ET_TONAL_BALANCE_SIMD)
    if (channel_count & 1u) {
      samples[channel_count] = 0.0;
    }
    const std::uint32_t pairs = (channel_count + 1u) / 2u;
    for (std::uint32_t m = 0; m < kSectionCount; ++m) {
      const Coefficients &c = state_->current[m];
      const v128_t b0 = wasm_f64x2_splat(c.b0);
      const v128_t b1 = wasm_f64x2_splat(c.b1);
      const v128_t b2 = wasm_f64x2_splat(c.b2);
      const v128_t a1 = wasm_f64x2_splat(c.a1);
      const v128_t a2 = wasm_f64x2_splat(c.a2);
      double *s1 = state_->state1[m].data();
      double *s2 = state_->state2[m].data();
      for (std::uint32_t p = 0; p < pairs; ++p) {
        double *x = samples + 2u * p;
        const v128_t input = wasm_v128_load(x);
        const v128_t state1 = wasm_v128_load(s1 + 2u * p);
        const v128_t state2 = wasm_v128_load(s2 + 2u * p);
        const v128_t output = wasm_f64x2_add(wasm_f64x2_mul(b0, input), state1);
        const v128_t next1 = wasm_f64x2_add(
            wasm_f64x2_sub(wasm_f64x2_mul(b1, input), wasm_f64x2_mul(a1, output)), state2);
        const v128_t next2 = wasm_f64x2_sub(wasm_f64x2_mul(b2, input), wasm_f64x2_mul(a2, output));
        wasm_v128_store(s1 + 2u * p, next1);
        wasm_v128_store(s2 + 2u * p, next2);
        wasm_v128_store(x, output);
      }
    }
#else
    for (std::uint32_t m = 0; m < kSectionCount; ++m) {
      const Coefficients &c = state_->current[m];
      double *s1 = state_->state1[m].data();
      double *s2 = state_->state2[m].data();
      for (std::uint32_t ch = 0; ch < channel_count; ++ch) {
        const double input = samples[ch];
        const double output = c.b0 * input + s1[ch];
        const double next1 = c.b1 * input - c.a1 * output + s2[ch];
        const double next2 = c.b2 * input - c.a2 * output;
        s1[ch] = next1;
        s2[ch] = next2;
        samples[ch] = output;
      }
    }
#endif
  }

  // Configuration
  bool prepared_ = false;
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t hop_size_ = 0u;
  std::uint32_t slot_count_ = 1u;
  std::uint32_t slot_samples_ = kSlotSamples;
  std::uint32_t forward_step_count_ = 0u;
  std::uint64_t telemetry_interval_ = 1u;
  const CalibrationFamily *family_ = nullptr;

  // The kernel object must fit the engine's fixed instance slot, so the large
  // analysis, design and filter state lives on the heap, allocated once in prepare().
  struct State final {
    FrameAnalyzer analyzer;
    AnalysisEngine engine;
    HopObservation observation;
    std::array<std::array<double, kBandCount>, kBandCount> kernel{};
    std::array<double, kBandCount> command_db{};
    std::array<bool, kBandCount> in_range{};
    CorrectionCurve curve;
    CascadeDesigner designer;
    SectionArray current{};
    SectionArray target{};
    SectionArray pending{};
    SectionArray step{};
    std::array<std::array<double, kMaximumChannels + 1u>, kSectionCount> state1{};
    std::array<std::array<double, kMaximumChannels + 1u>, kSectionCount> state2{};
    std::vector<TrigPoint> bin_trig; // per analysis bin, at prepare
    std::vector<double> bin_log_hz;  // ln f_k, at prepare
    std::array<Coefficients, kAdjustBandCount> adjust_sections{};
    std::array<double, kBandCount> adjust_staging{};
    std::array<double, kBandCount> adjust_db{}; // published with published_style_
  };
  std::unique_ptr<State> state_;

  // Analysis
  PFFFT_Setup *setup_ = nullptr;
  std::unique_ptr<dsp::PffftOrderedRealForward> forward_;
  AlignedFloatBuffer fft_input_;
  AlignedFloatBuffer spectrum_;
  AlignedFloatBuffer work_;
  std::vector<float> ring_;
  std::uint32_t ring_size_ = 0u;
  std::uint32_t ring_mask_ = 0u;
  std::uint32_t write_position_ = 0u;
  std::uint32_t frame_start_ = 0u;
  bool settings_applied_ = false;

  // Scheduling
  using Schedule = dsp::StageSchedule<kMaximumStages, kMaximumSlots>;
  std::unique_ptr<Schedule> schedule_;
  bool schedule_valid_ = false;
  std::uint32_t active_channels_ = 0u;
  std::uint64_t absolute_sample_ = 0u;
  std::uint64_t next_hop_sample_ = 0u;
  std::uint64_t job_start_sample_ = 0u;
  std::uint64_t next_telemetry_sample_ = 0u;
  bool job_active_ = false;
  std::uint32_t job_slot_ = 0u;

  // Correction and design
  double kernel_sigma_ = 0.0;
  double makeup_db_ = 0.0;

  // Target offset job (D-1)
  Params offset_inputs_{};
  bool offset_dirty_ = true;
  bool offset_running_ = false;
  bool offset_tilt_ = false;
  bool offset_evaluate_ = false;
  std::uint32_t offset_style_ = 0u;
  std::uint32_t published_style_ = 0u;
  std::uint32_t offset_section_count_ = 0u;
  double tilt_exponent_ = 0.0;
  double tilt_log_corner_ = 0.0;

  // Audio path
  double makeup_current_ = 1.0;
  double makeup_target_ = 1.0;
  double makeup_pending_ = 1.0;
  double makeup_step_ = 0.0;
  dsp::NyquistDenormalNoise denormal_noise_;

  // Telemetry
  std::array<std::uint8_t, kTelemetryPayloadBytes> telemetry_payload_{};
  bool has_telemetry_frame_ = false;
  std::uint32_t telemetry_generation_ = 0u;
  std::uint32_t last_written_generation_ = 0u;
};

static_assert(sizeof(TonalBalanceEQKernel) <= 8192u);

} // namespace
} // namespace effetune::plugins::eq::tonal_balance

EFFETUNE_REGISTER_KERNEL(TonalBalanceEQPlugin,
                         effetune::plugins::eq::tonal_balance::TonalBalanceEQKernel)

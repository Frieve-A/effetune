#include "effetune/kernel.h"
#include "SpectrogramPluginParams.h"
#include "binary_io.h"
#include "effetune/dsp/pffft_incremental.h"
#include "effetune/dsp/stage_scheduler.h"

#include "pffft.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
#include <vector>

namespace effetune::plugins::analyzer {
namespace {

constexpr std::uint16_t kTapSpectrogramColumn = 5u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kPayloadHeaderBytes = 12u;
constexpr std::uint32_t kCellCount = 256u;
constexpr std::uint32_t kPayloadBytes = kPayloadHeaderBytes + kCellCount;
constexpr std::uint32_t kPendingColumnCapacity = 128u;
constexpr std::uint32_t kMinimumPoints = 8u;
constexpr std::uint32_t kMaximumPoints = 14u;
constexpr std::uint32_t kSetupCount = kMaximumPoints - kMinimumPoints + 1u;
constexpr std::uint32_t kMaximumFftSize = 1u << kMaximumPoints;
constexpr std::uint32_t kMaximumBinCount = kMaximumFftSize >> 1u;
constexpr std::uint32_t kWindowFloatCount = (kMaximumFftSize << 1u) - 256u;
constexpr std::uint32_t kSlotSamples = 16u;
constexpr int kTransformWorkBudget = 64;
constexpr std::uint32_t kMaximumSlots = (kMaximumFftSize >> 1u) / kSlotSamples;
constexpr std::uint32_t kMaximumLinearPassCount = 3u;
constexpr std::uint32_t kStageCapacity = kMaximumSlots;
constexpr double kPi = 3.14159265358979323846264338327950288;
constexpr double kPowerFloor = 1.0e-24;
constexpr double kCorrectionAcDb = 12.041199826559248;
constexpr double kCorrectionDcDb = 6.020599913279624;
constexpr double kMinimumLevelDb = -144.0;
constexpr double kMinimumDisplayFrequency = 20.0;
constexpr double kLogMinimumFrequency = 1.3010299956639811952;
constexpr double kLogMaximumFrequency = 4.6020599913279623904;
constexpr double kLogFrequencyRange = kLogMaximumFrequency - kLogMinimumFrequency;

using binary_io::writeF32;
using binary_io::writeU16;
using binary_io::writeU32;

enum class StageKind : std::uint8_t {
  PackAnalysis,
  ForwardTransformStep,
  BinLevels,
  BuildColumn,
  CommitColumn,
};

struct LinearStagePlan {
  std::uint32_t itemCount = 0u;
  std::uint32_t maximumChunks = 0u;
  std::uint32_t workPerItem = 0u;
  std::uint32_t chunks = 1u;
};

template <std::size_t Count>
[[nodiscard]] bool refineLinearStagePlan(std::array<LinearStagePlan, Count> &plan,
                                         std::size_t pass_count,
                                         std::uint32_t target_chunks) noexcept {
  static_assert(Count > 0u);
  if (pass_count == 0u || pass_count > Count) {
    return false;
  }
  std::uint32_t chunk_count = static_cast<std::uint32_t>(pass_count);
  if (target_chunks < chunk_count) {
    target_chunks = chunk_count;
  }

  for (std::size_t index = 0u; index < pass_count; ++index) {
    const LinearStagePlan &pass = plan[index];
    if (pass.itemCount == 0u || pass.maximumChunks == 0u || pass.maximumChunks > pass.itemCount ||
        pass.workPerItem == 0u) {
      return false;
    }
  }

  while (chunk_count < target_chunks) {
    std::size_t candidate = pass_count;
    std::uint64_t candidate_peak = 0u;
    for (std::size_t index = 0u; index < pass_count; ++index) {
      const LinearStagePlan &pass = plan[index];
      if (pass.chunks >= pass.maximumChunks) {
        continue;
      }
      const std::uint64_t items_per_chunk =
          (static_cast<std::uint64_t>(pass.itemCount) + pass.chunks - 1u) / pass.chunks;
      const std::uint64_t peak = items_per_chunk * pass.workPerItem;
      if (candidate == Count || peak > candidate_peak) {
        candidate = index;
        candidate_peak = peak;
      }
    }
    if (candidate == pass_count) {
      return false;
    }
    ++plan[candidate].chunks;
    ++chunk_count;
  }
  return true;
}

} // namespace

class SpectrogramKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::SpectrogramPluginParams)

public:
  ~SpectrogramKernel() override { releaseResources(); }

  void prepare(const PrepareInfo &info) override {
    releaseResources();
    sample_rate_ = info.sampleRate > 0.0F ? info.sampleRate : 48000.0F;

    if (stage_schedule_ == nullptr) {
      stage_schedule_.reset(new (std::nothrow) StageSchedule());
    }

    ring_ = allocateFloats(kMaximumFftSize * 2u);
    fft_input_ = allocateFloats(kMaximumFftSize);
    fft_output_ = allocateFloats(kMaximumFftSize);
    fft_work_ = allocateFloats(kMaximumFftSize);
    windows_ = allocateFloats(kWindowFloatCount);
    spectrum_ = allocateFloats(kMaximumBinCount);
    published_columns_.resize(kPendingColumnCapacity);
    for (std::vector<std::uint8_t> &column : published_columns_) {
      column.resize(kPayloadBytes);
    }
    staging_column_.resize(kPayloadBytes);

    ready_ = stage_schedule_ != nullptr && ring_ != nullptr && fft_input_ != nullptr &&
             fft_output_ != nullptr && fft_work_ != nullptr && windows_ != nullptr &&
             spectrum_ != nullptr && published_columns_.size() == kPendingColumnCapacity &&
             staging_column_.size() == kPayloadBytes;
    for (const std::vector<std::uint8_t> &column : published_columns_) {
      ready_ = ready_ && column.size() == kPayloadBytes;
    }
    for (std::uint32_t index = 0u; index < kSetupCount; ++index) {
      const std::uint32_t fft_size = 1u << (kMinimumPoints + index);
      real_setups_[index] = pffft_new_setup(static_cast<int>(fft_size), PFFFT_REAL);
      if (real_setups_[index] != nullptr) {
        incremental_transforms_[index].reset(
            new (std::nothrow)::effetune::dsp::PffftOrderedRealForward(real_setups_[index],
                                                                       kTransformWorkBudget));
      }
      if (real_setups_[index] == nullptr || incremental_transforms_[index] == nullptr ||
          !incremental_transforms_[index]->valid()) {
        ready_ = false;
      }
    }
    if (ready_) {
      prepareWindows();
      prepareDisplayFrequencies();
    }
    parameter_state_initialized_ = false;
    reset();
  }

  void reset() noexcept override {
    active_db_range_ = parameter_state_initialized_ ? active_db_range_ : -96.0F;
    const std::uint32_t points = parameter_state_initialized_ ? active_points_ : 12u;
    initializeAnalysis(points);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &info) noexcept override {
    if (audio == nullptr || channel_count == 0u || frame_count == 0u || !ready_) {
      return;
    }
    synchronizeParameters();

    std::uint32_t frame = 0u;
    while (frame < frame_count) {
      std::uint32_t run = frame_count - frame;
      if (samples_until_frame_ < run) {
        run = samples_until_frame_;
      }
      if (job_active_ && job_samples_until_slot_ < run) {
        run = job_samples_until_slot_;
      }
      const std::uint32_t end = frame + run;
      for (; frame < end; ++frame) {
        const float left = audio[frame];
        const float right = channel_count > 1u ? audio[frame_count + frame] : left;
        ring_[write_position_] = (left + right) * 0.5F;
        write_position_ = (write_position_ + 1u) & ring_mask_;
      }

      samples_until_frame_ -= run;
      if (job_active_) {
        job_samples_until_slot_ -= run;
        if (job_samples_until_slot_ == 0u) {
          advanceStagedJob();
        }
      }
      if (samples_until_frame_ == 0u) {
        const double frame_time = info.timeSeconds + static_cast<double>(frame) / sample_rate_;
        startStagedJob(frame_time);
        samples_until_frame_ = fft_size_ >> 1u;
      }
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!ready_) {
      return;
    }
    while (pending_column_count_ != 0u) {
      const std::uint8_t *payload = published_columns_[pending_read_column_].data();
      if (!writer.write(kTapSpectrogramColumn, kTelemetryVersion, payload,
                        static_cast<std::uint16_t>(kPayloadBytes))) {
        return;
      }
      pending_read_column_ = (pending_read_column_ + 1u) % kPendingColumnCapacity;
      --pending_column_count_;
    }
  }

private:
  static float *allocateFloats(std::uint32_t count) noexcept {
    return static_cast<float *>(pffft_aligned_malloc(sizeof(float) * count));
  }

  static void releaseFloats(float *&buffer) noexcept {
    if (buffer != nullptr) {
      pffft_aligned_free(buffer);
      buffer = nullptr;
    }
  }

  void releaseResources() noexcept {
    for (auto &transform : incremental_transforms_) {
      transform.reset();
    }
    for (PFFFT_Setup *&setup : real_setups_) {
      if (setup != nullptr) {
        pffft_destroy_setup(setup);
        setup = nullptr;
      }
    }
    releaseFloats(ring_);
    releaseFloats(fft_input_);
    releaseFloats(fft_output_);
    releaseFloats(fft_work_);
    active_transform_ = nullptr;
    job_transform_ = nullptr;
    releaseFloats(windows_);
    releaseFloats(spectrum_);
    published_columns_.clear();
    staging_column_.clear();
    ready_ = false;
  }

  void prepareWindows() noexcept {
    for (std::uint32_t points = kMinimumPoints; points <= kMaximumPoints; ++points) {
      const std::uint32_t fft_size = 1u << points;
      float *window = windows_ + fft_size - (1u << kMinimumPoints);
      const double factor = 2.0 * kPi / static_cast<double>(fft_size);
      for (std::uint32_t index = 0u; index < fft_size; ++index) {
        window[index] =
            static_cast<float>(0.5 * (1.0 - std::cos(factor * static_cast<double>(index))));
      }
    }
  }

  void prepareDisplayFrequencies() noexcept {
    for (std::uint32_t y = 0u; y < kCellCount; ++y) {
      display_frequencies_[y] =
          std::pow(10.0, kLogMaximumFrequency -
                             (static_cast<double>(y) / static_cast<double>(kCellCount - 1u)) *
                                 kLogFrequencyRange);
    }
  }

  void synchronizeParameters() noexcept {
    if (!parameter_state_initialized_) {
      initializeAnalysis(12u);
    }
    if (!paramsDirty()) {
      return;
    }

    float requested_range = params_.dBRange;
    if (!std::isfinite(requested_range)) {
      requested_range = -96.0F;
    } else if (requested_range < -144.0F) {
      requested_range = -144.0F;
    } else if (requested_range > -48.0F) {
      requested_range = -48.0F;
    }
    active_db_range_ = requested_range;

    int requested_points = 12;
    if (std::isfinite(params_.points)) {
      requested_points = static_cast<int>(params_.points);
    }
    if (requested_points < static_cast<int>(kMinimumPoints)) {
      requested_points = static_cast<int>(kMinimumPoints);
    } else if (requested_points > static_cast<int>(kMaximumPoints)) {
      requested_points = static_cast<int>(kMaximumPoints);
    }
    const std::uint32_t points = static_cast<std::uint32_t>(requested_points);
    if (points != active_points_) {
      initializeAnalysis(points);
    }
  }

  void initializeAnalysis(std::uint32_t points) noexcept {
    resetStagedJob();
    if (stage_schedule_ != nullptr) {
      stage_schedule_->clear();
    }
    active_points_ = points;
    fft_size_ = 1u << active_points_;
    ring_size_ = fft_size_ * 2u;
    ring_mask_ = ring_size_ - 1u;
    active_transform_ = incremental_transforms_[active_points_ - kMinimumPoints].get();
    window_ = windows_ == nullptr ? nullptr : windows_ + fft_size_ - (1u << kMinimumPoints);
    write_position_ = 0u;
    samples_until_frame_ = fft_size_ >> 1u;
    slot_count_ = samples_until_frame_ / kSlotSamples;
    if (slot_count_ == 0u) {
      slot_count_ = 1u;
    } else if (slot_count_ > kMaximumSlots) {
      slot_count_ = kMaximumSlots;
    }
    pending_read_column_ = 0u;
    pending_write_column_ = 0u;
    pending_column_count_ = 0u;
    parameter_state_initialized_ = true;
    if (!ready_) {
      return;
    }
    for (std::uint32_t index = 0u; index < ring_size_; ++index) {
      ring_[index] = 0.0F;
    }
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      fft_input_[index] = 0.0F;
      fft_output_[index] = 0.0F;
      fft_work_[index] = 0.0F;
    }
    for (std::uint32_t bin = 0u; bin < (fft_size_ >> 1u); ++bin) {
      spectrum_[bin] = static_cast<float>(kMinimumLevelDb);
    }
    std::fill(staging_column_.begin(), staging_column_.end(), std::uint8_t{0});
    if (!buildStageSchedule()) {
      ready_ = false;
    }
  }

  void addStage(StageKind kind, std::uint32_t channel, std::uint32_t begin, std::uint32_t end,
                std::uint32_t weight) noexcept {
    stage_schedule_->addStage(static_cast<std::uint8_t>(kind), channel, begin, end, weight);
  }

  void addLinearStages(StageKind kind, std::uint32_t channel, std::uint32_t end,
                       std::uint32_t chunk_count, std::uint32_t work_per_item) noexcept {
    for (std::uint32_t chunk = 0u; chunk < chunk_count; ++chunk) {
      const std::uint32_t begin =
          static_cast<std::uint32_t>(static_cast<std::uint64_t>(end) * chunk / chunk_count);
      const std::uint32_t chunk_end =
          static_cast<std::uint32_t>(static_cast<std::uint64_t>(end) * (chunk + 1u) / chunk_count);
      addStage(kind, channel, begin, chunk_end, work_per_item * (chunk_end - begin));
    }
  }

  [[nodiscard]] bool buildStageSchedule() noexcept {
    stage_schedule_->clear();
    const std::uint32_t packed_size = fft_size_ >> 1u;
    const std::uint32_t transform_steps =
        active_transform_ == nullptr ? 0u
                                     : static_cast<std::uint32_t>(active_transform_->stepCount());
    if (transform_steps == 0u) {
      return false;
    }
    const std::uint32_t pack_deadline_slots = fft_size_ / kSlotSamples;
    const std::uint32_t maximum_pack_chunks =
        packed_size < pack_deadline_slots ? packed_size : pack_deadline_slots;
    std::array<LinearStagePlan, kMaximumLinearPassCount> plan{};
    std::size_t pass_count = 0u;
    const std::size_t pack_pass = pass_count++;
    plan[pack_pass] = {packed_size, maximum_pack_chunks, 15u};
    const std::size_t bin_pass = pass_count++;
    plan[bin_pass] = {packed_size, packed_size, 48u};
    const std::size_t column_pass = pass_count++;
    plan[column_pass] = {kCellCount, kCellCount, 32u};
    const std::uint32_t fixed_stage_count = transform_steps + 1u;
    const std::uint32_t target_linear_chunks = slot_count_ > fixed_stage_count
                                                   ? slot_count_ - fixed_stage_count
                                                   : static_cast<std::uint32_t>(pass_count);
    if (!refineLinearStagePlan(plan, pass_count, target_linear_chunks)) {
      return false;
    }

    // Packing is first in execution order. Its chunk cap keeps the captured window copied before
    // the doubled ring can overwrite its oldest sample.
    addLinearStages(StageKind::PackAnalysis, 0u, packed_size, plan[pack_pass].chunks, 15u);
    for (std::uint32_t step = 0u; step < transform_steps; ++step) {
      addStage(StageKind::ForwardTransformStep, 0u, step, step + 1u, fft_size_);
    }
    addLinearStages(StageKind::BinLevels, 0u, packed_size, plan[bin_pass].chunks, 48u);
    addLinearStages(StageKind::BuildColumn, 0u, kCellCount, plan[column_pass].chunks, 32u);
    addStage(StageKind::CommitColumn, 0u, 0u, 0u, 1u);
    return stage_schedule_->stageCount() >= slot_count_ && stage_schedule_->partition(slot_count_);
  }

  void resetStagedJob() noexcept {
    job_active_ = false;
    job_slot_ = 0u;
    job_samples_until_slot_ = 0u;
    job_origin_ = 0u;
    job_points_ = 0u;
    job_fft_size_ = 0u;
    job_db_range_ = -96.0F;
    job_normalization_db_ = 0.0;
    job_frame_time_ = 0.0;
    job_transform_ = nullptr;
    job_window_ = nullptr;
  }

  void packAnalysis(std::uint32_t begin, std::uint32_t end) noexcept {
    for (std::uint32_t packed_index = begin; packed_index < end; ++packed_index) {
      const std::uint32_t even_index = 2u * packed_index;
      const std::uint32_t odd_index = even_index + 1u;
      const std::uint32_t even_source = job_origin_ + even_index < ring_size_
                                            ? job_origin_ + even_index
                                            : job_origin_ + even_index - ring_size_;
      const std::uint32_t odd_source = job_origin_ + odd_index < ring_size_
                                           ? job_origin_ + odd_index
                                           : job_origin_ + odd_index - ring_size_;
      fft_input_[even_index] = ring_[even_source] * job_window_[even_index];
      fft_input_[odd_index] = ring_[odd_source] * job_window_[odd_index];
    }
  }

  void forwardTransformStep() noexcept {
    if (job_transform_ == nullptr || job_transform_->step() < 0) {
      ready_ = false;
      job_active_ = false;
    }
  }

  void calculateBinLevels(std::uint32_t begin, std::uint32_t end) noexcept {
    for (std::uint32_t bin = begin; bin < end; ++bin) {
      const std::uint32_t real_index = bin == 0u ? 0u : bin * 2u;
      const double real = static_cast<double>(fft_output_[real_index]);
      const double imaginary = bin == 0u ? 0.0 : static_cast<double>(fft_output_[bin * 2u + 1u]);
      const double power = real * real + imaginary * imaginary;
      const double correction = bin == 0u ? kCorrectionDcDb : kCorrectionAcDb;
      double level = 10.0 * std::log10(power + kPowerFloor) + correction + job_normalization_db_;
      if (level < kMinimumLevelDb) {
        level = kMinimumLevelDb;
      }
      spectrum_[bin] = static_cast<float>(level);
    }
  }

  void buildColumn(std::uint32_t begin, std::uint32_t end) noexcept {
    const double nyquist = static_cast<double>(sample_rate_) * 0.5;
    const double range = -static_cast<double>(job_db_range_);
    const std::uint32_t bin_count = job_fft_size_ >> 1u;
    for (std::uint32_t y = begin; y < end; ++y) {
      double level = kMinimumLevelDb;
      const double frequency = display_frequencies_[y];
      if (frequency >= kMinimumDisplayFrequency && frequency <= nyquist) {
        const double bin_position =
            frequency * static_cast<double>(job_fft_size_) / static_cast<double>(sample_rate_);
        const std::uint32_t bin1 = static_cast<std::uint32_t>(std::floor(bin_position));
        if (bin1 < bin_count) {
          const std::uint32_t bin2 = bin1 + 1u < bin_count ? bin1 + 1u : bin1;
          const double fraction = bin_position - static_cast<double>(bin1);
          level = static_cast<double>(spectrum_[bin1]) +
                  (static_cast<double>(spectrum_[bin2]) - static_cast<double>(spectrum_[bin1])) *
                      fraction;
        }
      }

      double normalized = (level - static_cast<double>(job_db_range_)) / range;
      if (normalized < 0.0) {
        normalized = 0.0;
      } else if (normalized > 1.0) {
        normalized = 1.0;
      }
      staging_column_[kPayloadHeaderBytes + y] =
          static_cast<std::uint8_t>(normalized * 255.0 + 0.5);
    }
  }

  void commitColumn() noexcept {
    if (pending_column_count_ == kPendingColumnCapacity) {
      pending_read_column_ = (pending_read_column_ + 1u) % kPendingColumnCapacity;
      --pending_column_count_;
    }
    published_columns_[pending_write_column_].swap(staging_column_);
    pending_write_column_ = (pending_write_column_ + 1u) % kPendingColumnCapacity;
    ++pending_column_count_;
  }

  void runStage(const ::effetune::dsp::SchedulerStage &stage) noexcept {
    switch (static_cast<StageKind>(stage.kind)) {
    case StageKind::PackAnalysis:
      packAnalysis(stage.begin, stage.end);
      break;
    case StageKind::ForwardTransformStep:
      forwardTransformStep();
      break;
    case StageKind::BinLevels:
      calculateBinLevels(stage.begin, stage.end);
      break;
    case StageKind::BuildColumn:
      buildColumn(stage.begin, stage.end);
      break;
    case StageKind::CommitColumn:
      commitColumn();
      break;
    }
  }

  void advanceStagedJob() noexcept {
    const std::uint32_t end = stage_schedule_->slotEnd(job_slot_);
    for (std::uint32_t stage = stage_schedule_->slotBegin(job_slot_); stage < end; ++stage) {
      runStage(stage_schedule_->stage(stage));
    }
    ++job_slot_;
    if (job_slot_ == slot_count_) {
      job_active_ = false;
    } else {
      job_samples_until_slot_ = kSlotSamples;
    }
  }

  void startStagedJob(double frame_time) noexcept {
    resetStagedJob();
    job_samples_until_slot_ = kSlotSamples;
    job_origin_ = (write_position_ + ring_size_ - fft_size_) & ring_mask_;
    job_points_ = active_points_;
    job_fft_size_ = fft_size_;
    job_db_range_ = active_db_range_;
    job_normalization_db_ = -20.0 * std::log10(static_cast<double>(job_fft_size_));
    job_frame_time_ = frame_time;
    job_transform_ = active_transform_;
    job_window_ = window_;
    writeF32(staging_column_.data(), sample_rate_);
    writeF32(staging_column_.data() + 4u, static_cast<float>(job_frame_time_));
    writeU16(staging_column_.data() + 8u, static_cast<std::uint16_t>(kCellCount));
    writeU16(staging_column_.data() + 10u, static_cast<std::uint16_t>(job_points_));
    if (job_transform_ == nullptr || !job_transform_->begin(fft_input_, fft_output_, fft_work_)) {
      ready_ = false;
      return;
    }
    job_active_ = true;
  }

  std::array<PFFFT_Setup *, kSetupCount> real_setups_{};
  std::array<std::unique_ptr<::effetune::dsp::PffftOrderedRealForward>, kSetupCount>
      incremental_transforms_{};
  ::effetune::dsp::PffftOrderedRealForward *active_transform_ = nullptr;
  ::effetune::dsp::PffftOrderedRealForward *job_transform_ = nullptr;
  float *ring_ = nullptr;
  float *fft_input_ = nullptr;
  float *fft_output_ = nullptr;
  float *fft_work_ = nullptr;
  float *windows_ = nullptr;
  float *window_ = nullptr;
  float *job_window_ = nullptr;
  float *spectrum_ = nullptr;
  std::array<double, kCellCount> display_frequencies_{};
  std::vector<std::vector<std::uint8_t>> published_columns_;
  std::vector<std::uint8_t> staging_column_;
  float sample_rate_ = 48000.0F;
  float active_db_range_ = -96.0F;
  float job_db_range_ = -96.0F;
  double job_normalization_db_ = 0.0;
  double job_frame_time_ = 0.0;
  std::uint32_t active_points_ = 12u;
  std::uint32_t fft_size_ = 1u << 12u;
  std::uint32_t ring_size_ = 1u << 13u;
  std::uint32_t ring_mask_ = (1u << 13u) - 1u;
  std::uint32_t write_position_ = 0u;
  std::uint32_t samples_until_frame_ = 1u << 11u;
  std::uint32_t slot_count_ = 1u;
  std::uint32_t job_slot_ = 0u;
  std::uint32_t job_samples_until_slot_ = 0u;
  std::uint32_t job_origin_ = 0u;
  std::uint32_t job_points_ = 0u;
  std::uint32_t job_fft_size_ = 0u;
  std::uint32_t pending_read_column_ = 0u;
  std::uint32_t pending_write_column_ = 0u;
  std::uint32_t pending_column_count_ = 0u;
  bool ready_ = false;
  bool job_active_ = false;
  bool parameter_state_initialized_ = false;
  using StageSchedule = ::effetune::dsp::StageSchedule<kStageCapacity, kMaximumSlots>;
  std::unique_ptr<StageSchedule> stage_schedule_;
};

static_assert(sizeof(SpectrogramKernel) <= 8192u);

} // namespace effetune::plugins::analyzer

EFFETUNE_REGISTER_KERNEL(SpectrogramPlugin, effetune::plugins::analyzer::SpectrogramKernel)

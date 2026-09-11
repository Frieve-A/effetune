#include "effetune/kernel.h"
#include "NoteSpectrogramPluginParams.h"
#include "binary_io.h"
#include "effetune/dsp/math.h"
#include "fine_model.generated.h"
#include "heap_tree_model.h"
#include "learned_model.generated.h"
#include "multires_features.h"
#include "octave_model.generated.h"
#include "octave_pair_features.h"
#include "spectral_frontend.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <numeric>
#include <vector>

namespace effetune::plugins::analyzer {
namespace {
constexpr std::uint32_t kPitches = 88u;
constexpr std::uint32_t kRegularPitches = kPitches - 24u;
constexpr std::uint32_t kPitchGroups = kRegularPitches / 4u;
constexpr std::uint32_t kFineDivisions = 5u;
constexpr std::uint32_t kFinePitches = kPitches * kFineDivisions;
constexpr std::uint32_t kFirstTrees = 128u;
constexpr std::uint32_t kTreesPerTask = 32u;
constexpr std::uint32_t kMiddleTrees = 512u;
constexpr std::uint32_t kInitialCandidates = 24u;
constexpr std::uint32_t kInitialCandidateGroups = kInitialCandidates / 4u;
constexpr std::uint32_t kCandidatePitches = 16u;
constexpr std::uint32_t kCandidateGroups = kCandidatePitches / 4u;
constexpr std::uint32_t kPairCount = OctavePairFeatures::kPairCount;
constexpr std::uint32_t kPairGroups = kPairCount / 4u;
constexpr std::uint32_t kPairCandidates = 4u;
constexpr std::uint32_t kPairCandidateGroups = (kPairCandidates + 3u) / 4u;
constexpr std::uint32_t kLowCandidates = 8u;
constexpr std::uint32_t kTotalCandidates = kCandidatePitches + kLowCandidates;
constexpr std::uint32_t kFineRows = kTotalCandidates * kFineDivisions;
constexpr std::uint32_t kFineGroups = kFineRows / 4u;
constexpr std::uint32_t kRegularFineGroups = kCandidatePitches * kFineDivisions / 4u;
constexpr std::uint32_t kLowFineTrees = 32u;
constexpr double kMilCoarseMarginFloor = -0.6;
constexpr float kConfidenceThreshold = 0.52F;
constexpr float kConfidenceOdds = kConfidenceThreshold / (1.0F - kConfidenceThreshold);
constexpr std::uint32_t kMaximumSlots = 512u;
constexpr std::uint32_t kStageCapacity = 32768u;
constexpr std::uint32_t kConfidenceOffset = 28u;
constexpr std::uint32_t kLevelOffset = kConfidenceOffset + 4u * kFinePitches;
constexpr std::uint32_t kPayloadBytes = kLevelOffset + 4u * kFinePitches;
constexpr std::uint32_t kPendingFrames = 32u;
constexpr std::uint32_t kFirstMidi = 21u;
static_assert(learned_model::kFeatureCount == MultiresolutionFeatures::kFeatureCount);
static_assert(learned_model::kFeatureSchemaVersion == MultiresolutionFeatures::kSchemaVersion);
static_assert(learned_model::kTreeCount > 0u && learned_model::kDepth > 0u);
static_assert(kFirstTrees < learned_model::kTreeCount);
static_assert(kFirstTrees % kTreesPerTask == 0u);
static_assert(kMiddleTrees % kTreesPerTask == 0u);
static_assert(kFirstTrees < kMiddleTrees && kMiddleTrees < learned_model::kTreeCount);
static_assert(learned_model::kTreeCount % kTreesPerTask == 0u);
static_assert(fine_model::kTreeCount % kTreesPerTask == 0u);
static_assert(fine_model::kFeatureCount == 8u);
static_assert(fine_model::kTreeCount > 0u && fine_model::kDepth > 0u);
static_assert(octave_model::kFeatureCount == OctavePairFeatures::kFeatureCount);
static_assert(octave_model::kFeatureSchemaVersion == OctavePairFeatures::kSchemaVersion);
static_assert(octave_model::kTreeCount % kTreesPerTask == 0u);
constexpr std::uint32_t regularPitch(std::uint32_t index) noexcept {
  return index < 3u ? index : index + 24u;
}
using binary_io::writeF32;
using binary_io::writeU16;
using binary_io::writeU32;
using Stage = NoteSpectrogramStage;
} // namespace

class SpectralAnalysis final {
public:
  bool ready() const noexcept { return ready_; }
  bool configure(std::uint32_t minimum_midi, std::uint32_t maximum_midi,
                 std::uint32_t regular_candidates) noexcept {
    const auto minimum_pitch = minimum_midi - kFirstMidi;
    const auto maximum_pitch = maximum_midi - kFirstMidi;
    if (minimum_pitch == minimum_pitch_ && maximum_pitch == maximum_pitch_ &&
        regular_candidates == requested_regular_candidates_)
      return false;
    minimum_pitch_ = minimum_pitch;
    maximum_pitch_ = maximum_pitch;
    requested_regular_candidates_ = regular_candidates;
    return true;
  }
  void prepare(const PrepareInfo &info) {
    ready_ = false;
    rate_ = info.sampleRate > 0.0F ? info.sampleRate : 48000.0F;
    hop_ = std::clamp(static_cast<std::uint32_t>(std::round(rate_ * .02)), 16u, 8192u);
    slots_ = hop_ / 16u;
    for (std::uint32_t resolution = 0u; resolution < frontends_.size(); ++resolution) {
      frontends_[resolution] = std::make_unique<SpectralFrontend>();
      if (!frontends_[resolution]->prepare(rate_, hop_, resolution == 0u ? 1u : 4u))
        return;
    }
    features_ = std::make_unique<MultiresolutionFeatures>();
    pair_features_ = std::make_unique<OctavePairFeatures>();
    schedule_ = std::make_unique<Schedule>();
    published_.resize(kPendingFrames);
    for (auto &frame : published_)
      frame.resize(kPayloadBytes);
    staging_.resize(kPayloadBytes);
    ready_ = buildSchedule();
    reset(1u);
  }
  void reset(std::uint32_t generation) noexcept {
    generation_ = generation;
    until_frame_ = hop_;
    frame_index_ = 0u;
    pending_read_ = pending_write_ = pending_count_ = 0u;
    job_active_ = false;
    for (auto &frontend : frontends_)
      if (frontend)
        frontend->reset();
    if (features_)
      features_->clear();
    margins_.fill(0.0);
    candidate_margins_.fill(0.0);
    candidate_rows_.fill(nullptr);
    candidate_active_.fill(false);
    fine_margins_.fill(0.0);
    candidate_pitches_.fill(0u);
  }
  void process(float *audio, std::uint32_t channels, std::uint32_t frames,
               const ProcessInfo &info) noexcept {
    if (!ready_ || !audio || channels == 0u)
      return;
    std::uint32_t frame = 0u;
    while (frame < frames) {
      auto run = std::min(frames - frame, until_frame_);
      if (job_active_)
        run = std::min(run, until_slot_);
      const auto end = frame + run;
      for (; frame < end; ++frame) {
        const float left = std::isfinite(audio[frame]) ? audio[frame] : 0.0F;
        const float value = channels > 1u ? audio[frames + frame] : left;
        const float right = std::isfinite(value) ? value : 0.0F;
        for (auto &frontend : frontends_)
          frontend->push(left, right);
      }
      until_frame_ -= run;
      if (job_active_) {
        until_slot_ -= run;
        if (until_slot_ == 0u) {
          for (auto stage = schedule_->slotBegin(job_slot_); stage < schedule_->slotEnd(job_slot_);
               ++stage)
            runStage(schedule_->stage(stage));
          job_active_ = ++job_slot_ < slots_;
          until_slot_ = 16u;
        }
      }
      if (until_frame_ == 0u) {
        startJob(info.timeSeconds + static_cast<double>(frame) / rate_, channels > 1u ? 2u : 1u);
        until_frame_ = hop_;
      }
    }
  }
  void writeTelemetry(TelemetryWriter &writer) noexcept {
    while (ready_ && pending_count_ != 0u) {
      if (!writer.write(24u, 3u, published_[pending_read_].data(), kPayloadBytes))
        return;
      pending_read_ = (pending_read_ + 1u) % kPendingFrames;
      --pending_count_;
    }
  }

private:
  bool buildSchedule() {
    schedule_->clear();
    // Two lanes per resolution retain the original independent-channel FFT stages.
    for (std::uint32_t resolution = 0u; resolution < frontends_.size(); ++resolution)
      if (!frontends_[resolution]->appendStages(*schedule_, resolution * 2u, slots_))
        return false;
    const auto add = [&](Stage kind, std::uint32_t begin, std::uint32_t end, std::uint32_t weight) {
      schedule_->addStage(static_cast<std::uint8_t>(kind), 0u, begin, end, weight);
    };
    const auto add_range = [&](Stage kind, std::uint32_t count, std::uint32_t weight) {
      const auto chunks = std::min(count, slots_);
      for (std::uint32_t i = 0u; i < chunks; ++i) {
        const auto begin = count * i / chunks;
        const auto end = count * (i + 1u) / chunks;
        add(kind, begin, end, weight * (end - begin));
      }
    };
    const auto add_tasks = [&](Stage kind, std::uint32_t tasks, std::uint32_t weight) {
      const auto chunks = std::min(tasks, slots_ * 2u);
      for (std::uint32_t i = 0u; i < chunks; ++i) {
        const auto begin =
            static_cast<std::uint32_t>(static_cast<std::uint64_t>(tasks) * i / chunks);
        const auto end =
            static_cast<std::uint32_t>(static_cast<std::uint64_t>(tasks) * (i + 1u) / chunks);
        add(kind, begin, end, weight * (end - begin));
      }
    };
    add_range(Stage::Initialize, kRegularPitches, 140u);
    add_tasks(Stage::EvaluateFirst, kFirstTrees / kTreesPerTask * kPitchGroups,
              kTreesPerTask * 32u * learned_model::kDepth);
    add(Stage::SelectCandidates, 0u, 0u, 5000u);
    add_tasks(Stage::EvaluateCandidates,
              (kMiddleTrees - kFirstTrees) / kTreesPerTask * kInitialCandidateGroups,
              kTreesPerTask * 32u * learned_model::kDepth);
    add(Stage::RefineCandidates, 0u, 0u, 1000u);
    add_tasks(Stage::EvaluateRemaining,
              (learned_model::kTreeCount - kMiddleTrees) / kTreesPerTask * kCandidateGroups,
              kTreesPerTask * 32u * learned_model::kDepth);
    add_range(Stage::InitializePairs, kPairCount, 300u);
    add_tasks(Stage::EvaluatePairsFirst, kFirstTrees / kTreesPerTask * kPairGroups,
              kTreesPerTask * 32u * octave_model::kDepth);
    add(Stage::SelectPairs, 0u, 0u, 1000u);
    add_tasks(Stage::EvaluatePairsRemaining,
              (octave_model::kTreeCount - kFirstTrees) / kTreesPerTask * kPairCandidateGroups,
              kTreesPerTask * 32u * octave_model::kDepth);
    add(Stage::SelectLowCandidates, 0u, 0u, 1500u);
    add_range(Stage::PrepareFine, kTotalCandidates, 400u);
    add_tasks(Stage::EvaluateFine,
              kLowFineTrees / kTreesPerTask * kFineGroups +
                  (fine_model::kTreeCount - kLowFineTrees) / kTreesPerTask * kRegularFineGroups,
              kTreesPerTask * 32u * fine_model::kDepth);
    add_range(Stage::Finalize, kFineRows, 180u);
    add(Stage::Commit, 0u, 0u, 1u);
    return schedule_->partition(slots_);
  }
  void startJob(double time, std::uint32_t channels) noexcept {
    job_active_ = true;
    for (auto &frontend : frontends_)
      job_active_ = frontend->begin(channels) && job_active_;
    if (!job_active_)
      ready_ = false;
    job_slot_ = 0u;
    until_slot_ = 16u;
    writeF32(staging_.data(), rate_);
    writeF32(staging_.data() + 4u, static_cast<float>(time));
    writeU16(staging_.data() + 8u, kFinePitches);
    writeU16(staging_.data() + 10u, 21u);
    writeF32(staging_.data() + 12u, static_cast<float>(hop_) / rate_);
    writeU32(staging_.data() + 16u, frame_index_++);
    writeU32(staging_.data() + 20u, kFineDivisions);
    writeU32(staging_.data() + 24u, generation_);
    std::fill(staging_.begin() + kConfidenceOffset, staging_.begin() + kLevelOffset,
              std::uint8_t{0});
    for (auto pitch = 0u; pitch < kFinePitches; ++pitch)
      writeF32(staging_.data() + kLevelOffset + pitch * 4u, -240.0F);
  }
  void runStage(const ::effetune::dsp::SchedulerStage &stage) noexcept {
    const auto kind = static_cast<Stage>(stage.kind);
    if (kind <= Stage::FinishFinePresence) {
      if (!frontends_[stage.channel / 2u]->run(kind, stage.channel % 2u, stage.begin, stage.end))
        ready_ = false;
      return;
    }
    switch (kind) {
    case Stage::Initialize:
      for (auto index = stage.begin; index < stage.end; ++index) {
        const auto pitch = regularPitch(index);
        if (!inRange(pitch))
          continue;
        features_->update(frontends_[0]->values(), frontends_[1]->values(), pitch, pitch + 1u);
        margins_[pitch] = learned_model::kBias;
      }
      break;
    case Stage::EvaluateFirst: {
      constexpr auto model = learned_model::model();
      for (auto task = stage.begin; task < stage.end; ++task) {
        const auto tree = kTreesPerTask * (task / kPitchGroups);
        const auto first = 4u * (task % kPitchGroups);
        const float *rows[4] = {};
        double scores[4] = {};
        std::uint8_t pitches[4] = {};
        auto row_count = 0u;
        for (auto row = 0u; row < 4u; ++row) {
          const auto pitch = regularPitch(first + row);
          if (!inRange(pitch))
            continue;
          pitches[row_count] = static_cast<std::uint8_t>(pitch);
          rows[row_count] = features_->values()[pitch].data();
          scores[row_count] = margins_[pitch];
          ++row_count;
        }
        if (row_count == 0u)
          continue;
        HeapTreeEvaluator::accumulateTrees4(model, rows, tree, tree + kTreesPerTask, scores,
                                            row_count);
        for (auto row = 0u; row < row_count; ++row)
          margins_[pitches[row]] = scores[row];
      }
      break;
    }
    case Stage::SelectCandidates: {
      candidate_active_.fill(false);
      auto available = 0u;
      for (auto index = 0u; index < kRegularPitches; ++index) {
        const auto pitch = regularPitch(index);
        if (inRange(pitch))
          candidate_pitches_[available++] = static_cast<std::uint8_t>(pitch);
      }
      regular_candidate_count_ = std::min(requested_regular_candidates_, available);
      initial_candidate_count_ =
          std::min(available, std::min(kInitialCandidates, regular_candidate_count_ * 3u / 2u));
      selectCandidates(initial_candidate_count_, available);
      break;
    }
    case Stage::RefineCandidates:
      for (auto candidate = 0u; candidate < initial_candidate_count_; ++candidate)
        margins_[candidate_pitches_[candidate]] = candidate_margins_[candidate];
      selectCandidates(regular_candidate_count_, initial_candidate_count_);
      for (auto candidate = 0u; candidate < regular_candidate_count_; ++candidate)
        candidate_active_[candidate] = true;
      break;
    case Stage::EvaluateCandidates:
    case Stage::EvaluateRemaining: {
      constexpr auto model = learned_model::model();
      const bool initial = kind == Stage::EvaluateCandidates;
      const auto groups = initial ? kInitialCandidateGroups : kCandidateGroups;
      const auto count = initial ? initial_candidate_count_ : regular_candidate_count_;
      const auto first_tree = initial ? kFirstTrees : kMiddleTrees;
      for (auto task = stage.begin; task < stage.end; ++task) {
        const auto tree = first_tree + kTreesPerTask * (task / groups);
        const auto first = 4u * (task % groups);
        if (first >= count)
          continue;
        HeapTreeEvaluator::accumulateTrees4(model, candidate_rows_.data() + first, tree,
                                            tree + kTreesPerTask, candidate_margins_.data() + first,
                                            std::min(4u, count - first));
      }
      break;
    }
    case Stage::InitializePairs:
      if (!hasLowRange())
        break;
      pair_features_->update(frontends_[0]->values(), frontends_[1]->values(), stage.begin,
                             stage.end);
      for (auto pair = stage.begin; pair < stage.end; ++pair) {
        pair_rows_[pair] = pair_features_->values()[pair].data();
        std::fill_n(pair_margins_.data() + pair * 4u, 4u, 0.0);
      }
      break;
    case Stage::EvaluatePairsFirst:
    case Stage::EvaluatePairsRemaining: {
      if (!hasLowRange())
        break;
      const bool initial = kind == Stage::EvaluatePairsFirst;
      const auto groups = initial ? kPairGroups : kPairCandidateGroups;
      const auto count = initial ? kPairCount : pair_candidate_count_;
      const auto first_tree = initial ? 0u : kFirstTrees;
      for (auto task = stage.begin; task < stage.end; ++task) {
        const auto tree = first_tree + kTreesPerTask * (task / groups);
        const auto first = 4u * (task % groups);
        if (first >= count)
          continue;
        HeapTreeEvaluator::accumulateTrees4<4u>(
            octave_model::model(), pair_rows_.data() + first, tree, tree + kTreesPerTask,
            pair_margins_.data() + first * 4u, std::min(4u, count - first));
      }
      break;
    }
    case Stage::SelectPairs: {
      std::array<double, kPairCount> scores{};
      auto eligible = 0u;
      for (auto pair = 0u; pair < kPairCount; ++pair) {
        const auto low = 3u + pair;
        if (!inRange(low) && !inRange(low + 12u))
          continue;
        const auto *raw = pair_margins_.data() + pair * 4u;
        const auto peak = std::max({raw[1], raw[2], raw[3]});
        scores[pair] =
            peak +
            std::log(std::exp(raw[1] - peak) + std::exp(raw[2] - peak) + std::exp(raw[3] - peak)) -
            raw[0];
        pair_order_[eligible++] = static_cast<std::uint8_t>(pair);
      }
      pair_candidate_count_ = std::min(kPairCandidates, eligible);
      std::partial_sort(pair_order_.begin(), pair_order_.begin() + pair_candidate_count_,
                        pair_order_.begin() + eligible, [&scores](auto a, auto b) {
                          return scores[a] != scores[b] ? scores[a] > scores[b] : a < b;
                        });
      const auto previous = pair_margins_;
      for (auto candidate = 0u; candidate < pair_candidate_count_; ++candidate) {
        const auto pair = pair_order_[candidate];
        pair_rows_[candidate] = pair_features_->values()[pair].data();
        std::copy_n(previous.data() + pair * 4u, 4u, pair_margins_.data() + candidate * 4u);
      }
      break;
    }
    case Stage::SelectLowCandidates: {
      std::array<std::uint8_t, kPairCandidates * 2u> pitches{};
      auto available = 0u;
      for (auto candidate = 0u; candidate < pair_candidate_count_; ++candidate) {
        const auto *raw = pair_margins_.data() + candidate * 4u;
        const auto peak = std::max({raw[0], raw[1], raw[2], raw[3]});
        double weights[4];
        for (auto state = 0u; state < 4u; ++state)
          weights[state] = std::exp(raw[state] - peak);
        const auto low = 3u + pair_order_[candidate];
        // Marginalize all four states so a genuine octave can retain both notes.
        margins_[low] = std::log((weights[1] + weights[3]) / (weights[0] + weights[2]));
        margins_[low + 12u] = std::log((weights[2] + weights[3]) / (weights[0] + weights[1]));
        if (inRange(low))
          pitches[available++] = static_cast<std::uint8_t>(low);
        if (inRange(low + 12u))
          pitches[available++] = static_cast<std::uint8_t>(low + 12u);
      }
      low_candidate_count_ = std::min(kLowCandidates, available);
      std::partial_sort(pitches.begin(), pitches.begin() + low_candidate_count_,
                        pitches.begin() + available, [this](auto a, auto b) {
                          const auto left = margins_[a] - octaveDecisionMargin(a);
                          const auto right = margins_[b] - octaveDecisionMargin(b);
                          return left != right ? left > right : a < b;
                        });
      for (auto candidate = 0u; candidate < low_candidate_count_; ++candidate) {
        const auto pitch = pitches[candidate];
        candidate_pitches_[kCandidatePitches + candidate] = pitch;
        candidate_margins_[kCandidatePitches + candidate] = margins_[pitch];
        candidate_active_[kCandidatePitches + candidate] = true;
      }
      break;
    }
    case Stage::PrepareFine: {
      const auto &short_presence = frontends_[0]->finePresence();
      const auto &long_presence = frontends_[1]->finePresence();
      for (auto candidate = stage.begin; candidate < stage.end; ++candidate) {
        if (!candidate_active_[candidate])
          continue;
        const auto pitch = candidate_pitches_[candidate];
        const auto first = pitch * kFineDivisions;
        float bag_peak = 0.0F;
        float bag_sum = 0.0F;
        for (auto division = 0u; division < kFineDivisions; ++division) {
          const auto fine_pitch = first + division;
          const float peak = short_presence[fine_pitch] > long_presence[fine_pitch]
                                 ? short_presence[fine_pitch]
                                 : long_presence[fine_pitch];
          fine_features_[candidate * kFineDivisions + division][3] = peak;
          bag_peak = peak > bag_peak ? peak : bag_peak;
          bag_sum += peak;
        }
        for (auto division = 0u; division < kFineDivisions; ++division) {
          const auto row = candidate * kFineDivisions + division;
          const auto fine_pitch = first + division;
          const auto offset = (static_cast<float>(division) - kFineDivisions / 2u) / kFineDivisions;
          auto &values = fine_features_[row];
          values[0] = static_cast<float>(candidate_margins_[candidate]);
          values[1] = short_presence[fine_pitch];
          values[2] = long_presence[fine_pitch];
          values[4] = values[3] - bag_peak;
          values[5] = values[3] / (bag_sum > 1.0e-6F ? bag_sum : 1.0e-6F);
          values[6] = offset;
          values[7] = offset < 0.0F ? -offset : offset;
          fine_margins_[row] = fine_model::kBias;
        }
      }
      break;
    }
    case Stage::EvaluateFine: {
      constexpr auto model = fine_model::model();
      for (auto task = stage.begin; task < stage.end; ++task) {
        // Low-note presence is already decided; a short prefix only locates its fine cell.
        constexpr auto shared_tasks = kLowFineTrees / kTreesPerTask * kFineGroups;
        const auto group_task = task < shared_tasks ? task : task - shared_tasks;
        const auto groups = task < shared_tasks ? kFineGroups : kRegularFineGroups;
        const auto tree =
            (task < shared_tasks ? 0u : kLowFineTrees) + kTreesPerTask * (group_task / groups);
        const auto first = 4u * (group_task % groups);
        const float *rows[4] = {};
        double margins[4] = {};
        std::uint32_t indices[4] = {};
        auto row_count = 0u;
        for (std::uint32_t row = 0u; row < 4u && first + row < kFineRows; ++row) {
          const auto index = first + row;
          if (!candidate_active_[index / kFineDivisions])
            continue;
          indices[row_count] = index;
          rows[row_count] = fine_features_[index].data();
          margins[row_count] = fine_margins_[index];
          ++row_count;
        }
        if (row_count == 0u)
          continue;
        HeapTreeEvaluator::accumulateTrees4(model, rows, tree, tree + kTreesPerTask, margins,
                                            row_count);
        for (auto row = 0u; row < row_count; ++row)
          fine_margins_[indices[row]] = margins[row];
      }
      break;
    }
    case Stage::Finalize:
      for (auto row = stage.begin; row < stage.end; ++row) {
        const auto candidate = row / kFineDivisions;
        if (!candidate_active_[candidate])
          continue;
        const auto division = row % kFineDivisions;
        const auto pitch = candidate_pitches_[candidate];
        const auto fine_pitch = pitch * kFineDivisions + division;
        auto value = 0.0F;
        if (!frontends_[0]->belowFloor()) {
          auto best_row = candidate * kFineDivisions;
          for (auto fine = 1u; fine < kFineDivisions; ++fine) {
            const auto other = candidate * kFineDivisions + fine;
            if (fine_margins_[other] > fine_margins_[best_row])
              best_row = other;
          }
          if (candidate >= kCandidatePitches) {
            value = HeapTreeEvaluator::probability(candidate_margins_[candidate] -
                                                   octaveDecisionMargin(pitch) +
                                                   fine_margins_[row] - fine_margins_[best_row]);
          } else {
            value =
                HeapTreeEvaluator::probability(fine_margins_[row] - fine_model::kDecisionMargin);
            if (candidate_margins_[candidate] < kMilCoarseMarginFloor && value >= 0.5F)
              value = 0.499999F;
            if (row == best_row) {
              const auto coarse = HeapTreeEvaluator::excessProbability(
                  HeapTreeEvaluator::probability(candidate_margins_[candidate]),
                  static_cast<float>(learned_model::kPrior));
              value = coarse > value ? coarse : value;
            }
            // Recenter the validation-selected decision point at display confidence 0.5.
            value = value / (value + (1.0F - value) * kConfidenceOdds);
          }
        }
        writeF32(staging_.data() + kConfidenceOffset + fine_pitch * 4u, value);
        auto level = -240.0F;
        if (!frontends_[0]->belowFloor()) {
          constexpr auto cents_ratio = 1.029302236643492;
          constexpr auto harmonics = 16u;
          const auto midi = 21.0 + static_cast<double>(fine_pitch - division) / kFineDivisions +
                            (static_cast<double>(division) - 2.0) / kFineDivisions;
          const auto fundamental = 440.0 * std::exp2((midi - 69.0) / 12.0);
          const auto bin_hz = frontends_[0]->binHz();
          const auto &prefix = frontends_[0]->rawPrefix();
          const auto last_bin =
              prefix.size() > 1u ? static_cast<std::uint32_t>(prefix.size() - 2u) : 0u;
          double power = 0.0;
          for (auto harmonic = 1u; harmonic <= harmonics; ++harmonic) {
            const auto frequency = harmonic * fundamental;
            if (!(frequency < rate_ * 0.5))
              break;
            const auto center_bin = frequency / bin_hz;
            const auto cents_lower = frequency / cents_ratio / bin_hz;
            const auto bins_lower = center_bin - 2.0;
            const auto lower = cents_lower < bins_lower ? cents_lower : bins_lower;
            const auto cents_upper = frequency * cents_ratio / bin_hz;
            const auto bins_upper = center_bin + 2.0;
            const auto upper = cents_upper > bins_upper ? cents_upper : bins_upper;
            const auto begin = static_cast<std::uint32_t>(lower > 0.0 ? std::floor(lower) : 0.0);
            const auto requested_end = static_cast<std::uint32_t>(std::ceil(upper));
            const auto end = requested_end < last_bin ? requested_end : last_bin;
            if (begin <= end)
              power += prefix[end + 1u] - prefix[begin];
          }
          const auto amplitude = std::sqrt(power * frontends_[0]->amplitudePowerScale());
          const auto correction =
              3.0 * std::log2((fundamental > 100.0 ? fundamental : 100.0) / 100.0);
          const auto raw_level = ::effetune::dsp::lin_to_db(amplitude);
          const auto corrected = raw_level > -240.0 ? raw_level + correction : raw_level;
          level = static_cast<float>(corrected > -240.0 ? corrected : -240.0);
        }
        writeF32(staging_.data() + kLevelOffset + fine_pitch * 4u, level);
      }
      break;
    case Stage::Commit:
      if (pending_count_ == kPendingFrames) {
        pending_read_ = (pending_read_ + 1u) % kPendingFrames;
        --pending_count_;
      }
      published_[pending_write_].swap(staging_);
      pending_write_ = (pending_write_ + 1u) % kPendingFrames;
      ++pending_count_;
      break;
    default:
      ready_ = false;
      break;
    }
  }
  void selectCandidates(std::uint32_t count, std::uint32_t available) noexcept {
    if (count == 0u)
      return;
    std::partial_sort(
        candidate_pitches_.begin(), candidate_pitches_.begin() + count,
        candidate_pitches_.begin() + available,
        [this](std::uint8_t left, std::uint8_t right) { return margins_[left] > margins_[right]; });
    for (auto candidate = 0u; candidate < count; ++candidate) {
      const auto pitch = candidate_pitches_[candidate];
      candidate_rows_[candidate] = features_->values()[pitch].data();
      candidate_margins_[candidate] = margins_[pitch];
    }
  }
  static constexpr double octaveDecisionMargin(std::uint32_t pitch) noexcept {
    // Log odds of development-selected presence thresholds 0.7 (C1-B1) and 0.365 (C2-B2).
    return pitch < 15u ? 0.8472978603872034 : -0.5537276453102;
  }
  bool inRange(std::uint32_t pitch) const noexcept {
    return pitch >= minimum_pitch_ && pitch <= maximum_pitch_;
  }
  bool hasLowRange() const noexcept { return minimum_pitch_ <= 26u && maximum_pitch_ >= 3u; }
  using Schedule = ::effetune::dsp::StageSchedule<kStageCapacity, kMaximumSlots>;
  std::array<std::unique_ptr<SpectralFrontend>, 2> frontends_;
  std::unique_ptr<MultiresolutionFeatures> features_;
  std::unique_ptr<OctavePairFeatures> pair_features_;
  std::unique_ptr<Schedule> schedule_;
  std::array<double, kPitches> margins_{};
  std::array<std::uint8_t, kPitches> candidate_pitches_{};
  std::array<const float *, kInitialCandidates> candidate_rows_{};
  std::array<double, kTotalCandidates> candidate_margins_{};
  std::array<bool, kTotalCandidates> candidate_active_{};
  std::array<const float *, kPairCount> pair_rows_{};
  std::array<double, kPairCount * 4u> pair_margins_{};
  std::array<std::uint8_t, kPairCount> pair_order_{};
  std::array<std::array<float, fine_model::kFeatureCount>, kFineRows> fine_features_{};
  std::array<double, kFineRows> fine_margins_{};
  std::vector<std::vector<std::uint8_t>> published_;
  std::vector<std::uint8_t> staging_;
  float rate_ = 48000.0F;
  std::uint32_t hop_ = 960u, slots_ = 60u, generation_ = 1u, frame_index_ = 0u;
  std::uint32_t until_frame_ = 960u, until_slot_ = 16u, job_slot_ = 0u;
  std::uint32_t pending_read_ = 0u, pending_write_ = 0u, pending_count_ = 0u;
  std::uint32_t minimum_pitch_ = 7u, maximum_pitch_ = 70u;
  std::uint32_t requested_regular_candidates_ = 8u;
  std::uint32_t initial_candidate_count_ = 0u, regular_candidate_count_ = 0u;
  std::uint32_t pair_candidate_count_ = 0u, low_candidate_count_ = 0u;
  bool ready_ = false, job_active_ = false;
};

class NoteSpectrogramKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::NoteSpectrogramPluginParams)
public:
  void prepare(const PrepareInfo &info) override {
    analysis_ = std::make_unique<SpectralAnalysis>();
    analysis_->prepare(info);
    parameter_sync_required_ = true;
    reset();
  }
  bool preparedSuccessfully() const noexcept override { return analysis_ && analysis_->ready(); }
  void reset() noexcept override {
    if (++generation_ == 0u)
      ++generation_;
    channels_ = 0u;
    if (analysis_)
      analysis_->reset(generation_);
  }
  void process(float *audio, std::uint32_t channels, std::uint32_t frames,
               const ProcessInfo &info) noexcept override {
    synchronizeParameters();
    const auto selected = channels > 1u ? 2u : channels;
    if (channels_ != 0u && selected != channels_)
      reset();
    channels_ = selected;
    if (analysis_)
      analysis_->process(audio, channels, frames, info);
  }
  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (analysis_)
      analysis_->writeTelemetry(writer);
  }

private:
  void synchronizeParameters() noexcept {
    if (!analysis_ || (!paramsDirty() && !parameter_sync_required_))
      return;
    const auto initial_sync = parameter_sync_required_;
    parameter_sync_required_ = false;
    const auto bounded = [](float value, int minimum, int maximum, int fallback) {
      if (!std::isfinite(value))
        return fallback;
      const auto rounded = static_cast<int>(std::round(value));
      return rounded < minimum ? minimum : (rounded > maximum ? maximum : rounded);
    };
    auto minimum_midi = bounded(params_.minimumMidi, 21, 108, 28);
    auto maximum_midi = bounded(params_.maximumMidi, 21, 108, 91);
    if (maximum_midi < minimum_midi)
      maximum_midi = minimum_midi;
    const auto regular_candidates = bounded(params_.regularCandidates, 1, 16, 8);
    if (!analysis_->configure(static_cast<std::uint32_t>(minimum_midi),
                              static_cast<std::uint32_t>(maximum_midi),
                              static_cast<std::uint32_t>(regular_candidates)))
      return;
    if (initial_sync)
      analysis_->reset(generation_);
    else
      reset();
  }
  std::unique_ptr<SpectralAnalysis> analysis_;
  std::uint32_t generation_ = 0u, channels_ = 0u;
  bool parameter_sync_required_ = true;
};
static_assert(sizeof(NoteSpectrogramKernel) <= 8192u);
} // namespace effetune::plugins::analyzer
EFFETUNE_REGISTER_KERNEL(NoteSpectrogramPlugin, effetune::plugins::analyzer::NoteSpectrogramKernel)

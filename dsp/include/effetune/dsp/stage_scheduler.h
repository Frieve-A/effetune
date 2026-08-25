#ifndef EFFETUNE_DSP_STAGE_SCHEDULER_H
#define EFFETUNE_DSP_STAGE_SCHEDULER_H

#include <array>
#include <cstdint>

namespace effetune::dsp {

struct SchedulerStage {
  std::uint8_t kind = 0u;
  std::uint8_t channel = 0u;
  std::uint32_t begin = 0u;
  std::uint32_t end = 0u;
  std::uint32_t weight = 0u;
};

template <std::uint32_t MaxStages, std::uint32_t MaxSlots> class StageSchedule final {
  static_assert(MaxStages > 0u);
  static_assert(MaxSlots > 0u);

public:
  void clear() noexcept {
    stage_count_ = 0u;
    slot_count_ = 0u;
    valid_ = true;
    slot_stage_offsets_.fill(0u);
  }

  void addStage(std::uint8_t kind, std::uint32_t channel, std::uint32_t begin, std::uint32_t end,
                std::uint32_t weight) noexcept {
    if (stage_count_ >= MaxStages || channel > 0xffu) {
      valid_ = false;
      return;
    }
    stages_[stage_count_++] = {
        kind, static_cast<std::uint8_t>(channel), begin, end, weight,
    };
  }

  [[nodiscard]] bool partition(std::uint32_t slot_count) noexcept {
    if (!valid_ || slot_count == 0u || slot_count > MaxSlots) {
      return false;
    }
    slot_count_ = slot_count;
    slot_stage_offsets_.fill(stage_count_);
    if (stage_count_ == 0u) {
      slot_stage_offsets_.fill(0u);
      return true;
    }

    std::uint64_t lower = 0u;
    std::uint64_t upper = 0u;
    for (std::uint32_t index = 0u; index < stage_count_; ++index) {
      const std::uint64_t weight = stages_[index].weight;
      if (weight > lower) {
        lower = weight;
      }
      upper += weight;
    }
    while (lower < upper) {
      const std::uint64_t middle = lower + (upper - lower) / 2u;
      if (groupsForCapacity(middle) <= slot_count) {
        upper = middle;
      } else {
        lower = middle + 1u;
      }
    }

    std::array<std::uint32_t, MaxSlots> group_begin{};
    std::array<std::uint32_t, MaxSlots> group_end{};
    std::array<std::uint64_t, MaxSlots> group_weight{};
    std::uint32_t group_count = 1u;
    for (std::uint32_t index = 0u; index < stage_count_; ++index) {
      const std::uint64_t weight = stages_[index].weight;
      if (group_weight[group_count - 1u] != 0u && group_weight[group_count - 1u] + weight > lower) {
        group_end[group_count - 1u] = index;
        group_begin[group_count] = index;
        ++group_count;
      }
      group_weight[group_count - 1u] += weight;
    }
    group_end[group_count - 1u] = stage_count_;

    while (group_count < slot_count) {
      std::uint32_t candidate = group_count;
      std::uint64_t candidate_weight = 0u;
      for (std::uint32_t group = 0u; group < group_count; ++group) {
        if (group_end[group] - group_begin[group] > 1u && group_weight[group] > candidate_weight) {
          candidate = group;
          candidate_weight = group_weight[group];
        }
      }
      if (candidate == group_count) {
        break;
      }

      std::uint64_t prefix_weight = 0u;
      std::uint64_t best_left_weight = 0u;
      std::uint64_t best_peak = candidate_weight + 1u;
      std::uint32_t split = group_begin[candidate] + 1u;
      for (std::uint32_t boundary = group_begin[candidate] + 1u; boundary < group_end[candidate];
           ++boundary) {
        prefix_weight += stages_[boundary - 1u].weight;
        const std::uint64_t right_weight = candidate_weight - prefix_weight;
        const std::uint64_t peak = prefix_weight > right_weight ? prefix_weight : right_weight;
        if (peak < best_peak) {
          best_peak = peak;
          best_left_weight = prefix_weight;
          split = boundary;
        }
      }

      for (std::uint32_t group = group_count; group > candidate + 1u; --group) {
        group_begin[group] = group_begin[group - 1u];
        group_end[group] = group_end[group - 1u];
        group_weight[group] = group_weight[group - 1u];
      }
      const std::uint32_t original_end = group_end[candidate];
      group_end[candidate] = split;
      group_weight[candidate] = best_left_weight;
      group_begin[candidate + 1u] = split;
      group_end[candidate + 1u] = original_end;
      group_weight[candidate + 1u] = candidate_weight - best_left_weight;
      ++group_count;
    }

    for (std::uint32_t group = 0u; group < group_count; ++group) {
      slot_stage_offsets_[group] = group_begin[group];
    }
    slot_stage_offsets_[group_count] = stage_count_;
    return true;
  }

  [[nodiscard]] std::uint32_t stageCount() const noexcept { return stage_count_; }
  [[nodiscard]] std::uint32_t slotCount() const noexcept { return slot_count_; }
  [[nodiscard]] std::uint32_t slotBegin(std::uint32_t slot) const noexcept {
    return slot_stage_offsets_[slot];
  }
  [[nodiscard]] std::uint32_t slotEnd(std::uint32_t slot) const noexcept {
    return slot_stage_offsets_[slot + 1u];
  }
  [[nodiscard]] const SchedulerStage &stage(std::uint32_t index) const noexcept {
    return stages_[index];
  }

private:
  [[nodiscard]] std::uint32_t groupsForCapacity(std::uint64_t capacity) const noexcept {
    std::uint32_t groups = 1u;
    std::uint64_t group_weight = 0u;
    for (std::uint32_t index = 0u; index < stage_count_; ++index) {
      const std::uint64_t weight = stages_[index].weight;
      if (group_weight != 0u && group_weight + weight > capacity) {
        ++groups;
        group_weight = 0u;
      }
      group_weight += weight;
    }
    return groups;
  }

  std::array<SchedulerStage, MaxStages> stages_{};
  std::array<std::uint32_t, MaxSlots + 1u> slot_stage_offsets_{};
  std::uint32_t stage_count_ = 0u;
  std::uint32_t slot_count_ = 0u;
  bool valid_ = true;
};

template <class Schedule, class Run>
void advanceStagedJob(bool &active, std::uint32_t &slot, std::uint32_t slot_count,
                      std::uint64_t absolute_sample, std::uint64_t job_start_sample,
                      std::uint32_t slot_samples, const Schedule &schedule, Run run) noexcept {
  if (slot_count == 0u || slot_samples == 0u) {
    active = false;
    return;
  }
  while (active && slot < slot_count &&
         absolute_sample - job_start_sample >=
             static_cast<std::uint64_t>(slot + 1u) * slot_samples) {
    const std::uint32_t end = schedule.slotEnd(slot);
    for (std::uint32_t stage = schedule.slotBegin(slot); stage < end; ++stage) {
      run(schedule.stage(stage));
    }
    ++slot;
    if (slot == slot_count) {
      active = false;
    }
  }
}

} // namespace effetune::dsp

#endif

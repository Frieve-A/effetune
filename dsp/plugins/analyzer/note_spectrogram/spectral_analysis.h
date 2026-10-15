#ifndef EFFETUNE_SPECTRAL_ANALYSIS_H
#define EFFETUNE_SPECTRAL_ANALYSIS_H

#include "binary_io.h"
#include "effetune/dsp/math.h"
#include "effetune/kernel.h"
#include "harmnet_frontend.h"
#include "harmnet_inference.h"
#include "timbre_analysis.h"
#include "timbre_tracking.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

namespace effetune {
struct NoteAnalysisFrame {
  std::uint32_t sampleOffset = 0u;
  std::array<float, 88> probabilities{};
  std::array<float, 88> levels{};
  std::array<float, 88> onsets{};
};
// Borrowed immutable frames committed during one process call.
struct NoteAnalysisView {
  const NoteAnalysisFrame *frames = nullptr;
  std::uint32_t count = 0u, minimumMidi = 28u, maximumMidi = 91u, blockFrames = 0u;
  double timeSeconds = -1.0;
  std::uint32_t channels = 0u, latencySamples = 0u;
};
} // namespace effetune
namespace effetune::plugins::analyzer {
namespace {
constexpr std::uint32_t kPitches = 88u, kFineDivisions = 5u, kFinePitches = 440u;
constexpr std::uint32_t kRevisionFrames = 8u, kPendingFrames = 32u;
constexpr std::uint32_t kTimbreDelay = TimbreAnalysis::kDelayFrames;
constexpr std::uint32_t kHistoryFrames = kRevisionFrames + 1u + kTimbreDelay;
constexpr std::uint32_t kRevisionAgeOffset = 28u, kConfidenceOffset = 32u;
constexpr std::uint32_t kLevelOffset = kConfidenceOffset + 4u * kFinePitches;
constexpr std::uint32_t kRevisedOffset = kLevelOffset + 4u * kFinePitches;
constexpr std::uint32_t kIntermediateOffset = kRevisedOffset + 4u * kFinePitches;
constexpr std::uint32_t kRevisionBytes = 4u + 4u * kFinePitches;
constexpr std::array<std::uint32_t, 2> kIntermediateAges = {2u, 4u};
constexpr std::uint32_t kSynthesisRevisionAge = kIntermediateAges[0];
constexpr std::uint32_t kPitchCentsOffset = kIntermediateOffset + 2u * kRevisionBytes;
constexpr std::uint32_t kPayloadBytes = kPitchCentsOffset + 4u * kPitches;
using binary_io::writeF32;
using binary_io::writeU16;
using binary_io::writeU32;
using Stage = NoteSpectrogramStage;
} // namespace

class SpectralAnalysis final {
public:
  bool ready() const noexcept { return ready_; }
  const NoteAnalysisView &view() const noexcept { return view_; }
  std::uint32_t hopSamples() const noexcept { return hop_; }
  void setTimbreEnabled(bool enabled) noexcept {
    if (timbre_requested_ == enabled)
      return;
    timbre_requested_ = enabled;
    resetTimbre();
  }

  const TimbreAnalysis *timbreAnalysis() const noexcept { return timbre_.get(); }
  std::uint32_t latencySamples() const noexcept {
    // Match the long-window peak, distributed computation, and shortest revised head.
    return HarmNetFrontend::referenceDelaySamples(rate_, true) + slots_ * 16u +
           kSynthesisRevisionAge * hop_;
  }
  bool configure(std::uint32_t minimum_midi, std::uint32_t maximum_midi) noexcept {
    const auto minimum = minimum_midi - 21u, maximum = maximum_midi - 21u;
    if (minimum == minimum_pitch_ && maximum == maximum_pitch_)
      return false;
    minimum_pitch_ = minimum;
    maximum_pitch_ = maximum;
    schedule_dirty_ = true;
    return true;
  }
  void prepare(const PrepareInfo &info) {
    ready_ = false;
    rate_ = info.sampleRate > 0.0F ? info.sampleRate : 48000.0F;
    hop_ = std::clamp(static_cast<std::uint32_t>(std::round(rate_ * .02)), 16u, 8192u);
    slots_ = hop_ / 16u;
    for (auto resolution = 0u; resolution < 2u; ++resolution) {
      frontends_[resolution] = std::make_unique<HarmNetFrontend>();
      if (!frontends_[resolution]->prepare(rate_, resolution == 1u))
        return;
    }
    timbre_enabled_ = timbre_requested_;
    network_ = std::make_unique<HarmNetInference>();
    network_->setEventEnabled(timbre_enabled_);
    timbre_ = std::make_unique<TimbreAnalysis>();
    schedule_ = std::make_unique<Schedule>();
    published_.resize(kPendingFrames);
    for (auto &frame : published_)
      frame.resize(kPayloadBytes);
    staging_.resize(kPayloadBytes);
    analysis_frames_.resize(info.maxFrames / hop_ + 2u);
    ready_ = buildSchedule();
    reset(1u);
  }
  void reset(std::uint32_t generation) noexcept {
    generation_ = generation;
    view_ = {};
    until_frame_ = hop_;
    frame_index_ = 0u;
    pending_read_ = pending_write_ = pending_count_ = 0u;
    history_head_ = history_frames_ = 0u;
    job_active_ = false;
    if (network_)
      network_->reset();
    for (auto &frontend : frontends_)
      if (frontend)
        frontend->reset();
    for (auto &frame : fine_history_)
      frame.fill(0.0F);
    for (auto &frame : level_history_)
      frame.fill(-240.0F);
    below_floor_.fill(true);
    resetTimbre();
  }
  void process(float *audio, std::uint32_t channels, std::uint32_t frames,
               const ProcessInfo &info) noexcept {
    view_ = {analysis_frames_.data(), 0u,       minimum_pitch_ + 21u, maximum_pitch_ + 21u, frames,
             info.timeSeconds,        channels, latencySamples()};
    if (!ready_ || !audio || channels == 0u)
      return;
    auto frame = 0u;
    while (frame < frames) {
      auto run = std::min(frames - frame, until_frame_);
      if (job_active_)
        run = std::min(run, until_slot_);
      const auto end = frame + run;
      for (; frame < end; ++frame) {
        const auto left = std::isfinite(audio[frame]) ? audio[frame] : 0.0F;
        const auto value = channels > 1u ? audio[frames + frame] : left;
        const auto right = std::isfinite(value) ? value : 0.0F;
        const auto mono = .5F * left + .5F * right;
        for (auto &frontend : frontends_)
          frontend->push(mono);
      }
      until_frame_ -= run;
      if (job_active_) {
        until_slot_ -= run;
        if (until_slot_ == 0u) {
          commit_offset_ = frame;
          for (auto stage = schedule_->slotBegin(job_slot_); stage < schedule_->slotEnd(job_slot_);
               ++stage)
            runStage(schedule_->stage(stage));
          runTimbreChunks();
          job_active_ = ++job_slot_ < slots_;
          until_slot_ = 16u;
        }
      }
      if (until_frame_ == 0u) {
        startJob(info.timeSeconds + static_cast<double>(frame) / rate_);
        until_frame_ = hop_;
      }
    }
  }
  void writeTelemetry(TelemetryWriter &writer) noexcept {
    while (ready_ && pending_count_ != 0u) {
      if (!writer.write(24u, 6u, published_[pending_read_].data(), kPayloadBytes))
        return;
      pending_read_ = (pending_read_ + 1u) % kPendingFrames;
      --pending_count_;
    }
    while (ready_ && timbre_pending_count_) {
      if (!writer.write(31u, 1u, timbre_pending_[timbre_pending_read_].data(), 80u))
        return;
      timbre_pending_read_ = (timbre_pending_read_ + 1u) % kTimbrePending;
      --timbre_pending_count_;
    }
  }

private:
  void resetTimbre() noexcept {
    advance_active_ = false;
    if (network_)
      network_->resetEvent();
    if (timbre_)
      timbre_->reset(frame_index_);
    for (auto &rule : timbre_rules_)
      rule.reset();
    timbre_enabled_frame_ = frame_index_;
    timbre_pending_read_ = timbre_pending_write_ = timbre_pending_count_ = 0u;
  }
  void publishTimbre(const TimbreAnalysis::Result &result) noexcept {
    if (timbre_pending_count_ == kTimbrePending) {
      timbre_pending_read_ = (timbre_pending_read_ + 1u) % kTimbrePending;
      --timbre_pending_count_;
    }
    auto &payload = timbre_pending_[timbre_pending_write_];
    writeF32(payload.data(), rate_);
    writeF32(payload.data() + 4u, timbre_time_);
    writeF32(payload.data() + 8u, static_cast<float>(hop_) / rate_);
    writeU32(payload.data() + 12u, generation_);
    writeU32(payload.data() + 16u, frame_index_ - 1u - kTimbreDelay);
    writeU32(payload.data() + 20u, result.noteId);
    writeU32(payload.data() + 24u, result.midi);
    writeU32(payload.data() + 28u, result.event);
    writeU32(payload.data() + 32u, result.start);
    writeU32(payload.data() + 36u, result.end);
    for (auto i = 0u; i < 9u; ++i)
      writeF32(payload.data() + 40u + i * 4u, result.probabilities[i]);
    writeU32(payload.data() + 76u, 0u);
    timbre_pending_write_ = (timbre_pending_write_ + 1u) % kTimbrePending;
    ++timbre_pending_count_;
  }
  void processTimbre(std::uint32_t pitch) noexcept {
    if (frame_index_ <= kTimbreDelay)
      return;
    const auto index = frame_index_ - 1u - kTimbreDelay;
    constexpr auto onset_age = kRevisionFrames - 1u + kTimbreDelay;
    const auto onset_frame = (history_head_ + kHistoryFrames - onset_age) % kHistoryFrames;
    const auto onset = below_floor_[onset_frame] || pitch + 21u > harmnet_weights::kOnsetMaximumMidi
                           ? 0.0F
                           : network_->eventOnset(pitch);
    if (index < kRevisionFrames)
      return;
    const auto confirmed = index - kRevisionFrames;
    const auto pitch_frame =
        (history_head_ + kHistoryFrames - kRevisionFrames - kTimbreDelay) % kHistoryFrames;
    float shape = 0.0F;
    for (auto fine = 0u; fine < kFineDivisions; ++fine)
      if (fine_history_[pitch_frame][pitch * kFineDivisions + fine] > shape)
        shape = fine_history_[pitch_frame][pitch * kFineDivisions + fine];
    const auto probability =
        below_floor_[pitch_frame]
            ? 0.0F
            : shape * network_->probability(pitch, HarmNetInference::kHeads - 1u);
    // Raw age7 plus previous-peak confirmation aligns with the age8 presence decision.
    const auto prime = confirmed <= timbre_enabled_frame_;
    const auto decision = timbre_rules_[pitch].step(probability, onset, prime);
    const auto emit = [this](const auto &result) { publishTimbre(result); };
    if (prime)
      return;
    if (decision.end)
      timbre_->stop(pitch, confirmed, emit);
    if (decision.start)
      timbre_->start(pitch, confirmed, emit);
  }
  bool buildSchedule() {
    schedule_->clear();
    const auto weight = [](double value) {
      return static_cast<std::uint32_t>(std::max(1.0, std::round(value)));
    };
    const auto addPitch = [&](Stage kind, std::uint32_t pitch, double cost) {
      schedule_->addStage(static_cast<std::uint8_t>(kind), 0u, pitch, pitch + 1u, weight(cost));
    };
    if (timbre_enabled_) {
      for (auto p = minimum_pitch_; p <= maximum_pitch_; ++p)
        addPitch(Stage::Event, p, 451.207);
      for (auto p = minimum_pitch_; p <= maximum_pitch_; ++p)
        addPitch(Stage::Rule, p, 26.8278);
    }
    for (auto resolution = 0u; resolution < 2u; ++resolution)
      frontends_[resolution]->appendStages(*schedule_, resolution, slots_);
    constexpr std::array<double, 8> convolution = {135.041, 229.243, 236.24,  234.124,
                                                   236.24,  247.303, 255.763, 272.196};
    for (auto layer = 0u; layer < HarmNetInference::kLayers; ++layer)
      for (auto begin = 0u; begin < 300u; begin += 10u)
        schedule_->addStage(static_cast<std::uint8_t>(Stage::Convolution), layer, begin,
                            begin + 10u, weight(10u * convolution[layer]));
    const auto gather_min = minimum_pitch_ >= 24u ? minimum_pitch_ - 24u : 0u;
    const auto gather_max = std::min(kPitches, maximum_pitch_ + 25u);
    for (auto p = 0u; p < kPitches; ++p) {
      auto taps = 0u;
      if (p >= gather_min && p < gather_max)
        for (const auto start : harmnet_weights::kGatherStarts) {
          const auto bin = static_cast<int>(3u * p) + start;
          taps += bin >= 0 && bin < 300 ? 1u : 0u;
        }
      addPitch(Stage::Gather, p, 57.8351 * taps + 169.498);
    }
    for (auto p = 0u; p < kPitches; ++p) {
      auto offsets = 0u;
      if (p >= minimum_pitch_ && p <= maximum_pitch_)
        for (const auto offset : harmnet_weights::kIntervalOffsets) {
          const auto pitch = static_cast<int>(p) + offset;
          offsets += pitch >= 0 && pitch < static_cast<int>(kPitches) ? 1u : 0u;
        }
      addPitch(Stage::PitchConvolution, p, 35.4587 * offsets + 206.37);
    }
    for (auto p = 0u; p < kPitches; ++p)
      addPitch(Stage::Recurrent, p, p >= minimum_pitch_ && p <= maximum_pitch_ ? 2233.01 : 0.0);
    for (auto p = 0u; p < kPitches; ++p)
      addPitch(Stage::Fine, p, p >= minimum_pitch_ && p <= maximum_pitch_ ? 888.961 : 0.0);
    schedule_->addStage(static_cast<std::uint8_t>(Stage::Publish), 0u, 0u, 0u, weight(1480.59));
    schedule_->addStage(static_cast<std::uint8_t>(Stage::Commit), 0u, 0u, 0u, weight(566.454));
    if (!schedule_->partition(slots_))
      return false;
    rule_slot_ = 0u;
    slot_weights_.fill(0.0);
    for (auto slot = 0u; slot < slots_; ++slot)
      for (auto i = schedule_->slotBegin(slot); i < schedule_->slotEnd(slot); ++i) {
        const auto &stage = schedule_->stage(i);
        slot_weights_[slot] += stage.weight;
        if (static_cast<Stage>(stage.kind) == Stage::Rule)
          rule_slot_ = slot;
      }
    std::copy(slot_weights_.begin() + rule_slot_, slot_weights_.begin() + slots_,
              sorted_slot_weights_.begin());
    std::sort(sorted_slot_weights_.begin(), sorted_slot_weights_.begin() + slots_ - rule_slot_);
    schedule_dirty_ = false;
    return true;
  }
  void beginTimbreAdvance() noexcept {
    if (frame_index_ <= kRevisionFrames + kTimbreDelay)
      return;
    timbre_->beginAdvance(frame_index_ - 1u - kRevisionFrames - kTimbreDelay);
    advance_active_ = true;
    advance_done_ = advance_quota_ = 0.0;
    const auto count = slots_ - rule_slot_;
    auto sum = timbre_->advanceCost();
    for (auto i = 0u; i < count; ++i) {
      sum += sorted_slot_weights_[i];
      advance_level_ = sum / (i + 1u);
      if (i + 1u == count || advance_level_ <= sorted_slot_weights_[i + 1u])
        break;
    }
  }
  void runTimbreChunks() noexcept {
    if (!advance_active_ || job_slot_ < rule_slot_)
      return;
    const auto room = advance_level_ - slot_weights_[job_slot_];
    advance_quota_ += room > 0.0 ? room : 0.0;
    while (timbre_->advancePending()) {
      const auto cost = timbre_->nextAdvanceCost();
      if (job_slot_ + 1u < slots_ && advance_done_ + cost * .5 > advance_quota_)
        break;
      timbre_->advanceChunk([this](const auto &result) { publishTimbre(result); });
      advance_done_ += cost;
    }
    advance_active_ = timbre_->advancePending();
  }
  void startJob(double time) noexcept {
    if (timbre_enabled_ != timbre_requested_) {
      timbre_enabled_ = timbre_requested_;
      network_->setEventEnabled(timbre_enabled_);
      resetTimbre();
      schedule_dirty_ = true;
    }
    if (schedule_dirty_ && !buildSchedule()) {
      ready_ = false;
      return;
    }
    job_active_ = true;
    for (auto &frontend : frontends_)
      job_active_ = frontend->begin() && job_active_;
    if (!job_active_) {
      ready_ = false;
      return;
    }
    network_->begin();
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
    if (timbre_enabled_) {
      timbre_->beginFrame(frame_index_ - 1u);
      timbre_time_ = static_cast<float>(time - static_cast<double>(kTimbreDelay * hop_) / rate_);
    }
    fine_history_[history_head_].fill(0.0F);
    level_history_[history_head_].fill(-240.0F);
    below_floor_[history_head_] = frontends_[0]->belowFloor();
    for (auto cell = 0u; cell < kFinePitches; ++cell)
      writeF32(staging_.data() + kLevelOffset + cell * 4u, -240.0F);
    std::fill_n(staging_.begin() + kPitchCentsOffset, 4u * kPitches, std::uint8_t{0});
  }
  void runStage(const ::effetune::dsp::SchedulerStage &stage) noexcept {
    const auto kind = static_cast<Stage>(stage.kind);
    if (kind <= Stage::Prefix) {
      if (!frontends_[stage.channel]->run(kind, stage.begin, stage.end,
                                          features_[stage.channel].data()))
        ready_ = false;
      if (kind == Stage::Features)
        network_->setInput(stage.channel, features_[stage.channel].data(), stage.begin, stage.end);
      return;
    }
    auto begin = stage.begin, end = stage.end;
    if (kind >= Stage::Gather && kind <= Stage::Fine) {
      const auto low = kind == Stage::Gather && minimum_pitch_ >= 24u ? minimum_pitch_ - 24u
                       : kind == Stage::Gather                        ? 0u
                                                                      : minimum_pitch_;
      const auto high =
          kind == Stage::Gather ? std::min(kPitches, maximum_pitch_ + 25u) : maximum_pitch_ + 1u;
      begin = std::max(begin, low);
      end = std::min(end, high);
    }
    switch (kind) {
    case Stage::Event:
      if (!timbre_enabled_ || !timbre_requested_)
        break;
      if (frame_index_ > kTimbreDelay && frame_index_ - 1u - kTimbreDelay >= timbre_enabled_frame_)
        network_->inferEvents(begin, end);
      break;
    case Stage::Rule:
      if (!timbre_enabled_ || !timbre_requested_)
        break;
      if (frame_index_ > kTimbreDelay && frame_index_ - 1u - kTimbreDelay >= timbre_enabled_frame_)
        for (auto pitch = begin; pitch < end; ++pitch)
          processTimbre(pitch);
      if (end == maximum_pitch_ + 1u)
        beginTimbreAdvance();
      break;
    case Stage::Convolution:
      network_->convolution(stage.channel, begin, end);
      break;
    case Stage::Gather:
      network_->gather(begin, end);
      break;
    case Stage::PitchConvolution:
      network_->pitchConvolution(begin, end);
      break;
    case Stage::Recurrent:
      if (timbre_enabled_ && timbre_requested_ && stage.begin == 0u) {
        network_->updateEventFlux(features_[0].data());
        TimbreAnalysis::setInput(timbre_->frame(frame_index_ - 1u), features_[0].data(),
                                 features_[1].data());
      }
      network_->recurrent(begin, end);
      if (timbre_enabled_ && timbre_requested_)
        for (auto pitch = begin; pitch < end; ++pitch) {
          auto &frame = timbre_->frame(frame_index_ - 1u);
          network_->copyTimbreFeatures(pitch, frame.a.data() + pitch * 216u,
                                       frame.c.data() + pitch * 64u);
        }
      break;
    case Stage::Fine:
      for (auto pitch = begin; pitch < end; ++pitch) {
        auto *shape = fine_history_[history_head_].data() + pitch * kFineDivisions;
        const auto cents = frontends_[1]->fineShape(pitch, shape);
        if (below_floor_[history_head_])
          continue;
        writeF32(staging_.data() + kPitchCentsOffset + pitch * 4u, cents);
        auto strongest = 0u;
        for (auto division = 0u; division < kFineDivisions; ++division) {
          const auto value = level(pitch, division);
          writeF32(staging_.data() + kLevelOffset + (pitch * kFineDivisions + division) * 4u,
                   value);
          if (division == 0u || shape[division] > shape[strongest]) {
            strongest = division;
            level_history_[history_head_][pitch] = value;
          }
        }
      }
      break;
    case Stage::Publish: {
      const auto oldest = (history_head_ + kHistoryFrames - kRevisionFrames) % kHistoryFrames;
      const auto revised = history_frames_ >= kRevisionFrames;
      writeU32(staging_.data() + kRevisionAgeOffset, revised ? kRevisionFrames : 0u);
      publishConfidences(kConfidenceOffset, history_head_, 0u);
      if (revised)
        publishConfidences(kRevisedOffset, oldest, HarmNetInference::kHeads - 1u);
      else
        std::fill_n(staging_.begin() + kRevisedOffset, 4u * kFinePitches, std::uint8_t{0});
      for (auto i = 0u; i < kIntermediateAges.size(); ++i) {
        const auto age = kIntermediateAges[i], offset = kIntermediateOffset + i * kRevisionBytes;
        const auto available = history_frames_ >= age;
        writeU32(staging_.data() + offset, available ? age : 0u);
        if (available)
          publishConfidences(offset + 4u, (history_head_ + kHistoryFrames - age) % kHistoryFrames,
                             i + 1u);
        else
          std::fill_n(staging_.begin() + offset + 4u, 4u * kFinePitches, std::uint8_t{0});
      }
      history_head_ = (history_head_ + 1u) % kHistoryFrames;
      history_frames_ += revised ? 0u : 1u;
      break;
    }
    case Stage::Commit:
      if (view_.count < analysis_frames_.size()) {
        auto &frame = analysis_frames_[view_.count++];
        frame.sampleOffset = commit_offset_;
        const auto level_frame =
            (history_head_ + kHistoryFrames - 1u - kSynthesisRevisionAge) % kHistoryFrames;
        const auto onset_frame = (history_head_ + kHistoryFrames - 2u) % kHistoryFrames;
        for (auto pitch = 0u; pitch < kPitches; ++pitch) {
          float probability = 0.0F;
          for (auto fine = 0u; fine < kFineDivisions; ++fine) {
            const auto cell = pitch * kFineDivisions + fine;
            float value;
            std::memcpy(&value, staging_.data() + kIntermediateOffset + 4u + cell * 4u, 4u);
            if (value > probability)
              probability = value;
          }
          frame.probabilities[pitch] = probability;
          frame.levels[pitch] = level_history_[level_frame][pitch];
          frame.onsets[pitch] =
              below_floor_[onset_frame] || pitch < minimum_pitch_ || pitch > maximum_pitch_
                  ? 0.0F
                  : network_->onset(pitch);
        }
      }
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
  void publishConfidences(std::uint32_t offset, std::uint32_t frame, std::uint32_t head) noexcept {
    for (auto pitch = 0u; pitch < kPitches; ++pitch) {
      const auto probability =
          below_floor_[frame] || pitch < minimum_pitch_ || pitch > maximum_pitch_
              ? 0.0F
              : network_->probability(pitch, head);
      for (auto division = 0u; division < kFineDivisions; ++division) {
        const auto cell = pitch * kFineDivisions + division;
        writeF32(staging_.data() + offset + cell * 4u, fine_history_[frame][cell] * probability);
      }
    }
  }
  float level(std::uint32_t pitch, std::uint32_t division) const noexcept {
    constexpr double cents_ratio = 1.029302236643492;
    const auto midi = 21.0 + pitch + (static_cast<double>(division) - 2.0) / kFineDivisions;
    const auto fundamental = 440.0 * std::exp2((midi - 69.0) / 12.0),
               bin_hz = frontends_[0]->binHz();
    const auto &prefix = frontends_[0]->powerPrefix();
    const auto last_bin = static_cast<std::uint32_t>(prefix.size() - 2u);
    double power = 0.0;
    for (auto harmonic = 1u; harmonic <= 16u; ++harmonic) {
      const auto frequency = harmonic * fundamental;
      if (frequency >= rate_ * .5)
        break;
      const auto center = frequency / bin_hz, a = frequency / cents_ratio / bin_hz,
                 b = frequency * cents_ratio / bin_hz;
      const auto lower = a < center - 2.0 ? a : center - 2.0,
                 upper = b > center + 2.0 ? b : center + 2.0;
      const auto begin = static_cast<std::uint32_t>(lower > 0.0 ? std::floor(lower) : 0.0);
      const auto end = std::min(last_bin, static_cast<std::uint32_t>(std::ceil(upper)));
      if (begin <= end)
        power += prefix[end + 1u] - prefix[begin];
    }
    const auto raw =
        ::effetune::dsp::lin_to_db(std::sqrt(power * frontends_[0]->amplitudePowerScale()));
    const auto corrected =
        raw > -240.0 ? raw + 3.0 * std::log2((fundamental > 100.0 ? fundamental : 100.0) / 100.0)
                     : raw;
    return static_cast<float>(corrected > -240.0 ? corrected : -240.0);
  }
  using Schedule = ::effetune::dsp::StageSchedule<32768u, 512u>;
  std::array<std::unique_ptr<HarmNetFrontend>, 2> frontends_;
  std::unique_ptr<HarmNetInference> network_;
  std::unique_ptr<TimbreAnalysis> timbre_;
  std::array<TimbreTracking, kPitches> timbre_rules_{};
  static constexpr std::uint32_t kTimbrePending = 2048u;
  std::array<std::array<std::uint8_t, 80>, kTimbrePending> timbre_pending_{};
  std::uint32_t timbre_pending_read_ = 0u, timbre_pending_write_ = 0u, timbre_pending_count_ = 0u;
  std::uint32_t timbre_enabled_frame_ = 0u;
  float timbre_time_ = 0.0F;
  bool timbre_enabled_ = false, timbre_requested_ = false, schedule_dirty_ = true;
  bool advance_active_ = false;
  std::uint32_t rule_slot_ = 0u;
  std::array<double, 512> slot_weights_{}, sorted_slot_weights_{};
  double advance_done_ = 0.0, advance_quota_ = 0.0, advance_level_ = 0.0;
  std::unique_ptr<Schedule> schedule_;
  std::array<std::array<float, 300>, 2> features_{};
  std::array<std::array<float, kFinePitches>, kHistoryFrames> fine_history_{};
  std::array<std::array<float, kPitches>, kHistoryFrames> level_history_{};
  std::array<bool, kHistoryFrames> below_floor_{};
  std::vector<std::vector<std::uint8_t>> published_;
  std::vector<std::uint8_t> staging_;
  float rate_ = 48000.0F;
  std::uint32_t hop_ = 960u, slots_ = 60u, generation_ = 1u, frame_index_ = 0u;
  std::uint32_t until_frame_ = 960u, until_slot_ = 16u, job_slot_ = 0u;
  std::uint32_t pending_read_ = 0u, pending_write_ = 0u, pending_count_ = 0u;
  std::uint32_t history_head_ = 0u, history_frames_ = 0u, minimum_pitch_ = 7u, maximum_pitch_ = 70u;
  bool ready_ = false, job_active_ = false;
  std::vector<NoteAnalysisFrame> analysis_frames_;
  NoteAnalysisView view_{};
  std::uint32_t commit_offset_ = 0u;
};

} // namespace effetune::plugins::analyzer
#endif

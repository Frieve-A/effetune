#ifndef EFFETUNE_SPECTRAL_ANALYSIS_H
#define EFFETUNE_SPECTRAL_ANALYSIS_H

#include "binary_io.h"
#include "effetune/dsp/math.h"
#include "effetune/kernel.h"
#include "harmnet_frontend.h"
#include "harmnet_inference.h"
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
constexpr std::uint32_t kRevisionAgeOffset = 28u, kConfidenceOffset = 32u;
constexpr std::uint32_t kLevelOffset = kConfidenceOffset + 4u * kFinePitches;
constexpr std::uint32_t kRevisedOffset = kLevelOffset + 4u * kFinePitches;
constexpr std::uint32_t kIntermediateOffset = kRevisedOffset + 4u * kFinePitches;
constexpr std::uint32_t kRevisionBytes = 4u + 4u * kFinePitches;
constexpr std::array<std::uint32_t, 2> kIntermediateAges = {2u, 4u};
constexpr std::uint32_t kSynthesisRevisionAge = kIntermediateAges[0];
constexpr std::uint32_t kPayloadBytes = kIntermediateOffset + 2u * kRevisionBytes;
using binary_io::writeF32;
using binary_io::writeU16;
using binary_io::writeU32;
using Stage = NoteSpectrogramStage;
} // namespace

class SpectralAnalysis final {
public:
  bool ready() const noexcept { return ready_; }
  const NoteAnalysisView &view() const noexcept { return view_; }
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
    network_ = std::make_unique<HarmNetInference>();
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
      if (!writer.write(24u, 5u, published_[pending_read_].data(), kPayloadBytes))
        return;
      pending_read_ = (pending_read_ + 1u) % kPendingFrames;
      --pending_count_;
    }
  }

private:
  bool buildSchedule() {
    schedule_->clear();
    for (auto resolution = 0u; resolution < 2u; ++resolution)
      frontends_[resolution]->appendStages(*schedule_, resolution, slots_);
    const auto add = [&](Stage kind, auto lane, auto count, auto chunk_size, auto weight) {
      for (auto begin = 0u; begin < count; begin += chunk_size) {
        const auto end = std::min(count, begin + chunk_size);
        schedule_->addStage(static_cast<std::uint8_t>(kind), lane, begin, end,
                            weight * (end - begin));
      }
    };
    for (auto layer = 0u; layer < 3u; ++layer)
      add(Stage::Convolution, layer, 300u, 10u, layer == 0u ? 672u : 3840u);
    add(Stage::Gather, 0u, kPitches, 1u, 6912u);
    add(Stage::PitchConvolution, 0u, kPitches, 1u, 11520u);
    add(Stage::Recurrent, 0u, kPitches, 1u, 13824u);
    add(Stage::Fine, 0u, kPitches, 1u, 1500u);
    schedule_->addStage(static_cast<std::uint8_t>(Stage::Publish), 0u, 0u, 0u, 15000u);
    schedule_->addStage(static_cast<std::uint8_t>(Stage::Commit), 0u, 0u, 0u, 1u);
    return schedule_->partition(slots_);
  }
  void startJob(double time) noexcept {
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
    fine_history_[history_head_].fill(0.0F);
    level_history_[history_head_].fill(-240.0F);
    below_floor_[history_head_] = frontends_[0]->belowFloor();
    for (auto cell = 0u; cell < kFinePitches; ++cell)
      writeF32(staging_.data() + kLevelOffset + cell * 4u, -240.0F);
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
      const auto low = kind == Stage::Gather && minimum_pitch_ >= 2u ? minimum_pitch_ - 2u
                       : kind == Stage::Gather                       ? 0u
                                                                     : minimum_pitch_;
      const auto high =
          kind == Stage::Gather ? std::min(kPitches, maximum_pitch_ + 3u) : maximum_pitch_ + 1u;
      begin = std::max(begin, low);
      end = std::min(end, high);
    }
    switch (kind) {
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
      network_->recurrent(begin, end);
      break;
    case Stage::Fine:
      for (auto pitch = begin; pitch < end; ++pitch) {
        auto *shape = fine_history_[history_head_].data() + pitch * kFineDivisions;
        frontends_[1]->fineShape(pitch, shape);
        if (below_floor_[history_head_])
          continue;
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
      const auto oldest = (history_head_ + 1u) % (kRevisionFrames + 1u);
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
          publishConfidences(offset + 4u,
                             (history_head_ + kRevisionFrames + 1u - age) % (kRevisionFrames + 1u),
                             i + 1u);
        else
          std::fill_n(staging_.begin() + offset + 4u, 4u * kFinePitches, std::uint8_t{0});
      }
      history_head_ = oldest;
      history_frames_ += revised ? 0u : 1u;
      break;
    }
    case Stage::Commit:
      if (view_.count < analysis_frames_.size()) {
        auto &frame = analysis_frames_[view_.count++];
        frame.sampleOffset = commit_offset_;
        const auto level_frame =
            (history_head_ + kRevisionFrames - kSynthesisRevisionAge) % (kRevisionFrames + 1u);
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
  std::unique_ptr<Schedule> schedule_;
  std::array<std::array<float, 300>, 2> features_{};
  std::array<std::array<float, kFinePitches>, kRevisionFrames + 1u> fine_history_{};
  std::array<std::array<float, kPitches>, kRevisionFrames + 1u> level_history_{};
  std::array<bool, kRevisionFrames + 1u> below_floor_{};
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

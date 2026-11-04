#ifndef EFFETUNE_SFZ_SCRIPT_SESSION_H
#define EFFETUNE_SFZ_SCRIPT_SESSION_H
#include "script_vm.h"
#include "script_voice_automation.h"
#include <array>
#include <cstdint>
#include <limits>

namespace effetune::plugins::others::sfz {
inline constexpr std::uint32_t kScriptNotes = 1024u;
inline constexpr std::uint32_t kScriptScheduled = 1024u;
struct ScriptVoiceControl {
  double value = 0;
  std::uint32_t flags = 0;
  bool active() const noexcept { return (flags & 1u) != 0u; }
  bool absolute() const noexcept { return (flags & 2u) != 0u; }
  bool final() const noexcept { return (flags & 4u) != 0u; }
  double apply(double modulated, double patch) const noexcept {
    return !active() ? modulated : absolute() ? value : (final() ? patch : modulated) * value;
  }
};
struct ScriptNote {
  std::uint32_t id = 0, key = 0, pitch = 0, velocity = 0, channel = 0, parent = 0, marks = 0;
  std::uint64_t order = 0, birthFrame = 0;
  bool keyDown = false, physicalDown = false, generated = false, ignored = false,
       wholeSample = false;
  // Transient admission is never observable by a checkpoint.
  bool queued = false;
  std::uint32_t sourcePending = 0;
  // -1 retains the region's sample offset. A script offset is in seconds.
  double sampleOffset = -1.0;
  script::VoiceAutomation automation;
  std::array<ScriptVoiceControl, 16> controls{};
  std::array<std::int64_t, 4> user{};
};
struct ScriptScheduled {
  std::uint64_t frame = 0, order = 0;
  std::uint32_t id = 0;
};
enum class ScriptEmissionKind : std::uint32_t { Note, Controller, Release };
struct ScriptEmission {
  ScriptEmissionKind kind = ScriptEmissionKind::Note;
  std::uint32_t id = 0, message = 0;
  std::uint64_t frame = 0;
};
struct ScriptSession {
  script::VM vm;
  std::array<ScriptNote, kScriptNotes> notes{};
  std::array<ScriptScheduled, kScriptScheduled> scheduled{};
  std::array<ScriptEmission, kScriptScheduled> emissions{};
  std::uint32_t emissionHead = 0, emissionCount = 0;
  std::uint32_t nextNote = 0x40000000u;
  std::uint64_t nextOrder = 1;
  bool failed = false, suppressed = false;

  ScriptNote *find(std::uint32_t id) noexcept {
    if (id)
      for (auto &note : notes)
        if (note.id == id)
          return &note;
    return nullptr;
  }
  const ScriptNote *find(std::uint32_t id) const noexcept {
    return const_cast<ScriptSession *>(this)->find(id);
  }
  ScriptNote *allocate(std::uint32_t id) noexcept {
    if (find(id))
      return nullptr;
    for (auto &note : notes)
      if (!note.id) {
        note = {};
        note.id = id;
        note.order = nextOrder++;
        return &note;
      }
    return nullptr;
  }
  bool schedule(std::uint32_t id, std::uint64_t frame) noexcept {
    for (auto &event : scheduled)
      if (!event.id) {
        event = {frame, nextOrder++, id};
        return true;
      }
    return false;
  }
  bool emit(ScriptEmissionKind kind, std::uint32_t id, std::uint32_t message,
            std::uint64_t frame) noexcept {
    if (emissionCount == kScriptScheduled)
      return false;
    emissions[(emissionHead + emissionCount) % kScriptScheduled] = {kind, id, message, frame};
    ++emissionCount;
    return true;
  }
  std::uint64_t nextFrame() const noexcept {
    auto next = vm.nextFrame();
    for (const auto &event : scheduled)
      if (event.id && event.frame < next)
        next = event.frame;
    return next;
  }
  void reset(const script::Program &program, float rate, std::uint32_t seed) noexcept {
    notes.fill({});
    scheduled.fill({});
    nextNote = 0x40000000u;
    nextOrder = 1;
    failed = suppressed = false;
    emissionHead = emissionCount = 0;
    vm.bind(&program, rate, seed);
  }
  template <bool Reading> void checkpoint(script::CheckpointIO<Reading> &io) noexcept {
    if (emissionCount || vm.hasPendingBudget())
      io.ok = false;
    io.field(nextNote);
    io.field(nextOrder);
    io.field(failed);
    for (auto &note : notes) {
      if constexpr (Reading) {
        note.queued = false;
        note.sourcePending = 0;
      } else if (note.queued || note.sourcePending)
        io.ok = false;
      io.field(note.id);
      io.field(note.key);
      io.field(note.pitch);
      io.field(note.velocity);
      io.field(note.channel);
      io.field(note.parent);
      io.field(note.marks);
      io.field(note.order);
      io.field(note.birthFrame);
      io.field(note.keyDown);
      io.field(note.physicalDown);
      io.field(note.generated);
      io.field(note.ignored);
      io.field(note.wholeSample);
      io.field(note.sampleOffset);
      for (auto *lane : {&note.automation.gain, &note.automation.tune, &note.automation.pan}) {
        io.field(lane->startValue);
        io.field(lane->target);
        io.field(lane->startFrame);
        io.field(lane->endFrame);
        io.field(lane->curve);
        io.field(lane->startRelative);
        io.field(lane->startAbsolute);
        io.field(lane->finalMix);
      }
      io.field(note.automation.gainSeconds);
      io.field(note.automation.tuneSeconds);
      io.field(note.automation.panSeconds);
      io.field(note.automation.gainCurve);
      io.field(note.automation.tuneCurve);
      io.field(note.automation.panCurve);
      io.field(note.automation.stopFrame);
      io.field(note.automation.stopOnFade);
      for (auto &control : note.controls) {
        io.field(control.value);
        io.field(control.flags);
        if (!std::isfinite(control.value) || control.value < 0 || control.flags > 7)
          io.ok = false;
      }
      if (!note.automation.valid())
        io.ok = false;
      for (auto &value : note.user)
        io.field(value);
    }
    for (auto &event : scheduled) {
      io.field(event.frame);
      io.field(event.order);
      io.field(event.id);
    }
  }
  static std::uint32_t checkpointBytes() noexcept {
    // The outer serializer supplies storage. The wire sizes are explicit, not sizeof(struct).
    // CheckpointIO encodes booleans and enums as u32, including automation flags.
    return 16u + kScriptNotes * 524u + kScriptScheduled * 20u;
  }
};
} // namespace effetune::plugins::others::sfz
#endif

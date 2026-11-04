#include "../../dsp/plugins/others/sfz/script_voice_automation.h"
#include <fstream>
#include <iostream>
#include <memory>
#include <thread>
#include <vector>

using namespace effetune::plugins::others::sfz::script;

bool testParameters() {
  Value args[3];
  args[0] = Value::fromInteger(1);
  VoiceChange change;
  const auto decode = [&](Builtin fn, double value, std::uint32_t flags = 0,
                          std::uint32_t count = 2) {
    args[1] = std::floor(value) == value
                  ? Value::fromInteger(static_cast<std::int64_t>(value), flags)
                  : Value::fromReal(value, flags);
    return decodeVoiceChange(fn, args, count, change);
  };
  const auto near = [](double a, double b) { return std::abs(a - b) < 1e-10; };
  if (!decode(Builtin::ChangeVol, -6000) ||
      !near(change.value, std::pow(10.0, -.3)) ||
      !decode(Builtin::ChangeVol, -.6, 3) ||
      !near(change.value, std::pow(10.0, -.3)))
    return false;
  if (!decode(Builtin::ChangeTune, 1200000) || !near(change.value, 2) ||
      !decode(Builtin::ChangeTune, 12, 512) || !near(change.value, 2))
    return false;
  args[2] = Value::fromInteger(1);
  if (!decode(Builtin::ChangeTune, 1200000, 0, 3) ||
      !near(combineVoiceChange(change, 2), 4) ||
      !decode(Builtin::ChangePan, 600, 0, 3) ||
      !near(combineVoiceChange(change, .7), 1))
    return false;
  struct Test {
    Builtin fn;
    VoiceTarget target;
    std::uint32_t unit;
    bool fresh;
  };
  const Test cases[] = {
      {Builtin::ChangeAttack, VoiceTarget::Attack, 1, true},
      {Builtin::ChangeDecay, VoiceTarget::Decay, 1, true},
      {Builtin::ChangeRelease, VoiceTarget::Release, 1, true},
      {Builtin::ChangeCutoffAttack, VoiceTarget::CutoffAttack, 1, true},
      {Builtin::ChangeCutoffDecay, VoiceTarget::CutoffDecay, 1, true},
      {Builtin::ChangeCutoffRelease, VoiceTarget::CutoffRelease, 1, true},
      {Builtin::ChangeCutoff, VoiceTarget::Cutoff, 2, false},
      {Builtin::ChangeAmpLfoFreq, VoiceTarget::AmpLfoFrequency, 2, false},
      {Builtin::ChangePitchLfoFreq, VoiceTarget::PitchLfoFrequency, 2, false},
      {Builtin::ChangeCutoffLfoFreq, VoiceTarget::CutoffLfoFrequency, 2, false},
      {Builtin::ChangeReso, VoiceTarget::Resonance, 0, false},
      {Builtin::ChangeAmpLfoDepth, VoiceTarget::AmpLfoDepth, 0, false},
      {Builtin::ChangePitchLfoDepth, VoiceTarget::PitchLfoDepth, 0, false},
      {Builtin::ChangeCutoffLfoDepth, VoiceTarget::CutoffLfoDepth, 0, false},
      {Builtin::ChangeSustain, VoiceTarget::Sustain, 3, true},
      {Builtin::ChangeCutoffSustain, VoiceTarget::CutoffSustain, 3, true}};
  for (const auto &test : cases) {
    if (!decode(test.fn, 500000) || change.target != test.target ||
        !near(change.value, .5) || change.absolute ||
        change.newNoteOnly != test.fresh || decode(test.fn, 1, 0, 3))
      return false;
    if (test.unit &&
        (!decode(test.fn, test.unit == 3 ? -.6 : .25, test.unit) ||
         !near(change.value, test.unit == 3 ? std::pow(10.0, -.3) : .25) ||
         change.absolute != (test.unit != 3) ||
         change.final != (test.unit != 3)))
      return false;
  }
  const Builtin durations[] = {Builtin::ChangePlayPos,  Builtin::ChangeVolTime,
                               Builtin::ChangeTuneTime, Builtin::ChangePanTime,
                               Builtin::FadeIn,         Builtin::FadeOut};
  for (const auto fn : durations)
    if (!decode(fn, 1000) || !near(change.value, .001) ||
        !decode(fn, .001, 1) || !near(change.value, .001))
      return false;
  if (!decode(Builtin::FadeOut, 1000) || !change.stop ||
      !decode(Builtin::ChangeNote, 127) || !change.newNoteOnly ||
      !decode(Builtin::ChangeVelo, 1) || decode(Builtin::ChangeVelo, 0) ||
      decode(Builtin::ChangePan, 1001) ||
      decode(Builtin::ChangeAmpLfoDepth, 1, 3))
    return false;
  args[2] = Value::fromInteger(0);
  if (!decode(Builtin::FadeOut, 1000, 0, 3) || change.stop)
    return false;
  args[2] = Value::fromReal(1.0);
  if (!decode(Builtin::FadeOut, 1000, 0, 3) || !change.stop ||
      !decode(Builtin::ChangeTune, 1200000, 0, 3) || !change.accumulate ||
      decode(Builtin::ChangePan, 1, 0, 3))
    return false;
  args[2] = Value::fromReal(0.0);
  if (!decode(Builtin::FadeOut, 1000, 0, 3) || change.stop)
    return false;
  args[2] = Value::fromReal(.5);
  if (decode(Builtin::FadeOut, 1000, 0, 3))
    return false;
  for (const auto fn : {Builtin::ChangeVolCurve, Builtin::ChangeTuneCurve,
                        Builtin::ChangePanCurve})
    if (!decode(fn, 1) || decode(fn, 2))
      return false;
  std::uint64_t frames = 0;
  return durationFrames(.001, 48000, frames) && frames == 48 &&
         !durationFrames(-1, 48000, frames) &&
         near(curvePosition(.25, Curve::Linear), .25) &&
         near(curvePosition(.25, Curve::EaseInOut), .15625) &&
         near(curvePosition(1, Curve::EaseInOut), 1);
}
bool testVoiceAutomation() {
  const auto near = [](double a, double b) { return std::abs(a - b) < 1e-10; };
  VoiceAutomation automation;
  Value args[3] = {Value::fromInteger(1), Value{}, Value::fromInteger(0)};
  const auto apply = [&](Builtin fn, Value value, std::uint64_t frame = 0,
                         bool birth = false, std::uint32_t count = 2) {
    args[1] = value;
    VoiceChange change;
    return decodeVoiceChange(fn, args, count, change) &&
           automation.apply(change, frame, 48000, birth);
  };
  if (!(automation.valid()))
    return false;
  if (!(apply(Builtin::ChangeVol, Value::fromReal(-.6, 3 | 256), 0, true)))
    return false;
  const double attenuated = std::pow(10.0, -.3);
  if (!(near(automation.values(0).gain, attenuated) &&
        automation.values(0).gainFinal))
    return false;
  if (!(apply(Builtin::ChangeVolTime, Value::fromInteger(1000000))))
    return false;
  if (!(apply(Builtin::ChangeVolCurve, Value::fromInteger(0))))
    return false;
  if (!(apply(Builtin::ChangeVol, Value::fromInteger(0), 480)))
    return false;
  if (!automation.values(480).gainFinal || automation.values(48480).gainFinal)
    return false;
  if (!(near(automation.values(480).gain, attenuated)))
    return false;
  if (!(near(automation.values(24480).gain, (attenuated + 1) / 2)))
    return false;
  if (!(near(automation.values(48480).gain, 1)))
    return false;
  // Relative destination composition is independent of ramp progress.
  args[2] = Value::fromInteger(1);
  const double mid = automation.values(24480).gain;
  if (!(apply(Builtin::ChangeVol, Value::fromReal(-.6, 3), 24480, false, 3)))
    return false;
  if (!(near(automation.gain.target, attenuated)))
    return false;
  if (!(near(automation.values(24480).gain, mid)))
    return false;
  if (!(near(automation.values(48480).gain, (mid + attenuated) / 2)))
    return false;
  // A later fade-in replaces the gain destination and returns to neutral.
  if (!(apply(Builtin::FadeIn, Value::fromInteger(1000000), 48480)))
    return false;
  const double fadeStart = automation.values(48480).gain;
  if (!(near(automation.values(72480).gain, (fadeStart + 1) / 2)))
    return false;
  if (!(near(automation.values(96480).gain, 1)))
    return false;
  if (!(apply(Builtin::FadeOut, Value::fromInteger(1000000), 96480)))
    return false;
  if (!(!automation.shouldStop(144479)))
    return false;
  if (!(automation.shouldStop(144480)))
    return false;
  if (!(near(automation.values(144480).gain, 0)))
    return false;
  if (!(apply(Builtin::FadeIn, Value::fromInteger(1000000), 120480)))
    return false;
  if (!(near(automation.values(120480).gain, .5)))
    return false;
  if (!(!automation.shouldStop(144480)))
    return false;
  // Birth fade-in, zero-length fades, and a muted note that remains alive.
  automation = {};
  if (!(apply(Builtin::FadeIn, Value::fromInteger(1000000), 500, true)))
    return false;
  if (!(near(automation.values(500).gain, 0)))
    return false;
  if (!(near(automation.values(12500).gain, .15625)))
    return false;
  if (!(near(automation.values(48500).gain, 1)))
    return false;
  args[2] = Value::fromReal(0);
  if (!(apply(Builtin::FadeOut, Value::fromInteger(0), 48500, false, 3)))
    return false;
  if (!(!automation.shouldStop(48500)))
    return false;
  if (!(near(automation.values(48500).gain, 0)))
    return false;
  args[2] = Value::fromReal(1);
  if (!(apply(Builtin::FadeOut, Value::fromInteger(0), 48500, false, 3)))
    return false;
  if (!(automation.shouldStop(48500)))
    return false;
  // Pitch and pan have independent durations, curve settings and finalness.
  automation = {};
  if (!(apply(Builtin::ChangeTuneTime, Value::fromReal(.5, 1))))
    return false;
  if (!(apply(Builtin::ChangeTuneCurve, Value::fromInteger(0))))
    return false;
  if (!(apply(Builtin::ChangeTune, Value::fromInteger(1200000, 256))))
    return false;
  if (!(near(automation.values(12000).tune, 1.5) &&
        automation.values(12000).tuneFinal))
    return false;
  if (!(apply(Builtin::ChangePanTime, Value::fromInteger(1000000))))
    return false;
  if (!(apply(Builtin::ChangePanCurve, Value::fromInteger(1))))
    return false;
  if (!(apply(Builtin::ChangePan, Value::fromInteger(1000))))
    return false;
  if (!(near(automation.values(12000).pan, .15625)))
    return false;
  if (!(near(automation.values(12000).gain, 1)))
    return false;
  if (!(near(automation.values(24000).tune, 2)))
    return false;
  args[2] = Value::fromInteger(1);
  if (!(apply(Builtin::ChangePan, Value::fromInteger(700), 24000, false, 3)))
    return false;
  if (!(near(automation.values(24000).pan, .5) &&
        near(automation.pan.target, 1)))
    return false;
  if (!(apply(Builtin::ChangeVol, Value::fromInteger(-6000), 24000)))
    return false;
  if (!(automation.gain.endFrame == 24048))
    return false;
  // State is copied without pointers; rates change frames, never stored
  // seconds.
  if (!(apply(Builtin::FadeOut, Value::fromInteger(1000000), 24000)))
    return false;
  const auto original = automation;
  auto restored = original;
  if (!(restored.rescaleClock(48000, 96000)))
    return false;
  if (!(near(restored.values(72000).pan, original.values(36000).pan)))
    return false;
  if (!(near(restored.values(72000).gain, original.values(36000).gain)))
    return false;
  if (!(restored.stopFrame == 144000 &&
        restored.gainSeconds == original.gainSeconds))
    return false;
  if (!(restored.rescaleClock(96000, 44100)))
    return false;
  if (!(restored.shouldStop(66150)))
    return false;
  const auto before = restored;
  if (!(!restored.rescaleClock(0, 48000)))
    return false;
  if (!(!restored.rescaleClock(44100, 1e300)))
    return false;
  if (!(restored.stopFrame == before.stopFrame &&
        restored.gain.endFrame == before.gain.endFrame))
    return false;
  VoiceChange invalid;
  invalid.value = std::numeric_limits<double>::infinity();
  if (!(!restored.apply(invalid, 0, 48000)))
    return false;
  invalid.value = 2;
  invalid.target = VoiceTarget::Pan;
  if (!(!restored.apply(invalid, 0, 48000)))
    return false;
  invalid.target = VoiceTarget::Attack;
  if (!(!restored.apply(invalid, 0, 48000)))
    return false;

  // Every timed lane switches its actual per-voice basis continuously,
  // including interrupted transitions and the non-unity bases of layered
  // instruments.
  const auto effective = [](const VoiceAutomation &state, VoiceTarget target,
                            std::uint64_t frame, double base) {
    const auto value = state.values(frame);
    if (target == VoiceTarget::Gain)
      return value.gainRelative * base + value.gainAbsolute;
    if (target == VoiceTarget::Tune)
      return value.tuneRelative * base + value.tuneAbsolute;
    return value.panRelative * base + value.panAbsolute;
  };
  for (const auto target :
       {VoiceTarget::Gain, VoiceTarget::Tune, VoiceTarget::Pan}) {
    VoiceAutomation state;
    state.gainSeconds = state.tuneSeconds = state.panSeconds = .02;
    state.gainCurve = state.tuneCurve = state.panCurve = Curve::Linear;
    VoiceChange command;
    command.target = target;
    command.value = target == VoiceTarget::Pan ? -.3 : .5;
    if (!state.apply(command, 0, 48000, true))
      return false;
    const auto initial = state;
    command.final = true;
    if (!state.apply(command, 480, 48000))
      return false;
    for (const auto base : {.1, .6}) {
      const auto start = effective(initial, target, 480, base);
      if (!near(effective(state, target, 480, base), start) ||
          !near(effective(state, target, 960, base),
                (start + command.value) / 2) ||
          !near(effective(state, target, 1440, base), command.value))
        return false;
    }
    const auto middle = state;
    command.final = false;
    command.value *= .5;
    if (!state.apply(command, 960, 48000))
      return false;
    auto copied = state;
    if (!copied.valid() || !copied.rescaleClock(48000, 96000))
      return false;
    for (const auto base : {.1, .6}) {
      const auto destination = target == VoiceTarget::Pan
                                   ? base + command.value
                                   : base * command.value;
      if (!near(effective(state, target, 960, base),
                effective(middle, target, 960, base)) ||
          !near(effective(state, target, 1920, base), destination) ||
          !near(effective(copied, target, 2400, base),
                effective(state, target, 1200, base)))
        return false;
    }
  }
  VoiceAutomation fading;
  fading.gainSeconds = .02;
  fading.gainCurve = Curve::Linear;
  VoiceChange gainChange;
  gainChange.target = VoiceTarget::Gain;
  gainChange.value = .5;
  if (!fading.apply(gainChange, 0, 48000, true))
    return false;
  gainChange.final = true;
  if (!fading.apply(gainChange, 480, 48000))
    return false;
  VoiceChange fade;
  fade.target = VoiceTarget::FadeOut;
  fade.value = .02;
  const auto mixed = effective(fading, VoiceTarget::Gain, 960, .1);
  if (!fading.apply(fade, 960, 48000) ||
      !near(effective(fading, VoiceTarget::Gain, 960, .1), mixed) ||
      !near(effective(fading, VoiceTarget::Gain, 1440, .1), mixed / 2))
    return false;
  fade.target = VoiceTarget::FadeIn;
  if (!fading.apply(fade, 1440, 48000) ||
      !near(effective(fading, VoiceTarget::Gain, 1440, .1), mixed / 2) ||
      !near(effective(fading, VoiceTarget::Gain, 2400, .1), .55))
    return false;
  fading = {};
  if (!fading.apply(gainChange, 0, 48000, true))
    return false;
  fade.target = VoiceTarget::FadeOut;
  if (!fading.apply(fade, 480, 48000) ||
      !near(effective(fading, VoiceTarget::Gain, 480, .1), .5) ||
      !near(effective(fading, VoiceTarget::Gain, 960, .1), .25) ||
      !near(effective(fading, VoiceTarget::Gain, 1440, .1), 0) ||
      fading.shouldStop(1440))
    return false;
  return true;
}

struct TestHost final : Host {
  std::uint32_t nextNote = 100;
  std::array<std::uint32_t, 32> markedIds{}, marks{};
  bool quiet = false;
  bool timerTypes = false;
  bool supports(Builtin b) const noexcept override {
    return b == Builtin::PlayNote || b == Builtin::NoteOff ||
           b == Builtin::IgnoreEvent || b == Builtin::SetController ||
           b == Builtin::SetRpn || b == Builtin::SetNrpn ||
           b == Builtin::Message || b == Builtin::ChangeNote ||
           b == Builtin::ByMarks || b == Builtin::SetEventMark ||
           b == Builtin::DeleteEventMark;
  }
  bool call(Builtin b, const Value *a, std::uint32_t n, Event &e,
            Value &out) noexcept override {
    if (!supports(b))
      return false;
    if (timerTypes && b == Builtin::Message &&
        (n != 1 || a[0].kind != 0 || a[0].flags != 0))
      return false;
    if (!quiet) {
      std::cout << "{\"fn\":" << static_cast<unsigned>(b)
                << ",\"frame\":" << e.frame << ",\"event\":" << e.id
                << ",\"args\":[";
      for (std::uint32_t i = 0; i < n; ++i) {
        if (i)
          std::cout << ',';
        if (a[i].kind == 2)
          std::cout << '"' << a[i].text.data() << '"';
        else
          std::cout << a[i].numeric();
      }
      std::cout << "]}\n";
    }
    if (b == Builtin::PlayNote)
      out = Value::fromInteger(nextNote++);
    if (b == Builtin::IgnoreEvent && n && a[0].numeric() == e.id)
      e.ignored = true;
    if (b == Builtin::SetEventMark) {
      std::size_t slot = 0;
      while (slot < markedIds.size() && markedIds[slot] &&
             markedIds[slot] != a[0].numeric())
        ++slot;
      if (slot == markedIds.size())
        return false;
      markedIds[slot] = static_cast<std::uint32_t>(a[0].numeric());
      marks[slot] |= static_cast<std::uint32_t>(a[1].numeric());
    }
    if (b == Builtin::DeleteEventMark || b == Builtin::IgnoreEvent ||
        b == Builtin::NoteOff)
      for (std::size_t i = 0; i < markedIds.size(); ++i)
        if (markedIds[i] == a[0].numeric()) {
          marks[i] &= b == Builtin::DeleteEventMark
                          ? ~static_cast<std::uint32_t>(a[1].numeric())
                          : 0u;
          if (!marks[i])
            markedIds[i] = 0;
        }
    return true;
  }
  bool read(Variable v, std::uint32_t index, const Event &,
            Value &out) noexcept override {
    if (v == Variable::Cc || v == Variable::KeyDown ||
        v == Variable::AllEvents) {
      out = Value::fromInteger(index == kNoEntry ? 128 : index == 1 ? 73 : 0);
      return true;
    }
    return false;
  }
  void diagnostic(Error e, std::uint32_t pc) noexcept override {
    std::cerr << "VM error " << static_cast<unsigned>(e) << " at " << pc
              << '\n';
  }
  bool supportsVariable(Variable v) const noexcept override {
    return v == Variable::Cc || v == Variable::KeyDown ||
           v == Variable::AllEvents;
  }
  bool markedEvent(std::uint32_t mask, std::uint32_t index, const Event &,
                   Value &out) noexcept override {
    std::uint32_t count = 0;
    for (std::size_t i = 0; i < markedIds.size(); ++i)
      if (markedIds[i] && (marks[i] & mask)) {
        if (count++ == index) {
          out = Value::fromInteger(markedIds[i]);
          return true;
        }
      }
    if (index != kNoEntry)
      return false;
    out = Value::fromInteger(count);
    return true;
  }
};

int main(int argc, char **argv) {
  if (argc == 2 && std::string(argv[1]) == "--automation")
    return testVoiceAutomation() ? 0 : 20;
  if (argc == 2 && std::string(argv[1]) == "--parameters")
    return testParameters() ? 0 : 19;
  if (argc < 2 || argc > 3)
    return 2;
  std::ifstream stream(argv[1], std::ios::binary);
  const std::vector<std::uint8_t> bytes{std::istreambuf_iterator<char>(stream),
                                        {}};
  auto program = std::make_unique<Program>();
  auto vm = std::make_unique<VM>();
  TestHost host;
  if (!program->load(bytes.data(), bytes.size()))
    return 3;
  if (!program->supportsHost(host))
    return 4;
  vm->bind(program.get(), 48000, 17);
  Event event;
  event.id = 1;
  event.note = 60;
  event.velocity = 96;
  if (!vm->dispatch(Callback::Note, event, host))
    return 5;
  if (argc == 3 && std::string(argv[2]) == "repeat") {
    for (std::uint32_t i = 0; i < 1000; ++i) {
      if (!vm->dispatch(Callback::Release, event, host))
        return 33;
      vm->releaseNote(event.id);
      event.id = i + 2;
      event.frame += 48;
      if (!vm->dispatch(Callback::Note, event, host))
        return 34;
    }
    return 0;
  }
  if (argc == 3 && std::string(argv[2]) == "profiling") {
    host.timerTypes = true;
    std::vector<std::uint8_t> saved(VM::checkpointBytes());
    if (!program->profiling || !vm->writeCheckpoint(saved.data(), saved.size()))
      return 30;
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
    auto restored = std::make_unique<VM>();
    restored->bind(program.get(), 48000);
    if (!restored->readCheckpoint(saved.data(), saved.size()) ||
        restored->state().frame != 0)
      return 31;
    return restored->advance(48, host) ? 0 : 32;
  }
  if (argc == 3 && std::string(argv[2]) == "rescale-ties") {
    std::vector<std::uint8_t> saved(VM::checkpointBytes());
    if (!vm->rescaleClock(48000, 24000) ||
        !vm->writeCheckpoint(saved.data(), saved.size()))
      return 28;
    auto restored = std::make_unique<VM>();
    restored->bind(program.get(), 24000);
    return restored->readCheckpoint(saved.data(), saved.size()) &&
                   restored->advance(10, host)
               ? 0
               : 29;
  }
  if (argc == 3 && std::string(argv[2]).starts_with("rescale")) {
    const double newRate =
        std::string(argv[2]) == "rescale44100" ? 44100 : 96000;
    if (!vm->advance(240, host))
      return 20;
    std::vector<std::uint8_t> saved(VM::checkpointBytes()),
        check(VM::checkpointBytes());
    if (!vm->writeCheckpoint(saved.data(), saved.size()))
      return 21;
    auto restored = std::make_unique<VM>();
    restored->bind(program.get(), newRate, 999);
    if (!restored->readCheckpoint(saved.data(), saved.size()) ||
        !restored->rescaleClock(48000, newRate))
      return 22;
    const auto expectedFrame =
        static_cast<std::uint64_t>(std::floor(240 * newRate / 48000 + .5));
    const auto deadline = static_cast<std::uint64_t>(newRate * .02);
    if (restored->state().frame != expectedFrame ||
        restored->nextFrame() != deadline ||
        restored->state().random != vm->state().random)
      return 23;
    for (std::size_t i = 0; i < program->cells[0]; ++i) {
      const auto &before = vm->state().globals[i],
                 &after = restored->state().globals[i];
      if (before.numeric() != after.numeric() || before.kind != after.kind ||
          before.flags != after.flags || before.text != after.text)
        return 24;
    }
    if (!restored->writeCheckpoint(saved.data(), saved.size()) ||
        restored->rescaleClock(newRate, 1e308) ||
        restored->rescaleClock(0, newRate) ||
        !restored->writeCheckpoint(check.data(), check.size()) ||
        saved != check)
      return 25;
    auto second = std::make_unique<VM>();
    second->bind(program.get(), newRate);
    if (!second->readCheckpoint(saved.data(), saved.size()) ||
        !second->advance(deadline - 1, host) ||
        !second->advance(deadline, host) ||
        !second->advance(static_cast<std::uint64_t>(newRate * .03), host))
      return 26;
    return second->nextFrame() == std::numeric_limits<std::uint64_t>::max()
               ? 0
               : 27;
  }
  if (argc == 3) {
    std::uint32_t slices = 0;
    AdvanceResult status;
    do {
      status = vm->advanceSlice(48000, host, 7);
      if (++slices > 100000)
        return 14;
    } while (status == AdvanceResult::Pending);
    return status == AdvanceResult::Complete && slices > 1 &&
                   vm->state().frame == 48000
               ? 0
               : 15;
  }
  auto checkpoint = std::make_unique<State>(vm->state());
  std::vector<std::uint8_t> checkpointBytes(VM::checkpointBytes());
  if (!vm->writeCheckpoint(checkpointBytes.data(), checkpointBytes.size()))
    return 16;
  const auto checkpointNote = host.nextNote;
  host.quiet = true;
  if (!vm->advance(47, host))
    return 6;
  host.quiet = false;
  host.nextNote = checkpointNote;
  auto replacement = std::make_unique<VM>();
  replacement->bind(program.get(), 48000, 999);
  if (!replacement->readCheckpoint(checkpointBytes.data(),
                                   checkpointBytes.size()))
    return 17;
  if (replacement->state().frame != checkpoint->frame ||
      replacement->state().random != checkpoint->random)
    return 18;
  vm.swap(replacement);
  if (!vm->advance(48, host))
    return 7;
  event.id = 2;
  event.note = 64;
  event.frame = 96;
  event.ignored = false;
  if (!vm->dispatch(Callback::Note, event, host) || !vm->advance(144, host))
    return 8;
  event.controller = 1;
  event.value = 73;
  event.frame = 144;
  if (!vm->dispatch(Callback::Controller, event, host))
    return 9;
  event.id = 1;
  event.note = 60;
  event.frame = 192;
  if (!vm->dispatch(Callback::Release, event, host))
    return 10;
  event.address = 123;
  event.value = 456;
  event.frame = 240;
  if (!vm->dispatch(Callback::Rpn, event, host))
    return 11;
  event.frame = 288;
  if (!vm->dispatch(Callback::Nrpn, event, host) || !vm->advance(1000, host))
    return 12;
  return 0;
}

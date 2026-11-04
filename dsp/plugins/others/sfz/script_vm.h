#ifndef EFFETUNE_SFZ_SCRIPT_VM_H
#define EFFETUNE_SFZ_SCRIPT_VM_H

#include <algorithm>
#include <array>
#include <bit>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <type_traits>
#if defined(_WIN32) && !defined(__EMSCRIPTEN__)
#pragma push_macro("NOMINMAX")
#pragma push_macro("WIN32_LEAN_AND_MEAN")
#pragma push_macro("near")
#pragma push_macro("far")
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#pragma pop_macro("far")
#pragma pop_macro("near")
#pragma pop_macro("WIN32_LEAN_AND_MEAN")
#pragma pop_macro("NOMINMAX")
#elif defined(__linux__)
#include <time.h>
#endif

namespace effetune::plugins::others::sfz::script {
constexpr std::uint32_t kNoEntry = 0xffffffffu;
constexpr std::size_t kInstructions = 8192, kConstants = 512, kVariables = 128;
constexpr std::size_t kGlobals = 256, kLocals = 64, kPoly = 16;
constexpr std::size_t kCallbacks = 16, kNotes = 128, kStack = 64;
constexpr std::size_t kSavedLocals = 256;
enum class AdvanceResult { Complete, Pending, Error };
enum class Callback : std::uint32_t { Init, Note, Release, Controller, Rpn, Nrpn };
enum class Builtin : std::uint32_t {
  Abort,
  Acos,
  Abs,
  ArrayEqual,
  Asin,
  Atan,
  CallbackStatus,
  Ceil,
  Cos,
  Dec,
  Exit,
  Exp,
  Floor,
  Fork,
  Inc,
  Int,
  IntToReal,
  InRange,
  Log,
  Log10,
  Log2,
  Lsb,
  Max,
  Message,
  Min,
  Msb,
  NumElements,
  Pow,
  Random,
  Real,
  RealToInt,
  Round,
  Search,
  ShLeft,
  ShRight,
  Sin,
  Sort,
  Sqrt,
  StopWait,
  Tan,
  Wait,
  ByMarks,
  ChangeAmpLfoDepth,
  ChangeAmpLfoFreq,
  ChangeAttack,
  ChangeCutoff,
  ChangeCutoffAttack,
  ChangeCutoffDecay,
  ChangeCutoffLfoDepth,
  ChangeCutoffLfoFreq,
  ChangeCutoffRelease,
  ChangeCutoffSustain,
  ChangeDecay,
  ChangeNote,
  ChangePan,
  ChangePanCurve,
  ChangePanTime,
  ChangePitchLfoDepth,
  ChangePitchLfoFreq,
  ChangePlayPos,
  ChangeRelease,
  ChangeReso,
  ChangeSustain,
  ChangeTune,
  ChangeTuneCurve,
  ChangeTuneTime,
  ChangeVelo,
  ChangeVol,
  ChangeVolCurve,
  ChangeVolTime,
  DeleteEventMark,
  EventStatus,
  FadeIn,
  FadeOut,
  GetEventPar,
  IgnoreController,
  IgnoreEvent,
  NoteOff,
  PlayNote,
  SetController,
  SetEventMark,
  SetEventPar,
  SetNrpn,
  SetRpn
};
enum class Variable : std::uint32_t {
  KspTimer,
  PerfTimer,
  ChildId,
  ParentId,
  RealTimer,
  CallbackId,
  CallbackType,
  IgnoreWait,
  AllEvents,
  CcNum,
  Cc,
  EventId,
  EventNote,
  EventVelocity,
  KeyDown,
  RpnAddress,
  RpnValue,
  EngineUptime
};
enum class Error : std::uint32_t {
  None,
  Program,
  Stack,
  Storage,
  Arithmetic,
  Host,
  Budget,
  Callbacks
};
// Kind: integer, real, string, writable array reference, host array reference.
// Integers retain their exact metric coefficient; reals use canonical physical values.
// numeric() converts either numeric type for bounded musical host arguments.
// Flags: low 2 bits=unit, bit 8=final, bit 9=explicit prefix, bits 16..23=signed exponent.
struct Value {
  union {
    std::int64_t integer = 0;
    double real;
  };
  std::uint32_t kind = 0, flags = 0;
  std::array<char, 128> text{};
  std::uint32_t unit() const noexcept { return flags & 3u; }
  bool hasPrefix() const noexcept { return (flags & 512u) != 0; }
  int prefixExponent() const noexcept {
    const auto exponent = (flags >> 16u) & 255u;
    return exponent < 128 ? static_cast<int>(exponent) : static_cast<int>(exponent) - 256;
  }
  double scale() const noexcept { return std::pow(10.0, prefixExponent()); }
  double numeric() const noexcept {
    return kind == 1   ? real
           : kind == 2 ? 0.0
                       : static_cast<double>(integer) * (kind == 0 ? scale() : 1.0);
  }
  static Value fromInteger(std::int64_t value, std::uint32_t flags = 0) noexcept {
    Value result;
    result.integer = value;
    result.flags = flags;
    return result;
  }
  static Value fromReal(double value, std::uint32_t flags = 0) noexcept {
    Value result;
    result.real = value;
    result.kind = 1;
    result.flags = flags;
    return result;
  }
};
struct Event {
  std::uint32_t id = 0, note = 0, velocity = 0, channel = 0;
  std::uint32_t controller = 0, value = 0, address = 0;
  std::uint64_t frame = 0;
  bool ignored = false;
};
struct Host {
  virtual ~Host() = default;
  virtual bool supports(Builtin builtin) const noexcept = 0;
  virtual bool call(Builtin builtin, const Value *arguments, std::uint32_t count, Event &event,
                    Value &result) noexcept = 0;
  // UINT32_MAX requests an array's length. Scalar variables always use index zero.
  virtual bool read(Variable variable, std::uint32_t index, const Event &event,
                    Value &result) noexcept = 0;
  virtual void diagnostic(Error error, std::uint32_t instruction) noexcept = 0;
  virtual bool markedEvent(std::uint32_t mask, std::uint32_t index, const Event &event,
                           Value &result) noexcept = 0;
  virtual bool supportsVariable(Variable variable) const noexcept = 0;
  // Only an explicit wait or the end of a callback makes its emissions observable.
  // Instruction-budget suspension is internal and does not advance musical time.
  virtual void callbackBoundary(Event &) noexcept {}
};
struct Instruction {
  std::uint32_t op = 0, a = 0, b = 0, c = 0;
};
struct Descriptor {
  std::uint32_t scope = 0, type = 0, offset = 0, length = 0;
};
struct Program {
  std::array<Instruction, kInstructions> code{};
  std::array<Value, kConstants> constants{};
  std::array<Descriptor, kVariables> variables{};
  std::array<std::uint32_t, 6> entries{};
  std::array<std::uint32_t, 3> cells{};
  std::uint32_t codeCount = 0, constantCount = 0, variableCount = 0;
  std::uint64_t fingerprint = 0;
  bool profiling = false;

  static std::uint32_t word(const std::uint8_t *p) noexcept {
    return p[0] | std::uint32_t(p[1]) << 8u | std::uint32_t(p[2]) << 16u |
           std::uint32_t(p[3]) << 24u;
  }
  bool supportsHost(const Host &host) const noexcept {
    for (std::uint32_t i = 0; i < codeCount; ++i) {
      if (code[i].op == 10 && (code[i].a >= 41 || code[i].a == 23) &&
          !host.supports(static_cast<Builtin>(code[i].a)))
        return false;
      if (code[i].op == 4 && (code[i].a == 8 || code[i].a == 10 || code[i].a == 14) &&
          !host.supportsVariable(static_cast<Variable>(code[i].a)))
        return false;
    }
    return true;
  }
  static bool argumentCount(std::uint32_t id, std::uint32_t count) noexcept {
    if (id > 83)
      return false;
    auto low = 1u, high = 1u;
    if (id >= 42 && id <= 69) {
      low = high = 2;
    }
    switch (static_cast<Builtin>(id)) {
    case Builtin::Exit:
      low = high = 0;
      break;
    case Builtin::Fork:
      low = 0;
      high = 2;
      break;
    case Builtin::IgnoreController:
    case Builtin::IgnoreEvent:
      low = 0;
      high = 1;
      break;
    case Builtin::PlayNote:
      high = 4;
      break;
    case Builtin::StopWait:
    case Builtin::Sort:
    case Builtin::NoteOff:
      high = 2;
      break;
    case Builtin::ArrayEqual:
    case Builtin::Search:
    case Builtin::Random:
    case Builtin::Pow:
    case Builtin::Min:
    case Builtin::Max:
    case Builtin::ShLeft:
    case Builtin::ShRight:
    case Builtin::FadeIn:
    case Builtin::GetEventPar:
    case Builtin::SetController:
    case Builtin::SetEventMark:
    case Builtin::DeleteEventMark:
    case Builtin::SetRpn:
    case Builtin::SetNrpn:
      low = high = 2;
      break;
    case Builtin::FadeOut:
    case Builtin::ChangeVol:
    case Builtin::ChangeTune:
    case Builtin::ChangePan:
      low = 2;
      high = 3;
      break;
    case Builtin::InRange:
    case Builtin::SetEventPar:
      low = high = 3;
      break;
    default:
      break;
    }
    return count >= low && count <= high;
  }
  // Called only while preparing the instrument, never from the rendering callback.
  bool load(const std::uint8_t *bytes, std::size_t length) noexcept {
    codeCount = 0;
    profiling = false;
    if (!bytes || length < 64 || word(bytes) != 0x31534b4eu || word(bytes + 4) != 2 ||
        word(bytes + 20) != 0 || word(bytes + 60) != 0)
      return false;
    const auto instructions = word(bytes + 8), values = word(bytes + 12), vars = word(bytes + 16);
    if (!instructions || instructions > kInstructions || values > kConstants || vars > kVariables ||
        length != 64u + std::size_t(vars) * 16u + std::size_t(values) * 144u +
                      std::size_t(instructions) * 16u)
      return false;
    for (std::size_t i = 0; i < 3; ++i)
      cells[i] = word(bytes + 24 + i * 4);
    if (cells[0] > kGlobals || cells[1] > kLocals || cells[2] > kPoly)
      return false;
    for (std::size_t i = 0; i < entries.size(); ++i) {
      entries[i] = word(bytes + 36 + i * 4);
      if (entries[i] != kNoEntry && entries[i] >= instructions)
        return false;
    }
    std::size_t offset = 64;
    for (std::uint32_t i = 0; i < vars; ++i, offset += 16) {
      auto &d = variables[i];
      d = {word(bytes + offset), word(bytes + offset + 4), word(bytes + offset + 8),
           word(bytes + offset + 12)};
      if (d.scope > 2 || d.type > 2 || !d.length || d.length > cells[d.scope] ||
          d.offset > cells[d.scope] - d.length)
        return false;
    }
    for (std::uint32_t i = 0; i < values; ++i, offset += 144) {
      auto &v = constants[i];
      const std::uint64_t bits = word(bytes + offset) | std::uint64_t(word(bytes + offset + 4))
                                                            << 32u;
      v.kind = word(bytes + offset + 8);
      if (v.kind == 1)
        std::memcpy(&v.real, &bits, sizeof(bits));
      else
        std::memcpy(&v.integer, &bits, sizeof(bits));
      v.flags = word(bytes + offset + 12);
      std::memcpy(v.text.data(), bytes + offset + 16, v.text.size());
      if (!std::isfinite(v.numeric()) || v.kind > 2 || (v.flags & ~0x00ff0303u) ||
          v.prefixExponent() < -12 || v.prefixExponent() > 12 || v.text.back() != 0)
        return false;
    }
    for (std::uint32_t i = 0; i < instructions; ++i, offset += 16) {
      auto &in = code[i];
      in = {word(bytes + offset), word(bytes + offset + 4), word(bytes + offset + 8),
            word(bytes + offset + 12)};
      if (in.op > 15 || (in.op != 12 && in.c != 0))
        return false;
      if ((in.op == 0 || in.op == 11 || in.op == 14) && in.a != 0)
        return false;
      if (in.op != 3 && in.op != 4 && in.op != 5 && in.op != 10 && in.op != 12 && in.b != 0)
        return false;
      if (in.op == 1 && in.a >= values)
        return false;
      if ((in.op == 2 || in.op == 3 || in.op == 5) && in.a >= vars)
        return false;
      if (in.op == 3 && (in.b > 1 || (variables[in.a].length > 1 && !in.b)))
        return false;
      if (in.op == 5 && in.b != 0 && in.b != variables[in.a].length)
        return false;
      if (in.op == 4 && (in.a > 17 || in.b > 1))
        return false;
      if (in.op == 4 && in.b && in.a != 2 && in.a != 8 && in.a != 10 && in.a != 14)
        return false;
      if (in.op == 4 && (in.a == 0 || in.a == 1 || in.a == 4))
        profiling = true;
      if (in.op == 6 && in.a > 4)
        return false;
      if (in.op == 7 && in.a > 16)
        return false;
      if ((in.op == 8 || in.op == 9 || in.op == 12) && in.a >= instructions)
        return false;
      if (in.op == 10 && !argumentCount(in.a, in.b))
        return false;
      if (in.op == 12 && ((in.b >> 16u) > kStack / 2 || (in.b >> 16u) > in.c ||
                          (in.b & 65535u) > cells[1] || in.c > cells[1] - (in.b & 65535u)))
        return false;
      if (in.op == 13 && (in.a > vars || (in.a && variables[in.a - 1].scope != 1)))
        return false;
      if (in.op == 15 && in.a > 1)
        return false;
    }
    fingerprint = 1469598103934665603ull;
    for (std::size_t i = 0; i < length; ++i) {
      fingerprint ^= bytes[i];
      fingerprint *= 1099511628211ull;
    }
    codeCount = instructions;
    constantCount = values;
    variableCount = vars;
    return true;
  }
};
struct Continuation {
  std::array<Value, kStack> stack{};
  std::array<Value, kLocals> locals{};
  std::array<std::uint32_t, 32> returns{};
  std::array<std::uint32_t, 32> returnSp{}, returnLocal{}, returnCount{}, returnSync{};
  std::array<Value, kSavedLocals> savedLocals{};
  std::array<std::uint32_t, kCallbacks> children{};
  Event event{};
  std::uint64_t wake = 0;
  std::uint32_t pc = 0, sp = 0, depth = 0, id = 0, parent = 0, poly = kNoEntry;
  std::uint32_t steps = 0, synchronized = 0, childCount = 0, savedCount = 0, wakeOrder = 0;
  Callback callback = Callback::Init;
  bool active = false, waiting = false, ignoreWait = false, autoAbort = true;
};
struct Polyphonic {
  std::array<Value, kPoly> values{};
  std::uint32_t id = 0;
  bool retired = false;
};
struct State {
  std::array<Value, kGlobals> globals{};
  std::array<Continuation, kCallbacks> callbacks{};
  std::array<Polyphonic, kNotes> notes{};
  std::uint64_t frame = 0, fingerprint = 0;
  std::uint32_t nextId = 1, random = 1;
  // Transient scheduling bookkeeping. Checkpoints are refused until this callback settles.
  std::uint32_t budgetCallback = kNoEntry;
  bool initialized = false;
  Error error = Error::None;
};
// This wire format is independent of native/WASM structure padding.
template <bool Reading> struct CheckpointIO {
  const std::uint8_t *input = nullptr;
  std::uint8_t *output = nullptr;
  std::size_t offset = 0, length = 0;
  bool ok = true;
  template <typename T> void field(T &value) noexcept {
    using Type = std::remove_cv_t<T>;
    constexpr auto size = sizeof(Type) == 8 ? 8u : 4u;
    if (offset > length || size > length - offset) {
      ok = false;
      return;
    }
    std::uint64_t bits = 0;
    if constexpr (Reading) {
      bits = Program::word(input + offset);
      if constexpr (size == 8)
        bits |= std::uint64_t(Program::word(input + offset + 4)) << 32u;
      if constexpr (std::is_same_v<Type, double>)
        std::memcpy(&value, &bits, 8);
      else {
        if constexpr (std::is_same_v<Type, bool>)
          if (bits > 1)
            ok = false;
        value = static_cast<Type>(bits);
      }
    } else {
      if constexpr (std::is_same_v<Type, double>)
        std::memcpy(&bits, &value, 8);
      else
        bits = static_cast<std::uint64_t>(value);
      for (std::size_t i = 0; i < size; ++i)
        output[offset + i] = static_cast<std::uint8_t>(bits >> (i * 8));
    }
    offset += size;
  }
  template <typename T> void value(T &v) noexcept {
    std::uint64_t bits = 0;
    if constexpr (!Reading) {
      if (v.kind == 1)
        std::memcpy(&bits, &v.real, sizeof(bits));
      else
        std::memcpy(&bits, &v.integer, sizeof(bits));
    }
    field(bits);
    field(v.kind);
    field(v.flags);
    if constexpr (Reading) {
      if (v.kind == 1)
        std::memcpy(&v.real, &bits, sizeof(bits));
      else
        std::memcpy(&v.integer, &bits, sizeof(bits));
    }
    if (offset > length || 128 > length - offset) {
      ok = false;
      return;
    }
    if constexpr (Reading)
      std::memcpy(v.text.data(), input + offset, 128);
    else
      std::memcpy(output + offset, v.text.data(), 128);
    offset += 128;
  }
  template <typename T> void state(T &state) noexcept {
    for (auto &v : state.globals)
      value(v);
    for (auto &c : state.callbacks) {
      for (auto &v : c.stack)
        value(v);
      for (auto &v : c.locals)
        value(v);
      for (auto &v : c.savedLocals)
        value(v);
      for (auto &v : c.returns)
        field(v);
      for (auto &v : c.returnSp)
        field(v);
      for (auto &v : c.returnLocal)
        field(v);
      for (auto &v : c.returnCount)
        field(v);
      for (auto &v : c.returnSync)
        field(v);
      for (auto &v : c.children)
        field(v);
      field(c.event.id);
      field(c.event.note);
      field(c.event.velocity);
      field(c.event.channel);
      field(c.event.controller);
      field(c.event.value);
      field(c.event.address);
      field(c.event.frame);
      field(c.event.ignored);
      field(c.wake);
      field(c.pc);
      field(c.sp);
      field(c.depth);
      field(c.id);
      field(c.parent);
      field(c.poly);
      field(c.steps);
      field(c.synchronized);
      field(c.childCount);
      field(c.savedCount);
      field(c.wakeOrder);
      field(c.callback);
      field(c.active);
      field(c.waiting);
      field(c.ignoreWait);
      field(c.autoAbort);
    }
    for (auto &note : state.notes) {
      for (auto &v : note.values)
        value(v);
      field(note.id);
      field(note.retired);
    }
    field(state.frame);
    field(state.fingerprint);
    field(state.nextId);
    field(state.random);
    field(state.initialized);
    field(state.error);
  }
};
class VM {
public:
  static constexpr std::size_t checkpointBytes() noexcept {
    return 32u + kGlobals * 144u +
           kCallbacks * ((kStack + kLocals + kSavedLocals) * 144u + (32u * 5u + kCallbacks) * 4u +
                         40u + 8u + 16u * 4u) +
           kNotes * (kPoly * 144u + 8u) + 32u;
  }
  bool writeCheckpoint(std::uint8_t *bytes, std::size_t size) const noexcept {
    if (!bytes || size != checkpointBytes() || !validState(state_))
      return false;
    CheckpointIO<false> io{nullptr, bytes, 0, size};
    const std::uint32_t magic = 0x31534b43u, version = 4;
    io.field(magic);
    io.field(version);
    const auto wall = program_->profiling ? wallMicros() : 0;
    const auto real = program_->profiling ? realMicros() : 0;
    io.field(wall);
    io.field(real);
    io.field(performanceMicros_);
    io.state(state_);
    return io.ok && io.offset == size;
  }
  bool readCheckpoint(const std::uint8_t *bytes, std::size_t size) noexcept {
    if (!bytes || size != checkpointBytes() || Program::word(bytes) != 0x31534b43u ||
        Program::word(bytes + 4) != 4)
      return false;
    CheckpointIO<true> io{bytes, nullptr, 8, size};
    std::uint64_t wall = 0, real = 0, performance = 0;
    io.field(wall);
    io.field(real);
    io.field(performance);
    state_.budgetCallback = kNoEntry;
    io.state(state_);
    if (io.ok && io.offset == size && validState(state_)) {
      const auto now = program_->profiling ? wallMicros() : 0;
      const auto gap = now > wall ? now - wall : 0;
      constexpr auto maxTimer =
          static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max());
      if (wall > maxTimer || real > maxTimer || performance > maxTimer || gap > maxTimer - real) {
        clear();
        return false;
      }
      realOffsetMicros_ = real + gap;
      performanceMicros_ = performance;
      if (program_->profiling)
        clockOrigin_ = ProfileClock::now();
      return true;
    }
    clear();
    return false;
  }
  void bind(const Program *program, double sampleRate, std::uint32_t seed = 1) noexcept {
    program_ = program;
    sampleRate_ = std::isfinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000.0;
    clear();
    state_.random = seed ? seed : 1;
  }
  void clear() noexcept {
    // Value initialization is performed in place; State is too large for an audio-thread stack.
    for (auto &v : state_.globals)
      v = {};
    for (auto &c : state_.callbacks) {
      c.active = false;
      c.id = 0;
    }
    for (auto &n : state_.notes) {
      n.id = 0;
      for (auto &v : n.values)
        v = {};
    }
    state_.frame = 0;
    state_.fingerprint = program_ ? program_->fingerprint : 0;
    state_.nextId = 1;
    state_.random = 1;
    state_.initialized = false;
    state_.error = Error::None;
    state_.budgetCallback = kNoEntry;
    if (program_ && program_->profiling)
      clockOrigin_ = ProfileClock::now();
    realOffsetMicros_ = 0;
    performanceMicros_ = 0;
  }
  const State &state() const noexcept { return state_; }
  bool hasPendingBudget() const noexcept { return state_.budgetCallback != kNoEntry; }
  bool restore(const State &state) noexcept {
    if (!validState(state))
      return false;
    state_ = state;
    return true;
  }
  // Called during checkpoint preparation, before the replacement host starts rendering.
  // Script values are physical values or user data, never sample-clock counters to rewrite.
  bool rescaleClock(double oldRate, double newRate) noexcept {
    if (!program_ || !std::isfinite(oldRate) || !std::isfinite(newRate) || oldRate <= 0 ||
        newRate <= 0 || (sampleRate_ != oldRate && sampleRate_ != newRate))
      return false;
    constexpr auto maxFrame = 9007199254740991ull;
    const auto scale = [&](std::uint64_t source, std::uint64_t &target) {
      if (source > maxFrame)
        return false;
      const double value = oldRate == newRate ? static_cast<double>(source)
                                              : static_cast<double>(source) * newRate / oldRate;
      if (!std::isfinite(value) || value < 0 || value > static_cast<double>(maxFrame))
        return false;
      const auto integral = std::floor(value);
      target = static_cast<std::uint64_t>(integral) + (value - integral >= .5 ? 1u : 0u);
      return target <= maxFrame;
    };
    std::uint64_t frame = 0;
    std::array<std::uint64_t, kCallbacks> wakes{}, events{};
    if (!scale(state_.frame, frame))
      return false;
    for (std::size_t i = 0; i < kCallbacks; ++i) {
      const auto &c = state_.callbacks[i];
      if (!scale(c.wake, wakes[i]) || !scale(c.event.frame, events[i]))
        return false;
    }
    std::array<std::uint32_t, kCallbacks> orders{};
    for (std::size_t i = 0; i < kCallbacks; ++i) {
      const auto &c = state_.callbacks[i];
      if (c.active) {
        orders[i] = 1;
        for (const auto &other : state_.callbacks)
          if (other.active && before(other, c))
            ++orders[i];
      }
    }
    state_.frame = frame;
    for (std::size_t i = 0; i < kCallbacks; ++i) {
      state_.callbacks[i].wake = wakes[i];
      state_.callbacks[i].event.frame = events[i];
      state_.callbacks[i].wakeOrder = orders[i];
    }
    sampleRate_ = newRate;
    return true;
  }
  std::uint64_t nextFrame() const noexcept {
    auto frame = std::numeric_limits<std::uint64_t>::max();
    for (const auto &c : state_.callbacks)
      if (c.active && c.wake < frame)
        frame = c.wake;
    return frame;
  }
  void releaseNote(std::uint32_t id) noexcept {
    for (auto &n : state_.notes)
      if (n.id == id) {
        n.retired = true;
        bool inUse = false;
        for (const auto &c : state_.callbacks)
          if (c.active && c.event.id == id)
            inUse = true;
        if (!inUse)
          n.id = 0;
      }
  }
  bool dispatch(Callback callback, Event &event, Host &host) noexcept {
    if (!program_ || !program_->codeCount || state_.error != Error::None)
      return false;
    if (static_cast<std::uint32_t>(callback) >= 6)
      return fail(Error::Program, 0, host);
    if (callback == Callback::Init && state_.initialized)
      return true;
    if (callback != Callback::Init && !state_.initialized) {
      Event init{};
      init.frame = event.frame;
      if (!dispatch(Callback::Init, init, host))
        return false;
    }
    if (!advance(event.frame, host))
      return false;
    if (callback == Callback::Init)
      state_.initialized = true;
    const auto entry = program_->entries[static_cast<std::uint32_t>(callback)];
    if (entry == kNoEntry) {
      host.callbackBoundary(event);
      return true;
    }
    auto *c = allocate();
    if (!c)
      return fail(Error::Callbacks, entry, host);
    c->pc = entry;
    c->event = event;
    c->callback = callback;
    c->wake = event.frame;
    if (callback == Callback::Note || callback == Callback::Release) {
      for (std::uint32_t i = 0; i < kNotes; ++i)
        if (state_.notes[i].id == event.id && event.id)
          c->poly = i;
      if (c->poly == kNoEntry && program_->cells[2]) {
        for (std::uint32_t i = 0; i < kNotes; ++i)
          if (!state_.notes[i].id) {
            c->poly = i;
            state_.notes[i].id = event.id;
            state_.notes[i].retired = false;
            for (auto &v : state_.notes[i].values)
              v = {};
            for (std::uint32_t variable = 0; variable < program_->variableCount; ++variable) {
              const auto &descriptor = program_->variables[variable];
              if (descriptor.scope == 2 && descriptor.type == 1)
                for (std::uint32_t cell = 0; cell < descriptor.length; ++cell)
                  state_.notes[i].values[descriptor.offset + cell] = Value::fromReal(0);
            }
            break;
          }
        if (c->poly == kNoEntry)
          return fail(Error::Storage, entry, host);
      }
    }
    std::uint32_t budget = 4096;
    if (!run(*c, budget, host))
      return false;
    if (!hasPendingBudget())
      host.callbackBoundary(c->event);
    event = c->event;
    return true;
  }
  bool advance(std::uint64_t frame, Host &host) noexcept {
    const auto result = advanceSlice(frame, host, 65536);
    return result == AdvanceResult::Complete ||
           (result == AdvanceResult::Pending ? fail(Error::Budget, 0, host) : false);
  }
  AdvanceResult advanceSlice(std::uint64_t frame, Host &host, std::uint32_t budget) noexcept {
    if (state_.error != Error::None || frame < state_.frame || !program_)
      return AdvanceResult::Error;
    while (true) {
      Continuation *next =
          state_.budgetCallback < kCallbacks ? &state_.callbacks[state_.budgetCallback] : nullptr;
      if (!next)
        for (auto &c : state_.callbacks)
          if (c.active && c.wake <= frame && (!next || before(c, *next)))
            next = &c;
      if (!next)
        break;
      if (!budget)
        return AdvanceResult::Pending;
      state_.frame = next->wake;
      next->event.frame = next->wake;
      next->waiting = false;
      if (!run(*next, budget, host))
        return AdvanceResult::Error;
      if (!hasPendingBudget())
        host.callbackBoundary(next->event);
    }
    state_.frame = frame;
    return AdvanceResult::Complete;
  }

private:
  // AudioWorklet globals need not expose performance.now(), which backs Emscripten's
  // steady clock. Its system clock uses Date.now(); profiling alone may read it.
#ifdef __EMSCRIPTEN__
  using ProfileClock = std::chrono::system_clock;
#else
  using ProfileClock = std::chrono::steady_clock;
#endif
  static std::uint64_t wallMicros() noexcept {
    const auto count = std::chrono::duration_cast<std::chrono::microseconds>(
                           std::chrono::system_clock::now().time_since_epoch())
                           .count();
    return count > 0 ? static_cast<std::uint64_t>(count) : 0;
  }
  static std::uint64_t elapsedMicros(ProfileClock::time_point start) noexcept {
    const auto count =
        std::chrono::duration_cast<std::chrono::microseconds>(ProfileClock::now() - start).count();
    return count > 0 ? static_cast<std::uint64_t>(count) : 0;
  }
  static std::uint64_t performanceClockMicros() noexcept {
#if defined(_WIN32) && !defined(__EMSCRIPTEN__)
    FILETIME creation{}, exit{}, kernel{}, user{};
    if (!GetThreadTimes(GetCurrentThread(), &creation, &exit, &kernel, &user))
      return 0;
    const auto ticks = [](const FILETIME &time) {
      return (static_cast<std::uint64_t>(time.dwHighDateTime) << 32u) | time.dwLowDateTime;
    };
    return (ticks(kernel) + ticks(user)) / 10u;
#elif defined(__linux__) && !defined(__EMSCRIPTEN__)
    timespec time{};
    if (clock_gettime(CLOCK_THREAD_CPUTIME_ID, &time) != 0)
      return 0;
    return static_cast<std::uint64_t>(time.tv_sec) * 1000000u +
           static_cast<std::uint64_t>(time.tv_nsec) / 1000u;
#else
    // Browsers expose elapsed clocks, not thread CPU counters. The NKSP reference
    // explicitly permits real-time profiling as the platform fallback.
    return wallMicros();
#endif
  }
  std::uint64_t activePerformanceMicros() const noexcept {
    const auto now = performanceClockMicros();
    return now > runPerformanceStart_ ? now - runPerformanceStart_ : 0;
  }
  std::uint64_t realMicros() const noexcept {
    return realOffsetMicros_ + elapsedMicros(clockOrigin_);
  }
  static bool before(const Continuation &a, const Continuation &b) noexcept {
    return a.wake < b.wake || (a.wake == b.wake && (a.wakeOrder < b.wakeOrder ||
                                                    (a.wakeOrder == b.wakeOrder && a.id < b.id)));
  }
  const Program *program_ = nullptr;
  double sampleRate_ = 48000;
  State state_{};
  ProfileClock::time_point clockOrigin_{};
  std::uint64_t realOffsetMicros_ = 0, performanceMicros_ = 0, runPerformanceStart_ = 0;
  bool validState(const State &state) const noexcept {
    if (!program_ || state.budgetCallback != kNoEntry ||
        state.fingerprint != program_->fingerprint || state.error != Error::None || !state.nextId)
      return false;
    const auto validValue = [&](const Value &v) {
      if (!std::isfinite(v.numeric()) || v.kind > 5 || v.text.back())
        return false;
      if (v.kind <= 2)
        return !(v.flags & ~0x00ff0303u) && v.prefixExponent() >= -12 && v.prefixExponent() <= 12;
      if (v.numeric() < 0 || std::floor(v.numeric()) != v.numeric())
        return false;
      if (v.kind == 3)
        return v.numeric() < program_->variableCount &&
               v.flags < program_->variables[static_cast<std::uint32_t>(v.numeric())].length;
      return v.kind == 4 ? v.numeric() <= 17 : v.numeric() <= 268435455;
    };
    for (std::uint32_t i = 0; i < program_->cells[0]; ++i)
      if (!validValue(state.globals[i]))
        return false;
    for (const auto &note : state.notes)
      if (note.id)
        for (std::uint32_t i = 0; i < program_->cells[2]; ++i)
          if (!validValue(note.values[i]))
            return false;
    for (const auto &c : state.callbacks)
      if (c.active) {
        if (c.pc >= program_->codeCount || c.sp > kStack || c.depth > c.returns.size() ||
            c.savedCount > kSavedLocals || c.childCount > kCallbacks ||
            (c.poly != kNoEntry && c.poly >= kNotes) || static_cast<std::uint32_t>(c.callback) > 5)
          return false;
        std::uint32_t saved = 0;
        for (std::uint32_t i = 0; i < c.depth; ++i) {
          if (c.returns[i] >= program_->codeCount || c.returnSp[i] > kStack ||
              c.returnLocal[i] > kLocals || c.returnCount[i] > kLocals - c.returnLocal[i] ||
              c.returnCount[i] > kSavedLocals - saved)
            return false;
          saved += c.returnCount[i];
        }
        if (saved != c.savedCount)
          return false;
        for (std::uint32_t i = 0; i < c.sp; ++i)
          if (!validValue(c.stack[i]))
            return false;
        for (std::uint32_t i = 0; i < program_->cells[1]; ++i)
          if (!validValue(c.locals[i]))
            return false;
        for (std::uint32_t i = 0; i < c.savedCount; ++i)
          if (!validValue(c.savedLocals[i]))
            return false;
      }
    return true;
  }
  bool fail(Error error, std::uint32_t pc, Host &host) noexcept {
    state_.error = error;
    for (auto &c : state_.callbacks)
      c.active = false;
    host.diagnostic(error, pc);
    return false;
  }
  void finish(Continuation &c) noexcept {
    c.active = false;
    if (c.parent && c.poly < kNotes && state_.notes[c.poly].id == kNoEntry)
      state_.notes[c.poly].id = 0;
    for (std::size_t pass = 0; pass < kCallbacks; ++pass)
      for (auto &child : state_.callbacks)
        if (child.active && child.autoAbort && child.parent) {
          bool alive = false;
          for (const auto &parent : state_.callbacks)
            if (parent.active && parent.id == child.parent)
              alive = true;
          if (!alive) {
            child.active = false;
            if (child.poly < kNotes && state_.notes[child.poly].id == kNoEntry)
              state_.notes[child.poly].id = 0;
          }
        }
    for (auto &note : state_.notes)
      if (note.retired && note.id) {
        bool active = false;
        for (const auto &other : state_.callbacks)
          if (other.active && other.event.id == note.id)
            active = true;
        if (!active)
          note.id = 0;
      }
  }
  Continuation *allocate() noexcept {
    for (auto &c : state_.callbacks)
      if (!c.active) {
        if (!state_.nextId)
          return nullptr;
        c.pc = c.sp = c.depth = c.parent = c.steps = c.synchronized = c.childCount = c.savedCount =
            0;
        c.poly = kNoEntry;
        c.active = true;
        c.waiting = c.ignoreWait = false;
        c.autoAbort = true;
        c.id = state_.nextId++;
        c.wakeOrder = c.id;
        for (auto &v : c.locals)
          v = {};
        c.children.fill(0);
        return &c;
      }
    return nullptr;
  }
  Value *cell(Continuation &c, std::uint32_t variable, double index) noexcept {
    if (variable >= program_->variableCount || !std::isfinite(index) || index < 0 ||
        std::floor(index) != index)
      return nullptr;
    const auto &d = program_->variables[variable];
    if (index >= d.length)
      return nullptr;
    const auto at = d.offset + static_cast<std::uint32_t>(index);
    if (d.scope == 0)
      return &state_.globals[at];
    if (d.scope == 1)
      return &c.locals[at];
    return c.poly < kNotes ? &state_.notes[c.poly].values[at] : nullptr;
  }
  static bool uint(const Value &v, std::uint32_t &out) noexcept {
    if (v.kind > 1 || !std::isfinite(v.numeric()) || v.numeric() < 0 ||
        v.numeric() > 4294967295.0 || std::floor(v.numeric()) != v.numeric())
      return false;
    out = static_cast<std::uint32_t>(v.numeric());
    return true;
  }
  static Value number(double n, std::uint32_t kind = 0, std::uint32_t flags = 0) noexcept {
    Value v;
    v.kind = kind;
    v.flags = flags;
    if (kind == 1)
      v.real = n;
    else {
      const auto coefficient = kind == 0 ? std::round(n / v.scale()) : n;
      if (!std::isfinite(coefficient) || coefficient < -9223372036854775808.0 ||
          coefficient >= 9223372036854775808.0)
        v.kind = 6;
      else
        v.integer = static_cast<std::int64_t>(coefficient);
    }
    return v;
  }
  bool push(Continuation &c, const Value &v, Host &host) noexcept {
    if (v.kind > 5 || (v.kind == 1 && !std::isfinite(v.real)))
      return fail(Error::Arithmetic, c.pc, host);
    if (c.sp >= kStack)
      return fail(Error::Stack, c.pc, host);
    c.stack[c.sp++] = v;
    return true;
  }
  bool readVariable(Continuation &c, Variable variable, std::uint32_t index, Value &out,
                    Host &host) noexcept {
    switch (variable) {
    case Variable::KspTimer:
    case Variable::RealTimer: {
      out = Value::fromInteger(static_cast<std::int64_t>(realMicros()));
      return true;
    }
    case Variable::PerfTimer: {
      out = Value::fromInteger(
          static_cast<std::int64_t>(performanceMicros_ + activePerformanceMicros()));
      return true;
    }
    case Variable::EngineUptime:
      out = number(std::floor(static_cast<double>(c.event.frame) * 1000.0 / sampleRate_));
      return true;
    case Variable::CallbackId:
      out = number(c.id);
      return true;
    case Variable::CallbackType:
      out = number(static_cast<std::uint32_t>(c.callback));
      return true;
    case Variable::ParentId:
      out = number(c.parent);
      return true;
    case Variable::IgnoreWait:
      out = number(c.ignoreWait ? 1 : 0);
      return true;
    case Variable::ChildId:
      if (index == kNoEntry) {
        out = number(c.childCount);
        return true;
      }
      if (index >= c.childCount)
        return false;
      out = number(c.children[index]);
      return true;
    case Variable::EventId:
      out = number(c.event.id);
      return true;
    case Variable::EventNote:
      out = number(c.event.note);
      return true;
    case Variable::EventVelocity:
      out = number(c.event.velocity);
      return true;
    case Variable::CcNum:
      out = number(c.event.controller);
      return true;
    case Variable::RpnAddress:
      out = number(c.event.address);
      return true;
    case Variable::RpnValue:
      out = number(c.event.value);
      return true;
    default:
      return host.read(variable, index, c.event, out);
    }
  }
  bool arrayLength(Continuation &c, const Value &ref, std::uint32_t &length, Host &host) noexcept {
    if (ref.kind == 5 && ref.numeric() >= 0 && ref.numeric() <= 268435455) {
      Value out;
      return host.markedEvent(static_cast<std::uint32_t>(ref.numeric()), kNoEntry, c.event, out) &&
             uint(out, length) && length <= 256;
    }
    if (ref.kind == 3 && ref.numeric() >= 0 && ref.numeric() < program_->variableCount) {
      length = program_->variables[static_cast<std::uint32_t>(ref.numeric())].length;
      return true;
    }
    Value out;
    if (ref.kind == 4 && ref.numeric() >= 0 && ref.numeric() <= 17 &&
        readVariable(c, static_cast<Variable>(static_cast<std::uint32_t>(ref.numeric())), kNoEntry,
                     out, host))
      return uint(out, length) && length <= 256;
    return false;
  }
  bool arrayRead(Continuation &c, const Value &ref, std::uint32_t index, Value &out,
                 Host &host) noexcept {
    if (ref.kind == 5)
      return host.markedEvent(static_cast<std::uint32_t>(ref.numeric()), index, c.event, out);
    if (ref.kind == 3) {
      auto *v = cell(c, static_cast<std::uint32_t>(ref.numeric()), index);
      if (!v)
        return false;
      out = *v;
      return true;
    }
    return ref.kind == 4 &&
           readVariable(c, static_cast<Variable>(static_cast<std::uint32_t>(ref.numeric())), index,
                        out, host);
  }
  static bool addInteger(std::int64_t a, std::int64_t b, std::int64_t &out) noexcept {
    if ((b > 0 && a > std::numeric_limits<std::int64_t>::max() - b) ||
        (b < 0 && a < std::numeric_limits<std::int64_t>::min() - b))
      return false;
    out = a + b;
    return true;
  }
  static bool multiplyInteger(std::int64_t a, std::int64_t b, std::int64_t &out) noexcept {
    const bool negative = (a < 0) != (b < 0);
    const auto magnitude = [](std::int64_t n) {
      const auto u = static_cast<std::uint64_t>(n);
      return n < 0 ? 0u - u : u;
    };
    const auto x = magnitude(a), y = magnitude(b);
    const auto limit = negative ? (std::uint64_t{1} << 63u) : (std::uint64_t{1} << 63u) - 1u;
    if (y && x > limit / y)
      return false;
    const auto product = x * y;
    out = std::bit_cast<std::int64_t>(negative ? 0u - product : product);
    return true;
  }
  static bool scaleInteger(std::int64_t value, int exponent, std::int64_t &out) noexcept {
    out = value;
    for (int i = 0; i < exponent; ++i)
      if (!multiplyInteger(out, 10, out))
        return false;
    return true;
  }
  static int compare(const Value &a, const Value &b) noexcept {
    if (a.kind != 0 || b.kind != 0)
      return a.numeric() < b.numeric() ? -1 : a.numeric() > b.numeric() ? 1 : 0;
    const auto difference = a.prefixExponent() - b.prefixExponent();
    if (difference < 0)
      return -compare(b, a);
    if (!difference)
      return a.integer < b.integer ? -1 : a.integer > b.integer ? 1 : 0;
    if (difference > 18)
      return a.integer < 0 ? -1 : a.integer > 0 ? 1 : b.integer < 0 ? 1 : b.integer > 0 ? -1 : 0;
    std::int64_t factor = 1;
    for (int i = 0; i < difference; ++i)
      factor *= 10;
    const auto quotient = b.integer / factor, remainder = b.integer % factor;
    return a.integer < quotient   ? -1
           : a.integer > quotient ? 1
           : remainder > 0        ? -1
           : remainder < 0        ? 1
                                  : 0;
  }
  static bool equal(const Value &a, const Value &b) noexcept {
    return a.kind == 2 || b.kind == 2 ? a.kind == b.kind && a.text == b.text : compare(a, b) == 0;
  }
  static bool textValue(const Value &value, std::array<char, 128> &text) noexcept {
    if (value.kind == 2) {
      text = value.text;
      return true;
    }
    if (value.kind > 1)
      return false;
    constexpr const char *prefixes[] = {
        "uu", "umc", "umd", "um",  "uc", "ud", "u",    "mc",  "md",  "m",     "c",    "d",   "",
        "da", "h",   "k",   "kda", "kh", "kk", "kkda", "kkh", "kkk", "kkkda", "kkkh", "kkkk"};
    constexpr const char *units[] = {"", "s", "Hz", "B"};
    const auto exponent = value.prefixExponent();
    if (exponent < -12 || exponent > 12)
      return false;
    const auto size = value.kind == 0 ? std::snprintf(text.data(), text.size(), "%lld%s%s",
                                                      static_cast<long long>(value.integer),
                                                      prefixes[exponent + 12], units[value.unit()])
                                      : std::snprintf(text.data(), text.size(), "%.12g%s%s",
                                                      value.real / value.scale(),
                                                      prefixes[exponent + 12], units[value.unit()]);
    return size >= 0 && static_cast<std::size_t>(size) < text.size();
  }
  static bool divideInteger(std::int64_t numerator, std::int64_t denominator, int exponent,
                            std::int64_t &out) noexcept {
    if (!denominator || exponent < -24 || exponent > 24)
      return false;
    const auto magnitude = [](std::int64_t value) {
      return value < 0 ? std::uint64_t(-(value + 1)) + 1u : std::uint64_t(value);
    };
    const bool negative = (numerator < 0) != (denominator < 0);
    const auto divisor = magnitude(denominator);
    auto quotient = magnitude(numerator) / divisor;
    auto remainder = magnitude(numerator) % divisor;
    const auto limit = std::uint64_t(std::numeric_limits<std::int64_t>::max()) +
                       static_cast<std::uint64_t>(negative);
    // Decimal long division retains the remainder before applying prefixes.
    // Each digit uses bounded unsigned addition, including the INT64_MIN case.
    for (int i = 0; i < exponent; ++i) {
      if (quotient > limit / 10u)
        return false;
      quotient *= 10u;
      std::uint64_t nextRemainder = 0, digit = 0;
      for (int j = 0; j < 10; ++j) {
        if (nextRemainder >= divisor - remainder) {
          nextRemainder -= divisor - remainder;
          ++digit;
        } else
          nextRemainder += remainder;
      }
      if (quotient > limit - digit)
        return false;
      quotient += digit;
      remainder = nextRemainder;
    }
    for (int i = exponent; i < 0; ++i)
      quotient /= 10u;
    if (quotient > limit)
      return false;
    out = negative
              ? (quotient == (std::uint64_t{1} << 63u) ? std::numeric_limits<std::int64_t>::min()
                                                       : -static_cast<std::int64_t>(quotient))
              : static_cast<std::int64_t>(quotient);
    return true;
  }
  bool binary(std::uint32_t op, const Value &a, const Value &b, Value &out) noexcept {
    if (op == 16) {
      out.kind = 2;
      std::array<char, 128> left{}, right{};
      if (!textValue(a, left) || !textValue(b, right))
        return false;
      const auto n = std::strlen(left.data()), m = std::strlen(right.data());
      if (n + m >= out.text.size())
        return false;
      std::memcpy(out.text.data(), left.data(), n);
      std::memcpy(out.text.data() + n, right.data(), m + 1);
      return true;
    }
    if (op == 5 || op == 6) {
      out = number(equal(a, b) == (op == 5) ? 1 : 0);
      return true;
    }
    if (a.kind > 1 || b.kind > 1 || a.kind != b.kind)
      return false;
    const auto au = a.unit(), bu = b.unit();
    auto unit = au;
    auto exponent = std::min(a.prefixExponent(), b.prefixExponent());
    if (op == 2) {
      if (au && bu)
        return false;
      unit = au | bu;
      exponent = a.prefixExponent() + b.prefixExponent();
    } else if (op == 3) {
      if (bu && au != bu)
        return false;
      unit = bu ? 0 : au;
      exponent = a.prefixExponent() - b.prefixExponent();
    } else if (au != bu)
      return false;
    const bool unitlessIntegerDivision = op == 3 && !unit && a.kind == 0;
    const auto divisionExponent = exponent;
    if (unitlessIntegerDivision)
      exponent = 0;
    if (exponent < -12 || exponent > 12)
      return false;
    const auto flags = unit | ((a.flags | b.flags) & (unitlessIntegerDivision ? 256u : 768u)) |
                       (static_cast<std::uint32_t>(exponent) & 255u) << 16u;
    if (a.kind == 0) {
      auto x = a.integer, y = b.integer;
      std::int64_t result = 0;
      if (op <= 1 || op == 4) {
        if (!scaleInteger(x, a.prefixExponent() - exponent, x) ||
            !scaleInteger(y, b.prefixExponent() - exponent, y))
          return false;
      }
      switch (op) {
      case 0:
        if (!addInteger(x, y, result))
          return false;
        break;
      case 1:
        if ((y > 0 && x < std::numeric_limits<std::int64_t>::min() + y) ||
            (y < 0 && x > std::numeric_limits<std::int64_t>::max() + y))
          return false;
        result = x - y;
        break;
      case 2:
        if (!multiplyInteger(x, y, result))
          return false;
        break;
      case 3:
        if (!divideInteger(x, y, unitlessIntegerDivision ? divisionExponent : 0, result))
          return false;
        break;
      case 4:
        if (!y || (x == std::numeric_limits<std::int64_t>::min() && y == -1))
          return false;
        result = x % y;
        break;
      case 7:
        result = compare(a, b) < 0;
        break;
      case 8:
        result = compare(a, b) > 0;
        break;
      case 9:
        result = compare(a, b) <= 0;
        break;
      case 10:
        result = compare(a, b) >= 0;
        break;
      case 11:
        result = x != 0 && y != 0;
        break;
      case 12:
        result = x != 0 || y != 0;
        break;
      case 13:
        result = x & y;
        break;
      case 14:
        result = x | y;
        break;
      case 15:
        result = x ^ y;
        break;
      default:
        return false;
      }
      out = Value::fromInteger(result, op <= 4 ? flags : 0);
      return true;
    }
    out = number(0, a.kind == 1 || b.kind == 1 ? 1 : 0, flags);
    const auto x = a.numeric(), y = b.numeric();
    switch (op) {
    case 0:
      out.real = x + y;
      break;
    case 1:
      out.real = x - y;
      break;
    case 2:
      out.real = x * y;
      break;
    case 3:
      if (y == 0)
        return false;
      out.real = x / y;
      break;
    case 4:
      if (y == 0)
        return false;
      return false;
      break;
    case 7:
      out = number(x < y ? 1 : 0);
      break;
    case 8:
      out = number(x > y ? 1 : 0);
      break;
    case 9:
      out = number(x <= y ? 1 : 0);
      break;
    case 10:
      out = number(x >= y ? 1 : 0);
      break;
    case 11:
      out = number(x != 0 && y != 0 ? 1 : 0);
      break;
    case 12:
      out = number(x != 0 || y != 0 ? 1 : 0);
      break;
    case 13:
    case 14:
    case 15: {
      if (x < -2147483648.0 || x > 2147483647.0 || y < -2147483648.0 || y > 2147483647.0)
        return false;
      const auto ax = static_cast<std::int32_t>(x), by = static_cast<std::int32_t>(y);
      out = number(op == 13 ? ax & by : op == 14 ? ax | by : ax ^ by);
      break;
    }
    default:
      return false;
    }
    return std::isfinite(out.numeric());
  }
  bool builtin(Continuation &c, Builtin fn, Value *a, std::uint32_t count, Value &out,
               Host &host) noexcept {
    const double x = count ? a[0].numeric() : 0, y = count > 1 ? a[1].numeric() : 0;
    const auto unary = [&](double value) {
      out = number(value, count ? a[0].kind : 0, count ? a[0].flags : 0);
      return std::isfinite(value);
    };
    switch (fn) {
    case Builtin::Exit:
      if (c.depth)
        c.pc = c.returns[--c.depth];
      else
        finish(c);
      return count == 0;
    case Builtin::Abort:
      for (auto &other : state_.callbacks)
        if (other.active && other.id == x)
          finish(other);
      return count == 1;
    case Builtin::CallbackStatus:
      out = number(0);
      for (const auto &other : state_.callbacks)
        if (other.active && other.id == x)
          out = number(other.waiting ? 1 : 2);
      return count == 1;
    case Builtin::Wait: {
      if (count != 1 || a[0].kind > 1 || !std::isfinite(x) || x <= 0 || a[0].unit() > 1)
        return false;
      if (c.ignoreWait)
        return true;
      const double frames = std::ceil(x * sampleRate_ / ((a[0].flags & 3u) == 1 ? 1.0 : 1000000.0));
      if (frames > 9007199254740991.0 ||
          c.event.frame > 9007199254740991ull - static_cast<std::uint64_t>(frames))
        return false;
      c.wake = c.event.frame + (frames < 1 ? 1 : static_cast<std::uint64_t>(frames));
      c.wakeOrder = c.id;
      c.waiting = true;
      c.steps = 0;
      return true;
    }
    case Builtin::StopWait:
      if (count < 1 || count > 2)
        return false;
      for (auto &other : state_.callbacks)
        if (other.active && other.id == x) {
          other.wake = c.event.frame;
          other.wakeOrder = other.id;
          other.waiting = false;
          if (count > 1 && y != 0)
            other.ignoreWait = true;
        }
      return true;
    case Builtin::Fork: {
      const auto wanted = count ? x : 1;
      if (wanted < 1 || wanted > 8 || std::floor(wanted) != wanted || count > 2 ||
          (count > 1 && y != 0 && y != 1))
        return false;
      std::uint32_t available = 0, polyAvailable = 0;
      for (const auto &other : state_.callbacks)
        if (!other.active)
          ++available;
      for (const auto &note : state_.notes)
        if (!note.id)
          ++polyAvailable;
      if (wanted > available || c.childCount + wanted > 8 ||
          (c.poly < kNotes && wanted > polyAvailable)) {
        out = number(-1);
        return true;
      }
      for (std::uint32_t i = 0; i < wanted; ++i) {
        auto *child = allocate();
        if (!child)
          return false;
        const auto id = child->id;
        *child = c;
        child->id = id;
        child->wakeOrder = id;
        child->parent = c.id;
        child->childCount = 0;
        child->autoAbort = count < 2 || y != 0;
        child->children.fill(0);
        if (c.poly < kNotes)
          for (std::uint32_t slot = 0; slot < kNotes; ++slot)
            if (!state_.notes[slot].id) {
              state_.notes[slot] = state_.notes[c.poly];
              state_.notes[slot].id = kNoEntry;
              child->poly = slot;
              break;
            }
        child->wake = c.event.frame;
        child->waiting = true;
        if (!push(*child, number(i + 1), host))
          return false;
        c.children[c.childCount++] = id;
      }
      out = number(0);
      return true;
    }
    case Builtin::Inc:
    case Builtin::Dec: {
      if (count != 1 || a[0].kind != 3)
        return false;
      auto *v = cell(c, static_cast<std::uint32_t>(x), a[0].flags);
      if (!v || v->kind > 1)
        return false;
      if (v->kind != 0)
        return false;
      if (!addInteger(v->integer, fn == Builtin::Inc ? 1 : -1, v->integer))
        return false;
      out = *v;
      return std::isfinite(v->numeric());
    }
    case Builtin::NumElements: {
      std::uint32_t length = 0;
      if (count != 1 || !arrayLength(c, a[0], length, host))
        return false;
      out = number(length);
      return true;
    }
    case Builtin::ArrayEqual:
    case Builtin::Search:
    case Builtin::Sort: {
      std::uint32_t length = 0, right = 0;
      if (!count || !arrayLength(c, a[0], length, host))
        return false;
      if (fn == Builtin::ArrayEqual) {
        if (count != 2 || !arrayLength(c, a[1], right, host))
          return false;
        out = number(length == right ? 1 : 0);
        for (std::uint32_t i = 0; i < length && out.numeric(); ++i) {
          Value va, vb;
          if (!arrayRead(c, a[0], i, va, host) || !arrayRead(c, a[1], i, vb, host))
            return false;
          if (!equal(va, vb))
            out = Value::fromInteger(0);
        }
      } else if (fn == Builtin::Search) {
        if (count != 2)
          return false;
        out = number(-1);
        for (std::uint32_t i = 0; i < length; ++i) {
          Value v;
          if (!arrayRead(c, a[0], i, v, host))
            return false;
          if (equal(v, a[1])) {
            out = number(i);
            break;
          }
        }
      } else {
        if (count > 2 || a[0].kind != 3)
          return false;
        auto *first = cell(c, static_cast<std::uint32_t>(x), 0);
        if (!first)
          return false;
        std::sort(first, first + length, [y](const Value &l, const Value &r) {
          return y ? compare(l, r) > 0 : compare(l, r) < 0;
        });
      }
      return true;
    }
    case Builtin::Message:
      return host.supports(fn) && host.call(fn, a, count, c.event, out);
    default:
      break;
    }
    if (static_cast<std::uint32_t>(fn) >= 41) {
      if (!host.supports(fn))
        return false;
      if (fn == Builtin::ByMarks) {
        std::uint32_t mask = 0;
        if (count != 1 || !uint(a[0], mask) || mask > 268435455u)
          return false;
        out = number(mask, 5);
        return true;
      }
      if (count && (a[0].kind == 3 || a[0].kind == 4 || a[0].kind == 5)) {
        std::uint32_t length = 0;
        if (!arrayLength(c, a[0], length, host))
          return false;
        const Value ref = a[0];
        std::array<std::uint32_t, 256> ids{};
        for (std::uint32_t i = 0; i < length; ++i) {
          Value value;
          if (!arrayRead(c, ref, i, value, host) || !uint(value, ids[i]))
            return false;
        }
        for (std::uint32_t i = 0; i < length; ++i) {
          a[0] = number(ids[i]);
          if (!host.call(fn, a, count, c.event, out))
            return false;
        }
        return true;
      }
      return host.call(fn, a, count, c.event, out);
    }
    for (std::uint32_t i = 0; i < count; ++i)
      if (a[i].kind > 1 || !std::isfinite(a[i].numeric()))
        return false;
    switch (fn) {
    case Builtin::Abs:
      if (count == 1 && a[0].kind == 0) {
        if (a[0].integer == std::numeric_limits<std::int64_t>::min())
          return false;
        out = Value::fromInteger(a[0].integer < 0 ? -a[0].integer : a[0].integer, a[0].flags);
        return true;
      }
      return count == 1 && unary(x < 0 ? -x : x);
    case Builtin::Acos:
      return count == 1 && unary(std::acos(x));
    case Builtin::Asin:
      return count == 1 && unary(std::asin(x));
    case Builtin::Atan:
      return count == 1 && unary(std::atan(x));
    case Builtin::Ceil:
      return count == 1 && unary(std::ceil(x / a[0].scale()) * a[0].scale());
    case Builtin::Cos:
      return count == 1 && unary(std::cos(x));
    case Builtin::Exp:
      return count == 1 && unary(std::exp(x));
    case Builtin::Floor:
      return count == 1 && unary(std::floor(x / a[0].scale()) * a[0].scale());
    case Builtin::Log:
      return count == 1 && unary(std::log(x));
    case Builtin::Log10:
      return count == 1 && unary(std::log10(x));
    case Builtin::Log2:
      return count == 1 && unary(std::log2(x));
    case Builtin::Round:
      return count == 1 && unary(std::round(x / a[0].scale()) * a[0].scale());
    case Builtin::Sin:
      return count == 1 && unary(std::sin(x));
    case Builtin::Sqrt:
      return count == 1 && unary(std::sqrt(x));
    case Builtin::Tan:
      return count == 1 && unary(std::tan(x));
    case Builtin::Int:
    case Builtin::RealToInt:
      if (count != 1)
        return false;
      out = number(std::trunc(x / a[0].scale()) * a[0].scale(), 0, a[0].flags);
      return true;
    case Builtin::Real:
    case Builtin::IntToReal:
      out = number(x, 1, a[0].flags);
      return count == 1;
    case Builtin::InRange:
      if (count != 3)
        return false;
      out = number(compare(a[0], a[1]) >= 0 && compare(a[0], a[2]) <= 0 ? 1 : 0);
      return true;
    case Builtin::Min:
      if (count != 2)
        return false;
      out = compare(a[0], a[1]) < 0 ? a[0] : a[1];
      out.flags |= (a[0].flags | a[1].flags) & 256u;
      return true;
    case Builtin::Max:
      if (count != 2)
        return false;
      out = compare(a[0], a[1]) > 0 ? a[0] : a[1];
      out.flags |= (a[0].flags | a[1].flags) & 256u;
      return true;
    case Builtin::Pow:
      out = number(std::pow(x, y), a[0].kind, a[0].flags);
      return count == 2 && std::isfinite(out.numeric());
    case Builtin::Random: {
      if (count != 2 || compare(a[0], a[1]) > 0)
        return false;
      auto r = state_.random;
      r ^= r << 13u;
      r ^= r >> 17u;
      r ^= r << 5u;
      state_.random = r;
      const auto exponent = std::min(a[0].prefixExponent(), a[1].prefixExponent());
      const auto flags = a[0].unit() | ((a[0].flags | a[1].flags) & 768u) |
                         (static_cast<std::uint32_t>(exponent) & 255u) << 16u;
      if (a[0].kind == 0 && a[1].kind == 0) {
        std::int64_t low = 0, high = 0;
        if (!scaleInteger(a[0].integer, a[0].prefixExponent() - exponent, low) ||
            !scaleInteger(a[1].integer, a[1].prefixExponent() - exponent, high))
          return false;
        const auto upper = static_cast<std::uint64_t>(r) << 32u;
        r ^= r << 13u;
        r ^= r >> 17u;
        r ^= r << 5u;
        state_.random = r;
        const auto random = upper | r;
        const auto span = static_cast<std::uint64_t>(high) - static_cast<std::uint64_t>(low) + 1u;
        out = Value::fromInteger(std::bit_cast<std::int64_t>(static_cast<std::uint64_t>(low) +
                                                             (span ? random % span : random)),
                                 flags);
        return true;
      }
      const double step = std::pow(10.0, exponent);
      out = number(a[0].kind || a[1].kind
                       ? x + (y - x) * (static_cast<double>(r) / 4294967296.0)
                       : x + step * std::floor(((y - x) / step + 1) *
                                               (static_cast<double>(r) / 4294967296.0)),
                   a[0].kind | a[1].kind, flags);
      return std::isfinite(out.numeric());
    }
    case Builtin::Lsb:
    case Builtin::Msb:
    case Builtin::ShLeft:
    case Builtin::ShRight: {
      if (a[0].kind != 0 || a[0].unit())
        return false;
      const auto bits = static_cast<std::uint64_t>(a[0].integer);
      if (fn == Builtin::Lsb || fn == Builtin::Msb) {
        out = Value::fromInteger(
            static_cast<std::int64_t>((bits >> (fn == Builtin::Msb ? 7u : 0u)) & 127u));
        return count == 1;
      }
      if (count != 2 || a[1].kind != 0 || a[1].unit() || y < 0 || y > 63 || std::floor(y) != y)
        return false;
      out = Value::fromInteger(
          fn == Builtin::ShLeft ? std::bit_cast<std::int64_t>(bits << static_cast<std::uint32_t>(y))
                                : a[0].integer >> static_cast<std::uint32_t>(y),
          a[0].flags);
      return true;
    }
    default:
      return false;
    }
  }
  bool run(Continuation &c, std::uint32_t &budget, Host &host) noexcept {
    state_.budgetCallback = kNoEntry;
    if (program_->profiling)
      runPerformanceStart_ = performanceClockMicros();
    struct Timing {
      VM &vm;
      ~Timing() {
        if (vm.program_->profiling)
          vm.performanceMicros_ += vm.activePerformanceMicros();
      }
    } timing{*this};
    std::uint32_t slice = 4096;
    while (c.active && !c.waiting) {
      if (!budget) {
        c.wake = c.event.frame;
        c.waiting = true;
        state_.budgetCallback = static_cast<std::uint32_t>(&c - state_.callbacks.data());
        return true;
      }
      if (!slice) {
        if (c.synchronized)
          return fail(Error::Budget, c.pc, host);
        c.wake = c.event.frame;
        c.wakeOrder = c.id;
        c.waiting = true;
        state_.budgetCallback = static_cast<std::uint32_t>(&c - state_.callbacks.data());
        return true;
      }
      --budget;
      --slice;
      if (++c.steps > 1048576 || c.pc >= program_->codeCount)
        return fail(Error::Budget, c.pc, host);
      const auto in = program_->code[c.pc++];
      Value result;
      switch (in.op) {
      case 0:
        finish(c);
        break;
      case 1:
        if (!push(c, program_->constants[in.a], host))
          return false;
        break;
      case 2:
      case 3:
      case 5: {
        const std::uint32_t needed = in.op == 3 ? 2 : 1;
        if (c.sp < needed)
          return fail(Error::Stack, c.pc, host);
        const auto index = c.stack[c.sp - needed];
        if (index.kind > 1)
          return fail(Error::Storage, c.pc, host);
        auto *v = cell(c, in.a, index.numeric());
        if (!v)
          return fail(Error::Storage, c.pc, host);
        if (in.op == 3) {
          result = c.stack[c.sp - 1];
          c.sp -= 2;
          const auto type = program_->variables[in.a].type;
          if (result.kind != type || (in.b && (result.unit() || (result.flags & 256u))))
            return fail(Error::Storage, c.pc, host);
          *v = result;
        } else if (in.op == 2)
          c.stack[c.sp - 1] = *v;
        else {
          result = number(in.a, 3, static_cast<std::uint32_t>(index.numeric()));
          c.stack[c.sp - 1] = result;
        }
        break;
      }
      case 4: {
        if (!c.sp)
          return fail(Error::Stack, c.pc, host);
        std::uint32_t index = 0;
        if (!uint(c.stack[c.sp - 1], index))
          return fail(Error::Storage, c.pc, host);
        if (in.b)
          result = number(in.a, 4);
        else if (!readVariable(c, static_cast<Variable>(in.a), index, result, host))
          return fail(Error::Host, c.pc, host);
        c.stack[c.sp - 1] = result;
        break;
      }
      case 6: {
        if (!c.sp || c.stack[c.sp - 1].kind > 1)
          return fail(Error::Stack, c.pc, host);
        auto &v = c.stack[c.sp - 1];
        if (in.a == 0) {
          if (v.kind == 0) {
            if (v.integer == std::numeric_limits<std::int64_t>::min())
              return fail(Error::Arithmetic, c.pc, host);
            v.integer = -v.integer;
          } else
            v.real = -v.real;
        } else if (in.a == 2)
          v = number(v.numeric() == 0 ? 1 : 0);
        else if (in.a == 3) {
          if (v.kind != 0 || v.unit())
            return fail(Error::Arithmetic, c.pc, host);
          v = Value::fromInteger(~v.integer, v.flags);
        } else if (in.a == 4)
          v.flags |= 256u;
        break;
      }
      case 7:
        if (c.sp < 2)
          return fail(Error::Stack, c.pc, host);
        if (!binary(in.a, c.stack[c.sp - 2], c.stack[c.sp - 1], result))
          return fail(Error::Arithmetic, c.pc, host);
        c.sp -= 1;
        c.stack[c.sp - 1] = result;
        break;
      case 8:
        c.pc = in.a;
        break;
      case 9:
        if (!c.sp)
          return fail(Error::Stack, c.pc, host);
        if (c.stack[--c.sp].numeric() == 0)
          c.pc = in.a;
        break;
      case 10:
        if (c.sp < in.b)
          return fail(Error::Stack, c.pc, host);
        c.sp -= in.b;
        if (!builtin(c, static_cast<Builtin>(in.a), c.stack.data() + c.sp, in.b, result, host))
          return fail(Error::Host, c.pc, host);
        if (c.active && in.a != static_cast<std::uint32_t>(Builtin::Exit) && !push(c, result, host))
          return false;
        break;
      case 11:
        if (!c.sp)
          return fail(Error::Stack, c.pc, host);
        --c.sp;
        break;
      case 12:
        if (c.depth >= c.returns.size() || in.c > kSavedLocals - c.savedCount ||
            c.sp < (in.b >> 16u) * 2u)
          return fail(Error::Stack, c.pc, host);
        c.returns[c.depth] = c.pc;
        c.returnSp[c.depth] = c.sp - (in.b >> 16u) * 2u;
        c.returnLocal[c.depth] = in.b & 65535u;
        c.returnCount[c.depth] = in.c;
        c.returnSync[c.depth] = c.synchronized;
        for (std::uint32_t i = 0; i < in.c; ++i)
          c.savedLocals[c.savedCount++] = c.locals[(in.b & 65535u) + i];
        ++c.depth;
        c.pc = in.a;
        break;
      case 13:
        if (!c.depth)
          return fail(Error::Stack, c.pc, host);
        if (in.a) {
          const auto *v = cell(c, in.a - 1, 0);
          if (!v)
            return fail(Error::Storage, c.pc, host);
          result = *v;
        }
        --c.depth;
        c.pc = c.returns[c.depth];
        c.sp = c.returnSp[c.depth];
        c.synchronized = c.returnSync[c.depth];
        if (c.savedCount < c.returnCount[c.depth])
          return fail(Error::Stack, c.pc, host);
        c.savedCount -= c.returnCount[c.depth];
        for (std::uint32_t i = 0; i < c.returnCount[c.depth]; ++i)
          c.locals[c.returnLocal[c.depth] + i] = c.savedLocals[c.savedCount + i];
        if (in.a && !push(c, result, host))
          return false;
        break;
      case 14:
        if (!c.sp)
          return fail(Error::Stack, c.pc, host);
        result = c.stack[c.sp - 1];
        if (!push(c, result, host))
          return false;
        break;
      case 15:
        if (in.a)
          ++c.synchronized;
        else if (c.synchronized)
          --c.synchronized;
        else
          return fail(Error::Program, c.pc, host);
        break;
      default:
        return fail(Error::Program, c.pc, host);
      }
    }
    return true;
  }
};
} // namespace effetune::plugins::others::sfz::script
#endif

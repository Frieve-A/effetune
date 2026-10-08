#include "effetune/kernel.h"
#include "RhythmAnalyzerPluginParams.h"
#include "binary_io.h"
#include "effetune/dsp/denormal_noise.h"
#include "rd6_clock.h"
#include "rd6_engine.h"
#include "rhythm_d.h"
#if defined(ET_RHYTHM_EVALUATION)
#include "evaluation.h"
#endif
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>

namespace effetune::plugins::analyzer {
namespace {
constexpr std::uint32_t kPayloadBytes = 1496u, kMaxEvents = 16u, kEventCapacity = 256u;
enum EventKind : std::uint8_t {
  CommittedLane = 0u,
  InvalidLane = 1u,
  ShownForward = 2u,
  ProvisionalLane = 3u,
  HiddenForward = 4u,
  CommittedBeat = 5u
};
struct Event {
  double time = 0.0;
  float strength = 0.0f, fraction = 0.0f, period = 0.0f;
  std::int32_t index = 0;
  std::uint32_t epoch = 0u;
  std::uint8_t band = 0u;
  EventKind flags = InvalidLane;
};
template <class T, std::uint32_t N> struct Queue {
  std::array<T, N> data{};
  std::uint32_t read = 0u, count = 0u;
  void clear() noexcept { read = count = 0u; }
  bool push(const T &value) noexcept {
    if (count == N)
      return false;
    data[(read + count++) % N] = value;
    return true;
  }
  T &front() noexcept { return data[read]; }
  void pop() noexcept {
    read = (read + 1u) % N;
    --count;
  }
};
float fraction(double value) noexcept {
  const float f = static_cast<float>(value);
  return f >= 1.0f ? 0.99999994f : f < 0.0f ? 0.0f : f;
}
double bounded(float value, double lo, double hi, double fallback) noexcept {
  if (!std::isfinite(value))
    return fallback;
  return value < lo ? lo : value > hi ? hi : value;
}
} // namespace

class RhythmAnalyzerKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::RhythmAnalyzerPluginParams)
public:
  void prepare(const PrepareInfo &info) override {
    ready_ = false;
    hostRate_ =
        std::isfinite(info.sampleRate) && info.sampleRate > 0.0f ? info.sampleRate : 48000.0;
    analysisRate_ = rhythm_d::RateRule::analysisRate(hostRate_);
    if (!lanes_)
      lanes_ = std::make_unique<rhythm_d::Detector>();
    lanes_->sink = {this, &RhythmAnalyzerKernel::laneEvent, nullptr, nullptr};
    lanes_->prepare(hostRate_);
    if (analysisRate_ != 0u) {
      if (!beat_)
        beat_ = std::make_unique<rhythm_a3::Rd6Engine>();
      beat_->sink = {this, &RhythmAnalyzerKernel::beatEvent, &RhythmAnalyzerKernel::analysisEvent,
                     nullptr, &RhythmAnalyzerKernel::hardSilence};
      beat_->prepare(analysisRate_, hostRate_);
    } else
      beat_.reset();
    if (!queues_)
      queues_ = std::make_unique<Queues>();
    constexpr double pi = 3.141592653589793;
    const double omega = 2.0 * pi * 2000.0 / hostRate_,
                 r = rhythm_d::portableExp(-1.0 / (.006 * hostRate_));
    const double amplitude = .31622776601683794 * rhythm_d::portableExp(.0005 / .006);
    clickA_ = 2.0 * r * rhythm_d::portableCos(omega);
    clickB_ = r * r;
    clickStart_ = -amplitude * rhythm_d::portableSin(omega) / r;
    clickAttack_ = static_cast<std::uint32_t>(std::ceil(.0005 * hostRate_));
    clickLength_ = static_cast<std::uint32_t>(std::ceil(.06 * hostRate_));
    minimum_ = maximum_ = 0.0;
    ready_ = true;
    sync_ = true;
    synchronize();
    reset();
  }
  bool preparedSuccessfully() const noexcept override { return ready_; }
  void reset() noexcept override {
    if (++generation_ == 0u)
      ++generation_;
    input_ = analysed_ = 0u;
    channels_ = 0u;
    time_ = 0.0;
    dirty_ = true;
    dropped_ = 0u;
    if (lanes_)
      lanes_->reset();
    if (beat_)
      beat_->reset();
    if (queues_) {
      queues_->events.clear();
      queues_->lanes.clear();
      queues_->clicks.clear();
      queues_->clock.reset();
    }
    clearClick();
  }
  void process(float *audio, std::uint32_t channels, std::uint32_t frames,
               const ProcessInfo &info) noexcept override {
    if (!ready_ || audio == nullptr || channels == 0u)
      return;
    synchronize();
    if (channels_ != 0u && channels_ != channels)
      reset();
    channels_ = channels;
    for (std::uint32_t i = 0u; i < frames; ++i) {
      const double left = std::isfinite(audio[i]) ? audio[i] : 0.0;
      const double right = channels == 1u                     ? left
                           : std::isfinite(audio[frames + i]) ? audio[frames + i]
                                                              : 0.0;
      lanes_->push(static_cast<float>((left + right) * .5));
      if (beat_) {
        const auto before = beat_->ticks();
        while (analysed_ != lanes_->analysisSamples()) {
          const float sample = lanes_->sampleAt(analysed_++);
          // The engine's bounded denormal protection represents digital silence at the tap.
          constexpr double silence = dsp::NyquistDenormalNoise::kMaximumOutputNoiseAmplitude;
          const float beatSample = sample >= -silence && sample <= silence ? 0.0f : sample;
          beat_->sample(beatSample, static_cast<double>(input_ + frames - i) / hostRate_);
        }
        if (beat_->ticks() != before) {
          dirty_ = true;
          if (beat_->cold())
            queues_->clock.reset();
          releaseLanes(false);
        }
      }
      // Analysis reads the original stereo signal before the optional click is mixed.
      if (clickOn_ && queues_->clicks.count != 0u && queues_->clicks.front() <= input_) {
        queues_->clicks.pop();
        clickAge_ = 0u;
        clickY1_ = 0.0;
        clickY2_ = clickStart_;
      }
      if (clickAge_ < clickLength_) {
        const double y = clickA_ * clickY1_ - clickB_ * clickY2_;
        clickY2_ = clickY1_;
        clickY1_ = y;
        const double gain =
            clickAge_ < clickAttack_ ? static_cast<double>(clickAge_) / clickAttack_ : 1.0;
        ++clickAge_;
        const float click = static_cast<float>(gain * y);
        audio[i] += click;
        if (channels > 1u)
          audio[frames + i] += click;
      }
      ++input_;
    }
    time_ = info.timeSeconds + static_cast<double>(frames) / hostRate_;
  }
  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!ready_ || !dirty_)
      return;
    std::array<std::uint8_t, kPayloadBytes> payload{};
    auto *p = payload.data();
    const double publicRate = analysisRate_ != 0u ? analysisRate_ : hostRate_;
    binary_io::writeF32(p, static_cast<float>(publicRate));
    binary_io::writeU32(p + 4u, generation_);
    binary_io::writeU32(
        p + 8u, static_cast<std::uint32_t>(std::nearbyint(publicRate * rhythm_a3::kBeatDt)));
    binary_io::writeU32(p + 12u, beat_ ? static_cast<std::uint32_t>(beat_->ticks()) : 0u);
    binary_io::writeF32(p + 16u, static_cast<float>(time_));
    binary_io::writeF32(p + 20u, beat_ ? static_cast<float>(beat_->latency()) : 0.0f);
    binary_io::writeU32(p + 24u, dropped_);
    const auto count = queues_->events.count < kMaxEvents ? queues_->events.count : kMaxEvents;
    binary_io::writeU32(p + 28u, count);
    if (beat_) {
      const auto &anchor = beat_->anchor();
      binary_io::writeU32(p + 32u, beat_->shown() ? 1u : 0u);
      binary_io::writeU32(p + 36u, anchor.epoch);
      binary_io::writeF32(p + 40u, static_cast<float>(beat_->confidence()));
      if (!beat_->silent() && anchor.period > 0.0 && anchor.time >= 0.0) {
        binary_io::writeF32(p + 44u, static_cast<float>(anchor.period));
        writeTime(p + 48u, anchor.time);
        binary_io::writeU32(p + 56u, static_cast<std::uint32_t>(anchor.index));
      }
      float column[192], bpm = 0.0f;
      beat_->tempogram(column, bpm);
      binary_io::writeF32(p + 60u, bpm);
      for (std::uint32_t i = 0u; i < 192u; ++i)
        binary_io::writeF32(p + 64u + 4u * i, column[i]);
      const auto preview = beat_->preview();
      binary_io::writeU32(p + 1344u, preview.count);
      binary_io::writeF32(p + 1348u, static_cast<float>(preview.period));
      for (std::uint32_t i = 0u; i < preview.count; ++i) {
        auto *slot = p + 1352u + 12u * i;
        writeTime(slot, preview.beats[i].time);
        binary_io::writeU32(slot + 8u, static_cast<std::uint32_t>(preview.beats[i].index));
      }
    }
    // All forward beats and committed beats share the bounded event transport.
    for (std::uint32_t i = 0u; i < count; ++i) {
      const auto &event = queues_->events.data[(queues_->events.read + i) % kEventCapacity];
      auto *slot = p + 832u + 32u * i;
      writeTime(slot, event.time);
      binary_io::writeU32(slot + 8u, event.epoch);
      binary_io::writeU32(slot + 12u, static_cast<std::uint32_t>(event.index));
      binary_io::writeF32(slot + 16u, event.fraction);
      binary_io::writeF32(slot + 20u, event.period);
      binary_io::writeF32(slot + 24u, event.strength);
      slot[28] = event.band;
      slot[29] = event.flags;
    }
    if (!writer.write(28u, 4u, p, kPayloadBytes))
      return;
    for (std::uint32_t i = 0u; i < count; ++i)
      queues_->events.pop();
    dropped_ = 0u;
    dirty_ = queues_->events.count != 0u;
  }
  void warmUp() {
    constexpr std::uint32_t frames = 128u;
    std::array<float, frames * 2u> audio{};
    for (std::uint32_t block = 0u; block < 16u; ++block) {
      for (std::uint32_t i = 0u; i < frames; ++i)
        audio[i] = audio[frames + i] =
            static_cast<float>(.1 * rhythm_d::portableSin((block * frames + i) * .1));
      process(audio.data(), 2u, frames, {static_cast<double>(block * frames) / hostRate_});
    }
    reset();
  }
#if defined(ET_RHYTHM_EVALUATION)
  void observe(const rhythm_a3::Rd6Engine::Sink &sink) noexcept { observer_ = sink; }
  void flush() noexcept {
    if (beat_)
      beat_->flush();
  }
#endif

private:
  struct Queues {
    Queue<Event, kEventCapacity> events;
    Queue<Event, kEventCapacity> lanes;
    Queue<std::uint64_t, 32u> clicks;
    rhythm_a3::ProvisionalClock clock;
  };
  static void writeTime(std::uint8_t *p, double time) noexcept {
    const double position = time / rhythm_a3::kBeatDt, whole = std::floor(position);
    binary_io::writeU32(p, static_cast<std::uint32_t>(static_cast<std::int64_t>(whole)));
    binary_io::writeF32(p + 4u, fraction(position - whole));
  }
  void synchronize() noexcept {
    if (!sync_ && !paramsDirty())
      return;
    sync_ = false;
    const bool click = params_.metronomeClick > .5f;
    if (!click && clickOn_)
      clearClick();
    clickOn_ = click;
    double minimum = bounded(params_.minimumBpm, 40.0, 192.0, 40.0);
    double maximum = bounded(params_.maximumBpm, 50.0, 240.0, 240.0);
    if (maximum < minimum * 1.25)
      maximum = minimum * 1.25;
    if (minimum_ != minimum || maximum_ != maximum) {
      releaseLanes(true);
      minimum_ = minimum;
      maximum_ = maximum;
      if (beat_)
        beat_->setRange(minimum, maximum);
      if (queues_)
        queues_->clock.reset();
      clearClick();
      dirty_ = true;
    }
  }
  void clearClick() noexcept {
    if (queues_)
      queues_->clicks.clear();
    clickAge_ = clickLength_;
    clickY1_ = clickY2_ = 0.0;
  }
  void enqueue(const Event &event) noexcept {
    if (!queues_->events.push(event))
      ++dropped_;
    dirty_ = true;
  }
  static void laneEvent(void *context, double time, float strength, std::uint32_t band) noexcept {
    auto &self = *static_cast<RhythmAnalyzerKernel *>(context);
    if (time < 0.0 || self.queues_ == nullptr)
      return;
    Event event;
    event.time = time;
    event.strength = strength;
    event.band = static_cast<std::uint8_t>(band);
    if (self.beat_) {
      rhythm_a3::AnalysisAnchor anchor;
      double position = 0.0, period = 0.0;
      if (self.beat_->annotate(time, anchor, position)) {
        event.epoch = anchor.epoch;
        event.index = static_cast<std::int32_t>(anchor.index);
        event.fraction = fraction(position);
        event.period = static_cast<float>(anchor.period);
        event.flags = CommittedLane;
        self.enqueue(event);
        return;
      }
      if (self.queues_->clock.annotate(time, position, period)) {
        const double whole = std::floor(position);
        event.epoch = self.beat_->anchor().epoch;
        event.index = static_cast<std::int32_t>(whole);
        event.fraction = fraction(position - whole);
        event.period = static_cast<float>(period);
        event.flags = ProvisionalLane;
      }
    }
    self.enqueue(event);
    // Keep the original timestamp and band for the later committed replacement.
    event.epoch = 0u;
    event.index = 0;
    event.fraction = event.period = 0.0f;
    event.flags = InvalidLane;
    if (!self.queues_->lanes.push(event))
      ++self.dropped_;
  }
  void releaseLanes(bool invalidate) noexcept {
    if (!queues_)
      return;
    invalidate = invalidate || (beat_ && beat_->cold());
    while (queues_->lanes.count != 0u) {
      auto event = queues_->lanes.front();
      if (!invalidate && beat_ && event.time > beat_->anchor().time)
        break;
      rhythm_a3::AnalysisAnchor anchor;
      double position = 0.0;
      if (!invalidate && beat_ && beat_->annotate(event.time, anchor, position)) {
        event.epoch = anchor.epoch;
        event.index = static_cast<std::int32_t>(anchor.index);
        event.fraction = fraction(position);
        event.period = static_cast<float>(anchor.period);
        event.flags = CommittedLane;
      }
      enqueue(event);
      queues_->lanes.pop();
    }
  }
  static void hardSilence(void *context) noexcept {
    auto &self = *static_cast<RhythmAnalyzerKernel *>(context);
    self.clearClick();
  }
  static void beatEvent(void *context, const rhythm_a3::BeatEvent &beat) noexcept {
    auto &self = *static_cast<RhythmAnalyzerKernel *>(context);
#if defined(ET_RHYTHM_EVALUATION)
    if (self.observer_.forward)
      self.observer_.forward(self.observer_.context, beat);
#endif
    if (beat.time < 0.0)
      return;
    self.queues_->clock.forward(beat);
    Event event;
    event.time = beat.time;
    event.strength = beat.confidence;
    event.period = static_cast<float>(beat.period);
    event.epoch = beat.epoch;
    event.index = static_cast<std::int32_t>(beat.index);
    event.flags = beat.shown ? ShownForward : HiddenForward;
    self.enqueue(event);
    if (beat.shown && self.clickOn_) {
      // A past event starts at the next available sample; no extra lead or FIR correction.
      const auto target = static_cast<std::uint64_t>(std::ceil(beat.time * self.hostRate_));
      if (!self.queues_->clicks.push(target > self.input_ ? target : self.input_))
        ++self.dropped_;
    }
  }
  static void analysisEvent(void *context, const rhythm_a3::BeatEvent &beat) noexcept {
    auto &self = *static_cast<RhythmAnalyzerKernel *>(context);
#if defined(ET_RHYTHM_EVALUATION)
    if (self.observer_.analysis)
      self.observer_.analysis(self.observer_.context, beat);
#endif
    self.queues_->clock.commit(beat);
    Event event;
    event.time = beat.time;
    event.strength = beat.confidence;
    event.period = static_cast<float>(beat.period);
    event.epoch = beat.epoch;
    event.index = static_cast<std::int32_t>(beat.index);
    event.flags = CommittedBeat;
    self.enqueue(event);
  }
#if defined(ET_RHYTHM_EVALUATION)
  rhythm_a3::Rd6Engine::Sink observer_;
#endif
  std::unique_ptr<rhythm_d::Detector> lanes_;
  std::unique_ptr<rhythm_a3::Rd6Engine> beat_;
  std::unique_ptr<Queues> queues_;
  double hostRate_ = 48000.0, minimum_ = 0.0, maximum_ = 0.0, time_ = 0.0;
  double clickA_ = 0.0, clickB_ = 0.0, clickStart_ = 0.0, clickY1_ = 0.0, clickY2_ = 0.0;
  std::uint64_t input_ = 0u;
  std::uint32_t analysisRate_ = 0u, analysed_ = 0u, generation_ = 0u, channels_ = 0u, dropped_ = 0u;
  std::uint32_t clickAttack_ = 1u, clickLength_ = 0u, clickAge_ = 0u;
  bool ready_ = false, sync_ = true, dirty_ = false, clickOn_ = false;
};
static_assert(sizeof(RhythmAnalyzerKernel) <= 8192u);
#if defined(ET_RHYTHM_EVALUATION)
void observeRhythm(PluginKernel &kernel, const rhythm_a3::Rd6Engine::Sink &sink) noexcept {
  static_cast<RhythmAnalyzerKernel &>(kernel).observe(sink);
}
void flushRhythm(PluginKernel &kernel) noexcept {
  static_cast<RhythmAnalyzerKernel &>(kernel).flush();
}
#endif
} // namespace effetune::plugins::analyzer
EFFETUNE_REGISTER_KERNEL(RhythmAnalyzerPlugin, effetune::plugins::analyzer::RhythmAnalyzerKernel)

#if defined(__EMSCRIPTEN__)
extern "C" int et_rhythm_analyzer_warm_up(float sampleRate) {
  auto kernel = std::make_unique<effetune::plugins::analyzer::RhythmAnalyzerKernel>();
  kernel->prepare({sampleRate, 2u, 128u});
  if (!kernel->preparedSuccessfully())
    return 1;
  kernel->warmUp();
  return 0;
}
#endif

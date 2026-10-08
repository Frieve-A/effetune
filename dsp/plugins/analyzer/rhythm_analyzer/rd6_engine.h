// The production beat path, including rate conversion and actual event availability.
#pragma once
#include "rd6_decoder.h"
#include "tc_frontend.h"
#include <array>
#include <cstdint>

namespace effetune::plugins::analyzer::rhythm_a3 {
struct BeatEvent {
  double time = 0.0, emitted = 0.0, period = 0.0;
  std::uint32_t epoch = 0u;
  std::int64_t index = 0, tick = 0;
  float confidence = 0.0f;
  bool shown = false;
};
struct AnalysisAnchor {
  double time = 0.0, period = 0.0;
  std::uint32_t epoch = 0u;
  std::int64_t index = 0;
};
class Rd6Engine {
public:
  struct Preview {
    std::array<AnalysisAnchor, 12u> beats{};
    std::uint32_t count = 0u;
    double period = 0.0;
  };
  struct Sink {
    void *context = nullptr;
    void (*forward)(void *, const BeatEvent &) = nullptr;
    void (*analysis)(void *, const BeatEvent &) = nullptr;
    void (*tick)(void *, std::uint64_t, const float *, const float *, const Rd6Decoder &) = nullptr;
    void (*silence)(void *) = nullptr;
  } sink;
  void prepare(std::uint32_t analysisRate, double hostRate) noexcept {
    decimator_.prepare(analysisRate);
    frontend_.prepare();
    delay_ = decimator_.delay() + rhythm_d::RateRule::delaySeconds(hostRate);
    decoder_.sink = {this, &Rd6Engine::forwardEvent, &Rd6Engine::analysisEvent};
    decoder_.prepare(minimum_, maximum_);
    reset();
  }
  void reset() noexcept {
    decimator_.reset();
    frontend_.reset();
    network_.reset();
    decoder_.reset();
    ticks_ = 0u;
    base_ = 0;
    fill_ = quiet_ = 0u;
    silent_ = cold_ = false;
    allZero_ = true;
    advanceEpoch();
  }
  void setRange(double minimum, double maximum) noexcept {
    if (minimum_ == minimum && maximum_ == maximum)
      return;
    minimum_ = minimum;
    maximum_ = maximum;
    decoder_.prepare(minimum, maximum);
    base_ = static_cast<std::int64_t>(ticks_);
    advanceEpoch();
  }
  void sample(float value, double availability) noexcept {
    availability_ = availability;
    decimator_.push(value, [this](float x) {
      frontend_.push(x);
      allZero_ = allZero_ && x == 0.0f;
      if (++fill_ != 256u)
        return;
      fill_ = 0u;
      const bool quiet = allZero_;
      quiet_ = quiet ? quiet_ + 1u : 0u;
      if (allZero_ && !silent_) {
        if (sink.silence != nullptr)
          sink.silence(sink.context);
      }
      silent_ = allZero_;
      allZero_ = true;
      if (cold_ && !quiet) {
        cold_ = false;
        base_ = static_cast<std::int64_t>(ticks_);
      }
      if (!cold_) {
        const float *features = frontend_.features();
        network_.push(features, outputs_.data());
        decoder_.push(outputs_[0], outputs_.data() + 2u, silent_);
        if (sink.tick != nullptr)
          sink.tick(sink.context, ticks_, features, outputs_.data(), decoder_);
      }
      // Short digital gaps close presentation only. The existing one-second cold boundary
      // clears both decoders together; quiet nonzero audio is handled only by the evidence gate.
      if (quiet_ == 94u) {
        decoder_.reset();
        frontend_.reset();
        network_.reset();
        cold_ = true;
        base_ = static_cast<std::int64_t>(ticks_ + 1u);
        advanceEpoch();
      }
      ++ticks_;
    });
  }
  void flush() noexcept {
    if (!cold_)
      decoder_.flush();
  }
  bool silent() const noexcept { return silent_ || cold_; }
  bool cold() const noexcept { return cold_; }
  bool shown() const noexcept { return !silent() && decoder_.shown(); }
  double confidence() const noexcept { return silent() ? 0.0 : decoder_.confidence(); }
  double latency() const noexcept { return kBeatLatency + delay_; }
  std::uint64_t ticks() const noexcept { return ticks_; }
  double committedTime() const noexcept {
    return kBeatT0 + static_cast<double>(base_ + decoder_.committed() - 1) * kBeatDt;
  }
  const AnalysisAnchor &anchor() const noexcept { return anchor_; }
  Preview preview() const noexcept {
    Preview result;
    if (silent())
      return result;
    const auto path = decoder_.preview();
    result.period = path.period * kBeatDt;
    if (historyCount_ != 0u)
      result.beats[result.count++] = anchor_;
    auto index = historyCount_ != 0u ? anchor_.index + 1 : 0;
    for (std::uint32_t i = 0u; i < path.count; ++i) {
      const double time = kBeatT0 + (static_cast<double>(base_) + path.beats[i].tick) * kBeatDt;
      if (historyCount_ != 0u && time <= anchor_.time)
        continue;
      result.beats[result.count++] = {time, path.beats[i].period * kBeatDt, analysisEpoch_,
                                      index++};
    }
    return result;
  }
  void tempogram(float *out, float &bpm) const noexcept {
    if (silent()) {
      std::fill_n(out, 192u, 0.0f);
      bpm = 0.0f;
    } else
      decoder_.tempogram(out, bpm);
  }
  // Only bracket onsets within immutable committed history; no extrapolation.
  bool annotate(double time, AnalysisAnchor &left, double &fraction) const noexcept {
    for (std::uint32_t i = 1u; i < historyCount_; ++i) {
      const auto &a = history_[(historyRead_ + i - 1u) % kHistory];
      const auto &b = history_[(historyRead_ + i) % kHistory];
      if (a.epoch == b.epoch && time >= a.time && time <= b.time && b.time > a.time) {
        left = a;
        left.period = b.time - a.time;
        fraction = (time - a.time) / left.period;
        return true;
      }
    }
    return false;
  }

private:
  static constexpr std::uint32_t kHistory = 32u;
  void advanceEpoch() noexcept {
    ++eventEpoch_;
    ++analysisEpoch_;
    eventIndex_ = analysisIndex_ = 0;
    anchor_ = {};
    anchor_.epoch = analysisEpoch_;
    historyCount_ = historyRead_ = 0u;
  }
  BeatEvent convert(const Rd6Event &event) const noexcept {
    return {kBeatT0 + (static_cast<double>(base_) + event.tick) * kBeatDt,
            availability_,
            event.period * kBeatDt,
            0u,
            0,
            base_ + event.decision,
            static_cast<float>(decoder_.confidence()),
            event.shown};
  }
  static void forwardEvent(void *self, const Rd6Event &event) noexcept {
    auto &engine = *static_cast<Rd6Engine *>(self);
    auto value = engine.convert(event);
    value.epoch = engine.eventEpoch_;
    value.index = engine.eventIndex_++;
    if (engine.sink.forward != nullptr)
      engine.sink.forward(engine.sink.context, value);
  }
  static void analysisEvent(void *self, const Rd6Event &event) noexcept {
    auto &engine = *static_cast<Rd6Engine *>(self);
    auto value = engine.convert(event);
    value.period = 0.0;
    if (engine.historyCount_ != 0u) {
      const double interval = value.time - engine.anchor_.time, previous = engine.anchor_.period;
      // A phase or metrical-level jump starts a new coordinate epoch.
      if (interval <= 0.0 ||
          (previous > 0.0 && (interval < previous * .75 || interval > previous * 1.25))) {
        ++engine.analysisEpoch_;
        engine.analysisIndex_ = 0;
      } else if (interval > 0.0)
        value.period = interval;
    }
    value.epoch = engine.analysisEpoch_;
    value.index = engine.analysisIndex_++;
    engine.anchor_ = {value.time, value.period, value.epoch, value.index};
    if (engine.historyCount_ == kHistory) {
      engine.historyRead_ = (engine.historyRead_ + 1u) % kHistory;
      --engine.historyCount_;
    }
    engine.history_[(engine.historyRead_ + engine.historyCount_++) % kHistory] = engine.anchor_;
    if (engine.sink.analysis != nullptr)
      engine.sink.analysis(engine.sink.context, value);
  }
  BeatDecimator decimator_;
  TcFrontEnd frontend_;
  TcTcn network_;
  Rd6Decoder decoder_;
  std::array<float, 63> outputs_{};
  std::array<AnalysisAnchor, kHistory> history_{};
  AnalysisAnchor anchor_;
  std::uint64_t ticks_ = 0u;
  std::int64_t base_ = 0, eventIndex_ = 0, analysisIndex_ = 0;
  std::uint32_t fill_ = 0u, quiet_ = 0u, eventEpoch_ = 0u, analysisEpoch_ = 0u;
  std::uint32_t historyCount_ = 0u, historyRead_ = 0u;
  double delay_ = 0.0, availability_ = 0.0, minimum_ = 40.0, maximum_ = 240.0;
  bool silent_ = false, cold_ = false, allZero_ = true;
};
} // namespace effetune::plugins::analyzer::rhythm_a3

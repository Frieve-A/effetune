// A3 beat clock: the front end and the TCN (TcFrontEnd), the 2 Hz G2 update and hooks (G2Engine)
// and the decoder (DecDecoder), wired at their real delays. The kernel feeds the analysis stream
// (sample), the hop and frame hooks (fe) and calls quantum() once per render quantum.
#pragma once
#include <cstdint>

#include "dec_decoder.h"
#include "decaying_max.h"
#include "g2_engine.h"
#include "tc_frontend.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class A3Clock {
public:
  // Development observers (equivalence driver); null in the plugin.
  struct Probe {
    void *context = nullptr;
    void (*frame)(void *, const TcFrame &) = nullptr;
    void (*event)(void *, const TcEvent &) = nullptr;
    void (*feTick)(void *, const TcTick &) = nullptr;
    void (*g2)(void *, std::int64_t update, std::int64_t tick) = nullptr;
    void (*tick)(void *, std::int64_t tick, const dec::DecTickOut &) = nullptr;
    void (*service)(void *) = nullptr;
  };
  Probe probe;
  TcFrontEnd fe;

  // analysisRate: 48, 96 or 192 kHz; deviceRate: the host rate (sets the quanta per decoder tick).
  bool prepare(double analysisRate, double deviceRate) noexcept {
    if (!fe.prepare(analysisRate) || !g2_.prepare(static_cast<int>(analysisRate)))
      return false;
    fe.setChroma(&g2_.chroma());
    tickDevice_ = 4.0 * fe.rate().hop * deviceRate / analysisRate;
    return reset();
  }

  // Tempo range (BPM) of the next reset().
  void setRange(double minBpm, double maxBpm) noexcept {
    minBpm_ = minBpm;
    maxBpm_ = maxBpm;
  }

  bool reset() noexcept {
    fe.reset();
    g2_.reset();
    quiet_.reset();
    setup_ = {};
    setup_.t0a = tc::kG1T0;
    setup_.lata = tc::kG1Latency;
    setup_.t0_fe = fe.rate().gridT0;
    setup_.lat_fe = fe.rate().gridLatency;
    for (int c = 0; c < 3; ++c) {
      setup_.prior[c] = tc::kTcnPrior[c];
      setup_.g2Prior[c] = g2_tables::kPrior[c];
    }
    setup_.W = g2_tables::kW;
    setup_.actEnd = -1;
    setup_.bankStepsPerQuantum = kBankSteps;
    setup_.minBpm = minBpm_;
    setup_.maxBpm = maxBpm_;
    samples_ = 0u;
    ticksIn_ = nextTick_ = actNext_ = g2Next_ = midTick_ = 0;
    eventHead_ = eventCount_ = 0u;
    midPending_ = false;
    dropped_ = 0u;
    return dec_.reset(setup_);
  }

  void sample(float x) noexcept {
    g2_.pushSamples(&x, 1u);
    ++samples_;
  }

  // After the quantum's samples: moves the front end's output into G2 and the decoder queues, runs
  // G2's staged update and the decoder's share of this quantum (the tick split over two quanta when
  // a tick spans at least two).
  void quantum(std::uint32_t frames) noexcept {
    TcFrame frame;
    while (fe.popFrame(frame))
      if (probe.frame != nullptr)
        probe.frame(probe.context, frame);
    TcTick t;
    while (fe.popTick(t)) {
      if (probe.feTick != nullptr)
        probe.feTick(probe.context, t);
      float flux[3][4];
      for (int b = 0; b < 3; ++b)
        for (int q = 0; q < 4; ++q)
          flux[b][q] = t.v0.flux[q][b];
      if (t.v0.restart) {
        g2_.restart(t.v0.k, samples_);
        quiet_.reset();
      }
      const bool quiet = quiet_.push(t.v0.rmsDb);
      g2_.pushTick(flux, t.v0.bandDb, t.v0.rmsDb, t.v0.lvl, quiet);
      if (ticksIn_ - (actNext_ < nextTick_ ? actNext_ : nextTick_) >= kTickRing) {
        ++dropped_;
        continue;
      }
      TickRow &row = ticks_[ticksIn_ & (kTickRing - 1)];
      for (int c = 0; c < 3; ++c)
        row.act[c] = t.act[c];
      row.quiet = quiet;
      row.fire = t.v0.fire;
      row.priorRestart = t.priorRestart;
      ++ticksIn_;
    }
    TcPriorRow prior;
    while (fe.popPriorRow(prior))
      dec_.pushPrior(prior.base, prior.s, prior.grid);
    TcEvent e;
    while (fe.popEvent(e)) {
      if (probe.event != nullptr)
        probe.event(probe.context, e);
      g2_.pushEvent(e.t, e.band, e.strength);
      if (eventCount_ == kEventRing) {
        ++dropped_;
        continue;
      }
      events_[(eventHead_ + eventCount_) & (kEventRing - 1u)] = e;
      ++eventCount_;
    }
    g2_.process(samples_);

    const bool split = tickDevice_ >= 2.0 * frames;
    bool worked = false;
    if (midPending_) {
      finishTick(dec_.tickMid(), midTick_);
      midPending_ = false;
      worked = true;
    }
    while (nextTick_ < ticksIn_ && !(split && worked)) {
      const std::int64_t n = nextTick_++;
      if (split && n > 0)
        service();
      pushInputs(n);
      const TickRow &row = ticks_[n & (kTickRing - 1)];
      if (row.priorRestart)
        dec_.restartPrior();
      if (split) {
        dec_.tickFront(row.quiet, row.fire);
        midPending_ = true;
        midTick_ = n;
      } else {
        finishTick(dec_.tickBegin(row.quiet, row.fire), n);
      }
      worked = true;
    }
    if (!worked)
      service();
  }

  [[nodiscard]] dec::DecClockView view() const noexcept { return dec_.clockView(); }
  void setBeatSink(dec::DecDecoder::BeatSink sink) noexcept { dec_.beatSink = sink; }
  void setMasterProbe(dec::DecDecoder::MasterProbe sink) noexcept { dec_.masterProbe = sink; }
  [[nodiscard]] const dec::DecDecoder &decoder() const noexcept { return dec_; }
  [[nodiscard]] const G2Engine &g2() const noexcept { return g2_; }
  // Ticks or events refused by a full queue (0 in normal operation).
  [[nodiscard]] std::uint32_t dropped() const noexcept { return dropped_ + fe.dropped(); }

private:
  static constexpr std::int32_t kBankSteps = 8;
  double minBpm_ = 40.0;
  double maxBpm_ = 240.0;
  static constexpr std::int64_t kTickRing = 64;
  static constexpr std::uint32_t kEventRing = 64u;
  struct TickRow {
    float act[3];
    bool quiet;        // RelativeQuiet bit of the tick (stand-in Z input)
    bool fire;         // cold reset of the decoder at this tick
    bool priorRestart; // the TD prior's rows start afresh at this tick
  };
  static_assert(TdpTrees::kGrid == static_cast<std::uint32_t>(dec::kTdGrid));

  // Inputs available at decoder tick n: activation rows, events by availability and every published
  // G2 update.
  void pushInputs(std::int64_t n) noexcept {
    const dec::DecSetup &s = setup_;
    const double t = (s.t0_fe + static_cast<double>(n) * dec::kDt) + s.lat_fe;
    while (actNext_ < ticksIn_ &&
           (s.t0a + static_cast<double>(actNext_) * dec::kDt) + s.lata <= t + dec::kEpsT &&
           dec_.pushActivation(ticks_[actNext_ & (kTickRing - 1)].act))
      ++actNext_;
    while (eventCount_ > 0u && events_[eventHead_].avail <= t + dec::kEpsT) {
      const TcEvent &e = events_[eventHead_];
      static_cast<void>(dec_.pushEvent(e.t, e.band, e.avail));
      eventHead_ = (eventHead_ + 1u) & (kEventRing - 1u);
      --eventCount_;
    }
    for (const std::int64_t available = g2_.updatesAvailable(); g2Next_ < available; ++g2Next_) {
      static_cast<void>(dec_.pushG2(g2_.update(g2Next_)));
      if (probe.g2 != nullptr)
        probe.g2(probe.context, g2Next_, n);
    }
  }

  void finishTick(const dec::DecHookRequest &request, std::int64_t n) noexcept {
    if (request.valid)
      static_cast<void>(
          dec_.pushHookResult(request.call, g2_.boundary(request.t, request.committed)));
    dec_.tickEnd();
    if (probe.tick != nullptr)
      probe.tick(probe.context, n, dec_.out());
  }

  // Bank catch-up share of a quantum (the probe records the schedule for the delayed reference
  // rerun).
  void service() noexcept {
    dec_.service();
    if (probe.service != nullptr)
      probe.service(probe.context);
  }

  G2Engine g2_;
  RelativeQuiet quiet_; // the one quiet state behind fe_silent and stand-in Z
  dec::DecDecoder dec_;
  dec::DecSetup setup_{};
  TickRow ticks_[kTickRing] = {};
  TcEvent events_[kEventRing] = {};
  double tickDevice_ = 0.0;
  std::uint64_t samples_ = 0u;
  std::int64_t ticksIn_ = 0, nextTick_ = 0, actNext_ = 0, g2Next_ = 0, midTick_ = 0;
  std::uint32_t eventHead_ = 0u, eventCount_ = 0u, dropped_ = 0u;
  bool midPending_ = false;
};

} // namespace effetune::plugins::analyzer::rhythm_a3

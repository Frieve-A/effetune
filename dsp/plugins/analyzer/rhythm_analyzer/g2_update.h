// The 2 Hz G2 update as a staged, allocation-free job: the window features (W = 8 s, character
// features left NaN; the model never uses them) + CatBoost margins on the embedded heap-tree model
// + softmax + per-class np.interp calibration. Update u has t = .5(u+1) and needs tick k1 = floor(t
// * 93.75 + 1e-9) pushed (the max filter of the flux looks one tick ahead), so it starts in the
// process() call after which the stream holds k1 + 1 ticks and publishes kSlots - 1 calls later.
#pragma once
#include <cmath>
#include <cstdint>
#include <limits>

#include "effetune/dsp/stage_scheduler.h"
#include "g2_level.generated.h"
#include "g2_math.h"
#include "g2_numpy.h"
#include "g2_stream.h"
#include "g2_tables.generated.h"
#include "heap_tree_model.h"
#include "portable_math.h"
#include "rhythm_d.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

struct G2Update {
  static constexpr int kMaxCandidates = 28;
  double t = 0.0;
  std::int32_t count = 0;            // 0: no candidate (Python None)
  float period[kMaxCandidates] = {}; // seconds (the evidence stores float32)
  double ref[kMaxCandidates] = {};   // beat reference time, seconds
  float p[kMaxCandidates][3] = {};   // calibrated P(on-beat), P(off-beat), P(not a beat level)
};

// Development hooks (timing and feature dumps); null in production.
struct G2Probe {
  void *ctx = nullptr;
  void (*stage)(void *ctx, const effetune::dsp::SchedulerStage &stage, bool after) = nullptr;
  void (*published)(void *ctx, std::int64_t update) = nullptr;
};

struct G2UpdaterStats {
  std::int64_t maxBandEvents = 0;  // most window events of one band
  std::int64_t eventOverflow = 0;  // window events dropped (band capacity)
  std::int64_t eventRingReach = 0; // windows whose first event may have left the event ring
  std::int64_t maxKeptFrames = 0;
  std::int64_t frameOverflow = 0;
  std::int64_t lateChroma = 0; // streaming windows that needed a chroma frame not yet pushed
  std::int64_t maxHarmK = 0;
  std::int64_t harmOverflow = 0;
  std::int64_t maxPeaks = 0;
};

class G2Updater {
public:
  static constexpr int kC = G2Update::kMaxCandidates;
  static constexpr int kNF = 95;
  static constexpr int kClasses = 3; // g2_level outputs: on-beat, off-beat, not a beat level
  static constexpr int kMaxN = 750;  // round(W * FPS)
  static constexpr int kMaxM = 1024; // nfft / 2 for nfft = 2048
  static constexpr int kMaxL = kMaxN / 2 + 1;
  static constexpr int kMaxBandEvents = 1024;
  static constexpr int kMaxFrames = 128; // kept chroma frames (<= 94 in an 8 s window)
  static constexpr int kMaxHarm = 48;    // change intervals (<= 32 for per >= .25 s)
  static constexpr int kMaxPeaks = 192;
  static constexpr int kResultRing = 16;
  static constexpr std::uint32_t kSlotSamples = 128u;
  static constexpr int kTreeChunk = 128;
  // Fixed slot count (the delay: kSlots - 1 quanta after the look-ahead tick). 24 keeps every warm
  // quantum of the worst job (~780 us WASM in total) under 100 us WASM with the chroma frame
  // included; trailing empty slots are dropped.
  static constexpr std::uint32_t kSlots = 24u;

  enum Kind : std::uint8_t {
    kGather,
    kFftFwd,
    kFftInv,
    kComb,
    kWindow,
    kRef,
    kFold,
    kTrees,
    kPublish
  };

  void prepare() noexcept {
    schedule_.clear();
    schedule_.addStage(kGather, 0, 0, 0, kWeight[kGather]);
    for (std::uint32_t b = 0; b < 3; ++b) {
      schedule_.addStage(kFftFwd, b, 0, 0, kWeight[kFftFwd]);
      schedule_.addStage(kFftInv, b, 0, 0, kWeight[kFftInv]);
    }
    schedule_.addStage(kComb, 0, 0, 0, kWeight[kComb]);
    schedule_.addStage(kWindow, 0, 0, 0, kWeight[kWindow]);
    for (std::uint32_t c = 0; c < kC; ++c)
      schedule_.addStage(kRef, 0, c, c + 1, kWeight[kRef]);
    for (std::uint32_t c = 0; c < kC; ++c)
      schedule_.addStage(kFold, 0, c, c + 1, kWeight[kFold]);
    const std::uint32_t trees = g2_level::model().tree_count;
    for (std::uint32_t g = 0; g < kC / 4; ++g)
      for (std::uint32_t first = 0; first < trees; first += kTreeChunk) {
        const std::uint32_t end = first + kTreeChunk < trees ? first + kTreeChunk : trees;
        schedule_.addStage(kTrees, g, first, end, kWeight[kTrees] * (end - first) / kTreeChunk);
      }
    schedule_.addStage(kPublish, 0, 0, 0, kWeight[kPublish]);
    scheduleOk_ = schedule_.partition(kSlots);
    slots_ = 0;
    for (std::uint32_t s = 0; s < kSlots; ++s)
      if (schedule_.slotEnd(s) > schedule_.slotBegin(s))
        slots_ = s + 1;
    reset();
  }

  void reset() noexcept {
    nextU_ = 0;
    published_ = 0;
    active_ = false;
    slot_ = 0;
    stats_ = {};
    for (G2Update &r : results_)
      r = G2Update{};
  }

  void setProbe(const G2Probe &probe) noexcept { probe_ = probe; }

  // Call once per quantum after the quantum's ticks, events and chroma frames were pushed;
  // absoluteSamples counts the samples up to the end of this quantum.
  void process(const G2Stream &s, std::uint64_t absoluteSamples) noexcept {
    stream_ = &s;
    while (s.ticks() > dueTick(nextU_)) {
      if (active_)
        complete();
      start(nextU_++, false, absoluteSamples);
    }
    advance(absoluteSamples);
  }

  // End of the track (dur = samples / rate): completes the running job, then runs the remaining
  // updates t_u < dur + 1e-9 (np.arange(.5, dur + 1e-9, .5)) synchronously with the end edge.
  void finish(const G2Stream &s, double dur) noexcept {
    stream_ = &s;
    if (active_)
      complete();
    const double span = ((dur + 1e-9) - .5) / .5;
    const std::int64_t count = span > 0.0 ? static_cast<std::int64_t>(std::ceil(span)) : 0;
    while (nextU_ < count) {
      start(nextU_++, true, 0);
      complete();
    }
  }

  [[nodiscard]] std::int64_t updatesAvailable() const noexcept { return published_; }
  // Valid for updatesAvailable() - kResultRing <= u < updatesAvailable().
  [[nodiscard]] const G2Update &update(std::int64_t u) const noexcept {
    return results_[u % kResultRing];
  }
  // Feature row c of the most recent job (development checks).
  [[nodiscard]] const float *features(int c) const noexcept { return x_[c]; }
  [[nodiscard]] const G2UpdaterStats &stats() const noexcept { return stats_; }
  [[nodiscard]] std::uint32_t slotCount() const noexcept { return slots_; }
  [[nodiscard]] bool scheduleValid() const noexcept { return scheduleOk_; }
  [[nodiscard]] const effetune::dsp::StageSchedule<128, 64> &schedule() const noexcept {
    return schedule_;
  }

private:
  // Worst-case (non-empty stage) WASM cost in 0.1 us, measured.
  static constexpr std::uint32_t kWeight[9] = {60, 115, 105, 40, 230, 77, 69, 61, 110};
  static constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();
  static constexpr float kNaNf = std::numeric_limits<float>::quiet_NaN();

  // Feature columns (models/g2.json order).
  enum Col : int {
    cFill = 0,
    cValid = 1,
    cLbpm = 2,
    cLrel = 3,
    cModeRank = 4,
    cModeLbpm = 5,
    cModeH = 6,
    cAcfC = 7,
    cAcfRank = 16,
    cAcfGap = 17,
    cFold = 18,
    cAltL = 36,
    cAltM = 37,
    cEv = 38,
    cBs = 50,
    cTflat = 60,
    cAcfB = 63,
    cHc = 78
  };

  [[nodiscard]] static std::int64_t dueTick(std::int64_t u) noexcept {
    return static_cast<std::int64_t>(
        std::floor(.5 * static_cast<double>(u + 1) * g2_tables::kFps + 1e-9));
  }

  void start(std::int64_t u, bool atEnd, std::uint64_t absoluteSamples) noexcept {
    u_ = u;
    atEnd_ = atEnd;
    active_ = true;
    slot_ = 0;
    jobStart_ = absoluteSamples - kSlotSamples;
  }

  void advance(std::uint64_t absoluteSamples) noexcept {
    if (!active_)
      return;
    effetune::dsp::advanceStagedJob(
        active_, slot_, slots_, absoluteSamples, jobStart_, kSlotSamples, schedule_,
        [this](const effetune::dsp::SchedulerStage &st) { runStage(st); });
  }

  void complete() noexcept {
    advance(jobStart_ + static_cast<std::uint64_t>(slots_) * kSlotSamples);
    active_ = false;
  }

  void runStage(const effetune::dsp::SchedulerStage &st) noexcept {
    if (probe_.stage)
      probe_.stage(probe_.ctx, st, false);
    switch (st.kind) {
    case kGather:
      gather();
      break;
    case kFftFwd:
      fftForward(st.channel);
      break;
    case kFftInv:
      fftInverse(st.channel);
      break;
    case kComb:
      combAndCandidates();
      break;
    case kWindow:
      windowTerms();
      break;
    case kRef:
      reference(static_cast<int>(st.begin));
      break;
    case kFold:
      foldEventsHarmonic(static_cast<int>(st.begin));
      break;
    case kTrees:
      trees(st.channel, st.begin, st.end);
      break;
    default:
      publish();
      break;
    }
    if (probe_.stage)
      probe_.stage(probe_.ctx, st, true);
  }

  // ---- A: copy everything the job needs out of the stream.
  void gather() noexcept {
    const G2Stream &s = *stream_;
    none_ = true;
    count_ = 0;
    t_ = .5 * static_cast<double>(u_ + 1);
    const std::int64_t ticks = s.ticks();
    std::int64_t k1 = static_cast<std::int64_t>(std::floor(t_ * g2_tables::kFps + 1e-9));
    if (atEnd_ && k1 > ticks)
      k1 = ticks;
    const std::int64_t k0 = k1 - kMaxN > 0 ? k1 - kMaxN : 0;
    n_ = static_cast<int>(k1 - k0);
    if (static_cast<double>(n_) < g2_tables::kMinValid * g2_tables::kFps)
      return;
    none_ = false;
    tLo_ = static_cast<double>(k0) / g2_tables::kFps;
    loud_ = 0;
    for (int i = 0; i < n_; ++i) {
      const std::int64_t k = k0 + i;
      const G2Tick &tk = s.tick(k);
      const G2Tick *prev = k > 0 ? &s.tick(k - 1) : nullptr;
      const G2Tick *next = k + 1 < ticks ? &s.tick(k + 1) : nullptr;
      for (int b = 0; b < 3; ++b) {
        float m = tk.flux[b];
        if (prev && prev->flux[b] > m)
          m = prev->flux[b];
        if (next && next->flux[b] > m)
          m = next->flux[b];
        flux_[b][i] = tk.flux[b];
        fm_[b][i] = m;
      }
      loud_ += tk.loud ? 1 : 0;
      tau_[i] = (static_cast<double>(k) + 1.0) / g2_tables::kFps - g2_tables::kLatency;
    }
    // Events tLo < t <= t - EV_LAT, split by band in time order.
    const std::int64_t i0 = s.upperBound(tLo_), i1 = s.upperBound(t_ - g2_tables::kEvLat);
    if (i0 == s.eventBegin() && s.eventBegin() > 0)
      ++stats_.eventRingReach;
    evN_[0] = evN_[1] = evN_[2] = 0;
    for (std::int64_t i = i0; i < i1; ++i) {
      const G2Event &e = s.event(i);
      const int b = e.band;
      if (evN_[b] == kMaxBandEvents) {
        ++stats_.eventOverflow;
        continue;
      }
      evT_[b][evN_[b]] = e.t;
      evS_[b][evN_[b]] = static_cast<double>(e.strength);
      ++evN_[b];
    }
    for (int b = 0; b < 3; ++b)
      stats_.maxBandEvents = evN_[b] > stats_.maxBandEvents ? evN_[b] : stats_.maxBandEvents;
    // Chroma frames j_lo .. j_end - 1 with ct > tLo and a finite unit vector.
    kept_ = 0;
    const std::int64_t frames = s.chromaFrames();
    std::int64_t jEnd = static_cast<std::int64_t>(std::floor(t_ * g2_tables::kChFps + 1e-9));
    if (!atEnd_ && jEnd > frames)
      ++stats_.lateChroma;
    jEnd = jEnd < frames ? jEnd : frames;
    std::int64_t jLo =
        static_cast<std::int64_t>(std::floor((tLo_ + g2_tables::kChCentre) * g2_tables::kChFps)) -
        1;
    jLo = jLo > 0 ? jLo : 0;
    if (jEnd - jLo >= 4) {
      for (std::int64_t j = jLo; j < jEnd; ++j) {
        const double ct = (static_cast<double>(j) + 1.0) / g2_tables::kChFps - g2_tables::kChCentre;
        const G2ChromaFrame &f = s.chroma(j);
        if (!(ct > tLo_) || !f.ok)
          continue;
        if (kept_ == kMaxFrames) {
          ++stats_.frameOverflow;
          continue;
        }
        ct_[kept_] = ct;
        for (int c = 0; c < 12; ++c)
          cv_[kept_][c] = f.v[c];
        ++kept_;
      }
    }
    stats_.maxKeptFrames = kept_ > stats_.maxKeptFrames ? kept_ : stats_.maxKeptFrames;
  }

  // ---- B: unbiased ACF per band: irfft(|rfft(y, nfft)|^2)[:n/2 + 1] (float64).
  void fftForward(int b) noexcept {
    if (none_)
      return;
    nfft_ = 1;
    while (nfft_ < 2 * n_)
      nfft_ <<= 1;
    const int m = nfft_ / 2;
    mean_[b] = g2np::mean(flux_[b], n_);
    for (int j = 0; j < m; ++j) {
      const int i0 = 2 * j, i1 = i0 + 1;
      re_[j] = i0 < n_ ? flux_[b][i0] - mean_[b] : 0.0;
      im_[j] = i1 < n_ ? flux_[b][i1] - mean_[b] : 0.0;
    }
    rhythm_d::complexFft(re_, im_, static_cast<std::uint32_t>(m));
    const double z = rhythm_d::realBinZero(re_, im_), q = rhythm_d::realBinNyquist(re_, im_);
    pw_[b][0] = z * z + 0.0 * 0.0;
    pw_[b][m] = q * q + 0.0 * 0.0;
    for (int k = 1; k < m; ++k) {
      const rhythm_d::Bin v =
          rhythm_d::realBin(re_, im_, static_cast<std::uint32_t>(m), static_cast<std::uint32_t>(k));
      pw_[b][k] = v.re * v.re + v.im * v.im;
    }
  }

  void fftInverse(int b) noexcept {
    if (none_)
      return;
    const int m = nfft_ / 2;
    for (int j = 0; j < m; ++j) {
      const int k0 = 2 * j, k1 = k0 + 1;
      re_[j] = pw_[b][k0 <= m ? k0 : nfft_ - k0];
      im_[j] = pw_[b][k1 <= m ? k1 : nfft_ - k1];
    }
    rhythm_d::complexFft(re_, im_, static_cast<std::uint32_t>(m));
    const double scale = 1.0 / static_cast<double>(nfft_);
    L_ = n_ / 2 + 1;
    const double e0 = rhythm_d::realBinZero(re_, im_) * scale;
    const bool ok = e0 > 1e-12;
    band_[b][0] = ok ? (e0 * (static_cast<double>(n_) / static_cast<double>(n_))) / e0 : 0.0;
    for (int j = 1; j < L_; ++j) {
      const double a =
          rhythm_d::realBin(re_, im_, static_cast<std::uint32_t>(m), static_cast<std::uint32_t>(j))
              .re *
          scale;
      band_[b][j] = ok ? (a * (static_cast<double>(n_) / static_cast<double>(n_ - j))) / e0 : 0.0;
    }
    const double r = mean_[b] / g2_tables::kBandFloor;
    w_[b] = ok ? (r < 1.0 ? r : 1.0) : 0.0;
  }

  [[nodiscard]] static double atLag(const double *acf, int L, double lag) noexcept {
    if (!(lag >= 0.0 && lag <= static_cast<double>(L) - 1.001))
      return kNaN;
    const int i = static_cast<int>(std::floor(lag));
    const double w = lag - static_cast<double>(i);
    const int i1 = i + 1 < L - 1 ? i + 1 : L - 1;
    return acf[i] * (1.0 - w) + acf[i1] * w;
  }

  // ---- C1: comb, modes, candidates and the candidate / window features that need no per-candidate
  // loop over n.
  void combAndCandidates() noexcept {
    if (none_)
      return;
    const double ws = g2np::sum(w_, 3);
    for (int j = 0; j < L_; ++j)
      comb_[j] =
          ws > 0.0 ? ((w_[0] * band_[0][j] + w_[1] * band_[1][j]) + w_[2] * band_[2][j]) / ws : 0.0;
    // modes
    int peaks = 0;
    double pkLag[kMaxPeaks], pkD[kMaxPeaks], pkH[kMaxPeaks];
    const int hi = g2_tables::kModeLagHi < L_ - 2 ? g2_tables::kModeLagHi : L_ - 2;
    for (int lag = g2_tables::kModeLagLo;
         hi > g2_tables::kModeLagLo && lag <= hi && peaks < kMaxPeaks; ++lag) {
      const double y0 = comb_[lag - 1], y1 = comb_[lag], y2 = comb_[lag + 1];
      if (!(y1 > y0 && y1 >= y2 && y1 > 0.0))
        continue;
      const double den = (y0 - 2.0 * y1) + y2;
      double d = den < 0.0 ? (.5 * (y0 - y2)) / den : 0.0;
      d = d < -.5 ? -.5 : (d > .5 ? .5 : d);
      pkLag[peaks] = static_cast<double>(lag);
      pkD[peaks] = d;
      pkH[peaks] = y1 - (.25 * (y0 - y2)) * d;
      ++peaks;
    }
    stats_.maxPeaks = peaks > stats_.maxPeaks ? peaks : stats_.maxPeaks;
    // stable argsort(-h)[:4]
    bool taken[kMaxPeaks] = {};
    modes_ = peaks < g2_tables::kModes ? peaks : g2_tables::kModes;
    for (int r = 0; r < modes_; ++r) {
      int best = -1;
      for (int i = 0; i < peaks; ++i)
        if (!taken[i] && (best < 0 || pkH[i] > pkH[best]))
          best = i;
      taken[best] = true;
      mp_[r] = (pkLag[best] + pkD[best]) / g2_tables::kFps;
      mh_[r] = pkH[best];
    }
    // candidates
    int C = 0;
    for (int i = 0; i < modes_; ++i)
      for (int r = 0; r < 7; ++r) {
        const double q = mp_[i] / g2_tables::kRelatives[r];
        const double bpm = 60.0 / q;
        if (bpm < g2_tables::kBpmLo || bpm > g2_tables::kBpmHi)
          continue;
        bool dup = false;
        for (int k = 0; k < C && !dup; ++k) {
          const double l = rhythm_d::portableLog(q / per_[k]);
          dup = (l < 0.0 ? -l : l) <= g2_tables::kDedupe;
        }
        if (dup)
          continue;
        per_[C] = q;
        rank_[C] = i;
        rel_[C] = r;
        ++C;
      }
    if (C == 0) {
      none_ = true;
      return;
    }
    count_ = C;
    const double margin0 = HeapTreeEvaluator::initialMargin(g2_level::model());
    for (int c = 0; c < kC * kClasses; ++c)
      margins_[c] = margin0;
    double bs[10];
    for (int i = 0; i < 10; ++i) {
      const int a = g2_tables::kBsLo[i],
                e = g2_tables::kBsHi[i] < L_ - 1 ? g2_tables::kBsHi[i] : L_ - 1;
      double mx = kNaN;
      if (e >= a) {
        mx = comb_[a];
        for (int j = a + 1; j <= e; ++j)
          mx = comb_[j] > mx ? comb_[j] : mx;
      }
      bs[i] = mx;
    }
    double a1[kC];
    for (int c = 0; c < C; ++c) {
      float *x = x_[c];
      for (int f = 0; f < kNF; ++f)
        x[f] = kNaNf;
      const double per = per_[c];
      x[cFill] = g2np::feature(static_cast<double>(loud_) / (g2_tables::kW * g2_tables::kFps));
      x[cValid] = g2np::feature(static_cast<double>(n_) / (g2_tables::kW * g2_tables::kFps));
      x[cLbpm] = g2np::feature(g2m::log2((60.0 / per) / 120.0));
      x[cLrel] = g2np::feature(g2_tables::kLog2Rel[rel_[c]]);
      x[cModeRank] = g2np::feature(static_cast<double>(rank_[c]));
      x[cModeLbpm] = g2np::feature(g2m::log2((60.0 / mp_[rank_[c]]) / 120.0));
      x[cModeH] = g2np::feature(mh_[rank_[c]]);
      const double lagP = per * g2_tables::kFps;
      for (int j = 0; j < 9; ++j) {
        const double v = atLag(comb_, L_, lagP * g2_tables::kRelC[j]);
        x[cAcfC + j] = g2np::feature(v);
        if (j == 0)
          a1[c] = v == v ? v : -1.0;
      }
      for (int i = 0; i < 10; ++i)
        x[cBs + i] = g2np::feature(bs[i]);
      for (int b = 0; b < 3; ++b)
        for (int j = 0; j < 5; ++j)
          x[cAcfB + 5 * b + j] = g2np::feature(atLag(band_[b], L_, lagP * g2_tables::kRelB[j]));
    }
    double a1max = a1[0];
    for (int c = 1; c < C; ++c)
      a1max = a1[c] > a1max ? a1[c] : a1max;
    for (int c = 0; c < C; ++c) {
      int rank = 0;
      for (int k = 0; k < C; ++k)
        rank += (a1[k] > a1[c] || (k < c && a1[k] == a1[c])) ? 1 : 0;
      x_[c][cAcfRank] = g2np::feature(static_cast<double>(rank));
      x_[c][cAcfGap] = g2np::feature(a1[c] - a1max);
    }
  }

  // ---- C2: window-level terms over n: tflat, the reference ramp o, fm means, event totals and IOI
  // medians.
  void windowTerms() noexcept {
    if (none_)
      return;
    for (int b = 0; b < 3; ++b) {
      for (int i = 0; i < n_; ++i)
        scratch_[i] = rhythm_d::portableLog(flux_[b][i] + 1e-4);
      const double tf = rhythm_d::portableExp(g2np::mean(scratch_, n_)) / (mean_[b] + 1e-4);
      for (int c = 0; c < count_; ++c)
        x_[c][cTflat + b] = g2np::feature(tf);
      const double r = mean_[b] / g2_tables::kBandFloor;
      wb_[b] = (r < 1.0 ? r : 1.0) / (mean_[b] + 1e-4);
      fmDen_[b] = g2np::mean(fm_[b], n_) + 1e-4;
      evTot_[b] = g2np::sum(evS_[b], evN_[b]);
      evMed_[b] = kNaN;
      if (evN_[b] > 2) {
        for (int i = 0; i + 1 < evN_[b]; ++i)
          scratch_[i] = evT_[b][i + 1] - evT_[b][i];
        evMed_[b] = g2np::median(scratch_, evN_[b] - 1);
      }
    }
    const double step = .5 / static_cast<double>(n_ - 1);
    for (int i = 0; i < n_; ++i) {
      const double lin = i == n_ - 1 ? 1.0 : static_cast<double>(i) * step + .5;
      o_[i] = ((wb_[0] * flux_[0][i] + wb_[1] * flux_[1][i]) + wb_[2] * flux_[2][i]) * lin;
    }
  }

  // ---- D: beat reference of candidate c (DFT phase of o at 1 / per).
  void reference(int c) noexcept {
    if (none_ || c >= count_)
      return;
    const double per = per_[c];
    for (int i = 0; i < n_; ++i) {
      const g2m::SinCos sc = g2m::sinCos((g2_tables::kTwoPi * tau_[i]) / per);
      tr_[i] = o_[i] * sc.c;
      ti_[i] = -(o_[i] * sc.s);
    }
    double sr = 0.0, si = 0.0;
    g2np::cpairwise(tr_, ti_, n_, sr, si);
    sr = 0.0 + sr;
    si = 0.0 + si;
    const double r0 = (-g2m::atan2(si, sr) / g2_tables::kTwoPi) * per;
    ref_[c] = r0 + std::floor((t_ - r0) / per) * per;
  }

  // ---- E: fold, event fit and harmonic change of candidate c.
  void foldEventsHarmonic(int c) noexcept {
    if (none_ || c >= count_)
      return;
    float *x = x_[c];
    const double per = per_[c], ref = ref_[c];
    int cnt[24] = {};
    double fold[3][24] = {};
    for (int i = 0; i < n_; ++i) {
      const double pos = (tau_[i] - ref) / per;
      const int bin = static_cast<int>(std::nearbyint(g2np::mod(pos, 2.0) * 12.0)) % 24;
      ++cnt[bin];
      for (int b = 0; b < 3; ++b)
        fold[b][bin] += fm_[b][i];
    }
    for (int b = 0; b < 3; ++b)
      for (int k = 0; k < 24; ++k)
        fold[b][k] = fold[b][k] / static_cast<double>(cnt[k] > 1 ? cnt[k] : 1);
    if (fold[0][0] < fold[0][12])
      for (int b = 0; b < 3; ++b)
        for (int k = 0; k < 12; ++k) {
          const double v = fold[b][k];
          fold[b][k] = fold[b][k + 12];
          fold[b][k + 12] = v;
        }
    for (int b = 0; b < 3; ++b) {
      double fn[24];
      for (int k = 0; k < 24; ++k)
        fn[k] = fold[b][k] / fmDen_[b];
      float *f = x + cFold + 6 * b;
      f[0] = g2np::feature(fn[0]);
      f[1] = g2np::feature(fn[12]);
      f[2] = g2np::feature(fn[6]);
      f[3] = g2np::feature(fn[18]);
      const double s16[4] = {fn[3], fn[9], fn[15], fn[21]},
                   trip[4] = {fn[4], fn[8], fn[16], fn[20]};
      f[4] = g2np::feature(g2np::mean(s16, 4));
      f[5] = g2np::feature(g2np::mean(trip, 4));
    }
    x[cAltL] = g2np::feature(rhythm_d::portableLog((fold[0][0] + 1e-4) / (fold[0][12] + 1e-4)));
    x[cAltM] = g2np::feature(rhythm_d::portableLog((fold[1][12] + 1e-4) / (fold[1][0] + 1e-4)));
    // events
    const double span = static_cast<double>(n_) / g2_tables::kFps;
    for (int b = 0; b < 3; ++b) {
      const int nb = evN_[b];
      float *f = x + cEv + 4 * b;
      if (nb > 0) {
        for (int i = 0; i < nb; ++i) {
          double e = (evT_[b][i] - ref) / per;
          e = e - std::nearbyint(e);
          const double ae = e < 0.0 ? -e : e, ah = ae - .5 < 0.0 ? .5 - ae : ae - .5;
          scratch_[i] = evS_[b][i] * (ae < .125 ? 1.0 : 0.0);
          scratch2_[i] = evS_[b][i] * (ah < .125 ? 1.0 : 0.0);
        }
        f[0] = g2np::feature(g2np::sum(scratch_, nb) / evTot_[b]);
        f[1] = g2np::feature(g2np::sum(scratch2_, nb) / evTot_[b]);
      }
      if (nb > 2)
        f[2] = g2np::feature(g2m::log2(evMed_[b] / per));
      f[3] = g2np::feature((static_cast<double>(nb) * per) / span);
    }
    harmonic(c);
  }

  // Harmonic changes(r, p): 1 - cos between the mean chroma of consecutive complete intervals,
  // newest first; returns the length (0 for the empty result) and writes d.
  int changes(double r, double p, double *d) noexcept {
    int nn[kMaxFrames];
    int used = 0, K = 0;
    for (int i = 0; i < kept_; ++i) {
      const double q = std::floor((r - ct_[i]) / p);
      const bool m = q >= 0.0 && r - (q + 1.0) * p >= tLo_;
      nn[i] = m ? static_cast<int>(q) : -1;
      if (m) {
        ++used;
        K = nn[i] + 1 > K ? nn[i] + 1 : K;
      }
    }
    if (used < 2)
      return 0;
    stats_.maxHarmK = K > stats_.maxHarmK ? K : stats_.maxHarmK;
    if (K > kMaxHarm) {
      ++stats_.harmOverflow;
      return 0;
    }
    double s[kMaxHarm][12] = {};
    int ok[kMaxHarm] = {};
    for (int i = 0; i < kept_; ++i) {
      if (nn[i] < 0)
        continue;
      for (int c = 0; c < 12; ++c)
        s[nn[i]][c] += cv_[i][c];
      ++ok[nn[i]];
    }
    double u[kMaxHarm][12];
    for (int k = 0; k < K; ++k) {
      double sq[12];
      for (int c = 0; c < 12; ++c)
        sq[c] = s[k][c] * s[k][c];
      const double nrm = std::sqrt(g2np::sum(sq, 12));
      const double den = nrm > 0.0 ? nrm : 1.0;
      for (int c = 0; c < 12; ++c)
        u[k][c] = s[k][c] / den;
    }
    for (int k = 0; k + 1 < K; ++k) {
      double pr[12];
      for (int c = 0; c < 12; ++c)
        pr[c] = u[k + 1][c] * u[k][c];
      d[k] = ok[k + 1] && ok[k] ? 1.0 - g2np::sum(pr, 12) : kNaN;
    }
    return K - 1;
  }

  [[nodiscard]] static double nanmeanOrNaN(const double *a, int n) noexcept {
    double tmp[kMaxHarm];
    return n > 0 && g2np::anyFinite(a, n) ? g2np::nanmean(a, n, tmp) : kNaN;
  }

  void harmonic(int c) noexcept {
    if (kept_ < 4)
      return;
    const double p = per_[c], r = ref_[c];
    double on[kMaxHarm], off[kMaxHarm], h[kMaxHarm], tmp[kMaxHarm];
    const int nOn = changes(r, p, on);
    if (nOn < 2 || !g2np::anyFinite(on, nOn))
      return;
    const int nOff = changes(r - .5 * p, p, off);
    const double a = g2np::nanmean(on, nOn, tmp);
    const double b = nanmeanOrNaN(off, nOff);
    double ev[kMaxHarm], od[kMaxHarm];
    int ne = 0, no = 0;
    for (int i = 0; i < nOn; ++i) {
      if (i % 2 == 0)
        ev[ne++] = on[i];
      else
        od[no++] = on[i];
    }
    const double e = nanmeanOrNaN(ev, ne), o = nanmeanOrNaN(od, no);
    double h2 = kNaN;
    bool have = false;
    for (int k = 0; k < 2; ++k) {
      const int nh = changes(k == 0 ? r : r - p, 2 * p, h);
      if (nh > 0 && g2np::anyFinite(h, nh)) {
        const double v = g2np::nanmean(h, nh, tmp);
        h2 = !have ? v : (v > h2 ? v : h2);
        have = true;
      }
    }
    float *x = x_[c] + cHc;
    x[0] = g2np::feature(a);
    x[1] = g2np::feature(b);
    x[2] = g2np::feature((a - b) / ((a + b) + 1e-6));
    const double eo = e - o;
    x[3] = g2np::feature((eo < 0.0 ? -eo : eo) / ((e + o) + 1e-6));
    x[4] = g2np::feature(have ? (h2 - a) / ((h2 + a) + 1e-6) : kNaN);
  }

  // ---- F: trees [first, end) for candidates 4g .. 4g + 3.
  void trees(int g, std::uint32_t first, std::uint32_t end) noexcept {
    if (none_ || 4 * g >= count_)
      return;
    const int rows = count_ - 4 * g < 4 ? count_ - 4 * g : 4;
    const float *const r[4] = {x_[4 * g], x_[4 * g + 1], x_[4 * g + 2], x_[4 * g + 3]};
    HeapTreeEvaluator::accumulateTrees4<kClasses>(g2_level::model(), r, first, end,
                                                  margins_ + 4 * kClasses * g,
                                                  static_cast<std::uint32_t>(rows));
  }

  // ---- G: softmax, calibration, publish.
  void publish() noexcept {
    G2Update &out = results_[u_ % kResultRing];
    out.t = t_;
    out.count = none_ ? 0 : count_;
    for (int c = 0; c < out.count; ++c) {
      const double *m = margins_ + kClasses * c;
      double mx = m[0];
      mx = m[1] > mx ? m[1] : mx;
      mx = m[2] > mx ? m[2] : mx;
      double e[3];
      for (int k = 0; k < 3; ++k)
        e[k] = rhythm_d::portableExp(m[k] - mx);
      const double se = ((0.0 + e[0]) + e[1]) + e[2];
      double q[3];
      q[0] = g2np::interp(e[0] / se, g2_tables::kCalibX0, g2_tables::kCalibY0, 131);
      q[1] = g2np::interp(e[1] / se, g2_tables::kCalibX1, g2_tables::kCalibY1, 131);
      q[2] = g2np::interp(e[2] / se, g2_tables::kCalibX2, g2_tables::kCalibY2, 131);
      const double s = (q[0] + q[1]) + q[2];
      for (int k = 0; k < 3; ++k)
        out.p[c][k] = static_cast<float>(s > 1e-12 ? q[k] / s : 1.0 / 3.0);
      out.period[c] = static_cast<float>(per_[c]);
      out.ref[c] = ref_[c];
    }
    published_ = u_ + 1;
    if (probe_.published)
      probe_.published(probe_.ctx, u_);
  }

  effetune::dsp::StageSchedule<128, 64> schedule_;
  bool scheduleOk_ = false;
  std::uint32_t slots_ = 0;
  G2Probe probe_;
  G2UpdaterStats stats_;
  const G2Stream *stream_ = nullptr;

  std::int64_t nextU_ = 0, published_ = 0, u_ = 0;
  bool active_ = false, atEnd_ = false;
  std::uint32_t slot_ = 0;
  std::uint64_t jobStart_ = 0;

  // job
  bool none_ = true;
  int count_ = 0, n_ = 0, nfft_ = 0, L_ = 0, modes_ = 0, kept_ = 0;
  std::int64_t loud_ = 0;
  double t_ = 0.0, tLo_ = 0.0;
  double flux_[3][kMaxN] = {}, fm_[3][kMaxN] = {}, tau_[kMaxN] = {}, o_[kMaxN] = {};
  double tr_[kMaxN] = {}, ti_[kMaxN] = {};
  double evT_[3][kMaxBandEvents] = {}, evS_[3][kMaxBandEvents] = {};
  int evN_[3] = {};
  double evTot_[3] = {}, evMed_[3] = {};
  double ct_[kMaxFrames] = {}, cv_[kMaxFrames][12] = {};
  double re_[kMaxM] = {}, im_[kMaxM] = {}, pw_[3][kMaxM + 1] = {};
  double mean_[3] = {}, w_[3] = {}, wb_[3] = {}, fmDen_[3] = {};
  double band_[3][kMaxL] = {}, comb_[kMaxL] = {};
  double mp_[4] = {}, mh_[4] = {};
  double per_[kC] = {}, ref_[kC] = {};
  int rank_[kC] = {}, rel_[kC] = {};
  float x_[kC][kNF] = {};
  double margins_[kC * kClasses] = {};
  double scratch_[kMaxBandEvents] = {}, scratch2_[kMaxBandEvents] = {};
  G2Update results_[kResultRing] = {};
};

} // namespace effetune::plugins::analyzer::rhythm_a3

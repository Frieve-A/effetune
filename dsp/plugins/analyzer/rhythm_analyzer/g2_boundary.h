// The A3 decoder hooks as streaming C++: the boundary tracker (quiet-run gaps, the song state and
// its novelty) and the boundary hazard (the embedded g2_hazard model, its theta and scales).
//
// boundary(t, committed) classifies the ticks up to at_ticks(t),
// closes quiet runs of >= .25 s into gaps (a gap spawn when committed and the song snapshot holds
// >= 2 s), advances the song state to t - 3, forms the novelty of the window (max(t - 3, last gap
// end), t] and spawns on its rising edge through theta, then returns the new spawns and the hazard
// h of every open spawn (0 <= t - spawn.t <= 5.25). Reads from G2Stream: ticks < at_ticks(t),
// chroma frames whose last tick 8j + 7 is < at_ticks(t), events with ev_t <= t - .05; all complete
// when the decoder calls. Same statement order and numpy / OpenBLAS orders as the reference
// (g2_numpy.h); transcendentals from portable_math.h (ulp-level). A spawn keeps only what its
// hazard rows read: the snapshot's s[12] and ch[12], its window start and gap values. Capacities:
// kMaxOpen open spawns and kMaxNew new spawns per call; a spawn that finds either full is not
// created (its id is still consumed and the refractory time still set) and is counted in
// stats().droppedSpawns. No allocation, exceptions, RTTI or locks.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>

#include "g2_hazard.generated.h"
#include "g2_math.h"
#include "g2_numpy.h"
#include "g2_stream.h"
#include "g2_tables.generated.h"
#include "heap_tree_model.h"
#include "portable_math.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

struct G2Spawn {
  std::int64_t id;   // creation index
  double t;          // spawn time, s (gap: its end k / FPS; novelty: the call's t)
  bool gap;          // kind 'gap' (else 'novelty')
  double gapLen;     // s (0 for novelty)
  double gapDepthDb; // dB (0 for novelty)
  double gapZ;       // 1.0 if the run held fe-silent ticks, else 0.0
};

struct G2HookRow {
  std::int64_t id; // open spawn
  float x[7]; // hazard row (tau, act, gap, gap_len, gap_depth, gap_z, chroma), float32 as the model
              // reads it
  double h;   // hazard 1 / (1 + exp(-margin))
};

class G2Boundary {
public:
  static constexpr int kMaxOpen = 32;
  static constexpr int kMaxNew = 4;
  static constexpr std::int64_t kWin = G2Stream::kTickRing; // longest tick window a call reads
  static constexpr int kMaxBandEvents = 1024;               // events per band in one song advance
  // The rows below are built for this column set (tau, act, gap, gap_len, gap_depth, gap_z,
  // chroma).
  static_assert(g2_tables::kHazardCols[0] == 0 && g2_tables::kHazardCols[1] == 11 &&
                g2_tables::kHazardCols[2] == 1 && g2_tables::kHazardCols[3] == 2 &&
                g2_tables::kHazardCols[4] == 3 && g2_tables::kHazardCols[5] == 4 &&
                g2_tables::kHazardCols[6] == 9);

  struct Result {
    int newCount = 0;
    G2Spawn spawns[kMaxNew] = {};
    int rowCount = 0;
    G2HookRow rows[kMaxOpen] = {}; // creation order
    // diagnostics (checks)
    double songLevel = 0.0; // song.level() before the call (the gap threshold is this - 20 dB)
    double terms[5] = {};   // novelty terms of the song window
    double novelty = 0.0;
    double snapS12[kMaxNew] = {}; // snapshot s[12] of each new spawn
  };

  struct Stats {
    int maxOpen = 0;
    int maxNew = 0;
    std::int64_t droppedSpawns = 0;
    std::int64_t bandEventOverflow = 0;
    std::int64_t maxWindow = 0;
  };

  void reset(const G2Stream *stream) noexcept {
    stream_ = stream;
    song_ = {};
    k_ = 0;
    run0_ = -1;
    runZ_ = false;
    runCount_ = 0;
    std::memset(coarse_, 0, sizeof(coarse_));
    std::memset(fine_, 0, sizeof(fine_));
    haveGap_ = false;
    gapT1_ = 0.0;
    novPrev_ = std::numeric_limits<double>::infinity();
    lastSpawn_ = -std::numeric_limits<double>::infinity();
    nextId_ = 0;
    openCount_ = 0;
    stats_ = {};
  }

  [[nodiscard]] const Stats &stats() const noexcept { return stats_; }

  const Result &boundary(double t, bool committed) noexcept {
    namespace T = g2_tables;
    Result &res = result_;
    res.newCount = 0;
    res.rowCount = 0;
    const std::int64_t K = stream_->ticks();
    const std::int64_t k1 = min64(atTicks(t), K);
    const double Ls = level(song_);
    const double thr = Ls - T::kGapRel;
    res.songLevel = Ls;
    for (std::int64_t k = k_; k < k1; ++k) {
      const G2Tick &tk = stream_->tick(k);
      const double rms = static_cast<double>(tk.rms);
      const bool z = tk.silent;
      const bool q = z || rms < thr;
      loud_[k & kMask] = !q;
      pw_[k & kMask] = rhythm_d::portableDecadePower(rms / 10.0);
      for (int b = 0; b < 3; ++b)
        pe_[b][k & kMask] = rhythm_d::portableDecadePower(static_cast<double>(tk.loge[b]));
      if (q) {
        if (run0_ < 0) {
          run0_ = k;
          runZ_ = false;
        }
        histAdd(tk.rms);
        runZ_ = runZ_ || z;
      } else if (run0_ >= 0) {
        const std::int64_t n = k - run0_;
        if (static_cast<double>(n) >= T::kGapMin * T::kFps) {
          const double med = histMedian();
          const double t1 = static_cast<double>(k) / T::kFps;
          gapT1_ = t1;
          haveGap_ = true;
          const double depth = Ls > -std::numeric_limits<double>::infinity()
                                   ? Ls - (med > T::kGapFloor ? med : T::kGapFloor)
                                   : 0.0;
          if (committed) {
            Snap snap{song_.s[12], {}};
            std::memcpy(snap.ch, song_.ch, sizeof(snap.ch));
            std::int64_t sk = song_.k;
            advanceSnap(snap, sk, static_cast<double>(run0_) / T::kFps + T::kEvLat, K);
            if (snap.s12 >= T::kMinSong)
              spawn(res, t1, true, t1, static_cast<double>(n) / T::kFps, depth, runZ_ ? 1.0 : 0.0,
                    snap);
          }
        }
        histClear();
        run0_ = -1;
      }
    }
    k_ = k1 > k_ ? k1 : k_;
    advanceSong(t - T::kRN, K);
    const double tr = t - T::kRN;
    const double w0 = haveGap_ && gapT1_ > tr ? gapT1_ : tr;
    double act = 0.0;
    change(song_.s[12], song_.ch, &song_, w0, t, K, res.terms, act);
    const double nov = novelty(res.terms);
    res.novelty = nov;
    const double th = T::kHazardTheta;
    if (nov >= th && !(novPrev_ >= th) && t - lastSpawn_ >= T::kRefract && run0_ < 0 && committed &&
        song_.s[12] >= T::kMinSong) {
      Snap snap{song_.s[12], {}};
      std::memcpy(snap.ch, song_.ch, sizeof(snap.ch));
      spawn(res, t, false, w0, 0.0, 0.0, 0.0, snap);
    }
    novPrev_ = nov;
    // Rows of the open spawns; a spawn past TAU_MAX never returns (t only grows).
    int keep = 0;
    for (int i = 0; i < openCount_; ++i) {
      Open &sp = open_[i];
      const double tau = t - sp.t;
      if (tau > T::kTauMax)
        continue;
      if (keep != i)
        open_[keep] = sp;
      Open &o = open_[keep++];
      if (!(0.0 <= tau))
        continue;
      double terms[5];
      double a = 0.0;
      change(o.snap.s12, o.snap.ch, nullptr, o.w0, t, K, terms, a);
      G2HookRow &row = res.rows[res.rowCount++];
      row.id = o.id;
      row.x[0] = static_cast<float>(tau);
      row.x[1] = static_cast<float>(a);
      row.x[2] = o.gap ? 1.0f : 0.0f;
      row.x[3] = static_cast<float>(o.gapLen);
      row.x[4] = static_cast<float>(o.gapDepth);
      row.x[5] = static_cast<float>(o.gapZ);
      row.x[6] = static_cast<float>(terms[4]);
      const double zm = HeapTreeEvaluator::margin(g2_hazard::model(), row.x) + T::kHazardOffset;
      row.h = 1.0 / (1.0 + rhythm_d::portableExp(-zm));
    }
    openCount_ = keep;
    stats_.maxOpen = res.rowCount > stats_.maxOpen ? res.rowCount : stats_.maxOpen;
    stats_.maxNew = res.newCount > stats_.maxNew ? res.newCount : stats_.maxNew;
    return res;
  }

private:
  static constexpr std::int64_t kMask = G2Stream::kTickRing - 1;
  static constexpr double kInf = std::numeric_limits<double>::infinity();

  struct Song {
    double s[13];
    double pw;
    double ch[12];
    std::int64_t k; // next tick to consume
  };
  struct Snap {
    double s12;
    double ch[12];
  };
  struct Open {
    std::int64_t id;
    double t, w0;
    bool gap;
    double gapLen, gapDepth, gapZ;
    Snap snap;
  };

  [[nodiscard]] static std::int64_t min64(std::int64_t a, std::int64_t b) noexcept {
    return a < b ? a : b;
  }
  [[nodiscard]] static std::int64_t atTicks(double t) noexcept {
    return static_cast<std::int64_t>(std::floor(t * g2_tables::kFps + 1e-9));
  }
  [[nodiscard]] static double level(const Song &st) noexcept {
    const double n = st.s[12] * g2_tables::kFps;
    return n > 0.0 && st.pw > 0.0 ? 10.0 * g2m::log10(st.pw / n) : -kInf;
  }
  [[nodiscard]] static std::int64_t eventTick(double evT) noexcept {
    return static_cast<std::int64_t>(
        std::nearbyint((evT + g2_tables::kLatency) * g2_tables::kFps - 1.0));
  }

  // ---- exact median of the quiet run's rms_db values (binary16 codes, two-level histogram)
  [[nodiscard]] static std::uint16_t key(float v) noexcept {
    std::uint16_t bits;
    if (std::isinf(v))
      bits = static_cast<std::uint16_t>(v < 0.0f ? 0xFC00u : 0x7C00u);
    else
      bits = g2m::halfBits(static_cast<double>(v));
    return static_cast<std::uint16_t>((bits & 0x8000u) ? (~bits & 0xFFFFu) : (bits | 0x8000u));
  }
  [[nodiscard]] static double value(std::uint32_t key) noexcept {
    const std::uint32_t bits = (key & 0x8000u) ? (key & 0x7FFFu) : (~key & 0xFFFFu);
    const double sign = (bits & 0x8000u) ? -1.0 : 1.0;
    const int e = static_cast<int>((bits >> 10) & 0x1Fu);
    const int f = static_cast<int>(bits & 0x3FFu);
    if (e == 31)
      return sign * kInf;
    if (e == 0)
      return sign * std::ldexp(static_cast<double>(f), -24);
    return sign * std::ldexp(static_cast<double>(1024 + f), e - 25);
  }
  void histAdd(float v) noexcept {
    const std::uint16_t k = key(v);
    ++fine_[k];
    ++coarse_[k >> 8];
    ++runCount_;
  }
  void histClear() noexcept {
    for (int c = 0; c < 256; ++c)
      if (coarse_[c] != 0u) {
        std::memset(fine_ + (c << 8), 0, 256 * sizeof(fine_[0]));
        coarse_[c] = 0u;
      }
    runCount_ = 0;
  }
  // Sorted element r (0-based) of the run.
  [[nodiscard]] double histAt(std::int64_t r) const noexcept {
    int c = 0;
    for (; c < 255 && r >= static_cast<std::int64_t>(coarse_[c]); ++c)
      r -= coarse_[c];
    int f = c << 8;
    for (; f < (c << 8) + 255 && r >= static_cast<std::int64_t>(fine_[f]); ++f)
      r -= fine_[f];
    return value(static_cast<std::uint32_t>(f));
  }
  // np.median: the middle element, or the mean of the two middle elements (exact here: binary16
  // values in float64).
  [[nodiscard]] double histMedian() const noexcept {
    const std::int64_t n = runCount_;
    if (n & 1)
      return histAt(n / 2);
    const double a = histAt(n / 2 - 1), b = histAt(n / 2);
    return (a + b) / 2.0;
  }

  // ---- song state advance
  // Weights of ticks k0..k1-1: w = where(loud, exp(-(a[-1] - a) / H), 0), a = cumsum(loud) / FPS;
  // returns decay.
  double weights(std::int64_t k0, std::int64_t n) noexcept {
    std::int64_t total = 0;
    for (std::int64_t i = 0; i < n; ++i)
      total += loud_[(k0 + i) & kMask] ? 1 : 0;
    const double aLast = static_cast<double>(total) / g2_tables::kFps;
    std::int64_t cnt = 0;
    for (std::int64_t i = 0; i < n; ++i) {
      const bool l = loud_[(k0 + i) & kMask];
      cnt += l ? 1 : 0;
      const double a = static_cast<double>(cnt) / g2_tables::kFps;
      w_[i] = l ? rhythm_d::portableExp(-(aLast - a) / g2_tables::kHB) : 0.0;
    }
    return rhythm_d::portableExp(-aLast / g2_tables::kHB);
  }
  [[nodiscard]] static std::int64_t advanceEnd(double t, std::int64_t K) noexcept {
    return min64(
        static_cast<std::int64_t>(std::floor((t - g2_tables::kEvLat) * g2_tables::kFps + 1e-9)), K);
  }
  // ch *= decay; ch += w[ch_k - k0] @ v[ok] over frames with k0 <= ch_k = 8 j + 7 < k1.
  void advanceChroma(double ch[12], std::int64_t k0, std::int64_t k1, double decay) noexcept {
    for (int c = 0; c < 12; ++c)
      ch[c] *= decay;
    const std::int64_t j1 = min64(k1 / 8, stream_->chromaFrames());
    std::int64_t m = 0;
    for (std::int64_t j = k0 / 8; j < j1; ++j) {
      const G2ChromaFrame &f = stream_->chroma(j);
      if (!f.ok)
        continue;
      rowPtr_[m] = f.v;
      wSel_[m++] = w_[8 * j + 7 - k0];
    }
    double y[12];
    g2np::gemvN12(rowPtr_, wSel_, m, y);
    for (int c = 0; c < 12; ++c)
      ch[c] += y[c];
  }
  void advanceSnap(Snap &sn, std::int64_t k0, double t, std::int64_t K) noexcept {
    const std::int64_t k1 = advanceEnd(t, K);
    if (k1 <= k0)
      return;
    const std::int64_t n = k1 - k0;
    noteWindow(n);
    const double decay = weights(k0, n);
    sn.s12 *= decay;
    sn.s12 += g2np::sum(w_, n) / g2_tables::kFps;
    advanceChroma(sn.ch, k0, k1, decay);
  }
  void advanceSong(double t, std::int64_t K) noexcept {
    namespace T = g2_tables;
    Song &st = song_;
    const std::int64_t k1 = advanceEnd(t, K);
    if (k1 <= st.k)
      return;
    const std::int64_t k0 = st.k, n = k1 - k0;
    noteWindow(n);
    const double decay = weights(k0, n);
    for (double &v : st.s)
      v *= decay;
    for (int part = 0; part < 3; ++part) {
      for (std::int64_t i = 0; i < n; ++i) {
        const G2Tick &tk = stream_->tick(k0 + i);
        for (int b = 0; b < 3; ++b) {
          const float v = part == 0 ? tk.loge[b] : part == 1 ? tk.flux[b] : tk.lvl[b];
          rows_[b][i] = part == 0 ? pe_[b][(k0 + i) & kMask] : static_cast<double>(v);
        }
      }
      const double *a[3] = {rows_[0], rows_[1], rows_[2]};
      double y[3];
      g2np::gemvT3(a, w_, n, y);
      for (int b = 0; b < 3; ++b)
        st.s[3 * part + b] += y[b];
    }
    // events with k0 <= ev_k < k1, per band in event order
    int cnt[3] = {0, 0, 0};
    for (std::int64_t i = firstEventTick(k0); i < stream_->eventEnd(); ++i) {
      const G2Event &e = stream_->event(i);
      const std::int64_t ek = eventTick(e.t);
      if (ek >= k1)
        break;
      const int b = e.band;
      if (cnt[b] < kMaxBandEvents)
        bandW_[b][cnt[b]++] = w_[ek - k0];
      else
        ++stats_.bandEventOverflow;
    }
    for (int b = 0; b < 3; ++b)
      st.s[9 + b] += g2np::sum(bandW_[b], cnt[b]);
    st.s[12] += g2np::sum(w_, n) / T::kFps;
    for (std::int64_t i = 0; i < n; ++i)
      rows_[0][i] = pw_[(k0 + i) & kMask];
    st.pw = st.pw * decay + g2np::ddot(rows_[0], w_, n);
    advanceChroma(st.ch, k0, k1, decay);
    st.k = k1;
  }
  // First event index with ev_k >= k (ev_k is non-decreasing in ev_t).
  [[nodiscard]] std::int64_t firstEventTick(std::int64_t k) const noexcept {
    std::int64_t lo = stream_->eventBegin(), hi = stream_->eventEnd();
    while (lo < hi) {
      const std::int64_t mid = lo + (hi - lo) / 2;
      if (eventTick(stream_->event(mid).t) < k)
        lo = mid + 1;
      else
        hi = mid;
    }
    return lo;
  }
  void noteWindow(std::int64_t n) noexcept {
    stats_.maxWindow = n > stats_.maxWindow ? n : stats_.maxWindow;
  }

  // ---- Tracker.change against a state with s[12] = s12 and chroma ch; st (the song) also gives
  // the features and the level terms (terms[0..3]); for spawn snapshots (st null) only act and
  // terms[4] are formed (the hazard reads no other term).
  void change(double s12, const double ch[12], const Song *st, double w0, double t, std::int64_t K,
              double terms[5], double &act) noexcept {
    namespace T = g2_tables;
    const double nan = std::numeric_limits<double>::quiet_NaN();
    for (int i = 0; i < 5; ++i)
      terms[i] = nan;
    const std::int64_t k0 = atTicks(w0) > 0 ? atTicks(w0) : 0;
    const std::int64_t k1 = min64(atTicks(t), K);
    const std::int64_t n = k1 > k0 ? k1 - k0 : 0;
    noteWindow(n);
    std::int64_t nl = 0;
    for (std::int64_t i = 0; i < n; ++i)
      nl += loud_[(k0 + i) & kMask] ? 1 : 0;
    act = static_cast<double>(nl) / T::kFps;
    if (s12 <= 0.0 || act < T::kMinAct)
      return;
    if (st != nullptr)
      songTerms(*st, k0, k1, terms);
    // chroma: frames with k0 <= ch_k < k1, valid and loud
    double sq[12];
    for (int c = 0; c < 12; ++c)
      sq[c] = ch[c];
    const double sn = std::sqrt(g2np::ddot(sq, sq, 12));
    const std::int64_t j1 = min64(k1 / 8, stream_->chromaFrames());
    double m[12] = {};
    std::int64_t cnt = 0;
    for (std::int64_t j = k0 / 8; j < j1; ++j) {
      const G2ChromaFrame &f = stream_->chroma(j);
      if (!f.ok || !loud_[(8 * j + 7) & kMask])
        continue;
      for (int c = 0; c < 12; ++c)
        m[c] = cnt == 0 ? f.v[c] : m[c] + f.v[c];
      ++cnt;
    }
    if (cnt > 0 && sn > 0.0) {
      for (int c = 0; c < 12; ++c)
        m[c] = m[c] / static_cast<double>(cnt);
      const double mn = std::sqrt(g2np::ddot(m, m, 12));
      if (mn > 0.0)
        terms[4] = 1.0 - g2np::ddot(m, sq, 12) / (mn * sn);
    }
  }

  // Song-state features over [k0, k1) (t = k1 / FPS, w_eff = (k1 - k0) / FPS) and the level terms
  // of change().
  void songTerms(const Song &st, std::int64_t k0c, std::int64_t k1c, double terms[5]) noexcept {
    namespace T = g2_tables;
    const double D = st.s[12];
    const double t = static_cast<double>(k1c) / T::kFps;
    const double wEff = static_cast<double>(k1c - k0c) / T::kFps;
    const std::int64_t k1 = min64(atTicks(t), stream_->ticks());
    const std::int64_t kr = static_cast<std::int64_t>(std::nearbyint(wEff * T::kFps));
    const std::int64_t k0 = k1 - kr > 0 ? k1 - kr : 0;
    std::int64_t nl = 0;
    for (std::int64_t k = k0; k < k1; ++k)
      if (loud_[k & kMask]) {
        const G2Tick &tk = stream_->tick(k);
        for (int b = 0; b < 3; ++b) {
          rows_[b][nl] = pe_[b][k & kMask];
          fl_[b][nl] = static_cast<double>(tk.flux[b]);
          lv_[b][nl] = static_cast<double>(tk.lvl[b]);
        }
        pwSel_[nl] = pw_[k & kMask];
        ++nl;
      }
    const double tNow = static_cast<double>(nl) / T::kFps;
    int nNow[3] = {0, 0, 0};
    const std::int64_t i1 = stream_->upperBound(t - T::kEvLat);
    for (std::int64_t i = stream_->upperBound(static_cast<double>(k0) / T::kFps); i < i1; ++i)
      ++nNow[stream_->event(i).band];
    double dens[3], lev[3], ph[3];
    for (int b = 0; b < 3; ++b) {
      const double rate = st.s[9 + b] / D;
      dens[b] = g2m::log2((static_cast<double>(nNow[b]) + 1.0) / (rate * tNow + 1.0));
    }
    const double nn = D * T::kFps;
    for (int b = 0; b < 3; ++b) {
      const double P = g2np::mean(rows_[b], nl), F = g2np::mean(fl_[b], nl),
                   L = g2np::mean(lv_[b], nl);
      const double Ps = st.s[b] / nn, Fs = st.s[3 + b] / nn, Lsb = st.s[6 + b] / nn;
      lev[b] = 10.0 * g2m::log10((P > 1e-30 ? P : 1e-30) / (Ps > 1e-30 ? Ps : 1e-30));
      ph[b] = rhythm_d::portableLog((F + 1e-4) / (L + 1e-3)) -
              rhythm_d::portableLog((Fs + 1e-4) / (Lsb + 1e-3));
    }
    // lev_s over the change window's loud ticks (the same window: k0 == k0c, k1 == k1c)
    const double pm = g2np::mean(pwSel_, nl);
    const double levS =
        10.0 * g2m::log10((1e-30 > pm ? 1e-30 : pm) / (st.pw / (st.s[12] * T::kFps)));
    terms[0] = levS < 0.0 ? -levS : levS;
    const double lm = g2np::mean(lev, 3);
    double d2[3], p2[3], n2[3];
    for (int b = 0; b < 3; ++b) {
      const double d = lev[b] - lm;
      d2[b] = d * d;
      p2[b] = ph[b] * ph[b];
      n2[b] = dens[b] * dens[b];
    }
    terms[1] = std::sqrt(g2np::sum(d2, 3));
    terms[2] = std::sqrt(g2np::sum(p2, 3));
    terms[3] = std::sqrt(g2np::sum(n2, 3));
  }

  [[nodiscard]] static double novelty(const double terms[5]) noexcept {
    double x[5];
    bool any = false;
    for (int i = 0; i < 5; ++i) {
      const double v = terms[i] / g2_tables::kHazardScales[i];
      any = any || v == v;
      x[i] = v == v ? v : 0.0;
    }
    return any ? g2np::sum(x, 5) : std::numeric_limits<double>::quiet_NaN();
  }

  void spawn(Result &res, double t, bool gap, double w0, double len, double depth, double z,
             const Snap &snap) noexcept {
    lastSpawn_ = t;
    const std::int64_t id = nextId_++;
    if (openCount_ == kMaxOpen || res.newCount == kMaxNew) {
      ++stats_.droppedSpawns;
      return;
    }
    res.snapS12[res.newCount] = snap.s12;
    res.spawns[res.newCount++] = {id, t, gap, len, depth, z};
    open_[openCount_++] = {id, t, w0, gap, len, depth, z, snap};
  }

  const G2Stream *stream_ = nullptr;
  Song song_ = {};
  std::int64_t k_ = 0;
  std::int64_t run0_ = -1;
  bool runZ_ = false;
  std::int64_t runCount_ = 0;
  std::uint32_t coarse_[256] = {};
  std::uint32_t fine_[65536] = {};
  bool haveGap_ = false;
  double gapT1_ = 0.0;
  double novPrev_ = kInf;
  double lastSpawn_ = -kInf;
  std::int64_t nextId_ = 0;
  int openCount_ = 0;
  Open open_[kMaxOpen] = {};
  Result result_ = {};
  Stats stats_ = {};
  bool loud_[G2Stream::kTickRing] = {};
  double pw_[G2Stream::kTickRing] = {};
  double pe_[3][G2Stream::kTickRing] =
      {}; // 10 ** loge per tick and band (the song sums and features)
  double w_[kWin] = {};
  double rows_[3][kWin] = {};
  double fl_[3][kWin] = {};
  double lv_[3][kWin] = {};
  double pwSel_[kWin] = {};
  double wSel_[kWin / 8 + 1] = {};
  const double *rowPtr_[kWin / 8 + 1] = {};
  double bandW_[3][kMaxBandEvents] = {};
};

} // namespace effetune::plugins::analyzer::rhythm_a3

// The per-tick, per-event and per-chroma-frame store that the G2 update and the boundary hooks
// read. It derives the values the G2 features use from the front-end fields (float32 flux 4-mean,
// loge, loud, fe_silent; chroma unit vectors; events sorted by time). Fixed rings, no allocation.
#pragma once
#include <cmath>
#include <cstdint>

#include "g2_tables.generated.h"
#include "portable_math.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

struct G2Tick {
  float flux[3]; // band L, M, H: ((f0 + f1) + f2) + f3, then / 4 (float32, numpy mean of 4 frames)
  float loge[3]; // max(bandDb / 10 + kFeLogeC[b], -10) (float32)
  float lvl[3];
  float rms;   // rms_db
  bool loud;   // max(loge) > -7
  bool silent; // fe_silent: this tick ends >= 24 consecutive ticks with rms < -70
};

struct G2ChromaFrame {
  double v[12]; // p / |p| with p_c = 10^(ch_c - max ch) (portableDecadePower); NaN when max ch < -8
  bool ok;      // v is finite
};

struct G2Event {
  double t;
  float strength;
  std::uint8_t band;
};

class G2Stream {
public:
  static constexpr std::int64_t kTickRing = 2048, kChromaRing = 256, kEventRing = 4096;

  void reset() noexcept {
    tickCount_ = 0;
    frameCount_ = 0;
    evBegin_ = 0;
    evEnd_ = 0;
    zRun_ = 0;
  }

  // One tick: the 4 fe frame fluxes of each band (band-major), band_db, rms_db and lvl, as the
  // front end stores them (binary16 values).
  void pushTick(const float flux[3][4], const float bandDb[3], float rmsDb,
                const float lvl[3]) noexcept {
    G2Tick &k = ticks_[tickCount_ & (kTickRing - 1)];
    for (int b = 0; b < 3; ++b) {
      k.flux[b] = (((flux[b][0] + flux[b][1]) + flux[b][2]) + flux[b][3]) / 4.0f;
      const float l = bandDb[b] / 10.0f + g2_tables::kFeLogeC[b];
      k.loge[b] = l < kLogeFloor ? kLogeFloor : l;
      k.lvl[b] = lvl[b];
    }
    k.rms = rmsDb;
    k.loud = k.loge[0] > kSilentLoge || k.loge[1] > kSilentLoge || k.loge[2] > kSilentLoge;
    zRun_ = rmsDb < -70.0f ? zRun_ + 1 : 0;
    k.silent = zRun_ >= 24;
    ++tickCount_;
  }

  // One chroma frame: the 12 binary16-rounded log10 values (G2Chroma::chroma()).
  void addChromaFrame(const double values[12]) noexcept {
    G2ChromaFrame &f = frames_[frameCount_ & (kChromaRing - 1)];
    double mx = values[0];
    for (int c = 1; c < 12; ++c)
      mx = values[c] > mx ? values[c] : mx;
    if (mx < -8.0) {
      for (double &v : f.v)
        v = std::nan("");
      f.ok = false;
    } else {
      double p[12];
      double s = 0.0;
      for (int c = 0; c < 12; ++c) {
        p[c] = rhythm_d::portableDecadePower(values[c] - mx);
        s += p[c] * p[c];
      }
      const double norm = std::sqrt(s);
      for (int c = 0; c < 12; ++c)
        f.v[c] = p[c] / norm;
      f.ok = true;
    }
    ++frameCount_;
  }

  // One event (fe ev_t, ev_band, ev_strength) in arrival order; kept sorted by time, ties in
  // arrival order. Arrival lags the event time by <= .0101 s, so the insert point stays after every
  // event a consumer has already read (consumers read events up to t - .05). A full ring drops its
  // oldest event.
  void pushEvent(double t, int band, float strength) noexcept {
    if (evEnd_ - evBegin_ == kEventRing)
      ++evBegin_;
    std::int64_t i = evEnd_;
    while (i > evBegin_ && events_[(i - 1) & (kEventRing - 1)].t > t) {
      events_[i & (kEventRing - 1)] = events_[(i - 1) & (kEventRing - 1)];
      --i;
    }
    events_[i & (kEventRing - 1)] = {t, strength, static_cast<std::uint8_t>(band)};
    ++evEnd_;
  }

  [[nodiscard]] std::int64_t ticks() const noexcept { return tickCount_; }
  // Valid for ticks() - kTickRing <= k < ticks().
  [[nodiscard]] const G2Tick &tick(std::int64_t k) const noexcept {
    return ticks_[k & (kTickRing - 1)];
  }
  [[nodiscard]] std::int64_t chromaFrames() const noexcept { return frameCount_; }
  // Valid for chromaFrames() - kChromaRing <= j < chromaFrames().
  [[nodiscard]] const G2ChromaFrame &chroma(std::int64_t j) const noexcept {
    return frames_[j & (kChromaRing - 1)];
  }
  [[nodiscard]] std::int64_t eventBegin() const noexcept { return evBegin_; }
  [[nodiscard]] std::int64_t eventEnd() const noexcept { return evEnd_; }
  [[nodiscard]] const G2Event &event(std::int64_t i) const noexcept {
    return events_[i & (kEventRing - 1)];
  }

  // First index in [eventBegin(), eventEnd()) whose time exceeds t (numpy searchsorted 'right').
  [[nodiscard]] std::int64_t upperBound(double t) const noexcept {
    std::int64_t lo = evBegin_, hi = evEnd_;
    while (lo < hi) {
      const std::int64_t mid = lo + (hi - lo) / 2;
      if (event(mid).t > t)
        hi = mid;
      else
        lo = mid + 1;
    }
    return lo;
  }

private:
  static constexpr float kLogeFloor = static_cast<float>(g2_tables::kLogeFloor);
  static constexpr float kSilentLoge = static_cast<float>(g2_tables::kSilentLoge);

  G2Tick ticks_[kTickRing] = {};
  G2ChromaFrame frames_[kChromaRing] = {};
  G2Event events_[kEventRing] = {};
  std::int64_t tickCount_ = 0;
  std::int64_t frameCount_ = 0;
  std::int64_t evBegin_ = 0;
  std::int64_t evEnd_ = 0;
  int zRun_ = 0;
};

} // namespace effetune::plugins::analyzer::rhythm_a3

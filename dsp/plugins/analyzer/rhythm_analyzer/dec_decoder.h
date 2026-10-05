// The A3 decoder as a streaming, real-time-safe object under the frozen configuration (forward
// mode, prior init, gamma .5, pi .95, confirm 1.0 with confirm lock, stride 2, stand-in Z, G2
// reweighting at kappa = .5 / W, gap/novelty banks with beta 0 and a 15 s bank limit, IMM clock
// with noise modes, event measurements with ai, the level layer with its prior and Bayesian reseed,
// and the existence gate). All storage is inline; nothing allocates, throws or locks after
// construction. Every queue has a fixed capacity and a counted, deterministic overflow (state()).
#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>

#include "dec_clock.h"
#include "dec_const.h"
#include "dec_exist.h"
#include "dec_lattice.h"
#include "dec_level.h"
#include "dec_math.h"
#include "dec_tdprior.h"

namespace effetune::plugins::analyzer::rhythm_a3::dec {

// Capacities. The activation ring holds kActRing rows; pushActivation stays at most kActAhead rows
// ahead of the lattice, so every row at or after k_next - kLcHist is still held.
inline constexpr int32_t kActRing = 256;
inline constexpr int64_t kActAhead = 64;
inline constexpr int64_t kLcHist = kActRing - kActAhead;
inline constexpr int32_t kEvQueue = 16;   // due-event queue (<= 3 waiting on the evaluation audio)
inline constexpr int32_t kUsedHist = 320; // used events for the seed replay (<= 72 within w_ev)
inline constexpr int32_t kG2Queue = 4;    // G2 rows (<= 1 waiting)
inline constexpr int32_t kHookQueue = 4;  // outstanding hook requests and undelivered results
inline constexpr int32_t kHookSpawns = 4; // G2Boundary::kMaxNew
inline constexpr int32_t kHookHazards = 32;  // G2Boundary::kMaxOpen (<= 12)
inline constexpr int32_t kSpawnFifo = 4;     // spawns waiting while a bank catches up
inline constexpr int32_t kClickLoopCap = 16; // click-loop iterations per tick (<= 2)
inline constexpr int32_t kOutClicks = 4;
inline constexpr int32_t kOutEvents = 16;
inline constexpr int32_t kOutSegments = 4;
inline constexpr int32_t kOutSpawns = 8;
// Tempo map (tempoMap): bins of 1/48 octave from 30 BPM, smoothed by a Gaussian of 1.5 bins.
inline constexpr int32_t kMapBins = 192;
inline constexpr int32_t kMapRad = 5;
inline constexpr double kMapSigma = 1.5;

// Segment kinds (a3 kinds keys).
enum DecKind : int32_t {
  kKindLock,
  kKindBank,
  kKindRephase,
  kKindRelevel,
  kKindLevel,
  kKindLphase,
  kKindCount
};

struct DecSetup {
  double t0a;          // activation grid t0 (kTcnT0)
  double lata;         // activation latency (kTcnLatency)
  double t0_fe;        // front-end grid t0 (TcFrontEnd::gridT0())
  double lat_fe;       // front-end latency (TcFrontEnd::gridLatency())
  float prior[3];      // activation class prior (kTcnPrior)
  double W;            // G2 'W' (G2Engine::kW)
  float g2Prior[3];    // G2 'prior' (G2Engine::kPrior)
  int64_t actEnd = -1; // replay only: K for the high clip of the event row; -1 = live stream
  int32_t bankStepsPerQuantum =
      0; // 0: bank catch-up inline (frozen); B > 0: at most B steps per quantum
  double minBpm =
      40.0; // tempo range (BPM): lattice states outside carry no mass, output relations must fit
  double maxBpm = 240.0;
};

struct DecHookRequest {
  bool valid;
  uint32_t call;
  double t;
  bool committed;
};

struct DecFrame {
  double tIn;
  bool locked;
  int64_t epoch;
  double period; // T * q if committed, else 0
  double post;
  double own;
  double stability;
  double pNew;
  int32_t tempoIdx;
  bool z;
  double levelQ;
};

// The live clock for the kernel's telemetry: the frame fields as writeFrame() would write them now,
// and the next output beat (level position u) with its running count (continuous within an epoch).
struct DecClockView {
  bool locked;
  int64_t epoch;
  double period; // T * q if committed, else 0
  double post;
  bool hasNext;  // committed with a running clock
  double next;   // time of the next output beat (s)
  int64_t index; // output beats passed before it
};

struct DecSegment {
  int64_t epoch;
  double tIn;
  double period;
  int32_t kind; // DecKind
};

// A bank record: type 0 opened (time = open, llr = llr_open), 1 adopted, 2 dropped.
struct DecSpawnRec {
  int32_t type;
  int32_t id;
  double spawnT;
  int32_t kind; // 0 novelty, 1 gap (G2Boundary convention)
  double open;
  double llrOpen;
  double time;
  double llr;
  double h;
};

struct DecTickOut {
  bool hasFrame;
  DecFrame frame;
  int32_t nClicks;
  double clicks[kOutClicks];
  int32_t nCands;
  double cands[kOutClicks];
  int32_t nEvents;
  double evT[kOutEvents];
  int32_t evBand[kOutEvents];
  int32_t nSegments;
  DecSegment segments[kOutSegments];
  int32_t nSpawns;
  DecSpawnRec spawns[kOutSpawns];
  bool hasJudge;
  DecExistJudge judge;
  bool hasReset;
  double resetT;
  int64_t resetN;
  int64_t resetNc;
};

enum DecBankState : int32_t { kBankNone, kBankCatching, kBankOpen };

struct DecState {
  int64_t n;     // ticks run
  int64_t kNext; // activation rows consumed
  bool committed;
  int64_t epoch;
  int64_t kinds[kKindCount];
  int32_t
      kindOrder[kKindCount]; // first-occurrence order (a3 dict order); kindOrderCount valid entries
  int32_t kindOrderCount;
  int64_t late;    // Exist late events
  double modes[2]; // clock marg(True)
  // op counters for meta.cpu
  int64_t opsFwd, opsRot, opsBank, opsG2, opsClock, opsLevel, opsExist;
  // overflow and deviation counters (0 on a faithful replay)
  int64_t evDropped, usedDropped, existDropped, g2Dropped, hookDropped, spawnDropped, outDropped,
      clickCapped, switchCapped, ringClamp, actLate;
  // bank catch-up: banks started, max ticks from start to opening, max rows behind at start
  int64_t catchCount, catchMaxTicks, catchMaxRows;
  int32_t bankState; // DecBankState
  int32_t fifoCount;
  uint32_t hookCalls;
  int64_t tdStale; // TD prior lookups whose row was no longer held
};

class DecDecoder {
public:
  struct BeatSink {
    void *context = nullptr;
    void (*beat)(void *, double time, int64_t epoch, int64_t index, double period) = nullptr;
  };
  BeatSink beatSink;
  // Development observer (equivalence driver; null in the plugin): every output beat of the level
  // layer, and whether it would be shown (an a3 master click).
  struct MasterProbe {
    void *context = nullptr;
    void (*beat)(void *, double time, bool shown) = nullptr;
  };
  MasterProbe masterProbe;

  DecDecoder() noexcept {
    initMap();
    reset(defaultSetup());
  }
  DecDecoder(const DecDecoder &) = delete;
  DecDecoder &operator=(const DecDecoder &) = delete;

  // New stream. Returns false (and keeps a usable default state) when the setup does not match the
  // generated constants (activation prior, G2 prior, W).
  bool reset(const DecSetup &s) noexcept {
    bool ok = true;
    for (int32_t c = 0; c < 3; ++c)
      ok = ok && s.prior[c] == kActPrior[c] && s.g2Prior[c] == kG2Prior[c];
    ok = ok && s.W == kG2W && s.bankStepsPerQuantum >= 0;
    const BinRange bins = tempoBins(s.minBpm, s.maxBpm);
    ok = ok && bins.begin < bins.end;
    setup_ = ok ? s : defaultSetup();
    bins_ = tempoBins(setup_.minBpm, setup_.maxBpm);
    masked_ = bins_.begin > 0 || bins_.end < kN;
    kappa_ = .5 / setup_.W;
    kappaF_ = static_cast<float>(kappa_);
    pb_ = static_cast<double>(setup_.prior[0]);
    alpha_ = bufA_;
    bankA_ = bufB_;
    initLattice(alpha_);
    clock_.reset();
    exist_.init();
    level_.init(kappa_);
    n_ = 0;
    rowsPushed_ = 0;
    kNext_ = 0;
    t_ = 0.0;
    tau_ = setup_.t0a - kDt;
    tAct_ = 0.0;
    quiet_ = 0;
    z_ = false;
    committed_ = false;
    epoch_ = 0;
    bankPending_ = false;
    newSongT_ = -std::numeric_limits<double>::infinity();
    post_ = own_ = pNew_ = 0.0;
    beats_ = 0;
    shownCur_ = 0;
    shownU_ = 0;
    shownPend_ = {false, 0.0, 0};
    outLast_ = -std::numeric_limits<double>::infinity();
    td_.reset();
    tdBase_ = 0;
    tdBaseAct_ = tdBaseT_ = 0.0;
    tdStale_ = 0;
    swOn_ = false;
    swT0_ = swRef_ = 0.0;
    swT_ = 1.0;
    swBin_ = swB0_ = swB1_ = 0;
    hookT_ = kHookDt;
    evCount_ = usedHead_ = usedCount_ = g2Head_ = g2Count_ = 0;
    reqHead_ = reqCount_ = resHead_ = resCount_ = fifoHead_ = fifoCount_ = 0;
    hookCalls_ = 0;
    bankState_ = kBankNone;
    std::memset(&bank_, 0, sizeof(bank_));
    for (int32_t k = 0; k < kKindCount; ++k)
      kinds_[k] = 0;
    kindOrderCount_ = 0;
    opsFwd_ = opsRot_ = opsBank_ = opsG2_ = 0;
    evDropped_ = usedDropped_ = g2Dropped_ = hookDropped_ = spawnDropped_ = outDropped_ =
        clickCapped_ = 0;
    ringClamp_ = actLate_ = 0;
    catchCount_ = catchMaxTicks_ = catchMaxRows_ = catchStartN_ = 0;
    std::memset(&out_, 0, sizeof(out_));
    return ok;
  }

  // TcTick.act (raw softmax) of the next activation row; false when the row is more than kActAhead
  // rows ahead of the lattice (retry later).
  bool pushActivation(const float act[3]) noexcept {
    if (rowsPushed_ - kNext_ >= kActAhead)
      return false;
    Row &r = ring_[rowsPushed_ & (kActRing - 1)];
    for (int32_t c = 0; c < 3; ++c) {
      r.act[c] = act[c];
      const float fl = act[c] > kActFloorF ? act[c] : kActFloorF; // np.maximum
      r.ratio[c] = std::sqrt(fl / setup_.prior[c]);               // (act / prior) ** f32(.5), f32
      r.lnratio[c] = portableLog(static_cast<double>(r.ratio[c]));
    }
    r.z = false;
    r.lc = r.lcb = 0.0;
    ++rowsPushed_;
    return true;
  }

  // TcEvent t, band, avail. False when the queue was full (the largest key is dropped and counted).
  bool pushEvent(double evT, int32_t band, double evAvail) noexcept {
    if (band < 0 || band > 2) {
      ++evDropped_;
      return false;
    }
    Ev e;
    e.evT = evT;
    e.band = band;
    e.b = evT - kEvBeta[band];
    double kd = rintEven((e.b - setup_.t0a) / kDt);
    if (setup_.actEnd >= 0 && kd > static_cast<double>(setup_.actEnd - 1))
      kd = static_cast<double>(setup_.actEnd - 1);
    if (kd < 0.0)
      kd = 0.0;
    e.k = static_cast<int64_t>(kd);
    const double s2 = (setup_.t0a + kd * kDt) + setup_.lata;
    e.stamp = evAvail >= s2 ? evAvail : s2; // np.maximum
    int32_t pos = evCount_;
    if (evCount_ == kEvQueue) {
      ++evDropped_;
      if (!evLess(e, evq_[kEvQueue - 1]))
        return false;
      pos = kEvQueue - 1; // the largest queued key is dropped
    } else {
      ++evCount_;
    }
    while (pos > 0 && evLess(e, evq_[pos - 1])) {
      evq_[pos] = evq_[pos - 1];
      --pos;
    }
    evq_[pos] = e;
    return pos != kEvQueue;
  }

  // A G2Update row (t, count, period[], ref[], p[][3]); false when the queue was full (row dropped,
  // counted).
  template <class Update> bool pushG2(const Update &u) noexcept {
    if (g2Count_ == kG2Queue) {
      ++g2Dropped_;
      return false;
    }
    G2Row &r = g2q_[(g2Head_ + g2Count_) % kG2Queue];
    const int32_t cnt = static_cast<int32_t>(u.count);
    r.count = cnt < 0 ? 0 : (cnt > kG2Slots ? kG2Slots : cnt);
    r.t = u.t;
    for (int32_t c = 0; c < r.count; ++c) {
      r.period[c] = u.period[c];
      r.ref[c] = u.ref[c];
      for (int32_t k = 0; k < 3; ++k)
        r.p[c][k] = u.p[c][k];
    }
    ++g2Count_;
    return true;
  }

  // A ready TD prior row (TdpPrior::grid()) of the prior's start at front-end tick `base` (its
  // reset or last restart), in effect from s seconds of ticks after that start.
  void pushPrior(int64_t base, double s, const float *grid) noexcept { td_.push(base, s, grid); }

  // Before the tick at which the front end's prior restarted: its rows start afresh, timed from
  // this tick (until the first of them, the shown output decides on the level mass alone).
  void restartPrior() noexcept {
    tdBase_ = n_;
    tdBaseAct_ = tAct_;
    tdBaseT_ = static_cast<double>(n_) * kDt;
  }

  // Steps 1-7a of tick n; returns the hook request of this tick, if any. coldReset: the front end's
  // long-silence fire at this tick; quiet: the tick's RelativeQuiet bit.
  DecHookRequest tickBegin(bool quiet, bool coldReset) noexcept {
    tickFront(quiet, coldReset);
    return tickMid();
  }

  // Steps 1-5 of tick n. Leveled schedule: tickFront in the tick's quantum, tickMid, the hook
  // deliveries and tickEnd in the next quantum; out() then holds the records of both calls.
  void tickFront(bool quiet, bool coldReset) noexcept {
    std::memset(&out_, 0, sizeof(out_));
    t_ = (setup_.t0_fe + static_cast<double>(n_) * kDt) + setup_.lat_fe;
    // 2. stand-in Z
    quiet_ = quiet ? quiet_ + 1 : 0;
    z_ = quiet_ >= kZTicks;
    if (coldReset)
      restartCold();
    // 3. Exist judge
    if (exist_.due(t_)) {
      double r[2];
      clock_.marg(true, r);
      exist_.judge(r, n_, out_.judge);
      out_.hasJudge = true;
    }
    // 4. level-layer click loop
    if (clock_.on)
      clickLoop();
    // 5. due activations
    consumeActivations();
  }

  // Steps 6-7a of tick n; returns the hook request of this tick, if any.
  DecHookRequest tickMid() noexcept {
    // 6. due G2 rows
    consumeG2();
    // 7a. hook request
    DecHookRequest req{false, 0u, 0.0, false};
    if (t_ + kEpsT >= hookT_) {
      req = {true, hookCalls_, hookT_, committed_};
      if (reqCount_ == kHookQueue) { // abandon the oldest outstanding request
        reqHead_ = (reqHead_ + 1) % kHookQueue;
        --reqCount_;
        ++hookDropped_;
      }
      Req &q = reqs_[(reqHead_ + reqCount_) % kHookQueue];
      q.call = hookCalls_;
      q.kReq = kNext_;
      ++reqCount_;
      ++hookCalls_;
      hookT_ += kHookDt;
    }
    return req;
  }

  // A G2Boundary::Result (newCount, spawns[].{id,t,gap}, rowCount, rows[].{id,h}) answering request
  // `call`. Accepted only for the oldest outstanding call; applied at the next tickEnd.
  template <class Boundary> bool pushHookResult(uint32_t call, const Boundary &b) noexcept {
    if (reqCount_ == 0 || reqs_[reqHead_].call != call || resCount_ == kHookQueue) {
      ++hookDropped_;
      return false;
    }
    Res &r = res_[(resHead_ + resCount_) % kHookQueue];
    r.kReq = reqs_[reqHead_].kReq;
    reqHead_ = (reqHead_ + 1) % kHookQueue;
    --reqCount_;
    const int32_t ns = static_cast<int32_t>(b.newCount);
    r.spawnCount = ns < 0 ? 0 : (ns > kHookSpawns ? kHookSpawns : ns);
    if (ns > kHookSpawns)
      spawnDropped_ += ns - kHookSpawns;
    for (int32_t i = 0; i < r.spawnCount; ++i) {
      r.spawns[i].id = static_cast<int32_t>(b.spawns[i].id);
      r.spawns[i].t = static_cast<double>(b.spawns[i].t);
      r.spawns[i].kind = b.spawns[i].gap ? 1 : 0;
    }
    const int32_t nh = static_cast<int32_t>(b.rowCount);
    r.hazardCount = nh < 0 ? 0 : (nh > kHookHazards ? kHookHazards : nh);
    if (nh > kHookHazards)
      hookDropped_ += nh - kHookHazards;
    for (int32_t i = 0; i < r.hazardCount; ++i) {
      r.hazard[i].id = static_cast<int32_t>(b.rows[i].id);
      r.hazard[i].h = static_cast<double>(b.rows[i].h);
    }
    ++resCount_;
    return true;
  }

  // Steps 7b-10 of tick n.
  void tickEnd() noexcept {
    applyHookResults();
    runBanks(true);
    commitStep();
    consumeEvents();
    if (n_ % kStride == 0) {
      const int32_t bin = kBlk[argmaxFirst(alpha_, kS)];
      if (committed_ && shadowFrame(combBin()))
        ++epoch_;
      writeFrame(bin);
    }
    ++n_;
  }

  // A quantum without a decoder tick: bank catch-up only (B > 0).
  void service() noexcept {
    std::memset(&out_, 0, sizeof(out_));
    if (setup_.bankStepsPerQuantum > 0)
      runBanks(false);
  }

  [[nodiscard]] const DecTickOut &out() const noexcept { return out_; }

  // Read-only; changes no state.
  [[nodiscard]] DecClockView clockView() const noexcept {
    DecClockView v{};
    double a = 0.0, T = 0.0;
    if (clock_.on)
      clock_.comb(a, T);
    v.locked = committed_ && !z_ && exist_.shown;
    v.epoch = epoch_;
    v.period = committed_ ? T * shownQ() : 0.0;
    v.post = post_;
    v.hasNext = committed_ && clock_.on;
    v.next = v.hasNext ? level_.time(shownU_, a, T) : 0.0;
    v.index = beats_;
    return v;
  }

  [[nodiscard]] DecState state() const noexcept {
    DecState s;
    s.n = n_;
    s.kNext = kNext_;
    s.committed = committed_;
    s.epoch = epoch_;
    for (int32_t k = 0; k < kKindCount; ++k) {
      s.kinds[k] = kinds_[k];
      s.kindOrder[k] = kindOrder_[k];
    }
    s.kindOrderCount = kindOrderCount_;
    s.late = exist_.late;
    clock_.marg(true, s.modes);
    s.opsFwd = opsFwd_;
    s.opsRot = opsRot_;
    s.opsBank = opsBank_;
    s.opsG2 = opsG2_;
    s.opsClock = clock_.ops;
    s.opsLevel = level_.ops;
    s.opsExist = exist_.ops;
    s.evDropped = evDropped_;
    s.usedDropped = usedDropped_;
    s.existDropped = exist_.dropped;
    s.g2Dropped = g2Dropped_;
    s.hookDropped = hookDropped_;
    s.spawnDropped = spawnDropped_;
    s.outDropped = outDropped_;
    s.clickCapped = clickCapped_;
    s.switchCapped = level_.switchCapped;
    s.ringClamp = ringClamp_;
    s.actLate = actLate_;
    s.catchCount = catchCount_;
    s.catchMaxTicks = catchMaxTicks_;
    s.catchMaxRows = catchMaxRows_;
    s.bankState = bankState_;
    s.fifoCount = fifoCount_;
    s.hookCalls = hookCalls_;
    s.tdStale = tdStale_;
    return s;
  }

  // The tempo map shown in place of the onset tempogram, into kMapBins values: the lattice's tempo
  // marginal (the bank mix while a bank is open) placed at the tempo of every level group, weighted
  // 1 at the shown group and, once committed with a prior row, by the TD prior at each other
  // group's tempo relative to the shown group's (at most 1); smoothed, peak-normalised and
  // square-rooted for display. Returns the BPM at the peak bin's center. Read-only.
  double tempoMap(float *map) const noexcept {
    float m[kN];
    const bool open = bankState_ == kBankOpen;
    const float wb = open ? static_cast<float>(pNew_) : 0.f, wa = 1.f - wb;
    for (int32_t j = 0; j < kN; ++j) {
      const float *a = alpha_ + kOff[j];
      float s = 0.f;
      for (int32_t p = 0; p < kP[j]; ++p)
        s += a[p];
      if (open) {
        const float *b = bankA_ + kOff[j];
        float sb = 0.f;
        for (int32_t p = 0; p < kP[j]; ++p)
          sb += b[p];
        s = wa * s + wb * sb;
      }
      m[j] = s;
    }
    const int32_t gs = kLvGrp[shownCur_];
    float w[kLvG];
    for (int32_t g = 0; g < kLvG; ++g)
      w[g] = g == gs ? 1.f : 0.f;
    if (committed_ && clock_.on) {
      double a, T;
      clock_.comb(a, T);
      int64_t stale = 0; // a local count: the lookup must not change the decoder's state
      const DecTdRow *r = td_.at(tdBase_, tAct_ - tdBaseAct_, stale);
      if (r != nullptr && T > 0.0) {
        const double x = portableLog(60.0 / T), ls = DecTdPrior::lnp(*r, x - kLvLogNd[gs]);
        for (int32_t g = 0; g < kLvG; ++g)
          if (g != gs) {
            const double d = DecTdPrior::lnp(*r, x - kLvLogNd[g]) - ls;
            w[g] = d < 0.0 ? static_cast<float>(portableExp(d)) : 1.f;
          }
      }
    }
    float raw[kMapBins];
    for (int32_t i = 0; i < kMapBins; ++i) {
      float v = 0.f;
      for (int32_t g = 0; g < kLvG; ++g) {
        const int32_t j = mapJ_[g][i];
        if (w[g] > 0.f && j >= 0)
          v += w[g] * (m[j] + mapF_[g][i] * (m[j + 1] - m[j]));
      }
      raw[i] = v;
    }
    float peak = 0.f;
    int32_t top = 0;
    for (int32_t i = 0; i < kMapBins; ++i) {
      const int32_t q0 = i < kMapRad ? kMapRad - i : 0;
      const int32_t q1 = i + kMapRad >= kMapBins ? kMapRad + (kMapBins - 1 - i) : 2 * kMapRad;
      float s = 0.f;
      for (int32_t q = q0; q <= q1; ++q)
        s += mapK_[q] * raw[i - kMapRad + q];
      map[i] = s;
      if (s > peak) {
        peak = s;
        top = i;
      }
    }
    const float inv = peak > 0.f ? 1.f / peak : 0.f;
    for (int32_t i = 0; i < kMapBins; ++i)
      map[i] = std::sqrt(map[i] * inv);
    return 30.0 * portableExp((top + .5) / 48.0 * kLn2);
  }

private:
  struct Row {
    float act[3];
    float ratio[3];
    double lnratio[3];
    double lc;
    double lcb;
    bool z;
  };
  struct Ev {
    double stamp;
    double evT;
    double b;
    int64_t k;
    int32_t band;
  };
  struct UsedEv {
    double t;
    double b;
    double lr;
    int32_t band;
  };
  struct G2Row {
    double t;
    int32_t count;
    float period[kG2Slots];
    double ref[kG2Slots];
    float p[kG2Slots][3];
  };
  struct Req {
    uint32_t call;
    int64_t kReq;
  };
  struct SpawnIn {
    int32_t id;
    double t;
    int32_t kind;
  };
  struct HazardIn {
    int32_t id;
    double h;
  };
  struct Res {
    int64_t kReq;
    int32_t spawnCount;
    SpawnIn spawns[kHookSpawns];
    int32_t hazardCount;
    HazardIn hazard[kHookHazards];
  };
  struct Pending {
    int32_t id;
    double t;
    int32_t kind;
    int64_t kReq;
    double h;
  };
  struct Bank {
    int32_t id;
    double t0; // spawn time
    int32_t kind;
    int64_t k0;
    int64_t k; // next row to forward while catching up
    double L;
    double LS;
    double h;
    double open;
    double llrOpen;
  };

  static DecSetup defaultSetup() noexcept {
    DecSetup s{};
    s.t0a = -kDt;
    s.lata = 2.0 * kDt;
    s.t0_fe = 0.0;
    s.lat_fe = kDt;
    for (int32_t c = 0; c < 3; ++c) {
      s.prior[c] = kActPrior[c];
      s.g2Prior[c] = kG2Prior[c];
    }
    s.W = kG2W;
    s.actEnd = -1;
    s.bankStepsPerQuantum = 0;
    return s;
  }

  // Tempo bins whose tempo lies in [lo, hi] (bins ascend in period).
  static BinRange tempoBins(double lo, double hi) noexcept {
    int32_t b = 0;
    while (b < kN && latticeBpm(b) > hi)
      ++b;
    int32_t e = b;
    while (e < kN && latticeBpm(e) >= lo)
      ++e;
    return {b, e};
  }

  // Zero the states outside the tempo range.
  void mask(float *a) const noexcept {
    std::memset(a, 0, sizeof(float) * static_cast<size_t>(kOff[bins_.begin]));
    if (bins_.end < kN)
      std::memset(a + kOff[bins_.end], 0,
                  sizeof(float) * static_cast<size_t>(kS - kOff[bins_.end]));
  }

  // The lattice prior, restricted to the tempo range.
  void initLattice(float *a) const noexcept {
    std::memcpy(a, kInit, sizeof(float) * kS);
    if (masked_) {
      mask(a);
      normalise(a);
    }
  }

  static bool evLess(const Ev &a, const Ev &b) noexcept {
    if (a.stamp != b.stamp)
      return a.stamp < b.stamp;
    if (a.evT != b.evT)
      return a.evT < b.evT;
    return a.band < b.band;
  }

  static double logit(double h) noexcept {
    h = h < 1e-6 ? 1e-6 : (h > 1.0 - 1e-6 ? 1.0 - 1e-6 : h);
    return portableLog(h / (1.0 - h));
  }

  Row &row(int64_t k) noexcept { return ring_[k & (kActRing - 1)]; }

  void countKind(int32_t kind) noexcept {
    if (kinds_[kind] == 0)
      kindOrder_[kindOrderCount_++] = kind;
    ++kinds_[kind];
  }

  void emitSegment(int32_t kind, double period) noexcept {
    if (out_.nSegments == kOutSegments) {
      ++outDropped_;
      return;
    }
    out_.segments[out_.nSegments++] = {epoch_, t_, period, kind};
  }

  void emitSpawn(int32_t type, double time, double llr) noexcept {
    if (out_.nSpawns == kOutSpawns) {
      ++outDropped_;
      return;
    }
    DecSpawnRec &r = out_.spawns[out_.nSpawns++];
    r.type = type;
    r.id = bank_.id;
    r.spawnT = bank_.t0;
    r.kind = bank_.kind;
    r.open = bank_.open;
    r.llrOpen = bank_.llrOpen;
    r.time = time;
    r.llr = llr;
    r.h = bank_.h;
  }

  // f32 normalisation of a lattice vector: a /= f32(sum f64); returns the f64 sum.
  static double normalise(float *a) noexcept {
    const double c = pairwiseSum(a, kS);
    const float cf = static_cast<float>(c);
    for (int32_t s = 0; s < kS; ++s)
      a[s] /= cf;
    return c;
  }

  // One forward step of vector a over activation row r (predict, ratio, normalise); returns log c.
  double forward(float *a, const Row &r) noexcept {
    latticePredict(a, scratch_);
    if (masked_)
      mask(a);
    for (int32_t s = 0; s < kS; ++s)
      a[s] *= r.ratio[kCls[s]];
    return portableLog(normalise(a));
  }

  // One bank step over row k (a3 open_bank loop body and the step-5 bank forward).
  void bankStep(int64_t k) noexcept {
    Row &r = row(k);
    if (r.z) {
      latticeRotate(bankA_, scratch_);
      r.lcb = 0.0;
      ++opsRot_;
    } else {
      r.lcb = forward(bankA_, r);
      bank_.L += r.lcb;
      bank_.LS += r.lc;
      ++opsBank_;
    }
  }

  // 4.
  void clickLoop() noexcept {
    for (int32_t it = 0;; ++it) {
      if (it == kClickLoopCap) {
        ++clickCapped_;
        return;
      }
      double a, T;
      clock_.comb(a, T);
      if (level_.u <= static_cast<int64_t>(kLvU) * level_.n) {
        const double tu = level_.time(level_.u, a, T);
        if (tu <= t_) {
          if (masterProbe.beat != nullptr)
            masterProbe.beat(masterProbe.context, tu, committed_ && !z_ && exist_.shown);
          level_.last = tu;
          level_.u += kLvQ12[level_.cur];
          continue;
        }
      }
      if (shownU_ <= static_cast<int64_t>(kLvU) * level_.n) {
        const double tu = level_.time(shownU_, a, T);
        if (tu <= t_) {
          outputBeat(tu);
          shownU_ += kLvQ12[shownCur_];
          continue;
        }
      }
      if (a > t_)
        return;
      exist_.cross(a, clock_.varA(a), !z_);
      clock_.beat();
      ++level_.n;
    }
  }

  // An output beat at time tu.
  void outputBeat(double tu) noexcept {
    if (committed_ && !z_) {
      if (out_.nCands < kOutClicks)
        out_.cands[out_.nCands++] = tu;
      else
        ++outDropped_;
      if (exist_.show()) {
        if (beatSink.beat != nullptr)
          beatSink.beat(beatSink.context, tu, epoch_, beats_, clockView().period);
        if (out_.nClicks < kOutClicks)
          out_.clicks[out_.nClicks++] = tu;
        else
          ++outDropped_;
      }
    }
    outLast_ = tu;
    ++beats_;
  }

  // The shown output's level.
  [[nodiscard]] double shownQ() const noexcept { return DecLevel::qOf(shownCur_); }

  // Whether level group g's nominal output tempo lies in the tempo range at every lattice tempo bin
  // of [b, e) (x1's always does).
  [[nodiscard]] bool inRange(int32_t g, int32_t b, int32_t e) const noexcept {
    if (g == 0)
      return true;
    for (int32_t j = b; j < e; ++j) {
      const double x = (latticeBpm(j) * kLvD[g]) / kLvN[g];
      if (!(x >= setup_.minBpm && x <= setup_.maxBpm))
        return false;
    }
    return true;
  }

  // Lattice tempo bin of the clock's comb period. The shown period is a level of this period, so
  // the tempo range check must use it rather than the lattice's best bin.
  [[nodiscard]] int32_t combBin() const noexcept {
    double a, T;
    clock_.comb(a, T);
    return latticeNearest(T / kDt);
  }

  // The levels whose nominal output tempo lies in the tempo range at lattice tempo bin `bin`.
  void admissible(int32_t bin, bool *allowed) const noexcept {
    for (int32_t g = 0; g < kLvG; ++g)
      allowed[g] = inRange(g, bin, bin + 1);
  }

  // 5.
  void consumeActivations() noexcept {
    while ((setup_.t0a + static_cast<double>(kNext_) * kDt) + setup_.lata <= t_ + kEpsT) {
      if (setup_.actEnd >= 0 && kNext_ >= setup_.actEnd)
        return;
      if (kNext_ >= rowsPushed_) {
        ++actLate_;
        return;
      }
      tau_ = setup_.t0a + static_cast<double>(kNext_) * kDt;
      Row &r = row(kNext_);
      r.z = z_;
      if (z_) {
        latticeRotate(alpha_, scratch_);
        r.lc = 0.0;
        ++opsRot_;
      } else {
        r.lc = forward(alpha_, r);
        ++opsFwd_;
        if (committed_) {
          double a, T;
          clock_.comb(a, T);
          level_.tick(r.lnratio, tau_, a, T);
        }
      }
      if (bankState_ == kBankOpen)
        bankStep(kNext_);
      ++kNext_;
      if (bankState_ == kBankOpen)
        bank_.k = kNext_;
    }
  }

  // 6.
  void consumeG2() noexcept {
    while (g2Count_ > 0 && g2q_[g2Head_].t <= t_ + kEpsT) {
      const G2Row &g = g2q_[g2Head_];
      if (!z_ && kNext_ > 0) {
        std::memset(lw_, 0, sizeof(lw_));
        const int32_t nph = g2Logw(g, tau_, kappaF_, lw_);
        if (nph) {
          float mx = lw_[0];
          for (int32_t s = 1; s < kS; ++s)
            mx = lw_[s] > mx ? lw_[s] : mx;
          for (int32_t s = 0; s < kS; ++s)
            lw_[s] = expF(lw_[s] - mx);
          for (int32_t s = 0; s < kS; ++s)
            alpha_[s] *= lw_[s];
          normalise(alpha_);
          if (bankState_ == kBankOpen) {
            for (int32_t s = 0; s < kS; ++s)
              bankA_[s] *= lw_[s];
            normalise(bankA_);
          }
        }
        opsG2_ += 3 * static_cast<int64_t>(kS) + 3 * static_cast<int64_t>(nph);
        if (committed_) {
          double a, T;
          clock_.comb(a, T);
          level_.update(g, a, T);
          shadowG2(tdRow(tAct_ - tdBaseAct_), a, T);
        }
      }
      g2Head_ = (g2Head_ + 1) % kG2Queue;
      --g2Count_;
    }
  }

  // 7b: delivered hook results, in order: spawns join the FIFO, then the hazard of the newest
  // entity.
  void applyHookResults() noexcept {
    while (resCount_ > 0) {
      const Res &r = res_[resHead_];
      for (int32_t i = 0; i < r.spawnCount; ++i) {
        if (fifoCount_ == kSpawnFifo) {
          ++spawnDropped_;
          continue;
        }
        Pending &p = fifo_[(fifoHead_ + fifoCount_) % kSpawnFifo];
        p.id = r.spawns[i].id;
        p.t = r.spawns[i].t;
        p.kind = r.spawns[i].kind;
        p.kReq = r.kReq;
        p.h = kBankH;
        ++fifoCount_;
      }
      int32_t id;
      double *hp;
      if (fifoCount_ > 0) {
        Pending &p = fifo_[(fifoHead_ + fifoCount_ - 1) % kSpawnFifo];
        id = p.id;
        hp = &p.h;
      } else if (bankState_ != kBankNone) {
        id = bank_.id;
        hp = &bank_.h;
      } else {
        hp = nullptr;
        id = 0;
      }
      if (hp != nullptr) {
        for (int32_t i = 0; i < r.hazardCount; ++i) {
          if (r.hazard[i].id == id) {
            *hp = r.hazard[i].h;
            break;
          }
        }
      }
      resHead_ = (resHead_ + 1) % kHookQueue;
      --resCount_;
    }
  }

  // Bank machine: catch-up under the quantum's budget, opening (tick quanta only), resolution of
  // the open bank by a waiting spawn, start of the next spawn.
  void runBanks(bool canOpen) noexcept {
    const int32_t B = setup_.bankStepsPerQuantum;
    int64_t budget = B > 0 ? B : std::numeric_limits<int64_t>::max();
    for (;;) {
      if (bankState_ == kBankCatching) {
        while (budget > 0 && bank_.k < kNext_) {
          bankStep(bank_.k);
          ++bank_.k;
          --budget;
        }
        if (bank_.k < kNext_ || !canOpen)
          return;
        bankState_ = kBankOpen;
        ++catchCount_;
        catchMaxTicks_ = n_ - catchStartN_ > catchMaxTicks_ ? n_ - catchStartN_ : catchMaxTicks_;
        bank_.open = t_;
        bank_.llrOpen = bank_.L - bank_.LS;
        emitSpawn(0, bank_.open, bank_.llrOpen);
      }
      if (fifoCount_ == 0 || !canOpen)
        return;
      if (bankState_ == kBankOpen) {
        if (((logit(bank_.h) + kBankBeta) + bank_.L) - bank_.LS > 0.0)
          adopt();
        else
          drop();
      }
      startBank(fifo_[fifoHead_]);
      fifoHead_ = (fifoHead_ + 1) % kSpawnFifo;
      --fifoCount_;
    }
  }

  void startBank(const Pending &p) noexcept {
    const double x = std::ceil(((p.t - setup_.lat_fe) - setup_.t0a) / kDt - 1e-9);
    int64_t k0 = static_cast<int64_t>(x);
    const int64_t kb = p.kReq - kRing;
    k0 = kb > k0 ? kb : k0;
    k0 = k0 < 0 ? 0 : k0;
    if (k0 < kNext_ - kLcHist) {
      k0 = kNext_ - kLcHist;
      ++ringClamp_;
    }
    bank_.id = p.id;
    bank_.t0 = p.t;
    bank_.kind = p.kind;
    bank_.k0 = k0;
    bank_.k = k0 < kNext_ ? k0 : kNext_;
    bank_.L = bank_.LS = 0.0;
    bank_.h = p.h;
    bank_.open = bank_.llrOpen = 0.0;
    initLattice(bankA_);
    bankState_ = kBankCatching;
    catchStartN_ = n_;
    catchMaxRows_ = kNext_ - bank_.k > catchMaxRows_ ? kNext_ - bank_.k : catchMaxRows_;
  }

  // Adopt at the current tick time.
  void adopt() noexcept {
    float *tmp = alpha_;
    alpha_ = bankA_;
    bankA_ = tmp;
    swOn_ = false;
    bankPending_ = true;
    newSongT_ = bank_.t0;
    level_.restart();
    shownPend_.on = false;
    clock_.renew();
    const int64_t lim = kNext_ - kLcHist;
    for (int64_t k = bank_.k0 > lim ? bank_.k0 : lim; k < kNext_; ++k) {
      Row &r = row(k);
      r.lc = r.lcb;
    }
    emitSpawn(1, t_, bank_.L - bank_.LS);
    bankState_ = kBankNone;
  }

  // Back to the state at load after a long silence; time, epoch, the silence run, op counts and the
  // input queues are kept.
  void restartCold() noexcept {
    initLattice(alpha_);
    const int64_t ops = clock_.ops;
    clock_.reset();
    clock_.ops = ops;
    committed_ = bankPending_ = swOn_ = false;
    if (bankState_ != kBankNone)
      drop();
    level_.restart();
    shownPend_.on = false;
    exist_.reset();
    out_.hasReset = true;
    out_.resetT = t_;
    out_.resetN = n_;
    out_.resetNc = exist_.nc;
    usedCount_ = 0;
    post_ = own_ = 0.0;
  }

  void drop() noexcept {
    emitSpawn(2, t_, bank_.L - bank_.LS);
    bankState_ = kBankNone;
  }

  // Confirm; on a confirmed target returns true with (bins, f).
  bool confirm(const float *mix, bool start, BinRange bins, int32_t i, double f, bool ownLow,
               BinRange &tb, double &tf) noexcept {
    if (swOn_ && ownLow) {
      const double fp = pyModOne((tau_ - swRef_) / swT_);
      const BinRange b{swB0_, swB1_};
      if (latticeMass(mix, b, fp) > .5) {
        if (((tAct_ - swT0_) + kEpsT) >= (kConfirm * swT_)) {
          tb = b;
          tf = fp;
          return true;
        }
        return false;
      }
    }
    swOn_ = false;
    if (!start)
      return false;
    const double T = static_cast<double>(kP[i]) * kDt;
    swOn_ = true;
    swT0_ = tAct_;
    swRef_ = tau_ - (f * T);
    swT_ = T;
    swBin_ = i;
    swB0_ = bins.begin;
    swB1_ = bins.end;
    return false;
  }

  // Seed.
  void seed(const float *mix, BinRange bins, double f, int32_t kind, double since,
            double wNew) noexcept {
    swOn_ = false;
    const Moments mo = latticeMoments(mix, bins, f, tau_, moments_);
    const double m = std::floor((t_ - mo.l) / mo.T) + 1.0;
    const double a = mo.l + m * mo.T;
    const double c00 = (mo.vl + (2.0 * m) * mo.c) + (m * m) * mo.vt;
    const double c01 = mo.c + m * mo.vt;
    const bool hadOld = clock_.on;
    double aO = 0.0, TO = 0.0, tOb = 0.0, tSb = 0.0, TSb = 0.0;
    if (hadOld) {
      clock_.comb(aO, TO);
      tOb = level_.time(level_.u, aO, TO);
      tSb = level_.time(shownU_, aO, TO);
      TSb = TO * shownQ();
    }
    clock_.seed(a, mo.T, c00, c01, mo.vt);
    // replay of the used events since lo, stable-sorted by |b - a|
    const double lo = pyMax(t_ - kWEv, since);
    int32_t nr = 0;
    for (int32_t q = 0; q < usedCount_; ++q) {
      const UsedEv &e = used_[(usedHead_ + q) % kUsedHist];
      if (e.t >= lo) {
        idx_[nr] = (usedHead_ + q) % kUsedHist;
        key_[idx_[nr]] = std::fabs(e.b - a);
        ++nr;
      }
    }
    stableSortByKey(nr);
    for (int32_t q = 0; q < nr; ++q) {
      const UsedEv &e = used_[idx_[q]];
      clock_.update(e.b, &kEvR[e.band * 2], kEvPD[e.band], kEvRho[e.band], e.lr);
    }
    clock_.settle();
    committed_ = true;
    countKind(kind);
    if (kind == kKindLock || kind == kKindBank) {
      exist_.reset();
      out_.hasReset = true;
      out_.resetT = t_;
      out_.resetN = n_;
      out_.resetNc = exist_.nc;
    }
    double aN, T;
    clock_.comb(aN, T);
    if (!hadOld)
      level_.reseed(true, T, aN, T, t_, aN, 0.0);
    else
      level_.reseed(kind == kKindLock || kind == kKindBank, TO, aN, T, t_, tOb, wNew);
    shadowFollow(tdRow(t_ - tdBaseT_), hadOld, aN, T, tSb);
    // One epoch and segment when the shown grid moved (its level, or its phase by at least a
    // quarter of a shown beat).
    const double Ts = T * shownQ();
    const double e = (level_.time(shownU_, aN, T) - tSb) / Ts;
    if (!hadOld || std::fabs(portableLog(Ts / TSb)) > kLevelTolG2 ||
        std::fabs(e - rintEven(e)) >= .25) {
      ++epoch_;
      emitSegment(kind, Ts);
    }
  }

  // tempoMap's tables: for level group g and map bin i, the lattice segment (j, j + 1) holding the
  // bin's center at that group's tempo and the fraction along it (j = -1 outside the lattice; the
  // lattice runs from 240 BPM at j = 0 down to 40 BPM); and the normalised Gaussian kernel.
  void initMap() noexcept {
    for (int32_t g = 0; g < kLvG; ++g) {
      double x[kN];
      for (int32_t j = 0; j < kN; ++j)
        x[j] = 48.0 * (portableLog(latticeBpm(j) * kLvD[g] / kLvN[g] / 30.0) / kLn2) - .5;
      for (int32_t i = 0; i < kMapBins; ++i) {
        mapJ_[g][i] = -1;
        mapF_[g][i] = 0.f;
        for (int32_t j = 0; j + 1 < kN; ++j)
          if (x[j] >= i && x[j + 1] <= i) {
            mapJ_[g][i] = static_cast<int16_t>(j);
            mapF_[g][i] = static_cast<float>((x[j] - i) / (x[j] - x[j + 1]));
            break;
          }
      }
    }
    double k[2 * kMapRad + 1], s = 0.0;
    for (int32_t q = -kMapRad; q <= kMapRad; ++q) {
      k[q + kMapRad] = portableExp(-.5 * q * q / (kMapSigma * kMapSigma));
      s += k[q + kMapRad];
    }
    for (int32_t q = 0; q <= 2 * kMapRad; ++q)
      mapK_[q] = static_cast<float>(k[q] / s);
  }

  // The TD prior row in effect at time x since the prior's start, or null.
  const DecTdRow *tdRow(double x) noexcept { return td_.at(tdBase_, x, tdStale_); }

  // The prior-weighted level mass of the level layer (the octaves of its output level) at period T.
  void shadowMass(const DecTdRow *r, double T, double *e) const noexcept {
    double Pg[kLvG];
    level_.groupMass(Pg);
    DecTdPrior::eff(Pg, T, r, kLvGrp[level_.cur], e);
  }

  // The shadow takes hypothesis h now, positioned as a switch.
  void shadowSwitch(int32_t h, double a, double T) noexcept {
    shownCur_ = h;
    shownPend_.on = false;
    shownU_ = level_.switchPos(h, a, T, t_, outLast_);
  }

  // A G2 row under the shadow, after the level layer's update (Shadow.decide with free thresholds,
  // before the level layer's own decision; that switch stays internal). A shadow level outside the
  // tempo range is diverted to the heaviest admissible level of the weighted mass. Epochs, kinds
  // and segments follow the shadow.
  void shadowG2(const DecTdRow *r, double a, double T) noexcept {
    const int32_t shownH = shownCur_;
    const int64_t shownU = shownU_;
    bool allowed[kLvG];
    admissible(combBin(), allowed);
    double e[kLvG];
    shadowMass(r, T, e);
    int32_t h = level_.decideMass(shownCur_, shownPend_, e, allowed, .5, .5, tAct_, T);
    const int32_t hm = level_.decide(tAct_, T);
    if (hm >= 0)
      level_.switchTo(hm, a, T, t_);
    if (!allowed[kLvGrp[h < 0 ? shownCur_ : h]])
      h = level_.best(DecLevel::heaviest(e, allowed));
    if (h < 0)
      return;
    const int32_t kind = kLvGrp[h] == kLvGrp[shownH] ? kKindLphase : kKindLevel;
    shadowSwitch(h, a, T);
    if (shownCur_ != shownH || shownU_ != shownU)
      ++epoch_;
    countKind(kind);
    emitSegment(kind, T * shownQ());
  }

  // A frame under the shadow: it changes only when its level leaves the tempo range.
  bool shadowFrame(int32_t bin) noexcept {
    bool allowed[kLvG];
    admissible(bin, allowed);
    if (allowed[kLvGrp[shownCur_]])
      return false;
    double a, T;
    clock_.comb(a, T);
    double e[kLvG];
    shadowMass(tdRow(tAct_ - tdBaseAct_), T, e);
    const int32_t shownH = shownCur_;
    const int64_t shownU = shownU_;
    shadowSwitch(level_.best(DecLevel::heaviest(e, allowed)), a, T);
    return shownCur_ != shownH || shownU_ != shownU;
  }

  // Shadow.follow after the level layer's reseed: x1 after a restart or without an old clock,
  // otherwise the weighted argmax of the carried mass at the phase nearest the shadow's old grid
  // (tSb), anchored; then diverted if its level is outside the tempo range.
  void shadowFollow(const DecTdRow *r, bool hadOld, double a, double T, double tSb) noexcept {
    int32_t h = 0;
    if (level_.lastRi >= 0 && hadOld) {
      double e[kLvG];
      DecTdPrior::eff(level_.lastPn, T, r, kLvGrp[level_.cur], e);
      h = DecLevel::nearest(argmaxFirst(e, kLvG), a, T, tSb);
    }
    shownCur_ = h;
    shownPend_.on = false;
    shownU_ = level_.anchorAt(h, a, T, t_);
    bool allowed[kLvG];
    admissible(combBin(), allowed);
    if (!allowed[kLvGrp[h]]) {
      double e[kLvG];
      shadowMass(r, T, e);
      shadowSwitch(level_.best(DecLevel::heaviest(e, allowed)), a, T);
    }
  }

  // Stable bottom-up merge sort of idx_[0, n) by key_[idx] (Python list.sort with a key).
  void stableSortByKey(int32_t n) noexcept {
    int32_t *src = idx_;
    int32_t *dst = tmp_;
    for (int32_t w = 1; w < n; w *= 2) {
      for (int32_t lo = 0; lo < n; lo += 2 * w) {
        const int32_t mid = lo + w < n ? lo + w : n;
        const int32_t hi = lo + 2 * w < n ? lo + 2 * w : n;
        int32_t i = lo, j = mid, o = lo;
        while (i < mid && j < hi)
          dst[o++] = key_[src[j]] < key_[src[i]] ? src[j++] : src[i++];
        while (i < mid)
          dst[o++] = src[i++];
        while (j < hi)
          dst[o++] = src[j++];
      }
      int32_t *t = src;
      src = dst;
      dst = t;
    }
    if (src != idx_)
      std::memcpy(idx_, src, sizeof(int32_t) * static_cast<size_t>(n));
  }

  // 8.
  void commitStep() noexcept {
    pNew_ = 0.0;
    if (z_ || kNext_ == 0)
      return;
    tAct_ += kDt;
    const float *mix = alpha_;
    if (bankState_ == kBankOpen) {
      pNew_ = 1.0 / (1.0 + portableExp(-(((logit(bank_.h) + kBankBeta) + bank_.L) - bank_.LS)));
      if (pNew_ >= kPi || (pNew_ > .5 && t_ - bank_.t0 >= kBankMaxS)) {
        adopt();
        mix = alpha_;
      } else if (pNew_ <= kOneMinusPi || t_ - bank_.t0 >= kBankMaxS) {
        drop();
      } else {
        const float wa = static_cast<float>(1.0 - pNew_);
        const float wb = static_cast<float>(pNew_);
        for (int32_t s = 0; s < kS; ++s)
          mix_[s] = wa * alpha_[s] + wb * bankA_[s];
        mix = mix_;
      }
    }
    const int32_t s = argmaxFirst(mix, kS);
    int32_t i;
    double f;
    latticeState(s, i, f);
    post_ = latticeMass(mix, latticeNear(i), f);
    BinRange tb{0, 0};
    double tf = 0.0;
    if (!committed_) {
      if (confirm(mix, post_ >= kPi, latticeNear(i), i, f, true, tb, tf)) {
        seed(mix, tb, tf, kKindLock, -std::numeric_limits<double>::infinity(), 0.0);
        bankPending_ = false;
      }
      return;
    }
    double a, T;
    clock_.comb(a, T);
    const double fc = pyModOne((tau_ - a) / T);
    if (bankPending_) {
      const int32_t ic = latticeNearest(T / kDt);
      own_ = latticeMass(mix, latticeNear(ic), fc);
      const int32_t di = i - ic;
      if (post_ >= kPi && ((di < 0 ? -di : di) > 1 || circ(f - fc) > .25 + 1e-9)) {
        seed(mix, latticeNear(i), f, kKindBank, newSongT_, 0.0);
        bankPending_ = false;
      } else if (t_ - newSongT_ > kBankMaxS) {
        bankPending_ = false;
      }
      return;
    }
    const BinRange lvT = latticeLevel(T);
    own_ = latticeMass(mix, lvT, fc);
    const BinRange nw = latticeLevel(static_cast<double>(kP[i]) * kDt);
    const bool start = own_ <= kOneMinusPi && latticeMass(mix, nw, f) >= kPi;
    if (confirm(mix, start, nw, i, f, own_ < .5, tb, tf)) {
      const int32_t kind = (swBin_ >= lvT.begin && swBin_ < lvT.end) ? kKindRephase : kKindRelevel;
      seed(mix, tb, tf, kind, -std::numeric_limits<double>::infinity(), pNew_);
    }
  }

  // 9. Events (they wait for their activation row).
  void consumeEvents() noexcept {
    while (evCount_ > 0 && evq_[0].stamp <= t_ + kEpsT) {
      const Ev e = evq_[0];
      if (e.k >= rowsPushed_)
        return;
      for (int32_t q = 1; q < evCount_; ++q)
        evq_[q - 1] = evq_[q];
      --evCount_;
      if (e.k < rowsPushed_ - kActRing) { // its row left the ring (not seen in practice)
        ++evDropped_;
        continue;
      }
      if (z_)
        continue;
      double x = static_cast<double>(row(e.k).act[0]);
      x = x < kAiLo ? kAiLo : (x > kAiHi ? kAiHi : x);
      const double lr = std::sqrt((x / pb_) / ((1.0 - x) / (1.0 - pb_)));
      // used-event history (processing order)
      if (usedCount_ == kUsedHist) {
        if (used_[usedHead_].t >= t_ - kWEv)
          ++usedDropped_;
        usedHead_ = (usedHead_ + 1) % kUsedHist;
        --usedCount_;
      }
      used_[(usedHead_ + usedCount_) % kUsedHist] = {e.evT, e.b, lr, e.band};
      ++usedCount_;
      exist_.add(e.band, e.b);
      if (out_.nEvents < kOutEvents) {
        out_.evT[out_.nEvents] = e.evT;
        out_.evBand[out_.nEvents] = e.band;
        ++out_.nEvents;
      } else {
        ++outDropped_;
      }
      if (committed_)
        clock_.update(e.b, &kEvR[e.band * 2], kEvPD[e.band], kEvRho[e.band], lr);
    }
  }

  // 10.
  void writeFrame(int32_t bin) noexcept {
    double a = 0.0, T = 0.0;
    if (clock_.on)
      clock_.comb(a, T);
    T *= shownQ();
    DecFrame &fr = out_.frame;
    out_.hasFrame = true;
    fr.levelQ = shownQ();
    fr.tIn = t_;
    fr.locked = committed_ && !z_ && exist_.shown;
    fr.epoch = epoch_;
    fr.period = committed_ ? T : 0.0;
    fr.post = post_;
    fr.own = own_;
    fr.stability = clock_.on ? clock_.stiff() : 0.0;
    fr.pNew = pNew_;
    fr.tempoIdx = bin;
    fr.z = z_;
  }

  DecSetup setup_;
  double kappa_;
  float kappaF_;
  double pb_;

  // lattice vectors (alpha_ and bankA_ swap on adopt)
  float bufA_[kS];
  float bufB_[kS];
  float *alpha_;
  float *bankA_;
  float mix_[kS];
  float lw_[kS];
  double moments_[kMomentsCap];
  PredictScratch scratch_;

  DecClock clock_;
  DecExist exist_;
  DecLevel level_;

  Row ring_[kActRing];
  int64_t rowsPushed_;
  int64_t kNext_;

  int64_t n_;
  double t_;
  double tau_;
  double tAct_;
  int64_t quiet_;
  bool z_;
  bool committed_;
  int64_t epoch_;
  int64_t beats_; // output beats passed (clickLoop)

  // tempo range, and the shown output: the level layer's TD-prior shadow (a3p Shadow), with its own
  // hypothesis, output position and pending switch over the layer's level posterior
  BinRange bins_;
  bool masked_;
  int32_t shownCur_;
  int64_t shownU_;
  DecPending shownPend_;
  double outLast_; // time of the last output beat
  // TD prior: its rows, the prior's start tick with the confirmation and tick times there, and
  // lookups past the held rows.
  DecTdPrior td_;
  int64_t tdBase_;
  double tdBaseAct_;
  double tdBaseT_;
  int64_t tdStale_;
  bool bankPending_;
  double newSongT_;
  double post_;
  double own_;
  double pNew_;

  // confirm window (a3 sw)
  bool swOn_;
  double swT0_;
  double swRef_;
  double swT_;
  int32_t swBin_;
  int32_t swB0_;
  int32_t swB1_;

  double hookT_;
  uint32_t hookCalls_;

  Ev evq_[kEvQueue];
  int32_t evCount_;
  UsedEv used_[kUsedHist];
  int32_t usedHead_;
  int32_t usedCount_;
  int32_t idx_[kUsedHist];
  int32_t tmp_[kUsedHist];
  double key_[kUsedHist];

  G2Row g2q_[kG2Queue];
  int32_t g2Head_;
  int32_t g2Count_;

  Req reqs_[kHookQueue];
  int32_t reqHead_;
  int32_t reqCount_;
  Res res_[kHookQueue];
  int32_t resHead_;
  int32_t resCount_;
  Pending fifo_[kSpawnFifo];
  int32_t fifoHead_;
  int32_t fifoCount_;

  int32_t bankState_;
  Bank bank_;

  int64_t kinds_[kKindCount];
  int32_t kindOrder_[kKindCount];
  int32_t kindOrderCount_;
  int64_t opsFwd_, opsRot_, opsBank_, opsG2_;
  int64_t evDropped_, usedDropped_, g2Dropped_, hookDropped_, spawnDropped_, outDropped_,
      clickCapped_;
  int64_t ringClamp_, actLate_;
  int64_t catchCount_, catchMaxTicks_, catchMaxRows_, catchStartN_;

  DecTickOut out_;

  // tempoMap tables (initMap)
  int16_t mapJ_[kLvG][kMapBins];
  float mapF_[kLvG][kMapBins];
  float mapK_[2 * kMapRad + 1];
};

} // namespace effetune::plugins::analyzer::rhythm_a3::dec

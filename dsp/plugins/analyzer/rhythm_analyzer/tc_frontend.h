// The tc part of the A3 front end as one real-time object.
// The kernel calls pushHop (H0) at each hop boundary, pushFrame (H1) with each frame's spectrum and
// runTick (H3) at the last stage of a hop; the consumer drains frames, events and ticks from
// fixed-capacity FIFOs. A tick closed by pushFrame is completed (base channels, then tcn_g) by the
// next runTick; a caller that skips runTick still gets every tick, because a pending tick is
// completed before the next one is stored. No allocation, exceptions or locks; the object is large
// (the TCN rings), so the kernel allocates it in prepare().
#pragma once
#include <cstdint>

#include "tc_base.h"
#include "tc_constants.h"
#include "tc_tcn.h"
#include "tc_v0.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

// Tick k: the v0 fields, the 18 base channels (binary16 values as float; float64 before rounding)
// and tcn_g's softmax (beat, off, none) at time gridT0 + k DT on the act grid (t0a = -DT, lata = 2
// DT).
struct TcTick {
  TcTickV0 v0;
  float base[TcBase::kChannels] = {};
  double base64[TcBase::kChannels] = {};
  float act[TcTcn::kOut] = {};
};

// Single-threaded bounded FIFO; push refuses when full (the caller counts the drop).
template <typename T, std::uint32_t N> class TcFifo {
public:
  void reset() noexcept { head_ = count_ = 0u; }
  bool push(const T &value) noexcept {
    if (count_ == N)
      return false;
    const std::uint32_t tail = head_ + count_;
    data_[tail < N ? tail : tail - N] = value;
    ++count_;
    return true;
  }
  bool pop(T &value) noexcept {
    if (count_ == 0u)
      return false;
    value = data_[head_];
    head_ = head_ + 1u == N ? 0u : head_ + 1u;
    --count_;
    return true;
  }
  std::uint32_t size() const noexcept { return count_; }

private:
  T data_[N] = {};
  std::uint32_t head_ = 0u, count_ = 0u;
};

class TcFrontEnd {
public:
  // A 128-sample render quantum holds at most one frame at 48/96/192 kHz; the capacities also cover
  // a harness that drains once per 4096-sample block at 48 kHz (32 frames, 8 ticks) with a wide
  // margin.
  static constexpr std::uint32_t kFrameCapacity = 320u, kEventCapacity = 64u, kTickCapacity = 80u;

  // rate: 48000, 96000 or 192000 (the analysis stream). Returns false otherwise.
  bool prepare(double rate) noexcept {
    if (!v0_.prepare(rate))
      return false;
    reset();
    return true;
  }

  void reset() noexcept {
    v0_.reset();
    base_.reset();
    tcn_.reset();
    frames_.reset();
    events_.reset();
    ticks_.reset();
    pending_ = false;
    dropped_ = 0u;
  }

  // H0: the newest hop of the analysis stream, ring[(first + i) & mask] for i in [0, hop).
  void pushHop(const float *ring, std::uint32_t mask, std::uint32_t first) noexcept {
    v0_.pushHop(ring, mask, first);
  }

  // H1: frame j's spectrum, magnitude[k - 1] = |X_k| for k in [1, 342). Queues the frame and its
  // events; returns log1p(norm |X_k|) (index k - 1) for the kernel's own picker.
  const double *pushFrame(const double *magnitude) noexcept {
    TcFrame frame;
    TcEvent events[3];
    bool closed = false;
    if (pending_)
      runTick();
    const std::uint32_t count = v0_.pushFrame(magnitude, frame, events, closed, pendingTick_.v0);
    note(frames_.push(frame));
    for (std::uint32_t i = 0u; i < count; ++i)
      note(events_.push(events[i]));
    pending_ = closed;
    return v0_.y64();
  }

  // H3: completes the tick closed by the last pushFrame, if any: base channels, then tcn_g.
  void runTick() noexcept {
    if (!pending_)
      return;
    pending_ = false;
    TcTick &t = pendingTick_;
    base_.push(t.v0, t.base64, t.base);
    tcn_.push(t.base, t.act);
    note(ticks_.push(t));
  }

  bool popFrame(TcFrame &frame) noexcept { return frames_.pop(frame); }
  bool popEvent(TcEvent &event) noexcept { return events_.pop(event); }
  bool popTick(TcTick &tick) noexcept { return ticks_.pop(tick); }
  bool pending() const noexcept { return pending_; }
  std::uint32_t dropped() const noexcept { return dropped_; }
  const tc::RateConstants &rate() const noexcept { return v0_.rate(); }

  // Bytes of processing state (FIFOs excluded) and of the FIFOs.
  static constexpr std::uint32_t stateBytes() noexcept {
    return static_cast<std::uint32_t>(sizeof(TcV0) + sizeof(TcBase) + sizeof(TcTcn) +
                                      sizeof(TcTick));
  }
  static constexpr std::uint32_t fifoBytes() noexcept {
    return static_cast<std::uint32_t>(sizeof(TcFifo<TcFrame, kFrameCapacity>) +
                                      sizeof(TcFifo<TcEvent, kEventCapacity>) +
                                      sizeof(TcFifo<TcTick, kTickCapacity>));
  }

private:
  void note(bool pushed) noexcept { dropped_ += pushed ? 0u : 1u; }

  TcV0 v0_;
  TcBase base_;
  TcTcn tcn_;
  TcTick pendingTick_;
  bool pending_ = false;
  std::uint32_t dropped_ = 0u;
  TcFifo<TcFrame, kFrameCapacity> frames_;
  TcFifo<TcEvent, kEventCapacity> events_;
  TcFifo<TcTick, kTickCapacity> ticks_;
};

} // namespace effetune::plugins::analyzer::rhythm_a3

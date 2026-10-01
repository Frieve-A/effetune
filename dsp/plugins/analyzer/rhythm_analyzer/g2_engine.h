// The G2 side of the A3 clock in one object: streaming chroma (analysis-rate samples), the tick /
// event / chroma store, and the staged 2 Hz G2 update. Per render quantum, the owner pushes the
// quantum's analysis samples (pushSamples), the ticks and events the front end completed in it
// (pushTick, pushEvent), then calls process(absoluteSamples) before the decoder runs; the decoder's
// hooks call boundary(t, committed). No allocation after prepare(); the object is large and belongs
// on the heap of the owning plugin.
#pragma once
#include <cstddef>
#include <cstdint>

#include "g2_boundary.h"
#include "g2_chroma.h"
#include "g2_stream.h"
#include "g2_update.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class G2Engine {
public:
  // rate: 48000, 96000 or 192000 (analysis rate). Returns false for an unsupported rate.
  bool prepare(int rate) noexcept {
    if (!chroma_.prepare(rate))
      return false;
    updater_.prepare();
    reset();
    // Fault in every page of this object (write) and of the embedded tree models (read) here rather
    // than in the first update job or hook call on the audio thread.
    touchPages(reinterpret_cast<unsigned char *>(this), sizeof *this, true);
    touchModel(g2_level::model(), G2Updater::kClasses);
    touchModel(g2_hazard::model(), 1);
    return true;
  }

  void reset() noexcept {
    chroma_.reset();
    stream_.reset();
    updater_.reset();
    boundary_.reset(&stream_);
  }

  void pushSamples(const float *x, std::uint32_t count) noexcept {
    for (std::uint32_t i = 0; i < count; ++i)
      if (chroma_.sample(x[i]))
        stream_.addChromaFrame(chroma_.chroma());
  }

  void pushTick(const float flux[3][4], const float bandDb[3], float rmsDb,
                const float lvl[3]) noexcept {
    stream_.pushTick(flux, bandDb, rmsDb, lvl);
  }
  void pushEvent(double t, int band, float strength) noexcept {
    stream_.pushEvent(t, band, strength);
  }
  // Chroma frames from another source (development checks with cached chroma); not mixed with
  // pushSamples().
  void addChromaFrame(const double values[12]) noexcept { stream_.addChromaFrame(values); }

  void process(std::uint64_t absoluteSamples) noexcept {
    updater_.process(stream_, absoluteSamples);
  }
  // End of the track; dur = analysis samples / rate.
  void finish(double dur) noexcept { updater_.finish(stream_, dur); }

  // Decoder hook: new spawns and the hazard of every open spawn at decoder time t, which
  // must not decrease; the stream must hold every tick < at_ticks(t) and every event with ev_t <= t
  // - .05.
  const G2Boundary::Result &boundary(double t, bool committed) noexcept {
    return boundary_.boundary(t, committed);
  }
  [[nodiscard]] const G2Boundary::Stats &boundaryStats() const noexcept {
    return boundary_.stats();
  }

  [[nodiscard]] std::int64_t updatesAvailable() const noexcept {
    return updater_.updatesAvailable();
  }
  [[nodiscard]] const G2Update &update(std::int64_t u) const noexcept { return updater_.update(u); }

  [[nodiscard]] const G2Stream &stream() const noexcept { return stream_; }
  [[nodiscard]] G2Updater &updater() noexcept { return updater_; }
  [[nodiscard]] const G2Chroma &chroma() const noexcept { return chroma_; }

private:
  static void touchPages(const volatile unsigned char *p, std::size_t bytes, bool write) noexcept {
    for (std::size_t i = 0; i < bytes; i += 4096)
      if (write)
        const_cast<volatile unsigned char *>(p)[i] = p[i];
      else
        static_cast<void>(p[i]);
  }
  template <typename T> static void touchArray(const T *p, std::size_t count) noexcept {
    touchPages(reinterpret_cast<const unsigned char *>(p), count * sizeof(T), false);
  }
  // outputs: leaf values per leaf node. Every border is some split's threshold, so the largest
  // index the splits address bounds the borders.
  template <typename Model> static void touchModel(const Model &m, std::size_t outputs) noexcept {
    const std::size_t nodes = std::size_t{m.tree_count} * ((std::size_t{1} << m.depth) - 1u);
    const std::size_t leaves = std::size_t{m.tree_count} << m.depth;
    std::size_t borders = 0u;
    for (std::size_t n = 0u; n < nodes; ++n) {
      const std::size_t end =
          std::size_t{m.border_offsets[m.split_features[n]]} + m.split_thresholds[n] + 1u;
      borders = end > borders ? end : borders;
    }
    touchArray(m.split_features, nodes);
    touchArray(m.split_thresholds, nodes);
    touchArray(m.border_offsets, m.feature_count);
    touchArray(m.borders, borders);
    touchArray(m.leaf_values, leaves * outputs);
    if (m.leaf_scales != nullptr)
      touchArray(m.leaf_scales, std::size_t{m.tree_count} * outputs);
  }

  G2Chroma chroma_;
  G2Stream stream_;
  G2Updater updater_;
  G2Boundary boundary_;
};

} // namespace effetune::plugins::analyzer::rhythm_a3

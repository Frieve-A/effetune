#pragma once
#include "engine.h"
#include "telemetry.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <list>
#include <optional>
#include <string_view>

namespace effetune::audio {
struct FeedTime {
  double first;
  double step;
};

struct StreamBoundary {
  std::uint64_t source;
  unsigned kinds;
  std::optional<std::uint64_t> pipeline{};
};

// Each configured analysis instance owns its last completed boundary. Rhythm
// needs an exact sample split. Note Spectrogram follows the worklet's midpoint.
struct BoundarySlice {
  std::uint64_t at, position;
  unsigned quantum, frames;
  Telemetry &telemetry;
  std::uint64_t revision;
  VisualizerStage stage;
  bool pending = false;

  void visit(Engine &engine, unsigned instance, std::string_view type, unsigned inputDelay,
             std::optional<std::uint64_t> &last) noexcept {
    if ((last && *last >= at) ||
        (type != "RhythmAnalyzerPlugin" && type != "NoteSpectrogramPlugin"))
      return;
    const auto due = at + inputDelay;
    const bool exact = type == "RhythmAnalyzerPlugin";
    if (due > position + (exact ? 0 : quantum / 2)) {
      pending = true;
      if (exact && due < position + frames)
        frames = static_cast<unsigned>(due - position);
      return;
    }
    if (engine.streamBoundaryInstance(instance) != ET_OK) {
      telemetry.read(engine, position, revision, stage, true);
      if (engine.streamBoundaryInstance(instance) != ET_OK) {
        pending = true;
        return;
      }
    }
    last = at;
    if (exact)
      telemetry.read(engine, position, revision, stage, true);
  }
};

class StreamBoundaries {
public:
  using List = std::list<StreamBoundary>;
  void addFileBoundary(std::uint64_t frame) noexcept {
    const auto slot =
        std::find_if(file_.begin(), file_.end(), [](const auto &item) { return !item.frame; });
    if (slot != file_.end())
      *slot = {frame, false};
  }

  void shareFileBoundaries(StreamBoundaries *parallel) noexcept {
    for (auto &item : file_) {
      if (!item.frame || item.shared)
        continue;
      if (parallel)
        parallel->addFileBoundary(*item.frame);
      item.shared = true;
    }
  }
  // Incoming and reclaimed nodes belong to the control command. Splicing keeps
  // all allocation and destruction outside the device callback.
  void reserve(unsigned replace, List &incoming, List &reclaimed) noexcept {
    reclaimed.splice(reclaimed.end(), finished_);
    for (auto it = active_.begin(); it != active_.end();) {
      auto node = it++;
      if (!node->pipeline && (node->kinds &= ~replace) == 0)
        reclaimed.splice(reclaimed.end(), active_, node);
    }
    while (!incoming.empty()) {
      auto node = incoming.begin();
      auto it = std::find_if(active_.begin(), active_.end(),
                             [&](const auto &b) { return b.source >= node->source; });
      if (it != active_.end() && it->source == node->source) {
        it->kinds |= node->kinds;
        reclaimed.splice(reclaimed.end(), incoming, node);
      } else
        active_.splice(it, incoming, node);
    }
  }

  template <class Visit>
  unsigned slice(std::uint64_t position, unsigned quantum, FeedTime clock, Telemetry &telemetry,
                 std::uint64_t revision, VisualizerStage stage, Visit visit) noexcept {
    unsigned frames = quantum;
    for (auto it = active_.begin(); it != active_.end();) {
      auto node = it++;
      if (!node->pipeline) {
        if (double(node->source) > clock.first + clock.step * quantum)
          continue;
        const auto delta = clock.step > 0 ? (double(node->source) - clock.first) / clock.step : 0.;
        node->pipeline =
            static_cast<std::uint64_t>(std::max(0., std::round(double(position) + delta)));
      }
      BoundarySlice slice{*node->pipeline, position, quantum, frames, telemetry, revision, stage};
      visit(slice);
      frames = slice.frames;
      if (!slice.pending)
        finished_.splice(finished_.end(), active_, node);
    }
    for (auto &[frame, shared] : file_) {
      if (!frame || *frame > position + quantum)
        continue;
      BoundarySlice slice{*frame, position, quantum, frames, telemetry, revision, stage};
      visit(slice);
      frames = slice.frames;
      if (!slice.pending)
        frame.reset();
    }
    return frames;
  }

private:
  struct FileBoundary {
    std::optional<std::uint64_t> frame;
    bool shared = false;
  };
  List active_, finished_;
  std::array<FileBoundary, 8> file_{};
};
} // namespace effetune::audio

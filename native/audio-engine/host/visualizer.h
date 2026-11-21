#pragma once
#include "telemetry.h"
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>
namespace effetune {
class Engine;
}
namespace effetune::audio {
struct BoundarySlice;
struct VisualizerSource {
  unsigned tap = 0, hash = 0, left = 0, right = 1;
  float gain = 1;
  std::string type;
  std::vector<float> params;
  bool operator==(const VisualizerSource &) const = default;
};
class Visualizer {
public:
  Visualizer(unsigned sampleRate, unsigned maxFrames);
  ~Visualizer();
  bool configure(const std::vector<VisualizerSource> &sources);
  void streamBoundary(BoundarySlice &slice, unsigned inputDelay) noexcept;
  void setRate(float hz) noexcept;
  void reset() noexcept;
  void render(const float *audio, unsigned channels, unsigned frames, std::uint64_t position,
              Telemetry &telemetry, std::uint64_t revision, VisualizerStage stage) noexcept;

private:
  struct Slot {
    VisualizerSource source;
    unsigned instance;
    std::optional<std::uint64_t> lastBoundary{};
  };
  std::unique_ptr<Engine> engine_;
  std::map<unsigned, Slot> slots_;
  unsigned rate_;
};
} // namespace effetune::audio

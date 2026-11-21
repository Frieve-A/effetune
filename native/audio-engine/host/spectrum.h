#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <span>
#include <vector>
namespace effetune::audio {
class Pipeline;
struct SpectrumFrame {
  struct Analysis {
    unsigned generation = 0, index = 0, hop = 0, first = 0, valid = 0;
    std::uint64_t captured = 0;
  };
  unsigned id = 0, generation = 0, index = 0, position = 0, delay = 0, rate = 0;
  std::uint64_t captured = 0, end = 0, revision = 0;
  bool compare = false, hq = false;
  Analysis input, output;
  std::vector<float> samples;
};
class SpectrumTaps {
public:
  class Track;
  struct Update {
    unsigned id;
    std::shared_ptr<Track> previous, next;
  };
  SpectrumTaps(unsigned rate, unsigned maxFrames);
  Update prepare(unsigned id, bool enabled, bool compare, bool hq);
  void apply(const Update &update) noexcept;
  void begin(const Pipeline &pipeline) noexcept;
  void route(unsigned id, bool enabled) noexcept;
  bool observing() const noexcept { return !routed_.empty() || !active_.empty(); }
  void reset() noexcept;
  void capture(unsigned instance, const float *audio, unsigned channels, unsigned frames,
               unsigned latency, bool before, std::uint64_t start, std::uint64_t revision) noexcept;
  void drain(const std::function<void(const SpectrumFrame &)> &send);

private:
  unsigned rate_, maxFrames_, generation_ = 0;
  std::map<unsigned, std::shared_ptr<Track>> control_;
  struct Active {
    unsigned id, instance, remaining;
    Track *track;
  };
  std::vector<Active> active_;
  std::vector<unsigned> routed_;
};
} // namespace effetune::audio

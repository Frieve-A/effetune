#pragma once

#include "host/resampler.h"
#include <array>
#include <atomic>
#include <cstdint>
#include <memory>
#include <vector>

namespace effetune::audio {

// The protocol reader publishes file controls and PCM in wire order. Only the
// device callback owns track playback and converter history.
class FileFifo {
public:
  static constexpr unsigned maxChannels = 6;
  struct TrackInfo {
    std::uint64_t generation, track, startFrame;
    unsigned rate, channels;
    float gain;
    bool fadeIn = false;
  };
  struct Snapshot {
    std::uint64_t generation = 0, track = 0, readFrame = 0, writtenFrames = 0, queuedFrames = 0,
                  underruns = 0, gaps = 0, overflows = 0, pipelineFrame = 0;
    double converterDelay = 0;
    bool running = false;
  };
  struct Event {
    enum class Type { Ended, NextAccepted, NextRejected, Cancelled, AlreadyPlaying } type;
    std::uint64_t generation, track, pipelineFrame;
  };
  using Boundary = void (*)(void *, std::uint64_t) noexcept;

  FileFifo();
  void configure(unsigned rate, unsigned period) noexcept;
  bool start(TrackInfo info, bool next);
  bool write(TrackInfo info, const float *planar, unsigned frames) noexcept;
  bool end(std::uint64_t generation, std::uint64_t track, std::uint64_t totalFrames) noexcept;
  bool gain(std::uint64_t generation, std::uint64_t track, float gain) noexcept;
  bool flush(std::uint64_t generation) noexcept;
  bool cancelNext(std::uint64_t generation, std::uint64_t track) noexcept;
  void mix(float *planar, unsigned channels, unsigned frames, std::uint64_t position, void *context,
           Boundary boundary) noexcept;
  bool popEvent(Event &event) noexcept;
  bool activeThisBlock() const noexcept { return activeThisBlock_; }
  Snapshot snapshot() const noexcept;

private:
  using Frame = std::array<float, maxChannels>;
  static constexpr std::size_t slotCount = 256;
  // Interleaved samples. The renderer scales its lookahead by channel count so
  // two seconds of 384 kHz stereo, or the same sample count of wider PCM, fits.
  static constexpr std::size_t capacity = 384000 * 4 * 2;
  template <typename Item, std::size_t Size> struct Slots {
    std::array<Item, Size> items{};
    std::atomic<std::uint64_t> read{0}, written{0};
    Item *writable() noexcept {
      const auto index = written.load(std::memory_order_relaxed);
      return index - read.load(std::memory_order_acquire) < Size ? &items[index % Size] : nullptr;
    }
    Item *readable() noexcept {
      const auto index = read.load(std::memory_order_relaxed);
      return index < written.load(std::memory_order_acquire) ? &items[index % Size] : nullptr;
    }
    void publish() noexcept { written.fetch_add(1, std::memory_order_release); }
    void pop() noexcept { read.fetch_add(1, std::memory_order_release); }
  };
  struct Command {
    enum class Type { Start, Next, Data, End, Gain, Flush, Cancel } type;
    TrackInfo info{};
    std::uint64_t offset = 0, end = 0;
    std::unique_ptr<Resampler> converter;
  };
  // Sample offsets into pcm_.
  struct Range {
    std::uint64_t first, end;
  };
  struct Track {
    TrackInfo info{};
    std::unique_ptr<Resampler> converter;
    std::array<Range, slotCount> ranges{};
    std::size_t readRange = 0, writeRange = 0, available = 0;
    std::uint64_t expected = 0, position = 0, totalFrames = 0, outputs = 0;
    bool ended = false, gap = false, finished = false, draining = false;
    void clear() noexcept;
    bool append(std::uint64_t first, std::uint64_t end) noexcept;
  };
  bool queueControl(Command::Type, std::uint64_t generation, std::uint64_t track = 0,
                    std::uint64_t totalFrames = 0, float value = 0) noexcept;
  void consumeCommands() noexcept;
  void emit(Event::Type type, std::uint64_t generation, std::uint64_t track,
            std::uint64_t frame = 0) noexcept;
  void clearTrack(Track &track) noexcept;
  void beginTrack(Track &track, Command &command) noexcept;
  void resetStream() noexcept;
  void abandon() noexcept;
  bool continuesWithNext() const noexcept;
  bool raw(Track &track, Frame &sample) noexcept;
  bool sample(Frame &value) noexcept;
  std::uint64_t outputLength() const noexcept;
  bool atEnd() const noexcept;
  void advanceTrack(std::uint64_t frame, void *context, Boundary boundary) noexcept;
  void publish(std::uint64_t pipelineFrame) noexcept;

  std::vector<float> pcm_;
  Slots<Command, slotCount> commands_;
  Slots<Event, slotCount> events_;
  Slots<std::unique_ptr<Resampler>, slotCount * 2> retired_;
  std::atomic<std::uint64_t> released_{0}, writtenFrames_{0}, writtenGeneration_{0}, overflows_{0};
  std::atomic<unsigned> rate_{0}, period_{0}, formatRevision_{0};
  // Wire reader only.
  std::uint64_t writeOffset_ = 0, writeGeneration_ = 0;
  bool accepting_ = false;
  // Device callback only.
  Track current_, next_;
  std::uint64_t parsedEnd_ = 0, generation_ = 0, underruns_ = 0, gaps_ = 0;
  std::uint64_t groupSource_ = 0, groupOutput_ = 0;
  unsigned format_ = 0, sampleRate_ = 0, periodFrames_ = 0, discard_ = 0;
  unsigned fadeIn_ = 0, flush_ = 0, fadeTail_ = 0, fadeTailLength_ = 0;
  bool running_ = false, activeThisBlock_ = false;
  Frame last_{}, tail_{};
  struct AtomicSnapshot {
    std::atomic<std::uint64_t> sequence{0}, generation{0}, track{0}, readFrame{0}, queued{0},
        underruns{0}, gaps{0}, pipelineFrame{0};
    std::atomic<double> delay{0};
    std::atomic<bool> running{false};
  } published_;
};

} // namespace effetune::audio

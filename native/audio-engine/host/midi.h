#pragma once
#include "effetune/abi.h"
#include "engine.h"
#include <array>
#include <atomic>
#include <cstdint>
#include <span>
#include <vector>
namespace effetune::audio {
class MidiScheduler {
public:
  struct Event {
    et_midi_event data{};
    double seconds = 0;
  };
  struct LiveTarget {
    std::uint32_t id, token;
    bool delivered = false;
  };
  struct LiveEvent {
    et_midi_event data{};
    std::uint64_t frame;
    std::span<LiveTarget> targets;
    std::uint64_t batch = 0;
  };
  struct Instrument {
    std::uint32_t id, instance, token, inputLatency;
    bool enabled, ready, streaming = false;
    unsigned channelMask = 0;
  };
  struct Transport {
    std::vector<Event> events;
    std::vector<et_midi_transport_point> points;
    std::uint64_t anchor = 0;
    std::uint32_t generation = 0;
    double position = 0, duration = 0, speed = 1, gain = 1;
    bool hasTimeline = false, playing = false, preparing = false, preserveRelease = false;
    bool draining = false;
  };
  bool configureInput(unsigned generation, bool enabled, std::uint64_t anchor) noexcept;
  bool enqueue(unsigned generation, std::span<const LiveEvent> events) noexcept;
  bool configure(Transport &transport) noexcept;
  bool hydrate(Engine &engine, const Instrument &target, unsigned generation,
               std::span<const et_midi_event> events) noexcept;
  void resumeInput(unsigned instance) noexcept;
  bool prepare(Engine &engine, std::span<const Instrument> targets);
  bool installMap(Engine &engine, unsigned instance) const;
  void render(Engine &engine, std::span<const Instrument> targets, std::uint64_t frame,
              unsigned frames, unsigned rate) noexcept;
  bool start(unsigned generation, std::uint64_t anchor) noexcept;
  void speed(double value, std::uint64_t frame, unsigned rate) noexcept;
  void gain(double value) noexcept { transport_.gain = value; }
  std::uint64_t lastBatch() const noexcept { return batchSerial_; }
  std::uint64_t deliveredBatch() const noexcept {
    return delivered_.load(std::memory_order_acquire);
  }
  unsigned publishedGeneration() const noexcept {
    return publishedGeneration_.load(std::memory_order_acquire);
  }
  double position(std::uint64_t frame, unsigned rate) const noexcept;
  bool pause(unsigned generation, std::uint64_t frame, unsigned rate) noexcept;
  unsigned takePaused() noexcept { return pauseReady_.exchange(0); }
  double lastReportedPosition() const noexcept { return reportedPosition_.load(); }
  bool paused() const noexcept { return paused_.load(std::memory_order_acquire); }
  std::size_t cursor(unsigned instance) const noexcept;
  bool restoreCursor(const Instrument &target, std::size_t cursor, std::uint64_t clock) noexcept;
  void finishedBlock(std::uint64_t frame, unsigned rate) noexcept;
  bool reportPosition(unsigned &generation, double &seconds, std::uint64_t &frame) noexcept;
  struct Forecast {
    unsigned generation = 0, nativeGeneration = 0, scope = 0, window = 0, attempt = 0;
    double speed = 0, start = 0;
    std::uint64_t next = 0;
    std::size_t cursor = 0;
    bool scanning = false, began = false, ready = false, limited = false;
  };
  void forecast(Engine &engine, const Instrument &instrument, Forecast &forecast,
                std::uint64_t frame, unsigned rate, bool main, bool preview,
                et_stream_readiness &readiness) noexcept;
  unsigned generation() const noexcept { return transport_.generation; }
  bool pending() const noexcept { return pending_; }
  double minimumBpm() const noexcept;
  unsigned takePrepared() noexcept { return prepared_.exchange(0); }
  unsigned takeEnded() noexcept { return ended_.exchange(0); }

private:
  struct State {
    unsigned instance = 0, token = 0, channelMask = 0;
    std::size_t cursor = 0;
    bool initialized = false, ended = false, paused = false, resumeInput = false;
    std::uint64_t clockBase = 0, clockAnchor = 0;
    unsigned activation = 0;
    bool joining = false, joinedDuringPlayback = false;
    bool restoring = false, historyRequested = false;
  };
  bool restore(Engine &engine, const Instrument &target, State &state, std::uint64_t frame,
               unsigned rate) noexcept;
  bool joinPlaying(Engine &engine, const Instrument &target, State &state, std::uint64_t frame,
                   unsigned frames, unsigned rate) noexcept;
  State &state(const Instrument &instrument) noexcept;
  void reset() noexcept;
  std::array<State, Engine::kMaxInstances> states_{};
  std::array<LiveEvent, 4096> liveEvents_;
  std::array<et_midi_event, 4096> batch_;
  std::size_t liveCount_ = 0;
  Transport transport_;
  bool live_ = false, pending_ = false, preparedNotified_ = false;
  std::uint64_t batchSerial_ = 0, blockDelivered_ = 0, pauseFrame_ = 0, nextReport_ = 0;
  double pausePosition_ = 0;
  double firstNoteSeconds_ = 0;
  bool pausing_ = false, pauseComplete_ = false, endingBlock_ = false;
  std::atomic<bool> paused_{false};
  std::atomic<std::uint64_t> delivered_{0}, positionFrame_{0};
  std::atomic<double> reportedPosition_{0};
  std::atomic<unsigned> publishedGeneration_{0}, pauseReady_{0}, positionGen_{0};
  std::atomic<unsigned> prepared_{0}, ended_{0};
};
} // namespace effetune::audio

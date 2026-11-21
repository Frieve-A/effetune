#pragma once

#include "host/resampler.h"
#include <array>
#include <atomic>
#include <cstdint>
#include <optional>

namespace effetune::audio {

struct NetworkPacket {
  static constexpr unsigned frames = 2048, sampleRate = 44100;
  std::uint64_t sourceEpoch = 0, sourceFrame = 0, routeRevision = 0, routeRevisionEnd = 0;
  double contextFrame = 0, contextFrameStep = 1;
  unsigned contextSampleRate = 0;
  std::array<std::int16_t, 2 * frames> pcm{};
};

// The audio thread writes up to eight unacknowledged packets. The control
// thread drains the SPSC ring and forwards acknowledgements as audio commands.
class NetworkSender {
public:
  NetworkSender(unsigned sampleRate, unsigned maxFrames);
  void setAttached(bool attached) noexcept;
  void acknowledge(std::uint64_t epoch, std::uint64_t frame) noexcept;
  void render(const float *left, const float *right, unsigned frames, std::uint64_t contextFrame,
              std::uint64_t routeRevision, bool sendAllowed) noexcept;
  bool pop(NetworkPacket &packet) noexcept;

private:
  static constexpr unsigned capacity = 8;
  void stopSending() noexcept;
  struct Credit {
    bool used = false;
    std::uint64_t epoch = 0, frame = 0;
  };
  std::array<Credit, capacity> credits_{};
  std::array<NetworkPacket, capacity> packets_;
  std::atomic<std::uint64_t> write_{0}, read_{0};
  unsigned sampleRate_, maxFrames_, maxConverted_, outstanding_ = 0, fill_ = 0;
  std::uint64_t epoch_ = 0, sourceFrame_ = 0, origin_ = 0;
  double nextContextFrame_ = 0;
  bool attached_ = false, sending_ = false;
  Resampler converter_;
  std::vector<float> input_, converted_;
};

enum class VisualizerStage { pipeline, local, send, network };
VisualizerStage visualizerStage(bool localDelayActive, bool visualSync, bool sendMarker,
                                bool receiveActive) noexcept;

class NetworkLocalDelay {
public:
  NetworkLocalDelay(unsigned sampleRate, unsigned channels);
  void set(bool active, unsigned samples) noexcept;
  void process(float *planar, unsigned frames) noexcept;
  unsigned samples() const noexcept { return current_; }
  bool active() const noexcept { return active_; }

private:
  struct Target {
    bool active;
    unsigned samples;
  };
  unsigned channels_, length_, index_ = 0, current_ = 0, progress_ = 0;
  std::uint64_t written_ = 0;
  bool active_ = false;
  std::optional<Target> transition_, pending_;
  std::vector<float> ring_;
};

// Applied after DBT branch selection, in the same place as the worklet's localGain.
class NetworkLocalGain {
public:
  void process(float *planar, unsigned channels, unsigned frames, bool enabled) noexcept;
  bool settled(bool enabled) const noexcept { return gain_ == (enabled ? 1.f : 0.f); }

private:
  float gain_ = 1;
};
} // namespace effetune::audio

#pragma once
#include "frequency_preview.h"
#include "output_stage.h"
#include "power.h"
#include "spectrum.h"
#include "stream_boundaries.h"
#include "telemetry.h"
#include "visualizer.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <span>
#include <vector>

namespace effetune {
class Engine;
namespace audio {
class Pipeline;
struct PluginSettings;
class ClockedFifo;
class FileFifo;
class IoPipeline;
struct SessionFormat {
  std::uint32_t sampleRate = 48000;
  std::uint32_t inputChannels = 0;
  std::uint32_t outputChannels = 2;
  std::uint32_t periodFrames = 128;
  std::uint32_t deviceRate = 0, captureRate = 0;
  std::uint32_t width() const noexcept;
};

class Session {
public:
  Session();
  ~Session();
  bool open(SessionFormat format);
  bool reconfigureDevice(SessionFormat format);
  void close() noexcept;
  bool render(std::span<float> planar, std::uint32_t frames, std::optional<FeedTime> feedTime = {},
              bool sourceActive = false) noexcept;
  void reserveBoundaries(unsigned replace, StreamBoundaries::List &incoming,
                         StreamBoundaries::List &reclaimed) noexcept {
    boundaries_.reserve(replace, incoming, reclaimed);
  }
  bool renderDevice(std::span<float> output, unsigned frames,
                    std::span<const float> synchronousInput = {}, bool discard = false) noexcept;
  void advanceSilently(unsigned frames) noexcept {
    position_.fetch_add(frames, std::memory_order_relaxed);
  }
  ClockedFifo &feed() noexcept { return *feed_; }
  void setFileInput(FileFifo *file) noexcept { file_ = file; }
  FileFifo *file() noexcept { return file_; }
  void noteFileBoundary(std::uint64_t frame) noexcept { boundaries_.addFileBoundary(frame); }
  ClockedFifo &capture() noexcept;
  bool replaceInput(unsigned channels, unsigned sampleRate);
  IoPipeline *io() noexcept { return io_.get(); }
  bool isOpen() const noexcept { return engine_ != nullptr; }
  const SessionFormat &format() const noexcept { return format_; }
  unsigned maxBlock() const noexcept { return maxBlock_; }
  std::uint64_t position() const noexcept { return position_; }
  Pipeline *pipeline() noexcept { return pipeline_.get(); }
  OutputStage &output() noexcept { return output_; }
  unsigned latency() const noexcept;
  bool resetProcessing();
  bool updateParameter(PluginSettings &settings);
  bool needsLatencyReservation() const noexcept { return latencyReservationNeeded_.load(); }
  bool reserveLatency();
  bool takeLatencyChange() noexcept { return latencyChanged_.exchange(false); }
  void overload(bool enabled, double delay, double headroom) noexcept;
  double takeCpuUsage() noexcept { return cpuUsage_.exchange(-1); }
  int takeOverload() noexcept { return overloadEvent_.exchange(-1); }
  Telemetry *telemetry() noexcept { return telemetry_.get(); }
  bool setTelemetryRate(float hz, bool midiMetering = false) noexcept;
  void exchangeVisualizer(std::unique_ptr<Visualizer> &next) noexcept;
  PowerControl &power() noexcept { return *power_; }
  SpectrumTaps &spectrum() noexcept { return *spectrum_; }
  void preview(double frequency, bool noise) noexcept;
  void setMasterBypass(bool bypass);
  bool masterBypass() const noexcept { return bypass_; }
  bool startParallel(bool selectB);
  void stopParallel() noexcept;
  void selectParallel(bool selectB, double duration = .03) noexcept;
  Session *branch(unsigned index) noexcept;

private:
  explicit Session(bool secondary);
  bool refreshLatency(bool gated) noexcept;
  struct Parallel {
    std::unique_ptr<Session> b;
    std::vector<float> input;
    // Low bit selects branch B. The remaining bits give the crossfade duration
    // in frames.
    std::atomic<unsigned> selection{0};
    float gainB = 0, step = 0;
    bool targetB = false;
    unsigned rampRemaining = 0;
  };
  std::unique_ptr<Parallel> parallelOwner_, retired_;
  std::atomic<Parallel *> published_{nullptr}, inUse_{nullptr};
  std::unique_ptr<Engine> engine_;
  std::unique_ptr<Pipeline> pipeline_;
  std::unique_ptr<ClockedFifo> feed_;
  FileFifo *file_ = nullptr;
  std::unique_ptr<IoPipeline> io_;
  bool bypass_ = false;
  bool ranDsp_ = false, latencyGate_ = false;
  std::atomic<bool> latencyChanged_{false};
  std::atomic<bool> latencyReservationNeeded_{false};
  StreamBoundaries boundaries_;
  OutputStage output_;
  std::unique_ptr<Telemetry> telemetry_;
  std::unique_ptr<PowerControl> power_;
  std::unique_ptr<Visualizer> visualizer_;
  std::unique_ptr<SpectrumTaps> spectrum_;
  float telemetryRate_ = 30;
  std::vector<float> dry_;
  FrequencyPreview preview_;
  unsigned maxBlock_ = 0;
  SessionFormat format_;
  unsigned cpuFrames_ = 0;
  double cpuMs_ = 0, headroom_ = 10, credit_ = 10;
  bool overloadEnabled_ = false, overloaded_ = false;
  std::uint64_t overloadStart_ = 0, lastOverload_ = 0;
  std::atomic<double> cpuUsage_{-1};
  std::atomic<int> overloadEvent_{-1};
  std::atomic<std::uint64_t> position_{0};
};
} // namespace audio
} // namespace effetune

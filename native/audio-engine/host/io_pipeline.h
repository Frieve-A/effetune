#pragma once
#include "host/clocked_fifo.h"
#include "host/network_output.h"
#include <memory>

namespace effetune::audio {
struct SessionFormat;
class Session;

class IoPipeline {
public:
  IoPipeline(const SessionFormat &format, ClockedFifo *feedRing);
  void reconfigureDevice(const SessionFormat &format);
  void restartDeviceClock() noexcept;
  bool renderDevice(Session &session, float *output, unsigned frames, const float *synchronousInput,
                    bool discard = false) noexcept;
  void networkStage(float *bus, unsigned channels, unsigned frames, std::uint64_t position,
                    bool parallel) noexcept;
  void applyLocalGain(float *bus, unsigned channels, unsigned frames) noexcept;
  float *capturedMarker() noexcept { return markerCaptured_ ? marker_.data() : nullptr; }
  void captureSendMarker(const float *planar, unsigned channels, unsigned frames,
                         unsigned latencySamples) noexcept;
  double outputDelayFrames() const noexcept {
    return output_.delayInputFrames() + buffered_ - consumed_;
  }
  bool replaceInput(const SessionFormat &format, unsigned channels, unsigned sampleRate);
  using Capture = std::unique_ptr<ClockedFifo>;
  static Capture prepareInput(const SessionFormat &format, unsigned channels, unsigned sampleRate);
  void exchangeInput(Capture &next, unsigned channels) noexcept {
    capture_.swap(next);
    captureChannels_ = channels;
  }
  ClockedFifo &capture() noexcept { return *capture_; }
  unsigned captureChannels() const noexcept { return captureChannels_; }
  void requestLocalDelay(unsigned request, bool active, unsigned samples, bool local) noexcept;
  unsigned pendingDelayRequest = 0, requestedLocalDelay = 0, reportedOutputDelay = 0;
  std::atomic<unsigned> appliedDelayRequest{0};

  NetworkSender sender;
  NetworkLocalDelay delay;
  bool inputEnabled = true, paused = false, receiving = false, localEnabled = true,
       visualSync = false;
  unsigned sendInstance = 0, sendLatency = 0;
  void markTapChanged() noexcept {
    ++tapRevision;
    ++routeRevision;
  }
  std::uint64_t routeRevision = 0, tapRevision = 0, localDelayRevision = 0, receiveGeneration = 0;

private:
  Capture capture_;
  void checkLocalDelay() noexcept;
  unsigned renderDelayRequest_ = 0;
  bool requestedDelayActive_ = false;
  ClockedFifo *feed_;
  Resampler output_;
  NetworkLocalGain localGain_;
  unsigned buffered_ = 0, consumed_ = 0;
  unsigned captureChannels_ = 0;
  std::vector<float> pipelineBuffer_, inputBuffer_, marker_;
  bool markerCaptured_ = false;
};
} // namespace effetune::audio

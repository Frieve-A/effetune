#ifndef EFFETUNE_ANDROID_NATIVE_ENGINE_H
#define EFFETUNE_ANDROID_NATIVE_ENGINE_H

#include "effetune/kernel.h"
#include "finite_capture.h"
#include "host/pipeline.h"
#include "host/network_output.h"
#include "host/session.h"
#include "output_error.h"
#include "pcm_ring.h"
#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <oboe/Oboe.h>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace effetune::android {

constexpr std::uint32_t inputBurstFrames(int deviceBurst, int deviceRate,
                                         int hostRate) {
  return static_cast<std::uint32_t>(
      (static_cast<std::int64_t>(deviceBurst) * hostRate + deviceRate - 1) /
      deviceRate);
}

class NativeEngine final : public oboe::AudioStreamDataCallback {
public:
  // Output status of a DSP graph that cannot render; Oboe results start at -900.
  static constexpr int kPipelineFailed = -1;
  NativeEngine(std::int32_t sampleRate, std::int32_t maxFrames,
               std::uint32_t channels = 2);
  ~NativeEngine() override;
  int start();
  bool checkOutputFormat();
  int outputStatus();
  // Once per control tick: widens the buffer after new XRuns and returns the
  // rate that counts burst and buffer frames, burst, buffer size, XRuns, failed
  // renders, source and input underruns, and the output hardware rate (0 when
  // the OS does not report it).
  std::vector<int> observeOutput();
  int inputSessionId() const;
  void stop();
  void prepareResume();
  int sampleRate() const { return sampleRate_; }
  std::vector<std::uint64_t> benchmark(const std::vector<float> &planarLoop,
                                       std::uint32_t channels, std::uint32_t warmupBlocks,
                                       std::uint64_t durationNs);
  int outputDeviceId() const;
  // Latency mode: 0 interactive, 1 balanced, 2 playback. Applies both settings
  // with one reopen of a running output.
  int setOutput(int deviceId, int mode);
  int setOutputDevice(int deviceId) { return setOutput(deviceId, latency_); }
  int setLatency(int mode) { return setOutput(preferredOutput_, mode); }
  int setInputDevice(int deviceId);
  int setNetworkOutput(bool attached, bool paused);
  int setNetworkLocalDelay(unsigned request, bool active, double ms, bool local);
  int setNetworkReceiveSession(bool active, std::uint64_t generation);
  void setLiveInput(bool enabled);
  void activateLiveInput(std::uint64_t generation);
  // 0: retry, 1: accepted, 2: accepted and the initial preroll is complete.
  int writeLivePcm(const float *pcm, unsigned frames);
  double livePosition() const noexcept;
  bool popNetworkPacket(audio::NetworkPacket &packet);
  std::uint64_t networkFrame() const { return session_.position(); }
  int acknowledgeNetwork(std::uint64_t epoch, std::uint64_t frame);
  std::string networkReports(bool force);
  int startParallel(int scoreFd, double speed);
  void stopParallel();
  int selectParallel(int branch, double seconds);
  int setOutputDelay(int branch, int samples);
  int fadeOutput(int branch, float gain, double seconds);
  std::vector<int>
  configure(const std::vector<std::string> &types,
            const std::vector<std::vector<float>> &parameters,
            const std::vector<std::uint32_t> &hashes,
            const std::vector<std::uint32_t> &ids,
            std::vector<std::uint8_t> descriptor,
            const std::vector<std::vector<std::uint8_t>> &structured = {},
            const std::vector<std::uint8_t> &flags = {}, int branch = 0);
  int setParameters(int instance, std::vector<float> values,
                    std::uint32_t hash, int branch = 0);
  int setParameterBytes(int instance, std::vector<std::uint8_t> values,
                        std::uint32_t hash, int branch = 0);
  int setAsset(int instance, int slot, const AssetBeginInfo &info,
               const std::vector<std::uint8_t> &bytes, std::uint32_t format,
               std::optional<std::uint32_t> revision = {}, int branch = 0);
  int setAssetFile(int instance, int slot, const AssetBeginInfo &info, int fd,
                   std::uint32_t byteSize, std::uint32_t format,
                   std::optional<std::uint32_t> revision = {}, int branch = 0);
  int assetState(int instance, int slot, int branch);
  int setVisualizerSources(std::vector<audio::VisualizerSource> sources);
  std::vector<int> runtimeEvents();
  // CPU percentage (-1 when no new second has elapsed) and pipeline latency.
  std::vector<double> pipelineStats(int branch = 0);
  // Desktop audioProcessingOverload event: 1 active, 0 cleared, -1 none.
  int takeOverload() { return session_.takeOverload(); }
  // Desktop setDisplayDspBypassed: display-only effects run as passthrough.
  int setDisplayBypass(bool bypass);
  // Graph test tone; a frequency of zero releases it.
  void setFrequencyPreview(double frequency, bool noise);
  // Clears one instance's temporal state, as the desktop resetPluginState does.
  int resetPlugin(int instance);
  // Applies one SoundFont Player mixer action as the desktop soundFontMixerAction does: either a
  // channel mute/solo mix (mix >= 0) or up to three control-only MIDI messages. Returns the
  // applied frame, or a negative status.
  std::int64_t soundFontMixerAction(int instance, int channel, int mix,
                                    const std::vector<std::uint32_t> &messages);
  std::vector<double> sfzPreparationContext(int instance, int branch = 0);
  double scoreTransport(int fd, double position, double speed, bool play);
  double scorePosition();
  double pauseScore();
  void scoreSpeed(double speed);
  bool takeScoreEnded();
  int liveMidiSource(bool enabled);
  int liveMidiEvent(unsigned message, unsigned note, unsigned flags,
                    std::optional<std::vector<et_midi_event>> history, double delay);
  int setMidiMetering(int instance, bool enabled, int branch = 0);
  std::vector<std::int64_t> sampleStreams(int branch = 0);
  std::vector<std::int64_t> pollSamplePages(int instance, std::uint64_t generation, std::uint32_t token, int branch = 0);
  int publishSamplePage(int instance, std::uint64_t generation, std::uint32_t token,
                        unsigned sample, std::uint64_t page, const std::vector<float> &pcm,
                        int frames, int channels, bool resident, int branch = 0);
  int failSampleStream(int instance, std::uint64_t generation, std::uint32_t token, int branch = 0);
  std::vector<int> assetNotices(int branch = 0);
  int pcmChannels() const { return pcm_.channels(); }
  std::uint64_t beginSource() { return pcm_.beginSource(); }
  int writablePcmFrames(std::uint64_t generation) const { return pcm_.writableFrames(generation); }
  std::uint32_t writePcm(const float *data, std::uint32_t frames,
                         std::uint64_t generation) {
    return pcm_.write(data, frames, generation);
  }
  std::uint32_t queuedFrames() const { return pcm_.queued(); }
  std::uint64_t renderedFrames() const { return rendered_.load(); }
  void setPlaying(bool playing) { playing_.store(playing); }
  void setBypass(bool bypass);
  void setGain(float gain) { gain_.store(gain); }
  void setPlayerGain(float gain) { playerGain_.store(gain); }
  void beginMeasurementFiles(int excitationFd, int resultFd,
                             std::uint32_t excitationFrames,
                             std::uint32_t captureFrames,
                             float overloadPeak = 0,
                             std::uint32_t overloadTailFrames = 0,
                             int inputChannel = 0);
  void cancelMeasurement();
  void setMeasurementNoiseFile(int fd, std::uint32_t frames);
  void stopMeasurementNoise();
  int openMeasurementStreams(int rate, int inputDevice, int outputDevice, int width);
  void startDuplexCapture(int excitationFd, int resultFd, unsigned excitationFrames,
                          unsigned frames, float overloadPeak, unsigned overloadTail, int channel);
  int closeMeasurementStreams(bool restart);
  int measurementChannels() const { return streamChannels_; }
  int measurementRate() const {
    return output_ && input_ && output_->getSampleRate() == input_->getSampleRate()
               ? input_->getSampleRate() : 0;
  }
  int measurementInputDevice() const { return input_ ? input_->getDeviceId() : 0; }
  void setMeasurementPipeline(bool enabled) { measurementPipeline_.store(enabled); }
  // Measurement level adjustment: -1 off, otherwise the metered input channel
  // (0 left, 1 right, 2 average). While on, the input only feeds the level
  // meter and never reaches the playback path.
  void setMeasurementMeter(int channel) { meterChannel_.store(channel); }
  std::vector<int> measurementState();
  void setPowerSettings(float threshold, float monitoringSeconds,
                        bool mustProcess);
  std::vector<float> powerObservation();
  // Largest input peak since the previous call; only the level meter calls it.
  float meterLevel();
  int scheduleParameters(int instance, std::vector<float> values,
                         std::uint32_t hash, std::uint64_t frame);
  std::uint64_t audioFrameTime();
  // Desktop setSpectrumTap / setSpectrumTapRoute for the Spectrum overlay.
  int setSpectrumTap(unsigned id, bool enabled, bool compare, bool hq);
  int setSpectrumTapRoute(unsigned id, bool enabled);
  // Pending overlay frames, each packed by packSpectrumFrame() in native_engine.cpp.
  std::vector<std::uint8_t> drainSpectrum();
  // Telemetry packets, each a 40-byte little-endian header (end frame, mixer end
  // frame, route revision, byte count, dropped frames, tap stage) and its payload.
  std::vector<std::uint8_t> telemetryPackets();
  // Desktop render clock: the pipeline frame starting the latest callback, its
  // steady-clock time in ns, and the output latency in pipeline frames. Empty
  // while the output is stopped or the latency is unknown.
  std::vector<double> visualClock();
  // Desktop setVisualSync and setOutputDelay for Sync Visuals to Audio.
  int setVisualSync(bool enabled);
  // Returns the clamped delay target or a negative status.
  int setVisualSyncDelay(unsigned samples);
  unsigned appliedOutputDelay() { return session_.output().appliedDelay(); }
  oboe::DataCallbackResult onAudioReady(oboe::AudioStream *, void *,
                                        std::int32_t) override;

private:
  friend struct NativeEngineTestAccess;
  int openOutput();
  struct Command {
    enum class Kind {
      Run,
      Resume,
      Input,
      MeasurementStart,
      MeasurementCancel,
      MeasurementState,
      MeasurementNoise,
      PowerSettings,
      PowerObservation,
      AudioFrameTime
    } kind;
    int (*work)(void *) noexcept = nullptr;
    void *context = nullptr;
    std::shared_ptr<oboe::AudioStream> input;
    std::vector<float> floats;
    std::unique_ptr<FiniteCapture> capture;
    std::uint32_t inputBurst = 0;
    std::uint64_t frame = 0;
    int result = ET_OK;
    std::atomic<bool> done{false};
    explicit Command(Kind operation) : kind(operation) {}
  };
  int submit(Command &command);
  void startMeasurementSignal(Command &command);
  template <typename Work> int run(Work work) {
    Command command(Command::Kind::Run);
    command.context = &work;
    command.work = [](void *context) noexcept -> int { return (*static_cast<Work *>(context))(); };
    return submit(command);
  }
  void closeOutput();
  // Desktop DeviceHost contract: the callback fades the output closed, hands
  // the graph to control, and settles it again after release.
  enum class Owner { Audio, Requested, Control, Returned };
  void acquire();
  void release() noexcept;
  int prepareAsset(int instance, int slot, const AssetBeginInfo &info,
                   const std::uint8_t *data, std::uint32_t byteSize,
                   std::uint32_t format, std::optional<std::uint32_t> revision, int branch);
  audio::Session &assetSession(int branch);
  int applyParameters(audio::PluginSettings &settings, int branch = 0) noexcept;
  int submitAssetChange(const std::shared_ptr<audio::Pipeline::AssetChange> &change, int branch);
  int activateBank(const std::shared_ptr<audio::Pipeline::AssetChange> &change);
  void resetTemporal() noexcept;
  void apply(Command &command) noexcept;
  void applyPending() noexcept;
  audio::Session session_;
  bool networkAttached_ = false;
  std::optional<std::uint64_t> reportedRoute_;
  std::shared_ptr<oboe::AudioStream> output_, input_;
  std::unique_ptr<oboe::LatencyTuner> tuner_;
  std::shared_ptr<OutputError> outputError_;
  int lastOutputError_ = 0;
  int latency_ = 1;
  std::atomic<Owner> owner_{Owner::Audio};
  std::atomic<bool> renderFailed_{false};
  std::atomic<int> renderFailures_{0}, sourceUnderruns_{0}, inputUnderruns_{0};
  std::atomic<Command *> pending_{nullptr};
  PcmRing<65536> pcm_;
  struct LiveInput;
  std::unique_ptr<LiveInput> liveInput_;
  std::vector<float> microphone_, planarIn_, planarOut_;
  std::vector<float> measurementPlanar_;
  std::int32_t sampleRate_, maxFrames_;
  const std::int32_t channels_;
  std::int32_t streamChannels_;
  bool directMeasurementStreams_ = false;
  int preferredOutput_ = 0;
  std::uint32_t inputBurst_ = 0;
  // A newly opened live input waits once for its startup margin.
  bool inputPrimed_ = true;
  std::int32_t inputWait_ = 0;
  bool running_ = false;
  std::atomic<bool> playing_{false};
  std::atomic<float> gain_{1};
  std::atomic<float> playerGain_{1};
  std::atomic<std::uint64_t> rendered_{0};
  std::uint64_t clockFrames_ = 0;
  // Seqlock-published render clock read by visualClock().
  std::atomic<std::uint64_t> clockSequence_{0}, clockTimeNs_{0}, clockPosition_{0};
  std::unique_ptr<FiniteCapture> capture_;
  std::vector<float> measurementNoise_;
  std::atomic<bool> measurementPipeline_{false};
  std::uint32_t noisePosition_ = 0;
  float silenceThreshold_ = 0.0001F, monitoringSeconds_ = 60;
  bool mustProcess_ = true, monitoring_ = false;
  std::uint64_t silenceFrames_ = 0;
  float inputPeak_ = 0, outputPeak_ = 0, meterPeak_ = 0;
  std::atomic<int> meterChannel_{-1};
  struct TimedParameters {
    bool active = false;
    std::uint64_t frame = 0;
    audio::PluginSettings settings;
  };
  std::array<TimedParameters, 64> scheduled_{};
  std::map<std::uint32_t, audio::PluginSettings> settings_;
  std::vector<std::uint32_t> instruments_;
  bool scoreRunning_ = false, liveMidi_ = false;
  unsigned scoreWaiting_ = 0; // One bit per scheduler still preparing the common start.
  double scoreDuration_ = 0;
  struct LiveDelivery {
    std::array<audio::MidiScheduler::LiveTarget, 128> targets{};
    std::uint64_t batch = 0;
  };
  std::vector<std::unique_ptr<LiveDelivery>> liveDeliveries_;
  struct ParallelMidi {
    std::map<std::uint32_t, audio::PluginSettings> settings;
    audio::MidiScheduler *scheduler;
    std::vector<std::unique_ptr<LiveDelivery>> deliveries;
    std::array<std::pair<unsigned, unsigned>, 128> hydrated{};
    std::vector<audio::MidiScheduler::LiveTarget> targets;
    bool refreshTargets = true;
  };
  std::unique_ptr<ParallelMidi> parallelMidi_;
  bool refreshParallelMidiTargets();
  void discardParallel();
  std::vector<et_midi_event> liveChannelState_;
  std::array<std::pair<unsigned, unsigned>, 128> hydratedMidi_{};
};

} // namespace effetune::android
#endif

#ifndef EFFETUNE_ANDROID_NATIVE_ENGINE_H
#define EFFETUNE_ANDROID_NATIVE_ENGINE_H

#include "engine.h"
#include "finite_capture.h"
#include "output_error.h"
#include "pcm_ring.h"
#include <atomic>
#include <memory>
#include <oboe/Oboe.h>
#include <string>
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
  NativeEngine(std::int32_t sampleRate, std::int32_t maxFrames);
  ~NativeEngine() override;
  int start();
  int outputStatus();
  int inputSessionId() const;
  void stop();
  void prepareResume();
  int sampleRate() const { return sampleRate_; }
  int outputDeviceId() const;
  int setOutputDevice(int deviceId);
  int setInputDevice(int deviceId);
  std::vector<int>
  configure(const std::vector<std::string> &types,
            const std::vector<std::vector<float>> &parameters,
            const std::vector<std::uint32_t> &hashes,
            std::vector<std::uint8_t> descriptor,
            const std::vector<std::vector<std::uint8_t>> &structured = {});
  int setParameters(int instance, std::vector<float> values,
                    std::uint32_t hash);
  int setParameterBytes(int instance, std::vector<std::uint8_t> values,
                        std::uint32_t hash);
  int setAsset(int instance, int slot, const AssetBeginInfo &info,
               const std::vector<std::uint8_t> &bytes, std::uint32_t format);
  int setAssetFile(int instance, int slot, const AssetBeginInfo &info, int fd,
                   std::uint32_t byteSize, std::uint32_t format);
  std::vector<std::uint8_t> telemetry();
  std::vector<int> runtimeEvents();
  std::uint64_t beginSource() { return pcm_.beginSource(); }
  std::uint32_t writePcm(const float *data, std::uint32_t frames,
                         std::uint64_t generation) {
    return pcm_.write(data, frames, generation);
  }
  std::uint32_t queuedFrames() const { return pcm_.queued(); }
  std::uint64_t renderedFrames() const { return rendered_.load(); }
  void setPlaying(bool playing) { playing_.store(playing); }
  void setBypass(bool bypass) { bypass_.store(bypass); }
  void setGain(float gain) { gain_.store(gain); }
  void setPlayerGain(float gain) { playerGain_.store(gain); }
  void beginMeasurementFiles(int excitationFd, int resultFd,
                             std::uint32_t excitationFrames,
                             std::uint32_t captureFrames);
  void cancelMeasurement();
  void setMeasurementNoiseFile(int fd, std::uint32_t frames);
  void stopMeasurementNoise();
  std::vector<int> measurementState();
  void setPowerSettings(float threshold, float monitoringSeconds,
                        bool mustProcess);
  std::vector<float> powerObservation();
  int scheduleParameters(int instance, std::vector<float> values,
                         std::uint32_t hash, std::uint64_t frame);
  std::uint64_t audioFrameTime();
  oboe::DataCallbackResult onAudioReady(oboe::AudioStream *, void *,
                                        std::int32_t) override;

private:
  friend struct NativeEngineTestAccess;
  struct Command {
    enum class Kind {
      Replace,
      Resume,
      Parameters,
      Bytes,
      CaptureAsset,
      ApplyAsset,
      Telemetry,
      RuntimeEvents,
      Input,
      MeasurementStart,
      MeasurementCancel,
      MeasurementState,
      MeasurementNoise,
      PowerSettings,
      PowerObservation,
      ScheduleParameters,
      AudioFrameTime,
      CaptureLatency,
      ApplyLatency
    } kind;
    std::unique_ptr<Engine> engine;
    std::shared_ptr<oboe::AudioStream> input;
    std::vector<float> floats;
    std::unique_ptr<FiniteCapture> capture;
    std::vector<std::uint8_t> bytes;
    Engine::InstanceAssetSnapshot snapshot;
    Engine::InstanceAssetUpdate asset;
    Engine::PipelineLatencySnapshot latencySnapshot;
    Engine::PipelineLatencyUpdate latencyUpdate;
    std::uint32_t instance = 0, hash = 0, slot = 0;
    std::uint32_t inputBurst = 0;
    std::uint64_t frame = 0;
    int result = ET_OK;
    std::atomic<bool> done{false};
    explicit Command(Kind operation) : kind(operation) {}
  };
  int submit(Command &command);
  void closeOutput();
  int prepareAsset(int instance, int slot, const AssetBeginInfo &info,
                   const std::uint8_t *data, std::uint32_t byteSize,
                   std::uint32_t format);
  void apply(Command &command) noexcept;
  void applyPending() noexcept;
  std::unique_ptr<Engine> engine_;
  std::shared_ptr<oboe::AudioStream> output_, input_;
  std::shared_ptr<OutputError> outputError_;
  int lastOutputError_ = 0;
  std::atomic<Command *> pending_{nullptr};
  PcmRing<65536> pcm_;
  std::vector<float> microphone_;
  std::int32_t sampleRate_, maxFrames_;
  int preferredOutput_ = 0;
  std::uint32_t inputBurst_ = 0;
  bool running_ = false;
  std::atomic<bool> playing_{false}, bypass_{false};
  std::atomic<float> gain_{1};
  std::atomic<float> playerGain_{1};
  std::atomic<std::uint64_t> rendered_{0};
  std::uint64_t clockFrames_ = 0;
  std::unique_ptr<FiniteCapture> capture_;
  std::vector<float> measurementNoise_;
  std::uint32_t noisePosition_ = 0;
  float silenceThreshold_ = 0.0001F, monitoringSeconds_ = 60;
  bool mustProcess_ = true, monitoring_ = false;
  std::uint64_t silenceFrames_ = 0;
  float inputPeak_ = 0, outputPeak_ = 0;
  struct TimedParameters {
    bool active = false;
    std::uint32_t instance = 0, hash = 0, count = 0;
    std::uint64_t frame = 0;
    std::array<float, 1024> values{};
  };
  std::array<TimedParameters, 64> scheduled_{};
  std::vector<std::array<std::uint32_t, 3>> contracts_;
  std::vector<int> legacyAssetInstances_;
};

} // namespace effetune::android
#endif

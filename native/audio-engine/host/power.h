#pragma once
#include <array>
#include <atomic>
#include <cstdint>
#include <span>

namespace effetune::audio {
class Pipeline;
enum class Directive { full, automatic, monitor, bypass, zero };
struct PowerConfig {
  bool enabled = false, fast = false, skip = false, wakeAny = false, telemetry = true,
       displayBypass = false;
  unsigned graph = 0, topology = 0, rate = 48000, pluginCount = 0;
  double threshold = 1e-8, wakeFloor = 1e-8, seconds = 1;
  std::array<unsigned, 128> ids{}, resets{};
  unsigned count = 0, resetCount = 0;
  bool coverageValid = true;
};
struct PowerState {
  static constexpr std::int64_t none = -1;
  unsigned graph = 0, topology = 0, midiGeneration = 0;
  unsigned runtimeRevision = 0;
  std::uint64_t activityEpoch = 0;
  Directive directive = Directive::full;
  enum class Arm { disarmed, armed, consumed } arm = Arm::disarmed;
  std::int64_t command = none, epoch = none, armSequence = none, observation = none;
  std::uint64_t sequence = 0, skipped = 0, fullQuanta = 0, monitorQuanta = 0, zeroQuanta = 0,
                bypassQuanta = 0;
  bool monitoring = false, fast = false, inputActive = false, outputActive = false,
       midiPending = false, sfzPending = false;
  double inputPower = 0, outputPower = 0;
};
struct PowerEvent {
  enum class Type { first, observation, heartbeat, instrumentCheckpoint } type;
  const char *reason = nullptr;
  PowerState state;
};
class PowerControl {
public:
  const PowerState &state() const noexcept { return state_; }
  const PowerConfig &config() const noexcept { return config_; }
  bool enabled() const noexcept { return config_.enabled; }
  bool checkpointRequested() const noexcept { return waitingCheckpoint_; }
  void setDisplayBypass(bool bypass) noexcept { config_.displayBypass = bypass; }
  void configure(PowerConfig config, Pipeline &pipeline, Directive guard, std::int64_t guardId,
                 std::int64_t guardEpoch);
  bool command(Directive directive, std::int64_t id, std::int64_t epoch, std::int64_t after,
               bool preserve);
  bool resume(Pipeline &pipeline, std::int64_t command, std::int64_t epoch, std::int64_t resumeId);
  void request(std::int64_t id) noexcept { requested_ = id; }
  void requestWhileDisabled(std::int64_t id, unsigned graph, unsigned topology,
                            unsigned rate) noexcept;
  // Wakes automatic monitoring after a control changed what the pipeline must
  // render, matching the worklet's _invalidatePowerSkipForMutation.
  void mutation(Pipeline &pipeline) noexcept;
  void activity() noexcept { silent_ = 0; }
  void threshold(double db) noexcept;
  void resetLevels() noexcept {
    input_ = {};
    output_ = {};
    silent_ = heartbeat_ = 0;
  }
  bool begin(Pipeline &pipeline, const float *input, unsigned channels, unsigned frames,
             bool sourceActive = false) noexcept;
  void finish(Pipeline &pipeline, const float *output, unsigned channels, unsigned frames,
              bool ran) noexcept;
  bool take(PowerEvent &event) noexcept;

private:
  struct Detector {
    std::array<double, 16> x{}, y{};
    double ewma = 0;
  };
  struct Level {
    double mean = 0, peak = 0;
    bool nonfinite = false;
  };
  Level measure(const float *audio, unsigned channels, unsigned frames,
                Detector &detector) noexcept;
  bool emit(PowerEvent::Type type, const char *reason) noexcept;
  void full() noexcept;
  PowerConfig config_;
  PowerState state_;
  Detector input_, output_;
  Level inputLevel_;
  double dc_ = 0;
  std::uint64_t silent_ = 0, heartbeat_ = 0;
  std::int64_t lastCommand_ = -1, lastEpoch_ = -1, first_ = -1, requested_ = -1;
  bool settled_ = false, warmup_ = false;
  bool sourceActive_ = false;
  bool waitingCheckpoint_ = false;
  const char *reason_ = nullptr;
  std::array<PowerEvent, 64> events_;
  std::atomic<unsigned> read_{0}, write_{0};
};
} // namespace effetune::audio

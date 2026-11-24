#pragma once
#include "effetune/abi.h"
#include "midi.h"

#include <array>
#include <atomic>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <span>
#include <string>
#include <utility>
#include <vector>

namespace effetune {
class Engine;
struct RuntimeEventState;
namespace audio {
struct NetworkPaths;
struct BoundarySlice;
struct PluginSettings {
  std::uint32_t id = 0;
  std::string type;
  std::uint32_t layoutHash = 0;
  std::vector<float> params;
  std::vector<std::uint8_t> bytes;
  bool skip = false;
  bool displayOnly = false;
  std::optional<bool> assetPending = std::nullopt;
  std::uint32_t noteAnalysisSource = 0;
  std::string sf{};
  unsigned midiChannelMask = 0;
};

struct AssetData {
  std::vector<std::uint8_t> payload;
  std::uint32_t headBlock = 0, rateDivider = 1, pathCount = 0, inputCount = 0;
  std::uint32_t processingChannels = 0, footprintBytes = 0, formatTag = 0;
  std::optional<double> minimumPhysicalBpm;
  std::optional<std::uint32_t> operationRevision, replayEpoch;
  std::uint32_t reportedState = UINT32_MAX;
};

// The caller owns the engine between callbacks while changing the topology.
class Pipeline {
public:
  class TopologyChange {
  public:
    virtual ~TopologyChange() = default;
    virtual bool capture() noexcept = 0;
    virtual bool prepare() = 0;
    virtual bool publish() noexcept = 0;
    virtual bool retryable() const noexcept { return false; }
  };
  std::unique_ptr<TopologyChange> prepareChange(std::vector<PluginSettings> plugins,
                                                std::vector<std::uint8_t> descriptor);
  std::unique_ptr<TopologyChange> prepareDisplay(bool bypass);
  Pipeline(Engine &engine, unsigned rate, unsigned maxFrames)
      : engine_(engine), rate_(rate), maxFrames_(maxFrames) {}
  bool configure(std::vector<PluginSettings> plugins, std::vector<std::uint8_t> descriptor);
  bool update(const PluginSettings &settings);
  bool updateOwned(PluginSettings &settings);
  bool stageUpdate(PluginSettings &settings, bool allowGate, bool &deferred);
  bool finishUpdates() noexcept;
  std::uint32_t instance(std::uint32_t id) const noexcept;
  bool readRuntimeEvent(std::uint32_t id, RuntimeEventState &state) const noexcept;
  unsigned kernelLatency(unsigned id) const noexcept;
  bool setNetworkRouting(bool receive, bool bypass);
  void traceOutputs(NetworkPaths &paths) const noexcept;
  void streamBoundary(BoundarySlice &slice) noexcept;
  std::uint32_t sendInstance() const noexcept { return sendInstance_; }
  std::uint32_t sendId() const noexcept { return sendId_; }
  std::uint32_t receiveId() const noexcept { return receiveId_; }
  class AssetChange {
  public:
    virtual ~AssetChange() = default;
    virtual bool capture() = 0;
    virtual bool prepare() = 0;
    virtual bool captureRoute() noexcept = 0;
    virtual bool prepareRoute() = 0;
    virtual bool apply() noexcept = 0;
    virtual void finish() = 0;
    virtual bool deferred() const noexcept = 0;
    virtual bool stale() const noexcept = 0;
    virtual unsigned state() const noexcept = 0;
    virtual const char *failureStage() const noexcept = 0;
    virtual bool awaitsPages() const noexcept = 0;
    virtual void retain(std::shared_ptr<AssetChange> self) = 0;
    virtual bool publish(std::uint64_t generation, unsigned sample, std::uint64_t page,
                         std::span<const float> pcm, unsigned frames, unsigned channels,
                         bool resident) = 0;
  };
  std::shared_ptr<AssetChange> assetChange(unsigned id, unsigned slot,
                                           std::optional<AssetData> asset);
  std::uint32_t assetState(std::uint32_t id, std::uint32_t slot) const noexcept;
  struct AssetNotice {
    std::uint32_t id = 0, slot = 0, state = 0;
    std::optional<std::uint32_t> revision, epoch;
    bool rejected = false;
    unsigned identity = 0;
    AssetChange *completed = nullptr;
  };
  std::shared_ptr<AssetChange> releaseBank(AssetChange *bank);
  bool takeAssetLatencyChange() noexcept { return std::exchange(assetLatencyChanged_, false); }
  void serviceAssets();
  bool takeNotice(AssetNotice &notice) noexcept;
  struct SampleStream {
    std::uint64_t generation = 0, nextPollNs = 0;
    std::optional<std::uint32_t> operationRevision, replayEpoch;
    bool announced = false, pollPending = false;
  };
  const auto &streams() const noexcept { return streams_; }
  SampleStream *sampleStream(std::uint32_t id);
  std::shared_ptr<AssetChange> pendingStream(unsigned id) const;
  void cancelStream(unsigned id);
  bool takeRequests(std::uint32_t id, std::span<et_sfz_sample_request> buffer, std::uint32_t &count,
                    et_stream_readiness &readiness, std::uint64_t frame, bool &limited);
  bool publishPage(std::uint32_t id, std::uint64_t generation, std::uint32_t sample,
                   std::uint64_t page, std::span<const float> pcm, std::uint32_t frames,
                   std::uint32_t channels, bool resident);
  MidiScheduler midi;
  bool prepareMidi();
  void renderMidi(std::uint64_t frame, unsigned frames, unsigned rate) noexcept;
  bool hydrateMidi(unsigned id, unsigned token, unsigned generation,
                   std::span<const et_midi_event> events);
  unsigned processingChannels(unsigned id, unsigned width) const noexcept;
  unsigned remainingLatency(unsigned instance) const noexcept;
  bool coverage(std::span<const unsigned> ids) const noexcept;
  bool resetTemporal(std::span<const unsigned> ids) noexcept;
  bool assetPending() const noexcept;
  bool needsInstrumentCheckpoint() const noexcept;
  unsigned runtimeRevision() const noexcept { return runtimeRevision_; }
  bool holdsInsertedAsset() noexcept;
  struct Instrument {
    Engine &engine;
    const PluginSettings &settings;
    MidiScheduler::Instrument target;
    std::optional<unsigned> replayEpoch;
  };
  std::optional<Instrument> instrument(unsigned id);
  auto instrumentIds() const noexcept { return std::span<const unsigned>(order_); }
  bool freeze(unsigned id, std::uint64_t frame, bool fresh, bool sameContext, bool resume);
  void resumeInstruments() noexcept;
  void preview(bool active) noexcept;

private:
  class Change;
  class Bank;
  class Display;
  struct Slot {
    PluginSettings settings;
    PluginSettings pendingSettings;
    bool pendingUpdate = false;
    std::uint32_t kernel = 0;
    std::uint32_t passthrough = 0;
    std::vector<float> dryParameters;
    bool holdAsset = false;
    struct Freeze {
      std::uint64_t clock = 0, frame = 0;
      unsigned generation = 0, nativeState = 0;
      bool fresh = false, sameContext = false, resume = false;
    };
    std::optional<Freeze> frozen{};
    std::optional<std::uint64_t> lastBoundary{};
    MidiScheduler::Forecast forecast{};
    bool streaming = false;
    unsigned announcedHandle = 0, announcedToken = 0;
  };
  bool stage(Slot &slot, const PluginSettings &settings, bool force);
  bool applyAsset(std::uint32_t id, std::uint32_t kernel, std::uint32_t slot,
                  const AssetData &asset, bool sampler);
  std::map<std::uint32_t, SampleStream> streams_;
  std::map<unsigned, std::shared_ptr<AssetChange>> pendingStreams_;
  std::uint64_t streamGeneration_ = 0;
  Engine &engine_;
  unsigned rate_, maxFrames_;
  unsigned runtimeRevision_ = 0;
  std::map<std::uint32_t, Slot> slots_;
  std::map<std::pair<std::uint32_t, std::uint32_t>, AssetData> assets_;
  Bank *waitingBanks_ = nullptr;
  std::atomic<Bank *> completedBanks_{nullptr};
  Bank *collectedBanks_ = nullptr;
  std::map<AssetChange *, std::shared_ptr<AssetChange>> pendingBanks_;
  std::atomic<bool> hasPendingAssets_{false};
  bool assetLatencyChanged_ = false;
  void serviceBanks() noexcept;
  void cancelBanks(unsigned id, std::optional<unsigned> slot = {}) noexcept;
  bool takeBankNotice(AssetNotice &notice) noexcept;
  bool validAsset(unsigned id, unsigned slot, const AssetData &candidate) const;
  bool materializeInstrument(bool soundfont, AssetData &asset) const;
  std::uint64_t availableAssetBytes(unsigned id, unsigned slot) const;
  bool publishNotice(const AssetNotice &notice) noexcept;
  std::array<AssetNotice, 512> notices_;
  std::atomic<unsigned> noticeRead_{0}, noticeWrite_{0};
  bool applyRouting();
  void connectAnalysisSources() noexcept;
  unsigned midiTargets(std::array<MidiScheduler::Instrument, 128> &targets) const noexcept;
  std::vector<std::uint8_t> descriptor_, activeDescriptor_;
  std::vector<std::uint32_t> order_;
  std::set<std::uint32_t> skippedPrefix_;
  bool receiving_ = false, masterBypass_ = false;
  bool preview_ = false;
  bool displayBypass_ = false;
  std::uint32_t sendId_ = 0, receiveId_ = 0, sendInstance_ = 0;
};
} // namespace audio
} // namespace effetune

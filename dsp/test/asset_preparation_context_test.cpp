#include "allocation_guard.h"
#include "engine.h"
#include "registry.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <memory>

namespace {
using namespace effetune;
void require(bool condition, const char *message) {
  if (!condition) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
struct Parameters {
  static constexpr std::uint32_t kHash = 1, kFloatCount = 0;
};
struct ContextAsset final : PreparedAsset {
  PrepareInfo context;
  explicit ContextAsset(const PrepareInfo &value) : context(value) {}
};
PrepareInfo lastPrepared{};
class ContextKernel final : public PluginKernel {
  EFFETUNE_PARAMS(Parameters)
public:
  static inline ContextKernel *latest = nullptr;
  ContextKernel() { latest = this; }
  void prepare(const PrepareInfo &) override {}
  void reset() noexcept override {}
  void process(float *, std::uint32_t, std::uint32_t, const ProcessInfo &) noexcept override {}
  static std::uint32_t assetCapacityForSlot(std::uint32_t slot) noexcept {
    return slot == 0 ? 4096 : 0;
  }
  std::uint32_t assetCapacity(std::uint32_t slot) const noexcept override {
    return assetCapacityForSlot(slot);
  }
  et_status setMidiTransportMap(const et_midi_transport_point *points,
                                std::uint32_t count) noexcept override {
    if (count && !points)
      return ET_ERR_ARGS;
    double minimum = 0;
    for (auto i = 0u; i < count; ++i) {
      if (!std::isfinite(points[i].bpm) || points[i].bpm <= 0)
        return ET_ERR_ARGS;
      if (!i || points[i].bpm < minimum)
        minimum = points[i].bpm;
    }
    minimum_ = minimum * .25;
    return ET_OK;
  }
  double minimumMidiPreparationBpm() const noexcept override { return minimum_; }
  std::uint64_t midiClock() const noexcept override { return 42; }
  std::uint8_t *beginAsset(std::uint32_t, const AssetBeginInfo &) noexcept override {
    ++begins;
    return payload.data();
  }
  std::uint8_t *beginAssetWithContext(std::uint32_t slot, const AssetBeginInfo &info,
                                      const PrepareInfo &context) noexcept override {
    staged = context;
    return beginAsset(slot, info);
  }
  void clearAsset(std::uint32_t) noexcept override { active.reset(); }
  static et_status prepareAsset(const PrepareInfo &context, const AssetBeginInfo &,
                                const std::uint8_t *, std::uint32_t,
                                std::unique_ptr<PreparedAsset> &asset) noexcept {
    lastPrepared = context;
    asset.reset(new (std::nothrow) ContextAsset(context));
    return asset ? ET_OK : ET_ERR_OOM;
  }
  AssetPreparer assetPreparer(std::uint32_t slot) const noexcept override {
    return slot == 0 ? &prepareAsset : nullptr;
  }
  et_status exchangePreparedAsset(std::uint32_t,
                                  std::unique_ptr<PreparedAsset> &asset) noexcept override {
    active.swap(asset);
    return ET_OK;
  }
  double installedMinimum() const noexcept {
    return active ? static_cast<const ContextAsset *>(active.get())->context.minimumPhysicalBpm
                  : -1;
  }
  PrepareInfo staged{};
  std::uint32_t begins = 0;

private:
  double minimum_ = 0;
  std::array<std::uint8_t, 4> payload{};
  std::unique_ptr<PreparedAsset> active;
};
const KernelDescriptor *descriptor() noexcept {
  static constexpr KernelDescriptor result{"ContextTestPlugin",
                                           Parameters::kHash,
                                           0,
                                           0,
                                           &ContextKernel::assetCapacityForSlot,
                                           sizeof(ContextKernel),
                                           alignof(ContextKernel),
                                           &constructKernel<ContextKernel>,
                                           &destroyKernel<ContextKernel>};
  return &result;
}
} // namespace

// This executable's single dummy descriptor isolates core asset ownership and
// preparation from sampler behavior. The normal registry remains unchanged.
namespace effetune::registry {
std::uint32_t count() noexcept { return 1; }
const KernelDescriptor *at(std::uint32_t index) noexcept { return index ? nullptr : descriptor(); }
const KernelDescriptor *find(const char *) noexcept { return descriptor(); }
} // namespace effetune::registry

int main() {
  using namespace effetune;
  auto engine = std::make_unique<Engine>();
  require(engine->prepare(48000, 2, 64, 0) == ET_OK, "prepare core");
  const auto instance = engine->createInstance("ContextTestPlugin");
  require(instance != 0, "create context dummy");
  auto *kernel = ContextKernel::latest;
  const AssetBeginInfo info{1, 1, 0, 0, 1, 0, 0, 2, 64, 4};
  const std::array<std::uint8_t, 4> payload{};
  et_midi_transport_point point{0, 0, 0, 120, 4, 4};
  const auto map = [&](double bpm) {
    point.bpm = bpm;
    return engine->setInstanceMidiTransportMap(instance, &point, 1);
  };
  const auto prepare = [&](const Engine::InstanceAssetSnapshot &snapshot,
                           Engine::InstanceAssetUpdate &update) {
    return Engine::prepareInstanceAssetUpdate(snapshot, info, payload.data(),
                                              static_cast<std::uint32_t>(payload.size()),
                                              ET_ASSET_F32_MULTICH, update);
  };
  const auto apply = [&](Engine::InstanceAssetUpdate &update) {
    allocation_guard::Scope guard;
    return engine->applyInstanceAssetUpdate(update);
  };
  require(map(120) == ET_OK, "install old map");
  require(engine->beginInstanceAsset(instance, 0, info, 15) != nullptr &&
              kernel->staged.minimumPhysicalBpm == 15 && kernel->staged.sampleRate == 48000 &&
              kernel->staged.maxChannels == 2 && kernel->staged.maxFrames == 64 &&
              kernel->minimumMidiPreparationBpm() == 30 &&
              engine->instanceMidiClock(instance) == 42,
          "atomic candidate context does not change the active map or clock");
  require(engine->beginInstanceAsset(instance, 0, info, 0) != nullptr &&
              kernel->staged.minimumPhysicalBpm == 0,
          "explicit standalone zero is distinct from an absent override");
  require(engine->beginInstanceAsset(instance, 0, info) != nullptr &&
              kernel->staged.minimumPhysicalBpm == 30,
          "legacy begin captures the current getter");

  Engine::InstanceAssetSnapshot snapshot, invalid;
  Engine::InstanceAssetUpdate update, stale;
  require(engine->captureInstanceAssetSnapshot(instance, 0, snapshot, 15) == ET_OK,
          "capture candidate floor");
  require(map(240) == ET_OK && prepare(snapshot, stale) == ET_OK &&
              lastPrepared.minimumPhysicalBpm == 15 && apply(stale) == ET_ERR_STATE,
          "immutable snapshot retains its value and map change invalidates old ownership");
  stale.reclaim();
  require(engine->captureInstanceAssetSnapshot(instance, 0, snapshot, 0) == ET_OK &&
              prepare(snapshot, update) == ET_OK && apply(update) == ET_OK &&
              kernel->installedMinimum() == 0,
          "explicit zero survives independent preparation and exchange");
  update.reclaim();
  require(engine->captureInstanceAssetSnapshot(instance, 0, snapshot) == ET_OK &&
              prepare(snapshot, update) == ET_OK && apply(update) == ET_OK &&
              kernel->installedMinimum() == 60,
          "snapshot without override captures the active map getter");
  update.reclaim();

  require(engine->captureInstanceAssetSnapshot(instance, 0, snapshot, 9) == ET_OK &&
              prepare(snapshot, update) == ET_OK,
          "prepare valid ticket before invalid requests");
  const auto begins = kernel->begins;
  for (const auto bad :
       {-1.0, std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) {
    require(!engine->beginInstanceAsset(instance, 0, info, bad) && kernel->begins == begins &&
                engine->captureInstanceAssetSnapshot(instance, 0, invalid, bad) == ET_ERR_ARGS,
            "invalid context rejects before begin or revision mutation");
  }
  require(apply(update) == ET_OK && kernel->installedMinimum() == 9,
          "invalid requests preserve the valid ticket");
  update.reclaim();

  require(engine->captureInstanceAssetSnapshot(instance, 0, snapshot) == ET_OK &&
              prepare(snapshot, update) == ET_OK && map(-1) == ET_ERR_ARGS && map(240) == ET_OK &&
              apply(update) == ET_OK,
          "failed or equal-floor map assignment preserves the ticket");
  update.reclaim();
  require(engine->captureInstanceAssetSnapshot(instance, 0, snapshot, 3) == ET_OK &&
              prepare(snapshot, stale) == ET_OK &&
              engine->captureInstanceAssetSnapshot(instance, 0, snapshot, 6) == ET_OK &&
              prepare(snapshot, update) == ET_OK && apply(stale) == ET_ERR_STATE &&
              apply(update) == ET_OK && apply(update) == ET_ERR_STATE,
          "new captures supersede old tickets and exchange happens once");
  stale.reclaim();
  update.reclaim();
  require(engine->captureInstanceAssetSnapshot(instance, 0, snapshot, 12) == ET_OK &&
              prepare(snapshot, stale) == ET_OK,
          "prepare cancellation ticket");
  engine->abortInstanceAsset(instance, 0);
  require(apply(stale) == ET_ERR_STATE && kernel->installedMinimum() == -1,
          "cancel retains existing asset ownership semantics");
  stale.reclaim();
  require(engine->captureInstanceAssetSnapshot(instance, 0, snapshot, 8) == ET_OK &&
              prepare(snapshot, stale) == ET_OK &&
              engine->beginInstanceAsset(instance, 0, info, 10) != nullptr &&
              apply(stale) == ET_ERR_STATE && kernel->staged.minimumPhysicalBpm == 10,
          "an atomic begin supersedes an old snapshot without sharing candidate context");
  stale.reclaim();
  require(allocation_guard::violationCount() == 0, "asset exchange never allocates");
  std::puts("Atomic asset preparation context tests passed");
}

#include "BassManagementPluginParams.h"
#include "allocation_guard.h"
#include "binary_io.h"
#include "engine.h"
#include "registry.h"

#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <span>
#include <vector>

namespace {
using namespace effetune;

constexpr std::uint32_t kBlockFrames = 128;
constexpr std::uint32_t kChannels = 4;
constexpr std::uint32_t kDryReady = 1u << 16;

struct Fixture {
  AssetBeginInfo info;
  std::vector<std::uint8_t> bytes;
};

using Path = std::array<std::uint32_t, 3>;

Fixture impulseAsset(std::uint32_t channels, std::uint32_t frames, std::uint32_t topology,
                     std::uint32_t processingChannels, std::uint32_t tap,
                     std::span<const Path> paths = {}, std::uint32_t inputs = 0) {
  const auto pathCount = static_cast<std::uint32_t>(paths.size());
  const auto sampleOffset = 32u + pathCount * 12u;
  const auto bytes = sampleOffset + channels * frames * 4u;
  Fixture fixture{{channels, frames, topology, kBlockFrames, 1, pathCount, inputs,
                   processingChannels, 16u * 1024u * 1024u, bytes},
                  std::vector<std::uint8_t>(bytes)};
  const std::array header{0x31415445u, channels, frames, 48000u, topology, pathCount};
  for (std::size_t i = 0; i < header.size(); ++i)
    binary_io::writeU32(fixture.bytes.data() + i * 4u, header[i]);
  for (std::size_t i = 0; i < paths.size(); ++i)
    for (std::size_t field = 0; field < 3; ++field)
      binary_io::writeU32(fixture.bytes.data() + 32u + i * 12u + field * 4u, paths[i][field]);
  for (std::uint32_t channel = 0; channel < channels; ++channel)
    binary_io::writeF32(fixture.bytes.data() + sampleOffset + (channel * frames + tap) * 4u,
                        0.45F / static_cast<float>(channel + 1u));
  return fixture;
}

class Comparison {
public:
  explicit Comparison(const char *type) : type_(type), descriptor_(registry::find(type)) {
    require(descriptor_ != nullptr, "find kernel");
    for (std::size_t i = 0; i < engines_.size(); ++i) {
      engines_[i] = std::make_unique<Engine>();
      require(engines_[i]->prepare(48000, kChannels, kBlockFrames, 0) == ET_OK, "prepare engine");
      instances_[i] = engines_[i]->createInstance(type);
      require(instances_[i] != 0, "create instance");
      require(engines_[i]->setInstanceSeed(instances_[i], 0, 0) == ET_OK, "set initial seed");
    }
  }

  void stage(std::span<const float> parameters) const {
    for (std::size_t i = 0; i < engines_.size(); ++i)
      require(engines_[i]->setInstanceParams(instances_[i], parameters.data(),
                                             static_cast<std::uint32_t>(parameters.size()),
                                             descriptor_->paramsHash, 0) == ET_OK,
              "stage parameters");
  }

  void load(const Fixture &fixture, bool invalid = false) const {
    auto *staging = engines_[0]->beginInstanceAsset(instances_[0], 0, fixture.info);
    require(staging != nullptr, "begin staged asset");
    std::memcpy(staging, fixture.bytes.data(), fixture.bytes.size());
    const auto staged = engines_[0]->commitInstanceAsset(instances_[0], 0, fixture.info.byteSize,
                                                         ET_ASSET_F32_MULTICH);
    require(invalid ? staged != ET_OK : staged == ET_OK, "legacy commit status");
    Engine::InstanceAssetUpdate update;
    prepare(fixture, update);
    const auto status = apply(update);
    require(invalid ? status != ET_OK : status == ET_OK, "prepared apply status");
    compareState();
  }

  void clear() const {
    engines_[0]->abortInstanceAsset(instances_[0], 0);
    Engine::InstanceAssetSnapshot snapshot;
    Engine::InstanceAssetUpdate update;
    capture(snapshot);
    require(Engine::prepareInstanceAssetClear(snapshot, update) == ET_OK, "prepare clear");
    require(apply(update) == ET_OK, "apply clear");
    compareState();
  }

  void rejectAllocation(const Fixture &fixture) const {
    {
      allocation_guard::Scope scope;
      if (!allocation_guard::active())
        return;
    }
    // Fail the staged coefficient allocation after its admission probe.
    allocation_guard::failNothrowAllocationAfterForTesting(1);
    require(engines_[0]->beginInstanceAsset(instances_[0], 0, fixture.info) == nullptr,
            "legacy allocation failure");
    Engine::InstanceAssetUpdate update;
    // Fail construction of the prepared convolver after allocating the ticket.
    allocation_guard::failNothrowAllocationAfterForTesting(1);
    prepare(fixture, update);
    require(apply(update) != ET_OK, "prepared allocation failure");
    compareState();
  }

  void rejectStale(const Fixture &fixture) const {
    Engine::InstanceAssetUpdate update;
    prepare(fixture, update);
    require(engines_[1]->setInstanceSeed(instances_[1], 123, 456) == ET_OK, "change seed");
    require(apply(update) == ET_ERR_STATE, "reject asset prepared for a stale slice offset");
    compareState();
  }

  void render(unsigned blocks, std::uint32_t channels) {
    for (unsigned block = 0; block < blocks; ++block) {
      std::array<float, kBlockFrames * kChannels> input{};
      for (std::uint32_t i = 0; i < channels * kBlockFrames; ++i)
        input[i] = static_cast<float>(std::sin((frame_ + i) * 0.071)) * 0.1F;
      auto staged = input;
      auto prepared = input;
      require(engines_[0]->processInstance(instances_[0], staged.data(), channels, kBlockFrames,
                                           frame_ / 48000.0) == ET_OK,
              "render staged asset");
      require(engines_[1]->processInstance(instances_[1], prepared.data(), channels, kBlockFrames,
                                           frame_ / 48000.0) == ET_OK,
              "render prepared asset");
      require(staged == prepared, "compare exact rendered samples");
      compareState();
      frame_ += kBlockFrames;
    }
  }

  void requireState(std::uint32_t state, std::uint32_t mask = 0xff) const {
    require((engines_[1]->instanceAssetState(instances_[1], 0) & mask) == state,
            "asset state reached");
  }

private:
  void require(bool condition, const char *message) const {
    if (condition)
      return;
    std::fprintf(stderr, "%s at frame %u: %s\n", type_, frame_, message);
    std::exit(1);
  }

  void capture(Engine::InstanceAssetSnapshot &snapshot) const {
    require(engines_[1]->captureInstanceAssetSnapshot(instances_[1], 0, snapshot) == ET_OK,
            "capture asset snapshot");
  }

  void prepare(const Fixture &fixture, Engine::InstanceAssetUpdate &update) const {
    Engine::InstanceAssetSnapshot snapshot;
    capture(snapshot);
    require(Engine::prepareInstanceAssetUpdate(snapshot, fixture.info, fixture.bytes.data(),
                                               fixture.info.byteSize, ET_ASSET_F32_MULTICH,
                                               update) == ET_OK,
            "prepare asset off audio");
  }

  et_status apply(Engine::InstanceAssetUpdate &update) const {
    et_status status;
    {
      allocation_guard::Scope scope;
      status = engines_[1]->applyInstanceAssetUpdate(update);
    }
    require(allocation_guard::violationCount() == 0, "apply without allocating");
    return status;
  }

  void compareState() const {
    require(engines_[0]->instanceAssetState(instances_[0], 0) ==
                engines_[1]->instanceAssetState(instances_[1], 0),
            "compare asset state");
    require(engines_[0]->instanceLatency(instances_[0]) ==
                engines_[1]->instanceLatency(instances_[1]),
            "compare latency");
  }

  const char *type_;
  const KernelDescriptor *descriptor_;
  std::array<std::unique_ptr<Engine>, 2> engines_;
  std::array<et_instance, 2> instances_{};
  std::uint32_t frame_ = 0;
};

void verify(const char *type, const Fixture &fixture, std::span<const float> parameters,
            std::size_t dryParam = 0) {
  Comparison comparison(type);
  comparison.stage(parameters);
  comparison.load(fixture);
  comparison.render(256, fixture.info.processingChannels);
  comparison.requireState(ET_ASSET_STATE_ACTIVE);
  auto replacement = fixture;
  const auto sampleOffset = 32u + fixture.info.pathCount * 12u;
  binary_io::writeF32(replacement.bytes.data() + sampleOffset, 0.2F);
  if (dryParam < parameters.size()) {
    std::vector<float> dry(parameters.begin(), parameters.end());
    dry[dryParam] = -1.0F;
    comparison.stage(dry);
    comparison.render(64, fixture.info.processingChannels);
    comparison.requireState(kDryReady, kDryReady);
  }
  comparison.load(replacement);
  comparison.stage(parameters);
  comparison.render(256, fixture.info.processingChannels);
  comparison.requireState(ET_ASSET_STATE_ACTIVE);
  // IR Reverb uses the fixed instance salt when hosted by Engine.
  if (dryParam < parameters.size())
    comparison.rejectStale(fixture);

  auto invalid = fixture;
  invalid.bytes[0] = 0;
  comparison.load(invalid, true);
  comparison.requireState(ET_ASSET_STATE_ERROR);
  comparison.clear();
  comparison.requireState(ET_ASSET_STATE_NONE);
  comparison.render(64, fixture.info.processingChannels);
  comparison.rejectAllocation(fixture);
}

void verifyReverbSalt(const Fixture &fixture) {
  const auto *descriptor = registry::find("IRReverbPlugin");
  const auto bytes = std::make_unique<std::byte[]>(descriptor->objectSize);
  auto *kernel = descriptor->construct(bytes.get());
  PrepareInfo prepare{48000, kChannels, kBlockFrames};
  kernel->prepare(prepare);
  kernel->setInstanceSalt(123);
  prepare.sliceOffset = kernel->assetSliceOffset();
  std::unique_ptr<PreparedAsset> update;
  const auto prepared = kernel->assetPreparer(0)(prepare, fixture.info, fixture.bytes.data(),
                                                 ET_ASSET_F32_MULTICH, update);
  kernel->setInstanceSalt(456);
  const auto applied = kernel->exchangePreparedAsset(0, update);
  const auto state = kernel->assetState(0);
  descriptor->destroy(kernel);
  if (prepared != ET_OK || applied != ET_ERR_STATE || state != ET_ASSET_STATE_NONE) {
    std::fputs("IR Reverb accepted an asset prepared for a stale slice offset\n", stderr);
    std::exit(1);
  }
}
} // namespace

int main() {
  const auto mono = impulseAsset(1, 257, 1, 2, 64);
  const std::array eq{1.0F, 64.0F};
  for (const auto *type :
       {"FiveBandFIRPEQPlugin", "GroupDelayEqPlugin", "GroupDelayPEQPlugin", "HeadphoneEQPlugin"})
    verify(type, mono, eq);
  verify("RoomEqPlugin", mono, std::array{1.0F, 64.0F, 0.0F, 0.0F});
  verify("IRReverbPlugin", mono, std::array{0.0F, 128.0F, 1.0F, 70.0F, 1.0F, 0.0F, 0.0F}, 7);
  verifyReverbSalt(mono);
  verify("CrosstalkCancellationPlugin", impulseAsset(4, 65, 3, 2, 8),
         std::array{128.0F, 8.0F, 100.0F, 0.0F});
  constexpr std::array crossoverPaths{Path{0, 0, 0}, Path{1, 1, 0}, Path{0, 2, 1}, Path{1, 3, 1}};
  verify("FIRCrossoverPlugin", impulseAsset(2, 257, 4, 4, 64, crossoverPaths, 2),
         std::array{128.0F, 64.0F, 2.0F});

  generated::BassManagementPluginParams bass{};
  bass.phase = 1;
  bass.roles[0] = 1;
  bass.roles[2] = 3;
  bass.subs = 4;
  bass.routes[0] = 4;
  bass.lfeFrequency = 120;
  bass.lfeSlope = 24;
  for (std::size_t channel = 0; channel < 16; ++channel) {
    bass.frequencies[channel] = 80;
    bass.slopes[channel] = 24;
  }
  constexpr std::array<Path, 1> bassPaths{Path{0, 0, 0}};
  verify("BassManagementPlugin", impulseAsset(1, 8192, 4, 4, 4096, bassPaths, 4),
         {reinterpret_cast<const float *>(&bass), bass.kFloatCount});
}

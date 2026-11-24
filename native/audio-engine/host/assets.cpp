#include "engine.h"
#include "pipeline.h"
#include <algorithm>
#include <cstring>
#include <string_view>

namespace effetune::audio {
namespace {
std::uint32_t field(const std::vector<std::uint8_t> &payload, std::size_t offset) {
  std::uint32_t value;
  std::memcpy(&value, payload.data() + offset, sizeof(value));
  return value;
}
} // namespace

bool Pipeline::applyAsset(std::uint32_t id, std::uint32_t kernel, std::uint32_t slot,
                          const AssetData &asset, bool sampler) {
  Engine::InstanceAssetSnapshot snapshot;
  const auto &bytes = asset.payload;
  const AssetBeginInfo info{field(bytes, 4),      field(bytes, 8),
                            field(bytes, 16),     asset.headBlock,
                            asset.rateDivider,    asset.pathCount,
                            asset.inputCount,     asset.processingChannels,
                            asset.footprintBytes, static_cast<std::uint32_t>(bytes.size())};
  const auto captured =
      engine_.captureInstanceAssetSnapshot(kernel, slot, snapshot, asset.minimumPhysicalBpm);
  if (captured != ET_OK)
    return false;
  Engine::InstanceAssetUpdate update;
  const auto prepared = Engine::prepareInstanceAssetUpdate(snapshot, info, bytes.data(),
                                                           info.byteSize, asset.formatTag, update);
  if (prepared != ET_OK || engine_.applyInstanceAssetUpdate(update) != ET_OK)
    return false;
  if (sampler && !slot) {
    streams_.erase(id);
    if (bytes.size() >= 96 && field(bytes, 32) == 0x53465a) {
      const auto version = field(bytes, 36);
      if ((version == 8 || version == 9 || version == 10) &&
          (field(bytes, 92) & (version == 10 ? 2 : 1))) {
        const auto generation = ++streamGeneration_;
        if (engine_.configureInstanceSampleStream(kernel, generation) != ET_OK) {
          engine_.abortInstanceAsset(kernel, slot);
          return false;
        }
        streams_[id] = {generation, 0, asset.operationRevision, asset.replayEpoch};
      }
    }
  }
  return true;
}

bool Pipeline::validAsset(unsigned id, unsigned slot, const AssetData &candidate) const {
  const auto &bytes = candidate.payload;
  if (id == 0 || bytes.size() < 32 || field(bytes, 0) != 0x31415445 ||
      candidate.processingChannels == 0 || candidate.processingChannels > 16 ||
      candidate.footprintBytes < bytes.size())
    return false;
  const auto channels = field(bytes, 4), frames = field(bytes, 8), topology = field(bytes, 16);
  const auto pathBytes = topology == 4 ? std::uint64_t(candidate.pathCount) * 12 : 0;
  if (channels == 0 || channels > 16 || !frames || topology > 4 ||
      32 + pathBytes + std::uint64_t(channels) * frames * 4 != bytes.size())
    return false;
  return candidate.footprintBytes <= availableAssetBytes(id, slot);
}
std::uint64_t Pipeline::availableAssetBytes(unsigned id, unsigned slot) const {
  const auto isSampler = [&](std::uint32_t pluginId) {
    const auto found = slots_.find(pluginId);
    return found != slots_.end() && (found->second.settings.type == "SFZNotePlayerPlugin" ||
                                     found->second.settings.type == "SoundFontPlayerPlugin");
  };
  const bool sampler = isSampler(id);
  const std::uint64_t budget = (sampler ? 1024ull : 128ull) * 1024 * 1024;
  std::uint64_t footprint = 0;
  for (const auto &[key, other] : assets_)
    if (key != std::pair{id, slot} && isSampler(key.first) == sampler)
      footprint += other.footprintBytes;
  return footprint > budget ? 0 : budget - footprint;
}
bool Pipeline::materializeInstrument(bool soundfont, AssetData &asset) const {
  const unsigned kind = soundfont ? ET_SAMPLE_PLAYER_MAIN : ET_SAMPLE_PLAYER_NOTE;
  const unsigned size = static_cast<unsigned>(asset.payload.size());
  std::uint64_t additional = 0;
  if (et_sample_player_preparation_bytes(asset.payload.data(), size, size, asset.formatTag,
                                         static_cast<float>(rate_), asset.processingChannels,
                                         maxFrames_, asset.minimumPhysicalBpm.value_or(0),
                                         &additional, kind) != ET_OK ||
      additional > UINT32_MAX - size)
    return false;
  // The renderer estimates WASM storage. Host pointer and container sizes differ.
  asset.footprintBytes = size + static_cast<unsigned>(additional);
  return true;
}
bool Pipeline::publishNotice(const AssetNotice &notice) noexcept {
  const auto w = noticeWrite_.load(std::memory_order_relaxed);
  if (w - noticeRead_.load(std::memory_order_acquire) == notices_.size())
    return false;
  notices_[w % notices_.size()] = notice;
  noticeWrite_.store(w + 1, std::memory_order_release);
  return true;
}
bool Pipeline::takeNotice(AssetNotice &notice) noexcept {
  const auto r = noticeRead_.load(std::memory_order_relaxed);
  if (takeBankNotice(notice))
    return true;
  if (r == noticeWrite_.load(std::memory_order_acquire))
    return false;
  notice = notices_[r % notices_.size()];
  noticeRead_.store(r + 1, std::memory_order_release);
  return true;
}
void Pipeline::serviceAssets() {
  serviceBanks();
  for (auto &[key, asset] : assets_) {
    const auto state = assetState(key.first, key.second);
    if (state != asset.reportedState &&
        publishNotice(
            {key.first, key.second, state, asset.operationRevision, asset.replayEpoch, false})) {
      asset.reportedState = state;
    }
  }
  for (auto &[id, slot] : slots_) {
    if (!slot.kernel || (slot.settings.type != "SoundFontPlayerPlugin" &&
                         slot.settings.type != "SFZNotePlayerPlugin"))
      continue;
    const auto it = assets_.find({id, 0});
    const unsigned token = it == assets_.end() ? 0 : it->second.operationRevision.value_or(0);
    if ((slot.announcedHandle != slot.kernel || slot.announcedToken != token) &&
        publishNotice({id, 0, 0, token, {}, false, slot.kernel})) {
      slot.announcedHandle = slot.kernel;
      slot.announcedToken = token;
    }
  }
}

std::uint32_t Pipeline::assetState(std::uint32_t id, std::uint32_t slot) const noexcept {
  const auto kernel = instance(id);
  if (kernel)
    return engine_.instanceAssetState(kernel, slot);
  return assets_.contains({id, slot}) ? ET_ASSET_STATE_STAGED : ET_ASSET_STATE_NONE;
}

Pipeline::SampleStream *Pipeline::sampleStream(std::uint32_t id) {
  const auto found = streams_.find(id);
  return found == streams_.end() ? nullptr : &found->second;
}
std::shared_ptr<Pipeline::AssetChange> Pipeline::pendingStream(unsigned id) const {
  const auto it = pendingStreams_.find(id);
  return it == pendingStreams_.end() ? nullptr : it->second;
}
void Pipeline::cancelStream(unsigned id) {
  if (pendingStreams_.erase(id))
    streams_.erase(id);
}

bool Pipeline::takeRequests(std::uint32_t id, std::span<et_sfz_sample_request> buffer,
                            std::uint32_t &count, et_stream_readiness &readiness,
                            std::uint64_t frame, bool &limited) {
  const auto kernel = instance(id);
  if (auto i = instrument(id)) {
    auto &s = slots_.at(id);
    const bool main = s.settings.type == "SoundFontPlayerPlugin";
    const bool preview = main && s.settings.params.size() > 5 && s.settings.params[5] >= 0;
    midi.forecast(engine_, i->target, s.forecast, frame, rate_, main, preview, readiness);
    limited = s.forecast.limited;
  }
  return kernel &&
         engine_.takeInstanceSampleRequests(
             kernel, buffer.data(), static_cast<std::uint32_t>(buffer.size()), count) == ET_OK &&
         engine_.instanceStreamReadiness(kernel, readiness) == ET_OK;
}

bool Pipeline::publishPage(std::uint32_t id, std::uint64_t generation, std::uint32_t sample,
                           std::uint64_t page, std::span<const float> pcm, std::uint32_t frames,
                           std::uint32_t channels, bool resident) {
  const auto kernel = instance(id);
  return kernel && frames > 0 && frames <= 4096 && (channels == 1 || channels == 2) &&
         pcm.size() == std::size_t(frames) * channels &&
         engine_.publishInstanceSamplePage(kernel, generation, sample, page, pcm.data(), frames,
                                           channels, resident ? 1 : 0) == ET_OK;
}
// The owner captures and exchanges an instrument bank only between render
// callbacks. The large payload, bank preparation, and retired storage stay with
// this control-owned request until the final acknowledgement.
class Pipeline::Bank final : public Pipeline::AssetChange,
                             public std::enable_shared_from_this<Bank> {
  friend class Pipeline;

public:
  Bank(Pipeline &p, unsigned id, unsigned slot, std::optional<AssetData> asset)
      : p_(p), id_(id), slot_(slot) {
    if (asset) {
      notice_.revision = asset->operationRevision;
      notice_.epoch = asset->replayEpoch;
      staged_.emplace(std::pair{id, slot}, std::move(*asset));
    }
    notice_.id = id;
    notice_.slot = slot;
    notice_.completed = this;
  }
  ~Bank() override {
    if (detached_)
      p_.engine_.destroyInstance(detached_);
  }
  bool capture() override {
    if (stale_ && p_.instance(id_) != kernel_)
      return false;
    stale_ = false;
    deferred_ = false;
    const auto *asset = staged_.empty() ? nullptr : &staged_.begin()->second;
    if (asset && !p_.validAsset(id_, slot_, *asset))
      return false;
    kernel_ = p_.instance(id_);
    if (!kernel_)
      return true;
    failure_ = "snapshot";
    if (p_.engine_.captureInstanceAssetSnapshot(
            kernel_, slot_, snapshot_, asset ? asset->minimumPhysicalBpm : std::nullopt) != ET_OK)
      return false;
    const auto &settings = p_.slots_.at(id_).settings;
    soundfont_ = settings.type == "SoundFontPlayerPlugin";
    sampler_ = soundfont_ || settings.type == "SFZNotePlayerPlugin";
    budget_ = p_.availableAssetBytes(id_, slot_);
    constexpr std::string_view firTypes[]{"BassManagementPlugin", "FIRCrossoverPlugin",
                                          "FiveBandFIRPEQPlugin", "GroupDelayEqPlugin",
                                          "GroupDelayPEQPlugin",  "CrosstalkCancellationPlugin",
                                          "HeadphoneEQPlugin",    "RoomEqPlugin"};
    dryCount_ = asset && !asset->replayEpoch && !slot_ && routed() &&
                        (p_.assetState(id_, slot_) & 255u) == ET_ASSET_STATE_ACTIVE &&
                        std::find(std::begin(firTypes), std::end(firTypes), settings.type) !=
                            std::end(firTypes)
                    ? settings.params.size()
                    : 0;
    return true;
  }
  bool prepare() override {
    failure_ = "preparation";
    if (!kernel_)
      return true;
    if (staged_.empty())
      return Engine::prepareInstanceAssetClear(snapshot_, update_) == ET_OK;
    dry_.resize(dryCount_);
    auto &asset = staged_.begin()->second;
    if ((sampler_ && !p_.materializeInstrument(soundfont_, asset)) ||
        asset.footprintBytes > budget_)
      return false;
    const auto &bytes = asset.payload;
    const AssetBeginInfo info{field(bytes, 4),      field(bytes, 8),
                              field(bytes, 16),     asset.headBlock,
                              asset.rateDivider,    asset.pathCount,
                              asset.inputCount,     asset.processingChannels,
                              asset.footprintBytes, static_cast<unsigned>(bytes.size())};
    bool streamed = false;
    if (sampler_ && slot_ == 0 && bytes.size() >= 96 && field(bytes, 32) == 0x53465a) {
      const auto version = field(bytes, 36);
      streamed = (version == 8 || version == 9 || version == 10) &&
                 (field(bytes, 92) & (version == 10 ? 2 : 1));
    }
    if (streamed) {
      const auto &settings = p_.slots_.at(id_).settings;
      detached_ = p_.engine_.createInstance(settings.type.c_str());
      if (!detached_ || p_.engine_.setInstanceTap(detached_, id_) != ET_OK ||
          p_.engine_.captureInstanceAssetSnapshot(detached_, slot_, snapshot_,
                                                  asset.minimumPhysicalBpm) != ET_OK)
        return false;
    }
    const auto status = Engine::prepareInstanceAssetUpdate(snapshot_, info, bytes.data(),
                                                           info.byteSize, asset.formatTag, update_);
    if (status != ET_OK) {
      if (status == ET_ERR_ARGS)
        failure_ = "preparation arguments";
      return false;
    }
    if (streamed) {
      const auto gen = ++p_.streamGeneration_;
      if (p_.engine_.configureInstanceAssetStream(update_, gen) != ET_OK)
        return false;
      stream_ = SampleStream{gen, 0, asset.operationRevision, asset.replayEpoch};
      return activateDetached();
    }
    if (dryCount_)
      p_.pendingBanks_.insert_or_assign(this, shared_from_this());
    return true;
  }
  bool activateDetached() {
    const auto status = p_.engine_.applyInstanceAssetUpdate(update_);
    awaiting_ = status == ET_ERR_STATE;
    if (awaiting_)
      return true;
    if (status != ET_OK ||
        p_.engine_.configureInstanceSampleStream(detached_, stream_->generation) != ET_OK)
      return false;
    descriptor_ = p_.descriptor_;
    active_ = p_.activeDescriptor_;
    for (auto *bytes : {&descriptor_, &active_})
      for (std::size_t i = 8; i < bytes->size(); i += 12)
        if (field(*bytes, i) == kernel_)
          std::memcpy(bytes->data() + i, &detached_, sizeof(detached_));
    return true;
  }
  bool captureRoute() noexcept override {
    if (!detached_)
      return true;
    Slot next;
    next.kernel = detached_;
    // The logical instrument may have changed while its resident pages were loading.
    return p_.instance(id_) == kernel_ && p_.stage(next, p_.slots_.at(id_).settings, true) &&
           p_.engine_.capturePipelineTopology(active_.data(), static_cast<unsigned>(active_.size()),
                                              route_) == ET_OK;
  }
  bool prepareRoute() override {
    // Installing a tempo map allocates. The detached instance is still control-owned here.
    return !detached_ || ((!soundfont_ || p_.midi.installMap(p_.engine_, detached_)) &&
                          Engine::preparePipelineTopology(route_, routing_) == ET_OK);
  }
  bool apply() noexcept override {
    p_.cancelBanks(id_, slot_);
    // Some kernels publish a legacy ERROR state by exchanging even a failed preparation.
    // A rejected host replacement must keep the bank that its committed reference identifies.
    if (update_.hasPreparationError() && p_.assets_.contains({id_, slot_})) {
      if (!dryCount_)
        return false;
      deferred_ = true;
      notify(false);
      return true;
    }
    if (dryCount_ && routed()) {
      auto &slot = p_.slots_.at(id_);
      std::copy(slot.settings.params.begin(), slot.settings.params.end(), dry_.begin());
      dry_[0] = -1;
      if (p_.engine_.setInstanceParams(kernel_, dry_.data(), static_cast<unsigned>(dry_.size()),
                                       slot.settings.layoutHash, 0) != ET_OK)
        return false;
      slot.dryParameters.swap(dry_);
      next_ = p_.waitingBanks_;
      p_.waitingBanks_ = this;
      p_.hasPendingAssets_.store(true, std::memory_order_release);
      deferred_ = true;
      return true;
    }
    return exchange();
  }
  bool exchange() noexcept {
    failure_ = "publication";
    if (detached_) {
      if (p_.instance(id_) != kernel_ ||
          p_.engine_.publishPipelineTopology(route_, routing_) != ET_OK)
        return false;
      p_.slots_.at(id_).kernel = detached_;
      p_.descriptor_.swap(descriptor_);
      p_.activeDescriptor_.swap(active_);
      std::swap(detached_, kernel_);
      p_.connectAnalysisSources();
    } else if (kernel_) {
      const auto status =
          p_.engine_.applyInstanceAssetUpdate(update_, p_.assets_.contains({id_, slot_}));
      stale_ = status == ET_ERR_STATE;
      if (status != ET_OK)
        return false;
    }
    if (sampler_) {
      ++p_.runtimeRevision_;
      auto &slot = p_.slots_.at(id_);
      slot.streaming = bool(stream_);
      slot.forecast = {};
      slot.frozen.reset();
    }
    retired_ = p_.assets_.extract({id_, slot_});
    if (!staged_.empty())
      p_.assets_.insert(staged_.extract(staged_.begin()));
    state_ = p_.assetState(id_, slot_);
    p_.assetLatencyChanged_ |= kernel_ != 0;
    return true;
  }
  void finish() override {
    if (sampler_ && slot_ == 0) {
      const bool retained = p_.pendingStreams_.erase(id_) != 0;
      if (!retained) {
        p_.streams_.erase(id_);
        if (stream_)
          p_.streams_.emplace(id_, *stream_);
      }
    }
    update_.reclaim();
    p_.pendingBanks_.erase(this);
    if (detached_) {
      p_.engine_.destroyInstance(detached_);
      detached_ = 0;
    }
  }
  bool deferred() const noexcept override { return deferred_; }
  bool stale() const noexcept override { return stale_ && !superseded_; }
  unsigned state() const noexcept override { return state_; }
  bool awaitsPages() const noexcept override { return awaiting_; }
  void retain(std::shared_ptr<AssetChange> self) override {
    p_.pendingStreams_.insert_or_assign(id_, std::move(self));
    p_.streams_.insert_or_assign(id_, *stream_);
  }
  bool publish(std::uint64_t gen, unsigned sample, std::uint64_t page, std::span<const float> pcm,
               unsigned frames, unsigned channels, bool resident) override {
    return stream_ && gen == stream_->generation &&
           p_.engine_.publishInstanceAssetSamplePage(update_, gen, sample, page, pcm.data(), frames,
                                                     channels, resident ? 1u : 0u) == ET_OK &&
           activateDetached();
  }
  const char *failureStage() const noexcept override { return failure_; }

private:
  bool routed() const noexcept {
    Engine::PipelineTapLatency latency;
    return !p_.masterBypass_ && p_.engine_.pipelineTapLatency(kernel_, latency);
  }
  // Completion uses a separate intrusive queue: even a full telemetry queue must
  // never drop the last reference to retired convolution storage on the audio thread.
  void complete(bool applyNow) noexcept {
    auto &slot = p_.slots_.at(id_);
    const bool ok = applyNow && exchange();
    dry_.swap(slot.dryParameters);
    p_.engine_.setInstanceParams(slot.kernel, slot.settings.params.data(),
                                 static_cast<unsigned>(slot.settings.params.size()),
                                 slot.settings.layoutHash, 0);
    notify(ok);
  }
  void notify(bool ok) noexcept {
    notice_.state = state_;
    notice_.rejected = !ok;
    next_ = p_.completedBanks_.load(std::memory_order_relaxed);
    while (!p_.completedBanks_.compare_exchange_weak(next_, this, std::memory_order_release,
                                                     std::memory_order_relaxed)) {
    }
  }
  Bank *next_ = nullptr;
  AssetNotice notice_{};
  bool stale_ = false, sampler_ = false;
  bool superseded_ = false; // Read and written by the control owner.
  std::size_t dryCount_ = 0;
  std::vector<float> dry_;
  Pipeline &p_;
  unsigned id_, slot_, kernel_ = 0, state_ = 0;
  bool deferred_ = false;
  bool soundfont_ = false, awaiting_ = false;
  std::uint64_t budget_ = 0;
  unsigned detached_ = 0;
  std::vector<std::uint8_t> descriptor_, active_;
  Engine::PipelineTopologySnapshot route_;
  Engine::PipelineLatencyUpdate routing_;
  const char *failure_ = "asset validation";
  decltype(assets_) staged_;
  decltype(assets_)::node_type retired_;
  Engine::InstanceAssetSnapshot snapshot_;
  Engine::InstanceAssetUpdate update_;
  std::optional<SampleStream> stream_;
};
void Pipeline::cancelBanks(unsigned id, std::optional<unsigned> slot) noexcept {
  for (Bank **link = &waitingBanks_; *link;) {
    auto *bank = *link;
    if (bank->id_ != id || (slot && bank->slot_ != *slot)) {
      link = &bank->next_;
      continue;
    }
    *link = bank->next_;
    bank->complete(false);
  }
  hasPendingAssets_.store(waitingBanks_ != nullptr, std::memory_order_release);
}
void Pipeline::serviceBanks() noexcept {
  for (Bank **link = &waitingBanks_; *link;) {
    auto *bank = *link;
    if (!(assetState(bank->id_, bank->slot_) & (1u << 16)) && bank->routed()) {
      link = &bank->next_;
      continue;
    }
    *link = bank->next_;
    bank->complete(true);
  }
  hasPendingAssets_.store(waitingBanks_ != nullptr, std::memory_order_release);
}
bool Pipeline::takeBankNotice(AssetNotice &notice) noexcept {
  if (!collectedBanks_) {
    auto *batch = completedBanks_.exchange(nullptr, std::memory_order_acquire);
    while (batch) {
      auto *next = batch->next_;
      batch->next_ = collectedBanks_;
      collectedBanks_ = batch;
      batch = next;
    }
  }
  if (!collectedBanks_)
    return false;
  notice = collectedBanks_->notice_;
  collectedBanks_ = collectedBanks_->next_;
  return true;
}
std::shared_ptr<Pipeline::AssetChange> Pipeline::releaseBank(AssetChange *bank) {
  auto node = pendingBanks_.extract(bank);
  return node.empty() ? nullptr : std::move(node.mapped());
}
std::shared_ptr<Pipeline::AssetChange> Pipeline::assetChange(unsigned id, unsigned slot,
                                                             std::optional<AssetData> asset) {
  for (auto &[change, owned] : pendingBanks_) {
    auto *bank = static_cast<Bank *>(change);
    if (bank->id_ == id && bank->slot_ == slot)
      bank->superseded_ = true;
  }
  return std::make_shared<Bank>(*this, id, slot, std::move(asset));
}
} // namespace effetune::audio

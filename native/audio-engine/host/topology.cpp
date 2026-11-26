#include "engine.h"
#include "pipeline.h"
#include "registry.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace effetune::audio {
namespace {
std::uint32_t readWord(const std::uint8_t *bytes) {
  std::uint32_t result;
  std::memcpy(&result, bytes, sizeof(result));
  return result;
}
} // namespace

// Only previously unrouted instances are created or retired on the control
// thread. The current descriptor, kernel state, and delay lines stay audio-owned
// until publication. Other control mutations are serialized by the command loop.
class Pipeline::Change final : public Pipeline::TopologyChange {
public:
  explicit Change(Pipeline &pipeline) : pipeline_(pipeline) {}
  ~Change() override {
    for (auto handle : published_ ? retired_ : created_)
      pipeline_.engine_.destroyInstance(handle);
    if (published_)
      for (auto id : retiredRuntimeIds_) {
        pipeline_.streams_.erase(id);
        pipeline_.pendingStreams_.erase(id);
      }
  }
  bool build(std::vector<PluginSettings> plugins, std::vector<std::uint8_t> descriptor) {
    if (pipeline_.hasPendingAssets_.load(std::memory_order_acquire) || descriptor.size() < 8 ||
        readWord(descriptor.data()) != Engine::kPipelineDescriptorVersion ||
        readWord(descriptor.data() + 4) != plugins.size() ||
        plugins.size() > Engine::kMaxPipelineNodes || descriptor.size() != 8 + 12 * plugins.size())
      return false;
    std::map<unsigned, PluginSettings *> byId;
    for (auto &params : plugins) {
      if (!params.id || !byId.emplace(params.id, &params).second)
        return false;
      if (params.skip)
        continue;
      const auto *type = registry::find(params.type.c_str());
      if (!type || type->paramsHash != params.layoutHash ||
          type->paramsFloatCount != params.params.size() ||
          type->paramsByteCapacity < params.bytes.size() ||
          !std::all_of(
              params.params.begin(), params.params.end(), [](float v) { return std::isfinite(v); }))
        return false;
    }
    auto create = [&](const char *type) {
      const auto handle = pipeline_.engine_.createInstance(type);
      if (handle)
        created_.push_back(handle);
      return handle;
    };
    std::size_t receiveIndex = 0;
    for (std::size_t i = 0; i < plugins.size(); ++i) {
      auto *row = descriptor.data() + 8 + i * 12;
      const auto id = readWord(row);
      if (!byId.contains(id) || nextSlots_.contains(id))
        return false;
      auto &params = *byId.at(id);
      const auto old = pipeline_.slots_.find(id);
      auto &slot = nextSlots_[id];
      const bool retained =
          old != pipeline_.slots_.end() && old->second.settings.type == params.type;
      if (retained) {
        if (params.skip && old->second.kernel) {
          retired_.push_back(old->second.kernel);
          retiredRuntimeIds_.push_back(id);
        } else if (old->second.kernel) {
          slot.kernel = old->second.kernel;
          retained_.push_back(id);
        }
        if (params.skip || params.displayOnly)
          slot.passthrough = old->second.passthrough;
        else if (old->second.passthrough)
          retired_.push_back(old->second.passthrough);
        if (!params.assetPending)
          params.assetPending = old->second.settings.assetPending;
      }
      if (!params.skip && !slot.kernel) {
        if ((row[4] && row[8]) && (params.assetPending.value_or(false) ||
                                   (params.type == "FIRCrossoverPlugin" && row[7] != 255 &&
                                    (row[7] < 16 || row[7] > 23))))
          return false;
        // A cached bank may require resident pages and a replacement-dry transition.
        if (pipeline_.assets_.lower_bound({id, 0}) !=
            pipeline_.assets_.upper_bound({id, UINT32_MAX}))
          return false;
        slot.kernel = create(params.type.c_str());
        if (!slot.kernel || !pipeline_.stage(slot, params, true) ||
            (params.type == "SoundFontPlayerPlugin" &&
             !pipeline_.midi.installMap(pipeline_.engine_, slot.kernel)) ||
            pipeline_.engine_.setInstanceTap(slot.kernel, id) != ET_OK)
          return false;
        slot.holdAsset = true;
      } else if (retained && !params.skip &&
                 (old->second.settings.params != params.params ||
                  old->second.settings.bytes != params.bytes || old->second.settings.skip))
        mutations_.push_back(id);
      if ((params.skip || params.displayOnly) && !slot.passthrough) {
        slot.passthrough = create("VolumePlugin");
        if (slot.passthrough)
          pipeline_.engine_.setInstanceTap(slot.passthrough, id);
        const float gain = 0;
        if (!slot.passthrough ||
            pipeline_.engine_.setInstanceParams(
                slot.passthrough, &gain, 1, registry::find("VolumePlugin")->paramsHash, 0) != ET_OK)
          return false;
      }
      const auto target = params.skip ? slot.passthrough : slot.kernel;
      std::memcpy(row, &target, sizeof(target));
      if (!pipeline_.masterBypass_ && row[4] && row[8]) {
        if (!sendId_ && params.type == "NetworkSendPlugin") {
          sendId_ = id;
          sendInstance_ = target;
        }
        if (!receiveId_ && pipeline_.receiving_ && params.type == "NetworkReceivePlugin") {
          receiveId_ = id;
          receiveIndex = i;
        }
      }
      slot.settings = std::move(params);
      order_.push_back(id);
    }
    for (const auto &[id, slot] : pipeline_.slots_) {
      auto it = nextSlots_.find(id);
      if (it != nextSlots_.end() && it->second.settings.type == slot.settings.type)
        continue;
      removedIds_.push_back(id);
      retiredRuntimeIds_.push_back(id);
      if (slot.kernel)
        retired_.push_back(slot.kernel);
      if (slot.passthrough)
        retired_.push_back(slot.passthrough);
    }
    descriptor_ = std::move(descriptor);
    active_ = descriptor_;
    for (std::size_t i = 0; i < order_.size(); ++i) {
      const auto id = order_[i];
      const auto &slot = nextSlots_.at(id);
      auto *row = active_.data() + 8 + i * 12;
      if (pipeline_.displayBypass_ && slot.settings.displayOnly)
        std::memcpy(row, &slot.passthrough, sizeof(slot.passthrough));
      if (i < receiveIndex) {
        row[4] = 0;
        skipped_.insert(id);
      }
      if ((i < receiveIndex) != pipeline_.skippedPrefix_.contains(id))
        reset_.push_back(readWord(row));
    }
    return true;
  }
  bool parameters(bool candidate) noexcept {
    for (auto id : mutations_) {
      auto &old = pipeline_.slots_.at(id);
      const auto &settings = candidate ? nextSlots_.at(id).settings : old.settings;
      if (!pipeline_.stage(old, settings, true))
        return false;
    }
    return true;
  }
  bool capture() noexcept override {
    const bool captured =
        parameters(true) &&
        pipeline_.engine_.capturePipelineTopology(
            active_.data(), static_cast<unsigned>(active_.size()), snapshot_) == ET_OK;
    return parameters(false) && captured;
  }
  bool prepare() override { return Engine::preparePipelineTopology(snapshot_, update_) == ET_OK; }
  bool publish() noexcept override {
    if (pipeline_.engine_.topologyNeedsGate(snapshot_, update_))
      return false;
    if (!parameters(true)) {
      parameters(false);
      return false;
    }
    if (pipeline_.engine_.publishPipelineTopology(snapshot_, update_) != ET_OK) {
      parameters(false);
      retry_ = true;
      return false;
    }
    for (auto id : retained_) {
      auto &old = pipeline_.slots_.at(id), &next = nextSlots_.at(id);
      next.frozen.swap(old.frozen);
      next.lastBoundary.swap(old.lastBoundary);
      std::swap(next.forecast, old.forecast);
      std::swap(next.streaming, old.streaming);
      next.announcedHandle = old.announcedHandle;
      next.announcedToken = old.announcedToken;
      next.dryParameters.swap(old.dryParameters);
      next.holdAsset |= old.holdAsset;
      next.pendingSettings = std::move(old.pendingSettings);
      next.pendingUpdate = old.pendingUpdate;
    }
    for (auto handle : reset_)
      pipeline_.engine_.resetInstance(handle);
    for (auto id : retiredRuntimeIds_) {
      const auto &type = pipeline_.slots_.at(id).settings.type;
      if (type == "SoundFontPlayerPlugin" || type == "SFZNotePlayerPlugin")
        ++pipeline_.runtimeRevision_;
      for (auto it = pipeline_.assets_.lower_bound({id, 0});
           it != pipeline_.assets_.end() && it->first.first == id; ++it) {
        it->second.reportedState = UINT32_MAX;
      }
    }
    for (auto id : removedIds_) {
      // Move the map nodes while render owns the live asset cache. This
      // transaction is reclaimed on control after the publish acknowledgement.
      auto it = pipeline_.assets_.lower_bound({id, 0});
      while (it != pipeline_.assets_.end() && it->first.first == id)
        retiredAssets_.insert(pipeline_.assets_.extract(it++));
    }
    pipeline_.sendId_ = sendId_;
    pipeline_.sendInstance_ = sendInstance_;
    pipeline_.receiveId_ = receiveId_;
    pipeline_.skippedPrefix_.swap(skipped_);
    pipeline_.slots_.swap(nextSlots_);
    pipeline_.descriptor_.swap(descriptor_);
    pipeline_.activeDescriptor_.swap(active_);
    pipeline_.order_.swap(order_);
    pipeline_.connectAnalysisSources();
    published_ = true;
    return true;
  }
  bool retryable() const noexcept override { return retry_; }

private:
  Pipeline &pipeline_;
  std::map<unsigned, Slot> nextSlots_;
  decltype(Pipeline::assets_) retiredAssets_;
  std::vector<unsigned> order_, created_, retired_, retained_, mutations_, removedIds_,
      retiredRuntimeIds_, reset_;
  std::set<unsigned> skipped_;
  std::vector<std::uint8_t> descriptor_, active_;
  Engine::PipelineTopologySnapshot snapshot_;
  Engine::PipelineLatencyUpdate update_;
  unsigned receiveId_ = 0, sendId_ = 0, sendInstance_ = 0;
  bool published_ = false, retry_ = false;
};
class Pipeline::Display final : public TopologyChange {
public:
  Display(Pipeline &p, bool bypass) : p_(p), bypass_(bypass), next_(p.activeDescriptor_) {
    for (std::size_t i = 0; i < p.order_.size(); ++i) {
      const auto &s = p.slots_.at(p.order_[i]);
      if (!s.settings.displayOnly || !s.passthrough)
        continue;
      const auto target = bypass || s.settings.skip ? s.passthrough : s.kernel;
      std::memcpy(next_.data() + 8 + 12 * i, &target, sizeof(target));
    }
    changed_ = next_ != p.activeDescriptor_;
  }
  bool capture() noexcept override {
    return !changed_ || p_.engine_.capturePipelineTopology(
                            next_.data(), static_cast<unsigned>(next_.size()), snapshot_) == ET_OK;
  }
  bool prepare() override {
    return !changed_ || Engine::preparePipelineTopology(snapshot_, update_) == ET_OK;
  }
  bool publish() noexcept override {
    if (changed_ && p_.engine_.publishPipelineTopology(snapshot_, update_) != ET_OK)
      return false;
    p_.displayBypass_ = bypass_;
    if (changed_)
      p_.activeDescriptor_.swap(next_);
    return true;
  }

private:
  Pipeline &p_;
  bool bypass_, changed_;
  std::vector<std::uint8_t> next_;
  Engine::PipelineTopologySnapshot snapshot_;
  Engine::PipelineLatencyUpdate update_;
};
std::unique_ptr<Pipeline::TopologyChange> Pipeline::prepareDisplay(bool bypass) {
  if (displayBypass_ == bypass)
    return {};
  return std::make_unique<Display>(*this, bypass);
}

std::unique_ptr<Pipeline::TopologyChange>
Pipeline::prepareChange(std::vector<PluginSettings> plugins, std::vector<std::uint8_t> descriptor) {
  auto change = std::make_unique<Change>(*this);
  return change->build(std::move(plugins), std::move(descriptor)) ? std::move(change) : nullptr;
}
} // namespace effetune::audio

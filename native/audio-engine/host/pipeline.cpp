#include "pipeline.h"
#include "engine.h"
#include "network_paths.h"
#include "registry.h"
#include "stream_boundaries.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <set>

namespace effetune::audio {
namespace {
std::uint32_t u32(const std::uint8_t *value) {
  std::uint32_t result;
  std::memcpy(&result, value, sizeof(result));
  return result;
}
bool validParameters(const PluginSettings &settings) {
  const auto *type = registry::find(settings.type.c_str());
  return type && type->paramsHash == settings.layoutHash &&
         type->paramsFloatCount == settings.params.size() &&
         settings.bytes.size() <= type->paramsByteCapacity &&
         std::all_of(settings.params.begin(), settings.params.end(),
                     [](float v) { return std::isfinite(v); });
}
} // namespace

std::uint32_t Pipeline::instance(std::uint32_t id) const noexcept {
  const auto found = slots_.find(id);
  return found != slots_.end() ? found->second.kernel : 0u;
}

bool Pipeline::stage(Slot &slot, const PluginSettings &settings, bool force) {
  if (slot.kernel == 0)
    return true;
  const float *parameters = settings.params.data();
  std::array<float, 256> previewParams{};
  if (settings.type == "TonalBalanceEQPlugin" && !settings.params.empty() &&
      settings.params.size() <= previewParams.size()) {
    std::copy(settings.params.begin(), settings.params.end(), previewParams.begin());
    previewParams[settings.params.size() - 1] = preview_ ? 1.f : 0.f;
    parameters = previewParams.data();
  }
  if (!slot.dryParameters.empty() && deferred(settings.id, 0)) {
    if (slot.dryParameters.size() != settings.params.size())
      return false;
    std::copy(settings.params.begin(), settings.params.end(), slot.dryParameters.begin());
    slot.dryParameters[0] = -1;
    parameters = slot.dryParameters.data();
  }
  if ((force || slot.settings.params != settings.params) &&
      engine_.setInstanceParams(slot.kernel, parameters,
                                static_cast<std::uint32_t>(settings.params.size()),
                                settings.layoutHash, 0) != ET_OK)
    return false;
  if ((force ? registry::find(settings.type.c_str())->paramsByteCapacity != 0
             : slot.settings.bytes != settings.bytes) &&
      engine_.setInstanceParamBytes(slot.kernel, settings.bytes.data(),
                                    static_cast<std::uint32_t>(settings.bytes.size()),
                                    settings.layoutHash, 0) != ET_OK)
    return false;
  return true;
}

unsigned Pipeline::kernelLatency(unsigned id) const noexcept {
  const auto handle = instance(id);
  return handle ? engine_.instanceLatency(handle) : 0;
}

bool Pipeline::update(const PluginSettings &settings) {
  auto copy = settings;
  return updateOwned(copy);
}

bool Pipeline::updateOwned(PluginSettings &settings) {
  bool deferred = false;
  return stageUpdate(settings, false, deferred) &&
         engine_.refreshPipelineLatencyRealtime() == ET_OK;
}
bool Pipeline::stageUpdate(PluginSettings &settings, bool allowGate, bool &deferred) {
  auto found = slots_.find(settings.id);
  if (found == slots_.end() || found->second.settings.type != settings.type ||
      !validParameters(settings))
    return false;
  auto &slot = found->second;
  if (!stage(slot, settings, false))
    return false;
  if (allowGate &&
      (slot.pendingUpdate || engine_.pipelineLatencyChange() == Engine::LatencyChange::Gate)) {
    if (!stage(slot, slot.settings, true))
      return false;
    slot.pendingSettings.params.swap(settings.params);
    slot.pendingSettings.bytes.swap(settings.bytes);
    slot.pendingSettings.assetPending = settings.assetPending;
    slot.pendingUpdate = true;
    deferred = true;
    return true;
  }
  slot.pendingUpdate = false;
  found->second.settings.params.swap(settings.params);
  found->second.settings.bytes.swap(settings.bytes);
  if (settings.assetPending)
    found->second.settings.assetPending = settings.assetPending;
  return true;
}
bool Pipeline::finishUpdates() noexcept {
  for (auto &[id, slot] : slots_) {
    if (!slot.pendingUpdate)
      continue;
    slot.pendingUpdate = false;
    slot.settings.params.swap(slot.pendingSettings.params);
    slot.settings.bytes.swap(slot.pendingSettings.bytes);
    if (slot.pendingSettings.assetPending)
      slot.settings.assetPending = slot.pendingSettings.assetPending;
    if (!stage(slot, slot.settings, true))
      return false;
  }
  return true;
}

bool Pipeline::configure(std::vector<PluginSettings> plugins,
                         std::vector<std::uint8_t> descriptor) {
  if (descriptor.size() < 8 || u32(descriptor.data()) != Engine::kPipelineDescriptorVersion)
    return false;
  const auto count = u32(descriptor.data() + 4);
  if (count > Engine::kMaxPipelineNodes || count != plugins.size() ||
      descriptor.size() != 8 + std::size_t(count) * 12)
    return false;
  std::map<std::uint32_t, PluginSettings *> desired;
  for (auto &plugin : plugins) {
    if (plugin.id == 0 || !desired.emplace(plugin.id, &plugin).second ||
        (!plugin.skip && !validParameters(plugin)))
      return false;
  }
  std::set<std::uint32_t> routed;
  std::vector<std::uint32_t> order;
  for (std::size_t offset = 8; offset < descriptor.size(); offset += 12) {
    const auto id = u32(descriptor.data() + offset);
    if (!desired.contains(id) || !routed.insert(id).second)
      return false;
    order.push_back(id);
  }
  std::erase_if(slots_, [&](auto &item) {
    auto found = desired.find(item.first);
    if (found != desired.end() && found->second->type == item.second.settings.type)
      return false;
    if (item.second.settings.type == "SoundFontPlayerPlugin" ||
        item.second.settings.type == "SFZNotePlayerPlugin")
      ++runtimeRevision_;
    if (item.second.kernel)
      engine_.destroyInstance(item.second.kernel);
    if (item.second.passthrough)
      engine_.destroyInstance(item.second.passthrough);
    streams_.erase(item.first);
    pendingStreams_.erase(item.first);
    std::erase_if(pendingAssets_,
                  [&](const auto &asset) { return asset.first.first == item.first; });
    std::erase_if(assets_, [&](const auto &asset) { return asset.first.first == item.first; });
    return true;
  });
  for (std::size_t offset = 8; offset < descriptor.size(); offset += 12) {
    const auto id = u32(descriptor.data() + offset);
    auto &settings = *desired.at(id);
    auto &slot = slots_[id];
    const bool created = slot.kernel == 0 && !settings.skip;
    if (created)
      slot.holdAsset = true;
    if (created) {
      slot.kernel = engine_.createInstance(settings.type.c_str());
      if (slot.kernel)
        engine_.setInstanceTap(slot.kernel, id);
    }
    if (!settings.skip && !stage(slot, settings, created || slot.settings.skip))
      return false;
    if (created && slot.kernel) {
      if (settings.type == "SoundFontPlayerPlugin" && !midi.installMap(engine_, slot.kernel))
        return false;
      for (auto it = assets_.lower_bound({id, 0}); it != assets_.end() && it->first.first == id;
           ++it) {
        if ((settings.type == "SoundFontPlayerPlugin" || settings.type == "SFZNotePlayerPlugin") &&
            !materializeInstrument(settings.type == "SoundFontPlayerPlugin", it->second))
          return false;
        if (!applyAsset(id, slot.kernel, it->first.second, &it->second))
          return false;
      }
    }
    auto target = slot.kernel;
    if (settings.skip || !target || settings.displayOnly) {
      if (!slot.passthrough) {
        slot.passthrough = engine_.createInstance("VolumePlugin");
        if (slot.passthrough)
          engine_.setInstanceTap(slot.passthrough, id);
        const float unityDb = 0.0f;
        if (!slot.passthrough ||
            engine_.setInstanceParams(slot.passthrough, &unityDb, 1,
                                      registry::find("VolumePlugin")->paramsHash, 0) != ET_OK)
          return false;
      }
      if (settings.skip || !target)
        target = slot.passthrough;
    } else if (slot.passthrough) {
      engine_.destroyInstance(slot.passthrough);
      slot.passthrough = 0;
    }
    std::memcpy(descriptor.data() + offset, &target, sizeof(target));
    if (!settings.assetPending)
      settings.assetPending = slot.settings.assetPending;
    slot.settings = std::move(settings);
  }
  descriptor_ = std::move(descriptor);
  order_ = std::move(order);
  return applyRouting();
}

bool Pipeline::setNetworkRouting(bool receive, bool bypass) {
  if (receiving_ == receive && masterBypass_ == bypass)
    return true;
  receiving_ = receive;
  masterBypass_ = bypass;
  return descriptor_.empty() || applyRouting();
}

bool Pipeline::applyRouting() {
  auto active = descriptor_;
  sendId_ = receiveId_ = sendInstance_ = 0;
  std::size_t receiveIndex = 0;
  for (std::size_t i = 0; i < order_.size(); ++i) {
    const auto *node = descriptor_.data() + 8 + 12 * i;
    if (masterBypass_ || !node[4] || !node[8])
      continue;
    const auto id = order_[i];
    const auto &type = slots_.at(id).settings.type;
    if (!sendId_ && type == "NetworkSendPlugin") {
      sendId_ = id;
      sendInstance_ = u32(node);
    }
    if (receiving_ && !receiveId_ && type == "NetworkReceivePlugin") {
      receiveId_ = id;
      receiveIndex = i;
    }
  }
  std::set<std::uint32_t> skipped;
  for (std::size_t i = 0; i < order_.size(); ++i) {
    const bool hide = i < receiveIndex;
    const auto id = order_[i];
    const auto &slot = slots_.at(id);
    if (displayBypass_ && slot.settings.displayOnly && slot.passthrough)
      std::memcpy(active.data() + 8 + i * 12, &slot.passthrough, sizeof(slot.passthrough));
    if (hide) {
      active[8 + i * 12 + 4] = 0;
      skipped.insert(id);
    }
    if (hide != skippedPrefix_.contains(id)) {
      const auto instanceId = u32(descriptor_.data() + 8 + i * 12);
      if (engine_.resetInstance(instanceId) != ET_OK)
        return false;
    }
  }
  skippedPrefix_ = std::move(skipped);
  if (activeDescriptor_ != active) {
    Engine::PipelineTopologySnapshot snapshot;
    Engine::PipelineLatencyUpdate prepared;
    if (engine_.capturePipelineTopology(active.data(), static_cast<std::uint32_t>(active.size()),
                                        snapshot) != ET_OK ||
        Engine::preparePipelineTopology(snapshot, prepared) != ET_OK ||
        engine_.publishPipelineTopology(snapshot, prepared) != ET_OK)
      return false;
    activeDescriptor_ = std::move(active);
  }
  if (engine_.refreshPipelineLatencyRealtime() != ET_OK)
    return false;
  connectAnalysisSources();
  return true;
}

void Pipeline::streamBoundary(BoundarySlice &slice) noexcept {
  for (auto &[id, slot] : slots_) {
    (void)id;
    const auto &type = slot.settings.type;
    if (!slot.kernel || (type != "RhythmAnalyzerPlugin" && type != "NoteSpectrogramPlugin"))
      continue;
    Engine::PipelineTapLatency delay{};
    const unsigned upstream =
        engine_.pipelineTapLatency(slot.kernel, delay)
            ? engine_.pipelineLatency() - std::min(engine_.pipelineLatency(), delay.input)
            : 0;
    slice.visit(engine_, slot.kernel, type, upstream, slot.lastBoundary);
  }
}
void Pipeline::traceOutputs(NetworkPaths &paths) const noexcept {
  paths.sendId = sendId_;
  paths.receiveId = receiveId_;
  paths.bypassed = masterBypass_;
  if (masterBypass_)
    return;
  engine_.tracePipelineOutputs(sendInstance_, paths.taps);
  paths.count = static_cast<unsigned>(order_.size());
  for (unsigned i = 0; i < paths.count; ++i) {
    if (!paths.taps[i].instance)
      continue;
    paths.pluginIds[i] = order_[i];
    (void)engine_.pipelineTapLatency(paths.taps[i].instance, paths.latencies[i]);
  }
}

void Pipeline::connectAnalysisSources() noexcept {
  for (const auto &[id, slot] : slots_) {
    (void)id;
    if (!slot.kernel || slot.settings.type != "SFZNotePlayerPlugin")
      continue;
    auto source = instance(slot.settings.noteAnalysisSource);
    Engine::PipelineTapLatency a{}, b{};
    if (!source || !engine_.pipelineTapLatency(slot.kernel, a) ||
        !engine_.pipelineTapLatency(source, b) || a.input != b.input)
      source = 0;
    engine_.setInstanceAnalysisSource(slot.kernel, source);
  }
}
unsigned Pipeline::remainingLatency(unsigned instance) const noexcept {
  Engine::PipelineTapLatency tap{};
  return engine_.pipelineTapLatency(instance, tap) ? tap.output : 0;
}

unsigned Pipeline::processingChannels(unsigned id, unsigned width) const noexcept {
  const auto it = std::find(order_.begin(), order_.end(), id);
  if (it == order_.end())
    return 0;
  const auto selection = static_cast<std::int8_t>(descriptor_[8 + 12 * (it - order_.begin()) + 7]);
  if (selection == -2)
    return width;
  if (selection == -1)
    return width >= 2 ? 2u : 0u;
  if (selection >= 16)
    return 2u * (static_cast<unsigned>(selection) - 15u) <= width ? 2u : 0u;
  return selection >= 0 && static_cast<unsigned>(selection) < width ? 1u : 0u;
}

unsigned Pipeline::midiTargets(std::array<MidiScheduler::Instrument, 128> &targets) const noexcept {
  unsigned count = 0;
  for (const auto &[id, slot] : slots_) {
    if (!slot.kernel || slot.settings.type != "SoundFontPlayerPlugin")
      continue;
    Engine::PipelineTapLatency latency{};
    const bool enabled = !masterBypass_ && engine_.pipelineTapLatency(slot.kernel, latency);
    const auto asset = assets_.find({id, 0});
    const auto token = asset == assets_.end() ? 0 : asset->second.operationRevision.value_or(0);
    targets[count++] = {id,
                        slot.kernel,
                        token,
                        enabled ? engine_.pipelineLatency() - latency.input : 0,
                        enabled,
                        (assetState(id, 0) & 255u) == ET_ASSET_STATE_ACTIVE,
                        slot.streaming,
                        slot.settings.midiChannelMask};
  }
  return count;
}
void Pipeline::prepareMidi(unsigned rate) {
  std::array<MidiScheduler::Instrument, 128> targets;
  const auto count = midiTargets(targets);
  midi.prepare(engine_, {targets.data(), count}, rate);
}
void Pipeline::renderMidi(std::uint64_t frame, unsigned frames, unsigned rate) noexcept {
  for (auto &[id, slot] : slots_) {
    if (!slot.frozen || !slot.frozen->resume || !slot.kernel || masterBypass_ ||
        (assetState(id, 0) & 255) != ET_ASSET_STATE_ACTIVE)
      continue;
    Engine::PipelineTapLatency tap{};
    if (!engine_.pipelineTapLatency(slot.kernel, tap))
      continue;
    auto &f = *slot.frozen;
    et_stream_readiness readiness{};
    if (slot.streaming &&
        (engine_.instanceStreamReadiness(slot.kernel, readiness) != ET_OK || !readiness.scope ||
         readiness.pending_pages ||
         (readiness.scope == ET_STREAM_SCOPE_KNOWN_MIDI && !readiness.ready_ahead_frames)))
      continue;
    const auto clock =
        f.clock + (f.sameContext && !(f.nativeState & 6) && frame >= f.frame ? frame - f.frame : 0);
    const unsigned gen = f.generation + (f.fresh ? 0 : 1);
    const et_midi_event event{
        0, 0, 0, ET_MIDI_RESUME, static_cast<unsigned>(clock), static_cast<unsigned>(clock >> 32)};
    if ((f.fresh ||
         engine_.setInstanceMidiEvents(slot.kernel, nullptr, 0, gen, ET_MIDI_RESUME) == ET_OK) &&
        engine_.setInstanceMidiClock(slot.kernel, clock, gen,
                                     f.fresh ? ET_MIDI_CLOCK_RUNNING : 0) == ET_OK &&
        (f.fresh || engine_.setInstanceMidiEvents(slot.kernel, &event, 1, gen, 0) == ET_OK))
      slot.frozen.reset();
  }
  if (!midi.generation())
    return;
  std::array<MidiScheduler::Instrument, 128> targets;
  const auto count = midiTargets(targets);
  midi.render(engine_, {targets.data(), count}, frame, frames, rate);
}
std::optional<Pipeline::Instrument> Pipeline::instrument(unsigned id) {
  const auto it = slots_.find(id);
  if (it == slots_.end() || !it->second.kernel)
    return {};
  const auto &s = it->second;
  if (s.settings.type != "SoundFontPlayerPlugin" && s.settings.type != "SFZNotePlayerPlugin")
    return {};
  const auto a = assets_.find({id, 0});
  if (a == assets_.end() || (assetState(id, 0) & 255) != ET_ASSET_STATE_ACTIVE)
    return {};
  Engine::PipelineTapLatency tap{};
  const bool enabled = !masterBypass_ && engine_.pipelineTapLatency(s.kernel, tap);
  return Instrument{engine_,
                    s.settings,
                    {id, s.kernel, a->second.operationRevision.value_or(0),
                     enabled ? engine_.pipelineLatency() - tap.input : 0, enabled, true,
                     s.streaming, s.settings.midiChannelMask},
                    a->second.replayEpoch};
}
bool Pipeline::freeze(unsigned id, std::uint64_t frame, bool fresh, bool sameContext, bool resume) {
  auto t = instrument(id);
  if (!t)
    return false;
  auto k = t->target.instance;
  slots_.at(id).frozen = Slot::Freeze{engine_.instanceMidiClock(k),
                                      frame,
                                      engine_.instanceMidiGeneration(k),
                                      engine_.instanceMidiState(k),
                                      fresh,
                                      sameContext,
                                      resume};
  return true;
}
void Pipeline::resumeInstruments() noexcept {
  for (auto &[id, slot] : slots_)
    if (slot.frozen)
      slot.frozen->resume = true;
}
bool Pipeline::hydrateMidi(unsigned id, unsigned token, unsigned generation,
                           std::span<const et_midi_event> events) {
  std::array<MidiScheduler::Instrument, 128> targets;
  const auto count = midiTargets(targets);
  for (unsigned i = 0; i < count; ++i)
    if (targets[i].id == id && targets[i].token == token)
      return midi.hydrate(engine_, targets[i], generation, events);
  return false;
}

bool Pipeline::coverage(std::span<const unsigned> ids) const noexcept {
  unsigned count = 0;
  for (unsigned i = 0; i < order_.size(); ++i) {
    const auto id = order_[i];
    const auto &slot = slots_.at(id);
    const auto *row = activeDescriptor_.data() + 8 + 12 * i;
    if (!row[4] || !row[8] || slot.settings.type == "SectionPlugin")
      continue;
    if (std::find(ids.begin(), ids.end(), id) == ids.end())
      return false;
    ++count;
  }
  return count == ids.size();
}
bool Pipeline::resetTemporal(std::span<const unsigned> ids) noexcept {
  for (auto id : ids) {
    auto it = slots_.find(id);
    if (it == slots_.end())
      return false;
    const auto &s = it->second;
    if ((s.settings.type == "SoundFontPlayerPlugin" || s.settings.type == "SFZNotePlayerPlugin") &&
        (assetState(id, 0) & 255u) == ET_ASSET_STATE_ACTIVE && !s.frozen)
      return false;
  }
  for (auto id : ids) {
    const auto found = slots_.find(id);
    if (found == slots_.end())
      continue;
    const auto &s = found->second;
    if ((s.settings.type == "SoundFontPlayerPlugin" || s.settings.type == "SFZNotePlayerPlugin") &&
        (assetState(id, 0) & 255u) == ET_ASSET_STATE_ACTIVE)
      continue;
    if (s.kernel && engine_.resetInstance(s.kernel) != ET_OK)
      return false;
  }
  return true;
}
bool Pipeline::assetPending() const noexcept {
  if (hasPendingAssets_.load(std::memory_order_relaxed))
    return true;
  for (const auto &[id, slot] : slots_) {
    const auto state = assetState(id, 0) & 255u;
    if ((state == ET_ASSET_STATE_NONE && slot.settings.assetPending.value_or(false)) ||
        state == ET_ASSET_STATE_STAGED || state == ET_ASSET_STATE_PREPARING ||
        (slot.kernel && !slot.frozen &&
         (slot.settings.type == "SFZNotePlayerPlugin" ||
          slot.settings.type == "SoundFontPlayerPlugin") &&
         (engine_.instanceMidiState(slot.kernel) & 23)))
      return true;
  }
  return false;
}
bool Pipeline::needsInstrumentCheckpoint() const noexcept {
  for (const auto &[id, s] : slots_)
    if (!s.frozen &&
        (s.settings.type == "SFZNotePlayerPlugin" ||
         (s.settings.type == "SoundFontPlayerPlugin" && midi.generation())) &&
        (assetState(id, 0) & 255u) == ET_ASSET_STATE_ACTIVE)
      return true;
  return false;
}
bool Pipeline::holdsInsertedAsset() noexcept {
  bool held = false;
  for (unsigned i = 0; i < order_.size(); ++i) {
    auto &slot = slots_.at(order_[i]);
    if (!slot.holdAsset)
      continue;
    const auto *row = activeDescriptor_.data() + 8 + 12 * i;
    const auto state = assetState(order_[i], 0) & 255u;
    slot.holdAsset = !masterBypass_ && row[4] && row[8] && slot.kernel && !slot.settings.skip &&
                     (state == ET_ASSET_STATE_STAGED || state == ET_ASSET_STATE_PREPARING ||
                      (state == ET_ASSET_STATE_NONE && slot.settings.assetPending.value_or(false)));
    held |= slot.holdAsset;
  }
  return held;
}
void Pipeline::preview(bool active) noexcept {
  preview_ = active;
  for (auto &[id, slot] : slots_) {
    (void)id;
    if (slot.settings.type == "TonalBalanceEQPlugin")
      stage(slot, slot.settings, true);
  }
}
} // namespace effetune::audio

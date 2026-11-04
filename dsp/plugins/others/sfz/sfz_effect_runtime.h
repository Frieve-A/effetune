#ifndef EFFETUNE_SFZ_EFFECT_RUNTIME_H
#define EFFETUNE_SFZ_EFFECT_RUNTIME_H
#include "sfz_effect_node.h"
#include <limits>

namespace effetune::plugins::others::sfz {
struct EffectImpulse {
  std::span<const float> samples{};
  std::uint32_t channels = 0, frames = 0;
};
struct EffectRuntimeBudget {
  std::uint64_t bytes = 0;
  std::uint32_t controllerEvents = 0;
};

class EffectRuntime {
  struct ControllerEvent {
    std::uint32_t frame = 0, controller = 0;
    float value = 0;
  };

public:
  struct Geometry {
    std::uint64_t persistentBytes = 0, preparationBytes = 0;
    std::array<std::uint32_t, fxschema::kMaximumNodes> nodeBuses{};
    std::array<EffectImpulse, fxschema::kMaximumNodes> impulses{};
    std::array<double, fxschema::kMaximumNodes> delaySeconds{};
    std::array<dsp::ConvolverStorage, fxschema::kMaximumNodes> convolution{};
  };
  template <class ResolveImpulse>
  static bool storageRequirements(const EffectPlan &plan, const PrepareInfo &info,
                                  std::uint32_t actualChannels, ResolveImpulse &&resolveImpulse,
                                  float minimumPhysicalBpm, EffectRuntimeBudget budget,
                                  Geometry &geometry) {
    geometry = {};
    if (!std::isfinite(info.sampleRate) || info.sampleRate < 1 || info.sampleRate > 768000 ||
        !info.maxFrames || actualChannels == 0 || actualChannels > 16 ||
        actualChannels > info.maxChannels || !std::isfinite(minimumPhysicalBpm) ||
        minimumPhysicalBpm < 0 || !budget.controllerEvents)
      return false;
    const auto count = plan.nodeCount();
    if (count > fxschema::kMaximumNodes)
      return false;
    for (auto region = 0u; region < plan.regionCount(); ++region)
      if (!EffectBuses::outputAvailable(plan.region(region).output, actualChannels))
        return false;
    auto &nodeBuses = geometry.nodeBuses;
    auto &impulses = geometry.impulses;
    auto &delaySeconds = geometry.delaySeconds;
    std::uint64_t bytes = sizeof(EffectRuntime);
    const auto charge = [&](std::uint64_t amount) {
      if (bytes > budget.bytes || amount > budget.bytes - bytes)
        return false;
      bytes += amount;
      return true;
    };
    if (!charge(static_cast<std::uint64_t>(count) * (sizeof(EffectNode) + sizeof(std::uint32_t))) ||
        !charge(static_cast<std::uint64_t>(budget.controllerEvents) * sizeof(ControllerEvent)) ||
        !charge(static_cast<std::uint64_t>(EffectBuses::kBusCount) * 2 * info.maxFrames *
                sizeof(float)))
      return false;
    for (auto index = 0u; index < count; ++index) {
      const auto node = plan.node(index);
      nodeBuses[index] = node[1];
      if (node[1] >= EffectBuses::kBusCount ||
          (node[1] < EffectBuses::kFirstSend &&
           !EffectBuses::outputAvailable(node[1], actualChannels)))
        return false;
      if (!charge(static_cast<std::uint64_t>(node[3]) * 2 * sizeof(float) +
                  static_cast<std::uint64_t>(node[5]) * sizeof(modulation::RampState)))
        return false;
      const auto type = static_cast<fxschema::Type>(node[0]);
      const auto rate = static_cast<double>(info.sampleRate);
      std::uint64_t extra = 0;
      switch (type) {
      case fxschema::Type::delay:
        delaySeconds[index] = EffectNode::delaySeconds(plan, index, minimumPhysicalBpm);
        if (delaySeconds[index] < 0)
          return false;
        delaySeconds[index] = std::max(1 / rate, delaySeconds[index]);
        if (const auto frames = EffectDelay::storageFrames(info.sampleRate, delaySeconds[index]))
          extra = static_cast<std::uint64_t>(frames) * 2 * sizeof(float);
        else
          return false;
        [[fallthrough]];
      case fxschema::Type::filter:
      case fxschema::Type::staticNoise:
        extra += static_cast<std::uint64_t>(VoiceFilter::maximumCombFrames(info.sampleRate)) * 2 *
                 sizeof(float);
        break;
      case fxschema::Type::fverb:
        extra = EffectReverb::storageBytes(rate);
        break;
      case fxschema::Type::chorus:
        extra = EffectChorus::storageBytes(rate);
        break;
      case fxschema::Type::strings:
        for (auto string = 0u; string < static_cast<unsigned>(plan.parameter(node, 0)); ++string) {
          const auto frames = EffectStrings::storageFrames(info.sampleRate, string);
          if (!frames)
            return false;
          extra += static_cast<std::uint64_t>(frames) * sizeof(float);
        }
        break;
      case fxschema::Type::tdfir:
        impulses[index] = resolveImpulse(plan.impulse(node[6]));
        break;
      default:
        break;
      }
      if (!charge(extra))
        return false;
      if (type == fxschema::Type::tdfir) {
        const auto &impulse = impulses[index];
        auto &storage = geometry.convolution[index];
        if (!EffectConvolver::storageRequirements(impulse.channels, impulse.frames, storage) ||
            storage.preparationBytes > budget.bytes - bytes)
          return false;
        geometry.preparationBytes =
            std::max(geometry.preparationBytes, bytes + storage.preparationBytes);
        if (!charge(storage.persistentBytes))
          return false;
      }
    }
    geometry.persistentBytes = bytes;
    geometry.preparationBytes = std::max(geometry.preparationBytes, bytes);
    return true;
  }

  template <class ResolveImpulse>
  bool prepare(const EffectPlan &plan, const PrepareInfo &info, std::uint32_t actualChannels,
               ResolveImpulse &&resolveImpulse, float minimumPhysicalBpm,
               EffectRuntimeBudget budget, std::uint64_t seed = 1) {
    prepared_ = pending_ = active_ = quantumInput_ = false;
    quietCommittedFrames_ = 0;
    Geometry geometry;
    if (!storageRequirements(plan, info, actualChannels, resolveImpulse, minimumPhysicalBpm, budget,
                             geometry))
      return false;
    const auto count = plan.nodeCount();
    const auto &nodeBuses = geometry.nodeBuses;
    const auto &impulses = geometry.impulses;
    const auto &delaySeconds = geometry.delaySeconds;
    if (!nodes_.allocate(count) || !events_.allocate(budget.controllerEvents))
      return false;
    // Every physical pair/send has scratch even when an authored base send is
    // zero. A later accepted controller must never expose uncleared storage.
    std::array<EffectRegionRouting, 8> physical{};
    const auto pairs = actualChannels == 1 ? 1 : actualChannels / 2;
    for (auto pair = 0u; pair < pairs; ++pair)
      physical[pair] = {pair, {1, 1, 1, 1}};
    if (!buses_.prepare(actualChannels, info.maxFrames, {physical.data(), pairs},
                        {nodeBuses.data(), count}, plan.returns()))
      return false;
    quietFrames_ = 0;
    hasGenerator_ = false;
    for (auto index = 0u; index < count; ++index) {
      const auto &impulse = impulses[index];
      if (!nodes_.data()[index].prepare(plan, index, info, seed + index, delaySeconds[index],
                                        impulse.samples, impulse.channels, impulse.frames,
                                        minimumPhysicalBpm,
                                        geometry.convolution[index].preparationBytes))
        return false;
      if (nodes_.data()[index].convolutionBytes() != geometry.convolution[index].persistentBytes)
        return false;
      quietFrames_ = std::max(quietFrames_, nodes_.data()[index].minimumQuietFrames());
      hasGenerator_ |= plan.node(index)[0] == static_cast<unsigned>(fxschema::Type::staticNoise);
    }
    channels_ = actualChannels;
    rate_ = info.sampleRate;
    storageBytes_ = geometry.persistentBytes;
    prepared_ = true;
    return true;
  }

  bool beginQuantum(std::uint32_t frames, std::span<const float> latestAcceptedCC,
                    std::uint64_t renderFrame = 0) noexcept {
    pending_ = false;
    if (!prepared_ || latestAcceptedCC.size() != 128 || !buses_.begin(frames))
      return false;
    for (auto cc = 0u; cc < 128; ++cc) {
      if (!std::isfinite(latestAcceptedCC[cc]) || latestAcceptedCC[cc] < 0 ||
          latestAcceptedCC[cc] > 1)
        return false;
      source_[cc] = latestAcceptedCC[cc];
    }
    frames_ = frames;
    renderFrame_ = renderFrame;
    eventCount_ = 0;
    quantumInput_ = false;
    pending_ = true;
    return true;
  }
  bool recordCC(std::uint32_t frame, std::uint32_t controller, float value) noexcept {
    if (!pending_ || frame >= frames_ || controller >= 128 || !std::isfinite(value) || value < 0 ||
        value > 1 || (eventCount_ && frame < events_.data()[eventCount_ - 1].frame)) {
      pending_ = false;
      return false;
    }
    // FX observe one final global CC value per controller at each audio sample.
    // Sampler actions still consume every accepted event before this journal.
    for (auto index = eventCount_; index > 0 && events_.data()[index - 1].frame == frame; --index) {
      if (events_.data()[index - 1].controller == controller) {
        events_.data()[index - 1].value = value;
        return true;
      }
    }
    if (eventCount_ >= events_.size()) {
      pending_ = false;
      return false;
    }
    events_.data()[eventCount_++] = {frame, controller, value};
    return true;
  }
  bool voiceMix(std::uint32_t frame, std::uint32_t output, std::span<const float> sends, float left,
                float right) noexcept {
    if (!pending_ || frame >= frames_ || !EffectBuses::outputAvailable(output, channels_) ||
        sends.size() != 4 || !std::isfinite(left) || !std::isfinite(right)) {
      pending_ = false;
      return false;
    }
    EffectRegionRouting routing{output, {}};
    for (auto send = 0u; send < 4; ++send) {
      if (!std::isfinite(sends[send]) || sends[send] < 0 || sends[send] > 1) {
        pending_ = false;
        return false;
      }
      routing.sends[send] = sends[send];
    }
    buses_.add(routing, frame, left, right);
    quantumInput_ = quantumInput_ || left != 0 || right != 0;
    return true;
  }
  // fillExtended is a stateless native-clock query for indices128..155. It is
  // invoked before mutation for tempo admission, then again during commitment.
  template <class FillExtended>
  bool commit(float *audio, const ProcessInfo &info, std::span<const modulation::Curve> curves,
              FillExtended &&fillExtended) noexcept {
    if (!audio)
      return false;
    return commitOutput(channels_, info, curves, fillExtended,
                        [&](unsigned frame, unsigned channel, float value) {
                          audio[static_cast<std::size_t>(channel) * frames_ + frame] += value;
                        });
  }
  template <class FillExtended, class EmitOutput>
  bool commitOutput(std::uint32_t channels, const ProcessInfo &info,
                    std::span<const modulation::Curve> curves, FillExtended &&fillExtended,
                    EmitOutput &&emit) noexcept {
    if (!pending_ || channels != channels_)
      return false;
    pending_ = false;
    for (auto frame = 0u; frame < frames_; ++frame) {
      auto extended = std::span<float>(source_).subspan(128);
      std::fill(extended.begin(), extended.end(), 0.0F);
      fillExtended(frame, extended);
      for (auto node = 0u; node < nodes_.size(); ++node)
        if (!nodes_.data()[node].acceptsTempo(source_[142]))
          return false;
    }
    auto event = 0u;
    bool audible = quantumInput_;
    const auto committed = buses_.finishFramesTo(
        channels_,
        [&](unsigned frame) {
          while (event < eventCount_ && events_.data()[event].frame == frame) {
            const auto &change = events_.data()[event++];
            source_[change.controller] = change.value;
          }
          auto extended = std::span<float>(source_).subspan(128);
          std::fill(extended.begin(), extended.end(), 0.0F);
          fillExtended(frame, extended);
        },
        [&](std::size_t node, float &left, float &right, unsigned frame) {
          ProcessInfo atFrame = info;
          atFrame.timeSeconds += frame / static_cast<double>(rate_);
          nodes_.data()[node].process(left, right, {source_, renderFrame_ + frame}, curves,
                                      atFrame);
        },
        [&](unsigned frame, unsigned channel, float value) {
          audible = audible || effectOutputAudible(value);
          emit(frame, channel, value);
        });
    if (!committed)
      return false;
    for (auto node = 0u; node < nodes_.size(); ++node)
      audible = audible || nodes_.data()[node].active();
    if (active_ || audible) {
      quietCommittedFrames_ = audible ? 0 : quietCommittedFrames_ + frames_;
      active_ = audible || quietCommittedFrames_ <
                               static_cast<std::uint64_t>(std::ceil(rate_ * kEffectQuietSeconds));
      if (!active_)
        reset();
    }
    return true;
  }
  void reset() noexcept {
    pending_ = false;
    eventCount_ = 0;
    active_ = quantumInput_ = false;
    quietCommittedFrames_ = 0;
    for (auto node = 0u; node < nodes_.size(); ++node)
      nodes_.data()[node].reset();
  }
  [[nodiscard]] bool generates() const noexcept {
    for (auto node = 0u; node < nodes_.size(); ++node)
      if (nodes_.data()[node].generates())
        return true;
    return false;
  }
  [[nodiscard]] bool hasGenerator() const noexcept { return hasGenerator_; }
  [[nodiscard]] bool active() const noexcept { return active_; }
  [[nodiscard]] std::uint32_t pendingFrames() const noexcept { return pending_ ? frames_ : 0; }
  [[nodiscard]] std::uint64_t minimumQuietFrames() const noexcept { return quietFrames_; }
  [[nodiscard]] std::uint64_t storageBytes() const noexcept { return storageBytes_; }

private:
  EffectBuses buses_;
  NothrowStorage<EffectNode> nodes_;
  NothrowStorage<ControllerEvent> events_;
  std::array<float, 156> source_{};
  std::uint64_t renderFrame_ = 0, quietFrames_ = 0, storageBytes_ = 0, quietCommittedFrames_ = 0;
  std::uint32_t frames_ = 0, channels_ = 0, eventCount_ = 0;
  float rate_ = 0;
  bool prepared_ = false, pending_ = false, hasGenerator_ = false, active_ = false,
       quantumInput_ = false;
};
} // namespace effetune::plugins::others::sfz
#endif

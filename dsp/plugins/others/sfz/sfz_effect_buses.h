#ifndef EFFETUNE_SFZ_EFFECT_BUSES_H
#define EFFETUNE_SFZ_EFFECT_BUSES_H
#include "nothrow_storage.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <span>

namespace effetune::plugins::others::sfz {
struct EffectRegionRouting {
  std::uint32_t output = 0;
  std::array<float, 4> sends{};
};
struct EffectReturnRouting {
  float directToMain = 1;
  std::array<float, 4> toMain{}, toMix{};
};
// Accumulation is trial-local scratch. The caller invokes finish only after all
// sample reads succeed; only then may the effect processor advance its state.
class EffectBuses {
public:
  static constexpr std::uint32_t kBusCount = 13, kFirstSend = 9;
  bool prepare(std::uint32_t channels, std::uint32_t maxFrames,
               std::span<const EffectRegionRouting> regions,
               std::span<const std::uint32_t> nodeBuses,
               const EffectReturnRouting &returns) noexcept {
    if (!channels || channels > 16 || !maxFrames || !gain(returns.directToMain))
      return false;
    std::uint32_t used = 1;
    for (const auto &region : regions) {
      if (!outputAvailable(region.output, channels))
        return false;
      used |= 1u << region.output;
      for (auto send = 0u; send < 4u; ++send) {
        if (!gain(region.sends[send]))
          return false;
        if (region.sends[send] != 0)
          used |= 1u << (kFirstSend + send);
      }
    }
    for (const auto bus : nodeBuses) {
      if (bus >= kBusCount || (bus < kFirstSend && !outputAvailable(bus, channels)))
        return false;
      used |= 1u << bus;
    }
    for (auto send = 0u; send < 4u; ++send)
      if (!gain(returns.toMain[send]) || !gain(returns.toMix[send]))
        return false;
    if (!scratch_.allocate(static_cast<std::size_t>(kBusCount) * 2u * maxFrames) ||
        !node_buses_.allocate(nodeBuses.size()))
      return false;
    std::copy(nodeBuses.begin(), nodeBuses.end(), node_buses_.data());
    channels_ = channels;
    max_frames_ = maxFrames;
    used_ = used;
    returns_ = returns;
    return true;
  }
  static bool outputAvailable(std::uint32_t output, std::uint32_t channels) noexcept {
    return output == 0 ? channels > 0 : output < channels / 2;
  }
  bool begin(std::uint32_t frames) noexcept {
    if (!frames || frames > max_frames_)
      return false;
    frames_ = frames;
    for (auto bus = 0u; bus < kBusCount; ++bus)
      if (used_ & (1u << bus))
        std::fill_n(data(bus), 2u * frames, 0.0F);
    return true;
  }
  void add(const EffectRegionRouting &region, std::uint32_t frame, float left,
           float right) noexcept {
    addTo(region.output, frame, left, right, 1);
    for (auto send = 0u; send < 4u; ++send)
      if (region.sends[send] != 0)
        addTo(kFirstSend + send, frame, left, right, region.sends[send]);
  }
  template <class ProcessNode>
  bool finish(float *audio, std::uint32_t channels, ProcessNode &&process) noexcept {
    if (!audio || channels != channels_ || !frames_)
      return false;
    // Effects on each bus retain source-header order. The bus graph itself is
    // acyclic: a send return never reenters its own send or the main FX chain.
    for (std::size_t node = 0; node < node_buses_.size(); ++node)
      process(node, data(node_buses_.data()[node]), frames_);
    mixOutputs(channels, [&](unsigned frame, unsigned channel, float value) {
      audio[static_cast<std::size_t>(channel) * frames_ + frame] += value;
    });
    return true;
  }
  // A single current source frame is shared by every effect at that sample.
  // This avoids both an end-of-block CC approximation and a per-frame snapshot.
  template <class BeginFrame, class ProcessNode>
  bool finishFrames(float *audio, std::uint32_t channels, BeginFrame &&beginFrame,
                    ProcessNode &&process) noexcept {
    if (!audio)
      return false;
    return finishFramesTo(channels, beginFrame, process,
                          [&](unsigned frame, unsigned channel, float value) {
                            audio[static_cast<std::size_t>(channel) * frames_ + frame] += value;
                          });
  }
  template <class BeginFrame, class ProcessNode, class EmitOutput>
  bool finishFramesTo(std::uint32_t channels, BeginFrame &&beginFrame, ProcessNode &&process,
                      EmitOutput &&emit) noexcept {
    if (channels != channels_ || !frames_)
      return false;
    for (auto frame = 0u; frame < frames_; ++frame) {
      beginFrame(frame);
      for (std::size_t node = 0; node < node_buses_.size(); ++node) {
        auto *bus = data(node_buses_.data()[node]);
        process(node, bus[frame], bus[frames_ + frame], frame);
      }
    }
    mixOutputs(channels, emit);
    return true;
  }

private:
  template <class EmitOutput> void mixOutputs(std::uint32_t channels, EmitOutput &&emit) noexcept {
    const auto *main = data(0);
    for (auto frame = 0u; frame < frames_; ++frame) {
      float left = main[frame] * returns_.directToMain;
      float right = main[frames_ + frame] * returns_.directToMain;
      float mixLeft = 0, mixRight = 0;
      for (auto send = 0u; send < 4u; ++send) {
        if (!(used_ & (1u << (kFirstSend + send))))
          continue;
        const auto *wet = data(kFirstSend + send);
        left += wet[frame] * returns_.toMain[send];
        right += wet[frames_ + frame] * returns_.toMain[send];
        mixLeft += wet[frame] * returns_.toMix[send];
        mixRight += wet[frames_ + frame] * returns_.toMix[send];
      }
      left += mixLeft;
      right += mixRight;
      if (channels == 1)
        emit(frame, 0u, (left + right) * .5F);
      else {
        emit(frame, 0u, left);
        emit(frame, 1u, right);
      }
      for (auto channel = 2u; channel < channels; ++channel) {
        const auto output = channel / 2;
        const bool available = output < channels / 2 && (used_ & (1u << output));
        const auto value = available ? data(output)[(channel % 2) * frames_ + frame] : 0.0F;
        emit(frame, channel, value);
      }
    }
  }
  static bool gain(float value) noexcept {
    return std::isfinite(value) && value >= 0 && value <= 1;
  }
  float *data(std::uint32_t bus) noexcept {
    return scratch_.data() + static_cast<std::size_t>(bus) * 2u * max_frames_;
  }
  void addTo(std::uint32_t bus, std::uint32_t frame, float left, float right, float gain) noexcept {
    auto *samples = data(bus);
    samples[frame] += left * gain;
    samples[frames_ + frame] += right * gain;
  }
  NothrowStorage<float> scratch_;
  NothrowStorage<std::uint32_t> node_buses_;
  EffectReturnRouting returns_{};
  std::uint32_t channels_ = 0, max_frames_ = 0, frames_ = 0, used_ = 0;
};
} // namespace effetune::plugins::others::sfz
#endif

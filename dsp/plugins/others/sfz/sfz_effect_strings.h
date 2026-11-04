#ifndef EFFETUNE_SFZ_EFFECT_STRINGS_H
#define EFFETUNE_SFZ_EFFECT_STRINGS_H
#include "nothrow_storage.h"
#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::others::sfz {
// Independently authored sympathetic waveguides for the published strings FX.
// Strings span consecutive equal-tempered MIDI notes from A0 (21), up to 127.
// Count is bounded by 107 distinct strings; each has a 3-second T60, weak bus
// excitation and one-pole loss. This is not the undocumented region waveguide.
class EffectStrings {
public:
  static constexpr unsigned kMaximumStrings = 107;
  static double delayFrames(float rate, unsigned index) noexcept {
    const double frequency = 440 * std::exp2((static_cast<int>(index) + 21 - 69) / 12.0);
    return frequency >= rate * .45 ? -1 : rate / frequency - .25;
  }
  static std::uint32_t storageFrames(float rate, unsigned index) noexcept {
    const auto delay = delayFrames(rate, index);
    return delay < 0 ? 0 : static_cast<std::uint32_t>(std::ceil(delay)) + 2;
  }
  bool prepare(float rate, unsigned count) noexcept {
    if (!std::isfinite(rate) || rate <= 0 || count == 0 || count > kMaximumStrings)
      return false;
    count_ = count;
    std::size_t total = 0;
    for (auto index = 0u; index < count_; ++index) {
      auto &string = strings_[index];
      string.delay = delayFrames(rate, index);
      string.frames = storageFrames(rate, index);
      if (!string.frames)
        return false;
      string.offset = total;
      total += string.frames;
      string.feedback = static_cast<float>(std::pow(.001, string.delay / (rate * 3.0)));
    }
    if (!storage_.allocate(total))
      return false;
    reset();
    return true;
  }
  void reset() noexcept {
    storage_.clear();
    for (auto &string : strings_) {
      string.position = 0;
      string.previous = 0;
    }
  }
  void process(float &left, float &right, float wet) noexcept {
    const float excitation = (left + right) * .5F;
    float outputLeft = 0, outputRight = 0;
    for (auto index = 0u; index < count_; ++index) {
      auto &string = strings_[index];
      auto *buffer = storage_.data() + string.offset;
      const auto age = static_cast<unsigned>(string.delay);
      const float fraction = static_cast<float>(string.delay - age);
      const auto value =
          buffer[(string.position + string.frames - age) % string.frames] * (1 - fraction) +
          buffer[(string.position + string.frames - age - 1) % string.frames] * fraction;
      const float loss = .75F * value + .25F * string.previous;
      string.previous = value;
      buffer[string.position] = excitation * .05F + loss * string.feedback;
      string.position = (string.position + 1) % string.frames;
      const float pan = count_ == 1 ? .5F : static_cast<float>(index) / (count_ - 1);
      outputLeft += value * (1 - pan);
      outputRight += value * pan;
    }
    const float gain = count_ ? 2 * wet / std::sqrt(static_cast<float>(count_)) : 0;
    left += outputLeft * gain;
    right += outputRight * gain;
  }

private:
  struct String {
    double delay = 0;
    float feedback = 0, previous = 0;
    std::size_t offset = 0;
    unsigned frames = 0, position = 0;
  };
  NothrowStorage<float> storage_;
  std::array<String, kMaximumStrings> strings_{};
  unsigned count_ = 0;
};
} // namespace effetune::plugins::others::sfz
#endif

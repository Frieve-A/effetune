#ifndef EFFETUNE_SFZ_MIDI_CHANNEL_METER_H
#define EFFETUNE_SFZ_MIDI_CHANNEL_METER_H
#include "nothrow_storage.h"
#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <limits>

namespace effetune::plugins::others::sfz {
// Direct stereo channel sums are measured before shared effect returns. A
// completed quantum is committed only after the corresponding audio succeeds.
class MidiChannelMeter {
public:
  bool prepare(std::uint32_t maximumFrames) noexcept {
    const auto frames = static_cast<std::size_t>(maximumFrames);
    if (!frames || frames > SIZE_MAX / (32u * sizeof(float)))
      return false;
    maximum_frames_ = maximumFrames;
    return planes_.allocate(frames * 32u);
  }
  bool enabled() const noexcept { return enabled_; }
  void setEnabled(bool enabled) noexcept {
    if (enabled_ == enabled)
      return;
    enabled_ = enabled;
    cancel();
    clear();
  }
  void clear() noexcept {
    if (frames_)
      clear_on_commit_ = true;
    else
      pending_.fill(0);
    active_ = 0;
  }
  void begin(std::uint32_t frames, float gain) noexcept {
    frames_ = enabled_ && frames <= maximum_frames_ ? frames : 0;
    active_ = 0;
    clear_on_commit_ = false;
    gain_ = gain;
  }
  void add(std::uint32_t channel, std::uint32_t frame, float left, float right) noexcept {
    if (frame >= frames_ || (left == 0 && right == 0))
      return;
    const auto bit = 1u << channel;
    auto *l = planes_.data() + 2u * channel * maximum_frames_;
    auto *r = l + maximum_frames_;
    if (!(active_ & bit)) {
      std::fill_n(l, frames_, 0.0F);
      std::fill_n(r, frames_, 0.0F);
      active_ |= bit;
    }
    l[frame] += left;
    r[frame] += right;
  }
  void commit() noexcept {
    if (clear_on_commit_)
      pending_.fill(0);
    auto channels = active_;
    while (channels) {
      const auto channel = static_cast<unsigned>(std::countr_zero(channels));
      channels &= channels - 1u;
      const auto *l = planes_.data() + 2u * channel * maximum_frames_;
      const auto *r = l + maximum_frames_;
      auto peak = 0.0F;
      for (auto frame = 0u; frame < frames_; ++frame) {
        const auto left = l[frame] * gain_, right = r[frame] * gain_;
        const auto a = left < 0 ? -left : left, b = right < 0 ? -right : right;
        if (a > peak)
          peak = a;
        if (b > peak)
          peak = b;
      }
      if (std::isfinite(peak) && peak > pending_[channel])
        pending_[channel] = peak;
    }
    cancel();
  }
  void cancel() noexcept {
    frames_ = active_ = 0;
    clear_on_commit_ = false;
  }
  float peak(std::uint32_t channel) const noexcept { return pending_[channel]; }
  void consume() noexcept { pending_.fill(0); }

private:
  NothrowStorage<float> planes_;
  std::array<float, 16> pending_{};
  std::uint32_t maximum_frames_ = 0, frames_ = 0, active_ = 0;
  float gain_ = 1;
  bool enabled_ = false, clear_on_commit_ = false;
};
} // namespace effetune::plugins::others::sfz
#endif

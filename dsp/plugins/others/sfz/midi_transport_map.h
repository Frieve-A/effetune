#ifndef EFFETUNE_SFZ_MIDI_TRANSPORT_MAP_H
#define EFFETUNE_SFZ_MIDI_TRANSPORT_MAP_H

#include "effetune/kernel.h"
#include <cmath>
#include <cstring>
#include <memory>
#include <new>

namespace effetune::plugins::others::sfz {

// This value belongs to render/checkpoint state. It does not advance a clock.
struct MidiTransportMapping {
  std::uint64_t frame = 0;
  double seconds = 0, speed = 1, duration = 0;
  std::uint32_t flags = 0;

  [[nodiscard]] bool valid() const noexcept {
    return frame <= 9007199254740991ull && std::isfinite(seconds) && seconds >= 0 &&
           std::isfinite(speed) && speed > 0 && std::isfinite(duration) && duration >= 0 &&
           (flags & ~7u) == 0;
  }
};

class MidiTransportMap {
public:
  // Matches the SMF parser's event budget plus its initial tempo/meter defaults.
  static constexpr std::uint32_t kMaxPoints = 250002;
  et_status assign(const et_midi_transport_point *points, std::uint32_t count) noexcept {
    if (count > kMaxPoints || (count && !points))
      return ET_ERR_ARGS;
    double minimum = 0;
    for (std::uint32_t i = 0; i < count; ++i) {
      const auto &p = points[i];
      if (!std::isfinite(p.seconds) || p.seconds < 0 || !std::isfinite(p.ppq) || p.ppq < 0 ||
          !std::isfinite(p.bar_start_ppq) || !std::isfinite(p.bpm) || p.bpm <= 0 || !p.numerator ||
          !p.denominator || (i && p.seconds <= points[i - 1].seconds) || (!i && p.seconds != 0))
        return ET_ERR_ARGS;
      if (!i || p.bpm < minimum)
        minimum = p.bpm;
    }
    std::unique_ptr<et_midi_transport_point[]> next;
    if (count) {
      next.reset(new (std::nothrow) et_midi_transport_point[count]);
      if (!next)
        return ET_ERR_OOM;
      std::memcpy(next.get(), points, count * sizeof(*points));
    }
    points_ = std::move(next);
    count_ = count;
    minimum_bpm_ = minimum;
    return ET_OK;
  }

  [[nodiscard]] bool available() const noexcept { return count_ != 0; }
  [[nodiscard]] double minimumBpm() const noexcept { return minimum_bpm_; }

  [[nodiscard]] HostTransport at(const MidiTransportMapping &mapping, std::uint64_t frame,
                                 double sampleRate) const noexcept {
    HostTransport result{};
    if (!count_ || !(mapping.flags & ET_MIDI_TRANSPORT_ENABLED))
      return result;
    const double secondsPerFrame = mapping.speed / sampleRate;
    const double elapsedFrames = static_cast<double>(frame) - static_cast<double>(mapping.frame);
    const bool ended =
        elapsedFrames >= std::floor((mapping.duration - mapping.seconds) / secondsPerFrame + .5);
    // Musical changes use the same nearest-frame convention as MIDI messages.
    std::uint32_t low = 0, high = count_;
    while (low < high) {
      const auto middle = low + (high - low) / 2;
      const double boundary =
          std::floor((points_[middle].seconds - mapping.seconds) / secondsPerFrame + .5);
      if (boundary <= elapsedFrames && points_[middle].seconds <= mapping.duration)
        low = middle + 1;
      else
        high = middle;
    }
    const auto &point = points_[low ? low - 1 : 0];
    result.flags = HostTransport::kTempoValid | HostTransport::kPositionValid |
                   HostTransport::kBarStartValid | HostTransport::kTimeSignatureValid;
    if ((mapping.flags & ET_MIDI_TRANSPORT_PLAYING) && !ended)
      result.flags |= HostTransport::kPlaying;
    if (mapping.flags & ET_MIDI_TRANSPORT_LOOPING)
      result.flags |= HostTransport::kLooping;
    result.tempoBpm = point.bpm * mapping.speed;
    const double boundary = std::floor((point.seconds - mapping.seconds) / secondsPerFrame + .5);
    const double framesFromPoint = elapsedFrames > boundary ? elapsedFrames - boundary : 0;
    // Anchor to the rounded event frame, so a meter change never starts just
    // before its own bar (which would wrap to the preceding bar's final beat).
    const double secondsFromPoint =
        ended ? mapping.duration - point.seconds : framesFromPoint * secondsPerFrame;
    result.ppqPosition = point.ppq + secondsFromPoint * point.bpm / 60;
    result.barStartPpq = point.bar_start_ppq;
    result.timeSignatureNumerator = point.numerator;
    result.timeSignatureDenominator = point.denominator;
    return result;
  }

private:
  std::unique_ptr<et_midi_transport_point[]> points_;
  std::uint32_t count_ = 0;
  double minimum_bpm_ = 0;
};
static_assert(sizeof(et_midi_transport_point) == 40);
} // namespace effetune::plugins::others::sfz
#endif

#pragma once

#include <algorithm>
#include <cstdint>
#include <span>
#include <vector>

namespace effetune::audio {

inline constexpr std::uint32_t maxDeviceSelectionChannels = 16;

inline bool selectDeviceChannels(std::uint32_t physical, std::span<const std::uint32_t> requested,
                                 std::vector<std::uint32_t> &selected) {
  if (physical == 0 || requested.size() > maxDeviceSelectionChannels)
    return false;
  for (auto it = requested.begin(); it != requested.end(); ++it)
    if (*it >= physical || std::find(requested.begin(), it, *it) != it)
      return false;
  if (requested.empty()) {
    selected.resize(std::min(physical, maxDeviceSelectionChannels));
    for (std::uint32_t channel = 0; channel < selected.size(); ++channel)
      selected[channel] = channel;
  } else {
    selected.assign(requested.begin(), requested.end());
  }
  return true;
}

template <typename Read>
void unpackPlanar(std::span<float> planar, std::uint32_t frames, std::uint32_t physical,
                  std::span<const std::uint32_t> selected, Read read) noexcept {
  for (std::size_t channel = 0; channel < selected.size(); ++channel)
    for (std::uint32_t frame = 0; frame < frames; ++frame)
      planar[channel * frames + frame] = read(std::size_t(frame) * physical + selected[channel]);
}

template <typename Write>
void packInterleaved(std::span<const float> planar, std::uint32_t frames, std::uint32_t physical,
                     std::span<const std::uint32_t> selected, Write write) noexcept {
  for (std::size_t channel = 0; channel < selected.size(); ++channel)
    for (std::uint32_t frame = 0; frame < frames; ++frame)
      write(std::size_t(frame) * physical + selected[channel], planar[channel * frames + frame]);
}

} // namespace effetune::audio

#ifndef EFFETUNE_DSP_CHANNEL_LANES_H
#define EFFETUNE_DSP_CHANNEL_LANES_H

#include <cstddef>
#include <cstdint>
#include <type_traits>

namespace effetune::dsp {

template <std::uint32_t Lanes> using ChannelLanes = std::integral_constant<std::uint32_t, Lanes>;

// Calls body(channel, ChannelLanes<2>{}) for each adjacent channel pair and
// body(channel, ChannelLanes<1>{}) for a trailing odd channel. Running two independent
// channels in one frame loop overlaps their recursions without changing either channel's
// arithmetic.
template <typename Body>
inline void forEachChannelPair(std::uint32_t channel_count, Body &&body) noexcept {
  std::uint32_t channel = 0u;
  for (; channel + 1u < channel_count; channel += 2u)
    body(channel, ChannelLanes<2u>{});
  if (channel < channel_count)
    body(channel, ChannelLanes<1u>{});
}

// Runs Lanes planar channels, `stride` samples apart, through one recursive stage in place.
// step(input, state, frame) returns the stage output for one sample of one lane; states holds
// one state per lane and is kept in locals for the duration of the block.
template <std::uint32_t Lanes, typename State, typename Step>
inline void processChannelLanes(float *audio, std::size_t stride, std::uint32_t frame_count,
                                State *states, Step &&step) noexcept {
  State local[Lanes];
  for (std::uint32_t lane = 0u; lane < Lanes; ++lane)
    local[lane] = states[lane];
  for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
    for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
      float &sample = audio[lane * stride + frame];
      sample = static_cast<float>(step(static_cast<double>(sample), local[lane], frame));
    }
  }
  for (std::uint32_t lane = 0u; lane < Lanes; ++lane)
    states[lane] = local[lane];
}

} // namespace effetune::dsp

#endif

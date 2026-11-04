#pragma once
#include "../sfz_note_player/bank.h"
#include <array>
#include <cstdint>
namespace effetune::plugins::others::sfz {
// CONTROL collects authored switch keys once. Telemetry then reads only the
// engine's accepted logical-key serials, never ordinary-note last-key state.
class KeyswitchMap {
public:
  void add(const float *region) noexcept {
    const auto addKey = [&](unsigned channel, int key) {
      if (key >= 0 && key < 128)
        masks_[channel][static_cast<unsigned>(key) / 64u] |= std::uint64_t{1}
                                                             << (static_cast<unsigned>(key) % 64u);
    };
    for (auto channel = static_cast<unsigned>(region[LowChannel]) - 1u;
         channel < static_cast<unsigned>(region[HighChannel]) && channel < 16u; ++channel) {
      if (region[SwitchLow] >= 0 || region[SwitchHigh] >= 0) {
        const auto low = region[SwitchLow] < 0 ? 0 : static_cast<int>(region[SwitchLow]);
        const auto high = region[SwitchHigh] < 0 ? 127 : static_cast<int>(region[SwitchHigh]);
        for (auto key = low; key <= high; ++key)
          addKey(channel, key);
      } else if (region[SwitchLowLast] >= 0 || region[SwitchHighLast] >= 0) {
        const auto low = region[SwitchLowLast] < 0 ? 0 : static_cast<int>(region[SwitchLowLast]);
        const auto high =
            region[SwitchHighLast] < 0 ? 127 : static_cast<int>(region[SwitchHighLast]);
        for (auto key = low; key <= high; ++key)
          addKey(channel, key);
      }
      for (const auto field : {SwitchLast, SwitchDown, SwitchUp, SwitchPrevious, SwitchDefault})
        addKey(channel, static_cast<int>(region[field]));
      if (defaults_[channel] < 0 && region[SwitchDefault] >= 0)
        defaults_[channel] = static_cast<std::int16_t>(region[SwitchDefault]);
    }
  }
  std::int16_t selected(unsigned channel,
                        const std::array<std::uint32_t, 128> &serials) const noexcept {
    std::int16_t selected = defaults_[channel];
    std::uint32_t latest = 0;
    for (unsigned key = 0; key < 128; ++key)
      if ((masks_[channel][key / 64u] & (std::uint64_t{1} << (key % 64u))) &&
          serials[key] > latest) {
        latest = serials[key];
        selected = static_cast<std::int16_t>(key);
      }
    return selected;
  }
  KeyswitchMap() noexcept { defaults_.fill(-1); }

private:
  std::array<std::array<std::uint64_t, 2>, 16> masks_{};
  std::array<std::int16_t, 16> defaults_{};
};
} // namespace effetune::plugins::others::sfz

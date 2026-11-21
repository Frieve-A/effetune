#pragma once

#include "device/device.h"
#include "miniaudio_config.h"

namespace effetune::audio::miniaudio {

enum class Negotiation { Accept, RetryAtInternalRate, Reject };

struct NegotiatedFormat {
  std::uint32_t externalChannels{};
  std::uint32_t internalChannels{};
  std::uint32_t externalRate{};
  std::uint32_t internalRate{};
  bool hasChannelConverter{};
  bool hasResampler{};
  bool hasLatency{};
};

inline Negotiation verifyNegotiatedFormat(std::uint32_t enumeratedChannels,
                                          const NegotiatedFormat &format) noexcept {
  if (format.internalChannels != enumeratedChannels ||
      format.externalChannels != enumeratedChannels || format.hasChannelConverter ||
      format.internalRate == 0 || format.externalRate == 0)
    return Negotiation::Reject;
  if (format.externalRate != format.internalRate)
    return Negotiation::RetryAtInternalRate;
  return format.hasResampler || format.hasLatency ? Negotiation::Reject : Negotiation::Accept;
}

std::uint32_t listChannels(const ma_device_info &info) noexcept;
std::uint32_t selectAlsaRate(const ma_device_info &info, std::uint32_t channels,
                             std::uint32_t targetRate) noexcept;
ma_device_config deviceConfig(ma_device_type type, DeviceLatency latency);

} // namespace effetune::audio::miniaudio

#ifndef EFFETUNE_BLUETOOTH_SBC_SIMULATOR_TEST_ADAPTER_H
#define EFFETUNE_BLUETOOTH_SBC_SIMULATOR_TEST_ADAPTER_H

#include <array>
#include <cstddef>
#include <cstdint>

namespace effetune::plugins::lofi::test {

// Ordered exactly as the cm enum in params.json, which is also the kernel's internal ordering.
enum class BluetoothSbcChannelMode : std::uint8_t {
  kJointStereo = 0u,
  kStereo = 1u,
  kDualChannel = 2u,
};

struct BluetoothSbcFrame {
  std::uint32_t frameBytes = 0u;
  std::uint32_t blocks = 0u;
  std::uint32_t bitpool = 0u;
  BluetoothSbcChannelMode channelMode = BluetoothSbcChannelMode::kJointStereo;
  std::array<bool, 8> join{};
  std::array<std::array<std::uint8_t, 8>, 2> scaleFactors{};
  std::array<std::array<std::uint8_t, 8>, 2> bits{};
  std::array<std::array<std::array<std::uint16_t, 8>, 2>, 16> codewords{};
  std::array<std::array<std::int16_t, 128>, 2> decodedPcm{};
};

struct BluetoothSbcPcm {
  std::uint32_t frames = 0u;
  std::array<std::array<std::int16_t, 128>, 2> samples{};
};

struct BluetoothSbcEncodedFrame {
  std::size_t length = 0u;
  std::array<std::uint8_t, 256> bytes{};
  BluetoothSbcFrame logical{};
};

[[nodiscard]] bool decodeBluetoothSbcTestFrame(const std::uint8_t *bytes, std::size_t length,
                                               BluetoothSbcFrame &output) noexcept;

[[nodiscard]] bool encodeBluetoothSbcTestFrame(const BluetoothSbcPcm &input,
                                               BluetoothSbcChannelMode channel_mode,
                                               std::uint32_t blocks, std::uint32_t bitpool,
                                               BluetoothSbcEncodedFrame &output) noexcept;

} // namespace effetune::plugins::lofi::test

#endif

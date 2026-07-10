#include "test_support.h"

#include "effetune/telemetry.h"

#include <array>
#include <cstdint>

namespace effetune::test {
namespace {

std::uint32_t readU32(const std::uint8_t *input) {
  return static_cast<std::uint32_t>(input[0]) | (static_cast<std::uint32_t>(input[1]) << 8u) |
         (static_cast<std::uint32_t>(input[2]) << 16u) |
         (static_cast<std::uint32_t>(input[3]) << 24u);
}

void testCompleteFramesAndDropOldest() {
  std::array<std::uint8_t, 64> storage{};
  TelemetryRing ring;
  ring.adopt(storage.data(), static_cast<std::uint32_t>(storage.size()));
  const std::uint32_t payload = 0x12345678u;
  for (std::uint32_t sequence = 0; sequence < 4u; ++sequence) {
    ET_CHECK(ring.write(7u, 1u, 55u, sequence, &payload, sizeof(payload)));
  }
  ET_CHECK(ring.size() == 60u);

  std::array<std::uint8_t, 64> output{};
  std::uint32_t dropped = 0;
  const std::uint32_t bytes =
      ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
  ET_CHECK(bytes == 60u);
  ET_CHECK(dropped == 1u);
  ET_CHECK(readU32(output.data() + 8u) == 1u);
  ET_CHECK(readU32(output.data() + 28u) == 2u);
  ET_CHECK(readU32(output.data() + 48u) == 3u);
  ET_CHECK((output[54] & kTelemetryFlagDropped) != 0u);
}

void testReadNeverSplitsFrame() {
  std::array<std::uint8_t, 64> storage{};
  TelemetryRing ring;
  ring.adopt(storage.data(), static_cast<std::uint32_t>(storage.size()));
  const std::uint32_t payload = 9u;
  ET_CHECK(ring.write(1u, 1u, 2u, 3u, &payload, sizeof(payload)));
  std::array<std::uint8_t, 20> output{};
  std::uint32_t dropped = 0;
  ET_CHECK(ring.read(output.data(), 19u, &dropped) == 0u);
  ET_CHECK(ring.size() == 20u);
  ET_CHECK(ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped) == 20u);
  ET_CHECK(ring.size() == 0u);
}

void testOversizedFrameIsReportedAsDropped() {
  std::array<std::uint8_t, 32> storage{};
  TelemetryRing ring;
  ring.adopt(storage.data(), static_cast<std::uint32_t>(storage.size()));
  std::array<std::uint8_t, 32> payload{};
  ET_CHECK(!ring.write(1u, 1u, 1u, 0u, payload.data(), static_cast<std::uint16_t>(payload.size())));
  std::uint32_t dropped = 0;
  std::array<std::uint8_t, 32> output{};
  ET_CHECK(ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped) == 0u);
  ET_CHECK(dropped == 1u);
}

} // namespace

void runTelemetryTests() {
  testCompleteFramesAndDropOldest();
  testReadNeverSplitsFrame();
  testOversizedFrameIsReportedAsDropped();
}

} // namespace effetune::test

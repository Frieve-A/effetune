#include "test_support.h"

#include "binary_io.h"
#include "effetune/telemetry.h"

#include <array>
#include <cstdint>
#include <cstring>

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

void testHeaderByteLayout() {
  std::array<std::uint8_t, 32> storage{};
  TelemetryRing ring;
  ring.adopt(storage.data(), static_cast<std::uint32_t>(storage.size()));
  const std::array<std::uint8_t, 3> payload = {0x80u, 0x01u, 0xffu};
  ET_CHECK(ring.write(0x1234u, 0x5678u, 0x90abcdefu, 0x10203040u, payload.data(),
                      static_cast<std::uint16_t>(payload.size()), 0x55aau));

  std::array<std::uint8_t, 32> output{};
  std::uint32_t dropped = 0u;
  ET_CHECK(ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped) == 20u);
  ET_CHECK(dropped == 0u);
  const std::array<std::uint8_t, 20> expected = {
      0x34u, 0x12u, 0x78u, 0x56u, 0xefu, 0xcdu, 0xabu, 0x90u, 0x40u, 0x30u,
      0x20u, 0x10u, 0x03u, 0x00u, 0xaau, 0x55u, 0x80u, 0x01u, 0xffu, 0x00u,
  };
  ET_CHECK(std::memcmp(output.data(), expected.data(), expected.size()) == 0);
}

void testLittleEndianWriterByteLayout() {
  std::array<std::uint8_t, 10> output{};
  binary_io::writeU16(output.data(), 0xa1b2u);
  binary_io::writeU32(output.data() + 2u, 0xc3d4e5f6u);
  binary_io::writeF32(output.data() + 6u, -2.5F);
  const std::array<std::uint8_t, 10> expected = {
      0xb2u, 0xa1u, 0xf6u, 0xe5u, 0xd4u, 0xc3u, 0x00u, 0x00u, 0x20u, 0xc0u,
  };
  ET_CHECK(std::memcmp(output.data(), expected.data(), expected.size()) == 0);
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
  testHeaderByteLayout();
  testLittleEndianWriterByteLayout();
  testReadNeverSplitsFrame();
  testOversizedFrameIsReportedAsDropped();
}

} // namespace effetune::test

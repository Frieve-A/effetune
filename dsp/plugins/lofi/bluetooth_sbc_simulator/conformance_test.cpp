#include "test_adapter.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

namespace {

using effetune::plugins::lofi::test::BluetoothSbcChannelMode;
using effetune::plugins::lofi::test::BluetoothSbcEncodedFrame;
using effetune::plugins::lofi::test::BluetoothSbcFrame;
using effetune::plugins::lofi::test::BluetoothSbcPcm;
using effetune::plugins::lofi::test::decodeBluetoothSbcTestFrame;
using effetune::plugins::lofi::test::encodeBluetoothSbcTestFrame;

constexpr double kMaximumRmsDifference = 148.0;
constexpr int kMaximumAbsoluteDifference = 1024;

[[nodiscard]] std::uint16_t readLittleEndian16(const std::uint8_t *bytes) noexcept {
  return static_cast<std::uint16_t>(bytes[0]) | static_cast<std::uint16_t>(bytes[1] << 8u);
}

[[nodiscard]] std::uint32_t readLittleEndian32(const std::uint8_t *bytes) noexcept {
  return static_cast<std::uint32_t>(bytes[0]) | (static_cast<std::uint32_t>(bytes[1]) << 8u) |
         (static_cast<std::uint32_t>(bytes[2]) << 16u) |
         (static_cast<std::uint32_t>(bytes[3]) << 24u);
}

[[nodiscard]] std::vector<std::uint8_t> readFile(const char *path) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream) {
    return {};
  }
  return {std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>()};
}

[[nodiscard]] bool writeFile(const char *path, const std::uint8_t *bytes, std::size_t length) {
  std::ofstream stream(path, std::ios::binary | std::ios::trunc);
  if (!stream) {
    return false;
  }
  stream.write(reinterpret_cast<const char *>(bytes), static_cast<std::streamsize>(length));
  return stream.good();
}

[[nodiscard]] std::uint64_t logicalDigest(const BluetoothSbcFrame &frame) noexcept {
  std::uint64_t digest = 1469598103934665603ull;
  const auto append = [&digest](std::uint32_t value) noexcept {
    for (std::uint32_t shift = 0u; shift < 32u; shift += 8u) {
      digest ^= (value >> shift) & 0xffu;
      digest *= 1099511628211ull;
    }
  };
  append(frame.frameBytes);
  append(frame.blocks);
  append(frame.bitpool);
  // Digest continuity with the accepted SIG-fixture evidence: joint stereo keeps appending 1 and
  // stereo keeps appending 0, so digests recorded before Dual Channel existed stay comparable.
  append(frame.channelMode == BluetoothSbcChannelMode::kJointStereo
             ? 1u
             : (frame.channelMode == BluetoothSbcChannelMode::kStereo ? 0u : 2u));
  for (std::uint32_t subband = 0u; subband < 8u; ++subband) {
    append(frame.join[subband] ? 1u : 0u);
  }
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::uint32_t subband = 0u; subband < 8u; ++subband) {
      append(frame.scaleFactors[channel][subband]);
      append(frame.bits[channel][subband]);
    }
  }
  for (std::uint32_t block = 0u; block < frame.blocks; ++block) {
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t subband = 0u; subband < 8u; ++subband) {
        append(frame.codewords[block][channel][subband]);
      }
    }
  }
  return digest;
}

[[nodiscard]] const char *modeName(BluetoothSbcChannelMode mode) noexcept {
  switch (mode) {
  case BluetoothSbcChannelMode::kStereo:
    return "stereo";
  case BluetoothSbcChannelMode::kDualChannel:
    return "dual";
  case BluetoothSbcChannelMode::kJointStereo:
    break;
  }
  return "joint";
}

[[nodiscard]] bool validateLogicalFrame(const BluetoothSbcFrame &frame,
                                        BluetoothSbcChannelMode expected_mode) noexcept {
  if (frame.channelMode != expected_mode || frame.blocks != 16u || frame.bitpool < 2u ||
      frame.bitpool > 53u || frame.join[7]) {
    return false;
  }
  // Joint Stereo and Stereo share one bitpool across the pair; Dual Channel spends it per channel.
  const std::uint32_t expected_allocation =
      frame.channelMode == BluetoothSbcChannelMode::kDualChannel ? frame.bitpool * 2u
                                                                 : frame.bitpool;
  std::uint32_t allocated = 0u;
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::uint32_t subband = 0u; subband < 8u; ++subband) {
      allocated += frame.bits[channel][subband];
      if (frame.scaleFactors[channel][subband] > 15u ||
          frame.codewords[0][channel][subband] >=
              (frame.bits[channel][subband] == 0u ? 1u : 1u << frame.bits[channel][subband])) {
        return false;
      }
    }
  }
  return allocated == expected_allocation;
}

[[nodiscard]] std::uint32_t packedFrameBytes(const std::uint8_t *bytes,
                                             std::size_t available) noexcept {
  if (bytes == nullptr || available < 4u || bytes[0] != 0x9cu) {
    return 0u;
  }
  const std::uint32_t blocks = (((bytes[1] >> 4u) & 3u) + 1u) * 4u;
  const std::uint32_t mode = (bytes[1] >> 2u) & 3u;
  const std::uint32_t channels = mode == 0u ? 1u : 2u;
  const std::uint32_t joint_bits = mode == 3u ? 8u : 0u;
  const std::uint32_t scale_bits = 4u * 8u * channels;
  const std::uint32_t audio_bits =
      mode == 0u || mode == 1u ? blocks * channels * bytes[2] : blocks * bytes[2];
  return 4u + (joint_bits + scale_bits + audio_bits + 7u) / 8u;
}

[[nodiscard]] bool hasNonzeroLogicalData(const BluetoothSbcFrame &frame) noexcept {
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::uint32_t subband = 0u; subband < 8u; ++subband) {
      if (frame.scaleFactors[channel][subband] != 0u) {
        return true;
      }
    }
  }
  return false;
}

[[nodiscard]] bool readWavePcm(const std::vector<std::uint8_t> &wave, std::uint32_t frames,
                               BluetoothSbcPcm &pcm) noexcept {
  if (wave.size() < 44u || std::memcmp(wave.data(), "RIFF", 4u) != 0 ||
      std::memcmp(wave.data() + 8u, "WAVE", 4u) != 0) {
    return false;
  }
  std::size_t position = 12u;
  std::size_t data_offset = 0u;
  std::size_t data_bytes = 0u;
  bool format_valid = false;
  while (position + 8u <= wave.size()) {
    const std::uint32_t chunk_bytes = readLittleEndian32(wave.data() + position + 4u);
    const std::size_t payload = position + 8u;
    if (payload + chunk_bytes > wave.size()) {
      return false;
    }
    if (std::memcmp(wave.data() + position, "fmt ", 4u) == 0 && chunk_bytes >= 16u) {
      format_valid = readLittleEndian16(wave.data() + payload) == 1u &&
                     readLittleEndian16(wave.data() + payload + 2u) == 2u &&
                     readLittleEndian32(wave.data() + payload + 4u) == 48000u &&
                     readLittleEndian16(wave.data() + payload + 14u) == 16u;
    } else if (std::memcmp(wave.data() + position, "data", 4u) == 0) {
      data_offset = payload;
      data_bytes = chunk_bytes;
    }
    position = payload + chunk_bytes + (chunk_bytes & 1u);
  }
  if (!format_valid || frames > pcm.samples[0].size() || data_offset == 0u ||
      data_bytes < frames * 2u * 2u) {
    return false;
  }

  pcm = {};
  pcm.frames = frames;
  for (std::uint32_t sample = 0u; sample < frames; ++sample) {
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      const std::size_t offset = data_offset + (sample * 2u + channel) * 2u;
      pcm.samples[channel][sample] =
          static_cast<std::int16_t>(readLittleEndian16(wave.data() + offset));
    }
  }
  return true;
}

[[nodiscard]] bool compareIndependentDecode(const BluetoothSbcFrame &frame,
                                            const std::vector<std::uint8_t> &wave) noexcept {
  BluetoothSbcPcm reference{};
  const std::uint32_t samples = frame.blocks * 8u;
  if (!readWavePcm(wave, samples, reference)) {
    return false;
  }

  std::array<double, 2> squared{};
  std::array<int, 2> maximum{};
  for (std::uint32_t sample = 0u; sample < samples; ++sample) {
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      const int difference =
          static_cast<int>(frame.decodedPcm[channel][sample]) - reference.samples[channel][sample];
      const int magnitude = difference < 0 ? -difference : difference;
      squared[channel] += static_cast<double>(difference) * difference;
      if (magnitude > maximum[channel]) {
        maximum[channel] = magnitude;
      }
    }
  }
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    const double rms = std::sqrt(squared[channel] / samples);
    if (rms > kMaximumRmsDifference || maximum[channel] > kMaximumAbsoluteDifference) {
      std::fprintf(stderr, "independent decode mismatch: channel %u rms %.3f max %d\n", channel,
                   rms, maximum[channel]);
      return false;
    }
  }
  return true;
}

[[nodiscard]] bool runEncodeFixture(const char *wave_path, const char *frame_path,
                                    BluetoothSbcChannelMode expected_mode) {
  const std::vector<std::uint8_t> wave = readFile(wave_path);
  BluetoothSbcPcm input{};
  BluetoothSbcEncodedFrame encoded{};
  BluetoothSbcFrame reparsed{};
  const std::uint32_t bitpool = expected_mode == BluetoothSbcChannelMode::kJointStereo ? 33u : 35u;
  if (!readWavePcm(wave, 128u, input) ||
      !encodeBluetoothSbcTestFrame(input, expected_mode, 16u, bitpool, encoded) ||
      !validateLogicalFrame(encoded.logical, expected_mode) ||
      !decodeBluetoothSbcTestFrame(encoded.bytes.data(), encoded.length, reparsed) ||
      logicalDigest(encoded.logical) != logicalDigest(reparsed) ||
      !writeFile(frame_path, encoded.bytes.data(), encoded.length)) {
    std::fprintf(stderr, "SBC encoder conformance fixture failed: %s\n", wave_path);
    return false;
  }
  std::printf("SBC encoder fixture written: %s, frame=%zu, logical-fnv64=%016llx\n",
              modeName(expected_mode), encoded.length,
              static_cast<unsigned long long>(logicalDigest(encoded.logical)));
  return true;
}

[[nodiscard]] bool runFixture(const char *frame_path, const char *decode_path,
                              BluetoothSbcChannelMode expected_mode) {
  const std::vector<std::uint8_t> bytes = readFile(frame_path);
  const std::vector<std::uint8_t> decoded = readFile(decode_path);
  BluetoothSbcFrame frame{};
  if (bytes.size() < 4u || decoded.empty()) {
    std::fprintf(stderr, "SBC conformance fixture failed: %s\n", frame_path);
    return false;
  }
  const std::uint32_t frame_bytes = packedFrameBytes(bytes.data(), bytes.size());
  if (bytes.size() < frame_bytes ||
      !decodeBluetoothSbcTestFrame(bytes.data(), frame_bytes, frame) ||
      !validateLogicalFrame(frame, expected_mode) || !compareIndependentDecode(frame, decoded)) {
    std::fprintf(stderr, "SBC conformance fixture failed: %s\n", frame_path);
    return false;
  }
  std::printf("SBC conformance fixture passed: %s, frame=%u, logical-fnv64=%016llx\n",
              modeName(expected_mode), frame.frameBytes,
              static_cast<unsigned long long>(logicalDigest(frame)));
  return true;
}

[[nodiscard]] bool inspectStream(const char *frame_path) {
  const std::vector<std::uint8_t> bytes = readFile(frame_path);
  std::size_t offset = 0u;
  std::uint32_t frame_index = 0u;
  bool found_nonzero = false;
  while (offset < bytes.size()) {
    const std::uint32_t frame_bytes =
        packedFrameBytes(bytes.data() + offset, bytes.size() - offset);
    BluetoothSbcFrame frame{};
    if (frame_bytes == 0u || offset + frame_bytes > bytes.size() ||
        !decodeBluetoothSbcTestFrame(bytes.data() + offset, frame_bytes, frame)) {
      std::fprintf(stderr, "invalid SBC frame at offset %zu\n", offset);
      return false;
    }
    const bool nonzero = hasNonzeroLogicalData(frame);
    std::printf("frame=%u offset=%zu bytes=%u mode=%s nonzero=%s logical-fnv64=%016llx\n",
                frame_index, offset, frame_bytes, modeName(frame.channelMode),
                nonzero ? "yes" : "no", static_cast<unsigned long long>(logicalDigest(frame)));
    found_nonzero = found_nonzero || nonzero;
    offset += frame_bytes;
    ++frame_index;
  }
  return frame_index != 0u && found_nonzero;
}

struct SelfTestMode {
  BluetoothSbcChannelMode mode;
  std::uint32_t bitpool;
  std::size_t frameBytes;
};

// Sixteen blocks, eight subbands, both channels present. Joint Stereo adds eight join bits, and
// Dual Channel carries a full bitpool per channel, which is what puts the SBC XQ configurations
// (bitpool 38 and 47 at 44.1 kHz) at 452 and 551 kbit/s.
constexpr std::array<SelfTestMode, 4> kSelfTestModes = {{
    {BluetoothSbcChannelMode::kStereo, 35u, 82u},
    {BluetoothSbcChannelMode::kJointStereo, 33u, 79u},
    {BluetoothSbcChannelMode::kDualChannel, 38u, 164u},
    {BluetoothSbcChannelMode::kDualChannel, 47u, 200u},
}};

[[nodiscard]] bool selfTest() noexcept {
  std::array<std::uint8_t, 16> stereo{};
  stereo[0] = 0x9cu;
  stereo[1] = 0xf9u;
  stereo[2] = 2u;
  BluetoothSbcFrame decoded{};
  if (!decodeBluetoothSbcTestFrame(stereo.data(), stereo.size(), decoded) ||
      !validateLogicalFrame(decoded, BluetoothSbcChannelMode::kStereo)) {
    return false;
  }
  // Header mode field 1 is Dual Channel, so the same bitpool doubles the audio payload.
  std::array<std::uint8_t, 20> dual{};
  dual[0] = 0x9cu;
  dual[1] = 0xf5u;
  dual[2] = 2u;
  if (!decodeBluetoothSbcTestFrame(dual.data(), dual.size(), decoded) ||
      !validateLogicalFrame(decoded, BluetoothSbcChannelMode::kDualChannel) ||
      decodeBluetoothSbcTestFrame(dual.data(), stereo.size(), decoded)) {
    return false;
  }
  // Header mode field 0 is mono, which this stereo-pair adapter does not accept.
  dual[1] = 0xf1u;
  if (decodeBluetoothSbcTestFrame(dual.data(), dual.size(), decoded)) {
    return false;
  }
  BluetoothSbcPcm input{};
  input.frames = 128u;
  for (std::uint32_t sample = 0u; sample < input.frames; ++sample) {
    input.samples[0][sample] = static_cast<std::int16_t>(sample * 127u - 8000u);
    input.samples[1][sample] = static_cast<std::int16_t>(6000 - sample * 91u);
  }
  for (const SelfTestMode &configuration : kSelfTestModes) {
    BluetoothSbcEncodedFrame encoded{};
    BluetoothSbcFrame reparsed{};
    if (!encodeBluetoothSbcTestFrame(input, configuration.mode, 16u, configuration.bitpool,
                                     encoded) ||
        encoded.length != configuration.frameBytes ||
        !decodeBluetoothSbcTestFrame(encoded.bytes.data(), encoded.length, reparsed) ||
        !validateLogicalFrame(reparsed, configuration.mode) ||
        logicalDigest(encoded.logical) != logicalDigest(reparsed)) {
      return false;
    }
  }
  stereo[0] = 0u;
  return !decodeBluetoothSbcTestFrame(stereo.data(), stereo.size(), decoded);
}

} // namespace

int main(int argc, char **argv) {
  if (argc == 2 && std::strcmp(argv[1], "--self-test") == 0) {
    return selfTest() ? 0 : 1;
  }
  if (argc == 3 && std::strcmp(argv[1], "--inspect") == 0) {
    return inspectStream(argv[2]) ? 0 : 1;
  }
  if (argc == 7 && std::strcmp(argv[1], "--encode-stereo") == 0 &&
      std::strcmp(argv[4], "--encode-joint") == 0) {
    return runEncodeFixture(argv[2], argv[3], BluetoothSbcChannelMode::kStereo) &&
                   runEncodeFixture(argv[5], argv[6], BluetoothSbcChannelMode::kJointStereo)
               ? 0
               : 1;
  }
  if (argc != 7 || std::strcmp(argv[1], "--stereo") != 0 || std::strcmp(argv[4], "--joint") != 0) {
    std::fprintf(stderr,
                 "usage: sbc-conformance --stereo frame.sbc decoded.wav --joint frame.sbc "
                 "decoded.wav\n"
                 "   or: sbc-conformance --encode-stereo input.wav frame.sbc --encode-joint "
                 "input.wav frame.sbc\n");
    return 2;
  }
  return runFixture(argv[2], argv[3], BluetoothSbcChannelMode::kStereo) &&
                 runFixture(argv[5], argv[6], BluetoothSbcChannelMode::kJointStereo)
             ? 0
             : 1;
}

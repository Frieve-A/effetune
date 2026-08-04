#include "G726ADPCMSimulatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/dsp/rational_resampler.h"
#include "effetune/kernel.h"
#include "kernel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <map>
#include <string>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_G726ADPCMSimulatorPlugin() noexcept;

namespace {

using effetune::plugins::lofi::g726::Codec;
using Params = effetune::generated::G726ADPCMSimulatorPluginParams;

constexpr std::uint32_t kMaximumFrames = 257u;
constexpr std::size_t kKernelStorageBytes = 32768u;
constexpr double kBridgeCutoffHz = 3800.0;

bool expect(bool condition, const char *message) {
  if (!condition) {
    std::cerr << "FAIL: " << message << '\n';
    return false;
  }
  return true;
}

std::int16_t expandALaw(std::uint8_t input) noexcept {
  std::uint32_t value = static_cast<std::uint32_t>(input) ^ 0x55u ^ 0x80u;
  const std::uint32_t sign = value >= 128u ? 1u : 0u;
  if (sign != 0u) {
    value -= 128u;
  }
  const std::uint32_t exponent = value >> 4u;
  const std::uint32_t mantissa = value & 15u;
  const std::uint32_t signed_magnitude =
      exponent == 0u ? (mantissa << 1u) + 1u + (sign << 12u)
                     : (1u << (exponent - 1u)) * ((mantissa << 1u) + 33u) + (sign << 12u);
  const std::uint32_t magnitude = (signed_magnitude & 4095u) << 1u;
  const std::uint32_t word = sign == 0u ? magnitude : (16384u - magnitude) & 16383u;
  return static_cast<std::int16_t>((word & 8192u) == 0u ? static_cast<std::int32_t>(word)
                                                        : static_cast<std::int32_t>(word) - 16384);
}

std::int16_t expandMuLaw(std::uint8_t input) noexcept {
  std::uint32_t value = static_cast<std::uint32_t>(input) ^ 0x80u;
  std::uint32_t sign = 0u;
  if (value >= 128u) {
    value = (value - 128u) ^ 127u;
    sign = 1u;
  } else {
    value ^= 127u;
  }
  const std::uint32_t exponent = value >> 4u;
  const std::uint32_t mantissa = value & 15u;
  const std::uint32_t signed_magnitude =
      exponent == 0u ? (mantissa << 1u) + (sign << 13u)
                     : (1u << exponent) * ((mantissa << 1u) + 33u) - 33u + (sign << 13u);
  const std::uint32_t magnitude = signed_magnitude & 8191u;
  const std::uint32_t word = sign == 0u ? magnitude : (16384u - magnitude) & 16383u;
  return static_cast<std::int16_t>((word & 8192u) == 0u ? static_cast<std::int32_t>(word)
                                                        : static_cast<std::int32_t>(word) - 16384);
}

enum class CompandingLaw { Mu, A };

std::vector<std::uint8_t> readOfficialSamples(const std::filesystem::path &path) {
  std::ifstream stream(path);
  std::string hexadecimal;
  char character = '\0';
  while (stream.get(character)) {
    const bool digit = character >= '0' && character <= '9';
    const bool lower = character >= 'a' && character <= 'f';
    const bool upper = character >= 'A' && character <= 'F';
    if (digit || lower || upper) {
      hexadecimal.push_back(character);
    }
  }
  if (hexadecimal.size() < 4u || (hexadecimal.size() & 1u) != 0u) {
    return {};
  }
  auto nibble = [](char value) noexcept -> std::uint8_t {
    if (value >= '0' && value <= '9') {
      return static_cast<std::uint8_t>(value - '0');
    }
    if (value >= 'a' && value <= 'f') {
      return static_cast<std::uint8_t>(value - 'a' + 10);
    }
    return static_cast<std::uint8_t>(value - 'A' + 10);
  };
  std::vector<std::uint8_t> result;
  result.reserve(hexadecimal.size() / 2u);
  for (std::size_t index = 0u; index < hexadecimal.size(); index += 2u) {
    result.push_back(static_cast<std::uint8_t>((nibble(hexadecimal[index]) << 4u) |
                                               nibble(hexadecimal[index + 1u])));
  }
  const std::uint8_t expected_checksum = result.back();
  result.pop_back();
  std::uint32_t sum = 0u;
  for (const std::uint8_t sample : result) {
    sum += sample;
  }
  if (sum % 255u != expected_checksum) {
    return {};
  }
  return result;
}

std::vector<std::uint8_t> readOfficialBinarySamples(const std::filesystem::path &path) {
  std::ifstream stream(path, std::ios::binary);
  std::vector<std::uint8_t> result;
  char bytes[2] = {};
  while (stream.read(bytes, sizeof(bytes))) {
    const std::uint16_t word =
        static_cast<std::uint8_t>(bytes[0]) |
        (static_cast<std::uint16_t>(static_cast<std::uint8_t>(bytes[1])) << 8u);
    if (word > 255u) {
      return {};
    }
    result.push_back(static_cast<std::uint8_t>(word));
  }
  if (!stream.eof() || stream.gcount() != 0) {
    return {};
  }
  return result;
}

std::int16_t expand(CompandingLaw law, std::uint8_t code) noexcept {
  return law == CompandingLaw::A ? expandALaw(code) : expandMuLaw(code);
}

std::uint8_t compress(CompandingLaw law, std::int16_t linear) noexcept {
  static constexpr std::array<std::int32_t, 8u> kSegmentEnds = {0xff,  0x1ff,  0x3ff,  0x7ff,
                                                                0xfff, 0x1fff, 0x3fff, 0x7fff};
  std::int32_t sample = static_cast<std::int32_t>(linear) * 4;
  if (law == CompandingLaw::Mu) {
    const std::uint8_t mask = sample < 0 ? 0x7fu : 0xffu;
    sample = sample < 0 ? 132 - sample : sample + 132;
    sample = sample > 32635 ? 32635 : sample;
    std::size_t segment = 0u;
    while (segment < kSegmentEnds.size() && sample > kSegmentEnds[segment]) {
      ++segment;
    }
    const std::uint8_t value = static_cast<std::uint8_t>(
        (segment << 4u) | ((static_cast<std::uint32_t>(sample) >> (segment + 3u)) & 0x0fu));
    return static_cast<std::uint8_t>(value ^ mask);
  }

  const std::uint8_t mask = sample < 0 ? 0x55u : 0xd5u;
  sample = sample < 0 ? -sample - 1 : sample;
  std::size_t segment = 0u;
  while (segment < kSegmentEnds.size() && sample > kSegmentEnds[segment]) {
    ++segment;
  }
  if (segment >= kSegmentEnds.size()) {
    return static_cast<std::uint8_t>(0x7fu ^ mask);
  }
  const std::uint32_t shift = segment < 2u ? 4u : static_cast<std::uint32_t>(segment + 3u);
  const std::uint8_t value = static_cast<std::uint8_t>(
      (segment << 4u) | ((static_cast<std::uint32_t>(sample) >> shift) & 0x0fu));
  return static_cast<std::uint8_t>(value ^ mask);
}

std::uint8_t decodeWithTestOnlySynchronousAdjustment(Codec &decoder, std::uint8_t code,
                                                     CompandingLaw law) noexcept {
  const Codec pre_decode = decoder;
  const std::int16_t linear = decoder.decode(code);
  const std::uint8_t nominal = compress(law, linear);
  const std::uint8_t requantized = pre_decode.analyze(expand(law, nominal)).code;
  if (requantized == code) {
    return nominal;
  }

  const std::uint8_t sign = static_cast<std::uint8_t>(1u << (decoder.bitsPerSample() - 1u));
  const bool adjust_lower = (requantized ^ sign) > (code ^ sign);
  if (law == CompandingLaw::Mu) {
    if (adjust_lower) {
      return (nominal & 0x80u) != 0u
                 ? (nominal == 0xffu ? 0x7eu : static_cast<std::uint8_t>(nominal + 1u))
                 : (nominal == 0x00u ? 0x00u : static_cast<std::uint8_t>(nominal - 1u));
    }
    return (nominal & 0x80u) != 0u
               ? (nominal == 0x80u ? 0x80u : static_cast<std::uint8_t>(nominal - 1u))
               : (nominal == 0x7fu ? 0xfeu : static_cast<std::uint8_t>(nominal + 1u));
  }

  const std::uint8_t toggled = static_cast<std::uint8_t>(nominal ^ 0x55u);
  if (adjust_lower) {
    return (nominal & 0x80u) != 0u
               ? (nominal == 0xd5u ? 0x55u : static_cast<std::uint8_t>((toggled - 1u) ^ 0x55u))
               : (nominal == 0x2au ? 0x2au : static_cast<std::uint8_t>((toggled + 1u) ^ 0x55u));
  }
  return (nominal & 0x80u) != 0u
             ? (nominal == 0xaau ? 0xaau : static_cast<std::uint8_t>((toggled + 1u) ^ 0x55u))
             : (nominal == 0x55u ? 0xd5u : static_cast<std::uint8_t>((toggled - 1u) ^ 0x55u));
}

bool snapshotsEqual(const Codec::StateSnapshot &left, const Codec::StateSnapshot &right) noexcept {
  return left.yl == right.yl && left.yu == right.yu && left.dms == right.dms &&
         left.dml == right.dml && left.ap == right.ap && left.a == right.a && left.b == right.b &&
         left.pk == right.pk && left.dq == right.dq && left.sr == right.sr && left.td == right.td;
}

bool snapshotWithinSpecification(const Codec::StateSnapshot &state) noexcept {
  if (state.yl >= (1u << 19u) || state.yu >= (1u << 13u) || state.dms >= (1u << 12u) ||
      state.dml >= (1u << 14u) || state.ap >= (1u << 10u) || state.td > 1u) {
    return false;
  }
  for (const std::uint16_t value : state.pk) {
    if (value > 1u) {
      return false;
    }
  }
  for (const std::uint16_t value : state.dq) {
    if (value >= (1u << 11u)) {
      return false;
    }
  }
  for (const std::uint16_t value : state.sr) {
    if (value >= (1u << 11u)) {
      return false;
    }
  }
  return true;
}

std::uint64_t stateDigest(const Codec::StateSnapshot &state) noexcept {
  std::uint64_t hash = 14695981039346656037ull;
  const auto add_byte = [&hash](std::uint8_t value) noexcept {
    hash ^= value;
    hash *= 1099511628211ull;
  };
  const auto add_u16 = [&add_byte](std::uint16_t value) noexcept {
    add_byte(static_cast<std::uint8_t>(value));
    add_byte(static_cast<std::uint8_t>(value >> 8u));
  };
  const auto add_u32 = [&add_byte](std::uint32_t value) noexcept {
    for (std::uint32_t shift = 0u; shift < 32u; shift += 8u) {
      add_byte(static_cast<std::uint8_t>(value >> shift));
    }
  };

  add_u32(state.yl);
  add_u16(static_cast<std::uint16_t>(state.yu));
  add_u16(static_cast<std::uint16_t>(state.dms));
  add_u16(static_cast<std::uint16_t>(state.dml));
  add_u16(static_cast<std::uint16_t>(state.ap));
  for (const std::uint16_t value : state.a) {
    add_u16(value);
  }
  for (const std::uint16_t value : state.b) {
    add_u16(value);
  }
  for (const std::uint16_t value : state.pk) {
    add_u16(value);
  }
  for (const std::uint16_t value : state.dq) {
    add_u16(value);
  }
  for (const std::uint16_t value : state.sr) {
    add_u16(value);
  }
  add_u16(state.td);
  return hash;
}

struct StateDigestOracle final {
  bool configured = false;
  bool valid = true;
  std::map<std::string, std::uint64_t> values;
};

std::string environmentValue(const char *name) {
#ifdef _WIN32
  char *value = nullptr;
  std::size_t length = 0u;
  std::string result;
  if (_dupenv_s(&value, &length, name) == 0 && value != nullptr) {
    result.assign(value);
  }
  std::free(value);
  return result;
#else
  const char *value = std::getenv(name);
  return value == nullptr ? std::string{} : std::string(value);
#endif
}

std::string stateDigestKey(std::uint32_t bitrate, CompandingLaw law, bool overload,
                           const char *role, std::size_t sample_count) {
  return std::to_string(bitrate) + " " + (law == CompandingLaw::A ? "a" : "mu") + " " +
         (overload ? "overload" : "normal") + " " + role + " " + std::to_string(sample_count);
}

StateDigestOracle readStateDigestOracle() {
  StateDigestOracle oracle;
  const std::string path = environmentValue("EFFETUNE_G726_STATE_DIGEST_FILE");
  if (path.empty()) {
    oracle.valid = environmentValue("EFFETUNE_G726_REQUIRE_STATE_EXACT") != "1";
    if (!oracle.valid) {
      std::cerr << "FAIL: G.726 promotion requires an external STL state digest file\n";
    }
    return oracle;
  }
  oracle.configured = true;
  std::ifstream stream(path);
  std::string header;
  std::getline(stream, header);
  if (header != "g726-state-digest-v1") {
    std::cerr << "FAIL: invalid G.726 external state digest header\n";
    oracle.valid = false;
    return oracle;
  }

  std::uint32_t bitrate = 0u;
  std::string law;
  std::string workload;
  std::string role;
  std::size_t sample_count = 0u;
  std::string digest;
  while (stream >> bitrate >> law >> workload >> role >> sample_count >> digest) {
    if ((law != "a" && law != "mu") || (workload != "normal" && workload != "overload") ||
        (role != "encoder" && role != "decoder") || digest.size() != 16u) {
      oracle.valid = false;
      break;
    }
    try {
      const std::string key = std::to_string(bitrate) + " " + law + " " + workload + " " + role +
                              " " + std::to_string(sample_count);
      const auto [_, inserted] = oracle.values.emplace(key, std::stoull(digest, nullptr, 16));
      if (!inserted) {
        oracle.valid = false;
        break;
      }
    } catch (...) {
      oracle.valid = false;
      break;
    }
  }
  if (!stream.eof() || oracle.values.size() != 64u) {
    oracle.valid = false;
  }
  if (!oracle.valid) {
    std::cerr << "FAIL: malformed or incomplete G.726 external state digest file\n";
  }
  return oracle;
}

bool checkStateDigest(const StateDigestOracle &oracle, std::uint32_t bitrate, CompandingLaw law,
                      bool overload, const char *role, std::size_t sample_count,
                      const Codec::StateSnapshot &state) {
  if (!oracle.configured) {
    return true;
  }
  const std::string key = stateDigestKey(bitrate, law, overload, role, sample_count);
  const auto expected = oracle.values.find(key);
  if (expected == oracle.values.end() || expected->second != stateDigest(state)) {
    std::cerr << "FAIL: official G.726 " << key << " state digest mismatch\n";
    return false;
  }
  return true;
}

bool checkOfficialRoundTripVector(const std::filesystem::path &fixture_root, bool stl_binary,
                                  std::uint32_t bitrate, CompandingLaw law, bool overload,
                                  const StateDigestOracle &state_oracle) {
  const std::string rate = std::to_string(bitrate);
  const std::string law_name = law == CompandingLaw::A ? "A" : "mu";
  const std::string law_suffix = law == CompandingLaw::A ? "A" : "M";
  const std::string prefix = overload ? "RV" : "RN";
  const std::string stl_law = law == CompandingLaw::A ? "a" : "m";
  const std::string stl_prefix = overload ? "rv" : "rn";
  const std::filesystem::path input_path =
      stl_binary ? fixture_root / ((overload ? "ovr." : "nrm.") + stl_law)
                 : fixture_root / "INPUT" / ((overload ? "OVR." : "NRM.") + law_suffix);
  const std::filesystem::path rate_root = stl_binary ? fixture_root : fixture_root / "RESET" / rate;
  const std::filesystem::path code_path =
      stl_binary ? rate_root / (stl_prefix + rate + "f" + stl_law + ".i")
                 : rate_root / (prefix + rate + "F" + law_suffix + ".I");
  const std::filesystem::path output_path =
      stl_binary ? rate_root / (stl_prefix + rate + "f" + stl_law + ".o")
                 : rate_root / (prefix + rate + "F" + law_suffix + ".O");
  const auto read_samples = stl_binary ? readOfficialBinarySamples : readOfficialSamples;
  const std::vector<std::uint8_t> input = read_samples(input_path);
  const std::vector<std::uint8_t> expected_codes = read_samples(code_path);
  const std::vector<std::uint8_t> expected_output = read_samples(output_path);
  if (input.empty() || input.size() != expected_codes.size() ||
      input.size() != expected_output.size()) {
    std::cerr << "FAIL: invalid official fixture set " << input_path << " / " << code_path << " / "
              << output_path << '\n';
    return false;
  }

  Codec encoder(bitrate / 8u);
  Codec decoder(bitrate / 8u);
  for (std::size_t index = 0u; index < input.size(); ++index) {
    const std::int16_t linear = expand(law, input[index]);
    const std::uint8_t actual = encoder.encode(linear);
    if (actual != expected_codes[index]) {
      std::cerr << "FAIL: official " << bitrate << " kbit/s " << law_name << "-law "
                << (overload ? "overload" : "normal") << " encoder at sample " << index
                << ": expected " << static_cast<unsigned>(expected_codes[index]) << ", got "
                << static_cast<unsigned>(actual) << '\n';
      return false;
    }
    const std::uint8_t decoded =
        decodeWithTestOnlySynchronousAdjustment(decoder, expected_codes[index], law);
    if (decoded != expected_output[index]) {
      Codec diagnostic = encoder;
      diagnostic.reset(bitrate / 8u);
      for (std::size_t replay = 0u; replay < index; ++replay) {
        static_cast<void>(diagnostic.decode(expected_codes[replay]));
      }
      const Codec::Analysis nominal_analysis = diagnostic.analyze(expand(law, decoded));
      const std::int16_t linear_output = diagnostic.decode(expected_codes[index]);
      std::cerr << "FAIL: official " << bitrate << " kbit/s " << law_name << "-law "
                << (overload ? "overload" : "normal") << " decoder/SCA at sample " << index
                << ": expected " << static_cast<unsigned>(expected_output[index]) << ", got "
                << static_cast<unsigned>(decoded) << ", code "
                << static_cast<unsigned>(expected_codes[index]) << ", linear " << linear_output
                << ", dln " << nominal_analysis.normalizedLog << ", sign " << nominal_analysis.sign
                << '\n';
      return false;
    }
    if (!snapshotWithinSpecification(encoder.stateSnapshot()) ||
        !snapshotWithinSpecification(decoder.stateSnapshot())) {
      std::cerr << "FAIL: official " << bitrate << " kbit/s " << law_name
                << "-law state width at sample " << index << '\n';
      return false;
    }
    if (!snapshotsEqual(encoder.stateSnapshot(), decoder.stateSnapshot())) {
      std::cerr << "FAIL: official " << bitrate << " kbit/s " << law_name
                << "-law encoder/decoder state divergence at sample " << index << '\n';
      return false;
    }
    const std::size_t sample_count = index + 1u;
    if ((sample_count == 256u || sample_count == input.size()) &&
        (!checkStateDigest(state_oracle, bitrate, law, overload, "encoder", sample_count,
                           encoder.stateSnapshot()) ||
         !checkStateDigest(state_oracle, bitrate, law, overload, "decoder", sample_count,
                           decoder.stateSnapshot()))) {
      return false;
    }
  }
  return true;
}

struct OfficialFixtureRoot final {
  std::filesystem::path path;
  bool stl_binary = false;
};

OfficialFixtureRoot findOfficialFixtureRoot(const std::filesystem::path &configured) {
  if (std::filesystem::is_directory(configured / "DISK1") &&
      std::filesystem::is_directory(configured / "DISK2")) {
    return {configured, false};
  }
  if (std::filesystem::is_regular_file(configured / "nrm.a") &&
      std::filesystem::is_regular_file(configured / "rn16fa.i")) {
    return {configured, true};
  }
  std::error_code error;
  for (std::filesystem::recursive_directory_iterator
           iterator(configured, std::filesystem::directory_options::skip_permission_denied, error),
       end;
       iterator != end && !error; iterator.increment(error)) {
    if (!iterator->is_directory() || iterator->path().filename() != "DISK1") {
      continue;
    }
    const std::filesystem::path parent = iterator->path().parent_path();
    if (std::filesystem::is_directory(parent / "DISK2")) {
      return {parent, false};
    }
  }
  error.clear();
  for (std::filesystem::recursive_directory_iterator
           iterator(configured, std::filesystem::directory_options::skip_permission_denied, error),
       end;
       iterator != end && !error; iterator.increment(error)) {
    if (!iterator->is_regular_file() || iterator->path().filename() != "rn16fa.i") {
      continue;
    }
    const std::filesystem::path parent = iterator->path().parent_path();
    if (std::filesystem::is_regular_file(parent / "nrm.a")) {
      return {parent, true};
    }
  }
  return {};
}

bool checkOfficialVectorsIfAvailable() {
  const StateDigestOracle state_oracle = readStateDigestOracle();
  if (!state_oracle.valid) {
    return false;
  }
  const std::string configured_path = environmentValue("EFFETUNE_G726_VECTOR_DIR");
  if (configured_path.empty()) {
    std::cout << "SKIP: set EFFETUNE_G726_VECTOR_DIR to the official ITU-T G.726 Appendix II "
                 "extraction root to run the primary conformance gate\n";
    return true;
  }
  const OfficialFixtureRoot root = findOfficialFixtureRoot(configured_path);
  if (root.path.empty()) {
    std::cerr << "FAIL: EFFETUNE_G726_VECTOR_DIR contains neither Appendix II DISK1/DISK2 nor "
                 "STL G.726 binary vectors\n";
    return false;
  }
  for (const std::uint32_t bitrate : {16u, 24u, 32u, 40u}) {
    for (const CompandingLaw law : {CompandingLaw::Mu, CompandingLaw::A}) {
      for (const bool overload : {false, true}) {
        const std::filesystem::path fixtures =
            root.stl_binary ? root.path : root.path / (law == CompandingLaw::A ? "DISK2" : "DISK1");
        if (!checkOfficialRoundTripVector(fixtures, root.stl_binary, bitrate, law, overload,
                                          state_oracle)) {
          return false;
        }
      }
    }
  }
  return true;
}

bool checkCoreInvariants() {
  bool ok = true;
  ok &= expect(Codec::annexALimit(57344u) == -8192,
               "Corrigendum 1 Annex A LIMO boundary is incorrect");
  ok &= expect(Codec::annexALimit(32768u) == -8192,
               "Annex A negative full-scale boundary is incorrect");
  ok &= expect(Codec::annexALimit(8191u) == 8191,
               "Annex A positive full-scale boundary is incorrect");
  for (const std::uint32_t bits : {2u, 3u, 4u, 5u}) {
    Codec encoder(bits);
    Codec decoder(bits);
    const std::uint32_t maximum_code = (1u << bits) - 1u;
    for (std::uint32_t index = 0u; index < 32768u; ++index) {
      const std::int32_t saw = static_cast<std::int32_t>((index * 7919u) & 16383u) - 8192;
      const std::uint8_t code = encoder.encode(static_cast<std::int16_t>(saw));
      const std::int16_t output = decoder.decode(code);
      ok &= expect(static_cast<std::uint32_t>(code) <= maximum_code,
                   "encoder codeword exceeds selected width");
      ok &= expect(output >= -8192 && output <= 8191, "Annex A output is not 14-bit");
    }
  }
  return ok;
}

bool checkIndependentStates() {
  Codec encoder(4u);
  Codec decoder(4u);
  Codec second_decoder(4u);
  std::array<std::uint8_t, 512u> codes{};
  for (std::size_t index = 0u; index < codes.size(); ++index) {
    const std::int32_t value = static_cast<std::int32_t>((index * 1049u) & 16383u) - 8192;
    codes[index] = encoder.encode(static_cast<std::int16_t>(value));
  }
  for (std::size_t index = 0u; index < codes.size(); ++index) {
    if (!expect(decoder.decode(codes[index]) == second_decoder.decode(codes[index]),
                "decoder result depends on encoder or shared state")) {
      return false;
    }
  }
  return true;
}

// The radio bit-error exponent defaults to its minimum, which means "Off".
Params defaultParams() noexcept { return {2.0F, 0.0F, 100.0F, -6.0F}; }

class KernelHarness final {
public:
  KernelHarness(float sample_rate, std::uint32_t max_channels) {
    descriptor_ = et_kernel_descriptor_G726ADPCMSimulatorPlugin();
    if (descriptor_ == nullptr || descriptor_->objectSize > storage_.size()) {
      return;
    }
    kernel_ = descriptor_->construct(storage_.data());
    if (kernel_ != nullptr) {
      kernel_->prepare({sample_rate, max_channels, kMaximumFrames});
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  [[nodiscard]] bool ready() const noexcept {
    return kernel_ != nullptr && kernel_->preparedSuccessfully();
  }

  [[nodiscard]] std::uint32_t latency() const noexcept { return kernel_->latencySamples(); }

  void stage(const Params &params) noexcept {
    kernel_->stageParameters(&params.bitrate, Params::kFloatCount, Params::kHash);
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    kernel_->applyPendingParameters();
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->process(audio, channels, frames, {0.0});
  }

  void reset() noexcept { kernel_->reset(); }

  void seed(std::uint32_t low, std::uint32_t high) noexcept {
    kernel_->setRandomSeed(low, high);
    kernel_->reset();
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

bool checkKernelRatesAndDryLatency() {
  bool ok = true;
  for (const float sample_rate :
       {44100.0F, 48000.0F, 88200.0F, 96000.0F, 176400.0F, 192000.0F, 352800.0F, 384000.0F}) {
    KernelHarness harness(sample_rate, 2u);
    ok &= expect(harness.ready(), "kernel rejects a supported host rate");
    if (!harness.ready()) {
      continue;
    }
    const std::uint32_t latency = harness.latency();
    ok &= expect(latency > 0u, "kernel reports zero latency");
    Params params = defaultParams();
    params.mix = 0.0F;
    harness.stage(params);
    bool impulse_found = false;
    std::uint32_t absolute = 0u;
    while (absolute <= latency + kMaximumFrames) {
      std::array<float, 2u * kMaximumFrames> audio{};
      if (absolute == 0u) {
        audio[0u] = 1.0F;
        audio[kMaximumFrames] = -1.0F;
      }
      harness.process(audio.data(), 2u, kMaximumFrames);
      for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
        const std::uint32_t index = absolute + frame;
        if (index < latency) {
          ok &= expect(audio[frame] == 0.0F && audio[kMaximumFrames + frame] == 0.0F,
                       "dry output precedes reported latency");
        } else if (index == latency) {
          impulse_found = audio[frame] == 1.0F && audio[kMaximumFrames + frame] == -1.0F;
        }
      }
      absolute += kMaximumFrames;
    }
    ok &= expect(impulse_found, "dry impulse is not aligned to reported latency");
  }

  KernelHarness unsupported(32000.0F, 2u);
  ok &= expect(!unsupported.ready(), "kernel accepts an unsupported host rate");
  return ok;
}

std::vector<float> renderLinearBridge(std::uint32_t sample_rate, double frequency,
                                      std::uint32_t frames, bool impulse) {
  effetune::dsp::RationalResampler downsampler;
  effetune::dsp::RationalResampler upsampler;
  downsampler.prepare(sample_rate, 8000u, kBridgeCutoffHz);
  upsampler.prepare(8000u, sample_rate, kBridgeCutoffHz);
  std::vector<float> output;
  output.reserve(frames + 8u);
  constexpr double kPi = 3.14159265358979323846;
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const float input =
        impulse && frame == 0u
            ? 1.0F
            : (impulse ? 0.0F
                       : static_cast<float>(
                             0.5 * std::sin(2.0 * kPi * frequency * frame / sample_rate + 0.37)));
    std::array<float, effetune::dsp::RationalResampler::kMaximumOutputs> codec_samples{};
    const std::size_t codec_count = downsampler.push(input, codec_samples);
    for (std::size_t codec_index = 0u; codec_index < codec_count; ++codec_index) {
      std::array<float, effetune::dsp::RationalResampler::kMaximumOutputs> host_samples{};
      const std::size_t host_count = upsampler.push(codec_samples[codec_index], host_samples);
      output.insert(output.end(), host_samples.begin(), host_samples.begin() + host_count);
    }
  }
  return output;
}

double steadyRms(const std::vector<float> &samples, std::size_t skip) {
  double sum = 0.0;
  std::size_t count = 0u;
  for (std::size_t index = skip; index < samples.size(); ++index) {
    const double value = samples[index];
    sum += value * value;
    ++count;
  }
  return count == 0u ? 0.0 : std::sqrt(sum / static_cast<double>(count));
}

bool checkBridgeResponseAliasAndGroupDelay() {
  bool ok = true;
  for (const std::uint32_t sample_rate : {44100u, 48000u}) {
    const std::uint32_t frames = sample_rate * 2u;
    const std::vector<float> reference = renderLinearBridge(sample_rate, 1000.0, frames, false);
    const std::vector<float> passband = renderLinearBridge(sample_rate, 3600.0, frames, false);
    const std::vector<float> stopband = renderLinearBridge(sample_rate, 4000.0, frames, false);
    const std::vector<float> alias = renderLinearBridge(sample_rate, 7600.0, frames, false);
    const std::size_t skip = sample_rate / 2u;
    const double reference_rms = steadyRms(reference, skip);
    const double passband_db = 20.0 * std::log10(steadyRms(passband, skip) / reference_rms);
    const double stopband_db = 20.0 * std::log10(steadyRms(stopband, skip) / reference_rms);
    const double alias_db = 20.0 * std::log10(steadyRms(alias, skip) / reference_rms);
    ok &= expect(passband_db > -0.5 && passband_db < 0.5,
                 "3.6 kHz bridge passband exceeds +/-0.5 dB");
    ok &= expect(stopband_db < -50.0, "4.0 kHz bridge stopband rejection is below 50 dB");
    ok &= expect(alias_db < -60.0, "out-of-band bridge alias rejection is below 60 dB");

    const std::vector<float> impulse = renderLinearBridge(sample_rate, 0.0, sample_rate, true);
    std::size_t peak_index = 0u;
    float peak = 0.0F;
    for (std::size_t index = 0u; index < impulse.size(); ++index) {
      const float magnitude = impulse[index] < 0.0F ? -impulse[index] : impulse[index];
      if (magnitude > peak) {
        peak = magnitude;
        peak_index = index;
      }
    }
    const std::size_t expected_latency = sample_rate == 44100u ? 1244u : 1337u;
    std::cout << "linear bridge latency " << sample_rate << ": " << peak_index << " samples\n";
    ok &=
        expect(peak_index == expected_latency, "bridge group delay changed without latency update");
  }
  return ok;
}

bool checkDryPreservesFiniteOverRangePcm() {
  KernelHarness harness(48000.0F, 2u);
  if (!expect(harness.ready(), "dry-contract kernel does not prepare")) {
    return false;
  }
  Params params = defaultParams();
  params.mix = 0.0F;
  harness.stage(params);
  const std::uint32_t total = harness.latency() + 2u;
  std::uint32_t absolute = 0u;
  bool ok = true;
  while (absolute < total) {
    const std::uint32_t frames =
        total - absolute < kMaximumFrames ? total - absolute : kMaximumFrames;
    std::array<float, 2u * kMaximumFrames> audio{};
    if (absolute == 0u) {
      audio[0u] = 1.75F;
      audio[kMaximumFrames] = -2.25F;
      audio[1u] = std::numeric_limits<float>::quiet_NaN();
      audio[kMaximumFrames + 1u] = std::numeric_limits<float>::infinity();
    }
    harness.process(audio.data(), 2u, frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const std::uint32_t index = absolute + frame;
      if (index == harness.latency()) {
        ok &= expect(audio[frame] == 1.75F && audio[frames + frame] == -2.25F,
                     "Mix=0 changed finite over-range PCM");
      } else if (index == harness.latency() + 1u) {
        ok &= expect(audio[frame] == 0.0F && audio[frames + frame] == 0.0F,
                     "Mix=0 did not sanitize non-finite PCM");
      }
    }
    absolute += frames;
  }
  return ok;
}

bool measureWetLatency() {
  bool ok = true;
  for (const float sample_rate :
       {44100.0F, 48000.0F, 88200.0F, 96000.0F, 176400.0F, 192000.0F, 352800.0F, 384000.0F}) {
    KernelHarness harness(sample_rate, 1u);
    if (!expect(harness.ready(), "wet-latency kernel does not prepare")) {
      return false;
    }
    harness.stage(defaultParams());
    const std::uint32_t total = harness.latency() + 4096u;
    std::uint32_t absolute = 0u;
    std::uint32_t peak_index = 0u;
    float peak = 0.0F;
    while (absolute < total) {
      const std::uint32_t remaining = total - absolute;
      const std::uint32_t frames = remaining < kMaximumFrames ? remaining : kMaximumFrames;
      std::array<float, kMaximumFrames> audio{};
      if (absolute == 0u) {
        audio[0u] = 1.0F;
      }
      harness.process(audio.data(), 1u, frames);
      for (std::uint32_t frame = 0u; frame < frames; ++frame) {
        const float magnitude = audio[frame] < 0.0F ? -audio[frame] : audio[frame];
        if (magnitude > peak) {
          peak = magnitude;
          peak_index = absolute + frame;
        }
      }
      absolute += frames;
    }
    std::cout << "wet latency " << static_cast<std::uint32_t>(sample_rate) << ": " << peak_index
              << " samples (reported " << harness.latency() << ", peak " << peak << ")\n";
    ok &= expect(peak > 0.0001F, "wet impulse does not produce a measurable output");
    ok &= expect(peak_index == harness.latency(),
                 "reported latency does not match the measured wet impulse peak");
  }
  return ok;
}

bool checkChannelContractAndFiniteOutput() {
  KernelHarness harness(96000.0F, 4u);
  if (!expect(harness.ready(), "four-channel kernel does not prepare")) {
    return false;
  }
  harness.stage(defaultParams());
  bool ok = true;
  bool dual_mono = true;
  for (std::uint32_t block = 0u; block < 80u; ++block) {
    std::array<float, 4u * kMaximumFrames> audio{};
    std::array<float, 2u * kMaximumFrames> extra{};
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      audio[frame] = static_cast<float>(0.7 * std::sin((block * kMaximumFrames + frame) * 0.031));
      audio[kMaximumFrames + frame] =
          static_cast<float>(0.4 * std::cos((block * kMaximumFrames + frame) * 0.047));
      audio[2u * kMaximumFrames + frame] = static_cast<float>(frame) * 0.001F;
      audio[3u * kMaximumFrames + frame] = -static_cast<float>(frame) * 0.002F;
      extra[frame] = audio[2u * kMaximumFrames + frame];
      extra[kMaximumFrames + frame] = audio[3u * kMaximumFrames + frame];
    }
    harness.process(audio.data(), 4u, kMaximumFrames);
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      ok &= expect(std::isfinite(audio[frame]) && std::isfinite(audio[kMaximumFrames + frame]),
                   "processed pair contains a non-finite sample");
      if (audio[frame] != audio[kMaximumFrames + frame]) {
        dual_mono = false;
      }
      ok &= expect(audio[2u * kMaximumFrames + frame] == extra[frame] &&
                       audio[3u * kMaximumFrames + frame] == extra[kMaximumFrames + frame],
                   "channels above the first pair were modified");
    }
  }
  ok &= expect(dual_mono, "stereo wet output is not dual mono");
  return ok;
}

bool checkResetReproducibilityAndBitrateChanges() {
  KernelHarness harness(48000.0F, 1u);
  if (!expect(harness.ready(), "mono kernel does not prepare")) {
    return false;
  }
  std::vector<float> input(12000u);
  for (std::size_t index = 0u; index < input.size(); ++index) {
    input[index] = static_cast<float>(0.63 * std::sin(static_cast<double>(index) * 0.083));
  }
  auto render = [&harness, &input](bool change_bitrate) {
    std::vector<float> result(input.size());
    std::size_t offset = 0u;
    std::size_t block_number = 0u;
    constexpr std::array<std::uint32_t, 4u> sizes = {31u, 257u, 64u, 127u};
    while (offset < input.size()) {
      const std::size_t remaining = input.size() - offset;
      std::uint32_t frames = sizes[block_number % sizes.size()];
      if (frames > remaining) {
        frames = static_cast<std::uint32_t>(remaining);
      }
      std::array<float, kMaximumFrames> block{};
      for (std::uint32_t frame = 0u; frame < frames; ++frame) {
        block[frame] = input[offset + frame];
      }
      Params params = defaultParams();
      if (change_bitrate && offset >= 4000u) {
        params.bitrate = offset < 8000u ? 0.0F : 3.0F;
      }
      harness.stage(params);
      harness.process(block.data(), 1u, frames);
      for (std::uint32_t frame = 0u; frame < frames; ++frame) {
        result[offset + frame] = block[frame];
      }
      offset += frames;
      ++block_number;
    }
    return result;
  };

  const std::vector<float> first = render(true);
  harness.reset();
  const std::vector<float> replay = render(true);
  bool ok = expect(first == replay, "reset does not restore complete bridge and codec state");
  for (float sample : first) {
    ok &= expect(std::isfinite(sample), "bitrate-change render contains a non-finite sample");
  }
  return ok;
}

std::vector<float> renderRadioLink(KernelHarness &harness, float exponent, std::uint32_t frames,
                                   bool hostile_input, float bitrate = 2.0F) {
  Params params = defaultParams();
  params.bitrate = bitrate;
  params.radioBitErrorExponent = exponent;
  std::vector<float> result(frames);
  std::uint32_t offset = 0u;
  while (offset < frames) {
    const std::uint32_t block = frames - offset < kMaximumFrames ? frames - offset : kMaximumFrames;
    std::array<float, kMaximumFrames> audio{};
    for (std::uint32_t frame = 0u; frame < block; ++frame) {
      const double phase = static_cast<double>(offset + frame);
      audio[frame] =
          static_cast<float>(0.55 * std::sin(phase * 0.071) + 0.2 * std::sin(phase * 0.0113));
    }
    if (hostile_input && offset == 0u) {
      audio[3u] = std::numeric_limits<float>::quiet_NaN();
      audio[4u] = std::numeric_limits<float>::infinity();
      audio[5u] = -std::numeric_limits<float>::infinity();
      audio[6u] = 9.0F;
    }
    harness.stage(params);
    harness.process(audio.data(), 1u, block);
    for (std::uint32_t frame = 0u; frame < block; ++frame) {
      result[offset + frame] = audio[frame];
    }
    offset += block;
  }
  return result;
}

// A single harness must be able to switch the transmission model on and back off at block
// boundaries. The exponent is held at its minimum outside [onset, release), and both edges
// land on a block boundary so the schedule is expressible through staged parameters alone.
struct RadioSchedule final {
  std::uint32_t onset;
  std::uint32_t release;
};

std::vector<float> renderScheduledRadioLink(KernelHarness &harness, const RadioSchedule &schedule,
                                            std::uint32_t frames, float bitrate) {
  Params params = defaultParams();
  params.bitrate = bitrate;
  std::vector<float> result(frames);
  std::uint32_t offset = 0u;
  while (offset < frames) {
    const std::uint32_t block = frames - offset < kMaximumFrames ? frames - offset : kMaximumFrames;
    std::array<float, kMaximumFrames> audio{};
    for (std::uint32_t frame = 0u; frame < block; ++frame) {
      const double phase = static_cast<double>(offset + frame);
      audio[frame] =
          static_cast<float>(0.55 * std::sin(phase * 0.071) + 0.2 * std::sin(phase * 0.0113));
    }
    const bool enabled = offset >= schedule.onset && offset < schedule.release;
    params.radioBitErrorExponent = enabled ? -2.0F : -6.0F;
    harness.stage(params);
    harness.process(audio.data(), 1u, block);
    for (std::uint32_t frame = 0u; frame < block; ++frame) {
      result[offset + frame] = audio[frame];
    }
    offset += block;
  }
  return result;
}

std::size_t firstDifference(const std::vector<float> &left, const std::vector<float> &right) {
  const std::size_t common = left.size() < right.size() ? left.size() : right.size();
  for (std::size_t index = 0u; index < common; ++index) {
    if (left[index] != right[index]) {
      return index;
    }
  }
  return common;
}

// The transmission model draws one random number per codeword bit, and the codeword
// width is the bitrate index plus two. A 1e-3 error rate is sparse enough that the
// first corrupted codeword sits deep in the seeded random stream, so the sample at
// which the errored render leaves the clean one is roughly the fixed index of the
// first drawn value below the rate, divided by the codeword width. Pinning it at every
// selectable rate makes the width mapping observable: drawing two bits where five are
// coded (or five where two are) moves these indices apart.
constexpr float kProbeExponent = -3.0F;

struct RadioBitrateProbe final {
  float bitrate;
  std::uint32_t kilobits;
  std::uint32_t codeword_bits;
  std::size_t first_difference;
};

constexpr std::array<RadioBitrateProbe, 4u> kRadioBitrateProbes = {
    RadioBitrateProbe{0.0F, 16u, 2u, 3012u}, RadioBitrateProbe{1.0F, 24u, 3u, 2010u},
    RadioBitrateProbe{2.0F, 32u, 4u, 1506u}, RadioBitrateProbe{3.0F, 40u, 5u, 1206u}};

bool checkRadioBitErrorContract() {
  KernelHarness harness(48000.0F, 1u);
  if (!expect(harness.ready(), "radio-link kernel does not prepare")) {
    return false;
  }
  constexpr std::uint32_t kFrames = 9000u;
  const std::uint32_t clean_latency = harness.latency();
  bool ok = true;

  // The default exponent must short-circuit the transmission model completely,
  // so a different instance seed cannot change a single output sample.
  harness.seed(0x11111111u, 0u);
  const std::vector<float> clean_first = renderRadioLink(harness, -6.0F, kFrames, false);
  harness.seed(0xa5a5a5a5u, 0x00001234u);
  const std::vector<float> clean_second = renderRadioLink(harness, -6.0F, kFrames, false);
  ok &= expect(clean_first == clean_second,
               "the default exponent consumes random numbers or injects errors");

  harness.seed(0x11111111u, 0u);
  const std::vector<float> errored = renderRadioLink(harness, -2.0F, kFrames, false);
  harness.seed(0x11111111u, 0u);
  const std::vector<float> replay = renderRadioLink(harness, -2.0F, kFrames, false);
  ok &= expect(errored == replay, "the radio link is not reproducible from its seed");
  harness.seed(0xa5a5a5a5u, 0x00001234u);
  const std::vector<float> other_seed = renderRadioLink(harness, -2.0F, kFrames, false);
  ok &= expect(errored != other_seed, "the radio link ignores the instance seed");
  ok &= expect(errored != clean_first, "the radio link leaves the decoded signal untouched");
  for (const float sample : errored) {
    ok &= expect(std::isfinite(sample), "radio-link render contains a non-finite sample");
  }
  ok &= expect(harness.latency() == clean_latency, "the radio link changed the reported latency");

  harness.seed(0x11111111u, 0u);
  const std::vector<float> hostile = renderRadioLink(harness, -2.0F, kFrames, true);
  for (const float sample : hostile) {
    ok &= expect(std::isfinite(sample), "radio link propagates non-finite or over-range input");
  }

  // Every selectable bitrate must run the transmission model, and it must draw exactly
  // one random number per codeword bit at that rate.
  for (const RadioBitrateProbe &probe : kRadioBitrateProbes) {
    harness.seed(0x11111111u, 0u);
    const std::vector<float> clean = renderRadioLink(harness, -6.0F, kFrames, false, probe.bitrate);
    harness.seed(0x11111111u, 0u);
    const std::vector<float> noisy =
        renderRadioLink(harness, kProbeExponent, kFrames, false, probe.bitrate);
    harness.seed(0x11111111u, 0u);
    const std::vector<float> noisy_replay =
        renderRadioLink(harness, kProbeExponent, kFrames, false, probe.bitrate);
    harness.seed(0xa5a5a5a5u, 0x00001234u);
    const std::vector<float> other_seed_render =
        renderRadioLink(harness, kProbeExponent, kFrames, false, probe.bitrate);
    const std::size_t divergence = firstDifference(clean, noisy);
    std::cout << "radio divergence " << probe.kilobits << " kbit/s (" << probe.codeword_bits
              << " bits): sample " << divergence << '\n';
    ok &= expect(noisy == noisy_replay, "the radio link is not reproducible at this bitrate");
    ok &= expect(noisy != other_seed_render, "the radio link ignores the seed at this bitrate");
    ok &= expect(divergence == probe.first_difference,
                 "the radio link draws the wrong number of codeword bits for this bitrate");
    for (const float sample : noisy) {
      ok &= expect(std::isfinite(sample), "bitrate-specific radio render is not finite");
    }

    // The worst selectable error rate must stay bounded and reproducible at every rate.
    harness.seed(0x11111111u, 0u);
    const std::vector<float> worst = renderRadioLink(harness, -2.0F, kFrames, false, probe.bitrate);
    harness.seed(0x11111111u, 0u);
    const std::vector<float> worst_replay =
        renderRadioLink(harness, -2.0F, kFrames, false, probe.bitrate);
    ok &= expect(worst == worst_replay,
                 "the worst-case radio link is not reproducible at this bitrate");
    ok &= expect(worst != clean, "the worst-case radio link leaves this bitrate untouched");
    ok &= expect(worst != noisy, "the radio link ignores the selected error rate");
    for (const float sample : worst) {
      ok &= expect(std::isfinite(sample), "worst-case radio render is not finite");
    }
  }

  // Toggling the transmission model on and back off inside one continuous render must not
  // disturb the samples produced while it was off: the prefix before the onset has to stay
  // bit-identical to the fully clean render, which is only possible if the disabled model
  // draws no random numbers at all.
  constexpr RadioSchedule kSchedule{4u * kMaximumFrames, 20u * kMaximumFrames};
  harness.seed(0x11111111u, 0u);
  const std::vector<float> toggled = renderScheduledRadioLink(harness, kSchedule, kFrames, 2.0F);
  harness.seed(0x11111111u, 0u);
  const std::vector<float> toggled_replay =
      renderScheduledRadioLink(harness, kSchedule, kFrames, 2.0F);
  harness.seed(0xa5a5a5a5u, 0x00001234u);
  const std::vector<float> toggled_other_seed =
      renderScheduledRadioLink(harness, kSchedule, kFrames, 2.0F);
  const std::size_t toggled_divergence = firstDifference(clean_first, toggled);
  std::cout << "radio toggle divergence: sample " << toggled_divergence << " (onset "
            << kSchedule.onset << ", release " << kSchedule.release << ")\n";
  ok &=
      expect(toggled == toggled_replay, "the toggled radio link is not reproducible from its seed");
  ok &= expect(toggled != toggled_other_seed, "the toggled radio link ignores the instance seed");
  ok &= expect(toggled_divergence >= kSchedule.onset,
               "the disabled radio link disturbed samples before it was switched on");
  ok &= expect(toggled_divergence < static_cast<std::size_t>(kFrames),
               "switching the radio link on left the render untouched");
  for (const float sample : toggled) {
    ok &= expect(std::isfinite(sample), "the toggled radio render contains a non-finite sample");
  }
  return ok;
}

} // namespace

int main() {
  bool ok = true;
  ok &= checkCoreInvariants();
  ok &= checkIndependentStates();
  ok &= checkOfficialVectorsIfAvailable();
  ok &= checkBridgeResponseAliasAndGroupDelay();
  ok &= measureWetLatency();
  ok &= checkKernelRatesAndDryLatency();
  ok &= checkDryPreservesFiniteOverRangePcm();
  ok &= checkChannelContractAndFiniteOutput();
  ok &= checkResetReproducibilityAndBitrateChanges();
  ok &= checkRadioBitErrorContract();
  if (!ok) {
    return 1;
  }
  std::cout << "G.726 fixed-point core tests passed\n";
  return 0;
}

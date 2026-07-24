#include "effetune/abi.h"
#include "effetune/dsp/halfband.h"
#include "engine.h"
#include "registry.h"

#include <algorithm>
#include <bit>
#include <charconv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <string>
#include <vector>

namespace {

constexpr std::uint32_t kControlHeaderBytes = 36;
constexpr std::uint32_t kControlVersion = 1;
constexpr std::uint32_t kStructuredControlHeaderBytes = 40;
constexpr std::uint32_t kStructuredControlVersion = 2;
constexpr std::uint32_t kAssetControlHeaderBytes = 84;
constexpr std::uint32_t kAssetControlVersion = 3;
constexpr std::uint32_t kTelemetryBytes = 64u * 1024u;

struct Options {
  std::string type;
  std::string control;
  std::string input;
  std::string output;
  std::uint32_t seedLow = 0xeffe7a5eU;
  std::uint32_t seedHigh = 0U;
  bool allocations = false;
  bool referenceDirect = false;
};

struct Event {
  std::uint32_t frame = 0;
  std::vector<float> params;
  std::vector<std::uint8_t> paramBytes;
};

struct Asset {
  std::uint32_t slot = 0u;
  std::uint32_t format = 0u;
  effetune::AssetBeginInfo begin{};
  std::vector<std::uint8_t> bytes;
};

struct Control {
  float sampleRate = 0.0F;
  std::uint32_t frames = 0;
  std::uint32_t channels = 0;
  std::uint32_t blockSize = 0;
  std::uint32_t paramsHash = 0;
  std::vector<float> initialParams;
  std::vector<std::uint8_t> initialParamBytes;
  std::vector<Event> events;
  Asset asset;
  bool hasAsset = false;
};

class EngineOwner {
public:
  EngineOwner() : handle_(et_engine_create()) {}
  ~EngineOwner() { et_engine_destroy(handle_); }
  EngineOwner(const EngineOwner &) = delete;
  EngineOwner &operator=(const EngineOwner &) = delete;
  [[nodiscard]] et_engine get() const noexcept { return handle_; }

private:
  et_engine handle_ = 0;
};

class InstanceOwner {
public:
  InstanceOwner(et_engine engine, et_instance instance) : engine_(engine), instance_(instance) {}
  ~InstanceOwner() { et_instance_destroy(engine_, instance_); }
  InstanceOwner(const InstanceOwner &) = delete;
  InstanceOwner &operator=(const InstanceOwner &) = delete;
  [[nodiscard]] et_instance get() const noexcept { return instance_; }

private:
  et_engine engine_;
  et_instance instance_;
};

bool parseOptions(int argc, char **argv, Options &options) {
  for (int index = 1; index < argc; ++index) {
    const std::string argument = argv[index];
    if (argument == "--help") {
      std::puts("Usage: effetune-dsp-parity-runner --type TYPE --control FILE "
                "--input FILE --output FILE [--seed-low U32] [--seed-high U32] "
                "[--allocations] [--reference-direct]");
      return false;
    }
    if (argument == "--allocations") {
      options.allocations = true;
      continue;
    }
    if (argument == "--reference-direct") {
      options.referenceDirect = true;
      continue;
    }
    if (argument == "--seed-low" || argument == "--seed-high") {
      if (index + 1 >= argc) {
        std::fprintf(stderr, "Missing value for %s\n", argument.c_str());
        return false;
      }
      const char *first = argv[++index];
      const char *last = first + std::strlen(first);
      std::uint32_t value = 0U;
      const auto parsed = std::from_chars(first, last, value, 10);
      if (parsed.ec != std::errc{} || parsed.ptr != last) {
        std::fprintf(stderr, "Invalid value for %s\n", argument.c_str());
        return false;
      }
      if (argument == "--seed-low") {
        options.seedLow = value;
      } else {
        options.seedHigh = value;
      }
      continue;
    }
    if (index + 1 >= argc) {
      std::fprintf(stderr, "Missing value for %s\n", argument.c_str());
      return false;
    }
    std::string *target = nullptr;
    if (argument == "--type") {
      target = &options.type;
    } else if (argument == "--control") {
      target = &options.control;
    } else if (argument == "--input") {
      target = &options.input;
    } else if (argument == "--output") {
      target = &options.output;
    } else {
      std::fprintf(stderr, "Unknown argument: %s\n", argument.c_str());
      return false;
    }
    if (!target->empty()) {
      std::fprintf(stderr, "Duplicate argument: %s\n", argument.c_str());
      return false;
    }
    *target = argv[++index];
  }
  if (options.type.empty() || options.control.empty() || options.input.empty() ||
      options.output.empty()) {
    std::fputs("--type, --control, --input, and --output are required\n", stderr);
    return false;
  }
  return true;
}

bool readBytes(const std::string &file_path, std::vector<std::uint8_t> &output) {
  std::ifstream input(file_path, std::ios::binary | std::ios::ate);
  if (!input) {
    std::fprintf(stderr, "Unable to open %s\n", file_path.c_str());
    return false;
  }
  const std::streamoff size = input.tellg();
  if (size < 0 || static_cast<std::uint64_t>(size) > std::numeric_limits<std::size_t>::max()) {
    std::fprintf(stderr, "Invalid file size: %s\n", file_path.c_str());
    return false;
  }
  output.resize(static_cast<std::size_t>(size));
  input.seekg(0, std::ios::beg);
  if (!output.empty() && !input.read(reinterpret_cast<char *>(output.data()),
                                     static_cast<std::streamsize>(output.size()))) {
    std::fprintf(stderr, "Unable to read %s\n", file_path.c_str());
    return false;
  }
  return true;
}

std::uint32_t readU32(const std::uint8_t *input) noexcept {
  return static_cast<std::uint32_t>(input[0]) | (static_cast<std::uint32_t>(input[1]) << 8u) |
         (static_cast<std::uint32_t>(input[2]) << 16u) |
         (static_cast<std::uint32_t>(input[3]) << 24u);
}

float readF32(const std::uint8_t *input) noexcept { return std::bit_cast<float>(readU32(input)); }

bool parseControl(const std::vector<std::uint8_t> &bytes, Control &control) {
  if (bytes.size() < kControlHeaderBytes || std::memcmp(bytes.data(), "ETPC", 4u) != 0) {
    std::fputs("Invalid ETPC header or version\n", stderr);
    return false;
  }
  const std::uint32_t version = readU32(bytes.data() + 4u);
  const bool asset_control = version == kAssetControlVersion;
  const bool structured = version == kStructuredControlVersion || asset_control;
  const std::uint32_t header_bytes = asset_control ? kAssetControlHeaderBytes
                                     : structured  ? kStructuredControlHeaderBytes
                                                   : kControlHeaderBytes;
  if ((version != kControlVersion && !structured) || bytes.size() < header_bytes) {
    std::fputs("Invalid ETPC header or version\n", stderr);
    return false;
  }
  control.sampleRate = readF32(bytes.data() + 8u);
  control.frames = readU32(bytes.data() + 12u);
  control.channels = readU32(bytes.data() + 16u);
  control.blockSize = readU32(bytes.data() + 20u);
  control.paramsHash = readU32(bytes.data() + 24u);
  const std::uint32_t param_count = readU32(bytes.data() + 28u);
  const std::uint32_t initial_byte_count = structured ? readU32(bytes.data() + 32u) : 0u;
  const std::uint32_t event_count = readU32(bytes.data() + (structured ? 36u : 32u));
  const std::uint32_t asset_byte_count = asset_control ? readU32(bytes.data() + 76u) : 0u;
  if (!std::isfinite(control.sampleRate) || control.sampleRate <= 0.0F || control.frames == 0u ||
      control.channels == 0u || control.channels > 8u || control.blockSize == 0u ||
      param_count > 65536u || initial_byte_count > 4096u || event_count > control.frames ||
      (asset_control && (asset_byte_count == 0u || readU32(bytes.data() + 80u) != 0u))) {
    std::fputs("Invalid ETPC dimensions or length\n", stderr);
    return false;
  }

  std::size_t offset = header_bytes;
  const auto available = [&bytes, &offset](std::size_t count) noexcept {
    return offset <= bytes.size() && count <= bytes.size() - offset;
  };
  if (!available(static_cast<std::size_t>(param_count) * sizeof(float))) {
    std::fputs("Invalid ETPC parameter length\n", stderr);
    return false;
  }
  control.initialParams.resize(param_count);
  for (float &value : control.initialParams) {
    value = readF32(bytes.data() + offset);
    if (!std::isfinite(value)) {
      std::fputs("ETPC contains a non-finite parameter\n", stderr);
      return false;
    }
    offset += 4u;
  }
  if (!available(initial_byte_count)) {
    std::fputs("Invalid ETPC structured parameter length\n", stderr);
    return false;
  }
  control.initialParamBytes.assign(bytes.begin() + static_cast<std::ptrdiff_t>(offset),
                                   bytes.begin() +
                                       static_cast<std::ptrdiff_t>(offset + initial_byte_count));
  offset += initial_byte_count;
  if (asset_control) {
    if (!available(asset_byte_count)) {
      std::fputs("Invalid ETPC asset length\n", stderr);
      return false;
    }
    control.asset.slot = readU32(bytes.data() + 40u);
    control.asset.format = readU32(bytes.data() + 44u);
    control.asset.begin = {readU32(bytes.data() + 48u), readU32(bytes.data() + 52u),
                           readU32(bytes.data() + 56u), readU32(bytes.data() + 60u),
                           readU32(bytes.data() + 64u), readU32(bytes.data() + 68u),
                           readU32(bytes.data() + 72u), control.channels,
                           32u * 1024u * 1024u,         asset_byte_count};
    control.asset.bytes.assign(bytes.begin() + static_cast<std::ptrdiff_t>(offset),
                               bytes.begin() +
                                   static_cast<std::ptrdiff_t>(offset + asset_byte_count));
    control.hasAsset = true;
    offset += asset_byte_count;
  }
  control.events.reserve(event_count);
  std::uint32_t previous_frame = 0u;
  for (std::uint32_t event_index = 0; event_index < event_count; ++event_index) {
    if (!available(4u + static_cast<std::size_t>(param_count) * sizeof(float))) {
      std::fputs("Invalid ETPC event length\n", stderr);
      return false;
    }
    Event event;
    event.frame = readU32(bytes.data() + offset);
    offset += 4u;
    if (event.frame >= control.frames || (event_index != 0u && event.frame < previous_frame)) {
      std::fputs("ETPC parameter events must be sorted and in range\n", stderr);
      return false;
    }
    previous_frame = event.frame;
    event.params.resize(param_count);
    for (float &value : event.params) {
      value = readF32(bytes.data() + offset);
      if (!std::isfinite(value)) {
        std::fputs("ETPC event contains a non-finite parameter\n", stderr);
        return false;
      }
      offset += 4u;
    }
    if (structured) {
      if (!available(4u)) {
        std::fputs("Invalid ETPC structured event length\n", stderr);
        return false;
      }
      const std::uint32_t byte_count = readU32(bytes.data() + offset);
      offset += 4u;
      if (byte_count > 4096u || !available(byte_count)) {
        std::fputs("Invalid ETPC structured event length\n", stderr);
        return false;
      }
      event.paramBytes.assign(bytes.begin() + static_cast<std::ptrdiff_t>(offset),
                              bytes.begin() + static_cast<std::ptrdiff_t>(offset + byte_count));
      offset += byte_count;
    }
    control.events.push_back(std::move(event));
  }
  if (offset != bytes.size()) {
    std::fputs("ETPC packet has trailing bytes\n", stderr);
    return false;
  }
  return true;
}

bool readAudio(const std::string &file_path, std::uint32_t frames, std::uint32_t channels,
               std::vector<float> &output) {
  std::vector<std::uint8_t> bytes;
  if (!readBytes(file_path, bytes)) {
    return false;
  }
  const std::uint64_t sample_count = static_cast<std::uint64_t>(frames) * channels;
  if (sample_count > std::numeric_limits<std::size_t>::max() ||
      bytes.size() != sample_count * sizeof(float)) {
    std::fputs("Input audio size does not match ETPC dimensions\n", stderr);
    return false;
  }
  output.resize(static_cast<std::size_t>(sample_count));
  for (std::size_t index = 0; index < output.size(); ++index) {
    output[index] = readF32(bytes.data() + index * sizeof(float));
  }
  return true;
}

bool writeAudio(const std::string &file_path, const std::vector<float> &audio) {
  std::ofstream output(file_path, std::ios::binary | std::ios::trunc);
  if (!output) {
    std::fprintf(stderr, "Unable to create %s\n", file_path.c_str());
    return false;
  }
  output.write(reinterpret_cast<const char *>(audio.data()),
               static_cast<std::streamsize>(audio.size() * sizeof(float)));
  if (!output) {
    std::fprintf(stderr, "Unable to write %s\n", file_path.c_str());
    return false;
  }
  return true;
}

bool checkStatus(const char *operation, et_status status) {
  if (status != ET_OK) {
    std::fprintf(stderr, "%s failed with et_status %d\n", operation, static_cast<int>(status));
    return false;
  }
  return true;
}

bool stageParams(et_engine engine, et_instance instance, const Control &control,
                 const std::vector<float> &params, const std::vector<std::uint8_t> &param_bytes) {
  const float *data = params.empty() ? nullptr : params.data();
  if (!checkStatus("et_instance_set_params",
                   et_instance_set_params(engine, instance, data,
                                          static_cast<std::uint32_t>(params.size()),
                                          control.paramsHash, 0u))) {
    return false;
  }
  if (param_bytes.empty()) {
    return true;
  }
  return checkStatus("et_instance_set_param_bytes",
                     et_instance_set_param_bytes(engine, instance, param_bytes.data(),
                                                 static_cast<std::uint32_t>(param_bytes.size()),
                                                 control.paramsHash, 0u));
}

bool stageParams(effetune::Engine &engine, et_instance instance, const Control &control,
                 const std::vector<float> &params, const std::vector<std::uint8_t> &param_bytes) {
  const float *data = params.empty() ? nullptr : params.data();
  if (!checkStatus("setInstanceParams",
                   engine.setInstanceParams(instance, data,
                                            static_cast<std::uint32_t>(params.size()),
                                            control.paramsHash, 0u))) {
    return false;
  }
  if (param_bytes.empty())
    return true;
  return checkStatus("setInstanceParamBytes",
                     engine.setInstanceParamBytes(instance, param_bytes.data(),
                                                  static_cast<std::uint32_t>(param_bytes.size()),
                                                  control.paramsHash, 0u));
}

std::vector<float> decimateReference(const std::vector<float> &input, std::uint32_t divider) {
  if (divider == 1u)
    return input;
  effetune::dsp::Halfband2x first;
  effetune::dsp::Halfband2x second;
  std::vector<float> output;
  output.reserve(input.size() / divider + 1u);
  for (float sample : input) {
    float intermediate = 0.0F;
    if (!first.decimate(sample, intermediate))
      continue;
    if (divider == 2u) {
      output.push_back(intermediate);
      continue;
    }
    float low = 0.0F;
    if (second.decimate(intermediate, low))
      output.push_back(low);
  }
  return output;
}

std::vector<float> interpolateReference(const std::vector<float> &input, std::uint32_t divider) {
  if (divider == 1u)
    return input;
  effetune::dsp::Halfband2x first;
  effetune::dsp::Halfband2x second;
  std::vector<float> output;
  output.reserve(input.size() * divider);
  for (float sample : input) {
    if (divider == 2u) {
      float first_output = 0.0F;
      float second_output = 0.0F;
      first.interpolate(sample, first_output, second_output);
      output.push_back(first_output);
      output.push_back(second_output);
      continue;
    }
    float middle_a = 0.0F;
    float middle_b = 0.0F;
    second.interpolate(sample, middle_a, middle_b);
    float first_output = 0.0F;
    float second_output = 0.0F;
    first.interpolate(middle_a, first_output, second_output);
    output.push_back(first_output);
    output.push_back(second_output);
    first.interpolate(middle_b, first_output, second_output);
    output.push_back(first_output);
    output.push_back(second_output);
  }
  return output;
}

bool runDirectReference(const std::string &type, const Control &control,
                        const std::vector<float> &input, std::vector<float> &output) {
  struct RoutePath {
    std::uint32_t input;
    std::uint32_t output;
    std::uint32_t irChannel;
  };
  constexpr std::uint32_t kEtaHeaderBytes = 32u;
  constexpr std::uint32_t kPathRecordBytes = 12u;
  constexpr std::uint32_t kEtaMagic = 0x31415445u;
  constexpr std::uint32_t kTopologyMono = 1u;
  constexpr std::uint32_t kTopologyIndependent = 2u;
  constexpr std::uint32_t kTopologyTrueStereo = 3u;
  constexpr std::uint32_t kTopologyMatrix = 4u;
  const bool room_eq = type == "RoomEqPlugin";
  const bool ir_reverb = type == "IRReverbPlugin";
  if (!room_eq && !ir_reverb) {
    std::fputs("Direct reference is not available for this kernel\n", stderr);
    return false;
  }
  const Asset &asset = control.asset;
  const std::uint32_t divider = asset.begin.rateDivider;
  const std::uint32_t ir_channels = asset.begin.channels;
  const std::uint32_t ir_frames = asset.begin.frames;
  const std::uint32_t path_count =
      asset.begin.topology == kTopologyMatrix ? asset.begin.pathCount : 0u;
  const std::uint64_t path_table_bytes = static_cast<std::uint64_t>(path_count) * kPathRecordBytes;
  const std::uint64_t expected_bytes =
      kEtaHeaderBytes + path_table_bytes +
      static_cast<std::uint64_t>(ir_channels) * ir_frames * sizeof(float);
  const bool fixed_topology = asset.begin.topology == kTopologyMono ||
                              asset.begin.topology == kTopologyIndependent ||
                              asset.begin.topology == kTopologyTrueStereo;
  const bool matrix_topology = asset.begin.topology == kTopologyMatrix && path_count >= 1u &&
                               path_count <= 8u && asset.begin.inputCount >= 1u &&
                               asset.begin.inputCount <= path_count;
  const std::size_t expected_params = room_eq ? 4u : 6u;
  const bool valid_room_eq_asset =
      !room_eq || (asset.begin.topology == kTopologyMono && divider == 1u && ir_channels == 1u &&
                   asset.begin.processingChannels == control.channels &&
                   asset.begin.pathCount == 0u && asset.begin.inputCount == 0u);
  if (!control.hasAsset || !control.events.empty() ||
      control.initialParams.size() != expected_params || asset.format != ET_ASSET_F32_MULTICH ||
      expected_bytes != asset.bytes.size() || readU32(asset.bytes.data()) != kEtaMagic ||
      readU32(asset.bytes.data() + 4u) != ir_channels ||
      readU32(asset.bytes.data() + 8u) != ir_frames ||
      readU32(asset.bytes.data() + 16u) != asset.begin.topology ||
      (!fixed_topology && !matrix_topology) ||
      (fixed_topology && (asset.begin.pathCount != 0u || asset.begin.inputCount != 0u)) ||
      (asset.begin.topology == kTopologyTrueStereo && ir_channels != 4u) ||
      (divider != 1u && divider != 2u && divider != 4u) || !valid_room_eq_asset) {
    std::fputs("Direct reference requires one valid ETA1 asset and no events\n", stderr);
    return false;
  }
  const std::uint32_t expected_rate =
      static_cast<std::uint32_t>(std::lround(control.sampleRate / divider));
  if (readU32(asset.bytes.data() + 12u) != expected_rate ||
      readU32(asset.bytes.data() + 20u) != path_count || readU32(asset.bytes.data() + 24u) != 0u ||
      readU32(asset.bytes.data() + 28u) != 0u) {
    std::fputs("Direct reference ETA1 metadata does not match the control packet\n", stderr);
    return false;
  }

  std::vector<RoutePath> paths;
  if (asset.begin.topology == kTopologyMono) {
    for (std::uint32_t channel = 0u; channel < control.channels; ++channel)
      paths.push_back({channel, channel, 0u});
  } else if (asset.begin.topology == kTopologyIndependent) {
    for (std::uint32_t channel = 0u; channel < control.channels; ++channel)
      paths.push_back({channel, channel, channel});
  } else if (asset.begin.topology == kTopologyTrueStereo) {
    paths = {{0u, 0u, 0u}, {0u, 1u, 1u}, {1u, 0u, 2u}, {1u, 1u, 3u}};
  } else {
    std::vector<bool> inputs(asset.begin.inputCount, false);
    std::uint32_t distinct_inputs = 0u;
    for (std::uint32_t index = 0u; index < path_count; ++index) {
      const std::uint8_t *record =
          asset.bytes.data() + kEtaHeaderBytes + static_cast<std::size_t>(index) * kPathRecordBytes;
      const RoutePath path{readU32(record), readU32(record + 4u), readU32(record + 8u)};
      if (path.input >= asset.begin.inputCount || path.output >= control.channels ||
          path.irChannel >= ir_channels) {
        std::fputs("Direct reference matrix path is out of range\n", stderr);
        return false;
      }
      paths.push_back(path);
      if (!inputs[path.input]) {
        inputs[path.input] = true;
        ++distinct_inputs;
      }
    }
    if (distinct_inputs != asset.begin.inputCount) {
      std::fputs("Direct reference matrix inputs are not dense\n", stderr);
      return false;
    }
  }

  std::vector<float> ir(static_cast<std::size_t>(ir_channels) * ir_frames);
  for (std::size_t index = 0u; index < ir.size(); ++index)
    ir[index] =
        readF32(asset.bytes.data() + kEtaHeaderBytes + path_table_bytes + index * sizeof(float));
  std::vector<float> wet(static_cast<std::size_t>(control.channels) * control.frames, 0.0F);
  std::vector<std::vector<float>> low_inputs;
  for (std::uint32_t channel = 0u; channel < control.channels; ++channel) {
    std::vector<float> source(input.begin() + static_cast<std::size_t>(channel) * control.frames,
                              input.begin() +
                                  static_cast<std::size_t>(channel + 1u) * control.frames);
    low_inputs.push_back(decimateReference(source, divider));
  }
  std::vector<std::vector<double>> low_outputs(control.channels,
                                               std::vector<double>(low_inputs.front().size(), 0.0));
  for (const RoutePath &path : paths) {
    if (path.input >= control.channels || path.output >= control.channels ||
        path.irChannel >= ir_channels) {
      std::fputs("Direct reference topology path is out of range\n", stderr);
      return false;
    }
    for (std::size_t input_frame = 0u; input_frame < low_inputs[path.input].size(); ++input_frame) {
      for (std::uint32_t tap = 0u; tap < ir_frames; ++tap) {
        const std::size_t output_frame = input_frame + tap + asset.begin.headBlock;
        if (output_frame >= low_outputs[path.output].size())
          break;
        low_outputs[path.output][output_frame] +=
            static_cast<double>(low_inputs[path.input][input_frame]) *
            static_cast<double>(ir[static_cast<std::size_t>(path.irChannel) * ir_frames + tap]);
      }
    }
  }
  for (std::uint32_t channel = 0u; channel < control.channels; ++channel) {
    const std::vector<double> &low_output = low_outputs[channel];
    std::vector<float> low_float(low_output.size());
    const float rate_gain = divider == 4u ? 2.0F : divider == 2u ? 1.41421356237F : 1.0F;
    for (std::size_t index = 0u; index < low_output.size(); ++index)
      low_float[index] = static_cast<float>(low_output[index]) * rate_gain;
    const std::vector<float> full = interpolateReference(low_float, divider);
    const std::size_t start = divider - 1u;
    for (std::size_t index = 0u; index < full.size() && start + index < control.frames; ++index) {
      wet[static_cast<std::size_t>(channel) * control.frames + start + index] = full[index];
    }
  }

  if (room_eq) {
    const std::uint32_t filter_delay = control.initialParams[1u] > 0.0F
                                           ? static_cast<std::uint32_t>(control.initialParams[1u])
                                           : 0u;
    const float gain = std::pow(10.0F, control.initialParams[3u] * 0.05F);
    output.assign(input.size(), 0.0F);
    for (std::uint32_t channel = 0u; channel < control.channels; ++channel) {
      const std::size_t channel_offset = static_cast<std::size_t>(channel) * control.frames;
      const std::uint32_t manual_delay = control.initialParams[2u] > 0.0F
                                             ? static_cast<std::uint32_t>(control.initialParams[2u])
                                             : 0u;
      float wet_mix = 0.0F;
      for (std::uint32_t frame = 0u; frame < control.frames; ++frame) {
        if (wet_mix < 1.0F) {
          wet_mix += 1.0F / 128.0F;
          if (wet_mix > 1.0F)
            wet_mix = 1.0F;
        }
        const std::uint32_t active_manual_delay =
            manual_delay > 0u && frame < 128u ? 0u : manual_delay;
        const std::uint32_t dry_delay = asset.begin.headBlock + filter_delay + active_manual_delay;
        const float dry = frame >= dry_delay ? input[channel_offset + frame - dry_delay] : 0.0F;
        const float delayed_wet =
            frame >= active_manual_delay ? wet[channel_offset + frame - active_manual_delay] : 0.0F;
        float manual_transition_gain = 1.0F;
        if (manual_delay > 0u && frame < 128u)
          manual_transition_gain = static_cast<float>(128u - frame) / 128.0F;
        else if (manual_delay > 0u && frame < 256u)
          manual_transition_gain = static_cast<float>(frame - 128u) / 128.0F;
        output[channel_offset + frame] =
            (dry + wet_mix * (delayed_wet - dry)) * gain * manual_transition_gain;
      }
    }
    return true;
  }

  const float wet_gain = std::pow(10.0F, control.initialParams[3u] * 0.05F);
  const float dry_gain = std::pow(10.0F, control.initialParams[4u] * 0.05F);
  const double requested_delay =
      static_cast<double>(control.initialParams[5u]) * control.sampleRate * 0.001;
  const std::uint32_t delay =
      requested_delay > 0.0 ? static_cast<std::uint32_t>(requested_delay) : 0u;
  output.assign(input.size(), 0.0F);
  for (std::uint32_t channel = 0u; channel < control.channels; ++channel) {
    const std::size_t channel_offset = static_cast<std::size_t>(channel) * control.frames;
    for (std::uint32_t frame = 0u; frame < control.frames; ++frame) {
      const float delayed_wet = frame >= delay ? wet[channel_offset + frame - delay] : 0.0F;
      output[channel_offset + frame] =
          input[channel_offset + frame] * dry_gain + delayed_wet * wet_gain;
    }
  }
  return true;
}

bool runAssetCase(const Options &options, const Control &control, const std::vector<float> &input,
                  std::vector<float> &output) {
  effetune::Engine engine;
  const std::uint32_t prepared_frames = control.blockSize < 32u ? 32u : control.blockSize;
  if (!checkStatus("Engine::prepare", engine.prepare(control.sampleRate, control.channels,
                                                     prepared_frames, kTelemetryBytes))) {
    return false;
  }
  const et_instance instance = engine.createInstance(options.type.c_str());
  if (instance == 0u) {
    std::fputs("Engine::createInstance failed\n", stderr);
    return false;
  }
  if (!checkStatus("Engine::setInstanceSeed",
                   engine.setInstanceSeed(instance, options.seedLow, options.seedHigh)) ||
      !stageParams(engine, instance, control, control.initialParams, control.initialParamBytes)) {
    return false;
  }

  std::uint8_t *staging =
      engine.beginInstanceAsset(instance, control.asset.slot, control.asset.begin);
  if (staging == nullptr) {
    std::fputs("Engine::beginInstanceAsset failed\n", stderr);
    return false;
  }
  std::memcpy(staging, control.asset.bytes.data(), control.asset.bytes.size());
  if (!checkStatus(
          "Engine::commitInstanceAsset",
          engine.commitInstanceAsset(instance, control.asset.slot,
                                     static_cast<std::uint32_t>(control.asset.bytes.size()),
                                     control.asset.format))) {
    return false;
  }

  std::vector<float> silence(static_cast<std::size_t>(control.channels) * prepared_frames, 0.0F);
  constexpr std::uint32_t kMaximumPreparationCalls = 100000u;
  std::uint32_t preparation_calls = 0u;
  std::uint32_t asset_state = engine.instanceAssetState(instance, control.asset.slot) & 0xffu;
  while (asset_state == ET_ASSET_STATE_PREPARING && preparation_calls < kMaximumPreparationCalls) {
    std::fill(silence.begin(), silence.end(), 0.0F);
    if (!checkStatus("Engine::processInstance preparation",
                     engine.processInstance(instance, silence.data(), control.channels,
                                            prepared_frames, 0.0))) {
      return false;
    }
    ++preparation_calls;
    asset_state = engine.instanceAssetState(instance, control.asset.slot) & 0xffu;
  }
  if (asset_state != ET_ASSET_STATE_ACTIVE) {
    std::fprintf(stderr, "Asset did not become active (state %u after %u calls)\n", asset_state,
                 preparation_calls);
    return false;
  }
  if (!checkStatus("Engine::resetInstance", engine.resetInstance(instance)))
    return false;

  output.assign(input.size(), 0.0F);
  std::vector<float> block(static_cast<std::size_t>(control.channels) * control.blockSize);
  std::uint32_t start_frame = 0u;
  std::size_t event_index = 0u;
  while (start_frame < control.frames) {
    while (event_index < control.events.size() &&
           control.events[event_index].frame == start_frame) {
      if (!stageParams(engine, instance, control, control.events[event_index].params,
                       control.events[event_index].paramBytes)) {
        return false;
      }
      ++event_index;
    }
    const std::uint32_t next_event =
        event_index < control.events.size() ? control.events[event_index].frame : control.frames;
    std::uint32_t block_frames = control.frames - start_frame;
    if (block_frames > control.blockSize)
      block_frames = control.blockSize;
    if (next_event > start_frame && next_event - start_frame < block_frames)
      block_frames = next_event - start_frame;
    for (std::uint32_t channel = 0u; channel < control.channels; ++channel) {
      const float *source =
          input.data() + static_cast<std::size_t>(channel) * control.frames + start_frame;
      std::memcpy(block.data() + static_cast<std::size_t>(channel) * block_frames, source,
                  static_cast<std::size_t>(block_frames) * sizeof(float));
    }
    if (!checkStatus(
            "Engine::processInstance",
            engine.processInstance(instance, block.data(), control.channels, block_frames,
                                   static_cast<double>(start_frame) / control.sampleRate))) {
      return false;
    }
    for (std::uint32_t channel = 0u; channel < control.channels; ++channel) {
      float *target =
          output.data() + static_cast<std::size_t>(channel) * control.frames + start_frame;
      std::memcpy(target, block.data() + static_cast<std::size_t>(channel) * block_frames,
                  static_cast<std::size_t>(block_frames) * sizeof(float));
    }
    start_frame += block_frames;
  }
  engine.destroyInstance(instance);
  return true;
}

bool runCase(const Options &options, const Control &control, const std::vector<float> &input,
             std::vector<float> &output) {
  const effetune::KernelDescriptor *descriptor = effetune::registry::find(options.type.c_str());
  if (descriptor == nullptr || descriptor->paramsHash != control.paramsHash ||
      descriptor->paramsFloatCount != control.initialParams.size() ||
      control.initialParamBytes.size() > descriptor->paramsByteCapacity ||
      (control.initialParamBytes.empty() != (descriptor->paramsByteCapacity == 0u))) {
    std::fputs("ETPC parameter layout does not match the kernel registry\n", stderr);
    return false;
  }
  if (options.allocations && (et_build_flags() & ET_BUILD_DEBUG) == 0u) {
    std::fputs("--allocations requires a Debug native runner build\n", stderr);
    return false;
  }
  if (options.referenceDirect)
    return runDirectReference(options.type, control, input, output);
  if (control.hasAsset)
    return runAssetCase(options, control, input, output);

  EngineOwner engine;
  if (engine.get() == 0u) {
    std::fputs("et_engine_create failed\n", stderr);
    return false;
  }
  const std::uint32_t prepared_frames = control.blockSize < 32u ? 32u : control.blockSize;
  if (!checkStatus("et_engine_prepare",
                   et_engine_prepare(engine.get(), control.sampleRate, control.channels,
                                     prepared_frames, kTelemetryBytes))) {
    return false;
  }
  const et_instance raw_instance = et_instance_create(engine.get(), options.type.c_str());
  if (raw_instance == 0u) {
    std::fputs("et_instance_create failed\n", stderr);
    return false;
  }
  InstanceOwner instance(engine.get(), raw_instance);
  if (!checkStatus(
          "et_instance_set_seed",
          et_instance_set_seed(engine.get(), instance.get(), options.seedLow, options.seedHigh))) {
    return false;
  }
  if (!stageParams(engine.get(), instance.get(), control, control.initialParams,
                   control.initialParamBytes)) {
    return false;
  }

  output.assign(input.size(), 0.0F);
  std::vector<float> block(static_cast<std::size_t>(control.channels) * control.blockSize);
  std::uint32_t start_frame = 0u;
  std::size_t event_index = 0u;
  while (start_frame < control.frames) {
    while (event_index < control.events.size() &&
           control.events[event_index].frame == start_frame) {
      if (!stageParams(engine.get(), instance.get(), control, control.events[event_index].params,
                       control.events[event_index].paramBytes)) {
        return false;
      }
      ++event_index;
    }
    const std::uint32_t next_event =
        event_index < control.events.size() ? control.events[event_index].frame : control.frames;
    std::uint32_t block_frames = control.frames - start_frame;
    if (block_frames > control.blockSize) {
      block_frames = control.blockSize;
    }
    if (next_event > start_frame && next_event - start_frame < block_frames) {
      block_frames = next_event - start_frame;
    }
    for (std::uint32_t channel = 0; channel < control.channels; ++channel) {
      const float *source =
          input.data() + static_cast<std::size_t>(channel) * control.frames + start_frame;
      std::memcpy(block.data() + static_cast<std::size_t>(channel) * block_frames, source,
                  static_cast<std::size_t>(block_frames) * sizeof(float));
    }
    if (!checkStatus("et_instance_process",
                     et_instance_process(engine.get(), instance.get(), block.data(),
                                         control.channels, block_frames,
                                         static_cast<double>(start_frame) / control.sampleRate))) {
      return false;
    }
    for (std::uint32_t channel = 0; channel < control.channels; ++channel) {
      float *target =
          output.data() + static_cast<std::size_t>(channel) * control.frames + start_frame;
      std::memcpy(target, block.data() + static_cast<std::size_t>(channel) * block_frames,
                  static_cast<std::size_t>(block_frames) * sizeof(float));
    }
    start_frame += block_frames;
  }
  return true;
}

} // namespace

int main(int argc, char **argv) {
  Options options;
  if (!parseOptions(argc, argv, options)) {
    return argc == 2 && std::strcmp(argv[1], "--help") == 0 ? 0 : 2;
  }
  std::vector<std::uint8_t> control_bytes;
  Control control;
  std::vector<float> input;
  std::vector<float> output;
  if (!readBytes(options.control, control_bytes) || !parseControl(control_bytes, control) ||
      !readAudio(options.input, control.frames, control.channels, input) ||
      !runCase(options, control, input, output) || !writeAudio(options.output, output)) {
    return 1;
  }
  return 0;
}

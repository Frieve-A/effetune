#include "effetune/abi.h"
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
constexpr std::uint32_t kTelemetryBytes = 64u * 1024u;

struct Options {
  std::string type;
  std::string control;
  std::string input;
  std::string output;
  std::uint32_t seedLow = 0xeffe7a5eU;
  std::uint32_t seedHigh = 0U;
  bool allocations = false;
};

struct Event {
  std::uint32_t frame = 0;
  std::vector<float> params;
  std::vector<std::uint8_t> paramBytes;
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
                "[--allocations]");
      return false;
    }
    if (argument == "--allocations") {
      options.allocations = true;
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
  const bool structured = version == kStructuredControlVersion;
  const std::uint32_t header_bytes =
      structured ? kStructuredControlHeaderBytes : kControlHeaderBytes;
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
  if (!std::isfinite(control.sampleRate) || control.sampleRate <= 0.0F || control.frames == 0u ||
      control.channels == 0u || control.channels > 8u || control.blockSize == 0u ||
      param_count > 65536u || initial_byte_count > 4096u || event_count > control.frames) {
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

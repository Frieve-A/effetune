#include "allocation_guard.h"
#include "effetune/dsp/halfband.h"
#include "effetune/dsp/partitioned_convolver.h"
#include "effetune/kernel.h"
#include "engine.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_IRReverbPlugin() noexcept;

namespace {

constexpr std::uint32_t kStorageBytes = 8192u;
constexpr std::uint32_t kHeaderBytes = 32u;
constexpr std::uint32_t kMagic = 0x31415445u;
constexpr std::uint32_t kMono = 1u;
constexpr std::uint32_t kIndependent = 2u;
constexpr std::uint32_t kTrueStereo = 3u;
constexpr std::uint32_t kMatrix = 4u;
constexpr std::uint32_t kPathRecordBytes = 12u;
constexpr std::uint32_t kMaxFrames = 511u;
constexpr std::size_t kAssetCapacity = 32u * 1024u * 1024u;
constexpr std::size_t kConvolverImplUpperBound = 512u;
constexpr std::size_t kConvolverStageUpperBound = 512u;
constexpr std::size_t kPffftSetupFixedUpperBound = 136u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (condition)
    return;
  std::fprintf(stderr, "ir_reverb/native_test.cpp:%d: check failed: %s\n", line, expression);
  ++failures;
}

#define IR_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

std::size_t nextPowerOfTwo(std::size_t value) noexcept {
  std::size_t result = 1u;
  while (result < value)
    result *= 2u;
  return result;
}

std::uint32_t topologyPathCount(std::uint32_t topology, std::uint32_t assetChannels,
                                std::uint32_t engineChannels,
                                std::uint32_t matrixPathCount) noexcept {
  if (topology == kMono)
    return engineChannels;
  if (topology == kTrueStereo)
    return 4u;
  if (topology == kMatrix)
    return matrixPathCount;
  return assetChannels;
}

std::uint32_t topologyInputCount(std::uint32_t topology, std::uint32_t engineChannels,
                                 std::uint32_t matrixInputCount) noexcept {
  if (topology == kTrueStereo)
    return 2u;
  if (topology == kMatrix)
    return matrixInputCount;
  return engineChannels;
}

struct HostStage {
  std::uint32_t block;
  std::uint32_t offset;
  std::uint32_t frames;
};

std::vector<HostStage> hostStages(std::uint32_t frames, std::uint32_t headBlock) {
  const std::uint32_t latency = headBlock;
  const std::uint32_t head = latency == 0u ? 128u : latency;
  std::vector<HostStage> stages;
  const auto add = [&](std::uint32_t block, std::uint32_t offset, std::uint32_t end) {
    if (offset >= frames || end <= offset)
      return;
    stages.push_back({block, offset, std::min(end, frames) - offset});
  };
  add(head, latency == 0u ? 128u : 0u, 4u * head);
  for (std::uint32_t block = 2u * head; block < 4096u; block *= 2u)
    add(block, 2u * block, 4u * block);
  add(4096u, 8192u, frames);
  return stages;
}

std::size_t hostConvolverUpperBound(std::uint32_t frames, std::uint32_t assetChannels,
                                    std::uint32_t topology, std::uint32_t engineChannels,
                                    std::uint32_t headBlock, std::uint32_t matrixPathCount = 0u,
                                    std::uint32_t matrixInputCount = 0u) {
  const std::uint32_t paths =
      topologyPathCount(topology, assetChannels, engineChannels, matrixPathCount);
  const std::uint32_t inputs = topologyInputCount(topology, engineChannels, matrixInputCount);
  const std::vector<HostStage> stages = hostStages(frames, headBlock);
  std::size_t requiredRing = static_cast<std::size_t>(headBlock) + 4096u;
  std::size_t bytes = kConvolverImplUpperBound;
  for (const HostStage &stage : stages) {
    requiredRing = std::max(requiredRing, static_cast<std::size_t>(headBlock) + stage.offset +
                                              stage.block + 4096u);
    const std::size_t fft = 2u * stage.block;
    const std::size_t partitions = (stage.frames + stage.block - 1u) / stage.block;
    const std::size_t floats = 3u * inputs * stage.block + 2u * fft +
                               (inputs + assetChannels) * partitions * fft +
                               2u * engineChannels * fft;
    bytes += kConvolverStageUpperBound + floats * sizeof(float) +
             nextPowerOfTwo(paths) * kPathRecordBytes + kPffftSetupFixedUpperBound +
             fft * sizeof(float);
  }
  bytes += static_cast<std::size_t>(engineChannels) * nextPowerOfTwo(requiredRing) * sizeof(float);
  if (headBlock == 0u)
    bytes += static_cast<std::size_t>(assetChannels + inputs) * 128u * sizeof(float);
  bytes += static_cast<std::size_t>(inputs) * sizeof(float);
  return bytes;
}

std::size_t hostFootprint(std::uint32_t frames, std::uint32_t assetChannels, std::uint32_t topology,
                          std::uint32_t engineChannels, std::uint32_t headBlock,
                          std::uint32_t matrixPathCount = 0u, std::uint32_t matrixInputCount = 0u) {
  const std::size_t paths =
      topologyPathCount(topology, assetChannels, engineChannels, matrixPathCount);
  const std::size_t payload = kHeaderBytes + (topology == kMatrix ? paths * kPathRecordBytes : 0u) +
                              static_cast<std::size_t>(frames) * assetChannels * sizeof(float);
  const std::size_t kernelBegin =
      payload + static_cast<std::size_t>(frames) * assetChannels * 16u + 2u * 1024u * 1024u;
  return std::max(kernelBegin,
                  payload + hostConvolverUpperBound(frames, assetChannels, topology, engineChannels,
                                                    headBlock, matrixPathCount, matrixInputCount));
}

std::uint32_t hostMaximumFrames(std::uint32_t assetChannels, std::uint32_t topology,
                                std::uint32_t engineChannels, std::uint32_t headBlock,
                                std::uint32_t matrixPathCount = 0u,
                                std::uint32_t matrixInputCount = 0u) {
  std::uint32_t low = 1u;
  std::uint32_t high = 2000000u;
  while (low < high) {
    const std::uint32_t middle = low + (high - low + 1u) / 2u;
    if (hostFootprint(middle, assetChannels, topology, engineChannels, headBlock, matrixPathCount,
                      matrixInputCount) <= kAssetCapacity)
      low = middle;
    else
      high = middle - 1u;
  }
  return low;
}

effetune::dsp::ConvolverConfig footprintConfig(std::uint32_t frames, std::uint32_t assetChannels,
                                               std::uint32_t topology, std::uint32_t engineChannels,
                                               std::uint32_t headBlock,
                                               std::uint32_t matrixPathCount = 0u,
                                               std::uint32_t matrixInputCount = 0u) {
  effetune::dsp::ConvolverConfig config;
  config.latencySamples = headBlock;
  config.inputs = topologyInputCount(topology, engineChannels, matrixInputCount);
  config.outputs = engineChannels;
  config.irChannels = assetChannels;
  config.irFrames = frames;
  const std::uint32_t paths =
      topologyPathCount(topology, assetChannels, engineChannels, matrixPathCount);
  config.pathCount = paths;
  if (topology == kTrueStereo) {
    config.paths[0u] = {0u, 0u, 0u};
    config.paths[1u] = {0u, 1u, 1u};
    config.paths[2u] = {1u, 0u, 2u};
    config.paths[3u] = {1u, 1u, 3u};
  } else {
    for (std::uint32_t path = 0u; path < paths; ++path) {
      config.paths[path] = {path % config.inputs, path % engineChannels,
                            topology == kMono ? 0u : path % assetChannels};
    }
  }
  return config;
}

void writeU32(std::uint8_t *bytes, std::uint32_t value) noexcept {
  bytes[0] = static_cast<std::uint8_t>(value);
  bytes[1] = static_cast<std::uint8_t>(value >> 8u);
  bytes[2] = static_cast<std::uint8_t>(value >> 16u);
  bytes[3] = static_cast<std::uint8_t>(value >> 24u);
}

std::vector<std::uint8_t>
makePayload(const std::vector<float> &ir, std::uint32_t channels, std::uint32_t frames,
            std::uint32_t sampleRate, std::uint32_t topology,
            const std::vector<effetune::dsp::ConvolutionPath> &paths = {}) {
  const std::size_t pathTableBytes = topology == kMatrix ? paths.size() * kPathRecordBytes : 0u;
  std::vector<std::uint8_t> payload(kHeaderBytes + pathTableBytes + ir.size() * sizeof(float), 0u);
  writeU32(payload.data(), kMagic);
  writeU32(payload.data() + 4u, channels);
  writeU32(payload.data() + 8u, frames);
  writeU32(payload.data() + 12u, sampleRate);
  writeU32(payload.data() + 16u, topology);
  writeU32(payload.data() + 20u,
           topology == kMatrix ? static_cast<std::uint32_t>(paths.size()) : 0u);
  for (std::size_t index = 0u; index < paths.size(); ++index) {
    std::uint8_t *record = payload.data() + kHeaderBytes + index * kPathRecordBytes;
    writeU32(record, paths[index].input);
    writeU32(record + 4u, paths[index].output);
    writeU32(record + 8u, paths[index].irChannel);
  }
  std::memcpy(payload.data() + kHeaderBytes + pathTableBytes, ir.data(), ir.size() * sizeof(float));
  return payload;
}

std::array<float, 6> params(float preDelay = 0.0F, float dryLevel = -96.0F) noexcept {
  return {0.0F, 1.0F, 1.0F, 0.0F, dryLevel, preDelay};
}

struct Harness final {
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> storage{};
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_IRReverbPlugin();
  effetune::PluginKernel *kernel = nullptr;
  std::uint32_t channels = 2u;
  float sampleRate = 48000.0F;

  Harness(float rate = 48000.0F, std::uint32_t channelCount = 2u)
      : channels(channelCount), sampleRate(rate) {
    IR_CHECK(descriptor != nullptr);
    IR_CHECK(descriptor != nullptr && descriptor->objectSize <= storage.size());
    if (descriptor == nullptr || descriptor->objectSize > storage.size())
      return;
    kernel = descriptor->construct(storage.data());
    IR_CHECK(kernel != nullptr);
    if (kernel != nullptr) {
      kernel->prepare({sampleRate, channels, kMaxFrames});
      stageParams(params());
    }
  }

  ~Harness() {
    if (kernel != nullptr)
      descriptor->destroy(kernel);
  }

  void stageParams(const std::array<float, 6> &values) noexcept {
    IR_CHECK(kernel->stageParameters(values.data(), static_cast<std::uint32_t>(values.size()),
                                     descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }

  bool stageAsset(const std::vector<float> &ir, std::uint32_t irChannels, std::uint32_t topology,
                  std::uint32_t headBlock, std::uint32_t divider,
                  const std::vector<effetune::dsp::ConvolutionPath> &paths = {},
                  std::uint32_t inputCount = 0u, std::uint32_t processingChannels = 0u) noexcept {
    const std::uint32_t frames = static_cast<std::uint32_t>(ir.size() / irChannels);
    const std::uint32_t irRate = static_cast<std::uint32_t>(sampleRate) / divider;
    const std::uint32_t effectiveChannels =
        processingChannels == 0u ? channels : processingChannels;
    const std::vector<std::uint8_t> payload =
        makePayload(ir, irChannels, frames, irRate, topology, paths);
    const std::uint32_t footprint = static_cast<std::uint32_t>(
        hostFootprint(frames, irChannels, topology, effectiveChannels, headBlock,
                      static_cast<std::uint32_t>(paths.size()), inputCount));
    effetune::AssetBeginInfo info{irChannels, frames,
                                  topology,   headBlock,
                                  divider,    static_cast<std::uint32_t>(paths.size()),
                                  inputCount, effectiveChannels,
                                  footprint,  static_cast<std::uint32_t>(payload.size())};
    std::uint8_t *staging = kernel->beginAsset(0u, info);
    if (staging == nullptr)
      return false;
    std::memcpy(staging, payload.data(), payload.size());
    const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
    et_status status = ET_ERR_STATE;
    {
      effetune::allocation_guard::Scope guard;
      status =
          kernel->commitAsset(0u, static_cast<std::uint32_t>(payload.size()), ET_ASSET_F32_MULTICH);
    }
    IR_CHECK(effetune::allocation_guard::violationCount() == allocationBefore);
    return status == ET_OK;
  }

  void prepareToActive() noexcept {
    std::vector<float> silence(static_cast<std::size_t>(channels) * 128u, 0.0F);
    std::uint32_t calls = 0u;
    while ((kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING && calls < 2000u) {
      effetune::allocation_guard::Scope guard;
      kernel->process(silence.data(), channels, 128u, {0.0});
      ++calls;
    }
    IR_CHECK((kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
    IR_CHECK(calls < 2000u);
    kernel->reset();
  }
};

std::vector<float> makeIr(std::uint32_t channels, std::uint32_t frames, float variant = 1.0F) {
  std::vector<float> ir(static_cast<std::size_t>(channels) * frames, 0.0F);
  constexpr std::array<std::uint32_t, 7> taps = {0u, 3u, 31u, 127u, 128u, 257u, 599u};
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::size_t index = 0u; index < taps.size(); ++index) {
      if (taps[index] >= frames)
        continue;
      const float sign = ((index + channel) & 1u) == 0u ? 1.0F : -1.0F;
      ir[static_cast<std::size_t>(channel) * frames + taps[index]] =
          sign * variant * (0.7F / static_cast<float>(index + 1u)) * (channel == 0u ? 1.0F : 0.8F);
    }
  }
  return ir;
}

std::vector<float> makeInput(std::uint32_t channels, std::uint32_t frames) {
  std::vector<float> input(static_cast<std::size_t>(channels) * frames, 0.0F);
  std::uint32_t state = 0x12345678u;
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      state = state * 1664525u + 1013904223u;
      input[static_cast<std::size_t>(channel) * frames + frame] =
          static_cast<float>(static_cast<std::int32_t>(state >> 8u)) / 8388608.0F * 0.08F;
    }
    input[static_cast<std::size_t>(channel) * frames] += channel == 0u ? 0.8F : -0.6F;
    input[static_cast<std::size_t>(channel) * frames + 701u] += 0.35F;
  }
  return input;
}

std::vector<float> decimate(const std::vector<float> &input, std::uint32_t divider) {
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

std::vector<float> interpolate(const std::vector<float> &input, std::uint32_t divider) {
  if (divider == 1u)
    return input;
  effetune::dsp::Halfband2x first;
  effetune::dsp::Halfband2x second;
  std::vector<float> output;
  output.reserve(input.size() * divider);
  for (float sample : input) {
    if (divider == 2u) {
      float a = 0.0F;
      float b = 0.0F;
      first.interpolate(sample, a, b);
      output.push_back(a);
      output.push_back(b);
      continue;
    }
    float middleA = 0.0F;
    float middleB = 0.0F;
    second.interpolate(sample, middleA, middleB);
    float a = 0.0F;
    float b = 0.0F;
    first.interpolate(middleA, a, b);
    output.push_back(a);
    output.push_back(b);
    first.interpolate(middleB, a, b);
    output.push_back(a);
    output.push_back(b);
  }
  return output;
}

std::vector<float>
reference(const std::vector<float> &input, const std::vector<float> &ir, std::uint32_t channels,
          std::uint32_t irChannels, std::uint32_t irFrames, std::uint32_t topology,
          std::uint32_t frames, std::uint32_t headBlock, std::uint32_t divider,
          const std::vector<effetune::dsp::ConvolutionPath> &explicitPaths = {}) {
  std::vector<float> result(static_cast<std::size_t>(channels) * frames, 0.0F);
  std::vector<effetune::dsp::ConvolutionPath> paths = explicitPaths;
  if (paths.empty()) {
    if (topology == kMono) {
      for (std::uint32_t channel = 0u; channel < channels; ++channel)
        paths.push_back({channel, channel, 0u});
    } else if (topology == kIndependent) {
      for (std::uint32_t channel = 0u; channel < irChannels; ++channel)
        paths.push_back({channel, channel, channel});
    } else if (topology == kTrueStereo) {
      paths = {{0u, 0u, 0u}, {0u, 1u, 1u}, {1u, 0u, 2u}, {1u, 1u, 3u}};
    }
  }
  std::vector<std::vector<float>> lowInputs;
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    std::vector<float> source(input.begin() + static_cast<std::size_t>(channel) * frames,
                              input.begin() + static_cast<std::size_t>(channel + 1u) * frames);
    lowInputs.push_back(decimate(source, divider));
  }
  std::vector<std::vector<double>> lowOutputs(channels,
                                              std::vector<double>(lowInputs.front().size(), 0.0));
  for (const effetune::dsp::ConvolutionPath &path : paths) {
    IR_CHECK(path.input < channels);
    IR_CHECK(path.output < channels);
    IR_CHECK(path.irChannel < irChannels);
    for (std::size_t inputFrame = 0u; inputFrame < lowInputs[path.input].size(); ++inputFrame) {
      for (std::uint32_t tap = 0u; tap < irFrames; ++tap) {
        const std::size_t outputFrame = inputFrame + tap + headBlock;
        if (outputFrame >= lowOutputs[path.output].size())
          break;
        lowOutputs[path.output][outputFrame] +=
            static_cast<double>(lowInputs[path.input][inputFrame]) *
            ir[static_cast<std::size_t>(path.irChannel) * irFrames + tap];
      }
    }
  }
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    const std::vector<double> &lowOutput = lowOutputs[channel];
    std::vector<float> lowFloat(lowOutput.size());
    for (std::size_t index = 0u; index < lowOutput.size(); ++index)
      lowFloat[index] = static_cast<float>(lowOutput[index]);
    const std::vector<float> full = interpolate(lowFloat, divider);
    const std::size_t start = divider - 1u;
    for (std::size_t index = 0u; index < full.size() && start + index < frames; ++index) {
      result[static_cast<std::size_t>(channel) * frames + start + index] = full[index];
    }
  }
  return result;
}

std::vector<float> render(Harness &harness, const std::vector<float> &input, std::uint32_t frames) {
  constexpr std::array<std::uint32_t, 6> pattern = {1u, 63u, 128u, 511u, 17u, 255u};
  std::vector<float> output(input.size(), 0.0F);
  std::vector<float> block(static_cast<std::size_t>(harness.channels) * kMaxFrames, 0.0F);
  std::size_t patternIndex = 0u;
  for (std::uint32_t offset = 0u; offset < frames; ++patternIndex) {
    const std::uint32_t requested = pattern[patternIndex % pattern.size()];
    const std::uint32_t count = requested < frames - offset ? requested : frames - offset;
    for (std::uint32_t channel = 0u; channel < harness.channels; ++channel) {
      std::copy_n(input.data() + static_cast<std::size_t>(channel) * frames + offset, count,
                  block.data() + static_cast<std::size_t>(channel) * count);
    }
    {
      effetune::allocation_guard::Scope guard;
      harness.kernel->process(block.data(), harness.channels, count, {0.0});
    }
    for (std::uint32_t channel = 0u; channel < harness.channels; ++channel) {
      std::copy_n(block.data() + static_cast<std::size_t>(channel) * count, count,
                  output.data() + static_cast<std::size_t>(channel) * frames + offset);
    }
    offset += count;
  }
  return output;
}

void compare(const std::vector<float> &actual, const std::vector<float> &expected,
             double tolerance) noexcept {
  IR_CHECK(actual.size() == expected.size());
  double maximum = 0.0;
  for (std::size_t index = 0u; index < actual.size(); ++index) {
    const double error = std::abs(static_cast<double>(actual[index]) - expected[index]);
    if (error > maximum)
      maximum = error;
    IR_CHECK(std::isfinite(actual[index]));
  }
  if (maximum > tolerance)
    std::fprintf(stderr, "IR Reverb maximum reference error: %.9g\n", maximum);
  IR_CHECK(maximum <= tolerance);
}

void expectDryOnly(Harness &harness, std::vector<float> &audio, std::uint32_t frameCount,
                   float dryLevel) {
  harness.stageParams(params(0.0F, dryLevel));
  const std::vector<float> input = audio;
  const float dryGain = dryLevel <= -96.0F ? 0.0F : std::pow(10.0F, dryLevel * 0.05F);
  const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
  {
    effetune::allocation_guard::Scope guard;
    harness.kernel->process(audio.data(), harness.channels, frameCount, {0.0});
  }
  IR_CHECK(effetune::allocation_guard::violationCount() == allocationBefore);
  for (std::size_t index = 0u; index < audio.size(); ++index) {
    const float expected = input[index] * dryGain;
    IR_CHECK(std::abs(audio[index] - expected) < 1.0e-6F);
  }
}

void expectWetFadeOut(Harness &harness, std::vector<float> &audio, std::uint32_t frameCount,
                      float dryLevel, const std::vector<float> &lastWet) {
  constexpr std::uint32_t fadeFrames = 128u;
  harness.stageParams(params(0.0F, dryLevel));
  const std::vector<float> input = audio;
  const float dryGain = dryLevel <= -96.0F ? 0.0F : std::pow(10.0F, dryLevel * 0.05F);
  const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
  {
    effetune::allocation_guard::Scope guard;
    harness.kernel->process(audio.data(), harness.channels, frameCount, {0.0});
  }
  IR_CHECK(effetune::allocation_guard::violationCount() == allocationBefore);
  IR_CHECK(lastWet.size() == harness.channels);
  for (std::uint32_t channel = 0u; channel < harness.channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frameCount; ++frame) {
      const std::size_t index = static_cast<std::size_t>(channel) * frameCount + frame;
      const float fade =
          frame < fadeFrames ? static_cast<float>(fadeFrames - frame) / fadeFrames : 0.0F;
      const float dry = input[index] * dryGain;
      IR_CHECK(std::abs(audio[index] - (dry + lastWet[channel] * fade)) < 2.0e-6F);
    }
  }
}

void testDryOnlyUntilMatchingAssetIsActive() {
  constexpr std::uint32_t frames = 128u;
  constexpr float dryLevel = -6.0F;

  Harness freshStereo;
  IR_CHECK((freshStereo.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_NONE);
  std::vector<float> freshAudio(2u * frames);
  for (std::size_t index = 0u; index < freshAudio.size(); ++index)
    freshAudio[index] = static_cast<float>(index + 1u) / 512.0F;
  expectDryOnly(freshStereo, freshAudio, frames, -96.0F);
  for (std::size_t index = 0u; index < freshAudio.size(); ++index)
    freshAudio[index] = static_cast<float>(index + 1u) / 512.0F;
  expectDryOnly(freshStereo, freshAudio, frames, dryLevel);

  Harness multichannel(48000.0F, 8u);
  IR_CHECK(multichannel.stageAsset(makeIr(8u, 1u), 8u, kIndependent, 0u, 1u));
  multichannel.prepareToActive();
  std::vector<float> wetAudio(8u * frames, 0.0F);
  for (std::uint32_t channel = 0u; channel < 8u; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      wetAudio[static_cast<std::size_t>(channel) * frames + frame] =
          0.125F * static_cast<float>(channel + 1u);
    }
  }
  multichannel.stageParams(params());
  multichannel.kernel->process(wetAudio.data(), 8u, frames, {0.0});
  std::vector<float> previousWet(8u);
  for (std::uint32_t channel = 0u; channel < 8u; ++channel)
    previousWet[channel] = wetAudio[static_cast<std::size_t>(channel) * frames + frames - 1u];

  IR_CHECK(multichannel.stageAsset(makeIr(2u, 600u), 2u, kIndependent, 128u, 1u, {}, 0u, 2u));
  IR_CHECK((multichannel.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING);
  std::uint32_t preparationCalls = 0u;
  while ((multichannel.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING &&
         preparationCalls < 32u) {
    std::vector<float> preparingAudio(8u * frames);
    for (std::size_t index = 0u; index < preparingAudio.size(); ++index)
      preparingAudio[index] = static_cast<float>((index % 17u) + 1u) / 32.0F;
    if (preparationCalls == 0u)
      expectWetFadeOut(multichannel, preparingAudio, frames, dryLevel, previousWet);
    else
      expectDryOnly(multichannel, preparingAudio, frames, dryLevel);
    ++preparationCalls;
  }
  IR_CHECK((multichannel.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
  IR_CHECK(preparationCalls < 32u);

  std::vector<float> mismatchedAudio(8u * frames, 0.375F);
  expectDryOnly(multichannel, mismatchedAudio, frames, dryLevel);

  const std::vector<float> allIr = makeIr(8u, 600u);
  const std::vector<std::uint8_t> allPayload = makePayload(allIr, 8u, 600u, 48000u, kIndependent);
  const effetune::AssetBeginInfo allInfo{
      8u,
      600u,
      kIndependent,
      128u,
      1u,
      0u,
      0u,
      8u,
      static_cast<std::uint32_t>(hostFootprint(600u, 8u, kIndependent, 8u, 128u)),
      static_cast<std::uint32_t>(allPayload.size())};
  IR_CHECK(multichannel.kernel->beginAsset(0u, allInfo) != nullptr);
  IR_CHECK((multichannel.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_STAGED);
  std::vector<float> stagedAudio(8u * frames, -0.25F);
  expectDryOnly(multichannel, stagedAudio, frames, dryLevel);
}

void testReplacementAndClearWetFadeOut() {
  constexpr std::uint32_t frames = 128u;
  const std::vector<float> lastWet = {0.75F, -0.5F};
  const auto seedActiveTail = [&](Harness &harness) {
    IR_CHECK(harness.stageAsset({1.0F}, 1u, kMono, 0u, 1u));
    harness.prepareToActive();
    harness.stageParams(params());
    std::vector<float> audio(2u * frames);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      std::fill_n(audio.data() + static_cast<std::size_t>(channel) * frames, frames,
                  lastWet[channel]);
    }
    const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
    {
      effetune::allocation_guard::Scope guard;
      harness.kernel->process(audio.data(), 2u, frames, {0.0});
    }
    IR_CHECK(effetune::allocation_guard::violationCount() == allocationBefore);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      IR_CHECK(std::abs(audio[static_cast<std::size_t>(channel) * frames + frames - 1u] -
                        lastWet[channel]) < 1.0e-6F);
    }
  };

  Harness replacement;
  seedActiveTail(replacement);
  IR_CHECK(replacement.stageAsset({0.0F}, 1u, kMono, 0u, 1u));
  IR_CHECK((replacement.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING);
  std::vector<float> replacementAudio(2u * frames, 0.375F);
  expectWetFadeOut(replacement, replacementAudio, frames, -96.0F, lastWet);
  IR_CHECK((replacement.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
  std::vector<float> silentIrAudio(2u * frames, 0.25F);
  expectDryOnly(replacement, silentIrAudio, frames, -6.0F);

  Harness cleared;
  seedActiveTail(cleared);
  cleared.kernel->clearAsset(0u);
  IR_CHECK((cleared.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_NONE);
  std::vector<float> clearAudio(2u * frames, -0.25F);
  expectWetFadeOut(cleared, clearAudio, frames, -6.0F, lastWet);
  std::vector<float> afterClear(2u * frames, 0.5F);
  expectDryOnly(cleared, afterClear, frames, -6.0F);
}

void testDirectReferenceMatrix() {
  constexpr std::uint32_t irFrames = 600u;
  constexpr std::uint32_t renderFrames = 5000u;
  for (const std::uint32_t divider : {1u, 2u, 4u}) {
    const float rate = 48000.0F * static_cast<float>(divider);
    for (const std::uint32_t topology : {kMono, kIndependent}) {
      const std::uint32_t irChannels = topology == kMono ? 1u : 2u;
      const std::vector<float> ir = makeIr(irChannels, irFrames);
      const std::vector<float> input = makeInput(2u, renderFrames);
      Harness harness(rate);
      IR_CHECK(harness.stageAsset(ir, irChannels, topology, 128u, divider));
      harness.prepareToActive();
      const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
      const std::vector<float> actual = render(harness, input, renderFrames);
      const std::vector<float> expected =
          reference(input, ir, 2u, irChannels, irFrames, topology, renderFrames, 128u, divider);
      compare(actual, expected, divider == 1u ? 2.0e-4 : 3.5e-4);
      IR_CHECK(effetune::allocation_guard::violationCount() == allocationBefore);
    }
  }
}

void testTrueStereoReference() {
  constexpr std::uint32_t irFrames = 600u;
  constexpr std::uint32_t renderFrames = 5000u;
  const std::vector<float> ir = makeIr(4u, irFrames);
  const std::vector<float> input = makeInput(2u, renderFrames);
  for (const std::uint32_t divider : {1u, 2u, 4u}) {
    Harness harness(48000.0F * static_cast<float>(divider), 2u);
    IR_CHECK(harness.stageAsset(ir, 4u, kTrueStereo, 128u, divider));
    harness.prepareToActive();
    const std::vector<float> actual = render(harness, input, renderFrames);
    const std::vector<float> expected =
        reference(input, ir, 2u, 4u, irFrames, kTrueStereo, renderFrames, 128u, divider);
    compare(actual, expected, divider == 1u ? 2.0e-4 : 3.5e-4);
  }
}

void testSparseMatrixSharedInputs() {
  constexpr std::uint32_t irFrames = 600u;
  constexpr std::uint32_t renderFrames = 5000u;
  const std::vector<effetune::dsp::ConvolutionPath> paths = {
      {0u, 0u, 0u}, {0u, 1u, 1u}, {0u, 2u, 2u}, {1u, 0u, 3u}, {1u, 2u, 0u}};
  const std::vector<float> ir = makeIr(4u, irFrames);
  const std::vector<float> input = makeInput(3u, renderFrames);
  for (const std::uint32_t divider : {1u, 2u, 4u}) {
    Harness harness(48000.0F * static_cast<float>(divider), 3u);
    IR_CHECK(harness.stageAsset(ir, 4u, kMatrix, 128u, divider, paths, 2u));
    harness.prepareToActive();
    const std::vector<float> first = render(harness, input, renderFrames);
    const std::vector<float> expected =
        reference(input, ir, 3u, 4u, irFrames, kMatrix, renderFrames, 128u, divider, paths);
    compare(first, expected, divider == 1u ? 2.0e-4 : 3.5e-4);
    harness.kernel->reset();
    const std::vector<float> second = render(harness, input, renderFrames);
    IR_CHECK(first == second);
  }
}

void testMalformedMatrixTables() {
  const std::vector<float> ir = makeIr(2u, 600u);
  const std::vector<effetune::dsp::ConvolutionPath> validPaths = {{0u, 0u, 0u}, {1u, 1u, 1u}};
  const auto reject = [&](const std::vector<effetune::dsp::ConvolutionPath> &paths,
                          std::uint32_t inputCount, std::uint32_t headerPathCount) {
    Harness harness;
    std::vector<std::uint8_t> payload = makePayload(ir, 2u, 600u, 48000u, kMatrix, paths);
    writeU32(payload.data() + 20u, headerPathCount);
    effetune::AssetBeginInfo info{
        2u,
        600u,
        kMatrix,
        128u,
        1u,
        static_cast<std::uint32_t>(paths.size()),
        inputCount,
        2u,
        static_cast<std::uint32_t>(hostFootprint(
            600u, 2u, kMatrix, 2u, 128u, static_cast<std::uint32_t>(paths.size()), inputCount)),
        static_cast<std::uint32_t>(payload.size())};
    std::uint8_t *staging = harness.kernel->beginAsset(0u, info);
    IR_CHECK(staging != nullptr);
    if (staging == nullptr)
      return;
    std::memcpy(staging, payload.data(), payload.size());
    const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
    et_status status = ET_OK;
    {
      effetune::allocation_guard::Scope guard;
      status = harness.kernel->commitAsset(0u, static_cast<std::uint32_t>(payload.size()),
                                           ET_ASSET_F32_MULTICH);
    }
    IR_CHECK(status == ET_ERR_ARGS);
    IR_CHECK(effetune::allocation_guard::violationCount() == allocationBefore);
    IR_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ERROR);
    IR_CHECK(harness.stageAsset(ir, 2u, kIndependent, 128u, 1u));
    harness.kernel->clearAsset(0u);
    IR_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_NONE);
  };

  reject(validPaths, 2u, 1u);
  reject({{2u, 0u, 0u}, {1u, 1u, 1u}}, 2u, 2u);
  reject({{0u, 2u, 0u}, {1u, 1u, 1u}}, 2u, 2u);
  reject({{0u, 0u, 2u}, {1u, 1u, 1u}}, 2u, 2u);
  reject({{0u, 0u, 0u}, {0u, 1u, 1u}}, 2u, 2u);

  Harness beginHarness;
  effetune::AssetBeginInfo tooMany{2u,
                                   600u,
                                   kMatrix,
                                   128u,
                                   1u,
                                   9u,
                                   2u,
                                   2u,
                                   static_cast<std::uint32_t>(kAssetCapacity),
                                   kHeaderBytes + 9u * kPathRecordBytes + 1200u * sizeof(float)};
  IR_CHECK(beginHarness.kernel->beginAsset(0u, tooMany) == nullptr);
}

void testLatencyModesAndReset() {
  const std::vector<float> ir = makeIr(1u, 3000u);
  const std::vector<float> latencyInput = makeInput(2u, 6000u);
  for (const std::uint32_t latency : {0u, 128u, 256u, 512u, 1024u}) {
    Harness harness;
    IR_CHECK(harness.stageAsset(ir, 1u, kMono, latency, 1u));
    harness.prepareToActive();
    IR_CHECK(harness.kernel->latencySamples() == latency);
    const std::vector<float> actual = render(harness, latencyInput, 6000u);
    const std::vector<float> expected =
        reference(latencyInput, ir, 2u, 1u, 3000u, kMono, 6000u, latency, 1u);
    compare(actual, expected, 2.0e-4);
  }
  for (const std::uint32_t divider : {2u, 4u}) {
    Harness harness(48000.0F * static_cast<float>(divider));
    IR_CHECK(harness.stageAsset(ir, 1u, kMono, 128u, divider));
    harness.prepareToActive();
    const std::uint32_t expected =
        128u * divider +
        2u * static_cast<std::uint32_t>(effetune::dsp::Halfband2x::kLatency) * (divider - 1u);
    IR_CHECK(harness.kernel->latencySamples() == expected);
  }

  Harness resetHarness;
  IR_CHECK(resetHarness.stageAsset(ir, 1u, kMono, 128u, 1u));
  resetHarness.prepareToActive();
  const std::vector<float> input = makeInput(2u, 5000u);
  const std::vector<float> first = render(resetHarness, input, 5000u);
  resetHarness.kernel->reset();
  IR_CHECK((resetHarness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
  const std::vector<float> second = render(resetHarness, input, 5000u);
  IR_CHECK(first == second);
}

void testPredelayAndDryMix() {
  Harness harness(1000.0F);
  harness.stageParams(params(10.0F));
  const std::vector<float> ir = {1.0F};
  IR_CHECK(harness.stageAsset(ir, 1u, kMono, 128u, 1u));
  harness.prepareToActive();
  std::vector<float> input(2u * 512u, 0.0F);
  input[0u] = 1.0F;
  const std::vector<float> wetOnly = render(harness, input, 512u);
  IR_CHECK(std::abs(wetOnly[138u] - 1.0F) < 2.0e-4F);
  IR_CHECK(wetOnly[128u] == 0.0F);

  harness.kernel->reset();
  harness.stageParams(params(10.0F, 0.0F));
  const std::vector<float> mixed = render(harness, input, 512u);
  IR_CHECK(std::abs(mixed[0u] - 1.0F) < 1.0e-6F);
  IR_CHECK(std::abs(mixed[138u] - 1.0F) < 2.0e-4F);
}

void testAssetReplacementAndRejection() {
  const std::vector<float> firstIr = makeIr(1u, 600u);
  const std::vector<float> secondIr = makeIr(1u, 600u, 0.5F);
  const std::vector<float> input = makeInput(2u, 3000u);
  Harness harness;
  IR_CHECK(harness.stageAsset(firstIr, 1u, kMono, 128u, 1u));
  harness.prepareToActive();
  const std::vector<float> first = render(harness, input, 3000u);
  harness.kernel->reset();

  const std::uint32_t replacementFootprint =
      static_cast<std::uint32_t>(hostFootprint(600u, 1u, kMono, 2u, 128u));
  effetune::AssetBeginInfo rejected{1u,
                                    600u,
                                    kMono,
                                    128u,
                                    1u,
                                    0u,
                                    0u,
                                    2u,
                                    replacementFootprint,
                                    kHeaderBytes + 600u * sizeof(float)};
  // The admission probe is the first nothrow allocation made by beginAsset().
  effetune::allocation_guard::failNothrowAllocationAfterForTesting(0);
  IR_CHECK(harness.kernel->beginAsset(0u, rejected) == nullptr);
  effetune::allocation_guard::failNothrowAllocationAfterForTesting(-1);
  IR_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
  const std::vector<float> afterRejectedBegin = render(harness, input, 3000u);
  IR_CHECK(first == afterRejectedBegin);

  IR_CHECK(harness.stageAsset(secondIr, 1u, kMono, 128u, 1u));
  harness.prepareToActive();
  const std::vector<float> second = render(harness, input, 3000u);
  IR_CHECK(first != second);

  harness.kernel->clearAsset(0u);
  IR_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_NONE);
  harness.stageParams(params(0.0F));
  const std::vector<float> dry = render(harness, input, 3000u);
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::uint32_t frame = 128u; frame < 3000u; ++frame)
      IR_CHECK(dry[static_cast<std::size_t>(channel) * 3000u + frame] == 0.0F);
  }
  IR_CHECK(harness.kernel->latencySamples() == 0u);
}

void testMalformedCommitAndDryMix() {
  Harness harness;
  const std::vector<float> ir = makeIr(1u, 600u);
  const std::vector<std::uint8_t> payload = makePayload(ir, 1u, 600u, 48000u, kMono);
  effetune::AssetBeginInfo info{
      1u,
      600u,
      kMono,
      128u,
      1u,
      0u,
      0u,
      2u,
      static_cast<std::uint32_t>(hostFootprint(600u, 1u, kMono, 2u, 128u)),
      static_cast<std::uint32_t>(payload.size())};
  std::uint8_t *staging = harness.kernel->beginAsset(0u, info);
  IR_CHECK(staging != nullptr);
  std::memcpy(staging, payload.data(), payload.size());
  staging[0] = 0u;
  IR_CHECK(harness.kernel->commitAsset(0u, static_cast<std::uint32_t>(payload.size()),
                                       ET_ASSET_F32_MULTICH) == ET_ERR_ARGS);
  IR_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ERROR);
  IR_CHECK((harness.kernel->assetState(0u) >> 8u) != 0u);

  harness.stageParams(params(0.0F, 0.0F));
  std::vector<float> audio(2u * 128u, 0.25F);
  harness.kernel->process(audio.data(), 2u, 128u, {0.0});
  IR_CHECK(std::all_of(audio.begin(), audio.end(),
                       [](float sample) { return std::abs(sample - 0.25F) < 1.0e-6F; }));
}

void testBeginAllocationFailuresAreRecoverable() {
  const std::vector<float> ir = makeIr(1u, 600u);
  const std::vector<std::uint8_t> payload = makePayload(ir, 1u, 600u, 48000u, kMono);
  const std::uint32_t footprint =
      static_cast<std::uint32_t>(hostFootprint(600u, 1u, kMono, 2u, 128u));
  // Allocation 0 is the non-destructive admission probe. Allocations 1 and 2 are
  // the staging payload and the first convolver reservation after the hard reset.
  for (const std::int32_t successfulAllocations : {0, 1, 2}) {
    Harness harness;
    const effetune::AssetBeginInfo info{
        1u, 600u, kMono, 128u,      1u,
        0u, 0u,   2u,    footprint, static_cast<std::uint32_t>(payload.size())};
    effetune::allocation_guard::failNothrowAllocationAfterForTesting(successfulAllocations);
    std::uint8_t *staging = harness.kernel->beginAsset(0u, info);
    effetune::allocation_guard::failNothrowAllocationAfterForTesting(-1);
    IR_CHECK(staging == nullptr);
    const std::uint32_t expectedState =
        successfulAllocations == 0 ? ET_ASSET_STATE_NONE : ET_ASSET_STATE_ERROR;
    IR_CHECK((harness.kernel->assetState(0u) & 0xffu) == expectedState);
    IR_CHECK(harness.stageAsset(ir, 1u, kMono, 128u, 1u));
  }
}

void testPrepareAllocationFailuresAreRecoverable() {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_IRReverbPlugin();
  IR_CHECK(descriptor != nullptr);
  if (descriptor == nullptr)
    return;
  for (std::int32_t successfulAllocations = 0; successfulAllocations < 6; ++successfulAllocations) {
    alignas(std::max_align_t) std::array<std::byte, kStorageBytes> storage{};
    effetune::PluginKernel *kernel = descriptor->construct(storage.data());
    IR_CHECK(kernel != nullptr);
    if (kernel == nullptr)
      continue;
    effetune::allocation_guard::failNothrowAllocationAfterForTesting(successfulAllocations);
    kernel->prepare({48000.0F, 2u, kMaxFrames});
    effetune::allocation_guard::failNothrowAllocationAfterForTesting(-1);
    IR_CHECK(!kernel->preparedSuccessfully());
    descriptor->destroy(kernel);
  }

  Harness recovered;
  IR_CHECK(recovered.kernel != nullptr && recovered.kernel->preparedSuccessfully());
}

void testEngineRejectsFailedPrepareAndReusesSlot() {
  effetune::Engine engine;
  IR_CHECK(engine.prepare(48000.0F, 2u, kMaxFrames, 0u) == ET_OK);
  const et_instance retained = engine.createInstance("VolumePlugin");
  IR_CHECK(retained != 0u);

  effetune::allocation_guard::failNothrowAllocationAfterForTesting(1);
  const et_instance rejected = engine.createInstance("IRReverbPlugin");
  effetune::allocation_guard::failNothrowAllocationAfterForTesting(-1);
  IR_CHECK(rejected == 0u);
  IR_CHECK(engine.resetInstance(retained) == ET_OK);

  const et_instance recovered = engine.createInstance("IRReverbPlugin");
  IR_CHECK(recovered != 0u);
  IR_CHECK((recovered & 0xffffu) == 2u);
  IR_CHECK(engine.resetInstance(retained) == ET_OK);
}

void testInstancePhaseStaggerPreservesOutput() {
  const std::vector<float> ir = makeIr(1u, 600u);
  Harness first;
  Harness second;
  first.kernel->setRandomSeed(0u, 0u);
  second.kernel->setRandomSeed(1u, 0u);
  IR_CHECK(first.stageAsset(ir, 1u, kMono, 128u, 1u));
  IR_CHECK(second.stageAsset(ir, 1u, kMono, 128u, 1u));

  const auto prepare = [](Harness &harness) {
    std::vector<float> silence(static_cast<std::size_t>(harness.channels) * 128u, 0.0F);
    std::uint32_t quanta = 0u;
    while ((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING && quanta < 32u) {
      effetune::allocation_guard::Scope guard;
      harness.kernel->process(silence.data(), harness.channels, 128u, {0.0});
      ++quanta;
    }
    return quanta;
  };
  const std::uint32_t firstQuanta = prepare(first);
  const std::uint32_t secondQuanta = prepare(second);
  IR_CHECK(firstQuanta != secondQuanta);
  IR_CHECK((first.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
  IR_CHECK((second.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);

  first.kernel->reset();
  second.kernel->reset();
  const std::vector<float> input = makeInput(2u, 5000u);
  IR_CHECK(render(first, input, 5000u) == render(second, input, 5000u));
}

void testHostFootprintEstimatorGrid() {
  struct TopologyBudgetCase {
    std::uint32_t topology;
    std::uint32_t assetChannels;
    std::uint32_t pathCount;
    std::uint32_t inputCount;
  };
  constexpr std::array<std::uint32_t, 5> heads = {0u, 128u, 256u, 512u, 1024u};
  constexpr std::array<std::uint32_t, 2> engineChannelCounts = {2u, 8u};
  constexpr std::array<TopologyBudgetCase, 4> topologies = {
      TopologyBudgetCase{kMono, 1u, 0u, 0u}, TopologyBudgetCase{kIndependent, 2u, 0u, 0u},
      TopologyBudgetCase{kTrueStereo, 4u, 0u, 0u}, TopologyBudgetCase{kMatrix, 4u, 8u, 2u}};
  constexpr std::array<std::uint32_t, 6> representativeFrames = {1u,    127u,  128u,
                                                                 4095u, 8192u, 100000u};
  std::size_t minimumMargin = std::numeric_limits<std::size_t>::max();

  for (const std::uint32_t engineChannels : engineChannelCounts) {
    for (const TopologyBudgetCase &topologyCase : topologies) {
      const std::uint32_t topology = topologyCase.topology;
      if (topology == kTrueStereo && engineChannels != 2u)
        continue;
      const std::uint32_t assetChannels =
          topology == kIndependent ? engineChannels : topologyCase.assetChannels;
      for (const std::uint32_t headBlock : heads) {
        const std::uint32_t maximum =
            hostMaximumFrames(assetChannels, topology, engineChannels, headBlock,
                              topologyCase.pathCount, topologyCase.inputCount);
        IR_CHECK(hostFootprint(maximum, assetChannels, topology, engineChannels, headBlock,
                               topologyCase.pathCount, topologyCase.inputCount) <= kAssetCapacity);
        IR_CHECK(hostFootprint(maximum + 1u, assetChannels, topology, engineChannels, headBlock,
                               topologyCase.pathCount, topologyCase.inputCount) > kAssetCapacity);

        for (const std::uint32_t candidate : representativeFrames) {
          const std::uint32_t frames = std::min(candidate, maximum);
          effetune::dsp::PartitionedConvolver convolver;
          IR_CHECK(convolver.reserve(
              footprintConfig(frames, assetChannels, topology, engineChannels, headBlock,
                              topologyCase.pathCount, topologyCase.inputCount)));
          const std::size_t payload =
              kHeaderBytes +
              (topology == kMatrix ? topologyCase.pathCount * kPathRecordBytes : 0u) +
              static_cast<std::size_t>(frames) * assetChannels * sizeof(float);
          const std::size_t estimate =
              hostFootprint(frames, assetChannels, topology, engineChannels, headBlock,
                            topologyCase.pathCount, topologyCase.inputCount);
          const std::size_t actual = convolver.memoryBytes() + payload;
          IR_CHECK(estimate >= actual);
          minimumMargin = std::min(minimumMargin, estimate - actual);
        }

        {
          effetune::dsp::PartitionedConvolver convolver;
          IR_CHECK(convolver.reserve(
              footprintConfig(maximum, assetChannels, topology, engineChannels, headBlock,
                              topologyCase.pathCount, topologyCase.inputCount)));
          const std::size_t payload =
              kHeaderBytes +
              (topology == kMatrix ? topologyCase.pathCount * kPathRecordBytes : 0u) +
              static_cast<std::size_t>(maximum) * assetChannels * sizeof(float);
          const std::size_t estimate =
              hostFootprint(maximum, assetChannels, topology, engineChannels, headBlock,
                            topologyCase.pathCount, topologyCase.inputCount);
          const std::size_t actual = convolver.memoryBytes() + payload;
          IR_CHECK(estimate >= actual);
          minimumMargin = std::min(minimumMargin, estimate - actual);
        }

        Harness harness(48000.0F, engineChannels);
        std::vector<effetune::dsp::ConvolutionPath> paths;
        if (topology == kMatrix) {
          const effetune::dsp::ConvolverConfig config =
              footprintConfig(maximum, assetChannels, topology, engineChannels, headBlock,
                              topologyCase.pathCount, topologyCase.inputCount);
          paths.assign(config.paths.begin(), config.paths.begin() + config.pathCount);
        }
        IR_CHECK(harness.stageAsset(makeIr(assetChannels, maximum), assetChannels, topology,
                                    headBlock, 1u, paths, topologyCase.inputCount));
      }
    }
  }
  std::printf("IR host footprint minimum measured margin: %zu bytes\n", minimumMargin);
}

} // namespace

int main() {
  effetune::allocation_guard::setAbortOnViolationForTesting(false);
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_IRReverbPlugin();
  IR_CHECK(descriptor != nullptr);
  IR_CHECK(descriptor != nullptr && descriptor->paramsHash == 0x831d7030u);
  IR_CHECK(descriptor != nullptr && descriptor->paramsFloatCount == 6u);
  IR_CHECK(descriptor != nullptr && descriptor->assetCapacity(0u) == 32u * 1024u * 1024u);
  testDryOnlyUntilMatchingAssetIsActive();
  testReplacementAndClearWetFadeOut();
  testDirectReferenceMatrix();
  testTrueStereoReference();
  testSparseMatrixSharedInputs();
  testMalformedMatrixTables();
  testLatencyModesAndReset();
  testPredelayAndDryMix();
  testAssetReplacementAndRejection();
  testMalformedCommitAndDryMix();
  testBeginAllocationFailuresAreRecoverable();
  testPrepareAllocationFailuresAreRecoverable();
  testEngineRejectsFailedPrepareAndReusesSlot();
  testInstancePhaseStaggerPreservesOutput();
  testHostFootprintEstimatorGrid();
  return failures == 0 ? 0 : 1;
}

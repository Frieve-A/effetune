#include "prototype.h"

#include "allocation_guard.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#if defined(__EMSCRIPTEN__)
#include <emscripten/heap.h>
#endif

namespace etlc = effetune::experiments::long_convolution;

namespace {

using Clock = std::chrono::steady_clock;

struct Options {
  bool accuracy = false;
  bool benchmark = false;
  bool changePolicies = false;
  bool coResident = false;
  std::uint32_t sampleRate = 48000u;
  std::uint32_t contextRate = 0u;
  std::uint32_t channels = 2u;
  std::uint32_t irSeconds = 10u;
  std::uint32_t renderSeconds = 2u;
  std::uint32_t iterations = 1u;
  std::string partitioning = "all";
  std::string latency = "all";
  std::string output;
};

std::uint32_t parseUint(const char *value, const char *name) {
  try {
    const auto parsed = std::stoul(value);
    if (parsed == 0u || parsed > std::numeric_limits<std::uint32_t>::max())
      throw std::out_of_range(name);
    return static_cast<std::uint32_t>(parsed);
  } catch (...) {
    std::cerr << "Invalid " << name << ": " << value << '\n';
    std::exit(2);
  }
}

Options parseOptions(int argc, char **argv) {
  Options options;
  for (int index = 1; index < argc; ++index) {
    const std::string argument = argv[index];
    auto next = [&](const char *name) {
      if (++index >= argc) {
        std::cerr << "Missing value for " << name << '\n';
        std::exit(2);
      }
      return argv[index];
    };
    if (argument == "--accuracy")
      options.accuracy = true;
    else if (argument == "--benchmark")
      options.benchmark = true;
    else if (argument == "--change-policies")
      options.changePolicies = true;
    else if (argument == "--co-resident")
      options.coResident = true;
    else if (argument == "--sample-rate")
      options.sampleRate = parseUint(next("--sample-rate"), "sample rate");
    else if (argument == "--context-rate")
      options.contextRate = parseUint(next("--context-rate"), "context rate");
    else if (argument == "--channels")
      options.channels = parseUint(next("--channels"), "channel count");
    else if (argument == "--ir-seconds")
      options.irSeconds = parseUint(next("--ir-seconds"), "IR seconds");
    else if (argument == "--render-seconds")
      options.renderSeconds = parseUint(next("--render-seconds"), "render seconds");
    else if (argument == "--iterations")
      options.iterations = parseUint(next("--iterations"), "iterations");
    else if (argument == "--partitioning")
      options.partitioning = next("--partitioning");
    else if (argument == "--latency")
      options.latency = next("--latency");
    else if (argument == "--output")
      options.output = next("--output");
    else if (argument == "--help") {
      std::cout << "Usage: effetune-long-convolution-experiment [--accuracy] [--benchmark] "
                   "[--change-policies] [--co-resident] [--sample-rate N] [--context-rate N] "
                   "[--channels N] "
                   "[--ir-seconds N] "
                   "[--render-seconds N] [--iterations N] [--partitioning all|two|ladder|worker] "
                   "[--latency all|0|128|256|512|1024] [--output PATH]\n";
      std::exit(0);
    } else {
      std::cerr << "Unknown option: " << argument << '\n';
      std::exit(2);
    }
  }
  if (!options.accuracy && !options.benchmark && !options.changePolicies && !options.coResident)
    options.accuracy = true;
  return options;
}

std::uint32_t contextRate(const Options &options) noexcept {
  return options.contextRate == 0u ? options.sampleRate : options.contextRate;
}

std::uint32_t convolutionQuantum(const Options &options) {
  constexpr std::uint64_t contextQuantum = 128u;
  const std::uint64_t numerator = contextQuantum * options.sampleRate;
  const std::uint32_t rate = contextRate(options);
  if (numerator % rate != 0u || numerator / rate == 0u || numerator / rate > 128u)
    throw std::runtime_error("context/convolution rates do not produce an integral quantum");
  return static_cast<std::uint32_t>(numerator / rate);
}

std::vector<etlc::Partitioning> selectedPartitionings(const std::string &selection) {
  if (selection == "two")
    return {etlc::Partitioning::twoStage};
  if (selection == "ladder")
    return {etlc::Partitioning::ladder};
  if (selection == "worker")
    return {etlc::Partitioning::workerOffload};
  if (selection == "all")
    return {etlc::Partitioning::twoStage, etlc::Partitioning::ladder};
  std::cerr << "Invalid partitioning: " << selection << '\n';
  std::exit(2);
}

std::vector<std::uint32_t> selectedLatencies(const std::string &selection) {
  if (selection == "all")
    return {0u, 128u, 256u, 512u, 1024u};
  if (selection == "0")
    return {0u};
  const std::uint32_t latency = parseUint(selection.c_str(), "latency");
  if (latency != 128u && latency != 256u && latency != 512u && latency != 1024u) {
    std::cerr << "Invalid latency: " << latency << '\n';
    std::exit(2);
  }
  return {latency};
}

etlc::Config makeConfig(etlc::Partitioning partitioning, std::uint32_t latency,
                        std::uint32_t channels) {
  etlc::Config config;
  config.partitioning = partitioning;
  if (partitioning == etlc::Partitioning::workerOffload) {
    config.partitioning = etlc::Partitioning::ladder;
    config.stageRole = etlc::StageRole::residentHead;
  }
  config.latencySamples = latency;
  config.inputs = channels;
  config.outputs = channels;
  for (std::uint32_t channel = 0u; channel < channels; ++channel)
    config.paths[channel] = {channel, channel, channel};
  ++config.pathCount;
  return config;
}

std::uint64_t nextRandom(std::uint64_t &state) noexcept {
  state ^= state << 13u;
  state ^= state >> 7u;
  state ^= state << 17u;
  return state;
}

float randomSample(std::uint64_t &state) noexcept {
  const std::uint32_t bits = static_cast<std::uint32_t>(nextRandom(state) >> 40u);
  return static_cast<float>(bits) / 8388607.5F - 1.0F;
}

std::vector<std::vector<float>> makeIr(std::uint32_t channels, std::uint32_t frames,
                                       std::uint64_t seed = 0x4952524556455242ULL) {
  std::vector<std::vector<float>> ir(channels, std::vector<float>(frames, 0.0F));
  std::uint64_t state = seed;
  const double decay = frames > 1u ? std::log(0.0001) / static_cast<double>(frames - 1u) : 0.0;
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double envelope = std::exp(decay * static_cast<double>(frame));
      ir[channel][frame] = static_cast<float>(0.03 * envelope) * randomSample(state);
    }
    ir[channel][0u] += 0.7F;
    if (frames > 43u)
      ir[channel][43u] += 0.2F;
  }
  return ir;
}

std::vector<float> makeStimulus(std::string_view kind, std::uint32_t channels, std::uint32_t frames,
                                std::uint32_t sampleRate) {
  std::vector<float> audio(static_cast<std::size_t>(channels) * frames, 0.0F);
  std::uint64_t state = 0x5048415345304952ULL;
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      float value = 0.0F;
      if (kind == "impulse")
        value = frame == channel * 7u ? 0.8F : 0.0F;
      else if (kind == "noise")
        value = 0.2F * randomSample(state);
      else if (kind == "sweep") {
        const double t = static_cast<double>(frame) / static_cast<double>(sampleRate);
        const double phase = 6.283185307179586 * (30.0 * t + 6000.0 * t * t);
        value = static_cast<float>(0.2 * std::sin(phase));
      } else if (kind == "silence-burst" && frame >= frames / 3u && frame < frames / 3u + 64u)
        value = 0.3F * randomSample(state);
      audio[static_cast<std::size_t>(channel) * frames + frame] = value;
    }
  }
  return audio;
}

std::vector<std::vector<float>> makeSparseIr(std::uint32_t channels, std::uint32_t frames,
                                             bool replacement) {
  constexpr std::uint32_t tapFrames[] = {0u,     43u,    127u,   128u,  511u,   1023u,
                                         2047u,  4095u,  8191u,  8192u, 12287u, 16383u,
                                         32767u, 65535u, 65536u, 69999u};
  std::vector<std::vector<float>> ir(channels, std::vector<float>(frames, 0.0F));
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::size_t tap = 0u; tap < std::size(tapFrames); ++tap) {
      if (tapFrames[tap] >= frames)
        continue;
      const bool negative = ((tap + channel + (replacement ? 1u : 0u)) & 1u) != 0u;
      const float magnitude = 0.6F / static_cast<float>(tap + 1u);
      ir[channel][tapFrames[tap]] = negative ? -magnitude : magnitude;
    }
  }
  return ir;
}

std::vector<float> makeSparseStimulus(std::uint32_t channels, std::uint32_t frames,
                                      bool replacement) {
  constexpr std::uint32_t impulseFrames[] = {0u, 127u, 4097u, 16391u, 32770u, 65539u};
  std::vector<float> audio(static_cast<std::size_t>(channels) * frames, 0.0F);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::size_t impulse = 0u; impulse < std::size(impulseFrames); ++impulse) {
      const std::uint32_t frame = impulseFrames[impulse] + channel * 11u;
      if (frame >= frames)
        continue;
      const bool negative = ((impulse + channel + (replacement ? 1u : 0u)) & 1u) != 0u;
      const float magnitude = 0.7F / static_cast<float>(impulse + 1u);
      audio[static_cast<std::size_t>(channel) * frames + frame] = negative ? -magnitude : magnitude;
    }
  }
  return audio;
}

std::vector<float> renderWithBlocks(etlc::PrototypeConvolver &convolver,
                                    const std::vector<float> &input, std::uint32_t channels,
                                    std::uint32_t frames,
                                    const std::vector<std::uint32_t> &blockSizes) {
  if (blockSizes.empty())
    throw std::runtime_error("render block pattern is empty");
  std::vector<float> output(input.size(), 0.0F);
  const std::uint32_t maximumBlock = *std::max_element(blockSizes.begin(), blockSizes.end());
  std::vector<float> block(static_cast<std::size_t>(channels) * maximumBlock, 0.0F);
  std::size_t patternIndex = 0u;
  for (std::uint32_t offset = 0u; offset < frames; ++patternIndex) {
    const std::uint32_t requested = blockSizes[patternIndex % blockSizes.size()];
    if (requested == 0u)
      throw std::runtime_error("render block size is zero");
    const std::uint32_t count = frames - offset < requested ? frames - offset : requested;
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::copy_n(input.data() + static_cast<std::size_t>(channel) * frames + offset, count,
                  block.data() + static_cast<std::size_t>(channel) * count);
    }
    {
      effetune::allocation_guard::Scope guard;
      convolver.process(block.data(), channels, count);
    }
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::copy_n(block.data() + static_cast<std::size_t>(channel) * count, count,
                  output.data() + static_cast<std::size_t>(channel) * frames + offset);
    }
    offset += count;
  }
  return output;
}

std::vector<float> render(etlc::PrototypeConvolver &convolver, const std::vector<float> &input,
                          std::uint32_t channels, std::uint32_t frames, std::uint32_t blockSize) {
  return renderWithBlocks(convolver, input, channels, frames, {blockSize});
}

struct Difference {
  double maximum = 0.0;
  double rms = 0.0;
  bool finite = true;
};

Difference difference(const std::vector<float> &expected, const std::vector<float> &actual) {
  Difference result;
  double energy = 0.0;
  for (std::size_t index = 0u; index < expected.size(); ++index) {
    if (!std::isfinite(actual[index]))
      result.finite = false;
    const double error = std::abs(static_cast<double>(expected[index]) - actual[index]);
    if (error > result.maximum)
      result.maximum = error;
    energy += error * error;
  }
  result.rms = std::sqrt(energy / static_cast<double>(expected.size()));
  return result;
}

std::string runAccuracy(const Options &options) {
  constexpr std::uint32_t frames = 4096u;
  constexpr std::uint32_t irFrames = 511u;
  constexpr std::uint32_t longIrFrames = 70000u;
  constexpr std::uint32_t longRenderFrames = 100000u;
  const auto ir = makeIr(2u, irFrames);
  const std::vector<std::string_view> stimuli = {"impulse", "noise", "sweep", "silence-burst"};
  const std::vector<std::uint32_t> blockSizes = {1u, 63u, 128u, 511u};
  double maximumError = 0.0;
  double maximumRms = 0.0;
  std::uint32_t cases = 0u;
  std::uint32_t longCases = 0u;
  bool finite = true;
  const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
  auto record = [&](const Difference &measured, const etlc::PrototypeConvolver &convolver) {
    maximumError = measured.maximum > maximumError ? measured.maximum : maximumError;
    maximumRms = measured.rms > maximumRms ? measured.rms : maximumRms;
    finite = finite && measured.finite && !convolver.sawNonFinite();
    ++cases;
  };

  for (const auto partitioning : selectedPartitionings(options.partitioning)) {
    for (const auto latency : selectedLatencies(options.latency)) {
      const auto config = makeConfig(partitioning, latency, 2u);
      const auto impulse = makeStimulus("impulse", 2u, frames, 48000u);
      const auto impulseReference = etlc::directReference(config, ir, impulse, frames);
      for (const std::uint32_t blockSize : blockSizes) {
        etlc::PrototypeConvolver convolver;
        if (!convolver.prepare(config, ir))
          throw std::runtime_error("accuracy prepare failed");
        const auto output = render(convolver, impulse, 2u, frames, blockSize);
        record(difference(impulseReference, output), convolver);
      }
      const bool boundaryMatrixLatency = latency == 0u || latency == 128u || latency == 1024u;
      if (boundaryMatrixLatency) {
        for (const auto stimulus : stimuli) {
          const auto input = makeStimulus(stimulus, 2u, frames, 48000u);
          const auto reference = etlc::directReference(config, ir, input, frames);
          for (const std::uint32_t blockSize : blockSizes) {
            etlc::PrototypeConvolver convolver;
            if (!convolver.prepare(config, ir))
              throw std::runtime_error("stimulus prepare failed");
            const auto output = render(convolver, input, 2u, frames, blockSize);
            record(difference(reference, output), convolver);
          }
        }

        const auto noise = makeStimulus("noise", 2u, frames, 48000u);
        const auto warmInput = makeStimulus("noise", 2u, frames / 2u, 48000u);
        const auto resetReference = etlc::directReference(config, ir, noise, frames);
        const auto replacementIr = makeIr(2u, irFrames, 0x5245504c41434531ULL);
        const auto replacementReference =
            etlc::directReference(config, replacementIr, impulse, frames);
        for (const std::uint32_t blockSize : blockSizes) {
          etlc::PrototypeConvolver resetConvolver;
          if (!resetConvolver.prepare(config, ir))
            throw std::runtime_error("reset prepare failed");
          static_cast<void>(render(resetConvolver, warmInput, 2u, frames / 2u, blockSize));
          resetConvolver.reset();
          const auto resetOutput = render(resetConvolver, noise, 2u, frames, blockSize);
          record(difference(resetReference, resetOutput), resetConvolver);

          if (!resetConvolver.prepare(config, replacementIr))
            throw std::runtime_error("replacement prepare failed");
          const auto replacementOutput = render(resetConvolver, impulse, 2u, frames, blockSize);
          record(difference(replacementReference, replacementOutput), resetConvolver);
        }
      }

      if (latency == 128u) {
        constexpr std::uint32_t wrapFrames = 30000u;
        const auto longIr = makeIr(2u, 20000u, 0x5752415050415254ULL);
        std::vector<float> sparseInput(2u * wrapFrames, 0.0F);
        sparseInput[0u] = 0.8F;
        sparseInput[10000u] = -0.3F;
        sparseInput[wrapFrames + 17u] = 0.6F;
        sparseInput[wrapFrames + 12000u] = 0.25F;
        const auto wrapReference = etlc::directReference(config, longIr, sparseInput, wrapFrames);
        etlc::PrototypeConvolver wrapConvolver;
        if (!wrapConvolver.prepare(config, longIr))
          throw std::runtime_error("partition-wrap prepare failed");
        const auto wrapOutput = render(wrapConvolver, sparseInput, 2u, wrapFrames, 63u);
        record(difference(wrapReference, wrapOutput), wrapConvolver);
      }

      if (latency == 128u || latency == 1024u) {
        const auto longIr = makeSparseIr(2u, longIrFrames, false);
        const auto replacementIr = makeSparseIr(2u, longIrFrames, true);
        const auto sparseInput = makeSparseStimulus(2u, longRenderFrames, false);
        const auto replacementInput = makeSparseStimulus(2u, longRenderFrames, true);
        const auto reference = etlc::directReference(config, longIr, sparseInput, longRenderFrames);
        const auto replacementReference =
            etlc::directReference(config, replacementIr, replacementInput, longRenderFrames);
        const std::vector<std::uint32_t> variableBlocks = {1u, 63u, 128u, 511u, 17u, 255u};

        etlc::PrototypeConvolver convolver;
        if (!convolver.prepare(config, longIr))
          throw std::runtime_error("long-tail prepare failed");
        auto output =
            renderWithBlocks(convolver, sparseInput, 2u, longRenderFrames, variableBlocks);
        record(difference(reference, output), convolver);
        ++longCases;

        const auto warmInput = makeSparseStimulus(2u, 20000u, true);
        static_cast<void>(renderWithBlocks(convolver, warmInput, 2u, 20000u, variableBlocks));
        convolver.reset();
        output = renderWithBlocks(convolver, sparseInput, 2u, longRenderFrames, variableBlocks);
        record(difference(reference, output), convolver);
        ++longCases;

        if (!convolver.prepare(config, replacementIr))
          throw std::runtime_error("long-tail replacement prepare failed");
        output =
            renderWithBlocks(convolver, replacementInput, 2u, longRenderFrames, variableBlocks);
        record(difference(replacementReference, output), convolver);
        ++longCases;
      }
    }
  }

  const std::uint32_t allocationAfter = effetune::allocation_guard::violationCount();
  const bool pass = finite && maximumError <= 2.0e-4 && allocationAfter == allocationBefore;
  std::ostringstream json;
  json << std::setprecision(9) << "{\"kind\":\"accuracy\",\"pass\":" << (pass ? "true" : "false")
       << ",\"cases\":" << cases << ",\"longCases\":" << longCases
       << ",\"longIrFrames\":" << longIrFrames << ",\"longRenderFrames\":" << longRenderFrames
       << ",\"maxAbsError\":" << maximumError << ",\"maxRmsError\":" << maximumRms
       << ",\"finite\":" << (finite ? "true" : "false")
       << ",\"allocationViolations\":" << (allocationAfter - allocationBefore) << '}';
  return json.str();
}

double median(std::vector<double> values) {
  std::sort(values.begin(), values.end());
  const std::size_t middle = values.size() / 2u;
  return values.size() % 2u == 0u ? (values[middle - 1u] + values[middle]) * 0.5 : values[middle];
}

std::size_t irBytes(const std::vector<std::vector<float>> &ir) {
  std::size_t bytes = 0u;
  for (const auto &channel : ir)
    bytes += channel.size() * sizeof(float);
  return bytes;
}

std::string benchmarkOne(const Options &options, etlc::Partitioning partitioning,
                         std::uint32_t latency) {
  const std::uint32_t irFrames = options.sampleRate * options.irSeconds;
  const auto ir = makeIr(options.channels, irFrames);
  const auto config = makeConfig(partitioning, latency, options.channels);
  etlc::PrototypeConvolver convolver;
  const auto prepareStarted = Clock::now();
  if (!convolver.prepare(config, ir))
    throw std::runtime_error("benchmark prepare failed");
  const double prepareMilliseconds =
      std::chrono::duration<double, std::milli>(Clock::now() - prepareStarted).count();
  const std::size_t footprint = convolver.memoryBytes() + irBytes(ir);

  const std::uint32_t quantum = convolutionQuantum(options);
  std::vector<float> block(static_cast<std::size_t>(options.channels) * quantum, 0.0F);
  std::uint64_t state = 0x42454e43484d4152ULL;
  std::vector<double> timings;
  timings.reserve(static_cast<std::size_t>(options.iterations) * options.renderSeconds *
                      options.sampleRate / quantum +
                  1u);
  const std::uint32_t quanta = options.renderSeconds * options.sampleRate / quantum;
  const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
  for (std::uint32_t iteration = 0u; iteration < options.iterations; ++iteration) {
    convolver.reset();
    for (std::uint32_t index = 0u; index < quanta; ++index) {
      for (float &sample : block)
        sample = 0.1F * randomSample(state);
      const auto started = Clock::now();
      {
        effetune::allocation_guard::Scope guard;
        convolver.process(block.data(), options.channels, quantum);
      }
      const double microseconds =
          std::chrono::duration<double, std::micro>(Clock::now() - started).count();
      timings.push_back(microseconds);
    }
  }
  const std::uint32_t allocationAfter = effetune::allocation_guard::violationCount();
  const double worst = *std::max_element(timings.begin(), timings.end());
  const double deadlineMicroseconds = 1.0e6 * 128.0 / contextRate(options);
  double totalProcessMicroseconds = 0.0;
  for (const double timing : timings)
    totalProcessMicroseconds += timing;
#if defined(__EMSCRIPTEN__)
  const std::size_t heapBytes = emscripten_get_heap_size();
#else
  const std::size_t heapBytes = 0u;
#endif
  std::ostringstream json;
  json << std::setprecision(9) << "{\"kind\":\"benchmark\",\"partitioning\":\""
       << etlc::partitioningName(partitioning) << "\",\"latency\":" << latency << ",\"scope\":\""
       << (partitioning == etlc::Partitioning::workerOffload ? "resident-head" : "complete") << "\""
       << ",\"sampleRate\":" << options.sampleRate << ",\"contextRate\":" << contextRate(options)
       << ",\"quantumFrames\":" << quantum << ",\"channels\":" << options.channels
       << ",\"irSeconds\":" << options.irSeconds << ",\"renderSeconds\":" << options.renderSeconds
       << ",\"medianQuantumUs\":" << median(timings) << ",\"worstQuantumUs\":" << worst
       << ",\"halfDeadlineUs\":" << deadlineMicroseconds * 0.5
       << ",\"totalProcessMs\":" << totalProcessMicroseconds * 0.001
       << ",\"prepareMs\":" << prepareMilliseconds << ",\"footprintBytes\":" << footprint
       << ",\"wasmHeapBytes\":" << heapBytes
       << ",\"allocationViolations\":" << (allocationAfter - allocationBefore)
       << ",\"finite\":" << (!convolver.sawNonFinite() ? "true" : "false") << '}';
  return json.str();
}

std::string measureChangePolicies(const Options &options, etlc::Partitioning partitioning) {
  constexpr std::uint32_t latency = 128u;
  const std::uint32_t irFrames = options.sampleRate * options.irSeconds;
  const auto firstIr = makeIr(options.channels, irFrames);
  const auto secondIr = makeIr(options.channels, irFrames, 0x4348414e47454952ULL);
  const auto config = makeConfig(partitioning, latency, options.channels);
  etlc::PrototypeConvolver current;
  if (!current.prepare(config, firstIr))
    throw std::runtime_error("change-policy initial prepare failed");
  const std::size_t oldBytes = current.memoryBytes();

  const auto hardStarted = Clock::now();
  if (!current.prepare(config, secondIr))
    throw std::runtime_error("hard replacement prepare failed");
  const double hardPrepareMs =
      std::chrono::duration<double, std::milli>(Clock::now() - hardStarted).count();
  const std::size_t hardPeakBytes = current.memoryBytes() + irBytes(secondIr);

  etlc::PrototypeConvolver oldEngine;
  if (!oldEngine.prepare(config, firstIr))
    throw std::runtime_error("crossfade old prepare failed");
  const auto crossPrepareStarted = Clock::now();
  etlc::PrototypeConvolver newEngine;
  if (!newEngine.prepare(config, secondIr))
    throw std::runtime_error("crossfade new prepare failed");
  const double crossPrepareMs =
      std::chrono::duration<double, std::milli>(Clock::now() - crossPrepareStarted).count();
  const std::size_t crossPeakBytes =
      oldEngine.memoryBytes() + newEngine.memoryBytes() + irBytes(firstIr) + irBytes(secondIr);

  const std::uint32_t quantum = convolutionQuantum(options);
  std::vector<float> firstBlock(static_cast<std::size_t>(options.channels) * quantum, 0.1F);
  std::vector<float> secondBlock = firstBlock;
  std::vector<double> timings;
  timings.reserve(256u);
  for (std::uint32_t index = 0u; index < 256u; ++index) {
    const auto started = Clock::now();
    oldEngine.process(firstBlock.data(), options.channels, quantum);
    newEngine.process(secondBlock.data(), options.channels, quantum);
    timings.push_back(std::chrono::duration<double, std::micro>(Clock::now() - started).count());
  }
  const double crossWorst = *std::max_element(timings.begin(), timings.end());
#if defined(__EMSCRIPTEN__)
  const std::size_t heapBytes = emscripten_get_heap_size();
#else
  const std::size_t heapBytes = 0u;
#endif
  std::ostringstream json;
  json << std::setprecision(9) << "{\"kind\":\"change-policies\",\"partitioning\":\""
       << etlc::partitioningName(partitioning) << "\",\"sampleRate\":" << options.sampleRate
       << ",\"contextRate\":" << contextRate(options) << ",\"quantumFrames\":" << quantum
       << ",\"channels\":" << options.channels << ",\"irSeconds\":" << options.irSeconds
       << ",\"hardPrepareMs\":" << hardPrepareMs << ",\"hardPeakBytes\":" << hardPeakBytes
       << ",\"crossfadePrepareMs\":" << crossPrepareMs
       << ",\"crossfadePeakBytes\":" << crossPeakBytes
       << ",\"crossfadeMedianQuantumUs\":" << median(timings)
       << ",\"crossfadeWorstQuantumUs\":" << crossWorst << ",\"oldSteadyBytes\":" << oldBytes
       << ",\"wasmHeapBytes\":" << heapBytes << '}';
  return json.str();
}

std::string measureCoResident(const Options &options, etlc::Partitioning partitioning,
                              bool staggered) {
  constexpr std::uint32_t instances = 3u;
  constexpr std::uint32_t latency = 128u;
  const std::uint32_t irFrames = options.sampleRate * options.irSeconds;
  const auto ir = makeIr(options.channels, irFrames);
  std::vector<etlc::PrototypeConvolver> engines;
  engines.reserve(instances);
  std::size_t algorithmBytes = 0u;
  for (std::uint32_t index = 0u; index < instances; ++index) {
    auto config = makeConfig(partitioning, latency, options.channels);
    config.sliceOffset = staggered ? index * 7u : 0u;
    engines.emplace_back();
    if (!engines.back().prepare(config, ir))
      throw std::runtime_error("co-resident prepare failed");
    algorithmBytes += engines.back().memoryBytes();
  }

  const std::uint32_t quantum = convolutionQuantum(options);
  const std::uint32_t quanta = options.renderSeconds * options.sampleRate / quantum;
  std::vector<std::vector<float>> blocks(
      instances, std::vector<float>(static_cast<std::size_t>(options.channels) * quantum, 0.0F));
  std::vector<double> timings;
  timings.reserve(quanta);
  std::uint64_t state = 0x434f524553494445ULL;
  const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
  for (std::uint32_t index = 0u; index < quanta; ++index) {
    for (auto &block : blocks) {
      for (float &sample : block)
        sample = 0.1F * randomSample(state);
    }
    const auto started = Clock::now();
    {
      effetune::allocation_guard::Scope guard;
      for (std::uint32_t instance = 0u; instance < instances; ++instance)
        engines[instance].process(blocks[instance].data(), options.channels, quantum);
    }
    timings.push_back(std::chrono::duration<double, std::micro>(Clock::now() - started).count());
  }
  const std::uint32_t allocationAfter = effetune::allocation_guard::violationCount();
  double totalProcessMicroseconds = 0.0;
  bool finite = true;
  for (const double timing : timings)
    totalProcessMicroseconds += timing;
  for (const auto &engine : engines)
    finite = finite && !engine.sawNonFinite();
#if defined(__EMSCRIPTEN__)
  const std::size_t heapBytes = emscripten_get_heap_size();
#else
  const std::size_t heapBytes = 0u;
#endif
  std::ostringstream json;
  json << std::setprecision(9) << "{\"kind\":\"co-resident\",\"partitioning\":\""
       << etlc::partitioningName(partitioning) << "\",\"scheduling\":\""
       << (staggered ? "staggered" : "in-phase") << "\",\"instances\":" << instances
       << ",\"sampleRate\":" << options.sampleRate << ",\"contextRate\":" << contextRate(options)
       << ",\"quantumFrames\":" << quantum << ",\"channels\":" << options.channels
       << ",\"irSeconds\":" << options.irSeconds << ",\"medianQuantumUs\":" << median(timings)
       << ",\"worstQuantumUs\":" << *std::max_element(timings.begin(), timings.end())
       << ",\"halfDeadlineUs\":" << 1.0e6 * 64.0 / contextRate(options)
       << ",\"totalProcessMs\":" << totalProcessMicroseconds * 0.001
       << ",\"algorithmBytes\":" << algorithmBytes << ",\"rawIrBytes\":" << irBytes(ir)
       << ",\"wasmHeapBytes\":" << heapBytes
       << ",\"allocationViolations\":" << (allocationAfter - allocationBefore)
       << ",\"finite\":" << (finite ? "true" : "false") << '}';
  return json.str();
}

} // namespace

int main(int argc, char **argv) {
  try {
    const Options options = parseOptions(argc, argv);
    std::vector<std::string> records;
    if (options.accuracy)
      records.push_back(runAccuracy(options));
    if (options.benchmark) {
      for (const auto partitioning : selectedPartitionings(options.partitioning)) {
        for (const auto latency : selectedLatencies(options.latency))
          records.push_back(benchmarkOne(options, partitioning, latency));
      }
    }
    if (options.changePolicies) {
      for (const auto partitioning : selectedPartitionings(options.partitioning))
        records.push_back(measureChangePolicies(options, partitioning));
    }
    if (options.coResident) {
      for (const auto partitioning : selectedPartitionings(options.partitioning)) {
        records.push_back(measureCoResident(options, partitioning, false));
        records.push_back(measureCoResident(options, partitioning, true));
      }
    }
    std::ostringstream output;
    output << "[\n";
    for (std::size_t index = 0u; index < records.size(); ++index)
      output << "  " << records[index] << (index + 1u == records.size() ? "\n" : ",\n");
    output << "]\n";
    if (!options.output.empty()) {
      std::ofstream file(options.output, std::ios::binary);
      if (!file)
        throw std::runtime_error("unable to open output file");
      file << output.str();
    }
    std::cout << output.str();
    return 0;
  } catch (const std::exception &error) {
    std::cerr << "Long-convolution experiment failed: " << error.what() << '\n';
    return 1;
  }
}

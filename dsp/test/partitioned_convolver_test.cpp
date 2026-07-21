#include "allocation_guard.h"
#include "effetune/dsp/partitioned_convolver.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

namespace {

using effetune::dsp::ConvolutionPath;
using effetune::dsp::ConvolverConfig;
using effetune::dsp::ConvolverPreparationState;
using effetune::dsp::PartitionedConvolver;

int failures = 0;

void check(bool condition, const char *expression, int line) {
  if (condition)
    return;
  std::fprintf(stderr, "partitioned convolver check failed at line %d: %s\n", line, expression);
  ++failures;
}

#define CONVOLVER_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

ConvolverConfig makeConfig(std::uint32_t irFrames, std::uint32_t sliceOffset = 0u) {
  ConvolverConfig config;
  config.latencySamples = 128u;
  config.sliceOffset = sliceOffset;
  config.inputs = 2u;
  config.outputs = 2u;
  config.irChannels = 2u;
  config.irFrames = irFrames;
  config.pathCount = 2u;
  config.paths[0u] = {0u, 0u, 0u};
  config.paths[1u] = {1u, 1u, 1u};
  return config;
}

std::vector<float> makeSparseIr(std::uint32_t frames) {
  constexpr std::uint32_t taps[] = {0u,    43u,   127u,   128u,   511u,   1023u,  2047u, 4095u,
                                    8191u, 8192u, 16383u, 19999u, 32767u, 65535u, 69999u};
  std::vector<float> ir(2u * frames, 0.0F);
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::size_t index = 0u; index < std::size(taps); ++index) {
      if (taps[index] >= frames)
        continue;
      const float magnitude = 0.7F / static_cast<float>(index + 1u);
      ir[static_cast<std::size_t>(channel) * frames + taps[index]] =
          ((index + channel) & 1u) == 0u ? magnitude : -magnitude;
    }
  }
  return ir;
}

std::vector<float> makeSparseInput(std::uint32_t frames) {
  constexpr std::uint32_t impulses[] = {0u, 127u, 4097u, 16391u, 25003u};
  std::vector<float> input(2u * frames, 0.0F);
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::size_t index = 0u; index < std::size(impulses); ++index) {
      const std::uint32_t frame = impulses[index] + channel * 11u;
      if (frame < frames) {
        const float magnitude = 0.6F / static_cast<float>(index + 1u);
        input[static_cast<std::size_t>(channel) * frames + frame] =
            ((index + channel) & 1u) == 0u ? magnitude : -magnitude;
      }
    }
  }
  return input;
}

std::vector<float> directReference(const ConvolverConfig &config, const std::vector<float> &ir,
                                   const std::vector<float> &input, std::uint32_t frames) {
  std::vector<double> reference(static_cast<std::size_t>(config.outputs) * frames, 0.0);
  for (std::uint32_t pathIndex = 0u; pathIndex < config.pathCount; ++pathIndex) {
    const ConvolutionPath &path = config.paths[pathIndex];
    for (std::uint32_t inputFrame = 0u; inputFrame < frames; ++inputFrame) {
      const float sample = input[static_cast<std::size_t>(path.input) * frames + inputFrame];
      if (sample == 0.0F)
        continue;
      for (std::uint32_t tap = 0u; tap < config.irFrames; ++tap) {
        const std::uint64_t outputFrame =
            static_cast<std::uint64_t>(inputFrame) + tap + config.latencySamples;
        if (outputFrame >= frames)
          break;
        reference[static_cast<std::size_t>(path.output) * frames + outputFrame] +=
            static_cast<double>(sample) *
            ir[static_cast<std::size_t>(path.irChannel) * config.irFrames + tap];
      }
    }
  }
  std::vector<float> output(reference.size(), 0.0F);
  for (std::size_t index = 0u; index < output.size(); ++index)
    output[index] = static_cast<float>(reference[index]);
  return output;
}

std::vector<float> render(PartitionedConvolver &convolver, const std::vector<float> &input,
                          std::uint32_t frames) {
  constexpr std::uint32_t blockPattern[] = {1u, 63u, 128u, 511u, 17u, 255u};
  constexpr std::uint32_t maximumBlock = 511u;
  std::vector<float> output(input.size(), 0.0F);
  std::vector<float> block(2u * maximumBlock, 0.0F);
  std::size_t patternIndex = 0u;
  for (std::uint32_t offset = 0u; offset < frames; ++patternIndex) {
    const std::uint32_t requested = blockPattern[patternIndex % std::size(blockPattern)];
    const std::uint32_t count = frames - offset < requested ? frames - offset : requested;
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      std::copy_n(input.data() + static_cast<std::size_t>(channel) * frames + offset, count,
                  block.data() + static_cast<std::size_t>(channel) * count);
    }
    {
      effetune::allocation_guard::Scope guard;
      convolver.process(block.data(), 2u, count);
    }
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      std::copy_n(block.data() + static_cast<std::size_t>(channel) * count, count,
                  output.data() + static_cast<std::size_t>(channel) * frames + offset);
    }
    offset += count;
  }
  return output;
}

void prepareToActive(PartitionedConvolver &convolver, std::uint32_t budget) {
  std::uint32_t slices = 0u;
  while (convolver.state() == ConvolverPreparationState::preparing && slices < 100000u) {
    effetune::allocation_guard::Scope guard;
    convolver.prepareSlice(budget);
    ++slices;
  }
  CONVOLVER_CHECK(convolver.state() == ConvolverPreparationState::active);
  CONVOLVER_CHECK(slices < 100000u);
}

void testIncrementalPreparationAndAllocationGuard() {
  constexpr std::uint32_t irFrames = 70000u;
  const ConvolverConfig config = makeConfig(irFrames);
  const std::vector<float> ir = makeSparseIr(irFrames);
  PartitionedConvolver convolver;
  CONVOLVER_CHECK(convolver.reserve(config));
  CONVOLVER_CHECK(convolver.state() == ConvolverPreparationState::reserved);
  CONVOLVER_CHECK(convolver.memoryBytes() > ir.size() * sizeof(float));

  const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
  {
    effetune::allocation_guard::Scope guard;
    CONVOLVER_CHECK(convolver.commit(ir.data(), 2u, irFrames));
  }
  CONVOLVER_CHECK(convolver.state() == ConvolverPreparationState::preparing);
  CONVOLVER_CHECK(convolver.prepareSlice(0u) == ConvolverPreparationState::preparing);

  std::vector<float> block(2u * 128u, 0.25F);
  {
    effetune::allocation_guard::Scope guard;
    convolver.process(block.data(), 2u, 128u);
  }
  CONVOLVER_CHECK(convolver.state() == ConvolverPreparationState::preparing);
  CONVOLVER_CHECK(
      std::all_of(block.begin(), block.end(), [](float sample) { return sample == 0.0F; }));

  std::uint32_t processCalls = 1u;
  while (convolver.state() == ConvolverPreparationState::preparing && processCalls < 1000u) {
    std::fill(block.begin(), block.end(), 0.25F);
    {
      effetune::allocation_guard::Scope guard;
      convolver.process(block.data(), 2u, 128u);
    }
    if (convolver.state() == ConvolverPreparationState::preparing) {
      CONVOLVER_CHECK(
          std::all_of(block.begin(), block.end(), [](float sample) { return sample == 0.0F; }));
    }
    ++processCalls;
  }
  CONVOLVER_CHECK(convolver.state() == ConvolverPreparationState::active);
  CONVOLVER_CHECK(processCalls > 1u);
  CONVOLVER_CHECK(processCalls < 1000u);
  CONVOLVER_CHECK(effetune::allocation_guard::violationCount() == allocationBefore);

  convolver.reset();
  CONVOLVER_CHECK(convolver.state() == ConvolverPreparationState::active);
  convolver.clear();
  CONVOLVER_CHECK(convolver.state() == ConvolverPreparationState::empty);
}

void testReferenceParityAndReset() {
  constexpr std::uint32_t irFrames = 20000u;
  constexpr std::uint32_t renderFrames = 30000u;
  const ConvolverConfig config = makeConfig(irFrames);
  const std::vector<float> ir = makeSparseIr(irFrames);
  const std::vector<float> input = makeSparseInput(renderFrames);
  const std::vector<float> reference = directReference(config, ir, input, renderFrames);
  PartitionedConvolver convolver;
  CONVOLVER_CHECK(convolver.reserve(config));
  CONVOLVER_CHECK(convolver.commit(ir.data(), 2u, irFrames));
  prepareToActive(convolver, 3u);
  convolver.reset();

  const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
  const std::vector<float> first = render(convolver, input, renderFrames);
  convolver.reset();
  const std::vector<float> second = render(convolver, input, renderFrames);
  CONVOLVER_CHECK(first == second);
  CONVOLVER_CHECK(effetune::allocation_guard::violationCount() == allocationBefore);

  double maximumError = 0.0;
  for (std::size_t index = 0u; index < reference.size(); ++index) {
    const double error = std::abs(static_cast<double>(reference[index]) - first[index]);
    maximumError = error > maximumError ? error : maximumError;
    CONVOLVER_CHECK(std::isfinite(first[index]));
  }
  CONVOLVER_CHECK(maximumError <= 2.0e-4);
}

void testReservedPathUpdateWithoutAllocation() {
  constexpr std::uint32_t irFrames = 20000u;
  constexpr std::uint32_t renderFrames = 24000u;
  ConvolverConfig config = makeConfig(irFrames);
  const std::vector<float> ir = makeSparseIr(irFrames);
  const std::vector<float> input = makeSparseInput(renderFrames);
  PartitionedConvolver convolver;
  CONVOLVER_CHECK(convolver.reserve(config));

  const ConvolutionPath updatedPaths[] = {{0u, 1u, 1u}, {1u, 0u, 0u}};
  const ConvolutionPath invalidPath[] = {{2u, 0u, 0u}, {1u, 1u, 1u}};
  CONVOLVER_CHECK(!convolver.updatePathsWithoutAllocation(updatedPaths, 1u));
  CONVOLVER_CHECK(!convolver.updatePathsWithoutAllocation(invalidPath, 2u));
  const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
  {
    effetune::allocation_guard::Scope guard;
    CONVOLVER_CHECK(convolver.updatePathsWithoutAllocation(updatedPaths, 2u));
  }
  CONVOLVER_CHECK(effetune::allocation_guard::violationCount() == allocationBefore);

  for (std::uint32_t index = 0u; index < config.pathCount; ++index)
    config.paths[index] = updatedPaths[index];
  const std::vector<float> reference = directReference(config, ir, input, renderFrames);
  CONVOLVER_CHECK(convolver.commit(ir.data(), 2u, irFrames));
  CONVOLVER_CHECK(!convolver.updatePathsWithoutAllocation(updatedPaths, 2u));
  prepareToActive(convolver, 3u);
  const std::vector<float> output = render(convolver, input, renderFrames);
  double maximumError = 0.0;
  for (std::size_t index = 0u; index < reference.size(); ++index) {
    const double error = std::abs(static_cast<double>(reference[index]) - output[index]);
    maximumError = error > maximumError ? error : maximumError;
  }
  CONVOLVER_CHECK(maximumError <= 2.0e-4);
}

void testPreparationPhaseStaggerPreservesActivationTiming() {
  constexpr std::uint32_t irFrames = 16384u;
  ConvolverConfig inPhaseConfig;
  inPhaseConfig.latencySamples = 256u;
  inPhaseConfig.sliceOffset = 0u;
  inPhaseConfig.inputs = 1u;
  inPhaseConfig.outputs = 1u;
  inPhaseConfig.irChannels = 1u;
  inPhaseConfig.irFrames = irFrames;
  inPhaseConfig.pathCount = 1u;
  inPhaseConfig.paths[0u] = {0u, 0u, 0u};
  ConvolverConfig staggeredConfig = inPhaseConfig;
  staggeredConfig.sliceOffset = 5u;

  std::vector<float> ir(irFrames, 0.0F);
  ir[0u] = 1.0F;
  ir[8192u] = 0.25F;
  PartitionedConvolver inPhase;
  PartitionedConvolver staggered;
  CONVOLVER_CHECK(inPhase.reserve(inPhaseConfig));
  CONVOLVER_CHECK(staggered.reserve(staggeredConfig));
  CONVOLVER_CHECK(inPhase.commit(ir.data(), 1u, irFrames));
  CONVOLVER_CHECK(staggered.commit(ir.data(), 1u, irFrames));

  // The first ten partitions cover the 256..2048 stages. Both cursors now point at
  // the two final 4096-sample partitions, whose preparation FFT size is 8192.
  CONVOLVER_CHECK(inPhase.prepareSlice(10u) == ConvolverPreparationState::preparing);
  CONVOLVER_CHECK(staggered.prepareSlice(10u) == ConvolverPreparationState::preparing);
  std::vector<float> block(128u, 1.0F);
  const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
  {
    effetune::allocation_guard::Scope guard;
    inPhase.process(block.data(), 1u, 128u);
    staggered.process(block.data(), 1u, 128u);
  }
  CONVOLVER_CHECK(inPhase.state() == ConvolverPreparationState::preparing);
  CONVOLVER_CHECK(staggered.state() == ConvolverPreparationState::preparing);
  CONVOLVER_CHECK(
      std::all_of(block.begin(), block.end(), [](float sample) { return sample == 0.0F; }));

  std::fill(block.begin(), block.end(), 1.0F);
  {
    effetune::allocation_guard::Scope guard;
    inPhase.process(block.data(), 1u, 128u);
    staggered.process(block.data(), 1u, 128u);
  }
  CONVOLVER_CHECK(inPhase.state() == ConvolverPreparationState::active);
  CONVOLVER_CHECK(staggered.state() == ConvolverPreparationState::active);
  CONVOLVER_CHECK(
      std::all_of(block.begin(), block.end(), [](float sample) { return sample == 0.0F; }));
  CONVOLVER_CHECK(effetune::allocation_guard::violationCount() == allocationBefore);
}

void testStaggeredInstances() {
  constexpr std::uint32_t irFrames = 20000u;
  constexpr std::uint32_t renderFrames = 30000u;
  const std::vector<float> ir = makeSparseIr(irFrames);
  PartitionedConvolver first;
  PartitionedConvolver second;
  CONVOLVER_CHECK(first.reserve(makeConfig(irFrames, 0u)));
  CONVOLVER_CHECK(second.reserve(makeConfig(irFrames, 5u)));
  CONVOLVER_CHECK(first.commit(ir.data(), 2u, irFrames));
  CONVOLVER_CHECK(second.commit(ir.data(), 2u, irFrames));

  const auto started = std::chrono::steady_clock::now();
  std::vector<float> silence(2u * 128u, 0.0F);
  std::uint32_t quanta = 0u;
  const std::uint32_t allocationBefore = effetune::allocation_guard::violationCount();
  while ((first.state() == ConvolverPreparationState::preparing ||
          second.state() == ConvolverPreparationState::preparing) &&
         quanta < 1000u) {
    {
      effetune::allocation_guard::Scope guard;
      first.process(silence.data(), 2u, 128u);
      second.process(silence.data(), 2u, 128u);
    }
    ++quanta;
  }
  const double preparationMilliseconds =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
  CONVOLVER_CHECK(first.state() == ConvolverPreparationState::active);
  CONVOLVER_CHECK(second.state() == ConvolverPreparationState::active);
  CONVOLVER_CHECK(quanta > 1u && quanta < 1000u);
  CONVOLVER_CHECK(effetune::allocation_guard::violationCount() == allocationBefore);

  first.reset();
  second.reset();
  const std::vector<float> input = makeSparseInput(renderFrames);
  const std::vector<float> firstOutput = render(first, input, renderFrames);
  const std::vector<float> secondOutput = render(second, input, renderFrames);
  CONVOLVER_CHECK(firstOutput == secondOutput);
  std::printf("partitioned convolver: two-instance preparation %.3f ms in %u quanta\n",
              preparationMilliseconds, quanta);
}

void testMemoryAccountingScalesWithIrCapacity() {
  PartitionedConvolver small;
  PartitionedConvolver large;
  CONVOLVER_CHECK(small.reserve(makeConfig(1000u)));
  CONVOLVER_CHECK(large.reserve(makeConfig(20000u)));
  CONVOLVER_CHECK(small.memoryBytes() > sizeof(PartitionedConvolver));
  CONVOLVER_CHECK(large.memoryBytes() > small.memoryBytes());
  CONVOLVER_CHECK(large.memoryBytes() + 2u * 20000u * sizeof(float) < 32u * 1024u * 1024u);
}

} // namespace

int main() {
  testIncrementalPreparationAndAllocationGuard();
  testReferenceParityAndReset();
  testReservedPathUpdateWithoutAllocation();
  testPreparationPhaseStaggerPreservesActivationTiming();
  testStaggeredInstances();
  testMemoryAccountingScalesWithIrCapacity();
  return failures == 0 ? 0 : 1;
}

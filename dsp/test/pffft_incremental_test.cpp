#include "effetune/dsp/pffft_incremental.h"

#include "pffft.h"

#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <utility>

namespace {

int failures = 0;
constexpr int kMaximumTransformSteps = 1024;
double maximumBackwardStepMicroseconds = 0.0;

#define PFFFT_INCREMENTAL_CHECK(condition)                                                         \
  do {                                                                                             \
    if (!(condition)) {                                                                            \
      std::fprintf(stderr, "PFFFT incremental check failed: %s:%d: %s\n", __FILE__, __LINE__,      \
                   #condition);                                                                    \
      ++failures;                                                                                  \
    }                                                                                              \
  } while (false)

class AlignedFloats final {
public:
  explicit AlignedFloats(int count) noexcept
      : data_(static_cast<float *>(pffft_aligned_malloc(sizeof(float) * count))) {}

  ~AlignedFloats() { pffft_aligned_free(data_); }

  AlignedFloats(const AlignedFloats &) = delete;
  AlignedFloats &operator=(const AlignedFloats &) = delete;

  [[nodiscard]] float *data() noexcept { return data_; }
  [[nodiscard]] const float *data() const noexcept { return data_; }

private:
  float *data_ = nullptr;
};

void fillInput(float *input, int points, int sequence) {
  for (int index = 0; index < points; ++index) {
    const double phase = static_cast<double>(index + sequence * 7);
    input[index] =
        static_cast<float>(0.37 * std::sin(phase * 0.013) + 0.19 * std::cos(phase * 0.071) +
                           static_cast<double>((index * 29 + sequence * 11) % 37 - 18) * 0.001);
  }
}

void verifyTransform(int points, int sequence, int workBudget, double &maximumStepMicroseconds) {
  PFFFT_Setup *setup = pffft_new_setup(points, PFFFT_REAL);
  PFFFT_INCREMENTAL_CHECK(setup != nullptr);
  if (setup == nullptr)
    return;

  AlignedFloats input(points);
  AlignedFloats directOutput(points);
  AlignedFloats directWork(points);
  AlignedFloats incrementalOutput(points);
  AlignedFloats incrementalWork(points);
  AlignedFloats secondInput(points);
  AlignedFloats secondSpectrum(points);
  AlignedFloats secondWork(points);
  AlignedFloats directInverse(points);
  AlignedFloats incrementalInverse(points);
  AlignedFloats directAccumulator(points);
  AlignedFloats incrementalAccumulator(points);
  PFFFT_INCREMENTAL_CHECK(input.data() != nullptr);
  PFFFT_INCREMENTAL_CHECK(directOutput.data() != nullptr);
  PFFFT_INCREMENTAL_CHECK(directWork.data() != nullptr);
  PFFFT_INCREMENTAL_CHECK(incrementalOutput.data() != nullptr);
  PFFFT_INCREMENTAL_CHECK(incrementalWork.data() != nullptr);
  if (input.data() == nullptr || directOutput.data() == nullptr || directWork.data() == nullptr ||
      incrementalOutput.data() == nullptr || incrementalWork.data() == nullptr ||
      secondInput.data() == nullptr || secondSpectrum.data() == nullptr ||
      secondWork.data() == nullptr || directInverse.data() == nullptr ||
      incrementalInverse.data() == nullptr || directAccumulator.data() == nullptr ||
      incrementalAccumulator.data() == nullptr) {
    pffft_destroy_setup(setup);
    return;
  }

  fillInput(input.data(), points, sequence);
  std::memset(directOutput.data(), 0, sizeof(float) * points);
  std::memset(directWork.data(), 0, sizeof(float) * points);
  std::memset(incrementalOutput.data(), 0, sizeof(float) * points);
  std::memset(incrementalWork.data(), 0, sizeof(float) * points);
  pffft_transform_ordered(setup, input.data(), directOutput.data(), directWork.data(),
                          PFFFT_FORWARD);

  effetune::dsp::PffftOrderedRealForward incremental(setup, workBudget);
  PFFFT_INCREMENTAL_CHECK(incremental.valid());
  PFFFT_INCREMENTAL_CHECK(
      incremental.begin(input.data(), incrementalOutput.data(), incrementalWork.data()));
  int expectedStepCount = incremental.stepCount();
  PFFFT_INCREMENTAL_CHECK(expectedStepCount >= 3);
  int result = 0;
  int stepCount = 0;
  while (result == 0 && stepCount < kMaximumTransformSteps) {
    const auto start = std::chrono::steady_clock::now();
    result = incremental.step();
    const auto elapsed =
        std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - start).count();
    maximumStepMicroseconds = elapsed > maximumStepMicroseconds ? elapsed : maximumStepMicroseconds;
    ++stepCount;
  }
  PFFFT_INCREMENTAL_CHECK(result == 1);
  PFFFT_INCREMENTAL_CHECK(stepCount == expectedStepCount);
  PFFFT_INCREMENTAL_CHECK(stepCount < kMaximumTransformSteps);
  PFFFT_INCREMENTAL_CHECK(
      std::memcmp(directOutput.data(), incrementalOutput.data(), sizeof(float) * points) == 0);
  PFFFT_INCREMENTAL_CHECK(incremental.step() == 1);

  std::memset(directOutput.data(), 0, sizeof(float) * points);
  std::memset(incrementalOutput.data(), 0, sizeof(float) * points);
  pffft_transform(setup, input.data(), directOutput.data(), directWork.data(), PFFFT_FORWARD);
  PFFFT_INCREMENTAL_CHECK(incremental.beginUnorderedForward(input.data(), incrementalOutput.data(),
                                                            incrementalWork.data()));
  expectedStepCount = incremental.stepCount();
  result = 0;
  stepCount = 0;
  while (result == 0 && stepCount < kMaximumTransformSteps) {
    result = incremental.step();
    ++stepCount;
  }
  PFFFT_INCREMENTAL_CHECK(result == 1);
  PFFFT_INCREMENTAL_CHECK(stepCount == expectedStepCount);
  PFFFT_INCREMENTAL_CHECK(
      std::memcmp(directOutput.data(), incrementalOutput.data(), sizeof(float) * points) == 0);

  std::memset(directInverse.data(), 0, sizeof(float) * points);
  std::memset(incrementalInverse.data(), 0, sizeof(float) * points);
  pffft_transform(setup, directOutput.data(), directInverse.data(), directWork.data(),
                  PFFFT_BACKWARD);
  PFFFT_INCREMENTAL_CHECK(incremental.beginUnorderedBackward(
      directOutput.data(), incrementalInverse.data(), incrementalWork.data()));
  expectedStepCount = incremental.stepCount();
  result = 0;
  stepCount = 0;
  while (result == 0 && stepCount < kMaximumTransformSteps) {
    const auto start = std::chrono::steady_clock::now();
    result = incremental.step();
    const auto elapsed =
        std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - start).count();
    maximumBackwardStepMicroseconds =
        elapsed > maximumBackwardStepMicroseconds ? elapsed : maximumBackwardStepMicroseconds;
    ++stepCount;
  }
  PFFFT_INCREMENTAL_CHECK(result == 1);
  PFFFT_INCREMENTAL_CHECK(stepCount == expectedStepCount);
  PFFFT_INCREMENTAL_CHECK(
      std::memcmp(directInverse.data(), incrementalInverse.data(), sizeof(float) * points) == 0);

  fillInput(secondInput.data(), points, sequence + 3);
  pffft_transform(setup, secondInput.data(), secondSpectrum.data(), secondWork.data(),
                  PFFFT_FORWARD);
  fillInput(directAccumulator.data(), points, sequence + 5);
  std::memcpy(incrementalAccumulator.data(), directAccumulator.data(), sizeof(float) * points);
  constexpr float scaling = 0.00390625F;
  pffft_zconvolve_accumulate(setup, directOutput.data(), secondSpectrum.data(),
                             directAccumulator.data(), scaling);
  effetune::dsp::PffftZConvolveAccumulate convolve(setup);
  PFFFT_INCREMENTAL_CHECK(convolve.valid());
  PFFFT_INCREMENTAL_CHECK(convolve.begin(directOutput.data(), secondSpectrum.data(),
                                         incrementalAccumulator.data(), scaling));
  const int convolveStepCount = convolve.stepCount();
  result = 0;
  stepCount = 0;
  while (result == 0 && stepCount <= convolveStepCount) {
    result = convolve.step(1);
    ++stepCount;
  }
  PFFFT_INCREMENTAL_CHECK(result == 1);
  PFFFT_INCREMENTAL_CHECK(stepCount == convolveStepCount);
  PFFFT_INCREMENTAL_CHECK(std::memcmp(directAccumulator.data(), incrementalAccumulator.data(),
                                      sizeof(float) * points) == 0);

  constexpr float directSentinel = 0.75F;
  constexpr float incrementalSentinel = -0.625F;
  for (int index = 0; index < points; ++index) {
    directAccumulator.data()[index] = directSentinel;
    incrementalAccumulator.data()[index] = incrementalSentinel;
  }
  const int packedNyquistIndex = pffft_simd_size() == 1 ? points - 1 : pffft_simd_size();
  const float expectedDc = directOutput.data()[0] * secondSpectrum.data()[0] * scaling;
  const float expectedNyquist =
      directOutput.data()[packedNyquistIndex] * secondSpectrum.data()[packedNyquistIndex] * scaling;
  pffft_zconvolve_no_accu(setup, directOutput.data(), secondSpectrum.data(),
                          directAccumulator.data(), scaling);
  PFFFT_INCREMENTAL_CHECK(directAccumulator.data()[0] == expectedDc);
  PFFFT_INCREMENTAL_CHECK(directAccumulator.data()[packedNyquistIndex] == expectedNyquist);
  PFFFT_INCREMENTAL_CHECK(convolve.beginNoAccu(directOutput.data(), secondSpectrum.data(),
                                               incrementalAccumulator.data(), scaling));
  result = 0;
  stepCount = 0;
  while (result == 0 && stepCount <= convolve.stepCount()) {
    result = convolve.step(1);
    ++stepCount;
  }
  PFFFT_INCREMENTAL_CHECK(result == 1);
  PFFFT_INCREMENTAL_CHECK(stepCount == convolve.stepCount());
  PFFFT_INCREMENTAL_CHECK(incrementalAccumulator.data()[0] == expectedDc);
  PFFFT_INCREMENTAL_CHECK(incrementalAccumulator.data()[packedNyquistIndex] == expectedNyquist);
  PFFFT_INCREMENTAL_CHECK(std::memcmp(directAccumulator.data(), incrementalAccumulator.data(),
                                      sizeof(float) * points) == 0);

  pffft_destroy_setup(setup);
}

} // namespace

int main() {
  constexpr std::array pointsList{256, 512, 1024, 2048, 4096, 8192, 16384};
  double maximumStepMicroseconds = 0.0;
  for (const int points : pointsList) {
    verifyTransform(points, 0, 256, maximumStepMicroseconds);
    verifyTransform(points, 1, 128, maximumStepMicroseconds);
    verifyTransform(points, 2, 64, maximumStepMicroseconds);
  }
  std::printf("PFFFT incremental ordered real-forward: max step %.3f us\n",
              maximumStepMicroseconds);
  std::printf("PFFFT incremental unordered real-backward: max step %.3f us\n",
              maximumBackwardStepMicroseconds);
  return failures == 0 ? 0 : 1;
}

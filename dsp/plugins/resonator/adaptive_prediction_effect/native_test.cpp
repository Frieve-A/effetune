#include "AdaptivePredictionEffectPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_AdaptivePredictionEffectPlugin() noexcept;

namespace {

using Params = effetune::generated::AdaptivePredictionEffectPluginParams;
constexpr std::uint32_t kFrames = 128u;
constexpr double kPi = 3.14159265358979323846;
constexpr std::array<float, 14> kSampleRates{8000.0F,   11025.0F,  16000.0F,  22050.0F, 32000.0F,
                                             44100.0F,  48000.0F,  50000.0F,  88200.0F, 96000.0F,
                                             176400.0F, 192000.0F, 352800.0F, 384000.0F};
int failures = 0;
void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "adaptive_prediction_effect/native_test.cpp:%d: %s\n", line, expression);
    ++failures;
  }
}
#define APE_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

Params defaults() noexcept {
  Params params{};
  params.gap = 1.0F;
  params.learn = 0.02F;
  params.residual = 1.0F;
  return params;
}
Params predictionParams() noexcept {
  Params params = defaults();
  params.residual = 0.0F;
  params.prediction = 1.0F;
  return params;
}

class Harness final {
public:
  explicit Harness(float rate = 48000.0F, bool expected_prepared = true) {
    descriptor_ = et_kernel_descriptor_AdaptivePredictionEffectPlugin();
    APE_CHECK(descriptor_ != nullptr);
    if (descriptor_ == nullptr)
      return;
    APE_CHECK(descriptor_->objectSize <= storage_.size());
    APE_CHECK(descriptor_->paramsFloatCount == Params::kFloatCount);
    APE_CHECK(descriptor_->paramsHash == Params::kHash);
    if (descriptor_->objectSize > storage_.size())
      return;
    kernel_ = descriptor_->construct(storage_.data());
    kernel_->prepare({rate, 2u, kFrames});
    APE_CHECK(kernel_->preparedSuccessfully() == expected_prepared);
    APE_CHECK(kernel_->latencySamples() == 0u);
  }
  ~Harness() {
    if (kernel_ != nullptr)
      descriptor_->destroy(kernel_);
  }
  Harness(const Harness &) = delete;
  Harness &operator=(const Harness &) = delete;
  void stage(const Params &params) noexcept {
    APE_CHECK(kernel_ != nullptr);
    if (kernel_ != nullptr)
      APE_CHECK(kernel_->stageParameters(&params.gap, Params::kFloatCount, Params::kHash) == ET_OK);
  }
  void process(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    if (kernel_ == nullptr)
      return;
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->applyPendingParameters();
    kernel_->process(audio, channels, frames, {0.0});
  }
  void reset() noexcept {
    effetune::allocation_guard::Scope allocation_scope;
    if (kernel_ != nullptr)
      kernel_->reset();
  }
#if defined(ET_DEBUG_STATE)
  effetune::DebugStateSnapshot snapshot() const noexcept {
    effetune::DebugStateSnapshot state{};
    APE_CHECK(kernel_ != nullptr && kernel_->readDebugState(state));
    return state;
  }
#endif
private:
  alignas(std::max_align_t) std::array<std::byte, 16384u> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

std::vector<float> sine(std::uint32_t frames, std::uint32_t channels = 1u, double rate = 48000.0,
                        std::uint32_t offset = 0u) {
  std::vector<float> audio(static_cast<std::size_t>(frames) * channels);
  for (std::uint32_t channel = 0u; channel < channels; ++channel)
    for (std::uint32_t frame = 0u; frame < frames; ++frame)
      audio[static_cast<std::size_t>(channel) * frames + frame] = static_cast<float>(
          0.25 * std::sin(2.0 * kPi * (440.0 + 173.0 * channel) * (offset + frame) / rate));
  return audio;
}
std::vector<float> render(Harness &harness, const std::vector<float> &input,
                          std::uint32_t channels = 1u, std::uint32_t block_size = kFrames) {
  const auto frames = static_cast<std::uint32_t>(input.size() / channels);
  std::vector<float> output(input.size());
  std::array<float, kFrames * 2u> block{};
  for (std::uint32_t offset = 0u; offset < frames;) {
    const std::uint32_t count = std::min(block_size, frames - offset);
    for (std::uint32_t channel = 0u; channel < channels; ++channel)
      std::copy_n(input.data() + static_cast<std::size_t>(channel) * frames + offset, count,
                  block.data() + static_cast<std::size_t>(channel) * count);
    harness.process(block.data(), channels, count);
    for (std::uint32_t channel = 0u; channel < channels; ++channel)
      std::copy_n(block.data() + static_cast<std::size_t>(channel) * count, count,
                  output.data() + static_cast<std::size_t>(channel) * frames + offset);
    offset += count;
  }
  return output;
}
double energy(const std::vector<float> &audio, std::size_t start = 0u) noexcept {
  double sum = 0.0;
  for (std::size_t index = start; index < audio.size(); ++index)
    sum += static_cast<double>(audio[index]) * audio[index];
  return sum;
}
double maximumDifference(const std::vector<float> &a, const std::vector<float> &b) noexcept {
  double maximum = 0.0;
  for (std::size_t index = 0u; index < a.size(); ++index)
    maximum = std::max(maximum, std::abs(static_cast<double>(a[index]) - b[index]));
  return maximum;
}
void train(Harness &harness, const Params &params, std::uint32_t frames = 24000u,
           double rate = 48000.0) {
  harness.stage(params);
  static_cast<void>(render(harness, sine(frames, 1u, rate)));
}

void testLearningReducesPredictableInput() {
  Harness harness;
  harness.stage(defaults());
  const auto input = sine(192000u);
  const auto residual = render(harness, input);
  const double residual_db = 10.0 * std::log10(energy(residual, 144000u) / energy(input, 144000u));
  std::printf("APE 440 Hz residual after four seconds: %.2f dB\n", residual_db);
  APE_CHECK(residual_db < -25.0);
  APE_CHECK(
      std::all_of(residual.begin(), residual.end(), [](float s) { return std::isfinite(s); }));
#if defined(ET_DEBUG_STATE)
  const auto state = harness.snapshot();
  APE_CHECK(state.auxiliaryWords[0] <= 16u * 1024u * 1024u);
  APE_CHECK(state.auxiliaryValues[0] > 0.0 && state.auxiliaryValues[0] <= 4.00001);
#endif
}
void testLearningAndSmoothingAreIndependentOfBlockPartition() {
  const auto input = sine(8193u, 2u);
  Harness whole;
  Harness split;
  Params params = defaults();
  whole.stage(params);
  split.stage(params);
  APE_CHECK(render(whole, input, 2u, 128u) == render(split, input, 2u, 37u));
  params.gap = 0.0104166667F;
  params.autonomy = 0.91F;
  params.learn = 0.1F;
  params.original = -0.5F;
  params.residual = 0.0F;
  params.prediction = 0.5F;
  whole.stage(params);
  split.stage(params);
  APE_CHECK(render(whole, input, 2u, 127u) == render(split, input, 2u, 1u));
}
void testStereoLearningAndStateAreIndependent() {
  const auto input = sine(8192u, 2u);
  Harness stereo;
  Harness left;
  Harness right;
  stereo.stage(defaults());
  left.stage(defaults());
  right.stage(defaults());
  const auto actual = render(stereo, input, 2u);
  const auto a = render(left, std::vector<float>(input.begin(), input.begin() + 8192));
  const auto b = render(right, std::vector<float>(input.begin() + 8192, input.end()));
  APE_CHECK(std::equal(a.begin(), a.end(), actual.begin()));
  APE_CHECK(std::equal(b.begin(), b.end(), actual.begin() + 8192));
}
void testLearningStartsAfterFourSamplesAndUsesExternalSilenceGate() {
  Params params = predictionParams();
  params.gap = 0.0F;
  params.learn = 0.1F;
  Harness active;
  active.stage(params);
  const auto predicted = render(active, std::vector<float>(8u, 0.25F), 1u, 1u);
  APE_CHECK(std::all_of(predicted.begin(), predicted.begin() + 4,
                        [](float value) { return value == 0.0F; }));
  APE_CHECK(predicted[4] > 0.0F);

  Harness quiet;
  params.autonomy = 0.98F;
  quiet.stage(params);
  APE_CHECK(energy(render(quiet, std::vector<float>(4096u, 0.0005F))) == 0.0);
  params.autonomy = 0.0F;
  quiet.stage(params);
  APE_CHECK(energy(render(quiet, std::vector<float>(1024u, 0.002F))) > 0.0);
}
void testZeroGapIsCausal() {
  Params params = predictionParams();
  params.gap = 0.0F;
  Harness positive;
  Harness negative;
  train(positive, params);
  train(negative, params);
  params.freeze = 1.0F;
  positive.stage(params);
  negative.stage(params);
  const auto p = render(positive, {0.8F, 0.0F, 0.0F, 0.0F});
  const auto n = render(negative, {-0.8F, 0.0F, 0.0F, 0.0F});
  APE_CHECK(p[0] == n[0]);
  APE_CHECK(maximumDifference(p, n) > 1.0e-4);
}
void testFractionalGapInterpolatesPastFeatures() {
  Params params = predictionParams();
  params.gap = 0.0F;
  Harness recent;
  Harness halfway;
  Harness older;
  train(recent, params);
  train(halfway, params);
  train(older, params);
  params.freeze = 1.0F;
  recent.stage(params);
  params.gap = 0.5F / 48.0F;
  halfway.stage(params);
  params.gap = 1.0F / 48.0F;
  older.stage(params);
  const auto input = sine(2048u, 1u, 48000.0, 24000u);
  const auto a = render(recent, input);
  const auto b = render(halfway, input);
  const auto c = render(older, input);
  double difference = 0.0;
  for (std::size_t index = 512u; index < input.size(); ++index)
    difference =
        std::max(difference, std::abs(static_cast<double>(b[index]) - 0.5 * (a[index] + c[index])));
  APE_CHECK(difference < 2.0e-6);
}
void testMaximumGapRemainsCausalAfterRingWrap() {
  for (const float rate : {8000.0F, 48000.0F, 96000.0F, 384000.0F}) {
    Params params = predictionParams();
    Harness positive(rate);
    Harness negative(rate);
    const auto gap_frames = static_cast<std::uint32_t>(rate * 0.5F);
    train(positive, params, gap_frames, rate);
    train(negative, params, gap_frames, rate);
    params.gap = 500.0F;
    params.freeze = 1.0F;
    positive.stage(params);
    negative.stage(params);
    const auto settle = sine(static_cast<std::uint32_t>(rate * 0.7F), 1u, rate, gap_frames);
    static_cast<void>(render(positive, settle));
    static_cast<void>(render(negative, settle));
    std::vector<float> a(gap_frames + 32u, 0.0F);
    std::vector<float> b = a;
    a[0] = 0.8F;
    b[0] = -0.8F;
    const auto p = render(positive, a);
    const auto n = render(negative, b);
    APE_CHECK(std::equal(p.begin(), p.begin() + gap_frames + 1u, n.begin()));
    APE_CHECK(maximumDifference(p, n) > 1.0e-4);
  }
}
void testSilenceStopsUpdatesAndDecay() {
  Params params = predictionParams();
  Harness active;
  Harness frozen;
  train(active, params);
  train(frozen, params);
  params.weightDecay = 0.5F;
  active.stage(params);
  params.freeze = 1.0F;
  frozen.stage(params);
  const std::vector<float> silence(48000u, 0.0F);
  APE_CHECK(render(active, silence) == render(frozen, silence));
  active.stage(params);
  const auto probe = sine(1024u);
  const auto a = render(active, probe);
  APE_CHECK(a == render(frozen, probe));
  APE_CHECK(energy(a) > 0.001);
}
void testSilenceDoesNotLeaveSubnormalsOrEraseLearning() {
  for (const bool freeze : {false, true}) {
    Harness harness;
    Params params = predictionParams();
    train(harness, params);
    params.freeze = freeze ? 1.0F : 0.0F;
    harness.stage(params);
#if defined(ET_DEBUG_STATE)
    const double learned_norm = harness.snapshot().auxiliaryValues[0];
#endif
    const auto output = render(harness, std::vector<float>(96000u, 0.0F));
    APE_CHECK(
        std::all_of(output.end() - 4096, output.end(), [](float value) { return value == 0.0F; }));
#if defined(ET_DEBUG_STATE)
    const auto state = harness.snapshot();
    APE_CHECK(state.auxiliaryWords[5] == 0u);
    APE_CHECK(state.auxiliaryValues[0] == learned_norm && learned_norm > 0.0);
#endif
    params.freeze = 1.0F;
    harness.stage(params);
    APE_CHECK(energy(render(harness, sine(1024u))) > 0.001);
  }
}
void testFreezeKeepsStateRunningAndHoldIsAutonomous() {
  Params params = predictionParams();
  params.gap = 10.0F;
  Harness held;
  Harness explicit_hold;
  train(held, params, 96000u);
  train(explicit_hold, params, 96000u);
  params.hold = 1.0F;
  held.stage(params);
  params.hold = 0.0F;
  params.freeze = 1.0F;
  params.autonomy = 1.0F;
  explicit_hold.stage(params);
  const auto seed = sine(1024u, 1u, 48000.0, 96000u);
  APE_CHECK(render(held, seed) == render(explicit_hold, seed));
  const auto generated = render(held, std::vector<float>(48000u, 0.0F));
  const auto driven = render(explicit_hold, sine(48000u, 1u, 48000.0, 97024u));
  APE_CHECK(generated == driven);
  APE_CHECK(energy(generated) > 0.01);
#if defined(ET_DEBUG_STATE)
  APE_CHECK(held.snapshot().auxiliaryValues[0] == explicit_hold.snapshot().auxiliaryValues[0]);
#endif
}
void testFiniteWeightDecayUsesItsTimeConstant() {
  Params params = predictionParams();
  Harness decaying;
  Harness retained;
  train(decaying, params);
  train(retained, params);
  params.learn = 0.0F;
  decaying.stage(params);
  retained.stage(params);
  const auto settle = sine(512u, 1u, 48000.0, 24000u);
  APE_CHECK(render(decaying, settle) == render(retained, settle));
  params.weightDecay = 0.5F;
  decaying.stage(params);
  const auto input = sine(48000u, 1u, 48000.0, 24512u);
  const auto a = render(decaying, input);
  const auto b = render(retained, input);
  const double final_ratio = std::sqrt(energy(a, 43904u) / energy(b, 43904u));
  APE_CHECK(final_ratio > 0.12 && final_ratio < 0.16);
}
void testAutonomyNeverTeachesTheGeneratorOutput() {
  Params params = predictionParams();
  Harness external;
  Harness feedback;
  external.stage(params);
  params.autonomy = 0.98F;
  feedback.stage(params);
  const auto input = sine(24000u);
  static_cast<void>(render(external, input));
  static_cast<void>(render(feedback, input));
  params.autonomy = 0.0F;
  params.freeze = 1.0F;
  external.stage(params);
  feedback.stage(params);
  const auto probe = sine(2048u, 1u, 48000.0, 24000u);
  const auto a = render(external, probe);
  const auto b = render(feedback, probe);
  APE_CHECK(std::equal(a.begin() + 512, a.end(), b.begin() + 512));
}
void testComplementaryMixerPolarityAndLimiter() {
  Harness unity;
  Params params = defaults();
  params.prediction = 1.0F;
  params.autonomy = 0.98F;
  unity.stage(params);
  const auto input = sine(8192u, 2u);
  APE_CHECK(render(unity, input, 2u) == input);
  Harness inverted;
  params.original = -2.0F;
  params.residual = 0.0F;
  params.prediction = 0.0F;
  inverted.stage(params);
  APE_CHECK(render(inverted, {0.125F, -0.25F, 0.75F, -0.75F}) ==
            std::vector<float>({-0.25F, 0.5F, -1.0F, 1.0F}));
}
void testGainChangesRampForTenMilliseconds() {
  for (const float rate : kSampleRates) {
    Harness harness(rate);
    Params params = defaults();
    params.original = 1.0F;
    params.residual = 0.0F;
    params.learn = 0.0F;
    harness.stage(params);
    static_cast<void>(render(harness, std::vector<float>(4u, 0.25F)));
    params.original = -1.0F;
    harness.stage(params);
    const auto ramp_frames = static_cast<std::uint32_t>(std::ceil(rate * 0.01F));
    const auto output = render(harness, std::vector<float>(ramp_frames + 32u, 0.25F));
    for (std::uint32_t frame = 0u; frame < ramp_frames; ++frame) {
      const float expected = 0.25F - 0.5F * static_cast<float>(frame + 1u) / ramp_frames;
      APE_CHECK(std::abs(output[frame] - expected) < 2.0e-5F);
    }
    APE_CHECK(output[ramp_frames - 1u] == -0.25F && output.back() == -0.25F);
  }
}
void testResetInvalidatesHistoryAndFaultRecoversOnlyOnReset() {
  Params params = predictionParams();
  Harness harness;
  train(harness, params, 32768u);
  params.freeze = 1.0F;
  params.gap = 500.0F;
  params.resetToken = 1.0F;
  harness.stage(params);
  APE_CHECK(energy(render(harness, std::vector<float>(24576u, 0.0F))) == 0.0);
  params.freeze = 0.0F;
  params.gap = 1.0F;
  train(harness, params);
  params.autonomy = 1.0F;
  harness.stage(params);
  static_cast<void>(render(harness, sine(512u)));
  std::array<float, 4u> bad{std::numeric_limits<float>::infinity(), 0.0F, 0.0F, 0.0F};
  harness.process(bad.data(), 1u, 4u);
  APE_CHECK(std::all_of(bad.begin(), bad.end(), [](float value) { return std::isfinite(value); }));
  APE_CHECK(energy(render(harness, sine(4096u))) == 0.0);
#if defined(ET_DEBUG_STATE)
  APE_CHECK(harness.snapshot().auxiliaryWords[3] != 0u);
#endif
  params.resetToken = 2.0F;
  params.autonomy = 0.0F;
  harness.stage(params);
  APE_CHECK(energy(render(harness, sine(8192u))) > 0.01);
#if defined(ET_DEBUG_STATE)
  APE_CHECK(harness.snapshot().auxiliaryWords[3] == 0u);
#endif
  harness.reset();
  Harness fresh;
  fresh.stage(params);
  const auto probe = sine(1024u);
  APE_CHECK(render(harness, probe) == render(fresh, probe));
}
void testLearningAcrossSampleRates() {
  for (const float rate : kSampleRates) {
    Harness harness(rate);
    harness.stage(defaults());
    const auto frames = static_cast<std::uint32_t>(rate * 2.0F);
    const auto input = sine(frames, 2u, rate);
    const auto output = render(harness, input, 2u);
    APE_CHECK(std::all_of(output.begin(), output.end(),
                          [](float value) { return std::isfinite(value); }));
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      double input_energy = 0.0;
      double output_energy = 0.0;
      for (std::size_t index = channel * frames + frames * 3u / 4u; index < (channel + 1u) * frames;
           ++index) {
        input_energy += static_cast<double>(input[index]) * input[index];
        output_energy += static_cast<double>(output[index]) * output[index];
      }
      std::printf("APE %.0f Hz channel %u final residual: %.2f dB\n", rate, channel + 1u,
                  10.0 * std::log10(output_energy / input_energy));
      APE_CHECK(output_energy < input_energy * 0.01);
    }
  }
}
void testInvalidSampleRatesAreRejected() {
  for (const float rate :
       {0.0F, -48000.0F, std::numeric_limits<float>::quiet_NaN(),
        std::numeric_limits<float>::infinity(), std::numeric_limits<float>::max()}) {
    Harness harness(rate, false);
    harness.stage(defaults());
    const std::vector<float> input{0.25F, -0.5F};
    APE_CHECK(render(harness, input) == input);
  }
}
void reportDesktopStereoCallbackTime() {
  Harness harness;
  harness.stage(defaults());
  const auto input = sine(kFrames, 2u);
  auto block = input;
  std::vector<double> timings;
  timings.reserve(1024u);
  for (std::uint32_t iteration = 0u; iteration < 1024u; ++iteration) {
    block = input;
    const auto start = std::chrono::steady_clock::now();
    harness.process(block.data(), 2u, kFrames);
    const auto stop = std::chrono::steady_clock::now();
    timings.push_back(std::chrono::duration<double, std::milli>(stop - start).count());
  }
  std::sort(timings.begin(), timings.end());
  std::printf("APE desktop 48 kHz stereo/128 frames: p99.9 %.3f ms, maximum %.3f ms\n",
              timings[1022u], timings.back());
}
} // namespace

int main() {
  testLearningReducesPredictableInput();
  testLearningAndSmoothingAreIndependentOfBlockPartition();
  testStereoLearningAndStateAreIndependent();
  testLearningStartsAfterFourSamplesAndUsesExternalSilenceGate();
  testZeroGapIsCausal();
  testFractionalGapInterpolatesPastFeatures();
  testMaximumGapRemainsCausalAfterRingWrap();
  testSilenceStopsUpdatesAndDecay();
  testSilenceDoesNotLeaveSubnormalsOrEraseLearning();
  testFreezeKeepsStateRunningAndHoldIsAutonomous();
  testFiniteWeightDecayUsesItsTimeConstant();
  testAutonomyNeverTeachesTheGeneratorOutput();
  testComplementaryMixerPolarityAndLimiter();
  testGainChangesRampForTenMilliseconds();
  testResetInvalidatesHistoryAndFaultRecoversOnlyOnReset();
  testLearningAcrossSampleRates();
  testInvalidSampleRatesAreRejected();
  reportDesktopStereoCallbackTime();
  if (failures != 0) {
    std::fprintf(stderr, "%d APE native acceptance check(s) failed\n", failures);
    return 1;
  }
  std::puts("All APE native acceptance tests passed");
  return 0;
}

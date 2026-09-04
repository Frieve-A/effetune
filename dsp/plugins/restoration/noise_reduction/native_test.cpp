#include "NoiseReductionPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <pffft.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_NoiseReductionPlugin() noexcept;
extern "C" bool et_noise_reduction_read_scheduler_trace(
    effetune::PluginKernel *kernel, std::uint32_t *stage_count, std::uint32_t *slot_count,
    std::uint32_t *stage_capacity, std::uint32_t *slot_capacity, bool *job_active,
    std::uint32_t *overrun_count, std::uint32_t *failure_count) noexcept;

namespace {

using Params = effetune::generated::NoiseReductionPluginParams;
constexpr double kPi = 3.1415926535897932384626433832795;
constexpr std::uint32_t kSampleRate = 96000u;
constexpr std::uint32_t kBlockSize = 128u;
// Match Engine::kKernelStorageBytes so this test catches kernels that cannot be instantiated.
constexpr std::size_t kKernelStorageBytes = 16384u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (condition) {
    return;
  }
  std::fprintf(stderr, "noise_reduction/native_test.cpp:%d: check failed: %s\n", line, expression);
  ++failures;
}

#define NR_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

Params parameters(float reduction = 12.0F, float sensitivity = 0.0F, float smoothing = 50.0F,
                  float treble_care = 50.0F, float mix = 100.0F) noexcept {
  return {reduction, sensitivity, smoothing, treble_care, mix};
}

std::uint32_t fftSizeForRate(double sample_rate) noexcept {
  double requested = std::pow(2.0, std::round(std::log2(sample_rate * 0.085)));
  if (requested < 256.0) {
    requested = 256.0;
  } else if (requested > 16384.0) {
    requested = 16384.0;
  }
  auto size = static_cast<std::uint32_t>(requested);
  while (size > 256u && static_cast<double>(size + size / 4u) / sample_rate > 0.120) {
    size >>= 1u;
  }
  return size;
}

class Harness final {
public:
  Harness(float sample_rate, std::uint32_t channels, std::uint32_t max_frames = kBlockSize)
      : Harness(sample_rate, channels, channels, max_frames) {}

  Harness(float sample_rate, std::uint32_t max_channels, std::uint32_t channels,
          std::uint32_t max_frames)
      : sample_rate_(sample_rate), channels_(channels), max_channels_(max_channels),
        max_frames_(max_frames) {
    descriptor_ = et_kernel_descriptor_NoiseReductionPlugin();
    NR_CHECK(descriptor_ != nullptr);
    if (descriptor_ == nullptr) {
      return;
    }
    NR_CHECK(descriptor_->objectSize <= storage_.size());
    NR_CHECK(descriptor_->paramsHash == Params::kHash);
    NR_CHECK(descriptor_->paramsFloatCount == Params::kFloatCount);
    kernel_ = descriptor_->construct(storage_.data());
    NR_CHECK(kernel_ != nullptr);
    if (kernel_ != nullptr) {
      prepare(sample_rate_, max_channels_, channels_);
      if (!kernel_->preparedSuccessfully()) {
        std::uint32_t stage_count = 0u;
        std::uint32_t slot_count = 0u;
        std::uint32_t stage_capacity = 0u;
        std::uint32_t slot_capacity = 0u;
        std::uint32_t overrun_count = 0u;
        std::uint32_t failure_count = 0u;
        bool job_active = false;
        (void)et_noise_reduction_read_scheduler_trace(kernel_, &stage_count, &slot_count,
                                                      &stage_capacity, &slot_capacity, &job_active,
                                                      &overrun_count, &failure_count);
        std::fprintf(stderr, "prepare %.0f Hz/%u ch: stages=%u/%u slots=%u/%u steps=%u/%u\n",
                     sample_rate_, channels_, stage_count, stage_capacity, slot_count,
                     slot_capacity, overrun_count, failure_count);
      }
    }
  }

  ~Harness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  Harness(const Harness &) = delete;
  Harness &operator=(const Harness &) = delete;

  void prepare(float sample_rate, std::uint32_t channels) noexcept {
    prepare(sample_rate, channels, channels);
  }

  void prepare(float sample_rate, std::uint32_t max_channels, std::uint32_t channels) noexcept {
    sample_rate_ = sample_rate;
    max_channels_ = max_channels;
    channels_ = channels;
    kernel_->prepare({sample_rate_, max_channels_, max_frames_});
    NR_CHECK(kernel_->preparedSuccessfully());
  }

  void stage(const Params &value) noexcept {
    const auto *packed = reinterpret_cast<const float *>(&value);
    NR_CHECK(kernel_->stageParameters(packed, Params::kFloatCount, Params::kHash) == ET_OK);
    kernel_->applyPendingParameters();
  }

  std::vector<float> process(const std::vector<float> &input) noexcept {
    NR_CHECK(input.size() % channels_ == 0u);
    const auto frames = static_cast<std::uint32_t>(input.size() / channels_);
    std::vector<float> output(input.size(), 0.0F);
    std::vector<float> block(static_cast<std::size_t>(channels_) * max_frames_, 0.0F);
    for (std::uint32_t offset = 0u; offset < frames; offset += max_frames_) {
      const std::uint32_t count = frames - offset < max_frames_ ? frames - offset : max_frames_;
      for (std::uint32_t channel = 0u; channel < channels_; ++channel) {
        std::memcpy(block.data() + static_cast<std::size_t>(channel) * count,
                    input.data() + static_cast<std::size_t>(channel) * frames + offset,
                    count * sizeof(float));
      }
      {
        effetune::allocation_guard::Scope allocation_scope;
        kernel_->process(block.data(), channels_, count, {0.0});
      }
      for (std::uint32_t channel = 0u; channel < channels_; ++channel) {
        std::memcpy(output.data() + static_cast<std::size_t>(channel) * frames + offset,
                    block.data() + static_cast<std::size_t>(channel) * count,
                    count * sizeof(float));
      }
    }
    return output;
  }

  void reset() noexcept {
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->reset();
  }

  [[nodiscard]] std::uint32_t latency() const noexcept { return kernel_->latencySamples(); }

  void checkScheduler() noexcept {
    std::uint32_t stage_count = 0u;
    std::uint32_t slot_count = 0u;
    std::uint32_t stage_capacity = 0u;
    std::uint32_t slot_capacity = 0u;
    std::uint32_t overrun_count = 0u;
    std::uint32_t failure_count = 0u;
    bool job_active = false;
    NR_CHECK(et_noise_reduction_read_scheduler_trace(kernel_, &stage_count, &slot_count,
                                                     &stage_capacity, &slot_capacity, &job_active,
                                                     &overrun_count, &failure_count));
    NR_CHECK(stage_count <= stage_capacity);
    NR_CHECK(slot_count <= slot_capacity);
    NR_CHECK(overrun_count == 0u);
    NR_CHECK(failure_count == 0u);
    (void)job_active;
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
  float sample_rate_ = 0.0F;
  std::uint32_t channels_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
};

class Random final {
public:
  explicit Random(std::uint32_t seed) noexcept : state_(seed == 0u ? 1u : seed) {}
  double next() noexcept {
    state_ ^= state_ << 13u;
    state_ ^= state_ >> 17u;
    state_ ^= state_ << 5u;
    return static_cast<double>(state_) / 4294967296.0 * 2.0 - 1.0;
  }

private:
  std::uint32_t state_;
};

void normalizeRms(std::vector<float> &signal, double target_db) noexcept {
  double energy = 0.0;
  for (float sample : signal) {
    energy += static_cast<double>(sample) * sample;
  }
  const double rms = std::sqrt(energy / static_cast<double>(signal.size()));
  const double target = std::pow(10.0, target_db / 20.0);
  const double gain = rms > 0.0 ? target / rms : 0.0;
  for (float &sample : signal) {
    sample = static_cast<float>(static_cast<double>(sample) * gain);
  }
}

std::vector<float> whiteNoise(std::uint32_t frames, std::uint32_t channels, std::uint32_t seed,
                              double target_db) {
  std::vector<float> result(static_cast<std::size_t>(frames) * channels, 0.0F);
  Random random(seed);
  for (float &sample : result) {
    sample = static_cast<float>(random.next());
  }
  normalizeRms(result, target_db);
  return result;
}

std::vector<float> uniformNoise(std::uint32_t frames, std::uint32_t channels, std::uint32_t seed,
                                double scale) {
  std::vector<float> result(static_cast<std::size_t>(frames) * channels, 0.0F);
  Random random(seed);
  for (float &sample : result) {
    sample = static_cast<float>(random.next() * scale);
  }
  return result;
}

std::vector<float> pinkNoise(std::uint32_t frames, std::uint32_t channels, std::uint32_t seed,
                             double target_db) {
  std::vector<float> result(static_cast<std::size_t>(frames) * channels, 0.0F);
  Random random(seed);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    double b0 = 0.0;
    double b1 = 0.0;
    double b2 = 0.0;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double white = random.next();
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      result[static_cast<std::size_t>(channel) * frames + frame] =
          static_cast<float>(b0 + b1 + b2 + white * 0.1848);
    }
  }
  normalizeRms(result, target_db);
  return result;
}

std::vector<float> musicSignal(std::uint32_t frames, std::uint32_t channels,
                               std::uint32_t sample_rate) {
  constexpr std::array<double, 8> pitches{
      220.00, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00, 440.00,
  };
  const auto note_samples = static_cast<std::uint32_t>(std::llround(0.300 * sample_rate));
  std::vector<float> mono(frames, 0.0F);
  for (std::uint32_t note_start = 0u, note = 0u; note_start < frames;
       note_start += note_samples, ++note) {
    const double pitch = pitches[note % pitches.size()];
    double nominal_energy = 0.0;
    for (std::uint32_t offset = 0u; offset < note_samples; ++offset) {
      const double time = static_cast<double>(offset) / sample_rate;
      double sample = 0.0;
      for (std::uint32_t harmonic = 1u; harmonic <= 4u; ++harmonic) {
        sample += std::sin(2.0 * kPi * pitch * harmonic * time) / static_cast<double>(harmonic);
      }
      sample *= std::exp(-time / 0.150);
      nominal_energy += sample * sample;
      if (note_start + offset < frames) {
        mono[note_start + offset] = static_cast<float>(sample);
      }
    }
    const double nominal_rms = std::sqrt(nominal_energy / note_samples);
    const double scale = nominal_rms > 0.0 ? 1.0 / nominal_rms : 0.0;
    const std::uint32_t actual =
        frames - note_start < note_samples ? frames - note_start : note_samples;
    for (std::uint32_t offset = 0u; offset < actual; ++offset) {
      mono[note_start + offset] = static_cast<float>(mono[note_start + offset] * scale);
    }
  }
  normalizeRms(mono, -20.0);
  std::vector<float> result(static_cast<std::size_t>(frames) * channels, 0.0F);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    std::memcpy(result.data() + static_cast<std::size_t>(channel) * frames, mono.data(),
                frames * sizeof(float));
  }
  return result;
}

class AlignedFloats final {
public:
  explicit AlignedFloats(std::uint32_t count)
      : data_(static_cast<float *>(
            pffft_aligned_malloc(static_cast<std::size_t>(count) * sizeof(float)))) {
    NR_CHECK(data_ != nullptr);
  }
  ~AlignedFloats() { pffft_aligned_free(data_); }
  AlignedFloats(const AlignedFloats &) = delete;
  AlignedFloats &operator=(const AlignedFloats &) = delete;
  [[nodiscard]] float *data() noexcept { return data_; }
  [[nodiscard]] const float *data() const noexcept { return data_; }

private:
  float *data_ = nullptr;
};

double orderedPower(const float *spectrum, std::uint32_t bin, std::uint32_t half_bins) noexcept {
  if (bin == 0u) {
    return static_cast<double>(spectrum[0]) * spectrum[0];
  }
  if (bin + 1u == half_bins) {
    return static_cast<double>(spectrum[1]) * spectrum[1];
  }
  const double real = spectrum[2u * bin];
  const double imaginary = spectrum[2u * bin + 1u];
  return real * real + imaginary * imaginary;
}

std::vector<std::uint32_t> regularFrameStarts(std::uint32_t begin, std::uint32_t end,
                                              std::uint32_t fft_size, std::uint32_t hop_size) {
  std::vector<std::uint32_t> starts;
  for (std::uint32_t start = begin; start + fft_size <= end; start += hop_size) {
    starts.push_back(start);
  }
  return starts;
}

struct BandRatios {
  double low = 0.0;
  double middle = 0.0;
  double high = 0.0;
};

BandRatios bandRatios(const std::vector<float> &output, const std::vector<float> &input,
                      std::uint32_t frames, std::uint32_t channels, std::uint32_t latency,
                      std::uint32_t sample_rate, const std::vector<std::uint32_t> &starts,
                      bool three_bands) {
  const std::uint32_t fft_size = fftSizeForRate(sample_rate);
  const std::uint32_t half_bins = fft_size / 2u + 1u;
  PFFFT_Setup *setup = pffft_new_setup(static_cast<int>(fft_size), PFFFT_REAL);
  NR_CHECK(setup != nullptr);
  AlignedFloats time(fft_size);
  AlignedFloats spectrum(fft_size);
  AlignedFloats work(fft_size);
  std::vector<float> window(fft_size, 0.0F);
  for (std::uint32_t index = 0u; index < fft_size; ++index) {
    window[index] = static_cast<float>(
        std::sqrt(0.5 - 0.5 * std::cos(2.0 * kPi * static_cast<double>(index) / fft_size)));
  }
  std::array<double, 3> output_energy{};
  std::array<double, 3> input_energy{};
  for (std::uint32_t start : starts) {
    NR_CHECK(start >= latency);
    NR_CHECK(start + fft_size <= frames);
    const std::uint32_t input_start = start - latency;
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      const std::size_t output_offset = static_cast<std::size_t>(channel) * frames + start;
      const std::size_t input_offset = static_cast<std::size_t>(channel) * frames + input_start;
      for (std::uint32_t index = 0u; index < fft_size; ++index) {
        time.data()[index] = output[output_offset + index] * window[index];
      }
      pffft_transform_ordered(setup, time.data(), spectrum.data(), work.data(), PFFFT_FORWARD);
      for (std::uint32_t bin = 0u; bin < half_bins; ++bin) {
        const double frequency = static_cast<double>(bin) * sample_rate / fft_size;
        const std::uint32_t band = three_bands
                                       ? (frequency < 6000.0 ? 0u : (frequency < 24000.0 ? 1u : 2u))
                                       : (frequency < 6000.0 ? 0u : 2u);
        if (!three_bands || frequency < 6000.0 || (frequency >= 12000.0 && frequency < 40000.0)) {
          output_energy[band] += orderedPower(spectrum.data(), bin, half_bins);
        }
      }
      for (std::uint32_t index = 0u; index < fft_size; ++index) {
        time.data()[index] = input[input_offset + index] * window[index];
      }
      pffft_transform_ordered(setup, time.data(), spectrum.data(), work.data(), PFFFT_FORWARD);
      for (std::uint32_t bin = 0u; bin < half_bins; ++bin) {
        const double frequency = static_cast<double>(bin) * sample_rate / fft_size;
        const std::uint32_t band = three_bands
                                       ? (frequency < 6000.0 ? 0u : (frequency < 24000.0 ? 1u : 2u))
                                       : (frequency < 6000.0 ? 0u : 2u);
        if (!three_bands || frequency < 6000.0 || (frequency >= 12000.0 && frequency < 40000.0)) {
          input_energy[band] += orderedPower(spectrum.data(), bin, half_bins);
        }
      }
    }
  }
  pffft_destroy_setup(setup);
  const auto ratio = [&](std::uint32_t band) {
    NR_CHECK(input_energy[band] > 0.0);
    return 10.0 * std::log10(output_energy[band] / input_energy[band]);
  };
  return {ratio(0u), three_bands ? ratio(1u) : 0.0, ratio(2u)};
}

double energyRatioDb(const std::vector<float> &output, const std::vector<float> &reference,
                     std::uint32_t frames, std::uint32_t channels, std::uint32_t latency,
                     std::uint32_t begin, std::uint32_t end, bool error) noexcept {
  double numerator = 0.0;
  double denominator = 0.0;
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = begin; frame < end; ++frame) {
      const std::size_t output_index = static_cast<std::size_t>(channel) * frames + frame;
      const std::size_t input_index = static_cast<std::size_t>(channel) * frames + frame - latency;
      const double expected = reference[input_index];
      const double value =
          error ? static_cast<double>(output[output_index]) - expected : output[output_index];
      numerator += value * value;
      denominator += expected * expected;
    }
  }
  NR_CHECK(denominator > 0.0);
  return 10.0 * std::log10(numerator / denominator);
}

std::vector<float> cymbalSignal(std::uint32_t frames, std::uint32_t channels,
                                std::uint32_t sample_rate) {
  std::vector<float> result = pinkNoise(frames, channels, 0x85ebca6bu, -45.0);
  const auto burst_length = static_cast<std::uint32_t>(std::llround(0.150 * sample_rate));
  std::uint32_t fft_size = 1u;
  while (fft_size < burst_length) {
    fft_size <<= 1u;
  }
  PFFFT_Setup *setup = pffft_new_setup(static_cast<int>(fft_size), PFFFT_REAL);
  NR_CHECK(setup != nullptr);
  AlignedFloats time(fft_size);
  AlignedFloats spectrum(fft_size);
  AlignedFloats work(fft_size);
  Random random(0xc2b2ae35u);
  for (std::uint32_t index = 0u; index < fft_size; ++index) {
    time.data()[index] = static_cast<float>(random.next());
  }
  pffft_transform_ordered(setup, time.data(), spectrum.data(), work.data(), PFFFT_FORWARD);
  const std::uint32_t half_bins = fft_size / 2u + 1u;
  for (std::uint32_t bin = 0u; bin < half_bins; ++bin) {
    if (static_cast<double>(bin) * sample_rate / fft_size >= 6000.0) {
      continue;
    }
    if (bin == 0u) {
      spectrum.data()[0] = 0.0F;
    } else if (bin + 1u == half_bins) {
      spectrum.data()[1] = 0.0F;
    } else {
      spectrum.data()[2u * bin] = 0.0F;
      spectrum.data()[2u * bin + 1u] = 0.0F;
    }
  }
  pffft_transform_ordered(setup, spectrum.data(), time.data(), work.data(), PFFFT_BACKWARD);
  std::vector<float> burst(burst_length, 0.0F);
  const double inverse_size = 1.0 / fft_size;
  for (std::uint32_t index = 0u; index < burst_length; ++index) {
    burst[index] = static_cast<float>(time.data()[index] * inverse_size);
  }
  pffft_destroy_setup(setup);
  const auto fade_samples = static_cast<std::uint32_t>(std::llround(0.001 * sample_rate));
  for (std::uint32_t offset = 0u; offset < fade_samples; ++offset) {
    const std::uint32_t index = burst_length - fade_samples + offset;
    const double phase = kPi * static_cast<double>(offset + 1u) / fade_samples;
    burst[index] = static_cast<float>(burst[index] * (0.5 + 0.5 * std::cos(phase)));
  }
  normalizeRms(burst, -25.0);
  for (std::uint32_t second = 3u; second <= 7u; ++second) {
    const std::uint32_t start = second * sample_rate;
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t index = 0u; index < burst_length; ++index) {
        result[static_cast<std::size_t>(channel) * frames + start + index] += burst[index];
      }
    }
  }
  return result;
}

void testLatencyAndReconstruction() {
  struct Case {
    float sample_rate;
    std::uint32_t expected_latency;
  };
  constexpr std::array<Case, 7> cases{{
      {9600.0F, 640u},
      {32000.0F, 2560u},
      {36000.0F, 2560u},
      {44100.0F, 5120u},
      {48000.0F, 5120u},
      {96000.0F, 10240u},
      {192000.0F, 20480u},
  }};
  for (const Case &test : cases) {
    Harness harness(test.sample_rate, 1u);
    harness.stage(parameters(0.0F));
    NR_CHECK(harness.latency() == test.expected_latency);
    NR_CHECK(static_cast<double>(harness.latency()) / test.sample_rate <= 0.120);
    const std::uint32_t fft_size = fftSizeForRate(test.sample_rate);
    NR_CHECK(fft_size + fft_size / 4u == test.expected_latency);
    const std::uint32_t frames = test.expected_latency + fft_size * 2u;
    std::vector<float> impulse(frames, 0.0F);
    impulse[0] = 1.0F;
    const std::vector<float> output = harness.process(impulse);
    const auto peak = static_cast<std::uint32_t>(std::distance(
        output.begin(), std::max_element(output.begin(), output.end(), [](float left, float right) {
          return std::abs(left) < std::abs(right);
        })));
    NR_CHECK(peak == test.expected_latency);
    NR_CHECK(std::abs(output[peak] - 1.0F) <= 2.0e-5F);
    harness.checkScheduler();
  }
  {
    Harness worst_case(192000.0F, 16u);
    worst_case.stage(parameters());
    const std::vector<float> input = uniformNoise(40960u, 16u, 0x3c6ef372u, 0.1);
    const std::vector<float> output = worst_case.process(input);
    NR_CHECK(std::all_of(output.begin(), output.end(),
                         [](float sample) { return std::isfinite(sample); }));
    worst_case.checkScheduler();
  }

  constexpr std::uint32_t frames = kSampleRate * 12u;
  const std::vector<float> input = uniformNoise(frames, 2u, 0x01234567u, 0.9);
  for (float mix : {100.0F, 50.0F, 0.0F}) {
    Harness harness(static_cast<float>(kSampleRate), 2u);
    harness.stage(parameters(0.0F, 0.0F, 50.0F, 50.0F, mix));
    const std::vector<float> output = harness.process(input);
    double maximum_error = 0.0;
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t frame = harness.latency(); frame < frames; ++frame) {
        const std::size_t index = static_cast<std::size_t>(channel) * frames + frame;
        const std::size_t delayed = index - harness.latency();
        const double difference = std::abs(static_cast<double>(output[index]) - input[delayed]);
        if (difference > maximum_error) {
          maximum_error = difference;
        }
      }
    }
    NR_CHECK(maximum_error <= 2.0e-5);
    harness.checkScheduler();
  }
}

void testPreparedCapacityExceedsRuntimeChannels() {
  constexpr std::uint32_t channels = 2u;
  constexpr std::uint32_t frames = 400u * kBlockSize;
  Harness harness(static_cast<float>(kSampleRate), 16u, channels, kBlockSize);
  harness.stage(parameters(0.0F));
  const std::vector<float> input = uniformNoise(frames, channels, 0x510e527fu, 0.25);
  const std::vector<float> output = harness.process(input);

  bool finite = true;
  double energy = 0.0;
  double maximum_error = 0.0;
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = harness.latency(); frame < frames; ++frame) {
      const std::size_t index = static_cast<std::size_t>(channel) * frames + frame;
      const std::size_t delayed = index - harness.latency();
      finite = finite && std::isfinite(output[index]);
      energy += static_cast<double>(output[index]) * output[index];
      const double error = std::abs(static_cast<double>(output[index]) - input[delayed]);
      if (error > maximum_error) {
        maximum_error = error;
      }
    }
  }
  NR_CHECK(finite);
  NR_CHECK(energy > 0.0);
  NR_CHECK(maximum_error <= 2.0e-5);
  harness.checkScheduler();
}

void testParameterSweepAndLifecycle() {
  constexpr std::uint32_t combinations = 32u;
  constexpr std::uint32_t total_frames = kSampleRate * 5u / 2u;
  const std::uint32_t frames_per_combination = total_frames / combinations;
  for (std::uint32_t channels : {1u, 2u, 3u, 16u}) {
    Harness harness(static_cast<float>(kSampleRate), channels);
    for (std::uint32_t mask = 0u; mask < combinations; ++mask) {
      harness.stage(parameters((mask & 1u) != 0u ? 24.0F : 0.0F, (mask & 2u) != 0u ? 12.0F : -12.0F,
                               (mask & 4u) != 0u ? 100.0F : 0.0F, (mask & 8u) != 0u ? 100.0F : 0.0F,
                               (mask & 16u) != 0u ? 100.0F : 0.0F));
      const std::vector<float> input =
          uniformNoise(frames_per_combination, channels, 0x9e3779b9u + mask, 0.9);
      const std::vector<float> output = harness.process(input);
      NR_CHECK(std::all_of(output.begin(), output.end(),
                           [](float sample) { return std::isfinite(sample); }));
    }
    harness.checkScheduler();
  }

  const std::vector<float> first_input = uniformNoise(48000u, 2u, 0x7f4a7c15u, 0.2);
  Harness reused(48000.0F, 2u);
  reused.stage(parameters());
  (void)reused.process(first_input);
  reused.prepare(44100.0F, 3u);
  reused.stage(parameters());
  const std::vector<float> second_input = uniformNoise(44100u, 3u, 0x94d049bbu, 0.2);
  const std::vector<float> reused_output = reused.process(second_input);
  Harness fresh(44100.0F, 3u);
  fresh.stage(parameters());
  const std::vector<float> fresh_output = fresh.process(second_input);
  NR_CHECK(reused_output == fresh_output);
}

void testResetReplay() {
  constexpr std::uint32_t frames = kSampleRate * 3u;
  const std::vector<float> input = uniformNoise(frames, 2u, 0x85ebca6bu, 0.2);
  Harness harness(static_cast<float>(kSampleRate), 2u);
  harness.stage(parameters());
  const std::vector<float> first = harness.process(input);
  harness.reset();
  const std::vector<float> second = harness.process(input);
  NR_CHECK(first == second);
  harness.checkScheduler();
}

void testParameterSnapshotAtJobBoundary() {
  constexpr std::uint32_t sample_rate = 48000u;
  const std::uint32_t fft_size = fftSizeForRate(sample_rate);
  const std::uint32_t hop_size = fft_size / 4u;
  const std::uint32_t job_start = 100u * hop_size;
  const std::uint32_t next_job_start = job_start + hop_size;
  const std::uint32_t frames = job_start + 12u * hop_size;
  const std::vector<float> input = uniformNoise(frames, 1u, 0x243f6a88u, 0.2);
  const Params old_params = parameters(0.0F, -12.0F, 0.0F, 0.0F, 100.0F);
  const Params new_params = parameters(24.0F, 12.0F, 100.0F, 100.0F, 100.0F);

  const auto render_with_change = [&](std::uint32_t change_sample) {
    Harness harness(static_cast<float>(sample_rate), 1u);
    harness.stage(old_params);
    const std::vector<float> before = harness.process(std::vector<float>(
        input.begin(), input.begin() + static_cast<std::ptrdiff_t>(change_sample)));
    harness.stage(new_params);
    const std::vector<float> after = harness.process(std::vector<float>(
        input.begin() + static_cast<std::ptrdiff_t>(change_sample), input.end()));
    std::vector<float> output;
    output.reserve(input.size());
    output.insert(output.end(), before.begin(), before.end());
    output.insert(output.end(), after.begin(), after.end());
    harness.checkScheduler();
    return output;
  };

  const std::vector<float> changed_mid_job = render_with_change(job_start + hop_size / 2u);
  const std::vector<float> changed_before_next_job = render_with_change(next_job_start - 1u);
  NR_CHECK(changed_mid_job == changed_before_next_job);

  Harness unchanged(static_cast<float>(sample_rate), 1u);
  unchanged.stage(old_params);
  NR_CHECK(changed_mid_job != unchanged.process(input));
  unchanged.checkScheduler();
}

void testChannelCountIndependence() {
  constexpr std::uint32_t frames = kSampleRate * 3u;
  const std::vector<float> stereo = uniformNoise(frames, 2u, 0x6a09e667u, 0.4);
  std::vector<float> expanded(static_cast<std::size_t>(frames) * 16u, 0.0F);
  std::memcpy(expanded.data(), stereo.data(),
              static_cast<std::size_t>(frames) * 2u * sizeof(float));
  Harness stereo_harness(static_cast<float>(kSampleRate), 2u);
  stereo_harness.stage(parameters());
  const std::vector<float> stereo_output = stereo_harness.process(stereo);
  Harness expanded_harness(static_cast<float>(kSampleRate), 16u);
  expanded_harness.stage(parameters());
  const std::vector<float> expanded_output = expanded_harness.process(expanded);
  NR_CHECK(std::memcmp(stereo_output.data(), expanded_output.data(),
                       static_cast<std::size_t>(frames) * 2u * sizeof(float)) == 0);
  stereo_harness.checkScheduler();
  expanded_harness.checkScheduler();
}

void testOrthogonalRotation() {
  constexpr std::uint32_t frames = kSampleRate * 12u;
  std::vector<float> input = musicSignal(frames, 2u, kSampleRate);
  const std::vector<float> left_noise = pinkNoise(frames, 1u, 0x85ebca6bu, -35.0);
  const std::vector<float> right_noise = pinkNoise(frames, 1u, 0x27d4eb2fu, -35.0);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    input[frame] += left_noise[frame];
    input[frames + frame] += right_noise[frame];
  }
  constexpr double inverse_root_two = 0.7071067811865475244;
  std::vector<float> rotated(input.size(), 0.0F);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const double left = input[frame];
    const double right = input[frames + frame];
    rotated[frame] = static_cast<float>((left - right) * inverse_root_two);
    rotated[frames + frame] = static_cast<float>((left + right) * inverse_root_two);
  }
  Harness harness(static_cast<float>(kSampleRate), 2u);
  harness.stage(parameters());
  const std::vector<float> direct = harness.process(input);
  harness.reset();
  const std::vector<float> transformed = harness.process(rotated);
  const std::uint32_t fft_size = fftSizeForRate(kSampleRate);
  const std::uint32_t hop_size = fft_size / 4u;
  const std::uint32_t latency = harness.latency();
  const auto init_frames =
      static_cast<std::uint32_t>(std::llround(2.0 / (static_cast<double>(hop_size) / kSampleRate)));
  const std::uint32_t begin = latency + init_frames * hop_size + kSampleRate / 2u;
  double maximum_left = 0.0;
  double maximum_right = 0.0;
  double residual_left = 0.0;
  double residual_right = 0.0;
  for (std::uint32_t frame = begin; frame < frames; ++frame) {
    const double left = direct[frame];
    const double right = direct[frames + frame];
    maximum_left = std::max(maximum_left, std::abs(left));
    maximum_right = std::max(maximum_right, std::abs(right));
    residual_left =
        std::max(residual_left, std::abs(transformed[frame] - (left - right) * inverse_root_two));
    residual_right = std::max(
        residual_right, std::abs(transformed[frames + frame] - (left + right) * inverse_root_two));
  }
  NR_CHECK(residual_left <= 1.0e-5 * maximum_left);
  NR_CHECK(residual_right <= 1.0e-5 * maximum_right);
  harness.checkScheduler();
}

void testQualityMetrics() {
  constexpr std::uint32_t channels = 2u;
  const std::uint32_t fft_size = fftSizeForRate(kSampleRate);
  const std::uint32_t hop_size = fft_size / 4u;
  const auto init_frames =
      static_cast<std::uint32_t>(std::llround(2.0 / (static_cast<double>(hop_size) / kSampleRate)));

  constexpr std::uint32_t long_frames = kSampleRate * 12u;
  const std::vector<float> full_white = uniformNoise(long_frames, channels, 0x01234567u, 0.9);
  Harness gain_harness(static_cast<float>(kSampleRate), channels);
  gain_harness.stage(parameters(24.0F, 12.0F, 0.0F, 100.0F, 100.0F));
  const std::vector<float> gain_output = gain_harness.process(full_white);
  const std::uint32_t latency = gain_harness.latency();
  const std::uint32_t t0 = latency + init_frames * hop_size + kSampleRate / 2u;
  const std::vector<std::uint32_t> gain_starts =
      regularFrameStarts(t0, long_frames, fft_size, hop_size);
  const BandRatios gain_bands = bandRatios(gain_output, full_white, long_frames, channels, latency,
                                           kSampleRate, gain_starts, true);
  NR_CHECK(std::abs(gain_bands.low + 24.0) <= 2.0);
  NR_CHECK(std::abs(gain_bands.middle + 9.6) <= 2.0);
  NR_CHECK(std::abs(gain_bands.high + 9.6) <= 2.0);
  NR_CHECK(std::abs(gain_bands.middle - gain_bands.high) <= 1.0);
  NR_CHECK(gain_bands.low - gain_bands.middle <= -10.0);

  constexpr std::uint32_t noise_frames = kSampleRate * 8u;
  const std::vector<float> noise = whiteNoise(noise_frames, channels, 0x01234567u, -30.0);
  Harness noise_harness(static_cast<float>(kSampleRate), channels);
  noise_harness.stage(parameters());
  const std::vector<float> noise_output = noise_harness.process(noise);
  const double a1 =
      energyRatioDb(noise_output, noise, noise_frames, channels, latency, t0, noise_frames, false);
  const BandRatios noise_bands =
      bandRatios(noise_output, noise, noise_frames, channels, latency, kSampleRate,
                 regularFrameStarts(t0, noise_frames, fft_size, hop_size), false);
  const double a2 = noise_bands.low;
  NR_CHECK(a1 <= -8.0);
  NR_CHECK(a2 <= -10.0);
  NR_CHECK(a1 >= -8.89 - 0.25);
  NR_CHECK(a2 >= -12.00 - 0.25);

  const std::vector<float> music = musicSignal(long_frames, channels, kSampleRate);
  Harness music_harness(static_cast<float>(kSampleRate), channels);
  music_harness.stage(parameters());
  const std::vector<float> music_output = music_harness.process(music);
  const double b =
      energyRatioDb(music_output, music, long_frames, channels, latency, t0, long_frames, true);
  NR_CHECK(b <= -20.5);
  double e = std::numeric_limits<double>::infinity();
  const std::uint32_t e_begin = latency + init_frames * hop_size;
  const std::uint32_t e_window = kSampleRate / 10u;
  for (std::uint32_t window = 0u; window < 10u; ++window) {
    const std::uint32_t begin = e_begin + window * e_window;
    e = std::min(e, energyRatioDb(music_output, music, long_frames, channels, latency, begin,
                                  begin + e_window, false));
  }
  NR_CHECK(e >= -2.0);

  const std::vector<float> mixture_noise = whiteNoise(long_frames, channels, 0x01234567u, -30.0);
  std::vector<float> mixture(music.size(), 0.0F);
  for (std::size_t index = 0u; index < mixture.size(); ++index) {
    mixture[index] = music[index] + mixture_noise[index];
  }
  Harness mixture_harness(static_cast<float>(kSampleRate), channels);
  mixture_harness.stage(parameters());
  const std::vector<float> mixture_output = mixture_harness.process(mixture);
  const std::uint32_t snr_window = kSampleRate / 50u;
  double improvement_sum = 0.0;
  std::uint32_t improvement_windows = 0u;
  for (std::uint32_t begin = t0; begin + snr_window <= long_frames; begin += snr_window) {
    double signal_energy = 0.0;
    double input_noise_energy = 0.0;
    double output_error_energy = 0.0;
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t offset = 0u; offset < snr_window; ++offset) {
        const std::size_t output_index =
            static_cast<std::size_t>(channel) * long_frames + begin + offset;
        const std::size_t input_index = output_index - latency;
        const double clean = music[input_index];
        const double input_noise = mixture[input_index] - clean;
        const double output_error = mixture_output[output_index] - clean;
        signal_energy += clean * clean;
        input_noise_energy += input_noise * input_noise;
        output_error_energy += output_error * output_error;
      }
    }
    const double input_snr = 10.0 * std::log10(signal_energy / input_noise_energy);
    if (input_snr > -10.0) {
      const double output_snr = 10.0 * std::log10(signal_energy / output_error_energy);
      improvement_sum += output_snr - input_snr;
      ++improvement_windows;
    }
  }
  NR_CHECK(improvement_windows > 0u);
  const double c = improvement_sum / improvement_windows;
  NR_CHECK(c >= 2.5);

  const std::vector<float> cymbal = cymbalSignal(long_frames, channels, kSampleRate);
  Harness cymbal_harness(static_cast<float>(kSampleRate), channels);
  cymbal_harness.stage(parameters());
  const std::vector<float> cymbal_output = cymbal_harness.process(cymbal);
  std::vector<std::uint32_t> cymbal_starts;
  for (std::uint32_t second = 3u; second <= 7u; ++second) {
    cymbal_starts.push_back(latency + second * kSampleRate);
  }
  const double d = bandRatios(cymbal_output, cymbal, long_frames, channels, latency, kSampleRate,
                              cymbal_starts, false)
                       .high;
  std::printf("Noise Reduction quality: {\"a1Db\":%.4f,\"a2Db\":%.4f,\"bDb\":%.4f,"
              "\"cDb\":%.4f,\"dDb\":%.4f,\"eDb\":%.4f,\"gainA\":%.4f,"
              "\"gainB\":%.4f,\"gainC\":%.4f}\n",
              a1, a2, b, c, d, e, gain_bands.low, gain_bands.middle, gain_bands.high);
}

} // namespace

int main() {
  testLatencyAndReconstruction();
  testPreparedCapacityExceedsRuntimeChannels();
  testParameterSweepAndLifecycle();
  testResetReplay();
  testParameterSnapshotAtJobBoundary();
  testChannelCountIndependence();
  testOrthogonalRotation();
  testQualityMetrics();
  if (failures != 0) {
    std::fprintf(stderr, "Noise Reduction native tests failed: %d\n", failures);
    return 1;
  }
  std::puts("Noise Reduction native tests passed.");
  return 0;
}

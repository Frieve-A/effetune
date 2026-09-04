#include "HumRemoverPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_HumRemoverPlugin() noexcept;

namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kSampleRate = 96000.0;
constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::uint32_t kQualityFrames = 1152000u;
constexpr std::uint32_t kMeasurementFrames = 96000u;
constexpr std::uint32_t kMeasurementStart = kQualityFrames - kMeasurementFrames;
constexpr std::uint32_t kQualityChannels = 2u;
constexpr std::uint32_t kHarmonics = 8u;
constexpr std::uint32_t kMaximumHarmonics = 64u;
constexpr std::size_t kKernelStorageBytes = 8192u;
constexpr std::size_t kTelemetryBytes = 64u;
constexpr std::uint16_t kTelemetryFrameType = 23u;
using Params = effetune::generated::HumRemoverPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Hum Remover check failed: %s\n", message);
    ++failures;
  }
}

std::uint16_t readU16(const std::uint8_t *input) noexcept {
  return static_cast<std::uint16_t>(input[0]) |
         static_cast<std::uint16_t>(static_cast<std::uint16_t>(input[1]) << 8u);
}

std::uint32_t readU32(const std::uint8_t *input) noexcept {
  return static_cast<std::uint32_t>(input[0]) | (static_cast<std::uint32_t>(input[1]) << 8u) |
         (static_cast<std::uint32_t>(input[2]) << 16u) |
         (static_cast<std::uint32_t>(input[3]) << 24u);
}

float readF32(const std::uint8_t *input) noexcept {
  const std::uint32_t bits = readU32(input);
  float value = 0.0F;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}

Params defaultParams() noexcept { return {0.0F, 8.0F, 50.0F}; }

class KernelHarness final {
public:
  KernelHarness(float sample_rate = static_cast<float>(kSampleRate),
                std::uint32_t max_channels = kQualityChannels,
                std::uint32_t max_frames = kMaximumFrames) {
    descriptor_ = et_kernel_descriptor_HumRemoverPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr) {
      return;
    }
    check(descriptor_->objectSize <= storage_.size(), "kernel fits fixed object storage");
    check(descriptor_->paramsHash == Params::kHash, "descriptor hash matches generated params");
    check(descriptor_->paramsFloatCount == Params::kFloatCount,
          "descriptor parameter count matches generated params");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      kernel_->prepare({sample_rate, max_channels, max_frames});
      check(kernel_->preparedSuccessfully(), "kernel prepares");
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  void stage(const Params &params) noexcept {
    const et_status status =
        kernel_->stageParameters(&params.frequency, Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->applyPendingParameters();
    kernel_->process(audio, channels, frames, {0.0});
  }

  void reset() noexcept { kernel_->reset(); }

  [[nodiscard]] std::uint32_t latency() const noexcept { return kernel_->latencySamples(); }

  std::uint32_t telemetry(std::array<std::uint8_t, kTelemetryBytes> &output,
                          std::uint32_t tap_id = 47u) noexcept {
    std::array<std::uint8_t, kTelemetryBytes> ring_storage{};
    effetune::TelemetryRing ring;
    ring.adopt(ring_storage.data(), static_cast<std::uint32_t>(ring_storage.size()));
    std::uint32_t sequence = 0u;
    effetune::TelemetryWriter writer(ring, tap_id, sequence);
    kernel_->writeTelemetry(writer);
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
    check(dropped == 0u, "telemetry ring accepts the fixed frame");
    return bytes;
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

class Random final {
public:
  explicit Random(std::uint32_t seed) noexcept : state_(seed | 1u) {}

  std::uint32_t next() noexcept {
    state_ ^= state_ << 13u;
    state_ ^= state_ >> 17u;
    state_ ^= state_ << 5u;
    return state_;
  }

  double bipolar() noexcept {
    return 2.0 * static_cast<double>(next() >> 8u) / static_cast<double>(1u << 24u) - 1.0;
  }

private:
  std::uint32_t state_;
};

struct Oscillator {
  double real = 1.0;
  double imaginary = 0.0;
  double rotation_real = 1.0;
  double rotation_imaginary = 0.0;

  void set(double frequency, double sample_rate, double phase = 0.0) noexcept {
    real = std::cos(phase);
    imaginary = std::sin(phase);
    const double radians = 2.0 * kPi * frequency / sample_rate;
    rotation_real = std::cos(radians);
    rotation_imaginary = std::sin(radians);
  }

  void advance() noexcept {
    const double next_real = real * rotation_real - imaginary * rotation_imaginary;
    imaginary = real * rotation_imaginary + imaginary * rotation_real;
    real = next_real;
  }
};

struct TelemetryValues {
  float fundamental = 0.0F;
  float removed = -140.0F;
};

TelemetryValues readTelemetry(KernelHarness &harness) {
  std::array<std::uint8_t, kTelemetryBytes> frame{};
  const std::uint32_t bytes = harness.telemetry(frame);
  check(bytes == 24u, "telemetry frame contains an eight-byte payload");
  if (bytes < 24u) {
    return {};
  }
  check(readU16(frame.data()) == kTelemetryFrameType, "telemetry frame type is 23");
  check(readU16(frame.data() + 2u) == 1u, "telemetry format version is one");
  check(readU32(frame.data() + 4u) == 47u, "telemetry preserves the tap id");
  check(readU16(frame.data() + 12u) == 8u, "telemetry payload size is eight bytes");
  return {readF32(frame.data() + 16u), readF32(frame.data() + 20u)};
}

double humScale() noexcept {
  double inverse_square_sum = 0.0;
  for (std::uint32_t harmonic = 1u; harmonic <= kHarmonics; ++harmonic) {
    inverse_square_sum += 1.0 / static_cast<double>(harmonic * harmonic);
  }
  return 0.1 / std::sqrt(0.5 * inverse_square_sum);
}

class ProjectionMeasurement final {
public:
  ProjectionMeasurement(double frequency, std::uint32_t start_frame) noexcept {
    for (std::uint32_t channel = 0u; channel < kQualityChannels; ++channel) {
      for (std::uint32_t harmonic = 0u; harmonic < kHarmonics; ++harmonic) {
        const double component_frequency = frequency * static_cast<double>(harmonic + 1u);
        const double phase =
            2.0 * kPi * component_frequency * static_cast<double>(start_frame) / kSampleRate;
        oscillators_[index(channel, harmonic)].set(component_frequency, kSampleRate, phase);
      }
    }
  }

  void add(std::uint32_t channel, double input, double output) noexcept {
    for (std::uint32_t harmonic = 0u; harmonic < kHarmonics; ++harmonic) {
      const std::size_t component = index(channel, harmonic);
      Oscillator &oscillator = oscillators_[component];
      input_real_[component] += input * oscillator.real;
      input_imaginary_[component] += input * oscillator.imaginary;
      output_real_[component] += output * oscillator.real;
      output_imaginary_[component] += output * oscillator.imaginary;
      oscillator.advance();
    }
  }

  [[nodiscard]] double inputPower() const noexcept { return power(input_real_, input_imaginary_); }
  [[nodiscard]] double outputPower() const noexcept {
    return power(output_real_, output_imaginary_);
  }

private:
  static constexpr std::size_t kComponents = kQualityChannels * kHarmonics;

  static std::size_t index(std::uint32_t channel, std::uint32_t harmonic) noexcept {
    return static_cast<std::size_t>(channel) * kHarmonics + harmonic;
  }

  static double power(const std::array<double, kComponents> &real,
                      const std::array<double, kComponents> &imaginary) noexcept {
    double total = 0.0;
    const double scale = 2.0 / static_cast<double>(kMeasurementFrames);
    for (std::size_t component = 0u; component < kComponents; ++component) {
      const double real_amplitude = real[component] * scale;
      const double imaginary_amplitude = imaginary[component] * scale;
      total += 0.5 * (real_amplitude * real_amplitude + imaginary_amplitude * imaginary_amplitude);
    }
    return total / static_cast<double>(kQualityChannels);
  }

  std::array<Oscillator, kComponents> oscillators_{};
  std::array<double, kComponents> input_real_{};
  std::array<double, kComponents> input_imaginary_{};
  std::array<double, kComponents> output_real_{};
  std::array<double, kComponents> output_imaginary_{};
};

struct QualityResult {
  double reduction_db = 0.0;
  double difference_rms = 0.0;
  TelemetryValues telemetry{};
};

QualityResult runQualityCase(double hum_frequency, float frequency_mode, bool add_hum,
                             std::uint32_t harmonics = kHarmonics) {
  KernelHarness harness;
  Params params = defaultParams();
  params.frequency = frequency_mode;
  params.harmonics = static_cast<float>(harmonics);
  harness.stage(params);

  std::array<Oscillator, kQualityChannels * 3u> clean_oscillators{};
  std::array<Oscillator, kQualityChannels * kHarmonics> hum_oscillators{};
  for (std::uint32_t channel = 0u; channel < kQualityChannels; ++channel) {
    const double channel_phase = 0.31 * static_cast<double>(channel);
    clean_oscillators[channel * 3u].set(220.0, kSampleRate, channel_phase);
    clean_oscillators[channel * 3u + 1u].set(1370.0, kSampleRate, channel_phase + 0.47);
    clean_oscillators[channel * 3u + 2u].set(3300.0, kSampleRate, channel_phase + 0.83);
    for (std::uint32_t harmonic = 0u; harmonic < kHarmonics; ++harmonic) {
      const double phase = channel_phase + 0.17 * static_cast<double>(harmonic + 1u);
      hum_oscillators[channel * kHarmonics + harmonic].set(
          hum_frequency * static_cast<double>(harmonic + 1u), kSampleRate, phase);
    }
  }
  std::array<Random, kQualityChannels> random = {Random(0xeffe7a5eu), Random(0x7118d279u)};
  ProjectionMeasurement projection(hum_frequency, kMeasurementStart);
  std::array<float, kQualityChannels * kMaximumFrames> audio{};
  std::array<float, kQualityChannels * kMaximumFrames> clean{};
  const double hum_scale = humScale();
  double difference_power = 0.0;
  std::uint64_t difference_count = 0u;

  for (std::uint32_t offset = 0u; offset < kQualityFrames; offset += kMaximumFrames) {
    for (std::uint32_t channel = 0u; channel < kQualityChannels; ++channel) {
      for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
        const std::size_t block_index = static_cast<std::size_t>(channel) * kMaximumFrames + frame;
        Oscillator &low = clean_oscillators[channel * 3u];
        Oscillator &mid = clean_oscillators[channel * 3u + 1u];
        Oscillator &high = clean_oscillators[channel * 3u + 2u];
        const double clean_sample = 0.30 * low.imaginary + 0.20 * mid.imaginary +
                                    0.12 * high.imaginary + 0.05 * random[channel].bipolar();
        low.advance();
        mid.advance();
        high.advance();

        double hum = 0.0;
        for (std::uint32_t harmonic = 0u; harmonic < kHarmonics; ++harmonic) {
          Oscillator &component = hum_oscillators[channel * kHarmonics + harmonic];
          hum += hum_scale * component.imaginary / static_cast<double>(harmonic + 1u);
          component.advance();
        }
        clean[block_index] = static_cast<float>(clean_sample);
        audio[block_index] = static_cast<float>(clean_sample + (add_hum ? hum : 0.0));
      }
    }

    const std::array<float, kQualityChannels * kMaximumFrames> damaged = audio;
    harness.process(audio.data(), kQualityChannels, kMaximumFrames);
    if (offset >= kMeasurementStart) {
      for (std::uint32_t channel = 0u; channel < kQualityChannels; ++channel) {
        for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
          const std::size_t index = static_cast<std::size_t>(channel) * kMaximumFrames + frame;
          projection.add(channel, damaged[index], audio[index]);
          const double difference = static_cast<double>(audio[index]) - clean[index];
          difference_power += difference * difference;
          ++difference_count;
          check(std::isfinite(audio[index]), "quality output remains finite");
        }
      }
    }
  }

  const double input_power = projection.inputPower();
  const double output_power = projection.outputPower();
  QualityResult result;
  result.reduction_db = 10.0 * std::log10(input_power / output_power);
  result.difference_rms = std::sqrt(difference_power / static_cast<double>(difference_count));
  result.telemetry = readTelemetry(harness);
  return result;
}

std::vector<float> renderBlocks(const std::vector<float> &input, bool variable_blocks) {
  KernelHarness harness(static_cast<float>(kSampleRate), 1u, kMaximumFrames);
  harness.stage(defaultParams());
  std::vector<float> output(input.size());
  std::array<float, kMaximumFrames> block{};
  std::uint32_t offset = 0u;
  std::uint32_t sequence = 0u;
  const std::uint32_t total_frames = static_cast<std::uint32_t>(input.size());
  while (offset < total_frames) {
    std::uint32_t frames = variable_blocks ? 4u + sequence % 125u : kMaximumFrames;
    const std::uint32_t remaining = total_frames - offset;
    if (frames > remaining) {
      frames = remaining;
    }
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      block[frame] = input[offset + frame];
    }
    harness.process(block.data(), 1u, frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      output[offset + frame] = block[frame];
    }
    offset += frames;
    ++sequence;
  }
  return output;
}

void testLatencyAndFramePartitioning() {
  KernelHarness harness;
  check(harness.latency() == 0u, "latency is zero");

  constexpr std::uint32_t frames = 8320u;
  std::vector<float> input(frames);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const double time = static_cast<double>(frame) / kSampleRate;
    input[frame] = static_cast<float>(0.17 * std::sin(2.0 * kPi * 997.0 * time) +
                                      0.11 * std::sin(2.0 * kPi * 50.0 * time));
  }
  const std::vector<float> fixed = renderBlocks(input, false);
  const std::vector<float> variable = renderBlocks(input, true);
  double maximum_difference = 0.0;
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const double difference =
        std::abs(static_cast<double>(fixed[frame]) - static_cast<double>(variable[frame]));
    if (difference > maximum_difference) {
      maximum_difference = difference;
    }
  }
  check(maximum_difference <= 2.0e-6, "sample state is independent of frame partitioning");
}

void testChannelIndependence() {
  constexpr std::uint32_t frames = 4096u;
  KernelHarness stereo(static_cast<float>(kSampleRate), 2u, frames);
  KernelHarness left(static_cast<float>(kSampleRate), 1u, frames);
  KernelHarness right(static_cast<float>(kSampleRate), 1u, frames);
  const Params params = defaultParams();
  stereo.stage(params);
  left.stage(params);
  right.stage(params);
  std::vector<float> stereo_audio(2u * frames);
  std::vector<float> left_audio(frames);
  std::vector<float> right_audio(frames);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const double time = static_cast<double>(frame) / kSampleRate;
    left_audio[frame] = static_cast<float>(0.2 * std::sin(2.0 * kPi * 50.0 * time));
    right_audio[frame] = static_cast<float>(0.3 * std::sin(2.0 * kPi * 60.0 * time + 0.4));
    stereo_audio[frame] = left_audio[frame];
    stereo_audio[frames + frame] = right_audio[frame];
  }
  stereo.process(stereo_audio.data(), 2u, frames);
  left.process(left_audio.data(), 1u, frames);
  right.process(right_audio.data(), 1u, frames);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    check(stereo_audio[frame] == left_audio[frame], "left channel matches isolated processing");
    check(stereo_audio[frames + frame] == right_audio[frame],
          "right channel matches isolated processing");
  }
}

void testQualityAndTracking() {
  const QualityResult clean = runQualityCase(50.0, 1.0F, false);
  const QualityResult fixed = runQualityCase(50.0, 1.0F, true);
  const QualityResult fixed_16 = runQualityCase(50.0, 1.0F, true, 16u);
  const QualityResult automatic = runQualityCase(49.9, 0.0F, true);
  std::printf("Hum Remover measured clean RMS %.9f, fixed reduction %.3f dB, "
              "16-harmonic reduction %.3f dB, auto reduction %.3f dB, "
              "auto frequency %.6f Hz\n",
              clean.difference_rms, fixed.reduction_db, fixed_16.reduction_db,
              automatic.reduction_db, automatic.telemetry.fundamental);

  check(clean.difference_rms < 0.01,
        "clean-signal subtraction stays below the measured floor gate");
  check(fixed.reduction_db > 12.0, "fixed 50 Hz mode reduces the injected harmonic basis");
  check(fixed_16.reduction_db > 12.0,
        "the former 16-harmonic maximum retains its hum reduction quality");
  check(fixed_16.difference_rms < 0.015,
        "the former 16-harmonic maximum retains its clean-signal quality");
  check(std::abs(static_cast<double>(automatic.telemetry.fundamental) - 49.9) < 0.04,
        "Auto follows 49.9 Hz with a gate narrower than the initial 0.1 Hz error");
  check(automatic.reduction_db > 8.0, "Auto reduces the tracked harmonic basis");
}

void testMaximumHarmonics() {
  constexpr std::uint32_t frames = 96000u;
  constexpr std::uint32_t measurement_start = frames * 3u / 4u;
  constexpr double amplitude = 0.1;

  Params params = defaultParams();
  params.frequency = 1.0F;
  params.harmonics = static_cast<float>(kMaximumHarmonics);
  params.trackingSpeed = 100.0F;
  KernelHarness fixed(static_cast<float>(kSampleRate), 1u, kMaximumFrames);
  fixed.stage(params);
  Oscillator high_harmonic;
  high_harmonic.set(50.0 * static_cast<double>(kMaximumHarmonics), kSampleRate);
  std::array<float, kMaximumFrames> block{};
  double input_power = 0.0;
  double output_power = 0.0;
  for (std::uint32_t offset = 0u; offset < frames; offset += kMaximumFrames) {
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      const float sample = static_cast<float>(amplitude * high_harmonic.imaginary);
      high_harmonic.advance();
      block[frame] = sample;
      if (offset + frame >= measurement_start) {
        input_power += static_cast<double>(sample) * sample;
      }
    }
    fixed.process(block.data(), 1u, kMaximumFrames);
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      check(std::isfinite(block[frame]), "maximum-harmonic fixed output remains finite");
      if (offset + frame >= measurement_start) {
        output_power += static_cast<double>(block[frame]) * block[frame];
      }
    }
  }
  const double reduction_db = 10.0 * std::log10(input_power / output_power);
  std::printf("Hum Remover measured 64th-harmonic reduction %.3f dB\n", reduction_db);
  check(reduction_db > 30.0, "maximum setting reduces the 64th harmonic");

  params.frequency = 0.0F;
  KernelHarness automatic(static_cast<float>(kSampleRate), 1u, kMaximumFrames);
  automatic.stage(params);
  Oscillator fundamental;
  Oscillator tracked_high_harmonic;
  fundamental.set(49.9, kSampleRate);
  tracked_high_harmonic.set(49.9 * static_cast<double>(kMaximumHarmonics), kSampleRate, 0.37);
  for (std::uint32_t offset = 0u; offset < frames; offset += kMaximumFrames) {
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      block[frame] =
          static_cast<float>(0.08 * fundamental.imaginary + 0.04 * tracked_high_harmonic.imaginary);
      fundamental.advance();
      tracked_high_harmonic.advance();
    }
    automatic.process(block.data(), 1u, kMaximumFrames);
    for (float sample : block) {
      check(std::isfinite(sample), "maximum-harmonic Auto output remains finite");
    }
  }
  const TelemetryValues automatic_values = readTelemetry(automatic);
  check(std::isfinite(automatic_values.fundamental),
        "maximum-harmonic Auto frequency remains finite");
  check(automatic_values.fundamental >= 45.0F && automatic_values.fundamental <= 65.0F,
        "maximum-harmonic Auto frequency stays within its tracking range");
}

void testTelemetryAdaptationAndSilenceFloor() {
  Params params = defaultParams();
  params.frequency = 1.0F;
  KernelHarness active;
  active.stage(params);
  std::array<float, kQualityChannels * kMaximumFrames> block{};
  Oscillator square;
  square.set(50.0, kSampleRate);
  constexpr double amplitude = 0.7079457843841379;
  for (std::uint32_t offset = 0u; offset < kMeasurementFrames; offset += kMaximumFrames) {
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
      const float sample = static_cast<float>(square.imaginary >= 0.0 ? amplitude : -amplitude);
      square.advance();
      block[frame] = sample;
      block[kMaximumFrames + frame] = sample;
    }
    active.process(block.data(), kQualityChannels, kMaximumFrames);
  }
  const TelemetryValues active_values = readTelemetry(active);
  std::printf("Hum Remover measured one-second square-wave Removed %.3f dBFS\n",
              active_values.removed);
  check(active_values.fundamental == 50.0F, "fixed mode telemetry reports 50 Hz");
  check(active_values.removed > -20.0F, "one-second square wave moves the adaptive subtractor");

  KernelHarness silent;
  silent.stage(params);
  block.fill(0.0F);
  for (std::uint32_t offset = 0u; offset < kMeasurementFrames; offset += kMaximumFrames) {
    silent.process(block.data(), kQualityChannels, kMaximumFrames);
  }
  const TelemetryValues silent_values = readTelemetry(silent);
  check(silent_values.removed == -140.0F, "silence telemetry is exactly the defined floor");
}

} // namespace

int main() {
  testLatencyAndFramePartitioning();
  testChannelIndependence();
  testQualityAndTracking();
  testMaximumHarmonics();
  testTelemetryAdaptationAndSilenceFloor();
  if (failures != 0) {
    std::fprintf(stderr, "%d Hum Remover native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Hum Remover native tests passed");
  return 0;
}

#include "effetune/kernel.h"
#include "SpectrumAnalyzerPluginParams.h"

#include "pffft.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace effetune::plugins::analyzer {
namespace {

constexpr std::uint16_t kTapSpectrum = 4u;
constexpr std::uint16_t kTelemetryVersion = 1u;
// v1 bit 0 means pt=14 omitted the top three bins to keep payloadBytes in uint16.
constexpr std::uint16_t kFlagBinsTruncated = 1u << 0u;
// f32 sampleRate, u32 binCount, u16 points, u16 flags, then current[] and peaks[].
constexpr std::uint32_t kPayloadHeaderBytes = 12u;
constexpr std::uint32_t kMinimumPoints = 8u;
constexpr std::uint32_t kMaximumPoints = 14u;
constexpr std::uint32_t kSetupCount = kMaximumPoints - kMinimumPoints + 1u;
constexpr std::uint32_t kMaximumFftSize = 1u << kMaximumPoints;
constexpr std::uint32_t kMaximumBinCount = (kMaximumFftSize >> 1u) + 1u;
constexpr std::uint32_t kWindowFloatCount = (kMaximumFftSize << 1u) - 256u;
constexpr std::uint32_t kMaximumPayloadBinCount = 8190u;
constexpr std::uint32_t kMaximumPayloadBytes = kPayloadHeaderBytes + kMaximumPayloadBinCount * 8u;
constexpr double kPi = 3.14159265358979323846264338327950288;
constexpr double kPowerFloor = 1.0e-24;
constexpr double kCorrectionAcDb = 12.041199826559248;
constexpr double kCorrectionDcDb = 6.020599913279624;
constexpr double kPeakDecayDbPerSecond = 20.0;
constexpr double kFallbackFrameSeconds = 0.02;
constexpr float kMaximumFrameRateHz = 30.0F;

void writeU16(std::uint8_t *output, std::uint16_t value) noexcept {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>(value >> 8u);
}

void writeU32(std::uint8_t *output, std::uint32_t value) noexcept {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>((value >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((value >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>(value >> 24u);
}

void writeF32(std::uint8_t *output, float value) noexcept {
  std::uint32_t bits = 0u;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&bits, &value, sizeof(bits));
  writeU32(output, bits);
}

} // namespace

class SpectrumAnalyzerKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::SpectrumAnalyzerPluginParams)

public:
  ~SpectrumAnalyzerKernel() override { releaseResources(); }

  void prepare(const PrepareInfo &info) override {
    releaseResources();
    sample_rate_ = info.sampleRate;

    ring_ = allocateFloats(kMaximumFftSize);
    fft_input_ = allocateFloats(kMaximumFftSize);
    fft_output_ = allocateFloats(kMaximumFftSize);
    fft_work_ = allocateFloats(kMaximumFftSize);
    windows_ = allocateFloats(kWindowFloatCount);
    current_ = allocateFloats(kMaximumBinCount);
    peaks_ = allocateFloats(kMaximumBinCount);
    payload_.resize(kMaximumPayloadBytes);

    ready_ = ring_ != nullptr && fft_input_ != nullptr && fft_output_ != nullptr &&
             fft_work_ != nullptr && windows_ != nullptr && current_ != nullptr &&
             peaks_ != nullptr && payload_.size() == kMaximumPayloadBytes;
    for (std::uint32_t index = 0u; index < kSetupCount; ++index) {
      const std::uint32_t fft_size = 1u << (kMinimumPoints + index);
      setups_[index] = pffft_new_setup(static_cast<int>(fft_size), PFFFT_REAL);
      if (setups_[index] == nullptr) {
        ready_ = false;
      }
    }
    if (ready_) {
      prepareWindows();
    }
    parameter_state_initialized_ = false;
    reset();
  }

  void reset() noexcept override {
    const std::uint32_t points = parameter_state_initialized_ ? active_points_ : 12u;
    initializeAnalysis(points);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &info) noexcept override {
    if (audio == nullptr || channel_count == 0u || frame_count == 0u || !ready_) {
      return;
    }
    synchronizeParameters();

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const float left = audio[frame];
      const float right = channel_count > 1u ? audio[frame_count + frame] : left;
      ring_[write_position_] = (left + right) * 0.5F;
      write_position_ = (write_position_ + 1u) & (fft_size_ - 1u);

      --samples_until_frame_;
      if (samples_until_frame_ == 0u) {
        const double frame_time = info.timeSeconds + static_cast<double>(frame + 1u) / sample_rate_;
        analyze(frame_time);
        samples_until_frame_ = analysisIntervalFrames();
      }
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!ready_ || !has_frame_ || last_written_generation_ == frame_generation_) {
      return;
    }

    const bool bins_truncated = active_points_ == kMaximumPoints;
    const std::uint32_t source_bin_count = (fft_size_ >> 1u) + 1u;
    const std::uint32_t payload_bin_count =
        bins_truncated ? kMaximumPayloadBinCount : source_bin_count;
    const std::uint16_t flags = bins_truncated ? kFlagBinsTruncated : 0u;

    writeF32(payload_.data(), sample_rate_);
    writeU32(payload_.data() + 4u, payload_bin_count);
    writeU16(payload_.data() + 8u, static_cast<std::uint16_t>(active_points_));
    writeU16(payload_.data() + 10u, flags);
    for (std::uint32_t bin = 0u; bin < payload_bin_count; ++bin) {
      writeF32(payload_.data() + kPayloadHeaderBytes + bin * 4u, current_[bin]);
      writeF32(payload_.data() + kPayloadHeaderBytes + (payload_bin_count + bin) * 4u, peaks_[bin]);
    }

    const std::uint32_t payload_bytes = kPayloadHeaderBytes + payload_bin_count * 8u;
    if (writer.write(kTapSpectrum, kTelemetryVersion, payload_.data(),
                     static_cast<std::uint16_t>(payload_bytes))) {
      last_written_generation_ = frame_generation_;
    }
  }

private:
  static float *allocateFloats(std::uint32_t count) noexcept {
    return static_cast<float *>(pffft_aligned_malloc(sizeof(float) * count));
  }

  void releaseResources() noexcept {
    for (PFFFT_Setup *&setup : setups_) {
      if (setup != nullptr) {
        pffft_destroy_setup(setup);
        setup = nullptr;
      }
    }
    releaseFloats(ring_);
    releaseFloats(fft_input_);
    releaseFloats(fft_output_);
    releaseFloats(fft_work_);
    releaseFloats(windows_);
    releaseFloats(current_);
    releaseFloats(peaks_);
    ready_ = false;
  }

  static void releaseFloats(float *&buffer) noexcept {
    if (buffer != nullptr) {
      pffft_aligned_free(buffer);
      buffer = nullptr;
    }
  }

  void prepareWindows() noexcept {
    for (std::uint32_t points = kMinimumPoints; points <= kMaximumPoints; ++points) {
      const std::uint32_t fft_size = 1u << points;
      float *window = windows_ + fft_size - (1u << kMinimumPoints);
      const double factor = 2.0 * kPi / static_cast<double>(fft_size);
      for (std::uint32_t index = 0u; index < fft_size; ++index) {
        window[index] =
            static_cast<float>(0.5 * (1.0 - std::cos(factor * static_cast<double>(index))));
      }
    }
  }

  void synchronizeParameters() noexcept {
    if (!parameter_state_initialized_) {
      initializeAnalysis(12u);
    }
    if (!paramsDirty()) {
      return;
    }
    int requested = static_cast<int>(params_.points);
    if (requested < static_cast<int>(kMinimumPoints)) {
      requested = static_cast<int>(kMinimumPoints);
    } else if (requested > static_cast<int>(kMaximumPoints)) {
      requested = static_cast<int>(kMaximumPoints);
    }
    const std::uint32_t points = static_cast<std::uint32_t>(requested);
    if (points != active_points_) {
      initializeAnalysis(points);
    }
  }

  void initializeAnalysis(std::uint32_t points) noexcept {
    active_points_ = points;
    fft_size_ = 1u << active_points_;
    setup_ = setups_[active_points_ - kMinimumPoints];
    window_ = windows_ == nullptr ? nullptr : windows_ + fft_size_ - (1u << kMinimumPoints);
    write_position_ = 0u;
    const std::uint32_t interval = analysisIntervalFrames();
    samples_until_frame_ = fft_size_ < interval ? fft_size_ : interval;
    has_frame_ = false;
    last_frame_time_ = 0.0;
    frame_generation_ = 0u;
    last_written_generation_ = 0u;
    parameter_state_initialized_ = true;
    if (!ready_) {
      return;
    }
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      ring_[index] = 0.0F;
      fft_input_[index] = 0.0F;
      fft_output_[index] = 0.0F;
      fft_work_[index] = 0.0F;
    }
    const std::uint32_t bin_count = (fft_size_ >> 1u) + 1u;
    for (std::uint32_t bin = 0u; bin < bin_count; ++bin) {
      current_[bin] = -144.0F;
      peaks_[bin] = -144.0F;
    }
  }

  std::uint32_t analysisIntervalFrames() const noexcept {
    std::uint32_t rate_limited = static_cast<std::uint32_t>(sample_rate_ / kMaximumFrameRateHz);
    if (static_cast<float>(rate_limited) * kMaximumFrameRateHz < sample_rate_) {
      ++rate_limited;
    }
    if (rate_limited == 0u) {
      rate_limited = 1u;
    }
    const std::uint32_t fft_hop = fft_size_ >> 1u;
    return fft_hop > rate_limited ? fft_hop : rate_limited;
  }

  void analyze(double frame_time) noexcept {
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const std::uint32_t source = (write_position_ + index) & (fft_size_ - 1u);
      fft_input_[index] = ring_[source] * window_[index];
    }
    pffft_transform_ordered(setup_, fft_input_, fft_output_, fft_work_, PFFFT_FORWARD);

    const double inverse_size = 1.0 / static_cast<double>(fft_size_);
    const double delta_time = has_frame_ && last_frame_time_ < frame_time
                                  ? frame_time - last_frame_time_
                                  : kFallbackFrameSeconds;
    const double decay = kPeakDecayDbPerSecond * delta_time;
    const std::uint32_t bin_count = (fft_size_ >> 1u) + 1u;
    for (std::uint32_t bin = 0u; bin < bin_count; ++bin) {
      const bool nyquist = bin == (fft_size_ >> 1u);
      const std::uint32_t real_index = bin == 0u ? 0u : (nyquist ? 1u : bin * 2u);
      const double real = static_cast<double>(fft_output_[real_index]) * inverse_size;
      const double imaginary = bin == 0u || nyquist
                                   ? 0.0
                                   : static_cast<double>(fft_output_[bin * 2u + 1u]) * inverse_size;
      const double power = real * real + imaginary * imaginary;
      const double correction = bin == 0u ? kCorrectionDcDb : kCorrectionAcDb;
      const float level = static_cast<float>(10.0 * std::log10(power + kPowerFloor) + correction);
      current_[bin] = level;

      float previous_peak = peaks_[bin];
      if (!std::isfinite(previous_peak) || previous_peak < -145.0F || previous_peak > 0.0F) {
        previous_peak = -145.0F;
      }
      const float decayed_peak = static_cast<float>(static_cast<double>(previous_peak) - decay);
      float peak = level > decayed_peak ? level : decayed_peak;
      if (peak < -145.0F) {
        peak = -145.0F;
      } else if (peak > 0.0F) {
        peak = 0.0F;
      }
      peaks_[bin] = peak;
    }

    has_frame_ = true;
    last_frame_time_ = frame_time;
    ++frame_generation_;
  }

  std::array<PFFFT_Setup *, kSetupCount> setups_{};
  PFFFT_Setup *setup_ = nullptr;
  float *ring_ = nullptr;
  float *fft_input_ = nullptr;
  float *fft_output_ = nullptr;
  float *fft_work_ = nullptr;
  float *windows_ = nullptr;
  float *window_ = nullptr;
  float *current_ = nullptr;
  float *peaks_ = nullptr;
  std::vector<std::uint8_t> payload_;
  float sample_rate_ = 48000.0F;
  double last_frame_time_ = 0.0;
  std::uint32_t active_points_ = 12u;
  std::uint32_t fft_size_ = 1u << 12u;
  std::uint32_t write_position_ = 0u;
  std::uint32_t samples_until_frame_ = 1u << 11u;
  std::uint32_t frame_generation_ = 0u;
  std::uint32_t last_written_generation_ = 0u;
  bool ready_ = false;
  bool has_frame_ = false;
  bool parameter_state_initialized_ = false;
};

} // namespace effetune::plugins::analyzer

EFFETUNE_REGISTER_KERNEL(SpectrumAnalyzerPlugin,
                         effetune::plugins::analyzer::SpectrumAnalyzerKernel)

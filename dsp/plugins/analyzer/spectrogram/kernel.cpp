#include "effetune/kernel.h"
#include "SpectrogramPluginParams.h"

#include "pffft.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace effetune::plugins::analyzer {
namespace {

constexpr std::uint16_t kTapSpectrogramColumn = 5u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kPayloadHeaderBytes = 12u;
constexpr std::uint32_t kCellCount = 256u;
constexpr std::uint32_t kPayloadBytes = kPayloadHeaderBytes + kCellCount;
constexpr std::uint32_t kPendingColumnCapacity = 128u;
constexpr std::uint32_t kMinimumPoints = 8u;
constexpr std::uint32_t kMaximumPoints = 14u;
constexpr std::uint32_t kSetupCount = kMaximumPoints - kMinimumPoints + 1u;
constexpr std::uint32_t kMaximumFftSize = 1u << kMaximumPoints;
constexpr std::uint32_t kMaximumBinCount = kMaximumFftSize >> 1u;
constexpr std::uint32_t kWindowFloatCount = (kMaximumFftSize << 1u) - 256u;
constexpr double kPi = 3.14159265358979323846264338327950288;
constexpr double kPowerFloor = 1.0e-24;
constexpr double kCorrectionAcDb = 12.041199826559248;
constexpr double kCorrectionDcDb = 6.020599913279624;
constexpr double kMinimumLevelDb = -144.0;
constexpr double kMinimumDisplayFrequency = 20.0;
constexpr double kLogMinimumFrequency = 1.3010299956639811952;
constexpr double kLogMaximumFrequency = 4.6020599913279623904;
constexpr double kLogFrequencyRange = kLogMaximumFrequency - kLogMinimumFrequency;

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

class SpectrogramKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::SpectrogramPluginParams)

public:
  ~SpectrogramKernel() override { releaseResources(); }

  void prepare(const PrepareInfo &info) override {
    releaseResources();
    sample_rate_ = info.sampleRate > 0.0F ? info.sampleRate : 48000.0F;

    ring_ = allocateFloats(kMaximumFftSize);
    fft_input_ = allocateFloats(kMaximumFftSize);
    fft_output_ = allocateFloats(kMaximumFftSize);
    fft_work_ = allocateFloats(kMaximumFftSize);
    windows_ = allocateFloats(kWindowFloatCount);
    spectrum_ = allocateFloats(kMaximumBinCount);
    pending_columns_.resize(kPendingColumnCapacity * kPayloadBytes);

    ready_ = ring_ != nullptr && fft_input_ != nullptr && fft_output_ != nullptr &&
             fft_work_ != nullptr && windows_ != nullptr && spectrum_ != nullptr &&
             pending_columns_.size() == kPendingColumnCapacity * kPayloadBytes;
    for (std::uint32_t index = 0u; index < kSetupCount; ++index) {
      const std::uint32_t fft_size = 1u << (kMinimumPoints + index);
      setups_[index] = pffft_new_setup(static_cast<int>(fft_size), PFFFT_REAL);
      if (setups_[index] == nullptr) {
        ready_ = false;
      }
    }
    if (ready_) {
      prepareWindows();
      prepareDisplayFrequencies();
    }
    parameter_state_initialized_ = false;
    reset();
  }

  void reset() noexcept override {
    active_db_range_ = parameter_state_initialized_ ? active_db_range_ : -96.0F;
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
        samples_until_frame_ = fft_size_ >> 1u;
      }
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!ready_) {
      return;
    }
    while (pending_column_count_ != 0u) {
      const std::uint8_t *payload = pending_columns_.data() + pending_read_column_ * kPayloadBytes;
      if (!writer.write(kTapSpectrogramColumn, kTelemetryVersion, payload,
                        static_cast<std::uint16_t>(kPayloadBytes))) {
        return;
      }
      pending_read_column_ = (pending_read_column_ + 1u) % kPendingColumnCapacity;
      --pending_column_count_;
    }
  }

private:
  static float *allocateFloats(std::uint32_t count) noexcept {
    return static_cast<float *>(pffft_aligned_malloc(sizeof(float) * count));
  }

  static void releaseFloats(float *&buffer) noexcept {
    if (buffer != nullptr) {
      pffft_aligned_free(buffer);
      buffer = nullptr;
    }
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
    releaseFloats(spectrum_);
    pending_columns_.clear();
    ready_ = false;
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

  void prepareDisplayFrequencies() noexcept {
    for (std::uint32_t y = 0u; y < kCellCount; ++y) {
      display_frequencies_[y] =
          std::pow(10.0, kLogMaximumFrequency -
                             (static_cast<double>(y) / static_cast<double>(kCellCount - 1u)) *
                                 kLogFrequencyRange);
    }
  }

  void synchronizeParameters() noexcept {
    if (!parameter_state_initialized_) {
      initializeAnalysis(12u);
    }
    if (!paramsDirty()) {
      return;
    }

    float requested_range = params_.dBRange;
    if (!std::isfinite(requested_range)) {
      requested_range = -96.0F;
    } else if (requested_range < -144.0F) {
      requested_range = -144.0F;
    } else if (requested_range > -48.0F) {
      requested_range = -48.0F;
    }
    active_db_range_ = requested_range;

    int requested_points = 12;
    if (std::isfinite(params_.points)) {
      requested_points = static_cast<int>(params_.points);
    }
    if (requested_points < static_cast<int>(kMinimumPoints)) {
      requested_points = static_cast<int>(kMinimumPoints);
    } else if (requested_points > static_cast<int>(kMaximumPoints)) {
      requested_points = static_cast<int>(kMaximumPoints);
    }
    const std::uint32_t points = static_cast<std::uint32_t>(requested_points);
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
    samples_until_frame_ = fft_size_ >> 1u;
    pending_read_column_ = 0u;
    pending_write_column_ = 0u;
    pending_column_count_ = 0u;
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
    for (std::uint32_t bin = 0u; bin < (fft_size_ >> 1u); ++bin) {
      spectrum_[bin] = static_cast<float>(kMinimumLevelDb);
    }
  }

  void analyze(double frame_time) noexcept {
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const std::uint32_t source = (write_position_ + index) & (fft_size_ - 1u);
      fft_input_[index] = ring_[source] * window_[index];
    }
    pffft_transform_ordered(setup_, fft_input_, fft_output_, fft_work_, PFFFT_FORWARD);

    const std::uint32_t bin_count = fft_size_ >> 1u;
    const double normalization_db = -20.0 * std::log10(static_cast<double>(fft_size_));
    for (std::uint32_t bin = 0u; bin < bin_count; ++bin) {
      const std::uint32_t real_index = bin == 0u ? 0u : bin * 2u;
      const double real = static_cast<double>(fft_output_[real_index]);
      const double imaginary = bin == 0u ? 0.0 : static_cast<double>(fft_output_[bin * 2u + 1u]);
      const double power = real * real + imaginary * imaginary;
      const double correction = bin == 0u ? kCorrectionDcDb : kCorrectionAcDb;
      double level = 10.0 * std::log10(power + kPowerFloor) + correction + normalization_db;
      if (level < kMinimumLevelDb) {
        level = kMinimumLevelDb;
      }
      spectrum_[bin] = static_cast<float>(level);
    }

    enqueueColumn(frame_time);
  }

  void enqueueColumn(double frame_time) noexcept {
    if (pending_column_count_ == kPendingColumnCapacity) {
      pending_read_column_ = (pending_read_column_ + 1u) % kPendingColumnCapacity;
      --pending_column_count_;
    }
    std::uint8_t *payload = pending_columns_.data() + pending_write_column_ * kPayloadBytes;
    writeF32(payload, sample_rate_);
    writeF32(payload + 4u, static_cast<float>(frame_time));
    writeU16(payload + 8u, static_cast<std::uint16_t>(kCellCount));
    writeU16(payload + 10u, static_cast<std::uint16_t>(active_points_));

    const double nyquist = static_cast<double>(sample_rate_) * 0.5;
    const double range = -static_cast<double>(active_db_range_);
    const std::uint32_t bin_count = fft_size_ >> 1u;
    for (std::uint32_t y = 0u; y < kCellCount; ++y) {
      double level = kMinimumLevelDb;
      const double frequency = display_frequencies_[y];
      if (frequency >= kMinimumDisplayFrequency && frequency <= nyquist) {
        const double bin_position =
            frequency * static_cast<double>(fft_size_) / static_cast<double>(sample_rate_);
        const std::uint32_t bin1 = static_cast<std::uint32_t>(std::floor(bin_position));
        if (bin1 < bin_count) {
          const std::uint32_t bin2 = bin1 + 1u < bin_count ? bin1 + 1u : bin1;
          const double fraction = bin_position - static_cast<double>(bin1);
          level = static_cast<double>(spectrum_[bin1]) +
                  (static_cast<double>(spectrum_[bin2]) - static_cast<double>(spectrum_[bin1])) *
                      fraction;
        }
      }

      double normalized = (level - static_cast<double>(active_db_range_)) / range;
      if (normalized < 0.0) {
        normalized = 0.0;
      } else if (normalized > 1.0) {
        normalized = 1.0;
      }
      payload[kPayloadHeaderBytes + y] = static_cast<std::uint8_t>(normalized * 255.0 + 0.5);
    }

    pending_write_column_ = (pending_write_column_ + 1u) % kPendingColumnCapacity;
    ++pending_column_count_;
  }

  std::array<PFFFT_Setup *, kSetupCount> setups_{};
  PFFFT_Setup *setup_ = nullptr;
  float *ring_ = nullptr;
  float *fft_input_ = nullptr;
  float *fft_output_ = nullptr;
  float *fft_work_ = nullptr;
  float *windows_ = nullptr;
  float *window_ = nullptr;
  float *spectrum_ = nullptr;
  std::array<double, kCellCount> display_frequencies_{};
  std::vector<std::uint8_t> pending_columns_;
  float sample_rate_ = 48000.0F;
  float active_db_range_ = -96.0F;
  std::uint32_t active_points_ = 12u;
  std::uint32_t fft_size_ = 1u << 12u;
  std::uint32_t write_position_ = 0u;
  std::uint32_t samples_until_frame_ = 1u << 11u;
  std::uint32_t pending_read_column_ = 0u;
  std::uint32_t pending_write_column_ = 0u;
  std::uint32_t pending_column_count_ = 0u;
  bool ready_ = false;
  bool parameter_state_initialized_ = false;
};

} // namespace effetune::plugins::analyzer

EFFETUNE_REGISTER_KERNEL(SpectrogramPlugin, effetune::plugins::analyzer::SpectrogramKernel)

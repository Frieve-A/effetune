#include "effetune/kernel.h"
#include "PhaseSelectEqPluginParams.h"

#include <pffft.h>

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <utility>
#include <vector>

namespace effetune::plugins::spatial {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kRadiansToDegrees = 180.0 / kPi;
constexpr std::uint32_t kMaximumChannels = 8u;
constexpr std::uint32_t kProcessedChannels = 2u;
constexpr std::uint32_t kRegionCount = 5u;
constexpr std::uint32_t kAnalysisSlots = 8u;
constexpr std::uint32_t kSynthesisSlots = 8u;
constexpr std::uint32_t kMaskSlot = 16u;
constexpr std::uint32_t kLogicalSlots = 32u;
constexpr std::uint16_t kTapPhaseSelectMap = 20u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kTelemetryHeaderBytes = 16u;
constexpr std::uint32_t kMaximumTelemetryPoints = 512u;
constexpr std::uint32_t kMaximumTelemetryPayloadBytes =
    kTelemetryHeaderBytes + kMaximumTelemetryPoints * 12u;
constexpr float kMaximumTelemetryRateHz = 15.0F;
constexpr double kPhaseAbsolutePowerFloor = 1.0e-24;
constexpr double kPhaseRelativePowerFloor = 1.0e-12;
constexpr std::uint16_t kUnusedTelemetryCell = 0xffffu;

std::uint32_t fftSizeForSampleRate(double sample_rate) noexcept {
  const auto rounded = static_cast<std::uint32_t>(std::llround(sample_rate));
  if (std::abs(sample_rate - static_cast<double>(rounded)) <= 0.01) {
    switch (rounded) {
    case 44100u:
    case 48000u:
      return 4096u;
    case 88200u:
    case 96000u:
      return 8192u;
    case 176400u:
    case 192000u:
      return 16384u;
    default:
      break;
    }
  }

  const double requested = std::ceil(sample_rate * 0.085);
  std::uint32_t size = 2048u;
  while (size < 32768u && static_cast<double>(size) < requested) {
    size <<= 1u;
  }
  return size;
}

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

class AlignedFloatBuffer final {
public:
  AlignedFloatBuffer() = default;
  ~AlignedFloatBuffer() { release(); }

  AlignedFloatBuffer(const AlignedFloatBuffer &) = delete;
  AlignedFloatBuffer &operator=(const AlignedFloatBuffer &) = delete;

  AlignedFloatBuffer(AlignedFloatBuffer &&other) noexcept { swap(other); }
  AlignedFloatBuffer &operator=(AlignedFloatBuffer &&other) noexcept {
    if (this != &other) {
      release();
      swap(other);
    }
    return *this;
  }

  bool allocate(std::size_t count) noexcept {
    release();
    if (count == 0u) {
      return true;
    }
    data_ = static_cast<float *>(pffft_aligned_malloc(count * sizeof(float)));
    if (data_ == nullptr) {
      return false;
    }
    count_ = count;
    clear();
    return true;
  }

  void clear() noexcept {
    if (data_ != nullptr) {
      std::memset(data_, 0, count_ * sizeof(float));
    }
  }

  void release() noexcept {
    pffft_aligned_free(data_);
    data_ = nullptr;
    count_ = 0u;
  }

  [[nodiscard]] float *data() noexcept { return data_; }
  [[nodiscard]] const float *data() const noexcept { return data_; }
  [[nodiscard]] float &operator[](std::size_t index) noexcept { return data_[index]; }
  [[nodiscard]] const float &operator[](std::size_t index) const noexcept { return data_[index]; }

private:
  void swap(AlignedFloatBuffer &other) noexcept {
    std::swap(data_, other.data_);
    std::swap(count_, other.count_);
  }

  float *data_ = nullptr;
  std::size_t count_ = 0u;
};

struct RegionSnapshot {
  double outerFrequencyLowLog2 = 0.0;
  double coreFrequencyLowLog2 = 0.0;
  double coreFrequencyHighLog2 = 0.0;
  double outerFrequencyHighLog2 = 0.0;
  double outerPhaseLow = 0.0;
  double corePhaseLow = 0.0;
  double corePhaseHigh = 0.0;
  double outerPhaseHigh = 0.0;
  double gain = 1.0;
  bool enabled = false;
};

double bounded(float value, double lower, double upper, double fallback) noexcept {
  if (!std::isfinite(value)) {
    return fallback;
  }
  const double converted = static_cast<double>(value);
  if (converted < lower) {
    return lower;
  }
  return converted > upper ? upper : converted;
}

double smooth01(double value) noexcept {
  if (value <= 0.0) {
    return 0.0;
  }
  if (value >= 1.0) {
    return 1.0;
  }
  return 0.5 - 0.5 * std::cos(kPi * value);
}

double lowRamp(double value, double outer, double core) noexcept {
  if (value < outer) {
    return 0.0;
  }
  if (value >= core || core <= outer) {
    return 1.0;
  }
  return smooth01((value - outer) / (core - outer));
}

double highRamp(double value, double core, double outer) noexcept {
  if (value > outer) {
    return 0.0;
  }
  if (value <= core || outer <= core) {
    return 1.0;
  }
  return smooth01((outer - value) / (outer - core));
}

double regionWeight(const RegionSnapshot &region, double frequency_log2,
                    double phase_degrees) noexcept {
  const double frequency_weight =
      lowRamp(frequency_log2, region.outerFrequencyLowLog2, region.coreFrequencyLowLog2) *
      highRamp(frequency_log2, region.coreFrequencyHighLog2, region.outerFrequencyHighLog2);
  if (frequency_weight == 0.0) {
    return 0.0;
  }
  return frequency_weight * lowRamp(phase_degrees, region.outerPhaseLow, region.corePhaseLow) *
         highRamp(phase_degrees, region.corePhaseHigh, region.outerPhaseHigh);
}

} // namespace

class PhaseSelectEqKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::PhaseSelectEqPluginParams)

public:
  ~PhaseSelectEqKernel() override { releaseSetup(); }

  void prepare(const PrepareInfo &info) override {
    releaseSetup();
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    if (!std::isfinite(sample_rate_) || sample_rate_ <= 0.0 || max_channels_ == 0u ||
        max_channels_ > kMaximumChannels || max_frames_ == 0u) {
      return;
    }

    fft_size_ = fftSizeForSampleRate(sample_rate_);
    hop_size_ = fft_size_ / 4u;
    stage_slot_samples_ = hop_size_ / kLogicalSlots;
    timeline_size_ = fft_size_ + hop_size_;
    bin_count_ = fft_size_ / 2u + 1u;
    const double display_limit = sample_rate_ * 0.49;
    processing_max_frequency_ = display_limit < 40000.0 ? display_limit : 40000.0;
    telemetry_interval_samples_ =
        static_cast<std::uint64_t>(std::ceil(sample_rate_ / kMaximumTelemetryRateHz));
    if (telemetry_interval_samples_ == 0u) {
      telemetry_interval_samples_ = 1u;
    }

    setup_ = pffft_new_setup(static_cast<int>(fft_size_), PFFFT_REAL);
    const std::size_t dry_samples = static_cast<std::size_t>(max_channels_) * timeline_size_;
    const std::size_t stereo_timeline_samples =
        static_cast<std::size_t>(kProcessedChannels) * timeline_size_;
    const std::size_t stereo_spectrum_samples =
        static_cast<std::size_t>(kProcessedChannels) * fft_size_;
    prepared_ = setup_ != nullptr && input_ring_.allocate(stereo_timeline_samples) &&
                dry_ring_.allocate(dry_samples) && output_ring_.allocate(stereo_timeline_samples) &&
                spectra_.allocate(stereo_spectrum_samples) && window_.allocate(fft_size_) &&
                fft_input_.allocate(fft_size_) && fft_work_.allocate(fft_size_) &&
                inverse_output_.allocate(fft_size_);
    if (!prepared_) {
      return;
    }

    bin_log_frequency_.assign(bin_count_, 0.0);
    bin_telemetry_cell_.assign(bin_count_, kUnusedTelemetryCell);
    telemetry_cell_energy_.assign(kMaximumTelemetryPoints, 0.0);
    telemetry_cell_bin_.assign(kMaximumTelemetryPoints, 0u);
    telemetry_cell_phase_.assign(kMaximumTelemetryPoints, 0.0F);
    telemetry_payload_.assign(kMaximumTelemetryPayloadBytes, 0u);

    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const double phase = 2.0 * kPi * static_cast<double>(index) / static_cast<double>(fft_size_);
      window_[index] = static_cast<float>(std::sqrt(0.5 - 0.5 * std::cos(phase)));
    }
    prepareBinMetadata();
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return prepared_ ? timeline_size_ : 0u;
  }

  void reset() noexcept override {
    input_ring_.clear();
    dry_ring_.clear();
    output_ring_.clear();
    spectra_.clear();
    fft_input_.clear();
    fft_work_.clear();
    inverse_output_.clear();
    timeline_position_ = 0u;
    current_channel_count_ = 0u;
    absolute_sample_ = 0u;
    next_frame_sample_ = hop_size_;
    job_start_sample_ = 0u;
    job_frame_origin_ = 0u;
    job_output_origin_ = 0u;
    job_slot_ = 0u;
    job_active_ = false;
    job_identity_ = true;
    wet_mix_ = 0.0;
    next_telemetry_sample_ = 0u;
    telemetry_payload_bytes_ = 0u;
    telemetry_generation_ = 0u;
    last_written_telemetry_generation_ = 0u;
    has_telemetry_frame_ = false;
    clearTelemetryCells();
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }
    if (current_channel_count_ != 0u && current_channel_count_ != channel_count) {
      reset();
    }
    current_channel_count_ = channel_count;

    const bool target_wet = channel_count >= kProcessedChannels && requestedWet();
    const double mix_step = 1.0 / static_cast<double>(hop_size_);
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      if (!target_wet) {
        wet_mix_ -= mix_step;
        if (wet_mix_ < 0.0) {
          wet_mix_ = 0.0;
        }
      } else if (absolute_sample_ >= timeline_size_) {
        wet_mix_ += mix_step;
        if (wet_mix_ > 1.0) {
          wet_mix_ = 1.0;
        }
      }

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t block_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const std::size_t dry_index =
            static_cast<std::size_t>(channel) * timeline_size_ + timeline_position_;
        const float input = std::isfinite(audio[block_index]) ? audio[block_index] : 0.0F;
        const float dry = dry_ring_[dry_index];
        dry_ring_[dry_index] = input;

        if (channel < kProcessedChannels) {
          const std::size_t stereo_index =
              static_cast<std::size_t>(channel) * timeline_size_ + timeline_position_;
          const float wet = output_ring_[stereo_index];
          input_ring_[stereo_index] = input;
          output_ring_[stereo_index] = 0.0F;
          const double mixed = static_cast<double>(dry) +
                               (static_cast<double>(wet) - static_cast<double>(dry)) * wet_mix_;
          audio[block_index] = std::isfinite(mixed) ? static_cast<float>(mixed) : dry;
        } else {
          audio[block_index] = dry;
        }
      }

      ++timeline_position_;
      if (timeline_position_ == timeline_size_) {
        timeline_position_ = 0u;
      }
      ++absolute_sample_;
      advanceStagedJob();
      if (absolute_sample_ == next_frame_sample_) {
        if (channel_count >= kProcessedChannels) {
          startStagedJob();
        }
        next_frame_sample_ += hop_size_;
      }
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!prepared_ || !has_telemetry_frame_ ||
        last_written_telemetry_generation_ == telemetry_generation_) {
      return;
    }
    if (writer.write(kTapPhaseSelectMap, kTelemetryVersion, telemetry_payload_.data(),
                     telemetry_payload_bytes_)) {
      last_written_telemetry_generation_ = telemetry_generation_;
    }
  }

private:
  void releaseSetup() noexcept {
    if (setup_ != nullptr) {
      pffft_destroy_setup(setup_);
      setup_ = nullptr;
    }
    prepared_ = false;
  }

  void prepareBinMetadata() noexcept {
    if (processing_max_frequency_ <= 20.0) {
      return;
    }
    const double minimum_log = std::log2(20.0);
    const double maximum_log = std::log2(processing_max_frequency_);
    const double log_span = maximum_log - minimum_log;
    for (std::uint32_t bin = 1u; bin + 1u < bin_count_; ++bin) {
      const double frequency =
          static_cast<double>(bin) * sample_rate_ / static_cast<double>(fft_size_);
      if (frequency < 20.0 || frequency > processing_max_frequency_) {
        continue;
      }
      const double frequency_log = std::log2(frequency);
      bin_log_frequency_[bin] = frequency_log;
      double position = (frequency_log - minimum_log) / log_span;
      if (position < 0.0) {
        position = 0.0;
      } else if (position > 1.0) {
        position = 1.0;
      }
      std::uint32_t cell =
          static_cast<std::uint32_t>(position * static_cast<double>(kMaximumTelemetryPoints));
      if (cell >= kMaximumTelemetryPoints) {
        cell = kMaximumTelemetryPoints - 1u;
      }
      bin_telemetry_cell_[bin] = static_cast<std::uint16_t>(cell);
    }
  }

  [[nodiscard]] bool requestedWet() const noexcept {
    for (std::uint32_t region = 0u; region < kRegionCount; ++region) {
      if (params_.enabled[region] >= 0.5F && std::isfinite(params_.gain[region]) &&
          params_.gain[region] != 100.0F) {
        return true;
      }
    }
    return false;
  }

  [[nodiscard]] RegionSnapshot snapshotRegion(std::uint32_t index) const noexcept {
    double outer_frequency_low = bounded(params_.outerFrequencyLow[index], 20.0, 40000.0, 80.0);
    double core_frequency_low = bounded(params_.coreFrequencyLow[index], 20.0, 40000.0, 100.0);
    double core_frequency_high = bounded(params_.coreFrequencyHigh[index], 20.0, 40000.0, 10000.0);
    double outer_frequency_high =
        bounded(params_.outerFrequencyHigh[index], 20.0, 40000.0, 12000.0);
    if (core_frequency_low < outer_frequency_low) {
      core_frequency_low = outer_frequency_low;
    }
    if (core_frequency_high < core_frequency_low) {
      core_frequency_high = core_frequency_low;
    }
    if (outer_frequency_high < core_frequency_high) {
      outer_frequency_high = core_frequency_high;
    }

    double outer_phase_low = bounded(params_.outerPhaseLow[index], 0.0, 180.0, 0.0);
    double core_phase_low = bounded(params_.corePhaseLow[index], 0.0, 180.0, 0.0);
    double core_phase_high = bounded(params_.corePhaseHigh[index], 0.0, 180.0, 30.0);
    double outer_phase_high = bounded(params_.outerPhaseHigh[index], 0.0, 180.0, 45.0);
    if (core_phase_low < outer_phase_low) {
      core_phase_low = outer_phase_low;
    }
    if (core_phase_high < core_phase_low) {
      core_phase_high = core_phase_low;
    }
    if (outer_phase_high < core_phase_high) {
      outer_phase_high = core_phase_high;
    }

    RegionSnapshot result;
    result.outerFrequencyLowLog2 = std::log2(outer_frequency_low);
    result.coreFrequencyLowLog2 = std::log2(core_frequency_low);
    result.coreFrequencyHighLog2 = std::log2(core_frequency_high);
    result.outerFrequencyHighLog2 = std::log2(outer_frequency_high);
    result.outerPhaseLow = outer_phase_low;
    result.corePhaseLow = core_phase_low;
    result.corePhaseHigh = core_phase_high;
    result.outerPhaseHigh = outer_phase_high;
    result.gain = bounded(params_.gain[index], 0.0, 200.0, 100.0) / 100.0;
    result.enabled = params_.enabled[index] >= 0.5F;
    return result;
  }

  void analyzeChannel(std::uint32_t channel) noexcept {
    const std::size_t input_offset = static_cast<std::size_t>(channel) * timeline_size_;
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const std::uint32_t source_index = job_frame_origin_ + index < timeline_size_
                                             ? job_frame_origin_ + index
                                             : job_frame_origin_ + index - timeline_size_;
      fft_input_[index] = input_ring_[input_offset + source_index] * window_[index];
    }
    float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    pffft_transform_ordered(setup_, fft_input_.data(), spectrum, fft_work_.data(), PFFFT_FORWARD);
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      if (!std::isfinite(spectrum[index])) {
        spectrum[index] = 0.0F;
      }
    }
  }

  [[nodiscard]] bool telemetryDue() noexcept {
    if (job_start_sample_ < next_telemetry_sample_) {
      return false;
    }
    do {
      next_telemetry_sample_ += telemetry_interval_samples_;
    } while (next_telemetry_sample_ <= job_start_sample_);
    return true;
  }

  void clearTelemetryCells() noexcept {
    for (std::uint32_t cell = 0u; cell < telemetry_cell_energy_.size(); ++cell) {
      telemetry_cell_energy_[cell] = 0.0;
      telemetry_cell_bin_[cell] = 0u;
      telemetry_cell_phase_[cell] = 0.0F;
    }
  }

  void finishTelemetryFrame(double maximum_energy) noexcept {
    std::uint16_t point_count = 0u;
    if (maximum_energy > 0.0) {
      for (double energy : telemetry_cell_energy_) {
        if (energy > 0.0) {
          ++point_count;
        }
      }
    }

    float maximum_db = -144.0F;
    if (maximum_energy > 0.0) {
      const double normalization = static_cast<double>(fft_size_) * static_cast<double>(fft_size_);
      const double level = 10.0 * std::log10(maximum_energy / normalization + 1.0e-30);
      if (std::isfinite(level)) {
        maximum_db = static_cast<float>(level);
      }
    }
    writeF32(telemetry_payload_.data(), static_cast<float>(sample_rate_));
    writeU16(telemetry_payload_.data() + 4u, point_count);
    writeU16(telemetry_payload_.data() + 6u, 0u);
    writeU32(telemetry_payload_.data() + 8u, fft_size_);
    writeF32(telemetry_payload_.data() + 12u, maximum_db);

    std::uint32_t point = 0u;
    if (maximum_energy > 0.0) {
      for (std::uint32_t cell = 0u; cell < kMaximumTelemetryPoints; ++cell) {
        const double energy = telemetry_cell_energy_[cell];
        if (energy <= 0.0) {
          continue;
        }
        const std::uint32_t bin = telemetry_cell_bin_[cell];
        const float frequency = static_cast<float>(static_cast<double>(bin) * sample_rate_ /
                                                   static_cast<double>(fft_size_));
        double relative_level = 10.0 * std::log10(energy / maximum_energy);
        if (!std::isfinite(relative_level)) {
          relative_level = -300.0;
        } else if (relative_level > 0.0) {
          relative_level = 0.0;
        }
        std::uint8_t *destination = telemetry_payload_.data() + kTelemetryHeaderBytes + point * 12u;
        writeF32(destination, frequency);
        writeF32(destination + 4u, telemetry_cell_phase_[cell]);
        writeF32(destination + 8u, static_cast<float>(relative_level));
        ++point;
      }
    }
    telemetry_payload_bytes_ = static_cast<std::uint16_t>(kTelemetryHeaderBytes + point * 12u);
    has_telemetry_frame_ = true;
    ++telemetry_generation_;
  }

  void applyMask() noexcept {
    float *left = spectra_.data();
    float *right = spectra_.data() + fft_size_;
    double maximum_left_power = 0.0;
    double maximum_right_power = 0.0;
    for (std::uint32_t bin = 1u; bin + 1u < bin_count_; ++bin) {
      if (bin_telemetry_cell_[bin] == kUnusedTelemetryCell) {
        continue;
      }
      const std::uint32_t index = 2u * bin;
      const double left_real = static_cast<double>(left[index]);
      const double left_imaginary = static_cast<double>(left[index + 1u]);
      const double right_real = static_cast<double>(right[index]);
      const double right_imaginary = static_cast<double>(right[index + 1u]);
      const double left_power = left_real * left_real + left_imaginary * left_imaginary;
      const double right_power = right_real * right_real + right_imaginary * right_imaginary;
      if (left_power > maximum_left_power) {
        maximum_left_power = left_power;
      }
      if (right_power > maximum_right_power) {
        maximum_right_power = right_power;
      }
    }
    double left_floor = maximum_left_power * kPhaseRelativePowerFloor;
    if (left_floor < kPhaseAbsolutePowerFloor) {
      left_floor = kPhaseAbsolutePowerFloor;
    }
    double right_floor = maximum_right_power * kPhaseRelativePowerFloor;
    if (right_floor < kPhaseAbsolutePowerFloor) {
      right_floor = kPhaseAbsolutePowerFloor;
    }

    const bool capture_telemetry = telemetryDue();
    if (capture_telemetry) {
      clearTelemetryCells();
    }
    double telemetry_maximum_energy = 0.0;
    for (std::uint32_t bin = 1u; bin + 1u < bin_count_; ++bin) {
      const std::uint16_t cell = bin_telemetry_cell_[bin];
      if (cell == kUnusedTelemetryCell) {
        continue;
      }
      const std::uint32_t index = 2u * bin;
      const double left_real = static_cast<double>(left[index]);
      const double left_imaginary = static_cast<double>(left[index + 1u]);
      const double right_real = static_cast<double>(right[index]);
      const double right_imaginary = static_cast<double>(right[index + 1u]);
      const double left_power = left_real * left_real + left_imaginary * left_imaginary;
      const double right_power = right_real * right_real + right_imaginary * right_imaginary;
      if (left_power <= left_floor || right_power <= right_floor) {
        continue;
      }

      const double cross_real = left_real * right_real + left_imaginary * right_imaginary;
      const double cross_imaginary = left_imaginary * right_real - left_real * right_imaginary;
      const double signed_phase = std::atan2(cross_imaginary, cross_real) * kRadiansToDegrees;
      if (!std::isfinite(signed_phase)) {
        continue;
      }
      const double phase = signed_phase < 0.0 ? -signed_phase : signed_phase;
      double total_gain = 1.0;
      if (!job_identity_) {
        for (const RegionSnapshot &region : job_regions_) {
          if (region.enabled && region.gain != 1.0) {
            const double weight = regionWeight(region, bin_log_frequency_[bin], phase);
            total_gain *= 1.0 + (region.gain - 1.0) * weight;
          }
        }
      }
      if (total_gain != 1.0) {
        const double scaled_left_real = left_real * total_gain;
        const double scaled_left_imaginary = left_imaginary * total_gain;
        const double scaled_right_real = right_real * total_gain;
        const double scaled_right_imaginary = right_imaginary * total_gain;
        if (std::isfinite(scaled_left_real) && std::isfinite(scaled_left_imaginary) &&
            std::isfinite(scaled_right_real) && std::isfinite(scaled_right_imaginary)) {
          left[index] = static_cast<float>(scaled_left_real);
          left[index + 1u] = static_cast<float>(scaled_left_imaginary);
          right[index] = static_cast<float>(scaled_right_real);
          right[index + 1u] = static_cast<float>(scaled_right_imaginary);
        }
      }

      if (capture_telemetry) {
        const double energy = left_power + right_power;
        if (energy > telemetry_cell_energy_[cell]) {
          telemetry_cell_energy_[cell] = energy;
          telemetry_cell_bin_[cell] = bin;
          telemetry_cell_phase_[cell] = static_cast<float>(signed_phase);
        }
        if (energy > telemetry_maximum_energy) {
          telemetry_maximum_energy = energy;
        }
      }
    }
    if (capture_telemetry) {
      finishTelemetryFrame(telemetry_maximum_energy);
    }
  }

  void synthesizeChannel(std::uint32_t channel) noexcept {
    float *spectrum = spectra_.data() + static_cast<std::size_t>(channel) * fft_size_;
    pffft_transform_ordered(setup_, spectrum, inverse_output_.data(), fft_work_.data(),
                            PFFFT_BACKWARD);
    const double normalization = 1.0 / (2.0 * static_cast<double>(fft_size_));
    const std::size_t output_offset = static_cast<std::size_t>(channel) * timeline_size_;
    for (std::uint32_t index = 0u; index < fft_size_; ++index) {
      const std::uint32_t output_index = job_output_origin_ + index < timeline_size_
                                             ? job_output_origin_ + index
                                             : job_output_origin_ + index - timeline_size_;
      const double sample = static_cast<double>(inverse_output_[index]) *
                            static_cast<double>(window_[index]) * normalization;
      if (std::isfinite(sample)) {
        const double sum = static_cast<double>(output_ring_[output_offset + output_index]) + sample;
        if (std::isfinite(sum)) {
          output_ring_[output_offset + output_index] = static_cast<float>(sum);
        }
      }
    }
  }

  [[nodiscard]] static bool channelForSlot(std::uint32_t slot, std::uint32_t slot_count,
                                           std::uint32_t &channel) noexcept {
    const std::uint32_t before = slot * kProcessedChannels / slot_count;
    const std::uint32_t after = (slot + 1u) * kProcessedChannels / slot_count;
    if (after == before) {
      return false;
    }
    channel = after - 1u;
    return true;
  }

  void runStagedSlot(std::uint32_t slot) noexcept {
    std::uint32_t channel = 0u;
    if (slot < kMaskSlot && (slot & 1u) == 0u) {
      const std::uint32_t analysis_slot = slot / 2u;
      if (analysis_slot < kAnalysisSlots &&
          channelForSlot(analysis_slot, kAnalysisSlots, channel)) {
        analyzeChannel(channel);
      }
      return;
    }
    if (slot == kMaskSlot) {
      applyMask();
      return;
    }
    if (slot > kMaskSlot && (slot & 1u) != 0u) {
      const std::uint32_t synthesis_slot = (slot - kMaskSlot - 1u) / 2u;
      if (synthesis_slot < kSynthesisSlots &&
          channelForSlot(synthesis_slot, kSynthesisSlots, channel)) {
        synthesizeChannel(channel);
      }
    }
  }

  void advanceStagedJob() noexcept {
    while (job_active_ && job_slot_ < kLogicalSlots &&
           absolute_sample_ - job_start_sample_ >=
               static_cast<std::uint64_t>(job_slot_ + 1u) * stage_slot_samples_) {
      runStagedSlot(job_slot_);
      ++job_slot_;
      if (job_slot_ == kLogicalSlots) {
        job_active_ = false;
      }
    }
  }

  void startStagedJob() noexcept {
    job_start_sample_ = absolute_sample_;
    job_frame_origin_ = timeline_position_ >= fft_size_
                            ? timeline_position_ - fft_size_
                            : timeline_position_ + timeline_size_ - fft_size_;
    job_output_origin_ = timeline_position_ + hop_size_ < timeline_size_
                             ? timeline_position_ + hop_size_
                             : timeline_position_ + hop_size_ - timeline_size_;
    job_slot_ = 0u;
    job_identity_ = true;
    for (std::uint32_t region = 0u; region < kRegionCount; ++region) {
      job_regions_[region] = snapshotRegion(region);
      if (job_regions_[region].enabled && job_regions_[region].gain != 1.0) {
        job_identity_ = false;
      }
    }
    job_active_ = true;
  }

  PFFFT_Setup *setup_ = nullptr;
  double sample_rate_ = 0.0;
  double processing_max_frequency_ = 0.0;
  double wet_mix_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t fft_size_ = 0u;
  std::uint32_t hop_size_ = 0u;
  std::uint32_t stage_slot_samples_ = 0u;
  std::uint32_t timeline_size_ = 0u;
  std::uint32_t bin_count_ = 0u;
  std::uint32_t timeline_position_ = 0u;
  std::uint32_t current_channel_count_ = 0u;
  std::uint64_t absolute_sample_ = 0u;
  std::uint64_t next_frame_sample_ = 0u;
  std::uint64_t job_start_sample_ = 0u;
  std::uint64_t telemetry_interval_samples_ = 1u;
  std::uint64_t next_telemetry_sample_ = 0u;
  std::uint32_t job_frame_origin_ = 0u;
  std::uint32_t job_output_origin_ = 0u;
  std::uint32_t job_slot_ = 0u;
  std::uint32_t telemetry_generation_ = 0u;
  std::uint32_t last_written_telemetry_generation_ = 0u;
  std::uint16_t telemetry_payload_bytes_ = 0u;
  bool job_active_ = false;
  bool job_identity_ = true;
  bool prepared_ = false;
  bool has_telemetry_frame_ = false;
  std::array<RegionSnapshot, kRegionCount> job_regions_{};
  AlignedFloatBuffer input_ring_;
  AlignedFloatBuffer dry_ring_;
  AlignedFloatBuffer output_ring_;
  AlignedFloatBuffer spectra_;
  AlignedFloatBuffer window_;
  AlignedFloatBuffer fft_input_;
  AlignedFloatBuffer fft_work_;
  AlignedFloatBuffer inverse_output_;
  std::vector<double> bin_log_frequency_;
  std::vector<std::uint16_t> bin_telemetry_cell_;
  std::vector<double> telemetry_cell_energy_;
  std::vector<std::uint32_t> telemetry_cell_bin_;
  std::vector<float> telemetry_cell_phase_;
  std::vector<std::uint8_t> telemetry_payload_;
};

static_assert(sizeof(PhaseSelectEqKernel) <= 8192u);

} // namespace effetune::plugins::spatial

EFFETUNE_REGISTER_KERNEL(PhaseSelectEqPlugin, effetune::plugins::spatial::PhaseSelectEqKernel)

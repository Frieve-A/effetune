#ifndef EFFETUNE_DSP_SPECTRUM_HQ_SINK_H
#define EFFETUNE_DSP_SPECTRUM_HQ_SINK_H

#include "binary_io.h"
#include "effetune/dsp/multires_spectrum.h"
#include "effetune/kernel.h"

#include <array>
#include <bit>
#include <cstdint>
#include <vector>

namespace effetune::dsp {

// Heap-owned storage shared by analyzers publishing the type 4, version 2 spectrum.
class SpectrumHqSink final {
public:
  explicit SpectrumHqSink(float sample_rate) : sample_rate_(sample_rate) {}

  void reset() noexcept {
    has_frame_ = false;
    frame_generation_ = 0u;
    last_written_generation_ = 0u;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept {
    if (has_frame_ && last_written_generation_ != frame_generation_ &&
        writer.write(4u, 2u, published_payload_.data(), published_payload_bytes_)) {
      last_written_generation_ = frame_generation_;
    }
  }

  void hqBegin(const MultiresSpectrumFrame &frame) noexcept {
    hq_frame_ = frame;
    std::uint8_t *payload = staging_payload_.data();
    binary_io::writeF32(payload, sample_rate_);
    binary_io::writeU16(payload + 4u, static_cast<std::uint16_t>(frame.points));
    binary_io::writeU16(payload + 6u, 0u);
    binary_io::writeU32(payload + 8u, frame.hopSamples);
    binary_io::writeU32(payload + 12u, frame.generation);
    binary_io::writeU32(payload + 16u, static_cast<std::uint32_t>(frame.captureEndSample));
    binary_io::writeU32(payload + 20u, static_cast<std::uint32_t>(frame.captureEndSample >> 32u));
    binary_io::writeU32(payload + 24u, frame.frameIndex);
    binary_io::writeU32(payload + 28u, frame.cellCount);
    binary_io::writeF32(payload + 32u, 20.0F);
    binary_io::writeF32(payload + 36u, 40000.0F);
    binary_io::writeU32(payload + 40u, frame.firstValidIndex);
    binary_io::writeU32(payload + 44u, frame.validCellCount);
  }

  void hqCell(std::uint32_t index, float level) noexcept {
    const float previous = hq_frame_.frameIndex == 0u ? -145.0F : peaks_[index];
    const float decayed = previous - static_cast<float>(20.0 * hq_frame_.hopSamples / sample_rate_);
    float peak = level > decayed ? level : decayed;
    peak = peak < -145.0F ? -145.0F : (peak > 0.0F ? 0.0F : peak);
    if (index < hq_frame_.firstValidIndex ||
        index >= hq_frame_.firstValidIndex + hq_frame_.validCellCount) {
      peak = -240.0F;
    }
    peaks_[index] = peak;
    binary_io::writeF32(staging_payload_.data() + 48u + index * 4u, level);
    binary_io::writeF32(staging_payload_.data() + 48u + (hq_frame_.cellCount + index) * 4u, peak);
  }

  void hqCommit() noexcept {
    published_payload_.swap(staging_payload_);
    published_payload_bytes_ = static_cast<std::uint16_t>(48u + hq_frame_.cellCount * 8u);
    has_frame_ = true;
    published_frame_ = hq_frame_;
    ++frame_generation_;
  }

  [[nodiscard]] std::uint32_t revision() const noexcept { return frame_generation_; }

  // A polling consumer can publish the same analysis without a telemetry ring.
  [[nodiscard]] bool copySpectrum(float *current, float *peaks,
                                  MultiresSpectrumFrame &frame) const noexcept {
    if (!has_frame_)
      return false;
    frame = published_frame_;
    const auto read_float = [](const std::uint8_t *bytes) {
      const std::uint32_t bits = static_cast<std::uint32_t>(bytes[0]) |
                                 (static_cast<std::uint32_t>(bytes[1]) << 8u) |
                                 (static_cast<std::uint32_t>(bytes[2]) << 16u) |
                                 (static_cast<std::uint32_t>(bytes[3]) << 24u);
      return std::bit_cast<float>(bits);
    };
    for (std::uint32_t i = 0; i < frame.cellCount; ++i) {
      current[i] = read_float(published_payload_.data() + 48u + i * 4u);
      peaks[i] = read_float(published_payload_.data() + 48u + (frame.cellCount + i) * 4u);
    }
    return true;
  }

private:
  static constexpr std::uint32_t kPayloadBytes =
      MultiresSpectrum::kHeaderBytes + MultiresSpectrum::kSpectrumCells * 8u;
  std::array<float, MultiresSpectrum::kSpectrumCells> peaks_{};
  std::vector<std::uint8_t> published_payload_ = std::vector<std::uint8_t>(kPayloadBytes);
  std::vector<std::uint8_t> staging_payload_ = std::vector<std::uint8_t>(kPayloadBytes);
  MultiresSpectrumFrame hq_frame_;
  MultiresSpectrumFrame published_frame_;
  float sample_rate_;
  std::uint32_t frame_generation_ = 0u;
  std::uint32_t last_written_generation_ = 0u;
  std::uint16_t published_payload_bytes_ = 0u;
  bool has_frame_ = false;
};

} // namespace effetune::dsp

#endif

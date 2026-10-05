#ifndef EFFETUNE_SPECTRUM_TAP_H
#define EFFETUNE_SPECTRUM_TAP_H

#include <array>
#include <cstdint>
#include <memory>
#include <vector>

namespace effetune {

enum class SpectrumTapMode : std::uint8_t { Off, After, Compare };
enum class SpectrumTapQuality : std::uint8_t { Normal, HQ };

// Version 1: all positions are in sample frames at the capture sample rate.
// captureEndFrame is exclusive and already excludes HQ's FIR group delay.
// windowAgeFrames locates the low-frequency analysis window's center before it.
// completionFrames is the additional FIR/staged work needed before publication.
// tapDelayFrames is the remaining audio delay from After to the pipeline output.
struct SpectrumTapTiming {
  static constexpr std::uint32_t kVersion = 1;
  std::uint32_t version = kVersion;
  std::uint64_t generation = 0;
  std::uint64_t frameIndex = 0;
  std::uint64_t captureEndFrame = 0;
  std::uint32_t windowAgeFrames = 2048;
  std::uint32_t completionFrames = 0;
  std::uint32_t tapDelayFrames = 0;

  [[nodiscard]] double audibleFrame(std::uint32_t outputDelayFrames) const noexcept {
    return static_cast<double>(captureEndFrame) - windowAgeFrames + tapDelayFrames +
           outputDelayFrames;
  }
  [[nodiscard]] std::uint32_t
  requiredOutputDelay(std::uint32_t existingDelayFrames, std::uint32_t deviceDelayFrames,
                      std::uint32_t maxFrames,
                      std::uint32_t deliveryBudgetFrames = 0) const noexcept;
};

[[nodiscard]] SpectrumTapTiming spectrumTapTiming(SpectrumTapQuality quality,
                                                  double sampleRate) noexcept;

struct SpectrumTapSpectrum {
  static constexpr std::uint32_t kCells = 2048;
  std::array<float, kCells> current{};
  std::array<float, kCells> peaks{};
  std::uint32_t validCellCount = kCells;
};

struct SpectrumTapFrame {
  SpectrumTapMode mode = SpectrumTapMode::After;
  SpectrumTapQuality quality = SpectrumTapQuality::Normal;
  double sampleRate = 0;
  SpectrumTapTiming timing;
  SpectrumTapSpectrum input;
  SpectrumTapSpectrum output;
};

// One tap, one audio producer and one serialized control/polling consumer.
// prepare requires an idle producer. configure/read may run concurrently with
// capture. Capture only averages/copies into bounded SPSC storage; all analysis,
// delay alignment and frame allocation run in read(), outside the audio callback.
// Feed the actual routed PCM from Engine::PipelineObserver, with identical
// firstFrame/frames for Before and After. Audio is planar, with frames stride.
class SpectrumTap final {
public:
  SpectrumTap();
  ~SpectrumTap();
  SpectrumTap(const SpectrumTap &) = delete;
  SpectrumTap &operator=(const SpectrumTap &) = delete;
  [[nodiscard]] bool prepare(double sampleRate, std::uint32_t maxFrames);
  [[nodiscard]] bool configure(SpectrumTapMode mode, SpectrumTapQuality quality);
  void invalidate() noexcept;
  void capture(const float *audio, std::uint32_t channels, std::uint32_t frames,
               std::uint64_t firstFrame, std::uint32_t effectLatencyFrames,
               std::uint32_t tapDelayFrames, bool before) noexcept;
  [[nodiscard]] std::vector<SpectrumTapFrame> read(std::uint32_t &droppedBlocks);

private:
  struct Storage;
  std::unique_ptr<Storage> storage_;
};

} // namespace effetune
#endif

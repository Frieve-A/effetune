#pragma once

#include <cstddef>
#include <vector>

namespace effetune::audio {

struct ResampledFrames {
  std::size_t consumed = 0;
  std::size_t produced = 0;
};

// Planar input and output may have different strides. A call consumes only the
// source frames needed for the requested output and may stop at either limit.
class Resampler {
public:
  Resampler(unsigned channels, unsigned inputRate, unsigned outputRate, bool adaptive = false);
  ResampledFrames process(const float *input, std::size_t inputStride, std::size_t inputFrames,
                          float *output, std::size_t outputStride,
                          std::size_t outputFrames) noexcept;
  void reset() noexcept;
  void setCorrection(double fraction) noexcept;
  double inputPerOutput() const noexcept { return step_; }
  double nextInputOffset() const noexcept { return position_ - 1.; }
  double delayInputFrames() const noexcept { return taps_ * 0.5; }
  std::size_t inputNeeded(std::size_t outputs) const noexcept;

private:
  static constexpr int phases = 128;
  unsigned channels_;
  bool adaptive_;
  double nominal_, step_, position_ = 1;
  unsigned taps_ = 0, write_ = 0;
  std::vector<float> coefficients_, history_;
};

} // namespace effetune::audio

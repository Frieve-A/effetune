#pragma once
#include <array>
#include <cstdint>
namespace effetune::audio {
class FrequencyPreview {
public:
  bool configure(double frequency, bool noise, unsigned rate) noexcept;
  void mix(float *bus, unsigned channels, unsigned frames, unsigned rate) noexcept;
  bool active() const noexcept { return target_ != 0; }

private:
  struct Filter {
    double a1 = 0, a2 = 0, a3 = 0, scale = 0, i1 = 0, i2 = 0;
    double sample(double white) noexcept;
  };
  std::array<Filter, 2> filters_;
  std::uint32_t random_ = 0x2845512c;
  unsigned selected_ = 0;
  double frequency_ = 0, filterFrequency_ = 0, fade_ = 1, phase_ = 0, gain_ = 0, target_ = 0;
  bool noise_ = false;
};
} // namespace effetune::audio

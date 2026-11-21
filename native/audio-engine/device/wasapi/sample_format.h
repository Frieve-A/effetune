#pragma once

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdint>
#include <cstring>

namespace effetune::audio {

struct WasapiSampleFormat {
  std::uint32_t bytes{};
  std::uint32_t validBits{};
  bool floating{};

  bool supported() const noexcept {
    if (floating)
      return bytes == sizeof(float) && validBits == 32;
    return bytes >= 1 && bytes <= 4 && validBits > 1 && validBits <= bytes * 8u &&
           (bytes != 1 || validBits == 8);
  }

  float decode(const std::uint8_t *input) const noexcept {
    if (floating) {
      float sample;
      std::memcpy(&sample, input, sizeof(sample));
      return sample;
    }
    if (bytes == 1)
      return (static_cast<float>(*input) - 128.0f) / 128.0f;
    std::uint32_t bits = 0;
    for (std::uint32_t i = 0; i < bytes; ++i)
      bits |= std::uint32_t(input[i]) << (8u * i);
    const auto scaled = std::bit_cast<std::int32_t>(bits << (32u - 8u * bytes));
    return static_cast<float>(scaled) / 2147483648.0f;
  }

  void encode(float input, std::uint8_t *output) const noexcept {
    if (floating) {
      std::memcpy(output, &input, sizeof(input));
      return;
    }
    if (!std::isfinite(input))
      input = 0.0f;
    const std::int64_t scale = std::int64_t{1} << (validBits - 1u);
    const auto sample =
        std::clamp<std::int64_t>(std::llround(static_cast<double>(std::clamp(input, -1.0f, 1.0f)) *
                                              static_cast<double>(scale)),
                                 -scale, scale - 1);
    if (bytes == 1) {
      *output = static_cast<std::uint8_t>(sample + scale);
      return;
    }
    const auto bits = static_cast<std::uint32_t>(sample) << (8u * bytes - validBits);
    for (std::uint32_t i = 0; i < bytes; ++i)
      output[i] = static_cast<std::uint8_t>(bits >> (8u * i));
  }

  void silence(std::uint8_t *output, std::size_t samples) const noexcept {
    std::memset(output, !floating && bytes == 1 ? 128 : 0, samples * bytes);
  }
};

} // namespace effetune::audio

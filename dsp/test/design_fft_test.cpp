#include "test_support.h"

#include "effetune/abi.h"

#include <cmath>
#include <cstdint>
#include <cstring>

namespace effetune::test {

void runDesignFftTests() {
  ET_CHECK(et_design_fft_create(0u) == nullptr);
  ET_CHECK(et_design_fft_create(48u) == nullptr);

  et_design_fft *fft = et_design_fft_create(64u);
  ET_CHECK(fft != nullptr);
  if (fft == nullptr)
    return;
  float *input = et_design_fft_input(fft);
  ET_CHECK(input != nullptr);
  if (input == nullptr) {
    et_design_fft_destroy(fft);
    return;
  }
  input[0] = 1.0F;
  ET_CHECK(et_design_fft_forward(fft) == ET_OK);
  const float *spectrum = et_design_fft_output(fft);
  ET_CHECK(spectrum != nullptr);
  if (spectrum != nullptr) {
    ET_CHECK(std::fabs(spectrum[0] - 1.0F) < 0.00001F);
    ET_CHECK(std::fabs(spectrum[1] - 1.0F) < 0.00001F);
    for (std::uint32_t bin = 1u; bin < 32u; ++bin) {
      ET_CHECK(std::fabs(spectrum[bin * 2u] - 1.0F) < 0.00001F);
      ET_CHECK(std::fabs(spectrum[bin * 2u + 1u]) < 0.00001F);
    }
    std::memcpy(input, spectrum, 64u * sizeof(float));
    ET_CHECK(et_design_fft_inverse(fft) == ET_OK);
    const float *roundTrip = et_design_fft_output(fft);
    ET_CHECK(std::fabs(roundTrip[0] - 1.0F) < 0.00001F);
    for (std::uint32_t index = 1u; index < 64u; ++index)
      ET_CHECK(std::fabs(roundTrip[index]) < 0.00001F);
  }
  et_design_fft_destroy(fft);
}

} // namespace effetune::test

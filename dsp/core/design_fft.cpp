#include "effetune/abi.h"

#include <pffft.h>

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <new>

namespace {

constexpr std::uint32_t kMinimumSize = 32u;
constexpr std::uint32_t kMaximumSize = 1u << 20u;

bool isPowerOfTwo(std::uint32_t value) noexcept {
  return value != 0u && (value & (value - 1u)) == 0u;
}

} // namespace

struct et_design_fft {
  explicit et_design_fft(std::uint32_t requestedSize) noexcept : size(requestedSize) {}

  ~et_design_fft() {
    if (setup != nullptr)
      pffft_destroy_setup(setup);
    pffft_aligned_free(input);
    pffft_aligned_free(output);
    pffft_aligned_free(work);
  }

  bool prepare() noexcept {
    setup = pffft_new_setup(static_cast<int>(size), PFFFT_REAL);
    input =
        static_cast<float *>(pffft_aligned_malloc(static_cast<std::size_t>(size) * sizeof(float)));
    output =
        static_cast<float *>(pffft_aligned_malloc(static_cast<std::size_t>(size) * sizeof(float)));
    work =
        static_cast<float *>(pffft_aligned_malloc(static_cast<std::size_t>(size) * sizeof(float)));
    if (setup == nullptr || input == nullptr || output == nullptr || work == nullptr)
      return false;
    std::memset(input, 0, static_cast<std::size_t>(size) * sizeof(float));
    std::memset(output, 0, static_cast<std::size_t>(size) * sizeof(float));
    std::memset(work, 0, static_cast<std::size_t>(size) * sizeof(float));
    return true;
  }

  std::uint32_t size = 0u;
  PFFFT_Setup *setup = nullptr;
  float *input = nullptr;
  float *output = nullptr;
  float *work = nullptr;
};

extern "C" {

et_design_fft *et_design_fft_create(std::uint32_t size) {
  if (size < kMinimumSize || size > kMaximumSize || !isPowerOfTwo(size))
    return nullptr;
  auto *fft = new (std::nothrow) et_design_fft(size);
  if (fft == nullptr)
    return nullptr;
  if (!fft->prepare()) {
    delete fft;
    return nullptr;
  }
  return fft;
}

void et_design_fft_destroy(et_design_fft *fft) { delete fft; }

float *et_design_fft_input(et_design_fft *fft) { return fft == nullptr ? nullptr : fft->input; }

const float *et_design_fft_output(const et_design_fft *fft) {
  return fft == nullptr ? nullptr : fft->output;
}

et_status et_design_fft_forward(et_design_fft *fft) {
  if (fft == nullptr)
    return ET_ERR_ARGS;
  pffft_transform_ordered(fft->setup, fft->input, fft->output, fft->work, PFFFT_FORWARD);
  return ET_OK;
}

et_status et_design_fft_inverse(et_design_fft *fft) {
  if (fft == nullptr)
    return ET_ERR_ARGS;
  pffft_transform_ordered(fft->setup, fft->input, fft->output, fft->work, PFFFT_BACKWARD);
  const float scale = 1.0F / static_cast<float>(fft->size);
  for (std::uint32_t index = 0u; index < fft->size; ++index)
    fft->output[index] *= scale;
  return ET_OK;
}

} // extern "C"

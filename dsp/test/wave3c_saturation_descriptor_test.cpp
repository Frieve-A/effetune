#include "effetune/kernel.h"

#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_DynamicSaturationPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_ExciterPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_HarmonicDistortionPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_SubSynthPlugin() noexcept;

namespace {

struct ExpectedDescriptor final {
  const effetune::KernelDescriptor *(*read)() noexcept;
  const char *type;
  std::uint32_t hash;
  std::uint32_t floats;
};

} // namespace

int main() {
  const std::array<ExpectedDescriptor, 4u> expected = {{
      {et_kernel_descriptor_DynamicSaturationPlugin, "DynamicSaturationPlugin", 0xc8929bf3u, 9u},
      {et_kernel_descriptor_ExciterPlugin, "ExciterPlugin", 0xfc6e6a7au, 5u},
      {et_kernel_descriptor_HarmonicDistortionPlugin, "HarmonicDistortionPlugin", 0x04f4b5e0u, 5u},
      {et_kernel_descriptor_SubSynthPlugin, "SubSynthPlugin", 0x06f29552u, 8u},
  }};

  int failures = 0;
  for (const ExpectedDescriptor &item : expected) {
    const effetune::KernelDescriptor *descriptor = item.read();
    if (descriptor == nullptr || descriptor->typeName == nullptr ||
        std::strcmp(descriptor->typeName, item.type) != 0 || descriptor->paramsHash != item.hash ||
        descriptor->paramsFloatCount != item.floats || descriptor->objectSize > 8192u) {
      ++failures;
    }
    if (descriptor != nullptr) {
      std::printf("%s hash=0x%08x floats=%u object=%u\n", descriptor->typeName,
                  descriptor->paramsHash, descriptor->paramsFloatCount, descriptor->objectSize);
    }
  }
  return failures == 0 ? 0 : 1;
}

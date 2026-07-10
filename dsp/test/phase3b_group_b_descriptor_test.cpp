#include "effetune/kernel.h"

#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_FiveBandPEQPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_FifteenBandPEQPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_FifteenBandGEQPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_EarphoneCableSimPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_CrossfeedFilterPlugin() noexcept;

namespace {

struct ExpectedDescriptor final {
  const effetune::KernelDescriptor *(*read)() noexcept;
  const char *type;
  std::uint32_t hash;
  std::uint32_t floats;
};

} // namespace

int main() {
  const std::array<ExpectedDescriptor, 5u> expected = {{
      {et_kernel_descriptor_FiveBandPEQPlugin, "FiveBandPEQPlugin", 0x8835f2b9u, 25u},
      {et_kernel_descriptor_FifteenBandPEQPlugin, "FifteenBandPEQPlugin", 0x6197cd46u, 75u},
      {et_kernel_descriptor_FifteenBandGEQPlugin, "FifteenBandGEQPlugin", 0x6c4f898cu, 15u},
      {et_kernel_descriptor_EarphoneCableSimPlugin, "EarphoneCableSimPlugin", 0x41eff423u, 25u},
      {et_kernel_descriptor_CrossfeedFilterPlugin, "CrossfeedFilterPlugin", 0x2a9ec781u, 3u},
  }};

  int failures = 0;
  for (const ExpectedDescriptor &item : expected) {
    const effetune::KernelDescriptor *descriptor = item.read();
    if (descriptor == nullptr || std::strcmp(descriptor->typeName, item.type) != 0 ||
        descriptor->paramsHash != item.hash || descriptor->paramsFloatCount != item.floats ||
        descriptor->objectSize > 8192u) {
      ++failures;
    }
    if (descriptor != nullptr) {
      std::printf("%s hash=0x%08x floats=%u object=%u\n", descriptor->typeName,
                  descriptor->paramsHash, descriptor->paramsFloatCount, descriptor->objectSize);
    }
  }
  return failures == 0 ? 0 : 1;
}

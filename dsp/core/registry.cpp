#include "registry.h"

#include <cstring>

#define EFFETUNE_PLUGIN(Name, Path)                                                                \
  extern "C" const ::effetune::KernelDescriptor *et_kernel_descriptor_##Name() noexcept;
#include "../registry.inc"
#undef EFFETUNE_PLUGIN

#if defined(ET_ENABLE_TEST_KERNEL)
extern "C" const ::effetune::KernelDescriptor *et_kernel_descriptor_TestGainPlugin() noexcept;
#endif

namespace effetune::registry {
namespace {

using DescriptorFunction = const KernelDescriptor *(*)() noexcept;

constexpr DescriptorFunction kDescriptors[] = {
#define EFFETUNE_PLUGIN(Name, Path) &et_kernel_descriptor_##Name,
#include "../registry.inc"
#undef EFFETUNE_PLUGIN
#if defined(ET_ENABLE_TEST_KERNEL)
    &et_kernel_descriptor_TestGainPlugin,
#endif
    nullptr};

constexpr std::uint32_t kDescriptorCount =
    static_cast<std::uint32_t>(sizeof(kDescriptors) / sizeof(kDescriptors[0]) - 1u);

} // namespace

std::uint32_t count() noexcept { return kDescriptorCount; }

const KernelDescriptor *at(std::uint32_t index) noexcept {
  return index < kDescriptorCount ? kDescriptors[index]() : nullptr;
}

const KernelDescriptor *find(const char *type_name) noexcept {
  if (type_name == nullptr) {
    return nullptr;
  }
  for (std::uint32_t index = 0; index < kDescriptorCount; ++index) {
    const KernelDescriptor *descriptor = kDescriptors[index]();
    if (std::strcmp(descriptor->typeName, type_name) == 0) {
      return descriptor;
    }
  }
  return nullptr;
}

} // namespace effetune::registry

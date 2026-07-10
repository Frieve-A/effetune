#ifndef EFFETUNE_CORE_REGISTRY_H
#define EFFETUNE_CORE_REGISTRY_H

#include "effetune/kernel.h"

#include <cstdint>

namespace effetune::registry {

[[nodiscard]] std::uint32_t count() noexcept;
[[nodiscard]] const KernelDescriptor *at(std::uint32_t index) noexcept;
[[nodiscard]] const KernelDescriptor *find(const char *type_name) noexcept;

} // namespace effetune::registry

#endif

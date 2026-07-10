#include "allocation_guard.h"

#include <cstdlib>
#include <new>

#if defined(_MSC_VER)
#include <malloc.h>
#endif

namespace effetune::allocation_guard {
namespace {

#if defined(ET_ALLOCATION_GUARD)
std::uint32_t process_depth = 0;
std::uint32_t violation_count = 0;
bool abort_on_violation = true;
#endif

} // namespace

void begin() noexcept {
#if defined(ET_ALLOCATION_GUARD)
  ++process_depth;
#endif
}

void end() noexcept {
#if defined(ET_ALLOCATION_GUARD)
  if (process_depth == 0u) {
    std::abort();
  }
  --process_depth;
#endif
}

bool active() noexcept {
#if defined(ET_ALLOCATION_GUARD)
  return process_depth != 0u;
#else
  return false;
#endif
}

void abortIfActive() noexcept {
#if defined(ET_ALLOCATION_GUARD)
  if (active()) {
    ++violation_count;
    if (abort_on_violation) {
      std::abort();
    }
  }
#endif
}

void setAbortOnViolationForTesting(bool enabled) noexcept {
#if defined(ET_ALLOCATION_GUARD)
  abort_on_violation = enabled;
#else
  static_cast<void>(enabled);
#endif
}

std::uint32_t violationCount() noexcept {
#if defined(ET_ALLOCATION_GUARD)
  return violation_count;
#else
  return 0u;
#endif
}

} // namespace effetune::allocation_guard

#if defined(__EMSCRIPTEN__)
extern "C" __attribute__((export_name("malloc"))) void *et_wasm_malloc(std::size_t bytes) {
  return std::malloc(bytes);
}
#endif

#if defined(ET_ALLOCATION_GUARD)

void *operator new(std::size_t bytes) {
  effetune::allocation_guard::abortIfActive();
  if (void *memory = std::malloc(bytes)) {
    return memory;
  }
  std::abort();
}

void *operator new[](std::size_t bytes) { return ::operator new(bytes); }

void *operator new(std::size_t bytes, const std::nothrow_t &) noexcept {
  effetune::allocation_guard::abortIfActive();
  return std::malloc(bytes);
}

void *operator new[](std::size_t bytes, const std::nothrow_t &tag) noexcept {
  return ::operator new(bytes, tag);
}

void operator delete(void *memory) noexcept { std::free(memory); }
void operator delete[](void *memory) noexcept { std::free(memory); }
void operator delete(void *memory, std::size_t) noexcept { std::free(memory); }
void operator delete[](void *memory, std::size_t) noexcept { std::free(memory); }
void operator delete(void *memory, const std::nothrow_t &) noexcept { std::free(memory); }
void operator delete[](void *memory, const std::nothrow_t &) noexcept { std::free(memory); }

#if defined(__cpp_aligned_new)
namespace {

void *allocateAligned(std::size_t bytes, std::size_t alignment) noexcept {
#if defined(_MSC_VER)
  return _aligned_malloc(bytes, alignment);
#else
  const std::size_t aligned_bytes = (bytes + alignment - 1u) & ~(alignment - 1u);
  return std::aligned_alloc(alignment, aligned_bytes);
#endif
}

void freeAligned(void *memory) noexcept {
#if defined(_MSC_VER)
  _aligned_free(memory);
#else
  std::free(memory);
#endif
}

} // namespace

void *operator new(std::size_t bytes, std::align_val_t alignment) {
  effetune::allocation_guard::abortIfActive();
  if (void *memory = allocateAligned(bytes, static_cast<std::size_t>(alignment))) {
    return memory;
  }
  std::abort();
}

void *operator new[](std::size_t bytes, std::align_val_t alignment) {
  return ::operator new(bytes, alignment);
}

void *operator new(std::size_t bytes, std::align_val_t alignment, const std::nothrow_t &) noexcept {
  effetune::allocation_guard::abortIfActive();
  return allocateAligned(bytes, static_cast<std::size_t>(alignment));
}

void *operator new[](std::size_t bytes, std::align_val_t alignment,
                     const std::nothrow_t &tag) noexcept {
  return ::operator new(bytes, alignment, tag);
}

void operator delete(void *memory, std::align_val_t) noexcept { freeAligned(memory); }
void operator delete[](void *memory, std::align_val_t) noexcept { freeAligned(memory); }
void operator delete(void *memory, std::size_t, std::align_val_t) noexcept { freeAligned(memory); }
void operator delete[](void *memory, std::size_t, std::align_val_t) noexcept {
  freeAligned(memory);
}
void operator delete(void *memory, std::align_val_t, const std::nothrow_t &) noexcept {
  freeAligned(memory);
}
void operator delete[](void *memory, std::align_val_t, const std::nothrow_t &) noexcept {
  freeAligned(memory);
}

#endif
#endif

#if defined(ET_ALLOCATION_GUARD) && defined(ET_WRAP_MALLOC)
extern "C" void *__real_malloc(std::size_t bytes);
extern "C" void *__wrap_malloc(std::size_t bytes) {
  effetune::allocation_guard::abortIfActive();
  return __real_malloc(bytes);
}
#endif

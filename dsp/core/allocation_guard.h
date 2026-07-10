#ifndef EFFETUNE_CORE_ALLOCATION_GUARD_H
#define EFFETUNE_CORE_ALLOCATION_GUARD_H

#include <cstdint>

namespace effetune::allocation_guard {

void begin() noexcept;
void end() noexcept;
[[nodiscard]] bool active() noexcept;
void abortIfActive() noexcept;
void setAbortOnViolationForTesting(bool enabled) noexcept;
[[nodiscard]] std::uint32_t violationCount() noexcept;

class Scope {
public:
  Scope() noexcept { begin(); }
  ~Scope() { end(); }
  Scope(const Scope &) = delete;
  Scope &operator=(const Scope &) = delete;
};

} // namespace effetune::allocation_guard

#endif

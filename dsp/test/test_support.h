#ifndef EFFETUNE_TEST_SUPPORT_H
#define EFFETUNE_TEST_SUPPORT_H

#include <cstdio>

namespace effetune::test {

inline int failures = 0;

inline void check(bool condition, const char *expression, const char *file, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "%s:%d: check failed: %s\n", file, line, expression);
    ++failures;
  }
}

void runAbiTests();
void runDesignFftTests();
void runTelemetryTests();

} // namespace effetune::test

#define ET_CHECK(expression)                                                                       \
  ::effetune::test::check(static_cast<bool>(expression), #expression, __FILE__, __LINE__)

#endif

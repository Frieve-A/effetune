#ifndef EFFETUNE_TEST_SUPPORT_H
#define EFFETUNE_TEST_SUPPORT_H

#include "effetune/kernel.h"

#include <cstdio>

namespace effetune {
class Engine;
}

extern "C" effetune::PluginKernel *
et_engine_instance_kernel_for_testing(effetune::Engine *engine, et_instance instance) noexcept;

namespace effetune::test {

// Host transport received by the last process call of a TestGainPlugin kernel.
const HostTransport *testGainTransport(PluginKernel *kernel) noexcept;

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

#include "test_support.h"

#include <cstdio>

int main() {
  effetune::test::runAbiTests();
  effetune::test::runTelemetryTests();
  if (effetune::test::failures != 0) {
    std::fprintf(stderr, "%d DSP test check(s) failed\n", effetune::test::failures);
    return 1;
  }
  std::puts("All DSP native tests passed");
  return 0;
}

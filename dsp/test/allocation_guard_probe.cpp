#include "allocation_guard.h"

int main() {
  using namespace effetune::allocation_guard;
  setAbortOnViolationForTesting(false);
  const std::uint32_t before = violationCount();
  {
    Scope scope;
    int *value = new int(42);
    delete value;
  }
  setAbortOnViolationForTesting(true);
  return violationCount() == before + 1u ? 0 : 1;
}

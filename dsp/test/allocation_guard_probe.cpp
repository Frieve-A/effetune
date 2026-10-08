#include "allocation_guard.h"

int main() {
  using namespace effetune::allocation_guard;
  setAbortOnViolationForTesting(false);
  const std::uint32_t before = violationCount();
  bool allocation_detected = false;
  bool deallocation_detected = false;
  {
    Scope scope;
    int *value = new int(42);
    allocation_detected = violationCount() == before + 1u;
    delete value;
    deallocation_detected = violationCount() == before + 2u;
  }
  setAbortOnViolationForTesting(true);
  return allocation_detected && deallocation_detected ? 0 : 1;
}

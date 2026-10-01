#include "heap_tree_model.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>

namespace {
using effetune::plugins::analyzer::HeapTreeEvaluator;
using effetune::plugins::analyzer::HeapTreeModelView;

int failures = 0;

#define CHECK(condition)                                                                           \
  do {                                                                                             \
    if (!(condition)) {                                                                            \
      std::fprintf(stderr, "%s:%d check failed: %s\n", __FILE__, __LINE__, #condition);            \
      ++failures;                                                                                  \
    }                                                                                              \
  } while (false)

void testHeapRoutingAndStrictSplit() {
  constexpr std::array<std::uint8_t, 3> split_features = {0u, 1u, 1u};
  constexpr std::array<float, 3> thresholds = {1.0F, 2.0F, 3.0F};
  constexpr std::array<double, 4> leaves = {10.0, 20.0, 30.0, 40.0};
  const HeapTreeModelView model = {
      2u, 1u, 2u, 2.0, 0.5, split_features.data(), thresholds.data(), leaves.data()};
  const std::array<std::array<float, 2>, 4> inputs = {
      std::array<float, 2>{1.0F, 2.0F},
      std::array<float, 2>{1.0F, 3.0F},
      std::array<float, 2>{2.0F, 3.0F},
      std::array<float, 2>{2.0F, 4.0F},
  };
  constexpr std::array<double, 4> expected = {20.5, 40.5, 60.5, 80.5};
  std::array<const float *, 4> rows = {inputs[0].data(), inputs[1].data(), inputs[2].data(),
                                       inputs[3].data()};
  std::array<double, 4> staged{};
  staged.fill(HeapTreeEvaluator::initialMargin(model));
  HeapTreeEvaluator::accumulateTree4(model, rows.data(), 4u, 0u, staged.data());
  for (std::uint32_t sample = 0u; sample < inputs.size(); ++sample) {
    CHECK(HeapTreeEvaluator::margin(model, inputs[sample].data()) == expected[sample]);
    CHECK(staged[sample] == expected[sample]);
  }

  auto equal = inputs[2];
  equal[0] = std::nextafter(1.0F, std::numeric_limits<float>::infinity());
  CHECK(HeapTreeEvaluator::margin(model, equal.data()) == 60.5);
}

void testStableSigmoidAndExcessProbability() {
  CHECK(HeapTreeEvaluator::probability(-1000.0) == 0.0F);
  CHECK(HeapTreeEvaluator::probability(1000.0) == 1.0F);
  CHECK(HeapTreeEvaluator::probability(0.0) == 0.5F);
  CHECK(HeapTreeEvaluator::excessProbability(0.1F, 0.2F) == 0.0F);
  CHECK(std::abs(HeapTreeEvaluator::excessProbability(0.6F, 0.2F) - 0.5F) < 1.0e-6F);
  CHECK(HeapTreeEvaluator::excessProbability(1.0F, 0.2F) == 1.0F);
}
} // namespace

int main() {
  testHeapRoutingAndStrictSplit();
  testStableSigmoidAndExcessProbability();
  return failures == 0 ? 0 : 1;
}

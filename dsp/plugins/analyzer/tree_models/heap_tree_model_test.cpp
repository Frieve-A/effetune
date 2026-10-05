#include "heap_tree_model.h"
#include "oblivious_tree_model.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>

namespace {
using effetune::plugins::analyzer::HeapTreeEvaluator;
using effetune::plugins::analyzer::HeapTreeModelView;
using effetune::plugins::analyzer::ObliviousTreeEvaluator;
using effetune::plugins::analyzer::ObliviousTreeModelView;

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
  CHECK(model.splitCount() == 3u);
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

template <typename LeafValue> void testObliviousRoutingAndScaling() {
  // Two depth-2 trees; split k sets bit k. Tree 0: f0 > 1, f1 > 3. Tree 1: f1 > 2, f0 > 1.
  constexpr std::array<std::uint8_t, 4> split_features = {0u, 1u, 1u, 0u};
  constexpr std::array<std::uint8_t, 4> thresholds = {0u, 1u, 0u, 0u};
  constexpr std::array<float, 3> borders = {1.0F, 2.0F, 3.0F};
  constexpr std::array<std::uint32_t, 2> border_offsets = {0u, 1u};
  std::array<LeafValue, 24> leaves{};
  for (std::uint32_t value = 0u; value < leaves.size(); ++value)
    leaves[value] = static_cast<LeafValue>(static_cast<int>(value) - 12);
  constexpr std::array<float, 6> leaf_scales = {0.5F, 0.25F, 2.0F, 1.0F, 4.0F, 0.125F};
  // margin() reads the same arrays as one output: leaves [tree][leaf], one scale per tree.
  const ObliviousTreeModelView<LeafValue> model = {2u,
                                                   2u,
                                                   2u,
                                                   2.0,
                                                   0.5,
                                                   split_features.data(),
                                                   thresholds.data(),
                                                   leaves.data(),
                                                   borders.data(),
                                                   border_offsets.data(),
                                                   leaf_scales.data()};
  const float above_one = std::nextafter(1.0F, std::numeric_limits<float>::infinity());
  const float above_three = std::nextafter(3.0F, std::numeric_limits<float>::infinity());
  const std::array<std::array<float, 2>, 3> inputs = {
      std::array<float, 2>{1.0F, 2.0F},
      std::array<float, 2>{above_one, 3.0F},
      std::array<float, 2>{std::numeric_limits<float>::quiet_NaN(), above_three},
  };
  // Strict `>` keeps equal values at bit 0 and NaN compares false.
  constexpr std::array<std::array<std::uint32_t, 2>, 3> expected_leaves = {
      std::array<std::uint32_t, 2>{0u, 0u}, std::array<std::uint32_t, 2>{1u, 3u},
      std::array<std::uint32_t, 2>{2u, 1u}};
  const std::array<const float *, 4> rows = {inputs[0].data(), inputs[1].data(), inputs[2].data(),
                                             nullptr};

  std::array<double, 12> margins{};
  margins.fill(-7.0);
  for (std::uint32_t value = 0u; value < 9u; ++value)
    margins[value] = ObliviousTreeEvaluator::initialMargin(model);
  ObliviousTreeEvaluator::accumulateTrees4<3u>(model, rows.data(), 0u, 2u, margins.data(), 3u);
  for (std::uint32_t row = 0u; row < inputs.size(); ++row) {
    double single = 0.5;
    for (std::uint32_t output = 0u; output < 3u; ++output) {
      double expected = 0.5;
      for (std::uint32_t tree = 0u; tree < 2u; ++tree) {
        const auto leaf = expected_leaves[row][tree];
        expected += 2.0 * (leaves[((tree << 2u) + leaf) * 3u + output] *
                           static_cast<double>(leaf_scales[tree * 3u + output]));
        if (output == 0u)
          single += 2.0 * (leaves[(tree << 2u) + leaf] * static_cast<double>(leaf_scales[tree]));
      }
      CHECK(margins[row * 3u + output] == expected);
    }
    CHECK(ObliviousTreeEvaluator::margin(model, inputs[row].data()) == single);
  }
  for (std::uint32_t value = 9u; value < margins.size(); ++value)
    CHECK(margins[value] == -7.0);
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
  testObliviousRoutingAndScaling<std::int8_t>();
  testObliviousRoutingAndScaling<std::int16_t>();
  testStableSigmoidAndExcessProbability();
  return failures == 0 ? 0 : 1;
}

#include "heap_tree_model.h"
#include "learned_model.generated.h"
#include "learned_model_test_fixture.h"
#include "multires_features.h"
#include "pitch_context.h"

#include <array>
#include <cmath>
#include <cstdio>
#include <limits>

#include "octave_model.generated.h"
#include "octave_model_fixture.generated.h"
#include "octave_pair_features.h"

namespace {
using effetune::plugins::analyzer::HeapTreeEvaluator;
using effetune::plugins::analyzer::HeapTreeModelView;
namespace model_fixture = effetune::plugins::analyzer::learned_model_fixture;
namespace production_model = effetune::plugins::analyzer::learned_model;

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

void testFullModelReferenceMargins() {
  constexpr auto model = production_model::model();
  static_assert(model_fixture::kFeatureSchemaVersion == production_model::kFeatureSchemaVersion);
  static_assert(model_fixture::kFeatureCount == production_model::kFeatureCount);
  for (std::uint32_t sample = 0u; sample < model_fixture::kSampleCount; ++sample) {
    const auto *features = model_fixture::kFeatures.data() + sample * model_fixture::kFeatureCount;
    const double margin = HeapTreeEvaluator::margin(model, features);
    CHECK(std::abs(margin - model_fixture::kExpectedMargins[sample]) <= 1.0e-12);
  }
}

void testBatchedReferenceMargins() {
  constexpr auto model = production_model::model();
  static_assert(model_fixture::kSampleCount >= 4u);
  constexpr std::array<std::uint32_t, 4> samples = {3u, 0u, 2u, 1u};
  std::array<const float *, 4> rows{};
  std::array<double, 4> margins{};
  margins.fill(HeapTreeEvaluator::initialMargin(model));
  for (auto row = 0u; row < rows.size(); ++row)
    rows[row] = model_fixture::kFeatures.data() + samples[row] * model_fixture::kFeatureCount;
  std::uint32_t begin = 0u;
  for (const auto end : {0u, 31u, 128u, 129u, model.tree_count}) {
    HeapTreeEvaluator::accumulateTrees4(model, rows.data(), begin, end, margins.data());
    begin = end;
  }
  for (auto row = 0u; row < rows.size(); ++row) {
    CHECK(margins[row] == HeapTreeEvaluator::margin(model, rows[row]));
    CHECK(std::abs(margins[row] - model_fixture::kExpectedMargins[samples[row]]) <= 1.0e-12);
  }
}

void testPitchContextPartitioning() {
  using effetune::plugins::analyzer::PitchContextFeatures;
  PitchContextFeatures::BaseFrame base{};
  for (std::uint32_t pitch = 0u; pitch < base.size(); ++pitch)
    for (std::uint32_t feature = 0u; feature < base[pitch].size(); ++feature)
      base[pitch][feature] = static_cast<float>(pitch * 100u + feature);
  PitchContextFeatures whole, partitioned;
  whole.update(base, 0u, 88u);
  partitioned.update(base, 0u, 31u);
  partitioned.update(base, 31u, 67u);
  partitioned.update(base, 67u, 88u);
  CHECK(whole.values() == partitioned.values());
  for (std::uint32_t pitch = 0u; pitch < base.size(); ++pitch) {
    const auto &row = whole.values()[pitch];
    for (std::uint32_t feature = 0u; feature < base[pitch].size(); ++feature)
      CHECK(row[feature] == base[pitch][feature]);
    const double hz = 440.0 * std::exp2((static_cast<double>(pitch) + 21.0 - 69.0) / 12.0);
    CHECK(row[45u] == static_cast<float>(hz / (44100.0 / 4096.0)));
    CHECK(row[46u] == static_cast<float>(44100.0 / hz / 2048.0));
    CHECK(row[47u] == static_cast<float>(std::min(3.0, std::floor(2048.0 * hz / 44100.0))));
    std::uint32_t column = 48u;
    for (const auto offset : PitchContextFeatures::kOffsets) {
      const int neighbor = static_cast<int>(pitch) + offset;
      for (const auto feature : PitchContextFeatures::kEvidence) {
        const float expected = neighbor >= 0 && neighbor < 88
                                   ? base[static_cast<std::uint32_t>(neighbor)][feature]
                                   : 0.0F;
        CHECK(row[column++] == expected);
      }
    }
  }
  whole.clear();
  for (const auto &row : whole.values())
    for (const auto value : row)
      CHECK(value == 0.0F);
  whole.update(base, 0u, 88u);
  CHECK(whole.values() == partitioned.values());
}
void testOctaveModelReferenceMargins() {
  namespace model = effetune::plugins::analyzer::octave_model;
  namespace fixture = effetune::plugins::analyzer::octave_model_fixture;
  std::array<const float *, 4> rows{};
  std::array<double, 16> margins{};
  for (auto row = 0u; row < 4u; ++row)
    rows[row] = fixture::kFeatures.data() + row * model::kFeatureCount;
  // Match the runtime prefix and partial final batch, leaving inactive rows untouched.
  HeapTreeEvaluator::accumulateTrees4<4u>(model::model(), rows.data(), 0u, 128u, margins.data());
  const auto prefix = margins;
  HeapTreeEvaluator::accumulateTrees4<4u>(model::model(), rows.data(), 128u, model::kTreeCount,
                                          margins.data(), 3u);
  for (auto value = 0u; value < 12u; ++value)
    CHECK(std::abs(margins[value] - fixture::kExpectedMargins[value]) <= 1.0e-6);
  for (auto value = 12u; value < 16u; ++value)
    CHECK(margins[value] == prefix[value]);
  HeapTreeEvaluator::accumulateTrees4<4u>(model::model(), rows.data() + 3u, 128u, model::kTreeCount,
                                          margins.data() + 12u, 1u);
  for (auto value = 12u; value < 16u; ++value)
    CHECK(std::abs(margins[value] - fixture::kExpectedMargins[value]) <= 1.0e-6);
}

void testOctaveFeatureTransposition() {
  using effetune::plugins::analyzer::OctavePairFeatures;
  OctavePairFeatures::BaseFrame short_frame{}, long_frame{}, shifted_short{}, shifted_long{};
  for (auto pitch = 0u; pitch < 87u; ++pitch)
    for (auto feature = 0u; feature < 45u; ++feature) {
      short_frame[pitch][feature] = static_cast<float>(pitch * 100u + feature);
      long_frame[pitch][feature] = -short_frame[pitch][feature];
      shifted_short[pitch + 1u][feature] = short_frame[pitch][feature];
      shifted_long[pitch + 1u][feature] = long_frame[pitch][feature];
    }
  OctavePairFeatures original, shifted;
  original.update(short_frame, long_frame, 0u, 12u);
  shifted.update(shifted_short, shifted_long, 0u, 5u);
  shifted.update(shifted_short, shifted_long, 5u, 12u);
  for (auto pair = 0u; pair < 11u; ++pair)
    CHECK(original.values()[pair] == shifted.values()[pair + 1u]);
  const auto &row = original.values()[0];
  CHECK(row[0] == short_frame[3][0]);
  CHECK(row[45] == long_frame[3][0]);
  CHECK(row[90] == short_frame[3][0] - short_frame[3][1]);
  CHECK(row[98] == long_frame[2][0]);
  CHECK(row[106] == short_frame[15][0]);
  CHECK(row[211] == long_frame[16][22]);
}
void testMultiresolutionPartitioning() {
  using effetune::plugins::analyzer::MultiresolutionFeatures;
  using effetune::plugins::analyzer::PitchContextFeatures;
  MultiresolutionFeatures::BaseFrame short_frame{}, long_frame{};
  for (std::uint32_t pitch = 0u; pitch < 88u; ++pitch)
    for (std::uint32_t feature = 0u; feature < 45u; ++feature) {
      short_frame[pitch][feature] = static_cast<float>(pitch * 100u + feature);
      long_frame[pitch][feature] = -short_frame[pitch][feature];
    }
  MultiresolutionFeatures whole, partitioned;
  PitchContextFeatures context;
  whole.update(short_frame, long_frame, 0u, 88u);
  partitioned.update(short_frame, long_frame, 0u, 31u);
  partitioned.update(short_frame, long_frame, 31u, 88u);
  context.update(short_frame, 0u, 88u);
  CHECK(whole.values() == partitioned.values());
  for (std::uint32_t pitch = 0u; pitch < 88u; ++pitch) {
    for (std::uint32_t feature = 0u; feature < 88u; ++feature)
      CHECK(whole.values()[pitch][feature] == context.values()[pitch][feature]);
    for (std::uint32_t feature = 0u; feature < 45u; ++feature)
      CHECK(whole.values()[pitch][88u + feature] == long_frame[pitch][feature]);
  }
  whole.clear();
  for (const auto &row : whole.values())
    for (const auto value : row)
      CHECK(value == 0.0F);
}
} // namespace

int main() {
  testHeapRoutingAndStrictSplit();
  testStableSigmoidAndExcessProbability();
  testFullModelReferenceMargins();
  testBatchedReferenceMargins();
  testPitchContextPartitioning();
  testMultiresolutionPartitioning();
  testOctaveModelReferenceMargins();
  testOctaveFeatureTransposition();
  return failures == 0 ? 0 : 1;
}

#ifndef EFFETUNE_HEAP_TREE_MODEL_H
#define EFFETUNE_HEAP_TREE_MODEL_H

#include <cmath>
#include <cstdint>
#include <type_traits>

namespace effetune::plugins::analyzer {

// Numeric-only representation of a fixed-depth binary tree ensemble.
// Multi-output models store their output values consecutively at each leaf.
// `std::uint8_t` thresholds index the sorted borders of the split's feature, which start at
// `border_offsets[feature]`. `std::int16_t` leaves are scaled by one `leaf_scales` entry per
// (tree, output).
template <typename LeafValue, typename Threshold = float> struct BasicHeapTreeModelView {
  static_assert(std::is_same_v<Threshold, float> || std::is_same_v<Threshold, std::uint8_t>);
  static_assert(std::is_same_v<LeafValue, double> || std::is_same_v<LeafValue, float> ||
                std::is_same_v<LeafValue, std::int16_t>);
  std::uint32_t feature_count = 0u;
  std::uint32_t tree_count = 0u;
  std::uint32_t depth = 0u;
  double scale = 1.0;
  double bias = 0.0;
  const std::uint8_t *split_features = nullptr;
  const Threshold *split_thresholds = nullptr;
  const LeafValue *leaf_values = nullptr;
  const float *borders = nullptr;
  const std::uint32_t *border_offsets = nullptr;
  const float *leaf_scales = nullptr;
};
using HeapTreeModelView = BasicHeapTreeModelView<double>;
using FloatHeapTreeModelView = BasicHeapTreeModelView<float>;

class HeapTreeEvaluator final {
public:
  template <typename LeafValue, typename Threshold>
  static double initialMargin(const BasicHeapTreeModelView<LeafValue, Threshold> &model) noexcept {
    return model.bias;
  }

  template <typename LeafValue, typename Threshold>
  static void accumulateTree(const BasicHeapTreeModelView<LeafValue, Threshold> &model,
                             const float *features, std::uint32_t tree, double &margin) noexcept {
    const auto internal_count = (1u << model.depth) - 1u;
    const auto split_base = tree * internal_count;
    std::uint32_t node = 0u;
    for (std::uint32_t depth = 0u; depth < model.depth; ++depth)
      node = 2u * node + (goesRight(model, features, split_base + node) ? 2u : 1u);
    const auto leaf_base = tree << model.depth;
    margin += model.scale * leafValue<1u>(model, tree, leaf_base + node - internal_count, 0u);
  }

  template <std::uint32_t OutputCount = 1u, typename LeafValue, typename Threshold>
  static void accumulateTree4(const BasicHeapTreeModelView<LeafValue, Threshold> &model,
                              const float *const feature_rows[4], std::uint32_t row_count,
                              std::uint32_t tree, double *margins) noexcept {
    std::uint32_t nodes[4] = {};
    const auto internal_count = (1u << model.depth) - 1u;
    const auto split_base = tree * internal_count;
    for (std::uint32_t depth = 0u; depth < model.depth; ++depth) {
      for (std::uint32_t row = 0u; row < row_count; ++row)
        nodes[row] = 2u * nodes[row] +
                     (goesRight(model, feature_rows[row], split_base + nodes[row]) ? 2u : 1u);
    }
    const auto leaf_base = tree << model.depth;
    for (std::uint32_t row = 0u; row < row_count; ++row) {
      const auto leaf = leaf_base + nodes[row] - internal_count;
      for (auto output = 0u; output < OutputCount; ++output)
        margins[row * OutputCount + output] +=
            model.scale * leafValue<OutputCount>(model, tree, leaf, output);
    }
  }

  template <typename LeafValue, typename Threshold>
  static double margin(const BasicHeapTreeModelView<LeafValue, Threshold> &model,
                       const float *features) noexcept {
    double result = initialMargin(model);
    for (std::uint32_t tree = 0u; tree < model.tree_count; ++tree)
      accumulateTree(model, features, tree, result);
    return result;
  }

  template <std::uint32_t OutputCount = 1u, typename LeafValue, typename Threshold>
  static void accumulateTrees4(const BasicHeapTreeModelView<LeafValue, Threshold> &model,
                               const float *const feature_rows[4], std::uint32_t first_tree,
                               std::uint32_t end_tree, double *margins,
                               std::uint32_t row_count = 4u) noexcept {
    // Keep scores local across a batch without changing each row's tree addition order.
    double accumulated[4u * OutputCount];
    for (auto value = 0u; value < row_count * OutputCount; ++value)
      accumulated[value] = margins[value];
    for (auto tree = first_tree; tree < end_tree; ++tree)
      accumulateTree4<OutputCount>(model, feature_rows, row_count, tree, accumulated);
    for (auto value = 0u; value < row_count * OutputCount; ++value)
      margins[value] = accumulated[value];
  }

  static float probability(double margin) noexcept {
    if (margin >= 0.0)
      return static_cast<float>(1.0 / (1.0 + std::exp(-margin)));
    const double exponential = std::exp(margin);
    return static_cast<float>(exponential / (1.0 + exponential));
  }

  static float excessProbability(float probability, float prior) noexcept {
    return probability > prior ? (probability - prior) / (1.0F - prior) : 0.0F;
  }

private:
  template <typename LeafValue, typename Threshold>
  static bool goesRight(const BasicHeapTreeModelView<LeafValue, Threshold> &model,
                        const float *features, std::uint32_t split) noexcept {
    const auto feature = model.split_features[split];
    if constexpr (std::is_same_v<Threshold, float>)
      return features[feature] > model.split_thresholds[split];
    else
      return features[feature] >
             model.borders[model.border_offsets[feature] + model.split_thresholds[split]];
  }

  template <std::uint32_t OutputCount, typename LeafValue, typename Threshold>
  static double leafValue(const BasicHeapTreeModelView<LeafValue, Threshold> &model,
                          std::uint32_t tree, std::uint32_t leaf, std::uint32_t output) noexcept {
    const auto value = model.leaf_values[leaf * OutputCount + output];
    if constexpr (std::is_same_v<LeafValue, std::int16_t>)
      return value * static_cast<double>(model.leaf_scales[tree * OutputCount + output]);
    else
      return value;
  }
};

} // namespace effetune::plugins::analyzer

#endif

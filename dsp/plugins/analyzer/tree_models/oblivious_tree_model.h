#ifndef EFFETUNE_OBLIVIOUS_TREE_MODEL_H
#define EFFETUNE_OBLIVIOUS_TREE_MODEL_H

#include <cstdint>
#include <type_traits>

namespace effetune::plugins::analyzer {

// Numeric-only representation of a fixed-depth oblivious (symmetric) tree ensemble: every node
// of one tree level shares one split, so a tree stores `depth` splits and split k sets bit k of
// the leaf index. Thresholds index the sorted borders of the split's feature, which start at
// `border_offsets[feature]`. Integer leaves are scaled by one `leaf_scales` entry per
// (tree, output); multi-output models store their output values consecutively at each leaf.
template <typename LeafValue> struct ObliviousTreeModelView {
  static_assert(std::is_same_v<LeafValue, std::int8_t> || std::is_same_v<LeafValue, std::int16_t>);
  std::uint32_t feature_count = 0u;
  std::uint32_t tree_count = 0u;
  std::uint32_t depth = 0u;
  double scale = 1.0;
  double bias = 0.0;
  const std::uint8_t *split_features = nullptr;
  const std::uint8_t *split_thresholds = nullptr;
  const LeafValue *leaf_values = nullptr;
  const float *borders = nullptr;
  const std::uint32_t *border_offsets = nullptr;
  const float *leaf_scales = nullptr;

  constexpr std::uint32_t splitCount() const noexcept { return tree_count * depth; }
};

class ObliviousTreeEvaluator final {
public:
  template <typename LeafValue>
  static double initialMargin(const ObliviousTreeModelView<LeafValue> &model) noexcept {
    return model.bias;
  }

  template <typename LeafValue>
  static double margin(const ObliviousTreeModelView<LeafValue> &model,
                       const float *features) noexcept {
    double result = initialMargin(model);
    for (std::uint32_t tree = 0u; tree < model.tree_count; ++tree)
      result += model.scale * leafValue<1u>(model, tree, leafIndex(model, features, tree), 0u);
    return result;
  }

  template <std::uint32_t OutputCount = 1u, typename LeafValue>
  static void accumulateTrees4(const ObliviousTreeModelView<LeafValue> &model,
                               const float *const feature_rows[4], std::uint32_t first_tree,
                               std::uint32_t end_tree, double *margins,
                               std::uint32_t row_count = 4u) noexcept {
    // Keep scores local across a batch without changing each row's tree addition order.
    double accumulated[4u * OutputCount];
    for (auto value = 0u; value < row_count * OutputCount; ++value)
      accumulated[value] = margins[value];
    for (auto tree = first_tree; tree < end_tree; ++tree) {
      for (std::uint32_t row = 0u; row < row_count; ++row) {
        const auto leaf = leafIndex(model, feature_rows[row], tree);
        for (auto output = 0u; output < OutputCount; ++output)
          accumulated[row * OutputCount + output] +=
              model.scale * leafValue<OutputCount>(model, tree, leaf, output);
      }
    }
    for (auto value = 0u; value < row_count * OutputCount; ++value)
      margins[value] = accumulated[value];
  }

private:
  template <typename LeafValue>
  static std::uint32_t leafIndex(const ObliviousTreeModelView<LeafValue> &model,
                                 const float *features, std::uint32_t tree) noexcept {
    const auto split_base = tree * model.depth;
    std::uint32_t leaf = 0u;
    for (std::uint32_t split = 0u; split < model.depth; ++split) {
      const auto feature = model.split_features[split_base + split];
      const auto border =
          model.borders[model.border_offsets[feature] + model.split_thresholds[split_base + split]];
      leaf |= static_cast<std::uint32_t>(features[feature] > border) << split;
    }
    return leaf;
  }

  template <std::uint32_t OutputCount, typename LeafValue>
  static double leafValue(const ObliviousTreeModelView<LeafValue> &model, std::uint32_t tree,
                          std::uint32_t leaf, std::uint32_t output) noexcept {
    const auto value = model.leaf_values[((tree << model.depth) + leaf) * OutputCount + output];
    return value * static_cast<double>(model.leaf_scales[tree * OutputCount + output]);
  }
};

} // namespace effetune::plugins::analyzer

#endif

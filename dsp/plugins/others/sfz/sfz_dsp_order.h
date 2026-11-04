#ifndef EFFETUNE_SFZ_DSP_ORDER_H
#define EFFETUNE_SFZ_DSP_ORDER_H
#include <cstdint>

namespace effetune::plugins::others::sfz {
// Rapture Pro User Guide, figure 23: three per-voice DSP stages (0..2)
// and two filters (3..4). This is unrelated to the ordered <effect> bus chains.
// Parallel paths add linearly; proprietary branch gain normalization is not
// specified by that graph, so this profile does not claim that measured parity.
template <typename Sample, typename Processor>
Sample routeVoiceDsp(std::uint32_t order, Sample input, Processor &&process) noexcept {
  const auto chain = [&](Sample value, auto... stages) {
    ((value = process(stages, value)), ...);
    return value;
  };
  const auto parallel = [&](Sample value, unsigned left, unsigned right) {
    const auto a = process(left, value);
    const auto b = process(right, value);
    return a + b;
  };
  switch (order) {
  case 1:
    return chain(input, 0u, 1u, 3u, 2u, 4u);
  case 2:
    return chain(input, 3u, 0u, 1u, 2u, 4u);
  case 3:
    return chain(input, 3u, 0u, 4u, 1u, 2u);
  case 4:
    return process(2u, parallel(chain(input, 3u, 0u), 1u, 4u));
  case 5:
    return process(4u, parallel(chain(input, 0u, 1u), 3u, 2u));
  case 6:
    return parallel(chain(input, 0u, 1u, 2u), 3u, 4u);
  case 7:
    return chain(input, 0u, 1u, 2u, 3u, 4u);
  case 8: {
    const auto a = chain(input, 0u, 3u);
    const auto b = chain(input, 1u, 4u);
    return process(2u, a + b);
  }
  case 9: {
    const auto start = process(0u, input);
    const auto a = chain(start, 1u, 3u);
    const auto b = chain(start, 2u, 4u);
    return a + b;
  }
  case 10:
    return process(2u, parallel(chain(input, 0u, 1u), 3u, 4u));
  case 11:
    return chain(parallel(process(3u, input), 0u, 1u), 2u, 4u);
  case 12:
    return chain(parallel(process(3u, input), 0u, 1u), 4u, 2u);
  case 13:
    return chain(parallel(input, 0u, 1u), 3u, 2u, 4u);
  case 14:
    return chain(parallel(input, 0u, 1u), 2u, 3u, 4u);
  default:
    return input;
  }
}
} // namespace effetune::plugins::others::sfz
#endif

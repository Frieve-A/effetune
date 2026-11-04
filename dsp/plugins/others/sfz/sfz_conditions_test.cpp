#include "sfz_conditions.h"
#include <array>
#include <cstdio>
#include <cstdlib>
namespace c = effetune::plugins::others::sfz::conditions;
static void require(bool value, const char *message) {
  if (!value) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
int main() {
  const std::array ranges{c::ControllerRange{90, .333F, .7F}, c::ControllerRange{1, .5F, .5F}};
  require(c::matchControllers(ranges, [](std::uint32_t cc) { return cc == 90 ? .333F : .5F; }),
          "high-resolution initialization exact boundaries");
  require(
      !c::matchControllers(ranges, [](std::uint32_t cc) { return cc == 90 ? .7F : 64.F / 127; }),
      "rounded MIDI identity must not replace precise source");
  const std::array trigger{c::ControllerRange{64, 1, 1}, c::ControllerRange{2, -1, .5F},
                           c::ControllerRange{3, -1, -1}};
  require(c::matchesEvent(trigger, 64, 1), "assigned controller event");
  require(!c::matchesEvent(trigger, 63, 1), "other controller does not trigger");
  require(!c::matchesEvent(trigger, 3, 0), "unassigned bounds do not trigger");
  require(c::matchesEvent(trigger, 2, 0), "one-sided controller range");
  require(c::hasEventTrigger(trigger), "controller regions excluded from ordinary note selection");
  require(c::tempo(100, 200.5F, 100), "tempo low inclusive");
  require(!c::tempo(100, 200.5F, 200.5), "tempo high exclusive");
  require(c::timer(0, std::numeric_limits<float>::max(), std::numeric_limits<double>::infinity()),
          "first birth without timer upper limit");
  require(!c::timer(0, .25F, std::numeric_limits<double>::infinity()),
          "first birth cannot satisfy finite recency");
  const double eventAge = .25;
  require(c::timer(.25F, 1, eventAge) && c::timer(.25F, 1, eventAge),
          "layers share one event-age snapshot");
  require(!c::timer(0, .25F, eventAge), "timer boundary avoids layer overlap");
  std::puts("SFZ condition tests passed");
}

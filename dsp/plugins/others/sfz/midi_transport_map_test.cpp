#include "midi_transport_map.h"
#include <cstdio>
#include <cstdlib>
#include <limits>

using effetune::HostTransport;
using namespace effetune::plugins::others::sfz;
static void require(bool condition, const char *message) {
  if (!condition) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
static void near(double actual, double expected, const char *message) {
  require(std::abs(actual - expected) < 1e-10, message);
}
int main() {
  MidiTransportMap map;
  const et_midi_transport_point points[] = {
      {0, 0, 0, 120, 4, 4}, {.05, .1, .1, 60, 3, 8}, {.1, .15, .1, 180, 3, 8}};
  require(map.assign(points, 3) == ET_OK, "accept ordered parser map");
  MidiTransportMapping mapping{0, 0, 1, .2, 3};
  auto value = map.at(mapping, 49, 1000);
  near(value.tempoBpm, 120, "tempo before edge");
  value = map.at(mapping, 50, 1000);
  near(value.tempoBpm, 60, "tempo changes at event frame inside block");
  near(value.ppqPosition, .1, "PPQ at tempo/meter edge");
  near(value.barStartPpq, .1, "meter origin survives tempo changes");
  require(value.timeSignatureNumerator == 3 && value.timeSignatureDenominator == 8,
          "meter fields change at event frame");
  value = map.at(mapping, 100, 1000);
  near(value.ppqPosition, .15, "second tempo edge keeps PPQ continuous");
  // The same source position can have a different native clock after a late join,
  // paused checkpoint restoration or a speed change. No second clock is needed.
  mapping = {900, .1, 2, .2, 3};
  value = map.at(mapping, 925, 1000);
  near(value.tempoBpm, 360, "physical tempo includes playback speed");
  near(value.ppqPosition, .3, "retimed PPQ follows native render frames");
  mapping.flags = 1;
  value = map.at(mapping, 900, 1000);
  require(!(value.flags & HostTransport::kPlaying), "paused transport retains valid facts");
  near(value.ppqPosition, .15, "paused origin is preserved");
  mapping.flags = 7;
  require(map.at(mapping, 925, 1000).flags & HostTransport::kLooping, "looping is explicit");
  value = map.at(mapping, 1000, 1000);
  near(value.ppqPosition, .45, "tail rendering freezes song PPQ at duration");
  require(!(value.flags & HostTransport::kPlaying), "tail rendering does not report playback");
  mapping = {0, 0, 1, .2, 3};
  auto invalid = points[1];
  invalid.bpm = std::numeric_limits<double>::infinity();
  require(map.assign(&invalid, 1) == ET_ERR_ARGS, "reject invalid map without losing old one");
  near(map.at(mapping, 50, 1000).tempoBpm, 60, "invalid replacement is atomic");
  require(map.assign(nullptr, MidiTransportMap::kMaxPoints + 1) == ET_ERR_ARGS, "bounded map");
  const et_midi_transport_point fractional[] = {{0, 0, 0, 120, 4, 4},
                                                {.0504, .1008, .1008, 60, 3, 8}};
  require(map.assign(fractional, 2) == ET_OK, "fractional event frame");
  value = map.at(mapping, 50, 1000);
  near(value.ppqPosition, value.barStartPpq,
       "rounded meter boundary starts exactly on its own bar");
  require(map.assign(nullptr, 0) == ET_OK && !map.available(), "explicit clear");
  require(map.at(mapping, 0, 1000).flags == 0, "missing host facts are unavailable");
}

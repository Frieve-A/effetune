#include "allocation_guard.h"
#include "sf2_effects.h"
#include <array>
#include <cstdio>
#include <cstdlib>

namespace sf2 = effetune::plugins::others::sfz::sf2;
static void require(bool condition, const char *message) {
  if (!condition) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
int main() {
  constexpr std::uint32_t frames = 128;
  sf2::Effects effects;
  require(effects.prepare({48000, 2, frames}), "effects preparation");
  std::array<float, frames * 2> chorus{}, reverb{};
  double chorusEnergy = 0, reverbEnergy = 0;
  std::array<float, frames * 2> firstReturn{};
  for (int replay = 0; replay < 2; ++replay) {
    effects.reset();
    require(!effects.active(), "reset removes tails");
    chorusEnergy = reverbEnergy = 0;
    for (std::uint32_t block = 0; block < 1875; ++block) {
      chorus.fill(0);
      reverb.fill(0);
      if (block == 0) {
        chorus[0] = chorus[frames] = .5F;
        reverb[0] = reverb[frames] = .5F;
      }
      {
        effetune::allocation_guard::Scope guard;
        effects.process(chorus.data(), reverb.data(), frames, {block * frames / 48000.0});
      }
      if (block == 0)
        require(effects.active(), "tail survives initial delay");
      if (block == 20) {
        require(effects.active(), "tail survives source ending");
        if (!replay)
          firstReturn = reverb;
        else
          require(firstReturn == reverb, "reset reproduces deterministic reverb");
      }
      for (std::size_t i = 0; i < chorus.size(); ++i) {
        require(std::isfinite(chorus[i]) && std::isfinite(reverb[i]), "finite effects output");
        chorusEnergy += chorus[i] * chorus[i];
        reverbEnergy += reverb[i] * reverb[i];
      }
    }
    require(chorusEnergy > .01 && reverbEnergy > .01, "both sends produce wet output");
    require(!effects.active(), "tails settle to idle");
  }
  {
    effetune::allocation_guard::Scope guard;
    effects.reset();
    chorus.fill(0);
    reverb.fill(0);
    effects.process(chorus.data(), reverb.data(), frames, {0});
  }
  require(!effects.active(), "zero sends keep effects idle");
  for (std::size_t i = 0; i < chorus.size(); ++i)
    require(chorus[i] == 0 && reverb[i] == 0, "idle outputs remain exact zero");
  require(effetune::allocation_guard::violationCount() == 0, "render and reset never allocate");
  require(effects.prepare({192000, 2, frames}), "high-rate preparation");
  std::puts("SF2 send effects tests passed");
}

#include "sfz_playback.h"
#include "sfz_playback_preparation.h"
#include <array>
#include <cstdio>
#include <cstdlib>
#include <type_traits>
namespace p = effetune::plugins::others::sfz::playback;
static void require(bool value, const char *message) {
  if (!value) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
static void near(double actual, double expected, const char *message) {
  require(std::abs(actual - expected) < 1.e-6, message);
}
int main() {
  static_assert(std::is_trivially_copyable_v<p::TimingState>);
  static_assert(sizeof(p::TimingState) == 32);
  static_assert(sizeof(p::PreparedPlayback) <=
                effetune::plugins::others::sfz::schema::kStoragePlaybackPlanBytes);
  static_assert(sizeof(p::ReverseCondition) ==
                effetune::plugins::others::sfz::schema::kStorageReverseConditionBytes);
  for (const auto &property : effetune::plugins::others::sfz::schema::kProperties) {
    unsigned expected = 0;
    for (const auto &candidate : effetune::plugins::others::sfz::schema::kProperties)
      if (candidate.kind == property.kind && candidate.property < property.property)
        ++expected;
    require(effetune::plugins::others::sfz::schema::parameterRank(
                static_cast<unsigned>(property.kind), static_cast<unsigned>(property.property)) ==
                expected,
            "generated rank matches complete sorted instance parameters");
  }
  require(effetune::plugins::others::sfz::schema::parameterRank(UINT32_MAX, UINT32_MAX) ==
              UINT32_MAX,
          "generated lookup rejects out-of-range inputs");
  {
    namespace m = effetune::plugins::others::sfz::modulation;
    using K = effetune::plugins::others::sfz::schema::Kind;
    using P = effetune::plugins::others::sfz::schema::Property;
    const auto kind = [](K value) { return static_cast<std::uint32_t>(value); };
    const auto parameter = [](unsigned instance, P property, float base) {
      return m::Parameter{instance, static_cast<std::uint32_t>(property), base, 0};
    };
    std::array<m::Instance, 4> instances{{{kind(K::SamplePlayback), 0, UINT32_MAX, 0, 3, 0},
                                          {kind(K::Lifecycle), 0, UINT32_MAX, 3, 2, 0},
                                          {kind(K::ReleaseDecaySegment), 2, 1, 5, 2, 0},
                                          {kind(K::ReleaseDecaySegment), 1, 1, 7, 2, 0}}};
    std::array<m::Parameter, 9> parameters{
        {parameter(0, P::DelaySamples, 0), parameter(0, P::OffsetRandom, 0),
         parameter(0, P::PlayCount, 0), parameter(1, P::SustainLow, .5F),
         parameter(1, P::OffShape, -3.8F), parameter(2, P::ReleaseDecay, 9),
         parameter(2, P::Time, -1), parameter(3, P::ReleaseDecay, -9), parameter(3, P::Time, 2)}};
    std::array<p::PreparedDecaySegment, 2> segments;
    const m::RegionView view{instances, parameters, {}, {}, {}, {}};
    const auto exact = [](unsigned local) -> std::uint64_t {
      return local == 0 ? 4294967296ULL : local == 1 ? 16777217ULL : 0xffffffffULL;
    };
    const auto prepared = p::prepareSettings(view, exact, segments);
    require(prepared.valid && prepared.timing.delaySamples == 4294967296.0 &&
                prepared.randomOffset == 16777217ULL && prepared.playCount == 0xffffffffULL,
            "CONTROL keeps all exact integer bases outside float lanes");
    require(prepared.decay[0].authoredIndex == 1 && prepared.decay[1].authoredIndex == 2,
            "CONTROL sorts only used release segments by authored index");
    near(p::releaseDecay(3, 0, prepared.decay), 9,
         "prepared release stages retain rate and duration");
    require(prepared.slots[static_cast<unsigned>(p::Slot::DelaySamples)] == 0,
            "prepared local index avoids render search");
    require(!p::prepareSettings(view, exact, {}).valid,
            "caller must provide all used stage storage");
    std::printf("Prepared playback bytes: %zu; decay segment bytes: %zu\n",
                sizeof(p::PreparedPlayback), sizeof(p::PreparedDecaySegment));
  }
  p::Timing settings;
  settings.syncBeats = 4;
  settings.syncOffset = 1;
  settings.delayBeats = .25;
  settings.stopBeats = 1;
  auto state = p::schedule(settings, 2, 48000, .5);
  near(state.startBeat, 5.25, "next sync grid plus beat delay");
  require(!p::tickTiming(state, 5.249, 1.0 / 48000), "wait for real beat boundary");
  require(p::tickTiming(state, 5.25, 1.0 / 48000), "tempo-independent PPQ onset");
  require(!p::tickTiming(state, 6, 1.0 / 48000), "stop anchored to synchronized origin");
  settings = {};
  settings.delaySamples = 3;
  state = p::schedule(settings, 0, 96000, 0);
  for (int i = 0; i < 3; ++i)
    require(!p::tickTiming(state, 0, 1.0 / 96000), "sample delay count");
  require(p::tickTiming(state, 0, 1.0 / 96000), "sample delay ends on exact frame");
  state = p::schedule(settings, 0, 96000, 0);
  p::cancelPending(state);
  require(!p::tickTiming(state, 100, 1), "noteoff cancels delayed attack");
  settings = {};
  settings.delayBeats = 1;
  settings.randomBeats = 2;
  state = p::schedule(settings, 10, 48000, .25);
  near(state.startBeat, 11.5, "unipolar randomized delay");
  auto trial = state;
  for (int i = 0; i < 40; ++i)
    require(p::tickTiming(state, 10 + i * .05, .01) == p::tickTiming(trial, 10 + i * .05, .01),
            "exact trial copy");
  for (unsigned cc : {0u, 1u, 63u, 64u}) {
    require(p::pedalDown(true, .5F, cc) == (cc > 0), "raw half-pedal threshold");
    require(p::pedalDown(true, 64, cc) == (cc >= 64), "raw switch threshold");
    require(!p::pedalDown(false, .5F, cc), "disabled pedal");
  }
  for (std::uint64_t depth : {16777217ULL, 4294967296ULL})
    for (unsigned cc : {0u, 1u, 64u, 127u}) {
      require(p::sampleDelay(0, p::integerDelayContribution(static_cast<double>(depth),
                                                            static_cast<std::uint8_t>(cc))) ==
                  depth * cc / 127,
              "large integer delay uses exact base and raw controller precision");
      require(p::sampleDelay(0, p::integerDelayContribution(-static_cast<double>(depth),
                                                            static_cast<std::uint8_t>(cc))) == 0,
              "negative delay clamps after contribution");
    }
  require(p::sampleDelay(16777217ULL, p::integerDelayContribution(-16777217, 127)) == 0,
          "negative exact depth cancels exact base");
  require(p::sampleDelay(16777217ULL, 0) == 16777217ULL, "birth base never narrows through float");
  const std::array<p::ReverseCondition, 2> reverse{{{1, 64, 127}, {2, 0, 20}}};
  const auto values = [](unsigned cc) { return cc == 1 ? 64 : 20; };
  require(p::reverseDirection(false, reverse, values), "reverse conditions include both endpoints");
  require(!p::reverseDirection(false, reverse, [](unsigned cc) { return cc == 1 ? 63 : 20; }),
          "reverse ranges combine as conditions");
  require(p::reverseDirection(true, {}, values),
          "explicit reversed direction remains unconditional");
  require(!p::selfMaskCandidate(true, 100, 60) && p::selfMaskCandidate(true, 60, 100),
          "soft retrigger protects louder old note");
  require(p::selfMaskCandidate(false, 100, 60), "strict note polyphony when mask disabled");
  require(!p::releaseEligible(false, false) && p::releaseEligible(true, false),
          "dead attack policy");
  std::array<p::DecaySegment, 3> decay{{{-9, 2}, {4, 1}, {9, -1}}};
  near(p::releaseDecay(1, 0, decay), 9, "negative first rate increases release gain");
  near(p::releaseDecay(2, 0, decay), 18, "exact first segment boundary");
  near(p::releaseDecay(3, 0, decay), 14, "second segment accumulation");
  near(p::releaseDecay(4, 0, decay), 5, "infinite last segment");
  near(p::releaseDecay(3, 2, std::span<const p::DecaySegment>{}), -6,
       "ordinary release decay uses corresponding note age");
  near(p::startOffset(1000, 25, true, 10000, 100, .5), 3550,
       "percent delta and frame random offset");
  near(p::loopPitchRatio(false, 1200), 1, "loop tuning excludes onset");
  near(p::loopPitchRatio(true, 1200), 2, "loop-only octave");
  const std::array<double, 8> forward{10, 11, 12, 13, 10, 11, 12, 13};
  const std::array<double, 8> backward{13, 12, 11, 10, 13, 12, 11, 10};
  const std::array<double, 8> alternate{10, 11, 12, 13, 12, 11, 10, 11};
  for (std::size_t i = 0; i < forward.size(); ++i) {
    near(p::loopAddress(static_cast<double>(i), 10, 13, 0), forward[i],
         "forward loop visits endpoints");
    near(p::loopAddress(static_cast<double>(i), 10, 13, 1), backward[i],
         "backward loop visits endpoints");
    near(p::loopAddress(static_cast<double>(i), 10, 13, 2), alternate[i],
         "alternate loop reverses without duplicated endpoints");
  }
  p::RepeatState repeat;
  double position = 14;
  require(p::repeatSample(repeat, position, 10, 13, 2, false), "second complete play starts");
  near(position, 10, "whole sample restarts at selected onset");
  position = 14;
  require(!p::repeatSample(repeat, position, 10, 13, 2, false),
          "two plays finish without EG retrigger");
  repeat = {};
  position = 9;
  require(p::repeatSample(repeat, position, 10, 13, 4294967296ULL, true),
          "full public count exact");
  near(position, 13, "reverse repeat starts at last frame");
  near(p::fadeout(2400, 1, 48000, .1), .5, "fade duration in seconds");
  for (int curve : {-2, -1, 0, 1, 2, 10})
    for (double shape : {-1.e30, -3.8, 0., 1., 2.1, 1.e30}) {
      near(p::offGain(0, curve, shape), 1, "off curve initial level");
      near(p::offGain(1, curve, shape), 0, "off curve final level");
      double previous = 1;
      for (int i = 1; i < 100; ++i) {
        const double value = p::offGain(i * .01, curve, shape);
        require(std::isfinite(value) && value >= 0 && value <= previous + 1.e-6,
                "off curve finite monotonic positive and negative shape");
        previous = value;
      }
    }
  near(p::offGain(.5, 0, 2), .25, "power release midpoint");
  near(p::offGain(.5, -1, 2), .5, "linear release midpoint");
  std::puts("SFZ playback tests passed");
}

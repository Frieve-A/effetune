#include "sf2_profile.h"
#include <array>
#include <complex>
#include <cstdio>
#include <cstdlib>
#include <limits>

namespace sf2 = effetune::plugins::others::sfz::sf2;
static void require(bool condition, const char *message) {
  if (!condition) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
static void near(float actual, float expected, float tolerance, const char *message) {
  require(std::abs(actual - expected) <= tolerance, message);
}
static std::array<float, 61> defaults() {
  std::array<float, 61> g{};
  g[8] = 13500;
  g[56] = 100;
  g[46] = g[47] = g[58] = -1;
  for (auto i : {21, 23, 25, 26, 27, 28, 30, 33, 34, 35, 36, 38})
    g[i] = -12000;
  return g;
}
static std::array<float, 10> route(std::uint32_t target, std::uint32_t a, float amount,
                                   std::uint32_t b = 0, std::uint32_t flags = 0,
                                   std::uint32_t transform = 0) {
  return {std::bit_cast<float>(target),
          std::bit_cast<float>(a),
          std::bit_cast<float>(b),
          amount,
          0,
          0,
          0,
          0,
          std::bit_cast<float>(flags),
          std::bit_cast<float>(transform)};
}
static void silentFilterStates() {
  sf2::Lowpass pass;
  require(pass.process(std::numeric_limits<float>::denorm_min(), 0) == 0,
          "subnormal sample input is normalized independently of host FP mode");
  require(pass.process(std::numeric_limits<float>::min(), 0) == std::numeric_limits<float>::min(),
          "smallest normal sample input is retained");
  sf2::Lowpass edge;
  edge.z2[0] = std::numeric_limits<double>::min();
  edge.process(0, 0);
  require(edge.z1[0] == std::numeric_limits<double>::min(), "smallest normal state is retained");
  edge = {};
  edge.z2[0] = std::numeric_limits<double>::denorm_min();
  edge.process(0, 0);
  require(edge.z1[0] == 0 && edge.z2[0] == 0,
          "subnormal state is normalized without a volume threshold");
  sf2::Lowpass warmed, empty;
  warmed.configure(96000, 14829.302734375, 0);
  empty.configure(96000, 14829.302734375, 0);
  for (auto frame = 0u; frame < 48000u; ++frame)
    warmed.process(static_cast<float>(.48828125 * std::sin(6.283185307179586 * frame / 128.0)), 0);
  for (auto frame = 0u; frame < 96000u; ++frame) {
    const auto output = warmed.process(0, 0);
    require(std::isfinite(output), "warm filter remains finite during missing PCM");
    require(std::fpclassify(output) != FP_SUBNORMAL, "float output cannot retain a subnormal tail");
  }
  require(warmed.z1[0] == 0 && warmed.z2[0] == 0,
          "warm-to-zero filter cannot retain a denormal limit cycle");
  for (auto frame = 0u; frame < 128u; ++frame) {
    const auto input = static_cast<float>(.25 * std::sin(6.283185307179586 * frame / 64.0));
    require(warmed.process(input, 0) == empty.process(input, 0),
            "signal resumes from exact silent filter state");
  }
}
static void silentLfoAdvance() {
  constexpr auto rate = 96000.0F;
  struct ReferenceLfo {
    double phase = 0;
    float next(float rate, float frequency, float delay, double elapsed) noexcept {
      if (elapsed < delay)
        return 0.0F;
      const auto value = phase < .25   ? phase * 4.0
                         : phase < .75 ? 2.0 - phase * 4.0
                                       : phase * 4.0 - 4.0;
      phase += frequency / rate;
      phase -= std::floor(phase);
      return static_cast<float>(value);
    }
  };
  struct Case {
    std::uint64_t firstFrame;
    float frequency, delay;
  };
  for (const auto test : {Case{0, 5.5F, 0}, Case{90, 7.25F, 100.0F / rate},
                          Case{0, 2.75F, 300.0F / rate}, Case{0, 0, 0}}) {
    ReferenceLfo reference;
    sf2::Lfo silent;
    auto first = test.firstFrame;
    for (const auto frames : {0u, 1u, 17u, 128u, 3u, 64u}) {
      for (auto frame = 0u; frame < frames; ++frame)
        reference.next(rate, test.frequency, test.delay, static_cast<double>(first + frame) / rate);
      silent.advanceSilent(rate, test.frequency, test.delay, first, frames);
      first += frames;
      require(std::bit_cast<std::uint32_t>(reference.next(rate, test.frequency, test.delay,
                                                          static_cast<double>(first) / rate)) ==
                  std::bit_cast<std::uint32_t>(silent.next(rate, test.frequency, test.delay,
                                                           static_cast<double>(first) / rate)),
              "silent LFO advancement preserves future modulation output");
      ++first;
    }
  }
}
int main() {
  silentFilterStates();
  silentLfoAdvance();
  for (const auto frequency : {5.0, 1000.0, 20000.0})
    for (const auto resonance : {0.0, .1, 20.0, 96.0}) {
      sf2::Lowpass filter;
      filter.configure(48000, frequency, resonance);
      const auto response = [&](double omega) {
        const auto z = std::polar(1.0, -omega);
        return std::abs((filter.b0 + filter.b1 * z + filter.b2 * z * z) /
                        (1.0 + filter.a1 * z + filter.a2 * z * z));
      };
      const auto dc = std::pow(10.0, -resonance / 40.0);
      const auto q = resonance > 0 ? std::pow(10.0, resonance / 20.0) : std::sqrt(.5);
      require(std::abs(response(0) / dc - 1) < .000001, "SF2 resonance DC gain");
      require(std::abs(response(6.2831853071795864769 * frequency / 48000) / (dc * q) - 1) < .0001,
              "SF2 resonance cutoff relative to DC");
      require(filter.a2 < 1 && 1 + filter.a1 + filter.a2 > 0 && 1 - filter.a1 + filter.a2 > 0,
              "SF2 resonance poles strictly stable including maximum Q and minimum frequency");
      for (auto sample = 0; sample < 8192; ++sample) {
        const auto output = filter.process(sample == 0 ? 1.0F : 0.0F, 0);
        require(std::isfinite(output) && std::abs(output) < 1000, "bounded SF2 impulse response");
      }
    }
  sf2::Lowpass bypass;
  bypass.configure(44100, 22000, 0);
  near(bypass.process(.25F, 0), .25F, 0, "nonresonant cutoff above20kHz bypasses");
  std::array<std::uint8_t, 128> cc{};
  cc[7] = 100;
  cc[10] = 64;
  cc[11] = 127;
  sf2::Inputs in;
  in.cc = cc.data();
  auto g = defaults();
  sf2::Resolved out;
  std::array<float, 8> scratch{};
  require(sf2::evaluate(g, {}, in, scratch, 60, -7, out), "default evaluation");
  near(out.pitchCents, -7, .0001F, "sample correction applied once");
  near(out.cutoffHz, 19912.127F, .01F, "absolute cents frequency");
  near(out.volEnv.attack, 1.0F / 1024.0F, .000001F, "timecent conversion");
  g[58] = 72;
  g[56] = 50;
  in.key = 60;
  require(sf2::evaluate(g, {}, in, scratch, 60, -7, out), "root override");
  near(out.pitchCents, -607, .0001F, "root override and scale tuning");
  g = defaults();
  g[35] = -32768;
  g[39] = 1200;
  in.key = 0;
  require(sf2::evaluate(g, {}, in, scratch, 60, 0, out), "zero hold evaluation");
  near(out.volEnv.hold, 0, 0, "exact zero hold survives key scaling");
  g = defaults();
  in.key = 60;
  auto pan = route(0x10011, 0x028a, 500);
  for (auto value : {0, 32, 64, 96, 127}) {
    cc[10] = static_cast<std::uint8_t>(value);
    require(sf2::evaluate(g, {pan.data(), 1}, in, scratch, 60, 0, out), "pan route");
    near(out.pan, value < 64 ? (value - 64) / 64.0F : (value - 64) / 63.0F, .00001F,
         "pan full and quarter range");
  }
  auto bend = route(0x1003c, 0x020e, 12700, 16);
  for (auto value : {-8192, 0, 8191}) {
    in.bend = value;
    in.bendRangeSemitones = 12;
    require(sf2::evaluate(g, {bend.data(), 1}, in, scratch, 60, 0, out), "pitch wheel route");
    near(out.pitchCents,
         value == 0  ? 0.0F
         : value < 0 ? -1200.0F
                     : 1200.0F,
         .001F, "two-source pitch wheel product");
  }
  auto velocity = route(0x10030, 0x0502, 960);
  in.velocity = 64;
  require(sf2::evaluate(g, {velocity.data(), 1}, in, scratch, 60, 0, out), "velocity route");
  near(out.attenuationCb, -400.0F * std::log10(64.0F / 127.0F), .0001F,
       "velocity amplitude squared law");
  g[47] = 127;
  require(sf2::evaluate(g, {velocity.data(), 1}, in, scratch, 60, 0, out), "forced velocity");
  near(out.attenuationCb, 0, 0, "per-voice velocity override");
  g[47] = -1;
  for (std::uint32_t type = 0; type < 4; ++type) {
    near(sf2::curve(0, type), 0, 0, "curve minimum");
    near(sf2::curve(1, type), 1, 0, "curve maximum");
  }
  near(sf2::curve(.5F, 1) + sf2::curve(.5F, 2), 1, .000001F, "complementary curves");
  near(sf2::mapSource(-.5F, 0x600), -sf2::curve(.5F, 1), .000001F, "bipolar concave");
  near(sf2::mapSource(-.5F, 0x700), sf2::curve(.5F, 1), .000001F, "bipolar reversed concave");
  std::array<float, 30> linked{};
  const auto a = route(0x20002, 0, -3), b = route(0x20002, 0, 1),
             c = route(0x10030, 0x20002, 100, 0, 127, 2);
  for (std::size_t i = 0; i < 10; ++i) {
    linked[i] = a[i];
    linked[10 + i] = b[i];
    linked[20 + i] = c[i];
  }
  require(sf2::evaluate(g, {linked.data(), 3}, in, scratch, 60, 0, out), "linked graph");
  near(out.attenuationCb, 200, .0001F, "linked sum and absolute transform");
  linked[0] = std::bit_cast<float>(0x20000u);
  require(!sf2::evaluate(g, {linked.data(), 3}, in, scratch, 60, 0, out), "backward link rejected");
  sf2::Lfo lfo;
  for (auto expected : {0.0F, 1.0F, 0.0F, -1.0F, 0.0F})
    near(lfo.next(4, 1, 0, 1), expected, .000001F, "triangle phase");
  sf2::Envelope envelope;
  sf2::EnvelopeParameters p{0, 0, 0, 1, 200, 1};
  envelope.reset(p, 1000, true);
  for (int i = 0; i < 200; ++i)
    envelope.next(p);
  near(envelope.value(), .1F, .00001F, "volume decay uses 100dB full scale time");
  envelope.release(p);
  for (int i = 0; i < 800; ++i)
    envelope.next(p);
  near(envelope.value(), .00001F, .000001F, "release starts at current attenuation");
  for (int i = 0; i < 10; ++i)
    envelope.next(p);
  require(envelope.done(), "volume release completes");
  p = {0, 0, 0, 1, .75F, 1};
  envelope.reset(p, 1000, false);
  for (int i = 0; i < 250; ++i)
    envelope.next(p);
  near(envelope.value(), .75F, .00001F, "mod decay full scale time");
  envelope.forceRelease(.01F);
  for (int i = 0; i < 12; ++i)
    envelope.next(p);
  require(envelope.done(), "forced release completes");
  // Sustain changes are evaluated at the parameter boundary, without
  // restarting progression. Both envelope roles retain their own normalization.
  p = {0, 0, 0, 0, 200, .01F};
  envelope.reset(p, 1000, true);
  require(!envelope.sustained(), "reset leaves sustain");
  near(envelope.next(p), .1F, .000001F, "volume sustain normalization");
  require(envelope.sustained(), "volume envelope reached sustain");
  p.sustain = 400;
  envelope.parametersChanged<true>(p);
  near(envelope.next(p), .01F, .000001F, "volume sustain changes without retrigger");
  require(envelope.sustained(), "parameter change preserves sustain stage");
  auto restored = envelope;
  envelope.release(p);
  require(!envelope.sustained(), "release leaves sustain");
  restored.release(p);
  for (auto i = 0u; i < 32u; ++i)
    require(envelope.next(p) == restored.next(p), "envelope copy preserves cached sustain");
  p.sustain = .75F;
  envelope.reset(p, 1000, false);
  near(envelope.next(p), .75F, 0, "linear modulation sustain");
  require(envelope.sustained(), "modulation envelope reached sustain");
  envelope.forceRelease(.01F);
  require(!envelope.sustained(), "forced release leaves sustain");
  envelope.reset(p, 1000, false);
  near(envelope.next(p), .75F, 0, "linear modulation sustain after reset");
  p.sustain = .25F;
  envelope.parametersChanged<false>(p);
  near(envelope.next(p), .25F, 0, "linear sustain changes without exponential conversion");
  envelope.forceRelease(.01F);
  for (auto i = 0u; i < 12u; ++i)
    envelope.next(p);
  require(envelope.done() && !envelope.sustained(), "done is not sustained");
  std::puts("SF2 profile numeric tests passed");
}

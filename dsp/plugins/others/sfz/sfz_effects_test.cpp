#include "allocation_guard.h"
#include "midi_transport_map.h"
#include "sfz_dsp_order.h"
#include "sfz_effect_buses.h"
#include "sfz_effect_controls.h"
#include "sfz_effect_convolver.h"
#include "sfz_effect_cost.h"
#include "sfz_effect_delay.h"
#include "sfz_effect_distortion.h"
#include "sfz_effect_dynamics.h"
#include "sfz_effect_lofi.h"
#include "sfz_effect_node.h"
#include "sfz_effect_pan.h"
#include "sfz_effect_phaser.h"
#include "sfz_effect_plan.h"
#include "sfz_effect_reverb.h"
#include "sfz_effect_runtime.h"
#include "sfz_effect_static.h"
#include "sfz_effect_strings.h"
#include "sfz_effects_fixture.h"
#include "sfz_resampling.h"
#include "sfz_voice_dsp.h"
#include <array>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace sfz = effetune::plugins::others::sfz;
static void require(bool condition, const char *message) {
  if (!condition) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
static bool near(float a, float b, float tolerance = 1.0e-6F) {
  return std::abs(a - b) <= tolerance;
}

static void routingGraphs() {
  // Figure 23 in the publisher's Rapture Pro manual, expressed as audio paths.
  constexpr std::array<const char *, 15> graphs{"x",
                                                "F2(D3(F1(D2(D1(x)))))",
                                                "F2(D3(D2(D1(F1(x)))))",
                                                "D3(D2(F2(D1(F1(x)))))",
                                                "D3(D2(D1(F1(x)))F2(D1(F1(x))))",
                                                "F2(F1(D2(D1(x)))D3(D2(D1(x))))",
                                                "F1(D3(D2(D1(x))))F2(D3(D2(D1(x))))",
                                                "F2(F1(D3(D2(D1(x)))))",
                                                "D3(F1(D1(x))F2(D2(x)))",
                                                "F1(D2(D1(x)))F2(D3(D1(x)))",
                                                "D3(F1(D2(D1(x)))F2(D2(D1(x))))",
                                                "F2(D3(D1(F1(x))D2(F1(x))))",
                                                "D3(F2(D1(F1(x))D2(F1(x))))",
                                                "F2(D3(F1(D1(x)D2(x))))",
                                                "F2(F1(D3(D1(x)D2(x))))"};
  constexpr std::array<const char *, 5> names{"D1", "D2", "D3", "F1", "F2"};
  for (auto order = 0u; order < graphs.size(); ++order) {
    std::array<unsigned, 5> calls{};
    const auto output =
        sfz::routeVoiceDsp(order, std::string("x"), [&](unsigned stage, const std::string &input) {
          ++calls[stage];
          return names[stage] + std::string("(") + input + ")";
        });
    require(output == graphs[order], "published per-voice DSP graph");
    for (const auto count : calls)
      require(count == (order ? 1u : 0u), "a stateful stage advances once per sample");
  }
  const auto process = [](unsigned stage, float input) {
    if (stage == 0) {
      float right = input;
      sfz::EffectDynamics::limit(input, right);
    }
    return stage == 3 ? input * .25F : input;
  };
  require(near(sfz::routeVoiceDsp(1, 2.0F, process), .25F), "limiting before attenuation");
  require(near(sfz::routeVoiceDsp(2, 2.0F, process), .5F),
          "attenuation before limiting changes audible result");
}
static void planValidation() {
  sfz::EffectPlan plan;
  const auto curve = [](unsigned) { return false; };
  require(!plan.assign(kSfzEffectsFixture, 1, 3, 2, curve),
          "compiler output1 is rejected by actual stereo host");
  require(plan.assign(kSfzEffectsFixture, 1, 3, 4, curve),
          "current JS effects fixture validates against generated native schema");
  require(plan.nodeCount() == 2 && plan.region(0).output == 1 && plan.region(0).sends[0] == .5F,
          "native region output and send preserve packed intent");
  require(plan.parameter(plan.node(0),
                         static_cast<unsigned>(sfz::fxschema::Parameter::comp_ratio)) == 100,
          "native type-local control identity matches compiler");
  require(plan.returns().directToMain == .5F && plan.returns().toMix[0] == .25F,
          "native global routing gains match compiler");
  require(!plan.assign(kSfzEffectsFixture, 1, 2, 4, curve),
          "missing convolution sample is rejected before prepare");
  require(plan.assign(kSfzEffectsFixture, 1, 4, 4, curve, false),
          "resident IR directory resolves a stereo PCM slice");
  require(plan.impulseCount() == 1 && plan.impulse(0).sampleOffsetOrId == 2 &&
              plan.impulse(0).channels == 2 && plan.impulse(0).rate == 48000,
          "typed IR geometry retains source rate and layout");
  require(!plan.assign(kSfzEffectsFixture, 1, 3, 4, curve, false),
          "resident IR slice cannot exceed the captured PCM pool");
  auto broken = kSfzEffectsFixture;
  broken[broken[20] + 1] = UINT32_MAX;
  require(!plan.assign(broken, 1, UINT32_MAX, 4, curve, false),
          "resident IR frame multiplication cannot wrap past pool validation");
  broken = kSfzEffectsFixture;
  broken[19] = 1;
  require(!plan.assign(broken, 1, 3, 4, curve), "unknown FX wire flags rejected");
  broken = kSfzEffectsFixture;
  broken[broken[7] + 2] = std::bit_cast<std::uint32_t>(101.0F);
  require(!plan.assign(broken, 1, 3, 4, curve), "out-of-contract native effect parameter rejected");
  broken = kSfzEffectsFixture;
  broken[broken[8] + 1] = 156;
  require(!plan.assign(broken, 1, 3, 4, curve),
          "out-of-contract global controller source rejected");
  auto invalidStatic = kSfzEffectsDispatchFixture;
  const auto staticNode = invalidStatic[6] + 11 * sfz::fxschema::kNodeWords;
  invalidStatic[invalidStatic[7] + invalidStatic[staticNode + 2] +
                static_cast<unsigned>(sfz::fxschema::Parameter::static_random_maxtime)] = 0;
  require(!plan.assign(invalidStatic, 0, 1, 2, curve),
          "native static random time order matches compiler admission");
}
static void sharedControls() {
  sfz::EffectPlan plan;
  require(plan.assign(kSfzEffectsFixture, 1, 3, 4, [](unsigned) { return false; }),
          "global controls fixture");
  sfz::EffectControls controls;
  require(controls.prepare(plan, 0), "global effect controls prepare route ramps");
  sfz::EffectDynamics effect;
  effect.configure(48000, 0, 0);
  std::array<float, 156> latest{};
  // This is the resolver's gain oracle; actual interleaved-channel MIDI ingress
  // is tested at the sampler integration boundary when FX v4 is enabled.
  for (const auto value : {127u, 0u, 64u}) {
    latest[7] = value / 127.0F;
    effetune::allocation_guard::Scope guard;
    const auto parameters = controls.resolve({latest, 0}, {}, 48000);
    float left = .01F, right = .005F;
    effect.compress(left, right, parameters[5], parameters[2], parameters[1], parameters[4] != 0);
    require(near(left, .01F * std::pow(10.0F, (12 * value / 127.0F) / 20)),
            "shared source resolves to exact physical dB gain in rendered audio");
    require(near(right / left, .5F), "global gain modulation preserves stereo ratio");
  }
}

static void buses() {
  sfz::EffectBuses buses;
  const std::array<sfz::EffectRegionRouting, 2> regions{{{0, {.5F, 0, 0, 0}}, {1, {0, 0, 0, 0}}}};
  const std::array<std::uint32_t, 3> nodes{0, 9, 9};
  sfz::EffectReturnRouting returns{.5F, {.25F, 0, 0, 0}, {.5F, 0, 0, 0}};
  require(!buses.prepare(2, 16, regions, nodes, returns),
          "stereo host rejects a second output pair");
  require(buses.prepare(4, 16, regions, nodes, returns),
          "four-channel host accepts second output pair");
  unsigned advances = 0;
  const auto process = [&](std::size_t node, float *audio, unsigned frames) {
    ++advances;
    for (auto i = 0u; i < 2 * frames; ++i) {
      if (node == 0)
        audio[i] *= 2;
      else if (node == 1) {
        float right = audio[i];
        sfz::EffectDynamics::limit(audio[i], right);
      } else
        audio[i] *= .5F;
    }
  };
  std::array<float, 16> audio{};
  {
    effetune::allocation_guard::Scope guard;
    require(buses.begin(4), "begin abandoned trial");
    buses.add(regions[0], 0, 100, 100);
    require(advances == 0, "sample trial does not advance effect state");
    require(buses.begin(4), "retry clears scratch");
    buses.add(regions[0], 0, 4, 2);
    buses.add(regions[1], 0, .25F, -.25F);
    require(!buses.finish(audio.data(), 2, process), "reject changed host channel capacity");
    require(advances == 0, "failed commit does not advance effect state");
    require(buses.finish(audio.data(), 4, process), "commit successful sample trial");
  }
  require(advances == 3, "each ordered bus effect advances once");
  require(near(audio[0], 4.375F) && near(audio[4], 2.375F),
          "dry, main return and mix return combine after bus effects");
  require(near(audio[8], .25F) && near(audio[12], -.25F),
          "second output remains physically separate");
  require(audio[1] == 0 && audio[5] == 0, "no abandoned-trial audio leaks");
  require(!sfz::EffectBuses::outputAvailable(8, 16), "aux8 exceeds the sixteen-channel host");
}

static void dynamics() {
  sfz::EffectDynamics effect;
  effect.configure(48000, 0, 0);
  float left = 1, right = .1F;
  effect.compress(left, right, -20, 2, 0, true);
  require(near(left, std::sqrt(.1F)) && near(right / left, .1F),
          "linked compression preserves stereo ratio");
  effect.reset();
  left = 1;
  right = .1F;
  effect.compress(left, right, -20, 2, 0, false);
  require(near(right, .1F), "unlinked quiet channel stays below threshold");
  require(near(sfz::EffectDynamics::compressorGain(1, -20, 100), std::pow(10.0F, -.99F)),
          "100:1 ratio uses full public range");
  require(sfz::EffectDynamics::compressorGain(1, -20, 0) == 1, "zero ratio bypass profile");
  for (const auto rate : {24000, 48000, 96000}) {
    effect.reset();
    effect.configure(rate, .01F, .02F);
    for (int sample = 0; sample < rate / 100; ++sample) {
      left = right = 1;
      effect.gate(left, right, -20, 1, true);
    }
    require(near(left, static_cast<float>(1 - std::exp(-1)), 2.0e-5F),
            "gate attack is rate-independent seconds");
    for (int sample = 0; sample < rate / 50; ++sample) {
      left = right = .01F;
      effect.gate(left, right, -20, 1, true);
    }
    require(near(left, static_cast<float>(.01 * (1 - std::exp(-1)) * std::exp(-1)), 2.0e-6F),
            "gate release follows physical seconds");
  }
}
static void voiceDsp() {
  sfz::VoiceDsp first, second;
  const auto filter = [](unsigned index, float &left, float &right) {
    if (index == 0) {
      left *= .25F;
      right *= .25F;
    }
  };
  const auto a = first.process(1, {.2F, -.2F}, 48000, 50, 0, 0, filter);
  const auto b = second.process(2, {.2F, -.2F}, 48000, 50, 0, 0, filter);
  require(b.left > a.left && b.right < a.right,
          "fixed public drive slot responds to filter ordering");
  const auto bypass = first.process(0, {.2F, -.2F}, 48000, 100, 100, 100, filter);
  require(bypass.left == .2F && bypass.right == -.2F,
          "dsp_order0 bypasses the complete voice DSP/filter graph");
  auto checkpoint = first;
  const auto expected = first.process(7, {.7F, -.3F}, 48000, 20, 20, 80, filter);
  const auto replay = checkpoint.process(7, {.7F, -.3F}, 48000, 20, 20, 80, filter);
  require(expected.left == replay.left && expected.right == replay.right,
          "voice DSP trial and checkpoint state is pointer-free and reproducible");
}

static void coloration() {
  sfz::EffectPan pan;
  pan.reset(0);
  for (int frame = 0; frame < 8; ++frame) {
    float left = 1, right = 1;
    pan.process(left, right, 8, 1, 0, 1, 1, 0, 1);
    if (frame == 2)
      require(near(left, 0) && near(right, 1), "pan sweeps fully right at quarter cycle");
    if (frame == 6)
      require(near(left, 1) && near(right, 0), "pan sweeps fully left at three-quarter cycle");
  }
  sfz::EffectLofi lofi;
  float left = .75F, right = -.25F;
  lofi.process(left, right, 1, 0);
  require(left == 1 && right == 0, "one-bit signed quantization profile");
  lofi.reset();
  left = .25F;
  right = -.5F;
  lofi.process(left, right, 0, 1);
  left = .75F;
  right = -.75F;
  lofi.process(left, right, 0, 1);
  require(left == .25F && right == -.5F, "decimation holds each stereo channel independently");
  left = .75F;
  right = -.75F;
  lofi.process(left, right, 1, 0);
  require(left == 1 && right == -1, "disabling decimation samples current input immediately");
  sfz::EffectDistortion distortion;
  left = .2F;
  right = -.2F;
  distortion.process(left, right, 48000, .5F, 2, 1, 0, 1);
  require(left > .9F && right < -.49F && right > -.51F,
          "cascaded asymmetric saturation preserves polarity and adds even "
          "harmonics");
}
static void convolution() {
  constexpr unsigned frames = 2049;
  std::array<float, frames * 2> impulse{};
  impulse[0] = .5F;
  impulse[frames + 2] = -.25F;
  impulse[128] = .125F;
  impulse[frames + 2048] = .75F;
  sfz::EffectConvolver effect;
  require(effect.prepare(impulse, 2, frames), "prepare stereo impulse using existing convolver");
  require(effect.memoryBytes() > 0, "convolution storage allocated during control preparation");
  for (auto replay = 0; replay < 2; ++replay) {
    effetune::allocation_guard::Scope guard;
    effect.reset();
    for (auto frame = 0u; frame < frames + 256; ++frame) {
      float left = frame == 0 ? 1.0F : 0.0F, right = left;
      effect.process(left, right, 0, 1, 1);
      require(near(left, frame < frames ? impulse[frame] : 0, 2.0e-6F),
              "zero-latency convolution reproduces left IR across FFT boundaries");
      require(near(right, frame < frames ? impulse[frames + frame] : 0, 2.0e-6F),
              "independent stereo IR preserves delayed right tail and resets "
              "deterministically");
    }
  }
}
static void delay() {
  sfz::EffectDelay delay;
  require(delay.prepare(1000, 1), "delay control storage preparation");
  sfz::EffectDelayParameters p;
  p.time = {.01F, .01F, .01F};
  p.dry = 0;
  p.feedback = .5F;
  require(delay.accepts(p, 120), "delay accepts bounded time");
  auto over = p;
  over.sync[0] = 4;
  require(!delay.accepts(over, 60), "beat delay exceeding prepared storage is rejected explicitly");
  for (const auto mode : {0u, 1u, 2u}) {
    delay.reset();
    p.mode = mode;
    effetune::allocation_guard::Scope guard;
    for (auto frame = 0u; frame < 40; ++frame) {
      float left = frame == 0 ? 1.0F : 0.0F, right = 0;
      delay.process(left, right, p, 120);
      if (frame == 10) {
        require(near(left, mode == 2 ? .5F : 1.0F) && near(right, 0),
                "independent cross input and mono ping first echo timing");
      }
      if (frame == 20 && mode == 2)
        require(near(left, 0) && near(right, .25F), "ping feedback alternates stereo sides");
      if (frame == 20 && mode == 1)
        require(near(left, 0) && near(right, .5F),
                "cross delay routes feedback to the opposite input");
    }
  }
  delay.reset();
  p.mode = 0;
  p.feedback = 0;
  p.sync[0] = .04F;
  {
    effetune::allocation_guard::Scope guard;
    for (auto frame = 0u; frame < 45; ++frame) {
      float left = frame == 0 ? 1.0F : 0.0F, right = 0;
      delay.process(left, right, p, 60);
      if (frame == 40)
        require(near(left, 1), "beat delay uses actual host tempo");
      else
        require(near(left, 0), "beat delay has no early echo");
    }
  }
}
static void reverbAndPhaser() {
  sfz::EffectReverb reverb;
  sfz::EffectChorus chorus;
  sfz::EffectPhaser phaser;
  require(reverb.prepare({48000, 2, 128}) && chorus.prepare({48000, 2, 128}),
          "reuse authored project FDN and chorus kernels");
  sfz::EffectReverbParameters p;
  p.dry = 0;
  p.wet = 1;
  p.predelay = .1F;
  p.tone = 1;
  float reverbEnergy = 0, chorusEnergy = 0, phaserDifference = 0;
  std::array<float, 32> first{}, repeated{};
  for (auto replay = 0; replay < 2; ++replay) {
    effetune::allocation_guard::Scope guard;
    reverb.reset();
    chorus.reset();
    phaser.reset();
    for (auto frame = 0u; frame < 24000; ++frame) {
      float left = frame == 0 ? 1.0F : 0.0F, right = left;
      reverb.process(left, right, p, {});
      if (frame < 4800)
        require(left == 0 && right == 0, "physical reverb predelay retains silence");
      if (frame >= 6000 && frame < 6032)
        (replay ? repeated : first)[frame - 6000] = left;
      reverbEnergy += left * left + right * right;
      left = right = frame == 0 ? 1.0F : 0.0F;
      chorus.process(left, right, {});
      chorusEnergy += left * left + right * right;
      const float input = std::sin(static_cast<float>(frame) * .1F);
      left = right = input;
      phaser.process(left, right, 48000, 1, 0, 1, 6, 1, .5F, .5F);
      require(std::isfinite(left) && std::isfinite(right), "finite swept phaser output");
      phaserDifference += std::abs(left - input);
    }
  }
  require(first == repeated, "FDN reset reproduces effect state");
  require(reverbEnergy > .001F && chorusEnergy > .001F,
          "reverb and chorus produce audible delayed energy");
  require(phaserDifference > 100, "swept allpass mix produces audible phase cancellation");
}
static void noiseAndStrings() {
  sfz::NoiseLayer mono, stereo;
  mono.reset(1234);
  stereo.reset(1234);
  float a = 0, b = 0, c = 0, d = 0;
  mono.process(a, b, 48000, 1, 1, 3, false, 0);
  stereo.process(c, d, 48000, 1, 1, 3, true, 0);
  require(a == b && a == c && c != d, "independent seeded stereo noise preserves mono option");
  const auto held = a;
  for (auto index = 0; index < 3; ++index) {
    a = b = 0;
    mono.process(a, b, 48000, 1, 1, 3, false, 0);
    require(a == held, "noise step holds exactly four source samples");
  }
  auto checkpoint = mono;
  a = b = c = d = 0;
  mono.process(a, b, 48000, .1F, 1, 3, false, 0);
  checkpoint.process(c, d, 48000, .1F, 1, 3, false, 0);
  require(a == c && b == d && a != held, "noise trial state resumes without reseeding or replay");
  sfz::EffectStatic effect;
  require(effect.prepare(1000, 1234), "prepare static effect comb storage");
  sfz::EffectStaticParameters p;
  p.cyclicLevel = .25F;
  p.cyclicTime = .01F;
  require(sfz::EffectStatic::generates(p), "enabled static source advertises generator activity");
  {
    effetune::allocation_guard::Scope guard;
    for (auto frame = 0; frame < 25; ++frame) {
      a = b = 0;
      effect.process(a, b, p);
      if (frame == 10 || frame == 20)
        require(near(a, .25F) && a == b, "cyclic static uses physical seconds");
      else
        require(a == 0 && b == 0, "zero baseline static stays silent between ticks");
    }
  }
  sfz::EffectStrings strings;
  require(strings.prepare(48000, 12), "bounded sympathetic strings prepare on control thread");
  float energy = 0;
  {
    effetune::allocation_guard::Scope guard;
    for (auto frame = 0; frame < 12000; ++frame) {
      a = b = frame == 0 ? 1.0F : 0.0F;
      strings.process(a, b, 1);
      require(std::isfinite(a) && std::isfinite(b), "finite damped string resonance");
      if (frame > 0)
        energy += a * a + b * b;
    }
    strings.reset();
    a = b = 0;
    strings.process(a, b, 1);
    require(a == 0 && b == 0, "string reset removes persistent resonance");
  }
  require(energy > .001F, "bus excitation produces audible sympathetic resonance tail");
  require(!strings.prepare(48000, 108),
          "string count exceeding explicit profile budget is rejected");
}
static void typedDispatch() {
  sfz::EffectPlan plan;
  require(plan.assign(kSfzEffectsDispatchFixture, 0, 1, 2, [](unsigned) { return false; }),
          "all typed FX dispatch comes from the JS compiler");
  const std::array<float, 2> impulse{.5F, -.25F};
  std::array<float, 156> sources{};
  sources[142] = 120;
  for (auto index = 0u; index < plan.nodeCount(); ++index) {
    const auto type = static_cast<sfz::fxschema::Type>(plan.node(index)[0]);
    sfz::EffectNode node;
    require(node.prepare(plan, index, {48000, 2, 128}, 1234, 1, impulse, 2, 1, 60),
            "typed node control preparation");
    std::array<float, 64> first{}, second{};
    for (auto replay = 0; replay < 2; ++replay) {
      effetune::allocation_guard::Scope guard;
      node.reset();
      for (auto frame = 0u; frame < 4096; ++frame) {
        float left = .2F * std::sin(static_cast<float>(frame) * .1308996938995747F), right = left;
        using T = sfz::fxschema::Type;
        if (type == T::apan)
          left = right = 1;
        else if (type == T::comp) {
          left = .2F;
          right = .1F;
        } else if (type == T::gate)
          left = right = .01F;
        else if (type == T::limiter) {
          left = 2;
          right = .5F;
        } else if (type == T::lofi) {
          left = .75F;
          right = -.75F;
        } else if (type == T::staticNoise)
          left = right = 0;
        else if (type == T::delay || type == T::tdfir || type == T::strings || type == T::fverb)
          left = right = frame == 0 ? .2F : 0;
        node.process(left, right, {sources, frame}, {}, {});
        require(std::isfinite(left) && std::isfinite(right), "typed FX produces finite audio");
        if (frame < 64)
          (replay ? second : first)[frame] = left;
        if (type == T::apan)
          require(near(left, 0) && near(right, 1), "typed pan units");
        if (type == T::comp)
          require(near(left, std::sqrt(.02F)), "typed compressor ratio and threshold units");
        if (type == T::gate)
          require(left == 0 && right == 0, "typed gate depth units");
        if (type == T::limiter)
          require(left == 1 && right == .25F, "typed linked peak limiter");
        if (type == T::lofi)
          require(left == 1 && right == -1, "typed bit reduction units");
        if (type == T::tdfir && frame == 0)
          require(near(left, .1F) && near(right, -.05F), "typed stereo convolution gain");
        if (type == T::delay && frame == 96)
          require(near(left, .2F), "typed delay seconds");
      }
    }
    require(first == second, "typed effect resets reproduce current parameter behavior");
    require(node.generates() == (type == sfz::fxschema::Type::staticNoise),
            "only enabled static node advertises generation");
    if (type == sfz::fxschema::Type::delay) {
      require(node.acceptsTempo(0) && node.acceptsTempo(59),
              "seconds-only delay does not require unavailable or slower host "
              "tempo");
      require(!node.prepare(plan, index, {48000, 2, 128}, 1234, .001),
              "insufficient delay storage is rejected before processing, not "
              "silently dropped");
    }
  }
  require(plan.assign(kSfzEffectsChorusFixture, 1, 0, 2, [](unsigned) { return false; }),
          "v1 implicit chorus plan");
  sfz::EffectNode chorus;
  require(chorus.prepare(plan, 0, {48000, 2, 128}, 1234, 1), "typed implicit chorus preparation");
  double energy = 0;
  {
    effetune::allocation_guard::Scope guard;
    for (auto frame = 0u; frame < 4096; ++frame) {
      float left = frame == 0 ? 1.0F : 0.0F, right = left;
      chorus.process(left, right, {sources, frame}, {}, {});
      energy += left * left + right * right;
    }
  }
  require(energy > .001, "typed implicit chorus produces wet output");
}
static void effectRuntime() {
  sfz::EffectPlan plan;
  require(plan.assign(kSfzEffectsRuntimeFixture, 2, 0, 4, [](unsigned) { return false; }),
          "runtime compiler fixture");
  sfz::EffectRuntime runtime;
  const auto noImpulse = [](sfz::EffectImpulseReference) { return sfz::EffectImpulse{}; };
  {
    effetune::allocation_guard::Scope guard;
    require(!runtime.prepare(plan, {48000, 16, 64}, 4, noImpulse, 60, {1, 8}),
            "tiny FX budget rejects before allocation");
    require(!runtime.prepare(plan, {48000, 16, 64}, 2, noImpulse, 60, {1 << 20, 8}),
            "actual host capacity is independent of prepare maximum");
  }
  require(runtime.prepare(plan, {48000, 16, 64}, 4, noImpulse, 60, {1 << 20, 8}),
          "runtime CONTROL preparation");
  require(runtime.storageBytes() <= 1 << 20 && !runtime.hasGenerator(),
          "runtime storage and generator facts");
  std::array<float, 128> cc{};
  std::array<float, 4> sends{.5F, 0, 0, 0}, dry{};
  std::array<float, 256> audio{};
  unsigned sourceCalls = 0;
  const auto transport = [&](unsigned frame, std::span<float> extended) {
    ++sourceCalls;
    extended[142 - 128] = frame < 24 ? 120.0F : 60.0F;
  };
  {
    effetune::allocation_guard::Scope guard;
    require(runtime.beginQuantum(64, cc, 1000), "start abandoned trial");
    require(runtime.voiceMix(0, 0, sends, 100, 100) && runtime.recordCC(0, 7, 1),
            "trial scratch only");
    require(runtime.beginQuantum(64, cc, 1000),
            "restart trial without advancing DSP or controllers");
    require(runtime.recordCC(2, 7, 1) && runtime.recordCC(2, 7, 0) && runtime.recordCC(3, 7, .5F),
            "same-frame interleaved channels retain accepted CC order");
    for (auto frame = 0u; frame < 64; ++frame) {
      require(runtime.voiceMix(frame, 0, sends, .01F, .005F), "main and send accumulation");
      require(runtime.voiceMix(frame, 1, dry, .25F, -.25F), "physical auxiliary output");
    }
    require(runtime.commit(audio.data(), {}, {}, transport), "commit successful sample trial");
    require(!runtime.commit(audio.data(), {}, {}, transport),
            "a committed quantum cannot advance twice");
  }
  require(sourceCalls == 128, "stateless transport preflight and commit each "
                              "query every actual sample once");
  for (auto frame = 0u; frame < 64; ++frame) {
    const float gainDb = (frame < 3 ? 0.0F : 6.0F) + (frame < 24 ? 12.0F : 6.0F);
    const float wet = frame >= 48 ? .005F : 0;
    require(near(audio[frame], .01F * std::pow(10.0F, gainDb / 20) + wet),
            "audible sample-offset CC and real-tempo gain");
    require(near(audio[64 + frame], audio[frame] * .5F), "runtime stereo image");
    require(audio[128 + frame] == .25F && audio[192 + frame] == -.25F,
            "runtime auxiliary pair never folds to main");
  }
  require(plan.assign(kSfzEffectsSyncFixture, 1, 0, 2, [](unsigned) { return false; }),
          "sync runtime compiler fixture");
  require(runtime.prepare(plan, {48000, 2, 64}, 2, noImpulse, 60, {1 << 20, 2}),
          "sync delay capacity follows admitted tempo");
  audio.fill(0);
  {
    effetune::allocation_guard::Scope guard;
    require(runtime.beginQuantum(64, cc), "sync trial");
    require(runtime.voiceMix(0, 0, dry, 1, 1), "sync impulse");
    require(!runtime.commit(audio.data(), {}, {},
                            [](unsigned, std::span<float> values) { values[14] = 50; }),
            "slower unprepared tempo rejects before any effect advances");
    require(runtime.beginQuantum(64, cc), "retry after tempo rejection");
    require(runtime.voiceMix(0, 0, dry, 1, 1), "fresh sync impulse");
    require(runtime.commit(audio.data(), {}, {},
                           [](unsigned, std::span<float> values) { values[14] = 60; }),
            "admitted tempo commits");
    require(near(audio[48], 1, 1.0e-5F) && audio[0] == 0, "rejected trial left no delay history");
    require(runtime.beginQuantum(64, cc), "journal overflow trial");
    for (auto event = 0u; event < 512; ++event)
      require(runtime.recordCC(0, 7, static_cast<float>(event % 2)),
              "same-frame same-controller FX updates coalesce to their final "
              "accepted value");
    require(runtime.recordCC(0, 7, 0) && runtime.recordCC(1, 7, 1) && !runtime.recordCC(2, 7, 0),
            "bounded controller journal rejects overflow");
    require(!runtime.commit(audio.data(), {}, {}, transport), "failed journal cannot mutate DSP");
  }
}

static void speedSynchronizedDelay() {
  sfz::EffectPlan plan;
  require(plan.assign(kSfzEffectsSyncFixture, 1, 0, 2, [](unsigned) { return false; }),
          "speed delay fixture");
  sfz::MidiTransportMap map;
  const et_midi_transport_point point{0, 0, 0, 120, 4, 4};
  require(map.assign(&point, 1) == ET_OK, "real transport point map");
  sfz::EffectRuntime runtime;
  // The application admits 0.25x through 4x. Prepare once for its slowest
  // physical tempo, then retime the same state at legal midstream speeds.
  require(runtime.prepare(plan, {48000, 2, 128}, 2,
                          [](sfz::EffectImpulseReference) { return sfz::EffectImpulse{}; },
                          120 * .25F, {1 << 20, 8}),
          "all legal speeds share admitted delay capacity");
  std::array<float, 128> cc{};
  std::array<float, 4> sends{};
  std::array<float, 256> audio{};
  std::uint64_t origin = 0;
  double seconds = 0;
  for (const double speed : {2.0, .5, .25, 4.0}) {
    const sfz::MidiTransportMapping mapping{origin, seconds, speed, 10, 3};
    const auto expected = static_cast<unsigned>(std::lround(.001 * 60 * 48000 / (120 * speed)));
    audio.fill(0);
    {
      effetune::allocation_guard::Scope guard;
      require(runtime.beginQuantum(128, cc, origin), "retimed quantum starts without reprepare");
      require(runtime.voiceMix(0, 0, sends, 1, 1), "retimed input impulse");
      require(runtime.commit(audio.data(), {}, {},
                             [&](unsigned frame, std::span<float> values) {
                               const auto transport = map.at(mapping, origin + frame, 48000);
                               const auto next = map.at(mapping, origin + frame + 1, 48000);
                               require(std::abs((next.ppqPosition - transport.ppqPosition) * 60 *
                                                    48000 -
                                                transport.tempoBpm) < 1e-8,
                                       "beat delay tempo equals actual PPQ time derivative");
                               values[142 - 128] = static_cast<float>(transport.tempoBpm);
                               values[148 - 128] = static_cast<float>(transport.ppqPosition);
                             }),
              "legal speed changes stay inside prepared capacity");
    }
    for (auto frame = 0u; frame < 128; ++frame)
      require(near(audio[frame], frame == expected ? 1.0F : 0.0F, 1e-5F),
              "beat delay follows actual physical playback tempo");
    origin += 128;
    seconds += 128 * speed / 48000;
  }
}

static void impulseRateConversion() {
  require(sfz::effectImpulseFrames(441, 44100, 48000) == 480,
          "impulse physical duration follows host rate");
  require(sfz::effectImpulseFrames(UINT32_MAX, 1, 768000) == 0,
          "impulse geometry overflow rejected before allocation");
  std::array<float, 882> source{};
  std::array<float, 960> destination{};
  source[220 * 2] = 1;
  source[220 * 2 + 1] = -2;
  {
    effetune::allocation_guard::Scope guard;
    require(sfz::prepareEffectImpulse(source, 2, 44100, 48000, destination),
            "caller-owned stereo IR conversion");
  }
  double sumLeft = 0, sumRight = 0;
  for (auto frame = 0u; frame < 480; ++frame) {
    sumLeft += destination[frame];
    sumRight += destination[480 + frame];
  }
  require(std::abs(sumLeft - 1) < 2e-5 && std::abs(sumRight + 2) < 4e-5,
          "resampling preserves convolution DC gain and planar channels");
  source.fill(1);
  require(sfz::prepareEffectImpulse(source, 2, 44100, 48000, destination),
          "constant IR conversion");
  require(near(destination[200], 44100.0F / 48000, 1e-6F),
          "constant interior uses explicit IR area normalization");
  std::array<float, 882> identity{};
  source[0] = .125F;
  source[1] = -.75F;
  require(sfz::prepareEffectImpulse(source, 2, 44100, 44100, identity),
          "same-rate IR deinterleaves exactly");
  require(identity[0] == .125F && identity[441] == -.75F,
          "same-rate IR does not filter or change gain");
}

static void preparationGeometry() {
  sfz::MidiTransportMap map;
  std::array<et_midi_transport_point, 2> points{{{0, 0, 0, 180, 4, 4}, {1, 3, 0, 45, 4, 4}}};
  require(map.minimumBpm() == 0 && map.assign(points.data(), 2) == ET_OK && map.minimumBpm() == 45,
          "map preparation minimum spans every source tempo point");
  points[1].bpm = -1;
  require(map.assign(points.data(), 2) == ET_ERR_ARGS && map.minimumBpm() == 45,
          "failed map assignment preserves its preparation envelope");
  require(map.assign(nullptr, 0) == ET_OK && map.minimumBpm() == 0,
          "no-map preparation context remains explicitly unknown");
  require(sfz::effectPreparationTempo(0) == 120 && sfz::effectPreparationTempo(240) == 120 &&
              sfz::effectPreparationTempo(15) == 15,
          "FX standalone tempo is unioned once with the known physical envelope");

  sfz::EffectPlan allTypes;
  require(allTypes.assign(kSfzEffectsDispatchFixture, 0, 1, 2, [](unsigned) { return false; }),
          "all-type sizing plan");
  for (const auto rate : {48000.0F, 96000.0F}) {
    std::array<float, 4> impulse{1, 0, 1, 0};
    const auto resolve = [&](sfz::EffectImpulseReference reference) {
      const auto frames = sfz::effectImpulseFrames(reference.frames, reference.rate, rate);
      return sfz::EffectImpulse{{impulse.data(), static_cast<std::size_t>(frames) * 2}, 2, frames};
    };
    sfz::EffectRuntime::Geometry geometry;
    const effetune::PrepareInfo info{rate, 2, 128, 0};
    require(sfz::EffectRuntime::storageRequirements(allTypes, info, 2, resolve, 0, {UINT64_MAX, 8},
                                                    geometry),
            "every FX family shares its allocation dimensions with sizing");
    sfz::EffectRuntime actual;
    require(actual.prepare(allTypes, info, 2, resolve, 0, {geometry.preparationBytes, 8}) &&
                actual.storageBytes() == geometry.persistentBytes,
            "all typed FX prepare at their native shared peak without a "
            "residual allowance");
  }

  auto words = kSfzEffectsFixture;
  words[words.size() - 3] = 8193;
  words[words.size() - 1] = 44100;
  sfz::EffectPlan plan;
  require(plan.assign(words, 1, 3, 4, [](unsigned) { return false; }),
          "long convolution cost plan");
  for (const auto rate : {48000.0F, 96000.0F}) {
    const effetune::PrepareInfo info{rate, 16, 128, 0};
    const auto frames = sfz::effectImpulseFrames(8193, 44100, rate);
    std::vector<float> impulse(static_cast<std::size_t>(frames) * 2, 0);
    impulse[0] = impulse[frames] = 1;
    const auto resolve = [&](sfz::EffectImpulseReference) {
      return sfz::EffectImpulse{impulse, 2, frames};
    };
    sfz::EffectRuntime::Geometry geometry;
    require(sfz::EffectRuntime::storageRequirements(plan, info, 4, resolve, 0, {UINT64_MAX, 8},
                                                    geometry),
            "CONTROL uses the runtime allocator geometry before large storage");
    sfz::EffectRuntime actual;
    require(actual.prepare(plan, info, 4, resolve, 0, {geometry.preparationBytes, 8}) &&
                actual.storageBytes() == geometry.persistentBytes,
            "exact runtime peak admits its persistent storage");
    sfz::EffectRuntime rejected;
    require(!rejected.prepare(plan, info, 4, resolve, 0, {geometry.preparationBytes - 1, 8}),
            "one missing peak byte rejects admission");
    std::uint64_t resident = 0, streamed = 0;
    require(sfz::effectPreparationBytes(plan, info, 4, false, 8,
                                        static_cast<std::uint32_t>(words.size()), resident) &&
                sfz::effectPreparationBytes(plan, info, 4, true, 8,
                                            static_cast<std::uint32_t>(words.size()), streamed),
            "bank FX peak uses the same native runtime geometry");
    const auto persistent = sizeof(sfz::EffectPlan) + words.size() * sizeof(std::uint32_t) +
                            sizeof(sfz::EffectImpulse) +
                            static_cast<std::uint64_t>(frames) * 2 * sizeof(float) +
                            28ull * info.maxFrames * sizeof(float);
    require(resident == persistent + geometry.preparationBytes &&
                streamed == persistent + std::max<std::uint64_t>(8193ull * 2 * sizeof(float),
                                                                 geometry.preparationBytes),
            "persistent IR facts and streamed scratch are combined as a peak, "
            "not a sum");
  }

  require(plan.assign(kSfzEffectsSyncFixture, 1, 0, 2, [](unsigned) { return false; }),
          "standalone synchronized-delay plan");
  sfz::EffectRuntime runtime;
  require(runtime.prepare(plan, {48000, 2, 64}, 2,
                          [](sfz::EffectImpulseReference) { return sfz::EffectImpulse{}; }, 0,
                          {1 << 20, 8}),
          "font before MIDI prepares synchronized FX at standalone 120 BPM");
  std::array<float, 128> cc{};
  std::array<float, 4> sends{};
  std::array<float, 128> audio{};
  unsigned emissions = 0;
  {
    effetune::allocation_guard::Scope guard;
    require(runtime.beginQuantum(64, cc) && runtime.voiceMix(0, 0, sends, 1, 1),
            "standalone impulse begins");
    require(runtime.commitOutput(
                2, {}, {},
                [](unsigned, std::span<float> values) {
                  require(values[14] == 0, "standalone fallback never rewrites raw source142");
                },
                [&](unsigned frame, unsigned channel, float value) {
                  require(emissions++ == frame * 2 + channel,
                          "sink emits every channel exactly once in frame-major order");
                  audio[channel * 64 + frame] += value;
                }),
            "standalone output commits through caller-owned gain/output sink");
  }
  require(emissions == 128 && near(audio[24], 1, 1e-5F),
          "standalone synchronized delay audibly uses 120 BPM");
  sfz::EffectNode rounded;
  const auto maximum = sfz::EffectNode::delaySeconds(plan, 0, 60);
  require(rounded.prepare(plan, 0, {48000, 2, 64}, 1, maximum, {}, 0, 0, 60) &&
              rounded.acceptsTempo(59.99999F) && !rounded.acceptsTempo(50),
          "tempo admission follows actual rounded storage rather than a "
          "numeric floor guard");
}

static std::vector<std::uint32_t> activityFixture(sfz::fxschema::Type type, unsigned copies = 1) {
  sfz::EffectPlan authored;
  require(authored.assign(kSfzEffectsDispatchFixture, 0, 1, 2, [](unsigned) { return false; }),
          "authored activity fixture");
  unsigned selected = 0;
  while (authored.node(selected)[0] != static_cast<unsigned>(type))
    ++selected;
  const auto node = authored.node(selected);
  std::vector<std::uint32_t> words(kSfzEffectsDispatchFixture.begin(),
                                   kSfzEffectsDispatchFixture.begin() +
                                       sfz::fxschema::kHeaderWords);
  words[1] = 0;
  words[2] = copies;
  words[3] = 0;
  words[4] = copies * node[3];
  words[5] = words[6] = sfz::fxschema::kHeaderWords;
  words[7] = words[6] + copies * sfz::fxschema::kNodeWords;
  words[8] = words[20] = words[7] + words[4];
  words[9] = 1;
  words[21] = 0;
  for (auto copy = 0u; copy < copies; ++copy) {
    const std::array<std::uint32_t, 8> row{node[0], 0, copy * node[3], node[3],
                                           0,       0, UINT32_MAX,     0};
    words.insert(words.end(), row.begin(), row.end());
  }
  for (auto copy = 0u; copy < copies; ++copy)
    for (auto parameter = 0u; parameter < node[3]; ++parameter)
      words.push_back(std::bit_cast<std::uint32_t>(authored.parameter(node, parameter)));
  return words;
}

static void committedActivity() {
  using T = sfz::fxschema::Type;
  using P = sfz::fxschema::Parameter;
  auto words = activityFixture(T::delay, 2);
  const auto parameters = words[4] / 2;
  for (auto node = 0u; node < 2; ++node) {
    auto *values = words.data() + words[7] + node * parameters;
    for (const auto parameter : {P::delay_timel, P::delay_timec, P::delay_timer})
      values[static_cast<unsigned>(parameter)] = std::bit_cast<std::uint32_t>(.4F);
    values[static_cast<unsigned>(P::delay_dry)] = 0;
    values[static_cast<unsigned>(P::delay_feedback)] = 0;
    values[static_cast<unsigned>(P::delay_wet)] = std::bit_cast<std::uint32_t>(100.0F);
  }
  sfz::EffectPlan plan;
  require(plan.assign(words, 0, 0, 2, [](unsigned) { return false; }),
          "serial-delay activity plan");
  sfz::EffectRuntime runtime;
  const auto noImpulse = [](sfz::EffectImpulseReference) { return sfz::EffectImpulse{}; };
  require(runtime.prepare(plan, {1000, 2, 64}, 2, noImpulse, 0, {1 << 20, 8}) && !runtime.active(),
          "fresh runtime has no historical activity");
  std::array<float, 128> cc{}, audio{};
  std::array<float, 4> sends{};
  require(runtime.beginQuantum(64, cc) && runtime.pendingFrames() == 64 &&
              runtime.voiceMix(0, 0, sends, 100, 100) && !runtime.active(),
          "abandoned trial cannot publish activity");
  require(runtime.beginQuantum(64, cc) &&
              runtime.commit(audio.data(), {}, {}, [](unsigned, std::span<float>) {}) &&
              !runtime.active(),
          "retrying a silent trial discards abandoned input activity");
  bool echo = false, idle = false;
  for (auto origin = 0u; origin < 1800; origin += 64) {
    audio.fill(0);
    effetune::allocation_guard::Scope guard;
    require(runtime.beginQuantum(64, cc), "serial delay quantum");
    if (!origin)
      require(runtime.voiceMix(0, 0, sends, 1, 1), "serial delay input");
    require(runtime.commit(audio.data(), {}, {}, [](unsigned, std::span<float>) {}),
            "serial delay committed");
    for (auto frame = 0u; frame < 64; ++frame)
      if (origin + frame == 800)
        echo = audio[frame] > .99F;
    if (origin < 800)
      require(runtime.active(), "serial gap retains downstream pending audio");
    idle = idle || !runtime.active();
  }
  require(echo && idle, "serial echo survives its combined gap and eventually idles");

  words = activityFixture(T::fverb);
  require(plan.assign(words, 0, 0, 2, [](unsigned) { return false; }), "reverb activity plan");
  require(runtime.prepare(plan, {8000, 2, 64}, 2, noImpulse, 0, {1 << 20, 8}),
          "reverb activity preparation");
  sfz::EffectNode reference;
  require(reference.prepare(plan, 0, {8000, 2, 64}, 1, 0), "untruncated reverb reference");
  std::array<float, 156> sources{};
  bool lateAudible = false;
  idle = false;
  for (auto origin = 0u; origin < 96000; origin += 64) {
    audio.fill(0);
    effetune::allocation_guard::Scope guard;
    require(runtime.beginQuantum(64, cc), "reverb activity quantum");
    if (!origin)
      require(runtime.voiceMix(0, 0, sends, 1, 1), "reverb input");
    require(runtime.commit(audio.data(), {}, {}, [](unsigned, std::span<float>) {}),
            "reverb activity commit");
    bool significant = false;
    for (auto frame = 0u; frame < 64; ++frame) {
      float left = origin + frame == 0 ? 1.0F : 0.0F, right = left;
      reference.process(left, right, {sources, origin + frame}, {}, {});
      significant =
          significant || sfz::effectOutputAudible(left) || sfz::effectOutputAudible(right);
      require(std::abs(left - audio[frame]) < 1e-7F && std::abs(right - audio[64 + frame]) < 1e-7F,
              "idle reset never removes significant reference tail audio");
    }
    if (origin > 9600 && significant) {
      lateAudible = true;
      require(runtime.active(), "audible reverb refreshes silence rather than expiring at1.2s");
    }
    idle = idle || (origin > 9600 && !runtime.active());
  }
  require(lateAudible && idle, "reverb remains active past1.2s and eventually reaches silence");
  words = activityFixture(T::staticNoise);
  require(plan.assign(words, 0, 0, 2, [](unsigned) { return false; }) &&
              runtime.prepare(plan, {8000, 2, 64}, 2, noImpulse, 0, {1 << 20, 8}),
          "source-generating activity plan");
  require(runtime.beginQuantum(64, cc) &&
              runtime.commit(audio.data(), {}, {}, [](unsigned, std::span<float>) {}) &&
              runtime.generates() && runtime.active(),
          "committed generator remains active without sampler voices");
  runtime.reset();
  require(!runtime.active() && !runtime.generates() && runtime.pendingFrames() == 0,
          "explicit reset clears temporal and generator activity");
}

static void rectifierAntialiasing() {
  for (const auto frequency : {9000, 11000}) {
    sfz::EffectRectifier rectifier;
    const int alias = frequency == 9000 ? 12000 : 4000;
    double naiveReal = 0, naiveImag = 0, aaReal = 0, aaImag = 0;
    for (int i = 0; i < 96000; ++i) {
      float x = static_cast<float>(std::sin(6.283185307179586 * i * frequency / 48000)), left = x,
            right = x;
      rectifier.process(left, right, 1, true);
      if (i < 48000)
        continue;
      const double phase = 6.283185307179586 * i * alias / 48000;
      naiveReal += std::abs(x) * std::cos(phase);
      naiveImag += std::abs(x) * std::sin(phase);
      aaReal += left * std::cos(phase);
      aaImag += left * std::sin(phase);
    }
    const double naive = std::hypot(naiveReal, naiveImag) * 2 / 48000;
    const double aa = std::hypot(aaReal, aaImag) * 2 / 48000;
    std::printf("rectifier %dHz alias%dHz naive%.9g ADAA%.9g change%.4gdB\n", frequency, alias,
                naive, aa, 20 * std::log10(aa / naive));
    require(aa < naive * .6, "ADAA reduces representative folded harmonics "
                             "versus pointwise rectification");
  }
}
static void extensionEffects() {
  sfz::EffectPlan plan;
  require(plan.assign(kSfzEffectsExtensionFixture, 0, 0, 2, [](unsigned) { return false; }),
          "new effects compiler plan");
  const auto processNode = [&](unsigned index, auto run) {
    sfz::EffectNode node;
    require(node.prepare(plan, index, {48000, 2, 128}, 1, 0), "new native effect preparation");
    effetune::allocation_guard::Scope renderGuard;
    run(node);
  };
  rectifierAntialiasing();
  std::array<float, 156> controls{};
  sfz::modulation::SourceFrame source{controls};
  processNode(0, [&](auto &node) {
    float a = .25F, b = -.5F;
    controls[7] = 0;
    node.process(a, b, source, {}, {});
    require(near(a, .25F * std::pow(10.0F, -.3F)), "gain dB negative anchor");
    controls[7] = 1;
    a = .25F;
    b = -.5F;
    node.process(a, b, source, {}, {});
    require(near(a, .25F * std::pow(10.0F, .3F)) && near(b, -.5F * std::pow(10.0F, .3F)),
            "gain controller audio and polarity");
  });
  processNode(1, [&](auto &node) {
    float a = -.25F, b = .5F;
    controls[1] = 0;
    node.process(a, b, source, {}, {});
    require(a == -.25F && b == .5F, "rectify zero identity");
    controls[1] = 1;
    a = -.25F;
    b = .5F;
    node.process(a, b, source, {}, {});
    require(a == .25F && b == .5F, "full rectify controller endpoints");
    node.reset();
    controls[1] = .5F;
    a = -.25F;
    b = .5F;
    node.process(a, b, source, {}, {});
    require(a == 0 && b == .5F, "full fifty is half-wave");
  });
  processNode(2, [&](auto &node) {
    float a = -.25F, b = .5F;
    node.process(a, b, source, {}, {});
    require(a == 0 && b == .5F, "default half-wave mode");
  });
  float peak0 = 0, peak12 = 0;
  for (int pass = 0; pass < 2; ++pass)
    processNode(3, [&](auto &node) {
      controls[2] = static_cast<float>(pass);
      double input = 0, output = 0;
      for (int i = 0; i < 48000; ++i) {
        float a = static_cast<float>(.1F * std::sin(6.283185307179586 * i * 1000 / 48000)), b = a;
        const float original = a;
        node.process(a, b, source, {}, {});
        if (i > 24000) {
          input += original * original;
          output += a * a;
        }
      }
      (pass ? peak12 : peak0) = static_cast<float>(std::sqrt(output / input));
    });
  require(near(peak0, 1, 1e-4F) && near(peak12, std::pow(10.0F, .6F), 1e-3F),
          "filter gain enters peaking response, controller dB geometry");
  processNode(4, [&](auto &node) {
    float a = 1, b = .001F;
    node.process(a, b, source, {}, {});
    for (int i = 0; i < 480; ++i) {
      a = .001F;
      b = .001F;
      node.process(a, b, source, {}, {});
      require(near(a, .001F), "linked gate holds exactly the requested processed frames");
    }
    a = .001F;
    b = .001F;
    node.process(a, b, source, {}, {});
    require(a == 0 && b == 0, "gate closes after hold before next frame");
    node.reset();
    a = .001F;
    b = .001F;
    node.process(a, b, source, {}, {});
    require(a == 0 && b == 0, "reset clears hold state");
  });
}

int main() {
  extensionEffects();
  committedActivity();
  preparationGeometry();
  impulseRateConversion();
  speedSynchronizedDelay();
  effectRuntime();
  routingGraphs();
  planValidation();
  sharedControls();
  buses();
  convolution();
  delay();
  reverbAndPhaser();
  noiseAndStrings();
  typedDispatch();
  {
    effetune::allocation_guard::Scope guard;
    dynamics();
    coloration();
    voiceDsp();
  }
  require(effetune::allocation_guard::violationCount() == 0, "FX render and reset do not allocate");
  std::puts("SFZ effects helpers tests passed");
}

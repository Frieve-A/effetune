#include "allocation_guard.h"
#include "filters.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace effetune::plugins::others::sfz;
namespace allocation_guard = effetune::allocation_guard;
namespace {
int failures = 0;
#define CHECK(x)                                                                                   \
  do {                                                                                             \
    if (!(x)) {                                                                                    \
      std::fprintf(stderr, "sfz-filter:%d %s\n", __LINE__, #x);                                    \
      ++failures;                                                                                  \
    }                                                                                              \
  } while (false)
double response(unsigned type, float frequency, float cutoff = 2000, float gain = 0) {
  VoiceFilter filter;
  CHECK(filter.configure(type, cutoff, 0, gain, 48000));
  std::vector<float> comb(2u * VoiceFilter::maximumCombFrames(48000));
  double inputPower = 0, outputPower = 0;
  allocation_guard::Scope guard;
  for (unsigned frame = 0; frame < 8192; ++frame) {
    const auto input = static_cast<float>(std::sin(6.283185307179586 * frequency * frame / 48000));
    auto left = input, right = input;
    CHECK(filter.process(left, right, comb));
    if (frame >= 4096) {
      inputPower += input * input;
      outputPower += left * left;
    }
  }
  return std::sqrt(outputPower / inputPower);
}
void responses() {
  using T = VoiceFilter::Type;
  const auto measure = [](T type, float frequency, float gain = 0) {
    return response(static_cast<unsigned>(type), frequency, 2000, gain);
  };
  CHECK(measure(T::lpf_1p, 100) > .99);
  CHECK(measure(T::lpf_2p, 100) > .99);
  CHECK(measure(T::hpf_1p, 100) < .06);
  CHECK(measure(T::hpf_2p, 100) < .01);
  CHECK(measure(T::lpf_4p, 10000) < measure(T::lpf_2p, 10000) * .1);
  CHECK(measure(T::lpf_6p, 10000) < measure(T::lpf_4p, 10000) * .1);
  CHECK(measure(T::hpf_4p, 100) < measure(T::hpf_2p, 100) * .1);
  CHECK(measure(T::hpf_6p, 100) < measure(T::hpf_4p, 100) * .1);
  for (const auto type : {T::bpf_1p, T::bpf_2p, T::bpf_2p_sv}) {
    CHECK(std::abs(measure(type, 2000) - 1) < .01);
    CHECK(measure(type, 100) < measure(type, 2000) * .11);
  }
  for (const auto type : {T::brf_1p, T::brf_2p, T::brf_2p_sv}) {
    CHECK(measure(type, 2000) < .001);
    CHECK(measure(type, 100) > .98);
  }
  for (const auto frequency : {100.0F, 2000.0F, 10000.0F})
    CHECK(std::abs(measure(T::apf_1p, frequency) - 1) < .003);
  CHECK(std::abs(measure(T::lpf_2p_sv, 100) - 1) < .01);
  CHECK(measure(T::hpf_2p_sv, 100) < .01);
  CHECK(measure(T::pkf_2p, 2000) > 1.4);
  CHECK(std::abs(measure(T::lsh, 100, 12) - std::pow(10.0, 12.0 / 20)) < .03);
  CHECK(std::abs(measure(T::hsh, 10000, 12) - std::pow(10.0, 12.0 / 20)) < .03);
  CHECK(std::abs(measure(T::peq, 2000, 12) - std::pow(10.0, 12.0 / 20)) < .01);
  const auto pinkLow = measure(T::pink, 200), pinkHigh = measure(T::pink, 1600);
  CHECK(pinkLow / pinkHigh > 2 && pinkLow / pinkHigh < 4);
}
void stability() {
  for (const auto rate : {48000.0F, 192000.0F, 768000.0F}) {
    std::vector<float> storage(2u * VoiceFilter::maximumCombFrames(rate));
    for (unsigned type = 1; type <= 23; ++type)
      for (const auto cutoff : {5.0F, 2000.0F, rate * .45F})
        for (const auto resonance : {0.0F, 40.0F}) {
          VoiceFilter filter;
          allocation_guard::Scope guard;
          CHECK(filter.configure(type, cutoff, resonance, 12, rate));
          for (unsigned frame = 0; frame < 2048; ++frame) {
            auto left = frame == 0 ? 1.0F : 0.0F, right = 0.0F;
            CHECK(filter.process(left, right, storage));
            CHECK(std::isfinite(left) && std::isfinite(right));
            CHECK(std::abs(left) < 10000 && right == 0);
          }
        }
  }
}
void combRollback() {
  VoiceFilter filter;
  CHECK(filter.configure(static_cast<unsigned>(VoiceFilter::Type::comb), 1000, 12, 0, 48000));
  std::vector<float> samples(2u * VoiceFilter::maximumCombFrames(48000));
  std::array<CombWrite, 256> writes{};
  for (unsigned i = 0; i < 128; ++i) {
    auto left = i == 0 ? 1.0F : 0.0F, right = 0.0F;
    CHECK(filter.process(left, right, samples));
    if (i == 48)
      CHECK(std::abs(left - (1 - std::pow(10.0F, -.6F))) < .00001F);
  }
  const auto before = filter;
  const auto memoryBefore = samples;
  CombJournal journal{writes};
  std::array<float, 128> first{};
  {
    allocation_guard::Scope guard;
    for (unsigned i = 0; i < 128; ++i) {
      float right = 0;
      first[i] = static_cast<float>(i) / 128;
      CHECK(filter.process(first[i], right, samples, &journal));
    }
    journal.rollback(samples);
    filter = before;
  }
  CHECK(samples == memoryBefore);
  {
    allocation_guard::Scope guard;
    for (unsigned i = 0; i < 128; ++i) {
      auto left = static_cast<float>(i) / 128, right = 0.0F;
      CHECK(filter.process(left, right, samples));
      CHECK(left == first[i]);
    }
    filter.reset();
    float left = 0, right = 0;
    CHECK(filter.process(left, right, samples));
    CHECK(left == 0 && right == 0);
  }
}
void sharedCoefficients() {
  std::vector<float> independentMemory(2u * VoiceFilter::maximumCombFrames(48000));
  auto sharedMemory = independentMemory;
  for (auto type = 1u; type <= 23u; ++type) {
    VoiceFilter independent, shared, prepared;
    std::fill(independentMemory.begin(), independentMemory.end(), 0.0F);
    std::fill(sharedMemory.begin(), sharedMemory.end(), 0.0F);
    allocation_guard::Scope guard;
    for (auto frame = 0u; frame < 256u; ++frame) {
      const auto frequency = 500.0F + frame * 3.0F;
      CHECK(independent.configure(type, frequency, 12, 3, 48000));
      CHECK(prepared.configure(type, frequency, 12, 3, 48000));
      shared.copyConfiguration(prepared);
      // Another voice can replace the derived cache without altering this voice's state.
      CHECK(prepared.configure(type, frequency + 17, 6, -3, 48000));
      auto left = frame == 0 ? 1.0F : .01F, right = left * .5F;
      auto sharedLeft = left, sharedRight = right;
      CHECK(independent.process(left, right, independentMemory));
      CHECK(shared.process(sharedLeft, sharedRight, sharedMemory));
      CHECK(left == sharedLeft && right == sharedRight);
    }
  }
}
void silentSubnormalTail() {
  for (const auto type :
       {VoiceFilter::Type::lpf_2p, VoiceFilter::Type::lpf_2p_sv, VoiceFilter::Type::pink}) {
    VoiceFilter filter;
    CHECK(filter.configure(static_cast<unsigned>(type), 2000, 0, 0, 48000));
    allocation_guard::Scope guard;
    float left = 0, right = 0;
    for (auto frame = 0u; frame < 100064u; ++frame) {
      left = right = frame < 64u ? .25F : 0.0F;
      CHECK(filter.process(left, right));
      CHECK(std::fpclassify(left) != FP_SUBNORMAL && std::fpclassify(right) != FP_SUBNORMAL);
    }
    CHECK(left == 0 && right == 0);
  }
}
} // namespace
int main() {
  responses();
  stability();
  combRollback();
  sharedCoefficients();
  silentSubnormalTail();
  return failures ? 1 : 0;
}

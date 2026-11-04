#include "../soundfont_player/effects_fixture.h"
#include "allocation_guard.h"
#include "bank.h"
#include <array>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace sfz = effetune::plugins::others::sfz;
static void require(bool value, const char *message) {
  if (!value) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
// These tests isolate CONTROL FX preparation using the normal compiler's payload.
// Whole-bank admission and the normal producer's final FX reservation are separate
// integration gates; this explicit budget is not an application fallback.
static void source(sfz::SFZBank &bank, std::span<const std::uint8_t> bytes,
                   std::uint64_t budget = 8u * 1024u * 1024u) {
  require(bank.payload_.allocate(bytes.size() / 4u), "fixture payload allocation");
  std::memcpy(bank.payload_.data(), bytes.data(), bytes.size());
  const auto header = [&](unsigned word) {
    return sfz::SFZBank::readU32(bytes.data() + 32u + word * 4u);
  };
  bank.begin_.frames = static_cast<std::uint32_t>((bytes.size() - 32u) / 4u);
  bank.begin_.channels = 1;
  bank.begin_.byteSize = static_cast<std::uint32_t>(bytes.size());
  bank.begin_.processingChannels = 2;
  bank.region_count_ = header(2);
  bank.pool_offset_ = header(4);
  bank.modulation_offset_ = header(10);
  bank.modulation_words_ = header(11);
  bank.sfz_effect_budget_bytes_ = budget;
}
static std::uint32_t impulseDirectory(sfz::SFZBank &bank) {
  auto *section = bank.payload_.data() + 8u + bank.modulation_offset_;
  const auto fx = std::bit_cast<std::uint32_t>(section[14]);
  return 8u + bank.modulation_offset_ + fx + std::bit_cast<std::uint32_t>(section[fx + 20u]);
}
static void resident(float rate) {
  sfz::SFZBank bank;
  source(bank, kFxImpulsePayload);
  const effetune::PrepareInfo info{rate, 16, 64};
  require(bank.prepareSfzEffects(info, 2, 30, 128) == ET_OK,
          "resident IR prepares at actual host rate");
  const auto &ir = bank.sfz_effect_ir_.data()[0];
  require(ir.frames == static_cast<unsigned>(std::round(rate / 100.0)) && ir.channels == 1,
          "44100 Hz IR preserves physical duration at host rate");
  double sum = 0, moment = 0;
  for (auto frame = 0u; frame < ir.frames; ++frame) {
    sum += ir.samples[frame];
    moment += ir.samples[frame] * frame;
  }
  require(std::abs(sum - 1) < .002 && std::abs(moment / sum - 220.0 * rate / 44100.0) < .02,
          "IR resampling preserves DC area and physical impulse time");
  require(bank.sfz_effect_sources_.size() == 28u * info.maxFrames,
          "extended facts allocate exact prepared block capacity");
  const auto persistent =
      sizeof(sfz::EffectPlan) + bank.sfz_effect_words_.size() * 4u +
      bank.sfz_effect_ir_.size() * sizeof(sfz::EffectImpulse) +
      (bank.sfz_effect_impulses_.size() + bank.sfz_effect_sources_.size()) * sizeof(float);
  require(persistent + bank.sfz_effects_->storageBytes() <= bank.sfz_effect_budget_bytes_,
          "persistent typed plan, IR, captured facts and runtime fit explicit reservation");
  require(bank.prepareSfzEffects(info, 2, 30, 128) == ET_OK,
          "identical CONTROL preparation is idempotent");
  require(bank.prepareSfzEffects(info, 4, 30, 128) == ET_ERR_STATE,
          "a changed actual output matrix requires fresh preparation");
  sfz::SFZBank tiny;
  source(tiny, kFxImpulsePayload, persistent);
  require(tiny.prepareSfzEffects(info, 2, 30, 128) == ET_ERR_OOM && !tiny.sfz_effects_,
          "remaining budget is not silently enlarged for convolution");
}
static void streamed() {
  sfz::SFZBank bank;
  source(bank, kFxImpulsePayload);
  const auto directory = impulseDirectory(bank);
  const auto original = std::bit_cast<std::uint32_t>(bank.payload_.data()[directory]);
  std::vector<float> input(441);
  std::copy_n(bank.payload_.data() + 8u + bank.pool_offset_ + original, 441, input.data());
  bank.payload_.data()[directory] = std::bit_cast<float>(0u);
  bank.streamed_ = true;
  bank.sample_count_ = 1;
  require(bank.sample_metadata_.allocate(1), "stream metadata storage");
  bank.sample_metadata_.data()[0] = {441, 1, 44100};
  require(bank.cache_.configure(1, bank.sample_metadata_.data(), 1, 1), "stream cache preparation");
  const effetune::PrepareInfo info{48000, 16, 64};
  require(bank.prepareSfzEffects(info, 2, 30, 128) == ET_NEED_SAMPLE && !bank.sfz_effects_,
          "IR-only dependency requests data before an FX runtime can become ready");
  sfz::SamplePageRequest request;
  require(bank.cache_.takeRequests(&request, 1) == 0 && !bank.cache_.requestOverflow(),
          "known startup IR preload does not enqueue duplicate native requests");
  request = {bank.cache_.generation(), 0, 0};
  require(bank.cache_.publish(request, input.data(), 441, 1, true), "IR page becomes resident");
  require(bank.prepareSfzEffects(info, 2, 30, 128) == ET_OK,
          "CONTROL retry resolves a ready streamed IR without runtime disk access");
  std::array<float, 128> cc{}, audio{};
  const std::array<float, 4> sends{};
  {
    effetune::allocation_guard::Scope guard;
    require(bank.sfz_effects_->beginQuantum(64, cc), "begin trial scratch");
    require(bank.sfz_effects_->voiceMix(0, 0, sends, 100, 100), "abandoned voice trial");
    require(bank.sfz_effects_->beginQuantum(64, cc), "retry clears abandoned scratch only");
    require(bank.sfz_effects_->voiceMix(0, 0, sends, 1, 1), "accepted voice trial");
    require(bank.sfz_effects_->commit(audio.data(), {}, {},
                                      [](unsigned, std::span<float> facts) { facts[14] = 120; }),
            "FX state advances only at successful commit");
  }
  const auto &ir = bank.sfz_effect_ir_.data()[0];
  for (auto offset = 0u; offset < 512u; offset += 64u) {
    if (offset) {
      audio.fill(0);
      effetune::allocation_guard::Scope guard;
      require(bank.sfz_effects_->beginQuantum(64, cc, offset), "continue the committed FX tail");
      require(bank.sfz_effects_->commit(audio.data(), {}, {},
                                        [](unsigned, std::span<float> facts) { facts[14] = 120; }),
              "tail commits without a new voice");
    }
    for (auto frame = 0u; frame < 64u; ++frame) {
      const auto expected = offset + frame < ir.frames ? ir.samples[offset + frame] : 0.F;
      require(std::abs(audio[frame] - expected) < 1e-5F &&
                  std::abs(audio[64u + frame] - expected) < 1e-5F,
              "abandoned 100x trial leaves no convolution state in the accepted unit impulse");
    }
  }
  bank.sample_metadata_.data()[0].rate = 48000;
  bank.sfz_effects_.reset();
  require(bank.prepareSfzEffects(info, 2, 30, 128) == ET_ERR_UNSUPPORTED,
          "captured stream metadata must match the authored IR directory");
}
int main() {
  resident(48000);
  resident(96000);
  streamed();
  sfz::SFZBank aux;
  source(aux, kFxAuxPayload);
  require(aux.prepareSfzEffects({48000, 16, 64}, 2, 30, 128) == ET_ERR_UNSUPPORTED,
          "max channel capacity cannot substitute for actual stereo output");
  require(aux.prepareSfzEffects({48000, 16, 64}, 4, 30, 128) == ET_OK,
          "a real auxiliary stereo pair is admitted");
  std::puts("SFZ bank FX CONTROL tests passed");
}

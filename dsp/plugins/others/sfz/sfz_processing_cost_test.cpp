#include "../soundfont_player/effects_fixture.h"
#include "../soundfont_player/future_main_fixture.h"
#include "../soundfont_player/modulation_fixture.h"
#include "../soundfont_player/sf2_fixture.h"
#include "../soundfont_player/storage_fixture.h"
#include "allocation_guard.h"
#include "bank.h"
#include "sfz_processing_cost.h"
#include <array>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <vector>

namespace sfz = effetune::plugins::others::sfz;
using effetune::AssetBeginInfo;
using effetune::PrepareInfo;
static void require(bool value, const char *message) {
  if (!value) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
static std::uint32_t word(std::span<const std::uint8_t> bytes, unsigned index) {
  return sfz::SFZBank::readU32(bytes.data() + static_cast<std::size_t>(index) * 4u);
}
static void write(std::vector<std::uint8_t> &bytes, unsigned index, std::uint32_t value) {
  for (auto lane = 0u; lane < 4; ++lane)
    bytes[static_cast<std::size_t>(index) * 4u + lane] =
        static_cast<std::uint8_t>(value >> (lane * 8));
}
static AssetBeginInfo infoFor(std::span<const std::uint8_t> payload, std::uint32_t footprint) {
  require(payload.size() <= UINT32_MAX, "fixture payload size");
  return {1,         static_cast<std::uint32_t>((payload.size() - 32) / 4),
          0,         0,
          1,         0,
          0,         2,
          footprint, static_cast<std::uint32_t>(payload.size())};
}
static et_status stage(sfz::SFZBank &bank, std::span<const std::uint8_t> payload,
                       const AssetBeginInfo &info) {
  const auto allocated = bank.allocate(info);
  if (allocated != ET_OK)
    return allocated;
  std::memcpy(bank.payload_.data(), payload.data(), payload.size());
  const auto status = bank.commit(info.byteSize, ET_ASSET_F32_MULTICH);
  if (status == ET_OK)
    bank.prepareSlice(UINT64_MAX);
  return status;
}
static std::uint64_t query(std::span<const std::uint8_t> prefix, std::uint32_t payloadBytes,
                           const PrepareInfo &context) {
  std::uint64_t result = UINT64_MAX;
  require(sfz::processingPreparationBytes(prefix, payloadBytes, ET_ASSET_F32_MULTICH, context, 2,
                                          result) == ET_OK,
          "metadata-only complete preparation query");
  return result;
}
static void admission(std::span<const std::uint8_t> payload, float rate, bool comb, bool fx,
                      bool sf2) {
  const PrepareInfo context{rate, 2, 128, 30};
  const auto payloadBytes = static_cast<std::uint32_t>(payload.size());
  const auto prefixBytes = 32u + word(payload, 8u + 4u) * 4u;
  std::vector<std::uint8_t> prefix(payload.begin(), payload.begin() + prefixBytes);
  const auto additional = query(prefix, payloadBytes, context);
  require(additional == query(payload, payloadBytes, context),
          "minimal metadata prefix and complete source return identical additional peak");
  // Read the native base reservation from the allocator itself. The complete
  // query also includes it, so isolate processing without duplicating base math.
  std::uint64_t base = 0;
  {
    sfz::SFZBank staged;
    const auto info = infoFor(payload, sfz::kCapacity);
    require(stage(staged, payload, info) == ET_OK, "measure admitted native base");
    base = info.footprintBytes - staged.sfz_effect_budget_bytes_;
  }
  require(base >= payloadBytes, "native base includes the declared compiled payload");
  const auto baseAdditional = base - payloadBytes;
  require(additional >= baseAdditional, "complete query includes every native base reservation");
  const auto processing = additional - baseAdditional;
  if (comb || fx || sf2)
    require(processing > 0, "every processing family has an explicit reservation");
  else
    require(additional == baseAdditional && additional > 0,
            "ordinary no-FX query includes native base storage without processing allocation");
  require(payloadBytes + additional < sfz::kCapacity,
          "test reservation fits native asset capacity");
  {
    sfz::SFZBank exact;
    const auto info = infoFor(payload, static_cast<std::uint32_t>(payloadBytes + additional));
    require(stage(exact, payload, info) == ET_OK && exact.prepareProcessing(context) == ET_OK,
            "exact additional peak admits actual processing preparation");
    require((exact.comb_samples_.size() != 0) == comb && (exact.sfz_effects_ != nullptr) == fx &&
                (exact.sf2_effects_ != nullptr) == sf2,
            "the admitted bank allocated the expected concrete processing families");
    if (comb) {
      sfz::SFZBank::CombStorageRequirements geometry;
      require(
          sfz::SFZBank::combStorageRequirements(context, exact.modulation_->combMask, geometry) &&
              geometry.samples == exact.comb_samples_.size() &&
              geometry.writes == exact.comb_writes_.size() &&
              geometry.journals == exact.comb_journals_.size(),
          "COMB query and allocation share samples, write journal and metadata geometry");
      if (!fx)
        require(processing == geometry.bytes,
                "complete query minus native base equals the actual COMB processing cost");
    }
    if (sf2)
      require(processing == sfz::sf2::Effects::storageBytes(context),
              "SF2 query includes its real send kernels without counting base storage twice");
  }
  {
    sfz::SFZBank shortBank;
    const auto info = infoFor(payload, static_cast<std::uint32_t>(payloadBytes + additional - 1));
    const auto staged = stage(shortBank, payload, info);
    require(staged == ET_ERR_OOM ||
                (staged == ET_OK && shortBank.prepareProcessing(context) == ET_ERR_OOM),
            "one byte below complete reservation rejects admission");
    require(!shortBank.comb_samples_.size() && !shortBank.sfz_effects_ && !shortBank.sf2_effects_,
            "insufficient processing reservation rejects before large processing allocation");
  }
  if (prefixBytes < payloadBytes) {
    auto invalidPcm = std::vector<std::uint8_t>(payload.begin(), payload.end());
    write(invalidPcm, prefixBytes / 4u, 0x7fc00000u);
    require(query(invalidPcm, payloadBytes, context) == additional,
            "sizing never inspects PCM values");
    sfz::SFZBank fullValidation;
    const auto info = infoFor(invalidPcm, static_cast<std::uint32_t>(payloadBytes + additional));
    require(stage(fullValidation, invalidPcm, info) == ET_OK &&
                fullValidation.state_ == ET_ASSET_STATE_ERROR,
            "actual full preparation retains strict PCM validation");
  }
}
static void boundsAndLogicalExtent() {
  const auto payload = std::span<const std::uint8_t>(kFutureNoiseCombPayload);
  const auto prefixBytes = 32u + word(payload, 12u) * 4u;
  std::vector<std::uint8_t> prefix(payload.begin(), payload.begin() + prefixBytes);
  const PrepareInfo context{96000, 2, 128, 0};
  const auto original = query(prefix, static_cast<std::uint32_t>(payload.size()), context);
  // This describes a large PCM pool that has never been allocated or transferred.
  const auto fullBytes = sfz::kCapacity;
  const auto fullFrames = (fullBytes - 32u) / 4u;
  write(prefix, 2, fullFrames);
  write(prefix, 8u + 5u, fullFrames);
  require(query(prefix, fullBytes, context) == original,
          "a declared 1GiB source extent uses only the small control prefix");
  std::uint64_t cost = 999;
  const auto reject = [&](std::span<const std::uint8_t> control, std::uint32_t extent) {
    cost = 999;
    require(sfz::processingPreparationBytes(control, extent, ET_ASSET_F32_MULTICH, context, 2,
                                            cost) == ET_ERR_ARGS &&
                cost == 0,
            "malformed prefix or declared extent rejects and clears the result");
  };
  reject({prefix.data(), 32}, fullBytes);
  reject({prefix.data(), prefix.size() - 4}, fullBytes);
  reject(prefix, fullBytes - 4);
  reject(prefix, prefixBytes - 4);
  auto bad = prefix;
  write(bad, 8u + 11u, UINT32_MAX);
  reject(bad, fullBytes);
  bad = prefix;
  write(bad, 8u + 4u, fullFrames);
  reject(bad, fullBytes);
  require(sfz::processingPreparationBytes(prefix, fullBytes, ET_ASSET_F32_MULTICH, {96000, 2, 0, 0},
                                          2, cost) == ET_ERR_ARGS &&
              cost == 0,
          "invalid processing geometry rejects even before a no-FX preparation");
}
static void streamedImpulseOrdering() {
  const PrepareInfo context{48000, 2, 128, 0};
  std::uint64_t firstCost = 0;
  const std::array payloads{std::span<const std::uint8_t>(kStorageIrFirstPayload),
                            std::span<const std::uint8_t>(kStorageIrLastPayload)};
  const std::array ids{kStorageIrFirstId, kStorageIrLastId};
  require(ids[0] == 0u && ids[1] == 1u, "canonical filename order moves IR beyond sample zero");
  for (auto order = 0u; order < payloads.size(); ++order) {
    const auto payload = payloads[order];
    const auto payloadBytes = static_cast<unsigned>(payload.size());
    require(word(payload, 9u) == 10u, "IR fixture uses canonical sixteen-word v10 rows");
    const auto prefixBytes = 32u + word(payload, 12u) * 4u;
    std::uint64_t additional = 0;
    require(et_sample_player_preparation_bytes(payload.data(), prefixBytes, payloadBytes,
                                               ET_ASSET_F32_MULTICH, 48000, 2, 128, 0, &additional,
                                               ET_SAMPLE_PLAYER_NOTE) == ET_OK,
            "public complete query accepts a nonzero IR sample ID");
    require(additional == query(payload, payloadBytes, context),
            "public prefix and full metadata query agree for streamed IR");
    if (!order)
      firstCost = additional;
    require(additional == firstCost && additional < UINT32_MAX - payloadBytes,
            "sample ordering does not change the complete preparation reservation");
    sfz::SFZBank bank;
    require(stage(bank, payload,
                  infoFor(payload, payloadBytes + static_cast<unsigned>(additional))) == ET_OK &&
                bank.prepareProcessing(context) == ET_OK,
            "exact queried reservation prepares the actual streamed IR bank");
    require(bank.configureSampleStream(39u) == ET_OK && bank.state_ == ET_ASSET_STATE_PREPARING,
            "stream admission waits for the declared resident IR");
    std::array<float, 441> impulse{};
    impulse[0] = 1.0F;
    require(bank.publishSamplePage(39u, ids[order], 0u, impulse.data(), 441u, 1u, 1u) == ET_OK &&
                bank.state_ == ET_ASSET_STATE_ACTIVE && bank.sfz_effect_ready_ && bank.sfz_effects_,
            "resident 44.1kHz IR upload reaches ACTIVE beside a 48kHz source");
    require(bank.sfz_effect_ir_.size() == 1u && bank.sfz_effect_ir_.data()[0].frames == 480u,
            "the real effect owns the resampled impulse rather than source PCM metadata");
  }
}
static void playerCapacityQuery() {
  const auto payload = std::span<const std::uint8_t>(kV3VariableProductPayload);
  const auto size = static_cast<std::uint32_t>(payload.size());
  const PrepareInfo context{48000, 2, 128, 0};
  std::uint64_t note = 0, main = 0;
  require(et_sample_player_preparation_bytes(payload.data(), size, size, ET_ASSET_F32_MULTICH,
                                             48000, 2, 128, 0, &note,
                                             ET_SAMPLE_PLAYER_NOTE) == ET_OK,
          "Note capacity query");
  require(et_sample_player_preparation_bytes(payload.data(), size, size, ET_ASSET_F32_MULTICH,
                                             48000, 2, 128, 0, &main,
                                             ET_SAMPLE_PLAYER_MAIN) == ET_OK &&
              main > note,
          "Main reserves all 1024 typed voice states");
  for (const auto voices : {128u, 1024u}) {
    const auto additional = voices == 128u ? note : main;
    require(additional < UINT32_MAX - size, "capacity query fits declared asset extent");
    for (const auto shortBy : {0u, 1u}) {
      sfz::SFZBank bank(voices);
      const auto info = infoFor(payload, size + static_cast<std::uint32_t>(additional) - shortBy);
      const auto staged = stage(bank, payload, info);
      const auto result = staged == ET_OK ? bank.prepareProcessing(context) : staged;
      require(result == (shortBy ? ET_ERR_OOM : ET_OK),
              "capacity-specific exact query accepts, one byte short rejects");
    }
  }
  main = UINT64_MAX;
  require(et_sample_player_preparation_bytes(payload.data(), size, size, ET_ASSET_F32_MULTICH,
                                             48000, 2, 128, 0, &main, 2u) == ET_ERR_ARGS &&
              main == 0,
          "unknown player kind rejects and clears output");
}
int main() {
  playerCapacityQuery();
  streamedImpulseOrdering();
  for (const auto rate : {48000.0F, 96000.0F}) {
    admission(kFutureDryPayload, rate, false, false, false);
    admission(kFutureNoiseCombPayload, rate, true, false, false);
    admission(kFutureFxGlobalPayload, rate, false, true, false);
    admission(kV3VariableFxPayload, rate, false, true, false);
    admission(kFuturePagedVoiceNoisePayload, rate, true, true, false);
    admission(kFxImpulsePayload, rate, false, true, false);
    admission(kSf2NativeFixture, rate, false, false, true);
    const PrepareInfo context{rate, 2, 128, 0};
    const auto sf2Bytes = sfz::sf2::Effects::storageBytes(context);
    sfz::sf2::Effects exact, shortEffects;
    require(exact.prepare(context, sf2Bytes), "exact SF2 kernel reservation admits");
    {
      effetune::allocation_guard::Scope guard;
      require(!shortEffects.prepare(context, sf2Bytes - 1),
              "one-byte-short SF2 kernel reservation fails without allocating");
    }
  }
  boundsAndLogicalExtent();
  require(effetune::allocation_guard::violationCount() == 0,
          "budget rejection and processing remain allocation safe");
  std::puts("Sample player metadata-only complete preparation tests passed");
}

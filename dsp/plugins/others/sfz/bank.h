#ifndef EFFETUNE_SFZ_PREPARED_BANK_H
#define EFFETUNE_SFZ_PREPARED_BANK_H
#include "../sfz_note_player/bank.h"
#include "effetune/kernel.h"
#include "filters.h"
#include "modulation_bank.h"
#include "nothrow_storage.h"
#include "sample_cache.h"
#include "script_session.h"
#include "sf2_effects.h"
#include "sfz_effect_cost.h"
#include "sfz_effect_runtime.h"
#include "sfz_keyswitches.h"
#include "sfz_resampling.h"
#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>

namespace effetune::plugins::others::sfz {
// Playback owns exactly one bank; prepared updates carry its replacement or retirement.
struct SFZBank final : PreparedAsset {
  explicit SFZBank(std::uint32_t voices = 128u) noexcept : voice_capacity_(voices) {}
  const std::uint32_t voice_capacity_;
  static constexpr std::uint32_t kLoadStreamVersion = 10u, kLoadStreamHeader = 20u;
  static bool integer(float v, std::uint32_t low, std::uint32_t high) noexcept {
    return std::isfinite(v) && v >= static_cast<float>(low) && v <= static_cast<float>(high) &&
           std::floor(v) == v;
  }
  static std::uint32_t readU32(const std::uint8_t *p) noexcept {
    return p[0] | static_cast<std::uint32_t>(p[1]) << 8u | static_cast<std::uint32_t>(p[2]) << 16u |
           static_cast<std::uint32_t>(p[3]) << 24u;
  }

  static std::uint32_t effectControllerEvents(const PrepareInfo &info) noexcept {
    return info.maxFrames && info.maxFrames <= UINT32_MAX / 128u ? info.maxFrames * 128u : 0u;
  }
  struct CombStorageRequirements {
    std::uint32_t frames = 0, stages = 0;
    std::size_t samples = 0, writes = 0, journals = 0;
    std::uint64_t bytes = 0;
  };
  static bool combStorageRequirements(const PrepareInfo &info, std::uint32_t mask,
                                      CombStorageRequirements &storage,
                                      std::uint32_t voices = 128u) noexcept {
    storage = {};
    if (!std::isfinite(info.sampleRate) || info.sampleRate < 1 || info.sampleRate > 768000 ||
        !info.maxFrames || (mask & ~7u))
      return false;
    storage.stages = std::popcount(mask);
    if (!storage.stages)
      return true;
    storage.frames = VoiceFilter::maximumCombFrames(static_cast<float>(info.sampleRate));
    const std::uint64_t slots = static_cast<std::uint64_t>(voices) * storage.stages;
    const auto samples = slots * 2u * storage.frames;
    const auto writes = slots * 2u * info.maxFrames;
    if (samples > SIZE_MAX / sizeof(float) || writes > SIZE_MAX / sizeof(CombWrite) ||
        slots > SIZE_MAX / sizeof(CombJournal))
      return false;
    storage.samples = static_cast<std::size_t>(samples);
    storage.writes = static_cast<std::size_t>(writes);
    storage.journals = static_cast<std::size_t>(slots);
    storage.bytes =
        samples * sizeof(float) + writes * sizeof(CombWrite) + slots * sizeof(CombJournal);
    return true;
  }
  struct ControlLayout {
    std::uint32_t regions = 0, poolOffset = 0, modOffset = 0, modWords = 0;
    std::uint32_t sampleOffset = 0, sampleCount = 0;
    bool streamed = false, sf2 = false, loading = false;
    std::uint32_t slots16 = 0, residentOffset = 0, residentCount = 0;
    std::uint64_t cacheBytes = 0;
  };
  static et_status controlLayout(const AssetBeginInfo &info, std::span<const std::uint8_t> control,
                                 std::uint32_t format, ControlLayout &layout) noexcept {
    layout = {};
    if (!control.data() || format != ET_ASSET_F32_MULTICH || info.channels != 1u || info.topology ||
        info.byteSize < 32u + kHeader * 4u || info.byteSize > kCapacity || info.byteSize % 4u ||
        control.size() > info.byteSize || control.size() < 32u + kHeader * 4u ||
        control.size() % 4u || static_cast<std::uint64_t>(info.frames) * 4u + 32u != info.byteSize)
      return ET_ERR_ARGS;
    const auto word = [&](std::uint32_t index) {
      return readU32(control.data() + static_cast<std::size_t>(index) * 4u);
    };
    const auto header = [&](std::uint32_t index) { return word(8u + index); };
    const auto version = header(1);
    layout.sf2 = version == kSf2Version;
    layout.loading = version == kLoadStreamVersion;
    layout.streamed = version == kStreamVersion || layout.sf2 || layout.loading;
    const auto headerWords = layout.sf2        ? kSf2Header
                             : layout.loading  ? kLoadStreamHeader
                             : layout.streamed ? kStreamHeader
                                               : kHeader;
    if ((version != kVersion && version != kModulationVersion && !layout.streamed) ||
        control.size() < 32ull + headerWords * 4ull || info.frames < headerWords)
      return ET_ERR_ARGS;
    layout.regions = header(2);
    layout.poolOffset = header(4);
    layout.modOffset = header(10);
    layout.modWords = header(11);
    if (word(0) != 0x31415445u || word(1) != 1u || word(2) != info.frames || word(3) != 1u ||
        word(4) || word(5) || header(0) != kMagic || !layout.regions || header(3) != kStride ||
        layout.poolOffset > info.frames || header(5) != info.frames || !header(6) ||
        header(6) > layout.regions || header(7) > header(8) || header(7) % 2u ||
        static_cast<std::uint64_t>(header(8)) - header(7) !=
            headerWords + static_cast<std::uint64_t>(layout.regions) * kStride ||
        header(9) % 4u ||
        32ull + static_cast<std::uint64_t>(layout.poolOffset) * 4u > control.size())
      return ET_ERR_ARGS;
    const auto scriptEnd = static_cast<std::uint64_t>(header(8)) + header(9) / 4u;
    if (scriptEnd > layout.poolOffset ||
        (version == kVersion && (layout.modOffset || layout.modWords)) ||
        (!layout.modWords && layout.modOffset) ||
        (layout.modWords && (layout.modOffset != scriptEnd || layout.modWords < 2u)))
      return ET_ERR_ARGS;
    const auto sectionEnd = scriptEnd + layout.modWords;
    if (sectionEnd > layout.poolOffset)
      return ET_ERR_ARGS;
    if (!layout.streamed)
      return sectionEnd == layout.poolOffset ? ET_OK : ET_ERR_ARGS;
    layout.sampleOffset = header(12);
    layout.sampleCount = header(13);
    const auto sampleEnd =
        sectionEnd + static_cast<std::uint64_t>(layout.sampleCount) * (layout.loading ? 16u : 12u);
    if (header(15) != (layout.sf2       ? 0x10001u
                       : layout.loading ? 2u
                                        : 1u) ||
        !layout.sampleCount || layout.sampleCount > SamplePageCache::kMaxSamples || !header(14) ||
        header(14) > 32768u || layout.sampleOffset != sectionEnd || sampleEnd > layout.poolOffset ||
        layout.poolOffset != info.frames ||
        (!layout.sf2 && !layout.loading && sampleEnd != layout.poolOffset))
      return ET_ERR_ARGS;
    if (layout.sf2 &&
        (header(16) != sampleEnd || !header(17) || header(17) > 65535u ||
         sampleEnd + static_cast<std::uint64_t>(header(17)) * 4u != layout.poolOffset))
      return ET_ERR_ARGS;
    if (layout.loading) {
      layout.slots16 = header(16);
      layout.residentOffset = header(17);
      layout.residentCount = header(18);
      if (layout.slots16 > header(14) || header(19) || layout.residentOffset != sampleEnd ||
          sampleEnd + static_cast<std::uint64_t>(layout.residentCount) * 4u != layout.poolOffset)
        return ET_ERR_ARGS;
    }
    std::uint32_t cacheChannels = 1u, nextInterval = 0u;
    for (auto index = 0u; index < layout.sampleCount; ++index) {
      const auto record = layout.sampleOffset + index * (layout.loading ? 16u : 12u);
      const auto frames = header(record) | (static_cast<std::uint64_t>(header(record + 1u)) << 32u);
      if (!frames || header(record + 2u) < 1u || header(record + 2u) > 2u || !header(record + 3u) ||
          header(record + 3u) > 768000u)
        return ET_ERR_ARGS;
      cacheChannels = std::max(cacheChannels, header(record + 2u));
      if (layout.loading) {
        const auto mode = header(record + 12u), first = header(record + 13u),
                   count = header(record + 14u);
        if (mode > 1u || header(record + 15u) || first != nextInterval ||
            count > layout.residentCount - nextInterval ||
            (mode ? !layout.slots16 : layout.slots16 == header(14)))
          return ET_ERR_ARGS;
        std::uint64_t previousEnd = 0u;
        for (auto interval = first; interval < first + count; ++interval) {
          const auto row = layout.residentOffset + interval * 4u;
          const auto begin = header(row) | (static_cast<std::uint64_t>(header(row + 1u)) << 32u);
          const auto end = header(row + 2u) | (static_cast<std::uint64_t>(header(row + 3u)) << 32u);
          if (begin >= end || end > frames || (interval != first && begin <= previousEnd))
            return ET_ERR_ARGS;
          previousEnd = end;
        }
        nextInterval += count;
      }
    }
    if (nextInterval != layout.residentCount)
      return ET_ERR_ARGS;
    SamplePageCache::StorageRequirements storage;
    if (!SamplePageCache::storageRequirements(layout.sampleCount, header(14), layout.slots16,
                                              cacheChannels, storage, layout.loading))
      return ET_ERR_ARGS;
    layout.cacheBytes = storage.bytes;
    return ET_OK;
  }
  static et_status assignEffectPlan(const AssetBeginInfo &info,
                                    std::span<const std::uint8_t> control, std::uint32_t format,
                                    std::uint32_t actualChannels, EffectPlan &plan,
                                    NothrowStorage<std::uint32_t> &fxWords, bool &streamed,
                                    std::uint64_t budget = UINT64_MAX) noexcept {
    fxWords.release();
    streamed = false;
    ControlLayout layout;
    const auto valid = controlLayout(info, control, format, layout);
    if (valid != ET_OK || !actualChannels || actualChannels > 16u)
      return valid != ET_OK ? valid : ET_ERR_ARGS;
    streamed = layout.streamed;
    if (layout.sf2 || !layout.modWords)
      return ET_OK;
    const auto header = [&](std::uint32_t index) {
      return readU32(control.data() + 32u + static_cast<std::size_t>(index) * 4u);
    };
    const auto modulation = [&](std::uint32_t index) { return header(layout.modOffset + index); };
    if (modulation(1) != 4u)
      return ET_OK;
    if (layout.modWords < 16u || modulation(0) != 0x31525453u || modulation(2) != layout.regions ||
        modulation(12) != schema::kProfile || modulation(13))
      return ET_ERR_ARGS;
    const auto offset = modulation(14), words = modulation(15);
    const auto curveOffset = modulation(7), curves = modulation(4);
    if (offset < 16u || offset > layout.modWords || words != layout.modWords - offset ||
        words < fxschema::kHeaderWords || curves > 248u || curveOffset > offset ||
        static_cast<std::uint64_t>(curves) * schema::kCurveWords > offset - curveOffset)
      return ET_ERR_ARGS;
    const auto extent = streamed ? layout.sampleCount : info.frames - layout.poolOffset;
    if (sizeof(EffectPlan) + static_cast<std::uint64_t>(words) * sizeof(std::uint32_t) > budget)
      return ET_ERR_OOM;
    if (!fxWords.allocate(words))
      return ET_ERR_OOM;
    for (auto index = 0u; index < words; ++index)
      fxWords.data()[index] = modulation(offset + index);
    if (!plan.assign(
            {fxWords.data(), words}, layout.regions, extent, 16u,
            [&](std::uint32_t id) {
              for (auto index = 0u; index < curves; ++index)
                if (modulation(curveOffset + index * schema::kCurveWords) == id)
                  return true;
              return false;
            },
            streamed))
      return ET_ERR_ARGS;
    if (!EffectBuses::outputAvailable(fxWords.data()[9] - 1u, actualChannels))
      return ET_ERR_UNSUPPORTED;
    if (streamed)
      for (auto index = 0u; index < plan.impulseCount(); ++index) {
        const auto ir = plan.impulse(index);
        const auto record =
            layout.sampleOffset + ir.sampleOffsetOrId * (layout.loading ? 16u : 12u);
        const auto frames =
            header(record) | (static_cast<std::uint64_t>(header(record + 1u)) << 32u);
        if (frames != ir.frames || header(record + 2u) != ir.channels ||
            header(record + 3u) != ir.rate)
          return ET_ERR_UNSUPPORTED;
      }
    return ET_OK;
  }
  struct ProcessingStorageRequirements {
    CombStorageRequirements comb{};
    std::uint64_t effects = 0, sf2 = 0, bytes = 0;
  };
  static et_status processingStorageRequirements(const PrepareInfo &preparation,
                                                 std::uint32_t actualChannels,
                                                 std::uint32_t combMask, const EffectPlan &plan,
                                                 std::uint32_t fxWords, bool streamed, bool sf2,
                                                 ProcessingStorageRequirements &storage,
                                                 std::uint32_t voices = 128u) noexcept {
    storage = {};
    if (!actualChannels || actualChannels > 16u || actualChannels > preparation.maxChannels ||
        !std::isfinite(preparation.minimumPhysicalBpm) || preparation.minimumPhysicalBpm < 0 ||
        !combStorageRequirements(preparation, combMask, storage.comb, voices))
      return ET_ERR_ARGS;
    if (sf2) {
      storage.sf2 = sf2::Effects::storageBytes(preparation);
      if (!storage.sf2)
        return ET_ERR_ARGS;
    } else if (fxWords) {
      const auto events = effectControllerEvents(preparation);
      if (!events || !effectPreparationBytes(plan, preparation, actualChannels, streamed, events,
                                             fxWords, storage.effects))
        return ET_ERR_UNSUPPORTED;
    }
    const auto extra = storage.effects + storage.sf2;
    if (extra > UINT64_MAX - storage.comb.bytes)
      return ET_ERR_OOM;
    storage.bytes = storage.comb.bytes + extra;
    return ET_OK;
  }
  static et_status estimateProcessing(const PrepareInfo &preparation, const AssetBeginInfo &info,
                                      std::span<const std::uint8_t> control, std::uint32_t format,
                                      std::uint64_t &bytes, std::uint32_t voices = 128u) noexcept {
    bytes = 0;
    ControlLayout layout;
    const auto valid = controlLayout(info, control, format, layout);
    if (valid != ET_OK)
      return valid;
    EffectPlan plan;
    NothrowStorage<std::uint32_t> words;
    bool streamed = false;
    const auto assigned =
        assignEffectPlan(info, control, format, info.processingChannels, plan, words, streamed);
    if (assigned != ET_OK)
      return assigned;
    ModulationBank modulation;
    bool typed = false;
    if (!layout.sf2 && layout.modWords) {
      const auto *section = control.data() + 32u + static_cast<std::size_t>(layout.modOffset) * 4u;
      const auto version = readU32(section + 4u);
      if (version == schema::kVersion || version == 4u) {
        typed = true;
        NothrowStorage<float> aligned;
        if (!aligned.allocate(layout.modWords))
          return ET_ERR_OOM;
        std::memcpy(aligned.data(), section, static_cast<std::size_t>(layout.modWords) * 4u);
        const auto loaded =
            modulation.load(aligned.data(), layout.modWords, layout.regions, UINT64_MAX,
                            kModulationKinds, supportsModulationProperty, voices);
        if (loaded != ET_OK)
          return loaded;
      }
    }
    ProcessingStorageRequirements storage;
    const auto status = processingStorageRequirements(
        preparation, info.processingChannels, modulation.combMask, plan,
        static_cast<std::uint32_t>(words.size()), streamed, layout.sf2, storage, voices);
    if (status != ET_OK)
      return status;
    const auto header = [&](std::uint32_t index) {
      return readU32(control.data() + 32u + static_cast<std::size_t>(index) * 4u);
    };
    const auto headerWords = layout.sf2        ? kSf2Header
                             : layout.loading  ? kLoadStreamHeader
                             : layout.streamed ? kStreamHeader
                                               : kHeader;
    std::uint64_t indexWords = 0;
    if (!indexStorageWords(
            layout.regions, header(6),
            [&](std::uint32_t region, std::uint32_t lane) {
              return std::bit_cast<float>(header(headerWords + region * kStride + lane));
            },
            indexWords))
      return ET_ERR_ARGS;
    std::uint32_t scratch = 0;
    if (layout.sf2 &&
        !sf2ScratchWords(
            layout.regions, layout.modWords,
            [&](std::uint32_t index) { return header(layout.modOffset + index); }, scratch))
      return ET_ERR_ARGS;
    bytes = storage.bytes + layout.cacheBytes + baseObjectStorage(layout.streamed) +
            scriptStorage(header(9)) + indexWords * 4u + static_cast<std::uint64_t>(scratch) * 4u;
    if (typed)
      bytes += modulationStorage(modulation) +
               timerStorage(modulation, layout.regions, header(6)) * 2u * sizeof(std::uint64_t);
    return status;
  }
  static std::uint64_t baseObjectStorage(bool streamed) noexcept {
    // Request storage is inline in Bank but already belongs to cache geometry.
    return sizeof(SFZBank) -
           (streamed ? SamplePageCache::kMaxRequests * sizeof(SamplePageRequest) : 0u);
  }
  static std::uint64_t scriptStorage(std::uint32_t scriptBytes) noexcept {
    return scriptBytes ? sizeof(script::Program) + sizeof(ScriptSession) : 0u;
  }
  static std::uint64_t modulationStorage(const ModulationBank &modulation) noexcept {
    return sizeof(ModulationBank) + modulation.footprint;
  }
  static std::uint64_t timerStorage(const ModulationBank &modulation, std::uint32_t regions,
                                    std::uint32_t groups) noexcept {
    for (auto region = 0u; region < regions; ++region)
      if (modulation.plan(region).timerInstance != UINT32_MAX)
        return static_cast<std::uint64_t>(groups) * 16u;
    return 0u;
  }
  template <class RegionValue>
  static bool indexStorageWords(std::uint32_t regions, std::uint32_t groups, RegionValue value,
                                std::uint64_t &words) noexcept {
    words = 129u + 2u * groups;
    for (auto region = 0u; region < regions; ++region) {
      const auto low = value(region, LowKey), high = value(region, HighKey);
      if (!integer(low, 0, 127) || !integer(high, 0, 127) || low > high)
        return false;
      words += static_cast<std::uint32_t>(high - low) + 1u;
    }
    return true;
  }
  template <class Word>
  static bool sf2ScratchWords(std::uint32_t regions, std::uint32_t words, Word word,
                              std::uint32_t &maximum) noexcept {
    maximum = 0;
    if (words < 10ull + static_cast<std::uint64_t>(regions) * 4u)
      return false;
    for (auto region = 0u; region < regions; ++region) {
      const auto count = word(11u + region * 4u);
      if (count > 65536u)
        return false;
      maximum = std::max(maximum, count);
    }
    return true;
  }
  static et_status estimateSfzEffects(const PrepareInfo &preparation, const AssetBeginInfo &info,
                                      const std::uint8_t *payload, std::uint32_t format,
                                      std::uint64_t &bytes) noexcept {
    return estimateProcessing(preparation, info, {payload, info.byteSize}, format, bytes);
  }

  std::unique_ptr<script::Program> scriptProgram_;
  static constexpr bool kModulationRenderingSupported = true;
  static constexpr std::uint32_t kModulationKinds = (1u << 31u) - 1u;
  static bool supportsModulationProperty(std::uint32_t kind, std::uint32_t property) noexcept {
    using P = schema::Property;
    return kind != 0u || property <= static_cast<std::uint32_t>(P::SwitchOffset) ||
           property == static_cast<std::uint32_t>(P::ScopeTune) ||
           property == static_cast<std::uint32_t>(P::ScopeVolume) ||
           property == static_cast<std::uint32_t>(P::ScopeAmplitude) ||
           property == static_cast<std::uint32_t>(P::NoteEnabled) ||
           property == static_cast<std::uint32_t>(P::SilentAction);
  }
  std::unique_ptr<ModulationBank> modulation_;
  NothrowStorage<std::uint64_t> timer_frames_;
  std::uint64_t sfz_effect_budget_bytes_ = 0;
  KeyswitchMap keyswitches_;
  NothrowStorage<float> comb_samples_;
  NothrowStorage<CombWrite> comb_writes_;
  NothrowStorage<CombJournal> comb_journals_;
  std::uint32_t comb_frames_ = 0, comb_stages_ = 0;
  bool modulation_prepared_ = false, modulation_trial_ = false;
  std::unique_ptr<ScriptSession> scriptSession_;
  std::uint64_t fingerprint_ = 1469598103934665603ull;
  NothrowStorage<float> payload_;
  NothrowStorage<float> sf2_scratch_;
  std::unique_ptr<sf2::Effects> sf2_effects_;
  std::unique_ptr<EffectPlan> sfz_effect_plan_;
  std::unique_ptr<EffectRuntime> sfz_effects_;
  NothrowStorage<std::uint32_t> sfz_effect_words_;
  NothrowStorage<float> sfz_effect_impulses_, sfz_effect_sources_;
  NothrowStorage<EffectImpulse> sfz_effect_ir_;
  std::uint32_t sfz_effect_channels_ = 0, sfz_effect_frames_ = 0, sfz_effect_events_ = 0;
  float sfz_effect_rate_ = 0, sfz_effect_minimum_bpm_ = 0;
  PrepareInfo processing_info_{};
  bool processing_context_set_ = false, sfz_effect_required_ = false, sfz_effect_ready_ = true;

  NothrowStorage<std::uint32_t> indices_;
  NothrowStorage<SampleMetadata> sample_metadata_;
  NothrowStorage<std::uint8_t> sample_storage_modes_;
  SamplePageCache cache_;
  bool streamed_ = false, sf2_ = false, loading_ = false;
  std::uint32_t cache_slots16_ = 0, resident_offset_ = 0, resident_count_ = 0,
                resident_interval_ = 0;
  std::uint64_t resident_page_ = UINT64_MAX;
  std::uint32_t trigger_mask_ = 0;
  std::array<std::uint64_t, 2> start_controllers_{};
  std::uint32_t header_words_ = kHeader, version_ = kVersion, sample_count_ = 0, cache_slots_ = 0,
                modulation_offset_ = 0, modulation_words_ = 0, control_end_ = 0, preset_offset_ = 0,
                preset_count_ = 0;
  AssetBeginInfo begin_{};
  std::array<std::uint32_t, 128> key_cursors_{};
  std::uint32_t state_ = ET_ASSET_STATE_NONE, region_count_ = 0u, group_count_ = 0u,
                pool_offset_ = 0u, preparation_ = 0u, cursor_ = 0u;

  et_status allocate(const AssetBeginInfo &info) noexcept {
    if (info.channels != 1u || info.topology != 0u || info.byteSize < 32u + kHeader * 4u ||
        info.byteSize % 4u != 0u ||
        static_cast<std::uint64_t>(info.footprintBytes) <
            static_cast<std::uint64_t>(info.byteSize) + 129u * 4u ||
        info.footprintBytes > kCapacity ||
        static_cast<std::uint64_t>(info.frames) * 4u + 32u != info.byteSize)
      return ET_ERR_ARGS;
    if (!payload_.allocate(info.byteSize / 4u))
      return ET_ERR_OOM;
    begin_ = info;
    state_ = ET_ASSET_STATE_STAGED;
    return ET_OK;
  }
  et_status commit(std::uint32_t bytes, std::uint32_t format) noexcept {
    if (state_ != ET_ASSET_STATE_STAGED || bytes != begin_.byteSize ||
        format != ET_ASSET_F32_MULTICH)
      return failAsset();
    const auto *raw = reinterpret_cast<const std::uint8_t *>(payload_.data());
    const auto header = [raw](std::uint32_t index) { return readU32(raw + 32u + index * 4u); };
    version_ = header(1);
    sf2_ = version_ == kSf2Version;
    loading_ = version_ == kLoadStreamVersion;
    streamed_ = version_ == kStreamVersion || sf2_ || loading_;
    header_words_ = sf2_        ? kSf2Header
                    : loading_  ? kLoadStreamHeader
                    : streamed_ ? kStreamHeader
                                : kHeader;
    if ((version_ != kVersion && version_ != kModulationVersion && !streamed_) ||
        begin_.frames < header_words_)
      return failAsset();
    if (readU32(raw) != 0x31415445u || readU32(raw + 4u) != 1u ||
        readU32(raw + 8u) != begin_.frames || readU32(raw + 12u) != 1u ||
        readU32(raw + 16u) != 0u || readU32(raw + 20u) != 0u || header(0) != kMagic ||
        header(2) == 0u || header(2) > begin_.frames / kStride || header(3) != kStride ||
        header(4) > begin_.frames || header(7) > header(8) || header(7) % 2u != 0u ||
        header(8) - header(7) != header_words_ + kStride * header(2) || header(9) % 4u != 0u ||
        header(5) != begin_.frames || header(6) == 0u || header(6) > header(2))
      return failAsset();
    const auto scriptEnd = static_cast<std::uint64_t>(header(8)) + header(9) / 4u;
    if (scriptEnd > header(4) || (version_ == kVersion && (header(10) || header(11))) ||
        (!header(11) && header(10)) || (header(11) && header(10) != scriptEnd))
      return failAsset();
    const auto sectionEnd = scriptEnd + header(11);
    std::uint64_t cacheBytes = baseObjectStorage(streamed_) + scriptStorage(header(9));
    if (streamed_) {
      ControlLayout layout;
      if (controlLayout(begin_, {raw, bytes}, format, layout) != ET_OK)
        return failAsset();
      sample_count_ = layout.sampleCount;
      cache_slots_ = header(14);
      cache_slots16_ = layout.slots16;
      resident_offset_ = layout.residentOffset;
      resident_count_ = layout.residentCount;
      if (sf2_) {
        preset_offset_ = header(16);
        preset_count_ = header(17);
        if (!validPresets(header(2)))
          return failAsset();
      }
      if (!sample_metadata_.allocate(sample_count_) ||
          (loading_ && !sample_storage_modes_.allocate(sample_count_)))
        return ET_ERR_OOM;
      for (auto index = 0u; index < sample_count_; ++index) {
        const auto record = header(12) + index * (loading_ ? 16u : 12u);
        const auto frames = header(record) | static_cast<std::uint64_t>(header(record + 1u)) << 32u;
        sample_metadata_.data()[index] = {frames, header(record + 2u), header(record + 3u)};
        if (loading_)
          sample_storage_modes_.data()[index] = static_cast<std::uint8_t>(header(record + 12u));
      }
      cacheBytes += layout.cacheBytes;
      if (cacheBytes + begin_.byteSize + 129u * 4u > begin_.footprintBytes)
        return failAsset();
    } else if (sectionEnd != header(4))
      return failAsset();
    modulation_offset_ = header(10);
    modulation_words_ = header(11);
    control_end_ = header(8);
    const auto modulationVersion =
        modulation_words_ >= 2u && header(10) < begin_.frames
            ? std::bit_cast<std::uint32_t>(payload_.data()[8u + header(10) + 1u])
            : 0u;
    const bool typedModulation = !sf2_ && modulation_words_ >= schema::kHeaderWords &&
                                 header(10) < begin_.frames &&
                                 (modulationVersion == schema::kVersion || modulationVersion == 4u);
    sfz_effect_required_ = typedModulation && modulationVersion == 4u;
    sfz_effect_ready_ = !sfz_effect_required_;
    if (typedModulation) {
      modulation_.reset(new (std::nothrow) ModulationBank());
      if (!modulation_)
        return ET_ERR_OOM;
      const auto used = cacheBytes + begin_.byteSize + 129u * 4u;
      if (used > begin_.footprintBytes)
        return failAsset();
      const auto result =
          modulation_->load(payload_.data() + 8u + modulation_offset_, modulation_words_, header(2),
                            begin_.footprintBytes - used, kModulationKinds,
                            supportsModulationProperty, voice_capacity_);
      if (result != ET_OK)
        return result == ET_ERR_OOM ? result : failAsset();
      cacheBytes += modulationStorage(*modulation_);
      if (const auto count = timerStorage(*modulation_, header(2), header(6))) {
        const auto timerBytes = count * sizeof(std::uint64_t);
        if (cacheBytes + 2u * timerBytes + begin_.byteSize + 129u * 4u > begin_.footprintBytes)
          return ET_ERR_OOM;
        if (!timer_frames_.allocate(static_cast<std::size_t>(count)))
          return ET_ERR_OOM;
        std::fill_n(timer_frames_.data(), timer_frames_.size(), UINT64_MAX);
        cacheBytes += 2u * timerBytes;
      }
      if (!kModulationRenderingSupported)
        return failAsset();
    }
    if ((sf2_ && (!modulation_words_ || !validSf2Modulation(header(2)))) ||
        (!sf2_ && modulation_words_ && !typedModulation && !validModulation(header(2))))
      return failAsset();
    if (sf2_) {
      const auto *modulation = payload_.data() + 8u + modulation_offset_;
      std::uint32_t maximumRoutes = 0;
      if (!sf2ScratchWords(
              header(2), modulation_words_,
              [modulation](std::uint32_t index) {
                return std::bit_cast<std::uint32_t>(modulation[index]);
              },
              maximumRoutes))
        return failAsset();
      cacheBytes += static_cast<std::uint64_t>(maximumRoutes) * sizeof(float);
      if (cacheBytes + begin_.byteSize + 129u * 4u > begin_.footprintBytes)
        return failAsset();
      if (!sf2_scratch_.allocate(maximumRoutes))
        return ET_ERR_OOM;
      if (!kSf2RenderingSupported)
        return failAsset();
    }
    std::uint64_t indexWords = 0;
    if (!indexStorageWords(
            header(2), header(6),
            [&](std::uint32_t index, std::uint32_t lane) { return region(index)[lane]; },
            indexWords))
      return failAsset();
    if (begin_.byteSize + cacheBytes + indexWords * 4u > begin_.footprintBytes)
      return ET_ERR_OOM;
    sfz_effect_budget_bytes_ =
        begin_.footprintBytes - begin_.byteSize - cacheBytes - indexWords * 4u;
    if (!indices_.allocate(static_cast<std::size_t>(indexWords)))
      return ET_ERR_OOM;
    if (header(9)) {
      scriptProgram_ = std::unique_ptr<script::Program>(new (std::nothrow) script::Program());
      if (!scriptProgram_)
        return ET_ERR_OOM;
      if (!scriptProgram_->load(raw + 32u + 4u * header(8), header(9)))
        return failAsset();
      scriptSession_ = std::unique_ptr<ScriptSession>(new (std::nothrow) ScriptSession());
      if (!scriptSession_)
        return ET_ERR_OOM;
    }
    region_count_ = header(2);
    pool_offset_ = header(4);
    group_count_ = header(6);
    if (indices_.size() < 129u + 2u * group_count_)
      return failAsset();
    std::fill_n(indices_.data(), 129u + 2u * group_count_, 0u);
    state_ = ET_ASSET_STATE_PREPARING;
    return ET_OK;
  }
  et_status failAsset() noexcept {
    state_ = ET_ASSET_STATE_ERROR;
    return ET_ERR_ARGS;
  }
  const float *region(std::uint32_t index) const noexcept {
    return payload_.data() + 8u + header_words_ + static_cast<std::size_t>(index) * kStride;
  }
  bool noteEnabled(std::uint32_t index) const noexcept {
    return !modulation_ || modulation_->plan(index).noteEnabled;
  }
  bool silentRegion(std::uint32_t index) const noexcept {
    return modulation_ && modulation_->plan(index).silentAction;
  }
  std::uint32_t presetWord(std::uint32_t index, std::uint32_t lane) const noexcept {
    return std::bit_cast<std::uint32_t>(payload_.data()[8u + preset_offset_ + index * 4u + lane]);
  }
  std::uint32_t findPreset(std::uint32_t bank, std::uint32_t program) const noexcept {
    if (bank > 128u || program > 127u)
      return UINT32_MAX;
    for (auto index = 0u; index < preset_count_; ++index)
      if (presetWord(index, 0) == bank && presetWord(index, 1) == program)
        return index;
    return UINT32_MAX;
  }
  std::uint32_t presetForRegion(std::uint32_t regionIndex) const noexcept {
    auto low = 0u, high = preset_count_;
    while (low < high) {
      const auto middle = low + (high - low) / 2u;
      if (presetWord(middle, 2) + presetWord(middle, 3) <= regionIndex)
        low = middle + 1u;
      else
        high = middle;
    }
    return low < preset_count_ && presetWord(low, 2) <= regionIndex ? low : UINT32_MAX;
  }
  bool validPresets(std::uint32_t regionCount) const noexcept {
    std::uint32_t next = 0;
    for (auto index = 0u; index < preset_count_; ++index) {
      const auto first = presetWord(index, 2), count = presetWord(index, 3);
      if (presetWord(index, 0) > 65535u || presetWord(index, 1) > 65535u || first != next ||
          count > regionCount - next)
        return false;
      next += count;
    }
    return next == regionCount;
  }
  const float *sf2Generators(std::uint32_t regionIndex) const noexcept {
    const auto *data = payload_.data() + 8u + modulation_offset_;
    const auto directory = std::bit_cast<std::uint32_t>(data[5]);
    const auto generators = std::bit_cast<std::uint32_t>(data[8]);
    return data + generators +
           std::bit_cast<std::uint32_t>(data[directory + regionIndex * 4u + 2u]);
  }
  struct Preset {
    std::uint32_t bank, program, firstRegion, regionCount;
  };
  Preset preset(std::uint32_t index) const noexcept {
    return {presetWord(index, 0), presetWord(index, 1), presetWord(index, 2), presetWord(index, 3)};
  }
  static bool validSf2Source(std::uint32_t source) noexcept {
    if ((source >> 10u) > 3u)
      return false;
    const auto index = source & 127u;
    if (source & 128u)
      return index < 120u && !(index >= 33u && index <= 63u) && index != 0u && index != 6u &&
             index != 32u && index != 98u && index != 99u && index != 100u && index != 101u;
    return index == 0u || index == 2u || index == 3u || index == 10u || index == 13u ||
           index == 14u || index == 16u;
  }
  // Matches SF2_MAX_ROUTES in js/sf2/modulation.js.
  static constexpr std::uint32_t kMaxSf2Routes = 4194304u;
  bool validSf2Modulation(std::uint32_t regionCount) const noexcept {
    if (modulation_words_ < 10u)
      return false;
    const auto *data = payload_.data() + 8u + modulation_offset_;
    const auto word = [data](std::uint32_t index) {
      return std::bit_cast<std::uint32_t>(data[index]);
    };
    const auto routes = word(3), records = word(6), generators = word(8);
    if (word(0) != 0x31525453u || word(1) != 2u || word(2) != regionCount || word(4) != 0u ||
        word(5) != 10u || routes > kMaxSf2Routes ||
        records != 10u + static_cast<std::uint64_t>(regionCount) * 4u ||
        generators != records + static_cast<std::uint64_t>(routes) * 10u || word(7) != generators ||
        word(9) != static_cast<std::uint64_t>(regionCount) * 61u ||
        generators + static_cast<std::uint64_t>(word(9)) != modulation_words_)
      return false;
    for (auto index = 0u; index < word(9); ++index)
      if (!std::isfinite(data[generators + index]))
        return false;
    std::uint32_t next = 0u;
    for (auto regionIndex = 0u; regionIndex < regionCount; ++regionIndex) {
      const auto directory = 10u + regionIndex * 4u;
      const auto first = word(directory), count = word(directory + 1u);
      if (first != next || count > 65536u || count > routes - next ||
          word(directory + 2u) != regionIndex * 61u || word(directory + 3u) != 61u)
        return false;
      for (auto index = 0u; index < count; ++index) {
        const auto offset = records + (first + index) * 10u;
        const auto target = word(offset), source = word(offset + 1u), flags = word(offset + 8u);
        const bool linkedSource = (source & 0xffff0000u) == 0x20000u;
        if (!std::isfinite(data[offset + 3u]) || word(offset + 4u) || word(offset + 5u) ||
            word(offset + 6u) || word(offset + 7u) ||
            (word(offset + 9u) != 0u && word(offset + 9u) != 2u) ||
            !validSf2Source(word(offset + 2u)))
          return false;
        if (linkedSource
                ? (source & 65535u) != index || (flags & 255u) != 127u || (flags >> 10u) > 3u
                : !validSf2Source(source) || flags != 0u)
          return false;
        if ((target & 0xffff0000u) == 0x20000u) {
          const auto receiver = target & 65535u;
          // Topological ordering makes every linked bus local and acyclic.
          if (receiver <= index || receiver >= count ||
              word(records + (first + receiver) * 10u + 1u) != (0x20000u | receiver))
            return false;
        } else {
          if ((target & 0xffff0000u) != 0x10000u)
            return false;
          const auto generator = target & 65535u;
          if (generator > 60u || generator == 14u || generator == 18u || generator == 19u ||
              generator == 20u || generator == 41u || generator == 42u || generator == 43u ||
              generator == 44u || generator == 46u || generator == 47u || generator == 49u ||
              generator == 53u || generator == 54u || generator == 55u || generator == 56u ||
              generator == 57u || generator == 58u || generator == 59u)
            return false;
        }
      }
      next += count;
    }
    return next == routes;
  }
  et_status configureSampleStream(std::uint64_t generation) noexcept override {
    if (!streamed_ || !generation ||
        (state_ != ET_ASSET_STATE_PREPARING && state_ != ET_ASSET_STATE_ACTIVE))
      return ET_ERR_STATE;
    if (cache_.generation())
      return cache_.generation() == generation ? ET_OK : ET_ERR_STATE;
    if (!cache_.configure(generation, sample_metadata_.data(), sample_count_, cache_slots_,
                          cache_slots16_, loading_ ? sample_storage_modes_.data() : nullptr))
      return ET_ERR_OOM;
    if (sf2_ || loading_)
      prepareSlice(std::numeric_limits<std::uint64_t>::max());
    return state_ == ET_ASSET_STATE_ERROR ? ET_ERR_ARGS : ET_OK;
  }
  bool sampleStreamReady() const noexcept override {
    return !streamed_ || state_ == ET_ASSET_STATE_ACTIVE;
  }
  et_status takeSampleRequests(et_sfz_sample_request *output, std::uint32_t capacity,
                               std::uint32_t &count) noexcept {
    count = 0;
    if (!cache_.generation() ||
        (state_ != ET_ASSET_STATE_PREPARING && state_ != ET_ASSET_STATE_ACTIVE))
      return ET_ERR_STATE;
    if (capacity > SamplePageCache::kMaxRequests || (capacity && !output))
      return ET_ERR_ARGS;
    if (cache_.requestOverflow())
      return ET_ERR_OOM;
    std::array<SamplePageRequest, 64> batch{};
    while (count < capacity) {
      const auto taken =
          cache_.takeRequests(batch.data(), std::min<std::size_t>(batch.size(), capacity - count));
      for (std::size_t index = 0; index < taken; ++index) {
        const auto &request = batch[index];
        output[count++] = {static_cast<std::uint32_t>(request.generation),
                           static_cast<std::uint32_t>(request.generation >> 32u),
                           static_cast<std::uint32_t>(request.page),
                           static_cast<std::uint32_t>(request.page >> 32u),
                           request.sample,
                           0u};
      }
      if (!taken)
        break;
    }
    return ET_OK;
  }
  et_status publishSamplePage(std::uint64_t generation, std::uint32_t sample, std::uint64_t page,
                              const float *pcm, std::uint32_t frames, std::uint32_t channels,
                              std::uint32_t flags) noexcept override {
    if (!generation || generation != cache_.generation())
      return ET_ERR_STATE;
    if (flags & ~1u)
      return ET_ERR_ARGS;
    if (!cache_.publish({generation, page, sample}, pcm, frames, channels, (flags & 1u) != 0u))
      return ET_ERR_ARGS;
    if (sfz_effect_required_ && !sfz_effect_ready_ && processing_context_set_) {
      const auto prepared =
          prepareSfzEffects(processing_info_, begin_.processingChannels,
                            static_cast<float>(processing_info_.minimumPhysicalBpm),
                            effectControllerEvents(processing_info_));
      if (prepared != ET_OK && prepared != ET_NEED_SAMPLE)
        return failAsset();
      sfz_effect_ready_ = prepared == ET_OK;
    }
    prepareSlice(std::numeric_limits<std::uint64_t>::max());
    return state_ == ET_ASSET_STATE_ERROR ? ET_ERR_ARGS : ET_OK;
  }
  bool validModulation(std::uint32_t regionCount) const noexcept {
    if (modulation_words_ < 8u)
      return false;
    const auto *data = payload_.data() + 8u + modulation_offset_;
    const auto word = [data](std::uint32_t index) {
      return std::bit_cast<std::uint32_t>(data[index]);
    };
    const auto routes = word(3), curves = word(4), records = word(6), curveOffset = word(7);
    // The section is structurally versioned, but route evaluation must be
    // implemented before accepting a bank that depends on those routes.
    if (routes != 0u)
      return false;
    if (word(0) != 0x31525453u || word(1) != 1u || word(2) != regionCount || word(5) != 8u ||
        records != 8u + static_cast<std::uint64_t>(regionCount) * 2u || curves > 248u ||
        curveOffset != records + static_cast<std::uint64_t>(routes) * 8u ||
        curveOffset + static_cast<std::uint64_t>(curves) * 129u != modulation_words_)
      return false;
    std::uint32_t previousCurve = 6u;
    for (auto index = 0u; index < curves; ++index) {
      const auto offset = curveOffset + index * 129u, id = word(offset);
      if (id <= previousCurve || id > 254u)
        return false;
      previousCurve = id;
      for (auto point = 1u; point <= 128u; ++point)
        if (!std::isfinite(data[offset + point]))
          return false;
    }
    std::uint32_t next = 0u;
    for (auto regionIndex = 0u; regionIndex < regionCount; ++regionIndex) {
      const auto first = word(8u + regionIndex * 2u), count = word(9u + regionIndex * 2u);
      if (first != next || count > 26u * 138u || static_cast<std::uint64_t>(first) + count > routes)
        return false;
      std::uint32_t previous = 0u;
      for (auto index = 0u; index < count; ++index) {
        const auto offset = records + (first + index) * 8u;
        const auto target = word(offset), source = word(offset + 1u), curve = word(offset + 3u),
                   id = target * 512u + source;
        if (target < VolumeCC || target >= ControllerFamilyCount || target == OnLowCC ||
            target == OnHighCC || source > 137u || (index && id <= previous) ||
            !std::isfinite(data[offset + 2u]) || !std::isfinite(data[offset + 4u]) ||
            data[offset + 4u] < 0.0F || !std::isfinite(data[offset + 5u]) ||
            data[offset + 5u] < 0.0F || word(offset + 6u) || word(offset + 7u))
          return false;
        previous = id;
        bool curveValid = curve <= 3u;
        for (auto item = 0u; !curveValid && item < curves; ++item)
          curveValid = word(curveOffset + item * 129u) == curve;
        if (!curveValid)
          return false;
        const float depth = data[offset + 2u];
        if (target >= AmpDelayCC && target <= AmpReleaseCC) {
          if (std::abs(depth) > 100.0F)
            return false;
        } else if (target >= EQ1FrequencyCC) {
          const auto lane = (target - EQ1FrequencyCC) % 3u;
          if (lane == 0u   ? std::abs(depth) > 30000.0F
              : lane == 1u ? std::abs(depth) > 4.0F
                           : depth < -96.0F || depth > 24.0F)
            return false;
        } else if (std::abs(depth) > 12000.0F)
          return false;
      }
      next += count;
    }
    return next == routes;
  }
  // Controllers that can start a region; other CC messages skip the region search.
  bool startController(std::uint32_t cc) const noexcept {
    return start_controllers_[cc >> 6u] & (std::uint64_t{1} << (cc & 63u));
  }
  void addStartController(std::uint32_t cc) noexcept {
    if (cc < 128u)
      start_controllers_[cc >> 6u] |= std::uint64_t{1} << (cc & 63u);
  }
  void addStartControllers(const float *r, std::uint32_t index) noexcept {
    const auto count = indexValue(r, ControlCount), offset = indexValue(r, ControlOffset);
    for (auto i = 0u; i < count; ++i) {
      const auto id = std::bit_cast<std::uint32_t>(payload_.data()[8u + offset + i * 2u]);
      if (id / 512u == OnLowCC || id / 512u == OnHighCC)
        addStartController(id % 512u);
    }
    if (modulation_) {
      const auto view = modulation_->region(index);
      for (const auto node : modulation_->plan(index).conditions[1])
        addStartController(view.instances[node].authoredIndex);
    }
  }
  // MIDI controller values are 7-bit, so only authored LowCC/HighCC entries can reject a region.
  // Entries are sorted by family * 512 + cc, which places those two families first.
  bool controllerRangesMatch(const float *r,
                             const std::array<std::uint8_t, 128> &cc) const noexcept {
    const auto count = indexValue(r, ControlCount), offset = indexValue(r, ControlOffset);
    const auto *entry = payload_.data() + 8u + offset;
    for (auto i = 0u; i < count; ++i, entry += 2) {
      const auto id = std::bit_cast<std::uint32_t>(entry[0]);
      if (id >= 2u * 512u)
        break;
      const auto value = static_cast<float>(cc[id % 512u]);
      if (id < 512u ? value < entry[1] : value > entry[1])
        return false;
    }
    return true;
  }
  float controller(const float *r, std::uint32_t family, std::uint32_t cc) const noexcept {
    const auto count = indexValue(r, ControlCount), offset = indexValue(r, ControlOffset);
    const auto wanted = family * 512u + cc;
    auto low = 0u, high = count;
    while (low < high) {
      const auto middle = low + (high - low) / 2u;
      const auto *entry = payload_.data() + 8u + offset + middle * 2u;
      const auto id = std::bit_cast<std::uint32_t>(entry[0]);
      if (id < wanted)
        low = middle + 1u;
      else
        high = middle;
    }
    if (low < count) {
      const auto *entry = payload_.data() + 8u + offset + low * 2u;
      if (std::bit_cast<std::uint32_t>(entry[0]) == wanted)
        return entry[1];
    }
    return controllerDefault(family);
  }
  bool validRegion(const float *r) noexcept {
    for (auto i = 0u; i < kStride; ++i)
      if (!isIndexField(i) && !std::isfinite(r[i]))
        return false;
    const auto sample = indexValue(r, Sample), frames = indexValue(r, Frames),
               offset = indexValue(r, Offset), end = indexValue(r, End),
               loopStart = indexValue(r, LoopStart), loopEnd = indexValue(r, LoopEnd);
    if (!frames || !integer(r[Channels], 1u, 2u) || !integer(r[Rate], 1u, 768000u))
      return false;
    if (streamed_) {
      if (sample >= sample_count_)
        return false;
      const auto &metadata = sample_metadata_.data()[sample];
      if (frames != metadata.frames ||
          static_cast<std::uint32_t>(r[Channels]) != metadata.channels ||
          static_cast<std::uint32_t>(r[Rate]) != metadata.rate)
        return false;
    } else if (sample > begin_.frames - pool_offset_ || frames > begin_.frames ||
               sample + static_cast<std::uint64_t>(frames) *
                            static_cast<std::uint32_t>(r[Channels]) >
                   begin_.frames - pool_offset_)
      return false;
    if (!integer(r[LowKey], 0u, 127u) ||
        !integer(r[HighKey], static_cast<std::uint32_t>(r[LowKey]), 127u) ||
        !integer(r[LowVelocity], sf2_ ? 0u : 1u, 127u) ||
        !integer(r[HighVelocity], static_cast<std::uint32_t>(r[LowVelocity]), 127u) ||
        r[LowRandom] < 0 || r[HighRandom] > 1 || r[LowRandom] > r[HighRandom] ||
        !integer(r[SequenceLength], 1u, 16777216u) ||
        !integer(r[SequencePosition], 1u, static_cast<std::uint32_t>(r[SequenceLength])) ||
        !integer(r[SequenceGroup], 0u, group_count_ - 1u) || !integer(r[KeyCenter], 0u, 127u) ||
        offset > end || end >= frames || !integer(r[LoopMode], 0u, 3u) || loopStart > loopEnd ||
        loopEnd > end || r[Attack] < 0 || r[Attack] > 100 || r[Hold] < 0 || r[Hold] > 100 ||
        r[Decay] < 0 || r[Decay] > 100 || r[Release] < 0 || r[Release] > 100 || r[Sustain] < 0 ||
        r[Sustain] > 100 || r[Pan] < -100 || r[Pan] > 100 || r[VelocityTrack] < -100 ||
        r[VelocityTrack] > 100 || r[Volume] < -144 || r[Volume] > 144 || r[KeyTrack] < -1200 ||
        r[KeyTrack] > 1200 || r[Transpose] < -127 || r[Transpose] > 127 ||
        std::floor(r[Transpose]) != r[Transpose] || r[Tune] < -1200 || r[Tune] > 1200)
      return false;
    if (!integer(r[Trigger], 0u, 4u) || !integer(r[LowChannel], 1u, 16u) ||
        !integer(r[HighChannel], 1u, 16u) || r[LowChannel] > r[HighChannel] || r[LowBend] < -8192 ||
        r[HighBend] > 8192 || r[LowBend] > r[HighBend] ||
        !integer(r[LowChannelAftertouch], 0u, 127u) ||
        !integer(r[HighChannelAftertouch], 0u, 127u) || !integer(r[LowPolyAftertouch], 0u, 127u) ||
        !integer(r[HighPolyAftertouch], 0u, 127u) || !integer(r[LowProgram], 0u, 127u) ||
        !integer(r[HighProgram], 0u, 127u) || !integer(r[Polyphony], 0u, 16777216u) ||
        !integer(r[NotePolyphony], 0u, 16777216u) || !integer(r[OffMode], 0u, 2u) ||
        !integer(r[FilterType], 0u, modulation_ ? 23u : 6u) || r[OffTime] < 0 || r[OffTime] > 100 ||
        r[Delay] < 0 || r[Delay] > 100 || r[DelayRandom] < 0 || r[DelayRandom] > 100 ||
        r[AmpDelay] < 0 || r[AmpDelay] > 100 || r[AmpStart] < 0 || r[AmpStart] > 100)
      return false;
    for (auto field = static_cast<unsigned>(SwitchLow); field <= SwitchDefault; ++field)
      if (r[field] != -1.0F && !integer(r[field], 0u, 127u))
        return false;
    if (r[SwitchLow] >= 0 && r[SwitchHigh] >= 0 && r[SwitchLow] > r[SwitchHigh])
      return false;
    if (!integer(r[Direction], 0u, 1u) || r[LoopCount] < -1 || r[LoopCount] > 16777216 ||
        std::floor(r[LoopCount]) != r[LoopCount] || r[LoopCrossfade] < 0 || r[LoopCrossfade] > 100)
      return false;
    if (!integer(r[AmpDynamic], 0u, 1u))
      return false;
    for (auto first : {EQ1Frequency, EQ2Frequency, EQ3Frequency})
      if (r[first] < 0 || r[first] > 30000 || r[first + 1u] < .001F || r[first + 1u] > 4 ||
          r[first + 2u] < -96 || r[first + 2u] > 24)
        return false;
    for (auto first : {PitchEGDelay, FilterEGDelay}) {
      for (auto lane : {0u, 2u, 3u, 4u, 6u})
        if (r[first + lane] < 0 || r[first + lane] > 100)
          return false;
      if (r[first + 1u] < 0 || r[first + 1u] > 100 || r[first + 5u] < 0 || r[first + 5u] > 100 ||
          std::abs(r[first + 7u]) > 12000)
        return false;
    }
    for (auto first : {AmpLFODelay, PitchLFODelay, FilterLFODelay})
      if (r[first] < 0 || r[first] > 100 || r[first + 1u] < 0 || r[first + 1u] > 100 ||
          r[first + 2u] < 0 || r[first + 2u] > 1000 || std::abs(r[first + 3u]) > 12000)
        return false;
    const auto offsetControls = indexValue(r, ControlOffset),
               countControls = indexValue(r, ControlCount);
    if (countControls > 128u * ControllerFamilyCount ||
        (countControls &&
         (offsetControls < header_words_ + kStride * region_count_ ||
          static_cast<std::uint64_t>(offsetControls) + countControls * 2u > control_end_)))
      return false;
    std::uint32_t previousId = 0u;
    for (auto i = 0u; i < countControls; ++i) {
      const auto *entry = payload_.data() + 8u + offsetControls + i * 2u;
      const auto id = std::bit_cast<std::uint32_t>(entry[0]);
      const auto family = id / 512u, cc = id % 512u;
      if (family >= ControllerFamilyCount || cc > 127u || (i && id <= previousId) ||
          !std::isfinite(entry[1]))
        return false;
      if (modulation_ && family != LowCC && family != HighCC && family != InitialCC &&
          family != OnLowCC && family != OnHighCC)
        return false;
      if ((family == LowCC || family == HighCC || family == InitialCC || family == OnLowCC ||
           family == OnHighCC) &&
          !integer(entry[1], 0u, 127u))
        return false;
      if (family >= AmpDelayCC && family <= AmpReleaseCC && std::abs(entry[1]) > 100.0F)
        return false;
      if (family >= EQ1FrequencyCC) {
        const auto target = (family - EQ1FrequencyCC) % 3u;
        if (target == 0u   ? std::abs(entry[1]) > 30000.0F
            : target == 1u ? std::abs(entry[1]) > 4.0F
                           : entry[1] < -96.0F || entry[1] > 24.0F)
          return false;
      }
      previousId = id;
    }
    return true;
  }
  // The legacy API advances in slices; native preparation completes off audio.
  void prepareSlice(std::uint64_t budget) noexcept {
    while (budget-- && state_ == ET_ASSET_STATE_PREPARING) {
      if (preparation_ == 0u) {
        if (cursor_ < region_count_) {
          const auto *r = region(cursor_++);
          if (!validRegion(r)) {
            failAsset();
            return;
          }
          if (modulation_) {
            const auto &plan = modulation_->plan(cursor_ - 1u);
            if (plan.sourceInstance != UINT32_MAX) {
              const auto view = modulation_->region(cursor_ - 1u);
              const auto &source = view.instances[plan.sourceInstance];
              const auto enabled =
                  view.parameters[source.firstParameter +
                                  schema::parameterRank(
                                      source.kind,
                                      static_cast<unsigned>(schema::Property::Enabled))]
                      .base;
              if (enabled != 0) {
                const auto logical = static_cast<std::uint64_t>(indexValue(r, End)) + 1u;
                auto packed = logical, length = logical;
                while (length > 1u) {
                  length = (length + 1u) / 2u;
                  packed += length;
                }
                if (packed != indexValue(r, Frames) || indexValue(r, Offset) != 0u ||
                    indexValue(r, LoopStart) != 0u || indexValue(r, LoopEnd) + 1u != logical ||
                    r[LoopMode] != 2.0F) {
                  failAsset();
                  return;
                }
              }
            }
          }
          if (!sf2_)
            keyswitches_.add(r);
          trigger_mask_ |= 1u << static_cast<std::uint32_t>(r[Trigger]);
          addStartControllers(r, cursor_ - 1u);
          for (auto key = static_cast<std::uint32_t>(r[LowKey]);
               key <= static_cast<std::uint32_t>(r[HighKey]); ++key)
            ++indices_.data()[key + 1u];
        } else {
          for (auto key = 1u; key <= 128u; ++key)
            indices_.data()[key] += indices_.data()[key - 1u];
          if (static_cast<std::uint64_t>(indices_.data()[128u]) + 129u + 2u * group_count_ >
              indices_.size()) {
            failAsset();
            return;
          }
          std::copy_n(indices_.data(), 128u, key_cursors_.data());
          cursor_ = 0u;
          preparation_ = 1u;
        }
      } else if (preparation_ == 1u) {
        if (cursor_ < region_count_) {
          const auto *r = region(cursor_);
          for (auto key = static_cast<std::uint32_t>(r[LowKey]);
               key <= static_cast<std::uint32_t>(r[HighKey]); ++key)
            indices_.data()[129u + 2u * group_count_ + key_cursors_[key]++] = cursor_;
          ++cursor_;
        } else {
          cursor_ = 0u;
          preparation_ = 2u;
        }
      } else if (preparation_ == 2u) {
        const auto end = std::min(begin_.frames, cursor_ + 32u);
        for (; cursor_ < end; ++cursor_) {
          const auto value = payload_.data()[8u + cursor_];
          fingerprint_ ^= std::bit_cast<std::uint32_t>(value);
          fingerprint_ *= 1099511628211ull;
          if (cursor_ >= pool_offset_ && !std::isfinite(value)) {
            failAsset();
            return;
          }
        }
        if (cursor_ == begin_.frames) {
          if (!streamed_)
            state_ = ET_ASSET_STATE_ACTIVE;
          else {
            preparation_ = 3u;
            cursor_ = 0u;
          }
        }
      } else {
        if (!cache_.generation())
          return;
        if (loading_) {
          if (cursor_ == sample_count_) {
            if (!sfz_effect_ready_)
              return;
            state_ = ET_ASSET_STATE_ACTIVE;
            continue;
          }
          const auto *raw = reinterpret_cast<const std::uint8_t *>(payload_.data());
          const auto header = [raw](std::uint32_t word) { return readU32(raw + 32u + word * 4u); };
          const auto record = header(12) + cursor_ * 16u;
          const auto first = header(record + 13u), count = header(record + 14u);
          if (resident_interval_ >= count) {
            ++cursor_;
            resident_interval_ = 0u;
            resident_page_ = UINT64_MAX;
            continue;
          }
          const auto row = resident_offset_ + (first + resident_interval_) * 4u;
          const auto begin = header(row) | (static_cast<std::uint64_t>(header(row + 1u)) << 32u);
          const auto end = header(row + 2u) | (static_cast<std::uint64_t>(header(row + 3u)) << 32u);
          if (resident_page_ == UINT64_MAX)
            resident_page_ = begin / SamplePageCache::kPageFrames;
          if (!cache_.resident(cursor_, resident_page_))
            return;
          if (++resident_page_ > (end - 1u) / SamplePageCache::kPageFrames) {
            ++resident_interval_;
            resident_page_ = UINT64_MAX;
          }
          continue;
        }
        // SF2 collections can span far more PCM than the cache. Metadata and
        // prepared DSP are sufficient; MIDI forecasts prime only needed pages.
        // SFZ oscillator/IR and onset residency retain their existing barriers.
        if (sf2_) {
          if (!sfz_effect_ready_)
            return;
          state_ = ET_ASSET_STATE_ACTIVE;
          continue;
        }
        if (cursor_ == region_count_) {
          if (!sfz_effect_ready_)
            return;
          state_ = ET_ASSET_STATE_ACTIVE;
          continue;
        }
        const auto *r = region(cursor_);
        if (silentRegion(cursor_)) {
          ++cursor_;
          continue;
        }
        const std::uint64_t position = indexValue(r, r[Direction] == 1.0F ? End : Offset);
        const auto first = position > 257u ? position - 257u : 0u;
        const auto last = std::min<std::uint64_t>(indexValue(r, Frames) - 1u, position + 257u);
        for (auto page = first / 4096u; page <= last / 4096u; ++page)
          if (!cache_.resident(indexValue(r, Sample), page))
            return;
        ++cursor_;
      }
    }
  }

  std::span<float> combStorage(std::uint32_t voice, std::uint32_t stage) noexcept {
    if (!modulation_ || !(modulation_->combMask & (1u << stage)))
      return {};
    const auto slot =
        voice * comb_stages_ + std::popcount(modulation_->combMask & ((1u << stage) - 1u));
    return {comb_samples_.data() + static_cast<std::size_t>(slot) * 2u * comb_frames_,
            2u * comb_frames_};
  }
  CombJournal *combJournal(std::uint32_t voice, std::uint32_t stage) noexcept {
    if (!modulation_trial_ || !modulation_ || !(modulation_->combMask & (1u << stage)))
      return nullptr;
    const auto slot =
        voice * comb_stages_ + std::popcount(modulation_->combMask & ((1u << stage) - 1u));
    return comb_journals_.data() + slot;
  }
  void beginModulationTrial() noexcept {
    modulation_trial_ = true;
    for (std::size_t index = 0; index < comb_journals_.size(); ++index)
      comb_journals_.data()[index].count = 0;
  }
  void endModulationTrial(bool restore) noexcept {
    if (restore)
      for (std::size_t index = 0; index < comb_journals_.size(); ++index)
        comb_journals_.data()[index].rollback(
            {comb_samples_.data() + index * 2u * comb_frames_, 2u * comb_frames_});
    modulation_trial_ = false;
  }
  et_status prepareProcessing(const PrepareInfo &info) noexcept {
    if (sf2_effects_)
      return ET_OK;
    if (sfz_effects_)
      return prepareSfzEffects(info, begin_.processingChannels,
                               static_cast<float>(info.minimumPhysicalBpm),
                               effectControllerEvents(info));
    EffectPlan plan;
    bool streamed = false;
    const auto assigned = assignEffectPlan(
        begin_, {reinterpret_cast<const std::uint8_t *>(payload_.data()), begin_.byteSize},
        ET_ASSET_F32_MULTICH, begin_.processingChannels, plan, sfz_effect_words_, streamed,
        sfz_effect_budget_bytes_);
    if (assigned != ET_OK)
      return assigned;
    ProcessingStorageRequirements storage;
    const auto required = processingStorageRequirements(
        info, begin_.processingChannels,
        modulation_ && !modulation_prepared_ ? modulation_->combMask : 0u, plan,
        static_cast<std::uint32_t>(sfz_effect_words_.size()), streamed, sf2_, storage,
        voice_capacity_);
    if (required != ET_OK)
      return required;
    if (storage.bytes > sfz_effect_budget_bytes_)
      return ET_ERR_OOM;
    processing_info_ = info;
    processing_context_set_ = true;
    if (modulation_ && !modulation_prepared_) {
      const auto &comb = storage.comb;
      if (!modulation_->prepareState(voice_capacity_))
        return ET_ERR_OOM;
      comb_stages_ = comb.stages;
      if (comb_stages_) {
        comb_frames_ = comb.frames;
        if (!comb_samples_.allocate(comb.samples) || !comb_writes_.allocate(comb.writes) ||
            !comb_journals_.allocate(comb.journals))
          return ET_ERR_OOM;
        comb_samples_.clear();
        for (auto i = std::size_t{0}; i < comb.journals; ++i)
          comb_journals_.data()[i] = {
              {comb_writes_.data() + i * 2u * info.maxFrames, 2u * info.maxFrames}, 0};
      }
      sfz_effect_budget_bytes_ -= comb.bytes;
      modulation_prepared_ = true;
    }
    if (!sf2_) {
      if (sfz_effect_required_) {
        const auto status = prepareSfzEffects(info, begin_.processingChannels,
                                              static_cast<float>(info.minimumPhysicalBpm),
                                              effectControllerEvents(info));
        if (status != ET_OK && status != ET_NEED_SAMPLE)
          return status;
        sfz_effect_ready_ = status == ET_OK;
      }
      return ET_OK;
    }
    if (state_ != ET_ASSET_STATE_PREPARING && state_ != ET_ASSET_STATE_ACTIVE)
      return ET_ERR_STATE;
    auto effects = std::unique_ptr<sf2::Effects>(new (std::nothrow) sf2::Effects());
    if (!effects) {
      return ET_ERR_OOM;
    }
#if defined(__cpp_exceptions)
    try {
#endif
      if (!effects->prepare(info, sfz_effect_budget_bytes_))
        return ET_ERR_OOM;
#if defined(__cpp_exceptions)
    } catch (const std::bad_alloc &) {
      return ET_ERR_OOM;
    } catch (...) {
      return ET_ERR_STATE;
    }
#endif
    sf2_effects_ = std::move(effects);
    sfz_effect_budget_bytes_ -= storage.sf2;
    return ET_OK;
  }

  // CONTROL only. The sampler and FX share a bank lifetime, but no FX state
  // advances until the sampler has committed its complete render trial.
  et_status prepareSfzEffects(const PrepareInfo &info, std::uint32_t actualOutputChannels,
                              float minimumPhysicalBpm, std::uint32_t controllerEvents) noexcept {
    if (sf2_ || !modulation_words_)
      return ET_OK;
    if (modulation_offset_ > begin_.frames ||
        modulation_words_ > begin_.frames - modulation_offset_)
      return ET_ERR_ARGS;
    if (modulation_words_ < 2u)
      return ET_ERR_ARGS;
    if (!std::isfinite(info.sampleRate) || info.sampleRate < 1 || info.sampleRate > 768000 ||
        !info.maxFrames || !actualOutputChannels || actualOutputChannels > 16u ||
        actualOutputChannels > info.maxChannels || !std::isfinite(minimumPhysicalBpm) ||
        minimumPhysicalBpm < 0 || !controllerEvents)
      return ET_ERR_ARGS;
    if (sfz_effects_)
      return sfz_effect_channels_ == actualOutputChannels && sfz_effect_frames_ >= info.maxFrames &&
                     sfz_effect_rate_ == info.sampleRate &&
                     effectPreparationTempo(sfz_effect_minimum_bpm_) <=
                         effectPreparationTempo(minimumPhysicalBpm) &&
                     sfz_effect_events_ >= controllerEvents
                 ? ET_OK
                 : ET_ERR_STATE;
    auto plan = std::unique_ptr<EffectPlan>(new (std::nothrow) EffectPlan());
    if (!plan)
      return ET_ERR_OOM;
    bool streamed = false;
    const auto assigned = assignEffectPlan(
        begin_, {reinterpret_cast<const std::uint8_t *>(payload_.data()), begin_.byteSize},
        ET_ASSET_F32_MULTICH, actualOutputChannels, *plan, sfz_effect_words_, streamed,
        sfz_effect_budget_bytes_);
    if (assigned != ET_OK || !sfz_effect_words_.size())
      return assigned;
    auto context = info;
    context.minimumPhysicalBpm = minimumPhysicalBpm;
    std::uint64_t required = 0;
    if (!effectPreparationBytes(*plan, context, actualOutputChannels, streamed, controllerEvents,
                                static_cast<std::uint32_t>(sfz_effect_words_.size()), required))
      return ET_ERR_UNSUPPORTED;
    if (required > sfz_effect_budget_bytes_)
      return ET_ERR_OOM;
    std::uint64_t charged = sizeof(EffectPlan) + sfz_effect_words_.size() * sizeof(std::uint32_t);
    const auto charge = [&](std::uint64_t bytes) {
      if (charged > sfz_effect_budget_bytes_ || bytes > sfz_effect_budget_bytes_ - charged)
        return false;
      charged += bytes;
      return true;
    };
    sfz_effect_ir_.release();
    sfz_effect_impulses_.release();
    sfz_effect_sources_.release();
    std::uint64_t samples = 0, temporarySamples = 0;
    bool samplesReady = true;
    for (auto index = 0u; index < plan->impulseCount(); ++index) {
      const auto ir = plan->impulse(index);
      const auto frames = effectImpulseFrames(ir.frames, ir.rate, info.sampleRate);
      if (!frames)
        return ET_ERR_UNSUPPORTED;
      samples += static_cast<std::uint64_t>(frames) * ir.channels;
      if (streamed_) {
        temporarySamples =
            std::max(temporarySamples, static_cast<std::uint64_t>(ir.frames) * ir.channels);
        const auto &metadata = sample_metadata_.data()[ir.sampleOffsetOrId];
        if (metadata.frames != ir.frames || metadata.channels != ir.channels ||
            metadata.rate != ir.rate)
          return ET_ERR_UNSUPPORTED;
        // The producer preloads and pins every known IR page before stream admission.
        // Readiness must not enqueue those same pages while that preload is still in flight.
        for (std::uint64_t frame = 0; frame < ir.frames; frame += SamplePageCache::kPageFrames)
          samplesReady =
              cache_.resident(ir.sampleOffsetOrId, frame / SamplePageCache::kPageFrames) &&
              samplesReady;
      }
    }
    if (!charge(static_cast<std::uint64_t>(plan->impulseCount()) * sizeof(EffectImpulse)) ||
        !charge(samples * sizeof(float)) ||
        !charge(static_cast<std::uint64_t>(info.maxFrames) * 28u * sizeof(float)) ||
        temporarySamples > SIZE_MAX / sizeof(float) || samples > SIZE_MAX / sizeof(float) ||
        temporarySamples * sizeof(float) > sfz_effect_budget_bytes_ - charged)
      return ET_ERR_OOM;
    if (!samplesReady)
      return ET_NEED_SAMPLE;
    if (!sfz_effect_ir_.allocate(plan->impulseCount()) ||
        !sfz_effect_impulses_.allocate(static_cast<std::size_t>(samples)) ||
        !sfz_effect_sources_.allocate(static_cast<std::size_t>(info.maxFrames) * 28u))
      return ET_ERR_OOM;
    sfz_effect_sources_.clear();
    NothrowStorage<float> temporary;
    if (!temporary.allocate(static_cast<std::size_t>(temporarySamples)))
      return ET_ERR_OOM;
    std::size_t first = 0;
    for (auto index = 0u; index < plan->impulseCount(); ++index) {
      const auto ir = plan->impulse(index);
      const auto frames = effectImpulseFrames(ir.frames, ir.rate, info.sampleRate);
      const auto values = static_cast<std::size_t>(ir.frames) * ir.channels;
      std::span<const float> input;
      if (streamed_) {
        for (auto frame = 0u; frame < ir.frames; ++frame)
          for (auto channel = 0u; channel < ir.channels; ++channel)
            if (!cache_.sample(
                    ir.sampleOffsetOrId, frame, channel,
                    temporary.data()[static_cast<std::size_t>(frame) * ir.channels + channel]))
              return ET_NEED_SAMPLE;
        input = {temporary.data(), values};
      } else {
        input = {payload_.data() + 8u + pool_offset_ + ir.sampleOffsetOrId, values};
      }
      auto output = std::span<float>(sfz_effect_impulses_.data() + first,
                                     static_cast<std::size_t>(frames) * ir.channels);
      if (!prepareEffectImpulse(input, ir.channels, ir.rate, info.sampleRate, output))
        return ET_ERR_ARGS;
      sfz_effect_ir_.data()[index] = {output, ir.channels, frames};
      first += output.size();
    }
    // The peak conversion buffer is gone before effect nodes/convolution reserve.
    temporary.release();
    if (sizeof(EffectRuntime) > sfz_effect_budget_bytes_ - charged)
      return ET_ERR_OOM;
    auto runtime = std::unique_ptr<EffectRuntime>(new (std::nothrow) EffectRuntime());
    if (!runtime) {
      return ET_ERR_OOM;
    }
#if defined(__cpp_exceptions)
    try {
#endif
      if (!runtime->prepare(*plan, info, actualOutputChannels,
                            [&](EffectImpulseReference reference) {
                              for (auto index = 0u; index < plan->impulseCount(); ++index) {
                                const auto ir = plan->impulse(index);
                                if (ir.sampleOffsetOrId == reference.sampleOffsetOrId &&
                                    ir.frames == reference.frames &&
                                    ir.channels == reference.channels && ir.rate == reference.rate)
                                  return sfz_effect_ir_.data()[index];
                              }
                              return EffectImpulse{};
                            },
                            minimumPhysicalBpm,
                            {sfz_effect_budget_bytes_ - charged, controllerEvents}))
        return ET_ERR_OOM;
#if defined(__cpp_exceptions)
    } catch (const std::bad_alloc &) {
      return ET_ERR_OOM;
    } catch (...) {
      return ET_ERR_STATE;
    }
#endif
    sfz_effect_channels_ = actualOutputChannels;
    sfz_effect_frames_ = info.maxFrames;
    sfz_effect_events_ = controllerEvents;
    sfz_effect_rate_ = info.sampleRate;
    sfz_effect_minimum_bpm_ = minimumPhysicalBpm;
    sfz_effect_plan_ = std::move(plan);
    sfz_effects_ = std::move(runtime);
    return ET_OK;
  }

  static et_status prepare(const PrepareInfo &preparation, const AssetBeginInfo &info,
                           const std::uint8_t *payload, std::uint32_t format,
                           std::unique_ptr<PreparedAsset> &asset,
                           std::uint32_t voices = 128u) noexcept {
    auto next = std::unique_ptr<SFZBank>(new (std::nothrow) SFZBank(voices));
    if (!next)
      return ET_ERR_OOM;
    const auto allocated = next->allocate(info);
    if (allocated != ET_OK)
      return allocated;
    std::memcpy(next->payload_.data(), payload, info.byteSize);
    const auto committed = next->commit(info.byteSize, format);
    if (committed != ET_OK)
      return committed;
    next->prepareSlice(std::numeric_limits<std::uint64_t>::max());
    if (next->state_ != ET_ASSET_STATE_ACTIVE &&
        !(next->streamed_ && next->state_ == ET_ASSET_STATE_PREPARING))
      return ET_ERR_ARGS;
    const auto effects = next->prepareProcessing(preparation);
    if (effects != ET_OK)
      return effects;
    asset = std::move(next);
    return ET_OK;
  }
};
} // namespace effetune::plugins::others::sfz
#endif

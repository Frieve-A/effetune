#ifndef EFFETUNE_SFZ_SAMPLE_CACHE_H
#define EFFETUNE_SFZ_SAMPLE_CACHE_H

#include "SFZModulationSchema.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <new>
#include <span>

namespace effetune::plugins::others::sfz {

struct SampleMetadata {
  std::uint64_t frames = 0;
  std::uint32_t channels = 0;
  std::uint32_t rate = 0;
};

struct SamplePageRequest {
  std::uint64_t generation = 0;
  std::uint64_t page = 0;
  std::uint32_t sample = 0;
};

enum class SampleReadStatus { Ready, Unavailable, Invalid, Overflow };

// One cache belongs to one immutable bank generation. The owner serializes
// control publication with render calls; no mutex, allocation, I/O, or decoding
// occurs in sample()/copyWindow(). PCM is not engine/VM state and must not
// enter checkpoints.
class SamplePageCache {
public:
  static constexpr std::uint32_t kPageFrames = schema::kStorageCachePageFrames;
  // Matches the SF2 sample-header table limit and SFZ_MAX_SAMPLES in js/sfz/limits.js.
  static constexpr std::size_t kMaxSamples = 65536;
  static constexpr std::size_t kMaxRequests = schema::kStorageCacheRequestCapacity;

  // CONTROL planning data, independent of voice/VM/checkpoint state. Keys use
  // the cache's native sample identity, including distinct PCM16/F32 variants.
  struct ForecastPage {
    std::uint64_t page = 0;
    std::uint32_t sample = 0, reserved = 0;
    friend bool operator<(const ForecastPage &a, const ForecastPage &b) noexcept {
      return a.sample < b.sample || (a.sample == b.sample && a.page < b.page);
    }
    friend bool operator==(const ForecastPage &a, const ForecastPage &b) noexcept {
      return a.sample == b.sample && a.page == b.page;
    }
  };
  struct ForecastSource {
    double position = 0, maximumStep = 0;
    std::uint64_t pitchControllersLow = 0, pitchControllersHigh = 0;
    std::uint32_t region = 0, channel = 0, physicalKey = 0, musicalKey = 0;
    std::uint32_t velocity = 0, onset = 0, flags = 0, pitchFacts = 0;
  };
  static constexpr std::size_t kMaxForecastSources = schema::kStorageCacheForecastSourceCapacity;
  static_assert(sizeof(ForecastPage) == schema::kStorageCacheForecastPageBytes);
  static_assert(sizeof(ForecastSource) == schema::kStorageCacheForecastSourceBytes);
  enum class Admission { Admitted, Pressure, Invalid };

  struct StorageRequirements {
    std::size_t buckets = 0;
    std::uint64_t pcmBytes = 0, bytes = 0;
  };
  static bool storageRequirements(std::size_t sampleCount, std::size_t slots, std::size_t slots16,
                                  std::uint32_t channels, StorageRequirements &storage,
                                  bool modeAware = false) noexcept {
    storage = {};
    if (!sampleCount || sampleCount > kMaxSamples || !slots || slots > 32768u || slots16 > slots ||
        channels < 1u || channels > 2u)
      return false;
    storage.buckets = 1;
    while (storage.buckets < slots * schema::kStorageCacheHashLoad)
      storage.buckets *= 2u;
    storage.pcmBytes = static_cast<std::uint64_t>(kPageFrames) * channels *
                       ((slots - slots16) * sizeof(float) + slots16 * sizeof(std::int16_t));
    storage.bytes = storage.pcmBytes + slots * sizeof(Page) +
                    storage.buckets * sizeof(std::uint32_t) +
                    sampleCount * (2u * sizeof(SampleMetadata) + (modeAware ? 2u : 0u)) +
                    kMaxRequests * sizeof(Request) + slots * sizeof(ForecastPage) +
                    kMaxForecastSources * sizeof(ForecastSource);
    return true;
  }

  // Control thread only. Mono-only banks use one channel per cache slot.
  bool configure(std::uint64_t generation, const SampleMetadata *samples, std::size_t count,
                 std::size_t slots, std::size_t slots16 = 0,
                 const std::uint8_t *storageModes = nullptr) noexcept {
    if (!generation || !samples || !count || count > kMaxSamples || !slots || slots > 32768 ||
        slots16 > slots)
      return false;
    std::uint32_t channels = 1;
    for (std::size_t i = 0; i < count; ++i) {
      if (!samples[i].frames || samples[i].channels < 1 || samples[i].channels > 2 ||
          !samples[i].rate || samples[i].rate > 768000 || (storageModes && storageModes[i] > 1u) ||
          ((storageModes && storageModes[i]) ? !slots16 : slots == slots16))
        return false;
      if (samples[i].channels > channels)
        channels = samples[i].channels;
    }
    std::size_t buckets = 1;
    while (buckets < slots * 4)
      buckets *= 2;
    auto metadata = std::unique_ptr<SampleMetadata[]>(new (std::nothrow) SampleMetadata[count]);
    auto modes = storageModes
                     ? std::unique_ptr<std::uint8_t[]>(new (std::nothrow) std::uint8_t[count])
                     : nullptr;
    auto pages = std::unique_ptr<Page[]>(new (std::nothrow) Page[slots]{});
    auto pcm = std::unique_ptr<float[]>(
        new (std::nothrow) float[(slots - slots16) * kPageFrames * channels]{});
    auto pcm16 = std::unique_ptr<std::int16_t[]>(
        new (std::nothrow) std::int16_t[slots16 * kPageFrames * channels]{});
    auto table = std::unique_ptr<std::uint32_t[]>(new (std::nothrow) std::uint32_t[buckets]);
    auto plan = std::unique_ptr<ForecastPage[]>(new (std::nothrow) ForecastPage[slots]);
    auto sources =
        std::unique_ptr<ForecastSource[]>(new (std::nothrow) ForecastSource[kMaxForecastSources]);
    if (!metadata || (storageModes && !modes) || !pages || !pcm || !pcm16 || !table || !plan ||
        !sources)
      return false;
    std::copy_n(samples, count, metadata.get());
    if (storageModes)
      std::copy_n(storageModes, count, modes.get());
    storage_modes_.swap(modes);
    std::fill_n(table.get(), buckets, kEmpty);
    metadata_.swap(metadata);
    pages_.swap(pages);
    pcm_.swap(pcm);
    pcm16_.swap(pcm16);
    slots32_ = slots - slots16;
    buckets_.swap(table);
    forecast_plan_.swap(plan);
    forecast_sources_.swap(sources);
    plan_count_ = source_count_ = plan_request_cursor_ = planned_pages_ = pending_pages_ = 0;
    collecting_plan_ = plan_pressure_ = plan_invalid_ = optional_forecast_ = false;
    sample_count_ = count;
    slot_count_ = slots;
    bucket_count_ = buckets;
    stride_channels_ = channels;
    generation_ = generation;
    epoch_ = 1;
    forecast_serial_ = committed_forecast_ = staged_forecast_ = 0;
    request_count_ = 0;
    deleted_ = 0;
    overflow_ = false;
    return true;
  }

  std::uint64_t generation() const noexcept { return generation_; }
  const SampleMetadata *metadata(std::uint32_t sample) const noexcept {
    return sample < sample_count_ ? &metadata_[sample] : nullptr;
  }
  std::size_t capacityBytes() const noexcept {
    return slots32_ * kPageFrames * stride_channels_ * sizeof(float) +
           (slot_count_ - slots32_) * kPageFrames * stride_channels_ * sizeof(std::int16_t);
  }
  bool resident(std::uint32_t sample, std::uint64_t page) const noexcept {
    const auto index = find(sample, page);
    return index != kEmpty && pages_[index].resident;
  }

  // A dry plan never reserves a slot or changes the committed prediction.
  bool beginAdmission() noexcept {
    if (!generation_ || overflow_ || !forecast_plan_ || !forecast_sources_)
      return false;
    cancelForecast();
    collecting_plan_ = true;
    plan_pressure_ = plan_invalid_ = false;
    plan_count_ = source_count_ = 0;
    return true;
  }
  std::span<ForecastSource> forecastSources() noexcept {
    return {forecast_sources_.get(), source_count_};
  }
  ForecastSource *addForecastSource() noexcept {
    if (!collecting_plan_ || source_count_ == kMaxForecastSources) {
      plan_pressure_ = true;
      return nullptr;
    }
    auto &source = forecast_sources_[source_count_++];
    source = {};
    return &source;
  }
  std::uint32_t plannedPages() const noexcept { return planned_pages_; }
  std::uint32_t pendingPages() const noexcept { return pending_pages_; }
  bool admittedForecastValid() const noexcept {
    return optional_forecast_ && (committed_forecast_ || staged_forecast_);
  }
  Admission admitForecast() noexcept {
    if (!collecting_plan_)
      return Admission::Invalid;
    collecting_plan_ = false;
    if (plan_invalid_)
      return Admission::Invalid;
    if (plan_pressure_)
      return Admission::Pressure;
    compactPlan();
    std::array<std::uint8_t, 32768u / 8u> held{};
    const auto hold = [&](std::uint32_t slot) {
      held[slot / 8u] = static_cast<std::uint8_t>(held[slot / 8u] | (1u << (slot % 8u)));
    };
    const auto protectedSlot = [&](std::uint32_t slot) {
      const auto &page = pages_[slot];
      return page.resident || page.used == epoch_ || (held[slot / 8u] & (1u << (slot % 8u)));
    };
    for (std::size_t i = 0; i < request_count_; ++i)
      if (requests_[i].inFlight || requests_[i].mandatory) {
        const auto slot = find(requests_[i].sample, requests_[i].page);
        if (slot != kEmpty)
          hold(slot);
      }
    std::size_t needed32 = 0, needed16 = 0;
    const auto count = [&](std::uint32_t sample) { ++(storageMode(sample) ? needed16 : needed32); };
    for (std::uint32_t slot = 0; slot < slot_count_; ++slot)
      if (pages_[slot].valid && protectedSlot(slot))
        count(pages_[slot].sample);
    for (std::size_t i = 0; i < plan_count_; ++i) {
      const auto &key = forecast_plan_[i];
      const auto slot = find(key.sample, key.page);
      if (slot == kEmpty || !protectedSlot(slot))
        count(key.sample);
    }
    for (std::size_t i = 0; i < request_count_; ++i) {
      const auto &request = requests_[i];
      if ((request.inFlight || request.mandatory) && find(request.sample, request.page) == kEmpty &&
          !std::binary_search(forecast_plan_.get(), forecast_plan_.get() + plan_count_,
                              ForecastPage{request.page, request.sample}))
        count(request.sample);
    }
    if (needed32 > slots32_ || needed16 > slot_count_ - slots32_)
      return Admission::Pressure;

    // Only a successful dry admission retires obsolete predictive pins.
    committed_forecast_ = staged_forecast_ = 0;
    discardUnheldRequests();
    if (++forecast_serial_ == 0u) {
      for (std::size_t i = 0; i < slot_count_; ++i)
        pages_[i].forecast = pages_[i].previousForecast = 0;
      forecast_serial_ = 1u;
    }
    staged_forecast_ = forecast_serial_;
    optional_forecast_ = true;
    for (std::size_t i = 0; i < request_count_; ++i) {
      auto slot = find(requests_[i].sample, requests_[i].page);
      if (slot == kEmpty)
        slot = reserve(requests_[i].sample, requests_[i].page);
      if (slot == kEmpty) {
        overflow_ = true;
        return Admission::Invalid;
      }
      pages_[slot].requested = true;
    }
    planned_pages_ = static_cast<std::uint32_t>(plan_count_);
    pending_pages_ = 0;
    for (std::size_t i = 0; i < plan_count_; ++i) {
      const auto &key = forecast_plan_[i];
      auto slot = find(key.sample, key.page);
      if (slot == kEmpty)
        slot = reserve(key.sample, key.page);
      if (slot == kEmpty) {
        overflow_ = true;
        return Admission::Invalid;
      }
      stageForecast(pages_[slot]);
      if (!pages_[slot].ready)
        ++pending_pages_;
    }
    plan_request_cursor_ = 0;
    fillForecastRequests();
    return Admission::Admitted;
  }

  // Control-only forecast transaction. Keep the previous window until all
  // publications for the replacement have been acknowledged by the host.
  bool beginForecast() noexcept {
    if (!generation_)
      return false;
    cancelForecast();
    optional_forecast_ = false;
    if (forecast_serial_ == UINT32_MAX) {
      for (std::size_t index = 0; index < slot_count_; ++index) {
        auto &page = pages_[index];
        page.forecast = committed_forecast_ && (page.forecast == committed_forecast_ ||
                                                page.previousForecast == committed_forecast_)
                            ? 1u
                            : 0u;
        page.previousForecast = 0;
      }
      committed_forecast_ = committed_forecast_ ? 1u : 0u;
      forecast_serial_ = 1;
    }
    staged_forecast_ = ++forecast_serial_;
    return true;
  }
  bool commitForecast() noexcept {
    if (!staged_forecast_ || overflow_)
      return false;
    if (optional_forecast_) {
      if (pending_pages_)
        return false;
      committed_forecast_ = staged_forecast_;
      staged_forecast_ = 0;
      return true;
    }
    for (std::size_t index = 0; index < request_count_; ++index)
      if (!requests_[index].inFlight)
        return false;
    for (std::size_t index = 0; index < slot_count_; ++index)
      if (pages_[index].valid && pages_[index].forecast == staged_forecast_ && !pages_[index].ready)
        return false;
    committed_forecast_ = staged_forecast_;
    staged_forecast_ = 0;
    return true;
  }
  void cancelForecast() noexcept {
    collecting_plan_ = false;
    staged_forecast_ = 0;
    discardUnheldRequests();
  }
  void clearForecast() noexcept {
    collecting_plan_ = false;
    committed_forecast_ = staged_forecast_ = 0;
    planned_pages_ = pending_pages_ = 0;
    discardUnheldRequests();
  }

  // Call once per successful/new quantum, not when retrying an offline quantum.
  // Pages touched by that quantum cannot be evicted until the next
  // beginQuantum.
  void beginQuantum() noexcept {
    if (++epoch_ == 0) {
      for (std::size_t index = 0; index < slot_count_; ++index)
        pages_[index].used = 0;
      epoch_ = 1;
    }
  }

  bool sample(std::uint32_t sampleId, std::uint64_t frame, std::uint32_t channel,
              float &value) noexcept {
    return readSample(sampleId, frame, channel, value) == SampleReadStatus::Ready;
  }
  SampleReadStatus readSample(std::uint32_t sampleId, std::uint64_t frame, std::uint32_t channel,
                              float &value) noexcept {
    const auto *info = metadata(sampleId);
    if (!generation_ || !info || frame >= info->frames || channel >= info->channels)
      return SampleReadStatus::Invalid;
    if (overflow_)
      return SampleReadStatus::Overflow;
    const auto index = find(sampleId, frame / kPageFrames);
    if (index == kEmpty || !pages_[index].ready) {
      request(sampleId, frame / kPageFrames);
      return overflow_ ? SampleReadStatus::Overflow : SampleReadStatus::Unavailable;
    }
    auto &page = pages_[index];
    page.used = epoch_;
    const auto offset = static_cast<std::size_t>(frame % kPageFrames) * info->channels + channel;
    value = storageMode(sampleId)
                ? static_cast<float>(
                      pcm16_[(index - slots32_) * kPageFrames * stride_channels_ + offset]) *
                      (1.0F / 32768.0F)
                : pcm_[static_cast<std::size_t>(index) * kPageFrames * stride_channels_ + offset];
    return SampleReadStatus::Ready;
  }

  // The engine owns negative/loop/end padding. This copies valid source frames
  // only, supports FIR spans crossing page boundaries, and never retains a
  // pointer.
  bool copyWindow(std::uint32_t sampleId, std::uint64_t first, std::uint32_t count,
                  std::uint32_t channel, float *destination) noexcept {
    return readWindow(sampleId, first, count, channel, destination) == SampleReadStatus::Ready;
  }
  // Non-requesting span probe. The owner may borrow a ready mono page only
  // inside this processing quantum; actual reads retain the typed error path.
  const float *readyMonoWindow(std::uint32_t sampleId, std::uint64_t first, std::uint32_t count,
                               SampleReadStatus *status = nullptr) noexcept {
    if (status)
      *status = SampleReadStatus::Invalid;
    const auto *info = metadata(sampleId);
    if (!generation_ || !info || info->channels != 1u || !count || first > info->frames ||
        count > info->frames - first || first / kPageFrames != (first + count - 1u) / kPageFrames)
      return nullptr;
    if (status)
      *status = overflow_ ? SampleReadStatus::Overflow : SampleReadStatus::Unavailable;
    if (overflow_)
      return nullptr;
    const auto index = find(sampleId, first / kPageFrames);
    if (index == kEmpty || !pages_[index].ready)
      return nullptr;
    if (status)
      *status = SampleReadStatus::Ready;
    pages_[index].used = epoch_;
    if (storageMode(sampleId))
      return nullptr; // Ready PCM16 uses the caller-owned conversion scratch.
    return pcm_.get() + static_cast<std::size_t>(index) * kPageFrames * stride_channels_ +
           static_cast<std::size_t>(first % kPageFrames);
  }
  SampleReadStatus readWindow(std::uint32_t sampleId, std::uint64_t first, std::uint32_t count,
                              std::uint32_t channel, float *destination,
                              const float **contiguous = nullptr,
                              bool *allMissing = nullptr) noexcept {
    if (contiguous)
      *contiguous = destination;
    if (allMissing)
      *allMissing = false;
    const auto *info = metadata(sampleId);
    if (!generation_ || !info || !destination || !count || count > 514 ||
        channel >= info->channels || first > info->frames || count > info->frames - first)
      return SampleReadStatus::Invalid;
    if (overflow_)
      return SampleReadStatus::Overflow;
    bool ready = true, anyReady = false;
    std::uint32_t copied = 0;
    while (copied < count) {
      const auto frame = first + copied;
      const auto index = find(sampleId, frame / kPageFrames);
      const auto inPage = static_cast<std::uint32_t>(frame % kPageFrames);
      const auto available = kPageFrames - inPage;
      const auto remaining = count - copied;
      const auto length = available < remaining ? available : remaining;
      if (index == kEmpty || !pages_[index].ready) {
        request(sampleId, frame / kPageFrames);
        std::fill_n(destination + copied, length, 0.0F);
        ready = false;
      } else {
        auto &page = pages_[index];
        page.used = epoch_;
        anyReady = true;
        if (storageMode(sampleId)) {
          const auto *source16 = pcm16_.get() +
                                 (index - slots32_) * kPageFrames * stride_channels_ +
                                 static_cast<std::size_t>(inPage) * info->channels + channel;
          for (std::uint32_t i = 0; i < length; ++i)
            destination[copied + i] =
                static_cast<float>(source16[static_cast<std::size_t>(i) * info->channels]) *
                (1.0F / 32768.0F);
          copied += length;
          continue;
        }
        const auto *source = pcm_.get() +
                             static_cast<std::size_t>(index) * kPageFrames * stride_channels_ +
                             static_cast<std::size_t>(inPage) * info->channels + channel;
        // The view is valid only during the serialized processing quantum.
        if (contiguous && info->channels == 1u && length == count) {
          *contiguous = source;
          return SampleReadStatus::Ready;
        }
        for (std::uint32_t i = 0; i < length; ++i)
          destination[copied + i] = source[static_cast<std::size_t>(i) * info->channels];
      }
      copied += length;
    }
    if (allMissing)
      *allMissing = !anyReady;
    return ready       ? SampleReadStatus::Ready
           : overflow_ ? SampleReadStatus::Overflow
                       : SampleReadStatus::Unavailable;
  }

  // Preparation/lookahead may request arbitrary source positions, including
  // reverse playback, loop restart and script-directed sample offsets.
  bool requestWindow(std::uint32_t sampleId, std::uint64_t first, std::uint64_t count) noexcept {
    if (collecting_plan_)
      return planWindow(sampleId, first, count);
    const auto *info = metadata(sampleId);
    if (!info || !count || first > info->frames || count > info->frames - first ||
        (first + count - 1) / kPageFrames - first / kPageFrames >= kMaxRequests)
      return false;
    bool ready = true;
    for (auto page = first / kPageFrames; page <= (first + count - 1) / kPageFrames; ++page) {
      auto index = find(sampleId, page);
      if (index == kEmpty && staged_forecast_) {
        index = reserve(sampleId, page);
        if (index == kEmpty) {
          overflow_ = true;
          ready = false;
          continue;
        }
      }
      if (index != kEmpty)
        stageForecast(pages_[index]);
      if (index == kEmpty || !pages_[index].ready) {
        request(sampleId, page, false);
        ready = false;
      } else {
        pages_[index].used = epoch_;
      }
    }
    return ready;
  }

  // Control thread only. Late data from an old bank cannot populate this cache.
  // A false return means invalid data or every candidate is pinned this
  // quantum; the host must report capacity failure rather than evict an active
  // FIR window.
  bool publish(const SamplePageRequest &request, const float *pcm, std::uint32_t frames,
               std::uint32_t channels, bool resident = false) noexcept {
    const auto *info = metadata(request.sample);
    if (request.generation != generation_ || !info || !pcm || channels != info->channels ||
        request.page > (info->frames - 1) / kPageFrames)
      return false;
    const auto remaining = info->frames - request.page * kPageFrames;
    if (frames != (remaining < kPageFrames ? remaining : kPageFrames))
      return false;
    const auto values = static_cast<std::size_t>(frames) * channels;
    for (std::size_t i = 0; i < values; ++i)
      if (!std::isfinite(pcm[i]))
        return false;
    auto slot = find(request.sample, request.page);
    if (slot == kEmpty)
      slot = reserve(request.sample, request.page);
    if (slot == kEmpty && optional_forecast_) {
      const auto actual = std::any_of(
          requests_.begin(), requests_.begin() + request_count_, [&](const Request &pending) {
            return pending.mandatory && pending.sample == request.sample &&
                   pending.page == request.page;
          });
      if (actual) {
        // Actual playback takes precedence over optional prediction. Resident,
        // current-quantum and outstanding actual/in-flight pages stay protected.
        clearForecast();
        slot = reserve(request.sample, request.page);
      }
    }
    if (slot == kEmpty)
      return false;
    if (!pages_[slot].ready) {
      if (storageMode(request.sample)) {
        auto *destination = pcm16_.get() + (slot - slots32_) * kPageFrames * stride_channels_;
        for (std::size_t i = 0; i < values; ++i) {
          const auto scaled = pcm[i] * 32768.0F;
          destination[i] = scaled <= -32768.0F  ? INT16_MIN
                           : scaled >= 32767.0F ? INT16_MAX
                                                : static_cast<std::int16_t>(std::round(scaled));
        }
      } else {
        std::copy_n(pcm, values,
                    pcm_.get() + static_cast<std::size_t>(slot) * kPageFrames * stride_channels_);
      }
      pages_[slot].ready = true;
      pages_[slot].used = staged_forecast_ ? 0u : epoch_;
      if (optional_forecast_ && staged_forecast_ && pages_[slot].forecast == staged_forecast_ &&
          pending_pages_)
        --pending_pages_;
    }
    pages_[slot].requested = false;
    pages_[slot].resident = pages_[slot].resident || resident;
    if (!optional_forecast_)
      stageForecast(pages_[slot]);
    std::size_t kept = 0;
    for (std::size_t index = 0; index < request_count_; ++index)
      if (requests_[index].sample != request.sample || requests_[index].page != request.page)
        requests_[kept++] = requests_[index];
    request_count_ = kept;
    fillForecastRequests();
    return true;
  }

  std::size_t takeRequests(SamplePageRequest *destination, std::size_t capacity) noexcept {
    if (!destination)
      return 0;
    if (optional_forecast_ && !admittedForecastValid())
      discardUnheldRequests();
    fillForecastRequests();
    std::size_t taken = 0, kept = 0;
    for (std::size_t index = 0; index < request_count_; ++index) {
      auto request = requests_[index];
      const auto slot = find(request.sample, request.page);
      if (slot != kEmpty && pages_[slot].ready) {
        pages_[slot].requested = false;
        continue;
      }
      if (!request.inFlight && taken < capacity) {
        destination[taken++] = {request.generation, request.page, request.sample};
        request.inFlight = true;
      }
      requests_[kept++] = request;
    }
    request_count_ = kept;
    return taken;
  }
  bool requestOverflow() const noexcept { return overflow_; }

private:
  static constexpr std::uint32_t kEmpty = 0xffffffffu, kDeleted = 0xfffffffeu;
  struct Request {
    std::uint64_t generation = 0, page = 0;
    std::uint32_t sample = 0;
    bool inFlight = false, mandatory = false;
  };
  static_assert(sizeof(Request) == sizeof(SamplePageRequest));
  static_assert(sizeof(Request) == schema::kStorageCacheRequestBytes);
  static_assert(sizeof(SampleMetadata) == schema::kStorageCacheSampleMetadataBytes);
  static_assert(sizeof(std::uint8_t) == schema::kStorageCacheModeBytes);
  struct Page {
    std::uint64_t page = 0, used = 0;
    std::uint32_t sample = 0;
    bool valid = false, resident = false, ready = false, requested = false;
    std::uint32_t forecast = 0, previousForecast = 0;
  };
  static_assert(sizeof(Page) == schema::kStorageCachePageBytes);
  bool forecastPinned(const Page &page) const noexcept {
    return (committed_forecast_ && (page.forecast == committed_forecast_ ||
                                    page.previousForecast == committed_forecast_)) ||
           (staged_forecast_ && page.forecast == staged_forecast_);
  }
  void stageForecast(Page &page) noexcept {
    if (!staged_forecast_ || page.forecast == staged_forecast_)
      return;
    page.previousForecast = committed_forecast_ && (page.forecast == committed_forecast_ ||
                                                    page.previousForecast == committed_forecast_)
                                ? committed_forecast_
                                : 0u;
    page.forecast = staged_forecast_;
  }
  void discardUnheldRequests() noexcept {
    std::size_t kept = 0;
    for (std::size_t index = 0; index < request_count_; ++index) {
      const auto slot = find(requests_[index].sample, requests_[index].page);
      if (requests_[index].inFlight || requests_[index].mandatory ||
          (slot != kEmpty && !pages_[slot].ready && forecastPinned(pages_[slot])))
        requests_[kept++] = requests_[index];
      else if (slot != kEmpty)
        pages_[slot].requested = false;
    }
    request_count_ = kept;
  }
  std::uint32_t reserve(std::uint32_t sample, std::uint64_t page) noexcept {
    auto slot = kEmpty;
    std::uint64_t oldest = std::numeric_limits<std::uint64_t>::max();
    const auto *info = metadata(sample);
    if (!info)
      return slot;
    // configure bounds both pool sizes by 32768 slots.
    const auto first = storageMode(sample) ? static_cast<std::uint32_t>(slots32_) : 0u;
    const auto last = static_cast<std::uint32_t>(storageMode(sample) ? slot_count_ : slots32_);
    for (auto index = first; index < last; ++index) {
      if (!pages_[index].valid) {
        slot = index;
        break;
      }
      if (!pages_[index].resident && !pages_[index].requested && !forecastPinned(pages_[index]) &&
          pages_[index].used != epoch_ && pages_[index].used < oldest) {
        slot = index;
        oldest = pages_[index].used;
      }
    }
    if (slot == kEmpty)
      return slot;
    if (pages_[slot].valid)
      erase(pages_[slot].sample, pages_[slot].page);
    pages_[slot] = {page, 0u, sample, true};
    if (!optional_forecast_)
      stageForecast(pages_[slot]);
    insert(slot);
    if (deleted_ > slot_count_) {
      std::fill_n(buckets_.get(), bucket_count_, kEmpty);
      deleted_ = 0;
      for (std::uint32_t index = 0; index < slot_count_; ++index)
        if (pages_[index].valid)
          insert(index);
    }
    return slot;
  }
  std::size_t hash(std::uint32_t sample, std::uint64_t page) const noexcept {
    auto key = page ^ (static_cast<std::uint64_t>(sample) * 0x9e3779b97f4a7c15ull);
    key ^= key >> 30;
    key *= 0xbf58476d1ce4e5b9ull;
    key ^= key >> 27;
    return static_cast<std::size_t>(key) & (bucket_count_ - 1);
  }
  std::uint32_t find(std::uint32_t sample, std::uint64_t page) const noexcept {
    if (!bucket_count_)
      return kEmpty;
    auto bucket = hash(sample, page);
    for (std::size_t i = 0; i < bucket_count_; ++i) {
      const auto slot = buckets_[bucket];
      if (slot == kEmpty)
        break;
      if (slot != kDeleted && pages_[slot].sample == sample && pages_[slot].page == page)
        return slot;
      bucket = (bucket + 1) & (bucket_count_ - 1);
    }
    return kEmpty;
  }
  void erase(std::uint32_t sample, std::uint64_t page) noexcept {
    auto bucket = hash(sample, page);
    for (std::size_t i = 0; i < bucket_count_; ++i) {
      const auto slot = buckets_[bucket];
      if (slot == kEmpty)
        return;
      if (slot != kDeleted && pages_[slot].sample == sample && pages_[slot].page == page) {
        buckets_[bucket] = kDeleted;
        ++deleted_;
        return;
      }
      bucket = (bucket + 1) & (bucket_count_ - 1);
    }
  }
  void insert(std::uint32_t slot) noexcept {
    auto bucket = hash(pages_[slot].sample, pages_[slot].page);
    while (buckets_[bucket] != kEmpty && buckets_[bucket] != kDeleted)
      bucket = (bucket + 1) & (bucket_count_ - 1);
    if (buckets_[bucket] == kDeleted)
      --deleted_;
    buckets_[bucket] = slot;
  }
  void request(std::uint32_t sample, std::uint64_t page, bool mandatory = true) noexcept {
    const auto slot = find(sample, page);
    if (slot != kEmpty && pages_[slot].requested && !mandatory)
      return;
    auto replaceable = requests_.size();
    for (std::size_t i = 0; i < request_count_; ++i) {
      if (requests_[i].sample == sample && requests_[i].page == page) {
        requests_[i].mandatory = requests_[i].mandatory || mandatory;
        if (slot != kEmpty)
          pages_[slot].requested = true;
        return;
      }
      if (!requests_[i].inFlight && !requests_[i].mandatory)
        replaceable = i;
    }
    if (request_count_ == requests_.size()) {
      if (optional_forecast_) {
        if (!mandatory)
          return;
        if (replaceable != requests_.size()) {
          const auto previous = find(requests_[replaceable].sample, requests_[replaceable].page);
          if (previous != kEmpty)
            pages_[previous].requested = false;
          requests_[replaceable] = {generation_, page, sample, false, true};
          committed_forecast_ = staged_forecast_ = planned_pages_ = pending_pages_ = 0;
          if (slot != kEmpty)
            pages_[slot].requested = true;
          return;
        }
      }
      overflow_ = true;
      return;
    }
    requests_[request_count_++] = {generation_, page, sample, false, mandatory};
    if (slot != kEmpty)
      pages_[slot].requested = true;
  }
  bool storageMode(std::uint32_t sample) const noexcept {
    return storage_modes_ && storage_modes_[sample] != 0u;
  }
  void compactPlan() noexcept {
    std::sort(forecast_plan_.get(), forecast_plan_.get() + plan_count_);
    plan_count_ = static_cast<std::size_t>(
        std::unique(forecast_plan_.get(), forecast_plan_.get() + plan_count_) -
        forecast_plan_.get());
  }
  bool planWindow(std::uint32_t sample, std::uint64_t first, std::uint64_t count) noexcept {
    const auto *info = metadata(sample);
    if (!info || !count || first >= info->frames || count > info->frames - first) {
      plan_invalid_ = true;
      return false;
    }
    const auto firstPage = first / kPageFrames, lastPage = (first + count - 1u) / kPageFrames;
    if (lastPage - firstPage >= slot_count_) {
      plan_pressure_ = true;
      return false;
    }
    for (auto page = firstPage; page <= lastPage; ++page) {
      const ForecastPage key{page, sample};
      if (plan_count_ == slot_count_) {
        compactPlan();
        if (plan_count_ == slot_count_) {
          if (std::binary_search(forecast_plan_.get(), forecast_plan_.get() + plan_count_, key))
            continue;
          plan_pressure_ = true;
          return false;
        }
      }
      forecast_plan_[plan_count_++] = key;
    }
    return true;
  }
  void fillForecastRequests() noexcept {
    if (!optional_forecast_ || !staged_forecast_ || collecting_plan_)
      return;
    while (plan_request_cursor_ < plan_count_ && request_count_ < requests_.size()) {
      const auto &key = forecast_plan_[plan_request_cursor_++];
      const auto slot = find(key.sample, key.page);
      if (slot != kEmpty && !pages_[slot].ready && !pages_[slot].requested)
        request(key.sample, key.page, false);
    }
  }
  std::unique_ptr<ForecastPage[]> forecast_plan_;
  std::unique_ptr<ForecastSource[]> forecast_sources_;
  std::size_t plan_count_ = 0, source_count_ = 0, plan_request_cursor_ = 0;
  std::uint32_t planned_pages_ = 0, pending_pages_ = 0;
  bool collecting_plan_ = false, plan_pressure_ = false, plan_invalid_ = false;
  bool optional_forecast_ = false;
  std::unique_ptr<std::uint8_t[]> storage_modes_;
  std::unique_ptr<SampleMetadata[]> metadata_;
  std::unique_ptr<Page[]> pages_;
  std::unique_ptr<float[]> pcm_;
  std::unique_ptr<std::int16_t[]> pcm16_;
  std::unique_ptr<std::uint32_t[]> buckets_;
  std::size_t sample_count_ = 0, slot_count_ = 0, bucket_count_ = 0, slots32_ = 0;
  std::uint32_t stride_channels_ = 1;
  std::uint32_t forecast_serial_ = 0, committed_forecast_ = 0, staged_forecast_ = 0;
  std::array<Request, kMaxRequests> requests_{};
  std::size_t request_count_ = 0;
  std::size_t deleted_ = 0;
  std::uint64_t generation_ = 0, epoch_ = 1;
  bool overflow_ = false;
};
} // namespace effetune::plugins::others::sfz
#endif

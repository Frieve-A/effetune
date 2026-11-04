#include "allocation_guard.h"
#include "sample_cache.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <limits>

namespace {
using namespace effetune::plugins::others::sfz;
using Admission = SamplePageCache::Admission;
constexpr std::uint32_t P = SamplePageCache::kPageFrames;
int failures = 0;
#define CHECK(condition)                                                                           \
  do {                                                                                             \
    if (!(condition)) {                                                                            \
      std::fprintf(stderr, "forecast-admission:%d %s\n", __LINE__, #condition);                    \
      ++failures;                                                                                  \
    }                                                                                              \
  } while (false)

void dryPressureAndRecovery() {
  const SampleMetadata metadata{8u * P, 1, 48000};
  SamplePageCache cache;
  CHECK(cache.configure(101, &metadata, 1, 2));
  std::array<float, P> pcm;
  pcm.fill(.25F);
  effetune::allocation_guard::Scope guard;
  CHECK(cache.publish({101, 0, 0}, pcm.data(), P, 1));
  cache.beginQuantum();
  CHECK(cache.beginAdmission());
  CHECK(cache.requestWindow(0, 0, P));
  CHECK(cache.admitForecast() == Admission::Admitted);
  CHECK(cache.plannedPages() == 1 && cache.pendingPages() == 0);
  CHECK(cache.commitForecast());
  cache.beginQuantum();
  CHECK(cache.beginAdmission());
  CHECK(!cache.requestWindow(0, 0, 3u * P));
  CHECK(cache.admitForecast() == Admission::Pressure);
  CHECK(!cache.requestOverflow());
  CHECK(cache.publish({101, 1, 0}, pcm.data(), P, 1));
  CHECK(!cache.publish({101, 2, 0}, pcm.data(), P, 1));
  cache.beginQuantum();
  CHECK(cache.publish({101, 2, 0}, pcm.data(), P, 1));
  float value = 0;
  CHECK(cache.readSample(0, 0, 0, value) == SampleReadStatus::Ready && value == .25F);
  cache.beginQuantum();
  CHECK(cache.beginAdmission());
  CHECK(cache.requestWindow(0, 3u * P, P));
  CHECK(cache.admitForecast() == Admission::Admitted);
  CHECK(cache.pendingPages() == 1 && !cache.commitForecast());
  SamplePageRequest request;
  CHECK(cache.takeRequests(&request, 1) == 1 && request.page == 3 && request.generation == 101);
  CHECK(cache.takeRequests(&request, 1) == 0);
  CHECK(cache.publish({101, 3, 0}, pcm.data(), P, 1));
  CHECK(cache.pendingPages() == 0 && cache.commitForecast());
  CHECK(!cache.requestOverflow());
}

void replaceFullPredictionAndSourceUnion() {
  const SampleMetadata metadata{8u * P, 1, 48000};
  SamplePageCache cache;
  CHECK(cache.configure(102, &metadata, 1, 2));
  std::array<float, P> pcm;
  pcm.fill(.5F);
  effetune::allocation_guard::Scope guard;
  CHECK(cache.publish({102, 0, 0}, pcm.data(), P, 1));
  CHECK(cache.publish({102, 1, 0}, pcm.data(), P, 1));
  cache.beginQuantum();
  CHECK(cache.beginAdmission());
  auto *source = cache.addForecastSource();
  CHECK(source && source->maximumStep == 0 && source->flags == 0);
  if (source) {
    source->region = 17;
    source->position = 3.5;
  }
  CHECK(cache.addForecastSource());
  CHECK(cache.forecastSources().size() == 2 && cache.forecastSources()[0].region == 17);
  CHECK(cache.requestWindow(0, 0, 2u * P));
  CHECK(cache.requestWindow(0, P - 2u, 4));
  CHECK(cache.admitForecast() == Admission::Admitted);
  CHECK(cache.plannedPages() == 2 && cache.pendingPages() == 0 && cache.commitForecast());
  cache.beginQuantum();
  CHECK(cache.beginAdmission());
  CHECK(cache.forecastSources().empty());
  CHECK(cache.requestWindow(0, 2u * P, 2u * P));
  SamplePageRequest before;
  CHECK(cache.takeRequests(&before, 1) == 0);          // Dry planning publishes no requests.
  CHECK(cache.admitForecast() == Admission::Admitted); // Old two pins do not double capacity.
  CHECK(cache.plannedPages() == 2 && cache.pendingPages() == 2);
  std::array<SamplePageRequest, 2> requests;
  CHECK(cache.takeRequests(requests.data(), requests.size()) == 2);
  CHECK(requests[0].page != requests[1].page && !cache.commitForecast());
  CHECK(cache.publish(requests[0], pcm.data(), P, 1));
  CHECK(cache.pendingPages() == 1 && !cache.commitForecast());
  CHECK(cache.publish(requests[1], pcm.data(), P, 1));
  CHECK(cache.pendingPages() == 0 && cache.commitForecast());
  CHECK(cache.publish(requests[1], pcm.data(), P, 1));
  CHECK(cache.pendingPages() == 0 && !cache.requestOverflow());
}

void residentAndCurrentQuantumProtection() {
  const SampleMetadata metadata{8u * P, 1, 48000};
  SamplePageCache cache;
  CHECK(cache.configure(103, &metadata, 1, 2));
  std::array<float, P> pcm;
  pcm.fill(.125F);
  effetune::allocation_guard::Scope guard;
  CHECK(cache.publish({103, 0, 0}, pcm.data(), P, 1, true));
  CHECK(cache.publish({103, 1, 0}, pcm.data(), P, 1));
  CHECK(cache.beginAdmission() && cache.requestWindow(0, 2u * P, P));
  CHECK(cache.admitForecast() == Admission::Pressure && !cache.requestOverflow());
  cache.beginQuantum();
  CHECK(cache.beginAdmission() && cache.requestWindow(0, 2u * P, P));
  CHECK(cache.admitForecast() == Admission::Admitted);
  CHECK(cache.publish({103, 2, 0}, pcm.data(), P, 1));
  CHECK(cache.commitForecast() && cache.resident(0, 0));
}

void actualAndOptionalRequestProtection() {
  const SampleMetadata metadata{4u * P, 1, 48000};
  std::array<float, P> pcm;
  pcm.fill(.25F);
  for (const bool actual : {false, true}) {
    SamplePageCache cache;
    CHECK(cache.configure(104, &metadata, 1, 1));
    effetune::allocation_guard::Scope guard;
    CHECK(cache.beginAdmission() && cache.requestWindow(0, 0, P));
    CHECK(cache.admitForecast() == Admission::Admitted);
    if (actual) {
      float value = 0;
      CHECK(cache.readSample(0, 0, 0, value) == SampleReadStatus::Unavailable);
    }
    CHECK(cache.beginAdmission() && cache.requestWindow(0, P, P));
    CHECK(cache.admitForecast() == (actual ? Admission::Pressure : Admission::Admitted));
    CHECK(!cache.requestOverflow());
    SamplePageRequest request;
    CHECK(cache.takeRequests(&request, 1) == 1 && request.page == (actual ? 0u : 1u));
    CHECK(cache.publish(request, pcm.data(), P, 1));
    if (actual) {
      cache.beginQuantum();
      CHECK(cache.beginAdmission() && cache.requestWindow(0, P, P));
      CHECK(cache.admitForecast() == Admission::Admitted);
      CHECK(cache.takeRequests(&request, 1) == 1 && request.page == 1);
      CHECK(cache.publish(request, pcm.data(), P, 1));
    }
    CHECK(cache.pendingPages() == 0 && cache.commitForecast());
  }
  for (const bool actual : {false, true}) {
    SamplePageCache cache;
    CHECK(cache.configure(105, &metadata, 1, 1));
    effetune::allocation_guard::Scope guard;
    float value = 0;
    if (actual)
      CHECK(cache.readSample(0, 0, 0, value) == SampleReadStatus::Unavailable);
    else
      CHECK(!cache.requestWindow(0, 0, P));
    SamplePageRequest request;
    CHECK(cache.takeRequests(&request, 1) == 1 && request.page == 0);
    CHECK(cache.beginAdmission() && cache.requestWindow(0, P, P));
    CHECK(cache.admitForecast() == Admission::Pressure); // Both kinds protect real in-flight I/O.
    CHECK(cache.takeRequests(&request, 1) == 0 && !cache.requestOverflow());
    CHECK(cache.publish({105, 0, 0}, pcm.data(), P, 1));
    cache.beginQuantum();
    CHECK(cache.beginAdmission() && cache.requestWindow(0, P, P));
    CHECK(cache.admitForecast() == Admission::Admitted);
    CHECK(cache.takeRequests(&request, 1) == 1 && request.page == 1);
    CHECK(cache.publish(request, pcm.data(), P, 1));
    CHECK(cache.pendingPages() == 0 && cache.commitForecast());
  }
}

void mixedFormatPressureAndAcknowledgements() {
  const std::array metadata{SampleMetadata{2u * P + 17u, 2, 48000},
                            SampleMetadata{2u * P + 17u, 2, 48000}};
  const std::array<std::uint8_t, 2> modes{0, 1};
  SamplePageCache cache;
  CHECK(cache.configure(106, metadata.data(), metadata.size(), 4, 2, modes.data()));
  std::array<float, 2u * P> pcm;
  for (std::size_t i = 0; i < pcm.size(); ++i)
    pcm[i] = i % 2 ? -.5F : .25F;
  effetune::allocation_guard::Scope guard;
  CHECK(cache.beginAdmission());
  CHECK(cache.requestWindow(0, 0, 2u * P + 1u));
  CHECK(cache.admitForecast() == Admission::Pressure); // Free16 slots cannot satisfy3F32 pages.
  CHECK(!cache.requestOverflow());
  CHECK(cache.beginAdmission());
  CHECK(cache.requestWindow(1, 0, 2u * P + 1u));
  CHECK(cache.admitForecast() == Admission::Pressure);
  CHECK(cache.beginAdmission());
  CHECK(cache.requestWindow(0, P - 2u, 4) && cache.requestWindow(1, P - 2u, 4));
  CHECK(cache.admitForecast() == Admission::Admitted);
  CHECK(cache.plannedPages() == 4 && cache.pendingPages() == 4 && !cache.commitForecast());
  std::array<SamplePageRequest, 4> requests;
  CHECK(cache.takeRequests(requests.data(), requests.size()) == 4);
  CHECK(!cache.publish({107, 0, 0}, pcm.data(), P, 2));
  CHECK(!cache.publish({106, 0, 2}, pcm.data(), P, 2));
  CHECK(!cache.publish({106, 3, 0}, pcm.data(), P, 2));
  CHECK(!cache.publish({106, 2, 0}, pcm.data(), P, 2)); // Final page is17frames.
  pcm[0] = std::numeric_limits<float>::quiet_NaN();
  CHECK(!cache.publish({106, 0, 0}, pcm.data(), P, 2));
  pcm[0] = .25F;
  CHECK(cache.pendingPages() == 4 && !cache.commitForecast());
  CHECK(cache.publish({106, 0, 0}, pcm.data(), P, 2));
  CHECK(cache.pendingPages() == 3);
  std::array<float, 4> window;
  bool allMissing = true;
  CHECK(cache.readWindow(0, P - 2u, 4, 1, window.data(), nullptr, &allMissing) ==
        SampleReadStatus::Unavailable);
  CHECK(!allMissing && window[0] == -.5F && window[1] == -.5F && window[2] == 0 && window[3] == 0);
  CHECK(cache.readWindow(1, P - 2u, 4, 1, window.data(), nullptr, &allMissing) ==
        SampleReadStatus::Unavailable);
  CHECK(allMissing &&
        std::all_of(window.begin(), window.end(), [](float value) { return value == 0; }));
  CHECK(cache.publish({106, 0, 1}, pcm.data(), P, 2));
  CHECK(cache.pendingPages() == 2);
  CHECK(cache.publish({106, 1, 0}, pcm.data(), P, 2));
  CHECK(cache.pendingPages() == 1 && !cache.commitForecast());
  CHECK(cache.publish({106, 1, 1}, pcm.data(), P, 2));
  CHECK(cache.pendingPages() == 0 && cache.commitForecast());
  for (const auto sample : {0u, 1u}) {
    CHECK(cache.readWindow(sample, P - 2u, 4, 1, window.data(), nullptr, &allMissing) ==
          SampleReadStatus::Ready);
    CHECK(!allMissing &&
          std::all_of(window.begin(), window.end(), [](float value) { return value == -.5F; }));
  }
  cache.clearForecast();
  cache.beginQuantum();
  CHECK(cache.publish({106, 2, 1}, pcm.data(), 17, 2));
  std::array<float, 17> tail;
  CHECK(cache.readWindow(1, 2u * P, static_cast<std::uint32_t>(tail.size()), 0, tail.data()) ==
        SampleReadStatus::Ready);
  CHECK(std::all_of(tail.begin(), tail.end(), [](float value) { return value == .25F; }));
  CHECK(!cache.requestOverflow());
}

void invalidPlanAndSourceCapacity() {
  SamplePageCache cache;
  CHECK(!cache.beginAdmission() && cache.admitForecast() == Admission::Invalid);
  const SampleMetadata metadata{4u * P, 1, 48000};
  CHECK(cache.configure(107, &metadata, 1, 2));
  effetune::allocation_guard::Scope guard;
  for (const unsigned kind : {0u, 1u, 2u}) {
    CHECK(cache.beginAdmission());
    CHECK(!cache.requestWindow(kind == 0 ? 1 : 0, kind == 1 ? metadata.frames : 0,
                               kind == 2 ? 0 : 1));
    CHECK(cache.admitForecast() == Admission::Invalid && !cache.requestOverflow());
  }
  CHECK(cache.beginAdmission());
  for (std::size_t i = 0; i < SamplePageCache::kMaxForecastSources; ++i)
    CHECK(cache.addForecastSource());
  CHECK(!cache.addForecastSource());
  CHECK(cache.admitForecast() == Admission::Pressure && !cache.requestOverflow());
  CHECK(cache.beginAdmission() && cache.requestWindow(0, 0, P));
  CHECK(cache.admitForecast() == Admission::Admitted);
}

void actualReadRetiresOptionalPrediction() {
  const SampleMetadata metadata{(SamplePageCache::kMaxRequests + 1u) * P, 1, 48000};
  std::array<float, P> pcm{};
  for (const bool fullQueue : {false, true}) {
    const auto slots = fullQueue ? SamplePageCache::kMaxRequests : 1u;
    SamplePageCache cache;
    CHECK(cache.configure(108, &metadata, 1, slots));
    if (!fullQueue)
      CHECK(cache.publish({108, 0, 0}, pcm.data(), P, 1));
    cache.beginQuantum();
    effetune::allocation_guard::Scope guard;
    CHECK(cache.beginAdmission() && cache.requestWindow(0, 0, slots * P));
    CHECK(cache.admitForecast() == Admission::Admitted);
    if (!fullQueue)
      CHECK(cache.commitForecast());
    cache.beginQuantum();
    float value = 0;
    CHECK(cache.readSample(0, slots * P, 0, value) == SampleReadStatus::Unavailable);
    CHECK(!cache.requestOverflow());
    SamplePageRequest request{};
    CHECK(cache.takeRequests(&request, 1) == 1 && request.page == slots);
    CHECK(cache.publish(request, pcm.data(), P, 1));
    CHECK(!cache.admittedForecastValid() && !cache.requestOverflow());
    CHECK(cache.readSample(0, slots * P, 0, value) == SampleReadStatus::Ready);
    CHECK(cache.takeRequests(&request, 1) == 0);
  }
}

void actualPublicationPreservesRequiredPages() {
  const SampleMetadata metadata{3u * P, 1, 48000};
  std::array<float, P> pcm;
  pcm.fill(.25F);
  for (const auto protection : {0u, 1u, 2u, 3u}) {
    SamplePageCache cache;
    CHECK(cache.configure(109, &metadata, 1, 1));
    if (protection < 2)
      CHECK(cache.publish({109, 0, 0}, pcm.data(), P, 1, protection == 0));
    cache.beginQuantum();
    effetune::allocation_guard::Scope guard;
    CHECK(cache.beginAdmission() && cache.requestWindow(0, 0, P));
    CHECK(cache.admitForecast() == Admission::Admitted);
    if (protection < 2)
      CHECK(cache.commitForecast());
    float value = 0;
    if (protection == 1)
      CHECK(cache.readSample(0, 0, 0, value) == SampleReadStatus::Ready);
    if (protection == 2) {
      SamplePageRequest inFlight;
      CHECK(cache.takeRequests(&inFlight, 1) == 1 && inFlight.page == 0);
    }
    if (protection == 3)
      CHECK(cache.readSample(0, 0, 0, value) == SampleReadStatus::Unavailable);
    CHECK(cache.readSample(0, P, 0, value) == SampleReadStatus::Unavailable);
    // CONTROL may publish a known mandatory request before a batch is taken.
    // This also keeps the previous actual-but-not-in-flight request observable.
    CHECK(!cache.publish({109, 1, 0}, pcm.data(), P, 1));
    CHECK(!cache.admittedForecastValid() && !cache.requestOverflow());
    if (protection == 0) {
      CHECK(cache.resident(0, 0));
      CHECK(cache.readSample(0, 0, 0, value) == SampleReadStatus::Ready && value == .25F);
      continue;
    }
    if (protection >= 2) {
      SamplePageRequest queued;
      if (protection == 3)
        CHECK(cache.takeRequests(&queued, 1) == 1 && queued.page == 0);
      CHECK(cache.publish({109, 0, 0}, pcm.data(), P, 1));
      CHECK(cache.readSample(0, 0, 0, value) == SampleReadStatus::Ready && value == .25F);
      CHECK(!cache.publish({109, 1, 0}, pcm.data(), P, 1));
    }
    cache.beginQuantum();
    CHECK(cache.publish({109, 1, 0}, pcm.data(), P, 1));
    CHECK(cache.readSample(0, P, 0, value) == SampleReadStatus::Ready && value == .25F);
    CHECK(!cache.requestOverflow());
  }
}

void mandatoryQueueStillRejectsTrueOverflow() {
  const SampleMetadata metadata{(SamplePageCache::kMaxRequests + 1u) * P, 1, 48000};
  SamplePageCache cache;
  CHECK(cache.configure(110, &metadata, 1, 1));
  effetune::allocation_guard::Scope guard;
  float value = 0;
  for (std::size_t page = 0; page < SamplePageCache::kMaxRequests; ++page)
    CHECK(cache.readSample(0, page * P, 0, value) == SampleReadStatus::Unavailable);
  CHECK(!cache.requestOverflow());
  CHECK(cache.readSample(0, SamplePageCache::kMaxRequests * P, 0, value) ==
        SampleReadStatus::Overflow);
  CHECK(cache.requestOverflow());
}
} // namespace

int main() {
  dryPressureAndRecovery();
  replaceFullPredictionAndSourceUnion();
  residentAndCurrentQuantumProtection();
  actualAndOptionalRequestProtection();
  mixedFormatPressureAndAcknowledgements();
  invalidPlanAndSourceCapacity();
  actualReadRetiresOptionalPrediction();
  actualPublicationPreservesRequiredPages();
  mandatoryQueueStillRejectsTrueOverflow();
  CHECK(effetune::allocation_guard::violationCount() == 0);
  if (!failures)
    std::puts("forecast admission tests passed; no allocation guard violations");
  return failures ? 1 : 0;
}

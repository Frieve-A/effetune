#include "../../dsp/plugins/others/sfz/sample_cache.h"
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <new>
#include <source_location>
#include <stdexcept>
#include <vector>

namespace {
std::size_t allocations = 0;
void require(bool value, const std::source_location &where =
                             std::source_location::current()) {
  if (!value) {
    std::fprintf(stderr, "sample cache invariant failed at line %u\n",
                 where.line());
    throw std::runtime_error("sample cache invariant failed");
  }
}
void preparedPages(const char *path) {
  using namespace effetune::plugins::others::sfz;
  std::ifstream input(path, std::ios::binary);
  require(static_cast<bool>(input));
  std::vector<SampleMetadata> metadata;
  std::vector<std::streampos> positions;
  std::vector<std::uint32_t> lengths;
  while (input.peek() != std::char_traits<char>::eof()) {
    std::array<std::uint32_t, 4> header{};
    std::uint64_t frames = 0;
    input.read(reinterpret_cast<char *>(header.data()), sizeof(header));
    input.read(reinterpret_cast<char *>(&frames), sizeof(frames));
    require(static_cast<bool>(input) && header[0] < 10000u && header[1] >= 1 &&
            header[1] <= 2 && header[3] > 0 &&
            header[3] <= SamplePageCache::kPageFrames && frames >= header[3]);
    const auto sample = header[0];
    if (sample >= metadata.size()) {
      metadata.resize(sample + 1u);
      positions.resize(sample + 1u);
      lengths.resize(sample + 1u);
    }
    require(metadata[sample].frames == 0);
    metadata[sample] = {frames, header[1], header[2]};
    positions[sample] = input.tellg();
    lengths[sample] = header[3];
    input.seekg(static_cast<std::streamoff>(header[3]) * header[1] *
                    sizeof(float),
                std::ios::cur);
    require(static_cast<bool>(input));
  }
  require(!metadata.empty());
  for (const auto &sample : metadata)
    require(sample.frames != 0);
  SamplePageCache cache;
  require(
      cache.configure(99, metadata.data(), metadata.size(), metadata.size()));
  std::array<float, SamplePageCache::kPageFrames * 2> pcm{};
  std::array<float, 514> window{};
  cache.beginQuantum();
  const auto before = allocations;
  for (std::uint32_t sample = 0; sample < metadata.size(); ++sample) {
    input.clear();
    input.seekg(positions[sample]);
    input.read(reinterpret_cast<char *>(pcm.data()),
               static_cast<std::streamsize>(lengths[sample]) *
                   metadata[sample].channels * sizeof(float));
    require(static_cast<bool>(input));
    require(cache.publish({99, 0, sample}, pcm.data(), lengths[sample],
                          metadata[sample].channels, true));
    const auto count = lengths[sample] < window.size()
                           ? lengths[sample]
                           : static_cast<std::uint32_t>(window.size());
    for (std::uint32_t channel = 0; channel < metadata[sample].channels;
         ++channel) {
      require(cache.copyWindow(sample, lengths[sample] - count, count, channel,
                               window.data()));
      for (std::uint32_t i = 0; i < count; ++i)
        require(window[i] ==
                pcm[(lengths[sample] - count + i) * metadata[sample].channels +
                    channel]);
    }
  }
  require(allocations == before);
  std::printf("prepared pages: %zu samples, %zu cache bytes, exact native "
              "windows, zero render allocations\n",
              metadata.size(), cache.capacityBytes());
}
} // namespace

void *operator new(std::size_t size) {
  ++allocations;
  if (auto *pointer = std::malloc(size ? size : 1))
    return pointer;
  throw std::bad_alloc();
}
void *operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void *pointer) noexcept { std::free(pointer); }
void operator delete[](void *pointer) noexcept { std::free(pointer); }
void operator delete(void *pointer, std::size_t) noexcept {
  std::free(pointer);
}
void operator delete[](void *pointer, std::size_t) noexcept {
  std::free(pointer);
}

int main(int argc, char **argv) {
  if (argc == 2) {
    preparedPages(argv[1]);
    return 0;
  }
  using namespace effetune::plugins::others::sfz;
  SamplePageCache cache;
  const SampleMetadata metadata[] = {{8195, 2, 44100},
                                     {(1ull << 33) + 17, 1, 48000}};
  require(cache.configure(7, metadata, 2, 2));
  require(cache.capacityBytes() == 2u * 4096u * 2u * sizeof(float));
  std::array<float, 8192> pcm{};
  for (std::size_t i = 0; i < pcm.size(); ++i)
    pcm[i] = static_cast<float>(i) / 8192.0f;
  std::array<SamplePageRequest, 8> requests{};
  std::array<float, 514> window{};
  const auto before = allocations;
  cache.beginQuantum();
  require(!cache.copyWindow(0, 4000, 514, 1, window.data()));
  require(!cache.copyWindow(0, 4000, 514, 1, window.data()));
  require(cache.takeRequests(requests.data(), requests.size()) == 2);
  require(requests[0].generation == 7 && requests[0].page == 0 &&
          requests[1].page == 1);
  require(!cache.publish({6, 0, 0}, pcm.data(), 4096, 2));
  require(cache.publish(requests[0], pcm.data(), 4096, 2));
  require(cache.publish(requests[1], pcm.data(), 4096, 2));
  require(cache.copyWindow(0, 4000, 514, 1, window.data()));
  for (std::size_t i = 0; i < window.size(); ++i)
    require(window[i] == pcm[((4000 + i) % 4096) * 2 + 1]);
  require(!cache.publish({7, 2, 0}, pcm.data(), 3, 2));
  require(!cache.copyWindow(0, 8190, 6, 0, window.data()));
  cache.beginQuantum();
  require(cache.publish({7, 2, 0}, pcm.data(), 3, 2));
  require(cache.copyWindow(0, 8192, 3, 0, window.data()));
  require(!cache.publish({7, 2, 0}, pcm.data(), 4096, 2));
  require(!cache.publish({7, 3, 0}, pcm.data(), 4096, 2));
  require(!cache.publish({7, 0, 1}, pcm.data(), 4096, 2));
  cache.beginQuantum();
  require(cache.publish({7, (1ull << 33) / 4096, 1}, pcm.data(), 17, 1));
  require(cache.copyWindow(1, 1ull << 33, 17, 0, window.data()));
  require(window[16] == pcm[16]);
  // Repeated reuse must not degrade into an unbounded tombstone probe chain.
  for (std::uint64_t page = 0; page < 10000; ++page) {
    cache.beginQuantum();
    require(cache.publish({7, page, 1}, pcm.data(), 4096, 1));
    float value = 0;
    require(cache.sample(1, page * 4096 + 17, 0, value));
    require(value == pcm[17]);
  }
  require(allocations == before);
  require(!cache.requestOverflow());
  require(cache.configure(8, metadata, 2, 2));
  require(!cache.publish({7, 0, 0}, pcm.data(), 4096, 2));
  float value = 0;
  require(!cache.sample(0, 0, 0, value));
  require(cache.takeRequests(requests.data(), requests.size()) == 1);
  require(requests[0].generation == 8);
  require(cache.publish({8, 0, 0}, pcm.data(), 4096, 2, true));
  cache.beginQuantum();
  require(cache.publish({8, 0, 1}, pcm.data(), 4096, 1));
  cache.beginQuantum();
  require(cache.publish({8, 1, 1}, pcm.data(), 4096, 1));
  require(cache.sample(0, 17, 1, value));
  require(value == pcm[35]);
  require(cache.configure(9, metadata, 2, 3));
  const auto forecastAllocations = allocations;
  require(cache.publish({9, 0, 0}, pcm.data(), 4096, 2, true));
  require(cache.beginForecast());
  require(!cache.requestWindow(1, 0, 4096));
  require(cache.takeRequests(requests.data(), requests.size()) == 1);
  require(!cache.commitForecast());
  require(!cache.sample(1, 17, 0, value));
  require(!cache.requestWindow(1, 0, 4096));
  require(cache.takeRequests(requests.data(), requests.size()) == 0);
  require(cache.publish(requests[0], pcm.data(), 4096, 1));
  require(cache.commitForecast());
  cache.beginQuantum();
  require(cache.beginForecast());
  require(cache.requestWindow(1, 0, 4096));
  require(!cache.requestWindow(1, 4096, 4096));
  require(!cache.commitForecast());
  require(cache.takeRequests(requests.data(), requests.size()) == 1);
  require(cache.publish(requests[0], pcm.data(), 4096, 1));
  cache.beginQuantum();
  require(!cache.publish({9, 2, 1}, pcm.data(), 4096, 1));
  cache.cancelForecast();
  cache.beginQuantum();
  require(cache.publish({9, 2, 1}, pcm.data(), 4096, 1));
  require(cache.sample(1, 17, 0, value));
  require(cache.beginForecast());
  require(cache.requestWindow(1, 8192, 4096));
  require(cache.commitForecast());
  cache.beginQuantum();
  require(cache.publish({9, 3, 1}, pcm.data(), 4096, 1));
  require(!cache.sample(1, 17, 0, value));
  require(cache.sample(1, 8192 + 17, 0, value));
  require(cache.takeRequests(requests.data(), requests.size()) == 1);
  cache.clearForecast();
  cache.beginQuantum();
  require(cache.publish({9, 4, 1}, pcm.data(), 4096, 1));
  require(cache.resident(0, 0));
  cache.beginQuantum();
  require(cache.beginForecast());
  require(!cache.requestWindow(1, 5u * 4096u, 4096));
  require(cache.takeRequests(requests.data(), requests.size()) == 1);
  cache.cancelForecast();
  require(cache.beginForecast());
  require(!cache.requestWindow(1, 5u * 4096u, 4096));
  require(cache.takeRequests(requests.data(), requests.size()) == 1);
  require(!cache.commitForecast());
  require(cache.publish(requests[0], pcm.data(), 4096, 1));
  require(cache.commitForecast());
  require(allocations == forecastAllocations);
  cache.beginQuantum();
  require(cache.beginForecast());
  require(!cache.requestWindow(1, 0, 8192));
  require(cache.requestOverflow());
  require(cache.takeRequests(requests.data(), requests.size()) == 1);
  require(cache.publish(requests[0], pcm.data(), 4096, 1));
  require(!cache.commitForecast());
  require(allocations == forecastAllocations);
  std::puts("sample cache: page boundaries, generation, pinning, 64-bit "
            "positions, forecast commit/cancel/retention, zero render "
            "allocations passed");
}

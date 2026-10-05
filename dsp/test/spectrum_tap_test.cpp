#include "allocation_guard.h"
#include "effetune/spectrum_tap.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

namespace {
using namespace effetune;
int failures = 0;
void check(bool condition, int line) {
  if (!condition) {
    std::fprintf(stderr, "spectrum_tap_test:%d failed\n", line);
    ++failures;
  }
}
#define CHECK(x) check((x), __LINE__)
constexpr double kPi = 3.14159265358979323846;
std::vector<SpectrumTapFrame> feed(SpectrumTap &tap, std::uint64_t origin, std::uint32_t count,
                                   double rate, bool segmented = true) {
  std::vector<SpectrumTapFrame> result;
  std::array<float, 2 * 256> input{}, output{};
  std::uint32_t dropped = 0;
  for (std::uint32_t offset = 0; offset < count;) {
    const auto frames = std::min(segmented ? 1u + (offset % 251u) : 256u, count - offset);
    for (std::uint32_t i = 0; i < frames; ++i) {
      const double t = offset + i;
      input[i] = input[frames + i] = static_cast<float>(std::sin(2 * kPi * 1000 * t / rate));
      output[i] = output[frames + i] =
          t >= 64 ? static_cast<float>(0.5 * std::sin(2 * kPi * 1000 * (t - 64) / rate)) : 0;
    }
    {
      allocation_guard::Scope guard;
      tap.capture(input.data(), 2, frames, origin + offset, 64, 512, true);
      tap.capture(output.data(), 2, frames, origin + offset, 64, 512, false);
    }
    auto fresh = tap.read(dropped);
    CHECK(dropped == 0);
    result.insert(result.end(), fresh.begin(), fresh.end());
    offset += frames;
  }
  return result;
}
void printFrame(const SpectrumTapFrame &frame) {
  std::printf("{\"sampleRate\":%.0f,\"quality\":\"%s\",\"timing\":{\"version\":1,"
              "\"generation\":%llu,\"frameIndex\":%llu,\"captureEndFrame\":%llu,"
              "\"windowAgeFrames\":%u,\"completionFrames\":%u,\"tapDelayFrames\":%u},"
              "\"validCellCount\":%u,\"input\":[",
              frame.sampleRate, frame.quality == SpectrumTapQuality::HQ ? "hq" : "normal",
              static_cast<unsigned long long>(frame.timing.generation),
              static_cast<unsigned long long>(frame.timing.frameIndex),
              static_cast<unsigned long long>(frame.timing.captureEndFrame),
              frame.timing.windowAgeFrames, frame.timing.completionFrames,
              frame.timing.tapDelayFrames, frame.output.validCellCount);
  for (std::uint32_t i = 0; i < 2048; ++i)
    std::printf("%s%.9g", i ? "," : "", frame.input.current[i]);
  std::printf("],\"output\":[");
  for (std::uint32_t i = 0; i < 2048; ++i)
    std::printf("%s%.9g", i ? "," : "", frame.output.current[i]);
  std::printf("]}");
}
} // namespace
int main(int argc, char **argv) {
  const bool exporting = argc == 2 && std::strcmp(argv[1], "--export") == 0;
  if (exporting)
    std::printf("[");
  bool first = true;
  for (const auto rate : {48000.0, 96000.0}) {
    for (const auto quality : {SpectrumTapQuality::Normal, SpectrumTapQuality::HQ}) {
      SpectrumTap tap;
      CHECK(tap.prepare(rate, 256));
      CHECK(tap.configure(SpectrumTapMode::Compare, quality));
      auto frames = feed(tap, 48000, 48000, rate);
      CHECK(!frames.empty());
      if (frames.empty())
        continue;
      const auto &last = frames.back();
      const auto profile = spectrumTapTiming(quality, rate);
      CHECK(last.timing.windowAgeFrames == profile.windowAgeFrames);
      CHECK(last.timing.requiredOutputDelay(100, 200, 100000) ==
            profile.windowAgeFrames + profile.completionFrames - 812);
      CHECK(last.timing.audibleFrame(100) ==
            static_cast<double>(last.timing.captureEndFrame) - profile.windowAgeFrames + 612);
      CHECK(last.output.validCellCount <= 2048);
      for (std::size_t i = 0; i < frames.size(); ++i) {
        CHECK(frames[i].timing.frameIndex == i);
        if (i)
          CHECK(frames[i].timing.captureEndFrame > frames[i - 1].timing.captureEndFrame);
      }
      for (std::uint32_t i = 0; i < last.output.validCellCount; ++i) {
        CHECK(std::isfinite(last.output.current[i]));
        if (last.input.current[i] > -60)
          CHECK(std::abs(last.output.current[i] - last.input.current[i] + 6.0206F) < 0.02F);
      }
      SpectrumTap whole;
      CHECK(whole.prepare(rate, 256));
      CHECK(whole.configure(SpectrumTapMode::Compare, quality));
      const auto wholeFrames = feed(whole, 48000, 48000, rate, false);
      CHECK(wholeFrames.size() == frames.size());
      CHECK(wholeFrames.back().output.current == last.output.current);
      CHECK(wholeFrames.back().timing.captureEndFrame == last.timing.captureEndFrame);
      if (exporting) {
        if (!first)
          std::printf(",");
        printFrame(last);
        first = false;
      }
      const auto oldGeneration = last.timing.generation;
      const auto resumed = feed(tap, 0, 24000, rate);
      CHECK(!resumed.empty() && resumed.back().timing.generation > oldGeneration);
      CHECK(tap.configure(SpectrumTapMode::After, quality));
      const auto after = feed(tap, 0, 24000, rate);
      CHECK(!after.empty() && after.back().mode == SpectrumTapMode::After);
      CHECK(after.back().input.current == SpectrumTapSpectrum{}.current);
      CHECK(tap.configure(SpectrumTapMode::Off, quality));
      CHECK(feed(tap, 0, 4096, rate).empty());
    }
  }
  SpectrumTap overflow;
  CHECK(overflow.prepare(48000, 256));
  CHECK(overflow.configure(SpectrumTapMode::After, SpectrumTapQuality::Normal));
  std::array<float, 256> block{};
  for (std::uint32_t i = 0; i < 256; ++i) {
    overflow.capture(block.data(), 1, 256, i * 256u, 0, 0, true);
    overflow.capture(block.data(), 1, 256, i * 256u, 0, 0, false);
  }
  std::uint32_t dropped = 0;
  CHECK(overflow.read(dropped).empty() && dropped != 0);
  CHECK(!feed(overflow, 65536, 4096, 48000).empty());
  CHECK(allocation_guard::violationCount() == 0);
  if (exporting)
    std::printf("]\n");
  return failures ? 1 : 0;
}

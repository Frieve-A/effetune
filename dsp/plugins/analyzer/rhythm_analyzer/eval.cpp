// Bounded, file-based production numeric/evaluation driver. No dataset paths are compiled in.
#include "effetune/dsp/denormal_noise.h"
#include "evaluation.h"
#include "rd6_engine.h"
#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_RhythmAnalyzerPlugin() noexcept;

namespace {
using namespace effetune::plugins::analyzer;
using namespace rhythm_a3;
std::uint32_t readU32(const std::uint8_t *p) {
  return p[0] | (std::uint32_t(p[1]) << 8u) | (std::uint32_t(p[2]) << 16u) |
         (std::uint32_t(p[3]) << 24u);
}
float readF32(const std::uint8_t *p) {
  const auto bits = readU32(p);
  float value;
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}
struct FileCloser {
  void operator()(std::FILE *p) const noexcept {
    if (p)
      std::fclose(p);
  }
};
using File = std::unique_ptr<std::FILE, FileCloser>;
File openFile(const char *path, const char *mode) {
#if defined(_MSC_VER)
  std::FILE *file = nullptr;
  return fopen_s(&file, path, mode) == 0 ? File(file) : File(nullptr);
#else
  return File(std::fopen(path, mode));
#endif
}
struct Writer {
  std::FILE *file;
  static void decoderForward(void *context, const Rd6Event &e) {
    std::fprintf(static_cast<Writer *>(context)->file,
                 "{\"kind\":\"forward\",\"beat_tick\":%.17g,\"decision_tick\":%lld,\"period_"
                 "ticks\":%.17g,\"shown\":%s}\n",
                 e.tick, static_cast<long long>(e.decision), e.period, e.shown ? "true" : "false");
  }
  static void decoderAnalysis(void *context, const Rd6Event &e) {
    std::fprintf(static_cast<Writer *>(context)->file,
                 "{\"kind\":\"analysis\",\"beat_tick\":%.17g,\"decision_tick\":%lld,\"period_"
                 "ticks\":%.17g}\n",
                 e.tick, static_cast<long long>(e.decision), e.period);
  }
  void event(const char *kind, const BeatEvent &e) {
    std::fprintf(file,
                 "{\"kind\":\"%s\",\"time\":%.17g,\"emitted\":%.17g,\"decision_tick\":%lld,"
                 "\"period\":%.17g,\"confidence\":%.9g,\"shown\":%s,\"epoch\":%u,\"index\":%lld}\n",
                 kind, e.time, e.emitted, static_cast<long long>(e.tick), e.period, e.confidence,
                 e.shown ? "true" : "false", e.epoch, static_cast<long long>(e.index));
  }
  static void forward(void *context, const BeatEvent &e) {
    static_cast<Writer *>(context)->event("forward", e);
  }
  static void analysis(void *context, const BeatEvent &e) {
    static_cast<Writer *>(context)->event("analysis", e);
  }
};
} // namespace
int main(int argc, char **argv) {
  if (argc == 2 && std::strcmp(argv[1], "--help") == 0) {
    std::puts("Rhythm Analyzer production numeric and streaming evaluation driver");
    return 0;
  }
  if (argc < 4) {
    std::fprintf(stderr, "Usage: rhythm-eval network|frontend|decode|stream input.f32 output "
                         "[rings.u16|hostRate]\n");
    return 2;
  }
  File input = openFile(argv[2], "rb"), output = openFile(argv[3], "wb");
  if (!input || !output)
    return 2;
  Writer writer{output.get()};
  if (std::strcmp(argv[1], "network") == 0) {
    auto network = std::make_unique<TcTcn>();
    float features[500], values[63];
    while (std::fread(features, sizeof(float), 500u, input.get()) == 500u) {
      network->push(features, values);
      if (std::fwrite(values, sizeof(float), 63u, output.get()) != 63u)
        return 2;
    }
    if (argc > 4) {
      File ring = openFile(argv[4], "wb");
      if (!ring ||
          std::fwrite(network->ring(), 1u, TcTcn::stateBytes(), ring.get()) != TcTcn::stateBytes())
        return 2;
    }
  } else if (std::strcmp(argv[1], "frontend") == 0) {
    auto frontend = std::make_unique<TcFrontEnd>();
    frontend->prepare();
    float audio[256];
    while (std::fread(audio, sizeof(float), 256u, input.get()) == 256u) {
      for (float sample : audio)
        frontend->push(sample);
      if (std::fwrite(frontend->features(), sizeof(float), 500u, output.get()) != 500u)
        return 2;
    }
  } else if (std::strcmp(argv[1], "decode") == 0) {
    auto decoder = std::make_unique<Rd6Decoder>();
    decoder->prepare(40.0, 240.0);
    decoder->sink = {&writer, &Writer::decoderForward, &Writer::decoderAnalysis};
    float values[63];
    while (std::fread(values, sizeof(float), 63u, input.get()) == 63u) {
      decoder->push(values[0], values + 2u);
      std::fprintf(output.get(),
                   "{\"kind\":\"tick\",\"tick\":%lld,\"period_ticks\":%.17g,\"confidence\":%.17g,"
                   "\"evidence\":%.17g,\"short\":%.17g,\"shown\":%s}\n",
                   static_cast<long long>(decoder->ticks() - 1), decoder->period(),
                   decoder->confidence(), decoder->evidence(), decoder->shortEvidence(),
                   decoder->shown() ? "true" : "false");
    }
    decoder->flush();
  } else if (std::strcmp(argv[1], "stream") == 0 && argc > 4) {
    const double rate = std::strtod(argv[4], nullptr);
    const auto analysisRate = rhythm_d::RateRule::analysisRate(rate);
    if (analysisRate == 0u)
      return 2;
    const auto *descriptor = et_kernel_descriptor_RhythmAnalyzerPlugin();
    alignas(std::max_align_t) std::array<std::byte, 8192> storage{};
    if (descriptor->objectSize > storage.size())
      return 2;
    auto *kernel = descriptor->construct(storage.data());
    kernel->prepare({static_cast<float>(rate), 1u, 128u});
    const float params[3]{40.0f, 240.0f, 0.0f};
    if (!kernel->preparedSuccessfully() ||
        kernel->stageParameters(params, 3u, descriptor->paramsHash) != ET_OK) {
      descriptor->destroy(kernel);
      return 2;
    }
    observeRhythm(*kernel, {&writer, &Writer::forward, &Writer::analysis, nullptr, nullptr});
    effetune::dsp::NyquistDenormalNoise noise;
    std::array<std::uint8_t, 16384> ringBytes{}, packets{};
    effetune::TelemetryRing ring;
    ring.adopt(ringBytes.data(), static_cast<std::uint32_t>(ringBytes.size()));
    std::uint32_t sequence = 0u;
    float audio[128];
    std::size_t count;
    std::uint64_t inputCount = 0u;
    while ((count = std::fread(audio, sizeof(float), 128u, input.get())) != 0u) {
      for (std::uint32_t i = 0u; i < count; ++i)
        audio[i] = static_cast<float>(audio[i] + noise.sample(i));
      noise.advance(static_cast<std::uint32_t>(count));
      kernel->applyPendingParameters();
      kernel->process(audio, 1u, static_cast<std::uint32_t>(count),
                      {static_cast<double>(inputCount) / rate});
      inputCount += count;
      effetune::TelemetryWriter telemetry(ring, 207u, sequence);
      kernel->writeTelemetry(telemetry);
      const auto bytes =
          ring.read(packets.data(), static_cast<std::uint32_t>(packets.size()), nullptr);
      if (bytes >= 1360u) {
        const auto *p = packets.data() + 16u;
        std::fprintf(output.get(),
                     "{\"kind\":\"header\",\"tick\":%u,\"generation\":%u,\"epoch\":%u,"
                     "\"period\":%.9g,\"shown\":%s}\n",
                     readU32(p + 12u), readU32(p + 4u), readU32(p + 36u), readF32(p + 44u),
                     readU32(p + 32u) ? "true" : "false");
      }
    }
    flushRhythm(*kernel);
    descriptor->destroy(kernel);
  } else
    return 2;
  return std::ferror(input.get()) || std::ferror(output.get()) ? 2 : 0;
}

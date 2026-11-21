#pragma once
#include "engine.h"

namespace effetune::audio {
struct NetworkPaths {
  Engine::RoutedTaps taps{};
  std::array<Engine::PipelineTapLatency, Engine::kMaxPipelineNodes> latencies{};
  std::array<unsigned, Engine::kMaxPipelineNodes> pluginIds{};
  unsigned count = 0, sendId = 0, receiveId = 0;
  unsigned sampleRate = 0, latency = 0, outputDelay = 0, localDelay = 0;
  std::uint64_t revision = 0, tapRevision = 0, localDelayRevision = 0, generation = 0;
  bool bypassed = false, receiving = false;
  const char *stage = "pipeline";
};
} // namespace effetune::audio

#pragma once

#include "mp3_core.h"

#include "effetune/kernel.h"

#include <array>
#include <cstdint>

namespace effetune::plugins::lofi::mp3 {

struct ProductionDiagnosticSnapshot final {
  std::uint64_t completedFrames = 0u;
  std::uint64_t schedulerDeadlineMisses = 0u;
  std::uint64_t outputUnderflowsAfterStartup = 0u;
  std::uint32_t resamplerBuildCount = 0u;
  std::uint32_t frameSamples = 0u;
  std::uint32_t minimumFrameCompletionMargin = 0u;
  LogicalFrame logical{};
  std::array<float, kMaximumChannels * 1152u> decodedPcm{};
};

} // namespace effetune::plugins::lofi::mp3

extern "C" bool et_mp3_copy_production_diagnostic(
    const effetune::PluginKernel *kernel,
    effetune::plugins::lofi::mp3::ProductionDiagnosticSnapshot *snapshot) noexcept;

extern "C" bool
et_mp3_render_production_logical_frames(effetune::PluginKernel *kernel,
                                        const effetune::plugins::lofi::mp3::LogicalFrame *frames,
                                        std::uint32_t frame_count, float *decoded_pcm) noexcept;

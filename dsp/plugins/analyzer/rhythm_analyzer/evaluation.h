// Internal observers for the dedicated evaluation executable; absent from production builds.
#pragma once
#include "effetune/kernel.h"
#include "rd6_engine.h"

namespace effetune::plugins::analyzer {
void observeRhythm(PluginKernel &, const rhythm_a3::Rd6Engine::Sink &) noexcept;
void flushRhythm(PluginKernel &) noexcept;
} // namespace effetune::plugins::analyzer

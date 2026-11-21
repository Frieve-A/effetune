#include "visualizer.h"
#include "engine.h"
#include "registry.h"
#include "stream_boundaries.h"
#include <algorithm>
#include <stdexcept>

namespace effetune::audio {
Visualizer::Visualizer(unsigned sampleRate, unsigned frames)
    : engine_(std::make_unique<Engine>()), rate_(sampleRate) {
  if (engine_->prepare(static_cast<float>(sampleRate), 2, std::max(32u, frames), 65536) != ET_OK)
    throw std::runtime_error("cannot prepare visualizer");
}
Visualizer::~Visualizer() = default;
void Visualizer::reset() noexcept { engine_->reset(); }
void Visualizer::setRate(float hz) noexcept { engine_->setTelemetryRate(hz); }
bool Visualizer::configure(const std::vector<VisualizerSource> &sources) {
  std::erase_if(slots_, [&](const auto &item) {
    const auto it = std::find_if(sources.begin(), sources.end(),
                                 [&](const auto &s) { return s.tap == item.first; });
    if (it != sources.end()) {
      const auto &old = item.second.source;
      if (old == *it)
        return false;
      // Rhythm's fourth parameter only selects which analysis to display.
      if (old.type == "RhythmAnalyzerPlugin" && it->type == old.type && it->hash == old.hash &&
          it->left == old.left && it->right == old.right && it->gain == old.gain &&
          old.params.size() == 4 && it->params.size() == 4 &&
          std::equal(old.params.begin(), old.params.begin() + 3, it->params.begin()))
        return false;
    }
    engine_->destroyInstance(item.second.instance);
    return true;
  });
  for (const auto &s : sources) {
    const auto *kernel = registry::find(s.type.c_str());
    if (!kernel || kernel->paramsHash != s.hash || kernel->paramsFloatCount != s.params.size() ||
        s.tap < 0xf0000000u)
      return false;
    auto it = slots_.find(s.tap);
    if (it != slots_.end() && it->second.source == s)
      continue;
    const auto instance =
        it == slots_.end() ? engine_->createInstance(s.type.c_str()) : it->second.instance;
    if (!instance)
      return false;
    if ((it == slots_.end() && engine_->setInstanceTap(instance, s.tap) != ET_OK) ||
        engine_->setInstanceParams(instance, s.params.data(),
                                   static_cast<unsigned>(s.params.size()), s.hash, 0) != ET_OK) {
      if (it == slots_.end())
        engine_->destroyInstance(instance);
      return false;
    }
    if (it == slots_.end())
      slots_.emplace(s.tap, Slot{s, instance});
    else
      it->second.source = s;
  }
  return true;
}
void Visualizer::streamBoundary(BoundarySlice &slice, unsigned inputDelay) noexcept {
  for (auto &[id, slot] : slots_) {
    (void)id;
    slice.visit(*engine_, slot.instance, slot.source.type, inputDelay, slot.lastBoundary);
  }
}
void Visualizer::render(const float *audio, unsigned channels, unsigned frames,
                        std::uint64_t position, Telemetry &telemetry, std::uint64_t revision,
                        VisualizerStage stage) noexcept {
  auto *scratch = engine_->combined();
  for (const auto &[id, slot] : slots_) {
    (void)id;
    for (unsigned ch = 0; ch < 2; ++ch) {
      const auto source = ch ? slot.source.right : slot.source.left;
      for (unsigned i = 0; i < frames; ++i)
        scratch[ch * frames + i] =
            source < channels ? audio[source * frames + i] * slot.source.gain : 0.f;
    }
    engine_->processInstance(slot.instance, scratch, 2, frames, double(position) / rate_);
  }
  telemetry.read(*engine_, position + frames, revision, stage);
}
} // namespace effetune::audio

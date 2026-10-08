#include "NoteSpectrogramPluginParams.h"
#include "spectral_analysis.h"

namespace effetune::plugins::analyzer {
class NoteSpectrogramKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::NoteSpectrogramPluginParams)
public:
  void prepare(const PrepareInfo &info) override {
    analysis_ = std::make_unique<SpectralAnalysis>();
    analysis_->prepare(info);
    parameter_sync_required_ = true;
    reset();
  }
  bool preparedSuccessfully() const noexcept override { return analysis_ && analysis_->ready(); }
  void reset() noexcept override {
    if (++generation_ == 0u)
      ++generation_;
    channels_ = 0u;
    if (analysis_)
      analysis_->reset(generation_);
  }
  void process(float *audio, std::uint32_t channels, std::uint32_t frames,
               const ProcessInfo &info) noexcept override {
    synchronizeParameters();
    if (channels_ != 0u && channels != channels_)
      reset();
    channels_ = channels;
    if (analysis_)
      analysis_->process(audio, channels, frames, info);
  }
  const NoteAnalysisView *noteAnalysisView() const noexcept override {
    return analysis_ ? &analysis_->view() : nullptr;
  }
  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (analysis_)
      analysis_->writeTelemetry(writer);
  }

private:
  void synchronizeParameters() noexcept {
    if (!analysis_ || (!paramsDirty() && !parameter_sync_required_))
      return;
    const auto initial = parameter_sync_required_;
    parameter_sync_required_ = false;
    const auto bounded = [](float value, int fallback) {
      if (!std::isfinite(value))
        return fallback;
      const auto rounded = static_cast<int>(std::round(value));
      return rounded < 21 ? 21 : rounded > 108 ? 108 : rounded;
    };
    const auto minimum = bounded(params_.minimumMidi, 28);
    const auto maximum = std::max(minimum, bounded(params_.maximumMidi, 91));
    if (!analysis_->configure(static_cast<std::uint32_t>(minimum),
                              static_cast<std::uint32_t>(maximum))) {
      if (initial)
        analysis_->reset(generation_);
      return;
    }
    if (initial)
      analysis_->reset(generation_);
    else
      reset();
  }
  std::unique_ptr<SpectralAnalysis> analysis_;
  std::uint32_t generation_ = 0u, channels_ = 0u;
  bool parameter_sync_required_ = true;
};
static_assert(sizeof(NoteSpectrogramKernel) <= 8192u);
} // namespace effetune::plugins::analyzer
EFFETUNE_REGISTER_KERNEL(NoteSpectrogramPlugin, effetune::plugins::analyzer::NoteSpectrogramKernel)

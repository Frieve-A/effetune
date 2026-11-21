#include "session.h"
#include "allocation_guard.h"
#include "engine.h"
#include "io_pipeline.h"
#include "pipeline.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cstring>
#if defined(__x86_64__) || defined(_M_X64)
#include <xmmintrin.h>
#endif

namespace effetune::audio {
std::uint32_t SessionFormat::width() const noexcept {
  return std::max(inputChannels, outputChannels);
}
Session::Session() : Session(false) {}
Session::Session(bool secondary) {
  if (!secondary)
    feed_ = std::make_unique<ClockedFifo>(16, 131072);
}
Session::~Session() = default;

bool Session::open(SessionFormat format) {
  if (!format.deviceRate)
    format.deviceRate = format.sampleRate;
  if (!format.captureRate)
    format.captureRate = format.sampleRate;
  const auto validRate = [](unsigned rate) { return rate >= 8000 && rate <= 384000; };
  if (isOpen() || !validRate(format.sampleRate) || !validRate(format.deviceRate) ||
      !validRate(format.captureRate) || format.outputChannels == 0 || format.width() > 16 ||
      format.periodFrames == 0 || format.periodFrames > 32768)
    return false;
  auto engine = std::make_unique<Engine>();
  constexpr std::array<std::uint8_t, 8> emptyPipeline{Engine::kPipelineDescriptorVersion};
  if (engine->prepare(static_cast<float>(format.sampleRate), format.width(),
                      std::max(format.periodFrames, 32u), 65536) != ET_OK ||
      engine->configurePipeline(emptyPipeline.data(), emptyPipeline.size()) != ET_OK)
    return false;
  io_ = std::make_unique<IoPipeline>(format, feed_.get());
  engine_ = std::move(engine);
  engine_->setPipelineObserver(
      [](void *context, et_instance instance, const float *planar, std::uint32_t channels,
         std::uint32_t frames, std::uint32_t latency, bool before) noexcept {
        auto &session = *static_cast<Session *>(context);
        if (before && instance == session.io_->sendInstance)
          session.io_->captureSendMarker(planar, channels, frames, latency);
        if (session.spectrum_->observing() && !session.power_->config().displayBypass &&
            session.telemetry_->enabled)
          session.spectrum_->capture(instance, planar, channels, frames, latency, before,
                                     session.position_, session.io_->routeRevision);
      },
      this);
  pipeline_ =
      std::make_unique<Pipeline>(*engine_, format.sampleRate, std::max(format.periodFrames, 32u));
  output_.open(format.sampleRate, format.width());
  telemetry_ = std::make_unique<Telemetry>();
  power_ = std::make_unique<PowerControl>();
  spectrum_ = std::make_unique<SpectrumTaps>(format.sampleRate, format.periodFrames);
  dry_.resize(std::size_t(format.width()) * format.periodFrames);
  preview_ = {};
  bypass_ = false;
  ranDsp_ = latencyGate_ = false;
  latencyChanged_ = false;
  latencyReservationNeeded_ = false;
  format_ = format;
  maxBlock_ = format.periodFrames;
  position_ = 0;
  return true;
}

bool Session::reconfigureDevice(SessionFormat format) {
  if (!engine_ || format.sampleRate != format_.sampleRate || format.width() != format_.width())
    return false;
  if (!format.captureRate)
    format.captureRate = format.sampleRate;
  if (!format.periodFrames || format.periodFrames > 32768 || format.deviceRate < 8000 ||
      format.deviceRate > 384000)
    return false;
  io_->reconfigureDevice(format);
  format_ = format;
  return true;
}

void Session::close() noexcept {
  stopParallel();
  retired_.reset();
  io_.reset();
  pipeline_.reset();
  telemetry_.reset();
  power_.reset();
  visualizer_.reset();
  spectrum_.reset();
  latencyReservationNeeded_ = false;
  boundaries_ = {};
  engine_.reset();
  position_ = 0;
}

bool Session::startParallel(bool selectB) {
  if (!feed_ || !engine_ || parallelOwner_)
    return false;
  if (retired_ && inUse_.load() != retired_.get())
    retired_.reset();
  if (retired_)
    return false;
  auto path = std::make_unique<Parallel>();
  path->b = std::unique_ptr<Session>(new Session(true));
  auto branchFormat = format_;
  branchFormat.periodFrames = maxBlock_;
  if (!path->b->open(branchFormat))
    return false;
  path->input.resize(std::size_t(maxBlock_) * format_.width());
  path->selection.store(static_cast<unsigned>(selectB));
  path->targetB = selectB;
  path->gainB = selectB ? 1.f : 0.f;
  parallelOwner_ = std::move(path);
  published_.store(parallelOwner_.get());
  return true;
}

void Session::stopParallel() noexcept {
  if (!parallelOwner_)
    return;
  published_.store(nullptr);
  if (inUse_.load() == parallelOwner_.get())
    retired_ = std::move(parallelOwner_);
  else
    parallelOwner_.reset();
}

void Session::selectParallel(bool selectB, double duration) noexcept {
  if (!parallelOwner_)
    return;
  const auto frames =
      static_cast<unsigned>(std::clamp(duration, 0., 60.) * format_.sampleRate + .5);
  parallelOwner_->selection.store(frames * 2 + static_cast<unsigned>(selectB),
                                  std::memory_order_relaxed);
}

Session *Session::branch(unsigned index) noexcept {
  return index == 0 ? this : index == 1 && parallelOwner_ ? parallelOwner_->b.get() : nullptr;
}

ClockedFifo &Session::capture() noexcept { return io_->capture(); }

unsigned Session::latency() const noexcept {
  return engine_ && !bypass_ ? engine_->pipelineLatency() : 0;
}
bool Session::setTelemetryRate(float hz) noexcept {
  if (!engine_ || engine_->setTelemetryRate(hz) != ET_OK)
    return false;
  telemetryRate_ = hz;
  if (visualizer_)
    visualizer_->setRate(hz);
  return true;
}
void Session::exchangeVisualizer(std::unique_ptr<Visualizer> &next) noexcept {
  visualizer_.swap(next);
  if (visualizer_)
    visualizer_->setRate(telemetryRate_);
}
void Session::preview(double frequency, bool noise) noexcept {
  if (preview_.configure(frequency, noise, format_.sampleRate))
    pipeline_->preview(preview_.active());
}
bool Session::resetProcessing() {
  if (!engine_ || engine_->reset() != ET_OK)
    return false;
  spectrum_->reset();
  if (visualizer_)
    visualizer_->reset();
  output_.resetHistory();
  cpuFrames_ = 0;
  cpuMs_ = 0;
  power_->resetLevels();
  return true;
}
void Session::overload(bool enabled, double delay, double headroom) noexcept {
  overloadEnabled_ = enabled;
  overloadStart_ =
      position() + static_cast<std::uint64_t>(std::clamp(delay, 0., 86400.) * format_.sampleRate);
  headroom_ = headroom > 0 ? std::clamp(headroom, 8., 20.) : 10.;
  credit_ = headroom_;
  if (overloaded_)
    overloadEvent_.store(0);
  overloaded_ = false;
}

void Session::setMasterBypass(bool bypass) {
  bypass_ = bypass;
  if (pipeline_)
    pipeline_->setNetworkRouting(io_->receiving, bypass);
}
bool Session::updateParameter(PluginSettings &settings) {
  const auto before = pipeline_->kernelLatency(settings.id);
  bool deferred = false;
  if (!pipeline_->stageUpdate(settings, ranDsp_ && !bypass_ && !output_.topologySilent(), deferred))
    return false;
  if (deferred) {
    latencyGate_ = true;
    output_.closeTopology();
  } else if (before != pipeline_->kernelLatency(settings.id))
    return refreshLatency(false);
  return true;
}

bool Session::refreshLatency(bool gated) noexcept {
  const auto status = engine_->refreshPipelineLatencyRealtime();
  if (status == ET_ERR_STATE) {
    // Only the control owner can grow delay lines. Keep rendering behind the
    // closed gate until it has reserved the plan for the live kernel latencies.
    latencyGate_ = true;
    output_.closeTopology();
    if (gated)
      latencyReservationNeeded_.store(true);
    return true;
  }
  if (status != ET_OK)
    return false;
  io_->markTapChanged();
  latencyChanged_.store(true);
  if (gated) {
    latencyGate_ = false;
    output_.settleTopology();
  }
  return true;
}

bool Session::reserveLatency() {
  if (engine_->reservePipelineLatency() != ET_OK)
    return false;
  latencyReservationNeeded_.store(false);
  return true;
}

bool Session::replaceInput(unsigned channels, unsigned sampleRate) {
  return io_ && io_->replaceInput(format_, channels, sampleRate);
}

bool Session::renderDevice(std::span<float> output, unsigned frames,
                           std::span<const float> synchronousInput, bool discard) noexcept {
  if (!feed_ || !io_ || !frames || output.size() != std::size_t(frames) * format_.outputChannels ||
      (!synchronousInput.empty() &&
       synchronousInput.size() != std::size_t(frames) * io_->captureChannels()))
    return false;
  return io_->renderDevice(*this, output.data(), frames,
                           synchronousInput.empty() ? nullptr : synchronousInput.data(), discard);
}

bool Session::render(std::span<float> planar, std::uint32_t frames,
                     std::optional<FeedTime> feedTime) noexcept {
  if (!engine_ || frames == 0 || planar.size() != std::size_t(frames) * format_.width())
    return false;
#if defined(__x86_64__) || defined(_M_X64)
  _mm_setcsr(_mm_getcsr() | 0x8040u);
#elif defined(__aarch64__)
  std::uint64_t fpcr;
  __asm__ volatile("mrs %0, fpcr" : "=r"(fpcr));
  fpcr |= std::uint64_t{1} << 24;
  __asm__ volatile("msr fpcr, %0" : : "r"(fpcr));
#endif
  for (std::uint32_t offset = 0; offset < frames;) {
    const auto started = std::chrono::steady_clock::now();
    if (latencyGate_ && output_.topologySilent() && !needsLatencyReservation()) {
      if (!pipeline_->finishUpdates() || !refreshLatency(true))
        return false;
    }
    const auto quantum = std::min({maxBlock_, format_.periodFrames, frames - offset});
    const FeedTime clock = feedTime
                               ? FeedTime{feedTime->first + offset * feedTime->step, feedTime->step}
                               : FeedTime{double(position()), 1.};
    const auto stage = visualizerStage(io_->delay.active(), io_->visualSync,
                                       pipeline_->sendInstance() != 0, io_->receiving);
    const auto block = boundaries_.slice(
        position(), quantum, clock, *telemetry_, io_->routeRevision, stage,
        [&](BoundarySlice &slice) {
          pipeline_->streamBoundary(slice);
          if (visualizer_) {
            const auto total = latency();
            const auto delay = stage == VisualizerStage::send
                                   ? total - std::min(io_->sendLatency, total)
                                   : total + (io_->delay.active()
                                                  ? output_.appliedDelay() +
                                                        (io_->visualSync ? 0 : io_->delay.samples())
                                                  : 0);
            visualizer_->streamBoundary(slice, delay);
          }
        });
    Parallel *parallel;
    // Publish the borrowed pointer before dereferencing it. The control thread
    // retains a detached branch until this audio callback releases it.
    do {
      parallel = published_.load();
      inUse_.store(parallel);
    } while (parallel != published_.load());
    // FIR replacement is the same owner-thread asset operation as in the
    // worklet. It may allocate between renders once its dry transition finishes.
    pipeline_->serviceAssets();
    io_->sendInstance = pipeline_->sendInstance();
    float *bus = engine_->combined();
    for (std::uint32_t ch = 0; ch < format_.width(); ++ch)
      std::copy_n(planar.data() + std::size_t(ch) * frames + offset, block, bus + ch * block);
    if (!pipeline_->receiveId() && feed_)
      preview_.mix(bus, format_.width(), block, format_.sampleRate);
    if (parallel) {
      const auto count = std::size_t(format_.width()) * block;
      std::copy_n(bus, count, parallel->input.data());
      parallel->b->position_ = position();
      if (!parallel->b->render({parallel->input.data(), count}, block, clock)) {
        inUse_.store(nullptr);
        return false;
      }
    }
    allocation_guard::Scope guard;
    const bool run =
        power_->begin(*pipeline_, bus, format_.width(), block) && (!bypass_ || power_->enabled());
    const bool dryOutput = run && bypass_;
    ranDsp_ = run && !bypass_;
    if (dryOutput)
      std::copy_n(bus, std::size_t(format_.width()) * block, dry_.data());
    if (run)
      pipeline_->renderMidi(position_, block, format_.sampleRate);
    if (run)
      spectrum_->begin(*pipeline_);
    if (run &&
        engine_->processPipeline(format_.width(), block,
                                 static_cast<double>(position_) / format_.sampleRate, 0) != ET_OK) {
      inUse_.store(nullptr);
      return false;
    }
    if (run)
      telemetry_->read(*engine_, position_ + block, io_->routeRevision, stage);
    if (ranDsp_ && !latencyGate_) {
      const auto change = engine_->pipelineLatencyChange();
      if (change == Engine::LatencyChange::Gate) {
        latencyGate_ = true;
        output_.closeTopology();
      } else if (change == Engine::LatencyChange::Refresh) {
        if (!refreshLatency(false)) {
          inUse_.store(nullptr);
          return false;
        }
      }
    }
    if (run && pipeline_->midi.generation())
      pipeline_->midi.finishedBlock(position_ + block, format_.sampleRate);
    if (!run && power_->enabled() && power_->state().directive == Directive::zero)
      std::fill_n(bus, std::size_t(format_.width()) * block, 0.f);
    if (dryOutput)
      std::swap_ranges(bus, bus + std::size_t(format_.width()) * block, dry_.data());
    const auto visualize = [&](const float *audio, unsigned channels) {
      if (visualizer_ && !power_->state().monitoring &&
          power_->state().directive != Directive::zero && !power_->config().displayBypass)
        visualizer_->render(audio, channels, block, position_, *telemetry_, io_->routeRevision,
                            stage);
    };
    if (stage == VisualizerStage::pipeline)
      visualize(bus, format_.width());
    power_->finish(*pipeline_, bus, format_.width(), block, run);
    output_.process(bus, io_->capturedMarker(), block, run, dryOutput ? dry_.data() : nullptr);
    if (!output_.topologyReady()) {
      const bool held = pipeline_->holdsInsertedAsset() ||
                        (parallel && parallel->b->pipeline()->holdsInsertedAsset());
      const auto settling = parallel ? std::max(latency(), parallel->b->latency()) : latency();
      output_.gateTopology(bus, io_->capturedMarker(), parallel ? parallel->input.data() : nullptr,
                           block, settling, held);
    }
    output_.gateRecovery(bus, io_->capturedMarker(), parallel ? parallel->input.data() : nullptr,
                         block);
    if (stage == VisualizerStage::network)
      visualize(bus, format_.width());
    else if (stage == VisualizerStage::send && io_->capturedMarker() && !io_->paused && !parallel &&
             feed_)
      visualize(io_->capturedMarker(), 2);
    io_->networkStage(bus, format_.width(), block, position_, parallel || !feed_);
    if (stage == VisualizerStage::local)
      visualize(bus, format_.width());
    if (parallel) {
      const auto selection = parallel->selection.load(std::memory_order_relaxed);
      const bool targetB = (selection & 1) != 0;
      if (targetB != parallel->targetB) {
        parallel->targetB = targetB;
        parallel->rampRemaining = selection / 2;
        if (parallel->rampRemaining)
          parallel->step = ((targetB ? 1.f : 0.f) - parallel->gainB) / parallel->rampRemaining;
        else
          parallel->gainB = targetB ? 1.f : 0.f;
      }
      for (unsigned i = 0; i < block; ++i) {
        const float gain = parallel->gainB;
        for (unsigned ch = 0; ch < format_.width(); ++ch) {
          const auto index = ch * block + i;
          bus[index] += gain * (parallel->input[index] - bus[index]);
        }
        if (parallel->rampRemaining) {
          parallel->gainB += parallel->step;
          if (!--parallel->rampRemaining)
            parallel->gainB = targetB ? 1.f : 0.f;
        }
      }
    }
    if (feed_)
      io_->applyLocalGain(bus, format_.width(), block);
    inUse_.store(nullptr);
    for (std::uint32_t ch = 0; ch < format_.width(); ++ch)
      std::copy_n(bus + ch * block, block, planar.data() + std::size_t(ch) * frames + offset);
    position_ += block;
    const double elapsed =
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started)
            .count();
    cpuMs_ += elapsed;
    cpuFrames_ += block;
    if (cpuFrames_ >= format_.sampleRate) {
      cpuUsage_.store(cpuMs_ * format_.sampleRate / (10. * cpuFrames_));
      cpuFrames_ = 0;
      cpuMs_ = 0;
    }
    if (overloadEnabled_ && position() >= overloadStart_ && run && !bypass_ &&
        !pipeline_->instrumentIds().empty()) {
      credit_ =
          std::clamp(credit_ + 1000. * block / format_.sampleRate - elapsed, -headroom_, headroom_);
      if (credit_ <= 0 && (!overloaded_ || position() - lastOverload_ >= format_.sampleRate)) {
        overloaded_ = true;
        lastOverload_ = position();
        overloadEvent_.store(1);
      }
    } else
      credit_ = headroom_;
    if (overloaded_ && credit_ >= headroom_) {
      overloaded_ = false;
      overloadEvent_.store(0);
    }
    offset += block;
  }
  return true;
}
} // namespace effetune::audio

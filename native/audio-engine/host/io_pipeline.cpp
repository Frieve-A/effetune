#include "host/io_pipeline.h"
#include "allocation_guard.h"
#include "host/file_fifo.h"
#include "host/session.h"
#include <algorithm>
#include <cmath>

namespace effetune::audio {
IoPipeline::IoPipeline(const SessionFormat &format, ClockedFifo *feedRing)
    : sender(format.sampleRate, format.periodFrames), delay(format.sampleRate, format.width()),
      feed_(feedRing), output_(format.outputChannels, format.sampleRate, format.deviceRate),
      pipelineBuffer_(std::size_t(format.width()) * format.periodFrames),
      inputBuffer_(pipelineBuffer_.size()), marker_(std::size_t{2} * format.periodFrames) {
  if (!feed_)
    return;
  // Feed traverses renderer/main IPC. Capture needs headroom for two device
  // periods.
  feed_->open(format.width(), format.sampleRate, format.sampleRate,
              std::max(format.sampleRate / 20, 2 * format.periodFrames));
  replaceInput(format, format.inputChannels, format.captureRate);
}

bool IoPipeline::replaceInput(const SessionFormat &format, unsigned channels, unsigned sampleRate) {
  if (channels > format.width() || (channels && (sampleRate < 8000 || sampleRate > 384000)))
    return false;
  auto next = prepareInput(format, channels, sampleRate);
  exchangeInput(next, channels);
  return true;
}
void IoPipeline::restartDeviceClock() noexcept {
  if (captureChannels_)
    capture_->restartCapture();
  output_.reset();
  buffered_ = consumed_ = 0;
}
void IoPipeline::reconfigureDevice(const SessionFormat &format) {
  // A reopen resets device clocks and converter history. Network credit, local
  // delay/gain and user-selected input routes belong to the running pipeline.
  output_ = Resampler(format.outputChannels, format.sampleRate, format.deviceRate);
  buffered_ = consumed_ = 0;
  pipelineBuffer_.resize(std::size_t(format.width()) * format.periodFrames);
  inputBuffer_.resize(pipelineBuffer_.size());
  if (feed_) {
    feed_->open(format.width(), format.sampleRate, format.sampleRate,
                std::max(format.sampleRate / 20, 2 * format.periodFrames));
    replaceInput(format, format.inputChannels, format.captureRate);
  }
}
IoPipeline::Capture IoPipeline::prepareInput(const SessionFormat &format, unsigned channels,
                                             unsigned sampleRate) {
  auto next = std::make_unique<ClockedFifo>(std::max(1u, channels), channels ? 131072 : 4);
  if (channels) {
    const auto target = std::ceil(2. * format.periodFrames * sampleRate / format.deviceRate);
    next->open(channels, sampleRate, format.sampleRate,
               static_cast<std::size_t>(std::clamp(target, 32., 131071.)), true);
  }
  return next;
}

bool IoPipeline::renderDevice(Session &session, float *output, unsigned frames,
                              const float *synchronousInput, bool discard) noexcept {
  const auto &format = session.format();
  if (synchronousInput && format.sampleRate != format.deviceRate)
    return false;
  unsigned produced = 0;
  while (produced < frames) {
    const auto needed = output_.inputNeeded(frames - produced);
    const auto block = static_cast<unsigned>(std::min<std::size_t>(format.periodFrames, needed));
    float *bus = pipelineBuffer_.data();
    if (consumed_ == buffered_ && block) {
      bool fileActive = false;
      feed_->read(bus, block, block);
      if (auto *file = session.file(); file && !discard) {
        allocation_guard::Scope guard;
        file->mix(bus, format.width(), block, session.position(), &session,
                  [](void *context, std::uint64_t frame) noexcept {
                    static_cast<Session *>(context)->noteFileBoundary(frame);
                  });
        fileActive = file->activeThisBlock();
      }
      if (captureChannels_ && !synchronousInput)
        capture_->read(inputBuffer_.data(), block, block, ClockedFifo::nowNs());
      if (!discard && inputEnabled) {
        for (unsigned ch = 0; ch < captureChannels_; ++ch) {
          const auto *input = synchronousInput ? synchronousInput + ch * frames + produced
                                               : inputBuffer_.data() + ch * block;
          auto *channel = bus + ch * block;
          for (unsigned i = 0; i < block; ++i)
            channel[i] += input[i];
        }
      }
      if (discard) {
        std::fill_n(bus, std::size_t(block) * format.width(), 0.f);
        session.advanceSilently(block);
      } else if (!session.render({bus, std::size_t(block) * format.width()}, block,
                                 FeedTime{feed_->sourceFrame() - feed_->sourceStep() * block,
                                          feed_->sourceStep()},
                                 fileActive))
        return false;
      buffered_ = block;
      consumed_ = 0;
    }
    const auto result = output_.process(bus + consumed_, buffered_, buffered_ - consumed_,
                                        output + produced, frames, frames - produced);
    consumed_ += static_cast<unsigned>(result.consumed);
    if (!result.consumed && !result.produced)
      return false;
    produced += static_cast<unsigned>(result.produced);
  }
  return true;
}

void IoPipeline::networkStage(float *bus, unsigned channels, unsigned frames,
                              std::uint64_t position, bool parallel) noexcept {
  const auto *left = markerCaptured_ ? marker_.data() : bus;
  const auto *right = markerCaptured_ ? marker_.data() + frames : channels > 1 ? bus + frames : bus;
  sender.render(left, right, frames, position, tapRevision,
                !parallel && !paused && !receiving && (!sendInstance || markerCaptured_));
  delay.process(bus, frames);
  if (!feed_)
    checkLocalDelay();
  markerCaptured_ = false;
}

void IoPipeline::requestLocalDelay(unsigned request, bool active, unsigned samples,
                                   bool local) noexcept {
  if (requestedDelayActive_ != active || requestedLocalDelay != (active ? samples : 0) ||
      localEnabled != local) {
    ++localDelayRevision;
    ++routeRevision;
  }
  renderDelayRequest_ = request;
  requestedLocalDelay = active ? samples : 0;
  requestedDelayActive_ = active;
  localEnabled = local;
  delay.set(active, samples);
  checkLocalDelay();
}

void IoPipeline::checkLocalDelay() noexcept {
  if (renderDelayRequest_ && delay.active() == requestedDelayActive_ &&
      delay.samples() == requestedLocalDelay && (!feed_ || localGain_.settled(localEnabled))) {
    appliedDelayRequest.store(renderDelayRequest_, std::memory_order_release);
    renderDelayRequest_ = 0;
  }
}

void IoPipeline::applyLocalGain(float *bus, unsigned channels, unsigned frames) noexcept {
  localGain_.process(bus, channels, frames, localEnabled);
  checkLocalDelay();
}

void IoPipeline::captureSendMarker(const float *planar, unsigned channels, unsigned frames,
                                   unsigned latencySamples) noexcept {
  std::copy_n(planar, frames, marker_.data());
  std::copy_n(channels > 1 ? planar + frames : planar, frames, marker_.data() + frames);
  markerCaptured_ = true;
  sendLatency = latencySamples;
}
} // namespace effetune::audio

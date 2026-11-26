#include "device_host.h"
#include "device/null/realtime_null.h"
#include "host/clocked_fifo.h"
#include "host/io_pipeline.h"
#include <algorithm>
#include <cstdlib>
#include <numeric>
#include <stdexcept>
#include <thread>

namespace effetune::audio {
DeviceHost::DeviceHost(std::string_view backend, bool muteOutput) : muteOutput_(muteOutput) {
  session.setFileInput(&file);
  [[maybe_unused]] DeviceCallbacks callbacks{this, render, capture, reset};
  if (backend == "null") {
#if defined(_MSC_VER)
    char timer[2]{};
    std::size_t length = 0;
    if (getenv_s(&length, timer, sizeof(timer), "EFFETUNE_AUDIO_ENGINE_NULL") == 0 && length == 2 &&
        timer[0] == '1')
      device_ = makeRealtimeNull(callbacks);
#else
    const char *timer = std::getenv("EFFETUNE_AUDIO_ENGINE_NULL");
    if (timer && std::string_view(timer) == "1")
      device_ = makeRealtimeNull(callbacks);
#endif
    return;
  }
#if defined(ET_AUDIO_ENGINE_WASAPI)
  if (backend == "wasapi")
    device_ = makeWasapiDevice(callbacks);
#elif defined(ET_AUDIO_ENGINE_MINIAUDIO)
  if (backend == "miniaudio")
    device_ = makeMiniaudioDevice(callbacks);
#endif
  if (!device_)
    throw std::invalid_argument("unsupported backend");
}

DeviceHost::~DeviceHost() { close(); }

DeviceList DeviceHost::list() {
  if (!device_)
    return {"null", {{"null-out", "Null output", 16, true}}, {{"null-in", "Null input", 16, true}}};
  DeviceList result;
  if (device_->list(result) != DeviceError::None)
    throw std::runtime_error("device enumeration failed");
  return result;
}

DeviceError DeviceHost::openMeasurement(unsigned rate, const std::string &outputId,
                                        unsigned channels, const std::string &inputId,
                                        std::vector<unsigned> indices, unsigned deviceRate,
                                        unsigned captureRate, bool synchronous) {
  if (measuring() || session.isOpen())
    return DeviceError::Busy;
  if (rate < 8000 || rate > 384000 || !channels || channels > 16 || indices.empty() ||
      indices.size() > 2 || (indices.size() == 2 && indices[0] == indices[1]) ||
      (!device_ && *std::max_element(indices.begin(), indices.end()) >= 16))
    return DeviceError::UnsupportedFormat;
  measurement.beginDeviceSession();
  measuring_.store(true);
  DeviceError status = DeviceError::None;
  if (device_) {
    DeviceRequest outputRequest{{outputId, {}}, rate, DeviceLatency::Balanced, true};
    outputRequest.selection.channels.resize(channels);
    std::iota(outputRequest.selection.channels.begin(), outputRequest.selection.channels.end(), 0u);
    status = device_->openOutput(outputRequest, output_);
    if (status == DeviceError::None) {
      const DeviceRequest inputRequest{{inputId, indices}, rate, DeviceLatency::Balanced, true};
      status = device_->replaceInput(&inputRequest, input_);
    }
  } else {
    output_ = {deviceRate ? deviceRate : rate, channels, channels, 128, 0};
    input_ = {captureRate ? captureRate : rate,
              16,
              static_cast<unsigned>(indices.size()),
              128,
              0,
              synchronous};
    if (inputId == systemAudioId)
      status = DeviceError::Unavailable;
  }
  if (status == DeviceError::None) {
    try {
      measurement.configure(rate, output_, input_);
      measurementIndices_ = std::move(indices);
      if (device_)
        status = device_->start();
    } catch (const std::invalid_argument &) {
      status = DeviceError::UnsupportedFormat;
    }
  }
  if (status != DeviceError::None)
    closeMeasurement();
  return status;
}

void DeviceHost::closeMeasurement() noexcept {
  if (device_)
    device_->close();
  measurement.cancel();
  output_ = {};
  input_ = {};
  measuring_.store(false);
}

DeviceError DeviceHost::open(SessionFormat &format, const std::string &output,
                             const std::string &input, DeviceLatency latency,
                             const std::string &loopbackEndpointId) {
  if (measuring() || (session.isOpen() && !reopening_))
    return DeviceError::Busy;
  if (!reopening_) {
    requested_ = format;
    outputId_ = output;
    inputId_ = input;
    loopbackEndpointId_ = loopbackEndpointId;
    latency_ = latency;
  }
  inputError_ = DeviceError::None;
  if (!device_ && input == systemAudioId) {
    inputError_ = DeviceError::Unavailable;
    format.inputChannels = 0;
  }
  if (device_) {
    DeviceList devices;
    auto status = device_->list(devices);
    if (status != DeviceError::None)
      return status;
    const auto selected =
        std::find_if(devices.outputs.begin(), devices.outputs.end(), [&](const DeviceInfo &item) {
          return output == "default" ? item.isDefault : item.id == output;
        });
    if (selected == devices.outputs.end())
      return DeviceError::Unavailable;
    DeviceRequest request{{output, {}}, format.sampleRate, latency};
    request.selection.channels.resize(std::min(format.outputChannels, selected->channels));
    std::iota(request.selection.channels.begin(), request.selection.channels.end(), 0u);
    status = device_->openOutput(request, output_);
    if (status != DeviceError::None) {
      device_->close();
      return status;
    }
    if (!input.empty() && input != "none") {
      const DeviceRequest captureRequest{
          {input, {}}, format.sampleRate, latency, false, loopbackEndpointId};
      inputError_ = device_->replaceInput(&captureRequest, input_);
    }
    format.outputChannels = output_.selectedChannels;
    format.inputChannels = inputError_ == DeviceError::None ? input_.selectedChannels : 0;
    format.periodFrames = output_.periodFrames;
    format.deviceRate = output_.sampleRate;
    format.captureRate = input_.sampleRate;
  }
  rebuilt_ = !session.isOpen() || session.format().width() != format.width();
  if (rebuilt_) {
    outputWaits_.clear();
    session.close();
    if (!session.open(format)) {
      close();
      return DeviceError::UnsupportedFormat;
    }
    ++endpointEpochs_[0];
    if (openedOnce_) {
      pendingRecovery_ = ++lastRecovery_;
      session.output().holdRecovery();
    }
    openedOnce_ = true;
  } else if (!session.reconfigureDevice(format)) {
    close();
    return DeviceError::UnsupportedFormat;
  }
  format = session.format();
  if (input == systemAudioId)
    session.io()->inputEnabled = false;
  captureGeneration_.fetch_add(1, std::memory_order_relaxed);
  captureReady_.store(format.inputChannels != 0, std::memory_order_release);
  return DeviceError::None;
}

DeviceError DeviceHost::start() {
  if (!session.isOpen())
    return DeviceError::Unavailable;
  if (running_)
    return DeviceError::None;
  if (device_)
    session.io()->restartDeviceClock();
  owner_.store(session.output().topologyReady() ? Owner::Audio : Owner::Returned,
               std::memory_order_release);
  const auto result = device_ ? device_->start() : DeviceError::None;
  running_ = result == DeviceError::None;
  if (device_ && running_)
    captureBusy_.store(false, std::memory_order_release);
  if (!running_)
    owner_.store(Owner::Control, std::memory_order_release);
  return result;
}

bool DeviceHost::startParallel(bool selectB) {
  if (!session.startParallel(selectB))
    return false;
  ++endpointEpochs_[1];
  return true;
}

void DeviceHost::stop() noexcept {
  if (device_ && running_) {
    device_->stop();
    while (captureBusy_.exchange(true, std::memory_order_acquire))
      std::this_thread::yield();
  }
  running_ = false;
  owner_.store(Owner::Control, std::memory_order_release);
  applyCommands();
}

void DeviceHost::close() noexcept {
  if (measuring())
    closeMeasurement();
  stop();
  resumeAfterStall_ = false;
  captureReady_.store(false, std::memory_order_release);
  if (device_)
    device_->close();
  input_ = {};
  output_ = {};
  session.close();
  pendingRecovery_ = 0;
  outputWaits_.clear();
}

void DeviceHost::poll() noexcept {
  if (device_)
    device_->poll();
  if (assetDeadline_ && std::chrono::steady_clock::now() > *assetDeadline_ && !commandsSettled()) {
    stall();
  }
}
void DeviceHost::stall() noexcept {
  resumeAfterStall_ = running_;
  stop();
  reset(this, DeviceDirection::Output, DeviceResetReason::Stalled);
}

bool DeviceHost::clock(ClockSnapshot &out) const noexcept {
  const auto sequence = clockSequence_.load();
  if (!sequence || (sequence & 1))
    return false;
  out = {timeNs_.load(),           position_.load(),
         feedDelay_.load(),        feedUnderruns_.load(),
         captureUnderruns_.load(), converterDelay_.load(),
         captureRatio_.load(),     captureConverterDelay_.load(),
         captureState_.load(),     feedTarget_.load(),
         captureTarget_.load()};
  return clockSequence_.load() == sequence;
}

bool DeviceHost::acquire() noexcept {
  if (!device_ || !running_)
    return true;
  auto state = owner_.load(std::memory_order_acquire);
  if (state == Owner::Control)
    return true;
  if (state != Owner::Requested) {
    if (owner_.compare_exchange_strong(state, Owner::Requested, std::memory_order_acq_rel))
      deadline_ = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  } else if (std::chrono::steady_clock::now() > deadline_) {
    stall();
  }
  return false;
}
void DeviceHost::release() noexcept {
  if (device_ && running_)
    owner_.store(Owner::Returned, std::memory_order_release);
}

bool DeviceHost::submit(std::function<void(Session &)> action) {
  if (!device_ || !running_ || owner_.load(std::memory_order_acquire) == Owner::Control) {
    action(session);
    return true;
  }
  const auto written = written_.load(std::memory_order_relaxed);
  // Backpressure is confined to the producer. The audio callback consumes
  // the existing commands in order, including continuations of an asset job.
  if (written - consumed_.load(std::memory_order_acquire) == commands_.size()) {
    const auto until = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    while (written - consumed_.load(std::memory_order_acquire) == commands_.size()) {
      if (std::chrono::steady_clock::now() >= until) {
        stall();
        action(session);
        return true;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
  }
  if (written >= commands_.size())
    reclaimed_ = std::max(reclaimed_, written - commands_.size() + 1);
  commands_[written % commands_.size()] = std::move(action);
  written_.store(written + 1, std::memory_order_release);
  return true;
}

bool DeviceHost::submit(std::function<void(Session &)> action, std::function<void()> finish) {
  if (!submit(std::move(action)))
    return false;
  completions_.emplace_back(written_.load(std::memory_order_acquire), std::move(finish));
  finishCommands();
  return true;
}
void DeviceHost::finishCommands() {
  const auto consumed = consumed_.load(std::memory_order_acquire);
  while (reclaimed_ < consumed)
    commands_[reclaimed_++ % commands_.size()] = {};
  while (!completions_.empty() && completions_.front().first <= consumed) {
    auto finish = std::move(completions_.front().second);
    completions_.pop_front();
    finish();
  }
  std::erase_if(outputWaits_, [&](OutputWait &wait) {
    auto *branch = session.branch(wait.branch);
    if (!branch || !branch->isOpen())
      return true;
    if (!session.output().topologyReady() || !wait.ready(branch->output()))
      return false;
    wait.finish();
    return true;
  });
}
void DeviceHost::waitForOutput(unsigned branch, std::function<bool(const OutputStage &)> ready,
                               std::function<void()> finish) {
  if (outputWaits_.size() >= 256)
    throw std::runtime_error("too many outstanding output requests");
  outputWaits_.push_back({branch, std::move(ready), std::move(finish)});
}
void DeviceHost::applyCommands() noexcept {
  const auto end = written_.load(std::memory_order_acquire);
  auto next = consumed_.load(std::memory_order_relaxed);
  while (next < end) {
    commands_[next % commands_.size()](session);
    consumed_.store(++next, std::memory_order_release);
  }
}

DeviceError DeviceHost::replaceInput(const std::string &id, DeviceLatency latency,
                                     const std::string &loopbackEndpointId) {
  if (!session.isOpen())
    return DeviceError::Unavailable;
  inputId_ = id;
  loopbackEndpointId_ = loopbackEndpointId;
  rebuilt_ = false;
  captureReady_.store(false, std::memory_order_release);
  if (!device_) {
    inputError_ = id == systemAudioId ? DeviceError::Unavailable : DeviceError::None;
    return inputError_;
  }
  const DeviceRequest request{
      {id, {}}, session.format().sampleRate, latency, false, loopbackEndpointId};
  const bool releaseInput = id.empty() || id == "none";
  input_ = {};
  inputError_ = device_->replaceInput(releaseInput ? nullptr : &request, input_);
  const unsigned channels = inputError_ == DeviceError::None ? input_.selectedChannels : 0;
  if (channels <= session.format().width()) {
    const auto rate = input_.sampleRate ? input_.sampleRate : session.format().sampleRate;
    auto next = std::make_shared<IoPipeline::Capture>(
        IoPipeline::prepareInput(session.format(), channels, rate));
    const auto generation = captureGeneration_.fetch_add(1, std::memory_order_acq_rel) + 1;
    if (!submit(
            [next, channels, loopback = id == systemAudioId](Session &s) {
              if (loopback)
                s.io()->inputEnabled = false;
              s.io()->exchangeInput(*next, channels);
            },
            [this, generation, channels] {
              if (captureGeneration_.load(std::memory_order_acquire) == generation)
                captureReady_.store(channels != 0, std::memory_order_release);
            }))
      return DeviceError::Busy;
  } else {
    return recover(false);
  }
  return inputError_;
}

DeviceError DeviceHost::recoverReset(int reasons) {
  const bool inputOnly = (reasons & 0xff) == 0;
  if (inputId_ != systemAudioId || !(reasons & 0xff00))
    return recover(inputOnly);
  // A new default endpoint has not been checked against the renderer's mute
  // keeper.
  inputId_ = "none";
  const auto result = recover(inputOnly);
  inputError_ = DeviceError::Unavailable;
  return result;
}

DeviceError DeviceHost::recover(bool inputOnly) {
  if (!session.isOpen())
    return DeviceError::Unavailable;
  if (inputOnly)
    return replaceInput(inputId_, latency_, loopbackEndpointId_);
  const bool resume = running_ || resumeAfterStall_;
  resumeAfterStall_ = false;
  stop();
  captureReady_.store(false, std::memory_order_release);
  finishCommands();
  device_->close();
  input_ = {};
  output_ = {};
  reopening_ = true;
  auto format = requested_;
  const auto result = open(format, outputId_, inputId_, latency_, loopbackEndpointId_);
  reopening_ = false;
  if (result != DeviceError::None) {
    close();
    return result;
  }
  return resume ? start() : DeviceError::None;
}
bool DeviceHost::resetTestDevice(unsigned sampleRate, unsigned channels,
                                 std::string_view unavailableId, bool loseInput) {
  return resetRealtimeNull(device_.get(), sampleRate, channels, unavailableId, loseInput);
}
bool DeviceHost::releaseRecovery(unsigned id, std::function<void()> released) {
  if (!id || id != pendingRecovery_)
    return false;
  pendingRecovery_ = 0;
  return submit([](Session &s) { s.output().releaseRecovery(); }, std::move(released));
}
bool DeviceHost::readTestOutput(unsigned &frames, float &peak) {
  return readRealtimeNullOutput(device_.get(), frames, peak);
}
bool DeviceHost::setTestInput(float level) { return setRealtimeNullInput(device_.get(), level); }

void DeviceHost::render(void *context, std::span<float> out, std::span<const float> in,
                        unsigned frames, DeviceClock clock) noexcept {
  auto &host = *static_cast<DeviceHost *>(context);
  if (host.measuring()) {
    if (!in.empty())
      host.measurement.capture(in, frames, clock);
    host.measurement.render(out, frames, clock);
    if (host.muteOutput_)
      std::fill(out.begin(), out.end(), 0.f);
    return;
  }
  const auto start = std::chrono::steady_clock::now();
  host.renderOutput(out, in, frames, clock);
  const auto elapsed =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
  if (elapsed * host.output_.sampleRate > frames)
    host.overruns_.fetch_add(1, std::memory_order_relaxed);
}

void DeviceHost::renderOutput(std::span<float> out, std::span<const float> in, unsigned frames,
                              DeviceClock clock) noexcept {
  auto state = owner_.load(std::memory_order_acquire);
  if (state == Owner::Returned) {
    session.output().settleTopology();
    owner_.compare_exchange_strong(state, Owner::Audio, std::memory_order_acq_rel);
    state = owner_.load(std::memory_order_acquire);
  }
  if (state == Owner::Requested)
    session.output().closeTopology();
  if (state != Owner::Control)
    applyCommands();
  clockSequence_.fetch_add(1);
  timeNs_.store(clock.timeNs);
  position_.store(session.position());
  converterDelay_.store(session.io()->outputDelayFrames());
  feedDelay_.store(session.feed().queued());
  feedTarget_.store(static_cast<unsigned>(session.feed().target()));
  captureTarget_.store(static_cast<unsigned>(session.capture().target()));
  feedUnderruns_.store(session.feed().underruns());
  captureUnderruns_.store(session.capture().underruns());
  captureState_.store(static_cast<unsigned>(session.capture().state()));
  const bool capturing = session.io()->captureChannels();
  captureRatio_.store(capturing ? session.capture().inputPerOutput() : 0.);
  captureConverterDelay_.store(capturing ? session.capture().delayInputFrames() : 0.);
  clockSequence_.fetch_add(1);
  if (clock.discontinuity)
    discontinuities_.fetch_add(1, std::memory_order_relaxed);
  if (!session.renderDevice(out, frames, in, state == Owner::Control)) {
    std::fill(out.begin(), out.end(), 0.0f);
    reset(this, DeviceDirection::Output, DeviceResetReason::StreamError);
    return;
  }
  if (state == Owner::Requested && session.output().topologyClosed())
    owner_.store(Owner::Control, std::memory_order_release);
  if (muteOutput_ || state == Owner::Control)
    std::fill(out.begin(), out.end(), 0.0f);
}

void DeviceHost::capture(void *context, std::span<const float> samples, unsigned frames,
                         DeviceClock clock) noexcept {
  auto &host = *static_cast<DeviceHost *>(context);
  if (host.measuring()) {
    host.measurement.capture(samples, frames, clock);
    return;
  }
  if (!host.captureReady_.load(std::memory_order_acquire) ||
      host.captureBusy_.exchange(true, std::memory_order_acquire))
    return;
  // Some drivers flag discontinuities on contiguous packets. The capture FIFO
  // detects real frame loss from the device position, so the flag alone must
  // not discard the queued input.
  if (clock.discontinuity)
    host.discontinuities_.fetch_add(1, std::memory_order_relaxed);
  const auto generation = host.captureGeneration_.load(std::memory_order_relaxed);
  if (frames)
    host.session.capture().write(samples.data(), static_cast<unsigned>(samples.size() / frames),
                                 frames, generation, clock.position, ClockedFifo::nowNs());
  else
    host.session.capture().silence(generation);
  host.captureBusy_.store(false, std::memory_order_release);
}
void DeviceHost::reset(void *context, DeviceDirection direction,
                       DeviceResetReason reason) noexcept {
  auto &host = *static_cast<DeviceHost *>(context);
  if (host.measuring()) {
    host.measurement.deviceReset();
    return;
  }
  const int bit = static_cast<int>(reason) + (direction == DeviceDirection::Output ? 0 : 8);
  host.reset_.fetch_or(1 << bit, std::memory_order_release);
}
} // namespace effetune::audio

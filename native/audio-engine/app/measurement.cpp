#include "measurement.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <thread>

namespace effetune::audio {
namespace {
struct Callback {
  std::atomic<unsigned> &count;
  explicit Callback(std::atomic<unsigned> &c) : count(c) { ++count; }
  ~Callback() { --count; }
};
constexpr std::size_t maxSamples = 128u * 1024u * 1024u;
std::size_t scaled(std::size_t frames, unsigned from, unsigned to) {
  return static_cast<std::size_t>(std::ceil(static_cast<double>(frames) * to / from));
}
} // namespace
void Measurement::configure(unsigned rate, const DeviceStreamFormat &out,
                            const DeviceStreamFormat &in) {
  cancel();
  rate_ = rate;
  out_ = out;
  in_ = in;
  toOutput_.emplace(out.selectedChannels, rate, out.sampleRate);
  fromInput_.emplace(1, in.sampleRate, rate);
  peak_.store(0);
}
void Measurement::waitForCallbacks() const noexcept {
  while (callbacks_.load())
    std::this_thread::yield();
}
void Measurement::cancel() noexcept {
  state_.store(State::Open);
  waitForCallbacks();
  state_.store(State::Open);
  source_.clear();
  output_.clear();
  captured_.clear();
  recording_.clear();
  overloaded_.store(false);
}
bool Measurement::begin(unsigned excitation, unsigned captureLength, bool loop, float peak,
                        unsigned tail) {
  if (deviceLost_.load() || state() == State::Running || !excitation || (!loop && !captureLength) ||
      (loop && captureLength) || !std::isfinite(peak) || peak < 0)
    return false;
  cancel();
  toOutput_->reset();
  fromInput_->reset();
  sourceFrames_ = excitation;
  const auto filterFrames = static_cast<std::size_t>(2 * toOutput_->delayInputFrames());
  sourceStride_ = excitation + filterFrames;
  loopWarmup_ = 0;
  if (loop && filterFrames) {
    const auto step = toOutput_->inputPerOutput();
    loopWarmup_ = static_cast<std::size_t>(std::llround(filterFrames / step));
    outputFrames_ = static_cast<std::size_t>(std::max(1LL, std::llround(excitation / step)));
    outputStride_ = loopWarmup_ + outputFrames_;
    sourceStride_ = std::max(sourceStride_, toOutput_->inputNeeded(outputStride_) + 1);
  } else {
    outputFrames_ = outputStride_ = scaled(sourceStride_, rate_, out_.sampleRate);
  }
  captureFrames_ = scaled(captureLength, rate_, in_.sampleRate) +
                   static_cast<std::size_t>(2 * fromInput_->delayInputFrames());
  const auto channels = out_.selectedChannels;
  if (sourceStride_ > maxSamples / channels || outputStride_ > maxSamples / channels ||
      captureFrames_ > maxSamples || captureLength > maxSamples ||
      (sourceStride_ + outputStride_) * channels + captureFrames_ + captureLength > maxSamples)
    return false;
  source_.assign(sourceStride_ * channels, 0);
  output_.resize(outputStride_ * channels);
  captured_.assign(captureFrames_, 0);
  recording_.assign(captureLength, 0);
  loop_ = loop;
  threshold_ = peak;
  overloadTail_ = scaled(tail, rate_, in_.sampleRate);
  stopAt_ = std::numeric_limits<std::size_t>::max();
  uploaded_ = outputPosition_ = capturePosition_ = 0;
  leadFrames_ = loop ? 0 : static_cast<std::size_t>(std::llround(out_.sampleRate * .5));
  expectedInput_.reset();
  expectedOutput_.reset();
  outputNs_.store(0);
  inputNs_.store(0);
  converted_ = false;
  state_.store(State::Ready);
  return !deviceLost_.load();
}
bool Measurement::chunk(unsigned offset, std::span<const std::uint8_t> bytes) {
  const auto channels = out_.selectedChannels;
  if (state() != State::Ready || offset != uploaded_ || bytes.size() % (channels * sizeof(float)))
    return false;
  const auto frames = bytes.size() / (channels * sizeof(float));
  if (!frames || frames > sourceFrames_ - uploaded_)
    return false;
  const auto prefix = loop_ ? static_cast<std::size_t>(toOutput_->delayInputFrames()) : 0;
  for (std::size_t i = 0; i < frames; ++i)
    for (unsigned ch = 0; ch < channels; ++ch)
      std::memcpy(&source_[ch * sourceStride_ + prefix + offset + i],
                  bytes.data() + (i * channels + ch) * sizeof(float), sizeof(float));
  uploaded_ += frames;
  return true;
}
bool Measurement::start() {
  if (state() != State::Ready || uploaded_ != sourceFrames_)
    return false;
  if (loopWarmup_) {
    // Both sides of the FIR window see the same periodic source at the loop seam.
    const auto prefix = static_cast<std::size_t>(toOutput_->delayInputFrames());
    for (unsigned ch = 0; ch < out_.selectedChannels; ++ch) {
      auto *channel = source_.data() + ch * sourceStride_;
      for (std::size_t i = prefix; i-- > 0;)
        channel[i] = channel[i + sourceFrames_];
      for (std::size_t i = prefix + sourceFrames_; i < sourceStride_; ++i)
        channel[i] = channel[i - sourceFrames_];
    }
  }
  const auto res = toOutput_->process(source_.data(), sourceStride_, sourceStride_, output_.data(),
                                      outputStride_, outputStride_);
  if (!res.produced || (loop_ && res.produced != outputStride_))
    return false;
  // The final fractional sample can fall outside the finite source range.
  outputFrames_ = res.produced - loopWarmup_;
  state_.store(State::Running);
  return !deviceLost_.load();
}
void Measurement::interrupt() noexcept {
  auto before = State::Running;
  state_.compare_exchange_strong(before, State::Failed);
}
void Measurement::render(std::span<float> output, unsigned frames, DeviceClock clock) noexcept {
  Callback guard(callbacks_);
  std::fill(output.begin(), output.end(), 0.f);
  if (state() != State::Running || !frames)
    return;
  if (clock.discontinuity || (expectedOutput_ && clock.position != *expectedOutput_)) {
    interrupt();
    return;
  }
  expectedOutput_ = clock.position + frames;
  for (unsigned i = 0; i < frames; ++i, ++outputPosition_) {
    if (outputPosition_ < leadFrames_)
      continue;
    const auto index = outputPosition_ - leadFrames_;
    if (!index && clock.deviceTimeNs)
      outputNs_.store(clock.deviceTimeNs +
                      static_cast<std::uint64_t>(std::llround(double(i) * 1.e9 / out_.sampleRate)));
    if (!loop_ && index >= outputFrames_)
      continue;
    for (unsigned ch = 0; ch < out_.selectedChannels; ++ch)
      output[ch * std::size_t(frames) + i] =
          output_[ch * outputStride_ + loopWarmup_ + index % outputFrames_];
  }
}
void Measurement::capture(std::span<const float> input, unsigned frames,
                          DeviceClock clock) noexcept {
  Callback guard(callbacks_);
  if (!frames || (input.size() != frames && input.size() != std::size_t(frames) * 2))
    return;
  const bool running = state() == State::Running;
  const bool record = running && !loop_;
  if (running && (clock.discontinuity || (expectedInput_ && *expectedInput_ != clock.position))) {
    interrupt();
    return;
  }
  if (running) {
    if (record && !expectedInput_)
      inputNs_.store(clock.deviceTimeNs);
    expectedInput_ = clock.position + frames;
  }
  float peak = 0;
  for (unsigned i = 0; i < frames; ++i) {
    const float sample = input.size() == frames ? input[i] : .5f * (input[i] + input[frames + i]);
    const float magnitude = std::abs(sample);
    peak = std::max(peak, magnitude);
    if (!record || capturePosition_ >= captureFrames_ || capturePosition_ >= stopAt_)
      continue;
    captured_[capturePosition_++] = sample;
    if (threshold_ > 0 && magnitude >= threshold_ &&
        stopAt_ == std::numeric_limits<std::size_t>::max())
      stopAt_ = capturePosition_ - 1 + std::max<std::size_t>(1, overloadTail_);
  }
  auto prior = peak_.load();
  while (prior < peak && !peak_.compare_exchange_weak(prior, peak)) {
  }
  if (record && (capturePosition_ == captureFrames_ || capturePosition_ >= stopAt_)) {
    overloaded_.store(capturePosition_ >= stopAt_);
    auto running = State::Running;
    state_.compare_exchange_strong(running, State::Complete);
  }
}
std::span<const float> Measurement::read(unsigned offset, unsigned frames) {
  if (state() != State::Complete || offset > recording_.size() || !frames ||
      frames > recording_.size() - offset)
    return {};
  if (!converted_) {
    waitForCallbacks();
    fromInput_->process(captured_.data(), captured_.size(), captured_.size(), recording_.data(),
                        recording_.size(), recording_.size());
    converted_ = true;
  }
  if (deviceLost_.load())
    return {};
  return {recording_.data() + offset, frames};
}
std::optional<double> Measurement::playbackStartFrame() const noexcept {
  double offset;
  if (in_.synchronousInput)
    offset = static_cast<double>(leadFrames_) * rate_ / out_.sampleRate;
  else {
    const auto out = outputNs_.load(), in = inputNs_.load();
    if (!out || !in)
      return {};
    offset = (static_cast<double>(out) - static_cast<double>(in)) * rate_ / 1.e9;
  }
  return std::round(offset + toOutput_->delayInputFrames() +
                    fromInput_->delayInputFrames() * rate_ / in_.sampleRate);
}
} // namespace effetune::audio

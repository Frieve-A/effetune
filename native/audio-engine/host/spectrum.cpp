#include "spectrum.h"
#include "effetune/dsp/spectrum_hq_sink.h"
#include "pipeline.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <stdexcept>

namespace effetune::audio {
class SpectrumTaps::Track {
public:
  Track(unsigned id, unsigned gen, unsigned rate, unsigned maxFrames, bool compare, bool hq)
      : id_(id), gen_(gen), rate_(rate), compare_(compare), hq_(hq) {
    for (auto &b : blocks_) {
      b.after.resize(maxFrames);
      if (compare)
        b.before.resize(maxFrames);
    }
    if (hq) {
      output_ = std::make_unique<Analysis>(rate);
      if (compare)
        input_ = std::make_unique<Analysis>(rate);
    }
  }
  bool matches(bool compare, bool hq) const noexcept { return compare == compare_ && hq == hq_; }
  void reset() noexcept {
    resetBoundary_.store(write_.load(std::memory_order_relaxed), std::memory_order_relaxed);
    resetSerial_.fetch_add(1, std::memory_order_release);
  }
  void capture(const float *data, unsigned channels, unsigned frames, unsigned latency, bool before,
               std::uint64_t pos, unsigned remaining, std::uint64_t revision) noexcept {
    if (before && !compare_)
      return;
    const auto w = write_.load(std::memory_order_relaxed);
    if (w - read_.load(std::memory_order_acquire) == blocks_.size())
      return;
    auto &block = blocks_[w % blocks_.size()];
    auto &mono = before ? block.before : block.after;
    if (!channels || frames > mono.size())
      return;
    for (unsigned i = 0; i < frames; ++i) {
      float value = 0;
      for (unsigned ch = 0; ch < channels; ++ch)
        value += data[ch * frames + i];
      mono[i] = value / channels;
    }
    if (before) {
      block.inputPosition = pos;
      return;
    }
    if (compare_ && block.inputPosition != pos)
      return;
    block.frames = frames;
    block.start = pos;
    block.remaining = remaining;
    block.latency = latency;
    block.revision = revision;
    write_.store(w + 1, std::memory_order_release);
  }
  void drain(const std::function<void(const SpectrumFrame &)> &send) {
    auto r = read_.load(std::memory_order_relaxed);
    const auto reset = resetSerial_.load(std::memory_order_acquire);
    if (reset != observedReset_) {
      r = std::max(r, resetBoundary_.load(std::memory_order_relaxed));
      read_.store(r, std::memory_order_release);
      observedReset_ = reset;
      nextFrame_ = UINT64_MAX;
      ++gen_;
    }
    const auto end = write_.load(std::memory_order_acquire);
    while (r < end) {
      process(blocks_[r % blocks_.size()], send);
      read_.store(++r, std::memory_order_release);
    }
  }

private:
  struct Block {
    std::vector<float> before, after;
    unsigned frames = 0, latency = 0, remaining = 0;
    std::uint64_t start = 0, inputPosition = UINT64_MAX, revision = 0;
  };
  struct Analysis {
    dsp::MultiresSpectrum fft;
    dsp::SpectrumHqSink sink;
    explicit Analysis(unsigned rate) : sink(static_cast<float>(rate)) {
      if (!fft.prepare(static_cast<float>(rate), false))
        throw std::runtime_error("cannot prepare spectrum analyzer");
    }
    void reset() {
      fft.reset(12);
      sink.reset();
    }
    void read(SpectrumFrame::Analysis &metadata, float *samples) {
      dsp::MultiresSpectrumFrame f;
      if (sink.copySpectrum(samples, samples + 2048, f))
        metadata = {f.generation,      f.frameIndex,     f.hopSamples,
                    f.firstValidIndex, f.validCellCount, f.captureEndSample};
    }
  };
  void process(const Block &b, const std::function<void(const SpectrumFrame &)> &send) {
    if (nextFrame_ != b.start) {
      origin_ = b.start;
      count_ = index_ = 0;
      delay_.clear();
      delayPos_ = 0;
      if (output_)
        output_->reset();
      if (input_)
        input_->reset();
    }
    nextFrame_ = b.start + b.frames;
    if (compare_ && delay_.size() != b.latency) {
      delay_.assign(b.latency, 0.f);
      delayPos_ = 0;
    }
    for (unsigned i = 0; i < b.frames; ++i) {
      float pre = compare_ ? b.before[i] : 0.f;
      if (!delay_.empty()) {
        std::swap(pre, delay_[delayPos_]);
        if (++delayPos_ == delay_.size())
          delayPos_ = 0;
      }
      ++count_;
      if (hq_) {
        const auto generation = output_->sink.revision();
        output_->fft.push(b.after[i], output_->sink);
        if (input_)
          input_->fft.push(pre, input_->sink);
        if (output_->sink.revision() == generation)
          continue;
      } else {
        const auto position = (count_ - 1) % 4096;
        normalOut_[position] = b.after[i];
        if (compare_)
          normalIn_[position] = pre;
        if (count_ < 4096 || count_ % 2048)
          continue;
      }
      SpectrumFrame f;
      f.id = id_;
      f.rate = rate_;
      f.generation = gen_;
      f.index = index_++;
      f.compare = compare_;
      f.hq = hq_;
      f.end = b.start + b.frames;
      f.delay = b.remaining;
      f.revision = b.revision;
      f.samples.resize(compare_ ? 8192 : 4096);
      if (hq_) {
        output_->read(f.output, f.samples.data());
        if (input_)
          input_->read(f.input, f.samples.data() + 4096);
        f.captured = origin_ + f.output.captured;
      } else {
        f.position = count_ % 4096;
        f.captured = b.start + i + 1;
        std::copy(normalOut_.begin(), normalOut_.end(), f.samples.begin());
        if (compare_)
          std::copy(normalIn_.begin(), normalIn_.end(), f.samples.begin() + 4096);
      }
      send(f);
    }
  }
  unsigned id_, gen_, rate_, index_ = 0, delayPos_ = 0;
  std::uint64_t nextFrame_ = UINT64_MAX, origin_ = 0, count_ = 0;
  bool compare_, hq_;
  std::array<Block, 32> blocks_;
  std::atomic<unsigned> read_{0}, write_{0};
  std::atomic<unsigned> resetBoundary_{0}, resetSerial_{0};
  unsigned observedReset_ = 0;
  std::array<float, 4096> normalIn_{}, normalOut_{};
  std::vector<float> delay_;
  std::unique_ptr<Analysis> input_, output_;
};
SpectrumTaps::SpectrumTaps(unsigned rate, unsigned frames) : rate_(rate), maxFrames_(frames) {
  active_.reserve(128);
  routed_.reserve(128);
}
void SpectrumTaps::reset() noexcept {
  for (const auto &a : active_)
    a.track->reset();
}
void SpectrumTaps::route(unsigned id, bool enabled) noexcept {
  auto it = std::find(routed_.begin(), routed_.end(), id);
  if (it == routed_.end()) {
    if (enabled && routed_.size() < 128)
      routed_.push_back(id);
  } else if (!enabled)
    routed_.erase(it);
}
SpectrumTaps::Update SpectrumTaps::prepare(unsigned id, bool enabled, bool compare, bool hq) {
  auto it = control_.find(id);
  Update update{id, it == control_.end() ? nullptr : it->second, nullptr};
  if (enabled) {
    if (it == control_.end() && control_.size() >= 128)
      throw std::runtime_error("too many spectrum taps");
    update.next = update.previous && update.previous->matches(compare, hq)
                      ? update.previous
                      : std::make_shared<Track>(id, ++generation_, rate_, maxFrames_, compare, hq);
    control_.insert_or_assign(id, update.next);
  } else
    control_.erase(id);
  return update;
}
void SpectrumTaps::apply(const Update &u) noexcept {
  auto it =
      std::find_if(active_.begin(), active_.end(), [&](const Active &a) { return a.id == u.id; });
  if (u.next) {
    if (it == active_.end())
      active_.push_back({u.id, 0, 0, u.next.get()});
    else
      it->track = u.next.get();
  } else if (it != active_.end())
    active_.erase(it);
}
void SpectrumTaps::begin(const Pipeline &p) noexcept {
  for (auto &a : active_) {
    a.instance = p.instance(a.id);
    a.remaining = p.remainingLatency(a.instance);
  }
}
void SpectrumTaps::capture(unsigned instance, const float *audio, unsigned channels,
                           unsigned frames, unsigned latency, bool before, std::uint64_t start,
                           std::uint64_t revision) noexcept {
  for (const auto &a : active_)
    if (a.instance == instance)
      a.track->capture(audio, channels, frames, latency, before, start, a.remaining, revision);
}
void SpectrumTaps::drain(const std::function<void(const SpectrumFrame &)> &send) {
  for (const auto &[id, track] : control_) {
    (void)id;
    track->drain(send);
  }
}
} // namespace effetune::audio

#include "effetune/spectrum_tap.h"
#include "effetune/dsp/spectrum_hq_sink.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <utility>

namespace effetune {
namespace {
constexpr std::uint32_t kSize = 4096, kBlockFrames = 256, kSlots = 128;
constexpr double kPi = 3.14159265358979323846;
constexpr double kFloor = 1e-24;
static_assert(std::atomic<std::uint64_t>::is_always_lock_free);

// Identical Float32 butterflies/calibration and power smoothing to the browser
// overlay. Preparation owns coefficients; only the consumer performs FFTs.
struct NormalAnalysis {
  std::array<float, kSize> real{}, imag{}, window{}, cosine{}, sine{};
  std::array<std::uint16_t, kSize> reverse{};
  std::array<double, kSize / 2> power{};
  NormalAnalysis() {
    for (std::uint32_t i = 0; i < kSize; ++i) {
      const double angle = 2 * kPi * i / kSize;
      window[i] = static_cast<float>(0.5 * (1 - std::cos(angle)));
      cosine[i] = static_cast<float>(std::cos(angle));
      sine[i] = static_cast<float>(-std::sin(angle));
      auto bits = i;
      for (std::uint32_t bit = 0; bit < 12; ++bit, bits >>= 1u)
        reverse[i] = static_cast<std::uint16_t>((reverse[i] << 1u) | (bits & 1u));
    }
  }
  void analyze(const std::array<float, kSize> &ring, std::uint32_t position,
               SpectrumTapSpectrum &spectrum, float decay, bool firstFrame) {
    imag.fill(0);
    for (std::uint32_t i = 0; i < kSize; ++i)
      real[reverse[i]] = ring[(position + i) & (kSize - 1)] * window[i];
    for (std::uint32_t stage = 1, size = 2; size <= kSize; ++stage, size <<= 1u) {
      const auto half = size / 2;
      for (std::uint32_t i = 0; i < kSize; i += size) {
        for (std::uint32_t k = 0; k < half; ++k) {
          const auto j = i + k, index = k << (12 - stage);
          const double tr = static_cast<double>(real[j + half]) * cosine[index] -
                            static_cast<double>(imag[j + half]) * sine[index];
          const double ti = static_cast<double>(real[j + half]) * sine[index] +
                            static_cast<double>(imag[j + half]) * cosine[index];
          real[j + half] = static_cast<float>((real[j] - tr) * 0.5);
          imag[j + half] = static_cast<float>((imag[j] - ti) * 0.5);
          real[j] = static_cast<float>((real[j] + tr) * 0.5);
          imag[j] = static_cast<float>((imag[j] + ti) * 0.5);
        }
      }
    }
    for (std::uint32_t i = 0; i < power.size(); ++i)
      power[i] = (static_cast<double>(real[i]) * real[i] + static_cast<double>(imag[i]) * imag[i] +
                  kFloor) *
                 (i == 0 ? 4 : 16);
    const double ratio = std::pow(2.0, 1.0 / 24);
    std::uint32_t first = 0, end = 0;
    double sum = 0;
    for (std::uint32_t i = 0; i < power.size(); ++i) {
      const auto last = std::min(static_cast<std::uint32_t>(power.size()),
                                 static_cast<std::uint32_t>(std::floor(i * ratio)) + 1);
      while (end < last)
        sum += power[end++];
      const auto begin = static_cast<std::uint32_t>(std::ceil(i / ratio));
      while (first < begin)
        sum -= power[first++];
      const double average = sum / (last - begin);
      const float level = static_cast<float>(10 * std::log10(average > kFloor ? average : kFloor));
      spectrum.current[i] = level;
      const float previous = firstFrame ? -240.0F : spectrum.peaks[i] - decay;
      const float held = level > 0 ? 0 : level;
      const float peak = held > previous ? held : previous;
      spectrum.peaks[i] = peak < -240.0F ? -240.0F : peak;
    }
  }
};
float mean(const float *audio, std::uint32_t channels, std::uint32_t frames,
           std::uint32_t frame) noexcept {
  float sum = audio[frame];
  for (std::uint32_t channel = 1; channel < channels; ++channel)
    sum += audio[static_cast<std::size_t>(channel) * frames + frame];
  return sum / static_cast<float>(channels);
}
SpectrumTapMode modeOf(std::uint64_t token) { return static_cast<SpectrumTapMode>(token & 3u); }
SpectrumTapQuality qualityOf(std::uint64_t token) {
  return static_cast<SpectrumTapQuality>((token >> 2u) & 1u);
}
} // namespace

SpectrumTapTiming spectrumTapTiming(SpectrumTapQuality quality, double sampleRate) noexcept {
  SpectrumTapTiming timing;
  if (quality == SpectrumTapQuality::HQ) {
    const double hop = std::max(2048.0, std::ceil(sampleRate / 30));
    timing.windowAgeFrames = 8192;
    timing.completionFrames = 48 + static_cast<std::uint32_t>(hop / 16) * 16;
  }
  return timing;
}

std::uint32_t
SpectrumTapTiming::requiredOutputDelay(std::uint32_t existingDelayFrames,
                                       std::uint32_t deviceDelayFrames, std::uint32_t maxFrames,
                                       std::uint32_t deliveryBudgetFrames) const noexcept {
  const auto needed =
      static_cast<std::uint64_t>(windowAgeFrames) + completionFrames + deliveryBudgetFrames;
  const auto available =
      static_cast<std::uint64_t>(tapDelayFrames) + existingDelayFrames + deviceDelayFrames;
  return static_cast<std::uint32_t>(
      std::min<std::uint64_t>(needed > available ? needed - available : 0, maxFrames));
}

struct SpectrumTap::Storage {
  struct Block {
    std::array<float, kBlockFrames> input{}, output{};
    std::uint64_t token = 0, epoch = 0, firstFrame = 0;
    std::uint32_t frames = 0, latency = 0, tapDelay = 0;
  };
  std::array<Block, kSlots> blocks;
  std::atomic<std::uint32_t> read{0}, write{0}, dropped{0};
  std::atomic<std::uint64_t> token{0}, epoch{1};
  double rate = 0;
  std::vector<float> before;
  std::uint64_t pendingToken = 0, pendingEpoch = 0, pendingFrame = 0;
  std::uint32_t pendingFrames = 0;
  // Consumer-only state.
  std::uint64_t generation = 0, activeToken = 0, activeEpoch = 0, origin = 0, nextFrame = 0;
  bool hasHistory = false;
  std::uint32_t position = 0, delayPosition = 0, tapDelay = 0;
  std::array<float, kSize> input{}, output{};
  std::vector<float> delay;
  SpectrumTapFrame frame;
  NormalAnalysis normal;
  std::unique_ptr<dsp::MultiresSpectrum> inputHq, outputHq;
  std::unique_ptr<dsp::SpectrumHqSink> inputSink, outputSink;

  bool reset(const Block &block) {
    activeToken = block.token;
    activeEpoch = block.epoch;
    origin = block.firstFrame;
    nextFrame = origin;
    tapDelay = block.tapDelay;
    position = delayPosition = 0;
    input.fill(0);
    output.fill(0);
    delay.assign(block.latency, 0);
    frame = {};
    frame.sampleRate = rate;
    frame.mode = modeOf(block.token);
    frame.quality = qualityOf(block.token);
    frame.timing = spectrumTapTiming(frame.quality, rate);
    frame.timing.generation = ++generation;
    frame.timing.tapDelayFrames = tapDelay;
    inputHq.reset();
    outputHq.reset();
    inputSink.reset();
    outputSink.reset();
    if (frame.quality == SpectrumTapQuality::HQ) {
      outputHq = std::make_unique<dsp::MultiresSpectrum>();
      outputSink = std::make_unique<dsp::SpectrumHqSink>(static_cast<float>(rate));
      if (!outputHq->prepare(static_cast<float>(rate), false))
        return false;
      if (frame.mode == SpectrumTapMode::Compare) {
        inputHq = std::make_unique<dsp::MultiresSpectrum>();
        inputSink = std::make_unique<dsp::SpectrumHqSink>(static_cast<float>(rate));
        if (!inputHq->prepare(static_cast<float>(rate), false))
          return false;
      }
    }
    return true;
  }
};

SpectrumTap::SpectrumTap() : storage_(std::make_unique<Storage>()) {}
SpectrumTap::~SpectrumTap() = default;

bool SpectrumTap::prepare(double sampleRate, std::uint32_t maxFrames) {
  if (!std::isfinite(sampleRate) || sampleRate <= 0 || sampleRate > 768000 || maxFrames == 0)
    return false;
  storage_->rate = sampleRate;
  storage_->before.resize(maxFrames);
  invalidate();
  return true;
}

bool SpectrumTap::configure(SpectrumTapMode mode, SpectrumTapQuality quality) {
  if (mode > SpectrumTapMode::Compare || quality > SpectrumTapQuality::HQ)
    return false;
  const auto previous = storage_->token.load(std::memory_order_acquire);
  if (modeOf(previous) == mode && qualityOf(previous) == quality)
    return true;
  storage_->token.store(((previous >> 3u) + 1u) * 8u | static_cast<std::uint64_t>(mode) |
                            (static_cast<std::uint64_t>(quality) << 2u),
                        std::memory_order_release);
  return true;
}

void SpectrumTap::invalidate() noexcept { storage_->epoch.fetch_add(1, std::memory_order_acq_rel); }

void SpectrumTap::capture(const float *audio, std::uint32_t channels, std::uint32_t frames,
                          std::uint64_t firstFrame, std::uint32_t effectLatencyFrames,
                          std::uint32_t tapDelayFrames, bool before) noexcept {
  auto &s = *storage_;
  if (before)
    s.pendingToken = 0;
  const auto token = s.token.load(std::memory_order_acquire);
  if (modeOf(token) == SpectrumTapMode::Off || !audio || channels == 0 || channels > 16 ||
      frames == 0 || frames > s.before.size())
    return;
  const auto epoch = s.epoch.load(std::memory_order_acquire);
  if (before) {
    s.pendingToken = token;
    s.pendingEpoch = epoch;
    s.pendingFrame = firstFrame;
    s.pendingFrames = frames;
    if (modeOf(token) == SpectrumTapMode::Compare)
      for (std::uint32_t i = 0; i < frames; ++i)
        s.before[i] = mean(audio, channels, frames, i);
    return;
  }
  if (s.pendingToken != token || s.pendingEpoch != epoch || s.pendingFrame != firstFrame ||
      s.pendingFrames != frames)
    return;
  s.pendingToken = 0;
  for (std::uint32_t offset = 0; offset < frames;) {
    const auto write = s.write.load(std::memory_order_relaxed), next = (write + 1u) % kSlots;
    if (next == s.read.load(std::memory_order_acquire)) {
      s.dropped.fetch_add(1, std::memory_order_relaxed);
      invalidate();
      return;
    }
    auto &block = s.blocks[write];
    block.token = token;
    block.epoch = epoch;
    block.firstFrame = firstFrame + offset;
    block.frames = std::min(kBlockFrames, frames - offset);
    block.latency = modeOf(token) == SpectrumTapMode::Compare ? effectLatencyFrames : 0;
    block.tapDelay = tapDelayFrames;
    for (std::uint32_t i = 0; i < block.frames; ++i) {
      block.input[i] = modeOf(token) == SpectrumTapMode::Compare ? s.before[offset + i] : 0;
      block.output[i] = mean(audio, channels, frames, offset + i);
    }
    s.write.store(next, std::memory_order_release);
    offset += block.frames;
  }
}

std::vector<SpectrumTapFrame> SpectrumTap::read(std::uint32_t &droppedBlocks) {
  auto &s = *storage_;
  droppedBlocks = s.dropped.exchange(0, std::memory_order_relaxed);
  const auto token = s.token.load(std::memory_order_acquire),
             epoch = s.epoch.load(std::memory_order_acquire);
  auto read = s.read.load(std::memory_order_relaxed);
  const auto write = s.write.load(std::memory_order_acquire);
  std::vector<SpectrumTapFrame> result;
  while (read != write) {
    const auto &block = s.blocks[read];
    if (modeOf(token) != SpectrumTapMode::Off && block.token == token && block.epoch == epoch) {
      if (!s.hasHistory || s.activeToken != token || s.activeEpoch != epoch ||
          s.nextFrame != block.firstFrame || s.delay.size() != block.latency ||
          s.tapDelay != block.tapDelay)
        s.hasHistory = s.reset(block);
      if (s.hasHistory) {
        for (std::uint32_t i = 0; i < block.frames; ++i) {
          auto input = block.input[i];
          if (!s.delay.empty()) {
            std::swap(input, s.delay[s.delayPosition]);
            s.delayPosition = (s.delayPosition + 1u) % block.latency;
          }
          bool publish = false;
          if (s.frame.quality == SpectrumTapQuality::HQ) {
            const auto revision = s.outputSink->revision();
            if (s.inputHq)
              s.inputHq->push(input, *s.inputSink);
            s.outputHq->push(block.output[i], *s.outputSink);
            publish = revision != s.outputSink->revision();
            if (publish) {
              dsp::MultiresSpectrumFrame metadata;
              if (s.inputSink)
                (void)s.inputSink->copySpectrum(s.frame.input.current.data(),
                                                s.frame.input.peaks.data(), metadata);
              (void)s.outputSink->copySpectrum(s.frame.output.current.data(),
                                               s.frame.output.peaks.data(), metadata);
              s.frame.output.validCellCount = s.frame.input.validCellCount =
                  metadata.validCellCount;
              s.frame.timing.captureEndFrame = s.origin + metadata.captureEndSample;
            }
          } else {
            s.input[s.position] = input;
            s.output[s.position] = block.output[i];
            s.position = (s.position + 1u) % kSize;
            publish = (s.position % (kSize / 2)) == 0;
            if (publish) {
              const float decay = static_cast<float>(20 * (kSize / 2) / s.rate);
              if (s.frame.mode == SpectrumTapMode::Compare)
                s.normal.analyze(s.input, s.position, s.frame.input, decay,
                                 s.frame.timing.frameIndex == 0);
              s.normal.analyze(s.output, s.position, s.frame.output, decay,
                               s.frame.timing.frameIndex == 0);
              s.frame.timing.captureEndFrame = block.firstFrame + i + 1;
            }
          }
          if (publish) {
            result.push_back(s.frame);
            ++s.frame.timing.frameIndex;
          }
        }
        s.nextFrame = block.firstFrame + block.frames;
      }
    }
    read = (read + 1u) % kSlots;
    s.read.store(read, std::memory_order_release);
  }
  if (s.token.load(std::memory_order_acquire) != token ||
      s.epoch.load(std::memory_order_acquire) != epoch)
    result.clear();
  return result;
}
} // namespace effetune

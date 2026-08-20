#include "effetune/kernel.h"
#include "MDSimulatorPluginParams.h"
#include "atrac1_core.h"
#include "atrac3_core.h"
#include "effetune/dsp/halfband.h"
#include "effetune/dsp/rational_resampler.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

namespace md = effetune::md_simulator;
namespace lp = effetune::md_simulator::atrac3;

constexpr std::uint32_t kChannels = 2u;
constexpr std::uint32_t kMaximumHalfbandStages = 3u;
// ATRAC1 sound unit (SP) and ATRAC3 frame (LP2/LP4) lengths.
constexpr std::uint32_t kUnitSamples = static_cast<std::uint32_t>(md::kSoundUnitSamples);
constexpr std::uint32_t kWindowSamples = static_cast<std::uint32_t>(lp::kFrameSamples);
static_assert(kWindowSamples % kUnitSamples == 0u,
              "the SP sound unit has to tile the coding window exactly");
// The fill/drain schedule runs on the longer of the two block lengths so that
// latencySamples(), which is fixed at prepare time, does not depend on the
// runtime mode parameter: SP is padded up to the LP window instead of the two
// modes reporting different delays.  The SP burst itself is unchanged, one unit
// is still encoded every kUnitSamples samples.
// Deferred work window.  A completed coding window is not drained immediately;
// the drain starts kWorkOffset codec samples into the next window, which leaves
// that many sample times for the LP codec to run its frame as four separate
// steps instead of one burst.  SP does not need the room, but it shares the
// schedule so that the declared latency stays mode independent.
constexpr std::uint32_t kWorkOffset = 128u;
constexpr std::uint32_t kLpWorkStep = 32u;
static_assert(3u * kLpWorkStep < kWorkOffset,
              "the four LP work steps have to finish before the drain starts");
static_assert(kWorkOffset < kUnitSamples,
              "the deferred LP work must not reach into the SP unit boundary");
// Host rate output queue.  The worst case occupancy is the startup priming of
// about 10900 samples at the 8x rate factor, plus the one sample jitter of the
// rational stages.
constexpr std::uint32_t kOutputCapacity = 16384u;
// Extra codec-rate samples held in the output queue on top of the coding window
// plus deferred work window that the input side has to collect and schedule
// before the first decoded sample appears.  It
// absorbs the +/- 1 sample jitter of the rational resampler phase, so the queue
// never runs dry once the pipeline is primed.
constexpr std::uint32_t kOutputCushion = 96u;
// Rational stage cutoff.  ATRAC1 codes the whole 0-22.05 kHz band, so the only
// constraint is that the 383 tap Kaiser stopband starts below the 22.05 kHz
// codec Nyquist.  21 kHz leaves the full audible band in the passband while
// keeping every fold-back product inside the stopband.
constexpr double kRationalCutoffHz = 21000.0;
constexpr double kControlSmoothingSeconds = 0.02;

// Host route: a halfband cascade converts between the host rate and the base rate
// of its own family (44.1 kHz or 48 kHz); the 48 kHz family then needs one
// rational stage to reach the 44.1 kHz codec rate.
struct HostTopology final {
  std::uint32_t baseRate = 0u;
  std::uint32_t halfbandStages = 0u;
};

[[nodiscard]] constexpr HostTopology hostTopology(std::uint32_t rate) noexcept {
  switch (rate) {
  case 44100u:
    return {44100u, 0u};
  case 88200u:
    return {44100u, 1u};
  case 176400u:
    return {44100u, 2u};
  case 352800u:
    return {44100u, 3u};
  case 48000u:
    return {48000u, 0u};
  case 96000u:
    return {48000u, 1u};
  case 192000u:
    return {48000u, 2u};
  case 384000u:
    return {48000u, 3u};
  default:
    return {0u, 0u};
  }
}

// Measured wet group delay per host rate.  native_test.cpp measures it two ways,
// as the impulse peak and as the best alignment of a sweep, and asserts both, for
// all three modes.  The components are the startup priming of the output queue,
// the codec delay of 1165 samples at 44.1 kHz (identical for the ATRAC1 and the
// ATRAC3 topology), the coding window of 1024 samples, the kWorkOffset deferred
// work window, the halfband cascade on both sides and, for the 48 kHz family,
// the two rational stages.  SP and LP therefore share one table: the per-rate
// topology maximum is the LP window, and SP is padded up to it so that the
// reported latency never depends on a runtime parameter.
[[nodiscard]] constexpr std::uint32_t wetLatencySamples(std::uint32_t rate) noexcept {
  constexpr std::array<std::uint32_t, 8> rates = {44100u,  48000u,  88200u,  96000u,
                                                  176400u, 192000u, 352800u, 384000u};
  constexpr std::array<std::uint32_t, 8> latencies = {2414u,  3026u,  4952u,  6176u,
                                                      10028u, 12477u, 20180u, 25077u};
  for (std::size_t index = 0; index < rates.size(); ++index) {
    if (rate == rates[index]) {
      return latencies[index];
    }
  }
  return 0u;
}

} // namespace

class MDSimulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MDSimulatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    hostRate_ = static_cast<std::uint32_t>(info.sampleRate + 0.5F);
    maxChannels_ = info.maxChannels;
    maxFrames_ = info.maxFrames;
    const HostTopology topology = hostTopology(hostRate_);
    baseRate_ = topology.baseRate;
    halfbandStages_ = topology.halfbandStages;
    prepared_ = baseRate_ != 0u && maxChannels_ != 0u && maxFrames_ != 0u;

    mdct_.prepare();
    codec_.resize(kChannels);
    for (md::Atrac1Channel &channel : codec_) {
      channel.prepare(&mdct_);
    }
    // The ATRAC3 state is ~13 kB, well past the 8 kB inline kernel storage of the
    // engine, so it lives behind a vector.  One element, allocated here, never on
    // the process path.
    lpCodec_.resize(1u);
    for (lp::Atrac3Codec &codec : lpCodec_) {
      codec.prepare(&mdct_);
    }

    inputHalfbands_.assign(kChannels * kMaximumHalfbandStages, {});
    outputHalfbands_.assign(kChannels * kMaximumHalfbandStages, {});
    downsamplers_.clear();
    upsamplers_.clear();
    if (prepared_ && baseRate_ != md::kCodecSampleRate) {
      downsamplers_.resize(kChannels);
      upsamplers_.resize(kChannels);
      for (std::uint32_t channel = 0u; channel < kChannels; ++channel) {
        downsamplers_[channel].prepare(baseRate_, md::kCodecSampleRate, kRationalCutoffHz);
        upsamplers_[channel].prepare(md::kCodecSampleRate, baseRate_, kRationalCutoffHz);
      }
    }

    // Both the coding window and the decoded window are double buffered: while
    // window k is being filled, the LP steps read window k-1 and write its decoded
    // output, and the drain reads the decoded output of k-1 and k-2.
    windowInput_.assign(2u * kChannels * kWindowSamples, 0.0);
    windowOutput_.assign(2u * kChannels * kWindowSamples, 0.0);
    outputRing_.assign(kChannels * kOutputCapacity, 0.0);

    latencySamples_ = prepared_ ? wetLatencySamples(hostRate_) : 0u;
    dryLength_ = latencySamples_ == 0u ? 1u : latencySamples_;
    dryDelay_.assign(kChannels * dryLength_, 0.0);
    primeSamples_ = prepared_ ? computePrimeSamples() : 0u;
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return prepared_ ? latencySamples_ : 0u;
  }

  void reset() noexcept override {
    for (md::Atrac1Channel &channel : codec_) {
      channel.reset();
    }
    for (lp::Atrac3Codec &codec : lpCodec_) {
      codec.reset();
    }
    for (dsp::Halfband2x &stage : inputHalfbands_) {
      stage.reset();
    }
    for (dsp::Halfband2x &stage : outputHalfbands_) {
      stage.reset();
    }
    for (dsp::RationalResampler &stage : downsamplers_) {
      stage.reset();
    }
    for (dsp::RationalResampler &stage : upsamplers_) {
      stage.reset();
    }
    std::fill(windowInput_.begin(), windowInput_.end(), 0.0);
    std::fill(windowOutput_.begin(), windowOutput_.end(), 0.0);
    std::fill(outputRing_.begin(), outputRing_.end(), 0.0);
    std::fill(dryDelay_.begin(), dryDelay_.end(), 0.0);
    windowFill_ = 0u;
    fillBank_ = 0u;
    fillMode_ = 0u;
    workMode_ = 0u;
    frameMode_.fill(0u);
    lpFrameBits_ = 0u;
    ringRead_.fill(0u);
    ringWrite_.fill(0u);
    ringCount_.fill(0u);
    dryPosition_ = 0u;
    activeChannels_ = 0u;
    completedUnits_ = 0u;
    activeMode_ = 0u;
    controlsInitialized_ = false;
    gainSmoothed_ = 1.0;
    mixSmoothed_ = 1.0;
    outputUnderflows_ = 0u;
    outputOverflows_ = 0u;
    // Prime the output queue so that the first sound unit burst arrives before the
    // queue can run dry.  This is the blocking delay of the codec, paid up front.
    for (std::uint32_t channel = 0u; channel < kChannels; ++channel) {
      for (std::uint32_t index = 0u; index < primeSamples_; ++index) {
        pushOutput(channel, 0.0);
      }
    }
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > maxChannels_ ||
        frame_count == 0u || frame_count > maxFrames_ || !prepared_) {
      return;
    }

    const std::uint32_t codecChannels = channel_count == 1u ? 1u : 2u;
    if (activeChannels_ != codecChannels) {
      reset();
      activeChannels_ = codecChannels;
    }

    double gainTarget = std::pow(10.0, static_cast<double>(params_.outputGain) / 20.0);
    if (!std::isfinite(gainTarget)) {
      gainTarget = 1.0;
    }
    double mixTarget = static_cast<double>(params_.mix) * 0.01;
    if (!std::isfinite(mixTarget)) {
      mixTarget = 1.0;
    }
    mixTarget = std::min(1.0, std::max(0.0, mixTarget));
    if (!controlsInitialized_) {
      gainSmoothed_ = gainTarget;
      mixSmoothed_ = mixTarget;
      controlsInitialized_ = true;
    }
    const double smoothing =
        1.0 - std::exp(-1.0 / (static_cast<double>(hostRate_) * kControlSmoothingSeconds));

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      gainSmoothed_ += smoothing * (gainTarget - gainSmoothed_);
      mixSmoothed_ += smoothing * (mixTarget - mixSmoothed_);

      std::array<double, kChannels> input{};
      for (std::uint32_t channel = 0u; channel < codecChannels; ++channel) {
        const double sample = static_cast<double>(audio[channel * frame_count + frame]);
        input[channel] = std::isfinite(sample) ? sample : 0.0;
      }

      std::array<double, kChannels> base{};
      if (decimateToBase(input, codecChannels, base)) {
        std::array<double, kChannels> codec{};
        if (toCodecRate(base, codecChannels, codec)) {
          pushCodecSample(codecChannels, codec);
        }
      }

      for (std::uint32_t channel = 0u; channel < codecChannels; ++channel) {
        const double wet = popOutput(channel);
        const double dry = delaySample(channel, input[channel]);
        double out = (dry + (wet - dry) * mixSmoothed_) * gainSmoothed_;
        if (!std::isfinite(out)) {
          out = 0.0;
        }
        audio[channel * frame_count + frame] = static_cast<float>(out);
      }
      if (latencySamples_ != 0u) {
        dryPosition_ = dryPosition_ + 1u == dryLength_ ? 0u : dryPosition_ + 1u;
      }
    }
  }

#if !defined(__EMSCRIPTEN__)
  // Test-only inspection hooks.  They are not part of the runtime ABI.
  [[nodiscard]] const md::SoundUnit &lastSoundUnit(std::uint32_t channel) const noexcept {
    return codec_[channel].lastUnit();
  }
  [[nodiscard]] std::uint32_t outputUnderflows() const noexcept { return outputUnderflows_; }
  [[nodiscard]] std::uint32_t outputOverflows() const noexcept { return outputOverflows_; }
  [[nodiscard]] std::uint32_t completedUnits() const noexcept { return completedUnits_; }

  [[nodiscard]] bool copyDiagnostic(md::KernelDiagnostic &out) const noexcept {
    if (!prepared_) {
      return false;
    }
    for (std::uint32_t channel = 0u; channel < kChannels; ++channel) {
      out.unit[channel] = codec_[channel].lastUnit();
    }
    out.completedUnits = completedUnits_;
    out.outputUnderflows = outputUnderflows_;
    out.outputOverflows = outputOverflows_;
    out.latencySamples = latencySamples_;
    out.baseRate = baseRate_;
    out.halfbandStages = halfbandStages_;
    out.primeSamples = primeSamples_;
    out.activeChannels = activeChannels_;
    out.rationalStages = static_cast<std::uint32_t>(downsamplers_.size() + upsamplers_.size());
    out.activeMode = activeMode_;
    out.lpFrameBits = lpFrameBits_;
    out.lpBudgetBits =
        lpCodec_.empty() ? 0u : static_cast<std::uint32_t>(lpCodec_.front().budgetBits());
    out.kernelObjectBytes = static_cast<std::uint32_t>(sizeof(*this));
    return true;
  }
#endif

private:
  [[nodiscard]] std::uint32_t computePrimeSamples() const noexcept {
    const double ratio = static_cast<double>(hostRate_) / static_cast<double>(md::kCodecSampleRate);
    return static_cast<std::uint32_t>(
               static_cast<double>(kWindowSamples + kWorkOffset + kOutputCushion) * ratio) +
           1u;
  }

  [[nodiscard]] dsp::Halfband2x &inputHalfband(std::uint32_t channel,
                                               std::uint32_t stage) noexcept {
    return inputHalfbands_[channel * kMaximumHalfbandStages + stage];
  }

  [[nodiscard]] dsp::Halfband2x &outputHalfband(std::uint32_t channel,
                                                std::uint32_t stage) noexcept {
    return outputHalfbands_[channel * kMaximumHalfbandStages + stage];
  }

  [[nodiscard]] bool decimateToBase(const std::array<double, kChannels> &input,
                                    std::uint32_t channels,
                                    std::array<double, kChannels> &output) noexcept {
    if (halfbandStages_ == 0u) {
      output = input;
      return true;
    }
    bool ready = false;
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      float value = static_cast<float>(input[channel]);
      bool available = true;
      for (std::uint32_t stage = 0u; stage < halfbandStages_; ++stage) {
        float next = 0.0F;
        available = inputHalfband(channel, stage).decimate(value, next);
        if (!available) {
          break;
        }
        value = next;
      }
      if (channel == 0u) {
        ready = available;
      }
      if (available) {
        output[channel] = static_cast<double>(value);
      }
    }
    return ready;
  }

  [[nodiscard]] bool toCodecRate(const std::array<double, kChannels> &base, std::uint32_t channels,
                                 std::array<double, kChannels> &output) noexcept {
    if (downsamplers_.empty()) {
      output = base;
      return true;
    }
    std::size_t produced = 0u;
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::array<float, dsp::RationalResampler::kMaximumOutputs> values{};
      const std::size_t count =
          downsamplers_[channel].push(static_cast<float>(base[channel]), values);
      if (channel == 0u) {
        produced = count;
      }
      if (count != 0u) {
        output[channel] = static_cast<double>(values[0]);
      }
    }
    return produced != 0u;
  }

  [[nodiscard]] double *codingWindow(std::uint32_t bank) noexcept {
    return windowInput_.data() + static_cast<std::size_t>(bank) * kChannels * kWindowSamples;
  }

  [[nodiscard]] double *decodedWindow(std::uint32_t bank) noexcept {
    return windowOutput_.data() + static_cast<std::size_t>(bank) * kChannels * kWindowSamples;
  }

  void pushCodecSample(std::uint32_t channels,
                       const std::array<double, kChannels> &codec) noexcept {
    // Deterministic work spreading, step one: the decoded window leaves the codec
    // one sample per codec sample time instead of as a 512 or 1024 sample burst.
    // The rate conversion behind emitCodecSample is the dominant per-window cost
    // at the high host rates (it runs at the host rate, so it scales with the rate
    // factor), and draining it here moves it from a single quantum to the whole
    // window interval.  The schedule is driven by codec sample arrivals, so it
    // does not depend on how the host chops the stream into blocks, and the
    // emitted values and their order are unchanged.
    drainWindowOutput(channels);

    if (windowFill_ == 0u) {
      latchWindowParameters(channels);
    }
    // Deterministic work spreading, step two: the LP frame of the previous window
    // is coded as four separate steps inside the deferred work window, so no
    // single audio quantum ever carries a whole ATRAC3 frame.
    runDeferredLpWork(channels);

    double *coding = codingWindow(fillBank_);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      coding[channel * kWindowSamples + windowFill_] = codec[channel];
    }
    ++windowFill_;

    // SP still encodes one 512 sample sound unit at a time, so the per-event burst
    // of the SP core is exactly what Phase 0 measured; only the drain of its
    // result is deferred, in the same way as for LP.
    if (fillMode_ == 0u && windowFill_ % kUnitSamples == 0u) {
      processSoundUnit(channels, windowFill_ / kUnitSamples - 1u);
    }
    if (windowFill_ < kWindowSamples) {
      return;
    }
    windowFill_ = 0u;
    fillBank_ ^= 1u;
    ++completedUnits_;
  }

  void processSoundUnit(std::uint32_t channels, std::uint32_t unit) noexcept {
    const std::uint32_t offset = unit * kUnitSamples;
    const double *coding = codingWindow(fillBank_);
    double *decoded = decodedWindow(fillBank_);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      codec_[channel].processUnit(coding + channel * kWindowSamples + offset,
                                  decoded + channel * kWindowSamples + offset);
    }
  }

  void runDeferredLpWork(std::uint32_t channels) noexcept {
    if (workMode_ == 0u || lpCodec_.empty()) {
      return;
    }
    lp::Atrac3Codec &codec = lpCodec_.front();
    // The previous window: its coding samples and its decoded output share the
    // other bank, which nothing else touches until the drain reaches it.
    const std::uint32_t bank = fillBank_ ^ 1u;
    switch (windowFill_) {
    case 0u:
      codec.beginFrame(codingWindow(bank), kWindowSamples);
      codec.analyzeChannel(0u);
      break;
    case kLpWorkStep:
      if (channels > 1u) {
        codec.analyzeChannel(1u);
      }
      break;
    case 2u * kLpWorkStep:
      codec.allocateFrame();
      break;
    case 3u * kLpWorkStep:
      codec.finishFrame(decodedWindow(bank), kWindowSamples);
      lpFrameBits_ = codec.lastFrameBits();
      break;
    default:
      break;
    }
  }

  void drainWindowOutput(std::uint32_t channels) noexcept {
    // Before the deferred work window has elapsed the drain is still finishing the
    // window before the previous one, which lives in the bank that is being
    // filled; its decoded samples are only overwritten later in this window.
    const bool tail = windowFill_ < kWorkOffset;
    if (completedUnits_ == 0u || (tail && completedUnits_ < 2u)) {
      return;
    }
    const std::uint32_t bank = tail ? fillBank_ : (fillBank_ ^ 1u);
    const std::uint32_t index =
        tail ? (kWindowSamples - kWorkOffset + windowFill_) : (windowFill_ - kWorkOffset);
    const double *decoded = decodedWindow(bank);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      emitCodecSample(channel, decoded[channel * kWindowSamples + index]);
    }
  }

  void latchWindowParameters(std::uint32_t channels) noexcept {
    int index = static_cast<int>(std::floor(static_cast<double>(params_.mode) + 0.5));
    if (index < 0) {
      index = 0;
    } else if (index > 2) {
      index = 2;
    }
    const std::uint32_t incoming = static_cast<std::uint32_t>(index);
    const std::uint32_t previous = frameMode_[fillBank_ ^ 1u];
    const std::uint32_t older = frameMode_[fillBank_];
    frameMode_[fillBank_] = incoming;
    fillMode_ = incoming;
    workMode_ = previous;
    activeMode_ = incoming;

    // The two cores keep completely separate transform history, so crossing
    // between them has to start from a clean state in both directions; otherwise
    // an LP2 -> SP -> LP2 round trip would fold stale overlap into the first
    // window after the switch.  SP codes the incoming window, so it is reset when
    // the window before it was not SP; the LP core codes the previous window, so
    // it is reset when the window before that one was coded differently.
    if (incoming == 0u && previous != 0u) {
      for (md::Atrac1Channel &channel : codec_) {
        channel.reset();
      }
    }
    if (previous == 0u) {
      lpFrameBits_ = 0u;
      return;
    }
    // configure() is idempotent and only drops state on a real structural change,
    // and this is a frame boundary, which is the only place it is allowed.
    for (lp::Atrac3Codec &codec : lpCodec_) {
      codec.configure(previous == 2u ? lp::Mode::Lp4 : lp::Mode::Lp2, channels);
      if (older != previous) {
        codec.reset();
      }
    }
  }

  void emitCodecSample(std::uint32_t channel, double value) noexcept {
    if (upsamplers_.empty()) {
      emitBaseSample(channel, value);
      return;
    }
    std::array<float, dsp::RationalResampler::kMaximumOutputs> values{};
    const std::size_t count = upsamplers_[channel].push(static_cast<float>(value), values);
    for (std::size_t index = 0; index < count; ++index) {
      emitBaseSample(channel, static_cast<double>(values[index]));
    }
  }

  void emitBaseSample(std::uint32_t channel, double value) noexcept {
    std::array<float, 8> current{};
    current[0] = static_cast<float>(value);
    std::size_t count = 1u;
    for (std::uint32_t stage = 0u; stage < halfbandStages_; ++stage) {
      std::array<float, 8> next{};
      for (std::size_t index = 0; index < count; ++index) {
        float first = 0.0F;
        float second = 0.0F;
        outputHalfband(channel, stage).interpolate(current[index], first, second);
        next[2u * index] = first;
        next[2u * index + 1u] = second;
      }
      current = next;
      count *= 2u;
    }
    for (std::size_t index = 0; index < count; ++index) {
      pushOutput(channel, static_cast<double>(current[index]));
    }
  }

  void pushOutput(std::uint32_t channel, double value) noexcept {
    if (ringCount_[channel] >= kOutputCapacity) {
      ++outputOverflows_;
      return;
    }
    outputRing_[channel * kOutputCapacity + ringWrite_[channel]] = value;
    ringWrite_[channel] =
        ringWrite_[channel] + 1u == kOutputCapacity ? 0u : ringWrite_[channel] + 1u;
    ++ringCount_[channel];
  }

  [[nodiscard]] double popOutput(std::uint32_t channel) noexcept {
    if (ringCount_[channel] == 0u) {
      ++outputUnderflows_;
      return 0.0;
    }
    const double value = outputRing_[channel * kOutputCapacity + ringRead_[channel]];
    ringRead_[channel] = ringRead_[channel] + 1u == kOutputCapacity ? 0u : ringRead_[channel] + 1u;
    --ringCount_[channel];
    return value;
  }

  [[nodiscard]] double delaySample(std::uint32_t channel, double input) noexcept {
    if (latencySamples_ == 0u) {
      return input;
    }
    double *ring = dryDelay_.data() + channel * dryLength_;
    const double value = ring[dryPosition_];
    ring[dryPosition_] = input;
    return value;
  }

  md::Mdct mdct_{};
  std::vector<md::Atrac1Channel> codec_;
  std::vector<lp::Atrac3Codec> lpCodec_;
  std::vector<dsp::Halfband2x> inputHalfbands_;
  std::vector<dsp::Halfband2x> outputHalfbands_;
  std::vector<dsp::RationalResampler> downsamplers_;
  std::vector<dsp::RationalResampler> upsamplers_;
  std::vector<double> windowInput_;
  std::vector<double> windowOutput_;
  std::vector<double> outputRing_;
  std::vector<double> dryDelay_;

  std::uint32_t hostRate_ = 0u;
  std::uint32_t baseRate_ = 0u;
  std::uint32_t halfbandStages_ = 0u;
  std::uint32_t maxChannels_ = 0u;
  std::uint32_t maxFrames_ = 0u;
  std::uint32_t latencySamples_ = 0u;
  std::uint32_t dryLength_ = 1u;
  std::uint32_t primeSamples_ = 0u;
  std::uint32_t windowFill_ = 0u;
  std::uint32_t fillBank_ = 0u;
  std::uint32_t fillMode_ = 0u;
  std::uint32_t workMode_ = 0u;
  std::uint32_t lpFrameBits_ = 0u;
  std::array<std::uint32_t, 2u> frameMode_{};
  std::array<std::uint32_t, kChannels> ringRead_{};
  std::array<std::uint32_t, kChannels> ringWrite_{};
  std::array<std::uint32_t, kChannels> ringCount_{};
  std::uint32_t dryPosition_ = 0u;
  std::uint32_t activeChannels_ = 0u;
  std::uint32_t activeMode_ = 0u;
  std::uint32_t outputUnderflows_ = 0u;
  std::uint32_t outputOverflows_ = 0u;
  std::uint32_t completedUnits_ = 0u;
  bool prepared_ = false;
  bool controlsInitialized_ = false;
  double gainSmoothed_ = 1.0;
  double mixSmoothed_ = 1.0;
};

} // namespace effetune::plugins::lofi

#if !defined(__EMSCRIPTEN__)
// Test-only accessor.  native_test.cpp only ever holds a PluginKernel pointer,
// so the inspection hooks are reached through this free function, in the same
// way as the MP3 codec simulator does it.
extern "C" bool
et_md_copy_diagnostic(const effetune::PluginKernel *kernel,
                      effetune::md_simulator::KernelDiagnostic *diagnostic) noexcept {
  if (kernel == nullptr || diagnostic == nullptr) {
    return false;
  }
  const auto *md_kernel = static_cast<const effetune::plugins::lofi::MDSimulatorKernel *>(kernel);
  return md_kernel->copyDiagnostic(*diagnostic);
}
#endif

EFFETUNE_REGISTER_KERNEL(MDSimulatorPlugin, effetune::plugins::lofi::MDSimulatorKernel)

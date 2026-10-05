#include "effetune/kernel.h"
#include "RhythmAnalyzerPluginParams.h"
#include "a3_clock.h"
#include "binary_io.h"
#include "effetune/dsp/pffft_incremental.h"
#include "rhythm_d.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <vector>

namespace effetune::plugins::analyzer {
namespace {
using dsp::PffftOrderedRealForward;
struct AlignedDeleter {
  void operator()(float *p) const noexcept { pffft_aligned_free(p); }
};
using Buffer = std::unique_ptr<float, AlignedDeleter>;
struct Transform {
  PFFFT_Setup *setup;
  PffftOrderedRealForward forward;
  explicit Transform(std::uint32_t size)
      : setup(pffft_new_setup(static_cast<int>(size), PFFFT_REAL)), forward(setup) {}
  ~Transform() { pffft_destroy_setup(setup); }
};
struct Event {
  double time;
  float strength, beatFraction, period;
  std::int32_t beatIndex;
  std::uint32_t epoch;
  std::uint8_t band, flags;
};
constexpr std::uint32_t kTelemetryType = 28u, kTelemetryVersion = 1u, kPayloadBytes = 1344u;
constexpr std::uint32_t kTempogramBins = 192u, kMaxEvents = 16u, kEventCapacity = 64u;
static_assert(kTempogramBins == static_cast<std::uint32_t>(rhythm_a3::dec::kMapBins),
              "the tempo map fills the tempogram");
constexpr std::uint32_t kCandidates = 241u, kCaptureChunk = 256u, kMaxRing = 16u;
constexpr double kBands[3][2] = {{30.0, 200.0}, {200.0, 4000.0}, {4000.0, 16000.0}};
// Detector: SuperFlux (3-bin reference max filter), mean + 3.5 sd threshold with floors.
constexpr double kGamma = 1000.0, kThresholdSd = 3.5, kThresholdAbs = .004, kThresholdPeak = .08;
constexpr double kRefractory = .045;
// Narrowest candidate range (max/min) accepted from the parameters.
constexpr double kMinimumSpan = 1.25;
// Beat tracker. Confidence = prior-free comb value of the mean-removed, normalised ACF,
// with lock (kConfidenceOn) / hold (kConfidenceOff) hysteresis.
// kUnlockSeconds: seconds confidence must stay below kConfidenceOff before the tracker unlocks.
// kHoldSeconds: how long a challenger metrical level must keep winning before the tracker switches.
// kSwitchRatio: salience ratio a challenger level needs over the current one to start that hold.
// kMinActivity: minimum envelope activity below which confidence is forced to zero (silence).
constexpr double kConfidenceOn = .2, kConfidenceOff = .13, kUnlockSeconds = 8.0, kHoldSeconds = 1.2,
                 kSwitchRatio = 1.25, kMinActivity = .02;
// Periodicity counts only with onset support: at least kMinOnsets events in the last
// kOnsetWindow seconds (a steady envelope ripple such as vibrato is not a beat).
constexpr double kOnsetWindow = 4.0;
constexpr std::uint32_t kMinOnsets = 4u;
// ACF memory and length, centering time constant.
constexpr double kAcfTau = 1.5, kAcfSeconds = 4.0, kCenterTau = 2.0;
// Tempogram display floor: a column is divided by max(peak, kTempogramFloor), so only clear
// repetition reaches 1. Derived as the column-peak p99.9 of the normalised ACF on noise and
// dither, which does not depend on their level.
constexpr double kTempogramFloor = .3;
// Metrical level: the comb winner competes with its 2:3/3:2/3:4/4:3 relatives by
// comb * (1 + |Fourier tempogram| / sum)^kMetricalGamma over kMetricalWindow seconds.
constexpr double kMetricalWindow = 8.0, kMetricalGamma = 2.0, kMetricalSearch = .03;
constexpr double kMetricalRatios[4] = {2.0 / 3.0, 3.0 / 2.0, 3.0 / 4.0, 4.0 / 3.0};
// Beat phase: while locked, every envelope tick deposits its novelty into a leaky profile over one
// beat period; once per beat the profile peak gives the phase error e in beats.
// kAlpha: share of e applied to the beat anchor when |e| <= kPhaseDeadZone.
// kBeta: share of e applied to the period when |e| <= kPhaseDeadZone.
// kPhaseDeadZone: largest |e| (beats) corrected in place; a larger error is a re-phase candidate.
// kPhaseRatio: a re-phase candidate needs a peak this much above the profile at the current phase.
// kPhaseCount: consecutive re-phase candidates that jump the anchor to the peak (tempo kept).
// kProfileBins: profile resolution per beat.
// kProfileBeats: profile memory in beats (sets the per-tick leak from the period).
// kSeedSeconds: envelope history folded into the profile on lock and tempo switch.
// kEnvDelay: envelope latency against the beat, in seconds.
// kPull: share of the comb-estimate period error applied to the period at each beat.
// kPullLog: largest |log(comb period / period)| for which that pull applies.
// kConsist: a re-phase count restarts when the competing peak moved by more than this (beats).
// kFastRatio: a tempo candidate this much more salient than the locked tempo switches early.
// kFastSeconds: the hold for such a candidate, instead of kHoldSeconds.
// kPhaseEvents: onset ring length (onset-count gate only).
constexpr double kAlpha = .8, kBeta = .1, kPhaseDeadZone = .25, kPhaseRatio = 1.2,
                 kProfileBeats = 4.0, kSeedSeconds = 8.0, kEnvDelay = .009;
constexpr double kPull = .3, kPullLog = .2, kConsist = .1, kFastRatio = 2.0, kFastSeconds = .4;
constexpr std::uint32_t kPhaseCount = 3u, kProfileBins = 48u, kPhaseEvents = 512u;
// Metronome click: 2 kHz damped sine, linear attack, exponential decay time constant, peak level
// (-10 dBFS) and the length after which it is cut (10 decay time constants).
constexpr double kClickFrequency = 2000.0, kClickAttack = .0005, kClickDecay = .006,
                 kClickLevel = .31622776601683794, kClickLength = .06;
constexpr double kHarmonicWeights[4] = {1.0, 0.70710678118654752, 0.57735026918962576, .5};
constexpr double kPi = 3.141592653589793;
// Detected-minus-true onset delay per band (low, mid, high), calibrated from native clicks.
constexpr double kBias44k[3] = {.005636, .005204, .006563};
constexpr double kBias48k[3] = {.005122, .004670, .006032};
constexpr double kBias96k[3] = {.005156, .004756, .006224};
double clamp(double value, double lo, double hi) noexcept {
  return value < lo ? lo : (value > hi ? hi : value);
}
std::uint32_t pow2(double value) noexcept {
  return static_cast<std::uint32_t>(std::exp2(std::nearbyint(std::log2(value))));
}
float unitFraction(double value) noexcept {
  const auto fraction = static_cast<float>(value);
  return fraction < 1.0F ? (fraction < 0.0F ? 0.0F : fraction) : 0.99999994F;
}
} // namespace

// Causal rhythm analysis. At the full-analysis rates the A3 beat clock drives tempo and beat phase,
// with learned onset lanes supplying the onsets; at other rates a fallback tracker (causal onset
// detection, centered leaky-ACF tempogram, comb tempo selection with a metrical-level decision, and
// beat phase from a continuous beat-synchronous novelty profile) runs on the device stream.
class RhythmAnalyzerKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::RhythmAnalyzerPluginParams)
public:
  void prepare(const PrepareInfo &info) override {
    ready_ = false;
    device_rate_ =
        std::isfinite(info.sampleRate) && info.sampleRate > 0 ? info.sampleRate : 48000.0;
    // At a rate-rule rate the analysis runs on the lanes' analysis stream and A3 drives the clock;
    // at any other rate the production path runs on the device stream.
    const std::uint32_t analysis = rhythm_d::RateRule::analysisRate(device_rate_);
    rate_ = analysis != 0u ? static_cast<double>(analysis) : device_rate_;
    hop_ = pow2(clamp(.00267 * rate_, 8.0, 4096.0));
    size_ = pow2(clamp(.0213 * rate_, 64.0, 32768.0));
    if (size_ < 4u * hop_)
      size_ = 4u * hop_;
    frame_rate_ = rate_ / hop_;
    pool_ = static_cast<std::uint32_t>(std::nearbyint(frame_rate_ / 100.0));
    pool_ = pool_ < 1u ? 1u : pool_;
    env_rate_ = frame_rate_ / pool_;
    env_hop_ = hop_ * pool_;
    const auto pre = std::nearbyint(.012 * frame_rate_);
    ring_length_ = static_cast<std::uint32_t>(clamp(pre, 1.0, kMaxRing - 2.0)) + 2u;
    const auto *bias = rate_ < 46050.0 ? kBias44k : (rate_ < 72000.0 ? kBias48k : kBias96k);
    std::uint32_t bins = 0u;
    for (int c = 0; c < 3; ++c) {
      bias_[c] = bias[c];
      const double hi = kBands[c][1] < .45 * rate_ ? kBands[c][1] : .45 * rate_;
      const auto k0 = static_cast<std::uint32_t>(std::floor(kBands[c][0] * size_ / rate_));
      bin_begin_[c] = k0 < 1u ? 1u : k0;
      const auto k1 = static_cast<std::uint32_t>(std::ceil(hi * size_ / rate_));
      bin_end_[c] = k1 > bin_begin_[c] ? k1 : bin_begin_[c];
      offset_[c] = bins;
      bins += bin_end_[c] - bin_begin_[c];
    }
    // At A3 rates the picker reads A3's front-end spectrum (375 frames/s) with A3's constants.
    a_mean_ = analysis != 0u ? rhythm_a3::tc::kFeAMean : 1.0 - std::exp(-1.0 / (.1 * frame_rate_));
    d_peak_ = analysis != 0u ? rhythm_a3::tc::kFeDPeak : std::exp(-1.0 / (3.0 * frame_rate_));
    a_env_ = 1.0 - std::exp(-1.0 / (2.0 * env_rate_));
    a_center_ = 1.0 - std::exp(-1.0 / (kCenterTau * env_rate_));
    lambda_ = std::exp(-1.0 / (kAcfTau * env_rate_));
    lmax_ = static_cast<std::uint32_t>(std::ceil(kAcfSeconds * env_rate_));
    history_length_ = static_cast<std::uint32_t>(std::ceil(kMetricalWindow * env_rate_));
    latency_ = (size_ / 2.0 + 2.0 * hop_) / rate_ + rhythm_d::RateRule::delaySeconds(device_rate_);
    // Click resonator y[n] = a y[n-1] - b y[n-2] = A r^n sin(w n), started from y[0] = 0 and
    // y[-1] = -A sin(w) / r; A puts the envelope peak (end of the attack) at kClickLevel.
    const double omega = 2.0 * kPi * kClickFrequency / device_rate_,
                 r = std::exp(-1.0 / (kClickDecay * device_rate_));
    const double amplitude = kClickLevel * std::exp(kClickAttack / kClickDecay);
    click_a_ = 2.0 * r * std::cos(omega);
    click_b_ = r * r;
    click_start_ = -amplitude * std::sin(omega) / r;
    click_attack_ = static_cast<std::uint32_t>(std::ceil(kClickAttack * device_rate_));
    click_length_ = static_cast<std::uint32_t>(std::ceil(kClickLength * device_rate_));
    if (analysis != 0u) {
      // The lanes' frames replace the kernel's FFT: two stages per hop, the picker frame and the
      // tick.
      transform_.reset();
      for (auto &buffer : buffers_)
        buffer.reset();
      window_.clear();
      capture_stages_ = 0u;
      stage_count_ = 2u;
      if (!a3_)
        a3_ = std::make_unique<rhythm_a3::A3Clock>();
      if (!a3_->prepare(rate_, device_rate_))
        return;
      a3_->setBeatSink({this, &RhythmAnalyzerKernel::beatEvent});
    } else {
      a3_.reset();
      transform_ = std::make_unique<Transform>(size_);
      if (!transform_->setup || !transform_->forward.valid())
        return;
      capture_stages_ = size_ / kCaptureChunk + (size_ % kCaptureChunk ? 1u : 0u);
      stage_count_ =
          capture_stages_ + 1u + static_cast<std::uint32_t>(transform_->forward.stepCount()) + 2u;
      for (auto &buffer : buffers_) {
        buffer.reset(static_cast<float *>(
            pffft_aligned_malloc(static_cast<std::size_t>(size_) * sizeof(float))));
        if (!buffer)
          return;
      }
      window_.resize(size_);
      for (std::uint32_t i = 0u; i < size_; ++i)
        window_[i] = static_cast<float>(.5 - .5 * std::cos(2.0 * 3.141592653589793 * i / size_));
      double sum = 0.0;
      for (const auto w : window_)
        sum += w;
      norm_ = kGamma * 2.0 / sum;
    }
    std::uint32_t ring = 1u;
    while (ring < size_ + 2u * hop_)
      ring *= 2u;
    ring_.assign(ring, 0.0F);
    previous_.assign(bins > 0u ? bins : 1u, 0.0);
    history_.assign(2u * history_length_, 0.0);
    centered_.assign(2u * (lmax_ + 1u), 0.0);
    acf_.assign(lmax_ + 1u, 0.0);
    normalized_.assign(lmax_ + 1u, 0.0);
    phase_time_.assign(kPhaseEvents, 0.0);
    const auto seed = static_cast<std::uint32_t>(std::nearbyint(kSeedSeconds * env_rate_));
    seed_length_ = seed < history_length_ ? seed : history_length_;
    candidate_lag_.assign(kCandidates, 0.0);
    inverse_weight_.assign(kCandidates, 0.0);
    prior_.assign(kCandidates, 0.0);
    comb_.assign(kCandidates, 0.0);
    tempogram_lag_.resize(kTempogramBins);
    for (std::uint32_t i = 0u; i < kTempogramBins; ++i)
      tempogram_lag_[i] = 60.0 * env_rate_ / (30.0 * std::exp2((i + .5) / 48.0));
    events_.assign(kEventCapacity, Event{});
    // The telemetry lanes come from the D-learned detector; the picker keeps feeding the clock.
    if (!lanes_)
      lanes_ = std::make_unique<rhythm_d::Detector>();
    lanes_->sink = {this, &RhythmAnalyzerKernel::laneEvent, nullptr, nullptr};
    lanes_->prepare(device_rate_);
    ready_ = true;
    sync_ = true;
    minimum_ = maximum_ = 0.0;
    synchronize();
    reset();
  }
  bool preparedSuccessfully() const noexcept override { return ready_; }
  void reset() noexcept override {
    if (++generation_ == 0u)
      ++generation_;
    std::fill(ring_.begin(), ring_.end(), 0.0F);
    std::fill(previous_.begin(), previous_.end(), 0.0);
    std::fill(history_.begin(), history_.end(), 0.0);
    std::fill(centered_.begin(), centered_.end(), 0.0);
    std::fill(acf_.begin(), acf_.end(), 0.0);
    center_ = 0.0;
    centered_head_ = phase_head_ = phase_count_ = 0u;
    profile_.fill(0.0);
    leak_ = 1.0;
    for (int c = 0; c < 3; ++c) {
      flux_[c] = {};
      recent_[c] = {};
      mean_[c] = variance_[c] = 0.0;
      peak_[c] = 1e-3;
      last_onset_[c] = -1.0;
    }
    position_ = in_hop_ = stage_ = 0u;
    active_ = have_previous_ = envelope_ready_ = false;
    hops_ = 0u;
    pool_sum_ = envelope_ = 0.0;
    pool_count_ = 0u;
    head_ = 0u;
    envelope_mean_ = 0.0;
    envelope_frames_ = 0u;
    time_ = hop_time_ = 0.0;
    locked_ = candidate_ = low_ = false;
    period_ = anchor_ = candidate_period_ = candidate_since_ = low_since_ = 0.0;
    beat_ = 0;
    epoch_ = bad_phase_ = 0u;
    confidence_ = best_bpm_ = est_bpm_ = 0.0;
    event_read_ = event_count_ = dropped_ = 0u;
    if (lanes_)
      lanes_->reset();
    if (a3_) {
      a3_->setRange(minimum_, maximum_);
      static_cast<void>(a3_->reset());
    }
    input_ = analysed_ = 0u;
    click_pending_ = click_sounded_ = click_consumed_ = false;
    click_age_ = click_length_;
    dirty_ = false;
    channels_ = 0u;
  }
  void process(float *audio, std::uint32_t channels, std::uint32_t frames,
               const ProcessInfo &info) noexcept override {
    if (!ready_ || !audio || channels == 0u)
      return;
    synchronize();
    if (channels_ != 0u && channels_ != channels)
      reset();
    channels_ = channels;
    const auto mask = static_cast<std::uint32_t>(ring_.size()) - 1u;
    for (std::uint32_t i = 0u; i < frames; ++i) {
      const double left = std::isfinite(audio[i]) ? audio[i] : 0.0;
      const double right = channels > 1u && std::isfinite(audio[frames + i])
                               ? audio[frames + i]
                               : (channels > 1u ? 0.0 : left);
      const auto mono = static_cast<float>((left + right) * .5);
      lanes_->push(mono);
      if (!a3_)
        ring_[position_] = mono;
      if (click_pending_ && input_ >= click_next_) {
        click_pending_ = false;
        click_consumed_ = true;
        click_last_epoch_ = click_epoch_;
        click_last_index_ = click_index_;
        // A re-anchored grid may re-arm the beat just clicked; never click twice within half a
        // beat.
        if (!click_sounded_ || input_ - click_last_ >= click_gap_) {
          click_sounded_ = true;
          click_last_ = input_;
          click_age_ = 0u;
          click_y1_ = 0.0;
          click_y2_ = click_start_;
        }
      }
      if (click_age_ < click_length_) {
        // Damped 2 kHz resonator with a linear attack; added after the analysis tap.
        const double y = click_a_ * click_y1_ - click_b_ * click_y2_;
        click_y2_ = click_y1_;
        click_y1_ = y;
        const double gain =
            click_age_ < click_attack_ ? static_cast<double>(click_age_) / click_attack_ : 1.0;
        ++click_age_;
        const auto value = static_cast<float>(gain * y);
        audio[i] += value;
        if (channels > 1u)
          audio[frames + i] += value;
      }
      ++input_;
      if (!a3_) {
        advance(i, info, mask);
        continue;
      }
      // The analysis stream (the lanes' samples) drives the kernel's analysis and A3.
      while (static_cast<std::uint32_t>(analysed_) != lanes_->analysisSamples()) {
        const float x = lanes_->sampleAt(static_cast<std::uint32_t>(analysed_++));
        ring_[position_] = x;
        a3_->sample(x);
        advance(i, info, mask);
      }
    }
    if (a3_) {
      a3_->quantum(frames);
      armClick();
    }
  }
  // One analysis sample: the previous hop's stages and, at the hop boundary, the next frame's
  // origin.
  void advance(std::uint32_t i, const ProcessInfo &info, std::uint32_t mask) noexcept {
    position_ = (position_ + 1u) & mask;
    ++in_hop_;
    // Spread the previous hop's analysis evenly over this hop.
    if (active_) {
      const auto target = in_hop_ * stage_count_ / hop_;
      while (stage_ < target)
        runStage(stage_++);
      active_ = stage_ < stage_count_;
    }
    if (in_hop_ == hop_) {
      origin_ = (position_ - size_) & mask;
      if (a3_)
        a3_->fe.pushHop(ring_.data(), mask, (position_ - hop_) & mask);
      hop_time_ = info.timeSeconds + static_cast<double>(i + 1u) / device_rate_;
      ++hops_;
      in_hop_ = stage_ = 0u;
      active_ = true;
    }
  }
  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!ready_ || !dirty_ || envelope_frames_ == 0u)
      return;
    std::array<std::uint8_t, kPayloadBytes> payload{};
    auto *p = payload.data();
    const double frame = static_cast<double>(env_hop_) / rate_;
    const double now = envelope_frames_ * frame;
    // Events newer than the analysed position wait for a later envelope frame.
    std::uint32_t due = 0u;
    while (due < event_count_ && events_[(event_read_ + due) % kEventCapacity].time <= now)
      ++due;
    const auto count = due < kMaxEvents ? due : kMaxEvents;
    binary_io::writeF32(p, static_cast<float>(rate_));
    binary_io::writeU32(p + 4u, generation_);
    binary_io::writeU32(p + 8u, env_hop_);
    binary_io::writeU32(p + 12u, envelope_frames_);
    binary_io::writeF32(p + 16u, static_cast<float>(time_));
    binary_io::writeF32(p + 20u, static_cast<float>(latency_));
    binary_io::writeU32(p + 24u, dropped_);
    binary_io::writeU32(p + 28u, count);
    const ClockState clock = clockState();
    binary_io::writeU32(p + 32u, clock.locked ? 1u : 0u);
    binary_io::writeU32(p + 36u, clock.epoch);
    binary_io::writeF32(p + 40u, static_cast<float>(clock.confidence));
    if (clock.locked) {
      double next = clock.anchor;
      auto index = clock.beat;
      while (next <= now) {
        next += clock.period;
        ++index;
      }
      const double position = next / frame;
      const double whole = std::floor(position);
      binary_io::writeF32(p + 44u, static_cast<float>(clock.period));
      binary_io::writeU32(p + 48u, static_cast<std::uint32_t>(whole));
      binary_io::writeF32(p + 52u, unitFraction(position - whole));
      binary_io::writeU32(p + 56u, static_cast<std::uint32_t>(index));
    }
    writeTempogram(p + 60u);
    for (std::uint32_t k = 0u; k < count; ++k) {
      const auto &event = events_[(event_read_ + k) % kEventCapacity];
      auto *slot = p + 832u + 32u * k;
      const double position = event.time / frame;
      const double whole = std::floor(position);
      binary_io::writeU32(slot, static_cast<std::uint32_t>(whole));
      binary_io::writeF32(slot + 4u, unitFraction(position - whole));
      binary_io::writeU32(slot + 8u, event.epoch);
      binary_io::writeU32(slot + 12u, static_cast<std::uint32_t>(event.beatIndex));
      binary_io::writeF32(slot + 16u, event.beatFraction);
      binary_io::writeF32(slot + 20u, event.period);
      binary_io::writeF32(slot + 24u, event.strength);
      slot[28] = event.band;
      slot[29] = event.flags;
    }
    if (!writer.write(kTelemetryType, kTelemetryVersion, payload.data(), kPayloadBytes))
      return;
    event_read_ = (event_read_ + count) % kEventCapacity;
    event_count_ -= count;
    dropped_ = 0u;
    dirty_ = due > count;
  }

private:
#if defined(__EMSCRIPTEN__)
public:
  // Called only by the module warm-up worker before sharing its compiled module with the worklet.
  // Exercise rare paths too: compiling them on first use can otherwise stall an audio quantum.
  void warmUp() {
    struct Part {
      double bpm, seconds; // bpm 0: silence; bpm < 0: white noise
    };
    static constexpr Part kProgram[] = {{120.0, 4.0}, {0.0, 1.0}, {150.0, 4.0},
                                        {-1.0, 1.5},  {0.0, 1.0}, {100.0, 4.0}};
    constexpr std::uint32_t kFrames = 128u;
    std::vector<float> block(2u * kFrames);
    std::uint32_t seed = 0x1234567u;
    std::uint64_t at = 0u;
    for (const auto &part : kProgram) {
      const auto length = static_cast<std::uint64_t>(std::llround(part.seconds * device_rate_));
      const double eighth = part.bpm > 0.0 ? 30.0 / part.bpm : 0.0;
      for (std::uint64_t done_frames = 0u; done_frames < length; done_frames += kFrames) {
        for (std::uint32_t i = 0u; i < kFrames; ++i) {
          seed = seed * 1664525u + 1013904223u;
          const double noise = seed / 2147483648.0 - 1.0, t = (done_frames + i) / device_rate_;
          double x = 0.0;
          if (part.bpm < 0.0) {
            x = .25 * noise;
          } else if (part.bpm > 0.0) {
            // A hat on every eighth and a kick on every beat.
            const double e = std::floor(t / eighth), u = t - e * eighth;
            x = .12 * noise * std::exp(-u / .012);
            if (std::fmod(e, 2.0) == 0.0)
              x += .7 * std::sin(2.0 * kPi * (50.0 * u + 1.8 * (1.0 - std::exp(-u / .03)))) *
                   std::exp(-u / .12);
          }
          block[i] = block[kFrames + i] = static_cast<float>(x);
        }
        process(block.data(), 2u, kFrames, ProcessInfo{static_cast<double>(at) / device_rate_});
        at += kFrames;
      }
    }
    // G2's event-interval median sorts; libc++'s sort calls one more helper only on a run that is
    // already partitioned, which the program need not produce: sort one presorted run.
    double run[64];
    for (int i = 0; i < 64; ++i)
      run[i] = i * device_rate_;
    volatile double sink = rhythm_a3::g2np::median(run, 64);
    static_cast<void>(sink);
    // The telemetry path: a ring shorter than two frames, so the second frame wraps and discards
    // the first.
    std::vector<std::uint8_t> storage(2048u);
    TelemetryRing ring;
    ring.adopt(storage.data(), static_cast<std::uint32_t>(storage.size()));
    std::uint32_t sequence = 0u;
    TelemetryWriter writer(ring, 1u, sequence);
    for (int i = 0; i < 2; ++i) {
      dirty_ = true;
      writeTelemetry(writer);
    }
    // The telemetry generation stays the one prepare() produced.
    const auto generation = generation_;
    reset();
    generation_ = generation;
  }

private:
#endif
  void synchronize() noexcept {
    if (!sync_ && !paramsDirty())
      return;
    sync_ = false;
    // The click only adds to the output: switching it never resets the analysis.
    click_on_ = params_.metronomeClick > .5F;
    click_pending_ = click_pending_ && click_on_;
    const auto bounded = [](float value, double lo, double hi, double fallback) {
      return std::isfinite(value) ? clamp(value, lo, hi) : fallback;
    };
    double minimum = bounded(params_.minimumBpm, 40, 192, 40);
    double maximum = bounded(params_.maximumBpm, 50, 240, 240);
    if (maximum < minimum * kMinimumSpan)
      maximum = minimum * kMinimumSpan;
    if (minimum == minimum_ && maximum == maximum_)
      return;
    minimum_ = minimum;
    maximum_ = maximum;
    log_bpm_ = std::log(minimum_);
    log_step_ = (std::log(maximum_) - log_bpm_) / (kCandidates - 1u);
    for (std::uint32_t i = 0u; i < kCandidates; ++i) {
      const double bpm = std::exp(log_bpm_ + log_step_ * i);
      const double octave = std::log2(bpm / 120.0);
      candidate_lag_[i] = 60.0 * env_rate_ / bpm;
      prior_[i] = std::exp(-.5 * octave * octave);
      // The comb is normalised by the weight of the harmonics that fit inside the ACF.
      double weight = 0.0;
      for (int m = 0; m < 4; ++m)
        weight += (m + 1) * candidate_lag_[i] <= lmax_ ? kHarmonicWeights[m] : 0.0;
      inverse_weight_[i] = 1.0 / weight;
    }
    search_ = static_cast<std::uint32_t>(std::ceil(std::log(1.0 + kMetricalSearch) / log_step_));
    reset();
  }
  void runStage(std::uint32_t stage) noexcept {
    if (a3_) {
      if (stage == 0u) {
        analyseFrame();
      } else {
        // H3: base channels and the TCN for the tick closed by this hop's frame, if any.
        a3_->fe.runTick();
        if (envelope_ready_) {
          envelope_ready_ = false;
          tick();
        }
      }
      return;
    }
    auto *input = buffers_[0].get();
    const auto mask = static_cast<std::uint32_t>(ring_.size()) - 1u;
    if (stage < capture_stages_) {
      const auto begin = stage * kCaptureChunk;
      const auto end = begin + kCaptureChunk < size_ ? begin + kCaptureChunk : size_;
      for (auto i = begin; i < end; ++i)
        input[i] = ring_[(origin_ + i) & mask] * window_[i];
    } else if (stage == capture_stages_) {
      static_cast<void>(transform_->forward.begin(input, buffers_[1].get(), buffers_[2].get()));
    } else if (stage + 2u < stage_count_) {
      static_cast<void>(transform_->forward.step());
    } else if (stage + 2u == stage_count_) {
      analyseFrame();
    } else if (envelope_ready_) {
      envelope_ready_ = false;
      tick();
    }
  }
  // Onset front end: per-band spectral flux, peak picking with one-frame look-ahead, envelope
  // pooling.
  void analyseFrame() noexcept {
    const auto *spectrum = buffers_[1].get();
    // H1: at A3 rates the lanes' frame goes to A3's front end, which returns log1p(norm |X_k|) at
    // index k - 1.
    const double *y64 = a3_ ? a3_->fe.pushFrame(lanes_->magnitude()) : nullptr;
    const double end = static_cast<double>(hops_) * hop_ / rate_;
    double novelty = 0.0;
    for (int c = 0; c < 3; ++c) {
      const auto count = bin_end_[c] - bin_begin_[c];
      auto *previous = previous_.data() + offset_[c];
      double flux = 0.0;
      double left = count ? previous[0] : 0.0;
      for (std::uint32_t i = 0u; i < count; ++i) {
        const auto bin = bin_begin_[c] + i;
        double y;
        if (y64 != nullptr) {
          y = y64[bin - 1u];
        } else {
          const double re = spectrum[2u * bin], im = spectrum[2u * bin + 1u];
          y = std::log1p(norm_ * std::sqrt(re * re + im * im));
        }
        const double current = previous[i];
        const double right = i + 1u < count ? previous[i + 1u] : current;
        double reference = current > left ? current : left;
        reference = right > reference ? right : reference;
        const double difference = y - reference;
        if (have_previous_ && difference > 0.0)
          flux += difference;
        left = current;
        previous[i] = y;
      }
      const double f = count ? flux / count : 0.0;
      auto &h = flux_[c];
      h[0] = h[1];
      h[1] = h[2];
      h[2] = f;
      auto &ring = recent_[c];
      for (std::uint32_t i = 0u; i + 1u < ring_length_; ++i)
        ring[i] = ring[i + 1u];
      ring[ring_length_ - 1u] = f;
      const double candidate = h[1];
      double threshold = mean_[c] + kThresholdSd * std::sqrt(variance_[c]);
      threshold = threshold > kThresholdAbs ? threshold : kThresholdAbs;
      const double relative = kThresholdPeak * peak_[c];
      threshold = threshold > relative ? threshold : relative;
      bool peak = candidate > h[0] && candidate >= h[2] && candidate > threshold;
      for (std::uint32_t i = 0u; peak && i + 1u < ring_length_; ++i)
        peak = candidate >= ring[i];
      if (peak) {
        const double curvature = h[0] - 2.0 * candidate + h[2];
        const double delta = curvature < 0.0 ? .5 * (h[0] - h[2]) / curvature : 0.0;
        const double onset = end - hop_ / rate_ + delta * hop_ / rate_ - bias_[c];
        if (last_onset_[c] < 0.0 || onset - last_onset_[c] > kRefractory) {
          last_onset_[c] = onset;
          if (onset >= 0.0)
            addEvent(onset, candidate / peak_[c], static_cast<std::uint8_t>(c));
        }
      }
      const double dm = f - mean_[c];
      mean_[c] += a_mean_ * dm;
      variance_[c] = (1.0 - a_mean_) * (variance_[c] + a_mean_ * dm * dm);
      const double decayed = peak_[c] * d_peak_;
      peak_[c] = decayed > f ? decayed : f;
      const double floor = peak_[c] > 10.0 * kThresholdAbs ? peak_[c] : 10.0 * kThresholdAbs;
      const double v = f - mean_[c];
      novelty += v > 0.0 ? v / floor : 0.0;
    }
    have_previous_ = true;
    pool_sum_ += novelty;
    if (++pool_count_ == pool_) {
      envelope_ = pool_sum_ / pool_;
      pool_sum_ = 0.0;
      pool_count_ = 0u;
      envelope_ready_ = true;
      envelope_time_ = hop_time_;
    }
  }
  // The picker's onsets feed the clock (the onset-count gate of the tempo path). The lanes' events
  // carry the telemetry at a rate the lanes do not cover, the picker's events carry it.
  void addEvent(double time, double strength, std::uint8_t band) noexcept {
    phase_time_[phase_head_] = time;
    phase_head_ = (phase_head_ + 1u) % kPhaseEvents;
    phase_count_ = phase_count_ < kPhaseEvents ? phase_count_ + 1u : kPhaseEvents;
    dirty_ = true;
    if (!lanes_->active())
      pushEvent(time, static_cast<float>(strength), band);
  }
  static void laneEvent(void *self, double time, float probability, std::uint32_t band) noexcept {
    if (time >= 0.0)
      static_cast<RhythmAnalyzerKernel *>(self)->pushEvent(time, probability,
                                                           static_cast<std::uint8_t>(band));
  }
  // Onset (picker or lane event): deviation against the current beat prediction. Onsets do not move
  // the beat; picker onset times also feed the onset-count gate of the confidence (kMinOnsets).
  void pushEvent(double time, float strength, std::uint8_t band) noexcept {
    Event event{time, strength, 0.0F, 0.0F, 0, 0u, band, 1u};
    const ClockState clock = clockState();
    if (clock.locked) {
      const double n = std::floor((time - clock.anchor) / clock.period);
      const double base = clock.anchor + n * clock.period;
      const double fraction = (time - base) / clock.period;
      event.beatIndex = static_cast<std::int32_t>(clock.beat + static_cast<std::int64_t>(n));
      event.beatFraction = unitFraction(fraction);
      event.period = static_cast<float>(clock.period);
      event.epoch = clock.epoch;
      event.flags = 0u;
    }
    dirty_ = true;
    if (event_count_ == kEventCapacity) {
      ++dropped_;
      return;
    }
    events_[(event_read_ + event_count_) % kEventCapacity] = event;
    ++event_count_;
  }
  // The beat clock shown and clicked: A3's decoder at A3 rates, the production tracker otherwise.
  struct ClockState {
    bool locked;
    std::uint32_t epoch;
    double confidence, period, anchor;
    std::int64_t beat;
  };
  ClockState clockState() const noexcept {
    if (a3_) {
      const auto v = a3_->view();
      return {v.locked && v.hasNext,
              static_cast<std::uint32_t>(v.epoch),
              v.post,
              v.period,
              v.next,
              v.index};
    }
    // The fallback tracker's confidence, mapped from its hold threshold (0) to its lock threshold
    // (1).
    const double c = (confidence_ - kConfidenceOff) / (kConfidenceOn - kConfidenceOff);
    return {locked_, epoch_, c < 0.0 ? 0.0 : (c > 1.0 ? 1.0 : c), period_, anchor_, beat_};
  }
  // Envelope history, centered leaky ACF and the envelope mean, then the beat tracker.
  void tick() noexcept {
    const double z = envelope_;
    const double frame = static_cast<double>(env_hop_) / rate_;
    if (locked_) {
      // Deposit this tick's novelty at its phase on the current beat grid.
      for (auto &value : profile_)
        value *= leak_;
      deposit(phaseOf((envelope_frames_ + 1u) * frame), z);
    }
    head_ = head_ == 0u ? history_length_ - 1u : head_ - 1u;
    history_[head_] = history_[head_ + history_length_] = z;
    const double y = z - center_;
    center_ += a_center_ * (z - center_);
    const std::uint32_t length = lmax_ + 1u;
    centered_head_ = centered_head_ == 0u ? length - 1u : centered_head_ - 1u;
    centered_[centered_head_] = centered_[centered_head_ + length] = y;
    const double *past = centered_.data() + centered_head_;
    for (std::uint32_t l = 0u; l <= lmax_; ++l)
      acf_[l] = lambda_ * acf_[l] + y * past[l];
    envelope_mean_ += a_env_ * (z - envelope_mean_);
    ++envelope_frames_;
    time_ = envelope_time_;
    dirty_ = true;
    const double now = envelope_frames_ * frame;
    const double inverse = 1.0 / (acf_[0] + 1e-12);
    for (std::uint32_t l = 0u; l <= lmax_; ++l)
      normalized_[l] = acf_[l] * inverse;
    // Harmonic comb over the candidate grid, weighted by the 120 BPM log-normal prior.
    std::uint32_t best = 0u;
    for (std::uint32_t i = 0u; i < kCandidates; ++i) {
      double s = 0.0;
      for (int m = 0; m < 4; ++m) {
        const double lag = (m + 1) * candidate_lag_[i];
        if (lag <= lmax_)
          s += kHarmonicWeights[m] * acfAt(lag);
      }
      s *= inverse_weight_[i];
      s = (s > 0.0 ? s : 0.0) * prior_[i];
      comb_[i] = s;
      if (s > comb_[best])
        best = i;
    }
    const double best_period = refine(best);
    best_bpm_ = 60.0 / best_period;
    const double value = comb_[best] / (prior_[best] + 1e-12);
    confidence_ = envelope_mean_ > kMinActivity && recentOnsets(now) >= kMinOnsets ? value : 0.0;
    // Metrical level: keep the strongest of the winner and its non-octave relatives.
    double estimate = best_period, salience = comb_[best];
    if (confidence_ >= kConfidenceOff) {
      salience *= std::pow(contrast(best_period), kMetricalGamma);
      const auto s = static_cast<std::int64_t>(search_);
      for (const double ratio : kMetricalRatios) {
        const auto k0 = static_cast<std::int64_t>(
            std::nearbyint((std::log(60.0 / (best_period * ratio)) - log_bpm_) / log_step_));
        if (k0 - s < 0 || k0 + s > static_cast<std::int64_t>(kCandidates) - 1)
          continue;
        std::int64_t j = 0;
        for (std::int64_t q = 1; q <= 2 * s; ++q)
          if (comb_[k0 - s + q] > comb_[k0 - s + j])
            j = q;
        const auto k = static_cast<std::uint32_t>(k0 - s + j);
        if (comb_[k] <= 0.0 || j == 0 || j == 2 * s)
          continue; // no local comb peak near this relative
        const double period = refine(k);
        const double score = comb_[k] * std::pow(contrast(period), kMetricalGamma);
        if (score > salience) {
          estimate = period;
          salience = score;
        }
      }
    }
    est_bpm_ = 60.0 / estimate;
    const bool on = confidence_ >= kConfidenceOn;
    const bool hold = confidence_ >= kConfidenceOff;
    if (locked_) {
      if (hold)
        low_ = false;
      else if (!low_) {
        low_ = true;
        low_since_ = now;
      } else if (now - low_since_ > kUnlockSeconds) {
        locked_ = candidate_ = low_ = false;
        period_ = anchor_ = 0.0;
      }
    }
    if (on) {
      const auto follow = [&] {
        if (!candidate_ || std::fabs(std::log(estimate / candidate_period_)) > .04) {
          candidate_ = true;
          candidate_period_ = estimate;
          candidate_since_ = now;
        } else {
          double hold = kHoldSeconds;
          if (locked_ && salienceAt(estimate) > kFastRatio * salienceAt(period_))
            hold = kFastSeconds; // the old tempo has lost its comb support
          if (now - candidate_since_ > hold)
            lock(estimate, now);
        }
      };
      if (!locked_)
        follow();
      else if (std::fabs(std::log(estimate / period_)) > .06 &&
               salience > kSwitchRatio * salienceAt(period_))
        follow();
      else
        candidate_ = false;
    } else
      candidate_ = false; // a candidate must hold kConfidenceOn continuously for kHoldSeconds
    if (locked_)
      while (anchor_ + period_ <= now) {
        anchor_ += period_;
        ++beat_;
        checkPhase();
      }
    armClick();
  }
  // Formal output beats carry their identity before later decoder steps can change the epoch.
  static void beatEvent(void *context, double time, std::int64_t epoch, std::int64_t index,
                        double period) noexcept {
    static_cast<RhythmAnalyzerKernel *>(context)->queueClick(time, epoch, index, period, true);
  }
  void queueClick(double time, std::int64_t epoch, std::int64_t index, double period,
                  bool confirmed = false) noexcept {
    if (!click_on_ || (click_consumed_ && epoch == click_last_epoch_ && index <= click_last_index_))
      return;
    // A due beat must play before a later prediction replaces it. Late events start next sample.
    if (click_pending_ && click_next_ <= input_) {
      if (epoch == click_epoch_ && index == click_index_)
        click_confirmed_ = click_confirmed_ || confirmed;
      return;
    }
    const auto sample = static_cast<std::uint64_t>(std::llround(time * device_rate_));
    click_next_ = sample < input_ ? input_ : sample;
    click_gap_ = static_cast<std::uint64_t>(.5 * period * device_rate_);
    click_epoch_ = epoch;
    click_index_ = index;
    click_confirmed_ = confirmed;
    click_pending_ = true;
  }
  // Predict without rounding a late beat into the next period; the formal event and prediction
  // share an identity, so only one can sound. Searching candidates never reach the beat sink.
  void armClick() noexcept {
    const ClockState clock = clockState();
    if (!click_on_ || !clock.locked) {
      click_pending_ = click_pending_ && click_on_ && click_confirmed_;
      return;
    }
    queueClick(clock.anchor, clock.epoch, clock.beat, clock.period);
    if (!a3_ && click_consumed_ && clock.epoch == click_last_epoch_ &&
        clock.beat <= click_last_index_)
      queueClick(clock.anchor + clock.period, clock.epoch, clock.beat + 1, clock.period);
  }
  // Parabolic refinement of comb peak k, as a beat period in seconds.
  double refine(std::uint32_t k) const noexcept {
    double d = 0.0;
    if (k > 0u && k + 1u < kCandidates) {
      const double den = comb_[k - 1u] - 2.0 * comb_[k] + comb_[k + 1u];
      d = den < 0.0 ? .5 * (comb_[k - 1u] - comb_[k + 1u]) / den : 0.0;
    }
    return 60.0 / std::exp(log_bpm_ + log_step_ * (k + d));
  }
  // Salience of a period: interpolated comb times the metrical contrast.
  double salienceAt(double period) const noexcept {
    const double position =
        clamp((std::log(60.0 / period) - log_bpm_) / log_step_, 0.0, kCandidates - 1.0);
    const auto index = static_cast<std::uint32_t>(position);
    double s = index + 1u < kCandidates
                   ? comb_[index] + (position - index) * (comb_[index + 1u] - comb_[index])
                   : comb_[index];
    if (s > 0.0)
      s *= std::pow(contrast(period), kMetricalGamma);
    return s;
  }
  // 1 + Fourier tempogram magnitude at 1/period over the envelope window, relative to its sum.
  double contrast(double period) const noexcept {
    const double *h = history_.data() + head_;
    const double lag = period * env_rate_;
    double re = 0.0, im = 0.0, sum = 0.0;
    for (std::uint32_t n = 0u; n < history_length_; ++n) {
      const double angle = -2.0 * kPi * n / lag;
      re += h[n] * std::cos(angle);
      im += h[n] * std::sin(angle);
      sum += h[n];
    }
    return 1.0 + std::sqrt(re * re + im * im) / (sum + 1e-9);
  }
  // np.interp on the normalised ACF (callers keep lag <= lmax).
  double acfAt(double lag) const noexcept {
    const auto index = static_cast<std::uint32_t>(lag);
    if (index >= lmax_)
      return normalized_[lmax_];
    return normalized_[index] + (lag - index) * (normalized_[index + 1u] - normalized_[index]);
  }
  // Number of events newer than now - kOnsetWindow, counted back from the newest one.
  std::uint32_t recentOnsets(double now) const noexcept {
    std::uint32_t n = 0u;
    for (; n < phase_count_; ++n) {
      const auto slot = (phase_head_ + kPhaseEvents - 1u - n) % kPhaseEvents;
      if (!(phase_time_[slot] > now - kOnsetWindow))
        break;
    }
    return n;
  }
  // Phase of `time` on the current beat grid, in [0, 1) beats.
  double phaseOf(double time) const noexcept {
    double v = std::fmod((time - kEnvDelay - anchor_) / period_, 1.0);
    if (v != 0.0 && v < 0.0)
      v += 1.0;
    return v;
  }
  // Linear split of z into the two profile bins around `phase`.
  void deposit(double phase, double z) noexcept {
    const double x = phase * kProfileBins;
    const auto whole = static_cast<std::int64_t>(x);
    const auto i = static_cast<std::uint32_t>(whole % kProfileBins);
    const double f = x - static_cast<double>(whole);
    profile_[i] += z * (1.0 - f);
    profile_[(i + 1u) % kProfileBins] += z * f;
  }
  // Shift the profile so that evidence deposited at phase q now sits at q - dphase (anchor moved
  // by +dphase beats).
  void roll(double dphase) noexcept {
    const std::array<double, kProfileBins> old = profile_;
    const double shift = dphase * kProfileBins;
    const auto n = static_cast<std::int64_t>(kProfileBins);
    for (std::uint32_t j = 0u; j < kProfileBins; ++j) {
      const double x = static_cast<double>(j) + shift;
      const double whole = std::floor(x);
      const double f = x - whole;
      const auto i = static_cast<std::int64_t>(whole);
      const auto a = static_cast<std::uint32_t>(((i % n) + n) % n);
      const auto b = static_cast<std::uint32_t>((((i + 1) % n) + n) % n);
      profile_[j] = (1.0 - f) * old[a] + f * old[b];
    }
  }
  void setLeak(double period) noexcept {
    leak_ = std::exp(-1.0 / (kProfileBeats * period * env_rate_));
  }
  // Fold the envelope history at `period` (phase relative to `now`) with the profile's own decay.
  void seed(double period, double now) noexcept {
    const double *h = history_.data() + head_;
    setLeak(period);
    profile_.fill(0.0);
    anchor_ = now;
    period_ = period;
    for (int pass = 0; pass < 2; ++pass) {
      double weight = 1.0;
      for (std::uint32_t i = 0u; i < seed_length_; ++i) {
        double ph = std::fmod((-static_cast<double>(i) / env_rate_ - kEnvDelay) / period, 1.0);
        if (ph != 0.0 && ph < 0.0)
          ph += 1.0;
        const double x = ph * kProfileBins;
        const double whole = std::floor(x);
        const double f = x - whole;
        const auto bin =
            static_cast<std::uint32_t>(static_cast<std::int64_t>(whole) % kProfileBins);
        const double hw = h[i] * weight;
        if (pass == 0)
          profile_[bin] += hw * (1.0 - f);
        else
          profile_[(bin + 1u) % kProfileBins] += hw * f;
        weight *= leak_;
      }
    }
  }
  // Smoothed profile peak with parabolic refinement: phase error in beats wrapped to [-.5, .5),
  // the smoothed value at the peak and at the anchor bin.
  struct Peak {
    double error, value, current;
  };
  Peak peak() const noexcept {
    std::array<double, kProfileBins> s{};
    std::uint32_t k = 0u;
    for (std::uint32_t j = 0u; j < kProfileBins; ++j) {
      const double left = profile_[(j + kProfileBins - 1u) % kProfileBins];
      const double right = profile_[(j + 1u) % kProfileBins];
      s[j] = .5 * profile_[j] + .25 * (left + right);
      if (s[j] > s[k])
        k = j;
    }
    const double a = s[(k + kProfileBins - 1u) % kProfileBins], b = s[k],
                 c = s[(k + 1u) % kProfileBins];
    const double den = a - 2.0 * b + c;
    const double d = den < 0.0 ? .5 * (a - c) / den : 0.0;
    double e = (static_cast<double>(k) + d) / kProfileBins;
    e = e >= .5 ? e - 1.0 : e;
    return {e, s[k], s[0]};
  }
  void lock(double period, double now) noexcept {
    seed(period, now);
    const auto p = peak();
    anchor_ = now + p.error * period;
    roll(p.error);
    while (anchor_ + period_ <= now)
      anchor_ += period_;
    locked_ = true;
    beat_ = 0;
    ++epoch_;
    candidate_ = false;
    bad_phase_ = 0u;
  }
  // Per beat: the period follows the comb estimate (kPull); a small profile error corrects anchor
  // and period; a clearly better phase kPhaseCount beats in a row re-phases without touching the
  // tempo.
  void checkPhase() noexcept {
    if (est_bpm_ > 0.0) {
      const double estimate = 60.0 / est_bpm_;
      if (std::fabs(std::log(estimate / period_)) < kPullLog) {
        period_ += kPull * (estimate - period_);
        setLeak(period_);
      }
    }
    const auto p = peak();
    const double e = p.error;
    if ((e < 0.0 ? -e : e) <= kPhaseDeadZone) {
      bad_phase_ = 0u;
      const double d = kAlpha * e;
      anchor_ += d * period_;
      period_ += kBeta * e * period_;
      setLeak(period_);
      roll(d);
    } else if (p.value > kPhaseRatio * p.current) {
      if (bad_phase_ > 0u && std::fabs(e - bad_error_) > kConsist)
        bad_phase_ = 0u; // the competing peak moved: not the same phase jump
      bad_error_ = e;
      if (++bad_phase_ >= kPhaseCount) {
        anchor_ += e * period_;
        roll(e);
        beat_ = 0;
        ++epoch_;
        bad_phase_ = 0u;
      }
    } else
      bad_phase_ = 0u;
  }
  // The strongest tempo (BPM) and the tempogram column after it: at A3 rates A3's tempo map and
  // its peak, otherwise the fallback tracker's comb best and onset ACF. Silence (the same activity
  // gate as the confidence) writes an all-zero column.
  void writeTempogram(std::uint8_t *output) const noexcept {
    std::array<float, kTempogramBins> column{};
    if (a3_) {
      const double strongest = a3_->decoder().tempoMap(column.data());
      const bool active = envelope_mean_ > kMinActivity;
      binary_io::writeF32(output, static_cast<float>(strongest));
      for (std::uint32_t i = 0u; i < kTempogramBins; ++i)
        binary_io::writeF32(output + 4u + 4u * i, active ? column[i] : 0.0f);
      return;
    }
    binary_io::writeF32(output, static_cast<float>(best_bpm_));
    double peak = 0.0;
    const double inverse = 1.0 / (acf_[0] + 1e-12);
    for (std::uint32_t i = 0u; i < kTempogramBins; ++i) {
      const double lag = tempogram_lag_[i];
      const auto index = static_cast<std::uint32_t>(lag);
      const double value =
          index >= lmax_
              ? acf_[lmax_] * inverse
              : (acf_[index] + (lag - index) * (acf_[index + 1u] - acf_[index])) * inverse;
      column[i] = static_cast<float>(value > 0.0 ? value : 0.0);
      peak = column[i] > peak ? column[i] : peak;
    }
    const double scale = envelope_mean_ > kMinActivity
                             ? 1.0 / (peak > kTempogramFloor ? peak : kTempogramFloor)
                             : 0.0;
    for (std::uint32_t i = 0u; i < kTempogramBins; ++i)
      binary_io::writeF32(output + 4u + 4u * i, static_cast<float>(column[i] * scale));
  }
  std::array<Buffer, 3> buffers_;
  std::unique_ptr<Transform> transform_;
  std::unique_ptr<rhythm_d::Detector> lanes_;
  std::unique_ptr<rhythm_a3::A3Clock> a3_;
  std::vector<float> window_, ring_;
  std::vector<double> previous_, history_, centered_, acf_, normalized_, candidate_lag_,
      inverse_weight_, prior_, comb_, tempogram_lag_, phase_time_;
  std::array<double, kProfileBins> profile_{};
  std::vector<Event> events_;
  std::array<std::array<double, 3>, 3> flux_{};
  std::array<std::array<double, kMaxRing>, 3> recent_{};
  std::array<double, 3> mean_{}, variance_{}, peak_{}, last_onset_{}, bias_{};
  std::array<std::uint32_t, 3> bin_begin_{}, bin_end_{}, offset_{};
  double rate_ = 48000, device_rate_ = 48000, frame_rate_ = 375, env_rate_ = 93.75, norm_ = 1,
         latency_ = 0;
  double a_mean_ = 0, d_peak_ = 0, a_env_ = 0, a_center_ = 0, center_ = 0, lambda_ = 0,
         minimum_ = 0, maximum_ = 0, log_bpm_ = 0, log_step_ = 0;
  double pool_sum_ = 0, envelope_ = 0, envelope_mean_ = 0, time_ = 0, hop_time_ = 0,
         envelope_time_ = 0;
  double period_ = 0, anchor_ = 0, candidate_period_ = 0, candidate_since_ = 0, low_since_ = 0,
         confidence_ = 0, best_bpm_ = 0, est_bpm_ = 0, leak_ = 1, bad_error_ = 0;
  double click_a_ = 0, click_b_ = 0, click_start_ = 0, click_y1_ = 0, click_y2_ = 0;
  std::uint64_t click_next_ = 0, click_last_ = 0, click_gap_ = 0;
  std::int64_t click_epoch_ = 0, click_index_ = 0, click_last_epoch_ = 0, click_last_index_ = 0;
  std::uint32_t click_attack_ = 1, click_length_ = 0, click_age_ = 0;
  std::int64_t beat_ = 0;
  std::uint64_t hops_ = 0, input_ = 0, analysed_ = 0;
  std::uint32_t hop_ = 128, size_ = 1024, pool_ = 1, env_hop_ = 128, ring_length_ = 3, lmax_ = 0,
                history_length_ = 2;
  std::uint32_t capture_stages_ = 0, stage_count_ = 1, stage_ = 0, in_hop_ = 0, position_ = 0,
                origin_ = 0, pool_count_ = 0, head_ = 0, envelope_frames_ = 0, centered_head_ = 0,
                phase_head_ = 0, phase_count_ = 0, search_ = 1, seed_length_ = 0;
  std::uint32_t generation_ = 0, channels_ = 0, epoch_ = 0, bad_phase_ = 0, event_read_ = 0,
                event_count_ = 0, dropped_ = 0;
  bool ready_ = false, sync_ = true, active_ = false, have_previous_ = false,
       envelope_ready_ = false, locked_ = false, candidate_ = false, low_ = false, dirty_ = false,
       click_on_ = false, click_pending_ = false, click_sounded_ = false, click_consumed_ = false,
       click_confirmed_ = false;
};
static_assert(sizeof(RhythmAnalyzerKernel) <= 8192u);
} // namespace effetune::plugins::analyzer
EFFETUNE_REGISTER_KERNEL(RhythmAnalyzerPlugin, effetune::plugins::analyzer::RhythmAnalyzerKernel)

#if defined(__EMSCRIPTEN__)
// Host preparation hook, deliberately separate from real-time instance creation.
extern "C" int et_rhythm_analyzer_warm_up(float sampleRate) {
  auto kernel = std::make_unique<effetune::plugins::analyzer::RhythmAnalyzerKernel>();
  kernel->prepare({sampleRate, 2u, 128u});
  if (!kernel->preparedSuccessfully())
    return 1;
  kernel->warmUp();
  return 0;
}
#endif

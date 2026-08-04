#include "effetune/kernel.h"
#include "GSMFullRateSimulatorPluginParams.h"
#include "codec.h"
#include "effetune/dsp/halfband.h"
#include "effetune/dsp/rational_resampler.h"
#include "effetune/dsp/xorshift_rng.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

constexpr std::uint32_t kCodecRate = 8000u;
constexpr std::size_t kMaximumRateFactor = 8u;
constexpr std::size_t kWetFifoCapacity = 16384u;
constexpr std::uint32_t kWorkIntervalSamples = 128u;
constexpr std::uint32_t kCodecWorkStages = 6u;
constexpr std::uint32_t kOutputWorkStages = 8u;
constexpr std::size_t kOutputSamplesPerWorkStage = gsmfr::kFrameSamples / kOutputWorkStages;
constexpr double kResamplerCutoffHz = 3800.0;

// Radio link quality. kCarrierToInterferenceClean is both the parameter maximum and the value at
// which every impairment stage is short-circuited, so the default consumes no random numbers and
// reproduces the plain transcoder bit for bit.
constexpr float kCarrierToInterferenceWorst = 4.0F;
constexpr float kCarrierToInterferenceClean = 30.0F;
// Mean length of a fading burst, in 20 ms speech frames.
constexpr double kMeanErasureBurstFrames = 3.0;
constexpr double kPeakFrameErasureRate = 0.9;
// Residual error rate on the unprotected (class 2) bits at the worst modelled C/I.
constexpr double kPeakClass2BitErrorRate = 0.08;
// Number of low pulse bits treated as class 2 per RPE pulse code.
constexpr unsigned kClass2PulseBits = 2u;

[[nodiscard]] double frameErasureRate(double severity) noexcept {
  const double squared = severity * severity;
  return kPeakFrameErasureRate * squared * squared;
}

[[nodiscard]] double class2BitErrorRate(double severity) noexcept {
  return kPeakClass2BitErrorRate * severity * severity * std::sqrt(severity);
}

[[nodiscard]] float sanitizeFinite(float sample) noexcept {
  return std::isfinite(sample) ? sample : 0.0F;
}

[[nodiscard]] gsmfr::Word toGsmInput(float sample) noexcept {
  double scaled = static_cast<double>(sanitizeFinite(sample)) * 32768.0;
  if (scaled < -32768.0) {
    scaled = -32768.0;
  } else if (scaled > 32767.0) {
    scaled = 32767.0;
  }
  const double rounded = scaled < 0.0 ? std::ceil(scaled - 0.5) : std::floor(scaled + 0.5);
  return static_cast<gsmfr::Word>(rounded);
}

[[nodiscard]] double blend(double dry, double wet, double mix) noexcept {
  if (mix <= 0.0) {
    return dry;
  }
  if (mix >= 1.0) {
    return wet;
  }
  return dry + (wet - dry) * mix;
}

} // namespace

class GSMFullRateSimulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::GSMFullRateSimulatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<std::uint32_t>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    configureRate();
    transcoders_.reset();
    if (supported_) {
      const std::uint32_t evenly_spaced_interval =
          sample_rate_ / 50u / (kCodecWorkStages + kOutputWorkStages);
      codec_work_interval_samples_ = evenly_spaced_interval < kWorkIntervalSamples
                                         ? evenly_spaced_interval
                                         : kWorkIntervalSamples;
      transcoders_ = std::make_unique<std::array<gsmfr::Transcoder, 3u>>();
      downsampler_.prepare(base_rate_, kCodecRate, kResamplerCutoffHz);
      upsampler_.prepare(kCodecRate, base_rate_, kResamplerCutoffHz);
    }
    dry_delay_.assign(2u * (static_cast<std::size_t>(latency_samples_) + 1u), 0.0F);
    wet_fifo_.assign(kWetFifoCapacity, 0.0F);
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override {
    return supported_ && transcoders_ != nullptr;
  }

  void reset() noexcept override {
    if (transcoders_ != nullptr) {
      for (gsmfr::Transcoder &transcoder : *transcoders_) {
        transcoder.reset();
      }
    }
    downsampler_.reset();
    upsampler_.reset();
    for (auto &stage : input_halfbands_) {
      stage.reset();
    }
    for (auto &stage : output_halfbands_) {
      stage.reset();
    }
    input_frame_.fill(0);
    codec_work_frame_.fill(0);
    codec_work_logical_frame_ = {};
    for (float &sample : dry_delay_) {
      sample = 0.0F;
    }
    for (float &sample : wet_fifo_) {
      sample = 0.0F;
    }
    input_count_ = 0u;
    codec_work_phase_ = 0u;
    codec_work_countdown_ = 0u;
    codec_work_transcodes_ = 1u;
    codec_work_pending_ = false;
    input_frame_transcodes_ = 1u;
    dry_position_ = 0u;
    wet_read_ = 0u;
    wet_write_ = 0u;
    wet_count_ = 0u;
    wet_alignment_.fill(0.0F);
    wet_alignment_position_ = 0u;
    active_transcodes_ = 1u;
    output_alignment_transcodes_ = 1u;
    transcodes_initialized_ = false;
    output_alignment_initialized_ = false;
    smoothing_initialized_ = false;
    gain_smoothed_ = 1.0;
    mix_smoothed_ = 1.0;
    channel_burst_active_ = false;
    codec_work_bad_frame_ = false;
    random_.seed(selected_seed_low_, selected_seed_high_);
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    random_.seed(seed_low, seed_high);
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return supported_ ? latency_samples_ : 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!supported_ || transcoders_ == nullptr || audio == nullptr || channel_count == 0u ||
        channel_count > max_channels_ || frame_count == 0u || frame_count > max_frames_) {
      return;
    }

    const std::uint32_t processed_channels = channel_count == 1u ? 1u : 2u;
    float *left = audio;
    float *right = processed_channels == 2u ? audio + frame_count : audio;
    const double output_target = std::pow(
        10.0, static_cast<double>(sanitizeControl(params_.outputGain, -24.0F, 12.0F, 0.0F)) / 20.0);
    const double mix_target =
        static_cast<double>(sanitizeControl(params_.mix, 0.0F, 100.0F, 100.0F)) * 0.01;
    const double smoothing = 1.0 - std::exp(-1.0 / (static_cast<double>(sample_rate_) * 0.02));
    if (!smoothing_initialized_) {
      gain_smoothed_ = output_target;
      mix_smoothed_ = mix_target;
      smoothing_initialized_ = true;
    }

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      gain_smoothed_ += smoothing * (output_target - gain_smoothed_);
      mix_smoothed_ += smoothing * (mix_target - mix_smoothed_);
      const float dry_left = sanitizeFinite(left[frame]);
      const float dry_right = processed_channels == 2u ? sanitizeFinite(right[frame]) : dry_left;
      const float codec_input =
          processed_channels == 2u ? 0.5F * dry_left + 0.5F * dry_right : dry_left;
      processHostSample(codec_input);
      advanceCodecWork();
      const float wet = alignWet(popWet());
      const float delayed_left = delayDry(0u, dry_left);
      const float output_left = static_cast<float>(
          blend(delayed_left, static_cast<double>(wet) * gain_smoothed_, mix_smoothed_));
      left[frame] = std::isfinite(output_left) ? output_left : 0.0F;
      if (processed_channels == 2u) {
        const float delayed_right = delayDry(1u, dry_right);
        const float output_right = static_cast<float>(
            blend(delayed_right, static_cast<double>(wet) * gain_smoothed_, mix_smoothed_));
        right[frame] = std::isfinite(output_right) ? output_right : 0.0F;
      }
      dry_position_ = dry_position_ + 1u == latency_samples_ + 1u ? 0u : dry_position_ + 1u;
    }
  }

private:
  [[nodiscard]] static float sanitizeControl(float value, float minimum, float maximum,
                                             float fallback) noexcept {
    if (!std::isfinite(value)) {
      return fallback;
    }
    if (value < minimum) {
      return minimum;
    }
    return value > maximum ? maximum : value;
  }

  void configureRate() noexcept {
    supported_ = true;
    switch (sample_rate_) {
    case 44100u:
      base_rate_ = 44100u;
      halfband_stages_ = 0u;
      latency_samples_ = 2502u;
      wet_padding_ = {1u, 0u, 0u};
      break;
    case 48000u:
      base_rate_ = 48000u;
      halfband_stages_ = 0u;
      latency_samples_ = 2706u;
      wet_padding_ = {0u, 0u, 0u};
      break;
    case 88200u:
      base_rate_ = 44100u;
      halfband_stages_ = 1u;
      latency_samples_ = 5132u;
      wet_padding_ = {0u, 0u, 1u};
      break;
    case 96000u:
      base_rate_ = 48000u;
      halfband_stages_ = 1u;
      latency_samples_ = 5489u;
      wet_padding_ = {1u, 1u, 0u};
      break;
    case 176400u:
      base_rate_ = 44100u;
      halfband_stages_ = 2u;
      latency_samples_ = 9650u;
      wet_padding_ = {1u, 0u, 0u};
      break;
    case 192000u:
      base_rate_ = 48000u;
      halfband_stages_ = 2u;
      latency_samples_ = 10329u;
      wet_padding_ = {0u, 2u, 2u};
      break;
    case 352800u:
      base_rate_ = 44100u;
      halfband_stages_ = 3u;
      latency_samples_ = 18641u;
      wet_padding_ = {0u, 0u, 0u};
      break;
    case 384000u:
      base_rate_ = 48000u;
      halfband_stages_ = 3u;
      latency_samples_ = 20030u;
      wet_padding_ = {3u, 1u, 0u};
      break;
    default:
      base_rate_ = 0u;
      halfband_stages_ = 0u;
      latency_samples_ = 0u;
      wet_padding_ = {0u, 0u, 0u};
      supported_ = false;
      break;
    }
  }

  void processHostSample(float sample) noexcept {
    float decimated = sample;
    for (std::uint32_t stage = 0u; stage < halfband_stages_; ++stage) {
      float output = 0.0F;
      if (!input_halfbands_[stage].decimate(decimated, output)) {
        return;
      }
      decimated = output;
    }

    std::array<float, dsp::RationalResampler::kMaximumOutputs> codec_samples{};
    const std::size_t codec_count = downsampler_.push(decimated, codec_samples);
    for (std::size_t index = 0u; index < codec_count; ++index) {
      if (input_count_ == 0u) {
        input_frame_transcodes_ = requestedTranscodes();
      }
      input_frame_[input_count_++] = toGsmInput(codec_samples[index]);
      if (input_count_ == gsmfr::kFrameSamples) {
        beginCodecWork(input_frame_transcodes_);
        input_count_ = 0u;
      }
    }
  }

  [[nodiscard]] std::uint32_t requestedTranscodes() const noexcept {
    float requested = params_.transcodes;
    if (!std::isfinite(requested)) {
      requested = 1.0F;
    } else if (requested < 1.0F) {
      requested = 1.0F;
    } else if (requested > 3.0F) {
      requested = 3.0F;
    }
    return static_cast<std::uint32_t>(std::floor(static_cast<double>(requested) + 0.5));
  }

  void applyTranscodesForFrame(std::uint32_t requested) noexcept {
    if (transcodes_initialized_ && requested == active_transcodes_) {
      return;
    }
    active_transcodes_ = requested;
    transcodes_initialized_ = true;
    for (gsmfr::Transcoder &transcoder : *transcoders_) {
      transcoder.reset();
    }
  }

  void applyOutputAlignmentForFrame(std::uint32_t transcodes) noexcept {
    const std::uint32_t previous_padding = wet_padding_[output_alignment_transcodes_ - 1u];
    const std::uint32_t next_padding = wet_padding_[transcodes - 1u];
    output_alignment_transcodes_ = transcodes;
    if (!output_alignment_initialized_ || previous_padding != next_padding) {
      wet_alignment_.fill(0.0F);
      wet_alignment_position_ = 0u;
    }
    output_alignment_initialized_ = true;
  }

  // 0 at the clean maximum, 1 at the worst modelled C/I.
  [[nodiscard]] double radioSeverity() const noexcept {
    const float quality =
        sanitizeControl(params_.carrierToInterference, kCarrierToInterferenceWorst,
                        kCarrierToInterferenceClean, kCarrierToInterferenceClean);
    const double severity =
        (static_cast<double>(kCarrierToInterferenceClean) - static_cast<double>(quality)) /
        (static_cast<double>(kCarrierToInterferenceClean) -
         static_cast<double>(kCarrierToInterferenceWorst));
    if (severity <= 0.0) {
      return 0.0;
    }
    return severity >= 1.0 ? 1.0 : severity;
  }

  // Two layer air interface model: a bursty erasure process that the decoder conceals, and a
  // residual bit error process on the unprotected class 2 bits of frames that do survive.
  void applyRadioChannel() noexcept {
    codec_work_bad_frame_ = false;
    const double severity = radioSeverity();
    if (severity <= 0.0) {
      // Clean reception ends any burst in flight so returning to a degraded C/I restarts the
      // erasure process instead of resuming a latched burst.
      channel_burst_active_ = false;
      return;
    }

    const double erasure = frameErasureRate(severity);
    const double recovery = 1.0 / kMeanErasureBurstFrames;
    const double onset = erasure >= 1.0 ? 1.0 : recovery * erasure / (1.0 - erasure);
    const double transition = channel_burst_active_ ? recovery : onset;
    if (random_.nextFloat01() < transition) {
      channel_burst_active_ = !channel_burst_active_;
    }
    if (channel_burst_active_) {
      codec_work_bad_frame_ = true;
      return;
    }
    injectClass2BitErrors(class2BitErrorRate(severity));
  }

  // Field granularity stand-in for the GSM 05.03 class 2 bit set: the low bits of the RPE pulse
  // amplitudes plus the lowest bit of each subframe maximum. All of these stay in range under a
  // flip, so no extra clamping is needed downstream.
  void injectClass2BitErrors(double bit_error_rate) noexcept {
    if (bit_error_rate <= 0.0) {
      return;
    }
    for (gsmfr::Subframe &subframe : codec_work_logical_frame_.subframes) {
      for (gsmfr::Word &pulse : subframe.pulses) {
        for (unsigned bit = 0u; bit < kClass2PulseBits; ++bit) {
          if (random_.nextFloat01() < bit_error_rate) {
            pulse = static_cast<gsmfr::Word>(static_cast<unsigned>(pulse) ^ (1u << bit));
          }
        }
      }
      if (random_.nextFloat01() < bit_error_rate) {
        subframe.maximum = static_cast<gsmfr::Word>(static_cast<unsigned>(subframe.maximum) ^ 1u);
      }
    }
  }

  void beginCodecWork(std::uint32_t frame_transcodes) noexcept {
    applyTranscodesForFrame(frame_transcodes);
    codec_work_frame_ = input_frame_;
    codec_work_phase_ = 0u;
    codec_work_countdown_ = 0u;
    codec_work_transcodes_ = frame_transcodes;
    codec_work_pending_ = true;
  }

  void advanceCodecWork() noexcept {
    if (!codec_work_pending_) {
      return;
    }
    if (codec_work_countdown_ != 0u) {
      --codec_work_countdown_;
      return;
    }

    if (codec_work_phase_ < kCodecWorkStages) {
      const std::uint32_t transcode_stage = codec_work_phase_ / 2u;
      if (transcode_stage < codec_work_transcodes_) {
        // Only the last hop leaves the network over the air; earlier transcodes are wireline.
        const bool over_the_air = transcode_stage + 1u == codec_work_transcodes_;
        if ((codec_work_phase_ & 1u) == 0u) {
          codec_work_logical_frame_ = (*transcoders_)[transcode_stage].encode(codec_work_frame_);
          if (over_the_air) {
            applyRadioChannel();
          }
        } else {
          codec_work_frame_ = (*transcoders_)[transcode_stage].decode(
              codec_work_logical_frame_, over_the_air && codec_work_bad_frame_);
        }
      }
    } else {
      const std::size_t output_stage = codec_work_phase_ - kCodecWorkStages;
      if (output_stage == 0u) {
        applyOutputAlignmentForFrame(codec_work_transcodes_);
      }
      const std::size_t begin = output_stage * kOutputSamplesPerWorkStage;
      const std::size_t end = begin + kOutputSamplesPerWorkStage;
      pushCodecOutput(begin, end);
    }

    ++codec_work_phase_;
    if (codec_work_phase_ == kCodecWorkStages + kOutputWorkStages) {
      codec_work_pending_ = false;
    } else {
      codec_work_countdown_ = codec_work_interval_samples_ - 1u;
    }
  }

  void pushCodecOutput(std::size_t begin, std::size_t end) noexcept {
    for (std::size_t index = begin; index < end; ++index) {
      std::array<float, dsp::RationalResampler::kMaximumOutputs> base_samples{};
      const std::size_t base_count =
          upsampler_.push(static_cast<float>(codec_work_frame_[index]) / 32768.0F, base_samples);
      for (std::size_t base_index = 0u; base_index < base_count; ++base_index) {
        interpolateToHost(base_samples[base_index]);
      }
    }
  }

  void interpolateToHost(float sample) noexcept {
    std::array<float, kMaximumRateFactor> current{};
    std::array<float, kMaximumRateFactor> next{};
    current[0u] = sample;
    std::size_t count = 1u;
    for (std::uint32_t stage = 0u; stage < halfband_stages_; ++stage) {
      std::size_t next_count = 0u;
      for (std::size_t index = 0u; index < count; ++index) {
        float first = 0.0F;
        float second = 0.0F;
        output_halfbands_[stage].interpolate(current[index], first, second);
        next[next_count++] = first;
        next[next_count++] = second;
      }
      for (std::size_t index = 0u; index < next_count; ++index) {
        current[index] = next[index];
      }
      count = next_count;
    }
    for (std::size_t index = 0u; index < count; ++index) {
      pushWet(current[index]);
    }
  }

  void pushWet(float sample) noexcept {
    wet_fifo_[wet_write_] = sanitizeFinite(sample);
    wet_write_ = wet_write_ + 1u == kWetFifoCapacity ? 0u : wet_write_ + 1u;
    if (wet_count_ < kWetFifoCapacity) {
      ++wet_count_;
    } else {
      wet_read_ = wet_read_ + 1u == kWetFifoCapacity ? 0u : wet_read_ + 1u;
    }
  }

  [[nodiscard]] float popWet() noexcept {
    if (wet_count_ == 0u) {
      return 0.0F;
    }
    const float sample = wet_fifo_[wet_read_];
    wet_read_ = wet_read_ + 1u == kWetFifoCapacity ? 0u : wet_read_ + 1u;
    --wet_count_;
    return sample;
  }

  [[nodiscard]] float alignWet(float sample) noexcept {
    const std::uint32_t delay = wet_padding_[output_alignment_transcodes_ - 1u];
    if (delay == 0u) {
      return sample;
    }
    const std::uint32_t size = delay + 1u;
    wet_alignment_[wet_alignment_position_] = sample;
    const std::uint32_t next =
        wet_alignment_position_ + 1u == size ? 0u : wet_alignment_position_ + 1u;
    const float delayed = wet_alignment_[next];
    wet_alignment_position_ = next;
    return delayed;
  }

  [[nodiscard]] float delayDry(std::uint32_t channel, float sample) noexcept {
    const std::size_t delay_size = static_cast<std::size_t>(latency_samples_) + 1u;
    const std::size_t base = channel * delay_size;
    dry_delay_[base + dry_position_] = sample;
    const std::size_t next_position = dry_position_ + 1u;
    const std::size_t read = next_position == delay_size ? 0u : next_position;
    return dry_delay_[base + read];
  }

  std::uint32_t sample_rate_ = 0u;
  std::uint32_t base_rate_ = 0u;
  std::uint32_t halfband_stages_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t latency_samples_ = 0u;
  std::uint32_t active_transcodes_ = 1u;
  std::uint32_t output_alignment_transcodes_ = 1u;
  std::array<std::uint32_t, 3u> wet_padding_{};
  bool supported_ = false;
  bool transcodes_initialized_ = false;
  bool output_alignment_initialized_ = false;
  bool smoothing_initialized_ = false;
  double gain_smoothed_ = 1.0;
  double mix_smoothed_ = 1.0;

  std::unique_ptr<std::array<gsmfr::Transcoder, 3u>> transcoders_{};
  dsp::RationalResampler downsampler_{};
  dsp::RationalResampler upsampler_{};
  std::array<dsp::Halfband2x, 3u> input_halfbands_{};
  std::array<dsp::Halfband2x, 3u> output_halfbands_{};
  std::array<gsmfr::Word, gsmfr::kFrameSamples> input_frame_{};
  std::array<gsmfr::Word, gsmfr::kFrameSamples> codec_work_frame_{};
  gsmfr::Frame codec_work_logical_frame_{};
  std::size_t input_count_ = 0u;
  std::uint32_t codec_work_phase_ = 0u;
  std::uint32_t codec_work_countdown_ = 0u;
  std::uint32_t codec_work_interval_samples_ = 1u;
  std::uint32_t input_frame_transcodes_ = 1u;
  std::uint32_t codec_work_transcodes_ = 1u;
  bool codec_work_pending_ = false;
  std::vector<float> dry_delay_{};
  std::vector<float> wet_fifo_{};
  std::size_t dry_position_ = 0u;
  std::size_t wet_read_ = 0u;
  std::size_t wet_write_ = 0u;
  std::size_t wet_count_ = 0u;
  std::array<float, 4u> wet_alignment_{};
  std::uint32_t wet_alignment_position_ = 0u;
  dsp::XorShiftRng random_{};
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool channel_burst_active_ = false;
  bool codec_work_bad_frame_ = false;
};

static_assert(sizeof(GSMFullRateSimulatorKernel) <= 8192u);

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(GSMFullRateSimulatorPlugin,
                         effetune::plugins::lofi::GSMFullRateSimulatorKernel)

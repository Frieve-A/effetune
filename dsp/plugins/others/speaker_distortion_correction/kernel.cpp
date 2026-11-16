// Speaker Distortion Correction (MIT License).
//
// A static pre-distorter: second-order correction terms fitted offline from a loudspeaker
// measurement arrive as a fixed weight asset and are subtracted from (Reduce) or added to (Add)
// the signal. The kernel performs no adaptive or online identification of the loudspeaker, unlike
// the approaches of US 8,078,433, US 9,615,174, US 10,127,921, US 12,621,604 and US 11,356,773.
//
// Each corrected channel runs 16 low and 6 high resonant sections. Products of the low-section
// states are evaluated every D samples and held with a small linear advance; the products with the
// high-section states run at the full rate. The direct sum S0 is delayed by the latency of the
// 90-degree path, which carries the second sum S1 through half-band decimators, an odd-tap
// Hilbert-type filter and matching interpolators.
//
// An optional odd-order block adds sum_a e_a * clamp(r_a, -T_a, T_a)^3 over the raw low-section
// states r_a. It is evaluated every 2D samples, held, and subtracted together with S0 before the
// delay line; a channel whose odd weights are all zero skips it.
#include "effetune/kernel.h"
#include "SpeakerDistortionCorrectionPluginParams.h"
#include "binary_io.h"
#include "effetune/dsp/denormal.h"
#include "effetune/dsp/portable_math.h"
#include "nothrow_storage.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace effetune::plugins::others {
namespace {

constexpr std::uint32_t kAssetSlot = 0u;
// The parity harness and the engine admit staging through the shared 32 MiB footprint cap; the
// payload itself is always kAssetBytes.
constexpr std::uint32_t kAssetCapacity = 32u * 1024u * 1024u;
constexpr std::uint32_t kAssetHeaderBytes = 32u;
constexpr std::uint32_t kAssetMagic = 0x31415445u;
constexpr std::uint32_t kAssetChannels = 16u;
constexpr std::uint32_t kAssetFrames = 1247u;
constexpr std::uint32_t kTopologyIndependent = 2u;
constexpr std::uint32_t kAssetBytes =
    kAssetHeaderBytes + kAssetChannels * kAssetFrames * static_cast<std::uint32_t>(sizeof(float));

constexpr std::uint32_t kLowSections = 16u;
constexpr std::uint32_t kLowStates = 2u * kLowSections;
constexpr std::uint32_t kHighSections = 6u;
constexpr std::uint32_t kHighStates = 2u * kHighSections;
constexpr std::uint32_t kLowLowOffset = 0u;
constexpr std::uint32_t kLowHighOffset = kLowLowOffset + kLowStates * (kLowStates + 1u) / 2u;
constexpr std::uint32_t kLowQuadratureOffset = kLowHighOffset + kLowStates * kHighSections;
constexpr std::uint32_t kHighHighOffset = kLowQuadratureOffset + kLowStates * kHighSections;
constexpr std::uint32_t kSecondOffset = kHighHighOffset + kHighStates * (kHighStates + 1u) / 2u;
constexpr std::uint32_t kWeightCount = kSecondOffset + kLowStates * kHighSections;
constexpr std::uint32_t kStepFrame = kWeightCount;
// Odd weights w_0..w_31 follow the step frame, then the bounds B_0..B_31.
constexpr std::uint32_t kOddWeightFrame = kStepFrame + 1u;
constexpr std::uint32_t kOddBoundFrame = kOddWeightFrame + kLowStates;
static_assert(kWeightCount == 1182u && kOddBoundFrame + kLowStates == kAssetFrames);

// SDC_MAX_WEIGHT: every weight magnitude must stay below this bound. The plugin validates the
// staged weights against the same value.
constexpr double kMaxWeight = 1000.0;
constexpr double kRms = 0.1;
constexpr double kLowQ = 2.15;
constexpr double kHighQ = 1.4;
constexpr std::array<double, kHighSections> kHighFrequencies{580.0,  1050.0, 1900.0,
                                                             3450.0, 6200.0, 7800.0};
constexpr double kLn2 = 0.69314718055994530942;
constexpr double kMinimumRate = 44100.0;
constexpr double kFitRate = 48000.0;
constexpr double kDecimatedMinimumRate = 22050.0;
constexpr std::array<double, 2> kFilterSeconds{0.000625, 0.0025};
constexpr double kFilterBeta = 4.3;
constexpr double kHalfBandBeta = 4.5335;
constexpr double kHalfBandEdge = 40000.0;

constexpr std::uint32_t kLengthShort = 0u;
constexpr std::uint32_t kLengthLong = 1u;
constexpr std::uint32_t kLengthCount = 2u;
constexpr std::uint32_t kMaxFilterTaps = 256u;
constexpr std::uint32_t kMaxHalfBandK = 24u;
constexpr std::uint32_t kMaxStages = 6u;

constexpr std::uint16_t kTapOverload = 1u;
constexpr std::uint16_t kTelemetryVersion = 1u;

constexpr std::uint32_t kSectionsOffset = 0u;
constexpr std::uint32_t kHoldsOffset = kSectionsOffset + 2u * kLowSections + 2u * kHighSections;
constexpr std::uint32_t kHoldCount = 2u + 3u * kHighSections;
constexpr std::uint32_t kInputRingOffset = kHoldsOffset + kHoldCount;

std::uint32_t readU32(const std::uint8_t *bytes) noexcept {
  return static_cast<std::uint32_t>(bytes[0]) | (static_cast<std::uint32_t>(bytes[1]) << 8u) |
         (static_cast<std::uint32_t>(bytes[2]) << 16u) |
         (static_cast<std::uint32_t>(bytes[3]) << 24u);
}

// Modified Bessel function of the first kind, order zero, as its power series.
double besselI0(double x) noexcept {
  const double quarterSquare = x * x * 0.25;
  double sum = 1.0;
  double term = 1.0;
  for (double k = 1.0;; k += 1.0) {
    term *= quarterSquare / (k * k);
    if (term < 1e-17 * sum)
      break;
    sum += term;
  }
  return sum;
}

struct Section final {
  double a1 = 0.0;
  double a2 = 0.0;
  double peakScale = 0.0;
  double quadratureScale = 0.0;
};

// iirpeak design: the peak state (v - v2) scaled by b0 and the quadrature state v1 scaled by the
// magnitude of the denominator at the centre frequency.
Section designSection(double frequency, double q, double sampleRate) noexcept {
  const double w0 = 2.0 * dsp::kPi * frequency / sampleRate;
  const double beta = dsp::portableTan(w0 / (2.0 * q));
  const double g = 1.0 / (1.0 + beta);
  Section section;
  section.a1 = -2.0 * g * dsp::portableCos(w0);
  section.a2 = 2.0 * g - 1.0;
  section.peakScale = 1.0 - g;
  const double real =
      1.0 + section.a1 * dsp::portableCos(w0) + section.a2 * dsp::portableCos(2.0 * w0);
  const double imaginary =
      section.a1 * dsp::portableSin(w0) + section.a2 * dsp::portableSin(2.0 * w0);
  section.quadratureScale = std::sqrt(real * real + imaginary * imaginary);
  return section;
}

struct HalfBandStage final {
  std::uint32_t k = 0u;
  std::uint32_t length = 0u;
  std::array<double, kMaxHalfBandK> taps{}; // taps[k - 1] = h[2k - 1]
};

struct LengthConfig final {
  std::uint32_t stages = 0u;
  std::uint32_t spread = 1u;
  std::uint32_t half = 0u;
  std::uint32_t window = 0u;
  std::uint32_t latency = 0u;
  std::array<double, kMaxFilterTaps> taps{}; // taps[m] = h[m] for odd m
};

struct Bank final {
  NothrowStorage<double> weights;
  // Per channel, 2 * kLowStates values: RMS * w_a, then k_a = kappa_a / (RMS * B_a).
  NothrowStorage<double> odd;
  std::array<bool, kAssetChannels> oddActive{};
  std::array<bool, kAssetChannels> corrected{};
  std::uint32_t length = kLengthShort;
};

struct ChannelState final {
  std::uint32_t phase = 0u;
  std::uint32_t filterPosition = 0u;
  std::array<std::uint32_t, kMaxStages> decimatorPosition{};
  std::array<std::uint32_t, kMaxStages> interpolatorPosition{};
  std::array<bool, kMaxStages> oddInput{};
  bool oddSkip = false; // the odd block runs on every other low-rate instant
  double oddHeld = 0.0;
};

// Doubled ring: each sample is written at position and position + window, so the newest sample
// and the window - 1 before it are contiguous below the returned pointer.
double *pushDoubled(double *ring, std::uint32_t window, std::uint32_t &position,
                    double value) noexcept {
  ring[position] = value;
  ring[position + window] = value;
  double *newest = ring + position + window;
  position = position + 1u == window ? 0u : position + 1u;
  return newest;
}

const double *newestDoubled(const double *ring, std::uint32_t window,
                            std::uint32_t position) noexcept {
  return ring + (position == 0u ? window - 1u : position - 1u) + window;
}

} // namespace

class SpeakerDistortionCorrectionKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::SpeakerDistortionCorrectionPluginParams)

public:
  static std::uint32_t assetCapacityForSlot(std::uint32_t slot) noexcept {
    return slot == kAssetSlot ? kAssetCapacity : 0u;
  }

  void prepare(const PrepareInfo &info) noexcept override {
    prepared_ = false;
    state_.release();
    staging_.release();
    asset_state_ = ET_ASSET_STATE_NONE;
    asset_reason_ = 0u;
    has_active_ = false;
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    for (Bank &bank : banks_) {
      if (!bank.weights.allocate(static_cast<std::size_t>(kAssetChannels) * kWeightCount) ||
          !bank.odd.allocate(static_cast<std::size_t>(kAssetChannels) * 2u * kLowStates))
        return;
    }
    rate_supported_ = sample_rate_ >= kMinimumRate;
    if (rate_supported_ && (!designFilters() || !allocateState()))
      return;
    prepared_ = true;
    resetState();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  void reset() noexcept override { resetState(); }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || frame_count == 0u)
      return;
    if (asset_state_ == ET_ASSET_STATE_PREPARING) {
      active_bank_ = 1u - active_bank_;
      has_active_ = true;
      asset_state_ = ET_ASSET_STATE_ACTIVE;
      resetState();
    }
    const std::uint32_t first = selectedFirst(params_);
    const std::uint32_t count = selectedCount(params_);
    if (first != selected_first_ || count != selected_count_) {
      resetState();
      selected_first_ = first;
      selected_count_ = count;
    }
    if (!rate_supported_ || !has_active_ || !selectedCorrection(banks_[active_bank_], params_))
      return;

    const Bank &bank = banks_[active_bank_];
    const LengthConfig &config = lengths_[bank.length];
    const double magnitude = dsp::portableDecadePower(params_.amplifierVolumeChange / 20.0);
    const double scale = params_.mode >= 0.5F ? -magnitude : magnitude;
    const std::uint32_t read_offset = delay_size_ - config.latency;
    const std::uint32_t channels = channel_count < count ? channel_count : count;
    for (std::uint32_t local = 0u; local < channels; ++local) {
      const std::uint32_t channel = first + local;
      float *samples = audio + static_cast<std::size_t>(local) * frame_count;
      if (bank.corrected[channel]) {
        processCorrected(channel, samples, frame_count, bank, config, scale, read_offset);
      } else {
        processDelayed(channel, samples, frame_count, read_offset, 0u);
      }
    }
    delay_position_ = static_cast<std::uint32_t>(
        (static_cast<std::uint64_t>(delay_position_) + frame_count) % delay_size_);
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    if (!prepared_ || !rate_supported_)
      return 0u;
    // The output gate queries latency after staging, before the next audio block applies it.
    const Params &parameters = params_pending_ ? staged_params_ : params_;
    if (asset_state_ == ET_ASSET_STATE_PREPARING) {
      const Bank &pending = banks_[1u - active_bank_];
      return selectedCorrection(pending, parameters) ? lengths_[pending.length].latency : 0u;
    }
    const Bank &active = banks_[active_bank_];
    return has_active_ && selectedCorrection(active, parameters) ? lengths_[active.length].latency
                                                                 : 0u;
  }

  [[nodiscard]] std::uint32_t assetCapacity(std::uint32_t slot) const noexcept override {
    return assetCapacityForSlot(slot);
  }

  std::uint8_t *beginAsset(std::uint32_t slot, const AssetBeginInfo &info) noexcept override {
    if (!prepared_ || slot != kAssetSlot || info.channels != kAssetChannels ||
        info.frames != kAssetFrames || info.topology != kTopologyIndependent ||
        info.headBlock != 0u || info.rateDivider != 1u || info.pathCount != 0u ||
        info.inputCount != 0u || info.processingChannels == 0u ||
        info.processingChannels > max_channels_ || info.byteSize != kAssetBytes ||
        info.footprintBytes < info.byteSize || info.footprintBytes > kAssetCapacity) {
      return nullptr;
    }
    if (!staging_.allocate(kAssetBytes / sizeof(float))) {
      setAssetError(2u);
      return nullptr;
    }
    asset_state_ = ET_ASSET_STATE_STAGED;
    asset_reason_ = 0u;
    return reinterpret_cast<std::uint8_t *>(staging_.data());
  }

  et_status commitAsset(std::uint32_t slot, std::uint32_t bytes,
                        std::uint32_t format_tag) noexcept override {
    if (slot != kAssetSlot || asset_state_ != ET_ASSET_STATE_STAGED || bytes != kAssetBytes ||
        format_tag != ET_ASSET_F32_MULTICH || !validatePayload()) {
      setAssetError(1u);
      return ET_ERR_ARGS;
    }
    foldPayload(banks_[1u - active_bank_]);
    asset_state_ = ET_ASSET_STATE_PREPARING;
    asset_reason_ = 0u;
    return ET_OK;
  }

  void clearAsset(std::uint32_t slot) noexcept override {
    if (slot != kAssetSlot)
      return;
    staging_.release();
    has_active_ = false;
    asset_state_ = ET_ASSET_STATE_NONE;
    asset_reason_ = 0u;
  }

  [[nodiscard]] std::uint32_t assetState(std::uint32_t slot) const noexcept override {
    return slot == kAssetSlot ? asset_state_ | (asset_reason_ << 8u)
                              : static_cast<std::uint32_t>(ET_ASSET_STATE_NONE);
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!(peak_ > 1.0))
      return;
    std::array<std::uint8_t, 4> payload{};
    binary_io::writeF32(payload.data(), static_cast<float>(peak_));
    if (writer.write(kTapOverload, kTelemetryVersion, payload.data(),
                     static_cast<std::uint16_t>(payload.size())))
      peak_ = 0.0;
  }

private:
  [[nodiscard]] static std::uint32_t selectedFirst(const Params &parameters) noexcept {
    return parameters.selectedFirst >= 0.0F && parameters.selectedFirst < kAssetChannels
               ? static_cast<std::uint32_t>(parameters.selectedFirst)
               : 0u;
  }

  [[nodiscard]] static std::uint32_t selectedCount(const Params &parameters) noexcept {
    const std::uint32_t remaining = kAssetChannels - selectedFirst(parameters);
    // Zero keeps the native API's default, un-routed physical channel order.
    return parameters.selectedCount > 0.0F && parameters.selectedCount < remaining
               ? static_cast<std::uint32_t>(parameters.selectedCount)
               : remaining;
  }

  [[nodiscard]] static bool selectedCorrection(const Bank &bank,
                                               const Params &parameters) noexcept {
    const std::uint32_t end = selectedFirst(parameters) + selectedCount(parameters);
    for (std::uint32_t channel = selectedFirst(parameters); channel < end; ++channel) {
      if (bank.corrected[channel])
        return true;
    }
    return false;
  }

  bool designFilters() noexcept {
    for (std::uint32_t i = 0u; i < kLowSections; ++i) {
      const double frequency = 20.0 * dsp::portableExp(static_cast<double>(i) / 3.0 * kLn2);
      low_[i] = designSection(frequency, kLowQ, sample_rate_);
      low_scales_[2u * i] = low_[i].peakScale;
      low_scales_[2u * i + 1u] = low_[i].quadratureScale;
    }
    for (std::uint32_t j = 0u; j < kHighSections; ++j) {
      high_[j] = designSection(kHighFrequencies[j], kHighQ, sample_rate_);
      high_scales_[2u * j] = high_[j].peakScale;
      high_scales_[2u * j + 1u] = high_[j].quadratureScale;
    }

    decimation_ = 2u;
    while (sample_rate_ / (2.0 * decimation_) >= kDecimatedMinimumRate)
      decimation_ *= 2u;
    const double decimation = static_cast<double>(decimation_);
    hold_advance_ =
        ((decimation - 1.0) / (2.0 * sample_rate_) - 0.5 / kFitRate) * sample_rate_ / decimation;
    const double base_rate = 2.0 * sample_rate_ / decimation;

    std::uint32_t long_stages = 0u;
    for (std::uint32_t ratio = decimation_ / 2u; ratio > 1u; ratio /= 2u)
      ++long_stages;
    if (long_stages > kMaxStages)
      return false;
    stage_count_ = long_stages;
    double rate = sample_rate_;
    for (std::uint32_t level = 0u; level < stage_count_; ++level, rate *= 0.5) {
      if (!designHalfBand(stages_[level], rate))
        return false;
    }

    for (std::uint32_t length = 0u; length < kLengthCount; ++length) {
      LengthConfig &config = lengths_[length];
      if (length == kLengthLong) {
        config.stages = long_stages;
        config.spread = 1u;
      } else {
        config.spread = decimation_ == 2u ? 1u : 2u;
        config.stages = decimation_ == 2u ? 0u : long_stages - 1u;
      }
      config.half = static_cast<std::uint32_t>(std::lround(kFilterSeconds[length] * base_rate));
      if (config.half == 0u || config.half >= kMaxFilterTaps)
        return false;
      config.window = 2u * config.half * config.spread + 1u;
      const double norm = besselI0(kFilterBeta);
      config.taps.fill(0.0);
      for (std::uint32_t m = 1u; m <= config.half; m += 2u) {
        const double ratio = static_cast<double>(m) / config.half;
        const double kaiser = besselI0(kFilterBeta * std::sqrt(1.0 - ratio * ratio)) / norm;
        config.taps[m] = -2.0 * kaiser / (dsp::kPi * m);
      }
      std::uint32_t latency = config.half * config.spread;
      for (std::uint32_t level = config.stages; level > 0u; --level)
        latency = 2u * latency + stages_[level - 1u].length - 1u;
      config.latency = latency;
    }
    return true;
  }

  static bool designHalfBand(HalfBandStage &stage, double rate) noexcept {
    const double transition = 2.285 * 2.0 * dsp::kPi * (rate * 0.5 - kHalfBandEdge) / rate;
    const double required = std::ceil(42.05 / transition) + 1.0;
    std::uint32_t k = 1u;
    while (static_cast<double>(4u * k - 1u) < required) {
      if (++k > kMaxHalfBandK)
        return false;
    }
    stage.k = k;
    stage.length = 4u * k - 1u;
    const double span = static_cast<double>(2u * k - 1u);
    const double norm = besselI0(kHalfBandBeta);
    for (std::uint32_t index = 1u; index <= k; ++index) {
      const double n = static_cast<double>(2u * index - 1u);
      const double ratio = n / span;
      const double kaiser = besselI0(kHalfBandBeta * std::sqrt(1.0 - ratio * ratio)) / norm;
      const double sign = (index & 1u) != 0u ? 1.0 : -1.0;
      stage.taps[index - 1u] = sign / (dsp::kPi * n) * kaiser;
    }
    return true;
  }

  bool allocateState() noexcept {
    const std::uint32_t longest = lengths_[kLengthShort].latency > lengths_[kLengthLong].latency
                                      ? lengths_[kLengthShort].latency
                                      : lengths_[kLengthLong].latency;
    delay_size_ = longest + 1u;
    std::uint32_t offset = kInputRingOffset + 2u * delay_size_;
    for (std::uint32_t level = 0u; level < stage_count_; ++level) {
      decimator_offset_[level] = offset;
      offset += 2u * stages_[level].length;
      interpolator_offset_[level] = offset;
      offset += 4u * stages_[level].k;
    }
    filter_window_ = lengths_[kLengthShort].window > lengths_[kLengthLong].window
                         ? lengths_[kLengthShort].window
                         : lengths_[kLengthLong].window;
    filter_offset_ = offset;
    channel_stride_ = offset + 2u * filter_window_;
    return state_.allocate(static_cast<std::size_t>(kAssetChannels) * channel_stride_);
  }

  void resetState() noexcept {
    state_.clear();
    channels_.fill(ChannelState{});
    delay_position_ = 0u;
    peak_ = 0.0;
  }

  // Clears everything a corrected channel computes except its input delay line, so the channel
  // can keep publishing x[n - latency] after a non-finite result.
  void resetChannel(std::uint32_t channel) noexcept {
    double *state = channelState(channel);
    for (std::uint32_t index = 0u; index < kInputRingOffset; ++index)
      state[index] = 0.0;
    for (std::uint32_t index = kInputRingOffset + delay_size_; index < channel_stride_; ++index)
      state[index] = 0.0;
    channels_[channel] = ChannelState{};
  }

  [[nodiscard]] double *channelState(std::uint32_t channel) noexcept {
    return state_.data() + static_cast<std::size_t>(channel) * channel_stride_;
  }

  bool validatePayload() const noexcept {
    const auto *bytes = reinterpret_cast<const std::uint8_t *>(staging_.data());
    if (readU32(bytes) != kAssetMagic || readU32(bytes + 4u) != kAssetChannels ||
        readU32(bytes + 8u) != kAssetFrames || readU32(bytes + 16u) != kTopologyIndependent)
      return false;
    const float *data = staging_.data() + kAssetHeaderBytes / sizeof(float);
    const float step = data[kStepFrame];
    if (step != 0.0F && step != 1.0F)
      return false;
    for (std::uint32_t channel = 0u; channel < kAssetChannels; ++channel) {
      const float *frames = data + static_cast<std::size_t>(channel) * kAssetFrames;
      if (frames[kStepFrame] != step)
        return false;
      bool odd = false;
      for (std::uint32_t index = 0u; index < kOddBoundFrame; ++index) {
        if (index == kStepFrame)
          continue;
        const double weight = frames[index];
        const double magnitude = weight >= 0.0 ? weight : -weight;
        if (!(magnitude < kMaxWeight))
          return false;
        odd = odd || (index > kStepFrame && weight != 0.0);
      }
      // Bounds matter only where the odd block is active.
      for (std::uint32_t a = 0u; odd && a < kLowStates; ++a) {
        const double bound = frames[kOddBoundFrame + a];
        if (!std::isfinite(bound) || !(bound > 0.0))
          return false;
      }
    }
    return true;
  }

  void foldPayload(Bank &bank) noexcept {
    const float *data = staging_.data() + kAssetHeaderBytes / sizeof(float);
    bank.length = data[kStepFrame] == 1.0F ? kLengthLong : kLengthShort;
    for (std::uint32_t channel = 0u; channel < kAssetChannels; ++channel) {
      const float *weights = data + static_cast<std::size_t>(channel) * kAssetFrames;
      bool corrected = false;
      for (std::uint32_t index = 0u; index < kWeightCount; ++index)
        corrected = corrected || weights[index] != 0.0F;
      bool odd = false;
      for (std::uint32_t a = 0u; a < kLowStates; ++a)
        odd = odd || weights[kOddWeightFrame + a] != 0.0F;
      bank.oddActive[channel] = odd;
      double *folded = bank.odd.data() + static_cast<std::size_t>(channel) * 2u * kLowStates;
      for (std::uint32_t a = 0u; odd && a < kLowStates; ++a) {
        folded[a] = kRms * weights[kOddWeightFrame + a];
        folded[kLowStates + a] = low_scales_[a] / (kRms * weights[kOddBoundFrame + a]);
      }
      corrected = corrected || odd;
      bank.corrected[channel] = corrected;
      if (corrected && rate_supported_)
        foldChannel(weights,
                    bank.weights.data() + static_cast<std::size_t>(channel) * kWeightCount);
    }
  }

  void foldChannel(const float *weights, double *folded) const noexcept {
    std::uint32_t index = kLowLowOffset;
    for (std::uint32_t a = 0u; a < kLowStates; ++a) {
      for (std::uint32_t b = a; b < kLowStates; ++b, ++index)
        folded[index] = weights[index] * low_scales_[a] * low_scales_[b] / kRms;
    }
    for (std::uint32_t a = 0u; a < kLowStates; ++a) {
      for (std::uint32_t j = 0u; j < kHighSections; ++j) {
        const std::uint32_t pair = kHighSections * a + j;
        const double low = low_scales_[a];
        folded[kLowHighOffset + pair] =
            weights[kLowHighOffset + pair] * low * high_scales_[2u * j] / kRms;
        folded[kLowQuadratureOffset + pair] =
            weights[kLowQuadratureOffset + pair] * low * high_scales_[2u * j + 1u] / kRms;
        folded[kSecondOffset + pair] =
            weights[kSecondOffset + pair] * low * high_scales_[2u * j] / kRms;
      }
    }
    index = kHighHighOffset;
    for (std::uint32_t c = 0u; c < kHighStates; ++c) {
      for (std::uint32_t e = c; e < kHighStates; ++e, ++index)
        folded[index] = weights[index] * high_scales_[c] * high_scales_[e] / kRms;
    }
  }

  void setAssetError(std::uint32_t reason) noexcept {
    staging_.clear();
    has_active_ = false;
    asset_state_ = ET_ASSET_STATE_ERROR;
    asset_reason_ = reason;
  }

  // Publishes x[n - latency] from the channel's input delay line, starting at frame `first`.
  void processDelayed(std::uint32_t channel, float *samples, std::uint32_t frame_count,
                      std::uint32_t read_offset, std::uint32_t first) noexcept {
    double *input = channelState(channel) + kInputRingOffset;
    std::uint32_t position = static_cast<std::uint32_t>(
        (static_cast<std::uint64_t>(delay_position_) + first) % delay_size_);
    for (std::uint32_t frame = first; frame < frame_count; ++frame) {
      input[position] = samples[frame];
      std::uint32_t read = position + read_offset;
      read = read >= delay_size_ ? read - delay_size_ : read;
      samples[frame] = static_cast<float>(input[read]);
      position = position + 1u == delay_size_ ? 0u : position + 1u;
    }
  }

  void processCorrected(std::uint32_t channel, float *samples, std::uint32_t frame_count,
                        const Bank &bank, const LengthConfig &config, double scale,
                        std::uint32_t read_offset) noexcept {
    double *state = channelState(channel);
    double *low1 = state + kSectionsOffset;
    double *low2 = low1 + kLowSections;
    double *high1 = low2 + kLowSections;
    double *high2 = high1 + kHighSections;
    double *holds = state + kHoldsOffset;
    double *held_u = holds + 2u;
    double *held_uq = held_u + kHighSections;
    double *held_u2 = held_uq + kHighSections;
    double *input = state + kInputRingOffset;
    double *direct = input + delay_size_;
    const double *weights = bank.weights.data() + static_cast<std::size_t>(channel) * kWeightCount;
    ChannelState &channel_state = channels_[channel];
    std::array<double, kLowStates> low_states{};
    std::array<double, kHighStates> high_states{};
    std::uint32_t position = delay_position_;
    double peak = peak_;

    // Odd block folded for this block's dv and mode: with ka = k_a * a,
    // e_a = RMS * w_a * ka^3 * sigma / a = RMS * w_a * ka^3 / scale and T_a = 1 / ka.
    const bool odd = bank.oddActive[channel];
    std::array<double, kLowStates> odd_e{};
    std::array<double, kLowStates> odd_t{};
    if (odd) {
      const double *folded = bank.odd.data() + static_cast<std::size_t>(channel) * 2u * kLowStates;
      const double magnitude = scale >= 0.0 ? scale : -scale;
      for (std::uint32_t a = 0u; a < kLowStates; ++a) {
        const double ka = folded[kLowStates + a] * magnitude;
        odd_e[a] = folded[a] * ka * ka * ka / scale;
        odd_t[a] = 1.0 / ka;
      }
    }

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double x = samples[frame];
      const bool instant = channel_state.phase == 0u;
      for (std::uint32_t i = 0u; i < kLowSections; ++i) {
        const double v = x - low_[i].a1 * low1[i] - low_[i].a2 * low2[i];
        if (instant) {
          low_states[2u * i] = v - low2[i];
          low_states[2u * i + 1u] = low1[i];
        }
        low2[i] = low1[i];
        low1[i] = v;
      }
      for (std::uint32_t j = 0u; j < kHighSections; ++j) {
        const double g = x - high_[j].a1 * high1[j] - high_[j].a2 * high2[j];
        high_states[2u * j] = g - high2[j];
        high_states[2u * j + 1u] = high1[j];
        high2[j] = high1[j];
        high1[j] = g;
      }
      if (instant) {
        updateHolds(weights, low_states, holds);
        if (odd) {
          if (!channel_state.oddSkip) {
            double ql = 0.0;
            for (std::uint32_t a = 0u; a < kLowStates; ++a) {
              const double r = low_states[a];
              const double t = odd_t[a];
              const double c = r > t ? t : (r < -t ? -t : r);
              ql += odd_e[a] * c * c * c;
            }
            channel_state.oddHeld = ql;
          }
          channel_state.oddSkip = !channel_state.oddSkip;
        }
      }
      channel_state.phase = channel_state.phase + 1u == decimation_ ? 0u : channel_state.phase + 1u;

      double s0 = holds[1];
      double s1 = 0.0;
      for (std::uint32_t j = 0u; j < kHighSections; ++j) {
        s0 += high_states[2u * j] * held_u[j] + high_states[2u * j + 1u] * held_uq[j];
        s1 += high_states[2u * j] * held_u2[j];
      }
      std::uint32_t index = kHighHighOffset;
      for (std::uint32_t c = 0u; c < kHighStates; ++c) {
        double sum = 0.0;
        for (std::uint32_t e = c; e < kHighStates; ++e, ++index)
          sum += weights[index] * high_states[e];
        s0 += high_states[c] * sum;
      }
      const double quadrature = chainStep(channel, channel_state, config, 0u, s1);

      input[position] = x;
      direct[position] = odd ? scale * s0 + channel_state.oddHeld : scale * s0;
      std::uint32_t read = position + read_offset;
      read = read >= delay_size_ ? read - delay_size_ : read;
      const double y = (input[read] - direct[read]) - scale * quadrature;
      position = position + 1u == delay_size_ ? 0u : position + 1u;
      if (!std::isfinite(y)) {
        resetChannel(channel);
        samples[frame] = static_cast<float>(input[read]);
        processDelayed(channel, samples, frame_count, read_offset, frame + 1u);
        peak_ = peak;
        return;
      }
      samples[frame] = static_cast<float>(y);
      const double magnitude = y >= 0.0 ? y : -y;
      peak = magnitude > peak ? magnitude : peak;
    }
    // In silence the lightly damped section states decay into subnormals and stay there, which
    // slows every later block; clear them once per block.
    for (std::uint32_t i = 0u; i < 2u * (kLowSections + kHighSections); ++i)
      low1[i] = dsp::flushSubnormal(low1[i]);
    peak_ = peak;
  }

  void updateHolds(const double *weights, const std::array<double, kLowStates> &low_states,
                   double *holds) const noexcept {
    double q = 0.0;
    std::uint32_t index = kLowLowOffset;
    for (std::uint32_t a = 0u; a < kLowStates; ++a) {
      double sum = 0.0;
      for (std::uint32_t b = a; b < kLowStates; ++b, ++index)
        sum += weights[index] * low_states[b];
      q += low_states[a] * sum;
    }
    holds[1] = q + hold_advance_ * (q - holds[0]);
    holds[0] = q;
    double *held_u = holds + 2u;
    double *held_uq = held_u + kHighSections;
    double *held_u2 = held_uq + kHighSections;
    for (std::uint32_t j = 0u; j < kHighSections; ++j) {
      held_u[j] = 0.0;
      held_uq[j] = 0.0;
      held_u2[j] = 0.0;
    }
    for (std::uint32_t a = 0u; a < kLowStates; ++a) {
      const double r = low_states[a];
      const std::uint32_t row = kHighSections * a;
      for (std::uint32_t j = 0u; j < kHighSections; ++j) {
        held_u[j] += weights[kLowHighOffset + row + j] * r;
        held_uq[j] += weights[kLowQuadratureOffset + row + j] * r;
        held_u2[j] += weights[kSecondOffset + row + j] * r;
      }
    }
  }

  // One input sample of the 90-degree path at `level`: half-band decimation down to the filter
  // rate, the odd-tap filter, and half-band interpolation back up.
  double chainStep(std::uint32_t channel, ChannelState &channel_state, const LengthConfig &config,
                   std::uint32_t level, double value) noexcept {
    double *state = channelState(channel);
    // Preparation caps the chain at kMaxStages; keep that bound local to the stage indexing.
    if (level >= config.stages || level >= kMaxStages) {
      const double *newest =
          pushDoubled(state + filter_offset_, config.window, channel_state.filterPosition, value);
      const std::uint32_t spread = config.spread;
      double sum = 0.0;
      for (std::uint32_t m = 1u; m <= config.half; m += 2u) {
        sum += config.taps[m] * (newest[-static_cast<std::ptrdiff_t>((config.half + m) * spread)] -
                                 newest[-static_cast<std::ptrdiff_t>((config.half - m) * spread)]);
      }
      return sum;
    }

    const HalfBandStage &stage = stages_[level];
    const std::uint32_t k_count = stage.k;
    const double *input = pushDoubled(state + decimator_offset_[level], stage.length,
                                      channel_state.decimatorPosition[level], value);
    double *interpolator = state + interpolator_offset_[level];
    const std::uint32_t interpolator_window = 2u * k_count;
    const bool odd = channel_state.oddInput[level];
    channel_state.oddInput[level] = !odd;
    if (!odd) {
      const double *newest = newestDoubled(interpolator, interpolator_window,
                                           channel_state.interpolatorPosition[level]);
      return newest[-static_cast<std::ptrdiff_t>(k_count - 1u)];
    }

    const double *centre = input - static_cast<std::ptrdiff_t>(2u * k_count - 1u);
    double decimated = 0.5 * centre[0];
    for (std::uint32_t k = 1u; k <= k_count; ++k) {
      const std::ptrdiff_t offset = static_cast<std::ptrdiff_t>(2u * k - 1u);
      decimated += stage.taps[k - 1u] * (centre[-offset] + centre[offset]);
    }
    const double filtered = chainStep(channel, channel_state, config, level + 1u, decimated);
    const double *newest = pushDoubled(interpolator, interpolator_window,
                                       channel_state.interpolatorPosition[level], filtered);
    double sum = 0.0;
    for (std::uint32_t k = 1u; k <= k_count; ++k) {
      sum += 2.0 * stage.taps[k - 1u] *
             (newest[-static_cast<std::ptrdiff_t>(k_count - 1u + k)] +
              newest[-static_cast<std::ptrdiff_t>(k_count - k)]);
    }
    return sum;
  }

  NothrowStorage<float> staging_;
  NothrowStorage<double> state_;
  std::array<Bank, 2> banks_{};
  std::array<ChannelState, kAssetChannels> channels_{};
  std::array<Section, kLowSections> low_{};
  std::array<Section, kHighSections> high_{};
  std::array<double, kLowStates> low_scales_{};
  std::array<double, kHighStates> high_scales_{};
  std::array<HalfBandStage, kMaxStages> stages_{};
  std::array<LengthConfig, kLengthCount> lengths_{};
  std::array<std::uint32_t, kMaxStages> decimator_offset_{};
  std::array<std::uint32_t, kMaxStages> interpolator_offset_{};
  double sample_rate_ = 0.0;
  double hold_advance_ = 0.0;
  double peak_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t decimation_ = 2u;
  std::uint32_t stage_count_ = 0u;
  std::uint32_t delay_size_ = 1u;
  std::uint32_t delay_position_ = 0u;
  std::uint32_t selected_first_ = 0u;
  std::uint32_t selected_count_ = kAssetChannels;
  std::uint32_t filter_window_ = 0u;
  std::uint32_t filter_offset_ = 0u;
  std::uint32_t channel_stride_ = 0u;
  std::uint32_t active_bank_ = 0u;
  std::uint32_t asset_state_ = ET_ASSET_STATE_NONE;
  std::uint32_t asset_reason_ = 0u;
  bool has_active_ = false;
  bool rate_supported_ = false;
  bool prepared_ = false;
};

} // namespace effetune::plugins::others

EFFETUNE_REGISTER_KERNEL(SpeakerDistortionCorrectionPlugin,
                         effetune::plugins::others::SpeakerDistortionCorrectionKernel)

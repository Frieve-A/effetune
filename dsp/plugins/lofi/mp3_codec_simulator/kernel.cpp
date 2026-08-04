#include "effetune/kernel.h"
#include "MP3CodecSimulatorPluginParams.h"
#include "diagnostic.h"
#include "effetune/dsp/halfband.h"
#include "effetune/dsp/rational_resampler.h"
#include "mp3_core.h"

#include <pffft.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <numbers>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

using mp3::BlockType;
using mp3::GranuleChannel;
using mp3::LogicalFrame;
using mp3::Profile;
using mp3::ProfilePolicy;

constexpr std::uint32_t kChannels = 2u;
constexpr std::uint32_t kSubbands = 32u;
constexpr std::uint32_t kSlots = 18u;
constexpr std::uint32_t kGranuleSamples = mp3::kGranuleSamples;
constexpr std::uint32_t kMaximumGranules = mp3::kMaximumGranules;
constexpr std::uint32_t kMaximumFrameSamples = 1152u;
constexpr std::uint32_t kLookaheadSamples = 576u;
constexpr std::uint32_t kInputCapacity = kMaximumFrameSamples + kLookaheadSamples;
constexpr std::uint32_t kOutputCapacity = 32768u;
constexpr std::uint32_t kMaximumHalfbandStages = 3u;
constexpr std::uint32_t kMaximumRateFactor = 8u;
constexpr std::uint32_t kProfileCount = 2u;
constexpr std::uint32_t kMaximumScaleFactorBands = 22u;
constexpr double kInverseSqrtTwo = 0.70710678118654752440;
static_assert(mp3::scaleFactorBits(Profile::Mpeg1, BlockType::Short, 36u) == 126u);

enum class FrameWorkStage : std::uint8_t {
  Idle,
  DetectAttack,
  Psychoacoustics,
  AnalysisSlot,
  HybridAnalysis,
  MidSideDecision,
  MidSideApply,
  QuantizeInitialize,
  QuantizeBinaryMap,
  QuantizeBinaryHuffman,
  QuantizeFinalMap,
  QuantizeFinalHuffman,
  QuantizeFinalSpacing,
  QuantizeInitialDistortion,
  QuantizePassSelect,
  QuantizePassMap,
  QuantizePassHuffman,
  QuantizePassDistortion,
  QuantizePassCommit,
  QuantizeRestoreMap,
  QuantizeRestoreHuffman,
  ScaleFactorSelection,
  BudgetCommit,
  DecodeSpectrum,
  DecodeMidSide,
  HybridSynthesis,
  SynthesisSlot,
  Ready
};

// Host route: a halfband cascade converts between the host rate and the base rate
// of its own family (44.1 kHz or 48 kHz); at most one rational stage then bridges
// the base rate and the codec rate.
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

[[nodiscard]] bool supportedRate(std::uint32_t rate) noexcept {
  return hostTopology(rate).baseRate != 0u;
}

[[nodiscard]] constexpr std::uint32_t profileIndex(Profile profile) noexcept {
  return profile == Profile::Mpeg1 ? 0u : 1u;
}

// The guaranteed passband follows the widest coded bandwidth of the profile, so
// the rational stage never carries an independently hand-entered band limit. The
// cutoff sits halfway between that passband edge and the codec Nyquist, which
// keeps everything that folds back into the passband inside the stopband.
[[nodiscard]] double resamplerCutoffHz(Profile profile) noexcept {
  const std::uint32_t maximum_bitrate_index = profile == Profile::Mpeg1 ? 11u : 7u;
  const ProfilePolicy maximum_policy = mp3::profilePolicy(profile, maximum_bitrate_index);
  const double codec_rate = static_cast<double>(maximum_policy.sampleRate);
  const double passband_edge = static_cast<double>(maximum_policy.cutoffLine) * codec_rate / 1152.0;
  return 0.5 * (passband_edge + 0.5 * codec_rate);
}

[[nodiscard]] constexpr std::uint32_t maximumWetLatency(std::uint32_t rate) noexcept {
  constexpr std::array<std::uint32_t, 8> rates = {44100u,  48000u,  88200u,  96000u,
                                                  176400u, 192000u, 352800u, 384000u};
  // Measured wet impulse peak of the slower topology (MPEG-2 LSF) at each host
  // rate: halfband cascade, rational stage, frame lookahead, work spreading and
  // the reconstruction cascade combined. See resampler-response.md.
  constexpr std::array<std::uint32_t, 8> latencies = {6144u,  6672u,  12414u, 13469u,
                                                      24954u, 27065u, 50034u, 54256u};
  for (std::uint32_t index = 0u; index < rates.size(); ++index) {
    if (rate == rates[index]) {
      return latencies[index];
    }
  }
  return 0u;
}

[[nodiscard]] constexpr std::uint32_t wetAlignmentDelay(std::uint32_t rate,
                                                        Profile profile) noexcept {
  constexpr std::array<std::uint32_t, 8> rates = {44100u,  48000u,  88200u,  96000u,
                                                  176400u, 192000u, 352800u, 384000u};
  // MPEG-1 owns the shorter wet topology, so it is padded up to the fixed per-rate
  // latency above. Both entries are the measured difference, not hand arithmetic.
  constexpr std::array<std::uint32_t, 8> mpeg1Delays = {2207u, 1987u, 4414u,  3972u,
                                                        8828u, 7946u, 17656u, 15891u};
  constexpr std::array<std::uint32_t, 8> mpeg2Delays{};
  for (std::uint32_t index = 0u; index < rates.size(); ++index) {
    if (rate == rates[index]) {
      return profile == Profile::Mpeg1 ? mpeg1Delays[index] : mpeg2Delays[index];
    }
  }
  return 0u;
}

class MP3CodecSimulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MP3CodecSimulatorPluginParams)

public:
  ~MP3CodecSimulatorKernel() override { destroyFftSetups(); }

  void prepare(const PrepareInfo &info) override {
    destroyFftSetups();
    hostRate_ = static_cast<std::uint32_t>(info.sampleRate + 0.5F);
    maxChannels_ = info.maxChannels;
    maxFrames_ = info.maxFrames;
    prepared_ = supportedRate(hostRate_) && maxChannels_ != 0u && maxFrames_ != 0u;
    const HostTopology topology = hostTopology(hostRate_);
    baseRate_ = topology.baseRate;
    halfbandStages_ = topology.halfbandStages;

    inputFifo_.assign(kChannels * kInputCapacity, 0.0F);
    workInput_.assign(kChannels * kInputCapacity, 0.0F);
    decodedFrame_.assign(kChannels * kMaximumFrameSamples, 0.0F);
    outputFrame_.assign(kChannels * kMaximumFrameSamples, 0.0F);
    spectrum_.assign(kMaximumGranules * kChannels * kGranuleSamples, 0.0F);
    decodedSpectrum_.assign(kChannels * kGranuleSamples, 0.0F);
    subbandSlots_.assign(kSlots * kSubbands, 0.0F);
    analysisHistory_.assign(kChannels * 512u, 0.0F);
    analysisOverlap_.assign(kChannels * kSubbands * kSlots, 0.0F);
    synthesisOverlap_.assign(kChannels * kSubbands * kSlots, 0.0F);
    synthesisV_.assign(kChannels * 1024u, 0.0F);
    maskThresholds_.assign(kMaximumGranules * kChannels * kMaximumScaleFactorBands, 1.0e-12F);
    inputHalfbands_.assign(kChannels * kMaximumHalfbandStages, {});
    outputHalfbands_.assign(kChannels * kMaximumHalfbandStages, {});
    downsamplers_.clear();
    upsamplers_.clear();
    downsamplers_.resize(kProfileCount * kChannels);
    upsamplers_.resize(kProfileCount * kChannels);
    prepareRationalStages();
    outputLeft_.assign(kOutputCapacity, 0.0F);
    outputRight_.assign(kOutputCapacity, 0.0F);
    analysisMatrix_.assign(kSubbands * 64u, 0.0F);
    synthesisMatrix_.assign(64u * kSubbands, 0.0F);
    longMdct_.assign(18u * 36u, 0.0F);
    shortMdct_.assign(6u * 12u, 0.0F);
    longWindow_.assign(36u, 0.0F);
    startWindow_.assign(36u, 0.0F);
    stopWindow_.assign(36u, 0.0F);
    shortWindow_.assign(12u, 0.0F);
    fftInput_.assign(1024u, 0.0F);
    fftOutput_.assign(1024u, 0.0F);
    fftWork_.assign(1024u, 0.0F);
    logicalFrame_ = std::make_unique<LogicalFrame>();
    workFrame_ = std::make_unique<LogicalFrame>();

    buildTransformTables();
    fftSetup1024_ = pffft_new_setup(1024, PFFFT_REAL);
    fftSetup512_ = pffft_new_setup(512, PFFFT_REAL);
    prepared_ = prepared_ && fftSetup1024_ != nullptr && fftSetup512_ != nullptr &&
                logicalFrame_ != nullptr && workFrame_ != nullptr;

    // The reported latency includes the maximum measured codec topology delay and the
    // additional MPEG frame used by the deterministic continuation pipeline.
    latencySamples_ = maximumWetLatency(hostRate_);
    dryLeft_.assign(static_cast<std::size_t>(latencySamples_) + 1u, 0.0F);
    dryRight_.assign(static_cast<std::size_t>(latencySamples_) + 1u, 0.0F);
    wetDelayLeft_.assign(static_cast<std::size_t>(latencySamples_) + 1u, 0.0F);
    wetDelayRight_.assign(static_cast<std::size_t>(latencySamples_) + 1u, 0.0F);
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override { return latencySamples_; }

  [[nodiscard]] bool
  copyProductionDiagnostic(mp3::ProductionDiagnosticSnapshot &snapshot) const noexcept {
    if (!prepared_ || logicalFrame_ == nullptr || completedFrames_ == 0u) {
      return false;
    }
    snapshot.completedFrames = completedFrames_;
    snapshot.schedulerDeadlineMisses = schedulerDeadlineMisses_;
    snapshot.outputUnderflowsAfterStartup = outputUnderflowsAfterStartup_;
    snapshot.resamplerBuildCount = resamplerBuildCount_;
    snapshot.frameSamples = completedFrameSamples_;
    snapshot.minimumFrameCompletionMargin =
        minimumFrameCompletionMargin_ == std::numeric_limits<std::uint32_t>::max()
            ? 0u
            : minimumFrameCompletionMargin_;
    snapshot.logical = *logicalFrame_;
    std::copy(outputFrame_.begin(), outputFrame_.end(), snapshot.decodedPcm.begin());
    return true;
  }

  [[nodiscard]] bool renderProductionLogicalFrames(const LogicalFrame *frames,
                                                   std::uint32_t frame_count,
                                                   float *decoded_pcm) noexcept {
    if (!prepared_ || frames == nullptr || frame_count == 0u || decoded_pcm == nullptr) {
      return false;
    }
    clearVector(decodedFrame_);
    clearVector(decodedSpectrum_);
    clearVector(subbandSlots_);
    clearVector(synthesisOverlap_);
    clearVector(synthesisV_);
    for (std::uint32_t frame_index = 0u; frame_index < frame_count; ++frame_index) {
      activeProfile_ = frames[frame_index].profile;
      std::uint32_t bitrate_index = 0u;
      while (bitrate_index + 1u < mp3::kBitratesKbps.size() &&
             mp3::kBitratesKbps[bitrate_index] != frames[frame_index].bitrateKbps) {
        ++bitrate_index;
      }
      policy_ = mp3::profilePolicy(activeProfile_, bitrate_index);
      decodeLogicalFrame(frames[frame_index]);
      float *frame_output = decoded_pcm + frame_index * kChannels * kMaximumFrameSamples;
      for (std::uint32_t channel = 0u; channel < frames[frame_index].channels; ++channel) {
        const float *source = decodedFrame_.data() + channel * kMaximumFrameSamples;
        std::copy(source, source + policy_.frameSamples,
                  frame_output + channel * kMaximumFrameSamples);
      }
    }
    return true;
  }

  void reset() noexcept override {
    clearVector(inputFifo_);
    clearVector(workInput_);
    clearVector(decodedFrame_);
    clearVector(outputFrame_);
    clearVector(spectrum_);
    clearVector(decodedSpectrum_);
    clearVector(subbandSlots_);
    clearVector(analysisHistory_);
    clearVector(analysisOverlap_);
    clearVector(synthesisOverlap_);
    clearVector(synthesisV_);
    clearVector(maskThresholds_);
    resetResamplers();
    clearVector(outputLeft_);
    clearVector(outputRight_);
    clearVector(dryLeft_);
    clearVector(dryRight_);
    clearVector(wetDelayLeft_);
    clearVector(wetDelayRight_);
    inputFill_ = 0u;
    analysisHistoryPosition_ = {0u, 0u};
    outputRead_ = 0u;
    outputWrite_ = 0u;
    outputCount_ = 0u;
    dryPosition_ = 0u;
    wetDelayPosition_ = 0u;
    blockState_ = {BlockType::Long, BlockType::Long};
    previousPsychoEnergy_ = {};
    carriedAttack_ = {};
    attackCarryValid_ = false;
    workAttackFirstIndex_ = 0u;
    budgetState_.reset();
    activeProfile_ = Profile::Mpeg1;
    activeBitrateIndex_ = 2u;
    activeStereoMode_ = 0u;
    activeReservoir_ = true;
    requestedProfile_ = activeProfile_;
    requestedBitrateIndex_ = activeBitrateIndex_;
    requestedStereoMode_ = activeStereoMode_;
    requestedReservoir_ = activeReservoir_;
    controlsInitialized_ = false;
    profileChangedAtBoundary_ = false;
    gainSmoothed_ = 1.0;
    mixSmoothed_ = 1.0;
    smoothingInitialized_ = false;
    completedFrames_ = 0u;
    schedulerDeadlineMisses_ = 0u;
    outputUnderflowsAfterStartup_ = 0u;
    completedFrameSamples_ = 0u;
    frameWorkCodecSamples_ = 0u;
    minimumFrameCompletionMargin_ = std::numeric_limits<std::uint32_t>::max();
    frameWorkStage_ = FrameWorkStage::Idle;
    frameWorkCredit_ = 0u;
    outputFrameReady_ = false;
    outputFrameCursor_ = 0u;
    outputFrameSamples_ = 0u;
    outputFrameChannels_ = 0u;
    outputFrameStarted_ = false;
    configureProfile();
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || frame_count == 0u ||
        frame_count > maxFrames_ || channel_count > maxChannels_) {
      return;
    }

    captureRequestedControls();
    const std::uint32_t channels = channel_count > 1u ? 2u : 1u;
    float *left = audio;
    float *right = channels == 2u ? audio + frame_count : audio;
    const double gainTarget =
        std::exp2(clampFinite(params_.outputGain, -24.0F, 12.0F, 0.0F) / 6.020599913279624);
    const double mixTarget = clampFinite(params_.mix, 0.0F, 100.0F, 100.0F) * 0.01;
    const double smoothing = 1.0 - std::exp(-1.0 / (static_cast<double>(hostRate_) * 0.01));
    if (!smoothingInitialized_) {
      gainSmoothed_ = gainTarget;
      mixSmoothed_ = mixTarget;
      smoothingInitialized_ = true;
    }

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const float dryLeft = sanitize(left[frame]);
      const float dryRight = channels == 2u ? sanitize(right[frame]) : dryLeft;
      const std::size_t drySize = dryLeft_.size();
      const std::size_t dryRead =
          (dryPosition_ + drySize - static_cast<std::size_t>(latencySamples_)) % drySize;
      const float delayedLeft = dryLeft_[dryRead];
      const float delayedRight = dryRight_[dryRead];
      dryLeft_[dryPosition_] = dryLeft;
      dryRight_[dryPosition_] = dryRight;
      dryPosition_ = dryPosition_ + 1u == drySize ? 0u : dryPosition_ + 1u;

      processHostSample(dryLeft, dryRight, channels);

      float wetLeft = 0.0F;
      float wetRight = 0.0F;
      popHostSample(wetLeft, wetRight, channels);
      if (wetDelaySamples_ != 0u) {
        const std::size_t wetSize = wetDelayLeft_.size();
        const std::size_t wetRead =
            (wetDelayPosition_ + wetSize - static_cast<std::size_t>(wetDelaySamples_)) % wetSize;
        const float delayedWetLeft = wetDelayLeft_[wetRead];
        const float delayedWetRight = wetDelayRight_[wetRead];
        wetDelayLeft_[wetDelayPosition_] = wetLeft;
        wetDelayRight_[wetDelayPosition_] = wetRight;
        wetDelayPosition_ = wetDelayPosition_ + 1u == wetSize ? 0u : wetDelayPosition_ + 1u;
        wetLeft = delayedWetLeft;
        wetRight = delayedWetRight;
      }
      gainSmoothed_ += smoothing * (gainTarget - gainSmoothed_);
      mixSmoothed_ += smoothing * (mixTarget - mixSmoothed_);
      const double dryMix = 1.0 - mixSmoothed_;
      left[frame] = sanitize(static_cast<float>(
          (static_cast<double>(delayedLeft) * dryMix + wetLeft * mixSmoothed_) * gainSmoothed_));
      if (channels == 2u) {
        right[frame] = sanitize(static_cast<float>(
            (static_cast<double>(delayedRight) * dryMix + wetRight * mixSmoothed_) *
            gainSmoothed_));
      }
    }
  }

private:
  static void clearVector(std::vector<float> &values) noexcept {
    std::fill(values.begin(), values.end(), 0.0F);
  }

  static float sanitize(float sample) noexcept { return std::isfinite(sample) ? sample : 0.0F; }

  static float clampFinite(float value, float minimum, float maximum, float fallback) noexcept {
    if (!std::isfinite(value)) {
      return fallback;
    }
    if (value < minimum) {
      return minimum;
    }
    return value > maximum ? maximum : value;
  }

  void destroyFftSetups() noexcept {
    if (fftSetup1024_ != nullptr) {
      pffft_destroy_setup(fftSetup1024_);
      fftSetup1024_ = nullptr;
    }
    if (fftSetup512_ != nullptr) {
      pffft_destroy_setup(fftSetup512_);
      fftSetup512_ = nullptr;
    }
  }

  void buildTransformTables() noexcept {
    for (std::uint32_t band = 0u; band < kSubbands; ++band) {
      for (std::uint32_t index = 0u; index < 64u; ++index) {
        analysisMatrix_[band * 64u + index] = static_cast<float>(std::cos(
            std::numbers::pi_v<double> *
            static_cast<double>((2u * band + 1u) * (static_cast<int>(index) - 16)) / 64.0));
      }
    }
    for (std::uint32_t index = 0u; index < 64u; ++index) {
      for (std::uint32_t band = 0u; band < kSubbands; ++band) {
        synthesisMatrix_[index * kSubbands + band] = static_cast<float>(
            std::cos(std::numbers::pi_v<double> *
                     static_cast<double>((16u + index) * (2u * band + 1u)) / 64.0));
      }
    }
    for (std::uint32_t coefficient = 0u; coefficient < 18u; ++coefficient) {
      for (std::uint32_t sample = 0u; sample < 36u; ++sample) {
        longMdct_[coefficient * 36u + sample] = static_cast<float>(
            std::cos(std::numbers::pi_v<double> / 72.0 * static_cast<double>(2u * sample + 19u) *
                     static_cast<double>(2u * coefficient + 1u)));
      }
    }
    for (std::uint32_t coefficient = 0u; coefficient < 6u; ++coefficient) {
      for (std::uint32_t sample = 0u; sample < 12u; ++sample) {
        shortMdct_[coefficient * 12u + sample] = static_cast<float>(
            std::cos(std::numbers::pi_v<double> / 24.0 * static_cast<double>(2u * sample + 7u) *
                     static_cast<double>(2u * coefficient + 1u)));
      }
    }
    for (std::uint32_t sample = 0u; sample < 36u; ++sample) {
      longWindow_[sample] = static_cast<float>(
          std::sin(std::numbers::pi_v<double> / 36.0 * (static_cast<double>(sample) + 0.5)));
      startWindow_[sample] =
          sample < 18u
              ? longWindow_[sample]
              : (sample < 24u
                     ? 1.0F
                     : (sample < 30u
                            ? static_cast<float>(std::sin(std::numbers::pi_v<double> / 12.0 *
                                                          (static_cast<double>(sample) - 17.5)))
                            : 0.0F));
      stopWindow_[sample] =
          sample < 6u
              ? 0.0F
              : (sample < 12u ? static_cast<float>(std::sin(std::numbers::pi_v<double> / 12.0 *
                                                            (static_cast<double>(sample) - 5.5)))
                              : (sample < 18u ? 1.0F : longWindow_[sample]));
    }
    for (std::uint32_t sample = 0u; sample < 12u; ++sample) {
      shortWindow_[sample] = static_cast<float>(
          std::sin(std::numbers::pi_v<double> / 12.0 * (static_cast<double>(sample) + 0.5)));
    }
  }

  void captureRequestedControls() noexcept {
    requestedProfile_ = params_.codecRate >= 0.5F ? Profile::Mpeg1 : Profile::Mpeg2Lsf;
    float bitrate = clampFinite(params_.bitrate, 0.0F, 11.0F, 2.0F);
    requestedBitrateIndex_ = static_cast<std::uint32_t>(bitrate + 0.5F);
    const std::uint32_t maximum = requestedProfile_ == Profile::Mpeg1 ? 11u : 7u;
    if (requestedBitrateIndex_ > maximum) {
      requestedBitrateIndex_ = maximum;
    }
    requestedStereoMode_ = params_.stereoMode >= 0.5F ? 1u : 0u;
    requestedReservoir_ = params_.bitReservoir >= 0.5F;
    if (!controlsInitialized_) {
      applyFrameControls();
    }
  }

  void applyFrameControls() noexcept {
    const bool profileChanged = requestedProfile_ != activeProfile_;
    const bool bitrateChanged = requestedBitrateIndex_ != activeBitrateIndex_;
    const bool stereoModeChanged = requestedStereoMode_ != activeStereoMode_;
    const bool reservoirChanged = requestedReservoir_ != activeReservoir_;
    if (!profileChanged && !bitrateChanged && !stereoModeChanged && !reservoirChanged) {
      controlsInitialized_ = true;
      profileChangedAtBoundary_ = false;
      return;
    }
    activeProfile_ = requestedProfile_;
    activeBitrateIndex_ = requestedBitrateIndex_;
    activeStereoMode_ = requestedStereoMode_;
    activeReservoir_ = requestedReservoir_;
    controlsInitialized_ = true;
    profileChangedAtBoundary_ = profileChanged;
    if (profileChanged) {
      clearCodecStateForProfileChange();
      budgetState_.reset();
      configureProfile();
    } else {
      if (bitrateChanged) {
        budgetState_.resetPadding();
        policy_ = mp3::profilePolicy(activeProfile_, activeBitrateIndex_);
      }
      if (reservoirChanged) {
        budgetState_.clearReservoir();
      }
      budgetState_.clampReservoir(activeProfile_);
    }
  }

  void configureProfile() noexcept {
    policy_ = mp3::profilePolicy(activeProfile_, activeBitrateIndex_);
    wetDelaySamples_ = wetAlignmentDelay(hostRate_, activeProfile_);
    activeResamplerIndex_ = profileIndex(activeProfile_);
  }

  // Both profile topologies are designed up front so the runtime Codec Rate switch
  // only selects a prepared stage and resets it; prepare() owns every allocation.
  void prepareRationalStages() noexcept {
    resamplerBuildCount_ = 0u;
    rationalActive_ = {false, false};
    if (baseRate_ == 0u) {
      return;
    }
    for (const Profile profile : {Profile::Mpeg1, Profile::Mpeg2Lsf}) {
      const std::uint32_t index = profileIndex(profile);
      const std::uint32_t codec_rate = mp3::profilePolicy(profile, 0u).sampleRate;
      if (codec_rate == baseRate_) {
        continue;
      }
      const double cutoff = resamplerCutoffHz(profile);
      for (std::uint32_t channel = 0u; channel < kChannels; ++channel) {
        downsamplers_[index * kChannels + channel].prepare(baseRate_, codec_rate, cutoff);
        upsamplers_[index * kChannels + channel].prepare(codec_rate, baseRate_, cutoff);
      }
      rationalActive_[index] = true;
      resamplerBuildCount_ += 2u;
    }
  }

  void resetResamplers() noexcept {
    for (dsp::Halfband2x &stage : inputHalfbands_) {
      stage.reset();
    }
    for (dsp::Halfband2x &stage : outputHalfbands_) {
      stage.reset();
    }
    resetRationalStages();
  }

  // Both profile banks are cleared so the newly selected stage always starts from
  // a defined state, independent of the order in which the profile switch runs.
  void resetRationalStages() noexcept {
    for (dsp::RationalResampler &stage : downsamplers_) {
      stage.reset();
    }
    for (dsp::RationalResampler &stage : upsamplers_) {
      stage.reset();
    }
  }

  [[nodiscard]] dsp::Halfband2x &inputHalfband(std::uint32_t channel,
                                               std::uint32_t stage) noexcept {
    return inputHalfbands_[channel * kMaximumHalfbandStages + stage];
  }

  [[nodiscard]] dsp::Halfband2x &outputHalfband(std::uint32_t channel,
                                                std::uint32_t stage) noexcept {
    return outputHalfbands_[channel * kMaximumHalfbandStages + stage];
  }

  [[nodiscard]] dsp::RationalResampler &downsampler(std::uint32_t channel) noexcept {
    return downsamplers_[activeResamplerIndex_ * kChannels + channel];
  }

  [[nodiscard]] dsp::RationalResampler &upsampler(std::uint32_t channel) noexcept {
    return upsamplers_[activeResamplerIndex_ * kChannels + channel];
  }

  // Host rate -> base rate halfband cascade -> optional rational stage -> codec rate.
  void processHostSample(float left, float right, std::uint32_t channels) noexcept {
    float baseLeft = left;
    float baseRight = right;
    for (std::uint32_t stage = 0u; stage < halfbandStages_; ++stage) {
      float decimatedLeft = 0.0F;
      float decimatedRight = 0.0F;
      const bool ready = inputHalfband(0u, stage).decimate(baseLeft, decimatedLeft);
      inputHalfband(1u, stage).decimate(baseRight, decimatedRight);
      if (!ready) {
        return;
      }
      baseLeft = decimatedLeft;
      baseRight = decimatedRight;
    }
    if (!rationalActive_[activeResamplerIndex_]) {
      acceptCodecSample(baseLeft, baseRight, channels);
      return;
    }
    std::array<float, dsp::RationalResampler::kMaximumOutputs> codecLeft{};
    std::array<float, dsp::RationalResampler::kMaximumOutputs> codecRight{};
    const std::size_t count = downsampler(0u).push(baseLeft, codecLeft);
    const std::size_t countRight = downsampler(1u).push(baseRight, codecRight);
    for (std::size_t index = 0u; index < count; ++index) {
      acceptCodecSample(codecLeft[index], index < countRight ? codecRight[index] : codecLeft[index],
                        channels);
    }
  }

  void clearCodecStateForProfileChange() noexcept {
    inputFill_ = 0u;
    // A Codec Rate change reinitialises the whole resampler chain, not only the
    // rational stages: the halfband cascade sits in front of them and would
    // otherwise carry pre-switch history into the new topology.
    resetResamplers();
    analysisHistoryPosition_ = {0u, 0u};
    blockState_ = {BlockType::Long, BlockType::Long};
    previousPsychoEnergy_ = {};
    carriedAttack_ = {};
    attackCarryValid_ = false;
    workAttackFirstIndex_ = 0u;
    clearVector(inputFifo_);
    clearVector(workInput_);
    clearVector(decodedFrame_);
    clearVector(analysisHistory_);
    clearVector(analysisOverlap_);
    clearVector(synthesisOverlap_);
    clearVector(synthesisV_);
    clearVector(wetDelayLeft_);
    clearVector(wetDelayRight_);
    outputRead_ = 0u;
    outputWrite_ = 0u;
    outputCount_ = 0u;
    wetDelayPosition_ = 0u;
    frameWorkStage_ = FrameWorkStage::Idle;
    frameWorkCredit_ = 0u;
    outputFrameReady_ = false;
    outputFrameCursor_ = 0u;
    outputFrameSamples_ = 0u;
    outputFrameChannels_ = 0u;
    frameWorkCodecSamples_ = 0u;
    outputFrameStarted_ = false;
  }

  void acceptCodecSample(float left, float right, std::uint32_t channels) noexcept {
    emitOutputCodecSample();
    // The valve threshold is the frame window the scheduler actually consumes, not the
    // raw buffer capacity. MPEG-2 LSF needs only 576 + 576 = 1152 of the 1728-sample
    // capacity, so a capacity-based valve would let the FIFO grow 576 samples past the
    // window and startFrameWork() would silently discard [needed, inputFill_) when it
    // rewinds inputFill_ to the lookahead. Gate on `needed` and count the drop once.
    const std::uint32_t needed = policy_.frameSamples + kLookaheadSamples;
    if (inputFill_ < needed) {
      inputFifo_[inputFill_] = left;
      inputFifo_[kInputCapacity + inputFill_] = channels == 2u ? right : left;
      ++inputFill_;
    } else {
      // Deterministic safety valve: the work pipeline missed its deadline and the
      // frame window is already full. Drop the incoming codec sample (counted once)
      // instead of overrunning the window, and keep driving the pipeline below so a
      // later sample can promote the pending frame.
      ++schedulerDeadlineMisses_;
    }
    if (frameWorkStage_ != FrameWorkStage::Idle && frameWorkStage_ != FrameWorkStage::Ready) {
      advanceFrameWork();
    }
    if (inputFill_ < needed) {
      return;
    }
    const bool promoted = frameWorkStage_ == FrameWorkStage::Ready;
    if (promoted) {
      promoteCompletedFrame();
    }
    if ((promoted && profileChangedAtBoundary_) || inputFill_ < needed) {
      return;
    }
    if (frameWorkStage_ == FrameWorkStage::Idle) {
      startFrameWork(channels);
      advanceFrameWork();
    }
  }

  [[nodiscard]] bool detectAttack(const float *input, std::uint32_t channel) noexcept {
    std::array<double, 6> energy{};
    double highFrequency = 0.0;
    float previous = input[0u];
    for (std::uint32_t sample = 0u; sample < kGranuleSamples; ++sample) {
      const double value = input[sample];
      energy[sample / 96u] += value * value;
      const double difference = static_cast<double>(input[sample] - previous);
      highFrequency += difference * difference;
      previous = input[sample];
    }
    double largestRise = 0.0;
    for (std::uint32_t window = 1u; window < energy.size(); ++window) {
      const double reference = energy[window - 1u] > 1.0e-12 ? energy[window - 1u] : 1.0e-12;
      const double rise = energy[window] / reference;
      if (rise > largestRise) {
        largestRise = rise;
      }
    }
    const double total =
        energy[0u] + energy[1u] + energy[2u] + energy[3u] + energy[4u] + energy[5u];
    const double old =
        previousPsychoEnergy_[channel] > 1.0e-12 ? previousPsychoEnergy_[channel] : 1.0e-12;
    previousPsychoEnergy_[channel] = total;
    return total > 1.0e-9 &&
           (largestRise >= 6.0 || total / old >= 4.0 || highFrequency > total * 1.75);
  }

  [[nodiscard]] BlockType selectBlockType(std::uint32_t channel, bool current_attack,
                                          bool next_attack) noexcept {
    const BlockType next = mp3::nextBlockType(blockState_[channel], current_attack, next_attack);
    blockState_[channel] = next;
    return next;
  }

  void analyzePsychoacoustics(const float *input, std::uint32_t granule,
                              std::uint32_t channel) noexcept {
    const std::uint32_t fftSize = activeProfile_ == Profile::Mpeg1 ? 1024u : 512u;
    for (std::uint32_t sample = 0u; sample < fftSize; ++sample) {
      const double window = 0.5 - 0.5 * std::cos(2.0 * std::numbers::pi_v<double> *
                                                 (static_cast<double>(sample) + 0.5) / fftSize);
      fftInput_[sample] = sanitize(static_cast<float>(input[sample] * window));
    }
    PFFFT_Setup *setup = activeProfile_ == Profile::Mpeg1 ? fftSetup1024_ : fftSetup512_;
    pffft_transform_ordered(setup, fftInput_.data(), fftOutput_.data(), fftWork_.data(),
                            PFFFT_FORWARD);
    const auto &boundaries =
        activeProfile_ == Profile::Mpeg1 ? mp3::kMpeg1LongBoundaries : mp3::kMpeg2LongBoundaries;
    std::array<double, kMaximumScaleFactorBands> energy{};
    std::array<double, kMaximumScaleFactorBands> logEnergy{};
    std::array<std::uint32_t, kMaximumScaleFactorBands> count{};
    const std::uint32_t bins = fftSize / 2u;
    for (std::uint32_t bin = 0u; bin <= bins; ++bin) {
      const double real =
          bin == 0u ? fftOutput_[0u] : (bin == bins ? fftOutput_[1u] : fftOutput_[2u * bin]);
      const double imaginary = bin == 0u || bin == bins ? 0.0 : fftOutput_[2u * bin + 1u];
      const double power = real * real + imaginary * imaginary + 1.0e-30;
      const std::uint32_t line = bin == bins ? 575u : (bin * 576u) / bins;
      std::uint32_t band = 0u;
      while (band + 1u < boundaries.size() && line >= boundaries[band + 1u]) {
        ++band;
      }
      if (band < kMaximumScaleFactorBands) {
        energy[band] += power;
        logEnergy[band] += std::log(power);
        ++count[band];
      }
    }
    float *thresholds =
        maskThresholds_.data() + (granule * kChannels + channel) * kMaximumScaleFactorBands;
    const double nmr = std::pow(10.0, policy_.initialNmrDb / 10.0);
    for (std::uint32_t band = 0u; band < kMaximumScaleFactorBands; ++band) {
      const double divisor = count[band] != 0u ? count[band] : 1u;
      const double arithmetic = energy[band] / divisor + 1.0e-30;
      const double geometric = std::exp(logEnergy[band] / divisor);
      double flatness = geometric / arithmetic;
      if (flatness < 0.0) {
        flatness = 0.0;
      }
      if (flatness > 1.0) {
        flatness = 1.0;
      }
      double spread = energy[band];
      if (band != 0u) {
        spread += energy[band - 1u] * 0.18;
      }
      if (band + 1u < kMaximumScaleFactorBands) {
        spread += energy[band + 1u] * 0.08;
      }
      const double tonalFactor = 0.025 + flatness * 0.11;
      const double ath = 1.0e-12 * (1.0 + static_cast<double>(band * band));
      thresholds[band] = static_cast<float>((spread * tonalFactor + ath) * nmr);
    }
  }

  void analyzePolyphaseSlot(std::uint32_t channel, const float *input, float *output) noexcept {
    float *history = analysisHistory_.data() + channel * 512u;
    std::uint32_t &position = analysisHistoryPosition_[channel];
    for (std::uint32_t sample = 0u; sample < 32u; ++sample) {
      history[position] = input[sample];
      position = position + 1u == 512u ? 0u : position + 1u;
    }
    std::array<float, 64> folded{};
    for (std::uint32_t index = 0u; index < 512u; ++index) {
      const std::uint32_t newestFirst = (position + 511u - index) & 511u;
      folded[index & 63u] += history[newestFirst] * mp3::kAnalysisWindow[index];
    }
    for (std::uint32_t band = 0u; band < kSubbands; ++band) {
      double sum = 0.0;
      const float *matrix = analysisMatrix_.data() + band * 64u;
      for (std::uint32_t index = 0u; index < 64u; ++index) {
        sum += static_cast<double>(folded[index]) * matrix[index];
      }
      output[band] = sanitize(static_cast<float>(sum));
    }
  }

  [[nodiscard]] const float *windowFor(BlockType block) const noexcept {
    if (block == BlockType::Start) {
      return startWindow_.data();
    }
    if (block == BlockType::Stop) {
      return stopWindow_.data();
    }
    return longWindow_.data();
  }

  void reorderShort(const float *native, float *ordered) const noexcept {
    const auto &boundaries =
        activeProfile_ == Profile::Mpeg1 ? mp3::kMpeg1ShortBoundaries : mp3::kMpeg2ShortBoundaries;
    std::uint32_t write = 0u;
    for (std::uint32_t sfb = 0u; sfb + 1u < boundaries.size(); ++sfb) {
      for (std::uint32_t window = 0u; window < 3u; ++window) {
        for (std::uint32_t frequency = boundaries[sfb]; frequency < boundaries[sfb + 1u];
             ++frequency) {
          ordered[write++] = native[(frequency / 6u) * 18u + (frequency % 6u) * 3u + window];
        }
      }
    }
  }

  void unreorderShort(const float *ordered, float *native) const noexcept {
    const auto &boundaries =
        activeProfile_ == Profile::Mpeg1 ? mp3::kMpeg1ShortBoundaries : mp3::kMpeg2ShortBoundaries;
    std::uint32_t read = 0u;
    for (std::uint32_t sfb = 0u; sfb + 1u < boundaries.size(); ++sfb) {
      for (std::uint32_t window = 0u; window < 3u; ++window) {
        for (std::uint32_t frequency = boundaries[sfb]; frequency < boundaries[sfb + 1u];
             ++frequency) {
          native[(frequency / 6u) * 18u + (frequency % 6u) * 3u + window] = ordered[read++];
        }
      }
    }
  }

  void hybridAnalysis(std::uint32_t channel, BlockType block, float *output) noexcept {
    float *overlap = analysisOverlap_.data() + channel * kSubbands * kSlots;
    std::array<float, 576> native{};
    std::array<float, 36> time{};
    for (std::uint32_t band = 0u; band < kSubbands; ++band) {
      float *old = overlap + band * kSlots;
      for (std::uint32_t slot = 0u; slot < kSlots; ++slot) {
        time[slot] = old[slot];
        float sample = subbandSlots_[slot * kSubbands + band];
        if ((band & 1u) != 0u && (slot & 1u) != 0u) {
          sample = -sample;
        }
        time[18u + slot] = sample;
        old[slot] = time[18u + slot];
      }
      if (block == BlockType::Short) {
        for (std::uint32_t window = 0u; window < 3u; ++window) {
          for (std::uint32_t coefficient = 0u; coefficient < 6u; ++coefficient) {
            double sum = 0.0;
            for (std::uint32_t sample = 0u; sample < 12u; ++sample) {
              const std::uint32_t position = 6u + window * 6u + sample;
              sum += static_cast<double>(time[position] * shortWindow_[sample]) *
                     shortMdct_[coefficient * 12u + sample];
            }
            native[band * 18u + coefficient * 3u + window] =
                sanitize(static_cast<float>(sum * 3.0));
          }
        }
      } else {
        const float *window = windowFor(block);
        for (std::uint32_t coefficient = 0u; coefficient < 18u; ++coefficient) {
          double sum = 0.0;
          for (std::uint32_t sample = 0u; sample < 36u; ++sample) {
            sum += static_cast<double>(time[sample] * window[sample]) *
                   longMdct_[coefficient * 36u + sample];
          }
          native[band * 18u + coefficient] = sanitize(static_cast<float>(sum));
        }
      }
    }
    if (block == BlockType::Short) {
      reorderShort(native.data(), output);
    } else {
      std::copy(native.begin(), native.end(), output);
      mp3::applyAliasReduction(output, true);
    }
  }

  [[nodiscard]] std::uint32_t scaleFactorIndex(BlockType block, std::uint32_t line) const noexcept {
    if (block != BlockType::Short) {
      const auto &boundaries =
          activeProfile_ == Profile::Mpeg1 ? mp3::kMpeg1LongBoundaries : mp3::kMpeg2LongBoundaries;
      std::uint32_t band = 0u;
      while (band + 1u < boundaries.size() && line >= boundaries[band + 1u]) {
        ++band;
      }
      return band;
    }
    const auto &boundaries =
        activeProfile_ == Profile::Mpeg1 ? mp3::kMpeg1ShortBoundaries : mp3::kMpeg2ShortBoundaries;
    std::uint32_t cursor = 0u;
    for (std::uint32_t band = 0u; band + 1u < boundaries.size(); ++band) {
      const std::uint32_t width = boundaries[band + 1u] - boundaries[band];
      for (std::uint32_t window = 0u; window < 3u; ++window) {
        if (line < cursor + width) {
          return band * 3u + window;
        }
        cursor += width;
      }
    }
    return 0u;
  }

  [[nodiscard]] bool codedLine(BlockType block, std::uint32_t line) const noexcept {
    return mp3::codedLine(activeProfile_, block, line, policy_.cutoffLine);
  }

  [[nodiscard]] std::uint32_t scaleFactorBits(const GranuleChannel &logical) const noexcept {
    return mp3::scaleFactorBits(activeProfile_, logical.blockType, logical.scalefactorCount);
  }

  bool quantizeCandidateValues(const float *input, GranuleChannel &logical,
                               std::uint8_t global_gain) const noexcept {
    bool rangeExceeded = false;
    for (std::uint32_t line = 0u; line < kGranuleSamples; ++line) {
      std::int32_t code = 0;
      if (codedLine(logical.blockType, line)) {
        const std::uint32_t factor = scaleFactorIndex(logical.blockType, line);
        const double step = std::exp2((static_cast<double>(global_gain) - 210.0) * 0.25 -
                                      static_cast<double>(logical.scalefactors[factor]) * 0.5);
        const double value = input[line];
        const double magnitude = value < 0.0 ? -value : value;
        double mapped = std::pow(magnitude / step, 0.75);
        if (mapped > 8191.0) {
          rangeExceeded = true;
          mapped = 8191.0;
        }
        code = static_cast<std::int32_t>(mapped + 0.4054);
        if (value < 0.0) {
          code = -code;
        }
      }
      logical.quantized[line] = code;
    }
    return rangeExceeded;
  }

  std::uint32_t finishQuantizeCandidate(GranuleChannel &logical,
                                        bool range_exceeded) const noexcept {
    if (range_exceeded) {
      return std::numeric_limits<std::uint32_t>::max();
    }
    logical.huffman = mp3::selectHuffmanRegions(logical.quantized.data(), activeProfile_,
                                                logical.blockType, policy_.cutoffLine);
    return logical.huffman.totalBits();
  }

  std::uint32_t quantizeCandidate(const float *input, GranuleChannel &logical,
                                  std::uint8_t global_gain) const noexcept {
    return finishQuantizeCandidate(logical, quantizeCandidateValues(input, logical, global_gain));
  }

  [[nodiscard]] double aggregateDistortion(const float *input,
                                           const GranuleChannel &logical) const noexcept {
    double distortion = 0.0;
    for (std::uint32_t line = 0u; line < kGranuleSamples; ++line) {
      const std::uint32_t factor = scaleFactorIndex(logical.blockType, line);
      const float restored =
          codedLine(logical.blockType, line) ? mp3::requantizeLine(logical, line, factor) : 0.0F;
      const double error = static_cast<double>(input[line]) - restored;
      distortion += error * error;
    }
    return distortion;
  }

  [[nodiscard]] std::uint32_t selectWorstScaleFactor(const float *input,
                                                     const GranuleChannel &logical,
                                                     std::uint32_t granule,
                                                     std::uint32_t channel) const noexcept {
    const mp3::ScaleFactorLayout layout = mp3::scaleFactorLayout(activeProfile_, logical.blockType);
    std::uint32_t worstFactor = logical.scalefactorCount;
    double worstRatio = 1.0;
    for (std::uint32_t factor = 0u; factor < logical.scalefactorCount; ++factor) {
      const std::uint32_t maximum = mp3::scaleFactorMaximum(layout, factor);
      if (logical.scalefactors[factor] >= maximum) {
        continue;
      }
      double distortion = 0.0;
      for (std::uint32_t line = 0u; line < kGranuleSamples; ++line) {
        if (scaleFactorIndex(logical.blockType, line) == factor) {
          const float restored = mp3::requantizeLine(logical, line, factor);
          const double error = static_cast<double>(input[line]) - restored;
          distortion += error * error;
        }
      }
      const std::uint32_t psychoBand = logical.blockType == BlockType::Short ? factor / 3u : factor;
      const double target =
          maskThresholds_[(granule * kChannels + channel) * kMaximumScaleFactorBands + psychoBand] +
          1.0e-20;
      const double ratio = distortion / target;
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worstFactor = factor;
      }
    }
    return worstFactor;
  }

  void initializeScaleFactors(const float *input, std::uint32_t granule, std::uint32_t channel,
                              GranuleChannel &logical) const noexcept {
    const mp3::ScaleFactorLayout layout = mp3::scaleFactorLayout(activeProfile_, logical.blockType);
    logical.scalefactorCount = layout.count;
    logical.scalefacCompress = layout.scalefacCompress;
    const float *threshold =
        maskThresholds_.data() + (granule * kChannels + channel) * kMaximumScaleFactorBands;
    std::array<double, mp3::kMaximumScaleFactors> energies{};
    std::array<std::uint32_t, mp3::kMaximumScaleFactors> counts{};
    for (std::uint32_t line = 0u; line < kGranuleSamples; ++line) {
      if (!codedLine(logical.blockType, line)) {
        continue;
      }
      const std::uint32_t factor = scaleFactorIndex(logical.blockType, line);
      energies[factor] += static_cast<double>(input[line]) * input[line];
      ++counts[factor];
    }
    for (std::uint32_t factor = 0u; factor < logical.scalefactorCount; ++factor) {
      const std::uint32_t psychoBand = logical.blockType == BlockType::Short ? factor / 3u : factor;
      const double target =
          threshold[psychoBand] * (counts[factor] != 0u ? counts[factor] : 1u) + 1.0e-20;
      double ratio = energies[factor] / target;
      if (ratio < 1.0) {
        ratio = 1.0;
      }
      std::uint32_t value = static_cast<std::uint32_t>(std::log2(ratio) * 0.25);
      const std::uint32_t maximum = mp3::scaleFactorMaximum(layout, factor);
      if (value > maximum) {
        value = maximum;
      }
      logical.scalefactors[factor] = static_cast<std::uint8_t>(value);
    }
  }

  void applyScaleFactorSelection(LogicalFrame &frame, std::uint32_t channel) const noexcept {
    if (frame.profile != Profile::Mpeg1 || frame.granules != 2u ||
        frame.data[0u][channel].blockType != BlockType::Long ||
        frame.data[1u][channel].blockType != BlockType::Long) {
      return;
    }
    constexpr std::array<std::uint8_t, 5> kGroupBoundaries{0u, 6u, 11u, 16u, 21u};
    const GranuleChannel &first = frame.data[0u][channel];
    GranuleChannel &second = frame.data[1u][channel];
    for (std::uint32_t group = 0u; group < 4u; ++group) {
      const std::uint32_t begin = kGroupBoundaries[group];
      const std::uint32_t end = kGroupBoundaries[group + 1u];
      bool identical = true;
      for (std::uint32_t factor = begin; factor < end && factor < second.scalefactorCount;
           ++factor) {
        if (factor >= first.scalefactorCount ||
            first.scalefactors[factor] != second.scalefactors[factor]) {
          identical = false;
          break;
        }
      }
      if (!identical || begin >= second.scalefactorCount) {
        continue;
      }
      frame.scfsi[channel * 4u + group] = 1u;
      for (std::uint32_t factor = begin; factor < end && factor < second.scalefactorCount;
           ++factor) {
        second.part2Length =
            static_cast<std::uint16_t>(second.part2Length - (factor < 11u ? 4u : 3u));
      }
    }
  }

  void accumulateMidSideDecisionChunk(const LogicalFrame &frame) noexcept {
    constexpr std::uint32_t kLinesPerChunk = 288u;
    const float *left = spectrum_.data() + midSideGranule_ * kChannels * kGranuleSamples;
    const float *right = left + kGranuleSamples;
    const std::uint32_t end = midSideLine_ + kLinesPerChunk < kGranuleSamples
                                  ? midSideLine_ + kLinesPerChunk
                                  : kGranuleSamples;
    for (std::uint32_t line = midSideLine_; line < end; line += 2u) {
      const auto estimate = [](float value) noexcept {
        const double magnitude = value < 0.0F ? -value : value;
        std::int32_t code = static_cast<std::int32_t>(std::pow(magnitude * 4.0, 0.75) + 0.5);
        if (code > 8191) {
          code = 8191;
        }
        return value < 0.0F ? -code : code;
      };
      const std::int32_t l0 = estimate(left[line]);
      const std::int32_t l1 = estimate(left[line + 1u]);
      const std::int32_t r0 = estimate(right[line]);
      const std::int32_t r1 = estimate(right[line + 1u]);
      midSideLrBits_ += mp3::huffmanPairLength(31u, l0, l1) + mp3::huffmanPairLength(31u, r0, r1);
      const float m0 = static_cast<float>((left[line] + right[line]) * kInverseSqrtTwo);
      const float m1 = static_cast<float>((left[line + 1u] + right[line + 1u]) * kInverseSqrtTwo);
      const float s0 = static_cast<float>((left[line] - right[line]) * kInverseSqrtTwo);
      const float s1 = static_cast<float>((left[line + 1u] - right[line + 1u]) * kInverseSqrtTwo);
      midSideMsBits_ += mp3::huffmanPairLength(31u, estimate(m0), estimate(m1)) +
                        mp3::huffmanPairLength(31u, estimate(s0), estimate(s1));
    }
    midSideLine_ = end;
    if (midSideLine_ == kGranuleSamples) {
      midSideLine_ = 0u;
      ++midSideGranule_;
    }
    if (midSideGranule_ == frame.granules) {
      workFrame_->midSide = midSideMsBits_ < midSideLrBits_;
      workGranule_ = 0u;
      frameWorkStage_ = FrameWorkStage::MidSideApply;
    }
  }

  void applyMidSide(float *left, float *right) noexcept {
    for (std::uint32_t line = 0u; line < kGranuleSamples; ++line) {
      const double l = left[line];
      const double r = right[line];
      left[line] = sanitize(static_cast<float>((l + r) * kInverseSqrtTwo));
      right[line] = sanitize(static_cast<float>((l - r) * kInverseSqrtTwo));
    }
  }

  void decodeMidSide(float *mid, float *side) noexcept {
    for (std::uint32_t line = 0u; line < kGranuleSamples; ++line) {
      const double m = mid[line];
      const double s = side[line];
      mid[line] = sanitize(static_cast<float>((m + s) * kInverseSqrtTwo));
      side[line] = sanitize(static_cast<float>((m - s) * kInverseSqrtTwo));
    }
  }

  void hybridSynthesis(std::uint32_t channel, const GranuleChannel &logical,
                       float *spectrum) noexcept {
    std::array<float, 576> native{};
    if (logical.blockType == BlockType::Short) {
      unreorderShort(spectrum, native.data());
    } else {
      std::copy(spectrum, spectrum + kGranuleSamples, native.begin());
      mp3::applyAliasReduction(native.data(), false);
    }
    float *overlap = synthesisOverlap_.data() + channel * kSubbands * kSlots;
    std::array<float, 36> time{};
    for (std::uint32_t band = 0u; band < kSubbands; ++band) {
      std::fill(time.begin(), time.end(), 0.0F);
      if (logical.blockType == BlockType::Short) {
        for (std::uint32_t window = 0u; window < 3u; ++window) {
          for (std::uint32_t sample = 0u; sample < 12u; ++sample) {
            double sum = 0.0;
            for (std::uint32_t coefficient = 0u; coefficient < 6u; ++coefficient) {
              sum += static_cast<double>(native[band * 18u + coefficient * 3u + window]) *
                     shortMdct_[coefficient * 12u + sample];
            }
            const std::uint32_t position = 6u + window * 6u + sample;
            // TDAC: the cos-kernel autocorrelation sums to N/4 (3 for N=12) and the
            // analysis side applies x3, so /9 restores unity through overlap-add;
            // /18 halved the whole wet path.
            time[position] += sanitize(static_cast<float>(sum / 9.0 * shortWindow_[sample]));
          }
        }
      } else {
        const float *window = windowFor(logical.blockType);
        for (std::uint32_t sample = 0u; sample < 36u; ++sample) {
          double sum = 0.0;
          for (std::uint32_t coefficient = 0u; coefficient < 18u; ++coefficient) {
            sum += static_cast<double>(native[band * 18u + coefficient]) *
                   longMdct_[coefficient * 36u + sample];
          }
          // TDAC: the cos-kernel autocorrelation sums to N/4 (9 for N=36), so /9
          // restores unity through overlap-add; /18 halved the whole wet path.
          time[sample] = sanitize(static_cast<float>(sum / 9.0 * window[sample]));
        }
      }
      float *old = overlap + band * kSlots;
      for (std::uint32_t slot = 0u; slot < kSlots; ++slot) {
        float sample = sanitize(old[slot] + time[slot]);
        if ((band & 1u) != 0u && (slot & 1u) != 0u) {
          sample = -sample;
        }
        subbandSlots_[slot * kSubbands + band] = sample;
        old[slot] = time[18u + slot];
      }
    }
  }

  void synthesizePolyphaseSlot(std::uint32_t channel, const float *subband,
                               float *output) noexcept {
    float *v = synthesisV_.data() + channel * 1024u;
    for (std::uint32_t index = 1024u; index-- > 64u;) {
      v[index] = v[index - 64u];
    }
    for (std::uint32_t index = 0u; index < 64u; ++index) {
      double sum = 0.0;
      const float *matrix = synthesisMatrix_.data() + index * kSubbands;
      for (std::uint32_t band = 0u; band < kSubbands; ++band) {
        sum += static_cast<double>(subband[band]) * matrix[band];
      }
      v[index] = sanitize(static_cast<float>(sum));
    }
    for (std::uint32_t sample = 0u; sample < 32u; ++sample) {
      double sum = 0.0;
      for (std::uint32_t block = 0u; block < 8u; ++block) {
        const std::uint32_t first = block * 64u + sample;
        const std::uint32_t second = first + 32u;
        sum += static_cast<double>(v[block * 128u + sample]) * (32.0 * mp3::kAnalysisWindow[first]);
        sum += static_cast<double>(v[block * 128u + 96u + sample]) *
               (32.0 * mp3::kAnalysisWindow[second]);
      }
      output[sample] = sanitize(static_cast<float>(sum));
    }
  }

  void decodeLogicalFrame(const LogicalFrame &frame) noexcept {
    for (std::uint32_t granule = 0u; granule < frame.granules; ++granule) {
      for (std::uint32_t channel = 0u; channel < frame.channels; ++channel) {
        float *decoded = decodedSpectrum_.data() + channel * kGranuleSamples;
        mp3::decodeLogicalSpectrum(frame.data[granule][channel], frame.profile, policy_.cutoffLine,
                                   decoded);
      }
      if (frame.midSide && frame.channels == 2u) {
        decodeMidSide(decodedSpectrum_.data(), decodedSpectrum_.data() + kGranuleSamples);
      }
      for (std::uint32_t channel = 0u; channel < frame.channels; ++channel) {
        hybridSynthesis(channel, frame.data[granule][channel],
                        decodedSpectrum_.data() + channel * kGranuleSamples);
        float *decoded =
            decodedFrame_.data() + channel * kMaximumFrameSamples + granule * kGranuleSamples;
        for (std::uint32_t slot = 0u; slot < kSlots; ++slot) {
          synthesizePolyphaseSlot(channel, subbandSlots_.data() + slot * kSubbands,
                                  decoded + slot * 32u);
        }
      }
    }
  }

  [[nodiscard]] std::uint32_t frameWorkCost() const noexcept {
    switch (frameWorkStage_) {
    case FrameWorkStage::Psychoacoustics:
      return 4u;
    case FrameWorkStage::HybridAnalysis:
      return 2u;
    case FrameWorkStage::HybridSynthesis:
    case FrameWorkStage::DecodeSpectrum:
    case FrameWorkStage::QuantizePassSelect:
      return 2u;
    case FrameWorkStage::MidSideDecision:
      return 7u;
    case FrameWorkStage::QuantizeInitialize:
      return 4u;
    case FrameWorkStage::QuantizeBinaryMap:
      return 5u;
    case FrameWorkStage::QuantizeBinaryHuffman:
      return 7u;
    case FrameWorkStage::QuantizeFinalMap:
      return 7u;
    case FrameWorkStage::QuantizePassMap:
    case FrameWorkStage::QuantizeRestoreMap:
      return 4u;
    case FrameWorkStage::QuantizeFinalHuffman:
      return 8u;
    case FrameWorkStage::QuantizeFinalSpacing:
      return 7u;
    case FrameWorkStage::QuantizePassHuffman:
    case FrameWorkStage::QuantizeRestoreHuffman:
      return 5u;
    case FrameWorkStage::QuantizeInitialDistortion:
      return 3u;
    default:
      return 1u;
    }
  }

  void startFrameWork(std::uint32_t channels) noexcept {
    LogicalFrame &frame = *workFrame_;
    frame = {};
    frame.profile = activeProfile_;
    frame.channels = static_cast<std::uint8_t>(channels);
    frame.granules = static_cast<std::uint8_t>(policy_.granules);
    frame.bitrateKbps = policy_.bitrateKbps;
    frame.budget =
        budgetState_.beginFrame(activeProfile_, policy_.bitrateKbps, channels, activeReservoir_);
    workChannelBudget_ =
        (frame.budget.physicalMainDataAreaBits + frame.budget.reservoirBeforeBits) /
        (frame.granules * frame.channels);
    const std::uint32_t needed = policy_.frameSamples + kLookaheadSamples;
    for (std::uint32_t channel = 0u; channel < kChannels; ++channel) {
      const float *source = inputFifo_.data() + channel * kInputCapacity;
      float *destination = workInput_.data() + channel * kInputCapacity;
      std::copy(source, source + needed, destination);
      std::copy(source + policy_.frameSamples, source + needed,
                inputFifo_.data() + channel * kInputCapacity);
    }
    inputFill_ = kLookaheadSamples;
    workChannels_ = channels;
    workGranule_ = 0u;
    workChannel_ = 0u;
    workAttacks_ = {};
    // The previous frame's lookahead granule holds exactly the samples that become
    // this frame's granule 0 (startFrameWork copies [frameSamples, needed) back to the
    // FIFO head). Re-running detectAttack() on it would compare the window against its
    // own energy, so total/old collapses to 1 and the transient criterion is dead for
    // granule 0 - the very granule nextBlockType() consumes as current_attack. Carry the
    // verdict instead and evaluate each granule exactly once. Only the first frame after
    // a reset or a profile change has no carry and must evaluate granule 0 itself.
    if (attackCarryValid_) {
      for (std::uint32_t channel = 0u; channel < kChannels; ++channel) {
        workAttacks_[channel][0u] = carriedAttack_[channel];
      }
      workAttackFirstIndex_ = 1u;
    } else {
      workAttackFirstIndex_ = 0u;
    }
    workIndex_ = workAttackFirstIndex_;
    frameWorkCredit_ = 0u;
    frameWorkCodecSamples_ = 0u;
    frameWorkStage_ = FrameWorkStage::DetectAttack;
  }

  void promoteCompletedFrame() noexcept {
    decodedFrame_.swap(outputFrame_);
    *logicalFrame_ = *workFrame_;
    outputFrameReady_ = true;
    outputFrameCursor_ = 0u;
    outputFrameSamples_ = policy_.frameSamples;
    outputFrameChannels_ = workChannels_;
    outputFrameStarted_ = true;
    completedFrameSamples_ = policy_.frameSamples;
    ++completedFrames_;
    frameWorkStage_ = FrameWorkStage::Idle;
    frameWorkCredit_ = 0u;
    applyFrameControls();
  }

  void emitOutputCodecSample() noexcept {
    if (!outputFrameReady_ || outputFrameCursor_ >= outputFrameSamples_) {
      if (outputFrameStarted_) {
        ++outputUnderflowsAfterStartup_;
      }
      return;
    }
    const float left = outputFrame_[outputFrameCursor_];
    const float right =
        outputFrameChannels_ == 2u ? outputFrame_[kMaximumFrameSamples + outputFrameCursor_] : left;
    pushDecodedCodecSample(left, right, outputFrameChannels_);
    ++outputFrameCursor_;
    if (outputFrameCursor_ == outputFrameSamples_) {
      outputFrameReady_ = false;
    }
  }

  void advanceAnalysisPosition() noexcept {
    ++workChannel_;
    if (workChannel_ < workChannels_) {
      frameWorkStage_ = FrameWorkStage::Psychoacoustics;
      return;
    }
    workChannel_ = 0u;
    ++workGranule_;
    if (workGranule_ < workFrame_->granules) {
      frameWorkStage_ = FrameWorkStage::Psychoacoustics;
      return;
    }
    workGranule_ = 0u;
    midSideGranule_ = 0u;
    midSideLine_ = 0u;
    midSideLrBits_ = 0u;
    midSideMsBits_ = 0u;
    midSideDecisionEligible_ =
        activeStereoMode_ == 0u && mp3::midSideBlockTypesCompatible(*workFrame_);
    frameWorkStage_ = FrameWorkStage::MidSideDecision;
  }

  void beginQuantization() noexcept {
    workGranule_ = 0u;
    workChannel_ = 0u;
    frameWorkStage_ = FrameWorkStage::QuantizeInitialize;
  }

  void advanceQuantizationPosition() noexcept {
    ++workChannel_;
    if (workChannel_ < workChannels_) {
      frameWorkStage_ = FrameWorkStage::QuantizeInitialize;
      return;
    }
    workChannel_ = 0u;
    ++workGranule_;
    if (workGranule_ < workFrame_->granules) {
      frameWorkStage_ = FrameWorkStage::QuantizeInitialize;
      return;
    }
    workChannel_ = 0u;
    frameWorkStage_ = FrameWorkStage::ScaleFactorSelection;
  }

  void advanceDecodePosition() noexcept {
    ++workChannel_;
    if (workChannel_ < workChannels_) {
      frameWorkStage_ = FrameWorkStage::HybridSynthesis;
      return;
    }
    workChannel_ = 0u;
    ++workGranule_;
    if (workGranule_ < workFrame_->granules) {
      frameWorkStage_ = FrameWorkStage::DecodeSpectrum;
      return;
    }
    const std::uint32_t completionMargin = policy_.frameSamples > frameWorkCodecSamples_
                                               ? policy_.frameSamples - frameWorkCodecSamples_
                                               : 0u;
    minimumFrameCompletionMargin_ = completionMargin < minimumFrameCompletionMargin_
                                        ? completionMargin
                                        : minimumFrameCompletionMargin_;
    frameWorkStage_ = FrameWorkStage::Ready;
  }

  void advanceFrameWork() noexcept {
    if (frameWorkStage_ == FrameWorkStage::Idle || frameWorkStage_ == FrameWorkStage::Ready) {
      return;
    }
    ++frameWorkCodecSamples_;
    ++frameWorkCredit_;
    if (frameWorkCredit_ < frameWorkCost()) {
      return;
    }
    frameWorkCredit_ = 0u;
    LogicalFrame &frame = *workFrame_;

    switch (frameWorkStage_) {
    case FrameWorkStage::DetectAttack: {
      const float *attackInput =
          workInput_.data() + workChannel_ * kInputCapacity + workIndex_ * kGranuleSamples;
      workAttacks_[workChannel_][workIndex_] = detectAttack(attackInput, workChannel_);
      ++workIndex_;
      if (workIndex_ > frame.granules) {
        workIndex_ = workAttackFirstIndex_;
        ++workChannel_;
        if (workChannel_ == workChannels_) {
          workChannel_ = 0u;
          workGranule_ = 0u;
          // Hand the lookahead verdict to the next frame's granule 0. Channels above
          // workChannels_ stay false, which is what an unevaluated channel produced
          // before as well. previousPsychoEnergy_ now holds the lookahead window's
          // energy, i.e. the next frame's granule 0, so its granule 1 comparison is
          // against the correct predecessor.
          for (std::uint32_t channel = 0u; channel < kChannels; ++channel) {
            carriedAttack_[channel] = workAttacks_[channel][frame.granules];
          }
          attackCarryValid_ = true;
          frameWorkStage_ = FrameWorkStage::Psychoacoustics;
        }
      }
      break;
    }
    case FrameWorkStage::Psychoacoustics: {
      const float *input =
          workInput_.data() + workChannel_ * kInputCapacity + workGranule_ * kGranuleSamples;
      GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      logical.blockType = selectBlockType(workChannel_, workAttacks_[workChannel_][workGranule_],
                                          workAttacks_[workChannel_][workGranule_ + 1u]);
      analyzePsychoacoustics(input, workGranule_, workChannel_);
      workIndex_ = 0u;
      frameWorkStage_ = FrameWorkStage::AnalysisSlot;
      break;
    }
    case FrameWorkStage::AnalysisSlot: {
      const float *input =
          workInput_.data() + workChannel_ * kInputCapacity + workGranule_ * kGranuleSamples;
      analyzePolyphaseSlot(workChannel_, input + workIndex_ * 32u,
                           subbandSlots_.data() + workIndex_ * kSubbands);
      ++workIndex_;
      if (workIndex_ == kSlots) {
        frameWorkStage_ = FrameWorkStage::HybridAnalysis;
      }
      break;
    }
    case FrameWorkStage::HybridAnalysis: {
      const GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      hybridAnalysis(workChannel_, logical.blockType,
                     spectrum_.data() +
                         (workGranule_ * kChannels + workChannel_) * kGranuleSamples);
      advanceAnalysisPosition();
      break;
    }
    case FrameWorkStage::MidSideDecision:
      if (midSideDecisionEligible_) {
        accumulateMidSideDecisionChunk(frame);
      } else {
        frame.midSide = false;
        workGranule_ = 0u;
        frameWorkStage_ = FrameWorkStage::MidSideApply;
      }
      break;
    case FrameWorkStage::MidSideApply: {
      float *granuleSpectrum = spectrum_.data() + workGranule_ * kChannels * kGranuleSamples;
      if (frame.midSide && workChannels_ == 2u) {
        applyMidSide(granuleSpectrum, granuleSpectrum + kGranuleSamples);
      }
      ++workGranule_;
      if (workGranule_ == frame.granules) {
        beginQuantization();
      }
      break;
    }
    case FrameWorkStage::QuantizeInitialize: {
      const float *input =
          spectrum_.data() + (workGranule_ * kChannels + workChannel_) * kGranuleSamples;
      GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      initializeScaleFactors(input, workGranule_, workChannel_, logical);
      logical.part2Length = static_cast<std::uint16_t>(scaleFactorBits(logical));
      quantSpectralBudget_ =
          workChannelBudget_ > logical.part2Length ? workChannelBudget_ - logical.part2Length : 0u;
      quantLow_ = 0u;
      quantHigh_ = 255u;
      quantIteration_ = 0u;
      quantPass_ = 0u;
      quantPassTerminated_ = false;
      frameWorkStage_ = FrameWorkStage::QuantizeBinaryMap;
      break;
    }
    case FrameWorkStage::QuantizeBinaryMap: {
      const float *input =
          spectrum_.data() + (workGranule_ * kChannels + workChannel_) * kGranuleSamples;
      GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      quantCandidateGain_ = static_cast<std::uint8_t>((quantLow_ + quantHigh_) / 2u);
      quantRangeExceeded_ = quantizeCandidateValues(input, logical, quantCandidateGain_);
      frameWorkStage_ = FrameWorkStage::QuantizeBinaryHuffman;
      break;
    }
    case FrameWorkStage::QuantizeBinaryHuffman: {
      GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      quantCandidateBits_ = finishQuantizeCandidate(logical, quantRangeExceeded_);
      if (quantCandidateBits_ > quantSpectralBudget_) {
        quantLow_ = static_cast<std::uint32_t>(quantCandidateGain_) + 1u;
      } else {
        quantHigh_ = quantCandidateGain_;
      }
      ++quantIteration_;
      frameWorkStage_ = quantIteration_ < 8u ? FrameWorkStage::QuantizeBinaryMap
                                             : FrameWorkStage::QuantizeFinalMap;
      break;
    }
    case FrameWorkStage::QuantizeFinalMap: {
      const float *input =
          spectrum_.data() + (workGranule_ * kChannels + workChannel_) * kGranuleSamples;
      GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      logical.globalGain = static_cast<std::uint8_t>(quantHigh_);
      quantRangeExceeded_ = quantizeCandidateValues(input, logical, logical.globalGain);
      frameWorkStage_ = FrameWorkStage::QuantizeFinalHuffman;
      break;
    }
    case FrameWorkStage::QuantizeFinalHuffman: {
      GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      quantHuffmanBits_ = finishQuantizeCandidate(logical, quantRangeExceeded_);
      frameWorkStage_ = FrameWorkStage::QuantizeFinalSpacing;
      break;
    }
    case FrameWorkStage::QuantizeFinalSpacing: {
      frameWorkStage_ = FrameWorkStage::QuantizeInitialDistortion;
      break;
    }
    case FrameWorkStage::QuantizeInitialDistortion: {
      const float *input =
          spectrum_.data() + (workGranule_ * kChannels + workChannel_) * kGranuleSamples;
      const GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      quantAggregateError_ = aggregateDistortion(input, logical);
      frameWorkStage_ = FrameWorkStage::QuantizePassSelect;
      break;
    }
    case FrameWorkStage::QuantizePassSelect: {
      const float *input =
          spectrum_.data() + (workGranule_ * kChannels + workChannel_) * kGranuleSamples;
      const GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      quantPassActive_ = false;
      if (!quantPassTerminated_) {
        quantWorstFactor_ = selectWorstScaleFactor(input, logical, workGranule_, workChannel_);
        quantPassActive_ = quantWorstFactor_ < logical.scalefactorCount;
        if (!quantPassActive_) {
          quantPassTerminated_ = true;
        }
      }
      frameWorkStage_ = FrameWorkStage::QuantizePassMap;
      break;
    }
    case FrameWorkStage::QuantizePassMap: {
      const float *input =
          spectrum_.data() + (workGranule_ * kChannels + workChannel_) * kGranuleSamples;
      GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      if (quantPassActive_) {
        const mp3::ScaleFactorLayout layout =
            mp3::scaleFactorLayout(activeProfile_, logical.blockType);
        logical.scalefactors[quantWorstFactor_] = mp3::incrementScaleFactor(
            layout, quantWorstFactor_, logical.scalefactors[quantWorstFactor_]);
        quantRangeExceeded_ = quantizeCandidateValues(input, logical, logical.globalGain);
      }
      frameWorkStage_ = FrameWorkStage::QuantizePassHuffman;
      break;
    }
    case FrameWorkStage::QuantizePassHuffman: {
      GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      if (quantPassActive_) {
        quantCandidateBits_ = finishQuantizeCandidate(logical, quantRangeExceeded_);
      }
      frameWorkStage_ = FrameWorkStage::QuantizePassDistortion;
      break;
    }
    case FrameWorkStage::QuantizePassDistortion: {
      const float *input =
          spectrum_.data() + (workGranule_ * kChannels + workChannel_) * kGranuleSamples;
      const GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      if (quantPassActive_) {
        quantCandidateError_ = aggregateDistortion(input, logical);
      }
      frameWorkStage_ = FrameWorkStage::QuantizePassCommit;
      break;
    }
    case FrameWorkStage::QuantizePassCommit: {
      GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      quantNeedsRestore_ = false;
      if (quantPassActive_) {
        if (quantCandidateBits_ > quantSpectralBudget_ ||
            quantCandidateError_ > quantAggregateError_) {
          --logical.scalefactors[quantWorstFactor_];
          quantNeedsRestore_ = true;
          quantPassTerminated_ = true;
        } else {
          quantHuffmanBits_ = quantCandidateBits_;
          quantAggregateError_ = quantCandidateError_;
        }
      }
      frameWorkStage_ = FrameWorkStage::QuantizeRestoreMap;
      break;
    }
    case FrameWorkStage::QuantizeRestoreMap: {
      const float *input =
          spectrum_.data() + (workGranule_ * kChannels + workChannel_) * kGranuleSamples;
      GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      if (quantNeedsRestore_) {
        quantRangeExceeded_ = quantizeCandidateValues(input, logical, logical.globalGain);
      }
      frameWorkStage_ = FrameWorkStage::QuantizeRestoreHuffman;
      break;
    }
    case FrameWorkStage::QuantizeRestoreHuffman: {
      GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      if (quantNeedsRestore_) {
        quantHuffmanBits_ = finishQuantizeCandidate(logical, quantRangeExceeded_);
      }
      ++quantPass_;
      if (quantPass_ < 4u) {
        frameWorkStage_ = FrameWorkStage::QuantizePassSelect;
      } else {
        logical.part3Length = static_cast<std::uint16_t>(quantHuffmanBits_);
        advanceQuantizationPosition();
      }
      break;
    }
    case FrameWorkStage::ScaleFactorSelection:
      applyScaleFactorSelection(frame, workChannel_);
      ++workChannel_;
      if (workChannel_ == workChannels_) {
        frameWorkStage_ = FrameWorkStage::BudgetCommit;
      }
      break;
    case FrameWorkStage::BudgetCommit: {
      std::uint32_t logicalBits = 0u;
      for (std::uint32_t granule = 0u; granule < frame.granules; ++granule) {
        for (std::uint32_t channel = 0u; channel < frame.channels; ++channel) {
          logicalBits += frame.data[granule][channel].part23Length();
        }
      }
      budgetState_.commitFrame(activeProfile_, frame.budget, logicalBits);
      workGranule_ = 0u;
      workChannel_ = 0u;
      frameWorkStage_ = FrameWorkStage::DecodeSpectrum;
      break;
    }
    case FrameWorkStage::DecodeSpectrum: {
      const GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      mp3::decodeLogicalSpectrum(logical, frame.profile, policy_.cutoffLine,
                                 decodedSpectrum_.data() + workChannel_ * kGranuleSamples);
      ++workChannel_;
      if (workChannel_ == workChannels_) {
        workChannel_ = 0u;
        frameWorkStage_ = FrameWorkStage::DecodeMidSide;
      }
      break;
    }
    case FrameWorkStage::DecodeMidSide:
      if (frame.midSide && workChannels_ == 2u) {
        decodeMidSide(decodedSpectrum_.data(), decodedSpectrum_.data() + kGranuleSamples);
      }
      frameWorkStage_ = FrameWorkStage::HybridSynthesis;
      break;
    case FrameWorkStage::HybridSynthesis: {
      const GranuleChannel &logical = frame.data[workGranule_][workChannel_];
      hybridSynthesis(workChannel_, logical,
                      decodedSpectrum_.data() + workChannel_ * kGranuleSamples);
      workIndex_ = 0u;
      frameWorkStage_ = FrameWorkStage::SynthesisSlot;
      break;
    }
    case FrameWorkStage::SynthesisSlot: {
      float *decoded = decodedFrame_.data() + workChannel_ * kMaximumFrameSamples +
                       workGranule_ * kGranuleSamples;
      synthesizePolyphaseSlot(workChannel_, subbandSlots_.data() + workIndex_ * kSubbands,
                              decoded + workIndex_ * 32u);
      ++workIndex_;
      if (workIndex_ == kSlots) {
        advanceDecodePosition();
      }
      break;
    }
    case FrameWorkStage::Idle:
    case FrameWorkStage::Ready:
      break;
    }
  }

  // Codec rate -> optional rational stage -> base rate -> halfband interpolation
  // cascade -> host rate. Exact mirror of processHostSample().
  void pushDecodedCodecSample(float left, float right, std::uint32_t channels) noexcept {
    const float codecLeft = left;
    const float codecRight = channels == 2u ? right : left;
    if (!rationalActive_[activeResamplerIndex_]) {
      interpolateToHost(codecLeft, codecRight);
      return;
    }
    std::array<float, dsp::RationalResampler::kMaximumOutputs> baseLeft{};
    std::array<float, dsp::RationalResampler::kMaximumOutputs> baseRight{};
    const std::size_t count = upsampler(0u).push(codecLeft, baseLeft);
    const std::size_t countRight = upsampler(1u).push(codecRight, baseRight);
    for (std::size_t index = 0u; index < count; ++index) {
      interpolateToHost(baseLeft[index], index < countRight ? baseRight[index] : baseLeft[index]);
    }
  }

  void interpolateToHost(float left, float right) noexcept {
    std::array<float, kMaximumRateFactor> currentLeft{};
    std::array<float, kMaximumRateFactor> currentRight{};
    std::array<float, kMaximumRateFactor> nextLeft{};
    std::array<float, kMaximumRateFactor> nextRight{};
    currentLeft[0u] = left;
    currentRight[0u] = right;
    std::size_t count = 1u;
    for (std::uint32_t stage = 0u; stage < halfbandStages_; ++stage) {
      std::size_t produced = 0u;
      for (std::size_t index = 0u; index < count; ++index) {
        outputHalfband(0u, stage).interpolate(currentLeft[index], nextLeft[produced],
                                              nextLeft[produced + 1u]);
        outputHalfband(1u, stage).interpolate(currentRight[index], nextRight[produced],
                                              nextRight[produced + 1u]);
        produced += 2u;
      }
      currentLeft = nextLeft;
      currentRight = nextRight;
      count = produced;
    }
    for (std::size_t index = 0u; index < count; ++index) {
      pushHostSample(currentLeft[index], currentRight[index]);
    }
  }

  void pushHostSample(float left, float right) noexcept {
    if (outputCount_ == kOutputCapacity) {
      outputRead_ = outputRead_ + 1u == kOutputCapacity ? 0u : outputRead_ + 1u;
      --outputCount_;
    }
    outputLeft_[outputWrite_] = sanitize(left);
    outputRight_[outputWrite_] = sanitize(right);
    outputWrite_ = outputWrite_ + 1u == kOutputCapacity ? 0u : outputWrite_ + 1u;
    ++outputCount_;
  }

  void popHostSample(float &left, float &right, std::uint32_t channels) noexcept {
    if (outputCount_ == 0u) {
      left = 0.0F;
      right = 0.0F;
      return;
    }
    left = outputLeft_[outputRead_];
    right = channels == 2u ? outputRight_[outputRead_] : left;
    outputRead_ = outputRead_ + 1u == kOutputCapacity ? 0u : outputRead_ + 1u;
    --outputCount_;
  }

  std::vector<float> inputFifo_;
  std::vector<float> workInput_;
  std::vector<float> decodedFrame_;
  std::vector<float> outputFrame_;
  std::vector<float> spectrum_;
  std::vector<float> decodedSpectrum_;
  std::vector<float> subbandSlots_;
  std::vector<float> analysisHistory_;
  std::vector<float> analysisOverlap_;
  std::vector<float> synthesisOverlap_;
  std::vector<float> synthesisV_;
  std::vector<float> maskThresholds_;
  std::vector<dsp::Halfband2x> inputHalfbands_;
  std::vector<dsp::Halfband2x> outputHalfbands_;
  std::vector<dsp::RationalResampler> downsamplers_;
  std::vector<dsp::RationalResampler> upsamplers_;
  std::vector<float> outputLeft_;
  std::vector<float> outputRight_;
  std::vector<float> dryLeft_;
  std::vector<float> dryRight_;
  std::vector<float> wetDelayLeft_;
  std::vector<float> wetDelayRight_;
  std::vector<float> analysisMatrix_;
  std::vector<float> synthesisMatrix_;
  std::vector<float> longMdct_;
  std::vector<float> shortMdct_;
  std::vector<float> longWindow_;
  std::vector<float> startWindow_;
  std::vector<float> stopWindow_;
  std::vector<float> shortWindow_;
  std::vector<float> fftInput_;
  std::vector<float> fftOutput_;
  std::vector<float> fftWork_;
  std::unique_ptr<LogicalFrame> logicalFrame_;
  std::unique_ptr<LogicalFrame> workFrame_;
  PFFFT_Setup *fftSetup1024_ = nullptr;
  PFFFT_Setup *fftSetup512_ = nullptr;
  mp3::FrameBudgetState budgetState_{};
  ProfilePolicy policy_{};
  std::array<std::uint32_t, kChannels> analysisHistoryPosition_{};
  std::array<BlockType, kChannels> blockState_{};
  std::array<std::array<bool, 3>, kChannels> workAttacks_{};
  std::array<bool, kChannels> carriedAttack_{};
  std::array<double, kChannels> previousPsychoEnergy_{};
  std::array<bool, kProfileCount> rationalActive_{};
  std::uint32_t baseRate_ = 0u;
  std::uint32_t halfbandStages_ = 0u;
  std::uint32_t activeResamplerIndex_ = 0u;
  std::uint32_t hostRate_ = 0u;
  std::uint32_t maxChannels_ = 0u;
  std::uint32_t maxFrames_ = 0u;
  std::uint32_t latencySamples_ = 0u;
  std::uint32_t wetDelaySamples_ = 0u;
  std::uint32_t inputFill_ = 0u;
  std::uint32_t outputRead_ = 0u;
  std::uint32_t outputWrite_ = 0u;
  std::uint32_t outputCount_ = 0u;
  std::uint32_t outputFrameCursor_ = 0u;
  std::uint32_t outputFrameSamples_ = 0u;
  std::uint32_t outputFrameChannels_ = 0u;
  std::uint32_t completedFrameSamples_ = 0u;
  std::uint32_t frameWorkCodecSamples_ = 0u;
  std::uint32_t minimumFrameCompletionMargin_ = std::numeric_limits<std::uint32_t>::max();
  std::uint32_t workChannels_ = 0u;
  std::uint32_t workGranule_ = 0u;
  std::uint32_t workChannel_ = 0u;
  std::uint32_t workIndex_ = 0u;
  std::uint32_t workAttackFirstIndex_ = 0u;
  std::uint32_t midSideGranule_ = 0u;
  std::uint32_t midSideLine_ = 0u;
  std::uint32_t workChannelBudget_ = 0u;
  std::uint32_t frameWorkCredit_ = 0u;
  std::uint32_t quantSpectralBudget_ = 0u;
  std::uint32_t quantLow_ = 0u;
  std::uint32_t quantHigh_ = 0u;
  std::uint32_t quantIteration_ = 0u;
  std::uint32_t quantPass_ = 0u;
  std::uint32_t quantWorstFactor_ = 0u;
  std::uint32_t quantCandidateBits_ = 0u;
  std::uint32_t quantHuffmanBits_ = 0u;
  std::uint64_t midSideLrBits_ = 0u;
  std::uint64_t midSideMsBits_ = 0u;
  std::size_t dryPosition_ = 0u;
  std::size_t wetDelayPosition_ = 0u;
  double gainSmoothed_ = 1.0;
  double mixSmoothed_ = 1.0;
  double quantAggregateError_ = 0.0;
  double quantCandidateError_ = 0.0;
  Profile activeProfile_ = Profile::Mpeg1;
  Profile requestedProfile_ = Profile::Mpeg1;
  std::uint32_t activeBitrateIndex_ = 2u;
  std::uint32_t requestedBitrateIndex_ = 2u;
  std::uint32_t activeStereoMode_ = 0u;
  std::uint32_t requestedStereoMode_ = 0u;
  std::uint8_t quantCandidateGain_ = 0u;
  FrameWorkStage frameWorkStage_ = FrameWorkStage::Idle;
  bool activeReservoir_ = true;
  bool requestedReservoir_ = true;
  bool prepared_ = false;
  bool controlsInitialized_ = false;
  bool profileChangedAtBoundary_ = false;
  bool smoothingInitialized_ = false;
  bool outputFrameReady_ = false;
  bool outputFrameStarted_ = false;
  bool attackCarryValid_ = false;
  bool midSideDecisionEligible_ = false;
  bool quantRangeExceeded_ = false;
  bool quantPassActive_ = false;
  bool quantPassTerminated_ = false;
  bool quantNeedsRestore_ = false;
  std::uint32_t resamplerBuildCount_ = 0u;
  std::uint64_t completedFrames_ = 0u;
  std::uint64_t schedulerDeadlineMisses_ = 0u;
  std::uint64_t outputUnderflowsAfterStartup_ = 0u;
};

static_assert(sizeof(MP3CodecSimulatorKernel) <= 8192u);

} // namespace
} // namespace effetune::plugins::lofi

extern "C" bool et_mp3_copy_production_diagnostic(
    const effetune::PluginKernel *kernel,
    effetune::plugins::lofi::mp3::ProductionDiagnosticSnapshot *snapshot) noexcept {
  if (kernel == nullptr || snapshot == nullptr) {
    return false;
  }
  const auto *mp3_kernel =
      static_cast<const effetune::plugins::lofi::MP3CodecSimulatorKernel *>(kernel);
  return mp3_kernel->copyProductionDiagnostic(*snapshot);
}

extern "C" bool
et_mp3_render_production_logical_frames(effetune::PluginKernel *kernel,
                                        const effetune::plugins::lofi::mp3::LogicalFrame *frames,
                                        std::uint32_t frame_count, float *decoded_pcm) noexcept {
  if (kernel == nullptr) {
    return false;
  }
  auto *mp3_kernel = static_cast<effetune::plugins::lofi::MP3CodecSimulatorKernel *>(kernel);
  return mp3_kernel->renderProductionLogicalFrames(frames, frame_count, decoded_pcm);
}

EFFETUNE_REGISTER_KERNEL(MP3CodecSimulatorPlugin, effetune::plugins::lofi::MP3CodecSimulatorKernel)

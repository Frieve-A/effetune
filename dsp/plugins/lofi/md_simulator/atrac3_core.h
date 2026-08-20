// MD Simulator (ATRAC3 LP2 / LP4) codec core.
//
// Written from the algorithm description in the implementation plan (section 3.2)
// and from the closed-form derivations recorded in atrac3_tables.h.  No code and
// no coefficient array is taken from the LGPL reference implementations
// (atracdenc, FFmpeg); see the provenance policy at the top of atrac3_tables.h.
//
// Relationship to atrac1_core.h: the two codecs are kept as separate cores as the
// plan requires (no generic "ATRAC framework"), and only the mathematical
// primitives are shared - Dct4 / Mdct, the two band QMF pair, and the scale factor
// table.  Everything above them, the four band tree, gain control, the
// quantization unit partition, the variable length spectral cost and the joint
// stereo path, is specific to ATRAC3 and lives here.
//
// Frame level structure.  processFrame() consumes one 1024 sample frame per
// channel and produces one 1024 sample frame per channel, delayed by
// kCodecDelaySamples.  That is deliberately the same "process a frame, hand the
// caller a block it can drain one sample at a time" shape that the ATRAC1 path
// uses, so the kernel can reuse its deterministic work spreading unchanged.
//
#ifndef EFFETUNE_MD_SIMULATOR_ATRAC3_CORE_H
#define EFFETUNE_MD_SIMULATOR_ATRAC3_CORE_H

#include "atrac1_core.h"
#include "atrac3_tables.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::md_simulator::atrac3 {

// Algorithmic delay in samples at the codec rate:
//   stage 1 QMF round trip                                  47
//   stage 2 QMF round trip (47 at fs/2, both branches)      94
//   MDCT pipeline (one band region of overlap)            1024
//                                                        -----
//                                                         1165
// The MDCT term is one band region of 256 samples at fs/4, i.e. 1024 samples at
// the codec rate: the encoder transforms the window that ends with the region it
// has just received, and the decoder can only complete the *previous* region when
// that transform arrives.  The self test measures this with an impulse.
inline constexpr std::size_t kCodecDelaySamples = kQmfDelay + 2u * kQmfDelay + kFrameSamples;

// Word length index used by the transparency hook.  It is far outside the 3 bit
// side information field on purpose: transparent frames are an oracle, are never
// budgeted and are never serialised.
inline constexpr int kTransparentWordLengthIndex = 24;

enum class Mode : std::uint8_t { Lp2 = 0, Lp4 = 1 };

// Per mode coding contract.  budgetBits covers the whole call, i.e. both channels
// together in LP4 (one 192 byte frame for the stereo pair) and each channel
// separately in LP2 (192 bytes per channel).
struct ModeConfig {
  std::size_t budgetBits = 0u;
  std::uint16_t maxActiveUnits = 0u;
  bool jointStereo = false;
};

[[nodiscard]] inline ModeConfig modeConfig(Mode mode, std::size_t channels) noexcept {
  const std::size_t count = channels == 0u ? 1u : channels;
  if (mode == Mode::Lp4) {
    // 192 bytes per stereo pair.  A mono stream gets half of it, which is the
    // long play mono operating point of the real hardware.
    return {count >= 2u ? kLp4PairFrameBits : kLp4PairFrameBits / 2u, kLp4MaxActiveUnits, true};
  }
  return {kLp2FrameBits * count, kLp2MaxActiveUnits, false};
}

// ---------------------------------------------------------------------------
// Gain control envelope
// ---------------------------------------------------------------------------
// Up to kMaxGainPoints change points per band per frame.  location is a sub-block
// index in [0, kGainSubBlocks) and level is the base 2 exponent of the gain that
// takes effect there.  Locations are strictly increasing.
struct GainEnvelope {
  std::uint8_t pointCount = 0u;
  std::array<std::uint8_t, kMaxGainPoints> location{};
  std::array<std::uint8_t, kMaxGainPoints> level{};

  void clear() noexcept {
    pointCount = 0u;
    location.fill(0u);
    level.fill(0u);
  }
};

[[nodiscard]] inline int gainEndLevel(const GainEnvelope &envelope, int startLevel) noexcept {
  return envelope.pointCount == 0u ? startLevel
                                   : static_cast<int>(envelope.level[envelope.pointCount - 1u]);
}

// Expands an envelope into the kBandSamples gain values it stands for.  Encoder
// and decoder both call this, so the round trip x / g * g is exact to one ulp
// even where the ramp interpolates.
inline void buildGainCurve(const GainEnvelope &envelope, int startLevel, double *curve) noexcept {
  double current = static_cast<double>(startLevel);
  std::size_t n = 0u;
  for (std::size_t point = 0u; point < static_cast<std::size_t>(envelope.pointCount); ++point) {
    const std::size_t rampStart =
        static_cast<std::size_t>(envelope.location[point]) * kGainSubBlockSamples;
    const double target = static_cast<double>(envelope.level[point]);
    for (; n < rampStart && n < kBandSamples; ++n) {
      curve[n] = std::exp2(current);
    }
    const std::size_t rampEnd = std::min(rampStart + kGainRampSamples, kBandSamples);
    for (; n < rampEnd; ++n) {
      const double position =
          (static_cast<double>(n - rampStart) + 0.5) / static_cast<double>(kGainRampSamples);
      curve[n] = std::exp2(current + (target - current) * position);
    }
    current = target;
  }
  for (; n < kBandSamples; ++n) {
    curve[n] = std::exp2(current);
  }
}

// ---------------------------------------------------------------------------
// Logical frame
// ---------------------------------------------------------------------------
// Exactly the fields an ATRAC3 frame carries for one coded channel.  The decoder
// may look at nothing else, so the encoder internals stay unobservable and the
// core can be driven from a deserialised frame just as well as from a live one.
struct Atrac3Frame {
  std::array<GainEnvelope, kBandCount> gain{};
  std::uint8_t activeUnits = 0u;
  // Tone component coding is not implemented (plan section 3.2 step 4 decision);
  // the field exists because its 5 bits are still charged to the budget.
  std::uint8_t toneComponentCount = 0u;
  std::array<std::uint8_t, kQuCount> wordLength{};
  std::array<std::uint8_t, kQuCount> scaleFactorIndex{};
  std::array<std::int32_t, kSpectrumSize> quantized{};
  std::uint32_t usedBits = 0u;

  void clear() noexcept {
    for (GainEnvelope &envelope : gain) {
      envelope.clear();
    }
    activeUnits = 0u;
    toneComponentCount = 0u;
    wordLength.fill(0u);
    scaleFactorIndex.fill(0u);
    quantized.fill(0);
    usedBits = 0u;
  }
};

[[nodiscard]] inline std::size_t quBand(std::size_t unit) noexcept {
  for (std::size_t band = 0u; band + 1u < kBandCount; ++band) {
    if (unit < static_cast<std::size_t>(kBandQuStart[band + 1u])) {
      return band;
    }
  }
  return kBandCount - 1u;
}

// Side information that does not depend on the allocation: the tone component
// count, the active unit count and the gain envelopes.
[[nodiscard]] inline std::size_t frameHeaderBits(const Atrac3Frame &frame) noexcept {
  std::size_t bits = kToneCountBits + kActiveUnitBits;
  for (const GainEnvelope &envelope : frame.gain) {
    bits += kGainCountBits + static_cast<std::size_t>(envelope.pointCount) * kGainPointBits;
  }
  return bits;
}

// ---------------------------------------------------------------------------
// Encoder analysis stage
// ---------------------------------------------------------------------------
// QMF tree, gain control and MDCT for one coded channel.  Quantization is *not*
// done here: LP4 has to allocate one shared budget across the mid and the side
// channel, so the allocator sees both spectra at once (see Atrac3Allocator).
class Atrac3Encoder {
public:
  void prepare(const Mdct *mdct) {
    mdct_ = mdct;
    qmf1_.prepare(kFrameSamples);
    qmf2Low_.prepare(kFrameSamples / 2u);
    qmf2High_.prepare(kFrameSamples / 2u);
    for (std::size_t band = 0u; band < kBandCount; ++band) {
      band_[band].assign(kBandSamples, 0.0);
      history_[band].assign(2u * kBandSamples, 0.0);
    }
    low_.assign(kFrameSamples / 2u, 0.0);
    high_.assign(kFrameSamples / 2u, 0.0);
    curve_.assign(kBandSamples, 0.0);
    window_.assign(kWindowSize, 0.0);
    frameIn_.assign(kWindowSize, 0.0);
    frameOut_.assign(kBlockSize, 0.0);
    spectrum_.assign(kSpectrumSize, 0.0);
    for (std::size_t n = 0u; n < kWindowSize; ++n) {
      window_[n] =
          std::sin(kPi / static_cast<double>(kWindowSize) * (static_cast<double>(n) + 0.5));
    }
    reset();
  }

  void reset() noexcept {
    qmf1_.reset();
    qmf2Low_.reset();
    qmf2High_.reset();
    for (std::size_t band = 0u; band < kBandCount; ++band) {
      std::fill(band_[band].begin(), band_[band].end(), 0.0);
      std::fill(history_[band].begin(), history_[band].end(), 0.0);
      levelState_[band] = 0;
      gainReference_[band] = 0.0;
      gainPrimed_[band] = false;
      gainNeighbourPeak_[band] = 0.0;
      gainNeighbourFlat_[band] = 0.0;
      gainNeighbourGain_[band] = 1.0;
    }
    std::fill(spectrum_.begin(), spectrum_.end(), 0.0);
  }

  // Consumes one frame of PCM and fills the gain envelopes of `frame`.  The
  // resulting spectrum is left in spectrum() for the allocator.
  void analyze(const double *pcm, Atrac3Frame &frame) noexcept {
    qmf1_.process(pcm, kFrameSamples, low_.data(), high_.data());
    qmf2Low_.process(low_.data(), kFrameSamples / 2u, band_[0].data(), band_[1].data());
    // The upper branch is spectrally mirrored, so its lower output is the top
    // band and its upper output is band 2.
    qmf2High_.process(high_.data(), kFrameSamples / 2u, band_[3].data(), band_[2].data());

    for (std::size_t band = 0u; band < kBandCount; ++band) {
      // buildEnvelope() leaves the curve it decided on in curve_, so the division
      // below and the neighbourhood bookkeeping cannot drift apart.
      buildEnvelope(band, band_[band].data(), frame.gain[band]);
      levelState_[band] = gainEndLevel(frame.gain[band], levelState_[band]);

      double *history = history_[band].data();
      std::copy(history + kBandSamples, history + 2u * kBandSamples, history);
      for (std::size_t n = 0u; n < kBandSamples; ++n) {
        history[kBandSamples + n] = band_[band][n] / curve_[n];
      }
      for (std::size_t n = 0u; n < kWindowSize; ++n) {
        frameIn_[n] = history[n] * window_[n];
      }
      mdct_->forward(kBlockSize, frameIn_.data(), frameOut_.data());
      storeBlock(band, frameOut_.data(), spectrum_.data() + band * kBlockSize);
    }
    for (std::size_t index = 0u; index < kSpectrumSize; ++index) {
      spectrum_[index] *= kSpectrumScale;
    }
  }

  [[nodiscard]] const double *spectrum() const noexcept { return spectrum_.data(); }
  [[nodiscard]] const double *window() const noexcept { return window_.data(); }

private:
  // Bands that took an odd number of upper branches come out of the QMF tree with
  // their frequency axis mirrored, so their coefficients are stored in reverse.
  // The permutation is undone bit exactly on decode; its only purpose is to make
  // the quantization unit index monotone in real frequency.
  static void storeBlock(std::size_t band, const double *source, double *destination) noexcept {
    if (!kBandReversed[band]) {
      std::copy(source, source + kBlockSize, destination);
      return;
    }
    for (std::size_t index = 0u; index < kBlockSize; ++index) {
      destination[index] = source[kBlockSize - 1u - index];
    }
  }

  // Gain envelope decision.
  //
  // The unit the decoder re-amplifies is one region of kBandSamples, but the MDCT
  // block is kWindowSize = 2 * kBandSamples long, so a block always straddles a
  // region boundary and every region is carried by the two blocks that overlap it.
  // A region is therefore quantized together with its two neighbours and inherits
  // their coding noise floor, which the decoder then multiplies by that region's
  // own gain curve.  The invariant the level decision has to keep is consequently
  // a property of that three region neighbourhood and not of a single region:
  //
  //     gain(n) * flat(m) <= peak(neighbourhood)   for every pair n, m in it
  //
  // where gain() is the factor the decoder applies, flat() is the amplitude the
  // MDCT actually sees (the band divided by the gain curve) and peak() is the
  // band's own local peak.  Keeping it means the re-amplified coding noise can
  // never exceed the noise the same band would have carried with no gain control
  // at all, whatever the level is.  The old single region reading of the
  // invariant, 2^level <= peak / (2 * reference), only ever looked backwards and
  // said nothing about the neighbour that follows, which is the one whose full
  // scale noise floor a released level leaves to be amplified by 2^kMaxGainLevel.
  //
  // The pair condition splits into two one sided rules that each read only
  // already decided material, so the encoder still needs no lookahead:
  //
  //   cap  - this sub-block's gain against the flattened peak of everything
  //          before it in the neighbourhood.  It covers every pair whose loud
  //          member came first, and it is what keeps steady state material out of
  //          gain control entirely: as soon as the neighbourhood's flattened peak
  //          reaches its own peak, which is the definition of steady state, the
  //          cap collapses to zero and no attenuation is allowed.
  //   hold - this sub-block's flattened peak against the largest gain committed
  //          before it.  It covers every pair whose loud member comes second and
  //          turns the release into a real release: the level comes down only as
  //          fast as the signal does, on the control grid but never ahead of it,
  //          minus kGainReleaseSlack levels.  Read strictly the rule is a latch,
  //          because on steady material the peak never falls away from the
  //          neighbourhood scale and the level can then never come back down;
  //          the slack is what turns it into a release that reaches unity one
  //          level per region, and it costs at most a factor of two on the
  //          amplification bound while a release is in progress.  Raising the
  //          level is optional, so cap keeps the strict bound; lowering it is
  //          mandatory, so hold is the side that gets the slack.
  //
  // Inside those bounds the level is still chosen by the attack detector, so a
  // transient standing well above the running reference is attenuated one octave
  // below the measured jump exactly as before, and the coarse release on the
  // control grid is still audible as the "pumping" the plan expects.
  //
  // The reference is primed from the first sub-block of the first frame after a
  // reset.  Without that priming a reference of zero makes the very first
  // sub-block of any stream look like an infinite attack.
  void buildEnvelope(std::size_t band, const double *x, GainEnvelope &envelope) noexcept {
    envelope.clear();
    std::array<int, kGainSubBlocks> desired{};
    double reference = gainReference_[band];
    // Running maxima over the MDCT neighbourhood: the whole previous region plus
    // the part of this one that has already been decided.
    double neighbourPeak = gainNeighbourPeak_[band];
    double neighbourFlat = gainNeighbourFlat_[band];
    double neighbourGain = gainNeighbourGain_[band];
    for (std::size_t sub = 0u; sub < kGainSubBlocks; ++sub) {
      double peak = 0.0;
      for (std::size_t index = 0u; index < kGainSubBlockSamples; ++index) {
        peak = std::max(peak, std::fabs(x[sub * kGainSubBlockSamples + index]));
      }
      if (!gainPrimed_[band]) {
        reference = peak;
        gainPrimed_[band] = true;
      }
      const double floor = std::max(reference, kGainFloor);
      int want = 0;
      if (peak > kGainFloor && peak > kGainAttackRatio * floor) {
        const int raw = static_cast<int>(std::floor(std::log2(peak / floor))) - 1;
        want = std::min(kMaxGainLevel, std::max(1, raw));
      }
      const double scale = std::max(neighbourPeak, peak);
      int cap = kMaxGainLevel;
      if (neighbourFlat > 0.0 && scale > 0.0) {
        cap = static_cast<int>(std::floor(std::log2(scale / neighbourFlat)));
      }
      int hold = 0;
      if (peak > 0.0 && scale > 0.0) {
        hold = static_cast<int>(std::ceil(std::log2(peak * neighbourGain / scale))) -
               kGainReleaseSlack;
      }
      const int level = std::min(kMaxGainLevel, std::max(0, std::max(hold, std::min(want, cap))));
      desired[sub] = level;
      neighbourPeak = scale;
      neighbourFlat = std::max(neighbourFlat, peak / std::exp2(static_cast<double>(level)));
      neighbourGain = std::max(neighbourGain, std::exp2(static_cast<double>(level)));
      reference = kGainDecay * reference + (1.0 - kGainDecay) * peak;
    }
    gainReference_[band] = reference;

    // Only kMaxGainPoints change points fit in the frame.  A point that raises the
    // level is required by the invariant while one that lowers it is only a
    // refinement, so the last affordable point is raised to whatever the rest of
    // the region still needs and the level then simply holds.  No sub-block can
    // end up below the level the invariant asked for.
    int previous = levelState_[band];
    for (std::size_t sub = 0u; sub < kGainSubBlocks; ++sub) {
      if (desired[sub] == previous) {
        continue;
      }
      if (static_cast<std::size_t>(envelope.pointCount) >= kMaxGainPoints) {
        break;
      }
      int level = desired[sub];
      if (static_cast<std::size_t>(envelope.pointCount) + 1u == kMaxGainPoints) {
        for (std::size_t rest = sub + 1u; rest < kGainSubBlocks; ++rest) {
          level = std::max(level, desired[rest]);
        }
      }
      envelope.location[envelope.pointCount] = static_cast<std::uint8_t>(sub);
      envelope.level[envelope.pointCount] = static_cast<std::uint8_t>(level);
      ++envelope.pointCount;
      previous = level;
    }

    // The neighbourhood state has to describe what the decoder will really do, so
    // it is measured on the curve that was actually encoded, interpolation ramps
    // and the level carried in from the previous region included.  analyze()
    // divides the band by this same curve.
    buildGainCurve(envelope, levelState_[band], curve_.data());
    double regionPeak = 0.0;
    double regionFlat = 0.0;
    double regionGain = 1.0;
    for (std::size_t n = 0u; n < kBandSamples; ++n) {
      const double magnitude = std::fabs(x[n]);
      regionPeak = std::max(regionPeak, magnitude);
      regionFlat = std::max(regionFlat, magnitude / curve_[n]);
      regionGain = std::max(regionGain, curve_[n]);
    }
    gainNeighbourPeak_[band] = regionPeak;
    gainNeighbourFlat_[band] = regionFlat;
    gainNeighbourGain_[band] = regionGain;
  }

  const Mdct *mdct_ = nullptr;
  QmfAnalysis qmf1_;
  QmfAnalysis qmf2Low_;
  QmfAnalysis qmf2High_;
  std::array<std::vector<double>, kBandCount> band_{};
  std::array<std::vector<double>, kBandCount> history_{};
  std::vector<double> low_;
  std::vector<double> high_;
  std::vector<double> curve_;
  std::vector<double> window_;
  std::vector<double> frameIn_;
  std::vector<double> frameOut_;
  std::vector<double> spectrum_;
  std::array<int, kBandCount> levelState_{};
  std::array<double, kBandCount> gainReference_{};
  std::array<bool, kBandCount> gainPrimed_{};
  // Maxima of the previous region, the other half of every MDCT block this region
  // is coded in: its band peak, the flattened peak the MDCT saw and the largest
  // gain the decoder will apply to it.
  std::array<double, kBandCount> gainNeighbourPeak_{};
  std::array<double, kBandCount> gainNeighbourFlat_{};
  std::array<double, kBandCount> gainNeighbourGain_{};
};

// ---------------------------------------------------------------------------
// Bit allocation and quantization
// ---------------------------------------------------------------------------
// Owns the one place where the LP2 and the LP4 paths differ structurally: LP4
// allocates a single 1536 bit budget across the mid and the side channel, so the
// quieter side channel loses its high units first and produces the thin, wobbling
// top end that the mode is known for.  LP2 runs the same code with one channel
// per budget.
//
// The spectral field is variable length (Rice, see atrac3_tables.h), so the cost
// of a candidate allocation can only be known by quantizing it.  The search is a
// fixed count bisection on a global offset added to the per unit bit targets; the
// low end of the bracket forces every word length to zero and therefore always
// fits, so the loop is bounded and can never fail to produce a legal frame.
class Atrac3Allocator {
public:
  static constexpr std::size_t kMaxChannels = 2u;

  void prepare() {
    for (std::size_t channel = 0u; channel < kMaxChannels; ++channel) {
      peak_[channel].assign(kQuCount, 0.0);
      energy_[channel].assign(kQuCount, 0.0);
      target_[channel].assign(kQuCount, 0.0);
      scaleFactor_[channel].assign(kQuCount, 0u);
    }
  }

  // Test-only oracle hook (plan section 7.2 item 1).  Transparent frames use a
  // 24 bit quantizer on every unit and ignore the budget, which reduces the
  // coding loss to rounding and lets the QMF alias cancellation, the MDCT time
  // domain alias cancellation and the gain control round trip be observed on
  // their own.  Production never enables it.
  void setTransparent(bool transparent) noexcept { transparent_ = transparent; }

  // `frames` must already carry the gain envelopes for the frame.  Returns the
  // total bit count of the coded frame, including the shared joint stereo field.
  std::uint32_t allocate(const double *const *spectra, Atrac3Frame *const *frames,
                         std::size_t channels, const ModeConfig &config) noexcept {
    const std::size_t count = std::min(channels, kMaxChannels);
    const std::size_t shared =
        (config.jointStereo && count >= 2u) ? kJointModeBits : static_cast<std::size_t>(0u);
    if (transparent_) {
      measure(spectra, count);
      std::uint32_t total = static_cast<std::uint32_t>(shared);
      for (std::size_t channel = 0u; channel < count; ++channel) {
        frames[channel]->activeUnits = static_cast<std::uint8_t>(kQuCount);
        frames[channel]->toneComponentCount = 0u;
        const std::size_t bits =
            frameHeaderBits(*frames[channel]) + codeChannel(channel, spectra[channel],
                                                            static_cast<std::uint16_t>(kQuCount),
                                                            0.0, true, frames[channel]);
        frames[channel]->usedBits = static_cast<std::uint32_t>(bits);
        total += static_cast<std::uint32_t>(bits);
      }
      return total;
    }

    if (!config.jointStereo) {
      std::uint32_t total = 0u;
      for (std::size_t channel = 0u; channel < count; ++channel) {
        total += static_cast<std::uint32_t>(allocateIndependentChannel(
            channel, spectra[channel], frames[channel], config.maxActiveUnits, kLp2FrameBits));
      }
      return total;
    }

    measure(spectra, count);

    std::array<std::uint16_t, kMaxChannels> active{};
    chooseActiveUnits(count, config.maxActiveUnits, active);
    computeTargets(0u, count, active);

    std::size_t fixed = shared;
    for (std::size_t channel = 0u; channel < count; ++channel) {
      frames[channel]->activeUnits = static_cast<std::uint8_t>(active[channel]);
      frames[channel]->toneComponentCount = 0u;
      fixed += frameHeaderBits(*frames[channel]);
    }

    double lowOffset = -(maxTarget_ + 1.0);
    double highOffset = lowOffset + kAllocSearchSpan;
    for (std::size_t iteration = 0u; iteration < kAllocSearchIterations; ++iteration) {
      const double middle = 0.5 * (lowOffset + highOffset);
      std::size_t bits = fixed;
      for (std::size_t channel = 0u; channel < count; ++channel) {
        bits += codeChannel(channel, spectra[channel], active[channel], middle, false, nullptr);
      }
      if (bits <= config.budgetBits) {
        lowOffset = middle;
      } else {
        highOffset = middle;
      }
    }

    std::uint32_t total = static_cast<std::uint32_t>(shared);
    for (std::size_t channel = 0u; channel < count; ++channel) {
      const std::size_t bits =
          frameHeaderBits(*frames[channel]) +
          codeChannel(channel, spectra[channel], active[channel], lowOffset, true, frames[channel]);
      frames[channel]->usedBits = static_cast<std::uint32_t>(bits);
      total += static_cast<std::uint32_t>(bits);
    }
    return total;
  }

private:
  std::size_t allocateIndependentChannel(std::size_t channel, const double *spectrum,
                                         Atrac3Frame *frame, std::uint16_t maxActiveUnits,
                                         std::size_t budgetBits) noexcept {
    globalPeak_ = 0.0;
    measureChannel(channel, spectrum);

    std::array<std::uint16_t, kMaxChannels> active{};
    active[channel] = chooseActiveUnits(channel, maxActiveUnits);
    computeTargets(channel, 1u, active);

    frame->activeUnits = static_cast<std::uint8_t>(active[channel]);
    frame->toneComponentCount = 0u;
    const std::size_t fixed = frameHeaderBits(*frame);

    double lowOffset = -(maxTarget_ + 1.0);
    double highOffset = lowOffset + kAllocSearchSpan;
    for (std::size_t iteration = 0u; iteration < kAllocSearchIterations; ++iteration) {
      const double middle = 0.5 * (lowOffset + highOffset);
      const std::size_t bits =
          fixed + codeChannel(channel, spectrum, active[channel], middle, false, nullptr);
      if (bits <= budgetBits) {
        lowOffset = middle;
      } else {
        highOffset = middle;
      }
    }

    const std::size_t bits =
        fixed + codeChannel(channel, spectrum, active[channel], lowOffset, true, frame);
    frame->usedBits = static_cast<std::uint32_t>(bits);
    return bits;
  }

  void measure(const double *const *spectra, std::size_t channels) noexcept {
    globalPeak_ = 0.0;
    for (std::size_t channel = 0u; channel < channels; ++channel) {
      measureChannel(channel, spectra[channel]);
    }
  }

  void measureChannel(std::size_t channel, const double *spectrum) noexcept {
    for (std::size_t unit = 0u; unit < kQuCount; ++unit) {
      const std::size_t start = kQuOffset[unit];
      const std::size_t width = kQuWidth[unit];
      double peak = 0.0;
      double energy = 0.0;
      for (std::size_t index = 0u; index < width; ++index) {
        const double value = spectrum[start + index];
        peak = std::max(peak, std::fabs(value));
        energy += value * value;
      }
      peak_[channel][unit] = peak;
      energy_[channel][unit] = energy / static_cast<double>(width);
      globalPeak_ = std::max(globalPeak_, peak);
      std::size_t index = 0u;
      while (index + 1u < kScaleFactor.size() && kScaleFactor[index] < peak) {
        ++index;
      }
      scaleFactor_[channel][unit] = static_cast<std::uint8_t>(index);
    }
  }

  [[nodiscard]] std::uint16_t chooseActiveUnits(std::size_t channel,
                                                std::uint16_t maxActiveUnits) const noexcept {
    const double floor = globalPeak_ * kQuActivityFloor;
    std::uint16_t need = kMinActiveUnits;
    for (std::size_t unit = 0u; unit < kQuCount; ++unit) {
      if (peak_[channel][unit] > floor && peak_[channel][unit] > 0.0) {
        need = static_cast<std::uint16_t>(unit + 1u);
      }
    }
    return std::min(maxActiveUnits, std::max<std::uint16_t>(kMinActiveUnits, need));
  }

  void chooseActiveUnits(std::size_t channels, std::uint16_t maxActiveUnits,
                         std::array<std::uint16_t, kMaxChannels> &active) const noexcept {
    for (std::size_t channel = 0u; channel < channels; ++channel) {
      active[channel] = chooseActiveUnits(channel, maxActiveUnits);
    }
  }

  // Per unit bit targets, btot = T * bvar + (1 - T) * bfix.  For LP4 the mean and
  // the tonality are taken jointly over both channels, so the level difference
  // between mid and side is what decides how the shared budget splits.
  void computeTargets(std::size_t firstChannel, std::size_t channels,
                      const std::array<std::uint16_t, kMaxChannels> &active) noexcept {
    double logSum = 0.0;
    double linearSum = 0.0;
    double meanSum = 0.0;
    std::size_t counted = 0u;
    const std::size_t channelEnd = firstChannel + channels;
    for (std::size_t channel = firstChannel; channel < channelEnd; ++channel) {
      for (std::size_t unit = 0u; unit < static_cast<std::size_t>(active[channel]); ++unit) {
        const double energy = energy_[channel][unit] + kEnergyFloor;
        logSum += std::log(energy);
        linearSum += energy;
        meanSum += 0.5 * std::log2(energy);
        ++counted;
      }
    }
    const double denominator = counted == 0u ? 1.0 : static_cast<double>(counted);
    const double geometric = std::exp(logSum / denominator);
    const double arithmetic = linearSum / denominator;
    double tonality = 1.0 - ((arithmetic > 0.0) ? (geometric / arithmetic) : 1.0);
    tonality = std::min(1.0, std::max(0.0, tonality));
    const double logMean = meanSum / denominator;

    maxTarget_ = 0.0;
    for (std::size_t channel = firstChannel; channel < channelEnd; ++channel) {
      for (std::size_t unit = 0u; unit < kQuCount; ++unit) {
        if (unit >= static_cast<std::size_t>(active[channel])) {
          target_[channel][unit] = 0.0;
          continue;
        }
        const double centre =
            (static_cast<double>(kQuOffset[unit]) + 0.5 * static_cast<double>(kQuWidth[unit])) /
            static_cast<double>(kSpectrumSize);
        const double fixedPart = kFixedProfileTop - kFixedProfileSlope * centre;
        const double variablePart =
            0.5 * std::log2(energy_[channel][unit] + kEnergyFloor) - logMean;
        target_[channel][unit] = tonality * variablePart + (1.0 - tonality) * fixedPart;
        maxTarget_ = std::max(maxTarget_, target_[channel][unit]);
      }
    }
  }

  [[nodiscard]] int wordLengthForOffset(std::size_t channel, std::size_t unit,
                                        double offset) const noexcept {
    const double value = std::floor(target_[channel][unit] + offset + 0.5);
    if (value <= 0.0) {
      return 0;
    }
    if (value >= static_cast<double>(kMaxWordLengthIndex)) {
      return kMaxWordLengthIndex;
    }
    return static_cast<int>(value);
  }

  // Quantizes one channel at a candidate offset and returns the bits it costs.
  // With `store` set the result is written into `frame` as well, so the costing
  // pass and the final pass cannot drift apart.
  std::size_t codeChannel(std::size_t channel, const double *spectrum, std::uint16_t active,
                          double offset, bool store, Atrac3Frame *frame) const noexcept {
    std::size_t bits = 0u;
    for (std::size_t unit = 0u; unit < kQuCount; ++unit) {
      const std::size_t start = kQuOffset[unit];
      const std::size_t width = kQuWidth[unit];
      int wordLength = 0;
      if (unit < static_cast<std::size_t>(active)) {
        bits += kWordLengthBits;
        wordLength =
            transparent_ ? kTransparentWordLengthIndex : wordLengthForOffset(channel, unit, offset);
      }
      if (store) {
        frame->wordLength[unit] = static_cast<std::uint8_t>(wordLength);
        frame->scaleFactorIndex[unit] =
            wordLength > 0 ? scaleFactor_[channel][unit] : static_cast<std::uint8_t>(0u);
      }
      if (wordLength <= 0) {
        if (store) {
          std::fill(frame->quantized.begin() + static_cast<std::ptrdiff_t>(start),
                    frame->quantized.begin() + static_cast<std::ptrdiff_t>(start + width), 0);
        }
        continue;
      }
      bits += kScaleFactorBits;
      const double scale = kScaleFactor[scaleFactor_[channel][unit]];
      const std::int32_t maximum = (static_cast<std::int32_t>(1) << wordLength) - 1;
      const double gain = static_cast<double>(maximum) / scale;
      const int parameter = riceParameter(wordLength);
      for (std::size_t index = 0u; index < width; ++index) {
        const double scaled = spectrum[start + index] * gain;
        std::int32_t value = static_cast<std::int32_t>(
            std::max(-static_cast<double>(maximum),
                     std::min(static_cast<double>(maximum), std::round(scaled))));
        bits += riceLength(value, parameter);
        if (store) {
          frame->quantized[start + index] = value;
        }
      }
    }
    return bits;
  }

  bool transparent_ = false;
  double globalPeak_ = 0.0;
  double maxTarget_ = 0.0;
  std::array<std::vector<double>, kMaxChannels> peak_{};
  std::array<std::vector<double>, kMaxChannels> energy_{};
  std::array<std::vector<double>, kMaxChannels> target_{};
  std::array<std::vector<std::uint8_t>, kMaxChannels> scaleFactor_{};
};

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------
// decodeFrame() consumes the frame of index t and emits the band region t-1,
// which is the first region the overlap add can complete.  The gain envelope of
// region t-1 is held back with it, so the inverse gain is applied to exactly the
// region it was measured on.
class Atrac3Decoder {
public:
  void prepare(const Mdct *mdct) {
    mdct_ = mdct;
    qmf1_.prepare(kFrameSamples / 2u);
    qmf2Low_.prepare(kFrameSamples / 4u);
    qmf2High_.prepare(kFrameSamples / 4u);
    for (std::size_t band = 0u; band < kBandCount; ++band) {
      band_[band].assign(kBandSamples, 0.0);
      overlap_[band].assign(kBandSamples, 0.0);
    }
    low_.assign(kFrameSamples / 2u, 0.0);
    high_.assign(kFrameSamples / 2u, 0.0);
    curve_.assign(kBandSamples, 0.0);
    window_.assign(kWindowSize, 0.0);
    coefficients_.assign(kBlockSize, 0.0);
    frameOut_.assign(kWindowSize, 0.0);
    spectrum_.assign(kSpectrumSize, 0.0);
    for (std::size_t n = 0u; n < kWindowSize; ++n) {
      window_[n] =
          std::sin(kPi / static_cast<double>(kWindowSize) * (static_cast<double>(n) + 0.5));
    }
    reset();
  }

  void reset() noexcept {
    qmf1_.reset();
    qmf2Low_.reset();
    qmf2High_.reset();
    for (std::size_t band = 0u; band < kBandCount; ++band) {
      std::fill(band_[band].begin(), band_[band].end(), 0.0);
      std::fill(overlap_[band].begin(), overlap_[band].end(), 0.0);
      pending_[band].clear();
      pendingStart_[band] = 0;
      levelState_[band] = 0;
    }
    std::fill(spectrum_.begin(), spectrum_.end(), 0.0);
  }

  void decodeFrame(const Atrac3Frame &frame, double *pcm) noexcept {
    dequantize(frame);
    for (std::size_t band = 0u; band < kBandCount; ++band) {
      loadBlock(band, spectrum_.data() + band * kBlockSize, coefficients_.data());
      mdct_->inverse(kBlockSize, coefficients_.data(), frameOut_.data());

      double *out = band_[band].data();
      double *overlap = overlap_[band].data();
      for (std::size_t n = 0u; n < kBandSamples; ++n) {
        out[n] = overlap[n] + frameOut_[n] * window_[n];
      }
      for (std::size_t n = 0u; n < kBandSamples; ++n) {
        overlap[n] = frameOut_[kBandSamples + n] * window_[kBandSamples + n];
      }

      buildGainCurve(pending_[band], pendingStart_[band], curve_.data());
      for (std::size_t n = 0u; n < kBandSamples; ++n) {
        out[n] *= curve_[n];
      }
      pending_[band] = frame.gain[band];
      pendingStart_[band] = levelState_[band];
      levelState_[band] = gainEndLevel(frame.gain[band], levelState_[band]);
    }

    qmf2Low_.process(band_[0].data(), band_[1].data(), kBandSamples, low_.data());
    qmf2High_.process(band_[3].data(), band_[2].data(), kBandSamples, high_.data());
    qmf1_.process(low_.data(), high_.data(), kFrameSamples / 2u, pcm);
  }

private:
  static void loadBlock(std::size_t band, const double *source, double *destination) noexcept {
    if (!kBandReversed[band]) {
      std::copy(source, source + kBlockSize, destination);
      return;
    }
    for (std::size_t index = 0u; index < kBlockSize; ++index) {
      destination[index] = source[kBlockSize - 1u - index];
    }
  }

  void dequantize(const Atrac3Frame &frame) noexcept {
    std::fill(spectrum_.begin(), spectrum_.end(), 0.0);
    const double inverse = 1.0 / kSpectrumScale;
    const std::size_t units = std::min<std::size_t>(frame.activeUnits, kQuCount);
    for (std::size_t unit = 0u; unit < units; ++unit) {
      const int wordLength =
          std::min(kTransparentWordLengthIndex, static_cast<int>(frame.wordLength[unit]));
      if (wordLength <= 0) {
        continue;
      }
      const std::size_t start = kQuOffset[unit];
      const std::size_t width = kQuWidth[unit];
      const double scale = kScaleFactor[frame.scaleFactorIndex[unit]];
      const std::int32_t maximum = (static_cast<std::int32_t>(1) << wordLength) - 1;
      const double gain = scale / static_cast<double>(maximum) * inverse;
      for (std::size_t index = 0u; index < width; ++index) {
        spectrum_[start + index] = static_cast<double>(frame.quantized[start + index]) * gain;
      }
    }
  }

  const Mdct *mdct_ = nullptr;
  QmfSynthesis qmf1_;
  QmfSynthesis qmf2Low_;
  QmfSynthesis qmf2High_;
  std::array<std::vector<double>, kBandCount> band_{};
  std::array<std::vector<double>, kBandCount> overlap_{};
  std::vector<double> low_;
  std::vector<double> high_;
  std::vector<double> curve_;
  std::vector<double> window_;
  std::vector<double> coefficients_;
  std::vector<double> frameOut_;
  std::vector<double> spectrum_;
  std::array<GainEnvelope, kBandCount> pending_{};
  std::array<int, kBandCount> pendingStart_{};
  std::array<int, kBandCount> levelState_{};
};

// ---------------------------------------------------------------------------
// One ATRAC3 codec instance (encoder immediately followed by decoder)
// ---------------------------------------------------------------------------
// Kernel wiring, mirroring the ATRAC1 path:
//   prepare(&mdct)                       once, in PluginKernel::prepare()
//   configure(mode, channels)            at a frame boundary; it resets state
//   processFrame(in, out, stride)        once per kFrameSamples codec samples
// followed by the existing one-sample-per-codec-sample drain of `out`.  The
// caller owns two planar buffers of `stride` >= kFrameSamples doubles per
// channel; nothing is allocated after prepare().
//
// A real time caller that cannot afford a whole frame inside one audio quantum
// can run the frame as four separate steps instead; see the work spreading block
// below.  processFrame() is defined as exactly that sequence, so the two entry
// points are bit identical.
class Atrac3Codec {
public:
  static constexpr std::size_t kMaxChannels = Atrac3Allocator::kMaxChannels;

  void prepare(const Mdct *mdct) {
    for (std::size_t channel = 0u; channel < kMaxChannels; ++channel) {
      encoder_[channel].prepare(mdct);
      decoder_[channel].prepare(mdct);
      spectra_[channel] = encoder_[channel].spectrum();
      framePointer_[channel] = &frame_[channel];
    }
    allocator_.prepare();
    coding_.assign(kMaxChannels * kFrameSamples, 0.0);
    decoded_.assign(kMaxChannels * kFrameSamples, 0.0);
    reset();
  }

  void reset() noexcept {
    for (std::size_t channel = 0u; channel < kMaxChannels; ++channel) {
      encoder_[channel].reset();
      decoder_[channel].reset();
      frame_[channel].clear();
    }
    std::fill(coding_.begin(), coding_.end(), 0.0);
    std::fill(decoded_.begin(), decoded_.end(), 0.0);
    lastFrameBits_ = 0u;
    jointActive_ = false;
  }

  // Structural change: the caller must only do this on a frame boundary, and the
  // codec state is dropped, as the plan requires for mode switches.
  void configure(Mode mode, std::size_t channels) noexcept {
    const std::size_t count = channels >= 2u ? 2u : 1u;
    if (mode == mode_ && count == channels_) {
      return;
    }
    mode_ = mode;
    channels_ = count;
    config_ = modeConfig(mode_, channels_);
    reset();
  }

  [[nodiscard]] Mode mode() const noexcept { return mode_; }
  [[nodiscard]] std::size_t channels() const noexcept { return channels_; }
  [[nodiscard]] const ModeConfig &config() const noexcept { return config_; }
  [[nodiscard]] std::size_t budgetBits() const noexcept { return config_.budgetBits; }
  [[nodiscard]] std::uint32_t lastFrameBits() const noexcept { return lastFrameBits_; }
  [[nodiscard]] const Atrac3Frame &lastFrame(std::size_t index) const noexcept {
    return frame_[index < kMaxChannels ? index : kMaxChannels - 1u];
  }

  void setTransparent(bool transparent) noexcept { allocator_.setTransparent(transparent); }

  // -- Work spreading -------------------------------------------------------
  // One frame as four steps that a real time caller can run at four different
  // codec sample times.  The order is fixed: beginFrame, then analyzeChannel()
  // once per active channel, then allocateFrame, then finishFrame.  The frame
  // input is copied into the codec by beginFrame(), so the caller may reuse its
  // input buffer as soon as that step returns; the decoded samples only become
  // available at finishFrame().  Nothing is allocated by any of the four.
  void beginFrame(const double *input, std::size_t stride) noexcept {
    jointActive_ = config_.jointStereo && channels_ == 2u;
    for (std::size_t n = 0u; n < kFrameSamples; ++n) {
      if (jointActive_) {
        const double left = input[n];
        const double right = input[stride + n];
        coding_[n] = 0.5 * (left + right);
        coding_[kFrameSamples + n] = 0.5 * (left - right);
      } else {
        for (std::size_t channel = 0u; channel < channels_; ++channel) {
          coding_[channel * kFrameSamples + n] = input[channel * stride + n];
        }
      }
    }
  }

  void analyzeChannel(std::size_t channel) noexcept {
    if (channel >= channels_) {
      return;
    }
    frame_[channel].clear();
    encoder_[channel].analyze(coding_.data() + channel * kFrameSamples, frame_[channel]);
  }

  void allocateFrame() noexcept {
    lastFrameBits_ = allocator_.allocate(spectra_.data(), framePointer_.data(), channels_, config_);
  }

  void finishFrame(double *output, std::size_t stride) noexcept {
    for (std::size_t channel = 0u; channel < channels_; ++channel) {
      decoder_[channel].decodeFrame(frame_[channel], decoded_.data() + channel * kFrameSamples);
    }
    for (std::size_t n = 0u; n < kFrameSamples; ++n) {
      if (jointActive_) {
        const double mid = decoded_[n];
        const double side = decoded_[kFrameSamples + n];
        output[n] = mid + side;
        output[stride + n] = mid - side;
      } else {
        for (std::size_t channel = 0u; channel < channels_; ++channel) {
          output[channel * stride + n] = decoded_[channel * kFrameSamples + n];
        }
      }
    }
  }

  void processFrame(const double *input, double *output, std::size_t stride) noexcept {
    beginFrame(input, stride);
    for (std::size_t channel = 0u; channel < channels_; ++channel) {
      analyzeChannel(channel);
    }
    allocateFrame();
    finishFrame(output, stride);
  }

private:
  Mode mode_ = Mode::Lp2;
  std::size_t channels_ = 2u;
  ModeConfig config_ = modeConfig(Mode::Lp2, 2u);
  std::uint32_t lastFrameBits_ = 0u;
  bool jointActive_ = false;
  std::array<Atrac3Encoder, kMaxChannels> encoder_{};
  std::array<Atrac3Decoder, kMaxChannels> decoder_{};
  std::array<Atrac3Frame, kMaxChannels> frame_{};
  std::array<const double *, kMaxChannels> spectra_{};
  std::array<Atrac3Frame *, kMaxChannels> framePointer_{};
  Atrac3Allocator allocator_;
  std::vector<double> coding_;
  std::vector<double> decoded_;
};

} // namespace effetune::md_simulator::atrac3

#endif

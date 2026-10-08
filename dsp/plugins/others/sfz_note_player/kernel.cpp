#include "effetune/kernel.h"
#include "../../analyzer/note_spectrogram/spectral_analysis.h"
#include "SFZNotePlayerPluginParams.h"
#include "bank.h"
#include "effetune/dsp/fir.h"
#include "nothrow_storage.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <memory>

namespace effetune::plugins::others {
namespace {
using namespace sfz;
constexpr std::uint32_t kVoices = 128u;
constexpr std::uint32_t kFilterRadius = 32u, kFilterResolution = 512u;
constexpr std::uint32_t kFilterPhases = 64u, kCachedFilterStep = 8u;
constexpr std::uint32_t kCachedFilterTaps = 2u * kFilterRadius * kCachedFilterStep + 2u;
constexpr float kHysteresis = 0.1F;
constexpr float kRegisterHalfLife = .5F, kRegisterBand = 6.0F;
float bounded(float v, float lo, float hi, float fallback) noexcept {
  if (!std::isfinite(v))
    return fallback;
  return v < lo ? lo : v > hi ? hi : v;
}
bool integer(float v, std::uint32_t low, std::uint32_t high) noexcept {
  return std::isfinite(v) && v >= static_cast<float>(low) && v <= static_cast<float>(high) &&
         std::floor(v) == v;
}
std::uint32_t readU32(const std::uint8_t *p) noexcept {
  return p[0] | static_cast<std::uint32_t>(p[1]) << 8u | static_cast<std::uint32_t>(p[2]) << 16u |
         static_cast<std::uint32_t>(p[3]) << 24u;
}
struct Voice {
  const float *region = nullptr;
  double position = 0.0, step = 1.0;
  float gainLeft = 0.0F, gainRight = 0.0F, envelope = 0.0F, releaseMultiplier = 0.0F;
  float lastLeft = 0.0F, lastRight = 0.0F, stolenLeft = 0.0F, stolenRight = 0.0F;
  std::uint64_t age = 0u, elapsed = 0u;
  std::uint32_t midi = 0u, fade = 0u, releaseFrames = 0u;
  float decayMultiplier = 1.0F;
  bool looped = false;
  bool released = false;
  std::uint32_t filter = kVoices;
  float loopMeanLeft = 0.0F, loopMeanRight = 0.0F;
  bool loopMeanOnly = false;
};
struct SampleFilter {
  double step = 0.0;
  std::uint32_t radius = 0u, taps = 0u;
};
} // namespace

class SFZNotePlayerKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::SFZNotePlayerPluginParams)
public:
  static std::uint32_t assetCapacityForSlot(std::uint32_t slot) noexcept {
    return slot == 0u ? kCapacity : 0u;
  }
  std::uint32_t assetCapacity(std::uint32_t slot) const noexcept override {
    return assetCapacityForSlot(slot);
  }
  void prepare(const PrepareInfo &info) override {
    rate_ = info.sampleRate;
    max_channels_ = info.maxChannels;
    fade_length_ = std::max(1u, static_cast<std::uint32_t>(rate_ * .002F));
    analysis_ = std::make_unique<analyzer::SpectralAnalysis>();
    analysis_->prepare(info);
    latency_ = analysis_->latencySamples();
    maximum_shift_ = static_cast<std::uint32_t>(std::round(rate_ * .1F));
    dry_length_ = latency_ + maximum_shift_ + 1u;
    wet_length_ = maximum_shift_ + 1u;
    voices_ = std::make_unique<std::array<Voice, kVoices>>();
    filters_ = std::make_unique<std::array<SampleFilter, kVoices>>();
    constexpr double pi = 3.14159265358979323846;
    // A 64-tap Blackman-windowed sinc preserves the band below 0.4 of the lower sample rate.
    resampling_filter_ =
        std::make_unique<std::array<float, kFilterRadius * kFilterResolution + 2u>>();
    for (std::size_t i = 0; i < resampling_filter_->size(); ++i) {
      const auto distance = static_cast<double>(i) / kFilterResolution;
      const auto window = .42 + .5 * std::cos(pi * distance / kFilterRadius) +
                          .08 * std::cos(2.0 * pi * distance / kFilterRadius);
      (*resampling_filter_)[i] = static_cast<float>(
          distance >= kFilterRadius ? 0.0
          : distance == 0.0         ? .9
                                    : std::sin(.9 * pi * distance) / (pi * distance) * window);
    }
    prepared_ = analysis_->ready() &&
                dry_.allocate(static_cast<std::size_t>(max_channels_) * dry_length_) &&
                wet_.allocate(2u * wet_length_) &&
                filter_coefficients_.allocate(static_cast<std::size_t>(kVoices) *
                                              (kFilterPhases + 1u) * kCachedFilterTaps);
    clearAsset(0u);
    reset();
  }
  bool preparedSuccessfully() const noexcept override { return prepared_; }
  std::uint32_t latencySamples() const noexcept override {
    const auto timing = bounded(params_.timingOffsetMs, -100, 100, 0);
    return latency_ +
           static_cast<std::uint32_t>(std::round((timing < 0 ? -timing : 0) * rate_ * .001F));
  }
  void reset() noexcept override {
    if (analysis_)
      analysis_->reset(1u);
    clearNotes();
    dry_.clear();
    wet_.clear();
    dry_position_ = 0u;
    wet_position_ = 0u;
    delay_initialized_ = false;
    timing_fade_ = 0u;
    sample_clock_ = last_detection_ = 0u;
    linked_ = false;
    random_ = seed_ ^ (salt_ * 0x9e3779b9u);
    if (random_ == 0u)
      random_ = 1u;
    if (state_ == ET_ASSET_STATE_ACTIVE && indices_.data())
      std::fill_n(indices_.data() + 129u, 2u * group_count_, 0u);
  }
  void setRandomSeed(std::uint32_t low, std::uint32_t high) noexcept override {
    seed_ = low ^ high;
    random_ = seed_ ^ (salt_ * 0x9e3779b9u);
    if (random_ == 0u)
      random_ = 1u;
  }
  void setInstanceSalt(std::uint32_t salt) noexcept override { salt_ = salt; }

  std::uint8_t *beginAsset(std::uint32_t slot, const AssetBeginInfo &info) noexcept override {
    if (slot != 0u || info.channels != 1u || info.topology != 0u ||
        info.byteSize < 32u + kHeader * 4u || info.byteSize % 4u != 0u ||
        info.footprintBytes < info.byteSize + 129u * 4u || info.footprintBytes > kCapacity ||
        static_cast<std::uint64_t>(info.frames) * 4u + 32u != info.byteSize)
      return nullptr;
    clearAsset(0u);
    if (!payload_.allocate(info.byteSize / 4u) ||
        !indices_.allocate((info.footprintBytes - info.byteSize) / 4u)) {
      state_ = ET_ASSET_STATE_ERROR;
      return nullptr;
    }
    begin_ = info;
    state_ = ET_ASSET_STATE_STAGED;
    return reinterpret_cast<std::uint8_t *>(payload_.data());
  }
  et_status commitAsset(std::uint32_t slot, std::uint32_t bytes,
                        std::uint32_t format) noexcept override {
    if (slot != 0u || state_ != ET_ASSET_STATE_STAGED || bytes != begin_.byteSize ||
        format != ET_ASSET_F32_MULTICH)
      return failAsset();
    const auto *raw = reinterpret_cast<const std::uint8_t *>(payload_.data());
    const auto header = [raw](std::uint32_t index) { return readU32(raw + 32u + index * 4u); };
    if (readU32(raw) != 0x31415445u || readU32(raw + 4u) != 1u ||
        readU32(raw + 8u) != begin_.frames || readU32(raw + 12u) != 1u ||
        readU32(raw + 16u) != 0u || readU32(raw + 20u) != 0u || header(0) != kMagic ||
        header(1) != kVersion || header(2) == 0u || header(2) > begin_.frames / kStride ||
        header(3) != kStride || header(4) > begin_.frames ||
        header(4) != kHeader + kStride * header(2) || header(5) != begin_.frames ||
        header(6) == 0u || header(6) > header(2) || header(7) != 0u)
      return failAsset();
    region_count_ = header(2);
    pool_offset_ = header(4);
    group_count_ = header(6);
    if (indices_.size() < 129u + 2u * group_count_)
      return failAsset();
    std::fill_n(indices_.data(), 129u + 2u * group_count_, 0u);
    preparation_ = 0u;
    cursor_ = 0u;
    state_ = ET_ASSET_STATE_PREPARING;
    return ET_OK;
  }
  void clearAsset(std::uint32_t slot) noexcept override {
    if (slot != 0u)
      return;
    state_ = ET_ASSET_STATE_NONE;
    clearNotes();
    payload_.release();
    indices_.release();
  }
  std::uint32_t assetState(std::uint32_t slot) const noexcept override {
    return slot == 0u ? state_ : static_cast<std::uint32_t>(ET_ASSET_STATE_NONE);
  }
  void process(float *audio, std::uint32_t channels, std::uint32_t frames,
               const ProcessInfo &info) noexcept override {
    if (!prepared_ || !audio || !channels || channels > max_channels_)
      return;
    const auto minimum =
        static_cast<std::uint32_t>(std::round(bounded(params_.minimumMidi, 21, 108, 28)));
    const auto maximum = std::max(
        minimum, static_cast<std::uint32_t>(std::round(bounded(params_.maximumMidi, 21, 108, 91))));
    if (analysis_->configure(minimum, maximum)) {
      analysis_->reset(1u);
      clearNotes();
    }
    if (state_ == ET_ASSET_STATE_PREPARING)
      prepareAsset(frames);
    const auto *view = info.noteAnalysis;
    const bool valid = view && view->timeSeconds == info.timeSeconds &&
                       view->blockFrames == frames && view->minimumMidi == minimum &&
                       view->maximumMidi == maximum && view->channels == channels &&
                       view->latencySamples == latency_;
    if (!valid) {
      if (linked_)
        analysis_->reset(1u);
      analysis_->process(audio, channels, frames, info);
      view = &analysis_->view();
    }
    linked_ = valid;
    voice_limit_ =
        static_cast<std::uint32_t>(std::round(bounded(params_.maxVoices, 1, kVoices, 32)));
    for (auto v = voice_limit_; v < kVoices; ++v)
      (*voices_)[v] = {};
    const auto dry_gain = bounded(params_.dryMix, 0, 100, 0) * .01F;
    const auto wet_gain = bounded(params_.wetMix, 0, 100, 100) * .01F;
    const auto output_gain = std::pow(10.0F, bounded(params_.outputGain, -60, 12, 0) * .05F);
    const auto timing = bounded(params_.timingOffsetMs, -100, 100, 0);
    const auto dry_delay = latencySamples();
    const auto wet_delay =
        static_cast<std::uint32_t>(std::round((timing > 0 ? timing : 0) * rate_ * .001F));
    if (!delay_initialized_) {
      dry_delay_ = old_dry_delay_ = dry_delay;
      wet_delay_ = old_wet_delay_ = wet_delay;
      delay_initialized_ = true;
    } else if (dry_delay != dry_delay_ || wet_delay != wet_delay_) {
      old_dry_delay_ = dry_delay_;
      old_wet_delay_ = wet_delay_;
      dry_delay_ = dry_delay;
      wet_delay_ = wet_delay;
      timing_fade_ = fade_length_;
    }
    auto event = 0u;
    for (auto frame = 0u; frame <= frames; ++frame) {
      while (event < view->count && view->frames[event].sampleOffset <= frame) {
        if (state_ == ET_ASSET_STATE_ACTIVE)
          detect(view->frames[event], minimum, maximum, sample_clock_ + frame);
        ++event;
      }
      if (next_note_off_ && sample_clock_ + frame >= next_note_off_)
        expireNoteOffs(sample_clock_ + frame);
      if (frame == frames)
        break;
      float left = 0.0F, right = 0.0F;
      if (state_ == ET_ASSET_STATE_ACTIVE)
        for (auto v = 0u; v < voice_limit_; ++v)
          renderVoice((*voices_)[v], left, right);
      wet_.data()[wet_position_] = left;
      wet_.data()[wet_length_ + wet_position_] = right;
      const auto previous_weight = static_cast<float>(timing_fade_) / fade_length_;
      const auto delayed_sample = [previous_weight](const float *buffer, std::uint32_t length,
                                                    std::uint32_t position, std::uint32_t delay,
                                                    std::uint32_t old_delay) {
        const auto current = buffer[(position + length - delay) % length];
        return previous_weight == 0
                   ? current
                   : current * (1.0F - previous_weight) +
                         buffer[(position + length - old_delay) % length] * previous_weight;
      };
      left = delayed_sample(wet_.data(), wet_length_, wet_position_, wet_delay_, old_wet_delay_);
      right = delayed_sample(wet_.data() + wet_length_, wet_length_, wet_position_, wet_delay_,
                             old_wet_delay_);
      for (auto channel = 0u; channel < channels; ++channel) {
        const auto index = static_cast<std::size_t>(channel) * dry_length_ + dry_position_;
        const auto input = audio[channel * frames + frame];
        dry_.data()[index] = input;
        const auto delayed =
            delayed_sample(dry_.data() + static_cast<std::size_t>(channel) * dry_length_,
                           dry_length_, dry_position_, dry_delay_, old_dry_delay_);
        const auto wet = channels == 1u  ? .5F * (left + right)
                         : channel == 0u ? left
                         : channel == 1u ? right
                                         : 0.0F;
        audio[channel * frames + frame] = (delayed * dry_gain + wet * wet_gain) * output_gain;
      }
      dry_position_ = (dry_position_ + 1u) % dry_length_;
      wet_position_ = (wet_position_ + 1u) % wet_length_;
      if (timing_fade_)
        --timing_fade_;
    }
    sample_clock_ += frames;
  }

private:
  void clearNotes() noexcept {
    if (voices_)
      voices_->fill({});
    latched_.fill(false);
    roles_.fill(0u);
    register_valid_ = false;
    silent_frames_ = 0u;
    wet_.clear();
    wet_position_ = 0u;
    trough_.fill(0.0F);
    onset_peak_.fill(0.0F);
    retrigger_armed_.fill(false);
    retrigger_cooldown_.fill(0u);
    note_off_at_.fill(0u);
    next_note_off_ = 0u;
    age_ = 0u;
  }
  et_status failAsset() noexcept {
    state_ = ET_ASSET_STATE_ERROR;
    clearNotes();
    return ET_ERR_ARGS;
  }
  const float *region(std::uint32_t index) const noexcept {
    return payload_.data() + 8u + kHeader + static_cast<std::size_t>(index) * kStride;
  }
  bool validRegion(const float *r) noexcept {
    for (auto i = 0u; i < kStride; ++i)
      if (!isIndexField(i) && !std::isfinite(r[i]))
        return false;
    const auto sample = indexValue(r, Sample), frames = indexValue(r, Frames),
               offset = indexValue(r, Offset), end = indexValue(r, End),
               loopStart = indexValue(r, LoopStart), loopEnd = indexValue(r, LoopEnd);
    if (sample > begin_.frames - pool_offset_ || frames == 0u || frames > begin_.frames ||
        !integer(r[Channels], 1u, 2u) || !integer(r[Rate], 1u, 768000u) ||
        sample + static_cast<std::uint64_t>(frames) * static_cast<std::uint32_t>(r[Channels]) >
            begin_.frames - pool_offset_ ||
        !integer(r[LowKey], 0u, 127u) ||
        !integer(r[HighKey], static_cast<std::uint32_t>(r[LowKey]), 127u) ||
        !integer(r[LowVelocity], 1u, 127u) ||
        !integer(r[HighVelocity], static_cast<std::uint32_t>(r[LowVelocity]), 127u) ||
        r[LowRandom] < 0 || r[HighRandom] > 1 || r[LowRandom] > r[HighRandom] ||
        !integer(r[SequenceLength], 1u, 16777216u) ||
        !integer(r[SequencePosition], 1u, static_cast<std::uint32_t>(r[SequenceLength])) ||
        !integer(r[SequenceGroup], 0u, group_count_ - 1u) || !integer(r[KeyCenter], 0u, 127u) ||
        offset > end || end >= frames || !integer(r[LoopMode], 0u, 3u) || loopStart > loopEnd ||
        loopEnd > end || r[Attack] < 0 || r[Attack] > 100 || r[Hold] < 0 || r[Hold] > 100 ||
        r[Decay] < 0 || r[Decay] > 100 || r[Release] < 0 || r[Release] > 100 || r[Sustain] < 0 ||
        r[Sustain] > 100 || r[Pan] < -100 || r[Pan] > 100 || r[VelocityTrack] < -100 ||
        r[VelocityTrack] > 100 || r[Volume] < -144 || r[Volume] > 144 || r[KeyTrack] < -1200 ||
        r[KeyTrack] > 1200 || r[Transpose] < -127 || r[Transpose] > 127 ||
        std::floor(r[Transpose]) != r[Transpose] || r[Tune] < -1200 || r[Tune] > 1200)
      return false;
    return true;
  }
  // Admission allocates; validation and index construction advance in bounded processing slices.
  void prepareAsset(std::uint32_t frames) noexcept {
    auto budget = static_cast<std::uint64_t>(frames) * 8u;
    while (budget-- && state_ == ET_ASSET_STATE_PREPARING) {
      if (preparation_ == 0u) {
        if (cursor_ < region_count_) {
          const auto *r = region(cursor_++);
          if (!validRegion(r)) {
            failAsset();
            return;
          }
          for (auto key = static_cast<std::uint32_t>(r[LowKey]);
               key <= static_cast<std::uint32_t>(r[HighKey]); ++key)
            ++indices_.data()[key + 1u];
        } else {
          for (auto key = 1u; key <= 128u; ++key)
            indices_.data()[key] += indices_.data()[key - 1u];
          if (static_cast<std::uint64_t>(indices_.data()[128u]) + 129u + 2u * group_count_ >
              indices_.size()) {
            failAsset();
            return;
          }
          std::copy_n(indices_.data(), 128u, key_cursors_.data());
          cursor_ = 0u;
          preparation_ = 1u;
        }
      } else if (preparation_ == 1u) {
        if (cursor_ < region_count_) {
          const auto *r = region(cursor_);
          for (auto key = static_cast<std::uint32_t>(r[LowKey]);
               key <= static_cast<std::uint32_t>(r[HighKey]); ++key)
            indices_.data()[129u + 2u * group_count_ + key_cursors_[key]++] = cursor_;
          ++cursor_;
        } else {
          cursor_ = pool_offset_;
          preparation_ = 2u;
        }
      } else {
        const auto end = std::min(begin_.frames, cursor_ + 32u);
        for (; cursor_ < end; ++cursor_)
          if (!std::isfinite(payload_.data()[8u + cursor_])) {
            failAsset();
            return;
          }
        if (cursor_ == begin_.frames) {
          state_ = ET_ASSET_STATE_ACTIVE;
          clearNotes();
        }
      }
    }
  }
  void release(Voice &v) noexcept {
    if (!v.region || v.released || v.region[LoopMode] == 1.0F)
      return;
    v.released = true;
    // Keep detected note-offs natural even when an SFZ omits its release envelope.
    const auto duration = std::max(v.region[Release], .2F) * rate_;
    v.releaseFrames = std::max(1u, static_cast<std::uint32_t>(duration));
    v.releaseMultiplier = std::exp(-9.210340372F / v.releaseFrames);
  }
  void releaseKey(std::uint32_t midi) noexcept {
    for (auto &v : *voices_)
      if (v.midi == midi)
        release(v);
  }
  void startOnset(std::uint32_t pitch, float level) noexcept {
    trough_[pitch] = onset_peak_[pitch] = level;
    retrigger_armed_[pitch] = false;
    retrigger_cooldown_[pitch] = 4u;
  }
  void expireNoteOffs(std::uint64_t sample_time) noexcept {
    next_note_off_ = 0u;
    for (auto pitch = 0u; pitch < note_off_at_.size(); ++pitch) {
      const auto deadline = note_off_at_[pitch];
      if (!deadline)
        continue;
      if (deadline <= sample_time) {
        note_off_at_[pitch] = 0u;
        roles_[pitch] = 0u;
        releaseKey(pitch + 21u);
      } else if (!next_note_off_ || deadline < next_note_off_)
        next_note_off_ = deadline;
    }
  }
  void detect(const NoteAnalysisFrame &frame, std::uint32_t minimum, std::uint32_t maximum,
              std::uint64_t sample_time) noexcept {
    const auto threshold = bounded(params_.threshold, .01F, 1.0F, .5F);
    const auto off = threshold > kHysteresis + .005F ? threshold - kHysteresis : .005F;
    const auto retrigger_drop = bounded(params_.retriggerDropDb, 1.0F, 96.0F, 18.0F);
    const auto hold_frames = static_cast<std::uint32_t>(
        std::round(bounded(params_.noteHoldMs, 0.0F, 100.0F, 0.0F) * rate_ * .001F));
    const auto mask = (params_.playLowest >= .5F ? 1u : 0u) |
                      (params_.playMiddle >= .5F ? 2u : 0u) |
                      (params_.playHighest >= .5F ? 4u : 0u);
    if (mask != selection_mask_) {
      register_valid_ = false;
      silent_frames_ = 0u;
      for (auto midi = minimum; midi <= maximum; ++midi)
        if (roles_[midi - 21u] && !(roles_[midi - 21u] & mask)) {
          releaseKey(midi);
          roles_[midi - 21u] = 0u;
          note_off_at_[midi - 21u] = 0u;
        }
      selection_mask_ = mask;
    }
    const auto elapsed = sample_time - last_detection_;
    last_detection_ = sample_time;
    std::array<bool, 88> trigger{};
    int lowest = -1, highest = -1, playing_lowest = -1, playing_highest = -1;
    // Update every input gate before assigning roles, independently of playback selection.
    for (auto midi = minimum; midi <= maximum; ++midi) {
      const auto pitch = midi - 21u;
      if (retrigger_cooldown_[pitch])
        --retrigger_cooldown_[pitch];
      if (latched_[pitch]) {
        if (frame.probabilities[pitch] < off) {
          latched_[pitch] = false;
          if (hold_frames && roles_[pitch]) {
            note_off_at_[pitch] = sample_time + hold_frames;
            if (!next_note_off_ || note_off_at_[pitch] < next_note_off_)
              next_note_off_ = note_off_at_[pitch];
          } else {
            roles_[pitch] = 0u;
            releaseKey(midi);
          }
        } else {
          const auto level = frame.levels[pitch];
          // Raising the setting cancels a pending retrigger from a shallower dip.
          if (retrigger_armed_[pitch] && onset_peak_[pitch] - trough_[pitch] < retrigger_drop)
            retrigger_armed_[pitch] = false;
          // A rising attack is still one onset. Require a fall before another rise.
          if (!retrigger_armed_[pitch]) {
            if (level > onset_peak_[pitch])
              onset_peak_[pitch] = level;
            trough_[pitch] = level;
            retrigger_armed_[pitch] = onset_peak_[pitch] - level >= retrigger_drop;
          } else if (level < trough_[pitch])
            trough_[pitch] = level;
          if (retrigger_armed_[pitch] && !retrigger_cooldown_[pitch] &&
              frame.probabilities[pitch] >= threshold && level - trough_[pitch] >= 6.0F) {
            trigger[pitch] = true;
            startOnset(pitch, level);
          }
        }
      } else if (frame.probabilities[pitch] >= threshold) {
        latched_[pitch] = true;
        // Detection returning during the hold continues the existing note.
        trigger[pitch] = !note_off_at_[pitch];
        note_off_at_[pitch] = 0u;
        startOnset(pitch, frame.levels[pitch]);
      }
      if (latched_[pitch]) {
        if (lowest < 0)
          lowest = static_cast<int>(midi);
        highest = static_cast<int>(midi);
        if ((roles_[pitch] & 1u) && playing_lowest < 0)
          playing_lowest = static_cast<int>(midi);
        if (roles_[pitch] & 4u)
          playing_highest = static_cast<int>(midi);
      }
    }
    if (lowest < 0) {
      silent_frames_ += elapsed;
      if (silent_frames_ >= rate_ * kRegisterHalfLife)
        register_valid_ = false;
      return;
    }
    silent_frames_ = 0u;
    if (!register_valid_) {
      low_register_ = static_cast<float>(lowest);
      high_register_ = static_cast<float>(highest);
      register_valid_ = true;
    } else {
      const auto decay = std::exp2(-static_cast<float>(elapsed) / (rate_ * kRegisterHalfLife));
      low_register_ = highest + (low_register_ - highest) * decay;
      high_register_ = lowest + (high_register_ - lowest) * decay;
      if (playing_lowest >= 0)
        low_register_ = std::min(low_register_, static_cast<float>(playing_lowest));
      if (playing_highest >= 0)
        high_register_ = std::max(high_register_, static_cast<float>(playing_highest));
    }
    // References are a frame-start snapshot, so accepting a note cannot affect its peers.
    const auto low_reference = playing_lowest >= 0 ? playing_lowest : lowest;
    const auto high_reference = playing_highest >= 0 ? playing_highest : highest;
    const auto competitive = [&frame](std::uint32_t midi, int reference, bool inward) {
      if (static_cast<int>(midi) == reference)
        return true;
      const auto pitch = midi - 21u;
      const auto other = static_cast<std::uint32_t>(reference) - 21u;
      const auto probability = frame.probabilities[pitch], level = frame.levels[pitch];
      return probability >= frame.probabilities[other] && level >= frame.levels[other] &&
             (!inward || probability > frame.probabilities[other] || level > frame.levels[other]);
    };
    std::array<std::uint8_t, 88> candidates{};
    for (auto midi = minimum; midi <= maximum; ++midi) {
      const auto pitch = midi - 21u;
      if (!latched_[pitch] || frame.probabilities[pitch] < threshold)
        continue;
      auto roles = static_cast<std::uint8_t>(
          (static_cast<int>(midi) == lowest ? 1u : 0u) |
          (static_cast<int>(midi) > lowest && static_cast<int>(midi) < highest ? 2u : 0u) |
          (static_cast<int>(midi) == highest ? 4u : 0u));
      if (mask != 7u) {
        roles &= 2u;
        if (midi <= low_register_ + kRegisterBand &&
            competitive(midi, low_reference, static_cast<int>(midi) > low_reference))
          roles |= 1u;
        if (midi >= high_register_ - kRegisterBand &&
            competitive(midi, high_reference, static_cast<int>(midi) < high_reference))
          roles |= 4u;
      }
      candidates[pitch] = roles & mask;
    }
    for (auto midi = minimum; midi <= maximum; ++midi) {
      const auto pitch = midi - 21u;
      if (!latched_[pitch])
        continue;
      // Keep the admitted role until its note-off deadline or disabling that role.
      if (roles_[pitch]) {
        if (trigger[pitch])
          noteOn(midi, frame.levels[pitch]);
      } else if (candidates[pitch]) {
        roles_[pitch] = candidates[pitch];
        noteOn(midi, frame.levels[pitch]);
        startOnset(pitch, frame.levels[pitch]);
      }
      if (roles_[pitch] & 1u)
        low_register_ = std::min(low_register_, static_cast<float>(midi));
      if (roles_[pitch] & 4u)
        high_register_ = std::max(high_register_, static_cast<float>(midi));
    }
  }
  void noteOn(std::uint32_t midi, float level) noexcept {
    for (auto &v : *voices_)
      if (v.midi == midi) {
        if (v.region && v.region[LoopMode] == 1.0F) {
          v.released = true;
          v.releaseFrames = fade_length_;
          v.releaseMultiplier = std::exp(-9.210340372F / fade_length_);
        } else
          release(v);
      }
    // Voices retain the detected source key for note-off; only new playback is shifted.
    const auto target_key =
        static_cast<int>(midi) +
        12 * static_cast<int>(std::round(bounded(params_.octaveShift, -2, 2, 0)));
    if (target_key < 0 || target_key > 127)
      return;
    const auto floor = bounded(params_.velocityFloor, -96, 0, -30);
    const auto ceiling = std::max(floor + 1.0F, bounded(params_.velocityCeiling, -60, 24, 3));
    const auto velocity = static_cast<std::uint32_t>(
        std::round(bounded(1.0F + 126.0F * (level - floor) / (ceiling - floor), 1, 127, 1)));
    random_ ^= random_ << 13u;
    random_ ^= random_ >> 17u;
    random_ ^= random_ << 5u;
    const auto random = static_cast<double>(random_) / 4294967296.0;
    const auto *keys = indices_.data() + 129u + 2u * group_count_;
    auto *sequences = indices_.data() + 129u;
    auto *stamps = sequences + group_count_;
    if (++note_serial_ == 0u) {
      std::fill_n(stamps, group_count_, 0u);
      ++note_serial_;
    }
    std::array<const float *, kVoices> selected{};
    std::uint32_t selected_count = 0u;
    // Groups share one sequence counter, advanced once for this note-on.
    for (auto i = indices_.data()[target_key]; i < indices_.data()[target_key + 1]; ++i) {
      const auto *r = region(keys[i]);
      const auto group = static_cast<std::uint32_t>(r[SequenceGroup]);
      if (stamps[group] != note_serial_) {
        stamps[group] = note_serial_;
        ++sequences[group];
      }
      const auto sequence =
          (sequences[group] - 1u) % static_cast<std::uint32_t>(r[SequenceLength]) + 1u;
      if (velocity < r[LowVelocity] || velocity > r[HighVelocity] || random < r[LowRandom] ||
          random >= r[HighRandom] || sequence != r[SequencePosition])
        continue;
      selected[selected_count++ % voice_limit_] = r;
    }
    // When layers exceed polyphony, only the newest surviving voices need initialization.
    const auto retained = std::min(selected_count, voice_limit_);
    const auto first = selected_count - retained;
    for (auto i = first; i < selected_count; ++i) {
      const auto *r = selected[i % voice_limit_];
      Voice *chosen = nullptr;
      for (auto v = 0u; v < voice_limit_; ++v) {
        auto &candidate = (*voices_)[v];
        if (!candidate.region) {
          chosen = &candidate;
          break;
        }
        if (!chosen || (candidate.released && !chosen->released) ||
            (candidate.released == chosen->released && candidate.age < chosen->age))
          chosen = &candidate;
      }
      const auto old_left = chosen->lastLeft, old_right = chosen->lastRight;
      *chosen = {};
      chosen->stolenLeft = old_left;
      chosen->stolenRight = old_right;
      chosen->fade = fade_length_;
      chosen->region = r;
      chosen->midi = midi;
      chosen->position = indexValue(r, Offset);
      chosen->age = ++age_;
      chosen->envelope = r[Attack] > 0.0F ? 0.0F : 1.0F;
      chosen->decayMultiplier =
          r[Decay] > 0.0F ? std::exp(-9.210340372F / (r[Decay] * rate_)) : 0.0F;
      chosen->step =
          std::exp2(((static_cast<double>(target_key) - r[KeyCenter]) * r[KeyTrack] * .01 +
                     r[Transpose] + r[Tune] * .01) /
                    12.0) *
          r[Rate] / rate_;
      configureFilter(*chosen);
      const auto normalized = static_cast<float>(velocity) / 127.0F;
      const auto tracked = r[VelocityTrack] >= 0 ? normalized : (128.0F - velocity) / 127.0F;
      const auto gain =
          std::pow(10.0F, r[Volume] * .05F) * std::pow(tracked, std::abs(r[VelocityTrack]) * .02F);
      const auto pan = r[Pan] * .01F;
      chosen->gainLeft = gain * (pan > 0 ? 1.0F - pan : 1.0F);
      chosen->gainRight = gain * (pan < 0 ? 1.0F + pan : 1.0F);
    }
  }

  float filterCoefficient(double distance) const noexcept {
    const auto magnitude = distance < 0.0 ? -distance : distance;
    if (magnitude >= kFilterRadius)
      return 0.0F;
    const auto at = magnitude * kFilterResolution;
    const auto index = static_cast<std::size_t>(at);
    const auto fraction = static_cast<float>(at - index);
    const auto a = (*resampling_filter_)[index], b = (*resampling_filter_)[index + 1u];
    return a + fraction * (b - a);
  }
  float *filterPhase(std::uint32_t filter, std::uint32_t phase) noexcept {
    return filter_coefficients_.data() +
           (static_cast<std::size_t>(filter) * (kFilterPhases + 1u) + phase) * kCachedFilterTaps;
  }
  void configureFilter(Voice &v) noexcept {
    const auto *r = v.region;
    const auto loop_frames = indexValue(r, LoopEnd) - indexValue(r, LoopStart) + 1u;
    // When every loop harmonic exceeds Nyquist, only its DC component remains in band.
    if ((r[LoopMode] == 2.0F || r[LoopMode] == 3.0F) && v.step >= loop_frames &&
        v.step >= indexValue(r, LoopEnd) + 1.0 - v.position) {
      const auto channels = static_cast<std::uint32_t>(r[Channels]);
      const auto *pcm = payload_.data() + 8u + pool_offset_ + indexValue(r, Sample) +
                        static_cast<std::size_t>(indexValue(r, LoopStart)) * channels;
      double left = 0.0, right = 0.0;
      for (auto frame = 0u; frame < loop_frames; ++frame) {
        left += pcm[static_cast<std::size_t>(frame) * channels];
        right += pcm[static_cast<std::size_t>(frame) * channels + channels - 1u];
      }
      v.loopMeanLeft = static_cast<float>(left / loop_frames);
      v.loopMeanRight = static_cast<float>(right / loop_frames);
      v.loopMeanOnly = true;
      return;
    }
    if (v.step == 1.0 || v.step > kCachedFilterStep)
      return;
    const auto step = v.step > 1.0 ? v.step : 1.0;
    for (auto i = 0u; i < kVoices; ++i)
      if ((*filters_)[i].step == step) {
        v.filter = i;
        return;
      }
    std::array<bool, kVoices> used{};
    for (const auto &voice : *voices_)
      if (voice.region && voice.filter < kVoices)
        used[voice.filter] = true;
    auto slot = 0u;
    while (used[slot])
      ++slot;
    auto &filter = (*filters_)[slot];
    filter.step = step;
    filter.radius = static_cast<std::uint32_t>(std::ceil(kFilterRadius * step));
    filter.taps = 2u * filter.radius + 2u;
    // Share normalized polyphase filters across voices; note-on and playback allocate nothing.
    for (auto phase = 0u; phase <= kFilterPhases; ++phase) {
      auto *coefficients = filterPhase(slot, phase);
      double weight = 0.0;
      for (auto tap = 0u; tap < filter.taps; ++tap) {
        coefficients[tap] = filterCoefficient((static_cast<double>(tap) - filter.radius -
                                               static_cast<double>(phase) / kFilterPhases) /
                                              step);
        weight += coefficients[tap];
      }
      for (auto tap = 0u; tap < filter.taps; ++tap)
        coefficients[tap] = static_cast<float>(coefficients[tap] / weight);
    }
    v.filter = slot;
  }

  float sample(const Voice &v, std::int64_t frame, std::uint32_t channel) const noexcept {
    const auto *r = v.region;
    const bool looping = r[LoopMode] == 2.0F || (r[LoopMode] == 3.0F && !v.released);
    const auto start = static_cast<std::int64_t>(indexValue(r, LoopStart)),
               end = static_cast<std::int64_t>(indexValue(r, LoopEnd));
    if (looping && v.looped && frame < start)
      frame = end - (start - frame - 1) % (end - start + 1);
    if (looping && frame > end)
      frame = start + (frame - start) % (end - start + 1);
    if (frame < 0 || frame > static_cast<int>(indexValue(r, End)))
      return 0.0F;
    const auto channels = static_cast<std::uint32_t>(r[Channels]);
    const auto at = indexValue(r, Sample) + static_cast<std::size_t>(frame) * channels +
                    (channels == 1u ? 0u : channel);
    return payload_.data()[8u + pool_offset_ + at];
  }
  const float *sampleWindow(const Voice &v, std::int64_t first, std::uint32_t count,
                            std::uint32_t channel, float *scratch) const noexcept {
    const auto *r = v.region;
    const auto channels = static_cast<std::uint32_t>(r[Channels]);
    const auto *pcm = payload_.data() + 8u + pool_offset_ + indexValue(r, Sample);
    const bool looping = r[LoopMode] == 2.0F || (r[LoopMode] == 3.0F && !v.released);
    const auto loop_start = static_cast<std::int64_t>(indexValue(r, LoopStart)),
               loop_end = static_cast<std::int64_t>(indexValue(r, LoopEnd)),
               end = static_cast<std::int64_t>(indexValue(r, End));
    if (channels == 1u && first >= (looping && v.looped ? loop_start : 0) &&
        first + count <= (looping ? loop_end : end) + 1)
      return pcm + first;
    auto written = 0u;
    while (written < count) {
      if (looping && ((v.looped && first < loop_start) || first > loop_end)) {
        const auto length = loop_end - loop_start + 1;
        const auto offset = (first - loop_start) % length;
        first = loop_start + (offset < 0 ? offset + length : offset);
      }
      if (first < 0) {
        const auto padding =
            static_cast<std::uint32_t>(std::min<std::int64_t>(count - written, -first));
        std::fill_n(scratch + written, padding, 0.0F);
        first += padding;
        written += padding;
      } else if (first > end) {
        std::fill_n(scratch + written, count - written, 0.0F);
        break;
      } else {
        const auto available = (looping ? loop_end : end) - first + 1;
        const auto chunk =
            static_cast<std::uint32_t>(std::min<std::int64_t>(count - written, available));
        const auto *source = pcm + first * channels + (channels == 1u ? 0u : channel);
        if (channels == 1u)
          std::copy_n(source, chunk, scratch + written);
        else
          for (auto frame = 0u; frame < chunk; ++frame)
            scratch[written + frame] = source[static_cast<std::size_t>(frame) * channels];
        first += chunk;
        written += chunk;
      }
    }
    return scratch;
  }
  float interpolate(const Voice &v, std::uint32_t channel) noexcept {
    if (v.loopMeanOnly && (v.region[LoopMode] == 2.0F || !v.released))
      return channel == 0u ? v.loopMeanLeft : v.loopMeanRight;
    const auto position = static_cast<std::int64_t>(v.position);
    if (v.step == 1.0)
      return sample(v, position, channel);
    if (v.filter < kVoices) {
      const auto &filter = (*filters_)[v.filter];
      const auto at = (v.position - position) * kFilterPhases;
      const auto phase = static_cast<std::uint32_t>(at);
      const auto fraction = at - phase;
      std::array<float, kCachedFilterTaps> scratch;
      const auto *samples =
          sampleWindow(v, position - filter.radius, filter.taps, channel, scratch.data());
      const auto first = dsp::firDot(filterPhase(v.filter, phase), samples, filter.taps);
      if (fraction == 0.0)
        return static_cast<float>(first);
      const auto second = dsp::firDot(filterPhase(v.filter, phase + 1u), samples, filter.taps);
      return static_cast<float>(first + fraction * (second - first));
    }
    // Uncached large shifts keep the same band limit without extending cache memory.
    const auto scale = 1.0 / v.step, radius = kFilterRadius * v.step;
    const bool looping = v.region[LoopMode] == 2.0F || (v.region[LoopMode] == 3.0F && !v.released);
    const auto lower = std::ceil(v.position - radius), upper = std::floor(v.position + radius);
    const auto first = static_cast<std::int64_t>(looping || lower > 0.0 ? lower : 0.0);
    const auto end = static_cast<double>(indexValue(v.region, End));
    const auto last = static_cast<std::int64_t>(looping || upper < end ? upper : end);
    double value = 0.0;
    for (auto frame = first; frame <= last; ++frame)
      value += filterCoefficient((frame - v.position) * scale) * sample(v, frame, channel);
    return static_cast<float>(value * scale);
  }
  void renderVoice(Voice &v, float &left, float &right) noexcept {
    float l = 0.0F, r = 0.0F;
    if (v.region) {
      const auto *region = v.region;
      if (v.released) {
        v.envelope *= v.releaseMultiplier;
        if (v.releaseFrames == 0u || --v.releaseFrames == 0u)
          v.envelope = 0.0F;
      } else {
        const auto time = static_cast<double>(v.elapsed) / rate_;
        const auto attack = region[Attack], hold = region[Hold], decay = region[Decay],
                   sustain = region[Sustain] * .01F;
        if (attack > 0 && time < attack)
          v.envelope = static_cast<float>(time / attack);
        else if (time < attack + hold)
          v.envelope = 1.0F;
        else if (decay > 0 && time < attack + hold + decay)
          v.envelope = std::max(sustain, v.envelope * v.decayMultiplier);
        else
          v.envelope = sustain;
      }
      const auto sample_left = interpolate(v, 0u);
      const auto sample_right = region[Channels] == 1.0F ? sample_left : interpolate(v, 1u);
      l = sample_left * v.gainLeft * v.envelope;
      r = sample_right * v.gainRight * v.envelope;
      ++v.elapsed;
      v.position += v.step;
      if (region[LoopMode] == 2.0F || (region[LoopMode] == 3.0F && !v.released)) {
        const auto start = indexValue(region, LoopStart);
        const auto end = indexValue(region, LoopEnd) + 1.0;
        if (v.position >= end) {
          v.looped = true;
          v.position = start + std::fmod(v.position - start, end - start);
        }
      }
      if (v.position >= indexValue(region, End) + 1.0 || (v.released && v.envelope <= 0.0F) ||
          (!v.released && region[Sustain] == 0.0F &&
           v.elapsed / rate_ >= region[Attack] + region[Hold] + region[Decay]))
        v.region = nullptr;
    }
    if (v.fade) {
      const auto weight = static_cast<float>(v.fade--) / fade_length_;
      l = l * (1.0F - weight) + v.stolenLeft * weight;
      r = r * (1.0F - weight) + v.stolenRight * weight;
    }
    v.lastLeft = l;
    v.lastRight = r;
    left += l;
    right += r;
  }
  std::unique_ptr<analyzer::SpectralAnalysis> analysis_;
  std::unique_ptr<std::array<Voice, kVoices>> voices_;
  std::unique_ptr<std::array<SampleFilter, kVoices>> filters_;
  std::unique_ptr<std::array<float, kFilterRadius * kFilterResolution + 2u>> resampling_filter_;
  NothrowStorage<float> dry_, wet_, payload_;
  NothrowStorage<float> filter_coefficients_;
  NothrowStorage<std::uint32_t> indices_;
  std::array<std::uint32_t, 128> key_cursors_{};
  std::array<bool, 88> latched_{};
  std::array<std::uint8_t, 88> roles_{};
  std::array<float, 88> trough_{};
  std::array<float, 88> onset_peak_{};
  std::array<bool, 88> retrigger_armed_{};
  std::array<std::uint32_t, 88> retrigger_cooldown_{};
  std::array<std::uint64_t, 88> note_off_at_{};
  AssetBeginInfo begin_{};
  float rate_ = 48000.0F;
  std::uint32_t max_channels_ = 0u, latency_ = 0u, dry_position_ = 0u, fade_length_ = 96u;
  std::uint32_t maximum_shift_ = 0u, dry_length_ = 0u, wet_length_ = 0u, wet_position_ = 0u;
  std::uint32_t dry_delay_ = 0u, old_dry_delay_ = 0u, wet_delay_ = 0u, old_wet_delay_ = 0u,
                timing_fade_ = 0u, selection_mask_ = 7u;
  std::uint32_t state_ = ET_ASSET_STATE_NONE, region_count_ = 0u, group_count_ = 0u,
                pool_offset_ = 0u;
  std::uint32_t preparation_ = 0u, cursor_ = 0u, voice_limit_ = 32u, seed_ = 1u, salt_ = 0u,
                random_ = 1u;
  std::uint64_t age_ = 0u;
  std::uint64_t sample_clock_ = 0u, last_detection_ = 0u, silent_frames_ = 0u;
  std::uint64_t next_note_off_ = 0u;
  float low_register_ = 0.0F, high_register_ = 0.0F;
  std::uint32_t note_serial_ = 0u;
  bool prepared_ = false, linked_ = false, register_valid_ = false, delay_initialized_ = false;
};
static_assert(sizeof(SFZNotePlayerKernel) <= 8192u);
} // namespace effetune::plugins::others
EFFETUNE_REGISTER_KERNEL(SFZNotePlayerPlugin, effetune::plugins::others::SFZNotePlayerKernel)

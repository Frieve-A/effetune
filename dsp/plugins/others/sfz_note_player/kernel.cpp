#include "effetune/kernel.h"
#include "../../analyzer/note_spectrogram/spectral_analysis.h"
#include "SFZNotePlayerPluginParams.h"
#include "bank.h"
#include "binary_io.h"
#include "effetune/dsp/fir.h"
#include "nothrow_storage.h"
#include "onset_rule.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <limits>
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
  std::uint32_t midi = 0u, outputMidi = 0u, velocity = 0u, fade = 0u, releaseFrames = 0u;
  float decayMultiplier = 1.0F;
  bool looped = false;
  bool released = false;
  bool preview = false;
  std::uint32_t filter = kVoices;
  float loopMeanLeft = 0.0F, loopMeanRight = 0.0F;
  bool loopMeanOnly = false;
};
struct SampleFilter {
  double step = 0.0;
  std::uint32_t radius = 0u, taps = 0u;
};

// Playback owns exactly one bank; prepared updates carry its replacement or retirement.
struct SFZBank final : PreparedAsset {
  NothrowStorage<float> payload_;
  NothrowStorage<std::uint32_t> indices_;
  AssetBeginInfo begin_{};
  std::array<std::uint32_t, 128> key_cursors_{};
  std::uint32_t state_ = ET_ASSET_STATE_NONE, region_count_ = 0u, group_count_ = 0u,
                pool_offset_ = 0u, preparation_ = 0u, cursor_ = 0u;

  et_status allocate(const AssetBeginInfo &info) noexcept {
    if (info.channels != 1u || info.topology != 0u || info.byteSize < 32u + kHeader * 4u ||
        info.byteSize % 4u != 0u ||
        static_cast<std::uint64_t>(info.footprintBytes) <
            static_cast<std::uint64_t>(info.byteSize) + 129u * 4u ||
        info.footprintBytes > kCapacity ||
        static_cast<std::uint64_t>(info.frames) * 4u + 32u != info.byteSize)
      return ET_ERR_ARGS;
    if (!payload_.allocate(info.byteSize / 4u) ||
        !indices_.allocate((info.footprintBytes - info.byteSize) / 4u))
      return ET_ERR_OOM;
    begin_ = info;
    state_ = ET_ASSET_STATE_STAGED;
    return ET_OK;
  }
  et_status commit(std::uint32_t bytes, std::uint32_t format) noexcept {
    if (state_ != ET_ASSET_STATE_STAGED || bytes != begin_.byteSize ||
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
    state_ = ET_ASSET_STATE_PREPARING;
    return ET_OK;
  }
  et_status failAsset() noexcept {
    state_ = ET_ASSET_STATE_ERROR;
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
  // The legacy API advances in slices; native preparation completes off audio.
  void prepareSlice(std::uint64_t budget) noexcept {
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
        }
      }
    }
  }

  static et_status prepare(const AssetBeginInfo &info, const std::uint8_t *payload,
                           std::uint32_t format, std::unique_ptr<PreparedAsset> &asset) noexcept {
    auto next = std::unique_ptr<SFZBank>(new (std::nothrow) SFZBank());
    if (!next)
      return ET_ERR_OOM;
    const auto allocated = next->allocate(info);
    if (allocated != ET_OK)
      return allocated;
    std::memcpy(next->payload_.data(), payload, info.byteSize);
    const auto committed = next->commit(info.byteSize, format);
    if (committed != ET_OK)
      return committed;
    next->prepareSlice(std::numeric_limits<std::uint64_t>::max());
    if (next->state_ != ET_ASSET_STATE_ACTIVE)
      return ET_ERR_ARGS;
    asset = std::move(next);
    return ET_OK;
  }
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
    event_latency_ = analysis_->eventLatencySamples();
    maximum_shift_ = static_cast<std::uint32_t>(std::round(rate_ * .1F));
    hop_ = analysis_->hopSamples();
    dry_length_ = event_latency_ + hop_ / 2u + maximum_shift_ + 1u;
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
    return (params_.detection == 1.0F ? event_latency_ : latency_) + hop_ / 2u +
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
    event_source_ = nullptr;
    event_generation_ = 0u;
    random_ = seed_ ^ (salt_ * 0x9e3779b9u);
    if (random_ == 0u)
      random_ = 1u;
    if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
      std::fill_n(bank()->indices_.data() + 129u, 2u * bank()->group_count_, 0u);
  }
  void setRandomSeed(std::uint32_t low, std::uint32_t high) noexcept override {
    seed_ = low ^ high;
    random_ = seed_ ^ (salt_ * 0x9e3779b9u);
    if (random_ == 0u)
      random_ = 1u;
  }
  void setInstanceSalt(std::uint32_t salt) noexcept override { salt_ = salt; }

  AssetPreparer assetPreparer(std::uint32_t slot) const noexcept override {
    return slot == 0u ? &SFZBank::prepare : nullptr;
  }
  et_status exchangePreparedAsset(std::uint32_t slot,
                                  std::unique_ptr<PreparedAsset> &asset) noexcept override {
    if (slot != 0u)
      return ET_ERR_UNSUPPORTED;
    bank_.swap(asset);
    // Drop old voice references before the next playback access, without touching PCM here.
    notes_reset_pending_ = true;
    return ET_OK;
  }
  std::uint8_t *beginAsset(std::uint32_t slot, const AssetBeginInfo &info) noexcept override {
    if (slot != 0u)
      return nullptr;
    auto next = std::unique_ptr<SFZBank>(new (std::nothrow) SFZBank());
    if (!next || next->allocate(info) != ET_OK)
      return nullptr;
    clearNotes();
    bank_ = std::move(next);
    return reinterpret_cast<std::uint8_t *>(bank()->payload_.data());
  }
  et_status commitAsset(std::uint32_t slot, std::uint32_t bytes,
                        std::uint32_t format) noexcept override {
    if (slot != 0u || !bank())
      return ET_ERR_ARGS;
    const auto status = bank()->commit(bytes, format);
    if (status != ET_OK)
      clearNotes();
    return status;
  }
  void clearAsset(std::uint32_t slot) noexcept override {
    if (slot != 0u)
      return;
    clearNotes();
    bank_.reset();
  }
  std::uint32_t assetState(std::uint32_t slot) const noexcept override {
    return slot == 0u && bank() ? bank()->state_ : static_cast<std::uint32_t>(ET_ASSET_STATE_NONE);
  }
  void process(float *audio, std::uint32_t channels, std::uint32_t frames,
               const ProcessInfo &info) noexcept override {
    if (!prepared_ || !audio || !channels || channels > max_channels_)
      return;
    const bool event_detection = params_.detection == 1.0F;
    if (event_detection_ != event_detection) {
      event_detection_ = event_detection;
      analysis_->setEventEnabled(event_detection_);
      reset();
    }
    const auto minimum =
        static_cast<std::uint32_t>(std::round(bounded(params_.minimumMidi, 21, 108, 28)));
    const auto maximum = std::max(
        minimum, static_cast<std::uint32_t>(std::round(bounded(params_.maximumMidi, 21, 108, 91))));
    if (analysis_->configure(minimum, maximum)) {
      analysis_->reset(1u);
      clearNotes();
    }
    if (notes_reset_pending_)
      clearNotes();
    if (bank() && bank()->state_ == ET_ASSET_STATE_PREPARING) {
      bank()->prepareSlice(static_cast<std::uint64_t>(frames) * 8u);
      if (bank()->state_ != ET_ASSET_STATE_PREPARING)
        clearNotes();
    }
    const auto *view = info.noteAnalysis;
    const bool valid =
        view && view->timeSeconds == info.timeSeconds && view->blockFrames == frames &&
        view->minimumMidi == minimum && view->maximumMidi == maximum &&
        view->channels == channels && view->latencySamples == latency_ &&
        (!event_detection_ || (view->eventFrames && view->eventLatencySamples == event_latency_));
    if (!valid) {
      if (linked_)
        analysis_->reset(1u);
      analysis_->process(audio, channels, frames, info);
      view = &analysis_->view();
    }
    linked_ = valid;
    if (event_detection_ &&
        (event_source_ != view->eventSource || event_generation_ != view->eventGeneration)) {
      // A new boundary stream cannot end notes admitted by the previous stream.
      for (auto &voice : *voices_)
        if (!voice.preview)
          release(voice);
      clearDetectionState();
      event_source_ = view->eventSource;
      event_generation_ = view->eventGeneration;
    }
    voice_limit_ =
        static_cast<std::uint32_t>(std::round(bounded(params_.maxVoices, 1, kVoices, 32)));
    for (auto v = voice_limit_; v < kVoices; ++v)
      (*voices_)[v] = {};
    updatePreview();
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
    const auto *detection_frames = event_detection_ ? view->eventFrames : view->frames;
    for (auto frame = 0u; frame <= frames; ++frame) {
      while (event < view->count && detection_frames[event].sampleOffset <= frame) {
        if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
          detect(detection_frames[event], minimum, maximum, sample_clock_ + frame);
        ++event;
      }
      if (frame == frames)
        break;
      if (next_note_event_ && sample_clock_ + frame >= next_note_event_)
        processNoteEvents(sample_clock_ + frame);
      float left = 0.0F, right = 0.0F;
      if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
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

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    // One record per output key: active sample voices and velocity with a one-second decay.
    std::array<std::uint8_t, 4u + 128u * 8u> payload{};
    std::array<std::uint16_t, 128> counts{};
    std::array<float, 128> velocities{};
    std::uint16_t total = 0u;
    if (voices_ && !notes_reset_pending_)
      for (const auto &voice : *voices_) {
        if (!voice.region)
          continue;
        ++total;
        ++counts[voice.outputMidi];
        const auto velocity = static_cast<float>(voice.velocity) / 127.0F *
                              std::exp(-static_cast<float>(voice.elapsed) / rate_);
        if (velocity > velocities[voice.outputMidi])
          velocities[voice.outputMidi] = velocity;
      }
    binary_io::writeU16(payload.data(), total);
    binary_io::writeU16(payload.data() + 2u, static_cast<std::uint16_t>(voice_limit_));
    for (auto midi = 0u; midi < 128u; ++midi) {
      auto *record = payload.data() + 4u + midi * 8u;
      binary_io::writeU16(record, counts[midi]);
      binary_io::writeF32(record + 4u, velocities[midi]);
    }
    writer.write(30u, 1u, payload.data(), static_cast<std::uint16_t>(payload.size()));
  }

private:
  SFZBank *bank() noexcept { return static_cast<SFZBank *>(bank_.get()); }
  const SFZBank *bank() const noexcept { return static_cast<const SFZBank *>(bank_.get()); }
  const float *region(std::uint32_t index) const noexcept { return bank()->region(index); }
  void clearNotes() noexcept {
    notes_reset_pending_ = false;
    if (voices_)
      voices_->fill({});
    clearDetectionState();
    wet_.clear();
    wet_position_ = 0u;
    age_ = 0u;
    preview_midi_ = -1;
  }
  void clearDetectionState() noexcept {
    onset_rules_.fill({});
    roles_.fill(0u);
    register_valid_ = false;
    silent_frames_ = 0u;
    trough_.fill(0.0F);
    onset_peak_.fill(0.0F);
    retrigger_armed_.fill(false);
    retrigger_cooldown_.fill(0u);
    note_off_at_.fill(0u);
    note_on_at_.fill(0u);
    output_note_off_at_.fill(0u);
    released_at_.fill(0u);
    note_on_level_.fill(0.0F);
    next_note_event_ = 0u;
  }
  void release(Voice &v, bool preview = false) noexcept {
    if (!v.region || v.released || (!preview && v.region[LoopMode] == 1.0F))
      return;
    v.released = true;
    // Keep detected note-offs natural even when an SFZ omits its release envelope.
    const auto duration = preview ? fade_length_ : std::max(v.region[Release], .2F) * rate_;
    v.releaseFrames = std::max(1u, static_cast<std::uint32_t>(duration));
    v.releaseMultiplier = std::exp(-9.210340372F / v.releaseFrames);
  }
  void releaseKey(std::uint32_t midi, bool preview = false) noexcept {
    for (auto &v : *voices_)
      if (v.midi == midi && v.preview == preview)
        release(v, preview);
  }
  void updatePreview() noexcept {
    if (!bank() || bank()->state_ != ET_ASSET_STATE_ACTIVE)
      return;
    const auto midi = static_cast<int>(std::round(bounded(params_.previewMidi, -1, 127, -1)));
    if (midi == preview_midi_)
      return;
    if (preview_midi_ >= 0)
      releaseKey(static_cast<std::uint32_t>(preview_midi_), true);
    preview_midi_ = midi;
    if (midi >= 0) {
      const auto velocity =
          static_cast<std::uint32_t>(std::round(bounded(params_.previewVelocity, 1, 127, 100)));
      startVoices(static_cast<std::uint32_t>(midi), midi, velocity, true);
    }
  }
  void startOnset(std::uint32_t pitch, float level) noexcept {
    trough_[pitch] = onset_peak_[pitch] = level;
    retrigger_armed_[pitch] = false;
    retrigger_cooldown_[pitch] = 4u;
  }
  void scheduleNoteEvent(std::uint64_t time) noexcept {
    if (!next_note_event_ || time < next_note_event_)
      next_note_event_ = time;
  }
  void scheduleNoteOff(std::uint32_t pitch, std::uint64_t time) noexcept {
    output_note_off_at_[pitch] = time + hop_ / 2u;
    scheduleNoteEvent(output_note_off_at_[pitch]);
  }
  void scheduleNoteOn(std::uint32_t pitch, float level, std::uint64_t time,
                      double delta = 0.0) noexcept {
    note_off_at_[pitch] = output_note_off_at_[pitch] = 0u;
    note_on_at_[pitch] = time + static_cast<std::uint64_t>(std::round((delta + .5) * hop_));
    note_on_level_[pitch] = level;
    scheduleNoteEvent(note_on_at_[pitch]);
  }
  void processNoteEvents(std::uint64_t sample_time) noexcept {
    // Detection deadlines and output reservations live on separate time axes.
    for (auto pitch = 0u; pitch < note_off_at_.size(); ++pitch)
      if (note_off_at_[pitch] && note_off_at_[pitch] <= sample_time) {
        scheduleNoteOff(pitch, note_off_at_[pitch]);
        note_off_at_[pitch] = 0u;
        roles_[pitch] = 0u;
      }
    // A release at the same sample always precedes a new attack.
    for (auto pitch = 0u; pitch < output_note_off_at_.size(); ++pitch)
      if (output_note_off_at_[pitch] && output_note_off_at_[pitch] <= sample_time) {
        output_note_off_at_[pitch] = 0u;
        releaseKey(pitch + 21u);
      }
    for (auto pitch = 0u; pitch < note_on_at_.size(); ++pitch)
      if (note_on_at_[pitch] && note_on_at_[pitch] <= sample_time) {
        note_on_at_[pitch] = 0u;
        noteOn(pitch + 21u, note_on_level_[pitch]);
      }
    next_note_event_ = 0u;
    for (auto pitch = 0u; pitch < note_off_at_.size(); ++pitch)
      for (const auto time : {note_off_at_[pitch], output_note_off_at_[pitch], note_on_at_[pitch]})
        if (time)
          scheduleNoteEvent(time);
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
          note_off_at_[midi - 21u] = note_on_at_[midi - 21u] = output_note_off_at_[midi - 21u] = 0u;
        }
      selection_mask_ = mask;
    }
    const auto elapsed = sample_time - last_detection_;
    last_detection_ = sample_time;
    std::array<bool, 88> trigger{}, eligible{};
    std::array<double, 88> delta{};
    int lowest = -1, highest = -1, playing_lowest = -1, playing_highest = -1;
    // Update every input gate before assigning roles, independently of playback selection.
    for (auto midi = minimum; midi <= maximum; ++midi) {
      const auto pitch = midi - 21u;
      auto &rule = onset_rules_[pitch];
      const bool onset_range = midi <= analyzer::harmnet_weights::kOnsetMaximumMidi;
      const bool was_latched = rule.latched();
      const OnsetRuleSettings settings{
          threshold,
          off,
          analyzer::harmnet_weights::kOnsetThreshold,
          analyzer::harmnet_weights::kOnsetProminence,
          analyzer::harmnet_weights::kOnsetGate,
          onset_range ? analyzer::harmnet_weights::kOnsetRefractoryFrames : 0u};
      const auto decision = event_detection_
                                ? rule.stepEvent(frame.starts[pitch], frame.ends[pitch])
                                : rule.step(frame.probabilities[pitch],
                                            onset_range ? frame.onsets[pitch] : 0.0F, settings);
      if (decision.released && roles_[pitch]) {
        released_at_[pitch] = sample_time;
        const auto extension = std::max(hold_frames, rule.cooldown() * hop_);
        if (extension) {
          note_off_at_[pitch] = sample_time + extension;
          scheduleNoteEvent(note_off_at_[pitch]);
        } else {
          roles_[pitch] = 0u;
          scheduleNoteOff(pitch, sample_time);
        }
      }
      trigger[pitch] = decision.fire != OnsetFire::None;
      // Only the classic onset head was trained with the triangular sub-frame target.
      delta[pitch] = event_detection_ ? 0.0 : decision.delta;
      if (decision.fire == OnsetFire::Fallback && roles_[pitch] && note_off_at_[pitch] &&
          hold_frames && sample_time <= released_at_[pitch] + hold_frames) {
        // Only Note Hold, rather than a refractory extension, continues a fallback.
        trigger[pitch] = false;
        note_off_at_[pitch] = 0u;
      } else if (decision.fire == OnsetFire::None && !was_latched && rule.latched() &&
                 roles_[pitch] && note_off_at_[pitch] && sample_time <= note_off_at_[pitch]) {
        note_off_at_[pitch] = 0u;
      }
      if (!event_detection_ && !onset_range) {
        if (retrigger_cooldown_[pitch])
          --retrigger_cooldown_[pitch];
        if (decision.fire != OnsetFire::None)
          startOnset(pitch, frame.levels[pitch]);
        else if (was_latched && rule.latched()) {
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
      }
      eligible[pitch] =
          rule.latched() && rule.active() &&
          (event_detection_ || frame.probabilities[pitch] >= threshold || trigger[pitch]);
      if (eligible[pitch]) {
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
      if (!eligible[pitch])
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
      if (!onset_rules_[pitch].latched())
        continue;
      // Keep the admitted role until its note-off deadline or disabling that role.
      if (roles_[pitch]) {
        if (trigger[pitch])
          scheduleNoteOn(pitch, frame.levels[pitch], sample_time, delta[pitch]);
      } else if (candidates[pitch] && (!event_detection_ || trigger[pitch])) {
        roles_[pitch] = candidates[pitch];
        scheduleNoteOn(pitch, frame.levels[pitch], sample_time, delta[pitch]);
        if (!event_detection_ && midi > analyzer::harmnet_weights::kOnsetMaximumMidi)
          startOnset(pitch, frame.levels[pitch]);
      }
      if (roles_[pitch] & 1u)
        low_register_ = std::min(low_register_, static_cast<float>(midi));
      if (roles_[pitch] & 4u)
        high_register_ = std::max(high_register_, static_cast<float>(midi));
    }
  }
  void noteOn(std::uint32_t midi, float level) noexcept {
    const auto target_key =
        static_cast<int>(midi) +
        12 * static_cast<int>(std::round(bounded(params_.octaveShift, -2, 2, 0)));
    const auto floor = bounded(params_.velocityFloor, -96, 0, -30);
    const auto ceiling = std::max(floor + 1.0F, bounded(params_.velocityCeiling, -60, 24, 3));
    const auto velocity = static_cast<std::uint32_t>(
        std::round(bounded(1.0F + 126.0F * (level - floor) / (ceiling - floor), 1, 127, 1)));
    startVoices(midi, target_key, velocity, false);
  }
  void startVoices(std::uint32_t midi, int target_key, std::uint32_t velocity,
                   bool preview) noexcept {
    for (auto &v : *voices_)
      if (v.midi == midi && v.preview == preview) {
        if (v.region && v.region[LoopMode] == 1.0F) {
          v.released = true;
          v.releaseFrames = fade_length_;
          v.releaseMultiplier = std::exp(-9.210340372F / fade_length_);
        } else
          release(v, preview);
      }
    if (target_key < 0 || target_key > 127)
      return;
    // Select a neighboring key's timbre, but tune playback to the unshifted target key.
    const auto sample_key =
        target_key + static_cast<int>(std::round(bounded(params_.sampleShift, -6, 6, 0)));
    if (sample_key < 0 || sample_key > 127)
      return;
    random_ ^= random_ << 13u;
    random_ ^= random_ >> 17u;
    random_ ^= random_ << 5u;
    const auto random = static_cast<double>(random_) / 4294967296.0;
    const auto *keys = bank()->indices_.data() + 129u + 2u * bank()->group_count_;
    auto *sequences = bank()->indices_.data() + 129u;
    auto *stamps = sequences + bank()->group_count_;
    if (++note_serial_ == 0u) {
      std::fill_n(stamps, bank()->group_count_, 0u);
      ++note_serial_;
    }
    std::array<const float *, kVoices> selected{};
    std::uint32_t selected_count = 0u;
    // Groups share one sequence counter, advanced once for this note-on.
    for (auto i = bank()->indices_.data()[sample_key]; i < bank()->indices_.data()[sample_key + 1];
         ++i) {
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
      chosen->outputMidi = static_cast<std::uint32_t>(target_key);
      chosen->velocity = velocity;
      chosen->preview = preview;
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
      const auto *pcm = bank()->payload_.data() + 8u + bank()->pool_offset_ +
                        indexValue(r, Sample) +
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
    return bank()->payload_.data()[8u + bank()->pool_offset_ + at];
  }
  const float *sampleWindow(const Voice &v, std::int64_t first, std::uint32_t count,
                            std::uint32_t channel, float *scratch) const noexcept {
    const auto *r = v.region;
    const auto channels = static_cast<std::uint32_t>(r[Channels]);
    const auto *pcm = bank()->payload_.data() + 8u + bank()->pool_offset_ + indexValue(r, Sample);
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
  NothrowStorage<float> dry_, wet_;
  std::unique_ptr<PreparedAsset> bank_;
  NothrowStorage<float> filter_coefficients_;
  std::array<OnsetRule, 88> onset_rules_{};
  std::array<std::uint8_t, 88> roles_{};
  std::array<float, 88> trough_{};
  std::array<float, 88> onset_peak_{};
  std::array<bool, 88> retrigger_armed_{};
  std::array<std::uint32_t, 88> retrigger_cooldown_{};
  std::array<std::uint64_t, 88> note_off_at_{}, note_on_at_{}, output_note_off_at_{},
      released_at_{};
  std::array<float, 88> note_on_level_{};
  float rate_ = 48000.0F;
  std::uint32_t max_channels_ = 0u, latency_ = 0u, event_latency_ = 0u, hop_ = 0u,
                dry_position_ = 0u, fade_length_ = 96u;
  std::uint32_t maximum_shift_ = 0u, dry_length_ = 0u, wet_length_ = 0u, wet_position_ = 0u;
  std::uint32_t dry_delay_ = 0u, old_dry_delay_ = 0u, wet_delay_ = 0u, old_wet_delay_ = 0u,
                timing_fade_ = 0u, selection_mask_ = 7u;
  std::uint32_t voice_limit_ = 32u, seed_ = 1u, salt_ = 0u, random_ = 1u;
  std::uint64_t age_ = 0u;
  int preview_midi_ = -1;
  std::uint64_t sample_clock_ = 0u, last_detection_ = 0u, silent_frames_ = 0u;
  std::uint64_t next_note_event_ = 0u;
  float low_register_ = 0.0F, high_register_ = 0.0F;
  std::uint32_t note_serial_ = 0u;
  bool notes_reset_pending_ = false;
  bool event_detection_ = false;
  const void *event_source_ = nullptr;
  std::uint64_t event_generation_ = 0u;
  bool prepared_ = false, linked_ = false, register_valid_ = false, delay_initialized_ = false;
};
static_assert(sizeof(SFZNotePlayerKernel) <= 8192u);
} // namespace effetune::plugins::others
EFFETUNE_REGISTER_KERNEL(SFZNotePlayerPlugin, effetune::plugins::others::SFZNotePlayerKernel)

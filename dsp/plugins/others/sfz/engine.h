#ifndef EFFETUNE_SFZ_ENGINE_H
#define EFFETUNE_SFZ_ENGINE_H
#include "../../analyzer/note_spectrogram/spectral_analysis.h"
#include "../sfz_note_player/onset_rule.h"
#include "bank.h"
#include "binary_io.h"
#include "effetune/dsp/fir.h"
#include "effetune/kernel.h"
#include "envelope.h"
#include "equalizer.h"
#include "midi_channel_meter.h"
#include "midi_transport_map.h"
#include "nothrow_storage.h"
#include "sample_resampling.h"
#include "script_host_parameters.h"
#include "script_session.h"
#include "script_vm.h"
#include "sf2_profile.h"
#include "sfz_amplifier.h"
#include "sfz_conditions.h"
#include "sfz_cycle_reader.h"
#include "sfz_pitch.h"
#include "sfz_resampling.h"
#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>

namespace effetune::plugins::others {
namespace {
using namespace sfz;
constexpr std::uint32_t kFilterRadius = 32u;
constexpr std::uint32_t kFilterPhases = SampleResamplingTables::kPhases;
constexpr std::uint32_t kCachedFilterTaps = 514u;
constexpr std::uint32_t kFilterTransitionFrames = 16u;
constexpr std::uint32_t kIdentityFilter = UINT32_MAX - 1u;
constexpr float kHysteresis = 0.1F;
constexpr float kRegisterHalfLife = .5F, kRegisterBand = 6.0F;
constexpr std::uint32_t kScriptSourceApply = 256u;
float bounded(float v, float lo, float hi, float fallback) noexcept {
  if (!std::isfinite(v))
    return fallback;
  return v < lo ? lo : v > hi ? hi : v;
}
struct MidiChannel {
  std::array<std::uint8_t, 128> cc{}, inputCC{}, pressure{}, velocity{};
  std::array<float, 128> normalizedCC{};
  std::array<bool, 128> preciseCC{};
  std::array<std::uint16_t, 128> keys{}, pendingRelease{};
  std::array<bool, 128> first{};
  std::array<std::uint32_t, 128> keySerial{};
  std::array<double, 128> random{};
  std::array<std::uint64_t, 128> noteOnFrames{};
  std::uint32_t serial = 0u;
  int last = -1, previous = -1, bend = 0, inputBend = 0;
  std::uint32_t program = 0u, aftertouch = 0u;
  std::uint32_t bank = 0u, melodicBank = 0u, drumMode = 0u, preset = UINT32_MAX;
  std::uint32_t inputAftertouch = 0u;
  float bendRange = 2.0F;
};
void applyChannelControllerState(MidiChannel &state, std::uint32_t key,
                                 std::uint32_t value) noexcept {
  state.cc[key] = state.inputCC[key] = static_cast<std::uint8_t>(value);
  state.normalizedCC[key] = value / 127.0F;
  state.preciseCC[key] = false;
  for (auto *controllers : {&state.cc, &state.inputCC}) {
    if (key == 98u || key == 99u)
      (*controllers)[100] = (*controllers)[101] = 127u;
    if (key == 100u || key == 101u)
      (*controllers)[98] = (*controllers)[99] = 127u;
    if (key == 121u) {
      (*controllers)[1] = (*controllers)[64] = (*controllers)[66] = (*controllers)[67] = 0u;
      (*controllers)[11] = 127u;
      (*controllers)[98] = (*controllers)[99] = (*controllers)[100] = (*controllers)[101] = 127u;
    }
  }
  if (key == 121u) {
    for (const auto reset : {1u, 11u, 64u, 66u, 67u, 98u, 99u, 100u, 101u}) {
      state.normalizedCC[reset] = state.cc[reset] / 127.0F;
      state.preciseCC[reset] = false;
    }
    state.bend = state.inputBend = 0;
    state.aftertouch = state.inputAftertouch = 0u;
    state.pressure.fill(0u);
  }
  if (key == 98u || key == 99u) {
    state.normalizedCC[100] = state.normalizedCC[101] = 1;
    state.preciseCC[100] = state.preciseCC[101] = false;
  }
  if (key == 100u || key == 101u) {
    state.normalizedCC[98] = state.normalizedCC[99] = 1;
    state.preciseCC[98] = state.preciseCC[99] = false;
  }
  if ((key == 6u || key == 38u) && state.cc[100] == 0u && state.cc[101] == 0u)
    state.bendRange = state.cc[6] + state.cc[38] * .01F;
}
struct Voice {
  playback::TimingState playbackTiming{};
  playback::RepeatState playbackRepeat{};
  double sourceFirst = 0, sourceLast = 0, loopFirst = 0, loopLast = 0;
  double playbackLoopRatio = 1, offSeconds = 0, offElapsed = 0;
  std::uint64_t loopLimit = UINT64_MAX;
  std::uint32_t sampleQuality = 0;
  bool playbackEnabled = false, playbackReverse = false, playbackInLoop = false,
       playbackLoopBack = false;
  pitch::BendState bendState{};
  float scopeGain = 1;
  float velocityGain = 1, velocityCurveGain = 1, velocityTrackRandomOffset = 0;
  float amplifierPan = 0, phaseGain = 1;
  double amplifierPosition = 0;
  std::uint32_t velocityTrackSlot = UINT32_MAX, panLaw = 0;
  bool velocityTrackDynamic = false, hasCrossfades = false;
  std::array<VoiceFilter, 2> sfzFilters{};
  bool modulationWaiting = false, modulationDone = false;
  float modulationRandom = 0;
  std::uint32_t modulationSlot = 0;
  std::array<float, 156> retiredSources{};
  std::uint64_t retiredSourceElapsed = 0;
  sf2::Resolved sf2Parameters{};
  sf2::Envelope sf2VolumeEnvelope{}, sf2ModEnvelope{};
  sf2::Lfo sf2ModLfo{}, sf2VibLfo{};
  sf2::Lowpass sf2Lowpass{};
  EnvelopeParameters ampParameters{};
  Envelope ampEnvelope{};
  VoiceEqualizer equalizer{};
  std::array<float, ControllerFamilyCount> controlModulation{};
  float channelGain = 1.0F, channelPan = 0.0F, channelBend = 0.0F;
  std::uint32_t channel = 0u, noteId = 0u;
  std::uint32_t preset = UINT32_MAX;
  bool keyDown = false, sostenuto = false, historyOnly = false, retired = false;
  bool scriptWholeSample = false;
  double baseStep = 1.0, controllerStep = 1.0;
  std::uint32_t loopRepeats = 0u, releaseElapsed = 0u;
  float pitchReleaseStart = 0.0F, filterReleaseStart = 0.0F, filterModulation = 0.0F;
  std::uint32_t modulationRevision = 0u, delayFrames = 0u;
  std::uint32_t scriptSlot = UINT32_MAX;
  script::VoiceAutomationValues retiredAutomation{};
  bool retiredScript = false;
  std::uint32_t retireFrames = 0, retireTotalFrames = 0;
  float retireGain = 1;
  bool forcedRelease = false;
  std::array<float, 8> filterEnvelopeParameters{};
  std::array<float, 12> lfoParameters{};
  std::array<double, 3> lfoPhase{};
  float modGainLeft = 1.0F, modGainRight = 1.0F;
  float filterB0 = 1.0F, filterB1 = 0.0F, filterB2 = 0.0F, filterA1 = 0.0F, filterA2 = 0.0F;
  float filterZ1Left = 0.0F, filterZ2Left = 0.0F, filterZ1Right = 0.0F, filterZ2Right = 0.0F;
  float filterLowLeft = 0.0F, filterLowRight = 0.0F, filterBandLeft = 0.0F, filterBandRight = 0.0F;
  const float *region = nullptr;
  double position = 0.0, step = 1.0;
  float gainLeft = 0.0F, gainRight = 0.0F, envelope = 0.0F;
  float lastLeft = 0.0F, lastRight = 0.0F, stolenLeft = 0.0F, stolenRight = 0.0F;
  std::uint64_t age = 0u, elapsed = 0u;
  std::uint32_t midi = 0u, outputMidi = 0u, velocity = 0u, fade = 0u;
  bool looped = false;
  bool released = false;
  bool preview = false;
  std::uint32_t filter = SampleResamplingTables::kInvalid;
  std::uint32_t previousFilter = SampleResamplingTables::kInvalid, filterTransition = 0;
  float loopMeanLeft = 0.0F, loopMeanRight = 0.0F;
  bool loopMeanOnly = false;
};
struct SampleWindowView {
  const float *data = nullptr;
  std::int64_t first = 0;
  std::uint32_t count = 0;
  SampleReadStatus status = SampleReadStatus::Invalid;
  mutable bool requested = false;
};
struct Sf2SpanFacts {
  SampleWindowView source;
  float panLeft = 1, panRight = 1, attenuation = 1, modEnvelope = 0;
  bool fixedPitch = false, fixedVolume = false, fixedFilter = false;
  bool volumeSustain = false, modSustain = false, silentModLfo = false, silentVibLfo = false;
};

// Mutable render state is copied only for paged offline trials. Immutable assets,
// prepared storage and analysis ownership stay outside this value object.
struct RenderState {
  MidiTransportMapping midi_transport_mapping_{};
  float modulation_velocity_ = 0, modulation_release_velocity_ = 0, modulation_key_ = 0;
  float modulation_random_ = 0, modulation_alternate_ = 0, modulation_key_delta_ = 0;
  std::uint64_t modulation_last_on_ = 0, modulation_last_off_ = 0;
  bool modulation_has_key_ = false;
  double modulation_host_time_ = 0;
  float modulation_last_offset_ = 0;
  std::array<float, 128> accepted_global_cc_{};
  std::array<float, 3> accepted_global_extended_{8192.0F / 16383.0F, 0, 0};
  std::uint32_t script_message_head_ = 0, script_message_count_ = 0, script_messages_dropped_ = 0;
  script::Error script_error_ = script::Error::None;
  std::uint32_t script_error_pc_ = 0;
  std::uint64_t midi_clock_ = 0, midi_history_target_ = 0;
  std::uint32_t midi_cursor_ = 0;
  bool midi_running_ = false, midi_paused_ = false, midi_ended_ = false,
       midi_history_requested_ = false, midi_history_pending_ = false;
  std::uint32_t max_frames_ = 0u, midi_count_ = 0u, midi_generation_ = 0u, midi_flags_ = 0u,
                midi_channel_ = 0u, midi_selected_channel_ = 0u, midi_note_id_ = 0u,
                midi_trigger_ = 0u;
  int midi_controller_ = -1;
  bool midi_state_only_ = false, midi_reattack_ = false, midi_first_ = true;
  float midi_gain_ = 1.0F;
  std::uint32_t midi_revision_ = 1u, midi_identity_ = 0u;
  std::array<int, 16> sf2_override_cache_{};
  std::uint32_t sf2_frame_ = 0, sf2_block_frames_ = 0, sf2_fx_position_ = 0,
                sf2_timing_fade_start_ = 0;
  bool sf2_has_sends_ = false;
  bool sfz_quantum_started_ = false;
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
  std::uint32_t voice_limit_ = 32u, voice_extent_ = 0u, seed_ = 1u, salt_ = 0u, random_ = 1u;
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
template <std::uint32_t Voices> struct OfflineTrial {
  RenderState state;
  std::array<Voice, Voices> voices{}, pausedVoices{};
  std::array<MidiChannel, 16> channels{};
  std::array<std::array<char, 128>, 8> messages{};
  std::unique_ptr<ScriptSession> session;
  std::unique_ptr<ModulationStatePool> modulation;
  NothrowStorage<float> dry, wet, input;
  NothrowStorage<std::uint32_t> sequences;
  NothrowStorage<std::uint64_t> timers;
  NoteAnalysisView analysisView{};
  const SFZBank *bank = nullptr;
  bool active = false;
};

} // namespace

template <typename ParamsType, bool Midi>
class SFZEngine final : public PluginKernel, private script::Host, private RenderState {
  static constexpr std::uint32_t kVoices = Midi ? 1024u : 128u;
  using Trial = OfflineTrial<kVoices>;
  EFFETUNE_PARAMS(ParamsType)
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
    if constexpr (!Midi) {
      analysis_ = std::make_unique<analyzer::SpectralAnalysis>();
      analysis_->prepare(info);
      latency_ = analysis_->latencySamples();
      event_latency_ = analysis_->eventLatencySamples();
      maximum_shift_ = static_cast<std::uint32_t>(std::round(rate_ * .1F));
      hop_ = analysis_->hopSamples();
    }
    midi_events_ = std::make_unique<std::array<et_midi_event, 4096>>();
    script_messages_ = std::make_unique<std::array<std::array<char, 128>, 8>>();
    midi_channels_ = std::make_unique<std::array<MidiChannel, 16>>();
    max_frames_ = info.maxFrames;
    dry_length_ = event_latency_ + hop_ / 2u + maximum_shift_ + 1u;
    wet_length_ = maximum_shift_ + 1u;
    voices_ = std::make_unique<std::array<Voice, kVoices>>();
    paused_voices_ = std::make_unique<std::array<Voice, kVoices>>();
    modulation_sources_ = std::make_unique<std::array<std::array<float, 156>, 16>>();
    modulation_filter_cache_ = std::make_unique<std::array<VoiceFilter, 2>>();
    resampling_tables_ = std::make_unique<SampleResamplingTables>();
    prepared_ = (!Midi || midi_meters_.prepare(max_frames_)) && resampling_tables_->prepare() &&
                (Midi || analysis_->ready()) &&
                dry_.allocate(static_cast<std::size_t>(max_channels_) * dry_length_) &&
                wet_.allocate(static_cast<std::size_t>(max_channels_ > 2u ? max_channels_ : 2u) *
                              wet_length_) &&
                // Main owns two additional mix planes, allocated once in CONTROL.
                sf2_sends_.allocate((Midi ? 7u : 4u) * max_frames_) &&
                sf2_fx_delay_.allocate(2u * wet_length_);
    clearAsset(0u);
    reset();
  }
  bool preparedSuccessfully() const noexcept override { return prepared_; }
  et_status prepareOfflineProcessing() noexcept override {
    if (!bank() || !bank()->streamed_)
      return ET_OK;
    if (offline_trial_ && offline_trial_->bank == bank())
      return offline_trial_->active ? ET_ERR_STATE : ET_OK;
    auto trial = std::unique_ptr<Trial>(new (std::nothrow) Trial());
    if (!trial || !trial->dry.allocate(static_cast<std::size_t>(max_channels_) * dry_length_) ||
        !trial->wet.allocate(wet_.size()) ||
        !trial->sequences.allocate(2u * bank()->group_count_) ||
        !trial->timers.allocate(bank()->timer_frames_.size()) ||
        !trial->input.allocate(static_cast<std::size_t>(max_channels_) * max_frames_))
      return ET_ERR_OOM;
    if (script_session_) {
      trial->session.reset(new (std::nothrow) ScriptSession());
      if (!trial->session)
        return ET_ERR_OOM;
    }
    if (bank()->modulation_) {
      trial->modulation.reset(new (std::nothrow) ModulationStatePool());
      if (!trial->modulation || !trial->modulation->prepare(bank()->modulation_->maximum, kVoices,
                                                            bank()->modulation_->hasSource,
                                                            bank()->modulation_->hasVoiceDsp,
                                                            bank()->modulation_->hasNoise))
        return ET_ERR_OOM;
    }
    trial->bank = bank();
    offline_trial_ = std::move(trial);
    return ET_OK;
  }
  et_status processOffline(float *audio, std::uint32_t channels, std::uint32_t frames,
                           const ProcessInfo &info) noexcept override {
    return renderSampleBlock(audio, channels, frames, info, false);
  }
  et_status renderSampleBlock(float *audio, std::uint32_t channels, std::uint32_t frames,
                              const ProcessInfo &info, bool realtime) noexcept {
    if (bank() && bank()->state_ == ET_ASSET_STATE_ERROR)
      return ET_ERR_STATE;
    if (!bank() || !bank()->streamed_) {
      process(audio, channels, frames, info);
      return bank() && bank()->state_ == ET_ASSET_STATE_ERROR ? ET_ERR_STATE : ET_OK;
    }
    if (!offline_trial_ || offline_trial_->bank != bank() ||
        bank()->state_ != ET_ASSET_STATE_ACTIVE)
      return ET_ERR_STATE;
    auto &trial = *offline_trial_;
    auto trialInfo = info;
    if (!trial.active) {
      bank()->cache_.beginQuantum();
      if constexpr (!Midi) {
        const auto minimum =
            static_cast<std::uint32_t>(std::round(bounded(params_.minimumMidi, 21, 108, 28)));
        const auto maximum = std::max(minimum, static_cast<std::uint32_t>(std::round(
                                                   bounded(params_.maximumMidi, 21, 108, 91))));
        if (analysis_->configure(minimum, maximum, false)) {
          analysis_->reset(1u);
          clearNotes();
        }
        if (info.noteAnalysis)
          trial.analysisView = *info.noteAnalysis;
        else {
          analysis_->process(audio, channels, frames, info);
          trial.analysisView = analysis_->view();
        }
      }
      if (!realtime)
        copyOfflineTrial(false);
      trial.active = true;
    }
    if constexpr (!Midi)
      trialInfo.noteAnalysis = &trial.analysisView;
    sample_missing_ = sample_invalid_ = false;
    block_miss_ = {};
    block_miss_frame_ = UINT32_MAX;
    offline_rendering_ = true;
    bank()->beginModulationTrial();
    process(audio, channels, frames, trialInfo);
    offline_rendering_ = false;
    if (sample_invalid_ || bank()->cache_.requestOverflow())
      failRuntime();
    if (bank()->state_ == ET_ASSET_STATE_ERROR) {
      bank()->endModulationTrial(false);
      trial.active = false;
      return ET_ERR_STATE;
    }
    if (sample_missing_ && !realtime) {
      if constexpr (Midi)
        midi_meters_.cancel();
      copyOfflineTrial(true);
      return ET_NEED_SAMPLE;
    }
    if (commitSfzEffects(audio, channels, frames, info) != ET_OK) {
      if (!realtime)
        copyOfflineTrial(true);
      trial.active = false;
      bank()->failAsset();
      return ET_ERR_STATE;
    }
    trial.active = false;
    bank()->endModulationTrial(false);
    commitSf2Effects(audio, channels, frames, info);
    if (realtime)
      commitAvailability(frames);
    if constexpr (Midi)
      if (midi_meters_.enabled())
        midi_meters_.commit();
    return ET_OK;
  }
  void readRuntimeEvent(RuntimeEventState &state) const noexcept override {
    state = {availability_generation_, 0u, availability_missing_ ? 1u : 0u};
  }
#if defined(ET_DEBUG_STATE)
  bool readDebugState(DebugStateSnapshot &state) const noexcept override {
    auto &words = state.auxiliaryWords;
    words[0] = 0x53465a41u;
    words[1] = 1u;
    words[2] = availability_generation_;
    words[3] = availability_missing_ ? 1u : 0u;
    words[4] = static_cast<std::uint32_t>(underrun_quanta_);
    words[5] = static_cast<std::uint32_t>(underrun_quanta_ >> 32u);
    words[6] = static_cast<std::uint32_t>(underrun_frames_);
    words[7] = static_cast<std::uint32_t>(underrun_frames_ >> 32u);
    words[8] = first_miss_.valid ? 1u : 0u;
    words[9] = static_cast<std::uint32_t>(first_miss_.generation);
    words[10] = static_cast<std::uint32_t>(first_miss_.generation >> 32u);
    words[11] = first_miss_.sample;
    words[12] = static_cast<std::uint32_t>(first_miss_.frame / SamplePageCache::kPageFrames);
    words[13] =
        static_cast<std::uint32_t>((first_miss_.frame / SamplePageCache::kPageFrames) >> 32u);
    words[14] = static_cast<std::uint32_t>(first_miss_.frame);
    words[15] = static_cast<std::uint32_t>(first_miss_.frame >> 32u);
    words[16] = first_miss_.channel;
    words[17] = static_cast<std::uint32_t>(first_miss_.clock);
    words[18] = static_cast<std::uint32_t>(first_miss_.clock >> 32u);
    return true;
  }
#endif
  std::uint32_t latencySamples() const noexcept override {
    if constexpr (Midi)
      return 0u;
    else {
      const auto timing = bounded(params_.timingOffsetMs, -100, 100, 0);
      return (params_.detection == 1.0F ? event_latency_ : latency_) + hop_ / 2u +
             static_cast<std::uint32_t>(std::round((timing < 0 ? -timing : 0) * rate_ * .001F));
    }
  }
  void reset() noexcept override {
    if (bank() && bank()->state_ == ET_ASSET_STATE_ERROR)
      return;
    if (offline_trial_)
      offline_trial_->active = false;
    if (analysis_)
      analysis_->reset(1u);
    clearNotes();
    resetMidi();
    if (script_session_ && bank() && bank()->scriptProgram_)
      script_session_->reset(*bank()->scriptProgram_, rate_, seed_);
    midi_clock_ = midi_history_target_ = 0;
    midi_cursor_ = 0;
    midi_running_ = midi_paused_ = midi_ended_ = midi_history_pending_ = midi_history_requested_ =
        false;
    if (paused_voices_)
      paused_voices_->fill({});
    dry_.clear();
    wet_.clear();
    sf2_fx_delay_.clear();
    sf2_fx_position_ = 0;
    if (bank() && bank()->sf2_effects_)
      bank()->sf2_effects_->reset();
    if (bank() && bank()->sfz_effects_)
      bank()->sfz_effects_->reset();
    dry_position_ = 0u;
    wet_position_ = 0u;
    delay_initialized_ = false;
    timing_fade_ = 0u;
    sample_clock_ = last_detection_ = 0u;
    clearSampleForecast();
    linked_ = false;
    event_source_ = nullptr;
    event_generation_ = 0u;
    random_ = Midi ? seed_ : seed_ ^ (salt_ * 0x9e3779b9u);
    if (random_ == 0u)
      random_ = 1u;
    if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
      std::fill_n(bank()->indices_.data() + 129u, 2u * bank()->group_count_, 0u);
  }
  void setRandomSeed(std::uint32_t low, std::uint32_t high) noexcept override {
    seed_ = low ^ high;
    random_ = Midi ? seed_ : seed_ ^ (salt_ * 0x9e3779b9u);
    if (random_ == 0u)
      random_ = 1u;
  }
  void setInstanceSalt(std::uint32_t salt) noexcept override { salt_ = salt; }

  AssetPreparer assetPreparer(std::uint32_t slot) const noexcept override {
    return slot == 0u ? &prepareBank : nullptr;
  }
  et_status exchangePreparedAsset(std::uint32_t slot,
                                  std::unique_ptr<PreparedAsset> &asset) noexcept override {
    if (slot != 0u)
      return ET_ERR_UNSUPPORTED;
    if (asset && !asset->sampleStreamReady())
      return ET_ERR_STATE;
    auto *next = static_cast<SFZBank *>(asset.get());
    if (next && next->scriptProgram_ && !supportsScript(*next->scriptProgram_))
      return ET_ERR_UNSUPPORTED;
    if (next && next->scriptProgram_) {
      if (!next->scriptSession_)
        return ET_ERR_STATE;
      next->scriptSession_->reset(*next->scriptProgram_, rate_, seed_);
    }
    bank_.swap(asset);
    // Retire the old session with its bank; the host releases the update outside rendering.
    if (asset)
      static_cast<SFZBank *>(asset.get())->scriptSession_.swap(script_session_);
    if (bank())
      script_session_.swap(bank()->scriptSession_);
    paused_voices_->fill({});
    midi_running_ = midi_paused_ = midi_history_requested_ = midi_history_pending_ = false;
    midi_clock_ = midi_history_target_ = 0;
    // Drop old voice references before the next playback access, without touching PCM here.
    notes_reset_pending_ = true;
    return ET_OK;
  }
  std::uint8_t *beginAsset(std::uint32_t slot, const AssetBeginInfo &info) noexcept override {
    if (slot != 0u)
      return nullptr;
    auto next = std::unique_ptr<SFZBank>(new (std::nothrow) SFZBank(kVoices));
    if (!next || next->allocate(info) != ET_OK)
      return nullptr;
    offline_trial_.reset();
    clearNotes();
    script_session_.reset();
    paused_voices_->fill({});
    midi_paused_ = midi_running_ = false;
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
    const auto preparation =
        bank()->processing_context_set_
            ? bank()->processing_info_
            : PrepareInfo{rate_, max_channels_, max_frames_, minimumMidiPreparationBpm()};
    if (status == ET_OK && bank()->prepareProcessing(preparation) != ET_OK)
      return bank()->failAsset();
    if (status == ET_OK && bank()->scriptProgram_) {
      if (!supportsScript(*bank()->scriptProgram_))
        return bank()->failAsset();
      script_session_ = std::move(bank()->scriptSession_);
      script_session_->reset(*bank()->scriptProgram_, rate_, seed_);
    }
    if (status == ET_OK && bank()->sf2_)
      for (auto channel = 0u; channel < 16u; ++channel)
        selectSf2Preset(channel);
    return status;
  }
  std::uint8_t *beginAssetWithContext(std::uint32_t slot, const AssetBeginInfo &info,
                                      const PrepareInfo &preparation) noexcept override {
    auto *payload = beginAsset(slot, info);
    if (payload) {
      bank()->processing_info_ = preparation;
      bank()->processing_context_set_ = true;
    }
    return payload;
  }
  void clearAsset(std::uint32_t slot) noexcept override {
    if (slot != 0u)
      return;
    clearNotes();
    bank_.reset();
    script_session_.reset();
    if (paused_voices_)
      paused_voices_->fill({});
    midi_running_ = midi_paused_ = false;
  }
  std::uint32_t assetState(std::uint32_t slot) const noexcept override {
    return slot == 0u && bank() ? bank()->state_ : static_cast<std::uint32_t>(ET_ASSET_STATE_NONE);
  }
  et_status configureSampleStream(std::uint64_t generation) noexcept override {
    if (!bank())
      return ET_ERR_STATE;
    const auto status = bank()->configureSampleStream(generation);
    if (status != ET_OK)
      return status;
    if (!forecast_channels_)
      forecast_channels_.reset(new (std::nothrow) std::array<MidiChannel, 16>());
    if (!forecast_channels_)
      return ET_ERR_OOM;
    return prepareOfflineProcessing();
  }
  et_status prefetchSampleEvents(const et_midi_event *events, std::uint32_t count,
                                 std::uint32_t generation, std::uint32_t window,
                                 std::uint32_t flags) noexcept override {
    if (!bank() || !bank()->streamed_ || !forecast_channels_ ||
        bank()->state_ != ET_ASSET_STATE_ACTIVE || generation != midi_generation_)
      return ET_ERR_STATE;
    if (flags & ET_STREAM_FORECAST_ADMIT)
      return prefetchAdmittedEvents(events, count, generation, window, flags);
    if (count > 256u || (count && !events) || !window || window > rate_ * 2.0F || (flags & ~3u) ||
        ((flags & 2u) && (count || flags != 2u)))
      return ET_ERR_ARGS;
    for (auto index = 0u; index < count; ++index)
      if (!systemResetEvent(events[index]) && !drumModeEvent(events[index]) &&
          ((events[index].message & 255u) < 0x80u || (events[index].message & 255u) >= 0xf0u ||
           (events[index].message & 0xff808000u) || events[index].flags))
        return ET_ERR_ARGS;
    if (flags & 2u) {
      if (!forecast_valid_ || !bank()->cache_.commitForecast())
        return ET_ERR_STATE;
      forecast_valid_ = false;
      return ET_OK;
    }
    if (flags & 1u) {
      if (notes_reset_pending_)
        return ET_ERR_STATE;
      forecast_admission_ = forecast_applied_ = readiness_acknowledged_ = false;
      stream_readiness_ = {};
      if (!bank()->cache_.beginForecast())
        return ET_ERR_STATE;
      *forecast_channels_ = *midi_channels_;
      forecast_valid_ = true;
      for (const auto &voice : *voices_)
        if (voice.region)
          requestVoiceSamples(voice, window);
      for (const auto &voice : *paused_voices_)
        if (voice.region) {
          auto reattack = voice;
          reconstructReattack(reattack, true);
          requestVoiceSamples(reattack, window);
        }
      if constexpr (!Midi)
        for (auto index = 0u; index < bank()->region_count_; ++index) {
          const auto *r = bank()->region(index);
          if (bank()->sf2_ &&
              bank()->presetForRegion(index) != sf2PresetIndex(0, (*forecast_channels_)[0], true))
            continue;
          const auto key = static_cast<std::uint32_t>(r[HighKey]);
          forecastRegionSamples(index, (*forecast_channels_)[0], key, key, 127, window, 0);
        }
    }
    if (!forecast_valid_)
      return ET_ERR_STATE;
    for (auto index = 0u; index < count; ++index) {
      if (systemResetEvent(events[index])) {
        initializeMidiChannels(*forecast_channels_, true);
        continue;
      }
      if (drumModeEvent(events[index])) {
        applyDrumMode(*forecast_channels_, events[index], true);
        continue;
      }
      const auto message = events[index].message;
      const auto channel = message & 15u, kind = message & 0xf0u;
      const auto key = (message >> 8u) & 127u, value = (message >> 16u) & 127u;
      if constexpr (Midi)
        if (midi_selected_channel_ && midi_selected_channel_ != channel + 1u)
          continue;
      auto &state = (*forecast_channels_)[channel];
      if (kind == 0x90u && value)
        forecastNoteSamples(*forecast_channels_, channel, key, value, window);
      else if (kind == 0xb0u) {
        applyChannelControllerState(state, key, value);
      } else if (kind == 0xc0u) {
        state.program = key;
        state.melodicBank = state.cc[0];
        state.bank = state.drumMode ? 128u : state.melodicBank;
      } else if (kind == 0xd0u)
        state.aftertouch = key;
      else if (kind == 0xa0u)
        state.pressure[key] = static_cast<std::uint8_t>(value);
      else if (kind == 0xe0u)
        state.bend = static_cast<int>(key | value << 7u) - 8192;
    }
    return bank()->cache_.requestOverflow() ? ET_ERR_OOM : ET_OK;
  }
  et_status takeSampleRequests(et_sfz_sample_request *requests, std::uint32_t capacity,
                               std::uint32_t &count) noexcept override {
    count = 0u;
    return bank() ? bank()->takeSampleRequests(requests, capacity, count) : ET_ERR_STATE;
  }
  et_status sampleStreamReadiness(et_stream_readiness &out) const noexcept override {
    out = {};
    if (!bank() || !bank()->streamed_)
      return ET_ERR_STATE;
    out = stream_readiness_;
    out.generation = midi_generation_;
    if (forecast_input_invalidated_ ||
        (out.scope != ET_STREAM_SCOPE_NONE && !bank()->cache_.admittedForecastValid())) {
      out = {};
      out.generation = midi_generation_;
      return ET_OK;
    }
    if (forecast_applied_)
      out.pending_pages = bank()->cache_.pendingPages();
    out.ready_ahead_frames =
        readiness_acknowledged_ && out.scope == ET_STREAM_SCOPE_KNOWN_MIDI &&
                out.generation == midi_generation_ && readiness_end_ > sample_clock_
            ? static_cast<std::uint32_t>(
                  std::min<std::uint64_t>(out.admitted_frames, readiness_end_ - sample_clock_))
            : 0u;
    return ET_OK;
  }
  et_status publishSamplePage(std::uint64_t generation, std::uint32_t sample, std::uint64_t page,
                              const float *pcm, std::uint32_t frames, std::uint32_t channels,
                              std::uint32_t flags) noexcept override {
    return bank()
               ? bank()->publishSamplePage(generation, sample, page, pcm, frames, channels, flags)
               : ET_ERR_STATE;
  }
  void process(float *audio, std::uint32_t channels, std::uint32_t frames,
               const ProcessInfo &info) noexcept override {
    if (bank() && bank()->streamed_ && bank()->state_ == ET_ASSET_STATE_ACTIVE &&
        !offline_rendering_) {
      if (!offline_trial_ || offline_trial_->bank != bank()) {
        failRuntime();
        return;
      }
      std::copy_n(audio, static_cast<std::size_t>(channels) * frames, offline_trial_->input.data());
      const auto status = renderSampleBlock(audio, channels, frames, info, true);
      if (status == ET_OK) {
        for (const auto &voice : liveVoices())
          if (voice.region)
            requestVoiceSamples(voice, static_cast<std::uint32_t>(std::ceil(rate_ * .25F)));
        if (bank()->cache_.requestOverflow())
          failRuntime();
      } else {
        std::copy_n(offline_trial_->input.data(), static_cast<std::size_t>(channels) * frames,
                    audio);
        failRuntime();
      }
      return;
    }
    sf2_block_frames_ = frames;
    sf2_has_sends_ = false;
    if (bank() && bank()->sf2_)
      std::fill_n(sf2_sends_.data(), 4u * frames, 0.0F);
    renderQuantum(audio, channels, frames, info);
    if (script_session_ && script_session_->failed) {
      failRuntime();
      return;
    }
    if (!offline_rendering_) {
      if (commitSfzEffects(audio, channels, frames, info) != ET_OK) {
        failRuntime();
        return;
      }
      commitSf2Effects(audio, channels, frames, info);
      if constexpr (Midi)
        if (midi_meters_.enabled())
          midi_meters_.commit();
    }
  }
  void renderQuantum(float *audio, std::uint32_t channels, std::uint32_t frames,
                     const ProcessInfo &info) noexcept {
    sfz_quantum_started_ = false;
    modulation_host_time_ = info.timeSeconds;
    modulation_block_frame_ = 0;
    modulation_host_transport_valid_ = info.transport != nullptr;
    if (info.transport)
      modulation_host_transport_ = *info.transport;
    modulation_cache_time_ = std::numeric_limits<double>::quiet_NaN();
    if constexpr (!Midi)
      synchronizeMidiChannel();
    if (!prepared_ || !audio || !channels || channels > max_channels_)
      return;
    if constexpr (Midi) {
      processMidi(audio, channels, frames);
    } else {
      const bool event_detection = params_.detection == 1.0F;
      if (event_detection_ != event_detection) {
        event_detection_ = event_detection;
        analysis_->setEventEnabled(event_detection_);
        reset();
      }
      const auto minimum =
          static_cast<std::uint32_t>(std::round(bounded(params_.minimumMidi, 21, 108, 28)));
      const auto maximum = std::max(minimum, static_cast<std::uint32_t>(std::round(
                                                 bounded(params_.maximumMidi, 21, 108, 91))));
      if (analysis_->configure(minimum, maximum, false)) {
        analysis_->reset(1u);
        clearNotes();
      }
      if (notes_reset_pending_) {
        clearNotes();
        resetMidi();
      }
      if (bank() && bank()->state_ == ET_ASSET_STATE_PREPARING) {
        bank()->prepareSlice(static_cast<std::uint64_t>(frames) * 8u);
        if (bank()->state_ != ET_ASSET_STATE_PREPARING) {
          clearNotes();
          resetMidi();
        }
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
      setVoiceLimit(
          static_cast<std::uint32_t>(std::round(bounded(params_.maxVoices, 1, kVoices, 32))));
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
      if (!beginSfzEffects(frames)) {
        failRuntime();
        return;
      }
      auto event = 0u;
      auto control = 0u;
      sf2_timing_fade_start_ = timing_fade_;
      const auto *detection_frames = event_detection_ ? view->eventFrames : view->frames;
      for (auto frame = 0u; frame <= frames; ++frame) {
        modulation_block_frame_ = frame;
        modulation_host_time_ = info.timeSeconds + static_cast<double>(frame) / rate_;
        if (frame < frames) {
          sf2_frame_ = frame;
          advanceRuntime();
          while (control < midi_count_ && (*midi_events_)[control].offset_frames <= frame)
            midiEvent((*midi_events_)[control++], midi_flags_);
        }
        while (event < view->count && detection_frames[event].sampleOffset <= frame) {
          if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
            detect(detection_frames[event], minimum, maximum, sample_clock_ + frame);
          ++event;
        }
        if (frame == frames)
          break;
        if (next_note_event_ && sample_clock_ + frame >= next_note_event_)
          processNoteEvents(sample_clock_ + frame);
        captureSfzEffectSources(frame);
        float left = 0.0F, right = 0.0F;
        if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
          for (auto v = 0u; v < voice_limit_; ++v)
            renderVoice((*voices_)[v], left, right);
        if (!sfz_quantum_started_) {
          wet_.data()[wet_position_] = left;
          wet_.data()[wet_length_ + wet_position_] = right;
          mixNoteOutputFrame(audio, channels, frames, frame, dry_gain, wet_gain, output_gain,
                             false);
        }
        if (midi_running_ && !midi_paused_)
          ++midi_clock_;
      }
      if (control != midi_count_)
        retireMidi();
      midi_count_ = midi_cursor_ = 0u;
      collectScriptNotes();
      sample_clock_ += frames;
    }
  }

  et_status setMidiGain(float gain) noexcept override {
    if constexpr (!Midi)
      return ET_ERR_UNSUPPORTED;
    else {
      if (!std::isfinite(gain) || gain < 0.0F || gain > 16.0F)
        return ET_ERR_ARGS;
      midi_gain_ = gain;
      return ET_OK;
    }
  }
  et_status setMidiMetering(bool enabled) noexcept override {
    if constexpr (!Midi)
      return ET_ERR_UNSUPPORTED;
    else {
      if (offline_trial_ && offline_trial_->active)
        return ET_ERR_STATE;
      midi_meters_.setEnabled(enabled);
      return ET_OK;
    }
  }
  et_status setMidiChannelMix(std::uint32_t channel, std::uint32_t action) noexcept override {
    if constexpr (!Midi)
      return ET_ERR_UNSUPPORTED;
    else {
      if (channel >= 16u || action > ET_MIDI_CHANNEL_SOLO)
        return ET_ERR_ARGS;
      if (offline_trial_ && offline_trial_->active)
        return ET_ERR_STATE;
      const auto bit = static_cast<std::uint16_t>(1u << channel);
      auto &mask = action >= ET_MIDI_CHANNEL_UNSOLO ? mixer_solo_ : mixer_mute_;
      mask = static_cast<std::uint16_t>((action & 1u) ? mask | bit : mask & ~bit);
      return ET_OK;
    }
  }
  et_status setMidiClock(std::uint64_t frame, std::uint32_t generation,
                         std::uint32_t flags) noexcept override {
    if (!prepared_ || (flags & ~3u) || flags == 3u || frame > 9007199254740991ull)
      return ET_ERR_ARGS;
    if (generation != midi_generation_)
      return ET_ERR_STATE;
    if (bank() && bank()->state_ == ET_ASSET_STATE_ERROR)
      return ET_ERR_STATE;
    if (flags & ET_MIDI_CLOCK_HISTORY) {
      if (frame < midi_clock_)
        return ET_ERR_STATE;
      midi_history_target_ = frame;
      midi_history_requested_ = midi_history_pending_ = true;
      midi_running_ = false;
    } else {
      if (frame < midi_clock_)
        return ET_ERR_STATE;
      if constexpr (!Midi)
        if (script_session_ && script_session_->nextFrame() != UINT64_MAX && frame != midi_clock_)
          return ET_ERR_STATE;
      midi_clock_ = frame;
      midi_running_ = (flags & ET_MIDI_CLOCK_RUNNING) != 0u && !midi_paused_;
    }
    return ET_OK;
  }
  std::uint32_t midiState() const noexcept override {
    std::uint32_t state = 0;
    if (voices_)
      for (const auto &voice : liveVoices())
        if (voice.region && !voice.historyOnly) {
          state |= ET_MIDI_STATE_VOICES;
          break;
        }
    if (script_session_) {
      if (script_session_->vm.nextFrame() != UINT64_MAX)
        state |= ET_MIDI_STATE_CALLBACKS;
      for (const auto &event : script_session_->scheduled)
        if (event.id) {
          state |= ET_MIDI_STATE_GENERATED;
          break;
        }
      if (script_session_->failed)
        state |= ET_MIDI_STATE_SCRIPT_ERROR;
      if (script_session_->vm.hasPendingBudget() || script_session_->emissionCount)
        state |= ET_MIDI_STATE_HISTORY_PENDING;
    }
    if (midi_history_pending_ || (midi_count_ && (midi_flags_ & ET_MIDI_STATE_ONLY)))
      state |= ET_MIDI_STATE_HISTORY_PENDING;
    if (bank() && bank()->sf2_effects_ && bank()->sf2_effects_->active())
      state |= ET_MIDI_STATE_VOICES;
    if (bank() && bank()->sfz_effects_ && bank()->sfz_effects_->active())
      state |= ET_MIDI_STATE_VOICES;
    return state;
  }
  std::uint64_t midiClock() const noexcept override { return midi_clock_; }
  double minimumMidiPreparationBpm() const noexcept override {
    return midi_transport_map_.minimumBpm() * .25;
  }
  et_status setMidiTransportMap(const et_midi_transport_point *points,
                                std::uint32_t count) noexcept override {
    modulation_cache_bank_ = nullptr;
    return midi_transport_map_.assign(points, count);
  }
  et_status setMidiTransport(std::uint64_t frame, double seconds, double speed, double duration,
                             std::uint32_t flags) noexcept override {
    const MidiTransportMapping mapping{frame, seconds, speed, duration, flags};
    if (!mapping.valid())
      return ET_ERR_ARGS;
    midi_transport_mapping_ = mapping;
    modulation_cache_bank_ = nullptr;
    return ET_OK;
  }
  std::uint32_t midiGeneration() const noexcept override { return midi_generation_; }
  std::uint32_t midiCheckpointSize() const noexcept override {
    if (!midi_paused_ || midi_running_ || midi_count_ || midi_history_pending_)
      return 0;
    if (script_session_ &&
        (script_session_->vm.hasPendingBudget() || script_session_->emissionCount))
      return 0;
    return checkpointStorageSize();
  }
  et_status writeMidiCheckpoint(std::uint8_t *destination,
                                std::uint32_t bytes) const noexcept override {
    if (!destination || !bytes || bytes != midiCheckpointSize())
      return ET_ERR_STATE;
    script::CheckpointIO<false> io{nullptr, destination, 0, bytes};
    const auto ok = const_cast<SFZEngine *>(this)->checkpointState(io);
    return ok ? ET_OK : ET_ERR_ARGS;
  }
  et_status readMidiCheckpoint(const std::uint8_t *source, std::uint32_t bytes) noexcept override {
    if (!source || !bytes || midi_running_ || midi_count_ || bytes != checkpointStorageSize())
      return ET_ERR_STATE;
    script::CheckpointIO<true> io{source, nullptr, 0, bytes};
    if (!checkpointState(io)) {
      clearNotes();
      resetMidi();
      if (script_session_ && bank()->scriptProgram_)
        script_session_->reset(*bank()->scriptProgram_, rate_, seed_);
      midi_paused_ = midi_running_ = false;
      return ET_ERR_ARGS;
    }
    voices_->fill({});
    midi_meters_.clear();
    midi_count_ = midi_cursor_ = midi_flags_ = 0;
    clearSampleForecast();
    midi_history_pending_ = midi_history_requested_ = false;
    midi_paused_ = true;
    midi_running_ = false;
    notes_reset_pending_ = false;
    modulation_cache_bank_ = nullptr;
    for (auto slot = 0u; slot < paused_voices_->size(); ++slot)
      if (auto &voice = (*paused_voices_)[slot]; voice.region) {
        voice.modulationSlot = slot;
        reconstructReattack(voice);
        if (bank() && bank()->sf2_) {
          voice.sf2VolumeEnvelope.template parametersChanged<true>(voice.sf2Parameters.volEnv);
          voice.sf2ModEnvelope.template parametersChanged<false>(voice.sf2Parameters.modEnv);
        }
      }
    return ET_OK;
  }
  et_status setMidiEvents(const et_midi_event *events, std::uint32_t count,
                          std::uint32_t generation, std::uint32_t flags) noexcept override {
    {
      const bool hydrate = (flags & ET_MIDI_HYDRATE_CHANNEL_STATE) != 0u;
      const bool controlEdit = (flags & ET_MIDI_CONTROL_ONLY) != 0u;
      if (!prepared_ || count > 4096u || (count && !events) ||
          (flags & ~(255u | ET_MIDI_HYDRATE_CHANNEL_STATE | ET_MIDI_CONTROL_ONLY)) ||
          (!generation && !controlEdit) || (hydrate && flags != ET_MIDI_HYDRATE_CHANNEL_STATE) ||
          (controlEdit && flags != ET_MIDI_CONTROL_ONLY))
        return ET_ERR_ARGS;
      if constexpr (!Midi)
        if (hydrate || controlEdit)
          return ET_ERR_UNSUPPORTED;
      if (bank() && bank()->state_ == ET_ASSET_STATE_ERROR)
        return count == 0 ? ET_OK : ET_ERR_STATE;
      if (midi_generation_ && generation != midi_generation_ &&
          static_cast<std::int32_t>(generation - midi_generation_) < 0)
        return ET_ERR_STATE;
      const auto transition = flags & (ET_MIDI_RESET | ET_MIDI_PAUSE | ET_MIDI_RESUME |
                                       ET_MIDI_RETIME | ET_MIDI_NATURAL_END);
      if (generation != midi_generation_ && !transition)
        return ET_ERR_STATE;
      for (auto i = 0u; i < count; ++i) {
        const auto &e = events[i];
        const auto status = e.message & 255u;
        const auto kind = status & 0xf0u;
        const bool globalState = hydrate && e.flags == ET_MIDI_HYDRATE_GLOBAL_CC &&
                                 (kind == 0xb0u || kind == 0xe0u || kind == 0xd0u || kind == 0xa0u);
        const bool channelState =
            hydrate && e.flags == ET_MIDI_HYDRATE_CHANNEL_ONLY &&
            (kind == 0xb0u || kind == 0xc0u || kind == 0xe0u || kind == 0xd0u || kind == 0xa0u);
        const bool systemReset = systemResetEvent(e);
        const bool drumMode = drumModeEvent(e);
        const bool marker = systemReset || drumMode ||
                            (e.message == 0u && e.note_id == 0u &&
                             (e.flags == ET_MIDI_REATTACK || e.flags == ET_MIDI_PAUSE ||
                              e.flags == ET_MIDI_RESUME || e.flags == ET_MIDI_NATURAL_END));
        if constexpr (!Midi)
          if (!marker || systemReset || drumMode)
            return ET_ERR_UNSUPPORTED;
        const auto controller = (e.message >> 8u) & 127u;
        const bool editorMessage =
            kind == 0xc0u ||
            (kind == 0xb0u &&
             (controller == 0u || controller == 32u || controller == 7u || controller == 10u ||
              controller == 11u || controller == 91u || controller == 93u));
        if (controlEdit && (!editorMessage || e.offset_frames || e.note_id || e.flags ||
                            e.render_frame_low || e.render_frame_high))
          return ET_ERR_ARGS;
        if ((hydrate && !systemReset && !drumMode &&
             (marker || (e.flags && !globalState && !channelState))) ||
            e.offset_frames >= max_frames_ ||
            (i && e.offset_frames < events[i - 1].offset_frames) ||
            (!marker && (status < 0x80u || status >= 0xf0u)) || (e.message & 0xff808000u) ||
            (!marker && !globalState && !channelState && (e.flags & ~ET_MIDI_STATE_ONLY)))
          return ET_ERR_ARGS;
      }
      if (controlEdit) {
        if (!bank() || bank()->state_ != ET_ASSET_STATE_ACTIVE || notes_reset_pending_ ||
            midi_history_pending_ || (offline_trial_ && offline_trial_->active))
          return ET_ERR_STATE;
        for (auto index = 0u; index < count; ++index) {
          const auto message = events[index].message;
          hydrateChannelState(message);
          if (!midi_selected_channel_ || midi_selected_channel_ == (message & 15u) + 1u)
            acceptGlobalState(message);
        }
        if (count)
          ++midi_revision_;
        if (count)
          invalidateForecastReceipt(false);
        modulation_cache_bank_ = nullptr;
        return ET_OK;
      }
      if (hydrate) {
        if (!bank() || bank()->state_ != ET_ASSET_STATE_ACTIVE || notes_reset_pending_ ||
            midi_count_ || midi_history_pending_)
          return ET_ERR_STATE;
        if (count)
          invalidateForecastReceipt(true);
        for (auto index = 0u; index < count; ++index) {
          const auto &event = events[index];
          if (systemResetEvent(event)) {
            initializeMidiChannels(*midi_channels_);
            accepted_global_cc_ = (*midi_channels_)[0].normalizedCC;
            accepted_global_extended_ = {8192.0F / 16383.0F, 0, 0};
            ++midi_revision_;
            continue;
          }
          if (drumModeEvent(event)) {
            applyDrumMode(*midi_channels_, event);
            ++midi_revision_;
            continue;
          }
          const auto message = event.message;
          if (!(event.flags & ET_MIDI_HYDRATE_GLOBAL_CC))
            hydrateChannelState(message);
          if (!(event.flags & ET_MIDI_HYDRATE_CHANNEL_ONLY) &&
              (!midi_selected_channel_ || midi_selected_channel_ == (message & 15u) + 1u))
            acceptGlobalState(message);
        }
        modulation_cache_bank_ = nullptr;
        return ET_OK;
      }
      applyPendingParameters();
      synchronizeMidiChannel();
      if (midi_count_ && !transition)
        return ET_ERR_STATE;
      if (transition) {
        midi_count_ = midi_cursor_ = 0;
        midi_flags_ = 0;
      }
      if (generation != midi_generation_) {
        midi_meters_.clear();
        clearSampleForecast();
        mixer_mute_ = mixer_solo_ = 0;
      }
      midi_generation_ = generation;
      if (flags & ET_MIDI_RESET) {
        retireMidi((flags & ET_MIDI_PRESERVE_RELEASE) != 0u);
        resetMidi();
        if (script_session_ && bank() && bank()->scriptProgram_)
          script_session_->reset(*bank()->scriptProgram_, rate_, seed_);
        midi_clock_ = midi_history_target_ = 0;
        midi_paused_ = midi_running_ = midi_ended_ = midi_history_pending_ =
            midi_history_requested_ = false;
        paused_voices_->fill({});
      }
      if (notes_reset_pending_) {
        clearNotes();
        resetMidi();
      }
      if constexpr (Midi)
        setVoiceLimit(static_cast<std::uint32_t>(bounded(params_.maxVoices, 1, kVoices, 64)));
      if (flags & ET_MIDI_PAUSE)
        pauseMidi();
      if (flags & ET_MIDI_NATURAL_END) {
        midi_running_ = true;
        finishMidi();
      }
      if (count == 0u && (flags & ET_MIDI_REATTACK))
        reattackMidi();
      if ((flags & ET_MIDI_STATE_ONLY) && !script_session_) {
        for (auto i = 0u; i < count; ++i)
          midiEvent(events[i], flags);
      } else {
        if (midi_count_)
          return ET_ERR_STATE;
        std::copy_n(events, count, midi_events_->data());
        midi_count_ = count;
        midi_cursor_ = 0;
        midi_flags_ = flags;
      }
      return ET_OK;
    }
  }
  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    // One record per output key: active sample voices and velocity with a one-second decay.
    std::array<std::uint8_t, 4u + 128u * 8u> payload{};
    std::array<std::uint16_t, 128> counts{};
    std::array<float, 128> velocities{};
    std::uint16_t total = 0u;
    if (voices_ && !notes_reset_pending_)
      for (const auto &voice : liveVoices()) {
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
    writeKeyswitchTelemetry(writer);
    if constexpr (Midi)
      writeMixerTelemetry(writer);
    while (script_message_count_) {
      const auto &message = (*script_messages_)[script_message_head_];
      const auto length =
          static_cast<std::uint16_t>(std::char_traits<char>::length(message.data()));
      std::array<std::uint8_t, 136> diagnostic{};
      binary_io::writeU32(diagnostic.data(), script_messages_dropped_);
      binary_io::writeU16(diagnostic.data() + 4u, length);
      std::memcpy(diagnostic.data() + 8u, message.data(), length);
      if (!writer.write(33u, 1u, diagnostic.data(), static_cast<std::uint16_t>(8u + length)))
        break;
      script_messages_dropped_ = 0;
      script_message_head_ = (script_message_head_ + 1u) % script_messages_->size();
      --script_message_count_;
    }
  }

private:
  void writeMixerTelemetry(TelemetryWriter &writer) noexcept {
    std::array<std::uint8_t, 584> payload{};
    std::uint16_t total = 0;
    for (auto channel = 0u; channel < 16u; ++channel) {
      auto *row = payload.data() + 8u + 32u * channel;
      binary_io::writeU16(row, 0xffffu);
      row[2] = 0xffu;
      binary_io::writeU16(row + 10u, 0xffffu);
      row[8] = static_cast<std::uint8_t>(((mixer_mute_ >> channel) & 1u) |
                                         (((mixer_solo_ >> channel) & 1u) << 1u));
      if (!midi_channels_)
        continue;
      const auto &state = (*midi_channels_)[channel];
      row[3] = state.cc[7];
      row[4] = state.cc[10];
      row[5] = state.cc[11];
      row[6] = state.cc[91];
      row[7] = state.cc[93];
      row[9] = static_cast<std::uint8_t>(state.program);
      row[14] = state.cc[0];
      row[15] = state.cc[32];
      if (bank() && bank()->sf2_ && state.preset < bank()->preset_count_) {
        const auto preset = bank()->preset(state.preset);
        binary_io::writeU16(row, static_cast<std::uint16_t>(preset.bank));
        row[2] = static_cast<std::uint8_t>(preset.program);
        binary_io::writeU16(row + 10u, static_cast<std::uint16_t>(state.preset));
      }
      std::uint16_t count = 0;
      if (!notes_reset_pending_)
        for (auto key = 0u; key < 128u; ++key)
          if (state.keys[key])
            row[16u + key / 8u] |= static_cast<std::uint8_t>(1u << (key % 8u));
      if (voices_ && !notes_reset_pending_)
        for (const auto &voice : liveVoices())
          if (voice.region && voice.channel == channel && !voice.historyOnly) {
            ++count;
          }
      binary_io::writeU16(row + 12u, count);
      total = static_cast<std::uint16_t>(total + count);
    }
    binary_io::writeU16(payload.data(), total);
    binary_io::writeU16(payload.data() + 2u, static_cast<std::uint16_t>(voice_limit_));
    if (midi_meters_.enabled())
      for (auto channel = 0u; channel < 16u; ++channel)
        binary_io::writeF32(payload.data() + 520u + channel * 4u, midi_meters_.peak(channel));
    if (writer.write(35u, 2u, payload.data(), static_cast<std::uint16_t>(payload.size())) &&
        midi_meters_.enabled())
      midi_meters_.consume();
  }
  void writeKeyswitchTelemetry(TelemetryWriter &writer) noexcept {
    std::array<std::uint8_t, 32> payload{};
    const bool active = bank() && !bank()->sf2_ && bank()->state_ == ET_ASSET_STATE_ACTIVE &&
                        midi_channels_ && !notes_reset_pending_;
    for (auto channel = 0u; channel < 16u; ++channel) {
      const auto key =
          active ? bank()->keyswitches_.selected(channel, (*midi_channels_)[channel].keySerial)
                 : static_cast<std::int16_t>(-1);
      binary_io::writeU16(payload.data() + channel * 2u, static_cast<std::uint16_t>(key));
    }
    writer.write(34u, 1u, payload.data(), static_cast<std::uint16_t>(payload.size()));
  }
  sf2::RouteSpan sf2ForecastRoutes(std::uint32_t index) const noexcept {
    const auto *section = bank()->payload_.data() + 8u + bank()->modulation_offset_;
    const auto directory = std::bit_cast<std::uint32_t>(section[5]);
    const auto records = std::bit_cast<std::uint32_t>(section[6]);
    const auto first = std::bit_cast<std::uint32_t>(section[directory + index * 4u]);
    return {section + records + first * sf2::kRouteWords,
            std::bit_cast<std::uint32_t>(section[directory + index * 4u + 1u])};
  }
  bool resolveSf2Forecast(std::uint32_t index, const MidiChannel &channel,
                          std::uint32_t physicalKey, std::uint32_t musicalKey,
                          std::uint32_t velocity, sf2::Resolved &resolved) noexcept {
    const auto *r = bank()->region(index);
    const sf2::Inputs input{
        channel.cc.data(),  musicalKey,   velocity,         channel.pressure[physicalKey],
        channel.aftertouch, channel.bend, channel.bendRange};
    return sf2::evaluate(std::span<const float, 61>(bank()->sf2Generators(index), 61),
                         sf2ForecastRoutes(index), input,
                         {bank()->sf2_scratch_.data(), bank()->sf2_scratch_.size()}, r[KeyCenter],
                         r[Tune], resolved);
  }
  double forecastMaximumStep(std::uint32_t index, const MidiChannel &channel,
                             std::uint32_t physicalKey, std::uint32_t musicalKey,
                             std::uint32_t velocity) noexcept {
    sf2::Resolved resolved;
    if (!resolveSf2Forecast(index, channel, physicalKey, musicalKey, velocity, resolved))
      return 0;
    const auto &g = resolved.generators;
    return bank()->region(index)[Rate] / rate_ *
           std::exp2(
               (resolved.pitchCents + std::abs(g[5]) + std::abs(g[6]) + std::max(0.0F, g[7])) /
               1200.0);
  }
  void forecastPitchDependencies(SamplePageCache::ForecastSource &source) const noexcept {
    const auto routes = sf2ForecastRoutes(source.region);
    bool linked = false;
    for (auto i = 0u; i < routes.count; ++i) {
      const auto *route = routes.words + i * sf2::kRouteWords;
      const auto target = std::bit_cast<std::uint32_t>(route[0]);
      linked = linked || (target & 0xffff0000u) == 0x20000u;
      const auto destination = target & 0xffffu;
      if ((target & 0xffff0000u) != 0x10000u ||
          (destination != 5u && destination != 6u && destination != 7u && destination != 51u &&
           destination != 52u && destination != 60u))
        continue;
      for (const auto lane : {1u, 2u}) {
        const auto input = std::bit_cast<std::uint32_t>(route[lane]);
        const auto index = input & 127u;
        if (input & 128u) {
          auto &mask = index < 64u ? source.pitchControllersLow : source.pitchControllersHigh;
          mask |= std::uint64_t{1} << (index & 63u);
        } else if (index == 10u)
          source.pitchFacts |= 1u;
        else if (index == 13u)
          source.pitchFacts |= 2u;
        else if (index == 14u)
          source.pitchFacts |= 4u;
        else if (index == 16u)
          source.pitchFacts |= 8u;
      }
    }
    // Linked custom modulators can compose dependencies. Conservatively refresh
    // them on accepted source changes instead of interpreting another VM.
    if (linked) {
      source.pitchControllersLow = source.pitchControllersHigh = UINT64_MAX;
      source.pitchFacts = 15u;
    }
  }
  void addForecastRegion(std::uint32_t region, std::uint32_t channel, std::uint32_t physicalKey,
                         std::uint32_t musicalKey, std::uint32_t velocity, std::uint32_t onset,
                         const Voice *voice = nullptr, bool prefix = false) noexcept {
    const auto *r = bank()->region(region);
    const auto position = voice ? voice->position : static_cast<double>(indexValue(r, Offset));
    const auto step = forecastMaximumStep(region, (*forecast_channels_)[channel], physicalKey,
                                          musicalKey, velocity);
    if (!std::isfinite(step) || step <= 0)
      return;
    const auto sourceFlags =
        (voice ? (voice->looped ? 1u : 0u) | (looping(*voice) ? 2u : 0u) : 2u) | (prefix ? 4u : 0u);
    SamplePageCache::ForecastSource source{};
    source.region = region;
    source.channel = channel;
    source.physicalKey = physicalKey;
    source.musicalKey = musicalKey;
    source.velocity = velocity;
    source.position = position;
    source.maximumStep = step;
    source.onset = onset;
    source.flags = sourceFlags;
    forecastPitchDependencies(source);
    collectForecastSource(source);
  }
  void collectForecastSource(const SamplePageCache::ForecastSource &candidate) noexcept {
    // Selected-preset prefixes request only region geometry and maximum step.
    // Resolve every channel first, then union identical prefixes across channels;
    // live/paused origins and known MIDI retain their channel dependencies.
    const bool selectedPrefix =
        forecast_scope_ == ET_STREAM_SCOPE_SELECTED_PRESETS && (candidate.flags & 4u) != 0u;
    for (auto &source : bank()->cache_.forecastSources())
      if (source.region == candidate.region &&
          (source.channel == candidate.channel || selectedPrefix) &&
          source.physicalKey == candidate.physicalKey &&
          source.musicalKey == candidate.musicalKey && source.velocity == candidate.velocity &&
          source.position == candidate.position && source.flags == candidate.flags) {
        source.onset = std::min(source.onset, candidate.onset);
        source.maximumStep = std::max(source.maximumStep, candidate.maximumStep);
        return;
      }
    if (auto *source = bank()->cache_.addForecastSource())
      *source = candidate;
  }
  void forecastReleasedSources(std::uint32_t channel, std::uint32_t key,
                               std::uint32_t offset) noexcept {
    if (forecast_scope_ != ET_STREAM_SCOPE_KNOWN_MIDI)
      return;
    // Keep looping coverage and add the furthest nonloop continuation reachable
    // after this known release. Pedal-held releases may overpredict, but only
    // for the remaining horizon; no live voice or envelope is replayed.
    const auto sources = bank()->cache_.forecastSources();
    for (const auto &source : sources) {
      const auto *r = bank()->region(source.region);
      if (source.channel != channel || (key < 128u && source.physicalKey != key) ||
          !(source.flags & 2u) || r[LoopMode] != 3.0F)
        continue;
      auto tail = source;
      const auto backwards = r[Direction] == 1.0F;
      const auto edge = static_cast<double>(indexValue(r, backwards ? LoopStart : LoopEnd));
      tail.position = backwards ? std::min(source.position, edge) : std::max(source.position, edge);
      tail.onset = offset;
      tail.flags = 0u;
      collectForecastSource(tail);
    }
  }
  void refreshForecastPitch(std::uint32_t channel, std::uint32_t kind, std::uint32_t key,
                            bool rangeChanged, bool resetInputs = false) noexcept {
    for (auto &source : bank()->cache_.forecastSources()) {
      if (source.channel != channel)
        continue;
      const auto mask = key < 64u ? source.pitchControllersLow : source.pitchControllersHigh;
      const bool affected =
          (kind == 0xb0u && (mask & (std::uint64_t{1} << (key & 63u)))) ||
          (kind == 0xa0u && source.physicalKey == key && (source.pitchFacts & 1u)) ||
          (kind == 0xd0u && (source.pitchFacts & 2u)) ||
          (kind == 0xe0u && (source.pitchFacts & 4u)) || (rangeChanged && (source.pitchFacts & 8u));
      if (affected || resetInputs)
        source.maximumStep =
            std::max(source.maximumStep,
                     forecastMaximumStep(source.region, (*forecast_channels_)[channel],
                                         source.physicalKey, source.musicalKey, source.velocity));
    }
  }
  et_status prefetchAdmittedEvents(const et_midi_event *events, std::uint32_t count,
                                   std::uint32_t generation, std::uint32_t window,
                                   std::uint32_t flags) noexcept {
    if (count > 256u || (count && !events) || !window || window > rate_ * 2.0F || (flags & ~15u) ||
        (flags & 2u && (flags != 6u || count)) || (flags & 8u && !(flags & 1u)))
      return ET_ERR_ARGS;
    if (flags & 1u) {
      if (notes_reset_pending_ || (offline_trial_ && offline_trial_->active) ||
          !bank()->cache_.beginAdmission())
        return ET_ERR_STATE;
      if (forecast_input_invalidated_ || !readiness_acknowledged_) {
        stream_readiness_ = {};
        stream_readiness_.generation = generation;
        readiness_acknowledged_ = false;
      }
      *forecast_channels_ = *midi_channels_;
      forecast_valid_ = false;
      forecast_admission_ = true;
      forecast_applied_ = false;
      forecast_input_invalidated_ = false;
      forecast_window_ = window;
      forecast_offset_ = forecast_last_offset_ = 0;
      forecast_anchor_ = sample_clock_;
      forecast_scope_ = !Midi || !bank()->sf2_ ? ET_STREAM_SCOPE_BEST_EFFORT
                        : flags & 8u           ? ET_STREAM_SCOPE_SELECTED_PRESETS
                                               : ET_STREAM_SCOPE_KNOWN_MIDI;
      const auto collectVoice = [&](const Voice &voice) {
        if (bank()->sf2_)
          addForecastRegion(modulationRegionIndex(voice), voice.channel, voice.midi,
                            voice.outputMidi, voice.velocity, 0u, &voice);
        else
          requestVoiceSamples(voice, window);
      };
      for (const auto &voice : *voices_)
        if (voice.region)
          collectVoice(voice);
      for (const auto &voice : *paused_voices_)
        if (voice.region) {
          auto reattack = voice;
          reconstructReattack(reattack, true);
          collectVoice(reattack);
        }
      if ((flags & 8u) && bank()->sf2_)
        for (auto channel = 0u; channel < (Midi ? 16u : 1u); ++channel) {
          if (midi_selected_channel_ && midi_selected_channel_ != channel + 1u)
            continue;
          const auto presetIndex = sf2PresetIndex(channel, (*forecast_channels_)[channel], true);
          if (presetIndex == UINT32_MAX)
            continue;
          const auto preset = bank()->preset(presetIndex);
          for (auto i = preset.firstRegion; i < preset.firstRegion + preset.regionCount; ++i) {
            const auto *r = bank()->region(i);
            const auto key = static_cast<std::uint32_t>(r[HighKey]);
            addForecastRegion(i, channel, key, key, static_cast<std::uint32_t>(r[HighVelocity]), 0u,
                              nullptr, true);
          }
        }
    }
    if (!forecast_admission_ || forecast_window_ != window)
      return ET_ERR_STATE;
    if (forecast_input_invalidated_)
      return ET_ERR_STATE;
    if (flags & 2u) {
      if (!forecast_applied_) {
        for (const auto &source : bank()->cache_.forecastSources())
          if (source.onset < window)
            requestRegionSamples(bank()->region(source.region), source.position, source.maximumStep,
                                 source.flags & 4u ? std::min(window, max_frames_)
                                                   : window - source.onset,
                                 (source.flags & 1u) != 0u, (source.flags & 2u) != 0u);
        const auto admitted = bank()->cache_.admitForecast();
        if (admitted != SamplePageCache::Admission::Admitted) {
          forecast_admission_ = false;
          return admitted == SamplePageCache::Admission::Pressure ? ET_ERR_OOM : ET_ERR_ARGS;
        }
        forecast_applied_ = true;
        readiness_acknowledged_ = false;
        readiness_end_ = forecast_anchor_ + window;
        stream_readiness_ = {generation,
                             forecast_scope_,
                             window,
                             0u,
                             bank()->cache_.plannedPages(),
                             bank()->cache_.pendingPages()};
      }
      if (readiness_acknowledged_)
        return ET_OK;
      if (!bank()->cache_.commitForecast())
        return bank()->cache_.requestOverflow() ? ET_ERR_OOM : ET_NEED_SAMPLE;
      readiness_acknowledged_ = true;
      return ET_OK;
    }
    for (auto i = 0u; i < count; ++i) {
      const auto &event = events[i];
      if (event.offset_frames > window || event.offset_frames < forecast_last_offset_ ||
          event.render_frame_low || event.render_frame_high ||
          (!systemResetEvent(event) && !drumModeEvent(event) &&
           ((event.message & 255u) < 0x80u || (event.message & 255u) >= 0xf0u ||
            (event.message & 0xff808000u) || event.flags)))
        return ET_ERR_ARGS;
      forecast_offset_ = forecast_last_offset_ = event.offset_frames;
      if (systemResetEvent(event)) {
        initializeMidiChannels(*forecast_channels_, true);
        for (auto channel = 0u; channel < 16u; ++channel)
          refreshForecastPitch(channel, 0xb0u, 0u, true, true);
        continue;
      }
      if (drumModeEvent(event)) {
        applyDrumMode(*forecast_channels_, event, true);
        continue;
      }
      const auto message = event.message, channel = message & 15u, kind = message & 0xf0u;
      const auto key = (message >> 8u) & 127u, value = (message >> 16u) & 127u;
      if (midi_selected_channel_ && midi_selected_channel_ != channel + 1u)
        continue;
      auto &state = (*forecast_channels_)[channel];
      const auto range = state.bendRange;
      if (kind == 0x90u && value && event.offset_frames < window)
        forecastNoteSamples(*forecast_channels_, channel, key, value,
                            bank()->sf2_ ? window : window - event.offset_frames);
      else if (kind == 0xb0u)
        applyChannelControllerState(state, key, value);
      else if (kind == 0xc0u) {
        state.program = key;
        state.melodicBank = state.cc[0];
        state.bank = state.drumMode ? 128u : state.melodicBank;
      } else if (kind == 0xd0u)
        state.aftertouch = key;
      else if (kind == 0xa0u)
        state.pressure[key] = static_cast<std::uint8_t>(value);
      else if (kind == 0xe0u)
        state.bend = static_cast<int>(key | value << 7u) - 8192;
      if (bank()->sf2_) {
        const bool resetInputs = kind == 0xb0u && key == 121u;
        refreshForecastPitch(channel, kind, key, range != state.bendRange, resetInputs);
        if (kind == 0x80u || (kind == 0x90u && !value))
          forecastReleasedSources(channel, key, event.offset_frames);
        else if (kind == 0xb0u && ((key == 64u && value < 64u) || (key == 66u && value < 64u) ||
                                   key == 121u || key >= 123u))
          forecastReleasedSources(channel, 128u, event.offset_frames);
      }
    }
    return ET_OK;
  }
  void invalidateForecastReceipt(bool prefixOnly) noexcept {
    if (!prefixOnly || stream_readiness_.scope == ET_STREAM_SCOPE_SELECTED_PRESETS ||
        stream_readiness_.scope == ET_STREAM_SCOPE_BEST_EFFORT ||
        (forecast_admission_ && (forecast_scope_ == ET_STREAM_SCOPE_SELECTED_PRESETS ||
                                 forecast_scope_ == ET_STREAM_SCOPE_BEST_EFFORT))) {
      // Accepted MIDI may run on the render path. Expire only the receipt here;
      // the next CONTROL replacement handles pins/requests, with no RT scan.
      forecast_input_invalidated_ = true;
      readiness_acknowledged_ = false;
    }
  }
  void clearSampleForecast() noexcept {
    forecast_valid_ = false;
    forecast_admission_ = forecast_applied_ = readiness_acknowledged_ = false;
    forecast_input_invalidated_ = false;
    stream_readiness_ = {};
    if (bank() && bank()->streamed_)
      bank()->cache_.clearForecast();
  }
  void requestRegionSamples(const float *r, double position, double step, std::uint32_t window,
                            bool looped, bool loopAllowed = true,
                            const Voice *voice = nullptr) noexcept {
    if (!std::isfinite(step) || step <= 0)
      return;
    const auto radius = std::ceil(kFilterRadius * resampling_tables_->maximumBankStep(step)) + 2.0;
    const auto travel = std::ceil(step * window);
    const auto backwards = voice ? reverse(*voice) : r[Direction] == 1.0F;
    const auto low = position - radius - (backwards ? travel : 0.0);
    const auto high = position + radius + (backwards ? 0.0 : travel);
    const auto end = voice ? boundary(*voice, End) : static_cast<double>(indexValue(r, End));
    const auto request = [&](double first, double last) {
      first = first < 0 ? 0 : std::floor(first);
      last = last > end ? end : std::ceil(last);
      if (last >= first)
        bank()->cache_.requestWindow(indexValue(r, Sample), static_cast<std::uint64_t>(first),
                                     static_cast<std::uint64_t>(last - first) + 1u);
    };
    if (!loopAllowed || (r[LoopMode] != 2.0F && r[LoopMode] != 3.0F)) {
      request(low, high);
      return;
    }
    const auto start =
        voice ? boundary(*voice, LoopStart) : static_cast<double>(indexValue(r, LoopStart));
    const auto loopEnd =
        voice ? boundary(*voice, LoopEnd) : static_cast<double>(indexValue(r, LoopEnd));
    const auto length = loopEnd - start + 1.0;
    // Reattack can restart outside the loop while retaining wrapped FIR guards.
    if (looped && position < start)
      request(low, std::min(high, start - 1.0));
    else if (looped && position > loopEnd)
      request(std::max(low, loopEnd + 1.0), high);
    request(looped || backwards ? std::max(low, start) : low,
            looped || !backwards ? std::min(high, loopEnd) : high);
    if (low < start && (looped || backwards)) {
      const auto spill = start - low;
      request(spill >= length ? start : loopEnd - spill + 1.0, loopEnd);
    }
    if (high > loopEnd && (looped || !backwards)) {
      const auto spill = high - loopEnd;
      request(start, spill >= length ? loopEnd : start + spill - 1.0);
    }
  }
  void requestVoiceSamples(const Voice &voice, std::uint32_t window) noexcept {
    // An onset may enter its tuned loop within this forecast. Cover both phases.
    auto step = std::max(voice.step, effectiveSourceStep(voice, true));
    if (bank()->sf2_) {
      const auto &g = voice.sf2Parameters.generators;
      step = voice.controllerStep *
             std::exp2((std::abs(g[5]) + std::abs(g[6]) + std::max(0.0F, g[7])) / 1200.0);
    }
    requestRegionSamples(voice.region, voice.position, step, window, voice.looped, looping(voice),
                         &voice);
  }
  void forecastRegionSamples(std::uint32_t index, const MidiChannel &channel,
                             std::uint32_t physicalKey, std::uint32_t musicalKey,
                             std::uint32_t velocity, std::uint32_t window,
                             std::uint32_t channelIndex) noexcept {
    const auto *r = bank()->region(index);
    double step;
    if (bank()->silentRegion(index))
      return;
    if (forecast_admission_ && bank()->sf2_) {
      addForecastRegion(index, channelIndex, physicalKey, musicalKey, velocity, forecast_offset_);
      return;
    }
    if (bank()->sf2_) {
      const auto *section = bank()->payload_.data() + 8u + bank()->modulation_offset_;
      const auto directory = std::bit_cast<std::uint32_t>(section[5]);
      const auto records = std::bit_cast<std::uint32_t>(section[6]);
      const auto first = std::bit_cast<std::uint32_t>(section[directory + index * 4u]);
      const auto count = std::bit_cast<std::uint32_t>(section[directory + index * 4u + 1u]);
      sf2::Resolved resolved;
      const sf2::Inputs input{
          channel.cc.data(),  musicalKey,   velocity,         channel.pressure[physicalKey],
          channel.aftertouch, channel.bend, channel.bendRange};
      if (!sf2::evaluate(std::span<const float, 61>(bank()->sf2Generators(index), 61),
                         {section + records + first * 10u, count}, input,
                         {bank()->sf2_scratch_.data(), bank()->sf2_scratch_.size()}, r[KeyCenter],
                         r[Tune], resolved))
        return;
      const auto &g = resolved.generators;
      step =
          r[Rate] / rate_ *
          std::exp2((resolved.pitchCents + std::abs(g[5]) + std::abs(g[6]) + std::max(0.0F, g[7])) /
                    1200.0);
    } else {
      double cents = (musicalKey - r[KeyCenter]) * r[KeyTrack] + 100.0 * r[Transpose] + r[Tune] +
                     r[PitchVelocityTrack] * velocity / 127.0 + std::abs(r[PitchRandom]) +
                     std::abs(r[PitchEGDepth]) + std::abs(r[PitchLFODepth]);
      const auto controls = indexValue(r, ControlCount), offset = indexValue(r, ControlOffset);
      for (auto control = 0u; control < controls; ++control) {
        const auto *entry = bank()->payload_.data() + 8u + offset + control * 2u;
        const auto id = std::bit_cast<std::uint32_t>(entry[0]);
        if (id / 512u == TuneCC)
          cents += channel.cc[id % 512u] / 127.0 * entry[1];
      }
      cents += channel.bend < 0 ? r[BendDown] * (-channel.bend / 8192.0) * channel.bendRange / 2
                                : r[BendUp] * (channel.bend / 8191.0) * channel.bendRange / 2;
      step = r[Rate] / rate_ * std::exp2(cents / 1200.0);
    }
    if (bank()->modulation_ && playbackPlan(r)) {
      // Reuse the prepared preview state; forecasts never mutate a sounding voice.
      const auto view = bank()->modulation_->region(index);
      auto state = bank()->modulation_->preview.state(0, bank()->modulation_->plan(index).layout);
      refreshModulationSources();
      auto values = (*modulation_sources_)[channelIndex];
      for (auto cc = 0u; cc < 128u; ++cc)
        values[cc] = channel.normalizedCC[cc];
      values[128] = static_cast<float>(channel.bend + 8192) / 16383.0F;
      values[129] = channel.aftertouch / 127.0F;
      values[130] = channel.pressure[physicalKey] / 127.0F;
      modulation::resetVoice(
          view, state,
          {static_cast<float>(musicalKey), static_cast<float>(velocity), 0, 0, true, seed_},
          {values, midi_clock_}, rate_);
      Voice voice;
      voice.region = r;
      voice.channel = channelIndex;
      voice.step = step;
      voice.historyOnly = true;
      initializePlayback(voice, state, &channel, false);
      if (voice.region)
        requestVoiceSamples(voice, window);
    } else
      requestRegionSamples(r, r[Direction] == 1.0F ? indexValue(r, End) : indexValue(r, Offset),
                           step, window, false);
  }
  void forecastNoteSamples(const std::array<MidiChannel, 16> &channels, std::uint32_t channel,
                           std::uint32_t key, std::uint32_t velocity,
                           std::uint32_t window) noexcept {
    const auto musicalKey = logicalNoteKey(key);
    if (musicalKey < 0 || musicalKey > 127)
      return;
    const auto sampleKey = sampleKeyForTarget(musicalKey);
    if (sampleKey < 0 || sampleKey > 127)
      return;
    const auto &state = channels[channel];
    std::uint32_t selected = UINT32_MAX;
    if (bank()->sf2_) {
      selected = sf2PresetIndex(channel, state, true);
      if (selected == UINT32_MAX)
        return;
    }
    const auto *keys = bank()->indices_.data() + 129u + 2u * bank()->group_count_;
    for (auto at = bank()->indices_.data()[sampleKey]; at < bank()->indices_.data()[sampleKey + 1u];
         ++at) {
      const auto index = keys[at];
      const auto *r = bank()->region(index);
      if (velocity < r[LowVelocity] || velocity > r[HighVelocity])
        continue;
      if (bank()->sf2_ && bank()->presetForRegion(index) != selected)
        continue;
      forecastRegionSamples(index, state, key, static_cast<std::uint32_t>(musicalKey), velocity,
                            window, channel);
    }
  }
  void mixNoteOutputFrame(float *audio, std::uint32_t channels, std::uint32_t frames,
                          std::uint32_t frame, float dry_gain, float wet_gain, float output_gain,
                          bool routed) noexcept {
    float left = 0, right = 0;
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
          delayed_sample(dry_.data() + static_cast<std::size_t>(channel) * dry_length_, dry_length_,
                         dry_position_, dry_delay_, old_dry_delay_);
      const auto wet =
          routed ? delayed_sample(wet_.data() + static_cast<std::size_t>(channel) * wet_length_,
                                  wet_length_, wet_position_, wet_delay_, old_wet_delay_)
          : channels == 1u ? .5F * (left + right)
          : channel == 0u  ? left
          : channel == 1u  ? right
                           : 0.0F;
      audio[channel * frames + frame] = (delayed * dry_gain + wet * wet_gain) * output_gain;
    }
    dry_position_ = (dry_position_ + 1u) % dry_length_;
    wet_position_ = (wet_position_ + 1u) % wet_length_;
    if (timing_fade_)
      --timing_fade_;
  }
  bool beginSfzEffects(std::uint32_t frames) noexcept {
    sfz_quantum_started_ = false;
    if (!bank() || bank()->state_ != ET_ASSET_STATE_ACTIVE || !bank()->sfz_effects_ ||
        midi_history_pending_ || (midi_flags_ & ET_MIDI_STATE_ONLY))
      return true;
    sfz_quantum_started_ =
        bank()->sfz_effects_->beginQuantum(frames, accepted_global_cc_, midi_clock_);
    return sfz_quantum_started_;
  }
  void captureSfzEffectSources(std::uint32_t frame) noexcept {
    if (!sfz_quantum_started_)
      return;
    refreshModulationSources();
    auto *output = bank()->sfz_effect_sources_.data() + static_cast<std::size_t>(frame) * 28u;
    std::copy_n((*modulation_sources_)[0].data() + 128u, 28u, output);
    std::copy_n(accepted_global_extended_.data(), 3u, output);
  }
  et_status commitSfzEffects(float *audio, std::uint32_t channels, std::uint32_t frames,
                             const ProcessInfo &info) noexcept {
    if (!sfz_quantum_started_)
      return ET_OK;
    if (!bank() || !bank()->sfz_effects_ || !audio || channels != bank()->sfz_effect_channels_ ||
        frames != bank()->sfz_effects_->pendingFrames() || frames > bank()->sfz_effect_frames_)
      return ET_ERR_STATE;
    const auto curves = bank()->modulation_->region(0).curves;
    const auto outputGain = std::pow(10.0F, bounded(params_.outputGain, -60, 12, 0) * .05F);
    float dryGain = 0, wetGain = 1;
    if constexpr (!Midi) {
      dryGain = bounded(params_.dryMix, 0, 100, 0) * .01F;
      wetGain = bounded(params_.wetMix, 0, 100, 100) * .01F;
    }
    const bool committed = bank()->sfz_effects_->commitOutput(
        channels, info, curves,
        [&](std::uint32_t frame, std::span<float> extended) {
          std::copy_n(bank()->sfz_effect_sources_.data() + static_cast<std::size_t>(frame) * 28u,
                      28u, extended.data());
        },
        [&](std::uint32_t frame, std::uint32_t channel, float value) {
          if constexpr (Midi)
            audio[static_cast<std::size_t>(channel) * frames + frame] +=
                value * outputGain * midi_gain_;
          else {
            wet_.data()[static_cast<std::size_t>(channel) * wet_length_ + wet_position_] = value;
            if (channel + 1u == channels)
              mixNoteOutputFrame(audio, channels, frames, frame, dryGain, wetGain, outputGain,
                                 true);
          }
        });
    sfz_quantum_started_ = false;
    return committed ? ET_OK : ET_ERR_STATE;
  }
  void commitSf2Effects(float *audio, std::uint32_t channels, std::uint32_t frames,
                        const ProcessInfo &info) noexcept {
    if (!bank() || !bank()->sf2_effects_ || (!sf2_has_sends_ && !bank()->sf2_effects_->active()))
      return;
    auto *chorus = sf2_sends_.data(), *reverb = chorus + frames * 2u;
    bank()->sf2_effects_->process(chorus, reverb, frames, info);
    auto gain = std::pow(10.0F, bounded(params_.outputGain, -60, 12, 0) * .05F);
    if constexpr (Midi)
      gain *= midi_gain_;
    else
      gain *= bounded(params_.wetMix, 0, 100, 100) * .01F;
    for (auto frame = 0u; frame < frames; ++frame) {
      float left = chorus[frame] + reverb[frame];
      float right = chorus[frames + frame] + reverb[frames + frame];
      if constexpr (!Midi) {
        sf2_fx_delay_.data()[sf2_fx_position_] = left;
        sf2_fx_delay_.data()[wet_length_ + sf2_fx_position_] = right;
        const auto weight = sf2_timing_fade_start_ > frame
                                ? static_cast<float>(sf2_timing_fade_start_ - frame) / fade_length_
                                : 0.0F;
        const auto delayed = [&](const float *buffer) {
          const auto current = buffer[(sf2_fx_position_ + wet_length_ - wet_delay_) % wet_length_];
          return weight == 0
                     ? current
                     : current * (1.0F - weight) +
                           buffer[(sf2_fx_position_ + wet_length_ - old_wet_delay_) % wet_length_] *
                               weight;
        };
        left = delayed(sf2_fx_delay_.data());
        right = delayed(sf2_fx_delay_.data() + wet_length_);
        sf2_fx_position_ = (sf2_fx_position_ + 1u) % wet_length_;
      }
      if (channels == 1)
        audio[frame] += .5F * (left + right) * gain;
      else {
        audio[frame] += left * gain;
        audio[frames + frame] += right * gain;
      }
    }
  }
  void copyOfflineTrial(bool restore) noexcept {
    auto &trial = *offline_trial_;
    const auto copy = [restore](auto &live, auto &saved) {
      if (restore)
        live = saved;
      else
        saved = live;
    };
    copy(static_cast<RenderState &>(*this), trial.state);
    copy(*voices_, trial.voices);
    copy(*paused_voices_, trial.pausedVoices);
    copy(*midi_channels_, trial.channels);
    copy(*script_messages_, trial.messages);
    if (script_session_)
      copy(*script_session_, *trial.session);
    if (bank()->modulation_) {
      if (restore) {
        bank()->modulation_->state.copyFrom(*trial.modulation);
        bank()->endModulationTrial(true);
      } else {
        trial.modulation->copyFrom(bank()->modulation_->state);
      }
    }
    const auto buffer = [restore](auto *live, auto *saved, std::size_t count) {
      std::copy_n(restore ? saved : live, count, restore ? live : saved);
    };
    buffer(dry_.data(), trial.dry.data(), static_cast<std::size_t>(max_channels_) * dry_length_);
    buffer(wet_.data(), trial.wet.data(), wet_.size());
    buffer(bank()->indices_.data() + 129u, trial.sequences.data(), 2u * bank()->group_count_);
    buffer(bank()->timer_frames_.data(), trial.timers.data(), bank()->timer_frames_.size());
  }
  std::uint32_t checkpointStorageSize() const noexcept {
    if (!bank() || bank()->state_ != ET_ASSET_STATE_ACTIVE)
      return 0;
    const std::uint64_t bytes =
        200u + 131u * 8u + 16u * 7736u + kVoices * 180u +
        static_cast<std::uint64_t>(bank()->group_count_) * 8u + bank()->timer_frames_.size() * 8u +
        (script_session_ ? ScriptSession::checkpointBytes() + script::VM::checkpointBytes() : 0u);
    return bytes <= 32u * 1024u * 1024u ? static_cast<std::uint32_t>(bytes) : 0u;
  }
  template <bool Reading> bool checkpointState(script::CheckpointIO<Reading> &io) noexcept {
    auto magic = 0x31434d45u, version = 9u, size = checkpointStorageSize();
    auto profile = (kVersion << 1u) | (Midi ? 1u : 0u);
    auto fingerprint = bank()->fingerprint_;
    double oldRate = rate_;
    auto channel = midi_selected_channel_;
    auto scripted = script_session_ != nullptr;
    auto groups = bank()->group_count_;
    io.field(magic);
    io.field(version);
    io.field(size);
    io.field(profile);
    io.field(fingerprint);
    io.field(oldRate);
    io.field(channel);
    if constexpr (Reading) {
      if (magic != 0x31434d45u || version != 9u || size != io.length ||
          profile != ((kVersion << 1u) | (Midi ? 1u : 0u)) || fingerprint != bank()->fingerprint_ ||
          !std::isfinite(oldRate) || oldRate < 1 || oldRate > 768000)
        return false;
      if constexpr (Midi)
        if (channel != static_cast<unsigned>(std::round(bounded(params_.midiChannel, 0, 16, 0))))
          return false;
      midi_selected_channel_ = channel;
    }
    io.field(midi_generation_);
    io.field(midi_clock_);
    io.field(random_);
    io.field(seed_);
    io.field(salt_);
    io.field(midi_identity_);
    io.field(note_serial_);
    io.field(age_);
    io.field(midi_ended_);
    io.field(scripted);
    io.field(groups);
    if (scripted != (script_session_ != nullptr) || groups != bank()->group_count_)
      return false;
    const auto floatField = [&](float &value) {
      double exact = value;
      io.field(exact);
      if constexpr (Reading) {
        if (!std::isfinite(exact))
          io.ok = false;
        value = static_cast<float>(exact);
      }
    };
    const auto smallField = [&](auto &value, std::uint32_t maximum) {
      auto exact = static_cast<std::uint32_t>(value);
      io.field(exact);
      if (exact > maximum)
        io.ok = false;
      if constexpr (Reading) {
        value = static_cast<std::remove_reference_t<decltype(value)>>(exact);
      }
    };
    io.field(midi_transport_mapping_.frame);
    io.field(midi_transport_mapping_.seconds);
    io.field(midi_transport_mapping_.speed);
    io.field(midi_transport_mapping_.duration);
    io.field(midi_transport_mapping_.flags);
    floatField(modulation_velocity_);
    floatField(modulation_release_velocity_);
    floatField(modulation_key_);
    floatField(modulation_random_);
    floatField(modulation_alternate_);
    floatField(modulation_key_delta_);
    floatField(modulation_last_offset_);
    io.field(modulation_last_on_);
    io.field(modulation_last_off_);
    io.field(modulation_has_key_);
    for (auto &value : accepted_global_cc_) {
      floatField(value);
      if (value < 0 || value > 1)
        io.ok = false;
    }
    for (auto &value : accepted_global_extended_) {
      floatField(value);
      if (value < 0 || value > 1)
        io.ok = false;
    }
    if constexpr (Reading) {
      const auto scale = [&](std::uint64_t &frame) {
        const auto converted = std::floor(frame * static_cast<double>(rate_) / oldRate + .5);
        if (!std::isfinite(converted) || converted > 9007199254740991.0)
          io.ok = false;
        else
          frame = static_cast<std::uint64_t>(converted);
      };
      scale(midi_transport_mapping_.frame);
      scale(modulation_last_on_);
      scale(modulation_last_off_);
      if (!midi_transport_mapping_.valid() || modulation_velocity_ < 0 ||
          modulation_velocity_ > 127 || modulation_release_velocity_ < 0 ||
          modulation_release_velocity_ > 127 || modulation_key_ < 0 || modulation_key_ > 127 ||
          modulation_random_ < 0 || modulation_random_ > 1 ||
          (modulation_alternate_ != 0 && modulation_alternate_ != 1) ||
          std::abs(modulation_key_delta_) > 127 || modulation_last_offset_ < 0)
        io.ok = false;
    }
    for (auto &state : *midi_channels_) {
      for (auto *values : {&state.cc, &state.inputCC, &state.pressure, &state.velocity})
        for (auto &value : *values)
          smallField(value, 127);
      for (auto &value : state.normalizedCC) {
        floatField(value);
        if (value < 0 || value > 1)
          io.ok = false;
      }
      for (auto &value : state.preciseCC)
        io.field(value);
      for (auto cc = 0u; cc < 128u; ++cc)
        if (state.preciseCC[cc] ? std::round(state.normalizedCC[cc] * 127) != state.cc[cc]
                                : state.normalizedCC[cc] != state.cc[cc] / 127.0F)
          io.ok = false;
      for (auto *values : {&state.keys, &state.pendingRelease})
        for (auto &value : *values)
          smallField(value, 65535);
      for (auto &value : state.first)
        io.field(value);
      for (auto &value : state.keySerial)
        io.field(value);
      for (auto &value : state.random) {
        io.field(value);
        if (!std::isfinite(value) || value < 0 || value > 1)
          io.ok = false;
      }
      for (auto &frame : state.noteOnFrames) {
        io.field(frame);
        if constexpr (Reading) {
          if (frame != UINT64_MAX) {
            const double converted = std::floor(frame * static_cast<double>(rate_) / oldRate + .5);
            if (!std::isfinite(converted) || converted > 9007199254740991.0)
              io.ok = false;
            else
              frame = static_cast<std::uint64_t>(converted);
          }
        }
      }
      io.field(state.serial);
      io.field(state.last);
      io.field(state.previous);
      io.field(state.bend);
      io.field(state.inputBend);
      io.field(state.program);
      io.field(state.bank);
      io.field(state.melodicBank);
      io.field(state.drumMode);
      io.field(state.preset);
      io.field(state.aftertouch);
      io.field(state.inputAftertouch);
      floatField(state.bendRange);
      if (state.last < -1 || state.last > 127 || state.previous < -1 || state.previous > 127 ||
          state.bend < -8192 || state.bend > 8191 || state.inputBend < -8192 ||
          state.inputBend > 8191 || state.program > 127 || state.aftertouch > 127 ||
          state.inputAftertouch > 127 || state.bendRange < 0 || state.bendRange > 129 ||
          state.bank > 128 || state.melodicBank > 127 || state.drumMode > 3 ||
          state.bank != (state.drumMode ? 128u : state.melodicBank) ||
          (state.preset != UINT32_MAX && (!bank()->sf2_ || state.preset >= bank()->preset_count_)))
        io.ok = false;
    }
    for (auto &voice : *paused_voices_) {
      auto index = voice.region
                       ? static_cast<std::uint32_t>((voice.region - bank()->region(0)) / kStride)
                       : UINT32_MAX;
      io.field(index);
      io.field(voice.channel);
      io.field(voice.noteId);
      io.field(voice.midi);
      io.field(voice.outputMidi);
      io.field(voice.velocity);
      io.field(voice.keyDown);
      io.field(voice.looped);
      io.field(voice.sostenuto);
      io.field(voice.preview);
      io.field(voice.scriptWholeSample);
      io.field(voice.age);
      floatField(voice.gainLeft);
      floatField(voice.gainRight);
      io.field(voice.baseStep);
      io.field(voice.delayFrames);
      floatField(voice.modulationRandom);
      io.field(voice.playbackEnabled);
      io.field(voice.playbackTiming.startBeat);
      io.field(voice.playbackTiming.stopBeat);
      io.field(voice.playbackTiming.seconds);
      io.field(voice.playbackTiming.started);
      io.field(voice.playbackTiming.cancelled);
      io.field(voice.sourceFirst);
      io.field(voice.sourceLast);
      io.field(voice.loopFirst);
      io.field(voice.loopLast);
      io.field(voice.playbackLoopRatio);
      io.field(voice.playbackReverse);
      io.field(voice.sampleQuality);
      io.field(voice.loopLimit);
      if constexpr (Reading) {
        if (index != UINT32_MAX && index >= bank()->region_count_)
          return false;
        if (voice.channel > 15 || voice.midi > 127 || voice.outputMidi > 127 ||
            voice.velocity > 127 || !std::isfinite(voice.baseStep) || voice.baseStep <= 0 ||
            voice.delayFrames > oldRate * 200.0 + 1 || voice.modulationRandom < 0 ||
            voice.modulationRandom > 1)
          io.ok = false;
        voice.region = index == UINT32_MAX ? nullptr : bank()->region(index);
        voice.preset = voice.region && bank()->sf2_ ? bank()->presetForRegion(index) : UINT32_MAX;
        voice.historyOnly = voice.region != nullptr;
        voice.released = voice.retired = false;
        voice.elapsed = voice.releaseElapsed = 0;
        voice.fade = fade_length_;
        voice.stolenLeft = voice.stolenRight = 0;
        voice.baseStep *= oldRate / rate_;
        voice.step = voice.controllerStep = voice.baseStep;
        voice.delayFrames =
            static_cast<std::uint32_t>(std::floor(voice.delayFrames * rate_ / oldRate + .5));
        voice.modulationRevision = 0;
        voice.equalizer = {};
        if (!std::isfinite(voice.playbackTiming.startBeat) ||
            std::isnan(voice.playbackTiming.stopBeat) ||
            !std::isfinite(voice.playbackTiming.seconds))
          io.ok = false;
        if (voice.playbackEnabled &&
            (!std::isfinite(voice.sourceFirst) || !std::isfinite(voice.sourceLast) ||
             !std::isfinite(voice.loopFirst) || !std::isfinite(voice.loopLast) ||
             !std::isfinite(voice.playbackLoopRatio) || voice.playbackLoopRatio <= 0 ||
             voice.sourceFirst < 0 || voice.sourceLast < voice.sourceFirst || voice.loopFirst < 0 ||
             voice.loopLast < voice.loopFirst || voice.sampleQuality > 10))
          io.ok = false;
      }
    }
    auto *sequences = bank()->indices_.data() + 129u;
    for (auto i = 0u; i < groups * 2u; ++i)
      io.field(sequences[i]);
    for (auto i = 0u; i < bank()->timer_frames_.size(); ++i) {
      auto &frame = bank()->timer_frames_.data()[i];
      io.field(frame);
      if constexpr (Reading) {
        if (frame != UINT64_MAX) {
          const double converted = std::floor(frame * static_cast<double>(rate_) / oldRate + .5);
          if (!std::isfinite(converted) || converted > 9007199254740991.0)
            io.ok = false;
          else
            frame = static_cast<std::uint64_t>(converted);
        }
      }
    }
    if (scripted) {
      script_session_->checkpoint(io);
      const auto bytes = script::VM::checkpointBytes();
      if (io.offset > io.length || bytes > io.length - io.offset)
        return false;
      if constexpr (Reading) {
        if (!script_session_->vm.readCheckpoint(io.input + io.offset, bytes))
          return false;
      } else if (!script_session_->vm.writeCheckpoint(io.output + io.offset, bytes))
        return false;
      io.offset += bytes;
      if constexpr (Reading) {
        for (auto &note : script_session_->notes) {
          if (note.id && (note.key > 127 || note.pitch > 127 || note.velocity > 127 ||
                          note.channel > 15 || !std::isfinite(note.sampleOffset) ||
                          note.sampleOffset < -1 || note.birthFrame > 9007199254740991ull))
            return false;
          if (!note.automation.rescaleClock(oldRate, rate_))
            return false;
          const auto birth = static_cast<double>(note.birthFrame) * rate_ / oldRate;
          if (!std::isfinite(birth) || birth > 9007199254740991.0)
            return false;
          note.birthFrame = static_cast<std::uint64_t>(std::floor(birth + .5));
        }
        if (!script_session_->vm.rescaleClock(oldRate, rate_))
          return false;
        std::array<std::uint32_t, kScriptScheduled> order{};
        std::uint32_t count = 0;
        for (auto i = 0u; i < kScriptScheduled; ++i)
          if (script_session_->scheduled[i].id)
            order[count++] = i;
        std::sort(order.begin(), order.begin() + count, [&](auto a, auto b) {
          const auto &first = script_session_->scheduled[a],
                     &second = script_session_->scheduled[b];
          return first.frame < second.frame ||
                 (first.frame == second.frame && first.order < second.order);
        });
        for (auto i = 0u; i < count; ++i) {
          auto &event = script_session_->scheduled[order[i]];
          const double frame = event.frame * static_cast<double>(rate_) / oldRate;
          if (!std::isfinite(frame) || frame > 9007199254740991.0 ||
              !script_session_->find(event.id))
            return false;
          event.frame = static_cast<std::uint64_t>(std::floor(frame + .5));
          event.order = i + 1u;
        }
      }
    }
    if constexpr (Reading) {
      const double frame = midi_clock_ * static_cast<double>(rate_) / oldRate;
      if (!std::isfinite(frame) || frame > 9007199254740991.0)
        return false;
      midi_clock_ = static_cast<std::uint64_t>(std::floor(frame + .5));
      ++midi_revision_;
    }
    return io.ok && io.offset == io.length;
  }
  bool supportsScript(const script::Program &program) const noexcept {
    return program.supportsHost(*this);
  }
  bool supports(script::Builtin builtin) const noexcept override {
    return builtin == script::Builtin::Message ||
           (builtin >= script::Builtin::ByMarks && builtin <= script::Builtin::SetRpn);
  }
  bool scriptMessage(const script::Value &value) noexcept {
    if (script_message_count_ == script_messages_->size()) {
      if (script_messages_dropped_ != UINT32_MAX)
        ++script_messages_dropped_;
      return true;
    }
    auto &text = (*script_messages_)[(script_message_head_ + script_message_count_) %
                                     script_messages_->size()];
    text.fill(0);
    if (value.kind == 2)
      std::copy_n(value.text.data(), text.size() - 1u, text.data());
    else {
      if (value.kind > 1)
        return false;
      auto converted =
          value.kind == 0 && !value.unit() && !value.hasPrefix()
              ? std::to_chars(text.data(), text.data() + text.size() - 4u, value.integer)
              : std::to_chars(text.data(), text.data() + text.size() - 4u, value.numeric());
      if (converted.ec != std::errc{})
        return false;
      if (value.unit() == 1)
        *converted.ptr++ = 's';
      else if (value.unit() == 2) {
        *converted.ptr++ = 'H';
        *converted.ptr++ = 'z';
      } else if (value.unit() == 3)
        *converted.ptr++ = 'B';
    }
    ++script_message_count_;
    return true;
  }
  ScriptNote *voiceScriptNote(const Voice &voice) noexcept {
    if (voice.retired || !script_session_ || voice.scriptSlot >= kScriptNotes)
      return nullptr;
    auto &note = script_session_->notes[voice.scriptSlot];
    return note.id == voice.noteId ? &note : nullptr;
  }
  void assignScriptSlot(Voice &voice) noexcept {
    voice.scriptSlot = UINT32_MAX;
    if (script_session_)
      if (auto *note = script_session_->find(voice.noteId))
        voice.scriptSlot = static_cast<std::uint32_t>(note - script_session_->notes.data());
  }
  double scriptControl(const Voice &voice, script::VoiceTarget target, double value,
                       double patch) noexcept {
    const auto *note = voiceScriptNote(voice);
    const auto index =
        static_cast<unsigned>(target) - static_cast<unsigned>(script::VoiceTarget::Attack);
    return note && index < note->controls.size() ? note->controls[index].apply(value, patch)
                                                 : value;
  }
  bool changeScriptVoice(ScriptNote &note, const script::VoiceChange &change,
                         std::uint64_t frame) noexcept {
    using T = script::VoiceTarget;
    const bool birth = note.queued;
    if (change.newNoteOnly && !birth)
      return true;
    if (change.target == T::Note || change.target == T::Velocity) {
      if (change.target == T::Note)
        note.pitch = static_cast<std::uint32_t>(change.value);
      else
        note.velocity = static_cast<std::uint32_t>(change.value);
    } else if (change.target == T::PlayPosition)
      note.sampleOffset = change.value;
    else if (change.target >= T::Attack && change.target <= T::CutoffLfoFrequency) {
      auto &control =
          note.controls[static_cast<unsigned>(change.target) - static_cast<unsigned>(T::Attack)];
      control = {change.value, 1u | (change.absolute ? 2u : 0u) | (change.final ? 4u : 0u)};
    } else
      return note.automation.apply(change, frame, rate_, birth);
    for (auto &voice : *voices_)
      if (voice.region && !voice.retired && voice.noteId == note.id) {
        if (change.target == T::PlayPosition)
          voice.position = change.value * voice.region[Rate];
        else if (change.target == T::Note) {
          voice.baseStep *= std::exp2((static_cast<double>(note.pitch) - voice.outputMidi) *
                                      voice.region[KeyTrack] / 1200.0);
          voice.outputMidi = note.pitch;
        } else if (change.target == T::Velocity) {
          voice.velocity = note.velocity;
          const auto normalized = voice.region[VelocityTrack] >= 0
                                      ? voice.velocity / 127.0F
                                      : (128.0F - voice.velocity) / 127.0F;
          const auto gain =
              std::pow(10.0F, voice.region[Volume] * .05F) *
              (bank()->sf2_ ? std::pow(normalized, std::abs(voice.region[VelocityTrack]) * .02F)
               : bank()->modulation_ ? 1.0F
                                     : amplifier::velocityGain(static_cast<float>(voice.velocity),
                                                               voice.region[VelocityTrack]));
          const auto pan = voice.region[Pan] * .01F;
          voice.gainLeft = gain * (pan > 0 ? 1.0F - pan : 1.0F);
          voice.gainRight = gain * (pan < 0 ? 1.0F + pan : 1.0F);
        }
        refreshMidiModulation(voice);
        if (change.target == T::Velocity && bank()->modulation_) {
          const auto view = bank()->modulation_->region(modulationRegionIndex(voice));
          initializeAmplifier(voice, view, modulationState(voice));
        }
        if (birth && change.newNoteOnly)
          voice.ampEnvelope.reset(voice.ampParameters, rate_);
      }
    return true;
  }
  bool initializeScript() noexcept {
    if (!script_session_)
      return true;
    if (script_session_->failed)
      return false;
    if (!script_session_->vm.state().initialized) {
      script::Event init{};
      init.controller = UINT32_MAX;
      if (!script_session_->vm.dispatch(script::Callback::Init, init, *this)) {
        script_session_->failed = true;
        return false;
      }
    }
    return true;
  }
  bool advanceScript(std::uint64_t target, std::uint32_t &quota) noexcept {
    if (!script_session_) {
      midi_clock_ = target;
      return true;
    }
    auto &session = *script_session_;
    if (!initializeScript())
      return false;
    while (session.nextFrame() <= target) {
      if (!quota)
        return false;
      --quota;
      const auto frame = session.nextFrame();
      const auto progress = session.vm.advanceSlice(frame, *this, 4096);
      if (progress == script::AdvanceResult::Error) {
        session.failed = true;
        return false;
      }
      if (progress == script::AdvanceResult::Pending)
        return false;
      midi_clock_ = frame;
      for (;;) {
        ScriptScheduled *first = nullptr;
        for (auto &event : session.scheduled)
          if (event.id && event.frame <= frame && (!first || event.order < first->order))
            first = &event;
        if (!first)
          break;
        if (!quota)
          return false;
        --quota;
        const auto id = first->id;
        first->id = 0;
        scriptRelease(id);
      }
    }
    const auto progress = session.vm.advanceSlice(target, *this, 4096);
    if (progress == script::AdvanceResult::Error)
      session.failed = true;
    if (progress != script::AdvanceResult::Complete)
      return false;
    midi_clock_ = target;
    return true;
  }
  void collectScriptNotes() noexcept {
    if (!script_session_)
      return;
    auto &session = *script_session_;
    for (auto &note : session.notes) {
      if (!note.id || note.keyDown || note.physicalDown)
        continue;
      bool retained = false;
      for (const auto &voice : *voices_)
        if (voice.region && voice.noteId == note.id && !voice.retired) {
          retained = true;
          break;
        }
      if (!retained)
        for (const auto &callback : session.vm.state().callbacks)
          if (callback.active && callback.event.id == note.id) {
            retained = true;
            break;
          }
      if (!retained)
        for (const auto &event : session.scheduled)
          if (event.id == note.id) {
            retained = true;
            break;
          }
      if (!retained) {
        session.vm.releaseNote(note.id);
        note.id = 0;
      }
    }
  }
  void pauseMidi() noexcept {
    if (midi_paused_)
      return;
    clearSampleForecast();
    paused_voices_->fill({});
    auto next = 0u;
    for (const auto &voice : *voices_)
      if (voice.region && !voice.retired && heldSourceVoice(voice))
        (*paused_voices_)[next++] = voice;
    retireMidi();
    midi_running_ = false;
    midi_paused_ = true;
  }
  void resumeMidi() noexcept {
    for (auto &voice : *voices_)
      voice = {};
    std::copy_n(paused_voices_->data(), voice_limit_, voices_->data());
    voice_extent_ = voice_limit_;
    trimVoiceExtent();
    for (auto slot = 0u; slot < voices_->size(); ++slot)
      if (auto &voice = (*voices_)[slot]; voice.region) {
        voice.historyOnly = true;
        voice.modulationSlot = slot;
      }
    midi_paused_ = false;
    reattackMidi();
    paused_voices_->fill({});
  }
  void finishMidi() noexcept {
    if (midi_ended_)
      return;
    midi_ended_ = true;
    for (auto &channel : *midi_channels_) {
      channel.cc[64] = 0;
      channel.cc[66] = 0;
      channel.normalizedCC[64] = channel.normalizedCC[66] = 0;
      channel.preciseCC[64] = channel.preciseCC[66] = false;
    }
    if (script_session_) {
      for (auto &note : script_session_->notes)
        if (note.id && !note.generated && note.physicalDown) {
          et_midi_event off{0, 0x80u | note.channel | (note.key << 8u), note.id, 0, 0, 0};
          midiEvent(off, 0);
        }
    }
    for (auto &voice : *voices_)
      if (voice.region && !voice.retired) {
        voice.sostenuto = false;
        const auto *note = script_session_ ? script_session_->find(voice.noteId) : nullptr;
        // Only key-driven regions belong to the source note-off. Release and controller
        // sounds own their playback lifetime, including a first sample coincident with EOF.
        if ((!note || !note->generated) && keyDrivenRegion(voice.region)) {
          voice.keyDown = false;
          releaseMidiVoice(voice);
        }
      }
    for (auto channel = 0u; channel < 16u; ++channel) {
      midi_channel_ = channel;
      auto &state = (*midi_channels_)[channel];
      state.keys.fill(0u);
      flushMidiReleases(state);
    }
    ++midi_revision_;
  }
  void processHistory() noexcept {
    const auto wasStateOnly = midi_state_only_;
    midi_state_only_ = true;
    std::uint32_t quota = 64;
    if (midi_flags_ & ET_MIDI_STATE_ONLY) {
      while (midi_cursor_ < midi_count_) {
        const auto &event = (*midi_events_)[midi_cursor_];
        const auto frame =
            static_cast<std::uint64_t>(event.render_frame_high) << 32u | event.render_frame_low;
        if (!advanceScript(frame, quota)) {
          midi_state_only_ = wasStateOnly;
          return;
        }
        midiEvent(event, ET_MIDI_STATE_ONLY);
        ++midi_cursor_;
        if (!quota--) {
          midi_state_only_ = wasStateOnly;
          return;
        }
      }
      midi_count_ = midi_cursor_ = 0;
    }
    if (midi_history_requested_ && advanceScript(midi_history_target_, quota)) {
      midi_history_pending_ = midi_history_requested_ = false;
    }
    midi_state_only_ = wasStateOnly;
    collectScriptNotes();
  }
  ScriptNote *scriptInput(const et_midi_event &message, bool attack) noexcept {
    if (!script_session_ || script_session_->suppressed)
      return nullptr;
    auto &session = *script_session_;
    if (!initializeScript())
      return nullptr;
    if (!midi_state_only_ && session.vm.hasPendingBudget()) {
      advanceRuntime();
      if (session.failed || session.vm.hasPendingBudget())
        return nullptr;
    }
    const auto key = (message.message >> 8u) & 127u;
    const auto channel = message.message & 15u;
    ScriptNote *note = nullptr;
    if (attack) {
      note = session.allocate(midi_note_id_);
      if (!note) {
        session.failed = true;
        return nullptr;
      }
      note->key = key;
      note->pitch = static_cast<unsigned>(logicalNoteKey(key));
      note->birthFrame = midi_clock_;
      note->velocity = (message.message >> 16u) & 127u;
      note->channel = channel;
      note->keyDown = note->physicalDown = true;
      note->queued = true;
      note->sourcePending = 1;
    } else {
      if (message.note_id)
        note = session.find(message.note_id);
      else
        for (auto &candidate : session.notes)
          if (candidate.id && !candidate.generated && candidate.physicalDown &&
              candidate.channel == channel && candidate.key == key &&
              (!note || candidate.order < note->order))
            note = &candidate;
      if (!note)
        return nullptr;
      note->physicalDown = false;
      note->sourcePending = 2;
      midi_note_id_ = note->id;
    }
    script::Event event{};
    event.id = note->id;
    event.note = static_cast<unsigned>(logicalNoteKey(note->key));
    event.velocity = attack ? note->velocity : (message.message >> 16u) & 127u;
    event.channel = channel;
    event.controller = UINT32_MAX;
    event.frame = midi_clock_;
    event.address = 0x10000u + static_cast<std::uint32_t>(attack ? script::Callback::Note
                                                                 : script::Callback::Release);
    if (!session.vm.dispatch(attack ? script::Callback::Note : script::Callback::Release, event,
                             *this))
      session.failed = true;
    if (!midi_state_only_)
      advanceRuntime();
    return note;
  }
  bool supportsVariable(script::Variable variable) const noexcept override {
    return variable == script::Variable::AllEvents || variable == script::Variable::Cc ||
           variable == script::Variable::KeyDown;
  }
  void diagnostic(script::Error error, std::uint32_t pc) noexcept override {
    if (script_session_) {
      if (script_error_ == script::Error::None) {
        script_error_ = error;
        script_error_pc_ = pc;
      }
      script_session_->failed = true;
    }
  }
  bool read(script::Variable variable, std::uint32_t index, const script::Event &event,
            script::Value &result) noexcept override {
    result = {};
    if (!script_session_ || event.channel > 15u)
      return false;
    const auto &channel = (*midi_channels_)[event.channel];
    if (variable == script::Variable::Cc || variable == script::Variable::KeyDown) {
      if (index == UINT32_MAX) {
        result = script::Value::fromInteger(variable == script::Variable::Cc ? 130 : 128);
        return true;
      }
      if (variable == script::Variable::Cc && (index == 128u || index == 129u)) {
        result = script::Value::fromInteger(
            index == 128u ? static_cast<std::int64_t>(channel.inputAftertouch) : channel.inputBend);
        return true;
      }
      if (index >= 128u)
        return false;
      bool down = channel.keys[index] != 0u;
      if constexpr (!Midi)
        down = std::any_of(script_session_->notes.begin(), script_session_->notes.end(),
                           [index, &event](const auto &note) {
                             return note.id && !note.generated && note.physicalDown &&
                                    note.channel == event.channel && note.key == index;
                           });
      result = script::Value::fromInteger(variable == script::Variable::Cc ? channel.inputCC[index]
                                                                           : down);
      return true;
    }
    if (variable == script::Variable::AllEvents) {
      auto count = 0u;
      for (const auto &note : script_session_->notes)
        if (!note.generated && scriptNoteAlive(note)) {
          if (count++ == index) {
            result = script::Value::fromInteger(note.id);
            return true;
          }
        }
      if (index == UINT32_MAX) {
        result = script::Value::fromInteger(count);
        return true;
      }
    }
    return false;
  }
  bool markedEvent(std::uint32_t mask, std::uint32_t index, const script::Event &,
                   script::Value &result) noexcept override {
    result = {};
    if (!script_session_)
      return false;
    auto count = 0u;
    for (const auto &note : script_session_->notes)
      if (scriptNoteAlive(note) && (note.marks & mask)) {
        if (count++ == index) {
          result = script::Value::fromInteger(note.id);
          return true;
        }
      }
    if (index == UINT32_MAX) {
      result = script::Value::fromInteger(count);
      return true;
    }
    return false;
  }
  bool scriptController(std::uint32_t number, std::uint32_t value) noexcept {
    if (!script_session_ || script_session_->suppressed)
      return true;
    script::Event controller{};
    controller.id = midi_note_id_ | 0x80000000u;
    controller.address = 0x10000u + static_cast<std::uint32_t>(script::Callback::Controller);
    controller.channel = midi_channel_;
    controller.controller = number;
    controller.value = value;
    controller.frame = midi_clock_;
    if (!initializeScript() ||
        !script_session_->vm.dispatch(script::Callback::Controller, controller, *this)) {
      script_session_->failed = true;
      return false;
    }
    if (!midi_state_only_)
      advanceRuntime();
    // The boundary hook applies the source controller after its callback emissions.
    return false;
  }
  bool scriptNoteAlive(const ScriptNote &note) const noexcept {
    if (!note.id || note.ignored)
      return false;
    if (note.queued)
      return true;
    return std::any_of(voices_->begin(), voices_->end(), [&note](const auto &voice) {
      return voice.region && !voice.retired && voice.noteId == note.id;
    });
  }
  void scriptRelease(std::uint32_t id) noexcept {
    if (!script_session_)
      return;
    if (auto *note = script_session_->find(id))
      note->keyDown = false;
    for (auto &voice : *voices_)
      if (voice.region && voice.noteId == id) {
        voice.keyDown = false;
        if ((*midi_channels_)[voice.channel].cc[64] < 64u && !voice.sostenuto)
          releaseMidiVoice(voice, true);
      }
  }
  void scriptGenerated(ScriptNote &note) noexcept {
    const auto channel = midi_channel_, identity = midi_note_id_, trigger = midi_trigger_;
    const auto controller = midi_controller_;
    midi_channel_ = note.channel;
    midi_note_id_ = note.id;
    midi_trigger_ = 0u;
    midi_controller_ = -1;
    if (!note.ignored && bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
      startVoices(note.key, static_cast<int>(note.pitch), note.velocity, false);
    midi_channel_ = channel;
    midi_note_id_ = identity;
    midi_trigger_ = trigger;
    midi_controller_ = controller;
  }
  bool admitScriptNote(ScriptNote &note, std::uint64_t frame) noexcept {
    if (note.ignored) {
      note.queued = false;
      return true;
    }
    scriptGenerated(note);
    note.queued = false;
    if (note.wholeSample) {
      std::uint64_t frames = 0;
      for (const auto &voice : *voices_)
        if (voice.region && voice.noteId == note.id) {
          const auto distance = voice.region[Direction] == 1.0F
                                    ? voice.position - indexValue(voice.region, Offset) + 1.0
                                    : indexValue(voice.region, End) + 1.0 - voice.position;
          const auto seconds = distance / voice.step + voice.delayFrames +
                               voice.ampParameters[EnvelopeParameters::Delay] * rate_;
          if (std::isfinite(seconds) && seconds > 0 && seconds < 9007199254740991.0)
            frames = std::max(frames, static_cast<std::uint64_t>(std::ceil(seconds)));
        }
      if (frames && !script_session_->schedule(note.id, frame + frames))
        return false;
      if (!frames)
        note.keyDown = false;
    }
    return true;
  }
  void callbackBoundary(script::Event &event) noexcept override {
    if (!script_session_ || script_session_->failed)
      return;
    auto &session = *script_session_;
    const auto savedClock = midi_clock_;
    const auto savedChannel = midi_channel_, savedIdentity = midi_note_id_,
               savedTrigger = midi_trigger_;
    const auto savedController = midi_controller_;
    const auto savedOnly = midi_state_only_, savedReattack = midi_reattack_,
               savedFirst = midi_first_;
    const auto previous = session.suppressed;
    session.suppressed = true;
    while (session.emissionCount) {
      const auto emission = session.emissions[session.emissionHead];
      session.emissionHead = (session.emissionHead + 1u) % kScriptScheduled;
      --session.emissionCount;
      midi_clock_ = emission.frame;
      if (emission.kind == ScriptEmissionKind::Note) {
        if (auto *note = session.find(emission.id))
          if (!admitScriptNote(*note, emission.frame))
            session.failed = true;
      } else if (emission.kind == ScriptEmissionKind::Release)
        scriptRelease(emission.id);
      else {
        const et_midi_event message{0, emission.message, emission.id, 0, 0, 0};
        midiEvent(message, savedOnly ? static_cast<unsigned>(ET_MIDI_STATE_ONLY) : 0u);
      }
    }
    midi_clock_ = event.frame;
    if (event.address == 0x10000u + static_cast<unsigned>(script::Callback::Controller) &&
        !event.ignored) {
      const auto number = event.controller;
      const auto wire = number == 129u ? event.value + 8192u : event.value;
      const auto message = number < 128u ? 0xb0u | event.channel | (number << 8u) | (wire << 16u)
                                         : event.channel | (number == 129u ? 0xe0u : 0xd0u) |
                                               ((wire & 127u) << 8u) |
                                               (number == 129u ? (wire >> 7u) << 16u : 0u);
      const et_midi_event source{0, message, event.id, 0, 0, 0};
      midiEvent(source,
                kScriptSourceApply | (savedOnly ? static_cast<unsigned>(ET_MIDI_STATE_ONLY) : 0u));
    }
    if (auto *note = session.find(event.id)) {
      const bool attack = event.address == 0x10000u + static_cast<unsigned>(script::Callback::Note);
      const bool released =
          event.address == 0x10000u + static_cast<unsigned>(script::Callback::Release);
      if ((attack && note->sourcePending == 1) || (released && note->sourcePending == 2)) {
        note->sourcePending = 0;
        note->queued = false;
        if (released) {
          if (!event.ignored)
            note->keyDown = false;
          for (auto &child : session.notes)
            if (child.id && child.generated && child.keyDown &&
                ((!event.ignored && child.parent == note->id) ||
                 (child.parent == UINT32_MAX && child.channel == note->channel &&
                  child.key == note->key)))
              scriptRelease(child.id);
        }
        if (!event.ignored && !note->ignored) {
          const et_midi_event source{0,
                                     (attack ? 0x90u : 0x80u) | note->channel | (note->key << 8u) |
                                         ((attack ? note->velocity : event.velocity) << 16u),
                                     note->id,
                                     0,
                                     0,
                                     0};
          midiEvent(source, kScriptSourceApply |
                                (savedOnly ? static_cast<unsigned>(ET_MIDI_STATE_ONLY) : 0u));
        }
      }
    }
    session.suppressed = previous;
    midi_clock_ = savedClock;
    midi_channel_ = savedChannel;
    midi_note_id_ = savedIdentity;
    midi_trigger_ = savedTrigger;
    midi_controller_ = savedController;
    midi_state_only_ = savedOnly;
    midi_reattack_ = savedReattack;
    midi_first_ = savedFirst;
  }
  bool call(script::Builtin builtin, const script::Value *arguments, std::uint32_t count,
            script::Event &event, script::Value &result) noexcept override {
    using B = script::Builtin;
    result = {};
    if (!script_session_)
      return false;
    auto &session = *script_session_;
    if (builtin == B::Message)
      return count == 1 && scriptMessage(arguments[0]);
    const auto id = !count && builtin == B::IgnoreEvent ? event.id
                    : count && script::integerArgument(arguments[0], 0, UINT32_MAX)
                        ? static_cast<std::uint32_t>(arguments[0].numeric())
                        : 0u;
    auto *note = session.find(id);
    if (builtin == B::IgnoreController) {
      if ((!count || id == event.id) &&
          event.address == 0x10000u + static_cast<std::uint32_t>(script::Callback::Controller))
        event.ignored = true;
      return true;
    }
    if (builtin == B::EventStatus) {
      result = script::Value::fromInteger(note && scriptNoteAlive(*note) ? 1 : 0);
      return true;
    }
    if (builtin == B::IgnoreEvent) {
      if (id == event.id &&
          event.address == 0x10000u + static_cast<std::uint32_t>(script::Callback::Release)) {
        event.ignored = true;
        return true;
      }
      if (note) {
        note->ignored = true;
        scriptRelease(id);
      }
      if (id == event.id)
        event.ignored = true;
      return true;
    }
    if (builtin == B::NoteOff) {
      return session.emit(ScriptEmissionKind::Release, id, 0, event.frame);
    }
    if (builtin == B::PlayNote) {
      if (!count || count > 4 || !script::integerArgument(arguments[0], 0, 127) ||
          (count > 1 && !script::integerArgument(arguments[1], 1, 127)))
        return false;
      double offset = -1, duration = 0;
      if (count > 2 && arguments[2].numeric() != -1 &&
          !script::durationSeconds(arguments[2], offset))
        return false;
      if (count > 3) {
        if (arguments[3].unit() == 0u &&
            (arguments[3].numeric() == -1 || arguments[3].numeric() == -2))
          duration = arguments[3].numeric();
        else if (!script::durationSeconds(arguments[3], duration))
          return false;
      }
      if (duration == -1 &&
          event.address != 0x10000u + static_cast<std::uint32_t>(script::Callback::Note))
        return false;
      if (session.nextNote >= 0x7fffffffu)
        session.nextNote = 0x40000000u;
      const auto generatedId = session.nextNote++;
      auto *generated = session.allocate(generatedId);
      if (!generated)
        return false;
      generated->key = generated->pitch = static_cast<std::uint32_t>(arguments[0].numeric());
      generated->velocity = count > 1 ? static_cast<std::uint32_t>(arguments[1].numeric()) : 127u;
      generated->channel = event.channel;
      generated->generated = generated->keyDown = true;
      generated->birthFrame = event.frame;
      generated->parent = duration == -1 ? event.id : 0u;
      generated->wholeSample = duration == 0;
      generated->sampleOffset = offset;
      if (duration == -2)
        generated->parent = UINT32_MAX;
      if (duration > 0) {
        std::uint64_t frames;
        if (!script::durationFrames(duration, rate_, frames) || frames > UINT64_MAX - event.frame ||
            !session.schedule(generatedId, event.frame + frames)) {
          generated->id = 0;
          return false;
        }
      }
      generated->queued = true;
      if (!session.emit(ScriptEmissionKind::Note, generatedId, 0, event.frame)) {
        generated->id = 0;
        for (auto &pending : session.scheduled)
          if (pending.id == generatedId)
            pending.id = 0;
        return false;
      }
      result = script::Value::fromInteger(generatedId);
      return true;
    }
    if (builtin == B::SetController || builtin == B::SetRpn || builtin == B::SetNrpn) {
      if (count != 2 ||
          !script::integerArgument(arguments[0], 0, builtin == B::SetController ? 129 : 16383) ||
          !script::integerArgument(arguments[1],
                                   builtin == B::SetController && id == 129 ? -8192 : 0,
                                   builtin == B::SetController ? (id == 129 ? 8191 : 127) : 16383))
        return false;
      const auto send = [&](unsigned controller, unsigned value) {
        (*midi_channels_)[event.channel].inputCC[controller] = static_cast<std::uint8_t>(value);
        return session.emit(ScriptEmissionKind::Controller, 0,
                            0xb0u | event.channel | (controller << 8u) | (value << 16u),
                            event.frame);
      };
      const auto signedValue = static_cast<int>(arguments[1].numeric());
      const auto value = static_cast<unsigned>(signedValue);
      if (builtin == B::SetController && id >= 128) {
        const auto wire = id == 129 ? static_cast<unsigned>(signedValue + 8192) : value;
        auto &channel = (*midi_channels_)[event.channel];
        if (id == 129)
          channel.inputBend = signedValue;
        else
          channel.inputAftertouch = static_cast<std::uint8_t>(value);
        if (!session.emit(ScriptEmissionKind::Controller, 0,
                          event.channel | (id == 129 ? 0xe0u : 0xd0u) | ((wire & 127u) << 8u) |
                              (id == 129 ? ((wire >> 7u) << 16u) : 0u),
                          event.frame))
          return false;
      } else if (builtin == B::SetController) {
        if (!send(id, value))
          return false;
      } else {
        if (!send(builtin == B::SetRpn ? 101 : 99, id >> 7u) ||
            !send(builtin == B::SetRpn ? 100 : 98, id & 127u) || !send(6, value >> 7u) ||
            !send(38, value & 127u))
          return false;
      }
      result = script::Value::fromInteger(midi_note_id_ | 0x80000000u);
      return true;
    }
    if (!note)
      return true;
    if (builtin == B::SetEventMark || builtin == B::DeleteEventMark) {
      if (count != 2 || !script::integerArgument(arguments[1], 0, 0x0fffffffu))
        return false;
      const auto marks = static_cast<std::uint32_t>(arguments[1].numeric());
      if (builtin == B::SetEventMark)
        note->marks |= marks;
      else
        note->marks &= ~marks;
      return true;
    }
    if ((builtin >= B::ChangeAmpLfoDepth && builtin <= B::ChangeVolTime) || builtin == B::FadeIn ||
        builtin == B::FadeOut) {
      script::VoiceChange change;
      if (!script::decodeVoiceChange(builtin, arguments, count, change))
        return false;
      return changeScriptVoice(*note, change, event.frame);
    }
    if (builtin == B::GetEventPar || builtin == B::SetEventPar) {
      if (count < 2 || !script::integerArgument(arguments[1], 0, 7))
        return false;
      const auto parameter = static_cast<unsigned>(arguments[1].numeric());
      if (builtin == B::GetEventPar) {
        if (parameter >= 4)
          result = script::Value::fromInteger(note->user[parameter - 4u]);
        else if (parameter == 0 || parameter == 2)
          result = script::Value::fromInteger(parameter == 0 ? note->pitch : note->velocity);
        else {
          const auto values = note->automation.values(event.frame);
          const auto ratio = parameter == 1 ? values.tune : values.gain;
          const auto value =
              parameter == 1 ? std::log2(ratio) * 1200000.0 : std::log10(ratio) * 20000.0;
          const auto converted = value <= -9223372036854775808.0 ? INT64_MIN
                                 : value >= 9223372036854775808.0
                                     ? INT64_MAX
                                     : static_cast<std::int64_t>(std::llround(value));
          result = script::Value::fromInteger(converted);
        }
      } else {
        if (count != 3 || arguments[2].kind != 0 || arguments[2].unit() || arguments[2].hasPrefix())
          return false;
        if (parameter >= 4)
          note->user[parameter - 4u] = arguments[2].integer;
        else if (parameter != 1 && parameter != 3) {
          if (!script::integerArgument(arguments[2], parameter == 2 ? 1 : 0, 127))
            return false;
          script::VoiceChange change;
          change.target =
              parameter == 0 ? script::VoiceTarget::Note : script::VoiceTarget::Velocity;
          change.value = arguments[2].numeric();
          change.newNoteOnly = true;
          return changeScriptVoice(*note, change, event.frame);
        }
        // NKSP specifies that set_event_par ignores TUNE and VOLUME.
      }
      return true;
    }
    return false;
  }
  void synchronizeMidiChannel() noexcept {
    if constexpr (Midi) {
      const auto selected =
          static_cast<std::uint32_t>(std::round(bounded(params_.midiChannel, 0, 16, 0)));
      if (selected != midi_selected_channel_) {
        retireMidi();
        resetMidi();
        midi_selected_channel_ = selected;
      }
    }
    if (bank() && bank()->sf2_)
      for (auto channel = 0u; channel < 16u; ++channel)
        if (sf2PresetOverride(channel) != sf2_override_cache_[channel]) {
          clearSampleForecast();
          selectSf2Preset(channel);
        }
  }
  int sf2PresetOverride(std::uint32_t channel, bool staged = false) const noexcept {
    int selected = -1;
    if constexpr (Midi) {
      // Main follows accepted MIDI; its mixer sends ordinary bank/program events.
      (void)channel;
    } else {
      const auto &parameters = staged && params_pending_ ? staged_params_ : params_;
      selected = static_cast<int>(std::round(bounded(parameters.preset, -1, 8388607, -1)));
    }
    return selected;
  }
  void selectSf2Preset(std::uint32_t channel) noexcept {
    auto &state = (*midi_channels_)[channel];
    sf2_override_cache_[channel] = sf2PresetOverride(channel);
    state.preset = sf2PresetIndex(channel, state, false);
  }
  void acceptGlobalState(std::uint32_t message) noexcept {
    const auto kind = message & 0xf0u, key = (message >> 8u) & 127u,
               value = (message >> 16u) & 127u;
    if (kind == 0xb0u)
      accepted_global_cc_[key] = value / 127.0F;
    else if (kind == 0xe0u)
      accepted_global_extended_[0] = (key | (value << 7u)) / 16383.0F;
    else if (kind == 0xd0u)
      accepted_global_extended_[1] = key / 127.0F;
    else if (kind == 0xa0u)
      accepted_global_extended_[2] = value / 127.0F;
  }
  void hydrateChannelState(std::uint32_t message) noexcept {
    const auto channel = message & 15u, kind = message & 0xf0u;
    const auto key = (message >> 8u) & 127u, value = (message >> 16u) & 127u;
    auto &state = (*midi_channels_)[channel];
    if (kind == 0xb0u)
      applyChannelControllerState(state, key, value);
    else if (kind == 0xc0u) {
      state.program = key;
      state.melodicBank = state.cc[0];
      state.bank = state.drumMode ? 128u : state.melodicBank;
      if (bank()->sf2_) {
        selectSf2Preset(channel);
      }
    } else if (kind == 0xa0u)
      state.pressure[key] = static_cast<std::uint8_t>(value);
    else if (kind == 0xd0u)
      state.aftertouch = state.inputAftertouch = key;
    else if (kind == 0xe0u)
      state.bend = state.inputBend = static_cast<int>(key | value << 7u) - 8192;
  }
  std::uint32_t sf2PresetIndex(std::uint32_t channel, const MidiChannel &state,
                               bool staged) const noexcept {
    const auto selected = sf2PresetOverride(channel, staged);
    const auto requestedBank = selected < 0 ? state.bank : static_cast<unsigned>(selected) / 128u;
    const auto requestedProgram =
        selected < 0 ? state.program : static_cast<unsigned>(selected) % 128u;
    auto result = bank()->findPreset(requestedBank, requestedProgram);
    if constexpr (!Midi)
      if (selected < 0) {
        result = UINT32_MAX;
        for (auto index = 0u; index < bank()->preset_count_; ++index) {
          const auto preset = bank()->preset(index);
          if (preset.bank <= 128u && preset.program <= 127u && preset.regionCount) {
            result = index;
            break;
          }
        }
      }
    if (result == UINT32_MAX && requestedBank != 128u)
      result = bank()->findPreset(0u, requestedProgram);
    if (result == UINT32_MAX)
      result = bank()->findPreset(requestedBank == 128u ? 128u : 0u, 0u);
    return result;
  }
  static bool drumModeEvent(const et_midi_event &event) noexcept {
    return event.flags == ET_MIDI_DRUM_MODE && (event.message & ~0x00030f00u) == 0u &&
           event.note_id == 0u && event.render_frame_low == 0u && event.render_frame_high == 0u;
  }
  void applyDrumMode(std::array<MidiChannel, 16> &channels, const et_midi_event &event,
                     bool staged = false) noexcept {
    const auto channel = (event.message >> 8u) & 15u;
    auto &state = channels[channel];
    state.drumMode = (event.message >> 16u) & 3u;
    state.bank = state.drumMode ? 128u : state.melodicBank;
    if (bank() && bank()->sf2_)
      state.preset = sf2PresetIndex(channel, state, staged);
  }
  static bool systemResetEvent(const et_midi_event &event) noexcept {
    return event.message == 0u && event.flags == ET_MIDI_SYSTEM_RESET &&
           event.note_id >= ET_MIDI_SYSTEM_GM && event.note_id <= ET_MIDI_SYSTEM_XG &&
           event.render_frame_low == 0u && event.render_frame_high == 0u;
  }
  void initializeMidiChannels(std::array<MidiChannel, 16> &channels, bool staged = false) noexcept {
    channels.fill({});
    for (auto &channel : channels) {
      channel.cc[7] = 100u;
      channel.cc[10] = 64u;
      channel.cc[11] = 127u;
      channel.cc[98] = channel.cc[99] = channel.cc[100] = channel.cc[101] = 127u;
      if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE) {
        const auto *r = bank()->region(0u);
        for (auto cc = 0u; cc < 128u; ++cc)
          if (bank()->controller(r, InitialCC, cc) >= 0.0F)
            channel.cc[cc] = static_cast<std::uint8_t>(bank()->controller(r, InitialCC, cc));
        if (r[SwitchDefault] >= 0.0F) {
          channel.last = static_cast<int>(r[SwitchDefault]);
          channel.keySerial[channel.last] = ++channel.serial;
        }
      }
    }
    for (auto &channel : channels) {
      channel.inputCC = channel.cc;
      for (auto cc = 0u; cc < 128u; ++cc) {
        channel.normalizedCC[cc] = channel.cc[cc] / 127.0F;
        if (bank() && bank()->modulation_) {
          const auto initial = bank()->modulation_->initialController(cc);
          if (initial >= 0) {
            channel.normalizedCC[cc] = initial;
            channel.preciseCC[cc] = true;
            channel.cc[cc] = channel.inputCC[cc] =
                static_cast<std::uint8_t>(std::round(initial * 127));
          }
        }
      }
    }
    for (auto channel = 0u; channel < 16u; ++channel) {
      channels[channel].drumMode = channel == 9u ? 1u : 0u;
      channels[channel].bank = channels[channel].drumMode ? 128u : 0u;
      if (bank() && bank()->sf2_)
        channels[channel].preset = sf2PresetIndex(channel, channels[channel], staged);
    }
    for (auto &channel : channels)
      channel.noteOnFrames.fill(UINT64_MAX);
  }
  void resetMidi(bool preserveEvents = false) noexcept {
    if constexpr (Midi)
      midi_meters_.clear();
    mixer_mute_ = mixer_solo_ = 0;
    accepted_global_cc_.fill(0);
    accepted_global_extended_ = {8192.0F / 16383.0F, 0, 0};
    modulation_velocity_ = modulation_release_velocity_ = modulation_key_ = 0;
    modulation_random_ = modulation_alternate_ = modulation_key_delta_ = modulation_last_offset_ =
        0;
    modulation_last_on_ = modulation_last_off_ = 0;
    modulation_has_key_ = false;
    modulation_cache_bank_ = nullptr;
    if (!preserveEvents)
      clearSampleForecast();
    sf2_override_cache_.fill(std::numeric_limits<int>::min());
    if (!preserveEvents)
      midi_count_ = 0u;
    script_message_head_ = script_message_count_ = script_messages_dropped_ = 0;
    script_error_ = script::Error::None;
    script_error_pc_ = 0;
    if constexpr (Midi) {
      random_ = seed_ ? seed_ : 1u;
      midi_identity_ = 0u;
    }
    if (!midi_channels_)
      return;
    initializeMidiChannels(*midi_channels_);
    accepted_global_cc_ = (*midi_channels_)[0].normalizedCC;
    if (bank() && bank()->sf2_)
      for (auto channel = 0u; channel < 16u; ++channel)
        sf2_override_cache_[channel] = sf2PresetOverride(channel);
    if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
      std::fill_n(bank()->indices_.data() + 129u, 2u * bank()->group_count_, 0u);
    if (bank())
      std::fill_n(bank()->timer_frames_.data(), bank()->timer_frames_.size(), UINT64_MAX);
  }
  bool keyDrivenRegion(const float *region) const noexcept {
    if (region[Trigger] == 1.0F || region[Trigger] == 2.0F)
      return false;
    if (bank()->modulation_) {
      const auto index = static_cast<std::uint32_t>((region - bank()->region(0)) / kStride);
      const auto view = bank()->modulation_->region(index);
      for (const auto node : bank()->modulation_->plan(index).conditions[1]) {
        const auto range = controllerCondition(view, node);
        if (range.low >= 0 || range.high >= 0)
          return false;
      }
    }
    const auto offset = indexValue(region, ControlOffset), count = indexValue(region, ControlCount);
    for (auto index = 0u; index < count; ++index) {
      const auto *control = bank()->payload_.data() + 8u + offset + index * 2u;
      const auto family = std::bit_cast<std::uint32_t>(control[0]) / 512u;
      if ((family == OnLowCC || family == OnHighCC) && control[1] >= 0)
        return false;
    }
    return true;
  }
  bool pendingVoiceStart(const Voice &voice) const noexcept {
    return voice.delayFrames || (voice.playbackEnabled && !voice.playbackTiming.started) ||
           (bank()->sf2_          ? voice.sf2VolumeEnvelope.waiting()
            : bank()->modulation_ ? voice.modulationWaiting
                                  : voice.ampEnvelope.waiting());
  }
  bool heldSourceVoice(const Voice &voice) const noexcept {
    return voice.region && !voice.released && keyDrivenRegion(voice.region) &&
           (voice.keyDown ||
            (voice.region[LoopMode] != 1.0F && (voice.sostenuto || voiceSustain(voice))));
  }
  bool naturalVoiceTail(const Voice &voice) const noexcept {
    if (pendingVoiceStart(voice))
      return false;
    if (voice.released)
      return true;
    if (heldSourceVoice(voice))
      return false;
    return voice.scriptWholeSample || voice.region[LoopMode] <= 1.0F ||
           voice.region[LoopCount] >= 0.0F;
  }
  void fadeVoice(Voice &voice, std::uint32_t frames) noexcept {
    if (!voice.region)
      return;
    if (voice.historyOnly || pendingVoiceStart(voice) || !frames) {
      voice.region = nullptr;
      return;
    }
    voice.keyDown = voice.sostenuto = false;
    voice.released = voice.forcedRelease = true;
    if (voice.retireFrames) {
      if (frames >= voice.retireFrames)
        return;
      voice.retireGain *= retirementGain(voice);
    } else
      voice.retireGain = 1;
    voice.retireFrames = voice.retireTotalFrames = frames;
    voice.offSeconds = 0;
  }
  float retirementGain(const Voice &voice) noexcept {
    const auto total = voice.retireTotalFrames ? voice.retireTotalFrames : fade_length_;
    if (voice.offSeconds > 0)
      if (const auto *settings = playbackPlan(voice.region))
        return playback::offGain(1.0 - static_cast<double>(voice.retireFrames) / total,
                                 settings->offCurve,
                                 playbackValue(voice, modulationState(voice), *settings,
                                               playback::Slot::OffShape, settings->offShape));
    return std::exp(-9.210340372F * (1.0F - static_cast<float>(voice.retireFrames) / total));
  }
  void retireMidi(bool preserveRelease = false) noexcept {
    if (voices_)
      for (auto &v : *voices_)
        if (v.region) {
          if (v.historyOnly || pendingVoiceStart(v)) {
            v.region = nullptr;
            continue;
          }
          if (const auto *note = voiceScriptNote(v)) {
            v.retiredAutomation = note->automation.values(midi_clock_);
            v.retiredScript = true;
          }
          if (bank()->modulation_ && !v.retired) {
            const auto source = modulationSourceFrame(v);
            std::copy(source.values.begin(), source.values.end(), v.retiredSources.begin());
            v.retiredSourceElapsed = v.elapsed;
          }
          if (preserveRelease && naturalVoiceTail(v)) {
            if (v.modulationRevision != midi_revision_)
              refreshMidiModulation(v);
            v.retired = true;
            continue;
          }
          v.retired = true;
          fadeVoice(v, fade_length_);
          v.ampEnvelope.forceRelease(static_cast<float>(fade_length_) / rate_);
        }
  }
  int logicalNoteKey(std::uint32_t physical) const noexcept {
    return pitch::shiftedKey(static_cast<int>(physical),
                             bank() && bank()->modulation_ ? bank()->modulation_->noteOffset() : 0);
  }
  int sampleKeyForTarget(int target) const noexcept {
    if constexpr (Midi)
      return target;
    else
      return target + static_cast<int>(std::round(bounded(params_.sampleShift, -6, 6, 0)));
  }
  int physicalSwitchKey(int logical) const noexcept {
    return pitch::shiftedKey(
        logical, bank() && bank()->modulation_ ? -bank()->modulation_->switchOffset() : 0);
  }
  HostTransport currentTransport() const noexcept {
    auto transport = midi_transport_map_.available()
                         ? midi_transport_map_.at(midi_transport_mapping_, midi_clock_, rate_)
                     : modulation_host_transport_valid_ ? modulation_host_transport_
                                                        : HostTransport{};
    constexpr auto advancing =
        HostTransport::kPlaying | HostTransport::kTempoValid | HostTransport::kPositionValid;
    if (!midi_transport_map_.available() && (transport.flags & advancing) == advancing)
      transport.ppqPosition +=
          static_cast<double>(modulation_block_frame_) / rate_ * transport.tempoBpm / 60.0;
    if (midi_transport_map_.available() && (!midi_running_ || midi_paused_) && !midi_state_only_)
      transport.flags &= ~HostTransport::kPlaying;
    return transport;
  }
  double playbackPpq() const noexcept {
    const auto transport = currentTransport();
    if (transport.flags & HostTransport::kPositionValid)
      return transport.ppqPosition;
    return midi_transport_map_.available() || modulation_host_transport_valid_
               ? 0.0
               : modulation_host_time_ * effectPreparationTempo(0) / 60.0;
  }
  static conditions::ControllerRange controllerCondition(const modulation::RegionView &view,
                                                         std::uint32_t node) noexcept {
    const auto &instance = view.instances[node];
    const auto value = [&](schema::Property property) {
      return view
          .parameters[instance.firstParameter +
                      schema::parameterRank(instance.kind, static_cast<std::uint32_t>(property))]
          .base;
    };
    return {instance.authoredIndex, value(schema::Property::ConditionLow),
            value(schema::Property::ConditionHigh)};
  }
  bool controllerStarts(const float *r, const MidiChannel &channel,
                        std::uint32_t cc) const noexcept {
    const auto low = bank()->controller(r, OnLowCC, cc);
    const auto high = bank()->controller(r, OnHighCC, cc);
    if ((low >= 0 || high >= 0) && (low < 0 || channel.cc[cc] >= low) &&
        (high < 0 || channel.cc[cc] <= high))
      return true;
    if (bank()->modulation_) {
      const auto index = static_cast<std::uint32_t>((r - bank()->region(0)) / kStride);
      const auto view = bank()->modulation_->region(index);
      for (const auto node : bank()->modulation_->plan(index).conditions[1]) {
        const auto range = controllerCondition(view, node);
        if (range.controller == cc && (range.low >= 0 || range.high >= 0) &&
            conditions::contains(range, channel.normalizedCC[cc]))
          return true;
      }
    }
    return false;
  }
  const playback::PreparedPlayback *playbackPlan(const float *r) const noexcept {
    return bank()->modulation_ ? bank()->modulation_->playbackPlan(
                                     static_cast<std::uint32_t>((r - bank()->region(0)) / kStride))
                               : nullptr;
  }
  bool voiceSustain(const Voice &voice) const noexcept {
    const auto *plan = playbackPlan(voice.region);
    const auto &channel = (*midi_channels_)[voice.channel];
    return plan ? playback::pedalDown(plan->sustain, plan->sustainLow,
                                      channel.preciseCC[plan->sustainCC]
                                          ? channel.normalizedCC[plan->sustainCC] * 127.0
                                          : channel.cc[plan->sustainCC])
                : channel.cc[64] >= 64u;
  }
  std::uint32_t regionVelocity(const float *r, std::uint32_t velocity) const noexcept {
    const auto *plan = playbackPlan(r);
    if (!plan || !plan->previousVelocity)
      return velocity;
    const auto &channel = (*midi_channels_)[midi_channel_];
    const auto key = bank()->keyswitches_.selected(midi_channel_, channel.keySerial);
    const auto physical = physicalSwitchKey(key);
    return key >= 0 && physical >= 0 && channel.keySerial[static_cast<unsigned>(key)]
               ? channel.velocity[static_cast<unsigned>(physical)]
               : velocity;
  }
  void stopControllerRegions(std::uint32_t cc) noexcept {
    if (!bank()->modulation_)
      return;
    const auto &channel = (*midi_channels_)[midi_channel_];
    for (auto &voice : *voices_)
      if (voice.region && !voice.retired && voice.channel == midi_channel_) {
        const auto index = modulationRegionIndex(voice);
        const auto view = bank()->modulation_->region(index);
        for (const auto node : bank()->modulation_->plan(index).conditions[2]) {
          const auto range = controllerCondition(view, node);
          if (range.controller == cc && (range.low >= 0 || range.high >= 0) &&
              conditions::contains(range, channel.normalizedCC[cc])) {
            fadeVoice(voice, fade_length_);
            break;
          }
        }
      }
  }
  bool midiRegion(const float *r, std::uint32_t key) const noexcept {
    const auto &c = (*midi_channels_)[midi_channel_];
    if (midi_controller_ < 0 &&
        !bank()->noteEnabled(static_cast<std::uint32_t>((r - bank()->region(0)) / kStride)))
      return false;
    if (bank()->sf2_) {
      if (c.preset == UINT32_MAX)
        return false;
      const auto preset = bank()->preset(c.preset);
      const auto index = static_cast<std::uint32_t>((r - bank()->region(0)) / kStride);
      if (index < preset.firstRegion || index - preset.firstRegion >= preset.regionCount)
        return false;
    }
    if (midi_channel_ + 1u < r[LowChannel] || midi_channel_ + 1u > r[HighChannel] ||
        c.bend < r[LowBend] || c.bend > r[HighBend] || c.aftertouch < r[LowChannelAftertouch] ||
        c.aftertouch > r[HighChannelAftertouch] || c.pressure[key] < r[LowPolyAftertouch] ||
        c.pressure[key] > r[HighPolyAftertouch] || c.program < r[LowProgram] ||
        c.program > r[HighProgram])
      return false;
    const auto trigger = static_cast<std::uint32_t>(r[Trigger]);
    if (trigger == 3u   ? midi_trigger_ != 0u || !midi_first_
        : trigger == 4u ? midi_trigger_ != 0u || midi_first_
                        : trigger != midi_trigger_)
      return false;
    int last = static_cast<int>(r[SwitchDefault]);
    std::uint32_t serial = 0u;
    const auto low = r[SwitchLow] < 0 ? 0u : static_cast<std::uint32_t>(r[SwitchLow]);
    const auto high = r[SwitchHigh] < 0 ? 127u : static_cast<std::uint32_t>(r[SwitchHigh]);
    for (auto note = low; note <= high && note < 128u; ++note)
      if (c.keySerial[note] > serial) {
        serial = c.keySerial[note];
        last = static_cast<int>(note);
      }
    if ((r[SwitchLast] >= 0 && last != r[SwitchLast]) ||
        (r[SwitchLowLast] >= 0 && last < r[SwitchLowLast]) ||
        (r[SwitchHighLast] >= 0 && last > r[SwitchHighLast]) ||
        (r[SwitchPrevious] >= 0 && c.previous != r[SwitchPrevious]))
      return false;
    if (r[SwitchDown] >= 0) {
      const auto physical = physicalSwitchKey(static_cast<int>(r[SwitchDown]));
      if (physical < 0 || !c.keys[static_cast<unsigned>(physical)])
        return false;
    }
    if (r[SwitchUp] >= 0) {
      const auto physical = physicalSwitchKey(static_cast<int>(r[SwitchUp]));
      if (physical >= 0 && c.keys[static_cast<unsigned>(physical)])
        return false;
    }
    for (auto cc = 0u; cc < 128u; ++cc) {
      if (c.cc[cc] < bank()->controller(r, LowCC, cc) ||
          c.cc[cc] > bank()->controller(r, HighCC, cc))
        return false;
    }
    if (bank()->modulation_) {
      const auto index = static_cast<std::uint32_t>((r - bank()->region(0)) / kStride);
      const auto view = bank()->modulation_->region(index);
      const auto &plan = bank()->modulation_->plan(index);
      for (const auto node : plan.conditions[0]) {
        const auto range = controllerCondition(view, node);
        if (!conditions::contains(range, c.normalizedCC[range.controller]))
          return false;
      }
      if (plan.tempoInstance != UINT32_MAX) {
        const auto &node = view.instances[plan.tempoInstance];
        const auto value = [&](schema::Property p) {
          return view
              .parameters[node.firstParameter +
                          schema::parameterRank(node.kind, static_cast<std::uint32_t>(p))]
              .base;
        };
        const auto transport = currentTransport();
        if (!(transport.flags & HostTransport::kTempoValid) ||
            !conditions::tempo(value(schema::Property::BpmLow), value(schema::Property::BpmHigh),
                               transport.tempoBpm))
          return false;
      }
      if (plan.timerInstance != UINT32_MAX) {
        const auto &node = view.instances[plan.timerInstance];
        const auto value = [&](schema::Property p) {
          return view
              .parameters[node.firstParameter +
                          schema::parameterRank(node.kind, static_cast<std::uint32_t>(p))]
              .base;
        };
        const auto frame =
            bank()->timer_frames_.data()[midi_channel_ * bank()->group_count_ +
                                         static_cast<std::uint32_t>(r[SequenceGroup])];
        const auto age = frame == UINT64_MAX ? std::numeric_limits<double>::infinity()
                                             : (static_cast<double>(midi_clock_) - frame) / rate_;
        if (!conditions::timer(value(schema::Property::TimerLow),
                               value(schema::Property::TimerHigh), age))
          return false;
      }
    }
    if (midi_controller_ >= 0 &&
        !controllerStarts(r, c, static_cast<std::uint32_t>(midi_controller_)))
      return false;
    if (midi_controller_ < 0 && !keyDrivenRegion(r) && midi_trigger_ == 0u)
      return false;
    return true;
  }
  void reattackMidi() noexcept {
    for (auto &voice : *voices_)
      if (voice.region && voice.historyOnly) {
        if (!heldSourceVoice(voice)) {
          voice.region = nullptr;
          continue;
        }
        // Seeking reattacks MIDI-held notes, including a held one-shot that has ended.
        voice.historyOnly = false;
        voice.elapsed = 0u;
        reconstructReattack(voice);
        voice.fade = fade_length_;
        voice.envelope = voice.region[Attack] > 0.0F ? 0.0F : 1.0F;
        if (bank()->sf2_) {
          voice.sf2VolumeEnvelope.reset(voice.sf2Parameters.volEnv, rate_, true);
          voice.sf2ModEnvelope.reset(voice.sf2Parameters.modEnv, rate_, false);
          voice.sf2ModLfo.reset();
          voice.sf2VibLfo.reset();
        } else
          voice.ampEnvelope.reset(voice.ampParameters, rate_);
        configureFilter(voice);
      }
  }
  void reconstructReattack(Voice &voice, bool preview = false) noexcept {
    voice.position = voice.region[Direction] == 1.0F ? indexValue(voice.region, End)
                                                     : indexValue(voice.region, Offset);
    assignScriptSlot(voice);
    if (const auto *note = voiceScriptNote(voice))
      if (note->sampleOffset >= 0)
        voice.position = note->sampleOffset * voice.region[Rate];
    refreshMidiModulation(voice);
    if (bank()->modulation_)
      initializeModulationVoice(voice, preview);
    if (voice.playbackEnabled) {
      voice.position = voice.playbackReverse ? voice.sourceLast : voice.sourceFirst;
      voice.playbackRepeat = {};
      voice.playbackInLoop = false;
      voice.looped = false;
      voice.loopRepeats = 0;
    }
  }
  void midiEvent(const et_midi_event &event, std::uint32_t flags) noexcept {
    flags |= event.flags;
    if (drumModeEvent(event)) {
      applyDrumMode(*midi_channels_, event);
      invalidateForecastReceipt(true);
      ++midi_revision_;
      return;
    }
    if (event.message == 0u) {
      if (event.flags == ET_MIDI_SYSTEM_RESET) {
        const auto mute = mixer_mute_, solo = mixer_solo_;
        clearNotes();
        if (paused_voices_)
          paused_voices_->fill({});
        resetMidi(true);
        invalidateForecastReceipt(true);
        if (flags & ET_MIDI_STATE_ONLY) {
          mixer_mute_ = mute;
          mixer_solo_ = solo;
        }
        ++midi_revision_;
        if (sfz_quantum_started_)
          for (auto cc = 0u; cc < 128u; ++cc)
            if (!bank()->sfz_effects_->recordCC(sf2_frame_, cc, accepted_global_cc_[cc]))
              failRuntime();
        return;
      }
      if (flags & ET_MIDI_PAUSE) {
        pauseMidi();
        return;
      }
      midi_clock_ =
          static_cast<std::uint64_t>(event.render_frame_high) << 32u | event.render_frame_low;
      midi_running_ = true;
      if (flags & ET_MIDI_RESUME)
        resumeMidi();
      else if (flags & ET_MIDI_NATURAL_END)
        finishMidi();
      else if (flags & ET_MIDI_REATTACK)
        reattackMidi();
      return;
    }
    if (midi_paused_)
      return;
    if constexpr (Midi)
      if (midi_selected_channel_ != 0u && midi_selected_channel_ != (event.message & 15u) + 1u)
        return;
    ++midi_revision_;
    midi_state_only_ = (flags & ET_MIDI_STATE_ONLY) != 0u;
    invalidateForecastReceipt(true);
    const bool applySource = (flags & kScriptSourceApply) != 0;
    midi_reattack_ = (flags & ET_MIDI_REATTACK) != 0u;
    midi_channel_ = event.message & 15u;
    auto &c = (*midi_channels_)[midi_channel_];
    const auto kind = event.message & 0xf0u, key = (event.message >> 8u) & 127u,
               value = (event.message >> 16u) & 127u;
    const auto logical = logicalNoteKey(key);
    midi_note_id_ = event.note_id ? event.note_id : ++midi_identity_;
    midi_controller_ = -1;
    if (kind == 0x90u && value) {
      midi_first_ =
          midi_reattack_ || applySource
              ? c.first[key]
              : std::none_of(c.keys.begin(), c.keys.end(), [](auto count) { return count != 0u; });
      if (!midi_reattack_ && !applySource) {
        if (logical >= 0)
          recordModulationNote(static_cast<unsigned>(logical), value, true);
        const auto switchKey = pitch::shiftedKey(
            static_cast<int>(key),
            bank() && bank()->modulation_ ? bank()->modulation_->switchOffset() : 0);
        if (switchKey >= 0) {
          c.previous = c.last;
          c.last = switchKey;
          c.keySerial[static_cast<unsigned>(switchKey)] = ++c.serial;
        }
        if constexpr (Midi) {
          if (c.keys[key] != 65535u)
            ++c.keys[key];
        } else
          c.keys[key] = 1;
        c.first[key] = midi_first_;
        c.velocity[key] = static_cast<std::uint8_t>(value);
        c.noteOnFrames[key] = midi_clock_;
      }
      midi_trigger_ = 0u;
      if (logical < 0)
        return;
      auto *scriptNote =
          applySource ? script_session_->find(event.note_id) : scriptInput(event, true);
      if (!applySource && script_session_ && !script_session_->suppressed)
        return;
      if (scriptNote && (script_session_->failed || scriptNote->ignored))
        return;
      const auto target = scriptNote ? static_cast<int>(scriptNote->pitch) : logical;
      auto shifted = target;
      if constexpr (!Midi)
        shifted += 12 * static_cast<int>(std::round(bounded(params_.octaveShift, -2, 2, 0)));
      if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
        startVoices(key, shifted, scriptNote ? scriptNote->velocity : value, false);
      if (scriptNote && !scriptNote->keyDown)
        scriptRelease(scriptNote->id);
    } else if (kind == 0x80u || kind == 0x90u) {
      if (!midi_reattack_ && !applySource && logical >= 0)
        recordModulationNote(static_cast<unsigned>(logical), value, false);
      if (!applySource && c.keys[key])
        --c.keys[key];
      if (logical < 0)
        return;
      auto *scriptNote =
          applySource ? script_session_->find(event.note_id) : scriptInput(event, false);
      if (!applySource && script_session_ && !script_session_->suppressed)
        return;
      if (scriptNote && scriptNote->ignored)
        return;
      const auto releaseId = scriptNote ? scriptNote->id : event.note_id;
      Voice *oldest = nullptr;
      for (auto &v : *voices_)
        if (v.region && !v.preview && v.channel == midi_channel_ && v.midi == key && v.keyDown &&
            (!releaseId || v.noteId == releaseId) && (!oldest || v.age < oldest->age))
          oldest = &v;
      const bool held = oldest ? voiceSustain(*oldest) || oldest->sostenuto : c.cc[64] >= 64u;
      if (oldest) {
        const auto identity = oldest->noteId;
        for (auto &v : *voices_)
          if (v.region && !v.preview && v.channel == midi_channel_ && v.midi == key &&
              v.noteId == identity) {
            v.keyDown = false;
            if (!voiceSustain(v) && !v.sostenuto)
              releaseMidiVoice(v);
          }
      }
      midi_trigger_ = 2u;
      if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
        startVoices(key, logical, c.velocity[key], false);
      if (held) {
        if (c.pendingRelease[key] != 65535u)
          ++c.pendingRelease[key];
      } else {
        midi_trigger_ = 1u;
        if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
          startVoices(key, logical, c.velocity[key], false);
      }
    } else if (kind == 0xb0u) {
      c.inputCC[key] = static_cast<std::uint8_t>(value);
      if (!applySource && !scriptController(key, value))
        return;
      const double previous = c.preciseCC[key] ? c.normalizedCC[key] * 127.0 : c.cc[key];
      applyChannelControllerState(c, key, value);
      accepted_global_cc_[key] = c.normalizedCC[key];
      if (sfz_quantum_started_ &&
          !bank()->sfz_effects_->recordCC(sf2_frame_, key, accepted_global_cc_[key])) {
        failRuntime();
        return;
      }
      bool pedalEvent = key == 64u || key == 66u;
      for (auto &v : *voices_)
        if (v.region && v.channel == midi_channel_ && keyDrivenRegion(v.region)) {
          const auto *settings = playbackPlan(v.region);
          const auto sustainCC = settings ? settings->sustainCC : 64u;
          const auto sostenutoCC = settings ? settings->sostenutoCC : 66u;
          const auto threshold = settings ? settings->sostenutoLow : 64.0F;
          if (key == sostenutoCC) {
            if ((!settings || settings->sostenuto) && previous < threshold && value >= threshold &&
                v.keyDown)
              v.sostenuto = true;
            if ((settings && !settings->sostenuto) || value < threshold)
              v.sostenuto = false;
          }
          if (key == sustainCC || key == sostenutoCC) {
            pedalEvent = true;
            if (!v.keyDown && !v.sostenuto && !voiceSustain(v))
              releaseMidiVoice(v);
          }
        }
      if (pedalEvent)
        flushMidiReleases(c);
      if (key == 120u || key == 123u || (key >= 124u && key <= 127u)) {
        c.keys.fill(0u);
        if (key == 120u)
          c.pendingRelease.fill(0u);
        for (auto &v : *voices_)
          if (v.channel == midi_channel_ && v.region) {
            if (key != 120u && !keyDrivenRegion(v.region))
              continue;
            v.keyDown = false;
            if (key == 120u) {
              if (v.historyOnly || pendingVoiceStart(v)) {
                v.region = nullptr;
                continue;
              }
              fadeVoice(v, fade_length_);
              const auto seconds = static_cast<float>(fade_length_) / rate_;
              if (bank()->sf2_) {
                v.sf2VolumeEnvelope.forceRelease(seconds);
                v.sf2ModEnvelope.forceRelease(seconds);
              } else
                v.ampEnvelope.forceRelease(seconds);
            } else if (!voiceSustain(v) && !v.sostenuto)
              releaseMidiVoice(v);
          }
      }
      if (key == 121u) {
        flushMidiReleases(c);
        for (auto &v : *voices_)
          if (v.region && v.channel == midi_channel_ && keyDrivenRegion(v.region)) {
            v.sostenuto = false;
            if (!v.keyDown)
              releaseMidiVoice(v);
          }
      }
      if ((key == 6u || key == 38u) && script_session_ &&
          (!script_session_->suppressed || applySource)) {
        const bool rpn = c.cc[101] != 127u || c.cc[100] != 127u;
        const bool nrpn = c.cc[99] != 127u || c.cc[98] != 127u;
        if (rpn || nrpn) {
          script::Event parameter{};
          parameter.channel = midi_channel_;
          parameter.controller = key;
          parameter.value = static_cast<std::uint32_t>(c.cc[6]) << 7u | c.cc[38];
          parameter.address =
              static_cast<std::uint32_t>(c.cc[rpn ? 101u : 99u]) << 7u | c.cc[rpn ? 100u : 98u];
          parameter.frame = midi_clock_;
          if (!script_session_->vm.dispatch(rpn ? script::Callback::Rpn : script::Callback::Nrpn,
                                            parameter, *this))
            script_session_->failed = true;
        }
      }
      midi_controller_ = static_cast<int>(key);
      midi_trigger_ = 0u;
      if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE) {
        stopControllerRegions(key);
        startVoices(60u, 60, 127u, false);
      }
    } else if (kind == 0xc0u) {
      c.program = key;
      c.melodicBank = c.cc[0];
      c.bank = c.drumMode ? 128u : c.melodicBank;
      if (bank() && bank()->sf2_) {
        selectSf2Preset(midi_channel_);
      }
    } else if (kind == 0xd0u) {
      c.inputAftertouch = key;
      if (applySource || scriptController(128u, key)) {
        c.aftertouch = key;
        acceptGlobalState(event.message);
      }
    } else if (kind == 0xa0u) {
      acceptGlobalState(event.message);
      c.pressure[key] = static_cast<std::uint8_t>(value);
    } else if (kind == 0xe0u) {
      c.inputBend = static_cast<int>(key | value << 7u) - 8192;
      if (applySource || scriptController(129u, static_cast<std::uint32_t>(c.inputBend))) {
        c.bend = c.inputBend;
        acceptGlobalState(event.message);
      }
    }
    midi_controller_ = -1;
  }
  void flushMidiReleases(MidiChannel &channel) noexcept {
    for (auto key = 0u; key < 128u; ++key) {
      bool held = false, source = false;
      for (const auto &v : *voices_)
        if (v.region && v.channel == midi_channel_ && v.midi == key && keyDrivenRegion(v.region)) {
          source = true;
          held = held || v.sostenuto || voiceSustain(v);
        }
      held = held || (!source && channel.cc[64] >= 64u);
      if (held)
        continue;
      auto count = std::min<std::uint32_t>(channel.pendingRelease[key], kVoices);
      channel.pendingRelease[key] = 0u;
      midi_trigger_ = 1u;
      midi_controller_ = -1;
      while (count--)
        if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
          startVoices(key, logicalNoteKey(key), channel.velocity[key], false);
    }
  }
  void releaseMidiVoice(Voice &v, bool force = false) noexcept {
    if (!v.region || v.released)
      return;
    if (v.historyOnly) {
      v.region = nullptr;
      return;
    }
    const auto *playback = playbackPlan(v.region);
    if (v.delayFrames || (v.playbackEnabled && !v.playbackTiming.started)) {
      v.region = nullptr;
      return;
    }
    if ((v.region[LoopMode] == 1.0F || (playback && playback->playCount)) && !force)
      return;
    if constexpr (!Midi) {
      const auto *note = voiceScriptNote(v);
      if (!force && (!note || !note->generated) && keyDrivenRegion(v.region) &&
          v.region[LoopMode] != 1.0F) {
        release(v, v.preview);
        return;
      }
    }
    const auto time = static_cast<double>(v.elapsed) / rate_;
    v.pitchReleaseStart = modulationEnvelope(v.region + PitchEGDelay, time);
    v.filterReleaseStart = modulationEnvelope(v.filterEnvelopeParameters.data(), time);
    v.releaseElapsed = 0u;
    v.released = true;
    v.forcedRelease = force;
    if (v.modulationRevision != midi_revision_)
      refreshMidiModulation(v);
    if (bank()->sf2_) {
      v.sf2VolumeEnvelope.release(v.sf2Parameters.volEnv);
      v.sf2ModEnvelope.release(v.sf2Parameters.modEnv);
    } else if (bank()->modulation_) {
      const auto view = bank()->modulation_->region(modulationRegionIndex(v));
      modulation::releaseVoice(view, modulationState(v), modulationSourceFrame(v), rate_);
    } else
      v.ampEnvelope.release(v.ampParameters);
  }
  Sf2SpanFacts prepareSf2VoiceSpan(Voice &voice) noexcept {
    Sf2SpanFacts facts;
    if (!voice.region || voice.historyOnly)
      return facts;
    if (!voice.retired && voice.modulationRevision != midi_revision_)
      refreshSf2Modulation(voice);
    if (!voice.region)
      return facts;
    const auto &parameters = voice.sf2Parameters;
    const auto &g = parameters.generators;
    facts.panLeft = std::sqrt((1.0F - parameters.pan) * .5F);
    facts.panRight = std::sqrt((1.0F + parameters.pan) * .5F);
    facts.volumeSustain = voice.sf2VolumeEnvelope.sustained();
    if (facts.volumeSustain)
      voice.envelope = voice.sf2VolumeEnvelope.next(parameters.volEnv);
    facts.modSustain = voice.sf2ModEnvelope.sustained();
    if (facts.modSustain)
      facts.modEnvelope = voice.sf2ModEnvelope.next(parameters.modEnv);
    facts.silentModLfo = g[5] == 0 && g[10] == 0 && g[13] == 0;
    facts.silentVibLfo = g[6] == 0;
    facts.fixedPitch = g[5] == 0 && g[6] == 0 && g[7] == 0;
    if (facts.fixedPitch)
      selectVoiceFilter(voice, filterProfile(sampleQuality(voice)), effectiveSourceStep(voice));
    facts.fixedVolume = g[13] == 0;
    facts.fixedFilter = g[10] == 0 && g[11] == 0;
    if (facts.fixedVolume)
      facts.attenuation = std::pow(10.0F, -parameters.attenuationCb * .005F);
    if (!bank()->streamed_ || voice.region[Channels] != 1 || voice.region[Direction] != 0 ||
        voice.loopMeanOnly || voice.position < 0)
      return facts;
    // Borrow only an already-ready part of the current page. This is not an
    // availability forecast: later page/loop crossings keep the scalar reader.
    const auto position = static_cast<std::uint64_t>(voice.position);
    const auto pageFirst = position / SamplePageCache::kPageFrames * SamplePageCache::kPageFrames;
    auto first = pageFirst;
    auto last = std::min(pageFirst + SamplePageCache::kPageFrames - 1u,
                         static_cast<std::uint64_t>(indexValue(voice.region, End)));
    if (looping(voice)) {
      if (voice.looped)
        first = std::max(first, static_cast<std::uint64_t>(boundary(voice, LoopStart)));
      last = std::min(last, static_cast<std::uint64_t>(indexValue(voice.region, LoopEnd)));
    }
    if (first > last)
      return facts;
    facts.source.first = static_cast<std::int64_t>(first);
    facts.source.count = static_cast<std::uint32_t>(last - first + 1u);
    facts.source.data = bank()->cache_.readyMonoWindow(indexValue(voice.region, Sample), first,
                                                       facts.source.count, &facts.source.status);
    return facts;
  }
  // Only an already-ready interior is evaluated ahead. The scalar reader keeps
  // ownership of page/loop/end boundaries and every unavailable sample request.
  std::uint32_t resampleSf2Interior(const Voice &voice, const Sf2SpanFacts &facts,
                                    std::uint32_t frames, float *output) noexcept {
    if (!voice.region || voice.historyOnly || !facts.fixedPitch || !facts.source.data ||
        voice.playbackEnabled || voice.loopMeanOnly || voice.region[Channels] != 1.0F ||
        reverse(voice))
      return 0;
    const auto quality = sampleQuality(voice);
    if (quality == 1u || voice.filterTransition)
      return 0;
    const bool cubic = quality == 2u;
    const bool identity = !cubic && voice.filter == kIdentityFilter;
    const auto step = effectiveSourceStep(voice);
    if (!cubic && voice.filter == SampleResamplingTables::kInvalid)
      return 0;
    const auto *filter = cubic || identity ? nullptr : &resampling_tables_->kernel(voice.filter);
    const auto radius = filter ? filter->radius : identity ? 0u : 1u;
    const auto taps = filter ? filter->taps : identity ? 1u : 4u;
    const auto center = static_cast<std::int64_t>(voice.position);
    const auto last = facts.source.first + facts.source.count - 1;
    if (center < facts.source.first + radius || center + taps - radius - 1 > last)
      return 0;
    // Leave a complete step of margin at the boundary. The per-sample position
    // below uses exactly the renderer's repeated double addition, not n*step.
    const auto available = (static_cast<double>(last - taps + radius + 1) - voice.position) / step;
    const auto count = available >= frames ? frames
                       : available > 0     ? static_cast<std::uint32_t>(available)
                                           : 0u;
    auto position = voice.position;
    const auto *coefficients = filter ? resampling_tables_->coefficients(voice.filter) : nullptr;
    for (auto frame = 0u; frame < count; ++frame) {
      const auto integer = static_cast<std::int64_t>(position);
      const auto *samples = facts.source.data + integer - radius - facts.source.first;
      output[frame] = filter     ? cachedFilterSample(coefficients, taps,
                                                      (position - integer) * kFilterPhases, samples)
                      : identity ? *samples
                                 : cubicSample(samples[0], samples[1], samples[2], samples[3],
                                               static_cast<float>(position - integer));
      position += step;
    }
    return count;
  }
  template <bool Resampled>
  void renderSf2VoiceFrames(Voice &voice, const Sf2SpanFacts &facts, std::uint32_t first,
                            std::uint32_t end, double blockTime, const float *resampled,
                            float *left, float *right) noexcept {
    for (auto frame = first; frame < end; ++frame) {
      modulation_block_frame_ = frame;
      sf2_frame_ = frame;
      modulation_host_time_ = blockTime + static_cast<double>(frame) / rate_;
      float l = 0.0F, r = 0.0F;
      const auto *effectRegion = voice.region;
      if (voice.region && !voice.historyOnly) {
        const auto *region = voice.region;
        if (!renderSf2VoiceSample<true, Resampled>(voice, &facts, l, r,
                                                   Resampled ? resampled[frame - first] : 0.0F))
          continue;
        advanceVoiceSample(voice, region, l, r);
      }
      finishVoiceSample(voice, effectRegion, l, r, left[frame], right[frame]);
    }
  }
  void renderSf2VoiceSpan(Voice &voice, std::uint32_t first, std::uint32_t end, double blockTime,
                          float *left, float *right) noexcept {
    if (!voice.region && !hasStolenTail(voice)) {
      voice.lastLeft = voice.lastRight = 0.0F;
      voice.fade = 0;
      return;
    }
    const auto facts = prepareSf2VoiceSpan(voice);
    const auto firstElapsed = voice.elapsed;
    // Instance-owned CONTROL storage: one additional maxFrames mono plane.
    auto *resampled = sf2_sends_.data() + 6u * max_frames_;
    const auto count = resampleSf2Interior(voice, facts, end - first, resampled);
    renderSf2VoiceFrames<true>(voice, facts, first, first + count, blockTime, resampled, left,
                               right);
    renderSf2VoiceFrames<false>(voice, facts, first + count, end, blockTime, nullptr, left, right);
    const auto rendered = static_cast<std::uint32_t>(voice.elapsed - firstElapsed);
    const auto &parameters = voice.sf2Parameters;
    if (facts.silentModLfo)
      voice.sf2ModLfo.advanceSilent(rate_, parameters.modLfo.frequency, parameters.modLfo.delay,
                                    firstElapsed, rendered);
    if (facts.silentVibLfo)
      voice.sf2VibLfo.advanceSilent(rate_, parameters.vibLfo.frequency, parameters.vibLfo.delay,
                                    firstElapsed, rendered);
  }
  static void mixSf2MidiOutput(float *audio, const float *left, const float *right,
                               std::uint32_t channels, std::uint32_t frames, float gain) noexcept {
    auto frame = 0u;
#if (defined(__clang__) || defined(__GNUC__)) &&                                                   \
    (defined(__wasm_simd128__) || defined(__SSE2__) || defined(__aarch64__))
    using Quad = float __attribute__((vector_size(16)));
    const Quad scale{gain, gain, gain, gain}, half{.5F, .5F, .5F, .5F};
    const auto load = [](const float *input) {
      Quad value;
      std::memcpy(&value, input, sizeof(value));
      return value;
    };
    const auto store = [](float *output, Quad value) {
      std::memcpy(output, &value, sizeof(value));
    };
    for (; frame + 4u <= frames; frame += 4u) {
      const auto l = load(left + frame), r = load(right + frame);
      if (channels == 1u)
        store(audio + frame, load(audio + frame) + (half * (l + r)) * scale);
      else {
        store(audio + frame, load(audio + frame) + l * scale);
        store(audio + frames + frame, load(audio + frames + frame) + r * scale);
      }
    }
#elif defined(_MSC_VER) && (defined(_M_X64) || defined(_M_IX86))
    const auto scale = _mm_set1_ps(gain), half = _mm_set1_ps(.5F);
    for (; frame + 4u <= frames; frame += 4u) {
      const auto l = _mm_loadu_ps(left + frame), r = _mm_loadu_ps(right + frame);
      if (channels == 1u)
        _mm_storeu_ps(audio + frame,
                      _mm_add_ps(_mm_loadu_ps(audio + frame),
                                 _mm_mul_ps(_mm_mul_ps(half, _mm_add_ps(l, r)), scale)));
      else {
        _mm_storeu_ps(audio + frame, _mm_add_ps(_mm_loadu_ps(audio + frame), _mm_mul_ps(l, scale)));
        _mm_storeu_ps(audio + frames + frame,
                      _mm_add_ps(_mm_loadu_ps(audio + frames + frame), _mm_mul_ps(r, scale)));
      }
    }
#endif
    for (; frame < frames; ++frame)
      if (channels == 1u)
        audio[frame] += .5F * (left[frame] + right[frame]) * gain;
      else {
        audio[frame] += left[frame] * gain;
        audio[frames + frame] += right[frame] * gain;
      }
  }
  void processSf2MidiSpans(float *audio, std::uint32_t channels, std::uint32_t frames,
                           double blockTime, float gain, std::uint32_t liveCount,
                           std::uint32_t &next) noexcept {
    auto *left = sf2_sends_.data() + 4u * max_frames_;
    auto *right = left + max_frames_;
    std::fill_n(left, frames, 0.0F);
    std::fill_n(right, frames, 0.0F);
    sf2_spans_ = true;
    for (auto first = 0u; first < frames;) {
      modulation_block_frame_ = first;
      sf2_span_first_ = sf2_frame_ = first;
      modulation_host_time_ = blockTime + static_cast<double>(first) / rate_;
      while (next < liveCount && (*midi_events_)[next].offset_frames <= first)
        midiEvent((*midi_events_)[next++], midi_flags_);
      const auto end =
          next < liveCount ? std::min(frames, (*midi_events_)[next].offset_frames) : frames;
      // Include stolen-voice tails, but do not traverse never-used capacity.
      trimVoiceExtent();
      for (auto slot = 0u; slot < voice_extent_; ++slot)
        renderSf2VoiceSpan((*voices_)[slot], first, end, blockTime, left, right);
      if (midi_running_ && !midi_paused_)
        midi_clock_ += end - first;
      first = end;
    }
    sf2_spans_ = false;
    // These independent contiguous operations retain the original float order
    // per frame and permit SIMD; the voice IIR recurrences remain scalar.
    mixSf2MidiOutput(audio, left, right, channels, frames, gain);
  }
  void processMidi(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    const auto blockTime = modulation_host_time_;
    synchronizeMidiChannel();
    if (notes_reset_pending_) {
      clearNotes();
      resetMidi();
    }
    if (bank() && bank()->state_ == ET_ASSET_STATE_PREPARING) {
      bank()->prepareSlice(static_cast<std::uint64_t>(frames) * 8u);
      if (bank()->state_ == ET_ASSET_STATE_ACTIVE)
        resetMidi();
    }
    setVoiceLimit(static_cast<std::uint32_t>(bounded(params_.maxVoices, 1, kVoices, 64)));
    const auto gain = midi_gain_ * std::pow(10.0F, bounded(params_.outputGain, -60, 12, 0) * .05F);
    if (midi_meters_.enabled())
      midi_meters_.begin(frames, gain);
    if (midi_history_pending_ || (midi_flags_ & ET_MIDI_STATE_ONLY))
      processHistory();
    const bool history = (midi_flags_ & ET_MIDI_STATE_ONLY) != 0u;
    const auto liveCount = history ? 0u : midi_count_;
    if (!beginSfzEffects(frames)) {
      failRuntime();
      return;
    }
    auto next = 0u;
    const bool useSf2Spans = Midi && bank() && bank()->sf2_ &&
                             bank()->state_ == ET_ASSET_STATE_ACTIVE && !script_session_ &&
                             !history && !midi_history_pending_;
    if (useSf2Spans)
      processSf2MidiSpans(audio, channels, frames, blockTime, gain, liveCount, next);
    else
      for (auto frame = 0u; frame < frames; ++frame) {
        modulation_block_frame_ = frame;
        modulation_host_time_ = blockTime + static_cast<double>(frame) / rate_;
        sf2_frame_ = frame;
        advanceRuntime();
        while (next < liveCount && (*midi_events_)[next].offset_frames <= frame)
          midiEvent((*midi_events_)[next++], midi_flags_);
        if (midi_running_ && !midi_paused_ && script_session_ &&
            !script_session_->vm.state().initialized)
          initializeScript();
        captureSfzEffectSources(frame);
        float left = 0.0F, right = 0.0F;
        if (bank() && bank()->state_ == ET_ASSET_STATE_ACTIVE)
          for (auto i = 0u; i < voice_limit_; ++i)
            renderVoice((*voices_)[i], left, right);
        if (!sfz_quantum_started_ && channels == 1u)
          audio[frame] += .5F * (left + right) * gain;
        else if (!sfz_quantum_started_) {
          audio[frame] += left * gain;
          audio[frames + frame] += right * gain;
        }
        if (midi_running_ && !midi_paused_)
          ++midi_clock_;
      }
    // Events outside this call's frame span invalidate the batch rather than leaking into another
    // block.
    if (next != liveCount)
      retireMidi();
    if (!history)
      midi_count_ = midi_cursor_ = 0u;
    collectScriptNotes();
    // Main shares Note's accepted-audio counter. Offline trial rollback owns
    // this field, so a strict missing-page retry does not consume frames.
    sample_clock_ += frames;
  }
  void advanceRuntime() noexcept {
    if (!midi_running_ || midi_paused_ || !bank() || bank()->state_ != ET_ASSET_STATE_ACTIVE)
      return;
    const auto target = midi_clock_;
    for (auto slice = 0u; slice < 64u; ++slice) {
      std::uint32_t quota = 64;
      if (advanceScript(target, quota))
        return;
      if (!script_session_ || script_session_->failed)
        return;
    }
    // A live callback must settle at its original sample; an over-budget instrument fails
    // explicitly instead of shifting all subsequent notes to a later block.
    if (script_session_) {
      script_session_->failed = true;
      if (script_error_ == script::Error::None)
        script_error_ = script::Error::Budget;
    }
  }
  void failRuntime() noexcept {
    if constexpr (Midi) {
      midi_meters_.cancel();
      midi_meters_.clear();
    }
    if (!bank() || bank()->state_ == ET_ASSET_STATE_ERROR)
      return;
    const bool scriptFailure = script_session_ && script_session_->failed;
    clearNotes();
    clearSampleForecast();
    paused_voices_->fill({});
    midi_channels_->fill({});
    midi_count_ = midi_cursor_ = midi_flags_ = 0;
    midi_running_ = midi_paused_ = midi_history_requested_ = midi_history_pending_ = false;
    if (script_session_) {
      script_session_->reset(*bank()->scriptProgram_, rate_, seed_);
      script_session_->failed = scriptFailure;
      script_session_->suppressed = true;
    }
    if (bank()->sf2_effects_)
      bank()->sf2_effects_->reset();
    if (bank()->sfz_effects_)
      bank()->sfz_effects_->reset();
    sfz_quantum_started_ = false;
    bank()->failAsset();
    if (scriptFailure) {
      script::Value message;
      message.kind = 2;
      constexpr char prefix[] = "NKSP runtime error ";
      auto *position = std::copy_n(prefix, sizeof(prefix) - 1, message.text.data());
      position = std::to_chars(position, message.text.data() + 100,
                               static_cast<std::uint32_t>(script_error_ == script::Error::None
                                                              ? script::Error::Host
                                                              : script_error_))
                     .ptr;
      constexpr char location[] = " at instruction ";
      position = std::copy_n(location, sizeof(location) - 1, position);
      std::to_chars(position, message.text.data() + 127, script_error_pc_);
      // Keep the terminal diagnostic even if earlier message() calls filled the ring.
      if (script_message_count_ == script_messages_->size()) {
        script_message_head_ = (script_message_head_ + 1u) % script_messages_->size();
        --script_message_count_;
        if (script_messages_dropped_ != UINT32_MAX)
          ++script_messages_dropped_;
      }
      scriptMessage(message);
    }
  }
  static et_status prepareBank(const PrepareInfo &preparation, const AssetBeginInfo &info,
                               const std::uint8_t *payload, std::uint32_t format,
                               std::unique_ptr<PreparedAsset> &asset) noexcept {
    return SFZBank::prepare(preparation, info, payload, format, asset, kVoices);
  }
  static bool hasStolenTail(const Voice &voice) noexcept {
    return voice.fade && (voice.stolenLeft != 0.0F || voice.stolenRight != 0.0F);
  }
  void trimVoiceExtent() noexcept {
    while (voice_extent_ && !(*voices_)[voice_extent_ - 1u].region &&
           !hasStolenTail((*voices_)[voice_extent_ - 1u])) {
      auto &voice = (*voices_)[--voice_extent_];
      voice.lastLeft = voice.lastRight = 0.0F;
      voice.fade = 0;
    }
  }
  void setVoiceLimit(std::uint32_t limit) noexcept {
    if (limit < voice_limit_)
      for (auto slot = limit; slot < voice_limit_; ++slot)
        (*voices_)[slot] = {};
    voice_limit_ = limit;
    voice_extent_ = std::min(voice_extent_, limit);
  }
  std::span<const Voice> liveVoices() const noexcept {
    return voices_ ? std::span<const Voice>(voices_->data(), Midi ? voice_extent_ : kVoices)
                   : std::span<const Voice>{};
  }
  SFZBank *bank() noexcept { return static_cast<SFZBank *>(bank_.get()); }
  const SFZBank *bank() const noexcept { return static_cast<const SFZBank *>(bank_.get()); }
  const float *region(std::uint32_t index) const noexcept { return bank()->region(index); }
  void clearNotes() noexcept {
    notes_reset_pending_ = false;
    if constexpr (Midi)
      midi_meters_.clear();
    voice_extent_ = 0;
    if (voices_)
      voices_->fill({});
    clearDetectionState();
    wet_.clear();
    wet_position_ = 0u;
    sf2_fx_delay_.clear();
    sf2_fx_position_ = 0;
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
    if (preview && bank()->modulation_) {
      fadeVoice(v, fade_length_);
      return;
    }
    const auto time = static_cast<double>(v.elapsed) / rate_;
    v.pitchReleaseStart = modulationEnvelope(v.region + PitchEGDelay, time);
    v.filterReleaseStart = modulationEnvelope(v.filterEnvelopeParameters.data(), time);
    v.releaseElapsed = 0;
    v.released = true;
    if (v.modulationRevision != midi_revision_)
      refreshMidiModulation(v);
    // Keep detected note-offs natural even when an SFZ omits its release envelope.
    const auto duration = preview
                              ? fade_length_
                              : std::max(v.ampParameters[EnvelopeParameters::Release], .2F) * rate_;
    if (bank()->sf2_) {
      v.sf2VolumeEnvelope.forceRelease(preview ? static_cast<float>(fade_length_) / rate_
                                               : std::max(.2F, v.sf2Parameters.volEnv.release));
      v.sf2ModEnvelope.release(v.sf2Parameters.modEnv);
    } else if (bank()->modulation_) {
      const auto view = bank()->modulation_->region(modulationRegionIndex(v));
      modulation::releaseVoice(view, modulationState(v), modulationSourceFrame(v), rate_);
    } else
      v.ampEnvelope.forceRelease(static_cast<float>(std::max(1.0F, duration)) / rate_);
  }
  void releaseKey(std::uint32_t midi, bool preview = false) noexcept {
    if constexpr (!Midi) {
      if (!preview) {
        if ((*midi_channels_)[0].keys[midi]) {
          const et_midi_event event{0, 0x80u | (midi << 8u), 0, 0, 0, 0};
          midiEvent(event, 0);
        }
        return;
      }
    }
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
      startVoices(static_cast<std::uint32_t>(midi), logicalNoteKey(static_cast<unsigned>(midi)),
                  velocity, true);
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
    if (script_session_ && (!midi_running_ || midi_paused_))
      return;
    const auto floor = bounded(params_.velocityFloor, -96, 0, -30);
    const auto ceiling = std::max(floor + 1.0F, bounded(params_.velocityCeiling, -60, 24, 3));
    const auto velocity = static_cast<std::uint32_t>(
        std::round(bounded(1.0F + 126.0F * (level - floor) / (ceiling - floor), 1, 127, 1)));
    const et_midi_event event{0, 0x90u | (midi << 8u) | (velocity << 16u), 0, 0, 0, 0};
    midiEvent(event, 0);
  }
  void startVoices(std::uint32_t midi, int target_key, std::uint32_t velocity,
                   bool preview) noexcept {
    if (midi_trigger_ > 0 && !(bank()->trigger_mask_ & (1u << midi_trigger_)))
      return;
    const auto *incoming = script_session_ ? script_session_->find(midi_note_id_) : nullptr;
    if constexpr (!Midi)
      if (midi_trigger_ == 0u && midi_controller_ < 0)
        for (auto &v : *voices_)
          if (v.midi == midi && v.preview == preview && (!incoming || !incoming->generated) &&
              (!voiceScriptNote(v) || !voiceScriptNote(v)->generated)) {
            if (v.region && v.region[LoopMode] == 1.0F) {
              if (bank()->modulation_)
                fadeVoice(v, fade_length_);
              else {
                v.released = true;
                v.ampEnvelope.forceRelease(static_cast<float>(fade_length_) / rate_);
              }
            } else
              release(v, preview);
          }
    if (target_key < 0 || target_key > 127)
      return;
    // Select a neighboring key's timbre, but tune playback to the unshifted target key.
    const auto sample_key = sampleKeyForTarget(target_key);
    if (sample_key < 0 || sample_key > 127)
      return;
    if (!midi_reattack_) {
      random_ ^= random_ << 13u;
      random_ ^= random_ >> 17u;
      random_ ^= random_ << 5u;
    }
    const auto random = midi_reattack_ ? (*midi_channels_)[midi_channel_].random[midi]
                                       : static_cast<double>(random_) / 4294967296.0;

    if (!midi_reattack_)
      (*midi_channels_)[midi_channel_].random[midi] = random;
    if (!midi_reattack_) {
      modulation_random_ = static_cast<float>(random);
      modulation_cache_bank_ = nullptr;
    }
    const auto *keys = bank()->indices_.data() + 129u + 2u * bank()->group_count_;
    auto *sequences = bank()->indices_.data() + 129u;
    auto *stamps = sequences + bank()->group_count_;
    if (++note_serial_ == 0u) {
      std::fill_n(stamps, bank()->group_count_, 0u);
      ++note_serial_;
    }
    struct Selection {
      const float *region = nullptr;
      std::uint32_t velocity = 0;
    };
    std::array<Selection, kVoices> selected{};
    std::uint32_t selected_count = 0u;
    // Groups share one sequence counter, advanced once for this note-on.
    const auto begin = midi_controller_ >= 0 ? 0u : bank()->indices_.data()[sample_key];
    const auto end =
        midi_controller_ >= 0 ? bank()->region_count_ : bank()->indices_.data()[sample_key + 1];
    for (auto i = begin; i < end; ++i) {
      const auto *r = region(midi_controller_ >= 0 ? i : keys[i]);
      const auto group = static_cast<std::uint32_t>(r[SequenceGroup]);
      if (!midiRegion(r, midi))
        continue;
      const auto musicalVelocity = regionVelocity(r, velocity);
      if (midi_trigger_ > 0)
        if (const auto *settings = playbackPlan(r);
            settings && !settings->releaseDead &&
            std::none_of(voices_->begin(), voices_->end(), [&](const auto &voice) {
              return voice.region && voice.channel == midi_channel_ && voice.midi == midi &&
                     keyDrivenRegion(voice.region);
            }))
          continue;
      if (!midi_reattack_ && stamps[group] != note_serial_) {
        stamps[group] = note_serial_;
        ++sequences[group];
      }
      const auto sequence =
          (sequences[group] - 1u) % static_cast<std::uint32_t>(r[SequenceLength]) + 1u;
      if (musicalVelocity < r[LowVelocity] || musicalVelocity > r[HighVelocity] ||
          random < r[LowRandom] || random >= r[HighRandom] || sequence != r[SequencePosition])
        continue;
      selected[selected_count++ % voice_limit_] = {r, musicalVelocity};
    }
    // When layers exceed polyphony, only the newest surviving voices need initialization.
    const auto retained = std::min(selected_count, voice_limit_);
    const auto first = selected_count - retained;
    for (auto i = first; i < selected_count; ++i) {
      const auto *r = selected[i % voice_limit_].region;
      velocity = selected[i % voice_limit_].velocity;
      const auto *playback = playbackPlan(r);

      if (r[Group] != 0)
        for (auto &v : *voices_)
          if (v.region && v.region[OffBy] == r[Group]) {
            if (v.midi == midi && playback &&
                !playback::selfMaskCandidate(playback->selfMask, v.velocity, velocity))
              continue;
            if (v.historyOnly) {
              v.region = nullptr;
              continue;
            }
            const auto duration = v.region[OffMode] == 1.0F ? v.region[Release] : v.region[OffTime];
            if (bank()->modulation_) {
              if (v.region[OffMode] == 1.0F)
                releaseMidiVoice(v, true);
              else {
                const auto retiring = v.retireFrames != 0;
                fadeVoice(v, static_cast<std::uint32_t>(duration * rate_));
                if (!retiring && v.region && playbackPlan(v.region))
                  v.offSeconds = duration;
              }
            } else if (v.region[OffMode] == 1.0F) {
              if (!v.released) {
                v.released = true;
                refreshMidiModulation(v);
                v.ampEnvelope.release(v.ampParameters);
              }
            } else {
              if (!v.forcedRelease) {
                v.released = v.forcedRelease = true;
                v.ampEnvelope.forceRelease(duration);
              }
            }
          }
      const auto regionIndex = static_cast<std::uint32_t>((r - bank()->region(0)) / kStride);
      if (bank()->silentRegion(regionIndex))
        continue;
      if (bank()->timer_frames_.size())
        bank()->timer_frames_.data()[midi_channel_ * bank()->group_count_ +
                                     static_cast<std::uint32_t>(r[SequenceGroup])] = midi_clock_;
      // History advances selection/choke state, but expired release/controller sounds never
      // occupy the held pool.
      if (midi_state_only_ && (midi_trigger_ != 0u || midi_controller_ >= 0))
        continue;
      // SF2 has no SFZ region polyphony limit; its global cap and exclusive
      // classes govern voice retirement. Zero SFZ limits inherit the global cap.
      if (!bank()->sf2_ && (r[Polyphony] > 0 || r[NotePolyphony] > 0)) {
        std::uint32_t groupCount = 0u, noteCount = 0u;
        Voice *oldestGroup = nullptr, *oldestNote = nullptr;
        const auto older = [&](const Voice &voice, const Voice *candidate) {
          if (!candidate)
            return true;
          if (playback && playback->stealing) {
            const auto held = voice.keyDown || voice.sostenuto || voiceSustain(voice);
            const auto candidateHeld =
                candidate->keyDown || candidate->sostenuto || voiceSustain(*candidate);
            if (held != candidateHeld)
              return !held;
          }
          return voice.age < candidate->age;
        };
        for (auto slot = 0u; slot < (Midi ? voice_extent_ : kVoices); ++slot)
          if (auto &v = (*voices_)[slot];
              v.region && v.channel == midi_channel_ && !v.released &&
              (r[Group] != 0.0F ? v.region[Group] == r[Group] : v.region == r)) {
            ++groupCount;
            if (older(v, oldestGroup))
              oldestGroup = &v;
            if (v.midi == midi) {
              ++noteCount;
              if (older(v, oldestNote))
                oldestNote = &v;
            }
          }
        if (r[Polyphony] > 0 && groupCount >= r[Polyphony] && oldestGroup)
          fadeVoice(*oldestGroup, fade_length_);
        if (r[NotePolyphony] > 0 && noteCount >= r[NotePolyphony] && oldestNote)
          fadeVoice(*oldestNote, fade_length_);
      }
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
      chosen->modulationSlot = static_cast<std::uint32_t>(chosen - voices_->data());
      voice_extent_ = std::max(voice_extent_, chosen->modulationSlot + 1u);
      chosen->modulationRandom = static_cast<float>(random);
      chosen->stolenLeft = old_left;
      chosen->stolenRight = old_right;
      chosen->fade = fade_length_;
      chosen->region = r;
      chosen->historyOnly = midi_state_only_;
      chosen->channel = midi_channel_;
      chosen->preset = (*midi_channels_)[midi_channel_].preset;
      chosen->noteId = midi_note_id_ ? midi_note_id_ : static_cast<std::uint32_t>(age_ + 1u);
      assignScriptSlot(*chosen);
      chosen->keyDown = midi_trigger_ == 0u && midi_controller_ < 0;
      chosen->midi = midi;
      chosen->outputMidi = static_cast<std::uint32_t>(target_key);
      chosen->velocity = velocity;
      chosen->preview = preview;
      chosen->position = r[Direction] == 1.0F ? indexValue(r, End) : indexValue(r, Offset);
      if (script_session_)
        if (const auto *scriptNote = script_session_->find(chosen->noteId)) {
          chosen->scriptWholeSample = scriptNote->wholeSample;
          if (scriptNote->sampleOffset >= 0.0)
            chosen->position = scriptNote->sampleOffset * r[Rate];
        }
      chosen->age = ++age_;
      modulation_last_offset_ = static_cast<float>(chosen->position);
      modulation_cache_bank_ = nullptr;

      chosen->delayFrames =
          static_cast<std::uint32_t>((r[Delay] + r[DelayRandom] * random) * rate_);
      chosen->envelope = r[Attack] > 0.0F ? 0.0F : 1.0F;
      chosen->step =
          std::exp2(((static_cast<double>(target_key) - r[KeyCenter]) * r[KeyTrack] * .01 +
                     r[Transpose] + (bank()->modulation_ ? 0 : r[Tune] * .01)) /
                    12.0) *
          r[Rate] / rate_;

      chosen->step *= std::exp2(
          (r[PitchVelocityTrack] * velocity / 127.0 + r[PitchRandom] * (2.0 * random - 1.0)) /
          1200.0);
      chosen->baseStep = chosen->controllerStep = chosen->step;
      if (!chosen->historyOnly && !bank()->sf2_)
        configureFilter(*chosen);
      const auto normalized = static_cast<float>(velocity) / 127.0F;
      const auto tracked = r[VelocityTrack] >= 0 ? normalized : (128.0F - velocity) / 127.0F;
      const auto gain =
          std::pow(10.0F, (bank()->modulation_ ? 0 : r[Volume]) * .05F) *
          (bank()->sf2_ ? std::pow(tracked, std::abs(r[VelocityTrack]) * .02F)
           : bank()->modulation_
               ? 1.0F
               : amplifier::velocityGain(static_cast<float>(velocity), r[VelocityTrack]));
      const auto pan = bank()->modulation_ ? 0 : r[Pan] * .01F;
      const auto random_gain =
          std::pow(10.0F, r[AmpRandom] * static_cast<float>(2.0 * random - 1.0) * .05F);
      chosen->gainLeft = gain * random_gain * (pan > 0 ? 1.0F - pan : 1.0F);
      chosen->gainRight = gain * random_gain * (pan < 0 ? 1.0F + pan : 1.0F);
      if (midi_trigger_ > 0 && playback) {
        const auto birth = (*midi_channels_)[midi_channel_].noteOnFrames[midi];
        const double age =
            birth == UINT64_MAX ? 0 : (static_cast<double>(midi_clock_) - birth) / rate_;
        const auto decay =
            std::pow(10.0, playback::releaseDecay(age, playback->decayRate, playback->decay) * .05);
        chosen->gainLeft *= static_cast<float>(decay);
        chosen->gainRight *= static_cast<float>(decay);
      }
      {
        refreshMidiModulation(*chosen);
        if (bank()->sf2_) {
          if (!chosen->region)
            continue;
          chosen->sf2VolumeEnvelope.reset(chosen->sf2Parameters.volEnv, rate_, true);
          chosen->sf2ModEnvelope.reset(chosen->sf2Parameters.modEnv, rate_, false);
          chosen->sf2ModLfo.reset();
          chosen->sf2VibLfo.reset();
          if (!chosen->historyOnly)
            configureFilter(*chosen);
          const auto exclusive = chosen->sf2Parameters.exclusiveClass;
          if (exclusive)
            for (auto &voice : *voices_)
              if (&voice != chosen && voice.region && voice.channel == chosen->channel &&
                  voice.preset == chosen->preset && voice.noteId != chosen->noteId &&
                  voice.sf2Parameters.exclusiveClass == exclusive) {
                voice.keyDown = false;
                voice.released = true;
                voice.sf2VolumeEnvelope.forceRelease(.001F);
                voice.sf2ModEnvelope.forceRelease(.001F);
              }
        } else if (bank()->modulation_)
          initializeModulationVoice(*chosen);
        else
          chosen->ampEnvelope.reset(chosen->ampParameters, rate_);
      }
    }
  }

  std::uint32_t sampleQuality(const Voice &voice) const noexcept {
    if constexpr (Midi) {
      const auto quality = static_cast<std::uint32_t>(bounded(params_.sampleQuality, 0, 2, 0));
      if (quality != 0u)
        return quality == 1u ? 11u : 2u;
    }
    return voice.sampleQuality;
  }
  static std::uint32_t filterProfile(std::uint32_t quality) noexcept {
    if (quality == 1u || quality == 2u)
      return SampleResamplingTables::kInvalid;
    return quality == 11u ? 1u : quality >= 3u && quality <= 9u ? quality - 1u : 0u;
  }
  void selectVoiceFilter(Voice &voice, std::uint32_t profile, double step) noexcept {
    if (voice.filter == kIdentityFilter) {
      if (profile <= 1u && step == 1)
        return;
      voice.filter = resampling_tables_->select(profile, step);
      voice.previousFilter = kIdentityFilter;
      const auto guard = resampling_tables_->maximumBankStep(1);
      voice.filterTransition = voice.filter != SampleResamplingTables::kInvalid && profile <= 1u &&
                                       step >= 1 / guard && step <= guard
                                   ? kFilterTransitionFrames
                                   : 0u;
      return;
    }
    const auto target = resampling_tables_->contains(voice.filter, profile, step)
                            ? voice.filter
                            : resampling_tables_->select(profile, step);
    if (target == SampleResamplingTables::kInvalid ||
        voice.filter == SampleResamplingTables::kInvalid ||
        resampling_tables_->kernel(voice.filter).profile != profile) {
      voice.filter = voice.previousFilter = target;
      voice.filterTransition = 0;
      return;
    }
    if (voice.filterTransition != 0u) {
      // Finish a short, safe transition before following the next bucket.
      // A discontinuous wide pitch jump must not retain an unsafe cutoff.
      const auto oldSafe = voice.previousFilter == kIdentityFilter
                               ? step <= resampling_tables_->maximumBankStep(1)
                               : resampling_tables_->safe(voice.previousFilter, step);
      if (!oldSafe || !resampling_tables_->safe(voice.filter, step)) {
        voice.filter = voice.previousFilter = target;
        voice.filterTransition = 0;
      }
      return;
    }
    if (target != voice.filter) {
      voice.previousFilter = voice.filter;
      voice.filter = target;
      voice.filterTransition =
          resampling_tables_->safe(voice.previousFilter, step) ? kFilterTransitionFrames : 0u;
    }
  }
  void resetVoiceFilter(Voice &voice) noexcept {
    const auto profile = filterProfile(sampleQuality(voice));
    const auto step = effectiveSourceStep(voice);
    // Unit-rate integer sampling is an exact copy. Once its pitch moves, this
    // eligibility is not regained until a genuine new birth or reattack.
    voice.filter = voice.previousFilter =
        profile <= 1u && step == 1 && voice.position == std::floor(voice.position)
            ? kIdentityFilter
            : resampling_tables_->select(profile, step);
    voice.filterTransition = 0;
  }
  void configureFilter(Voice &v) noexcept {
    resetVoiceFilter(v);
    const auto *r = v.region;
    const auto step = effectiveSourceStep(v);
    v.loopMeanOnly = false;
    const auto loop_frames =
        static_cast<std::uint64_t>(boundary(v, LoopEnd) - boundary(v, LoopStart) + 1);
    // When every loop harmonic exceeds Nyquist, only its DC component remains in band.
    if (filterProfile(sampleQuality(v)) != SampleResamplingTables::kInvalid && looping(v) &&
        step >= loop_frames && step >= boundary(v, LoopEnd) + 1.0 - v.position) {
      const auto channels = static_cast<std::uint32_t>(r[Channels]);
      double left = 0.0, right = 0.0;
      for (auto frame = 0u; frame < loop_frames; ++frame) {
        left += sample(v, static_cast<std::int64_t>(boundary(v, LoopStart)) + frame, 0);
        right +=
            sample(v, static_cast<std::int64_t>(boundary(v, LoopStart)) + frame, channels - 1u);
      }
      v.loopMeanLeft = static_cast<float>(left / loop_frames);
      v.loopMeanRight = static_cast<float>(right / loop_frames);
      v.loopMeanOnly = true;
      return;
    }
  }

  bool acceptSampleRead(SampleReadStatus status, std::uint32_t sample, std::uint64_t frame,
                        std::uint32_t channel) noexcept {
    if (status == SampleReadStatus::Ready)
      return true;
    if (status == SampleReadStatus::Unavailable) {
      sample_missing_ = true;
      if (!block_miss_.valid || sf2_frame_ < block_miss_frame_) {
        const auto offset =
            sf2_spans_ && midi_running_ && !midi_paused_ ? sf2_frame_ - sf2_span_first_ : 0u;
        block_miss_ = {true,   bank()->cache_.generation(), frame, midi_clock_ + offset, sample,
                       channel};
        block_miss_frame_ = sf2_frame_;
      }
    } else {
      sample_invalid_ = true;
    }
    return false;
  }
  void commitAvailability(std::uint32_t frames) noexcept {
    if (sample_missing_) {
      if (underrun_quanta_ != UINT64_MAX)
        ++underrun_quanta_;
      underrun_frames_ =
          frames > UINT64_MAX - underrun_frames_ ? UINT64_MAX : underrun_frames_ + frames;
      if (!first_miss_.valid)
        first_miss_ = block_miss_;
    }
    if (availability_missing_ != sample_missing_) {
      availability_missing_ = sample_missing_;
      if (availability_generation_ != UINT32_MAX)
        ++availability_generation_;
    }
  }
  bool unavailableWindow(const Voice &voice, std::int64_t first, std::uint32_t count,
                         std::uint32_t channel, const SampleWindowView *view) noexcept {
    if (!view || view->status != SampleReadStatus::Unavailable || first < view->first ||
        count > view->count ||
        static_cast<std::uint64_t>(first - view->first) > view->count - count)
      return false;
    // Publication cannot run inside a voice span. Request and diagnose the first
    // actual read only; later reads reuse this page's known availability.
    if (!view->requested) {
      float unused = 0;
      const auto sampleId = indexValue(voice.region, Sample);
      acceptSampleRead(
          bank()->cache_.readSample(sampleId, static_cast<std::uint64_t>(first), channel, unused),
          sampleId, static_cast<std::uint64_t>(first), channel);
      view->requested = true;
    }
    return true;
  }
  float sample(const Voice &v, std::int64_t frame, std::uint32_t channel,
               const SampleWindowView *view = nullptr) noexcept {
    const auto *r = v.region;
    const bool looping = SFZEngine::looping(v);
    const auto start = static_cast<std::int64_t>(boundary(v, LoopStart)),
               end = static_cast<std::int64_t>(boundary(v, LoopEnd));
    if (v.playbackEnabled && looping && playbackPlan(r)->loopType == 2u &&
        ((v.looped && frame < start) || frame > end))
      frame = static_cast<std::int64_t>(playback::loopAddress(static_cast<double>(frame - start),
                                                              static_cast<double>(start),
                                                              static_cast<double>(end), 2));
    if (looping && v.looped && frame < start)
      frame = end - (start - frame - 1) % (end - start + 1);
    if (looping && frame > end)
      frame = start + (frame - start) % (end - start + 1);
    if (frame < 0 || frame > static_cast<std::int64_t>(boundary(v, End)))
      return 0.0F;
    if (view && view->data && frame >= view->first &&
        static_cast<std::uint64_t>(frame - view->first) < view->count)
      return view->data[frame - view->first];
    if (unavailableWindow(v, frame, 1u, 0u, view))
      return 0.0F;
    const auto channels = static_cast<std::uint32_t>(r[Channels]);
    if (bank()->streamed_) {
      float value = 0;
      acceptSampleRead(
          bank()->cache_.readSample(indexValue(r, Sample), static_cast<std::uint64_t>(frame),
                                    channels == 1u ? 0u : channel, value),
          indexValue(r, Sample), static_cast<std::uint64_t>(frame), channels == 1u ? 0u : channel);
      return value;
    }
    const auto at = indexValue(r, Sample) + static_cast<std::size_t>(frame) * channels +
                    (channels == 1u ? 0u : channel);
    return bank()->payload_.data()[8u + bank()->pool_offset_ + at];
  }
  const float *sampleWindow(const Voice &v, std::int64_t first, std::uint32_t count,
                            std::uint32_t channel, float *scratch,
                            const SampleWindowView *view = nullptr) noexcept {
    const auto *r = v.region;
    if (v.playbackEnabled && looping(v) && playbackPlan(r)->loopType == 2u) {
      for (auto frame = 0u; frame < count; ++frame)
        scratch[frame] = sample(v, first + frame, channel);
      return scratch;
    }
    const auto channels = static_cast<std::uint32_t>(r[Channels]);
    const auto *pcm = bank()->streamed_ ? nullptr
                                        : bank()->payload_.data() + 8u + bank()->pool_offset_ +
                                              indexValue(r, Sample);
    const bool looping = SFZEngine::looping(v);
    const auto loop_start = static_cast<std::int64_t>(boundary(v, LoopStart)),
               loop_end = static_cast<std::int64_t>(boundary(v, LoopEnd)),
               end = static_cast<std::int64_t>(boundary(v, End));
    // A voice can enter its loop midway through a span. Both raw views and
    // resident PCM qualify against the current mapping, not its initial state.
    if (first >= (looping && v.looped ? loop_start : 0) &&
        first + count <= (looping ? loop_end : end) + 1) {
      if (view && view->data && first >= view->first && count <= view->count &&
          static_cast<std::uint64_t>(first - view->first) <= view->count - count)
        return view->data + first - view->first;
      if (unavailableWindow(v, first, count, 0u, view))
        return nullptr;
      if (pcm && channels == 1u)
        return pcm + first;
    }
    auto written = 0u;
    bool anyReady = false;
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
        if (!pcm) {
          const float *contiguous = scratch;
          bool allMissing = false;
          const auto status = bank()->cache_.readWindow(
              indexValue(r, Sample), static_cast<std::uint64_t>(first), chunk,
              channels == 1u ? 0u : channel, scratch + written,
              written == 0u && chunk == count ? &contiguous : nullptr, &allMissing);
          acceptSampleRead(status, indexValue(r, Sample), static_cast<std::uint64_t>(first),
                           channels == 1u ? 0u : channel);
          if (status == SampleReadStatus::Invalid || status == SampleReadStatus::Overflow)
            std::fill_n(scratch + written, chunk, 0.0F);
          else if (contiguous != scratch)
            return contiguous;
          else
            anyReady = anyReady || !allMissing;
        } else {
          anyReady = true;
          if (channels == 1u)
            std::copy_n(pcm + first, chunk, scratch + written);
          else {
            const auto *source = pcm + first * channels + channel;
            for (auto frame = 0u; frame < chunk; ++frame)
              scratch[written + frame] = source[static_cast<std::size_t>(frame) * channels];
          }
        }
        first += chunk;
        written += chunk;
      }
    }
    return anyReady ? scratch : nullptr;
  }
  float crossfadeSample(const Voice &v, float value, std::uint32_t channel) noexcept {
    const auto *r = v.region;
    if (r[LoopCrossfade] <= 0.0F || !looping(v))
      return value;
    const auto start = boundary(v, LoopStart), end = boundary(v, LoopEnd) + 1.0;
    const auto requested = r[LoopCrossfade] * r[Rate];
    const auto fade = requested < (end - start) * .5 ? requested : (end - start) * .5;
    const auto distance = reverse(v) ? v.position - start : end - v.position;
    if (distance < 0 || distance > fade || fade == 0)
      return value;
    const auto other = reverse(v) ? end - distance : start + fade - distance;
    const auto frame = static_cast<std::int64_t>(other);
    const auto fraction = static_cast<float>(other - frame);
    const auto second =
        sample(v, frame, channel) * (1.0F - fraction) + sample(v, frame + 1, channel) * fraction;
    const auto weight =
        static_cast<float>((1.0 - std::cos(3.141592653589793 * (1.0 - distance / fade))) * .5);
    return value * (1.0F - weight) + second * weight;
  }
  oscillator::Stereo readOscillatorCycle(const Voice &v, double phase, double increment,
                                         std::uint32_t quality) noexcept {
    const auto *r = v.region;
    const auto channels = static_cast<std::uint32_t>(r[Channels]);
    const auto frames = indexValue(r, End) + 1u;
    const auto window = [&](std::uint64_t offset, std::uint32_t length, std::int64_t first,
                            std::uint32_t count, std::uint32_t channel, float *scratch) {
      const auto remainder = first % static_cast<std::int64_t>(length);
      auto at = static_cast<std::uint32_t>(remainder < 0 ? remainder + length : remainder);
      const auto *pcm = bank()->streamed_ ? nullptr
                                          : bank()->payload_.data() + 8u + bank()->pool_offset_ +
                                                indexValue(r, Sample);
      if (pcm && channels == 1 && count <= length - at)
        return pcm + offset + at;
      auto written = 0u;
      while (written < count) {
        const auto chunk = std::min(count - written, length - at);
        if (!pcm) {
          if (!acceptSampleRead(bank()->cache_.readWindow(indexValue(r, Sample), offset + at, chunk,
                                                          channel, scratch + written),
                                indexValue(r, Sample), offset + at, channel))
            std::fill_n(scratch + written, chunk, 0.0F);
        } else if (channels == 1) {
          std::copy_n(pcm + offset + at, chunk, scratch + written);
        } else {
          const auto *source = pcm + (offset + at) * channels + channel;
          for (auto n = 0u; n < chunk; ++n)
            scratch[written + n] = source[static_cast<std::size_t>(n) * channels];
        }
        written += chunk;
        at = 0;
      }
      return static_cast<const float *>(scratch);
    };
    return oscillator::readCycle(
        frames, channels, phase, increment, quality, window,
        [&](double distance) { return resampling_tables_->coefficient(0u, distance); });
  }
  oscillator::Settings oscillatorSettings(const Voice &v, bool preview = false) noexcept {
    const auto index = modulationPlan(v).sourceInstance;
    const auto view = bank()->modulation_->region(modulationRegionIndex(v));
    const auto state = modulationState(v, preview);
    using P = schema::Property;
    const auto value = [&](P property) { return modulation::value(view, state, index, property); };
    return {static_cast<std::uint32_t>(value(P::SourceWave)),
            static_cast<std::uint32_t>(value(P::OscillatorMode)),
            static_cast<std::uint32_t>(value(P::OscillatorMulti)),
            static_cast<std::uint32_t>(value(P::OscillatorQuality)),
            value(P::OscillatorDetune),
            value(P::OscillatorPhase),
            value(P::OscillatorModDepth)};
  }
  void resetOscillatorSource(Voice &v, bool preview) noexcept {
    if (!bank()->modulation_ || modulationPlan(v).sourceInstance == UINT32_MAX)
      return;
    auto &pool = preview ? bank()->modulation_->preview : bank()->modulation_->state;
    oscillator::reset(pool.oscillatorState(preview ? 0 : v.modulationSlot),
                      oscillatorSettings(v, preview), seed_ ^ v.age);
  }
  bool renderOscillatorSource(Voice &v, float &left, float &right) noexcept {
    if (!bank()->modulation_)
      return false;
    const auto index = modulationPlan(v).sourceInstance;
    if (index == UINT32_MAX)
      return false;
    const auto view = bank()->modulation_->region(modulationRegionIndex(v));
    if (modulation::value(view, modulationState(v), index, schema::Property::Enabled) == 0)
      return false;
    const auto settings = oscillatorSettings(v);
    const auto output =
        oscillator::tick(bank()->modulation_->state.oscillatorState(v.modulationSlot), settings,
                         261.6255653 * v.step * rate_ / v.region[Rate], rate_,
                         [&](double phase, double increment, std::uint32_t quality) {
                           return readOscillatorCycle(v, phase, increment, quality);
                         });
    left = output.left;
    right = output.right;
    return true;
  }
  static float cubicSample(float a, float b, float c, float d, float t) noexcept {
    return b + .5F * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
  }
  static float cachedFilterSample(const float *coefficients, std::uint32_t taps, double at,
                                  const float *samples) noexcept {
    const auto phase = static_cast<std::uint32_t>(at);
    const auto fraction = at - phase;
    const auto *first = coefficients + phase * taps;
    if (fraction == 0.0)
      return dsp::firDot(first, samples, taps);
    const auto dots = dsp::firDotPair(first, first + taps, samples, taps);
    return static_cast<float>(dots.first + fraction * (dots.second - dots.first));
  }
  float interpolate(Voice &v, std::uint32_t channel,
                    const SampleWindowView *view = nullptr) noexcept {
    const auto step = effectiveSourceStep(v);
    const auto quality = sampleQuality(v);
    if (filterProfile(quality) != SampleResamplingTables::kInvalid && v.loopMeanOnly &&
        looping(v) && step >= boundary(v, LoopEnd) - boundary(v, LoopStart) + 1 &&
        step >= boundary(v, LoopEnd) + 1.0 - v.position)
      return channel == 0u ? v.loopMeanLeft : v.loopMeanRight;
    const auto position = static_cast<std::int64_t>(v.position);
    if (quality == 1u) {
      const auto fraction = static_cast<float>(v.position - position);
      const auto first = sample(v, position, channel, view);
      return crossfadeSample(v, first + fraction * (sample(v, position + 1, channel) - first),
                             channel);
    }
    if (quality == 2u) {
      const auto t = static_cast<float>(v.position - position);
      const auto a = sample(v, position - 1, channel), b = sample(v, position, channel, view);
      const auto c = sample(v, position + 1, channel), d = sample(v, position + 2, channel);
      const auto value = cubicSample(a, b, c, d, t);
      return crossfadeSample(v, value, channel);
    }
    const auto profile = filterProfile(quality);
    selectVoiceFilter(v, profile, step);
    if (v.filter == kIdentityFilter)
      return crossfadeSample(v, sample(v, position, channel, view), channel);
    if (v.filter != SampleResamplingTables::kInvalid) {
      const auto &current = resampling_tables_->kernel(v.filter);
      const auto previousIndex = v.filterTransition ? v.previousFilter : v.filter;
      const auto *previous =
          previousIndex == kIdentityFilter ? nullptr : &resampling_tables_->kernel(previousIndex);
      const auto radius = std::max(current.radius, previous ? previous->radius : 0u);
      const auto right = std::max(current.taps - current.radius,
                                  previous ? previous->taps - previous->radius : 1u);
      std::array<float, kCachedFilterTaps> scratch;
      const auto *samples =
          sampleWindow(v, position - radius, radius + right, channel, scratch.data(), view);
      if (!samples)
        return crossfadeSample(v, 0, channel);
      const auto at = (v.position - position) * kFilterPhases;
      auto value = cachedFilterSample(resampling_tables_->coefficients(v.filter), current.taps, at,
                                      samples + radius - current.radius);
      if (v.filterTransition) {
        const auto old =
            previous ? cachedFilterSample(resampling_tables_->coefficients(previousIndex),
                                          previous->taps, at, samples + radius - previous->radius)
                     : samples[radius];
        const auto mix = static_cast<float>(kFilterTransitionFrames + 1u - v.filterTransition) /
                         kFilterTransitionFrames;
        value = old + mix * (value - old);
      }
      return crossfadeSample(v, value, channel);
    }
    // Arbitrarily wide shifts retain ratio-scaled support. Only immutable
    // prototype lookups and a dot product remain; no arrays of coefficients
    // or trigonometric functions are generated during playback.
    const auto filterStep = step > 1 ? step : 1;
    const auto radius = SampleResamplingTables::kRadii[profile] * filterStep;
    const auto lower = std::ceil(v.position - radius), upper = std::floor(v.position + radius);
    const bool wraps = looping(v);
    const auto end = boundary(v, End);
    const auto first = static_cast<std::int64_t>(wraps || lower > 0 ? lower : 0);
    const auto last = static_cast<std::int64_t>(wraps || upper < end ? upper : end);
    const auto count = last >= first ? static_cast<std::uint64_t>(last - first) + 1u : 0u;
    std::array<float, kCachedFilterTaps> scratch;
    const auto *samples = count <= kCachedFilterTaps
                              ? sampleWindow(v, first, static_cast<std::uint32_t>(count), channel,
                                             scratch.data(), view)
                              : nullptr;
    if (count <= kCachedFilterTaps && !samples)
      return crossfadeSample(v, 0, channel);
    double value = 0, weight = 0;
    for (auto tap = 0ull; tap < count; ++tap) {
      const auto source = first + static_cast<std::int64_t>(tap);
      const auto coefficient =
          resampling_tables_->coefficient(profile, (source - v.position) / filterStep);
      weight += coefficient;
      value += coefficient * (samples ? samples[tap] : sample(v, source, channel, view));
    }
    // Outside-file input remains zero instead of renormalizing a truncated
    // filter. Extreme finite samples traverse their extent, not huge zero tails.
    const auto normalization = wraps || (lower >= 0 && upper <= end) ? weight : filterStep;
    return crossfadeSample(v, static_cast<float>(normalization != 0 ? value / normalization : 0),
                           channel);
  }
  static float modulationEnvelope(const float *eg, double time) noexcept {
    time -= eg[0];
    if (time < 0.0)
      return eg[1] * .01F;
    if (eg[2] > 0.0F && time < eg[2])
      return eg[1] * .01F + (1.0F - eg[1] * .01F) * static_cast<float>(time / eg[2]);
    time -= eg[2];
    if (time < eg[3])
      return 1.0F;
    time -= eg[3];
    const auto sustain = eg[5] * .01F;
    if (eg[4] > 0.0F && time < eg[4])
      return sustain + (1.0F - sustain) * static_cast<float>(1.0 - time / eg[4]);
    return sustain;
  }
  float voiceEnvelope(const Voice &voice, Field first, float releaseStart) const noexcept {
    const auto *eg =
        first == FilterEGDelay ? voice.filterEnvelopeParameters.data() : voice.region + first;
    if (!voice.released)
      return modulationEnvelope(eg, static_cast<double>(voice.elapsed) / rate_);
    const auto time = static_cast<double>(voice.releaseElapsed) / rate_;
    return eg[6] > 0.0F && time < eg[6] ? releaseStart * static_cast<float>(1.0 - time / eg[6])
                                        : 0.0F;
  }
  float voiceLFO(const Voice &voice, Field first) const noexcept {
    const auto index = first == AmpLFODelay ? 0u : first == PitchLFODelay ? 1u : 2u;
    const auto *lfo = voice.lfoParameters.data() + index * 4u;
    const auto time = static_cast<double>(voice.elapsed) / rate_ - lfo[0];
    if (time < 0.0 || lfo[3] == 0.0F)
      return 0.0F;
    const auto fade = lfo[1] > 0.0F && time < lfo[1] ? static_cast<float>(time / lfo[1]) : 1.0F;
    return static_cast<float>(std::sin(voice.lfoPhase[index])) * lfo[3] * fade;
  }
  static bool looping(const Voice &voice) noexcept {
    if (voice.scriptWholeSample)
      return false;
    const auto *r = voice.region;
    const bool mode = r[LoopMode] == 2.0F || (r[LoopMode] == 3.0F && !voice.released);
    return mode &&
           (voice.playbackEnabled ? voice.loopRepeats < voice.loopLimit
                                  : r[LoopCount] < 0.0F || voice.loopRepeats < r[LoopCount]);
  }
  static double boundary(const Voice &voice, Field field) noexcept {
    if (voice.playbackEnabled) {
      if (field == Offset)
        return voice.sourceFirst;
      if (field == End)
        return voice.sourceLast;
      if (field == LoopStart)
        return voice.loopFirst;
      if (field == LoopEnd)
        return voice.loopLast;
    }
    return indexValue(voice.region, field);
  }
  static bool reverse(const Voice &voice) noexcept {
    return voice.playbackEnabled
               ? (voice.playbackInLoop ? voice.playbackLoopBack : voice.playbackReverse)
               : voice.region[Direction] != 0;
  }
  static double effectiveSourceStep(const Voice &voice, bool includeLoop = false) noexcept {
    const bool tuned =
        voice.playbackEnabled && looping(voice) &&
        (includeLoop || (voice.position >= voice.loopFirst && voice.position <= voice.loopLast));
    return voice.step * (tuned ? voice.playbackLoopRatio : 1.0);
  }
  void advancePlayback(Voice &voice) noexcept {
    const auto *settings = playbackPlan(voice.region);
    const auto backwards = reverse(voice);
    const bool loop = looping(voice);
    const auto first = voice.loopFirst, last = voice.loopLast;
    const auto width = last - first + 1;
    const auto step = effectiveSourceStep(voice);
    voice.position += backwards ? -step : step;
    if (loop && (backwards ? voice.position < first : voice.position > last)) {
      const auto remaining = voice.loopLimit - voice.loopRepeats;
      const double distance = backwards ? first - voice.position : voice.position - last;
      if (settings->loopType == 2u && last > first) {
        const double span = last - first;
        const auto crossings = std::ceil(distance / span);
        const auto used = std::min<double>(crossings, static_cast<double>(remaining));
        if (crossings > used) {
          const auto direction = backwards != (std::fmod(used, 2) != 0) ? -1.0 : 1.0;
          const auto endpoint = direction < 0 ? first : last;
          voice.position = endpoint + direction * (distance - used * span);
        } else {
          const auto travel = backwards ? 2 * span + distance : span + distance;
          voice.position = playback::loopAddress(travel, first, last, 2);
        }
        voice.playbackLoopBack = backwards != (std::fmod(used, 2) != 0);
        voice.loopRepeats += static_cast<std::uint32_t>(
            std::min<double>(used, static_cast<double>(UINT32_MAX - voice.loopRepeats)));
      } else if (settings->loopType == 1u && !backwards) {
        const auto crossings = 1 + std::floor(distance / width);
        const auto used = std::min<double>(crossings, static_cast<double>(remaining));
        voice.position = last - distance + (used - 1) * width;
        voice.playbackLoopBack = true;
        voice.loopRepeats += static_cast<std::uint32_t>(
            std::min<double>(used, static_cast<double>(UINT32_MAX - voice.loopRepeats)));
      } else {
        const auto crossings =
            backwards ? std::ceil(distance / width) : std::floor((distance - 1) / width) + 1;
        const auto used = std::min<double>(crossings, static_cast<double>(remaining));
        voice.position += (backwards ? 1 : -1) * used * width;
        voice.playbackLoopBack = backwards;
        voice.loopRepeats += static_cast<std::uint32_t>(
            std::min<double>(used, static_cast<double>(UINT32_MAX - voice.loopRepeats)));
      }
      voice.playbackInLoop = voice.looped = true;
    }
    if (settings->playCount &&
        !playback::repeatSample(voice.playbackRepeat, voice.position, voice.sourceFirst,
                                voice.sourceLast, settings->playCount, voice.playbackReverse))
      voice.region = nullptr;
  }
  bool refreshSf2Modulation(Voice &voice) noexcept {
    const auto previousCutoff = voice.sf2Parameters.cutoffHz;
    const auto previousResonance = voice.sf2Parameters.resonanceDb;
    const auto previousLfoDepth = voice.sf2Parameters.generators[10];
    const auto previousEnvelopeDepth = voice.sf2Parameters.generators[11];
    const auto *r = voice.region;
    const auto regionIndex = static_cast<std::uint32_t>((r - bank()->region(0)) / kStride);
    const auto *section = bank()->payload_.data() + 8u + bank()->modulation_offset_;
    const auto directory = std::bit_cast<std::uint32_t>(section[5]);
    const auto records = std::bit_cast<std::uint32_t>(section[6]);
    const auto first = std::bit_cast<std::uint32_t>(section[directory + regionIndex * 4u]);
    const auto count = std::bit_cast<std::uint32_t>(section[directory + regionIndex * 4u + 1u]);
    const auto &channel = (*midi_channels_)[voice.channel];
    const sf2::Inputs input{
        channel.cc.data(),  voice.outputMidi, voice.velocity,   channel.pressure[voice.midi],
        channel.aftertouch, channel.bend,     channel.bendRange};
    if (!sf2::evaluate(std::span<const float, 61>(bank()->sf2Generators(regionIndex), 61),
                       {section + records + first * sf2::kRouteWords, count}, input,
                       {bank()->sf2_scratch_.data(), bank()->sf2_scratch_.size()}, r[KeyCenter],
                       r[Tune], voice.sf2Parameters)) {
      voice.region = nullptr;
      return false;
    }
    voice.sf2VolumeEnvelope.template parametersChanged<true>(voice.sf2Parameters.volEnv);
    voice.sf2ModEnvelope.template parametersChanged<false>(voice.sf2Parameters.modEnv);
    const auto step = r[Rate] / rate_ * std::exp2(voice.sf2Parameters.pitchCents / 1200.0);
    voice.step = voice.controllerStep = step;
    if (voice.elapsed == 0u || previousCutoff != voice.sf2Parameters.cutoffHz ||
        previousResonance != voice.sf2Parameters.resonanceDb ||
        previousLfoDepth != voice.sf2Parameters.generators[10] ||
        previousEnvelopeDepth != voice.sf2Parameters.generators[11]) {
      // An unrelated MIDI event must not replace the modulated coefficients
      // with the base cutoff. A real base change uses the upcoming sample's
      // modulation without advancing the voice's envelope or LFO.
      auto envelope = voice.sf2ModEnvelope;
      auto lfo = voice.sf2ModLfo;
      const auto &parameters = voice.sf2Parameters;
      const auto modEnvelope = envelope.next(parameters.modEnv);
      const auto modLfo = lfo.next(rate_, parameters.modLfo.frequency, parameters.modLfo.delay,
                                   static_cast<double>(voice.elapsed) / rate_);
      configureSf2Lowpass(voice, sf2FilterFrequency(parameters, modLfo, modEnvelope),
                          parameters.resonanceDb);
    }
    voice.modulationRevision = midi_revision_;
    return true;
  }
  void configureSf2Lowpass(Voice &voice, float frequency, float resonanceDb) noexcept {
    voice.sf2Lowpass.configure(rate_, frequency, resonanceDb);
  }
  static float sf2FilterFrequency(const sf2::Resolved &parameters, float modLfo,
                                  float modEnvelope) noexcept {
    return parameters.cutoffHz * std::exp2((modLfo * parameters.generators[10] +
                                            modEnvelope * parameters.generators[11]) /
                                           1200.0F);
  }
  std::uint32_t modulationRegionIndex(const Voice &voice) const noexcept {
    return static_cast<std::uint32_t>((voice.region - bank()->region(0)) / kStride);
  }
  const ModulationRegion &modulationPlan(const Voice &voice) const noexcept {
    return bank()->modulation_->plan(modulationRegionIndex(voice));
  }
  modulation::StateView modulationState(const Voice &voice, bool preview = false) noexcept {
    auto &pool = preview ? bank()->modulation_->preview : bank()->modulation_->state;
    auto state = pool.state(preview ? 0 : voice.modulationSlot, modulationPlan(voice).layout);
    if (voiceScriptNote(voice) || (!Midi && voice.released))
      state.transform = {this, const_cast<Voice *>(&voice),
                         [](void *owner, void *note, std::uint32_t kind, std::uint32_t property,
                            float value, float base) noexcept {
                           return static_cast<SFZEngine *>(owner)->scriptModulationParameter(
                               *static_cast<Voice *>(note), kind, property, value, base);
                         }};
    return state;
  }
  float scriptModulationParameter(Voice &v, std::uint32_t kind, std::uint32_t property, float value,
                                  float base) noexcept {
    using P = schema::Property;
    using T = script::VoiceTarget;
    const auto p = static_cast<P>(property);
    constexpr auto unavailable = static_cast<T>(UINT32_MAX);
    auto target = unavailable;
    if (kind == 1u || kind == 2u) {
      if (p == P::Attack)
        target = kind == 1 ? T::Attack : T::CutoffAttack;
      else if (p == P::Decay)
        target = kind == 1 ? T::Decay : T::CutoffDecay;
      else if (p == P::Sustain)
        target = kind == 1 ? T::Sustain : T::CutoffSustain;
      else if (p == P::Release)
        target = kind == 1 ? T::Release : T::CutoffRelease;
    } else if (kind >= 6u && kind <= 8u) {
      if (p == P::Frequency)
        target = kind == 6   ? T::AmpLfoFrequency
                 : kind == 7 ? T::CutoffLfoFrequency
                             : T::PitchLfoFrequency;
      else if (p == P::Depth)
        target = kind == 6 ? T::AmpLfoDepth : kind == 7 ? T::CutoffLfoDepth : T::PitchLfoDepth;
    }
    if (target != unavailable) {
      value = static_cast<float>(scriptControl(v, target, value, base));
      const auto low = p == P::Depth ? -12000.0F : 0.0F;
      const auto high = p == P::Depth ? 12000.0F : p == P::Frequency ? 30000.0F : 100.0F;
      value = value < low ? low : value > high ? high : value;
    }
    if constexpr (!Midi)
      if (const auto *note = voiceScriptNote(v); kind == 1u && p == P::Release && v.released &&
                                                 !v.forcedRelease && keyDrivenRegion(v.region) &&
                                                 (!note || !note->generated))
        value = std::max(value, v.preview ? static_cast<float>(fade_length_) / rate_ : .2F);
    return value;
  }
  void refreshModulationSources() noexcept {
    const bool controllersChanged =
        modulation_cache_bank_ != bank() || modulation_cache_revision_ != midi_revision_;
    if (controllersChanged) {
      for (auto channel = 0u; channel < 16u; ++channel) {
        auto &values = (*modulation_sources_)[channel];
        const auto &state = (*midi_channels_)[channel];
        for (auto cc = 0u; cc < 128u; ++cc)
          values[cc] = state.normalizedCC[cc];
        values[128] = (state.bend + 8192) / 16383.0F;
        values[129] = state.aftertouch / 127.0F;
      }
      modulation_keys_down_ = 0;
      for (const auto &channel : *midi_channels_)
        for (const auto count : channel.keys)
          if (count)
            ++modulation_keys_down_;
      modulation_cache_revision_ = midi_revision_;
      modulation_cache_bank_ = bank();
    }
    if (controllersChanged || modulation_cache_clock_ != midi_clock_ ||
        modulation_cache_time_ != modulation_host_time_) {
      const auto transport = currentTransport();
      std::uint32_t voices = 0;
      for (const auto &v : *voices_)
        if (v.region && !v.historyOnly)
          ++voices;
      for (auto &values : *modulation_sources_) {
        values[131] = modulation_velocity_ / 127.0F;
        values[132] = modulation_release_velocity_ / 127.0F;
        values[133] = modulation_key_ / 127.0F;
        values[134] = modulation_keys_down_ ? 1.0F : 0.0F;
        values[135] = modulation_random_;
        values[136] = 2 * modulation_random_ - 1;
        values[137] = modulation_alternate_;
        values[140] = modulation_key_delta_;
        values[141] = std::abs(modulation_key_delta_);
        values[142] = (transport.flags & HostTransport::kTempoValid)
                          ? static_cast<float>(transport.tempoBpm)
                          : 0;
        values[143] = (transport.flags & HostTransport::kPlaying)
                          ? (transport.flags & HostTransport::kLooping ? 2.0F : 1.0F)
                          : 0;
        values[144] = rate_;
        values[145] = static_cast<float>(modulation_host_time_);
        values[146] = (transport.flags & HostTransport::kTimeSignatureValid)
                          ? static_cast<float>(transport.timeSignatureNumerator)
                          : 0;
        values[147] = (transport.flags & HostTransport::kTimeSignatureValid)
                          ? static_cast<float>(transport.timeSignatureDenominator)
                          : 0;
        values[148] = (transport.flags & HostTransport::kPositionValid)
                          ? static_cast<float>(transport.ppqPosition)
                          : 0;
        values[149] = 0;
        if ((transport.flags & (HostTransport::kBarStartValid | HostTransport::kTimeSignatureValid |
                                HostTransport::kPositionValid)) ==
                (HostTransport::kBarStartValid | HostTransport::kTimeSignatureValid |
                 HostTransport::kPositionValid) &&
            transport.timeSignatureDenominator) {
          const auto length =
              transport.timeSignatureNumerator * 4.0 / transport.timeSignatureDenominator;
          auto phase = std::fmod(transport.ppqPosition - transport.barStartPpq, length);
          if (phase < 0)
            phase += length;
          values[149] = static_cast<float>(phase);
        }
        values[150] = static_cast<float>(static_cast<double>(midi_clock_) / rate_);
        values[151] = static_cast<float>(midi_clock_ >= modulation_last_on_
                                             ? (midi_clock_ - modulation_last_on_) /
                                                   static_cast<double>(rate_)
                                             : 0);
        values[152] = static_cast<float>(midi_clock_ >= modulation_last_off_
                                             ? (midi_clock_ - modulation_last_off_) /
                                                   static_cast<double>(rate_)
                                             : 0);
        values[153] = static_cast<float>(modulation_keys_down_);
        values[154] = static_cast<float>(voices);
        values[155] = modulation_last_offset_;
      }
      modulation_cache_clock_ = midi_clock_;
      modulation_cache_time_ = modulation_host_time_;
    }
  }
  modulation::SourceFrame modulationSourceFrame(Voice &voice) noexcept {
    if (voice.retired) {
      const auto elapsed = static_cast<float>(voice.elapsed - voice.retiredSourceElapsed) / rate_;
      for (const auto source : {145u, 150u, 151u, 152u})
        voice.retiredSources[source] += elapsed;
      voice.retiredSourceElapsed = voice.elapsed;
      return {voice.retiredSources, midi_clock_};
    }
    refreshModulationSources();
    auto &values = (*modulation_sources_)[voice.channel];
    values[130] = (*midi_channels_)[voice.channel].pressure[voice.midi] / 127.0F;
    return {values, midi_clock_};
  }
  void refreshImplicitModulation(Voice &v) noexcept {
    const auto &c = (*midi_channels_)[v.channel];
    const auto volume = c.preciseCC[7] ? c.normalizedCC[7] * (Midi ? 1.0F : 1.27F)
                                       : c.cc[7] / (Midi ? 127.0F : 100.0F);
    const auto channel = volume * c.normalizedCC[11];
    const auto keyGain =
        v.region[AmpKeyTrack] * (static_cast<float>(v.outputMidi) - v.region[AmpKeyCenter]) * .01F;
    v.channelGain =
        channel * channel * (c.cc[67] >= 64 ? .70710678F : 1.0F) * std::pow(10.0F, keyGain * .05F);
    const auto panController = c.preciseCC[10] ? c.normalizedCC[10] * 127 : c.cc[10];
    v.channelPan = panController < 64 ? (panController - 64) / 64 : (panController - 64) / 63;
    const auto bend = c.bend < 0 ? v.region[BendDown] * (-c.bend / 8192.0F)
                                 : v.region[BendUp] * (c.bend / 8191.0F);
    v.channelBend = bend * (c.bendRange / 2.0F);
  }
  void recordModulationNote(std::uint32_t key, std::uint32_t velocity, bool on) noexcept {
    if (on) {
      modulation_key_delta_ = modulation_has_key_ ? static_cast<float>(key) - modulation_key_ : 0;
      modulation_key_ = static_cast<float>(key);
      modulation_velocity_ = static_cast<float>(velocity);
      modulation_has_key_ = true;
      modulation_alternate_ = 1 - modulation_alternate_;
      modulation_last_on_ = midi_clock_;
    } else {
      modulation_release_velocity_ = static_cast<float>(velocity);
      modulation_last_off_ = midi_clock_;
    }
    modulation_cache_bank_ = nullptr;
  }
  void initializeAmplifier(Voice &v, const modulation::RegionView &view,
                           modulation::StateView state) noexcept {
    using K = schema::Kind;
    using P = schema::Property;
    v.velocityTrackSlot = UINT32_MAX;
    v.velocityTrackDynamic = v.hasCrossfades = false;
    v.amplifierPan = 0;
    v.amplifierPosition = 0;
    v.panLaw = 0;
    v.phaseGain = v.velocityGain = 1;
    v.velocityTrackRandomOffset = 0;
    float randomDepth = 0;
    std::array<amplifier::CurvePoint, 128> points{};
    std::uint32_t count = 0;
    for (auto i = 0u; i < view.instances.size(); ++i) {
      const auto &instance = view.instances[i];
      const auto kind = static_cast<K>(instance.kind);
      const auto value = [&](P property) { return modulation::value(view, state, i, property); };
      if (kind == K::Amplifier) {
        v.velocityTrackSlot =
            instance.firstParameter +
            schema::parameterRank(instance.kind, static_cast<unsigned>(P::VelocityTrack));
        randomDepth = value(P::Random);
        const amplifier::PanSettings pan{value(P::PanKeyTrack),
                                         value(P::PanKeyCenter),
                                         value(P::PanVelocityTrack),
                                         value(P::PanRandom),
                                         static_cast<unsigned>(value(P::PanLaw)),
                                         static_cast<unsigned>(value(P::PhaseInvert))};
        v.amplifierPan =
            amplifier::panOffset(pan, static_cast<float>(v.outputMidi),
                                 static_cast<float>(v.velocity), 2 * v.modulationRandom - 1);
        v.amplifierPosition = amplifier::positionOffset(
            {value(P::PositionKeyTrack), value(P::PositionKeyCenter),
             value(P::PositionVelocityTrack), value(P::PositionRandom)},
            static_cast<float>(v.outputMidi), static_cast<float>(v.velocity), v.modulationRandom);
        v.panLaw = pan.law;
        v.phaseGain = amplifier::phaseGain(pan);
      } else if (kind == K::VelocityCurvePoint && count < points.size()) {
        points[count++] = {instance.authoredIndex, value(P::Level)};
      } else if (kind == K::Crossfade) {
        v.hasCrossfades = true;
      }
    }
    const std::span<const amplifier::CurvePoint> curve(points.data(), count);
    v.velocityCurveGain = amplifier::velocityCurve(static_cast<float>(v.velocity), curve);
    if (randomDepth != 0)
      v.velocityTrackRandomOffset = randomDepth * amplifier::velocityBirthRandom(seed_, v.age);
    const auto track = v.velocityTrackSlot == UINT32_MAX ? v.region[VelocityTrack]
                                                         : state.parameters[v.velocityTrackSlot];
    v.velocityGain = amplifier::velocityResponse(v.velocityCurveGain,
                                                 track * .01F + v.velocityTrackRandomOffset);
    for (const auto &route : view.routes)
      if (route.target == v.velocityTrackSlot)
        v.velocityTrackDynamic = true;
  }
  float modulationCrossfade(const Voice &v, std::span<float> parameters) noexcept {
    if (!v.hasCrossfades)
      return 1;
    using P = schema::Property;
    const auto view = bank()->modulation_->region(modulationRegionIndex(v));
    const auto &controllers = v.retired ? v.retiredSources : (*modulation_sources_)[v.channel];
    float gain = 1;
    for (const auto &instance : view.instances)
      if (instance.kind == static_cast<unsigned>(schema::Kind::Crossfade)) {
        const auto value = [&](P property) {
          return parameters[instance.firstParameter +
                            schema::parameterRank(instance.kind, static_cast<unsigned>(property))];
        };
        const amplifier::Crossfade fade{
            instance.authoredIndex, value(P::InLow),   value(P::InHigh),
            value(P::OutLow),       value(P::OutHigh), static_cast<unsigned>(value(P::Curve))};
        const auto input = instance.authoredIndex == 0 ? static_cast<float>(v.outputMidi)
                           : instance.authoredIndex == 1
                               ? static_cast<float>(v.velocity)
                               : controllers[instance.authoredIndex - 2u] * 127;
        gain *= amplifier::crossfadeGain(fade, input);
      }
    return gain;
  }
  double playbackValue(const Voice &v, modulation::StateView state,
                       const playback::PreparedPlayback &settings, playback::Slot slot,
                       double fallback = 0, const MidiChannel *controllers = nullptr) noexcept {
    const auto parameter = settings.slots[static_cast<unsigned>(slot)];
    if (parameter == UINT32_MAX)
      return fallback;
    const auto &channel = controllers ? *controllers : (*midi_channels_)[v.channel];
    return static_cast<double>(state.parameters[parameter]) +
           bank()->modulation_->integerContributionWithController(
               modulationRegionIndex(v), parameter, [&](std::uint32_t cc) {
                 return v.retired               ? static_cast<double>(v.retiredSources[cc])
                        : channel.preciseCC[cc] ? static_cast<double>(channel.normalizedCC[cc])
                                                : static_cast<double>(channel.cc[cc]) / 127.0;
               });
  }
  void refreshPlayback(Voice &v, modulation::StateView state,
                       const MidiChannel *controllers = nullptr) noexcept {
    const auto *settings = playbackPlan(v.region);
    if (!v.playbackEnabled || !settings)
      return;
    const auto value = [&](playback::Slot slot) {
      return playbackValue(v, state, *settings, slot, 0, controllers);
    };
    const auto bound = [&](double frame) {
      return frame < 0 ? 0 : frame > v.sourceLast ? v.sourceLast : std::floor(frame);
    };
    const auto first = bound(indexValue(v.region, LoopStart) + value(playback::Slot::LoopStart));
    const auto last =
        std::max(first, bound(indexValue(v.region, LoopEnd) + value(playback::Slot::LoopEnd)));
    const auto ratio = playback::loopPitchRatio(true, value(playback::Slot::LoopTune));
    const bool changed = first != v.loopFirst || last != v.loopLast || ratio != v.playbackLoopRatio;
    v.loopFirst = first;
    v.loopLast = last;
    v.playbackLoopRatio = ratio;
    if (changed) {
      v.loopMeanOnly = false;
      if (!controllers && !v.historyOnly && effectiveSourceStep(v) >= last - first + 1)
        configureFilter(v);
    }
  }
  void initializePlayback(Voice &v, modulation::StateView state,
                          const MidiChannel *controllers = nullptr,
                          bool configure = true) noexcept {
    const auto index = modulationRegionIndex(v);
    const auto *settings = bank()->modulation_->playbackPlan(index);
    if (!settings)
      return;
    const auto controller = [&](std::uint32_t cc) {
      const auto &channel = controllers ? *controllers : (*midi_channels_)[v.channel];
      return channel.preciseCC[cc] ? static_cast<double>(channel.normalizedCC[cc])
                                   : static_cast<double>(channel.cc[cc]) / 127.0;
    };
    const auto delta = [&](playback::Slot slot) {
      return playbackValue(v, state, *settings, slot, 0, controllers);
    };
    auto timing = settings->timing;
    timing.delaySeconds = v.region[Delay] + v.region[DelayRandom] * v.modulationRandom +
                          delta(playback::Slot::DelaySeconds);
    timing.delayBeats = delta(playback::Slot::DelayBeats);
    timing.randomBeats = delta(playback::Slot::DelayBeatsRandom);
    timing.delaySamples = static_cast<double>(
        playback::sampleDelay(static_cast<std::uint64_t>(settings->timing.delaySamples),
                              delta(playback::Slot::DelaySamples)));
    v.playbackTiming = playback::schedule(timing, playbackPpq(), rate_, v.modulationRandom);
    v.playbackEnabled = true;
    v.scriptWholeSample = v.scriptWholeSample || settings->playCount != 0;
    v.delayFrames = 0;
    const auto frames = static_cast<double>(indexValue(v.region, Frames));
    const auto baseOffset = settings->percentOffset ? indexValue(v.region, Offset) * frames * .01
                                                    : indexValue(v.region, Offset);
    v.sourceFirst = playback::startOffset(
        baseOffset, delta(playback::Slot::Offset), settings->percentOffset, frames,
        static_cast<double>(settings->randomOffset), v.modulationRandom);
    v.sourceLast = indexValue(v.region, End);
    refreshPlayback(v, state, controllers);
    v.loopLimit = settings->loopRepeatLimited ? settings->loopRepeatLimit
                  : v.region[LoopCount] >= 0  ? static_cast<std::uint64_t>(v.region[LoopCount])
                                              : UINT64_MAX;
    v.playbackReverse =
        playback::reverseDirection(v.region[Direction] != 0, settings->reverse,
                                   [&](std::uint32_t cc) { return controller(cc) * 127; });
    if (const auto *note = voiceScriptNote(v); note && note->sampleOffset >= 0)
      v.sourceFirst = note->sampleOffset * v.region[Rate];
    v.position = v.playbackReverse ? v.sourceLast : v.sourceFirst;
    const auto view = bank()->modulation_->region(index);
    (void)view;
    v.sampleQuality = settings->sampleQuality;
    v.filter = v.previousFilter = SampleResamplingTables::kInvalid;
    v.filterTransition = 0;
    v.loopMeanOnly = false;
    if (v.sourceFirst > v.sourceLast)
      v.region = nullptr;
    else if (configure && !v.historyOnly)
      configureFilter(v);
  }
  void initializeModulationVoice(Voice &v, bool preview = false) noexcept {
    if (!bank()->modulation_)
      return;
    const auto view = bank()->modulation_->region(modulationRegionIndex(v));
    auto state = modulationState(v, preview);
    modulation::BornFacts birth{static_cast<float>(v.outputMidi),
                                static_cast<float>(v.velocity),
                                0,
                                v.modulationRandom,
                                v.keyDown,
                                static_cast<std::uint32_t>(v.age) ^ seed_};
    modulation::resetVoice(view, state, birth, modulationSourceFrame(v), rate_);
    resetOscillatorSource(v, preview);
    {
      const auto &plan = modulationPlan(v);
      auto &pool = preview ? bank()->modulation_->preview : bank()->modulation_->state;
      const auto slot = preview ? 0u : v.modulationSlot;
      if (plan.voiceDspInstance != UINT32_MAX)
        pool.voiceDspState(slot).reset();
      if (plan.noiseInstance != UINT32_MAX)
        pool.noiseState(slot).reset(birth.seed);
    }
    initializeAmplifier(v, view, state);
    const auto root = [&](schema::Property property) {
      return state.parameters[schema::parameterRank(0, static_cast<std::uint32_t>(property))];
    };
    v.scopeGain = std::pow(10.0F, root(schema::Property::ScopeVolume) * .05F) *
                  root(schema::Property::ScopeAmplitude) * .01F;
    v.bendState = {};
    v.channelBend = pitch::tickBend(
        v.bendState,
        {v.region[BendUp], v.region[BendDown], root(schema::Property::BendStepUp),
         root(schema::Property::BendStepDown), root(schema::Property::BendSmooth)},
        (*midi_channels_)[v.channel].bend, (*midi_channels_)[v.channel].bendRange, 0);
    if (preview) {
      modulation::ResolvedTargets result;
      modulation::tickVoice(view, state, modulationSourceFrame(v), rate_, result);
      const auto &plan = modulationPlan(v);
      v.step = v.controllerStep =
          v.baseStep * std::exp2((state.parameters[plan.regionParameters[2]] +
                                  root(schema::Property::ScopeTune) + v.channelBend) /
                                 1200.0);
    }
    v.modulationWaiting = false;
    v.modulationDone = false;
    for (const auto &envelope : state.envelopes)
      if (envelope.stage == 0u)
        v.modulationWaiting = true;
    for (auto &filter : v.sfzFilters)
      filter = {};
    if (!v.playbackEnabled)
      initializePlayback(v, state);
  }
  std::span<float> tickModulationVoice(Voice &v) noexcept {
    if (!v.retired && v.modulationRevision != midi_revision_)
      refreshMidiModulation(v);
    const auto index = modulationRegionIndex(v);
    const auto &plan = bank()->modulation_->plan(index);
    const auto view = bank()->modulation_->region(index);
    auto state = modulationState(v);
    modulation::ResolvedTargets result;
    modulation::tickVoice(view, state, modulationSourceFrame(v), rate_, result);
    refreshPlayback(v, state);
    const auto root = [&](schema::Property property) {
      return state.parameters[schema::parameterRank(0, static_cast<std::uint32_t>(property))];
    };
    if (!v.retired)
      v.channelBend = pitch::tickBend(
          v.bendState,
          {v.region[BendUp], v.region[BendDown], root(schema::Property::BendStepUp),
           root(schema::Property::BendStepDown), root(schema::Property::BendSmooth)},
          (*midi_channels_)[v.channel].bend, (*midi_channels_)[v.channel].bendRange, 1.0 / rate_);
    else
      v.channelBend = modulation::tickRamp(v.bendState, v.bendState.target,
                                           root(schema::Property::BendSmooth), 1.0 / rate_);
    v.modulationDone = result.ampDone;
    v.modulationWaiting = result.ampWaiting;
    v.envelope = state.parameters[plan.regionParameters[1]] * .01F;
    using P = schema::Property;
    using T = script::VoiceTarget;
    for (auto stage = 0u; stage < 2u; ++stage) {
      const auto node = plan.filters[stage];
      if (node == UINT32_MAX)
        continue;
      const auto &slots = plan.filterParameters[stage];
      const auto value = [&](P property) { return modulation::value(view, state, node, property); };
      auto cutoff = state.parameters[slots[2]], resonance = state.parameters[slots[3]];
      const auto cents = (v.outputMidi - value(P::KeyCenter)) * value(P::KeyTrack) +
                         v.velocity / 127.0F * value(P::VelocityTrack) +
                         v.modulationRandom * value(P::Random);
      if (cents != 0)
        cutoff *= std::exp2(cents / 1200.0F);
      resonance += v.modulationRandom * value(P::ResonanceRandom);
      if (stage == 0) {
        cutoff =
            static_cast<float>(scriptControl(v, T::Cutoff, cutoff, view.parameters[slots[2]].base));
        resonance = static_cast<float>(
            scriptControl(v, T::Resonance, resonance, view.parameters[slots[3]].base));
      }
      const auto type = state.parameters[slots[0]] != 0
                            ? static_cast<std::uint32_t>(state.parameters[slots[1]])
                            : 0u;
      auto &coefficients = (*modulation_filter_cache_)[stage];
      if (!coefficients.configure(type, cutoff, resonance, state.parameters[slots[4]], rate_))
        bank()->failAsset();
      v.sfzFilters[stage].copyConfiguration(coefficients);
    }
    for (auto band = 0u; band < 3u; ++band) {
      const auto first = 6u + 3u * band;
      const auto equalizer = plan.equalizers[band];
      const auto type =
          equalizer == UINT32_MAX
              ? 0u
              : static_cast<std::uint32_t>(modulation::value(view, state, equalizer, P::EqType));
      v.equalizer.configure(band, state.parameters[plan.regionParameters[first]],
                            state.parameters[plan.regionParameters[first + 1]],
                            state.parameters[plan.regionParameters[first + 2]], rate_, type);
    }
    return state.parameters;
  }
  void refreshMidiModulation(Voice &v) noexcept {
    if (bank()->sf2_) {
      refreshSf2Modulation(v);
      return;
    }
    if (bank()->modulation_) {
      if (!v.retired)
        refreshImplicitModulation(v);
      const auto view = bank()->modulation_->region(modulationRegionIndex(v));
      if (view.variableFlags & 1u)
        modulation::refreshVariables(view, modulationState(v), modulationSourceFrame(v));
      v.modulationRevision = midi_revision_;
      return;
    }
    using T = script::VoiceTarget;
    const auto *r = v.region;
    const auto &c = (*midi_channels_)[v.channel];
    float volume = r[AmpKeyTrack] * (static_cast<float>(v.outputMidi) - r[AmpKeyCenter]) * .01F;
    auto &modulation = v.controlModulation;
    if (!v.retired) {
      modulation.fill(0.0F);
      const auto controls = indexValue(r, ControlCount), offset = indexValue(r, ControlOffset);
      for (auto i = 0u; i < controls; ++i) {
        const auto *entry = bank()->payload_.data() + 8u + offset + i * 2u;
        const auto id = std::bit_cast<std::uint32_t>(entry[0]), family = id / 512u, cc = id % 512u;
        modulation[family] += c.cc[cc] / 127.0F * entry[1];
      }
      // Detector playback keeps its established unity level at the shared initial CC7=100.
      const auto channelGain = c.cc[7] / (Midi ? 127.0F : 100.0F) * (c.cc[11] / 127.0F);
      v.channelGain = channelGain * channelGain * (c.cc[67] >= 64u ? .70710678F : 1.0F);
      v.channelPan = c.cc[10] < 64u ? (c.cc[10] - 64.0F) / 64.0F : (c.cc[10] - 64.0F) / 63.0F;
      const auto bend =
          c.bend < 0 ? r[BendDown] * (-c.bend / 8192.0F) : r[BendUp] * (c.bend / 8191.0F);
      v.channelBend = bend * (c.bendRange / 2.0F);
    }
    volume += modulation[VolumeCC];
    auto pan = modulation[PanCC];
    const auto pitch = modulation[TuneCC], cutoffCents = modulation[CutoffCC];
    auto cutoff = r[Cutoff], resonance = r[Resonance] + modulation[ResonanceCC];
    constexpr std::array<Field, 7> amplitudeFields{AmpDelay, AmpStart, Attack, Hold,
                                                   Decay,    Sustain,  Release};
    for (auto target = 0u; target < amplitudeFields.size(); ++target)
      v.ampParameters.value[target] =
          bounded(r[amplitudeFields[target]] + modulation[AmpDelayCC + target], 0.0F, 100.0F, 0.0F);
    const auto controlled = [&](T target, double value, double patch, float low, float high) {
      const auto result = scriptControl(v, target, value, patch);
      return static_cast<float>(result < low ? low : result > high ? high : result);
    };
    constexpr std::array<T, 4> ampTargets{T::Attack, T::Decay, T::Sustain, T::Release};
    constexpr std::array<EnvelopeParameters::Index, 4> ampIndices{
        EnvelopeParameters::Attack, EnvelopeParameters::Decay, EnvelopeParameters::Sustain,
        EnvelopeParameters::Release};
    constexpr std::array<Field, 4> ampFields{Attack, Decay, Sustain, Release};
    for (auto i = 0u; i < ampTargets.size(); ++i)
      v.ampParameters.value[ampIndices[i]] =
          controlled(ampTargets[i], v.ampParameters[ampIndices[i]], r[ampFields[i]], 0, 100);
    std::copy_n(r + FilterEGDelay, 8, v.filterEnvelopeParameters.data());
    constexpr std::array<T, 4> filterTargets{T::CutoffAttack, T::CutoffDecay, T::CutoffSustain,
                                             T::CutoffRelease};
    constexpr std::array<unsigned, 4> filterIndices{2, 4, 5, 6};
    for (auto i = 0u; i < filterTargets.size(); ++i) {
      auto &value = v.filterEnvelopeParameters[filterIndices[i]];
      value = controlled(filterTargets[i], value, value, 0, 100);
    }
    constexpr std::array<Field, 3> lfoFields{AmpLFODelay, PitchLFODelay, FilterLFODelay};
    constexpr std::array<T, 3> lfoDepth{T::AmpLfoDepth, T::PitchLfoDepth, T::CutoffLfoDepth};
    constexpr std::array<T, 3> lfoFrequency{T::AmpLfoFrequency, T::PitchLfoFrequency,
                                            T::CutoffLfoFrequency};
    for (auto lfo = 0u; lfo < 3u; ++lfo) {
      auto *values = v.lfoParameters.data() + 4u * lfo;
      std::copy_n(r + lfoFields[lfo], 4, values);
      values[2] = controlled(lfoFrequency[lfo], values[2], values[2], 0, 30000);
      values[3] = controlled(lfoDepth[lfo], values[3], values[3], -12000, 12000);
    }
    v.ampEnvelope.parametersChanged(v.ampParameters, r[AmpDynamic] != 0.0F);
    for (auto band = 0u; band < 3u; ++band) {
      const auto field = EQ1Frequency + 3u * band, family = EQ1FrequencyCC + 3u * band;
      v.equalizer.configure(band, bounded(r[field] + modulation[family], 0.0F, 30000.0F, 50.0F),
                            bounded(r[field + 1u] + modulation[family + 1u], .001F, 4.0F, 1.0F),
                            bounded(r[field + 2u] + modulation[family + 2u], -96.0F, 24.0F, 0.0F),
                            rate_);
    }
    // MIDI channel volume/expression use the MIDI recommended square-law gain.
    const auto gain = std::pow(10.0F, volume * .05F) * v.channelGain;
    pan = bounded(pan * .01F + v.channelPan, -1, 1, 0);
    v.modGainLeft = gain * (pan > 0 ? 1.0F - pan : 1.0F);
    v.modGainRight = gain * (pan < 0 ? 1.0F + pan : 1.0F);
    const auto cents = pitch + v.channelBend;
    v.step = v.controllerStep = v.baseStep * std::exp2(cents / 1200.0);
    const auto type = static_cast<std::uint32_t>(r[FilterType]);
    v.filterB0 = 1.0F;
    v.filterB1 = v.filterB2 = v.filterA1 = v.filterA2 = 0.0F;
    if (type) {
      cutoff *= std::exp2((v.filterModulation + cutoffCents) / 1200.0F);
      cutoff = controlled(T::Cutoff, cutoff, r[Cutoff], 0, rate_ * .45F);
      resonance = controlled(T::Resonance, resonance, r[Resonance], 0, 40);
      const auto frequency = bounded(cutoff, 5.0F, rate_ * .45F, 20000.0F);
      const auto omega = 6.283185307179586F * frequency / rate_;
      const auto cosine = std::cos(omega), sine = std::sin(omega);
      if (type == 1u || type == 3u) {
        const auto k = std::tan(omega * .5F), scale = 1.0F / (1.0F + k);
        v.filterB0 = type == 1u ? k * scale : scale;
        v.filterB1 = type == 1u ? v.filterB0 : -v.filterB0;
        v.filterA1 = (k - 1.0F) * scale;
      } else {
        const auto q = .70710678F * std::pow(10.0F, bounded(resonance, 0, 40, 0) * .05F);
        const auto alpha = sine / (2.0F * q), scale = 1.0F / (1.0F + alpha);
        if (type == 2u) {
          v.filterB0 = (1.0F - cosine) * .5F;
          v.filterB1 = 1.0F - cosine;
          v.filterB2 = v.filterB0;
        } else if (type == 4u) {
          v.filterB0 = (1.0F + cosine) * .5F;
          v.filterB1 = -(1.0F + cosine);
          v.filterB2 = v.filterB0;
        } else if (type == 5u) {
          v.filterB0 = alpha;
          v.filterB1 = 0;
          v.filterB2 = -alpha;
        } else {
          v.filterB0 = 1;
          v.filterB1 = -2.0F * cosine;
          v.filterB2 = 1;
        }
        v.filterB0 *= scale;
        v.filterB1 *= scale;
        v.filterB2 *= scale;
        v.filterA1 = -2.0F * cosine * scale;
        v.filterA2 = (1.0F - alpha) * scale;
      }
    }
    v.modulationRevision = midi_revision_;
  }
  template <bool Prepared, bool Resampled = false>
  bool renderSf2VoiceSample(Voice &v, const Sf2SpanFacts *span, float &l, float &r,
                            float monoSample = 0.0F) noexcept {
    float amplitude = 1.0F;

    if (!v.retired && v.modulationRevision != midi_revision_)
      refreshSf2Modulation(v);
    if (!v.region)
      return false;
    auto &parameters = v.sf2Parameters;
    if constexpr (Prepared) {
      if (!(span->volumeSustain && v.sf2VolumeEnvelope.sustained()))
        v.envelope = v.sf2VolumeEnvelope.next(parameters.volEnv);
    } else {
      v.envelope = v.sf2VolumeEnvelope.next(parameters.volEnv);
    }
    if (v.sf2VolumeEnvelope.done()) {
      v.region = nullptr;
      return false;
    }
    const auto modEnvelope = Prepared && span->modSustain && v.sf2ModEnvelope.sustained()
                                 ? span->modEnvelope
                                 : v.sf2ModEnvelope.next(parameters.modEnv);
    const auto elapsed = static_cast<double>(v.elapsed) / rate_;
    const auto modLfo = Prepared && span->silentModLfo
                            ? 0.0F
                            : v.sf2ModLfo.next(rate_, parameters.modLfo.frequency,
                                               parameters.modLfo.delay, elapsed);
    const auto vibLfo = Prepared && span->silentVibLfo
                            ? 0.0F
                            : v.sf2VibLfo.next(rate_, parameters.vibLfo.frequency,
                                               parameters.vibLfo.delay, elapsed);
    const auto &g = parameters.generators;
    const auto pitch = modLfo * g[5] + vibLfo * g[6] + modEnvelope * g[7];
    v.step = Prepared && span->fixedPitch ? v.controllerStep
                                          : v.controllerStep * std::exp2(pitch / 1200.0F);
    if ((v.elapsed & 15u) == 0u && !(Prepared && span->fixedFilter))
      configureSf2Lowpass(v, sf2FilterFrequency(parameters, modLfo, modEnvelope),
                          parameters.resonanceDb);
    amplitude = Prepared && span->fixedVolume
                    ? span->attenuation
                    : std::pow(10.0F, (-parameters.attenuationCb + modLfo * g[13]) * .005F);

    const auto *region = v.region;
    const auto *view = Prepared ? &span->source : nullptr;
    auto sampleLeft = Resampled ? monoSample : interpolate(v, 0u, view);
    auto sampleRight =
        Resampled || region[Channels] == 1.0F ? sampleLeft : interpolate(v, 1u, view);
    sampleLeft = v.sf2Lowpass.process(sampleLeft, 0);
    sampleRight = v.sf2Lowpass.process(sampleRight, 1);
    const auto gain = v.envelope * amplitude;
    const auto pan = v.sf2Parameters.pan;
    l = sampleLeft * gain * (Prepared ? span->panLeft : std::sqrt((1.0F - pan) * .5F));
    r = sampleRight * gain * (Prepared ? span->panRight : std::sqrt((1.0F + pan) * .5F));
    return true;
  }
  void advanceVoiceSample(Voice &v, const float *region, float &l, float &r) noexcept {
    bool retirementComplete = false;
    if (v.playbackEnabled && !looping(v)) {
      const auto *settings = playbackPlan(region);
      if (!settings->playCount || v.playbackRepeat.completed + 1 >= settings->playCount) {
        const auto fade =
            playback::fadeout(reverse(v) ? v.position - v.sourceFirst : v.sourceLast - v.position,
                              effectiveSourceStep(v), rate_,
                              playbackValue(v, modulationState(v), *settings,
                                            playback::Slot::Fadeout, settings->fadeoutSeconds));
        l *= fade;
        r *= fade;
      }
    }
    if (v.retireFrames) {
      const auto scale = v.retireGain * retirementGain(v);
      l *= scale;
      r *= scale;
      retirementComplete = --v.retireFrames == 0u;
    }
    if (v.filterTransition != 0u)
      --v.filterTransition;
    ++v.elapsed;
    for (auto lfo = 0u; !bank()->sf2_ && !bank()->modulation_ && lfo < 3u; ++lfo) {
      const auto *parameters = v.lfoParameters.data() + 4u * lfo;
      if (static_cast<double>(v.elapsed) / rate_ >= parameters[0]) {
        v.lfoPhase[lfo] += 6.283185307179586 * parameters[2] / rate_;
        if (v.lfoPhase[lfo] >= 6.283185307179586)
          v.lfoPhase[lfo] = std::fmod(v.lfoPhase[lfo], 6.283185307179586);
      }
    }
    if (v.released)
      ++v.releaseElapsed;
    if (v.playbackEnabled)
      advancePlayback(v);
    else {
      v.position += region[Direction] == 1.0F ? -v.step : v.step;
      if (looping(v)) {
        const auto start = indexValue(region, LoopStart);
        const auto end = indexValue(region, LoopEnd) + 1.0;
        if (v.position >= end && region[Direction] == 0.0F) {
          v.looped = true;
          v.position = start + std::fmod(v.position - start, end - start);
          ++v.loopRepeats;
        }
        if (region[Direction] == 1.0F && v.position < start) {
          v.looped = true;
          v.position = end - std::fmod(start - v.position, end - start);
          ++v.loopRepeats;
        }
      }
    }
    if (retirementComplete || v.position >= boundary(v, End) + 1.0 ||
        (reverse(v) && v.position < boundary(v, Offset)) || (v.released && v.envelope <= 0.0F))
      v.region = nullptr;
  }
  void finishVoiceSample(Voice &v, const float *effectRegion, float l, float r, float &left,
                         float &right) noexcept {
    if (v.fade) {
      const auto weight = static_cast<float>(v.fade--) / fade_length_;
      l = l * (1.0F - weight) + v.stolenLeft * weight;
      r = r * (1.0F - weight) + v.stolenRight * weight;
    }
    if constexpr (Midi) {
      const auto channel = 1u << v.channel;
      if ((mixer_mute_ & channel) || (mixer_solo_ && !(mixer_solo_ & channel)))
        l = r = 0.0F;
    }
    if (bank() && bank()->sf2_ && sf2_frame_ < sf2_block_frames_) {
      const auto frames = sf2_block_frames_, frame = sf2_frame_;
      const auto chorus = v.sf2Parameters.chorusSend, reverb = v.sf2Parameters.reverbSend;
      sf2_sends_.data()[frame] += l * chorus;
      sf2_sends_.data()[frames + frame] += r * chorus;
      sf2_sends_.data()[2u * frames + frame] += l * reverb;
      sf2_sends_.data()[3u * frames + frame] += r * reverb;
      sf2_has_sends_ = sf2_has_sends_ || ((l != 0.0F || r != 0.0F) && (chorus > 0 || reverb > 0));
    }
    v.lastLeft = l;
    v.lastRight = r;
    if constexpr (Midi)
      if (midi_meters_.enabled())
        midi_meters_.add(v.channel, sf2_frame_, l, r);
    if (sfz_quantum_started_ && effectRegion) {
      const auto index = static_cast<std::uint32_t>((effectRegion - bank()->region(0)) / kStride);
      const auto routing = bank()->sfz_effect_plan_->region(index);
      if (!bank()->sfz_effects_->voiceMix(sf2_frame_, routing.output, routing.sends, l, r))
        bank()->failAsset();
      return;
    }
    left += l;
    right += r;
  }
  void renderVoice(Voice &v, float &left, float &right) noexcept {
    const auto *effectRegion = v.region;
    float l = 0.0F, r = 0.0F;
    std::span<float> modulationParameters;
    if (v.region && !v.historyOnly) {
      const auto *region = v.region;
      auto *note = voiceScriptNote(v);
      const auto automation = note              ? note->automation.values(midi_clock_)
                              : v.retiredScript ? v.retiredAutomation
                                                : script::VoiceAutomationValues{};
      if (note && note->automation.shouldStop(midi_clock_)) {
        note->keyDown = false;
        for (auto &scheduled : script_session_->scheduled)
          if (scheduled.id == note->id)
            scheduled.id = 0;
        v.region = nullptr;
        return;
      }
      if (v.playbackEnabled &&
          !playback::tickTiming(v.playbackTiming, playbackPpq(), 1.0 / rate_)) {
        if (v.playbackTiming.cancelled)
          v.region = nullptr;
        return;
      }
      float amplitude = 1.0F;
      if (bank()->sf2_) {
        if (!renderSf2VoiceSample<false>(v, nullptr, l, r))
          return;
      } else if (bank()->modulation_) {
        if (v.delayFrames) {
          --v.delayFrames;
          return;
        }
        modulationParameters = tickModulationVoice(v);
        if (v.modulationWaiting && !automation.gainFinal)
          return;
        if (v.modulationDone && (!automation.gainFinal || v.released)) {
          v.region = nullptr;
          return;
        }
        const auto &plan = modulationPlan(v);
        const auto pitch = modulationParameters[plan.regionParameters[2]] + v.channelBend +
                           modulationParameters[schema::parameterRank(
                               0, static_cast<std::uint32_t>(schema::Property::ScopeTune))];
        v.step =
            v.baseStep *
            (pitch == 0 ? 1 : bank()->modulation_->pitchRatio(modulationRegionIndex(v), pitch)) *
            automation.tuneRelative;
        if (automation.tuneAbsolute != 0) {
          const auto nominalStep =
              region[Rate] / rate_ *
              std::exp2((static_cast<double>(v.outputMidi) - region[KeyCenter]) / 12.0);
          v.step += nominalStep * automation.tuneAbsolute;
        }
      } else {
        {
          if (!v.retired && v.modulationRevision != midi_revision_)
            refreshMidiModulation(v);
          if (v.delayFrames) {
            --v.delayFrames;
            return;
          }
          const auto pitch =
              voiceEnvelope(v, PitchEGDelay, v.pitchReleaseStart) * region[PitchEGDepth] +
              voiceLFO(v, PitchLFODelay);
          const auto nominalStep =
              region[Rate] / rate_ *
              std::exp2((static_cast<double>(v.outputMidi) - region[KeyCenter]) / 12.0);
          v.step = v.controllerStep * std::exp2(pitch / 1200.0F) * automation.tuneRelative +
                   nominalStep * automation.tuneAbsolute;
          if (region[FilterEGDepth] != 0.0F || region[FilterLFODepth] != 0.0F) {
            v.filterModulation =
                voiceEnvelope(v, FilterEGDelay, v.filterReleaseStart) * region[FilterEGDepth] +
                voiceLFO(v, FilterLFODelay);
            if ((v.elapsed + v.age) % 16u == 0u)
              refreshMidiModulation(v);
          }
        }
        {
          v.envelope = v.ampEnvelope.next(v.ampParameters);
          if (v.ampEnvelope.waiting() && !automation.gainFinal)
            return;
          if (v.ampEnvelope.done() && (!automation.gainFinal || v.released)) {
            v.region = nullptr;
            return;
          }
        }
      }
      if (!bank()->sf2_) {
        float sample_left = 0, sample_right = 0;
        if (!renderOscillatorSource(v, sample_left, sample_right)) {
          sample_left = interpolate(v, 0u);
          sample_right = region[Channels] == 1.0F ? sample_left : interpolate(v, 1u);
        }
        if (!bank()->sf2_ && !bank()->modulation_)
          amplitude = std::pow(10.0F, voiceLFO(v, AmpLFODelay) * .05F);
        if (bank()->modulation_) {
          const auto slot = v.modulationSlot;
          const auto &plan = modulationPlan(v);
          const auto view = bank()->modulation_->region(modulationRegionIndex(v));
          const auto value = [&](std::uint32_t instance, schema::Kind kind,
                                 schema::Property property) {
            return modulationParameters[view.instances[instance].firstParameter +
                                        schema::parameterRank(
                                            static_cast<std::uint32_t>(kind),
                                            static_cast<std::uint32_t>(property))];
          };
          if (plan.noiseInstance != UINT32_MAX) {
            const auto noise = [&](schema::Property property) {
              return value(plan.noiseInstance, schema::Kind::NoiseLayer, property);
            };
            if (!bank()->modulation_->state.noiseState(slot).process(
                    sample_left, sample_right, rate_,
                    std::pow(10.0F, noise(schema::Property::NoiseLevel) * .05F),
                    noise(schema::Property::NoiseTone) * .01F,
                    static_cast<unsigned>(noise(schema::Property::NoiseStep)),
                    noise(schema::Property::NoiseStereo) != 0,
                    static_cast<unsigned>(noise(schema::Property::NoiseFilter)),
                    bank()->combStorage(slot, 2u), bank()->combJournal(slot, 2u))) {
              bank()->failAsset();
              return;
            }
          }
          bool filtersValid = true;
          const auto filter = [&](unsigned stage, float &left, float &right) {
            if (filtersValid)
              filtersValid = v.sfzFilters[stage].process(
                  left, right, bank()->combStorage(slot, stage), bank()->combJournal(slot, stage));
          };
          if (plan.voiceDspInstance != UINT32_MAX) {
            const auto dsp = [&](schema::Property property) {
              return value(plan.voiceDspInstance, schema::Kind::VoiceDSP, property);
            };
            const auto result = bank()->modulation_->state.voiceDspState(slot).process(
                static_cast<unsigned>(dsp(schema::Property::DspOrder)), {sample_left, sample_right},
                rate_, dsp(schema::Property::Drive), dsp(schema::Property::BitReduction),
                dsp(schema::Property::Decimation), filter);
            sample_left = result.left;
            sample_right = result.right;
          } else {
            filter(0u, sample_left, sample_right);
            filter(1u, sample_left, sample_right);
          }
          if (!filtersValid) {
            bank()->failAsset();
            return;
          }
          v.equalizer.process(sample_left, sample_right);
        } else {
          const auto filter = [&v](float input, float &z1, float &z2) {
            const auto output = v.filterB0 * input + z1;
            z1 = v.filterB1 * input - v.filterA1 * output + z2;
            z2 = v.filterB2 * input - v.filterA2 * output;
            return output;
          };
          sample_left = filter(sample_left, v.filterZ1Left, v.filterZ2Left);
          sample_right = filter(sample_right, v.filterZ1Right, v.filterZ2Right);
          v.equalizer.process(sample_left, sample_right);
        }
        if (bank()->modulation_) {
          const auto &plan = modulationPlan(v);
          const auto property = [&](unsigned slot) {
            return modulationParameters[plan.regionParameters[slot]];
          };
          const auto view = bank()->modulation_->region(modulationRegionIndex(v));
          const bool noiseStereo =
              plan.noiseInstance != UINT32_MAX &&
              modulationParameters[view.instances[plan.noiseInstance].firstParameter +
                                   schema::parameterRank(
                                       static_cast<unsigned>(schema::Kind::NoiseLayer),
                                       static_cast<unsigned>(schema::Property::NoiseStereo))] != 0;
          if (region[Channels] == 2 || noiseStereo) {
            const auto mid = .5F * (sample_left + sample_right),
                       side = .5F * (sample_left - sample_right) * property(4) * .01F;
            sample_left = mid + side;
            sample_right = mid - side;
            const auto rawPosition = property(5) + v.amplifierPosition;
            const auto position = static_cast<float>((rawPosition < -100  ? -100
                                                      : rawPosition > 100 ? 100
                                                                          : rawPosition) *
                                                     .01);
            sample_left *= position > 0 ? 1 - position : 1;
            sample_right *= position < 0 ? 1 + position : 1;
          }
          const auto baseGain = v.gainLeft;
          const auto volume = property(0);
          auto velocityGain = v.velocityGain;
          if (v.velocityTrackDynamic) {
            const auto track = modulationParameters[v.velocityTrackSlot];
            velocityGain = amplifier::velocityResponse(v.velocityCurveGain,
                                                       track * .01F + v.velocityTrackRandomOffset);
          }
          const auto instrumentGain = baseGain * v.channelGain * v.scopeGain * velocityGain *
                                      (volume == 0 ? 1 : std::pow(10.0F, volume * .05F)) *
                                      property(1) * .01F *
                                      modulationCrossfade(v, modulationParameters);
          const auto gain = automation.gainRelative * instrumentGain + automation.gainAbsolute;
          const auto patchPan = (property(3) + v.amplifierPan) * .01 + v.channelPan;
          const auto targetPan = patchPan * automation.panRelative + automation.panAbsolute;
          const auto pan = targetPan < -1 ? -1 : targetPan > 1 ? 1 : targetPan;
          const auto panGains = amplifier::panGains(static_cast<float>(pan * 100), v.panLaw);
          l = static_cast<float>(sample_left * gain * v.phaseGain * panGains.left);
          r = static_cast<float>(sample_right * gain * v.phaseGain * panGains.right);
        } else if (note || v.retiredScript) {
          const auto baseGain =
              std::abs(v.gainLeft) > std::abs(v.gainRight) ? v.gainLeft : v.gainRight;
          const auto modGain = v.modGainLeft > v.modGainRight ? v.modGainLeft : v.modGainRight;
          const auto gain = automation.gainRelative * baseGain * modGain * v.envelope * amplitude +
                            automation.gainAbsolute;
          const auto patchPan = region[Pan] * .01 + v.channelPan + v.controlModulation[PanCC] * .01;
          const auto targetPan = patchPan * automation.panRelative + automation.panAbsolute;
          const auto pan = targetPan < -1 ? -1 : targetPan > 1 ? 1 : targetPan;
          l = static_cast<float>(sample_left * gain * (pan > 0 ? 1 - pan : 1));
          r = static_cast<float>(sample_right * gain * (pan < 0 ? 1 + pan : 1));
        } else {
          l = sample_left * v.gainLeft * v.modGainLeft * v.envelope * amplitude;
          r = sample_right * v.gainRight * v.modGainRight * v.envelope * amplitude;
        }
      }
      advanceVoiceSample(v, region, l, r);
    }
    finishVoiceSample(v, effectRegion, l, r, left, right);
  }
  std::unique_ptr<std::array<et_midi_event, 4096>> midi_events_;
  std::unique_ptr<std::array<std::array<char, 128>, 8>> script_messages_;
  std::unique_ptr<ScriptSession> script_session_;
  std::unique_ptr<std::array<Voice, kVoices>> paused_voices_;
  std::unique_ptr<std::array<MidiChannel, 16>> midi_channels_;
  std::unique_ptr<std::array<MidiChannel, 16>> forecast_channels_;
  bool forecast_valid_ = false;
  bool forecast_admission_ = false, forecast_applied_ = false, readiness_acknowledged_ = false;
  bool forecast_input_invalidated_ = false;
  std::uint32_t forecast_window_ = 0, forecast_offset_ = 0, forecast_last_offset_ = 0;
  std::uint32_t forecast_scope_ = ET_STREAM_SCOPE_NONE;
  std::uint64_t forecast_anchor_ = 0, readiness_end_ = 0;
  et_stream_readiness stream_readiness_{};
  std::unique_ptr<analyzer::SpectralAnalysis> analysis_;
  std::unique_ptr<std::array<Voice, kVoices>> voices_;
  MidiChannelMeter midi_meters_;
  std::unique_ptr<SampleResamplingTables> resampling_tables_;
  NothrowStorage<float> dry_, wet_;
  std::unique_ptr<PreparedAsset> bank_;
  NothrowStorage<float> sf2_sends_, sf2_fx_delay_;
  std::unique_ptr<Trial> offline_trial_;
  MidiTransportMap midi_transport_map_;
  std::unique_ptr<std::array<std::array<float, 156>, 16>> modulation_sources_;
  std::unique_ptr<std::array<VoiceFilter, 2>> modulation_filter_cache_;
  const SFZBank *modulation_cache_bank_ = nullptr;
  std::uint32_t modulation_cache_revision_ = UINT32_MAX, modulation_keys_down_ = 0;
  std::uint64_t modulation_cache_clock_ = UINT64_MAX;
  std::uint32_t modulation_block_frame_ = 0;
  double modulation_cache_time_ = std::numeric_limits<double>::quiet_NaN();
  HostTransport modulation_host_transport_{};
  bool modulation_host_transport_valid_ = false;
  struct SampleMiss {
    bool valid = false;
    std::uint64_t generation = 0, frame = 0, clock = 0;
    std::uint32_t sample = 0, channel = 0;
  };
  SampleMiss block_miss_{}, first_miss_{};
  std::uint64_t underrun_quanta_ = 0, underrun_frames_ = 0;
  std::uint32_t availability_generation_ = 0;
  // UI/host session controls, intentionally outside checkpointed RenderState.
  std::uint16_t mixer_mute_ = 0, mixer_solo_ = 0;
  bool availability_missing_ = false;
  bool offline_rendering_ = false, sample_missing_ = false, sample_invalid_ = false,
       sf2_spans_ = false;
  std::uint32_t sf2_span_first_ = 0, block_miss_frame_ = UINT32_MAX;
};

} // namespace effetune::plugins::others

#endif

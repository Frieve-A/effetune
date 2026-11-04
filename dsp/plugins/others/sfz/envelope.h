#ifndef EFFETUNE_SFZ_ENVELOPE_H
#define EFFETUNE_SFZ_ENVELOPE_H
#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::others::sfz {
// The same staged state can serve amplitude and modulation envelopes. Values are
// normalized; durations are seconds. Parameter sampling belongs to stage entry,
// except that a dynamic envelope also responds to controller changes in its active stage.
struct EnvelopeParameters {
  enum Index : std::uint32_t { Delay, Start, Attack, Hold, Decay, Sustain, Release, Count };
  std::array<float, Count> value{};
  float operator[](Index index) const noexcept { return value[index]; }
};

class Envelope {
public:
  enum class Stage : std::uint8_t { Delay, Attack, Hold, Decay, Sustain, Release, Done };
  void reset(const EnvelopeParameters &parameters, float rate) noexcept {
    rate_ = rate;
    current_ = 0.0F;
    forced_ = false;
    enter(Stage::Delay, parameters);
  }
  void release(const EnvelopeParameters &parameters) noexcept {
    if (stage_ != Stage::Done) {
      forced_ = false;
      enter(Stage::Release, parameters);
    }
  }
  void forceRelease(float seconds) noexcept {
    if (stage_ == Stage::Done)
      return;
    forced_ = true;
    stage_ = Stage::Release;
    elapsed_ = 0.0;
    duration_ = seconds * rate_;
    target_ = 0.0F;
    configureSlope();
  }
  void parametersChanged(const EnvelopeParameters &parameters, bool dynamic) noexcept {
    if (!dynamic || forced_ || stage_ == Stage::Done)
      return;
    const auto duration = stageDuration(stage_, parameters) * rate_;
    const auto target = stageTarget(stage_, parameters);
    if (duration != duration_ || target != target_) {
      duration_ = duration;
      target_ = target;
      configureSlope();
      if (stage_ == Stage::Sustain)
        current_ = target_;
    }
  }
  float next(const EnvelopeParameters &parameters) noexcept {
    for (auto transitions = 0u; transitions < 7u; ++transitions) {
      if (stage_ == Stage::Done)
        return 0.0F;
      if (stage_ == Stage::Sustain) {
        if (current_ == 0.0F)
          stage_ = Stage::Done;
        return current_;
      }
      if (elapsed_ < duration_)
        break;
      current_ = target_;
      if (stage_ == Stage::Release) {
        stage_ = Stage::Done;
        return 0.0F;
      }
      enter(static_cast<Stage>(static_cast<unsigned>(stage_) + 1u), parameters);
    }
    const auto result = stage_ == Stage::Delay ? 0.0F : current_;
    if (stage_ == Stage::Attack)
      current_ += slope_;
    else if (stage_ == Stage::Decay || stage_ == Stage::Release)
      current_ = target_ + (current_ - target_) * multiplier_;
    ++elapsed_;
    if (stage_ == Stage::Release) {
      if (elapsed_ >= duration_) {
        stage_ = Stage::Done;
        return 0.0F;
      }
      return current_;
    }
    return result;
  }
  bool waiting() const noexcept { return stage_ == Stage::Delay; }
  bool done() const noexcept { return stage_ == Stage::Done; }

private:
  static float stageDuration(Stage stage, const EnvelopeParameters &p) noexcept {
    switch (stage) {
    case Stage::Delay:
      return p[EnvelopeParameters::Delay];
    case Stage::Attack:
      return p[EnvelopeParameters::Attack];
    case Stage::Hold:
      return p[EnvelopeParameters::Hold];
    case Stage::Decay:
      return p[EnvelopeParameters::Decay];
    case Stage::Release:
      return p[EnvelopeParameters::Release];
    default:
      return 0.0F;
    }
  }
  static float stageTarget(Stage stage, const EnvelopeParameters &p) noexcept {
    return stage == Stage::Attack || stage == Stage::Hold ? 1.0F
           : stage == Stage::Decay || stage == Stage::Sustain
               ? p[EnvelopeParameters::Sustain] * .01F
               : 0.0F;
  }
  void enter(Stage stage, const EnvelopeParameters &parameters) noexcept {
    stage_ = stage;
    elapsed_ = 0.0;
    duration_ = stageDuration(stage, parameters) * rate_;
    target_ = stageTarget(stage, parameters);
    if (stage == Stage::Attack)
      current_ = parameters[EnvelopeParameters::Start] * .01F;
    else if (stage == Stage::Hold || stage == Stage::Sustain)
      current_ = target_;
    configureSlope();
  }
  void configureSlope() noexcept {
    const auto remaining = duration_ > elapsed_ ? duration_ - elapsed_ : 1.0;
    slope_ = static_cast<float>((target_ - current_) / remaining);
    multiplier_ = static_cast<float>(std::exp(-9.210340371976184 / remaining));
  }
  Stage stage_ = Stage::Done;
  bool forced_ = false;
  float rate_ = 48000.0F, current_ = 0.0F, target_ = 0.0F, slope_ = 0.0F, multiplier_ = 0.0F;
  double elapsed_ = 0.0, duration_ = 0.0;
};
} // namespace effetune::plugins::others::sfz
#endif

#ifndef EFFETUNE_SFZ_VOICE_DSP_H
#define EFFETUNE_SFZ_VOICE_DSP_H
#include "sfz_dsp_order.h"
#include "sfz_effect_distortion.h"
#include "sfz_effect_lofi.h"
#include <type_traits>

namespace effetune::plugins::others::sfz {
struct StereoFrame {
  float left = 0, right = 0;
  StereoFrame operator+(const StereoFrame &other) const noexcept {
    return {left + other.left, right + other.right};
  }
};
// The public SFZ surface does not expose Rapture program DSP-slot selectors.
// This standalone profile binds drive, bit reduction and decimation to DSP1,
// DSP2 and DSP3 respectively. F1/F2 retain the engine's existing filter states.
struct VoiceDsp {
  EffectDistortion drive;
  EffectLofi bitReduction, decimation;

  void reset() noexcept {
    drive.reset();
    bitReduction.reset();
    decimation.reset();
  }
  template <class ProcessFilter>
  StereoFrame process(unsigned order, StereoFrame input, float rate, float drivePercent,
                      float bitReductionPercent, float decimationPercent,
                      ProcessFilter &&filter) noexcept {
    return routeVoiceDsp(order, input, [&](unsigned stage, StereoFrame frame) {
      switch (stage) {
      case 0:
        drive.process(frame.left, frame.right, rate, percent(drivePercent), 1, 1, 0, 1);
        break;
      case 1:
        bitReduction.process(frame.left, frame.right, percent(bitReductionPercent), 0);
        break;
      case 2:
        decimation.process(frame.left, frame.right, 0, percent(decimationPercent));
        break;
      default:
        filter(stage - 3, frame.left, frame.right);
        break;
      }
      return frame;
    });
  }

private:
  static float percent(float value) noexcept {
    return value < 0 ? 0 : value > 100 ? 1 : value * .01F;
  }
};
static_assert(std::is_trivially_copyable_v<VoiceDsp>);
} // namespace effetune::plugins::others::sfz
#endif

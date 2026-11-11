#ifndef EFFETUNE_SF2_EFFECTS_H
#define EFFETUNE_SF2_EFFECTS_H
#include "effetune/dsp/effect_storage_geometry.h"
#include "effetune/kernel.h"
#include "nothrow_storage.h"
#include "sfz_effect_activity.h"
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_ChorusPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_FDNReverbPlugin() noexcept;

namespace effetune::plugins::others::sfz::sf2 {

// SoundFont specifies send controls, not the effects algorithms. Reuse the
// application's own stereo chorus and FDN reverb with fixed wet-only settings.
class Effects {
public:
  static std::uint64_t storageBytes(const PrepareInfo &info) noexcept {
    if (!std::isfinite(info.sampleRate) || info.sampleRate < 1 || info.sampleRate > 768000 ||
        !info.maxFrames)
      return 0;
    return sizeof(Effects) +
           dsp::effectKernelStorageUnits(et_kernel_descriptor_ChorusPlugin()->objectSize) *
               sizeof(std::max_align_t) +
           dsp::chorusStorageBytes(info.sampleRate, 2) +
           dsp::effectKernelStorageUnits(et_kernel_descriptor_FDNReverbPlugin()->objectSize) *
               sizeof(std::max_align_t) +
           dsp::fdnStorageBytes(info.sampleRate);
  }
  bool prepare(const PrepareInfo &info,
               std::uint64_t maximumBytes = std::numeric_limits<std::uint64_t>::max()) {
    prepared_ = false;
    const auto required = storageBytes(info);
    if (!required || required > maximumBytes)
      return false;
    const PrepareInfo stereo{info.sampleRate, 2, info.maxFrames};
    // Tuned against FluidSynth 2.6.2 defaults at full send: equal wet/dry
    // energy, 3-voice 0.2 Hz chorus, and a reverb decaying about 23 dB/s.
    constexpr std::array<float, 8> chorus{1, .2F, 15, 4.25F, 3, 100, 0, 100};
    constexpr std::array<float, 13> reverb{3, 8, 5, 27, 24, 0, 20, 3, .3F, 100, 52, 0, 200};
    if (!chorus_.prepare(et_kernel_descriptor_ChorusPlugin(), stereo, chorus.data(),
                         chorus.size()) ||
        !reverb_.prepare(et_kernel_descriptor_FDNReverbPlugin(), stereo, reverb.data(),
                         reverb.size()))
      return false;
    maxFrames_ = info.maxFrames;
    // Longer than the configured effects' longest delay, so gaps between echoes
    // do not end a tail. Audio below -140 dB for this interval is inaudible.
    quietLimit_ = static_cast<std::uint64_t>(std::ceil(info.sampleRate * kEffectQuietSeconds));
    prepared_ = true;
    return true;
  }

  void reset() noexcept {
    chorus_.reset();
    reverb_.reset();
  }
  [[nodiscard]] bool active() const noexcept { return chorus_.active || reverb_.active; }

  // Each input is tightly packed planar stereo (2 * frames). The caller supplies
  // independent preallocated sends and invokes this only after committing its
  // sample-read trial. Outputs contain wet returns; add them before host gain.
  void process(float *chorus, float *reverb, std::uint32_t frames,
               const ProcessInfo &info) noexcept {
    if (!prepared_ || !chorus || !reverb || !frames || frames > maxFrames_)
      return;
    chorus_.process(chorus, frames, quietLimit_, info);
    // The chorus kernel's wet mix tops out near -3.5 dB; FluidSynth returns +6 dB.
    if (chorus_.active)
      for (std::size_t i = 0; i < static_cast<std::size_t>(frames) * 2; ++i)
        chorus[i] *= kChorusReturnGain;
    reverb_.process(reverb, frames, quietLimit_, info);
  }

private:
  static constexpr float kChorusReturnGain = 3;
  struct Effect {
    NothrowStorage<std::max_align_t> storage;
    const KernelDescriptor *descriptor = nullptr;
    PluginKernel *kernel = nullptr;
    std::uint64_t quietFrames = 0;
    bool active = false;

    ~Effect() { destroy(); }
    void destroy() noexcept {
      if (kernel)
        descriptor->destroy(kernel);
      kernel = nullptr;
      storage.release();
    }
    bool prepare(const KernelDescriptor *next, const PrepareInfo &info, const float *parameters,
                 std::size_t count) {
      destroy();
      if (!next || next->objectAlignment > alignof(std::max_align_t) ||
          !storage.allocate(dsp::effectKernelStorageUnits(next->objectSize)))
        return false;
      descriptor = next;
      kernel = descriptor->construct(storage.data());
      if (!kernel)
        return false;
      kernel->prepare(info);
      if (!kernel->preparedSuccessfully() ||
          kernel->stageParameters(parameters, static_cast<std::uint32_t>(count),
                                  descriptor->paramsHash) != ET_OK)
        return false;
      kernel->applyPendingParameters();
      reset();
      return true;
    }
    void reset() noexcept {
      if (kernel)
        kernel->reset();
      active = false;
      quietFrames = 0;
    }
    void process(float *audio, std::uint32_t frames, std::uint64_t quietLimit,
                 const ProcessInfo &info) noexcept {
      bool input = false;
      for (std::size_t i = 0; i < static_cast<std::size_t>(frames) * 2; ++i)
        input = input || audio[i] != 0;
      if (!input && !active)
        return;
      kernel->process(audio, 2, frames, info);
      bool audible = input;
      for (std::size_t i = 0; i < static_cast<std::size_t>(frames) * 2; ++i)
        audible = audible || effectOutputAudible(audio[i]);
      quietFrames = audible ? 0 : quietFrames + frames;
      active = quietFrames < quietLimit;
      if (!active)
        reset();
    }
  };
  Effect chorus_, reverb_;
  std::uint32_t maxFrames_ = 0;
  std::uint64_t quietLimit_ = 0;
  bool prepared_ = false;
};
} // namespace effetune::plugins::others::sfz::sf2
#endif

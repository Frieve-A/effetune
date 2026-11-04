#ifndef EFFETUNE_SFZ_EFFECT_REVERB_H
#define EFFETUNE_SFZ_EFFECT_REVERB_H
#include "effetune/dsp/denormal.h"
#include "effetune/dsp/effect_storage_geometry.h"
#include "effetune/kernel.h"
#include "nothrow_storage.h"
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_ChorusPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_FDNReverbPlugin() noexcept;

namespace effetune::plugins::others::sfz {
// Storage adapter for the two existing project kernels used by SFZ effects.
// The SF2 wrapper and its fixed sends retain their own established profile.
class PreparedEffectKernel {
public:
  static std::uint64_t storageBytes(const KernelDescriptor *descriptor) noexcept {
    return dsp::effectKernelStorageUnits(descriptor->objectSize) * sizeof(std::max_align_t);
  }
  ~PreparedEffectKernel() { destroy(); }
  bool prepare(const KernelDescriptor *descriptor, const PrepareInfo &info,
               std::span<const float> parameters) {
    destroy();
    if (!descriptor || descriptor->objectAlignment > alignof(std::max_align_t) ||
        !storage_.allocate(dsp::effectKernelStorageUnits(descriptor->objectSize)))
      return false;
    descriptor_ = descriptor;
    kernel_ = descriptor->construct(storage_.data());
    if (!kernel_)
      return false;
    kernel_->prepare({info.sampleRate, 2, info.maxFrames});
    return kernel_->preparedSuccessfully() && configure(parameters);
  }
  bool configure(std::span<const float> parameters) noexcept {
    if (!kernel_ ||
        kernel_->stageParameters(parameters.data(), static_cast<std::uint32_t>(parameters.size()),
                                 descriptor_->paramsHash) != ET_OK)
      return false;
    kernel_->applyPendingParameters();
    return true;
  }
  void reset() noexcept {
    if (kernel_)
      kernel_->reset();
  }
  void process(float &left, float &right, const ProcessInfo &info) noexcept {
    float audio[2]{left, right};
    if (kernel_)
      kernel_->process(audio, 2, 1, info);
    left = audio[0];
    right = audio[1];
  }

private:
  void destroy() noexcept {
    if (kernel_)
      descriptor_->destroy(kernel_);
    kernel_ = nullptr;
    storage_.release();
  }
  NothrowStorage<std::max_align_t> storage_;
  const KernelDescriptor *descriptor_ = nullptr;
  PluginKernel *kernel_ = nullptr;
};

class EffectChorus {
public:
  static std::uint64_t storageBytes(double rate) noexcept {
    return PreparedEffectKernel::storageBytes(et_kernel_descriptor_ChorusPlugin()) +
           dsp::chorusStorageBytes(rate, 2);
  }
  bool prepare(const PrepareInfo &info) {
    constexpr std::array<float, 8> parameters{1, .65F, 15, 4, 2, 80, 0, 100};
    return kernel_.prepare(et_kernel_descriptor_ChorusPlugin(), info, parameters);
  }
  void reset() noexcept { kernel_.reset(); }
  void process(float &left, float &right, const ProcessInfo &info) noexcept {
    kernel_.process(left, right, info);
  }

private:
  PreparedEffectKernel kernel_;
};

struct EffectReverbParameters {
  float damp = .5F, dry = 1, input = 1, predelay = .01F, size = .5F, tone = .5F, wet = .3F;
  unsigned type = 0;
};
class EffectReverb {
public:
  static std::uint32_t predelayFrames(double rate) noexcept {
    return static_cast<std::uint32_t>(std::ceil(rate)) + 2;
  }
  static std::uint64_t storageBytes(double rate) noexcept {
    return PreparedEffectKernel::storageBytes(et_kernel_descriptor_FDNReverbPlugin()) +
           dsp::fdnStorageBytes(rate) + 2ull * predelayFrames(rate) * sizeof(float);
  }
  bool prepare(const PrepareInfo &info) {
    if (!std::isfinite(info.sampleRate) || info.sampleRate <= 0)
      return false;
    rate_ = static_cast<float>(info.sampleRate);
    frames_ = predelayFrames(rate_);
    if (!delay_.allocate(static_cast<std::size_t>(frames_) * 2))
      return false;
    parameters_ = kernelParameters({});
    if (!kernel_.prepare(et_kernel_descriptor_FDNReverbPlugin(), info, parameters_))
      return false;
    reset();
    return true;
  }
  void reset() noexcept {
    kernel_.reset();
    delay_.clear();
    position_ = 0;
    tone_ = {};
  }
  void process(float &left, float &right, const EffectReverbParameters &p,
               const ProcessInfo &info) noexcept {
    left = dsp::flushSubnormal(left);
    right = dsp::flushSubnormal(right);
    const auto parameters = kernelParameters(p);
    if (parameters != parameters_) {
      kernel_.configure(parameters);
      parameters_ = parameters;
    }
    const float originalLeft = left, originalRight = right;
    const float coefficient = static_cast<float>(
        1 - std::exp(-6.283185307179586 * (20000 * std::pow(.01, 1 - p.tone)) / rate_));
    const auto channel = [&](float input, unsigned index) {
      tone_[index] =
          dsp::flushSubnormal(tone_[index] + coefficient * (input * p.input - tone_[index]));
      auto *storage = delay_.data() + index * frames_;
      storage[position_] = p.tone == 1 ? input * p.input : tone_[index];
      const float distance = p.predelay * rate_;
      const auto age = static_cast<std::uint32_t>(distance);
      const float fraction = distance - age;
      return storage[(position_ + frames_ - age) % frames_] * (1 - fraction) +
             storage[(position_ + frames_ - age - 1) % frames_] * fraction;
    };
    left = channel(left, 0);
    right = channel(right, 1);
    position_ = (position_ + 1) % frames_;
    kernel_.process(left, right, info);
    left = dsp::flushSubnormal(originalLeft * p.dry + left * p.wet);
    right = dsp::flushSubnormal(originalRight * p.dry + right * p.wet);
  }

private:
  static std::array<float, 13> kernelParameters(const EffectReverbParameters &p) noexcept {
    // Room choices adjust the project's delay scale and decay time. These are
    // the declared EffeTune profile, not proprietary engine measurements.
    constexpr std::array<float, 7> scale{.6F, .25F, .4F, .6F, .7F, .85F, 1};
    const auto size = scale[p.type < scale.size() ? p.type : 0] * p.size;
    return {.2F + 9.8F * size,
            8,
            0,
            10 + 50 * size,
            5 + 20 * size,
            12 * p.damp,
            20,
            3,
            .3F,
            100,
            100,
            0,
            100};
  }
  PreparedEffectKernel kernel_;
  NothrowStorage<float> delay_;
  std::array<float, 13> parameters_{};
  std::array<float, 2> tone_{};
  float rate_ = 0;
  std::uint32_t frames_ = 0, position_ = 0;
};
} // namespace effetune::plugins::others::sfz
#endif

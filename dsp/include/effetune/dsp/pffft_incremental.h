#ifndef EFFETUNE_DSP_PFFFT_INCREMENTAL_H
#define EFFETUNE_DSP_PFFFT_INCREMENTAL_H

#include "pffft.h"

namespace effetune::dsp {

class PffftOrderedRealForward final {
public:
  explicit PffftOrderedRealForward(PFFFT_Setup *setup, int workBudget = 256) noexcept
      : state_(pffft_new_ordered_real_forward(setup)) {
    if (state_ != nullptr && pffft_ordered_real_forward_set_work_budget(state_, workBudget) == 0) {
      pffft_destroy_ordered_real_forward(state_);
      state_ = nullptr;
    }
  }

  ~PffftOrderedRealForward() { pffft_destroy_ordered_real_forward(state_); }

  PffftOrderedRealForward(const PffftOrderedRealForward &) = delete;
  PffftOrderedRealForward &operator=(const PffftOrderedRealForward &) = delete;

  [[nodiscard]] bool valid() const noexcept { return state_ != nullptr; }

  [[nodiscard]] bool begin(const float *input, float *output, float *work) noexcept {
    return pffft_ordered_real_forward_begin(state_, input, output, work) != 0;
  }

  [[nodiscard]] bool beginUnorderedForward(const float *input, float *output,
                                           float *work) noexcept {
    return pffft_unordered_real_forward_begin(state_, input, output, work) != 0;
  }

  [[nodiscard]] bool beginUnorderedBackward(const float *input, float *output,
                                            float *work) noexcept {
    return pffft_unordered_real_backward_begin(state_, input, output, work) != 0;
  }

  [[nodiscard]] int stepCount() const noexcept {
    return pffft_ordered_real_forward_step_count(state_);
  }

  [[nodiscard]] int step() noexcept { return pffft_ordered_real_forward_step(state_); }

private:
  PFFFT_OrderedRealForward *state_ = nullptr;
};

class PffftZConvolveAccumulate final {
public:
  explicit PffftZConvolveAccumulate(PFFFT_Setup *setup) noexcept
      : state_(pffft_new_zconvolve_accumulate(setup)) {}

  ~PffftZConvolveAccumulate() { pffft_destroy_zconvolve_accumulate(state_); }

  PffftZConvolveAccumulate(const PffftZConvolveAccumulate &) = delete;
  PffftZConvolveAccumulate &operator=(const PffftZConvolveAccumulate &) = delete;

  [[nodiscard]] bool valid() const noexcept { return state_ != nullptr; }

  [[nodiscard]] bool begin(const float *a, const float *b, float *accumulator,
                           float scaling) noexcept {
    return pffft_zconvolve_accumulate_begin(state_, a, b, accumulator, scaling) != 0;
  }

  [[nodiscard]] bool beginNoAccu(const float *a, const float *b, float *output,
                                 float scaling) noexcept {
    return pffft_zconvolve_no_accu_begin(state_, a, b, output, scaling) != 0;
  }

  [[nodiscard]] int stepCount() const noexcept {
    return pffft_zconvolve_accumulate_step_count(state_);
  }

  [[nodiscard]] int step(int workBudget) noexcept {
    return pffft_zconvolve_accumulate_step(state_, workBudget);
  }

private:
  PFFFT_ZConvolveAccumulate *state_ = nullptr;
};

} // namespace effetune::dsp

#endif

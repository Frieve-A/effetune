#ifndef EFFETUNE_NOTE_SPECTROGRAM_POST_MODEL_H
#define EFFETUNE_NOTE_SPECTROGRAM_POST_MODEL_H

#include "post_model_weights.h"
#include <cmath>
#include <cstdint>
#include <cstring>
#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

namespace effetune::plugins::analyzer::note_post {

// exp(x) as 2^n times a degree-6 polynomial of the fraction; the GRU gates tolerate its ~1e-7
// relative error and it is far cheaper than libm.
inline float fastExp(float x) {
  x = x < -80.0F ? -80.0F : (x > 80.0F ? 80.0F : x);
  const float t = x * 1.4426950408889634F;
  const float n = std::floor(t + 0.5F);
  const float f = t - n;
  float p = 1.535336188319500e-4F;
  p = p * f + 1.339887440266574e-3F;
  p = p * f + 9.618437357674640e-3F;
  p = p * f + 5.550332471162809e-2F;
  p = p * f + 2.402264791363012e-1F;
  p = p * f + 6.931472028550421e-1F;
  p = p * f + 1.0F;
  std::int32_t bits;
  std::memcpy(&bits, &p, 4);
  bits += static_cast<std::int32_t>(n) << 23;
  std::memcpy(&p, &bits, 4);
  return p;
}
inline float sigmoid(float x) { return 1.0F / (1.0F + fastExp(-x)); }

#ifdef __wasm_simd128__
inline v128_t vexp(v128_t x) {
  x = wasm_f32x4_pmax(wasm_f32x4_pmin(x, wasm_f32x4_splat(80.0F)), wasm_f32x4_splat(-80.0F));
  const v128_t t = wasm_f32x4_mul(x, wasm_f32x4_splat(1.4426950408889634F));
  const v128_t n = wasm_f32x4_nearest(t);
  const v128_t f = wasm_f32x4_sub(t, n);
  v128_t p = wasm_f32x4_splat(1.535336188319500e-4F);
  p = wasm_f32x4_add(wasm_f32x4_mul(p, f), wasm_f32x4_splat(1.339887440266574e-3F));
  p = wasm_f32x4_add(wasm_f32x4_mul(p, f), wasm_f32x4_splat(9.618437357674640e-3F));
  p = wasm_f32x4_add(wasm_f32x4_mul(p, f), wasm_f32x4_splat(5.550332471162809e-2F));
  p = wasm_f32x4_add(wasm_f32x4_mul(p, f), wasm_f32x4_splat(2.402264791363012e-1F));
  p = wasm_f32x4_add(wasm_f32x4_mul(p, f), wasm_f32x4_splat(6.931472028550421e-1F));
  p = wasm_f32x4_add(wasm_f32x4_mul(p, f), wasm_f32x4_splat(1.0F));
  return wasm_i32x4_add(p, wasm_i32x4_shl(wasm_i32x4_trunc_sat_f32x4(n), 23));
}
inline v128_t vsigmoid(v128_t x) {
  const v128_t one = wasm_f32x4_splat(1.0F);
  return wasm_f32x4_div(one, wasm_f32x4_add(one, vexp(wasm_f32x4_neg(x))));
}
#endif

// Streaming per-pitch GRU ensemble over the main model's fine confidences, one step per frame.
// prepare() builds the shared inputs from the 88 x 5 confidences, run(begin, end) steps the tasks
// member * 64 + pitch in any split (so the kernel can level the load), and finish() averages the
// member probabilities and applies each head's calibration as an odds rescale. probability(pitch,
// head): head 0 estimates the current frame, head 1 revises the frame kRevisionFrames earlier.
class PostModel final {
public:
  static constexpr int kPitches = 88;
  static constexpr int kDivisions = 5;
  static constexpr int kLowPitch = 7;
  static constexpr int kOutputPitches = 64;
  static constexpr int kInputs = 17;
  static constexpr int kHidden = 32;
  static constexpr int kGates = 3 * kHidden;
  static constexpr int kHeads = 2;
  static constexpr int kRevisionFrames = 8;
  static constexpr int kMembers = kPostMembers;

  PostModel() {
    for (int head = 0; head < kHeads; ++head)
      odds_[head] = std::exp(-kPostCalibration[head]);
    reset();
  }

  void reset() {
    std::memset(hidden_, 0, sizeof(hidden_));
    for (auto &row : history_)
      for (float &value : row)
        value = kFloor;
    head_ = 0;
  }

  void prepare(const float *confidences) {
    float logit[kPitches];
    float activity = 0.0F;
    for (int p = 0; p < kPitches; ++p) {
      float m = 0.0F;
      for (int d = 0; d < kDivisions; ++d) {
        const float c = confidences[p * kDivisions + d];
        m = c > m ? c : m;
      }
      m = clampProbability(m);
      activity += m;
      logit[p] = std::log(m / (1.0F - m));
    }
    activity *= 0.125F;
    for (int p = 0; p < kOutputPitches; ++p) {
      float *x = inputs_[p];
      for (int d = 0; d < kDivisions; ++d) {
        const float c = clampProbability(confidences[(p + kLowPitch) * kDivisions + d]);
        x[d] = 0.25F * std::log(c / (1.0F - c));
      }
      x[5] = 0.25F * logit[p + kLowPitch];
      x[6] = activity;
      for (int o = 0; o < 10; ++o) {
        const int q = p + kLowPitch + kNeighbourOffsets[o];
        x[7 + o] = 0.25F * (q >= 0 && q < kPitches ? logit[q] : kFloor);
      }
      history_[head_][p] = logit[p + kLowPitch];
      for (int head = 0; head < kHeads; ++head)
        probability_sum_[p][head] = 0.0F;
    }
  }

  void run(int begin, int end) {
    for (int task = begin; task < end; ++task)
      step(task / kOutputPitches, task % kOutputPitches);
  }

  void finish() {
    for (int p = 0; p < kOutputPitches; ++p)
      for (int head = 0; head < kHeads; ++head) {
        float v = probability_sum_[p][head] * (1.0F / kMembers);
        v = v < 1e-7F ? 1e-7F : (v > 1.0F - 1e-7F ? 1.0F - 1e-7F : v);
        probability_[p][head] = v / (v + (1.0F - v) * odds_[head]);
      }
    head_ = head_ + 1 < kHistory ? head_ + 1 : 0;
  }

  float probability(int pitch, int head) const { return probability_[pitch][head]; }
  static constexpr int tasks() { return kMembers * kOutputPitches; }

private:
  static constexpr int kHistory = kRevisionFrames + 1;
  static constexpr int kHeadLag[kHeads] = {0, kRevisionFrames};
  static constexpr int kNeighbourOffsets[10] = {-24, -19, -12, -7, -1, 1, 7, 12, 19, 24};
  static constexpr float kFloor = -9.21024036697585F; // logit(1e-4)

  static float clampProbability(float c) {
    return c < 1e-4F ? 1e-4F : (c > 1.0F - 1e-4F ? 1.0F - 1e-4F : c);
  }

  void step(int member, int p) {
    const float *x = inputs_[p];
    float *h = hidden_[member][p];
    const float *wi = kPostInputW[member];
    const float *wh = kPostRecurrentW[member];
    const float *bi = kPostPitchBias[member] + p * kGates;
    const float *bh = kPostRecurrentB[member];
    alignas(16) float gi[kGates];
    alignas(16) float gh[kGates];
#ifdef __wasm_simd128__
    for (int g = 0; g < kGates; g += 4) {
      v128_t a = wasm_v128_load(bi + g);
      v128_t c = wasm_v128_load(bh + g);
      for (int j = 0; j < kInputs; ++j)
        a = wasm_f32x4_add(
            a, wasm_f32x4_mul(wasm_f32x4_splat(x[j]), wasm_v128_load(wi + j * kGates + g)));
      for (int k = 0; k < kHidden; ++k)
        c = wasm_f32x4_add(
            c, wasm_f32x4_mul(wasm_f32x4_splat(h[k]), wasm_v128_load(wh + k * kGates + g)));
      wasm_v128_store(gi + g, a);
      wasm_v128_store(gh + g, c);
    }
    for (int k = 0; k < kHidden; k += 4) {
      const v128_t r = vsigmoid(wasm_f32x4_add(wasm_v128_load(gi + k), wasm_v128_load(gh + k)));
      const v128_t z = vsigmoid(
          wasm_f32x4_add(wasm_v128_load(gi + kHidden + k), wasm_v128_load(gh + kHidden + k)));
      const v128_t pre = wasm_f32x4_add(wasm_v128_load(gi + 2 * kHidden + k),
                                        wasm_f32x4_mul(r, wasm_v128_load(gh + 2 * kHidden + k)));
      const v128_t n =
          wasm_f32x4_sub(wasm_f32x4_mul(wasm_f32x4_splat(2.0F), vsigmoid(wasm_f32x4_add(pre, pre))),
                         wasm_f32x4_splat(1.0F));
      const v128_t hv = wasm_v128_load(h + k);
      wasm_v128_store(h + k, wasm_f32x4_add(n, wasm_f32x4_mul(z, wasm_f32x4_sub(hv, n))));
    }
#else
    for (int g = 0; g < kGates; ++g) {
      gi[g] = bi[g];
      gh[g] = bh[g];
    }
    for (int j = 0; j < kInputs; ++j)
      for (int g = 0; g < kGates; ++g)
        gi[g] += x[j] * wi[j * kGates + g];
    for (int k = 0; k < kHidden; ++k)
      for (int g = 0; g < kGates; ++g)
        gh[g] += h[k] * wh[k * kGates + g];
    for (int k = 0; k < kHidden; ++k) {
      const float r = sigmoid(gi[k] + gh[k]);
      const float z = sigmoid(gi[kHidden + k] + gh[kHidden + k]);
      const float n = 2.0F * sigmoid(2.0F * (gi[2 * kHidden + k] + r * gh[2 * kHidden + k])) - 1.0F;
      h[k] = n + z * (h[k] - n);
    }
#endif
    for (int head = 0; head < kHeads; ++head) {
      float v = kPostHeadB[member][head];
      const float *w = kPostHeadW[member] + head * kHidden;
      for (int k = 0; k < kHidden; ++k)
        v += w[k] * h[k];
      const int row =
          head_ >= kHeadLag[head] ? head_ - kHeadLag[head] : head_ - kHeadLag[head] + kHistory;
      v += kPostHistoryW[member][head] * history_[row][p];
      probability_sum_[p][head] += sigmoid(v);
    }
  }

  alignas(16) float hidden_[kMembers][kOutputPitches][kHidden];
  alignas(16) float inputs_[kOutputPitches][kInputs];
  float history_[kHistory][kOutputPitches];
  float probability_sum_[kOutputPitches][kHeads];
  float probability_[kOutputPitches][kHeads];
  float odds_[kHeads];
  int head_ = 0;
};

} // namespace effetune::plugins::analyzer::note_post

#endif

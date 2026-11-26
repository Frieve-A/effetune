// Native equivalents of the two-double operations used by the shared Web DSD kernels.
#pragma once

typedef double v128_t __attribute__((vector_size(16)));
static inline v128_t wasm_f64x2_make(double a, double b) {
  v128_t value = {a, b};
  return value;
}
static inline v128_t wasm_f64x2_splat(double v) { return wasm_f64x2_make(v, v); }
static inline v128_t wasm_f64x2_add(v128_t a, v128_t b) { return a + b; }
static inline v128_t wasm_f64x2_sub(v128_t a, v128_t b) { return a - b; }
static inline v128_t wasm_f64x2_mul(v128_t a, v128_t b) { return a * b; }
static inline double wasm_f64x2_extract_lane(v128_t v, int lane) { return v[lane]; }
static inline v128_t wasm_v128_load(const void *p) {
  v128_t v;
  __builtin_memcpy(&v, p, sizeof(v));
  return v;
}
static inline void wasm_v128_store(void *p, v128_t v) { __builtin_memcpy(p, &v, sizeof(v)); }

// Identification compute module of the speaker distortion correction (plan-algorithm section 9):
// corrector states, Gram columns, seed Gram matrices, ridge solves, held-out quadratics,
// predictions, corrected periods and score sums of the second-order model at 48 kHz.
#include "effetune/abi.h"
#include "effetune/dsp/portable_math.h"

#include <pffft.h>

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <new>

#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#endif

namespace effetune::sdc {

// Modified Bessel function of the first kind, order zero, as its power series (the kernel's
// form: terms are added until one is below 1e-17 of the sum).
double besselI0(double x) noexcept {
  const double quarterSquare = x * x * 0.25;
  double sum = 1.0;
  double term = 1.0;
  for (double k = 1.0;; k += 1.0) {
    term *= quarterSquare / (k * k);
    if (term < 1e-17 * sum)
      break;
    sum += term;
  }
  return sum;
}

} // namespace effetune::sdc

namespace {

namespace dsp = effetune::dsp;
using std::size_t;

constexpr size_t kN = 48000u;
constexpr size_t kFold = kN / 2u;
constexpr size_t kHalf = kN / 4u;
constexpr size_t kMaxBin = 8000u;
constexpr size_t kEvenBins = kMaxBin / 2u + 1u;
// Rows r = 0..3982 are the even bins k = r + 18 (f = 2k = 36..8000 Hz).
constexpr size_t kRows = 3983u;
constexpr size_t kFirstRowBin = 18u;
// A column holds Re of the rows, Im of the rows and two zero pads.
constexpr size_t kLd = 2u * kRows + 2u;
constexpr size_t kColumns = 1376u;
constexpr size_t kPaddedColumns = 1380u;
constexpr size_t kDirect = 990u;
constexpr size_t kModel = 1182u;
constexpr size_t kUnknowns = kModel + 1u;
constexpr size_t kLowHighPeak = 528u;
constexpr size_t kLowQuadrature = 720u;
constexpr size_t kHighHigh = 912u;
constexpr size_t kSecondPairs = 192u;
constexpr size_t kShortSecond = 990u;
constexpr size_t kLongSecond = 1182u;
constexpr size_t kMicColumn = 1374u;
constexpr size_t kCarrierColumn = 1375u;
constexpr size_t kPacked = kColumns * (kColumns + 1u) / 2u;
constexpr size_t kCarrierRow = kCarrierColumn * (kCarrierColumn + 1u) / 2u;
constexpr size_t kSlots = 24u;
constexpr size_t kScaleCount = 5u;
constexpr size_t kBands = 50u;
constexpr size_t kClassSet = 50u;
constexpr size_t kClasses = 3u;
constexpr size_t kWideSet = 53u;
constexpr size_t kSetCount = 54u;
constexpr size_t kLowSections = 16u;
constexpr size_t kHighSections = 6u;
constexpr size_t kSections = kLowSections + kHighSections;
constexpr size_t kLowStates = 2u * kLowSections;
constexpr size_t kHighStates = 2u * kHighSections;
constexpr size_t kStates = kLowStates + kHighStates;
// Product weights per held sample pair: low x low (upper triangle), low x high, second sum.
constexpr size_t kPairWidth = kLowStates + kHighStates + kHighSections;
constexpr size_t kGramChunk = 512u;
constexpr size_t kCholeskyBlock = 96u;
constexpr size_t kMaxTapHalf = 120u;
constexpr double kRms = 0.1;
constexpr double kMicRidge = 1e-6;
constexpr double kScaleFloor = 1e-12;
constexpr double kKaiserBeta = 4.3;
constexpr double kLowQ = 2.15;
constexpr double kHighQ = 1.4;
constexpr double kLn2 = 0.69314718055994530942;
constexpr double kHighFrequencies[kHighSections] = {580.0, 1050.0, 1900.0, 3450.0, 6200.0, 7800.0};
// Score scales in the stored order: measured, Reduce, Add, Reduce at -3 dB and at +3 dB.
constexpr double kScales[kScaleCount] = {0.0, 1.0, -1.0, 0.70794578438413791, 1.4125375446227544};
constexpr size_t kTapHalf[2] = {30u, 120u};

enum Buffer : std::uint32_t {
  kIo = 0u,
  kDrive,
  kG,
  kExcited,
  kTermMask,
  kRowWeight,
  kCarrier,
  kGram,
  kGramTotal,
  kGramSeed,
  kWeights,
  kPred,
  kMic,
  kY,
  kPn,
  kRowSet,
  kScore,
  kOut,
  kColumnsBuffer,
  kStatesBuffer,
  kOddBuffer,
  kBufferCount
};

// Gram column of unknown i of length `length` (0 Short, 1 Long): model terms in asset order,
// the microphone last.
size_t lengthColumn(std::uint32_t length, size_t i) noexcept {
  if (i < kDirect)
    return i;
  if (i < kModel)
    return (length == 0u ? kShortSecond : kLongSecond) + i - kDirect;
  return kMicColumn;
}

double angle(size_t numerator, size_t denominator) noexcept {
  return 2.0 * dsp::kPi * static_cast<double>(numerator % denominator) /
         static_cast<double>(denominator);
}

#if defined(__wasm_simd128__)
float horizontalSum(v128_t value) noexcept {
  return (wasm_f32x4_extract_lane(value, 0) + wasm_f32x4_extract_lane(value, 1)) +
         (wasm_f32x4_extract_lane(value, 2) + wasm_f32x4_extract_lane(value, 3));
}

double horizontalSum2(v128_t value) noexcept {
  return wasm_f64x2_extract_lane(value, 0) + wasm_f64x2_extract_lane(value, 1);
}
#endif

// 4 x 4 block of column dot products over `length` rows (a multiple of 4), summed in float32.
void gramBlock(const float *const a[4], const float *const b[4], size_t length,
               float out[16]) noexcept {
#if defined(__wasm_simd128__)
  v128_t s00 = wasm_f32x4_splat(0.0F), s01 = s00, s02 = s00, s03 = s00;
  v128_t s10 = s00, s11 = s00, s12 = s00, s13 = s00;
  v128_t s20 = s00, s21 = s00, s22 = s00, s23 = s00;
  v128_t s30 = s00, s31 = s00, s32 = s00, s33 = s00;
  for (size_t t = 0u; t < length; t += 4u) {
    const v128_t x0 = wasm_v128_load(a[0] + t);
    const v128_t x1 = wasm_v128_load(a[1] + t);
    const v128_t x2 = wasm_v128_load(a[2] + t);
    const v128_t x3 = wasm_v128_load(a[3] + t);
    v128_t y = wasm_v128_load(b[0] + t);
    s00 = wasm_f32x4_add(s00, wasm_f32x4_mul(x0, y));
    s10 = wasm_f32x4_add(s10, wasm_f32x4_mul(x1, y));
    s20 = wasm_f32x4_add(s20, wasm_f32x4_mul(x2, y));
    s30 = wasm_f32x4_add(s30, wasm_f32x4_mul(x3, y));
    y = wasm_v128_load(b[1] + t);
    s01 = wasm_f32x4_add(s01, wasm_f32x4_mul(x0, y));
    s11 = wasm_f32x4_add(s11, wasm_f32x4_mul(x1, y));
    s21 = wasm_f32x4_add(s21, wasm_f32x4_mul(x2, y));
    s31 = wasm_f32x4_add(s31, wasm_f32x4_mul(x3, y));
    y = wasm_v128_load(b[2] + t);
    s02 = wasm_f32x4_add(s02, wasm_f32x4_mul(x0, y));
    s12 = wasm_f32x4_add(s12, wasm_f32x4_mul(x1, y));
    s22 = wasm_f32x4_add(s22, wasm_f32x4_mul(x2, y));
    s32 = wasm_f32x4_add(s32, wasm_f32x4_mul(x3, y));
    y = wasm_v128_load(b[3] + t);
    s03 = wasm_f32x4_add(s03, wasm_f32x4_mul(x0, y));
    s13 = wasm_f32x4_add(s13, wasm_f32x4_mul(x1, y));
    s23 = wasm_f32x4_add(s23, wasm_f32x4_mul(x2, y));
    s33 = wasm_f32x4_add(s33, wasm_f32x4_mul(x3, y));
  }
  out[0] = horizontalSum(s00);
  out[1] = horizontalSum(s01);
  out[2] = horizontalSum(s02);
  out[3] = horizontalSum(s03);
  out[4] = horizontalSum(s10);
  out[5] = horizontalSum(s11);
  out[6] = horizontalSum(s12);
  out[7] = horizontalSum(s13);
  out[8] = horizontalSum(s20);
  out[9] = horizontalSum(s21);
  out[10] = horizontalSum(s22);
  out[11] = horizontalSum(s23);
  out[12] = horizontalSum(s30);
  out[13] = horizontalSum(s31);
  out[14] = horizontalSum(s32);
  out[15] = horizontalSum(s33);
#else
  float s[16] = {};
  for (size_t t = 0u; t < length; ++t) {
    const float x0 = a[0][t], x1 = a[1][t], x2 = a[2][t], x3 = a[3][t];
    const float y0 = b[0][t], y1 = b[1][t], y2 = b[2][t], y3 = b[3][t];
    s[0] += x0 * y0;
    s[1] += x0 * y1;
    s[2] += x0 * y2;
    s[3] += x0 * y3;
    s[4] += x1 * y0;
    s[5] += x1 * y1;
    s[6] += x1 * y2;
    s[7] += x1 * y3;
    s[8] += x2 * y0;
    s[9] += x2 * y1;
    s[10] += x2 * y2;
    s[11] += x2 * y3;
    s[12] += x3 * y0;
    s[13] += x3 * y1;
    s[14] += x3 * y2;
    s[15] += x3 * y3;
  }
  for (size_t k = 0u; k < 16u; ++k)
    out[k] = s[k];
#endif
}

double dot(const double *x, const double *y, size_t length) noexcept {
#if defined(__wasm_simd128__)
  v128_t s0 = wasm_f64x2_splat(0.0), s1 = s0;
  size_t l = 0u;
  for (; l + 4u <= length; l += 4u) {
    s0 = wasm_f64x2_add(s0, wasm_f64x2_mul(wasm_v128_load(x + l), wasm_v128_load(y + l)));
    s1 = wasm_f64x2_add(s1, wasm_f64x2_mul(wasm_v128_load(x + l + 2u), wasm_v128_load(y + l + 2u)));
  }
  double sum = horizontalSum2(wasm_f64x2_add(s0, s1));
  for (; l < length; ++l)
    sum += x[l] * y[l];
  return sum;
#else
  double s0 = 0.0, s1 = 0.0;
  size_t l = 0u;
  for (; l + 2u <= length; l += 2u) {
    s0 += x[l] * y[l];
    s1 += x[l + 1u] * y[l + 1u];
  }
  if (l < length)
    s0 += x[l] * y[l];
  return s0 + s1;
#endif
}

// The four dot products of rows (x0, x1) with rows (y0, y1) over `length` entries.
void dot2x2(const double *x0, const double *x1, const double *y0, const double *y1, size_t length,
            double out[4]) noexcept {
#if defined(__wasm_simd128__)
  v128_t s00 = wasm_f64x2_splat(0.0), s01 = s00, s10 = s00, s11 = s00;
  size_t l = 0u;
  for (; l + 2u <= length; l += 2u) {
    const v128_t a0 = wasm_v128_load(x0 + l);
    const v128_t a1 = wasm_v128_load(x1 + l);
    const v128_t b0 = wasm_v128_load(y0 + l);
    const v128_t b1 = wasm_v128_load(y1 + l);
    s00 = wasm_f64x2_add(s00, wasm_f64x2_mul(a0, b0));
    s01 = wasm_f64x2_add(s01, wasm_f64x2_mul(a0, b1));
    s10 = wasm_f64x2_add(s10, wasm_f64x2_mul(a1, b0));
    s11 = wasm_f64x2_add(s11, wasm_f64x2_mul(a1, b1));
  }
  out[0] = horizontalSum2(s00);
  out[1] = horizontalSum2(s01);
  out[2] = horizontalSum2(s10);
  out[3] = horizontalSum2(s11);
#else
  double s00 = 0.0, s01 = 0.0, s10 = 0.0, s11 = 0.0;
  size_t l = 0u;
  for (; l + 2u <= length; l += 2u) {
    s00 += x0[l] * y0[l] + x0[l + 1u] * y0[l + 1u];
    s01 += x0[l] * y1[l] + x0[l + 1u] * y1[l + 1u];
    s10 += x1[l] * y0[l] + x1[l + 1u] * y0[l + 1u];
    s11 += x1[l] * y1[l] + x1[l + 1u] * y1[l + 1u];
  }
  out[0] = s00;
  out[1] = s01;
  out[2] = s10;
  out[3] = s11;
#endif
  if (l < length) {
    out[0] += x0[l] * y0[l];
    out[1] += x0[l] * y1[l];
    out[2] += x1[l] * y0[l];
    out[3] += x1[l] * y1[l];
  }
}

// In-place blocked right-looking Cholesky of the lower triangle of the row-major n x n matrix
// a (block nb = 96). Returns false on a non-positive or non-finite pivot.
bool cholesky(double *a, size_t n) noexcept {
  for (size_t k0 = 0u; k0 < n; k0 += kCholeskyBlock) {
    const size_t k1 = k0 + kCholeskyBlock < n ? k0 + kCholeskyBlock : n;
    // Diagonal block and the panel below it, column by column within the block.
    for (size_t j = k0; j < k1; ++j) {
      double *rowJ = a + j * n;
      const double d = rowJ[j] - dot(rowJ + k0, rowJ + k0, j - k0);
      if (!(d > 0.0) || !std::isfinite(d))
        return false;
      const double pivot = std::sqrt(d);
      rowJ[j] = pivot;
      const double inverse = 1.0 / pivot;
      for (size_t i = j + 1u; i < n; ++i) {
        double *rowI = a + i * n;
        rowI[j] = (rowI[j] - dot(rowI + k0, rowJ + k0, j - k0)) * inverse;
      }
    }
    // Trailing update of the lower triangle below and right of the block.
    const size_t width = k1 - k0;
    for (size_t i = k1; i < n; i += 2u) {
      double *rowI = a + i * n;
      if (i + 1u < n) {
        double *rowI1 = rowI + n;
        for (size_t j = k1; j <= i; j += 2u) {
          double *rowJ = a + j * n;
          double s[4];
          dot2x2(rowI + k0, rowI1 + k0, rowJ + k0, rowJ + n + k0, width, s);
          rowI[j] -= s[0];
          if (j + 1u <= i)
            rowI[j + 1u] -= s[1];
          rowI1[j] -= s[2];
          rowI1[j + 1u] -= s[3];
        }
      } else {
        for (size_t j = k1; j <= i; ++j)
          rowI[j] -= dot(rowI + k0, a + j * n + k0, width);
      }
    }
  }
  return true;
}

struct Section final {
  double a1 = 0.0;
  double a2 = 0.0;
  double peakScale = 0.0;
  double quadratureScale = 0.0;
};

// The kernel's iirpeak design at 48 kHz (plan-plugin section 9.1).
Section designSection(double frequency, double q) noexcept {
  const double w0 = 2.0 * dsp::kPi * frequency / static_cast<double>(kN);
  const double beta = dsp::portableTan(w0 / (2.0 * q));
  const double g = 1.0 / (1.0 + beta);
  Section section;
  section.a1 = -2.0 * g * dsp::portableCos(w0);
  section.a2 = 2.0 * g - 1.0;
  section.peakScale = 1.0 - g;
  const double real =
      1.0 + section.a1 * dsp::portableCos(w0) + section.a2 * dsp::portableCos(2.0 * w0);
  const double imaginary =
      section.a1 * dsp::portableSin(w0) + section.a2 * dsp::portableSin(2.0 * w0);
  section.quadratureScale = std::sqrt(real * real + imaginary * imaginary);
  return section;
}

} // namespace

struct et_sdc {
  ~et_sdc() {
    if (fft12 != nullptr)
      pffft_destroy_setup(fft12);
    if (fft24 != nullptr)
      pffft_destroy_setup(fft24);
    if (fft48 != nullptr)
      pffft_destroy_setup(fft48);
    for (size_t i = 0u; i < allocationCount; ++i)
      pffft_aligned_free(allocations[i]);
  }

  template <typename T> T *allocate(size_t count) noexcept {
    void *block = pffft_aligned_malloc(count * sizeof(T));
    if (block == nullptr)
      return nullptr;
    std::memset(block, 0, count * sizeof(T));
    allocations[allocationCount++] = block;
    return static_cast<T *>(block);
  }

  bool prepare() noexcept {
    fft12 = pffft_new_setup(static_cast<int>(kHalf), PFFFT_REAL);
    fft24 = pffft_new_setup(static_cast<int>(kFold), PFFFT_REAL);
    fft48 = pffft_new_setup(static_cast<int>(kN), PFFFT_REAL);
    io = allocate<float>(kN);
    drive = allocate<float>(2u * kMaxBin + 2u);
    g = allocate<float>(2u * kMaxBin + 2u);
    excited = allocate<std::uint8_t>(kMaxBin + 1u);
    termMask = allocate<std::uint8_t>(kColumns);
    rowWeight = allocate<double>(kRows);
    carrier = allocate<double>(2u * kRows);
    gram = allocate<double>(kPaddedColumns * kPaddedColumns);
    gramTotal = allocate<double>(kPacked);
    gramSeed = allocate<double>(kPacked);
    weights = allocate<double>(kSlots * kUnknowns);
    pred = allocate<float>(kSlots * 2u * kRows);
    mic = allocate<float>(2u * kRows);
    y = allocate<float>(2u * kEvenBins);
    pn = allocate<float>(kEvenBins);
    rowSet = allocate<std::uint8_t>(3u * kEvenBins);
    score = allocate<double>(kSlots * kScaleCount * kSetCount);
    out = allocate<double>(kSlots);
    columns = allocate<float>(kPaddedColumns * kLd);
    states = allocate<float>(kStates * kN);
    x = allocate<float>(kN);
    system = allocate<double>(kUnknowns * kUnknowns);
    factor = allocate<double>(kUnknowns * kUnknowns);
    scale = allocate<double>(kUnknowns);
    rhs = allocate<double>(kUnknowns);
    solution = allocate<double>(kUnknowns);
    hi[0] = allocate<double>(kRows);
    hi[1] = allocate<double>(kRows);
    taps[0] = allocate<double>(kMaxTapHalf + 1u);
    taps[1] = allocate<double>(kMaxTapHalf + 1u);
    twiddle = allocate<double>(2u * kRows);
    fftIn = allocate<float>(kN);
    fftOut = allocate<float>(kN);
    fftWork = allocate<float>(kN);
    direct = allocate<double>(kN);
    second = allocate<double>(kN);
    odd = allocate<double>(2u * kLowStates);
    if (fft12 == nullptr || fft24 == nullptr || fft48 == nullptr || io == nullptr ||
        drive == nullptr || g == nullptr || excited == nullptr || termMask == nullptr ||
        rowWeight == nullptr || carrier == nullptr || gram == nullptr || gramTotal == nullptr ||
        gramSeed == nullptr || weights == nullptr || pred == nullptr || mic == nullptr ||
        y == nullptr || pn == nullptr || rowSet == nullptr || score == nullptr || out == nullptr ||
        columns == nullptr || states == nullptr || x == nullptr || system == nullptr ||
        factor == nullptr || scale == nullptr || rhs == nullptr || solution == nullptr ||
        hi[0] == nullptr || hi[1] == nullptr || taps[0] == nullptr || taps[1] == nullptr ||
        twiddle == nullptr || fftIn == nullptr || fftOut == nullptr || fftWork == nullptr ||
        direct == nullptr || second == nullptr || odd == nullptr)
      return false;

    for (size_t i = 0u; i < kSections; ++i) {
      sections[i] =
          i < kLowSections
              ? designSection(20.0 * dsp::portableExp(static_cast<double>(i) / 3.0 * kLn2), kLowQ)
              : designSection(kHighFrequencies[i - kLowSections], kHighQ);
    }
    // 90-degree taps h[m] = -2*kaiser/(pi*m) at odd m (plan-plugin section 9.4) and Hi of
    // section 5.3 on the rows.
    const double norm = effetune::sdc::besselI0(kKaiserBeta);
    for (size_t length = 0u; length < 2u; ++length) {
      const size_t d = kTapHalf[length];
      for (size_t m = 1u; m <= d; m += 2u) {
        const double ratio = static_cast<double>(m) / static_cast<double>(d);
        const double kaiser =
            effetune::sdc::besselI0(kKaiserBeta * std::sqrt(1.0 - ratio * ratio)) / norm;
        taps[length][m] = -2.0 * kaiser / (dsp::kPi * static_cast<double>(m));
      }
      for (size_t r = 0u; r < kRows; ++r) {
        const size_t f = 2u * (r + kFirstRowBin);
        double sum = 0.0;
        for (size_t m = 1u; m <= d; m += 2u)
          sum += -taps[length][m] * std::sin(angle(f * m, kN));
        hi[length][r] = 2.0 * sum;
      }
    }
    // Half-length factor (1 + e^(-j2pik/24000)) with the column normalization RMS/N.
    for (size_t r = 0u; r < kRows; ++r) {
      const double theta = angle(r + kFirstRowBin, kFold);
      twiddle[2u * r] = (1.0 + std::cos(theta)) * kRms / static_cast<double>(kN);
      twiddle[2u * r + 1u] = -std::sin(theta) * kRms / static_cast<double>(kN);
    }
    return true;
  }

  void *buffer(std::uint32_t id) const noexcept {
    switch (id) {
    case kIo:
      return io;
    case kDrive:
      return drive;
    case kG:
      return g;
    case kExcited:
      return excited;
    case kTermMask:
      return termMask;
    case kRowWeight:
      return rowWeight;
    case kCarrier:
      return carrier;
    case kGram:
      return gram;
    case kGramTotal:
      return gramTotal;
    case kGramSeed:
      return gramSeed;
    case kWeights:
      return weights;
    case kPred:
      return pred;
    case kMic:
      return mic;
    case kY:
      return y;
    case kPn:
      return pn;
    case kRowSet:
      return rowSet;
    case kScore:
      return score;
    case kOut:
      return out;
    case kColumnsBuffer:
      return columns;
    case kStatesBuffer:
      return states;
    case kOddBuffer:
      return odd;
    default:
      return nullptr;
    }
  }

  float *column(size_t c) const noexcept { return columns + c * kLd; }
  const float *state(size_t s) const noexcept { return states + s * kN; }

  // The 44 states of section 5.1 from x: float64 recursion over three periods, the third stored.
  void computeStates() noexcept {
    for (size_t i = 0u; i < kSections; ++i) {
      const Section &section = sections[i];
      float *peak = states + 2u * i * kN;
      float *quadrature = peak + kN;
      double v1 = 0.0, v2 = 0.0;
      for (size_t n = 0u; n < 2u * kN; ++n) {
        const double v =
            static_cast<double>(x[n < kN ? n : n - kN]) / kRms - section.a1 * v1 - section.a2 * v2;
        v2 = v1;
        v1 = v;
      }
      for (size_t n = 0u; n < kN; ++n) {
        const double v = static_cast<double>(x[n]) / kRms - section.a1 * v1 - section.a2 * v2;
        peak[n] = static_cast<float>(section.peakScale * (v - v2));
        quadrature[n] = static_cast<float>(section.quadratureScale * v1);
        v2 = v1;
        v1 = v;
      }
      if (i < kLowSections) {
        for (size_t n = 0u; n < kN; n += 2u) {
          peak[n + 1u] = peak[n];
          quadrature[n + 1u] = quadrature[n];
        }
      }
    }
  }

  et_status runDrive() noexcept {
    // x = IDFT(X): the backward transform of the packed bins equals the synthesis of section 2.4.
    std::memset(fftIn, 0, kN * sizeof(float));
    fftIn[0] = drive[0];
    for (size_t k = 1u; k <= kMaxBin; ++k) {
      fftIn[2u * k] = drive[2u * k];
      fftIn[2u * k + 1u] = drive[2u * k + 1u];
    }
    pffft_transform_ordered(fft48, fftIn, x, fftWork, PFFFT_BACKWARD);
    computeStates();

    // Microphone column of section 5.5: y_lin = IDFT(g*X on the excited bins), M = DFT(y_lin^2)/N.
    std::memset(fftIn, 0, kN * sizeof(float));
    for (size_t k = 0u; k <= kMaxBin; ++k) {
      if (excited[k] == 0u)
        continue;
      const double gr = g[2u * k], gi = g[2u * k + 1u];
      const double xr = drive[2u * k], xi = drive[2u * k + 1u];
      if (k == 0u) {
        fftIn[0] = static_cast<float>(gr * xr - gi * xi);
      } else {
        fftIn[2u * k] = static_cast<float>(gr * xr - gi * xi);
        fftIn[2u * k + 1u] = static_cast<float>(gr * xi + gi * xr);
      }
    }
    pffft_transform_ordered(fft48, fftIn, fftOut, fftWork, PFFFT_BACKWARD);
    for (size_t n = 0u; n < kFold; ++n) {
      const double a = fftOut[n], b = fftOut[n + kFold];
      fftIn[n] = static_cast<float>(a * a + b * b);
    }
    pffft_transform_ordered(fft24, fftIn, fftOut, fftWork, PFFFT_FORWARD);
    const double inverseN = 1.0 / static_cast<double>(kN);
    for (size_t r = 0u; r < kRows; ++r) {
      const size_t k = r + kFirstRowBin;
      mic[2u * r] = static_cast<float>(fftOut[2u * k] * inverseN);
      mic[2u * r + 1u] = static_cast<float>(fftOut[2u * k + 1u] * inverseN);
    }
    return ET_OK;
  }

  // Direct column of states (a, b) through the 24000 fold.
  void foldColumn(size_t a, size_t b, float *destination) noexcept {
    const float *sa = state(a);
    const float *sb = state(b);
    for (size_t n = 0u; n < kFold; ++n) {
      fftIn[n] = static_cast<float>(static_cast<double>(sa[n]) * sb[n] +
                                    static_cast<double>(sa[n + kFold]) * sb[n + kFold]);
    }
    pffft_transform_ordered(fft24, fftIn, fftOut, fftWork, PFFFT_FORWARD);
    const double norm = kRms / static_cast<double>(kN);
    for (size_t r = 0u; r < kRows; ++r) {
      const size_t k = r + kFirstRowBin;
      destination[r] = static_cast<float>(fftOut[2u * k] * norm);
      destination[kRows + r] = static_cast<float>(fftOut[2u * k + 1u] * norm);
    }
  }

  // Direct column of two held low states through the half-length form.
  void halfLengthColumn(size_t a, size_t b, float *destination) noexcept {
    const float *sa = state(a);
    const float *sb = state(b);
    for (size_t m = 0u; m < kHalf; ++m) {
      const size_t n = 2u * m;
      fftIn[m] = static_cast<float>(static_cast<double>(sa[n]) * sb[n] +
                                    static_cast<double>(sa[n + kFold]) * sb[n + kFold]);
    }
    pffft_transform_ordered(fft12, fftIn, fftOut, fftWork, PFFFT_FORWARD);
    for (size_t r = 0u; r < kRows; ++r) {
      const size_t k = r + kFirstRowBin;
      const double re = fftOut[2u * k], im = fftOut[2u * k + 1u];
      const double tr = twiddle[2u * r], ti = twiddle[2u * r + 1u];
      destination[r] = static_cast<float>(tr * re - ti * im);
      destination[kRows + r] = static_cast<float>(tr * im + ti * re);
    }
  }

  et_status runColumns() noexcept {
    size_t term = 0u;
    for (size_t a = 0u; a < kLowStates; ++a)
      for (size_t b = a; b < kLowStates; ++b)
        halfLengthColumn(a, b, column(term++));
    for (size_t a = 0u; a < kLowStates; ++a) {
      for (size_t j = 0u; j < kHighSections; ++j) {
        foldColumn(a, kLowStates + 2u * j, column(kLowHighPeak + kHighSections * a + j));
        foldColumn(a, kLowStates + 2u * j + 1u, column(kLowQuadrature + kHighSections * a + j));
      }
    }
    term = kHighHigh;
    for (size_t c = 0u; c < kHighStates; ++c)
      for (size_t e = c; e < kHighStates; ++e)
        foldColumn(kLowStates + c, kLowStates + e, column(term++));

    // Second sums: H = j*Hi applied per row to the low x high peak column.
    for (size_t i = 0u; i < kSecondPairs; ++i) {
      const float *source = column(kLowHighPeak + i);
      float *shortColumn = column(kShortSecond + i);
      float *longColumn = column(kLongSecond + i);
      for (size_t r = 0u; r < kRows; ++r) {
        const double re = source[r], im = source[kRows + r];
        shortColumn[r] = static_cast<float>(-hi[0][r] * im);
        shortColumn[kRows + r] = static_cast<float>(hi[0][r] * re);
        longColumn[r] = static_cast<float>(-hi[1][r] * im);
        longColumn[kRows + r] = static_cast<float>(hi[1][r] * re);
      }
    }

    // Microphone column M/g.
    float *micColumn = column(kMicColumn);
    for (size_t r = 0u; r < kRows; ++r) {
      const size_t f = 2u * (r + kFirstRowBin);
      const double gr = g[2u * f], gi = g[2u * f + 1u];
      const double magnitude = gr * gr + gi * gi;
      const double mr = mic[2u * r], mi = mic[2u * r + 1u];
      micColumn[r] = magnitude > 0.0 ? static_cast<float>((mr * gr + mi * gi) / magnitude) : 0.0F;
      micColumn[kRows + r] =
          magnitude > 0.0 ? static_cast<float>((mi * gr - mr * gi) / magnitude) : 0.0F;
    }
    std::memset(column(kCarrierColumn), 0, kLd * sizeof(float));
    for (size_t c = 0u; c < kColumns; ++c) {
      if (termMask[c] == 0u)
        std::memset(column(c), 0, kLd * sizeof(float));
    }
    return ET_OK;
  }

  et_status runGram(std::uint32_t qRow) noexcept {
    if (qRow > kRows)
      return ET_ERR_ARGS;
    float *micColumn = column(kMicColumn);
    for (size_t r = qRow; r < kRows; ++r) {
      micColumn[r] = 0.0F;
      micColumn[kRows + r] = 0.0F;
    }
    float *carrierColumn = column(kCarrierColumn);
    for (size_t r = 0u; r < kRows; ++r) {
      carrierColumn[r] = static_cast<float>(carrier[2u * r]);
      carrierColumn[kRows + r] = static_cast<float>(carrier[2u * r + 1u]);
    }
    for (size_t c = 0u; c < kColumns; ++c) {
      float *values = column(c);
      for (size_t r = 0u; r < kRows; ++r) {
        const double weight = rowWeight[r];
        values[r] = static_cast<float>(values[r] * weight);
        values[kRows + r] = static_cast<float>(values[kRows + r] * weight);
      }
    }

    std::memset(gram, 0, kPaddedColumns * kPaddedColumns * sizeof(double));
    const size_t blocks = kColumns / 4u;
    for (size_t t0 = 0u; t0 < kLd; t0 += kGramChunk) {
      const size_t length = t0 + kGramChunk < kLd ? kGramChunk : kLd - t0;
      for (size_t ib = 0u; ib < blocks; ++ib) {
        const float *a[4] = {column(4u * ib) + t0, column(4u * ib + 1u) + t0,
                             column(4u * ib + 2u) + t0, column(4u * ib + 3u) + t0};
        for (size_t jb = 0u; jb <= ib; ++jb) {
          const float *b[4] = {column(4u * jb) + t0, column(4u * jb + 1u) + t0,
                               column(4u * jb + 2u) + t0, column(4u * jb + 3u) + t0};
          float sums[16];
          gramBlock(a, b, length, sums);
          for (size_t p = 0u; p < 4u; ++p) {
            const size_t i = 4u * ib + p;
            double *row = gram + i * kPaddedColumns;
            for (size_t q = 0u; q < 4u; ++q) {
              const size_t j = 4u * jb + q;
              if (j <= i)
                row[j] += sums[4u * p + q];
            }
          }
        }
      }
    }
    return ET_OK;
  }

  et_status runSystem(std::uint32_t length, std::uint32_t fold) noexcept {
    if (length > 1u || fold > 1u)
      return ET_ERR_ARGS;
    for (size_t i = 0u; i < kUnknowns; ++i) {
      const size_t ci = lengthColumn(length, i);
      const double *rowT = gramTotal + ci * (ci + 1u) / 2u;
      const double *rowS = gramSeed + ci * (ci + 1u) / 2u;
      double *row = system + i * kUnknowns;
      for (size_t j = 0u; j <= i; ++j) {
        const size_t cj = lengthColumn(length, j);
        row[j] = fold != 0u ? rowT[cj] - rowS[cj] : rowT[cj];
      }
      rhs[i] = fold != 0u ? gramTotal[kCarrierRow + ci] - gramSeed[kCarrierRow + ci]
                          : gramTotal[kCarrierRow + ci];
      double s = std::sqrt(row[i]);
      if (s < kScaleFloor)
        s = kScaleFloor;
      scale[i] = s;
    }
    for (size_t i = 0u; i < kUnknowns; ++i) {
      double *row = system + i * kUnknowns;
      const double inverse = 1.0 / scale[i];
      for (size_t j = 0u; j <= i; ++j)
        row[j] = row[j] * inverse / scale[j];
      rhs[i] *= inverse;
    }
    return ET_OK;
  }

  et_status runSolve(double lambda, std::uint32_t slot) noexcept {
    if (slot >= kSlots)
      return ET_ERR_ARGS;
    const size_t n = kUnknowns;
    for (size_t i = 0u; i < n; ++i)
      std::memcpy(factor + i * n, system + i * n, (i + 1u) * sizeof(double));
    for (size_t i = 0u; i < kModel; ++i)
      factor[i * n + i] += lambda;
    factor[kModel * n + kModel] += kMicRidge;
    if (!cholesky(factor, n))
      return ET_ERR_STATE;
    // L*u = rhs by row dots, then L^T*v = u column-oriented through the rows of L.
    for (size_t i = 0u; i < n; ++i) {
      const double *row = factor + i * n;
      solution[i] = (rhs[i] - dot(row, solution, i)) / row[i];
    }
    for (size_t i = n; i-- > 0u;) {
      const double *row = factor + i * n;
      const double v = solution[i] / row[i];
      solution[i] = v;
      for (size_t k = 0u; k < i; ++k)
        solution[k] -= row[k] * v;
    }
    for (size_t i = 0u; i < n; ++i) {
      solution[i] /= scale[i];
      if (!std::isfinite(solution[i]))
        return ET_ERR_STATE;
    }
    std::memcpy(weights + slot * n, solution, n * sizeof(double));
    return ET_OK;
  }

  et_status runHeldout(std::uint32_t length, std::uint32_t count, double yy) noexcept {
    if (length > 1u || count > kSlots)
      return ET_ERR_ARGS;
    for (size_t v = 0u; v < count; ++v) {
      const double *w = weights + v * kUnknowns;
      double quadratic = 0.0, linear = 0.0;
      for (size_t i = 0u; i < kUnknowns; ++i) {
        const size_t ci = lengthColumn(length, i);
        const double *row = gramSeed + ci * (ci + 1u) / 2u;
        double sum = 0.0;
        for (size_t j = 0u; j < i; ++j)
          sum += row[lengthColumn(length, j)] * w[j];
        quadratic += w[i] * (2.0 * sum + row[ci] * w[i]);
        linear += w[i] * gramSeed[kCarrierRow + ci];
      }
      out[v] = yy - 2.0 * linear + quadratic;
    }
    return ET_OK;
  }

  // Time-domain product signals of section 5.10 for the model part of w: p_dir into `direct` and
  // p_2 into `second`, full length, RMS included.
  void productSignals(const double *w) noexcept {
    double pairWeights[kLowStates][kPairWidth] = {};
    double highWeights[kHighStates][kHighStates] = {};
    size_t term = 0u;
    for (size_t a = 0u; a < kLowStates; ++a)
      for (size_t b = a; b < kLowStates; ++b)
        pairWeights[a][b] = w[term++];
    for (size_t a = 0u; a < kLowStates; ++a) {
      for (size_t j = 0u; j < kHighSections; ++j) {
        pairWeights[a][kLowStates + 2u * j] = w[kLowHighPeak + kHighSections * a + j];
        pairWeights[a][kLowStates + 2u * j + 1u] = w[kLowQuadrature + kHighSections * a + j];
        pairWeights[a][kLowStates + kHighStates + j] = w[kDirect + kHighSections * a + j];
      }
    }
    term = kHighHigh;
    for (size_t c = 0u; c < kHighStates; ++c)
      for (size_t e = c; e < kHighStates; ++e)
        highWeights[c][e] = w[term++];

    double low[kLowStates];
    double sums[kPairWidth];
    double high[kHighStates];
    for (size_t n = 0u; n < kN; n += 2u) {
      for (size_t a = 0u; a < kLowStates; ++a)
        low[a] = states[a * kN + n];
      for (size_t c = 0u; c < kPairWidth; ++c)
        sums[c] = 0.0;
      for (size_t a = 0u; a < kLowStates; ++a) {
        const double la = low[a];
        const double *row = pairWeights[a];
        for (size_t c = a; c < kPairWidth; ++c)
          sums[c] += la * row[c];
      }
      double lowLow = 0.0;
      for (size_t b = 0u; b < kLowStates; ++b)
        lowLow += low[b] * sums[b];
      for (size_t s = n; s < n + 2u; ++s) {
        for (size_t c = 0u; c < kHighStates; ++c)
          high[c] = states[(kLowStates + c) * kN + s];
        double total = lowLow;
        for (size_t c = 0u; c < kHighStates; ++c) {
          const double *row = highWeights[c];
          double inner = sums[kLowStates + c];
          for (size_t e = c; e < kHighStates; ++e)
            inner += row[e] * high[e];
          total += high[c] * inner;
        }
        double secondSum = 0.0;
        for (size_t j = 0u; j < kHighSections; ++j)
          secondSum += sums[kLowStates + kHighStates + j] * high[2u * j];
        direct[s] = kRms * total;
        second[s] = kRms * secondSum;
      }
    }
  }

  et_status runPredict(std::uint32_t length, std::uint32_t count) noexcept {
    if (length > 1u || count > kSlots)
      return ET_ERR_ARGS;
    float *directSpectrum = fftIn;
    float *secondSpectrum = fftIn + kFold;
    const double inverseN = 1.0 / static_cast<double>(kN);
    for (size_t v = 0u; v < count; ++v) {
      productSignals(weights + v * kUnknowns);
      for (size_t n = 0u; n < kFold; ++n) {
        directSpectrum[n] = static_cast<float>(direct[n] + direct[n + kFold]);
        secondSpectrum[n] = static_cast<float>(second[n] + second[n + kFold]);
      }
      pffft_transform_ordered(fft24, directSpectrum, directSpectrum, fftWork, PFFFT_FORWARD);
      pffft_transform_ordered(fft24, secondSpectrum, secondSpectrum, fftWork, PFFFT_FORWARD);
      float *destination = pred + v * 2u * kRows;
      for (size_t r = 0u; r < kRows; ++r) {
        const size_t k = r + kFirstRowBin;
        const double h = hi[length][r];
        const double ar = directSpectrum[2u * k] - h * secondSpectrum[2u * k + 1u];
        const double ai = directSpectrum[2u * k + 1u] + h * secondSpectrum[2u * k];
        const double gr = g[4u * k], gi = g[4u * k + 1u];
        destination[2u * r] = static_cast<float>((gr * ar - gi * ai) * inverseN);
        destination[2u * r + 1u] = static_cast<float>((gr * ai + gi * ar) * inverseN);
      }
    }
    return ET_OK;
  }

  et_status runCorrect(std::uint32_t length, double correctionScale) noexcept {
    if (length > 1u)
      return ET_ERR_ARGS;
    // Odd block of plan-odd section 2.1 from ODD (weights w, then bounds B): active when a
    // weight is non-zero, and every non-zero weight needs a finite, positive bound.
    const double *bounds = odd + kLowStates;
    bool oddActive = false;
    for (size_t a = 0u; a < kLowStates; ++a) {
      if (odd[a] == 0.0)
        continue;
      if (!std::isfinite(odd[a]) || !std::isfinite(bounds[a]) || !(bounds[a] > 0.0))
        return ET_ERR_ARGS;
      oddActive = true;
    }
    oddActive = oddActive && correctionScale != 0.0;
    // correctionScale = sigma * a: the odd term is (sigma / a) * Do(a * x).
    const double gain = correctionScale >= 0.0 ? correctionScale : -correctionScale;
    productSignals(weights);
    const size_t d = kTapHalf[length];
    const double *h = taps[length];
    double oddTerm = 0.0;
    for (size_t n = 0u; n < kN; ++n) {
      double filtered = 0.0;
      for (size_t m = 1u; m <= d; m += 2u) {
        const size_t before = n >= m ? n - m : n + kN - m;
        const size_t after = n + m < kN ? n + m : n + m - kN;
        filtered += h[m] * (second[before] - second[after]);
      }
      double corrected = static_cast<double>(x[n]) - correctionScale * (direct[n] + filtered);
      if (oddActive) {
        // Evaluated at n = 4 * floor(n / 4) on the low states and held for four samples.
        if ((n & 3u) == 0u) {
          double sum = 0.0;
          for (size_t a = 0u; a < kLowStates; ++a) {
            double s = gain * static_cast<double>(states[a * kN + n]) / bounds[a];
            s = s > 1.0 ? 1.0 : (s < -1.0 ? -1.0 : s);
            sum += odd[a] * s * s * s;
          }
          oddTerm = kRms * sum / correctionScale;
        }
        corrected -= oddTerm;
      }
      io[n] = static_cast<float>(corrected);
    }
    return ET_OK;
  }

  et_status runScore(std::uint32_t count, double predScale) noexcept {
    if (count > kSlots)
      return ET_ERR_ARGS;
    std::memset(score, 0, count * kScaleCount * kSetCount * sizeof(double));
    for (size_t v = 0u; v < count; ++v) {
      const double micWeight = predScale * weights[v * kUnknowns + kModel];
      const float *prediction = pred + v * 2u * kRows;
      double *sums = score + v * kScaleCount * kSetCount;
      for (size_t k = 0u; k < kEvenBins; ++k) {
        double yr = y[2u * k], yi = y[2u * k + 1u];
        double pr = 0.0, pi = 0.0;
        if (k >= kFirstRowBin) {
          const size_t r = k - kFirstRowBin;
          yr -= micWeight * mic[2u * r];
          yi -= micWeight * mic[2u * r + 1u];
          pr = predScale * prediction[2u * r];
          pi = predScale * prediction[2u * r + 1u];
        }
        const std::uint8_t band = rowSet[k];
        const std::uint8_t scoreClass = rowSet[kEvenBins + k];
        const bool wide = rowSet[2u * kEvenBins + k] == 1u;
        const double noise = pn[k];
        for (size_t s = 0u; s < kScaleCount; ++s) {
          const double er = yr - kScales[s] * pr, ei = yi - kScales[s] * pi;
          const double e = er * er + ei * ei - noise;
          const double floored = e > 0.0 ? e : 0.0;
          double *set = sums + s * kSetCount;
          if (band < kBands)
            set[band] += e;
          if (scoreClass < kClasses)
            set[kClassSet + scoreClass] += floored;
          if (wide)
            set[kWideSet] += floored;
        }
      }
    }
    return ET_OK;
  }

  PFFFT_Setup *fft12 = nullptr;
  PFFFT_Setup *fft24 = nullptr;
  PFFFT_Setup *fft48 = nullptr;
  void *allocations[48] = {};
  size_t allocationCount = 0u;
  Section sections[kSections] = {};

  float *io = nullptr;
  float *drive = nullptr;
  float *g = nullptr;
  std::uint8_t *excited = nullptr;
  std::uint8_t *termMask = nullptr;
  double *rowWeight = nullptr;
  double *carrier = nullptr;
  double *gram = nullptr;
  double *gramTotal = nullptr;
  double *gramSeed = nullptr;
  double *weights = nullptr;
  float *pred = nullptr;
  float *mic = nullptr;
  float *y = nullptr;
  float *pn = nullptr;
  std::uint8_t *rowSet = nullptr;
  double *score = nullptr;
  double *out = nullptr;
  float *columns = nullptr;
  float *states = nullptr;
  float *x = nullptr;
  double *system = nullptr;
  double *factor = nullptr;
  double *scale = nullptr;
  double *rhs = nullptr;
  double *solution = nullptr;
  double *hi[2] = {};
  double *taps[2] = {};
  double *twiddle = nullptr;
  float *fftIn = nullptr;
  float *fftOut = nullptr;
  float *fftWork = nullptr;
  double *direct = nullptr;
  double *second = nullptr;
  double *odd = nullptr;
};

extern "C" {

et_sdc *et_sdc_create(void) {
  auto *context = new (std::nothrow) et_sdc();
  if (context == nullptr)
    return nullptr;
  if (!context->prepare()) {
    delete context;
    return nullptr;
  }
  return context;
}

void et_sdc_destroy(et_sdc *context) { delete context; }

void *et_sdc_buffer(et_sdc *context, uint32_t id) {
  return context == nullptr ? nullptr : context->buffer(id);
}

et_status et_sdc_fft(et_sdc *context, uint32_t inverse) {
  if (context == nullptr)
    return ET_ERR_ARGS;
  pffft_transform_ordered(context->fft48, context->io, context->io, context->fftWork,
                          inverse != 0u ? PFFFT_BACKWARD : PFFFT_FORWARD);
  return ET_OK;
}

et_status et_sdc_drive(et_sdc *context) {
  return context == nullptr ? ET_ERR_ARGS : context->runDrive();
}

et_status et_sdc_columns(et_sdc *context) {
  return context == nullptr ? ET_ERR_ARGS : context->runColumns();
}

et_status et_sdc_gram(et_sdc *context, uint32_t q_row) {
  return context == nullptr ? ET_ERR_ARGS : context->runGram(q_row);
}

et_status et_sdc_system(et_sdc *context, uint32_t length, uint32_t fold) {
  return context == nullptr ? ET_ERR_ARGS : context->runSystem(length, fold);
}

et_status et_sdc_solve(et_sdc *context, double lambda, uint32_t slot) {
  return context == nullptr ? ET_ERR_ARGS : context->runSolve(lambda, slot);
}

et_status et_sdc_heldout(et_sdc *context, uint32_t length, uint32_t count, double yy) {
  return context == nullptr ? ET_ERR_ARGS : context->runHeldout(length, count, yy);
}

et_status et_sdc_predict(et_sdc *context, uint32_t length, uint32_t count) {
  return context == nullptr ? ET_ERR_ARGS : context->runPredict(length, count);
}

et_status et_sdc_correct(et_sdc *context, uint32_t length, double scale) {
  return context == nullptr ? ET_ERR_ARGS : context->runCorrect(length, scale);
}

et_status et_sdc_score(et_sdc *context, uint32_t count, double pred_scale) {
  return context == nullptr ? ET_ERR_ARGS : context->runScore(count, pred_scale);
}

} // extern "C"

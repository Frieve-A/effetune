// Native checks of the speaker distortion identification module: the
// transforms, the half-length and fold column reductions, the Gram product and the ridge solve.
#include "test_support.h"

#include "effetune/abi.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <vector>

namespace effetune::sdc {
double besselI0(double x) noexcept;
}

namespace effetune::test {
namespace {

using std::size_t;

constexpr size_t kN = 48000u;
constexpr size_t kRows = 3983u;
constexpr size_t kLd = 2u * kRows + 2u;
constexpr size_t kColumns = 1376u;
constexpr size_t kPadded = 1380u;
constexpr size_t kUnknowns = 1183u;
constexpr size_t kMicColumn = 1374u;
constexpr size_t kMaskedColumn = 700u;
constexpr double kRms = 0.1;
constexpr double kPi = 3.14159265358979323846;

enum : std::uint32_t {
  kIo = 0u,
  kDrive = 1u,
  kG = 2u,
  kExcited = 3u,
  kTermMask = 4u,
  kRowWeight = 5u,
  kCarrier = 6u,
  kGram = 7u,
  kGramTotal = 8u,
  kGramSeed = 9u,
  kWeights = 10u,
  kMic = 12u,
  kColumnsBuffer = 18u,
  kStatesBuffer = 19u,
  kOddBuffer = 20u
};

struct Random {
  std::uint32_t state;
  double next() noexcept {
    state ^= state << 13u;
    state ^= state >> 17u;
    state ^= state << 5u;
    return static_cast<double>(state) / 4294967296.0;
  }
};

template <typename T> T *view(et_sdc *context, std::uint32_t id) {
  return static_cast<T *>(et_sdc_buffer(context, id));
}

struct Table {
  std::vector<double> cosine, sine;
  Table() : cosine(kN), sine(kN) {
    for (size_t n = 0u; n < kN; ++n) {
      cosine[n] = std::cos(2.0 * kPi * static_cast<double>(n) / static_cast<double>(kN));
      sine[n] = std::sin(2.0 * kPi * static_cast<double>(n) / static_cast<double>(kN));
    }
  }
  // sum p[n]*e^(-j2pifn/N) in float64.
  void dft(const std::vector<double> &p, size_t f, double &re, double &im) const {
    re = 0.0;
    im = 0.0;
    for (size_t n = 0u; n < kN; ++n) {
      const size_t index = (f * n) % kN;
      re += p[n] * cosine[index];
      im -= p[n] * sine[index];
    }
  }
};

double hi(size_t f, size_t d) {
  const double norm = sdc::besselI0(4.3);
  double sum = 0.0;
  for (size_t m = 1u; m <= d; m += 2u) {
    const double ratio = static_cast<double>(m) / static_cast<double>(d);
    const double kaiser = sdc::besselI0(4.3 * std::sqrt(1.0 - ratio * ratio)) / norm;
    sum += kaiser *
           std::sin(2.0 * kPi * static_cast<double>((f * m) % kN) / static_cast<double>(kN)) /
           static_cast<double>(m);
  }
  return 4.0 / kPi * sum;
}

void checkBessel() {
  ET_CHECK(sdc::besselI0(0.0) == 1.0);
  const double x = 4.3;
  double sum = 1.0, term = 1.0;
  for (int k = 1; k < 200; ++k) {
    term *= x * x * 0.25 / (static_cast<double>(k) * static_cast<double>(k));
    sum += term;
  }
  ET_CHECK(std::fabs(sdc::besselI0(x) - sum) <= 1e-15 * sum);
}

void checkFft(et_sdc *context, const Table &table) {
  float *io = view<float>(context, kIo);
  Random random{12345u};
  std::vector<double> signal(kN);
  for (size_t n = 0u; n < kN; ++n) {
    io[n] = static_cast<float>(random.next() - 0.5);
    signal[n] = io[n];
  }
  ET_CHECK(et_sdc_fft(context, 0u) == ET_OK);
  double worst = 0.0;
  for (size_t i = 0u; i < 100u; ++i) {
    const size_t k = 1u + i * 239u;
    double re = 0.0, im = 0.0;
    table.dft(signal, k, re, im);
    const double error = std::hypot(io[2u * k] - re, io[2u * k + 1u] - im);
    worst = error > worst ? error : worst;
  }
  double re = 0.0, im = 0.0;
  table.dft(signal, 0u, re, im);
  worst = std::fabs(io[0] - re) > worst ? std::fabs(io[0] - re) : worst;
  table.dft(signal, kN / 2u, re, im);
  worst = std::fabs(io[1] - re) > worst ? std::fabs(io[1] - re) : worst;
  // Bins of uniform noise have magnitude near sqrt(N/12) ~ 63.
  ET_CHECK(worst < 63.0 * 1e-4);
  ET_CHECK(et_sdc_fft(context, 1u) == ET_OK);
  double roundTrip = 0.0;
  for (size_t n = 0u; n < kN; ++n) {
    const double error = std::fabs(io[n] / static_cast<double>(kN) - signal[n]);
    roundTrip = error > roundTrip ? error : roundTrip;
  }
  ET_CHECK(roundTrip < 1e-5);
}

// Pair (a, b) of states of direct column c (asset term order).
void termPair(size_t c, size_t &a, size_t &b) {
  if (c < 528u) {
    size_t term = 0u;
    for (a = 0u; a < 32u; ++a)
      for (b = a; b < 32u; ++b)
        if (term++ == c)
          return;
  }
  if (c < 912u) {
    const size_t offset = c < 720u ? c - 528u : c - 720u;
    a = offset / 6u;
    b = 32u + 2u * (offset % 6u) + (c < 720u ? 0u : 1u);
    return;
  }
  size_t term = 912u;
  for (a = 32u; a < 44u; ++a)
    for (b = a; b < 44u; ++b)
      if (term++ == c)
        return;
}

void checkColumns(et_sdc *context, const Table &table) {
  float *drive = view<float>(context, kDrive);
  float *g = view<float>(context, kG);
  std::uint8_t *excited = view<std::uint8_t>(context, kExcited);
  std::uint8_t *mask = view<std::uint8_t>(context, kTermMask);
  Random random{777u};
  // Even drive bins put every microphone product on an even (row) frequency.
  std::vector<size_t> bins;
  for (size_t i = 0u; i < 40u; ++i) {
    const size_t k = 2u * (10u + static_cast<size_t>(random.next() * 3990.0));
    if (excited[k] != 0u)
      continue;
    const double phase = 2.0 * kPi * random.next();
    drive[2u * k] = static_cast<float>(0.011 * std::cos(phase));
    drive[2u * k + 1u] = static_cast<float>(0.011 * std::sin(phase));
    excited[k] = 1u;
    bins.push_back(k);
  }
  for (size_t f = 0u; f <= 8000u; ++f) {
    g[2u * f] = static_cast<float>(1.0 + 0.3 * std::cos(static_cast<double>(f) / 1000.0));
    g[2u * f + 1u] = static_cast<float>(0.2 * std::sin(static_cast<double>(f) / 700.0));
  }
  for (size_t c = 0u; c < kColumns; ++c)
    mask[c] = c == kMaskedColumn ? 0u : 1u;
  ET_CHECK(et_sdc_drive(context) == ET_OK);
  ET_CHECK(et_sdc_columns(context) == ET_OK);

  const float *states = view<float>(context, kStatesBuffer);
  const float *columns = view<float>(context, kColumnsBuffer);
  std::vector<double> product(kN);
  std::vector<size_t> rows;
  for (size_t r = 0u; r < kRows; r += 80u)
    rows.push_back(r);
  // Largest error of column c against the direct spectrum on `rows`, relative to the largest
  // magnitude of the whole column.
  auto relative = [&](size_t c, const std::vector<double> &expectedRe,
                      const std::vector<double> &expectedIm) {
    double error = 0.0, peak = 0.0;
    for (size_t i = 0u; i < rows.size(); ++i) {
      const size_t r = rows[i];
      const double e = std::hypot(columns[c * kLd + r] - expectedRe[i],
                                  columns[c * kLd + kRows + r] - expectedIm[i]);
      error = e > error ? e : error;
    }
    for (size_t r = 0u; r < kRows; ++r) {
      const double m = std::hypot(columns[c * kLd + r], columns[c * kLd + kRows + r]);
      peak = m > peak ? m : peak;
    }
    return peak > 0.0 ? error / peak : 1.0;
  };
  auto direct = [&](size_t c, std::vector<double> &re, std::vector<double> &im) {
    size_t a = 0u, b = 0u;
    termPair(c, a, b);
    for (size_t n = 0u; n < kN; ++n)
      product[n] = static_cast<double>(states[a * kN + n]) * states[b * kN + n];
    re.assign(rows.size(), 0.0);
    im.assign(rows.size(), 0.0);
    for (size_t i = 0u; i < rows.size(); ++i) {
      table.dft(product, 2u * (rows[i] + 18u), re[i], im[i]);
      re[i] *= kRms / static_cast<double>(kN);
      im[i] *= kRms / static_cast<double>(kN);
    }
  };
  std::vector<double> re, im;
  for (const size_t c : {0u, 100u, 527u, 528u, 650u, 720u, 911u, 912u, 989u}) {
    direct(c, re, im);
    ET_CHECK(relative(c, re, im) < 1e-6);
  }
  // Second sums: j*Hi times the low x high peak column of the same pair.
  for (const size_t c : {990u, 1100u, 1181u, 1182u, 1373u}) {
    const bool shortLength = c < 1182u;
    direct(528u + c - (shortLength ? 990u : 1182u), re, im);
    for (size_t i = 0u; i < rows.size(); ++i) {
      const double h = hi(2u * (rows[i] + 18u), shortLength ? 30u : 120u);
      const double sourceRe = re[i];
      re[i] = -h * im[i];
      im[i] = h * sourceRe;
    }
    ET_CHECK(relative(c, re, im) < 1e-6);
  }
  // Microphone column: DFT(y_lin^2)/N divided by g, with y_lin synthesized in float64.
  std::vector<double> linear(kN, 0.0);
  for (const size_t k : bins) {
    const double gr = g[2u * k], gi = g[2u * k + 1u];
    const double xr = drive[2u * k], xi = drive[2u * k + 1u];
    const double zr = gr * xr - gi * xi, zi = gr * xi + gi * xr;
    for (size_t n = 0u; n < kN; ++n) {
      const size_t index = (k * n) % kN;
      linear[n] += 2.0 * (zr * table.cosine[index] - zi * table.sine[index]);
    }
  }
  for (size_t n = 0u; n < kN; ++n)
    product[n] = linear[n] * linear[n];
  // Rows at sum and difference frequencies of drive pairs, where the products land.
  rows.clear();
  for (size_t i = 0u; i < bins.size() && rows.size() < 50u; ++i) {
    for (size_t j = i + 1u; j < bins.size() && j < i + 3u; ++j) {
      const size_t sum = bins[i] + bins[j];
      const size_t difference = bins[i] > bins[j] ? bins[i] - bins[j] : bins[j] - bins[i];
      if (sum <= 8000u)
        rows.push_back(sum / 2u - 18u);
      if (difference >= 36u)
        rows.push_back(difference / 2u - 18u);
    }
  }
  re.assign(rows.size(), 0.0);
  im.assign(rows.size(), 0.0);
  for (size_t i = 0u; i < rows.size(); ++i) {
    const size_t f = 2u * (rows[i] + 18u);
    double mr = 0.0, mi = 0.0;
    table.dft(product, f, mr, mi);
    mr /= static_cast<double>(kN);
    mi /= static_cast<double>(kN);
    const double gr = g[2u * f], gi = g[2u * f + 1u];
    const double magnitude = gr * gr + gi * gi;
    re[i] = (mr * gr + mi * gi) / magnitude;
    im[i] = (mi * gr - mr * gi) / magnitude;
  }
  ET_CHECK(rows.size() >= 20u);
  ET_CHECK(relative(kMicColumn, re, im) < 1e-5);

  bool zero = true;
  for (size_t t = 0u; t < kLd; ++t)
    zero = zero && columns[kMaskedColumn * kLd + t] == 0.0F && columns[1375u * kLd + t] == 0.0F;
  ET_CHECK(zero);
}

void checkGram(et_sdc *context) {
  double *rowWeight = view<double>(context, kRowWeight);
  double *carrier = view<double>(context, kCarrier);
  Random random{4242u};
  for (size_t r = 0u; r < kRows; ++r) {
    rowWeight[r] = 0.5 + random.next();
    carrier[2u * r] = random.next() - 0.5;
    carrier[2u * r + 1u] = random.next() - 0.5;
  }
  ET_CHECK(et_sdc_gram(context, static_cast<std::uint32_t>(kRows + 1u)) == ET_ERR_ARGS);
  const std::uint32_t qRow = 2000u;
  ET_CHECK(et_sdc_gram(context, qRow) == ET_OK);
  const float *columns = view<float>(context, kColumnsBuffer);
  const double *gram = view<double>(context, kGram);
  bool micCut = true;
  for (size_t r = qRow; r < kRows; ++r)
    micCut = micCut && columns[kMicColumn * kLd + r] == 0.0F &&
             columns[kMicColumn * kLd + kRows + r] == 0.0F;
  ET_CHECK(micCut);
  ET_CHECK(std::fabs(columns[1375u * kLd] - carrier[0] * rowWeight[0]) < 1e-6);

  std::vector<size_t> picks;
  for (size_t c = 0u; c < kColumns; c += 37u)
    picks.push_back(c);
  picks.push_back(kMicColumn);
  picks.push_back(1375u);
  double worst = 0.0;
  for (const size_t i : picks) {
    for (const size_t j : picks) {
      if (j > i)
        continue;
      double exact = 0.0, normI = 0.0, normJ = 0.0;
      for (size_t t = 0u; t < kLd; ++t) {
        const double a = columns[i * kLd + t], b = columns[j * kLd + t];
        exact += a * b;
        normI += a * a;
        normJ += b * b;
      }
      const double norm = std::sqrt(normI * normJ);
      const double error = std::fabs(gram[i * kPadded + j] - exact);
      if (norm > 0.0)
        worst = error / norm > worst ? error / norm : worst;
      else
        ET_CHECK(gram[i * kPadded + j] == 0.0);
    }
  }
  ET_CHECK(worst < 1e-5);
}

void checkSolve(et_sdc *context) {
  double *total = view<double>(context, kGramTotal);
  double *seed = view<double>(context, kGramSeed);
  const double *weights = view<double>(context, kWeights);
  Random random{99u};
  std::vector<double> full(kColumns * kColumns, 0.0);
  for (size_t i = 0u; i < kColumns; ++i) {
    for (size_t j = 0u; j < i; ++j) {
      const double value = 0.01 * (random.next() - 0.5);
      full[i * kColumns + j] = value;
      full[j * kColumns + i] = value;
    }
    full[i * kColumns + i] = 10.0 + 100.0 * random.next();
  }
  // Unknown 5 has an all-zero column.
  for (size_t j = 0u; j < kColumns; ++j) {
    full[5u * kColumns + j] = 0.0;
    full[j * kColumns + 5u] = 0.0;
  }
  for (size_t i = 0u; i < kColumns; ++i) {
    for (size_t j = 0u; j <= i; ++j) {
      total[i * (i + 1u) / 2u + j] = full[i * kColumns + j];
      seed[i * (i + 1u) / 2u + j] = 0.25 * full[i * kColumns + j];
    }
  }
  // Short unknowns: direct terms, the Short second sum and the microphone.
  std::vector<size_t> map(kUnknowns);
  for (size_t i = 0u; i < kUnknowns; ++i)
    map[i] = i < 1182u ? i : kMicColumn;
  for (const std::uint32_t fold : {0u, 1u}) {
    const double lambda = 0.01;
    ET_CHECK(et_sdc_system(context, 0u, fold) == ET_OK);
    ET_CHECK(et_sdc_solve(context, lambda, 3u) == ET_OK);
    const double *w = weights + 3u * kUnknowns;
    const double factor = fold != 0u ? 0.75 : 1.0;
    double residual = 0.0, rhsNorm = 0.0;
    for (size_t i = 0u; i < kUnknowns; ++i) {
      if (i == 5u)
        continue;
      const size_t ci = map[i];
      const double diagonal = factor * full[ci * kColumns + ci];
      double sum = (i < 1182u ? lambda : 1e-6) * diagonal * w[i];
      for (size_t j = 0u; j < kUnknowns; ++j)
        sum += factor * full[ci * kColumns + map[j]] * w[j];
      const double b = factor * full[1375u * kColumns + ci];
      residual = std::fabs(sum - b) > residual ? std::fabs(sum - b) : residual;
      rhsNorm = std::fabs(b) > rhsNorm ? std::fabs(b) : rhsNorm;
    }
    ET_CHECK(residual < 1e-12 * rhsNorm);
    ET_CHECK(w[5] == 0.0);
  }
  ET_CHECK(et_sdc_solve(context, 0.0, 24u) == ET_ERR_ARGS);
  ET_CHECK(et_sdc_system(context, 2u, 0u) == ET_ERR_ARGS);
  // An indefinite system fails without writing the slot.
  const double kept = weights[3u * kUnknowns];
  ET_CHECK(et_sdc_solve(context, -2.0, 3u) == ET_ERR_STATE);
  ET_CHECK(weights[3u * kUnknowns] == kept);
  total[0] = -1.0;
  ET_CHECK(et_sdc_system(context, 0u, 0u) == ET_OK);
  ET_CHECK(et_sdc_solve(context, 0.01, 4u) == ET_ERR_STATE);
}

// The odd block of et_sdc_correct: a zero ODD buffer leaves the corrected
// period bit-identical, and the odd term is the held clamped cubic of the low states in STATES.
void checkCorrectOdd(et_sdc *context) {
  const float *io = view<float>(context, kIo);
  double *weights = view<double>(context, kWeights);
  double *odd = view<double>(context, kOddBuffer);
  const float *states = view<float>(context, kStatesBuffer);
  ET_CHECK(odd != nullptr);
  if (odd == nullptr)
    return;
  for (size_t i = 0u; i < kUnknowns; ++i)
    weights[i] = 0.0;
  for (size_t a = 0u; a < 64u; ++a)
    odd[a] = 0.0;
  // No weights at all: IO is the drive period.
  ET_CHECK(et_sdc_correct(context, 0u, 1.0) == ET_OK);
  const std::vector<float> plain(io, io + kN);

  // Even weights with a zero ODD, before and after a non-zero ODD: bit-identical periods.
  Random random{31u};
  for (size_t i = 0u; i < 1182u; ++i)
    weights[i] = 1e-3 * (random.next() - 0.5);
  ET_CHECK(et_sdc_correct(context, 1u, -0.7) == ET_OK);
  const std::vector<float> even(io, io + kN);
  odd[3] = 0.05;
  odd[32u + 3u] = 1.0;
  ET_CHECK(et_sdc_correct(context, 1u, -0.7) == ET_OK);
  bool changed = false;
  for (size_t n = 0u; n < kN; ++n)
    changed = changed || io[n] != even[n];
  ET_CHECK(changed);
  odd[3] = 0.0;
  ET_CHECK(et_sdc_correct(context, 1u, -0.7) == ET_OK);
  bool identical = true;
  for (size_t n = 0u; n < kN; ++n)
    identical = identical && io[n] == even[n];
  ET_CHECK(identical);

  // Odd alone: bounds below the state peak on half of the states so that the clamp acts.
  for (size_t i = 0u; i < 1182u; ++i)
    weights[i] = 0.0;
  for (size_t a = 0u; a < 32u; ++a) {
    double peak = 0.0;
    for (size_t n = 0u; n < kN; ++n) {
      const double s = std::fabs(states[a * kN + n]);
      peak = s > peak ? s : peak;
    }
    odd[a] = 0.2 * (random.next() - 0.5);
    odd[32u + a] = peak > 0.0 ? ((a & 1u) != 0u ? 0.5 : 2.0) * peak : 1.0;
  }
  const double scale = -0.7;
  ET_CHECK(et_sdc_correct(context, 0u, scale) == ET_OK);
  double worst = 0.0, termPeak = 0.0, plainPeak = 0.0;
  for (size_t n = 0u; n < kN; ++n) {
    const size_t held = n & ~static_cast<size_t>(3u);
    double sum = 0.0;
    for (size_t a = 0u; a < 32u; ++a) {
      double s = 0.7 * static_cast<double>(states[a * kN + held]) / odd[32u + a];
      s = s > 1.0 ? 1.0 : (s < -1.0 ? -1.0 : s);
      sum += odd[a] * s * s * s;
    }
    const double term = kRms * sum / scale;
    const double expected = static_cast<double>(plain[n]) - term;
    const double error = std::fabs(io[n] - expected);
    worst = error > worst ? error : worst;
    termPeak = std::fabs(term) > termPeak ? std::fabs(term) : termPeak;
    plainPeak = std::fabs(plain[n]) > plainPeak ? std::fabs(plain[n]) : plainPeak;
  }
  // Only the float32 rounding of IO separates the period from the float64 form.
  ET_CHECK(worst < 1.2e-7 * (plainPeak + termPeak));
  ET_CHECK(termPeak > 1e-3 * plainPeak);

  // A non-zero weight needs a finite, positive bound.
  odd[32u + 5u] = 0.0;
  ET_CHECK(et_sdc_correct(context, 0u, scale) == ET_ERR_ARGS);
  for (size_t a = 0u; a < 64u; ++a)
    odd[a] = 0.0;
}

void runSpeakerDistortionFitTests() {
  checkBessel();
  et_sdc *context = et_sdc_create();
  ET_CHECK(context != nullptr);
  if (context == nullptr)
    return;
  ET_CHECK(et_sdc_buffer(context, 21u) == nullptr);
  const Table table;
  checkFft(context, table);
  checkColumns(context, table);
  checkGram(context);
  checkSolve(context);
  checkCorrectOdd(context);
  et_sdc_destroy(context);
}

// Registers the checks with the shared test executable before main reports the failure count.
const struct SpeakerDistortionFitTests {
  SpeakerDistortionFitTests() { runSpeakerDistortionFitTests(); }
} kSpeakerDistortionFitTests;
} // namespace

} // namespace effetune::test

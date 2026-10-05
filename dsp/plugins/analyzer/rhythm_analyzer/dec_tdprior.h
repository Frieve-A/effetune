// The TD tempo prior as the weight of the shadow output's level choice (a3p Shadow, variant
// f|w16|free|moct): the latest ready prior rows (TdpPrior::grid(): binary16 probabilities on
// kTdGrid log-tempo points) and the prior-weighted level mass eff(Pg, T). np.interp, np.log and
// np.exp are reproduced per value (the portable functions for the logarithm and exponential).
#pragma once
#include <cmath>
#include <cstdint>

#include "dec_const.h"
#include "dec_math.h"

namespace effetune::plugins::analyzer::rhythm_a3::dec {

inline constexpr int32_t kTdGrid = 167;
inline constexpr int32_t kTdRows = 16; // rows held: the confirmation clock may trail the stream
inline constexpr double kTdW = 16.0;   // prior exponent w
inline constexpr double kTdFloorLog = -0x1.01e3b843eaa73p+4; // math.log(1e-7)
inline constexpr double kTdFloor = 1e-7;
inline constexpr double kLn2 = 0x1.62e42fefa39efp-1;
// Grid points as ln BPM: float32(log2(30) + .02 i) * math.log(2).
inline constexpr double kTdGridX[kTdGrid] = {
    0x1.b35a6e621da55p+1, 0x1.b520b11271543p+1, 0x1.b6e6f6888d62fp+1, 0x1.b8ad3938e111dp+1,
    0x1.ba737be934c0bp+1, 0x1.bc39be99886f9p+1, 0x1.be000149dc1e7p+1, 0x1.bfc643fa2fcd5p+1,
    0x1.c18c86aa837c3p+1, 0x1.c352c95ad72b1p+1, 0x1.c5190c0b2ad9fp+1, 0x1.c6df4ebb7e88dp+1,
    0x1.c8a5916bd237bp+1, 0x1.ca6bd41c25e6ap+1, 0x1.cc3216cc79958p+1, 0x1.cdf8597ccd446p+1,
    0x1.cfbe9c2d20f34p+1, 0x1.d184dedd74a22p+1, 0x1.d34b218dc8510p+1, 0x1.d511643e1bffep+1,
    0x1.d6d7a6ee6faecp+1, 0x1.d89de99ec35dap+1, 0x1.da642c4f170c8p+1, 0x1.dc2a6eff6abb6p+1,
    0x1.ddf0b1afbe6a4p+1, 0x1.dfb6f46012192p+1, 0x1.e17d371065c81p+1, 0x1.e3437c8681d6dp+1,
    0x1.e509bf36d585bp+1, 0x1.e6d001e729349p+1, 0x1.e89644977ce37p+1, 0x1.ea5c8747d0925p+1,
    0x1.ec22c9f824413p+1, 0x1.ede90ca877f01p+1, 0x1.efaf4f58cb9efp+1, 0x1.f17592091f4ddp+1,
    0x1.f33bd4b972fcbp+1, 0x1.f5021769c6ab9p+1, 0x1.f6c85a1a1a5a7p+1, 0x1.f88e9cca6e095p+1,
    0x1.fa54df7ac1b84p+1, 0x1.fc1b222b15672p+1, 0x1.fde164db69160p+1, 0x1.ffa7a78bbcc4ep+1,
    0x1.00b6f51e0839ep+2, 0x1.019a167632115p+2, 0x1.027d37ce5be8cp+2, 0x1.0360592685c03p+2,
    0x1.04437a7eaf97ap+2, 0x1.05269bd6d96f1p+2, 0x1.0609bd2f03468p+2, 0x1.06ecde872d1dfp+2,
    0x1.07d001423b255p+2, 0x1.08b3229a64fccp+2, 0x1.099643f28ed43p+2, 0x1.0a79654ab8abap+2,
    0x1.0b5c86a2e2831p+2, 0x1.0c3fa7fb0c5a8p+2, 0x1.0d22c9533631fp+2, 0x1.0e05eaab60096p+2,
    0x1.0ee90c0389e0ep+2, 0x1.0fcc2d5bb3b85p+2, 0x1.10af4eb3dd8fcp+2, 0x1.1192700c07673p+2,
    0x1.12759164313eap+2, 0x1.1358b2bc5b161p+2, 0x1.143bd41484ed8p+2, 0x1.151ef56caec4fp+2,
    0x1.160216c4d89c6p+2, 0x1.16e5381d0273dp+2, 0x1.17c859752c4b4p+2, 0x1.18ab7acd5622bp+2,
    0x1.198e9c257ffa2p+2, 0x1.1a71bd7da9d19p+2, 0x1.1b54ded5d3a90p+2, 0x1.1c38002dfd807p+2,
    0x1.1d1b21862757ep+2, 0x1.1dfe4441355f4p+2, 0x1.1ee165995f36bp+2, 0x1.1fc486f1890e2p+2,
    0x1.20a7a849b2e59p+2, 0x1.218ac9a1dcbd0p+2, 0x1.226deafa06947p+2, 0x1.23510c52306bep+2,
    0x1.24342daa5a435p+2, 0x1.25174f02841acp+2, 0x1.25fa705aadf23p+2, 0x1.26dd91b2d7c9bp+2,
    0x1.27c0b30b01a12p+2, 0x1.28a3d4632b789p+2, 0x1.2986f5bb55500p+2, 0x1.2a6a17137f277p+2,
    0x1.2b4d386ba8feep+2, 0x1.2c3059c3d2d65p+2, 0x1.2d137b1bfcadcp+2, 0x1.2df69c7426853p+2,
    0x1.2ed9bdcc505cap+2, 0x1.2fbcdf247a341p+2, 0x1.30a0007ca40b8p+2, 0x1.318321d4cde2fp+2,
    0x1.3266432cf7ba6p+2, 0x1.334964852191dp+2, 0x1.342c87402f993p+2, 0x1.350fa8985970ap+2,
    0x1.35f2c9f083481p+2, 0x1.36d5eb48ad1f8p+2, 0x1.37b90ca0d6f6fp+2, 0x1.389c2df900ce6p+2,
    0x1.397f4f512aa5dp+2, 0x1.3a6270a9547d4p+2, 0x1.3b4592017e54bp+2, 0x1.3c28b359a82c2p+2,
    0x1.3d0bd4b1d2039p+2, 0x1.3deef609fbdb1p+2, 0x1.3ed2176225b28p+2, 0x1.3fb538ba4f89fp+2,
    0x1.40985a1279616p+2, 0x1.417b7b6aa338dp+2, 0x1.425e9cc2cd104p+2, 0x1.4341be1af6e7bp+2,
    0x1.4424df7320bf2p+2, 0x1.450800cb4a969p+2, 0x1.45eb2223746e0p+2, 0x1.46ce437b9e457p+2,
    0x1.47b164d3c81cep+2, 0x1.4894862bf1f45p+2, 0x1.4977a7841bcbcp+2, 0x1.4a5aca3f29d32p+2,
    0x1.4b3deb9753aa9p+2, 0x1.4c210cef7d820p+2, 0x1.4d042e47a7597p+2, 0x1.4de74f9fd130ep+2,
    0x1.4eca70f7fb085p+2, 0x1.4fad925024dfcp+2, 0x1.5090b3a84eb73p+2, 0x1.5173d500788eap+2,
    0x1.5256f658a2661p+2, 0x1.533a17b0cc3d8p+2, 0x1.541d3908f614fp+2, 0x1.55005a611fec6p+2,
    0x1.55e37bb949c3ep+2, 0x1.56c69d11739b5p+2, 0x1.57a9be699d72cp+2, 0x1.588cdfc1c74a3p+2,
    0x1.59700119f121ap+2, 0x1.5a5322721af91p+2, 0x1.5b3643ca44d08p+2, 0x1.5c1965226ea7fp+2,
    0x1.5cfc867a987f6p+2, 0x1.5ddfa7d2c256dp+2, 0x1.5ec2c92aec2e4p+2, 0x1.5fa5ea831605bp+2,
    0x1.60890d3e240d1p+2, 0x1.616c2e964de48p+2, 0x1.624f4fee77bbfp+2, 0x1.63326fe3bd637p+2,
    0x1.6415929ecb6adp+2, 0x1.64f8b29411125p+2, 0x1.65dbd54f1f19bp+2, 0x1.66bef54464c13p+2,
    0x1.67a217ff72c89p+2, 0x1.688537f4b8701p+2, 0x1.69685aafc6777p+2, 0x1.6a4b7aa50c1efp+2,
    0x1.6b2e9d601a265p+2, 0x1.6c11c01b282dbp+2, 0x1.6cf4e0106dd54p+2,
};

// LV_MOCT[g][h]: level h is level g, its double or its half.
[[nodiscard]] inline bool levelOctave(int32_t g, int32_t h) noexcept {
  const double d = kLvLogNd[h] - kLvLogNd[g];
  return std::fabs(d - -kLn2) < 1e-9 || std::fabs(d - 0.0) < 1e-9 || std::fabs(d - kLn2) < 1e-9;
}

// A ready prior row: its start tick (the front end's reset or restart), its time s (seconds of
// ticks since that start) and its grid row.
struct DecTdRow {
  int64_t base;
  double s;
  float grid[kTdGrid];
};

class DecTdPrior {
public:
  void reset() noexcept {
    head_ = count_ = 0;
    evictedBase_ = -1;
  }

  // A ready row, in time order within a base; the oldest is overwritten when full.
  void push(int64_t base, double s, const float *grid) noexcept {
    DecTdRow &r = rows_[(head_ + count_) % kTdRows];
    if (count_ == kTdRows) {
      evictedBase_ = r.base;
      evictedS_ = r.s;
      head_ = (head_ + 1) % kTdRows;
    } else
      ++count_;
    r.base = base;
    r.s = s;
    for (int32_t i = 0; i < kTdGrid; ++i)
      r.grid[i] = grid[i];
  }

  // The latest row of base with s <= x (TPrior.lnp's row), or null; stale counts a lookup whose row
  // was overwritten (the oldest held row of the base is used instead).
  [[nodiscard]] const DecTdRow *at(int64_t base, double x, int64_t &stale) const noexcept {
    const DecTdRow *oldest = nullptr;
    for (int32_t q = count_ - 1; q >= 0; --q) {
      const DecTdRow &r = rows_[(head_ + q) % kTdRows];
      if (r.base != base)
        continue;
      if (r.s <= x)
        return &r;
      oldest = &r;
    }
    if (oldest != nullptr && evictedBase_ == base && evictedS_ <= x) {
      ++stale;
      return oldest;
    }
    return nullptr;
  }

  // np.interp(x, kTdGridX, ln max(row, 1e-7), left = right = ln 1e-7).
  [[nodiscard]] static double lnp(const DecTdRow &r, double x) noexcept {
    if (std::isnan(x))
      return x;
    if (x > kTdGridX[kTdGrid - 1] || x < kTdGridX[0])
      return kTdFloorLog;
    const int32_t j = searchRight(kTdGridX, kTdGrid, x) - 1;
    if (j >= kTdGrid - 1 || kTdGridX[j] == x)
      return lnAt(r, j);
    const double y0 = lnAt(r, j), y1 = lnAt(r, j + 1);
    const double slope = (y1 - y0) / (kTdGridX[j + 1] - kTdGridX[j]);
    double v = slope * (x - kTdGridX[j]) + y0;
    if (std::isnan(v)) {
      v = slope * (x - kTdGridX[j + 1]) + y1;
      if (std::isnan(v) && y0 == y1)
        v = y0;
    }
    return v;
  }

  // Shadow.eff: the level mass Pg weighted by the prior at clock period T, restricted to the
  // octaves of the master's output level g (unless that leaves nothing), normalised. Without a
  // row: Pg normalised.
  static void eff(const double *Pg, double T, const DecTdRow *r, int32_t g, double *e) noexcept {
    if (r == nullptr) {
      const double s = pairwiseSum(Pg, kLvG);
      for (int32_t k = 0; k < kLvG; ++k)
        e[k] = Pg[k] / s;
      return;
    }
    const double x = portableLog(60.0 / T);
    double lp[kLvG];
    for (int32_t k = 0; k < kLvG; ++k)
      lp[k] = lnp(*r, x - kLvLogNd[k]);
    double mx = lp[0];
    for (int32_t k = 1; k < kLvG; ++k)
      mx = lp[k] > mx ? lp[k] : mx;
    double eo[kLvG];
    for (int32_t k = 0; k < kLvG; ++k) {
      e[k] = Pg[k] * portableExp(kTdW * (lp[k] - mx));
      eo[k] = e[k] * (levelOctave(g, k) ? 1.0 : 0.0);
    }
    if (pairwiseSum(eo, kLvG) > 0.0) {
      for (int32_t k = 0; k < kLvG; ++k)
        e[k] = eo[k];
    }
    const double s = pairwiseSum(e, kLvG);
    for (int32_t k = 0; k < kLvG; ++k)
      e[k] = e[k] / s;
  }

private:
  // ln max(p, 1e-7) of grid point i (the row's binary16 value as float64).
  static double lnAt(const DecTdRow &r, int32_t i) noexcept {
    const double p = static_cast<double>(r.grid[i]);
    return portableLog(p > kTdFloor ? p : kTdFloor);
  }

  DecTdRow rows_[kTdRows] = {};
  int32_t head_ = 0, count_ = 0;
  int64_t evictedBase_ = -1; // the last overwritten row's base and time
  double evictedS_ = 0.0;
};

} // namespace effetune::plugins::analyzer::rhythm_a3::dec

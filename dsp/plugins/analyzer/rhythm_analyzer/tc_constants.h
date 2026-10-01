// Generated; do not edit. Values are the reference front end's own doubles.
#pragma once

#include <cstdint>

namespace effetune::plugins::analyzer::rhythm_a3::tc {

struct RateConstants {
  double rate;
  std::uint32_t hop, size;
  double bias[3];     // per-band onset bias (s): kBias48k below 72 kHz, kBias96k above
  double hopOverRate; // hop / rate as Python divides it
  double gridT0;      // fe.grid t0 of a tick (s)
  double gridLatency; // fe.grid latency of a tick (s)
};

inline constexpr RateConstants kRates[3] = {
    {48000.0,
     128u,
     1024u,
     {0x1.4face67d77faep-8, 0x1.320d9945b6c37p-8, 0x1.8b502ababead5p-8},
     0x1.5d867c3ece2a5p-9,
     0x1.6ce789e774ef0p-10,
     0x1.2fe98b01df8c7p-7},
    {96000.0,
     256u,
     2048u,
     {0x1.51e75360d0247p-8, 0x1.37b07075b3e14p-8, 0x1.97e56473471f8p-8},
     0x1.5d867c3ece2a5p-9,
     0x1.51a437824d4ccp-10,
     0x1.3351f54e8480cp-7},
    {192000.0,
     512u,
     4096u,
     {0x1.51e75360d0247p-8, 0x1.37b07075b3e14p-8, 0x1.97e56473471f8p-8},
     0x1.5d867c3ece2a5p-9,
     0x1.51a437824d4ccp-10,
     0x1.3351f54e8480cp-7},
};

inline constexpr std::uint32_t kBandBins[3][2] = {
    {1u, 5u}, {4u, 86u}, {85u, 342u}}; // [begin, end) FFT bins, every rate
inline constexpr std::uint32_t kBinLo = 1u, kBinHi = 342u, kFlatBegin = 4u; // flat: Mid+High bins
inline constexpr std::uint32_t kRingLength = 6u, kPool = 4u;

inline constexpr double kFeAMean =
    0x1.af21f77c9b780p-6; // rep.config a_mean = 1.0 - np.exp(-1.0 / (.1 * 375.0))
inline constexpr double kFeOneMinusAMean =
    0x1.f286f0441b244p-1; // rep.pick (1.0 - a_mean); running_stats -(1.0 - a) is its negation
inline constexpr double kFeDPeak =
    0x1.ff8b8b17224f4p-1; // rep.config d_peak = np.exp(-1.0 / (3.0 * 375.0))
inline constexpr double kFeVarB0 = 0x1.a3c9a9ed3e348p-6; // running_stats lfilter b0 = (1.0 - a) * a
inline constexpr double kFePeakLd = -0x1.d208a5a912cb7p-11; // running_stats ld = math.log(d)
inline constexpr double kFePeakInit =
    -0x1.ba2739de2d429p+2; // running_stats init = math.log(1e-3) + ld
inline constexpr double kFeNoveltyFloor = 0x1.47ae147ae147bp-5;  // fe NOVELTY_FLOOR
inline constexpr double kFeDbFloor = 0x1.79ca10c924223p-67;      // fe DB_FLOOR
inline constexpr double kFeThresholdSd = 0x1.c000000000000p+1;   // rep THRESHOLD_SD
inline constexpr double kFeThresholdAbs = 0x1.0624dd2f1a9fcp-8;  // rep THRESHOLD_ABS
inline constexpr double kFeThresholdPeak = 0x1.47ae147ae147bp-4; // rep THRESHOLD_PEAK
inline constexpr double kFeRefractory = 0x1.70a3d70a3d70ap-5;    // rep REFRACTORY
inline constexpr double kFePeakStart = 0x1.0624dd2f1a9fcp-10;    // rep.pick peak = 1e-3
inline constexpr double kG1Dt = 0x1.5d867c3ece2a5p-7;            // DT = 1.0 / FPS
inline constexpr double kG1T0 = -0x1.5d867c3ece2a5p-7;           // T0 = DT - LATENCY (act t0)
inline constexpr double kG1Latency = 0x1.5d867c3ece2a5p-6;       // LATENCY = 2 * DT (act latency)
inline constexpr double kG1PeakD =
    0x1.fe2ecb32ea563p-1; // base_channels d = math.exp(-DT / PEAK_TAU)
inline constexpr double kG1PeakLd = -0x1.d208a5a912e31p-9;   // decaying_peak ld = -DT / tau
inline constexpr double kG1PeakInit = -0x1.f531ada42bffbp+1; // decaying_peak math.log(init) + ld
inline constexpr double kG1PeakFloor = 0x1.47ae147ae147bp-6; // PEAK_FLOOR
inline constexpr double kG1PeakLogFloor =
    0x1.4484bfeebc2a0p-100; // decaying_peak np.maximum(f, 1e-30)
inline constexpr double kG1MeanA =
    0x1.9e696f20282e8p-4; // base_channels a = 1.0 - math.exp(-DT / MEAN_TAU)
inline constexpr double kG1MeanA1 = -0x1.cc32d21bfafa3p-1; // lfilter a1 = a - 1.0
inline constexpr double kG1VarB0 = 0x1.747bdc32a2854p-4;   // lfilter b0 = (1.0 - a) * a
inline constexpr double kG1SdFloor = 0x1.0624dd2f1a9fcp-8; // SD_FLOOR
inline constexpr double kG1EmaA =
    0x1.5baaf5817b640p-7; // ema a = 1.0 - math.exp(-1.0 / (LEVEL_TAU * FPS))
inline constexpr double kG1EmaA1 = -0x1.fa915429fa127p-1;     // ema lfilter a1 = a - 1.0
inline constexpr double kG1EmaZi = 0x1.fa915429fa127p-1;      // ema zi = (1.0 - a) * x0
inline constexpr double kG1RiseC = 0x1.0624dd2f1a9fcp-5;      // rise = FLOOR_RISE * DT * arange(T)
inline constexpr double kG1LogeFloor = 0x1.b7cdfd9d7bdbbp-34; // LOGE_FLOOR
inline constexpr double kG1LogeC[3] = {0x1.780100f510e20p+2, 0x1.240d3a7da82aap+2,
                                       0x1.044ccf72bf835p+2}; // np.log10(3e6 / [4, 82, 257])

} // namespace effetune::plugins::analyzer::rhythm_a3::tc

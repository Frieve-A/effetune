// FM Radio Simulator: physical FM broadcast transmission -> propagation -> reception
// chain on the three-tier split-rate layout (host / MPX / RF core). Every arithmetic
// step matches the JS reference processor
// in plugins/lofi/fm_radio_simulator.js bit for bit so that fixed-seed goldens hold across native,
// WASM, and WASM+SIMD.
#include "effetune/kernel.h"
#include "FMRadioSimulatorPluginParams.h"
#include "binary_io.h"
#include "effetune/dsp/denormal_noise.h"
#include "effetune/dsp/xorshift_rng.h"
#include "peak_controller.h"

#include <array>
#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <numeric>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kHalfPi = 0.5 * kPi;
constexpr double kQuarterPi = 0.25 * kPi;
constexpr double kTwoPi = 2.0 * kPi;
constexpr double kInvTwoPi = 1.0 / kTwoPi;
constexpr double kKaiserBeta100Db = 10.06126;
constexpr double kDcCutHz = 5.0;
constexpr std::uint32_t kMaximumBlockRatio = 10u;

// Telemetry (HUD only, never part of the audio path or parity goldens).
// Frame type 16, format version 1: five float32 scalars (RF level in dBuV,
// estimated CNR in dB, pilot-lock quality 0-1, stereo blend ratio 0-1,
// multipath echo depth in dB), one cumulative u32 click counter, then 48
// float32 MPX spectrum magnitudes in dBFS on a fixed log-frequency grid.
constexpr std::uint16_t kTelemetryFrameType = 16u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kSpectrumBins = 48u;
constexpr std::uint32_t kSpectrumWindow = 1024u;
constexpr double kSpectrumMinHz = 300.0;
constexpr double kSpectrumMaxHz = 60000.0;
constexpr std::uint16_t kTelemetryPayloadBytes =
    static_cast<std::uint16_t>(24u + 4u * kSpectrumBins);
// Threshold on the detune-removed discriminator phase. Keeping it in phase
// units makes the detector independent of the core-rate plan. 15*pi/16 is
// equivalent to the former normalized threshold of 3 at a 480 kHz core rate.
constexpr float kClickPhaseThreshold = static_cast<float>(15.0 * kPi / 16.0);

struct RatePlan final {
  std::uint32_t host;
  std::uint32_t mpx;
  std::uint32_t core;
  std::uint32_t hostMpxTaps;
  std::uint32_t mpxCoreTaps;
};

constexpr std::array<RatePlan, 8> kRatePlans{{
    {44100u, 176400u, 441000u, 80u, 80u},
    {48000u, 192000u, 480000u, 80u, 72u},
    {88200u, 176400u, 441000u, 20u, 80u},
    {96000u, 192000u, 480000u, 20u, 72u},
    {176400u, 176400u, 529200u, 1u, 80u},
    {192000u, 192000u, 576000u, 1u, 72u},
    {352800u, 352800u, 705600u, 1u, 80u},
    {384000u, 384000u, 768000u, 1u, 72u},
}};

struct BiquadCoefficientsF32 final {
  float b0;
  float b1;
  float b2;
  float a1;
  float a2;
};

struct EllipticTable final {
  std::uint32_t rate;
  std::array<BiquadCoefficientsF32, 5> sections;
};

// scipy.signal.ellip(10, 0.1, 90, 15000, fs=rate, output='sos').
constexpr std::array<EllipticTable, 8> kFifteenKhzElliptic{{
    {44100u,
     {{{0.0420168499F, 0.0827391790F, 0.0420168499F, -0.359724107F, 0.117568170F},
       {1.0F, 1.77649254F, 1.0F, 0.215642997F, 0.442965361F},
       {1.0F, 1.56008794F, 1.0F, 0.693893110F, 0.716853892F},
       {1.0F, 1.41631250F, 1.0F, 0.951321918F, 0.872596049F},
       {1.0F, 1.35082567F, 1.0F, 1.07086568F, 0.963422260F}}}},
    {48000u,
     {{{0.0237371392F, 0.0463957353F, 0.0237371392F, -0.561249044F, 0.156596567F},
       {1.0F, 1.67780479F, 1.0F, -0.0654565122F, 0.438833606F},
       {1.0F, 1.38149779F, 1.0F, 0.388621814F, 0.701349775F},
       {1.0F, 1.19259173F, 1.0F, 0.649333438F, 0.862144622F},
       {1.0F, 1.10855418F, 1.0F, 0.770892315F, 0.959948393F}}}},
    {88200u,
     {{{0.00102728240F, 0.00177318967F, 0.00102728240F, -1.31148696F, 0.461709853F},
       {1.0F, 0.563311146F, 1.0F, -1.19262368F, 0.589658264F},
       {1.0F, -0.156858886F, 1.0F, -1.05149093F, 0.748185648F},
       {1.0F, -0.472121084F, 1.0F, -0.956922291F, 0.872835949F},
       {1.0F, -0.588921070F, 1.0F, -0.925263235F, 0.961556600F}}}},
    {96000u,
     {{{0.000742915758F, 0.00124027328F, 0.000742915758F, -1.37040948F, 0.497175060F},
       {1.0F, 0.371350870F, 1.0F, -1.27779750F, 0.614634718F},
       {1.0F, -0.356579649F, 1.0F, -1.16715097F, 0.761998832F},
       {1.0F, -0.658921123F, 1.0F, -1.09394515F, 0.879299104F},
       {1.0F, -0.768554389F, 1.0F, -1.07372117F, 0.963462591F}}}},
    {176400u,
     {{{0.000133696875F, 0.000130638214F, 0.000133696875F, -1.65958281F, 0.698501825F},
       {1.0F, -0.894927144F, 1.0F, -1.66151762F, 0.766168535F},
       {1.0F, -1.38171518F, 1.0F, -1.66617084F, 0.853566587F},
       {1.0F, -1.53284740F, 1.0F, -1.67578578F, 0.925150692F},
       {1.0F, -1.58226156F, 1.0F, -1.69530475F, 0.977377415F}}}},
    {192000u,
     {{{0.000113042507F, 0.0000945661520F, 0.000113042507F, -1.68696082F, 0.720036924F},
       {1.0F, -1.03085256F, 1.0F, -1.69399297F, 0.782914460F},
       {1.0F, -1.46875286F, 1.0F, -1.70492756F, 0.864101112F},
       {1.0F, -1.60111928F, 1.0F, -1.71887314F, 0.930571914F},
       {1.0F, -1.64403939F, 1.0F, -1.73978341F, 0.979034722F}}}},
    {352800u,
     {{{0.0000495974835F, -0.0000173955670F, 0.0000495974835F, -1.82813382F, 0.838377059F},
       {1.0F, -1.66294730F, 1.0F, -1.84789634F, 0.875297725F},
       {1.0F, -1.83115244F, 1.0F, -1.87373781F, 0.922458291F},
       {1.0F, -1.87643921F, 1.0F, -1.89625585F, 0.960638940F},
       {1.0F, -1.89063430F, 1.0F, -1.91591382F, 0.988193035F}}}},
    {384000u,
     {{{0.0000462230629F, -0.0000237570176F, 0.0000462230629F, -1.84190464F, 0.850596011F},
       {1.0F, -1.71220565F, 1.0F, -1.86159253F, 0.884822845F},
       {1.0F, -1.85678959F, 1.0F, -1.88720131F, 0.928460121F},
       {1.0F, -1.89538801F, 1.0F, -1.90924978F, 0.963720202F},
       {1.0F, -1.90745807F, 1.0F, -1.92802572F, 0.989126265F}}}},
}};

const RatePlan *findRatePlan(float sample_rate) noexcept {
  const auto rounded = static_cast<std::uint32_t>(sample_rate + 0.5F);
  for (const RatePlan &plan : kRatePlans) {
    if (plan.host == rounded) {
      return &plan;
    }
  }
  return nullptr;
}

const EllipticTable *findElliptic(std::uint32_t rate) noexcept {
  for (const EllipticTable &table : kFifteenKhzElliptic) {
    if (table.rate == rate) {
      return &table;
    }
  }
  return nullptr;
}

struct BiquadF32 final {
  BiquadCoefficientsF32 coefficients{1.0F, 0.0F, 0.0F, 0.0F, 0.0F};
  float s1 = 0.0F;
  float s2 = 0.0F;

  void reset() noexcept {
    s1 = 0.0F;
    s2 = 0.0F;
    denormal_noise.reset();
  }

  float process(float input) noexcept {
    const float noise = static_cast<float>(denormal_noise.sample(0u));
    denormal_noise.advance(1u);
    const float output = coefficients.b0 * input + s1 + noise;
    s1 = coefficients.b1 * input - coefficients.a1 * output + s2;
    s2 = coefficients.b2 * input - coefficients.a2 * output;
    return output;
  }

  dsp::NyquistDenormalNoise denormal_noise;
};

template <std::size_t Sections> struct BiquadCascade final {
  std::array<BiquadF32, Sections> filters{};

  void reset() noexcept {
    for (BiquadF32 &filter : filters) {
      filter.reset();
    }
  }

  float process(float input) noexcept {
    float output = input;
    for (BiquadF32 &filter : filters) {
      output = filter.process(output);
    }
    return output;
  }
};

void configureElliptic(BiquadCascade<5> &cascade, std::uint32_t rate) noexcept {
  const EllipticTable *table = findElliptic(rate);
  if (table == nullptr) {
    return;
  }
  for (std::size_t index = 0; index < cascade.filters.size(); ++index) {
    cascade.filters[index].coefficients = table->sections[index];
  }
}

void configureLowPass(BiquadF32 &filter, double frequency, double q, double sample_rate) noexcept {
  const double omega = kTwoPi * frequency / sample_rate;
  const double cosine = std::cos(omega);
  const double sine = std::sin(omega);
  const double alpha = sine / (2.0 * q);
  const double inverse_a0 = 1.0 / (1.0 + alpha);
  const double half = 0.5 * (1.0 - cosine);
  filter.coefficients = {
      static_cast<float>(half * inverse_a0),
      static_cast<float>((1.0 - cosine) * inverse_a0),
      static_cast<float>(half * inverse_a0),
      static_cast<float>(-2.0 * cosine * inverse_a0),
      static_cast<float>((1.0 - alpha) * inverse_a0),
  };
}

double besselI0(double value) noexcept {
  const double half = value * 0.5;
  double sum = 1.0;
  double term = 1.0;
  for (int index = 1; index <= 24; ++index) {
    term *= half / static_cast<double>(index);
    const double addition = term * term;
    sum += addition;
    if (addition < sum * 1.0e-16) {
      break;
    }
  }
  return sum;
}

double normalizedSinc(double value) noexcept {
  const double absolute = value < 0.0 ? -value : value;
  return absolute < 1.0e-12 ? 1.0 : std::sin(kPi * value) / (kPi * value);
}

template <std::size_t Channels> class RationalResampler final {
public:
  void configure(std::uint32_t input_rate, std::uint32_t output_rate, double pass_hz,
                 std::uint32_t total_taps) {
    const std::uint32_t divisor = std::gcd(input_rate, output_rate);
    interpolation_ = output_rate / divisor;
    decimation_ = input_rate / divisor;
    if (interpolation_ == 1u && decimation_ == 1u) {
      taps_per_phase_ = 1u;
      coefficients_.assign(1u, 1.0F);
      rings_.assign(Channels, std::vector<float>(1u, 0.0F));
      reset();
      return;
    }
    taps_per_phase_ = (total_taps + interpolation_ - 1u) / interpolation_;
    if (taps_per_phase_ < 2u) {
      taps_per_phase_ = 2u;
    }
    coefficients_.assign(static_cast<std::size_t>(interpolation_) * taps_per_phase_, 0.0F);
    rings_.assign(Channels, std::vector<float>(taps_per_phase_, 0.0F));
    // The windowed-sinc -6 dB point must sit at the middle of the designed
    // transition band, not at the audio pass edge. The family stop edge is the
    // first image/fold boundary, lower_rate - pass_hz, so the midpoint is
    // lower_rate / 2. Placing the sinc cutoff at pass_hz instead started the
    // Kaiser transition droop far below the pass edge (about -3.3 dB at
    // 38 kHz for the 53 kHz MPX/Core boundary), attenuating the stereo
    // subchannel against the L+R main path.
    const std::uint32_t lower_rate = input_rate < output_rate ? input_rate : output_rate;
    const double stop_hz = static_cast<double>(lower_rate) - pass_hz;
    const double cutoff = 0.5 * (pass_hz + stop_hz) / static_cast<double>(input_rate);
    const double delay = 0.5 * static_cast<double>(taps_per_phase_ - 1u);
    const double inverse_i0 = 1.0 / besselI0(kKaiserBeta100Db);
    for (std::uint32_t phase = 0u; phase < interpolation_; ++phase) {
      const double fraction = static_cast<double>(phase) / static_cast<double>(interpolation_);
      double sum = 0.0;
      for (std::uint32_t tap = 0u; tap < taps_per_phase_; ++tap) {
        const double distance = fraction - delay + static_cast<double>(tap);
        // The Kaiser window must follow the polyphase fraction exactly like
        // the sinc does, so that every phase samples one continuous
        // prototype. Anchoring the window to the tap grid made the phases'
        // transition-band responses differ, which turned rational resamplers
        // with L >= 2 into cyclostationary systems that modulate content near
        // the output Nyquist down to low frequencies (measured -39 dB leakage
        // of 90-96 kHz noise to 0-6 kHz in the 480k->192k L=2/M=5 decimator;
        // -120 dB with the shifted window).
        const double window_position = delay > 0.0 ? distance / delay : 0.0;
        double radicand = 1.0 - window_position * window_position;
        if (radicand < 0.0) {
          radicand = 0.0;
        }
        const double window = besselI0(kKaiserBeta100Db * std::sqrt(radicand)) * inverse_i0;
        const double coefficient = 2.0 * cutoff * normalizedSinc(2.0 * cutoff * distance) * window;
        coefficients_[static_cast<std::size_t>(phase) * taps_per_phase_ + tap] =
            static_cast<float>(coefficient);
        sum += coefficient;
      }
      if (sum != 0.0) {
        const float inverse_sum = static_cast<float>(1.0 / sum);
        for (std::uint32_t tap = 0u; tap < taps_per_phase_; ++tap) {
          coefficients_[static_cast<std::size_t>(phase) * taps_per_phase_ + tap] *= inverse_sum;
        }
      }
    }
    reset();
  }

  void reset() noexcept {
    for (std::vector<float> &ring : rings_) {
      for (float &value : ring) {
        value = 0.0F;
      }
    }
    ring_position_ = 0u;
    input_index_ = 0u;
    output_index_ = 0u;
  }

  std::uint32_t process(const std::array<const float *, Channels> &inputs,
                        std::uint32_t input_count, const std::array<float *, Channels> &outputs,
                        std::uint32_t output_capacity) noexcept {
    if (interpolation_ == 1u && decimation_ == 1u) {
      const std::uint32_t count = input_count < output_capacity ? input_count : output_capacity;
      for (std::size_t channel = 0u; channel < Channels; ++channel) {
        for (std::uint32_t index = 0u; index < count; ++index) {
          outputs[channel][index] = inputs[channel][index];
        }
      }
      input_index_ += input_count;
      output_index_ += count;
      return count;
    }

    std::uint32_t produced = 0u;
    for (std::uint32_t input = 0u; input < input_count; ++input) {
      for (std::size_t channel = 0u; channel < Channels; ++channel) {
        rings_[channel][ring_position_] = inputs[channel][input];
      }
      while ((output_index_ * decimation_) / interpolation_ == input_index_) {
        if (produced >= output_capacity) {
          return produced;
        }
        const std::uint32_t phase =
            static_cast<std::uint32_t>((output_index_ * decimation_) % interpolation_);
        const float *phase_coefficients =
            coefficients_.data() + static_cast<std::size_t>(phase) * taps_per_phase_;
        for (std::size_t channel = 0u; channel < Channels; ++channel) {
          float sum = 0.0F;
          std::uint32_t read_position = ring_position_;
          for (std::uint32_t tap = 0u; tap < taps_per_phase_; ++tap) {
            sum += rings_[channel][read_position] * phase_coefficients[tap];
            read_position = read_position == 0u ? taps_per_phase_ - 1u : read_position - 1u;
          }
          outputs[channel][produced] = sum;
        }
        ++produced;
        ++output_index_;
      }
      ring_position_ = ring_position_ + 1u == taps_per_phase_ ? 0u : ring_position_ + 1u;
      ++input_index_;
    }
    return produced;
  }

  [[nodiscard]] std::uint32_t tapsPerPhase() const noexcept { return taps_per_phase_; }

private:
  std::vector<std::vector<float>> rings_;
  std::vector<float> coefficients_;
  std::uint64_t input_index_ = 0u;
  std::uint64_t output_index_ = 0u;
  std::uint32_t interpolation_ = 1u;
  std::uint32_t decimation_ = 1u;
  std::uint32_t taps_per_phase_ = 1u;
  std::uint32_t ring_position_ = 0u;
};

struct FirstOrderState final {
  float previousInput = 0.0F;
  float previousOutput = 0.0F;

  void reset() noexcept {
    previousInput = 0.0F;
    previousOutput = 0.0F;
  }
};

struct LimiterState final {
  float envelope = 0.0F;
  float gain = 1.0F;

  void reset() noexcept {
    envelope = 0.0F;
    gain = 1.0F;
  }
};

// PeakController (MPX lookahead limiter) lives in peak_controller.h so the
// native unit test exercises the production implementation directly.

struct RecursiveOscillator final {
  double sine = 0.0;
  double cosine = 1.0;
  double stepSine = 0.0;
  double stepCosine = 1.0;
  std::uint32_t counter = 0u;

  void configure(double frequency, double sample_rate) noexcept {
    const double step = kTwoPi * frequency / sample_rate;
    stepSine = std::sin(step);
    stepCosine = std::cos(step);
  }

  void reset() noexcept {
    sine = 0.0;
    cosine = 1.0;
    counter = 0u;
  }

  void advance() noexcept {
    const double next_sine = sine * stepCosine + cosine * stepSine;
    const double next_cosine = cosine * stepCosine - sine * stepSine;
    sine = next_sine;
    cosine = next_cosine;
    ++counter;
    if ((counter & 0xffffu) == 0u) {
      const double norm_squared = sine * sine + cosine * cosine;
      const double correction = 1.5 - 0.5 * norm_squared;
      sine *= correction;
      cosine *= correction;
    }
  }
};

void fastSinCos(double phase, float &sine, float &cosine) noexcept {
  while (phase > kPi) {
    phase -= kTwoPi;
  }
  while (phase < -kPi) {
    phase += kTwoPi;
  }
  const double scaled = phase / kHalfPi;
  const int quadrant = static_cast<int>(scaled + (scaled >= 0.0 ? 0.5 : -0.5));
  const double reduced = phase - static_cast<double>(quadrant) * kHalfPi;
  const double squared = reduced * reduced;
  const double reduced_sine =
      reduced *
      (1.0 +
       squared * (-1.0 / 6.0 +
                  squared * (1.0 / 120.0 + squared * (-1.0 / 5040.0 +
                                                      squared * (1.0 / 362880.0 +
                                                                 squared * (-1.0 / 39916800.0))))));
  const double reduced_cosine =
      1.0 +
      squared * (-1.0 / 2.0 +
                 squared * (1.0 / 24.0 +
                            squared * (-1.0 / 720.0 +
                                       squared * (1.0 / 40320.0 + squared * (-1.0 / 3628800.0)))));
  switch (quadrant & 3) {
  case 0:
    sine = static_cast<float>(reduced_sine);
    cosine = static_cast<float>(reduced_cosine);
    break;
  case 1:
    sine = static_cast<float>(reduced_cosine);
    cosine = static_cast<float>(-reduced_sine);
    break;
  case 2:
    sine = static_cast<float>(-reduced_sine);
    cosine = static_cast<float>(-reduced_cosine);
    break;
  default:
    sine = static_cast<float>(-reduced_cosine);
    cosine = static_cast<float>(reduced_sine);
    break;
  }
}

float fastInverseSqrt(float value) noexcept {
  std::uint32_t bits = std::bit_cast<std::uint32_t>(value);
  bits = 0x5f375a86u - (bits >> 1u);
  float estimate = std::bit_cast<float>(bits);
  const float half = 0.5F * value;
  estimate *= 1.5F - half * estimate * estimate;
  estimate *= 1.5F - half * estimate * estimate;
  return estimate;
}

float fastLog(float value) noexcept {
  std::uint32_t bits = std::bit_cast<std::uint32_t>(value);
  const int exponent = static_cast<int>((bits >> 23u) & 0xffu) - 127;
  bits = (bits & 0x007fffffu) | 0x3f800000u;
  const float mantissa = std::bit_cast<float>(bits);
  const float y = (mantissa - 1.0F) / (mantissa + 1.0F);
  const float squared = y * y;
  const float series =
      y * (1.0F +
           squared * (1.0F / 3.0F +
                      squared * (1.0F / 5.0F + squared * (1.0F / 7.0F + squared * (1.0F / 9.0F)))));
  return 2.0F * series + static_cast<float>(exponent) * 0.6931471805599453F;
}

float atanSmall(float value) noexcept {
  const float squared = value * value;
  return value *
         (1.0F +
          squared *
              (-1.0F / 3.0F +
               squared *
                   (1.0F / 5.0F +
                    squared * (-1.0F / 7.0F +
                               squared * (1.0F / 9.0F +
                                          squared * (-1.0F / 11.0F +
                                                     squared * (1.0F / 13.0F +
                                                                squared * (-1.0F / 15.0F))))))));
}

float fastAtanUnit(float value) noexcept {
  if (value > 0.41421356237F) {
    return static_cast<float>(kQuarterPi) + atanSmall((value - 1.0F) / (value + 1.0F));
  }
  return atanSmall(value);
}

float fastAtan2(float y, float x) noexcept {
  const float absolute_x = x < 0.0F ? -x : x;
  const float absolute_y = y < 0.0F ? -y : y;
  if (absolute_x + absolute_y < 1.0e-20F) {
    return 0.0F;
  }
  float angle;
  if (absolute_x >= absolute_y) {
    angle = fastAtanUnit(absolute_y / absolute_x);
  } else {
    angle = static_cast<float>(kHalfPi) - fastAtanUnit(absolute_x / absolute_y);
  }
  if (x < 0.0F) {
    angle = static_cast<float>(kPi) - angle;
  }
  return y < 0.0F ? -angle : angle;
}

class GaussianNoise final {
public:
  void seed(std::uint32_t low, std::uint32_t high) noexcept {
    rng_.seed(low, high);
    hasSpare_ = false;
    spare_ = 0.0F;
  }

  float next() noexcept {
    if (hasSpare_) {
      hasSpare_ = false;
      return spare_;
    }
    float first;
    float second;
    float radius_squared;
    do {
      first = static_cast<float>(rng_.nextFloatSigned());
      second = static_cast<float>(rng_.nextFloatSigned());
      radius_squared = first * first + second * second;
    } while (radius_squared >= 1.0F || radius_squared < 1.0e-12F);
    const float magnitude_squared = -2.0F * fastLog(radius_squared);
    const float magnitude = magnitude_squared * fastInverseSqrt(magnitude_squared);
    const float multiplier = magnitude * fastInverseSqrt(radius_squared);
    spare_ = second * multiplier;
    hasSpare_ = true;
    return first * multiplier;
  }

private:
  dsp::XorShiftRng rng_{};
  float spare_ = 0.0F;
  bool hasSpare_ = false;
};

struct ComplexSample final {
  float real;
  float imag;
};

using binary_io::writeF32;
using binary_io::writeU32;

class FMRadioSimulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::FMRadioSimulatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    ratePlan_ = findRatePlan(info.sampleRate);
    prepared_ = ratePlan_ != nullptr && info.maxChannels > 0u && info.maxFrames > 0u;
    if (!prepared_) {
      return;
    }
    maxFrames_ = info.maxFrames;
    configureElliptic(hostInputLeft_, ratePlan_->host);
    configureElliptic(hostInputRight_, ratePlan_->host);
    configureElliptic(txFinalLeft_, ratePlan_->mpx);
    configureElliptic(txFinalRight_, ratePlan_->mpx);
    configureElliptic(rxSum_, ratePlan_->mpx);
    configureElliptic(rxDifference_, ratePlan_->mpx);
    peakLeft_.configure(ratePlan_->mpx);
    peakRight_.configure(ratePlan_->mpx);

    hostToMpx_.configure(ratePlan_->host, ratePlan_->mpx, 15000.0, ratePlan_->hostMpxTaps);
    mpxToHost_.configure(ratePlan_->mpx, ratePlan_->host, 15000.0, ratePlan_->hostMpxTaps);
    mpxToCore_.configure(ratePlan_->mpx, ratePlan_->core, 53000.0, ratePlan_->mpxCoreTaps);
    coreToMpx_.configure(ratePlan_->core, ratePlan_->mpx, 53000.0, ratePlan_->mpxCoreTaps);

    const std::size_t host_capacity = info.maxFrames;
    const std::size_t mpx_capacity =
        static_cast<std::size_t>(info.maxFrames) * ratePlan_->mpx / ratePlan_->host + 8u;
    const std::size_t core_capacity =
        static_cast<std::size_t>(info.maxFrames) * kMaximumBlockRatio + 32u;
    hostLeft_.resize(host_capacity);
    hostRight_.resize(host_capacity);
    dryBlockLeft_.resize(host_capacity);
    dryBlockRight_.resize(host_capacity);
    wetLeft_.resize(host_capacity + 8u);
    wetRight_.resize(host_capacity + 8u);
    txLeft_.resize(mpx_capacity);
    txRight_.resize(mpx_capacity);
    rxLeft_.resize(mpx_capacity);
    rxRight_.resize(mpx_capacity);
    txMpx_.resize(mpx_capacity);
    rxMpx_.resize(mpx_capacity);
    coreInput_.resize(core_capacity);
    coreOutput_.resize(core_capacity);

    // Worst-case multipath span (dl = 50 us, second echo x2.7) at the highest
    // core rate in the plan table, so parameter changes never need to regrow.
    const std::size_t delay_capacity =
        static_cast<std::size_t>(std::ceil(50.0e-6 * 2.7 * 768000.0)) + 8u;
    multipathDelay_.assign(delay_capacity, {0.0F, 0.0F});
    // Continuous controls (og/mx at the host rate, mp/dl at the core rate)
    // follow their targets through a 20 ms one-pole ramp, matching the AM
    // Radio Simulator control-smoothing convention (section 6: no reset-class
    // parameters, physically continuous updates). f32-rounded so the JS
    // reference reproduces the coefficient bit for bit.
    controlAlphaHost_ =
        static_cast<float>(1.0 - std::exp(-1.0 / (0.020 * static_cast<double>(ratePlan_->host))));
    controlAlphaMpx_ =
        static_cast<float>(1.0 - std::exp(-1.0 / (0.020 * static_cast<double>(ratePlan_->mpx))));
    controlAlphaCore_ =
        static_cast<float>(1.0 - std::exp(-1.0 / (0.020 * static_cast<double>(ratePlan_->core))));
    tuningRampSamples_ =
        static_cast<std::uint32_t>(0.020 * static_cast<double>(ratePlan_->core) + 0.5);
    // The 16-slot peak controller ring reads the slot written 15 samples
    // earlier (write, advance, read), so the wet chain's fixed lookahead
    // delay is kPeakLookahead - 1 MPX samples. The report and the dry-path
    // alignment delay both use the actual value.
    const double latency_seconds =
        (0.5 * static_cast<double>(hostToMpx_.tapsPerPhase() - 1u)) / ratePlan_->host +
        (static_cast<double>(kPeakLookahead - 1u) +
         0.5 * static_cast<double>(mpxToCore_.tapsPerPhase() - 1u)) /
            ratePlan_->mpx +
        (0.5 * static_cast<double>(coreToMpx_.tapsPerPhase() - 1u)) / ratePlan_->core +
        (0.5 * static_cast<double>(mpxToHost_.tapsPerPhase() - 1u)) / ratePlan_->mpx;
    latencySamples_ = static_cast<std::uint32_t>(std::ceil(latency_seconds * ratePlan_->host));
    dryLeft_.assign(static_cast<std::size_t>(latencySamples_) + 1u, 0.0F);
    dryRight_.assign(static_cast<std::size_t>(latencySamples_) + 1u, 0.0F);

    // Telemetry-only state: Hann window, log-spaced Goertzel bins over the
    // recovered MPX at the MPX-layer rate, and the snapshot scratch used by
    // writeTelemetry (allocation-free at emission time).
    spectrumRing_.assign(kSpectrumWindow, 0.0F);
    spectrumWindowed_.assign(kSpectrumWindow, 0.0F);
    hannWindow_.resize(kSpectrumWindow);
    double window_sum = 0.0;
    for (std::uint32_t index = 0u; index < kSpectrumWindow; ++index) {
      const double window = 0.5 - 0.5 * std::cos(kTwoPi * static_cast<double>(index) /
                                                 static_cast<double>(kSpectrumWindow - 1u));
      hannWindow_[index] = static_cast<float>(window);
      window_sum += window;
    }
    inverseWindowSum_ = window_sum > 0.0 ? 2.0 / window_sum : 0.0;
    const double bin_ratio =
        std::log(kSpectrumMaxHz / kSpectrumMinHz) / static_cast<double>(kSpectrumBins - 1u);
    for (std::uint32_t bin = 0u; bin < kSpectrumBins; ++bin) {
      const double frequency = kSpectrumMinHz * std::exp(bin_ratio * static_cast<double>(bin));
      goertzelCoefficients_[bin] = 2.0 * std::cos(kTwoPi * frequency / ratePlan_->mpx);
    }
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  void reset() noexcept override {
    hostInputLeft_.reset();
    hostInputRight_.reset();
    txFinalLeft_.reset();
    txFinalRight_.reset();
    rxSum_.reset();
    rxDifference_.reset();
    for (BiquadF32 &filter : ifReal_) {
      filter.reset();
    }
    for (BiquadF32 &filter : ifImag_) {
      filter.reset();
    }
    preLeft_.reset();
    preRight_.reset();
    deLeft_.reset();
    deRight_.reset();
    dcLeft_.reset();
    dcRight_.reset();
    limiterLeft_.reset();
    limiterRight_.reset();
    peakLeft_.reset();
    peakRight_.reset();
    hostToMpx_.reset();
    mpxToHost_.reset();
    mpxToCore_.reset();
    coreToMpx_.reset();
    pilotTx_.reset();
    pilotRx_.reset();
    tuning_.reset();
    fadingFirst_.reset();
    fadingSecond_.reset();
    fmPhase_ = 0.0;
    previousLimited_ = {1.0F, 0.0F};
    pllIntegrator_ = 0.0;
    pllLock_ = 0.0F;
    multipathPosition_ = 0u;
    for (ComplexSample &sample : multipathDelay_) {
      sample = {0.0F, 0.0F};
    }
    dryPosition_ = 0u;
    for (float &sample : dryLeft_) {
      sample = 0.0F;
    }
    for (float &sample : dryRight_) {
      sample = 0.0F;
    }
    tuningRampRemaining_ = 0u;
    controlsConfigured_ = false;
    for (float &sample : spectrumRing_) {
      sample = 0.0F;
    }
    spectrumRingPosition_ = 0u;
    rfPowerEma_ = 0.0;
    clickCount_ = 0u;
    clickActive_ = false;
    telemetryAvailable_ = false;
    seedNoise();
  }

  void setRandomSeed(std::uint32_t low, std::uint32_t high) noexcept override {
    seedLow_ = low;
    seedHigh_ = high;
    seedNoise();
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override { return latencySamples_; }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || frame_count == 0u ||
        frame_count > maxFrames_) {
      return;
    }
    if (paramsDirty() || !controlsConfigured_) {
      configureControls();
    }

    const float *input_left = audio;
    const float *input_right = channel_count > 1u ? audio + frame_count : audio;
    for (std::uint32_t index = 0u; index < frame_count; ++index) {
      const float dry_left = input_left[index];
      const float dry_right = input_right[index];
      dryBlockLeft_[index] = dry_left;
      dryBlockRight_[index] = dry_right;
      hostLeft_[index] = processPreEmphasis(hostInputLeft_.process(dry_left), preLeft_);
      hostRight_[index] = processPreEmphasis(hostInputRight_.process(dry_right), preRight_);
    }

    const std::uint32_t mpx_count = hostToMpx_.process(
        {hostLeft_.data(), hostRight_.data()}, frame_count, {txLeft_.data(), txRight_.data()},
        static_cast<std::uint32_t>(txLeft_.size()));
    for (std::uint32_t index = 0u; index < mpx_count; ++index) {
      // Smooth control tracking: pr's drive and soft-clip amount ramp toward
      // their targets with a 20 ms one-pole at the MPX rate, matching
      // the og/mx convention: f32-rounded coefficient, f64 ramp state.
      processingDriveCurrent_ +=
          static_cast<double>(controlAlphaMpx_) *
          (static_cast<double>(processingDriveTarget_) - processingDriveCurrent_);
      processingAmountCurrent_ +=
          static_cast<double>(controlAlphaMpx_) *
          (static_cast<double>(processingAmountTarget_) - processingAmountCurrent_);
      const float processing_drive = static_cast<float>(processingDriveCurrent_);
      const float processing_amount = static_cast<float>(processingAmountCurrent_);
      float left =
          processLimiter(txLeft_[index], limiterLeft_, processing_drive, processing_amount);
      float right =
          processLimiter(txRight_[index], limiterRight_, processing_drive, processing_amount);
      left = peakLeft_.process(txFinalLeft_.process(left));
      right = peakRight_.process(txFinalRight_.process(right));
      txLeft_[index] = left;
      txRight_[index] = right;
      const float sum = left + right;
      const float difference = left - right;
      txMpx_[index] =
          0.45F * sum +
          0.45F * difference * static_cast<float>(2.0 * pilotTx_.sine * pilotTx_.cosine) +
          0.09F * static_cast<float>(pilotTx_.sine);
      pilotTx_.advance();
    }

    const std::uint32_t core_count =
        mpxToCore_.process({txMpx_.data()}, mpx_count, {coreInput_.data()},
                           static_cast<std::uint32_t>(coreInput_.size()));
    for (std::uint32_t index = 0u; index < core_count; ++index) {
      coreOutput_[index] = processCore(coreInput_[index]);
    }
    const std::uint32_t recovered_mpx_count =
        coreToMpx_.process({coreOutput_.data()}, core_count, {rxMpx_.data()},
                           static_cast<std::uint32_t>(rxMpx_.size()));

    for (std::uint32_t index = 0u; index < recovered_mpx_count; ++index) {
      const float mpx = rxMpx_[index];
      // Telemetry-only capture of the recovered MPX for the HUD spectrum.
      spectrumRing_[spectrumRingPosition_] = mpx;
      spectrumRingPosition_ =
          spectrumRingPosition_ + 1u == kSpectrumWindow ? 0u : spectrumRingPosition_ + 1u;
      const double phase_error = static_cast<double>(mpx) * pilotRx_.cosine;
      pllIntegrator_ += pllKi_ * phase_error;
      double correction = pllIntegrator_ + pllKp_ * phase_error;
      if (correction > 0.002) {
        correction = 0.002;
      } else if (correction < -0.002) {
        correction = -0.002;
      }
      pilotRx_.stepSine = pilotBaseSine_ + correction * pilotBaseCosine_;
      pilotRx_.stepCosine = pilotBaseCosine_ - correction * pilotBaseSine_;
      const float in_phase = static_cast<float>(static_cast<double>(mpx) * pilotRx_.sine);
      pllLock_ = 0.9995F * pllLock_ + 0.0005F * (in_phase < 0.0F ? -in_phase : in_phase);
      const float sum = rxSum_.process(mpx);
      const float carrier = static_cast<float>(2.0 * pilotRx_.sine * pilotRx_.cosine);
      float difference = rxDifference_.process(2.0F * mpx * carrier);
      if (stereoMode_ == 2) {
        difference = 0.0F;
      } else if (stereoMode_ == 0) {
        float blend = pllLock_ * 24.0F;
        if (blend > 1.0F) {
          blend = 1.0F;
        }
        difference *= blend * cnrBlend_;
      }
      rxLeft_[index] = (sum + difference) * (1.0F / 0.9F);
      rxRight_[index] = (sum - difference) * (1.0F / 0.9F);
      pilotRx_.advance();
    }
    const std::uint32_t host_count = mpxToHost_.process(
        {rxLeft_.data(), rxRight_.data()}, recovered_mpx_count, {wetLeft_.data(), wetRight_.data()},
        static_cast<std::uint32_t>(wetLeft_.size()));
    finishHost(audio, channel_count, frame_count, host_count);
    telemetryAvailable_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!telemetryAvailable_) {
      return;
    }
    const double noise_power = telemetryNoisePower_ > 1.0e-30 ? telemetryNoisePower_ : 1.0e-30;
    double signal_power = rfPowerEma_ - noise_power;
    if (signal_power < 1.0e-12) {
      signal_power = 1.0e-12;
    }
    // Amplitude 1.0 corresponds to Signal = 60 dBuV (section 6.1 calibration).
    const float rf_level_dbuv = static_cast<float>(60.0 + 10.0 * std::log10(signal_power));
    const float cnr_db = static_cast<float>(10.0 * std::log10(signal_power / noise_power));
    float lock_quality = pllLock_ * 24.0F;
    if (lock_quality > 1.0F) {
      lock_quality = 1.0F;
    } else if (lock_quality < 0.0F) {
      lock_quality = 0.0F;
    }
    float blend_ratio;
    if (stereoMode_ == 1) {
      blend_ratio = 1.0F;
    } else if (stereoMode_ == 2) {
      blend_ratio = 0.0F;
    } else {
      blend_ratio = lock_quality * cnrBlend_;
    }
    const float multipath_db =
        multipathTarget_ > 1.0e-6F
            ? static_cast<float>(20.0 * std::log10(static_cast<double>(multipathTarget_)))
            : -120.0F;

    std::array<std::uint8_t, kTelemetryPayloadBytes> payload{};
    writeF32(payload.data(), rf_level_dbuv);
    writeF32(payload.data() + 4u, cnr_db);
    writeF32(payload.data() + 8u, lock_quality);
    writeF32(payload.data() + 12u, blend_ratio);
    writeF32(payload.data() + 16u, multipath_db);
    writeU32(payload.data() + 20u, clickCount_);

    // Snapshot the ring in chronological order through the Hann window, then
    // evaluate the 48 log-spaced Goertzel bins. Runs at the telemetry rate
    // (default 60 Hz), never inside the per-sample audio loops.
    std::uint32_t read_position = spectrumRingPosition_;
    for (std::uint32_t index = 0u; index < kSpectrumWindow; ++index) {
      spectrumWindowed_[index] = spectrumRing_[read_position] * hannWindow_[index];
      read_position = read_position + 1u == kSpectrumWindow ? 0u : read_position + 1u;
    }
    for (std::uint32_t bin = 0u; bin < kSpectrumBins; ++bin) {
      const double coefficient = goertzelCoefficients_[bin];
      double s1 = 0.0;
      double s2 = 0.0;
      for (std::uint32_t index = 0u; index < kSpectrumWindow; ++index) {
        const double s0 = static_cast<double>(spectrumWindowed_[index]) + coefficient * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      double power = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
      if (power < 0.0) {
        power = 0.0;
      }
      double magnitude = std::sqrt(power) * inverseWindowSum_;
      if (magnitude < 1.0e-7) {
        magnitude = 1.0e-7;
      }
      float db = static_cast<float>(20.0 * std::log10(magnitude));
      if (db > 20.0F) {
        db = 20.0F;
      }
      writeF32(payload.data() + 24u + 4u * bin, db);
    }
    writer.write(kTelemetryFrameType, kTelemetryVersion, payload.data(),
                 static_cast<std::uint16_t>(payload.size()));
  }

private:
  void seedNoise() noexcept {
    // Shared seed contract with the JS reference (R1): the reference derives
    // its 64-bit noise seed from the first two master draws as
    // (floor(r1 * 2^32) | floor(r2 * 2^32) << 32), and floor(nextFloat01() *
    // 2^32) == nextU64() >> 32 for the shared xorshift64 primitive.
    dsp::XorShiftRng master(seedLow_, seedHigh_);
    const std::uint32_t low = static_cast<std::uint32_t>(master.nextU64() >> 32u);
    const std::uint32_t high = static_cast<std::uint32_t>(master.nextU64() >> 32u);
    noise_.seed(low, high);
  }

  void configureControls() noexcept {
    emphasisTau_ = params_.emphasis >= 0.5F ? 75.0e-6F : 50.0e-6F;
    deCoefficient_ =
        static_cast<float>(std::exp(-1.0 / (static_cast<double>(ratePlan_->host) * emphasisTau_)));
    preInverse_ = 1.0F / (1.0F - deCoefficient_);
    dcCoefficient_ =
        static_cast<float>(std::exp(-kTwoPi * kDcCutHz / static_cast<double>(ratePlan_->host)));
    processingAmountTarget_ = params_.processing / 18.0F;
    processingDriveTarget_ = static_cast<float>(std::pow(10.0, params_.processing / 20.0F));
    limiterRelease_ = static_cast<float>(std::exp(-1.0 / (0.050 * ratePlan_->mpx)));
    // Radio off models the transmitter going dark: the RF carrier amplitude is
    // zeroed, so the receiver only picks up its own thermal noise and the
    // limiter/discriminator chain turns it into full-scale FM hiss.
    signalAmplitudeTarget_ =
        params_.radio >= 0.5F ? static_cast<float>(std::pow(10.0, (params_.signal - 60.0F) / 20.0F))
                              : 0.0F;
    noiseSigma_ = 0.0005F;
    const bool if_band_changed = !controlsConfigured_ || ifBandKhz_ != params_.ifBand;
    ifBandKhz_ = params_.ifBand;
    multipathTarget_ = params_.multipath * 0.01F;
    pathDelayTargetUs_ = params_.pathDelay;
    fadingHz_ = params_.fading;
    stereoMode_ = static_cast<int>(params_.stereo + 0.5F);
    outputGainTarget_ = static_cast<float>(std::pow(10.0, params_.outputGain / 20.0F));
    mixTarget_ = params_.mix * 0.01F;
    // Control-ramp contract: no reset-class parameters. The first configuration
    // after prepare/reset snaps the ramped controls to their targets; later
    // parameter changes only move the targets and the audio loops ramp the
    // current values over ~20 ms.
    if (!controlsConfigured_) {
      processingAmountCurrent_ = static_cast<double>(processingAmountTarget_);
      processingDriveCurrent_ = static_cast<double>(processingDriveTarget_);
      signalAmplitudeCurrent_ = static_cast<double>(signalAmplitudeTarget_);
      multipathCurrent_ = static_cast<double>(multipathTarget_);
      pathDelayCurrentUs_ = static_cast<double>(pathDelayTargetUs_);
      outputGainCurrent_ = static_cast<double>(outputGainTarget_);
      mixCurrent_ = static_cast<double>(mixTarget_);
    }
    coreRate_ = ratePlan_->core;
    if (if_band_changed) {
      configureIfFilters();
    }
    pilotTx_.configure(19000.0, ratePlan_->mpx);
    pilotRx_.configure(19000.0, ratePlan_->mpx);
    pilotBaseSine_ = pilotRx_.stepSine;
    pilotBaseCosine_ = pilotRx_.stepCosine;
    // Tuning follows section 6 as well: a tn change never touches oscillator
    // phase, IF state, or the PLL. The NCO step phasor is rotated by a
    // constant per-sample delta over a 20 ms linear frequency ramp and then
    // snapped to the exact target step, so continuous drags stay click-free.
    const float tn = params_.tuning;
    if (!controlsConfigured_) {
      tuningKhz_ = tn;
      tuningCurrentKhz_ = static_cast<double>(tn);
      tuningRampRemaining_ = 0u;
      tuning_.configure(-1000.0 * static_cast<double>(tn), coreRate_);
    } else if (tn != tuningKhz_) {
      tuningKhz_ = tn;
      const double target_khz = static_cast<double>(tn);
      const std::uint32_t samples = tuningRampSamples_ > 0u ? tuningRampSamples_ : 1u;
      tuningRampStepKhz_ = (target_khz - tuningCurrentKhz_) / static_cast<double>(samples);
      const double delta_step = kTwoPi * (-1000.0 * tuningRampStepKhz_) / coreRate_;
      tuningStepDeltaSine_ = std::sin(delta_step);
      tuningStepDeltaCosine_ = std::cos(delta_step);
      const double target_step = kTwoPi * (-1000.0 * target_khz) / coreRate_;
      tuningTargetStepSine_ = std::sin(target_step);
      tuningTargetStepCosine_ = std::cos(target_step);
      tuningRampRemaining_ = samples;
    }
    fadingFirst_.configure(fadingHz_, coreRate_);
    fadingSecond_.configure(-1.61803398875 * fadingHz_, coreRate_);
    const double natural = kTwoPi * 35.0 / static_cast<double>(ratePlan_->mpx);
    pllKp_ = 1.4 * natural;
    pllKi_ = natural * natural;
    // Auto stereo blend, CNR term. The fixed
    // physical noise floor gives CNR ~= st + 5.6 dB at IF 230 kHz; noise
    // power scales with the IF bandwidth. Real receivers narrow the L-R gain
    // continuously as CNR falls: full stereo above ~36 dB CNR and essentially
    // mono by ~18 dB CNR, smoothstep between. The value is parameter-static;
    // the dynamic PLL lock gate stays per-sample.
    // Off the air there is no carrier and no pilot, so the CNR term collapses
    // and Auto lands on mono the way a receiver does on a dead channel.
    const double cnr_db = static_cast<double>(params_.signal) + 5.6 +
                          10.0 * std::log10(230.0 / static_cast<double>(ifBandKhz_));
    double position = params_.radio >= 0.5F ? (cnr_db - 18.0) / (36.0 - 18.0) : 0.0;
    if (position < 0.0) {
      position = 0.0;
    } else if (position > 1.0) {
      position = 1.0;
    }
    cnrBlend_ = static_cast<float>(position * position * (3.0 - 2.0 * position));
    // Telemetry-only coefficients (HUD; no effect on the audio path). The
    // white noise injected at the antenna has per-component sigma over the
    // full core rate, so the complex noise power that survives the two-sided
    // IF filter is approximately 2*sigma^2 * (BW_if / coreRate).
    telemetryNoisePower_ = 2.0 * static_cast<double>(noiseSigma_) *
                           static_cast<double>(noiseSigma_) *
                           (1000.0 * static_cast<double>(ifBandKhz_) / coreRate_);
    rfPowerAlpha_ = 1.0 - std::exp(-1.0 / (0.050 * coreRate_));
    controlsConfigured_ = true;
  }

  // Coefficient update only. IF filter state is zero-cleared exclusively by
  // prepare/reset (section 6: no reset-class parameters); a bw change swaps
  // the coefficients while the TDF2 states carry over, which keeps the
  // receiver physically continuous through the change.
  void configureIfFilters() noexcept {
    constexpr std::array<double, 4> q8{{0.5097955791, 0.6013448869, 0.8999762231, 2.5629154477}};
    const double cutoff = 500.0 * static_cast<double>(ifBandKhz_);
    for (std::uint32_t index = 0u; index < 4u; ++index) {
      configureLowPass(ifReal_[index], cutoff, q8[index], coreRate_);
      configureLowPass(ifImag_[index], cutoff, q8[index], coreRate_);
    }
  }

  float processPreEmphasis(float input, FirstOrderState &state) const noexcept {
    const float output = (input - deCoefficient_ * state.previousInput) * preInverse_;
    state.previousInput = input;
    return output;
  }

  float processDeEmphasis(float input, FirstOrderState &state) const noexcept {
    const float output = (1.0F - deCoefficient_) * input + deCoefficient_ * state.previousOutput;
    state.previousOutput = output;
    return output;
  }

  float processDcCut(float input, FirstOrderState &state) const noexcept {
    const float output = input - state.previousInput + dcCoefficient_ * state.previousOutput;
    state.previousInput = input;
    state.previousOutput = output;
    return output;
  }

  float processLimiter(float input, LimiterState &state, float drive, float amount) const noexcept {
    const float driven = input * drive;
    const float absolute = driven < 0.0F ? -driven : driven;
    state.envelope = absolute > state.envelope ? absolute : limiterRelease_ * state.envelope;
    const float target = state.envelope > 0.98F ? 0.98F / state.envelope : 1.0F;
    state.gain = target < state.gain
                     ? target
                     : limiterRelease_ * state.gain + (1.0F - limiterRelease_) * target;
    const float limited = driven * state.gain;
    const float cubic = limited * limited * limited;
    return limited - 0.02F * amount * cubic;
  }

  ComplexSample readMultipath(double delay_samples) const noexcept {
    const std::size_t size = multipathDelay_.size();
    double read = static_cast<double>(multipathPosition_) - delay_samples;
    while (read < 0.0) {
      read += static_cast<double>(size);
    }
    const auto first = static_cast<std::size_t>(read) % size;
    const auto second = first + 1u == size ? 0u : first + 1u;
    const float fraction = static_cast<float>(read - static_cast<double>(first));
    return {
        multipathDelay_[first].real +
            fraction * (multipathDelay_[second].real - multipathDelay_[first].real),
        multipathDelay_[first].imag +
            fraction * (multipathDelay_[second].imag - multipathDelay_[first].imag),
    };
  }

  float processCore(float mpx) noexcept {
    // Smooth control tracking: mp and dl ramp toward their targets with a
    // 20 ms one-pole at the core rate (the delay-line read position slides
    // with dl), and a pending tn ramp rotates the tuning NCO step phasor by a
    // constant per-sample delta, then snaps to the exact target step.
    multipathCurrent_ += static_cast<double>(controlAlphaCore_) *
                         (static_cast<double>(multipathTarget_) - multipathCurrent_);
    pathDelayCurrentUs_ += static_cast<double>(controlAlphaCore_) *
                           (static_cast<double>(pathDelayTargetUs_) - pathDelayCurrentUs_);
    signalAmplitudeCurrent_ +=
        static_cast<double>(controlAlphaCore_) *
        (static_cast<double>(signalAmplitudeTarget_) - signalAmplitudeCurrent_);
    const float multipath_amount = static_cast<float>(multipathCurrent_);
    if (tuningRampRemaining_ > 0u) {
      --tuningRampRemaining_;
      if (tuningRampRemaining_ == 0u) {
        tuning_.stepSine = tuningTargetStepSine_;
        tuning_.stepCosine = tuningTargetStepCosine_;
        tuningCurrentKhz_ = static_cast<double>(tuningKhz_);
      } else {
        const double next_step_sine =
            tuning_.stepSine * tuningStepDeltaCosine_ + tuning_.stepCosine * tuningStepDeltaSine_;
        const double next_step_cosine =
            tuning_.stepCosine * tuningStepDeltaCosine_ - tuning_.stepSine * tuningStepDeltaSine_;
        tuning_.stepSine = next_step_sine;
        tuning_.stepCosine = next_step_cosine;
        tuningCurrentKhz_ += tuningRampStepKhz_;
      }
    }
    fmPhase_ += kTwoPi * 75000.0 * static_cast<double>(mpx) / coreRate_;
    if (fmPhase_ > kPi) {
      fmPhase_ -= kTwoPi;
    } else if (fmPhase_ < -kPi) {
      fmPhase_ += kTwoPi;
    }
    ComplexSample signal;
    fastSinCos(fmPhase_, signal.imag, signal.real);
    multipathDelay_[multipathPosition_] = signal;
    const double first_delay = pathDelayCurrentUs_ * 1.0e-6 * coreRate_;
    const ComplexSample first = readMultipath(first_delay);
    const ComplexSample second = readMultipath(2.7 * first_delay);
    signal.real += multipath_amount * (first.real * static_cast<float>(fadingFirst_.cosine) -
                                       first.imag * static_cast<float>(fadingFirst_.sine));
    signal.imag += multipath_amount * (first.real * static_cast<float>(fadingFirst_.sine) +
                                       first.imag * static_cast<float>(fadingFirst_.cosine));
    signal.real += 0.6F * multipath_amount *
                   (second.real * static_cast<float>(fadingSecond_.cosine) -
                    second.imag * static_cast<float>(fadingSecond_.sine));
    signal.imag += 0.6F * multipath_amount *
                   (second.real * static_cast<float>(fadingSecond_.sine) +
                    second.imag * static_cast<float>(fadingSecond_.cosine));
    fadingFirst_.advance();
    fadingSecond_.advance();
    multipathPosition_ =
        multipathPosition_ + 1u == multipathDelay_.size() ? 0u : multipathPosition_ + 1u;

    const float signal_amplitude = static_cast<float>(signalAmplitudeCurrent_);
    signal.real *= signal_amplitude;
    signal.imag *= signal_amplitude;
    signal.real += noiseSigma_ * noise_.next();
    signal.imag += noiseSigma_ * noise_.next();
    const float tuned_real = signal.real * static_cast<float>(tuning_.cosine) -
                             signal.imag * static_cast<float>(tuning_.sine);
    const float tuned_imag = signal.real * static_cast<float>(tuning_.sine) +
                             signal.imag * static_cast<float>(tuning_.cosine);
    tuning_.advance();
    signal = {tuned_real, tuned_imag};
    for (std::uint32_t index = 0u; index < 4u; ++index) {
      signal.real = ifReal_[index].process(signal.real);
      signal.imag = ifImag_[index].process(signal.imag);
    }
    float magnitude_squared = signal.real * signal.real + signal.imag * signal.imag;
    if (magnitude_squared < 1.0e-20F) {
      magnitude_squared = 1.0e-20F;
    }
    // Telemetry-only observer: signal-plus-noise power at the IF output,
    // before the limiter destroys amplitude information. Reads the value the
    // audio path already computed; the audio arithmetic is unchanged.
    rfPowerEma_ += rfPowerAlpha_ * (static_cast<double>(magnitude_squared) - rfPowerEma_);
    const float inverse_magnitude = fastInverseSqrt(magnitude_squared);
    signal.real *= inverse_magnitude;
    signal.imag *= inverse_magnitude;
    const float cross = signal.imag * previousLimited_.real - signal.real * previousLimited_.imag;
    const float dot = signal.real * previousLimited_.real + signal.imag * previousLimited_.imag;
    previousLimited_ = signal;
    const float discriminator_phase = fastAtan2(cross, dot);
    const float demodulated =
        discriminator_phase * static_cast<float>(coreRate_ * kInvTwoPi / 75000.0);
    // Telemetry-only click counter: subtract the instantaneous tuning phase
    // offset on the phase circle. The demodulated sample returned to the
    // audio path remains unchanged.
    float click_phase =
        discriminator_phase + static_cast<float>(kTwoPi * 1000.0 * tuningCurrentKhz_ / coreRate_);
    if (click_phase > static_cast<float>(kPi)) {
      click_phase -= static_cast<float>(kTwoPi);
    } else if (click_phase < static_cast<float>(-kPi)) {
      click_phase += static_cast<float>(kTwoPi);
    }
    const bool click = click_phase > kClickPhaseThreshold || click_phase < -kClickPhaseThreshold;
    if (click && !clickActive_) {
      ++clickCount_;
    }
    clickActive_ = click;
    return demodulated;
  }

  void finishHost(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                  std::uint32_t wet_count) noexcept {
    float *output_left = audio;
    float *output_right = channel_count > 1u ? audio + frame_count : audio;
    for (std::uint32_t index = 0u; index < frame_count; ++index) {
      // Smooth control tracking: og and mx ramp toward their targets with a
      // 20 ms one-pole at the host rate.
      outputGainCurrent_ += static_cast<double>(controlAlphaHost_) *
                            (static_cast<double>(outputGainTarget_) - outputGainCurrent_);
      mixCurrent_ +=
          static_cast<double>(controlAlphaHost_) * (static_cast<double>(mixTarget_) - mixCurrent_);
      const float output_gain = static_cast<float>(outputGainCurrent_);
      const float mix = static_cast<float>(mixCurrent_);
      dryLeft_[dryPosition_] = dryBlockLeft_[index];
      dryRight_[dryPosition_] = dryBlockRight_[index];
      const std::uint32_t dry_read = dryPosition_ + 1u == dryLeft_.size() ? 0u : dryPosition_ + 1u;
      const float dry_left = dryLeft_[dry_read];
      const float dry_right = dryRight_[dry_read];
      float left = index < wet_count ? wetLeft_[index] : 0.0F;
      float right = index < wet_count ? wetRight_[index] : left;
      left = processDcCut(processDeEmphasis(left, deLeft_), dcLeft_) * output_gain;
      right = processDcCut(processDeEmphasis(right, deRight_), dcRight_) * output_gain;
      left = dry_left + mix * (left - dry_left);
      right = dry_right + mix * (right - dry_right);
      output_left[index] = left;
      if (channel_count > 1u) {
        output_right[index] = right;
      }
      dryPosition_ = dryPosition_ + 1u == dryLeft_.size() ? 0u : dryPosition_ + 1u;
    }
  }

  const RatePlan *ratePlan_ = nullptr;
  BiquadCascade<5> hostInputLeft_;
  BiquadCascade<5> hostInputRight_;
  BiquadCascade<5> txFinalLeft_;
  BiquadCascade<5> txFinalRight_;
  BiquadCascade<5> rxSum_;
  BiquadCascade<5> rxDifference_;
  std::array<BiquadF32, 4> ifReal_{};
  std::array<BiquadF32, 4> ifImag_{};
  FirstOrderState preLeft_;
  FirstOrderState preRight_;
  FirstOrderState deLeft_;
  FirstOrderState deRight_;
  FirstOrderState dcLeft_;
  FirstOrderState dcRight_;
  LimiterState limiterLeft_;
  LimiterState limiterRight_;
  PeakController peakLeft_;
  PeakController peakRight_;
  RationalResampler<2> hostToMpx_;
  RationalResampler<2> mpxToHost_;
  RationalResampler<1> mpxToCore_;
  RationalResampler<1> coreToMpx_;
  RecursiveOscillator pilotTx_;
  RecursiveOscillator pilotRx_;
  RecursiveOscillator tuning_;
  RecursiveOscillator fadingFirst_;
  RecursiveOscillator fadingSecond_;
  GaussianNoise noise_;
  std::vector<float> hostLeft_;
  std::vector<float> hostRight_;
  std::vector<float> dryBlockLeft_;
  std::vector<float> dryBlockRight_;
  std::vector<float> wetLeft_;
  std::vector<float> wetRight_;
  std::vector<float> txLeft_;
  std::vector<float> txRight_;
  std::vector<float> rxLeft_;
  std::vector<float> rxRight_;
  std::vector<float> txMpx_;
  std::vector<float> rxMpx_;
  std::vector<float> coreInput_;
  std::vector<float> coreOutput_;
  std::vector<float> dryLeft_;
  std::vector<float> dryRight_;
  std::vector<ComplexSample> multipathDelay_;
  ComplexSample previousLimited_{1.0F, 0.0F};
  double fmPhase_ = 0.0;
  double coreRate_ = 480000.0;
  double pllIntegrator_ = 0.0;
  double pllKp_ = 0.0;
  double pllKi_ = 0.0;
  double pilotBaseSine_ = 0.0;
  double pilotBaseCosine_ = 1.0;
  float emphasisTau_ = 50.0e-6F;
  float deCoefficient_ = 0.0F;
  float preInverse_ = 1.0F;
  float dcCoefficient_ = 0.0F;
  float processingAmountTarget_ = 0.0F;
  float processingDriveTarget_ = 1.0F;
  float limiterRelease_ = 0.999F;
  float signalAmplitudeTarget_ = 1.0F;
  float noiseSigma_ = 0.0005F;
  float tuningKhz_ = 0.0F;
  float ifBandKhz_ = 230.0F;
  float multipathTarget_ = 0.0F;
  float pathDelayTargetUs_ = 5.0F;
  float fadingHz_ = 0.0F;
  float outputGainTarget_ = 1.0F;
  float mixTarget_ = 1.0F;
  float pllLock_ = 0.0F;
  float cnrBlend_ = 1.0F;
  // Control ramps (20 ms): current values tracked in f64 with
  // f32-rounded one-pole coefficients shared bit for bit with the JS
  // reference; the tuning NCO ramp rotates the step phasor per core sample.
  float controlAlphaHost_ = 1.0F;
  float controlAlphaMpx_ = 1.0F;
  float controlAlphaCore_ = 1.0F;
  double processingAmountCurrent_ = 0.0;
  double processingDriveCurrent_ = 1.0;
  double signalAmplitudeCurrent_ = 1.0;
  double multipathCurrent_ = 0.0;
  double pathDelayCurrentUs_ = 5.0;
  double outputGainCurrent_ = 1.0;
  double mixCurrent_ = 1.0;
  double tuningCurrentKhz_ = 0.0;
  double tuningRampStepKhz_ = 0.0;
  double tuningStepDeltaSine_ = 0.0;
  double tuningStepDeltaCosine_ = 1.0;
  double tuningTargetStepSine_ = 0.0;
  double tuningTargetStepCosine_ = 1.0;
  std::uint32_t tuningRampSamples_ = 0u;
  std::uint32_t tuningRampRemaining_ = 0u;
  std::uint32_t maxFrames_ = 0u;
  std::uint32_t latencySamples_ = 0u;
  std::uint32_t dryPosition_ = 0u;
  std::uint32_t multipathPosition_ = 0u;
  std::uint32_t seedLow_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t seedHigh_ = 0u;
  int stereoMode_ = 0;
  bool prepared_ = false;
  bool controlsConfigured_ = false;

  // Telemetry-only state (HUD; never read by the audio path).
  std::vector<float> spectrumRing_;
  std::vector<float> spectrumWindowed_;
  std::vector<float> hannWindow_;
  std::array<double, kSpectrumBins> goertzelCoefficients_{};
  double inverseWindowSum_ = 0.0;
  double rfPowerEma_ = 0.0;
  double rfPowerAlpha_ = 0.0;
  double telemetryNoisePower_ = 1.0e-30;
  std::uint32_t spectrumRingPosition_ = 0u;
  std::uint32_t clickCount_ = 0u;
  bool clickActive_ = false;
  bool telemetryAvailable_ = false;
};

static_assert(sizeof(FMRadioSimulatorKernel) <= 8192u);

} // namespace
} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(FMRadioSimulatorPlugin, effetune::plugins::lofi::FMRadioSimulatorKernel)

#include "SpeakerDistortionCorrectionPluginParams.h"
#include "effetune/kernel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_SpeakerDistortionCorrectionPlugin() noexcept;

namespace {

using Params = effetune::generated::SpeakerDistortionCorrectionPluginParams;

constexpr std::uint32_t kMagic = 0x31415445u;
constexpr std::uint32_t kChannels = 16u;
constexpr std::uint32_t kFrames = 1247u;
constexpr std::uint32_t kWeights = 1182u;
constexpr std::uint32_t kOddWeights = 1183u;
constexpr std::uint32_t kOddBounds = 1215u;
constexpr std::uint32_t kTopology = 2u;
constexpr std::uint32_t kHeaderBytes = 32u;
constexpr std::uint32_t kAssetBytes = kHeaderBytes + kChannels * kFrames * 4u;
constexpr std::uint32_t kFootprintCap = 32u * 1024u * 1024u;
constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::uint32_t kShort = 0u;
constexpr std::uint32_t kLong = 1u;
constexpr double kPi = 3.14159265358979323846;
const std::vector<std::uint32_t> kOddBlocks{37u, 64u, 1u, 128u, 5u, 99u};

int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (condition)
    return;
  std::fprintf(stderr, "speaker_distortion_correction/native_test.cpp:%d: check failed: %s\n", line,
               expression);
  ++failures;
}

#define SDC_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

void writeU32(std::uint8_t *bytes, std::uint32_t value) noexcept {
  for (std::uint32_t index = 0u; index < 4u; ++index)
    bytes[index] = static_cast<std::uint8_t>(value >> (8u * index));
}

std::uint16_t readU16(const std::uint8_t *bytes) noexcept {
  return static_cast<std::uint16_t>(bytes[0] | (bytes[1] << 8u));
}

std::uint32_t readU32(const std::uint8_t *bytes) noexcept {
  return static_cast<std::uint32_t>(bytes[0]) | (static_cast<std::uint32_t>(bytes[1]) << 8u) |
         (static_cast<std::uint32_t>(bytes[2]) << 16u) |
         (static_cast<std::uint32_t>(bytes[3]) << 24u);
}

float readF32(const std::uint8_t *bytes) noexcept {
  const std::uint32_t bits = readU32(bytes);
  float value = 0.0F;
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}

// Asset with deterministic weights in [-scale, scale) on the channels of `mask`.
std::vector<std::uint8_t> makeAsset(std::uint32_t step, double scale, std::uint32_t mask,
                                    std::uint32_t seed = 12345u) {
  std::vector<std::uint8_t> bytes(kAssetBytes, 0u);
  writeU32(bytes.data(), kMagic);
  writeU32(bytes.data() + 4u, kChannels);
  writeU32(bytes.data() + 8u, kFrames);
  writeU32(bytes.data() + 16u, kTopology);
  std::uint32_t state = seed;
  for (std::uint32_t channel = 0u; channel < kChannels; ++channel) {
    float *frames = reinterpret_cast<float *>(bytes.data() + kHeaderBytes) +
                    static_cast<std::size_t>(channel) * kFrames;
    for (std::uint32_t index = 0u; index < kWeights && ((mask >> channel) & 1u) != 0u; ++index) {
      state = state * 1664525u + 1013904223u;
      const double unit = static_cast<double>(state >> 8u) / 16777216.0;
      frames[index] = static_cast<float>((2.0 * unit - 1.0) * scale);
    }
    frames[kWeights] = static_cast<float>(step);
  }
  return bytes;
}

float *assetFrames(std::vector<std::uint8_t> &bytes, std::uint32_t channel) noexcept {
  return reinterpret_cast<float *>(bytes.data() + kHeaderBytes) +
         static_cast<std::size_t>(channel) * kFrames;
}

// Odd weights in [-scale, scale) and bounds in [0.5, 4.5) on `channel`.
void addOdd(std::vector<std::uint8_t> &bytes, std::uint32_t channel, std::uint32_t seed,
            double scale = 0.02) {
  float *frames = assetFrames(bytes, channel);
  std::uint32_t state = seed;
  for (std::uint32_t a = 0u; a < 32u; ++a) {
    state = state * 1664525u + 1013904223u;
    frames[kOddWeights + a] =
        static_cast<float>((static_cast<double>(state >> 8u) / 8388608.0 - 1.0) * scale);
    state = state * 1664525u + 1013904223u;
    frames[kOddBounds + a] =
        static_cast<float>(0.5 + 4.0 * static_cast<double>(state >> 8u) / 16777216.0);
  }
}

std::vector<float> testSignal(std::uint32_t frames, double fs, double amplitude,
                              double phase = 0.0) {
  std::vector<float> signal(frames);
  for (std::uint32_t n = 0u; n < frames; ++n) {
    const double t = static_cast<double>(n) / fs;
    signal[n] = static_cast<float>(amplitude * (0.45 * std::sin(2.0 * kPi * 37.0 * t + phase) +
                                                0.3 * std::sin(2.0 * kPi * 160.0 * t + 0.4) +
                                                0.15 * std::sin(2.0 * kPi * 1300.0 * t + 1.1) +
                                                0.1 * std::sin(2.0 * kPi * 6900.0 * t + phase)));
  }
  return signal;
}

// ---------------------------------------------------------------------------------------------
// Float64 reference of the corrector, written in whole-signal form from the specification:
// direct-form sections, the held low-rate products, and the 90-degree path as plain
// convolutions with decimation and zero stuffing. The odd block (frames 1183-1246 of `weights`)
// is held over 2D samples and subtracted with S0.

double besselI0(double x) {
  double sum = 1.0;
  double term = 1.0;
  for (double k = 1.0;; k += 1.0) {
    term *= (x * x * 0.25) / (k * k);
    if (term < 1e-17 * sum)
      return sum;
    sum += term;
  }
}

struct Peak {
  double a1;
  double a2;
  double peakScale;
  double quadratureScale;
};

Peak designPeak(double f, double q, double fs) {
  const double w0 = 2.0 * kPi * f / fs;
  const double g = 1.0 / (1.0 + std::tan(w0 / (2.0 * q)));
  Peak peak{-2.0 * g * std::cos(w0), 2.0 * g - 1.0, 1.0 - g, 0.0};
  const double re = 1.0 + peak.a1 * std::cos(w0) + peak.a2 * std::cos(2.0 * w0);
  const double im = peak.a1 * std::sin(w0) + peak.a2 * std::sin(2.0 * w0);
  peak.quadratureScale = std::hypot(re, im);
  return peak;
}

struct Design {
  std::vector<Peak> low;
  std::vector<Peak> high;
  std::uint32_t decimation = 2u;
  double advance = 0.0;
  std::vector<std::vector<double>> halfBands; // full taps, index 0 ... L - 1
  std::vector<double> filter;                 // taps for m = -d ... d
  std::uint32_t half = 0u;
  std::uint32_t spread = 1u;
  std::uint32_t latency = 0u;
};

Design design(double fs, std::uint32_t length) {
  Design result;
  for (int i = 0; i < 16; ++i)
    result.low.push_back(designPeak(20.0 * std::pow(2.0, i / 3.0), 2.15, fs));
  for (double f : {580.0, 1050.0, 1900.0, 3450.0, 6200.0, 7800.0})
    result.high.push_back(designPeak(f, 1.4, fs));
  while (fs / (2.0 * result.decimation) >= 22050.0)
    result.decimation *= 2u;
  const double d = result.decimation;
  result.advance = ((d - 1.0) / (2.0 * fs) - 0.5 / 48000.0) * fs / d;
  const double fb = 2.0 * fs / d;
  const std::uint32_t longStages = static_cast<std::uint32_t>(std::lround(std::log2(d / 2.0)));
  const bool shortSpread = length == kShort && result.decimation > 2u;
  const std::uint32_t stages = shortSpread ? longStages - 1u : longStages;
  result.spread = shortSpread ? 2u : 1u;
  double rate = fs;
  for (std::uint32_t level = 0u; level < stages; ++level, rate *= 0.5) {
    const double required =
        std::ceil(42.05 / (2.285 * 2.0 * kPi * (rate / 2.0 - 40000.0) / rate)) + 1.0;
    std::uint32_t k = 1u;
    while (4.0 * k - 1.0 < required)
      ++k;
    const int span = static_cast<int>(2u * k - 1u);
    std::vector<double> taps;
    for (int n = -span; n <= span; ++n) {
      const double ratio = static_cast<double>(n) / span;
      const double kaiser = besselI0(4.5335 * std::sqrt(1.0 - ratio * ratio)) / besselI0(4.5335);
      taps.push_back(n == 0 ? 0.5 : std::sin(kPi * n / 2.0) / (kPi * n) * kaiser);
    }
    result.halfBands.push_back(taps);
  }
  result.half =
      static_cast<std::uint32_t>(std::lround((length == kShort ? 0.000625 : 0.0025) * fb));
  const int half = static_cast<int>(result.half);
  for (int m = -half; m <= half; ++m) {
    const double ratio = static_cast<double>(m) / half;
    const double kaiser = besselI0(4.3 * std::sqrt(1.0 - ratio * ratio)) / besselI0(4.3);
    result.filter.push_back((m & 1) != 0 ? -2.0 * kaiser / (kPi * m) : 0.0);
  }
  std::uint32_t latency = result.half * result.spread;
  for (std::uint32_t level = stages; level > 0u; --level)
    latency = 2u * latency + static_cast<std::uint32_t>(result.halfBands[level - 1u].size()) - 1u;
  result.latency = latency;
  return result;
}

std::vector<double> quadraturePath(const Design &dz, const std::vector<double> &signal,
                                   std::size_t level) {
  const std::size_t count = signal.size();
  std::vector<double> output(count, 0.0);
  if (level == dz.halfBands.size()) {
    const long long half = dz.half;
    const long long spread = dz.spread;
    for (std::size_t n = 0u; n < count; ++n) {
      double sum = 0.0;
      for (long long m = -half; m <= half; ++m) {
        const long long index = static_cast<long long>(n) - (half + m) * spread;
        if (index >= 0)
          sum += dz.filter[static_cast<std::size_t>(m + half)] * signal[index];
      }
      output[n] = sum;
    }
    return output;
  }
  const std::vector<double> &taps = dz.halfBands[level];
  const long long length = static_cast<long long>(taps.size());
  std::vector<double> decimated(count / 2u, 0.0);
  for (std::size_t m = 0u; m < decimated.size(); ++m) {
    double sum = 0.0;
    for (long long t = 0; t < length; ++t) {
      const long long index = static_cast<long long>(2u * m + 1u) - t;
      if (index >= 0)
        sum += taps[t] * signal[index];
    }
    decimated[m] = sum;
  }
  const std::vector<double> filtered = quadraturePath(dz, decimated, level + 1u);
  for (std::size_t i = 0u; i < count; ++i) {
    double sum = 0.0;
    for (long long t = 0; t < length; ++t) {
      const long long index = static_cast<long long>(i) - t;
      if (index >= 0 && (index & 1) != 0)
        sum += 2.0 * taps[t] * filtered[static_cast<std::size_t>((index - 1) / 2)];
    }
    output[i] = sum;
  }
  return output;
}

std::vector<double> reference(const std::vector<float> &input, const float *weights, double fs,
                              std::uint32_t length, double s) {
  const Design dz = design(fs, length);
  std::vector<double> lowScale(32);
  std::vector<double> highScale(12);
  for (int i = 0; i < 16; ++i) {
    lowScale[2 * i] = dz.low[i].peakScale;
    lowScale[2 * i + 1] = dz.low[i].quadratureScale;
  }
  for (int j = 0; j < 6; ++j) {
    highScale[2 * j] = dz.high[j].peakScale;
    highScale[2 * j + 1] = dz.high[j].quadratureScale;
  }
  std::vector<double> W(32 * 32, 0.0);
  std::vector<double> V(32 * 6), VQ(32 * 6), V2(32 * 6);
  std::vector<double> HH(12 * 12, 0.0);
  std::size_t index = 0u;
  for (int a = 0; a < 32; ++a)
    for (int b = a; b < 32; ++b, ++index)
      W[a * 32 + b] = weights[index] * lowScale[a] * lowScale[b] / 0.1;
  for (int a = 0; a < 32; ++a) {
    for (int j = 0; j < 6; ++j) {
      V[a * 6 + j] = weights[528 + a * 6 + j] * lowScale[a] * highScale[2 * j] / 0.1;
      VQ[a * 6 + j] = weights[720 + a * 6 + j] * lowScale[a] * highScale[2 * j + 1] / 0.1;
      V2[a * 6 + j] = weights[990 + a * 6 + j] * lowScale[a] * highScale[2 * j] / 0.1;
    }
  }
  index = 912u;
  for (int c = 0; c < 12; ++c)
    for (int e = c; e < 12; ++e, ++index)
      HH[c * 12 + e] = weights[index] * highScale[c] * highScale[e] / 0.1;

  bool oddActive = false;
  std::array<double, 32> oddE{}, oddT{};
  for (int a = 0; a < 32; ++a)
    oddActive = oddActive || weights[kOddWeights + a] != 0.0F;
  const double magnitude = std::fabs(s);
  for (int a = 0; oddActive && a < 32; ++a) {
    const double ka = lowScale[a] / (0.1 * weights[kOddBounds + a]) * magnitude;
    oddE[a] = 0.1 * weights[kOddWeights + a] * ka * ka * ka / s;
    oddT[a] = 1.0 / ka;
  }

  const std::size_t count = input.size();
  std::vector<double> s0(count), s1(count), ql(count);
  double qlHeld = 0.0;
  std::array<double, 16> v1{}, v2{};
  std::array<double, 6> g1{}, g2{};
  std::array<double, 32> r{};
  std::array<double, 12> t{};
  std::array<double, 6> u{}, uq{}, u2{};
  double qPrev = 0.0;
  double qHeld = 0.0;
  for (std::size_t n = 0u; n < count; ++n) {
    const double x = input[n];
    std::array<double, 16> v{};
    std::array<double, 6> g{};
    for (int i = 0; i < 16; ++i)
      v[i] = x - dz.low[i].a1 * v1[i] - dz.low[i].a2 * v2[i];
    for (int j = 0; j < 6; ++j) {
      g[j] = x - dz.high[j].a1 * g1[j] - dz.high[j].a2 * g2[j];
      t[2 * j] = g[j] - g2[j];
      t[2 * j + 1] = g1[j];
    }
    if (n % dz.decimation == 0u) {
      for (int i = 0; i < 16; ++i) {
        r[2 * i] = v[i] - v2[i];
        r[2 * i + 1] = v1[i];
      }
      double q = 0.0;
      for (int a = 0; a < 32; ++a)
        for (int b = a; b < 32; ++b)
          q += W[a * 32 + b] * r[a] * r[b];
      qHeld = q + dz.advance * (q - qPrev);
      qPrev = q;
      for (int j = 0; j < 6; ++j) {
        u[j] = uq[j] = u2[j] = 0.0;
        for (int a = 0; a < 32; ++a) {
          u[j] += V[a * 6 + j] * r[a];
          uq[j] += VQ[a * 6 + j] * r[a];
          u2[j] += V2[a * 6 + j] * r[a];
        }
      }
      if (oddActive && n % (2u * dz.decimation) == 0u) {
        qlHeld = 0.0;
        for (int a = 0; a < 32; ++a) {
          const double c = std::clamp(r[a], -oddT[a], oddT[a]);
          qlHeld += oddE[a] * c * c * c;
        }
      }
    }
    ql[n] = qlHeld;
    double sum0 = qHeld;
    double sum1 = 0.0;
    for (int j = 0; j < 6; ++j) {
      sum0 += t[2 * j] * u[j] + t[2 * j + 1] * uq[j];
      sum1 += t[2 * j] * u2[j];
    }
    for (int c = 0; c < 12; ++c)
      for (int e = c; e < 12; ++e)
        sum0 += HH[c * 12 + e] * t[c] * t[e];
    s0[n] = sum0;
    s1[n] = sum1;
    v2 = v1;
    v1 = v;
    g2 = g1;
    g1 = g;
  }
  const std::vector<double> p = quadraturePath(dz, s1, 0u);
  std::vector<double> output(count, 0.0);
  for (std::size_t n = 0u; n < count; ++n) {
    const double delayed =
        n >= dz.latency ? input[n - dz.latency] - (s * s0[n - dz.latency] + ql[n - dz.latency])
                        : 0.0;
    output[n] = delayed - s * p[n];
  }
  return output;
}

// ---------------------------------------------------------------------------------------------

Params parameters(float dv = 0.0F, float mode = 0.0F, float first = 0.0F,
                  float count = 0.0F) noexcept {
  Params values{};
  values.amplifierVolumeChange = dv;
  values.mode = mode;
  values.selectedFirst = first;
  values.selectedCount = count;
  return values;
}

effetune::AssetBeginInfo assetInfo() noexcept {
  return {kChannels, kFrames, kTopology, 0u, 1u, 0u, 0u, 2u, kFootprintCap, kAssetBytes};
}

class Harness final {
public:
  explicit Harness(float sampleRate, Params values = parameters()) {
    descriptor_ = et_kernel_descriptor_SpeakerDistortionCorrectionPlugin();
    SDC_CHECK(descriptor_ != nullptr);
    if (descriptor_ == nullptr || descriptor_->objectSize > storage_.size()) {
      SDC_CHECK(descriptor_ == nullptr || descriptor_->objectSize <= storage_.size());
      return;
    }
    SDC_CHECK(descriptor_->paramsHash == Params::kHash);
    kernel_ = descriptor_->construct(storage_.data());
    SDC_CHECK(kernel_ != nullptr);
    if (kernel_ == nullptr)
      return;
    kernel_->prepare({sampleRate, 2u, kMaximumFrames});
    SDC_CHECK(kernel_->preparedSuccessfully());
    stage(values);
  }

  ~Harness() {
    if (kernel_ != nullptr)
      descriptor_->destroy(kernel_);
  }

  Harness(const Harness &) = delete;
  Harness &operator=(const Harness &) = delete;

  void stage(const Params &values) noexcept {
    SDC_CHECK(kernel_->stageParameters(reinterpret_cast<const float *>(&values),
                                       Params::kFloatCount, Params::kHash) == ET_OK);
    kernel_->applyPendingParameters();
  }

  et_status commit(const std::vector<std::uint8_t> &bytes) noexcept {
    std::uint8_t *staging = kernel_->beginAsset(0u, assetInfo());
    SDC_CHECK(staging != nullptr);
    if (staging == nullptr)
      return ET_ERR_ARGS;
    std::memcpy(staging, bytes.data(), bytes.size());
    return kernel_->commitAsset(0u, static_cast<std::uint32_t>(bytes.size()), ET_ASSET_F32_MULTICH);
  }

  void activate(const std::vector<std::uint8_t> &bytes) noexcept {
    SDC_CHECK(commit(bytes) == ET_OK);
    SDC_CHECK(state() == ET_ASSET_STATE_PREPARING);
    std::array<float, 2u> silence{};
    kernel_->process(silence.data(), 2u, 1u, {0.0});
    SDC_CHECK(state() == ET_ASSET_STATE_ACTIVE);
    kernel_->reset();
  }

  [[nodiscard]] std::uint32_t state() const noexcept { return kernel_->assetState(0u) & 0xffu; }

  // Renders two planar channels through blocks cycling over `blocks`.
  std::array<std::vector<float>, 2> render(const std::vector<float> &left,
                                           const std::vector<float> &right,
                                           const std::vector<std::uint32_t> &blocks) noexcept {
    const std::uint32_t total = static_cast<std::uint32_t>(left.size());
    std::array<std::vector<float>, 2> output{left, right};
    std::uint32_t offset = 0u;
    for (std::size_t block = 0u; offset < total; ++block) {
      const std::uint32_t requested = blocks[block % blocks.size()];
      const std::uint32_t frames = requested < total - offset ? requested : total - offset;
      std::array<float, 2u * kMaximumFrames> audio{};
      std::copy_n(left.data() + offset, frames, audio.data());
      std::copy_n(right.data() + offset, frames, audio.data() + frames);
      kernel_->process(audio.data(), 2u, frames, {0.0});
      std::copy_n(audio.data(), frames, output[0].data() + offset);
      std::copy_n(audio.data() + frames, frames, output[1].data() + offset);
      offset += frames;
    }
    return output;
  }

  [[nodiscard]] effetune::PluginKernel *kernel() const noexcept { return kernel_; }

  // Reads every frame the kernel writes; returns the number of frames and the last one's bytes.
  std::uint32_t telemetry(std::array<std::uint8_t, 64> &frame) noexcept {
    std::array<std::uint8_t, 256> storage{};
    std::array<std::uint8_t, 256> output{};
    effetune::TelemetryRing ring;
    ring.adopt(storage.data(), static_cast<std::uint32_t>(storage.size()));
    std::uint32_t sequence = 0u;
    effetune::TelemetryWriter writer(ring, 7u, sequence);
    kernel_->writeTelemetry(writer);
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
    std::copy_n(output.data(), bytes < frame.size() ? bytes : frame.size(), frame.data());
    return bytes == 0u ? 0u : bytes / 20u;
  }

private:
  alignas(std::max_align_t) std::array<std::byte, 65536> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

std::vector<float> delayed(const std::vector<float> &signal, std::uint32_t delay) {
  std::vector<float> output(signal.size(), 0.0F);
  for (std::size_t n = delay; n < signal.size(); ++n)
    output[n] = signal[n - delay];
  return output;
}

double rms(const std::vector<double> &signal) {
  double sum = 0.0;
  for (double value : signal)
    sum += value * value;
  return std::sqrt(sum / static_cast<double>(signal.size()));
}

// Kernel output of `channel` against the reference for `input`.
void checkAgainstReference(const std::vector<float> &output, const std::vector<float> &input,
                           const float *weights, float fs, std::uint32_t length, double s,
                           std::uint32_t latency, double minimumCorrection) {
  const std::vector<double> expected = reference(input, weights, fs, length, s);
  const std::size_t frames = input.size();
  std::vector<double> error(frames), correction(frames);
  double worst = 0.0;
  for (std::size_t n = 0u; n < frames; ++n) {
    error[n] = output[n] - expected[n];
    correction[n] = expected[n] - (n >= latency ? input[n - latency] : 0.0F);
    const double magnitude = std::fabs(error[n]);
    worst = magnitude > worst ? magnitude : worst;
  }
  SDC_CHECK(rms(correction) > minimumCorrection);
  if (fs < 100000.0F) {
    SDC_CHECK(worst <= 1e-6);
  } else {
    SDC_CHECK(20.0 * std::log10(rms(error) / rms(correction)) <= -80.0);
  }
}

// Kernel output of channel 0 against the reference, and channel 1 against x delayed by latency.
// With `odd`, channel 0 also carries odd weights and channel 1 is odd-only.
void testReference(float fs, std::uint32_t length, std::uint32_t frames, bool odd) {
  std::vector<std::uint8_t> asset = makeAsset(length, 0.002, 1u);
  if (odd) {
    addOdd(asset, 0u, 77u);
    addOdd(asset, 1u, 78u);
  }
  Harness harness(fs);
  harness.activate(asset);
  const std::vector<float> left = testSignal(frames, fs, 0.5);
  const std::vector<float> right = testSignal(frames, fs, 0.4, 1.0);
  const auto output = harness.render(left, right, kOddBlocks);
  const std::uint32_t latency = harness.kernel()->latencySamples();
  SDC_CHECK(latency == design(fs, length).latency);
  checkAgainstReference(output[0], left, assetFrames(asset, 0u), fs, length, 1.0, latency, 1e-4);
  if (odd) {
    checkAgainstReference(output[1], right, assetFrames(asset, 1u), fs, length, 1.0, latency, 1e-5);
  } else {
    SDC_CHECK(output[1] == delayed(right, latency));
  }
}

// Zero odd weights leave the output bit-identical whatever the bounds hold, and an odd-only
// channel does not change another channel.
void testOddZeroIdentity() {
  for (std::uint32_t length : {kShort, kLong}) {
    const std::vector<float> left = testSignal(1500u, 96000.0, 0.5);
    const std::vector<float> right = testSignal(1500u, 96000.0, 0.4, 1.0);
    std::vector<std::uint8_t> plain = makeAsset(length, 0.002, 1u);
    std::vector<std::uint8_t> bounds = plain;
    for (std::uint32_t channel = 0u; channel < kChannels; ++channel) {
      float *frames = assetFrames(bounds, channel);
      for (std::uint32_t a = 0u; a < 32u; ++a)
        frames[kOddBounds + a] = channel == 0u ? 0.0F : std::numeric_limits<float>::quiet_NaN();
    }
    std::vector<std::uint8_t> other = plain;
    addOdd(other, 1u, 91u);
    std::array<std::vector<float>, 2> outputs[3];
    const std::vector<std::uint8_t> *assets[3] = {&plain, &bounds, &other};
    for (int i = 0; i < 3; ++i) {
      Harness harness(96000.0F, parameters(-4.0F, 1.0F));
      harness.activate(*assets[i]);
      outputs[i] = harness.render(left, right, kOddBlocks);
    }
    SDC_CHECK(outputs[1][0] == outputs[0][0] && outputs[1][1] == outputs[0][1]);
    SDC_CHECK(outputs[2][0] == outputs[0][0]);
    SDC_CHECK(outputs[2][1] != outputs[0][1]);
  }
}

// The odd block follows Amplifier Volume Change and Mode: against the reference at a fixed
// setting, and after a mid-stream change the output settles to the run that began there.
void testOddVolumeChange() {
  constexpr float fs = 48000.0F;
  const std::vector<float> left = testSignal(1800u, fs, 0.5);
  const std::vector<float> right = testSignal(1800u, fs, 0.4, 1.0);
  std::vector<std::uint8_t> asset = makeAsset(kShort, 0.002, 1u);
  addOdd(asset, 0u, 55u);
  addOdd(asset, 1u, 56u);
  const double s = -std::pow(10.0, -6.0 / 20.0);
  Harness fixed(fs, parameters(-6.0F, 1.0F));
  fixed.activate(asset);
  const auto steady = fixed.render(left, right, kOddBlocks);
  const std::uint32_t latency = fixed.kernel()->latencySamples();
  checkAgainstReference(steady[0], left, assetFrames(asset, 0u), fs, kShort, s, latency, 1e-4);
  checkAgainstReference(steady[1], right, assetFrames(asset, 1u), fs, kShort, s, latency, 1e-5);

  constexpr std::uint32_t change = 601u;
  Harness moved(fs);
  moved.activate(asset);
  const auto head =
      moved.render(std::vector<float>(left.begin(), left.begin() + change),
                   std::vector<float>(right.begin(), right.begin() + change), kOddBlocks);
  moved.stage(parameters(-6.0F, 1.0F));
  const auto tail =
      moved.render(std::vector<float>(left.begin() + change, left.end()),
                   std::vector<float>(right.begin() + change, right.end()), kOddBlocks);
  SDC_CHECK(head[1] != std::vector<float>(steady[1].begin(), steady[1].begin() + change));
  // Past the delay line and one odd hold, every sample matches the fixed-setting run.
  const std::uint32_t settle = latency + 4u;
  bool same = true;
  for (std::size_t c = 0u; c < 2u; ++c) {
    for (std::size_t n = settle; n < tail[c].size(); ++n)
      same = same && tail[c][n] == steady[c][change + n];
  }
  SDC_CHECK(same);
}

void testLatencyTable() {
  struct Row {
    float fs;
    std::uint32_t shortLatency;
    std::uint32_t longLatency;
  };
  const std::array<Row, 6> rows{{{44100.0F, 28u, 110u},
                                 {48000.0F, 30u, 120u},
                                 {88200.0F, 56u, 286u},
                                 {96000.0F, 60u, 278u},
                                 {176400.0F, 126u, 586u},
                                 {192000.0F, 134u, 570u}}};
  for (const Row &row : rows) {
    for (std::uint32_t length : {kShort, kLong}) {
      Harness harness(row.fs);
      SDC_CHECK(harness.kernel()->latencySamples() == 0u);
      harness.activate(makeAsset(length, 0.002, 1u));
      const std::uint32_t expected = length == kShort ? row.shortLatency : row.longLatency;
      SDC_CHECK(harness.kernel()->latencySamples() == expected);
      SDC_CHECK(design(row.fs, length).latency == expected);
    }
  }
}

void testPassThrough() {
  const std::vector<float> left = testSignal(700u, 48000.0, 0.7);
  const std::vector<float> right = testSignal(700u, 48000.0, 0.6, 2.0);
  {
    Harness harness(48000.0F);
    const auto output = harness.render(left, right, kOddBlocks);
    SDC_CHECK(output[0] == left && output[1] == right);
    SDC_CHECK(harness.kernel()->latencySamples() == 0u);
  }
  {
    Harness harness(48000.0F);
    harness.activate(makeAsset(kLong, 0.002, 0u));
    const auto output = harness.render(left, right, kOddBlocks);
    SDC_CHECK(output[0] == left && output[1] == right);
    SDC_CHECK(harness.kernel()->latencySamples() == 0u);
  }
  for (std::uint32_t length : {kShort, kLong}) {
    Harness harness(32000.0F);
    harness.activate(makeAsset(length, 0.002, 3u));
    const auto output = harness.render(left, right, kOddBlocks);
    SDC_CHECK(output[0] == left && output[1] == right);
    SDC_CHECK(harness.kernel()->latencySamples() == 0u);
  }
}

// Correction term y - x[n - latency] of channel 0.
std::vector<double> correctionOf(float fs, std::uint32_t length, const Params &values,
                                 const std::vector<float> &left) {
  Harness harness(fs, values);
  harness.activate(makeAsset(length, 0.002, 1u));
  const auto output = harness.render(left, left, kOddBlocks);
  const std::uint32_t latency = harness.kernel()->latencySamples();
  std::vector<double> correction(left.size());
  for (std::size_t n = 0u; n < left.size(); ++n)
    correction[n] = static_cast<double>(output[0][n]) - (n >= latency ? left[n - latency] : 0.0F);
  return correction;
}

void testScaleAndMode() {
  for (std::uint32_t length : {kShort, kLong}) {
    const std::vector<float> left = testSignal(1500u, 96000.0, 0.5);
    const std::vector<double> reduce = correctionOf(96000.0F, length, parameters(0.0F), left);
    const std::vector<double> lower = correctionOf(96000.0F, length, parameters(-6.0F), left);
    const std::vector<double> add = correctionOf(96000.0F, length, parameters(0.0F, 1.0F), left);
    const double gain = std::pow(10.0, -6.0 / 20.0);
    double scaleError = 0.0;
    double sumError = 0.0;
    for (std::size_t n = 0u; n < left.size(); ++n) {
      const double scaled = std::fabs(lower[n] - gain * reduce[n]);
      const double summed = std::fabs(add[n] + reduce[n]);
      scaleError = scaled > scaleError ? scaled : scaleError;
      sumError = summed > sumError ? summed : sumError;
    }
    SDC_CHECK(rms(reduce) > 1e-4);
    SDC_CHECK(scaleError <= 1e-6);
    SDC_CHECK(sumError <= 1e-6);
  }
}

void testBeginRejections() {
  Harness harness(48000.0F);
  effetune::PluginKernel *kernel = harness.kernel();
  const effetune::AssetBeginInfo valid = assetInfo();
  const auto rejects = [&](effetune::AssetBeginInfo info) {
    return kernel->beginAsset(0u, info) == nullptr;
  };
  effetune::AssetBeginInfo info = valid;
  info.channels = 15u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.frames = 1182u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.frames = 1183u;
  info.byteSize = kHeaderBytes + kChannels * 1183u * 4u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.topology = 3u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.headBlock = 128u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.rateDivider = 2u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.pathCount = 1u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.inputCount = 1u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.processingChannels = 0u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.processingChannels = 3u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.byteSize = kAssetBytes - 4u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.footprintBytes = kAssetBytes - 4u;
  SDC_CHECK(rejects(info));
  info = valid;
  info.footprintBytes = kFootprintCap + 1u;
  SDC_CHECK(rejects(info));
  SDC_CHECK(kernel->beginAsset(1u, valid) == nullptr);
  SDC_CHECK(kernel->assetCapacity(1u) == 0u);
  SDC_CHECK(harness.state() == ET_ASSET_STATE_NONE);
  info = valid;
  info.footprintBytes = kAssetBytes;
  SDC_CHECK(kernel->beginAsset(0u, info) != nullptr);
  SDC_CHECK(harness.state() == ET_ASSET_STATE_STAGED);
}

void testCommitRejections() {
  using Mutation = void (*)(std::vector<std::uint8_t> &);
  const std::array<Mutation, 17> mutations{
      [](std::vector<std::uint8_t> &bytes) { writeU32(bytes.data(), kMagic + 1u); },
      [](std::vector<std::uint8_t> &bytes) { writeU32(bytes.data() + 4u, 2u); },
      [](std::vector<std::uint8_t> &bytes) { writeU32(bytes.data() + 8u, 1182u); },
      [](std::vector<std::uint8_t> &bytes) { writeU32(bytes.data() + 8u, 1183u); },
      [](std::vector<std::uint8_t> &bytes) { assetFrames(bytes, 0u)[kOddBounds + 7u] = 0.0F; },
      [](std::vector<std::uint8_t> &bytes) { assetFrames(bytes, 0u)[kOddBounds] = -1.0F; },
      [](std::vector<std::uint8_t> &bytes) {
        assetFrames(bytes, 0u)[kOddBounds + 31u] = std::numeric_limits<float>::quiet_NaN();
      },
      [](std::vector<std::uint8_t> &bytes) {
        assetFrames(bytes, 0u)[kOddBounds + 2u] = std::numeric_limits<float>::infinity();
      },
      [](std::vector<std::uint8_t> &bytes) { assetFrames(bytes, 5u)[kOddWeights + 4u] = 1000.0F; },
      [](std::vector<std::uint8_t> &bytes) {
        assetFrames(bytes, 0u)[kOddWeights + 30u] = std::numeric_limits<float>::quiet_NaN();
      },
      [](std::vector<std::uint8_t> &bytes) { writeU32(bytes.data() + 16u, 3u); },
      [](std::vector<std::uint8_t> &bytes) {
        assetFrames(bytes, 0u)[17] = std::numeric_limits<float>::quiet_NaN();
      },
      [](std::vector<std::uint8_t> &bytes) {
        assetFrames(bytes, 1u)[900] = std::numeric_limits<float>::infinity();
      },
      [](std::vector<std::uint8_t> &bytes) { assetFrames(bytes, 0u)[1181] = 1000.0F; },
      [](std::vector<std::uint8_t> &bytes) { assetFrames(bytes, 0u)[3] = -1000.0F; },
      [](std::vector<std::uint8_t> &bytes) { assetFrames(bytes, 9u)[kWeights] = 1.0F; },
      [](std::vector<std::uint8_t> &bytes) {
        for (std::uint32_t channel = 0u; channel < kChannels; ++channel)
          assetFrames(bytes, channel)[kWeights] = 2.0F;
      },
  };
  const std::vector<float> left = testSignal(400u, 48000.0, 0.6);
  const std::vector<float> right = testSignal(400u, 48000.0, 0.3, 0.5);
  std::vector<std::uint8_t> valid = makeAsset(kShort, 0.002, 1u);
  addOdd(valid, 0u, 33u);
  for (const Mutation mutate : mutations) {
    Harness harness(48000.0F);
    harness.activate(valid);
    SDC_CHECK(harness.kernel()->latencySamples() == 30u);
    std::vector<std::uint8_t> bytes = valid;
    mutate(bytes);
    SDC_CHECK(harness.commit(bytes) == ET_ERR_ARGS);
    SDC_CHECK(harness.kernel()->assetState(0u) == (ET_ASSET_STATE_ERROR | (1u << 8u)));
    SDC_CHECK(harness.kernel()->latencySamples() == 0u);
    const auto output = harness.render(left, right, kOddBlocks);
    SDC_CHECK(output[0] == left && output[1] == right);
  }
  {
    Harness harness(48000.0F);
    const std::vector<std::uint8_t> bytes = makeAsset(kShort, 0.002, 1u);
    std::uint8_t *staging = harness.kernel()->beginAsset(0u, assetInfo());
    SDC_CHECK(staging != nullptr);
    std::memcpy(staging, bytes.data(), bytes.size());
    SDC_CHECK(harness.kernel()->commitAsset(0u, kAssetBytes, 2u) == ET_ERR_ARGS);
    SDC_CHECK(harness.kernel()->commitAsset(0u, kAssetBytes, ET_ASSET_F32_MULTICH) == ET_ERR_ARGS);
  }
  {
    Harness harness(48000.0F);
    harness.activate(makeAsset(kLong, 0.002, 1u));
    harness.kernel()->clearAsset(0u);
    SDC_CHECK(harness.state() == ET_ASSET_STATE_NONE);
    SDC_CHECK(harness.kernel()->latencySamples() == 0u);
    const auto output = harness.render(left, right, kOddBlocks);
    SDC_CHECK(output[0] == left && output[1] == right);
  }
}

// A new asset committed mid-stream takes over at the next block with fresh state, including the
// held odd term and its hold phase.
void testRecommit() {
  constexpr float fs = 96000.0F;
  constexpr std::uint32_t first = 777u;
  constexpr std::uint32_t total = 2000u;
  std::vector<std::uint8_t> first_asset = makeAsset(kShort, 0.002, 1u);
  addOdd(first_asset, 0u, 21u);
  addOdd(first_asset, 1u, 22u);
  std::vector<std::uint8_t> second = makeAsset(kLong, 0.003, 1u, 999u);
  addOdd(second, 0u, 23u);
  const std::vector<float> left = testSignal(total, fs, 0.5);
  Harness harness(fs);
  harness.activate(first_asset);
  const std::vector<float> head(left.begin(), left.begin() + first);
  const std::vector<float> tail(left.begin() + first, left.end());
  harness.render(head, head, kOddBlocks);
  SDC_CHECK(harness.commit(second) == ET_OK);
  SDC_CHECK(harness.kernel()->latencySamples() == 278u);
  const auto output = harness.render(tail, tail, kOddBlocks);
  SDC_CHECK(harness.state() == ET_ASSET_STATE_ACTIVE);
  // Channel 1 lost its odd block, so its held odd term must not leak into the new asset.
  SDC_CHECK(output[1] == delayed(tail, 278u));
  const std::vector<double> expected = reference(tail, assetFrames(second, 0u), fs, kLong, 1.0);
  double worst = 0.0;
  for (std::size_t n = 0u; n < tail.size(); ++n) {
    const double error = std::fabs(output[0][n] - expected[n]);
    worst = error > worst ? error : worst;
  }
  SDC_CHECK(worst <= 1e-6);
}

void testOverloadTelemetry() {
  std::array<std::uint8_t, 64> frame{};
  {
    Harness harness(48000.0F);
    harness.activate(makeAsset(kShort, 0.002, 1u));
    const std::vector<float> loud = testSignal(300u, 48000.0, 1.6);
    const auto output = harness.render(loud, std::vector<float>(300u, 0.0F), kOddBlocks);
    float peak = 0.0F;
    for (float sample : output[0])
      peak = std::fabs(sample) > peak ? std::fabs(sample) : peak;
    SDC_CHECK(peak > 1.0F);
    SDC_CHECK(harness.telemetry(frame) == 1u);
    SDC_CHECK(readU16(frame.data()) == 1u);
    SDC_CHECK(readU16(frame.data() + 2u) == 1u);
    SDC_CHECK(readU32(frame.data() + 4u) == 7u);
    SDC_CHECK(readU16(frame.data() + 12u) == 4u);
    SDC_CHECK(readU16(frame.data() + 14u) == 0u);
    SDC_CHECK(readF32(frame.data() + 16u) == peak);
    SDC_CHECK(harness.telemetry(frame) == 0u);
  }
  {
    Harness harness(48000.0F);
    harness.activate(makeAsset(kShort, 0.002, 1u));
    harness.render(testSignal(300u, 48000.0, 0.1), testSignal(300u, 48000.0, 1.6), kOddBlocks);
    SDC_CHECK(harness.telemetry(frame) == 0u);
  }
  {
    Harness harness(48000.0F);
    const std::vector<float> loud = testSignal(300u, 48000.0, 1.6);
    harness.render(loud, loud, kOddBlocks);
    SDC_CHECK(harness.telemetry(frame) == 0u);
  }
}

void testPhysicalRouting() {
  const float fs = 48000.0F;
  auto asset = makeAsset(kShort, 0.002, 0xdu);
  addOdd(asset, 3u, 512u);
  std::vector<float> left(1024u), right(1024u);
  for (std::size_t n = 0u; n < left.size(); ++n) {
    left[n] = static_cast<float>(0.1 * std::sin(static_cast<double>(n) * 0.17) + 0.02);
    right[n] = static_cast<float>(0.1 * std::cos(static_cast<double>(n) * 0.13) - 0.03);
  }
  Harness harness(fs);
  harness.activate(asset);
  // Change only the ordinary parameters: the physical bank never needs replacing.
  for (const auto &route :
       {std::array<std::uint32_t, 2>{0u, 2u}, {1u, 1u}, {2u, 2u}, {0u, 1u}, {2u, 2u}, {4u, 2u}}) {
    const auto first = route[0];
    const auto count = route[1];
    harness.stage(parameters(0.0F, 0.0F, static_cast<float>(first), static_cast<float>(count)));
    const bool corrected = first != 1u && first != 4u;
    SDC_CHECK(harness.kernel()->latencySamples() == (corrected ? 30u : 0u));
    const auto output = harness.render(left, right, kOddBlocks);
    if (!corrected) {
      SDC_CHECK(output[0] == left);
      SDC_CHECK(output[1] == right);
      continue;
    }
    checkAgainstReference(output[0], left, assetFrames(asset, first), fs, kShort, 1.0, 30u, 0.0);
    if (count == 2u) {
      if (first == 0u)
        SDC_CHECK(output[1] == delayed(right, 30u));
      else
        checkAgainstReference(output[1], right, assetFrames(asset, first + 1u), fs, kShort, 1.0,
                              30u, 0.0);
    } else {
      SDC_CHECK(output[1] == right);
    }
  }
  // Latency also follows the span while a new physical bank waits for activation.
  harness.stage(parameters(0.0F, 0.0F, 2.0F, 2.0F));
  SDC_CHECK(harness.commit(makeAsset(kLong, 0.002, 1u)) == ET_OK);
  SDC_CHECK(harness.kernel()->latencySamples() == 0u);
  const auto bypass = harness.render(left, right, kOddBlocks);
  SDC_CHECK(bypass[0] == left && bypass[1] == right);
  harness.stage(parameters(0.0F, 0.0F, 0.0F, 1.0F));
  SDC_CHECK(harness.kernel()->latencySamples() == 120u);
  harness.kernel()->clearAsset(0u);
  SDC_CHECK(harness.kernel()->latencySamples() == 0u);
}

} // namespace

int main() {
  for (std::uint32_t length : {kShort, kLong}) {
    for (bool odd : {false, true}) {
      testReference(48000.0F, length, 2400u, odd);
      testReference(96000.0F, length, 3000u, odd);
      testReference(192000.0F, length, 4000u, odd);
    }
  }
  testOddZeroIdentity();
  testOddVolumeChange();
  testLatencyTable();
  testPassThrough();
  testScaleAndMode();
  testBeginRejections();
  testCommitRejections();
  testRecommit();
  testOverloadTelemetry();
  testPhysicalRouting();
  if (failures != 0) {
    std::fprintf(stderr, "%d Speaker Distortion Correction check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Speaker Distortion Correction kernel tests passed");
  return 0;
}

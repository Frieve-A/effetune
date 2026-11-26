#include <jni.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <numbers>
#include <stdexcept>
#include <vector>

extern "C" {
void dsd_decimate_bits(const uint8_t *, double, double, int, double, int, const double *,
                       const double *, double *);
void dsd_decimate_pcm(const double *, int, const double *, double *);
void dsd_resample(const double *, double, int, double, double, const double *, int, float *,
                  double *, double *, int);
int dst_decode(const uint8_t *, int, int, int, uint8_t *);
}

namespace {
constexpr int intermediateRate = 176400;
constexpr int maxFrames = 1024;
constexpr double pi = std::numbers::pi_v<double>;

double bessel(double x) {
  double sum = 1, term = 1;
  for (int i = 1; i < 40; ++i) {
    term *= x * x / (4 * i * i);
    sum += term;
    if (term < sum * 1e-16) break;
  }
  return sum;
}

// Same normalized Kaiser-windowed sinc design as createDsdLowpass in dsd-decoder.js.
void lowpass(double *out, int length, double cutoff, double phase = 0) {
  static const double denominator = bessel(12);
  const int half = (length - 1) / 2;
  double sum = 0;
  for (int i = 0; i < length; ++i) {
    const double d = i - half - phase, x = d / half;
    const double w = std::abs(x) >= 1 ? 0 : bessel(12 * std::sqrt(1 - x * x)) / denominator;
    out[i] = w * (d == 0 ? 2 * cutoff : std::sin(2 * pi * cutoff * d) / (pi * d));
    sum += out[i];
  }
  for (int i = 0; i < length; ++i) out[i] /= sum;
}

struct Window {
  int64_t start, end;
  int size() const { return static_cast<int>(end - start); }
};

struct Converter {
  jmethodID packed;
  int stages, channels, taps, slots;
  int64_t samples;
  bool dsf, lsb;
  double ratio;
  std::array<double, 353> first;
  std::array<double, 63> halfband;
  std::array<double, 45 * 256> table;
  std::vector<double> phases, cache, keys, a, b;
  std::vector<uint8_t> bytes, plane;
  std::array<float, maxFrames> pcm;

  Converter(jmethodID method, int rate, int output, int ch, int64_t bits, bool planar, bool lowFirst)
      : packed(method), channels(ch), samples(bits), dsf(planar), lsb(lowFirst) {
    if ((rate != 2822400 && rate != 5644800 && rate != 11289600) || output < 8000 ||
        output > 384000 || ch < 1 || ch > 6 || bits <= 0 || bits >= (INT64_C(1) << 53))
      throw std::invalid_argument("Invalid DSD conversion parameters");
    stages = rate == 2822400 ? 0 : (rate == 5644800 ? 1 : 2);
    ratio = static_cast<double>(intermediateRate) / output;
    const double stop = std::min(output, intermediateRate) / 2.0;
    const double pass = output >= 44100 ? 20000 : stop * 0.9;
    taps = 2 * static_cast<int>(std::ceil(120 / (2.285 * 2 * pi * ((stop - pass) / intermediateRate)) / 2)) + 1;
    const double cutoff = (pass + stop) / (2 * intermediateRate);
    lowpass(first.data(), first.size(), 0.02);
    lowpass(halfband.data(), halfband.size(), 0.1875);
    for (int byte = 0; byte < 45; ++byte) {
      for (unsigned v = 0; v < 256; ++v) {
        double sum = 0;
        for (int bit = 0; bit < 8 && byte * 8 + bit < 353; ++bit) {
          const unsigned shift = lsb ? bit : 7 - bit;
          sum += ((v >> shift) & 1 ? 1 : -1) * first[byte * 8 + bit];
        }
        table[byte * 256 + v] = sum;
      }
    }
    const int phaseCount = intermediateRate % output == 0 ? 1 : 513;
    phases.resize(phaseCount * taps);
    for (int p = 0; p < phaseCount; ++p) lowpass(&phases[p * taps], taps, cutoff, p / 512.0);
    slots = 1;
    while (phaseCount > 1 && slots < 512 && 2 * slots * taps * sizeof(double) <= 1024 * 1024) slots *= 2;
    cache.resize(slots * taps);
    keys.assign(slots, std::numeric_limits<double>::quiet_NaN());
  }

  void convert(JNIEnv *env, jobject file, int64_t frame, int count, float *out) {
    const int half = (taps - 1) / 2;
    std::array<Window, 3> windows;
    windows[stages] = {static_cast<int64_t>(std::floor(frame * ratio)) - half,
                       static_cast<int64_t>(std::floor((frame + count - 1) * ratio)) + half + 1};
    for (int stage = stages; stage > 0; --stage) {
      const auto w = windows[stage];
      windows[stage - 1] = {2 * w.start - 31, 2 * (w.end - 1) + 32};
    }
    const auto w = windows[0];
    const auto begin = std::max<int64_t>(0, w.start * 2 - 22);
    const auto end = std::min((samples + 7) / 8, w.end * 2 + 23);
    if (end <= begin || end - begin > 131072 || w.size() > 65536)
      throw std::invalid_argument("Invalid DSD window");
    const int size = static_cast<int>(end - begin);
    const int skip = dsf ? begin % 4096 : 0;
    const int packedSize = channels * (dsf ? ((skip + size + 4095) / 4096) * 4096 : size);
    auto block = static_cast<jbyteArray>(env->CallObjectMethod(file, packed, static_cast<jlong>(begin), size));
    if (env->ExceptionCheck()) return;
    if (!block || env->GetArrayLength(block) < packedSize) throw std::invalid_argument("Short DSD block");
    bytes.resize(packedSize);
    env->GetByteArrayRegion(block, 0, packedSize, reinterpret_cast<jbyte *>(bytes.data()));
    if (env->ExceptionCheck()) return;
    plane.resize(size);
    a.resize(w.size());
    if (stages) b.resize(windows[1].size());
    for (int ch = 0; ch < channels; ++ch) {
      if (dsf) {
        for (int i = 0; i < size;) {
          const int p = skip + i, n = std::min(size - i, 4096 - p % 4096);
          std::copy_n(&bytes[((p / 4096) * channels + ch) * 4096 + p % 4096], n, &plane[i]);
          i += n;
        }
      } else {
        for (int i = 0; i < size; ++i) plane[i] = bytes[i * channels + ch];
      }
      dsd_decimate_bits(plane.data(), begin, w.start, w.size(), samples, lsb,
                        first.data(), table.data(), a.data());
      double *in = a.data(), *next = b.data();
      for (int stage = 1; stage <= stages; ++stage) {
        dsd_decimate_pcm(in, windows[stage].size(), halfband.data(), next);
        std::swap(in, next);
      }
      dsd_resample(in, frame, count, ratio, windows[stages].start, phases.data(), taps,
                   pcm.data(), cache.data(), keys.data(), slots);
      for (int i = 0; i < count; ++i) out[i * channels + ch] = pcm[i];
    }
  }
};
} // namespace

extern "C" JNIEXPORT jlong JNICALL Java_com_frieve_effetune_DsdFile_create(
    JNIEnv *env, jobject file, jint rate, jint output, jint channels, jlong samples, jboolean dsf, jboolean lsb) {
  auto method = env->GetMethodID(env->GetObjectClass(file), "packed", "(JI)[B");
  if (!method) return 0;
  try {
    return reinterpret_cast<jlong>(new Converter(method, rate, output, channels, samples, dsf, lsb));
  } catch (const std::exception &e) {
    env->ThrowNew(env->FindClass("java/lang/IllegalArgumentException"), e.what());
    return 0;
  }
}

extern "C" JNIEXPORT void JNICALL Java_com_frieve_effetune_DsdFile_convert(
    JNIEnv *env, jobject file, jlong handle, jlong frame, jint count, jobject output) {
  auto *converter = reinterpret_cast<Converter *>(handle);
  try {
    auto *out = static_cast<float *>(env->GetDirectBufferAddress(output));
    if (!converter || !out || count <= 0 || count > maxFrames || frame < 0 ||
        frame >= (INT64_C(1) << 53) ||
        env->GetDirectBufferCapacity(output) < static_cast<jlong>(count) * converter->channels * 4)
      throw std::invalid_argument("Invalid DSD output block");
    converter->convert(env, file, frame, count, out);
  } catch (const std::exception &e) {
    env->ThrowNew(env->FindClass("java/io/IOException"), e.what());
  }
}

extern "C" JNIEXPORT void JNICALL Java_com_frieve_effetune_DsdFile_destroy(JNIEnv *, jclass, jlong handle) {
  delete reinterpret_cast<Converter *>(handle);
}

extern "C" JNIEXPORT jboolean JNICALL Java_com_frieve_effetune_DstPackets_decode(
    JNIEnv *env, jclass, jbyteArray input, jint bytes, jint channels, jint samples, jbyteArray output) {
  if (bytes <= 1 || bytes > 1048576 || env->GetArrayLength(input) < bytes || channels < 1 ||
      channels > 6 || (samples != 37632 && samples != 75264 && samples != 150528) ||
      env->GetArrayLength(output) < samples / 8 * channels) return false;
  auto *src = env->GetByteArrayElements(input, nullptr);
  if (!src) return false;
  auto *dst = env->GetByteArrayElements(output, nullptr);
  bool ok = dst && dst_decode(reinterpret_cast<uint8_t *>(src), bytes, channels, samples,
                              reinterpret_cast<uint8_t *>(dst)) == 0;
  if (dst) env->ReleaseByteArrayElements(output, dst, ok ? 0 : JNI_ABORT);
  env->ReleaseByteArrayElements(input, src, JNI_ABORT);
  return ok;
}

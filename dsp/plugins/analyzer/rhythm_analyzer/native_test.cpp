#include "allocation_guard.h"
#include "effetune/dsp/xorshift_rng.h"
#include "effetune/kernel.h"
#include "pffft.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <functional>
#include <memory>
#include <vector>
#if !defined(__EMSCRIPTEN__) &&                                                                    \
    (defined(_M_IX86) || defined(_M_X64) || defined(__i386__) || defined(__x86_64__))
#include "tc_tcn.h"
#include "tdp_prior.h"
#include <xmmintrin.h>
#define RHYTHM_TEST_HAS_X86_MXCSR 1
#endif

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_RhythmAnalyzerPlugin() noexcept;
namespace {
constexpr double pi = 3.14159265358979323846;
constexpr std::uint32_t kPayload = 1344u, kFrameBytes = 16u + kPayload;
int failures = 0;
void check(bool ok, const char *text, int line) {
  if (!ok) {
    std::fprintf(stderr, "rhythm_analyzer:%d %s\n", line, text);
    ++failures;
  }
}
#define CHECK(x) check(static_cast<bool>(x), #x, __LINE__)
std::uint32_t u32(const std::uint8_t *p) {
  return p[0] | (std::uint32_t(p[1]) << 8u) | (std::uint32_t(p[2]) << 16u) |
         (std::uint32_t(p[3]) << 24u);
}
float f32(const std::uint8_t *p) {
  auto bits = u32(p);
  float value;
  std::memcpy(&value, &bits, 4);
  return value;
}

// ---- Decoded telemetry -------------------------------------------------------------------
struct Event {
  double time;
  std::uint32_t band, epoch;
  std::int32_t index;
  float fraction, period, strength;
  bool unlocked;
  double deviation() const {
    return fraction < .5F ? fraction * period : (fraction - 1.0) * period;
  }
};
struct State {
  double time, context;
  std::uint32_t generation, frames, epoch, nextIndex, dropped, count;
  float confidence, period, comb, latency, tempogramPeak;
  double next;
  bool locked;
};
struct Log {
  std::vector<Event> events;
  std::vector<State> states;
};
struct Harness {
  alignas(std::max_align_t) std::array<std::byte, 8192> storage{};
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_RhythmAnalyzerPlugin();
  effetune::PluginKernel *kernel;
  std::vector<std::uint8_t> ring_bytes = std::vector<std::uint8_t>(65536),
                            bytes = std::vector<std::uint8_t>(65536);
  effetune::TelemetryRing ring;
  std::uint32_t sequence = 0;
  std::array<float, 3> params{40.0F, 240.0F, 0.0F};
  explicit Harness(float rate, float minimum = 40, float maximum = 240) {
    CHECK(descriptor->objectSize <= storage.size());
    CHECK(descriptor->paramsFloatCount == 3u);
    kernel = descriptor->construct(storage.data());
    kernel->prepare({rate, 4u, 1024u});
    CHECK(kernel->preparedSuccessfully());
    setRange(minimum, maximum);
    ring.adopt(ring_bytes.data(), static_cast<std::uint32_t>(ring_bytes.size()));
  }
  ~Harness() { descriptor->destroy(kernel); }
  void setRange(float minimum, float maximum) {
    params[0] = minimum;
    params[1] = maximum;
    apply();
  }
  void setClick(bool on) {
    params[2] = on ? 1.0F : 0.0F;
    apply();
  }
  void apply() {
    CHECK(kernel->stageParameters(params.data(), 3u, descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }
  void take(Log &log) {
    effetune::TelemetryWriter writer(ring, 207u, sequence);
    {
      const effetune::allocation_guard::Scope guard;
      kernel->writeTelemetry(writer);
    }
    std::uint32_t dropped = 0;
    const auto size = ring.read(bytes.data(), static_cast<std::uint32_t>(bytes.size()), &dropped);
    CHECK(dropped == 0u);
    CHECK(size % kFrameBytes == 0u);
    for (auto offset = 0u; offset < size; offset += kFrameBytes) {
      const auto *h = bytes.data() + offset;
      const auto *p = h + 16;
      CHECK(h[0] == 28u && h[1] == 0u && h[2] == 1u && u32(h + 12) % 65536u == kPayload);
      parse(p, log);
    }
  }
  static void parse(const std::uint8_t *p, Log &log) {
    const double rate = f32(p), step = u32(p + 8) / rate;
    State state{};
    state.generation = u32(p + 4);
    state.frames = u32(p + 12);
    state.time = state.frames * step;
    state.context = f32(p + 16);
    state.latency = f32(p + 20);
    state.dropped = u32(p + 24);
    state.count = u32(p + 28);
    state.locked = (u32(p + 32) & 1u) != 0u;
    state.epoch = u32(p + 36);
    state.confidence = f32(p + 40);
    state.period = f32(p + 44);
    state.next = (u32(p + 48) + static_cast<double>(f32(p + 52))) * step;
    state.nextIndex = u32(p + 56);
    state.comb = f32(p + 60);
    CHECK(state.generation != 0u && state.count <= 16u && (u32(p + 32) & ~1u) == 0u);
    CHECK(std::isfinite(state.confidence) && state.confidence >= 0.0F);
    if (state.locked) {
      // A switched-in level starts at least half an output beat after the last output beat, so the
      // next beat can lie more than one period ahead.
      CHECK(state.period > 0.0F && state.next > state.time &&
            state.next <= state.time + 1.5 * state.period + 1e-6);
      CHECK(f32(p + 52) >= 0.0F && f32(p + 52) < 1.0F);
    } else
      CHECK(state.period == 0.0F && u32(p + 48) == 0u && f32(p + 52) == 0.0F &&
            state.nextIndex == 0u);
    float peak = 0.0F;
    for (auto i = 0u; i < 192u; ++i) {
      const float value = f32(p + 64u + 4u * i);
      CHECK(value >= 0.0F && value <= 1.0F);
      peak = value > peak ? value : peak;
    }
    state.tempogramPeak = peak;
    for (auto k = 0u; k < 16u; ++k) {
      const auto *slot = p + 832u + 32u * k;
      if (k >= state.count) {
        for (auto i = 0u; i < 32u; ++i)
          CHECK(slot[i] == 0u);
        continue;
      }
      Event event{(u32(slot) + static_cast<double>(f32(slot + 4))) * step,
                  slot[28],
                  u32(slot + 8),
                  static_cast<std::int32_t>(u32(slot + 12)),
                  f32(slot + 16),
                  f32(slot + 20),
                  f32(slot + 24),
                  (slot[29] & 1u) != 0u};
      CHECK(f32(slot + 4) >= 0.0F && f32(slot + 4) < 1.0F);
      CHECK(event.band < 3u && (slot[29] & ~1u) == 0u && slot[30] == 0u && slot[31] == 0u);
      CHECK(std::isfinite(event.strength) && event.strength > 0.0F);
      CHECK(event.time <= state.time);
      if (event.unlocked)
        CHECK(event.epoch == 0u && event.index == 0 && event.fraction == 0.0F &&
              event.period == 0.0F);
      else
        CHECK(event.epoch > 0u && event.period > 0.0F && event.fraction >= 0.0F &&
              event.fraction < 1.0F);
      if (!log.events.empty())
        CHECK(event.time >= log.events.back().time - .05);
      log.events.push_back(event);
    }
    log.states.push_back(state);
  }
};
Log run(Harness &h, const std::vector<double> &signal, double rate,
        const std::vector<std::uint32_t> &blocks = {128u}, std::uint32_t channels = 2u,
        std::uint32_t takeEvery = 1u, double start = 0.0,
        std::vector<std::vector<double>> *added = nullptr) {
  Log log;
  if (added)
    added->resize(channels);
  std::size_t processed = 0u, block = 0u;
  std::vector<float> audio;
  effetune::dsp::XorShiftRng random(99u);
  while (processed < signal.size()) {
    const auto size = static_cast<std::uint32_t>(
        std::min<std::size_t>(blocks[block++ % blocks.size()], signal.size() - processed));
    audio.resize(static_cast<std::size_t>(channels) * size);
    for (auto i = 0u; i < size; ++i)
      for (auto ch = 0u; ch < channels; ++ch)
        audio[ch * size + i] =
            static_cast<float>(ch < 2u ? signal[processed + i] : .5 * random.nextFloatSigned());
    const auto original = audio;
    {
      const effetune::allocation_guard::Scope guard;
      h.kernel->process(audio.data(), channels, size,
                        {start + static_cast<double>(processed) / rate});
    }
    // Without the metronome click the audio passes through bit-exactly.
    if (h.params[2] == 0.0F)
      CHECK(std::memcmp(original.data(), audio.data(), audio.size() * sizeof(float)) == 0);
    if (added)
      for (auto ch = 0u; ch < channels; ++ch)
        for (auto i = 0u; i < size; ++i)
          (*added)[ch].push_back(static_cast<double>(audio[ch * size + i]) -
                                 original[ch * size + i]);
    if (takeEvery != 0u && block % takeEvery == 0u)
      h.take(log);
    processed += size;
  }
  return log;
}

// ---- Synthetic test signals: tone, render, reverb, noise, pad -----------------------------
struct Normal {
  effetune::dsp::XorShiftRng rng;
  explicit Normal(std::uint64_t seed) : rng(seed) {}
  double operator()() {
    const double u = 1.0 - rng.nextFloat01(), v = rng.nextFloat01();
    return std::sqrt(-2.0 * std::log(u)) * std::cos(2.0 * pi * v);
  }
};
struct Biquad {
  double b0, b1, b2, a1, a2, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  static Biquad make(bool high, double f, double q, double fs) {
    const double w = 2.0 * pi * f / fs, alpha = std::sin(w) / (2.0 * q), c = std::cos(w);
    const double a0 = 1.0 + alpha;
    const double b = high ? (1.0 + c) / 2.0 : (1.0 - c) / 2.0;
    return {b / a0, (high ? -2.0 : 2.0) * b / a0, b / a0, -2.0 * c / a0, (1.0 - alpha) / a0};
  }
  double operator()(double x) {
    const double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  }
};
enum Kind { Kick, Snare, Hat, Click };
std::vector<double> sound(Kind kind, double fs, Normal &noise) {
  const double length[] = {.6, .5, .2, .03};
  std::vector<double> x(static_cast<std::size_t>(length[kind] * fs));
  if (kind == Kick) {
    double phase = 0.0;
    for (std::size_t i = 0; i < x.size(); ++i) {
      const double t = i / fs;
      phase += 50.0 + 90.0 * std::exp(-t / .03);
      x[i] = std::sin(2.0 * pi * phase / fs) * std::exp(-t / .12);
    }
    for (std::size_t i = 0; i < static_cast<std::size_t>(.003 * fs); ++i)
      x[i] += .3 * noise() * std::exp(-(i / (.0008 * fs)));
  } else if (kind == Snare) {
    // Order-2 Butterworth band-pass approximated by high-pass and low-pass sections.
    auto high = Biquad::make(true, 1500.0, .7071067811865476, fs);
    auto low = Biquad::make(false, std::min(7000.0, .45 * fs), .7071067811865476, fs);
    for (std::size_t i = 0; i < x.size(); ++i) {
      const double t = i / fs;
      x[i] = .8 * low(high(noise())) * std::exp(-t / .09) +
             .5 * std::sin(2.0 * pi * 190.0 * t) * std::exp(-t / .05);
    }
  } else if (kind == Hat) {
    const double f = std::min(7000.0, .4 * fs);
    auto first = Biquad::make(true, f, .5411961001461971, fs);
    auto second = Biquad::make(true, f, 1.3065629648763766, fs);
    for (std::size_t i = 0; i < x.size(); ++i)
      x[i] = .6 * second(first(noise())) * std::exp(-(i / fs) / .03);
  } else {
    for (std::size_t i = 0; i < x.size(); ++i) {
      const double t = i / fs;
      x[i] = std::sin(2.0 * pi * 2000.0 * t) * std::exp(-t / .004) +
             .3 * noise() * std::exp(-t / .002);
    }
  }
  const auto fade = static_cast<std::size_t>(.4 * static_cast<double>(x.size()));
  for (std::size_t i = 0; i < fade; ++i)
    x[x.size() - fade + i] *= .5 * (1.0 + std::cos(pi * i / (fade - 1.0)));
  double peak = 0.0;
  for (const auto v : x)
    peak = std::abs(v) > peak ? std::abs(v) : peak;
  for (auto &v : x)
    v /= peak;
  return x;
}
struct Hit {
  double time;
  Kind kind;
  double velocity;
  int slot;
  bool onBeat;
};
std::vector<double> render(const std::vector<Hit> &hits, double seconds, double fs) {
  Normal noise(11u);
  std::vector<double> x(static_cast<std::size_t>(seconds * fs));
  for (const auto &hit : hits) {
    const auto s = sound(hit.kind, fs, noise);
    const auto begin = static_cast<std::ptrdiff_t>(std::nearbyint(hit.time * fs));
    if (begin < 0 || begin >= static_cast<std::ptrdiff_t>(x.size()))
      continue;
    for (std::size_t i = 0; i < s.size() && begin + i < x.size(); ++i)
      x[begin + i] += hit.velocity * s[i];
  }
  for (auto &v : x)
    v *= std::pow(10.0, -12.0 / 20.0);
  return x;
}
double rms(const std::vector<double> &x) {
  double sum = 0.0;
  for (const auto v : x)
    sum += v * v;
  return std::sqrt(sum / static_cast<double>(x.size()));
}
struct AlignedFree {
  void operator()(float *p) const { pffft_aligned_free(p); }
};
using Aligned = std::unique_ptr<float, AlignedFree>;
Aligned alignedBuffer(std::size_t n) {
  Aligned buffer(static_cast<float *>(pffft_aligned_malloc(n * sizeof(float))));
  std::fill(buffer.get(), buffer.get() + n, 0.0F);
  return buffer;
}
// Exponentially decaying noise impulse response (10 ms pre-delay), mixed at equal RMS.
std::vector<double> reverb(const std::vector<double> &x, double fs, double rt60 = 1.5) {
  Normal noise(1u);
  const auto length = static_cast<std::size_t>(rt60 * fs);
  std::size_t size = 1u;
  while (size < 2u * length)
    size *= 2u;
  const std::size_t segment = size - length;
  auto *setup = pffft_new_setup(static_cast<int>(size), PFFFT_REAL);
  auto ir = alignedBuffer(size), spectrum = alignedBuffer(size), input = alignedBuffer(size),
       product = alignedBuffer(size), work = alignedBuffer(size);
  double energy = 0.0;
  std::vector<double> response(length);
  for (std::size_t i = 0; i < length; ++i) {
    response[i] =
        i < static_cast<std::size_t>(.01 * fs) ? 0.0 : noise() * std::exp(-6.9 * (i / fs) / rt60);
    energy += response[i] * response[i];
  }
  for (std::size_t i = 0; i < length; ++i)
    ir.get()[i] = static_cast<float>(response[i] / std::sqrt(energy));
  pffft_transform(setup, ir.get(), spectrum.get(), work.get(), PFFFT_FORWARD);
  std::vector<double> wet(x.size() + size);
  for (std::size_t begin = 0; begin < x.size(); begin += segment) {
    for (std::size_t i = 0; i < size; ++i)
      input.get()[i] =
          i < segment && begin + i < x.size() ? static_cast<float>(x[begin + i]) : 0.0F;
    pffft_transform(setup, input.get(), input.get(), work.get(), PFFFT_FORWARD);
    std::fill(product.get(), product.get() + size, 0.0F);
    pffft_zconvolve_accumulate(setup, input.get(), spectrum.get(), product.get(),
                               static_cast<float>(1.0 / static_cast<double>(size)));
    pffft_transform(setup, product.get(), product.get(), work.get(), PFFFT_BACKWARD);
    for (std::size_t i = 0; i < size; ++i)
      wet[begin + i] += product.get()[i];
  }
  pffft_destroy_setup(setup);
  wet.resize(x.size());
  const double gain = rms(x) / (rms(wet) + 1e-12);
  auto out = x;
  for (std::size_t i = 0; i < x.size(); ++i)
    out[i] += gain * wet[i];
  return out;
}
std::vector<double> addNoise(const std::vector<double> &x, double fs, double snr) {
  Normal noise(2u);
  const double c = std::exp(-2.0 * pi * 1000.0 / fs);
  double state = 0.0;
  std::vector<double> n(x.size());
  for (auto &v : n) {
    const double white = noise();
    // First-order low-pass at 1 kHz (matched-z stand-in for the bilinear Butterworth).
    state = (1.0 - c) * white + c * state;
    v = .5 * white + 3.0 * state;
  }
  const double gain = rms(x) / rms(n) * std::pow(10.0, -snr / 20.0);
  auto out = x;
  for (std::size_t i = 0; i < x.size(); ++i)
    out[i] += gain * n[i];
  return out;
}
std::vector<double> pad(double seconds, double fs) {
  std::vector<double> x(static_cast<std::size_t>(seconds * fs));
  for (const double f : {220.0, 277.2, 329.6}) {
    double phase = 0.0;
    for (std::size_t i = 0; i < x.size(); ++i) {
      const double t = i / fs;
      phase += 2.0 * pi * f * (1.0 + .003 * std::sin(2.0 * pi * 5.0 * t)) / fs;
      for (int h = 1; h < 12; ++h)
        if (h * f < .45 * fs)
          x[i] += std::sin(h * phase) / h;
    }
  }
  double peak = 0.0;
  for (std::size_t i = 0; i < x.size(); ++i) {
    x[i] *= std::min(1.0, (i / fs) / .5);
    peak = std::abs(x[i]) > peak ? std::abs(x[i]) : peak;
  }
  for (auto &v : x)
    v *= std::pow(10.0, -12.0 / 20.0) / peak;
  return x;
}

// ---- Test scenarios --------------------------------------------------------------------------
struct Step {
  double position;
  Kind kind;
  double velocity;
};
const std::vector<Step> kBasic = {{0, Kick, 1.0}, {0, Hat, .7},   {.5, Hat, .5},  {1, Snare, .9},
                                  {1, Hat, .7},   {1.5, Hat, .5}, {2, Kick, 1.0}, {2, Hat, .7},
                                  {2.5, Hat, .5}, {3, Snare, .9}, {3, Hat, .7},   {3.5, Hat, .5}};
const std::vector<Step> kBasicB = {{0, Kick, 1.0}, {0, Hat, .7},     {.5, Hat, .5},
                                   {1, Snare, .9}, {1, Hat, .7},     {1.5, Kick, .8},
                                   {1.5, Hat, .5}, {2.5, Kick, 1.0}, {2.5, Hat, .5},
                                   {3, Snare, .9}, {3, Hat, .7},     {3.75, Kick, .7}};
const std::vector<Step> kClick = {{0, Click, 1}, {1, Click, 1}, {2, Click, 1}, {3, Click, 1}};
std::vector<Step> fill() {
  std::vector<Step> steps = {{0, Kick, 1.0}};
  for (int i = 1; i < 16; ++i)
    steps.push_back({i / 4.0, Snare, .5 + .1 * (i % 4)});
  return steps;
}
std::vector<double> tempoMap(double seconds, const std::function<double(double)> &bpm,
                             double t0 = .5) {
  std::vector<double> beats;
  for (double t = t0; t < seconds; t += 60.0 / bpm(t))
    beats.push_back(t);
  return beats;
}
struct Groove {
  double jitter = 0.0, swing = 0.0, offset = 0.0;
  int offsetSlot = -1;
  std::uint64_t seed = 0u;
};
void groove(std::vector<Hit> &hits, const std::vector<double> &beats, std::size_t first,
            std::size_t cycles, const std::vector<Step> &pattern, const Groove &g = {}) {
  Normal random(g.seed ? g.seed : 5u);
  for (std::size_t c = first; c < first + cycles; ++c)
    for (std::size_t s = 0; s < pattern.size(); ++s) {
      const auto &step = pattern[s];
      const auto beat = c * 4u + static_cast<std::size_t>(std::floor(step.position));
      if (beat + 1u >= beats.size())
        continue;
      double fraction = step.position - std::floor(step.position);
      if (g.swing > 0.0 && std::abs(fraction - .5) < 1e-9)
        fraction = g.swing / (1.0 + g.swing);
      double t = beats[beat] + fraction * (beats[beat + 1u] - beats[beat]);
      if (static_cast<int>(s) == g.offsetSlot)
        t += g.offset;
      if (g.jitter > 0.0)
        t += g.jitter * random();
      hits.push_back({t, step.kind, step.velocity, static_cast<int>(s),
                      step.position == std::floor(step.position)});
    }
}
std::vector<Hit> groove(const std::vector<double> &beats, const std::vector<Step> &pattern,
                        const Groove &g = {}) {
  std::vector<Hit> hits;
  groove(hits, beats, 0u, beats.size() / 4u, pattern, g);
  return hits;
}

// ---- Analysis ------------------------------------------------------------------------------
struct Summary {
  double lock = -1, bpm = 0, mean = 0, sd = 0, falseRate = 0;
  int unlocks = 0, locked = 0, events = 0;
  std::uint32_t epoch = 0;
};
double bpmAt(const Log &log, double time) {
  for (auto it = log.states.rbegin(); it != log.states.rend(); ++it)
    if (it->time <= time)
      return it->locked ? 60.0 / it->period : 0.0;
  return 0.0;
}
bool lockedAt(const Log &log, double time) {
  for (auto it = log.states.rbegin(); it != log.states.rend(); ++it)
    if (it->time <= time)
      return it->locked;
  return false;
}
// Whether the shown grid changed between two locked states: the period by more than 5 % or the
// next beat off the old grid by more than .05 beat.
bool gridChanged(const State &a, const State &b) {
  const double cycles = (b.next - a.next) / a.period;
  return std::abs(b.period / a.period - 1.0) > .05 ||
         std::abs(cycles - std::nearbyint(cycles)) > .05;
}
// Kind whose onset a band event is attributed to; clicks feed every band.
bool attributes(std::uint32_t band, Kind kind) {
  return kind == Click || (band == 0u && kind == Kick) || (band == 1u && kind == Snare) ||
         (band == 2u && kind == Hat);
}
const Hit *match(const std::vector<Hit> &hits, const Event &event, double tolerance = .025) {
  const Hit *best = nullptr;
  for (const auto &hit : hits)
    if (attributes(event.band, hit.kind) && std::abs(hit.time - event.time) < tolerance &&
        (!best || std::abs(hit.time - event.time) < std::abs(best->time - event.time)))
      best = &hit;
  return best;
}
// Deviation statistics use locked events attributed to on-beat hits only. The tracker unlocks
// within about half a second of silence, so bpm is the last locked tempo and unlocks count only up
// to the last hit. The statistics start 2 s after the lock, or after `from` when that is later.
// With `beat` (seconds), deviations are taken to the nearest groove beat, so a grid shown at a
// sub-multiple of the groove tempo is measured on every groove beat.
double deviation(const Event &event, double beat) {
  return beat > 0.0 ? std::remainder(event.deviation(), beat) : event.deviation();
}
Summary summarize(const Log &log, const std::vector<Hit> &hits = {}, double from = 0.0,
                  double beat = 0.0) {
  Summary s;
  double end = hits.empty() ? 1e300 : 0.0;
  for (const auto &hit : hits)
    end = hit.time > end ? hit.time : end;
  bool was = false;
  for (const auto &state : log.states) {
    if (state.locked && s.lock < 0)
      s.lock = state.time;
    if (was && !state.locked && state.time <= end)
      ++s.unlocks;
    if (state.locked)
      s.bpm = 60.0 / state.period;
    was = state.locked;
    s.epoch = state.epoch;
  }
  double sum = 0, square = 0;
  for (const auto &event : log.events) {
    ++s.events;
    if (event.unlocked || s.lock < 0 || event.time < std::max(s.lock, from) + 2.0)
      continue;
    const auto *hit = match(hits, event);
    if (!hit || !hit->onBeat)
      continue;
    ++s.locked;
    const double d = deviation(event, beat);
    sum += d;
    square += d * d;
  }
  if (s.locked) {
    s.mean = sum / s.locked;
    s.sd = std::sqrt(std::max(0.0, square / s.locked - s.mean * s.mean));
  }
  return s;
}
void print(const char *name, double rate, const Summary &s) {
  std::printf("%-14s %6.0f Hz lock=%6.2f s bpm=%7.2f dev=%+6.2f+-%5.2f ms locked-events=%d "
              "events=%d unlocks=%d epoch=%u\n",
              name, rate, s.lock, s.bpm, s.mean * 1e3, s.sd * 1e3, s.locked, s.events, s.unlocks,
              s.epoch);
}
struct Stats {
  double mean = 0, sd = 0;
  int count = 0;
};
Stats stats(const std::vector<double> &values) {
  Stats s;
  s.count = static_cast<int>(values.size());
  if (values.empty())
    return s;
  for (const auto v : values)
    s.mean += v;
  s.mean /= s.count;
  for (const auto v : values)
    s.sd += (v - s.mean) * (v - s.mean);
  s.sd = std::sqrt(s.sd / s.count);
  return s;
}
double median(std::vector<double> values) {
  if (values.empty())
    return 0.0;
  std::sort(values.begin(), values.end());
  return values[values.size() / 2];
}

// Detected-minus-true onset time per band from a click train. At rate-rule rates the onsets are
// the lanes' detections, which sit up to about 1.1 ms late on this click.
void calibrate(double rate) {
  const auto beats = tempoMap(20.0, [](double) { return 120.0; });
  auto hits = groove(beats, kClick);
  Harness h(static_cast<float>(rate));
  const auto log = run(h, render(hits, 20.0, rate), rate);
  std::array<std::vector<double>, 3> errors;
  for (const auto &event : log.events)
    if (const auto *hit = match(hits, event))
      errors[event.band].push_back(event.time - hit->time);
  std::printf("calibration %6.0f Hz:", rate);
  for (int band = 0; band < 3; ++band)
    std::printf(" band%d n=%zu median=%+.3f ms", band, errors[band].size(),
                median(errors[band]) * 1e3);
  std::printf("\n");
  for (int band = 0; band < 3; ++band) {
    CHECK(errors[band].size() >= 30u);
    CHECK(std::abs(median(errors[band])) < 1.5e-3);
  }
  // Onset (event) times are always behind the analysed position by at least the latency.
  CHECK(!log.states.empty());
  const auto latency = log.states.back().latency;
  CHECK(latency > 0.0F && latency < .03F);
}

Log scenario(const std::vector<double> &signal, double rate, Harness *existing = nullptr) {
  if (existing)
    return run(*existing, signal, rate);
  Harness h(static_cast<float>(rate));
  return run(h, signal, rate);
}

void steady(double bpm, double expected, double maxLock, double rate = 96000,
            std::uint32_t epochs = 1u) {
  const auto beats = tempoMap(30.0, [bpm](double) { return bpm; });
  const auto hits = groove(beats, kBasic);
  const auto log = scenario(render(hits, 30.0, rate), rate);
  // Grid accuracy is measured on the final grid only: from 2 s after the later of the lock and the
  // final grid change (lock + 2 s when the grid never changes after the lock).
  double change = 0.0;
  for (const auto &state : log.states)
    if (state.epoch != log.states.back().epoch)
      change = state.time;
  const auto s = summarize(log, hits, change, 60.0 / bpm);
  char name[32];
  std::snprintf(name, sizeof name, "groove%.0f", bpm);
  print(name, rate, s);
  CHECK(s.lock > 0 && s.lock <= maxLock);
  CHECK(std::abs(s.bpm - expected) < .01 * expected);
  // At 60 BPM the kit leaves digital silence between hats longer than the tracker's silence
  // stand-in, so the display gate drops between them; the grid (epoch) is kept.
  CHECK(s.epoch == epochs && (bpm < 90 || s.unlocks == 0));
  // The grid runs about 3-4 ms ahead of the lane onsets of this kit; the final-grid window must
  // hold enough events for the check to be meaningful.
  CHECK(s.locked >= 5);
  CHECK(std::abs(s.mean) < .005 && s.sd < .004);
  // The comb-best candidate sits on the true tempo or an octave of it.
  const double comb = log.states.back().comb;
  const double octave = std::log2(comb / bpm);
  CHECK(std::abs(octave - std::nearbyint(octave)) < .02);
  // At an A3 rate it is the tempo map's peak, within 3 bins (1/16 octave) of the shown tempo.
  const auto &last = log.states.back();
  if (rate == 96000 && last.locked)
    CHECK(std::abs(48.0 * std::log2(comb * last.period / 60.0)) <= 3.0);
  // Per-slot deviation means: no slot-specific offset after accents.
  std::array<std::vector<double>, 12> slots;
  for (const auto &event : log.events)
    if (!event.unlocked && event.time > std::max(s.lock, change) + 2.0)
      if (const auto *hit = match(hits, event); hit && hit->onBeat)
        slots[static_cast<std::size_t>(hit->slot)].push_back(deviation(event, 60.0 / bpm));
  for (const auto &slot : slots)
    if (slot.size() >= 10u)
      CHECK(std::abs(stats(slot).mean - s.mean) < .003);
}
#if defined(RHYTHM_TEST_HAS_X86_MXCSR)
// binary16 <-> float32 round trip over every finite code and a TCN run, with DAZ|FTZ off or on.
std::uint32_t tcnPass(bool flush, std::vector<std::uint32_t> &act) {
  using effetune::plugins::analyzer::rhythm_a3::tcFloatToHalf;
  using effetune::plugins::analyzer::rhythm_a3::tcHalfToFloat;
  using effetune::plugins::analyzer::rhythm_a3::TcTcn;
  constexpr unsigned int kFlush = (1u << 15u) | (1u << 6u); // FTZ | DAZ
  const unsigned int original = _mm_getcsr();
  _mm_setcsr(flush ? original | kFlush : original & ~kFlush);
  std::uint32_t roundTripBad = 0u;
  for (std::uint32_t c = 0u; c < 65536u; ++c)
    if ((c & 0x7c00u) != 0x7c00u) // inf / NaN codes are not used
      roundTripBad += tcFloatToHalf(tcHalfToFloat(static_cast<std::uint16_t>(c))) != c;
  static TcTcn tcn;
  tcn.reset();
  effetune::dsp::XorShiftRng random(7u);
  float in[TcTcn::kIn], out[TcTcn::kOut];
  for (int tick = 0; tick < 400; ++tick) {
    for (float &x : in)
      x = tcHalfToFloat(tcFloatToHalf(static_cast<float>(random.nextFloatSigned())));
    tcn.push(in, out);
    for (const float p : out)
      act.push_back(std::bit_cast<std::uint32_t>(p));
  }
  _mm_setcsr(original);
  return roundTripBad;
}
void flushInvariance() {
  std::vector<std::uint32_t> plain, flushed;
  const std::uint32_t plainBad = tcnPass(false, plain), flushedBad = tcnPass(true, flushed);
  std::printf("tcn DAZ|FTZ: round trip %u/%u codes differ, %zu act values %s\n", plainBad,
              flushedBad, plain.size(), plain == flushed ? "identical" : "differ");
  CHECK(plainBad == 0u && flushedBad == 0u);
  CHECK(plain == flushed);
}

// Real spectra and delayed chroma: silence is ready before the first active tick seeds statistics.
std::vector<double> priorSilencePass(bool flush) {
  using namespace effetune::plugins::analyzer::rhythm_a3;
  constexpr unsigned int kFlush = (1u << 15u) | (1u << 6u); // FTZ | DAZ
  const unsigned int original = _mm_getcsr();
  _mm_setcsr(flush ? original | kFlush : original & ~kFlush);
  auto detector = std::make_unique<effetune::plugins::analyzer::rhythm_d::Detector>();
  auto chroma = std::make_unique<G2Chroma>();
  auto prior = std::make_unique<TdpPrior>();
  auto v0 = std::make_unique<TcV0>();
  CHECK(detector->prepare(48000.0));
  CHECK(chroma->prepare(48000));
  CHECK(v0->prepare(48000.0));
  prior->prepare(1024u);
  prior->reset();
  prior->setChroma(chroma.get());
  std::array<float, 128> ring{};
  TcTickV0 tick;
  bool pending = false;
  const float act[3] = {0.0F, 0.0F, 1.0F};
  std::vector<double> values;
  std::int64_t firstActive = -1;
  for (std::uint32_t n = 0u; n < 49152u; ++n) {
    const float x =
        n < 21504u ? 0.0F
                   : static_cast<float>(.25 * std::sin(2.0 * pi * 440.0 * (n - 21504u) / 48000.0));
    detector->push(x);
    chroma->sample(x);
    ring[n & 127u] = x;
    if ((n + 1u) % 128u != 0u)
      continue;
    // Complete the previous hop's tick after G2's decimator look-ahead, as the kernel does.
    if (pending) {
      prior->tick(tick, act);
      for (std::uint32_t i = 0u; i < TdpSpectral::kFeatures; ++i) {
        const double value = prior->spectral().features()[i];
        CHECK(std::isfinite(value));
        values.push_back(value);
      }
      for (std::uint32_t i = 0u; i < TdpTemporal::kFeatures; ++i) {
        const double value = prior->temporal().features()[i];
        CHECK(std::isfinite(value));
        values.push_back(value);
      }
      CHECK(prior->tonal().ready() == (tick.k >= 7));
      if (prior->tonal().ready()) {
        for (std::uint32_t i = 0u; i < TdpTonal::kFeatures; ++i) {
          const double value = prior->tonal().features()[i];
          CHECK(std::isfinite(value));
          values.push_back(value);
        }
      }
      if (prior->stats().activeTicks() > 0) {
        if (firstActive < 0) {
          firstActive = tick.k;
          // The tone activates the tick before its first chroma frame is held.
          for (std::uint32_t i = 0u; i < TdpTonal::kClasses; ++i)
            CHECK(std::abs(prior->tonal().features()[i] - 1.0 / 12.0) < 1e-15);
          CHECK(std::abs(prior->tonal().features()[TdpTonal::kEntropy] - 1.0) < 1e-15);
        }
        for (std::uint32_t i = 0u; i < TdpStats::kCols; ++i) {
          const double value = prior->stats().features()[i];
          CHECK(std::isfinite(value));
          values.push_back(value);
        }
      }
    }
    v0->pushHop(ring.data(), 127u, 0u);
    prior->pushFrame(detector->magnitude());
    TcFrame frame;
    TcEvent events[3];
    v0->pushFrame(detector->magnitude(), frame, events, pending, tick);
  }
  CHECK(firstActive == 42 && prior->stats().activeTicks() == 53);
  _mm_setcsr(original);
  return values;
}
void priorSilenceFlushInvariance() {
  const auto plain = priorSilencePass(false), flushed = priorSilencePass(true);
  CHECK(!plain.empty() && plain == flushed);
  std::printf("TD prior silence DAZ|FTZ: %zu ready feature/statistic values %s\n", plain.size(),
              plain == flushed ? "identical" : "differ");
}
#else
void flushInvariance() { std::printf("tcn DAZ|FTZ: skipped (no MXCSR)\n"); }
void priorSilenceFlushInvariance() {
  std::printf("TD prior silence DAZ|FTZ: skipped (no MXCSR)\n");
}
#endif
} // namespace

int main() {
  flushInvariance();
  priorSilenceFlushInvariance();
  // Bias calibration at every calibrated rate class.
  for (const double rate : {44100.0, 48000.0, 96000.0})
    calibrate(rate);

  // Click track and steady grooves (metrical levels chosen by the tracker).
  for (const double rate : {44100.0, 48000.0, 96000.0}) {
    const auto beats = tempoMap(30.0, [](double) { return 120.0; });
    const auto hits = groove(beats, kClick);
    const auto log = scenario(render(hits, 30.0, rate), rate);
    const auto s = summarize(log, hits);
    print("click120", rate, s);
    // The bare click train is silent between clicks for longer than the silence stand-in: the
    // display gate drops between clicks while the grid (epoch) is kept.
    CHECK(s.lock > 0 && s.lock < 3.6 && std::abs(s.bpm - 120) < .6 && s.epoch == 1u);
    CHECK(std::abs(s.mean) < .003);
  }
  steady(120, 120, 3.2);
  // ch64 network + TD prior: groove60 shows the double tempo; the master's reseed to 60 BPM
  // (about 21 s in) does not move the shown grid, whose prior favours 120 BPM.
  steady(60, 120, 8.0);
  steady(90, 90, 4.0);
  // ch64 network + TD prior: the master flips between 90 and 180 BPM (the known weakness at
  // 140 BPM and above) while the shown grid holds the half tempo, whose prior is the stronger; its
  // one change is a phase switch between the two 90 BPM grids.
  steady(180, 90, 3.5, 96000, 2u);
  steady(120, 120, 3.2, 48000);
  steady(120, 120, 3.2, 44100);
  steady(120, 120, 3.2, 192000);
  // A rate without a rate rule: the production tracker drives the clock.
  steady(120, 120, 3.5, 64000);

  const double rate = 96000;
  const auto beats120 = tempoMap(30.0, [](double) { return 120.0; });
  // Swing 2:1: off-beat hats sit at 2/3 of the beat.
  {
    Groove g;
    g.swing = 2.0;
    const auto hits = groove(beats120, kBasic, g);
    const auto log = scenario(render(hits, 30.0, rate), rate);
    const auto s = summarize(log, hits);
    print("swing2:1", rate, s);
    std::vector<double> offbeat;
    for (const auto &event : log.events)
      if (!event.unlocked && event.time > s.lock + 2.0 && event.band == 2u)
        if (const auto *hit = match(hits, event); hit && hit->slot % 3 == 2)
          offbeat.push_back(event.fraction);
    const auto o = stats(offbeat);
    std::printf("  swing off-beat fraction %.4f (n=%d)\n", o.mean, o.count);
    CHECK(s.lock > 0 && std::abs(s.bpm - 120) < 1 && o.count > 20 &&
          std::abs(o.mean - 2.0 / 3.0) < .02);
  }
  // Laid-back snare on beat 2 (+18 ms) against the on-time beat-4 snare.
  {
    Groove g;
    g.offset = .018;
    g.offsetSlot = 3;
    const auto hits = groove(beats120, kBasic, g);
    const auto log = scenario(render(hits, 30.0, rate), rate);
    const auto s = summarize(log, hits);
    std::vector<double> late, onTime;
    for (const auto &event : log.events)
      if (!event.unlocked && event.time > s.lock + 2.0 && event.band == 1u)
        if (const auto *hit = match(hits, event, .009))
          (hit->slot == 3 ? late : onTime).push_back(event.deviation());
    const auto a = stats(late), b = stats(onTime);
    print("laid+18ms", rate, s);
    std::printf("  beat-2 snare %+.2f ms (n=%d), beat-4 snare %+.2f ms (n=%d)\n", a.mean * 1e3,
                a.count, b.mean * 1e3, b.count);
    CHECK(a.count > 10 && b.count > 10 && std::abs((a.mean - b.mean) - .018) < .004);
  }
  // Jitter: per-event deviation spread follows the injected timing noise.
  for (const double jitter : {.005, .01, .02}) {
    Groove g;
    g.jitter = jitter;
    const auto hits = groove(beats120, kBasic, g);
    const auto log = scenario(render(hits, 30.0, rate), rate);
    const auto s = summarize(log, hits);
    char name[32];
    std::snprintf(name, sizeof name, "jitter%.0f", jitter * 1e3);
    print(name, rate, s);
    CHECK(s.lock > 0 && std::abs(s.bpm - 120) < 1.5 && s.unlocks == 0);
    CHECK(s.sd > .6 * jitter && s.sd < 1.3 * jitter + .005 &&
          std::abs(s.mean) < .3 * jitter + .008);
  }
  // Tempo ramp 100 -> 140 BPM between 5 s and 25 s.
  {
    const auto beats = tempoMap(30.0, [](double t) {
      return 100.0 + 40.0 * std::min(1.0, std::max(0.0, (t - 5.0) / 20.0));
    });
    const auto hits = groove(beats, kBasic);
    const auto log = scenario(render(hits, 30.0, rate), rate);
    const auto s = summarize(log, hits);
    print("accel100-140", rate, s);
    std::printf("  bpm at 5/15/25 s: %.2f %.2f %.2f\n", bpmAt(log, 5), bpmAt(log, 15),
                bpmAt(log, 25));
    CHECK(std::abs(bpmAt(log, 5) - 100) < 1.5 && std::abs(s.bpm - 140) < 1.5);
    CHECK(bpmAt(log, 15) > 112 && bpmAt(log, 15) < 124 && s.unlocks == 0);
    // Accelerating beats arrive early against the prediction: a negative mean deviation.
    CHECK(s.mean < -.002 && s.mean > -.03);
  }
  // Slow tempo ramp 90 -> 130 BPM between 5 s and 35 s. The lock is never lost, and every beat
  // predicted after the lock lies within the beat-continuity tolerance (17.5 % of the local beat
  // interval) of the synthetic beat grid at the tracked level (x1, x2 or /2).
  {
    const auto beats = tempoMap(40.0, [](double t) {
      return 90.0 + 40.0 * std::min(1.0, std::max(0.0, (t - 5.0) / 30.0));
    });
    const auto hits = groove(beats, kBasic);
    const auto log = scenario(render(hits, 40.0, rate), rate);
    const auto s = summarize(log, hits);
    double worst = 0.0;
    int predicted = 0;
    for (std::size_t i = 0u; i < log.states.size(); ++i) {
      const auto &state = log.states[i];
      // The last prediction for each (epoch, index) before its time is the predicted beat.
      const bool last = i + 1u == log.states.size() || log.states[i + 1u].epoch != state.epoch ||
                        log.states[i + 1u].nextIndex != state.nextIndex;
      if (!state.locked || !last || state.next >= beats.back())
        continue;
      std::size_t k = 1u;
      while (beats[k] < state.next)
        ++k;
      const double interval = beats[k] - beats[k - 1u];
      const double from = state.next - beats[k - 1u], to = beats[k] - state.next;
      const double nearest = from < to ? from : to;
      // Tracked level from the predicted period; /2 keeps either beat parity as its grid.
      const double level = std::exp2(std::nearbyint(std::log2(state.period / interval)));
      const double half = .5 * interval, mid = std::abs(from - half);
      const double error = level < .75 ? (nearest < mid ? nearest : mid) / half
                                       : nearest / (level > 1.5 ? 2.0 * interval : interval);
      worst = error > worst ? error : worst;
      ++predicted;
    }
    print("accel90-130", rate, s);
    std::printf("  %d predicted beats, worst grid distance %.1f %% of the beat interval\n",
                predicted, worst * 1e2);
    CHECK(s.lock > 0 && s.lock < 4.5 && s.unlocks == 0 && std::abs(s.bpm - 130) < 1.5);
    CHECK(predicted > 40 && worst <= .175);
  }
  // Tempo steps at 15 s: +12.5 % and -25 % both move the grid to the new tempo with a new epoch.
  // Neither unlocks.
  for (const double target : {135.0, 90.0}) {
    const auto beats = tempoMap(30.0, [target](double t) { return t < 15.0 ? 120.0 : target; });
    const auto hits = groove(beats, kBasic);
    const auto log = scenario(render(hits, 30.0, rate), rate);
    const auto s = summarize(log, hits);
    double relock = -1;
    for (const auto &state : log.states)
      if (state.time > 15.0 && state.locked &&
          std::abs(60.0 / state.period - target) < .02 * target) {
        relock = state.time - 15.0;
        break;
      }
    char name[32];
    std::snprintf(name, sizeof name, "step120-%.0f", target);
    print(name, rate, s);
    std::printf("  relock %.2f s after the step\n", relock);
    CHECK(relock > 0 && relock < 12.0);
    CHECK(std::abs(s.bpm - target) < 1 && s.unlocks == 0 && s.epoch == 2u);
  }
  // Fill and pattern switch at the same tempo: no unlock.
  {
    const auto beats = tempoMap(40.0, [](double) { return 120.0; });
    std::vector<Hit> hits;
    const auto fillSteps = fill();
    for (std::size_t c = 0; c < beats.size() / 4u; ++c)
      groove(hits, beats, c, 1u, c < 8u ? kBasic : (c == 8u ? fillSteps : kBasicB));
    const auto log = scenario(render(hits, 40.0, rate), rate);
    const auto s = summarize(log, hits);
    print("fill+switch", rate, s);
    CHECK(s.lock > 0 && s.unlocks == 0 && std::abs(s.bpm - 120) < 1);
  }
  // Re-phase: the groove jumps by half a beat at 15 s at the same tempo.
  {
    auto beats = tempoMap(15.0, [](double) { return 120.0; });
    std::vector<Hit> hits;
    groove(hits, beats, 0u, beats.size() / 4u, kBasic);
    const auto later = tempoMap(30.0, [](double) { return 120.0; }, 15.25);
    groove(hits, later, 0u, later.size() / 4u, kBasic);
    const auto log = scenario(render(hits, 30.0, rate), rate);
    const auto s = summarize(log, hits);
    std::uint32_t before = 0;
    double rephase = -1;
    for (const auto &state : log.states) {
      if (state.time < 15.0)
        before = state.epoch;
      else if (rephase < 0 && state.epoch > before)
        rephase = state.time - 15.0;
    }
    print("rephase", rate, s);
    std::printf("  new epoch %.2f s after the shift\n", rephase);
    // The one-second gap before the shifted groove unlocks the display once.
    CHECK(before == 1u && rephase > 1.0 && rephase < 7.0 && s.unlocks <= 1 && s.epoch == 2u);
    // After the new epoch the grid follows the shifted beats.
    std::vector<double> deviations;
    for (const auto &event : log.events)
      if (!event.unlocked && event.time > 15.0 + rephase + 2.0)
        if (const auto *hit = match(hits, event); hit && hit->onBeat)
          deviations.push_back(event.deviation());
    CHECK(std::abs(stats(deviations).mean) < .004);
  }
  // Reverberant, noisy and flammed grooves keep the lock.
  {
    const auto hits = groove(beats120, kBasic);
    const auto dry = render(hits, 30.0, rate);
    for (int variant = 0; variant < 2; ++variant) {
      const auto log = scenario(variant == 0 ? reverb(dry, rate) : addNoise(dry, rate, 20.0), rate);
      const auto s = summarize(log, hits);
      print(variant == 0 ? "reverb" : "noise20", rate, s);
      CHECK(s.lock > 0 && s.lock < 4.0 && s.unlocks == 0 && std::abs(s.bpm - 120) < 1);
    }
    auto flams = hits;
    for (const auto &hit : hits)
      if (hit.kind == Snare)
        flams.push_back({hit.time - .02, Snare, .4, hit.slot, false});
    const auto log = scenario(render(flams, 30.0, rate), rate);
    const auto s = summarize(log, flams);
    print("flams", rate, s);
    CHECK(s.lock > 0 && s.unlocks == 0 && std::abs(s.bpm - 120) < 1);
  }
  // No-rhythm inputs never lock; the noise false-onset rate is bounded.
  {
    const auto silence = scenario(std::vector<double>(static_cast<std::size_t>(30.0 * rate)), rate);
    CHECK(silence.events.empty() && summarize(silence).lock < 0);
    const auto noise = scenario(
        addNoise(std::vector<double>(static_cast<std::size_t>(30.0 * rate), 1e-3), rate, 0.0),
        rate);
    const auto n = summarize(noise);
    const double falseRate = n.events / 30.0;
    std::printf("noise-only false onsets %.2f/s lock=%.2f\n", falseRate, n.lock);
    CHECK(n.lock < 0 && falseRate < 1.5);
    for (const auto &event : noise.events)
      CHECK(event.unlocked);
    const auto sustain = scenario(pad(30.0, rate), rate);
    std::printf("sustain events=%zu lock=%.2f\n", sustain.events.size(), summarize(sustain).lock);
    CHECK(summarize(sustain).lock < 0);
  }
  // Vibrato pad after a groove: the pad is music, so the grid of the groove carries on through it
  // (no new epoch) and stays shown.
  {
    const auto beats = tempoMap(15.0, [](double) { return 120.0; });
    const auto hits = groove(beats, kBasic);
    auto signal = render(hits, 40.0, rate);
    const auto sustain = pad(25.0, rate);
    const auto begin = static_cast<std::size_t>(14.9 * rate);
    for (std::size_t i = 0; i < sustain.size() && begin + i < signal.size(); ++i)
      signal[begin + i] += .6 * sustain[i];
    const auto log = scenario(signal, rate);
    const auto s = summarize(log, hits);
    double lastHit = 0.0, unlock = -1.0, peak = 0.0;
    for (const auto &hit : hits)
      lastHit = hit.time > lastHit ? hit.time : lastHit;
    for (const auto &state : log.states) {
      if (unlock < 0 && state.time > lastHit && !state.locked)
        unlock = state.time;
      if (unlock >= 0 && state.confidence > peak)
        peak = state.confidence;
    }
    int padEvents = 0;
    for (const auto &event : log.events)
      padEvents += event.time > lastHit + 1.0 ? 1 : 0;
    print("groove+pad", rate, s);
    std::printf(
        "  unlock %.2f s after the last hit, pad events %d, peak confidence after unlock %.3f\n",
        unlock - lastHit, padEvents, peak);
    CHECK(s.lock > 0 && s.epoch == 1u && lockedAt(log, 40.0) && std::abs(s.bpm - 120) < 1.5);
  }
  // 6/8 at 80 BPM (dotted quarter): the tracker first shows the 3:2 level (120 BPM) and moves to
  // the dotted quarter once its evidence builds up, without unlocking; no other level is shown.
  // The settle bound is the ch64 network's 13.5 s plus about 15 % (R5-S-111).
  {
    const auto beats = tempoMap(30.0, [](double) { return 80.0; });
    std::vector<Step> six8;
    for (int bar = 0; bar < 2; ++bar) {
      six8.push_back({2.0 * bar, Kick, 1.0});
      six8.push_back({2.0 * bar + 1.0, Snare, .9});
      for (int k = 0; k < 6; ++k)
        six8.push_back({2.0 * bar + k / 3.0, Hat, k % 3 == 0 ? .6 : .35});
    }
    const auto hits = groove(beats, six8);
    const auto log = scenario(render(hits, 30.0, rate), rate);
    const auto s = summarize(log, hits);
    print("six8-80", rate, s);
    std::printf("  comb-best %.2f BPM\n", log.states.back().comb);
    int eighth = 0, other = 0;
    double settled = 0.0;
    for (const auto &state : log.states) {
      eighth += std::abs(state.comb - 120.0F) < 2.0F ? 1 : 0;
      if (!state.locked || std::abs(60.0 / state.period - 80.0) < 1.0)
        continue;
      if (std::abs(60.0 / state.period - 120.0) < 1.0)
        settled = state.time;
      else
        ++other;
    }
    std::printf("  comb at the 3:2 level in %d telemetry frames, 80 BPM shown from %.2f s\n",
                eighth, settled);
    CHECK(eighth > 0);
    CHECK(s.lock > 0 && s.lock < 4.0 && s.unlocks == 0 && other == 0 && settled < 15.5 &&
          std::abs(s.bpm - 80) < 1);
  }
  // Stop and restart: unlock within half a second of silence, unlocked-flag events, relock.
  {
    std::vector<Hit> hits;
    const auto first = tempoMap(12.0, [](double) { return 120.0; });
    groove(hits, first, 0u, first.size() / 4u, kBasic);
    const auto second = tempoMap(32.0, [](double) { return 120.0; }, 20.0);
    groove(hits, second, 0u, second.size() / 4u, kBasic);
    const auto log = scenario(render(hits, 32.0, rate), rate);
    double lastHit = 0.0;
    for (const auto &hit : hits)
      lastHit = hit.time < 12.0 && hit.time > lastHit ? hit.time : lastHit;
    double unlock = -1;
    for (const auto &state : log.states)
      if (state.time > lastHit && !state.locked) {
        unlock = state.time - lastHit;
        break;
      }
    int flagged = 0;
    for (const auto &event : log.events)
      flagged += event.unlocked && event.time > 20.0 ? 1 : 0;
    const auto s = summarize(log, hits);
    print("stop+restart", rate, s);
    std::printf("  unlock %.2f s after the last hit, %d unlocked-flag events after restart\n",
                unlock, flagged);
    CHECK(unlock > 0.0 && unlock < .5 && flagged > 0);
    CHECK(s.unlocks == 1 && lockedAt(log, 31.0));
    // The tempogram goes dark within a few seconds of silence.
    for (const auto &state : log.states)
      if (state.time > lastHit + 4.0 && state.time < 20.0)
        CHECK(state.tempogramPeak == 0.0F);
  }
  // Cold restart: 94 ticks below -120 dB restart the analysis at the next tick r that is a multiple
  // of 8; from r the tracker follows a fresh one started on the input from r's first sample.
  {
    // A is cut off mid-groove and B starts on its first sample, so the silence is exactly the
    // 1.5 s gap and the fresh run, which starts less than 94 ticks before B, never restarts.
    const auto partA =
        render(groove(tempoMap(17.0, [](double) { return 120.0; }), kBasic), 15.0, rate);
    const auto hitsB = groove(tempoMap(15.0, [](double) { return 93.0; }, 0.0), kBasic);
    const auto partB = render(hitsB, 15.0, rate);
    auto signal = partA;
    signal.resize(signal.size() + static_cast<std::size_t>(1.5 * rate), 0.0);
    const std::size_t startB = signal.size();
    signal.insert(signal.end(), partB.begin(), partB.end());
    // The restart rule on the analysis stream, which at a native rate is the mono input.
    constexpr std::size_t kTick = 1024u;
    std::size_t r = 0u;
    for (std::size_t k = 0u, quiet = 0u; (k + 1u) * kTick <= signal.size() && r == 0u; ++k) {
      double sum = 0.0;
      for (std::size_t i = k * kTick; i < (k + 1u) * kTick; ++i) {
        const double s = static_cast<float>(signal[i]);
        sum += s * s;
      }
      quiet = 10.0 * std::log10(sum / kTick + 1e-20) < -120.0 ? quiet + 1u : 0u;
      if (quiet == 94u)
        r = (k + 8u) / 8u * 8u;
    }
    CHECK(r > 0u && r * kTick < startB);
    const double t0 = static_cast<double>(r * kTick) / rate;
    const auto stream = scenario(signal, rate);
    const auto fresh =
        scenario(std::vector<double>(signal.begin() + r * kTick, signal.end()), rate);
    const auto lockAfter = [](const Log &log, double from) {
      for (const auto &state : log.states)
        if (state.time >= from && state.locked)
          return state.time;
      return -1.0;
    };
    std::uint32_t before = 0u;
    for (const auto &state : stream.states)
      before = state.time < t0 ? state.epoch : before;
    const double lockS = lockAfter(stream, t0) - t0, lockF = lockAfter(fresh, 0.0);
    const auto s = summarize(stream), f = summarize(fresh);
    std::printf("cold restart   r=%zu (%.3f s) lock=%5.2f s (fresh %5.2f s) bpm=%7.2f (fresh "
                "%7.2f) epoch +%u (fresh %u)\n",
                r, t0, lockS, lockF, s.bpm, f.bpm, s.epoch - before, f.epoch);
    CHECK(lockF > 0.0 && std::abs(lockS - lockF) < 1e-9);
    CHECK(std::abs(s.bpm - f.bpm) < .5 && std::abs(f.bpm - 93.0) < 1.0);
    CHECK(s.epoch - before == f.epoch);
    // After r the onset events match the fresh run to rounding; beat indices continue across the
    // restart. The shown grid differs only slightly: the decoder keeps its silence run (quiet_/z_)
    // across the restart by design, so the stream enters B with a longer quiet run.
    std::vector<Event> after;
    for (const auto &event : stream.events)
      if (event.time >= t0)
        after.push_back(event);
    CHECK(after.size() == fresh.events.size());
    double eventDt = 0.0, nextDt = 0.0;
    std::int32_t shift = 0;
    bool same = true;
    for (std::size_t i = 0; i < std::min(after.size(), fresh.events.size()); ++i) {
      const auto &a = after[i], &b = fresh.events[i];
      eventDt = std::max(eventDt, std::abs(a.time - t0 - b.time));
      if (!a.unlocked && !b.unlocked && shift == 0)
        shift = a.index - b.index;
      same = same && a.band == b.band && a.unlocked == b.unlocked &&
             (a.unlocked || (a.index - b.index == shift && a.epoch - before == b.epoch));
    }
    std::size_t first = 0u;
    while (first < stream.states.size() && stream.states[first].time < t0 + 1e-9)
      ++first;
    CHECK(stream.states.size() - first == fresh.states.size());
    for (std::size_t i = 0; first + i < stream.states.size() && i < fresh.states.size(); ++i) {
      const auto &a = stream.states[first + i], &b = fresh.states[i];
      same = same && a.locked == b.locked && std::abs(a.time - t0 - b.time) < 1e-9;
      if (a.locked && b.locked)
        nextDt = std::max(nextDt, std::abs(a.next - t0 - b.next));
    }
    std::printf("  after r: %zu events, max |dt| %.2g s, index shift %d; %zu states, max |dnext| "
                "%.2g s\n",
                after.size(), eventDt, shift, fresh.states.size(), nextDt);
    CHECK(same && eventDt < 1e-12 && nextDt < 1e-3);
  }
  // Block-size and channel-count independence; context time relation.
  {
    const auto hits = groove(beats120, kBasic);
    const auto signal = render(hits, 12.0, rate);
    Harness a(static_cast<float>(rate)), b(static_cast<float>(rate));
    const auto x = run(a, signal, rate);
    const auto y = run(b, signal, rate, {97u, 113u, 89u}, 4u, 1u, 100.0);
    CHECK(x.events.size() == y.events.size() && !x.events.empty());
    for (std::size_t i = 0; i < std::min(x.events.size(), y.events.size()); ++i)
      CHECK(x.events[i].time == y.events[i].time && x.events[i].index == y.events[i].index &&
            x.events[i].fraction == y.events[i].fraction);
    CHECK(x.states.back().period == y.states.back().period);
    for (const auto &state : y.states)
      CHECK(std::abs(state.context - (100.0 + state.time)) < 2e-5);
    Harness mono(static_cast<float>(rate));
    const auto m = run(mono, signal, rate, {128u}, 1u);
    CHECK(m.events.size() == x.events.size());
  }
  // Reset and parameter changes clear state and bump the generation.
  {
    const auto hits = groove(beats120, kBasic);
    const auto signal = render(hits, 8.0, rate);
    Harness h(static_cast<float>(rate));
    const auto first = run(h, signal, rate);
    const auto generation = first.states.back().generation;
    CHECK(first.states.back().locked && first.states.back().epoch == 1u);
    h.kernel->reset();
    Log empty;
    h.take(empty);
    CHECK(empty.states.empty());
    const auto again = run(h, std::vector<double>(signal.begin(), signal.begin() + 96000), rate);
    CHECK(again.states.front().generation > generation && again.states.front().frames <= 2u);
    CHECK(!again.states.back().locked && again.states.back().epoch == 0u);
    // A range narrower than 1.25x (here empty) widens its maximum: candidates span 100..125 BPM.
    h.setRange(100.0F, 100.0F);
    const auto widened = run(h, signal, rate);
    CHECK(widened.states.front().generation > again.states.back().generation);
    CHECK(widened.states.back().comb >= 99.9F && widened.states.back().comb <= 125.1F);
    CHECK(widened.states.back().locked && std::abs(60.0 / widened.states.back().period - 120) < 1);
    // An unchanged effective range keeps the analysis running.
    h.setRange(100.0F, 125.0F);
    const auto kept = run(h, signal, rate);
    CHECK(kept.states.front().generation == widened.states.back().generation);
    // groove60 constrained to 40..100 BPM locks at 60 instead of 120.
    const auto slow = tempoMap(30.0, [](double) { return 60.0; });
    Harness ranged(static_cast<float>(rate), 40.0F, 100.0F);
    const auto slowHits = groove(slow, kBasic);
    const auto r = summarize(run(ranged, render(slowHits, 30.0, rate), rate), slowHits);
    print("groove60 40-100", rate, r);
    CHECK(std::abs(r.bpm - 60) < 1);
    // Every epoch step of a run is one change of the shown grid.
    const auto oneChangePerEpoch = [](const Log &log) {
      for (std::size_t i = 1u; i < log.states.size(); ++i) {
        const auto &a = log.states[i - 1u], &b = log.states[i];
        if (b.epoch != a.epoch)
          CHECK(b.epoch == a.epoch + 1u && (!a.locked || !b.locked || gridChanged(a, b)));
      }
    };
    // Range masks: groove120 constrained to 45..75 BPM carries no tempo outside the range and
    // shows 60 BPM, also when started one decoder tick (1024 samples) later, which moves its
    // reseeds to the other tick parity.
    const auto hits120 = groove(beats120, kBasic);
    const auto signal120 = render(hits120, 30.0, rate);
    for (const std::size_t shift : {std::size_t{0}, std::size_t{1024}}) {
      Harness masked(static_cast<float>(rate), 45.0F, 75.0F);
      std::vector<double> input(shift, 0.0);
      input.insert(input.end(), signal120.begin(), signal120.end());
      const auto m = run(masked, input, rate);
      const auto ms = summarize(m, hits120);
      print(shift ? "groove120 45-75 +1 tick" : "groove120 45-75", rate, ms);
      CHECK(ms.lock > 0 && std::abs(ms.bpm - 60) < 1);
      for (const auto &state : m.states)
        if (state.locked)
          CHECK(60.0 / state.period >= 45.0 && 60.0 / state.period <= 75.0);
      oneChangePerEpoch(m);
    }
    // The B pattern of groove120 at 48 kHz in 40..100 BPM reseeds at 10.04 s to a 40 BPM clock
    // whose 120 BPM level is out of range; the shown grid is diverted to the in-range level with
    // the most prior-weighted mass, 60 BPM.
    const auto hits120B = groove(beats120, kBasicB);
    Harness maskedB(48000.0F, 40.0F, 100.0F);
    const auto mB = run(maskedB, render(hits120B, 30.0, 48000.0), 48000.0);
    const auto msB = summarize(mB, hits120B);
    print("groove120B 40-100", 48000.0, msB);
    CHECK(msB.lock > 0 && std::abs(msB.bpm - 60) < 1);
    // The range holds at lattice-bin resolution (R5-S-114); the strict bound is safe here because
    // the case settles at 60 BPM, away from the end bins.
    for (const auto &state : mB.states)
      if (state.locked)
        CHECK(60.0 / state.period >= 40.0 && 60.0 / state.period <= 100.0);
    oneChangePerEpoch(mB);
    // Re-prepare at another rate starts a new generation.
    h.kernel->prepare({48000.0F, 4u, 1024u});
    const auto prepared = run(h, render(hits, 8.0, 48000.0), 48000.0);
    CHECK(prepared.states.back().locked &&
          std::abs(60.0 / prepared.states.back().period - 120) < 1);
  }
  // Event ring: overflow drops the newest, a full write carries 16 events, a rejected write keeps
  // the ring, and 15 Hz writes of a dense hat pattern drop nothing.
  {
    const auto beats = tempoMap(20.0, [](double) { return 180.0; });
    std::vector<Step> dense;
    for (int i = 0; i < 16; ++i)
      dense.push_back({i / 4.0, Hat, .6 + .1 * (i % 4 == 0)});
    const auto signal = render(groove(beats, dense), 20.0, rate);
    Harness h(static_cast<float>(rate));
    run(h, std::vector<double>(signal.begin(), signal.begin() + 10 * 96000), rate, {128u}, 2u, 0u);
    std::vector<std::uint8_t> small_bytes(1024);
    effetune::TelemetryRing small;
    small.adopt(small_bytes.data(), 1024u);
    std::uint32_t sequence = 0;
    effetune::TelemetryWriter rejected(small, 207u, sequence);
    h.kernel->writeTelemetry(rejected);
    Log log;
    h.take(log);
    CHECK(log.states.size() == 1u && log.states[0].count == 16u && log.states[0].dropped > 0u);
    // The full ring drains 16 events per write; nothing is written once it is empty.
    for (int i = 0; i < 8; ++i)
      h.take(log);
    CHECK(log.states.size() == 4u && log.events.size() == 64u);
    for (std::size_t i = 1u; i < log.states.size(); ++i)
      CHECK(log.states[i].count == 16u && log.states[i].dropped == 0u);
    Harness paced(static_cast<float>(rate));
    const auto every = static_cast<std::uint32_t>(rate / 15.0 / 128.0);
    const auto p = run(paced, signal, rate, {128u}, 2u, every);
    std::uint32_t dropped = 0, most = 0;
    for (const auto &state : p.states) {
      dropped += state.dropped;
      most = state.count > most ? state.count : most;
    }
    std::printf("dense hats at 15 Hz writes: %zu events, max %u per frame, dropped %u\n",
                p.events.size(), most, dropped);
    CHECK(dropped == 0u && most < 16u);
  }
  // Metronome click (every other scenario runs with it off and checks bit-exact pass-through).
  {
    const auto onsets = [rate](const std::vector<double> &added) {
      std::vector<double> times;
      double last = -1.0;
      for (std::size_t i = 0u; i < added.size(); ++i)
        if (added[i] != 0.0) {
          // The attack starts one sample before the first non-zero output.
          if (last < 0.0 || i - last > .07 * rate)
            times.push_back((i - 1.0) / rate);
          last = static_cast<double>(i);
        }
      return times;
    };
    const auto first = [](const Log &log, bool locked, double after = 0.0) {
      for (const auto &state : log.states)
        if (state.time > after && state.locked == locked)
          return state.time;
      return -1.0;
    };
    // Groove until 20 s, then silence: clicks follow the lock, sit on the hits, continue through
    // the unlock hold and stop at the unlock.
    const auto beats = tempoMap(20.0, [](double) { return 120.0; });
    const auto hits = groove(beats, kBasic);
    const auto signal = render(hits, 32.0, rate);
    Harness h(static_cast<float>(rate));
    h.setClick(true);
    std::vector<std::vector<double>> added;
    const auto log = run(h, signal, rate, {128u}, 2u, 1u, 0.0, &added);
    const auto clicks = onsets(added[0]);
    const double lock = first(log, true), unlock = first(log, false, lock);
    double lastHit = 0.0, worst = 0.0, gap = 1.0;
    for (const auto &hit : hits)
      lastHit = hit.time > lastHit ? hit.time : lastHit;
    for (std::size_t i = 0u; i < clicks.size(); ++i) {
      if (i > 0u)
        gap = clicks[i] - clicks[i - 1u] < gap ? clicks[i] - clicks[i - 1u] : gap;
      if (clicks[i] > lastHit)
        continue;
      double nearest = 1.0;
      for (const auto &hit : hits)
        nearest =
            std::abs(clicks[i] - hit.time) < nearest ? std::abs(clicks[i] - hit.time) : nearest;
      worst = nearest > worst ? nearest : worst;
    }
    CHECK(added[0] == added[1]);
    std::printf("click: lock %.2f s, first click %.3f s, unlock %.2f s, last click %.3f s, %zu "
                "clicks, worst hit distance %.2f ms, smallest gap %.3f s\n",
                lock, clicks.empty() ? -1.0 : clicks.front(), unlock,
                clicks.empty() ? -1.0 : clicks.back(), clicks.size(), worst * 1e3, gap);
    CHECK(lock > 0.0 && unlock > lastHit && clicks.size() > 30u);
    CHECK(clicks.front() >= lock && clicks.back() < unlock && worst <= .01 && gap >= .25);
    // A phase correction must not drop one click from an otherwise steady locked groove.
    for (std::size_t i = 1u; i < clicks.size(); ++i)
      if (clicks[i - 1u] >= 4.0 && clicks[i] <= 18.0)
        CHECK(clicks[i] - clicks[i - 1u] < .75);
    // The click never feeds the analysis: telemetry matches a run without it.
    Harness plain(static_cast<float>(rate));
    const auto reference = run(plain, signal, rate);
    CHECK(reference.states.size() == log.states.size() &&
          reference.events.size() == log.events.size());
    for (std::size_t i = 0u; i < std::min(reference.states.size(), log.states.size()); ++i)
      CHECK(reference.states[i].locked == log.states[i].locked &&
            reference.states[i].epoch == log.states[i].epoch &&
            reference.states[i].next == log.states[i].next);
    // Switching the click on while locked keeps the lock, epoch and generation; clicking starts on
    // the next beat.
    Harness toggled(static_cast<float>(rate));
    const std::size_t split = static_cast<std::size_t>(10.0 * rate);
    const auto before =
        run(toggled, std::vector<double>(signal.begin(), signal.begin() + split), rate);
    toggled.setClick(true);
    std::vector<std::vector<double>> after;
    const auto later = run(toggled, std::vector<double>(signal.begin() + split, signal.end()), rate,
                           {128u}, 2u, 1u, 10.0, &after);
    const auto late = onsets(after[0]);
    CHECK(before.states.back().locked && !late.empty() && late.front() <= .5 + .02);
    for (const auto &state : later.states)
      if (state.time + 10.0 < 18.0)
        CHECK(state.locked && state.epoch == before.states.back().epoch &&
              state.generation == before.states.back().generation);
    // Mono: the click is on channel 1. Four channels: channels 3-4 stay bit-exact.
    Harness mono(static_cast<float>(rate)), quad(static_cast<float>(rate));
    mono.setClick(true);
    quad.setClick(true);
    std::vector<std::vector<double>> one, four;
    const auto short_signal = std::vector<double>(signal.begin(), signal.begin() + split);
    run(mono, short_signal, rate, {128u}, 1u, 1u, 0.0, &one);
    run(quad, short_signal, rate, {97u, 113u}, 4u, 1u, 0.0, &four);
    CHECK(!onsets(one[0]).empty() && four[0] == four[1] && !onsets(four[0]).empty());
    for (const auto ch : {2u, 3u})
      for (const auto value : four[ch])
        CHECK(value == 0.0);
    std::printf(
        "click: toggled on at 10 s, first click %.3f s later; mono %zu, 4-channel %zu clicks\n",
        late.empty() ? -1.0 : late.front(), onsets(one[0]).size(), onsets(four[0]).size());
    // Range transitions: a groove at 90 -> 115 -> 90 BPM shown in 40..100 BPM moves to the half
    // level and back. Every epoch step is one change of the shown period or phase, the next change
    // after an exit is at least one G2 row (.5 s) later, and clicks stay at least .47 shown beats
    // apart across the transitions (half a beat when decided, less the clock's drift until then).
    const auto rampBeats = tempoMap(42.0, [](double t) {
      return 90.0 + 25.0 * std::min(1.0, std::max(0.0, std::min(t - 12.0, 40.0 - t) / 8.0));
    });
    const auto rampHits = groove(rampBeats, kBasic);
    Harness ranged(static_cast<float>(rate), 40.0F, 100.0F);
    ranged.setClick(true);
    std::vector<std::vector<double>> rampAdded;
    const auto ramp =
        run(ranged, render(rampHits, 42.0, rate), rate, {128u}, 2u, 1u, 0.0, &rampAdded);
    int exits = 0;
    double exitAt = -1.0;
    for (std::size_t i = 1u; i < ramp.states.size(); ++i) {
      const auto &a = ramp.states[i - 1u], &b = ramp.states[i];
      if (b.epoch == a.epoch)
        continue;
      CHECK(b.epoch == a.epoch + 1u && b.time - exitAt >= .5);
      if (!a.locked || !b.locked)
        continue;
      CHECK(gridChanged(a, b));
      if (60.0 / a.period < 75.0 && 60.0 / b.period > 75.0) {
        ++exits;
        exitAt = b.time;
      }
    }
    const auto rampClicks = onsets(rampAdded[0]);
    double closest = 1.0;
    std::size_t at = 0u;
    for (std::size_t i = 1u; i < rampClicks.size(); ++i) {
      while (at + 1u < ramp.states.size() && ramp.states[at + 1u].time <= rampClicks[i])
        ++at;
      const double spacing = (rampClicks[i] - rampClicks[i - 1u]) / ramp.states[at].period;
      closest = spacing < closest ? spacing : closest;
    }
    std::printf("range transitions 90-115-90 in 40-100: epoch %u, %d exits, %zu clicks, closest "
                "%.3f shown beats\n",
                ramp.states.back().epoch, exits, rampClicks.size(), closest);
    CHECK(exits >= 1 && closest >= .47);
  }
  std::printf("rhythm_analyzer native tests %s\n", failures ? "FAILED" : "passed");
  return failures ? 1 : 0;
}

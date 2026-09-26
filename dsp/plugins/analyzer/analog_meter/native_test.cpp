#include "allocation_guard.h"
#include "effetune/kernel.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <initializer_list>
#include <utility>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_AnalogMeterPlugin() noexcept;
namespace {
constexpr double pi = 3.14159265358979323846;
enum Mode { Vu, Ppm, Rms, SamplePeak, TruePeak, Loudness };
int failures = 0;
void check(bool ok, const char *text, int line) {
  if (!ok) {
    std::fprintf(stderr, "analog_meter:%d %s\n", line, text);
    ++failures;
  }
}
#define CHECK(x) check(static_cast<bool>(x), #x, __LINE__)
#define NEAR(value, expected, low, high)                                                           \
  check((value) >= (expected) + (low) && (value) <= (expected) + (high), #value, __LINE__)
std::uint32_t u16(const std::uint8_t *p) { return p[0] | (std::uint32_t(p[1]) << 8u); }
float f32(const std::uint8_t *p) {
  const std::uint32_t bits = p[0] | (std::uint32_t(p[1]) << 8u) | (std::uint32_t(p[2]) << 16u) |
                             (std::uint32_t(p[3]) << 24u);
  float value;
  std::memcpy(&value, &bits, 4);
  return value;
}
double db(double linear) { return 20.0 * std::log10(linear); }

struct Reading {
  bool valid = false;
  std::uint32_t mode = 0, channels = 0, flags = 0;
  std::vector<float> needle, peak;
  std::array<float, 6> program{}; // M, S, I, LRA, max true peak, integrated seconds
  bool operator==(const Reading &other) const {
    return valid == other.valid && mode == other.mode && channels == other.channels &&
           flags == other.flags && needle == other.needle && peak == other.peak &&
           program == other.program;
  }
};

struct Meter {
  alignas(std::max_align_t) std::array<std::byte, 8192> storage{};
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_AnalogMeterPlugin();
  effetune::PluginKernel *kernel;
  std::vector<std::uint8_t> ring_bytes = std::vector<std::uint8_t>(65536),
                            bytes = std::vector<std::uint8_t>(65536);
  effetune::TelemetryRing ring;
  std::uint32_t sequence = 0, channels;
  std::uint64_t position = 0;
  double rate;
  Meter(double sample_rate, std::uint32_t channel_count, int mode, float integration = 0.3F,
        float release = 1.5F, float attack = 5.0F)
      : channels(channel_count), rate(sample_rate) {
    CHECK(descriptor->objectSize <= storage.size());
    CHECK(descriptor->paramsFloatCount == 4u);
    kernel = descriptor->construct(storage.data());
    kernel->prepare({static_cast<float>(rate), 16u, 1024u});
    CHECK(kernel->preparedSuccessfully());
    set(mode, integration, release, attack);
    ring.adopt(ring_bytes.data(), static_cast<std::uint32_t>(ring_bytes.size()));
  }
  ~Meter() { descriptor->destroy(kernel); }
  void set(int mode, float integration = 0.3F, float release = 1.5F, float attack = 5.0F) {
    const std::array<float, 4> params = {static_cast<float>(mode), integration, attack, release};
    CHECK(kernel->stageParameters(params.data(), 4u, descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }
  // Writes telemetry once and returns the latest frame, if any.
  Reading take() {
    effetune::TelemetryWriter writer(ring, 27u, sequence);
    {
      const effetune::allocation_guard::Scope guard;
      kernel->writeTelemetry(writer);
    }
    std::uint32_t dropped = 0;
    const auto size = ring.read(bytes.data(), static_cast<std::uint32_t>(bytes.size()), &dropped);
    CHECK(dropped == 0u);
    Reading reading;
    for (std::uint32_t offset = 0; offset < size;) {
      const auto *h = bytes.data() + offset;
      const auto *p = h + 16;
      const auto length = u16(h + 12);
      CHECK(u16(h) == 27u && u16(h + 2) == 1u);
      reading.valid = true;
      reading.mode = p[0];
      reading.channels = p[1];
      reading.flags = u16(p + 2);
      const bool loudness = reading.mode == Loudness;
      CHECK(length == 4u + 8u * reading.channels + (loudness ? 24u : 0u));
      CHECK(loudness || reading.flags == 0u);
      reading.needle.clear();
      reading.peak.clear();
      for (std::uint32_t channel = 0; channel < reading.channels; ++channel) {
        reading.needle.push_back(f32(p + 4 + 8 * channel));
        reading.peak.push_back(f32(p + 8 + 8 * channel));
      }
      for (std::uint32_t index = 0; loudness && index < 6; ++index)
        reading.program[index] = f32(p + 4 + 8 * reading.channels + 4 * index);
      for (const float value : reading.needle)
        CHECK(std::isfinite(value) && value >= -240.0F);
      offset += (16u + length + 3u) & ~3u;
    }
    return reading;
  }
  // Feeds `seconds` of signal(frame, channel) in the given block pattern. With `observe`, a
  // reading is taken after every block and passed to observe(time_after_block, reading).
  template <class Signal, class Observe>
  void feed(double seconds, Signal signal, Observe observe,
            std::initializer_list<std::uint32_t> blocks = {48u}) {
    const auto total = static_cast<std::uint64_t>(std::llround(seconds * rate));
    const std::vector<std::uint32_t> pattern(blocks);
    std::vector<float> audio;
    for (std::uint64_t done = 0, block = 0; done < total; ++block) {
      const auto remaining = total - done;
      const std::uint32_t size = pattern[block % pattern.size()] < remaining
                                     ? pattern[block % pattern.size()]
                                     : static_cast<std::uint32_t>(remaining);
      audio.resize(static_cast<std::size_t>(channels) * size);
      for (std::uint32_t channel = 0; channel < channels; ++channel)
        for (std::uint32_t i = 0; i < size; ++i)
          audio[channel * size + i] = static_cast<float>(signal(position + i, channel));
      const auto original = audio;
      {
        const effetune::allocation_guard::Scope guard;
        kernel->process(audio.data(), channels, size, {static_cast<double>(position) / rate});
      }
      CHECK(std::memcmp(original.data(), audio.data(), audio.size() * sizeof(float)) == 0);
      position += size;
      done += size;
      observe(static_cast<double>(position) / rate, *this);
    }
  }
  template <class Signal>
  Reading run(double seconds, Signal signal, std::initializer_list<std::uint32_t> blocks = {128u}) {
    // Drain periodically so long runs never overflow the ring.
    feed(seconds, signal, [](double, Meter &m) { m.take(); }, blocks);
    return take();
  }
};

auto sine(double rate, double level_db, double frequency, double phase = 0.0) {
  const double amplitude = std::pow(10.0, level_db / 20.0);
  return [=](std::uint64_t n, std::uint32_t) {
    return amplitude * std::sin(2.0 * pi * frequency * static_cast<double>(n) / rate + phase);
  };
}
auto silence() {
  return [](std::uint64_t, std::uint32_t) { return 0.0; };
}
// Stereo 1 kHz sine whose level steps through (dBFS, seconds) segments, as in EBU Tech 3341/3342.
Reading runSegments(Meter &meter, std::vector<std::pair<double, double>> segments) {
  double total = 0.0;
  for (const auto &segment : segments)
    total += segment.second;
  const double start = static_cast<double>(meter.position);
  const double rate = meter.rate;
  return meter.run(total, [&](std::uint64_t n, std::uint32_t) {
    double time = (static_cast<double>(n) - start) / rate, level = segments.back().first;
    for (const auto &segment : segments) {
      if (time < segment.second) {
        level = segment.first;
        break;
      }
      time -= segment.second;
    }
    return std::pow(10.0, level / 20.0) * std::sin(2.0 * pi * 1000.0 * n / rate);
  });
}

// Seconds until the needle falls `drop` dB below its level when the signal stops.
double releaseTime(double rate, int mode, float release, double drop = 20.0) {
  Meter meter(rate, 1u, mode, 0.3F, release);
  const double start =
      meter.run(1.0, sine(rate, -6.0, 997.0)).needle[0]; // steady reading before the fall
  double crossed = -1.0;
  meter.feed(drop / 20.0 * release + 1.0, silence(),
             [&](double time, Meter &m) {
               const auto reading = m.take();
               if (crossed < 0.0 && reading.needle[0] <= start - drop)
                 crossed = time - 1.0;
             },
             {16u});
  return crossed;
}

void testVu(double rate) {
  Meter steady(rate, 2u, Vu);
  const auto reading = steady.run(1.5, sine(rate, -18.0, 1000.0));
  std::printf("%g Hz VU -18 dBFS reads %.4f dB\n", rate, reading.needle[0]);
  NEAR(reading.needle[0], -18.0, -0.05, 0.05);
  NEAR(reading.needle[1], -18.0, -0.05, 0.05);

  Meter step(rate, 1u, Vu);
  const double level = std::pow(10.0, -18.0 / 20.0);
  double reach = -1.0, highest = 0.0, final = 0.0;
  step.feed(2.0, sine(rate, -18.0, 1000.0),
            [&](double time, Meter &m) {
              const auto r = m.take();
              const double value = std::pow(10.0, r.needle[0] / 20.0);
              if (reach < 0.0 && value >= 0.99 * level)
                reach = time;
              const double top = std::pow(10.0, r.peak[0] / 20.0);
              highest = top > highest ? top : highest;
              final = value;
            },
            {static_cast<std::uint32_t>(rate / 1000.0)});
  const double overshoot = highest / final - 1.0;
  std::printf("%g Hz VU 99%% at %.4f s, overshoot %.3f%%\n", rate, reach, overshoot * 100.0);
  NEAR(reach, 0.3, -0.03, 0.03);
  NEAR(overshoot, 0.0, 0.01, 0.015);
}

// Highest PPM needle reading, relative to the steady tone, for a 5 kHz burst of `seconds`.
double ppmBurst(double rate, float attack_ms, double seconds, double tone) {
  Meter meter(rate, 1u, Ppm, 0.3F, 1.5F, attack_ms);
  double highest = -240.0;
  const auto observe = [&](double, Meter &m) {
    const double value = m.take().peak[0];
    highest = value > highest ? value : highest;
  };
  meter.feed(seconds, sine(rate, -6.0, 5000.0), observe, {16u});
  meter.feed(0.1, silence(), observe, {16u});
  return highest - tone;
}

void testPpm(double rate) {
  for (const float attack : {1.0F, 5.0F, 7.5F, 10.0F, 20.0F}) {
    Meter steady(rate, 1u, Ppm, 0.3F, 1.5F, attack);
    const double tone = steady.run(1.0, sine(rate, -6.0, 5000.0)).needle[0];
    const double burst = ppmBurst(rate, attack, attack * 0.001, tone);
    std::printf("%g Hz PPM at=%g ms: steady %.3f dB, %g ms burst %.3f dB\n", rate, attack, tone,
                attack, burst);
    NEAR(tone, -6.0, -0.15, 0.01);
    NEAR(burst, -2.0, -0.5, 0.5);
    if (attack == 5.0F) {
      const double longer = ppmBurst(rate, attack, 0.01, tone);
      std::printf("%g Hz PPM at=5 ms: 10 ms burst %.3f dB\n", rate, longer);
      NEAR(longer, -1.0, -0.5, 0.5);
    }
  }
  for (const float release : {1.5F, 2.33F}) {
    const double time = releaseTime(rate, Ppm, release);
    std::printf("%g Hz PPM 20 dB release at rt=%g: %.4f s\n", rate, release, time);
    NEAR(time, release, -0.03, 0.03);
  }
}

void testRms(double rate) {
  Meter meter(rate, 1u, Rms);
  const double half = meter.run(0.15, sine(rate, -12.0, 1000.0)).needle[0];
  const double full = meter.run(0.45, sine(rate, -12.0, 1000.0)).needle[0];
  std::printf("%g Hz RMS half window %.4f dB, full %.4f dB\n", rate, half, full);
  NEAR(half, -12.0 - 3.0103, -0.25, 0.25);
  NEAR(full, -12.0, -0.05, 0.05);
  meter.set(Rms, 1.0F);
  const double longer_half = meter.run(0.5, sine(rate, -12.0, 1000.0)).needle[0];
  const double longer_full = meter.run(0.7, sine(rate, -12.0, 1000.0)).needle[0];
  NEAR(longer_half, -12.0 - 3.0103, -0.25, 0.25);
  NEAR(longer_full, -12.0, -0.05, 0.05);
  // Uniform white noise of amplitude 0.5: RMS 0.5/sqrt(3), read at +3.01 dB.
  std::uint32_t random = 12345u;
  Meter noise(rate, 1u, Rms);
  const double noise_db = noise
                              .run(1.0,
                                   [&](std::uint64_t, std::uint32_t) {
                                     random ^= random << 13u;
                                     random ^= random >> 17u;
                                     random ^= random << 5u;
                                     return (random / 4294967296.0 * 2.0 - 1.0) * 0.5;
                                   })
                              .needle[0];
  NEAR(noise_db, db(0.5 * std::sqrt(2.0 / 3.0)), -0.2, 0.2);
}

void testSamplePeak(double rate) {
  Meter meter(rate, 1u, SamplePeak);
  meter.feed(
      0.01,
      [](std::uint64_t n, std::uint32_t) { return n == 100u ? 0.8 : (n == 200u ? -0.5 : 0.0); },
      [](double, Meter &) {});
  const auto impulse = meter.take();
  CHECK(impulse.peak[0] == static_cast<float>(db(static_cast<float>(0.8))));
  const double standard = releaseTime(rate, SamplePeak, 1.5F);
  const double custom = releaseTime(rate, SamplePeak, 0.5F);
  std::printf("%g Hz Sample Peak release rt=1.5 %.4f s, rt=0.5 %.4f s\n", rate, standard, custom);
  NEAR(standard, 1.5, -0.01, 0.01);
  NEAR(custom, 0.5, -0.01, 0.01);
}

double truePeakRead(double rate, int mode, double frequency, double phase) {
  Meter meter(rate, 1u, mode);
  return meter.run(0.2, sine(rate, -6.0, frequency, phase)).peak[0] + 6.0;
}

void testTruePeak(double rate) {
  const std::uint32_t factor = rate >= 176400 ? 1u : (rate >= 88200 ? 2u : 4u);
  if (factor > 1u) {
    // fs/4 shifted by 45 degrees: every sample sits 3.01 dB under the true peak.
    const double sample = truePeakRead(rate, SamplePeak, rate / 4.0, pi / 4.0);
    const double truth = truePeakRead(rate, TruePeak, rate / 4.0, pi / 4.0);
    std::printf("%g Hz True Peak fs/4 %.4f dB (sample %.4f dB)\n", rate, truth, sample);
    NEAR(sample, -3.0103, -0.01, 0.01);
    NEAR(truth, 0.0, -0.4, 0.2);
  } else {
    const double truth = truePeakRead(rate, TruePeak, 12000.0, 0.3);
    std::printf("%g Hz True Peak 12 kHz %.4f dB\n", rate, truth);
    NEAR(truth, 0.0, -0.4, 0.2);
    CHECK(truth == truePeakRead(rate, SamplePeak, 12000.0, 0.3));
  }
  // An fs/8 sine advances 45 degrees per sample, so the sub-sample grid of factor L steps
  // 45/L degrees. Shifted by 22.5 degrees it lands on the true peak from L = 2; shifted by
  // 11.25 degrees only at L = 4. Otherwise the reading is cos(offset) below the peak.
  const double eighth = truePeakRead(rate, TruePeak, rate / 8.0, pi / 8.0);
  const double sixteenth = truePeakRead(rate, TruePeak, rate / 8.0, pi / 16.0);
  std::printf("%g Hz True Peak fs/8 %.4f dB, %.4f dB (factor %u)\n", rate, eighth, sixteenth,
              factor);
  NEAR(eighth, factor >= 2u ? 0.0 : db(std::cos(pi / 8.0)), -0.02, 0.02);
  NEAR(sixteenth, factor == 4u ? 0.0 : db(std::cos(pi / 16.0)), -0.02, 0.02);
}

void testLoudness(double rate, bool full) {
  const auto loud = [rate](std::vector<std::pair<double, double>> segments) {
    Meter meter(rate, 2u, Loudness);
    return runSegments(meter, std::move(segments));
  };
  // EBU Tech 3341 cases 1 and 2.
  for (const double level : {-23.0, -33.0}) {
    const auto r = loud({{level, 20.0}});
    std::printf("%g Hz Tech 3341 %.0f dBFS: M %.3f S %.3f I %.3f\n", rate, level, r.program[0],
                r.program[1], r.program[2]);
    CHECK(r.flags & 1u);
    NEAR(r.program[0], level, -0.1, 0.1);
    NEAR(r.program[1], level, -0.1, 0.1);
    NEAR(r.program[2], level, -0.1, 0.1);
    NEAR(r.needle[0], level - 3.0103, -0.1, 0.1);
    NEAR(r.program[5], 20.0, -0.11, 0.01);
    if (!full)
      break;
  }
  // Tech 3341 cases 3 to 5 exercise the relative and absolute gates.
  const std::vector<std::vector<std::pair<double, double>>> gated = {
      {{-36.0, 10.0}, {-23.0, 60.0}, {-36.0, 10.0}},
      {{-72.0, 10.0}, {-36.0, 10.0}, {-23.0, 60.0}, {-36.0, 10.0}, {-72.0, 10.0}},
      {{-26.0, 20.0}, {-20.0, 20.1}, {-26.0, 20.0}}};
  for (std::size_t index = 0; index < gated.size(); ++index) {
    const auto r = loud(gated[index]);
    std::printf("%g Hz Tech 3341 case %zu: I %.3f\n", rate, index + 3, r.program[2]);
    CHECK(r.flags & 1u);
    NEAR(r.program[2], -23.0, -0.1, 0.1);
    if (!full)
      break;
  }
  // EBU Tech 3342 cases 1 to 4.
  const std::vector<std::pair<std::vector<std::pair<double, double>>, double>> range = {
      {{{-20.0, 20.0}, {-30.0, 20.0}}, 10.0},
      {{{-20.0, 20.0}, {-15.0, 20.0}}, 5.0},
      {{{-40.0, 20.0}, {-20.0, 20.0}}, 20.0},
      {{{-50.0, 20.0}, {-35.0, 20.0}, {-20.0, 20.0}, {-35.0, 20.0}, {-50.0, 20.0}}, 15.0}};
  for (std::size_t index = 0; index < range.size(); ++index) {
    const auto r = loud(range[index].first);
    std::printf("%g Hz Tech 3342 case %zu: LRA %.3f\n", rate, index + 1, r.program[3]);
    CHECK(r.flags & 2u);
    NEAR(r.program[3], range[index].second, -1.0, 1.0);
    if (!full)
      break;
  }
}

void testLoudnessDetails() {
  const double rate = 48000.0;
  // Maximum true peak is held across channels after the signal drops.
  Meter peak(rate, 2u, Loudness);
  peak.run(1.0, [&](std::uint64_t n, std::uint32_t channel) {
    return channel == 1u ? 0.5 * std::sin(2.0 * pi * n / 4.0 + pi / 4.0) : 0.0;
  });
  const auto held = peak.run(1.0, silence());
  NEAR(held.program[4], db(0.5), -0.4, 0.2);
  CHECK(held.program[0] == -240.0F);

  // 5.1: surround weight 1.41, LFE excluded, per-channel values unweighted.
  const auto single = [&](std::uint32_t only) {
    Meter meter(rate, 6u, Loudness);
    return meter.run(1.0, [&](std::uint64_t n, std::uint32_t channel) {
      return channel == only ? std::pow(10.0, -23.0 / 20.0) * std::sin(2.0 * pi * 1000.0 * n / rate)
                             : 0.0;
    });
  };
  const auto surround = single(4u);
  const auto lfe = single(3u);
  const double alone = -23.0 - 3.0103;
  NEAR(surround.needle[4], alone, -0.1, 0.1);
  NEAR(surround.program[0], alone + 10.0 * std::log10(1.41), -0.1, 0.1);
  CHECK(surround.needle[0] == -240.0F);
  NEAR(lfe.needle[3], alone, -0.1, 0.1);
  CHECK(lfe.program[0] == -240.0F);

  // Momentary and Short-term slide every 10 ms sub-block, not only on the 100 ms gating hop.
  Meter rising(rate, 2u, Loudness);
  int momentary_steps = 0, short_term_steps = 0;
  float last_momentary = -240.0F, last_short_term = -240.0F;
  rising.feed(0.2, sine(rate, -23.0, 1000.0), [&](double time, Meter &m) {
    const auto r = m.take();
    if (time > 0.1) {
      momentary_steps += r.program[0] != last_momentary;
      short_term_steps += r.program[1] != last_short_term;
    }
    last_momentary = r.program[0];
    last_short_term = r.program[1];
  });
  CHECK(momentary_steps == 10 && short_term_steps == 10);

  // Stereo channels at different levels read independently.
  Meter pair(rate, 2u, Loudness);
  const auto split = pair.run(3.5, [&](std::uint64_t n, std::uint32_t channel) {
    return std::pow(10.0, (channel == 0u ? -23.0 : -33.0) / 20.0) *
           std::sin(2.0 * pi * 1000.0 * n / rate);
  });
  NEAR(split.needle[0], -23.0 - 3.0103, -0.1, 0.1);
  NEAR(split.needle[1], -33.0 - 3.0103, -0.1, 0.1);
  NEAR(split.peak[0], -23.0 - 3.0103, -0.1, 0.1);
  NEAR(split.peak[1], -33.0 - 3.0103, -0.1, 0.1);

  // Reset and mode switches clear Integrated, LRA and the held true peak.
  CHECK(split.flags == 1u + 2u || split.flags == 1u);
  pair.kernel->reset();
  CHECK(!pair.take().valid);
  const auto after_reset = pair.run(0.2, silence());
  CHECK(after_reset.flags == 0u && after_reset.program[4] == -240.0F);
  NEAR(after_reset.program[5], 0.2, -0.01, 0.01);
  pair.run(1.0, sine(rate, -23.0, 1000.0));
  pair.set(Vu);
  CHECK(pair.run(0.1, silence()).mode == Vu);
  pair.set(Loudness);
  const auto switched = pair.run(0.2, silence());
  CHECK(switched.flags == 0u && switched.program[4] == -240.0F);
  NEAR(switched.program[5], 0.2, -0.01, 0.01);
}

void testBlockIndependence() {
  for (int mode = Vu; mode <= Loudness; ++mode) {
    const auto signal = [](std::uint64_t n, std::uint32_t channel) {
      return 0.3 * std::sin(0.013 * n * (channel + 1)) + 0.2 * std::sin(0.71 * n);
    };
    Meter regular(44100.0, 3u, mode, 0.05F), irregular(44100.0, 3u, mode, 0.05F);
    const auto a = regular.run(0.7, signal, {128u});
    const auto b = irregular.run(0.7, signal, {97u, 31u, 64u, 1u, 127u});
    CHECK(a.valid && a.mode == static_cast<std::uint32_t>(mode) && a.channels == 3u);
    CHECK(a.needle == b.needle);
    CHECK(a.program == b.program);
  }
}

void testRejectedWrite() {
  Meter meter(48000.0, 1u, SamplePeak);
  meter.run(0.01, [](std::uint64_t n, std::uint32_t) { return n == 10u ? 0.8 : 0.0; });
  meter.run(0.2, silence());
  meter.feed(0.2, silence(), [](double, Meter &) {});
  // A ring too small for the frame rejects the write; the interval maximum must survive it.
  std::array<std::uint8_t, 24> tiny{};
  effetune::TelemetryRing small;
  small.adopt(tiny.data(), static_cast<std::uint32_t>(tiny.size()));
  std::uint32_t sequence = 0;
  effetune::TelemetryWriter writer(small, 27u, sequence);
  meter.kernel->writeTelemetry(writer);
  CHECK(small.size() == 0u);
  meter.feed(0.2, silence(), [](double, Meter &) {});
  const auto carried = meter.take();
  // The last accepted write reset the maximum at 0.21 s; the peak since then is that needle.
  CHECK(carried.peak[0] > carried.needle[0] + 2.0F);
  const auto next = meter.take();
  CHECK(next.peak[0] == next.needle[0]);
}
} // namespace

int main() {
  for (const double rate : {48000.0, 96000.0}) {
    testVu(rate);
    testPpm(rate);
    testRms(rate);
  }
  for (const double rate : {44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0}) {
    testSamplePeak(rate);
    testTruePeak(rate);
  }
  testPpm(44100.0);
  testPpm(192000.0);
  testLoudness(48000.0, true);
  testLoudness(96000.0, false);
  testLoudnessDetails();
  testBlockIndependence();
  testRejectedWrite();
  return failures ? 1 : 0;
}

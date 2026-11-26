#include "host/clocked_fifo.h"
#include "host/resampler.h"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <numbers>
#include <stdexcept>
#include <string>
#include <vector>

using namespace effetune::audio;

namespace {
void require(bool ok, const char *message) {
  if (!ok)
    throw std::runtime_error(message);
}

void checkQuality(unsigned inputRate, unsigned outputRate) {
  Resampler converter(1, inputRate, outputRate);
  const double step = converter.inputPerOutput();
  converter.setCorrection(0.002);
  require(converter.inputPerOutput() == step, "Fixed-rate ratio was corrected");
  std::vector<float> input(inputRate / 12), output(outputRate / 12);
  const double delay = converter.delayInputFrames() / inputRate;
  input[0] = 1;
  converter.process(input.data(), input.size(), input.size(), output.data(), output.size(),
                    output.size());
  auto peak = std::max_element(output.begin(), output.end()) - output.begin();
  require(std::abs(peak - outputRate * delay) <= 1, "Reported group delay disagrees with impulse");
  double worstRipple = 0, worstError = 0;
  for (double frequency : {997., 10000., 20000.}) {
    converter.reset();
    const double omega = 2 * std::numbers::pi * frequency;
    for (std::size_t i = 0; i < input.size(); ++i)
      input[i] = static_cast<float>(std::sin(omega * i / inputRate));
    const auto n = converter
                       .process(input.data(), input.size(), input.size(), output.data(),
                                output.size(), output.size())
                       .produced;
    double signal = 0, reference = 0, error = 0;
    for (std::size_t i = outputRate / 100; i < n; ++i) {
      const double expected = std::sin(omega * (static_cast<double>(i) / outputRate - delay));
      signal += double(output[i]) * output[i];
      reference += expected * expected;
      error += (output[i] - expected) * (output[i] - expected);
    }
    worstRipple = std::max(worstRipple, std::abs(10 * std::log10(signal / reference)));
    worstError = std::max(worstError, std::sqrt(error / reference));
  }
  double alias = 0;
  if (inputRate > outputRate) {
    converter.reset();
    // A sweep wholly above the output Nyquist must not fold down into the passband.
    double phase = 0;
    for (std::size_t i = 0; i < input.size(); ++i) {
      const double hz =
          outputRate * .501 + (inputRate * .49 - outputRate * .501) * i / input.size();
      phase += 2 * std::numbers::pi * hz / inputRate;
      input[i] = static_cast<float>(std::sin(phase));
    }
    const auto n = converter
                       .process(input.data(), input.size(), input.size(), output.data(),
                                output.size(), output.size())
                       .produced;
    for (std::size_t i = outputRate / 100; i < n; ++i)
      alias = std::max(alias, std::abs(static_cast<double>(output[i])));
  }
  std::cout << inputRate << " -> " << outputRate << ": ripple " << worstRipple << " dB, RMS error "
            << worstError << ", stopband peak " << alias << '\n';
  require(worstRipple < 0.02 && worstError < .002 && alias < .001, "Resampler quality");
}

void checkFifoDrift(unsigned inputRate, unsigned outputRate) {
  ClockedFifo fifo(1, 4096);
  constexpr std::size_t target = 768, period = 128;
  fifo.open(1, inputRate, outputRate, target);
  const double ratio = double(inputRate) / outputRate;
  std::vector<float> input(target, .5f), output(period);
  require(fifo.write(input.data(), 1, target, 0, 0), "FIFO initial fill");
  std::uint64_t position = target;
  double remainder = 0, maxError = 0;
  const std::size_t periods = outputRate * 30 / period;
  for (std::size_t block = 0; block < periods; ++block) {
    fifo.read(output.data(), period, period);
    require(fifo.state() == FifoState::running, "Drifting clock stopped");
    const double time = double(block * period) / outputRate;
    if (time > 1)
      for (float sample : output)
        maxError = std::max(maxError, std::abs(sample - .5));
    // The producer first drifts slowly in both directions, then settles 500 ppm fast.
    const double drift = time < 12 ? .0008 * std::sin(time * .45) : .0005;
    remainder += period * ratio * (1 + drift);
    const auto count = static_cast<std::size_t>(remainder);
    remainder -= count;
    require(fifo.write(input.data(), 1, count, 0, position), "Drifting input overflowed");
    position += count;
    require(fifo.queued() > target / 2 && fifo.queued() < target * 2, "Unbounded clock drift");
  }
  require(std::abs(fifo.inputPerOutput() / ratio - 1.0005) < .00005, "Clock failed to converge");
  require(!fifo.underruns() && !fifo.overflows() && !fifo.gaps(), "Drift caused a discontinuity");
  require(maxError < .00001, "Drift modulated DC level");
}

void checkLiveInput() {
  // Device input runs 20 ppm fast and starts with a burst of three packets.
  // Its packets begin just before each read and drift across the read instant,
  // so the order of arrival and read flips mid-run, and later the reader stalls.
  // None of this may be taken for clock drift beyond the real 20 ppm.
  ClockedFifo fifo(1, 4096);
  constexpr std::size_t period = 480, target = 2 * period;
  constexpr double drift = 20e-6, readNs = 1e7, packetNs = readNs / (1 + drift);
  fifo.open(1, 48000, 48000, target, true);
  std::vector<float> input(period, .5f), output(period);
  std::uint64_t packet = 0;
  auto arrival = [&](std::uint64_t n) {
    // Small scheduling jitter on top of the clock; the first three arrive together.
    const double jitter = ((n * 7919) % 11 - 5.) * 2e4;
    return readNs - 2e5 + (n < 3 ? 0 : (n - 2) * packetNs) + jitter;
  };
  double worst = 0;
  for (std::uint64_t block = 1; block <= 6000; ++block) {
    const double now = block * readNs;
    while (arrival(packet) <= now) {
      require(fifo.write(input.data(), 1, period, 0, packet * period,
                         static_cast<std::uint64_t>(arrival(packet))),
              "Capture packet");
      ++packet;
    }
    // A 50 ms reader stall leaves a backlog that must not stay as latency.
    if (block > 3000 && block <= 3005)
      continue;
    fifo.read(output.data(), period, period, static_cast<std::uint64_t>(now));
    if (block == 3006)
      require(fifo.queued() < 2 * target, "Stall backlog was kept");
    worst = std::max(worst, std::abs(fifo.inputPerOutput() - 1 - drift));
  }
  std::cout << "live input: worst ratio error " << worst * 1e6 << " ppm, queued " << fifo.queued()
            << '\n';
  require(worst < 40e-6 && !fifo.underruns(), "Packet timing was taken for clock drift");
}

void checkLivePacketAcrossSilence() {
  ClockedFifo fifo(1, 64);
  constexpr std::size_t target = 8;
  constexpr std::uint64_t now = 1000000;
  fifo.open(1, 48000, 48000, target, true);
  std::vector<float> input(24, .5f);
  require(fifo.write(input.data(), 1, input.size(), 0, 0, 1), "Write first live segment");
  fifo.silence(0);
  require(fifo.write(input.data(), 1, 12, 0, 48, now), "Write the next live packet");
  float output = 0.f;
  fifo.read(&output, 1, 1, now);
  require(fifo.queued() <= target + 1 + 12,
          "A new packet changed the backlog of an already ended segment");
}

void checkFifoTransitions() {
  ClockedFifo fifo(2, 512);
  fifo.open(2, 48000, 48000, 128);
  std::vector<float> input(256, .5f), output(64);
  auto render = [&] { fifo.read(output.data(), 32, 32); };
  require(fifo.write(input.data(), 1, 32, 1, 0), "Write while idle");
  render();
  require(fifo.state() == FifoState::priming && output[0] == 0, "Priming leaked input");
  require(fifo.write(input.data(), 1, 224, 1, 32), "Prime to target");
  for (int i = 0; i < 6; ++i)
    render();
  require(std::abs(output[0] - .5f) < .00001f && output[32] == 0, "Mono routing");
  fifo.silence(1);
  for (int i = 0; i < 10; ++i)
    render();
  require(fifo.state() == FifoState::idle && fifo.underruns() == 0, "Intentional silence underrun");
  require(fifo.write(input.data(), 1, 200, 1, 2200), "Resume after announced silence");
  require(!fifo.gaps(), "Announced silence reported as a gap");
  render();
  require(fifo.write(input.data(), 1, 160, 1, 2450), "Accept new timeline after missing PCM");
  require(fifo.gaps() == 1, "Missing frames were not counted");
  render();
  fifo.flush(2);
  require(!fifo.write(input.data(), 1, 160, 1, 2600), "Stale generation after flush");
  for (int i = 0; i < 4; ++i)
    render();
  require(fifo.state() == FifoState::idle &&
              std::all_of(output.begin(), output.end(), [](float s) { return s == 0; }),
          "Old audio survived flush");
  require(fifo.write(input.data(), 1, 200, 2, 5), "Accept current generation");
  for (int i = 0; i < 12; ++i)
    render();
  require(fifo.underruns() == 1 && fifo.state() == FifoState::priming, "Unannounced starvation");
  fifo.open(2, 48000, 48000, 128);
  require(fifo.write(input.data(), 1, 200, 2, 205), "Reopen changed feed generation");
  require(!fifo.write(input.data(), 1, 512, 2, 405) && fifo.overflows() == 1, "Overflow counter");
}
} // namespace

int main() {
  try {
    for (auto rate : {44100u, 48000u, 96000u, 192000u, 384000u}) {
      checkQuality(rate, 44100);
      checkQuality(44100, rate);
    }
    checkFifoTransitions();
    checkLiveInput();
    checkLivePacketAcrossSilence();
    checkFifoDrift(48000, 48000);
    checkFifoDrift(44100, 48000);
  } catch (const std::exception &error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}

#include "device/null/null_device.h"
#include "frame.h"
#include "host/pipeline.h"
#include "pffft.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>
#if defined(__x86_64__) || defined(_M_X64)
#include <xmmintrin.h>
#endif
#include <sstream>

namespace {
using namespace effetune::audio;
std::vector<std::uint8_t> descriptor(std::initializer_list<std::uint32_t> ids) {
  std::vector<std::uint8_t> bytes(8 + ids.size() * 12);
  bytes[0] = 1;
  bytes[4] = static_cast<std::uint8_t>(ids.size());
  std::size_t pos = 8;
  for (auto id : ids) {
    std::memcpy(bytes.data() + pos, &id, sizeof(id));
    bytes[pos + 4] = bytes[pos + 8] = 1;
    bytes[pos + 7] = 254;
    pos += 12;
  }
  return bytes;
}

bool preservesRamp() {
  Session reference, updated;
  PluginSettings volume{1, "VolumePlugin", 0x66796aa7u, {0.0f}, {}, false};
  PluginSettings unity = volume;
  unity.id = 2;
  for (auto *session : {&reference, &updated}) {
    if (!session->open({48000, 0, 2, 128}) ||
        !session->pipeline()->configure({volume}, descriptor({1})))
      return false;
  }
  std::array<float, 256> a, b;
  for (unsigned block = 0; block < 6; ++block) {
    if (block == 1) {
      volume.params[0] = -12.0f;
      if (!reference.pipeline()->update(volume) || !updated.pipeline()->update(volume))
        return false;
    }
    if (block == 2 && !updated.pipeline()->configure({volume, unity}, descriptor({2, 1})))
      return false;
    a.fill(1.0f);
    b.fill(1.0f);
    if (!reference.render(a, 128) || !updated.render(b, 128) || a != b)
      return false;
  }
  return std::abs(a[0] - 0.2511886f) < 1e-5f;
}

bool loadsIrAsset(bool removeNode) {
  Session session;
  if (!session.open({48000, 0, 2, 128}))
    return false;
  auto *pipeline = session.pipeline();
  AssetData impulse;
  const std::array<std::uint32_t, 9> words{0x31415445, 1, 1, 48000, 1, 0, 0, 0, 0x3f800000};
  impulse.payload.resize(sizeof(words));
  std::memcpy(impulse.payload.data(), words.data(), sizeof(words));
  impulse.footprintBytes = 1024 * 1024;
  impulse.processingChannels = 2;
  impulse.headBlock = 128;
  impulse.formatTag = 1;
  if (!pipeline->setAsset(1, 0, std::move(impulse)) || pipeline->assetState(1, 0) != 1)
    return false;
  PluginSettings ir{1, "IRReverbPlugin", 0x96be6b1au, {0, 1, 1, 0, 0, 0, 0}, {}, false};
  if (!pipeline->configure({ir}, descriptor({1})))
    return false;
  std::array<float, 256> signal{};
  for (unsigned i = 0; i < 64; ++i)
    if (!session.render(signal, 128))
      return false;
  if (removeNode) {
    if ((pipeline->assetState(1, 0) & 255u) != 3)
      return false;
    auto bypassed = descriptor({1});
    bypassed[12] = 0;
    if (!pipeline->configure({ir}, std::move(bypassed)))
      return false;
    auto remove = pipeline->prepareChange({}, descriptor({}));
    return remove && remove->capture() && remove->prepare() && remove->publish() &&
           pipeline->assetState(1, 0) == 0 && session.render(signal, 128);
  }
  return (pipeline->assetState(1, 0) & 0xffu) == 3 && pipeline->clearAsset(1, 0) &&
         pipeline->assetState(1, 0) == 0;
}
bool gatesLatencyChanges() {
  Session session;
  PluginSettings limiter{1,    "BrickwallLimiterPlugin", 0xb531a24au, {0, 100, 0, 1, 0, -1}, {},
                         false};
  if (!session.open({48000, 0, 2, 128}) ||
      !session.pipeline()->configure({limiter}, descriptor({1})))
    return false;
  std::array<float, 256> signal;
  signal.fill(.5f);
  if (!session.render(signal, 128) || session.latency() != 1)
    return false;
  limiter.params[2] = 5;
  if (!session.updateParameter(limiter) || session.output().topologyReady() ||
      session.latency() != 1)
    return false;
  bool silent = false;
  for (unsigned i = 0; i < 64; ++i) {
    signal.fill(.5f);
    if (!session.render(signal, 128))
      return false;
    silent |= std::all_of(signal.begin(), signal.end(), [](float v) { return v == 0; });
  }
  return silent && session.output().topologyReady() && session.latency() == 240 && signal[0] > .1f;
}

bool observesPhysicalRender() {
  Session session;
  if (!session.open({48000, 0, 2, 128}))
    return false;
  auto &power = session.power();
  PowerConfig settings;
  settings.enabled = settings.fast = settings.skip = true;
  settings.graph = 2;
  settings.topology = 7;
  settings.seconds = 0;
  power.configure(settings, *session.pipeline(), Directive::full, -1, -1);
  if (!power.command(Directive::full, 3, -1, -1, false))
    return false;
  power.request(13);
  std::array<float, 256> samples{};
  if (!session.render(samples, 128))
    return false;
  bool first = false, observation = false;
  PowerEvent message;
  while (power.take(message)) {
    first |= message.type == PowerEvent::Type::first && message.state.command == 3;
    observation |= message.type == PowerEvent::Type::observation &&
                   message.state.observation == 13 && !message.state.outputActive;
  }
  if (!first || !observation || !power.command(Directive::automatic, 4, 1, 1, false) ||
      !session.render(samples, 128) || !power.state().monitoring ||
      power.state().arm != PowerState::Arm::consumed)
    return false;
  samples[0] = 1;
  if (!session.render(samples, 128) || power.state().monitoring ||
      power.state().directive != Directive::full || samples[0] != 1)
    return false;
  if (!power.command(Directive::zero, 5, 2, -1, false))
    return false;
  samples.fill(1);
  if (!session.render(samples, 128) ||
      std::any_of(samples.begin(), samples.end(), [](auto v) { return v != 0; }))
    return false;
  if (!power.resume(*session.pipeline(), 5, 2, 6) || power.state().directive != Directive::full)
    return false;
  session.output().delay(3, false);
  samples.fill(0);
  samples[0] = .75f;
  samples[128] = -.5f;
  if (!session.render(samples, 128) || samples[0] != 0 || samples[3] != .75f ||
      samples[131] != -.5f)
    return false;
  session.output().fade(0, 4);
  samples.fill(.5f);
  if (!session.render(samples, 128) || session.output().completedGain() != 0 || samples[127] != 0)
    return false;
  return true;
}
bool checksRuntimeFloatingPoint() {
  Session session;
  if (!session.open({48000, 0, 2, 128}))
    return false;
  PluginSettings volume{1, "VolumePlugin", 0x66796aa7u, {0.f}, {}, false};
  auto &p = *session.pipeline();
  if (!p.configure({volume}, descriptor({1})))
    return false;
  for (const auto bad :
       {std::numeric_limits<float>::quiet_NaN(), std::numeric_limits<float>::infinity(),
        -std::numeric_limits<float>::infinity()}) {
    volume.params[0] = bad;
    if (p.update(volume) || p.configure({volume}, descriptor({1})))
      return false;
  }
  std::array<float, 256> signal{};
  if (!session.render(signal, 128))
    return false;
#if defined(__x86_64__) || defined(_M_X64)
  return (_mm_getcsr() & 0x8040u) == 0x8040u;
#elif defined(__aarch64__)
  std::uint64_t fpcr;
  __asm__ volatile("mrs %0, fpcr" : "=r"(fpcr));
  return (fpcr & (std::uint64_t{1} << 24)) != 0;
#else
  return true;
#endif
}
bool mapsStreamBoundaries() {
  auto engine = std::make_unique<effetune::Engine>();
  if (engine->prepare(48000, 2, 128, 65536) != ET_OK)
    return false;
  const auto rhythm = engine->createInstance("RhythmAnalyzerPlugin");
  if (!rhythm)
    return false;
  auto telemetry = std::make_unique<Telemetry>();
  StreamBoundaries boundaries;
  StreamBoundaries::List incoming{{1003, 1}, {1016, 2}}, reclaimed;
  boundaries.reserve(3, incoming, reclaimed);
  // A cancelled start leaves the end reservation intact.
  boundaries.reserve(1, incoming, reclaimed);
  std::optional<std::uint64_t> applied;
  const auto slice = [&](std::uint64_t pipeline, FeedTime source) {
    return boundaries.slice(pipeline, 128, source, *telemetry, 0, VisualizerStage::pipeline,
                            [&](BoundarySlice &window) {
                              window.visit(*engine, rhythm, "RhythmAnalyzerPlugin", 12, applied);
                            });
  };
  if (slice(500, {1000, 0}) != 128 || applied)
    return false;
  if (slice(628, {1000, 1}) != 28 || applied)
    return false;
  if (slice(656, {1028, 1}) != 128 || applied != 644)
    return false;
  return true;
}
bool comparesSpectrum(bool hq) {
  Session session;
  if (!session.open({48000, 0, 2, 128}))
    return false;
  PluginSettings v{1, "VolumePlugin", 0x66796aa7u, {0.f}, {}, false};
  if (!session.pipeline()->configure({v}, descriptor({1})))
    return false;
  auto setup = session.spectrum().prepare(1, true, true, hq);
  session.spectrum().apply(setup);
  unsigned messages = 0;
  bool valid = true;
  std::array<float, 256> signal;
  for (unsigned b = 0; b < (hq ? 200u : 64u); ++b) {
    for (unsigned i = 0; i < 128; ++i)
      signal[i] = signal[128 + i] = std::sin(float(b * 128 + i) * .1f);
    if (!session.render(signal, 128))
      return false;
    session.spectrum().drain([&](const SpectrumFrame &f) {
      valid &= f.hq == hq && f.compare && f.id == 1 && f.index == messages &&
               f.samples.size() == 8192 &&
               std::equal(f.samples.begin(), f.samples.begin() + 4096, f.samples.begin() + 4096) &&
               f.captured <= f.end;
      if (!hq)
        valid &= f.captured == 4096 + messages * 2048;
      ++messages;
    });
  }
  return valid && messages > 0;
}
bool keepsWetHistoryWhileBypassed() {
  Session s;
  if (!s.open({48000, 0, 2, 128}))
    return false;
  PluginSettings volume{1, "VolumePlugin", 0x66796aa7u, {-6.f}, {}, false};
  if (!s.pipeline()->configure({volume}, descriptor({1})))
    return false;
  PowerConfig power;
  power.enabled = power.skip = true;
  power.count = power.pluginCount = 1;
  power.ids[0] = 1;
  s.power().configure(power, *s.pipeline(), Directive::full, -1, -1);
  s.output().delay(128, false);
  s.setMasterBypass(true);
  std::array<float, 256> block{};
  for (unsigned i = 0; i < 8; ++i) {
    block.fill(.75f);
    if (!s.render(block, 128) || block.back() != .75f)
      return false;
  }
  s.setMasterBypass(false);
  block.fill(0);
  if (!s.render(block, 128) || std::abs(block.back() - .75f * std::pow(10.f, -.3f)) > .0001f)
    return false;
  auto visualizer = std::make_unique<Visualizer>(48000, 128);
  if (!visualizer->configure({{0xf0000001u, 0x811c9dc5u, 0, 1, 1, "LevelMeterPlugin", {}}}))
    return false;
  s.exchangeVisualizer(visualizer);
  if (!s.power().command(Directive::zero, 1, 1, -1, false))
    return false;
  for (unsigned i = 0; i < 100; ++i)
    if (!s.render(block, 128))
      return false;
  return s.telemetry()->front() == nullptr;
}
bool discardsQueuedSpectrumBeforeReset() {
  Session s;
  const PluginSettings volume{1, "VolumePlugin", 0x66796aa7u, {0}, {}, false};
  if (!s.open({48000, 0, 2, 128}) || !s.pipeline()->configure({volume}, descriptor({1})))
    return false;
  auto track = s.spectrum().prepare(1, true, false, false);
  s.spectrum().apply(track);
  std::array<float, 256> samples{};
  for (int i = 0; i < 8; ++i) {
    samples.fill(-1);
    if (!s.render(samples, 128))
      return false;
  }
  s.spectrum().reset();
  unsigned records = 0;
  bool clean = true;
  for (int i = 0; i < 32; ++i) {
    samples.fill(1);
    if (!s.render(samples, 128))
      return false;
    s.spectrum().drain([&](const SpectrumFrame &f) {
      ++records;
      clean &= f.index == 0 && f.captured == 40 * 128 &&
               std::all_of(f.samples.begin(), f.samples.end(), [](float v) { return v == 1; });
    });
  }
  return clean && records == 1;
}
} // namespace

int main() {
  using namespace effetune::audio;
  if (!discardsQueuedSpectrumBeforeReset()) {
    std::cerr << "Spectrum retained pre-reset samples\n";
    return 1;
  }
  if (!loadsIrAsset(true)) {
    std::cerr << "Retired IR was not detached at publish\n";
    return 1;
  }
  if (!keepsWetHistoryWhileBypassed() || !preservesRamp() || !loadsIrAsset(false) ||
      !gatesLatencyChanges() || !observesPhysicalRender() || !checksRuntimeFloatingPoint() ||
      !mapsStreamBoundaries() || !comparesSpectrum(false) || !comparesSpectrum(true)) {
    std::cerr << "Pipeline state or impulse response test failed\n";
    return 1;
  }
  if (pffft_simd_size() != 4)
    return 1;
  Frame before{FrameKind::Feed, JsonValue::Object{{"type", "test"}}, {0, 127, 255}};
  std::stringstream wire;
  writeFrame(wire, before);
  Frame after;
  if (!readFrame(wire, after) || after.message.Serialize() != before.message.Serialize() ||
      after.kind != before.kind || after.attachment != before.attachment || readFrame(wire, after))
    return 1;
  Frame checkpoints{FrameKind::Control, JsonValue::Object{{"type", "midiCheckpoints"}},
                    std::vector<std::uint8_t>(4u * 1024u * 1024u + 3, 73)};
  checkpoints.attachment.back() = 159;
  std::stringstream checkpointWire;
  writeFrame(checkpointWire, checkpoints);
  if (!readFrame(checkpointWire, after) || after.message.GetString("type") != "midiCheckpoints" ||
      after.attachment != checkpoints.attachment || readFrame(checkpointWire, after))
    return 1;
  std::stringstream multiplexed;
  writeFrame(multiplexed,
             {FrameKind::Control,
              JsonValue::Object{{"type", "attachmentPart"},
                                {"message", JsonValue::Object{{"type", "midiTransport"}}},
                                {"offset", 0.},
                                {"byteLength", 3.}},
              {7, 8}});
  writeFrame(multiplexed, before);
  writeFrame(multiplexed, {FrameKind::Control, JsonValue::Object{{"type", "feedSilence"}}, {}});
  writeFrame(
      multiplexed,
      {FrameKind::Control, JsonValue::Object{{"type", "attachmentPart"}, {"offset", 2.}}, {9}});
  std::vector<FrameKind> received;
  if (!readFrame(multiplexed, after, [&](const Frame &f) { received.push_back(f.kind); }) ||
      received != std::vector{FrameKind::Feed, FrameKind::Control} ||
      after.message.GetString("type") != "midiTransport" ||
      after.attachment != std::vector<std::uint8_t>{7, 8, 9})
    return 1;
  for (const auto frames : {13u, 127u, 480u, 2049u}) {
    NullDevice device;
    if (!device.session.open({44100, 6, 2, 127}))
      return 1;
    std::vector<float> signal(std::size_t(frames) * 6);
    for (std::size_t i = 0; i != signal.size(); ++i)
      signal[i] = static_cast<float>(i) / signal.size();
    std::vector<std::uint8_t> bytes(signal.size() * sizeof(float));
    std::memcpy(bytes.data(), signal.data(), bytes.size());
    if (bytes != device.render(bytes, frames) || device.session.position() != frames)
      return 1;
  }
  return 0;
}

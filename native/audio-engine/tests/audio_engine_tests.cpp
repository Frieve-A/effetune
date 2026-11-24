#include "device/null/null_device.h"
#include "frame.h"
#include "host/file_fifo.h"
#include "host/pipeline.h"
#include "pffft.h"
#include "registry.h"
#include <algorithm>
#include <array>
#include <barrier>
#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>
#if defined(__x86_64__) || defined(_M_X64)
#include <xmmintrin.h>
#endif
#include <sstream>
#include <thread>

namespace {
using namespace effetune::audio;

bool fileFifoConcatenates() {
  FileFifo fifo;
  fifo.configure(48000, 128);
  const FileFifo::TrackInfo first{1, 1, 0, 48000, 1, 1}, second{1, 2, 0, 48000, 1, .5f};
  const std::array<float, 4> a{1, 2, 3, 4}, b{1, 3, 5, 7};
  std::array<float, 18> output{};
  if (!fifo.start(first, false) || !fifo.write(first, a.data(), a.size()))
    return false;
  fifo.mix(output.data(), 2, 1, 0, nullptr, nullptr);
  if (fifo.snapshot().readFrame || fifo.snapshot().running)
    return false;
  if (!fifo.start(second, true) || !fifo.write(second, b.data(), b.size()) ||
      !fifo.end(1, 1, a.size()) || !fifo.end(1, 2, b.size()) || !fifo.gain(1, 1, .25f))
    return false;
  struct Boundaries {
    std::array<std::uint64_t, 2> frames{};
    std::size_t size = 0;
  } boundaries;
  fifo.mix(output.data(), 2, 9, 1, &boundaries, [](void *context, std::uint64_t frame) noexcept {
    auto &bounds = *static_cast<Boundaries *>(context);
    if (bounds.size < bounds.frames.size())
      bounds.frames[bounds.size++] = frame;
  });
  const std::array<float, 9> expected{.25f, .5f, .75f, 1, .5f, 1.5f, 2.5f, 3.5f, 0};
  const auto clock = fifo.snapshot();
  return std::equal(expected.begin(), expected.end(), output.begin()) &&
         std::equal(expected.begin(), expected.end(), output.begin() + 9) &&
         boundaries.frames == std::array<std::uint64_t, 2>{5, 9} && clock.track == 2 &&
         clock.readFrame == 4 && clock.writtenFrames == 8 && !clock.queuedFrames &&
         !clock.underruns;
}

bool fileFifoConvertsGaplessly() {
  constexpr unsigned trackFrames = 441, outputFrames = 480;
  std::array<float, trackFrames * 2> input{};
  for (unsigned i = 0; i < input.size(); ++i)
    input[i] = .6f + .1f * std::sin(i * .1f);
  const auto render = [&](bool split, bool rateChange, unsigned secondFrames) {
    FileFifo fifo;
    fifo.configure(48000, 128);
    const FileFifo::TrackInfo first{1, 1, 0, 44100, 1, 1};
    const FileFifo::TrackInfo second{1, 2, 0, rateChange ? 48000u : 44100u, 1, 1};
    bool ok = fifo.start(first, false) &&
              fifo.write(first, input.data(), split ? trackFrames : trackFrames + secondFrames) &&
              (!split || (fifo.start(second, true) &&
                          fifo.write(second, input.data() + trackFrames, secondFrames) &&
                          fifo.end(1, 2, secondFrames))) &&
              fifo.end(1, 1, split ? trackFrames : trackFrames + secondFrames);
    const auto frames =
        outputFrames + (rateChange
                            ? secondFrames
                            : static_cast<unsigned>(std::lround(secondFrames * 48000. / 44100.)));
    std::vector<float> result(frames + 2);
    fifo.mix(result.data(), 1, static_cast<unsigned>(result.size()), 0, nullptr, nullptr);
    FileFifo::Event event{};
    if (split)
      ok &= fifo.popEvent(event) && event.type == FileFifo::Event::Type::NextAccepted &&
            event.track == 2;
    ok &= fifo.popEvent(event) && event.type == FileFifo::Event::Type::Ended && event.track == 1 &&
          event.pipelineFrame == (split ? outputFrames : frames);
    if (split) {
      ok &= fifo.popEvent(event) && event.type == FileFifo::Event::Type::Ended &&
            event.track == 2 && event.pipelineFrame == frames;
    }
    if (!ok || fifo.snapshot().underruns)
      result.clear();
    return result;
  };
  for (unsigned length : {trackFrames, 16u}) {
    const auto whole = render(false, false, length);
    if (whole.empty() || whole != render(true, false, length))
      return false;
  }
  const auto switched = render(true, true, trackFrames);
  return !switched.empty() && switched[outputFrames - 1] > .2f &&
         switched[outputFrames] == input[trackFrames] &&
         switched[outputFrames + trackFrames - 1] == input.back() &&
         switched[outputFrames + trackFrames] == 0;
}

bool fileFifoKeepsChannels() {
  constexpr unsigned channels = 6, frames = 4410, width = 8, block = 1024;
  std::vector<float> planar(channels * frames);
  for (unsigned c = 0; c < channels; ++c)
    std::fill_n(planar.begin() + c * frames, frames, .1f * (c + 1));
  for (const unsigned rate : {48000u, 44100u}) {
    FileFifo fifo;
    fifo.configure(48000, 128);
    const FileFifo::TrackInfo track{1, 1, 0, rate, channels, 1};
    if (!fifo.start(track, false) || !fifo.write(track, planar.data(), frames) ||
        !fifo.end(1, 1, frames))
      return false;
    std::vector<float> bus(width * block);
    fifo.mix(bus.data(), width, block, 0, nullptr, nullptr);
    for (unsigned c = 0; c < width; ++c) {
      const float expected = c < channels ? .1f * (c + 1) : 0.f;
      if (std::abs(bus[c * block + block / 2] - expected) > 1e-3f)
        return false;
    }
  }
  return true;
}

bool fileFifoFlushesAndCancels() {
  FileFifo fifo;
  fifo.configure(48000, 128);
  std::array<float, 4096> data;
  data.fill(.5f);
  const FileFifo::TrackInfo first{1, 1, 0, 48000, 1, 1}, cancelled{1, 2, 0, 48000, 1, 1};
  if (!fifo.start(first, false) || !fifo.write(first, data.data(), data.size()) ||
      !fifo.end(1, 1, data.size()) || !fifo.start(cancelled, true) ||
      !fifo.write(cancelled, data.data(), data.size()) || !fifo.cancelNext(1, 2))
    return false;
  std::array<float, 1024> block{};
  fifo.mix(block.data(), 1, 128, 0, nullptr, nullptr);
  FileFifo::Event event{};
  if (!fifo.popEvent(event) || event.type != FileFifo::Event::Type::NextAccepted ||
      !fifo.popEvent(event) || event.type != FileFifo::Event::Type::Cancelled ||
      fifo.snapshot().track != 1 || fifo.snapshot().queuedFrames != data.size() - 128 ||
      !fifo.flush(1) || fifo.write(first, data.data(), 4))
    return false;
  block.fill(0);
  fifo.mix(block.data(), 1, static_cast<unsigned>(block.size()), 128, nullptr, nullptr);
  if (block[0] != .5f || block[500] >= block[100] || block[960] != 0 || fifo.snapshot().running)
    return false;
  const FileFifo::TrackInfo replacement{2, 1, 0, 48000, 1, 1}, next{2, 2, 0, 48000, 1, 1};
  if (!fifo.start(replacement, false) || !fifo.start(next, true) ||
      !fifo.write(replacement, data.data(), 10) || !fifo.end(2, 1, 10) ||
      !fifo.write(next, data.data(), data.size()))
    return false;
  fifo.mix(block.data(), 1, 11, 0, nullptr, nullptr);
  if (!fifo.cancelNext(2, 2))
    return false;
  fifo.mix(block.data(), 1, 1, 11, nullptr, nullptr);
  return fifo.popEvent(event) && event.type == FileFifo::Event::Type::NextAccepted &&
         fifo.popEvent(event) && event.type == FileFifo::Event::Type::Ended &&
         fifo.popEvent(event) && event.type == FileFifo::Event::Type::AlreadyPlaying &&
         fifo.snapshot().track == 2 && fifo.snapshot().readFrame == 2;
}

bool fileFifoDeclinesNextAfterEnd() {
  using Type = FileFifo::Event::Type;
  FileFifo fifo;
  fifo.configure(48000, 128);
  const FileFifo::TrackInfo first{1, 1, 0, 48000, 1, 1}, late{1, 2, 0, 48000, 1, 1},
      restarted{2, 1, 0, 48000, 1, 1};
  const std::array<float, 3> samples{.1f, .2f, .3f};
  std::array<float, 4> block{};
  if (!fifo.start(first, false) || !fifo.write(first, samples.data(), samples.size()) ||
      !fifo.end(1, 1, samples.size()))
    return false;
  fifo.mix(block.data(), 1, block.size(), 0, nullptr, nullptr);
  FileFifo::Event event{};
  if (!fifo.popEvent(event) || event.type != Type::Ended || event.pipelineFrame != samples.size() ||
      !fifo.start(late, true))
    return false;
  block.fill(0);
  fifo.mix(block.data(), 1, block.size(), 4, nullptr, nullptr);
  if (!fifo.popEvent(event) || event.type != Type::NextRejected || event.generation != 1 ||
      event.track != 2 || fifo.snapshot().running || fifo.snapshot().track != 1 ||
      !fifo.start(restarted, false) || !fifo.write(restarted, samples.data(), samples.size()) ||
      !fifo.end(2, 1, samples.size()))
    return false;
  fifo.mix(block.data(), 1, block.size(), 8, nullptr, nullptr);
  return block == std::array<float, 4>{.1f, .2f, .3f, 0.f} && fifo.snapshot().generation == 2;
}

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

AssetData unitImpulse() {
  AssetData impulse;
  const std::array<std::uint32_t, 9> words{0x31415445, 1, 1, 48000, 1, 0, 0, 0, 0x3f800000};
  impulse.payload.resize(sizeof(words));
  std::memcpy(impulse.payload.data(), words.data(), sizeof(words));
  impulse.footprintBytes = 1024 * 1024;
  impulse.processingChannels = 2;
  impulse.headBlock = 128;
  impulse.formatTag = 1;
  return impulse;
}
bool loadsIrAsset(bool removeNode) {
  Session session;
  if (!session.open({48000, 0, 2, 128}))
    return false;
  auto *pipeline = session.pipeline();
  const auto exchange = [&](std::optional<AssetData> asset) {
    auto change = pipeline->assetChange(1, 0, std::move(asset));
    if (!change->capture() || !change->prepare() || !change->captureRoute() ||
        !change->prepareRoute() || !change->apply())
      return false;
    change->finish();
    return true;
  };
  if (!exchange(unitImpulse()) || pipeline->assetState(1, 0) != 1)
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
  return (pipeline->assetState(1, 0) & 0xffu) == 3 && exchange(std::nullopt) &&
         pipeline->assetState(1, 0) == 0;
}
bool exchangesRoomEqDuringPlayback(bool repeatConfiguration) {
  Session session;
  PluginSettings room{
      1,  "RoomEqPlugin", effetune::registry::find("RoomEqPlugin")->paramsHash, {1, 512, 0, 0},
      {}, false};
  if (!session.open({48000, 0, 2, 128}) || !session.pipeline()->configure({room}, descriptor({1})))
    return false;
  auto &pipeline = *session.pipeline();
  const auto change = [&](std::optional<AssetData> asset) {
    auto bank = pipeline.assetChange(1, 0, std::move(asset));
    if (!bank->capture() || !bank->prepare() || !bank->captureRoute() || !bank->prepareRoute() ||
        !bank->apply())
      return decltype(bank){};
    if (!bank->deferred())
      bank->finish();
    return bank;
  };
  const auto render = [&] {
    std::array<float, 256> block{};
    for (unsigned i = 0; i < 96; ++i) {
      block.fill(0.25f);
      if (!session.render(block, 128) ||
          (session.needsLatencyReservation() && !session.reserveLatency()))
        return false;
    }
    return true;
  };
  if (!render() || !change(unitImpulse()))
    return false;
  if (repeatConfiguration &&
      (!pipeline.configure({room}, descriptor({1})) || session.latency() != 640))
    return false;
  if (!render() || session.latency() != 640 ||
      (pipeline.assetState(1, 0) & 255u) != ET_ASSET_STATE_ACTIVE)
    return false;
  auto replaced = change(unitImpulse());
  auto replacement = change(unitImpulse());
  if (!replaced || !replacement || !replaced->deferred() || !replacement->deferred() || !render())
    return false;
  bool cancelled = false, applied = false;
  Pipeline::AssetNotice notice;
  while (pipeline.takeNotice(notice)) {
    if (!notice.completed)
      continue;
    auto bank = pipeline.releaseBank(notice.completed);
    if (!bank)
      return false;
    if (bank == replaced)
      cancelled = notice.rejected && !bank->stale();
    if (bank == replacement)
      applied = !notice.rejected;
    bank->finish();
  }
  auto pending = change(unitImpulse());
  if (!cancelled || !applied || !pending || !pending->deferred() || !change(std::nullopt))
    return false;
  while (pipeline.takeNotice(notice)) {
    if (notice.completed != pending.get())
      continue;
    auto bank = pipeline.releaseBank(notice.completed);
    return bank == pending && notice.rejected && !bank->stale() && render() &&
           pipeline.assetState(1, 0) == 0;
  }
  return false;
}
bool exchangesDisabledRoomEqWithoutDry() {
  Session session;
  PluginSettings room{
      1,  "RoomEqPlugin", effetune::registry::find("RoomEqPlugin")->paramsHash, {1, 512, 0, 0},
      {}, false};
  if (!session.open({48000, 0, 2, 128}) || !session.pipeline()->configure({room}, descriptor({1})))
    return false;
  auto &pipeline = *session.pipeline();
  const auto change = [&] {
    auto bank = pipeline.assetChange(1, 0, unitImpulse());
    if (!bank->capture() || !bank->prepare() || !bank->captureRoute() || !bank->prepareRoute() ||
        !bank->apply())
      return false;
    const bool deferred = bank->deferred();
    if (!deferred)
      bank->finish();
    return !deferred;
  };
  if (!change())
    return false;
  std::array<float, 256> block{};
  for (unsigned i = 0; i < 96; ++i) {
    block.fill(0.25f);
    if (!session.render(block, 128) ||
        (session.needsLatencyReservation() && !session.reserveLatency()))
      return false;
  }
  if ((pipeline.assetState(1, 0) & 255u) != ET_ASSET_STATE_ACTIVE)
    return false;
  // An enabled slot defers the same replacement until its dry transition is rendered.
  // A disabled one is never processed, so waiting would refuse every topology change.
  room.skip = true;
  return pipeline.configure({room}, descriptor({1})) && change() &&
         pipeline.prepareChange({room}, descriptor({1})) != nullptr;
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

bool appliesFileBoundaryToBothBranches() {
  Session session;
  if (!session.open({48000, 0, 2, 128}) || !session.startParallel(false))
    return false;
  auto *branch = session.branch(1);
  const auto *kernel = effetune::registry::find("RhythmAnalyzerPlugin");
  if (!branch || !kernel || !session.setTelemetryRate(240) || !branch->setTelemetryRate(240))
    return false;
  const PluginSettings rhythm{
      1, "RhythmAnalyzerPlugin", kernel->paramsHash, {40.f, 240.f, 0.f, 0.f}, {}, false};
  if (!session.pipeline()->configure({rhythm}, descriptor({1})) ||
      !branch->pipeline()->configure({rhythm}, descriptor({1})))
    return false;
  std::array<float, 256> block;
  block.fill(.25f);
  if (!session.render(block, 128) || !session.render(block, 128))
    return false;
  constexpr auto generationOffset = effetune::kTelemetryHeaderBytes + 4;
  const auto drain = [&](Session &source, std::uint32_t &generation, std::uint64_t boundary) {
    bool found = false;
    while (const auto *packet = source.telemetry()->front()) {
      if (packet->bytes >= generationOffset + 4) {
        std::memcpy(&generation, packet->data.data() + generationOffset, sizeof(generation));
        found |= packet->endFrame == boundary;
      }
      source.telemetry()->pop();
    }
    return found;
  };
  std::uint32_t initialA = 0, initialB = 0;
  drain(session, initialA, 0);
  drain(*branch, initialB, 0);
  constexpr auto boundary = 256 + 19;
  session.noteFileBoundary(boundary);
  if (!session.render(block, 128) || !session.render(block, 128))
    return false;
  auto afterA = initialA, afterB = initialB;
  return drain(session, afterA, boundary) && drain(*branch, afterB, boundary) && initialA &&
         initialB && afterA == initialA + 1 && afterB == initialB + 1;
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
bool visualizerRunsWithEffectsHidden() {
  Session session;
  constexpr unsigned tap = 0xf0000001u;
  if (!session.open({48000, 0, 2, 128}) || !session.setTelemetryRate(120))
    return false;
  auto visualizer = std::make_unique<Visualizer>(48000, 128);
  if (!visualizer->configure({{tap, 0x811c9dc5u, 0, 1, 1, "LevelMeterPlugin", {}}}))
    return false;
  session.exchangeVisualizer(visualizer);
  std::array<float, 256> block{};
  for (unsigned phase = 0; phase < 3; ++phase) {
    session.telemetry()->enabled = phase == 0;
    session.power().setDisplayBypass(phase == 2);
    unsigned packets = 0;
    for (unsigned i = 0; i < 96; ++i) {
      block.fill(.25f);
      if (!session.render(block, 128) || block.back() != .25f)
        return false;
      while (auto *packet = session.telemetry()->front()) {
        unsigned id = 0;
        std::memcpy(&id, packet->data.data() + 4, sizeof(id));
        if (id == tap)
          ++packets;
        session.telemetry()->pop();
      }
    }
    if (packets < 2) {
      std::cerr << "Visualizer phase " << phase << " delivered " << packets << " packets\n";
      return false;
    }
  }
  return true;
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
  if (!fileFifoConcatenates() || !fileFifoConvertsGaplessly() || !fileFifoKeepsChannels() ||
      !fileFifoFlushesAndCancels() || !fileFifoDeclinesNextAfterEnd()) {
    std::cerr << "File PCM continuity, conversion, or lifecycle failed\n";
    return 1;
  }
  if (!visualizerRunsWithEffectsHidden())
    return 1;
  if (!discardsQueuedSpectrumBeforeReset()) {
    std::cerr << "Spectrum retained pre-reset samples\n";
    return 1;
  }
  if (!loadsIrAsset(true)) {
    std::cerr << "Retired IR was not detached at publish\n";
    return 1;
  }
  if (!appliesFileBoundaryToBothBranches()) {
    std::cerr << "File PCM boundary did not reset both analyzers\n";
    return 1;
  }
  if (!exchangesRoomEqDuringPlayback(false) || !exchangesRoomEqDuringPlayback(true)) {
    std::cerr << "Room EQ asset replacement, cancellation or latency recovery "
                 "failed\n";
    return 1;
  }
  if (!exchangesDisabledRoomEqWithoutDry()) {
    std::cerr << "Disabled Room EQ waited for a dry transition\n";
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
  std::barrier startWriting(2);
  constexpr unsigned rejections = 32;
  std::thread fileReader([&] {
    startWriting.arrive_and_wait();
    for (unsigned i = 0; i < rejections; ++i) {
      writeFrame(checkpointWire,
                 {FrameKind::Control,
                  JsonValue::Object{
                      {"type", "fileNextResult"}, {"track", double(i + 1)}, {"accepted", false}},
                  {}});
    }
  });
  startWriting.arrive_and_wait();
  writeFrame(checkpointWire, checkpoints);
  fileReader.join();
  unsigned acknowledged = 0, transfers = 0;
  while (readFrame(checkpointWire, after)) {
    if (after.message.GetString("type") == "fileNextResult") {
      if (after.message.GetUInt32("track") != ++acknowledged ||
          after.message.GetBool("accepted") != false || !after.attachment.empty())
        return 1;
    } else if (after.message.GetString("type") == "midiCheckpoints" &&
               after.attachment == checkpoints.attachment) {
      ++transfers;
    } else {
      return 1;
    }
  }
  if (acknowledged != rejections || transfers != 1)
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

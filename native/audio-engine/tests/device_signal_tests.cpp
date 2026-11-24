#include "effetune/telemetry.h"
#include "host/io_pipeline.h"
#include "host/network_paths.h"
#include "host/pipeline.h"
#include "host/session.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <iostream>
#include <stdexcept>

using namespace effetune::audio;

namespace {
void require(bool ok, const char *message) {
  if (!ok)
    throw std::runtime_error(message);
}

void testMix() {
  Session session;
  require(session.open({48000, 4, 2, 127}), "Open four-channel input");
  std::array<float, 4 * 173> sync;
  std::array<float, 2 * 173> output;
  for (unsigned i = 0; i < sync.size(); ++i)
    sync[i] = float(i - 200.) / 1234.f;
  require(session.renderDevice(output, 173, sync) &&
              std::equal(output.begin(), output.end(), sync.begin()),
          "Synchronous input lost sample identity");
  std::vector<float> capture(3072 * 4, .25f), feed(3072 * 2, .5f);
  require(session.capture().write(capture.data(), 4, 3072, 1, 100), "Capture write");
  require(session.feed().write(feed.data(), 2, 3072, 1, 50), "Feed write");
  for (unsigned i = 0; i < 4; ++i)
    require(session.renderDevice(output, 173), "Mix callback");
  require(std::abs(output[0] - .75f) < .00001f, "Feed and capture were not mixed");
  const auto queued = session.capture().queued();
  session.io()->inputEnabled = false;
  require(session.renderDevice(output, 173) && std::abs(output[0] - .5f) < .00001f &&
              session.capture().queued() < queued,
          "Closed input mix must still drain capture");
  session.close();
  require(session.open({384000, 0, 2, 127, 44100}), "Open hardware-rate mismatch");
  for (unsigned callback = 0; callback < 50; ++callback)
    require(session.renderDevice(output, 173), "Device output resampler stalled");
  require(std::abs(double(session.position()) - 50 * 173. * 384000 / 44100) < 10,
          "Device clock did not drive the pipeline at the configured rate");
}

void testNetworkSender() {
  auto sender = std::make_unique<NetworkSender>(44100, 128);
  std::array<float, 128> left, right;
  left.fill(-1);
  right.fill(1);
  std::uint64_t frame = 128;
  sender->setAttached(true);
  auto render = [&](bool sending) {
    sender->render(left.data(), right.data(), 128, frame, frame / 128, sending);
    frame += 128;
  };
  for (unsigned i = 0; i < 8 * 16; ++i)
    render(true);
  NetworkPacket packet;
  std::uint64_t epoch = 0;
  for (unsigned i = 0; i < 8; ++i) {
    require(sender->pop(packet) && packet.sourceFrame == i * 2048 &&
                packet.contextFrame == 128 + i * 2048 &&
                packet.routeRevisionEnd == packet.routeRevision + 15,
            "Network packet timing");
    require(packet.pcm[0] == -32768 && packet.pcm[1] == 32767, "PCM16 conversion");
    epoch = packet.sourceEpoch;
  }
  sender->acknowledge(epoch + 1, 0);
  for (unsigned i = 0; i < 16; ++i)
    render(true);
  require(!sender->pop(packet), "Stale ACK freed a packet");
  sender->acknowledge(epoch, 0);
  for (unsigned i = 0; i < 16; ++i)
    render(true);
  require(sender->pop(packet) && packet.sourceEpoch > epoch && !packet.sourceFrame,
          "ACK did not resume sending");
  sender->acknowledge(packet.sourceEpoch, packet.sourceFrame);
  for (unsigned i = 0; i < 16; ++i)
    render(false);
  require(!sender->pop(packet), "Paused or receiving session still sent PCM");
}

void testLoopbackSilence() {
  Session session;
  require(session.open({48000, 2, 2, 128}), "Open loopback input");
  auto &fifo = session.capture();
  std::array<float, 2 * 256> packet{};
  std::array<float, 2 * 128> output{};
  for (const unsigned position : {0u, 48000u}) {
    require(fifo.write(packet.data(), 2, 256, 1, position), "Write loopback packet");
    fifo.silence(1);
    for (unsigned i = 0; i < 12; ++i)
      require(session.renderDevice(output, 128), "Drain loopback packet and silence");
    require(fifo.state() == FifoState::idle && fifo.gaps() == 0 && fifo.underruns() == 0,
            "An explicit silence boundary must absorb the gap between loopback packets");
  }
}

void testVisualizerSourceHistory() {
  Visualizer display(48000, 256);
  display.setRate(240);
  auto telemetry = std::make_unique<Telemetry>();
  std::array<float, 512> signal;
  std::fill_n(signal.begin(), 256, 1.f);
  std::fill_n(signal.begin() + 256, 256, .25f);
  VisualizerSource source{0xf0000001u, 0x811c9dc5u, 0, 0, 1, "LevelMeterPlugin", {}};
  unsigned frame = 0;
  auto peak = [&] {
    require(display.configure({source}), "Configure visualizer source");
    display.render(signal.data(), 2, 256, frame, *telemetry, 0, VisualizerStage::pipeline);
    frame += 256;
    const auto *packet = telemetry->front();
    require(packet && packet->bytes >= effetune::kTelemetryHeaderBytes + 8, "Level meter packet");
    float value;
    std::memcpy(&value, packet->data.data() + effetune::kTelemetryHeaderBytes + 4, sizeof(value));
    telemetry->pop();
    return value;
  };
  require(peak() == 1, "Level meter initial peak");
  source.left = source.right = 1;
  require(peak() == .25f, "Level meter retained previous channel");
  source.gain = .5f;
  require(peak() == .125f, "Level meter retained previous gain");

  source = {0xf0000001u, 0xf854c585u, 0, 1, 1, "RhythmAnalyzerPlugin", {40, 240, 0, 0}};
  auto beatTicks = [&](unsigned blocks) {
    require(display.configure({source}), "Configure rhythm analyzer");
    std::uint32_t ticks = 0;
    for (unsigned i = 0; i < blocks; ++i) {
      display.render(signal.data(), 2, 256, frame, *telemetry, 0, VisualizerStage::pipeline);
      frame += 256;
      if (const auto *packet = telemetry->front()) {
        require(packet->bytes >= effetune::kTelemetryHeaderBytes + 16, "Rhythm analysis packet");
        std::memcpy(&ticks, packet->data.data() + effetune::kTelemetryHeaderBytes + 12,
                    sizeof(ticks));
        telemetry->pop();
      }
    }
    return ticks;
  };
  const auto before = beatTicks(128);
  source.params[3] = 1;
  require(before > 0 && beatTicks(32) > before, "Display mode reset the beat tracker");
}

void testLocalDelay() {
  NetworkLocalDelay delay(44100, 2);
  delay.set(true, 149);
  std::array<float, 2 * 128> signal{};
  for (unsigned i = 0; i < 5; ++i)
    delay.process(signal.data(), 128);
  require(delay.samples() == 149, "L0 did not settle");
  signal[7] = .5f;
  signal[128 + 7] = -.75f;
  delay.process(signal.data(), 128);
  signal.fill(0);
  delay.process(signal.data(), 128);
  require(signal[28] == .5f && signal[128 + 28] == -.75f, "L0 impulse position");
  delay.set(false, 0);
  require(delay.active(), "Delay was released before its transition");
  for (unsigned i = 0; i < 2; ++i)
    delay.process(signal.data(), 128);
  require(!delay.active(), "Delay remained active");
  require(visualizerStage(false, true, true, false) == VisualizerStage::pipeline &&
              visualizerStage(true, false, true, false) == VisualizerStage::local &&
              visualizerStage(true, true, true, false) == VisualizerStage::send &&
              visualizerStage(true, true, true, true) == VisualizerStage::network,
          "Visualizer tap mapping");
}

std::vector<std::uint8_t> route(std::initializer_list<unsigned> ids) {
  std::vector<std::uint8_t> descriptor(8 + 12 * ids.size());
  descriptor[0] = 1;
  descriptor[4] = static_cast<std::uint8_t>(ids.size());
  unsigned pos = 8;
  for (auto id : ids) {
    std::memcpy(descriptor.data() + pos, &id, sizeof(id));
    descriptor[pos + 4] = descriptor[pos + 8] = 1;
    descriptor[pos + 7] = 254;
    pos += 12;
  }
  return descriptor;
}

void testParallelAndRoute() {
  Session session;
  require(session.open({44100, 0, 2, 128}), "Open parallel test");
  PluginSettings volume{1, "VolumePlugin", 0x66796aa7u, {-6.0206f}, {}, false};
  PluginSettings send{2, "NetworkSendPlugin", 0, {}, {}, true};
  PluginSettings receive{3, "NetworkReceivePlugin", 0, {}, {}, true};
  auto *graph = session.pipeline();
  require(graph->configure({send, volume, receive}, route({2, 1, 3})), "Configure markers");
  NetworkPaths paths;
  graph->traceOutputs(paths);
  require(paths.pluginIds[0] == 2 && paths.taps[0].input.network == 0 &&
              paths.taps[0].output.network == -1 && paths.taps[1].input.local == 0 &&
              paths.taps[1].input.network == -1,
          "Network route reachability at the send marker");
  std::array<float, 256> signal;
  auto render = [&] {
    signal.fill(.5f);
    require(session.render(signal, 128), "Render parallel and routed signals");
  };
  session.io()->sender.setAttached(true);
  for (int i = 0; i < 16; ++i)
    render();
  NetworkPacket packet;
  require(session.io()->sender.pop(packet) && packet.pcm[100] == 16384 &&
              std::abs(signal[0] - .25f) < .0001f,
          "Send marker did not tap signal before Volume");
  require(graph->setNetworkRouting(true, false) && graph->receiveId() == 3,
          "Receive marker resolution");
  render();
  require(signal[0] == .5f, "Receive marker did not disconnect prefix");
  require(graph->setNetworkRouting(false, false), "Restore previous route");
  for (int i = 0; i < 5; ++i)
    render();
  require(session.startParallel(false), "Create secondary session");
  render();
  require(std::abs(signal[0] - .25f) < .0001f, "Adding secondary changed primary output");
  session.selectParallel(true);
  render();
  require(std::abs(signal[0] - .25f) < .0001f &&
              std::abs(signal[127] - (.25f + .25f * 127 / 1323)) < .0001f,
          "Parallel selection gain ramp");
  for (int i = 0; i < 11; ++i)
    render();
  require(std::abs(signal[0] - .5f) < .0001f && signal[128] == signal[0],
          "Secondary input distribution");
  session.selectParallel(false);
  for (int i = 0; i < 12; ++i)
    render();
  session.stopParallel();
  render();
  require(std::abs(signal[0] - .25f) < .0001f, "Detaching secondary interrupted primary");
}
} // namespace

static void testReopenedPeriods() {
  Session s;
  SessionFormat f{48000, 0, 2, 512, 48000, 48000};
  require(s.open(f), "open for device recovery");
  auto *io = s.io();
  io->inputEnabled = false;
  io->receiving = true;
  io->visualSync = true;
  io->paused = true;
  io->receiveGeneration = 19;
  io->requestLocalDelay(7, true, 23, false);
  io->sender.setAttached(true);
  const auto revision = io->routeRevision;
  f.periodFrames = 128;
  f.deviceRate = 44100;
  require(s.reconfigureDevice(f), "shorter device period");
  require(s.maxBlock() == 512 && s.startParallel(true) && s.branch(1)->maxBlock() == 512,
          "branch uses the pipeline maximum");
  auto display = std::make_unique<Visualizer>(f.sampleRate, s.maxBlock());
  require(display->configure({{0xf0000001u, 0x811c9dc5u, 0, 1, 1, "LevelMeterPlugin", {}}}),
          "build display at shorter period");
  s.exchangeVisualizer(display);
  f.periodFrames = 512;
  f.deviceRate = 48000;
  require(s.reconfigureDevice(f), "restore device period");
  require(s.io() == io && !io->inputEnabled && io->receiving && io->visualSync && io->paused &&
              !io->localEnabled && io->receiveGeneration == 19 && io->requestedLocalDelay == 23 &&
              io->routeRevision == revision,
          "keep routing and mute across same-width recovery");
  std::array<float, 1024> block{};
  for (unsigned n = 0; n < 20; ++n)
    require(s.render(block, 512), "render both branches and visualizer at restored period");
  require(s.telemetry()->front() != nullptr, "visualizer received the larger blocks");
}

static void testRecoveryOutput() {
  Session s;
  require(s.open({44100, 0, 2, 128}) && s.startParallel(true), "open recovery branches");
  s.output().holdRecovery();
  std::array<float, 256> block{};
  auto render = [&] {
    block.fill(.5f);
    require(s.render(block, 128), "render during recovery");
  };
  render();
  require(std::all_of(block.begin(), block.end(), [](float x) { return x == 0; }),
          "uncommitted secondary output is silent");
  s.stopParallel();
  s.io()->sender.setAttached(true);
  for (unsigned i = 0; i < 17; ++i)
    render();
  NetworkPacket packet;
  require(s.io()->sender.pop(packet) &&
              std::all_of(packet.pcm.begin(), packet.pcm.end(), [](auto x) { return x == 0; }),
          "network never receives uncommitted audio");
  s.output().fade(.5f, 0);
  render();
  require(block.back() == 0, "a gain update cannot release recovery");
  s.output().releaseRecovery();
  render();
  require(block.front() == 0 && block.back() > 0 && block.back() < .25f, "recovery ramps open");
  for (unsigned i = 0; i < 4; ++i)
    render();
  require(block.back() == .25f, "recovery honors the restored gain");
}

int main() {
  try {
    testMix();
    testLoopbackSilence();
    testNetworkSender();
    testVisualizerSourceHistory();
    testLocalDelay();
    testParallelAndRoute();
    testReopenedPeriods();
    testRecoveryOutput();
  } catch (const std::exception &error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
